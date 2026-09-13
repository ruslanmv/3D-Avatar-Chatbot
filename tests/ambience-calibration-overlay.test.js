/**
 * The calibration overlay (batch A13).
 *
 * A development-only guide, so the assertions that matter most are about what it does when
 * nobody asked for it: no node, no listener, nothing in the scene, nothing that could survive
 * into a clip recording or a headset. A tool that can contaminate the render path is a
 * liability regardless of how useful it is when switched on.
 *
 * After that: it must read the **live** camera rather than a nominal profile. Reporting 30°
 * while the app renders 35° would certify a backplate against a projection nobody is using,
 * which is precisely the class of error this whole batch exists to remove.
 */

const fs = require('fs');
const path = require('path');

const Overlay = require('../src/gltf-viewer/ambience/CalibrationOverlay.js');
const Geometry = require('../src/gltf-viewer/ambience/CalibrationGeometry.js');

const src = fs.readFileSync(path.resolve(__dirname, '../src/gltf-viewer/ambience/CalibrationOverlay.js'), 'utf-8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf-8');

function fakeViewer(overrides) {
    const o = overrides || {};
    return {
        camera: {
            position: { x: 0, y: 0.985, z: 4.02 },
            fov: o.fov || 30,
            aspect: o.aspect || 16 / 9,
        },
        controls: { target: { x: 0, y: 0.864, z: 0 } },
    };
}

beforeEach(() => {
    document.body.innerHTML = '';
    global.NEXUS_AMBIENCE_CALIBRATION_GEOMETRY = Geometry;
});

afterEach(() => {
    Overlay.remove();
    delete global.NEXUS_AMBIENCE_CALIBRATION_GEOMETRY;
    delete global.THREE;
});

describe('off unless the URL asks — it is a development tool', () => {
    test('no query parameter, no overlay', () => {
        expect(Overlay.requested('')).toBe(false);
        expect(Overlay.requested('?foo=1')).toBe(false);
        expect(Overlay.init({ search: '', viewer: fakeViewer() })).toBe(false);
        expect(Overlay.isActive()).toBe(false);
    });

    test('the flag is exact, not a substring match', () => {
        expect(Overlay.requested('?backgroundCalibration=1')).toBe(true);
        expect(Overlay.requested('?x=1&backgroundCalibration=1')).toBe(true);
        expect(Overlay.requested('?backgroundCalibration=0')).toBe(false);
        expect(Overlay.requested('?backgroundCalibration=12')).toBe(false);
        expect(Overlay.requested('?mybackgroundCalibration=1')).toBe(false);
    });

    test('init with the flag draws, and is reported', () => {
        expect(Overlay.init({ search: '?backgroundCalibration=1', viewer: fakeViewer() })).toBe(true);
        expect(Overlay.isActive()).toBe(true);
    });

    test('it never persists the flag', () => {
        // A development overlay that could survive a reload is one somebody ships by accident.
        expect(code).not.toMatch(/localStorage|sessionStorage/);
    });

    test('it adds nothing to the 3D scene', () => {
        // No geometry, no material, no light — nothing to dispose, and nothing that could reach
        // a clip recording or a headset.
        expect(code).not.toMatch(/scene\.add|scene\.background|new THREE\.(Mesh|Grid|Plane|Line)/);
    });

    test('it does not touch the renderer or the camera', () => {
        expect(code).not.toMatch(/renderer\.|camera\.fov\s*=|updateProjectionMatrix/);
    });
});

describe('it reads the live camera, not a nominal profile', () => {
    test('liveView reflects the camera it is given', () => {
        const view = Overlay.liveView(fakeViewer({ fov: 35, aspect: 2 }));
        expect(view.fovDeg).toBe(35);
        expect(view.aspect).toBe(2);
        expect(view.target[1]).toBeCloseTo(0.864, 6);
    });

    test('a 35° camera is reported as 35°, not as the profile 30°', () => {
        // The failure this prevents: certifying a backplate against a projection nobody renders.
        const report = Overlay.render({ viewer: fakeViewer({ fov: 35 }), avatar: { height: 1.6, footY: 0 } });
        expect(report.fovDeg).toBe(35);
    });

    test('and the horizon moves when the FOV does', () => {
        const at30 = Overlay.render({ viewer: fakeViewer({ fov: 30 }), avatar: { height: 1.6, footY: 0 } });
        const at35 = Overlay.render({ viewer: fakeViewer({ fov: 35 }), avatar: { height: 1.6, footY: 0 } });
        expect(at30.horizonY).not.toBeCloseTo(at35.horizonY, 4);
    });

    test('no viewer is a warning, not a crash', () => {
        expect(Overlay.render({ viewer: null })).toBeNull();
    });
});

describe('the profile is chosen by viewport geometry, not by user-agent', () => {
    test('a wide viewport is landscape', () => {
        expect(Overlay.profileFor(16 / 9).id).toBe('landscape');
    });

    test('a tall viewport is portrait', () => {
        expect(Overlay.profileFor(9 / 16).id).toBe('portrait');
    });

    test('a narrow desktop window gets the portrait composition', () => {
        // Which is the point of deciding on geometry: a tall browser window has the same
        // compositional problem as a phone, whatever the user-agent says.
        expect(Overlay.profileFor(0.8).id).toBe('portrait');
    });

    test('exactly square counts as landscape, deterministically', () => {
        expect(Overlay.profileFor(1).id).toBe('landscape');
    });
});

describe('what it draws', () => {
    const guide = Geometry.guide(Geometry.PROFILES.landscape, { height: 1.6, width: 0.55, footY: 0 });

    test('a horizon line, labelled with its percentage', () => {
        const svg = Overlay.buildSvg(guide, document);
        expect(svg.textContent).toMatch(/HORIZON\s+44\.4%/);
    });

    test('a foot anchor at the computed point', () => {
        const svg = Overlay.buildSvg(guide, document);
        const dot = svg.querySelector('circle');
        expect(parseFloat(dot.getAttribute('cy'))).toBeCloseTo(guide.footAnchor.y * 100, 3);
        expect(svg.textContent).toMatch(/FEET\s+50\.0%/);
    });

    test('a safe zone rectangle spanning the keep-clear band', () => {
        const svg = Overlay.buildSvg(guide, document);
        const rect = svg.querySelector('rect');
        // Derived from the avatar's projected silhouette rather than a constant, so this checks
        // the rectangle matches the guide it was drawn from rather than a remembered number.
        expect(parseFloat(rect.getAttribute('x'))).toBeCloseTo(guide.safeZone.x0 * 100, 3);
        expect(parseFloat(rect.getAttribute('width'))).toBeCloseTo((guide.safeZone.x1 - guide.safeZone.x0) * 100, 3);
    });

    test('one labelled line per ground depth', () => {
        const svg = Overlay.buildSvg(guide, document);
        expect(svg.textContent).toContain('0.5 m');
        expect(svg.textContent).toContain('16 m');
    });

    test('redrawing replaces rather than stacks', () => {
        const viewer = fakeViewer();
        Overlay.render({ viewer });
        Overlay.render({ viewer });
        expect(document.querySelectorAll(`#${Overlay.ID}`)).toHaveLength(1);
    });

    test('the overlay cannot be clicked through to', () => {
        Overlay.render({ viewer: fakeViewer() });
        expect(document.getElementById(Overlay.ID).style.pointerEvents).toBe('none');
    });
});

describe('the report — what actually goes into a generator prompt', () => {
    test('it carries the numbers in fractions and in pixels', () => {
        const report = Overlay.render({ viewer: fakeViewer(), avatar: { height: 1.6, width: 0.55, footY: 0 } });
        expect(report.profile).toBe('landscape');
        expect(report.horizonY).toBeCloseTo(0.444, 3);
        expect(report.pixels.width).toBe(1920);
        expect(report.pixels.height).toBe(1080);
        expect(report.pixels.horizonY).toBe(480);
        expect(report.pixels.footAnchor).toEqual({ x: 960, y: 969 });
    });

    test('portrait reports against the 1080×1920 master', () => {
        const report = Overlay.render({
            viewer: fakeViewer({ aspect: 9 / 16, fov: 42 }),
            avatar: { height: 1.6, width: 0.55, footY: 0 },
        });
        expect(report.profile).toBe('portrait');
        expect(report.pixels.width).toBe(1080);
        expect(report.pixels.height).toBe(1920);
    });

    test('it says whether the avatar was measured or assumed', () => {
        // A guide built on a 1.6 m stand-in is still useful for the horizon and the floor, but
        // the foot anchor is only trustworthy when a real VRM was measured. Say which.
        const assumed = Overlay.render({ viewer: fakeViewer() });
        expect(assumed.avatarMeasured).toBe(false);
        const measured = Overlay.render({
            viewer: fakeViewer(),
            avatar: { height: 1.72, width: 0.6, footY: 0, measured: true },
        });
        expect(measured.avatarMeasured).toBe(true);
    });
});

describe('crossCheck against the renderer', () => {
    test('with THREE present it compares both projections', () => {
        // A stub that reproduces THREE's own project() for the trivial case: the look-at point
        // is the centre of the frame, so NDC (0, 0).
        global.THREE = {
            Vector3: function (x, y, z) {
                this.x = x;
                this.y = y;
                this.z = z;
                this.project = function () {
                    this.x = 0;
                    this.y = 0;
                    return this;
                };
            },
        };
        const viewer = fakeViewer();
        const check = Overlay.verify(Overlay.liveView(viewer), viewer);
        expect(check).not.toBeNull();
        expect(check.agrees).toBe(true);
    });

    test('a disagreeing renderer is reported rather than ignored', () => {
        global.THREE = {
            Vector3: function () {
                this.project = function () {
                    this.x = 0.5;
                    this.y = 0.5;
                    return this;
                };
            },
        };
        const viewer = fakeViewer();
        expect(Overlay.verify(Overlay.liveView(viewer), viewer).agrees).toBe(false);
    });

    test('without THREE it declines rather than claiming agreement', () => {
        const viewer = fakeViewer();
        expect(Overlay.verify(Overlay.liveView(viewer), viewer)).toBeNull();
    });
});

describe('house shape and wiring', () => {
    test('zero imports and zero exports', () => {
        expect(code).not.toMatch(/^\s*import\s/m);
        expect(code).not.toMatch(/^\s*export\s/m);
    });

    test('index.html loads geometry before the overlay that reads it', () => {
        const g = html.indexOf('ambience/CalibrationGeometry.js');
        const o = html.indexOf('ambience/CalibrationOverlay.js');
        expect(g).toBeGreaterThan(-1);
        expect(g).toBeLessThan(o);
    });

    test('they load as plain scripts, like the rest of the ambience renderer half', () => {
        expect(html).toContain('<script src="src/gltf-viewer/ambience/CalibrationGeometry.js"></script>');
        expect(html).not.toContain('type="module" src="src/gltf-viewer/ambience/CalibrationOverlay.js"');
    });

    test('it fails soft', () => {
        expect(code).toContain('console.warn');
        expect(code).not.toMatch(/\bthrow new\b/);
    });
});
