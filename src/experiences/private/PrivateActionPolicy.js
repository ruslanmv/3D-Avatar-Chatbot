/**
 * PX2. Whether an action may run — decided apart from who wanted it and from what runs it.
 *
 * Three things used to be one thing. A model that wrote `<play>` was, in the same breath, the
 * intent ("she wants music"), the permission ("so play it") and the execution. That is how a
 * Private evening got a different song because the model mentioned one, and why the fix at the
 * time was to refuse every model-driven change inside Private (`PlayDirective.privateActive`).
 * Refusing everything is safe and useless: the person who typed "suona Daft Punk" was refused
 * along with the model.
 *
 * Here they are separate:
 *
 *   intent       PrivateActionIntent (their words) or a tag the model wrote
 *   permission   this file: a pure function of the action and the session's facts
 *   execution    the bridge's handlers, which ask this file again before applying a result
 *
 * ## What it guarantees
 *
 * - **An allowlist.** Twelve names; anything else is refused before a handler is looked up.
 * - **Validated parameters.** Each name has a schema; unknown keys are dropped, strings are
 *   bounded and stripped of markup and links. A model's arguments are data, never instructions.
 * - **Her own initiative is narrow.** A model-sourced action runs only when the person asked for
 *   that kind of thing in this turn — or, for a saved outfit, when they chose AUTONOMOUS.
 *   Otherwise it becomes a suggestion (SUGGEST) or nothing (OFF).
 * - **Making a new outfit costs something**, so it needs the person: their own request, or their
 *   yes to an offer. Never the model alone, whatever the autonomy level.
 * - **Care mode stops everything but silence.** Only pausing or stopping music is allowed.
 * - **Nothing here knows the consent level.** No action reads it, moves it or is unlocked by it;
 *   `ConsentFlow` stays the only owner (CLAUDE.md, "Adult experience").
 *
 * Exposes: window.NEXUS_PRIVATE_ACTION_POLICY
 */
(function (global) {
    'use strict';

    const AUTONOMY = Object.freeze(['off', 'suggest', 'autonomous']);
    const AUTONOMY_KEY = 'nexus_private_wardrobe_autonomy';
    const DEFAULT_AUTONOMY = 'suggest';

    /** Who may be the reason an action runs. */
    const SOURCES = Object.freeze(['user', 'user-approved', 'control', 'model']);

    const STYLE = ['elegant', 'formal', 'casual', 'comfy', 'sexy', 'sporty', 'cute', 'summer', 'night', 'party'];
    const COLOUR = ['red', 'black', 'white', 'blue', 'pink', 'yellow', 'green'];
    const EMOTION = ['happy', 'relaxed', 'surprised', 'shy', 'playful', 'tender'];

    const ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
    const GARMENT = /^[a-z0-9][a-z0-9 ,'+&-]{1,119}$/;
    // eslint-disable-next-line no-control-regex
    const CONTROL = /[\x00-\x1f\x7f]/g;

    /** Plain words: no markup, no links, bounded. `''` when nothing usable is left. */
    function text(value, max) {
        const v = String(value == null ? '' : value)
            .replace(CONTROL, ' ')
            .replace(/<[^>]{0,200}>/g, ' ')
            .replace(/https?:\/\/\S+/gi, ' ')
            .replace(/[`{}[\]<>]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return v.slice(0, max);
    }

    const oneOf = (list) => (v) => (list.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : undefined);
    const flag = (v) => (v === true ? true : undefined);

    /** name → { family, params: { key: validator } }. A validator returns undefined to drop a key. */
    const ACTIONS = Object.freeze({
        'music.search': { family: 'music', params: { query: (v) => text(v, 120) } },
        'music.play': { family: 'music', params: { query: (v) => text(v, 120), different: flag } },
        'music.pause': { family: 'music', params: {} },
        'music.resume': { family: 'music', params: {} },
        'music.stop': { family: 'music', params: {} },
        'wardrobe.wear': {
            family: 'wardrobe',
            params: {
                look: (v) => text(v, 60) || undefined,
                outfit: (v) => (ID.test(String(v || '').toLowerCase()) ? String(v).toLowerCase() : undefined),
                style: oneOf(STYLE),
                colour: oneOf(COLOUR),
                choose: flag,
                different: flag,
                words: (v) => text(v, 120) || undefined,
            },
        },
        'wardrobe.change': {
            family: 'wardrobe',
            params: { prompt: (v) => (GARMENT.test(String(v || '').toLowerCase()) ? String(v).toLowerCase() : null) },
            required: ['prompt'],
        },
        'wardrobe.create': {
            family: 'wardrobe',
            params: { prompt: (v) => (GARMENT.test(String(v || '').toLowerCase()) ? String(v).toLowerCase() : null) },
            required: ['prompt'],
        },
        'wardrobe.undo': { family: 'wardrobe', params: {} },
        'avatar.dance': { family: 'avatar', params: {} },
        'avatar.react': { family: 'avatar', params: { emotion: oneOf(EMOTION) }, required: ['emotion'] },
        'scene.change': {
            family: 'scene',
            params: { scene: (v) => (ID.test(String(v || '').toLowerCase()) ? String(v).toLowerCase() : null) },
            required: ['scene'],
        },
    });

    /** Makes a new asset: slow, and on a paid Forge not free. */
    const GENERATES = Object.freeze(['wardrobe.create', 'wardrobe.change']);
    /** Allowed while the session is in care mode. */
    const QUIETING = Object.freeze(['music.pause', 'music.stop']);

    /**
     * The parameters this action may carry, or `{ ok: false }`. Unknown keys are dropped rather
     * than refused: a model that adds `volume="11"` still gets its song, without the volume.
     */
    function validate(name, params) {
        const spec = ACTIONS[name];
        if (!spec) return { ok: false, why: 'unknown-action' };
        const out = {};
        const given = params && typeof params === 'object' ? params : {};
        for (const key of Object.keys(spec.params)) {
            if (!Object.prototype.hasOwnProperty.call(given, key)) continue;
            const value = spec.params[key](given[key]);
            if (value === null) return { ok: false, why: `bad-${key}` };
            if (value !== undefined) out[key] = value;
        }
        for (const key of spec.required || []) {
            if (out[key] === undefined || out[key] === '') return { ok: false, why: `missing-${key}` };
        }
        return { ok: true, params: out, family: spec.family };
    }

    function autonomy(g) {
        try {
            const raw = (g || global).localStorage.getItem(AUTONOMY_KEY);
            return AUTONOMY.includes(raw) ? raw : DEFAULT_AUTONOMY;
        } catch (_) {
            return DEFAULT_AUTONOMY;
        }
    }

    function setAutonomy(level, g) {
        if (!AUTONOMY.includes(level)) return false;
        try {
            (g || global).localStorage.setItem(AUTONOMY_KEY, level);
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * May this run?
     *
     * @param {object} action  `{ name, params, source }`, parameters already validated
     * @param {object} facts
     * @param {boolean} facts.active     a Private session is running and it is this action's
     * @param {boolean} facts.care       the session is in care mode
     * @param {object}  facts.asked      `{ music, wardrobe, avatar, scene }` — the person asked for
     *                                   that family in the turn this action belongs to
     * @param {string}  facts.autonomy   `off` | `suggest` | `autonomous`
     * @returns {{allow: boolean, why?: string, suggest?: boolean}}
     */
    function decide(action, facts) {
        const f = facts || {};
        const spec = action && ACTIONS[action.name];
        if (!spec) return { allow: false, why: 'unknown-action' };
        if (!SOURCES.includes(action.source)) return { allow: false, why: 'unknown-source' };
        if (!f.active) return { allow: false, why: 'not-in-private' };
        if (f.care && !QUIETING.includes(action.name)) return { allow: false, why: 'care' };

        // Their words, their yes, or their tap: the person is the authorization.
        if (action.source !== 'model') return { allow: true };

        const asked = Boolean(f.asked && f.asked[spec.family]);
        switch (spec.family) {
            case 'music':
                // Quieting is always hers to do; starting something is not.
                if (QUIETING.includes(action.name)) return { allow: true };
                return asked ? { allow: true } : { allow: false, why: 'not-asked' };
            case 'wardrobe': {
                if (GENERATES.includes(action.name))
                    return asked ? { allow: true } : { allow: false, why: 'needs-approval', suggest: true };
                if (asked) return { allow: true };
                const level = AUTONOMY.includes(f.autonomy) ? f.autonomy : DEFAULT_AUTONOMY;
                if (level === 'autonomous')
                    return action.name === 'wardrobe.undo' ? { allow: false, why: 'not-asked' } : { allow: true };
                if (level === 'suggest') return { allow: false, why: 'needs-approval', suggest: true };
                return { allow: false, why: 'autonomy-off' };
            }
            case 'avatar':
                // A reaction is an expression; a dance is a thing she does to the room.
                if (action.name === 'avatar.react') return { allow: true };
                return asked ? { allow: true } : { allow: false, why: 'not-asked' };
            default:
                // The place is theirs: only their own words move it.
                return { allow: false, why: 'user-only' };
        }
    }

    const api = {
        ACTIONS,
        AUTONOMY,
        AUTONOMY_KEY,
        DEFAULT_AUTONOMY,
        SOURCES,
        GENERATES,
        QUIETING,
        validate,
        decide,
        autonomy,
        setAutonomy,
        text,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_ACTION_POLICY = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
