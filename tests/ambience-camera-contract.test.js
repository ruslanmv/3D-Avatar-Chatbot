/**
 * The committed camera contract must match the module that generates it (batch A15).
 *
 * `assets/ambient/camera-contract.json` is how the projection leaves this app. The Python asset
 * pipeline reads it, and so does 3D-Ambience-Studio, because neither can run
 * `CalibrationGeometry.js` — and reimplementing the projection a third time is how the numbers
 * would quietly stop agreeing.
 *
 * Publishing it as data solves that only if the data cannot go stale. This suite regenerates the
 * contract from the module and compares it to the committed file, so changing the camera without
 * re-exporting fails here rather than in somebody's art three weeks later.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT = path.join(ROOT, 'assets/ambient/camera-contract.json');
const Geometry = require('../src/gltf-viewer/ambience/CalibrationGeometry.js');

const committed = JSON.parse(fs.readFileSync(CONTRACT, 'utf-8'));

describe('the committed contract is what the module produces', () => {
    test('regenerating it changes nothing', () => {
        // The whole point. Run the real exporter into a scratch copy and diff.
        const before = fs.readFileSync(CONTRACT, 'utf-8');
        execFileSync('node', [path.join(ROOT, 'tools/ambience/export-camera-contract.mjs')], { cwd: ROOT });
        const after = fs.readFileSync(CONTRACT, 'utf-8');
        expect(after).toBe(before);
    });

    test('it carries no timestamp, so regenerating is a no-op in a diff', () => {
        const text = JSON.stringify(committed);
        expect(text).not.toMatch(/generatedAt|timestamp|\d{4}-\d{2}-\d{2}T/);
    });
});

describe('the figures match CalibrationGeometry directly', () => {
    const avatar = committed.nominalAvatar;

    test.each(['landscape', 'portrait'])('%s horizon, feet and head', (key) => {
        const guide = Geometry.guide(Geometry.PROFILES[key], avatar);
        const p = committed.profiles[key];
        expect(p.horizonY).toBeCloseTo(guide.horizonY, 5);
        expect(p.footAnchor.y).toBeCloseTo(guide.footAnchor.y, 5);
        expect(p.headTopY).toBeCloseTo(guide.headTopY, 5);
        expect(p.fovDeg).toBe(Geometry.PROFILES[key].fovDeg);
    });

    test('the tilt is recorded, not assumed away', () => {
        // A consumer that read pitchDeg as 0 would place its horizon at mid-frame and be 60px
        // out on a 1080 master. It is in the contract precisely so nobody has to know about
        // frameObject's eye lift to get it right.
        for (const key of ['landscape', 'portrait']) {
            expect(committed.profiles[key].pitchDeg).toBeCloseTo(1.7184, 3);
            expect(committed.profiles[key].horizonY).toBeLessThan(0.5);
        }
    });

    test('ground lines converge and stay below the horizon', () => {
        for (const key of ['landscape', 'portrait']) {
            const p = committed.profiles[key];
            expect(p.groundLines.length).toBeGreaterThan(0);
            for (const g of p.groundLines) expect(g.y).toBeGreaterThan(p.horizonY);
            for (let i = 1; i < p.groundLines.length; i += 1) {
                expect(p.groundLines[i].y).toBeLessThan(p.groundLines[i - 1].y);
            }
        }
    });

    test('the masters are the ones the production guide calls for', () => {
        expect(committed.profiles.landscape.master).toEqual({ width: 1920, height: 1080 });
        expect(committed.profiles.portrait.master).toEqual({ width: 1080, height: 1920 });
    });

    test('it names where the numbers come from, for whoever finds the file alone', () => {
        expect(committed.sourceOfTruth).toBe('src/gltf-viewer/ambience/CalibrationGeometry.js');
        expect(committed.generatedBy).toContain('export-camera-contract.mjs');
    });
});

describe('it is a production target, not a snapshot of whatever avatar is loaded', () => {
    test('the avatar it was computed for is stated', () => {
        // Art is authored once and has to suit any avatar, so the contract uses a nominal
        // figure. `?backgroundCalibration=1` reports the measured one for the model in front of
        // you; the two differing is expected, and this field is what makes that legible.
        expect(committed.nominalAvatar).toEqual({ height: 1.6, width: 0.55, footY: 0 });
    });
});
