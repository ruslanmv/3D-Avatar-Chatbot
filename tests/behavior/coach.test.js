/**
 * Coach mode (B27) — the heaviest activity in the pack.
 *
 * Three acceptance sentences:
 *
 *   * reps from a recorded fixture match ground truth ±1 — driven through the real counter
 *     with the real fixture, which contains the four shapes that actually break rep
 *     counters and whose ground truth is known by construction;
 *   * the demo clip is chosen by intent rather than name — asserted as the absence of any
 *     clip id or filename in the file, plus the positive: the emitted intent resolves in
 *     the shipped KB;
 *   * the frame budget holds with Pose active — measurable here only as the throttle and
 *     the fidget pause; the on-device half is `scripts/audit-budgets.mjs` and the checklist,
 *     and this file says so rather than pretending a laptop is a Quest.
 */

/* global describe, test, expect */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const SceneJourney = require('../../src/features/together/activities/scene-journey.js');
const TogetherProfile = require('../../src/behavior/modes/together.profile.js');
const RepCounter = require('../../src/features/together/heuristics/RepCounter.js');
const Coach = require('../../src/features/together/activities/coach.js');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'src', 'features', 'together', 'activities', 'coach.js');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/pose/squat-set.json'), 'utf8'));
const MANIFEST = fs
    .readFileSync(path.join(ROOT, 'kb/animations.manifest.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

// ── the fixture, and the counter ─────────────────────────────────────────────

describe('reps from the recorded set match ground truth', () => {
    function count(exercise = 'squat', samples = FIXTURE.samples) {
        const counter = RepCounter.attach({ exercise, now: () => 0 });
        samples.forEach((value, i) => counter.feed(value, Math.round((i * 1000) / FIXTURE.fps)));
        return counter;
    }

    test('within ±1', () => {
        const counter = count();
        expect(Math.abs(counter.reps - FIXTURE.groundTruth)).toBeLessThanOrEqual(1);
    });

    test('and in fact exactly', () => {
        expect(count().reps).toBe(FIXTURE.groundTruth);
    });

    test('the partial rep does not count, and it is the thresholds that stop it', () => {
        // The most valuable eighty frames in the fixture. Raise `low` above the partial's
        // 118 degrees — a slacker counter — and the same data reads 13.
        expect(count().reps).toBe(12);
        const slack = RepCounter.attach({
            exercise: 'squat',
            spec: { ...RepCounter.EXERCISES.squat, low: 125 },
            now: () => 0,
        });
        FIXTURE.samples.forEach((v, i) => slack.feed(v, Math.round((i * 1000) / FIXTURE.fps)));
        expect(slack.reps).toBe(FIXTURE.groundTruth + 1);
    });

    test('the eight-second pause counts nothing', () => {
        // A midpoint-crossing counter turns standing still into dozens of reps.
        const still = Array.from({ length: 400 }, (_, i) => 172 + Math.sin(i) * 1.5);
        expect(count('squat', still).reps).toBe(0);
    });

    test('the tempo it reports is the median, not the mean', () => {
        // One eight-second pause must not become "the tempo".
        const counter = count();
        expect(counter.tempoMs).toBeGreaterThan(800);
        expect(counter.tempoMs).toBeLessThan(2000);
    });

    test('the fixture says what it is', () => {
        // It is synthesised, and the file admits it in its own field rather than leaving a
        // reader to assume there is a video in this repository.
        expect(FIXTURE.provenance).toMatch(/SYNTHESISED, not recorded/);
        expect(FIXTURE.groundTruth).toBe(12);
        expect(FIXTURE.samples.length).toBeGreaterThan(700);
    });

    test('it is reproducible from its own generator', () => {
        // A fixture that changes between runs is not a fixture.
        expect(FIXTURE.seed).toBe(20260901);
        expect(fs.existsSync(path.join(ROOT, 'scripts/make-pose-fixture.mjs'))).toBe(true);
    });
});

describe('the counter is two thresholds and a refractory period', () => {
    const spec = RepCounter.EXERCISES.squat;

    function drive(values, { exercise = 'squat', step = 50 } = {}) {
        const counter = RepCounter.attach({ exercise, now: () => 0 });
        values.forEach((v, i) => counter.feed(v, i * step));
        return counter;
    }

    test('noise at a single midpoint counts nothing', () => {
        const midpoint = (spec.low + spec.high) / 2;
        const jitter = Array.from({ length: 200 }, (_, i) => midpoint + (i % 2 ? 3 : -3));
        expect(drive(jitter).reps).toBe(0);
    });

    test('a full round trip counts one', () => {
        expect(drive([170, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 170]).reps).toBe(1);
    });

    test('going down alone counts nothing — a rep is the return', () => {
        expect(drive([170, 90, 90, 90]).reps).toBe(0);
    });

    test('a bounce faster than the refractory period is rejected, and counted as rejected', () => {
        // A set that reads 8 when they did 12 needs a reason somewhere.
        const counter = drive([170, 90, 170], { step: 50 });
        expect(counter.reps).toBe(0);
        expect(counter.rejected.tooFast).toBe(1);
    });

    test('an unknown exercise counts nothing rather than guessing a threshold', () => {
        const counter = RepCounter.attach({ exercise: 'breakdancing' });
        expect(counter.ready).toBe(false);
        expect(counter.feed(90, 0)).toBeNull();
        expect(counter.rejected.noSpec).toBe(1);
    });

    test('a missing landmark is not a rep and not a crash', () => {
        const counter = drive([170, NaN, undefined, 90, NaN, 170]);
        // Only the three finite readings are samples; the gaps are not zeroes.
        expect(counter.samples).toBe(3);
        expect(counter.reps).toBe(0);
    });

    test('reset clears the set but not the configuration', () => {
        const counter = drive([170, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 170]);
        counter.reset();
        expect(counter.reps).toBe(0);
        expect(counter.ready).toBe(true);
    });

    test('every exercise names an intent and a signal, never a clip', () => {
        for (const [id, s] of Object.entries(RepCounter.EXERCISES)) {
            expect(typeof s.intent).toBe('string');
            expect(Coach.SIGNALS[s.signal]).toBeInstanceOf(Function);
            expect(s.low).toBeLessThan(s.high);
            expect(s.intent).not.toMatch(/\.(bvh|vrma|fbx|glb)$/i);
            expect(id).toBeTruthy();
        }
    });
});

// ── landmarks → scalar ───────────────────────────────────────────────────────

describe('the pose reduction', () => {
    test('a straight limb is 180 degrees', () => {
        expect(Coach.angle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(180, 5);
    });

    test('a right angle is 90', () => {
        expect(Coach.angle({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90, 5);
    });

    test('a missing landmark is NaN, not a number that looks plausible', () => {
        expect(Number.isNaN(Coach.angle(null, { x: 0, y: 0 }, { x: 1, y: 0 }))).toBe(true);
        expect(Number.isNaN(Coach.angle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }))).toBe(true);
    });

    test('one occluded knee does not stop a set — both sides are averaged', () => {
        const points = [];
        points[Coach.LM.leftHip] = { x: 0, y: 0 };
        points[Coach.LM.leftKnee] = { x: 0, y: 1 };
        points[Coach.LM.leftAnkle] = { x: 0, y: 2 };
        // The right side is absent entirely.
        expect(Coach.SIGNALS.kneeAngle(points)).toBeCloseTo(180, 5);
    });

    test('wrist height is inverted, so up is a larger number like every other signal', () => {
        const low = [];
        low[Coach.LM.leftWrist] = { x: 0, y: 0.9 };
        low[Coach.LM.rightWrist] = { x: 1, y: 0.9 };
        const high = [];
        high[Coach.LM.leftWrist] = { x: 0, y: 0.1 };
        high[Coach.LM.rightWrist] = { x: 1, y: 0.1 };
        expect(Coach.SIGNALS.wristHeight(high)).toBeGreaterThan(Coach.SIGNALS.wristHeight(low));
    });
});

// ── the coach ────────────────────────────────────────────────────────────────

function coach({ consent = true, registry = null, cached = true, poseFails = false } = {}) {
    const bus = new EventBus();
    const blackboard = new Blackboard();
    blackboard.mode = TogetherProfile;
    const spoken = [];
    const intents = [];
    const events = [];
    bus.on('intent', (i) => intents.push(i));
    for (const name of ['coach:rep', 'coach:set_start', 'coach:set_end']) {
        bus.on(name, (e) => events.push({ name, ...e }));
    }

    const imports = [];
    const vision = {
        FilesetResolver: { forVisionTasks: async () => ({ fileset: true }) },
        PoseLandmarker: {
            createFromOptions: async () => {
                if (poseFails) throw new Error('no GPU delegate');
                return { detectForVideo: () => ({ landmarks: [[]] }), close() {} };
            },
        },
    };
    if (cached) global.window.__MEDIAPIPE_VISION__ = vision;
    else delete global.window.__MEDIAPIPE_VISION__;
    delete global.window.__MEDIAPIPE_FILESET__;

    const insight = {
        calls: [],
        sharing: false,
        async start(source) {
            this.calls.push(['start', source]);
            if (!consent) return null;
            this.sharing = true;
            return { source };
        },
        stop(why) {
            this.calls.push(['stop', why]);
            this.sharing = false;
        },
    };

    let clock = 1000;
    const c = Coach.attach({
        bus,
        blackboard,
        insight,
        registry,
        counters: RepCounter,
        derive: SceneJourney.derive,
        say: (text) => spoken.push(text),
        video: { readyState: 4 },
        importer: async (url) => {
            imports.push(url);
            return vision;
        },
        isMobile: () => false,
        now: () => clock,
    });
    return {
        bus,
        blackboard,
        insight,
        coach: c,
        spoken,
        intents,
        events,
        imports,
        at: () => clock,
        tick: (ms) => {
            clock += ms;
            return c.tick(clock);
        },
        cleanup() {
            delete global.window.__MEDIAPIPE_VISION__;
            delete global.window.__MEDIAPIPE_FILESET__;
        },
    };
}

describe('pose joins the loader that is already there', () => {
    test('a warm cache imports nothing', async () => {
        // A second copy of a 2 MB WASM runtime is not a performance problem, it is a bug
        // with a download attached.
        const c = coach({ cached: true });
        await c.coach.start('squat');
        expect(c.imports).toEqual([]);
        c.cleanup();
    });

    test('a cold cache imports once and fills it for the next tracker', async () => {
        const c = coach({ cached: false });
        await c.coach.start('squat');
        expect(c.imports).toHaveLength(1);
        expect(c.imports[0]).toContain('tasks-vision@0.10.14');
        expect(global.window.__MEDIAPIPE_VISION__).toBeTruthy();
        expect(global.window.__MEDIAPIPE_FILESET__).toBeTruthy();
        c.cleanup();
    });

    test('it is the same version the other two trackers load', () => {
        const hand = fs.readFileSync(path.join(ROOT, 'src', 'HandTracker.js'), 'utf8');
        expect(hand).toContain(`tasks-vision@${Coach.MEDIAPIPE_VERSION}`);
    });

    test('it uses the same globals they cache into', () => {
        const source = codeOf(fs.readFileSync(SOURCE, 'utf8'));
        expect(source).toContain('__MEDIAPIPE_VISION__');
        expect(source).toContain('__MEDIAPIPE_FILESET__');
    });

    test('a device without pose costs a feature, not a session', async () => {
        const c = coach({ poseFails: true });
        const result = await c.coach.start('squat');
        expect(result).toEqual({ ok: false, why: 'pose tracking is unavailable on this device' });
        expect(c.insight.calls).toContainEqual(['stop', 'pose unavailable']);
        c.cleanup();
    });
});

describe('the throttle', () => {
    test('15 to 20 fps, and mobile is the slower one', () => {
        expect(1000 / Coach.DESKTOP_DETECT_INTERVAL_MS).toBeCloseTo(20, 0);
        expect(1000 / Coach.MOBILE_DETECT_INTERVAL_MS).toBeGreaterThanOrEqual(15);
        expect(Coach.MOBILE_DETECT_INTERVAL_MS).toBeGreaterThan(Coach.DESKTOP_DETECT_INTERVAL_MS);
    });

    test('a tick faster than the interval costs one subtraction', async () => {
        const c = coach();
        await c.coach.start('squat');
        for (let i = 0; i < 60; i++) c.tick(16);
        // 60 frames at 16 ms is 960 ms; at 50 ms that is 19 or 20 detections, not 60.
        expect(c.coach.stats.detections).toBeLessThanOrEqual(20);
        expect(c.coach.stats.detections).toBeGreaterThanOrEqual(14);
        c.cleanup();
    });

    test('nothing is detected before a set starts', () => {
        const c = coach();
        expect(c.tick(1000)).toBeNull();
        expect(c.coach.stats.detections).toBe(0);
        c.cleanup();
    });

    test('a video that is not ready is not detected from', async () => {
        const c = coach();
        await c.coach.start('squat');
        c.coach._video = { readyState: 0 };
        c.tick(1000);
        expect(c.coach.stats.detections).toBe(0);
        c.cleanup();
    });

    test('a detector that throws is warned about once, not every frame', async () => {
        const c = coach();
        await c.coach.start('squat');
        c.coach.landmarker.detectForVideo = () => {
            throw new Error('context lost');
        };
        let warned = 0;
        const original = console.warn;
        console.warn = () => warned++;
        try {
            for (let i = 0; i < 100; i++) c.tick(100);
        } finally {
            console.warn = original;
        }
        expect(warned).toBe(1);
        c.cleanup();
    });
});

describe('fidgets pause through the gate that already exists', () => {
    test('the overlay declines idle-class clips and admits the demo', () => {
        const idle = { priority: 1 };
        const fidget = { priority: 2 };
        const demo = { priority: 3 };
        expect(Coach.COACH_OVERLAY.allows(idle)).toBe(false);
        expect(Coach.COACH_OVERLAY.allows(fidget)).toBe(false);
        expect(Coach.COACH_OVERLAY.allows(demo)).toBe(true);
    });

    test('it is the ranker that enforces it, not a second mechanism', () => {
        // §6.5's single enforcement point. A second "do not play this now" flag is how two
        // of them end up disagreeing, and the loser is always the one nobody knew about.
        const Ranker = require('../../src/behavior/selector/UtilityRanker.js');
        const source = codeOf(fs.readFileSync(SOURCE, 'utf8'));
        expect(source).not.toContain('scheduler');
        expect(source).not.toContain('suppress');
        expect(codeOf(fs.readFileSync(path.join(ROOT, 'src/behavior/selector/UtilityRanker.js'), 'utf8'))).toContain(
            'mode.allows(clip, bb)'
        );
        expect(Ranker).toBeTruthy();
    });

    test('starting installs it and stopping restores the original by reference', async () => {
        const c = coach();
        const before = c.blackboard.mode;
        await c.coach.start('squat');
        expect(c.blackboard.mode).not.toBe(before);
        expect(c.blackboard.mode.allows({ priority: 1 })).toBe(false);
        c.coach.stop();
        expect(c.blackboard.mode).toBe(before);
        c.cleanup();
    });

    test('ten sets leave the profile identical', async () => {
        const c = coach();
        const before = c.blackboard.mode;
        for (let i = 0; i < 10; i++) {
            await c.coach.start('squat');
            c.coach.stop();
        }
        expect(c.blackboard.mode).toBe(before);
        expect(TogetherProfile.initiative.budgetPerSession).toBe(4);
        c.cleanup();
    });

    test('the ranker passes the blackboard through, so a mode can narrow on state', () => {
        // B23's play profile refuses a walking clip while the game has the player's
        // attention, and could not read that attention before this.
        const Ranker = require('../../src/behavior/selector/UtilityRanker.js');
        const Play = require('../../src/behavior/modes/play.profile.js');
        const bb = new Blackboard();
        bb.mode = Play;
        bb.attention = 0.9;
        const walker = { id: 'w', intents: ['walk'], priority: 3, stats: { rootMotion: 0.9 }, tags: [] };
        expect(Ranker.Ranker).toBeTruthy();
        const ranker = new Ranker.Ranker({});
        expect(ranker.score(walker, { name: 'walk', intensity: 0.5 }, bb)).toBe(-Infinity);
        bb.attention = 0.2;
        // Not -Infinity is the whole claim: the gate flipped on state the mode could not
        // read before. What the score then *is* is the ranker's business, not this test's.
        expect(ranker.score(walker, { name: 'walk', intensity: 0.5 }, bb)).not.toBe(-Infinity);
    });
});

describe('the demo clip is chosen by intent, never by name', () => {
    /** The shipped KB, as the registry exposes it. */
    function registry() {
        return {
            forIntent(intent) {
                return MANIFEST.filter((r) => (r.intents || []).includes(intent));
            },
        };
    }

    test('the file holds no clip id and no filename', () => {
        const source = codeOf(fs.readFileSync(SOURCE, 'utf8'));
        for (const token of ['bvm_', 'bvh_', 'vrma_', '.bvh', '.vrma', '.fbx', 'vendor/animations']) {
            expect(source).not.toContain(token);
        }
        expect(source).toContain('class Coach');
    });

    test('it emits an intent and lets Tier 1 choose', async () => {
        const c = coach({ registry: registry() });
        await c.coach.start('jumping_jacks');
        const result = c.coach.demo();
        expect(result).toEqual({ ok: true, why: 'demonstrating', intent: 'jumping_jacks' });
        expect(c.intents).toContainEqual({ name: 'jumping_jacks', intensity: 0.7, source: 'coach' });
        c.cleanup();
    });

    test('the intent resolves in the shipped KB after the content pass', () => {
        // Before B27's KB pass every exercise clip carried only the generic `exercise`
        // intent, so asking for jumping jacks and getting a crunch was selection by luck.
        const r = registry();
        expect(r.forIntent('jumping_jacks').length).toBeGreaterThan(0);
        expect(r.forIntent('crunch').length).toBeGreaterThan(0);
        expect(r.forIntent('jog').length).toBeGreaterThan(0);
    });

    test('every exercise clip still carries the generic intent too', () => {
        for (const record of MANIFEST) {
            if ((record.tags || []).includes('exercise')) {
                expect(record.intents).toContain('exercise');
            }
        }
    });

    test('an exercise with no clip is refused out loud, not faked', async () => {
        // Playing a jog and calling it a squat is a demonstration of the wrong movement,
        // in the one activity where the user is copying what they see.
        const c = coach({ registry: registry() });
        await c.coach.start('squat');
        const result = c.coach.demo('squat');
        expect(result.ok).toBe(false);
        expect(result.why).toBe('no clip for that exercise');
        expect(c.spoken[c.spoken.length - 1]).toMatch(/do not have a clip for squat/);
        expect(c.intents).toEqual([]);
        c.cleanup();
    });

    test('an exercise the counter does not know is refused before anything else', () => {
        const c = coach({ registry: registry() });
        expect(c.coach.demo('breakdancing')).toEqual({ ok: false, why: 'I do not know breakdancing' });
        c.cleanup();
    });
});

describe('a set, end to end', () => {
    test('the fixture drives the coach itself, not just the counter', async () => {
        const c = coach();
        await c.coach.start('squat');
        FIXTURE.samples.forEach((value, i) => c.coach.feed(value, Math.round((i * 1000) / FIXTURE.fps)));
        expect(c.coach.reps).toBe(FIXTURE.groundTruth);
        expect(c.events.filter((e) => e.name === 'coach:rep')).toHaveLength(FIXTURE.groundTruth);
        c.cleanup();
    });

    test('she counts out loud', async () => {
        const c = coach();
        await c.coach.start('squat');
        FIXTURE.samples.forEach((value, i) => c.coach.feed(value, Math.round((i * 1000) / FIXTURE.fps)));
        expect(c.spoken.slice(0, 3)).toEqual(['1', '2', '3']);
        c.cleanup();
    });

    test('the set is recorded and announced when it ends', async () => {
        const c = coach();
        await c.coach.start('squat');
        FIXTURE.samples.forEach((value, i) => c.coach.feed(value, Math.round((i * 1000) / FIXTURE.fps)));
        c.coach.stop();
        const ended = c.events.find((e) => e.name === 'coach:set_end');
        expect(ended.reps).toBe(12);
        expect(ended.exercise).toBe('squat');
        expect(c.coach.stats.sets).toBe(1);
        c.cleanup();
    });

    test('observe() reduces landmarks and feed() never sees one', async () => {
        const c = coach();
        await c.coach.start('squat');
        const points = [];
        points[Coach.LM.leftHip] = { x: 0, y: 0 };
        points[Coach.LM.leftKnee] = { x: 0, y: 1 };
        points[Coach.LM.leftAnkle] = { x: 0, y: 2 };
        expect(c.coach.observe({ landmarks: [points] }, 0).phase).toBe('high');
        expect(
            codeOf(fs.readFileSync(path.join(ROOT, 'src/features/together/heuristics/RepCounter.js'), 'utf8'))
        ).not.toContain('landmark');
        c.cleanup();
    });

    test('the camera comes through B11 by way of B26', async () => {
        const c = coach();
        await c.coach.start('squat');
        expect(c.insight.calls[0]).toEqual(['start', 'camera']);
        c.cleanup();
    });

    test('a declined camera is a refusal, not a broken set', async () => {
        const c = coach({ consent: false });
        expect(await c.coach.start('squat')).toEqual({ ok: false, why: 'camera consent was declined' });
        expect(c.coach.running).toBe(false);
        c.cleanup();
    });

    test('an exercise it cannot count is refused before the camera is asked for', async () => {
        const c = coach();
        expect(await c.coach.start('breakdancing')).toEqual({
            ok: false,
            why: 'I do not know how to count breakdancing',
        });
        expect(c.insight.calls).toEqual([]);
        c.cleanup();
    });

    test('starting twice is refused', async () => {
        const c = coach();
        await c.coach.start('squat');
        expect(await c.coach.start('squat')).toEqual({ ok: false, why: 'already running' });
        c.cleanup();
    });

    test('detach stops the set and closes the landmarker', async () => {
        const c = coach();
        await c.coach.start('squat');
        let closed = false;
        c.coach.landmarker.close = () => (closed = true);
        c.coach.detach();
        expect(c.coach.running).toBe(false);
        expect(closed).toBe(true);
        expect(c.coach.landmarker).toBeNull();
        c.cleanup();
    });
});
