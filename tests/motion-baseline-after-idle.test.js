'use strict';

/**
 * "Stop" after a dance puts her back where she started — every time, not once.
 *
 * Reported with two screenshots: after a dance and a "stop" the character is
 * off her mark, twisted, and no longer centred the way she was on load.
 *
 * The settle itself works. What was missing was anything to settle back TO.
 * playAnimation refused to snapshot a baseline whenever a clip was already on
 * the mixer:
 *
 *     if (!st || !st.isPlaying) _capturePoseSnapshot(pr);
 *
 * The intent is right — never snapshot a pose mid-gesture. But after any
 * gesture _scheduleIdle plays neutral_idle.bvh, which LOOPS forever. So from
 * the second gesture onward something was always playing, no baseline was ever
 * captured, and _startPoseRestore() returned false. "Stop" fell through to
 * playAnimation('idle'), which overwrites bone rotations but never touches the
 * hips' local position or the root — leaving her displaced and mid-pose.
 *
 * That is why it looked intermittent: the FIRST dance after a page load works
 * (nothing is playing yet), and every one after it does not.
 */

/* global describe, test, expect, beforeEach, afterEach */

const Policy = require('../src/xr/MotionPolicy');
const PoseRestore = require('../src/xr/MotionPoseRestore');
const MI = require('../src/xr/MotionIntegration');

const IDLE_CLIP = 'vendor/animations/idle/neutral_idle.bvh';
const DANCE_CLIP = 'addons/vrma-dance/dance_rumba.vrma';

/** A bone-like node with the small surface MotionPoseRestore touches. */
function bone(pos) {
    const p = pos || [0, 0, 0];
    return {
        name: 'b',
        quaternion: { x: 0, y: 0, z: 0, w: 1, set() {}, copy() {} },
        position: { x: p[0], y: p[1], z: p[2], set() {}, copy() {} },
    };
}

let playing;

beforeEach(() => {
    Policy._setOverride({ enabled: true, movement: 'off' });
    MI.state.booted = true;
    MI.state.lastActivity = 'idle';
    PoseRestore.clear();
    playing = { isPlaying: false, clip: null, category: null };

    window.NEXUS_PROCEDURAL_ANIMATOR = { setAllowWithMixer: () => {} };
    window.__CLIP_ANIM_CONST__ = { setHumanoidAutoUpdate: () => {} };
    window.NEXUS_CLIP_LOADER = { getCurrentPlaybackState: () => playing };
    window.NEXUS_MOTION_CLIPS = {
        play: () => Promise.resolve({ ok: true, duration: 2, loop: true, sticky: true, then: null }),
        stop: () => {},
        availableNames: () => [],
    };

    const bones = { hips: bone([0, 1, 0]), spine: bone() };
    const root = bone([0, 0, 0]);
    root.rotation = { x: 0, y: Math.PI, z: 0 };
    root.userData = { isVRM: true };
    MI.onAvatarChanged(root, {
        humanoid: {
            humanBones: bones,
            getNormalizedBoneNode: (n) => bones[n] || null,
            getRawBoneNode: (n) => bones[n] || null,
        },
    });
});

afterEach(() => {
    MI.state.booted = false;
    MI.state.lastActivity = 'idle';
    PoseRestore.clear();
    Policy._setOverride(null);
    delete window.NEXUS_PROCEDURAL_ANIMATOR;
    delete window.__CLIP_ANIM_CONST__;
    delete window.NEXUS_CLIP_LOADER;
    delete window.NEXUS_MOTION_CLIPS;
});

describe('a baseline is captured whatever is on the mixer', () => {
    test('on a fresh load, with nothing playing — this always worked', () => {
        MI.playAnimation('dance');
        expect(PoseRestore.hasSnapshot()).toBe(true);
    });

    test('with the idle loop playing — the reported bug', () => {
        playing = { isPlaying: true, clip: IDLE_CLIP, category: null };
        MI.state.lastActivity = 'idle';
        MI.playAnimation('dance');
        expect(PoseRestore.hasSnapshot()).toBe(true);
    });

    test('with the seated idle playing', () => {
        playing = { isPlaying: true, clip: 'vendor/animations/sitting/sit_idle4.bvh', category: null };
        MI.state.lastActivity = 'sit_idle';
        MI.playAnimation('wave');
        expect(PoseRestore.hasSnapshot()).toBe(true);
    });

    test('with the talking idle playing', () => {
        playing = { isPlaying: true, clip: IDLE_CLIP, category: null };
        MI.state.lastActivity = 'talking';
        MI.playAnimation('dance');
        expect(PoseRestore.hasSnapshot()).toBe(true);
    });
});

describe('a pose mid-GESTURE is still never snapshotted', () => {
    test('a second gesture during a dance does not overwrite the baseline', () => {
        // The original guard's real purpose, which must survive the fix.
        playing = { isPlaying: true, clip: DANCE_CLIP, category: null };
        MI.state.lastActivity = 'dance';
        MI.playAnimation('wave');
        expect(PoseRestore.hasSnapshot()).toBe(false);
    });

    test('nor during any other performed clip', () => {
        for (const activity of ['wave', 'bow', 'greeting', 'clap']) {
            PoseRestore.clear();
            playing = { isPlaying: true, clip: 'addons/vrma-actions/x.vrma', category: null };
            MI.state.lastActivity = activity;
            MI.playAnimation('dance');
            expect(PoseRestore.hasSnapshot()).toBe(false);
        }
    });
});

describe('the surrounding contract is unchanged', () => {
    test('ambient names never take the baseline themselves', () => {
        playing = { isPlaying: false, clip: null, category: null };
        for (const name of ['idle', 'sit_idle', 'talking']) {
            PoseRestore.clear();
            MI.playAnimation(name);
            expect(PoseRestore.hasSnapshot()).toBe(false);
        }
    });

    test('a posture change still clears the baseline rather than keeping it', () => {
        MI.playAnimation('dance');
        expect(PoseRestore.hasSnapshot()).toBe(true);
        MI.playAnimation('sit');
        expect(PoseRestore.hasSnapshot()).toBe(false);
    });

    test('an existing baseline is never replaced by a later gesture', () => {
        MI.playAnimation('dance');
        expect(PoseRestore.hasSnapshot()).toBe(true);
        playing = { isPlaying: true, clip: IDLE_CLIP, category: null };
        MI.state.lastActivity = 'idle';
        MI.playAnimation('wave'); // must not re-snapshot over the first one
        expect(PoseRestore.hasSnapshot()).toBe(true);
    });
});

describe('so the settle actually has something to run', () => {
    test('_startPoseRestore succeeds after a dance from the idle loop', () => {
        playing = { isPlaying: true, clip: IDLE_CLIP, category: null };
        MI.state.lastActivity = 'idle';
        MI.playAnimation('dance');
        expect(MI._startPoseRestore()).toBe(true);
        expect(PoseRestore.isBlending()).toBe(true);
    });
});
