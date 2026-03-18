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

    /**
     * Initialize from avatar manifest JSON
     * @param {string} manifestUrl - URL to avatars.json
     * @returns {Promise<Array>} Array of avatar items
     */
    async initFromManifest(manifestUrl) {
        try {
            const res = await fetch(manifestUrl, { cache: 'no-store' });
            if (!res.ok) {
                throw new Error(`Avatar manifest fetch failed: ${res.status}`);
            }

            const data = await res.json();
            this.basePath = (data.basePath || '/vendor/avatars').replace(/\/$/, '');
            this.avatars = (data.items || []).map((item) => ({
                name: item.name,
                file: item.file,
                url: `${this.basePath}/${item.file}`,
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
