/**
 * "Stop" has to be able to get her out of the chair.
 *
 * Reported: after "sit down", saying "stop" left her sitting. The stop handler
 * cleared follow, reach, IK and any pending contact — but never touched
 * `state.sitting`. _scheduleIdle's very first branch is
 *
 *     if (state.sitting) playAnimation('sit_idle');
 *
 * so the idle it scheduled put her straight back into the seated loop. Two
 * consequences: nothing short of an explicit "stand up" released the posture,
 * and the pose-restore settle in the third branch was unreachable, so the body
 * never returned to the pose it held before the sequence.
 *
 * MotionPolicy lists 'stop' in ALWAYS_ALLOWED — it is the universal escape
 * hatch, and an escape hatch that cannot escape one specific state is broken.
 */

/* global describe, test, expect, beforeEach, afterEach */

const Policy = require('../src/xr/MotionPolicy');
const MI = require('../src/xr/MotionIntegration');

let handlers;
let played;

/** Minimal VRM-like root: ViewerEngine rests VRM roots at yaw = π. */
function fakeRoot() {
    return {
        position: { x: 0, y: 0, z: 0, clone: () => ({ x: 0, y: 0, z: 0 }) },
        rotation: { x: 0, y: Math.PI, z: 0 },
        userData: { isVRM: true },
    };
}

beforeEach(() => {
    Policy._setOverride({ enabled: true, movement: 'off' });
    handlers = Object.create(null);
    played = [];

    window.MotionDSL = {
        registerHandler: (name, fn) => {
            handlers[name] = fn;
        },
    };
    window.NEXUS_VIEWER = { scene: {}, avatarManager: { currentRoot: fakeRoot(), _currentVRM: null } };
    window.__CLIP_ANIM_STATE__ = { avatarRoot: fakeRoot(), avatarVRM: null };
    window.NEXUS_CLIP_LOADER = { getCurrentPlaybackState: () => ({ isPlaying: false }) };
    window.NEXUS_MOTION_CLIPS = {
        play: (name) => {
            played.push(name);
            // 'stand' resolves to action_standup.bvh — 104 frames at 1/30 s.
            const duration = name === 'stand' ? 3.47 : 1;
            return Promise.resolve({ ok: true, duration, loop: false, sticky: false, then: null });
        },
        stop: () => {},
        availableNames: () => [],
    };

    MI.state.booted = false;
    MI.state.sitting = false;
    MI.boot();
});

afterEach(() => {
    MI.state.booted = false;
    MI.state.sitting = false;
    Policy._setOverride(null);
    delete window.MotionDSL;
    delete window.NEXUS_VIEWER;
    delete window.__CLIP_ANIM_STATE__;
    delete window.NEXUS_CLIP_LOADER;
    delete window.NEXUS_MOTION_CLIPS;
});

/** Let the play() promise chains settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the handlers are wired at all', () => {
    test('boot registered both posture handlers and stop', () => {
        for (const name of ['sit', 'stand', 'stop']) {
            expect(typeof handlers[name]).toBe('function');
        }
    });
});

describe('stop releases the seated posture', () => {
    test('sitting down sets the posture and plays the sit clip', async () => {
        await handlers.sit({});
        await flush();
        expect(MI.state.sitting).toBe(true);
        expect(played).toContain('sit');
    });

    test('stop stands her back up — the reported bug', async () => {
        await handlers.sit({});
        await flush();
        played.length = 0;

        await handlers.stop({});
        await flush();

        expect(MI.state.sitting).toBe(false);
        expect(played).toContain('stand');
    });

    test('stop never re-enters the seated loop', async () => {
        await handlers.sit({});
        await flush();
        played.length = 0;

        await handlers.stop({});
        // _scheduleIdle's floor is 200 ms, so the idle it queues has to be
        // given time to fire — flushing microtasks alone makes this assertion
        // vacuous and it passes even with the bug present.
        await new Promise((r) => setTimeout(r, 300));

        expect(played).not.toContain('sit_idle');
        expect(played).not.toContain('sit');
    });

    test('stop while already standing does not play a stand-up', async () => {
        expect(MI.state.sitting).toBe(false);
        await handlers.stop({});
        await flush();
        expect(played).not.toContain('stand');
    });

    test('stop is idempotent — a second stop is a no-op', async () => {
        await handlers.sit({});
        await flush();
        await handlers.stop({});
        await flush();
        played.length = 0;

        await handlers.stop({});
        await flush();
        expect(played).not.toContain('stand');
        expect(MI.state.sitting).toBe(false);
    });

    test('the world snapshot is correct SYNCHRONOUSLY — the narration bug', async () => {
        // main.js calls onUserUtterance(text) and then builds the chat request;
        // systemPromptSuffix() reads getWorldSnapshot() in the same synchronous
        // run. Clearing the posture after an await left the model prompted with
        // avatar_sitting=yes on the turn the user said "stop", and it replied
        // "I'll sit back down once more..." instead of acknowledging the stop.
        await handlers.sit({});
        await flush();
        expect(MI.getWorldSnapshot().avatar.sitting).toBe(true);

        handlers.stop({}); // deliberately NOT awaited — this is the race
        expect(MI.getWorldSnapshot().avatar.sitting).toBe(false);
    });

    test('stop tells the model what it just did', async () => {
        await handlers.sit({});
        await flush();
        handlers.stop({});
        const snap = MI.getWorldSnapshot();
        expect(snap.last_action).toEqual({ type: 'stop', result: 'stood_up' });
        expect(snap.avatar.state).not.toBe('sit');
    });

    test('a stop while standing reports itself too', async () => {
        handlers.stop({});
        expect(MI.getWorldSnapshot().last_action).toEqual({ type: 'stop', result: 'stopped' });
    });

    test('an explicit "stand up" still works on its own', async () => {
        await handlers.sit({});
        await flush();
        played.length = 0;

        await handlers.stand({});
        await flush();
        expect(MI.state.sitting).toBe(false);
        expect(played).toContain('stand');
    });
});
