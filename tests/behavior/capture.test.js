/**
 * Consent and capture (B11).
 *
 * This batch lands before any consumer, so the tests are mostly about what is *impossible*
 * rather than what works. Four later batches want frames; the claim being bought here is
 * that none of them will be able to get one without going through this machine, and that
 * claim has to survive people who have not read this file.
 *
 * The four acceptance sentences, and where each lives:
 *
 *   * a test asserts the absence of a bypass  → "there is no way around the machine"
 *   * the indicator shows in 2D and in XR     → "the indicator"
 *   * revoking cancels in-flight sampling within a frame → "revocation beats the frame"
 *   * no frames retained client-side          → "nothing is kept"
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const fs = require('fs');
const path = require('path');

const ConsentMachine = require('../../src/features/together/capture/ConsentMachine.js');
const CapturePipeline = require('../../src/features/together/capture/CapturePipeline.js');
const ConsentIndicator = require('../../src/features/together/ui/ConsentIndicator.js');
const TogetherPanel = require('../../src/features/together/ui/TogetherPanel.js');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'behavior.config.json'), 'utf8'));

/** A media track that records whether anybody stopped it. */
class FakeTrack {
    constructor() {
        this.stopped = false;
        this.listeners = {};
    }
    stop() {
        this.stopped = true;
    }
    addEventListener(name, handler) {
        this.listeners[name] = handler;
    }
    removeEventListener(name) {
        delete this.listeners[name];
    }
    /** The user pressing "stop sharing" in the browser's own bar. */
    end() {
        if (this.listeners.ended) this.listeners.ended();
    }
}

class FakeStream {
    constructor() {
        this.track = new FakeTrack();
    }
    getTracks() {
        return [this.track];
    }
}

/** navigator.mediaDevices, as a pair of promises a test can steer. */
function fakeMedia({ grant = true, error } = {}) {
    const calls = [];
    const answer = (kind) => (constraints) => {
        calls.push({ kind, constraints });
        if (error) return Promise.reject(error);
        if (!grant) {
            const denial = new Error('Permission denied');
            denial.name = 'NotAllowedError';
            return Promise.reject(denial);
        }
        return Promise.resolve(new FakeStream());
    };
    return { calls, getDisplayMedia: answer('display'), getUserMedia: answer('user') };
}

/** A canvas that records what it was asked to draw and can be told to encode slowly. */
function fakeCanvas({ onEncode } = {}) {
    const canvas = {
        width: 0,
        height: 0,
        drawn: [],
        cleared: 0,
        getContext: () => ({
            drawImage: (source, x, y, w, h) => canvas.drawn.push({ w, h }),
            clearRect: () => {
                canvas.cleared++;
            },
        }),
        toDataURL: (mime, quality) => {
            canvas.lastQuality = quality;
            if (onEncode) onEncode();
            return `data:${mime};base64,AAAA`;
        },
    };
    return canvas;
}

const fakeSource = (w = 1920, h = 1080) => ({ videoWidth: w, videoHeight: h });

function machine(options = {}) {
    return new ConsentMachine.Machine({ media: fakeMedia(options), config: CONFIG, ...options });
}

async function granted(options = {}) {
    const consent = machine(options);
    const grant = await consent.request(options.source || 'screen');
    return { consent, grant };
}

function pipeline(grant, { canvas = fakeCanvas(), source = fakeSource(), config = CONFIG, now } = {}) {
    return CapturePipeline.fromGrant(grant, {
        config,
        makeCanvas: () => canvas,
        makeSource: () => source,
        now,
    });
}

beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('there is no way around the machine', () => {
    /**
     * The batch's reason for existing, as a source read. Four later batches will want
     * frames; this is what stops any of them from calling the browser directly, and it is
     * deliberately checked against the files rather than the exports, because a bypass gets
     * written by someone who never read the machine.
     */
    test('exactly one engine file names getDisplayMedia or getUserMedia', () => {
        const roots = [path.join(ROOT, 'src', 'behavior'), path.join(ROOT, 'src', 'features')];
        const offenders = [];
        const walk = (dir) => {
            if (!fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir)) {
                const abs = path.join(dir, entry);
                if (fs.statSync(abs).isDirectory()) {
                    walk(abs);
                } else if (entry.endsWith('.js')) {
                    const text = fs.readFileSync(abs, 'utf8');
                    if (/getDisplayMedia|getUserMedia/.test(text)) {
                        offenders.push(path.relative(ROOT, abs).split(path.sep).join('/'));
                    }
                }
            }
        };
        roots.forEach(walk);
        expect(offenders).toEqual(['src/features/together/capture/ConsentMachine.js']);
    });

    test('the pipeline has no way to obtain a stream of its own', () => {
        const source = fs.readFileSync(
            path.join(ROOT, 'src', 'features', 'together', 'capture', 'CapturePipeline.js'),
            'utf8'
        );
        const body = source.slice(source.indexOf('const CapturePipeline'));
        for (const forbidden of ['navigator', 'mediaDevices', 'getDisplayMedia', 'getUserMedia']) {
            expect(`${forbidden}: ${body.includes(forbidden)}`).toBe(`${forbidden}: false`);
        }
    });

    test('a pipeline cannot be constructed without a grant', () => {
        expect(() => CapturePipeline.fromGrant(null)).toThrow(/consent grant/);
        expect(() => CapturePipeline.fromGrant({})).toThrow(/consent grant/);
        expect(() => CapturePipeline.fromGrant({ live: 'yes' })).toThrow(/consent grant/);
    });

    test('a grant is the only object that ever holds a stream', async () => {
        const { grant } = await granted();
        const pipe = pipeline(grant);
        expect(grant.stream).toBeTruthy();
        // The pipeline reads it through the grant and keeps no copy of its own.
        expect(Object.values(pipe).includes(grant.stream)).toBe(false);
    });

    test('the panel never touches a stream either — it asks the machine', async () => {
        const consent = machine();
        const panel = TogetherPanel.attach({ consent, capture: CapturePipeline, config: CONFIG });
        const pipe = await panel.share('screen');
        expect(pipe).toBeTruthy();
        expect(panel.stream).toBeUndefined();
        panel.detach();
    });

    test('nothing about consent is written to storage — a reload starts at idle', async () => {
        const writes = [];
        const store = global.localStorage;
        global.localStorage = { setItem: (k, v) => writes.push([k, v]), getItem: () => null, removeItem: () => {} };
        try {
            const { consent } = await granted();
            expect(consent.state).toBe('active');
            expect(writes).toEqual([]);
            // A fresh machine, as a reload would build, knows nothing.
            expect(machine().state).toBe('idle');
        } finally {
            global.localStorage = store;
        }
    });
});

describe('asking, and being told no', () => {
    test('a grant carries the source and a truthful label', async () => {
        for (const [source, label] of Object.entries(ConsentMachine.LABELS)) {
            const consent = machine();
            const grant = await consent.request(source);
            expect(`${source}: ${grant.label}`).toBe(`${source}: ${label}`);
        }
    });

    test('the three sources are present from the first batch', () => {
        // B15, B23, B26 and B27 are consumers of this one machine; adding one should be a
        // registration rather than surgery here.
        expect(ConsentMachine.SOURCES).toEqual(['screen', 'camera', 'game']);
    });

    test('camera asks getUserMedia; screen and game ask getDisplayMedia', async () => {
        const media = fakeMedia();
        const consent = new ConsentMachine.Machine({ media, config: CONFIG });
        await consent.request('camera');
        await consent.request('screen');
        await consent.request('game');
        expect(media.calls.map((c) => c.kind)).toEqual(['user', 'display', 'display']);
    });

    test('declining resolves to null and leaves nothing active', async () => {
        const consent = machine({ grant: false });
        await expect(consent.request('screen')).resolves.toBe(null);
        expect(consent.state).toBe('denied');
        expect(consent.active).toBe(false);
        expect(consent.reason).toBe('declined');
    });

    test('a platform error is not a decline, and is not a crash either', async () => {
        const consent = machine({ error: new Error('NotFoundError: no display') });
        await expect(consent.request('screen')).resolves.toBe(null);
        expect(consent.reason).not.toBe('declined');
        expect(consent.state).toBe('denied');
    });

    test('an unknown source is refused before any dialog is raised', async () => {
        const media = fakeMedia();
        const consent = new ConsentMachine.Machine({ media, config: CONFIG });
        await expect(consent.request('microphone')).resolves.toBe(null);
        expect(media.calls).toEqual([]);
    });

    test('a platform with no media devices refuses rather than throwing', async () => {
        const consent = new ConsentMachine.Machine({ media: null, config: CONFIG });
        await expect(consent.request('screen')).resolves.toBe(null);
        expect(consent.reason).toContain('no media devices');
    });

    test('asking again while active replaces the first grant, killing it', async () => {
        const consent = machine();
        const first = await consent.request('screen');
        const second = await consent.request('camera');
        expect(first.live).toBe(false);
        expect(second.live).toBe(true);
    });
});

describe('revocation beats the frame', () => {
    test('a grant dies synchronously — no listener, no await', async () => {
        const { consent, grant } = await granted();
        expect(grant.live).toBe(true);
        consent.revoke('test');
        // Same tick. Nothing has been given the chance to run in between.
        expect(grant.live).toBe(false);
    });

    /**
     * The acceptance sentence. The revoke happens *during* the encode, which is the only
     * moment where a naive implementation would already have decided the frame was fine.
     */
    test('a sample already in flight is abandoned and its bytes never surface', async () => {
        const { consent, grant } = await granted();
        const canvas = fakeCanvas({ onEncode: () => consent.revoke('mid-flight') });
        const pipe = pipeline(grant, { canvas });

        await expect(pipe.sample()).resolves.toBe(null);
        expect(pipe.stats.refused.revokedMidFlight).toBe(1);
        expect(pipe.samples).toBe(0);
    });

    test('and the canvas is wiped on the way out, so the frame is not left behind', async () => {
        const { consent, grant } = await granted();
        const canvas = fakeCanvas({ onEncode: () => consent.revoke('mid-flight') });
        const pipe = pipeline(grant, { canvas });
        await pipe.sample();
        expect(canvas.cleared).toBeGreaterThan(0);
    });

    test('sampling after a revoke never reaches the canvas at all', async () => {
        const { consent, grant } = await granted();
        const canvas = fakeCanvas();
        const pipe = pipeline(grant, { canvas });
        consent.revoke('test');

        await expect(pipe.sample()).resolves.toBe(null);
        expect(canvas.drawn).toEqual([]);
        expect(pipe.stats.refused.noConsent).toBe(1);
    });

    test('a running loop stops itself on the next tick without waiting for a timer', async () => {
        jest.useFakeTimers();
        try {
            const { consent, grant } = await granted();
            const pipe = pipeline(grant);
            const frames = [];
            pipe.start((frame) => frames.push(frame));

            consent.revoke('test');
            jest.advanceTimersByTime(10000);
            await Promise.resolve();
            expect(frames).toEqual([]);
        } finally {
            jest.useRealTimers();
        }
    });

    test('the browser bar stopping the share revokes here too', async () => {
        // Otherwise the indicator keeps saying "sharing your screen" after it stopped,
        // which is worse than having no indicator.
        const consent = machine();
        const grant = await consent.request('screen');
        const stream = grant.stream;

        stream.track.end();
        expect(consent.state).toBe('idle');
        expect(grant.live).toBe(false);
    });

    test('revoking stops the tracks rather than leaving the camera light on', async () => {
        const consent = machine();
        const grant = await consent.request('camera');
        const track = grant.stream.track;
        consent.revoke('test');
        expect(track.stopped).toBe(true);
    });

    test('revoking twice is harmless', async () => {
        const { consent } = await granted();
        expect(consent.revoke('once')).toBe(true);
        expect(consent.revoke('twice')).toBe(false);
    });
});

describe('the caps are enforced here, once', () => {
    test('the shipped config is the §6.2 one', () => {
        expect(CONFIG.capture).toEqual({ maxFps: 1, frameLongEdgePx: 512, jpegQuality: 0.7 });
    });

    test('a caller asking for 30 fps gets 1', async () => {
        const { grant } = await granted();
        const pipe = pipeline(grant, { config: { capture: { maxFps: 30 } } });
        expect(pipe.caps.maxFps).toBe(1);
        expect(pipe.minIntervalMs).toBe(1000);
    });

    test('a caller asking for 1080 px gets 512, aspect preserved', async () => {
        const { grant } = await granted();
        const canvas = fakeCanvas();
        const pipe = pipeline(grant, { canvas, config: { capture: { frameLongEdgePx: 1920 } } });
        const frame = await pipe.sample();
        expect(frame.width).toBe(512);
        expect(frame.height).toBe(288);
        expect(canvas.drawn).toEqual([{ w: 512, h: 288 }]);
    });

    test('a caller asking for quality 1.0 gets 0.7', async () => {
        const { grant } = await granted();
        const canvas = fakeCanvas();
        const pipe = pipeline(grant, { canvas, config: { capture: { jpegQuality: 1 } } });
        await pipe.sample();
        expect(canvas.lastQuality).toBe(0.7);
    });

    test('a caller may ask for less', async () => {
        const { grant } = await granted();
        const pipe = pipeline(grant, { config: { capture: { maxFps: 0.5, frameLongEdgePx: 256, jpegQuality: 0.4 } } });
        expect(pipe.caps).toEqual({ maxFps: 0.5, frameLongEdgePx: 256, jpegQuality: 0.4 });
        expect(pipe.minIntervalMs).toBe(2000);
    });

    test('a config typo cannot turn into an unbounded sampler', async () => {
        // maxFps: 0 would be a divide by zero and a negative one would mean "constantly".
        const { grant } = await granted();
        for (const bad of [0, -5, 'lots', null]) {
            const pipe = pipeline(grant, { config: { capture: { maxFps: bad } } });
            expect(`${bad}: ${pipe.minIntervalMs >= 1000}`).toBe(`${bad}: true`);
        }
    });

    test('a portrait source is fitted on its long edge too', async () => {
        const { grant } = await granted();
        const pipe = pipeline(grant, { source: fakeSource(600, 1200) });
        const frame = await pipe.sample();
        expect([frame.width, frame.height]).toEqual([256, 512]);
    });

    test('the rate limit refuses a second sample inside the interval', async () => {
        let clock = 10000;
        const { grant } = await granted();
        const pipe = pipeline(grant, { now: () => clock });

        expect(await pipe.sample()).toBeTruthy();
        expect(await pipe.sample()).toBe(null);
        expect(pipe.stats.refused.tooSoon).toBe(1);

        clock += 1000;
        expect(await pipe.sample()).toBeTruthy();
        expect(pipe.samples).toBe(2);
    });

    test('a source with no size yet yields nothing rather than a 1x1 frame', async () => {
        const { grant } = await granted();
        const pipe = pipeline(grant, { source: fakeSource(0, 0) });
        expect(await pipe.sample()).toBe(null);
    });
});

describe('nothing is kept', () => {
    test('the pipeline holds no frame after handing one over', async () => {
        let clock = 0;
        const { grant } = await granted();
        const pipe = pipeline(grant, { now: () => clock });

        for (let i = 0; i < 5; i++) {
            clock += 1000;
            expect(await pipe.sample()).toBeTruthy();
        }
        expect(pipe.samples).toBe(5);

        // Whatever the pipeline is holding, none of it is image bytes.
        const held = JSON.stringify(Object.entries(pipe).filter(([k]) => k !== 'grant'));
        expect(held).not.toContain('base64');
        expect(held).not.toContain('data:image');
    });

    test('the canvas is cleared after every sample, not only the last', async () => {
        let clock = 0;
        const { grant } = await granted();
        const canvas = fakeCanvas();
        const pipe = pipeline(grant, { canvas, now: () => clock });
        for (let i = 0; i < 3; i++) {
            clock += 1000;
            await pipe.sample();
        }
        expect(canvas.cleared).toBe(3);
    });

    test('stopping releases the canvas rather than leaving it allocated', async () => {
        const { grant } = await granted();
        const canvas = fakeCanvas();
        const pipe = pipeline(grant, { canvas });
        await pipe.sample();
        pipe.stop();
        expect(canvas.width).toBe(0);
        expect(canvas.height).toBe(0);
        expect(await pipe.sample()).toBe(null);
    });
});

describe('the indicator', () => {
    /** A minimal DOM and a minimal three.js — enough to prove both halves render. */
    function surfaces() {
        const appended = [];
        const doc = {
            body: {
                appendChild: (el) => appended.push(el),
                removeChild: (el) => appended.splice(appended.indexOf(el), 1),
            },
            createElement: () => ({
                style: {},
                attributes: {},
                setAttribute(name, value) {
                    this.attributes[name] = value;
                },
                appendChild() {},
                get parentNode() {
                    return appended.includes(this) ? doc.body : null;
                },
            }),
        };
        const added = [];
        const camera = {
            add: (mesh) => added.push(mesh),
            remove: (mesh) => added.splice(added.indexOf(mesh), 1),
        };
        const disposed = [];
        const three = {
            PlaneGeometry: class {
                dispose() {
                    disposed.push('geometry');
                }
            },
            MeshBasicMaterial: class {
                constructor(options) {
                    Object.assign(this, options);
                }
                dispose() {
                    disposed.push('material');
                }
            },
            Mesh: class {
                constructor(geometry, material) {
                    this.geometry = geometry;
                    this.material = material;
                    this.position = { set: (x, y, z) => (this.at = [x, y, z]) };
                    this.parent = camera;
                }
            },
        };
        return { doc, three, viewer: { camera }, appended, added, disposed };
    }

    test('it shows in 2D and in XR at the same moment, from one subscription', async () => {
        const s = surfaces();
        const consent = machine();
        const indicator = ConsentIndicator.attach({ consent, doc: s.doc, three: s.three, viewer: s.viewer });

        expect(indicator.stats.shown).toBe(false);
        expect(s.appended).toHaveLength(0);
        expect(s.added).toHaveLength(0);

        await consent.request('screen');

        expect(indicator.stats).toMatchObject({ shown: true, in2D: true, inXR: true });
        expect(s.appended).toHaveLength(1);
        expect(s.added).toHaveLength(1);
    });

    test('the 2D badge says what is actually being shared', async () => {
        const s = surfaces();
        const consent = machine();
        ConsentIndicator.attach({ consent, doc: s.doc, three: s.three, viewer: s.viewer });
        await consent.request('camera');
        expect(s.appended[0].textContent).toBe('● Camera on');
    });

    test('the badge is announced to a screen reader, not only drawn', async () => {
        const s = surfaces();
        const consent = machine();
        ConsentIndicator.attach({ consent, doc: s.doc, three: s.three, viewer: s.viewer });
        await consent.request('screen');
        expect(s.appended[0].attributes).toEqual({ role: 'status', 'aria-live': 'polite' });
    });

    test('the XR marker rides the camera, so turning around cannot leave it behind', async () => {
        const s = surfaces();
        const consent = machine();
        ConsentIndicator.attach({ consent, doc: s.doc, three: s.three, viewer: s.viewer });
        await consent.request('screen');

        // Parented to the camera, in front of it, and drawn over whatever is in the way.
        expect(s.added[0].at[2]).toBeLessThan(0);
        expect(s.added[0].material.depthTest).toBe(false);
    });

    test('both halves clear on revoke, and the mesh is disposed', async () => {
        const s = surfaces();
        const consent = machine();
        const indicator = ConsentIndicator.attach({ consent, doc: s.doc, three: s.three, viewer: s.viewer });
        await consent.request('screen');
        consent.revoke('test');

        expect(indicator.stats).toMatchObject({ shown: false, in2D: false, inXR: false });
        expect(s.appended).toHaveLength(0);
        expect(s.added).toHaveLength(0);
        expect(s.disposed.sort()).toEqual(['geometry', 'material']);
    });

    test('a headset with no DOM still gets the XR marker', async () => {
        // The 2D half is what an immersive session cannot see; losing it must not take the
        // XR half with it.
        const s = surfaces();
        const consent = machine();
        const indicator = ConsentIndicator.attach({ consent, doc: null, three: s.three, viewer: s.viewer });
        await consent.request('screen');
        expect(indicator.stats).toMatchObject({ shown: true, in2D: false, inXR: true });
    });

    test('a page with no three.js still gets the badge', async () => {
        const s = surfaces();
        const consent = machine();
        const indicator = ConsentIndicator.attach({ consent, doc: s.doc, three: null, viewer: null });
        await consent.request('screen');
        expect(indicator.stats).toMatchObject({ shown: true, in2D: true, inXR: false });
    });

    test('one surface throwing does not stop the other from rendering', async () => {
        const s = surfaces();
        s.doc.createElement = () => {
            throw new Error('DOM is having a moment');
        };
        const consent = machine();
        const indicator = ConsentIndicator.attach({ consent, doc: s.doc, three: s.three, viewer: s.viewer });
        await consent.request('screen');
        expect(indicator.stats.inXR).toBe(true);
    });
});

describe('the panel', () => {
    test('a revoke from anywhere takes the panel pipeline with it', async () => {
        const consent = machine();
        const panel = TogetherPanel.attach({ consent, capture: CapturePipeline, config: CONFIG });
        const pipe = await panel.share('screen');
        expect(panel.stats.sharing).toBe(true);

        consent.revoke('somewhere else');
        expect(panel.pipeline).toBe(null);
        expect(pipe.stopped).toBe(true);
    });

    test('a declined share leaves the panel usable', async () => {
        const consent = machine({ grant: false });
        const panel = TogetherPanel.attach({ consent, capture: CapturePipeline, config: CONFIG });
        await expect(panel.share('screen')).resolves.toBe(null);
        expect(panel.stats).toMatchObject({ sharing: false, activities: [] });
    });

    test('activities are a registration, which is the point of landing this first', () => {
        const consent = machine();
        const panel = TogetherPanel.attach({ consent, capture: CapturePipeline, config: CONFIG });
        expect(panel.register({ id: 'watch', label: 'Watch together' })).toBe(true);
        expect(panel.register({ id: 'music', label: 'Listen together' })).toBe(true);
        expect(panel.stats.activities).toEqual(['watch', 'music']);
        expect(panel.register(null)).toBe(false);
    });
});
