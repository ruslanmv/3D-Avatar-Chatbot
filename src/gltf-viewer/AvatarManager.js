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
     * Load and set avatar from URL
     * @param {string} url - Avatar file URL
     * @param {string} name - Avatar name (optional)
     * @param {number} index - Avatar index (optional)
     * @returns {Promise<Object>} Loaded avatar info
     */
    async setAvatarByUrl(url, name = '', index = -1) {
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

            // Remove old avatar
            this._removeCurrentAvatar();

            // Stop animations and dispose previous vrmLoader
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

            // Load new avatar
            const gltf = await new Promise((resolve, reject) => {
                this.loader.load(url, resolve, undefined, reject);
            });

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

            // Safety: remove any avatar that was added by a concurrent load
            // that slipped past the generation check (defensive cleanup)
            if (this.currentRoot) {
                console.warn('[AvatarManager] Removing unexpected leftover avatar before adding new one');
                this._removeCurrentAvatar();
            }

            // Setup avatar
            root.name = `AvatarRoot:${name || url}`;
            root.position.set(0, 0, 0);

            // Check for VRM data (extracted by VRMLoaderPlugin)
            const vrm = gltf.userData?.vrm;
            const isVRM = !!vrm || url.toLowerCase().endsWith('.vrm');

            // VRM models face -Z (VRM spec: forward = -Z). Camera is at +Z,
            // so rotate VRM models Math.PI to face the camera.
            root.rotation.set(0, isVRM ? Math.PI : 0, 0);

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

            // Add to scene
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
        // Cancel any in-flight loads
        this._loadGeneration++;

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
