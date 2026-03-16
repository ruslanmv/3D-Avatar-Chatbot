/**
 * VRBoneGrabber — Direct VR bone manipulation via controller grab
 * ================================================================
 * Lets users physically reach out, grip a body part (hand, arm, head, etc.),
 * and move it by rotating the corresponding skeleton bone.
 *
 * Industry-standard approach:
 *   1) Raycast from controller to find which mesh the user is pointing at
 *   2) Walk the mesh ancestry to find the nearest skinned bone
 *   3) Map that bone back to a humanoid bone key via PoseRigMap
 *   4) On grip hold, track controller rotation delta and apply to the bone
 *   5) On grip release, commit the change (undo-able via PoseEditor)
 *
 * Non-destructive: purely additive module. Works alongside VRControllers.
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

export class VRBoneGrabber {
    constructor({ scene, renderer }) {
        this.scene = scene;
        this.renderer = renderer;

        this.enabled = false;
        this.avatarRoot = null;
        this.avatarMeshes = []; // SkinnedMesh list for raycasting

        // Pose editing references (set via setPoseEditor)
        this.poseEditor = null;

        // VRPoseSystem reference for IK solving (set via setPoseSystem)
        this.poseSystem = null;
        this._usingIK = false; // true when current grab is using IK instead of direct rotation

        // Grab state
        this._grabbing = false;
        this._grabbedBoneKey = null;
        this._grabStartQuat = new THREE.Quaternion();
        this._controllerStartQuat = new THREE.Quaternion();

        // Raycaster
        this._raycaster = new THREE.Raycaster();
        this._tempMatrix = new THREE.Matrix4();

        // Visual feedback: highlight sphere on grabbed bone
        this._highlightSphere = null;
        this._createHighlight();

        // Bone name → humanoid key reverse lookup (built on setAvatar)
        this._boneNameToKey = new Map();
    }

    // =========================================================================
    // SETUP
    // =========================================================================

    /**
     * Set the avatar root and build mesh + bone lookups.
     * @param {THREE.Object3D} root
     */
    setAvatar(root) {
        this.avatarRoot = root;
        this.avatarMeshes = [];
        this._boneNameToKey.clear();

        if (!root) {
            return;
        }

        // Collect all skinned meshes for raycasting
        root.traverse((child) => {
            if (child.isSkinnedMesh) {
                this.avatarMeshes.push(child);
            }
        });

        // Build reverse lookup: bone.name → humanoid key
        this._buildBoneReverseLookup();

        console.log(
            `[VRBoneGrabber] Avatar set: ${this.avatarMeshes.length} meshes, ${this._boneNameToKey.size} bone mappings`
        );
    }

    /**
     * Connect to the PoseEditor for undo support and bone rotation.
     * @param {object} editor - window.poseEditor instance
     */
    setPoseEditor(editor) {
        this.poseEditor = editor;
    }

    /**
     * Connect to VRPoseSystem for IK-based bone manipulation.
     * @param {import('./VRPoseSystem.js').VRPoseSystem} system
     */
    setPoseSystem(system) {
        this.poseSystem = system;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(
            `[VRBoneGrabber] ${enabled ? 'Enabled' : 'Disabled'} (avatar=${!!this.avatarRoot}, meshes=${this.avatarMeshes.length}, bones=${this._boneNameToKey.size})`
        );
        if (!enabled) {
            this._endBoneGrab();
        }
    }

    // =========================================================================
    // BONE LOOKUP
    // =========================================================================

    /**
     * Build reverse map from THREE.Bone.name → humanoid key.
     * Uses PoseRigMap if available, otherwise falls back to name heuristics.
     */
    _buildBoneReverseLookup() {
        this._boneNameToKey.clear();

        // Standard humanoid bone keys
        const BONE_KEYS = [
            'hips',
            'spine',
            'chest',
            'upperChest',
            'neck',
            'head',
            'leftShoulder',
            'rightShoulder',
            'leftUpperArm',
            'rightUpperArm',
            'leftLowerArm',
            'rightLowerArm',
            'leftHand',
            'rightHand',
            'leftUpperLeg',
            'rightUpperLeg',
            'leftLowerLeg',
            'rightLowerLeg',
            'leftFoot',
            'rightFoot',
        ];

        // Try PoseRigMap first (uses VRM humanoid API or name heuristics)
        const RigMapClass = window.NEXUS_POSE_RIG_MAP;
        if (RigMapClass && this.avatarRoot) {
            try {
                const humanoid = this.avatarRoot.userData?.vrmHumanoid || null;
                const rigMap = new RigMapClass({ root: this.avatarRoot, vrmHumanoid: humanoid });

                for (const key of BONE_KEYS) {
                    const bone = rigMap.getBone(key);
                    if (bone && bone.name) {
                        this._boneNameToKey.set(bone.name, key);
                    }
                }
                return;
            } catch (e) {
                console.warn('[VRBoneGrabber] PoseRigMap failed, using fallback:', e);
            }
        }

        // Fallback: traverse skeleton and match common bone names
        const NAME_PATTERNS = {
            head: /head/i,
            neck: /neck/i,
            spine: /spine/i,
            chest: /chest/i,
            hips: /hips|pelvis/i,
            leftUpperArm: /left.*upper.*arm|l_upper.*arm/i,
            rightUpperArm: /right.*upper.*arm|r_upper.*arm/i,
            leftLowerArm: /left.*lower.*arm|l_lower.*arm|left.*forearm/i,
            rightLowerArm: /right.*lower.*arm|r_lower.*arm|right.*forearm/i,
            leftHand: /left.*hand|l_hand/i,
            rightHand: /right.*hand|r_hand/i,
            leftUpperLeg: /left.*upper.*leg|l_upper.*leg|left.*thigh/i,
            rightUpperLeg: /right.*upper.*leg|r_upper.*leg|right.*thigh/i,
            leftLowerLeg: /left.*lower.*leg|l_lower.*leg|left.*shin/i,
            rightLowerLeg: /right.*lower.*leg|r_lower.*leg|right.*shin/i,
            leftFoot: /left.*foot|l_foot/i,
            rightFoot: /right.*foot|r_foot/i,
        };

        this.avatarRoot.traverse((obj) => {
            if (!obj.isBone) {
                return;
            }
            const name = obj.name;
            for (const [key, pattern] of Object.entries(NAME_PATTERNS)) {
                if (pattern.test(name) && !this._boneNameToKey.has(name)) {
                    this._boneNameToKey.set(name, key);
                    break;
                }
            }
        });
    }

    /**
     * Given a raycast hit on a SkinnedMesh, find the nearest humanoid bone key.
     * Strategy: check skinning weights at the hit vertex to find the dominant bone.
     * @param {THREE.Intersection} hit
     * @returns {string|null} humanoid bone key
     */
    _findBoneKeyFromHit(hit) {
        const mesh = hit.object;
        if (!mesh.isSkinnedMesh || !mesh.skeleton) {
            return null;
        }

        const face = hit.face;
        if (!face) {
            return null;
        }

        const geometry = mesh.geometry;
        const skinIndex = geometry.getAttribute('skinIndex');
        const skinWeight = geometry.getAttribute('skinWeight');
        if (!skinIndex || !skinWeight) {
            return null;
        }

        // Check all 3 vertices of the hit triangle, find the bone with highest weight
        // Three.js 0.147: BufferAttribute uses getX/getY/getZ/getW (not getComponent)
        let bestBoneIndex = -1;
        let bestWeight = -1;

        const getComp = (attr, idx, comp) => {
            if (comp === 0) {
                return attr.getX(idx);
            }
            if (comp === 1) {
                return attr.getY(idx);
            }
            if (comp === 2) {
                return attr.getZ(idx);
            }
            return attr.getW(idx);
        };

        for (const vertIdx of [face.a, face.b, face.c]) {
            for (let i = 0; i < 4; i++) {
                const w = getComp(skinWeight, vertIdx, i);
                if (w > bestWeight) {
                    bestWeight = w;
                    bestBoneIndex = getComp(skinIndex, vertIdx, i);
                }
            }
        }

        if (bestBoneIndex < 0 || !mesh.skeleton.bones[bestBoneIndex]) {
            return null;
        }

        // Walk up the bone hierarchy to find a mapped humanoid bone
        let bone = mesh.skeleton.bones[bestBoneIndex];
        let depth = 0;
        while (bone && depth < 6) {
            const key = this._boneNameToKey.get(bone.name);
            if (key) {
                return key;
            }
            bone = bone.parent;
            depth++;
        }

        return null;
    }

    // =========================================================================
    // VISUAL FEEDBACK
    // =========================================================================

    _createHighlight() {
        const geo = new THREE.SphereGeometry(0.06, 16, 16);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x00ff88,
            transparent: true,
            opacity: 0.5,
            depthTest: false,
        });
        this._highlightSphere = new THREE.Mesh(geo, mat);
        this._highlightSphere.visible = false;
        this._highlightSphere.renderOrder = 999;
    }

    _showHighlight(bone) {
        if (!this._highlightSphere.parent) {
            this.scene.add(this._highlightSphere);
        }
        const pos = new THREE.Vector3();
        bone.getWorldPosition(pos);
        this._highlightSphere.position.copy(pos);
        this._highlightSphere.visible = true;
    }

    _hideHighlight() {
        this._highlightSphere.visible = false;
    }

    // =========================================================================
    // GRAB LOGIC
    // =========================================================================

    /**
     * Attempt to grab a bone at the point the controller is aiming at.
     * Called from VRControllers on grip down.
     * @param {THREE.Object3D} controller
     * @returns {boolean} true if a bone was grabbed (caller should not process further)
     */
    tryGrab(controller) {
        if (!this.enabled || !this.avatarRoot || this.avatarMeshes.length === 0) {
            console.log('[VRBoneGrabber] tryGrab BLOCKED:', {
                enabled: this.enabled,
                hasRoot: !!this.avatarRoot,
                meshCount: this.avatarMeshes.length,
            });
            return false;
        }

        // Raycast from controller
        this._tempMatrix.identity().extractRotation(controller.matrixWorld);
        this._raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._tempMatrix);

        const hits = this._raycaster.intersectObjects(this.avatarMeshes, false);
        if (hits.length === 0) {
            console.log('[VRBoneGrabber] tryGrab: raycast missed avatar (0 hits)');
            return false;
        }

        const boneKey = this._findBoneKeyFromHit(hits[0]);
        if (!boneKey) {
            console.log('[VRBoneGrabber] tryGrab: hit mesh but could not resolve bone key');
            return false;
        }

        console.log(`[VRBoneGrabber] tryGrab: found bone key "${boneKey}"`);

        // Activate PoseEditor if available and not already active
        if (this.poseEditor && !this.poseEditor.isActive()) {
            this.poseEditor.enter();
        }

        // Select the bone in editor (for undo support)
        if (this.poseEditor) {
            this.poseEditor.selectBone(boneKey);
        }

        // Resolve the actual THREE.Bone — try multiple strategies
        let bone = null;

        // Strategy 1: PoseEditor rigMap (most reliable for VRM)
        if (this.poseEditor && this.poseEditor.rigMap) {
            bone = this.poseEditor.rigMap.getBone(boneKey);
        }

        // Strategy 2: VRPoseSystem's bone map (available even without PoseEditor)
        if (!bone && this.poseSystem && this.poseSystem._bones) {
            bone = this.poseSystem._bones.get(boneKey) || null;
        }

        // Strategy 3: Direct skeleton traversal using our reverse lookup
        if (!bone) {
            bone = this._resolveBoneFromSkeleton(boneKey);
        }

        if (!bone) {
            console.warn(`[VRBoneGrabber] tryGrab: could not resolve THREE.Bone for "${boneKey}"`);
            return false;
        }

        console.log(`[VRBoneGrabber] tryGrab: resolved bone "${bone.name}" for key "${boneKey}"`);

        // Try IK-based manipulation first (grab hand → whole arm follows)
        this._usingIK = false;
        if (this.poseSystem && this.poseSystem.ikEnabled) {
            console.log(`[VRBoneGrabber] Attempting IK for "${boneKey}"...`);
            if (this.poseSystem.startIK(boneKey, controller)) {
                this._grabbing = true;
                this._grabbedBoneKey = boneKey;
                this._usingIK = true;
                this._showHighlight(bone);
                console.log(`[VRBoneGrabber] Grabbed (IK): ${boneKey}`);
                return true;
            }
            console.log(`[VRBoneGrabber] IK not available for "${boneKey}", falling back to direct rotation`);
        }

        // Fallback: direct quaternion rotation (single bone)
        this._grabbing = true;
        this._grabbedBoneKey = boneKey;
        this._grabStartQuat.copy(bone.quaternion);

        // Store controller's world rotation at grab start
        controller.getWorldQuaternion(this._controllerStartQuat);

        this._showHighlight(bone);

        console.log(`[VRBoneGrabber] Grabbed (direct): ${boneKey}`);
        return true;
    }

    /**
     * Resolve a bone from skeleton by walking avatar root's bone hierarchy.
     * Used as fallback when PoseEditor and VRPoseSystem are not available.
     * @param {string} boneKey
     * @returns {THREE.Bone|null}
     */
    _resolveBoneFromSkeleton(boneKey) {
        // First: check if any of our meshes have a skeleton with this bone
        for (const mesh of this.avatarMeshes) {
            if (!mesh.skeleton) {
                continue;
            }
            for (const bone of mesh.skeleton.bones) {
                if (this._boneNameToKey.get(bone.name) === boneKey) {
                    return bone;
                }
            }
        }

        // Second: traverse avatar root
        let found = null;
        if (this.avatarRoot) {
            this.avatarRoot.traverse((obj) => {
                if (!found && obj.isBone && this._boneNameToKey.get(obj.name) === boneKey) {
                    found = obj;
                }
            });
        }
        return found;
    }

    /**
     * Update bone rotation while grip is held.
     * Called each frame from VRControllers update loop.
     * @param {THREE.Object3D} controller
     */
    updateGrab(controller) {
        if (!this._grabbing || !this._grabbedBoneKey) {
            return;
        }

        // IK mode: VRPoseSystem handles the solving
        if (this._usingIK && this.poseSystem) {
            this.poseSystem.updateIK();
            // Update highlight on the end-effector bone
            const bone = this._resolveBone(this._grabbedBoneKey);
            if (bone) {
                this._showHighlight(bone);
            }
            return;
        }

        // Direct rotation mode — resolve bone via multiple strategies
        let bone = null;
        if (this.poseEditor?.rigMap) {
            bone = this.poseEditor.rigMap.getBone(this._grabbedBoneKey);
        }
        if (!bone && this.poseSystem?._bones) {
            bone = this.poseSystem._bones.get(this._grabbedBoneKey) || null;
        }
        if (!bone) {
            bone = this._resolveBoneFromSkeleton(this._grabbedBoneKey);
        }
        if (!bone) {
            return;
        }

        // Get current controller world rotation
        const currentControllerQuat = new THREE.Quaternion();
        controller.getWorldQuaternion(currentControllerQuat);

        // Compute rotation delta from grab start
        const invStart = this._controllerStartQuat.clone().invert();
        const deltaQuat = currentControllerQuat.clone().multiply(invStart);

        // Convert world-space delta to bone's local space
        // Get bone's parent world rotation to transform the delta
        const parentWorldQuat = new THREE.Quaternion();
        if (bone.parent) {
            bone.parent.getWorldQuaternion(parentWorldQuat);
        }
        const invParentQuat = parentWorldQuat.clone().invert();

        // localDelta = invParent * worldDelta * parent
        const localDelta = invParentQuat.clone().multiply(deltaQuat).multiply(parentWorldQuat);

        // Apply: newRot = localDelta * startRot
        bone.quaternion.copy(localDelta).multiply(this._grabStartQuat);

        // Update highlight position
        this._showHighlight(bone);
    }

    /**
     * Resolve a bone reference from key using available systems.
     * @param {string} key
     * @returns {THREE.Bone|null}
     */
    _resolveBone(key) {
        if (this.poseEditor?.rigMap) {
            return this.poseEditor.rigMap.getBone(key) || null;
        }
        // Fallback: search avatar root
        let found = null;
        if (this.avatarRoot) {
            this.avatarRoot.traverse((obj) => {
                if (!found && obj.isBone && this._boneNameToKey.get(obj.name) === key) {
                    found = obj;
                }
            });
        }
        return found;
    }

    /**
     * Release the grabbed bone.
     * Called from VRControllers on grip up.
     */
    endGrab() {
        this._endBoneGrab();
    }

    _endBoneGrab() {
        if (!this._grabbing) {
            return;
        }

        // End IK if it was active
        if (this._usingIK && this.poseSystem) {
            this.poseSystem.endIK();
        }

        console.log(`[VRBoneGrabber] Released: ${this._grabbedBoneKey}`);

        this._grabbing = false;
        this._grabbedBoneKey = null;
        this._usingIK = false;
        this._hideHighlight();
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /** @returns {boolean} whether a bone is currently being grabbed */
    isGrabbing() {
        return this._grabbing;
    }

    dispose() {
        this._endBoneGrab();
        if (this._highlightSphere?.parent) {
            this._highlightSphere.parent.remove(this._highlightSphere);
        }
        this._highlightSphere?.geometry?.dispose();
        this._highlightSphere?.material?.dispose();
        this.avatarMeshes = [];
        this._boneNameToKey.clear();
    }
}
