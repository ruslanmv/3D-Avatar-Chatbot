/**
 * Pose snapshot & restore ("she returns exactly as she was").
 *
 * Contract under test: the FIRST clip of a sequence snapshots every humanoid
 * bone rotation + the hips' local position (+ the root position, guarded);
 * a stop or a natural finish settles the body back to that snapshot over an
 * eased blend; locomotion since the snapshot disables the root part so
 * "come with me" is never undone; sit/stand start a fresh baseline; and the
 * ambient system is paused for the blend and handed the body back after.
 */

/* global describe, test, expect, beforeEach, afterEach, afterAll */

const PoseRestore = require('../src/xr/MotionPoseRestore');
const MI = require('../src/xr/MotionIntegration');
const Policy = require('../src/xr/MotionPolicy');

function fakeBone(q, p) {
    return {
        quaternion: {
            x: q[0],
            y: q[1],
            z: q[2],
            w: q[3],
            set(x, y, z, w) {
                this.x = x;
                this.y = y;
                this.z = z;
                this.w = w;
            },
        },
        position: {
            x: p ? p[0] : 0,
            y: p ? p[1] : 0,
            z: p ? p[2] : 0,
            set(x, y, z) {
                this.x = x;
                this.y = y;
                this.z = z;
            },
        },
    };
}

beforeEach(() => PoseRestore.clear());
afterAll(() => {
    PoseRestore.clear();
    Policy._setOverride(null);
});

describe('MotionPoseRestore — pure blend math', () => {
    test('captures once; later captures keep the ORIGINAL snapshot', () => {
        const b = fakeBone([0, 0, 0, 1]);
        expect(PoseRestore.capture({ bones: [b] })).toBe(true);
        b.quaternion.set(0, 0.7071, 0, 0.7071);
        expect(PoseRestore.capture({ bones: [b] })).toBe(false); // ignored
        PoseRestore.start(0.5);
        let guard = 0;
        while (PoseRestore.update(0.1) && guard++ < 20);
        expect(Math.abs(b.quaternion.w - 1)).toBeLessThan(1e-6); // back to ORIGINAL
        expect(PoseRestore.hasSnapshot()).toBe(false); // consumed
    });

    test('the settle converges exactly, through intermediate frames', () => {
        const b = fakeBone([0, 0, 0, 1]);
        const hips = fakeBone([0, 0, 0, 1], [0, 1, 0]);
        PoseRestore.capture({ bones: [b, hips], hips });
        b.quaternion.set(0, 1, 0, 0); // clip left her twisted 180°
        hips.position.set(0.8, 1, -0.4); // and displaced
        PoseRestore.start(0.5);
        PoseRestore.update(0.25); // halfway
        expect(Math.abs(b.quaternion.y)).toBeGreaterThan(0.05);
        expect(Math.abs(b.quaternion.y)).toBeLessThan(0.999); // actually mid-blend
        expect(PoseRestore.isBlending()).toBe(true);
        PoseRestore.update(0.3); // past the end
        expect(Math.abs(hips.position.x)).toBeLessThan(1e-6);
        expect(Math.abs(hips.position.z)).toBeLessThan(1e-6);
        const q = b.quaternion;
        expect(Math.abs(Math.abs(q.w) - 1)).toBeLessThan(1e-6); // identity (±q is the same rotation)
        expect(PoseRestore.isBlending()).toBe(false);
    });

    test('root position restores on x/z — unless locomotion invalidated it', () => {
        const b = fakeBone([0, 0, 0, 1]);
        const root = fakeBone([0, 0, 0, 1], [0, 0, 0]);
        PoseRestore.capture({ bones: [b], root });
        root.position.set(2, 0.1, -3); // clip drifted the root
        PoseRestore.start(0.2);
        while (PoseRestore.update(0.1));
        expect(Math.abs(root.position.x)).toBeLessThan(1e-6);
        expect(Math.abs(root.position.z)).toBeLessThan(1e-6);
        expect(root.position.y).toBeCloseTo(0.1, 10); // y stays live

        PoseRestore.capture({ bones: [b], root });
        root.position.set(5, 0, 5);
        PoseRestore.invalidateRoot(); // "come with me" happened
        PoseRestore.start(0.2);
        while (PoseRestore.update(0.1));
        expect(root.position.x).toBeCloseTo(5, 10); // walk NOT undone
        expect(root.position.z).toBeCloseTo(5, 10);
    });
});

describe('MotionIntegration wiring', () => {
    let procCalls;
    let stopCalls;
    beforeEach(() => {
        Policy._setOverride({ enabled: true, movement: 'off' });
        MI.state.booted = true;
        procCalls = [];
        stopCalls = [];
        window.NEXUS_PROCEDURAL_ANIMATOR = { setAllowWithMixer: (v) => procCalls.push(v) };
        window.__CLIP_ANIM_CONST__ = { setHumanoidAutoUpdate: () => procCalls.push('autoUpdate') };
        window.NEXUS_CLIP_LOADER = { getCurrentPlaybackState: () => ({ isPlaying: false }) };
        window.NEXUS_MOTION_CLIPS = {
            play: () => Promise.resolve({ ok: true, duration: 1, loop: false, sticky: false, then: null }),
            stop: (opts) => stopCalls.push(opts),
            availableNames: () => [],
        };
    });
    afterEach(() => {
        MI.state.booted = false;
        PoseRestore.clear();
        delete window.NEXUS_PROCEDURAL_ANIMATOR;
        delete window.__CLIP_ANIM_CONST__;
        delete window.NEXUS_CLIP_LOADER;
        delete window.NEXUS_MOTION_CLIPS;
    });

    function attachAvatar() {
        const bones = { hips: fakeBone([0, 0, 0, 1], [0, 1, 0]), spine: fakeBone([0, 0, 0, 1]) };
        const root = fakeBone([0, 0, 0, 1], [0, 0, 0]);
        root.rotation = { x: 0, y: Math.PI, z: 0 };
        root.userData = { isVRM: true };
        MI.onAvatarChanged(root, {
            humanoid: {
                humanBones: { hips: {}, spine: {} },
                getNormalizedBoneNode: (n) => bones[n] || null,
            },
        });
        return bones;
    }

    test('a gesture snapshots; ambient names do not; sit clears the baseline', () => {
        attachAvatar();
        MI.playAnimation('idle');
        expect(PoseRestore.hasSnapshot()).toBe(false);
        MI.playAnimation('dance');
        expect(PoseRestore.hasSnapshot()).toBe(true);
        MI.playAnimation('sit');
        expect(PoseRestore.hasSnapshot()).toBe(false); // new baseline
    });

    test('the settle stops the clip, pauses ambient, then hands the body back', () => {
        const bones = attachAvatar();
        MI.playAnimation('wave');
        expect(PoseRestore.hasSnapshot()).toBe(true);
        bones.hips.quaternion.set(0, 1, 0, 0); // pretend the clip moved her

        expect(MI._startPoseRestore()).toBe(true);
        expect(stopCalls.length).toBe(1);
        expect(stopCalls[0]._skipRestore).toBe(true); // ambient stays paused for the blend
        // The blend pauses the ambient animator AND pins autoUpdateHumanBones
        // off, so its raw-bone writes are not re-derived from normalized
        // mid-settle (ClipAnimationLoader.js:168-169).
        expect(procCalls).toEqual([false, 'autoUpdate']);
        expect(PoseRestore.isBlending()).toBe(true);

        for (let i = 0; i < 12 && PoseRestore.isBlending(); i++) MI.update(0.1);
        expect(PoseRestore.isBlending()).toBe(false);
        expect(Math.abs(Math.abs(bones.hips.quaternion.w) - 1)).toBeLessThan(1e-6); // settled home
        expect(procCalls).toEqual([false, 'autoUpdate', true, 'autoUpdate']); // handed back
        expect(MI._startPoseRestore()).toBe(false); // nothing left to restore
    });
});

describe('both humanoid rigs are restored (BVH vs VRMA)', () => {
    beforeEach(() => {
        Policy._setOverride({ enabled: true, movement: 'off' });
        MI.state.booted = true;
        window.NEXUS_PROCEDURAL_ANIMATOR = { setAllowWithMixer: () => {} };
        window.__CLIP_ANIM_CONST__ = { setHumanoidAutoUpdate: () => {} };
        window.NEXUS_CLIP_LOADER = { getCurrentPlaybackState: () => ({ isPlaying: false }) };
        window.NEXUS_MOTION_CLIPS = {
            play: () => Promise.resolve({ ok: true, duration: 1, loop: false, sticky: false, then: null }),
            stop: () => {},
            availableNames: () => [],
        };
    });
    afterEach(() => {
        MI.state.booted = false;
        PoseRestore.clear();
        delete window.NEXUS_PROCEDURAL_ANIMATOR;
        delete window.__CLIP_ANIM_CONST__;
        delete window.NEXUS_CLIP_LOADER;
        delete window.NEXUS_MOTION_CLIPS;
    });

    /** A VRM whose normalized and raw rigs are DISTINCT objects, as in three-vrm. */
    function attachDualRigAvatar() {
        const norm = { hips: fakeBone([0, 0, 0, 1], [0, 1, 0]), spine: fakeBone([0, 0, 0, 1]) };
        const raw = { hips: fakeBone([0, 0, 0, 1], [0, 1, 0]), spine: fakeBone([0, 0, 0, 1]) };
        const root = fakeBone([0, 0, 0, 1], [0, 0, 0]);
        root.rotation = { x: 0, y: Math.PI, z: 0 };
        root.userData = { isVRM: true };
        MI.onAvatarChanged(root, {
            humanoid: {
                humanBones: { hips: {}, spine: {} },
                getNormalizedBoneNode: (n) => norm[n] || null,
                getRawBoneNode: (n) => raw[n] || null,
            },
        });
        return { norm, raw };
    }

    test('a BVH clip moves RAW bones — the settle must bring those home', () => {
        const { raw } = attachDualRigAvatar();
        MI.playAnimation('dance');
        expect(PoseRestore.hasSnapshot()).toBe(true);

        // BVH writes raw bones directly and leaves autoUpdateHumanBones=false,
        // so the normalized rig is untouched. Capturing only normalized bones
        // made the restore a no-op and she froze in the last dance frame.
        raw.spine.quaternion.set(0, 1, 0, 0);
        raw.hips.position.set(0.9, 1, -0.6);

        expect(MI._startPoseRestore()).toBe(true);
        for (let i = 0; i < 12 && PoseRestore.isBlending(); i++) MI.update(0.1);

        expect(Math.abs(Math.abs(raw.spine.quaternion.w) - 1)).toBeLessThan(1e-6);
        expect(Math.abs(raw.hips.position.x)).toBeLessThan(1e-6);
        expect(Math.abs(raw.hips.position.z)).toBeLessThan(1e-6);
        expect(raw.hips.position.y).toBeCloseTo(1, 6);
    });

    test('a VRMA clip moves NORMALIZED bones — still restored', () => {
        const { norm } = attachDualRigAvatar();
        MI.playAnimation('wave');
        norm.spine.quaternion.set(0, 0.7071, 0, 0.7071);
        norm.hips.position.set(0.4, 1.2, 0.3);

        expect(MI._startPoseRestore()).toBe(true);
        for (let i = 0; i < 12 && PoseRestore.isBlending(); i++) MI.update(0.1);

        expect(Math.abs(Math.abs(norm.spine.quaternion.w) - 1)).toBeLessThan(1e-6);
        expect(Math.abs(norm.hips.position.x)).toBeLessThan(1e-6);
        expect(norm.hips.position.y).toBeCloseTo(1, 6);
    });

    test('a rig with no normalized layer captures each bone only once', () => {
        const shared = { hips: fakeBone([0, 0, 0, 1], [0, 1, 0]), spine: fakeBone([0, 0, 0, 1]) };
        const root = fakeBone([0, 0, 0, 1], [0, 0, 0]);
        root.rotation = { x: 0, y: Math.PI, z: 0 };
        root.userData = { isVRM: true };
        MI.onAvatarChanged(root, {
            humanoid: {
                humanBones: { hips: {}, spine: {} },
                getNormalizedBoneNode: (n) => shared[n] || null,
                getRawBoneNode: (n) => shared[n] || null, // same objects
            },
        });
        MI.playAnimation('bow');
        shared.spine.quaternion.set(0, 1, 0, 0);
        expect(MI._startPoseRestore()).toBe(true);
        for (let i = 0; i < 12 && PoseRestore.isBlending(); i++) MI.update(0.1);
        expect(Math.abs(Math.abs(shared.spine.quaternion.w) - 1)).toBeLessThan(1e-6);
    });
});
