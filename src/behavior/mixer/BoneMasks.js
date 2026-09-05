/**
 * BoneMasks — which bones a layer is allowed to touch (spec v1.1 §6.6).
 *
 * Named against the **VRM normalized humanoid**, never against an avatar's raw bone names,
 * so a mask written once works on every avatar the app can load. `getNormalizedBoneNode` is
 * what makes that true, and it is why §6.6 insists on it.
 *
 * The masks are the reason a full-body dance does not switch her face off. `face` and
 * `head` are always-on layers with their own masks: lipsync and look-at keep running
 * underneath a clip that owns everything from the neck down.
 *
 * Exposes: window.NEXUS_BD_BONE_MASKS
 */
const BoneMasks = (() => {
    'use strict';

    const SPINE = ['hips', 'spine', 'chest', 'upperChest'];
    const HEAD = ['neck', 'head'];
    const ARMS = [
        'leftShoulder',
        'leftUpperArm',
        'leftLowerArm',
        'leftHand',
        'rightShoulder',
        'rightUpperArm',
        'rightLowerArm',
        'rightHand',
    ];
    const LEGS = [
        'leftUpperLeg',
        'leftLowerLeg',
        'leftFoot',
        'leftToes',
        'rightUpperLeg',
        'rightLowerLeg',
        'rightFoot',
        'rightToes',
    ];
    const FINGERS = [];
    for (const side of ['left', 'right']) {
        for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
            for (const joint of ['Proximal', 'Intermediate', 'Distal']) {
                FINGERS.push(`${side}${finger}${joint}`);
            }
        }
    }

    /** Layer name → the bones it owns. `face` is expressions, handled outside the skeleton. */
    const MASKS = {
        fullBody: [...SPINE, ...HEAD, ...ARMS, ...LEGS, ...FINGERS],
        upperBody: [...SPINE, ...ARMS, ...FINGERS],
        head: [...HEAD],
        face: [],
    };

    const SETS = Object.fromEntries(Object.entries(MASKS).map(([name, bones]) => [name, new Set(bones)]));

    /** Does this layer own this bone? An unknown layer owns nothing, rather than everything. */
    function covers(layer, bone) {
        const set = SETS[layer];
        return set ? set.has(bone) : false;
    }

    function bonesFor(layer) {
        return (MASKS[layer] || []).slice();
    }

    /**
     * Bones a lower layer keeps when `layer` is playing on top of it.
     *
     * The upper-body case is the one that matters: a gesture on the arms must leave the legs
     * to whatever was underneath, or she snaps to a default stance every time she waves.
     */
    function complementOf(layer) {
        const owned = SETS[layer] || new Set();
        return MASKS.fullBody.filter((bone) => !owned.has(bone));
    }

    return { MASKS, covers, bonesFor, complementOf, SPINE, HEAD, ARMS, LEGS, FINGERS };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_BONE_MASKS = BoneMasks;
if (typeof module !== 'undefined' && module.exports) module.exports = BoneMasks;
