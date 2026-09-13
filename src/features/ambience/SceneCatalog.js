/**
 * The scene library: one list, whatever a scene came from (batch A17).
 *
 * Until now "the scenes" meant the ten entries in `assets/ambient/backgrounds.json`, and the
 * Settings grid read them straight out of `ViewportBackgroundCatalog`. That works exactly as long
 * as there is one source. The moment a person can import a scene, or 3D-Ambience-Studio can
 * publish one, "the scenes" becomes a merge — and every consumer that reads one source has to
 * learn about the others: the grid, the resolver's vocabulary, the controller, the capability
 * suffix. This is the layer that keeps them from having to.
 *
 *     built-in ─┐
 *     imported ─┼─► SceneCatalog ─► grid · resolver · controller
 *     Studio   ─┘
 *
 * ## Why a trust level on every entry
 *
 * A scene manifest in this app is not only pictures. `scene-journey.js` lets one carry a
 * `profileOverlay` — `idleProfile`, `commentaryOpenings`, `initiative`, `attention`, `allowNsfw`
 * — and a `guidedScript`. Those are *behaviour*: how often she speaks first, what she is willing
 * to discuss, what she says unprompted. That is a reasonable thing for a manifest shipped inside
 * the application to set, and an unreasonable thing for a ZIP somebody downloaded to set.
 *
 * So a source declares its trust and the normaliser enforces it:
 *
 *     trust 'system'        the whole manifest, behaviour included
 *     trust 'user-content'  pictures, lighting, audio, placement, tags — behaviour stripped
 *
 * Stripped rather than rejected, deliberately. A pack whose author put a `profileOverlay` in it
 * is not necessarily hostile — it may have been exported from a built-in scene — and refusing the
 * whole scene would lose ten good megabytes of artwork over one field nobody will miss. The
 * removal is reported so an importer can say what it did.
 *
 * This lands before the import path it protects, which is the point: the boundary is cheaper to
 * build while there is nothing on the wrong side of it, and an import feature that arrives first
 * tends to arrive without one.
 *
 * ## Why paths are not re-validated here
 *
 * They are validated, but by `ViewportBackgroundCatalog.isSafeRelativePath` — the same function,
 * not a copy of the rule. Two implementations of "is this path safe" is how one of them ends up
 * being the lenient one. If that module is absent this catalogue accepts nothing at all, which is
 * the correct direction to fail for a check whose whole job is refusing things.
 *
 * Exposes: window.NEXUS_SCENE_CATALOG
 */
(function (global) {
    'use strict';

    /** What a source is allowed to bring with it. */
    const TRUST = Object.freeze({
        SYSTEM: 'system',
        USER: 'user-content',
    });

    /**
     * The fields an untrusted manifest loses.
     *
     * `profileOverlay` and `guidedScript` are the two top-level doors into assistant behaviour —
     * see `OVERLAY_FIELDS` in the scene-journey activity, which is the list this one exists to
     * keep out of reach. Adding a third behavioural field to a manifest
     * means adding it here in the same change.
     */
    const BEHAVIOUR_FIELDS = Object.freeze(['profileOverlay', 'guidedScript']);

    /** Ordered, so the library shows built-ins before anything added later. */
    const SOURCE_ORDER = Object.freeze(['builtin', 'imported', 'studio']);

    const sources = new Map();
    const listeners = new Set();

    function pathValidator() {
        const catalog = global && global.NEXUS_VIEWPORT_BACKGROUND_CATALOG;
        if (catalog && typeof catalog.isSafeRelativePath === 'function') return catalog.isSafeRelativePath;
        return null;
    }

    function isSafePath(value) {
        const validate = pathValidator();
        // No validator, no scenes. See the header: the one check that must never be approximated.
        return validate ? validate(value) : false;
    }

    function cleanTags(raw) {
        if (!Array.isArray(raw)) return [];
        const out = [];
        for (const tag of raw) {
            if (typeof tag !== 'string') continue;
            const t = tag.trim().toLowerCase();
            if (t && /^[a-z0-9][a-z0-9-]*$/.test(t) && !out.includes(t)) out.push(t);
        }
        return out;
    }

    /**
     * Take the behaviour out of a manifest that is not entitled to carry it.
     *
     * Returns the manifest and what was removed, rather than a boolean, because an importer that
     * cannot say *what* it dropped leaves the author guessing why their pack behaves differently
     * here than it did where they made it.
     */
    function applyTrust(manifest, trust) {
        const removed = [];
        if (!manifest || typeof manifest !== 'object') return { manifest, removed };
        if (trust === TRUST.SYSTEM) return { manifest, removed };

        const out = {};
        for (const key of Object.keys(manifest)) {
            if (BEHAVIOUR_FIELDS.includes(key)) {
                // Only count a field that was actually carrying something. A manifest with
                // `guidedScript: null` — which every built-in has — did not try to do anything,
                // and reporting it as stripped would make a clean import look suspicious.
                if (manifest[key] !== null && manifest[key] !== undefined) removed.push(key);
                continue;
            }
            out[key] = manifest[key];
        }
        return { manifest: out, removed };
    }

    /**
     * One catalogue entry, checked. `{ entry }` or `{ reason }` — never a throw.
     *
     * The same posture as the viewport catalogue and the scene-journey registry: one bad entry in
     * an imported pack costs that entry, not the other nine.
     */
    function normalizeEntry(raw, trust, sourceName) {
        if (!raw || typeof raw !== 'object') return { reason: 'not an object' };
        if (typeof raw.id !== 'string' || !raw.id.trim()) return { reason: 'id must be a non-empty string' };
        if (typeof raw.label !== 'string' || !raw.label.trim()) return { reason: 'label must be a non-empty string' };
        if (raw.type !== 'image') return { reason: `type must be "image" (got ${JSON.stringify(raw.type)})` };
        if (!isSafePath(raw.src)) return { reason: `src is not a safe relative path: ${JSON.stringify(raw.src)}` };

        const thumb = isSafePath(raw.thumb) ? raw.thumb : raw.src;
        const { removed } = applyTrust(raw, trust);

        return {
            entry: Object.freeze({
                id: raw.id.trim(),
                type: 'image',
                label: raw.label.trim(),
                variantLabel: typeof raw.variantLabel === 'string' ? raw.variantLabel.trim() : '',
                src: raw.src,
                thumb,
                focalPoint: typeof raw.focalPoint === 'string' ? raw.focalPoint : 'center',
                intensity: typeof raw.intensity === 'number' ? raw.intensity : 1,
                category: typeof raw.category === 'string' ? raw.category : '',
                tags: Object.freeze(cleanTags(raw.tags)),
                source: sourceName,
                trust,
                strippedFields: Object.freeze(removed),
            }),
        };
    }

    function notify() {
        for (const listener of Array.from(listeners)) {
            try {
                listener(list());
            } catch (error) {
                // A listener that throws must not stop the others from hearing about a scene
                // that has just appeared — the grid and the resolver both listen.
                console.warn('[SceneCatalog] listener failed:', error);
            }
        }
    }

    /**
     * Put a source's scenes in the library, replacing whatever that source had before.
     *
     * Wholesale replacement rather than merging: a source is the authority on its own contents,
     * and an import that removed a scene must be able to say so.
     */
    function registerSource(name, options) {
        const trust = options && options.trust === TRUST.SYSTEM ? TRUST.SYSTEM : TRUST.USER;
        const raw = (options && options.scenes) || [];
        const accepted = [];
        const rejected = [];
        const seen = new Set();

        for (const candidate of Array.isArray(raw) ? raw : []) {
            const result = normalizeEntry(candidate, trust, name);
            if (result.reason) {
                rejected.push({ id: candidate && candidate.id, reason: result.reason });
                continue;
            }
            if (seen.has(result.entry.id)) {
                // Two entries with one id means one can never be selected, and which one wins
                // would depend on iteration order.
                rejected.push({ id: result.entry.id, reason: 'duplicate id within this source' });
                continue;
            }
            seen.add(result.entry.id);
            accepted.push(result.entry);
        }

        sources.set(name, { name, trust, scenes: accepted });
        for (const { reason, id } of rejected) console.warn(`[SceneCatalog] ${name}: dropped ${id}: ${reason}`);
        notify();
        return { accepted: accepted.length, rejected };
    }

    function removeSource(name) {
        const had = sources.delete(name);
        if (had) notify();
        return had;
    }

    /**
     * Pull the built-in scenes out of the viewport catalogue.
     *
     * Called rather than imported at load time: `src/gltf-viewer/ambience/` is loaded by
     * index.html and this file by `boot.js`, and the catalogue's own entries arrive later still,
     * from a fetch. Whoever notices the data has landed calls this.
     */
    function adoptBuiltins(catalog) {
        const source = catalog || (global && global.NEXUS_VIEWPORT_BACKGROUND_CATALOG);
        if (!source || typeof source.images !== 'function') return { accepted: 0, rejected: [] };
        return registerSource('builtin', { trust: TRUST.SYSTEM, scenes: source.images() });
    }

    /** Every scene, built-ins first, then the sources SOURCE_ORDER names, then anything else. */
    function list() {
        const names = Array.from(sources.keys()).sort((a, b) => {
            const ia = SOURCE_ORDER.indexOf(a);
            const ib = SOURCE_ORDER.indexOf(b);
            if (ia === ib) return a.localeCompare(b);
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
        });
        const out = [];
        for (const name of names) out.push(...sources.get(name).scenes);
        return out;
    }

    function get(id) {
        if (typeof id !== 'string') return null;
        return list().find((scene) => scene.id === id) || null;
    }

    function has(id) {
        return get(id) !== null;
    }

    /** What is in the library and where it came from — for a "Built-in / My scenes" split. */
    function sourceSummary() {
        return Array.from(sources.values()).map((s) => ({ name: s.name, trust: s.trust, count: s.scenes.length }));
    }

    function onChange(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function reset() {
        sources.clear();
        listeners.clear();
    }

    const api = {
        TRUST,
        BEHAVIOUR_FIELDS,
        applyTrust,
        normalizeEntry,
        registerSource,
        removeSource,
        adoptBuiltins,
        list,
        get,
        has,
        sources: sourceSummary,
        onChange,
        reset,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_SCENE_CATALOG = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
