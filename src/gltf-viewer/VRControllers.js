/**
 * VR Controllers Module (Production Ready - Standard Exploration)
 * --------------------------------------------------------
 * CONTROLS:
 * - Left Stick:  Move Walk / Strafe
 * - Right Stick: Turn (X-axis) / Fly Up & Down (Y-axis)
 * - Triggers:    "Grab and Spin" the Avatar OR "Drag" the UI Panel
 * --------------------------------------------------------
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

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
            rotationSensitivity: 3.5, // Used for yaw-based spin responsiveness if you later add smoothing
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

        // Dragging State (Avatar rotation)
        // FIX: switch from previousX to turntable angle tracking
        this.dragState = {
            active: false,
            hand: null,
            object: null,
            startHandAngle: 0,
            startObjectRotation: 0,
        };

        // UI Drag State (for dragging chat panel)
        this.uiDragState = {
            active: false,
            hand: null,
        };

        // UI Callbacks
        this.onUIButtonClick = null;
        this.onMenuButtonPress = null; // Menu toggle callback
        this.menuButtonWasPressed = false; // Track button state
        this.onPushToTalkStart = null; // Push-to-talk start callback
        this.onPushToTalkEnd = null; // Push-to-talk end callback
        this.pushToTalkButtonWasPressed = false; // Track PTT button state

        // Hover state for UI
        this.hoveredUI = null;

        this.init();
    }

    init() {
        console.log('[VRControllers] Initializing...');

        // 1. Setup Player Rig
        this.playerRig.add(this.camera);
        this.scene.add(this.playerRig);

        // 2. Setup Controllers
        this.setupControllers();

        console.log('[VRControllers] Ready. Standard Exploration + Grab Spin.');
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
        });

        controller.addEventListener('disconnected', (e) => {
            const hand = getHand(e.data);
            this.controllers[hand] = null;
            if (this.dragState.active && this.dragState.hand === hand) {
                this._endDrag(hand);
            }
            if (this.uiDragState.active && this.uiDragState.hand === hand) {
                this._endUIDrag(hand);
            }
            console.log(`[VRControllers] Disconnected: ${hand}`);
        });

        controller.addEventListener('selectstart', (e) => {
            const hand = getHand(e.data);
            this._startDrag(controller, hand);
        });

        controller.addEventListener('selectend', (e) => {
            const hand = getHand(e.data);
            this._endDrag(hand);
            this._endUIDrag(hand);
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
    // INTERACTION LOGIC (GRAB & SPIN)
    // =========================================================================

    _startDrag(controller, hand) {
        if (this.dragState.active || this.uiDragState.active) {
            return;
        }

        this.tempMatrix.identity().extractRotation(controller.matrixWorld);
        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

        // PRIORITY 1: Check UI interactions first
        const uiIntersects = this.raycaster.intersectObjects(this.uiInteractables, false);
        if (uiIntersects.length > 0) {
            const uiTarget = uiIntersects[0].object;
            const hit = uiIntersects[0];

            // Quest 3 panel is always draggable (no pin concept)
            if (this.chatPanel && uiTarget.userData && uiTarget.userData.type === 'handle') {
                const dragStarted = this.chatPanel.beginDrag ? this.chatPanel.beginDrag(hit.point) : false;
                if (dragStarted) {
                    this.uiDragState.active = true;
                    this.uiDragState.hand = hand;
                    const line = controller.getObjectByName('ray');
                    if (line) {
                        line.material.color.setHex(this.options.rayGrabColor);
                    }
                    console.log(`[VRControllers] 🖐️ Started dragging UI panel (${hand})`);
                    return;
                }
            }

            // Otherwise handle as normal UI click
            this._handleUIClick(uiTarget);
            return;
        }

        // PRIORITY 2: Check avatar grab interactions
        const intersects = this.raycaster.intersectObjects(this.interactables, true);

        if (intersects.length > 0) {
            let target = intersects[0].object;
            while (target) {
                if (target.userData && target.userData.isRotatable) {
                    this.dragState.active = true;
                    this.dragState.hand = hand;
                    this.dragState.object = target;

                    // ✅ FIX: turntable mode using WORLD positions (stable on Quest)
                    controller.getWorldPosition(this._tmpV1);
                    target.getWorldPosition(this._tmpV2);

                    this.dragState.startHandAngle = Math.atan2(
                        this._tmpV1.x - this._tmpV2.x,
                        this._tmpV1.z - this._tmpV2.z
                    );

                    this.dragState.startObjectRotation = target.rotation.y;

                    const line = controller.getObjectByName('ray');
                    if (line) {
                        line.material.color.setHex(this.options.rayGrabColor);
                    }

                    console.log(`[VRControllers] ✊ Grabbed Avatar (${hand}) - Turntable mode (world-space)`);
                    return;
                }
                target = target.parent;
            }
        }
    }

    _handleUIClick(mesh) {
        if (!mesh || !mesh.name) {
            return;
        }

        console.log(`[VRControllers] 👆 UI Click: ${mesh.name}`);

        if (this.onUIButtonClick) {
            this.onUIButtonClick(mesh.name, mesh.userData);
        }
    }

    _updateUIHover() {
        if (!this.controller2) {
            return;
        }

        if (this.uiDragState.active || this.dragState.active) {
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

    _endDrag(hand) {
        if (this.dragState.active && this.dragState.hand === hand) {
            const controller = hand === 'left' ? this.controller1 : this.controller2;
            if (controller) {
                const line = controller.getObjectByName('ray');
                if (line) {
                    line.material.color.setHex(this.options.rayColor);
                }
            }
            this.dragState.active = false;
            this.dragState.object = null;
            this.dragState.hand = null;
            console.log('[VRControllers] ✋ Released Avatar');
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
            console.log('[VRControllers] ✋ Released UI panel');
        }
    }

    _updateDragging() {
        if (!this.dragState.active || !this.dragState.object) {
            return;
        }

        const controller = this.dragState.hand === 'left' ? this.controller1 : this.controller2;
        if (!controller) {
            return;
        }

        // ✅ FIX: compute hand angle around object using WORLD positions
        controller.getWorldPosition(this._tmpV1);
        this.dragState.object.getWorldPosition(this._tmpV2);

        const currentHandAngle = Math.atan2(
            this._tmpV1.x - this._tmpV2.x,
            this._tmpV1.z - this._tmpV2.z
        );

        // ✅ FIX: wrap delta to avoid jumps at PI / -PI boundary
        let delta = currentHandAngle - this.dragState.startHandAngle;
        delta = ((delta + Math.PI) % (2 * Math.PI)) - Math.PI;

        // Apply 1:1 turntable rotation (no stepping)
        this.dragState.object.rotation.y = this.dragState.startObjectRotation + delta;
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
    // LOCOMOTION (STANDARD VR EXPLORATION)
    // =========================================================================

    pollGamepadInput(dt) {
        // Menu button check on left controller
        const left = this.controllers.left;
        if (left && left.gamepad) {
            // Button index 4 is typically "Menu" or "X" button on left controller
            // Button index 3 is fallback
            const menuButton = left.gamepad.buttons[4] || left.gamepad.buttons[3];
            if (menuButton && menuButton.pressed && !this.menuButtonWasPressed) {
                this.menuButtonWasPressed = true;
                if (this.onMenuButtonPress) {
                    this.onMenuButtonPress();
                }
            } else if (!menuButton || !menuButton.pressed) {
                this.menuButtonWasPressed = false;
            }

            // Push-to-talk button check on left controller
            // Button index 5 is typically "Y" button, index 1 is grip/squeeze
            const pttButton = left.gamepad.buttons[5] || left.gamepad.buttons[1];
            if (pttButton && pttButton.pressed && !this.pushToTalkButtonWasPressed) {
                this.pushToTalkButtonWasPressed = true;
                if (this.onPushToTalkStart) {
                    console.log('[VRControllers] 🎤 Push-to-talk: START');
                    this.onPushToTalkStart();
                }
            } else if ((!pttButton || !pttButton.pressed) && this.pushToTalkButtonWasPressed) {
                this.pushToTalkButtonWasPressed = false;
                if (this.onPushToTalkEnd) {
                    console.log('[VRControllers] 🎤 Push-to-talk: END');
                    this.onPushToTalkEnd();
                }
            }

            // 1. Left Hand -> Walk / Strafe
            const axes = left.gamepad.axes;
            let x = 0;
            let y = 0;
            if (axes.length >= 4) {
                x = axes[2];
                y = axes[3];
            } else if (axes.length >= 2) {
                x = axes[0];
                y = axes[1];
            }

            this._applyMove(x, y, dt);
        }

        // 2. Right Hand -> Turn (X) + Fly Up/Down (Y)
        const right = this.controllers.right;
        if (right && right.gamepad) {
            const axes = right.gamepad.axes;
            let x = 0;
            let y = 0;
            // Standard WebXR often maps stick to 2,3
            if (axes.length >= 4) {
                x = axes[2];
                y = axes[3];
            } else if (axes.length >= 2) {
                x = axes[0];
                y = axes[1];
            }

            this._applyTurn(x, dt);
            this._applyVertical(y, dt);
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
        this._updateDragging(); // rotation fix lives here
        this._updateUIDragging();
        this._updateUIHover();
    }

    registerAvatar(avatarRoot) {
        if (!avatarRoot) {
            return;
        }
        avatarRoot.userData.isRotatable = true;
        this.interactables = [avatarRoot];
        console.log('[VRControllers] Avatar registered. Hold trigger to spin.');
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
        console.log('[VRControllers] Menu button callback registered');
    }

    /**
     * Set push-to-talk callbacks for VR voice input
     * @param {Function} onStart - Called when PTT button is pressed
     * @param {Function} onEnd - Called when PTT button is released
     */
    setPushToTalkCallbacks(onStart, onEnd) {
        this.onPushToTalkStart = onStart;
        this.onPushToTalkEnd = onEnd;
        console.log('[VRControllers] 🎤 Push-to-talk callbacks registered (Y button or grip)');
    }

    setChatPanel(panel) {
        this.chatPanel = panel || null;
        console.log('[VRControllers] Chat panel reference set for dragging support');
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
