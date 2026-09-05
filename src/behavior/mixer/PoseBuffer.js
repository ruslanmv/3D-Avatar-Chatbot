/**
 * PoseBuffer — the one thing every layer speaks (spec v1.1 §6.6).
 *
 * §6.6 calls pose-buffer blending "the one hard problem", and the hard part is not the
 * slerp: it is that three animation sources in this app write bones *directly* and at
 * different times. The procedural animator sets bone rotations, the clip loaders drive a
 * `THREE.AnimationMixer`, and the pose library applies a saved pose. Whoever writes last
 * wins, and the result is the pop.
 *
 * A pose buffer is the fix. Each layer writes into its own buffer instead of onto the rig;
 * the mixer blends the buffers and performs exactly one write per bone per frame.
 *
 * The buffer is a plain map of normalized bone name → quaternion `[x, y, z, w]`, plus an
 * optional hips position. No THREE: this is arithmetic, it is the part most likely to be
 * subtly wrong, and it should be testable without a renderer.
 *
 * Exposes: window.NEXUS_BD_POSE_BUFFER
 */
const PoseBuffer = (() => {
    'use strict';

    class Buffer {
        constructor() {
            this.rotations = new Map(); // bone → [x, y, z, w]
            this.hipsPosition = null; // [x, y, z] or null
            this.weight = 1;
        }

        set(bone, quaternion) {
            this.rotations.set(bone, quaternion);
            return this;
        }

        get(bone) {
            return this.rotations.get(bone) || null;
        }

        has(bone) {
            return this.rotations.has(bone);
        }

        clear() {
            this.rotations.clear();
            this.hipsPosition = null;
            return this;
        }

        get bones() {
            return [...this.rotations.keys()];
        }
    }

    const IDENTITY = [0, 0, 0, 1];

    /**
     * Spherical linear interpolation between two quaternions.
     *
     * The double-cover fix matters more than it looks: `q` and `-q` are the same rotation,
     * but interpolating between them the long way round spins the bone most of the way
     * around its axis. That is the pop. Flipping the sign when the dot product is negative
     * is the whole difference between a crossfade and a snap.
     */
    function slerp(a, b, t) {
        if (t <= 0) return a.slice();
        if (t >= 1) return b.slice();

        let [bx, by, bz, bw] = b;
        let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;

        if (dot < 0) {
            bx = -bx;
            by = -by;
            bz = -bz;
            bw = -bw;
            dot = -dot;
        }

        // Nearly parallel: lerp and normalise. sin(theta) approaches zero and the general
        // form loses all its precision right where it is used most — a short crossfade.
        if (dot > 0.9995) {
            return normalize([
                a[0] + (bx - a[0]) * t,
                a[1] + (by - a[1]) * t,
                a[2] + (bz - a[2]) * t,
                a[3] + (bw - a[3]) * t,
            ]);
        }

        const theta = Math.acos(Math.min(1, dot));
        const sinTheta = Math.sin(theta);
        const wa = Math.sin((1 - t) * theta) / sinTheta;
        const wb = Math.sin(t * theta) / sinTheta;

        return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
    }

    function normalize(q) {
        const length = Math.hypot(q[0], q[1], q[2], q[3]);
        if (length === 0) return IDENTITY.slice();
        return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
    }

    function lerp3(a, b, t) {
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }

    /** Angle between two rotations, radians. Used by the pop detector in the tests. */
    function angleBetween(a, b) {
        const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
        return 2 * Math.acos(Math.min(1, dot));
    }

    return { Buffer, slerp, normalize, lerp3, angleBetween, IDENTITY };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_POSE_BUFFER = PoseBuffer;
if (typeof module !== 'undefined' && module.exports) module.exports = PoseBuffer;
