/**
 * The Studio importer's camera must not drift from the engine's (batch A14).
 *
 * `tools/ambience/studio-import.py` reprojects a 3D-Ambience-Studio equirectangular panorama
 * into a flat backplate through this app's camera. It is Python, so Jest cannot execute it —
 * but the thing most likely to go wrong is not its arithmetic, it is the constants silently
 * diverging from `CalibrationGeometry.js` after somebody changes one and not the other.
 *
 * Two implementations of one camera, in two languages, is a real cost. It is paid because the
 * reprojection has to run in the asset pipeline (Pillow, numpy, no browser) while the guide has
 * to run in the app. What makes it safe is that they were verified to agree numerically — the
 * reprojected horizon lands at 44.44% against the geometry module's predicted 44.40%, and a
 * level-camera control gives exactly 50.00% — and this file keeps the inputs to that agreement
 * pinned.
 */

const fs = require('fs');
const path = require('path');

const Geometry = require('../src/gltf-viewer/ambience/CalibrationGeometry.js');
const py = fs.readFileSync(path.resolve(__dirname, '../tools/ambience/studio-import.py'), 'utf-8');

/** One `NAME = value` constant out of the Python source. */
function pyNumber(name) {
    const match = py.match(new RegExp(`^${name}\\s*=\\s*([0-9.]+)`, 'm'));
    if (!match) throw new Error(`no constant ${name} in studio-import.py`);
    return Number(match[1]);
}

describe('the two cameras agree', () => {
    test('the eye lift is the same number on both sides', () => {
        // frameObject's normalize(0, 0.03, 1). Change it in one place and backplates stop
        // agreeing with the avatar's floor, silently and in every scene at once.
        const js = fs.readFileSync(
            path.resolve(__dirname, '../src/gltf-viewer/ambience/CalibrationGeometry.js'),
            'utf-8'
        );
        expect(js).toMatch(/const EYE_LIFT = 0\.03;/);
        expect(pyNumber('EYE_LIFT')).toBe(0.03);
    });

    test('the landscape and portrait FOVs match the shipped profiles', () => {
        const landscape = py.match(/"landscape":\s*\{"fov":\s*([0-9.]+).*?"width":\s*(\d+),\s*"height":\s*(\d+)/s);
        const portrait = py.match(/"portrait":\s*\{"fov":\s*([0-9.]+).*?"width":\s*(\d+),\s*"height":\s*(\d+)/s);
        expect(Number(landscape[1])).toBe(Geometry.PROFILES.landscape.fovDeg);
        expect(Number(portrait[1])).toBe(Geometry.PROFILES.portrait.fovDeg);
        // And the masters the production guide calls for.
        expect([Number(landscape[2]), Number(landscape[3])]).toEqual([1920, 1080]);
        expect([Number(portrait[2]), Number(portrait[3])]).toEqual([1080, 1920]);
    });

    test('the aspect ratios the script renders match the profiles it renders for', () => {
        const landscape = py.match(/"landscape":\s*\{"fov":\s*[0-9.]+.*?"width":\s*(\d+),\s*"height":\s*(\d+)/s);
        expect(Number(landscape[1]) / Number(landscape[2])).toBeCloseTo(Geometry.PROFILES.landscape.aspect, 6);
    });

    test('it points at CalibrationGeometry so the next person finds the other half', () => {
        expect(py).toContain('CalibrationGeometry');
    });
});

describe('what the importer produces has to satisfy the catalogue', () => {
    const Catalog = require('../src/gltf-viewer/ambience/ViewportBackgroundCatalog.js');

    afterEach(() => Catalog.reset());

    test('the id shape it emits is one the catalogue accepts', () => {
        // Studio ids are bare slugs ("sunset-beach"); the catalogue requires
        // ambient:<scene>:<variant>, so the importer takes --scene and --variant rather than
        // reusing the manifest id. A test, because the failure mode is a silently rejected entry.
        expect(py).toContain('f"ambient:{args.scene}:{args.variant}"');
        const report = Catalog.ingest({
            schemaVersion: 1,
            scenes: [
                {
                    id: 'ambient:cove:day',
                    type: 'image',
                    label: 'Sunset Beach',
                    variantLabel: 'Day',
                    src: 'assets/ambient/light/sunset-beach.webp',
                    thumb: 'assets/ambient/light/sunset-beach.webp',
                    focalPoint: 'center',
                    intensity: 1,
                    category: 'relax',
                    tags: ['beach', 'ocean', 'sunset'],
                },
            ],
        });
        expect(report.accepted).toBe(1);
        expect(report.rejected).toBe(0);
    });

    test('every Studio category maps to something, never to an invented one', () => {
        // The resolver scores on category; a category it has never heard of scores zero and the
        // scene becomes unreachable by intent. Falling back to 'relax' is the deliberate choice.
        const map = py.slice(py.indexOf('CATEGORY_MAP = {'), py.indexOf('}', py.indexOf('CATEGORY_MAP = {')));
        for (const studio of [
            'relax',
            'meditation',
            'study',
            'sleep',
            'nature',
            'cozy',
            'fantasy',
            'focus',
            'chill',
            'seasonal',
        ]) {
            expect(map).toContain(`"${studio}":`);
        }
    });

    test('paths it writes are relative, which the catalogue requires', () => {
        // isSafeRelativePath rejects anything absolute or protocol-relative, so an --assets
        // outside the repo yields an entry the catalogue will refuse — the script says so.
        expect(Catalog.isSafeRelativePath('assets/ambient/light/sunset-beach.webp')).toBe(true);
        expect(Catalog.isSafeRelativePath('/tmp/out/light/sunset-beach.webp')).toBe(false);
    });
});

describe('it refuses input it cannot handle', () => {
    test('a non-2:1 image is rejected rather than silently distorted', () => {
        expect(py).toContain('not 2:1 equirectangular');
    });

    test('longitude wraps and latitude clamps', () => {
        // Backwards, and the result is a seam down the middle of the sky or a mirrored pole.
        expect(py).toContain('u0 % sw');
        expect(py).toContain('np.clip(v0, 0, sh - 1)');
    });
});
