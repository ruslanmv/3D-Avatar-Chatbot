/**
 * ClipLayer — VRMA and BVH, through the loaders that already exist (spec v1.1 §5.P4).
 *
 * `ClipAnimationLoader`, `BVHAnimationLoader` and `VRMAAnimationLoader` already handle the
 * retarget, the VRM 0.x handedness flip and the hips-height correction — five defects' worth
 * of hard-won detail (see tests/bvh-retarget.test.js). None of that is reimplemented here.
 * This samples whatever they are playing into a pose buffer so the mixer can blend it.
 *
 * Exposes: window.NEXUS_BD_CLIP_LAYER
 */
const ClipLayer = (() => {
    'use strict';

    const Pose =
        (typeof window !== 'undefined' && window.NEXUS_BD_POSE_BUFFER) ||
        (typeof require === 'function' ? require('./PoseBuffer.js') : null);

    class Layer {
        /**
         * @param {object} deps
         * @param {object} [deps.loader]    window.NEXUS_CLIP_LOADER
         * @param {object} [deps.humanoid]  VRM humanoid
         * @param {string} [deps.mask]      fullBody or upperBody
         */
        constructor({ loader, humanoid, mask = 'fullBody' } = {}) {
            this.loader = loader || (typeof window !== 'undefined' ? window.NEXUS_CLIP_LOADER : null);
            this.humanoid = humanoid || null;
            this.mask = mask;
            this.buffer = new Pose.Buffer();
            this._bones = [];
            this.playing = null;
        }

        watch(bones) {
            this._bones = bones.slice();
            return this;
        }

        /**
         * Read the rig after the loader's `THREE.AnimationMixer` has updated it.
         *
         * The mixer owns the timeline; this owns nothing but the read. Sampling after the
         * update rather than evaluating the clip ourselves means a retarget fix in the
         * loader reaches the engine for free.
         */
        sample() {
            this.buffer.clear();
            if (!this.humanoid) return this.buffer;

            for (const bone of this._bones) {
                const node = this._node(bone);
                if (node && node.quaternion) {
                    const q = node.quaternion;
                    this.buffer.set(bone, [q.x, q.y, q.z, q.w]);
                }
            }

            const hips = this._node('hips');
            if (hips && hips.position) {
                this.buffer.hipsPosition = [hips.position.x, hips.position.y, hips.position.z];
            }
            return this.buffer;
        }

        _node(bone) {
            if (!this.humanoid) return null;
            try {
                return this.humanoid.getNormalizedBoneNode(bone);
            } catch {
                return null;
            }
        }

        detach() {
            this.buffer.clear();
            this.playing = null;
        }
    }

    return { Layer };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_CLIP_LAYER = ClipLayer;
if (typeof module !== 'undefined' && module.exports) module.exports = ClipLayer;
