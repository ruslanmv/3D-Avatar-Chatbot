/**
 * MRSceneUnderstanding — RATK-powered Mixed Reality scene awareness
 * ==================================================================
 * Integrates Meta's Reality Accelerator Toolkit (RATK) with our existing
 * Three.js scene graph. Provides room-aware features:
 *
 *   1) Plane detection   — floor, walls, ceiling, furniture surfaces
 *   2) Mesh detection    — 3D room geometry for occlusion/collision
 *   3) Spatial anchors   — persistent world-locked avatar placement
 *   4) Hit testing       — controller ray → real-world surface intersection
 *
 * Non-destructive: purely additive module. ARSupport.js and
 * PassthroughEnhancer.js remain untouched.
 *
 * Follows Meta's MR Design Guidelines and Project Flowerbed patterns.
 *
 * @see https://github.com/meta-quest/reality-accelerator-toolkit
 * @see https://developers.meta.com/horizon/documentation/web/webxr-mixed-reality/
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

// =========================================================================
// PLANE SEMANTIC LABELS (W3C WebXR Plane Detection Module)
// =========================================================================
const SEMANTIC = {
    FLOOR: 'floor',
    WALL: 'wall',
    CEILING: 'ceiling',
    TABLE: 'table',
    COUCH: 'couch',
    DOOR: 'door',
    WINDOW: 'window',
    OTHER: 'other',
};

// Visual material for detected planes (debug mode only)
const PLANE_COLORS = {
    [SEMANTIC.FLOOR]: 0x00ff88,
    [SEMANTIC.WALL]: 0x4488ff,
    [SEMANTIC.CEILING]: 0xffaa00,
    [SEMANTIC.TABLE]: 0xff8844,
    [SEMANTIC.COUCH]: 0xcc44ff,
    [SEMANTIC.OTHER]: 0x888888,
};

const DEFAULT_PLANE_OPACITY = 0.12;

export class MRSceneUnderstanding {
    /**
     * @param {object} opts
     * @param {THREE.Scene} opts.scene
     * @param {THREE.WebGLRenderer} opts.renderer
     * @param {THREE.Camera} opts.camera
     */
    constructor({ scene, renderer, camera }) {
        this.scene = scene;
        this.renderer = renderer;
        this.camera = camera;

        /** @type {import('ratk').RealityAccelerator|null} */
        this.ratk = null;

        // State
        this.active = false;
        this.debugVisuals = false;

        // Detected geometry (mirrors RATK sets for easy external access)
        this.floors = new Map(); // semanticLabel → plane data
        this.walls = new Map();
        this.furniture = new Map(); // tables, couches, etc.
        this.allPlanes = new Map();

        // Best floor Y (world-space) — updated as planes are detected
        this.floorY = null;
        this.floorNormal = new THREE.Vector3(0, 1, 0);

        // Spatial anchors for avatar placement
        this.avatarAnchor = null;

        // Hit test target (controller-based)
        this.hitTestTarget = null;
        this.hitTestResult = null; // latest hit test intersection

        // Callbacks for external systems
        this.onFloorDetected = null; // (floorY, floorNormal) => void
        this.onPlaneAdded = null; // (planeData) => void
        this.onPlaneRemoved = null; // (planeData) => void
        this.onAnchorCreated = null; // (anchor) => void

        // Debug group (visualizes detected planes)
        this._debugGroup = new THREE.Group();
        this._debugGroup.name = 'MRSceneUnderstanding_debug';
        this._debugGroup.visible = false;
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================

    /**
     * Initialize RATK. Call after AR session starts.
     * Dynamically imports ratk to avoid breaking non-MR builds.
     *
     * @returns {Promise<boolean>} true if RATK initialized successfully
     */
    async activate() {
        if (this.active) return true;

        try {
            // Dynamic import — RATK is only needed during MR sessions.
            // Falls back gracefully if not installed.
            const { RealityAccelerator } = await import('ratk');

            this.ratk = new RealityAccelerator(this.renderer.xr);

            // Add RATK root to scene (planes, meshes, anchors become Object3D children)
            this.scene.add(this.ratk.root);

            // Add debug visualization group
            this.scene.add(this._debugGroup);

            // Wire RATK event handlers
            this.ratk.onPlaneAdded = (plane) => this._handlePlaneAdded(plane);
            this.ratk.onPlaneDeleted = (plane) => this._handlePlaneRemoved(plane);
            this.ratk.onMeshAdded = (mesh) => this._handleMeshAdded(mesh);
            this.ratk.onMeshDeleted = (mesh) => this._handleMeshRemoved(mesh);

            // Restore any persistent anchors from previous sessions
            try {
                await this.ratk.restorePersistentAnchors();
                console.log(`[MRScene] Restored ${this.ratk.persistentAnchors.size} persistent anchors`);
            } catch {
                // Persistent anchors may not be supported — continue gracefully
            }

            this.active = true;
            console.log('[MRScene] RATK activated — room-aware MR enabled');
            return true;
        } catch (err) {
            console.warn('[MRScene] RATK not available (install via `npm i ratk`):', err.message);
            return false;
        }
    }

    /**
     * Deactivate and clean up.
     */
    deactivate() {
        if (!this.active) return;

        // Clean up debug visuals
        this._clearDebugVisuals();
        this.scene.remove(this._debugGroup);

        // Clean up RATK
        if (this.ratk) {
            this.scene.remove(this.ratk.root);
            // Clean up hit test targets
            if (this.hitTestTarget) {
                this.ratk.deleteHitTestTarget(this.hitTestTarget);
                this.hitTestTarget = null;
            }
            this.ratk = null;
        }

        // Reset state
        this.floors.clear();
        this.walls.clear();
        this.furniture.clear();
        this.allPlanes.clear();
        this.floorY = null;
        this.avatarAnchor = null;
        this.hitTestResult = null;
        this.active = false;

        console.log('[MRScene] Deactivated');
    }

    /**
     * Per-frame update. Call from render loop during AR sessions.
     */
    update() {
        if (!this.active || !this.ratk) return;

        // Sync RATK with current XR frame (updates planes, meshes, anchors)
        this.ratk.update();

        // Update hit test result
        this._updateHitTest();
    }

    // =========================================================================
    // PLANE DETECTION HANDLERS
    // =========================================================================

    /**
     * @param {import('ratk').Plane} plane
     */
    _handlePlaneAdded(plane) {
        const label = plane.semanticLabel || SEMANTIC.OTHER;

        const data = {
            plane,
            label,
            mesh: plane.planeMesh || null,
            position: new THREE.Vector3(),
            normal: new THREE.Vector3(0, 1, 0),
        };

        // Extract position from the plane's Object3D transform
        if (plane.position) {
            data.position.copy(plane.position);
        }

        this.allPlanes.set(plane, data);

        // Categorize by semantic label
        if (label === SEMANTIC.FLOOR) {
            this.floors.set(plane, data);
            this._updateFloorY();
        } else if (label === SEMANTIC.WALL) {
            this.walls.set(plane, data);
        } else if (
            label === SEMANTIC.TABLE ||
            label === SEMANTIC.COUCH ||
            label === SEMANTIC.DOOR ||
            label === SEMANTIC.WINDOW
        ) {
            this.furniture.set(plane, data);
        }

        // Debug visualization
        if (this.debugVisuals) {
            this._addPlaneDebugMesh(plane, label);
        }

        // External callback
        this.onPlaneAdded?.(data);

        console.log(`[MRScene] Plane added: ${label} at Y=${data.position.y.toFixed(2)}`);
    }

    /**
     * @param {import('ratk').Plane} plane
     */
    _handlePlaneRemoved(plane) {
        const data = this.allPlanes.get(plane);
        if (!data) return;

        this.allPlanes.delete(plane);
        this.floors.delete(plane);
        this.walls.delete(plane);
        this.furniture.delete(plane);

        if (data.label === SEMANTIC.FLOOR) {
            this._updateFloorY();
        }

        // Remove debug mesh
        this._removePlaneDebugMesh(plane);

        this.onPlaneRemoved?.(data);
    }

    _handleMeshAdded(mesh) {
        // Room meshes are auto-added to ratk.root (scene graph).
        // Make them invisible by default — they're used for occlusion/collision,
        // not for display.
        if (mesh.meshMesh) {
            mesh.meshMesh.visible = this.debugVisuals;
        }

        console.log('[MRScene] Room mesh added');
    }

    _handleMeshRemoved(_mesh) {
        // RATK handles cleanup automatically
    }

    // =========================================================================
    // FLOOR DETECTION
    // =========================================================================

    /**
     * Recalculate the best floor Y from all detected floor planes.
     * Uses the lowest floor plane (most likely the actual ground level).
     */
    _updateFloorY() {
        let lowestY = Infinity;
        let found = false;

        for (const data of this.floors.values()) {
            // Get world-space Y of the floor plane
            const y = data.plane.position?.y ?? data.position.y;
            if (y < lowestY) {
                lowestY = y;
                found = true;
            }
        }

        if (found) {
            const prev = this.floorY;
            this.floorY = lowestY;

            if (prev === null || Math.abs(prev - lowestY) > 0.01) {
                console.log(`[MRScene] Floor Y updated: ${lowestY.toFixed(3)}`);
                this.onFloorDetected?.(this.floorY, this.floorNormal);
            }
        } else {
            this.floorY = null;
        }
    }

    /**
     * Get the best floor Y, falling back to 0 if no floor detected.
     * @returns {number}
     */
    getFloorY() {
        return this.floorY ?? 0;
    }

    // =========================================================================
    // SPATIAL ANCHORS
    // =========================================================================

    /**
     * Create a spatial anchor at the given world position for avatar placement.
     * If persistent, the anchor survives across sessions.
     *
     * @param {THREE.Vector3} position World-space position
     * @param {THREE.Quaternion} [quaternion] World-space orientation
     * @param {boolean} [persistent=false] Survive across sessions
     * @returns {Promise<object|null>} The anchor object, or null on failure
     */
    async createAvatarAnchor(position, quaternion, persistent = false) {
        if (!this.ratk) return null;

        try {
            // Delete previous avatar anchor if exists
            if (this.avatarAnchor) {
                await this.ratk.deleteAnchor(this.avatarAnchor);
            }

            const q = quaternion || new THREE.Quaternion();
            this.avatarAnchor = await this.ratk.createAnchor(position, q, persistent);

            console.log(`[MRScene] Avatar anchor created (persistent: ${persistent})`);
            this.onAnchorCreated?.(this.avatarAnchor);
            return this.avatarAnchor;
        } catch (err) {
            console.warn('[MRScene] Failed to create anchor:', err.message);
            return null;
        }
    }

    /**
     * Get the current avatar anchor position (world-locked).
     * @returns {THREE.Vector3|null}
     */
    getAvatarAnchorPosition() {
        if (!this.avatarAnchor) return null;
        return new THREE.Vector3().setFromMatrixPosition(this.avatarAnchor.matrixWorld);
    }

    // =========================================================================
    // HIT TESTING
    // =========================================================================

    /**
     * Set up controller-based hit testing for surface placement.
     * @param {'left'|'right'} [handedness='right']
     */
    async enableHitTest(handedness = 'right') {
        if (!this.ratk) return;

        try {
            this.hitTestTarget = await this.ratk.createHitTestTargetFromControllerSpace(handedness);
            console.log(`[MRScene] Hit test enabled (${handedness} controller)`);
        } catch (err) {
            console.warn('[MRScene] Hit test setup failed:', err.message);
        }
    }

    _updateHitTest() {
        if (!this.hitTestTarget) return;

        // RATK updates hit test targets internally via ratk.update().
        // The hit test result is available on the target object.
        if (this.hitTestTarget.position) {
            this.hitTestResult = {
                position: this.hitTestTarget.position.clone(),
                quaternion: this.hitTestTarget.quaternion
                    ? this.hitTestTarget.quaternion.clone()
                    : new THREE.Quaternion(),
            };
        }
    }

    /**
     * Get the latest hit test result (where controller ray hits a surface).
     * @returns {{ position: THREE.Vector3, quaternion: THREE.Quaternion }|null}
     */
    getHitTestResult() {
        return this.hitTestResult;
    }

    // =========================================================================
    // FURNITURE QUERIES (for avatar sit/lean/placement)
    // =========================================================================

    /**
     * Find the nearest furniture surface (table, couch) to a world position.
     * Useful for "snap avatar to couch" or "place object on table".
     *
     * @param {THREE.Vector3} worldPos
     * @param {number} [maxDistance=2.0] Search radius in meters
     * @returns {{ label: string, position: THREE.Vector3, distance: number }|null}
     */
    findNearestFurniture(worldPos, maxDistance = 2.0) {
        let nearest = null;
        let nearestDistSq = maxDistance * maxDistance;

        for (const data of this.furniture.values()) {
            const pos = data.plane.position || data.position;
            const distSq = worldPos.distanceToSquared(pos);
            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearest = {
                    label: data.label,
                    position: pos.clone(),
                    distance: Math.sqrt(distSq),
                };
            }
        }

        return nearest;
    }

    /**
     * Get all detected planes as a summary array.
     * @returns {Array<{ label: string, position: THREE.Vector3 }>}
     */
    getPlanes() {
        const result = [];
        for (const data of this.allPlanes.values()) {
            result.push({
                label: data.label,
                position: (data.plane.position || data.position).clone(),
            });
        }
        return result;
    }

    // =========================================================================
    // DEBUG VISUALIZATION
    // =========================================================================

    /**
     * Toggle debug visualization of detected planes.
     * @param {boolean} visible
     */
    setDebugVisuals(visible) {
        this.debugVisuals = visible;
        this._debugGroup.visible = visible;

        // Update existing plane meshes visibility
        if (visible) {
            for (const [plane, data] of this.allPlanes) {
                if (!this._debugGroup.getObjectByName(`plane_${plane.id}`)) {
                    this._addPlaneDebugMesh(plane, data.label);
                }
            }
        }
    }

    _addPlaneDebugMesh(plane, label) {
        const color = PLANE_COLORS[label] || PLANE_COLORS[SEMANTIC.OTHER];

        // Use RATK's generated planeMesh geometry if available
        if (plane.planeMesh) {
            const debugMat = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: DEFAULT_PLANE_OPACITY,
                side: THREE.DoubleSide,
                depthWrite: false,
            });

            const debugMesh = new THREE.Mesh(plane.planeMesh.geometry.clone(), debugMat);
            debugMesh.name = `plane_${plane.id || Math.random()}`;
            debugMesh.renderOrder = 990;

            // Copy transform from plane
            if (plane.matrixWorld) {
                debugMesh.matrixAutoUpdate = false;
                debugMesh.matrix.copy(plane.matrixWorld);
            }

            this._debugGroup.add(debugMesh);
        }
    }

    _removePlaneDebugMesh(plane) {
        const name = `plane_${plane.id || ''}`;
        const child = this._debugGroup.getObjectByName(name);
        if (child) {
            child.geometry?.dispose();
            child.material?.dispose();
            this._debugGroup.remove(child);
        }
    }

    _clearDebugVisuals() {
        while (this._debugGroup.children.length > 0) {
            const child = this._debugGroup.children[0];
            child.geometry?.dispose();
            child.material?.dispose();
            this._debugGroup.remove(child);
        }
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================

    dispose() {
        this.deactivate();
    }
}
