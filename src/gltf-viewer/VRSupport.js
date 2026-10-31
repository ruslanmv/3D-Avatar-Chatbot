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
            // XL1. Counted, so _makeXRCompatible can tell a GPU move (a loss happened) from a
            // failure that has nothing to do with the context.
            this._contextLosses = (this._contextLosses || 0) + 1;
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
        return /OculusBrowser|Quest|Vive|Pico|Wolvic|SamsungXR/i.test(ua);
    }

    createVRButton() {
        // Check if WebXR is supported
        if (!navigator.xr) {
            console.warn('[VR] WebXR not supported in this browser');
            return;
        }

        // On phones (Android / iOS, not headsets or tablets), skip VR button.
        // VR requires a headset — showing a disabled button wastes precious mobile space.
        // Tablets (larger screens) are allowed through: isSessionSupported() at line 96
        // becomes the sole gatekeeper, supporting Android XR tablets (Samsung Galaxy Tab, etc.).
        const ua = navigator.userAgent || '';
        const isAndroid = /Android/i.test(ua);
        const isIOS = /iPhone|iPod/.test(ua);
        const shortDim = Math.min(window.innerWidth, window.innerHeight);
        const isTabletSize = shortDim > 480; // phones max ~430px on short axis
        const isPhone = (isAndroid || isIOS) && !this._isHeadsetBrowser() && !isTabletSize;
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

        // 2. Block VR on phones — immersive-vr requires a headset with 6DOF tracking.
        // Without one, the user gets a black screen with no way to exit.
        if (!this.vrButton && !this.renderer.xr.isPresenting) {
            console.warn('[VR] VR not available on this device (no headset detected)');
            return;
        }

        // 3. Check if WebGL context is lost (Prevent the crash loop)
        if (this.contextLost) {
            alert('WebGL Context Lost. Please wait for it to restore or refresh the page.');
            return;
        }

        this.isToggling = true;

        // Update button to show loading state (null-safe for phones exiting VR)
        if (this.vrButton) {
            this.vrButton.innerHTML = '<span class="xr-btn__icon">&#x23F3;</span> ...';
            this.vrButton.style.cursor = 'wait';
        }

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
                // Double-check context health — the contextLost flag may not
                // be set yet if the loss event is still queued.
                const gl = this.renderer.getContext();
                if (gl.isContextLost()) {
                    this.contextLost = true;
                    console.warn('[VR] WebGL context is lost — aborting VR entry');
                    alert('WebGL context is lost. Please wait for it to restore or refresh the page.');
                    return;
                }

                // Only request features supported for immersive-vr.
                // 'plane-detection' and 'light-estimation' are AR-only and
                // cause console warnings when requested in VR mode.
                // 'layers' is Quest 3+ only — probe before requesting.
                const optionalFeatures = ['local-floor', 'bounded-floor', 'hand-tracking'];

                // layers API: only request when the browser *actually* supports
                // XRWebGLBinding.prototype.createQuadLayer (the compositing entry
                // point). Checking only for XRWebGLBinding is too broad — desktop
                // Chrome exposes XRWebGLBinding but not the layers feature, which
                // triggers an "Unsupported feature: layers" console warning.
                if (
                    typeof XRWebGLBinding !== 'undefined' &&
                    typeof XRWebGLBinding.prototype?.createQuadLayer === 'function'
                ) {
                    optionalFeatures.push('layers');
                }

                const sessionInit = { optionalFeatures };

                // XL1. The session first, then the GPU — the order WebXR expects.
                //
                // On a PC driving a headset over Quest Link (or SteamVR), the page usually starts
                // on a GPU the headset is not attached to: ViewerEngine passes `xrCompatible: true`
                // to the renderer, but three r147 builds its context attributes from a fixed list
                // that omits it, so that option has never reached the context. Making the context
                // XR-compatible then MOVES it to the headset's GPU — Chrome loses it and restores
                // it there — and makeXRCompatible() rejects with InvalidStateError while it does.
                // This used to log "continuing anyway", request the session with the context
                // still lost, and spend the seconds of the move after the click, which is the
                // user activation requestSession() needs. Requesting first uses the click while
                // it is fresh; nothing after that needs one.
                const session = await navigator.xr.requestSession('immersive-vr', sessionInit);

                try {
                    await this._makeXRCompatible(gl);

                    // XL2. Build every shader program and upload every texture before the first VR
                    // frame, in small tasks, so that frame does not do it all in one — on Windows
                    // over Link that single task ran long enough for Chrome to declare the page
                    // unresponsive. ViewerEngine provides it; without it entry proceeds as before.
                    if (typeof this.prepareForSession === 'function') {
                        try {
                            await this.prepareForSession();
                        } catch (e) {
                            console.warn('[VR] VR warm-up failed, entering anyway:', e);
                        }
                    }

                    // XL2. No custom XRWebGLLayer any more. One used to be created here with
                    // alpha:true "for passthrough", but setSession() below always replaces it with
                    // three's own layer — an XRWebGLLayer with the context's alpha (three r147
                    // creates every context with alpha: true) or an RGBA8 projection layer — so it
                    // only ever allocated a second full-resolution headset framebuffer, on the
                    // frame path the hang lived on, and threw it away.
                    await this.renderer.xr.setSession(session);
                } catch (err) {
                    // XL1. A session the page cannot draw into is a headset showing a frozen
                    // loading screen. End it, so the person is back in the browser with a message
                    // instead of stuck in the dark.
                    try {
                        await session.end();
                    } catch (_) {
                        /* already ended */
                    }
                    throw err;
                }

                if (this.vrButton) {
                    this.vrButton.innerHTML = '<span class="xr-btn__icon">&#x23F9;</span> EXIT VR';
                }
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
            if (this.vrButton) {
                this.vrButton.innerHTML = '<span class="xr-btn__icon">&#x1F576;</span> ENTER VR';
                this.vrButton.style.cursor = 'pointer';
            }
        } finally {
            this.isToggling = false;
            if (this.vrButton) {
                this.vrButton.style.cursor = 'pointer';
            }
            // XL2. While entering, a context restore leaves the render loop stopped (ViewerEngine
            // holds it for the warm-up). Whatever happened above, make sure it runs again.
            if (typeof this.onEntryFinished === 'function') {
                try {
                    this.onEntryFinished();
                } catch (e) {
                    console.warn('[VR] could not restart the render loop:', e);
                }
            }
        }
    }

    /**
     * XL1. Make the WebGL context usable by the headset, surviving the GPU move this can cause.
     *
     * When the context has to move to the headset's GPU, Chrome loses it, restores it there, and
     * rejects this first call. That is not a failure — wait for the restore (three.js rebuilds
     * its state in its own 'webglcontextrestored' listener, registered before ours), then ask
     * again; on the right GPU it resolves at once. A rejection with no context loss behind it
     * is a real failure and is thrown as it came.
     * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
     */
    async _makeXRCompatible(gl) {
        if (!gl || typeof gl.makeXRCompatible !== 'function') {
            return;
        }
        const lossesBefore = this._contextLosses || 0;
        try {
            await gl.makeXRCompatible();
            console.log('[VR] WebGL context marked as XR compatible');
            return;
        } catch (err) {
            // The 'webglcontextlost' event can still be queued behind this rejection.
            await new Promise((r) => setTimeout(r, 300));
            const moved = (this._contextLosses || 0) > lossesBefore || gl.isContextLost();
            if (!moved) {
                throw err;
            }
            console.log("[VR] Moving the 3D context to the headset's GPU — waiting for it to come back...");
        }
        await this._waitForContextRestore(gl, 8000);
        await gl.makeXRCompatible();
        console.log("[VR] WebGL context restored on the headset's GPU and marked XR compatible");
    }

    /**
     * Resolve once the context is back (immediately if it already is), after three.js's own
     * restore handler has run; reject if it does not come back in time.
     */
    _waitForContextRestore(gl, timeoutMs) {
        const canvas = this.renderer.domElement;
        return new Promise((resolve, reject) => {
            if (!gl.isContextLost()) {
                resolve();
                return;
            }
            let timer = null;
            const onRestored = () => {
                clearTimeout(timer);
                canvas.removeEventListener('webglcontextrestored', onRestored);
                // A turn later, so every other restore listener (three's, ViewerEngine's,
                // PostProcessing's) has rebuilt what it owns before XR starts drawing.
                setTimeout(resolve, 0);
            };
            canvas.addEventListener('webglcontextrestored', onRestored);
            timer = setTimeout(() => {
                canvas.removeEventListener('webglcontextrestored', onRestored);
                reject(new Error('The WebGL context did not come back after moving to the headset GPU.'));
            }, timeoutMs);
        });
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
