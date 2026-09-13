/**
 * Owning the one background texture that is alive (batch A4).
 *
 * A1 works out *where* to crop an image and A2 knows *which* images exist. This is the part that
 * touches the renderer: load the file, configure the texture the way r147 needs it, put it on
 * `scene.background`, and — the half that actually matters — make sure exactly one texture is
 * alive when the dust settles.
 *
 * ## The race this exists to lose safely
 *
 *     click Forest → click Beach → click Lake
 *
 * Three loads in flight, finishing in whatever order the network feels like. Without a guard the
 * last *arrival* wins rather than the last *click*, so somebody who ended on Lake is looking at
 * Forest with no way to explain it. Every `apply` takes a generation number; a load whose number
 * is stale disposes its own texture and returns quietly. The newest selection always wins,
 * whenever its bytes turn up.
 *
 * ## Dispose after the swap, never before
 *
 * `scene.background = next` then `previous.dispose()`. The other order frees a texture the
 * renderer may still sample this frame, which on some drivers is a black flash and on others is
 * a lost context. One line of ordering, and the tests pin it.
 *
 * ## Why everything is injected
 *
 * `three`, the scene, the loader, the catalogue, the viewport size. jsdom has no WebGL, so the
 * only way this logic is testable at all is if none of it is reached for directly — and the same
 * injection is what lets A5 hand over `ViewerEngine`'s own `TextureLoader` rather than this file
 * creating a second one. `scene-journey.js` takes `loadTexture` as a constructor argument for
 * exactly this reason; this follows it.
 *
 * ## What this deliberately does not do
 *
 * It never touches `scene.environment`, any light, the tone mapping, or the renderer's size. The
 * background is a picture behind the avatar and nothing else: an LDR photo pushed through PMREM
 * would cost a render target and a blur chain to produce flat, sunless lighting. Avatar
 * illumination stays exactly as it was.
 *
 * Exposes: window.NEXUS_VIEWPORT_BACKGROUND_MANAGER  (`.attach(deps)` → instance)
 */
(function (global) {
    'use strict';

    /** Fallbacks for a `three` that is missing a constant, so a stub in a test stays small. */
    const CLAMP_TO_EDGE = 1001;
    const LINEAR_FILTER = 1006;
    const SRGB_ENCODING = 3001;

    function pick(value, fallback) {
        return value === undefined || value === null ? fallback : value;
    }

    class ViewportBackgroundManager {
        /**
         * @param {object} deps
         * @param {object} deps.three            THREE, or anything with Color and the constants
         * @param {object} deps.scene            the scene whose `background` we own
         * @param {(src:string)=>Promise<object>} deps.loadTexture
         * @param {object} deps.catalog          A2's catalogue
         * @param {object} [deps.colors]         id → hex number; ViewerEngine.BG_COLORS
         * @param {()=>{w:number,h:number}} [deps.getViewportSize]
         * @param {object} [deps.cover]          A1's module
         */
        constructor(deps) {
            const d = deps || {};
            this.three = d.three || (global && global.THREE) || null;
            this.scene = d.scene || null;
            this.catalog = d.catalog || (global && global.NEXUS_VIEWPORT_BACKGROUND_CATALOG) || null;
            this.cover = d.cover || (global && global.NEXUS_AMBIENCE_COVER_TRANSFORM) || null;
            this.colors = d.colors || {};
            this._loadTexture = typeof d.loadTexture === 'function' ? d.loadTexture : null;
            this._getViewportSize = typeof d.getViewportSize === 'function' ? d.getViewportSize : null;

            /** Bumped on every apply. A load carrying a stale number is thrown away. */
            this._generation = 0;
            /** The live texture, or null when a colour is showing. Ours to dispose. */
            this._texture = null;
            /** The entry behind the live texture, for `onResize` and `reapplyCurrent`. */
            this._entry = null;
            /** Last id we were *asked* for, which is not always the one that loaded. */
            this._id = null;

            this.loads = 0;
            this.disposals = 0;
        }

        /** The id currently showing, colour or image. */
        current() {
            return this._id;
        }

        /** Whether an image (rather than a colour) is on screen right now. */
        hasImage() {
            return this._texture !== null;
        }

        /**
         * Show a background.
         *
         * Resolves `true` when the scene changed, `false` when it did not — an unknown id, a
         * failed load, or a stale generation. Never rejects: a background that will not load is
         * a disappointment, not a reason to take the render loop down with it.
         */
        async apply(id, options) {
            const opts = options || {};
            const entry = this.catalog ? this.catalog.get(id) : null;

            if (!entry) {
                // Unknown ids reach here from a stale localStorage value written by a newer
                // build, so this is an expected path rather than a bug: say so once and leave
                // whatever is on screen alone.
                console.warn(`[ViewportBackground] unknown background "${id}" — leaving the current one`);
                return false;
            }

            // Re-selecting what is already showing would otherwise re-fetch and re-upload a
            // texture to produce an identical frame. `force` is how `reapplyCurrent` gets past it.
            if (!opts.force && this._id === entry.id && (entry.type === 'color' || this._texture)) {
                return false;
            }

            const generation = ++this._generation;

            if (entry.type === 'color') {
                const painted = this._applyColor(entry);
                // The selection is recorded either way — it is what the user chose — but the
                // return value answers "did the scene change", because A9 decides whether to
                // announce a change from it. Claiming one with no scene attached would have the
                // controller emit an event for a frame nobody saw.
                this._id = entry.id;
                return painted;
            }

            if (!this._loadTexture) {
                // No loader injected: the scripts are not all present. A5 null-guards this so the
                // app degrades to colours-only rather than failing to boot.
                console.warn('[ViewportBackground] no texture loader — cannot show scenic backgrounds');
                return false;
            }

            let texture = null;
            try {
                this.loads += 1;
                texture = await this._loadTexture(entry.src, entry);
            } catch (error) {
                console.warn(`[ViewportBackground] "${entry.id}" did not load — keeping the current background`, error);
                return false;
            }

            if (!texture) {
                console.warn(`[ViewportBackground] "${entry.id}" loaded nothing — keeping the current background`);
                return false;
            }

            if (generation !== this._generation) {
                // Somebody clicked again while this was in flight. Its own texture is ours to
                // free, and the newer selection is already on screen or on its way.
                this._dispose(texture);
                return false;
            }

            this._configure(texture);
            this._applyCover(texture, entry);

            const previous = this._texture;
            if (this.scene) {
                this.scene.background = texture;
                // Per-scene brightness trim. Set even at 1 so a previous scene's value cannot
                // linger on the next one.
                this.scene.backgroundIntensity = entry.intensity || 1;
            }
            this._texture = texture;
            this._entry = entry;
            this._id = entry.id;

            // After the swap. Freeing a texture the renderer may still sample this frame is a
            // black flash on a good day and a lost context on a bad one.
            if (previous && previous !== texture) this._dispose(previous);

            return true;
        }

        /**
         * Re-apply what is selected, re-using the texture already in memory when it still fits.
         *
         * This is what leaving VR and AR calls. The background was swapped for a solid colour
         * (VR) or nulled for passthrough (AR) on entry, and rebuilding it from a colour key is
         * how an image selection silently becomes black — so the live texture goes straight back
         * on, with no refetch and no visible delay.
         *
         * ## Why it takes an id (finding A12-1)
         *
         * Because "what is selected" and "what this manager last applied" can disagree, and
         * exactly one situation makes them: while an XR session is presenting, `ViewerEngine`
         * records the user's choice in `_desktopBgKey` and deliberately does **not** call this
         * manager — a flat rectangle must never reach a headset, and in AR it would hide the
         * camera feed. So a scene chosen mid-session leaves `_id` pointing at the *previous*
         * one.
         *
         * Without the argument this method then faithfully restored the scene the user had
         * moved on from, and the Settings radio said something else. The caller knows the
         * authoritative key; pass it.
         *
         * @param {string} [id] the selection of record. Omitted means "whatever I last applied",
         *   which is the correct answer whenever nothing changed during the session.
         */
        reapplyCurrent(id) {
            // A selection was made while we were not being told about it. Load it properly
            // rather than restoring a texture the user has already moved past.
            if (id && this._id && id !== this._id) {
                this.apply(id, { force: true });
                return true;
            }
            if (this._texture && this._entry && this.scene) {
                this._applyCover(this._texture, this._entry);
                this.scene.background = this._texture;
                this.scene.backgroundIntensity = this._entry.intensity || 1;
                return true;
            }
            const want = id || this._id;
            if (want && this.catalog) {
                const entry = this.catalog.get(want);
                if (entry && entry.type === 'color') {
                    return this._applyColor(entry);
                }
                // An image was selected but its texture is gone (or never arrived). Load it
                // again rather than leaving the user on whatever XR left behind.
                this.apply(want, { force: true });
                return true;
            }
            return false;
        }

        /**
         * The viewport changed shape. Recompute the crop on the texture we already have.
         *
         * No reload, no new texture, no allocation — two vectors are written and three picks up
         * the new matrix on its next render because `matrixAutoUpdate` is on. This is why
         * `ViewerEngine.resize()` can call it on every debounced resize without a cost.
         */
        onResize(w, h) {
            if (!this._texture || !this._entry) return false;
            this._applyCover(this._texture, this._entry, w, h);
            return true;
        }

        /** Give up the texture. For a teardown, or a test that wants a clean slate. */
        dispose() {
            if (this._texture) this._dispose(this._texture);
            this._texture = null;
            this._entry = null;
            this._generation += 1;
        }

        // ── internals ────────────────────────────────────────────────────────

        /** @returns {boolean} whether a colour actually reached the scene */
        _applyColor(entry) {
            const hex =
                this.colors && Object.prototype.hasOwnProperty.call(this.colors, entry.id)
                    ? this.colors[entry.id]
                    : null;
            const previous = this._texture;
            let painted = false;
            if (this.scene && this.three && typeof this.three.Color === 'function' && hex !== null) {
                this.scene.background = new this.three.Color(hex);
                this.scene.backgroundIntensity = 1;
                painted = true;
            } else if (hex === null) {
                // A colour id the catalogue knows but BG_COLORS does not. That is drift between
                // the two lists, which A5's parity test exists to stop — worth a word here too,
                // because the symptom is a card that selects and does nothing.
                console.warn(`[ViewportBackground] no colour value for "${entry.id}"`);
            }
            this._texture = null;
            this._entry = null;
            // An image giving way to a colour is the one transition where the texture has no
            // successor, so it would leak if this were left to the swap path above.
            if (previous) this._dispose(previous);
            return painted;
        }

        /**
         * The texture settings r147 needs for a flat background, and why each one.
         *
         * Left alone deliberately: `mapping`. A plain texture takes the renderer's full-viewport
         * quad path, which is what we want — `EquirectangularReflectionMapping` would make three
         * convert it to a cubemap and wrap it round the camera as a 360 sky.
         */
        _configure(texture) {
            const three = this.three || {};
            try {
                // sRGB, or the image samples as though it were linear and renders dark and
                // contrasty. r147 turns this into an SRGB8_ALPHA8 internal format, so the GPU
                // does the decode for free.
                texture.encoding = pick(three.sRGBEncoding, SRGB_ENCODING);
                // Clamp, never repeat: the cover transform uses repeat < 1 to show a
                // sub-rectangle, and RepeatWrapping would tile the image instead of cropping it.
                texture.wrapS = pick(three.ClampToEdgeWrapping, CLAMP_TO_EDGE);
                texture.wrapT = texture.wrapS;
                // A background is drawn at roughly 1:1, so mips are a third more memory and a
                // generation pass for a level nothing samples. Turning them off forces
                // LinearFilter — NearestMipmap* with no mips renders black.
                texture.generateMipmaps = false;
                texture.minFilter = pick(three.LinearFilter, LINEAR_FILTER);
                texture.magFilter = texture.minFilter;
                texture.needsUpdate = true;
            } catch (error) {
                console.warn('[ViewportBackground] could not configure the texture', error);
            }
        }

        _viewport(w, h) {
            if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h };
            if (this._getViewportSize) {
                try {
                    const size = this._getViewportSize();
                    if (size && Number.isFinite(size.w) && Number.isFinite(size.h)) return size;
                } catch (error) {
                    console.warn('[ViewportBackground] could not measure the viewport', error);
                }
            }
            return null;
        }

        /** Write `repeat`/`offset` for the current viewport. A1 does the arithmetic. */
        _applyCover(texture, entry, w, h) {
            if (!this.cover || typeof this.cover.computeCoverTransform !== 'function') return;
            const size = this._viewport(w, h);
            const image = texture.image || {};
            const iw = image.width || image.naturalWidth || 0;
            const ih = image.height || image.naturalHeight || 0;
            if (!size || !iw || !ih) return; // not measurable yet; the next resize will fix it

            const focal =
                typeof this.cover.parseFocalPoint === 'function'
                    ? this.cover.parseFocalPoint(entry.focalPoint)
                    : undefined;
            const t = this.cover.computeCoverTransform(iw / ih, size.w / size.h, focal);
            try {
                if (texture.repeat && typeof texture.repeat.set === 'function') {
                    texture.repeat.set(t.repeat.x, t.repeat.y);
                    texture.offset.set(t.offset.x, t.offset.y);
                } else {
                    texture.repeat = { ...t.repeat };
                    texture.offset = { ...t.offset };
                }
            } catch (error) {
                console.warn('[ViewportBackground] could not set the crop', error);
            }
        }

        _dispose(texture) {
            this.disposals += 1;
            try {
                if (texture && typeof texture.dispose === 'function') texture.dispose();
            } catch (error) {
                // A texture that will not free itself is not worth losing the scene over.
                console.warn('[ViewportBackground] a texture refused to dispose', error);
            }
        }
    }

    function attach(deps) {
        return new ViewportBackgroundManager(deps);
    }

    const api = { attach, ViewportBackgroundManager };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_VIEWPORT_BACKGROUND_MANAGER = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
