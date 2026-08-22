'use strict';

/**
 * The avatar must stand at the SAME height in every standing clip.
 *
 * Reported: idle → "sit down" → "stand up" left the character sitting a little
 * lower in the viewport, and it stayed there.
 *
 * THREE.BVHLoader bakes OFFSET + channel into the hips position track
 * (vendor/three-0.147.0/examples/jsm/loaders/BVHLoader.js:375), and the loader
 * scales that by restY / OFFSET. So the height written is
 *
 *     restY * (1 + channel / OFFSET)
 *
 * Each capture's ROOT OFFSET is close to, but not equal to, the hips height it
 * actually stands at, and the residual differs per file. Measured on the
 * shipped assets as a fraction of the avatar's own rest height:
 *
 *     neutral_idle    0.965      <- what "idle" plays
 *     neutral4        0.967
 *     neutral         0.974
 *     action_standup  0.424 -> 0.991
 *     sit_idle4       0.591
 *
 * The avatar starts in the PROCEDURAL idle, which holds the hips at exactly
 * rest. After a sit/stand cycle the state machine plays neutral_idle.bvh, which
 * pins them 3.5% lower — and because idle loops, it never recovers. That 3.5%
 * is the reported sink.
 *
 * The fix re-centres clips that never leave the standing band onto the avatar's
 * own rest height, preserving any bob. Clips with real vertical choreography —
 * sit, kneel, crouch, laying, standup, the dances — are written through
 * untouched.
 */

/* global describe, test, expect, beforeAll */

const fs = require('fs');
const path = require('path');

const ANIM_DIR = path.join(__dirname, '..', 'vendor', 'animations');

let BVH;

beforeAll(() => {
    global.window = global.window || {};
    window.THREE = window.THREE || {};
    delete window.__CLIP_ANIM_CONST__;
    delete window.__BVH_LOADER__;
    jest.isolateModules(() => {
        require('../src/ClipAnimationShared.js');
        require('../src/BVHAnimationLoader.js');
    });
    BVH = window.__BVH_LOADER__;
});

/**
 * The hips position track THREE.BVHLoader would produce for a shipped file:
 * OFFSET + channel, per frame. Only Y varies in these captures.
 *
 * @returns {{offsetY: number, values: number[]}}
 */
function hipsTrack(relPath) {
    const lines = fs.readFileSync(path.join(ANIM_DIR, relPath), 'utf8').split('\n');

    let offsetY = null;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('ROOT')) {
            for (let j = i + 1; j < i + 6; j++) {
                if (lines[j].trim().startsWith('OFFSET')) {
                    offsetY = parseFloat(lines[j].trim().split(/\s+/)[2]);
                    break;
                }
            }
            break;
        }
    }

    const start = lines.findIndex((l) => l.trim().startsWith('Frame Time'));
    const values = [];
    for (const line of lines.slice(start + 1)) {
        if (!line.trim()) continue;
        const c = line.trim().split(/\s+/);
        values.push(parseFloat(c[0]) + 0, parseFloat(c[1]) + offsetY, parseFloat(c[2]) + 0);
    }
    return { offsetY, values };
}

/** A normalized VRM hips bone at rest. Height 1.0 keeps the maths readable. */
const REST_Y = 1.0;
const hipsBone = () => ({ position: { x: 0, y: REST_Y, z: 0 } });

/**
 * Run a shipped clip through the real retarget maths and report the vertical
 * range it writes, as a fraction of the avatar's rest height.
 */
function writtenRange(relPath) {
    const { offsetY, values } = hipsTrack(relPath);
    const scale = REST_Y / Math.abs(offsetY);
    const out = BVH._scaleHipsPosition(values, scale, false, hipsBone());
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < out.length; i += 3) {
        if (out[i] < lo) lo = out[i];
        if (out[i] > hi) hi = out[i];
    }
    return { lo: lo / REST_Y, hi: hi / REST_Y };
}

describe('the reported bug: idle sinks the avatar', () => {
    test('neutral_idle now holds the hips at exactly rest', () => {
        const { lo, hi } = writtenRange('idle/neutral_idle.bvh');
        expect((lo + hi) / 2).toBeCloseTo(1, 3);
    });

    test('every idle clip agrees on the standing height', () => {
        for (const f of ['neutral.bvh', 'neutral2.bvh', 'neutral3.bvh', 'neutral4.bvh', 'neutral_idle2.bvh']) {
            const { lo, hi } = writtenRange('idle/' + f);
            expect((lo + hi) / 2).toBeCloseTo(1, 2);
        }
    });

    test('so switching between idle clips cannot move her vertically', () => {
        const mids = ['neutral.bvh', 'neutral2.bvh', 'neutral3.bvh', 'neutral4.bvh', 'neutral_idle.bvh'].map((f) => {
            const { lo, hi } = writtenRange('idle/' + f);
            return (lo + hi) / 2;
        });
        expect(Math.max(...mids) - Math.min(...mids)).toBeLessThan(0.01);
    });
});

describe('real postures keep their height', () => {
    test('sitting stays well below standing', () => {
        const { lo, hi } = writtenRange('sitting/sit_idle4.bvh');
        // Untouched: 0.591 of rest, ~41 cm down on a 1 m rest height.
        expect(hi).toBeLessThan(0.7);
        expect(lo).toBeGreaterThan(0.5);
    });

    test('laying is lower still', () => {
        expect(writtenRange('laying/laying_idle.bvh').hi).toBeLessThan(0.3);
    });

    test('kneeling and crouching are not re-centred', () => {
        expect(writtenRange('kneeling/kneel_idle.bvh').lo).toBeLessThan(0.7);
        expect(writtenRange('action/action_crouch.bvh').lo).toBeLessThan(0.7);
    });
});

describe('vertical choreography survives', () => {
    test('stand-up still rises from seated to standing', () => {
        const { lo, hi } = writtenRange('action/action_standup.bvh');
        expect(lo).toBeLessThan(0.5); // starts seated
        expect(hi).toBeGreaterThan(0.95); // ends standing
    });

    test('and it finishes close enough to rest for the blend into idle', () => {
        // The step from standup's last frame to idle's rest is what the user
        // would see as a pop. Under 2% of rest is ~1.5 cm — the crossfade
        // covers it.
        expect(1 - writtenRange('action/action_standup.bvh').hi).toBeLessThan(0.02);
    });

    test('a jump still leaves the ground', () => {
        expect(writtenRange('action/action_jump.bvh').hi).toBeGreaterThan(1.2);
    });

    test('dances keep their vertical motion', () => {
        const { lo, hi } = writtenRange('dance/dance_gangnam_style.bvh');
        expect(hi - lo).toBeGreaterThan(0.1);
    });
});

describe('horizontal drift is still pinned away', () => {
    test('x and z are the rest values, never the capture volume', () => {
        const bone = { position: { x: 0.25, y: REST_Y, z: -0.4 } };
        const values = [99, 10, -99, 123, 10, 456];
        const out = BVH._scaleHipsPosition(values, 0.1, false, bone);
        expect(out[0]).toBeCloseTo(0.25, 6);
        expect(out[2]).toBeCloseTo(-0.4, 6);
        expect(out[3]).toBeCloseTo(0.25, 6);
        expect(out[5]).toBeCloseTo(-0.4, 6);
    });
});

describe('degenerate input does not throw or displace', () => {
    test('an empty track returns an empty result', () => {
        expect(BVH._scaleHipsPosition([], 1, false, hipsBone()).length).toBe(0);
    });

    test('a hips bone with no rest height disables re-centring rather than guessing', () => {
        const out = BVH._scaleHipsPosition([0, 10, 0], 0.1, false, { position: { x: 0, y: 0, z: 0 } });
        expect(out[1]).toBeCloseTo(1, 6); // 10 * 0.1, written through
    });
});
