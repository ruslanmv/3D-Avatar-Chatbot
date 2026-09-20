/**
 * SceneArt — the one place Together asks what the place she is standing in looks like.
 *
 * ## The boundary this module exists to hold
 *
 * The twenty files under `assets/ambient/light/` and `assets/ambient/dark/` are production
 * viewport art. They were composed against this app's camera contract, they are calibrated, and
 * the viewport system owns them: `ViewportBackgroundManager`, `SceneCatalog` and the ambience
 * capability decide which one is on screen and how it is cropped.
 *
 * Together wants the same pictures for a different job — a thumbnail beside `Current place`, a
 * small square on the Scene Tale tile — and the failure that is easy to write is the one where
 * picking a thumbnail also picks a background. So this module reads, and only reads. It resolves
 * an id to a URL string. It has no reference to `NEXUS_VIEWER`, to `setDesktopBackground`, to the
 * background manager or to the ambience controller, and a test greps this file to keep it that
 * way. Putting a URL in an `<img>` cannot change the environment behind her, and nothing here
 * gives anybody a way to try.
 *
 *     assets/ambient/{light,dark}/*   ← owned by the viewport, never touched here
 *                 │ read-only URLs
 *                 ↓
 *       scene-tale-art.json  ──►  SceneArt  ──►  <img> in Together / Playground
 *
 * ## Why there is a table in a file whose point is that there is no second table
 *
 * `assets/ambient/scene-tale-art.json` is the source of truth and `load()` fetches it. But the
 * Configure card is painted synchronously out of a MutationObserver, so a resolver that can only
 * answer after a fetch paints the card with no picture and then pops one in — and the same flash
 * again on every repaint until the cache warms. `BUILTIN` is the answer available on the first
 * frame.
 *
 * It is not a second library. It is ten rows of `id, label, tone, key`, the paths are derived
 * from the same rule the manifest follows, `adopt()` replaces it the moment the real manifest
 * lands, and `tests/behavior/scene-art.test.js` reads both files and fails if a single field has
 * drifted. Before this module there were two hand-maintained copies of these paths in
 * `SceneTaleSetupView` alone, kept in step by nobody.
 *
 * Exposes: window.NEXUS_SCENE_ART
 */
(function (global) {
    'use strict';

    const MANIFEST = 'assets/ambient/scene-tale-art.json';

    /**
     * `[id, label, tone, generationKey]`, in the manifest's order.
     *
     * Every path in the ambience set is `assets/ambient/<tone>/<key>.webp` with the portrait
     * composition at `<key>-portrait.webp`, so the rows carry the two parts that vary and
     * `entry()` applies the rule. A file that ever breaks the rule breaks the drift test rather
     * than silently serving a 404 into an `<img>`.
     */
    const ROWS = [
        ['ambient:ocean:day', 'Ocean · Sunrise', 'light', 'ocean-sunrise'],
        ['ambient:ocean:night', 'Ocean · Moonlight', 'dark', 'ocean-moonlight'],
        ['ambient:lake:day', 'Mountain Lake · Day', 'light', 'mountain-lake-day'],
        ['ambient:lake:night', 'Mountain Lake · Night', 'dark', 'mountain-lake-night'],
        ['ambient:garden:day', 'Meditation Garden · Day', 'light', 'meditation-garden-day'],
        ['ambient:garden:night', 'Meditation Garden · Night', 'dark', 'meditation-garden-night'],
        ['ambient:terrace:day', 'Coastal Terrace · Day', 'light', 'coastal-terrace-day'],
        ['ambient:terrace:night', 'Coastal Terrace · Twilight', 'dark', 'coastal-terrace-twilight'],
        ['ambient:sky:day', 'Open Sky · Day', 'light', 'open-sky-day'],
        ['ambient:sky:night', 'Open Sky · Starlight', 'dark', 'open-sky-starlight'],
    ];

    function entry(id, label, tone, key) {
        const base = `assets/ambient/${tone}/${key}`;
        return Object.freeze({
            id,
            label,
            generationKey: key,
            hero: `${base}.webp`,
            thumbnail: `${base}.webp`,
            portrait: `${base}-portrait.webp`,
        });
    }

    const BUILTIN = Object.freeze(ROWS.map((row) => entry(row[0], row[1], row[2], row[3])));

    let scenes = BUILTIN;
    let index = null;
    let loading = null;

    /**
     * The form two strings have to share to count as the same place.
     *
     * Callers arrive with an id (`ambient:terrace:night`), a generation key
     * (`coastal-terrace-twilight`), or a label somebody already formatted for the screen. Labels
     * in particular come through with whichever separator the writer typed, so an em dash and an
     * en dash both fold to the middot the manifest uses.
     */
    function normalize(value) {
        let text = String(value == null ? '' : value)
            .trim()
            .toLowerCase();
        if (!text) return '';
        text = text.split(' — ').join(' · ');
        text = text.split(' – ').join(' · ');
        while (text.indexOf('  ') >= 0) text = text.split('  ').join(' ');
        return text;
    }

    /** Id, label and generation key all resolve, because all three are handed to us in practice. */
    function rebuild() {
        const map = new Map();
        for (const scene of scenes) {
            for (const key of [scene.id, scene.label, scene.generationKey]) {
                const normalized = normalize(key);
                if (normalized && !map.has(normalized)) map.set(normalized, scene);
            }
        }
        index = map;
        return map;
    }

    function lookup() {
        return index || rebuild();
    }

    /** Whatever this build currently believes, which is `BUILTIN` until the manifest lands. */
    function all() {
        return scenes;
    }

    /**
     * Take the manifest's own entries, if they are usable.
     *
     * Deliberately strict about the shape and deliberately silent about a bad one: a malformed
     * manifest leaves `BUILTIN` in place, which is a working screen with correct pictures. The
     * alternative — trusting a half-parsed payload — is a card with broken images on it.
     */
    function adopt(list) {
        if (!Array.isArray(list) || !list.length) return false;
        const usable = list
            .filter((item) => item && typeof item === 'object' && item.id && item.thumbnail)
            .map((item) =>
                Object.freeze({
                    id: String(item.id),
                    label: String(item.label || ''),
                    generationKey: String(item.generationKey || ''),
                    hero: String(item.hero || item.thumbnail),
                    thumbnail: String(item.thumbnail),
                    portrait: String(item.portrait || item.thumbnail),
                })
            );
        if (!usable.length) return false;
        scenes = Object.freeze(usable);
        index = null;
        return true;
    }

    /**
     * Fetch the manifest once per page, and never let a failure matter.
     *
     * `force-cache` because these bytes do not change within a session and the only thing a
     * revalidation buys is a round trip in front of the card. A rejection resolves to the entries
     * we already had rather than propagating: no caller of this module is doing anything that a
     * missing manifest should be allowed to interrupt.
     */
    function load(win) {
        if (loading) return loading;
        const w = win || global || null;
        const fetcher =
            w && typeof w.fetch === 'function' ? w.fetch.bind(w) : typeof fetch === 'function' ? fetch : null;
        if (!fetcher) return Promise.resolve(all());
        loading = fetcher(MANIFEST, { cache: 'force-cache' })
            .then((response) => (response && response.ok ? response.json() : null))
            .then((payload) => {
                if (payload && Array.isArray(payload.scenes)) adopt(payload.scenes);
                return all();
            })
            .catch(() => all());
        return loading;
    }

    /** The whole entry for a place, by id, label or generation key. `null` when it is not ours. */
    function getSceneArt(key) {
        if (key && typeof key === 'object') {
            return getSceneArt(key.id || key.sceneId || key.sceneLabel || key.label || key.title || '');
        }
        const normalized = normalize(key);
        if (!normalized) return null;
        return lookup().get(normalized) || null;
    }

    /**
     * One URL, or `''`.
     *
     * `''` rather than a stand-in image, because the caller's job on an unknown scene is to draw
     * the label and no picture. A placeholder would be a second thing to art-direct and a second
     * thing to explain when it appears over somebody's real scene.
     */
    function getSceneThumbnail(key, orientation) {
        const art = getSceneArt(key);
        if (!art) return '';
        return normalize(orientation) === 'portrait' ? art.portrait || art.thumbnail : art.thumbnail;
    }

    /** The manifest's spelling of a place's name, for a caller holding only an id. */
    function getSceneLabel(key) {
        const art = getSceneArt(key);
        return (art && art.label) || '';
    }

    /**
     * The `<img>` every caller should be using, including its failure.
     *
     * Three things are centralised here because each of them was a way to get this wrong in a
     * different file. `loading`/`decoding` keep a thumbnail off the critical path — these are
     * full-resolution plates being drawn at 96px, and there are twenty of them, so anything that
     * fetches more than the one visible scene is a bug. The `error` handler removes the image and
     * nothing else: a thumbnail that will not load is a picture missing from a card, not a reason
     * to touch the scene, the label or the layout. And the element is returned unattached so the
     * caller decides where it goes and can skip it entirely when there is no URL.
     */
    function thumbnailElement(doc, key, options) {
        const opts = options || {};
        const src = getSceneThumbnail(key, opts.orientation);
        if (!doc || !src || typeof doc.createElement !== 'function') return null;
        const img = doc.createElement('img');
        img.className = String(opts.className || 'nexus-scene-thumb');
        img.src = src;
        img.alt = String(opts.alt != null ? opts.alt : getSceneLabel(key) || '');
        img.loading = opts.eager ? 'eager' : 'lazy';
        img.decoding = 'async';
        img.dataset.sceneId = String((getSceneArt(key) || {}).id || '');
        img.addEventListener('error', () => {
            // Presentation failure, presentation-only response. Removing the node leaves the
            // card exactly as it renders for a scene with no art at all, which is a layout the
            // caller already had to draw.
            if (img.parentNode) img.parentNode.removeChild(img);
        });
        return img;
    }

    /** Back to the built-in table and an unspent fetch. Tests only. */
    function reset() {
        scenes = BUILTIN;
        index = null;
        loading = null;
    }

    const api = {
        MANIFEST,
        BUILTIN,
        all,
        adopt,
        load,
        normalize,
        getSceneArt,
        getSceneThumbnail,
        getSceneLabel,
        thumbnailElement,
        reset,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_SCENE_ART = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
