/**
 * AR Support Module for ViewerEngine
 * Adds WebXR Augmented Reality capabilities alongside existing VR support.
 *
 * Supports:
 * - Meta Quest 2/3/Pro: Passthrough AR (immersive-ar with passthrough)
 * - Android Chrome: Camera-based AR with hit-test for surface placement
 * - Fallback: Gracefully hides AR button if unsupported
 *
 * Non-destructive: purely additive — VRSupport.js remains untouched.
 * Dispatches 'ar-session-start' and 'ar-session-end' CustomEvents.
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

export class ARSupport {
    constructor(renderer, camera, scene, containerEl) {
        this.renderer = renderer;
        this.camera = camera;
        this.scene = scene;
        this.containerEl = containerEl || null;

        this.arButton = null;
        this.isARActive = false;
        this.isToggling = false;
        this.webxrARSupported = false;

        // Promise that resolves when the capability check completes.
        // Consumers (e.g. ModelViewerAR) can await this before enhancing the button.
        this._readyResolve = null;
        this.ready = new Promise((resolve) => {
            this._readyResolve = resolve;
        });

        // AR-specific state
        this.hitTestSource = null;
        this.hitTestSourceRequested = false;
        this.reticle = null; // placement indicator

        // Saved scene state (restored on AR exit)
        this._savedBackground = null;
        this._savedEnvironment = null;
        this._savedToneMappingExposure = null;

        // Ground plane for AR shadow
        this.shadowPlane = null;

        // Floor auto-placement
        this.floorDetected = false;
        this.floorY = 0;

        this.init();
    }

    init() {
        // Create AR button (checks support asynchronously)
        this.createARButton();

        // Listen for AR session events via renderer.xr
        this.renderer.xr.addEventListener('sessionstart', () => {
            if (this._isARSession()) {
                this.isARActive = true;
                console.log('[AR] Session started (immersive-ar)');
                this.onSessionStart();
            }
        });

        this.renderer.xr.addEventListener('sessionend', () => {
            if (this.isARActive) {
                this.isARActive = false;
                this.isToggling = false;
                console.log('[AR] Session ended');
                this.onSessionEnd();
            }
        });
    }

    _isARSession() {
        try {
            const session = this.renderer.xr.getSession();
            if (!session) return false;
            // ANDROID FIX: XRSession.mode is NOT a standard property and is
            // undefined on many Android Chrome builds — relying on it made
            // onSessionStart() silently never run (black background, no
            // reticle, avatar never placed → the "frozen giant avatar" bug).
            // Order of trust: our own tag → non-standard mode → blend mode
            // (AR composites, so it's never 'opaque').
            if (session.__nexusMode) return session.__nexusMode === 'immersive-ar';
            if (session.mode) return session.mode === 'immersive-ar';
            return session.environmentBlendMode && session.environmentBlendMode !== 'opaque';
        } catch {
            return false;
        }
    }

    // =========================================================================
    // AR BUTTON
    // =========================================================================

    createARButton() {
        if (!navigator.xr) {
            console.warn('[AR] WebXR not supported');
            this.webxrARSupported = false;
            this._readyResolve(false);
            return;
        }

        // Create AR button — styled via CSS class .xr-btn
        this.arButton = document.createElement('button');
        this.arButton.id = 'ar-button';
        this.arButton.className = 'xr-btn xr-btn--ar';
        this.arButton.innerHTML = '<span class="xr-btn__icon">&#x1F4F1;</span> ENTER AR';

        // Check AR support — resolve the ready Promise so consumers can
        // await it and apply fallback handlers *after* this completes.
        navigator.xr
            .isSessionSupported('immersive-ar')
            .then((supported) => {
                this.webxrARSupported = supported;
                if (supported) {
                    this.arButton.onclick = () => this.toggleAR();
                    console.log('[AR] immersive-ar supported — AR button enabled');
                } else {
                    console.log('[AR] immersive-ar not supported on this device — awaiting fallback handler');
                    this.arButton.classList.add('xr-btn--disabled');
                    // Set a default disabled handler; ModelViewerAR.enhanceARButton()
                    // will override this with Scene Viewer / Quick Look on mobile.
                    this.arButton.onclick = () => {
                        alert(
                            'AR mode is not supported on this device/browser.\nUse a supported device like Meta Quest or Android with Chrome.'
                        );
                    };
                }
                this._readyResolve(supported);
            })
            .catch(() => {
                console.warn('[AR] Failed to check immersive-ar support');
                this.webxrARSupported = false;
                this.arButton.classList.add('xr-btn--disabled');
                this._readyResolve(false);
            });
        // Button is appended to the XR launch bar by ViewerEngine
    }

    // =========================================================================
    // TOGGLE AR
    // =========================================================================

    async toggleAR() {
        if (this.isToggling) {
            console.warn('[AR] Already toggling, please wait...');
            return;
        }

        this.isToggling = true;
        const originalText = this.arButton.textContent;
        this.arButton.textContent = '...';
        this.arButton.style.cursor = 'wait';

        try {
            if (this.isARActive) {
                // Exit AR
                const session = this.renderer.xr.getSession();
                if (session) {
                    await session.end();
                } else {
                    this.forceExit();
                }
            } else {
                // Check if VR is active first — can't have both
                if (this.renderer.xr.isPresenting) {
                    alert('Please exit VR mode before entering AR.');
                    return;
                }

                // Request AR session.
                // ANDROID FIX: 'local-floor' as a REQUIRED feature makes
                // requestSession throw NotSupportedError on many ARCore
                // devices even though isSessionSupported() returned true.
                // Everything is optional; floor comes from hit-test instead.
                const sessionInit = {
                    requiredFeatures: [],
                    optionalFeatures: [
                        'local-floor',
                        'hit-test',
                        'dom-overlay',
                        'hand-tracking',
                        'camera-access', // Not available on Quest Browser — silent fallback
                        'anchors',
                        'plane-detection',
                        'mesh-detection', // Quest 3 Scene Model (3D env mesh for occlusion)
                        'light-estimation',
                        'layers', // WebXR Layers API (compositor-level performance)
                    ],
                };

                // Quest 3 depth sensing for real-world occlusion (objects behind
                // real furniture appear correctly hidden). Uses W3C Depth Sensing Module.
                // Silent fallback on devices that don't support it.
                try {
                    sessionInit.optionalFeatures.push('depth-sensing');
                    sessionInit.depthSensing = {
                        usagePreference: ['cpu-optimized', 'gpu-optimized'],
                        dataFormatPreference: ['luminance-alpha', 'float32'],
                    };
                } catch {
                    // depthSensing config not supported — ignore
                }

                // Add DOM overlay for mobile (shows 2D UI over camera feed)
                const overlayEl = document.getElementById('ar-dom-overlay');
                if (overlayEl) {
                    sessionInit.domOverlay = { root: overlayEl };
                }

                // ANDROID FIX: three.js defaults to the 'local-floor'
                // reference space; if the granted session lacks it, three's
                // internal session start rejects and NO XR frames ever render
                // (frozen view). AR uses 'local' — our hit-test handles floor.
                this.renderer.xr.setReferenceSpaceType?.('local');
                const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
                session.__nexusMode = 'immersive-ar'; // reliable mode tag (Fix 1)
                await this.renderer.xr.setSession(session);
                this.onSessionStart(); // idempotent — belt-and-braces vs event gating

                this.arButton.textContent = 'EXIT AR';
            }
        } catch (error) {
            console.error('[AR] Toggle error:', error);
            // If the AR session never started, put three's reference space back
            // to its default so a later VR session is unaffected (VR relies on
            // the 'local-floor' default — do not leave it on 'local').
            if (!this.renderer.xr.getSession()) {
                this.renderer.xr.setReferenceSpaceType?.('local-floor');
            }

            let msg = 'Failed to ' + (this.isARActive ? 'exit' : 'enter') + ' AR.\n\n';
            if (error.name === 'NotSupportedError') {
                msg += 'AR mode is not supported on this device/browser.';
            } else if (error.name === 'NotAllowedError') {
                msg += 'Camera/AR access was denied.\nPlease grant permissions and try again.';
            } else if (error.name === 'SecurityError' || (error.message && error.message.includes('user activation'))) {
                // WebXR requires requestSession to be called inside a user gesture.
                // This error means the activation token expired (e.g. too many async
                // steps between the user tap and the requestSession call).
                msg +=
                    'AR session requires a direct tap gesture.\n' +
                    'Please tap the "Enter AR" button directly — do not switch from VR.';
                console.warn(
                    '[AR] User activation expired before requestSession. ' +
                        'Ensure requestSession is called synchronously inside a click handler.'
                );
            } else {
                msg += error.message;
            }
            alert(msg);

            this.forceExit();
            this.arButton.textContent = originalText;
        } finally {
            this.isToggling = false;
            this.arButton.style.cursor = 'pointer';
        }
    }

    // =========================================================================
    // SESSION LIFECYCLE
    // =========================================================================

    onSessionStart() {
        if (this._arSessionSetupDone) return; // idempotent (event + direct call)
        this._arSessionSetupDone = true;
        this.isARActive = true;
        // Save current scene state
        this._savedBackground = this.scene.background;
        this._savedEnvironment = this.scene.environment;
        this._savedToneMappingExposure = this.renderer.toneMappingExposure;

        // Make scene transparent for AR passthrough / camera feed
        this.scene.background = null;

        // Reduce environment intensity so avatar doesn't look "floating"
        // Keep some environment for reflections but dim it
        this.renderer.toneMappingExposure = 0.7;

        // Reset floor detection for auto-placement
        this.floorDetected = false;
        this.floorY = 0;

        // Create reticle for surface placement (mobile AR)
        this._createReticle();

        // Create shadow-receiving ground plane
        this._createShadowPlane();

        // Update button
        if (this.arButton) {
            this.arButton.textContent = 'EXIT AR';
        }

        // Dispatch event for ViewerEngine
        window.dispatchEvent(new CustomEvent('ar-session-start'));

        this.isToggling = false;
    }

    onSessionEnd() {
        this._arSessionSetupDone = false;
        // Drop the follow-me target so a stale root can never be rotated after
        // the session (ViewerEngine resets the avatar's transform on exit).
        this._placedRoot = null;
        this._followDwell = 0;
        this._followTurning = false;
        // Restore three's default reference space so VR ('local-floor')
        // keeps working exactly as before — desktop/Quest VR untouched.
        this.renderer.xr.setReferenceSpaceType?.('local-floor');
        // Restore saved scene state
        if (this._savedBackground !== null) {
            this.scene.background = this._savedBackground;
        }
        if (this._savedEnvironment !== null) {
            this.scene.environment = this._savedEnvironment;
        }
        if (this._savedToneMappingExposure !== null) {
            this.renderer.toneMappingExposure = this._savedToneMappingExposure;
        }

        // Remove AR-specific objects
        this._removeReticle();
        this._removeShadowPlane();

        // Clean up hit test
        if (this.hitTestSource) {
            this.hitTestSource.cancel();
            this.hitTestSource = null;
        }
        this.hitTestSourceRequested = false;

        // Update button
        if (this.arButton) {
            this.arButton.textContent = 'ENTER AR';
        }

        // Dispatch event
        window.dispatchEvent(new CustomEvent('ar-session-end'));

        this.isToggling = false;
    }

    forceExit() {
        console.log('[AR] Force exiting AR session');
        this.isARActive = false;
        this.isToggling = false;
        if (this.arButton) this.arButton.textContent = 'ENTER AR';
        window.dispatchEvent(new CustomEvent('ar-session-end'));
    }

    // =========================================================================
    // AR RETICLE (Surface Placement Indicator)
    // =========================================================================

    _createReticle() {
        if (this.reticle) return;

        const geometry = new THREE.RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2);
        const material = new THREE.MeshBasicMaterial({
            color: 0x76ff03,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
        });

        this.reticle = new THREE.Mesh(geometry, material);
        this.reticle.name = 'ARReticle';
        this.reticle.matrixAutoUpdate = false;
        this.reticle.visible = false;
        this.scene.add(this.reticle);
    }

    _removeReticle() {
        if (this.reticle) {
            this.scene.remove(this.reticle);
            this.reticle.geometry?.dispose();
            this.reticle.material?.dispose();
            this.reticle = null;
        }
    }

    // =========================================================================
    // AR SHADOW PLANE (makes avatar look grounded)
    // =========================================================================

    _createShadowPlane() {
        if (this.shadowPlane) return;

        const geometry = new THREE.PlaneGeometry(20, 20);
        geometry.rotateX(-Math.PI / 2);

        const material = new THREE.ShadowMaterial({
            opacity: 0.3,
            transparent: true,
        });

        this.shadowPlane = new THREE.Mesh(geometry, material);
        this.shadowPlane.name = 'ARShadowPlane';
        this.shadowPlane.position.y = 0;
        this.shadowPlane.receiveShadow = true;
        this.scene.add(this.shadowPlane);
    }

    _removeShadowPlane() {
        if (this.shadowPlane) {
            this.scene.remove(this.shadowPlane);
            this.shadowPlane.geometry?.dispose();
            this.shadowPlane.material?.dispose();
            this.shadowPlane = null;
        }
    }

    // =========================================================================
    // AR HIT-TEST UPDATE (call in animation loop during AR)
    // =========================================================================

    /**
     * Update AR hit-test each frame. Call this from the animation loop
     * when `isARActive` is true.
     *
     * @param {THREE.WebGLRenderer} renderer
     * @param {XRFrame} frame - The current XR frame (from renderer.xr)
     */
    updateHitTest(renderer, frame) {
        if (!this.isARActive || !frame) return;

        const session = renderer.xr.getSession();
        if (!session) return;

        // Request hit-test source (once)
        if (!this.hitTestSourceRequested) {
            session.requestReferenceSpace('viewer').then((refSpace) => {
                session
                    .requestHitTestSource({ space: refSpace })
                    .then((source) => {
                        this.hitTestSource = source;
                    })
                    .catch((err) => {
                        console.warn('[AR] Hit-test source request failed:', err);
                    });
            });
            this.hitTestSourceRequested = true;

            session.addEventListener('end', () => {
                this.hitTestSourceRequested = false;
                this.hitTestSource = null;
            });
        }

        // Process hit-test results
        if (this.hitTestSource) {
            const refSpace = renderer.xr.getReferenceSpace();
            const hitTestResults = frame.getHitTestResults(this.hitTestSource);

            if (hitTestResults.length > 0 && this.reticle) {
                const hit = hitTestResults[0];
                const pose = hit.getPose(refSpace);
                if (pose) {
                    this.reticle.visible = true;
                    this.reticle.matrix.fromArray(pose.transform.matrix);

                    // Auto-place avatar on first floor detection
                    if (!this.floorDetected) {
                        this.floorDetected = true;
                        this.floorY = pose.transform.position.y;

                        // Dispatch event so ViewerEngine can position the avatar
                        window.dispatchEvent(
                            new CustomEvent('ar-floor-detected', {
                                detail: {
                                    y: this.floorY,
                                    position: {
                                        x: pose.transform.position.x,
                                        y: pose.transform.position.y,
                                        z: pose.transform.position.z,
                                    },
                                },
                            })
                        );

                        // Position shadow plane at floor level
                        if (this.shadowPlane) {
                            this.shadowPlane.position.y = this.floorY;
                        }

                        console.log(`[AR] Floor auto-detected at Y=${this.floorY.toFixed(3)}`);
                    }
                }
            } else if (this.reticle) {
                this.reticle.visible = false;
            }
        }
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Place avatar at the current reticle position.
     * Call this when user taps in AR mode.
     * @param {THREE.Object3D} avatarRoot - The avatar root to reposition
     */
    placeAvatarAtReticle(avatarRoot) {
        if (!this.reticle || !this.reticle.visible || !avatarRoot) return;

        // Extract position from reticle matrix
        const pos = new THREE.Vector3();
        pos.setFromMatrixPosition(this.reticle.matrix);

        avatarRoot.position.copy(pos);

        // AAA NPC rule: a placed character GREETS you — face the user
        // immediately (yaw only; posture untouched).
        this._placedRoot = avatarRoot;
        this._faceUser(avatarRoot, true);

        // Move shadow plane to match
        if (this.shadowPlane) {
            this.shadowPlane.position.y = pos.y;
        }

        console.log(`[AR] Avatar placed at (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
    }

    /** Yaw the avatar toward the XR camera. instant=true snaps (placement);
     *  otherwise returns the remaining angle so callers can smooth-turn. */
    _faceUser(root, instant) {
        try {
            const xrCam = this.renderer.xr.getCamera();
            if (!xrCam) return 0;
            const camPos = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld);
            // World position — the root may sit under a transformed parent.
            const rootPos = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
            const to = camPos.sub(rootPos);
            to.y = 0;
            if (to.lengthSq() < 1e-4) return 0;
            to.normalize();
            // WHICH WAY IS "FORWARD" DEPENDS ON THE MODEL FORMAT.
            // Per the VRM spec a VRM faces -Z, and AvatarManager compensates
            // with root.rotation.y = Math.PI so it looks at the +Z camera; a
            // plain GLB is authored facing +Z and gets no flip. Assuming +Z for
            // everything (as this started out doing) turns a VRM's BACK to the
            // user — a perfect 180° error on the app's own default avatar.
            // root.userData.isVRM is set by AvatarManager for exactly this.
            const localFwd = root.userData?.isVRM ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1);
            const fwd = localFwd.applyQuaternion(root.quaternion);
            fwd.y = 0;
            if (fwd.lengthSq() < 1e-6) return 0;
            fwd.normalize();
            let delta = Math.atan2(to.x, to.z) - Math.atan2(fwd.x, fwd.z);
            // shortest arc
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            if (instant) {
                root.rotateY(delta);
                return 0;
            }
            return delta;
        } catch (_) {
            return 0;
        }
    }

    /**
     * AAA turn-in-place (God of War / RDR2 NPC pattern): the head+eyes track
     * the user up to ±60°; when the user walks beyond that for a moment, the
     * BODY smoothly re-orients to face them, then the head relaxes.
     * Called every AR frame from ViewerEngine.
     */
    /**
     * Settings ▸ "Follow me in AR" (default on), cached.
     * This is read on every rendered frame by two call sites; localStorage is a
     * synchronous, blocking API, so hitting it ~120×/second in the render loop
     * is exactly the kind of thing that costs frames on a phone. Re-read at most
     * 4×/second — a settings flip still applies effectively instantly.
     */
    isFollowUserEnabled() {
        const now = performance.now();
        if (this._followPrefAt === undefined || now - this._followPrefAt > 250) {
            this._followPrefAt = now;
            try {
                this._followPref = localStorage.getItem('overlay_arfollow') !== 'off';
            } catch (_) {
                this._followPref = true;
            }
        }
        return this._followPref;
    }

    updateFollowUser(dt) {
        if (!this.isFollowUserEnabled()) return;
        const root = this._placedRoot;
        if (!root || !this.floorDetected) return;
        const delta = this._faceUser(root, false);
        const abs = Math.abs(delta);
        const TURN_AT = Math.PI / 3; // 60° — beyond the head's comfort range
        if (abs > TURN_AT) {
            this._followDwell = (this._followDwell || 0) + dt;
        } else if (abs < 0.12) {
            this._followDwell = 0;
            this._followTurning = false;
        }
        // A short dwell avoids twitching when the user just sways.
        if (this._followDwell > 0.6) this._followTurning = true;
        if (this._followTurning && abs > 0.1) {
            const step = Math.sign(delta) * Math.min(abs, 2.2 * dt); // ~126°/s, eased by clamp
            root.rotateY(step);
        }
    }

    /**
     * Set avatar scale for AR mode.
     * @param {THREE.Object3D} avatarRoot
     * @param {number} scale - Uniform scale factor (e.g. 0.5 for half-size)
     */
    setAvatarScale(avatarRoot, scale) {
        if (!avatarRoot) return;
        avatarRoot.scale.setScalar(scale);
        console.log(`[AR] Avatar scale set to ${scale}`);
    }

    /**
     * Programmatic entry point for starting AR (called from VR settings switch).
     * Checks that no other XR session is active before starting.
     * @returns {Promise<boolean>} true if AR session was started
     */
    async startAR() {
        if (this.renderer.xr.isPresenting) {
            console.warn('[AR] Another XR session is still active, cannot start AR yet');
            return false;
        }
        if (this.isARActive) {
            console.warn('[AR] AR is already active');
            return false;
        }
        await this.toggleAR();
        return true;
    }

    /**
     * Start AR directly from a real DOM user gesture (click/tap handler).
     *
     * WebXR spec requires requestSession() to be called inside a user
     * activation event. This method is designed to be called from a real
     * DOM click handler (e.g. an overlay button) so the browser recognises
     * the gesture. Unlike startAR()/toggleAR(), this method keeps the call
     * stack synchronous up to the requestSession() await — no intermediate
     * awaits that would expire the user activation token.
     *
     * @returns {Promise<void>}
     */
    async startARFromGesture() {
        if (this.isARActive) {
            console.warn('[AR] AR is already active');
            return;
        }

        // Build session init (all synchronous — preserves user activation).
        // ANDROID FIX: nothing required — 'local-floor' as required throws on
        // many ARCore devices; floor placement comes from hit-test.
        const sessionInit = {
            requiredFeatures: [],
            optionalFeatures: [
                'local-floor',
                'hit-test',
                'dom-overlay',
                'hand-tracking',
                'camera-access',
                'anchors',
                'plane-detection',
                'mesh-detection',
                'light-estimation',
                'layers',
            ],
        };

        try {
            sessionInit.optionalFeatures.push('depth-sensing');
            sessionInit.depthSensing = {
                usagePreference: ['cpu-optimized', 'gpu-optimized'],
                dataFormatPreference: ['luminance-alpha', 'float32'],
            };
        } catch {
            // depthSensing config not supported — ignore
        }

        const overlayEl = document.getElementById('ar-dom-overlay');
        if (overlayEl) {
            sessionInit.domOverlay = { root: overlayEl };
        }

        // CRITICAL: requestSession must be the first await in this call stack
        // so the user activation from the DOM click is still valid.
        console.log('[AR] Requesting immersive-ar session from user gesture...');
        // ANDROID FIX: use 'local' reference space for AR (three defaults to
        // 'local-floor', which freezes the session when not granted).
        this.renderer.xr.setReferenceSpaceType?.('local');
        let session;
        try {
            session = await navigator.xr.requestSession('immersive-ar', sessionInit);
        } catch (err) {
            // Restore three's default reference space so VR (which relies on
            // 'local-floor') is untouched when AR fails to start.
            this.renderer.xr.setReferenceSpaceType?.('local-floor');
            throw err;
        }
        session.__nexusMode = 'immersive-ar'; // reliable mode tag (Fix 1)
        await this.renderer.xr.setSession(session);
        this.onSessionStart(); // idempotent — ensures AR setup even if the
        // sessionstart listener's mode check misfires on this browser

        this.isARActive = true;
        if (this.arButton) {
            this.arButton.textContent = 'EXIT AR';
        }
    }

    dispose() {
        this._removeReticle();
        this._removeShadowPlane();

        if (this.hitTestSource) {
            this.hitTestSource.cancel();
            this.hitTestSource = null;
        }

        if (this.arButton && this.arButton.parentElement) {
            this.arButton.parentElement.removeChild(this.arButton);
        }
    }
}
