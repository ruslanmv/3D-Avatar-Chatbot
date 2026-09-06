/**
 * Stopping it, and admitting when we cannot hear the player (batch M5).
 *
 * The transcript:
 *
 *     YOU    play a song about relaxation
 *     NEXUS  Playing “Relaxing music Relieves stress…”
 *     YOU    I like this song thank you
 *     NEXUS  ...it looks like the playback hasn't started yet. Please tap the card!
 *
 * It was playing. The IFrame API had never attached, so no PLAYING event arrived, and the
 * app's nine-second backstop concluded "blocked" — asserting a negative from silence, and
 * putting a flat contradiction of the user's own ears into her mouth.
 */

window.__NEXUS_YT_2D_NOAUTO__ = true;
// The embed reads thumbnails and embed URLs off `NEXUS_YT_LINK`; in the page it is a script
// tag loaded before it.
require('../src/features/youtube/YouTubeLink.js');
const Session = require('../src/features/together/MediaSession.js');

// The embed keeps which card is playing in module scope — correctly, since only one plays at
// a time. That makes it shared state between tests, so each one gets a fresh module rather
// than inheriting whatever the last test left active.
let Embed;

const VIDEO = { id: 'I3OJUwILelU', start: 0, name: 'Relaxing music Relieves stress' };

/** A card in the document, as `buildCard` makes it. */
function card() {
    const el = Embed.buildCard(VIDEO, { doc: document });
    document.body.appendChild(el);
    return el;
}

beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    require('../src/features/youtube/YouTubeLink.js');
    Embed = require('../src/features/youtube/YouTubeEmbed2D.js');
    document.body.innerHTML = '';
    Session.reset();
    window.NEXUS_MEDIA_SESSION = Session;
    delete window.NEXUS_YT_PLAYBACK;
});

afterEach(() => {
    jest.useRealTimers();
});

describe('silence is not a refusal', () => {
    test('a player that never reports back leaves the session unconfirmed, not blocked', () => {
        // The exact path of the transcript: the API never attached, so nothing ever spoke.
        const el = card();
        Embed.activate(el, VIDEO);
        expect(Session.status()).toBe('loading');

        jest.advanceTimersByTime(30000);

        expect(Session.status()).toBe('unconfirmed');
        expect(Session.status()).not.toBe('blocked');
    });

    test('and a player that did report keeps what it said', () => {
        const el = card();
        Embed.activate(el, VIDEO);
        Session.markPlaying();

        jest.advanceTimersByTime(30000);

        expect(Session.status()).toBe('playing');
    });

    test('a card replaced before the deadline does not report for the one that left', () => {
        const first = card();
        Embed.activate(first, VIDEO);
        const second = card();
        Embed.activate(second, { ...VIDEO, id: 'OTHER123456' });

        jest.advanceTimersByTime(30000);

        // Whatever it says, it is about the card that is actually on screen.
        expect(Session.current().id).toBe('OTHER123456');
    });
});

describe('stopping it', () => {
    /** A card whose player answers, as the IFrame API's would. */
    function playing() {
        const el = card();
        Embed.activate(el, VIDEO);
        const calls = [];
        el._nexusPlayback = {
            pause: () => (calls.push('pause'), true),
            resume: () => (calls.push('resume'), true),
            stopVideo: () => (calls.push('stop'), true),
            stop: () => calls.push('destroy'),
        };
        return { el, calls };
    }

    test('stop silences the player and leaves the card where it is', () => {
        // They asked for it to stop, not for it to disappear — and "what did we just listen
        // to?" is a question asked after the music stops, by definition.
        const { el, calls } = playing();

        expect(Embed.control('stop')).toBe(true);

        expect(calls).toEqual(['stop']);
        expect(el.isConnected).toBe(true);
        expect(Session.status()).toBe('selected');
        expect(Session.current().id).toBe('I3OJUwILelU');
    });

    test('pause and resume reach the player', () => {
        const { calls } = playing();
        expect(Embed.control('pause')).toBe(true);
        expect(Embed.control('resume')).toBe(true);
        expect(calls).toEqual(['pause', 'resume']);
    });

    test('with no player to talk to, stop still stops it', () => {
        // The `unconfirmed` situation again: no handle, and somebody still wants silence.
        // Collapsing the iframe is cruder and it definitely works.
        const el = card();
        Embed.activate(el, VIDEO);
        expect(el.querySelector('.nexus-yt-player')).not.toBeNull();

        expect(Embed.control('stop')).toBe(true);

        expect(el.querySelector('.nexus-yt-player')).toBeNull();
    });

    test('but pause without a player does nothing, and says so', () => {
        // There is no crude equivalent of pause, and claiming to have paused something would
        // be the same lie in a new place.
        const el = card();
        Embed.activate(el, VIDEO);
        expect(Embed.control('pause')).toBe(false);
    });

    test('and with nothing playing at all, every command is a no', () => {
        for (const move of ['stop', 'pause', 'resume']) {
            expect(Embed.control(move)).toBe(false);
        }
    });
});
