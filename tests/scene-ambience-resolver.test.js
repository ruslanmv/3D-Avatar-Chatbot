/**
 * The intent resolver (batch A3).
 *
 * The batch's specified examples are here, but they are not the interesting part. Three
 * properties are, and each one is a way the feature would feel broken if it were missing:
 *
 *   1. **Determinism.** The same sentence twice must move you to the same place. A resolver that
 *      tie-breaks on iteration order gives somebody a different forest each time they ask for a
 *      forest, and there is no way to report that as a bug.
 *   2. **A preference never beats a request.** The dropdown is a nudge. If "take me to the
 *      beach" lands in a forest because the user once chose Nature, the setting has become a
 *      filter and the feature has started arguing with people.
 *   3. **`null` is a real answer.** "Take me to Mars" has no answer in a catalogue of calm
 *      places. Moving somebody somewhere they did not ask for is worse than not moving them.
 *
 * Fixtures rather than the shipped catalogue: the resolver takes entries as an argument
 * precisely so its behaviour is pinned independently of what art happens to exist.
 */

const Resolver = require('../src/features/ambience/SceneAmbienceResolver.js');

/** The batch's own fixture catalogue, from docs/AMBIENCE_BATCHES.md. */
const FIXTURES = [
    { id: 'ocean-sunrise', category: 'relax', tags: ['ocean', 'beach', 'sea', 'relax'] },
    { id: 'forest-river', category: 'nature', tags: ['forest', 'river', 'nature', 'meditation'] },
    { id: 'rain-study', category: 'study', tags: ['rain', 'study', 'focus', 'cozy'] },
    { id: 'night-garden', category: 'meditation', tags: ['garden', 'night', 'meditation', 'relax'] },
];

/** A fixed daytime clock, so the time-of-day signal never makes a test flaky. */
const NOON = new Date('2026-09-12T12:00:00');
const MIDNIGHT = new Date('2026-09-12T23:30:00');

function resolve(intent, extra) {
    return Resolver.resolve({ intent, entries: FIXTURES, now: NOON, ...extra });
}

describe('the specified examples', () => {
    test.each([
        ['sea', undefined, 'ocean-sunrise'],
        ['forest', undefined, 'forest-river'],
        ['study', undefined, 'rain-study'],
        ['river', undefined, 'forest-river'],
        ['rain', undefined, 'rain-study'],
    ])('intent=%s mood=%s → %s', (intent, mood, expected) => {
        expect(resolve(intent, { mood })).toBe(expected);
    });

    test('meditation at night prefers the night garden', () => {
        expect(Resolver.resolve({ intent: 'meditation', entries: FIXTURES, now: MIDNIGHT })).toBe('night-garden');
    });

    test('intent=relax with a nature preference still needs a relaxing scene', () => {
        // Worth stating plainly, because the design doc's example got this wrong: forest-river
        // carries no relax-family tag (forest, river, nature, meditation), so it never clears
        // the threshold however strong the preference. A preference reorders eligible
        // candidates; it cannot make an ineligible one win. ocean-sunrise is tagged `relax`
        // AND categorised `relax`, so it is the honest answer here.
        expect(resolve('relax', { preference: 'nature' })).toBe('ocean-sunrise');
        const ranked = Resolver.rank({ intent: 'relax', preference: 'nature', entries: FIXTURES, now: NOON });
        expect(ranked.find((r) => r.id === 'forest-river').eligible).toBe(false);
    });

    test('an intent with nothing to match returns null', () => {
        expect(resolve('mars')).toBeNull();
        expect(resolve('volcano')).toBeNull();
    });
});

describe('determinism', () => {
    test('the same request 100 times gives the same scene', () => {
        const answers = new Set();
        for (let i = 0; i < 100; i += 1) answers.add(resolve('relax'));
        expect(answers.size).toBe(1);
    });

    test('entry order does not change the winner', () => {
        const forward = Resolver.resolve({ intent: 'meditation', entries: FIXTURES, now: NOON });
        const reversed = Resolver.resolve({ intent: 'meditation', entries: [...FIXTURES].reverse(), now: NOON });
        expect(reversed).toBe(forward);
    });

    test('a tie breaks on id, ascending', () => {
        // Two entries identical but for the id: the answer must be predictable, and "whichever
        // the loop saw first" is not.
        const tied = [
            { id: 'zebra-shore', category: 'relax', tags: ['sea'] },
            { id: 'alpha-shore', category: 'relax', tags: ['sea'] },
        ];
        expect(Resolver.resolve({ intent: 'sea', entries: tied, now: NOON })).toBe('alpha-shore');
        expect(Resolver.resolve({ intent: 'sea', entries: [...tied].reverse(), now: NOON })).toBe('alpha-shore');
    });
});

describe('a preference ranks but never filters', () => {
    test('an explicit request beats a conflicting preference', () => {
        // The user once chose Forest & River. They have just asked for the beach.
        expect(resolve('sea', { preference: 'forest' })).toBe('ocean-sunrise');
        expect(resolve('study', { preference: 'ocean' })).toBe('rain-study');
    });

    test('a preference only decides among scenes the request already allows', () => {
        const both = [
            { id: 'calm-bay', category: 'relax', tags: ['relax', 'sea'] },
            { id: 'calm-wood', category: 'relax', tags: ['relax', 'forest'] },
        ];
        const ctx = { intent: 'relax', entries: both, now: NOON };
        expect(Resolver.resolve({ ...ctx, preference: 'ocean' })).toBe('calm-bay');
        expect(Resolver.resolve({ ...ctx, preference: 'forest' })).toBe('calm-wood');
    });

    test('auto applies no nudge at all', () => {
        const withAuto = Resolver.rank({ intent: 'relax', entries: FIXTURES, preference: 'auto', now: NOON });
        const withNone = Resolver.rank({ intent: 'relax', entries: FIXTURES, now: NOON });
        expect(withAuto).toEqual(withNone);
    });

    test('an unknown preference is ignored rather than throwing', () => {
        expect(resolve('sea', { preference: 'nonsense' })).toBe('ocean-sunrise');
        expect(resolve('sea', { preference: 42 })).toBe('ocean-sunrise');
    });

    test('one intent tag outweighs every other signal combined', () => {
        // The guarantee behind "a direct request always wins": mood + preference + time of day
        // + featured can never add up to a single intent match.
        const W = Resolver.WEIGHTS;
        expect(W.INTENT_TAG).toBeGreaterThan(W.MOOD + W.PREFERENCE + W.TIME_OF_DAY + W.FEATURED);
    });
});

describe('null is a real answer', () => {
    test('below the threshold, nothing is returned', () => {
        // A scene matching only on mood and time of day is not what was asked for.
        const weak = [{ id: 'vague', category: 'relax', tags: ['relax'] }];
        expect(Resolver.resolve({ intent: 'sea', mood: 'relax', entries: weak, now: NOON })).toBeNull();
    });

    test('the threshold is one solid intent match', () => {
        expect(Resolver.THRESHOLD).toBe(Resolver.WEIGHTS.INTENT_TAG);
    });

    test.each([
        [[], 'an empty catalogue'],
        [null, 'a null catalogue'],
        [undefined, 'no catalogue'],
        ['nonsense', 'a string instead of a catalogue'],
    ])('%p (%s) → null', (entries) => {
        expect(Resolver.resolve({ intent: 'sea', entries, now: NOON })).toBeNull();
    });

    test.each([[''], ['   '], [null], [undefined], [42], [{}], [['sea']]])('an unusable intent %p → null', (intent) => {
        expect(Resolver.resolve({ intent, entries: FIXTURES, now: NOON })).toBeNull();
    });

    test('no arguments at all → null, not a throw', () => {
        expect(Resolver.resolve()).toBeNull();
        expect(Resolver.resolve({})).toBeNull();
    });
});

describe('intent normalisation', () => {
    test('every canonical intent maps to itself', () => {
        for (const intent of Resolver.INTENTS) {
            expect(Resolver.canonicalIntent(intent)).toBe(intent);
        }
    });

    test('aliases collapse to their canonical intent', () => {
        expect(Resolver.canonicalIntent('ocean')).toBe('sea');
        expect(Resolver.canonicalIntent('beach')).toBe('sea');
        expect(Resolver.canonicalIntent('shore')).toBe('sea');
        expect(Resolver.canonicalIntent('woods')).toBe('forest');
        expect(Resolver.canonicalIntent('waterfall')).toBe('river');
        expect(Resolver.canonicalIntent('concentrate')).toBe('study');
    });

    test('case and padding are forgiven', () => {
        expect(Resolver.canonicalIntent('  OCEAN  ')).toBe('sea');
    });

    test('an unknown word is null, never a guess', () => {
        for (const word of ['mars', 'kitchen', 'xyzzy', '', null, undefined, 42]) {
            expect(Resolver.canonicalIntent(word)).toBeNull();
        }
    });

    test('aliases reaching the resolver work like the canonical word', () => {
        expect(resolve('ocean')).toBe(resolve('sea'));
        expect(resolve('woods')).toBe(resolve('forest'));
    });

    test('the 14 intents the prompt advertises are exactly what the resolver accepts', () => {
        // The capability (A8) puts this vocabulary in the system prompt. If the two drift, the
        // model is told about a word that resolves to nothing.
        expect(Resolver.INTENTS).toEqual([
            'sea',
            'forest',
            'river',
            'lake',
            'mountain',
            'garden',
            'sky',
            'rain',
            'study',
            'cozy',
            'night',
            'fantasy',
            'meditation',
            'relax',
        ]);
    });
});

describe('mood', () => {
    test('only the six advertised moods are accepted', () => {
        expect(Resolver.MOODS).toEqual(['relax', 'meditation', 'focus', 'sleep', 'cozy', 'dream']);
        for (const mood of Resolver.MOODS) expect(Resolver.normalizeMood(mood)).toBe(mood);
    });

    test('an unknown mood is dropped, not fatal', () => {
        expect(Resolver.normalizeMood('euphoric')).toBeNull();
        expect(resolve('sea', { mood: 'euphoric' })).toBe('ocean-sunrise');
    });

    test('an unknown intent falls back to a usable mood', () => {
        // "Somewhere to meditate" is still actionable even if the intent word was odd. Both
        // meditation scenes qualify; night-garden wins because its category is `meditation` too,
        // which is the same tag-beats-nothing / category-adds ordering as everywhere else.
        const chosen = Resolver.resolve({ intent: 'xyzzy', mood: 'meditation', entries: FIXTURES, now: NOON });
        expect(chosen).toBe('night-garden');
        expect(['forest-river', 'night-garden']).toContain(chosen);
    });

    test('an unknown intent and an unknown mood resolve to nothing', () => {
        expect(Resolver.resolve({ intent: 'xyzzy', mood: 'euphoric', entries: FIXTURES, now: NOON })).toBeNull();
    });
});

describe('time of day', () => {
    test.each([
        ['2026-09-12T00:30:00', true],
        ['2026-09-12T05:59:00', true],
        ['2026-09-12T06:00:00', false],
        ['2026-09-12T12:00:00', false],
        ['2026-09-12T18:59:00', false],
        ['2026-09-12T19:00:00', true],
        ['2026-09-12T23:59:00', true],
    ])('%s is night=%p', (iso, expected) => {
        expect(Resolver.isNightAt(new Date(iso))).toBe(expected);
    });

    test('it accepts a timestamp as well as a Date', () => {
        expect(Resolver.isNightAt(MIDNIGHT.getTime())).toBe(true);
    });

    test('it nudges but cannot overturn a request', () => {
        // At midnight the night garden gains a point, but a request for the sea still goes
        // to the sea.
        expect(Resolver.resolve({ intent: 'sea', entries: FIXTURES, now: MIDNIGHT })).toBe('ocean-sunrise');
    });

    test('a missing clock does not throw', () => {
        expect(() => Resolver.resolve({ intent: 'sea', entries: FIXTURES })).not.toThrow();
    });
});

describe('robustness against a rough catalogue', () => {
    test('an entry with no tags does not throw and does not win', () => {
        const rough = [{ id: 'bare' }, { id: 'ocean-sunrise', category: 'relax', tags: ['sea'] }];
        expect(Resolver.resolve({ intent: 'sea', entries: rough, now: NOON })).toBe('ocean-sunrise');
    });

    test.each([
        [[null]],
        [[undefined]],
        [['a string']],
        [[42]],
        [[{}]],
        [[{ tags: ['sea'] }]], // no id, so unselectable
    ])('a junk entry %p is skipped', (entries) => {
        expect(() => Resolver.resolve({ intent: 'sea', entries, now: NOON })).not.toThrow();
        expect(Resolver.resolve({ intent: 'sea', entries, now: NOON })).toBeNull();
    });

    test('tags of the wrong type are ignored rather than fatal', () => {
        const weird = [{ id: 'x', category: 'relax', tags: 'sea,ocean' }];
        expect(Resolver.resolve({ intent: 'sea', entries: weird, now: NOON })).toBeNull();
    });

    test('more tag matches score higher', () => {
        const few = { id: 'few', tags: ['sea'] };
        const many = { id: 'many', tags: ['sea', 'ocean', 'beach'] };
        const ctx = { intent: 'sea', night: false, preferenceIntents: [], mood: null };
        expect(Resolver.scoreEntry(many, ctx).total).toBeGreaterThan(Resolver.scoreEntry(few, ctx).total);
    });
});

describe('rank', () => {
    test('it returns every entry, best first, with a reason', () => {
        const ranked = Resolver.rank({ intent: 'sea', entries: FIXTURES, now: NOON });
        expect(ranked).toHaveLength(FIXTURES.length);
        expect(ranked[0].id).toBe('ocean-sunrise');
        expect(ranked[0].eligible).toBe(true);
        expect(ranked[0].why.join(' ')).toContain('intent:sea');
        for (let i = 1; i < ranked.length; i += 1) {
            expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
        }
    });

    test('ineligible entries are included, so "nothing matched" is inspectable', () => {
        const ranked = Resolver.rank({ intent: 'mars', entries: FIXTURES, now: NOON });
        expect(ranked).toHaveLength(FIXTURES.length);
        expect(ranked.every((r) => r.eligible === false)).toBe(true);
    });

    test('its winner is the one resolve returns', () => {
        for (const intent of ['sea', 'forest', 'study', 'relax', 'meditation']) {
            const ranked = Resolver.rank({ intent, entries: FIXTURES, now: NOON });
            const eligible = ranked.filter((r) => r.eligible);
            const chosen = resolve(intent);
            if (!eligible.length) expect(chosen).toBeNull();
            else expect(chosen).toBe(eligible[0].id);
        }
    });
});

describe('the tables are not mutable by a caller', () => {
    test('ALIASES and the weights are frozen', () => {
        expect(Object.isFrozen(Resolver.ALIASES)).toBe(true);
        expect(Object.isFrozen(Resolver.WEIGHTS)).toBe(true);
        expect(Object.isFrozen(Resolver.INTENTS)).toBe(true);
    });
});

describe('satisfiableIntents — what the prompt may honestly advertise', () => {
    test('it reports only intents that resolve to something', () => {
        const can = Resolver.satisfiableIntents(FIXTURES);
        expect(can).toContain('sea');
        expect(can).toContain('forest');
        expect(can).toContain('study');
        expect(can).not.toContain('mountain'); // nothing in the fixtures is a mountain
        expect(can).not.toContain('fantasy');
    });

    test('it is a subset of the advertised vocabulary, in the same order', () => {
        const can = Resolver.satisfiableIntents(FIXTURES);
        expect(Resolver.INTENTS).toEqual(expect.arrayContaining(can));
        expect(can).toEqual(Resolver.INTENTS.filter((i) => can.includes(i)));
    });

    test.each([[[]], [null], [undefined], ['nonsense']])('%p yields nothing to advertise', (entries) => {
        expect(Resolver.satisfiableIntents(entries)).toEqual([]);
    });

    test('the shipped catalogue cannot satisfy every advertised intent', () => {
        // A content fact, pinned so it is noticed rather than discovered by a user: the starter
        // art is ocean / lake / garden / terrace / sky, so "take me to a forest" has no answer
        // and the resolver correctly declines. A8 must advertise satisfiableIntents() rather
        // than all fourteen words, or the companion offers places that do not exist.
        const Catalog = require('../src/gltf-viewer/ambience/ViewportBackgroundCatalog.js');
        const fs = require('fs');
        const path = require('path');
        Catalog.reset();
        Catalog.ingest(
            JSON.parse(fs.readFileSync(path.resolve(__dirname, '../assets/ambient/backgrounds.json'), 'utf-8'))
        );

        const can = Resolver.satisfiableIntents(Catalog.images());
        expect(can).toContain('sea');
        expect(can).toContain('garden');
        expect(can).toContain('sky');
        expect(can).not.toContain('forest');
        expect(can.length).toBeLessThan(Resolver.INTENTS.length);
    });
});
