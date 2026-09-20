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
        // Added deliberately, the way the header prescribes: `*leans in slightly, watching*` is a
        // direction and `watch` is a thing a body does.
        'watch',
        'watches',
        'watching',
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
        watch: 'look_at_user',
        watches: 'look_at_user',
        watching: 'look_at_user',
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
     * Nouns that happen to end in `-ly`, so the adverb rule below cannot swallow a sentence.
     *
     * Short on purpose: it only has to cover words that could plausibly sit beside a performance
     * verb inside eight words. `only` is the one that matters — "the only one" is a phrase this
     * codebase already had to special-case once, in `PrivateChoices.BANNED`.
     */
    const LY_NOT_ADVERBS = new Set([
        'only',
        'family',
        'reply',
        'supply',
        'apply',
        'assembly',
        'belly',
        'jelly',
        'rally',
        'ally',
        'folly',
        'lily',
        'july',
        'italy',
        'anomaly',
        'monopoly',
    ]);

    /**
     * An adverb modifying the verb is part of the direction (P22).
     *
     * `FILLER` listed six adverbs — `softly`, `quietly`, `gently`, `warmly`, `slowly`, `slightly` —
     * and the reported session leaked `*tilts head, smiling faintly*` and `*shrugs easily*` onto
     * the screen and into the voice, because `faintly` and `easily` were not among them. Adding two
     * more words would have fixed those two and nothing else; the next adverb would leak next week.
     *
     * So the rule is the grammar rather than the vocabulary: a word ending in `-ly`, in a fragment
     * that already contains a recognised performance verb, is modifying that verb. The allowlist's
     * real protection is unchanged — there must still *be* a verb, every other word must still be
     * recognised, and the whole thing must still be under eight words — so `[smile — the one from
     * the family]` is refused by `one` and `from` long before `family` is reached.
     */
    function looksAdverbial(part) {
        return part.length >= 5 && part.endsWith('ly') && !LY_NOT_ADVERBS.has(part);
    }

    /**
     * Is this fragment a stage direction?
     *
     * Needs a recognised verb, and needs every *other* word to be recognised filler or an adverb
     * modifying it. That second half is what keeps `[smile — the one from the photograph]` out: a
     * fragment containing a verb plus arbitrary prose is prose, and deleting it would delete
     * somebody's sentence.
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
            if (!FILLER.has(part) && !looksAdverbial(part)) return null;
        }
        return verb;
    }

    /**
     * The labelled form — `[[emote: lean_in thinking]]` — which is a different shape entirely (P21).
     *
     * Reported from a Private session at Sensual, on screen and in the voice:
     *
     *     HER  [[emote: lean_in thinking]] I'd love to dive deeper into some interesting topics…
     *
     * The allowlist above could never catch it. `isDirection` splits the inner text into words and
     * requires every one to be a performance verb or filler, and the first word here is `emote` —
     * a *label*, not a thing a body does. So the fragment failed the test, stayed in the line, and
     * the synthesiser read the brackets out.
     *
     * Worse than a leak: the model was asking for `lean_in`, which is one of the three intents
     * Private is allowed to emit. The marker was correct and we both showed it and ignored it.
     *
     * Deliberately its own pattern rather than adding `emote` to `VERBS`. The allowlist's rule is
     * "every word inside is something a body does", and that rule is what keeps `[sic]` and `[1]`
     * safe; loosening it to admit a label would admit far more. This matches the *syntax* — a
     * known label, a colon, a payload — so `[emote: anything]` is recognised by its shape and the
     * payload is then checked separately.
     */
    const EMOTE =
        /\[{1,2}\s*(?:emote|emotion|action|gesture|motion|anim|animation|expression)\s*[:=]\s*([^\][\n]{1,60})\]{1,2}/gi;

    /**
     * Every motion name the app can act on, so a payload can be recognised as one directly.
     *
     * `lean_in` is not an English verb and never will be in `VERBS`; it is the name of an intent.
     * A model that writes the intent name has done exactly the right thing, and this is what lets
     * that count.
     */
    const INTENTS = new Set([...Object.values(PRESENCE), 'lean_in', 'nod_along', 'breathe']);

    /** `lean-in`, `Lean In`, `LEAN_IN` are one name. */
    function intentName(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, '_')
            .replace(/[^a-z_]/g, '');
    }

    /**
     * What a labelled payload was asking for, or null.
     *
     * Two ways to be right: the payload names an intent (`lean_in`), or its first word is a verb
     * the allowlist already knows (`smiling`). Anything else strips the marker — it is markup
     * either way and must not reach the screen — but asks for no movement, because forwarding an
     * unrecognised name would be this file guessing at the animation registry's vocabulary.
     */
    function emoteIntent(payload) {
        const whole = intentName(payload);
        if (INTENTS.has(whole)) return whole;
        for (const part of words(payload)) {
            if (VERB_SET.has(part)) return part;
            if (INTENTS.has(part)) return part;
        }
        return '';
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
        // The labelled form first, because `[[emote: …]]` contains a `[…]` the next pattern would
        // otherwise match and reject, leaving the outer brackets behind as `[]`.
        let text = original.replace(EMOTE, (match, payload) => {
            const intent = emoteIntent(payload);
            // Stripped either way: an unrecognised payload is still markup, and markup on screen
            // is the defect. Only the *movement* depends on recognising it.
            if (intent) markers.push(intent);
            else markers.push('');
            return '';
        });
        text = text.replace(BRACKETED, take).replace(ASTERISKED, take);
        if (!markers.length) return { text: original, markers: [] };
        // An unrecognised payload pushed an empty marker to force the tidy below; it is not a
        // marker anybody should receive.
        for (let i = markers.length - 1; i >= 0; i -= 1) {
            if (!markers[i]) markers.splice(i, 1);
        }
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

    /**
     * The presence a marker was asking for, or null for one with no motion behind it.
     *
     * A marker may be a verb the allowlist mapped (`smiling` → `smile_soft`) or an intent name the
     * labelled form supplied directly (`lean_in`). The second is an identity: a model that named
     * the intent asked for it exactly, and mapping it through a verb table would only be a chance
     * to lose it.
     */
    function presenceFor(marker) {
        const name = String(marker || '').toLowerCase();
        if (PRESENCE[name]) return PRESENCE[name];
        return INTENTS.has(intentName(name)) ? intentName(name) : null;
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

    const api = { strip, presenceFor, presenceFrom, VERBS, PRESENCE, INTENTS, MAX_WORDS };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_STAGE_DIRECTIONS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
