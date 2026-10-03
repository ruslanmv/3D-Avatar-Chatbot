/**
 * W15. The outfit dictionary: Forge's catalogue when Forge answers, the shipped snapshot when it
 * cannot, and private sets hidden — not merely labelled — unless private outfits are open.
 */
const { OutfitDictionary, normalize, normalizeBodyArt } = require('../../src/wardrobe/OutfitDictionary.js');
const SNAPSHOT = require('../../assets/wardrobe/outfits.json');

const reply = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

describe('OutfitDictionary', () => {
    test('the shipped snapshot is a sound catalogue: every entry survives the page normalizer', () => {
        const checked = normalize(SNAPSHOT);
        expect(checked.outfits).toHaveLength(SNAPSHOT.outfits.length);
        expect(SNAPSHOT.license).toMatch(/MIT/);
        // Private groups hold only private entries; general groups only general ones.
        const groupPrivate = Object.fromEntries(SNAPSHOT.groups.map((g) => [g.id, g.private]));
        SNAPSHOT.outfits.forEach((entry) => {
            expect(entry.rating === 'private').toBe(groupPrivate[entry.group]);
        });
    });

    test('Forge first; its catalogue is used when it answers', async () => {
        const library = {
            available: true,
            outfits: jest.fn(() => Promise.resolve(SNAPSHOT)),
            bodyArt: jest.fn(() => Promise.resolve({ placements: [], designs: [] })),
        };
        const fetch = jest.fn();
        const dict = new OutfitDictionary({ library, fetch });
        await dict.load();
        expect(dict.catalogue.source).toBe('forge');
        expect(fetch).not.toHaveBeenCalled();
    });

    test('an older Forge without the route, or none at all, falls back to the snapshot', async () => {
        const missing = Object.assign(new Error('not found'), { status: 404 });
        const library = {
            available: true,
            outfits: () => Promise.reject(missing),
            bodyArt: () => Promise.reject(missing),
        };
        const fetch = jest.fn(() => reply(SNAPSHOT));
        const dict = new OutfitDictionary({ library, fetch });
        await dict.load();
        expect(dict.catalogue.source).toBe('snapshot');
        expect(fetch).toHaveBeenCalledWith('assets/wardrobe/outfits.json');
        const offline = new OutfitDictionary({ library: null, fetch: () => reply(SNAPSHOT) });
        expect((await offline.load()).source).toBe('snapshot');
    });

    test('private sets are hidden unless private outfits are open — by rating or by group claim', async () => {
        const dict = new OutfitDictionary({ fetch: () => reply(SNAPSHOT) });
        await dict.load();
        const closed = dict.entries({ privateOpen: false });
        expect(closed.some((e) => e.private)).toBe(false);
        expect(closed.length).toBeGreaterThan(0);
        expect(dict.find('lace-lingerie-set', { privateOpen: false })).toBeNull();
        expect(dict.find('lace-lingerie-set', { privateOpen: true })).not.toBeNull();
        expect(dict.groups({ privateOpen: false }).map((g) => g.id)).not.toContain('lingerie');

        // A Forge that called a lingerie entry general is still hidden by its group's claim.
        const lying = JSON.parse(JSON.stringify(SNAPSHOT));
        lying.outfits.find((e) => e.id === 'lace-lingerie-set').rating = 'general';
        expect(normalize(lying).outfits.find((e) => e.id === 'lace-lingerie-set').private).toBe(true);
    });

    test('find answers by id or title; tattoos only when private outfits are open', async () => {
        const art = {
            placements: [{ id: 'lower-back', name: 'Lower back' }],
            designs: [{ id: 'lotus-ornament-01', name: 'Lotus', placements: ['lower-back', 'nowhere'] }],
        };
        const library = {
            available: true,
            outfits: () => Promise.resolve(SNAPSHOT),
            bodyArt: () => Promise.resolve(art),
        };
        const dict = new OutfitDictionary({ library });
        await dict.load();
        await dict._loadBodyArt(library);
        expect(dict.find('Little black dress').id).toBe('little-black-dress');
        expect(dict.tattoos({ privateOpen: false })).toBeNull();
        expect(dict.tattoos({ privateOpen: true }).designs[0].placements).toEqual(['lower-back']);
        expect(normalizeBodyArt({ designs: [] })).toBeNull();
    });

    test('odd entries are dropped, not passed on to the prompt or a job', () => {
        const odd = {
            groups: [{ id: 'casual', title: 'Casual' }],
            outfits: [
                { id: 'ok', title: 'Fine', group: 'casual', request: { prompt: 'white tee' }, rating: 'general' },
                { id: 'Bad Id!', title: 'x', group: 'casual', request: { prompt: 'x' } },
                { id: 'long', title: 'x', group: 'casual', request: { prompt: 'a'.repeat(400) } },
                { id: 'nogroup', title: 'x', group: 'secret', request: { prompt: 'x' } },
            ],
        };
        const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(normalize(odd).outfits.map((e) => e.id)).toEqual(['ok']);
        spy.mockRestore();
    });
});
