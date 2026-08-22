/**
 * Library-only animations (Settings → "Built-in animations only", default ON).
 *
 * The user-visible contract: when the Living NPC is on, motion commands play
 * ONLY the animation set that demonstrably works on the current character —
 * the manifest categories the app itself does not flag `experimental`, plus
 * the native VRMA addon packs that ship with the repo — and they play through
 * the exact call signature the Animations panel uses. The optional generated
 * pack (absent on most deployments → a 404 per candidate before any
 * fallback) and experimental BVH categories are excluded unless the user
 * unticks the toggle.
 */

/* global describe, test, expect, beforeEach, afterAll */

const ClipMap = require('../src/xr/MotionClipMap');

const MANIFEST = {
    categories: {
        dance: { experimental: true, files: ['dance/dance_1.bvh', 'dance/dance_2.bvh'] },
        emotion: { files: ['emotion/admiration.bvh', 'emotion/happy1.bvh'] },
    },
};

/**
 * The two dance families library mode trusts: the native VRMA addon pack and
 * the dance BVH that ship in vendor/. Both are permitted deliberately —
 * restricting to VRMA alone made "dance" a silent no-op on a GLB avatar, which
 * has no VRM humanoid to retarget onto.
 *
 * "dance" is a `random: true` entry, so WHICH of the two wins any given draw
 * is chance. Assertions about a played dance therefore have to be about the
 * permitted SET, never about one prefix.
 */
const TRUSTED_DANCE_ROOTS = ['addons/vrma-dance/', 'vendor/animations/dance/'];
const fromTrustedDanceSet = (p) => TRUSTED_DANCE_ROOTS.some((root) => p.startsWith(root));

beforeEach(() => {
    ClipMap._setManifest(MANIFEST);
    ClipMap._setLibraryOnly(true);
});
afterAll(() => {
    ClipMap._setManifest(null);
    ClipMap._setLibraryOnly(null);
});

describe('library mode restricts to the proven set', () => {
    test('dance keeps the shipped VRMA addons AND the shipped dance BVH, drops the pack', () => {
        const entry = ClipMap.resolve('dance');
        expect(entry).not.toBeNull();
        expect(entry.candidates.length).toBeGreaterThan(0);
        // Both shipped families are allowed. Restricting to VRMA alone made
        // "dance" a silent no-op on a GLB avatar, which has no VRM humanoid to
        // retarget onto — the exact failure the toggle is supposed to prevent.
        for (const p of entry.candidates) {
            expect(fromTrustedDanceSet(p)).toBe(true);
        }
        expect(entry.candidates.some((p) => p.startsWith('addons/vrma-dance/'))).toBe(true);
        expect(entry.candidates.some((p) => p.startsWith('vendor/animations/dance/'))).toBe(true);
        // The optional generated pack is still excluded.
        expect(entry.candidates.some((p) => p.startsWith('addons/vrma-locomotion/'))).toBe(false);
    });

    test('non-experimental manifest clips stay reachable', () => {
        const entry = ClipMap.resolve('admiration');
        expect(entry).not.toBeNull();
        expect(entry.candidates[0]).toBe('vendor/animations/emotion/admiration.bvh');
    });

    test('experimental clips degrade to trusted dances until the toggle is off', () => {
        const safe = ClipMap.resolve('dance_1'); // fuzzy → the trusted dance set
        expect(safe).not.toBeNull();
        expect(safe.candidates.every(fromTrustedDanceSet)).toBe(true);
        ClipMap._setLibraryOnly(false);
        const entry = ClipMap.resolve('dance_1');
        // dance_1 ships in BOTH formats now: the original .bvh and a .vrma
        // converted with the official bvh2vrma. Both must be reachable. Which
        // one ranks first is an index detail (exact-name match vs addon
        // ordering) that neither of these tests is about, so it is not pinned.
        expect(entry.candidates).toContain('vendor/animations/dance/dance_1.bvh');
        expect(entry.candidates).toContain('addons/vrma-dance/dance_1.vrma');
    });

    test('pack-only gestures fall straight to their procedural fallback', () => {
        const entry = ClipMap.resolve('nod'); // candidates: PACK + 'nod.vrma' only
        expect(entry).not.toBeNull();
        expect(entry.candidates).toEqual([]); // no 404 attempts in library mode
        expect(entry.procedural).toBe('nod'); // the tested IK path still runs
    });

    test('addon actions such as victory remain playable (they ship natively)', () => {
        const entry = ClipMap.resolve('victory');
        expect(entry).not.toBeNull();
        expect(entry.candidates.some((p) => p.startsWith('addons/vrma-actions/'))).toBe(true);
    });
});

describe('library mode reaches the loader with the same contract', () => {
    test('playClip is called with an equivalent loop flag in both modes', async () => {
        // NOTE: playClip(path, loopOrOptions) accepts a boolean OR an options
        // object and normalises both into the same opts (ClipAnimationLoader
        // :110-115). So there is no "panel-parity" difference to assert — what
        // matters is that the loop intent survives, and that library mode does
        // not change how playback is requested, only WHICH files are offered.
        const calls = [];
        window.NEXUS_CLIP_LOADER = {
            getManifest: () => MANIFEST,
            loadClip: async () => ({ duration: 2 }),
            playClip: async (path, loopOrOptions) => {
                calls.push([path, loopOrOptions]);
                return true;
            },
        };

        const res = await ClipMap.play('dance');
        expect(res.ok).toBe(true);
        expect(calls[0][1].loop).toBe(true); // dance loops
        // Pinning `addons/vrma-dance/` here failed roughly one CI run in ten:
        // the shuffle bag draws from BOTH trusted families (see the first test
        // in this file, which asserts both are present). Which trusted file won
        // the draw is not the contract — that a trusted one did, is.
        expect(fromTrustedDanceSet(calls[0][0])).toBe(true);

        ClipMap._setLibraryOnly(false);
        calls.length = 0;
        const res2 = await ClipMap.play('dance');
        expect(res2.ok).toBe(true);
        expect(calls[0][1].loop).toBe(true); // same intent, wider file set
        delete window.NEXUS_CLIP_LOADER;
    });
});

describe('the setting defaults to ON and reads localStorage live', () => {
    test('no key → library mode; explicit "false" → advanced', () => {
        ClipMap._setLibraryOnly(null); // fall back to storage
        localStorage.removeItem('npc_library_anims');
        const safe = ClipMap.resolve('dance_1'); // default = restricted set
        expect(safe.candidates.every(fromTrustedDanceSet)).toBe(true);
        localStorage.setItem('npc_library_anims', 'false');
        const adv = ClipMap.resolve('dance_1').candidates;
        expect(adv).toContain('vendor/animations/dance/dance_1.bvh'); // BVH is back in advanced mode
        localStorage.removeItem('npc_library_anims');
    });
});
