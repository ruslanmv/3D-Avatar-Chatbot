'use strict';

/**
 * ARCoachingOverlay — Google-style AR onboarding with animated coaching UI.
 *
 * Follows Google's recommended AR onboarding flow:
 *   [Animated phone scanning] → [Surface highlight pulse] → [Shadow preview] → [Model placed with bounce]
 *
 * Purely additive — listens to existing CustomEvents dispatched by ARSupport.js:
 *   - 'ar-session-start'   → show coaching animation (SCANNING)
 *   - 'ar-floor-detected'  → surface found, transition to PLACING then PLACED
 *   - 'ar-session-end'     → reset to IDLE
 *
 * Does NOT modify any existing module.
 */
(function () {
    /* ── States ── */
    var IDLE = 'idle';
    var SCANNING = 'scanning';
    var SURFACE_FOUND = 'surface-found';
    var PLACING = 'placing';
    var PLACED = 'placed';

    /* ── Config ── */
    var SURFACE_FOUND_DELAY = 800; // ms before transitioning to PLACING
    var PLACING_DELAY = 600; // ms before transitioning to PLACED
    var BOUNCE_DURATION = 500; // ms for avatar bounce-in

    /* ── State ── */
    var state = IDLE;
    var coachingEl = null;
    var timers = [];

    /* ── SVG Coaching Illustration ── */
    var PHONE_SVG =
        '<svg class="ar-coaching__phone-svg" viewBox="0 0 120 160" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        /* Phone body */
        '<rect x="30" y="10" width="60" height="110" rx="10" stroke="rgba(255,255,255,0.8)" stroke-width="2.5" fill="rgba(0,0,0,0.2)"/>' +
        /* Screen */
        '<rect x="36" y="22" width="48" height="80" rx="4" fill="rgba(0,229,255,0.15)" stroke="rgba(0,229,255,0.3)" stroke-width="1"/>' +
        /* Camera dot */
        '<circle cx="60" cy="16" r="2" fill="rgba(255,255,255,0.5)"/>' +
        /* Home button hint */
        '<rect x="52" y="108" width="16" height="3" rx="1.5" fill="rgba(255,255,255,0.3)"/>' +
        /* Scanning lines (animated via CSS) */
        '<line class="ar-coaching__scan-line" x1="40" y1="45" x2="80" y2="45" stroke="rgba(0,229,255,0.6)" stroke-width="1.5" stroke-dasharray="4 3"/>' +
        '<line class="ar-coaching__scan-line ar-coaching__scan-line--2" x1="40" y1="60" x2="80" y2="60" stroke="rgba(0,229,255,0.4)" stroke-width="1.5" stroke-dasharray="4 3"/>' +
        '<line class="ar-coaching__scan-line ar-coaching__scan-line--3" x1="40" y1="75" x2="80" y2="75" stroke="rgba(0,229,255,0.3)" stroke-width="1.5" stroke-dasharray="4 3"/>' +
        /* Downward arrows */
        '<path class="ar-coaching__arrow" d="M60 125 L60 148 M52 140 L60 148 L68 140" stroke="rgba(0,229,255,0.7)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        /* Motion dots (animated) */
        '<circle class="ar-coaching__dot ar-coaching__dot--1" cx="20" cy="80" r="3" fill="rgba(0,229,255,0.5)"/>' +
        '<circle class="ar-coaching__dot ar-coaching__dot--2" cx="100" cy="60" r="3" fill="rgba(0,229,255,0.5)"/>' +
        '<circle class="ar-coaching__dot ar-coaching__dot--3" cx="25" cy="45" r="2.5" fill="rgba(0,229,255,0.35)"/>' +
        '</svg>';

    /* ── Helpers ── */
    function clearTimers() {
        for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
        timers = [];
    }

    function delay(fn, ms) {
        timers.push(setTimeout(fn, ms));
    }

    function getAvatarRoot() {
        /* Reach into the global viewer engine for the current avatar root */
        var ve = window.viewerEngine || window._viewerEngine;
        return ve && ve.avatarManager ? ve.avatarManager.currentRoot : null;
    }

    /* ── DOM Injection ── */
    function injectDOM(overlayEl) {
        coachingEl = document.createElement('div');
        coachingEl.id = 'ar-coaching';
        coachingEl.className = 'ar-coaching';
        coachingEl.innerHTML =
            '<div class="ar-coaching__illustration">' +
            PHONE_SVG +
            '<p class="ar-coaching__hint">Point your phone down<br>and move around slowly</p>' +
            '</div>' +
            '<div class="ar-coaching__pulse"></div>';

        /* Insert as first child so it layers behind the top/bottom bars */
        overlayEl.insertBefore(coachingEl, overlayEl.firstChild);
    }

    /* ── State Transitions ── */
    function transitionTo(newState) {
        if (state === newState) return;
        state = newState;

        if (!coachingEl) return;
        var overlay = coachingEl.parentElement;
        if (!overlay) return;

        /* Remove all state classes */
        overlay.classList.remove('ar-state-scanning', 'ar-state-surface-found', 'ar-state-placing', 'ar-state-placed');

        switch (newState) {
            case SCANNING:
                overlay.classList.add('ar-state-scanning');
                break;

            case SURFACE_FOUND:
                overlay.classList.add('ar-state-surface-found');
                delay(function () {
                    transitionTo(PLACING);
                }, SURFACE_FOUND_DELAY);
                break;

            case PLACING:
                overlay.classList.add('ar-state-placing');
                delay(function () {
                    transitionTo(PLACED);
                }, PLACING_DELAY);
                break;

            case PLACED:
                overlay.classList.add('ar-state-placed');
                startBounceAnimation();
                break;

            case IDLE:
                /* All classes already removed */
                break;
        }
    }

    /* ── Avatar Bounce-In Animation ── */
    function startBounceAnimation() {
        var root = getAvatarRoot();
        if (!root) return;

        var start = performance.now();
        var origScale = { x: root.scale.x, y: root.scale.y, z: root.scale.z };

        /* Start from 0 */
        root.scale.set(0.01, 0.01, 0.01);

        function animate(now) {
            var elapsed = now - start;
            var t = Math.min(elapsed / BOUNCE_DURATION, 1.0);

            /* Overshoot easing: cubic out with slight bounce */
            var s;
            if (t < 0.6) {
                /* Ease out to 1.1x (overshoot) */
                var t1 = t / 0.6;
                s = 1.1 * (1 - Math.pow(1 - t1, 3));
            } else {
                /* Settle from 1.1x to 1.0x */
                var t2 = (t - 0.6) / 0.4;
                s = 1.1 - 0.1 * t2;
            }

            root.scale.set(origScale.x * s, origScale.y * s, origScale.z * s);

            if (t < 1.0) {
                requestAnimationFrame(animate);
            } else {
                /* Ensure exact final scale */
                root.scale.set(origScale.x, origScale.y, origScale.z);
            }
        }

        requestAnimationFrame(animate);
    }

    /* ── Event Handlers ── */
    function onARSessionStart() {
        var overlayEl = document.getElementById('ar-dom-overlay');
        if (!overlayEl) return;

        /* Lazy-inject coaching DOM on first AR session */
        if (!coachingEl) {
            injectDOM(overlayEl);
        }

        clearTimers();
        transitionTo(SCANNING);
    }

    function onARFloorDetected() {
        clearTimers();
        transitionTo(SURFACE_FOUND);
    }

    function onARSessionEnd() {
        clearTimers();
        transitionTo(IDLE);
    }

    /* ── Init: wire up event listeners ── */
    window.addEventListener('ar-session-start', onARSessionStart);
    window.addEventListener('ar-floor-detected', onARFloorDetected);
    window.addEventListener('ar-session-end', onARSessionEnd);
})();
