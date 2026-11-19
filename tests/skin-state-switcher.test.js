/**
 * UN32. SkinStateSwitcher: a state is drawn from her skin as loaded, the pack's tiles on top, and
 * detach writes her textures back exactly. No WebGL, no 2D canvas in jsdom: both are injected.
 */
const Skin = require('../src/wardrobe/SkinStateSwitcher.js');

const MANIFEST = {
    schema: 'wardrobe.skinPack.v1',
    material: 'Body',
    size: [512, 512],
    tile: 256,
    columns: 2,
    tiles: [
        [256, 0],
        [0, 256],
    ],
    maps: ['base', 'normal'],
    states: {
        closed: {
            label: 'Closed',
            body: 'your body is relaxed',
            files: { base: 'skin-pack/closed/base.png', normal: 'skin-pack/closed/normal.png' },
        },
        open: {
            label: 'Open',
            body: 'you are open',
            files: { base: 'skin-pack/open/base.png', normal: 'skin-pack/open/normal.png' },
        },
    },
};
const LOOK = { vrmUrl: 'https://forge/v1/assets/looks/look_1/look.vrm', wardrobeState: 'bare' };

function world() {
    const base = { image: { width: 512, height: 512, id: 'base-original' }, needsUpdate: false };
    const normal = { image: { width: 512, height: 512, id: 'normal-original' }, needsUpdate: false };
    const material = { name: 'Body', map: base, normalMap: normal };
    const root = { traverse: (fn) => [{ material }, { material: { name: 'Hair', map: {} } }].forEach(fn) };
    const fetched = [];
    const fetch = async (url) => {
        fetched.push(url);
        if (url.endsWith('manifest.json')) return { ok: true, json: async () => MANIFEST };
        return { ok: true, blob: async () => ({ url }) };
    };
    const draws = [];
    const createCanvas = (w, h) => ({
        width: w,
        height: h,
        getContext: () => ({
            drawImage: (img, ...args) => draws.push([img.id || img.url, ...args]),
            clearRect: () => {},
        }),
    });
    const switcher = Skin.create({
        fetch,
        loadImage: async (blob) => blob,
        createCanvas,
        headersFor: async () => ({ 'X-Wardrobe-Grant': 'g' }),
    });
    return { switcher, root, base, normal, fetched, draws };
}

describe('UN32 SkinStateSwitcher', () => {
    test('the pack sits beside the look, and only bare looks are asked for one', () => {
        expect(Skin.manifestUrlFor(LOOK.vrmUrl)).toBe('https://forge/v1/assets/looks/look_1/skin-pack/manifest.json');
        expect(Skin.manifestUrlFor('blob:abc')).toBeNull();
        expect(Skin.mayHavePack(LOOK)).toBe(true);
        expect(Skin.mayHavePack({ wardrobeState: 'over-bare' })).toBe(true);
        expect(Skin.mayHavePack({ templateId: 'top-tee-v1' })).toBe(false);
    });

    test('attach lists the states; a dressed look is not even asked', async () => {
        const w = world();
        expect(await w.switcher.attach(w.root, { vrmUrl: LOOK.vrmUrl, templateId: 'top-tee-v1' })).toEqual([]);
        expect(w.fetched).toEqual([]);
        const states = await w.switcher.attach(w.root, LOOK);
        expect(states.map((s) => s.name)).toEqual(['closed', 'open']);
        expect(states[1].body).toBe('you are open');
    });

    test('apply draws her skin as loaded, then every tile from the state atlas', async () => {
        const w = world();
        await w.switcher.attach(w.root, LOOK);
        expect(await w.switcher.apply('open')).toBe(true);
        expect(w.switcher.current()).toBe('open');
        expect(w.base.needsUpdate).toBe(true);
        expect(w.base.image.id).toBeUndefined(); // now the canvas
        const baseDraws = w.draws.filter((d) => d[0] === 'base-original' || String(d[0]).includes('open/base'));
        expect(baseDraws[0]).toEqual(['base-original', 0, 0]);
        // Tile 0 at (256,0) comes from atlas (0,0); tile 1 at (0,256) from atlas (256,0).
        expect(baseDraws[1]).toEqual([
            'https://forge/v1/assets/looks/look_1/skin-pack/open/base.png',
            0,
            0,
            256,
            256,
            256,
            0,
            256,
            256,
        ]);
        expect(baseDraws[2].slice(1)).toEqual([256, 0, 256, 256, 0, 256, 256, 256]);
        expect(await w.switcher.apply('nope')).toBe(false);
    });

    test('detach writes her textures back exactly', async () => {
        const w = world();
        await w.switcher.attach(w.root, LOOK);
        await w.switcher.apply('open');
        expect(w.switcher.detach()).toBe(true);
        expect(w.base.image.id).toBe('base-original');
        expect(w.normal.image.id).toBe('normal-original');
        expect(w.switcher.states()).toEqual([]);
    });

    test('a pack of another schema, or for no material she has, is ignored', async () => {
        const w = world();
        const states = await w.switcher.attach(w.root, LOOK, 'https://forge/x/skin-pack/manifest.json');
        expect(states.length).toBe(2);
        const other = Skin.create({
            fetch: async () => ({ ok: true, json: async () => ({ ...MANIFEST, material: 'Nope' }) }),
            createCanvas: () => null,
        });
        expect(await other.attach(w.root, LOOK)).toEqual([]);
    });
});
