/**
 * PosePublisher — "Publish to KB" from Pose Studio (spec v1.1 UC-11).
 *
 * A saved pose becomes a `kind:"pose"` KB record, selectable by the same brain that picks
 * every other clip. That is the whole feature: the poses a user builds stop being a private
 * list and become part of the vocabulary she can reach for.
 *
 * ## Where a published pose actually lives
 *
 * `kb/animations.manifest.jsonl` is a build artefact — a browser cannot write it. So a
 * published pose goes to localStorage and the registry merges it over the shipped manifest
 * at load. The consequences are worth stating rather than discovering:
 *
 *   - published poses are **per-browser**, not shared, until someone exports them;
 *   - they cannot collide with a shipped record, because their ids are namespaced `pose_`;
 *   - they go through the same runtime validator as everything else, so a malformed pose is
 *     dropped at load rather than reaching the ranker.
 *
 * Exposes: window.NEXUS_BD_POSE_PUBLISHER
 */
const PosePublisher = (() => {
    'use strict';

    const STORAGE_KEY = 'nexus_bd_published_poses';

    const validate =
        (typeof window !== 'undefined' && window.NEXUS_BD_VALIDATE) ||
        (typeof require === 'function' ? require('./validate.js') : null);

    /** Turn a Pose Studio pose into a KB record. */
    function toRecord(pose, { tags = [], intents = [] } = {}) {
        if (!pose || !pose.id) return null;
        const slug = String(pose.id)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        const name = pose.name || pose.id;

        return {
            id: `pose_user_${slug}`,
            kind: 'pose',
            file: `pose://${pose.id}`,
            description: `${name} — a pose saved in Pose Studio; held rather than played, at whatever tempo it is faded in. Published by the user.`,
            tags: [...new Set(['pose', 'user', ...tags])].sort(),
            intents: [...new Set(['pose', ...intents])].sort(),
            valence: 0,
            energy: 0,
            stats: { duration: null, rootMotion: 0, meanJointVel: null },
            layer: 'fullBody',
            loop: false,
            priority: 3,
            interruptible: true,
            cooldownMs: 8000,
            /** A user pose is never adult content: the tier is gated on verified behaviours. */
            nsfw: false,
            quality: 'experimental',
            retarget: 'Authored in Pose Studio on one avatar; not checked against others.',
            source: 'pose-studio',
            license: 'user',
            version: 1,
        };
    }

    function read(storage) {
        const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        if (!store) return [];
        try {
            const parsed = JSON.parse(store.getItem(STORAGE_KEY) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function write(records, storage) {
        const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        if (!store) return false;
        try {
            store.setItem(STORAGE_KEY, JSON.stringify(records));
            return true;
        } catch (error) {
            console.warn('[BD] could not store the published pose', error);
            return false;
        }
    }

    /**
     * Publish one pose.
     * @returns {{ok: boolean, record?: object, why?: string}}
     */
    function publish(pose, options = {}) {
        const record = toRecord(pose, options);
        if (!record) return { ok: false, why: 'not a pose' };

        const why = validate.reject(record);
        if (why) return { ok: false, why };

        const existing = read(options.storage).filter((entry) => entry.id !== record.id);
        existing.push(record);
        if (!write(existing, options.storage)) return { ok: false, why: 'storage refused' };

        // Publishing means "selectable now", not "selectable after a reload", so the live
        // registry is updated here. Doing it here rather than at the call site keeps Pose
        // Studio to one engine call and stops a UI panel reaching into the KB itself.
        const registry = options.registry || (typeof window !== 'undefined' ? window.NEXUS_BD?.registry : null);
        if (registry && typeof registry.addRecord === 'function') registry.addRecord(record);

        return { ok: true, record };
    }

    function unpublish(id, options = {}) {
        const remaining = read(options.storage).filter((entry) => entry.id !== id);
        return write(remaining, options.storage);
    }

    /** Everything published in this browser, validated. Used by the registry at load. */
    function published(options = {}) {
        return validate.partition(read(options.storage)).records;
    }

    return { publish, unpublish, published, toRecord, STORAGE_KEY };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_POSE_PUBLISHER = PosePublisher;
if (typeof module !== 'undefined' && module.exports) module.exports = PosePublisher;
