'use strict';

/**
 * AN2. BVH clips retarget onto the NORMALIZED rig, whatever registerAvatar cached.
 *
 * registerAvatar fills the shared clip state's bone map with RAW bones (VRMA reads the raw hips
 * from it) before any clip loads, and the BVH retargeter only built its normalized map when that
 * slot was empty — so it never did. Every BVH track was named after a raw bone while playClip had
 * three-vrm copy the normalized rig onto the raw one each frame, and the mixer writes a bone only
 * when the clip's value changes: whatever a clip held still (seated legs, a kneel) showed the rest
 * pose. In Pose Studio, "Sit idle" stood her on one leg. These pin the tracks to the normalized
 * rig, and the map to the avatar it was built for.
 */

/* global describe, test, expect, beforeEach */

const THREE = require('../vendor/three-0.147.0/build/three.min.js');

const KEYS = [
    'hips',
    'spine',
    'chest',
    'neck',
    'head',
    'leftUpperArm',
    'rightUpperArm',
    'leftUpperLeg',
    'rightUpperLeg',
];

function avatar() {
    const root = new THREE.Object3D();
    const raw = {};
    const norm = {};
    for (const k of KEYS) {
        raw[k] = new THREE.Bone();
        raw[k].name = 'J_' + k;
        norm[k] = new THREE.Object3D();
        norm[k].name = 'Normalized_J_' + k;
        root.add(raw[k]);
    }
    raw.hips.position.set(0, 0.9, 0);
    norm.hips.position.set(0, 0.9, 0);
    const vrm = {
        meta: { metaVersion: '1' },
        humanoid: { getRawBoneNode: (k) => raw[k] || null, getNormalizedBoneNode: (k) => norm[k] || null },
    };
    return { root, raw, norm, vrm };
}

function clipFor(names) {
    const tracks = names.map(
        (n) => new THREE.QuaternionKeyframeTrack(n + '.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0.1, 0.995])
    );
    return new THREE.AnimationClip('test', 1, tracks);
}

let BVH;
let S;

beforeEach(() => {
    window.THREE = THREE;
    delete window.__CLIP_ANIM_CONST__;
    delete window.__BVH_LOADER__;
    delete window.__CLIP_ANIM_STATE__;
    jest.isolateModules(() => {
        require('../src/ClipAnimationShared.js');
        require('../src/BVHAnimationLoader.js');
    });
    BVH = window.__BVH_LOADER__;
    S = window.__CLIP_ANIM_STATE__;
});

test('with the raw map already cached, the tracks still name the normalized bones', () => {
    const a = avatar();
    S.avatarRoot = a.root;
    S.avatarVRM = a.vrm;
    // What registerAvatar leaves there: the raw bones.
    S.cachedBoneMap = Object.fromEntries(KEYS.map((k) => [k, a.raw[k]]));
    const out = BVH.retargetBVHClip(clipFor(KEYS), { bones: [] }, a.root, 'vendor/animations/sitting/x.bvh');
    expect(out._retargetFailed).toBeFalsy();
    const names = out.tracks.map((t) => t.name.split('.')[0]);
    expect(names.length).toBeGreaterThanOrEqual(6);
    expect(names.every((n) => n.startsWith('Normalized_'))).toBe(true);
    // And the raw map VRMA relies on is left as it was.
    expect(S.cachedBoneMap.hips).toBe(a.raw.hips);
});

describe('AN3. a calibration frame at the head of a take is dropped', () => {
    function take(firstY) {
        const times = [0, 1 / 30, 2 / 30, 3 / 30, 4 / 30];
        const hipsY = [firstY, 9, 9.1, 9, 8.9];
        const pos = new THREE.VectorKeyframeTrack(
            'hips.position',
            times,
            hipsY.flatMap((y) => [0, y, 0])
        );
        const rot = KEYS.map(
            (n, i) =>
                new THREE.QuaternionKeyframeTrack(
                    n + '.quaternion',
                    times,
                    times.flatMap((_, k) => (k === 0 ? [0, 0, 0, 1] : [0, 0, 0.1 * (i + 1), 1]))
                )
        );
        return new THREE.AnimationClip('take', 4 / 30, [pos, ...rot]);
    }

    function retarget(clip) {
        const a = avatar();
        S.avatarRoot = a.root;
        S.avatarVRM = a.vrm;
        return BVH.retargetBVHClip(clip, { bones: [] }, a.root, 'vendor/animations/sitting/x.bvh');
    }

    test('a first frame standing far above the take starts the clip on frame 1', () => {
        const out = retarget(take(17.5));
        for (const t of out.tracks) {
            expect(t.times.length).toBe(4);
            expect(t.times[0]).toBe(0);
        }
        expect(out.duration).toBeCloseTo(3 / 30, 5);
    });

    test('a lead-in blending down from the calibration pose goes with it', () => {
        const times = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => k / 30);
        const hipsY = [17.5, 14, 11, 9.1, 9, 8.9, 9, 9.05];
        const pos = new THREE.VectorKeyframeTrack(
            'hips.position',
            times,
            hipsY.flatMap((y) => [0, y, 0])
        );
        const rot = KEYS.map(
            (n) =>
                new THREE.QuaternionKeyframeTrack(
                    n + '.quaternion',
                    times,
                    times.flatMap(() => [0, 0, 0.1, 1])
                )
        );
        const out = retarget(new THREE.AnimationClip('ramp', 7 / 30, [pos, ...rot]));
        for (const t of out.tracks) expect(t.times.length).toBe(5); // 17.5, 14 and 11 dropped
        expect(out.duration).toBeCloseTo(4 / 30, 5);
    });

    test('a take whose first frame belongs to it is left whole', () => {
        const out = retarget(take(9.05));
        for (const t of out.tracks) expect(t.times.length).toBe(5);
        expect(out.duration).toBeCloseTo(4 / 30, 5);
    });
});
