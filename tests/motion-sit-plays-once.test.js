'use strict';

/**
 * "Sit down" plays the seated clip ONCE.
 *
 * Reported from a real session, and visible in the log as two plays of one
 * file:
 *
 *   [Motion] "sit"      → BVH .../sit_idle4.bvh (6.40s)
 *   [Motion] "sit_idle" → BVH .../sit_idle4.bvh (6.40s, loop)
 *
 * `sit` was loop:false + then:'sit_idle', a shape that assumes a distinct
 * sit_down TRANSITION clip followed by a seated LOOP. No such transition
 * ships — addons/vrma-locomotion/ contains only a README — so both entries
 * resolve to sit_idle4.bvh and the same 6.4 s file played through once, then
 * restarted from frame 0 as the loop. That restart is the "sits down twice".
 *
 * Two fixes, and both are needed:
 *   1. `sit` is one LOOPING state, so nothing chains to a second play.
 *   2. play() is idempotent: re-requesting the clip already on the mixer with
 *      the same loop intent returns {already:true} without touching it, so a
 *      later idle reschedule cannot restart the loop either.
 */

/* global describe, test, expect, beforeEach, afterEach, afterAll */

const ClipMap = require('../src/xr/MotionClipMap');

const SIT4 = 'vendor/animations/sitting/sit_idle4.bvh';

let playing;
let playCalls;

beforeEach(() => {
    ClipMap._setManifest({ categories: { sitting: { files: ['sitting/sit_idle4.bvh'] } } });
    ClipMap._setLibraryOnly(true);
    ClipMap._setBvhAllowed(true);
    ClipMap.resetUnavailable();
    playing = { clip: null, isPlaying: false };
    playCalls = [];
    window.NEXUS_CLIP_LOADER = {
        getManifest: () => ({ categories: { sitting: { files: ['sitting/sit_idle4.bvh'] } } }),
        getCurrentPlaybackState: () => ({ clip: playing.clip, category: 'sitting', isPlaying: playing.isPlaying }),
        loadClip: async () => ({ duration: 6.4 }),
        playClip: async (path) => {
            playCalls.push(path);
            playing = { clip: path, isPlaying: true };
            return true;
        },
    };
});
afterEach(() => delete window.NEXUS_CLIP_LOADER);
afterAll(() => {
    ClipMap._setManifest(null);
    ClipMap._setLibraryOnly(null);
    ClipMap._setBvhAllowed(null);
});

describe('sit is a single looping state', () => {
    test('it resolves to a LOOP, so nothing chains to a second play', async () => {
        const res = await ClipMap.play('sit');
        expect(res.ok).toBe(true);
        expect(res.loop).toBe(true);
        expect(playCalls).toEqual([SIT4]);
    });

    test('it carries no then-chain — that is what played the file twice', () => {
        // playAnimation fires the chain on `res.then && !res.loop`. Both halves
        // are now false; asserting the entry itself keeps the intent explicit.
        const entry = ClipMap.resolve('sit');
        expect(entry.loop).toBe(true);
        expect(entry.then == null).toBe(true);
    });

    test('sit and sit_idle still resolve to the same seated clip', () => {
        const shipped = (n) => ClipMap.resolve(n).candidates.filter((p) => p.startsWith('vendor/'))[0];
        expect(shipped('sit')).toBe(SIT4);
        expect(shipped('sit_idle')).toBe(SIT4);
    });
});

describe('re-requesting the seated loop never restarts it', () => {
    test('the idle reschedule is an idempotent no-op', async () => {
        await ClipMap.play('sit');
        const again = await ClipMap.play('sit_idle'); // what _scheduleIdle re-issues
        expect(again.ok).toBe(true);
        expect(again.already).toBe(true);
        expect(playCalls).toEqual([SIT4]); // exactly ONE mixer start
    });

    test('and stays a no-op however often it is re-issued', async () => {
        await ClipMap.play('sit');
        for (let i = 0; i < 5; i++) await ClipMap.play(i % 2 ? 'sit' : 'sit_idle');
        expect(playCalls.length).toBe(1);
    });

    test('a DIFFERENT clip still plays — idempotence is per-state, not global', async () => {
        ClipMap._setManifest({
            categories: {
                sitting: { files: ['sitting/sit_idle4.bvh'] },
                emotion: { files: ['emotion/happy1.bvh'] },
            },
        });
        window.NEXUS_CLIP_LOADER.getManifest = () => ({
            categories: {
                sitting: { files: ['sitting/sit_idle4.bvh'] },
                emotion: { files: ['emotion/happy1.bvh'] },
            },
        });
        await ClipMap.play('sit');
        const res = await ClipMap.play('happy1');
        expect(res.ok).toBe(true);
        expect(playCalls.length).toBe(2);
    });

    test('a clip that is loaded but NOT playing is started, not skipped', async () => {
        await ClipMap.play('sit');
        playing.isPlaying = false; // e.g. stopped by a settle
        const again = await ClipMap.play('sit_idle');
        expect(again.already).toBeUndefined();
        expect(playCalls.length).toBe(2);
    });
});
