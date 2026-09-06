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

    /**
     * The other request: show me what there is (batch M6).
     *
     * "Search music about dance" was being answered by playing something, because the only
     * verb the model had was play. Asking to *find* is asking to choose, and answering it by
     * choosing on their behalf takes the choice away — so it gets its own tag, parsed by the
     * same machinery and stripped by the same rules.
     */
    const FIND = /<find(?:\s+kind\s*=\s*["']?([a-z]+)["']?)?\s*>([\s\S]{0,300}?)<\/find\s*>/i;

    /** A tag left unclosed by a truncated reply. Removed from display, never executed. */
    const ORPHAN = /<play(?:\s[^>]{0,80})?>[\s\S]*$/i;

    /**
     * The tag with its angle brackets missing, which a real reply did:
     *
     *     play kind="video" tag="video"
     *
     * That was the whole message. It is not executable — there is no query in it — but it must
     * never be *displayed*, and before T8 it was: the user's answer to "I want to watch a
     * romantic video" was a line of broken markup. Stripped here so the reply falls back to
     * whatever prose surrounds it, and the claim backstop plays what they asked for.
     */
    const BARE = /(?:^|\n)\s*play\s+kind\s*=\s*["'][a-z]+["'][^\n]{0,80}/gi;

    function kindOf(raw) {
        return String(raw || '').toLowerCase() === 'music' ? 'music' : 'video';
    }

    /**
     * @param {string} text an assistant reply
     * @returns {{clean: string, directive: {kind: string, query: string}|null, extra: number}}
     */
    function extract(text) {
        const source = String(text == null ? '' : text);
        // A `<find>` is checked first only so that a reply carrying both does the less
        // destructive thing: showing options can be followed by "play the first one", while
        // playing something cannot be un-played.
        const found = source.match(FIND);
        if (found) {
            const q = String(found[2] || '').trim();
            const clean = source
                .replace(FIND, ' ')
                .replace(ORPHAN, '')
                .replace(BARE, ' ')
                .replace(/[ \t]{2,}/g, ' ')
                .trim();
            return { clean, directive: null, find: q ? { kind: kindOf(found[1]), query: q } : null, extra: 0 };
        }
        const match = source.match(TAG);
        if (!match) {
            // Still strip an unclosed or bracket-less tag: a mangled reply should not end in
            // visible markup, even though there is nothing in it to run.
            const clean = source
                .replace(ORPHAN, '')
                .replace(BARE, ' ')
                .replace(/[ \t]{2,}/g, ' ')
                .trim();
            return { clean, directive: null, find: null, extra: 0 };
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
            .replace(BARE, ' ')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();

        return {
            clean,
            directive: query ? { kind: kindOf(match[1]), query } : null,
            find: null,
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
        const extracted = extract(text);
        const directive = extracted.directive;
        const find = extracted.find;
        // T8. Take out any media URL she wrote before anything downstream can show it. She has
        // never searched, so a link she produced is eleven plausible characters, not a fact —
        // and once it is in the bubble it is indistinguishable from the app's real card.
        const links = options.links || (global && global.NEXUS_INVENTED_LINKS) || null;
        let clean = extracted.clean;
        if (links && typeof links.strip === 'function') {
            try {
                clean = links.strip(clean).text;
            } catch (_) {
                // Never lose the reply over a tidy-up.
            }
        }
        if (find) {
            // M6. Show them what there is. Not awaited, for the same reason a play is not:
            // the sentence should appear when she says it, not after a search round trip.
            const intent = options.intent || (global && global.NEXUS_MEDIA_INTENT) || null;
            if (intent && typeof intent.list === 'function') {
                try {
                    Promise.resolve(intent.list({ query: find.query, kind: find.kind, source: 'model' })).catch(
                        () => null
                    );
                } catch (_) {
                    // A search that cannot run must not take the reply down with it.
                }
            }
            return clean;
        }

        if (!directive) {
            // T8. No tag — but she may have said she was playing something anyway, and a reply
            // that claims to act and then does not is worse than the apology T2 removed.
            // `honour` returns false for every reply that made no claim, which is nearly all
            // of them, so the common path is one regex and out.
            const claim = options.claim || (global && global.NEXUS_PLAY_CLAIM) || null;
            if (claim && typeof claim.honour === 'function') {
                try {
                    claim.honour(clean, options);
                } catch (_) {
                    // A backstop is not worth losing the reply over.
                }
            }
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

    const api = { TAG, FIND, BARE, extract, has, consume };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_PLAY_DIRECTIVE = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
