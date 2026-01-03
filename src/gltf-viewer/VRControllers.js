/**
 * VR Controllers Module (Production-ready with Chatbot Integration)
 * WebXR + three.js (0.147.0)
 *
 * Features:
 * - Standard VR two-hand mapping:
 *   Left controller: Move (thumbstick) + Voice Record (grip) + Toggle Voice (A button)
 *   Right controller: Turn/Vertical (thumbstick) + Send Message (grip) + Chat Menu (B button)
 * - Safe WebXR session checks (no null session crashes)
 * - Delta-time locomotion (FPS-independent)
 * - Per-controller selection state (no "global trigger" bug)
 * - Ray highlight every frame, click fires once per selectstart (no spam)
 * - Button edge detection (no repeated logs per frame)
 * - Chatbot voice interaction (record, send, voice-to-text, text-to-voice)
 * - Proper dispose: removes listeners + disposes geometries/materials
 *
 * Chatbot Controls:
 * - Left Grip: Hold to record voice, release to stop
 * - Right Grip: Send voice message to chatbot
 * - Left A/X Button: Toggle voice-to-text mode
 * - Right B/Y Button: Toggle text-to-voice mode
 * - Triggers: Point and click to interact with avatar/UI
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

        // --- Options (tweak for your app) ---
        this.options = {
            // movement (meters/sec)
            moveSpeed: 1.8,
            // vertical movement (meters/sec) – Sketchfab-style viewer fly
            verticalSpeed: 1.2,
            // smooth turn (rad/sec)
            turnSpeed: 2.2,
            // stick deadzone
            deadzone: 0.15,

            // Turning mode
            snapTurn: false,
            snapTurnAngleDeg: 45,
            snapTurnThreshold: 0.7,

            // Vertical movement mode (right stick Y)
            enableVertical: true,
            // Clamp rig Y (prevents drifting too far up/down)
            clampY: true,
            minY: 0,
            maxY: 5,

            // Ray / interaction
            rayLength: 5,
            rayColor: 0x00e5ff,
            rayHitColor: 0x00ff00,

            // Debounce click on selectstart (ms)
            clickDebounceMs: 180,

            ...options,
        };

        // Controllers
        this.controller1 = null; // index 0
        this.controller2 = null; // index 1
        this.controllerGrip1 = null;
        this.controllerGrip2 = null;

        // Interaction
        this.raycaster = new THREE.Raycaster();
        this.tempMatrix = new THREE.Matrix4();
        this.interactables = [];

        // Per-hand selection state
        this.selecting = { left: false, right: false };
        this.lastClickTime = { left: 0, right: 0 };

        // Button edge detection (avoid per-frame spam)
        this.prevButtons = {
            left: [],
            right: [],
        };

        // Chatbot voice interaction state
        this.voiceState = {
            isRecording: false,
            voiceToTextEnabled: true,
            textToVoiceEnabled: true,
            recordingStartTime: 0,
            hasRecordedAudio: false,
        };

        // Locomotion rig
        this.playerRig = new THREE.Group();

        // Snap turn state
        this.snapReady = true;
        this.snapAngle = THREE.MathUtils.degToRad(this.options.snapTurnAngleDeg);

        // State
        this.enabled = false;

        // Cache vectors to avoid per-frame allocations
        this._direction = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._up = new THREE.Vector3(0, 1, 0);

        // Keep references for removing listeners
        this._listeners = [];

        this.init();
    }

    init() {
        // Put camera under rig (so moving rig moves the "player")
        this.playerRig.add(this.camera);
        this.scene.add(this.playerRig);

        this.setupControllers();
        console.log('[VRControllers] Initialized with chatbot voice controls');
    }

    // ---------- Setup ----------
    setupControllers() {
        // Controller 1 (index 0)
        this.controller1 = this.renderer.xr.getController(0);
        this._bindControllerEvents(this.controller1, 0);
        this.scene.add(this.controller1);

        // Controller 2 (index 1)
        this.controller2 = this.renderer.xr.getController(1);
        this._bindControllerEvents(this.controller2, 1);
        this.scene.add(this.controller2);

        // Ray visualizations
        this.addRayVisual(this.controller1);
        this.addRayVisual(this.controller2);

        // Grips (for showing controller models / future grabbing)
        this.controllerGrip1 = this.renderer.xr.getControllerGrip(0);
        this.controllerGrip2 = this.renderer.xr.getControllerGrip(1);
        this.scene.add(this.controllerGrip1);
        this.scene.add(this.controllerGrip2);

        this.addControllerModel(this.controllerGrip1);
        this.addControllerModel(this.controllerGrip2);

        console.log('[VRControllers] Controllers setup complete');
    }

    _bindControllerEvents(controller, index) {
        if (!controller) return;

        const onConnected = (event) => this.onControllerConnected(event, index);
        const onDisconnected = () => this.onControllerDisconnected(index);

        // Determine hand from WebXR event data when available; else map index -> hand
        const resolveHand = (eventDataHandedness) => {
            const h = eventDataHandedness || (index === 0 ? 'left' : 'right');
            return h === 'left' || h === 'right' ? h : index === 0 ? 'left' : 'right';
        };

        const onSelectStart = (event) => {
            const hand = resolveHand(event?.data?.handedness);
            this.selecting[hand] = true;
            this._tryClick(controller, hand);
        };

        const onSelectEnd = (event) => {
            const hand = resolveHand(event?.data?.handedness);
            this.selecting[hand] = false;
        };

        controller.addEventListener('selectstart', onSelectStart);
        controller.addEventListener('selectend', onSelectEnd);
        controller.addEventListener('connected', onConnected);
        controller.addEventListener('disconnected', onDisconnected);

        this._listeners.push({ target: controller, type: 'selectstart', fn: onSelectStart });
        this._listeners.push({ target: controller, type: 'selectend', fn: onSelectEnd });
        this._listeners.push({ target: controller, type: 'connected', fn: onConnected });
        this._listeners.push({ target: controller, type: 'disconnected', fn: onDisconnected });
    }

    addRayVisual(controller) {
        if (!controller) return;

        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -1),
        ]);

        const material = new THREE.LineBasicMaterial({
            color: this.options.rayColor,
            opacity: 0.8,
            transparent: true,
        });

        const line = new THREE.Line(geometry, material);
        line.name = 'ray';
        line.scale.z = this.options.rayLength;

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
        sphere.name = 'controllerViz';
        grip.add(sphere);
    }

    // ---------- Interactables ----------
    addInteractable(object, callback) {
        if (!object) return;
        object.userData.onClick = callback;
        if (!this.interactables.includes(object)) this.interactables.push(object);
    }

    removeInteractable(object) {
        const idx = this.interactables.indexOf(object);
        if (idx !== -1) this.interactables.splice(idx, 1);
    }

    // ---------- Raycasting ----------
    getIntersections(controller) {
        this.tempMatrix.identity().extractRotation(controller.matrixWorld);

        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

        return this.raycaster.intersectObjects(this.interactables, true);
    }

    handleRayHighlight() {
        if (!this._isXRReady()) return;

        const controllers = [this.controller1, this.controller2];
        for (const controller of controllers) {
            if (!controller) continue;

            const intersections = this.getIntersections(controller);
            const line = controller.getObjectByName('ray');

            if (!line) continue;

            if (intersections.length > 0) {
                line.scale.z = intersections[0].distance;
                line.material.color.setHex(this.options.rayHitColor);
            } else {
                line.scale.z = this.options.rayLength;
                line.material.color.setHex(this.options.rayColor);
            }
        }
    }

    _tryClick(controller, hand) {
        if (!this._isXRReady()) return;
        const now = performance.now();
        if (now - this.lastClickTime[hand] < this.options.clickDebounceMs) return;
        this.lastClickTime[hand] = now;

        const intersections = this.getIntersections(controller);
        if (!intersections.length) return;

        const hit = intersections[0];
        const object = hit.object;

        if (object?.userData?.onClick) {
            try {
                object.userData.onClick(hit);
            } catch (e) {
                console.error('[VRControllers] onClick handler error:', e);
            }
        }
    }

    // ---------- Input / Locomotion ----------
    _isXRReady() {
        if (!this.enabled) return false;
        if (!this.renderer?.xr?.isPresenting) return false;
        const session = this.renderer.xr.getSession();
        return !!session;
    }

    _applyDeadzone(v) {
        return Math.abs(v) > this.options.deadzone ? v : 0;
    }

    pollGamepadInput(dt) {
        if (!this._isXRReady()) return;

        const session = this.renderer.xr.getSession();
        if (!session) return;

        for (const inputSource of session.inputSources) {
            const gp = inputSource?.gamepad;
            if (!gp) continue;

            const hand =
                inputSource.handedness === 'left' ? 'left' : inputSource.handedness === 'right' ? 'right' : null;

            // If handedness unknown, skip (better than guessing wrong in production)
            if (!hand) continue;

            const axes = gp.axes || [];
            const x = axes.length >= 2 ? axes[0] : 0;
            const y = axes.length >= 2 ? axes[1] : 0;

            if (hand === 'left') {
                // Left stick = move/strafe (standard)
                this.applyLocomotion(x, y, dt);
            } else if (hand === 'right') {
                // Right stick = turn + optional vertical fly (viewer style)
                if (this.options.snapTurn) this.applySnapTurn(x);
                else this.applyRotation(x, dt);

                if (this.options.enableVertical) this.applyVerticalMovement(y, dt);
            }

            // Buttons with edge detection
            this._handleButtons(hand, gp.buttons || []);
        }
    }

    _handleButtons(hand, buttons) {
        const prev = this.prevButtons[hand];
        if (!prev.length) {
            // init prev array
            for (let i = 0; i < buttons.length; i++) prev[i] = !!buttons[i]?.pressed;
            return;
        }

        const justPressed = (i) => !!buttons[i]?.pressed && !prev[i];
        const justReleased = (i) => !buttons[i]?.pressed && prev[i];

        // Button mapping varies by device, but these are common:
        // 0 trigger (selectstart/selectend already handles it)
        // 1 grip

        // LEFT HAND GRIP: Hold to record voice
        if (hand === 'left') {
            if (justPressed(1)) this.onVoiceRecordStart();
            if (justReleased(1)) this.onVoiceRecordEnd();
        }

        // RIGHT HAND GRIP: Send voice message
        if (hand === 'right') {
            if (justPressed(1)) this.onSendVoiceMessage();
        }

        // 4 / 5 often A/B or X/Y on Quest
        if (justPressed(4)) this.onButtonAPressed(hand);
        if (justPressed(5)) this.onButtonBPressed(hand);

        // update prev
        for (let i = 0; i < buttons.length; i++) prev[i] = !!buttons[i]?.pressed;
    }

    applyLocomotion(x, y, dt) {
        const mx = this._applyDeadzone(x);
        const my = this._applyDeadzone(y);
        if (!mx && !my) return;

        // Head-relative movement (standard): use XR camera forward projected to ground plane
        const xrCamera = this.renderer.xr.getCamera(this.camera);
        xrCamera.getWorldDirection(this._direction);
        this._direction.y = 0;
        if (this._direction.lengthSq() < 1e-6) return;
        this._direction.normalize();

        // Right vector (ensure correct strafe direction)
        // right = up x forward
        this._right.crossVectors(this._up, this._direction).normalize();

        // Apply movement (meters/sec * dt)
        const speed = this.options.moveSpeed * dt;
        this.playerRig.position.addScaledVector(this._direction, -my * speed);
        this.playerRig.position.addScaledVector(this._right, mx * speed);
    }

    applyRotation(x, dt) {
        const mx = this._applyDeadzone(x);
        if (!mx) return;

        // Smooth turning (rad/sec * dt)
        this.playerRig.rotateY(-mx * this.options.turnSpeed * dt);
    }

    applySnapTurn(x) {
        // Reset ready when stick near center
        if (Math.abs(x) < 0.2) this.snapReady = true;
        if (!this.snapReady) return;

        if (x > this.options.snapTurnThreshold) {
            this.playerRig.rotation.y -= this.snapAngle;
            this.snapReady = false;
        } else if (x < -this.options.snapTurnThreshold) {
            this.playerRig.rotation.y += this.snapAngle;
            this.snapReady = false;
        }
    }

    applyVerticalMovement(y, dt) {
        const my = this._applyDeadzone(y);
        if (!my) return;

        // Negative Y on stick = push up => move up (viewer style)
        this.playerRig.position.y += -my * this.options.verticalSpeed * dt;

        if (this.options.clampY) {
            this.playerRig.position.y = THREE.MathUtils.clamp(
                this.playerRig.position.y,
                this.options.minY,
                this.options.maxY
            );
        }
    }

    // ---------- Chatbot Voice Interaction Handlers ----------

    /**
     * Called when left grip is pressed - start voice recording
     */
    onVoiceRecordStart() {
        if (this.voiceState.isRecording) return;

        this.voiceState.isRecording = true;
        this.voiceState.recordingStartTime = performance.now();
        this.voiceState.hasRecordedAudio = false;

        console.log('[VRControllers] 🎤 Voice recording started');

        // Change left controller color to red (recording indicator)
        this._setControllerColor(this.controllerGrip1, 0xff0000);

        // Dispatch event for app to handle actual recording
        window.dispatchEvent(
            new CustomEvent('vr-voice-record-start', {
                detail: { hand: 'left' },
            })
        );

        // Try to access Web Speech API or custom recording
        this._startVoiceRecording();
    }

    /**
     * Called when left grip is released - stop voice recording
     */
    onVoiceRecordEnd() {
        if (!this.voiceState.isRecording) return;

        const duration = performance.now() - this.voiceState.recordingStartTime;
        this.voiceState.isRecording = false;
        this.voiceState.hasRecordedAudio = duration > 300; // at least 300ms

        console.log(`[VRControllers] 🎤 Voice recording stopped (${(duration / 1000).toFixed(1)}s)`);

        // Restore left controller color
        this._setControllerColor(this.controllerGrip1, 0x00e5ff);

        // Dispatch event
        window.dispatchEvent(
            new CustomEvent('vr-voice-record-end', {
                detail: { hand: 'left', duration, hasAudio: this.voiceState.hasRecordedAudio },
            })
        );

        // Stop recording
        this._stopVoiceRecording();
    }

    /**
     * Called when right grip is pressed - send voice message to chatbot
     */
    onSendVoiceMessage() {
        if (this.voiceState.isRecording) {
            console.warn('[VRControllers] Cannot send while recording - release left grip first');
            return;
        }

        if (!this.voiceState.hasRecordedAudio) {
            console.warn('[VRControllers] No recorded audio to send - hold left grip to record');
            return;
        }

        console.log('[VRControllers] 📤 Sending voice message to chatbot...');

        // Flash right controller green
        this._setControllerColor(this.controllerGrip2, 0x00ff00);
        setTimeout(() => this._setControllerColor(this.controllerGrip2, 0x00e5ff), 200);

        // Dispatch event for app to process and send
        window.dispatchEvent(
            new CustomEvent('vr-voice-send', {
                detail: { hand: 'right' },
            })
        );

        // Reset state
        this.voiceState.hasRecordedAudio = false;

        // Integrate with existing chat manager if available
        this._sendVoiceToChat();
    }

    /**
     * Start actual voice recording (Web Speech API or custom)
     */
    _startVoiceRecording() {
        // Check if SpeechRecognition is available
        if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
            console.warn('[VRControllers] SpeechRecognition not available in this browser');
            return;
        }

        try {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';

            this.recognition.onresult = (event) => {
                let transcript = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    transcript += event.results[i][0].transcript;
                }
                this.voiceTranscript = transcript;
                console.log('[VRControllers] 🎤 Transcript:', transcript);
            };

            this.recognition.onerror = (event) => {
                console.error('[VRControllers] Speech recognition error:', event.error);
            };

            this.recognition.start();
        } catch (error) {
            console.error('[VRControllers] Failed to start speech recognition:', error);
        }
    }

    /**
     * Stop voice recording
     */
    _stopVoiceRecording() {
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (error) {
                console.error('[VRControllers] Error stopping recognition:', error);
            }
        }
    }

    /**
     * Send voice transcript to chat manager
     */
    _sendVoiceToChat() {
        if (!this.voiceTranscript) {
            console.warn('[VRControllers] No transcript available');
            return;
        }

        // Try to access global chat manager (if available in your app)
        if (window.NEXUS_CHAT_MANAGER) {
            try {
                window.NEXUS_CHAT_MANAGER.sendMessage(this.voiceTranscript);
                console.log('[VRControllers] ✅ Sent to chat:', this.voiceTranscript);
            } catch (error) {
                console.error('[VRControllers] Failed to send to chat:', error);
            }
        }

        // Clear transcript
        this.voiceTranscript = '';
    }

    /**
     * Set controller sphere color (for visual feedback)
     */
    _setControllerColor(grip, color) {
        if (!grip) return;
        const viz = grip.getObjectByName('controllerViz');
        if (viz && viz.material) {
            viz.material.color.setHex(color);
            viz.material.emissive.setHex(color);
        }
    }

    // ---------- Button Hooks (override in app or extend) ----------
    onControllerConnected(event, index) {
        console.log(`[VRControllers] Controller ${index} connected:`, event?.data?.handedness);
    }

    onControllerDisconnected(index) {
        console.log(`[VRControllers] Controller ${index} disconnected`);
    }

    onGripPressed(hand) {
        // Already handled by voice recording (left) and send (right)
        console.log(`[VRControllers] Grip pressed on ${hand} hand`);
    }

    /**
     * Left A/X button: Toggle voice-to-text mode
     */
    onButtonAPressed(hand) {
        if (hand === 'left') {
            this.voiceState.voiceToTextEnabled = !this.voiceState.voiceToTextEnabled;
            console.log(`[VRControllers] 🎙️ Voice-to-Text: ${this.voiceState.voiceToTextEnabled ? 'ON' : 'OFF'}`);

            window.dispatchEvent(
                new CustomEvent('vr-voice-to-text-toggle', {
                    detail: { enabled: this.voiceState.voiceToTextEnabled },
                })
            );
        } else {
            console.log(`[VRControllers] A button pressed on ${hand} hand`);
        }
    }

    /**
     * Right B/Y button: Toggle text-to-voice mode
     */
    onButtonBPressed(hand) {
        if (hand === 'right') {
            this.voiceState.textToVoiceEnabled = !this.voiceState.textToVoiceEnabled;
            console.log(`[VRControllers] 🔊 Text-to-Voice: ${this.voiceState.textToVoiceEnabled ? 'ON' : 'OFF'}`);

            window.dispatchEvent(
                new CustomEvent('vr-text-to-voice-toggle', {
                    detail: { enabled: this.voiceState.textToVoiceEnabled },
                })
            );

            // Toggle speech synthesis if available
            if (window.speechSynthesis) {
                if (!this.voiceState.textToVoiceEnabled) {
                    window.speechSynthesis.cancel();
                }
            }
        } else {
            console.log(`[VRControllers] B button pressed on ${hand} hand`);
        }
    }

    // ---------- Public API ----------
    /**
     * Call this once per frame from your animation loop:
     * const dt = clock.getDelta(); // seconds
     * vrControllers.update(dt);
     */
    update(dt) {
        // dt safety (avoid NaN / huge jumps)
        if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 90;
        dt = Math.min(dt, 0.05);

        if (!this.enabled) return;

        // Prefer checking session existence over only isPresenting
        if (!this._isXRReady()) return;

        this.pollGamepadInput(dt);
        this.handleRayHighlight();
    }

    setEnabled(enabled) {
        this.enabled = !!enabled;
        console.log(`[VRControllers] ${this.enabled ? 'Enabled' : 'Disabled'}`);
    }

    teleportTo(position) {
        if (!position) return;
        this.playerRig.position.copy(position);
    }

    resetPosition() {
        this.playerRig.position.set(0, 0, 0);
        this.playerRig.rotation.set(0, 0, 0);
    }

    /**
     * Get current voice state (for UI display)
     */
    getVoiceState() {
        return { ...this.voiceState };
    }

    // ---------- Cleanup ----------
    dispose() {
        // Stop any active recording
        if (this.voiceState.isRecording) {
            this._stopVoiceRecording();
            this.voiceState.isRecording = false;
        }

        // Remove event listeners
        for (const l of this._listeners) {
            try {
                l.target.removeEventListener(l.type, l.fn);
            } catch (_) {}
        }
        this._listeners.length = 0;

        // Remove objects from scene
        if (this.controller1) this.scene.remove(this.controller1);
        if (this.controller2) this.scene.remove(this.controller2);
        if (this.controllerGrip1) this.scene.remove(this.controllerGrip1);
        if (this.controllerGrip2) this.scene.remove(this.controllerGrip2);
        if (this.playerRig) this.scene.remove(this.playerRig);

        // Dispose ray geometries/materials and controller viz
        const disposeChild = (obj) => {
            if (!obj) return;
            obj.traverse((child) => {
                if (child.geometry) child.geometry.dispose?.();
                if (child.material) {
                    // material can be array
                    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
                    else child.material.dispose?.();
                }
            });
        };

        disposeChild(this.controller1);
        disposeChild(this.controller2);
        disposeChild(this.controllerGrip1);
        disposeChild(this.controllerGrip2);

        // Clear state
        this.interactables.length = 0;
        this.selecting.left = false;
        this.selecting.right = false;
        this.enabled = false;

        this.controller1 = null;
        this.controller2 = null;
        this.controllerGrip1 = null;
        this.controllerGrip2 = null;

        console.log('[VRControllers] Disposed');
    }
}
