/**
 * PosePuppetIK — natural full-body pose dragging ("Puppet Mode").
 *
 * Legacy mouse editing rotates ONE bone per drag (FK), which feels robotic.
 * Puppet Mode makes a grabbed part follow the pointer in 3D while the rest
 * of the skeleton co-operates with organic falloff: drag a hand and the
 * elbow bends, the shoulder rolls, the chest leans a little — like a real
 * puppet. Implemented as a weighted CCD solve over predefined joint chains
 * with per-joint step clamps and reach limiting for stability.
 *
 * The solver rotates the SAME bones the sliders write (editor.rigMap), so
 * slider sync, undo and pose saving keep working unchanged.
 *
 * Additive module: does not modify any existing code.
 *
 * @module PosePuppetIK
 */

const PosePuppetIK = (() => {
    'use strict';

    /**
     * Effector → ordered chain (child → parent) with falloff weights.
     * Weights decay toward the torso so distal joints do most of the work
     * and the body follows subtly — the "natural, whole-skeleton" feel.
     */
    const CHAINS = {
        leftHand: [
            { key: 'leftLowerArm', w: 1.0 },
            { key: 'leftUpperArm', w: 0.85 },
            { key: 'leftShoulder', w: 0.3 },
            { key: 'chest', w: 0.14 },
            { key: 'spine', w: 0.08 },
        ],
        rightHand: [
            { key: 'rightLowerArm', w: 1.0 },
            { key: 'rightUpperArm', w: 0.85 },
            { key: 'rightShoulder', w: 0.3 },
            { key: 'chest', w: 0.14 },
            { key: 'spine', w: 0.08 },
        ],
        leftLowerArm: [
            { key: 'leftUpperArm', w: 1.0 },
            { key: 'leftShoulder', w: 0.25 },
        ],
        rightLowerArm: [
            { key: 'rightUpperArm', w: 1.0 },
            { key: 'rightShoulder', w: 0.25 },
        ],
        leftFoot: [
            { key: 'leftLowerLeg', w: 1.0 },
            { key: 'leftUpperLeg', w: 0.85 },
            { key: 'hips', w: 0.1 },
        ],
        rightFoot: [
            { key: 'rightLowerLeg', w: 1.0 },
            { key: 'rightUpperLeg', w: 0.85 },
            { key: 'hips', w: 0.1 },
        ],
        leftLowerLeg: [{ key: 'leftUpperLeg', w: 1.0 }],
        rightLowerLeg: [{ key: 'rightUpperLeg', w: 1.0 }],
        head: [
            { key: 'neck', w: 1.0 },
            { key: 'chest', w: 0.45 },
            { key: 'spine', w: 0.22 },
        ],
        neck: [
            { key: 'chest', w: 1.0 },
            { key: 'spine', w: 0.4 },
        ],
        chest: [
            { key: 'spine', w: 1.0 },
            { key: 'hips', w: 0.3 },
        ],
        spine: [{ key: 'hips', w: 1.0 }],
        leftUpperArm: [
            { key: 'leftShoulder', w: 0.6 },
            { key: 'chest', w: 0.2 },
        ],
        rightUpperArm: [
            { key: 'rightShoulder', w: 0.6 },
            { key: 'chest', w: 0.2 },
        ],
        leftUpperLeg: [{ key: 'hips', w: 0.35 }],
        rightUpperLeg: [{ key: 'hips', w: 0.35 }],
    };

    const ITERATIONS = 3;
    const MAX_STEP = 0.22; // radians per joint per iteration (scaled by weight)
    const CONVERGED_M = 0.012;
    const REACH_SLACK = 1.03; // allow slight overreach before clamping

    let _enabled = true;
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('nexus-pose-puppet') === 'false') {
            _enabled = false;
        }
    } catch (_e) {
        /* storage unavailable */
    }

    function _T() {
        return typeof window !== 'undefined' ? window.THREE : typeof THREE !== 'undefined' ? THREE : null;
    }

    function isEnabled() {
        return _enabled;
    }

    function setEnabled(v) {
        _enabled = !!v;
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem('nexus-pose-puppet', String(_enabled));
        } catch (_e) {
            /* best effort */
        }
    }

    function hasChain(effectorKey) {
        return !!CHAINS[effectorKey];
    }

    /**
     * Offset between the WRITE rig (bones the solver rotates) and the VISUAL
     * rig (raw skeleton the handles are drawn on), measured at the effector at
     * drag start.
     *
     * The two frames diverge whenever something animates the raw bones — the
     * same three-vrm proxy-rig split that made the handles float off the body.
     * `solve()` reads effector positions from the write rig, but the drag
     * target is derived from the visual anchor, so without this correction a
     * grab with ZERO pointer movement snaps the limb across the frame gap
     * (measured: 0.50 m / 38° on a 50°-divergent arm). Add this to the target
     * to express it in write-rig space, which makes the drag purely relative.
     *
     * @returns {THREE.Vector3|null} null when the frames already agree
     */
    function frameOffset(rigMap, effectorKey, visualAnchorWorld) {
        const THREE = _T();
        if (!THREE || !rigMap || !rigMap.getBone || !visualAnchorWorld) return null;
        const writeBone = rigMap.getBone(effectorKey);
        if (!writeBone) return null;
        return writeBone.getWorldPosition(new THREE.Vector3()).sub(visualAnchorWorld);
    }

    /**
     * Project the pointer onto the camera-facing plane through the grab point,
     * giving a stable 3D drag target at constant depth (Blender-style).
     *
     * @param {THREE.Camera} camera
     * @param {THREE.Vector2} mouseNDC - normalized device coords (-1..1)
     * @param {THREE.Vector3} anchorWorld - world position grabbed at drag start
     * @returns {THREE.Vector3|null}
     */
    function screenTarget(camera, mouseNDC, anchorWorld) {
        const THREE = _T();
        if (!THREE || !camera || !mouseNDC || !anchorWorld) return null;

        const origin = new THREE.Vector3();
        camera.getWorldPosition(origin);
        const dir = new THREE.Vector3(mouseNDC.x, mouseNDC.y, 0.5).unproject(camera).sub(origin).normalize();

        const normal = new THREE.Vector3();
        camera.getWorldDirection(normal);

        const denom = normal.dot(dir);
        if (Math.abs(denom) < 1e-6) return null;
        const t = new THREE.Vector3().subVectors(anchorWorld, origin).dot(normal) / denom;
        if (!isFinite(t) || t <= 0) return null;
        return origin.clone().addScaledVector(dir, t);
    }

    /**
     * Rotate `joint` so the effector moves toward the target (one CCD step),
     * scaled by `weight` and angle-clamped for smoothness.
     * @private
     */
    function _ccdStep(joint, effector, target, weight, tmp) {
        const jointPos = joint.getWorldPosition(tmp.v1);
        const effPos = effector.getWorldPosition(tmp.v2);

        const dirEff = tmp.v2.sub(jointPos);
        const dirTgt = tmp.v3.copy(target).sub(jointPos);
        if (dirEff.lengthSq() < 1e-10 || dirTgt.lengthSq() < 1e-10) return;
        dirEff.normalize();
        dirTgt.normalize();

        tmp.q1.setFromUnitVectors(dirEff, dirTgt);
        const angle = 2 * Math.acos(Math.min(1, Math.abs(tmp.q1.w)));
        if (angle < 1e-5) return;
        const step = Math.min(angle, MAX_STEP * weight);
        tmp.q2.copy(tmp.q1);
        tmp.q1.identity().slerp(tmp.q2, step / angle);

        // world-space delta → joint-local:  local = parentWorld⁻¹ · Δ · jointWorld
        joint.getWorldQuaternion(tmp.q2);
        tmp.q3.copy(tmp.q1).multiply(tmp.q2);
        if (joint.parent) {
            joint.parent.getWorldQuaternion(tmp.q2).invert();
            tmp.q3.premultiply(tmp.q2);
        }
        joint.quaternion.copy(tmp.q3);
        joint.quaternion.normalize();
        joint.updateMatrixWorld(true);
    }

    /**
     * Solve the chain so the effector reaches (toward) targetWorld.
     *
     * @param {Object} rigMap - PoseRigMap (bones the sliders also write)
     * @param {string} effectorKey - grabbed bone key (e.g. 'rightHand')
     * @param {THREE.Vector3} targetWorld
     * @returns {string[]} keys of bones that were rotated (effector included)
     */
    function solve(rigMap, effectorKey, targetWorld) {
        const THREE = _T();
        if (!THREE || !rigMap || !rigMap.getBone || !targetWorld) return [];
        const chainDef = CHAINS[effectorKey];
        const effector = rigMap.getBone(effectorKey);
        if (!chainDef || !effector) return [];

        const joints = [];
        for (let i = 0; i < chainDef.length; i++) {
            const b = rigMap.getBone(chainDef[i].key);
            if (b) joints.push({ bone: b, key: chainDef[i].key, w: chainDef[i].w });
        }
        if (!joints.length) return [];

        const tmp = {
            v1: new THREE.Vector3(),
            v2: new THREE.Vector3(),
            v3: new THREE.Vector3(),
            q1: new THREE.Quaternion(),
            q2: new THREE.Quaternion(),
            q3: new THREE.Quaternion(),
        };

        // Reach clamp: keep the target within arm's length of the chain root
        // so full extension doesn't jitter.
        const rootJoint = joints[joints.length - 1].bone;
        const rootPos = rootJoint.getWorldPosition(new THREE.Vector3());
        let reach = 0;
        let prev = rootPos;
        for (let i = joints.length - 1; i >= 0; i--) {
            const p = joints[i].bone.getWorldPosition(new THREE.Vector3());
            reach += p.distanceTo(prev);
            prev = p;
        }
        reach += effector.getWorldPosition(tmp.v1).distanceTo(prev);
        const target = targetWorld.clone();
        const toTarget = target.clone().sub(rootPos);
        const maxReach = Math.max(0.05, reach * REACH_SLACK);
        if (toTarget.length() > maxReach) {
            target.copy(rootPos).addScaledVector(toTarget.normalize(), maxReach);
        }

        for (let it = 0; it < ITERATIONS; it++) {
            for (let i = 0; i < joints.length; i++) {
                _ccdStep(joints[i].bone, effector, target, joints[i].w, tmp);
            }
            if (effector.getWorldPosition(tmp.v1).distanceTo(target) < CONVERGED_M) break;
        }

        const changed = joints.map((j) => j.key);
        changed.unshift(effectorKey);
        return changed;
    }

    return { solve, screenTarget, frameOffset, hasChain, isEnabled, setEnabled, CHAINS, MAX_STEP, ITERATIONS };
})();

if (typeof window !== 'undefined') window.NEXUS_POSE_PUPPET_IK = PosePuppetIK;
if (typeof module !== 'undefined' && module.exports) module.exports = PosePuppetIK;
