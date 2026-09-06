/**
 * Selected is not playing (batch M1).
 *
 * The transcript this exists to fix, from a real session:
 *
 *     NEXUS  Playing “Flying: Relaxing Sleep Music…” — https://youtube.com/watch?v=1ZYbU82GVz4
 *     YOU    play it please
 *     NEXUS  I'm a text-based AI assistant, I don't have the capability to play videos…
 *
 * She was not confused. Choosing a tile in Together published a card and stopped there, and
 * `selected` and `playing` were the same field — so the first message overclaimed, and the
 * second, asked to do the thing she had just claimed to be doing, had nothing to act on.
 */

const Session = require('../src/features/together/MediaSession.js');

const VIDEO = {
    id: '1ZYbU82GVz4',
    provider: 'youtube',
    kind: 'video',
    title: 'Flying: Relaxing Sleep Music',
    creator: 'Soothing Relaxation',
    url: 'https://www.youtube.com/watch?v=1ZYbU82GVz4',
};
const TRACK = { id: 'fJ9rUzIMcZQ', kind: 'music', title: 'Bohemian Rhapsody', creator: 'Queen' };
const RESULTS = [VIDEO, TRACK, { id: 'aaa', kind: 'video', title: 'Third' }];

beforeEach(() => Session.reset());

describe('the distinction the app was missing', () => {
    test('choosing something does not make it playing', () => {
        Session.select(VIDEO);
        expect(Session.status()).toBe('selected');
        expect(Session.isPlaying()).toBe(false);
        expect(Session.current().title).toBe('Flying: Relaxing Sleep Music');
    });

    test('asking for playback does not make it playing either', () => {
        // Everything between the request and the player's first event is time in which the
        // browser may refuse, the network may stall, or the user may change their mind.
        Session.requestPlay(VIDEO);
        expect(Session.status()).toBe('loading');
        expect(Session.isPlaying()).toBe(false);
    });

    test('only the player saying so makes it playing', () => {
        Session.requestPlay(VIDEO);
        Session.markPlaying();
        expect(Session.status()).toBe('playing');
        expect(Session.isPlaying()).toBe(true);
    });

    test('and a browser that refuses is its own state, not an error', () => {
        // Nothing is broken: the page has not earned the right to make noise yet. The copy
        // that goes with this is "tap Play", not "something went wrong".
        Session.requestPlay(VIDEO);
        Session.markBlocked();
        expect(Session.status()).toBe('blocked');
        expect(Session.isPlaying()).toBe(false);
    });
});

describe('what "the first one" means', () => {
    test('results are held, and holding them is not choosing', () => {
        Session.setResults(RESULTS);
        expect(Session.status()).toBe('results');
        expect(Session.results()).toHaveLength(3);
        expect(Session.current()).toBeNull();
    });

    test('by position', () => {
        Session.setResults(RESULTS);
        Session.selectIndex(1);
        expect(Session.current().title).toBe('Bohemian Rhapsody');
        expect(Session.get().selectedIndex).toBe(1);
    });

    test('out of range picks nothing rather than the nearest thing', () => {
        Session.setResults(RESULTS);
        expect(Session.selectIndex(9)).toBeNull();
        expect(Session.selectIndex(-1)).toBeNull();
        expect(Session.current()).toBeNull();
    });

    test.each([['x'], [null], [undefined], [1.5], [NaN], [''], [[]], [true], [{}]])(
        'and %s is not a position',
        (bad) => {
            // `Number(null)`, `Number('')` and `Number([])` are all 0, so a loose check here
            // turns "nothing" into "the first one" — and plays something nobody asked for.
            Session.setResults(RESULTS);
            expect(Session.selectIndex(bad)).toBeNull();
            expect(Session.current()).toBeNull();
        }
    );

    test('a new search clears the old choice index', () => {
        Session.setResults(RESULTS);
        Session.selectIndex(0);
        Session.setResults([TRACK]);
        expect(Session.get().selectedIndex).toBeNull();
    });

    test('an empty search is idle, not results', () => {
        Session.setResults([]);
        expect(Session.status()).toBe('idle');
    });

    test('choosing something from the held list records where it was', () => {
        Session.setResults(RESULTS);
        Session.select(TRACK);
        expect(Session.get().selectedIndex).toBe(1);
    });

    test('and choosing something that is not in the list records no position', () => {
        Session.setResults(RESULTS);
        Session.select({ id: 'zzz', kind: 'video', title: 'Elsewhere' });
        expect(Session.get().selectedIndex).toBeNull();
    });
});

describe('stopping is not forgetting', () => {
    test('what we just listened to still has an answer', () => {
        // "What did we just listen to?" is a real question, and it is asked after the music
        // has stopped by definition.
        Session.requestPlay(TRACK);
        Session.markPlaying();
        Session.stop();
        expect(Session.status()).toBe('selected');
        expect(Session.current().title).toBe('Bohemian Rhapsody');
    });

    test('only an explicit clear takes it away', () => {
        Session.select(TRACK);
        Session.clear();
        expect(Session.current()).toBeNull();
        expect(Session.status()).toBe('idle');
    });

    test('clearing with results still held goes back to results', () => {
        Session.setResults(RESULTS);
        Session.selectIndex(0);
        Session.clear();
        expect(Session.status()).toBe('results');
    });

    test('ended is remembered as ended, not as stopped', () => {
        Session.requestPlay(TRACK);
        Session.markEnded();
        expect(Session.status()).toBe('ended');
    });
});

describe('nothing can claim playback with nothing chosen', () => {
    test.each([['markPlaying'], ['markPaused'], ['markEnded'], ['markBlocked'], ['stop']])(
        '%s does nothing on an empty session',
        (method) => {
            Session[method]();
            expect(Session.status()).toBe('idle');
            expect(Session.current()).toBeNull();
        }
    );

    test('and requesting playback of nothing is not loading', () => {
        Session.requestPlay(null);
        expect(Session.status()).toBe('idle');
    });
});

describe('it announces changes, because other things need to know', () => {
    test('listeners hear the reason and the state', () => {
        const seen = [];
        Session.onChange((d) => seen.push([d.reason, d.state.status]));
        Session.select(VIDEO);
        Session.requestPlay();
        Session.markPlaying();
        expect(seen).toEqual([
            ['select', 'selected'],
            ['request-play', 'loading'],
            ['playing', 'playing'],
        ]);
    });

    test('the document hears it too, for anything not holding a reference', () => {
        const seen = [];
        document.addEventListener(Session.EVENT, (e) => seen.push(e.detail.state.status));
        Session.select(VIDEO);
        expect(seen).toEqual(['selected']);
    });

    test('unsubscribing works', () => {
        const seen = [];
        const stop = Session.onChange((d) => seen.push(d.reason));
        stop();
        Session.select(VIDEO);
        expect(seen).toEqual([]);
    });

    test('one throwing listener does not stop the others', () => {
        const seen = [];
        Session.onChange(() => {
            throw new Error('bad listener');
        });
        Session.onChange(() => seen.push('ok'));
        Session.select(VIDEO);
        expect(seen).toEqual(['ok']);
    });
});

describe('a caller cannot edit the session by holding a reference', () => {
    test('the snapshot is a copy', () => {
        Session.select(VIDEO);
        const snap = Session.get();
        snap.current.title = 'Something else';
        snap.status = 'playing';
        expect(Session.current().title).toBe('Flying: Relaxing Sleep Music');
        expect(Session.status()).toBe('selected');
    });

    test('so is the results list', () => {
        Session.setResults(RESULTS);
        Session.results()[0].title = 'Tampered';
        expect(Session.results()[0].title).toBe('Flying: Relaxing Sleep Music');
    });
});

describe('the mode follows what was chosen', () => {
    test('a track is music', () => {
        Session.select(TRACK);
        expect(Session.get().mode).toBe('music');
    });

    test('a video is watch', () => {
        Session.select(VIDEO);
        expect(Session.get().mode).toBe('watch');
    });
});
