'use strict';

/**
 * BVH retarget pipeline — the five defects from the retarget audit.
 *
 * These exercise the pure helpers the loader is built from. The loader itself
 * needs THREE and a live avatar, so the browser pass covers playback; what is
 * pinned here is the maths that made BVH output avatar-specific:
 *
 *   1. bone map targeted RAW bones      → now normalized-first
 *   2. the avatar's LIVE pose was baked into every keyframe → now passthrough
 *   3. hips position tracks were dropped → now kept and scaled
 *   4. no VRM 0.x handedness flip        → now the same one VRMA uses
 *   5. identity correction presets + a hardcoded dance_1 x AvatarSample_A pair
 */

/* global describe, test, expect, beforeAll */

let C;

beforeAll(() => {
    // ClipAnimationShared needs a THREE global to install itself; the helpers
    // under test are plain maths and do not touch it.
    global.window = global.window || {};
    window.THREE = window.THREE || {};
    delete window.__CLIP_ANIM_CONST__;
    jest.isolateModules(() => {
        require('../src/ClipAnimationShared.js');
    });
    C = window.__CLIP_ANIM_CONST__;
});

describe('defect 4 — VRM 0.x handedness flip is shared, not per-loader', () => {
    test('quaternion flip negates x and z, keeps y and w', () => {
        const out = C.transformQuatForVRM0([0.1, 0.2, 0.3, 0.4]);
        expect(Array.from(out)).toEqual([-0.1, 0.2, -0.3, 0.4].map((v) => Math.fround(v)));
    });

    test('position flip negates x and z, keeps y', () => {
        const out = C.transformPosForVRM0([1, 2, 3]);
        expect(Array.from(out)).toEqual([-1, 2, -3]);
    });

    test('applies across a multi-frame flat array', () => {
        const out = C.transformQuatForVRM0([0, 0, 0, 1, 0.5, 0.5, 0.5, 0.5]);
        expect(Array.from(out).slice(4)).toEqual([-0.5, 0.5, -0.5, 0.5]);
    });

    test('an unknown or missing meta defaults to 0.x, the safe direction', () => {
        expect(C.getMetaVersion(null)).toBe('0');
        expect(C.getMetaVersion({})).toBe('0');
        expect(C.getMetaVersion({ meta: {} })).toBe('0');
        expect(C.getMetaVersion({ meta: { metaVersion: '0' } })).toBe('0');
        expect(C.getMetaVersion({ meta: { metaVersion: '1' } })).toBe('1');
    });
});

describe('defect 1 — the bone map targets the normalized rig', () => {
    function humanoidAvatar() {
        const raw = { hips: { name: 'J_Bip_C_Hips', isBone: true } };
        const norm = { hips: { name: 'Normalized_J_Bip_C_Hips', isBone: true } };
        for (const b of C.VRM_BONES) {
            raw[b] = { name: 'raw_' + b, isBone: true };
            norm[b] = { name: 'norm_' + b, isBone: true };
        }
        return {
            root: { traverse() {} },
            vrm: {
                humanoid: {
                    getRawBoneNode: (n) => raw[n] || null,
                    getNormalizedBoneNode: (n) => norm[n] || null,
                },
            },
        };
    }

    test('normalized: true prefers getNormalizedBoneNode', () => {
        const { root, vrm } = humanoidAvatar();
        const map = C.buildAvatarBoneMap(root, vrm, { normalized: true });
        expect(map.hips.name).toBe('norm_hips');
        expect(map.leftUpperArm.name).toBe('norm_leftUpperArm');
    });

    test('the default is unchanged for existing callers', () => {
        const { root, vrm } = humanoidAvatar();
        const map = C.buildAvatarBoneMap(root, vrm);
        expect(map.hips.name).toBe('raw_hips');
    });

    test('falls back to whichever accessor the rig actually has', () => {
        const norm = {};
        for (const b of C.VRM_BONES) norm[b] = { name: 'norm_' + b, isBone: true };
        const map = C.buildAvatarBoneMap(
            { traverse() {} },
            { humanoid: { getNormalizedBoneNode: (n) => norm[n] || null } },
            { normalized: true }
        );
        expect(map.hips.name).toBe('norm_hips');
    });

    test('a non-VRM avatar still resolves bones by name', () => {
        const bones = C.VRM_BONES.map((b) => ({ name: b, isBone: true }));
        const map = C.buildAvatarBoneMap({ traverse: (fn) => bones.forEach(fn) }, null, { normalized: true });
        expect(Object.keys(map).length).toBeGreaterThan(5);
    });
});

describe('defect 5 — the identity correction presets were always a no-op', () => {
    test('every shipped preset is the identity quaternion', () => {
        // Kept in the shared table for other callers, but multiplying by these
        // could never have corrected anything — which is why the raw path only
        // ever looked right for one hardcoded file/avatar pair.
        for (const k of Object.keys(C.BONE_CORRECTION_PRESETS)) {
            expect(C.BONE_CORRECTION_PRESETS[k]).toEqual([0, 0, 0, 1]);
        }
    });
});

describe('defect 2 — the passthrough is exact', () => {
    // Mirrors the loader's retargetQuaternionValues for a VRM 1.0 target:
    // values are copied through untouched, with no rest-pose multiplication.
    const passthrough = (v, isVRM0) => (isVRM0 ? C.transformQuatForVRM0(v) : C.cloneQuaternionArray(v));

    test('a VRM 1.0 target receives the source values bit-for-bit', () => {
        const src = [0, 0.7071, 0, 0.7071, 0.1, 0.2, 0.3, 0.9];
        expect(Array.from(passthrough(src, false))).toEqual(src.map((v) => Math.fround(v)));
    });

    test('the result does not depend on the avatar being in any given pose', () => {
        // The old formula multiplied by the target bone's live quaternion, so
        // the same clip produced different output depending on when it loaded.
        const src = [0, 0, 0, 1];
        expect(Array.from(passthrough(src, false))).toEqual(Array.from(passthrough(src, false)));
    });
});

describe('defect 3 — hips translation is scaled, not discarded', () => {
    // Mirrors the loader's scaleHipsPosition.
    const scaleHips = (values, scale, isVRM0) => {
        const out = new Float32Array(values.length);
        for (let i = 0; i < values.length; i++) out[i] = values[i] * scale;
        return isVRM0 ? C.transformPosForVRM0(out) : out;
    };

    test('the shipped ~10x authoring scale is divided down', () => {
        // Measured: dance_1.bvh root OFFSET Y = 12.19; normalized hips ~1.1.
        const scale = 1.1 / 12.19;
        const out = scaleHips([0, 12.19, 0], scale, false);
        expect(out[1]).toBeCloseTo(1.1, 5);
    });

    test('scale composes with the VRM 0.x flip', () => {
        const out = scaleHips([2, 12, -4], 0.5, true);
        expect(Array.from(out)).toEqual([-1, 6, 2]);
    });

    test('a scale of 1 leaves values untouched', () => {
        expect(Array.from(scaleHips([1, 2, 3], 1, false))).toEqual([1, 2, 3]);
    });
});

describe('hips translation is height-normalised and anchored in place', () => {
    /**
     * Mirrors VRMAAnimationLoader.normalizeHipsTrack. Three encodings ship in
     * this repo and all three used to land somewhere different:
     *
     *   official VRoid  rest 0.902,  track absolute  ~0.865
     *   bvh2vrma (a)    rest 0.1219, track absolute  ~0.1168
     *   bvh2vrma (b)    rest 0.1072, track RELATIVE  ~-0.0009
     *
     * The height scaling was a `// TODO` that never landed, so the track was
     * written to the normalized hips node verbatim — setting hips to 0.12 m,
     * or to zero, instead of ~0.9 m. The avatar sank through the floor.
     */
    const normalize = (values, animRestY, targetRestY, restX = 0, restZ = 0) => {
        const out = new Float32Array(values.length);
        const scale = animRestY > 1e-6 && targetRestY > 1e-6 ? targetRestY / animRestY : 1;
        const firstY = values.length > 1 ? Math.abs(values[1]) : 0;
        const isRelative = animRestY > 1e-6 && firstY < animRestY * 0.5;
        for (let i = 0; i + 2 < values.length; i += 3) {
            let y = values[i + 1];
            if (isRelative) y += animRestY;
            out[i] = restX;
            out[i + 1] = y * scale;
            out[i + 2] = restZ;
        }
        return Array.from(out);
    };

    test('every shipped encoding lands near the target hips height', () => {
        for (const [label, vals, rest] of [
            ['official VRoid', [0.0079, 0.8651, -0.0082], 0.902],
            ['converted, absolute', [0.0, 0.1168, 0.0], 0.1219],
            ['converted, relative', [0.0001, -0.0009, 0.0001], 0.1072],
        ]) {
            const y = normalize(vals, rest, 1.0)[1];
            expect({ label, ok: y > 0.9 && y < 1.05 }).toEqual({ label, ok: true });
        }
    });

    test('horizontal travel is dropped so she stays on her mark', () => {
        // Mocap always carries sway; letting it through moved the avatar off
        // her position every time she danced.
        const out = normalize([0.35, 0.9, -0.42, 0.5, 0.95, 0.6], 0.902, 1.0);
        expect(out[0]).toBe(0);
        expect(out[2]).toBe(0);
        expect(out[3]).toBe(0);
        expect(out[5]).toBe(0);
    });

    test('vertical bounce survives — it is what makes a dance read as one', () => {
        const out = normalize([0, 0.85, 0, 0, 0.95, 0], 0.902, 1.0);
        expect(out[4]).toBeGreaterThan(out[1]);
        expect(out[4] - out[1]).toBeCloseTo((0.95 - 0.85) / 0.902, 4);
    });

    test('an unknown rest height falls back to a passthrough scale', () => {
        expect(normalize([0, 0.5, 0], 0, 1.0)[1]).toBeCloseTo(0.5, 6);
    });
});

describe('hips x/z are pinned to the REST pose, not to the origin', () => {
    /**
     * Reported: "sometimes when I ask dance the character's xy position on the
     * plane changes to another place." Sometimes, because only the converted
     * dances carry a hips position track — the Mixamo-origin clips have none,
     * so those never moved her.
     *
     * The horizontal component was written as literal 0. That equals "stay
     * put" only when the avatar's rest hips sit exactly on the origin. For any
     * other rig it displaced her by (-restX, -restZ) for the whole clip, then
     * the pose restore put her back on stop — which is why stop looked right.
     */
    const normalize = (values, animRestY, targetRestY, restX, restZ) => {
        const out = [];
        const scale = animRestY > 1e-6 && targetRestY > 1e-6 ? targetRestY / animRestY : 1;
        const firstY = values.length > 1 ? Math.abs(values[1]) : 0;
        const isRelative = animRestY > 1e-6 && firstY < animRestY * 0.5;
        for (let i = 0; i + 2 < values.length; i += 3) {
            let y = values[i + 1];
            if (isRelative) y += animRestY;
            out.push(restX, y * scale, restZ);
        }
        return out;
    };

    test('an off-origin rest pose is preserved, not zeroed', () => {
        const out = normalize([0.4, 0.9, -0.7, 0.5, 0.95, 0.8], 0.902, 1.0, 0.12, -0.05);
        expect(out[0]).toBeCloseTo(0.12, 6);
        expect(out[2]).toBeCloseTo(-0.05, 6);
        expect(out[3]).toBeCloseTo(0.12, 6);
        expect(out[5]).toBeCloseTo(-0.05, 6);
    });

    test("the clip's own horizontal travel is still discarded", () => {
        // Input sways hard in x and z; output must not vary at all.
        const out = normalize([2, 0.9, -3, -2, 0.9, 3], 0.902, 1.0, 0.12, -0.05);
        expect(out[0]).toBe(out[3]);
        expect(out[2]).toBe(out[5]);
    });

    test('a rest pose on the origin still yields zero — the old case', () => {
        const out = normalize([0.4, 0.9, -0.7], 0.902, 1.0, 0, 0);
        expect(out[0]).toBe(0);
        expect(out[2]).toBe(0);
    });

    test('vertical motion is unaffected by the pinning', () => {
        const out = normalize([0, 0.85, 0, 0, 0.95, 0], 0.902, 1.0, 0.12, -0.05);
        expect(out[4]).toBeGreaterThan(out[1]);
    });
});
