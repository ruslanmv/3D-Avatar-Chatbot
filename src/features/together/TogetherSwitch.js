/**
 * One switch for the whole of Together (batch T1).
 *
 * Together is seven activities, a launcher, a media picker, a publisher and a prompt suffix.
 * Asking somebody to turn those on one at a time would be seven decisions to make before
 * anything works, about features they have not seen yet. So there is one switch, and it has
 * three states rather than two — because "never touched" and "deliberately off" are different
 * facts and collapsing them loses the one that matters.
 *
 * | stored  | launcher | capabilities | how you get here                    |
 * |---------|----------|--------------|-------------------------------------|
 * | `null`  | visible  | off          | a fresh profile                     |
 * | `'on'`  | visible  | on           | tapped any tile, or Settings        |
 * | `'off'` | hidden   | off          | turned it off in Settings           |
 *
 * **Using it is how you turn it on.** Tapping any tile calls `enable('tile')` — once, silently,
 * with no modal and no first-run tour. A person who has just pressed Music has answered the
 * question more clearly than any dialog could ask it, and interrupting them at that moment to
 * ask whether they meant it is the kind of friction that makes a good feature feel like
 * paperwork.
 *
 * **`null` is not `'on'`.** A fresh profile shows the launcher but keeps the capabilities off,
 * so nothing is added to the model's prompt and nothing plays from conversation until somebody
 * has actually used Together once. That is the difference between a feature that arrives when
 * you reach for it and one that arrives uninvited.
 *
 * **`'off'` means off everywhere.** Hiding the launcher while leaving the prompt suffix in place
 * would leave her offering to play music that nothing will play — worse than no switch at all,
 * because the failure is invisible until somebody takes her up on it.
 *
 * Exposes: window.NEXUS_TOGETHER_SWITCH
 */
(function (global) {
    'use strict';

    const KEY = 'nexus_together_enabled';
    const ON = 'on';
    const OFF = 'off';

    /** Listeners, so the launcher and Settings never disagree about the state. */
    const listeners = new Set();

    function storage() {
        try {
            return global && global.localStorage ? global.localStorage : null;
        } catch (_) {
            // Private mode, an embedded webview, a browser with site data blocked.
            return null;
        }
    }

    /** `'on'`, `'off'`, or `null` for a profile that has never touched it. */
    function state() {
        const store = storage();
        if (!store) {
            // No storage means no stored opt-out to honour, and no way to remember an opt-in
            // either. Treating that as a fresh profile is the honest reading: the launcher
            // shows, and using it works for as long as the page is open.
            return _memory;
        }
        try {
            const raw = store.getItem(KEY);
            return raw === ON || raw === OFF ? raw : null;
        } catch (_) {
            return _memory;
        }
    }

    /** Fallback when storage cannot be read or written. Lives for the life of the page. */
    let _memory = null;

    function write(value) {
        _memory = value;
        const store = storage();
        if (store) {
            try {
                store.setItem(KEY, value);
            } catch (_) {
                // Quota, or a browser refusing to persist. The in-memory value still applies,
                // which is the difference between "works until you reload" and "does not work".
            }
        }
        for (const listener of Array.from(listeners)) {
            try {
                listener(value);
            } catch (_) {
                // One bad listener must not stop the others being told.
            }
        }
        return value;
    }

    /** Whether Together's capabilities are live: the prompt suffix, and playing from chat. */
    function isOn() {
        return state() === ON;
    }

    /** Whether the launcher should be on screen. True until somebody says otherwise. */
    function isVisible() {
        return state() !== OFF;
    }

    /**
     * Turn everything on. Idempotent, so the tile handler can call it on every tap without
     * caring whether it is the first.
     *
     * `reason` is recorded rather than acted on — `tile`, `settings`, `restored`. It exists so
     * that "the user chose this" and "something turned it on for them" stay distinguishable in
     * a log, which is the question anybody debugging an unexpected state will ask first.
     */
    function enable(reason) {
        if (state() === ON) {
            return false;
        }
        write(ON);
        _reason = String(reason || 'unknown');
        return true;
    }

    function disable(reason) {
        if (state() === OFF) {
            return false;
        }
        write(OFF);
        _reason = String(reason || 'unknown');
        return true;
    }

    let _reason = '';

    function lastReason() {
        return _reason;
    }

    /** Subscribe. Returns an unsubscribe, and never fires for a write that changed nothing. */
    function onChange(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    /** For tests, and for a Settings panel that wants to start from a known state. */
    function reset() {
        _memory = null;
        _reason = '';
        const store = storage();
        if (store) {
            try {
                store.removeItem(KEY);
            } catch (_) {
                /* nothing to undo */
            }
        }
    }

    const api = { KEY, ON, OFF, state, isOn, isVisible, enable, disable, onChange, lastReason, reset };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_TOGETHER_SWITCH = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
