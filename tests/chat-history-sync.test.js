/**
 * The model sees what the person sees (batch M7).
 *
 * From a real session:
 *
 *     YOU    can you dance
 *     NEXUS  It seems you're trying to play a video, but the user has not specified which
 *            video they want to watch...
 *
 * Talking about "the user" in the third person, in reply to a question addressed to her. That
 * is what a model does when the transcript stops looking like a conversation it is part of —
 * and this one had holes in it. `say` drew messages and recorded nothing, so every turn the
 * media interceptor handled was visible on screen and absent from the history:
 *
 *     user       hello there
 *     assistant  Hello! Welcome...
 *     assistant  Playing “Relaxing music…” — url
 *     assistant  Playing “TOP10 LOVE SONGS…” — url
 *     assistant  Playing “New Love Songs 2020…” — url
 *     user       can you dance
 *
 * Three assistant turns in a row with nothing from the user between them, because the cards
 * were recorded and the requests that caused them were not.
 */

window.__NEXUS_YT_ASK_NOAUTO__ = true;
require('../src/features/youtube/YouTubeLink.js');
const Ask = require('../src/features/youtube/YouTubeAsk.js');
const Publisher = require('../src/features/together/ui/ConversationPublisher.js');

/** The app's own history object, in the shape `main.js` builds. */
function history() {
    const messages = [];
    return {
        messages,
        addMessage: (role, content) => messages.push({ role, content }),
    };
}

beforeEach(() => {
    document.body.innerHTML = '<div id="chat-history"></div>';
    window.chatHistory = history();
    delete window.ChatManager;
    window.NEXUS_YT_ASK = Ask;
    window._persistChat = () => {};
});

describe('everything drawn is also remembered', () => {
    test('a user turn the interceptor handled reaches the model', () => {
        Ask.say('play the first one', 'user', document);
        expect(window.chatHistory.messages).toEqual([{ role: 'user', content: 'play the first one' }]);
    });

    test('and so does the app answering it', () => {
        Ask.say('Stopped.', 'bot', document);
        expect(window.chatHistory.messages).toEqual([{ role: 'assistant', content: 'Stopped.' }]);
    });

    test('the transcript alternates, which is what it looked like on screen', () => {
        // The shape that was missing. Three assistant turns in a row is what made her start
        // narrating about "the user".
        Ask.say('search top music about love', 'user', document);
        Ask.say('Here are 4 for “top music about love” — tap one to play it.', 'bot', document);
        Ask.say('play the first one', 'user', document);
        Ask.say('Stopped.', 'bot', document);

        expect(window.chatHistory.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    });

    test('and it is persisted, so an intercepted turn survives a reload', () => {
        let saved = 0;
        window._persistChat = () => (saved += 1);
        Ask.say('stop', 'user', document);
        expect(saved).toBe(1);
    });
});

describe('recorded once, never twice', () => {
    test('a published card is one entry, not two', () => {
        // The publisher used to write its own entry as well. Now that `say` records, doing
        // both would put the card in twice — and a transcript that repeats itself is its own
        // kind of confusion.
        Publisher.publish(
            { id: 'abc', title: 'A song', creator: 'Someone', url: 'https://www.youtube.com/watch?v=abc' },
            { doc: document, win: window }
        );
        const cards = window.chatHistory.messages.filter((m) => /A song/.test(m.content));
        expect(cards).toHaveLength(1);
        expect(cards[0].role).toBe('assistant');
    });

    test('and a page whose ChatManager keeps its own history is left alone', () => {
        // That branch already records. Recording here too would be the duplicate again.
        window.ChatManager = { addMessage: () => {} };
        Ask.say('stop', 'user', document);
        expect(window.chatHistory.messages).toEqual([]);
    });
});

describe('it never costs a message on screen', () => {
    test('no history object at all', () => {
        delete window.chatHistory;
        expect(() => Ask.say('stop', 'user', document)).not.toThrow();
        expect(document.querySelectorAll('.chat-message')).toHaveLength(1);
    });

    test('a history that throws', () => {
        window.chatHistory = {
            addMessage: () => {
                throw new Error('full');
            },
        };
        expect(() => Ask.say('stop', 'user', document)).not.toThrow();
        expect(document.querySelectorAll('.chat-message')).toHaveLength(1);
    });

    test('a persist that throws', () => {
        window._persistChat = () => {
            throw new Error('storage disabled');
        };
        expect(() => Ask.say('stop', 'user', document)).not.toThrow();
        expect(window.chatHistory.messages).toHaveLength(1);
    });
});
