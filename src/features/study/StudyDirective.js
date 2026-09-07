/**
 * Reading `<studied>` out of a reply, and never showing it (batch S2).
 *
 * The same shape as `PlayDirective`, deliberately — one parser idiom in this codebase rather
 * than two — and for the same two reasons: the tag has to be acted on, and it must never
 * reach the screen or the speech synthesiser. A tag that reaches the synthesiser is her
 * reading XML aloud in the middle of a lesson.
 *
 * `<studied concept="the idea" verdict="solid">` is self-closing in practice: it marks a
 * judgement she has already made in prose, so there is nothing between an open and a close.
 *
 * Exposes: window.NEXUS_STUDY_DIRECTIVE
 */
(function (global) {
    'use strict';

    /**
     * Tolerant about quoting and attribute order, strict about the two attributes.
     *
     * Models vary the quotes and the spacing, and none of that changes the meaning. What is
     * not tolerated is a tag missing either attribute: a verdict with no concept cannot be
     * recorded, and a concept with no verdict is not a judgement.
     */
    const TAG =
        /<studied\s+(?=[^>]*\bconcept\s*=)(?=[^>]*\bverdict\s*=)[^>]*\bconcept\s*=\s*["']?([^"'>]{1,120})["']?[^>]*\bverdict\s*=\s*["']?(solid|shaky)["']?[^>]*\/?>/i;

    /** The same tag with the attributes the other way round, which models also produce. */
    const TAG_SWAPPED =
        /<studied\s+(?=[^>]*\bconcept\s*=)(?=[^>]*\bverdict\s*=)[^>]*\bverdict\s*=\s*["']?(solid|shaky)["']?[^>]*\bconcept\s*=\s*["']?([^"'>]{1,120})["']?[^>]*\/?>/i;

    /** Any `<studied …>` at all, for stripping — including malformed ones nothing can act on. */
    const ANY = /<studied\b[^>]*>/gi;

    function extract(text) {
        const source = String(text === null || text === undefined ? '' : text);
        let concept = null;
        let verdict = null;

        const direct = source.match(TAG);
        if (direct) {
            concept = direct[1];
            verdict = direct[2];
        } else {
            const swapped = source.match(TAG_SWAPPED);
            if (swapped) {
                verdict = swapped[1];
                concept = swapped[2];
            }
        }

        // Stripped whether or not it parsed. A malformed tag is not actionable, and it is
        // certainly not something to show somebody mid-lesson.
        const clean = source
            .replace(ANY, ' ')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        return {
            clean,
            mark: concept && verdict ? { concept: concept.trim(), verdict: verdict.toLowerCase() } : null,
        };
    }

    /**
     * Extract, record, and return the text to display.
     *
     * The session is told before the reply is shown, so anything reading the state in the same
     * tick — the next prompt among them — already knows what was just settled.
     */
    function consume(text, options = {}) {
        const { clean, mark } = extract(text);
        if (mark) {
            const session = options.session || (global && global.NEXUS_STUDY_SESSION) || null;
            if (session && typeof session.mark === 'function') {
                try {
                    session.mark(mark.concept, mark.verdict);
                } catch (_) {
                    // Losing the record is not worth losing the lesson.
                }
            }
        }
        return clean;
    }

    const api = { TAG, TAG_SWAPPED, ANY, extract, consume };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_STUDY_DIRECTIVE = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
