/**
 * DeviceDetector — Unified OS/device/capability detection for mobile, VR, and AR.
 *
 * Detects:
 * - OS: iOS, Android, Windows, macOS, Linux, Quest OS
 * - Device: phone, tablet, desktop, headset (Quest 2/3/Pro, Vive, Pico)
 * - Capabilities: WebXR VR, WebXR AR, touch, gamepad, hand-tracking
 * - Browser: Safari, Chrome, Firefox, Quest Browser, Wolvic
 *
 * Usage:
 *   const dd = new DeviceDetector();
 *   dd.detect().then(() => {
 *     console.log(dd.device);  // 'phone' | 'tablet' | 'desktop' | 'headset'
 *     console.log(dd.os);      // 'ios' | 'android' | 'quest' | 'windows' | 'macos' | 'linux'
 *     console.log(dd.canVR);   // true/false
 *     console.log(dd.canAR);   // true/false
 *   });
 */
'use strict';

(function () {
    class DeviceDetector {
        constructor() {
            this.ua = navigator.userAgent || '';
            this.platform = navigator.platform || '';

            // Results — populated by detect()
            this.os = 'unknown';
            this.device = 'desktop';
            this.browser = 'unknown';
            this.canVR = false;
            this.canAR = false;
            this.hasTouch = false;
            this.hasGamepad = false;
            this.hasHandTracking = false;
            this.isSecureContext = false;
            this.screenWidth = window.innerWidth;
            this.screenHeight = window.innerHeight;
            this.pixelRatio = window.devicePixelRatio || 1;
            this.isPortrait = window.innerHeight > window.innerWidth;

            // Quest-specific
            this.questModel = null; // 'quest2' | 'quest3' | 'questPro' | null

            this._detected = false;
        }

        /**
         * Run all detection (sync parts + async WebXR checks).
         * Safe to call multiple times — caches after first run.
         * @returns {Promise<DeviceDetector>}
         */
        async detect() {
            if (this._detected) return this;

            this._detectSync();
            await this._detectAsync();
            this._applyHTMLClasses();
            this._detected = true;

            console.log('[DeviceDetector]', {
                os: this.os,
                device: this.device,
                browser: this.browser,
                canVR: this.canVR,
                canAR: this.canAR,
                hasTouch: this.hasTouch,
                questModel: this.questModel,
                screen: `${this.screenWidth}x${this.screenHeight}@${this.pixelRatio}`,
            });

            return this;
        }

        // ─── Sync detection ────────────────────────────────────────

        _detectSync() {
            const ua = this.ua;

            // Touch
            this.hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;

            // Secure context (required for WebXR, mic, camera)
            this.isSecureContext =
                window.isSecureContext ||
                location.protocol === 'https:' ||
                location.hostname === 'localhost' ||
                location.hostname === '127.0.0.1';

            // Gamepad
            this.hasGamepad = 'getGamepads' in navigator;

            // ── OS Detection ──
            if (/OculusBrowser|Quest/i.test(ua)) {
                this.os = 'quest';
            } else if (
                /iPad|iPhone|iPod/.test(ua) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
            ) {
                this.os = 'ios';
            } else if (/Android/i.test(ua)) {
                this.os = 'android';
            } else if (/Win/i.test(this.platform)) {
                this.os = 'windows';
            } else if (/Mac/i.test(this.platform)) {
                this.os = 'macos';
            } else if (/Linux/i.test(this.platform)) {
                this.os = 'linux';
            }

            // ── Quest Model Detection ──
            if (this.os === 'quest') {
                if (/Quest 3/i.test(ua)) this.questModel = 'quest3';
                else if (/Quest Pro/i.test(ua)) this.questModel = 'questPro';
                else if (/Quest 2/i.test(ua)) this.questModel = 'quest2';
                else this.questModel = 'quest2'; // default fallback
            }

            // ── Browser Detection ──
            if (/OculusBrowser/i.test(ua)) this.browser = 'quest-browser';
            else if (/Wolvic/i.test(ua)) this.browser = 'wolvic';
            else if (/CriOS/i.test(ua)) this.browser = 'chrome-ios';
            else if (/FxiOS/i.test(ua)) this.browser = 'firefox-ios';
            else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) this.browser = 'safari';
            else if (/Firefox/i.test(ua)) this.browser = 'firefox';
            else if (/Edg\//i.test(ua)) this.browser = 'edge';
            else if (/Chrome/i.test(ua)) this.browser = 'chrome';

            // ── Device Type Detection ──
            if (this.os === 'quest' || /Vive|Pico|Wolvic/i.test(ua)) {
                this.device = 'headset';
            } else if (this.os === 'ios' || this.os === 'android') {
                // Distinguish phone from tablet
                const isTabletUA = /iPad|Tablet|PlayBook/i.test(ua);
                const isLargeScreen = Math.min(window.innerWidth, window.innerHeight) >= 600;
                this.device = isTabletUA || (isLargeScreen && this.hasTouch) ? 'tablet' : 'phone';
            } else if (this.hasTouch && window.innerWidth <= 1024) {
                this.device = 'tablet';
            } else {
                this.device = 'desktop';
            }

            // Portrait
            this.isPortrait = window.innerHeight > window.innerWidth;
        }

        // ─── Async detection (WebXR capabilities) ──────────────────

        async _detectAsync() {
            if (!navigator.xr) return;

            try {
                this.canVR = await navigator.xr.isSessionSupported('immersive-vr');
            } catch {
                this.canVR = false;
            }

            try {
                this.canAR = await navigator.xr.isSessionSupported('immersive-ar');
            } catch {
                this.canAR = false;
            }

            // Hand tracking availability (Quest 2+, Quest 3)
            if (this.os === 'quest' && this.canVR) {
                this.hasHandTracking = true; // All Quest models support hand tracking
            }
        }

        // ─── HTML class application ────────────────────────────────

        _applyHTMLClasses() {
            const cl = document.documentElement.classList;

            // Remove old classes first
            cl.remove(
                'is-mobile',
                'is-tablet',
                'is-desktop',
                'is-headset',
                'is-android-phone',
                'is-ios',
                'is-quest',
                'os-ios',
                'os-android',
                'os-quest',
                'os-windows',
                'os-macos',
                'os-linux',
                'can-vr',
                'can-ar',
                'has-touch',
                'is-portrait',
                'is-landscape',
                'quest-2',
                'quest-3',
                'quest-pro',
                'browser-safari',
                'browser-chrome',
                'browser-firefox',
                'browser-quest',
                'browser-edge'
            );

            // Device type
            cl.add(`is-${this.device}`);
            if (this.device === 'phone') cl.add('is-mobile'); // backward compat
            if (this.device === 'headset') cl.add('is-headset');

            // OS
            cl.add(`os-${this.os}`);
            if (this.os === 'ios') cl.add('is-ios');
            if (this.os === 'android' && this.device === 'phone') cl.add('is-android-phone');
            if (this.os === 'quest') cl.add('is-quest');

            // Quest model
            if (this.questModel === 'quest2') cl.add('quest-2');
            if (this.questModel === 'quest3') cl.add('quest-3');
            if (this.questModel === 'questPro') cl.add('quest-pro');

            // Capabilities
            if (this.canVR) cl.add('can-vr');
            if (this.canAR) cl.add('can-ar');
            if (this.hasTouch) cl.add('has-touch');

            // Orientation
            cl.add(this.isPortrait ? 'is-portrait' : 'is-landscape');

            // Browser
            if (this.browser.includes('safari')) cl.add('browser-safari');
            if (this.browser.includes('chrome')) cl.add('browser-chrome');
            if (this.browser.includes('firefox')) cl.add('browser-firefox');
            if (this.browser.includes('quest')) cl.add('browser-quest');
            if (this.browser.includes('edge')) cl.add('browser-edge');
        }

        /**
         * Update orientation classes on resize/orientation change.
         */
        updateOrientation() {
            this.isPortrait = window.innerHeight > window.innerWidth;
            this.screenWidth = window.innerWidth;
            this.screenHeight = window.innerHeight;

            const cl = document.documentElement.classList;
            cl.toggle('is-portrait', this.isPortrait);
            cl.toggle('is-landscape', !this.isPortrait);
        }

        /**
         * Get recommended UI mode based on device + capabilities.
         * @returns {'mobile' | 'tablet' | 'desktop' | 'vr' | 'ar'}
         */
        getRecommendedUIMode() {
            if (this.device === 'headset') return 'vr';
            if (this.device === 'phone') return 'mobile';
            if (this.device === 'tablet') return 'tablet';
            return 'desktop';
        }

        /**
         * Get recommended renderer settings for this device.
         */
        getRendererSettings() {
            switch (this.device) {
                case 'headset':
                    return {
                        pixelRatio: 1.0,
                        antialias: this.questModel === 'quest3',
                        powerPreference: 'high-performance',
                        shadowMapEnabled: false,
                    };
                case 'phone':
                    return {
                        pixelRatio: Math.min(this.pixelRatio, 1.5),
                        antialias: false,
                        powerPreference: 'low-power',
                        shadowMapEnabled: false,
                    };
                case 'tablet':
                    return {
                        pixelRatio: Math.min(this.pixelRatio, 1.5),
                        antialias: true,
                        powerPreference: 'default',
                        shadowMapEnabled: false,
                    };
                default:
                    return {
                        pixelRatio: Math.min(this.pixelRatio, 2.0),
                        antialias: true,
                        powerPreference: 'high-performance',
                        shadowMapEnabled: true,
                    };
            }
        }
    }

    // Expose globally
    window.DeviceDetector = DeviceDetector;

    // Auto-detect on load
    const detector = new DeviceDetector();
    window.NEXUS_DEVICE = detector;

    // Run sync detection immediately for CSS classes
    detector._detectSync();
    detector._applyHTMLClasses();

    // Run async detection (WebXR) when ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => detector.detect());
    } else {
        detector.detect();
    }

    // Update orientation on resize
    let orientTimer;
    window.addEventListener('resize', () => {
        clearTimeout(orientTimer);
        orientTimer = setTimeout(() => detector.updateOrientation(), 100);
    });
    window.addEventListener('orientationchange', () => {
        setTimeout(() => detector.updateOrientation(), 200);
    });
})();
