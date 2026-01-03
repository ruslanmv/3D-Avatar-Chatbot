/**
 * VR Controllers Module
 * Handles controller input, locomotion, and interaction for WebXR
 * Fixed: Safe session checks, preventing errors during context loss
 * Enhanced: Sketchfab-style 6DOF movement (forward/back, strafe, up/down, rotation)
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

export class VRControllers {
    constructor(renderer, scene, camera) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        // Controllers
        this.controller1 = null;
        this.controller2 = null;
        this.controllerGrip1 = null;
        this.controllerGrip2 = null;

        // Interaction
        this.raycaster = new THREE.Raycaster();
        this.tempMatrix = new THREE.Matrix4();
        this.interactables = [];
        this.selecting = false;

        // Locomotion
        this.playerRig = new THREE.Group();
        this.moveSpeed = 0.05;
        this.verticalSpeed = 0.04; // Speed for up/down movement
        this.turnSpeed = 0.02;
        this.deadzone = 0.15;

        // State
        this.enabled = false;

        this.init();
    }

    init() {
        // Create player rig
        this.playerRig.add(this.camera);
        this.scene.add(this.playerRig);

        // Setup controllers
        this.setupControllers();

        console.log('[VRControllers] Initialized');
    }

    setupControllers() {
        // Controller 1 (left)
        this.controller1 = this.renderer.xr.getController(0);
        this.controller1.addEventListener('selectstart', () => this.onSelectStart());
        this.controller1.addEventListener('selectend', () => this.onSelectEnd());
        this.controller1.addEventListener('connected', (event) => this.onControllerConnected(event, 0));
        this.controller1.addEventListener('disconnected', () => this.onControllerDisconnected(0));
        this.scene.add(this.controller1);

        // Controller 2 (right)
        this.controller2 = this.renderer.xr.getController(1);
        this.controller2.addEventListener('selectstart', () => this.onSelectStart());
        this.controller2.addEventListener('selectend', () => this.onSelectEnd());
        this.controller2.addEventListener('connected', (event) => this.onControllerConnected(event, 1));
        this.controller2.addEventListener('disconnected', () => this.onControllerDisconnected(1));
        this.scene.add(this.controller2);

        // Add ray visualizations
        this.addRayVisual(this.controller1);
        this.addRayVisual(this.controller2);

        // Add controller grips (for holding things)
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
        // Create ray line
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
        // Simple controller visualization (sphere)
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

    onSelectStart() {
        this.selecting = true;
    }

    onSelectEnd() {
        this.selecting = false;
    }

    onControllerConnected(event, index) {
        console.log(`[VRControllers] Controller ${index} connected:`, event.data.handedness);
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
    pollGamepadInput() {
        // Crucial Check: Do not poll if renderer is not presenting VR
        // This prevents accessing null session objects during shutdown
        if (!this.enabled || !this.renderer.xr.isPresenting) return;

        const session = this.renderer.xr.getSession();
        if (!session) return;

        for (const inputSource of session.inputSources) {
            if (!inputSource?.gamepad) continue;

            const gamepad = inputSource.gamepad;
            const handedness = inputSource.handedness;

            // Thumbstick axes (usually [0,1] for left, [2,3] for right)
            const axes = gamepad.axes;

            if (handedness === 'left') {
                // Left stick: movement (forward/back, strafe left/right)
                if (axes.length >= 2) {
                    this.applyLocomotion(axes[0], axes[1]);
                }
            } else if (handedness === 'right') {
                // Right stick: rotation (X-axis) + vertical movement (Y-axis)
                if (axes.length >= 4) {
                    // Quest controllers: right stick is axes[2] (X) and axes[3] (Y)
                    this.applyRotation(axes[2]); // X-axis: rotate left/right
                    this.applyVerticalMovement(axes[3]); // Y-axis: move up/down
                } else if (axes.length >= 2) {
                    // Fallback: some controllers only have 2 axes per hand
                    this.applyRotation(axes[0]); // X-axis: rotate left/right
                    this.applyVerticalMovement(axes[1]); // Y-axis: move up/down
                }
            }

            // Buttons
            if (gamepad.buttons.length > 0) {
                // Button 0: Trigger (handled by selectstart/selectend)
                // Button 1: Squeeze/Grip
                if (gamepad.buttons[1]?.pressed) {
                    this.onGripPressed(handedness);
                }

                // Button 4: A/X button (teleport or special action)
                if (gamepad.buttons[4]?.pressed) {
                    this.onButtonAPressed(handedness);
                }

                // Button 5: B/Y button
                if (gamepad.buttons[5]?.pressed) {
                    this.onButtonBPressed(handedness);
                }
            }
        }
    }

    // Apply locomotion from thumbstick
    applyLocomotion(x, y) {
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

        // Apply movement
        this.playerRig.position.addScaledVector(direction, -my * this.moveSpeed);
        this.playerRig.position.addScaledVector(right, mx * this.moveSpeed);
    }

    // Apply rotation from thumbstick
    applyRotation(x) {
        // Apply deadzone
        const mx = Math.abs(x) > this.deadzone ? x : 0;
        if (!mx) return;

        // Rotate around Y axis
        this.playerRig.rotateY(-mx * this.turnSpeed);
    }

    // Apply vertical movement (up/down) from thumbstick
    applyVerticalMovement(y) {
        // Apply deadzone
        const my = Math.abs(y) > this.deadzone ? y : 0;
        if (!my) return;

        // Move up/down along world Y axis (like Sketchfab)
        // Negative Y on stick = push up = move up in world
        this.playerRig.position.y += -my * this.verticalSpeed;
    }

    // Button handlers (can be overridden)
    onGripPressed(hand) {
        console.log(`[VRControllers] Grip pressed on ${hand} hand`);
    }

    onButtonAPressed(hand) {
        console.log(`[VRControllers] A/X button pressed on ${hand} hand`);
    }

    onButtonBPressed(hand) {
        console.log(`[VRControllers] B/Y button pressed on ${hand} hand`);
    }

    // Update method (call in animation loop)
    update() {
        // Guard clause: ensure renderer and XR state are valid
        if (!this.enabled || !this.renderer || !this.renderer.xr.isPresenting) return;

        this.pollGamepadInput();
        this.handleRayInteraction();
    }

    // Enable/disable controllers
    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`[VRControllers] ${enabled ? 'Enabled' : 'Disabled'}`);
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
    }
}
