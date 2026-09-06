/**
 * How much of the bottom of the screen the chat composer already owns.
 *
 * The Together sheet is `position: fixed; bottom: 0` on a phone, and the chat composer is
 * pinned to the bottom of the same screen. Measured on a 412×915 viewport, the sheet's bottom
 * edge sat at 915 and the composer's top edge at 839: **76 pixels of the sheet were underneath
 * the composer**, which is where Music's "Open an audio file" button lives. The sheet was not
 * even scrolling — its content fitted — so nothing about the panel said anything was wrong. It
 * simply could not be tapped.
 *
 * ## Why this is measured rather than written down
 *
 * The composer is not a fixed height. Collapsed it is one bar; expanded the chat overlay is most
 * of the screen; with the keyboard up the visual viewport shrinks under it; and iOS moves the
 * whole thing as its browser chrome comes and goes. A constant in a stylesheet would be correct
 * in exactly one of those states and quietly wrong in the rest — which is the same class of bug
 * as `bottom: 0`, just harder to see.
 *
 * So this measures the distance from the top of the composer to the bottom of the viewport and
 * publishes it as `--nexus-composer-inset` on the root element. Everything from the composer's
 * top edge down is reserved, which folds in the safe-area padding the composer already carries
 * and anything else sitting below it — no second guess about `env(safe-area-inset-bottom)`, and
 * no double counting it either.
 *
 * ## What it does not do
 *
 * It does not move, resize, restyle or reparent the composer. The composer stays exactly where
 * it is; this only writes down how much room it takes, so a panel can stay out of its way. And
 * it never throws: on a desktop layout, before the composer exists, or in a document without
 * `ResizeObserver`, it clears the property and the consuming CSS falls back to a static default.
 */
(function (global) {
    'use strict';

    /** The property every Together surface reserves space with. */
    const VAR = '--nexus-composer-inset';

    /**
     * The composer, in preference order. `.chat-input-shell` is the bar itself; the overlay is
     * the fallback for a layout where the shell is nested inside something taller that is the
     * real bottom furniture.
     */
    const SELECTORS = ['.chat-input-shell', '.chat-overlay--collapsed', '.chat-panel'];

    /**
     * Below this the sheet is a floating card next to the avatar, not a bottom sheet, and there
     * is nothing to reserve. Matches the launcher's own breakpoint — one number, one meaning.
     */
    const MOBILE_MAX = 640;

    function viewportHeight(win) {
        // `visualViewport` is what shrinks when the keyboard opens; `innerHeight` does not on
        // Android Chrome. Using the visual viewport is what keeps the reservation right with a
        // keyboard up, which is half of what this module is for.
        const visual = win.visualViewport;
        if (visual && Number.isFinite(visual.height) && visual.height > 0) {
            return visual.height + (Number.isFinite(visual.offsetTop) ? visual.offsetTop : 0);
        }
        return win.innerHeight || 0;
    }

    /** The tallest bottom-anchored candidate, in CSS pixels, or 0 when there is nothing to avoid. */
    function measure(doc, win) {
        const height = viewportHeight(win);
        if (!height) return 0;

        let inset = 0;
        for (const selector of SELECTORS) {
            let element = null;
            try {
                element = doc.querySelector(selector);
            } catch (_) {
                element = null;
            }
            if (!element || typeof element.getBoundingClientRect !== 'function') continue;

            const rect = element.getBoundingClientRect();
            if (!rect || !rect.height) continue;

            // Only something actually sitting at the bottom of the screen is in the way. An
            // element scrolled off, or one that ends well above the fold, is not.
            if (rect.bottom < height - 4) continue;

            inset = Math.max(inset, Math.round(height - rect.top));
        }
        // A reservation taller than the screen would leave the sheet with no height at all;
        // better a cramped panel than an invisible one.
        return Math.max(0, Math.min(inset, Math.round(height * 0.75)));
    }

    function apply(doc, win) {
        const root = doc.documentElement;
        if (!root || !root.style) return 0;

        const width = win.innerWidth || 0;
        if (width > MOBILE_MAX) {
            // Desktop: the panel is a floating card and reserves nothing. Removing rather than
            // zeroing lets the CSS fallback apply if this ever runs on a narrow desktop window.
            root.style.removeProperty(VAR);
            return 0;
        }

        // Always set it on a phone, `0px` included. "Measured, and there is no composer" and
        // "JS has not run yet" are different situations that want different answers, and leaving
        // the property unset in the first case would hand the sheet the static fallback — an
        // 88-pixel gap reserved for a bar that is not there.
        const inset = measure(doc, win);
        root.style.setProperty(VAR, `${inset}px`);
        return inset;
    }

    /**
     * Start watching. Returns a `stop()` — idempotent, and safe to call on a document that never
     * had a composer.
     */
    function watch({ doc, win } = {}) {
        const document_ = doc || (typeof document !== 'undefined' ? document : null);
        const window_ = win || (typeof window !== 'undefined' ? window : null);
        if (!document_ || !window_ || !document_.documentElement) return function stop() {};

        let stopped = false;
        const update = () => {
            if (stopped) return 0;
            try {
                return apply(document_, window_);
            } catch (_) {
                return 0;
            }
        };

        update();

        const listeners = [];
        const on = (target, event) => {
            if (!target || typeof target.addEventListener !== 'function') return;
            target.addEventListener(event, update, { passive: true });
            listeners.push([target, event]);
        };
        on(window_, 'resize');
        on(window_, 'orientationchange');
        // The keyboard: the visual viewport resizes and scrolls where `window` does neither.
        on(window_.visualViewport, 'resize');
        on(window_.visualViewport, 'scroll');

        let observer = null;
        if (typeof window_.ResizeObserver === 'function') {
            try {
                observer = new window_.ResizeObserver(update);
                for (const selector of SELECTORS) {
                    const element = document_.querySelector(selector);
                    if (element) observer.observe(element);
                }
            } catch (_) {
                observer = null;
            }
        }

        return function stop() {
            if (stopped) return;
            stopped = true;
            for (const [target, event] of listeners) {
                try {
                    target.removeEventListener(event, update);
                } catch (_) {
                    /* a detached window is not an error worth raising */
                }
            }
            if (observer) {
                try {
                    observer.disconnect();
                } catch (_) {
                    /* same */
                }
            }
        };
    }

    const api = { VAR, SELECTORS, MOBILE_MAX, measure, apply, watch, viewportHeight };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_COMPOSER_INSET = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
