/**
 * VR Controllers Module — Industry-Standard Meta Quest Mapping
 * =============================================================
 * WebXR xr-standard gamepad button indices (W3C spec):
 *   buttons[0] = Trigger (index finger)        — fires selectstart/selectend
 *   buttons[1] = Grip / Squeeze (middle finger)
 *   buttons[2] = (placeholder / unused on Quest Touch)
 *   buttons[3] = Thumbstick press (click stick)
 *   buttons[4] = X (left) / A (right) — lower face button
 *   buttons[5] = Y (left) / B (right) — upper face button
 *
 *   axes[2] = Thumbstick X,  axes[3] = Thumbstick Y
 *
 * Industry-standard control scheme (Meta guidelines + VRChat/Alyx/Horizon):
 * ────────────────────────────────────────────────────────────────────────
 * LEFT CONTROLLER:
 *   Trigger  → Select / UI click (ray pointer)
 *   Grip     → Grab & hold objects (avatar turntable spin, panel drag)
 *   Stick    → Walk / Strafe
 *   X btn    → Toggle chat panel (menu)
 *   Y btn    → Push-to-talk (hold to record, release to send)
 *
 * RIGHT CONTROLLER:
 *   Trigger  → Select / UI click (ray pointer)
 *   Grip     → Grab & hold objects (avatar turntable spin, panel drag)
 *   Stick    → Snap Turn (X) / Fly Up & Down (Y)
 *   A btn    → Toggle chat panel (alternative)
 *   B btn    → Push-to-talk  (alternative, hold to record)
 *
 * References:
 *   https://www.w3.org/TR/webxr-gamepads-module-1/
 *   https://developers.meta.com/horizon/design/controllers/
 *   https://developers.meta.com/horizon/blog/button-action-mapping-user-inputs-controller-meta-quest-horizon-developers-vr-mr
 * ────────────────────────────────────────────────────────────────────────
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

// =========================================================================
// xr-standard button index constants (W3C WebXR Gamepads Module spec)
// =========================================================================
const BTN = {
    TRIGGER: 0, // Index finger trigger — primary select
    GRIP: 1, // Middle finger squeeze — grab/hold
    // 2 = touchpad (placeholder on Quest Touch)
    THUMBSTICK: 3, // Thumbstick click
    X_OR_A: 4, // X on left, A on right — lower face button
    Y_OR_B: 5, // Y on left, B on right — upper face button
};

export class VRControllers {
    constructor(renderer, scene, camera, options = {}) {
        if (!renderer || !scene || !camera) {
            throw new Error('[VRControllers] CRITICAL: renderer, scene, and camera are required.');
        }

        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        // --- Configuration ---
        this.options = {
            moveSpeed: 1.8, // Horizontal speed
            verticalSpeed: 1.2, // Vertical fly speed
            turnSpeed: 2.0, // Turning speed
            rotationSensitivity: 3.5,
            deadzone: 0.15, // Stick deadzone
            rayLength: 5,
            rayColor: 0x00e5ff,
            rayGrabColor: 0x00ff00,
            ...options,
        };

        // --- State ---
        this.enabled = false;
        this.playerRig = new THREE.Group();

        // Input Sources
        this.controllers = { left: null, right: null };

        // Visuals
        this.controller1 = null;
        this.controller2 = null;
        this.controllerGrip1 = null;
        this.controllerGrip2 = null;

        // Interaction
        this.raycaster = new THREE.Raycaster();
        this.tempMatrix = new THREE.Matrix4();
        this.interactables = []; // Avatar interactables
        this.uiInteractables = []; // UI panel interactables
        this.chatPanel = null; // Reference to VRChatPanel for dragging

        // Reusable vectors to avoid allocations each frame (important on Quest)
        this._tmpV1 = new THREE.Vector3();
        this._tmpV2 = new THREE.Vector3();

        // Grab State — grip-based (avatar rotation turntable)
        this.grabState = {
            active: false,
            hand: null,
            object: null,
            startHandAngle: 0,
            startObjectRotation: 0,
        };

        // UI Drag State — grip-based (chat panel drag)
        this.uiDragState = {
            active: false,
            hand: null,
        };

        // Grip button edge tracking (per hand)
        this._gripWasPressed = { left: false, right: false };

        // UI Callbacks
        this.onUIButtonClick = null;
        this.onMenuButtonPress = null; // Menu toggle callback (X / A)
        this.onPushToTalkStart = null; // PTT start callback (Y / B)
        this.onPushToTalkEnd = null; // PTT end callback (Y / B)

        // Edge-detection state for face buttons
        this._leftXWasPressed = false; // X button (left, menu)
        this._leftYWasPressed = false; // Y button (left, PTT)
        this._rightAWasPressed = false; // A button (right, menu)
        this._rightBWasPressed = false; // B button (right, PTT)

        // VR Bone Grabber (direct bone manipulation)
        this.boneGrabber = null; // Set via setBoneGrabber()
        this._boneGrabHand = null; // Which hand is doing a bone grab
        this._boneGrabController = null; // Controller ref for bone grab updates

        // Puppet Mode — free 3D avatar placement (translate instead of turntable)
        this.puppetMode = false;
        this._puppetState = {
            active: false,
            hand: null,
            object: null,
            startControllerPos: new THREE.Vector3(),
            startObjectPos: new THREE.Vector3(),
        };

        // VRPuppetInteraction — unified puppet interaction layer (set via setPuppetInteraction)
        this.puppetInteraction = null;
        this._puppetGripHands = new Set();

        // Hover state for UI
        this.hoveredUI = null;

        // Debug tracking for button/axes changes (edge-triggered logging)
        this._debugLastButtons = { left: [], right: [] };
        this.debugInput = true; // Set to false to disable detailed input logging

        this.init();
    }

    init() {
        console.log('[VRControllers] Initializing (xr-standard mapping)...');

        // 1. Setup Player Rig
        this.playerRig.add(this.camera);
        this.scene.add(this.playerRig);

        // 2. Setup Controllers
        this.setupControllers();

        console.log('[VRControllers] Ready. Grip=Grab, Trigger=Select, X/A=Menu, Y/B=PTT.');
    }

    // =========================================================================
    // SETUP & EVENTS
    // =========================================================================

    setupControllers() {
        // --- Controller 0 (Left) ---
        this.controller1 = this.renderer.xr.getController(0);
        this.playerRig.add(this.controller1);
        this._bindEvents(this.controller1, 0);

        // --- Controller 1 (Right) ---
        this.controller2 = this.renderer.xr.getController(1);
        this.playerRig.add(this.controller2);
        this._bindEvents(this.controller2, 1);

        // --- Visuals (Rays) ---
        this.addRayVisual(this.controller1);
        this.addRayVisual(this.controller2);

        // --- Grip Models ---
        this.controllerGrip1 = this.renderer.xr.getControllerGrip(0);
        this.addControllerModel(this.controllerGrip1);
        this.playerRig.add(this.controllerGrip1);

        this.controllerGrip2 = this.renderer.xr.getControllerGrip(1);
        this.addControllerModel(this.controllerGrip2);
        this.playerRig.add(this.controllerGrip2);
    }

    _bindEvents(controller, index) {
        const getHand = (data) => data?.handedness || (index === 0 ? 'left' : 'right');

        controller.addEventListener('connected', (e) => {
            const hand = getHand(e.data);
            this.controllers[hand] = e.data;
            console.log(`[VRControllers] Connected: ${hand}`);

            // Log gamepad info for debugging button mapping
            if (e.data?.gamepad) {
                const gp = e.data.gamepad;
                console.log(`[VRControllers] ${hand} gamepad:`, {
                    id: gp.id,
                    buttons: gp.buttons.length,
                    axes: gp.axes.length,
                    mapping: gp.mapping,
                });
            }
        });

        controller.addEventListener('disconnected', (e) => {
            const hand = getHand(e.data);
            this.controllers[hand] = null;
            if (this.grabState.active && this.grabState.hand === hand) {
                this._endGrab(hand);
            }
            if (this.uiDragState.active && this.uiDragState.hand === hand) {
                this._endUIDrag(hand);
            }
            console.log(`[VRControllers] Disconnected: ${hand}`);
        });

        // selectstart/selectend fires on TRIGGER press (buttons[0])
        // Used for UI click / ray-based selection (NOT grab)
        controller.addEventListener('selectstart', (e) => {
            const hand = getHand(e.data);
            this._onTriggerDown(controller, hand);
        });

        controller.addEventListener('selectend', (e) => {
            const hand = getHand(e.data);
            this._onTriggerUp(controller, hand);
        });

        // squeezestart/squeezeend fires on GRIP press (buttons[1])
        // Used for grab (industry standard: grip = grab/hold)
        controller.addEventListener('squeezestart', (e) => {
            const hand = getHand(e.data);
            this._onGripDown(controller, hand);
        });

        controller.addEventListener('squeezeend', (e) => {
            const hand = getHand(e.data);
            this._onGripUp(hand);
        });
    }

    addRayVisual(controller) {
        if (!controller) {
            return;
        }
        const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
            new THREE.LineBasicMaterial({ color: this.options.rayColor, opacity: 0.8, transparent: true })
        );
        line.name = 'ray';
        line.scale.z = this.options.rayLength;
        controller.add(line);
    }

    addControllerModel(grip) {
        if (!grip) {
            return;
        }
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.04, 16, 16),
            new THREE.MeshStandardMaterial({ color: 0x00e5ff, roughness: 0.5 })
        );
        grip.add(sphere);
    }

    // =========================================================================
    // TRIGGER — Select / UI Click (industry standard: trigger = point & click)
    // =========================================================================

    _onTriggerDown(controller, _hand) {
        this.tempMatrix.identity().extractRotation(controller.matrixWorld);
        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

        // Check UI interactions (trigger = click on UI)
        const uiIntersects = this.raycaster.intersectObjects(this.uiInteractables, false);
        if (uiIntersects.length > 0) {
            const uiTarget = uiIntersects[0].object;
            const hit = uiIntersects[0];
            this._handleUIClick(uiTarget, hit.point);
            return;
        }
    }

    _onTriggerUp(_controller, _hand) {
        // Trigger release — no action needed for click-based UI
    }

    // =========================================================================
    // GRIP — Grab & Hold (industry standard: grip = grab objects, drag panels)
    // =========================================================================

    _onGripDown(controller, hand) {
        console.log(
            `[VRControllers] Grip DOWN (${hand}) — puppetMode=${this.puppetMode}, boneGrabber=${!!this.boneGrabber}, active=${this.grabState.active}`
        );

        // PRIORITY -1: VRPuppetInteraction handles all puppet mode grips
        // This must run BEFORE the blocker below so the second hand can join
        if (this.puppetInteraction?.enabled && this.puppetInteraction.beginGrip(hand, controller)) {
            this._puppetGripHands.add(hand);
            return;
        }

        if (this.grabState.active || this.uiDragState.active || this._boneGrabHand) {
            console.log(
                `[VRControllers] Grip BLOCKED: already active (grab=${this.grabState.active}, uiDrag=${this.uiDragState.active}, boneGrab=${this._boneGrabHand})`
            );
            return;
        }

        // PRIORITY 0: Direct bone manipulation (grip to grab & pose avatar bones)
        // BUT: skip bone grab when puppet mode is active (puppet = whole body translate)
        if (!this.puppetMode && this.boneGrabber && this.boneGrabber.tryGrab(controller)) {
            this._boneGrabHand = hand;
            this._boneGrabController = controller;
            const line = controller.getObjectByName('ray');
            if (line) {
                line.material.color.setHex(0xff8800); // Orange ray for bone grab
            }
            console.log(`[VRControllers] Grip grab: Bone (${hand})`);
            return;
        }

        this.tempMatrix.identity().extractRotation(controller.matrixWorld);
        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

        // PRIORITY 1: Check UI panel drag (grip to grab panel handle)
        const uiIntersects = this.raycaster.intersectObjects(this.uiInteractables, false);
        if (uiIntersects.length > 0) {
            const uiTarget = uiIntersects[0].object;
            const hit = uiIntersects[0];

            if (this.chatPanel && uiTarget.userData && uiTarget.userData.type === 'handle') {
                const dragStarted = this.chatPanel.beginDrag ? this.chatPanel.beginDrag(hit.point) : false;
                if (dragStarted) {
                    this.uiDragState.active = true;
                    this.uiDragState.hand = hand;
                    const line = controller.getObjectByName('ray');
                    if (line) {
                        line.material.color.setHex(this.options.rayGrabColor);
                    }
                    console.log(`[VRControllers] Grip grab: UI panel (${hand})`);
                    return;
                }
            }
        }

        // PRIORITY 2: Check avatar grab interactions
        const intersects = this.raycaster.intersectObjects(this.interactables, true);

        if (intersects.length > 0) {
            let target = intersects[0].object;
            while (target) {
                if (target.userData && target.userData.isRotatable) {
                    // PUPPET MODE: free 3D translation (place avatar on real furniture)
                    if (this.puppetMode) {
                        this._puppetState.active = true;
                        this._puppetState.hand = hand;
                        this._puppetState.object = target;
                        controller.getWorldPosition(this._puppetState.startControllerPos);
                        this._puppetState.startObjectPos.copy(target.position);

                        const line = controller.getObjectByName('ray');
                        if (line) {
                            line.material.color.setHex(0xff00ff); // Magenta ray for puppet mode
                        }

                        console.log(`[VRControllers] Grip grab: Puppet (${hand}) — free 3D placement`);
                        return;
                    }

                    // NORMAL MODE: turntable rotation
                    this.grabState.active = true;
                    this.grabState.hand = hand;
                    this.grabState.object = target;

                    // Turntable mode using WORLD positions (stable on Quest)
                    controller.getWorldPosition(this._tmpV1);
                    target.getWorldPosition(this._tmpV2);

                    this.grabState.startHandAngle = Math.atan2(
                        this._tmpV1.x - this._tmpV2.x,
                        this._tmpV1.z - this._tmpV2.z
                    );

                    this.grabState.startObjectRotation = target.rotation.y;

                    const line = controller.getObjectByName('ray');
                    if (line) {
                        line.material.color.setHex(this.options.rayGrabColor);
                    }

                    console.log(`[VRControllers] Grip grab: Avatar (${hand}) — turntable mode`);
                    return;
                }
                target = target.parent;
            }
        }
    }

    _onGripUp(hand) {
        // Release puppet interaction if this hand was doing one
        if (this._puppetGripHands.has(hand)) {
            this.puppetInteraction?.endGrip(hand);
            this._puppetGripHands.delete(hand);
            return;
        }

        // Release bone grab if this hand was doing one
        if (this._boneGrabHand === hand) {
            if (this.boneGrabber) {
                this.boneGrabber.endGrab();
            }
            const controller = hand === 'left' ? this.controller1 : this.controller2;
            if (controller) {
                const line = controller.getObjectByName('ray');
                if (line) {
                    line.material.color.setHex(this.options.rayColor);
                }
            }
            this._boneGrabHand = null;
            this._boneGrabController = null;
            console.log(`[VRControllers] Grip release: Bone (${hand})`);
            return;
        }

        // Release puppet grab if this hand was doing one
        if (this._puppetState.active && this._puppetState.hand === hand) {
            const controller = hand === 'left' ? this.controller1 : this.controller2;
            if (controller) {
                const line = controller.getObjectByName('ray');
                if (line) {
                    line.material.color.setHex(this.options.rayColor);
                }
            }
            this._puppetState.active = false;
            this._puppetState.object = null;
            this._puppetState.hand = null;
            console.log(`[VRControllers] Grip release: Puppet (${hand})`);
            return;
        }

        this._endGrab(hand);
        this._endUIDrag(hand);
    }

    // =========================================================================
    // UI INTERACTION
    // =========================================================================

    _handleUIClick(mesh, hitPoint) {
        if (!mesh || !mesh.name) {
            return;
        }

        console.log(`[VRControllers] Trigger click: ${mesh.name}`);

        if (this.onUIButtonClick) {
            this.onUIButtonClick(mesh.name, mesh.userData, hitPoint);
        }
    }

    _updateUIHover() {
        if (!this.controller2) {
            return;
        }

        if (this.uiDragState.active || this.grabState.active) {
            return;
        }

        this.tempMatrix.identity().extractRotation(this.controller2.matrixWorld);
        this.raycaster.ray.origin.setFromMatrixPosition(this.controller2.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

        const uiIntersects = this.raycaster.intersectObjects(this.uiInteractables, false);

        // Reset previous hover
        if (this.hoveredUI && (uiIntersects.length === 0 || uiIntersects[0].object !== this.hoveredUI)) {
            if (this.hoveredUI.userData.onHoverExit) {
                this.hoveredUI.userData.onHoverExit(this.hoveredUI);
            }
            this.hoveredUI = null;
        }

        // Set new hover
        if (uiIntersects.length > 0) {
            const newHover = uiIntersects[0].object;
            if (newHover !== this.hoveredUI) {
                this.hoveredUI = newHover;
                if (this.hoveredUI.userData.onHoverEnter) {
                    this.hoveredUI.userData.onHoverEnter(this.hoveredUI);
                }
            }
        }
    }

    // =========================================================================
    // GRAB / DRAG STATE MANAGEMENT
    // =========================================================================

    _endGrab(hand) {
        if (this.grabState.active && this.grabState.hand === hand) {
            const controller = hand === 'left' ? this.controller1 : this.controller2;
            if (controller) {
                const line = controller.getObjectByName('ray');
                if (line) {
                    line.material.color.setHex(this.options.rayColor);
                }
            }
            this.grabState.active = false;
            this.grabState.object = null;
            this.grabState.hand = null;
            console.log('[VRControllers] Grip release: Avatar');
        }
    }

    _endUIDrag(hand) {
        if (this.uiDragState.active && this.uiDragState.hand === hand) {
            if (this.chatPanel && this.chatPanel.endDrag) {
                this.chatPanel.endDrag();
            }

            const controller = hand === 'left' ? this.controller1 : this.controller2;
            if (controller) {
                const line = controller.getObjectByName('ray');
                if (line) {
                    line.material.color.setHex(this.options.rayColor);
                }
            }

            this.uiDragState.active = false;
            this.uiDragState.hand = null;
            console.log('[VRControllers] Grip release: UI panel');
        }
    }

    _updateGrabbing() {
        if (!this.grabState.active || !this.grabState.object) {
            return;
        }

        const controller = this.grabState.hand === 'left' ? this.controller1 : this.controller2;
        if (!controller) {
            return;
        }

        // Compute hand angle around object using WORLD positions
        controller.getWorldPosition(this._tmpV1);
        this.grabState.object.getWorldPosition(this._tmpV2);

        const currentHandAngle = Math.atan2(this._tmpV1.x - this._tmpV2.x, this._tmpV1.z - this._tmpV2.z);

        // Wrap delta to avoid jumps at PI / -PI boundary
        let delta = currentHandAngle - this.grabState.startHandAngle;
        delta = ((delta + Math.PI) % (2 * Math.PI)) - Math.PI;

        // Apply 1:1 turntable rotation
        this.grabState.object.rotation.y = this.grabState.startObjectRotation + delta;
    }

    _updateUIDragging() {
        if (!this.uiDragState.active || !this.chatPanel) {
            return;
        }

        const controller = this.uiDragState.hand === 'left' ? this.controller1 : this.controller2;
        if (!controller) {
            return;
        }

        this.tempMatrix.identity().extractRotation(controller.matrixWorld);
        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

        const hits = this.raycaster.intersectObjects(this.chatPanel.getInteractables(), false);

        if (hits.length > 0) {
            this.chatPanel.dragTo(hits[0].point);
        } else {
            const fallbackDist = 1.0;
            const fallbackPoint = this.raycaster.ray.origin
                .clone()
                .add(this.raycaster.ray.direction.clone().multiplyScalar(fallbackDist));
            this.chatPanel.dragTo(fallbackPoint);
        }
    }

    // =========================================================================
    // BONE GRAB (per-frame update for direct bone manipulation)
    // =========================================================================

    _updateBoneGrab() {
        if (!this._boneGrabHand || !this._boneGrabController || !this.boneGrabber) {
            return;
        }
        this.boneGrabber.updateGrab(this._boneGrabController);
    }

    // =========================================================================
    // PUPPET MODE (per-frame update for free 3D avatar placement)
    // =========================================================================

    _updatePuppet() {
        if (!this._puppetState.active || !this._puppetState.object) {
            return;
        }

        const controller = this._puppetState.hand === 'left' ? this.controller1 : this.controller2;
        if (!controller) {
            return;
        }

        // Get current controller world position
        const currentPos = this._tmpV1;
        controller.getWorldPosition(currentPos);

        // Compute delta from grab start
        const dx = currentPos.x - this._puppetState.startControllerPos.x;
        const dy = currentPos.y - this._puppetState.startControllerPos.y;
        const dz = currentPos.z - this._puppetState.startControllerPos.z;

        // Apply delta to avatar's original position (1:1 movement)
        this._puppetState.object.position.set(
            this._puppetState.startObjectPos.x + dx,
            this._puppetState.startObjectPos.y + dy,
            this._puppetState.startObjectPos.z + dz
        );
    }

    // =========================================================================
    // FACE BUTTONS & LOCOMOTION (polled each frame)
    // =========================================================================

    pollGamepadInput(dt) {
        // --- LEFT CONTROLLER ---
        const left = this.controllers.left;
        if (left && left.gamepad) {
            const gp = left.gamepad;

            // Debug: edge-triggered button logging
            if (this.debugInput) {
                const last = this._debugLastButtons.left;
                gp.buttons.forEach((b, i) => {
                    const prevPressed = last[i]?.pressed ?? false;
                    if (b.pressed !== prevPressed) {
                        const action = b.pressed ? 'PRESSED' : 'RELEASED';
                        console.log(`[VRControllers] LEFT button[${i}] ${action} (value=${b.value.toFixed(2)})`);
                    }
                    last[i] = { pressed: b.pressed, value: b.value };
                });
            }

            // X button (buttons[4]) → Toggle chat panel (menu)
            const xBtn = gp.buttons[BTN.X_OR_A];
            if (xBtn && xBtn.pressed && !this._leftXWasPressed) {
                this._leftXWasPressed = true;
                console.log('[VRControllers] X button pressed — toggling chat panel');
                if (this.onMenuButtonPress) {
                    this.onMenuButtonPress();
                }
            } else if (!xBtn || !xBtn.pressed) {
                this._leftXWasPressed = false;
            }

            // Y button (buttons[5]) → Push-to-talk (hold to record)
            const yBtn = gp.buttons[BTN.Y_OR_B];
            if (yBtn && yBtn.pressed && !this._leftYWasPressed) {
                this._leftYWasPressed = true;
                if (this.onPushToTalkStart) {
                    console.log('[VRControllers] Y button (PTT): START');
                    this.onPushToTalkStart();
                }
            } else if ((!yBtn || !yBtn.pressed) && this._leftYWasPressed) {
                this._leftYWasPressed = false;
                if (this.onPushToTalkEnd) {
                    console.log('[VRControllers] Y button (PTT): END');
                    this.onPushToTalkEnd();
                }
            }

            // Left stick → Walk / Strafe
            const axes = gp.axes;
            let lx = 0;
            let ly = 0;
            if (axes.length >= 4) {
                lx = axes[2];
                ly = axes[3];
            } else if (axes.length >= 2) {
                lx = axes[0];
                ly = axes[1];
            }
            this._applyMove(lx, ly, dt);
        }

        // --- RIGHT CONTROLLER ---
        const right = this.controllers.right;
        if (right && right.gamepad) {
            const gp = right.gamepad;

            // Debug: edge-triggered button logging
            if (this.debugInput) {
                const last = this._debugLastButtons.right;
                gp.buttons.forEach((b, i) => {
                    const prevPressed = last[i]?.pressed ?? false;
                    if (b.pressed !== prevPressed) {
                        const action = b.pressed ? 'PRESSED' : 'RELEASED';
                        console.log(`[VRControllers] RIGHT button[${i}] ${action} (value=${b.value.toFixed(2)})`);
                    }
                    last[i] = { pressed: b.pressed, value: b.value };
                });
            }

            // A button (buttons[4]) → Toggle chat panel (alternative)
            const aBtn = gp.buttons[BTN.X_OR_A];
            if (aBtn && aBtn.pressed && !this._rightAWasPressed) {
                this._rightAWasPressed = true;
                console.log('[VRControllers] A button pressed — toggling chat panel');
                if (this.onMenuButtonPress) {
                    this.onMenuButtonPress();
                }
            } else if (!aBtn || !aBtn.pressed) {
                this._rightAWasPressed = false;
            }

            // B button (buttons[5]) → Push-to-talk (alternative, hold to record)
            const bBtn = gp.buttons[BTN.Y_OR_B];
            if (bBtn && bBtn.pressed && !this._rightBWasPressed) {
                this._rightBWasPressed = true;
                if (this.onPushToTalkStart) {
                    console.log('[VRControllers] B button (PTT): START');
                    this.onPushToTalkStart();
                }
            } else if ((!bBtn || !bBtn.pressed) && this._rightBWasPressed) {
                this._rightBWasPressed = false;
                if (this.onPushToTalkEnd) {
                    console.log('[VRControllers] B button (PTT): END');
                    this.onPushToTalkEnd();
                }
            }

            // Right stick → Snap Turn (X) / Fly Up-Down (Y)
            const axes = gp.axes;
            let rx = 0;
            let ry = 0;
            if (axes.length >= 4) {
                rx = axes[2];
                ry = axes[3];
            } else if (axes.length >= 2) {
                rx = axes[0];
                ry = axes[1];
            }
            this._applyTurn(rx, dt);
            this._applyVertical(ry, dt);
        }
    }

    _applyMove(x, y, dt) {
        if (Math.abs(x) < this.options.deadzone) {
            x = 0;
        }
        if (Math.abs(y) < this.options.deadzone) {
            y = 0;
        }
        if (x === 0 && y === 0) {
            return;
        }

        const xrCam = this.renderer.xr.getCamera(this.camera);
        const forward = new THREE.Vector3();
        xrCam.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();

        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));

        const speed = this.options.moveSpeed * dt;
        this.playerRig.position.addScaledVector(forward, -y * speed);
        this.playerRig.position.addScaledVector(right, x * speed);
    }

    _applyTurn(x, dt) {
        if (Math.abs(x) < this.options.deadzone) {
            return;
        }
        const speed = this.options.turnSpeed * dt;
        this.playerRig.rotateY(-x * speed);
    }

    _applyVertical(y, dt) {
        if (Math.abs(y) < this.options.deadzone) {
            return;
        }
        const speed = this.options.verticalSpeed * dt;
        this.playerRig.position.y += -y * speed;
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    update(dt) {
        if (!this.enabled || !this.renderer.xr.isPresenting) {
            return;
        }
        this.pollGamepadInput(dt);
        this._updateBoneGrab();
        this._updatePuppet();
        this._updateGrabbing();
        this._updateUIDragging();
        this._updateUIHover();
    }

    registerAvatar(avatarRoot) {
        if (!avatarRoot) {
            return;
        }
        avatarRoot.userData.isRotatable = true;
        this.interactables = [avatarRoot];
        console.log('[VRControllers] Avatar registered. Grip to grab & spin.');
    }

    registerUIInteractables(interactables) {
        if (!interactables || !Array.isArray(interactables)) {
            return;
        }
        this.uiInteractables = interactables;
        console.log(`[VRControllers] Registered ${interactables.length} UI interactables.`);
    }

    setUIButtonCallback(callback) {
        this.onUIButtonClick = callback;
    }

    setMenuButtonCallback(callback) {
        this.onMenuButtonPress = callback;
        console.log('[VRControllers] Menu button callback registered (X / A)');
    }

    /**
     * Set push-to-talk callbacks for VR voice input.
     * Y button (left) and B button (right) both trigger PTT.
     * @param {Function} onStart - Called when PTT button is pressed
     * @param {Function} onEnd - Called when PTT button is released
     */
    setPushToTalkCallbacks(onStart, onEnd) {
        this.onPushToTalkStart = onStart;
        this.onPushToTalkEnd = onEnd;
        console.log('[VRControllers] Push-to-talk callbacks registered (Y / B buttons)');
    }

    /**
     * Set the VRPuppetInteraction instance for unified puppet mode.
     * @param {import('./VRPuppetInteraction.js').VRPuppetInteraction} system
     */
    setPuppetInteraction(system) {
        this.puppetInteraction = system || null;
        console.log('[VRControllers] Puppet interaction system set');
    }

    /**
     * Set the VRBoneGrabber instance for direct bone manipulation.
     * @param {import('./VRBoneGrabber.js').VRBoneGrabber} grabber
     */
    setBoneGrabber(grabber) {
        this.boneGrabber = grabber || null;
        console.log('[VRControllers] Bone grabber set for direct bone manipulation');
    }

    /**
     * Enable/disable puppet mode (free 3D avatar placement).
     * When ON, grip on avatar translates it freely instead of turntable rotation.
     * @param {boolean} enabled
     */
    setPuppetMode(enabled) {
        this.puppetMode = enabled;
        // End any active puppet grab when mode is toggled off
        if (!enabled && this._puppetState.active) {
            const controller = this._puppetState.hand === 'left' ? this.controller1 : this.controller2;
            if (controller) {
                const line = controller.getObjectByName('ray');
                if (line) {
                    line.material.color.setHex(this.options.rayColor);
                }
            }
            this._puppetState.active = false;
            this._puppetState.object = null;
            this._puppetState.hand = null;
        }
        console.log(`[VRControllers] Puppet mode ${enabled ? 'ON' : 'OFF'}`);
    }

    setChatPanel(panel) {
        this.chatPanel = panel || null;
        console.log('[VRControllers] Chat panel reference set for grip-drag support');
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`[VRControllers] System ${enabled ? 'Enabled' : 'Disabled'}`);
        if (enabled) {
            this.playerRig.position.set(0, 0, 2.5);
            this.playerRig.rotation.set(0, 0, 0);
            console.log('[VRControllers] Positioned in front of avatar');
        }
    }

    resetPosition() {
        this.playerRig.position.set(0, 0, 0);
        this.playerRig.rotation.set(0, 0, 0);
        console.log('[VRControllers] Position Reset');
    }

    dispose() {
        if (this.controller1) {
            this.playerRig.remove(this.controller1);
        }
        if (this.controller2) {
            this.playerRig.remove(this.controller2);
        }
        if (this.controllerGrip1) {
            this.playerRig.remove(this.controllerGrip1);
        }
        if (this.controllerGrip2) {
            this.playerRig.remove(this.controllerGrip2);
        }
        if (this.playerRig) {
            this.scene.remove(this.playerRig);
        }

        this.interactables = [];
        this.uiInteractables = [];
        this.controllers = { left: null, right: null };
        console.log('[VRControllers] Disposed cleanly.');
    }
}
