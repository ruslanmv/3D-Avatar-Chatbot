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

describe('TryOnReactions — private looks (OD2)', () => {
    const lace = { id: 'l', name: 'Black lace set', private: true };
    const all = Object.values(Reactions.PRIVATE_LINES).flat();

    test('a private look always gets a line, from the private register, with the back first', () => {
        for (const event of [
            { look: lace, generated: true },
            { look: lace, wears: 1 }, // a shelf look on a wear that would otherwise be silent
            { look: { ...lace, private: undefined, rating: 'private' }, wears: 2 },
        ]) {
            const reaction = Reactions.react({ cause: 'wear', ...event }, () => 0);
            expect(all).toContain(reaction.line);
            expect(reaction.actions[0].id).toBe('turn');
        }
    });

    test('a tattoo made for her has its own lines', () => {
        const inked = { id: 't', name: 'Look', bodyArt: [{ design: 'lotus', placement: 'lower-back' }] };
        expect(Reactions.PRIVATE_LINES.tattoo).toContain(
            Reactions.react({ look: inked, generated: true }, () => 0).line
        );
    });

    test('compare and undo stay silent for private looks too', () => {
        expect(Reactions.react({ look: lace, cause: 'compare' })).toBeNull();
        expect(Reactions.react({ look: lace, cause: 'undo' })).toBeNull();
    });

    test('the register is warm and non-explicit: short lines, no body words', () => {
        all.forEach((line) => {
            expect(line.length).toBeLessThan(48);
            expect(line).not.toMatch(/\b(naked|nude|breast|butt|ass|sex|strip)\w*/i);
        });
    });

    test('an everyday look is unchanged', () => {
        expect(Reactions.isPrivate({ name: 'Yellow sundress' })).toBe(false);
        expect(Reactions.react({ look: { name: 'Yellow sundress' }, wears: 1 })).toBeNull();
    });
});
