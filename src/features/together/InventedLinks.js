/**
 * She does not know any URLs, so she must not write any (batch T8).
 *
 * Observed against the real gateway, in a chat where Together was on:
 *
 *     YOU    suggest me a music
 *     NEXUS  Here's another great one for you! 🎶 Playing "Ed Sheeran - Perfect" —
 *            https://www.youtube.com/watch?v=2Vv-BfVoq4g
 *
 * Nothing played, and the link was written by the model. It has never searched YouTube and
 * has no way to know a video ID; it produced eleven plausible characters because eleven
 * plausible characters are what a YouTube URL looks like. It may resolve to that song, to
 * something unrelated, or to nothing — and the user has no way to tell which, because the
 * message is indistinguishable from the app's own card.
 *
 * That is a fabricated record presented as a real one, which is a worse failure than the
 * apology T2 removed and worse than the silent no-op T8's backstop fixes. So there are two
 * defences, and this is the second one:
 *
 *   1. The prompt tells her never to write a URL or name a specific track as found.
 *   2. This strips one if she writes it anyway.
 *
 * The instruction alone is not enough. It is a request to a model that had already been told
 * to emit a tag and did not; a guarantee about what reaches the user cannot rest on the model
 * choosing to comply.
 *
 * ## Why stripping is right rather than heavy-handed
 *
 * There is no case where a media link she typed is trustworthy. She cannot look one up, so
 * every one is a guess — including when the user explicitly asks for a link, which is exactly
 * when a confident wrong answer does the most damage. The app's own card, published by
 * `ConversationPublisher` from a real search result, is the only place a media URL is a fact.
 *
 * What is *not* stripped: ordinary links to anything else. This is about media platforms she
 * is expected to search and cannot, not about the web.
 *
 * Exposes: window.NEXUS_INVENTED_LINKS
 */
(function (global) {
    'use strict';

    /**
     * Media-platform URLs, in the forms a model writes them.
     *
     * Bare `youtube.com/watch?v=…` with no scheme is included because that is how models
     * often write them, and a user's client may still linkify it.
     */
    const MEDIA_URL =
        /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?\S*|shorts\/\S+|embed\/\S+)|youtu\.be\/\S+|open\.spotify\.com\/\S+|soundcloud\.com\/\S+)/gi;

    /**
     * The app's own card, written by the model.
     *
     * `ConversationPublisher` posts a card as its own message, in one of two sentences, with
     * the title of a result a real search returned. Those messages are in the transcript, so
     * they are in the model's context, and it learned to write them:
     *
     *     NEXUS  Playing some cool jazz for you! 🎶 Search isn't set up here yet, so here's a
     *            sample instead — “The Beatles — Here Comes the Sun”
     *
     * There is no Beatles track in the samples. The whole sentence is invented, and it is
     * dressed in the app's own voice — which makes it the most convincing fabrication the
     * model can produce, because it is indistinguishable from the one message on screen the
     * user has every reason to trust.
     *
     * A real card never arrives inside a reply; it is always a separate message posted by the
     * app. So an occurrence here is fabricated by construction, and can be removed without
     * needing to judge whether this particular one happens to be true.
     *
     * Matched on the quoted title, which is the part the publisher's format actually pins —
     * both curly and straight quotes, because the model uses either.
     */
    const FAKE_CARD =
        /(?:search isn'?t set up[^\n]{0,60}?(?:sample instead)?\s*[—–-]?\s*|playing\s+)[“"'][^”"'\n]{1,140}[”"']/gi;

    /** Punctuation and dashes left stranded once the URL between them is gone. */
    const STRANDED = /\s*[—–-]\s*(?=$|\n)/g;

    /**
     * Remove any media URL the model wrote.
     *
     * Returns the text and how many were taken out, so a caller can tell "nothing to do" —
     * which is almost every reply — from "she invented one", and act differently.
     */
    function strip(text) {
        const source = String(text === null || text === undefined ? '' : text);
        let removed = 0;
        const cleaned = source
            .replace(MEDIA_URL, () => {
                removed += 1;
                return '';
            })
            .replace(FAKE_CARD, () => {
                removed += 1;
                return '';
            })
            .replace(STRANDED, '')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return { text: cleaned, removed };
    }

    /** Whether a reply contains one at all. */
    function has(text) {
        MEDIA_URL.lastIndex = 0;
        return MEDIA_URL.test(String(text === null || text === undefined ? '' : text));
    }

    const api = { MEDIA_URL, FAKE_CARD, strip, has };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_INVENTED_LINKS = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
