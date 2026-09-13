/**
 * Permission to change where you are, and the preference that shapes it (batch A7).
 *
 * This switch decides one thing: whether the companion may alter what the user is looking at.
 * That is a bigger ask than anything else in Settings, so it is **off until somebody turns it
 * on** — unlike the Together switch, which turns itself on the first time you tap a tile because
 * tapping the tile *is* the request. Nothing a person says to a chatbot implies "and you may
 * redecorate".
 *
 * ## Two states, not three
 *
 * `TogetherSwitch` carries `null` / `'on'` / `'off'` because "never touched" and "deliberately
 * off" lead to different launcher behaviour there. Nothing here turns itself on, so those two
 * facts would produce identical behaviour, and a third state nobody can act on differently is
 * just somewhere for a bug to hide.
 *
 * ## What it does NOT gate
 *
 * The scenic backgrounds themselves. Those live in Settings → Viewport Background beside the five
 * colours and stay available whichever way this is set, which is why turning the switch off never
 * changes what is on screen. The mental model has to fit in one line:
 *
 *     Viewport Background = what I see.     Ambience = whether she may change it.
 *
 * Turning AI control off and having somebody's chosen backdrop go black would be a punishment for
 * revoking a permission.
 *
 * ## The preference is a nudge
 *
 * `'auto'` by default, and never a filter — the resolver adds it as a weight that cannot outrank
 * what somebody just asked for. Stored separately from the toggle because they answer different
 * questions, and a single packed value would mean reading the permission to find out the taste.
 *
 * Exposes: window.NEXUS_SCENE_AMBIENCE_SWITCH
 */
(function (global) {
    'use strict';

    const KEY = 'nexus_scene_ambience_enabled';
    const PREFERENCE_KEY = 'nexus_scene_ambience_preference';
    const ON = 'on';
    const OFF = 'off';

    /**
     * The dropdown values, in the order Settings shows them. Internal values only — the labels
     * live in the UI, so wording can change without touching a stored preference.
     */
    const PREFERENCES = Object.freeze([
        'auto',
        'relax',
        'nature',
        'ocean',
        'forest',
        'study',
        'cozy',
        'night',
        'fantasy',
    ]);
    const DEFAULT_PREFERENCE = 'auto';

    /** Listeners, so Settings and the capability never disagree about the state. */
    const listeners = new Set();

    /**
     * Fallback when storage cannot be read or written — a private window, an embedded webview, a
     * browser with site data blocked. Lives for the life of the page, which is the difference
     * between "works until you reload" and "does not work".
     */
    let memoryEnabled = null;
    let memoryPreference = null;

    function storage() {
        try {
            return global && global.localStorage ? global.localStorage : null;
        } catch (_) {
            return null;
        }
    }

    function read(key, fallback) {
        const store = storage();
        if (!store) return fallback;
        try {
            const raw = store.getItem(key);
            return raw === null || raw === undefined ? fallback : raw;
        } catch (_) {
            return fallback;
        }
    }

    function write(key, value) {
        const store = storage();
        if (!store) return;
        try {
            store.setItem(key, value);
        } catch (_) {
            // Quota, or a browser refusing to persist. The in-memory value still applies.
        }
    }

    function announce(change) {
        for (const listener of Array.from(listeners)) {
            try {
                listener(change);
            } catch (_) {
                // One bad listener must not stop the others being told.
            }
        }
    }

    /** Whether the companion may change the environment. False unless somebody said yes. */
    function isEnabled() {
        const raw = read(KEY, memoryEnabled);
        if (raw === ON) return true;
        if (raw === OFF) return false;
        // Anything else — never set, or a value from a different version of this feature — is
        // treated as "not granted", because a permission is the one thing that must not be
        // inferred from a value nobody recognises.
        return false;
    }

    /**
     * Turn the capability on or off.
     *
     * @returns {boolean} whether this actually changed anything, so a caller can avoid
     *   announcing a no-op.
     */
    function setEnabled(on) {
        const next = on ? ON : OFF;
        const changed = isEnabled() !== Boolean(on);
        memoryEnabled = next;
        write(KEY, next);
        if (changed) announce({ enabled: Boolean(on), preference: getPreference() });
        return changed;
    }

    function enable() {
        return setEnabled(true);
    }

    function disable() {
        return setEnabled(false);
    }

    /** The saved preference, or `'auto'` for anything we do not recognise. */
    function getPreference() {
        const raw = read(PREFERENCE_KEY, memoryPreference);
        if (typeof raw !== 'string') return DEFAULT_PREFERENCE;
        const value = raw.trim().toLowerCase();
        return PREFERENCES.indexOf(value) === -1 ? DEFAULT_PREFERENCE : value;
    }

    /**
     * Set the preference. An unrecognised value becomes `'auto'` rather than being stored, so a
     * stale value from a newer build cannot sit in storage shaping results nobody can explain.
     *
     * @returns {boolean} whether this changed anything
     */
    function setPreference(value) {
        const wanted = typeof value === 'string' ? value.trim().toLowerCase() : '';
        const next = PREFERENCES.indexOf(wanted) === -1 ? DEFAULT_PREFERENCE : wanted;
        const changed = getPreference() !== next;
        memoryPreference = next;
        write(PREFERENCE_KEY, next);
        if (changed) announce({ enabled: isEnabled(), preference: next });
        return changed;
    }

    /**
     * Subscribe. Returns an unsubscribe, and never fires for a write that changed nothing —
     * Settings re-rendering itself because somebody re-selected the value already showing is a
     * small thing that gets noticed.
     */
    function onChange(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    /** Everything the Settings panel and the capability need, in one read. */
    function snapshot() {
        return { enabled: isEnabled(), preference: getPreference() };
    }

    /** For tests, and for a panel that wants to start from a known state. */
    function reset() {
        memoryEnabled = null;
        memoryPreference = null;
        const store = storage();
        if (store) {
            try {
                store.removeItem(KEY);
                store.removeItem(PREFERENCE_KEY);
            } catch (_) {
                /* nothing to undo */
            }
        }
        listeners.clear();
    }

    const api = {
        KEY,
        PREFERENCE_KEY,
        ON,
        OFF,
        PREFERENCES,
        DEFAULT_PREFERENCE,
        isEnabled,
        setEnabled,
        enable,
        disable,
        getPreference,
        setPreference,
        onChange,
        snapshot,
        reset,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_SCENE_AMBIENCE_SWITCH = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
