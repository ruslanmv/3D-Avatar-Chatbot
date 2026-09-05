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
    function line(result) {
        const title = String((result && result.title) || '').trim();
        return title ? `Playing “${title}”` : 'Here you go';
    }

    /**
     * Put a chosen result into the conversation.
     *
     * Returns the message node, or `null` on a page with no chat — a headset overlay, a test.
     * Never throws: this runs from a click in the launcher, and a failure here must close the
     * panel and leave the app alone rather than taking the click down with it.
     */
    function publish(result, { doc, win } = {}) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const w = win || (typeof window !== 'undefined' ? window : null);
        if (!result || !result.url || !d) {
            return null;
        }
        const A = ask();
        if (!A || typeof A.say !== 'function') {
            return null;
        }

        // `say` writes in whichever shape this page uses — ChatManager where there is one,
        // the `.chat-row > .chat-message > .message-text` `main.js` builds otherwise. Reused
        // rather than reimplemented so there is one answer to "what does a message look
        // like", and it is not this file's.
        const node = A.say(`${line(result)} — ${result.url}`, 'bot', d);

        try {
            // The model's own context, so a follow-up question ("what is this?") is about
            // something she can see she said.
            if (w && w.chatHistory && typeof w.chatHistory.addMessage === 'function') {
                w.chatHistory.addMessage('assistant', `${line(result)} — ${result.url}`);
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
        return node;
    }

    return { publish, line };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_CONVERSATION_PUBLISHER = ConversationPublisher;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConversationPublisher;
}
