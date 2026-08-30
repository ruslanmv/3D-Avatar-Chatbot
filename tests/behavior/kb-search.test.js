/**
 * The KB's semantic half — the content that decides which clip comes back, and the index
 * that makes it findable.
 *
 * B2's acceptance is two sentences: `search("energetic celebration dance")` returns a dance
 * in the top three, and a rebuild reproduces identical bytes. Both are here, along with the
 * checks that make those two facts mean something — that the descriptions are real prose,
 * that every whitelisted emote actually resolves to a clip, and that the adult behaviours
 * agree with the one place adult content is declared.
 */

/* global describe, test, expect, beforeAll */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST = path.join(ROOT, 'kb', 'animations.manifest.jsonl');
const EMBEDDINGS = path.join(ROOT, 'kb', 'embeddings');
const CONFIG = path.join(ROOT, 'config', 'behavior.config.json');

function readManifest() {
    return fs
        .readFileSync(MANIFEST, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function runScript(script, args = []) {
    return execFileSync('node', [path.join('kb', 'scripts', script), ...args], {
        cwd: ROOT,
        encoding: 'utf8',
    });
}

/** Ranked ids for a query, straight from the CLI the ranker will later call in-process. */
function search(query) {
    return runScript('build-embeddings.mjs', ['--search', query])
        .split('\n')
        .map((line) => line.trim().match(/^([\d.]+)\s+(\S+)$/))
        .filter(Boolean)
        .map((match) => ({ score: Number(match[1]), id: match[2] }));
}

describe('descriptions', () => {
    let records;

    beforeAll(() => {
        records = readManifest();
    });

    test('every record has real prose, not a placeholder', () => {
        const thin = records.filter((r) => !r.description || r.description.trim().length < 40);
        expect(thin.map((r) => r.id)).toEqual([]);
    });

    test('each one follows the action + body focus + tempo + emotion formula', () => {
        // The em dash separates the action from the body focus; the semicolon introduces
        // the measured tempo; the final sentence is the emotional read.
        for (const record of records) {
            expect(record.description).toMatch(/^[A-Z].+ — .+; .+\. [A-Z].+\.$/);
        }
    });

    test('takes of the same motion read differently, so anti-repeat has something to use', () => {
        const byDescription = new Map();
        for (const record of records) {
            byDescription.set(record.description, (byDescription.get(record.description) || 0) + 1);
        }
        const duplicated = [...byDescription.entries()].filter(([, count]) => count > 1);
        expect(duplicated).toEqual([]);
    });

    test('valence and energy are inside the ranges the ranker assumes', () => {
        for (const record of records) {
            expect(record.valence).toBeGreaterThanOrEqual(-1);
            expect(record.valence).toBeLessThanOrEqual(1);
            expect(record.energy).toBeGreaterThanOrEqual(0);
            expect(record.energy).toBeLessThanOrEqual(1);
        }
    });

    test('energy tracks the measurement rather than the label', () => {
        const byId = new Map(records.map((r) => [r.id, r]));
        // Three takes of the same joy capture, measured at genuinely different tempos.
        // If these ever collapse to one number, the energy term in §6.5 stops doing work.
        const joys = ['bvh_emotion_joy', 'bvh_emotion_joy2', 'bvh_emotion_joy3'].map((id) => byId.get(id).energy);
        expect(new Set(joys).size).toBe(3);
        // And a dance out-energies an idle, which is the least a measurement should manage.
        expect(byId.get('bvh_dance_dance_1').energy).toBeGreaterThan(byId.get('bvh_idle_neutral').energy);
    });

    test('the semantic validation level passes', () => {
        expect(runScript('validate-manifest.mjs', ['--level', 'semantic'])).toContain('OK —');
    });
});

describe('intents cover the tag contract', () => {
    test('every whitelisted emote resolves to at least one clip', () => {
        // §6.8 tells the model these names are available. One with nothing behind it in the
        // KB is a dead intent: the tag parses, the ranker finds nothing, and she does not
        // move — silently, which is the worst way for this to fail.
        const whitelist = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).emoteWhitelist;
        const records = readManifest();
        const unresolved = whitelist.filter((emote) => !records.some((r) => r.intents.includes(emote)));
        expect(unresolved).toEqual([]);
    });

    test('every record is reachable by at least one intent', () => {
        const orphaned = readManifest().filter((r) => !r.intents.length);
        expect(orphaned.map((r) => r.id)).toEqual([]);
    });
});

describe('adult content agrees with the one place it is declared', () => {
    test('exactly the behaviours AnimationPresets marks adult are nsfw', () => {
        const nsfw = readManifest()
            .filter((r) => r.nsfw)
            .map((r) => r.behaviorRef)
            .sort();
        expect(nsfw).toEqual(['beckon', 'flirt', 'intimate', 'sensualSway', 'slowBurn', 'tease'].sort());
    });

    test('no clip is nsfw — only behaviours are gated', () => {
        const clips = readManifest().filter((r) => r.kind !== 'procedural' && r.nsfw);
        expect(clips.map((r) => r.id)).toEqual([]);
    });

    test('the validator rejects a manifest that disagrees with AnimationPresets', () => {
        const os = require('os');
        const records = readManifest();
        records.find((r) => r.behaviorRef === 'flirt').nsfw = false;
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-')), 'broken.jsonl');
        fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
        try {
            expect(() => runScript('validate-manifest.mjs', ['--manifest', file])).toThrow(/adult=true/);
        } finally {
            fs.rmSync(path.dirname(file), { recursive: true, force: true });
        }
    });
});

describe('search', () => {
    test('"energetic celebration dance" returns a dance in the top three', () => {
        const top3 = search('energetic celebration dance').slice(0, 3);
        expect(top3.some((hit) => hit.id.includes('dance'))).toBe(true);
    });

    test('the queries the activities will actually ask', () => {
        // One assertion per shape of question the engine has to answer: a posture, a
        // greeting, a mood, a workout, and the adult tier's own vocabulary.
        const cases = [
            ['sit down quietly', /sit_idle/],
            ['wave hello', /waving|greeting/],
            ['sad and withdrawn', /sadness|remorse|grief|sad/],
            ['count my reps workout', /exercise|jumpingjacks/],
            ['slow sensual movement', /sensualsway/],
        ];
        for (const [query, expected] of cases) {
            const top3 = search(query).slice(0, 3);
            expect(top3.map((h) => h.id).join(' ')).toMatch(expected);
        }
    });

    test('a query the corpus knows nothing about scores far below one it does', () => {
        // Not zero, and it should not be: the shingles that let "celebration" find
        // "celebrate" also let "parliament" share four characters with "movement". What
        // the explicit vocabulary buys is that the nonsense cannot rank *confidently* —
        // there is no whole term behind it, only fragments.
        const nonsense = search('xylophone quaternion parliament')[0].score;
        const real = search('energetic celebration dance')[0].score;
        expect(nonsense).toBeLessThan(real / 3);
    });
});

describe('the index is reproducible', () => {
    test('a rebuild reproduces every artefact byte for byte', () => {
        const before = ['index.f32', 'index.vocab.tsv', 'index.meta.json'].map((name) => [
            name,
            fs.readFileSync(path.join(EMBEDDINGS, name)),
        ]);
        runScript('build-embeddings.mjs', ['--write']);
        for (const [name, bytes] of before) {
            expect(`${name}: ${fs.readFileSync(path.join(EMBEDDINGS, name)).equals(bytes)}`).toBe(`${name}: true`);
        }
    });

    test('the index names the model it was built with and the manifest it came from', () => {
        const crypto = require('crypto');
        const meta = JSON.parse(fs.readFileSync(path.join(EMBEDDINGS, 'index.meta.json'), 'utf8'));
        expect(meta.model).toBe('bootstrap-lexical-v1');
        expect(meta.manifestSha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(MANIFEST)).digest('hex'));
    });

    test('the matrix, the vocabulary and the row map agree on their dimensions', () => {
        const meta = JSON.parse(fs.readFileSync(path.join(EMBEDDINGS, 'index.meta.json'), 'utf8'));
        const vectorBytes = fs.statSync(path.join(EMBEDDINGS, 'index.f32')).size;
        const vocabLines = fs
            .readFileSync(path.join(EMBEDDINGS, 'index.vocab.tsv'), 'utf8')
            .split('\n')
            .filter(Boolean).length;

        expect(meta.rows).toHaveLength(meta.count);
        expect(meta.rows).toEqual(readManifest().map((r) => r.id));
        expect(vocabLines).toBe(meta.dims);
        expect(vectorBytes).toBe(meta.count * meta.dims * 4);
    });
});
