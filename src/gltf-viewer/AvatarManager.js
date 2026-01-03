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

        // Callbacks
        this.onAvatarChanged = null;
        this.onAvatarLoading = null;
        this.onAvatarError = null;
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
     * Load and set avatar from URL
     * @param {string} url - Avatar file URL
     * @param {string} name - Avatar name (optional)
     * @param {number} index - Avatar index (optional)
     * @returns {Promise<Object>} Loaded avatar info
     */
    async setAvatarByUrl(url, name = '', index = -1) {
        console.log(`[AvatarManager] Loading avatar: ${name || url}`);

        if (this.onAvatarLoading) {
            this.onAvatarLoading(name || url);
        }

        try {
            // Remove old avatar
            if (this.currentRoot) {
                // [FIX] Unregister from Procedural Animator before removal
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

            // Stop animations
            if (this.currentMixer) {
                this.currentMixer.stopAllAction();
                this.currentMixer = null;
            }
            this.currentClips = [];

            // Load new avatar
            const gltf = await new Promise((resolve, reject) => {
                this.loader.load(url, resolve, undefined, reject);
            });

            const root = gltf.scene || gltf.scenes?.[0];
            if (!root) {
                throw new Error('Loaded avatar has no scene root');
            }

            // Setup avatar
            root.name = `AvatarRoot:${name || url}`;
            root.position.set(0, 0, 0);
            root.rotation.set(0, 0, 0);

            // Add to scene
            this.scene.add(root);

            // Setup animations if present
            if (gltf.animations && gltf.animations.length > 0) {
                this.currentMixer = new THREE.AnimationMixer(root);
                this.currentClips = gltf.animations;
                console.log(`[AvatarManager] Loaded ${this.currentClips.length} animations`);
            }

            // Store current state
            this.current = { url, name, index };
            this.currentRoot = root;

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
     * Update animation mixer (call in render loop)
     * @param {number} delta - Time delta
     */
    update(delta) {
        if (this.currentMixer) {
            this.currentMixer.update(delta);
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

    /**
     * Cleanup all resources
     */
    dispose() {
        if (this.currentRoot) {
            this.scene.remove(this.currentRoot);
            this.disposeObject(this.currentRoot);
            this.currentRoot = null;
        }

        if (this.currentMixer) {
            this.currentMixer.stopAllAction();
            this.currentMixer = null;
        }

        this.current = null;
        this.currentClips = [];
    }
}
