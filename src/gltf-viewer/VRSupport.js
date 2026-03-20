/**
 * VR Support Module for ViewerEngine
 * Adds WebXR capabilities to the existing 3D viewer
 * Fixed: Context loss handling, debouncing, race conditions
 */

export class VRSupport {
    constructor(renderer, camera, scene, containerEl) {
        this.renderer = renderer;
        this.camera = camera;
        this.scene = scene;
        this.containerEl = containerEl || null;
        this.vrButton = null;
        this.isVRActive = false;

        // Lock to prevent race conditions (double clicking)
        this.isToggling = false;

        this.contextLost = false;

        this.init();
    }

    init() {
        // Enable WebXR on renderer
        this.renderer.xr.enabled = true;

        // --- WebGL context loss / restore handlers ---
        const canvas = this.renderer.domElement;
        canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault(); // allow restore
            this.contextLost = true;
            console.warn('[VR] WebGL context lost — VR disabled until restored');
            if (this.isVRActive) this.forceExit();
            if (this.vrButton) {
                this.vrButton.textContent = 'CONTEXT LOST';
                this.vrButton.classList.add('xr-btn--disabled');
            }
        });

        canvas.addEventListener('webglcontextrestored', () => {
            this.contextLost = false;
            console.log('[VR] WebGL context restored');
            if (this.vrButton) {
                this.vrButton.innerHTML = '<span class="xr-btn__icon">&#x1F576;</span> ENTER VR';
                this.vrButton.classList.remove('xr-btn--disabled');
            }
        });

        // Create VR button
        this.createVRButton();

        // Listen for VR session events
        this.renderer.xr.addEventListener('sessionstart', () => {
            this.isVRActive = true;
            console.log('[VR] Session started');
            this.onSessionStart();
        });

        this.renderer.xr.addEventListener('sessionend', () => {
            this.isVRActive = false;
            this.isToggling = false; // Release lock
            console.log('[VR] Session ended');
            this.onSessionEnd();
        });
    }

    _isHeadsetBrowser() {
        const ua = navigator.userAgent || '';
        return /OculusBrowser|Quest|Vive|Pico|Wolvic/i.test(ua);
    }

    createVRButton() {
        // Check if WebXR is supported
        if (!navigator.xr) {
            console.warn('[VR] WebXR not supported in this browser');
            return;
        }

        // On normal phones (Android / iOS, not headsets), skip VR button entirely.
        // VR requires a headset — showing a disabled button wastes precious mobile space.
        const ua = navigator.userAgent || '';
        const isPhone = (/Android/i.test(ua) || /iPhone|iPod/.test(ua)) && !this._isHeadsetBrowser();
        if (isPhone) {
            console.log('[VR] Phone detected — skipping VR button (no headset)');
            return; // vrButton stays null → XR launch bar won't add it
        }

        // Create VR button — styled via CSS class .xr-btn
        this.vrButton = document.createElement('button');
        this.vrButton.id = 'vr-button';
        this.vrButton.className = 'xr-btn xr-btn--vr';
        this.vrButton.innerHTML = '<span class="xr-btn__icon">&#x1F576;</span> ENTER VR';

        // Check VR support and setup button
        navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
            if (supported) {
                this.vrButton.onclick = () => this.toggleVR();
                console.log('[VR] Button added - WebXR supported');
            } else {
                console.warn('[VR] immersive-vr not supported');
                this.vrButton.innerHTML = '<span class="xr-btn__icon">&#x1F576;</span> VR N/A';
                this.vrButton.classList.add('xr-btn--disabled');
                this.vrButton.onclick = () => {
                    alert('WebXR not available. Use HTTPS or Meta Quest Browser.');
                };
            }
            // Button is appended to the XR launch bar by ViewerEngine
        });
    }

    async toggleVR() {
        // 1. Prevent overlapping calls (debounce)
        if (this.isToggling) {
            console.warn('[VR] Already toggling VR, please wait...');
            return;
        }

        // 2. Check if WebGL context is lost (Prevent the crash loop)
        if (this.contextLost) {
            alert('WebGL Context Lost. Please wait for it to restore or refresh the page.');
            return;
        }

        this.isToggling = true;

        // Update button to show loading state
        this.vrButton.innerHTML = '<span class="xr-btn__icon">&#x23F3;</span> ...';
        this.vrButton.style.cursor = 'wait';

        try {
            if (this.renderer.xr.isPresenting) {
                // Exit VR
                const session = this.renderer.xr.getSession();
                if (session) {
                    await session.end();
                } else {
                    // Force state cleanup if session is null but flag is true
                    console.warn('[VR] Session is null, forcing cleanup');
                    this.forceExit();
                }
            } else {
                // Enter VR
                // Only request features supported for immersive-vr.
                // 'plane-detection' and 'light-estimation' are AR-only and
                // cause console warnings when requested in VR mode.
                // 'layers' is Quest 3+ only — probe before requesting.
                const optionalFeatures = ['local-floor', 'bounded-floor', 'hand-tracking'];

                // layers API: only request if the browser/device actually advertises it
                if (typeof XRWebGLLayer !== 'undefined') {
                    optionalFeatures.push('layers');
                }

                const sessionInit = { optionalFeatures };

                // Ensure WebGL context is XR-compatible before requesting session
                const gl = this.renderer.getContext();
                if (gl.makeXRCompatible) {
                    try {
                        await gl.makeXRCompatible();
                        console.log('[VR] WebGL context marked as XR compatible');
                    } catch (e) {
                        console.warn('[VR] makeXRCompatible failed, continuing anyway:', e);
                    }
                }

                const session = await navigator.xr.requestSession('immersive-vr', sessionInit);

                // Configure XRWebGLLayer with alpha:true to enable Quest 3
                // passthrough toggle mid-session. When scene.background is null
                // and clear color alpha is 0, transparent pixels reveal the
                // camera feed. Opaque scenes are unaffected (black bg renders solid).
                try {
                    const xrLayer = new XRWebGLLayer(session, gl, { alpha: true });
                    session.updateRenderState({ baseLayer: xrLayer });
                    console.log('[VR] Custom XRWebGLLayer created (alpha:true — passthrough-ready)');
                } catch (e) {
                    console.warn('[VR] Could not set custom XRWebGLLayer, using default:', e);
                }

                // Set session on renderer
                await this.renderer.xr.setSession(session);

                this.vrButton.innerHTML = '<span class="xr-btn__icon">&#x23F9;</span> EXIT VR';
            }
        } catch (error) {
            console.error('[VR] Error during toggle:', error);

            let msg = 'Failed to ' + (this.renderer.xr.isPresenting ? 'exit' : 'enter') + ' VR.\n\n';

            if (error.name === 'InvalidStateError') {
                msg += 'The device or session is not in a valid state.\nPlease try refreshing the page.';
            } else if (error.name === 'NotAllowedError') {
                msg += 'VR access was denied.\nPlease grant permissions and try again.';
            } else if (error.message && error.message.includes('context')) {
                msg += 'WebGL context issue detected.\nPlease refresh the page.';
            } else {
                msg += error.message || error.toString();
            }

            alert(msg);

            this.forceExit();
            this.vrButton.innerHTML = '<span class="xr-btn__icon">&#x1F576;</span> ENTER VR';
            this.vrButton.style.cursor = 'pointer';
        } finally {
            this.isToggling = false;
            this.vrButton.style.cursor = 'pointer';
        }
    }

    forceExit() {
        console.log('[VR] Force exiting VR session');
        this.isVRActive = false;
        this.isToggling = false;
        if (this.vrButton) this.vrButton.innerHTML = '<span class="xr-btn__icon">&#x1F576;</span> ENTER VR';
        window.dispatchEvent(new CustomEvent('vr-session-end'));
    }

    onSessionStart() {
        if (this.vrButton) {
            this.vrButton.innerHTML = '<span class="xr-btn__icon">&#x23F9;</span> EXIT VR';
        }
        window.dispatchEvent(new CustomEvent('vr-session-start'));
        this.isToggling = false;
    }

    onSessionEnd() {
        if (this.vrButton) {
            this.vrButton.innerHTML = '<span class="xr-btn__icon">&#x1F576;</span> ENTER VR';
        }
        window.dispatchEvent(new CustomEvent('vr-session-end'));
        this.isToggling = false;
    }

    dispose() {
        if (this.vrButton && this.vrButton.parentElement) {
            this.vrButton.parentElement.removeChild(this.vrButton);
        }
    }
}
