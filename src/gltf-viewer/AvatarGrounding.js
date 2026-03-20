/**
 * AvatarGrounding — Room-aware avatar floor placement
 * =====================================================
 * Uses MRSceneUnderstanding (RATK) plane detection to ground the avatar
 * on the real-world floor and optionally snap to furniture surfaces.
 *
 * Responsibilities:
 *   1) Floor alignment — avatar Y position matches detected floor
 *   2) Persistent placement — anchors avatar position across sessions
 *   3) Furniture snap — sit avatar on detected couch / table (future)
 *   4) Smooth transitions — spring-damped Y adjustment (no jarring jumps)
 *
 * Non-destructive: purely additive. PassthroughEnhancer contact shadow
 * and ARSupport floor detection remain operational as fallbacks.
 *
 * Architecture:
 *   MRSceneUnderstanding → onFloorDetected → AvatarGrounding → avatar.position.y
 *
 * @see Spatial Fusion (Meta + PHORIA) for reference grounding quality
 * @see Project Flowerbed for ECS-like update pattern
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

// Spring-damped smoothing for Y transitions (prevents jarring snaps)
const SPRING_STIFFNESS = 12; // Higher = faster settle
const SPRING_DAMPING = 6; // Critical damping ≈ 2√k

export class AvatarGrounding {
    /**
     * @param {object} opts
     * @param {THREE.Scene} opts.scene
     */
    constructor({ scene }) {
        this.scene = scene;

        /** @type {import('./MRSceneUnderstanding.js').MRSceneUnderstanding|null} */
        this.mrScene = null;

        // Target avatar root
        this.avatarRoot = null;

        // State
        this.active = false;
        this.mode = 'floor'; // 'floor' | 'anchor' | 'manual'

        // Floor tracking
        this._targetFloorY = 0;
        this._currentFloorY = 0;
        this._floorVelocity = 0;
        this._floorDetected = false;

        // Manual offset (user can raise/lower avatar above floor)
        this._yOffset = 0;

        // Anchor-based position (XZ from spatial anchor)
        this._anchoredPosition = null;

        // Saved pre-grounding position (for clean restore)
        this._savedPosition = null;
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================

    /**
     * Activate grounding. Connects to MRSceneUnderstanding for floor updates.
     *
     * @param {THREE.Object3D} avatarRoot - The avatar's root Object3D
     * @param {import('./MRSceneUnderstanding.js').MRSceneUnderstanding} mrScene
     */
    activate(avatarRoot, mrScene) {
        if (this.active) return;

        this.avatarRoot = avatarRoot;
        this.mrScene = mrScene;

        // Save current position for clean restore on deactivate
        if (avatarRoot) {
            this._savedPosition = avatarRoot.position.clone();
        }

        // Wire floor detection callback
        if (mrScene) {
            mrScene.onFloorDetected = (floorY) => {
                this._onFloorDetected(floorY);
            };
        }

        // If MRScene already has a floor, use it immediately
        if (mrScene?.floorY !== null) {
            this._onFloorDetected(mrScene.floorY);
        }

        this.active = true;
        console.log('[AvatarGrounding] Activated');
    }

    /**
     * Deactivate and restore avatar to original position.
     */
    deactivate() {
        if (!this.active) return;

        // Restore saved position
        if (this.avatarRoot && this._savedPosition) {
            this.avatarRoot.position.copy(this._savedPosition);
        }

        // Disconnect from MRScene
        if (this.mrScene) {
            this.mrScene.onFloorDetected = null;
        }

        this.avatarRoot = null;
        this.mrScene = null;
        this.active = false;
        this._floorDetected = false;
        this._anchoredPosition = null;
        this._savedPosition = null;

        console.log('[AvatarGrounding] Deactivated');
    }

    // =========================================================================
    // PER-FRAME UPDATE
    // =========================================================================

    /**
     * Update avatar grounding. Call from render loop.
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (!this.active || !this.avatarRoot) return;

        if (this.mode === 'floor' && this._floorDetected) {
            this._updateFloorGrounding(dt);
        } else if (this.mode === 'anchor' && this._anchoredPosition) {
            this._updateAnchorGrounding(dt);
        }
    }

    /**
     * Spring-damped floor Y tracking.
     * @param {number} dt
     */
    _updateFloorGrounding(dt) {
        const target = this._targetFloorY + this._yOffset;
        const error = target - this._currentFloorY;

        // Critical-damped spring: F = -k*x - d*v
        const springForce = SPRING_STIFFNESS * error;
        const dampForce = -SPRING_DAMPING * this._floorVelocity;

        this._floorVelocity += (springForce + dampForce) * dt;
        this._currentFloorY += this._floorVelocity * dt;

        // Apply to avatar
        this.avatarRoot.position.y = this._currentFloorY;
    }

    /**
     * Anchor-based grounding: avatar position follows spatial anchor.
     * @param {number} dt
     */
    _updateAnchorGrounding(dt) {
        if (!this.mrScene?.avatarAnchor) return;

        const anchorPos = this.mrScene.getAvatarAnchorPosition();
        if (!anchorPos) return;

        // Smooth lerp toward anchor position (XZ only, Y from floor)
        const lerpFactor = 1 - Math.exp(-SPRING_STIFFNESS * dt);

        this.avatarRoot.position.x = THREE.MathUtils.lerp(this.avatarRoot.position.x, anchorPos.x, lerpFactor);
        this.avatarRoot.position.z = THREE.MathUtils.lerp(this.avatarRoot.position.z, anchorPos.z, lerpFactor);

        // Y still follows floor
        if (this._floorDetected) {
            this._updateFloorGrounding(dt);
        }
    }

    // =========================================================================
    // FLOOR DETECTION CALLBACK
    // =========================================================================

    /**
     * @param {number} floorY - World-space Y of detected floor
     */
    _onFloorDetected(floorY) {
        this._floorDetected = true;
        this._targetFloorY = floorY;

        // On first detection, snap immediately (no spring animation)
        if (this._currentFloorY === 0 && this.avatarRoot) {
            this._currentFloorY = floorY;
            this._floorVelocity = 0;
            this.avatarRoot.position.y = floorY + this._yOffset;
        }

        console.log(`[AvatarGrounding] Floor at Y=${floorY.toFixed(3)}`);
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Set vertical offset above floor (meters).
     * Use for floating avatar, elevated platforms, etc.
     * @param {number} offset
     */
    setYOffset(offset) {
        this._yOffset = offset;
    }

    /**
     * Switch grounding mode.
     * @param {'floor'|'anchor'|'manual'} mode
     */
    setMode(mode) {
        this.mode = mode;
        console.log(`[AvatarGrounding] Mode: ${mode}`);
    }

    /**
     * Place avatar at a specific world position and create a spatial anchor.
     * @param {THREE.Vector3} position
     * @param {boolean} [persistent=false]
     */
    async placeAtPosition(position, persistent = false) {
        if (!this.avatarRoot || !this.mrScene) return;

        // Move avatar immediately
        this.avatarRoot.position.copy(position);
        this._currentFloorY = position.y;
        this._targetFloorY = position.y;
        this._floorVelocity = 0;

        // Create anchor for persistence
        const anchor = await this.mrScene.createAvatarAnchor(position, this.avatarRoot.quaternion, persistent);

        if (anchor) {
            this._anchoredPosition = position.clone();
            this.mode = 'anchor';
        }
    }

    /**
     * Place avatar using controller hit test (point at floor → place).
     * @param {boolean} [persistent=false]
     * @returns {boolean} true if placement succeeded
     */
    async placeAtHitTest(persistent = false) {
        if (!this.mrScene) return false;

        const hit = this.mrScene.getHitTestResult();
        if (!hit) return false;

        await this.placeAtPosition(hit.position, persistent);
        return true;
    }

    /**
     * @returns {boolean} true if a real floor has been detected
     */
    isFloorDetected() {
        return this._floorDetected;
    }

    /**
     * @returns {number} Current avatar ground Y (with spring smoothing applied)
     */
    getCurrentFloorY() {
        return this._currentFloorY;
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================

    dispose() {
        this.deactivate();
    }
}
