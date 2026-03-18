/**
 * DesktopShadowEnhancer — AAA-quality desktop shadow grounding
 * =============================================================
 * Provides industry-standard character grounding for desktop mode:
 *
 * 1) Contact Shadow — Soft radial gradient blob under avatar's feet
 *    (same technique used by Sketchfab, Ready Player Me, VRoid Hub)
 * 2) Tightened Shadow Frustum — Fits directional light shadow camera
 *    precisely to avatar bounds for maximum shadow map utilization
 * 3) Self-Shadow Prevention — Disables receiveShadow on avatar meshes
 *    to prevent starburst/fan artifacts on thin anime geometry
 *
 * Non-destructive: purely additive module. Does not remove or replace
 * existing shadow infrastructure — enhances it.
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

export class DesktopShadowEnhancer {
    constructor({ scene, directionalLight }) {
        this.scene = scene;
        this.directionalLight = directionalLight;

        // Contact shadow mesh (soft blob under feet)
        this.contactShadow = null;
        this._avatarRoot = null;
        this._avatarBounds = null; // cached bounding box

        this._enabled = false;
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================

    /**
     * Enable desktop shadow enhancements.
     * Safe to call multiple times (idempotent).
     */
    enable() {
        if (this._enabled) return;
        this._enabled = true;

        this._createContactShadow();
        this._applyTunedShadowSettings();

        console.log('[DesktopShadowEnhancer] Enabled — contact shadow + tuned frustum');
    }

    /**
     * Disable and clean up.
     */
    disable() {
        if (!this._enabled) return;
        this._enabled = false;

        this._removeContactShadow();

        console.log('[DesktopShadowEnhancer] Disabled');
    }

    // =========================================================================
    // CONTACT SHADOW (soft radial gradient — industry standard for grounding)
    // =========================================================================

    _createContactShadow() {
        if (this.contactShadow) return;

        // Canvas-based radial gradient texture (soft circular shadow)
        // Higher resolution than AR version for desktop quality
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Multi-stop radial gradient: dense center → soft falloff → transparent
        // Tuned for anime characters (narrower body, wider stance)
        const cx = size / 2;
        const cy = size / 2;
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
        gradient.addColorStop(0.0, 'rgba(0, 0, 0, 0.28)');
        gradient.addColorStop(0.15, 'rgba(0, 0, 0, 0.22)');
        gradient.addColorStop(0.35, 'rgba(0, 0, 0, 0.12)');
        gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.04)');
        gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        // Slightly wider than avatar for natural look
        const geometry = new THREE.PlaneGeometry(1.5, 1.5);
        geometry.rotateX(-Math.PI / 2);

        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            blending: THREE.NormalBlending,
            // Prevent z-fighting with ShadowMaterial ground plane
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
        });

        this.contactShadow = new THREE.Mesh(geometry, material);
        this.contactShadow.name = 'DesktopContactShadow';
        this.contactShadow.renderOrder = -1;
        this.contactShadow.frustumCulled = false;
        this.scene.add(this.contactShadow);
    }

    _removeContactShadow() {
        if (this.contactShadow) {
            this.scene.remove(this.contactShadow);
            this.contactShadow.geometry?.dispose();
            this.contactShadow.material?.map?.dispose();
            this.contactShadow.material?.dispose();
            this.contactShadow = null;
        }
    }

    // =========================================================================
    // SHADOW CAMERA TUNING (AAA-grade shadow quality)
    // =========================================================================

    /**
     * Apply production-grade shadow settings to the directional light.
     * These override the defaults with values optimized for character viewers.
     */
    _applyTunedShadowSettings() {
        if (!this.directionalLight) return;

        const light = this.directionalLight;

        // Higher shadow map resolution for desktop (no mobile perf concern)
        light.shadow.mapSize.width = 2048;
        light.shadow.mapSize.height = 2048;

        // Tuned bias to prevent shadow acne on anime geometry
        // normalBias is the key one — pushes shadow sampling along surface normals
        // which prevents thin-surface artifacts (stockings, hair strands, ribbons)
        light.shadow.bias = -0.0003;
        light.shadow.normalBias = 0.04;

        // Soft shadow edge (PCFSoft radius)
        light.shadow.radius = 4;

        // Force shadow map recompilation with new settings
        if (light.shadow.map) {
            light.shadow.map.dispose();
            light.shadow.map = null;
        }
    }

    /**
     * Fit shadow camera tightly to avatar bounding box.
     * Called from ViewerEngine._fitShadowCamera after avatar loads.
     *
     * @param {THREE.Box3} box    - Avatar world bounding box
     * @param {THREE.Vector3} center - Box center
     * @param {THREE.Vector3} size   - Box dimensions
     */
    fitToAvatar(box, center, size) {
        if (!this.directionalLight) return;

        this._avatarBounds = { box, center: center.clone(), size: size.clone() };

        const cam = this.directionalLight.shadow.camera;

        // Tight frustum: just enough to cover the avatar with minimal padding
        // This maximizes texel density → crisp shadows
        const padX = Math.max(size.x * 0.15, 0.2);
        const padY = Math.max(size.y * 0.1, 0.2);

        cam.left = -(size.x / 2 + padX);
        cam.right = size.x / 2 + padX;
        cam.top = size.y + padY;
        cam.bottom = -0.1; // Slight below floor to catch feet
        cam.near = 0.1;
        // Tight far plane: just enough to cover avatar depth + light offset
        cam.far = Math.max(size.y * 2, size.z + 4);
        cam.updateProjectionMatrix();

        // Position light for optimal shadow angle (above-front-right)
        // Closer light → less perspective distortion in orthographic shadow
        this.directionalLight.position.set(
            center.x + size.x * 0.6,
            center.y + size.y * 0.9,
            center.z + size.z * 0.8 + 1.0
        );
        this.directionalLight.target.position.copy(center);
        this.directionalLight.target.updateMatrixWorld();

        // Scale contact shadow to match avatar width
        if (this.contactShadow) {
            const footprint = Math.max(size.x * 1.2, 0.8);
            this.contactShadow.scale.set(footprint, 1, footprint);
        }

        // Position contact shadow at avatar's feet
        this._positionContactShadow(box.min.y);
    }

    /**
     * Position the contact shadow at the avatar's foot level.
     * @param {number} floorY - Y position of avatar's feet
     */
    _positionContactShadow(floorY) {
        if (!this.contactShadow) return;
        // Slightly above floor to prevent z-fighting
        this.contactShadow.position.y = floorY + 0.003;
    }

    // =========================================================================
    // AVATAR MESH SHADOW CONFIGURATION
    // =========================================================================

    /**
     * Configure avatar meshes for optimal shadow rendering.
     *
     * KEY INSIGHT: Avatar meshes should castShadow but NOT receiveShadow.
     * Self-shadowing on thin anime geometry (stockings, hair, ribbons)
     * produces the "starburst/fan" artifacts seen in the bug screenshot.
     *
     * The ground ShadowMaterial plane handles shadow receiving.
     *
     * @param {THREE.Object3D} root - Avatar root object
     * @param {boolean} enabled - Whether shadows are enabled
     */
    configureAvatarShadows(root, enabled) {
        if (!root) return;

        root.traverse((node) => {
            if (node.isMesh) {
                node.castShadow = enabled;
                // NEVER set receiveShadow on avatar meshes —
                // prevents self-shadow artifacts on thin geometry
                node.receiveShadow = false;
            }
        });
    }

    // =========================================================================
    // PER-FRAME UPDATE
    // =========================================================================

    /**
     * Update contact shadow position to follow avatar.
     * Call from animation loop.
     *
     * @param {THREE.Object3D|null} avatarRoot
     */
    update(avatarRoot) {
        if (!this._enabled || !this.contactShadow) return;

        if (avatarRoot && avatarRoot !== this._avatarRoot) {
            this._avatarRoot = avatarRoot;
        }

        if (this._avatarRoot) {
            this.contactShadow.position.x = this._avatarRoot.position.x;
            this.contactShadow.position.z = this._avatarRoot.position.z;
        }
    }

    // =========================================================================
    // DISPOSE
    // =========================================================================

    dispose() {
        this.disable();
        this._avatarRoot = null;
        this._avatarBounds = null;
    }
}
