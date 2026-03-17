'use strict';

/**
 * PoseGizmoOverlay — Desktop mouse-based pose editing.
 * Shows visible bone handle spheres on the avatar when enabled.
 * Click a sphere → selects that bone in Pose Studio.
 * Drag a sphere → rotates the selected bone.
 * OrbitControls remain active — only bone sphere interactions are intercepted.
 *
 * Works with PoseEditor and PoseRigMap through window globals.
 *
 * Exposes: window.NEXUS_POSE_GIZMO_OVERLAY
 */
(function () {
    const THREE = window.THREE;
    if (!THREE) {
        console.warn('[PoseGizmoOverlay] THREE not found on window.');
        window.NEXUS_POSE_GIZMO_OVERLAY = { init() {}, dispose() {} };
        return;
    }

    // =========================================================================
    // BONE HANDLE DEFINITIONS
    // =========================================================================

    const BONE_HANDLE_DEFS = [
        { key: 'head', color: 0xff66cc, radius: 0.045 },
        { key: 'neck', color: 0xff88aa, radius: 0.025 },
        { key: 'chest', color: 0x66ccff, radius: 0.04 },
        { key: 'spine', color: 0x66aaff, radius: 0.035 },
        { key: 'hips', color: 0x88ff88, radius: 0.04 },
        { key: 'leftShoulder', color: 0xffcc66, radius: 0.025 },
        { key: 'rightShoulder', color: 0xffcc66, radius: 0.025 },
        { key: 'leftUpperArm', color: 0x40e0ff, radius: 0.03 },
        { key: 'rightUpperArm', color: 0x40e0ff, radius: 0.03 },
        { key: 'leftLowerArm', color: 0x40c0ff, radius: 0.025 },
        { key: 'rightLowerArm', color: 0x40c0ff, radius: 0.025 },
        { key: 'leftHand', color: 0x80ffff, radius: 0.025 },
        { key: 'rightHand', color: 0x80ffff, radius: 0.025 },
        { key: 'leftUpperLeg', color: 0x66ffaa, radius: 0.035 },
        { key: 'rightUpperLeg', color: 0x66ffaa, radius: 0.035 },
        { key: 'leftLowerLeg', color: 0x44dd88, radius: 0.028 },
        { key: 'rightLowerLeg', color: 0x44dd88, radius: 0.028 },
        { key: 'leftFoot', color: 0x88ff66, radius: 0.025 },
        { key: 'rightFoot', color: 0x88ff66, radius: 0.025 },
    ];

    // =========================================================================
    // POSE GIZMO OVERLAY
    // =========================================================================

    const PoseGizmoOverlay = {
        _enabled: false,
        _raycaster: null,
        _mouse: null,
        _camera: null,
        _renderer: null,
        _scene: null,
        _avatarMeshes: [],
        _boneNameToKey: null,

        // Bone handle spheres (boneKey → THREE.Mesh)
        _boneHandles: new Map(),

        // Drag state
        _dragging: false,
        _dragStartX: 0,
        _dragStartY: 0,
        _dragPrevX: 0,
        _dragPrevY: 0,
        _dragBoneKey: null,
        _dragBoneStartQuat: null,
        _dragSensitivity: 0.006, // Radians per pixel of drag
        _dragDeadzone: 3, // Pixels before drag begins (prevents accidental rotation on click)
        _dragStarted: false, // True once past deadzone

        // Visual feedback
        _hoverHighlight: null,
        _selectHighlight: null,

        // Bound event handlers (for cleanup)
        _onPointerDown: null,
        _onPointerMove: null,
        _onPointerUp: null,

        // Animation frame for handle position updates
        _animFrameId: null,

        init() {
            const viewer = window.NEXUS_VIEWER;
            if (!viewer) {
                console.warn('[PoseGizmoOverlay] NEXUS_VIEWER not available.');
                return;
            }

            this._renderer = viewer.renderer;
            this._camera = viewer.camera;
            this._scene = viewer.scene;

            this._raycaster = new THREE.Raycaster();
            this._mouse = new THREE.Vector2();
            this._boneNameToKey = new Map();

            // Create selection highlight (brighter ring on active bone)
            this._selectHighlight = this._createHighlight(0xff8800, 0.055);
            this._scene.add(this._selectHighlight);

            // Bind events
            const self = this;
            this._onPointerDown = function (e) {
                self._handlePointerDown(e);
            };
            this._onPointerMove = function (e) {
                self._handlePointerMove(e);
            };
            this._onPointerUp = function (e) {
                self._handlePointerUp(e);
            };

            const canvas = this._renderer.domElement;
            canvas.addEventListener('pointerdown', this._onPointerDown);
            canvas.addEventListener('pointermove', this._onPointerMove);
            canvas.addEventListener('pointerup', this._onPointerUp);

            console.log('[PoseGizmoOverlay] Desktop mouse pose editing initialized.');
        },

        enable() {
            this._enabled = true;
            this._refreshAvatarMeshes();
            this._createBoneHandles();
            this._startHandleUpdater();
            console.log('[PoseGizmoOverlay] Enabled — bone spheres visible. Click & drag to edit.');
        },

        disable() {
            this._enabled = false;
            this._dragging = false;
            this._stopHandleUpdater();
            this._removeBoneHandles();
            if (this._selectHighlight) {
                this._selectHighlight.visible = false;
            }
            this._renderer.domElement.style.cursor = '';
            console.log('[PoseGizmoOverlay] Disabled.');
        },

        isEnabled() {
            return this._enabled;
        },

        // =========================================================================
        // BONE HANDLE SPHERES
        // =========================================================================

        _createBoneHandles() {
            this._removeBoneHandles();

            const editor = window.poseEditor;
            if (!editor || !editor.rigMap) return;

            for (const def of BONE_HANDLE_DEFS) {
                const bone = editor.rigMap.getBone(def.key);
                if (!bone) continue;

                const geo = new THREE.SphereGeometry(def.radius, 14, 14);
                const mat = new THREE.MeshBasicMaterial({
                    color: def.color,
                    transparent: true,
                    opacity: 0.55,
                    depthTest: false,
                });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.renderOrder = 999;
                mesh.userData._boneHandleKey = def.key;

                // Position at bone
                const pos = new THREE.Vector3();
                bone.getWorldPosition(pos);
                mesh.position.copy(pos);

                this._scene.add(mesh);
                this._boneHandles.set(def.key, { mesh, bone, def });
            }
        },

        _removeBoneHandles() {
            for (const entry of this._boneHandles.values()) {
                entry.mesh.geometry?.dispose();
                entry.mesh.material?.dispose();
                entry.mesh.parent?.remove(entry.mesh);
            }
            this._boneHandles.clear();
        },

        _updateBoneHandlePositions() {
            for (const entry of this._boneHandles.values()) {
                if (!entry.bone) continue;
                const pos = new THREE.Vector3();
                entry.bone.getWorldPosition(pos);
                entry.mesh.position.copy(pos);
            }
        },

        _startHandleUpdater() {
            this._stopHandleUpdater();
            const self = this;
            function tick() {
                if (!self._enabled) return;
                self._updateBoneHandlePositions();
                self._animFrameId = requestAnimationFrame(tick);
            }
            self._animFrameId = requestAnimationFrame(tick);
        },

        _stopHandleUpdater() {
            if (this._animFrameId) {
                cancelAnimationFrame(this._animFrameId);
                this._animFrameId = null;
            }
        },

        // =========================================================================
        // HIGHLIGHT HELPER
        // =========================================================================

        _createHighlight(color, size) {
            const geo = new THREE.SphereGeometry(size || 0.04, 12, 12);
            const mat = new THREE.MeshBasicMaterial({
                color: color || 0x00ff88,
                transparent: true,
                opacity: 0.5,
                depthTest: false,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.visible = false;
            mesh.renderOrder = 1000;
            return mesh;
        },

        _showHighlightOnBone(highlight, boneKey) {
            if (!highlight) return;
            const editor = window.poseEditor;
            const bone = editor && editor.rigMap ? editor.rigMap.getBone(boneKey) : null;
            if (!bone) {
                highlight.visible = false;
                return;
            }
            const pos = new THREE.Vector3();
            bone.getWorldPosition(pos);
            highlight.position.copy(pos);
            highlight.visible = true;
        },

        // =========================================================================
        // AVATAR MESH + BONE LOOKUPS
        // =========================================================================

        _refreshAvatarMeshes() {
            this._avatarMeshes = [];
            if (this._boneNameToKey) this._boneNameToKey.clear();

            const root = this._getAvatarRoot();
            if (!root) return;

            root.traverse((child) => {
                if (child.isSkinnedMesh) {
                    this._avatarMeshes.push(child);
                }
            });

            this._buildBoneLookup();
        },

        _getAvatarRoot() {
            const viewer = window.NEXUS_VIEWER;
            if (viewer && viewer.avatarManager && viewer.avatarManager.currentRoot) {
                return viewer.avatarManager.currentRoot;
            }
            return null;
        },

        _buildBoneLookup() {
            const editor = window.poseEditor;
            if (editor && editor.rigMap) {
                const keys = Object.keys(editor.rigMap.bones);
                for (let i = 0; i < keys.length; i++) {
                    const key = keys[i];
                    const bone = editor.rigMap.bones[key];
                    if (bone && bone.name) {
                        this._boneNameToKey.set(bone.name, key);
                    }
                }
                return;
            }

            // Fallback: name heuristics
            const patterns = {
                head: /head/i,
                neck: /neck/i,
                chest: /chest/i,
                spine: /spine/i,
                hips: /hips|pelvis/i,
                leftUpperArm: /left.*upper.*arm|l_upper.*arm/i,
                rightUpperArm: /right.*upper.*arm|r_upper.*arm/i,
                leftLowerArm: /left.*(lower.*arm|forearm)|l_(lower.*arm|forearm)/i,
                rightLowerArm: /right.*(lower.*arm|forearm)|r_(lower.*arm|forearm)/i,
                leftHand: /left.*hand|l_hand/i,
                rightHand: /right.*hand|r_hand/i,
                leftUpperLeg: /left.*(upper.*leg|thigh)|l_(upper.*leg|thigh)/i,
                rightUpperLeg: /right.*(upper.*leg|thigh)|r_(upper.*leg|thigh)/i,
                leftLowerLeg: /left.*(lower.*leg|shin)|l_(lower.*leg|shin)/i,
                rightLowerLeg: /right.*(lower.*leg|shin)|r_(lower.*leg|shin)/i,
                leftFoot: /left.*foot|l_foot/i,
                rightFoot: /right.*foot|r_foot/i,
            };

            const root = this._getAvatarRoot();
            if (!root) return;

            const self = this;
            root.traverse((obj) => {
                if (!obj.isBone) return;
                const entries = Object.entries(patterns);
                for (let i = 0; i < entries.length; i++) {
                    const key = entries[i][0];
                    const pattern = entries[i][1];
                    if (pattern.test(obj.name) && !self._boneNameToKey.has(obj.name)) {
                        self._boneNameToKey.set(obj.name, key);
                        break;
                    }
                }
            });
        },

        // =========================================================================
        // RAYCAST BONE HANDLES
        // =========================================================================

        _updateMouseFromEvent(e) {
            const canvas = this._renderer.domElement;
            const rect = canvas.getBoundingClientRect();
            this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        },

        _raycastBoneHandles() {
            if (this._boneHandles.size === 0) return null;

            this._raycaster.setFromCamera(this._mouse, this._camera);
            const handleMeshes = [];
            for (const entry of this._boneHandles.values()) {
                handleMeshes.push(entry.mesh);
            }
            const hits = this._raycaster.intersectObjects(handleMeshes, false);
            if (hits.length === 0) return null;

            return hits[0].object.userData._boneHandleKey || null;
        },

        // =========================================================================
        // POINTER EVENT HANDLERS
        // =========================================================================

        // =====================================================================
        // OrbitControls coordination — disable during bone drag
        // =====================================================================

        _getOrbitControls() {
            const viewer = window.NEXUS_VIEWER;
            return viewer && viewer.controls ? viewer.controls : null;
        },

        _disableOrbitControls() {
            const controls = this._getOrbitControls();
            if (controls) controls.enabled = false;
        },

        _enableOrbitControls() {
            const controls = this._getOrbitControls();
            if (controls) controls.enabled = true;
        },

        // =====================================================================
        // Camera-relative rotation — project screen drag into bone-local space
        // =====================================================================

        /**
         * Compute a rotation quaternion in bone-local space from screen-space
         * drag deltas (dx, dy in pixels).
         *
         * Industry-standard approach (Blender / Unity style):
         *   1. Get camera right & up vectors (world space)
         *   2. Build a world-space rotation from screen drag mapped to those axes
         *   3. Transform into bone-local space via inverse parent world matrix
         */
        _screenDragToLocalRotation(bone, dx, dy) {
            const camRight = new THREE.Vector3();
            const camUp = new THREE.Vector3();
            this._camera.matrixWorld.extractBasis(camRight, camUp, new THREE.Vector3());

            // World-space rotation: horizontal drag → rotate around camera up,
            //                       vertical drag   → rotate around camera right
            const angle = Math.sqrt(dx * dx + dy * dy) * this._dragSensitivity;
            if (angle < 1e-6) return new THREE.Quaternion();

            // Rotation axis in world space (perpendicular to drag direction)
            const worldAxis = new THREE.Vector3().addScaledVector(camUp, dx).addScaledVector(camRight, -dy).normalize();

            const worldRot = new THREE.Quaternion().setFromAxisAngle(worldAxis, angle);

            // Transform rotation axis into bone-local space
            const parentInv = new THREE.Matrix4();
            if (bone.parent) {
                bone.parent.updateWorldMatrix(true, false);
                parentInv.copy(bone.parent.matrixWorld).invert();
            }
            const localAxis = worldAxis.clone().transformDirection(parentInv);
            return new THREE.Quaternion().setFromAxisAngle(localAxis, angle);
        },

        // =====================================================================
        // POINTER EVENT HANDLERS
        // =====================================================================

        _handlePointerDown(e) {
            if (!this._enabled) return;
            if (e.button !== 0) return;

            const editor = window.poseEditor;
            if (!editor || !editor.isActive()) return;

            this._updateMouseFromEvent(e);
            const boneKey = this._raycastBoneHandles();

            if (!boneKey) return; // Not on a bone sphere — let OrbitControls handle it

            // Select the bone
            editor.selectBone(boneKey);
            this._showHighlightOnBone(this._selectHighlight, boneKey);

            // Refresh panel if it exists
            const panel = window.poseStudioPanel;
            if (panel && panel.refresh) {
                panel.refresh();
            }

            // Start drag (for rotation)
            const bone = editor.rigMap ? editor.rigMap.getBone(boneKey) : null;
            if (bone) {
                if (editor._pushUndoSnapshot) {
                    editor._pushUndoSnapshot();
                }

                this._dragging = true;
                this._dragStarted = false;
                this._dragStartX = e.clientX;
                this._dragStartY = e.clientY;
                this._dragPrevX = e.clientX;
                this._dragPrevY = e.clientY;
                this._dragBoneKey = boneKey;
                this._dragBoneStartQuat = bone.quaternion.clone();

                // Capture pointer for reliable drag tracking outside canvas
                this._renderer.domElement.setPointerCapture(e.pointerId);

                // Disable OrbitControls so camera doesn't orbit during bone edit
                this._disableOrbitControls();

                // Set the handle to active color
                const entry = this._boneHandles.get(boneKey);
                if (entry && entry.mesh.material) {
                    entry.mesh.material.opacity = 0.9;
                    entry.mesh.material.color.setHex(0xffaa00);
                }

                this._renderer.domElement.style.cursor = 'grabbing';

                e.stopPropagation();
                e.preventDefault();
            }
        },

        _handlePointerMove(e) {
            if (!this._enabled) return;

            const editor = window.poseEditor;
            if (!editor || !editor.isActive()) return;

            // DRAG: rotate the bone while pointer is held
            if (this._dragging && this._dragBoneKey) {
                const bone = editor.rigMap ? editor.rigMap.getBone(this._dragBoneKey) : null;
                if (!bone) return;

                const totalDx = e.clientX - this._dragStartX;
                const totalDy = e.clientY - this._dragStartY;

                // Deadzone: don't rotate until the user has dragged past threshold
                if (!this._dragStarted) {
                    const dist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
                    if (dist < this._dragDeadzone) return;
                    this._dragStarted = true;
                    // Reset prev to current so first real delta is small
                    this._dragPrevX = e.clientX;
                    this._dragPrevY = e.clientY;
                    return;
                }

                // Incremental delta (from previous frame, not from start)
                // gives smoother, more predictable rotation
                const dx = e.clientX - this._dragPrevX;
                const dy = e.clientY - this._dragPrevY;
                this._dragPrevX = e.clientX;
                this._dragPrevY = e.clientY;

                if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

                // Camera-relative rotation projected into bone-local space
                const localRot = this._screenDragToLocalRotation(bone, dx, dy);
                bone.quaternion.multiply(localRot);
                bone.quaternion.normalize();
                bone.updateMatrixWorld(true);

                this._showHighlightOnBone(this._selectHighlight, this._dragBoneKey);
                return;
            }

            // HOVER: highlight bone handle under mouse
            this._updateMouseFromEvent(e);
            const boneKey = this._raycastBoneHandles();

            // Reset all handles to default appearance
            for (const entry of this._boneHandles.values()) {
                if (entry.mesh.material) {
                    entry.mesh.material.opacity = 0.55;
                    entry.mesh.material.color.setHex(entry.def.color);
                }
            }

            if (boneKey) {
                const entry = this._boneHandles.get(boneKey);
                if (entry && entry.mesh.material) {
                    entry.mesh.material.opacity = 0.85;
                    entry.mesh.material.color.setHex(0xffff66);
                }
                this._renderer.domElement.style.cursor = 'grab';
            } else {
                this._renderer.domElement.style.cursor = '';
            }
        },

        _handlePointerUp(e) {
            if (!this._enabled) return;
            if (e.button !== 0) return;

            if (this._dragging) {
                // Release pointer capture
                try {
                    this._renderer.domElement.releasePointerCapture(e.pointerId);
                } catch (_) {}

                // Re-enable OrbitControls
                this._enableOrbitControls();

                // Sync PoseApplier axis state from final bone quaternion
                this._syncAxisStateAfterDrag(this._dragBoneKey);

                // Reset the handle color
                const entry = this._boneHandles.get(this._dragBoneKey);
                if (entry && entry.mesh.material) {
                    entry.mesh.material.opacity = 0.55;
                    entry.mesh.material.color.setHex(entry.def.color);
                }

                this._renderer.domElement.style.cursor = 'grab';
                this._dragging = false;
                this._dragStarted = false;
                this._dragBoneKey = null;
                this._dragBoneStartQuat = null;

                // Emit change so panel/sliders refresh
                const editor = window.poseEditor;
                if (editor && editor._emitChange) {
                    editor._emitChange();
                }

                // Refresh panel sliders to match new bone orientation
                const panel = window.poseStudioPanel;
                if (panel && panel.refresh) {
                    panel.refresh();
                }
            }
        },

        /**
         * After a mouse drag, compute the Euler decomposition of the bone's
         * current quaternion relative to its neutral pose and write it back
         * into PoseApplier.axisState so the sliders stay in sync.
         */
        _syncAxisStateAfterDrag(boneKey) {
            const editor = window.poseEditor;
            if (!editor || !editor.applier || !boneKey) return;

            const bone = editor.rigMap ? editor.rigMap.getBone(boneKey) : null;
            if (!bone) return;

            // Compute offset from neutral
            const neutralQ = new THREE.Quaternion();
            if (editor.neutralPose && editor.neutralPose[boneKey] && editor.neutralPose[boneKey].q) {
                const nq = editor.neutralPose[boneKey].q;
                neutralQ.set(nq[0], nq[1], nq[2], nq[3]);
            }

            const offsetQ = neutralQ.clone().invert().multiply(bone.quaternion.clone());
            const euler = new THREE.Euler().setFromQuaternion(offsetQ, 'XYZ');

            if (!editor.applier.axisState) {
                editor.applier.axisState = {};
            }
            editor.applier.axisState[boneKey] = {
                x: euler.x,
                y: euler.y,
                z: euler.z,
            };
        },

        // =========================================================================
        // SKELETON LINE OVERLAY COORDINATION
        // =========================================================================

        /**
         * When SkeletonLineOverlay is active, hide our own bone handle spheres
         * to avoid double handles. Pointer events stay wired for fallback.
         *
         * @param {boolean} active - true = external handles are active, hide ours
         */
        setExternalHandlesActive(active) {
            this._externalHandlesActive = !!active;
            if (this._externalHandlesActive) {
                // Hide our spheres but keep update loop for highlight
                for (const entry of this._boneHandles.values()) {
                    entry.mesh.visible = false;
                }
                if (this._selectHighlight) {
                    this._selectHighlight.visible = false;
                }
            } else {
                // Restore sphere visibility
                for (const entry of this._boneHandles.values()) {
                    entry.mesh.visible = true;
                }
            }
        },

        // =========================================================================
        // CLEANUP
        // =========================================================================

        dispose() {
            this._enabled = false;
            this._dragging = false;
            this._stopHandleUpdater();
            this._removeBoneHandles();

            if (this._renderer) {
                const canvas = this._renderer.domElement;
                if (this._onPointerDown) {
                    canvas.removeEventListener('pointerdown', this._onPointerDown);
                }
                if (this._onPointerMove) {
                    canvas.removeEventListener('pointermove', this._onPointerMove);
                }
                if (this._onPointerUp) {
                    canvas.removeEventListener('pointerup', this._onPointerUp);
                }
            }

            if (this._selectHighlight && this._selectHighlight.parent) {
                this._selectHighlight.parent.remove(this._selectHighlight);
                this._selectHighlight.geometry.dispose();
                this._selectHighlight.material.dispose();
            }

            console.log('[PoseGizmoOverlay] Disposed.');
        },
    };

    window.NEXUS_POSE_GIZMO_OVERLAY = PoseGizmoOverlay;
})();
