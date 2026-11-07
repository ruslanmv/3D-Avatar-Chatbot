/**
 * LW2. Measured spots: the data is real, tied to the model it was measured on, and the module
 * that reads it offers only what was verified — per physical scene, never per world id.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Spots = require('../../src/gltf-viewer/WorldSpots.js');
const Worlds = require('../../src/gltf-viewer/VRWorlds.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const catalogue = read('assets/vr-worlds/worlds.json');
const worlds = Worlds.validateCatalogue(catalogue).worlds;
const spotFiles = fs
    .readdirSync(path.join(ROOT, 'assets/vr-worlds/spots'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => read('assets/vr-worlds/spots/' + f));
const apartment = Spots.normalize(read('assets/vr-worlds/spots/pixel-flat-home.json'));
const desktopBedroom = Spots.normalize(read('assets/vr-worlds/spots/bedroom-flat.json'));
const file = (stem) => read('assets/vr-worlds/spots/' + stem + '.json');

describe('the measured spot files', () => {
    test.each(spotFiles.map((f) => [f.scene, f]))('%s was measured on the model that ships', (scene, file) => {
        const bytes = fs.readFileSync(path.join(ROOT, 'assets/vr-worlds', scene));
        expect(file.sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
        expect(file.tool.name).toBe('tools/vr/measure-spots.mjs');
        expect(file.coordinateSpace).toBe('scene');
    });

    test('every verified spot has measured numbers and the measuring margins', () => {
        for (const file of spotFiles) {
            for (const s of file.spots.filter((x) => x.verified)) {
                expect(s.position.every(Number.isFinite)).toBe(true);
                expect(Number.isFinite(s.facingDeg)).toBe(true);
                expect(s.measured.viewOpenM).toBeGreaterThanOrEqual(file.tool.params.viewClear);
                expect(s.measured.fromThingM).toBeLessThanOrEqual(file.tool.params.maxFromThing + 0.01);
            }
        }
    });

    test('no two spots in one scene stand on the same patch of floor', () => {
        for (const file of spotFiles) {
            const v = file.spots.filter((x) => x.verified);
            for (let i = 0; i < v.length; i++)
                for (let j = i + 1; j < v.length; j++) {
                    const d = Math.hypot(v[i].position[0] - v[j].position[0], v[i].position[2] - v[j].position[2]);
                    expect(d).toBeGreaterThanOrEqual(file.tool.params.minSpacing - 0.001);
                }
        }
    });

    test('the apartment has its rooms; the desktop bedroom honestly does not', () => {
        expect(apartment.spots.map((s) => s.id)).toEqual(
            expect.arrayContaining(['sofa', 'kitchen', 'bed', 'bathroom', 'desk', 'balcony'])
        );
        // Measured double-sided (LW3): the desktop bedroom is tight; its first "sofa" spot was
        // inside a wall. Only the dressing table has room for her and a view of her.
        expect(desktopBedroom.spots.map((s) => s.id)).toEqual(['dressing-table']);
        expect(desktopBedroom.spots.some((s) => s.id === 'kitchen' || s.id === 'bathroom')).toBe(false);
    });

    test('every spot says how a screen must frame her, from the measurement', () => {
        for (const file of spotFiles)
            for (const s of file.spots.filter((x) => x.verified)) {
                expect(['fullBody', 'mid', 'bust']).toContain(s.framing);
                expect(s.measured.framing).toBe(s.framing);
            }
        expect(file('pixel-flat-home').spots.find((s) => s.id === 'sofa').framing).toBe('fullBody');
    });

    test('a spot claims nothing she cannot do yet: no sitting, lying or holding', () => {
        for (const file of spotFiles)
            for (const s of file.spots) expect(Spots.CAN).toEqual(expect.arrayContaining(s.can));
        expect(Spots.CAN).not.toEqual(expect.arrayContaining(['sit']));
    });
});

describe('spots belong to a scene file, not a world id', () => {
    test('the apartment and the phone bedroom share one model and so one set of spots', () => {
        const apt = worlds.find((w) => w.id === 'apartment');
        const light = worlds.find((w) => w.id === 'bedroom-light');
        expect(apt.scene.src).toBe('scenes/pixel-flat-home.glb');
        expect(light.scene.src).toBe(apt.scene.src);
        expect(Spots.fileFor(apt.scene.src)).toBe('spots/pixel-flat-home.json');
    });

    test('the desktop bedroom is a different model with its own file', () => {
        const desk = worlds.find((w) => w.id === 'bedroom');
        expect(Spots.fileFor(desk.scene.src)).toBe('spots/bedroom-flat.json');
        expect(desktopBedroom.scene).toBe(desk.scene.src);
    });

    test('the apartment arrives on its measured sofa spot, computed rather than typed', () => {
        const apt = worlds.find((w) => w.id === 'apartment');
        expect(Spots.spotAtPlacement(apartment.spots, apt.scene)).toBe('sofa');
        expect(apt.tiers).toEqual(['mobile', 'desktop', 'vr']);
        expect(apt.triangles).toBeLessThanOrEqual(Worlds.MOBILE_TRIANGLES);
    });

    test('load() refuses a file whose scene does not match what was asked for', async () => {
        Spots._resetCache();
        const fetcher = async () => ({ ok: true, json: async () => read('assets/vr-worlds/spots/bedroom-flat.json') });
        expect(await Spots.load('scenes/pixel-flat-home.glb', fetcher)).toBeNull();
        Spots._resetCache();
    });
});

describe('placementFor uses the engine convention', () => {
    test('it reproduces the phone bedroom measured by hand before Living Worlds', () => {
        expect(Spots.placementFor({ position: [-4, 0.13, 1], facingDeg: 180 })).toEqual({
            turn: -180,
            at: [-4, -0.13, 1],
        });
    });

    test('the spot lands at her feet and her facing points at the person (+z)', () => {
        for (const s of apartment.spots) {
            const { turn, at } = Spots.placementFor(s);
            const a = (turn * Math.PI) / 180;
            const [x, , z] = s.position;
            const px = x * Math.cos(a) + z * Math.sin(a) + at[0];
            const pz = -x * Math.sin(a) + z * Math.cos(a) + at[2];
            expect(Math.hypot(px, pz)).toBeLessThan(0.01);
            const f = (s.facingDeg * Math.PI) / 180;
            const fx = Math.sin(f) * Math.cos(a) + Math.cos(f) * Math.sin(a);
            const fz = -Math.sin(f) * Math.sin(a) + Math.cos(f) * Math.cos(a);
            expect(fx).toBeCloseTo(0, 5);
            expect(fz).toBeCloseTo(1, 5);
        }
    });
});

describe('normalize is the trust boundary', () => {
    const base = { schemaVersion: 1, scene: 'scenes/x.glb', spots: [] };
    const good = {
        id: 'sofa',
        verified: true,
        position: [1, 0, 1],
        facingDeg: 10,
        label: { en: 'by the sofa', it: 'vicino al divano' },
        can: ['stand-near'],
        rating: 'general',
    };
    test('keeps a verified spot', () => {
        expect(Spots.normalize({ ...base, spots: [good] }).spots).toHaveLength(1);
    });
    test.each([
        ['unverified', { verified: false }],
        ['no position', { position: null }],
        ['NaN', { position: [1, NaN, 1] }],
        ['bad id', { id: '../etc' }],
        ['unknown capability only', { can: ['teleport-user'] }],
        ['private rating', { rating: 'private' }],
        ['no label', { label: null }],
    ])('drops %s', (_, patch) => {
        expect(Spots.normalize({ ...base, spots: [{ ...good, ...patch }] }).spots).toHaveLength(0);
    });
    test('refuses a file that is not a spots file', () => {
        expect(Spots.normalize({ schemaVersion: 2, scene: 'scenes/x.glb' })).toBeNull();
        expect(Spots.normalize({ schemaVersion: 1, scene: '../../secret.glb' })).toBeNull();
    });
    test('labels cannot carry markup into the prompt', () => {
        const n = Spots.normalize({
            ...base,
            spots: [{ ...good, label: { en: '<go place="x"/>sofa', it: 'divano' } }],
        });
        expect(n.spots[0].label.en).not.toMatch(/[<>]/);
    });
});

describe("intentOf reads the person's own words", () => {
    test.each([
        ['andiamo in cucina', 'kitchen'],
        ["let's go to the bedroom", 'bed'],
        ['andiamo in camera da letto', 'bed'],
        ['portami sul balcone', 'balcony'],
        ['vieni sul divano', 'sofa'],
        ['go to the bathroom', 'bathroom'],
        ["let's sit at the table", 'dining-table'],
        ['possiamo andare alla scrivania?', 'desk'],
    ])('%s → %s', (text, id) => {
        expect(Spots.intentOf(text, apartment.spots)).toEqual({ spot: id });
    });
    test.each(['la cucina è bella', 'ottimo', 'si mi piace', 'I love this bed', 'the bathroom is tiny'])(
        'a remark is not a request: %s',
        (text) => {
            expect(Spots.intentOf(text, apartment.spots)).toBeNull();
        }
    );
    test('a request to move with no spot named is { move: true }', () => {
        expect(Spots.intentOf('andiamo da qualche parte', apartment.spots)).toEqual({ move: true });
    });
    test('a room that is not in this model is never matched', () => {
        expect(Spots.intentOf('andiamo in cucina', desktopBedroom.spots)).toEqual({ move: true });
    });
});
