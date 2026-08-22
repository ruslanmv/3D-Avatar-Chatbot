'use strict';

/**
 * Laying is a POSTURE, like sitting — not an idle.
 *
 * It was reachable only by accident. "lay", "lie down" and "lie" resolved to
 * nothing at all; "laying" fuzzy-matched laying_idle2.bvh and played it as a
 * ONE-SHOT, after which _scheduleIdle pulled her back into a standing idle a
 * second later. And laying_idle2 is the worst of the three files: 25 frames
 * (under a second) with the hips at 1.075 of the avatar's rest height — above
 * standing, so she floated.
 *
 * Hips as a fraction of rest height, measured on the shipped files:
 *
 *   laying_idle   0.129 flat, 309 frames   <- lying down, and stays there
 *   laying_idle3  1.959 -> 0.129           a stand-to-lie TRANSITION; looping
 *                                          it stands her back up each cycle
 *   laying_idle2  1.075 flat, 25 frames    above standing height
 *
 * The fix mirrors sitting exactly: a curated looping entry led by the clean
 * capture, a `state.laying` flag so the posture survives the next idle
 * reschedule, and "stop"/"stand up" as the ways out.
 */

/* global describe, test, expect, beforeEach, afterEach, afterAll */

const ClipMap = require('../src/xr/MotionClipMap');
const Parser = require('../src/xr/MotionBlockParser');
const FastPath = require('../src/xr/IntentFastPath');
const manifest = require('../vendor/animations/manifest.json');

const CLEAN = 'vendor/animations/laying/laying_idle.bvh';
const TRANSITION = 'vendor/animations/laying/laying_idle3.bvh';
const FLOATING = 'vendor/animations/laying/laying_idle2.bvh';

beforeEach(() => {
    ClipMap._setManifest(manifest);
    ClipMap._setLibraryOnly(true);
    ClipMap._setBvhAllowed(true);
    ClipMap.resetUnavailable();
});
afterEach(() => ClipMap.resetUnavailable());
afterAll(() => {
    ClipMap._setManifest(null);
    ClipMap._setLibraryOnly(null);
    ClipMap._setBvhAllowed(null);
});

describe('every natural phrasing reaches the posture', () => {
    test('the ones that used to resolve to NOTHING', () => {
        for (const name of ['lay', 'lie', 'lie_down']) {
            const entry = ClipMap.resolve(name);
            expect(entry).not.toBeNull();
            expect(entry.candidates[0]).toBe(CLEAN);
        }
    });

    test('the ones that used to resolve to the WRONG clip', () => {
        // "laying" fuzzy-matched laying_idle2 as a one-shot.
        for (const name of ['laying', 'lying', 'lay_down', 'laydown', 'lying_down', 'laying_down']) {
            expect(ClipMap.resolve(name).candidates[0]).toBe(CLEAN);
        }
    });

    test('the fast path catches it, so it does not wait on the model', () => {
        for (const text of ['lie down', 'lay down', 'lie on the floor', 'sdraiati', 'acuestate']) {
            const hit = FastPath.match(text);
            expect(hit).not.toBeNull();
            expect(hit.label).toBe('lay');
        }
    });

    test('and the model is allowed to ask for it', () => {
        expect(Parser.ALLOWED_TYPES).toContain('lay');
        const plan = Parser.validatePlan({ commands: [{ type: 'lay' }] });
        expect(plan.commands[0].type).toBe('lay');
    });
});

describe('it behaves as a posture, not a gesture', () => {
    test('it LOOPS and is sticky — otherwise idle reclaims her a second later', () => {
        const entry = ClipMap.resolve('lay');
        expect(entry.loop).toBe(true);
        expect(entry.sticky).toBe(true);
    });

    test('sit behaves the same way, which is the pattern being mirrored', () => {
        expect(ClipMap.resolve('sit').loop).toBe(true);
        expect(ClipMap.resolve('sit').sticky).toBe(true);
    });

    test('lay_idle holds the posture across reschedules', () => {
        const entry = ClipMap.resolve('lay_idle');
        expect(entry.candidates[0]).toBe(CLEAN);
        expect(entry.loop).toBe(true);
    });
});

describe('clip order — the clean capture leads', () => {
    test('the flat 309-frame lying clip is first, not the 25-frame floater', () => {
        const candidates = ClipMap.resolve('lay').candidates;
        expect(candidates[0]).toBe(CLEAN);
        expect(candidates.indexOf(FLOATING)).toBeGreaterThan(0);
    });

    test('the stand-to-lie TRANSITION is not first either — looping it flickers', () => {
        expect(ClipMap.resolve('lay').candidates.indexOf(TRANSITION)).toBeGreaterThan(0);
    });

    test('but both stay reachable, since they are manifest files', () => {
        const candidates = ClipMap.resolve('lay').candidates;
        expect(candidates).toContain(TRANSITION);
        expect(candidates).toContain(FLOATING);
    });

    test('the pool is curated — no standing idle can leak into it', () => {
        const candidates = ClipMap.resolve('lay').candidates;
        for (const p of candidates) expect(p).toContain('/laying/');
    });
});

describe('laying and idle stay separate', () => {
    test('no laying clip is in the idle pool', () => {
        expect(ClipMap.resolve('idle').candidates.filter((p) => p.includes('/laying/'))).toEqual([]);
    });

    test('no idle clip is in the laying pool', () => {
        expect(ClipMap.resolve('lay').candidates.filter((p) => p.includes('/idle/'))).toEqual([]);
    });

    test('the model is offered the posture but never the reschedule target', () => {
        const names = ClipMap.availableNames();
        expect(names).toContain('lay');
        expect(names).not.toContain('lay_idle');
        expect(names).not.toContain('sit_idle');
    });
});
