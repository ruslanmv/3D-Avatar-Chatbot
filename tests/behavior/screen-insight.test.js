/**
 * Screen Insight (B15), client side.
 *
 * The server holds the retention proof and the size re-check. What is left here is the
 * consent story around a request that takes seconds: a frame can only come from a live
 * grant, an answer that arrives after consent went is dropped, and the continuous mode
 * §6.13 permits is off unless somebody turns it on.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const ConsentMachine = require('../../src/features/together/capture/ConsentMachine.js');
const CapturePipeline = require('../../src/features/together/capture/CapturePipeline.js');
const Insight = require('../../src/features/together/activities/screen-insight.js');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'behavior.config.json'), 'utf8'));

/** Let the pipeline's own awaits settle. `ask` samples before it posts. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

function fakeMedia({ grant = true } = {}) {
    const stream = { getTracks: () => [{ stop() {}, addEventListener() {}, removeEventListener() {} }] };
    const answer = () => {
        if (grant) return Promise.resolve(stream);
        const denial = new Error('no');
        denial.name = 'NotAllowedError';
        return Promise.reject(denial);
    };
    return { getDisplayMedia: answer, getUserMedia: answer };
}

const fakeCanvas = () => ({
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() {}, clearRect() {} }),
    toDataURL: () => 'data:image/jpeg;base64,SUNTHEPIXELS',
});

const fakeSource = () => ({ videoWidth: 1920, videoHeight: 1080 });

/** An activity wired to fakes, with a steerable endpoint. */
function rig({ grant = true, answer = { text: 'That axis starts at 40.', intents: [] }, fail, hold } = {}) {
    let clock = 100000;
    const bus = new EventBus({});
    const blackboard = new Blackboard({});
    const consent = new ConsentMachine.Machine({ media: fakeMedia({ grant }), config: CONFIG });
    const sent = [];
    const posted = [];
    const seen = [];
    bus.on('intent', (intent) => seen.push(intent));
    bus.on('vision:insight', (payload) => seen.push({ insight: payload }));

    const endpoint = (body, options) => {
        posted.push({ body, options });
        if (fail) return Promise.reject(fail);
        if (hold) return new Promise((resolve) => hold.push(resolve));
        return Promise.resolve(answer);
    };

    const activity = Insight.attach({
        bus,
        blackboard,
        consent,
        capture: CapturePipeline,
        config: CONFIG,
        session: { sendUserEvent: (name) => sent.push(name) },
        endpoint,
        now: () => clock,
    });
    // The pipeline's own canvas and video are injected the same way B11's tests do it.
    const origFrom = CapturePipeline.fromGrant;
    activity.capture = {
        fromGrant: (g, options) =>
            origFrom(g, { ...options, makeCanvas: fakeCanvas, makeSource: fakeSource, now: () => clock }),
    };

    return { activity, bus, blackboard, consent, sent, posted, seen, at: () => clock, advance: (ms) => (clock += ms) };
}

beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ── it cannot get a frame on its own ─────────────────────────────────────────

describe('the frame comes from a grant or not at all', () => {
    test('this file names no browser capture API and builds no canvas', () => {
        const body = codeOf(
            fs.readFileSync(path.join(ROOT, 'src', 'features', 'together', 'activities', 'screen-insight.js'), 'utf8')
        );
        for (const forbidden of ['getDisplayMedia', 'getUserMedia', 'navigator', 'createElement', 'toDataURL']) {
            expect(`${forbidden}: ${body.includes(forbidden)}`).toBe(`${forbidden}: false`);
        }
    });

    test('asking before sharing sends nothing', async () => {
        const r = rig();
        await expect(r.activity.ask('what is this?')).resolves.toBe(null);
        expect(r.posted).toEqual([]);
        expect(r.activity.stats.dropped.noConsent).toBe(1);
    });

    test('a declined share leaves the activity usable and silent', async () => {
        const r = rig({ grant: false });
        await expect(r.activity.start()).resolves.toBe(null);
        await expect(r.activity.ask('?')).resolves.toBe(null);
        expect(r.posted).toEqual([]);
    });

    test('sharing tells the server, because §6.14 gates on the client consent state', async () => {
        const r = rig();
        await r.activity.start();
        expect(r.sent).toEqual(['capture:start']);
        r.activity.stop();
        expect(r.sent).toEqual(['capture:start', 'capture:stop']);
    });

    test('a revoke from anywhere stops the activity too', async () => {
        const r = rig();
        await r.activity.start();
        expect(r.activity.sharing).toBe(true);

        r.consent.revoke('the browser bar');
        expect(r.activity.sharing).toBe(false);
        expect(r.activity.pipeline).toBe(null);
        await expect(r.activity.ask('?')).resolves.toBe(null);
    });
});

// ── the ask ──────────────────────────────────────────────────────────────────

describe('one ask, one answer', () => {
    async function sharing(options) {
        const r = rig(options);
        await r.activity.start();
        return r;
    }

    test('a snapshot goes up as base64, not as a data URL', async () => {
        const r = await sharing();
        await r.activity.ask('what do you think of this?');

        expect(r.posted).toHaveLength(1);
        expect(r.posted[0].body.image_b64).toBe('SUNTHEPIXELS');
        expect(r.posted[0].body.image_b64.startsWith('data:')).toBe(false);
        expect(r.posted[0].body.prompt).toBe('what do you think of this?');
    });

    test('the frame is capped by the pipeline, not by anything here', async () => {
        const r = await sharing();
        // 1920x1080 in, 512 on the long edge out — B11's cap, unchanged.
        const frame = await r.activity.pipeline.sample({ force: true });
        expect([frame.width, frame.height]).toEqual([512, 288]);
    });

    test('context travels with the ask', async () => {
        const r = await sharing();
        r.blackboard.activity = 'watch';
        r.blackboard.scene = 'ocean';
        await r.activity.ask('?');
        expect(r.posted[0].body.ctx).toMatchObject({ activity: 'watch', scene: 'ocean' });
    });

    test('the answer is spoken and its gesture reaches the bus', async () => {
        const r = await sharing({
            answer: { text: 'That y-axis flatters the trend.', intents: [{ name: 'thinking', intensity: 0.5 }] },
        });
        const result = await r.activity.ask('?');

        expect(result.text).toBe('That y-axis flatters the trend.');
        expect(r.seen[0]).toEqual({ name: 'thinking', intensity: 0.5, source: 'vision' });
        expect(r.seen[1].insight.text).toBe('That y-axis flatters the trend.');
    });

    test('the gesture source is vision, so §6.5 still holds against it', async () => {
        const r = await sharing({ answer: { text: 'hm', intents: [{ name: 'flirt', intensity: 1 }] } });
        await r.activity.ask('?');
        expect(r.seen[0].source).toBe('vision');
        expect(r.seen[0].source).not.toBe('user');
    });

    test('the whitelist is checked again on arrival, server check notwithstanding', async () => {
        const r = await sharing({ answer: { text: 'ok', intents: [{ name: 'undress', intensity: 1 }] } });
        const result = await r.activity.ask('?');

        expect(result.intents).toEqual([]);
        expect(r.seen.filter((e) => e.name)).toEqual([]);
        expect(r.activity.stats.dropped.notWhitelisted).toBe(1);
    });

    test('a failed round trip is a refusal, not a crash', async () => {
        const r = await sharing({ fail: new Error('HTTP 502') });
        await expect(r.activity.ask('?')).resolves.toBe(null);
        expect(r.activity.stats.dropped.failed).toBe(1);
        // And the activity is still sharing, so a second ask can work.
        expect(r.activity.sharing).toBe(true);
    });

    test('a malformed answer is dropped rather than spoken', async () => {
        const r = await sharing({ answer: { intents: [] } });
        await expect(r.activity.ask('?')).resolves.toBe(null);
        expect(r.activity.stats.dropped.failed).toBe(1);
    });

    test('asking twice in a second asks once', async () => {
        const r = await sharing();
        await r.activity.ask('?');
        await expect(r.activity.ask('?')).resolves.toBe(null);
        expect(r.posted).toHaveLength(1);
        expect(r.activity.stats.dropped.tooSoon).toBe(1);

        r.advance(Insight.MIN_ASK_GAP_MS);
        await r.activity.ask('?');
        expect(r.posted).toHaveLength(2);
    });

    test('a second ask while one is in flight is refused, not queued', async () => {
        const hold = [];
        const r = await sharing({ hold });
        const first = r.activity.ask('?');
        await flush();
        r.advance(Insight.MIN_ASK_GAP_MS + 1);

        await expect(r.activity.ask('?')).resolves.toBe(null);
        expect(r.posted).toHaveLength(1);

        hold[0]({ text: 'done', intents: [] });
        await first;
    });

    test('the request carries a deadline, so a silent model does not hang the ask', async () => {
        const r = await sharing();
        await r.activity.ask('?');
        expect(r.posted[0].options.timeoutMs).toBe(Insight.ASK_TIMEOUT_MS);
    });
});

// ── consent during the round trip ────────────────────────────────────────────

describe('consent can go while the model is thinking', () => {
    /**
     * The case the batch exists to get right. The frame was captured legitimately, the
     * request is in flight, and then the user stops sharing. An insight about a screen you
     * have stopped sharing is not one you agreed to, however far along it was.
     */
    test('an answer that lands after a revoke is dropped', async () => {
        const hold = [];
        const r = rig({ hold });
        await r.activity.start();

        const pending = r.activity.ask('what is this?');
        await flush();
        expect(r.posted).toHaveLength(1);

        r.consent.revoke('changed my mind');
        hold[0]({ text: 'It is your bank statement.', intents: [{ name: 'surprised', intensity: 1 }] });

        await expect(pending).resolves.toBe(null);
        expect(r.activity.stats.dropped.revokedMidFlight).toBe(1);
        // Nothing was spoken and nothing reached the bus.
        expect(r.seen).toEqual([]);
        expect(r.activity.stats.answers).toBe(0);
    });

    test('and one that lands while consent holds is delivered', async () => {
        const hold = [];
        const r = rig({ hold });
        await r.activity.start();

        const pending = r.activity.ask('?');
        await flush();
        hold[0]({ text: 'A bar chart.', intents: [] });

        await expect(pending).resolves.toMatchObject({ text: 'A bar chart.' });
        expect(r.activity.stats.answers).toBe(1);
    });

    test('revoking mid-flight also stops the pipeline, so no further frame is taken', async () => {
        const hold = [];
        const r = rig({ hold });
        await r.activity.start();
        const pipeline = r.activity.pipeline;

        const pending = r.activity.ask('?');
        await flush();
        r.consent.revoke('mid-flight');
        hold[0]({ text: 'x', intents: [] });
        await pending;

        expect(pipeline.stopped).toBe(true);
        expect(await pipeline.sample({ force: true })).toBe(null);
    });
});

// ── on demand by default ─────────────────────────────────────────────────────

describe('on demand by default', () => {
    test('nothing watches until somebody starts it', async () => {
        const r = rig();
        await r.activity.start();
        expect(r.activity.stats.watching).toBe(false);

        jest.useFakeTimers();
        try {
            jest.advanceTimersByTime(60000);
            expect(r.posted).toEqual([]);
        } finally {
            jest.useRealTimers();
        }
    });

    test('the continuous mode exists and is capped at one frame a second', async () => {
        jest.useFakeTimers();
        try {
            const r = rig();
            await r.activity.start();
            r.activity.startWatching(() => {}, { intervalMs: 50 });

            expect(r.activity.stats.watching).toBe(true);
            // §6.13's ceiling wins over the interval a caller asked for.
            jest.advanceTimersByTime(900);
            expect(r.posted.length).toBeLessThanOrEqual(1);
            r.activity.stopWatching();
        } finally {
            jest.useRealTimers();
        }
    });

    test('stopping the share stops the watching with it', async () => {
        jest.useFakeTimers();
        try {
            const r = rig();
            await r.activity.start();
            r.activity.startWatching(() => {});
            r.activity.stop();
            expect(r.activity.stats.watching).toBe(false);
        } finally {
            jest.useRealTimers();
        }
    });

    test('the config ships the §6.2 caps this relies on', () => {
        expect(CONFIG.capture).toEqual({ maxFps: 1, frameLongEdgePx: 512, jpegQuality: 0.7 });
    });
});
