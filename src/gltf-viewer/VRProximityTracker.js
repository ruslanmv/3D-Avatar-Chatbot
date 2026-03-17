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
    }

    setAvatar(root) {
        this.avatarRoot = root;
    }

    update() {
        if (!this.avatarRoot || !this.camera) {
            this.snapshot = null;
            return null;
        }

        const userHead = this.camera.getWorldPosition(this._tmpA.clone());
        const avatarPos = this.avatarRoot.getWorldPosition(this._tmpB.clone());

        const dx = userHead.x - avatarPos.x;
        const dz = userHead.z - avatarPos.z;
        const distanceXZ = Math.sqrt(dx * dx + dz * dz);
        const distance3D = userHead.distanceTo(avatarPos);

        const isSeated = userHead.y < 1.35;

        // "Wall behind avatar" detector: raycast backward from chest height
        const chestOrigin = avatarPos.clone();
        chestOrigin.y += 1.15;

        this.avatarRoot.getWorldQuaternion(this._tmpQuat);
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this._tmpQuat).setY(0).normalize();
        const backward = forward.clone().multiplyScalar(-1);

        this._raycaster.set(chestOrigin, backward);
        this._raycaster.far = 0.6;

        const blockers = [];
        this.scene.traverse((obj) => {
            if (!obj?.isMesh) return;
            if (this.avatarRoot === obj || this.avatarRoot.children.includes(obj)) return;
            if (!obj.visible) return;
            blockers.push(obj);
        });

        const hits = this._raycaster.intersectObjects(blockers, true);
        const wallBehind = hits.length > 0;

        this.snapshot = {
            userHead: userHead.clone(),
            avatarPos: avatarPos.clone(),
            distance: distance3D,
            distanceXZ,
            isSeated,
            userHeight: userHead.y,
            wallBehind,
        };

        return this.snapshot;
    }
}
