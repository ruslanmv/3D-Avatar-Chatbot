'use strict';

/**
 * MobileDrawerWiring — Connects the mobile drawer navigation buttons
 * to the actual app functionality (settings, info, VR/AR, fullscreen, etc.)
 *
 * Non-destructive: purely additive. Requires drawer HTML already in DOM.
 */
(function () {
    function $(id) {
        return document.getElementById(id);
    }

    function closeDrawer() {
        var drawer = $('mobile-drawer');
        var overlay = $('mobile-drawer-overlay');
        if (drawer) drawer.classList.remove('open');
        if (overlay) overlay.classList.remove('open');
    }

    function openDrawer() {
        var drawer = $('mobile-drawer');
        var overlay = $('mobile-drawer-overlay');
        if (drawer) drawer.classList.add('open');
        if (overlay) overlay.classList.add('open');
    }

    function showModal(id) {
        var modal = $(id);
        if (!modal) return;
        modal.classList.add('active');
        modal.hidden = false;
    }

    function init() {
        // ── Hamburger menu toggle ──
        var menuBtn = $('mobile-menu-btn');
        if (menuBtn) {
            menuBtn.addEventListener('click', openDrawer);
        }

        // ── Close drawer ──
        var closeBtn = $('mobile-drawer-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeDrawer);
        }

        var overlay = $('mobile-drawer-overlay');
        if (overlay) {
            overlay.addEventListener('click', closeDrawer);
        }

        // ── Settings ──
        var drawerSettings = $('drawer-settings-btn');
        if (drawerSettings) {
            drawerSettings.addEventListener('click', function () {
                closeDrawer();
                showModal('settings-modal');
            });
        }

        // ── Info / About ──
        var drawerInfo = $('drawer-info-btn');
        if (drawerInfo) {
            drawerInfo.addEventListener('click', function () {
                closeDrawer();
                showModal('info-modal');
            });
        }

        // ── Upload avatar ──
        var drawerUpload = $('drawer-upload-btn');
        if (drawerUpload) {
            drawerUpload.addEventListener('click', function () {
                closeDrawer();
                var fileInput = $('avatar-upload');
                if (fileInput) fileInput.click();
            });
        }

        // ── Voice & Speech → open Settings with speech section visible ──
        var drawerVoice = $('drawer-voice-btn');
        if (drawerVoice) {
            drawerVoice.addEventListener('click', function () {
                closeDrawer();
                showModal('settings-modal');
                // Scroll to speech section after modal opens
                setTimeout(function () {
                    var speechSection = document.querySelector('#speech-lang');
                    if (speechSection) {
                        speechSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 200);
            });
        }

        // ── VR / AR Mode ──
        var drawerVR = $('drawer-vr-btn');
        if (drawerVR) {
            drawerVR.addEventListener('click', function () {
                closeDrawer();
                // Try to click the AR button first (more useful on mobile)
                var arBtn = $('ar-button');
                if (arBtn && !arBtn.classList.contains('xr-btn--disabled')) {
                    arBtn.click();
                    return;
                }
                // Fallback to VR button
                var vrBtn = document.querySelector('.xr-btn--vr');
                if (vrBtn && !vrBtn.classList.contains('xr-btn--disabled')) {
                    vrBtn.click();
                    return;
                }
                alert('AR/VR is not supported on this device or browser.');
            });
        }

        // ── Fullscreen ──
        var drawerFullscreen = $('drawer-fullscreen-btn');
        if (drawerFullscreen) {
            drawerFullscreen.addEventListener('click', function () {
                closeDrawer();
                if (document.fullscreenElement) {
                    document.exitFullscreen().catch(function () {});
                } else {
                    document.documentElement.requestFullscreen().catch(function () {});
                }
            });
        }

        // ── Clear Chat ──
        var drawerClear = $('drawer-clear-btn');
        if (drawerClear) {
            drawerClear.addEventListener('click', function () {
                closeDrawer();
                var clearBtn = $('clear-history');
                if (clearBtn) clearBtn.click();
            });
        }

        // ── Pose Studio (add to drawer) ──
        var drawerPoseStudio = $('drawer-pose-studio-btn');
        if (drawerPoseStudio) {
            drawerPoseStudio.addEventListener('click', function () {
                closeDrawer();
                var poseBtn = $('openPoseStudioBtn');
                if (poseBtn) poseBtn.click();
            });
        }

        // ── Expose for external use ──
        window.NEXUS_MOBILE_DRAWER = {
            open: openDrawer,
            close: closeDrawer,
        };

        console.log('[MobileDrawerWiring] Drawer buttons connected');
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
