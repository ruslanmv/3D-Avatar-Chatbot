'use strict';

/**
 * PoseEditor — Core orchestrator for Pose Studio.
 * Manages rig mapping, undo/redo, bone selection, pose apply/save.
 *
 * Exposes: window.NEXUS_POSE_EDITOR (constructor class)
 */
(function () {
    const PoseRigMap = window.NEXUS_POSE_RIG_MAP;
    const PoseState = window.NEXUS_POSE_STATE;
    const PoseLibrary = window.NEXUS_POSE_LIBRARY;
    const PoseApplier = window.NEXUS_POSE_APPLIER;

    function PoseEditor(opts) {
        opts = opts || {};
        this.getAvatarRoot = opts.getAvatarRoot || null;
        this.getHumanoid = opts.getHumanoid || null;
        this.proceduralAnimator = opts.proceduralAnimator || null;
        this.onChange = opts.onChange || null;

        this.enabled = false;
        this.selectedBone = null;

        this.rigMap = null;
        this.neutralPose = null;
        this.applier = null;

        this.library = new PoseLibrary();

        this.undoStack = [];
        this.redoStack = [];
    }

    PoseEditor.prototype.enter = function () {
        const root = this.getAvatarRoot ? this.getAvatarRoot() : null;
        if (!root) {
            return false;
        }

        const humanoid = this.getHumanoid ? this.getHumanoid() : null;
        this.rigMap = new PoseRigMap({ root, vrmHumanoid: humanoid });

        if (!this.rigMap.hasUpperBodyRig()) {
            console.warn('[PoseEditor] Upper body rig not detected');
        }

        // CRITICAL: Reset all mapped bones to their bind-pose quaternion FIRST.
        // PoseStudioNormalizer uses additive rotation (bone.rotation.z += ...),
        // so without resetting, every click of "Open Studio" compounds rotations
        // and progressively destroys the hands/arms (T-pose corruption bug).
        const boneKeys = Object.keys(this.rigMap.bones);
        for (let i = 0; i < boneKeys.length; i++) {
            const bone = this.rigMap.bones[boneKeys[i]];
            if (bone) {
                bone.quaternion.identity();
                bone.updateMatrixWorld(true);
            }
        }

        // Now apply the relaxed standing pose on a clean slate
        const normalizer = window.NEXUS_POSE_STUDIO_NORMALIZER;
        if (normalizer) {
            normalizer.applyRelaxedStandingPose(this.rigMap);
        }

        // Capture the neutral snapshot (now stable regardless of how many times we enter)
        this.neutralPose = PoseState.createNeutralSnapshot(this.rigMap);
        this.applier = new PoseApplier({
            rigMap: this.rigMap,
            neutralPose: this.neutralPose,
        });

        this.enabled = true;
        this.selectedBone = 'head';

        // Pause procedural animations during editing
        if (this.proceduralAnimator && this.proceduralAnimator.setEditMode) {
            this.proceduralAnimator.setEditMode(true);
        }

        // Immediately apply the first pose (Lecturer) with NO blend time
        // to prevent a visible T-pose flash before show() blends in.
        var vps = window.vrPoseSystem;
        if (vps) {
            vps.applyPreset('lecturerNeutral', 0);
        }

        this._emitChange();
        return true;
    };

    PoseEditor.prototype.exit = function () {
        this.enabled = false;
        this.selectedBone = null;

        if (this.proceduralAnimator && this.proceduralAnimator.setEditMode) {
            this.proceduralAnimator.setEditMode(false);
        }

        this._emitChange();
    };

    PoseEditor.prototype.isActive = function () {
        return this.enabled;
    };

    PoseEditor.prototype.selectBone = function (key) {
        if (!this.enabled) {
            return;
        }
        if (!this.rigMap || !this.rigMap.getBone(key)) {
            return;
        }
        this.selectedBone = key;
        this._emitChange();
    };

    PoseEditor.prototype._pushUndoSnapshot = function () {
        if (!this.rigMap) {
            return;
        }
        const snapshot = PoseState.captureFromRig(this.rigMap, this.neutralPose);
        this.undoStack.push(snapshot);
        if (this.undoStack.length > 50) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    };

    PoseEditor.prototype.undo = function () {
        if (!this.undoStack.length || !this.applier) {
            return;
        }
        const current = PoseState.captureFromRig(this.rigMap, this.neutralPose);
        this.redoStack.push(current);
        const prev = this.undoStack.pop();
        this.applier.resetAll();
        this.applier.applyPose(prev, 1);
        this._emitChange();
    };

    PoseEditor.prototype.redo = function () {
        if (!this.redoStack.length || !this.applier) {
            return;
        }
        const current = PoseState.captureFromRig(this.rigMap, this.neutralPose);
        this.undoStack.push(current);
        const next = this.redoStack.pop();
        this.applier.resetAll();
        this.applier.applyPose(next, 1);
        this._emitChange();
    };

    PoseEditor.prototype.rotateSelected = function (axis, radians) {
        if (!this.enabled || !this.selectedBone || !this.applier) {
            return;
        }
        this._pushUndoSnapshot();
        this.applier.rotateBoneLocal(this.selectedBone, axis, radians);
        this._emitChange();
    };

    /**
     * Set an absolute rotation on one axis for the selected bone.
     * Used by bipolar sliders (Pitch/Yaw/Roll).
     *
     * @param {string} axis - 'x', 'y', or 'z'
     * @param {number} degrees - Rotation in degrees
     */
    PoseEditor.prototype.setSelectedAxisDegrees = function (axis, degrees) {
        if (!this.enabled || !this.selectedBone || !this.applier) {
            return;
        }
        const radians = (degrees * Math.PI) / 180;
        this.applier.setSelectedBoneAxisState(this.selectedBone, axis, radians);
        this._emitChange();
    };

    PoseEditor.prototype.resetSelected = function () {
        if (!this.enabled || !this.selectedBone || !this.applier) {
            return;
        }
        this._pushUndoSnapshot();
        this.applier.resetBone(this.selectedBone);
        this._emitChange();
    };

    PoseEditor.prototype.resetAll = function () {
        if (!this.enabled || !this.applier) {
            return;
        }
        this._pushUndoSnapshot();
        this.applier.resetAll();
        this._emitChange();
    };

    PoseEditor.prototype.mirrorArms = function (fromSide) {
        if (!this.enabled || !this.applier) {
            return;
        }
        this._pushUndoSnapshot();
        this.applier.mirrorArmPose(fromSide || 'left');
        this._emitChange();
    };

    PoseEditor.prototype.applyPoseById = function (id) {
        const pose = this.library.getPoseById(id);
        if (!pose || !this.applier) {
            return;
        }
        this._pushUndoSnapshot();
        this.applier.resetAll();
        this.applier.applyPose(pose, 1);
        this._emitChange();
    };

    PoseEditor.prototype.saveCurrentPose = function (name) {
        if (!this.rigMap) {
            return null;
        }
        const poseState = PoseState.captureFromRig(this.rigMap, this.neutralPose);
        poseState.name = name || 'Custom Pose';
        const saved = this.library.savePose(poseState.name, poseState);
        this._emitChange();
        return saved;
    };

    PoseEditor.prototype.getState = function () {
        return {
            enabled: this.enabled,
            selectedBone: this.selectedBone,
            builtInPoses: this.library.getBuiltInPoses(),
            userPoses: this.library.getUserPoses(),
            rigJson: this.rigMap ? this.rigMap.toJSON() : {},
        };
    };

    PoseEditor.prototype._emitChange = function () {
        if (this.onChange) {
            this.onChange(this.getState());
        }
    };

    window.NEXUS_POSE_EDITOR = PoseEditor;
})();
