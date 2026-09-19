/**
 * `[smile]` is not something she says (P14).
 *
 * Reported from a real Private session: her replies arrived with bracketed stage directions in
 * them, so the bubble read "[smile] I like it when the room is this quiet" and the speech engine
 * said the word "smile" out loud. Both are the same mistake in two places — a note about how to
 * perform a line, rendered as part of the line.
 *
 * Two halves fix it and only one of them is in this file. The prompt tells her not to write them,
 * which works most of the time; this is the defence for the rest of the time, because a prompt is
 * a request and text on screen is a fact.
 *
 * ## Why an allowlist, and why a narrow one
 *
 * The tempting implementation is `text.replace(/\[[^\]]*\]/g, '')`, and it is wrong. Square
 * brackets are ordinary punctuation: a quotation with `[sic]` in it, a citation, `a[0]`, a
 * Markdown link's `[label](url)`, somebody's own typed `[?]`. A sanitiser that eats all of them
 * silently rewrites the conversation, and a rewrite you cannot see is worse than a marker you
 * can.
 *
 * So this removes a bracketed or asterisked fragment **only** when what is inside it is a
 * recognised performance verb. `[smile]` goes; `[sic]`, `[1]` and `[label](url)` stay. When a new
 * marker turns up in the wild the fix is to add the word here, deliberately, not to widen the
 * pattern.
 *
 * ## What comes back
 *
 * `{ text, markers }` rather than just the cleaned string, because the marker is *information*:
 * a model that wrote `[smile]` was asking for a smile, and the avatar can do that. Throwing it
 * away would turn a formatting bug into a lost signal. See `PRESENCE`, which maps the recognised
 * words onto the ordinary, non-adult intents Private is allowed to ask for.
 *
 * Exposes: window.NEXUS_STAGE_DIRECTIONS
 */
(function (global) {
    'use strict';

    /**
     * The words that make a bracketed fragment a stage direction.
     *
     * Every entry is a thing a body does, which is what keeps the list from drifting into
     * "anything short": `[smile]` is a direction, `[note]` and `[important]` are not, and neither
     * is anybody's initials. Present tense and third-person singular are both listed because
     * models write both — `[smile]` and `[smiles]`, `*she smiles*` and `*smiling*`.
     */
    const VERBS = Object.freeze([
        'smile',
        'smiles',
        'smiling',
        'grin',
        'grins',
        'grinning',
        'laugh',
        'laughs',
        'laughing',
        'chuckle',
        'chuckles',
        'giggle',
        'giggles',
        'blush',
        'blushes',
        'blushing',
        'sigh',
        'sighs',
        'sighing',
        'nod',
        'nods',
        'nodding',
        'shrug',
        'shrugs',
        'whisper',
        'whispers',
        'whispering',
        'pause',
        'pauses',
        'pausing',
        'breathe',
        'breathes',
        'breathing',
        'leans',
        'lean',
        'leaning',
        'looks',
        'look',
        'looking',
        'glance',
        'glances',
        'tilts',
        'tilt',
        'winks',
        'wink',
        'softly',
        'quietly',
        'gently',
        'warmly',
    ]);

    /**
     * A recognised direction, and the presence it was asking for.
     *
     * Deliberately the same vocabulary `IntimateExperienceSession._intent` uses, and deliberately
     * none of the adult ceiling's own intents: those map to nsfw-tagged clips, which
     * `UtilityRanker` refuses for any intent the user did not raise, and `proactiveNsfw: false`
     * says she may never initiate one. A model asking for `[leans in]` gets presence, not
     * performance, and a name with no clip in the registry plays nothing — the same fail-soft
     * every other caller gets.
     */
    const PRESENCE = Object.freeze({
        smile: 'smile_soft',
        smiles: 'smile_soft',
        smiling: 'smile_soft',
        grin: 'smile_soft',
        grins: 'smile_soft',
        grinning: 'smile_soft',
        laugh: 'laugh_light',
        laughs: 'laugh_light',
        laughing: 'laugh_light',
        chuckle: 'laugh_light',
        chuckles: 'laugh_light',
        giggle: 'laugh_light',
        giggles: 'laugh_light',
        nod: 'nod_along',
        nods: 'nod_along',
        nodding: 'nod_along',
        sigh: 'breathe',
        sighs: 'breathe',
        sighing: 'breathe',
        breathe: 'breathe',
        breathes: 'breathe',
        breathing: 'breathe',
        pause: 'breathe',
        pauses: 'breathe',
        pausing: 'breathe',
        blush: 'look_away',
        blushes: 'look_away',
        blushing: 'look_away',
        glance: 'look_away',
        glances: 'look_away',
        looks: 'look_at_user',
        look: 'look_at_user',
        looking: 'look_at_user',
        leans: 'lean_in',
        lean: 'lean_in',
        leaning: 'lean_in',
        tilts: 'head_tilt',
        tilt: 'head_tilt',
        shrug: 'shrug',
        shrugs: 'shrug',
    });

    const VERB_SET = new Set(VERBS);

    /**
     * How long a fragment may be and still be a direction.
     *
     * `[she smiles and leans a little closer]` is one; a bracketed paragraph is a person quoting
     * something. The bound is on words rather than characters because it is about grammar, not
     * layout.
     */
    const MAX_WORDS = 8;

    /** The words a direction is allowed to contain besides its verb. */
    const FILLER = new Set([
        'a',
        'an',
        'the',
        'her',
        'his',
        'their',
        'she',
        'he',
        'they',
        'i',
        'you',
        'and',
        'at',
        'in',
        'to',
        'with',
        'little',
        'bit',
        'closer',
        'softly',
        'quietly',
        'gently',
        'warmly',
        'slowly',
        'slightly',
        'away',
        'head',
        'voice',
        'eyes',
        'shoulder',
        'again',
        'once',
        'briefly',
    ]);

    function words(inner) {
        return String(inner || '')
            .toLowerCase()
            .replace(/[^a-z\s'-]/g, ' ')
            .split(/\s+/)
            .filter(Boolean);
    }

    /**
     * Is this fragment a stage direction?
     *
     * Needs a recognised verb, and needs every *other* word to be recognised filler. That second
     * half is what keeps `[smile — the one from the photograph]` out: a fragment containing a verb
     * plus arbitrary prose is prose, and deleting it would delete somebody's sentence.
     */
    function isDirection(inner) {
        const parts = words(inner);
        if (!parts.length || parts.length > MAX_WORDS) return null;
        let verb = null;
        for (const part of parts) {
            if (VERB_SET.has(part)) {
                if (!verb) verb = part;
                continue;
            }
            if (!FILLER.has(part)) return null;
        }
        return verb;
    }

    // `[…]` and `*…*`, the two shapes models reach for. A Markdown link's `[label](url)` is
    // excluded by the lookahead: its label is text, not a direction, and eating it would leave a
    // bare `(url)` behind.
    const BRACKETED = /\[([^\][]{1,80})\](?!\()/g;
    const ASTERISKED = /\*([^*\n]{1,80})\*/g;

    /**
     * Take the directions out, and say which ones they were.
     *
     * Applied to the *display* text at the one seam every consumer reads — the bubble, the
     * transcript, the VR forward and TTS together — which is the same reasoning that puts the
     * `<play>` strip there. Sanitising in the renderer would leave the voice saying "smile".
     */
    function strip(value) {
        const original = String(value == null ? '' : value);
        if (!original) return { text: '', markers: [] };
        const markers = [];
        const take = (match, inner) => {
            const verb = isDirection(inner);
            if (!verb) return match;
            markers.push(verb);
            return '';
        };
        let text = original.replace(BRACKETED, take).replace(ASTERISKED, take);
        if (!markers.length) return { text: original, markers: [] };
        // Removing a fragment leaves the space that was around it, and a leading one leaves the
        // sentence starting with a blank. Tidied without touching newlines: paragraphing is hers.
        text = text
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/[ \t]+([,.!?;:])/g, '$1')
            .replace(/^[ \t]+/gm, '')
            .replace(/[ \t]+$/gm, '')
            .trim();
        return { text, markers };
    }

    /** The presence a marker was asking for, or null for one with no motion behind it. */
    function presenceFor(marker) {
        return PRESENCE[String(marker || '').toLowerCase()] || null;
    }

    /** Every presence a reply asked for, de-duplicated, in the order they appeared. */
    function presenceFrom(markers) {
        const out = [];
        for (const marker of markers || []) {
            const name = presenceFor(marker);
            if (name && !out.includes(name)) out.push(name);
        }
        return out;
    }

    const api = { strip, presenceFor, presenceFrom, VERBS, PRESENCE, MAX_WORDS };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_STAGE_DIRECTIONS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
