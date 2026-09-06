/**
 * Reading `<play>` out of a reply, and never showing it (batch T5).
 *
 * T2 tells her she can play media by writing a tag. This is the half that makes the tag do
 * something — and, just as importantly, the half that makes sure nobody ever sees it.
 *
 *     Here's something calm. <play kind="music">ambient rain sounds</play>
 *              ↓ displayed and spoken            ↓ executed, never displayed
 *     "Here's something calm."                   fulfil({ query: 'ambient rain sounds' })
 *
 * ## Three rules, and each of them is a failure that would otherwise happen
 *
 * **Strip before display *and* before speech.** A tag that reaches the screen is ugly; a tag
 * that reaches the speech synthesiser is her reading XML aloud. They are separate code paths in
 * this app, so "strip it" has to mean both or it means neither.
 *
 * **At most one per reply.** T2 asks for one. A model that emits three would otherwise start
 * three things, and the last would win after two flashes of something else — an instruction is
 * not a guarantee, so the guarantee lives here.
 *
 * **Only from the model.** `extract` is called on assistant replies and nowhere else. A user
 * who types the tag themselves gets it treated as text, because a chat message is not a
 * capability and letting typed input reach `fulfil` through this path would make it one.
 *
 * Exposes: window.NEXUS_PLAY_DIRECTIVE
 */
(function (global) {
    'use strict';

    /**
     * Deliberately tolerant about the attribute and strict about the shape.
     *
     * Models vary the quoting, the spacing, and whether the attribute is there at all — none of
     * which changes the intent. What is not tolerated is an unclosed tag, which would otherwise
     * swallow the rest of the reply into a search query.
     */
    const TAG = /<play(?:\s+kind\s*=\s*["']?([a-z]+)["']?)?\s*>([\s\S]{0,300}?)<\/play\s*>/i;

    /** A tag left unclosed by a truncated reply. Removed from display, never executed. */
    const ORPHAN = /<play(?:\s[^>]{0,80})?>[\s\S]*$/i;

    function kindOf(raw) {
        return String(raw || '').toLowerCase() === 'music' ? 'music' : 'video';
    }

    /**
     * @param {string} text an assistant reply
     * @returns {{clean: string, directive: {kind: string, query: string}|null, extra: number}}
     */
    function extract(text) {
        const source = String(text == null ? '' : text);
        const match = source.match(TAG);
        if (!match) {
            // Still strip an unclosed tag: a truncated reply should not end in visible markup.
            const clean = source.replace(ORPHAN, '').trim();
            return { clean, directive: null, extra: 0 };
        }

        const query = String(match[2] || '').trim();
        // Everything after the first tag is stripped too, so a second directive cannot be
        // displayed *or* run. One request, one thing playing.
        let clean = source.replace(TAG, ' ');
        let extra = 0;
        while (TAG.test(clean)) {
            clean = clean.replace(TAG, ' ');
            extra += 1;
        }
        clean = clean
            .replace(ORPHAN, '')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();

        return {
            clean,
            directive: query ? { kind: kindOf(match[1]), query } : null,
            extra,
        };
    }

    /** Whether a reply carries one at all — cheap, for a caller that wants to branch first. */
    function has(text) {
        return TAG.test(String(text == null ? '' : text));
    }

    /**
     * Extract, then run it. Returns the text to display.
     *
     * The play is deliberately not awaited: the sentence should appear the moment she says it,
     * not after a search round trip. A failed search leaves the sentence standing, which is the
     * right outcome — she said something true, and the media simply did not arrive.
     */
    function consume(text, options = {}) {
        const { clean, directive } = extract(text);
        if (!directive) {
            return clean;
        }
        const intent = options.intent || (global && global.NEXUS_MEDIA_INTENT) || null;
        if (intent && typeof intent.fulfil === 'function') {
            try {
                Promise.resolve(intent.fulfil({ query: directive.query, kind: directive.kind, source: 'model' })).catch(
                    () => null
                );
            } catch (_) {
                // A directive that cannot run must not take the reply down with it.
            }
        }
        return clean;
    }

    const api = { TAG, extract, has, consume };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_PLAY_DIRECTIVE = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
