/**
 * B5 — grounded clip selection.
 *
 * Before this batch the model was offered 19 names while 113 manifest files
 * (plus the addons packs) sat on disk unreachable, and an unmatched name
 * returned null so the avatar silently did nothing. These tests hold the line
 * on both halves: everything in the shipped library is reachable, and a miss
 * is always reported.
 *
 * The real manifest is loaded from disk rather than mocked — the acceptance
 * bar is about the actual shipped assets, so a fixture would prove nothing.
 */

/* global describe, test, expect, beforeAll, afterAll */

const Clips = require('../src/xr/MotionClipMap');
const manifest = require('../vendor/animations/manifest.json');

// These tests characterise the FULL resolver. Library-only mode (the new
// default, Settings → "Built-in animations only") restricts it to the proven
// set and is pinned by tests/motion-library-anims.test.js — so this suite
// runs with the toggle explicitly off.
beforeAll(() => {
    Clips._setManifest(manifest);
    Clips._setLibraryOnly(false);
});
afterAll(() => {
    Clips._setManifest(null);
    Clips._setLibraryOnly(null);
});

/** Every file the manifest declares, flattened. */
function allManifestFiles() {
    const out = [];
    for (const cat of Object.keys(manifest.categories)) {
        for (const file of manifest.categories[cat].files || []) out.push({ cat, file });
    }
    return out;
}

describe('B5: every shipped animation is reachable', () => {
    test('the manifest is non-trivial — the test would be meaningless otherwise', () => {
        expect(allManifestFiles().length).toBeGreaterThan(100);
    });

    test('EVERY manifest file resolves by at least one name', () => {
        const unreachable = [];
        for (const { cat, file } of allManifestFiles()) {
            const path = 'vendor/animations/' + file;
            // Its own basename is the name it must always answer to.
            const name = file
                .split('/')
                .pop()
                .replace(/\.(bvh|vrma)$/i, '');
            const entry = Clips.resolve(name);
            if (!entry || entry.candidates.indexOf(path) === -1) {
                unreachable.push(cat + '/' + name);
            }
        }
        expect(unreachable).toEqual([]);
    });

    test('the Mixamo-origin dances are deliberately unreachable', () => {
        // These eight ship with the repo but drive the upper legs through
        // 168-180 degrees on a VRM rig — Mixamo's bone rest orientation
        // differs from VRM's and the raw quaternions are applied as-is, so the
        // legs invert and splay. The converted dance_* clips peak at 24-107
        // degrees on the same joints. Excluded from selection rather than
        // deleted; see DANCE_CLIPS in MotionClipMap.
        for (const name of ['dancingTwerk', 'hipHopDance', 'hipHopDancing', 'sambaDancing']) {
            const entry = Clips.resolve(name);
            const paths = entry ? entry.candidates.join(' ') : '';
            expect(paths).not.toContain(name + '.vrma');
        }
    });

    test('every dance the pool can pick is a converted clip', () => {
        const entry = Clips.resolve('dance');
        expect(entry.candidates.length).toBeGreaterThan(0);
        for (const p of entry.candidates) {
            if (p.startsWith('addons/vrma-dance/')) {
                expect(p).toMatch(/addons\/vrma-dance\/dance_/);
            }
        }
    });

    test('variants group under their base name', () => {
        // admiration2/admiration3 answer to "admiration", so asking for a mood
        // gives variety instead of the same take every time.
        const entry = Clips.resolve('admiration');
        expect(entry).not.toBeNull();
        expect(entry.candidates.length).toBeGreaterThan(1);
    });

    test('category-prefixed files are reachable without the prefix', () => {
        // "dance/dance_gangnam_style.bvh" answers to "gangnam style" too.
        const entry = Clips.resolve('gangnam style');
        expect(entry).not.toBeNull();
        expect(entry.candidates.join(' ')).toContain('gangnam_style');
    });
});

describe('B5: the curated entries still win', () => {
    test('exact curated names are unchanged', () => {
        for (const name of ['wave', 'bow', 'handshake', 'sit', 'raise_hand']) {
            expect(Clips.resolve(name)).not.toBeNull();
        }
        // wave still resolves to the authored clip, not a manifest guess.
        expect(Clips.resolve('wave').candidates[0]).toContain('waving.vrma');
    });

    test('aliases still resolve', () => {
        for (const alias of Object.keys(Clips.ALIASES)) {
            expect(Clips.resolve(alias)).not.toBeNull();
        }
    });

    test('normalization is unchanged', () => {
        expect(Clips.resolve('HIGH FIVE')).toEqual(Clips.resolve('high_five'));
        expect(Clips.resolve('sit-down')).toEqual(Clips.resolve('sit'));
    });
});

describe('B5: dance draws from the whole library', () => {
    test('"dance" reaches far more than the six hardcoded clips', () => {
        const entry = Clips.resolve('dance');
        expect(entry.candidates.length).toBeGreaterThanOrEqual(15);
    });

    test('successive calls do not repeat the same pick immediately', () => {
        const picks = [];
        for (let i = 0; i < 6; i++) picks.push(Clips.resolve('dance').candidates[0]);
        // A shuffle bag guarantees no back-to-back repeat.
        for (let i = 1; i < picks.length; i++) {
            expect(picks[i]).not.toBe(picks[i - 1]);
        }
    });

    test('the drawn pick keeps the rest as fallbacks', () => {
        const entry = Clips.resolve('dance');
        expect(entry.candidates.length).toBeGreaterThan(1);
        expect(new Set(entry.candidates).size).toBe(entry.candidates.length);
    });
});

describe('B5: fuzzy matching absorbs near-misses', () => {
    test('multi-word requests find the right clip', () => {
        const cases = [
            // "hip hop" used to map here too, but its only clips are
            // Mixamo-origin and no longer selectable.
            ['gangnam style', 'gangnam_style'],
            ['northern soul', 'northern_soul'],
        ];
        for (const [utterance, expected] of cases) {
            const entry = Clips.resolve(utterance);
            expect(entry).not.toBeNull();
            expect(entry.candidates.join(' ').toLowerCase()).toContain(expected.toLowerCase());
        }
    });

    test('a genuinely unknown name still resolves to null', () => {
        // Fuzzy must not match everything — that would be worse than failing,
        // because the avatar would confidently do the wrong thing.
        expect(Clips.resolve('quantum chromodynamics')).toBeNull();
        expect(Clips.resolve('zzzz')).toBeNull();
    });
});

describe('B5: failures are reported, never silent', () => {
    test('play() reports an unknown clip instead of returning quietly', async () => {
        const res = await Clips.play('moonwalk_backwards_on_fire');
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('unknown_clip');
        expect(res.name).toBe('moonwalk_backwards_on_fire');
    });

    test('play() reports when no loader is available', async () => {
        const res = await Clips.play('wave');
        expect(res.ok).toBe(false);
        // Under Jest there is no NEXUS_CLIP_LOADER, so this is the honest
        // reason — distinct from "we had no idea what you meant".
        expect(res.reason).toBe('loader_unavailable');
    });

    test('a curated entry with a procedural fallback still reports it', async () => {
        const res = await Clips.play('nod');
        expect(res.procedural).toBe('nod');
    });
});

describe('B5: catalogLine keeps the prompt affordable', () => {
    test('summarises by category with examples rather than listing every file', () => {
        const line = Clips.catalogLine();
        expect(line).toContain('dance');
        expect(line).toContain('emotion');
        // Listing all 113 names would cost roughly 800 tokens; a taxonomy
        // costs a fraction and models pick better from it.
        expect(line.length).toBeLessThan(700);
    });

    test('it degrades to an empty string with no manifest', () => {
        Clips._setManifest(null);
        expect(Clips.catalogLine()).toBe('');
        Clips._setManifest(manifest);
    });
});
