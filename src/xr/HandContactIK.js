/**
 * HandContactIK — per-frame arm IK overlay for physical contact in VR.
 *
 * While an "offer_hand" / "high_five" pose plays, this module pulls the
 * avatar's wrist toward the user's real hand (VR controller / hand-tracking
 * position) using a lightweight 2-joint CCD solve, blended on top of the
 * playing clip with a smooth distance-based weight ramp. When the target is
 * cleared the arm eases back to the animated pose.
 *
 * Runs AFTER the animation mixer each frame (hooked from ViewerEngine's
 * per-frame update via MotionIntegration.update).
 *
 * Additive module: does not modify any existing code.
 *
 * @module HandContactIK
 */

const HandContactIK = (() => {
    'use strict';

    const RAMP_SPEED = 4.0; // weight units per second
    const MAX_STEP = 0.45; // max radians a joint may correct per iteration
    const ITERATIONS = 2;
    const REACH_ENGAGE_M = 0.75; // start blending in when target closer than this

    let _vrm = null;

    /** Per-side state. */
    const _sides = {
        right: { target: null, weight: 0, bones: null },
        left: { target: null, weight: 0, bones: null },
    };

    const _tmp = {};

    function _T() {
        return typeof window !== 'undefined' ? window.THREE : null;
    }

    function _lazyTmp() {
        const THREE = _T();
        if (!THREE || _tmp.v1) return;
        _tmp.v1 = new THREE.Vector3();
        _tmp.v2 = new THREE.Vector3();
        _tmp.v3 = new THREE.Vector3();
        _tmp.q1 = new THREE.Quaternion();
        _tmp.q2 = new THREE.Quaternion();
        _tmp.q3 = new THREE.Quaternion();
    }

    /**
     * Resolve humanoid bones for one side, tolerant of three-vrm versions.
     * @private
     */
    function _bones(side) {
        if (!_vrm || !_vrm.humanoid) return null;
        const h = _vrm.humanoid;
        const get = (name) => {
            if (typeof h.getNormalizedBoneNode === 'function') {
                const n = h.getNormalizedBoneNode(name);
                if (n) return n;
            }
            if (typeof h.getRawBoneNode === 'function') {
                const n = h.getRawBoneNode(name);
                if (n) return n;
            }
            if (typeof h.getBoneNode === 'function') return h.getBoneNode(name);
            return null;
        };
        const upper = get(side + 'UpperArm');
        const lower = get(side + 'LowerArm');
        const hand = get(side + 'Hand');
        if (!upper || !lower || !hand) return null;
        return { upper, lower, hand };
    }

    /**
     * Attach to (or re-attach after avatar switch) a VRM instance.
     * @param {Object} vrm - three-vrm VRM instance
     */
    function attach(vrm) {
        _vrm = vrm || null;
        _sides.right.bones = null;
        _sides.left.bones = null;
        _sides.right.weight = 0;
        _sides.left.weight = 0;
    }

    /**
     * Set (or clear with null) the world-space contact target for a side.
     * @param {'left'|'right'} side
     * @param {THREE.Vector3|null} worldPos
     */
    function setTarget(side, worldPos) {
        const s = _sides[side === 'left' ? 'left' : 'right'];
        s.target = worldPos ? worldPos.clone() : null;
    }

    function clearTargets() {
        _sides.right.target = null;
        _sides.left.target = null;
    }

    /**
     * World position of the avatar's hand bone.
     * @param {'left'|'right'} side
     * @returns {THREE.Vector3|null}
     */
    function getHandWorldPos(side) {
        const THREE = _T();
        if (!THREE) return null;
        const s = _sides[side === 'left' ? 'left' : 'right'];
        if (!s.bones) s.bones = _bones(side === 'left' ? 'left' : 'right');
        if (!s.bones) return null;
        return s.bones.hand.getWorldPosition(new THREE.Vector3());
    }

    /**
     * One CCD pass rotating `joint` so the hand moves toward the target.
     * The correction is scaled by `weight` and clamped for stability.
     * @private
     */
    function _ccdJoint(joint, hand, target, weight) {
        _lazyTmp();
        const jointPos = joint.getWorldPosition(_tmp.v1);
        const handPos = hand.getWorldPosition(_tmp.v2);

        const dirHand = _tmp.v2.sub(jointPos).normalize();
        const dirTarget = _tmp.v3.copy(target).sub(jointPos).normalize();
        if (dirHand.lengthSq() < 1e-8 || dirTarget.lengthSq() < 1e-8) return;

        // Desired world-space delta, angle-clamped.
        _tmp.q1.setFromUnitVectors(dirHand, dirTarget);
        const THREE = _T();
        const angle = 2 * Math.acos(Math.min(1, Math.abs(_tmp.q1.w)));
        const clamped = Math.min(angle, MAX_STEP) * weight;
        if (clamped < 1e-4) return;
        _tmp.q2.copy(_tmp.q1);
        _tmp.q1.identity().slerp(_tmp.q2, angle > 1e-6 ? clamped / angle : 0);

        // world → local: local = parentWorld⁻¹ · delta · jointWorld
        joint.getWorldQuaternion(_tmp.q2);
        _tmp.q3.copy(_tmp.q1).multiply(_tmp.q2); // new world rotation
        if (joint.parent) {
            joint.parent.getWorldQuaternion(_tmp.q2).invert();
            _tmp.q3.premultiply(_tmp.q2);
        }
        joint.quaternion.copy(_tmp.q3);
        joint.updateMatrixWorld(true);
        if (THREE) THREE.MathUtils; // keep reference for tree-shaking safety
    }

    /**
     * Per-frame update. Call after the animation mixer, before render.
     * @param {number} dt - seconds
     */
    function update(dt) {
        if (!_vrm || !_T()) return;
        _lazyTmp();

        for (const key of ['right', 'left']) {
            const s = _sides[key];
            if (!s.bones) s.bones = _bones(key);
            if (!s.bones) continue;

            // Weight ramp: engage smoothly when a target is near, release when cleared.
            let goal = 0;
            if (s.target) {
                const handPos = s.bones.hand.getWorldPosition(_tmp.v1);
                const d = handPos.distanceTo(s.target);
                goal = d < REACH_ENGAGE_M ? 1 : Math.max(0, 1 - (d - REACH_ENGAGE_M) / 0.35);
            }
            const step = RAMP_SPEED * (dt || 0.016);
            s.weight += Math.max(-step, Math.min(step, goal - s.weight));
            if (s.weight < 0.01 || !s.target) continue;

            for (let it = 0; it < ITERATIONS; it++) {
                _ccdJoint(s.bones.lower, s.bones.hand, s.target, s.weight);
                _ccdJoint(s.bones.upper, s.bones.hand, s.target, s.weight * 0.8);
            }
        }
    }

    /**
     * Distance from the avatar hand to its current target (Infinity if none).
     * @param {'left'|'right'} side
     */
    function distanceToTarget(side) {
        const s = _sides[side === 'left' ? 'left' : 'right'];
        if (!s.target) return Infinity;
        const p = getHandWorldPos(side);
        return p ? p.distanceTo(s.target) : Infinity;
    }

    return { attach, setTarget, clearTargets, update, getHandWorldPos, distanceToTarget };
})();

if (typeof window !== 'undefined') window.NEXUS_HAND_IK = HandContactIK;
if (typeof module !== 'undefined' && module.exports) module.exports = HandContactIK;
