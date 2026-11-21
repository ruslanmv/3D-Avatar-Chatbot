/**
 * FN1. One fantasy catalogue for Forge and the chatbot (Forge docs/WARDROBE_FANTASIES.md).
 *
 * `assets/wardrobe/fantasies.json` is Forge's catalogue, imported verbatim by
 * `node tools/wardrobe/sync-fantasies.mjs`. These tests keep the two sides meaning the same thing:
 * every costume Private's own texts bring up is a fantasy Forge has, with outfits in the offline
 * dictionary, and nothing in Private reads as a minor.
 */
const fs = require('fs');
const path = require('path');
const Intent = require('../../src/experiences/private/PrivateActionIntent.js');

const root = path.join(__dirname, '../..');
const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'assets/wardrobe/fantasies.json'), 'utf8'));

/** The texts Private says or shows: personas, shows, rooms, the locale, the intent words. */
const PRIVATE_TEXTS = [
    'src/experiences/private/PrivatePersonas.js',
    'src/experiences/private/PrivateRoutines.js',
    'src/experiences/private/PrivatePlaceScripts.js',
    'src/features/together/PrivateLocale.js',
    'src/features/together/StoryWeaver.js',
]
    .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
    // What she says and shows, not the comments that state these very rules.
    .map((src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' '));

const fold = (t) =>
    String(t || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '');
const hasWord = (text, word) => {
    const w = fold(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return /[^\x00-ɏ]/.test(w)
        ? fold(text).includes(fold(word))
        : new RegExp(`(?<!\\p{L})${w}(?!\\p{L})`, 'u').test(fold(text));
};

/** Costume words a text could use to put her in a role (English and Italian, as the texts are written). */
const COSTUME_WORDS = [
    'maid',
    'nurse',
    'doctor',
    'teacher',
    'secretary',
    'policewoman',
    'firefighter',
    'flight attendant',
    'stewardess',
    'waitress',
    'bride',
    'santa',
    'dominatrix',
    'latex',
    'cosplay',
    'heroine',
    'personal trainer',
    'masseuse',
    'striptease',
    'lap dance',
    'table dance',
    'infermiera',
    'dottoressa',
    'segretaria',
    'poliziotta',
    'cameriera',
    'sposa',
    'hostess',
];
/** Costumes Forge does not make (Tier B skipped): Private's texts must not promise them. */
const NOT_MADE = [
    'bunny',
    'catgirl',
    'cat ears',
    'nun',
    'cowgirl',
    'devil costume',
    'angel costume',
    'apron',
    'lab coat',
];

describe('FN1. fantasy contract with Forge', () => {
    test("every fantasy names outfits (Forge's own test checks each one exists there)", () => {
        expect(catalogue.fantasies.length).toBeGreaterThanOrEqual(20);
        for (const f of catalogue.fantasies) {
            expect([f.id, f.outfits.length > 0]).toEqual([f.id, true]);
            expect(Object.keys(f.words).sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt', 'zh']);
        }
    });

    test('every costume Private brings up is a fantasy Forge has', () => {
        for (const word of COSTUME_WORDS) {
            if (!PRIVATE_TEXTS.some((t) => hasWord(t, word))) continue;
            const f =
                Intent.fantasyFrom(`dress up as ${word}`, catalogue) || Intent.fantasyFrom(`fai la ${word}`, catalogue);
            expect([word, Boolean(f)]).toEqual([word, true]);
        }
        for (const word of NOT_MADE) {
            const where = PRIVATE_TEXTS.findIndex((t) => hasWord(t, word));
            expect([word, where]).toEqual([word, -1]);
        }
    });

    test('nothing in Private or the catalogue reads as a minor', () => {
        const banned = Object.values(catalogue.banned).flat();
        expect(banned).toEqual(expect.arrayContaining(['schoolgirl', 'scolaretta', 'teen']));
        const texts = PRIVATE_TEXTS.concat([JSON.stringify(catalogue.fantasies)]);
        for (const word of banned) {
            const where = texts.findIndex((t) => hasWord(t, word));
            expect([word, where]).toEqual([word, -1]);
        }
    });
});

describe('FN1. a fantasy in their words', () => {
    const id = (t) => {
        const f = Intent.fantasyFrom(t, catalogue);
        return f ? f.id : null;
    };
    test('asked to dress or play the part, in their language', () => {
        expect(id('vestiti da infermiera')).toBe('nurse');
        expect(id('fai la dottoressa')).toBe('doctor');
        expect(id('vístete de enfermera')).toBe('nurse');
        expect(id('be my maid tonight')).toBe('maid');
        expect(id('sii la mia sposa stanotte')).toBe('bride');
        expect(id('女医になって')).toBe('doctor');
    });
    test('the longer phrase wins, and talk is not a request', () => {
        expect(id('vestiti da cameriera francese')).toBe('maid');
        expect(id('fai la cameriera')).toBe('waitress');
        expect(id('mia sorella è infermiera')).toBeNull();
        expect(id('vestiti da infermiera')).not.toBeNull();
        expect(Intent.fantasyFrom('vestiti da infermiera', null)).toBeNull();
    });
});
