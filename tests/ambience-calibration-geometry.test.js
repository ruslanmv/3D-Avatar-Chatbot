/**
 * The numbers a backplate has to be composed against (batch A13).
 *
 * A2–A12 built a correct `cover` renderer, and a scenic background can still read as a cut-out,
 * because fitting an image to the viewport is not the same as matching its camera to the 3D
 * camera. This module turns the engine's real projection into figures an artist or an image
 * model can actually be held to — "the horizon is at 44.4% of frame height", not "30 degree
 * FOV".
 *
 * Because those figures become a *specification*, the maths is checked here from first
 * principles rather than against itself:
 *
 *   * a **level** camera must put the horizon exactly at the middle of the frame — the one case
 *     with an analytic answer, and the control for everything else;
 *   * tilting down must move it **up**, monotonically;
 *   * a point on the frustum edge must land on the frame edge, which pins the FOV handling;
 *   * ground lines must converge on the horizon and never cross it.
 *
 * The tilt is the reason this file exists in the shape it does. The first draft of the module
 * assumed a level camera and reported the horizon at exactly 50% for both profiles — clean,
 * memorable, and wrong, because `ViewerEngine.frameObject` lifts the eye by `normalize(0, 0.03,
 * 1)`. Sixty pixels on a 1080-tall master. `the shipped profiles` below pins the corrected
 * figures so that a change in `frameObject` breaks this rather than the art.
 */

const Geometry = require('../src/gltf-viewer/ambience/CalibrationGeometry.js');

const AVATAR = { height: 1.6, width: 0.55, footY: 0 };
const DEG2RAD = Math.PI / 180;

/** A deliberately independent projector, for the assertions that must not be self-referential. */
function projectIndependently(point, eye, target, fovDeg, aspect) {
    const f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
    const fl = Math.hypot(f[0], f[1], f[2]);
    const fwd = [f[0] / fl, f[1] / fl, f[2] / fl];
    let r = [fwd[1] * 0 - fwd[2] * 1, fwd[2] * 0 - fwd[0] * 0, fwd[0] * 1 - fwd[1] * 0];
    const rl = Math.hypot(r[0], r[1], r[2]);
    r = [r[0] / rl, r[1] / rl, r[2] / rl];
    const up = [r[1] * fwd[2] - r[2] * fwd[1], r[2] * fwd[0] - r[0] * fwd[2], r[0] * fwd[1] - r[1] * fwd[0]];
    const v = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
    const z = v[0] * fwd[0] + v[1] * fwd[1] + v[2] * fwd[2];
    const tanV = Math.tan((fovDeg * DEG2RAD) / 2);
    const ndcX = (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / z / (tanV * aspect);
    const ndcY = (v[0] * up[0] + v[1] * up[1] + v[2] * up[2]) / z / tanV;
    return { x: (ndcX + 1) / 2, y: (1 - ndcY) / 2 };
}

describe('projection, checked against cases with known answers', () => {
    test('a point at the look-at target lands dead centre', () => {
        const view = { eye: [0, 1, 4], target: [0, 1, 0], fovDeg: 30, aspect: 16 / 9 };
        const p = Geometry.project([0, 1, 0], view);
        expect(p.x).toBeCloseTo(0.5, 10);
        expect(p.y).toBeCloseTo(0.5, 10);
        expect(p.behind).toBe(false);
    });

    test('a point on the top frustum edge lands on the top edge', () => {
        // At distance d the visible half-height is d * tan(vFov/2). A point exactly that far
        // above the axis must therefore project to y = 0. This is what pins FOV handling.
        const view = { eye: [0, 0, 4], target: [0, 0, 0], fovDeg: 30, aspect: 16 / 9 };
        const halfHeight = 4 * Math.tan((30 * DEG2RAD) / 2);
        expect(Geometry.project([0, halfHeight, 0], view).y).toBeCloseTo(0, 10);
    });

    test('and the right frustum edge lands on the right edge, which pins aspect', () => {
        const view = { eye: [0, 0, 4], target: [0, 0, 0], fovDeg: 30, aspect: 16 / 9 };
        const halfWidth = 4 * Math.tan((30 * DEG2RAD) / 2) * (16 / 9);
        expect(Geometry.project([halfWidth, 0, 0], view).x).toBeCloseTo(1, 10);
    });

    test('it agrees with an independently written projector', () => {
        const view = { eye: [0, 1.2, 3.5], target: [0, 0.9, 0], fovDeg: 30, aspect: 16 / 9 };
        for (const point of [
            [0, 0, 0],
            [0.4, 1.7, -1],
            [-0.8, 0.2, -3],
        ]) {
            const ours = Geometry.project(point, view);
            const theirs = projectIndependently(point, view.eye, view.target, view.fovDeg, view.aspect);
            expect(ours.x).toBeCloseTo(theirs.x, 9);
            expect(ours.y).toBeCloseTo(theirs.y, 9);
        }
    });

    test('a point behind the camera is reported, not clamped', () => {
        // Clamping would draw a foot marker at the frame edge and imply the framing is fine.
        const view = { eye: [0, 1, 4], target: [0, 1, 0], fovDeg: 30, aspect: 16 / 9 };
        expect(Geometry.project([0, 1, 10], view).behind).toBe(true);
    });

    test('a degenerate basis does not produce NaN', () => {
        // Camera directly above its target: forward is parallel to world up and the cross
        // product collapses. A guide that silently became NaN would be a blank overlay.
        const view = { eye: [0, 5, 0], target: [0, 0, 0], fovDeg: 30, aspect: 1 };
        const p = Geometry.project([0.5, 0, 0.5], view);
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
    });
});

describe('the horizon', () => {
    test('a level camera puts it exactly at mid-frame', () => {
        // The one analytic answer, and the control for every other horizon assertion.
        const view = { eye: [0, 1.5, 4], target: [0, 1.5, 0], fovDeg: 30, aspect: 16 / 9 };
        expect(Geometry.horizonY(view)).toBeCloseTo(0.5, 10);
    });

    test('tilting down moves it up the frame, monotonically', () => {
        let previous = 0.5;
        for (const lift of [0.05, 0.2, 0.5, 1.0]) {
            const view = { eye: [0, 1.5 + lift, 4], target: [0, 1.5, 0], fovDeg: 30, aspect: 16 / 9 };
            const y = Geometry.horizonY(view);
            expect(y).toBeLessThan(previous);
            previous = y;
        }
    });

    test('tilting up moves it down the frame', () => {
        const view = { eye: [0, 1.0, 4], target: [0, 1.5, 0], fovDeg: 30, aspect: 16 / 9 };
        expect(Geometry.horizonY(view)).toBeGreaterThan(0.5);
    });

    test('a camera pointing straight down has no horizon in frame', () => {
        expect(Geometry.horizonY({ eye: [0, 5, 0], target: [0, 0, 0], fovDeg: 30, aspect: 1 })).toBeNull();
    });

    test('a wider lens pulls it toward centre', () => {
        // More of the world in frame, so the same angular offset is a smaller fraction of it.
        const base = { eye: [0, 1.8, 4], target: [0, 1.5, 0], aspect: 16 / 9 };
        const narrow = Geometry.horizonY(Object.assign({ fovDeg: 20 }, base));
        const wide = Geometry.horizonY(Object.assign({ fovDeg: 60 }, base));
        expect(Math.abs(wide - 0.5)).toBeLessThan(Math.abs(narrow - 0.5));
    });
});

describe('the shipped profiles', () => {
    test('they carry the FOVs the app really uses', () => {
        expect(Geometry.PROFILES.landscape.fovDeg).toBe(30);
        expect(Geometry.PROFILES.portrait.fovDeg).toBe(42);
        expect(Geometry.PROFILES.landscape.fitOffset).toBe(1.35);
        expect(Geometry.PROFILES.portrait.fitOffset).toBe(1.4);
        expect(Geometry.PROFILES.landscape.biasY).toBe(0.04);
    });

    test('the camera is tilted, not level — the correction this batch turned on', () => {
        // frameObject lifts the eye by normalize(0, 0.03, 1). ~1.7°, and the reason the horizon
        // is not at mid-frame. Assume level and every backplate is 60px out on a 1080 master.
        const view = Geometry.frameFor(Geometry.PROFILES.landscape, AVATAR);
        expect(view.pitchDeg).toBeCloseTo(1.718, 2);
        expect(view.eye[1]).toBeGreaterThan(view.target[1]);
    });

    test('the horizon is above mid-frame in both profiles, and by how much', () => {
        const land = Geometry.guide(Geometry.PROFILES.landscape, AVATAR);
        const port = Geometry.guide(Geometry.PROFILES.portrait, AVATAR);
        expect(land.horizonY).toBeCloseTo(0.444, 3);
        expect(port.horizonY).toBeCloseTo(0.461, 3);
        expect(land.horizonY).toBeLessThan(0.5);
        expect(port.horizonY).toBeLessThan(0.5);
    });

    test('in pixels, on the two masters the spec calls for', () => {
        const land = Geometry.toPixels(Geometry.guide(Geometry.PROFILES.landscape, AVATAR), 1920, 1080);
        expect(land.horizonY).toBe(480);
        expect(land.footAnchor).toEqual({ x: 960, y: 969 });

        const port = Geometry.toPixels(Geometry.guide(Geometry.PROFILES.portrait, AVATAR), 1080, 1920);
        expect(port.horizonY).toBe(885);
        expect(port.footAnchor).toEqual({ x: 540, y: 1694 });
    });

    test('the feet land low and the head high, with the subject inside the frame', () => {
        for (const key of ['landscape', 'portrait']) {
            const g = Geometry.guide(Geometry.PROFILES[key], AVATAR);
            expect(g.headTopY).toBeGreaterThan(0);
            expect(g.footAnchor.y).toBeLessThan(1);
            expect(g.headTopY).toBeLessThan(g.footAnchor.y);
            // Headroom above, and less of it below: the 0.04 bias pushes her down in frame.
            expect(g.headTopY).toBeGreaterThan(1 - g.footAnchor.y);
        }
    });

    test('the avatar is centred horizontally', () => {
        expect(Geometry.guide(Geometry.PROFILES.landscape, AVATAR).footAnchor.x).toBeCloseTo(0.5, 10);
    });

    test('the keep-clear band is measured from the avatar, not hard-coded', () => {
        // It was a flat 0.3–0.7, which is roughly right in landscape and wrong in portrait.
        // Now it is her projected silhouette plus a small frame-relative margin.
        const g = Geometry.guide(Geometry.PROFILES.landscape, AVATAR);
        expect(g.safeZone.x0).toBeCloseTo(0.398, 2);
        expect(g.safeZone.x1).toBeCloseTo(0.602, 2);
        expect(g.safeZone.x0 + g.safeZone.x1).toBeCloseTo(1, 6); // centred
    });

    test('and it widens in portrait, because she fills more of a narrow frame', () => {
        // The bug this replaced. In portrait fitDistance is bound by her height, so the camera
        // comes close: at 9:20 her silhouette alone spans 22.7–77.3%, well outside a 30–70%
        // band. An artist told to keep 30–70% clear would still put scenery through her
        // shoulders.
        const portrait = Geometry.guide(Geometry.PROFILES.portrait, AVATAR);
        const landscape = Geometry.guide(Geometry.PROFILES.landscape, AVATAR);
        const width = (g) => g.safeZone.x1 - g.safeZone.x0;
        expect(width(portrait)).toBeGreaterThan(width(landscape));

        const tall = Geometry.guide(Object.assign({}, Geometry.PROFILES.portrait, { aspect: 9 / 20 }), AVATAR);
        expect(width(tall)).toBeGreaterThan(width(portrait));
    });

    test('the band always contains the avatar it was computed for', () => {
        // The property that makes it correct at any aspect, rather than a number that happens
        // to work at one.
        for (const [key, aspect] of [
            ['landscape', 16 / 9],
            ['portrait', 9 / 16],
            ['portrait', 9 / 20],
            ['portrait', 9 / 21],
        ]) {
            const profile = Object.assign({}, Geometry.PROFILES[key], { aspect });
            const view = Geometry.frameFor(profile, AVATAR);
            const g = Geometry.guide(profile, AVATAR);
            const left = Geometry.project([-AVATAR.width / 2, AVATAR.height * 0.5, 0], view);
            const right = Geometry.project([AVATAR.width / 2, AVATAR.height * 0.5, 0], view);
            expect(g.safeZone.x0).toBeLessThanOrEqual(left.x);
            expect(g.safeZone.x1).toBeGreaterThanOrEqual(right.x);
        }
    });

    test('an explicit keepClear still overrides it', () => {
        const custom = Geometry.guide(Geometry.PROFILES.landscape, AVATAR, { keepClear: [0.25, 0.75] });
        expect(custom.safeZone.x0).toBeCloseTo(0.25, 10);
    });

    test('it stays inside the frame even for an unusually wide subject', () => {
        const wide = Geometry.guide(Geometry.PROFILES.portrait, { height: 1.6, width: 3.0, footY: 0 });
        expect(wide.safeZone.x0).toBeGreaterThanOrEqual(0);
        expect(wide.safeZone.x1).toBeLessThanOrEqual(1);
    });

    test('the profiles are frozen', () => {
        expect(Object.isFrozen(Geometry.PROFILES)).toBe(true);
        expect(Object.isFrozen(Geometry.PROFILES.landscape)).toBe(true);
    });
});

describe('ground lines — the perspective cue the whole exercise is about', () => {
    const guide = Geometry.guide(Geometry.PROFILES.landscape, AVATAR);

    test('they converge towards the horizon as depth increases', () => {
        for (let i = 1; i < guide.groundLines.length; i += 1) {
            expect(guide.groundLines[i].y).toBeLessThan(guide.groundLines[i - 1].y);
        }
    });

    test('and never cross it — a floor line above the horizon is impossible', () => {
        for (const line of guide.groundLines) {
            expect(line.y).toBeGreaterThan(guide.horizonY);
        }
    });

    test('the nearest line is below the feet, so the floor reads as continuing forward', () => {
        expect(guide.groundLines[0].y).toBeLessThan(guide.footAnchor.y);
    });

    test('lines outside the frame are dropped rather than drawn off-screen', () => {
        const far = Geometry.guide(Geometry.PROFILES.landscape, AVATAR, { depths: [0.5, 1000000] });
        for (const line of far.groundLines) {
            expect(line.y).toBeGreaterThanOrEqual(0);
            expect(line.y).toBeLessThanOrEqual(1);
        }
    });

    test('the depths are an input', () => {
        const g = Geometry.guide(Geometry.PROFILES.landscape, AVATAR, { depths: [1, 3] });
        expect(g.groundLines.map((l) => l.metres)).toEqual([1, 3]);
    });
});

describe('crossCheck — proving "independent" rather than asserting it', () => {
    test('agreement inside the tolerance', () => {
        const r = Geometry.crossCheck({ x: 0.5, y: 0.44 }, { x: 0.5005, y: 0.4405 });
        expect(r.agrees).toBe(true);
        expect(r.dx).toBeCloseTo(0.0005, 6);
    });

    test('disagreement is reported with the size of the gap', () => {
        const r = Geometry.crossCheck({ x: 0.5, y: 0.44 }, { x: 0.53, y: 0.44 });
        expect(r.agrees).toBe(false);
        expect(r.dx).toBeCloseTo(0.03, 6);
    });

    test('the tolerance is adjustable and defaulted', () => {
        expect(Geometry.crossCheck({ x: 0, y: 0 }, { x: 0.0019, y: 0 }).agrees).toBe(true);
        expect(Geometry.crossCheck({ x: 0, y: 0 }, { x: 0.0019, y: 0 }, 0.001).agrees).toBe(false);
    });
});

describe('house shape', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../src/gltf-viewer/ambience/CalibrationGeometry.js'), 'utf-8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    test('zero imports and zero exports, so Jest can require it', () => {
        expect(code).not.toMatch(/^\s*import\s/m);
        expect(code).not.toMatch(/^\s*export\s/m);
    });

    test('it needs no THREE at all', () => {
        expect(code).not.toMatch(/\bTHREE\b/);
    });

    test('dual export', () => {
        expect(code).toContain('module.exports = api;');
        expect(code).toContain('global.NEXUS_AMBIENCE_CALIBRATION_GEOMETRY = api;');
    });
});

describe('the production guide does not go stale', () => {
    /**
     * Every figure `docs/BACKPLATE_PRODUCTION.md` quotes, checked against the module.
     *
     * Not pedantry. The first draft of that document carried the ground-line table from a run
     * made *before* the camera-lift correction, so it told artists to converge a floor on
     * numbers that were several percent out — the exact failure the batch exists to prevent,
     * reintroduced in prose. A document nobody can verify is a document that drifts.
     */
    const fs = require('fs');
    const path = require('path');
    const doc = fs.readFileSync(path.resolve(__dirname, '../docs/BACKPLATE_PRODUCTION.md'), 'utf-8');

    function quoted(row) {
        const line = doc.split('\n').find((l) => l.trim().startsWith(`| ${row} |`));
        if (!line) throw new Error(`no row "${row}" in BACKPLATE_PRODUCTION.md`);
        return line;
    }

    test('the ground-line table matches the computed convergence', () => {
        const g = Geometry.guide(Geometry.PROFILES.landscape, AVATAR);
        for (const line of g.groundLines) {
            const row = quoted(`${line.metres} m`);
            expect(row).toContain(`${(line.y * 100).toFixed(1)}%`);
            expect(row).toContain(String(Math.round(line.y * 1080)));
        }
    });

    test('the headline horizon and foot figures match', () => {
        const land = Geometry.guide(Geometry.PROFILES.landscape, AVATAR);
        const port = Geometry.guide(Geometry.PROFILES.portrait, AVATAR);
        expect(doc).toContain(`${(land.horizonY * 100).toFixed(1)}%`);
        expect(doc).toContain(`${(port.horizonY * 100).toFixed(1)}%`);
        expect(doc).toContain(`${(land.footAnchor.y * 100).toFixed(1)}%`);
        const landPx = Geometry.toPixels(land, 1920, 1080);
        expect(doc).toContain(String(landPx.horizonY));
        expect(doc).toContain(`(960, 969)`);
    });

    test('it quotes the tilt, and does not claim the camera is level', () => {
        const view = Geometry.frameFor(Geometry.PROFILES.landscape, AVATAR);
        expect(doc).toContain(`${view.pitchDeg.toFixed(2)}°`);
    });

    test('it names both masters and both FOVs', () => {
        expect(doc).toContain('1920 × 1080');
        expect(doc).toContain('1080 × 1920');
        expect(doc).toContain('30°');
        expect(doc).toContain('42°');
    });
});
