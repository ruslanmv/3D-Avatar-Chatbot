/**
 * PoseLayer — a saved pose is a one-frame clip (spec v1.1 §4A).
 *
 * `PoseLibrary` already stores what Pose Studio saves, and `PoseApplier` already knows how
 * to put one on a rig. A pose has no timeline, so as a layer it is the simplest of the
 * three: fill the buffer once, and let the scheduler fade it like anything else.
 *
 * That last part is the point. Before this, applying a pose was a snap, because there was
 * nothing to fade it against. As a layer it crossfades from whatever was playing.
 *
 * Exposes: window.NEXUS_BD_POSE_LAYER
 */
const PoseLayer = (() => {
    'use strict';

    const Pose =
        (typeof window !== 'undefined' && window.NEXUS_BD_POSE_BUFFER) ||
        (typeof require === 'function' ? require('./PoseBuffer.js') : null);

    class Layer {
        constructor({ library, mask = 'fullBody' } = {}) {
            this.library = library || (typeof window !== 'undefined' ? window.NEXUS_POSE_LIBRARY : null);
            this.mask = mask;
            this.buffer = new Pose.Buffer();
            this.poseId = null;
        }

        /**
         * Load a saved pose into the buffer.
         * @returns {boolean} whether anything was loaded
         */
        setPose(poseId) {
            this.buffer.clear();
            this.poseId = null;
            if (!this.library || typeof this.library.get !== 'function') return false;

            let pose;
            try {
                pose = this.library.get(poseId);
            } catch {
                return false;
            }
            if (!pose || !pose.bones) return false;

            for (const [bone, value] of Object.entries(pose.bones)) {
                const q = toQuaternion(value);
                if (q) this.buffer.set(bone, q);
            }
            this.poseId = poseId;
            return this.buffer.bones.length > 0;
        }

        sample() {
            return this.buffer;
        }

        detach() {
            this.buffer.clear();
            this.poseId = null;
        }
    }

    /** Poses are stored as quaternions or as Euler triples, depending on their vintage. */
    function toQuaternion(value) {
        if (Array.isArray(value) && value.length === 4) return value.slice();
        if (Array.isArray(value) && value.length === 3) return eulerToQuaternion(value[0], value[1], value[2]);
        if (value && typeof value === 'object') {
            if (Number.isFinite(value.w)) return [value.x || 0, value.y || 0, value.z || 0, value.w];
            if (Number.isFinite(value.x)) return eulerToQuaternion(value.x, value.y || 0, value.z || 0);
        }
        return null;
    }

    /** XYZ order, matching PoseApplier. */
    function eulerToQuaternion(x, y, z) {
        const [cx, cy, cz] = [Math.cos(x / 2), Math.cos(y / 2), Math.cos(z / 2)];
        const [sx, sy, sz] = [Math.sin(x / 2), Math.sin(y / 2), Math.sin(z / 2)];
        return [
            sx * cy * cz + cx * sy * sz,
            cx * sy * cz - sx * cy * sz,
            cx * cy * sz + sx * sy * cz,
            cx * cy * cz - sx * sy * sz,
        ];
    }

    return { Layer, toQuaternion, eulerToQuaternion };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_POSE_LAYER = PoseLayer;
if (typeof module !== 'undefined' && module.exports) module.exports = PoseLayer;
