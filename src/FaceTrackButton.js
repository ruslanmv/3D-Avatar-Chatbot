/**
 * FaceTrackButton — UI wiring for the face tracking toggle.
 *
 * Manages the desktop toolbar button and mobile drawer entry.
 * Handles button states: idle, loading (spinner), active (pulsing).
 * Listens to FaceTracker lifecycle events for automatic UI updates.
 *
 * VR mode: button is disabled with a tooltip explaining why.
 *
 * @module FaceTrackButton
 */
(function () {
    'use strict';

    function init() {
        const desktopBtn = document.getElementById('face-track-btn');
        const drawerBtn = document.getElementById('drawer-face-track-btn');

        if (!desktopBtn && !drawerBtn) return;

        // ── Button state management ─────────────────────────────────

        function _updateUI(state) {
            // state: 'idle' | 'loading' | 'active' | 'face-lost' | 'error'
            const isActive = state === 'active';
            const isFaceLost = state === 'face-lost';
            const isLoading = state === 'loading';
            const label = isActive
                ? 'Stop Face Tracking'
                : isFaceLost
                  ? 'Face Lost — Click to Stop'
                  : isLoading
                    ? 'Starting camera...'
                    : 'Face Tracking';
            const color = isActive
                ? 'var(--primary, #00e5ff)'
                : isFaceLost
                  ? 'var(--accent-orange, #ff9100)'
                  : isLoading
                    ? 'var(--accent-orange, #ff9100)'
                    : '';

            [desktopBtn, drawerBtn].forEach((btn) => {
                if (!btn) return;
                btn.title = label;
                btn.setAttribute('aria-label', label);
                btn.style.color = color;
                btn.style.borderColor = isActive ? color : '';
                btn.disabled = isLoading;
                btn.style.opacity = isLoading ? '0.6' : '';

                const svg = btn.querySelector('svg');
                if (svg) {
                    svg.style.animation = isActive
                        ? 'facetrack-pulse 1.5s ease-in-out infinite'
                        : isFaceLost
                          ? 'facetrack-pulse 0.6s ease-in-out infinite'
                          : isLoading
                            ? 'facetrack-spin 1s linear infinite'
                            : 'none';
                }
            });

            const drawerSpan = drawerBtn?.querySelector('span');
            if (drawerSpan) drawerSpan.textContent = label;
        }

        // ── Toggle handler ──────────────────────────────────────────

        async function _toggle() {
            const ft = window.NEXUS_FACE_TRACKER;
            if (!ft) {
                console.warn('[FaceTrackButton] NEXUS_FACE_TRACKER not loaded');
                return;
            }

            if (ft.isActive) {
                ft.stop();
            } else {
                _updateUI('loading');
                try {
                    await ft.start();
                } catch (err) {
                    _updateUI('error');
                    // Show toast if available
                    if (err.name === 'NotAllowedError') {
                        _showToast('Camera permission denied. Please allow camera access.');
                    } else if (err.name === 'NotFoundError') {
                        _showToast('No camera found on this device.');
                    } else {
                        _showToast('Face tracking failed: ' + (err.message || 'Unknown error'));
                    }
                    // Reset to idle after brief error display
                    setTimeout(() => _updateUI('idle'), 2000);
                    return;
                }
            }
        }

        desktopBtn?.addEventListener('click', _toggle);
        drawerBtn?.addEventListener('click', () => {
            // Close mobile drawer first
            const overlay = document.getElementById('mobile-drawer-overlay');
            const drawer = document.getElementById('mobile-drawer');
            if (overlay) overlay.classList.remove('active');
            if (drawer) drawer.classList.remove('active');
            _toggle();
        });

        // ── Lifecycle event listeners ───────────────────────────────

        window.addEventListener('facetracker-started', () => _updateUI('active'));
        window.addEventListener('facetracker-stopped', () => _updateUI('idle'));
        window.addEventListener('facetracker-error', () => _updateUI('idle'));

        // Face lost/found — warn user with orange pulse when face is not detected
        window.addEventListener('facetracker-face-lost', () => {
            _updateUI('face-lost');
            _showToast('Face not detected — move closer to the camera');
        });
        window.addEventListener('facetracker-face-found', () => {
            // Only restore active UI if tracking is still running
            if (window.NEXUS_FACE_TRACKER?.isActive) {
                _updateUI('active');
            }
        });
        window.addEventListener('facetracker-auto-stopped', (e) => {
            _updateUI('idle');
            _showToast('Face tracking stopped — face not detected for too long');
        });

        // Disable in VR
        window.addEventListener('vr-session-start', () => {
            [desktopBtn, drawerBtn].forEach((btn) => {
                if (!btn) return;
                btn.disabled = true;
                btn.title = 'Face tracking not available in VR';
                btn.style.opacity = '0.3';
            });
        });
        window.addEventListener('vr-session-end', () => {
            [desktopBtn, drawerBtn].forEach((btn) => {
                if (!btn) return;
                btn.disabled = false;
                btn.title = 'Face Tracking';
                btn.style.opacity = '';
            });
        });

        // ── Inject CSS animations ───────────────────────────────────

        if (!document.getElementById('facetrack-btn-style')) {
            const style = document.createElement('style');
            style.id = 'facetrack-btn-style';
            style.textContent = `
                @keyframes facetrack-pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.4; }
                }
                @keyframes facetrack-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        // ── Tracking Settings gear button wiring ──────────────────────
        const gearBtn = document.getElementById('tracking-settings-btn');
        const drawerGearBtn = document.getElementById('drawer-tracking-settings-btn');

        function _toggleSettingsPanel() {
            const panel = window.NEXUS_TRACKING_PANEL;
            if (panel) panel.toggle();
        }

        if (gearBtn) {
            gearBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                _toggleSettingsPanel();
            });
        }
        if (drawerGearBtn) {
            drawerGearBtn.addEventListener('click', function () {
                // Close mobile drawer first
                const overlay = document.getElementById('mobile-drawer-overlay');
                const drawer = document.getElementById('mobile-drawer');
                if (overlay) overlay.classList.remove('active');
                if (drawer) drawer.classList.remove('active');
                _toggleSettingsPanel();
            });
        }

        console.log('[FaceTrackButton] Wired');
    }

    // ── Toast helper ────────────────────────────────────────────────

    function _showToast(message) {
        // Use existing toast system if available, otherwise create temporary one
        if (window.NEXUS_TOAST?.show) {
            window.NEXUS_TOAST.show(message);
            return;
        }

        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.85);
            color: #fff;
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 0.85rem;
            z-index: 10000;
            backdrop-filter: blur(8px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            animation: fadeIn 0.3s ease-out;
            pointer-events: none;
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // ── Auto-init ───────────────────────────────────────────────────

    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init, { once: true });
    }
})();
