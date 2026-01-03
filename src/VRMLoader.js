/**
 * VRM Avatar Loader with WebXR Support
 * Handles loading and managing VRM avatars for both desktop and VR modes
 */

class VRMLoader {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.currentVRM = null;
        this.clock = new THREE.Clock();
        this.mixer = null;
        this.animations = {};
    }

    /**
     * Load VRM file from URL
     * @param {string} url - URL to VRM file
     * @returns {Promise} Promise that resolves when VRM is loaded
     */
    async loadVRM(url) {
        try {
            // Check if three-vrm library is available
            if (typeof window.THREE_VRM === 'undefined') {
                console.warn('[VRMLoader] three-vrm library not loaded, falling back to GLB loader');
                return this.loadAsGLB(url);
            }

            const loader = new THREE_VRM.VRMLoaderPlugin();
            const gltfLoader = new THREE.GLTFLoader();
            gltfLoader.register((parser) => loader);

            return new Promise((resolve, reject) => {
                gltfLoader.load(
                    url,
                    (gltf) => {
                        const vrm = gltf.userData.vrm;

                        if (vrm) {
                            // VRM successfully loaded
                            this.setupVRM(vrm);
                            resolve(vrm);
                        } else {
                            // No VRM data, treat as regular GLB
                            this.setupGLB(gltf.scene);
                            resolve(gltf.scene);
                        }
                    },
                    (progress) => {
                        const percent = (progress.loaded / progress.total) * 100;
                        console.log(`[VRMLoader] Loading: ${percent.toFixed(1)}%`);
                    },
                    (error) => {
                        console.error('[VRMLoader] Load error:', error);
                        reject(error);
                    }
                );
            });
        } catch (error) {
            console.error('[VRMLoader] Error:', error);
            throw error;
        }
    }

    /**
     * Load as standard GLB file (fallback)
     */
    async loadAsGLB(url) {
        const loader = new THREE.GLTFLoader();

        return new Promise((resolve, reject) => {
            loader.load(
                url,
                (gltf) => {
                    this.setupGLB(gltf.scene);
                    resolve(gltf.scene);
                },
                (progress) => {
                    const percent = (progress.loaded / progress.total) * 100;
                    console.log(`[VRMLoader] Loading GLB: ${percent.toFixed(1)}%`);
                },
                (error) => {
                    console.error('[VRMLoader] GLB load error:', error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Setup VRM avatar
     */
    setupVRM(vrm) {
        // Remove previous avatar
        if (this.currentVRM) {
            this.scene.remove(this.currentVRM.scene);
        }

        this.currentVRM = vrm;

        // Fix common VRM issues
        if (window.THREE_VRM && window.THREE_VRM.VRMUtils) {
            THREE_VRM.VRMUtils.removeUnnecessaryVertices(vrm.scene);
            THREE_VRM.VRMUtils.removeUnnecessaryJoints(vrm.scene);
        }

        // Position avatar
        vrm.scene.rotation.y = Math.PI; // Face camera
        vrm.scene.position.set(0, 0, 0);

        // Fix T-pose to A-pose
        this.fixTPose(vrm);

        // Add to scene
        this.scene.add(vrm.scene);

        console.log('[VRMLoader] VRM loaded successfully');
    }

    /**
     * Setup regular GLB model
     */
    setupGLB(model) {
        // Remove previous avatar
        if (this.currentVRM && this.currentVRM.scene) {
            this.scene.remove(this.currentVRM.scene);
        }

        this.currentVRM = { scene: model, isGLB: true };

        // Position model
        model.rotation.y = Math.PI;
        model.position.set(0, 0, 0);

        // Setup animation mixer if animations exist
        const gltf = model.userData.gltf;
        if (gltf && gltf.animations && gltf.animations.length > 0) {
            this.mixer = new THREE.AnimationMixer(model);
            gltf.animations.forEach((clip, index) => {
                this.animations[clip.name || `animation_${index}`] = clip;
            });
        }

        // Add to scene
        this.scene.add(model);

        console.log('[VRMLoader] GLB loaded successfully');
    }

    /**
     * Fix T-pose to natural A-pose
     */
    fixTPose(vrm) {
        if (!vrm.humanoid) return;

        try {
            const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');

            if (leftUpperArm) {
                leftUpperArm.rotation.z = Math.PI / 3; // ~60 degrees
            }
            if (rightUpperArm) {
                rightUpperArm.rotation.z = -Math.PI / 3;
            }
        } catch (error) {
            console.warn('[VRMLoader] Could not fix T-pose:', error);
        }
    }

    /**
     * Update avatar (call in animation loop)
     */
    update() {
        const delta = this.clock.getDelta();

        if (this.currentVRM) {
            // Update VRM
            if (this.currentVRM.update) {
                this.currentVRM.update(delta);
            }

            // Update animations
            if (this.mixer) {
                this.mixer.update(delta);
            }
        }
    }

    /**
     * Set expression (for VRM avatars)
     * @param {string} name - Expression name (e.g., 'happy', 'angry', 'neutral')
     * @param {number} value - Value 0-1
     */
    setExpression(name, value = 1.0) {
        if (!this.currentVRM || !this.currentVRM.expressionManager) {
            return;
        }

        try {
            this.currentVRM.expressionManager.setValue(name, value);
        } catch (error) {
            console.warn(`[VRMLoader] Could not set expression '${name}':`, error);
        }
    }

    /**
     * Trigger blinking animation
     */
    blink() {
        if (!this.currentVRM || !this.currentVRM.expressionManager) {
            return;
        }

        try {
            this.setExpression('blink', 1.0);
            setTimeout(() => this.setExpression('blink', 0.0), 150);
        } catch (error) {
            console.warn('[VRMLoader] Could not trigger blink:', error);
        }
    }

    /**
     * Play talking animation with mouth shapes
     * @param {number} intensity - How much to open mouth (0-1)
     */
    talk(intensity = 0.5) {
        if (!this.currentVRM || !this.currentVRM.expressionManager) {
            return;
        }

        try {
            // Use 'aa' viseme for talking
            this.setExpression('aa', intensity);
        } catch (error) {
            console.warn('[VRMLoader] Could not animate talking:', error);
        }
    }

    /**
     * Stop talking animation
     */
    stopTalking() {
        if (!this.currentVRM || !this.currentVRM.expressionManager) {
            return;
        }

        try {
            this.setExpression('aa', 0);
        } catch (error) {
            console.warn('[VRMLoader] Could not stop talking:', error);
        }
    }

    /**
     * Get current avatar root object
     */
    getAvatar() {
        return this.currentVRM;
    }

    /**
     * Dispose of current avatar
     */
    dispose() {
        if (this.currentVRM && this.currentVRM.scene) {
            this.scene.remove(this.currentVRM.scene);
            this.currentVRM = null;
        }

        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer = null;
        }

        this.animations = {};
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VRMLoader;
} else {
    window.VRMLoader = VRMLoader;
}
