/**
 * Model-Viewer AR Module (Sketchfab-style)
 *
 * Provides AR experience across all platforms:
 *   - iOS Safari → AR Quick Look (USDZ via model-viewer)
 *   - Android Chrome → Google Scene Viewer (GLB via intent URL)
 *   - WebXR AR (Quest/Android Chrome) → Defers to ARSupport.js
 *   - Desktop → Shows QR code linking to the model for mobile AR scanning
 *
 * Uses Google's <model-viewer> web component for maximum compatibility.
 * @see https://modelviewer.dev/
 */
import QrCreator from '../../vendor/qr-creator/qr-creator.es6.min.js';

export class ModelViewerAR {
    constructor() {
        this._modelViewerLoaded = false;
        this._currentModelUrl = null;
        this._modelViewerEl = null;
        this._webxrARSupported = false;
        this._qrModal = null;

        // Detect capabilities
        this._isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        this._isAndroid = /Android/i.test(navigator.userAgent);
        this._isDesktop = !this._isIOS && !this._isAndroid;

        // Pre-detect LAN IP for QR codes (async, cached for later)
        if (this._isDesktop) this._asyncDetectLanIp();

        this._checkSupport();
    }

    async _checkSupport() {
        // Check if WebXR immersive-ar is available (handled by ARSupport.js)
        if (navigator.xr) {
            try {
                this._webxrARSupported = await navigator.xr.isSessionSupported('immersive-ar');
            } catch {
                this._webxrARSupported = false;
            }
        }

        console.log(
            `[ModelViewerAR] Platform: ${this._isIOS ? 'iOS' : this._isAndroid ? 'Android' : 'Desktop'} ` +
                `| WebXR AR: ${this._webxrARSupported} ` +
                `| Fallback needed: ${this.needsFallback()}`
        );
    }

    /**
     * Returns true if this device needs model-viewer AR fallback
     * (i.e., no WebXR AR support but has AR capability via Quick Look or Scene Viewer).
     */
    needsFallback() {
        if (this._webxrARSupported) return false; // WebXR handles it
        return this._isIOS || this._isAndroid; // Can use Quick Look or Scene Viewer
    }

    /**
     * Whether AR is available through any method (WebXR, fallback, or QR desktop).
     * Desktop is always "available" via QR code handoff.
     */
    isARAvailable() {
        return true; // All platforms can participate — desktop via QR
    }

    /**
     * Whether this is a desktop browser (shows QR code instead of launching AR).
     */
    isDesktop() {
        return this._isDesktop && !this._webxrARSupported;
    }

    /**
     * Load the model-viewer web component library (lazy — only when needed).
     */
    async _ensureModelViewer() {
        if (this._modelViewerLoaded) return;

        // Check if already loaded
        if (customElements.get('model-viewer')) {
            this._modelViewerLoaded = true;
            return;
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.type = 'module';
            script.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';
            script.onload = () => {
                this._modelViewerLoaded = true;
                console.log('[ModelViewerAR] model-viewer library loaded');
                resolve();
            };
            script.onerror = () => {
                console.error('[ModelViewerAR] Failed to load model-viewer library');
                reject(new Error('Failed to load model-viewer'));
            };
            document.head.appendChild(script);
        });
    }

    /**
     * Set the current avatar GLB URL for AR viewing.
     * @param {string} url - URL to a .glb file
     */
    setModel(url) {
        this._currentModelUrl = url;

        // Update hidden model-viewer element if it exists
        if (this._modelViewerEl) {
            this._modelViewerEl.setAttribute('src', url);
        }
    }

    /**
     * Create a hidden model-viewer element for AR launching.
     * This element is invisible — it only exists to provide AR Quick Look / Scene Viewer.
     * @param {HTMLElement} container - Parent element to append to
     */
    createHiddenViewer(container) {
        if (this._modelViewerEl) return;

        this._modelViewerEl = document.createElement('model-viewer');
        this._modelViewerEl.setAttribute('ar', '');
        this._modelViewerEl.setAttribute('ar-modes', 'scene-viewer quick-look');
        this._modelViewerEl.setAttribute('ar-scale', 'auto');
        this._modelViewerEl.setAttribute('camera-controls', '');
        this._modelViewerEl.setAttribute('shadow-intensity', '1');
        this._modelViewerEl.setAttribute('shadow-softness', '0.5');
        this._modelViewerEl.setAttribute('environment-image', 'neutral');
        this._modelViewerEl.setAttribute('auto-rotate', '');
        this._modelViewerEl.setAttribute('interaction-prompt', 'none');

        if (this._currentModelUrl) {
            this._modelViewerEl.setAttribute('src', this._currentModelUrl);
        }

        // Hidden by default — only used for AR activation
        Object.assign(this._modelViewerEl.style, {
            position: 'fixed',
            top: '-9999px',
            left: '-9999px',
            width: '1px',
            height: '1px',
            opacity: '0',
            pointerEvents: 'none',
        });

        container.appendChild(this._modelViewerEl);
    }

    /**
     * Launch AR experience using the best available method.
     * On desktop, shows a QR code modal instead.
     * @returns {Promise<boolean>} true if AR was launched or QR shown
     */
    async launchAR() {
        if (!this._currentModelUrl) {
            console.warn('[ModelViewerAR] No model URL set');
            return false;
        }

        // Desktop: show QR code for mobile scanning
        if (this.isDesktop()) {
            this._showQRCodeModal();
            return true;
        }

        if (!this.needsFallback()) {
            // WebXR AR — delegate to ARSupport.js (caller should handle this)
            console.log('[ModelViewerAR] WebXR AR available — caller should use ARSupport');
            return false;
        }

        try {
            await this._ensureModelViewer();

            if (!this._modelViewerEl) {
                this.createHiddenViewer(document.body);
                // Wait for element to initialize
                await new Promise((r) => setTimeout(r, 500));

                if (this._currentModelUrl) {
                    this._modelViewerEl.setAttribute('src', this._currentModelUrl);
                    // Wait for model to load
                    await new Promise((r) => setTimeout(r, 1000));
                }
            }

            // Activate AR via model-viewer's built-in AR launcher
            if (this._modelViewerEl.activateAR) {
                await this._modelViewerEl.activateAR();
                console.log('[ModelViewerAR] AR activated via model-viewer');
                return true;
            }

            // Fallback: construct Scene Viewer / Quick Look URL directly
            return this._launchDirectAR();
        } catch (error) {
            console.error('[ModelViewerAR] Failed to launch AR:', error);
            return false;
        }
    }

    /**
     * Direct AR launch without model-viewer (fallback).
     */
    _launchDirectAR() {
        const url = this._getAbsoluteModelUrl();

        if (this._isAndroid) {
            // Google Scene Viewer intent
            const intentUrl = `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(url)}&mode=ar_preferred&resizable=true#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(url)};end;`;
            const a = document.createElement('a');
            a.href = intentUrl;
            a.click();
            console.log('[ModelViewerAR] Launched Android Scene Viewer');
            return true;
        }

        if (this._isIOS) {
            // AR Quick Look — model-viewer handles USDZ conversion when available
            // For direct launch, try the model-viewer activateAR first (it handles USDZ)
            // If that fails, try linking directly
            console.warn(
                '[ModelViewerAR] iOS requires USDZ format for AR Quick Look. GLB files need server-side conversion.'
            );

            const a = document.createElement('a');
            a.rel = 'ar';
            a.href = url;
            a.click();
            return true;
        }

        return false;
    }

    // =========================================================================
    // QR CODE MODAL (Desktop → Mobile AR handoff, Sketchfab-style)
    // =========================================================================

    /**
     * Get the absolute URL for the current model (needed for QR codes and intents).
     */
    _getAbsoluteModelUrl() {
        if (!this._currentModelUrl) return '';
        if (this._currentModelUrl.startsWith('http')) return this._currentModelUrl;
        // Convert relative path to absolute URL
        return new URL(this._currentModelUrl, window.location.origin).href;
    }

    /**
     * Build an AR launch URL that works on mobile devices.
     * When scanned via QR code, this URL opens the model directly in AR.
     * Replaces localhost/127.0.0.1 with the machine's LAN IP so phones
     * on the same network can reach the server.
     */
    _buildMobileARUrl() {
        const pageUrl = new URL(window.location.href);
        pageUrl.searchParams.set('ar', '1');
        pageUrl.searchParams.set('model', this._currentModelUrl);

        // localhost is unreachable from a phone — try to get LAN IP
        if (pageUrl.hostname === 'localhost' || pageUrl.hostname === '127.0.0.1' || pageUrl.hostname === '0.0.0.0') {
            const lanIp = this._detectLanIp();
            if (lanIp) {
                pageUrl.hostname = lanIp;
            }
        }
        return pageUrl.href;
    }

    /**
     * Attempt to detect the machine's LAN IP via WebRTC.
     * Falls back to null (keeps current hostname).
     */
    _detectLanIp() {
        // If we already resolved it, reuse
        if (ModelViewerAR._cachedLanIp !== undefined) {
            return ModelViewerAR._cachedLanIp;
        }
        // Kick off async detection for next time
        this._asyncDetectLanIp();
        return null;
    }

    async _asyncDetectLanIp() {
        if (ModelViewerAR._cachedLanIp !== undefined) return;
        try {
            const pc = new RTCPeerConnection({ iceServers: [] });
            pc.createDataChannel('');
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            const ip = await new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(null), 3000);
                pc.onicecandidate = (e) => {
                    if (!e || !e.candidate || !e.candidate.candidate) return;
                    const match = e.candidate.candidate.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
                    if (match && match[1] !== '0.0.0.0' && !match[1].startsWith('127.')) {
                        clearTimeout(timeout);
                        resolve(match[1]);
                    }
                };
            });
            pc.close();
            ModelViewerAR._cachedLanIp = ip;
            console.log('[ModelViewerAR] Detected LAN IP:', ip);
        } catch (_) {
            ModelViewerAR._cachedLanIp = null;
        }
    }

    /**
     * Show a QR code modal on desktop so users can scan to view in AR on mobile.
     * Uses the QR Code API (canvas-based, no external dependencies).
     */
    _showQRCodeModal() {
        // Remove existing modal if open
        this._dismissQRModal();

        const arUrl = this._buildMobileARUrl();

        // Create modal overlay
        this._qrModal = document.createElement('div');
        this._qrModal.className = 'ar-qr-modal';
        this._qrModal.innerHTML = `
            <div class="ar-qr-modal__content">
                <button class="ar-qr-modal__close" aria-label="Close">&times;</button>
                <div class="ar-qr-modal__icon">&#x1F4F1;</div>
                <h3 class="ar-qr-modal__title">View in AR</h3>
                <p class="ar-qr-modal__desc">Scan this QR code with your phone or tablet to place this 3D model in your space</p>
                <div class="ar-qr-modal__qr-container">
                    <canvas class="ar-qr-modal__canvas"></canvas>
                </div>
                <p class="ar-qr-modal__url"></p>
                <p class="ar-qr-modal__hint">Works with iOS (AR Quick Look) and Android (Scene Viewer)</p>
            </div>
        `;

        // Close handlers
        this._qrModal.querySelector('.ar-qr-modal__close').onclick = () => this._dismissQRModal();
        this._qrModal.addEventListener('click', (e) => {
            if (e.target === this._qrModal) this._dismissQRModal();
        });

        // ESC key to close
        this._qrEscHandler = (e) => {
            if (e.key === 'Escape') this._dismissQRModal();
        };
        document.addEventListener('keydown', this._qrEscHandler);

        document.body.appendChild(this._qrModal);

        // Generate QR code on canvas
        const canvas = this._qrModal.querySelector('.ar-qr-modal__canvas');
        this._renderQRCode(canvas, arUrl);

        // Show the encoded URL for manual copy
        const urlEl = this._qrModal.querySelector('.ar-qr-modal__url');
        if (urlEl) {
            const parsed = new URL(arUrl);
            const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname);
            urlEl.textContent = isLocal ? `${arUrl}\n(phone must be on same network — open in browser by IP)` : arUrl;
            urlEl.style.cursor = 'pointer';
            urlEl.title = 'Click to copy';
            urlEl.addEventListener('click', () => {
                navigator.clipboard?.writeText(arUrl);
                urlEl.textContent = 'Copied!';
                setTimeout(() => (urlEl.textContent = arUrl), 1500);
            });
        }

        console.log('[ModelViewerAR] QR code modal shown for desktop AR handoff');
    }

    /**
     * Dismiss the QR code modal.
     */
    _dismissQRModal() {
        if (this._qrModal) {
            this._qrModal.remove();
            this._qrModal = null;
        }
        if (this._qrEscHandler) {
            document.removeEventListener('keydown', this._qrEscHandler);
            this._qrEscHandler = null;
        }
    }

    /**
     * Render a QR code onto a canvas element.
     * Uses a minimal QR code generator (no external library).
     * @param {HTMLCanvasElement} canvas
     * @param {string} text - The data to encode
     */
    _renderQRCode(canvas, text) {
        QrCreator.render(
            {
                text,
                radius: 0.0,
                ecLevel: 'M',
                fill: '#0a0e1a',
                background: '#ffffff',
                size: 200,
            },
            canvas
        );
    }

    // =========================================================================
    // AUTO-LAUNCH AR FROM QR CODE SCAN
    // =========================================================================

    /**
     * Check if the page was opened from a QR code scan and auto-launch AR.
     * Call this on page load.
     */
    checkAutoLaunchAR() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('ar') !== '1') return;

        const modelParam = params.get('model');
        if (modelParam) {
            this._currentModelUrl = modelParam;
        }

        // Only auto-launch on mobile (QR code was meant for phone/tablet)
        if (!this._isIOS && !this._isAndroid) return;

        console.log('[ModelViewerAR] Auto-launching AR from QR code scan');

        // Delay to let the page and 3D viewer initialize first
        setTimeout(async () => {
            try {
                // Try model-viewer first (handles USDZ for iOS, Scene Viewer for Android)
                await this._ensureModelViewer();
                if (!this._modelViewerEl) {
                    this.createHiddenViewer(document.body);
                    await new Promise((r) => setTimeout(r, 500));
                }
                if (this._currentModelUrl) {
                    this._modelViewerEl.setAttribute('src', this._currentModelUrl);
                    await new Promise((r) => setTimeout(r, 1500));
                }
                if (this._modelViewerEl?.activateAR) {
                    await this._modelViewerEl.activateAR();
                    return;
                }
            } catch (e) {
                console.warn('[ModelViewerAR] model-viewer auto-launch failed, trying direct:', e);
            }

            // Fallback to direct launch
            this._launchDirectAR();
        }, 2000);
    }

    // =========================================================================
    // AR BUTTON ENHANCEMENT
    // =========================================================================

    /**
     * Update the AR button in the XR launch bar based on capabilities.
     * Awaits ARSupport.ready so the capability check has completed before
     * deciding whether to apply the mobile fallback (Scene Viewer / Quick Look)
     * or the desktop QR code handler. This eliminates the race condition where
     * ARSupport's async isSessionSupported overwrites our onclick.
     *
     * @param {HTMLButtonElement} arButton - The existing AR button from ARSupport.js
     * @param {ARSupport} arSupport - The existing ARSupport instance
     * @returns {Promise<void>}
     */
    async enhanceARButton(arButton, arSupport) {
        if (!arButton) return;

        // Wait for ARSupport's WebXR capability check to finish.
        // This guarantees our onclick assignment happens *after* ARSupport's,
        // so we always get the final word on fallback devices.
        if (arSupport?.ready) {
            await arSupport.ready;
        }

        // If WebXR immersive-ar is natively supported (Quest, compatible Android
        // with ARCore), leave the button as ARSupport configured it — no fallback needed.
        if (arSupport?.webxrARSupported) {
            console.log('[ModelViewerAR] WebXR AR supported — no fallback needed');
            return;
        }

        // Desktop: always show AR button (opens QR code)
        if (this.isDesktop()) {
            arButton.classList.remove('xr-btn--disabled');
            arButton.innerHTML = '<span class="xr-btn__icon">&#x1F4F1;</span> VIEW IN AR';
            arButton.title = 'Scan QR code to view this avatar in AR on your phone';
            arButton.onclick = () => {
                this._showQRCodeModal();
            };
            console.log('[ModelViewerAR] Desktop AR button: opens QR code modal');
            return;
        }

        // Mobile fallback: override click to use model-viewer / direct launch
        // (Scene Viewer on Android, Quick Look on iOS)
        if (this._isAndroid || this._isIOS) {
            arButton.classList.remove('xr-btn--disabled');
            arButton.innerHTML = '<span class="xr-btn__icon">&#x1F4F1;</span> VIEW IN AR';
            arButton.onclick = async () => {
                arButton.textContent = '...';
                arButton.style.cursor = 'wait';
                try {
                    const success = await this.launchAR();
                    if (!success) {
                        alert('AR could not be launched on this device.');
                    }
                } catch (e) {
                    console.error('[ModelViewerAR] AR launch error:', e);
                    alert('AR failed to launch. Please try again.');
                } finally {
                    arButton.innerHTML = '<span class="xr-btn__icon">&#x1F4F1;</span> VIEW IN AR';
                    arButton.style.cursor = 'pointer';
                }
            };
            console.log('[ModelViewerAR] Mobile AR button enhanced with model-viewer fallback');
        }
    }

    dispose() {
        this._dismissQRModal();
        if (this._modelViewerEl && this._modelViewerEl.parentElement) {
            this._modelViewerEl.parentElement.removeChild(this._modelViewerEl);
        }
        this._modelViewerEl = null;
    }
}

// Static cache — shared across instances, survives re-creation
ModelViewerAR._cachedLanIp = undefined;
