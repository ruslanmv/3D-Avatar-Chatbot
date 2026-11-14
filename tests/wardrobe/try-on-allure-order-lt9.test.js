/**
 * LT9. The rail opens on complete sexy outfits, lingerie follows, long clothes close it.
 *
 * Ordering only: every look that went in comes out, none is hidden.
 */
const { allureOrder, allureOf, loadLooks } = require('../../src/wardrobe/TryOnHaulActivity.js');

const names = (looks) => looks.map((look) => look.name);
const bands = (looks) => looks.map((look) => allureOf(look).band);

describe('try-on haul order', () => {
    const wardrobe = [
        { name: 'Crop top & jeans', id: 'crop-top-jeans' },
        { name: 'Yellow Maxi Sundress', prompt: 'yellow maxi sundress' },
        { name: 'Black Evening', prompt: 'black satin evening column gown' },
        { name: 'Black Garter Set', prompt: 'black Garter Set' },
        {
            name: 'Black Lace Tailored Triangle Bralette + Black Lace Tailored Briefs',
            prompt: 'black lace lingerie set',
        },
        { name: 'Black Micro Tailored Thong', prompt: 'black Tailored Thong' },
        { name: 'Black Cocktail Dress', prompt: 'black satin cocktail dress' },
        {
            name: 'Black Cropped Corset Top + Black Pleated Mini Skirt + Black Stiletto Ankle Boots',
            prompt: 'black cropped corset top + black low-rise pleated mini skirt',
        },
        { name: 'Ivory Bodysuit', prompt: 'ivory Bodysuit' },
        { name: 'Red Tailored Bikini Top + Red Tailored Bikini Bottoms', prompt: 'red triangle bikini' },
        { name: 'Wine Garter Set', prompt: 'wine Garter Set' },
        { name: 'Black Catsuit', prompt: 'black Catsuit' },
        { name: 'Black Tailored Boyshorts', prompt: 'black Tailored Boyshorts' },
    ];

    test('complete sexy outfits first, lingerie in the middle, long clothes last', () => {
        const order = bands(allureOrder(wardrobe));
        const firstLingerie = order.indexOf('lingerie');
        const firstLong = order.indexOf('long');
        expect(order.slice(0, firstLingerie).every((band) => band === 'complete')).toBe(true);
        expect(firstLingerie).toBeGreaterThanOrEqual(3);
        expect(order.slice(firstLingerie, firstLong).every((band) => band === 'lingerie')).toBe(true);
        expect(order.slice(firstLong).every((band) => band === 'long')).toBe(true);
    });

    test('the first three are whole outfits, never a long dress, jeans or a lone piece of lingerie', () => {
        const top = allureOrder(wardrobe).slice(0, 3);
        expect(bands(top)).toEqual(['complete', 'complete', 'complete']);
        expect(names(top)).toEqual(
            expect.arrayContaining([
                'Black Cropped Corset Top + Black Pleated Mini Skirt + Black Stiletto Ankle Boots',
                'Black Catsuit',
            ])
        );
        expect(names(top).join(' ')).not.toMatch(/maxi|evening|jeans|gown/i);
    });

    test('in the lingerie band the sets come before single pieces, and boyshorts are not shorts', () => {
        const lingerie = allureOrder(wardrobe).filter((look) => allureOf(look).band === 'lingerie');
        expect(names(lingerie).slice(0, 2)).toEqual(
            expect.arrayContaining([
                'Black Garter Set',
                'Black Lace Tailored Triangle Bralette + Black Lace Tailored Briefs',
            ])
        );
        expect(allureOf({ name: 'Black Tailored Boyshorts' }).band).toBe('lingerie');
        expect(allureOf({ name: 'Black Skirted Swimsuit' }).band).toBe('long');
    });

    test('nothing is hidden, and equal looks keep their order', () => {
        const order = allureOrder(wardrobe);
        expect(order).toHaveLength(wardrobe.length);
        expect(new Set(order)).toEqual(new Set(wardrobe));
        const garters = names(order).filter((name) => /Garter/.test(name));
        expect(garters).toEqual(['Black Garter Set', 'Wine Garter Set']);
        expect(allureOrder([])).toEqual([]);
        expect(allureOrder([{ id: 'x' }])).toEqual([{ id: 'x' }]);
    });

    test('loadLooks hands the looks back in that order', async () => {
        const looks = await loadLooks({
            library: {
                available: true,
                resolveUrl: (u) => u,
                client: {
                    getWardrobe: async () => ({
                        looks: wardrobe.map((look, i) => ({ ...look, vrmUrl: 'look-' + i + '.vrm' })),
                    }),
                },
            },
            identity: { kind: 'library', slug: 'her' },
        });
        expect(looks).toHaveLength(wardrobe.length);
        expect(allureOf(looks[0]).band).toBe('complete');
        expect(allureOf(looks[looks.length - 1]).band).toBe('long');
    });
});
