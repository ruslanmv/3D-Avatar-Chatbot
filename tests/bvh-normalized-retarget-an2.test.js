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
