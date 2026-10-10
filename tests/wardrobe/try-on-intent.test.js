/**
 * LT1. Reading what a person types into live Try-On: navigation or a request to Forge, and
 * "change X" keeping everything they did not ask to change.
 *
 * Assert the decision and the property (which part was rewritten, what was kept), not the
 * wording of a sentence: a test pinned to prose fails on an edit that changes nothing.
 */
const Intent = require('../../src/wardrobe/TryOnIntent.js');

const PACK = {
    id: 'crop-top-jeans',
    name: 'Crop top & jeans',
    provenance: { prompt: 'black fitted crop top + blue straight jeans' },
};
const MADE = { ...PACK, id: 'look_1', source: 'generated', prompt: PACK.provenance.prompt };
const SUNDRESS = { id: 'yellow', name: 'Yellow sundress', provenance: { prompt: 'yellow maxi sundress' } };
const LOOKS = [PACK, SUNDRESS, { id: 'white', name: 'White tee & trousers' }];

const read = (text, { current = PACK, canCreate = true, canBuildOn = true } = {}) =>
    Intent.parse(text, { looks: LOOKS, current, canCreate, canBuildOn });

describe('TryOnIntent', () => {
    test.each([
        ['Next', 'next'],
        ['next one please', 'next'],
        ['Go back', 'previous'],
        ['Undo', 'undo'],
        ['Keep this', 'keep'],
        ["I'll take it", 'keep'],
        ['save', 'favorite'],
        ['play the haul', 'play'],
        ['stop', 'pause'],
        ['show me the back', 'turn'],
        ['End haul', 'end'],
    ])('“%s” is the %s command, not a request to Forge', (text, command) => {
        expect(read(text)).toMatchObject({ kind: 'command', command });
    });

    test('compare: the previous look by default, the original when named', () => {
        expect(read('Compare this with the previous one.')).toMatchObject({ command: 'compare', which: 'previous' });
        expect(read('compare')).toMatchObject({ command: 'compare', which: 'previous' });
        expect(read('Show original')).toMatchObject({ command: 'compare', which: 'original' });
    });

    test('a look she has is found by name, loosely — and that works without Forge', () => {
        expect(read('Go back to the yellow dress.', { canCreate: false })).toMatchObject({
            kind: 'wear',
            look: SUNDRESS,
        });
        expect(read('wear the white tee').look.id).toBe('white');
        expect(read('yellow sundress').look).toBe(SUNDRESS);
    });

    test('“keep the jeans, change the top” is a change, never Keep', () => {
        expect(read('keep the jeans, change the top').kind).not.toBe('command');
        expect(read('Keep the jeans but give her a satin crop top.').kind).toBe('create');
    });

    test('change X on a look Forge made: only the new garment is sent, built on that look', () => {
        const intent = read('Keep the jeans but give her a satin crop top.', { current: MADE });
        expect(intent).toMatchObject({ kind: 'create', mode: 'change', baseLookId: 'look_1', slot: 'top' });
        expect(intent.prompt).toBe('satin crop top');
    });

    test('change X on a look Forge does not have: the recipe is rebuilt with only that part rewritten', () => {
        const intent = read('Make the top red.');
        expect(intent).toMatchObject({ kind: 'create', mode: 'change', baseLookId: null, slot: 'top' });
        const parts = Intent.segments(intent.prompt);
        expect(parts).toContain('blue straight jeans'); // the jeans are asked for again, as they were
        expect(parts.find((p) => Intent.slotOf(p) === 'top')).toMatch(/\bred\b/);
        expect(parts.join(' ')).not.toMatch(/\bblack\b/);
    });

    test('a look is only built on when Forge can: a generic-route avatar rebuilds instead', () => {
        expect(read('Make the top red.', { current: MADE, canBuildOn: false }).baseLookId).toBeNull();
    });

    test('a colour with no part named, on a two-part look, asks which part', () => {
        const intent = read('make it red');
        expect(intent.kind).toBe('ask');
        expect(intent.options).toHaveLength(2);
        // Each answer is itself a change the parser understands.
        intent.options.forEach((option) => expect(read(option)).toMatchObject({ kind: 'create', mode: 'change' }));
    });

    test('a colour on a one-part look rewrites that part', () => {
        expect(read('make it red', { current: SUNDRESS })).toMatchObject({
            kind: 'create',
            prompt: 'red maxi sundress',
            slot: 'dress',
        });
    });

    test('“change the top” with nothing to change it to asks, with answers to tap', () => {
        const intent = read('change the top');
        expect(intent.kind).toBe('ask');
        expect(intent.options.length).toBeGreaterThan(0);
        expect(read(intent.options[0])).toMatchObject({ kind: 'create', slot: 'top' });
    });

    test('asking for what she already has is answered, not sent to Forge', () => {
        expect(read('Make the top black.').kind).toBe('none');
    });

    test('a mood becomes a fresh look from her original, not a change to this one', () => {
        expect(read('Try something more elegant.')).toMatchObject({ kind: 'create', mode: 'fresh', baseLookId: null });
        expect(read('try something completely different').kind).toBe('surprise');
    });

    test('naming a whole new outfit is fresh; adding a layer is a change', () => {
        expect(read('Try a black evening dress')).toMatchObject({ mode: 'fresh', prompt: 'black evening dress' });
        const blazer = read('add a black blazer');
        expect(blazer).toMatchObject({ mode: 'change', slot: 'outer' });
        expect(Intent.segments(blazer.prompt)).toEqual(expect.arrayContaining(['blue straight jeans', 'black blazer']));
    });

    test('without Forge a request to make something says so; navigation still works', () => {
        expect(read('black dress', { canCreate: false })).toMatchObject({ kind: 'none', why: Intent.UNAVAILABLE });
        expect(read('next', { canCreate: false }).kind).toBe('command');
    });

    test('small talk is not sent to Forge', () => {
        expect(read('hello there').kind).toBe('none');
        expect(read('   ').kind).toBe('none');
    });

    test('compose: a dress replaces a top and its bottoms; a top on a dress replaces the dress', () => {
        expect(Intent.compose(['white tee', 'blue jeans', 'black blazer'], 'dress', 'red midi dress')).toEqual([
            'red midi dress',
            'black blazer',
        ]);
        expect(Intent.compose(['yellow maxi sundress'], 'top', 'white tee')).toEqual(['white tee']);
    });

    test('suggestions: Private comes only from what private mode opened; Surprise avoids what she has on', () => {
        expect(Intent.suggestions('private', {})).toEqual([]);
        expect(Intent.suggestions('private', { privatePicks: [{ label: 'Lace', prompt: 'black lace set' }] })).toEqual([
            { label: 'Lace', prompt: 'black lace set' },
        ]);
        for (let i = 0; i < 20; i += 1) {
            const pick = Intent.surprise('for-you', { current: PACK, random: () => i / 20 });
            expect(pick.prompt).not.toBe(PACK.provenance.prompt);
        }
    });
});
