/**
 * WM1. She chooses clothes by what Forge says a look is, not by words in its name.
 *
 * The looks below are shaped like Forge's wardrobe list after WM1 (`types`, `colours`,
 * `occasions`, `group`, `pieces`), with names copied from Avatar A's real wardrobe. Before WM1,
 * "la lingerie rossa" chose black lingerie (her red sets are named Wine and Crimson) and
 * "qualcosa per ballare" found nothing.
 */
const Engine = require('../../src/experiences/private/OutfitDecisionEngine.js');
const Intent = require('../../src/experiences/private/PrivateActionIntent.js');

const LOOKS = [
    {
        id: 'black-bralette',
        name: 'Black Lace Tailored Triangle Bralette',
        types: ['lingerie'],
        colours: ['black'],
        level: 3,
    },
    { id: 'wine-garter', name: 'Wine Garter Set', types: ['lingerie'], colours: ['red'], level: 3 },
    {
        id: 'halter-skater',
        name: 'Red Halter Crop Top + Black Skater Skirt',
        outfitId: 'halter-skater',
        group: 'casual',
        // The foundation under the outfit is lingerie, but it is hidden: this is no lingerie look.
        pieces: [
            { template: 'under-bra-full-v2', type: 'lingerie', hidden: true },
            { template: 'top-halter-v1', type: 'tops', colour: 'red' },
            { template: 'skirt-skater-mini-v1', type: 'skirts', colour: 'black' },
        ],
        types: ['tops', 'skirts'],
        colours: ['red', 'black'],
        occasions: ['night-out/party', 'shopping/cute'],
        level: 1,
    },
    {
        id: 'bodycon-boots',
        name: 'Black Bodycon Mini Dress + Black Combat Boots',
        outfitId: 'leather-mini-combat',
        group: 'dressy',
        types: ['dresses', 'shoes'],
        colours: ['black'],
        occasions: ['night-out/edgy'],
        level: 2,
    },
    {
        id: 'tee-jeans',
        name: 'White Fitted Tee + Blue Straight Jeans',
        group: 'casual',
        types: ['tshirts', 'trousers'],
        colours: ['white', 'blue'],
        level: 1,
    },
];

function pick(words, current = null) {
    const parsed = Intent.parse(words, { lang: 'it' });
    const p = (parsed && parsed.params) || {};
    return Engine.choose({ request: p, looks: LOOKS, current, canCreate: false });
}

describe('WM1. clothes chosen by meaning', () => {
    test('"la lingerie rossa" is the red lingerie, though its name says Wine', () => {
        const r = Engine.choose({ request: { style: 'lingerie', colour: 'red' }, looks: LOOKS });
        expect(r.look.id).toBe('wine-garter');
    });

    test('a colour Forge stated is not overruled by a word in the name', () => {
        // "Red Halter Crop Top + Black Skater Skirt" has red in it, but asked for black lingerie
        // the black bralette wins and the outfit is never lingerie (its foundation is hidden).
        const r = Engine.choose({ request: { style: 'lingerie', colour: 'black' }, looks: LOOKS });
        expect(r.look.id).toBe('black-bralette');
    });

    test('a party request finds a night-out look from its occasions', () => {
        const r = Engine.choose({ request: { style: 'party' }, looks: LOOKS });
        expect(['halter-skater', 'bodycon-boots']).toContain(r.look.id);
    });

    test('elegant prefers a dress over a tee', () => {
        const r = Engine.choose({ request: { style: 'elegant', colour: 'black' }, looks: LOOKS });
        expect(r.look.id).toBe('bodycon-boots');
    });

    test('looks without Forge meaning still match by their names, as before', () => {
        const old = [
            { id: 'old', name: 'Red Bodycon Mini Dress' },
            { id: 'old2', name: 'Black Dress' },
        ];
        const r = Engine.choose({ request: { colour: 'red' }, looks: old });
        expect(r.look.id).toBe('old');
    });

    test('the words typed in Italian reach the same choice', () => {
        const r = pick('mettiti la lingerie rossa');
        expect(r && r.look.id).toBe('wine-garter');
    });
});
