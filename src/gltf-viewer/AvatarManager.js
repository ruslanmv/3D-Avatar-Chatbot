/**
 * Avatar Manager Module
 * Handles avatar loading, switching, and lifecycle management
 * Works with both desktop and VR modes
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

export class AvatarManager {
    constructor({ scene, loader, camera, renderer }) {
        this.scene = scene;
        this.loader = loader; // GLTFLoader instance
        this.camera = camera;
        this.renderer = renderer; // [FIX] Needed for correct XR check

        this.avatars = [];
        this.basePath = '';
        this.current = null;
        this.currentRoot = null;
        this.currentMixer = null;
        this.currentClips = [];

        /**
         * vrmLoader — unified expression API for Phase 3 engines.
         * Works for both VRM (expressionManager) and GLB (MorphTargetAdapter).
         * BehaviorEngine reads this via window.NEXUS_VIEWER.avatarManager.vrmLoader
         */
        this.vrmLoader = null;

        // Track VRM instance for update()
        this._currentVRM = null;

        // When true (legacy 'cinematic' mode), authored MToon rim lighting and
        // matcap are zeroed on load to avoid edge glow against dark
        // backgrounds. ViewerEngine.setRenderMode() flips this to false for
        // the VRM-accurate 'anime' mode so avatars render exactly as authored.
        this._mtoonEdgeFxNeutralized = true;

        // Load generation counter — prevents stale async loads from adding
        // orphaned avatars to the scene when rapid switching occurs
        this._loadGeneration = 0;

        // LT6. She used to be removed before the next file had arrived, so a try-on
        // left an empty stage for the whole download. An MMO never despawns a
        // character to change their gear: the current body stays until the next one
        // is parsed, then the two crossfade and the pose carries over.
        this._outgoing = null;
        this._fadeToken = 0;
        this._fadeFrame = 0;
        this._fadeTimer = 0;
        this._preloads = new Map();

        // Register VRMLoaderPlugin if @pixiv/three-vrm is available
        this._registerVRMPlugin();

        // Callbacks
        this.onAvatarChanged = null;
        this.onAvatarLoading = null;
        this.onAvatarError = null;
    }

    /**
     * Register VRMLoaderPlugin with the GLTFLoader if the library is available.
     * This makes the loader automatically extract VRM data from .vrm files.
     */
    _registerVRMPlugin() {
        if (this._vrmPluginRegistered) return true;
        try {
            // Check for the ES module import (loaded via importmap)
            if (typeof window !== 'undefined' && window.__THREE_VRM_PLUGIN__) {
                this.loader.register((parser) => new window.__THREE_VRM_PLUGIN__(parser));
                this._vrmPluginRegistered = true;
                console.log('[AvatarManager] VRMLoaderPlugin registered (ES module)');
                return true;
            }
            // Check for the global THREE_VRM (CDN/legacy)
            if (typeof window !== 'undefined' && window.THREE_VRM?.VRMLoaderPlugin) {
                this.loader.register((parser) => new window.THREE_VRM.VRMLoaderPlugin(parser));
                this._vrmPluginRegistered = true;
                console.log('[AvatarManager] VRMLoaderPlugin registered (global)');
                return true;
            }
            console.log('[AvatarManager] @pixiv/three-vrm not yet available — will retry before loading VRM files');
            return false;
        } catch (e) {
            console.warn('[AvatarManager] VRMLoaderPlugin registration failed:', e);
            return false;
        }
    }

    // =========================================================================
    // MTOON EDGE FX (parametric rim + matcap) — render-mode aware
    // =========================================================================

    /**
     * Save a material's authored rim/matcap values once (idempotent) so they
     * can be restored when switching to the VRM-accurate render mode.
     * @param {THREE.Material} mat
     */
    _storeMToonEdgeFx(mat) {
        if (!mat || !mat.isMToonMaterial || mat.userData.__mtoonEdgeFx) return;
        mat.userData.__mtoonEdgeFx = {
            rimColor: mat.parametricRimColorFactor ? mat.parametricRimColorFactor.clone() : null,
            rimFresnel: mat.parametricRimFresnelPowerFactor,
            rimLift: mat.parametricRimLiftFactor,
            matcapTexture: mat.matcapTexture || null,
            matcapFactor: mat.matcapFactor ? mat.matcapFactor.clone() : null,
        };
    }

    /**
     * Neutralize (zero) or restore (authored) a material's rim/matcap.
     * Safe on non-MToon materials — all property accesses are guarded.
     * @param {THREE.Material} mat
     * @param {boolean} neutralize
     */
    _applyMToonEdgeFx(mat, neutralize) {
        if (!mat) return;
        if (neutralize) {
            // Disable MToon parametric rim lighting (golden edge glow)
            if (mat.parametricRimColorFactor) {
                mat.parametricRimColorFactor.setRGB(0, 0, 0);
            }
            if ('parametricRimFresnelPowerFactor' in mat) {
                mat.parametricRimFresnelPowerFactor = 1;
            }
            if ('parametricRimLiftFactor' in mat) {
                mat.parametricRimLiftFactor = 0;
            }
            // Disable matcap spherical reflections
            if (mat.matcapTexture) {
                mat.matcapTexture = null;
            }
            if (mat.matcapFactor) {
                mat.matcapFactor.setRGB(0, 0, 0);
            }
        } else {
            const saved = mat.userData.__mtoonEdgeFx;
            if (!saved) return; // nothing was neutralised for this material
            if (saved.rimColor && mat.parametricRimColorFactor) {
                mat.parametricRimColorFactor.copy(saved.rimColor);
            }
            if (saved.rimFresnel !== undefined && 'parametricRimFresnelPowerFactor' in mat) {
                mat.parametricRimFresnelPowerFactor = saved.rimFresnel;
            }
            if (saved.rimLift !== undefined && 'parametricRimLiftFactor' in mat) {
                mat.parametricRimLiftFactor = saved.rimLift;
            }
            if ('matcapTexture' in mat) {
                mat.matcapTexture = saved.matcapTexture;
            }
            if (saved.matcapFactor && mat.matcapFactor) {
                mat.matcapFactor.copy(saved.matcapFactor);
            }
        }
        mat.needsUpdate = true;
    }

    /**
     * Render-mode hook: neutralise or restore MToon rim/matcap on the
     * currently loaded avatar (and every avatar loaded afterwards).
     * @param {boolean} neutralized
     */
    setMToonEdgeFxNeutralized(neutralized) {
        this._mtoonEdgeFxNeutralized = !!neutralized;
        if (!this.currentRoot) return;
        this.currentRoot.traverse((node) => {
            if (!node.isMesh) return;
            const mats = Array.isArray(node.material) ? node.material : [node.material];
            for (const mat of mats) {
                if (mat && mat.isMToonMaterial) {
                    this._storeMToonEdgeFx(mat);
                    this._applyMToonEdgeFx(mat, this._mtoonEdgeFxNeutralized);
                }
            }
        });
        console.log(
            `[AvatarManager] MToon rim/matcap ${this._mtoonEdgeFxNeutralized ? 'neutralized' : 'restored (authored)'}`
        );
    }

    /**
     * Initialize from avatar manifest JSON
     * @param {string} manifestUrl - URL to avatars.json
     * @returns {Promise<Array>} Array of avatar items
     */
    async initFromManifest(manifestUrl) {
        try {
            // Check for VRM Manager manifest override (same as desktop main.js)
            let data = null;
            const override = localStorage.getItem('vrm_manager_manifest_override');
            if (override) {
                try {
                    data = JSON.parse(override);
                    console.log(
                        '[AvatarManager] Using VRM Manager manifest override with',
                        (data.items || []).length,
                        'avatars'
                    );
                } catch (_) {
                    data = null;
                }
            }

            if (!data) {
                const res = await fetch(manifestUrl, { cache: 'no-store' });
                if (!res.ok) {
                    throw new Error(`Avatar manifest fetch failed: ${res.status}`);
                }
                data = await res.json();
            }

            this.basePath = (data.basePath || '/vendor/avatars').replace(/\/$/, '');
            let items = data.items || [];

            // Merge user-installed avatars from VRM Manager catalog
            items = this._mergeInstalledAvatars(items);

            const blobMap = JSON.parse(localStorage.getItem('vrm_manager_blob_urls') || '{}');
            this.avatars = items.map((item) => ({
                name: item.name,
                file: item.file,
                url: blobMap[item.file] || `${this.basePath}/${item.file}`,
            }));

            console.log(`[AvatarManager] Loaded ${this.avatars.length} avatars from manifest`);
            return this.avatars;
        } catch (error) {
            console.error('[AvatarManager] Failed to load manifest:', error);
            if (this.onAvatarError) {
                this.onAvatarError('Failed to load avatar list', error);
            }
            throw error;
        }
    }

    /**
     * Merge user-installed avatars from VRM Manager into the manifest.
     * @param {Array} baseItems - Items from manifest
     * @returns {Array} Merged items
     */
    _mergeInstalledAvatars(baseItems) {
        let installed;
        try {
            installed = JSON.parse(localStorage.getItem('vrm_manager_installed') || '{}');
        } catch (_) {
            return baseItems;
        }
        const existing = new Set(baseItems.map((x) => x.file));
        const additions = [];
        for (const [, entry] of Object.entries(installed)) {
            if (!entry || !entry.localFile || existing.has(entry.localFile)) continue;
            additions.push({
                name: entry.name || entry.localFile.replace(/\.\w+$/, ''),
                file: entry.localFile,
                format: entry.format || 'vrm',
            });
        }
        if (additions.length) {
            console.log('[AvatarManager] Merged', additions.length, 'installed avatar(s)');
        }
        return [...baseItems, ...additions];
    }

    /**
     * Get list of all avatars
     * @returns {Array} Avatar list
     */
    getAvatars() {
        return this.avatars.slice();
    }

    /**
     * Get current avatar info
     * @returns {Object|null} Current avatar
     */
    getCurrent() {
        return this.current;
    }

    /**
     * Set avatar by index in avatars array
     * @param {number} index - Avatar index
     * @returns {Promise<Object>} Loaded avatar info
     */
    async setAvatarByIndex(index) {
        const avatar = this.avatars[index];
        if (!avatar) {
            throw new Error(`Avatar at index ${index} not found`);
        }
        return this.setAvatarByUrl(avatar.url, avatar.name, index);
    }

    /**
     * Set avatar by name
     * @param {string} name - Avatar name
     * @returns {Promise<Object>} Loaded avatar info
     */
    async setAvatarByName(name) {
        const idx = this.avatars.findIndex((a) => a.name === name);
        if (idx >= 0) {
            return this.setAvatarByIndex(idx);
        }
        throw new Error(`Avatar "${name}" not found`);
    }

    /**
     * Remove current avatar from scene and dispose its resources.
     * Also removes any orphaned AvatarRoot nodes left by race conditions.
     */
    _removeCurrentAvatar() {
        // Remove tracked current avatar
        if (this.currentRoot) {
            try {
                if (window.NEXUS_PROCEDURAL_ANIMATOR?.unregisterAvatar) {
                    window.NEXUS_PROCEDURAL_ANIMATOR.unregisterAvatar(this.currentRoot);
                    console.log('[AvatarManager] Unregistered avatar from procedural animator');
                }
            } catch (e) {
                console.warn('[AvatarManager] Procedural unregister failed:', e);
            }

            this.scene.remove(this.currentRoot);
            this.disposeObject(this.currentRoot);
            this.currentRoot = null;
        }

        // Defensive sweep: remove any orphaned AvatarRoot nodes that may
        // have been added by a concurrent load that completed out of order
        const orphans = [];
        this.scene.children.forEach((child) => {
            if (child.name && child.name.startsWith('AvatarRoot:')) {
                orphans.push(child);
            }
        });
        for (const orphan of orphans) {
            console.warn(`[AvatarManager] Removing orphaned avatar: ${orphan.name}`);
            this.scene.remove(orphan);
            this.disposeObject(orphan);
        }
    }

    /**
     * LT6. Drop one root out of the scene and free its GPU resources.
     * Never used on the avatar the camera is still looking at.
     * @param {THREE.Object3D|null} root
     */
    _dropRoot(root) {
        if (!root) return;
        try {
            if (root.parent) root.parent.remove(root);
            else if (this.scene) this.scene.remove(root);
        } catch (_) {}
        try {
            this.disposeObject(root);
        } catch (e) {
            console.warn('[AvatarManager] dispose failed:', e);
        }
    }

    /**
     * LT6. Take a root off the animator without removing the mesh, so the body
     * that is about to fade out stops being driven twice.
     * @param {THREE.Object3D|null} root
     */
    _detachRoot(root) {
        if (!root) return;
        try {
            if (window.NEXUS_PROCEDURAL_ANIMATOR?.unregisterAvatar) {
                window.NEXUS_PROCEDURAL_ANIMATOR.unregisterAvatar(root);
            }
        } catch (e) {
            console.warn('[AvatarManager] Procedural unregister failed:', e);
        }
    }

    /** Stop the blink and mixer on the avatar that is about to leave. The mesh stays. */
    _retireDrivers() {
        if (this.currentMixer) {
            this.currentMixer.stopAllAction();
            this.currentMixer = null;
        }
        this.currentClips = [];
        this._currentVRM = null;
        if (this.vrmLoader) {
            this.vrmLoader.stopAutoBlink?.();
            this.vrmLoader.stopLipSync?.();
            this.vrmLoader = null;
        }
    }

    /**
     * Copy a humanoid pose onto the incoming VRM so a gear swap does not flash
     * the bind pose. Bone names that exist on both skeletons are the ones an
     * equipment change can honestly carry; anything else is left as authored.
     */
    _copyHumanoidPose(fromVrm, toVrm) {
        const from = fromVrm && fromVrm.humanoid;
        const to = toVrm && toVrm.humanoid;
        if (!from || !to || typeof from.getRawBoneNode !== 'function' || typeof to.getRawBoneNode !== 'function') {
            return;
        }
        const names = Object.keys(from.humanBones || {});
        for (let i = 0; i < names.length; i += 1) {
            let source;
            let target;
            try {
                source = from.getRawBoneNode(names[i]);
                target = to.getRawBoneNode(names[i]);
            } catch (_) {
                continue;
            }
            if (!source || !target || !source.quaternion || !target.quaternion) continue;
            if (typeof target.quaternion.copy !== 'function') continue;
            try {
                target.quaternion.copy(source.quaternion);
            } catch (_) {}
        }
    }

    _rememberOpacity(mat) {
        if (!mat.userData.__swapOpacity) {
            mat.userData.__swapOpacity = {
                transparent: mat.transparent,
                opacity: mat.opacity == null ? 1 : mat.opacity,
                depthWrite: mat.depthWrite,
            };
        }
        return mat.userData.__swapOpacity;
    }

    /** Fade a whole avatar. Restores authored opacity at 1 so MToon hair is not left transparent. */
    _setOpacity(root, opacity) {
        if (!root || typeof root.traverse !== 'function') return;
        const shown = opacity >= 1;
        root.traverse((node) => {
            if (!node.isMesh || !node.material) return;
            const mats = Array.isArray(node.material) ? node.material : [node.material];
            for (const mat of mats) {
                if (!mat) continue;
                const saved = this._rememberOpacity(mat);
                if (shown) {
                    mat.opacity = saved.opacity;
                    mat.transparent = saved.transparent;
                    mat.depthWrite = saved.depthWrite;
                    delete mat.userData.__swapOpacity;
                } else {
                    mat.transparent = true;
                    mat.opacity = opacity * saved.opacity;
                    mat.depthWrite = opacity > 0.85 ? saved.depthWrite : false;
                }
                mat.needsUpdate = true;
            }
        });
    }

    _cancelFade() {
        this._fadeToken += 1;
        if (this._fadeFrame && typeof cancelAnimationFrame === 'function') {
            try {
                cancelAnimationFrame(this._fadeFrame);
            } catch (_) {}
        }
        this._fadeFrame = 0;
        if (this._fadeTimer) {
            clearTimeout(this._fadeTimer);
            this._fadeTimer = 0;
        }
        if (this._outgoing) {
            const old = this._outgoing;
            this._outgoing = null;
            this._dropRoot(old);
        }
    }

    /**
     * LT6. Both bodies share the stage for a short blend, then the previous one
     * leaves. If animation frames are not running, a timer finishes the swap so
     * she cannot stay invisible. She is never removed before the incoming body
     * is already in the scene.
     */
    _crossfade(outgoing, incoming) {
        if (!incoming) return;
        if (!outgoing || outgoing === incoming) {
            this._setOpacity(incoming, 1);
            return;
        }
        this._cancelFade();
        this._outgoing = outgoing;
        const fadeMs = 180;
        const token = ++this._fadeToken;
        const finish = () => {
            if (token !== this._fadeToken) return;
            this._fadeToken += 1;
            if (this._fadeFrame && typeof cancelAnimationFrame === 'function') {
                try {
                    cancelAnimationFrame(this._fadeFrame);
                } catch (_) {}
            }
            this._fadeFrame = 0;
            if (this._fadeTimer) {
                clearTimeout(this._fadeTimer);
                this._fadeTimer = 0;
            }
            try {
                this._setOpacity(incoming, 1);
            } catch (_) {}
            if (this._outgoing === outgoing) this._outgoing = null;
            this._dropRoot(outgoing);
        };
        const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
        if (!raf) {
            finish();
            return;
        }
        const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        const step = (now) => {
            if (token !== this._fadeToken) return;
            const u = Math.min(1, ((now || Date.now()) - t0) / fadeMs);
            try {
                this._setOpacity(incoming, u);
                this._setOpacity(outgoing, 1 - u);
            } catch (_) {
                finish();
                return;
            }
            if (u < 1) this._fadeFrame = raf(step);
            else finish();
        };
        this._setOpacity(incoming, 0);
        this._fadeFrame = raf(step);
        this._fadeTimer = setTimeout(finish, fadeMs + 120);
    }

    /**
     * Remove AvatarRoot nodes that are neither the body on stage nor the one
     * fading out. A superseded load must not delete the body the camera is on.
     * @param {THREE.Object3D[]} keep
     */
    _sweepOrphans(keep) {
        if (!this.scene) return;
        const hold = new Set((keep || []).filter(Boolean));
        const orphans = [];
        this.scene.children.forEach((child) => {
            if (child.name && child.name.startsWith('AvatarRoot:') && !hold.has(child)) orphans.push(child);
        });
        for (const orphan of orphans) {
            console.warn(`[AvatarManager] Removing orphaned avatar: ${orphan.name}`);
            this._detachRoot(orphan);
            this._dropRoot(orphan);
        }
    }

    /**
     * LT6. Start parsing a VRM before anyone asks to wear it. The next and previous
     * looks of a haul are warmed this way, so Next is already in memory — the same
     * prefetch an MMO does for the next piece of gear. At most three files are held.
     * @param {string} url
     * @returns {Promise<Object|null>}
     */
    preload(url) {
        if (!url || !this.loader || typeof this.loader.load !== 'function') return Promise.resolve(null);
        if (!this._preloads) this._preloads = new Map();
        const hit = this._preloads.get(url);
        if (hit) return hit.promise;
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        const entry = { promise, claimed: false };
        this._preloads.set(url, entry);
        while (this._preloads.size > 3) {
            const oldest = this._preloads.keys().next().value;
            if (!oldest || oldest === url) break;
            this._preloads.delete(oldest);
        }
        const onProgress = () => {};
        try {
            this.loader.load(
                url,
                (gltf) => {
                    // A file nobody is waiting to wear — the cache dropped it to stay at three —
                    // must not keep its textures. A claimed entry was taken by setAvatarByUrl.
                    if (!entry.claimed && (!this._preloads || this._preloads.get(url) !== entry)) {
                        const stale = gltf && (gltf.scene || (gltf.scenes && gltf.scenes[0]));
                        if (stale) {
                            try {
                                this.disposeObject(stale);
                            } catch (_) {}
                        }
                        resolve(null);
                        return;
                    }
                    resolve(gltf);
                },
                onProgress,
                (err) => {
                    if (this._preloads && this._preloads.get(url) === entry) this._preloads.delete(url);
                    reject(err);
                }
            );
        } catch (err) {
            this._preloads.delete(url);
            return Promise.reject(err);
        }
        return promise;
    }

    /**
     * Load and set avatar from URL
     * @param {string} url - Avatar file URL
     * @param {string} name - Avatar name (optional)
     * @param {number} index - Avatar index (optional)
     * @param {{keepFacing?: boolean}} [options] - keepFacing carries her turn across a wardrobe swap
     * @returns {Promise<Object>} Loaded avatar info
     */
    async setAvatarByUrl(url, name = '', index = -1, options = undefined) {
        console.log(`[AvatarManager] Loading avatar: ${name || url}`);

        // Increment generation — any in-flight load with an older generation
        // will discard its result instead of adding an orphaned avatar
        const thisGeneration = ++this._loadGeneration;

        if (this.onAvatarLoading) {
            this.onAvatarLoading(name || url);
        }

        try {
            // Retry VRM plugin registration if it wasn't available at construction time
            // (async CDN import may have completed by now)
            if (!this._vrmPluginRegistered) {
                this._registerVRMPlugin();
            }

            // If loading a VRM file and the plugin still isn't available,
            // wait briefly for the CDN import to complete. On slow mobile
            // connections, the VRM library may still be loading.
            const isVRMFile = url.toLowerCase().endsWith('.vrm');
            if (isVRMFile && !this._vrmPluginRegistered) {
                console.log('[AvatarManager] VRM plugin not ready — waiting up to 15s for CDN load...');
                const pollStart = Date.now();
                while (Date.now() - pollStart < 15000) {
                    await new Promise((r) => setTimeout(r, 500));
                    if (this._registerVRMPlugin()) break;
                }
                if (!this._vrmPluginRegistered) {
                    console.warn(
                        '[AvatarManager] VRM plugin unavailable — loading VRM as plain GLTF (materials may be incorrect)'
                    );
                }
            }

            // LT6. She stays on stage while the next file downloads. Removing her here
            // is what made a try-on flash an empty scene between looks.

            // Load new avatar
            // L1. Report bytes as they arrive, so the page can show a percentage and tell a slow
            // download from a dead one (src/gltf-viewer/AvatarLoadWatch.js). Only this load's
            // own progress: a superseded load stays quiet.
            const onProgress = (e) => {
                if (thisGeneration !== this._loadGeneration || typeof window === 'undefined') return;
                try {
                    window.dispatchEvent(
                        new CustomEvent('nexus-avatar-progress', {
                            detail: { url, loaded: (e && e.loaded) || 0, total: (e && e.total) || 0 },
                        })
                    );
                } catch (_) {}
            };
            // A haul preloads the next and previous look. Wear that file from the
            // cache instead of starting a second parse of the same URL.
            let gltf;
            const cached = this._preloads && this._preloads.get(url);
            if (cached) {
                cached.claimed = true;
                this._preloads.delete(url);
                gltf = await cached.promise;
            }
            if (!gltf) {
                gltf = await new Promise((resolve, reject) => {
                    this.loader.load(url, resolve, onProgress, reject);
                });
            }

            // ── Stale-load guard ──
            // A newer setAvatarByUrl() call was made while we were loading.
            // Discard this result to prevent overlapping avatars.
            if (thisGeneration !== this._loadGeneration) {
                console.log(
                    `[AvatarManager] Discarding stale load: ${name || url} (gen ${thisGeneration} < ${this._loadGeneration})`
                );
                const staleRoot = gltf.scene || gltf.scenes?.[0];
                if (staleRoot) {
                    this.disposeObject(staleRoot);
                }
                return null;
            }

            const root = gltf.scene || gltf.scenes?.[0];
            if (!root) {
                throw new Error('Loaded avatar has no scene root');
            }

            // The body on stage is who she still is. Anything else named like an avatar
            // is a load that lost the race, and it can leave now.
            this._sweepOrphans([this.currentRoot, this._outgoing]);

            // Setup avatar
            root.name = `AvatarRoot:${name || url}`;
            root.position.set(0, 0, 0);

            // Check for VRM data (extracted by VRMLoaderPlugin)
            const vrm = gltf.userData?.vrm;
            const isVRM = !!vrm || url.toLowerCase().endsWith('.vrm');

            // VRM models face -Z (VRM spec: forward = -Z). Camera is at +Z,
            // so rotate VRM models Math.PI to face the camera.
            root.rotation.set(0, isVRM ? Math.PI : 0, 0);
            // A wardrobe swap is the same person turning in new clothes. The avatar
            // picker does not ask for this, so a different character still faces the camera.
            if (
                options &&
                options.keepFacing &&
                this.currentRoot &&
                this.currentRoot.rotation &&
                Number.isFinite(this.currentRoot.rotation.y)
            ) {
                root.rotation.y = this.currentRoot.rotation.y;
            }
            this._copyHumanoidPose(this._currentVRM, vrm);

            // Store VRM flag on root for downstream systems (VRIntimacySystem
            // facing calculation needs to know whether to add Math.PI offset).
            root.userData.isVRM = isVRM;

            // Optimize VRM if utilities available
            if (vrm && window.THREE_VRM?.VRMUtils) {
                try {
                    window.THREE_VRM.VRMUtils.removeUnnecessaryVertices(vrm.scene);
                    window.THREE_VRM.VRMUtils.removeUnnecessaryJoints(vrm.scene);
                } catch (_) {}
            }

            // Enable shadow casting on meshes only when shadow map is active.
            // receiveShadow is intentionally false — self-shadowing on thin anime
            // geometry (stockings, hair, ribbons) causes starburst/fan artifacts.
            // The ground ShadowMaterial plane handles shadow receiving instead.
            const shadowsOn = this.renderer.shadowMap.enabled;
            root.traverse((node) => {
                if (node.isMesh) {
                    node.castShadow = shadowsOn;
                    node.receiveShadow = false;

                    // Neutralize VRM/MToon material properties that cause
                    // unwanted edge glow on a dark background:
                    // 1. envMap — PMREM probe Fresnel reflections at grazing angles
                    // 2. Parametric rim — MToon's built-in rim/edge lighting
                    // 3. Matcap — spherical reflection map (can add edge color)
                    // MToon is a toon shader — direct lights only, no edge effects.
                    const mats = Array.isArray(node.material) ? node.material : [node.material];
                    for (const mat of mats) {
                        if (mat && isVRM) {
                            mat.envMap = null;
                            mat.envMapIntensity = 0;

                            // Remember the authored MToon rim / matcap so the
                            // 'anime' render mode can show the avatar exactly
                            // as authored (VRoid Hub parity); the legacy
                            // 'cinematic' mode keeps neutralising them.
                            this._storeMToonEdgeFx(mat);
                            this._applyMToonEdgeFx(mat, this._mtoonEdgeFxNeutralized);
                            mat.needsUpdate = true;
                        }
                    }
                }
            });

            // Add the new body before the previous one is allowed to leave. Drivers move
            // to her now; the mesh she was wearing stays for the crossfade below.
            const outgoing = this.currentRoot && this.currentRoot !== root ? this.currentRoot : null;
            if (outgoing) {
                this._detachRoot(outgoing);
                this._retireDrivers();
            }
            this.scene.add(root);

            // Setup animations if present
            if (gltf.animations && gltf.animations.length > 0) {
                this.currentMixer = new THREE.AnimationMixer(root);
                this.currentClips = gltf.animations;
                console.log(`[AvatarManager] Loaded ${this.currentClips.length} animations`);
            }

            // ── Build vrmLoader bridge for Phase 3 engines ──
            this._buildVRMLoaderBridge(vrm, root);

            // Store current state
            this.current = { url, name, index };
            this.currentRoot = root;

            // PX16. Never skip drawing a part of her because three.js thinks it is off screen.
            //
            // Reported from a phone: seated on the bed, framed close, her face vanished while hair
            // and body stayed. three.js decides whether to draw a mesh from its bounding sphere,
            // and for a skinned mesh that sphere is the rest pose's — it does not follow the
            // skeleton. Measured on AvatarSample A: the face's sphere stays at standing head height
            // (y≈1.43, r≈0.24) whatever she does, so once she sits her real face is ~0.4 m below
            // it, and a tight portrait framing leaves the stale sphere above the screen: the face is
            // judged out of view and not drawn. Hair or clothes baked into the big body mesh keep a
            // sphere that spans the whole figure, which is why they stayed.
            //
            // The avatar is the one thing the camera is always pointed at, so testing her meshes
            // against the frustum saves nothing worth having. Every mesh under the loaded root, so
            // an outfit (WardrobeController loads it through here) gets the same treatment.
            try {
                root.traverse((node) => {
                    if (node.isMesh || node.isSkinnedMesh) node.frustumCulled = false;
                });
            } catch (e) {
                console.warn('[AvatarManager] could not keep the avatar from being culled:', e);
            }

            // Store VRM humanoid on root so PoseNormalizer/ProceduralAnimator can use Tier 1 detection
            if (vrm && vrm.humanoid) {
                root.userData.vrmHumanoid = vrm.humanoid;
            }

            // Register with ProceduralAnimator for breathing, head movement, etc.
            try {
                const hasClips = this.currentClips.length > 0;
                if (window.NEXUS_PROCEDURAL_ANIMATOR?.registerAvatar) {
                    window.NEXUS_PROCEDURAL_ANIMATOR.registerAvatar(root, hasClips);
                    console.log('[AvatarManager] Registered with ProceduralAnimator', { hasClips });
                }
            } catch (e) {
                console.warn('[AvatarManager] ProceduralAnimator registration failed:', e);
            }

            // Register with ClipAnimationLoader for BVH/VRMA clip playback
            try {
                if (window.NEXUS_CLIP_LOADER?.registerAvatar) {
                    window.NEXUS_CLIP_LOADER.registerAvatar(root, vrm);
                    console.log('[AvatarManager] Registered with ClipAnimationLoader');
                }
            } catch (e) {
                // ClipAnimationLoader is optional — silent fail
            }

            console.log(`[AvatarManager] Avatar loaded successfully: ${name}`);

            // [FIX] Check renderer XR state correctly - only frame in desktop mode
            const isVR = this.renderer?.xr?.isPresenting;
            if (!isVR) {
                this.frameAvatar();
            } else {
                console.log('[AvatarManager] Skipping frame in VR mode');
            }

            // Callback
            if (this.onAvatarChanged) {
                this.onAvatarChanged(this.current);
            }

            this._crossfade(outgoing, root);

            return this.current;
        } catch (error) {
            console.error('[AvatarManager] Failed to load avatar:', error);
            if (this.onAvatarError) {
                this.onAvatarError(`Failed to load avatar: ${name}`, error);
            }
            throw error;
        }
    }

    /**
     * Frame avatar in camera view
     */
    frameAvatar() {
        if (!this.currentRoot || !this.camera) return;

        const box = new THREE.Box3().setFromObject(this.currentRoot);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        // Calculate optimal camera distance
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        const cameraDistance = Math.abs(maxDim / Math.sin(fov / 2)) * 1.2;

        // Position camera
        this.camera.position.set(center.x, center.y + size.y * 0.1, center.z + cameraDistance);

        this.camera.lookAt(center);
        this.camera.updateProjectionMatrix();
    }

    /**
     * Get animation mixer (if avatar has animations)
     * @returns {THREE.AnimationMixer|null}
     */
    getMixer() {
        return this.currentMixer;
    }

    /**
     * Get animation clips
     * @returns {Array}
     */
    getClips() {
        return this.currentClips;
    }

    /**
     * Play animation by name
     * @param {string} name - Animation name
     * @returns {THREE.AnimationAction|null}
     */
    playAnimation(name) {
        if (!this.currentMixer || !this.currentClips.length) {
            return null;
        }

        const clip = this.currentClips.find((c) => c.name === name);
        if (!clip) {
            console.warn(`[AvatarManager] Animation "${name}" not found`);
            return null;
        }

        const action = this.currentMixer.clipAction(clip);
        action.reset();
        action.play();
        return action;
    }

    /**
     * Update animation mixer and VRM (call in render loop)
     * @param {number} delta - Time delta
     */
    update(delta) {
        if (this.currentMixer) {
            this.currentMixer.update(delta);
        }
        // VRM needs per-frame update for spring bones, expression smoothing, etc.
        if (this._currentVRM?.update) {
            this._currentVRM.update(delta);
        }
    }

    /**
     * Dispose of 3D object and free memory
     * @param {THREE.Object3D} obj - Object to dispose
     */
    disposeObject(obj) {
        obj.traverse((node) => {
            // Dispose geometries
            if (node.geometry) {
                node.geometry.dispose?.();
            }

            // Dispose materials and textures
            if (node.material) {
                const materials = Array.isArray(node.material) ? node.material : [node.material];

                materials.forEach((material) => {
                    // Dispose all texture maps
                    if (material.map) material.map.dispose?.();
                    if (material.normalMap) material.normalMap.dispose?.();
                    if (material.roughnessMap) material.roughnessMap.dispose?.();
                    if (material.metalnessMap) material.metalnessMap.dispose?.();
                    if (material.emissiveMap) material.emissiveMap.dispose?.();
                    if (material.aoMap) material.aoMap.dispose?.();
                    if (material.lightMap) material.lightMap.dispose?.();
                    if (material.bumpMap) material.bumpMap.dispose?.();
                    if (material.displacementMap) material.displacementMap.dispose?.();
                    if (material.alphaMap) material.alphaMap.dispose?.();

                    material.dispose?.();
                });
            }
        });
    }

    // =========================================================================
    // VRM LOADER BRIDGE — unified expression API for Phase 3 engines
    // =========================================================================

    /**
     * Build a vrmLoader-compatible object that works for both VRM and GLB.
     * Phase 3 engines (BehaviorEngine, LipSyncEngine) access this via:
     *   window.NEXUS_VIEWER.avatarManager.vrmLoader
     *
     * The bridge exposes: setExpression(), setEmotion(), blink(),
     * startAutoBlink(), stopAutoBlink(), startLipSync(), stopLipSync(),
     * currentVRM (with .expressionManager).
     */
    _buildVRMLoaderBridge(vrm, root) {
        const self = this;

        // LT6. The next wardrobe swap copies this humanoid onto the new clothes.
        // Remember every VRM, including one whose face has no expression manager —
        // that branch below is only how her face is driven.
        if (vrm) this._currentVRM = vrm;

        if (vrm && vrm.expressionManager) {
            // ── VRM model: use native expressionManager ──
            this._currentVRM = vrm;

            this.vrmLoader = {
                currentVRM: vrm,
                setExpression(name, value) {
                    try {
                        vrm.expressionManager.setValue(name, value);
                    } catch (_) {}
                },
                setEmotion(emotion, intensity) {
                    const emotions = ['happy', 'sad', 'angry', 'surprised', 'neutral'];
                    for (const e of emotions) {
                        try {
                            vrm.expressionManager.setValue(e, 0);
                        } catch (_) {}
                    }
                    if (emotion !== 'neutral') {
                        try {
                            vrm.expressionManager.setValue(emotion, intensity);
                        } catch (_) {}
                    }
                },
                blink() {
                    try {
                        vrm.expressionManager.setValue('blink', 1.0);
                        setTimeout(() => {
                            try {
                                vrm.expressionManager.setValue('blink', 0);
                            } catch (_) {}
                        }, 150);
                    } catch (_) {}
                },
                startAutoBlink() {
                    _startAutoBlink(this);
                },
                stopAutoBlink() {
                    _stopAutoBlink(this);
                },
                startLipSync() {},
                stopLipSync() {},
                _blinkTimer: null,
            };

            console.log('[AvatarManager] VRM bridge active — full expression support');
        } else if (typeof window.MorphTargetAdapter === 'function') {
            // ── GLB model: use MorphTargetAdapter ──
            const adapter = new window.MorphTargetAdapter(root);

            if (adapter.hasBindings) {
                // Create a fake expressionManager so Phase 3 engines detect support
                const fakeExprMgr = { setValue: (n, v) => adapter.setValue(n, v) };

                this.vrmLoader = {
                    currentVRM: { expressionManager: fakeExprMgr },
                    setExpression(name, value) {
                        adapter.setValue(name, value);
                    },
                    setEmotion(emotion, intensity) {
                        const emotions = ['happy', 'sad', 'angry', 'surprised'];
                        for (const e of emotions) {
                            adapter.setValue(e, 0);
                        }
                        if (emotion !== 'neutral') {
                            adapter.setValue(emotion, intensity);
                        }
                    },
                    blink() {
                        adapter.setValue('blink', 1.0);
                        setTimeout(() => adapter.setValue('blink', 0), 150);
                    },
                    startAutoBlink() {
                        _startAutoBlink(this);
                    },
                    stopAutoBlink() {
                        _stopAutoBlink(this);
                    },
                    startLipSync() {},
                    stopLipSync() {},
                    _blinkTimer: null,
                    _adapter: adapter,
                };

                console.log('[AvatarManager] MorphTargetAdapter bridge active —', adapter.capabilities);
            } else {
                console.log('[AvatarManager] GLB has no morph targets or jaw bone — body animation only');
            }
        }

        // Start auto-blink if we have a bridge
        if (this.vrmLoader) {
            this.vrmLoader.startAutoBlink();
        }
    }

    /**
     * Cleanup all resources
     */
    dispose() {
        // Cancel any in-flight loads and a gear-swap fade still on its way out.
        this._loadGeneration++;
        this._cancelFade();

        if (this.vrmLoader) {
            this.vrmLoader.stopAutoBlink?.();
            this.vrmLoader.stopLipSync?.();
            this.vrmLoader = null;
        }
        this._currentVRM = null;

        this._removeCurrentAvatar();

        if (this.currentMixer) {
            this.currentMixer.stopAllAction();
            this.currentMixer = null;
        }

        this.current = null;
        this.currentClips = [];
    }
}

// ── Auto-blink helpers (shared by VRM and GLB bridges) ──
function _startAutoBlink(loader) {
    if (loader._blinkTimer) return;
    const schedule = () => {
        const delay = 2500 + Math.random() * 4000;
        loader._blinkTimer = setTimeout(() => {
            loader.blink();
            schedule();
        }, delay);
    };
    schedule();
}

function _stopAutoBlink(loader) {
    if (loader._blinkTimer) {
        clearTimeout(loader._blinkTimer);
        loader._blinkTimer = null;
    }
}
