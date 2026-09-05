/**
 * LayerMixer — one write per bone per frame (spec v1.1 §6.6).
 *
 * Layers are stacked lowest-first. Each contributes a pose buffer and a weight; the mixer
 * walks the stack, slerping each layer's rotation over the accumulated result for the bones
 * that layer's mask covers, and applies the result to the rig exactly once.
 *
 * Three rules the rest of the engine depends on:
 *
 *   **A layer only touches what its mask covers.** An upper-body gesture leaves the legs to
 *   whatever was underneath, instead of snapping her to a default stance every time she
 *   waves.
 *
 *   **Face and look-at sit above everything.** They are always-on layers with their own
 *   masks, so lipsync keeps running underneath a full-body dance — the acceptance criterion
 *   that the mask system exists to satisfy.
 *
 *   **The base pose is the floor, not a layer.** T-pose correction and Natural Pose Style
 *   stay underneath everything, exactly as §5.P4 requires: a layer at weight 0 reveals the
 *   corrected rest pose, never a raw T-pose.
 *
 * Exposes: window.NEXUS_BD_LAYER_MIXER
 */
const LayerMixer = (() => {
    'use strict';

    const Pose =
        (typeof window !== 'undefined' && window.NEXUS_BD_POSE_BUFFER) ||
        (typeof require === 'function' ? require('./PoseBuffer.js') : null);
    const Masks =
        (typeof window !== 'undefined' && window.NEXUS_BD_BONE_MASKS) ||
        (typeof require === 'function' ? require('./BoneMasks.js') : null);

    class Mixer {
        /**
         * @param {object} [options]
         * @param {function} [options.applyBone]  (bone, quaternion) → void; the single write
         * @param {function} [options.applyHips]  (position) → void
         */
        constructor({ applyBone, applyHips } = {}) {
            this.layers = [];
            this.applyBone = applyBone || null;
            this.applyHips = applyHips || null;
            this.basePose = new Pose.Buffer();
            this._result = new Pose.Buffer();
            this.lastWriteCount = 0;
        }

        /**
         * Add a layer. `order` decides the stack: higher sits on top.
         * @param {{name: string, mask: string, order: number, weight: number, buffer: object}} layer
         */
        addLayer(layer) {
            const entry = {
                weight: 0,
                order: 0,
                mask: 'fullBody',
                buffer: new Pose.Buffer(),
                ...layer,
            };
            this.layers.push(entry);
            this.layers.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
            return entry;
        }

        removeLayer(name) {
            const i = this.layers.findIndex((layer) => layer.name === name);
            if (i >= 0) this.layers.splice(i, 1);
        }

        getLayer(name) {
            return this.layers.find((layer) => layer.name === name) || null;
        }

        /**
         * Blend the stack. Returns the resulting buffer; also applies it if the mixer was
         * given writers.
         */
        update() {
            const result = this._result;
            result.clear();

            // The floor: whatever the base pose says, before any layer speaks.
            for (const [bone, quaternion] of this.basePose.rotations) result.set(bone, quaternion);

            for (const layer of this.layers) {
                const weight = clamp01(layer.weight);
                if (weight <= 0) continue;

                for (const [bone, quaternion] of layer.buffer.rotations) {
                    if (!Masks.covers(layer.mask, bone)) continue;
                    const current = result.get(bone);
                    result.set(bone, current ? Pose.slerp(current, quaternion, weight) : quaternion.slice());
                }

                if (layer.buffer.hipsPosition && Masks.covers(layer.mask, 'hips')) {
                    result.hipsPosition = result.hipsPosition
                        ? Pose.lerp3(result.hipsPosition, layer.buffer.hipsPosition, weight)
                        : layer.buffer.hipsPosition.slice();
                }
            }

            this.lastWriteCount = 0;
            if (this.applyBone) {
                for (const [bone, quaternion] of result.rotations) {
                    this.applyBone(bone, quaternion);
                    this.lastWriteCount++;
                }
            }
            if (this.applyHips && result.hipsPosition) this.applyHips(result.hipsPosition);

            return result;
        }

        /** Which layers are currently contributing anything. For the debug HUD. */
        activeLayers() {
            return this.layers
                .filter((layer) => layer.weight > 0)
                .map((layer) => ({
                    name: layer.name,
                    mask: layer.mask,
                    weight: Math.round(layer.weight * 100) / 100,
                }));
        }
    }

    function clamp01(value) {
        return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    }

    return { Mixer };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_LAYER_MIXER = LayerMixer;
if (typeof module !== 'undefined' && module.exports) module.exports = LayerMixer;
