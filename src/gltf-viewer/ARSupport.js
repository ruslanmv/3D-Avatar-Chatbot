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
            // AR sessions have 'immersive-ar' mode
            return session && session.mode === 'immersive-ar';
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
            return;
        }

        // Create AR button — styled via CSS class .xr-btn
        this.arButton = document.createElement('button');
        this.arButton.id = 'ar-button';
        this.arButton.className = 'xr-btn xr-btn--ar';
        this.arButton.innerHTML = '<span class="xr-btn__icon">&#x1F4F1;</span> ENTER AR';

        // Check AR support
        navigator.xr
            .isSessionSupported('immersive-ar')
            .then((supported) => {
                if (supported) {
                    this.arButton.onclick = () => this.toggleAR();
                    console.log('[AR] immersive-ar supported — AR button enabled');
                } else {
                    console.log('[AR] immersive-ar not supported on this device — button shown disabled');
                    this.arButton.classList.add('xr-btn--disabled');
                    this.arButton.onclick = () => {
                        alert(
                            'AR mode is not supported on this device/browser.\nUse a supported device like Meta Quest or Android with Chrome.'
                        );
                    };
                }
            })
            .catch(() => {
                console.warn('[AR] Failed to check immersive-ar support');
                this.arButton.classList.add('xr-btn--disabled');
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

                // Request AR session
                const sessionInit = {
                    requiredFeatures: ['local-floor'],
                    optionalFeatures: [
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

                const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
                await this.renderer.xr.setSession(session);

                this.arButton.textContent = 'EXIT AR';
            }
        } catch (error) {
            console.error('[AR] Toggle error:', error);

            let msg = 'Failed to ' + (this.isARActive ? 'exit' : 'enter') + ' AR.\n\n';
            if (error.name === 'NotSupportedError') {
                msg += 'AR mode is not supported on this device/browser.';
            } else if (error.name === 'NotAllowedError') {
                msg += 'Camera/AR access was denied.\nPlease grant permissions and try again.';
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

        // Move shadow plane to match
        if (this.shadowPlane) {
            this.shadowPlane.position.y = pos.y;
        }

        console.log(`[AR] Avatar placed at (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
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
