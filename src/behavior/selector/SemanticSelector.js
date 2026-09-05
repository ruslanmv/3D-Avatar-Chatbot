/**
 * SemanticSelector — Tier 1, intent to candidates (spec v1.1 §4A, §9).
 *
 * ## Why there is no worker here yet
 *
 * §4A specifies a MiniLM worker. B2 explains why the index is `bootstrap-lexical-v1`
 * instead: no bundler, and `package.json` is not on the §7 allowlist. A lexical model needs
 * no worker — scoring 166 sparse vectors is a few hundred multiplications, far inside the
 * §9 budget of 50 ms, and moving that off-thread would cost more in postMessage latency
 * than it saves. The worker arrives with the model that needs it.
 *
 * ## Why it recomputes rather than downloading the matrix
 *
 * `kb/embeddings/index.f32` is 2.3 MB of mostly zeros — fine to ship, wasteful to load onto
 * a Quest. The client instead loads the vocabulary and its IDF weights (small), and builds
 * the same vectors from the manifest the registry already has in memory. Same vocabulary,
 * same IDF, same formula, so the result is the offline index to floating-point tolerance —
 * and there is a test that asserts exactly that against the shipped matrix, because two
 * implementations of one formula is precisely the kind of thing that drifts.
 *
 * Exposes: window.NEXUS_BD_SELECTOR
 */
const SemanticSelector = (() => {
    'use strict';

    const VOCAB_URL = 'kb/embeddings/index.vocab.tsv';

    /** Kept in step with kb/scripts/build-embeddings.mjs — the parity test binds them. */
    const FIELD_WEIGHTS = { description: 1, tags: 3, intents: 3 };

    const STOPWORDS = new Set(
        (
            'a an and the of to at in on with into over under through from by for as is are be ' +
            'her his its it this that then than out up down off across between both very ' +
            'while during after before one two three second third fourth take recorded'
        ).split(' ')
    );

    function tokenize(text) {
        return String(text)
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((token) => token.length > 1 && !STOPWORDS.has(token));
    }

    function features(text) {
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

    function countTerms(fields) {
        const counts = new Map();
        for (const field of Object.keys(FIELD_WEIGHTS)) {
            for (const feature of features(fields[field] || '')) {
                counts.set(feature, (counts.get(feature) || 0) + FIELD_WEIGHTS[field]);
            }
        }
        return counts;
    }

    const sublinear = (count) => (count > 0 ? 1 + Math.log(count) : 0);

    /** Sparse vectors: `{index: weight}` pairs, L2-normalised. Most terms are absent. */
    function sparseVector(counts, column, idf) {
        const entries = [];
        let sum = 0;
        for (const [term, count] of counts) {
            const i = column.get(term);
            if (i === undefined) continue;
            const value = sublinear(count) * idf[i];
            entries.push([i, value]);
            sum += value * value;
        }
        const norm = Math.sqrt(sum);
        if (norm > 0) for (const entry of entries) entry[1] /= norm;
        return entries;
    }

    class Selector {
        constructor() {
            this.column = new Map();
            this.idf = [];
            this.vectors = new Map(); // id → sparse entries
            this.ready = false;
        }

        /** Load the shipped vocabulary. Without it the selector stays unready and empty. */
        async loadVocabulary(url = VOCAB_URL, fetchImpl) {
            const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
            if (!doFetch) return this;
            try {
                const response = await doFetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return this.loadVocabularyText(await response.text());
            } catch (error) {
                console.warn(`[BD] no embedding vocabulary at ${url} — Tier 1 will fall back`, error);
                return this;
            }
        }

        loadVocabularyText(text) {
            this.column = new Map();
            this.idf = [];
            let i = 0;
            for (const line of String(text).split('\n')) {
                if (!line) continue;
                const tab = line.lastIndexOf('\t');
                if (tab < 0) continue;
                this.column.set(line.slice(0, tab), i);
                this.idf.push(Number(line.slice(tab + 1)));
                i++;
            }
            return this;
        }

        /** Build a vector per record. Cheap enough to do at boot for the whole KB. */
        index(records) {
            this.vectors = new Map();
            for (const record of records || []) {
                const counts = countTerms({
                    description: record.description,
                    tags: (record.tags || []).join(' '),
                    intents: (record.intents || []).join(' '),
                });
                this.vectors.set(record.id, sparseVector(counts, this.column, this.idf));
            }
            this.ready = this.column.size > 0 && this.vectors.size > 0;
            return this;
        }

        /** Embed a free-text query into the same space. */
        embedQuery(text) {
            return sparseVector(countTerms({ description: text, tags: text, intents: text }), this.column, this.idf);
        }

        /** Cosine similarity between a query vector and one record. */
        similarity(queryEntries, id) {
            const target = this.vectors.get(id);
            if (!target || !queryEntries.length) return 0;
            // Both are short; walking the query and probing a small map is faster than a
            // merge for vectors this sparse.
            const lookup = new Map(target);
            let dot = 0;
            for (const [i, value] of queryEntries) {
                const other = lookup.get(i);
                if (other !== undefined) dot += value * other;
            }
            return dot;
        }

        /**
         * Candidates for an intent, best first.
         *
         * The intent name narrows the field first — a KB record declares which intents it
         * answers, and honouring that is both faster and more correct than letting a text
         * search decide. Similarity then orders what is left. When nothing declares the
         * intent, the whole KB is searched by text, which is how an intent the KB has never
         * seen still finds something reasonable.
         */
        topK(intent, registry, k = 3) {
            const name = intent && intent.name;
            if (!name || !registry) return [];

            const declared = registry.forIntent(name);
            const pool = declared.length ? declared : registry.records;
            if (!this.ready) {
                // No vocabulary: fall back to declaration order. Degraded, not broken.
                return pool.slice(0, k).map((clip) => ({ clip, similarity: declared.length ? 1 : 0 }));
            }

            const query = this.embedQuery(`${name} ${intent.query || ''}`);
            const scored = pool.map((clip) => ({ clip, similarity: this.similarity(query, clip.id) }));
            scored.sort((a, b) => b.similarity - a.similarity || a.clip.id.localeCompare(b.clip.id));
            return scored.slice(0, k);
        }
    }

    return { Selector, features, tokenize, FIELD_WEIGHTS };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_SELECTOR = SemanticSelector;
if (typeof module !== 'undefined' && module.exports) module.exports = SemanticSelector;
