/**
 * Dancing to a shared tab (batch D7).
 *
 * D5 says plainly that she will not dance to YouTube, because its player is a cross-origin
 * iframe and `createMediaElementSource` cannot reach across that boundary. This is the one
 * way round that is not a hack: a *tab* share already carries the tab's audio —
 * `ConsentMachine.request('screen')` asks for `getDisplayMedia({ video, audio: true })` — so
 * the sound is already in a stream the user deliberately shared.
 *
 * Three claims, and the middle one is the one somebody would notice within a second:
 *
 *   * **it asks for nothing.** No `getDisplayMedia`, no call into the consent machine. It is
 *     handed a grant or it does nothing;
 *   * **it never routes the captured audio to the speakers.** The tab is already audible;
 *     a second path would play everything twice, slightly apart;
 *   * **stopping the dancing does not stop the share.** The stream belongs to whoever
 *     requested it.
 */

const fs = require('fs');
const path = require('path');

const TabAudio = require('../src/features/together/activities/mediaTabAudioSource.js');

const SOURCE = path.join(__dirname, '..', 'src/features/together/activities/mediaTabAudioSource.js');
const codeOf = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** A WebAudio stand-in that records what got connected to what. */
function fakeWin({ throwOn } = {}) {
    const connections = [];
    const destination = { id: 'destination' };
    const context = {
        state: 'suspended',
        destination,
        closed: false,
        resume: jest.fn(() => Promise.resolve()),
        close: jest.fn(function () {
            this.closed = true;
        }),
        createMediaStreamSource: jest.fn(() => {
            if (throwOn === 'source') throw new Error('no source');
            return { connect: (to) => connections.push(['source', to]) };
        }),
        createAnalyser: jest.fn(() => ({
            fftSize: 0,
            connect: (to) => connections.push(['analyser', to]),
        })),
    };
    return {
        win: {
            AudioContext: function () {
                return context;
            },
        },
        context,
        connections,
        destination,
    };
}

function grant({ audio = 1 } = {}) {
    const tracks = Array.from({ length: audio }, (_, i) => ({ id: `a${i}`, stop: jest.fn() }));
    return { stream: { getAudioTracks: () => tracks, getVideoTracks: () => [{ stop: jest.fn() }] }, tracks };
}

// ── it asks for nothing ─────────────────────────────────────────────────────

describe('one door stays one door', () => {
    test('the file names no capture API and no consent machine', () => {
        const code = codeOf(fs.readFileSync(SOURCE, 'utf8'));
        expect(/getDisplayMedia|getUserMedia/.test(code)).toBe(false);
        expect(/consent/i.test(code)).toBe(false);
    });
});

// ── the graph ───────────────────────────────────────────────────────────────

describe('the graph', () => {
    test('analyses the share without playing it again', () => {
        // The echo this prevents is immediate and obvious: the tab plays, and so does a copy
        // a fraction of a second behind it.
        const { win, connections, destination } = fakeWin();
        const opened = TabAudio.open(grant(), { win });
        expect(opened.ok).toBe(true);
        expect(connections).toContainEqual(['source', expect.anything()]);
        expect(connections.some(([, to]) => to === destination)).toBe(false);
    });

    test('gives the detector the FFT size it reads', () => {
        const { win } = fakeWin();
        expect(TabAudio.open(grant(), { win }).analyser.fftSize).toBe(TabAudio.FFT_SIZE);
    });

    test('resumes a context that started suspended', async () => {
        const { win, context } = fakeWin();
        await TabAudio.open(grant(), { win }).started;
        expect(context.resume).toHaveBeenCalled();
    });

    test('stopping closes the context and leaves the share alone', () => {
        const { win, context } = fakeWin();
        const g = grant();
        TabAudio.open(g, { win }).stop();
        expect(context.close).toHaveBeenCalled();
        // Ending somebody's video because they turned the dancing off would be a strange bug
        // to debug: the share dies and nothing says why.
        for (const track of g.tracks) {
            expect(track.stop).not.toHaveBeenCalled();
        }
    });

    test('a graph that cannot be built closes its context rather than leaking it', () => {
        const { win, context } = fakeWin({ throwOn: 'source' });
        expect(TabAudio.open(grant(), { win }).ok).toBe(false);
        expect(context.close).toHaveBeenCalled();
    });
});

// ── what it says when it cannot ─────────────────────────────────────────────

describe('why it cannot listen', () => {
    test('a share with no sound names the checkbox that fixes it', () => {
        // The common case, and not a fault: Chrome offers tab audio unticked by default, and
        // a whole-screen share has none at all on most platforms.
        const { win } = fakeWin();
        const out = TabAudio.availability(grant({ audio: 0 }), { win });
        expect(out.ok).toBe(false);
        expect(out.why).toMatch(/Share tab audio/i);
    });

    test('nothing shared at all is a different sentence', () => {
        const { win } = fakeWin();
        expect(TabAudio.availability(null, { win }).why).toMatch(/Nothing is being shared/i);
    });

    test('a browser without Web Audio says so before anything else', () => {
        expect(TabAudio.availability(grant(), { win: {} }).why).toMatch(/Web Audio/i);
    });

    test('no sentence is ever a stack trace', () => {
        const { win } = fakeWin();
        for (const g of [null, grant({ audio: 0 })]) {
            expect(TabAudio.availability(g, { win }).why).not.toMatch(/Error|undefined|null/);
        }
    });
});

// ── attaching to Music ──────────────────────────────────────────────────────

describe('equipping Music', () => {
    function music() {
        return {
            start: () => {},
            detector: { analyser: null },
            detachSource: jest.fn(function () {
                this.analyser = null;
                return true;
            }),
        };
    }

    test('hands the detector the analyser it has always read', () => {
        const { win } = fakeWin();
        const m = TabAudio.equip(music(), { win });
        expect(m.attachStream(grant(), { name: 'Shared tab' })).toMatchObject({ ok: true });
        expect(m.detector.analyser).toBe(m.analyser);
        expect(m.trackName).toBe('Shared tab');
    });

    test('detaches whatever was playing first, so only one source is ever live', () => {
        // The analyser is a single field. Two sources writing it is a race nobody can see.
        const { win } = fakeWin();
        const m = TabAudio.equip(music(), { win });
        m.attachStream(grant());
        expect(m.detachSource).toHaveBeenCalled();
    });

    test('a silent share leaves the previous source detached rather than half-attached', () => {
        const { win } = fakeWin();
        const m = TabAudio.equip(music(), { win });
        const out = m.attachStream(grant({ audio: 0 }));
        expect(out.ok).toBe(false);
        expect(m.analyser).toBeFalsy();
        expect(m.detector.analyser).toBeNull();
    });

    test('equipping twice does not replace the method', () => {
        const { win } = fakeWin();
        const m = TabAudio.equip(music(), { win });
        const first = m.attachStream;
        expect(TabAudio.equip(m, { win }).attachStream).toBe(first);
    });

    test('something that is not Music is left alone', () => {
        expect(TabAudio.equip({}, {})).toBeNull();
        expect(TabAudio.equip(null, {})).toBeNull();
    });
});
