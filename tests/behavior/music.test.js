/**
 * Listen Together (B13).
 *
 * The acceptance is three sentences and each is a claim about *time*, so everything here
 * runs on an injected clock against a synthetic analyser. A real AnalyserNode would make
 * these tests slow, flaky and untrue on a machine under load; a click track built in
 * arithmetic makes "within one beat period" a number rather than an impression.
 *
 *   * energy climbs with the track     → "energy follows the track"
 *   * and decays after                 → same block: the decay is the blackboard's, and
 *                                        this file is asserted not to have its own
 *   * silence never leaves a dance on  → "silence"
 *
 * Plus the constraint the batch is really about: she dances to what the KB chooses. There
 * is a source test for the absence of any clip name, and a live one that runs the real
 * selector and ranker over the real manifest.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const Registry = require('../../src/behavior/registry/AnimationRegistry.js');
const AntiRepeat = require('../../src/behavior/selector/AntiRepeatMemory.js');
const { Ranker } = require('../../src/behavior/selector/UtilityRanker.js');
const { Selector } = require('../../src/behavior/selector/SemanticSelector.js');
const Music = require('../../src/features/together/activities/music.js');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'behavior.config.json'), 'utf8'));
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'features', 'together', 'activities', 'music.js'), 'utf8');

const { BeatDetector, EnergyDrift, STREAK, SILENCE_MS, DANCE_GAP_MS, MIN_BEAT_GAP_MS } = Music;

// ── the click track ──────────────────────────────────────────────────────────

/**
 * A synthetic analyser. `at(ms)` decides the bass level, so a test writes a track as a
 * function of time: a click every 500 ms is 120 BPM, and silence is a constant.
 */
function clickTrack({ bpm = 120, attackMs = 60, loud = 0.9, quiet = 0.08, from = 0 } = {}) {
    const period = 60000 / bpm;
    return (ms) => {
        if (ms < from) return quiet;
        const phase = (ms - from) % period;
        // A kick is a fast attack and a short decay, not a square wave.
        if (phase > attackMs) return quiet;
        return quiet + (loud - quiet) * (1 - phase / attackMs);
    };
}

const silence =
    (level = 0.02) =>
    () =>
        level;

/** An analyser whose spectrum is whatever the track says at the current clock. */
function fakeAnalyser(track, clock) {
    return {
        fftSize: 1024,
        frequencyBinCount: 512,
        getByteFrequencyData(out) {
            const level = Math.max(0, Math.min(1, track(clock())));
            // Bass bins carry the beat; everything above is steady mid-level content, so a
            // detector that read the whole spectrum would see no beats at all.
            for (let i = 0; i < out.length; i++) out[i] = i < 8 ? Math.round(level * 255) : 90;
        },
    };
}

/** A scheduler that only has to be stoppable. */
function fakeScheduler() {
    return {
        stops: 0,
        stop() {
            this.stops++;
        },
    };
}

/** An activity on an injected clock, polled at 60 Hz by `run`. */
function rig({ track = clickTrack(), scheduler = fakeScheduler(), blackboard } = {}) {
    let clock = 0;
    const bus = new EventBus({});
    const board = blackboard || new Blackboard({});
    const beats = [];
    const intents = [];
    bus.on('media:beat', (payload) => beats.push({ at: clock, ...payload }));
    bus.on('intent', (intent) => intents.push({ at: clock, ...intent }));

    const activity = Music.attach({
        bus,
        blackboard: board,
        scheduler,
        analyser: fakeAnalyser(track, () => clock),
        config: CONFIG,
        now: () => clock,
    });
    activity.start();

    return {
        activity,
        bus,
        blackboard: board,
        scheduler,
        beats,
        intents,
        at: () => clock,
        /** Advance `ms` of wall time at 60 fps, updating every frame. */
        run(ms, stepMs = 1000 / 60) {
            const until = clock + ms;
            while (clock < until) {
                clock += stepMs;
                activity.update(clock);
            }
            return activity;
        },
        /** Advance the blackboard's own clock, as the render loop does. */
        decay(ms, stepMs = 1000 / 60) {
            const until = clock + ms;
            while (clock < until) {
                clock += stepMs;
                board.tick(stepMs / 1000);
            }
        },
    };
}

beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ── beats ────────────────────────────────────────────────────────────────────

describe('beats', () => {
    test('a click track produces a beat inside one beat period', () => {
        const bpm = 120;
        const r = rig({ track: clickTrack({ bpm }) });
        const period = 60000 / bpm;

        // Long enough to fill the history the detector compares against, then one period.
        r.run(2000);
        const first = r.beats[0];
        expect(first).toBeTruthy();

        const after = r.at();
        r.run(period);
        expect(r.beats.filter((b) => b.at > after).length).toBeGreaterThanOrEqual(1);
    });

    test('it recovers the tempo, not just the pulses', () => {
        for (const bpm of [90, 120, 140]) {
            const r = rig({ track: clickTrack({ bpm }) });
            r.run(8000);
            // Median of the measured intervals, so a dropped click does not skew it.
            expect(`${bpm}: ${Math.abs(r.activity.stats.bpm - bpm) <= 4}`).toBe(`${bpm}: true`);
        }
    });

    test('it does not fire on steady loudness — a mean has to mean something', () => {
        const r = rig({ track: () => 0.75 });
        r.run(6000);
        expect(r.beats).toHaveLength(0);
    });

    test('silence produces no beats out of its own rounding noise', () => {
        const r = rig({ track: silence() });
        r.run(6000);
        expect(r.beats).toHaveLength(0);
    });

    test('one kick ringing is not 400 BPM', () => {
        const r = rig({ track: clickTrack({ bpm: 120 }) });
        r.run(8000);
        for (let i = 1; i < r.beats.length; i++) {
            expect(r.beats[i].at - r.beats[i - 1].at).toBeGreaterThanOrEqual(MIN_BEAT_GAP_MS);
        }
    });

    test('the streak is consistency, not repetition', () => {
        // Four beats at random distances is a noisy room, not a tempo, and must not build
        // a streak that starts her dancing.
        const jitter = (ms) => {
            const marks = [1200, 1600, 2900, 3050, 4400];
            return marks.some((m) => ms >= m && ms < m + 60) ? 0.9 : 0.08;
        };
        const r = rig({ track: jitter });
        r.run(6000);
        expect(r.activity.stats.streak).toBeLessThan(STREAK);
        expect(r.intents).toHaveLength(0);
    });

    test('a detector with no analyser reads nothing rather than throwing', () => {
        const detector = new BeatDetector({ analyser: null });
        expect(detector.level()).toBe(null);
        expect(detector.sample(0)).toBe(null);
        expect(detector.bpm).toBe(null);
    });
});

// ── energy ───────────────────────────────────────────────────────────────────

describe('energy follows the track', () => {
    test('it climbs while the track plays', () => {
        const r = rig({ track: clickTrack({ bpm: 128, loud: 0.95 }) });
        const before = r.blackboard.energy;
        r.run(6000);
        expect(r.blackboard.energy).toBeGreaterThan(before);
        expect(r.activity.stats.peak).toBeGreaterThan(0.2);
    });

    test('a louder track lands higher than a quieter one', () => {
        const loud = rig({ track: clickTrack({ loud: 0.95, quiet: 0.5 }) });
        const quiet = rig({ track: clickTrack({ loud: 0.35, quiet: 0.06 }) });
        loud.run(8000);
        quiet.run(8000);
        expect(loud.blackboard.energy).toBeGreaterThan(quiet.blackboard.energy);
    });

    /**
     * The decay half. It is deliberately *not* implemented here — the blackboard already
     * eases energy toward rest, and a second easing in this file would fight it, giving a
     * rate that is neither. So the assertion is that stopping the pushing is enough.
     */
    test('it decays after, using the blackboard decay rather than one of its own', () => {
        const r = rig({ track: clickTrack({ bpm: 128, loud: 0.95 }) });
        r.run(8000);
        const peak = r.blackboard.energy;
        expect(peak).toBeGreaterThan(0.3);

        r.activity.stop();
        r.decay(60000);

        expect(r.blackboard.energy).toBeLessThan(peak / 2);
        expect(r.blackboard.energy).toBeCloseTo(0.2, 1); // the resting value
    });

    test("a running activity never lowers the mood — that is the blackboard's job", () => {
        // The behavioural form of "no second decay". If this file eased energy down too,
        // the number would ease at neither rate and nobody would be able to say which.
        const r = rig({ track: clickTrack({ bpm: 128, loud: 0.95 }) });
        r.run(6000);
        const peak = r.blackboard.energy;

        // The track goes quiet but the activity keeps running and keeps being polled.
        r.activity.detector.analyser = {
            fftSize: 1024,
            frequencyBinCount: 512,
            getByteFrequencyData: (o) => o.fill(2),
        };
        r.run(20000);
        expect(r.blackboard.energy).toBe(peak);
    });

    test('the drift only ever pushes energy up, never down', () => {
        // Pushing down is decay by another name, and would fight the blackboard.
        const blackboard = new Blackboard({});
        blackboard.setMood(0, 0.8);
        const drift = new EnergyDrift({ blackboard });
        for (let i = 0; i < 50; i++) drift.push(0.05);
        expect(blackboard.energy).toBe(0.8);
    });

    test('a nonsense level is ignored rather than corrupting the mood', () => {
        const blackboard = new Blackboard({});
        const drift = new EnergyDrift({ blackboard });
        for (const bad of [NaN, undefined, null, 'loud']) drift.push(bad);
        expect(drift.smoothed).toBe(0);
        expect(blackboard.energy).toBe(0.2);
    });

    test('it rises faster than it falls, so a chorus lands and a last note does not snap', () => {
        const drift = new EnergyDrift({ blackboard: null });
        drift.push(1);
        const afterOneRise = drift.smoothed;
        const falling = new EnergyDrift({ blackboard: null });
        falling.smoothed = 1;
        falling.push(0);
        expect(afterOneRise).toBeGreaterThan(1 - falling.smoothed);
    });
});

// ── the KB chooses ───────────────────────────────────────────────────────────

describe('she dances to what the KB chooses', () => {
    test('there is not a clip id in the file', () => {
        const ids = new Set(
            fs
                .readFileSync(path.join(ROOT, 'kb', 'animations.manifest.jsonl'), 'utf8')
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line).id)
        );
        const body = SOURCE.slice(SOURCE.indexOf('const MusicActivity'));
        const named = [...ids].filter((id) => body.includes(id));
        expect(named).toEqual([]);
    });

    test('and no route to the scheduler except stopping it', () => {
        // `request` is how a clip gets played. This file may only ever stop.
        const body = SOURCE.slice(SOURCE.indexOf('const MusicActivity'));
        expect(body.includes('scheduler.request')).toBe(false);
        expect(body.includes('.request(')).toBe(false);
        expect(body.includes('scheduler.stop')).toBe(true);
    });

    test('a beat streak asks for an intent, and only an intent', () => {
        const r = rig({ track: clickTrack({ bpm: 120 }) });
        r.run(8000);

        expect(r.intents).toHaveLength(1);
        expect(r.intents[0]).toMatchObject({ name: 'dance', source: 'music' });
        expect(r.intents[0].clip).toBeUndefined();
        expect(r.intents[0].id).toBeUndefined();
    });

    test('the ask lands on a beat, not between beats', () => {
        // A clip that starts a random distance into a bar is the difference between
        // dancing to the music and dancing near it.
        const r = rig({ track: clickTrack({ bpm: 120 }) });
        r.run(8000);
        const beatTimes = r.beats.map((b) => b.at);
        expect(beatTimes).toContain(r.intents[0].at);
    });

    /**
     * The live version: the real manifest, the real selector, the real ranker. What comes
     * out is a dance clip, and which one is the KB's business — this asserts only that a
     * clip came back and that it declares the intent.
     */
    test('Tier 1 turns that intent into a real dance clip', () => {
        const registry = new Registry().loadText(
            fs.readFileSync(path.join(ROOT, 'kb', 'animations.manifest.jsonl'), 'utf8')
        );
        const selector = new Selector()
            .loadVocabularyText(fs.readFileSync(path.join(ROOT, 'kb', 'embeddings', 'index.vocab.tsv'), 'utf8'))
            .index(registry.records);
        const ranker = new Ranker({ antiRepeat: new AntiRepeat(CONFIG.antiRepeatWindow) });

        const r = rig({ track: clickTrack({ bpm: 128, loud: 0.95 }) });
        const picks = [];
        r.bus.on('intent', (intent) => {
            picks.push(ranker.best(selector.topK(intent, registry, CONFIG.topK), intent, r.blackboard));
        });
        r.run(8000);

        expect(picks).toHaveLength(1);
        expect(picks[0]).toBeTruthy();
        expect(picks[0].clip.intents).toContain('dance');
    });

    test('the KB has many dances, which is the point of not naming one', () => {
        const records = fs
            .readFileSync(path.join(ROOT, 'kb', 'animations.manifest.jsonl'), 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        const dances = records.filter((r) => (r.intents || []).includes('dance'));
        expect(dances.length).toBeGreaterThan(10);
        // And they differ in energy, which is what makes matching the track meaningful.
        const energies = new Set(dances.map((d) => d.energy));
        expect(energies.size).toBeGreaterThan(3);
    });

    test('a loud track and a quiet one reach the ranker with different energies', () => {
        // The mechanism behind "grooves in time" — no special code, just the mood the
        // ranker already weighs against each clip's own energy.
        const loud = rig({ track: clickTrack({ loud: 0.95, quiet: 0.5 }) });
        const quiet = rig({ track: clickTrack({ loud: 0.3, quiet: 0.05 }) });
        loud.run(8000);
        quiet.run(8000);
        expect(loud.intents[0].intensity).toBeGreaterThan(quiet.intents[0].intensity);
        expect(loud.blackboard.energy).toBeGreaterThan(quiet.blackboard.energy);
    });

    test('she is not asked to dance again every beat', () => {
        const r = rig({ track: clickTrack({ bpm: 120 }) });
        r.run(4000);
        expect(r.intents).toHaveLength(1);
        const first = r.intents[0].at;

        // Dozens of beats pass, and none of them asks again.
        r.run(first + DANCE_GAP_MS - r.at() - 1000);
        expect(r.intents).toHaveLength(1);
        expect(r.beats.length).toBeGreaterThan(20);

        r.run(2000);
        expect(r.intents).toHaveLength(2);
        expect(r.intents[1].at - first).toBeGreaterThanOrEqual(DANCE_GAP_MS);
    });
});

// ── silence ──────────────────────────────────────────────────────────────────

describe('silence never leaves a dance stuck on', () => {
    test('beats stop, and the dance is stopped without waiting for energy to fall', () => {
        let playing = true;
        const beat = clickTrack({ bpm: 120 });
        const r = rig({ track: (ms) => (playing ? beat(ms) : 0.02) });

        r.run(8000);
        expect(r.activity.stats.dancing).toBe(true);
        expect(r.scheduler.stops).toBe(0);

        playing = false;
        r.run(SILENCE_MS + 2500);

        expect(r.activity.stats.dancing).toBe(false);
        expect(r.scheduler.stops).toBe(1);
        expect(r.activity.stats.stoppedForSilence).toBe(1);
        // And it happened well before the mood finished decaying, which is the point.
        expect(r.blackboard.energy).toBeGreaterThan(0.25);
    });

    test('the stop goes through the scheduler, because the resolver owns the rig', () => {
        const r = rig({ track: clickTrack() });
        r.run(8000);
        r.activity.stop();
        expect(r.scheduler.stops).toBe(1);
    });

    test('pausing the track ends the dance by the same path', () => {
        const r = rig({ track: clickTrack() });
        r.run(8000);
        expect(r.activity.stats.dancing).toBe(true);

        r.bus.emit('media:paused', {});
        expect(r.activity.stats.dancing).toBe(false);
        expect(r.scheduler.stops).toBe(1);
    });

    test('stopping twice does not stop the scheduler twice', () => {
        const r = rig({ track: clickTrack() });
        r.run(8000);
        r.activity.stop();
        r.activity.stop();
        r.bus.emit('media:paused', {});
        expect(r.scheduler.stops).toBe(1);
    });

    test('a slow track gets a longer grace than a fast one', () => {
        // Four beats of silence, never less than the floor: at 60 BPM a gap of 1.6 s is
        // most of one beat, and stopping there would end the dance mid-bar.
        const r = rig({ track: clickTrack({ bpm: 60 }) });
        r.run(12000);
        const period = r.activity.stats.bpm ? 60000 / r.activity.stats.bpm : 0;
        expect(period * 4).toBeGreaterThan(SILENCE_MS);
    });

    test('nothing is stopped when nothing was dancing', () => {
        const r = rig({ track: silence() });
        r.run(10000);
        expect(r.scheduler.stops).toBe(0);
    });

    test('a stopped activity analyses nothing', () => {
        const r = rig({ track: clickTrack() });
        r.run(3000);
        const beats = r.beats.length;
        r.activity.stop();
        r.run(8000);
        expect(r.beats).toHaveLength(beats);
    });

    test('detaching unsubscribes, so a dead activity cannot be woken by a pause', () => {
        const r = rig({ track: clickTrack() });
        r.run(8000);
        r.activity.detach();
        const stops = r.scheduler.stops;
        r.bus.emit('media:paused', {});
        expect(r.scheduler.stops).toBe(stops);
    });

    test('no timers — a backgrounded tab stops analysing rather than dancing on', () => {
        // Everything runs from the render loop, so a tab that stops rendering stops.
        const body = SOURCE.slice(SOURCE.indexOf('const MusicActivity'));
        for (const forbidden of ['setInterval', 'setTimeout', 'requestAnimationFrame']) {
            expect(`${forbidden}: ${body.includes(forbidden)}`).toBe(`${forbidden}: false`);
        }
    });
});

// ── plumbing ─────────────────────────────────────────────────────────────────

describe('the analyser', () => {
    test('it connects onward to the destination, or the track goes silent', () => {
        const connections = [];
        const analyser = { connect: (to) => connections.push(['analyser', to]) };
        const source = { connect: (to) => connections.push(['source', to]) };
        const context = {
            destination: 'destination',
            createMediaElementSource: () => source,
            createAnalyser: () => analyser,
        };

        expect(Music.analyserFor({}, { context })).toBe(analyser);
        expect(connections).toEqual([
            ['source', analyser],
            ['analyser', 'destination'],
        ]);
    });

    test('a page without WebAudio gets no beats rather than an exception', () => {
        expect(Music.analyserFor({}, { context: null })).toBe(null);
        expect(
            Music.analyserFor(
                {},
                {
                    context: {
                        createMediaElementSource() {
                            throw new Error('already connected');
                        },
                    },
                }
            )
        ).toBe(null);
    });

    test('swapping the analyser resets the detector rather than mixing two tracks', () => {
        const r = rig({ track: clickTrack() });
        r.run(8000);
        expect(r.activity.stats.beats).toBeGreaterThan(0);
        r.activity.analyser = null;
        expect(r.activity.stats.bpm).toBe(null);
        expect(r.activity.stats.streak).toBe(0);
    });
});
