/**
 * VRPuppetInteraction — Unified VR puppet interaction state machine
 * ==================================================================
 * Orchestration layer for immersive VR character manipulation.
 * Adds visible grab handles and routes controller grip events to
 * the correct subsystem (IK drag, bone rotation, root transform).
 *
 * Interaction modes:
 *   idle            — no active manipulation
 *   ikDrag          — one-hand IK solving for hand/head/foot handles
 *   boneRotate      — one-hand direct bone rotation (fallback)
 *   rootTranslate   — one-hand root/hips translation
 *   rootDualTransform — two-hand root translate + rotate
 *
 * Non-destructive: additive module on top of VRBoneGrabber + VRPoseSystem.
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

// =========================================================================
// HANDLE COLORS (translucent spheres at key body points)
// =========================================================================

const HANDLE_COLORS = {
    hand: 0x40e0ff, // cyan — primary grab
    head: 0xff66cc, // pink — head
    foot: 0x66ffaa, // green — feet
    root: 0x7cff7c, // bright green — hips/root
    limb: 0xffaa40, // orange — mid-limb (elbows, knees, shoulders, thighs)
    hover: 0xffff66, // yellow — hover highlight
    active: 0xffaa00,
};

// =========================================================================
// HANDLE DEFINITIONS (bone key → type + radius)
// =========================================================================

// Industry-standard grab handle set (matches VaM FreeControllerV3 layout).
// 14 control points covering all major articulable body regions.
// Types: 'hand'|'head'|'foot' → IK drag, 'limb' → IK drag (intermediate),
//        'root' → root translate, 'torso' → IK spine drag
// Visual radius = small & subtle; touchRadius = physical grab zone (larger).
// This matches VaM's approach: small visual dot, generous touch zone.
const HANDLE_DEFS = [
    // ── Extremities (primary IK targets) ──
    { boneKey: 'leftHand', type: 'hand', radius: 0.025, touchRadius: 0.06 },
    { boneKey: 'rightHand', type: 'hand', radius: 0.025, touchRadius: 0.06 },
    { boneKey: 'head', type: 'head', radius: 0.03, touchRadius: 0.07 },
    { boneKey: 'leftFoot', type: 'foot', radius: 0.022, touchRadius: 0.055 },
    { boneKey: 'rightFoot', type: 'foot', radius: 0.022, touchRadius: 0.055 },

    // ── Root ──
    { boneKey: 'hips', type: 'root', radius: 0.04, touchRadius: 0.09 },

    // ── Mid-limb handles (elbows / knees — pole vector control) ──
    { boneKey: 'leftLowerArm', type: 'limb', radius: 0.02, touchRadius: 0.05 },
    { boneKey: 'rightLowerArm', type: 'limb', radius: 0.02, touchRadius: 0.05 },
    { boneKey: 'leftLowerLeg', type: 'limb', radius: 0.02, touchRadius: 0.05 },
    { boneKey: 'rightLowerLeg', type: 'limb', radius: 0.02, touchRadius: 0.05 },

    // ── Shoulders (upper body control) ──
    { boneKey: 'leftUpperArm', type: 'limb', radius: 0.02, touchRadius: 0.05 },
    { boneKey: 'rightUpperArm', type: 'limb', radius: 0.02, touchRadius: 0.05 },

    // ── Upper legs (hip posing — sitting, spreading, kneeling) ──
    { boneKey: 'leftUpperLeg', type: 'limb', radius: 0.022, touchRadius: 0.055 },
    { boneKey: 'rightUpperLeg', type: 'limb', radius: 0.022, touchRadius: 0.055 },
];

// =========================================================================
// VR PUPPET INTERACTION CLASS
// =========================================================================

export class VRPuppetInteraction {
    /**
     * @param {object} opts
     * @param {THREE.Scene} opts.scene
     * @param {THREE.WebGLRenderer} opts.renderer
     * @param {THREE.Camera} opts.camera
     * @param {import('./VRControllers.js').VRControllers} opts.controllers
     * @param {import('./VRPoseSystem.js').VRPoseSystem} opts.poseSystem
     * @param {import('./VRBoneGrabber.js').VRBoneGrabber} opts.boneGrabber
     */
    constructor({ scene, renderer, camera, controllers, poseSystem, boneGrabber }) {
        this.scene = scene;
        this.renderer = renderer;
        this.camera = camera;
        this.controllers = controllers;
        this.poseSystem = poseSystem;
        this.boneGrabber = boneGrabber;

        this.enabled = false;
        this.avatarRoot = null;

        // Handle meshes (boneKey → THREE.Mesh)
        this.handles = new Map();

        // Hover tracking per hand
        this.hoveredByHand = { left: null, right: null };

        // Interaction state machine
        this.state = {
            mode: 'idle', // idle | ikDrag | boneRotate | rootTranslate | rootDualTransform | limbDualTransform
            primaryHand: null,
            secondaryHand: null,
            targetKey: null,
            targetType: null, // hand | head | foot | root | bone
            object: null,

            // Root transform state
            startRootPos: new THREE.Vector3(),
            startRootQuat: new THREE.Quaternion(),

            // Controller positions at grab start
            startPrimaryPos: new THREE.Vector3(),
            startSecondaryPos: new THREE.Vector3(),
            startMidpoint: new THREE.Vector3(),
            startVector: new THREE.Vector3(),
        };

        // Reusable objects (avoid per-frame allocations — critical on Quest)
        this._raycaster = new THREE.Raycaster();
        this._tempMatrix = new THREE.Matrix4();
        this._tmpV1 = new THREE.Vector3();
        this._tmpV2 = new THREE.Vector3();
        this._tmpV3 = new THREE.Vector3();
        this._tmpQuat = new THREE.Quaternion();

        // Hover haptic pulse throttle
        this._lastHoverPulse = { left: 0, right: 0 };

        // Joint visibility mode: 'hoverOnly' (default) or 'alwaysVisible'
        this._jointVisibility = 'hoverOnly';

        // Proximity threshold for hover-only mode (meters)
        this._proximityThreshold = 0.35;

        // Grab detection mode: 'touch' (physical proximity) or 'pointer' (raycast)
        // 'touch' = controller must physically overlap the handle (AAA VR standard)
        // 'pointer' = aim controller at handle from distance (optional, desktop-like)
        this._grabMode = 'touch';
    }

    // =========================================================================
    // AVATAR SETUP
    // =========================================================================

    /**
     * Set the avatar root and create grab handles at key body positions.
     * @param {THREE.Object3D|null} root
     */
    setAvatar(root) {
        this.avatarRoot = root;
        this.clearHandles();

        if (!root) {
            return;
        }

        for (const def of HANDLE_DEFS) {
            this._createHandle(def.boneKey, def.type, def.radius, def.touchRadius);
        }

        console.log(`[VRPuppetInteraction] Avatar set, ${this.handles.size} handles created`);
    }

    /**
     * Enable or disable puppet interaction (shows/hides handles).
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = !!enabled;
        if (this._jointVisibility === 'alwaysVisible') {
            this._setHandlesVisible(this.enabled);
        } else {
            // Hover-only: handles start hidden, proximity reveals them
            this._setHandlesVisible(false);
        }

        if (!enabled) {
            this.endAll();
        }

        console.log(`[VRPuppetInteraction] ${this.enabled ? 'Enabled' : 'Disabled'}`);
    }

    /**
     * Set grab detection mode.
     * @param {'touch'|'pointer'} mode
     *   - 'touch'   (default): controller must physically overlap handle (AAA standard)
     *   - 'pointer': aim controller at handle from distance (optional)
     */
    setGrabMode(mode) {
        this._grabMode = mode === 'pointer' ? 'pointer' : 'touch';
        console.log(`[VRPuppetInteraction] Grab mode: ${this._grabMode}`);
    }

    /**
     * Set joint/handle visibility mode.
     * @param {'hoverOnly'|'alwaysVisible'} mode
     */
    setJointVisibility(mode) {
        this._jointVisibility = mode;
        if (!this.enabled) {
            return;
        }

        if (mode === 'alwaysVisible') {
            this._setHandlesVisible(true);
        } else {
            // Hover-only: hide all, proximity detection will reveal nearby handles
            this._setHandlesVisible(false);
        }
        console.log(`[VRPuppetInteraction] Joint visibility → ${mode}`);
    }

    // =========================================================================
    // HANDLE MANAGEMENT
    // =========================================================================

    /**
     * Create a translucent sphere handle at a bone position.
     * @param {string} boneKey
     * @param {string} type
     * @param {number} radius
     */
    _createHandle(boneKey, type, radius, touchRadius) {
        const bone = this._getBone(boneKey);
        if (!bone) {
            return;
        }

        const geom = new THREE.SphereGeometry(radius, 16, 16);
        const mat = new THREE.MeshBasicMaterial({
            color: HANDLE_COLORS[type] || 0xffffff,
            transparent: true,
            opacity: 0.3, // subtle idle state — less visual noise
            depthWrite: false,
        });

        const mesh = new THREE.Mesh(geom, mat);
        mesh.userData = {
            isPuppetHandle: true,
            boneKey,
            type,
            radius,
            touchRadius: touchRadius || radius * 1.5, // grab zone > visual sphere
        };
        mesh.visible = false;
        mesh.renderOrder = 998;
        this.scene.add(mesh);

        this.handles.set(boneKey, mesh);
    }

    /** Remove and dispose all handles. */
    clearHandles() {
        for (const handle of this.handles.values()) {
            handle.geometry?.dispose();
            handle.material?.dispose();
            handle.parent?.remove(handle);
        }
        this.handles.clear();
    }

    /** Show or hide all handles. */
    _setHandlesVisible(visible) {
        for (const handle of this.handles.values()) {
            handle.visible = !!visible;
        }
    }

    /** Update handle positions to match current bone world positions. */
    _updateHandlePositions() {
        for (const [boneKey, handle] of this.handles.entries()) {
            const bone = this._getBone(boneKey);
            if (!bone) {
                continue;
            }
            bone.getWorldPosition(handle.position);
        }
    }

    /**
     * Set visual state of a handle (idle / hover / active).
     * @param {THREE.Mesh} handle
     * @param {'idle'|'hover'|'active'} state
     */
    _setHandleState(handle, state) {
        if (!handle?.material) {
            return;
        }
        const type = handle.userData.type;

        if (state === 'hover') {
            handle.material.color.setHex(HANDLE_COLORS.hover);
            handle.material.opacity = 0.5;
        } else if (state === 'active') {
            handle.material.color.setHex(HANDLE_COLORS.active);
            handle.material.opacity = 0.7;
        } else {
            handle.material.color.setHex(HANDLE_COLORS[type] || 0xffffff);
            handle.material.opacity = 0.3;
        }
    }

    // =========================================================================
    // BONE ACCESS
    // =========================================================================

    /**
     * Resolve a bone by humanoid key using VRPoseSystem's bone map.
     * @param {string} boneKey
     * @returns {THREE.Bone|null}
     */
    _getBone(boneKey) {
        // Public accessor if available
        if (typeof this.poseSystem?.getBone === 'function') {
            return this.poseSystem.getBone(boneKey);
        }
        // Direct map access as fallback
        return this.poseSystem?._bones?.get(boneKey) || null;
    }

    // =========================================================================
    // CONTROLLER HELPERS
    // =========================================================================

    /**
     * Get THREE.Object3D controller by hand string.
     * @param {'left'|'right'} hand
     * @returns {THREE.Object3D|null}
     */
    _getControllerByHand(hand) {
        return hand === 'left' ? this.controllers.controller1 : this.controllers.controller2;
    }

    /**
     * Get the WebXR Gamepad for a hand (for haptics).
     * @param {'left'|'right'} hand
     * @returns {Gamepad|null}
     */
    _getGamepadByHand(hand) {
        const src = this.controllers.controllers?.[hand];
        return src?.gamepad || null;
    }

    /**
     * Pulse haptic feedback on a controller.
     * @param {'left'|'right'} hand
     * @param {number} strength 0–1
     * @param {number} duration ms
     */
    _pulseHaptics(hand, strength = 0.2, duration = 20) {
        const gp = this._getGamepadByHand(hand);
        if (!gp?.hapticActuators?.length) {
            return;
        }
        try {
            gp.hapticActuators[0].pulse(strength, duration);
        } catch (_e) {
            // Haptics may not be supported
        }
    }

    /**
     * Find the nearest handle within physical touch distance of the controller.
     * Uses each handle's touchRadius — the physical grab zone (larger than visual).
     * AAA VR standard: controller must physically overlap the handle.
     *
     * @param {THREE.Object3D} controller
     * @returns {{ object: THREE.Mesh, distance: number }|null}
     */
    _findTouchedHandle(controller) {
        if (!controller) return null;

        this._tmpV1.setFromMatrixPosition(controller.matrixWorld);

        let closest = null;
        let closestDistSq = Infinity;

        for (const handle of this.handles.values()) {
            if (!handle.visible) continue;

            const touchR = handle.userData.touchRadius || 0.06;
            const distSq = this._tmpV1.distanceToSquared(handle.position);

            if (distSq < touchR * touchR && distSq < closestDistSq) {
                closestDistSq = distSq;
                closest = handle;
            }
        }

        return closest ? { object: closest, distance: Math.sqrt(closestDistSq) } : null;
    }

    /**
     * Raycast from a controller into the visible puppet handles.
     * Used only when grabMode is 'pointer' (optional, disabled by default).
     * @param {THREE.Object3D} controller
     * @returns {THREE.Intersection|null}
     */
    _raycastHandles(controller) {
        if (!controller) {
            return null;
        }

        this._tempMatrix.identity().extractRotation(controller.matrixWorld);
        this._raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._tempMatrix);

        const objs = [...this.handles.values()].filter((h) => h.visible);
        const hits = this._raycaster.intersectObjects(objs, false);
        return hits[0] || null;
    }

    /**
     * Detect handle using the active grab mode (touch or pointer).
     * @param {THREE.Object3D} controller
     * @returns {{ object: THREE.Mesh }|null}
     */
    _detectHandle(controller) {
        return this._grabMode === 'pointer' ? this._raycastHandles(controller) : this._findTouchedHandle(controller);
    }

    // =========================================================================
    // HOVER (per-frame, per-hand)
    // =========================================================================

    /**
     * Update hover state for both hands. Shows hover color + light haptic pulse.
     * @param {number} dt
     */
    _updateHover(dt) {
        for (const hand of ['left', 'right']) {
            // Skip if this hand is actively grabbing
            if (this.state.primaryHand === hand || this.state.secondaryHand === hand) {
                continue;
            }

            const controller = this._getControllerByHand(hand);
            const hit = this._detectHandle(controller);
            const prev = this.hoveredByHand[hand];

            // Unhover previous
            if (prev && (!hit || hit.object !== prev)) {
                this._setHandleState(prev, 'idle');
                this.hoveredByHand[hand] = null;
            }

            // Hover new
            if (hit?.object) {
                this.hoveredByHand[hand] = hit.object;
                this._setHandleState(hit.object, 'hover');

                // Throttled haptic pulse on hover
                this._lastHoverPulse[hand] += dt || 0;
                if (this._lastHoverPulse[hand] > 0.18) {
                    this._pulseHaptics(hand, 0.12, 12);
                    this._lastHoverPulse[hand] = 0;
                }
            } else {
                this._lastHoverPulse[hand] = 0;
            }
        }
    }

    // =========================================================================
    // GRIP START — Route to correct interaction mode
    // =========================================================================

    /**
     * Called when a controller grip is pressed.
     * Returns true if the puppet system consumed the event.
     * @param {'left'|'right'} hand
     * @param {THREE.Object3D} controller
     * @returns {boolean}
     */
    beginGrip(hand, controller) {
        if (!this.enabled || !this.avatarRoot || !controller) {
            return false;
        }

        const hit = this._detectHandle(controller);

        // ─── SECOND HAND JOIN: upgrade any single-hand mode → dual transform ───
        const isActiveSingleHand =
            this.state.mode !== 'idle' &&
            this.state.primaryHand !== null &&
            this.state.secondaryHand === null &&
            this.state.primaryHand !== hand;

        if (isActiveSingleHand) {
            // Stop the first-hand's single-joint interaction before switching
            if (this.state.mode === 'ikDrag') {
                this.poseSystem?.endIK?.();
            }
            if (this.state.mode === 'boneRotate') {
                this.boneGrabber?.endGrab?.();
            }

            const wasRoot = this.state.mode === 'rootTranslate';

            this.state.secondaryHand = hand;
            controller.getWorldPosition(this.state.startSecondaryPos);
            this.state.startRootPos.copy(this.avatarRoot.position);
            this.avatarRoot.getWorldQuaternion(this.state.startRootQuat);
            this.state.object = this.avatarRoot;

            const primary = this._getControllerByHand(this.state.primaryHand);
            primary?.getWorldPosition(this.state.startPrimaryPos);

            this.state.startMidpoint
                .copy(this.state.startPrimaryPos)
                .add(this.state.startSecondaryPos)
                .multiplyScalar(0.5);

            this.state.startVector.copy(this.state.startSecondaryPos).sub(this.state.startPrimaryPos).normalize();

            // rootDualTransform when both grabbed hips; limbDualTransform otherwise
            this.state.mode = wasRoot ? 'rootDualTransform' : 'limbDualTransform';

            const rootHandle = this.handles.get('hips');
            if (rootHandle) {
                this._setHandleState(rootHandle, 'active');
            }

            this._pulseHaptics(hand, 0.28, 25);
            console.log(
                `[VRPuppetInteraction] Two-hand ${this.state.mode} activated (${hand} joined, was ${wasRoot ? 'rootTranslate' : 'limb grab'})`
            );
            return true;
        }

        // ─── Only accept new grabs from idle ───
        if (this.state.mode !== 'idle') {
            return false;
        }

        // ─── HANDLE HIT: route by handle type ───
        if (hit?.object?.userData?.isPuppetHandle) {
            const handle = hit.object;
            const { boneKey, type } = handle.userData;

            this.state.primaryHand = hand;
            this.state.targetKey = boneKey;
            this.state.targetType = type;
            this.state.object = this.avatarRoot;

            this._setHandleState(handle, 'active');
            this._pulseHaptics(hand, 0.28, 25);

            // IK drag for hand/head/foot/limb (elbows, knees, shoulders, upper legs)
            if (type === 'hand' || type === 'head' || type === 'foot' || type === 'limb') {
                if (this.poseSystem?.startIK?.(boneKey, controller)) {
                    this.state.mode = 'ikDrag';
                    console.log(`[VRPuppetInteraction] IK drag started: ${boneKey} (${hand})`);
                    return true;
                }
                // IK not available for this bone — fall through to bone rotate
                console.log(`[VRPuppetInteraction] IK unavailable for ${boneKey}, trying bone rotate`);
            }

            // Root/hips: single-hand translate
            if (type === 'root') {
                controller.getWorldPosition(this.state.startPrimaryPos);
                this.state.startRootPos.copy(this.avatarRoot.position);
                this.state.mode = 'rootTranslate';
                console.log(`[VRPuppetInteraction] Root translate started (${hand})`);
                return true;
            }
        }

        // ─── FALLBACK: existing VRBoneGrabber (raycast on mesh) ───
        if (this.boneGrabber?.tryGrab?.(controller)) {
            this.state.mode = 'boneRotate';
            this.state.primaryHand = hand;
            this.state.targetType = 'bone';
            this._pulseHaptics(hand, 0.22, 18);
            console.log(`[VRPuppetInteraction] Bone rotate started (${hand})`);
            return true;
        }

        return false;
    }

    // =========================================================================
    // GRIP RELEASE — Clean state transitions
    // =========================================================================

    /**
     * Called when a controller grip is released.
     * Returns true if the puppet system owned this hand.
     * @param {'left'|'right'} hand
     * @returns {boolean}
     */
    endGrip(hand) {
        // ─── Secondary hand release: downgrade dual → single-hand mode ───
        if (
            (this.state.mode === 'rootDualTransform' || this.state.mode === 'limbDualTransform') &&
            this.state.secondaryHand === hand
        ) {
            const wasLimb = this.state.mode === 'limbDualTransform';
            this.state.secondaryHand = null;

            if (wasLimb) {
                // Limb dual → back to idle (original IK/bone context was ended)
                const handle = this.handles.get(this.state.targetKey);
                if (handle) {
                    this._setHandleState(handle, 'idle');
                }
                const rootHandle = this.handles.get('hips');
                if (rootHandle) {
                    this._setHandleState(rootHandle, 'idle');
                }

                this.state.mode = 'idle';
                this.state.primaryHand = null;
                this.state.targetKey = null;
                this.state.targetType = null;
                this.state.object = null;
                console.log('[VRPuppetInteraction] Limb dual-transform ended → idle');
            } else {
                // Root dual → single root translate
                this.state.mode = 'rootTranslate';
                const primary = this._getControllerByHand(this.state.primaryHand);
                if (primary) {
                    primary.getWorldPosition(this.state.startPrimaryPos);
                    this.state.startRootPos.copy(this.avatarRoot.position);
                }
                console.log('[VRPuppetInteraction] Downgraded to single-hand root translate');
            }
            return true;
        }

        // ─── Primary hand release: exit current mode ───
        if (this.state.primaryHand === hand) {
            if (this.state.mode === 'ikDrag') {
                this.poseSystem?.endIK?.();
            }
            if (this.state.mode === 'boneRotate') {
                this.boneGrabber?.endGrab?.();
            }

            // Reset handle visual
            const handle = this.handles.get(this.state.targetKey);
            if (handle) {
                this._setHandleState(handle, 'idle');
            }

            const prevMode = this.state.mode;
            this.state.mode = 'idle';
            this.state.primaryHand = null;
            this.state.secondaryHand = null;
            this.state.targetKey = null;
            this.state.targetType = null;
            this.state.object = null;

            console.log(`[VRPuppetInteraction] Released (was ${prevMode})`);
            return true;
        }

        return false;
    }

    // =========================================================================
    // PER-FRAME UPDATE — Drive active interaction
    // =========================================================================

    /**
     * Main update loop. Call every frame while XR is presenting.
     * @param {number} dt — delta time in seconds
     */
    update(dt) {
        if (!this.enabled || !this.avatarRoot || !this.renderer.xr.isPresenting) {
            return;
        }

        this._updateHandlePositions();

        // Hover-only mode: reveal handles near controller, hide distant ones
        if (this._jointVisibility === 'hoverOnly') {
            this._updateProximityVisibility();
        }

        this._updateHover(dt);
        this._updateActiveInteraction(dt);
    }

    /**
     * In hover-only mode, show handles only when a controller is within proximity.
     * Mimics the desktop bone-sphere behavior where spheres appear on approach.
     */
    _updateProximityVisibility() {
        const threshold = this._proximityThreshold;
        const thresholdSq = threshold * threshold;

        for (const [boneKey, handle] of this.handles.entries()) {
            // Skip actively grabbed handles — keep them visible
            if (this.state.targetKey === boneKey && this.state.mode !== 'idle') {
                handle.visible = true;
                continue;
            }

            let near = false;
            for (const hand of ['left', 'right']) {
                const controller = this._getControllerByHand(hand);
                if (!controller) {
                    continue;
                }
                this._tmpV1.setFromMatrixPosition(controller.matrixWorld);
                const distSq = this._tmpV1.distanceToSquared(handle.position);
                if (distSq < thresholdSq) {
                    near = true;
                    break;
                }
            }
            handle.visible = near;
        }
    }

    /**
     * Drive the active interaction mode.
     * @param {number} _dt
     */
    _updateActiveInteraction(_dt) {
        if (this.state.mode === 'idle') {
            return;
        }

        // ─── IK DRAG: VRPoseSystem solves the chain ───
        if (this.state.mode === 'ikDrag') {
            this.poseSystem?.updateIK?.();
            return;
        }

        // ─── BONE ROTATE: VRBoneGrabber handles direct rotation ───
        if (this.state.mode === 'boneRotate') {
            const controller = this._getControllerByHand(this.state.primaryHand);
            if (controller) {
                this.boneGrabber?.updateGrab?.(controller);
            }
            return;
        }

        // ─── ROOT TRANSLATE: one-hand position delta ───
        if (this.state.mode === 'rootTranslate') {
            const controller = this._getControllerByHand(this.state.primaryHand);
            if (!controller || !this.state.object) {
                return;
            }

            controller.getWorldPosition(this._tmpV1);
            this._tmpV2.subVectors(this._tmpV1, this.state.startPrimaryPos);
            this.state.object.position.copy(this.state.startRootPos).add(this._tmpV2);
            return;
        }

        // ─── DUAL TRANSFORM: two-hand translate + rotate (root or limb) ───
        if (this.state.mode === 'rootDualTransform' || this.state.mode === 'limbDualTransform') {
            const c1 = this._getControllerByHand(this.state.primaryHand);
            const c2 = this._getControllerByHand(this.state.secondaryHand);
            if (!c1 || !c2 || !this.state.object) {
                return;
            }

            c1.getWorldPosition(this._tmpV1);
            c2.getWorldPosition(this._tmpV2);

            // Translation: midpoint delta
            this._tmpV3.copy(this._tmpV1).add(this._tmpV2).multiplyScalar(0.5);
            const midpointDelta = this._tmpV3.clone().sub(this.state.startMidpoint);
            this.state.object.position.copy(this.state.startRootPos).add(midpointDelta);

            // Rotation: controller-pair vector delta
            const currentVector = this._tmpV2.clone().sub(this._tmpV1).normalize();
            this._tmpQuat.setFromUnitVectors(this.state.startVector, currentVector);
            this.state.object.quaternion.copy(this.state.startRootQuat).premultiply(this._tmpQuat);
            return;
        }
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================

    /** End all active interactions and reset state. */
    endAll() {
        if (this.state.mode === 'ikDrag') {
            this.poseSystem?.endIK?.();
        }
        if (this.state.mode === 'boneRotate') {
            this.boneGrabber?.endGrab?.();
        }

        this.state.mode = 'idle';
        this.state.primaryHand = null;
        this.state.secondaryHand = null;
        this.state.targetKey = null;
        this.state.targetType = null;
        this.state.object = null;

        for (const handle of this.handles.values()) {
            this._setHandleState(handle, 'idle');
        }
    }

    /** Full cleanup — call on destroy. */
    dispose() {
        this.endAll();
        this.clearHandles();
    }
}
