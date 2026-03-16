'use strict';

/**
 * PoseGizmoOverlay — Desktop mouse-based pose editing.
 * Click on avatar body part in viewport → selects that bone in Pose Studio.
 * Drag (mouse down + move) → rotates the selected bone.
 *
 * Works with PoseEditor and PoseRigMap through window globals.
 *
 * Industry approach (same as Blender's pose mode):
 *   1) Raycast from mouse → SkinnedMesh → skin weights → find dominant bone
 *   2) Map to humanoid key via PoseRigMap
 *   3) On click: select bone (updates Pose Studio panel)
 *   4) On drag: rotate bone (X-axis = vertical drag, Y-axis = horizontal drag)
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
    // BONE HIGHLIGHT (visual feedback sphere on hovered/selected bone)
    // =========================================================================

    function createHighlight(color, size) {
        const geo = new THREE.SphereGeometry(size || 0.04, 12, 12);
        const mat = new THREE.MeshBasicMaterial({
            color: color || 0x00ff88,
            transparent: true,
            opacity: 0.5,
            depthTest: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false;
        mesh.renderOrder = 999;
        return mesh;
    }

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

        // Drag state
        _dragging: false,
        _dragStartX: 0,
        _dragStartY: 0,
        _dragBoneKey: null,
        _dragBoneStartQuat: null,
        _dragSensitivity: 0.008, // Radians per pixel of drag

        // Visual feedback
        _hoverHighlight: null,
        _selectHighlight: null,

        // Bound event handlers (for cleanup)
        _onMouseDown: null,
        _onMouseMove: null,
        _onMouseUp: null,
        _onContextMenu: null,

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

            // Create highlights
            this._hoverHighlight = createHighlight(0x00e5ff, 0.035);
            this._selectHighlight = createHighlight(0xff8800, 0.045);
            this._scene.add(this._hoverHighlight);
            this._scene.add(this._selectHighlight);

            // Bind events
            const self = this;
            this._onMouseDown = function (e) {
                self._handleMouseDown(e);
            };
            this._onMouseMove = function (e) {
                self._handleMouseMove(e);
            };
            this._onMouseUp = function (e) {
                self._handleMouseUp(e);
            };
            this._onContextMenu = function (_e) {
                // Prevent context menu during pose editing (right-click reserved for orbit)
                if (self._enabled) {
                    // Don't prevent — let orbit controls work
                }
            };

            const canvas = this._renderer.domElement;
            canvas.addEventListener('mousedown', this._onMouseDown);
            canvas.addEventListener('mousemove', this._onMouseMove);
            canvas.addEventListener('mouseup', this._onMouseUp);

            console.log('[PoseGizmoOverlay] Desktop mouse pose editing initialized.');
        },

        enable() {
            this._enabled = true;
            this._refreshAvatarMeshes();
            console.log('[PoseGizmoOverlay] Enabled — click avatar to select bones, drag to rotate.');
        },

        disable() {
            this._enabled = false;
            this._dragging = false;
            if (this._hoverHighlight) {
                this._hoverHighlight.visible = false;
            }
            if (this._selectHighlight) {
                this._selectHighlight.visible = false;
            }
            console.log('[PoseGizmoOverlay] Disabled.');
        },

        isEnabled() {
            return this._enabled;
        },

        // =========================================================================
        // AVATAR MESH + BONE LOOKUPS
        // =========================================================================

        _refreshAvatarMeshes() {
            this._avatarMeshes = [];
            this._boneNameToKey.clear();

            const root = this._getAvatarRoot();
            if (!root) {
                return;
            }

            // Collect skinned meshes
            root.traverse((child) => {
                if (child.isSkinnedMesh) {
                    this._avatarMeshes.push(child);
                }
            });

            // Build bone name → key mapping
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
            // Use PoseRigMap from the active PoseEditor if available
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
            if (!root) {
                return;
            }

            const self = this;
            root.traverse((obj) => {
                if (!obj.isBone) {
                    return;
                }
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
        // RAYCAST → FIND BONE
        // =========================================================================

        _updateMouseFromEvent(e) {
            const canvas = this._renderer.domElement;
            const rect = canvas.getBoundingClientRect();
            this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        },

        _raycastToBone() {
            if (this._avatarMeshes.length === 0) {
                return null;
            }

            this._raycaster.setFromCamera(this._mouse, this._camera);
            const hits = this._raycaster.intersectObjects(this._avatarMeshes, false);
            if (hits.length === 0) {
                return null;
            }

            return this._findBoneKeyFromHit(hits[0]);
        },

        /**
         * Given a raycast hit, find the humanoid bone key via skin weights.
         * Same algorithm as VRBoneGrabber (walk skin weights → find dominant bone → map to key).
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

            let bestBoneIndex = -1;
            let bestWeight = -1;

            const verts = [face.a, face.b, face.c];
            for (let v = 0; v < verts.length; v++) {
                const vertIdx = verts[v];
                for (let i = 0; i < 4; i++) {
                    const w = skinWeight.getComponent(vertIdx, i);
                    if (w > bestWeight) {
                        bestWeight = w;
                        bestBoneIndex = skinIndex.getComponent(vertIdx, i);
                    }
                }
            }

            if (bestBoneIndex < 0 || !mesh.skeleton.bones[bestBoneIndex]) {
                return null;
            }

            // Walk up bone hierarchy to find a mapped key
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
        },

        // =========================================================================
        // VISUAL FEEDBACK
        // =========================================================================

        _showHighlightOnBone(highlight, boneKey) {
            if (!highlight) {
                return;
            }
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
        // MOUSE EVENT HANDLERS
        // =========================================================================

        _handleMouseDown(e) {
            if (!this._enabled) {
                return;
            }
            // Only handle left mouse button (0)
            if (e.button !== 0) {
                return;
            }

            const editor = window.poseEditor;
            if (!editor || !editor.isActive()) {
                return;
            }

            this._updateMouseFromEvent(e);
            const boneKey = this._raycastToBone();

            if (!boneKey) {
                return;
            }

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
                // Push undo before we start modifying
                if (editor._pushUndoSnapshot) {
                    editor._pushUndoSnapshot();
                }

                this._dragging = true;
                this._dragStartX = e.clientX;
                this._dragStartY = e.clientY;
                this._dragBoneKey = boneKey;
                this._dragBoneStartQuat = bone.quaternion.clone();

                // Prevent orbit controls from interfering during bone drag
                e.stopPropagation();
            }
        },

        _handleMouseMove(e) {
            if (!this._enabled) {
                return;
            }

            const editor = window.poseEditor;
            if (!editor || !editor.isActive()) {
                return;
            }

            // DRAG: rotate the bone while mouse is held
            if (this._dragging && this._dragBoneKey) {
                const bone = editor.rigMap ? editor.rigMap.getBone(this._dragBoneKey) : null;
                if (!bone) {
                    return;
                }

                const dx = e.clientX - this._dragStartX;
                const dy = e.clientY - this._dragStartY;

                // Horizontal drag → Y-axis rotation, Vertical drag → X-axis rotation
                const rotX = new THREE.Quaternion().setFromAxisAngle(
                    new THREE.Vector3(1, 0, 0),
                    dy * this._dragSensitivity
                );
                const rotY = new THREE.Quaternion().setFromAxisAngle(
                    new THREE.Vector3(0, 1, 0),
                    dx * this._dragSensitivity
                );

                // Apply: startQuat * rotY * rotX (Y first so horizontal feels natural)
                bone.quaternion.copy(this._dragBoneStartQuat).multiply(rotY).multiply(rotX);
                bone.updateMatrixWorld(true);

                // Update highlight position
                this._showHighlightOnBone(this._selectHighlight, this._dragBoneKey);

                return;
            }

            // HOVER: show hover highlight on bone under mouse
            this._updateMouseFromEvent(e);
            const boneKey = this._raycastToBone();

            if (boneKey) {
                this._showHighlightOnBone(this._hoverHighlight, boneKey);
                this._renderer.domElement.style.cursor = 'pointer';
            } else {
                if (this._hoverHighlight) {
                    this._hoverHighlight.visible = false;
                }
                this._renderer.domElement.style.cursor = '';
            }
        },

        _handleMouseUp(e) {
            if (!this._enabled) {
                return;
            }
            if (e.button !== 0) {
                return;
            }

            if (this._dragging) {
                this._dragging = false;
                this._dragBoneKey = null;
                this._dragBoneStartQuat = null;

                // Emit change so panel refreshes
                const editor = window.poseEditor;
                if (editor && editor._emitChange) {
                    editor._emitChange();
                }
            }
        },

        // =========================================================================
        // CLEANUP
        // =========================================================================

        dispose() {
            this._enabled = false;
            this._dragging = false;

            if (this._renderer) {
                const canvas = this._renderer.domElement;
                if (this._onMouseDown) {
                    canvas.removeEventListener('mousedown', this._onMouseDown);
                }
                if (this._onMouseMove) {
                    canvas.removeEventListener('mousemove', this._onMouseMove);
                }
                if (this._onMouseUp) {
                    canvas.removeEventListener('mouseup', this._onMouseUp);
                }
            }

            if (this._hoverHighlight && this._hoverHighlight.parent) {
                this._hoverHighlight.parent.remove(this._hoverHighlight);
                this._hoverHighlight.geometry.dispose();
                this._hoverHighlight.material.dispose();
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
