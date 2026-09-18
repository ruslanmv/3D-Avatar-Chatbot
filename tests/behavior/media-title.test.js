/**
 * A soundtrack strip shows one ellipsised line, so what survives the cut decides what the
 * reader learns. These tests are written against the two titles that actually shipped and the
 * shapes the tidier must refuse to touch.
 *
 * They assert the property — "the keywords are gone, the name is there" — rather than an exact
 * string, wherever asserting the string would fail on an improvement.
 */

/* global describe, test, expect */

const Title = require('../../src/features/together/MediaTitle.js');

describe('MediaTitle.clean', () => {
    test('keeps the name and drops the keywords a search engine was for', () => {
        expect(Title.clean('Relaxing Chill Music – Stress Relief Lounge Music | Background Music')).toBe(
            'Relaxing Chill Music'
        );
    });

    test('drops a trailing attribution and the production bracket with it', () => {
        const raw = 'Epic Motivational and Cinematic Inspirational Music | Force - by AShamaluevMusic (Full Album)';
        const clean = Title.clean(raw);
        expect(clean).not.toMatch(/AShamaluevMusic/);
        expect(clean).not.toMatch(/Full Album/i);
        expect(clean).not.toMatch(/\|/);
        expect(clean).toContain('Epic Motivational');
    });

    test('an artist and a piece separated by a hyphen are both kept', () => {
        // The single most common shape a music title takes. Splitting here would keep the
        // artist and throw away the work, which is the wrong half.
        expect(Title.clean('Beethoven - Moonlight Sonata')).toBe('Beethoven - Moonlight Sonata');
        expect(Title.clean('Clair de Lune, Debussy')).toBe('Clair de Lune, Debussy');
    });

    test('a bracket with real content survives; a production bracket does not', () => {
        expect(Title.clean('Sunflower (feat. Somebody)')).toBe('Sunflower (feat. Somebody)');
        expect(Title.clean('Sunflower (Official Video)')).toBe('Sunflower');
        expect(Title.clean('Sunflower [Official Music Video]')).toBe('Sunflower');
        expect(Title.clean('Sunflower (1 Hour Loop)')).toBe('Sunflower');
        expect(Title.clean('Sunflower (Copyright Free)')).toBe('Sunflower');
    });

    test('a short leading label is not mistaken for the title', () => {
        // Keeping `NEW` alone would be a worse cut than keeping the whole line.
        expect(Title.clean('NEW | Midnight Drive Through the City')).toContain('Midnight Drive');
    });

    test('never returns an empty line, whatever it is given', () => {
        expect(Title.clean('(Official Video)')).toBe('(Official Video)');
        expect(Title.clean('by AShamaluevMusic')).toBe('by AShamaluevMusic');
        expect(Title.clean('')).toBe('');
        expect(Title.clean(null)).toBe('');
        expect(Title.clean(undefined)).toBe('');
    });

    test('caps at a word boundary rather than mid-word', () => {
        const long = 'Something Enormously Long That Keeps Going And Going Without Any Separator At All';
        const capped = Title.clean(long, { max: 30 });
        expect(capped.length).toBeLessThanOrEqual(30);
        expect(capped.endsWith('…')).toBe(true);
        expect(capped).not.toMatch(/\s…$/);
    });

    test('control characters and runs of whitespace collapse', () => {
        expect(Title.clean('Quiet\n\nRain\tSounds')).toBe('Quiet Rain Sounds');
    });
});

describe('MediaTitle.display', () => {
    test('the provider s creator wins over one recovered from the title', () => {
        const out = Title.display({ title: 'Force - by AShamaluevMusic', creator: 'AShamaluev Music' });
        expect(out.creator).toBe('AShamaluev Music');
        expect(out.title).toBe('Force');
    });

    test('a creator hidden in the title is recovered when the result has none', () => {
        const out = Title.display({ title: 'Force - by AShamaluevMusic (Full Album)' });
        expect(out.creator).toBe('AShamaluevMusic');
        expect(out.title).toBe('Force');
    });

    test('raw carries the untouched title so a caller can show it in full', () => {
        const raw = 'Relaxing Chill Music – Stress Relief Lounge Music | Background Music';
        expect(Title.display({ title: raw }).raw).toBe(raw);
    });

    test('a result with nothing in it still produces something renderable', () => {
        expect(Title.display(null)).toEqual({ title: '', creator: '', raw: '' });
    });
});
