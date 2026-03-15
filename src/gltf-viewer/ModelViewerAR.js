/**
 * Model-Viewer AR Fallback Module
 * Provides AR experience on devices that don't support WebXR immersive-ar.
 *
 * Strategy:
 *   - iOS Safari → AR Quick Look (native USDZ viewer via model-viewer)
 *   - Android Chrome (no WebXR AR) → Google Scene Viewer (GLB via intent URL)
 *   - WebXR AR supported → Defers to ARSupport.js (existing WebXR implementation)
 *
 * Uses Google's <model-viewer> web component for maximum compatibility.
 * @see https://modelviewer.dev/
 */

export class ModelViewerAR {
    constructor() {
        this._modelViewerLoaded = false;
        this._currentModelUrl = null;
        this._modelViewerEl = null;
        this._webxrARSupported = false;

        // Detect capabilities
        this._isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        this._isAndroid = /Android/i.test(navigator.userAgent);

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
     * Whether AR is available through any method (WebXR or fallback).
     */
    isARAvailable() {
        return this._webxrARSupported || this._isIOS || this._isAndroid;
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
     * @returns {Promise<boolean>} true if AR was launched
     */
    async launchAR() {
        if (!this._currentModelUrl) {
            console.warn('[ModelViewerAR] No model URL set');
            return false;
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
        const url = this._currentModelUrl;

        if (this._isAndroid) {
            // Google Scene Viewer intent
            const intentUrl = `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(url)}&mode=ar_only#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(url)};end;`;
            const a = document.createElement('a');
            a.href = intentUrl;
            a.click();
            console.log('[ModelViewerAR] Launched Android Scene Viewer');
            return true;
        }

        if (this._isIOS) {
            // AR Quick Look — requires USDZ format
            // If the model is GLB, we can't directly launch Quick Look without USDZ conversion
            // model-viewer handles this automatically if loaded
            console.warn(
                '[ModelViewerAR] iOS requires USDZ format for AR Quick Look. GLB files need server-side conversion.'
            );

            // Try linking directly — Safari will show AR Quick Look if the file is USDZ
            const a = document.createElement('a');
            a.rel = 'ar';
            a.href = url;
            a.click();
            return true;
        }

        return false;
    }

    /**
     * Update the AR button in the XR launch bar based on capabilities.
     * Enhances the existing AR button to use model-viewer fallback when needed.
     * @param {HTMLButtonElement} arButton - The existing AR button from ARSupport.js
     * @param {ARSupport} arSupport - The existing ARSupport instance
     */
    enhanceARButton(arButton, arSupport) {
        if (!arButton || !this.needsFallback()) return;

        // Override the click handler to use model-viewer on unsupported devices
        arButton.classList.remove('xr-btn--disabled');
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
                arButton.innerHTML = '<span class="xr-btn__icon">&#x1F4F1;</span> ENTER AR';
                arButton.style.cursor = 'pointer';
            }
        };

        console.log('[ModelViewerAR] AR button enhanced with model-viewer fallback');
    }

    dispose() {
        if (this._modelViewerEl && this._modelViewerEl.parentElement) {
            this._modelViewerEl.parentElement.removeChild(this._modelViewerEl);
        }
        this._modelViewerEl = null;
    }
}
