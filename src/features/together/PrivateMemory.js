/**
 * The little that Private remembers, and the great deal it does not.
 *
 * Private stored nothing at all, and the completion card said so as a privacy promise:
 * *"Nothing from this Private moment was added to Playground Histories."* That promise is
 * right and stays. But it was doing double duty as a product decision, and there it cost the
 * feature its continuity: session ten opened exactly like session one, with the same preset
 * unselected, the same mood unasked, and no sense that anything had happened before.
 *
 * The two are separable, and this file is the separation. What is kept:
 *
 *   - which preset was chosen last          (`affectionate` | `romantic` | `sensual`)
 *   - which mood was chosen last            (`playful` | `tender`)
 *   - which soundtrack option was chosen    (`choose` | `current` | `none`)
 *   - which scene it happened in            (a catalogue id, slug-shaped)
 *   - how many sessions have completed      (a number)
 *   - when the last one was                 (a timestamp)
 *
 * What is never kept, and what there is no field for: anything she said, anything the user
 * said, the escalation level reached, or any free text whatsoever. Three closed enums, one
 * field constrained to a slug because the scene catalogue is open-ended, and two numbers —
 * and `write` refuses anything that is not one of them, so a later caller cannot quietly
 * start storing content through a door this file left open. That is the difference between
 * "we do not store the conversation" and "we cannot".
 *
 * It is device-local (`localStorage`), it is off unless a session completes, and `forget()`
 * removes it. A profile that never opens Private never creates the key.
 *
 * Exposes: window.NEXUS_PRIVATE_MEMORY
 */
(function (global) {
    'use strict';

    const KEY = 'nexus_private_prefs';

    /**
     * The whole schema, as data.
     *
     * Read as: a field not named here does not survive a round trip, whoever writes it. The
     * enums are closed for the same reason — an unexpected value is dropped rather than
     * stored, so a corrupted or hand-edited key cannot put an arbitrary string in front of the
     * planner.
     */
    const FIELDS = Object.freeze({
        preset: Object.freeze(['affectionate', 'romantic', 'sensual']),
        mood: Object.freeze(['playful', 'tender']),
        soundtrack: Object.freeze(['choose', 'current', 'none']),
    });

    /**
     * The one field whose values this file cannot enumerate, because the scene catalogue is
     * open — packs add scenes. Constrained by shape instead: a catalogue id is a slug, and a
     * slug cannot carry a sentence. So the "no field can hold content" property survives a
     * field whose values are not a closed list.
     */
    const SLUG_FIELDS = Object.freeze({ scene: /^[a-z0-9][a-z0-9-]{0,63}$/ });
    const COUNTERS = Object.freeze(['sessions', 'lastAt']);

    const EMPTY = Object.freeze({
        preset: null,
        mood: null,
        soundtrack: null,
        scene: null,
        sessions: 0,
        lastAt: 0,
    });

    function store() {
        try {
            return global && global.localStorage ? global.localStorage : null;
        } catch (_) {
            // Private browsing, blocked site data, a sandboxed frame. Not remembering is a
            // perfectly good outcome; throwing on the way into a Private session is not.
            return null;
        }
    }

    /** Only the fields in the schema, only the values the schema allows. */
    function sanitise(raw) {
        const out = { ...EMPTY };
        if (!raw || typeof raw !== 'object') return out;
        for (const [field, allowed] of Object.entries(FIELDS)) {
            const value = raw[field];
            if (typeof value === 'string' && allowed.includes(value)) out[field] = value;
        }
        for (const [field, pattern] of Object.entries(SLUG_FIELDS)) {
            const value = raw[field];
            if (typeof value === 'string' && pattern.test(value)) out[field] = value;
        }
        for (const counter of COUNTERS) {
            const value = Number(raw[counter]);
            // `typeof` is not enough on its own here, but Number.isFinite after it is: a
            // stored NaN, Infinity or "12; DROP" all become 0 rather than propagating.
            out[counter] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
        }
        return out;
    }

    /** What we know, always a complete object — never `null`, so no caller has to guard. */
    function read() {
        const s = store();
        if (!s) return { ...EMPTY };
        try {
            const raw = s.getItem(KEY);
            return raw ? sanitise(JSON.parse(raw)) : { ...EMPTY };
        } catch (_) {
            return { ...EMPTY };
        }
    }

    /**
     * Merge a patch in. Returns what is now stored, whether or not the write landed.
     *
     * A value the schema rejects is *ignored*, not written as null. Sanitising the merged
     * object instead let a bad patch clobber a good stored value on its way to being dropped —
     * so writing a scene id of `"<script>"` did not fail to store that, it erased the real
     * scene that was there. "Dropped, not stored" has to mean the field is left alone.
     */
    function write(patch) {
        const current = read();
        const clean = sanitise(patch);
        const merged = { ...current };
        for (const key of Object.keys(clean)) {
            if (!patch || !Object.prototype.hasOwnProperty.call(patch, key)) continue;
            if (clean[key] === null || clean[key] === 0) continue;
            merged[key] = clean[key];
        }
        // Counters are set rather than merged, since `remember` computes them outright.
        for (const counter of COUNTERS) {
            if (patch && Object.prototype.hasOwnProperty.call(patch, counter)) {
                const value = Number(patch[counter]);
                if (Number.isFinite(value) && value > 0) merged[counter] = Math.floor(value);
            }
        }
        const next = sanitise(merged);
        const s = store();
        if (!s) return next;
        try {
            s.setItem(KEY, JSON.stringify(next));
        } catch (_) {
            // Storage full or disabled. The session is unaffected; it just will not be
            // remembered, which is the same as every session before this file existed.
        }
        return next;
    }

    /** Record what was chosen when a session actually completes, not when one is started. */
    function remember({ preset = null, mood = null, soundtrack = null, scene = null } = {}) {
        const current = read();
        return write({
            preset: preset || current.preset,
            mood: mood || current.mood,
            soundtrack: soundtrack || current.soundtrack,
            scene: scene || current.scene,
            sessions: current.sessions + 1,
            lastAt: Date.now(),
        });
    }

    /** The preset to pre-select in setup, or `null` for "let them choose". */
    function preferredPreset() {
        return read().preset;
    }

    /** True the first time only, which is when a welcome is worth something. */
    function isFirstSession() {
        return read().sessions === 0;
    }

    function forget() {
        const s = store();
        if (!s) return false;
        try {
            s.removeItem(KEY);
            return true;
        } catch (_) {
            return false;
        }
    }

    const api = {
        KEY,
        FIELDS,
        SLUG_FIELDS,
        COUNTERS,
        EMPTY,
        read,
        write,
        remember,
        preferredPreset,
        isFirstSession,
        forget,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_MEMORY = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
