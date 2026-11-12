/**
 * AX18a. The opening names the place she is in, in the person's language. The English-only
 * suffix was removed with the locale catalog; the place is named again through PrivateLocale.
 */
/* global describe, test, expect */
const Locale = require('../../src/features/together/PrivateLocale.js');

describe("the opening's place sentence", () => {
    test('every language defines it, with the place in it and no English left behind', () => {
        for (const code of Object.keys(Locale.PACKS)) {
            const line = Locale.t('opening.place', { place: 'Coastal Terrace' }, code);
            expect(line).toContain('Coastal Terrace');
            expect(line).not.toMatch(/\{place\}/);
            if (!code.startsWith('en')) expect(line).not.toMatch(/good place for it/);
        }
    });

    test('Italian reads as Italian', () => {
        expect(Locale.t('opening.place', { place: 'la suite' }, 'it-IT')).toBe('la suite mi sembra il posto giusto.');
    });
});
