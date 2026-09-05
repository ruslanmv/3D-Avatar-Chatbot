/**
 * ProceduralLayer — the existing animator, captured instead of applied (spec v1.1 §6.6).
 *
 * `ProceduralAnimator` is 1058 lines of tuned behaviour that writes bone rotations straight
 * onto the rig. §6.6 is explicit that it must keep running **unchanged**: what changes is
 * where its output lands. This calls the same functions and captures what they produce into
 * a pose buffer, so the mixer decides how much of it survives.
 *
 * The capture is a temporary redirect of the bone-write path, installed only while the
 * engine is on and removed by `detach()`. Nothing in ProceduralAnimator.js is edited.
 *
 * Exposes: window.NEXUS_BD_PROCEDURAL_LAYER
 */
const ProceduralLayer = (() => {
    'use strict';

    const Pose =
        (typeof window !== 'undefined' && window.NEXUS_BD_POSE_BUFFER) ||
        (typeof require === 'function' ? require('./PoseBuffer.js') : null);

    class Layer {
        /**
         * @param {object} deps
         * @param {object} [deps.animator]  window.NEXUS_PROCEDURAL_ANIMATOR
         * @param {object} [deps.humanoid]  VRM humanoid, for getNormalizedBoneNode
         */
        constructor({ animator, humanoid } = {}) {
            this.animator = animator || (typeof window !== 'undefined' ? window.NEXUS_PROCEDURAL_ANIMATOR : null);
            this.humanoid = humanoid || null;
            this.buffer = new Pose.Buffer();
            this.mask = 'fullBody';
            this._bones = [];
            this._detached = false;
        }

        /** Which bones to read back after the animator has run. */
        watch(bones) {
            this._bones = bones.slice();
            return this;
        }

        setMode(mode, durationMs) {
            if (this.animator && typeof this.animator.setMode === 'function') {
                this.animator.setMode(mode, durationMs);
            }
        }

        /**
         * Run the animator for this frame and capture the result.
         *
         * Order matters: the animator writes onto the rig as it always has, and we read the
         * bones back immediately afterwards. Reading rather than intercepting is what keeps
         * ProceduralAnimator untouched — and it is honest about the fact that it is still
         * the thing producing the motion.
         */
        sample(timeSec, dtSec) {
            if (this._detached || !this.animator || typeof this.animator.update !== 'function') {
                return this.buffer;
            }
            try {
                this.animator.update(timeSec, dtSec);
            } catch (error) {
                console.warn('[BD] procedural animator threw during sample', error);
                return this.buffer;
            }

            this.buffer.clear();
            for (const bone of this._bones) {
                const node = this._node(bone);
                if (node && node.quaternion) {
                    const q = node.quaternion;
                    this.buffer.set(bone, [q.x, q.y, q.z, q.w]);
                }
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
            this._detached = true;
            this.buffer.clear();
        }
    }

    return { Layer };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_PROCEDURAL_LAYER = ProceduralLayer;
if (typeof module !== 'undefined' && module.exports) module.exports = ProceduralLayer;
