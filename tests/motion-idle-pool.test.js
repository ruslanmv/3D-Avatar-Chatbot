'use strict';

/**
 * Idle is a pool, drawn from at random.
 *
 * Idle is where she spends most of her time, so it is the animation people
 * actually watch — and it was two clips, played in the same order every time.
 * The pool is now all six shipped neutral captures plus the VRMA waiting loop.
 *
 * Two properties matter, and they pull against each other:
 *
 *   1. Entering idle picks a fresh clip, so returning to rest is not identical
 *      every time.
 *   2. A RUNNING idle is never swapped. _scheduleIdle fires repeatedly — after
 *      a gesture, after speaking, after the pose-restore settle — and a random
 *      entry would draw a different clip each time. Swapping mid-loop reads as
 *      a twitch. Variety belongs at state ENTRY, not on every tick.
 */

/* global describe, test, expect, beforeEach, afterEach, afterAll */

const ClipMap = require('../src/xr/MotionClipMap');
const manifest = require('../vendor/animations/manifest.json');

const IDLE_POOL = [
    'vendor/animations/idle/neutral_idle.bvh',
    'vendor/animations/idle/neutral_idle2.bvh',
    'vendor/animations/idle/neutral.bvh',
    'vendor/animations/idle/neutral2.bvh',
    'vendor/animations/idle/neutral3.bvh',
    'vendor/animations/idle/neutral4.bvh',
    'vendor/animations/vrma/waiting-standard.vrma',
];

let playing;
let playCalls;

beforeEach(() => {
    ClipMap._setManifest(manifest);
    ClipMap._setLibraryOnly(true);
    ClipMap._setBvhAllowed(true);
    ClipMap.resetUnavailable();
    playing = { clip: null, category: null, isPlaying: false };
    playCalls = [];
    window.NEXUS_CLIP_LOADER = {
        getManifest: () => manifest,
        getCurrentPlaybackState: () => playing,
        loadClip: async () => ({ duration: 8 }),
        playClip: async (path) => {
            playCalls.push(path);
            playing = { clip: path, category: null, isPlaying: true };
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

describe('every requested clip is in the pool', () => {
    test('all six neutral captures and the VRMA waiting loop are reachable', () => {
        const candidates = ClipMap.resolve('idle').candidates;
        for (const path of IDLE_POOL) {
            expect(candidates).toContain(path);
        }
    });

    test('the VRMA is in the pool alongside the BVH, not instead of them', () => {
        const candidates = ClipMap.resolve('idle').candidates;
        expect(candidates.filter((p) => p.endsWith('.vrma')).length).toBeGreaterThan(0);
        expect(candidates.filter((p) => p.endsWith('.bvh')).length).toBeGreaterThanOrEqual(6);
    });

    test('the pool holds no duplicates, so the draw is not weighted by accident', () => {
        const candidates = ClipMap.resolve('idle').candidates;
        expect(new Set(candidates).size).toBe(candidates.length);
    });

    test('idle still loops and is sticky — it must not schedule its own exit', () => {
        const entry = ClipMap.resolve('idle');
        expect(entry.loop).toBe(true);
        expect(entry.sticky).toBe(true);
    });
});

describe('the pool holds ONLY standing idles', () => {
    test('no laying clip can be drawn — she must not lie down on returning to rest', () => {
        // The grounded index keys a file by its basename minus the category
        // prefix, so `laying/laying_idle.bvh` is indexed under `idle`. A
        // `random` entry is widened with that index unless it opts out, which
        // put three laying clips in the idle rotation.
        const candidates = ClipMap.resolve('idle').candidates;
        expect(candidates.filter((p) => p.includes('/laying/'))).toEqual([]);
    });

    test('nor a sitting, kneeling or exercise clip', () => {
        const candidates = ClipMap.resolve('idle').candidates;
        for (const dir of ['/sitting/', '/kneeling/', '/exercise/', '/dance/']) {
            expect(candidates.filter((p) => p.includes(dir))).toEqual([]);
        }
    });

    test('the pool is EXACTLY the curated list, nothing more', () => {
        expect(ClipMap.resolve('idle').candidates.slice().sort()).toEqual(IDLE_POOL.slice().sort());
    });

    test('but dance still draws from the whole library — curation is per entry', () => {
        expect(ClipMap.resolve('dance').candidates.length).toBeGreaterThan(15);
    });
});

describe('entering idle draws a fresh clip', () => {
    test('successive resolves do not return the same clip every time', () => {
        const picks = new Set();
        for (let i = 0; i < 24; i++) picks.add(ClipMap.resolve('idle').candidates[0]);
        // A shuffle bag over a 7+ clip pool cannot yield one value across 24 draws.
        expect(picks.size).toBeGreaterThan(1);
    });

    test('the draw covers the whole pool, not a favoured couple', () => {
        const picks = new Set();
        for (let i = 0; i < 200; i++) picks.add(ClipMap.resolve('idle').candidates[0]);
        for (const path of IDLE_POOL) expect(picks).toContain(path);
    });

    test('back-to-back repeats are rare, which is what the bag actually buys', () => {
        // The bag guarantees no repeat WITHIN a cycle: it is shuffled once and
        // drained. It does NOT guarantee no repeat across a refill, because the
        // fresh shuffle can put the just-drawn clip first. With a pool of N that
        // is a 1/N chance every N draws, so a few percent overall -- worth
        // stating rather than over-claiming.
        const picks = [];
        for (let i = 0; i < 400; i++) picks.push(ClipMap.resolve('idle').candidates[0]);
        let repeats = 0;
        for (let i = 1; i < picks.length; i++) if (picks[i] === picks[i - 1]) repeats++;
        expect(repeats / picks.length).toBeLessThan(0.1);
    });

    test('a full cycle drains the bag before any clip comes round again', () => {
        // Draw two full pool-lengths: every clip must appear at least twice, so
        // no clip can have been starved.
        const size = ClipMap.resolve('idle').candidates.length;
        const counts = Object.create(null);
        for (let i = 0; i < size * 6; i++) {
            const pick = ClipMap.resolve('idle').candidates[0];
            counts[pick] = (counts[pick] || 0) + 1;
        }
        for (const path of IDLE_POOL) expect(counts[path]).toBeGreaterThanOrEqual(2);
    });
});

describe('a running idle is never swapped mid-loop', () => {
    test('the first request starts a clip', async () => {
        const res = await ClipMap.play('idle');
        expect(res.ok).toBe(true);
        expect(playCalls).toHaveLength(1);
        expect(IDLE_POOL).toContain(playCalls[0]);
    });

    test('re-requesting idle is a no-op, whatever the draw would have been', async () => {
        await ClipMap.play('idle');
        const again = await ClipMap.play('idle');
        expect(again.already).toBe(true);
        expect(playCalls).toHaveLength(1); // exactly ONE mixer start
    });

    test('and stays a no-op across many reschedules', async () => {
        await ClipMap.play('idle');
        for (let i = 0; i < 15; i++) await ClipMap.play('idle');
        expect(playCalls).toHaveLength(1);
    });

    test('ANY pool member counts as being in the state, not just the drawn one', async () => {
        // This is the half a plain path-equality guard misses: a random entry
        // draws a different candidate each call, so comparing against the draw
        // would restart the loop every time.
        playing = { clip: 'vendor/animations/idle/neutral3.bvh', category: null, isPlaying: true };
        const res = await ClipMap.play('idle');
        expect(res.already).toBe(true);
        expect(playCalls).toHaveLength(0);
    });

    test('a stopped idle is restarted rather than skipped', async () => {
        await ClipMap.play('idle');
        playing.isPlaying = false;
        const again = await ClipMap.play('idle');
        expect(again.already).toBeUndefined();
        expect(playCalls).toHaveLength(2);
    });

    test('a non-idle clip playing does not block idle', async () => {
        playing = { clip: 'addons/vrma-dance/dance_rumba.vrma', category: null, isPlaying: true };
        const res = await ClipMap.play('idle');
        expect(res.already).toBeUndefined();
        expect(playCalls).toHaveLength(1);
    });
});

describe('the ambient rule is opt-in, so explicit asks still act', () => {
    test('dance is NOT ambient — asking again while dancing draws a new one', () => {
        expect(ClipMap.resolve('dance').ambient).toBeUndefined();
    });

    test('only ambient entries carry the flag', () => {
        expect(ClipMap.resolve('idle').ambient).toBe(true);
    });
});
