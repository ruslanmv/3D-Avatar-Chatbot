/**
 * MotionPoseRestore — "she returns exactly as she was."
 *
 * Before the Living NPC plays its first clip of a sequence (a dance, a wave,
 * a bow…), the current skeleton is snapshotted: every normalized humanoid
 * bone rotation, the hips' local position (BVH clips animate it and leave a
 * visible displacement behind), and the avatar root's position. When the
 * sequence ends — a "stop", or a one-shot clip finishing — the body settles
 * back to that snapshot over a short eased blend instead of snapping to
 * whatever frame the clip froze on, and only then is control handed back to
 * the ambient system. A Pose-Studio pose set before the animation is
 * therefore recovered bit-for-bit: the snapshot is whatever the user had.
 *
 * Root position is restored only while locomotion has NOT run since the
 * snapshot (invalidateRoot()): "come with me" must never be undone by a
 * dance ending. Root yaw is never touched — facing belongs to the gaze /
 * face-target system.
 *
 * Pure module: operates on bone-like objects exposing
 * `quaternion{x,y,z,w,set}` and `position{x,y,z,set}` — fully unit-testable
 * in Node without THREE.
 *
 * Additive module: does not modify any existing code.
 *
 * @module MotionPoseRestore
 */

const MotionPoseRestore = (() => {
    'use strict';

    let _snap = null; // { bones:[{node,q}], hips:{node,p}|null, root:{node,p}|null }
    let _blend = null; // { t, dur, bones:[{node,q0,q1}], hips, root }
    let _rootMoved = false;

    /** Shortest-path normalized quaternion lerp (adequate for a 0.5 s settle). */
    function _nlerp(a, b, t) {
        const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
        const s = dot < 0 ? -1 : 1;
        const out = [
            a[0] + (b[0] * s - a[0]) * t,
            a[1] + (b[1] * s - a[1]) * t,
            a[2] + (b[2] * s - a[2]) * t,
            a[3] + (b[3] * s - a[3]) * t,
        ];
        const len = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2] + out[3] * out[3]) || 1;
        return [out[0] / len, out[1] / len, out[2] / len, out[3] / len];
    }

    /** Is a snapshot waiting to be restored? */
    function hasSnapshot() {
        return !!_snap;
    }

    /** Is the settle blend currently running? */
    function isBlending() {
        return !!_blend;
    }

    /** Locomotion has moved the root; do not restore its position anymore. */
    function invalidateRoot() {
        _rootMoved = true;
    }

    /** Drop everything (a posture change like sit/stand is a new baseline). */
    function clear() {
        _snap = null;
        _blend = null;
        _rootMoved = false;
    }

    /**
     * Capture the pre-animation skeleton ONCE. Later calls are ignored until
     * the snapshot is consumed, so mid-sequence clips keep the ORIGINAL pose.
     *
     * @param {{bones: Array, hips?: Object, root?: Object}} opts
     * @returns {boolean} true when a new snapshot was taken
     */
    function capture(opts) {
        if (_snap || !opts) return false;
        const bones = [];
        for (const node of opts.bones || []) {
            if (node && node.quaternion) {
                const q = node.quaternion;
                bones.push({ node, q: [q.x, q.y, q.z, q.w] });
            }
        }
        if (!bones.length) return false;
        // `hips` may be a single node or several (the normalized and raw rigs
        // are different objects, and which one a clip translated depends on
        // its format), so normalise to a list.
        const hipsNodes = (Array.isArray(opts.hips) ? opts.hips : [opts.hips]).filter((n) => n && n.position);
        _snap = {
            bones,
            hips: hipsNodes.length
                ? hipsNodes.map((n) => ({ node: n, p: [n.position.x, n.position.y, n.position.z] }))
                : null,
            root:
                opts.root && opts.root.position
                    ? { node: opts.root, p: [opts.root.position.x, opts.root.position.y, opts.root.position.z] }
                    : null,
        };
        _rootMoved = false;
        return true;
    }

    /**
     * Begin the settle-back blend from the CURRENT pose to the snapshot.
     * @param {number} [seconds=0.5]
     * @returns {boolean}
     */
    function start(seconds) {
        if (!_snap) return false;
        const bones = [];
        for (const b of _snap.bones) {
            const q = b.node.quaternion;
            bones.push({ node: b.node, q0: [q.x, q.y, q.z, q.w], q1: b.q });
        }
        _blend = {
            t: 0,
            dur: Math.max(0.05, seconds || 0.5),
            bones,
            hips: _snap.hips
                ? _snap.hips.map((h) => ({
                      node: h.node,
                      p0: [h.node.position.x, h.node.position.y, h.node.position.z],
                      p1: h.p,
                  }))
                : null,
            root:
                _snap.root && !_rootMoved
                    ? {
                          node: _snap.root.node,
                          p0: [_snap.root.node.position.x, _snap.root.node.position.z],
                          p1: [_snap.root.p[0], _snap.root.p[2]], // x/z only; y and yaw stay live
                      }
                    : null,
        };
        return true;
    }

    /**
     * Advance the blend. Call once per frame while isBlending().
     * @param {number} dt seconds
     * @returns {boolean} true while still blending; false once done (snapshot consumed)
     */
    function update(dt) {
        if (!_blend) return false;
        _blend.t += Math.max(0, dt || 0);
        const k = Math.min(1, _blend.t / _blend.dur);
        const e = k * k * (3 - 2 * k); // smoothstep ease
        for (const b of _blend.bones) {
            const q = _nlerp(b.q0, b.q1, e);
            b.node.quaternion.set(q[0], q[1], q[2], q[3]);
        }
        if (_blend.hips) {
            for (const h of _blend.hips) {
                h.node.position.set(
                    h.p0[0] + (h.p1[0] - h.p0[0]) * e,
                    h.p0[1] + (h.p1[1] - h.p0[1]) * e,
                    h.p0[2] + (h.p1[2] - h.p0[2]) * e
                );
            }
        }
        if (_blend.root) {
            const r = _blend.root;
            r.node.position.x = r.p0[0] + (r.p1[0] - r.p0[0]) * e;
            r.node.position.z = r.p0[1] + (r.p1[1] - r.p0[1]) * e;
        }
        if (k >= 1) {
            clear(); // consumed — the next animation captures a fresh baseline
            return false;
        }
        return true;
    }

    return { capture, start, update, hasSnapshot, isBlending, invalidateRoot, clear };
})();

if (typeof window !== 'undefined') window.NEXUS_MOTION_POSE_RESTORE = MotionPoseRestore;
if (typeof module !== 'undefined' && module.exports) module.exports = MotionPoseRestore;
