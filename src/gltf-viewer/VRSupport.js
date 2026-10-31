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
            // XL4. However it ended — including a person giving up on a frozen headset — print
            // what every step of entry did and how many frames were drawn.
            this.trace?.ended();
            this.onSessionEnd();
        });
    }

    /**
     * XL5. Whether to ask for the WebXR Layers feature. Only in a headset's own browser (Quest
     * Browser, Pico, Wolvic…), or when `?xrLayers=1` forces it; `?xrLayers=0` forbids it.
     *
     * Nothing in this app draws a layer of its own. Asking for the feature changes one thing: three
     * r147 then renders through a projection layer instead of the classic XRWebGLLayer. In Quest
     * Browser that path is the native one (single-sampled render-to-texture) and has been working.
     * Desktop Chrome driving Quest Link or SteamVR also offers it now — the comment this replaces
     * said it did not — and there it is a different path: no multisampled render-to-texture, so
     * three draws into a 4× multisampled buffer and blits into the layer's texture every frame. A
     * Chrome 157 / Windows / Link session was granted layers and stayed on the loading screen;
     * every test this app has (the IWER emulator included) runs the classic path. On a PC there is
     * nothing to gain from layers here, so the PC gets the path WebXR guarantees.
     */
    static wantsLayers({ userAgent = '', search = '', hasQuadLayer = false } = {}) {
        if (!hasQuadLayer) return false;
        const forced = /[?&]xrLayers=(1|on|true|0|off|false)\b/i.exec(search || '');
        if (forced) return /^(1|on|true)$/i.test(forced[1]);
        return /OculusBrowser|Quest|Vive|Pico|Wolvic|SamsungXR/i.test(userAgent || '');
    }

    /**
     * XL6. The GPU a WebGL context runs on, as the browser names it (on Windows the ANGLE string
     * carries vendor, model and Direct3D backend). Null if the browser will not say.
     */
    static gpuName(gl) {
        try {
            if (!gl || (gl.isContextLost && gl.isContextLost())) return null;
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            const name = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
            return name ? String(name).slice(0, 140) : null;
        } catch (_) {
            return null;
        }
    }

    /**
     * XL6. Make three r147 see no `renderState.layers` on this session, so its setSession() takes
     * the classic XRWebGLLayer path. An own property on the render-state object shadows the
     * prototype getter; three reads it twice, synchronously, before any frame, and the next
     * updateRenderState() replaces the object anyway. Returns true if it had anything to hide.
     */
    static hideLayersFromThree(session) {
        try {
            const rs = session && session.renderState;
            if (!rs || rs.layers === undefined) return false;
            Object.defineProperty(rs, 'layers', { value: undefined, configurable: true });
            // Read back through the session, as three will: if this browser hands out a fresh
            // render-state object per read, the shadow is lost and this says so in the report.
            return session.renderState.layers === undefined;
        } catch (_) {
            return false;
        }
    }

    /**
     * XL6. What the session really is, for the entry trace: which features the browser granted
     * (not which were asked for), which path three is drawing through, and the frame rate.
     */
    static sessionFacts(session, renderer) {
        let path = null;
        try {
            const base = renderer && renderer.xr && renderer.xr.getBaseLayer ? renderer.xr.getBaseLayer() : null;
            if (base) {
                path =
                    typeof XRWebGLLayer !== 'undefined' && base instanceof XRWebGLLayer
                        ? 'XRWebGLLayer'
                        : 'projection layer';
            }
        } catch (_) {
            /* unknown */
        }
        let granted = null;
        try {
            if (session && session.enabledFeatures) granted = Array.from(session.enabledFeatures);
        } catch (_) {
            /* not exposed by this browser */
        }
        return {
            visibility: session ? session.visibilityState : null,
            path,
            granted,
            frameRate: (session && session.frameRate) || null,
        };
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
                    this.trace?.pageEnding('EXIT VR pressed');
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
                const optionalFeatures = ['local-floor', 'bounded-floor', 'hand-tracking'];

                // XL5. 'layers' only in a headset's own browser — see VRSupport.wantsLayers.
                const wantLayers = VRSupport.wantsLayers({
                    userAgent: navigator.userAgent,
                    search: typeof location !== 'undefined' ? location.search : '',
                    hasQuadLayer:
                        typeof XRWebGLBinding !== 'undefined' &&
                        typeof XRWebGLBinding.prototype?.createQuadLayer === 'function',
                });
                if (wantLayers) optionalFeatures.push('layers');

                const sessionInit = { optionalFeatures };

                // XL4. Every step from here is recorded (src/gltf-viewer/XREntryTrace.js).
                const trace = this.trace || null;
                this._entering = true;
                let stepNow = 'request';
                const mark = (id, detail) => {
                    stepNow = id;
                    trace?.step(id, detail);
                };
                // XL6. What a report has to say about the machine, so nobody has to ask for it:
                // secure context, and which GPU draws her before and after the move to the headset.
                trace?.begin({
                    features: optionalFeatures,
                    userAgent: (navigator.userAgent || '').slice(0, 120),
                    visibility: document.visibilityState,
                    secure: typeof isSecureContext === 'boolean' ? isSecureContext : null,
                    gpu: VRSupport.gpuName(gl),
                });

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
                let session;
                try {
                    session = await navigator.xr.requestSession('immersive-vr', sessionInit);
                } catch (err) {
                    trace?.fail('request', err);
                    throw err;
                }
                mark('granted');
                // XL4. A headset that stops showing the page (its own menu, Link losing focus) says
                // so here; the report keeps every change.
                session.addEventListener('visibilitychange', () => {
                    trace?.note(`session visibility → ${session.visibilityState}`);
                });
                // XL6. And the desktop page's own visibility: Chrome throttles a hidden page's
                // timers to one a second, which is what turned a 226 ms warm-up into 34 s.
                const onPageVisibility = () => trace?.note(`desktop page visibility → ${document.visibilityState}`);
                document.addEventListener('visibilitychange', onPageVisibility);
                session.addEventListener('end', () =>
                    document.removeEventListener('visibilitychange', onPageVisibility)
                );

                try {
                    const lossesBefore = this._contextLosses || 0;
                    mark('gpu');
                    await this._makeXRCompatible(gl);
                    mark('card', {
                        gpuMoved: (this._contextLosses || 0) > lossesBefore,
                        gpu: VRSupport.gpuName(gl),
                    });

                    // XL3. The HomePilot loading card: the session's first frames show the app, not
                    // darkness while the warm-up below runs. ViewerEngine provides it.
                    if (typeof this.beginSplash === 'function') {
                        try {
                            this.beginSplash();
                        } catch (e) {
                            console.warn('[VR] loading card failed, entering without it:', e);
                        }
                    }

                    // XL2. No custom XRWebGLLayer any more. One used to be created here with
                    // alpha:true "for passthrough", but setSession() below always replaces it with
                    // three's own layer — an XRWebGLLayer with the context's alpha (three r147
                    // creates every context with alpha: true) or an RGBA8 projection layer — so it
                    // only ever allocated a second full-resolution headset framebuffer, on the
                    // frame path the hang lived on, and threw it away.
                    // XL6. three r147 picks its rendering path from `session.renderState.layers ===
                    // undefined`, not from the features granted — and Chrome on Windows exposes
                    // that attribute (as an empty list) without the 'layers' feature. So XL5 alone
                    // did not keep a PC off the projection-layer path: a Link log reported layers
                    // with 'layers' never requested. Where layers are not wanted, hide the
                    // attribute from three for the one synchronous read setSession() makes, and it
                    // builds the classic XRWebGLLayer every immersive session supports.
                    const layersHidden = !wantLayers && VRSupport.hideLayersFromThree(session);
                    await this.renderer.xr.setSession(session);
                    mark('session', { ...VRSupport.sessionFacts(session, this.renderer), layersHidden });
                    // XL5. Say how it is going while the person is still in the headset: a log
                    // copied mid-session used to end at "VR Started" with no word about frames.
                    for (const ms of [3000, 8000, 20000]) {
                        setTimeout(() => {
                            if (this.isVRActive) trace?.pulse();
                        }, ms);
                    }

                    // XL2. Build every shader program and upload every texture in small tasks, so no
                    // frame of hers does it all in one — on Windows over Link that single task ran
                    // long enough for Chrome to declare the page unresponsive. XL3: this now runs
                    // behind the loading card, which draws only its own tiny scene meanwhile.
                    if (typeof this.prepareForSession === 'function') {
                        mark('warmup', { page: document.visibilityState });
                        try {
                            const r = await this.prepareForSession();
                            mark(
                                'warmed',
                                r
                                    ? {
                                          programs: r.programs,
                                          textures: r.textures,
                                          ms: r.ms,
                                          ok: r.ok,
                                          page: document.visibilityState,
                                      }
                                    : null
                            );
                        } catch (e) {
                            console.warn('[VR] VR warm-up failed, entering anyway:', e);
                            mark('warmed', { failed: String((e && e.message) || e) });
                        }
                    }
                } catch (err) {
                    trace?.fail(stepNow, err);
                    trace?.pageEnding(`entry failed at ${stepNow}`);
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
            // XL4. Entry is over, entered or not: the last step of the trace.
            if (this._entering) {
                this._entering = false;
                this.trace?.finished(Boolean(this.renderer.xr.isPresenting));
            }
            // XL2. While entering, a context restore leaves the render loop stopped (ViewerEngine
            // holds it for the warm-up). Whatever happened above, make sure it runs again.
            if (typeof this.onEntryFinished === 'function') {
                try {
                    // XL3. Whether VR was entered decides whether the card stays its minimum.
                    this.onEntryFinished(Boolean(this.renderer.xr.isPresenting));
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
        this.trace?.pageEnding('forced exit');
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
