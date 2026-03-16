'use strict';

/**
 * PoseApplier — High-level bone manipulation: apply, reset, rotate, mirror.
 * Works with PoseRigMap + PoseState.
 *
 * v2: Added axisState tracking for slider-based editing.
 *   - setSelectedBoneAxisState(boneKey, axis, radians) sets absolute rotation
 *   - axisState tracks {x, y, z} radians per bone for slider sync
 *   - resetBone/resetAll clears axisState
 *
 * Exposes: window.NEXUS_POSE_APPLIER (constructor class)
 */
(function () {
    const THREE = window.THREE;
    if (!THREE) {
        console.warn('[PoseApplier] THREE not found on window.');
        return;
    }

    const PoseState = window.NEXUS_POSE_STATE;

    function PoseApplier(opts) {
        this.rigMap = opts.rigMap;
        this.neutralPose = opts.neutralPose;
        // Per-bone axis state for slider sync: { boneKey: { x: 0, y: 0, z: 0 } }
        this.axisState = {};
    }

    PoseApplier.prototype.applyPose = function (pose, blend) {
        if (typeof blend !== 'number') {
            blend = 1;
        }
        const PS = PoseState || window.NEXUS_POSE_STATE;
        if (PS) {
            PS.applyToRig(pose, this.rigMap, this.neutralPose, blend);
        }
        // Clear axis state after applying a preset (sliders reset)
        this.axisState = {};
    };

    PoseApplier.prototype.resetAll = function () {
        const PS = PoseState || window.NEXUS_POSE_STATE;
        if (PS) {
            PS.resetToNeutral(this.rigMap, this.neutralPose);
        }
        this.axisState = {};
    };

    PoseApplier.prototype.resetBone = function (boneKey) {
        const bone = this.rigMap.getBone(boneKey);
        if (!bone || !this.neutralPose || !this.neutralPose[boneKey] || !this.neutralPose[boneKey].q) {
            return;
        }
        const q = this.neutralPose[boneKey].q;
        bone.quaternion.set(q[0], q[1], q[2], q[3]);
        bone.updateMatrixWorld(true);
        this.axisState[boneKey] = { x: 0, y: 0, z: 0 };
    };

    PoseApplier.prototype.rotateBoneLocal = function (boneKey, axis, radians) {
        const bone = this.rigMap.getBone(boneKey);
        if (!bone) {
            return;
        }

        const q = new THREE.Quaternion();
        if (axis === 'x') {
            q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), radians);
        }
        if (axis === 'y') {
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), radians);
        }
        if (axis === 'z') {
            q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), radians);
        }

        bone.quaternion.multiply(q);
        bone.updateMatrixWorld(true);

        // Update axis state (additive — approximate)
        if (!this.axisState[boneKey]) {
            this.axisState[boneKey] = { x: 0, y: 0, z: 0 };
        }
        this.axisState[boneKey][axis] += radians;
    };

    /**
     * Set an absolute rotation on one axis for a bone (slider-driven).
     * Recomputes the bone quaternion from neutral + all three axis values.
     *
     * @param {string} boneKey - Bone key (e.g. 'leftUpperArm')
     * @param {string} axis - 'x', 'y', or 'z'
     * @param {number} radians - Absolute rotation value in radians
     */
    PoseApplier.prototype.setSelectedBoneAxisState = function (boneKey, axis, radians) {
        const bone = this.rigMap.getBone(boneKey);
        if (!bone) {
            return;
        }

        if (!this.axisState[boneKey]) {
            this.axisState[boneKey] = { x: 0, y: 0, z: 0 };
        }

        this.axisState[boneKey][axis] = radians;

        const state = this.axisState[boneKey];

        // Start from neutral pose quaternion for this bone
        if (this.neutralPose && this.neutralPose[boneKey] && this.neutralPose[boneKey].q) {
            const nq = this.neutralPose[boneKey].q;
            bone.quaternion.set(nq[0], nq[1], nq[2], nq[3]);
        } else {
            bone.quaternion.identity();
        }

        // Apply Euler offset as local rotation on top of neutral
        const euler = new THREE.Euler(state.x, state.y, state.z, 'XYZ');
        const offset = new THREE.Quaternion().setFromEuler(euler);
        bone.quaternion.multiply(offset);
        bone.updateMatrixWorld(true);
    };

    PoseApplier.prototype.setBoneEuler = function (boneKey, x, y, z) {
        const bone = this.rigMap.getBone(boneKey);
        if (!bone) {
            return;
        }
        const euler = new THREE.Euler(x || 0, y || 0, z || 0, 'XYZ');
        bone.quaternion.setFromEuler(euler);
        bone.updateMatrixWorld(true);
    };

    PoseApplier.prototype.mirrorArmPose = function (fromSide) {
        if (!fromSide) {
            fromSide = 'left';
        }
        const pairs = [
            ['leftShoulder', 'rightShoulder'],
            ['leftUpperArm', 'rightUpperArm'],
            ['leftLowerArm', 'rightLowerArm'],
            ['leftHand', 'rightHand'],
        ];

        for (let i = 0; i < pairs.length; i++) {
            const leftKey = pairs[i][0];
            const rightKey = pairs[i][1];
            const sourceKey = fromSide === 'left' ? leftKey : rightKey;
            const targetKey = fromSide === 'left' ? rightKey : leftKey;
            const source = this.rigMap.getBone(sourceKey);
            const target = this.rigMap.getBone(targetKey);
            if (!source || !target) {
                continue;
            }

            target.quaternion.copy(source.quaternion);
            target.quaternion.x *= -1;
            target.quaternion.z *= -1;
            target.updateMatrixWorld(true);

            // Sync axis state for mirrored bone
            if (this.axisState[sourceKey]) {
                this.axisState[targetKey] = {
                    x: -this.axisState[sourceKey].x,
                    y: this.axisState[sourceKey].y,
                    z: -this.axisState[sourceKey].z,
                };
            }
        }
    };

    window.NEXUS_POSE_APPLIER = PoseApplier;
})();
