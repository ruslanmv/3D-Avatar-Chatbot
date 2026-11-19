/**
 * PB2. She knows her body without the whole catalogue in every prompt: a short index always, a
 * family in detail only when the person's words touch it, filtered by her position, under budget.
 */
const K = require('../src/experiences/private/PrivateBodyKnowledge.js');
// Every state Forge has: the worst case for the budget. Forge's own file when it is checked out
// beside this repository (so a new state is measured at once), else the copy taken with this test.
let FULL;
try {
    FULL = Object.keys(require('../../3d-wardrobe-forge/assets/body_detail/states.json').states);
} catch (_) {
    FULL = require('./fixtures/forge-body-states.json').states;
}

describe('PB2 her body, known in proportion', () => {
    test('a full pack: the index stays under its budget and names families, not states', () => {
        const { index, detail } = K.lines({ names: FULL, text: 'ciao' });
        expect(index.length).toBeLessThanOrEqual(K.BUDGET.index);
        expect(index).toMatch(/fisting \d+/);
        expect(index).not.toMatch(/doggy anal fisted/);
        expect(detail).toBeNull();
    });

    test('"what can you show" lists everything she has, under the larger budget', () => {
        for (const said of ['Cosa puoi mostrare?', 'what can you show me', '¿Qué puedes mostrar?']) {
            const { detail } = K.lines({ names: FULL, text: said });
            expect(detail).toMatch(/arousal: /);
            expect(detail.length).toBeLessThanOrEqual(K.BUDGET.all);
        }
    });

    test('only the family asked, and only for the position she holds', () => {
        const doggy = K.lines({ names: FULL, pose: 'doggy', text: 'sto per venire dentro di te' }).detail;
        expect(doggy).toMatch(/finishes: [^;]*doggy creampie/);
        expect(doggy).not.toMatch(/missionary/);
        expect(doggy).not.toMatch(/fisting:/);
        expect(doggy.length).toBeLessThanOrEqual(K.BUDGET.detail);
        expect(K.lines({ names: FULL, text: 'usa le corde e la cera' }).detail).toMatch(/rough \(sado\): /);
    });

    test('a piercing asked for: it comes with a bare look, so she is told which she can change into', () => {
        const withLooks = K.lines({
            names: ['open'],
            text: 'Voglio un piercing nella tua vagina',
            bareLooks: [{ name: 'Bare · labia rings' }],
        }).detail;
        expect(withLooks).toMatch(/never added live[^.]*Bare · labia rings/);
        const none = K.lines({ names: ['open'], text: 'voglio un tatuaggio' }).detail;
        expect(none).toMatch(/no other bare look/);
    });

    test('ordinary words do not pull a family in (ricordo, sincera)', () => {
        expect(K.asked('mi ricordo di te, sei sincera')).toEqual([]);
        expect(K.lines({ names: [], text: 'ciao' })).toEqual({ index: null, detail: null });
    });

    test('BD21: asked for a piercing, she names the look that has one, with what it has', () => {
        const bareLooks = [
            { name: 'Bare · tanned', extras: ['tan-triangle-thong'] },
            { name: 'Bare · pierced', extras: ['piercings-nipples', 'piercings-intimate'] },
        ];
        const { detail } = K.lines({ names: FULL, text: 'Voglio un piercing nella tua vagina', bareLooks });
        expect(detail).toMatch(/Bare · pierced \(piercings nipples, piercings intimate\)/);
        expect(detail).not.toMatch(/tanned/);
        expect(detail.length).toBeLessThanOrEqual(K.BUDGET.detail);
        // Asked for something no look has, every bare look is offered rather than none.
        expect(K.looksFor(bareLooks, 'un tatuaggio')).toHaveLength(2);
    });

    test('BD21: what is painted on her look now is in the index, within budget', () => {
        const { index } = K.lines({ names: FULL, text: 'ciao', wearing: ['tattoo-mons-rose'] });
        expect(index).toMatch(/on your skin now: tattoo mons rose/);
        expect(index.length).toBeLessThanOrEqual(K.BUDGET.index);
        expect(K.lines({ names: [], wearing: ['glitter'] }).index).toMatch(/glitter/);
    });
});
