/**
 * MO8. A VRMA clip's hips height is scaled to the avatar — through the REAL retarget, not a
 * mirror of it.
 *
 * Every tk256 clip stores its hips as glTF node 0. The loader looked that index up with
 * C.safeGet, which returns `value || null`, so the clip's rest height read as 0, the scale fell
 * back to ×1, and the clip's absolute hips height (~0.87 m, authored on a 0.90 m rig) was
 * written onto every avatar unchanged: 0.2 m off the floor on VRM_Viewer_Sample (0.69 m), into
 * the floor on Vita (0.98 m). tests/bvh-retarget.test.js mirrors the scaling arithmetic with the
 * rest height passed in, which is exactly why it could not see this; this test drives
 * window.__VRMA_LOADER__.retargetVRMAClip itself.
 */
function installThree() {
    class Object3D {
        constructor() {
            this.name = '';
            this.children = [];
            this.position = { x: 0, y: 0, z: 0 };
        }
        add(c) {
            this.children.push(c);
        }
    }
    class Track {
        constructor(name, times, values) {
            this.name = name;
            this.times = times;
            this.values = values;
        }
    }
    window.THREE = {
        Object3D,
        QuaternionKeyframeTrack: class extends Track {},
        VectorKeyframeTrack: class extends Track {},
        NumberKeyframeTrack: class extends Track {},
        AnimationClip: class {
            constructor(name, duration, tracks) {
                this.name = name;
                this.duration = duration;
                this.tracks = tracks;
            }
        },
    };
}

function load() {
    jest.resetModules();
    installThree();
    delete window.__CLIP_ANIM_CONST__;
    delete window.__CLIP_ANIM_STATE__;
    delete window.__VRMA_LOADER__;
    require('../src/ClipAnimationShared.js');
    require('../src/VRMAAnimationLoader.js');
    return { S: window.__CLIP_ANIM_STATE__, L: window.__VRMA_LOADER__ };
}

/** A minimal tk256-shaped clip: hips at node 0, rest 0.902, absolute track ~0.87. */
function tk256Clip(hipsNode = 0) {
    const nodes = [];
    nodes[hipsNode] = { name: 'J_Bip_C_Hips', translation: [0, 0.902, 0] };
    if (hipsNode !== 0) nodes[0] = { name: 'Root' };
    const gltf = {
        parser: {
            json: {
                nodes,
                extensions: { VRMC_vrm_animation: { humanoid: { humanBones: { hips: { node: hipsNode } } } } },
            },
        },
    };
    const clip = {
        name: 'Clapping',
        tracks: [{ name: 'J_Bip_C_Hips.position', times: [0, 1], values: [0, 0.869, 0, 0, 0.919, 0] }],
    };
    return { gltf, clip };
}

function avatar(S, { restY, liveY }) {
    const hipsNorm = { name: 'Normalized_hips', position: { x: 0, y: liveY, z: 0 } };
    S.avatarVRM = {
        meta: { metaVersion: '1' },
        humanoid: { getNormalizedBoneNode: (n) => (n === 'hips' ? hipsNorm : { name: 'Normalized_' + n }) },
    };
    S.cachedBoneMap = { hips: { userData: { nexusRestHips: { x: 0, y: restY, z: 0 } } } };
}

function hipsY(clip) {
    const t = clip.tracks.find((tr) => /\.position$/.test(tr.name));
    return [t.values[1], t.values[4]];
}

describe('MO8: VRMA hips track is scaled to the avatar', () => {
    test('hips at node 0 still scale (0.69 m avatar → ~0.66 m, not 0.87 m)', () => {
        const { S, L } = load();
        avatar(S, { restY: 0.69, liveY: 0.69 });
        const { gltf, clip } = tk256Clip(0);
        const [first, peak] = hipsY(L.retargetVRMAClip(clip, gltf));
        expect(first).toBeCloseTo(0.869 * (0.69 / 0.902), 3);
        expect(peak).toBeCloseTo(0.919 * (0.69 / 0.902), 3);
    });

    test('same clip with hips at another node index scales identically', () => {
        const { S, L } = load();
        avatar(S, { restY: 0.69, liveY: 0.69 });
        const { gltf, clip } = tk256Clip(3);
        expect(hipsY(L.retargetVRMAClip(clip, gltf))[0]).toBeCloseTo(0.869 * (0.69 / 0.902), 3);
    });

    test('scales to her REST height, not where the previous clip left the hips', () => {
        const { S, L } = load();
        // A previous unscaled clip held the normalized hips at 0.88 m; the rest is 0.69 m.
        avatar(S, { restY: 0.69, liveY: 0.88 });
        const { gltf, clip } = tk256Clip(0);
        expect(hipsY(L.retargetVRMAClip(clip, gltf))[0]).toBeCloseTo(0.869 * (0.69 / 0.902), 3);
    });

    test('a centimetre-authored clip (ChatVRM idle_loop, rest 90.57) lands at her height', () => {
        const { S, L } = load();
        avatar(S, { restY: 0.894, liveY: 0.894 });
        const { gltf, clip } = tk256Clip(0);
        gltf.parser.json.nodes[0].translation = [0, 90.568, 0];
        clip.tracks[0].values = [0, 90.415, 0, 0, 90.474, 0];
        const [first] = hipsY(L.retargetVRMAClip(clip, gltf));
        expect(first).toBeGreaterThan(0.85);
        expect(first).toBeLessThan(0.9);
    });
});
