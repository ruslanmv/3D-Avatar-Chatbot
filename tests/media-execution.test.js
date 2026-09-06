/**
 * The function named `play` did not play (batch M4).
 *
 *     YOU    execute relaxation music, choose the best one you think is good for me,
 *            and I want to listen
 *     NEXUS  I'd be happy to help with that! I'll put on some calming music for you.
 *     NEXUS  I found “10 Hours of Relaxing Music…” — tap it to play
 *
 * Every layer above did its job. The model understood, chose search terms and emitted the
 * directive; the directive reached `fulfil`; `fulfil` searched, picked one, and called
 * `play()`. And `play()` published a card and stopped — because the publisher only starts
 * playback when told to, and nothing told it. The one function in the app whose name is the
 * verb was the single place the verb was not carried out.
 */

const Intent = require('../src/features/together/MediaIntent.js');
const Session = require('../src/features/together/MediaSession.js');

const RESULT = {
    id: '8WVXk0Gz66E',
    provider: 'youtube',
    kind: 'music',
    title: '10 Hours of Relaxing Music',
    creator: 'Soothing Relaxation',
    url: 'https://www.youtube.com/watch?v=8WVXk0Gz66E',
};

let published;

beforeEach(() => {
    published = [];
    Session.reset();
    window.NEXUS_MEDIA_SESSION = Session;
    window.NEXUS_CONVERSATION_PUBLISHER = {
        publish: (result, options) => {
            published.push({ result, options });
            return {};
        },
    };
    window.NEXUS_DISCOVERY = {
        warm: async () => [],
        forCapability: () => ({ search: async () => [RESULT] }),
        why: () => 'ok',
    };
    window.NEXUS_TOGETHER_SWITCH = { isOn: () => true };
});

describe('the transcript this batch exists for', () => {
    test('play() asks the publisher to actually start it', () => {
        Intent.play(RESULT, 'model');
        expect(published).toHaveLength(1);
        expect(published[0].options.play).toBe(true);
    });

    test('and the whole route from a model directive ends in playback', async () => {
        const out = await Intent.fulfil({ query: 'calm relaxing piano', kind: 'music', source: 'model' });
        expect(out.ok).toBe(true);
        expect(published).toHaveLength(1);
        expect(published[0].options.play).toBe(true);
        expect(published[0].result.title).toBe('10 Hours of Relaxing Music');
    });

    test('the session is told before the card is published', () => {
        // Anything reading state in the same tick — the prompt among them — must not see a
        // stale `selected` while a card that is starting sits on screen.
        const seen = [];
        window.NEXUS_CONVERSATION_PUBLISHER = {
            publish: () => {
                seen.push(Session.status());
                return {};
            },
        };
        Intent.play(RESULT, 'model');
        expect(seen).toEqual(['loading']);
    });

    test('and it names what is playing, so "what is this?" has an answer', () => {
        Intent.play(RESULT, 'model');
        expect(Session.current().title).toBe('10 Hours of Relaxing Music');
    });
});

describe('it still degrades rather than throwing', () => {
    test('no publisher: nothing plays, nothing breaks', () => {
        delete window.NEXUS_CONVERSATION_PUBLISHER;
        expect(() => Intent.play(RESULT, 'model')).not.toThrow();
        expect(Intent.play(RESULT, 'model')).toBeNull();
    });

    test('no session: it still publishes and still plays', () => {
        // The session is bookkeeping. Playback is the point, and it must not depend on it.
        delete window.NEXUS_MEDIA_SESSION;
        Intent.play(RESULT, 'model');
        expect(published[0].options.play).toBe(true);
    });

    test('a session that throws does not stop the card', () => {
        // Writing this test found the flaw it now guards: the session call and the publish
        // shared one `try`, so a broken session swallowed the playback too. Asserting "does
        // not throw" alone would have passed that — the card has to actually arrive.
        window.NEXUS_MEDIA_SESSION = {
            requestPlay: () => {
                throw new Error('broken');
            },
        };
        expect(() => Intent.play(RESULT, 'model')).not.toThrow();
        expect(published).toHaveLength(1);
        expect(published[0].options.play).toBe(true);
    });
});
