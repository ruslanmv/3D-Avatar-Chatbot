import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

/**
 * VRContactAnchors
 * ----------------
 * World-space soft contact anchors attached to avatar bones.
 * These are NOT explicit interaction points; they are general close-contact points
 * for hands, shoulders, chest, head, and hips.
 */

const ANCHOR_DEFS = [
    { key: 'head', boneKey: 'head', radius: 0.1, color: 0xff88cc },
    { key: 'chest', boneKey: 'chest', radius: 0.11, color: 0x66ccff },
    { key: 'hips', boneKey: 'hips', radius: 0.12, color: 0x88ff88 },
    { key: 'leftShoulder', boneKey: 'leftShoulder', radius: 0.08, color: 0xffcc66 },
    { key: 'rightShoulder', boneKey: 'rightShoulder', radius: 0.08, color: 0xffcc66 },
    { key: 'leftHand', boneKey: 'leftHand', radius: 0.07, color: 0x40e0ff },
    { key: 'rightHand', boneKey: 'rightHand', radius: 0.07, color: 0x40e0ff },
];

export class VRContactAnchors {
    constructor({ scene, poseSystem }) {
        this.scene = scene;
        this.poseSystem = poseSystem;

        this.avatarRoot = null;
        this.anchors = new Map();
        this.visible = false;
        this.debug = false;
    }

    setAvatar(root) {
        this.avatarRoot = root;
        this.dispose();
        if (!root) return;

        for (const def of ANCHOR_DEFS) {
            const bone = this._getBone(def.boneKey);
            if (!bone) continue;

            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(def.radius, 16, 16),
                new THREE.MeshBasicMaterial({
                    color: def.color,
                    transparent: true,
                    opacity: 0.18,
                    depthWrite: false,
                })
            );

            mesh.visible = this.visible || this.debug;
            mesh.renderOrder = 997;
            mesh.userData.contactAnchor = {
                key: def.key,
                boneKey: def.boneKey,
                radius: def.radius,
            };

            this.scene.add(mesh);
            this.anchors.set(def.key, {
                def,
                mesh,
                bone,
                hovered: false,
                active: false,
            });
        }
    }

    setVisible(visible) {
        this.visible = !!visible;
        for (const entry of this.anchors.values()) {
            entry.mesh.visible = this.visible || this.debug;
        }
    }

    setDebug(debug) {
        this.debug = !!debug;
        for (const entry of this.anchors.values()) {
            entry.mesh.visible = this.visible || this.debug;
        }
    }

    update() {
        for (const entry of this.anchors.values()) {
            if (!entry.bone) continue;
            entry.bone.getWorldPosition(entry.mesh.position);
        }
    }

    getAnchor(key) {
        return this.anchors.get(key) || null;
    }

    getAll() {
        return [...this.anchors.values()];
    }

    clearVisualState() {
        for (const entry of this.anchors.values()) {
            entry.hovered = false;
            entry.active = false;
            if (entry.mesh?.material) {
                entry.mesh.material.opacity = this.debug ? 0.18 : 0.12;
                entry.mesh.scale.setScalar(1);
            }
        }
    }

    setAnchorHovered(key, hovered) {
        const entry = this.anchors.get(key);
        if (!entry) return;
        entry.hovered = !!hovered;
        if (entry.mesh?.material) {
            entry.mesh.material.opacity = hovered ? 0.42 : this.debug ? 0.18 : 0.12;
            entry.mesh.scale.setScalar(hovered ? 1.12 : 1);
        }
    }

    setAnchorActive(key, active) {
        const entry = this.anchors.get(key);
        if (!entry) return;
        entry.active = !!active;
        if (entry.mesh?.material) {
            entry.mesh.material.opacity = active ? 0.66 : this.debug ? 0.18 : 0.12;
            entry.mesh.scale.setScalar(active ? 1.18 : 1);
        }
    }

    findNearest(point, maxDistance = 0.18, allowedKeys = null) {
        let best = null;
        let bestDist = Infinity;

        for (const [key, entry] of this.anchors.entries()) {
            if (allowedKeys && !allowedKeys.includes(key)) continue;

            const d = entry.mesh.position.distanceTo(point);
            if (d <= maxDistance && d < bestDist) {
                best = { key, entry, distance: d };
                bestDist = d;
            }
        }

        return best;
    }

    _getBone(boneKey) {
        if (typeof this.poseSystem?.getBone === 'function') {
            return this.poseSystem.getBone(boneKey);
        }
        return this.poseSystem?._bones?.get(boneKey) || null;
    }

    dispose() {
        for (const entry of this.anchors.values()) {
            entry.mesh?.geometry?.dispose?.();
            entry.mesh?.material?.dispose?.();
            entry.mesh?.parent?.remove?.(entry.mesh);
        }
        this.anchors.clear();
    }
}
