/**
 * What a found track is *called* on screen, as opposed to what the provider filed it under.
 *
 * A YouTube title is a search-engine artefact before it is a name. The two the soundtrack
 * strip actually shipped:
 *
 *     ♫ Relaxing Chill Music – Stress Relief Lounge Music | Background Music
 *     ♫ Epic Motivational and Cinematic Inspirational Music | Force - by AShamaluevMusic (Full Album)
 *
 * Both are one short name followed by the keywords the uploader needed to be found for. The
 * strip is a single ellipsised line, so the keywords are what survives and the name is what
 * gets cut — the reader is shown the part that was written for a crawler and denied the part
 * that was written for them.
 *
 * So this module does not "shorten" a title. It removes the three things that are reliably
 * not part of the name, and leaves everything else alone:
 *
 *   1. bracketed decoration whose contents are production noise — `(Full Album)`,
 *      `[Official Video]`, `【4K】`. A bracket with real content, `(feat. Somebody)`, stays.
 *   2. a trailing attribution — `- by AShamaluevMusic` — which is the creator, not the title,
 *      and which the strip already has its own line for.
 *   3. every segment after the first, when the separator is one people only use to append
 *      keywords: `|`, an en or em dash, `·`.
 *
 * What it deliberately does not touch is the hyphen in `Beethoven - Moonlight Sonata` and the
 * comma in `Clair de Lune, Debussy`. Those separate an artist from a piece rather than a name
 * from its keywords, and a rule that cut them would throw away the half that matters. The
 * cost of being conservative there is a title that is occasionally longer than ideal; the
 * cost of being clever is a title that is occasionally wrong, and only one of those is
 * recoverable by the reader.
 *
 * Every function returns something renderable. A title made entirely of noise falls back to
 * the original string rather than to an empty line, because a strip that says `♫` and nothing
 * else looks broken in a way that a long title does not.
 *
 * Exposes: window.NEXUS_MEDIA_TITLE
 */
(function (global) {
    'use strict';

    /** Anything a title should never carry into the DOM: C0 controls and DEL. */
    // eslint-disable-next-line no-control-regex
    const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

    /** How long a display title may get before it is cut with an ellipsis. */
    const MAX = 72;

    /**
     * Bracket contents that are production noise rather than part of the name.
     *
     * Matched against the *whole* bracket body, so `(Official Video)` goes and
     * `(Official Video for My Sister)` stays — the second is a sentence, and a rule that ate
     * it would be guessing.
     */
    const NOISE_BRACKET =
        /^(?:(?:official|full|original|extended|uncut)\s+)?(?:music\s+)?(?:video|audio|album|version|mix|visualizer|visualiser|lyrics?|lyric\s+video|soundtrack|hd|hq|uhd|4k|8k|60fps|remaster(?:ed)?(?:\s+\d{4})?|free|copyright\s*free|no\s+copyright|royalty[-\s]*free|live|loop(?:ed)?|\d+\s*(?:hour|hr|minute|min|sec)s?(?:\s+(?:version|loop|mix))?)$/i;

    /** ` - by Somebody`, ` | by Somebody`, ` — by Somebody` at the very end of a title. */
    const TRAILING_BY = /\s*[-–—|·]\s*by\s+([^-–—|·]{1,60})\s*$/i;

    /**
     * The separators that only ever introduce keywords.
     *
     * A plain hyphen is absent on purpose: `Artist - Track` is the single most common shape a
     * music title takes, and splitting on it would keep the artist and discard the track.
     */
    const KEYWORD_SPLIT = /\s+[|–—·]\s+/;

    function str(value) {
        return String(value === undefined || value === null ? '' : value);
    }

    /** Control characters out, runs of whitespace down to one, ends trimmed. */
    function collapse(value) {
        return str(value).replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
    }

    /** Punctuation left dangling once a piece has been cut off the end. */
    function tidyEdges(value) {
        return collapse(value)
            .replace(/^[\s\-–—|·:,.]+/, '')
            .replace(/[\s\-–—|·:,]+$/, '')
            .trim();
    }

    /**
     * Remove `(…)`, `[…]` and `【…】` groups whose body is production noise.
     *
     * Nested brackets are not handled and do not need to be — this is a title, not a grammar.
     */
    function stripNoiseBrackets(value) {
        return str(value).replace(/[([【]\s*([^()[\]【】]{0,40})\s*[)\]】]/g, (whole, body) =>
            NOISE_BRACKET.test(collapse(body)) ? ' ' : whole
        );
    }

    /**
     * Split a trailing attribution off a title.
     *
     * Returns `{ title, creator }`, where `creator` is `''` when the title never carried one.
     */
    function splitAttribution(value) {
        const text = collapse(value);
        const match = text.match(TRAILING_BY);
        if (!match) return { title: text, creator: '' };
        const rest = tidyEdges(text.slice(0, match.index));
        // `by AShamaluevMusic` as the *whole* title is the name of the thing, not an
        // attribution hanging off one. Taking it away would leave nothing to show.
        if (!rest) return { title: text, creator: '' };
        return { title: rest, creator: collapse(match[1]) };
    }

    /** The first keyword-delimited segment, when dropping the rest still leaves a name. */
    function firstSegment(value) {
        const text = collapse(value);
        const parts = text.split(KEYWORD_SPLIT).map(tidyEdges).filter(Boolean);
        if (parts.length < 2) return text;
        const head = parts[0];
        // A leading `NEW`, `HD` or an artist's bare name is a label on the title rather than
        // the title, and keeping only that would be a worse cut than keeping everything.
        const words = head.split(/\s+/).filter(Boolean).length;
        if (words < 2 && head.length < 12) return text;
        return head;
    }

    /** Cut at a word boundary where there is one, so a title never ends mid-word. */
    function cap(value, max) {
        const limit = Number.isFinite(max) && max > 8 ? Math.floor(max) : MAX;
        const text = collapse(value);
        if (text.length <= limit) return text;
        const slice = text.slice(0, limit - 1);
        const space = slice.lastIndexOf(' ');
        const kept = space > limit * 0.5 ? slice.slice(0, space) : slice;
        return `${tidyEdges(kept)}…`;
    }

    /**
     * The name to show for a title, with the keywords taken off.
     *
     * Falls back to the collapsed original whenever the passes between them would leave
     * nothing: an unreadable line is still better than an empty one.
     */
    function clean(value, { max = MAX } = {}) {
        const original = collapse(value);
        if (!original) return '';
        const withoutBrackets = tidyEdges(stripNoiseBrackets(original));
        const withoutAttribution = splitAttribution(withoutBrackets || original).title;
        const head = tidyEdges(firstSegment(withoutAttribution || original));
        return cap(head || original, max);
    }

    /**
     * Everything the soundtrack strip needs to draw one line of copy.
     *
     * The creator already on the result wins over one recovered from the title, because a
     * provider's channel name is a fact and a suffix is an inference.
     */
    function display(result, { max = MAX } = {}) {
        const raw = collapse(result && result.title);
        const fromResult = collapse(result && result.creator);
        const recovered = splitAttribution(tidyEdges(stripNoiseBrackets(raw))).creator;
        return {
            title: clean(raw, { max }),
            creator: fromResult || recovered || '',
            raw,
        };
    }

    const api = { MAX, clean, display, splitAttribution, stripNoiseBrackets, firstSegment, cap };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_MEDIA_TITLE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
