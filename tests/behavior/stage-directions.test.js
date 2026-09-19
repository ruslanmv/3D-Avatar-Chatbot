/**
 * `[smile]` is not something she says (P14).
 *
 * Reported from a real Private session: her replies arrived with bracketed stage directions in
 * them, so the bubble read "[smile] I like it when the room is this quiet" and the speech engine
 * said the word "smile" out loud.
 *
 * The property these tests exist to protect is the *negative* one. The obvious implementation —
 * strip everything in square brackets — silently rewrites any message containing ordinary
 * brackets, and a rewrite you cannot see is worse than a marker you can. So the false-positive
 * cases below matter more than the true-positive ones, and they are listed first.
 */

/* global describe, test, expect */

const Stage = require('../../src/features/chat/StageDirections.js');

const clean = (text) => Stage.strip(text).text;
const markers = (text) => Stage.strip(text).markers;

describe('what it must never touch', () => {
    const keep = [
        'She wrote "the room was quiet [sic]" and I liked that.',
        'It is in the third chapter [1], if you want to look.',
        'Have a look at [the photograph](https://example.com/photo) again.',
        'The array is a[0] and the second one is a[1].',
        'I typed [?] because I did not know what to say.',
        'Use the [--verbose] flag if you want the whole log.',
        '[smile — the one from the photograph on your shelf] is what I meant.',
        'It is a *beautiful* evening, and I mean that.',
        'The word is *petrichor*, apparently.',
    ];

    for (const text of keep) {
        test(`untouched: ${text.slice(0, 44)}…`, () => {
            expect(clean(text)).toBe(text);
            expect(markers(text)).toEqual([]);
        });
    }

    test('a bracketed paragraph is somebody quoting, not a direction', () => {
        // Bounded on words rather than characters, because it is about grammar, not layout.
        const long = `[she smiles ${new Array(20).fill('and').join(' ')} leans in]`;
        expect(clean(long)).toBe(long);
    });

    test('a message that is only ordinary text comes back identical, not re-spaced', () => {
        const text = 'Two  spaces   and\na newline.\n\nAnd a paragraph.';
        expect(clean(text)).toBe(text);
    });
});

describe('what it takes out', () => {
    test('the reported case', () => {
        const out = Stage.strip('[smile] I like it when the room is this quiet.');
        expect(out.text).toBe('I like it when the room is this quiet.');
        expect(out.markers).toEqual(['smile']);
    });

    test('mid-sentence, without eating the punctuation around it', () => {
        expect(clean('I know. [laughs] You always say that.')).toBe('I know. You always say that.');
        expect(clean('That is nice [smiles], really.')).toBe('That is nice, really.');
    });

    test('the asterisked shape too', () => {
        expect(clean('*she smiles softly* I am glad you said so.')).toBe('I am glad you said so.');
        expect(markers('*leans in a little closer*')).toEqual(['leans']);
    });

    test('several in one reply', () => {
        const out = Stage.strip('[smiles] Mm. [nods] I think so too.');
        expect(out.text).toBe('Mm. I think so too.');
        expect(out.markers).toEqual(['smiles', 'nods']);
    });

    test('a reply that is nothing but a direction becomes nothing', () => {
        expect(clean('[smile]')).toBe('');
        expect(clean('*smiles softly*')).toBe('');
    });

    test('nothing, and junk, come back safely', () => {
        for (const value of [null, undefined, '', '   ']) {
            expect(() => Stage.strip(value)).not.toThrow();
        }
        expect(Stage.strip(null)).toEqual({ text: '', markers: [] });
    });
});

describe('a marker is information, not just noise', () => {
    test('a recognised direction maps to a presence, never to an adult intent', () => {
        // `flirt`/`tease`/`sensualSway` map to nsfw clips, which UtilityRanker refuses for any
        // intent the user did not raise, and `proactiveNsfw: false` says she may never initiate
        // one. A model asking for a lean gets presence, not performance.
        const forbidden = ['flirt', 'tease', 'beckon', 'sensualSway', 'slowBurn', 'intimate'];
        for (const name of Object.values(Stage.PRESENCE)) expect(forbidden).not.toContain(name);
    });

    test('the presences a reply asked for, de-duplicated and in order', () => {
        const out = Stage.strip('[smiles] Mm. [nods] Yes. [smiling] I mean it.');
        expect(Stage.presenceFrom(out.markers)).toEqual(['smile_soft', 'nod_along']);
    });

    test('a verb with no motion behind it asks for nothing', () => {
        expect(Stage.presenceFor('softly')).toBeNull();
        expect(Stage.presenceFor('not-a-verb')).toBeNull();
        expect(Stage.presenceFor(null)).toBeNull();
    });

    test('every mapped verb is one the stripper actually recognises', () => {
        // Otherwise a presence could be declared for a marker that never gets stripped, which
        // reads as working and does nothing.
        for (const verb of Object.keys(Stage.PRESENCE)) expect(Stage.VERBS).toContain(verb);
    });
});
