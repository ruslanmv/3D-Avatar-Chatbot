/**
 * LT1. Her reactions: one line, now and then, always with something to do next — and
 * never for the person's own looking around (compare, undo, Show Mode).
 */
const Reactions = require('../../src/wardrobe/TryOnReactions.js');

const CASUAL = { id: 'c', name: 'Crop top & jeans', tags: ['casual', 'denim'] };
const DRESSY = { id: 'd', name: 'Cocktail', prompt: 'black satin cocktail dress' };
const PLAIN = { id: 'p', name: 'Look' };
const first = () => 0;

describe('TryOnReactions', () => {
    test('a look made for her always gets a line; a change names the part that changed', () => {
        const made = Reactions.react({ look: PLAIN, cause: 'wear', generated: true }, first);
        expect(made.line).toBeTruthy();
        const changed = Reactions.react(
            { look: PLAIN, cause: 'wear', generated: true, change: { slot: 'top' } },
            first
        );
        expect(changed.line).toMatch(/\btop\b/);
        expect(changed.actions.map((a) => a.id)).toEqual(expect.arrayContaining(['compare', 'keep']));
    });

    test('a change of mood gets a line', () => {
        expect(Reactions.react({ look: CASUAL, previous: DRESSY, cause: 'wear', wears: 1 }, first)).not.toBeNull();
    });

    test('a shelf look otherwise only every third wear', () => {
        const said = [1, 2, 3, 4, 5, 6].map((wears) => Boolean(Reactions.react({ look: PLAIN, cause: 'wear', wears })));
        expect(said).toEqual([false, false, true, false, false, true]);
    });

    test('compare, undo, Show Mode and the original never get one', () => {
        ['compare', 'compare-end', 'undo', 'play'].forEach((cause) => {
            expect(Reactions.react({ look: PLAIN, cause, generated: true, wears: 3 })).toBeNull();
        });
        expect(Reactions.react({ look: { original: true }, cause: 'wear', wears: 3 })).toBeNull();
    });

    test('mood reads tags, then the recipe, then the name', () => {
        expect(Reactions.mood(CASUAL)).toBe('casual');
        expect(Reactions.mood(DRESSY)).toBe('dressy');
        expect(Reactions.mood(PLAIN)).toBeNull();
    });
});
