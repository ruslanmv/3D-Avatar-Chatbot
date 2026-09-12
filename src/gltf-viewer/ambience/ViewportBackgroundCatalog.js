/**
 * What backgrounds exist, and nothing about how to draw them (batch A2).
 *
 * One list, two kinds of entry. The five solid colours the Settings panel has always offered are
 * in it alongside the scenic images, because the alternative — colours handled by one code path
 * and images by another — is how a UI ends up showing *Ocean* while the scene is black.
 *
 * ## Why the colours are declared here and not imported
 *
 * `ViewerEngine.BG_COLORS` stays the authority for the actual rendered value; this file carries
 * the same five ids with a `swatch` for the Settings card. That looks like duplication and is
 * deliberate: `ViewerEngine.js` is an ES module, this file deliberately is not (see CLAUDE.md —
 * no Babel config, so a module with `import` cannot be unit-tested), and a catalogue that cannot
 * be tested is worth less than a five-line list that can. `COLOR_IDS` is exported so A5's test
 * can assert the two lists have not drifted.
 *
 * ## Why validation lives here
 *
 * This is the only place a path from a data file enters the application, and later it will be
 * the place a path from a *remote* catalogue enters it. So the rule is enforced at the door:
 * relative, same-origin, no `..`. A later Studio/CDN adapter plugs in beside `ingest` and
 * inherits the same check rather than being trusted to repeat it.
 *
 * A malformed entry is dropped with one warning rather than thrown, because one bad line in a
 * data file must not cost the other nine scenes — the same posture as the scene-manifest
 * registry in `scene-journey.js`.
 *
 * Exposes: window.NEXUS_VIEWPORT_BACKGROUND_CATALOG
 */
(function (global) {
    'use strict';

    /**
     * The five viewport colours, in the order Settings has always shown them.
     *
     * `swatch` is for the card only. The rendered value comes from
     * `ViewerEngine.BG_COLORS`, which remains the single authority — these must not drift, and
     * A5's test is what holds them together.
     */
    const COLORS = Object.freeze([
        Object.freeze({ id: 'black', type: 'color', label: 'Black', swatch: '#000000' }),
        Object.freeze({ id: 'dark', type: 'color', label: 'Dark Blue', swatch: '#1a1a2e' }),
        Object.freeze({ id: 'gray', type: 'color', label: 'Gray', swatch: '#808080' }),
        Object.freeze({ id: 'light', type: 'color', label: 'Light', swatch: '#b0b0b0' }),
        Object.freeze({ id: 'white', type: 'color', label: 'White', swatch: '#f5f5f5' }),
    ]);

    const COLOR_IDS = Object.freeze(COLORS.map((c) => c.id));

    /** Where the scenic entries live when nobody passes a URL. */
    const DEFAULT_SOURCE = 'assets/ambient/backgrounds.json';

    /**
     * A path we are willing to hand to a texture loader.
     *
     * Relative, and no `..`. An absolute URL is refused even when it looks harmless: the point
     * is that a catalogue entry can never reach outside this origin, so a compromised or
     * mistaken data file cannot turn into a request to somewhere else. The manifest-path rule in
     * the ambience contract is this function.
     */
    function isSafeRelativePath(value) {
        if (typeof value !== 'string' || !value) return false;
        if (value.length > 300) return false;
        if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false; // http:, data:, javascript:, …
        if (value.startsWith('/') || value.startsWith('\\')) return false;
        if (value.includes('..')) return false;
        if (/[\s<>"'`?#]/.test(value)) return false;
        return /^[A-Za-z0-9._\-/]+$/.test(value);
    }

    const ID_PATTERN = /^ambient:[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
     * Turn one raw object into an entry, or return a reason it is not one.
     *
     * Returns `{ entry }` or `{ reason }` rather than throwing, so `ingest` can report every
     * problem in a file instead of stopping at the first.
     */
    function normalizeImage(raw) {
        if (!raw || typeof raw !== 'object') return { reason: 'not an object' };
        if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) {
            return { reason: `id "${raw && raw.id}" is not ambient:<scene>:<variant>` };
        }
        if (!isSafeRelativePath(raw.src)) return { reason: `src is not a safe relative path` };
        const thumb = isSafeRelativePath(raw.thumb) ? raw.thumb : raw.src;
        if (typeof raw.label !== 'string' || !raw.label.trim()) return { reason: 'label is missing' };

        // `intensity` reaches scene.backgroundIntensity, so it is range-checked here rather
        // than trusted: a negative or enormous value is a black or blown-out viewport.
        const intensity =
            typeof raw.intensity === 'number' && Number.isFinite(raw.intensity) && raw.intensity > 0
                ? Math.min(raw.intensity, 4)
                : 1;

        return {
            entry: Object.freeze({
                id: raw.id,
                type: 'image',
                label: raw.label.trim(),
                variantLabel: typeof raw.variantLabel === 'string' ? raw.variantLabel.trim() : '',
                src: raw.src,
                thumb,
                focalPoint: typeof raw.focalPoint === 'string' ? raw.focalPoint : 'center',
                intensity,
                category: typeof raw.category === 'string' ? raw.category.trim().toLowerCase() : '',
                tags: Object.freeze(cleanTags(raw.tags)),
            }),
        };
    }

    /** The scenic entries, in file order. Replaced wholesale by `ingest`. */
    let images = [];
    let lastSource = null;

    /**
     * Adopt a parsed data file. Accepts `{ scenes: [...] }` or a bare array, because a remote
     * catalogue may well hand over the latter.
     *
     * @returns {{accepted:number, rejected:number}}
     */
    function ingest(data, sourceLabel) {
        const raw = Array.isArray(data) ? data : data && Array.isArray(data.scenes) ? data.scenes : null;
        if (!raw) {
            console.warn('[ViewportBackgroundCatalog] no scenes in', sourceLabel || 'data');
            images = [];
            return { accepted: 0, rejected: 0 };
        }

        const next = [];
        const seen = new Set();
        let rejected = 0;
        for (const candidate of raw) {
            const { entry, reason } = normalizeImage(candidate);
            if (!entry) {
                rejected += 1;
                console.warn(`[ViewportBackgroundCatalog] scene rejected: ${reason}`);
                continue;
            }
            if (seen.has(entry.id)) {
                // Two entries with one id means one of them can never be selected, and which
                // one depends on iteration order. Better to say so than to pick silently.
                rejected += 1;
                console.warn(`[ViewportBackgroundCatalog] duplicate scene id "${entry.id}" ignored`);
                continue;
            }
            seen.add(entry.id);
            next.push(entry);
        }
        images = next;
        lastSource = sourceLabel || null;
        return { accepted: images.length, rejected };
    }

    /**
     * Fetch and adopt the data file.
     *
     * `fetcher` is injected so this is testable without a network, and so a later Studio/CDN
     * adapter can pass its own. A failure leaves the catalogue at colours-only, which is a
     * working application rather than a broken one — the scenic grid is simply empty.
     */
    async function load(options) {
        const opts = options || {};
        const url = opts.url || DEFAULT_SOURCE;
        const fetcher =
            opts.fetcher ||
            ((u) =>
                global && typeof global.fetch === 'function'
                    ? global
                          .fetch(u)
                          .then((r) => (r && r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r && r.status}`))))
                    : Promise.reject(new Error('no fetch available')));
        try {
            return ingest(await fetcher(url), url);
        } catch (error) {
            console.warn('[ViewportBackgroundCatalog] could not load', url, error);
            images = [];
            return { accepted: 0, rejected: 0 };
        }
    }

    /** One entry by id, colour or image, or `null`. The only lookup the rest of the app needs. */
    function get(id) {
        if (typeof id !== 'string' || !id) return null;
        for (const color of COLORS) {
            if (color.id === id) return color;
        }
        for (const image of images) {
            if (image.id === id) return image;
        }
        return null;
    }

    function has(id) {
        return get(id) !== null;
    }

    function isColorId(id) {
        return COLOR_IDS.indexOf(id) !== -1;
    }

    /** Colours first, then scenes — the order Settings renders them in. */
    function list() {
        return COLORS.concat(images);
    }

    function colors() {
        return COLORS.slice();
    }

    /** The scenic entries. What the resolver ranks over, and what the scene grid renders. */
    function imageEntries() {
        return images.slice();
    }

    /** Whether any scenic background can be offered at all — the capability's honesty check. */
    function hasImages() {
        return images.length > 0;
    }

    function source() {
        return lastSource;
    }

    /** For tests, and for a panel that wants to start from a known state. */
    function reset() {
        images = [];
        lastSource = null;
    }

    const api = {
        COLORS,
        COLOR_IDS,
        DEFAULT_SOURCE,
        ingest,
        load,
        get,
        has,
        isColorId,
        list,
        colors,
        images: imageEntries,
        hasImages,
        source,
        reset,
        isSafeRelativePath,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_VIEWPORT_BACKGROUND_CATALOG = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
