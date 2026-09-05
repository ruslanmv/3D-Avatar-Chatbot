/**
 * validate — runtime record checking for the KB (spec v1.1 §4A).
 *
 * `kb/scripts/validate-manifest.mjs` is the build-time gate and it is strict: it fails CI.
 * This is the runtime one, and it is deliberately **fail-soft**. A manifest that arrives
 * with three bad records at 2am should cost the user three clips, not the whole avatar.
 * Bad records are dropped and counted; the count is logged once, not per record.
 *
 * The checks are the subset that decides whether the engine can *use* a record at all. The
 * schema is the contract; this is the load-bearing part of it.
 *
 * Exposes: window.NEXUS_BD_VALIDATE
 */
const BehaviorValidate = (() => {
    'use strict';

    const KINDS = ['vrma', 'bvh', 'procedural', 'pose'];
    const LAYERS = ['fullBody', 'upperBody', 'face'];
    const QUALITIES = ['production', 'experimental'];

    /**
     * @returns {string|null} why the record is unusable, or null when it is fine.
     */
    function reject(record) {
        if (!record || typeof record !== 'object') return 'not an object';
        if (typeof record.id !== 'string' || !record.id) return 'missing id';
        if (!KINDS.includes(record.kind)) return `bad kind "${record.kind}"`;
        if (!LAYERS.includes(record.layer)) return `bad layer "${record.layer}"`;
        if (!QUALITIES.includes(record.quality)) return `bad quality "${record.quality}"`;

        // A record has to point at something playable, and at exactly one thing.
        const hasFile = typeof record.file === 'string' && record.file.length > 0;
        const hasBehavior = typeof record.behaviorRef === 'string' && record.behaviorRef.length > 0;
        if (record.kind === 'procedural') {
            if (!hasBehavior) return 'procedural record without behaviorRef';
            if (hasFile) return 'procedural record with a file';
        } else if (!hasFile) {
            return `${record.kind} record without a file`;
        }

        if (!Array.isArray(record.tags)) return 'tags is not an array';
        if (!Array.isArray(record.intents)) return 'intents is not an array';
        if (!inRange(record.valence, -1, 1)) return `valence ${record.valence} out of range`;
        if (!inRange(record.energy, 0, 1)) return `energy ${record.energy} out of range`;
        if (typeof record.nsfw !== 'boolean') return 'nsfw is not a boolean';

        return null;
    }

    function inRange(value, min, max) {
        return Number.isFinite(value) && value >= min && value <= max;
    }

    /**
     * Split a batch into what the engine can use and what it cannot.
     * @returns {{records: object[], rejected: {id: string, why: string}[]}}
     */
    function partition(records) {
        const ok = [];
        const rejected = [];
        for (const record of records || []) {
            const why = reject(record);
            if (why) rejected.push({ id: record && record.id ? record.id : '(no id)', why });
            else ok.push(record);
        }
        return { records: ok, rejected };
    }

    return { reject, partition, KINDS, LAYERS, QUALITIES };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_VALIDATE = BehaviorValidate;
if (typeof module !== 'undefined' && module.exports) module.exports = BehaviorValidate;
