/**
 * The executor — pose-buffer blending, crossfades, and the single owner (B6).
 *
 * §6.6 calls this the one hard problem, so the tests go after the thing that actually
 * breaks: a **pop**. A pop is a large orientation change between consecutive frames, so the
 * tests measure exactly that — step a full procedural → BVH → VRMA sequence one frame at a
 * time and assert no bone ever moves more than a crossfade should allow.
 *
 * The layer adapters that touch THREE are driven through injected fakes, matching the
 * repo's existing convention (see tests/bvh-retarget.test.js): the maths is pinned here,
 * playback is a browser concern.
 */

/* global describe, test, expect, beforeEach */

const Pose = require('../../src/behavior/mixer/PoseBuffer.js');
const Masks = require('../../src/behavior/mixer/BoneMasks.js');
const { Mixer } = require('../../src/behavior/mixer/LayerMixer.js');
const Rules = require('../../src/behavior/scheduler/TransitionRules.js');
const { ClipScheduler } = require('../../src/behavior/scheduler/Scheduler.js');
const { Layer: ProceduralLayerClass } = require('../../src/behavior/mixer/ProceduralLayer.js');
const { Layer: PoseLayerClass } = require('../../src/behavior/mixer/PoseLayer.js');
const EventBus = require('../../src/behavior/EventBus.js');

const CONFIG = JSON.parse(
    require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'config', 'behavior.config.json'), 'utf8')
);

/** A quaternion for a rotation of `angle` about Y. */
function aboutY(angle) {
    return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
}

describe('quaternion blending', () => {
    test('slerp reaches both ends exactly', () => {
        const a = aboutY(0);
        const b = aboutY(Math.PI / 2);
        expect(Pose.slerp(a, b, 0)).toEqual(a);
        expect(Pose.slerp(a, b, 1)).toEqual(b);
    });

    test('it takes the short way round — the double-cover fix', () => {
        // q and -q are the same rotation. Without the sign flip, interpolating between them
        // spins the bone nearly all the way around, which is the pop §6.6 is about.
        const a = aboutY(0.2);
        const negated = aboutY(0.2).map((v) => -v);
        const mid = Pose.slerp(a, negated, 0.5);
        expect(Pose.angleBetween(a, mid)).toBeLessThan(1e-6);
    });

    test('nearly parallel rotations do not lose precision', () => {
        const a = aboutY(0.0001);
        const b = aboutY(0.0002);
        const mid = Pose.slerp(a, b, 0.5);
        for (const value of mid) expect(Number.isFinite(value)).toBe(true);
        expect(Math.hypot(...mid)).toBeCloseTo(1, 6);
    });

    test('the result always stays a unit quaternion', () => {
        for (let t = 0; t <= 1; t += 0.05) {
            const q = Pose.slerp(aboutY(0), aboutY(2.9), t);
            expect(Math.hypot(...q)).toBeCloseTo(1, 6);
        }
    });
});

describe('bone masks', () => {
    test('upperBody leaves the legs alone', () => {
        expect(Masks.covers('upperBody', 'leftUpperArm')).toBe(true);
        expect(Masks.covers('upperBody', 'leftUpperLeg')).toBe(false);
        expect(Masks.covers('fullBody', 'leftUpperLeg')).toBe(true);
    });

    test('head is its own mask, so look-at survives a full-body clip', () => {
        expect(Masks.covers('head', 'head')).toBe(true);
        expect(Masks.covers('head', 'hips')).toBe(false);
    });

    test('an unknown mask owns nothing rather than everything', () => {
        expect(Masks.covers('nonsense', 'hips')).toBe(false);
    });

    test('the complement of upperBody is what a lower layer keeps', () => {
        const kept = Masks.complementOf('upperBody');
        expect(kept).toContain('leftUpperLeg');
        expect(kept).not.toContain('leftUpperArm');
    });
});

describe('the mixer writes each bone exactly once', () => {
    let mixer;
    let writes;

    beforeEach(() => {
        writes = [];
        mixer = new Mixer({ applyBone: (bone, q) => writes.push([bone, q]) });
    });

    test('one write per bone, however many layers touched it', () => {
        const a = mixer.addLayer({ name: 'a', mask: 'fullBody', order: 0, weight: 1 });
        const b = mixer.addLayer({ name: 'b', mask: 'upperBody', order: 1, weight: 1 });
        a.buffer.set('hips', aboutY(0.1)).set('leftUpperArm', aboutY(0.2));
        b.buffer.set('leftUpperArm', aboutY(0.5));

        mixer.update();
        const bones = writes.map(([bone]) => bone);
        expect(new Set(bones).size).toBe(bones.length);
        expect(mixer.lastWriteCount).toBe(2);
    });

    test('a layer only touches what its mask covers', () => {
        const legs = mixer.addLayer({ name: 'legs', mask: 'fullBody', order: 0, weight: 1 });
        const arms = mixer.addLayer({ name: 'arms', mask: 'upperBody', order: 1, weight: 1 });
        legs.buffer.set('leftUpperLeg', aboutY(0.4));
        arms.buffer.set('leftUpperLeg', aboutY(1.4)); // outside its mask — must be ignored

        const result = mixer.update();
        expect(Pose.angleBetween(result.get('leftUpperLeg'), aboutY(0.4))).toBeLessThan(1e-6);
    });

    test('a layer at weight 0 reveals the corrected base pose, not a raw T-pose', () => {
        // §5.P4: T-pose correction and Natural Pose Style stay underneath everything.
        mixer.basePose.set('leftUpperArm', aboutY(0.35));
        const layer = mixer.addLayer({ name: 'clip', mask: 'fullBody', order: 0, weight: 0 });
        layer.buffer.set('leftUpperArm', aboutY(1.2));

        const result = mixer.update();
        expect(Pose.angleBetween(result.get('leftUpperArm'), aboutY(0.35))).toBeLessThan(1e-6);
    });

    test('weight interpolates between the layers rather than switching', () => {
        mixer.basePose.set('head', aboutY(0));
        const layer = mixer.addLayer({ name: 'clip', mask: 'fullBody', order: 0, weight: 0.5 });
        layer.buffer.set('head', aboutY(1));

        const result = mixer.update();
        const angle = Pose.angleBetween(aboutY(0), result.get('head'));
        expect(angle).toBeGreaterThan(0.4);
        expect(angle).toBeLessThan(0.6);
    });
});

describe('procedural → BVH → VRMA crossfades without pops', () => {
    /**
     * The acceptance criterion, measured rather than asserted by eye.
     *
     * Three sources take the rig in turn while the scheduler animates the crossfade. Every
     * frame is compared with the one before it: a fade is smooth when no bone jumps more
     * than a fade of that length could account for. A snap shows up as a single large step.
     */
    function runSequence({ frameMs = 16.67 } = {}) {
        const bus = new EventBus();
        const mixer = new Mixer();
        mixer.basePose.set('hips', aboutY(0)).set('leftUpperArm', aboutY(0.2)).set('head', aboutY(0));

        // Two clip slots: a crossfade needs the outgoing pose to still be there.
        const slotA = mixer.addLayer({ name: 'clipA', mask: 'fullBody', order: 1, weight: 0 });
        const slotB = mixer.addLayer({ name: 'clipB', mask: 'fullBody', order: 2, weight: 0 });
        const slots = { clipA: slotA, clipB: slotB };
        const headLayer = mixer.addLayer({ name: 'head', mask: 'head', order: 3, weight: 1 });
        headLayer.buffer.set('head', aboutY(0.15)); // look-at, always on

        let clock = 0;
        const scheduler = new ClipScheduler({ mixer, bus, now: () => clock });

        const procedural = {
            id: 'proc_behavior_happy',
            kind: 'procedural',
            layer: 'fullBody',
            priority: 3,
            loop: true,
            stats: {},
        };
        const bvh = { id: 'bvh_dance_dance_1', kind: 'bvh', layer: 'fullBody', priority: 4, loop: true, stats: {} };
        const vrma = {
            id: 'vrma_action_waving',
            kind: 'vrma',
            layer: 'fullBody',
            priority: 4,
            loop: false,
            stats: { duration: 4 },
        };

        // What each source puts on the arm — deliberately far apart, so a snap is obvious.
        const poses = {
            proc_behavior_happy: aboutY(0.6),
            bvh_dance_dance_1: aboutY(2.2),
            vrma_action_waving: aboutY(-1.7),
        };

        const frames = [];
        const steps = [procedural, bvh, vrma];
        let stepIndex = 0;

        for (let frame = 0; frame < 90; frame++) {
            // Hand over every 30 frames, which is inside every fade in the matrix.
            if (frame % 30 === 0 && stepIndex < steps.length) {
                scheduler.request(steps[stepIndex++]);
            }
            clock += frameMs;
            scheduler.tick(frameMs / 1000);

            // Each live clip renders into its own slot, exactly as a ClipLayer pair would.
            for (const entry of [scheduler.current, scheduler.previous]) {
                if (!entry) continue;
                const buffer = slots[entry.slot].buffer;
                buffer.clear();
                buffer.set('leftUpperArm', poses[entry.clip.id]).set('hips', aboutY(0.05));
            }

            frames.push(mixer.update().get('leftUpperArm').slice());
        }
        return { frames, bus, scheduler, mixer };
    }

    test('no bone jumps between consecutive frames', () => {
        const { frames } = runSequence();
        let worst = 0;
        for (let i = 1; i < frames.length; i++) {
            worst = Math.max(worst, Pose.angleBetween(frames[i - 1], frames[i]));
        }
        // A 0.12 s fade over a 2.2 rad change is ~0.05 rad/frame at 60 Hz. A snap would be
        // the whole 2.2 in one step; anything above a quarter radian is not a crossfade.
        expect(worst).toBeLessThan(0.25);
    });

    test('and the arm really does travel the whole way — the fade is not just slow', () => {
        const { frames } = runSequence();
        const travelled = Pose.angleBetween(frames[0], frames[frames.length - 1]);
        expect(travelled).toBeGreaterThan(0.5);
    });

    test('lipsync and look-at survive a full-body clip', () => {
        // The head layer sits above the clip with its own mask, so a dance that owns
        // everything from the neck down never takes the head with it.
        const { mixer } = runSequence();
        const head = mixer.update().get('head');
        expect(Pose.angleBetween(head, aboutY(0.15))).toBeLessThan(1e-6);
    });

    test('the pop detector is not measuring a fade that never happened', () => {
        // Guard against the reassuring-but-empty version of the test above: if the sequence
        // never actually handed over, "no pops" would pass trivially.
        const { scheduler } = runSequence();
        expect(scheduler.state.playing).toBe('vrma_action_waving');
    });
});

describe('the scheduler', () => {
    let bus;
    let scheduler;
    let clock;

    const clip = (over) => ({
        id: 'x',
        layer: 'fullBody',
        priority: 3,
        interruptible: true,
        loop: true,
        stats: {},
        ...over,
    });

    beforeEach(() => {
        clock = 0;
        bus = new EventBus();
        scheduler = new ClipScheduler({ mixer: new Mixer(), bus, now: () => clock });
    });

    test('announces what starts and what ends', () => {
        const events = [];
        bus.on('anim:started', (e) => events.push(`start:${e.id}`));
        bus.on('anim:ended', (e) => events.push(`end:${e.id}`));

        scheduler.request(clip({ id: 'a' }));
        clock = 5000;
        scheduler.request(clip({ id: 'b' }));
        expect(events).toEqual(['start:a', 'end:a', 'start:b']);
    });

    test('a reaction preempts an idle', () => {
        scheduler.request(clip({ id: 'idle', priority: 1 }));
        clock = 1000;
        expect(scheduler.request(clip({ id: 'react', priority: 4 })).accepted).toBe(true);
        expect(scheduler.state.playing).toBe('react');
    });

    test('an idle never preempts a reaction', () => {
        scheduler.request(clip({ id: 'react', priority: 4 }));
        clock = 1000;
        const result = scheduler.request(clip({ id: 'idle', priority: 1 }));
        expect(result.accepted).toBe(false);
        expect(scheduler.state.playing).toBe('react');
    });

    test('an equal-priority clip waits for the minimum play time', () => {
        scheduler.request(clip({ id: 'first', priority: 3 }));
        clock = 100; // inside the emote minimum
        expect(scheduler.request(clip({ id: 'second', priority: 3 })).accepted).toBe(false);
        clock = 900;
        expect(scheduler.request(clip({ id: 'third', priority: 3 })).accepted).toBe(true);
    });

    test('an uninterruptible clip holds against equal priority and yields to higher', () => {
        scheduler.request(clip({ id: 'sit', priority: 2, interruptible: false }));
        clock = 5000;
        expect(scheduler.request(clip({ id: 'equal', priority: 2 })).accepted).toBe(false);
        expect(scheduler.request(clip({ id: 'urgent', priority: 4 })).accepted).toBe(true);
    });

    test('higher-priority work that has to wait is queued, not dropped', () => {
        scheduler.request(clip({ id: 'first', priority: 3 }));
        clock = 50;
        const result = scheduler.request(clip({ id: 'next', priority: 3 }));
        expect(result.queued).toBe(true);
        expect(scheduler.state.queued).toEqual(['next']);
    });

    test('a finished one-shot lets the queue through', () => {
        scheduler.request(clip({ id: 'wave', priority: 3, loop: false, stats: { duration: 1 } }));
        clock = 50;
        scheduler.request(clip({ id: 'after', priority: 3 }));
        for (let i = 0; i < 70; i++) scheduler.tick(0.0167);
        expect(scheduler.state.playing).toBe('after');
    });
});

describe('the single-owner rule', () => {
    test('every approved request goes through AnimationResolver', () => {
        const played = [];
        const resolver = { play: (id, opts) => played.push([id, opts.source]), stop: () => played.push(['stop']) };
        const scheduler = new ClipScheduler({ mixer: new Mixer(), resolver, now: () => 0 });

        scheduler.request({ id: 'bvh_dance_dance_1', layer: 'fullBody', priority: 4, loop: true, stats: {} });
        expect(played).toEqual([['bvh_dance_dance_1', 'behavior-director']]);

        scheduler.stop();
        expect(played[1]).toEqual(['stop']);
    });

    test('a refused request never reaches the resolver — the rig has one owner', () => {
        const played = [];
        const resolver = { play: (id) => played.push(id) };
        const scheduler = new ClipScheduler({ mixer: new Mixer(), resolver, now: () => 0 });

        scheduler.request({ id: 'react', layer: 'fullBody', priority: 4, loop: true, stats: {} });
        scheduler.request({ id: 'idle', layer: 'fullBody', priority: 1, loop: true, stats: {} });
        expect(played).toEqual(['react']);
    });

    test('a resolver that throws costs the clip, not the frame', () => {
        const scheduler = new ClipScheduler({
            mixer: new Mixer(),
            resolver: {
                play() {
                    throw new Error('no avatar loaded');
                },
            },
            now: () => 0,
        });
        expect(() =>
            scheduler.request({ id: 'x', layer: 'fullBody', priority: 3, loop: true, stats: {} })
        ).not.toThrow();
    });
});

describe('the layers reuse what already exists', () => {
    test('ProceduralLayer runs the existing animator and reads the rig back', () => {
        const calls = [];
        const animator = { update: (t, dt) => calls.push([t, dt]), setMode: (m) => calls.push(['mode', m]) };
        const humanoid = {
            getNormalizedBoneNode: (bone) => ({ quaternion: { x: 0, y: 0.1, z: 0, w: 0.99 }, name: bone }),
        };
        const layer = new ProceduralLayerClass({ animator, humanoid }).watch(['hips', 'head']);

        layer.setMode('happy', 300);
        const buffer = layer.sample(1.5, 0.016);
        expect(calls).toEqual([
            ['mode', 'happy'],
            [1.5, 0.016],
        ]);
        expect(buffer.bones).toEqual(['hips', 'head']);
    });

    test('an animator that throws does not take the frame with it', () => {
        const layer = new ProceduralLayerClass({
            animator: {
                update() {
                    throw new Error('bad mode');
                },
            },
            humanoid: null,
        }).watch(['hips']);
        expect(() => layer.sample(0, 0.016)).not.toThrow();
    });

    test('PoseLayer reads the pose library, in either stored format', () => {
        const library = {
            get: (id) =>
                id === 'quat' ? { bones: { head: [0, 0.2, 0, 0.98] } } : { bones: { head: { x: 0.3, y: 0, z: 0 } } },
        };
        const layer = new PoseLayerClass({ library });

        expect(layer.setPose('quat')).toBe(true);
        expect(layer.buffer.get('head')[1]).toBeCloseTo(0.2);

        expect(layer.setPose('euler')).toBe(true);
        expect(Math.hypot(...layer.buffer.get('head'))).toBeCloseTo(1, 6);
    });

    test('a missing pose is survivable', () => {
        const layer = new PoseLayerClass({ library: { get: () => null } });
        expect(layer.setPose('nope')).toBe(false);
        expect(layer.buffer.bones).toEqual([]);
    });
});

describe('the frame budget of §9', () => {
    test('the whole blend stays far under 2 ms on a full humanoid', () => {
        const mixer = new Mixer({ applyBone: () => {} });
        const bones = Masks.bonesFor('fullBody'); // every bone, fingers included
        for (const bone of bones) mixer.basePose.set(bone, aboutY(0.1));

        for (const [name, mask, order] of [
            ['proc', 'fullBody', 0],
            ['clip', 'fullBody', 1],
            ['gesture', 'upperBody', 2],
            ['head', 'head', 3],
        ]) {
            const layer = mixer.addLayer({ name, mask, order, weight: 0.5 });
            for (const bone of Masks.bonesFor(mask)) layer.buffer.set(bone, aboutY(0.3));
        }

        const scheduler = new ClipScheduler({ mixer, now: () => 0 });
        scheduler.request({ id: 'x', layer: 'fullBody', priority: 3, loop: true, stats: {} });

        const FRAMES = 600;
        // Best of five. What is being measured is a floor — what the code can do — and the
        // noise above it is the machine, not the mixer. A single run of this on a loaded
        // box drifts by a factor of two, which made the first version of this assertion a
        // flake rather than a budget.
        let msPerFrame = Infinity;
        for (let run = 0; run < 5; run++) {
            const started = process.hrtime.bigint();
            for (let i = 0; i < FRAMES; i++) {
                scheduler.tick(0.0167);
                mixer.update();
            }
            msPerFrame = Math.min(msPerFrame, Number(process.hrtime.bigint() - started) / 1e6 / FRAMES);
        }

        // §9 budgets 2 ms for the whole engine on Quest-class hardware. This is the blend
        // and the scheduler — the heaviest per-frame part — measured on four layers over
        // every humanoid bone. Node is not a Quest, so the margin is what matters: a
        // quarter of the whole engine's budget for its heaviest part leaves the real one
        // reachable, and a regression that costs an order of magnitude still fails here.
        expect(msPerFrame).toBeLessThan(CONFIG.budgets.frameMs / 4);
        expect(mixer.lastWriteCount).toBe(bones.length);
    });
});
