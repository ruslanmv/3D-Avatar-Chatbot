/**
 * A search that found nothing is not a dead end (batch T8).
 *
 * Measured live against the real gateway, three of the five remaining "nothing played" turns
 * ended in the app's own copy:
 *
 *     NEXUS  I didn't find a playable result for that. Want me to try a different kind of
 *            music instead?
 *
 * The samples existed the whole time. They were only ever consulted when there was *no
 * provider at all* — so a provider that registered and then returned an empty list (no key
 * behind it, a quota exhausted, a query with no embeddable results) skipped them entirely and
 * left the person with nothing.
 *
 * Empty-handed is never the better answer when something real will play. The card says in as
 * many words that it is a sample, so nobody is misled, and they get something instead of a
 * dead end.
 */

const Intent = require('../src/features/together/MediaIntent.js');
const Samples = require('../src/features/discovery/samples.js');

beforeEach(() => {
    window.NEXUS_DISCOVERY_SAMPLES = Samples;
    delete window.NEXUS_DISCOVERY;
});

const registryReturning = (found) => ({
    warm: async () => [],
    forCapability: () => ({ search: async () => found }),
    why: () => 'ok',
});

const registryThrowing = () => ({
    warm: async () => [],
    forCapability: () => ({
        search: async () => {
            throw new Error('quota exceeded');
        },
    }),
    why: () => 'error',
});

describe('a provider that finds nothing', () => {
    test('falls back to the samples rather than to nothing', async () => {
        window.NEXUS_DISCOVERY = registryReturning([]);
        const found = await Intent.search('romantic video', 'video');
        expect(found).not.toBeNull();
        expect(found.length).toBeGreaterThan(0);
        expect(found[0].sample).toBe(true);
    });

    test('for music too', async () => {
        window.NEXUS_DISCOVERY = registryReturning([]);
        const found = await Intent.search('relaxing music', 'music');
        expect(found[0].sample).toBe(true);
        expect(found[0].kind).toBe('music');
    });

    test('and a provider that throws does the same', async () => {
        // A search that could not run is a different fact from one that found nothing — but
        // the person asking does not care, and a sample still beats a dead end.
        window.NEXUS_DISCOVERY = registryThrowing();
        const found = await Intent.search('relaxing music', 'music');
        expect(found).not.toBeNull();
        expect(found[0].sample).toBe(true);
    });
});

describe('no provider at all — the behaviour this batch must not regress', () => {
    test('the samples answer, as they always did', async () => {
        // This path predates the batch. It survived a mutation that made it return `null`,
        // which is how a refactor quietly removes the keyless experience entirely.
        const found = await Intent.search('relaxing music', 'music');
        expect(found).not.toBeNull();
        expect(found.length).toBeGreaterThan(0);
        expect(found[0].sample).toBe(true);
    });

    test('for video as well', async () => {
        const found = await Intent.search('a romantic video', 'video');
        expect(found[0].sample).toBe(true);
    });
});

describe('a provider that finds something is untouched', () => {
    test('the real results win, and no sample appears', async () => {
        const real = [{ id: 'abc', title: 'A real result', kind: 'track', provider: 'youtube' }];
        window.NEXUS_DISCOVERY = registryReturning(real);
        const found = await Intent.search('relaxing music', 'music');
        expect(found).toEqual(real);
        expect(found.some((r) => r.sample)).toBe(false);
    });

    test('a single real result is still preferred over the samples', async () => {
        window.NEXUS_DISCOVERY = registryReturning([{ id: 'z', title: 'One', kind: 'video' }]);
        const found = await Intent.search('anything', 'video');
        expect(found).toHaveLength(1);
        expect(found[0].title).toBe('One');
    });
});

describe('when there is nothing to fall back to either', () => {
    test('no samples module: an empty search stays empty', async () => {
        delete window.NEXUS_DISCOVERY_SAMPLES;
        window.NEXUS_DISCOVERY = registryReturning([]);
        expect(await Intent.search('anything', 'video')).toEqual([]);
    });

    test('no provider and no samples is still the honest null', async () => {
        // `null` and `[]` mean different things to the caller — "could not search" and
        // "searched, found nothing" — and collapsing them would lose the only signal that
        // tells the user which of the two happened.
        delete window.NEXUS_DISCOVERY_SAMPLES;
        expect(await Intent.search('anything', 'video')).toBeNull();
    });

    test('a samples module that throws is not a crash', async () => {
        window.NEXUS_DISCOVERY_SAMPLES = {
            forCapability: () => {
                throw new Error('broken');
            },
        };
        window.NEXUS_DISCOVERY = registryReturning([]);
        expect(await Intent.search('anything', 'video')).toEqual([]);
    });
});
