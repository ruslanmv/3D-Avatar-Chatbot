/**
 * Body-doubling focus sessions (B22).
 *
 * The acceptance sentence is "a full 25/5 cycle passes with zero spoken lines inside a focus
 * block", and the only honest way to check it is to run the twenty-five minutes. So the
 * first suite here drives a real `CommentaryGate` — B12's, not a stand-in — through 1500
 * simulated seconds, firing an opening at every one of them, and asserts the gate said no
 * every single time. Then it fires the same openings during the break and asserts it says
 * yes, because a test that only proves silence would also pass if the gate were broken.
 */

/* global describe, test, expect */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const WatchActivity = require('../../src/features/together/activities/watch.js');
const SceneJourney = require('../../src/features/together/activities/scene-journey.js');
const TogetherProfile = require('../../src/behavior/modes/together.profile.js');
const Focus = require('../../src/features/together/activities/focus.js');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'src', 'features', 'together', 'activities', 'focus.js');

/** Source with comments removed — every grep in this repo has matched its own prose once. */
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const SECOND = 1000;

function harness({ profile = TogetherProfile, attention = 0.9 } = {}) {
    const bus = new EventBus();
    const blackboard = new Blackboard();
    blackboard.mode = profile;
    blackboard.attention = attention;

    let clock = 100000;
    const now = () => clock;

    const gate = new WatchActivity.CommentaryGate({ bus, blackboard, profile, now });
    const sent = [];
    const intents = [];
    bus.on('intent', (intent) => intents.push(intent));

    const focus = Focus.attach({
        bus,
        blackboard,
        gate,
        session: { send: (frame) => sent.push(frame) },
        derive: SceneJourney.derive,
        now,
    });

    return {
        bus,
        blackboard,
        gate,
        focus,
        sent,
        intents,
        now,
        tick(ms) {
            clock += ms;
            focus.update(clock);
            return clock;
        },
        at: () => clock,
    };
}

// ── the acceptance criterion, run for twenty-five minutes ────────────────────

describe('a full 25/5 cycle with zero spoken lines inside the block', () => {
    test('the gate refuses every second of the focus block', () => {
        const h = harness();
        expect(h.focus.start(h.at()).ok).toBe(true);

        const refusals = [];
        for (let second = 0; second < 25 * 60; second++) {
            // An opening at every single second — paused media, a look at her, a silence.
            // If any of them got through, this is where it would.
            h.bus.emit('media:paused', {});
            h.bus.emit('gaze:user-look-avatar', {});
            h.bus.emit('user:silent', {});
            h.tick(SECOND);
            if (h.focus.inBlock) refusals.push(h.gate.may(h.at()));
        }

        expect(refusals.length).toBeGreaterThan(1400);
        expect(refusals.every((r) => r.allowed === false)).toBe(true);
        expect(h.gate.stats.allowed).toBe(0);
    });

    test('and the reason is the budget, not luck', () => {
        const h = harness();
        h.focus.start(h.at());
        h.bus.emit('media:paused', {});
        h.tick(SECOND);
        expect(h.gate.may(h.at())).toEqual({
            allowed: false,
            why: 'this scene has no initiative budget',
        });
    });

    test('the same gate says yes during the break', () => {
        // Without this the suite above would pass on a gate that refuses everything always.
        const h = harness();
        h.focus.start(h.at());
        for (let second = 0; second < 25 * 60; second++) h.tick(SECOND);
        expect(h.focus.phase).toBe('break');

        h.bus.emit('media:paused', {});
        const verdict = h.gate.may(h.at());
        expect(verdict.allowed).toBe(true);
    });

    test('a low-attention moment does not open a hole in the block', () => {
        // The gate's other yes: attention below 0.5 means "the activity is not holding
        // them, a remark is company". During a focus block that would be a remark while
        // they stare out of the window, which is precisely the thing this mode is not.
        const h = harness({ attention: 0.1 });
        h.focus.start(h.at());
        h.tick(SECOND * 60);
        expect(h.gate.may(h.at()).allowed).toBe(false);
    });

    test('the cycle completes and starts the next block', () => {
        const h = harness();
        h.focus.start(h.at());
        for (let second = 0; second < 30 * 60; second++) h.tick(SECOND);
        expect(h.focus.stats.blocks).toBe(1);
        expect(h.focus.phase).toBe('focus');
    });

    test('four blocks earn a long break', () => {
        const h = harness();
        h.focus.start(h.at());
        const seen = [];
        h.bus.on('focus:phase', (event) => seen.push(event));
        for (let second = 0; second < 4 * 30 * 60; second++) h.tick(SECOND);
        expect(h.focus.stats.blocks).toBe(4);
        // The fourth break is the long one, so the fifth focus block has not begun yet.
        expect(h.focus.phase).toBe('break');
        expect(seen.filter((e) => e.to === 'break')).toHaveLength(4);
    });
});

// ── the silence is structural ────────────────────────────────────────────────

describe('there is no speech path in this module', () => {
    const source = codeOf(fs.readFileSync(SOURCE, 'utf8'));

    test('it names nothing that could speak', () => {
        for (const token of ['NEXUS_BD_SAY', 'speakText', 'speechSynthesis', '.say(', "'say'"]) {
            expect(source).not.toContain(token);
        }
    });

    test('the stripper is not vacuous', () => {
        expect(source).toContain('class Focus');
        expect(source).toContain('QUIET_OVERLAY');
    });

    test('the overlay zeroes the budget, which is the field the gate reads first', () => {
        expect(Focus.QUIET_OVERLAY.initiative.budgetPerSession).toBe(0);
        expect(Focus.QUIET_OVERLAY.commentaryOpenings).toEqual([]);
    });

    test('she refuses to start a block she cannot keep quiet in', () => {
        const bus = new EventBus();
        const focus = Focus.attach({ bus, blackboard: new Blackboard(), derive: null });
        const result = focus.start();
        expect(result.ok).toBe(false);
        expect(result.why).toMatch(/refusing to start/);
        expect(focus.phase).toBe('idle');
    });

    test('starting twice is refused rather than re-entered', () => {
        const h = harness();
        h.focus.start(h.at());
        expect(h.focus.start(h.at())).toEqual({ ok: false, why: 'already running' });
    });
});

// ── the profile goes back exactly as it was ──────────────────────────────────

describe('the quiet overlay reverts exactly', () => {
    test('the base profile is never mutated', () => {
        const h = harness();
        h.focus.start(h.at());
        expect(TogetherProfile.initiative.budgetPerSession).toBe(4);
        expect(TogetherProfile.commentaryOpenings.length).toBeGreaterThan(0);
    });

    test('stopping restores the original object by reference', () => {
        const h = harness();
        const before = h.blackboard.mode;
        h.focus.start(h.at());
        expect(h.blackboard.mode).not.toBe(before);
        h.focus.stop('user', h.at());
        expect(h.blackboard.mode).toBe(before);
    });

    test('the break restores it too — she is only silent while you are working', () => {
        const h = harness();
        const before = h.blackboard.mode;
        h.focus.start(h.at());
        for (let second = 0; second < 25 * 60; second++) h.tick(SECOND);
        expect(h.blackboard.mode).toBe(before);
    });

    test('ten blocks leave the profile identical', () => {
        const h = harness();
        const before = h.blackboard.mode;
        h.focus.start(h.at());
        for (let second = 0; second < 10 * 30 * 60; second++) h.tick(SECOND);
        h.focus.stop('user', h.at());
        expect(h.blackboard.mode).toBe(before);
        expect(h.blackboard.mode.initiative.budgetPerSession).toBe(4);
    });

    test('an hour of blocks still restores the original', () => {
        const h = harness();
        const before = h.blackboard.mode;
        h.focus.start(h.at());
        for (let second = 0; second < 60 * 60; second++) h.tick(SECOND);
        h.focus.stop('user', h.at());
        expect(h.blackboard.mode).toBe(before);
    });

    test('applying the overlay twice does not snapshot the quiet profile', () => {
        // The phase machine restores on every break, so it never applies twice in a row —
        // which means the guard against it is unreachable from the outside and has to be
        // exercised here. Without it a second apply captures the *derived* profile as the
        // thing to restore, and she never speaks again after the first block.
        const h = harness();
        const before = h.blackboard.mode;
        h.focus.start(h.at());
        h.focus._applyOverlay();
        h.focus._applyOverlay();
        h.focus.stop('user', h.at());
        expect(h.blackboard.mode).toBe(before);
        expect(h.blackboard.mode.initiative.budgetPerSession).toBe(4);
    });

    test('the gate gets the profile back as well', () => {
        const h = harness();
        h.focus.start(h.at());
        h.focus.stop('user', h.at());
        expect(h.gate.profile).toBe(TogetherProfile);
        expect(h.gate.stats.openings.length).toBeGreaterThan(0);
    });

    test('detach releases whatever was held', () => {
        const h = harness();
        const before = h.blackboard.mode;
        h.focus.start(h.at());
        h.focus.detach();
        expect(h.blackboard.mode).toBe(before);
    });

    test('the overlay merges initiative rather than replacing it wholesale', () => {
        // B14's `derive` semantics, reused rather than reimplemented — so a field the
        // base profile sets and the overlay does not is still there.
        const derived = SceneJourney.derive(TogetherProfile, Focus.QUIET_OVERLAY);
        expect(derived.initiative.budgetPerSession).toBe(0);
        expect(derived.allows).toBe(TogetherProfile.allows);
    });
});

// ── mirroring, from idle and gaze signals alone ──────────────────────────────

describe('she mirrors instead of talking', () => {
    test('going still makes her settle', () => {
        const h = harness();
        h.focus.start(h.at());
        h.bus.emit('user:idle', {});
        expect(h.intents.map((i) => i.name)).toEqual([Focus.MIRROR.settle]);
    });

    test('coming back makes her nod', () => {
        const h = harness();
        h.focus.start(h.at());
        h.bus.emit('user:idle', {});
        h.tick(Focus.MIRROR_MIN_GAP_MS + SECOND);
        h.bus.emit('user:active', {});
        expect(h.intents.map((i) => i.name)).toEqual([Focus.MIRROR.settle, Focus.MIRROR.refocus]);
    });

    test('she does not nod at a refocus that never went away', () => {
        const h = harness();
        h.focus.start(h.at());
        h.bus.emit('user:active', {});
        expect(h.intents).toEqual([]);
    });

    test('a minute of twitching gets one mirror, not sixty', () => {
        const h = harness();
        h.focus.start(h.at());
        for (let i = 0; i < 60; i++) {
            h.bus.emit('user:idle', {});
            h.tick(SECOND);
        }
        expect(h.intents).toHaveLength(1);
    });

    test('the mirrors are gestures, gently', () => {
        const h = harness();
        h.focus.start(h.at());
        h.bus.emit('user:idle', {});
        expect(h.intents[0].intensity).toBeLessThanOrEqual(0.4);
        expect(h.intents[0].source).toBe('focus');
    });

    test('the mirrors are names, not filenames', () => {
        for (const name of Object.values(Focus.MIRROR)) {
            expect(name).not.toMatch(/\.(fbx|glb|vrma|bvh)$/i);
        }
    });

    test('she does not mirror during a break — the ordinary profile has that', () => {
        const h = harness();
        h.focus.start(h.at());
        for (let second = 0; second < 25 * 60; second++) h.tick(SECOND);
        const before = h.intents.length;
        h.bus.emit('user:idle', {});
        expect(h.intents).toHaveLength(before);
    });

    test('she does not mirror when no session is running', () => {
        const h = harness();
        h.bus.emit('user:idle', {});
        expect(h.intents).toEqual([]);
    });

    test('stopping unsubscribes her', () => {
        const h = harness();
        h.focus.start(h.at());
        h.focus.stop('user', h.at());
        h.bus.emit('user:idle', {});
        expect(h.intents).toEqual([]);
    });
});

// ── the streak goes up, and nothing is kept down here ────────────────────────

describe("the streak is the server's memory, not a local scoreboard", () => {
    test('a completed block sends exactly one frame', () => {
        const h = harness();
        h.focus.start(h.at());
        for (let second = 0; second < 25 * 60; second++) h.tick(SECOND);
        expect(h.sent).toEqual([{ v: 1, type: 'streak', activity: 'focus', value: 1 }]);
    });

    test('an abandoned block sends nothing', () => {
        const h = harness();
        h.focus.start(h.at());
        for (let second = 0; second < 20 * 60; second++) h.tick(SECOND);
        h.focus.stop('user', h.at());
        expect(h.sent).toEqual([]);
    });

    test('a block finished before the break is abandoned still counts', () => {
        const h = harness();
        h.focus.start(h.at());
        for (let second = 0; second < 26 * 60; second++) h.tick(SECOND);
        h.focus.stop('user', h.at());
        expect(h.sent).toHaveLength(1);
    });

    test('three blocks send three frames of one', () => {
        const h = harness();
        h.focus.start(h.at());
        for (let second = 0; second < 3 * 30 * 60; second++) h.tick(SECOND);
        expect(h.sent).toHaveLength(3);
        expect(h.sent.every((f) => f.value === 1)).toBe(true);
    });

    test('the client keeps no count of record', () => {
        // The server owns what a streak means; this reports only what happened this
        // session. A local `days` would be a second answer that drifts.
        const h = harness();
        h.focus.start(h.at());
        for (let second = 0; second < 30 * 60; second++) h.tick(SECOND);
        expect(Object.keys(h.focus.stats).sort()).toEqual(['blocks', 'mirrors', 'phase', 'quiet', 'sent']);
        expect(codeOf(fs.readFileSync(SOURCE, 'utf8'))).not.toContain('days');
    });

    test('a session that cannot send does not break the block', () => {
        const bus = new EventBus();
        const blackboard = new Blackboard();
        blackboard.mode = TogetherProfile;
        let clock = 0;
        const focus = Focus.attach({
            bus,
            blackboard,
            derive: SceneJourney.derive,
            session: {
                send() {
                    throw new Error('the socket is gone');
                },
            },
            now: () => clock,
        });
        focus.start(clock);
        for (let second = 0; second < 30 * 60; second++) {
            clock += SECOND;
            focus.update(clock);
        }
        expect(focus.stats.blocks).toBe(1);
        expect(focus.phase).toBe('focus');
    });

    test('no session at all is survivable', () => {
        const bus = new EventBus();
        const blackboard = new Blackboard();
        blackboard.mode = TogetherProfile;
        let clock = 0;
        const focus = Focus.attach({ bus, blackboard, derive: SceneJourney.derive, now: () => clock });
        focus.start(clock);
        for (let second = 0; second < 26 * 60; second++) {
            clock += SECOND;
            focus.update(clock);
        }
        expect(focus.stats.blocks).toBe(1);
    });
});

// ── the phase event ──────────────────────────────────────────────────────────

describe('one typed event carries the phase', () => {
    test('starting announces idle → focus', () => {
        const h = harness();
        const seen = [];
        h.bus.on('focus:phase', (e) => seen.push(e));
        h.focus.start(h.at());
        expect(seen).toHaveLength(1);
        expect(seen[0].from).toBe('idle');
        expect(seen[0].to).toBe('focus');
    });

    test('the boundary announces the block number', () => {
        const h = harness();
        const seen = [];
        h.bus.on('focus:phase', (e) => seen.push(e));
        h.focus.start(h.at());
        for (let second = 0; second < 25 * 60; second++) h.tick(SECOND);
        expect(seen[seen.length - 1]).toMatchObject({ from: 'focus', to: 'break', block: 1 });
    });

    test('stopping announces why', () => {
        const h = harness();
        const seen = [];
        h.bus.on('focus:phase', (e) => seen.push(e));
        h.focus.start(h.at());
        h.focus.stop('detached', h.at());
        expect(seen[seen.length - 1]).toMatchObject({ to: 'idle', why: 'detached' });
    });

    test('a tick with nothing running announces nothing', () => {
        const h = harness();
        const seen = [];
        h.bus.on('focus:phase', (e) => seen.push(e));
        h.tick(SECOND * 10000);
        expect(seen).toEqual([]);
    });

    test('the event name is in the bus vocabulary', () => {
        // The bus drops an event it does not know (§6.3's closed vocabulary), so a typo
        // reaches no listener. This passing is the vocabulary agreeing rather than this
        // file asserting a string it also chose.
        const bus = new EventBus();
        let heard = 0;
        bus.on('focus:phase', () => heard++);
        expect(bus.emit('focus:phase', { from: 'idle', to: 'focus' })).toBe(1);
        expect(bus.emit('focus:phaze', {})).toBe(0);
        expect(heard).toBe(1);
    });
});
