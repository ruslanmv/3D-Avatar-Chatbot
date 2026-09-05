#!/usr/bin/env node
/**
 * build-embeddings — turns the KB's prose into vectors the Tier-1 selector can search.
 *
 * ## Why this is not MiniLM yet
 *
 * Spec §4A names transformers.js MiniLM. This repo has no bundler, no build step and no npm
 * dependency for it, and `package.json` is not on the §7 allowlist — adding a dependency
 * here would be a spec violation dressed up as a build detail. PATHMAP already records
 * "where the MiniLM worker lives given no bundler" as a **B5** decision, and B5 is the
 * batch that owns the runtime worker.
 *
 * So this builds a deterministic lexical index instead, and writes the model name into
 * `index.meta.json` so nothing downstream has to guess what it is reading. When B5 lands
 * the worker it regenerates the same files with a real sentence encoder; the file format,
 * the row↔id map and the `search()` API are the contract, not the model behind them.
 *
 * ## The model: bootstrap-lexical-v1
 *
 * TF-IDF over an **explicit vocabulary**, not a hashing vectoriser. With 166 documents the
 * whole vocabulary is a few thousand terms, so there is no reason to accept collisions —
 * and the collisions were not a rounding error. Hashed into 512 buckets, "sit down quietly"
 * returned a jump and then three angry clips: every bucket was occupied, so query words
 * that matched nothing still landed somewhere and scored. Raising the bucket count and
 * zeroing empty buckets both helped and neither fixed it. With an explicit vocabulary a
 * term the corpus does not contain contributes exactly zero, which is what it should
 * contribute.
 *
 * Each record's text becomes unigrams, adjacent bigrams and 4-character shingles of longer
 * tokens — the shingles are what let "celebration" find a clip tagged "celebrate" without a
 * stemmer. Tags and intents are weighted above prose, because a query usually looks like a
 * tag. Vectors are L2-normalised so cosine similarity is a dot product.
 *
 * Deterministic by construction: same manifest in, identical bytes out.
 *
 * Artefacts (all generated — never hand-edit):
 *   index.f32        count × dims Float32 matrix, row order matches meta.rows
 *   index.vocab.tsv  `term<TAB>idf`, one line per column, in column order
 *   index.meta.json  model, dims, count, row↔id map, manifest hash
 *
 * Usage:
 *   node kb/scripts/build-embeddings.mjs                              # report
 *   node kb/scripts/build-embeddings.mjs --write                      # write the index
 *   node kb/scripts/build-embeddings.mjs --search "celebration dance" # query it
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MANIFEST = 'kb/animations.manifest.jsonl';
const OUT_DIR = 'kb/embeddings';
const VECTORS = `${OUT_DIR}/index.f32`;
const VOCAB = `${OUT_DIR}/index.vocab.tsv`;
const META = `${OUT_DIR}/index.meta.json`;

export const MODEL = 'bootstrap-lexical-v1';

/** How much louder a tag or an intent is than a word of prose. */
const FIELD_WEIGHTS = { description: 1, tags: 3, intents: 3 };

/** Words that carry no retrieval signal in this corpus. */
const STOPWORDS = new Set(
    (
        'a an and the of to at in on with into over under through from by for as is are be ' +
        'her his its it this that then than out up down off across between both very ' +
        'while during after before one two three second third fourth take recorded'
    ).split(' ')
);

// ── text → features ──────────────────────────────────────────────────────────

/** Split text into lowercase word tokens, stopwords removed. */
function tokenize(text) {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/**
 * Features for one piece of text: the tokens, adjacent bigrams, and 4-character shingles of
 * the longer tokens. The shingles are the reason "celebration" retrieves a clip tagged
 * "celebrate" — a stemmer would do it more precisely and much less robustly.
 */
export function features(text) {
    const tokens = tokenize(text);
    const out = [];

    for (const token of tokens) {
        out.push(token);
        if (token.length >= 6) {
            for (let i = 0; i + 4 <= token.length; i++) out.push(`#${token.slice(i, i + 4)}`);
        }
    }
    for (let i = 1; i < tokens.length; i++) out.push(`${tokens[i - 1]}_${tokens[i]}`);

    return out;
}

function fieldsOf(record) {
    return {
        description: record.description,
        tags: record.tags.join(' '),
        intents: record.intents.join(' '),
    };
}

/** Weighted feature counts for one record, keyed by term. */
function countTerms(fields) {
    const counts = new Map();
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
        for (const feature of features(fields[field] || '')) {
            counts.set(feature, (counts.get(feature) || 0) + weight);
        }
    }
    return counts;
}

/** Sublinear term frequency — a word said five times is not five times as relevant. */
function sublinear(count) {
    return count > 0 ? 1 + Math.log(count) : 0;
}

function l2normalize(vector) {
    let sum = 0;
    for (const value of vector) sum += value * value;
    const norm = Math.sqrt(sum);
    if (norm > 0) for (let i = 0; i < vector.length; i++) vector[i] /= norm;
    return vector;
}

// ── the index ────────────────────────────────────────────────────────────────

function readManifest() {
    return readFileSync(join(ROOT, MANIFEST), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

/** Build the vocabulary, the IDF weights, the matrix and the metadata. */
export function build(records = readManifest()) {
    const perRecord = records.map((record) => countTerms(fieldsOf(record)));

    // Vocabulary in sorted order, so the column layout is reproducible.
    const df = new Map();
    for (const counts of perRecord) {
        for (const term of counts.keys()) df.set(term, (df.get(term) || 0) + 1);
    }
    const vocabulary = [...df.keys()].sort();
    const column = new Map(vocabulary.map((term, i) => [term, i]));
    const dims = vocabulary.length;

    const idf = new Float32Array(dims);
    vocabulary.forEach((term, i) => {
        idf[i] = Math.log((1 + records.length) / (1 + df.get(term))) + 1;
    });

    const vectors = new Float32Array(records.length * dims);
    perRecord.forEach((counts, row) => {
        const dense = new Float64Array(dims);
        for (const [term, count] of counts) {
            const i = column.get(term);
            dense[i] = sublinear(count) * idf[i];
        }
        l2normalize(dense);
        for (let i = 0; i < dims; i++) vectors[row * dims + i] = dense[i];
    });

    const manifestSha256 = createHash('sha256')
        .update(readFileSync(join(ROOT, MANIFEST)))
        .digest('hex');

    return {
        vectors,
        vocabulary,
        idf,
        meta: {
            $comment:
                'Generated by kb/scripts/build-embeddings.mjs — do not hand-edit. index.f32 is a ' +
                'count x dims Float32 matrix in the row order below; index.vocab.tsv holds the ' +
                'term and IDF weight for each column, which is what a query needs to be embedded ' +
                'into the same space.',
            model: MODEL,
            dims,
            count: records.length,
            manifestSha256,
            tokenizer: 'lowercase words, adjacent bigrams, 4-char shingles of tokens >= 6 chars',
            fieldWeights: FIELD_WEIGHTS,
            rows: records.map((record) => record.id),
        },
    };
}

/**
 * Embed a free-text query into the same space.
 *
 * A term the corpus does not contain is simply absent from the vocabulary and contributes
 * nothing — no column, no weight, no accidental score.
 */
export function embedQuery(text, vocabulary, idf) {
    const column = vocabulary instanceof Map ? vocabulary : new Map(vocabulary.map((t, i) => [t, i]));
    const counts = countTerms({ description: text, tags: text, intents: text });
    const vector = new Float64Array(idf.length);

    for (const [term, count] of counts) {
        const i = column.get(term);
        if (i !== undefined) vector[i] = sublinear(count) * idf[i];
    }
    return l2normalize(vector);
}

/** Load the built index from disk. */
export function loadIndex() {
    const meta = JSON.parse(readFileSync(join(ROOT, META), 'utf8'));
    const raw = readFileSync(join(ROOT, VECTORS));
    const vectors = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const vocabulary = [];
    const idf = new Float32Array(meta.dims);

    readFileSync(join(ROOT, VOCAB), 'utf8')
        .split('\n')
        .filter(Boolean)
        .forEach((line, i) => {
            const tab = line.lastIndexOf('\t');
            vocabulary.push(line.slice(0, tab));
            idf[i] = Number(line.slice(tab + 1));
        });

    return { meta, vectors, vocabulary, idf };
}

/**
 * Cosine top-k. Vectors are L2-normalised, so this is a dot product — the brute-force scan
 * §9 budgets at well under a millisecond for a corpus this size. Only the query's non-zero
 * columns are visited, which is a handful of terms rather than the whole vocabulary.
 */
export function search(query, k = 5, index = loadIndex()) {
    const { meta, vectors, vocabulary, idf } = index;
    const q = embedQuery(query, vocabulary, idf);

    const active = [];
    for (let i = 0; i < meta.dims; i++) if (q[i] !== 0) active.push(i);

    const scored = [];
    for (let row = 0; row < meta.count; row++) {
        const base = row * meta.dims;
        let score = 0;
        for (const i of active) score += q[i] * vectors[base + i];
        scored.push({ id: meta.rows[row], score });
    }

    return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, k);
}

// ── main ─────────────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);

    if (args.includes('--search')) {
        const query = args[args.indexOf('--search') + 1];
        console.log(`search: ${JSON.stringify(query)}\n`);
        for (const hit of search(query, 8)) console.log(`  ${hit.score.toFixed(4)}  ${hit.id}`);
        return;
    }

    const records = readManifest();
    const { vectors, vocabulary, idf, meta } = build(records);

    console.log(`model     : ${meta.model}`);
    console.log(`vocabulary: ${meta.dims} terms`);
    console.log(`vectors   : ${meta.count} x ${meta.dims} (${(vectors.byteLength / 1024 / 1024).toFixed(2)} MB)`);

    if (args.includes('--write')) {
        mkdirSync(join(ROOT, OUT_DIR), { recursive: true });
        writeFileSync(join(ROOT, VECTORS), Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength));
        writeFileSync(join(ROOT, VOCAB), vocabulary.map((term, i) => `${term}\t${idf[i]}`).join('\n') + '\n');
        writeFileSync(join(ROOT, META), JSON.stringify(meta, null, 2) + '\n');
        console.log(`\nwrote ${VECTORS}, ${VOCAB} and ${META}`);
    } else {
        console.log('\ndry run — pass --write to update the index');
    }
}

if (process.argv[1] && process.argv[1].endsWith('build-embeddings.mjs')) main();
