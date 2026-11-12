/**
 * What a Private session may do, decided by the app and not by the model (SAE).
 *
 * Music, clothes and a scene are three different permissions. One timestamp used to
 * open all of them, so "put something else on" also unlocked a scene change, and a
 * clothing request was indistinguishable from a soundtrack request. Each one now
 * expires on its own.
 *
 * Wardrobe autonomy is opt-in and revocable. The default is that she may suggest a
 * look and must be asked before wearing it. Wearing something on her own is a
 * separate choice, and so is keeping it after Private ends. An adult session does
 * not by itself permit a mature outfit: that still needs the wardrobe toggle and an
 * avatar Forge has declared adult. Nothing here moves the consent level. A song and
 * a dress are not a step closer.
 *
 * Exposes: window.NEXUS_PRIVATE_ACTION_POLICY
 */
(function (global) {
    'use strict';

    var AUTONOMY_KEY = 'nexus_private_wardrobe_autonomy';
    var MATURE_KEY = 'nexus_private_wardrobe_mature';
    var KEEP_KEY = 'nexus_private_wardrobe_keep';
    var AUTONOMY = { explicit: 1, suggest: 1, auto: 1 };
    var memory = { autonomy: null, mature: null, keep: null };

    function storage() {
        try {
            return global && global.localStorage ? global.localStorage : null;
        } catch (_) {
            return null;
        }
    }

    function read(key) {
        var store = storage();
        try {
            if (store) return store.getItem(key);
        } catch (_) {
            /* fall through to the in-memory value */
        }
        return null;
    }

    function write(key, value) {
        var store = storage();
        try {
            if (store) store.setItem(key, value);
        } catch (_) {
            /* the in-memory value still applies for this page */
        }
    }

    /** 'explicit' | 'suggest' | 'auto'. Anything unrecognised is the default, suggest. */
    function autonomy() {
        var raw = memory.autonomy != null ? memory.autonomy : read(AUTONOMY_KEY);
        return AUTONOMY[raw] ? raw : 'suggest';
    }

    function setAutonomy(value) {
        var next = AUTONOMY[value] ? value : 'suggest';
        memory.autonomy = next;
        write(AUTONOMY_KEY, next);
        return next;
    }

    /** Mature outfits are off until the person turns the toggle on. */
    function matureCategories() {
        var raw = memory.mature != null ? memory.mature : read(MATURE_KEY);
        return raw === 'on';
    }

    function setMatureCategories(on) {
        memory.mature = on ? 'on' : 'off';
        write(MATURE_KEY, memory.mature);
        return memory.mature === 'on';
    }

    /**
     * Whether the outfit worn inside Private is still on when Private ends.
     * Default is no: the look from before the change comes back.
     */
    function keepAfterPrivate() {
        var raw = memory.keep != null ? memory.keep : read(KEEP_KEY);
        return raw === 'on';
    }

    function setKeepAfterPrivate(on) {
        memory.keep = on ? 'on' : 'off';
        write(KEEP_KEY, memory.keep);
        return memory.keep === 'on';
    }

    function preferences() {
        return {
            autonomy: autonomy(),
            matureCategories: matureCategories(),
            keepAfterPrivate: keepAfterPrivate(),
        };
    }

    /**
     * A sentence about clothes, or null.
     *
     * Offer is deliberately not a wear. "Show me several outfits" is an invitation
     * to open Try-On later, and answering it by navigating there — or by dressing
     * her — takes the choice away. Undo and an explicit wear are requests.
     */
    function wardrobeRequest(text) {
        var said = String(text == null ? '' : text).trim();
        if (!said) return null;
        if (
            /\b(?:fammi vedere|show me|let me see|guarda)\b/i.test(said) &&
            /\b(?:vestiti|outfits|looks|abiti|clothes|dress(?:es)?)\b/i.test(said)
        ) {
            return { kind: 'wardrobe.offer', args: {} };
        }
        if (/\b(?:torna come prima|come prima|previous outfit|undo the outfit|rimettiti come)\b/i.test(said)) {
            return { kind: 'wardrobe.undo', args: {} };
        }
        var choose = /\b(?:scegli tu|you choose|pick (?:an |the )?outfit|scegli cosa|qualcosa di tuo)\b/i.test(said);
        var wear =
            choose ||
            /\b(?:mettiti|indossa|cambiati|wear|change into|put on)\b/i.test(said) ||
            /\b(?:vestito|abito|outfit|dress|gonna|jeans)\b/i.test(said);
        if (!wear) return null;
        if (
            /\b(?:put on|metti|play|suona)\b/i.test(said) &&
            /\b(?:music|musica|song|canzone|brano|track)\b/i.test(said)
        ) {
            return null;
        }
        var occasion = null;
        if (/\b(?:elegant\w*|elegante|formale|gown|black tie)\b/i.test(said)) occasion = 'elegant';
        else if (/\b(?:comodo|comoda|comfort\w*|cozy|rilass\w*|casual)\b/i.test(said)) occasion = 'comfortable';
        else if (/\b(?:sera|evening|night out|serata)\b/i.test(said)) occasion = 'evening';
        return {
            kind: 'wardrobe.wear',
            args: { choose: true, occasion: occasion, said: said.slice(0, 160) },
        };
    }

    function matureLook(look) {
        if (!look) return false;
        if (look.private === true) return true;
        var rating = String(look.rating || '').toLowerCase();
        return rating === 'private' || rating === 'underwear' || rating === 'swimwear';
    }

    /**
     * Whether this look may be worn. A non-mature look does not consult the adult
     * gate. A mature one needs both the person's toggle and an open eligibility
     * answer — unknown eligibility is a refusal, not a guess.
     */
    function outfitAllowed(look, eligibility) {
        if (!matureLook(look)) return { ok: true };
        if (!matureCategories()) return { ok: false, reason: 'mature-off' };
        if (!eligibility || eligibility.mode !== 'open') return { ok: false, reason: 'avatar-ineligible' };
        return { ok: true };
    }

    /**
     * @param {object} request
     * @param {object} session  the live Private session, already resolved by the app
     * @param {object} [context]
     * @param {boolean} [context.musicGranted]
     * @param {boolean} [context.wardrobeGranted]
     */
    function authorize(request, session, context) {
        var ctx = context || {};
        if (!session || session.active === false || session.stopped) {
            return { ok: false, reason: 'session-ended' };
        }
        if (request && request.sessionId && session.id && request.sessionId !== session.id) {
            return { ok: false, reason: 'stale-session' };
        }
        var kind = request && request.kind;
        var source = request && request.source === 'user' ? 'user' : 'assistant';
        if (kind === 'music.play' || kind === 'music.pause' || kind === 'music.stop') {
            if (source === 'assistant' && ctx.musicGranted !== true) {
                return { ok: false, reason: 'not-authorized' };
            }
            return { ok: true };
        }
        if (kind === 'wardrobe.offer') {
            return { ok: true, effect: 'none' };
        }
        if (kind === 'wardrobe.undo') {
            return { ok: true };
        }
        if (kind === 'wardrobe.wear' || kind === 'wardrobe.create') {
            if (kind === 'wardrobe.create' && source !== 'user' && ctx.wardrobeGranted !== true) {
                return { ok: false, reason: 'needs-confirmation' };
            }
            if (source === 'assistant' && ctx.wardrobeGranted !== true) {
                if (autonomy() !== 'auto' || kind !== 'wardrobe.wear') {
                    return { ok: false, reason: 'needs-confirmation' };
                }
                if (request.args && request.args.generate) return { ok: false, reason: 'needs-confirmation' };
            }
            if (source === 'assistant' && autonomy() === 'explicit' && ctx.wardrobeGranted !== true) {
                return { ok: false, reason: 'needs-confirmation' };
            }
            return { ok: true };
        }
        if (kind === 'avatar.dance' || kind === 'scene.change') {
            return { ok: false, reason: 'not-in-session-action' };
        }
        return { ok: false, reason: 'not-authorized' };
    }

    var api = {
        AUTONOMY_KEY: AUTONOMY_KEY,
        MATURE_KEY: MATURE_KEY,
        KEEP_KEY: KEEP_KEY,
        autonomy: autonomy,
        setAutonomy: setAutonomy,
        matureCategories: matureCategories,
        setMatureCategories: setMatureCategories,
        keepAfterPrivate: keepAfterPrivate,
        setKeepAfterPrivate: setKeepAfterPrivate,
        preferences: preferences,
        wardrobeRequest: wardrobeRequest,
        matureLook: matureLook,
        outfitAllowed: outfitAllowed,
        authorize: authorize,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_ACTION_POLICY = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
