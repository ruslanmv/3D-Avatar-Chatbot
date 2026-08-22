/**
 * The default seated pose is Sit idle 4.
 *
 * Of the four sitting captures only sit_idle4 opens ALREADY SEATED. The other
 * three spend their first 3-6 frames standing before the root drops onto the
 * seated plane, so looping them reads as a rhythmic stand/sit flicker. Root Y
 * measured from the shipped files, frame 0 onwards:
 *
 *   sit_idle   11.68,  4.34, -3.00 -> -10.34   (3 standing frames)
 *   sit_idle2  11.68 ...    -1.75 ->  -4.44    (6 standing frames)
 *   sit_idle3  11.68,  6.31,  0.94 ->  -4.44   (3 standing frames)
 *   sit_idle4  -4.11 flat from frame 0
 *
 * sit_idle is additionally ~5.9 units below its siblings' seated plane, which
 * drops the avatar through the seat. It stays reachable by name for the
 * Animations panel, but must never be what "sit down" picks.
 *
 * The assertions read the real manifest and the real BVH files — the claim is
 * about shipped assets, so a fixture would prove nothing.
 */

/* global describe, test, expect, beforeAll, afterAll */

const fs = require('fs');
const path = require('path');
const Clips = require('../src/xr/MotionClipMap');
const manifest = require('../vendor/animations/manifest.json');

const SIT_DIR = path.join(__dirname, '..', 'vendor', 'animations', 'sitting');
const SIT4 = 'vendor/animations/sitting/sit_idle4.bvh';
const SIT1 = 'vendor/animations/sitting/sit_idle.bvh';

beforeAll(() => {
    Clips._setManifest(manifest);
    Clips._setLibraryOnly(false);
});
afterAll(() => {
    Clips._setManifest(null);
    Clips._setLibraryOnly(null);
});

/** Root-channel Y for every frame of a shipped BVH. */
function rootY(file) {
    const lines = fs.readFileSync(path.join(SIT_DIR, file), 'utf8').split('\n');
    const start = lines.findIndex((l) => l.trim().startsWith('Frame Time'));
    return lines
        .slice(start + 1)
        .filter((l) => l.trim())
        .map((l) => parseFloat(l.trim().split(/\s+/)[1]));
}

describe('"sit down" lands on the one clean sitting capture', () => {
    test('the seated loop leads with sit_idle4', () => {
        expect(Clips.resolve('sit_idle').candidates[0]).toBe(SIT4);
    });

    test('so does the sit posture, after the optional generated pack', () => {
        const c = Clips.resolve('sit').candidates;
        // The pack clip is optional and does not ship; the first clip that
        // actually exists on disk is what plays.
        const shipped = c.filter((p) => p.startsWith('vendor/'));
        expect(shipped[0]).toBe(SIT4);
    });

    test('sit_down is an alias of the same posture', () => {
        expect(Clips.resolve('sit_down').candidates).toEqual(Clips.resolve('sit').candidates);
    });

    test('the broken capture is never the first clip that ships', () => {
        for (const name of ['sit', 'sit_idle', 'sit_down']) {
            const shipped = Clips.resolve(name).candidates.filter((p) => p.startsWith('vendor/'));
            expect(shipped[0]).not.toBe(SIT1);
        }
    });

    test('but it stays reachable, so the Animations panel can still list it', () => {
        expect(Clips.resolve('sit_idle').candidates).toContain(SIT1);
    });
});

describe('the data behind the choice', () => {
    test('sit_idle4 opens seated and stays there', () => {
        const y = rootY('sit_idle4.bvh');
        expect(y.length).toBeGreaterThan(100);
        const settled = y[y.length - 1];
        // Frame 0 is already the settled pose — that is the whole point.
        expect(Math.abs(y[0] - settled)).toBeLessThan(0.5);
        expect(Math.max(...y) - Math.min(...y)).toBeLessThan(1);
    });

    test('the other three open standing — looping them is the flicker', () => {
        for (const f of ['sit_idle.bvh', 'sit_idle2.bvh', 'sit_idle3.bvh']) {
            const y = rootY(f);
            const settled = y[y.length - 1];
            expect(y[0] - settled).toBeGreaterThan(5);
        }
    });

    test('sit_idle sits far below the shared seated plane', () => {
        const plane = (f) => rootY(f)[rootY(f).length - 1];
        const good = [plane('sit_idle2.bvh'), plane('sit_idle3.bvh'), plane('sit_idle4.bvh')];
        expect(Math.max(...good) - Math.min(...good)).toBeLessThan(1);
        expect(Math.min(...good) - plane('sit_idle.bvh')).toBeGreaterThan(5);
    });
});
