/**
 * Eyes closed (batch T7).
 *
 * Something is playing and nobody has typed for a while. That is a different situation from
 * "somebody is having a conversation", and the interface should stop behaving as though it is
 * still the second one — a composer, a status line and a launcher button are furniture for
 * typing, and there is no typing happening.
 *
 * So after a quiet interval the page **settles**: one class on the root element, and CSS does
 * the rest. Anything at all — a key, a tap, a new message, the media stopping — wakes it
 * immediately.
 *
 * ## Why it publishes a state instead of moving things
 *
 * This module sets `data-nexus-ambient="on"` and dispatches an event. It does not hide the
 * composer itself, does not touch the avatar, and does not reach into the motion system. Every
 * one of those has an owner already, and a second thing quietly restyling them is how two
 * features end up fighting over the same element at 3am.
 *
 * The one thing it will never quiet is the recording indicator. §2a is not negotiable: if
 * something is being captured, that badge is visible, and a "cinema mode" that dimmed it would
 * be the most dangerous possible use of a dimmer.
 *
 * ## Waking
 *
 * Any of: a keystroke, a pointer down, a scroll, a new chat message, the media ending, or
 * Together being switched off. Deliberately generous — the cost of waking when somebody did not
 * mean it is one frame of chrome reappearing, and the cost of *not* waking is somebody tapping
 * a composer that is not listening.
 *
 * A wake also **disarms for the current media**: settling once is atmosphere, settling again
 * thirty seconds after somebody deliberately woke it is the interface arguing with them. The
 * next thing that plays arms it again.
 *
 * ## Off unless asked for
 *
 * This is a preference for people who want the app to get out of the way — not a default and
 * not an improvement everybody is assumed to want. Plenty of people put something on precisely
 * so they can keep typing over the top of it, and for them a fading interface is a fault.
 *
 * So it is **opt-in, and it stays opt-in**. Unlike the Together switch itself — which turns on
 * the first time somebody taps a tile, because tapping the tile *is* the request — nothing a
 * user does implies "and also dim the interface at me". An app that quietly faded its own
 * chrome twenty-five seconds into a song would read as a fault long before it read as a
 * feature, and the person it happened to would have no idea what they had done to cause it or
 * what to search for to stop it.
 *
 * So the default is off, `arm()` is a no-op until the box in Settings is ticked, and the
 * storage key is only ever written by that box. A profile that never opens Settings never sees
 * this, the stylesheet is never injected, and the page is the one T6 shipped — which is the
 * property a test asserts directly rather than leaving to inspection.
 *
 * Exposes: window.NEXUS_AMBIENT
 */
(function (global) {
    'use strict';

    /** How long the page must be untouched before it settles. */
    const QUIET_MS = 25000;

    /** The attribute CSS hangs off, on the root element. */
    const ATTR = 'data-nexus-ambient';

    /** Events that count as somebody being here. */
    const WAKE_EVENTS = ['keydown', 'pointerdown', 'wheel', 'touchstart'];

    /** The stylesheet's own element, so injecting twice is a no-op. */
    const STYLE_ID = 'nexus-bd-ambient-style';

    /** Where the Settings box keeps the answer. Absent means off. */
    const KEY = 'nexus_ambient_enabled';

    /**
     * A last-resort copy, for a browser that has storage switched off.
     *
     * `null` means "ask storage". A page in a private window with cookies blocked can still
     * turn this on for the session, and simply will not remember next time — which is a better
     * failure than a control that silently does nothing.
     */
    let memory = null;

    /** Is the user asking for this? Off unless they said otherwise, every time. */
    function isEnabled() {
        try {
            const raw = global && global.localStorage ? global.localStorage.getItem(KEY) : null;
            if (raw === 'true') {
                return true;
            }
            if (raw === 'false') {
                return false;
            }
        } catch (_) {
            /* storage disabled: the in-memory answer below, and otherwise off */
        }
        return memory === true;
    }

    /**
     * Turn it on or off. Called by the Settings box and by nothing else — in particular, not
     * by the launcher, not by a tile, and not by anything that plays media. The Together
     * switch enables itself on first use because using it is the request; this cannot make
     * the same argument.
     */
    function setEnabled(on) {
        const value = Boolean(on);
        memory = value;
        try {
            if (global && global.localStorage) {
                global.localStorage.setItem(KEY, value ? 'true' : 'false');
            }
        } catch (_) {
            /* the in-memory copy above is the fallback */
        }
        if (!value) {
            wake('disabled');
        } else if (armed) {
            injectStyle(doc());
            disarmedForThisMedia = false;
            schedule();
        }
        return value;
    }

    /**
     * What settling looks like.
     *
     * Every rule here is one property — opacity — on chrome that exists for typing. Nothing
     * moves, nothing is removed from the layout, and nothing has its `pointer-events` taken
     * away: a dimmed composer is still a composer, and the tap that reaches for it wakes the
     * page on `pointerdown` before the `click` lands, so the control the finger arrives at is
     * already at full strength. Hiding it instead would mean a first tap that does nothing,
     * which is the failure this feature is supposed to be the opposite of.
     *
     * The transition is declared *inside* the settled rule rather than on the elements
     * themselves. That is deliberate and it is not a shortcut: it means the fade happens on
     * the way down and never on the way back, so waking is instant. It also means that with
     * the attribute absent — which is every millisecond of every session where this never
     * fires — these selectors contribute nothing at all.
     *
     * The recording indicator is exempt, loudly. §2a says that if something is being
     * captured the badge is visible, and a dimmer that reached it would be the single most
     * dangerous thing in this file. It is `!important` and it is asserted by a test.
     */
    const CSS = `
:root[${ATTR}='on'] .topbar,
:root[${ATTR}='on'] .chat-card-header,
:root[${ATTR}='on'] .avatar-footer,
:root[${ATTR}='on'] .voice-status-inline,
:root[${ATTR}='on'] #nexus-bd-together-launcher {
    opacity: 0.28;
    transition: opacity 1200ms ease;
}
:root[${ATTR}='on'] .chat-history {
    opacity: 0.55;
    transition: opacity 1200ms ease;
}
:root[${ATTR}='on'] .chat-input-shell {
    opacity: 0.42;
    transition: opacity 1200ms ease;
}
/* §2a. Never, under any state, for any reason. */
:root[${ATTR}='on'] #nexus-bd-consent-indicator,
:root[${ATTR}='on'] #nexus-bd-consent-indicator * {
    opacity: 1 !important;
}
/* An open panel means somebody is mid-decision; it is never part of the quiet. */
:root[${ATTR}='on'] #nexus-bd-together-panel {
    opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
    :root[${ATTR}='on'] .topbar,
    :root[${ATTR}='on'] .chat-card-header,
    :root[${ATTR}='on'] .avatar-footer,
    :root[${ATTR}='on'] .voice-status-inline,
    :root[${ATTR}='on'] .chat-history,
    :root[${ATTR}='on'] .chat-input-shell,
    :root[${ATTR}='on'] #nexus-bd-together-launcher {
        transition: none;
    }
}
`;

    /** Put the stylesheet in the page. Idempotent, and never a reason to fail. */
    function injectStyle(d) {
        if (!d || !d.head || typeof d.createElement !== 'function') {
            return null;
        }
        if (d.getElementById && d.getElementById(STYLE_ID)) {
            return d.getElementById(STYLE_ID);
        }
        try {
            const style = d.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            d.head.appendChild(style);
            return style;
        } catch (_) {
            return null;
        }
    }

    let armed = false;
    let settled = false;
    let disarmedForThisMedia = false;
    let timer = null;
    let bound = null;

    function doc() {
        return global && global.document ? global.document : null;
    }

    function media() {
        return global && global.NEXUS_CURRENT_MEDIA ? global.NEXUS_CURRENT_MEDIA : null;
    }

    function togetherOn() {
        const sw = global && global.NEXUS_TOGETHER_SWITCH ? global.NEXUS_TOGETHER_SWITCH : null;
        return !sw || typeof sw.isOn !== 'function' || sw.isOn();
    }

    function playing() {
        const m = media();
        if (!m || typeof m.get !== 'function') {
            return false;
        }
        try {
            return Boolean(m.get());
        } catch (_) {
            return false;
        }
    }

    function emit(name, detail) {
        const d = doc();
        if (!d || typeof d.dispatchEvent !== 'function' || typeof global.CustomEvent !== 'function') {
            return;
        }
        try {
            d.dispatchEvent(new global.CustomEvent(name, { detail }));
        } catch (_) {
            /* an event nobody can hear is not worth throwing over */
        }
    }

    /** Settle. Only ever called from the timer, and only while the conditions still hold. */
    function settle() {
        if (settled || !armed || !isEnabled() || !togetherOn() || !playing()) {
            return false;
        }
        const d = doc();
        if (!d || !d.documentElement) {
            return false;
        }
        settled = true;
        d.documentElement.setAttribute(ATTR, 'on');
        emit('nexus:ambient', { state: 'on' });
        return true;
    }

    /**
     * Wake, and stay awake for this media.
     *
     * `reason` is carried in the event so a listener can tell "they touched something" from
     * "the music ended" — the first should restore the chrome, the second usually means the
     * whole state is about to go away anyway.
     */
    function wake(reason) {
        clearTimer();
        const wasSettled = settled;
        settled = false;
        const d = doc();
        if (d && d.documentElement) {
            d.documentElement.removeAttribute(ATTR);
        }
        if (reason !== 'media-stopped' && reason !== 'together-off') {
            // Somebody deliberately came back. Settling on them again in another twenty-five
            // seconds is the interface arguing with them, so this media gets no second attempt.
            disarmedForThisMedia = true;
        }
        if (wasSettled) {
            emit('nexus:ambient', { state: 'off', reason: String(reason || 'unknown') });
        }
        return wasSettled;
    }

    function clearTimer() {
        if (timer !== null && global && typeof global.clearTimeout === 'function') {
            global.clearTimeout(timer);
        }
        timer = null;
    }

    /** Start the clock, if there is anything to settle into. */
    function schedule() {
        clearTimer();
        if (!armed || disarmedForThisMedia || settled || !isEnabled() || !togetherOn() || !playing()) {
            return false;
        }
        if (!global || typeof global.setTimeout !== 'function') {
            return false;
        }
        timer = global.setTimeout(settle, QUIET_MS);
        return true;
    }

    /** Something started playing: a fresh chance to settle. */
    function mediaChanged() {
        if (!playing()) {
            wake('media-stopped');
            disarmedForThisMedia = false;
            return;
        }
        disarmedForThisMedia = false;
        wake('media-changed');
        disarmedForThisMedia = false;
        schedule();
    }

    /** Begin watching. Returns a stop function; safe to call twice. */
    function arm({ doc: d0, win } = {}) {
        const w = win || global;
        const d = d0 || (w && w.document) || null;
        if (!d || !w || bound) {
            return bound ? bound.stop : () => {};
        }

        armed = true;
        // Off means nothing in the page at all — no stylesheet, no attribute, no selectors
        // for the engine to match. `setEnabled(true)` puts it in later if the box is ticked
        // while the launcher is mounted.
        if (isEnabled()) {
            injectStyle(d);
        }
        const onActivity = () => {
            if (settled) {
                wake('activity');
                return;
            }
            schedule();
        };
        const listeners = [];
        for (const name of WAKE_EVENTS) {
            d.addEventListener(name, onActivity, { passive: true, capture: true });
            listeners.push([d, name, onActivity]);
        }
        const onMedia = () => mediaChanged();
        d.addEventListener('nexus:media', onMedia);
        listeners.push([d, 'nexus:media', onMedia]);

        // Together going off has to wake the page: settled chrome around a feature that no
        // longer exists is furniture nobody can explain.
        function onSwitch(state) {
            if (state !== 'on') {
                wake('together-off');
                return;
            }
            schedule();
        }
        const sw = w.NEXUS_TOGETHER_SWITCH;
        const stopSwitch = sw && typeof sw.onChange === 'function' ? sw.onChange(onSwitch) : null;

        schedule();

        bound = {
            stop() {
                clearTimer();
                for (const [target, name, fn] of listeners) {
                    try {
                        target.removeEventListener(name, fn, true);
                        target.removeEventListener(name, fn);
                    } catch (_) {
                        /* a detached document is not an error */
                    }
                }
                if (stopSwitch) {
                    stopSwitch();
                }
                const style = d.getElementById ? d.getElementById(STYLE_ID) : null;
                if (style && style.parentNode) {
                    style.parentNode.removeChild(style);
                }
                wake('disarmed');
                armed = false;
                disarmedForThisMedia = false;
                bound = null;
            },
        };
        return bound.stop;
    }

    function isSettled() {
        return settled;
    }

    /** For tests, and for a page that wants a clean slate. */
    function reset() {
        clearTimer();
        memory = null;
        settled = false;
        armed = false;
        disarmedForThisMedia = false;
        if (bound) {
            const stop = bound.stop;
            bound = null;
            try {
                stop();
            } catch (_) {
                /* already gone */
            }
        }
        const d = doc();
        if (d && d.documentElement) {
            d.documentElement.removeAttribute(ATTR);
        }
    }

    const api = {
        QUIET_MS,
        ATTR,
        STYLE_ID,
        CSS,
        KEY,
        WAKE_EVENTS,
        isEnabled,
        setEnabled,
        injectStyle,
        arm,
        settle,
        wake,
        schedule,
        mediaChanged,
        isSettled,
        reset,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_AMBIENT = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
