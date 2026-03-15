/**
 * Mobile Support Module for ViewerEngine
 * Handles device detection, viewport fitting, touch optimizations,
 * and responsive avatar framing for phones and tablets.
 *
 * Non-destructive: purely additive — existing desktop/VR code is untouched.
 */

export class MobileSupport {
    constructor(renderer, camera, containerEl) {
        this.renderer = renderer;
        this.camera = camera;
        this.containerEl = containerEl;

        // Detection results (cached)
        this._isMobile = null;
        this._isTablet = null;
        this._isQuest = null;
        this._isPortrait = null;

        // Mobile-specific settings
        this.mobileFOV = 58; // wider FOV for phone screens
        this.desktopFOV = 35; // original FOV
        this.mobilePixelRatioCap = 1.5; // limit GPU load on phones
        this.desktopPixelRatioCap = 2.0;

        // Fullscreen button reference
        this._fullscreenBtn = null;

        this._onOrientationChange = this._handleOrientationChange.bind(this);
        this._onResize = this._handleResize.bind(this);

        this.init();
    }

    init() {
        // Cache device detection
        this._detect();

        if (this._isMobile || this._isTablet) {
            console.log(
                `[MobileSupport] Device detected: ${this._isMobile ? 'Mobile' : 'Tablet'}` +
                    ` | Portrait: ${this._isPortrait}` +
                    ` | Quest: ${this._isQuest}`
            );

            this._applyMobileOptimizations();
            this._createFullscreenButton();

            // Listen for orientation changes
            window.addEventListener('orientationchange', this._onOrientationChange);

            // Resize debounce for orientation transitions
            window.addEventListener('resize', this._onResize);
        } else {
            console.log('[MobileSupport] Desktop detected — no mobile optimizations applied');
        }
    }

    // =========================================================================
    // DEVICE DETECTION
    // =========================================================================

    _detect() {
        const ua = navigator.userAgent || '';
        const hasTouchScreen =
            'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;

        // Quest browser detection
        this._isQuest = /OculusBrowser|Quest/i.test(ua);

        // Mobile detection (exclude Quest — it's VR, not "phone")
        this._isMobile =
            !this._isQuest &&
            hasTouchScreen &&
            (/Mobi|Android|iPhone|iPod|webOS|BlackBerry|Opera Mini|IEMobile/i.test(ua) ||
                (window.innerWidth <= 768 && hasTouchScreen));

        // Tablet detection
        this._isTablet =
            !this._isQuest &&
            !this._isMobile &&
            hasTouchScreen &&
            (/iPad|Tablet|PlayBook/i.test(ua) ||
                (window.innerWidth > 768 && window.innerWidth <= 1200 && hasTouchScreen));

        this._isPortrait = window.innerHeight > window.innerWidth;
    }

    /** @returns {boolean} True if phone-sized mobile device */
    isMobile() {
        return this._isMobile;
    }

    /** @returns {boolean} True if tablet-sized device */
    isTablet() {
        return this._isTablet;
    }

    /** @returns {boolean} True if Meta Quest headset browser */
    isQuest() {
        return this._isQuest;
    }

    /** @returns {boolean} True if screen is in portrait orientation */
    isPortrait() {
        return this._isPortrait;
    }

    /** @returns {boolean} True if any mobile/tablet device (not desktop, not Quest) */
    isMobileOrTablet() {
        return this._isMobile || this._isTablet;
    }

    // =========================================================================
    // MOBILE OPTIMIZATIONS
    // =========================================================================

    _applyMobileOptimizations() {
        // 1. Cap pixel ratio for performance
        const dpr = Math.min(window.devicePixelRatio || 1, this.mobilePixelRatioCap);
        this.renderer.setPixelRatio(dpr);
        console.log(`[MobileSupport] Pixel ratio capped to ${dpr}`);

        // 2. Adjust FOV for mobile portrait
        this._updateFOV();

        // 3. Prevent rubber-band scrolling on iOS
        document.body.style.overscrollBehavior = 'none';
        document.documentElement.style.overscrollBehavior = 'none';

        // 4. Add mobile class to body for CSS targeting
        document.body.classList.add('nexus-mobile');
        if (this._isPortrait) {
            document.body.classList.add('nexus-portrait');
        }
    }

    _updateFOV() {
        if (this._isMobile && this._isPortrait) {
            this.camera.fov = this.mobileFOV;
        } else {
            this.camera.fov = this.desktopFOV;
        }
        this.camera.updateProjectionMatrix();
    }

    // =========================================================================
    // ORIENTATION & RESIZE HANDLERS
    // =========================================================================

    _handleOrientationChange() {
        // Delay to let browser settle the new dimensions
        setTimeout(() => {
            this._isPortrait = window.innerHeight > window.innerWidth;
            document.body.classList.toggle('nexus-portrait', this._isPortrait);
            this._updateFOV();
            this._resizeRenderer();
        }, 150);
    }

    _handleResize() {
        // Debounce resize events (orientation change fires multiple)
        if (this._resizeTimer) clearTimeout(this._resizeTimer);
        this._resizeTimer = setTimeout(() => {
            const w = this.containerEl.clientWidth || window.innerWidth;
            const h = this.containerEl.clientHeight || window.innerHeight;

            // Skip reframe if size change is trivial (< 5%) — prevents jitter
            if (this._lastW && this._lastH) {
                const wPct = Math.abs(w - this._lastW) / this._lastW;
                const hPct = Math.abs(h - this._lastH) / this._lastH;
                if (wPct < 0.05 && hPct < 0.05) return;
            }
            this._lastW = w;
            this._lastH = h;

            this._isPortrait = window.innerHeight > window.innerWidth;
            document.body.classList.toggle('nexus-portrait', this._isPortrait);
            this._updateFOV();
            this._resizeRenderer();
        }, 100);
    }

    _resizeRenderer() {
        const w = this.containerEl.clientWidth || window.innerWidth;
        const h = this.containerEl.clientHeight || window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    // =========================================================================
    // AVATAR FRAMING (MOBILE-AWARE)
    // =========================================================================

    /**
     * Get the recommended fitOffset for frameObject() based on device.
     * Mobile portrait needs more space (further camera) for the avatar to fit.
     * @returns {number} fitOffset multiplier
     */
    getFitOffset() {
        if (this._isMobile && this._isPortrait) {
            return 2.2; // further back in portrait to show full avatar
        }
        if (this._isMobile) {
            return 1.65; // landscape phone: moderate distance
        }
        if (this._isTablet) {
            return 1.5;
        }
        return 1.35; // desktop default
    }

    /**
     * Get recommended camera position for mobile after avatar load.
     * Returns null if no adjustment needed (desktop).
     * @param {THREE.Box3} boundingBox - Avatar bounding box
     * @returns {{ position: {x,y,z}, target: {x,y,z} } | null}
     */
    getMobileCameraSetup(boundingBox) {
        if (!this._isMobile && !this._isTablet) return null;

        const size = boundingBox.getSize({ x: 0, y: 0, z: 0 });
        const center = boundingBox.getCenter({ x: 0, y: 0, z: 0 });

        // Bias target toward upper body for portrait mode
        const targetY = center.y + size.y * (this._isPortrait ? 0.15 : 0.1);

        return {
            target: { x: center.x, y: targetY, z: center.z },
        };
    }

    // =========================================================================
    // FULLSCREEN BUTTON (MOBILE ONLY)
    // =========================================================================

    _createFullscreenButton() {
        // Only show on mobile (Quest has its own immersive mode)
        if (this._isQuest) return;

        this._fullscreenBtn = document.createElement('button');
        this._fullscreenBtn.id = 'fullscreen-btn';
        this._fullscreenBtn.textContent = '⛶';
        this._fullscreenBtn.title = 'Fullscreen';
        this._fullscreenBtn.setAttribute('aria-label', 'Toggle fullscreen');

        Object.assign(this._fullscreenBtn.style, {
            position: 'absolute',
            top: '20px',
            right: '20px',
            width: '48px',
            height: '48px',
            fontSize: '24px',
            lineHeight: '48px',
            textAlign: 'center',
            color: '#fff',
            background: 'rgba(0, 229, 255, 0.25)',
            border: '1px solid rgba(0, 229, 255, 0.4)',
            borderRadius: '12px',
            cursor: 'pointer',
            zIndex: '998',
            fontFamily: 'system-ui, sans-serif',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            transition: 'all 0.3s',
            padding: '0',
        });

        this._fullscreenBtn.addEventListener('click', () => {
            this._toggleFullscreen();
        });

        // Update icon on fullscreen change
        document.addEventListener('fullscreenchange', () => {
            this._fullscreenBtn.textContent = document.fullscreenElement ? '⊠' : '⛶';
        });

        (this.containerEl || document.body).appendChild(this._fullscreenBtn);
        console.log('[MobileSupport] Fullscreen button added');
    }

    _toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        } else {
            const el = document.documentElement;
            const req =
                el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
            if (req) {
                req.call(el).catch(() => {});
            }
        }
    }

    // =========================================================================
    // VR PERFORMANCE OPTIMIZATIONS (MOBILE / QUEST)
    // =========================================================================

    /**
     * Apply performance optimizations when entering VR on mobile/Quest.
     * Call this from ViewerEngine on vr-session-start.
     */
    applyVROptimizations() {
        if (this._isQuest) {
            // Quest: lower pixel ratio for VR performance
            this.renderer.setPixelRatio(1.0);
            console.log('[MobileSupport] Quest VR: pixel ratio set to 1.0');
        } else if (this._isMobile) {
            this.renderer.setPixelRatio(1.0);
            console.log('[MobileSupport] Mobile VR: pixel ratio set to 1.0');
        }
    }

    /**
     * Restore normal rendering settings when exiting VR.
     */
    restoreFromVR() {
        if (this._isQuest || this._isMobile || this._isTablet) {
            const dpr = Math.min(window.devicePixelRatio || 1, this.mobilePixelRatioCap);
            this.renderer.setPixelRatio(dpr);
            console.log(`[MobileSupport] Restored pixel ratio to ${dpr}`);
        }
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================

    dispose() {
        window.removeEventListener('orientationchange', this._onOrientationChange);
        window.removeEventListener('resize', this._onResize);
        if (this._resizeTimer) clearTimeout(this._resizeTimer);
        if (this._fullscreenBtn && this._fullscreenBtn.parentElement) {
            this._fullscreenBtn.parentElement.removeChild(this._fullscreenBtn);
        }
        document.body.classList.remove('nexus-mobile', 'nexus-portrait');
    }
}
