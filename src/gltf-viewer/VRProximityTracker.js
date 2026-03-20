import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

/**
 * VRProximityTracker
 * ------------------
 * Computes user/avatar relationship in XR:
 * - distance
 * - seated guess
 * - wall support behind avatar
 * - user head position
 * - avatar chest position
 */

export class VRProximityTracker {
    constructor({ scene, camera }) {
        this.scene = scene;
        this.camera = camera;
        this.avatarRoot = null;

        this._raycaster = new THREE.Raycaster();
        this._tmpA = new THREE.Vector3();
        this._tmpB = new THREE.Vector3();
        this._tmpC = new THREE.Vector3();
        this._tmpQuat = new THREE.Quaternion();

        this.snapshot = null;

        // Velocity-based seated detection:
        // Instead of a static height threshold, detect the ACT of sitting/standing
        // by tracking head height velocity over time. This handles varying user heights.
        this._isSeated = false;
        this._prevHeadY = null;
        this._headYVelocity = 0; // smoothed vertical velocity (m/s)

        // Cached scene meshes for wall detection (avoid scene.traverse every frame)
        this._cachedBlockers = null;
        this._blockerCacheAge = 0;
        /** @type {number} Max age of blocker cache in seconds before refresh */
        this._blockerCacheMaxAge = 2.0;
    }

    setAvatar(root) {
        this.avatarRoot = root;
        this._isSeated = false;
        this._prevHeadY = null;
        this._headYVelocity = 0;
        this.invalidateBlockerCache();
    }

    /** Force blocker cache to refresh on next update. */
    invalidateBlockerCache() {
        this._cachedBlockers = null;
        this._blockerCacheAge = 0;
    }

    update(dt) {
        if (!this.avatarRoot || !this.camera) {
            this.snapshot = null;
            return null;
        }

        const frameDt = dt || 0.016; // fallback to ~60fps if dt not provided

        const userHead = this.camera.getWorldPosition(this._tmpA.clone());
        const avatarPos = this.avatarRoot.getWorldPosition(this._tmpB.clone());

        const dx = userHead.x - avatarPos.x;
        const dz = userHead.z - avatarPos.z;
        const distanceXZ = Math.sqrt(dx * dx + dz * dz);
        const distance3D = userHead.distanceTo(avatarPos);

        // Velocity-based seated detection
        this._updateSeatedState(userHead.y, frameDt);

        // "Wall behind avatar" detector: raycast backward from chest height
        const chestOrigin = avatarPos.clone();
        chestOrigin.y += 1.15;

        this.avatarRoot.getWorldQuaternion(this._tmpQuat);
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this._tmpQuat).setY(0).normalize();
        const backward = forward.clone().multiplyScalar(-1);

        this._raycaster.set(chestOrigin, backward);
        this._raycaster.far = 0.6;

        const blockers = this._getBlockers(frameDt);
        const hits = this._raycaster.intersectObjects(blockers, true);
        const wallBehind = hits.length > 0;

        this.snapshot = {
            userHead: userHead.clone(),
            avatarPos: avatarPos.clone(),
            distance: distance3D,
            distanceXZ,
            isSeated: this._isSeated,
            userHeight: userHead.y,
            wallBehind,
        };

        return this.snapshot;
    }

    /**
     * Velocity-based seated detection.
     * Detects the ACT of sitting down (head drops > 0.3m quickly) rather
     * than using a static height threshold, making it robust across user heights.
     * Falls back to height threshold (< 1.35m) for initial state.
     */
    _updateSeatedState(headY, dt) {
        if (this._prevHeadY === null) {
            // First frame: fall back to static threshold
            this._prevHeadY = headY;
            this._isSeated = headY < 1.35;
            return;
        }

        // Smooth vertical velocity (exponential moving average)
        const rawVelocity = (headY - this._prevHeadY) / dt;
        this._headYVelocity += (rawVelocity - this._headYVelocity) * 0.3;
        this._prevHeadY = headY;

        // Transition: standing → seated (head drops fast AND ends low enough)
        if (!this._isSeated && this._headYVelocity < -0.2 && headY < 1.5) {
            this._isSeated = true;
        }

        // Transition: seated → standing (head rises fast AND ends high enough)
        if (this._isSeated && this._headYVelocity > 0.2 && headY > 1.2) {
            this._isSeated = false;
        }
    }

    /**
     * Get blocker meshes for wall detection, using a cached list
     * that refreshes every _blockerCacheMaxAge seconds.
     * Avoids scene.traverse() every frame for performance.
     */
    _getBlockers(dt) {
        this._blockerCacheAge += dt;

        if (this._cachedBlockers && this._blockerCacheAge < this._blockerCacheMaxAge) {
            return this._cachedBlockers;
        }

        const blockers = [];
        this.scene.traverse((obj) => {
            if (!obj?.isMesh) return;
            if (this.avatarRoot === obj || this.avatarRoot.children.includes(obj)) return;
            if (!obj.visible) return;
            blockers.push(obj);
        });

        this._cachedBlockers = blockers;
        this._blockerCacheAge = 0;
        return blockers;
    }
}
