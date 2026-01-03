/**
 * VR Controllers Module (Simplified - Movement Focus)
 * Handles controller input and locomotion for WebXR
 * PRIORITY: Make joypads work for navigation
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

        // Locomotion (using old working values)
        this.playerRig = new THREE.Group();
        this.moveSpeed = 0.05; // meters per frame (old working value)
        this.verticalSpeed = 0.04; // meters per frame
        this.turnSpeed = 0.02; // radians per frame
        this.deadzone = 0.15;

        // Controllers
        this.controller1 = null; // index 0 (left)
        this.controller2 = null; // index 1 (right)
        this.controllerGrip1 = null;
        this.controllerGrip2 = null;

        // Interaction
        this.raycaster = new THREE.Raycaster();
        this.tempMatrix = new THREE.Matrix4();
        this.interactables = [];
        this.selecting = false;

        // State
        this.enabled = false;

        // Debug mode
        this.debug = true;

        this.init();
    }

    init() {
        // Put camera under rig (so moving rig moves the "player")
        this.playerRig.add(this.camera);
        this.scene.add(this.playerRig);

        this.setupControllers();
        console.log('[VRControllers] Initialized - Movement Focus Mode');
    }

    // ---------- Setup ----------
    setupControllers() {
        // Controller 1 (index 0 - typically left)
        this.controller1 = this.renderer.xr.getController(0);
        this.controller1.addEventListener('selectstart', () => (this.selecting = true));
        this.controller1.addEventListener('selectend', () => (this.selecting = false));
        this.controller1.addEventListener('connected', (event) => this.onControllerConnected(event, 0));
        this.controller1.addEventListener('disconnected', () => this.onControllerDisconnected(0));
        this.scene.add(this.controller1);

        // Controller 2 (index 1 - typically right)
        this.controller2 = this.renderer.xr.getController(1);
        this.controller2.addEventListener('selectstart', () => (this.selecting = true));
        this.controller2.addEventListener('selectend', () => (this.selecting = false));
        this.controller2.addEventListener('connected', (event) => this.onControllerConnected(event, 1));
        this.controller2.addEventListener('disconnected', () => this.onControllerDisconnected(1));
        this.scene.add(this.controller2);

        // Add ray visualizations
        this.addRayVisual(this.controller1);
        this.addRayVisual(this.controller2);

        // Add controller grips
        this.controllerGrip1 = this.renderer.xr.getControllerGrip(0);
        this.scene.add(this.controllerGrip1);

        this.controllerGrip2 = this.renderer.xr.getControllerGrip(1);
        this.scene.add(this.controllerGrip2);

        // Add simple controller visualizations
        this.addControllerModel(this.controllerGrip1);
        this.addControllerModel(this.controllerGrip2);

        console.log('[VRControllers] Controllers setup complete');
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

    onControllerConnected(event, index) {
        console.log(`[VRControllers] Controller ${index} connected:`, event?.data?.handedness || 'unknown');
    }

    onControllerDisconnected(index) {
        console.log(`[VRControllers] Controller ${index} disconnected`);
    }

    // Add object to be interactable
    addInteractable(object, callback) {
        object.userData.onClick = callback;
        this.interactables.push(object);
    }

    // Remove interactable
    removeInteractable(object) {
        const index = this.interactables.indexOf(object);
        if (index > -1) {
            this.interactables.splice(index, 1);
        }
    }

    // Get intersections from controller ray
    getIntersections(controller) {
        this.tempMatrix.identity().extractRotation(controller.matrixWorld);

        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

        return this.raycaster.intersectObjects(this.interactables, true);
    }

    // Handle ray-based interaction
    handleRayInteraction() {
        // Safety check: ensure VR is active before accessing controllers
        if (!this.enabled || !this.renderer.xr.isPresenting) return;

        [this.controller1, this.controller2].forEach((controller) => {
            if (!controller) return;

            const intersections = this.getIntersections(controller);
            const line = controller.getObjectByName('ray');

            // Update ray length based on hit
            if (line) {
                if (intersections.length > 0) {
                    line.scale.z = intersections[0].distance;
                    line.material.color.setHex(0x00ff00); // Green when hitting
                } else {
                    line.scale.z = 5;
                    line.material.color.setHex(0x00e5ff); // Cyan default
                }
            }

            // Handle selection
            if (this.selecting && intersections.length > 0) {
                const hit = intersections[0];
                const object = hit.object;

                // Call onClick callback if exists
                if (object.userData?.onClick) {
                    object.userData.onClick(hit);
                }
            }
        });
    }

    // Poll gamepad input for movement
    pollGamepadInput(dt) {
        // Guard: Do not poll if renderer is not presenting VR
        if (!this.enabled || !this.renderer.xr.isPresenting) return;

        const session = this.renderer.xr.getSession();
        if (!session) return;

        let leftInput = null;
        let rightInput = null;

        // Find left and right input sources
        for (const inputSource of session.inputSources) {
            if (!inputSource?.gamepad) continue;

            if (inputSource.handedness === 'left') {
                leftInput = inputSource.gamepad;
            } else if (inputSource.handedness === 'right') {
                rightInput = inputSource.gamepad;
            }
        }

        // Process left controller (movement)
        if (leftInput && leftInput.axes && leftInput.axes.length >= 2) {
            const x = leftInput.axes[0];
            const y = leftInput.axes[1];

            if (this.debug && (Math.abs(x) > 0.1 || Math.abs(y) > 0.1)) {
                console.log(`[VRControllers] LEFT stick: x=${x.toFixed(2)}, y=${y.toFixed(2)}`);
            }

            this.applyLocomotion(x, y, dt);
        }

        // Process right controller (turn + vertical)
        if (rightInput && rightInput.axes && rightInput.axes.length >= 2) {
            const x = rightInput.axes[0];
            const y = rightInput.axes[1];

            if (this.debug && (Math.abs(x) > 0.1 || Math.abs(y) > 0.1)) {
                console.log(`[VRControllers] RIGHT stick: x=${x.toFixed(2)}, y=${y.toFixed(2)}`);
            }

            this.applyRotation(x, dt); // X-axis: rotate left/right
            this.applyVerticalMovement(y, dt); // Y-axis: move up/down
        }

        // Debug: log if no input found
        if (this.debug && !leftInput && !rightInput) {
            // Only log once per session to avoid spam
            if (!this._noInputLogged) {
                console.warn('[VRControllers] No gamepad input sources found');
                this._noInputLogged = true;
            }
        }
    }

    // Apply locomotion from thumbstick
    applyLocomotion(x, y, dt) {
        // Apply deadzone
        const mx = Math.abs(x) > this.deadzone ? x : 0;
        const my = Math.abs(y) > this.deadzone ? y : 0;

        if (!mx && !my) return;

        // Get camera direction (ignoring Y axis for ground movement)
        const xrCamera = this.renderer.xr.getCamera(this.camera);
        const direction = new THREE.Vector3();
        xrCamera.getWorldDirection(direction);
        direction.y = 0;
        direction.normalize();

        // Calculate right vector
        const right = new THREE.Vector3();
        right.crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();

        // Apply movement (use dt if provided, otherwise use fixed speed)
        const speed = dt ? this.moveSpeed * dt * 60 : this.moveSpeed;

        this.playerRig.position.addScaledVector(direction, -my * speed);
        this.playerRig.position.addScaledVector(right, mx * speed);

        if (this.debug) {
            console.log(
                `[VRControllers] Moving: forward=${(-my * speed).toFixed(3)}, strafe=${(mx * speed).toFixed(3)}`
            );
        }
    }

    // Apply rotation from thumbstick
    applyRotation(x, dt) {
        // Apply deadzone
        const mx = Math.abs(x) > this.deadzone ? x : 0;
        if (!mx) return;

        // Rotate around Y axis (use dt if provided, otherwise use fixed speed)
        const speed = dt ? this.turnSpeed * dt * 60 : this.turnSpeed;
        this.playerRig.rotateY(-mx * speed);

        if (this.debug) {
            console.log(`[VRControllers] Rotating: ${(-mx * speed).toFixed(3)} rad`);
        }
    }

    // Apply vertical movement (up/down) from thumbstick
    applyVerticalMovement(y, dt) {
        // Apply deadzone
        const my = Math.abs(y) > this.deadzone ? y : 0;
        if (!my) return;

        // Move up/down along world Y axis
        const speed = dt ? this.verticalSpeed * dt * 60 : this.verticalSpeed;
        this.playerRig.position.y += -my * speed;

        if (this.debug) {
            console.log(`[VRControllers] Vertical: ${(-my * speed).toFixed(3)}`);
        }
    }

    // Update method (call in animation loop)
    update(dt) {
        // Guard clause: ensure renderer and XR state are valid
        if (!this.enabled || !this.renderer || !this.renderer.xr.isPresenting) return;

        this.pollGamepadInput(dt);
        this.handleRayInteraction();
    }

    // Enable/disable controllers
    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`[VRControllers] ${enabled ? 'Enabled' : 'Disabled'}`);

        // Reset no-input flag when enabling
        if (enabled) {
            this._noInputLogged = false;
        }
    }

    // Teleport player to position
    teleportTo(position) {
        this.playerRig.position.copy(position);
    }

    // Reset position
    resetPosition() {
        this.playerRig.position.set(0, 0, 0);
        this.playerRig.rotation.set(0, 0, 0);
    }

    // Dispose
    dispose() {
        if (this.controller1) this.scene.remove(this.controller1);
        if (this.controller2) this.scene.remove(this.controller2);
        if (this.controllerGrip1) this.scene.remove(this.controllerGrip1);
        if (this.controllerGrip2) this.scene.remove(this.controllerGrip2);
        if (this.playerRig) this.scene.remove(this.playerRig);

        this.interactables = [];

        console.log('[VRControllers] Disposed');
    }
}
