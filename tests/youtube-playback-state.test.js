/**
 * What the player is actually doing (batch M2).
 *
 * Before this, the app could only ever report what it had *asked* for: `activate()` swapped a
 * thumbnail for an iframe and called the card playing. The iframe is a cross-origin document,
 * so nothing on the page could contradict it — including when the browser had refused to make
 * any sound at all.
 */

const Playback = require('../src/features/youtube/YouTubePlaybackAdapter.js');
const Session = require('../src/features/together/MediaSession.js');
const Link = require('../src/features/youtube/YouTubeLink.js');

/** A stand-in for YouTube's IFrame API, which cannot be loaded in a test. */
function fakeYT() {
    const players = [];
    return {
        players,
        PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 },
        // Not method shorthand: a concise method is not a constructor, and the real API is
        // used as `new YT.Player(...)`. Shorthand here would throw where the real one works.
        // eslint-disable-next-line object-shorthand
        Player: function (frame, config) {
            const self = this;
            self.frame = frame;
            self.destroyed = false;
            self.calls = [];
            self.pauseVideo = () => self.calls.push('pause');
            self.playVideo = () => self.calls.push('play');
            self.stopVideo = () => self.calls.push('stop');
            self.volume = null;
            self.muted = true;
            self.setVolume = (value) => {
                self.volume = value;
                self.calls.push(`volume:${value}`);
            };
            self.unMute = () => {
                self.muted = false;
            };
            self.destroy = () => {
                self.destroyed = true;
            };
            self.ready = () => config.events.onReady({ target: self });
            self.emit = (data) => config.events.onStateChange({ data, target: self });
            players.push(self);
        },
    };
}

beforeEach(() => {
    jest.useFakeTimers();
    Session.reset();
    window.NEXUS_MEDIA_SESSION = Session;
    Session.requestPlay({ id: 'abc12345678', kind: 'video', title: 'Something' });
});

afterEach(() => {
    delete window.YT;
    jest.useRealTimers();
});

describe('the embed has to opt in before anything can be heard', () => {
    test('enablejsapi is off by default, so nothing else changes shape', () => {
        expect(Link.embedUrl('abc12345678')).not.toMatch(/enablejsapi/);
    });

    test('and on when asked for', () => {
        expect(Link.embedUrl('abc12345678', { jsapi: true })).toMatch(/enablejsapi=1/);
    });

    test('the privacy-enhanced host and rel=0 survive either way', () => {
        const url = Link.embedUrl('abc12345678', { jsapi: true });
        expect(url).toMatch(/youtube-nocookie\.com/);
        expect(url).toMatch(/rel=0/);
    });
});

describe('the player states that matter', () => {
    test('PLAYING is the only thing that makes the session playing', async () => {
        window.YT = fakeYT();
        const handle = await Playback.attach(document.createElement('iframe'));
        expect(Session.status()).toBe('loading');

        window.YT.players[0].emit(window.YT.PlayerState.PLAYING);

        expect(Session.status()).toBe('playing');
        expect(handle).not.toBeNull();
    });

    test('PAUSED and ENDED are reported as themselves', async () => {
        window.YT = fakeYT();
        await Playback.attach(document.createElement('iframe'));
        const p = window.YT.players[0];

        p.emit(window.YT.PlayerState.PLAYING);
        p.emit(window.YT.PlayerState.PAUSED);
        expect(Session.status()).toBe('paused');

        p.emit(window.YT.PlayerState.ENDED);
        expect(Session.status()).toBe('ended');
    });

    test('BUFFERING is deliberately nothing', async () => {
        // A moment inside playback, not a state of the session. Reporting it would make the
        // avatar stop and start every time a phone changed cell.
        window.YT = fakeYT();
        await Playback.attach(document.createElement('iframe'));
        const p = window.YT.players[0];
        p.emit(window.YT.PlayerState.PLAYING);
        p.emit(window.YT.PlayerState.BUFFERING);
        expect(Session.status()).toBe('playing');
    });
});

describe('a browser that refuses to make noise', () => {
    test('an unstarted player becomes blocked, not playing', async () => {
        // This is what an autoplay policy looks like from inside the page: the player is
        // ready, was asked to autoplay, and simply never starts.
        window.YT = fakeYT();
        await Playback.attach(document.createElement('iframe'));
        window.YT.players[0].ready();

        jest.advanceTimersByTime(Playback.BLOCKED_AFTER_MS);

        expect(Session.status()).toBe('blocked');
    });

    test('but a player that starts in time is never called blocked', async () => {
        window.YT = fakeYT();
        await Playback.attach(document.createElement('iframe'));
        const p = window.YT.players[0];
        p.ready();
        p.emit(window.YT.PlayerState.PLAYING);

        jest.advanceTimersByTime(Playback.BLOCKED_AFTER_MS * 3);

        expect(Session.status()).toBe('playing');
    });

    test('and a pause before the deadline cancels the verdict too', async () => {
        window.YT = fakeYT();
        await Playback.attach(document.createElement('iframe'));
        const p = window.YT.players[0];
        p.ready();
        p.emit(window.YT.PlayerState.PLAYING);
        p.emit(window.YT.PlayerState.PAUSED);
        jest.advanceTimersByTime(Playback.BLOCKED_AFTER_MS * 2);
        expect(Session.status()).toBe('paused');
    });
});

describe('every failure degrades to what the card did before', () => {
    test('no API available: no handle, and nothing thrown', async () => {
        // The card still plays. The app simply goes back to not knowing, which is where it
        // was — nothing here may be the reason a video does not start.
        delete window.YT;
        const attach = Playback.attach(document.createElement('iframe'));
        jest.advanceTimersByTime(9000);
        await expect(attach).resolves.toBeNull();
    });

    test('no frame at all', async () => {
        await expect(Playback.attach(null)).resolves.toBeNull();
    });

    test('a constructor that throws', async () => {
        window.YT = {
            PlayerState: {},
            // eslint-disable-next-line object-shorthand
            Player: function () {
                throw new Error('bad frame');
            },
        };
        await expect(Playback.attach(document.createElement('iframe'))).resolves.toBeNull();
    });

    test('a session that throws does not stop the state reaching a listener', async () => {
        window.YT = fakeYT();
        window.NEXUS_MEDIA_SESSION = {
            markPlaying: () => {
                throw new Error('session broken');
            },
        };
        const seen = [];
        await Playback.attach(document.createElement('iframe'), { onState: (n) => seen.push(n) });
        window.YT.players[0].emit(window.YT.PlayerState.PLAYING);
        expect(seen).toEqual(['playing']);
    });
});

describe('driving the player you are watching', () => {
    test('pause, resume and stop reach it', async () => {
        window.YT = fakeYT();
        const handle = await Playback.attach(document.createElement('iframe'));
        handle.pause();
        handle.resume();
        handle.stopVideo();
        expect(window.YT.players[0].calls).toEqual(['pause', 'play', 'stop']);
    });

    test('and stopping destroys it, so a dead card reports nothing', async () => {
        window.YT = fakeYT();
        const handle = await Playback.attach(document.createElement('iframe'));
        handle.stop();
        expect(window.YT.players[0].destroyed).toBe(true);
        expect(handle.pause()).toBe(false);
    });
});

describe('how loud it comes in', () => {
    test('a requested volume is applied when the player is ready, not before', async () => {
        window.YT = fakeYT();
        await Playback.attach(document.createElement('iframe'), { volume: 15 });
        const player = window.YT.players[0];

        // `attach` resolves when the player has been *constructed*. Setting the level here
        // would race its initialisation, and the race is audible: a background track that
        // arrives at full volume for a second is worse than one that was never quietened.
        expect(player.volume).toBeNull();

        player.ready();
        expect(player.volume).toBe(15);
        // Autoplay commonly starts muted, so a level set without unmuting is a level nobody
        // can hear.
        expect(player.muted).toBe(false);
    });

    test('no volume asked for means the player is left exactly as it was', async () => {
        window.YT = fakeYT();
        await Playback.attach(document.createElement('iframe'));
        window.YT.players[0].ready();
        expect(window.YT.players[0].volume).toBeNull();
        expect(window.YT.players[0].calls).toEqual([]);
    });

    test('an explicit null is not volume zero', async () => {
        // `activate(card, video)` defaults the option to null and passes it straight down, so
        // this is the path every ordinary card in the app takes. `Number(null)` is 0, and
        // coercing here would have muted every video on the page.
        window.YT = fakeYT();
        await Playback.attach(document.createElement('iframe'), { volume: null });
        window.YT.players[0].ready();
        expect(window.YT.players[0].volume).toBeNull();
        expect(window.YT.players[0].calls).toEqual([]);
    });

    test('a level out of range is clamped rather than refused', async () => {
        window.YT = fakeYT();
        const handle = await Playback.attach(document.createElement('iframe'));
        expect(handle.setVolume(140)).toBe(true);
        expect(window.YT.players[0].volume).toBe(100);
        expect(handle.setVolume(-8)).toBe(true);
        expect(window.YT.players[0].volume).toBe(0);
        expect(handle.setVolume(14.6)).toBe(true);
        expect(window.YT.players[0].volume).toBe(15);
    });

    test('a level that is not a number changes nothing and says so', async () => {
        window.YT = fakeYT();
        const handle = await Playback.attach(document.createElement('iframe'));
        expect(handle.setVolume('loud')).toBe(false);
        expect(handle.setVolume(null)).toBe(false);
        expect(window.YT.players[0].volume).toBeNull();
    });

    test('a player that has gone away reports that it could not be turned down', async () => {
        window.YT = fakeYT();
        const handle = await Playback.attach(document.createElement('iframe'));
        handle.stop();
        expect(handle.setVolume(15)).toBe(false);
    });
});
