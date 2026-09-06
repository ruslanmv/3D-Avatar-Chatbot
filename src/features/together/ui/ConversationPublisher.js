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

        // M7. The transcript entry used to be written here as well as by `say`. `say` now
        // records everything it draws — that is what stopped intercepted turns being invisible
        // to the model — so writing it again here would put the card in twice, and a
        // transcript that repeats itself is its own kind of confusion.
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
            start(result, node, w);
        }
        return node;
    }

    /**
     * Actually start it, in the same tick.
     *
     * The first version polled: publish, wait 120 ms, look for the card, synthesise a click,
     * retry for four seconds. It worked, and it was the wrong shape for one reason that
     * matters more than the tidiness — **user activation**. A browser will only let a page
     * make noise on its own for a short window after a real tap, and a `setTimeout` chain
     * spends that window waiting. So the path most likely to be allowed to play, a finger
     * landing on a Together row, was the path that threw the permission away.
     *
     * Doing it synchronously keeps the tap and the playback in one event chain. It also
     * removes a real bug the polling had: `querySelector` searched the whole document, so a
     * card for the same video further up the conversation would be found and started instead
     * of the one just published.
     *
     * The embed is asked to decorate this node specifically, which turns the URL in the
     * message into a card; then the card is activated. If either step is unavailable the
     * message still stands with its link, and the observer that watches the chat will build
     * the card a moment later exactly as it always has — the user just has to press it.
     */
    function start(result, node, w) {
        const id = String((result && result.id) || '').trim();
        const embed = w && w.NEXUS_YT_2D;
        if (!id || !node || !embed || typeof embed.activate !== 'function') {
            return false;
        }
        try {
            if (typeof embed.decorateLive === 'function') {
                embed.decorateLive(node);
            }
            // Scoped to the node just published. The old whole-document lookup would happily
            // start an older card for the same video sitting further up the conversation.
            const card = node.querySelector(`.nexus-yt-card[data-yt-id="${id}"]`);
            if (!card) {
                return false;
            }
            embed.activate(card, { id, start: Number(result.start) || 0, name: result.title || '' });
            return true;
        } catch (_) {
            // A card that will not start is not a reason to lose the message it came with.
            return false;
        }
    }

    return { publish, line, start };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_CONVERSATION_PUBLISHER = ConversationPublisher;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConversationPublisher;
}
