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

        this.options = {
            moveSpeed: 1.8,
            verticalSpeed: 1.2,
            turnSpeed: 2.0,
            rotationSensitivity: 5.5,
            deadzone: 0.15,
            rayLength: 5,
            rayColor: 0x00e5ff,
            rayGrabColor: 0x00ff00,
            ...options,
        };

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
        this.interactables = [];      // Avatar interactables
        this.uiInteractables = [];    // UI panel interactables
        this.chatPanel = null;        // Reference to VRChatPanel

        // Dragging State (Avatar)
        this.dragState = { active: false, hand: null, object: null, previousX: 0 };

        // Dragging State (UI Panel)
        this.uiDragState = { active: false, hand: null };

        // UI Callbacks
        this.onUIButtonClick = null;
        this.onMenuButtonPress = null;
        this.menuButtonWasPressed = false;
        this.hoveredUI = null;

        this.init();
    }

    // Pass the panel instance so we can call beginDrag/dragTo
    setChatPanel(panel) {
        this.chatPanel = panel || null;
    }

    init() {
        console.log('[VRControllers] Initializing...');
        this.playerRig.add(this.camera);
        this.scene.add(this.playerRig);
        this.setupControllers();
        console.log('[VRControllers] Ready.');
    }

    // =========================================================================
    // SETUP & EVENTS
    // =========================================================================

    setupControllers() {
        // --- Left Controller (0) ---
        this.controller1 = this.renderer.xr.getController(0);
        this.playerRig.add(this.controller1);
        this._bindEvents(this.controller1, 0);

        // --- Right Controller (1) ---
        this.controller2 = this.renderer.xr.getController(1);
        this.playerRig.add(this.controller2);
        this._bindEvents(this.controller2, 1);

        this.addRayVisual(this.controller1);
        this.addRayVisual(this.controller2);

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
        });

        controller.addEventListener('disconnected', (e) => {
            const hand = getHand(e.data);
            this.controllers[hand] = null;
            // Stop drags if controller disconnects
            if (this.dragState.active && this.dragState.hand === hand) {
                this._endDrag(hand);
            }
            if (this.uiDragState.active && this.uiDragState.hand === hand) {
                this._endUIDrag(hand);
            }
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
        if (!controller) return;
        const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
            new THREE.LineBasicMaterial({ color: this.options.rayColor, opacity: 0.8, transparent: true })
        );
        line.name = 'ray';
        line.scale.z = this.options.rayLength;
        controller.add(line);
    }

    addControllerModel(grip) {
        if (!grip) return;
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.04, 16, 16),
            new THREE.MeshStandardMaterial({ color: 0x00e5ff, roughness: 0.5 })
        );
        grip.add(sphere);
    }

    // =========================================================================
    // INTERACTION LOGIC
    // =========================================================================

    _startDrag(controller, hand) {
        if (this.dragState.active || this.uiDragState.active) return;

        this.tempMatrix.identity().extractRotation(controller.matrixWorld);
        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

        // 1. UI Check (Buttons OR Handle Drag)
        const uiIntersects = this.raycaster.intersectObjects(this.uiInteractables, false);
        if (uiIntersects.length > 0) {
            const hit = uiIntersects[0];
            const target = hit.object;

            // Is it the Drag Handle? (Must be unpinned to move)
            if (this.chatPanel && !this.chatPanel.isPinned && target.userData?.type === 'handle') {
                if (this.chatPanel.beginDrag(hit.point)) {
                    this.uiDragState = { active: true, hand };
                    const line = controller.getObjectByName('ray');
                    if (line) line.material.color.setHex(this.options.rayGrabColor);
                    console.log(`[VRControllers] Started dragging UI with ${hand}`);
                }
                return;
            }

            // Normal Button Click
            this._handleUIClick(target);
            return;
        }

        // 2. Avatar Grab (Spin)
        const intersects = this.raycaster.intersectObjects(this.interactables, true);
        if (intersects.length > 0) {
            let target = intersects[0].object;
            while (target) {
                if (target.userData && target.userData.isRotatable) {
                    this.dragState = { active: true, hand, object: target, previousX: controller.position.x };
                    const line = controller.getObjectByName('ray');
                    if (line) line.material.color.setHex(this.options.rayGrabColor);
                    return;
                }
                target = target.parent;
            }
        }
    }

    _handleUIClick(mesh) {
        if (mesh && mesh.name && this.onUIButtonClick) {
            this.onUIButtonClick(mesh.name, mesh.userData);
        }
    }

    _endDrag(hand) {
        if (this.dragState.active && this.dragState.hand === hand) {
            const controller = hand === 'left' ? this.controller1 : this.controller2;
            if (controller) {
                const line = controller.getObjectByName('ray');
                if (line) line.material.color.setHex(this.options.rayColor);
            }
            this.dragState.active = false;
            this.dragState.object = null;
            this.dragState.hand = null;
        }
    }

    _endUIDrag(hand) {
        if (this.uiDragState.active && this.uiDragState.hand === hand) {
            if (this.chatPanel) this.chatPanel.endDrag();
            
            const controller = hand === 'left' ? this.controller1 : this.controller2;
            if (controller) {
                const line = controller.getObjectByName('ray');
                if (line) line.material.color.setHex(this.options.rayColor);
            }
            
            this.uiDragState.active = false;
            this.uiDragState.hand = null;
        }
    }

    _updateDragging() {
        if (!this.dragState.active || !this.dragState.object) return;

        const controller = this.dragState.hand === 'left' ? this.controller1 : this.controller2;
        if (!controller) return;

        const currentX = controller.position.x;
        const delta = currentX - this.dragState.previousX;

        // Spin Avatar
        if (Math.abs(delta) > 0.0001) {
            this.dragState.object.rotation.y += delta * this.options.rotationSensitivity;
        }
        this.dragState.previousX = currentX;
    }

    // [FIX] Added missing method
    _updateUIDragging() {
        if (!this.uiDragState.active || !this.chatPanel) return;

        const controller = this.uiDragState.hand === 'left' ? this.controller1 : this.controller2;
        if (!controller) return;

        this.tempMatrix.identity().extractRotation(controller.matrixWorld);
        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

        // Raycast against panel elements to find current world hit point
        // We use the panel interactables (which include the handle and panel surface)
        const hits = this.raycaster.intersectObjects(this.chatPanel.getInteractables(), false);
        
        if (hits.length > 0) {
            this.chatPanel.dragTo(hits[0].point);
        }
    }

    // [FIX] Added missing method
    _updateUIHover() {
        if (!this.controller2) return; // Right hand is pointer

        // Skip hover check if dragging to save perf
        if (this.uiDragState.active || this.dragState.active) return;

        this.tempMatrix.identity().extractRotation(this.controller2.matrixWorld);
        this.raycaster.ray.origin.setFromMatrixPosition(this.controller2.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

        const intersects = this.raycaster.intersectObjects(this.uiInteractables, false);

        // Hover Exit
        if (this.hoveredUI && (!intersects.length || intersects[0].object !== this.hoveredUI)) {
            if (this.hoveredUI.userData.onHoverExit) {
                this.hoveredUI.userData.onHoverExit(this.hoveredUI);
            }
            this.hoveredUI = null;
        }

        // Hover Enter
        if (intersects.length > 0) {
            const newHover = intersects[0].object;
            if (newHover !== this.hoveredUI) {
                this.hoveredUI = newHover;
                if (this.hoveredUI.userData.onHoverEnter) {
                    this.hoveredUI.userData.onHoverEnter(this.hoveredUI);
                }
            }
        }
    }

    // =========================================================================
    // LOCOMOTION
    // =========================================================================

    pollGamepadInput(dt) {
        const left = this.controllers.left;
        if (left && left.gamepad) {
            // Menu Toggle (Button 4/Menu or 3/X)
            const menuBtn = left.gamepad.buttons[4] || left.gamepad.buttons[3];
            if (menuBtn && menuBtn.pressed && !this.menuButtonWasPressed) {
                this.menuButtonWasPressed = true;
                if (this.onMenuButtonPress) this.onMenuButtonPress();
            } else if (!menuBtn || !menuBtn.pressed) {
                this.menuButtonWasPressed = false;
            }

            const axes = left.gamepad.axes;
            if (axes.length >= 4) this._applyMove(axes[2], axes[3], dt);
        }

        const right = this.controllers.right;
        if (right && right.gamepad) {
            const axes = right.gamepad.axes;
            if (axes.length >= 4) {
                this._applyTurn(axes[2], dt);
                this._applyVertical(axes[3], dt);
            }
        }
    }

    _applyMove(x, y, dt) {
        if (Math.abs(x) < 0.15 && Math.abs(y) < 0.15) return;
        const cam = this.renderer.xr.getCamera(this.camera);
        const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
        const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0,1,0));
        const speed = this.options.moveSpeed * dt;
        this.playerRig.position.addScaledVector(fwd, -y * speed);
        this.playerRig.position.addScaledVector(right, x * speed);
    }

    _applyTurn(x, dt) {
        if (Math.abs(x) < 0.15) return;
        this.playerRig.rotateY(-x * this.options.turnSpeed * dt);
    }

    _applyVertical(y, dt) {
        if (Math.abs(y) < 0.15) return;
        this.playerRig.position.y += -y * this.options.verticalSpeed * dt;
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    update(dt) {
        if (!this.enabled || !this.renderer.xr.isPresenting) return;
        
        this.pollGamepadInput(dt);
        this._updateDragging();
        
        // [FIX] Ensure these are called
        this._updateUIDragging();
        this._updateUIHover();
    }

    registerAvatar(root) {
        if (!root) return;
        root.userData.isRotatable = true;
        // [FIX] Clear old avatar interactables
        this.interactables = [root];
    }

    registerUIInteractables(list) {
        this.uiInteractables = list || [];
    }

    setUIButtonCallback(cb) { this.onUIButtonClick = cb; }
    setMenuButtonCallback(cb) { this.onMenuButtonPress = cb; }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (enabled) {
            this.playerRig.position.set(0, 0, 2.5);
            this.playerRig.rotation.set(0, 0, 0);
        }
    }

    resetPosition() {
        this.playerRig.position.set(0, 0, 0);
        this.playerRig.rotation.set(0, 0, 0);
    }

    dispose() {
        if (this.controller1) this.playerRig.remove(this.controller1);
        if (this.controller2) this.playerRig.remove(this.controller2);
        if (this.controllerGrip1) this.playerRig.remove(this.controllerGrip1);
        if (this.controllerGrip2) this.playerRig.remove(this.controllerGrip2);
        if (this.playerRig) this.scene.remove(this.playerRig);
        this.interactables = [];
        this.uiInteractables = [];
    }
}