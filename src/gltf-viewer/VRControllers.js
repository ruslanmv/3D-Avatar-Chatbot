/**
 * VR Controllers Module (Production Ready - Standard Exploration)
 * --------------------------------------------------------
 * CONTROLS:
 * - Left Stick:  Move Walk / Strafe
 * - Right Stick: Turn (X-axis) / Fly Up & Down (Y-axis) <-- RESTORED
 * - Triggers:    "Grab and Spin" the Avatar
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
            moveSpeed: 1.8,       // Horizontal speed
            verticalSpeed: 1.2,   // Vertical fly speed (Restored)
            turnSpeed: 2.0,       // Turning speed
            rotationSensitivity: 4.5, // Avatar spin speed
            deadzone: 0.15,       // Stick deadzone
            rayLength: 5,         
            rayColor: 0x00e5ff,   
            rayGrabColor: 0x00ff00, 
            ...options
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
        this.interactables = []; 

        // Dragging State
        this.dragState = {
            active: false,
            hand: null,      
            object: null,    
            previousX: 0     
        };

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
            console.log(`[VRControllers] Disconnected: ${hand}`);
        });

        controller.addEventListener('selectstart', (e) => {
            const hand = getHand(e.data);
            this._startDrag(controller, hand);
        });

        controller.addEventListener('selectend', (e) => {
            const hand = getHand(e.data);
            this._endDrag(hand);
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
    // INTERACTION LOGIC (GRAB & SPIN)
    // =========================================================================

    _startDrag(controller, hand) {
        if (this.dragState.active) return; 

        this.tempMatrix.identity().extractRotation(controller.matrixWorld);
        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

        const intersects = this.raycaster.intersectObjects(this.interactables, true);

        if (intersects.length > 0) {
            let target = intersects[0].object;
            while (target) {
                if (target.userData && target.userData.isRotatable) {
                    this.dragState.active = true;
                    this.dragState.hand = hand;
                    this.dragState.object = target;
                    this.dragState.previousX = controller.position.x;

                    const line = controller.getObjectByName('ray');
                    if (line) line.material.color.setHex(this.options.rayGrabColor);

                    console.log(`[VRControllers] ✊ Grabbed Avatar (${hand})`);
                    return;
                }
                target = target.parent;
            }
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
            console.log(`[VRControllers] ✋ Released Avatar`);
        }
    }

    _updateDragging() {
        if (!this.dragState.active || !this.dragState.object) return;

        const controller = this.dragState.hand === 'left' ? this.controller1 : this.controller2;
        if (!controller) return;

        const currentX = controller.position.x;
        const deltaX = currentX - this.dragState.previousX;

        if (Math.abs(deltaX) > 0.0001) {
            this.dragState.object.rotation.y += deltaX * this.options.rotationSensitivity;
        }
        this.dragState.previousX = currentX;
    }

    // =========================================================================
    // LOCOMOTION (STANDARD VR EXPLORATION)
    // =========================================================================

    pollGamepadInput(dt) {
        // 1. Left Hand -> Walk / Strafe
        const left = this.controllers.left;
        if (left && left.gamepad) {
            const axes = left.gamepad.axes;
            let x = 0, y = 0;
            if (axes.length >= 4) { x = axes[2]; y = axes[3]; }
            else if (axes.length >= 2) { x = axes[0]; y = axes[1]; }
            
            this._applyMove(x, y, dt);
        }

        // 2. Right Hand -> Turn (X) + Fly Up/Down (Y)
        const right = this.controllers.right;
        if (right && right.gamepad) {
            const axes = right.gamepad.axes;
            let x = 0, y = 0;
            // Standard WebXR often maps stick to 2,3
            if (axes.length >= 4) { x = axes[2]; y = axes[3]; }
            else if (axes.length >= 2) { x = axes[0]; y = axes[1]; }
            
            this._applyTurn(x, dt);
            this._applyVertical(y, dt); // RESTORED
        }
    }

    _applyMove(x, y, dt) {
        if (Math.abs(x) < this.options.deadzone) x = 0;
        if (Math.abs(y) < this.options.deadzone) y = 0;
        if (x === 0 && y === 0) return;

        // Get Camera Direction (Ground Projected)
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
        if (Math.abs(x) < this.options.deadzone) return;
        const speed = this.options.turnSpeed * dt;
        this.playerRig.rotateY(-x * speed);
    }

    // RESTORED: Fly Up/Down Logic
    _applyVertical(y, dt) {
        if (Math.abs(y) < this.options.deadzone) return;
        const speed = this.options.verticalSpeed * dt;
        // -y is typically "up" on thumbstick push
        this.playerRig.position.y += -y * speed;
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    update(dt) {
        if (!this.enabled || !this.renderer.xr.isPresenting) return;
        this.pollGamepadInput(dt);
        this._updateDragging();
    }

    registerAvatar(avatarRoot) {
        if (!avatarRoot) return;
        avatarRoot.userData.isRotatable = true;
        if (!this.interactables.includes(avatarRoot)) {
            this.interactables.push(avatarRoot);
        }
        console.log('[VRControllers] Avatar registered. Hold trigger to spin.');
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`[VRControllers] System ${enabled ? 'Enabled' : 'Disabled'}`);
        if (enabled) {
            this.playerRig.position.set(0, 0, 0);
            this.playerRig.rotation.set(0, 0, 0);
        }
    }

    resetPosition() {
        this.playerRig.position.set(0, 0, 0);
        this.playerRig.rotation.set(0, 0, 0);
        console.log('[VRControllers] Position Reset');
    }

    dispose() {
        if (this.controller1) this.playerRig.remove(this.controller1);
        if (this.controller2) this.playerRig.remove(this.controller2);
        if (this.controllerGrip1) this.playerRig.remove(this.controllerGrip1);
        if (this.controllerGrip2) this.playerRig.remove(this.controllerGrip2);
        if (this.playerRig) this.scene.remove(this.playerRig);

        this.interactables = [];
        this.controllers = { left: null, right: null };
        console.log('[VRControllers] Disposed cleanly.');
    }
}