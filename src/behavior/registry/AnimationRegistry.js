/**
 * AnimationRegistry — the KB in memory (spec v1.1 §4A).
 *
 * Loads `kb/animations.manifest.jsonl`, drops what it cannot use, and indexes the rest by
 * the three things callers ask for: kind, intent and tag. Nothing here ranks or chooses —
 * it answers "what exists", and B5's selector and ranker decide which of it to play.
 *
 * JSONL rather than JSON is not an accident: one bad line costs one clip, and a manifest
 * that is being edited while the page loads still yields every complete record above the
 * damage.
 *
 * Exposes: window.NEXUS_BD_REGISTRY
 */
const AnimationRegistry = (() => {
    'use strict';

    const validate =
        (typeof window !== 'undefined' && window.NEXUS_BD_VALIDATE) ||
        (typeof require === 'function' ? require('./validate.js') : null);

    class Registry {
        constructor() {
            this.records = [];
            this.byId = new Map();
            this.byKind = new Map();
            this.byIntent = new Map();
            this.byTag = new Map();
            this.rejected = [];
        }

        /**
         * Load from a URL. Any HTTP or parse failure leaves an empty registry and returns
         * it — the engine degrades to procedural behaviour rather than refusing to start.
         */
        async load(url = 'kb/animations.manifest.jsonl', fetchImpl) {
            const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
            if (!doFetch) throw new Error('no fetch available to load the manifest');

            let text = '';
            try {
                const response = await doFetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                text = await response.text();
            } catch (error) {
                console.warn(`[BD] could not load ${url} — running with an empty KB`, error);
                return this;
            }
            return this.loadText(text);
        }

        /** Parse and index a manifest already in hand. Split out so tests need no network. */
        loadText(text) {
            const parsed = [];
            let malformed = 0;

            for (const line of String(text).split('\n')) {
                if (!line.trim()) continue;
                try {
                    parsed.push(JSON.parse(line));
                } catch {
                    malformed++;
                }
            }

            const { records, rejected } = validate.partition(parsed);
            this.records = records;
            this.rejected = rejected;
            this._index();

            if (malformed || rejected.length) {
                console.warn(
                    `[BD] KB loaded with ${malformed} unparseable line(s) and ` +
                        `${rejected.length} unusable record(s); ${records.length} usable`
                );
            }
            return this;
        }

        _index() {
            this.byId = new Map();
            this.byKind = new Map();
            this.byIntent = new Map();
            this.byTag = new Map();

            for (const record of this.records) {
                this.byId.set(record.id, record);
                push(this.byKind, record.kind, record);
                for (const intent of record.intents) push(this.byIntent, intent, record);
                for (const tag of record.tags) push(this.byTag, tag, record);
            }
        }

        get(id) {
            return this.byId.get(id) || null;
        }

        /** Every record answering an intent name. Empty array, never null. */
        forIntent(intent) {
            return this.byIntent.get(intent) || [];
        }

        forTag(tag) {
            return this.byTag.get(tag) || [];
        }

        ofKind(kind) {
            return this.byKind.get(kind) || [];
        }

        /** Counts by kind — what B3's acceptance asks the engine to log on boot. */
        countsByKind() {
            const counts = {};
            for (const [kind, list] of this.byKind) counts[kind] = list.length;
            return Object.fromEntries(Object.entries(counts).sort());
        }

        get size() {
            return this.records.length;
        }

        /** One line, for the boot log and the debug HUD. */
        summary() {
            const counts = this.countsByKind();
            const parts = Object.entries(counts).map(([kind, n]) => `${n} ${kind}`);
            const nsfw = this.records.filter((r) => r.nsfw).length;
            const tail = this.rejected.length ? `, ${this.rejected.length} rejected` : '';
            return `${this.size} clips (${parts.join(', ')}), ${this.byIntent.size} intents, ${nsfw} gated${tail}`;
        }
    }

    function push(map, key, value) {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(value);
    }

    return Registry;
})();

if (typeof window !== 'undefined') window.NEXUS_BD_REGISTRY = AnimationRegistry;
if (typeof module !== 'undefined' && module.exports) module.exports = AnimationRegistry;
