/**
 * Tier 1 — intent to candidates, and the single gate (B5).
 *
 * Three things are load-bearing here and each has a test that would fail loudly if it broke:
 * the client's vectors are the same vectors the offline index holds; every gate lives in
 * `score()` and nowhere else; and the same intent twice does not give the same clip twice.
 */

/* global describe, test, expect, beforeAll, beforeEach */

const fs = require('fs');
const path = require('path');

const Registry = require('../../src/behavior/registry/AnimationRegistry.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const AntiRepeat = require('../../src/behavior/selector/AntiRepeatMemory.js');
const { Ranker, BLOCKED } = require('../../src/behavior/selector/UtilityRanker.js');
const { Selector } = require('../../src/behavior/selector/SemanticSelector.js');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST = fs.readFileSync(path.join(ROOT, 'kb', 'animations.manifest.jsonl'), 'utf8');
const VOCAB = fs.readFileSync(path.join(ROOT, 'kb', 'embeddings', 'index.vocab.tsv'), 'utf8');
const META = JSON.parse(fs.readFileSync(path.join(ROOT, 'kb', 'embeddings', 'index.meta.json'), 'utf8'));
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'behavior.config.json'), 'utf8'));

let registry;
let selector;

beforeAll(() => {
    registry = new Registry().loadText(MANIFEST);
    selector = new Selector().loadVocabularyText(VOCAB).index(registry.records);
});

describe('the client vectors are the offline vectors', () => {
    test('the vocabulary loaded matches the index it was built with', () => {
        expect(selector.column.size).toBe(META.dims);
        expect(selector.idf).toHaveLength(META.dims);
        expect(selector.ready).toBe(true);
    });

    /**
     * The drift test. Two implementations of one formula — build-embeddings.mjs offline and
     * SemanticSelector in the browser — will diverge the first time someone edits one of
     * them. This reads the shipped matrix and compares it to what the client computes.
     */
    test('every record vector matches kb/embeddings/index.f32', () => {
        const raw = fs.readFileSync(path.join(ROOT, 'kb', 'embeddings', 'index.f32'));
        const matrix = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);

        let worst = 0;
        META.rows.forEach((id, row) => {
            const sparse = selector.vectors.get(id);
            expect(`${id} indexed: ${Boolean(sparse)}`).toBe(`${id} indexed: true`);
            for (const [column, value] of sparse) {
                worst = Math.max(worst, Math.abs(value - matrix[row * META.dims + column]));
            }
        });
        expect(worst).toBeLessThan(1e-6);
    });
});

describe('candidate selection', () => {
    test('an intent finds the clips that declare it', () => {
        const candidates = selector.topK({ name: 'dance' }, registry, 3);
        expect(candidates).toHaveLength(3);
        for (const { clip } of candidates) expect(clip.intents).toContain('dance');
    });

    test('similarity orders them, and free text steers the order', () => {
        const calm = selector.topK({ name: 'idle', query: 'lying on the floor' }, registry, 5);
        expect(calm[0].similarity).toBeGreaterThanOrEqual(calm[calm.length - 1].similarity);
        expect(calm.map((c) => c.clip.id).join(' ')).toMatch(/laying|lay/);
    });

    test('an intent nothing declares still returns something reasonable', () => {
        const candidates = selector.topK({ name: 'pirouette', query: 'spinning dance turn' }, registry, 3);
        expect(candidates.length).toBeGreaterThan(0);
        expect(candidates[0].clip.tags.join(' ')).toMatch(/dance|spin/);
    });

    test('with no vocabulary it degrades rather than throwing', () => {
        const bare = new Selector().index(registry.records);
        const candidates = bare.topK({ name: 'happy' }, registry, 3);
        expect(candidates.length).toBeGreaterThan(0);
        expect(bare.ready).toBe(false);
    });

    test('Tier 1 stays far inside the 50 ms budget of §9', () => {
        // Warm, as the budget specifies: the vocabulary and vectors are already built.
        const started = process.hrtime.bigint();
        for (let i = 0; i < 50; i++) selector.topK({ name: 'happy', query: 'celebrate something' }, registry, 3);
        const msPerCall = Number(process.hrtime.bigint() - started) / 1e6 / 50;
        expect(msPerCall).toBeLessThan(50);
    });
});

describe('the ranker is the single enforcement point', () => {
    let bb;
    let ranker;
    let antiRepeat;

    beforeEach(() => {
        bb = new Blackboard();
        antiRepeat = new AntiRepeat(CONFIG.antiRepeatWindow);
        ranker = new Ranker({ weights: CONFIG.weights, antiRepeat, random: () => 0 });
    });

    const nsfwClip = () => registry.records.find((r) => r.nsfw);
    const safeClip = () => registry.records.find((r) => !r.nsfw && r.quality === 'production');

    test('nsfw is blocked while the user setting is off', () => {
        bb.nsfwAllowed = false;
        expect(ranker.score(nsfwClip(), { name: 'flirt', source: 'user' }, bb)).toBe(BLOCKED);
    });

    test('nsfw is blocked while the mode does not permit it, even with the setting on', () => {
        bb.nsfwAllowed = true;
        bb.mode = { allowNsfw: false };
        expect(ranker.score(nsfwClip(), { name: 'flirt', source: 'user' }, bb)).toBe(BLOCKED);
    });

    test('nsfw needs all three, and then it passes', () => {
        // §16.1's triple gate. B28 added the first of them: before it, the user setting
        // plus a permissive mode was enough, and the server attestation was decorative.
        bb.adultVerified = true;
        bb.nsfwAllowed = true;
        bb.mode = { allowNsfw: true };
        expect(ranker.score(nsfwClip(), { name: 'flirt', source: 'user' }, bb)).toBeGreaterThan(-Infinity);
    });

    test('and without the server attestation it does not, however the client is configured', () => {
        bb.adultVerified = false;
        bb.nsfwAllowed = true;
        bb.mode = { allowNsfw: true };
        expect(ranker.score(nsfwClip(), { name: 'flirt', source: 'user' }, bb)).toBe(-Infinity);
    });

    test('she never initiates: a non-user source can never reach nsfw content', () => {
        // The B28 rule, in place from B5 so the adult tier is two lines and not a rewrite.
        bb.adultVerified = true;
        bb.nsfwAllowed = true;
        bb.mode = { allowNsfw: true };
        for (const source of ['curiosity', 'llm', 'vision', 'mcp', 'sentiment']) {
            expect(`${source}: ${ranker.score(nsfwClip(), { name: 'flirt', source }, bb)}`).toBe(
                `${source}: -Infinity`
            );
        }
    });

    test('a tier ceiling that throws closes rather than opens', () => {
        bb.nsfwAllowed = true;
        bb.mode = {
            allowNsfw: true,
            tierAllowed() {
                throw new Error('bad rule');
            },
        };
        expect(ranker.score(nsfwClip(), { name: 'flirt', source: 'user' }, bb)).toBe(BLOCKED);
    });

    test('a mode may refuse a clip for its own reasons', () => {
        bb.mode = { allows: (clip) => clip.kind !== 'bvh' };
        const bvh = registry.ofKind('bvh')[0];
        expect(ranker.score(bvh, { name: 'happy' }, bb)).toBe(BLOCKED);
    });

    test('a clip inside its cooldown is blocked, and passes once it has elapsed', () => {
        const clip = { ...safeClip(), cooldownMs: 20000 };
        antiRepeat.remember(clip.id, 1000);
        expect(ranker.score(clip, { name: 'happy' }, bb, 5000)).toBe(BLOCKED);
        expect(ranker.score(clip, { name: 'happy' }, bb, 30000)).toBeGreaterThan(-Infinity);
    });

    test('the score rewards a mood match and production quality', () => {
        bb.setMood(0.9, 0.9);
        const bright = { ...safeClip(), valence: 0.9, energy: 0.9, quality: 'production' };
        const flat = { ...safeClip(), id: 'other', valence: -0.9, energy: 0.1, quality: 'experimental' };
        expect(ranker.score(bright, { name: 'happy', similarity: 1 }, bb)).toBeGreaterThan(
            ranker.score(flat, { name: 'happy', similarity: 1 }, bb)
        );
    });

    test('every gate is in score() — best() blocks nothing on its own', () => {
        bb.nsfwAllowed = false;
        const picked = ranker.best([{ clip: nsfwClip(), similarity: 1 }], { name: 'flirt', source: 'user' }, bb);
        expect(picked).toBeNull();
    });
});

describe('variety', () => {
    test('the same intent twice does not give the same clip twice', () => {
        const bb = new Blackboard();
        const antiRepeat = new AntiRepeat(CONFIG.antiRepeatWindow);
        const ranker = new Ranker({ weights: CONFIG.weights, antiRepeat, random: Math.random });

        const seen = new Set();
        for (let i = 0; i < 12; i++) {
            const candidates = selector.topK({ name: 'happy' }, registry, CONFIG.topK);
            const picked = ranker.best(candidates, { name: 'happy', source: 'llm' }, bb, 1000 + i * 60000);
            expect(picked).not.toBeNull();
            seen.add(picked.clip.id);
            antiRepeat.remember(picked.clip.id, 1000 + i * 60000);
        }
        expect(seen.size).toBeGreaterThan(1);
    });

    test('novelty falls for a clip just played and recovers as it ages out', () => {
        const memory = new AntiRepeat(5);
        expect(memory.novelty('a')).toBe(1);
        memory.remember('a');
        expect(memory.novelty('a')).toBeCloseTo(0.1);
        for (const id of ['b', 'c', 'd', 'e']) memory.remember(id);
        expect(memory.novelty('a')).toBeGreaterThan(0.7);
        memory.remember('f');
        expect(memory.novelty('a')).toBe(1); // out of the window entirely
    });

    test('a recent clip is discouraged, never banned', () => {
        // Banning turns a pool of three into a fixed rotation, which reads as a loop too.
        const memory = new AntiRepeat(5);
        memory.remember('a');
        expect(memory.novelty('a')).toBeGreaterThan(0);
    });
});
