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
 * - **An allowlist.** Sixteen names; anything else is refused before a handler is looked up.
 * - **Validated parameters.** Each name has a schema; unknown keys are dropped, strings are
 *   bounded and stripped of markup and links. A model's arguments are data, never instructions.
 * - **Her own initiative is narrow.** A model-sourced action runs only when the person asked for
 *   that kind of thing in this turn — or, for a saved outfit, when they chose AUTONOMOUS.
 *   Otherwise it becomes a suggestion (SUGGEST) or nothing (OFF).
 * - **Making a new outfit costs something**, so it needs the person: their own request, or their
 *   yes to an offer. Never the model alone, whatever the autonomy level.
 * - **Care mode stops everything but silence.** Only pausing or stopping music is allowed.
 * - **Only undressing knows the consent level, and only reads it.** UN1, an owner decision:
 *   `wardrobe.undress` opens at the top of the evening's pace (`UNDRESS_LEVEL`, 4 of 4) and is
 *   refused below it, whoever asks. The level arrives as a fact read at the moment of the
 *   decision; nothing here moves it, and no other action reads it. `ConsentFlow` stays its only
 *   owner, and a ceiling below 4 means undressing never opens (CLAUDE.md, "Adult experience").
 *
 * Exposes: window.NEXUS_PRIVATE_ACTION_POLICY
 */
(function (global) {
    'use strict';

    const AUTONOMY = Object.freeze(['off', 'suggest', 'autonomous']);
    const AUTONOMY_KEY = 'nexus_private_wardrobe_autonomy';
    // UN21. "She changes her clothes by herself, nobody asked, and it ruins the moment." The
    // default is the person's words only: she changes when they ask, never on her own, and
    // never offers unprompted. "She suggests" and "She chooses" stay in setup for whoever wants them.
    const DEFAULT_AUTONOMY = 'off';

    /** Who may be the reason an action runs. */
    const SOURCES = Object.freeze(['user', 'user-approved', 'control', 'model']);

    const STYLE = [
        'lingerie',
        'elegant',
        'formal',
        'casual',
        'comfy',
        'sexy',
        'sporty',
        'cute',
        'summer',
        'night',
        'party',
    ];
    const COLOUR = ['red', 'black', 'white', 'blue', 'pink', 'yellow', 'green'];
    const EMOTION = ['happy', 'relaxed', 'surprised', 'shy', 'playful', 'tender'];
    /** UN36. The routines (PrivateRoutines.ORDER) and `choose`: the boldest the evening allows. */
    const ROUTINE_IDS = Object.freeze([
        'tease',
        'ride',
        'table-dance',
        'open-for-you',
        'from-behind',
        'everything',
        'window-evening',
        'edging',
        'oil-everything',
        'tied',
        'dom-sub',
        'window-show',
        'rounds',
        'used-marked',
        // L5. Valentina's and Chiara's shows.
        'full-service',
        'like-last-time',
        'fist-then-inside',
        'worse-than-last-time',
        'fist-then-ass',
        'two-hands',
        'striptease',
        'choose',
    ]);

    /** UN34. Where the person may finish; `choose` lets the bridge pick from what her look shows. */
    // UR1. `face` and `mouth`: only in Unrestrained, shown on her face and in her words (no paint).
    const FINISH_PLACES = Object.freeze([
        'back',
        'inside',
        'ass',
        'both',
        'all',
        'belly',
        'chest',
        'face',
        'mouth',
        'choose',
    ]);
    const FINISH_LEVEL = 4;

    /** UN5. PrivatePoseController.POSES' keys, plus `stand`; the adult ones open with undressing. */
    const POSE_KEYS = [
        'kneel',
        'kneel-up',
        'all-fours',
        'lie-back',
        'lie-front',
        'lie-side',
        'bend-forward',
        'arch-back',
        'lounge',
        // UN27. The closer positions (PrivatePoseController.INTIMATE).
        'sit-open',
        'kneel-wide',
        'knees-up',
        'straddle',
        // UN38.
        'face-down',
        'legs-up',
        'bent-over',
        'spoon',
        'reverse',
        'on-knees',
        'stand',
        'back',
        'turn',
        // NL1. A Pose Studio preset by name (`preset`), and a position that was asked for and
        // is not in this build (`unknown`: it never runs, it is how the reply learns she did
        // not move).
        'preset',
        'unknown',
    ];
    /** NL1. A Pose Studio preset's own name: `sittingCrossed`. Never free text. */
    const PRESET_NAME = /^[A-Za-z][A-Za-z0-9]{1,39}$/;
    /**
     * UN28. The pace each closer position opens at — the evening's steps are 1 Warm, 2 Romantic,
     * 3 Sensual, 4 Intimate. One position at a time, from teasing to explicit, so every step of the
     * pace the person chooses changes what she can do, and the next one is something to want:
     *
     *   2  kneel-wide          kneeling, hands on her thighs: a tease that works fully dressed
     *   3  sit-open, straddle  legs open, astride their lap: closer, still dressed
     *   4  knees-up, all-fours the explicit two, with undressing (UN1), at the top
     *
     * Before UN28 every one opened at 4, so a Sensual evening (its ceiling is 3) had none, and a
     * Mature one had nothing new until the top. Read only to decide; never moved here (the level is
     * ConsentFlow's, moved by the person). Moving a position is one line in this table.
     */
    const POSE_LEVEL = Object.freeze({
        'kneel-wide': 2,
        'sit-open': 3,
        straddle: 3,
        'knees-up': 4,
        'all-fours': 4,
        // UN38. The six added for the top of the pace: explicit, so with undressing, at 4.
        'face-down': 4,
        'legs-up': 4,
        'bent-over': 4,
        spoon: 4,
        reverse: 4,
        'on-knees': 4,
    });
    /** The adult positions: every key with an opening level. */
    const ADULT_POSES = Object.keys(POSE_LEVEL);

    /** UN28. The pace a position opens at, or 0 for one that is not gated (kneel, lie-back…). */
    function poseLevel(key) {
        return Object.prototype.hasOwnProperty.call(POSE_LEVEL, key) ? POSE_LEVEL[key] : 0;
    }

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
        'music.play': { family: 'music', params: { query: (v) => text(v, 120), different: flag, again: flag } },
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
                // PX15. The English canonical name from PrivateActionIntent.GARMENTS.
                garment: (v) => (/^[a-z][a-z -]{1,30}$/.test(String(v || '')) ? String(v) : undefined),
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
        // UN5. Dressed again: the outfit she wore before the first layer came off this evening.
        'wardrobe.redress': { family: 'wardrobe', params: {} },
        // UN1. One layer off (`next`), or down to the last layer she has (`all`); `look` is the
        // look an approved offer already chose, so the yes wears what was offered.
        'wardrobe.undress': {
            family: 'wardrobe',
            params: {
                step: oneOf(['next', 'all']),
                look: (v) => text(v, 60) || undefined,
                words: (v) => text(v, 120) || undefined,
                // UN7. They asked to see her naked (not only "take a layer off").
                naked: (v) => (v === true ? true : undefined),
            },
        },
        'avatar.dance': { family: 'avatar', params: {} },
        // UN5. A held position from Pose Studio's presets (PrivatePoseController.POSES), or
        // `stand` to let go of it.
        'avatar.pose': {
            family: 'avatar',
            params: {
                pose: oneOf(POSE_KEYS),
                preset: (v) => (PRESET_NAME.test(String(v || '')) ? String(v) : undefined),
                said: (v) => text(v, 80),
                ask: (v) => text(v, 160),
                // OL3. "open" | "close": relative to the position she holds (PrivatePoseController.transition).
                rel: oneOf(['open', 'close']),
            },
            required: ['pose'],
        },
        'avatar.react': { family: 'avatar', params: { emotion: oneOf(EMOTION) }, required: ['emotion'] },
        // UN36. A show she moves through (PrivateRoutines): start one by name or the boldest open
        // (`choose`), stop it, change its speed, or play the last one again.
        'avatar.routine': {
            family: 'avatar',
            params: {
                routine: oneOf(ROUTINE_IDS),
                move: oneOf(['start', 'stop', 'slower', 'faster', 'again']),
            },
            required: ['move'],
        },
        // LM7. Moving in the position she holds: start (at a tempo), slower, faster, still. The
        // person's words only — the model never sets her moving.
        'avatar.move': {
            family: 'avatar',
            params: {
                move: oneOf(['start', 'slower', 'faster', 'still']),
                tempo: oneOf(['slow', 'normal', 'fast']),
            },
            required: ['move'],
        },
        // HA1. Her hair aside (from behind it hangs between them and her) or back as it was. A mode
        // added beside the positions, never a change to one; the person's words or tap only.
        'avatar.hair': {
            family: 'avatar',
            params: { move: oneOf(['aside', 'back']), side: oneOf(['front', 'left', 'right']) },
            required: ['move'],
        },
        // BD34. The strength of her marks in "Legata e spalancata": more or less. Their words only.
        'avatar.marks': { family: 'avatar', params: { move: oneOf(['more', 'less']) }, required: ['move'] },
        // UN34. The person finishing, and where: shown on her skin. Their words or their tap only.
        'body.finish': { family: 'body', params: { where: oneOf(FINISH_PLACES) }, required: ['where'] },
        // PS2. Their fist, shown on her body (Forge's fisted states) for the position she holds.
        // Their words only, at step 4, like the finish.
        // L5. `with`: their hand (the default) or a bottle (Forge paints it from behind only).
        // BD35. Or both their hands in her ass ("mettimi le due mani"), a wider gape.
        'body.fist': {
            family: 'body',
            params: { where: oneOf(['front', 'anal', 'both', 'choose']), with: oneOf(['hand', 'bottle', 'hands']) },
            required: [],
        },
        // UN4. A different room for the evening: one of the places this device can show, and
        // only ever because the person said so (their words, their yes, their tap).
        'world.travel': {
            family: 'world',
            params: { world: (v) => (ID.test(String(v || '').toLowerCase()) ? String(v).toLowerCase() : null) },
            required: ['world'],
        },
        'scene.change': {
            family: 'scene',
            params: { scene: (v) => (ID.test(String(v || '').toLowerCase()) ? String(v).toLowerCase() : null) },
            required: ['scene'],
        },
    });

    /** UN1. The pace the evening must be at before any layer comes off. */
    const UNDRESS_LEVEL = 4;

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
     * @param {number}  [facts.level]    ConsentFlow's current level, read now (UN1; undress only)
     * @returns {{allow: boolean, why?: string, suggest?: boolean}}
     */
    function decide(action, facts) {
        const f = facts || {};
        const spec = action && ACTIONS[action.name];
        if (!spec) return { allow: false, why: 'unknown-action' };
        if (!SOURCES.includes(action.source)) return { allow: false, why: 'unknown-source' };
        if (!f.active) return { allow: false, why: 'not-in-private' };
        if (f.care && !QUIETING.includes(action.name)) return { allow: false, why: 'care' };
        // L5. No limits is bare only: she is never dressed by the model or a show there. The
        // person's own words still dress her ("rivestiti" is theirs to say), and easing to 4 ends it.
        if (
            f.unrestrained &&
            action.source === 'model' &&
            ['wardrobe.wear', 'wardrobe.change', 'wardrobe.create', 'wardrobe.redress'].includes(action.name)
        )
            return { allow: false, why: 'bare-only' };
        // UN1. Before who asked: the person's own words below the top of the pace are refused too.
        if (action.name === 'wardrobe.undress' && !(Number(f.level) >= UNDRESS_LEVEL))
            return { allow: false, why: 'pace' };
        // UN5/UN28. An adult position opens at its own step of the pace (POSE_LEVEL), never below.
        if (action.name === 'avatar.pose') {
            const need = poseLevel(action.params && action.params.pose);
            if (need && !(Number(f.level) >= need)) return { allow: false, why: 'pace' };
        }

        // UN34. Finishing is theirs, at the top of the pace, and never her tag's.
        if (action.name === 'body.finish') {
            if (!(Number(f.level) >= FINISH_LEVEL)) return { allow: false, why: 'pace' };
            if (action.source === 'model') return { allow: false, why: 'user-only' };
            // UR1. On her face or in her mouth: only in Unrestrained (the grant, the top step, their tap).
            if ((action.params.where === 'face' || action.params.where === 'mouth') && !f.unrestrained)
                return { allow: false, why: 'unrestrained' };
        }
        // UR1. An Unrestrained show: only while Unrestrained is on.
        if (action.name === 'avatar.routine' && f.unrestrainedOnly && !f.unrestrained)
            return { allow: false, why: 'unrestrained' };

        // PS2. Their fist: theirs to ask, at the top of the pace, never her tag's.
        if (action.name === 'body.fist') {
            if (!(Number(f.level) >= FINISH_LEVEL)) return { allow: false, why: 'pace' };
            if (action.source === 'model') return { allow: false, why: 'user-only' };
        }

        // LM7. Her body moves because they asked, never because the model wrote it.
        if (action.name === 'avatar.move' && action.source === 'model') return { allow: false, why: 'user-only' };
        // HA1. Her hair moves because they asked, never because the model wrote it.
        if (action.name === 'avatar.hair' && action.source === 'model') return { allow: false, why: 'user-only' };
        // BD34. So do her marks.
        if (action.name === 'avatar.marks' && action.source === 'model') return { allow: false, why: 'user-only' };

        // Their words, their yes, or their tap: the person is the authorization.
        if (action.source !== 'model') return { allow: true };

        const asked = Boolean(f.asked && f.asked[spec.family]);
        switch (spec.family) {
            case 'music':
                // Quieting is always hers to do; starting something is not.
                if (QUIETING.includes(action.name)) return { allow: true };
                return asked ? { allow: true } : { allow: false, why: 'not-asked' };
            case 'wardrobe': {
                // UN5. Putting her clothes back on is never a risk: hers to do whenever.
                if (action.name === 'wardrobe.redress') return { allow: true };
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
                // PP1. Her show, unasked, is an invitation their yes takes (the bridge re-asks this
                // file then, as `user-approved`), never a start.
                if (action.name === 'avatar.routine' && !asked && action.params && action.params.move === 'start')
                    return { allow: false, why: 'not-asked', suggest: true };
                return asked ? { allow: true } : { allow: false, why: 'not-asked' };
            case 'world':
                // UN4. Her invitation is a question for them, never a trip: it becomes an offer
                // their yes takes (the bridge re-asks this file then, as `user-approved`).
                return { allow: false, why: 'needs-approval', suggest: true };
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
        UNDRESS_LEVEL,
        FINISH_PLACES,
        FINISH_LEVEL,
        ROUTINE_IDS,
        POSE_KEYS,
        ADULT_POSES,
        POSE_LEVEL,
        poseLevel,
        validate,
        decide,
        autonomy,
        setAutonomy,
        text,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_ACTION_POLICY = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
