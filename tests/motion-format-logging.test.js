'use strict';

/**
 * Every played animation reports WHICH format it used.
 *
 * BVH and VRMA go through completely different pipelines and fail in
 * completely different ways, so "which one played?" is the first question
 * asked of any animation bug. The line is NOT gated behind the verbose
 * setting — it is one line per gesture, and having to turn on a setting to
 * answer that question is exactly the friction this removes.
 */

/* global describe, test, expect, beforeEach, afterEach */

const ClipMap = require('../src/xr/MotionClipMap');

const MANIFEST = {
    categories: {
        dance: { experimental: true, files: ['dance/dance_1.bvh'] },
        emotion: { files: ['emotion/admiration.bvh'] },
        vrma: { files: ['vrma/VRMA_01.vrma'] },
    },
};

let logs;
let warns;

function loaderThatPlays(playable) {
    return {
        loadClip: (p) => Promise.resolve(playable.includes(p) ? { duration: 3.5, tracks: [] } : null),
        playClip: (p) => Promise.resolve(playable.includes(p)),
        getManifest: () => MANIFEST,
    };
}

beforeEach(() => {
    logs = [];
    warns = [];
    jest.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
    jest.spyOn(console, 'warn').mockImplementation((...a) => warns.push(a.join(' ')));
    ClipMap._setManifest(MANIFEST);
    ClipMap._setLibraryOnly(false);
    ClipMap.resetUnavailable(); // the skip cache is module-level, so order would matter
    // Declare a VRM humanoid: without one, play() deliberately tries BVH first
    // because .vrma cannot retarget, which would reorder these candidates.
    window.__CLIP_ANIM_STATE__ = { avatarVRM: { humanoid: {} } };
});
afterEach(() => {
    console.log.mockRestore();
    console.warn.mockRestore();
    ClipMap._setManifest(null);
    ClipMap._setLibraryOnly(null);
    delete window.NEXUS_CLIP_LOADER;
    delete window.__CLIP_ANIM_STATE__;
});

describe('the winning clip names its format', () => {
    test('a VRMA clip logs VRMA, its path and its duration', async () => {
        window.NEXUS_CLIP_LOADER = loaderThatPlays(['addons/vrma-actions/waving.vrma']);
        const res = await ClipMap.play('wave');
        expect(res.ok).toBe(true);
        expect(res.format).toBe('VRMA');
        expect(res.path).toBe('addons/vrma-actions/waving.vrma');
        const line = logs.find((l) => l.includes('[Motion]') && l.includes('"wave"'));
        expect(line).toBeDefined();
        expect(line).toContain('VRMA');
        expect(line).toContain('addons/vrma-actions/waving.vrma');
        expect(line).toContain('3.50s');
    });

    test('a BVH clip logs BVH', async () => {
        window.NEXUS_CLIP_LOADER = loaderThatPlays(['vendor/animations/dance/dance_1.bvh']);
        const res = await ClipMap.play('dance_1');
        expect(res.ok).toBe(true);
        expect(res.format).toBe('BVH');
        const line = logs.find((l) => l.includes('[Motion]') && l.includes('"dance_1"'));
        expect(line).toContain('BVH');
        expect(line).toContain('vendor/animations/dance/dance_1.bvh');
    });

    test('falling past a dead candidate is recorded in the same line', async () => {
        // wave = [waving.vrma, action_greeting.bvh]; kill the first.
        window.NEXUS_CLIP_LOADER = loaderThatPlays(['vendor/animations/action/action_greeting.bvh']);
        const res = await ClipMap.play('wave');
        expect(res.ok).toBe(true);
        expect(res.format).toBe('BVH');
        const line = logs.find((l) => l.includes('[Motion]') && l.includes('"wave"'));
        expect(line).toMatch(/candidate 2\/\d+/);
    });

    test('a skipped clip names the format that failed', async () => {
        window.NEXUS_CLIP_LOADER = loaderThatPlays(['vendor/animations/action/action_greeting.bvh']);
        await ClipMap.play('wave');
        expect(warns.some((w) => w.includes('VRMA clip failed to load'))).toBe(true);
    });

    test('when everything fails, the summary breaks the attempts down by format', async () => {
        window.NEXUS_CLIP_LOADER = loaderThatPlays([]);
        const res = await ClipMap.play('wave');
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('load_failed');
        const summary = warns.find((w) => w.includes('ALL'));
        expect(summary).toBeDefined();
        expect(summary).toMatch(/1 VRMA, 1 BVH/);
    });
});

describe('the BVH toggle: on by default, off restricts to VRMA', () => {
    test('with no stored preference, both formats are offered', () => {
        window.NEXUS_CLIP_LOADER = loaderThatPlays([]);
        localStorage.removeItem('npc_bvh_anims');
        ClipMap._setBvhAllowed(null); // read storage
        const entry = ClipMap.resolve('wave');
        expect(entry.candidates.some((p) => /\.vrma$/i.test(p))).toBe(true);
        expect(entry.candidates.some((p) => /\.bvh$/i.test(p))).toBe(true);
    });

    test('only an explicit "false" turns it off — the default is ON', () => {
        window.NEXUS_CLIP_LOADER = loaderThatPlays([]);
        ClipMap._setBvhAllowed(null);
        for (const stored of [null, 'true', 'anything-else']) {
            if (stored === null) localStorage.removeItem('npc_bvh_anims');
            else localStorage.setItem('npc_bvh_anims', stored);
            expect(ClipMap.resolve('wave').candidates.some((p) => /\.bvh$/i.test(p))).toBe(true);
        }
        localStorage.setItem('npc_bvh_anims', 'false');
        expect(ClipMap.resolve('wave').candidates.some((p) => /\.bvh$/i.test(p))).toBe(false);
        localStorage.removeItem('npc_bvh_anims');
    });

    test('turning it off restricts the advertised catalog too', () => {
        window.NEXUS_CLIP_LOADER = loaderThatPlays([]);
        ClipMap._setBvhAllowed(null);
        localStorage.removeItem('npc_bvh_anims');
        expect(ClipMap.catalogLine()).toContain('emotion'); // bvh-only category
        localStorage.setItem('npc_bvh_anims', 'false');
        expect(ClipMap.catalogLine()).not.toContain('emotion');
        localStorage.removeItem('npc_bvh_anims');
    });

    test('on a GLB avatar the toggle is ignored — .vrma cannot retarget there', () => {
        window.NEXUS_CLIP_LOADER = loaderThatPlays([]);
        delete window.__CLIP_ANIM_STATE__; // no VRM humanoid
        ClipMap._setBvhAllowed(null);
        localStorage.setItem('npc_bvh_anims', 'false');
        expect(ClipMap.resolve('wave').candidates.some((p) => /\.bvh$/i.test(p))).toBe(true);
        localStorage.removeItem('npc_bvh_anims');
    });
});
