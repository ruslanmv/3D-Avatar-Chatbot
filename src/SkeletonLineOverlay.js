'use strict';

/**
 * SkeletonLineOverlay — Professional skeleton-line rig editor.
 *
 * Renders the full humanoid skeleton as connected bone lines with joint
 * handle spheres. Users can grab lines to rotate the child bone (FK editing).
 *
 * Features:
 *   - Full skeleton topology with color-coded bone groups
 *   - Line grab interaction: drag a line to rotate the child bone
 *   - Joint spheres: hover-only (default) or always-visible (toggle)
 *   - Camera-relative rotation projected into bone-local space
 *   - Coordinates with PoseGizmoOverlay to avoid double handles
 *
 * Industry references: VRoid Studio, Live2D Cubism, Blender Rigify, Spine.
 *
 * Exposes: window.NEXUS_SKELETON_LINE_OVERLAY
 */
(function () {
    var THREE = window.THREE;
    if (!THREE) {
        console.warn('[SkeletonLineOverlay] THREE not found on window.');
        window.NEXUS_SKELETON_LINE_OVERLAY = { init: function () {}, dispose: function () {} };
        return;
    }

    // =========================================================================
    // SKELETON TOPOLOGY — directed edges defining bone connections
    // =========================================================================

    var SKELETON_TOPOLOGY = [
        // Spine chain
        { from: 'hips', to: 'spine', group: 'spine' },
        { from: 'spine', to: 'chest', group: 'spine' },
        { from: 'chest', to: 'neck', group: 'spine' },
        { from: 'neck', to: 'head', group: 'head' },

        // Left arm chain
        { from: 'chest', to: 'leftShoulder', group: 'leftArm' },
        { from: 'leftShoulder', to: 'leftUpperArm', group: 'leftArm' },
        { from: 'leftUpperArm', to: 'leftLowerArm', group: 'leftArm' },
        { from: 'leftLowerArm', to: 'leftHand', group: 'leftArm' },

        // Right arm chain
        { from: 'chest', to: 'rightShoulder', group: 'rightArm' },
        { from: 'rightShoulder', to: 'rightUpperArm', group: 'rightArm' },
        { from: 'rightUpperArm', to: 'rightLowerArm', group: 'rightArm' },
        { from: 'rightLowerArm', to: 'rightHand', group: 'rightArm' },

        // Left leg chain
        { from: 'hips', to: 'leftUpperLeg', group: 'leftLeg' },
        { from: 'leftUpperLeg', to: 'leftLowerLeg', group: 'leftLeg' },
        { from: 'leftLowerLeg', to: 'leftFoot', group: 'leftLeg' },

        // Right leg chain
        { from: 'hips', to: 'rightUpperLeg', group: 'rightLeg' },
        { from: 'rightUpperLeg', to: 'rightLowerLeg', group: 'rightLeg' },
        { from: 'rightLowerLeg', to: 'rightFoot', group: 'rightLeg' },
    ];

    // =========================================================================
    // COLOR PALETTE — anime industry standard bone group coloring
    // =========================================================================

    var GROUP_COLORS = {
        spine: { base: 0x6699ff, hover: 0xffdd44, active: 0xff8800 },
        head: { base: 0xff66cc, hover: 0xffdd44, active: 0xff8800 },
        leftArm: { base: 0x40e0ff, hover: 0xffdd44, active: 0xff8800 },
        rightArm: { base: 0x40e0ff, hover: 0xffdd44, active: 0xff8800 },
        leftLeg: { base: 0x66ffaa, hover: 0xffdd44, active: 0xff8800 },
        rightLeg: { base: 0x66ffaa, hover: 0xffdd44, active: 0xff8800 },
    };

    // Joint sphere definitions — reuses PoseGizmoOverlay colors for consistency
    var JOINT_DEFS = {
        head: { color: 0xff66cc, radius: 0.035 },
        neck: { color: 0xff88aa, radius: 0.02 },
        chest: { color: 0x66ccff, radius: 0.032 },
        spine: { color: 0x66aaff, radius: 0.028 },
        hips: { color: 0x88ff88, radius: 0.032 },
        leftShoulder: { color: 0xffcc66, radius: 0.02 },
        rightShoulder: { color: 0xffcc66, radius: 0.02 },
        leftUpperArm: { color: 0x40e0ff, radius: 0.024 },
        rightUpperArm: { color: 0x40e0ff, radius: 0.024 },
        leftLowerArm: { color: 0x40c0ff, radius: 0.02 },
        rightLowerArm: { color: 0x40c0ff, radius: 0.02 },
        leftHand: { color: 0x80ffff, radius: 0.02 },
        rightHand: { color: 0x80ffff, radius: 0.02 },
        leftUpperLeg: { color: 0x66ffaa, radius: 0.028 },
        rightUpperLeg: { color: 0x66ffaa, radius: 0.028 },
        leftLowerLeg: { color: 0x44dd88, radius: 0.022 },
        rightLowerLeg: { color: 0x44dd88, radius: 0.022 },
        leftFoot: { color: 0x88ff66, radius: 0.02 },
        rightFoot: { color: 0x88ff66, radius: 0.02 },
    };

    // =========================================================================
    // SKELETON LINE OVERLAY
    // =========================================================================

    var SkeletonLineOverlay = {
        _enabled: false,
        _camera: null,
        _renderer: null,
        _scene: null,

        // Edge data: array of { from, to, group, line, material }
        _edges: [],

        // Joint sphere data: Map<boneKey, { mesh, material, def }>
        _joints: new Map(),

        // Display mode
        _handlesAlwaysVisible: false,

        // Hover state
        _hoveredEdgeIndex: -1,
        _hoveredJointKey: null,

        // Drag state
        _dragging: false,
        _dragStarted: false,
        _dragEdgeIndex: -1,
        _dragBoneKey: null,
        _dragStartX: 0,
        _dragStartY: 0,
        _dragPrevX: 0,
        _dragPrevY: 0,
        _dragDeadzone: 3,
        _dragSensitivity: 0.006,

        // Raycaster for sphere picking
        _raycaster: null,
        _mouse: null,

        // Selection highlight
        _selectHighlight: null,
        _selectedBoneKey: null,

        // Bound handlers
        _onPointerDown: null,
        _onPointerMove: null,
        _onPointerUp: null,

        // Animation frame
        _animFrameId: null,

        // Line hit radius in pixels
        _lineHitRadius: 18,

        // Lifecycle hardening (fixes enable→disable→enable dead state)
        _ctxReady: false,
        _activePointerId: null,

        // Puppet Mode drag state
        _dragMode: 'rotate',
        _dragAnchorWorld: null,
        _dragChangedKeys: null,
        _dragFrameOffset: null,

        // =====================================================================
        // LIFECYCLE
        // =====================================================================

        init: function () {
            // NEXUS_VIEWER is created by an async module import and is often
            // NOT ready when this runs — acquire lazily, retry from enable().
            if (!this._ensureContext()) {
                var self = this;
                var ready = window.__NEXUS_VIEWER_READY__;
                if (ready && typeof ready.then === 'function') {
                    ready.then(function () {
                        self._ensureContext();
                    });
                }
            }
        },

        /**
         * Acquire renderer/camera/scene and bind pointer listeners exactly
         * once. Safe to call repeatedly; returns readiness.
         */
        _ensureContext: function () {
            if (this._ctxReady) return true;
            var viewer = window.NEXUS_VIEWER;
            if (!viewer || !viewer.renderer || !viewer.camera || !viewer.scene) {
                return false;
            }

            this._renderer = viewer.renderer;
            this._camera = viewer.camera;
            this._scene = viewer.scene;
            this._raycaster = new THREE.Raycaster();
            this._mouse = new THREE.Vector2();

            // Selection highlight ring
            this._selectHighlight = this._createHighlightMesh(0xff8800, 0.045);
            this._scene.add(this._selectHighlight);

            // Restore toggle state from localStorage
            try {
                var saved = localStorage.getItem('poseStudio_handlesVisible');
                if (saved === 'true') {
                    this._handlesAlwaysVisible = true;
                }
            } catch (_) {}

            // Bind events
            var self = this;
            this._onPointerDown = function (e) {
                self._handlePointerDown(e);
            };
            this._onPointerMove = function (e) {
                self._handlePointerMove(e);
            };
            this._onPointerUp = function (e) {
                self._handlePointerUp(e);
            };

            var canvas = this._renderer.domElement;
            canvas.addEventListener('pointerdown', this._onPointerDown);
            canvas.addEventListener('pointermove', this._onPointerMove);
            canvas.addEventListener('pointerup', this._onPointerUp);

            this._ctxReady = true;
            console.log('[SkeletonLineOverlay] Initialized.');
            return true;
        },

        /**
         * Always restore camera controls + pointer capture, even when the
         * overlay is toggled off (or the editor exits) mid-drag.
         */
        _endDragCleanup: function () {
            if (this._activePointerId != null && this._renderer) {
                try {
                    this._renderer.domElement.releasePointerCapture(this._activePointerId);
                } catch (_) {}
            }
            if (this._dragging) {
                this._enableOrbitControls();
            }
            this._dragging = false;
            this._dragStarted = false;
            this._dragEdgeIndex = -1;
            this._dragBoneKey = null;
            this._dragAnchorWorld = null;
            this._dragChangedKeys = null;
            this._dragFrameOffset = null;
            this._activePointerId = null;
        },

        enable: function () {
            if (!this._ensureContext()) {
                console.warn('[SkeletonLineOverlay] Viewer not ready yet — try again in a moment.');
                return false;
            }
            // Rebind the editor if the avatar was switched while we were off.
            var editorRef = window.poseEditor;
            if (editorRef && editorRef.rebindIfStale) editorRef.rebindIfStale();

            this._enabled = true;
            this._createEdges();
            this._createJoints();
            this._startUpdater();

            // Disable PoseGizmoOverlay spheres to avoid double handles
            var gizmo = window.NEXUS_POSE_GIZMO_OVERLAY;
            if (gizmo && gizmo.isEnabled && gizmo.isEnabled()) {
                gizmo.setExternalHandlesActive(true);
            }

            console.log('[SkeletonLineOverlay] Enabled — skeleton lines visible.');
            return true;
        },

        disable: function () {
            this._enabled = false;
            this._endDragCleanup();
            this._hoveredEdgeIndex = -1;
            this._hoveredJointKey = null;
            this._stopUpdater();
            this._removeEdges();
            this._removeJoints();

            if (this._selectHighlight) {
                this._selectHighlight.visible = false;
            }
            if (this._renderer) {
                this._renderer.domElement.style.cursor = '';
            }

            // Re-enable PoseGizmoOverlay spheres
            var gizmo = window.NEXUS_POSE_GIZMO_OVERLAY;
            if (gizmo && gizmo.setExternalHandlesActive) {
                gizmo.setExternalHandlesActive(false);
            }

            console.log('[SkeletonLineOverlay] Disabled.');
        },

        isEnabled: function () {
            return this._enabled;
        },

        // =====================================================================
        // HANDLE VISIBILITY TOGGLE
        // =====================================================================

        setHandlesAlwaysVisible: function (visible) {
            this._handlesAlwaysVisible = !!visible;
            try {
                localStorage.setItem('poseStudio_handlesVisible', this._handlesAlwaysVisible ? 'true' : 'false');
            } catch (_) {}

            // Immediately update joint opacity
            this._updateJointVisibility();
        },

        getHandlesAlwaysVisible: function () {
            return this._handlesAlwaysVisible;
        },

        toggleHandlesVisible: function () {
            this.setHandlesAlwaysVisible(!this._handlesAlwaysVisible);
            return this._handlesAlwaysVisible;
        },

        // =====================================================================
        // EDGE (LINE) CREATION
        // =====================================================================

        _createEdges: function () {
            this._removeEdges();

            var editor = window.poseEditor;
            if (!editor || !editor.rigMap) return;

            for (var i = 0; i < SKELETON_TOPOLOGY.length; i++) {
                var topo = SKELETON_TOPOLOGY[i];
                // Visual bones: RAW rendered skeleton — the write rig can be a
                // normalized proxy whose world positions ignore animations,
                // which made the lines float away from the body.
                var fromBone = editor.rigMap.getVisualBone
                    ? editor.rigMap.getVisualBone(topo.from)
                    : editor.rigMap.getBone(topo.from);
                var toBone = editor.rigMap.getVisualBone
                    ? editor.rigMap.getVisualBone(topo.to)
                    : editor.rigMap.getBone(topo.to);
                if (!fromBone || !toBone) continue;

                var colors = GROUP_COLORS[topo.group] || GROUP_COLORS.spine;

                var positions = new Float32Array(6); // 2 vertices x 3 components
                var geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

                var material = new THREE.LineBasicMaterial({
                    color: colors.base,
                    transparent: true,
                    opacity: 0.5,
                    depthTest: false,
                    linewidth: 2,
                });

                var line = new THREE.Line(geometry, material);
                line.renderOrder = 997;
                line.frustumCulled = false;

                this._scene.add(line);

                this._edges.push({
                    from: topo.from,
                    to: topo.to,
                    group: topo.group,
                    fromBone: fromBone,
                    toBone: toBone,
                    line: line,
                    material: material,
                    geometry: geometry,
                    colors: colors,
                });
            }
        },

        _removeEdges: function () {
            for (var i = 0; i < this._edges.length; i++) {
                var edge = this._edges[i];
                edge.geometry.dispose();
                edge.material.dispose();
                if (edge.line.parent) edge.line.parent.remove(edge.line);
            }
            this._edges = [];
        },

        // =====================================================================
        // JOINT (SPHERE) CREATION
        // =====================================================================

        _createJoints: function () {
            this._removeJoints();

            var editor = window.poseEditor;
            if (!editor || !editor.rigMap) return;

            // Collect unique bone keys from topology
            var uniqueKeys = {};
            for (var i = 0; i < SKELETON_TOPOLOGY.length; i++) {
                uniqueKeys[SKELETON_TOPOLOGY[i].from] = true;
                uniqueKeys[SKELETON_TOPOLOGY[i].to] = true;
            }

            var keys = Object.keys(uniqueKeys);
            for (var k = 0; k < keys.length; k++) {
                var boneKey = keys[k];
                var bone = editor.rigMap.getVisualBone
                    ? editor.rigMap.getVisualBone(boneKey)
                    : editor.rigMap.getBone(boneKey);
                if (!bone) continue;

                var def = JOINT_DEFS[boneKey];
                if (!def) continue;

                var geo = new THREE.SphereGeometry(def.radius, 12, 12);
                var mat = new THREE.MeshBasicMaterial({
                    color: def.color,
                    transparent: true,
                    opacity: this._handlesAlwaysVisible ? 0.45 : 0.0,
                    depthTest: false,
                });

                var mesh = new THREE.Mesh(geo, mat);
                mesh.renderOrder = 999;
                mesh.userData._skeletonJointKey = boneKey;

                var pos = new THREE.Vector3();
                bone.getWorldPosition(pos);
                mesh.position.copy(pos);

                this._scene.add(mesh);
                this._joints.set(boneKey, { mesh: mesh, material: mat, def: def, bone: bone });
            }
        },

        _removeJoints: function () {
            this._joints.forEach(function (entry) {
                entry.mesh.geometry.dispose();
                entry.material.dispose();
                if (entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
            });
            this._joints.clear();
        },

        // =====================================================================
        // UPDATE LOOP
        // =====================================================================

        _startUpdater: function () {
            this._stopUpdater();
            var self = this;
            function tick() {
                if (!self._enabled) return;
                self._updateEdgePositions();
                self._updateJointPositions();
                self._updateSelectionHighlight();
                self._animFrameId = requestAnimationFrame(tick);
            }
            self._animFrameId = requestAnimationFrame(tick);
        },

        _stopUpdater: function () {
            if (this._animFrameId) {
                cancelAnimationFrame(this._animFrameId);
                this._animFrameId = null;
            }
        },

        _updateEdgePositions: function () {
            var fromPos = new THREE.Vector3();
            var toPos = new THREE.Vector3();

            for (var i = 0; i < this._edges.length; i++) {
                var edge = this._edges[i];
                edge.fromBone.getWorldPosition(fromPos);
                edge.toBone.getWorldPosition(toPos);

                var posAttr = edge.geometry.getAttribute('position');
                posAttr.array[0] = fromPos.x;
                posAttr.array[1] = fromPos.y;
                posAttr.array[2] = fromPos.z;
                posAttr.array[3] = toPos.x;
                posAttr.array[4] = toPos.y;
                posAttr.array[5] = toPos.z;
                posAttr.needsUpdate = true;
            }
        },

        _updateJointPositions: function () {
            var pos = new THREE.Vector3();
            this._joints.forEach(function (entry) {
                entry.bone.getWorldPosition(pos);
                entry.mesh.position.copy(pos);
            });
        },

        _updateSelectionHighlight: function () {
            if (!this._selectHighlight) return;
            if (!this._selectedBoneKey) {
                this._selectHighlight.visible = false;
                return;
            }

            var editor = window.poseEditor;
            if (!editor || !editor.rigMap) {
                this._selectHighlight.visible = false;
                return;
            }

            var bone = editor.rigMap.getVisualBone
                ? editor.rigMap.getVisualBone(this._selectedBoneKey)
                : editor.rigMap.getBone(this._selectedBoneKey);
            if (!bone) {
                this._selectHighlight.visible = false;
                return;
            }

            var pos = new THREE.Vector3();
            bone.getWorldPosition(pos);
            this._selectHighlight.position.copy(pos);
            this._selectHighlight.visible = true;
        },

        // =====================================================================
        // JOINT VISIBILITY
        // =====================================================================

        _updateJointVisibility: function () {
            var self = this;
            this._joints.forEach(function (entry, key) {
                if (self._handlesAlwaysVisible) {
                    // Always visible: base opacity, brighter on hover/select
                    if (key === self._selectedBoneKey) {
                        entry.material.opacity = 0.9;
                        entry.material.color.setHex(0xff8800);
                    } else if (key === self._hoveredJointKey) {
                        entry.material.opacity = 0.75;
                        entry.material.color.setHex(0xffff66);
                    } else {
                        entry.material.opacity = 0.45;
                        entry.material.color.setHex(entry.def.color);
                    }
                } else {
                    // Hover-only: invisible unless hovered or selected
                    if (key === self._selectedBoneKey) {
                        entry.material.opacity = 0.85;
                        entry.material.color.setHex(0xff8800);
                    } else if (key === self._hoveredJointKey) {
                        entry.material.opacity = 0.7;
                        entry.material.color.setHex(0xffff66);
                    } else {
                        entry.material.opacity = 0.0;
                        entry.material.color.setHex(entry.def.color);
                    }
                }
            });
        },

        /**
         * In hover-only mode, fade in joints near the cursor.
         * @param {number} mouseX - screen X
         * @param {number} mouseY - screen Y
         */
        _fadeJointsNearCursor: function (mouseX, mouseY) {
            if (this._handlesAlwaysVisible) return;

            var canvas = this._renderer.domElement;
            var rect = canvas.getBoundingClientRect();
            var halfW = rect.width / 2;
            var halfH = rect.height / 2;
            var self = this;

            this._joints.forEach(function (entry, key) {
                if (key === self._selectedBoneKey || key === self._hoveredJointKey) return;

                // Project bone to screen
                var pos = entry.mesh.position.clone();
                pos.project(self._camera);
                var sx = pos.x * halfW + halfW + rect.left;
                var sy = -pos.y * halfH + halfH + rect.top;

                var dx = mouseX - sx;
                var dy = mouseY - sy;
                var dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 20) {
                    entry.material.opacity = 0.65;
                } else if (dist < 60) {
                    // Fade from 0.35 to 0 between 20px and 60px
                    var t = 1 - (dist - 20) / 40;
                    entry.material.opacity = 0.35 * t;
                } else {
                    entry.material.opacity = 0.0;
                }
                entry.material.color.setHex(entry.def.color);
            });
        },

        // =====================================================================
        // LINE PROXIMITY HIT TEST (screen-space)
        // =====================================================================

        /**
         * Find the closest line edge to the screen cursor.
         * Returns edge index or -1.
         */
        _findClosestEdge: function (mouseX, mouseY) {
            if (this._edges.length === 0) return -1;

            var canvas = this._renderer.domElement;
            var rect = canvas.getBoundingClientRect();
            var halfW = rect.width / 2;
            var halfH = rect.height / 2;

            var bestIndex = -1;
            var bestDist = this._lineHitRadius;

            var v3 = new THREE.Vector3();

            for (var i = 0; i < this._edges.length; i++) {
                var edge = this._edges[i];

                // Project from-bone to screen
                edge.fromBone.getWorldPosition(v3);
                v3.project(this._camera);
                var ax = v3.x * halfW + halfW + rect.left;
                var ay = -v3.y * halfH + halfH + rect.top;

                // Project to-bone to screen
                edge.toBone.getWorldPosition(v3);
                v3.project(this._camera);
                var bx = v3.x * halfW + halfW + rect.left;
                var by = -v3.y * halfH + halfH + rect.top;

                // Point-to-line-segment distance
                var dist = this._pointToSegmentDist(mouseX, mouseY, ax, ay, bx, by);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestIndex = i;
                }
            }

            return bestIndex;
        },

        /**
         * Distance from point (px,py) to line segment (ax,ay)-(bx,by).
         */
        _pointToSegmentDist: function (px, py, ax, ay, bx, by) {
            var dx = bx - ax;
            var dy = by - ay;
            var lenSq = dx * dx + dy * dy;

            if (lenSq < 1e-6) {
                // Degenerate segment
                var ex = px - ax;
                var ey = py - ay;
                return Math.sqrt(ex * ex + ey * ey);
            }

            var t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
            t = Math.max(0, Math.min(1, t));

            var closestX = ax + t * dx;
            var closestY = ay + t * dy;
            var distX = px - closestX;
            var distY = py - closestY;
            return Math.sqrt(distX * distX + distY * distY);
        },

        // =====================================================================
        // SPHERE RAYCAST
        // =====================================================================

        _updateMouseFromEvent: function (e) {
            var canvas = this._renderer.domElement;
            var rect = canvas.getBoundingClientRect();
            this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        },

        _raycastJoints: function () {
            if (this._joints.size === 0) return null;

            this._raycaster.setFromCamera(this._mouse, this._camera);
            var meshes = [];
            this._joints.forEach(function (entry) {
                meshes.push(entry.mesh);
            });

            var hits = this._raycaster.intersectObjects(meshes, false);
            if (hits.length === 0) return null;

            return hits[0].object.userData._skeletonJointKey || null;
        },

        // =====================================================================
        // HIGHLIGHT MESH
        // =====================================================================

        _createHighlightMesh: function (color, size) {
            var geo = new THREE.SphereGeometry(size || 0.04, 12, 12);
            var mat = new THREE.MeshBasicMaterial({
                color: color || 0xff8800,
                transparent: true,
                opacity: 0.5,
                depthTest: false,
            });
            var mesh = new THREE.Mesh(geo, mat);
            mesh.visible = false;
            mesh.renderOrder = 1000;
            return mesh;
        },

        // =====================================================================
        // ORBIT CONTROLS COORDINATION
        // =====================================================================

        _getOrbitControls: function () {
            var viewer = window.NEXUS_VIEWER;
            return viewer && viewer.controls ? viewer.controls : null;
        },

        _disableOrbitControls: function () {
            var controls = this._getOrbitControls();
            if (controls) controls.enabled = false;
        },

        _enableOrbitControls: function () {
            var controls = this._getOrbitControls();
            if (controls) controls.enabled = true;
        },

        // =====================================================================
        // CAMERA-RELATIVE ROTATION (industry standard: Blender / Unity)
        // =====================================================================

        _screenDragToLocalRotation: function (bone, dx, dy) {
            var camRight = new THREE.Vector3();
            var camUp = new THREE.Vector3();
            this._camera.matrixWorld.extractBasis(camRight, camUp, new THREE.Vector3());

            var angle = Math.sqrt(dx * dx + dy * dy) * this._dragSensitivity;
            if (angle < 1e-6) return new THREE.Quaternion();

            // Rotation axis in world space (perpendicular to drag direction)
            var worldAxis = new THREE.Vector3().addScaledVector(camUp, dx).addScaledVector(camRight, -dy).normalize();

            // Transform into bone-local space
            var parentInv = new THREE.Matrix4();
            if (bone.parent) {
                bone.parent.updateWorldMatrix(true, false);
                parentInv.copy(bone.parent.matrixWorld).invert();
            }
            var localAxis = worldAxis.clone().transformDirection(parentInv);
            return new THREE.Quaternion().setFromAxisAngle(localAxis, angle);
        },

        // =====================================================================
        // POINTER EVENT HANDLERS
        // =====================================================================

        _handlePointerDown: function (e) {
            if (!this._enabled) return;
            if (e.button !== 0) return;

            var editor = window.poseEditor;
            if (!editor || !editor.isActive()) return;

            this._updateMouseFromEvent(e);

            // Priority 1: Joint sphere raycast
            var jointKey = this._raycastJoints();
            if (jointKey) {
                this._startDragFromJoint(e, editor, jointKey);
                return;
            }

            // Priority 2: Line proximity hit
            var edgeIdx = this._findClosestEdge(e.clientX, e.clientY);
            if (edgeIdx >= 0) {
                this._startDragFromLine(e, editor, edgeIdx);
                return;
            }

            // Priority 3: No hit — let OrbitControls handle it
        },

        _startDragFromJoint: function (e, editor, jointKey) {
            editor.selectBone(jointKey);
            this._selectedBoneKey = jointKey;

            var bone = editor.rigMap ? editor.rigMap.getBone(jointKey) : null;
            if (!bone) return;

            if (editor._pushUndoSnapshot) {
                editor._pushUndoSnapshot();
            }

            this._dragging = true;
            this._dragStarted = false;
            this._dragEdgeIndex = -1;
            this._dragBoneKey = jointKey;
            this._dragStartX = e.clientX;
            this._dragStartY = e.clientY;
            this._dragPrevX = e.clientX;
            this._dragPrevY = e.clientY;
            this._activePointerId = e.pointerId;
            this._dragChangedKeys = null;

            // Puppet Mode: drag moves the whole chain naturally
            var puppet = window.NEXUS_POSE_PUPPET_IK;
            var vBone = editor.rigMap.getVisualBone ? editor.rigMap.getVisualBone(jointKey) || bone : bone;
            this._dragAnchorWorld = vBone.getWorldPosition(new THREE.Vector3());
            this._dragMode = puppet && puppet.isEnabled() && puppet.hasChain(jointKey) ? 'puppet' : 'rotate';
            // Solver reads the write rig, anchor comes from the visual rig —
            // correct the gap or the grab alone jerks the limb.
            this._dragFrameOffset =
                puppet && puppet.frameOffset
                    ? puppet.frameOffset(editor.rigMap, jointKey, this._dragAnchorWorld)
                    : null;

            this._renderer.domElement.setPointerCapture(e.pointerId);
            this._disableOrbitControls();
            this._renderer.domElement.style.cursor = 'grabbing';

            // Refresh panel
            var panel = window.poseStudioPanel;
            if (panel && panel.refresh) panel.refresh();

            e.stopPropagation();
            e.preventDefault();
        },

        _startDragFromLine: function (e, editor, edgeIdx) {
            var edge = this._edges[edgeIdx];
            // FK convention: child bone (to) is the drag target
            var boneKey = edge.to;

            editor.selectBone(boneKey);
            this._selectedBoneKey = boneKey;

            var bone = editor.rigMap ? editor.rigMap.getBone(boneKey) : null;
            if (!bone) return;

            if (editor._pushUndoSnapshot) {
                editor._pushUndoSnapshot();
            }

            this._dragging = true;
            this._dragStarted = false;
            this._dragEdgeIndex = edgeIdx;
            this._dragBoneKey = boneKey;
            this._dragStartX = e.clientX;
            this._dragStartY = e.clientY;
            this._dragPrevX = e.clientX;
            this._dragPrevY = e.clientY;
            this._activePointerId = e.pointerId;
            this._dragChangedKeys = null;

            // Puppet Mode: dragging a line puppets its child joint's chain
            var puppet = window.NEXUS_POSE_PUPPET_IK;
            var vBone = editor.rigMap.getVisualBone ? editor.rigMap.getVisualBone(boneKey) || bone : bone;
            this._dragAnchorWorld = vBone.getWorldPosition(new THREE.Vector3());
            this._dragMode = puppet && puppet.isEnabled() && puppet.hasChain(boneKey) ? 'puppet' : 'rotate';
            // Solver reads the write rig, anchor comes from the visual rig —
            // correct the gap or the grab alone jerks the limb.
            this._dragFrameOffset =
                puppet && puppet.frameOffset ? puppet.frameOffset(editor.rigMap, boneKey, this._dragAnchorWorld) : null;

            this._renderer.domElement.setPointerCapture(e.pointerId);
            this._disableOrbitControls();
            this._renderer.domElement.style.cursor = 'grabbing';

            // Set active edge color
            edge.material.color.setHex(edge.colors.active);
            edge.material.opacity = 1.0;

            // Refresh panel
            var panel = window.poseStudioPanel;
            if (panel && panel.refresh) panel.refresh();

            e.stopPropagation();
            e.preventDefault();
        },

        _handlePointerMove: function (e) {
            if (!this._enabled) return;

            var editor = window.poseEditor;
            if (!editor || !editor.isActive()) return;

            // DRAG: rotate the bone
            if (this._dragging && this._dragBoneKey) {
                var bone = editor.rigMap ? editor.rigMap.getBone(this._dragBoneKey) : null;
                if (!bone) return;

                var totalDx = e.clientX - this._dragStartX;
                var totalDy = e.clientY - this._dragStartY;

                // Deadzone
                if (!this._dragStarted) {
                    var dist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
                    if (dist < this._dragDeadzone) return;
                    this._dragStarted = true;
                    this._dragPrevX = e.clientX;
                    this._dragPrevY = e.clientY;
                    return;
                }

                // Incremental delta
                var dx = e.clientX - this._dragPrevX;
                var dy = e.clientY - this._dragPrevY;
                this._dragPrevX = e.clientX;
                this._dragPrevY = e.clientY;

                // Puppet Mode: solve the whole chain toward the 3D pointer target
                if (this._dragMode === 'puppet' && window.NEXUS_POSE_PUPPET_IK && this._dragAnchorWorld) {
                    this._updateMouseFromEvent(e);
                    var puppetTarget = window.NEXUS_POSE_PUPPET_IK.screenTarget(
                        this._camera,
                        this._mouse,
                        this._dragAnchorWorld
                    );
                    if (puppetTarget) {
                        if (this._dragFrameOffset) puppetTarget.add(this._dragFrameOffset);
                        var puppetChanged = window.NEXUS_POSE_PUPPET_IK.solve(
                            editor.rigMap,
                            this._dragBoneKey,
                            puppetTarget
                        );
                        if (puppetChanged && puppetChanged.length) this._dragChangedKeys = puppetChanged;
                    }
                    return;
                }

                if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

                // Camera-relative rotation projected to bone-local space
                var localRot = this._screenDragToLocalRotation(bone, dx, dy);
                bone.quaternion.multiply(localRot);
                bone.quaternion.normalize();
                bone.updateMatrixWorld(true);

                return;
            }

            // HOVER: highlight edges and joints
            this._updateMouseFromEvent(e);

            // Check joint hover first
            var jointKey = this._raycastJoints();

            // Check line hover
            var edgeIdx = this._findClosestEdge(e.clientX, e.clientY);

            // Reset previous hover states
            this._resetEdgeAppearance();

            var prevHoveredJoint = this._hoveredJointKey;
            this._hoveredJointKey = null;
            this._hoveredEdgeIndex = -1;

            if (jointKey) {
                // Hovering over a joint sphere
                this._hoveredJointKey = jointKey;
                this._renderer.domElement.style.cursor = 'grab';

                // Also highlight connected edges
                this._highlightEdgesForBone(jointKey);
            } else if (edgeIdx >= 0) {
                // Hovering over a line
                this._hoveredEdgeIndex = edgeIdx;
                var hoverEdge = this._edges[edgeIdx];
                hoverEdge.material.color.setHex(hoverEdge.colors.hover);
                hoverEdge.material.opacity = 0.85;
                hoverEdge.line.renderOrder = 998;
                this._renderer.domElement.style.cursor = 'grab';

                // Show both endpoint joints
                this._hoveredJointKey = null; // not a direct joint hover
                this._showEndpointJoints(hoverEdge.from, hoverEdge.to);
            } else {
                this._renderer.domElement.style.cursor = '';
            }

            // Update joint visibility
            this._updateJointVisibility();
            this._fadeJointsNearCursor(e.clientX, e.clientY);
        },

        _handlePointerUp: function (e) {
            if (e.button !== 0) return;

            // Disabled (or editor exited) mid-drag: still restore camera
            // controls + pointer capture, or the viewport feels dead.
            if (!this._enabled) {
                if (this._dragging) this._endDragCleanup();
                return;
            }

            if (this._dragging) {
                try {
                    this._renderer.domElement.releasePointerCapture(e.pointerId);
                } catch (_) {}

                this._enableOrbitControls();

                // Sync axis state for slider sync — every bone the drag moved
                // (puppet mode rotates the whole chain).
                var changedKeys =
                    this._dragChangedKeys && this._dragChangedKeys.length ? this._dragChangedKeys : [this._dragBoneKey];
                for (var ci = 0; ci < changedKeys.length; ci++) {
                    this._syncAxisStateAfterDrag(changedKeys[ci]);
                }

                // Reset edge color if we were dragging a line
                if (this._dragEdgeIndex >= 0 && this._dragEdgeIndex < this._edges.length) {
                    var edge = this._edges[this._dragEdgeIndex];
                    edge.material.color.setHex(edge.colors.base);
                    edge.material.opacity = 0.5;
                    edge.line.renderOrder = 997;
                }

                this._renderer.domElement.style.cursor = 'grab';
                this._dragging = false;
                this._dragStarted = false;
                this._dragEdgeIndex = -1;
                this._dragBoneKey = null;
                this._dragAnchorWorld = null;
                this._dragChangedKeys = null;
                this._dragFrameOffset = null;
                this._activePointerId = null;

                // Emit change so panel/sliders refresh
                var editor = window.poseEditor;
                if (editor && editor._emitChange) {
                    editor._emitChange();
                }

                var panel = window.poseStudioPanel;
                if (panel && panel.refresh) panel.refresh();
            }
        },

        // =====================================================================
        // VISUAL HELPERS
        // =====================================================================

        _resetEdgeAppearance: function () {
            for (var i = 0; i < this._edges.length; i++) {
                var edge = this._edges[i];
                edge.material.color.setHex(edge.colors.base);
                edge.material.opacity = 0.5;
                edge.line.renderOrder = 997;
            }
        },

        _highlightEdgesForBone: function (boneKey) {
            for (var i = 0; i < this._edges.length; i++) {
                var edge = this._edges[i];
                if (edge.from === boneKey || edge.to === boneKey) {
                    edge.material.color.setHex(edge.colors.hover);
                    edge.material.opacity = 0.75;
                    edge.line.renderOrder = 998;
                }
            }
        },

        _showEndpointJoints: function (fromKey, toKey) {
            // Temporarily show endpoint joints during line hover (hover-only mode)
            var fromEntry = this._joints.get(fromKey);
            var toEntry = this._joints.get(toKey);
            if (fromEntry && fromKey !== this._selectedBoneKey) {
                fromEntry.material.opacity = 0.55;
                fromEntry.material.color.setHex(fromEntry.def.color);
            }
            if (toEntry && toKey !== this._selectedBoneKey) {
                toEntry.material.opacity = 0.55;
                toEntry.material.color.setHex(toEntry.def.color);
            }
        },

        // =====================================================================
        // AXIS STATE SYNC (for slider sync after drag)
        // =====================================================================

        _syncAxisStateAfterDrag: function (boneKey) {
            var editor = window.poseEditor;
            if (!editor || !editor.applier || !boneKey) return;

            var bone = editor.rigMap ? editor.rigMap.getBone(boneKey) : null;
            if (!bone) return;

            // Compute offset from neutral
            var neutralQ = new THREE.Quaternion();
            if (editor.neutralPose && editor.neutralPose[boneKey] && editor.neutralPose[boneKey].q) {
                var nq = editor.neutralPose[boneKey].q;
                neutralQ.set(nq[0], nq[1], nq[2], nq[3]);
            }

            var offsetQ = neutralQ.clone().invert().multiply(bone.quaternion.clone());
            var euler = new THREE.Euler().setFromQuaternion(offsetQ, 'XYZ');

            if (!editor.applier.axisState) {
                editor.applier.axisState = {};
            }
            editor.applier.axisState[boneKey] = {
                x: euler.x,
                y: euler.y,
                z: euler.z,
            };
        },

        // =====================================================================
        // CLEANUP
        // =====================================================================

        dispose: function () {
            this._enabled = false;
            this._dragging = false;
            this._ctxReady = false;
            this._stopUpdater();
            this._removeEdges();
            this._removeJoints();

            if (this._renderer) {
                var canvas = this._renderer.domElement;
                if (this._onPointerDown) canvas.removeEventListener('pointerdown', this._onPointerDown);
                if (this._onPointerMove) canvas.removeEventListener('pointermove', this._onPointerMove);
                if (this._onPointerUp) canvas.removeEventListener('pointerup', this._onPointerUp);
            }

            if (this._selectHighlight && this._selectHighlight.parent) {
                this._selectHighlight.parent.remove(this._selectHighlight);
                this._selectHighlight.geometry.dispose();
                this._selectHighlight.material.dispose();
            }

            console.log('[SkeletonLineOverlay] Disposed.');
        },
    };

    window.NEXUS_SKELETON_LINE_OVERLAY = SkeletonLineOverlay;
})();
