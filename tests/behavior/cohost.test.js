/**
 * Gaming co-host and the excitement heuristic (B23).
 *
 * Three acceptance sentences, and each is checked against the thing it is actually about:
 *
 *   * "tiers fire correctly from a synthetic event script" — a scripted play session of
 *     scalar samples goes in and the sequence of moments is asserted, not a single call;
 *   * "no full-body reaction while attention ≥ 0.8 except macro events" — the whole
 *     cross-product of five moment kinds against attention either side of the line;
 *   * "the detector never exceeds one macro per 30 s" — five minutes of a worst-case
 *     storm, with every macro's timestamp checked against the one before it.
 */

/* global describe, test, expect */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const SceneJourney = require('../../src/features/together/activities/scene-journey.js');
const TogetherProfile = require('../../src/behavior/modes/together.profile.js');
const PlayProfile = require('../../src/behavior/modes/play.profile.js');
const Excitement = require('../../src/features/together/heuristics/ExcitementDetector.js');
const CoHost = require('../../src/features/together/activities/cohost.js');

const ROOT = path.join(__dirname, '..', '..');
const DETECTOR_SOURCE = path.join(ROOT, 'src', 'features', 'together', 'heuristics', 'ExcitementDetector.js');
const COHOST_SOURCE = path.join(ROOT, 'src', 'features', 'together', 'activities', 'cohost.js');

const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** MediaAdapter samples at 4 Hz, so that is the cadence a script runs at. */
const SAMPLE_MS = 250;

/** A quiet stretch of play: steady room tone, nothing happening on screen. */
const CALM = { rms: 0.2, lumaJump: 0.01 };

function detector({ now } = {}) {
    const bus = new EventBus();
    const moments = [];
    bus.on('game:moment', (moment) => moments.push(moment));
    let clock = 0;
    const detect = Excitement.attach({ bus, profile: PlayProfile, now: now || (() => clock) });
    return {
        bus,
        detect,
        moments,
        at: () => clock,
        /** Run one sample and advance the clock. */
        step(sample = CALM) {
            const result = detect.feed(sample, clock);
            clock += SAMPLE_MS;
            return result;
        },
        jump(ms) {
            clock += ms;
        },
        /** Enough calm samples that the baseline means something. */
        warm(count = Excitement.WARMUP + 2) {
            for (let i = 0; i < count; i++) this.step(CALM);
            return this;
        },
    };
}

function cohost({ attention = 0.9 } = {}) {
    const bus = new EventBus();
    const blackboard = new Blackboard();
    blackboard.mode = TogetherProfile;
    blackboard.attention = attention;
    const intents = [];
    bus.on('intent', (intent) => intents.push(intent));
    const host = CoHost.attach({
        bus,
        blackboard,
        profile: PlayProfile,
        derive: SceneJourney.derive,
        detector: null,
        now: () => 1000,
    });
    return { bus, blackboard, host, intents };
}

// ── the profile: the tiers, finally written down ─────────────────────────────

describe('the reaction tiers exist and are data', () => {
    test('three tiers, ordered by how much of her moves', () => {
        expect(Object.keys(PlayProfile.TIERS)).toEqual(['micro', 'medium', 'macro']);
        expect(PlayProfile.TIERS.micro.body).toBe('head');
        expect(PlayProfile.TIERS.macro.body).toBe('full');
    });

    test('intensity rises with the tier', () => {
        const { micro, medium, macro } = PlayProfile.TIERS;
        expect(micro.intensity).toBeLessThan(medium.intensity);
        expect(medium.intensity).toBeLessThan(macro.intensity);
    });

    test('only micro may interrupt a player who is locked in', () => {
        expect(PlayProfile.TIERS.micro.interruptsAttention).toBe(true);
        expect(PlayProfile.TIERS.medium.interruptsAttention).toBe(false);
        expect(PlayProfile.TIERS.macro.interruptsAttention).toBe(false);
    });

    test('exactly two moments are macro events, and neither can be inferred', () => {
        expect(PlayProfile.MACRO_EVENTS.sort()).toEqual(['loss', 'win']);
        for (const kind of Excitement.INFERRED) {
            expect(PlayProfile.REACTIONS[kind].macroEvent).toBeUndefined();
        }
    });

    test('every reaction names a whitelisted emote, never a file', () => {
        const whitelist = [
            'happy',
            'sad',
            'angry',
            'surprised',
            'thinking',
            'celebrate',
            'dance',
            'wave',
            'flirt',
            'tease',
            'shy',
            'agree',
            'disagree',
            'idle',
            'point',
            'lean_in',
            'nod_along',
            'breathe',
            'console',
        ];
        for (const reaction of Object.values(PlayProfile.REACTIONS)) {
            expect(whitelist).toContain(reaction.intent);
        }
    });

    test('a full-body clip is refused while the game has them, allowed when it does not', () => {
        const walker = { stats: { rootMotion: 0.9 } };
        expect(PlayProfile.allows(walker, { attention: 0.9 })).toBe(false);
        expect(PlayProfile.allows(walker, { attention: 0.3 })).toBe(true);
    });
});

// ── no full-body reaction at high attention, except macro events ─────────────

describe('the etiquette rule, over the whole cross-product', () => {
    const LOCKED_IN = 0.9;
    const LOOKING_AWAY = 0.3;

    test('at high attention only micro and macro events get through', () => {
        const allowed = Object.keys(PlayProfile.REACTIONS).filter(
            (kind) => PlayProfile.mayReact(kind, LOCKED_IN).allowed
        );
        expect(allowed.sort()).toEqual(['hit', 'loss', 'win']);
    });

    test('the ones refused are exactly the non-macro-event full and upper body ones', () => {
        expect(PlayProfile.mayReact('near_death', LOCKED_IN).allowed).toBe(false);
        expect(PlayProfile.mayReact('surge', LOCKED_IN).allowed).toBe(false);
    });

    test('a surge is macro-tier and still refused — inferring a big moment is not knowing one', () => {
        expect(PlayProfile.REACTIONS.surge.tier).toBe('macro');
        const verdict = PlayReactAt('surge', LOCKED_IN);
        expect(verdict.allowed).toBe(false);
        expect(verdict.why).toContain('macro');
    });

    test('when they look away everything is allowed', () => {
        for (const kind of Object.keys(PlayProfile.REACTIONS)) {
            expect(PlayProfile.mayReact(kind, LOOKING_AWAY).allowed).toBe(true);
        }
    });

    test('the threshold is exactly 0.8', () => {
        expect(PlayProfile.mayReact('surge', 0.79).allowed).toBe(true);
        expect(PlayProfile.mayReact('surge', 0.8).allowed).toBe(false);
    });

    test('an unknown moment is refused rather than defaulted', () => {
        expect(PlayProfile.mayReact('flossing', 0).allowed).toBe(false);
    });

    function PlayReactAt(kind, attention) {
        return PlayProfile.mayReact(kind, attention);
    }
});

describe('and the co-host obeys it rather than having its own opinion', () => {
    test('a surge while they are locked in produces no intent', () => {
        const c = cohost({ attention: 0.9 });
        c.host.start();
        c.bus.emit('game:moment', { kind: 'surge', tier: 'macro' });
        expect(c.intents).toEqual([]);
        expect(c.host.stats.refused).toBe(1);
    });

    test('a win while they are locked in does', () => {
        const c = cohost({ attention: 0.9 });
        c.host.start();
        c.bus.emit('game:moment', { kind: 'win', tier: 'macro', macroEvent: true });
        expect(c.intents.map((i) => i.name)).toEqual(['celebrate']);
    });

    test('a loss consoles rather than celebrates', () => {
        const c = cohost({ attention: 0.9 });
        c.host.start();
        c.bus.emit('game:moment', { kind: 'loss', tier: 'macro', macroEvent: true });
        expect(c.intents.map((i) => i.name)).toEqual(['console']);
    });

    test('a hit nods, even mid-fight', () => {
        const c = cohost({ attention: 0.95 });
        c.host.start();
        c.bus.emit('game:moment', { kind: 'hit', tier: 'micro' });
        expect(c.intents.map((i) => i.name)).toEqual(['nod_along']);
        expect(c.intents[0].intensity).toBe(PlayProfile.TIERS.micro.intensity);
    });

    test('the same surge lands once they look away', () => {
        const c = cohost({ attention: 0.9 });
        c.host.start();
        c.bus.emit('game:moment', { kind: 'surge', tier: 'macro' });
        c.blackboard.attention = 0.2;
        c.bus.emit('game:moment', { kind: 'surge', tier: 'macro' });
        expect(c.intents.map((i) => i.name)).toEqual(['celebrate']);
    });

    test('the co-host asks the profile rather than reimplementing the rule', () => {
        // The rule has to live in one place: B24's clip engine wants the same moments, and
        // a second consumer with its own copy of the etiquette is how she ends up dancing
        // in one code path and not the other.
        const source = codeOf(fs.readFileSync(COHOST_SOURCE, 'utf8'));
        expect(source).toContain('mayReact');
        expect(source).not.toContain('0.8');
        expect(source).not.toContain('HIGH_ATTENTION =');
    });

    test('a reaction is a gesture — the co-host speaks no line', () => {
        const source = codeOf(fs.readFileSync(COHOST_SOURCE, 'utf8'));
        for (const token of ['NEXUS_BD_SAY', 'speakText', 'speechSynthesis', '.say(']) {
            expect(source).not.toContain(token);
        }
        expect(source).toContain('class CoHost');
    });

    test('nothing reacts before she has been asked to watch', () => {
        const c = cohost();
        c.bus.emit('game:moment', { kind: 'win', tier: 'macro', macroEvent: true });
        expect(c.intents).toEqual([]);
    });

    test('stopping unsubscribes her', () => {
        const c = cohost({ attention: 0.2 });
        c.host.start();
        c.host.stop();
        c.bus.emit('game:moment', { kind: 'win', tier: 'macro', macroEvent: true });
        expect(c.intents).toEqual([]);
    });

    test('she refuses to start without the tier table', () => {
        // Without it she has no idea which reactions are rude, and the failure mode is a
        // full-body dance mid-boss.
        const host = CoHost.attach({
            bus: new EventBus(),
            blackboard: new Blackboard(),
            profile: null,
            derive: SceneJourney.derive,
            detector: null,
        });
        expect(host.start()).toEqual({ ok: false, why: 'no play profile — refusing to start' });
    });

    test('and without an overlay function', () => {
        const host = CoHost.attach({
            bus: new EventBus(),
            blackboard: new Blackboard(),
            profile: PlayProfile,
            derive: null,
            detector: null,
        });
        expect(host.start().ok).toBe(false);
    });
});

// ── the profile overlay reverts ──────────────────────────────────────────────

describe('the play overlay goes back exactly as it was found', () => {
    test('starting derives a new profile and stopping restores the original by reference', () => {
        const c = cohost({ attention: 0.5 });
        const before = c.blackboard.mode;
        c.host.start();
        expect(c.blackboard.mode).not.toBe(before);
        expect(c.blackboard.mode.initiative.budgetPerSession).toBe(6);
        c.host.stop();
        expect(c.blackboard.mode).toBe(before);
    });

    test('the base profile is never mutated', () => {
        const c = cohost();
        c.host.start();
        expect(TogetherProfile.initiative.budgetPerSession).toBe(4);
    });

    test('ten start/stop cycles leave it identical', () => {
        const c = cohost({ attention: 0.5 });
        const before = c.blackboard.mode;
        for (let i = 0; i < 10; i++) {
            c.host.start();
            c.host.stop();
        }
        expect(c.blackboard.mode).toBe(before);
    });

    test('detach releases whatever was held', () => {
        const c = cohost({ attention: 0.5 });
        const before = c.blackboard.mode;
        c.host.start();
        c.host.detach();
        expect(c.blackboard.mode).toBe(before);
    });

    test('a moment is an opening in the play profile', () => {
        const c = cohost({ attention: 0.5 });
        c.host.start();
        expect(c.blackboard.mode.commentaryOpenings).toContain('game:moment');
    });
});

// ── the detector reads numbers, never pixels ─────────────────────────────────

describe('the detector cannot capture anything', () => {
    const source = codeOf(fs.readFileSync(DETECTOR_SOURCE, 'utf8'));

    test('it names nothing that reads a frame or a buffer', () => {
        for (const token of [
            'drawImage',
            'getImageData',
            'toDataURL',
            'toBlob',
            'getByteFrequencyData',
            'getByteTimeDomainData',
            'createElement',
            'getUserMedia',
            'getDisplayMedia',
        ]) {
            expect(source).not.toContain(token);
        }
    });

    test('the stripper is not vacuous', () => {
        expect(source).toContain('class Detector');
        expect(source).toContain('MACRO_COOLDOWN_MS');
    });

    test('it retains no samples beyond its rolling baselines', () => {
        const d = detector();
        d.warm(200);
        expect(d.detect.loudness.length).toBeLessThanOrEqual(Excitement.HISTORY);
        expect(d.detect.flashes.length).toBeLessThanOrEqual(Excitement.HISTORY);
    });

    test('a sample with no audio is ignored rather than guessed at', () => {
        const d = detector();
        d.warm();
        expect(d.detect.feed({ lumaJump: 0.9 }, d.at())).toBeNull();
        expect(d.detect.feed(null, d.at())).toBeNull();
    });
});

// ── the synthetic script ─────────────────────────────────────────────────────

describe('tiers fire correctly from a synthetic script', () => {
    test('a quiet stretch produces nothing at all', () => {
        const d = detector();
        for (let i = 0; i < 60; i++) d.step(CALM);
        expect(d.moments).toEqual([]);
    });

    test('nothing fires before the baseline has warmed up', () => {
        // Otherwise the very first sample is infinitely far above a mean of nothing.
        const d = detector();
        for (let i = 0; i < Excitement.WARMUP - 1; i++) d.step({ rms: 0.9, lumaJump: 0.9 });
        expect(d.moments).toEqual([]);
        expect(d.detect.stats.warm).toBe(false);
    });

    test('a flash alone is a hit', () => {
        const d = detector().warm();
        d.step({ rms: 0.2, lumaJump: 0.4 });
        expect(d.moments.map((m) => m.kind)).toEqual(['hit']);
        expect(d.moments[0].tier).toBe('micro');
    });

    test('a loud bang alone is a hit', () => {
        const d = detector().warm();
        d.step({ rms: 0.9, lumaJump: 0.0 });
        expect(d.moments.map((m) => m.kind)).toEqual(['hit']);
    });

    test('loud and bright together is a near-death', () => {
        const d = detector().warm();
        d.step({ rms: 0.9, lumaJump: 0.4 });
        expect(d.moments.map((m) => m.kind)).toEqual(['near_death']);
        expect(d.moments[0].tier).toBe('medium');
    });

    test('the middle of a building run stays quiet', () => {
        // She gasps once as it starts and then either celebrates or does not. Emitting on
        // every sample would be three gasps and a dance, which is a person having a fit.
        const d = detector().warm();
        const loud = { rms: 0.9, lumaJump: 0.4 };
        d.step(loud);
        d.step(loud);
        expect(d.moments.map((m) => m.kind)).toEqual(['near_death']);
    });

    test('a run of loud and bright is a surge', () => {
        const d = detector().warm();
        const loud = { rms: 0.9, lumaJump: 0.4 };
        for (let i = 0; i < Excitement.SURGE_RUN; i++) d.step(loud);
        expect(d.moments[d.moments.length - 1].kind).toBe('surge');
        expect(d.moments[d.moments.length - 1].tier).toBe('macro');
    });

    test('a whole scripted round comes out in the right order', () => {
        const d = detector().warm();

        // Calm, one hit marker, calm, an ambush, calm, the boss going down.
        const script = [
            ...Array(8).fill(CALM),
            { rms: 0.2, lumaJump: 0.35 }, // a flash: hit
            ...Array(20).fill(CALM),
            { rms: 0.85, lumaJump: 0.4 }, // loud and bright: near-death
            ...Array(40).fill(CALM),
            { rms: 0.9, lumaJump: 0.5 }, // the run starts: one gasp
            { rms: 0.92, lumaJump: 0.5 }, // building, and quiet
            { rms: 0.95, lumaJump: 0.5 }, // three in a row: surge
        ];
        for (const sample of script) d.step(sample);

        expect(d.moments.map((m) => m.kind)).toEqual(['hit', 'near_death', 'near_death', 'surge']);
        expect(d.moments.map((m) => m.tier)).toEqual(['micro', 'medium', 'medium', 'macro']);
        expect(d.moments.every((m) => m.macroEvent === false)).toBe(true);
    });

    test('the run resets after a surge rather than firing every sample after it', () => {
        const d = detector().warm();
        const loud = { rms: 0.95, lumaJump: 0.5 };
        for (let i = 0; i < 12; i++) d.step(loud);
        expect(d.moments.filter((m) => m.kind === 'surge')).toHaveLength(1);
    });

    test('the run resets on a calm sample', () => {
        const d = detector().warm();
        const loud = { rms: 0.9, lumaJump: 0.4 };
        d.step(loud);
        d.step(loud);
        d.step(CALM);
        d.step(loud);
        expect(d.moments.filter((m) => m.kind === 'surge')).toEqual([]);
    });

    test('a real hook can name a win, which the heuristic never will', () => {
        const d = detector().warm();
        const moment = d.detect.mark('win', d.at());
        expect(moment.kind).toBe('win');
        expect(moment.macroEvent).toBe(true);
        expect(moment.source).toBe('hook');
        expect(d.detect.stats.counts.win).toBe(1);
    });

    test('a hook and the heuristic leave through the same door', () => {
        const d = detector().warm();
        d.detect.mark('loss', d.at());
        expect(d.moments[0].kind).toBe('loss');
    });

    test('a kind the profile does not know is refused', () => {
        const d = detector().warm();
        expect(d.detect.mark('flossing', d.at())).toBeNull();
        expect(d.moments).toEqual([]);
    });
});

// ── the pacing rule ──────────────────────────────────────────────────────────

describe('never more than one macro in thirty seconds', () => {
    test('five minutes of a hook reporting a win four times a second', () => {
        // The worst case a detector can be handed, and the one where the baseline cannot
        // save it: a real integration firing constantly. 4 Hz for 300 s.
        const d = detector().warm();
        for (let i = 0; i < 1200; i++) d.detect.mark('win', i * SAMPLE_MS);

        const macros = d.moments.filter((m) => m.tier === 'macro');
        expect(macros.length).toBeGreaterThan(1);
        for (let i = 1; i < macros.length; i++) {
            expect(macros[i].at - macros[i - 1].at).toBeGreaterThanOrEqual(Excitement.MACRO_COOLDOWN_MS);
        }
        // 300 s at one per 30 s is eleven, plus the one at zero.
        expect(macros.length).toBeLessThanOrEqual(11);
    });

    test('five minutes of heuristic bursts', () => {
        const d = detector().warm();
        const loud = { rms: 0.95, lumaJump: 0.6 };
        // A burst every two seconds for five minutes: long enough for the baseline to
        // recover between them, so the heuristic keeps firing rather than adapting away.
        for (let cycle = 0; cycle < 150; cycle++) {
            for (let i = 0; i < 4; i++) d.step(loud);
            for (let i = 0; i < 4; i++) d.step(CALM);
        }
        const macros = d.moments.filter((m) => m.tier === 'macro');
        for (let i = 1; i < macros.length; i++) {
            expect(macros[i].at - macros[i - 1].at).toBeGreaterThanOrEqual(Excitement.MACRO_COOLDOWN_MS);
        }
        expect(macros.length).toBeLessThanOrEqual(11);
    });

    test('a game that is loud the whole time stops being exciting', () => {
        // The baseline adapts over four seconds, so "louder than usual" stops being true.
        // That is the feature: a permanently loud shooter is not a permanent celebration.
        const d = detector().warm();
        const loud = { rms: 0.95, lumaJump: 0.6 };
        for (let i = 0; i < 400; i++) d.step(loud);
        const early = d.moments.filter((m) => m.at < 10000).length;
        const late = d.moments.filter((m) => m.at >= 20000).length;
        expect(early).toBeGreaterThan(0);
        expect(late).toBe(0);
    });

    test('a real hook is paced too — a game reporting a win twice is one win', () => {
        const d = detector().warm();
        expect(d.detect.mark('win', 0)).not.toBeNull();
        expect(d.detect.mark('win', 5000)).toBeNull();
        expect(d.detect.mark('win', Excitement.MACRO_COOLDOWN_MS)).not.toBeNull();
    });

    test('a suppressed macro is counted, not silently dropped', () => {
        const d = detector().warm();
        d.detect.mark('win', 0);
        d.detect.mark('loss', 1000);
        expect(d.detect.stats.suppressed.macro).toBe(1);
    });

    test('the cooldown is per tier — a micro is not blocked by a macro', () => {
        const d = detector().warm();
        d.detect.mark('win', 0);
        // A hit right after a win still gets through: it is a different tier with its own
        // cooldown, and a nod does not compete with a dance.
        expect(d.detect.mark('hit', 100)).not.toBeNull();
        expect(d.detect.mark('hit', 200)).toBeNull(); // now the micro cooldown holds
        expect(d.detect.mark('hit', 100 + Excitement.MICRO_COOLDOWN_MS)).not.toBeNull();
    });

    test('the three cooldowns are ordered by how disruptive the tier is', () => {
        expect(Excitement.MICRO_COOLDOWN_MS).toBeLessThan(Excitement.MEDIUM_COOLDOWN_MS);
        expect(Excitement.MEDIUM_COOLDOWN_MS).toBeLessThan(Excitement.MACRO_COOLDOWN_MS);
        expect(Excitement.MACRO_COOLDOWN_MS).toBe(30000);
    });

    test('pacing lives in the detector, so a second consumer sees the same moments', () => {
        // B24's clip engine subscribes to the same event. If the co-host held the cooldown,
        // the clip engine would see a macro storm the reaction path was shielded from and
        // the two would disagree about what happened.
        const source = codeOf(fs.readFileSync(COHOST_SOURCE, 'utf8'));
        expect(source).not.toContain('COOLDOWN');
        expect(codeOf(fs.readFileSync(DETECTOR_SOURCE, 'utf8'))).toContain('COOLDOWNS[tier]');
    });
});

// ── the event ────────────────────────────────────────────────────────────────

describe('one typed event carries the kind', () => {
    test('it is in the bus vocabulary', () => {
        const bus = new EventBus();
        let heard = 0;
        bus.on('game:moment', () => heard++);
        expect(bus.emit('game:moment', { kind: 'hit' })).toBe(1);
        expect(bus.emit('game:win', {})).toBe(0);
        expect(heard).toBe(1);
    });

    test('every moment carries kind, tier, macroEvent and a timestamp', () => {
        const d = detector().warm();
        d.detect.mark('win', 4242);
        expect(d.moments[0]).toMatchObject({ kind: 'win', tier: 'macro', macroEvent: true, at: 4242 });
    });

    test('a detector with no bus still returns its moments', () => {
        const d = Excitement.attach({ bus: null, profile: PlayProfile, now: () => 0 });
        expect(d.mark('win', 0).kind).toBe('win');
    });
});
