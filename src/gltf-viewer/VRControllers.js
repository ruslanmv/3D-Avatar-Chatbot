/**
 * VR Controllers Module (Fixed for Meta Quest)
 * Handles controller input and locomotion for WebXR
 * FIX: Uses 'connected' event to capture gamepad data reliably
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

export class VRControllers {
    constructor(renderer, scene, camera, options = {}) {
        if (!renderer || !scene || !camera) {
            throw new Error('[VRControllers] renderer, scene, camera are required');
        }

        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        // Locomotion Settings
        this.playerRig = new THREE.Group();
        this.moveSpeed = 0.05; 
        this.verticalSpeed = 0.04;
        this.turnSpeed = 0.02;
        this.deadzone = 0.15;

        // Controller References (Visuals)
        this.controller1 = null; 
        this.controller2 = null;
        this.controllerGrip1 = null;
        this.controllerGrip2 = null;

        // Input Source Storage (The Fix)
        // We store the actual WebXR input sources here when they connect
        this.controllers = {
            left: null,
            right: null
        };

        // Interaction
        this.raycaster = new THREE.Raycaster();
        this.tempMatrix = new THREE.Matrix4();
        this.interactables = [];
        this.selecting = false;

        // State
        this.enabled = false;
        this.debug = true;

        this.init();
    }

    init() {
        // Setup Player Rig
        this.playerRig.add(this.camera);
        this.scene.add(this.playerRig);

        this.setupControllers();
        console.log('[VRControllers] Initialized - Meta Quest Fixed Mode');
    }

    // ---------- Setup ----------
    setupControllers() {
        // Controller 1 (Index 0)
        this.controller1 = this.renderer.xr.getController(0);
        this.controller1.addEventListener('selectstart', () => (this.selecting = true));
        this.controller1.addEventListener('selectend', () => (this.selecting = false));
        // IMPORTANT: Pass the event to the handler to capture input source
        this.controller1.addEventListener('connected', (e) => this.onControllerConnected(e));
        this.controller1.addEventListener('disconnected', (e) => this.onControllerDisconnected(e));
        this.scene.add(this.controller1);

        // Controller 2 (Index 1)
        this.controller2 = this.renderer.xr.getController(1);
        this.controller2.addEventListener('selectstart', () => (this.selecting = true));
        this.controller2.addEventListener('selectend', () => (this.selecting = false));
        this.controller2.addEventListener('connected', (e) => this.onControllerConnected(e));
        this.controller2.addEventListener('disconnected', (e) => this.onControllerDisconnected(e));
        this.scene.add(this.controller2);

        // Visuals (Rays & Grips)
        this.addRayVisual(this.controller1);
        this.addRayVisual(this.controller2);

        this.controllerGrip1 = this.renderer.xr.getControllerGrip(0);
        this.addControllerModel(this.controllerGrip1);
        this.scene.add(this.controllerGrip1);

        this.controllerGrip2 = this.renderer.xr.getControllerGrip(1);
        this.addControllerModel(this.controllerGrip2);
        this.scene.add(this.controllerGrip2);
    }

    addRayVisual(controller) {
        if (!controller) return;
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -1),
        ]);
        const material = new THREE.LineBasicMaterial({
            color: 0x00e5ff,
            linewidth: 2,
            opacity: 0.8,
            transparent: true,
        });
        const line = new THREE.Line(geometry, material);
        line.name = 'ray';
        line.scale.z = 5;
        controller.add(line);
    }

    addControllerModel(grip) {
        if (!grip) return;
        const geometry = new THREE.SphereGeometry(0.03, 16, 16);
        const material = new THREE.MeshStandardMaterial({
            color: 0x00e5ff,
            emissive: 0x00e5ff,
            emissiveIntensity: 0.5,
            roughness: 0.5,
            metalness: 0.5,
        });
        const sphere = new THREE.Mesh(geometry, material);
        grip.add(sphere);
    }

    // ---------- Event Handlers (The Fix) ----------
    
    onControllerConnected(event) {
        const xrInputSource = event.data;
        
        if (xrInputSource && xrInputSource.handedness) {
            console.log(`[VRControllers] Connected: ${xrInputSource.handedness}`);
            // Store the input source directly
            this.controllers[xrInputSource.handedness] = xrInputSource;
        }
    }

    onControllerDisconnected(event) {
        const xrInputSource = event.data;
        
        if (xrInputSource && xrInputSource.handedness) {
            console.log(`[VRControllers] Disconnected: ${xrInputSource.handedness}`);
            // clear the stored controller
            this.controllers[xrInputSource.handedness] = null;
        }
    }

    // ---------- Input Processing ----------

    pollGamepadInput(dt) {
        if (!this.enabled || !this.renderer.xr.isPresenting) return;

        // 1. Process Left Controller (Movement)
        const leftSource = this.controllers['left'];
        if (leftSource && leftSource.gamepad) {
            const axes = leftSource.gamepad.axes;
            
            // Quest controllers usually map [2, 3] for thumbsticks in some modes, 
            // but standard WebXR mapping is [2, 3] or [0, 1] depending on profile.
            // Standard mapping: axes[2] = X, axes[3] = Y for 'touchpad', 
            // but for THUMBSTICK it is usually axes[2] and axes[3].
            // HOWEVER, simple mapping often puts stick on 2/3. 
            // Let's try 2/3 first (common for XR Standard), fallback to 0/1.
            
            // Standard WebXR Gamepad mapping:
            // 0,1 = Trackpad (if present)
            // 2,3 = Thumbstick
            
            let x = 0, y = 0;
            
            if (axes.length >= 4) {
                x = axes[2];
                y = axes[3];
            } else if (axes.length >= 2) {
                x = axes[0];
                y = axes[1];
            }

            if (this.debug && (Math.abs(x) > 0.1 || Math.abs(y) > 0.1)) {
                 // console.log(`[VR] Left Stick: ${x.toFixed(2)}, ${y.toFixed(2)}`);
            }
            
            this.applyLocomotion(x, y, dt);
        }

        // 2. Process Right Controller (Rotation/Vertical)
        const rightSource = this.controllers['right'];
        if (rightSource && rightSource.gamepad) {
            const axes = rightSource.gamepad.axes;
            
            let x = 0, y = 0;
            if (axes.length >= 4) {
                x = axes[2];
                y = axes[3];
            } else if (axes.length >= 2) {
                x = axes[0];
                y = axes[1];
            }

            this.applyRotation(x, dt); 
            this.applyVerticalMovement(y, dt);
        }
    }

    applyLocomotion(x, y, dt) {
        if (Math.abs(x) < this.deadzone) x = 0;
        if (Math.abs(y) < this.deadzone) y = 0;
        if (x === 0 && y === 0) return;

        // Get camera direction (yaw only)
        const xrCamera = this.renderer.xr.getCamera(this.camera);
        const forward = new THREE.Vector3();
        xrCamera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();

        const right = new THREE.Vector3();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0));

        const speed = dt ? this.moveSpeed * dt * 60 : this.moveSpeed;

        // Note: y is usually inverted on gamepads (-1 is forward)
        // If your controls are backward, flip the signs here
        this.playerRig.position.addScaledVector(forward, -y * speed);
        this.playerRig.position.addScaledVector(right, x * speed);
    }

    applyRotation(x, dt) {
        if (Math.abs(x) < this.deadzone) return;

        const speed = dt ? this.turnSpeed * dt * 60 : this.turnSpeed;
        // Negative x usually turns Left, Positive Right
        this.playerRig.rotateY(-x * speed);
    }

    applyVerticalMovement(y, dt) {
        if (Math.abs(y) < this.deadzone) return;

        const speed = dt ? this.verticalSpeed * dt * 60 : this.verticalSpeed;
        // -y to pull up, +y to push down usually, adjust to preference
        this.playerRig.position.y += -y * speed;
    }

    // ---------- Standard Methods ----------

    update(dt) {
        if (!this.enabled || !this.renderer || !this.renderer.xr.isPresenting) return;
        this.pollGamepadInput(dt);
        this.handleRayInteraction();
    }

    handleRayInteraction() {
        if (!this.enabled || !this.renderer.xr.isPresenting) return;
        
        [this.controller1, this.controller2].forEach((controller) => {
            if (!controller) return;
            
            const intersections = this.getIntersections(controller);
            const line = controller.getObjectByName('ray');

            if (line) {
                if (intersections.length > 0) {
                    line.scale.z = intersections[0].distance;
                    line.material.color.setHex(0x00ff00);
                } else {
                    line.scale.z = 5;
                    line.material.color.setHex(0x00e5ff);
                }
            }

            if (this.selecting && intersections.length > 0) {
                const hit = intersections[0];
                if (hit.object.userData?.onClick) {
                    hit.object.userData.onClick(hit);
                }
            }
        });
    }

    getIntersections(controller) {
        this.tempMatrix.identity().extractRotation(controller.matrixWorld);
        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);
        return this.raycaster.intersectObjects(this.interactables, true);
    }

    addInteractable(object, callback) {
        object.userData.onClick = callback;
        this.interactables.push(object);
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`[VRControllers] ${enabled ? 'Enabled' : 'Disabled'}`);
    }

    dispose() {
        if (this.controller1) this.scene.remove(this.controller1);
        if (this.controller2) this.scene.remove(this.controller2);
        if (this.controllerGrip1) this.scene.remove(this.controllerGrip1);
        if (this.controllerGrip2) this.scene.remove(this.controllerGrip2);
        if (this.playerRig) this.scene.remove(this.playerRig);
        this.interactables = [];
    }
}