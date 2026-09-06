/**
 * Handing chosen media to the conversation (batch D4).
 *
 * The rule this file exists to keep: **Together is where you choose; the conversation is
 * where the thing lives.** A player owned by the launcher disappears when the launcher
 * closes, cannot be scrolled back to, and is gone on reload — so what Together does with a
 * selection is not "play it" but "say it", as an ordinary assistant message.
 *
 * ## Why the URL goes in the message text
 *
 * `addMessageToHistory(sender, text, attachments)` accepts attachments, and `_persistChat`
 * saves this and nothing else:
 *
 *     const text = msg.querySelector('.message-text')?.textContent || '';
 *
 * Attachments are dropped. A structured attachment would render once and lose its card on the
 * next reload, with nothing to say why. The canonical watch URL inside the text costs nothing,
 * persists for free, and is decorated on restore by the observer that already decorates every
 * other YouTube link — so a video chosen in Together and one pasted by hand become the same
 * kind of message. One renderer, one history model, one playback implementation.
 *
 * ## Nothing here plays anything
 *
 * The card arrives as a facade: thumbnail, title, play button, no iframe. Playback begins when
 * somebody presses play. Selecting a search result is not consent to make noise, and neither
 * is restoring a conversation that contains one.
 *
 * Exposes: window.NEXUS_CONVERSATION_PUBLISHER
 */
const ConversationPublisher = (() => {
    'use strict';

    function ask() {
        return (typeof window !== 'undefined' && window.NEXUS_YT_ASK) || null;
    }

    /** What she says above the card. The title in quotes, because it is what you picked. */
    /**
     * What the card says it is doing.
     *
     * A sample gets a different sentence, and that is not decoration. With no YouTube key
     * configured the app cannot search, so it plays the one keyless sample it ships — which
     * has nothing to do with what was asked for. Announcing that as `Playing “…”` told the
     * user their request had been fulfilled when it had not: someone asking for a romantic
     * video was shown a video about autonomous agents, phrased as though it were the answer.
     *
     * Saying so costs one clause and turns a wrong answer into an honest one, with the fix
     * named. The media still plays — there is something to watch either way — but nobody is
     * misled about what they are looking at.
     */
    function line(result, { play = false } = {}) {
        const title = String((result && result.title) || '').trim();
        // M1. "Playing" was a lie on every path but this one. Publishing a card puts a
        // thumbnail on screen; it starts nothing. The transcript that made this obvious:
        //
        //     NEXUS  Playing “Flying: Relaxing Sleep Music…”
        //     YOU    play it please
        //     NEXUS  I don't have the capability to play videos…
        //
        // She was not confused. She had been told a card was published and reported it as
        // playback, and then had nothing to act on when asked to do the thing she had just
        // claimed to be doing. So the word now depends on what was actually asked for.
        if (!play && !(result && result.sample)) {
            return title ? `I found “${title}” — tap it to play` : 'I found something — tap it to play';
        }
        if (result && result.sample) {
            return title
                ? `Search isn't set up here yet, so here's a sample instead — “${title}”`
                : "Search isn't set up here yet, so here's a sample instead";
        }
        return title ? `Playing “${title}”` : 'Here you go';
    }

    /**
     * Put a chosen result into the conversation.
     *
     * Returns the message node, or `null` on a page with no chat — a headset overlay, a test.
     * Never throws: this runs from a click in the launcher, and a failure here must close the
     * panel and leave the app alone rather than taking the click down with it.
     */
    function publish(result, { doc, win, play = false } = {}) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const w = win || (typeof window !== 'undefined' ? window : null);
        if (!result || !result.url || !d) {
            return null;
        }
        const A = ask();
        if (!A || typeof A.say !== 'function') {
            return null;
        }

        // D9. Before the message, so a model answering the very next turn already knows.
        // Guarded: an install without the context module publishes exactly as it did before.
        try {
            const media = w && w.NEXUS_CURRENT_MEDIA;
            if (media && typeof media.set === 'function') {
                media.set(result);
            }
        } catch (_) {
            // Knowing what is playing is never worth losing the card over.
        }

        // `say` writes in whichever shape this page uses — ChatManager where there is one,
        // the `.chat-row > .chat-message > .message-text` `main.js` builds otherwise. Reused
        // rather than reimplemented so there is one answer to "what does a message look
        // like", and it is not this file's.
        const node = A.say(`${line(result, { play })} — ${result.url}`, 'bot', d);

        try {
            // The model's own context, so a follow-up question ("what is this?") is about
            // something she can see she said.
            if (w && w.chatHistory && typeof w.chatHistory.addMessage === 'function') {
                w.chatHistory.addMessage('assistant', `${line(result, { play })} — ${result.url}`);
            }
        } catch (_) {
            // A full history is not a reason to lose the card.
        }
        try {
            // The same function the app calls after its own messages. Without it the card is
            // there until reload and then silently is not.
            if (w && typeof w._persistChat === 'function') {
                w._persistChat();
            }
        } catch (_) {
            // Storage full or disabled. The card is live either way.
        }

        if (play) {
            start(result, d, w);
        }
        return node;
    }

    /**
     * Actually start it — the step ▶ Play adds and choosing never had.
     *
     * The card is built by `YouTubeEmbed2D` when it scans the message, which happens after
     * `say` returns, so there is nothing to press yet at this point. Rather than reach into
     * the embed's internals or guess at a delay, this waits for the card carrying this id to
     * appear and clicks its facade — the same thing a finger does, through the same code path,
     * so playback, the collapse button and the session reporting all behave identically
     * whether a person or the app started it.
     *
     * Gives up quietly after a short window. A card that never arrived means the message had
     * no embeddable link in it, and the published line still stands with its URL.
     */
    function start(result, d, w) {
        const id = String((result && result.id) || '').trim();
        if (!id || !d || !w || typeof w.setTimeout !== 'function') {
            return false;
        }
        const deadline = 4000;
        const step = 120;
        let waited = 0;
        const tick = () => {
            let facade = null;
            try {
                const card = d.querySelector(`.nexus-yt-card[data-yt-id="${id}"]`);
                facade = card ? card.querySelector('.nexus-yt-facade') : null;
            } catch (_) {
                return;
            }
            if (facade && typeof facade.click === 'function') {
                try {
                    facade.click();
                } catch (_) {
                    /* a card that went away mid-wait is not a failure worth reporting */
                }
                return;
            }
            waited += step;
            if (waited < deadline) {
                w.setTimeout(tick, step);
            }
        };
        w.setTimeout(tick, step);
        return true;
    }

    return { publish, line, start };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_CONVERSATION_PUBLISHER = ConversationPublisher;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConversationPublisher;
}
