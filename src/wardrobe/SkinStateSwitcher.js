/**
 * SkinStateSwitcher — UN32. Her skin changes state live: closed, aroused, open, afterglow… without
 * loading another avatar.
 *
 * Why it exists. A body state (Forge BD4–BD5) used to be a look of its own — a whole VRM — so
 * going from relaxed to aroused mid-scene meant the avatar swap the wardrobe controller does for a
 * change of clothes: seconds of download, a new skeleton, her pose and camera re-established. Her
 * skin is the only thing that differs between states. Forge's skin pack (BD7,
 * `wardrobe/vrm/skin_pack.py`) ships each state as the 256-texel tiles any state changes, the same
 * tiles for every state, beside the look (`looks/<id>/skin-pack/manifest.json`, served as
 * privately as the look). This keeps a canvas copy of her skin textures as loaded, draws a state's
 * tiles onto it, and points the material at the canvas: a few milliseconds, nothing reloaded.
 *
 * What it never does: change her mesh, swap an avatar (the wardrobe controller stays the only
 * avatar swapper), or move the pace — a caller decides which state, from what the person chose.
 * `detach()` writes the textures back exactly as they were (snapshot and restore, never an undo).
 *
 * Everything browser-facing is injected (fetch, the grant headers, image decoding, canvases), so
 * the logic is testable in jsdom, which has neither WebGL nor a 2D canvas.
 *
 * Exposes: window.NEXUS_SKIN_STATES
 */
(function (global) {
    'use strict';

    const SCHEMA = 'wardrobe.skinPack.v1';
    /** Manifest map name -> the material property three-vrm's MToon material reads it from. */
    const SLOTS = Object.freeze({ base: 'map', shade: 'shadeMultiplyTexture', normal: 'normalMap' });

    /** The pack beside a look's VRM: `…/looks/<id>/look.vrm` -> `…/looks/<id>/skin-pack/manifest.json`. */
    function manifestUrlFor(vrmUrl) {
        if (typeof vrmUrl !== 'string' || !/\/look\.vrm(\?.*)?$/.test(vrmUrl)) return null;
        return vrmUrl.replace(/look\.vrm(\?.*)?$/, 'skin-pack/manifest.json');
    }

    /** Is this look one Forge could have built a pack for (bare, or dressed over bare)? */
    function mayHavePack(look) {
        if (!look) return false;
        const state = look.wardrobeState || look.state;
        return state === 'bare' || state === 'over-bare' || /^body-bare\b/.test(String(look.templateId || ''));
    }

    function create(options) {
        const o = options || {};
        const fetchImpl = o.fetch || (global.fetch && global.fetch.bind(global));
        const headersFor = o.headersFor || (async () => ({}));
        const loadImage = o.loadImage || defaultLoadImage;
        const createCanvas = o.createCanvas || defaultCanvas;
        let attached = null;
        // Codex (#192). Every attach and detach is a new generation, and every apply a new request:
        // a manifest or an atlas that arrives after a newer one was asked for is dropped, never applied.
        let generation = 0;

        async function getJson(url) {
            const response = await fetchImpl(url, { headers: await headersFor(url) });
            if (!response || !response.ok) return null;
            return response.json();
        }

        async function getImage(url) {
            const response = await fetchImpl(url, { headers: await headersFor(url) });
            if (!response || !response.ok) throw new Error('skin pack file ' + response.status);
            return loadImage(await response.blob());
        }

        /** The material(s) her skin is drawn with: named as the manifest says. */
        function materialsOf(root, name) {
            const found = [];
            if (!root || typeof root.traverse !== 'function') return found;
            root.traverse((node) => {
                const list = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
                for (const material of list) {
                    const own = String(material.name || '');
                    // three-vrm may suffix a material name (" (Outline)", "_1"): the base name decides.
                    if (
                        (own === name || own.startsWith(name + ' ') || own.startsWith(name + '_')) &&
                        !found.includes(material)
                    )
                        found.push(material);
                }
            });
            return found;
        }

        return {
            /**
             * Load the pack for `look` (worn on `root`) and keep her textures as they are now.
             * Resolves to the states the pack holds, or [] when there is none (most looks).
             */
            async attach(root, look, manifestUrl) {
                this.detach();
                const mine = ++generation;
                const url = manifestUrl || manifestUrlFor(look && (look.vrmUrl || look.vrm_url));
                if (!url || (!manifestUrl && !mayHavePack(look))) return [];
                let manifest = null;
                try {
                    manifest = await getJson(url);
                } catch (error) {
                    console.warn('[SkinStates] no pack read', error);
                    return [];
                }
                if (mine !== generation) return []; // a newer attach, or a detach, came first
                if (!manifest || manifest.schema !== SCHEMA) return [];
                const materials = materialsOf(root, manifest.material);
                if (!materials.length) return [];
                const originals = new Map();
                for (const material of materials) {
                    for (const [map, slot] of Object.entries(SLOTS)) {
                        const texture = material[slot];
                        if (!texture || !texture.image || !manifest.maps.includes(map)) continue;
                        if (!originals.has(texture)) originals.set(texture, { image: texture.image, map });
                    }
                }
                attached = {
                    url,
                    manifest,
                    originals,
                    canvases: new Map(),
                    atlases: new Map(),
                    state: null,
                    request: 0,
                };
                return this.states();
            },

            /** The states this look's pack holds: [{ name, label, body }]. */
            states() {
                if (!attached) return [];
                return Object.entries(attached.manifest.states).map(([name, entry]) => ({
                    name,
                    label: entry.label || name,
                    body: entry.body || '',
                }));
            },

            current() {
                return attached ? attached.state : null;
            },

            /** Show `state`. Resolves true when her skin now shows it. */
            async apply(state) {
                const a = attached;
                if (!a || !a.manifest.states[state]) return false;
                const request = ++a.request;
                const superseded = () => attached !== a || a.request !== request;
                const files = a.manifest.states[state].files || {};
                const base = a.url;
                const tile = a.manifest.tile;
                const columns = a.manifest.columns;
                for (const [texture, original] of a.originals) {
                    const key = files[original.map];
                    if (!key) continue;
                    const atlasUrl = base.replace(/skin-pack\/manifest\.json(\?.*)?$/, key);
                    let atlas = a.atlases.get(atlasUrl);
                    if (!atlas) {
                        atlas = await getImage(atlasUrl);
                        if (attached !== a) return false; // detached or re-attached while loading
                        a.atlases.set(atlasUrl, atlas);
                    }
                    if (superseded()) return false; // a newer state was asked for while this loaded
                    let canvas = a.canvases.get(texture);
                    if (!canvas) {
                        canvas = createCanvas(original.image.width, original.image.height);
                        a.canvases.set(texture, canvas);
                    }
                    const ctx = canvas.getContext('2d');
                    // From her skin as loaded, every time: a state is never painted over another.
                    ctx.drawImage(original.image, 0, 0);
                    a.manifest.tiles.forEach(([x, y], n) => {
                        const sx = (n % columns) * tile;
                        const sy = Math.floor(n / columns) * tile;
                        ctx.clearRect(x, y, tile, tile);
                        ctx.drawImage(atlas, sx, sy, tile, tile, x, y, tile, tile);
                    });
                    texture.image = canvas;
                    texture.needsUpdate = true;
                }
                a.state = state;
                return true;
            },

            /** Her textures back exactly as they were when attached. */
            detach() {
                generation++;
                if (!attached) return false;
                for (const [texture, original] of attached.originals) {
                    texture.image = original.image;
                    texture.needsUpdate = true;
                }
                attached = null;
                return true;
            },
        };
    }

    async function defaultLoadImage(blob) {
        if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
        const url = URL.createObjectURL(blob);
        try {
            const image = new Image();
            image.src = url;
            await image.decode();
            return image;
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    function defaultCanvas(width, height) {
        const canvas = global.document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    const api = { SCHEMA, SLOTS, create, manifestUrlFor, mayHavePack };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_SKIN_STATES = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
