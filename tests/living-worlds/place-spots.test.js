/**
 * LW6. Every place's measured spots: the files are what the tool wrote for the scene that ships,
 * nothing offered is unverified, and the person's words reach the new kinds of spot.
 *
 * The failure this holds: a spots file that no longer belongs to its scene (the model changed, the
 * recipe was re-cut) still parses, still lists positions, and stands her inside whatever is there
 * now. So each file is re-hashed against its GLB here, as LW2's own test does for the first four.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Spots = require('../../src/gltf-viewer/WorldSpots.js');

const ROOT = path.join(__dirname, '../..');
const WORLDS = path.join(ROOT, 'assets/vr-worlds');
const targets = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/vr/spot-targets.json'), 'utf8')).scenes;
const catalogue = JSON.parse(fs.readFileSync(path.join(WORLDS, 'worlds.json'), 'utf8')).worlds;
const files = fs
    .readdirSync(path.join(WORLDS, 'spots'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(WORLDS, 'spots', f), 'utf8')));
const byScene = new Map(files.map((f) => [f.scene, f]));

describe('every spots file belongs to the scene that ships', () => {
    test.each(files.map((f) => [f.scene, f]))('%s', (scene, file) => {
        const bytes = fs.readFileSync(path.join(WORLDS, scene));
        expect(file.sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
        expect(file.tool.name).toBe('tools/vr/measure-spots.mjs');
        expect(targets[scene]).toBeTruthy();
        // A stood-in floor is said in the file, and only for a scene whose entry asks for one.
        expect(Boolean(file.virtualFloor)).toBe(typeof targets[scene].floor === 'number');
    });

    test('every scene with targets was measured', () => {
        expect(Object.keys(targets).filter((s) => !byScene.has(s))).toEqual([]);
    });
});

describe('what is offered was measured', () => {
    test.each(files.map((f) => [f.scene, f]))('%s', (scene, file) => {
        const offered = Spots.normalize(file);
        expect(offered).not.toBeNull();
        const verified = file.spots.filter((s) => s.verified === true).map((s) => s.id);
        expect(offered.spots.map((s) => s.id).sort()).toEqual(verified.sort());
        for (const s of file.spots.filter((x) => x.verified === true)) {
            // On the floor the tool found, facing somewhere, with room in front of her.
            expect(Math.abs(s.position[1] - file.floorY)).toBeLessThanOrEqual(file.tool.params.floorTolerance + 0.001);
            expect(Number.isFinite(s.facingDeg)).toBe(true);
            expect(s.measured.viewOpenM).toBeGreaterThanOrEqual(file.tool.params.viewClear);
        }
        for (const s of file.spots.filter((x) => x.verified !== true)) expect(typeof s.why).toBe('string');
    });
});

describe('places a person can move within', () => {
    const shown = catalogue.filter((w) => w.place && w.scene && w.rating !== 'private');
    const movable = shown.filter((w) => {
        const f = byScene.get(w.scene.src);
        return f && f.spots.filter((s) => s.verified === true).length >= 2;
    });

    test('most places with a scene have at least two verified spots', () => {
        // The property, not a list: adding a place without measuring it should be felt here.
        expect(movable.length).toBeGreaterThanOrEqual(Math.ceil(shown.length * 0.6));
    });

    test('a phone gets spots of its own model, never the desktop one', () => {
        for (const light of catalogue.filter((w) => w.lightFor && w.scene)) {
            const heavy = catalogue.find((w) => w.id === light.lightFor);
            if (!heavy || !heavy.scene || heavy.scene.src === light.scene.src) continue;
            const a = byScene.get(light.scene.src);
            const b = byScene.get(heavy.scene.src);
            if (a && b) expect(a.sha256).not.toBe(b.sha256);
        }
    });
});

describe('the new kinds of spot are reached by words', () => {
    const spotsOf = (scene) => Spots.normalize(byScene.get(scene)).spots;
    const cases = [
        ['scenes/hotel-lobby.glb', "let's go to the fireplace", 'fireplace'],
        ['scenes/hotel-lobby.glb', 'andiamo alla reception', 'reception'],
        ['scenes/restaurant-dining-room.glb', 'andiamo al bancone', 'bar'],
        ['scenes/restaurant-dining-room.glb', "let's sit at the table", 'dining-table'],
        ['scenes/pub-bar-room.glb', 'take me to the bar', 'bar'],
        ['scenes/guild-tavern.glb', 'andiamo vicino al camino', 'fireplace'],
        ['scenes/dungeon-rooms.glb', 'go to the treasure chest', 'chest'],
        ['scenes/jungle-ruins.glb', "let's go to the arch", 'arch'],
        ['scenes/soccer-ground.glb', 'andiamo in tribuna', 'stand'],
        ['scenes/cinema-auditorium.glb', 'andiamo davanti allo schermo', 'screen'],
    ].filter(([scene, , id]) => byScene.has(scene) && spotsOf(scene).some((s) => s.id === id));

    test('there is something to check', () => {
        expect(cases.length).toBeGreaterThanOrEqual(6);
    });

    test.each(cases)('%s: "%s" → %s', (scene, text, id) => {
        expect(Spots.intentOf(text, spotsOf(scene))).toEqual({ spot: id });
    });

    test('a remark about a spot moves nobody', () => {
        const lobby = byScene.has('scenes/hotel-lobby.glb') ? spotsOf('scenes/hotel-lobby.glb') : [];
        expect(Spots.intentOf('the fireplace is lovely', lobby)).toBeNull();
        expect(Spots.intentOf('che bel bancone', lobby)).toBeNull();
    });
});
