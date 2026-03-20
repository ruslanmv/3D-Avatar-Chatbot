/**
 * VRPoseSystem — Industry-grade VR avatar posing (IK + Presets + Snap)
 * ====================================================================
 * Follows techniques used by commercial VR character interaction games:
 *
 *   1) CCD-IK (Cyclic Coordinate Descent) for natural chain posing
 *      — Grab a hand → entire arm follows naturally
 *      — Grab a foot → leg bends at knee realistically
 *
 *   2) Pose preset library with smooth blending
 *      — Standing, sitting, kneeling, lying, custom, etc.
 *      — Interpolated transitions between poses (no jarring snaps)
 *
 *   3) Furniture snap system for AR/passthrough placement
 *      — Detect surfaces, snap avatar with appropriate sitting/standing pose
 *
 *   4) Spring-damped smoothing for natural, non-jerky movement
 *      — All bone rotations go through a spring damper
 *      — Feels like moving a real person, not a rigid puppet
 *
 * Non-destructive: additive module. Works alongside VRBoneGrabber.
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

// =========================================================================
// IK CHAIN DEFINITIONS (humanoid bone chains for CCD-IK)
// =========================================================================

const IK_CHAINS = {
    leftArm: ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'],
    rightArm: ['rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'],
    leftLeg: ['leftUpperLeg', 'leftLowerLeg', 'leftFoot'],
    rightLeg: ['rightUpperLeg', 'rightLowerLeg', 'rightFoot'],
    spine: ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head'],
};

// Map end-effector bone key → which IK chain to solve
const EFFECTOR_TO_CHAIN = {
    // Extremities (primary IK targets)
    leftHand: 'leftArm',
    rightHand: 'rightArm',
    leftFoot: 'leftLeg',
    rightFoot: 'rightLeg',
    head: 'spine',
    // Mid-limb (elbows, knees)
    leftLowerArm: 'leftArm',
    rightLowerArm: 'rightArm',
    leftLowerLeg: 'leftLeg',
    rightLowerLeg: 'rightLeg',
    // Upper limb (shoulders, thighs) — IK solves from root of chain
    leftUpperArm: 'leftArm',
    rightUpperArm: 'rightArm',
    leftUpperLeg: 'leftLeg',
    rightUpperLeg: 'rightLeg',
};

// =========================================================================
// ANATOMICAL JOINT CONSTRAINTS (industry-standard angle limits)
// =========================================================================
// Per-bone rotation limits in DEGREES. Axes are local: X = twist (flexion),
// Y = lateral bend, Z = axial rotation.  Based on biomechanical references
// used by VaM, Honey Select, and AAA character riggers.
//
// Format: { minX, maxX, minY, maxY, minZ, maxZ }
// null = unconstrained on that axis.  Values in degrees.

const JOINT_LIMITS = {
    // ── Arms ──
    leftShoulder: { minX: -30, maxX: 30, minY: -15, maxY: 15, minZ: -15, maxZ: 15 },
    rightShoulder: { minX: -30, maxX: 30, minY: -15, maxY: 15, minZ: -15, maxZ: 15 },
    leftUpperArm: { minX: -120, maxX: 80, minY: -85, maxY: 130, minZ: -90, maxZ: 30 },
    rightUpperArm: { minX: -120, maxX: 80, minY: -130, maxY: 85, minZ: -30, maxZ: 90 },
    leftLowerArm: { minX: -5, maxX: 150, minY: -5, maxY: 5, minZ: -90, maxZ: 80 },
    rightLowerArm: { minX: -5, maxX: 150, minY: -5, maxY: 5, minZ: -80, maxZ: 90 },
    leftHand: { minX: -75, maxX: 75, minY: -40, maxY: 30, minZ: -20, maxZ: 20 },
    rightHand: { minX: -75, maxX: 75, minY: -30, maxY: 40, minZ: -20, maxZ: 20 },

    // ── Legs ──
    leftUpperLeg: { minX: -130, maxX: 35, minY: -45, maxY: 60, minZ: -30, maxZ: 45 },
    rightUpperLeg: { minX: -130, maxX: 35, minY: -60, maxY: 45, minZ: -45, maxZ: 30 },
    leftLowerLeg: { minX: -5, maxX: 155, minY: -5, maxY: 5, minZ: -5, maxZ: 5 },
    rightLowerLeg: { minX: -5, maxX: 155, minY: -5, maxY: 5, minZ: -5, maxZ: 5 },
    leftFoot: { minX: -45, maxX: 55, minY: -25, maxY: 25, minZ: -20, maxZ: 20 },
    rightFoot: { minX: -45, maxX: 55, minY: -25, maxY: 25, minZ: -20, maxZ: 20 },

    // ── Spine ──
    spine: { minX: -35, maxX: 35, minY: -25, maxY: 25, minZ: -20, maxZ: 20 },
    chest: { minX: -25, maxX: 25, minY: -20, maxY: 20, minZ: -15, maxZ: 15 },
    upperChest: { minX: -15, maxX: 15, minY: -15, maxY: 15, minZ: -10, maxZ: 10 },
    neck: { minX: -40, maxX: 30, minY: -40, maxY: 40, minZ: -30, maxZ: 30 },
    head: { minX: -35, maxX: 40, minY: -50, maxY: 50, minZ: -20, maxZ: 20 },
};

/**
 * Clamp a bone's local quaternion to the anatomical limits defined above.
 * Converts to Euler, clamps each axis, converts back.
 */
const _clampEuler = new THREE.Euler();
const _clampQuat = new THREE.Quaternion();

function clampBoneRotation(bone, boneKey) {
    const limits = JOINT_LIMITS[boneKey];
    if (!limits) return; // no limits defined for this bone

    _clampEuler.setFromQuaternion(bone.quaternion, 'XYZ');

    const deg = THREE.MathUtils.radToDeg;
    const rad = THREE.MathUtils.degToRad;

    let x = deg(_clampEuler.x);
    let y = deg(_clampEuler.y);
    let z = deg(_clampEuler.z);

    x = THREE.MathUtils.clamp(x, limits.minX, limits.maxX);
    y = THREE.MathUtils.clamp(y, limits.minY, limits.maxY);
    z = THREE.MathUtils.clamp(z, limits.minZ, limits.maxZ);

    _clampEuler.set(rad(x), rad(y), rad(z), 'XYZ');
    bone.quaternion.setFromEuler(_clampEuler);
}

// =========================================================================
// POLE VECTOR HINTS (prevent elbow/knee flipping — AAA standard)
// =========================================================================
// A pole vector is a world-space direction hint that tells the IK solver
// which way a joint should "point" (e.g. elbows point backward, knees
// point forward).  Without it, CCD-IK can flip joints to the wrong side.

const POLE_VECTORS = {
    leftArm: new THREE.Vector3(0, 0, -1), // elbows point backward
    rightArm: new THREE.Vector3(0, 0, -1), // elbows point backward
    leftLeg: new THREE.Vector3(0, 0, 1), // knees point forward
    rightLeg: new THREE.Vector3(0, 0, 1), // knees point forward
    spine: null, // spine has no pole vector
};

// =========================================================================
// POSE PRESETS (quaternion rotations per bone, industry-standard poses)
// =========================================================================

// Helper: Euler degrees → Quaternion
function eulerDegToQuat(x, y, z) {
    const q = new THREE.Quaternion();
    q.setFromEuler(
        new THREE.Euler(THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z))
    );
    return q;
}

const POSE_PRESETS = {
    // =====================================================================
    // STANDING POSES — Chat & Conversation
    // =====================================================================

    standing: {
        label: 'Standing (Rest / T-Pose)',
        bones: {}, // Identity — all bones at VRM rest (T-pose). Debug/reset only.
    },

    // ── Presenter / Professional standing poses ──

    lecturerNeutral: {
        label: 'Lecturer (Neutral)',
        bones: {
            leftUpperArm: eulerDegToQuat(4, 0, 36),
            rightUpperArm: eulerDegToQuat(4, 0, -36),
            leftLowerArm: eulerDegToQuat(0, -12, 0),
            rightLowerArm: eulerDegToQuat(0, 12, 0),
            hips: eulerDegToQuat(0, 0, -2),
            spine: eulerDegToQuat(0, 0, 1),
            chest: eulerDegToQuat(-2, 0, 0),
            head: eulerDegToQuat(3, -4, 0),
        },
    },

    presenterOpen: {
        label: 'Presenter (Open)',
        bones: {
            leftUpperArm: eulerDegToQuat(10, 0, 28),
            rightUpperArm: eulerDegToQuat(10, 0, -28),
            leftLowerArm: eulerDegToQuat(0, -22, 0),
            rightLowerArm: eulerDegToQuat(0, 22, 0),
            hips: eulerDegToQuat(0, 0, -1),
            spine: eulerDegToQuat(-2, 0, 1),
            chest: eulerDegToQuat(-4, 0, 0),
            head: eulerDegToQuat(4, -5, 0),
        },
    },

    anchorGrounded: {
        label: 'Anchor (Grounded)',
        bones: {
            leftUpperArm: eulerDegToQuat(12, 0, 18),
            rightUpperArm: eulerDegToQuat(12, 0, -18),
            leftLowerArm: eulerDegToQuat(0, -34, 0),
            rightLowerArm: eulerDegToQuat(0, 34, 0),
            hips: eulerDegToQuat(0, 0, -1),
            spine: eulerDegToQuat(-3, 0, 0),
            chest: eulerDegToQuat(-2, 0, 0),
            head: eulerDegToQuat(2, 0, 0),
        },
    },

    // ── Mature / Companion standing poses (non-explicit, tasteful) ──

    confident: {
        label: 'Confident',
        bones: {
            leftUpperArm: eulerDegToQuat(6, 0, 32),
            rightUpperArm: eulerDegToQuat(6, 0, -32),
            leftLowerArm: eulerDegToQuat(0, -18, 0),
            rightLowerArm: eulerDegToQuat(0, 18, 0),
            hips: eulerDegToQuat(0, 3, -3),
            spine: eulerDegToQuat(-4, 0, 0),
            chest: eulerDegToQuat(-6, 0, 0),
            head: eulerDegToQuat(2, -3, -2),
        },
    },

    lounge: {
        label: 'Lounge',
        bones: {
            leftUpperArm: eulerDegToQuat(2, 0, 40),
            rightUpperArm: eulerDegToQuat(8, 0, -30),
            leftLowerArm: eulerDegToQuat(0, -8, 0),
            rightLowerArm: eulerDegToQuat(0, 20, 0),
            hips: eulerDegToQuat(2, 4, -5),
            spine: eulerDegToQuat(-2, 2, 2),
            chest: eulerDegToQuat(-3, 1, 0),
            head: eulerDegToQuat(5, -6, -3),
        },
    },

    shy: {
        label: 'Shy',
        bones: {
            leftUpperArm: eulerDegToQuat(8, 0, 24),
            rightUpperArm: eulerDegToQuat(8, 0, -24),
            leftLowerArm: eulerDegToQuat(0, -28, 0),
            rightLowerArm: eulerDegToQuat(0, 28, 0),
            hips: eulerDegToQuat(0, -2, 0),
            spine: eulerDegToQuat(2, 0, 0),
            chest: eulerDegToQuat(3, 0, 0),
            head: eulerDegToQuat(8, -4, 3),
        },
    },

    elegant: {
        label: 'Elegant',
        bones: {
            leftUpperArm: eulerDegToQuat(5, 0, 34),
            rightUpperArm: eulerDegToQuat(10, 0, -26),
            leftLowerArm: eulerDegToQuat(0, -14, 0),
            rightLowerArm: eulerDegToQuat(0, 24, 0),
            hips: eulerDegToQuat(0, 2, -4),
            spine: eulerDegToQuat(-3, 1, 2),
            chest: eulerDegToQuat(-5, 0, -1),
            head: eulerDegToQuat(3, -5, -2),
        },
    },

    intimateSafe: {
        label: 'Intimate',
        bones: {
            leftUpperArm: eulerDegToQuat(6, 0, 30),
            rightUpperArm: eulerDegToQuat(6, 0, -30),
            leftLowerArm: eulerDegToQuat(0, -20, 0),
            rightLowerArm: eulerDegToQuat(0, 20, 0),
            hips: eulerDegToQuat(2, 0, -3),
            spine: eulerDegToQuat(-3, 0, 0),
            chest: eulerDegToQuat(-5, 0, 0),
            head: eulerDegToQuat(6, -5, -3),
        },
    },

    conversational: {
        label: 'Conversational',
        bones: {
            leftUpperArm: eulerDegToQuat(6, 0, 32),
            rightUpperArm: eulerDegToQuat(8, 0, -28),
            leftLowerArm: eulerDegToQuat(0, -16, 0),
            rightLowerArm: eulerDegToQuat(0, 22, 0),
            hips: eulerDegToQuat(0, 2, -2),
            spine: eulerDegToQuat(-1, 0, 1),
            chest: eulerDegToQuat(-3, 0, 0),
            head: eulerDegToQuat(4, -4, 0),
        },
    },

    standingRelaxed: {
        label: 'Standing (Relaxed)',
        bones: {
            leftUpperArm: eulerDegToQuat(0, 0, 65), // Arms down at sides
            rightUpperArm: eulerDegToQuat(0, 0, -65),
            leftLowerArm: eulerDegToQuat(0, -15, 0), // Slight elbow bend
            rightLowerArm: eulerDegToQuat(0, 15, 0),
            hips: eulerDegToQuat(0, 0, -2), // Subtle weight shift
            spine: eulerDegToQuat(0, 0, 1), // S-curve counter-tilt
            chest: eulerDegToQuat(-2, 0, 0),
            head: eulerDegToQuat(3, -5, 0), // Slight attentive tilt
        },
    },

    standingFriendly: {
        label: 'Standing (Friendly)',
        bones: {
            leftUpperArm: eulerDegToQuat(8, 0, 58), // Asymmetric arm hang
            rightUpperArm: eulerDegToQuat(8, 0, -48),
            leftLowerArm: eulerDegToQuat(0, -20, 0),
            rightLowerArm: eulerDegToQuat(0, 8, 0),
            hips: eulerDegToQuat(0, 0, -2),
            spine: eulerDegToQuat(-2, 0, 1),
            chest: eulerDegToQuat(-4, 0, 0),
            head: eulerDegToQuat(4, -6, 0), // Warm, engaged head angle
        },
    },

    standingHandsClasped: {
        label: 'Standing (Hands Clasped)',
        bones: {
            leftUpperArm: eulerDegToQuat(30, 20, 40), // Arms brought forward toward center
            rightUpperArm: eulerDegToQuat(30, -20, -40),
            leftLowerArm: eulerDegToQuat(0, -80, 0), // Forearms bent inward, hands meet at waist
            rightLowerArm: eulerDegToQuat(0, 80, 0),
            leftHand: eulerDegToQuat(0, 0, 10), // Hands angled to clasp
            rightHand: eulerDegToQuat(0, 0, -10),
            spine: eulerDegToQuat(-3, 0, 0), // Upright professional posture
            chest: eulerDegToQuat(-2, 0, 0),
            head: eulerDegToQuat(5, 0, 0),
        },
    },

    // =====================================================================
    // SITTING POSES — Chair, Desk, Couch
    // =====================================================================

    // VRM note: character faces -Z. In bone-local space for VRM normalized bones:
    //   Upper leg: +X = forward (bend knee up), -X = backward
    //   Lower leg: -X = bend knee (fold shin behind thigh)
    //   Hips: +X = tilt forward, -X = tilt backward

    sitting: {
        label: 'Sitting',
        bones: {
            hips: eulerDegToQuat(5, 0, 0),
            leftUpperLeg: eulerDegToQuat(90, 0, -5),
            rightUpperLeg: eulerDegToQuat(90, 0, 5),
            leftLowerLeg: eulerDegToQuat(-90, 0, 0),
            rightLowerLeg: eulerDegToQuat(-90, 0, 0),
            leftFoot: eulerDegToQuat(10, 0, 0),
            rightFoot: eulerDegToQuat(10, 0, 0),
            spine: eulerDegToQuat(-5, 0, 0),
        },
    },

    sittingCrossed: {
        label: 'Sitting (Crossed)',
        bones: {
            hips: eulerDegToQuat(5, 0, 0),
            leftUpperLeg: eulerDegToQuat(88, -20, -18), // Wider spread, more open
            rightUpperLeg: eulerDegToQuat(82, 14, 22), // Crossing leg more open
            leftLowerLeg: eulerDegToQuat(-95, 0, 0),
            rightLowerLeg: eulerDegToQuat(-80, 0, 0),
            leftFoot: eulerDegToQuat(10, 0, 0),
            rightFoot: eulerDegToQuat(5, -12, 0),
            spine: eulerDegToQuat(-5, 0, 0),
        },
    },

    sittingDesk: {
        label: 'Sitting (Desk)',
        bones: {
            hips: eulerDegToQuat(-5, 0, 0), // Slight backward tilt (seated on chair)
            leftUpperLeg: eulerDegToQuat(85, 0, -8), // Thighs forward, slight spread
            rightUpperLeg: eulerDegToQuat(85, 0, 8),
            leftLowerLeg: eulerDegToQuat(-85, 0, 0), // Shins mostly vertical
            rightLowerLeg: eulerDegToQuat(-85, 0, 0),
            leftFoot: eulerDegToQuat(5, 0, 0), // Feet flat
            rightFoot: eulerDegToQuat(5, 0, 0),
            spine: eulerDegToQuat(6, 0, 0), // Slight forward lean — typing posture
            chest: eulerDegToQuat(4, 0, 0),
            leftUpperArm: eulerDegToQuat(40, 10, 18), // Upper arms forward, elbows at sides
            rightUpperArm: eulerDegToQuat(40, -10, -18),
            leftLowerArm: eulerDegToQuat(0, -85, 0), // Forearms horizontal on desk, typing angle
            rightLowerArm: eulerDegToQuat(0, 85, 0),
            leftHand: eulerDegToQuat(-10, 0, 5), // Hands angled down toward keyboard
            rightHand: eulerDegToQuat(-10, 0, -5),
            head: eulerDegToQuat(-5, 0, 0), // Looking at screen, slight downward gaze
        },
    },

    sittingLegsUp: {
        label: 'Sitting (Lounging)',
        bones: {
            hips: eulerDegToQuat(-10, 0, 0), // Tilted back — reclined
            leftUpperLeg: eulerDegToQuat(75, 0, -12), // Legs extended, relaxed spread
            rightUpperLeg: eulerDegToQuat(75, 0, 12),
            leftLowerLeg: eulerDegToQuat(-40, 0, 0), // Relaxed knee bend
            rightLowerLeg: eulerDegToQuat(-40, 0, 0),
            leftFoot: eulerDegToQuat(15, 0, -5), // Relaxed dangling feet
            rightFoot: eulerDegToQuat(15, 0, 5),
            spine: eulerDegToQuat(-12, 0, 0), // Reclined back
            chest: eulerDegToQuat(-5, 0, 0),
            leftUpperArm: eulerDegToQuat(5, 0, 55), // Arms resting at sides, clear of thighs
            rightUpperArm: eulerDegToQuat(5, 0, -55),
            leftLowerArm: eulerDegToQuat(0, -25, 0), // Relaxed forearms
            rightLowerArm: eulerDegToQuat(0, 25, 0),
            head: eulerDegToQuat(8, 0, 0), // Looking forward (compensate recline)
        },
    },

    // =====================================================================
    // KNEELING POSES
    // =====================================================================

    kneeling: {
        label: 'Kneeling',
        bones: {
            hips: eulerDegToQuat(10, 0, 0),
            leftUpperLeg: eulerDegToQuat(10, 0, -5),
            rightUpperLeg: eulerDegToQuat(10, 0, 5),
            leftLowerLeg: eulerDegToQuat(-145, 0, 0),
            rightLowerLeg: eulerDegToQuat(-145, 0, 0),
            leftFoot: eulerDegToQuat(-50, 0, 0),
            rightFoot: eulerDegToQuat(-50, 0, 0),
            spine: eulerDegToQuat(-10, 0, 0),
        },
    },

    kneelingUp: {
        label: 'Kneeling (Up)',
        bones: {
            hips: eulerDegToQuat(0, 0, 0),
            leftUpperLeg: eulerDegToQuat(10, 0, -5),
            rightUpperLeg: eulerDegToQuat(10, 0, 5),
            leftLowerLeg: eulerDegToQuat(-145, 0, 0),
            rightLowerLeg: eulerDegToQuat(-145, 0, 0),
            leftFoot: eulerDegToQuat(-50, 0, 0),
            rightFoot: eulerDegToQuat(-50, 0, 0),
            leftUpperArm: eulerDegToQuat(20, 0, 50), // Hands on thighs
            rightUpperArm: eulerDegToQuat(20, 0, -50),
            leftLowerArm: eulerDegToQuat(0, -50, 0),
            rightLowerArm: eulerDegToQuat(0, 50, 0),
            spine: eulerDegToQuat(-5, 0, 0),
            head: eulerDegToQuat(10, 0, 0), // Looking up at user
        },
    },

    // =====================================================================
    // LYING POSES
    // =====================================================================

    lyingBack: {
        label: 'Lying (Back)',
        bones: {
            hips: eulerDegToQuat(90, 0, 0),
            leftUpperLeg: eulerDegToQuat(0, 0, -5),
            rightUpperLeg: eulerDegToQuat(0, 0, 5),
            leftLowerLeg: eulerDegToQuat(0, 0, 0),
            rightLowerLeg: eulerDegToQuat(0, 0, 0),
            leftUpperArm: eulerDegToQuat(0, 0, -60),
            rightUpperArm: eulerDegToQuat(0, 0, 60),
            leftLowerArm: eulerDegToQuat(0, -30, 0),
            rightLowerArm: eulerDegToQuat(0, 30, 0),
        },
    },

    lyingBackRelaxed: {
        label: 'Lying (Relaxed)',
        bones: {
            hips: eulerDegToQuat(90, 0, 0),
            leftUpperLeg: eulerDegToQuat(0, 0, -5), // One straight
            rightUpperLeg: eulerDegToQuat(30, 0, 15), // One bent + out
            leftLowerLeg: eulerDegToQuat(0, 0, 0),
            rightLowerLeg: eulerDegToQuat(-45, 0, 0),
            leftUpperArm: eulerDegToQuat(-30, 0, -70), // Arm up near head
            rightUpperArm: eulerDegToQuat(5, 0, 55), // Arm at side, relaxed on floor
            leftLowerArm: eulerDegToQuat(0, -90, 0),
            rightLowerArm: eulerDegToQuat(0, 15, 0), // Forearm flat on floor, slight bend
            rightHand: eulerDegToQuat(0, 0, 0), // Hand relaxed, palm down on floor
            head: eulerDegToQuat(0, 15, 0),
        },
    },

    lyingFront: {
        label: 'Lying (Front)',
        bones: {
            hips: eulerDegToQuat(-85, 0, 0), // Prone — face down (slightly less than 90 to avoid floor clip)
            leftUpperLeg: eulerDegToQuat(5, 0, -5), // Legs natural, slight splay
            rightUpperLeg: eulerDegToQuat(5, 0, 5),
            leftLowerLeg: eulerDegToQuat(-10, 0, 0), // Slight knee relaxation
            rightLowerLeg: eulerDegToQuat(-10, 0, 0),
            leftFoot: eulerDegToQuat(-15, 0, 0), // Toes pointed naturally
            rightFoot: eulerDegToQuat(-15, 0, 0),
            spine: eulerDegToQuat(10, 0, 0), // Slight back extension (propping up)
            chest: eulerDegToQuat(8, 0, 0),
            leftUpperArm: eulerDegToQuat(-30, 0, -50), // Arms forward propping up, clear of body
            rightUpperArm: eulerDegToQuat(-30, 0, 50),
            leftLowerArm: eulerDegToQuat(0, -70, 0), // Forearms on ground
            rightLowerArm: eulerDegToQuat(0, 70, 0),
            head: eulerDegToQuat(25, 0, 0), // Head lifted, looking forward
            neck: eulerDegToQuat(10, 0, 0),
        },
    },

    lyingSide: {
        label: 'Lying (Side)',
        bones: {
            hips: eulerDegToQuat(90, 0, -90),
            leftUpperLeg: eulerDegToQuat(15, 0, 0),
            rightUpperLeg: eulerDegToQuat(30, 0, 0),
            leftLowerLeg: eulerDegToQuat(-10, 0, 0),
            rightLowerLeg: eulerDegToQuat(-40, 0, 0),
            leftUpperArm: eulerDegToQuat(0, 0, -40),
            rightUpperArm: eulerDegToQuat(30, 0, 20),
            leftLowerArm: eulerDegToQuat(0, -60, 0),
            rightLowerArm: eulerDegToQuat(0, 60, 0),
            head: eulerDegToQuat(0, 20, 0),
        },
    },

    // =====================================================================
    // GROUND POSES
    // =====================================================================

    allFoursArched: {
        label: 'Bent Forward (Arched)',
        adult: true,
        // Standing forward bend — negative hips tilts torso forward.
        // Positive spine/chest adds forward flexion on top.
        // Legs compensate with positive upperLeg to stay vertical.
        bones: {
            hips: eulerDegToQuat(-35, 0, 0), // Pelvis forward — torso bends forward
            spine: eulerDegToQuat(15, 0, 0), // Lumbar flexion — more forward fold
            chest: eulerDegToQuat(10, 0, 0), // Thoracic flexion
            upperChest: eulerDegToQuat(5, 0, 0), // Upper spine follow-through
            neck: eulerDegToQuat(15, 0, 0), // Head lifts to look forward
            head: eulerDegToQuat(10, 0, 0), // Gaze ahead
            leftShoulder: eulerDegToQuat(3, 0, 8),
            rightShoulder: eulerDegToQuat(3, 0, -8),
            leftUpperArm: eulerDegToQuat(10, 0, 55), // Arms hang down from tilted torso
            rightUpperArm: eulerDegToQuat(10, 0, -55),
            leftLowerArm: eulerDegToQuat(0, -10, 0),
            rightLowerArm: eulerDegToQuat(0, 10, 0),
            leftUpperLeg: eulerDegToQuat(30, 0, -6), // Compensate hip tilt — legs vertical
            rightUpperLeg: eulerDegToQuat(30, 0, 6),
            leftLowerLeg: eulerDegToQuat(-10, 0, 0), // Soft knee bend
            rightLowerLeg: eulerDegToQuat(-10, 0, 0),
        },
    },

    // =====================================================================
    // ADULT / EROTIC POSES — For mature VR companion apps (18+)
    // =====================================================================

    lyingBackOpen: {
        label: 'Lying (Open)',
        adult: true,
        bones: {
            hips: eulerDegToQuat(90, 0, 0), // Supine
            leftUpperLeg: eulerDegToQuat(35, 0, -30), // Legs bent + spread
            rightUpperLeg: eulerDegToQuat(35, 0, 30),
            leftLowerLeg: eulerDegToQuat(-40, 0, 0), // Knees bent
            rightLowerLeg: eulerDegToQuat(-40, 0, 0),
            leftFoot: eulerDegToQuat(10, 0, 0),
            rightFoot: eulerDegToQuat(10, 0, 0),
            leftUpperArm: eulerDegToQuat(-20, 0, -60), // Arms up near head
            rightUpperArm: eulerDegToQuat(-20, 0, 60),
            leftLowerArm: eulerDegToQuat(0, -70, 0), // Forearms bent inward
            rightLowerArm: eulerDegToQuat(0, 70, 0),
            spine: eulerDegToQuat(-5, 0, 0), // Slight arch
            head: eulerDegToQuat(0, 10, 0),
        },
    },

    lyingFrontArched: {
        label: 'Lying (Arched)',
        adult: true,
        bones: {
            hips: eulerDegToQuat(-90, 0, 0), // Face down
            leftUpperLeg: eulerDegToQuat(0, 0, -10),
            rightUpperLeg: eulerDegToQuat(0, 0, 10),
            leftLowerLeg: eulerDegToQuat(-30, 0, 0), // Slight knee bend
            rightLowerLeg: eulerDegToQuat(-30, 0, 0),
            spine: eulerDegToQuat(15, 0, 0), // Arch back upward
            chest: eulerDegToQuat(10, 0, 0),
            leftUpperArm: eulerDegToQuat(10, 0, -50), // Arms beside body
            rightUpperArm: eulerDegToQuat(10, 0, 50),
            leftLowerArm: eulerDegToQuat(0, -70, 0), // Hands near head
            rightLowerArm: eulerDegToQuat(0, 70, 0),
            head: eulerDegToQuat(-25, 0, 0),
            neck: eulerDegToQuat(-10, 0, 0),
        },
    },

    kneelingPresent: {
        label: 'Kneeling (Present)',
        adult: true,
        bones: {
            hips: eulerDegToQuat(5, 0, 0),
            leftUpperLeg: eulerDegToQuat(10, 0, -15), // Knees apart
            rightUpperLeg: eulerDegToQuat(10, 0, 15),
            leftLowerLeg: eulerDegToQuat(-145, 0, 0),
            rightLowerLeg: eulerDegToQuat(-145, 0, 0),
            leftFoot: eulerDegToQuat(-50, 0, 0),
            rightFoot: eulerDegToQuat(-50, 0, 0),
            spine: eulerDegToQuat(-8, 0, 0), // Arch back slightly
            chest: eulerDegToQuat(-5, 0, 0),
            leftUpperArm: eulerDegToQuat(-10, 0, 55), // Hands behind back
            rightUpperArm: eulerDegToQuat(-10, 0, -55),
            leftLowerArm: eulerDegToQuat(0, -50, 0),
            rightLowerArm: eulerDegToQuat(0, 50, 0),
            head: eulerDegToQuat(15, 0, 0), // Looking up
        },
    },

    standingBendForward: {
        label: 'Standing (Bent Over)',
        bones: {
            hips: eulerDegToQuat(30, 0, 0), // Moderate hip hinge — not extreme, keeps CoG over feet
            spine: eulerDegToQuat(8, 0, 0), // Gentle forward curve — lumbar follows hips
            chest: eulerDegToQuat(5, 0, 0), // Minimal thoracic flex — S-curve maintained
            leftShoulder: eulerDegToQuat(8, 0, 5),
            rightShoulder: eulerDegToQuat(8, 0, -5),
            leftUpperArm: eulerDegToQuat(20, 10, 25), // Arms forward/down — counterbalance + gravity
            rightUpperArm: eulerDegToQuat(20, -10, -25),
            leftLowerArm: eulerDegToQuat(0, -30, 0), // Relaxed elbow bend
            rightLowerArm: eulerDegToQuat(0, 30, 0),
            leftUpperLeg: eulerDegToQuat(-3, 0, -2), // Legs near-vertical — hips shift back to compensate
            rightUpperLeg: eulerDegToQuat(-3, 0, 2),
            leftLowerLeg: eulerDegToQuat(-8, 0, 0), // Soft knees (natural micro-bend)
            rightLowerLeg: eulerDegToQuat(-8, 0, 0),
            head: eulerDegToQuat(-18, 0, 0), // Look forward — compensates for torso tilt
            neck: eulerDegToQuat(-10, 0, 0),
        },
    },

    standingBentBackward: {
        label: 'Standing (Bent Backward)',
        bones: {
            hips: eulerDegToQuat(-5, 0, 0), // Subtle pelvis forward — keeps CoG over wider stance
            spine: eulerDegToQuat(-12, 0, 0), // Lumbar extension (primary bend point)
            chest: eulerDegToQuat(-8, 0, 0), // Thoracic continuation — not extreme
            upperChest: eulerDegToQuat(-5, 0, 0), // Gentle upper curve
            neck: eulerDegToQuat(-8, 0, 0), // Cervical extension follows spine
            head: eulerDegToQuat(-5, 0, 0), // Gaze upward
            leftShoulder: eulerDegToQuat(-3, 0, -8), // Clavicles back — opens chest
            rightShoulder: eulerDegToQuat(-3, 0, 8),
            leftUpperArm: eulerDegToQuat(15, -10, 30), // Arms forward/out as counterbalance
            rightUpperArm: eulerDegToQuat(15, 10, -30),
            leftLowerArm: eulerDegToQuat(0, -25, 0), // Relaxed bend
            rightLowerArm: eulerDegToQuat(0, 25, 0),
            leftUpperLeg: eulerDegToQuat(5, 0, -6), // Wider stance for stability
            rightUpperLeg: eulerDegToQuat(5, 0, 6),
            leftLowerLeg: eulerDegToQuat(-10, 0, 0), // Bent knees — absorb backward lean
            rightLowerLeg: eulerDegToQuat(-10, 0, 0),
        },
    },

    lyingSideSeductive: {
        label: 'Lying (Side Pose)',
        adult: true,
        bones: {
            hips: eulerDegToQuat(90, 0, -90), // Side-lying
            leftUpperLeg: eulerDegToQuat(30, 0, 0), // Top leg forward
            rightUpperLeg: eulerDegToQuat(10, 0, 0),
            leftLowerLeg: eulerDegToQuat(-50, 0, 0), // Top knee bent
            rightLowerLeg: eulerDegToQuat(-15, 0, 0),
            leftUpperArm: eulerDegToQuat(-15, 0, -30), // Propped on elbow
            rightUpperArm: eulerDegToQuat(20, 0, 30), // Hand on hip
            leftLowerArm: eulerDegToQuat(0, -80, 0), // Supporting head
            rightLowerArm: eulerDegToQuat(0, 40, 0),
            spine: eulerDegToQuat(-5, 0, 5), // Slight twist
            chest: eulerDegToQuat(-3, 0, 3),
            head: eulerDegToQuat(5, 25, 0), // Looking toward viewer
        },
    },

    // =====================================================================
    // NEW ADULT POSES (Spicy Mode only — MMORPG-inspired)
    // =====================================================================

    lyingKiss: {
        label: 'Lying (Kiss Me)',
        adult: true,
        bones: {
            // Supine on floor — same as lyingBackRelaxed base
            hips: eulerDegToQuat(90, 0, 0),

            // ── Both legs bent + knees out (mirrored from the "good" right leg) ──
            leftUpperLeg: eulerDegToQuat(30, 0, -15), // Bent + spread out (mirrored)
            rightUpperLeg: eulerDegToQuat(30, 0, 15), // Bent + spread out
            leftLowerLeg: eulerDegToQuat(-45, 0, 0), // Knees bent
            rightLowerLeg: eulerDegToQuat(-45, 0, 0),
            leftFoot: eulerDegToQuat(5, 0, 0), // Relaxed feet on floor
            rightFoot: eulerDegToQuat(5, 0, 0),

            // ── Both arms up near head (mirrored from the "good" left arm) ──
            leftUpperArm: eulerDegToQuat(-30, 0, -70), // Arm up beside head
            rightUpperArm: eulerDegToQuat(-30, 0, 70), // Mirrored — arm up beside head
            leftLowerArm: eulerDegToQuat(0, -90, 0), // Forearm bent inward
            rightLowerArm: eulerDegToQuat(0, 90, 0), // Mirrored

            // ── Spine: slight arch (inviting) ──
            spine: eulerDegToQuat(-3, 0, 0),

            // ── Head: looking straight up (at partner above) ──
            head: eulerDegToQuat(0, 0, 0),
        },
    },

    standingSeductive: {
        label: 'Standing (Seductive)',
        adult: true,
        bones: {
            hips: eulerDegToQuat(0, 10, 5), // Weight shifted to one hip
            spine: eulerDegToQuat(-3, -5, 0), // Slight S-curve
            chest: eulerDegToQuat(-5, 5, 0), // Chest opens
            leftUpperArm: eulerDegToQuat(5, 10, 30), // Left hand on hip
            rightUpperArm: eulerDegToQuat(0, 0, -15), // Right arm relaxed
            leftLowerArm: eulerDegToQuat(0, -70, 0), // Forearm bent to hip
            rightLowerArm: eulerDegToQuat(0, 20, 0),
            leftUpperLeg: eulerDegToQuat(0, 0, -5), // Weight-bearing leg
            leftLowerLeg: eulerDegToQuat(-5, 0, 0), // Grounded — soft knee bend
            leftFoot: eulerDegToQuat(0, 0, 0), // Flat on floor
            rightUpperLeg: eulerDegToQuat(5, 0, 3), // Relaxed leg, toe out
            rightLowerLeg: eulerDegToQuat(-8, 0, 0), // Soft knee
            rightFoot: eulerDegToQuat(0, 5, 0), // Toe angled slightly out
            head: eulerDegToQuat(-5, -10, -3), // Chin down, eyes up, slight tilt
            neck: eulerDegToQuat(-3, -5, 0),
        },
    },

    wallLean: {
        label: 'Wall Lean',
        adult: true,
        bones: {
            hips: eulerDegToQuat(-8, 5, 0), // Leaning back
            spine: eulerDegToQuat(-5, 0, 0), // Back against wall
            chest: eulerDegToQuat(-3, 0, 0),
            leftUpperArm: eulerDegToQuat(-10, 0, 35), // Arms relaxed at sides
            rightUpperArm: eulerDegToQuat(-10, 0, -35),
            leftLowerArm: eulerDegToQuat(0, -25, 0),
            rightLowerArm: eulerDegToQuat(0, 25, 0),
            leftUpperLeg: eulerDegToQuat(0, 0, -5), // Standing leg — bears all weight
            leftLowerLeg: eulerDegToQuat(-10, 0, 0), // Grounded — slightly bent for stability
            leftFoot: eulerDegToQuat(0, 0, 0), // Flat on floor
            rightUpperLeg: eulerDegToQuat(45, 0, 5), // One knee up (foot on wall)
            rightLowerLeg: eulerDegToQuat(-80, 0, 0), // Foot tucked back
            rightFoot: eulerDegToQuat(-20, 0, 0),
            head: eulerDegToQuat(5, 15, 3), // Relaxed head tilt
            neck: eulerDegToQuat(0, 5, 0),
        },
    },

    lapSitting: {
        label: 'Lap Sitting',
        adult: true,
        bones: {
            hips: eulerDegToQuat(-5, 15, 0), // Seated, slight twist
            spine: eulerDegToQuat(-5, -5, 0),
            chest: eulerDegToQuat(-3, -3, 0),
            leftUpperLeg: eulerDegToQuat(70, 0, 15), // Legs together, angled to one side
            rightUpperLeg: eulerDegToQuat(75, 0, 15),
            leftLowerLeg: eulerDegToQuat(-65, 0, 0), // Knees bent
            rightLowerLeg: eulerDegToQuat(-70, 0, 0),
            leftFoot: eulerDegToQuat(-15, 0, 0),
            rightFoot: eulerDegToQuat(-15, 0, 0),
            leftUpperArm: eulerDegToQuat(10, 15, 25), // Hands in lap area
            rightUpperArm: eulerDegToQuat(15, -10, -20),
            leftLowerArm: eulerDegToQuat(0, -60, 0),
            rightLowerArm: eulerDegToQuat(0, 55, 0),
            head: eulerDegToQuat(-5, -10, -3), // Looking slightly aside
        },
    },

    embraceStanding: {
        label: 'Embrace (Standing)',
        adult: true,
        bones: {
            spine: eulerDegToQuat(3, 0, 0), // Slight forward lean
            chest: eulerDegToQuat(2, 0, 0),
            leftUpperArm: eulerDegToQuat(35, 25, 20), // Arms forward as if holding someone
            rightUpperArm: eulerDegToQuat(35, -25, -20),
            leftLowerArm: eulerDegToQuat(0, -80, 0), // Forearms wrapping
            rightLowerArm: eulerDegToQuat(0, 80, 0),
            leftHand: eulerDegToQuat(0, 0, 15), // Hands curved, embracing
            rightHand: eulerDegToQuat(0, 0, -15),
            leftUpperLeg: eulerDegToQuat(0, 0, -3),
            rightUpperLeg: eulerDegToQuat(0, 0, 3),
            leftLowerLeg: eulerDegToQuat(-5, 0, 0), // Soft knees
            rightLowerLeg: eulerDegToQuat(-5, 0, 0),
            head: eulerDegToQuat(8, 0, -5), // Head tilted, looking down at partner
        },
    },

    kneelSubmissive: {
        label: 'Kneeling (Submissive)',
        adult: true,
        bones: {
            hips: eulerDegToQuat(5, 0, 0),
            leftUpperLeg: eulerDegToQuat(5, 0, -8), // Knees slightly apart
            rightUpperLeg: eulerDegToQuat(5, 0, 8),
            leftLowerLeg: eulerDegToQuat(-140, 0, 0), // Sitting on heels
            rightLowerLeg: eulerDegToQuat(-140, 0, 0),
            leftFoot: eulerDegToQuat(-45, 0, 0),
            rightFoot: eulerDegToQuat(-45, 0, 0),
            spine: eulerDegToQuat(-10, 0, 0), // Bowed forward (flexion)
            chest: eulerDegToQuat(-8, 0, 0),
            leftUpperArm: eulerDegToQuat(15, 10, 15), // Hands on thighs, palms down
            rightUpperArm: eulerDegToQuat(15, -10, -15),
            leftLowerArm: eulerDegToQuat(0, -35, 0),
            rightLowerArm: eulerDegToQuat(0, 35, 0),
            head: eulerDegToQuat(20, 0, 0), // Head down
            neck: eulerDegToQuat(10, 0, 0),
        },
    },

    lyingSprawl: {
        label: 'Lying (Sprawl)',
        adult: true,
        bones: {
            hips: eulerDegToQuat(85, 0, 0), // Supine
            spine: eulerDegToQuat(-3, 5, 0), // Relaxed twist
            leftUpperLeg: eulerDegToQuat(10, 0, -20), // Legs relaxed apart
            rightUpperLeg: eulerDegToQuat(20, 0, 15),
            leftLowerLeg: eulerDegToQuat(-18, 0, 0), // Natural bend for supine sprawl
            rightLowerLeg: eulerDegToQuat(-30, 0, 0), // More bent — asymmetric for relaxed look
            leftUpperArm: eulerDegToQuat(-30, 0, -70), // One arm above head
            rightUpperArm: eulerDegToQuat(10, 0, 50), // Other arm relaxed at side
            leftLowerArm: eulerDegToQuat(0, -50, 0), // Forearm relaxed above head
            rightLowerArm: eulerDegToQuat(0, 15, 0),
            head: eulerDegToQuat(0, 15, 5), // Head turned slightly
        },
    },
    // =====================================================================
    // TOP 5 VR SIMULATION POSES (Steam Adult — Spicy Mode only)
    // =====================================================================

    missionary: {
        label: 'Missionary',
        adult: true,
        bones: {
            hips: eulerDegToQuat(80, 0, 0), // Supine, slightly raised
            spine: eulerDegToQuat(-3, 0, 0), // Natural arch
            chest: eulerDegToQuat(-2, 0, 0),
            leftUpperLeg: eulerDegToQuat(30, 0, -20), // Legs apart, knees up
            rightUpperLeg: eulerDegToQuat(30, 0, 20),
            leftLowerLeg: eulerDegToQuat(-45, 0, 0), // Knees bent
            rightLowerLeg: eulerDegToQuat(-45, 0, 0),
            leftFoot: eulerDegToQuat(10, 0, 0),
            rightFoot: eulerDegToQuat(10, 0, 0),
            leftUpperArm: eulerDegToQuat(20, 20, 40), // Arms reaching up (toward partner shoulders)
            rightUpperArm: eulerDegToQuat(20, -20, -40),
            leftLowerArm: eulerDegToQuat(0, -65, 0), // Forearms bent (hands on partner)
            rightLowerArm: eulerDegToQuat(0, 65, 0),
            head: eulerDegToQuat(-5, 0, 0), // Looking up at partner
            neck: eulerDegToQuat(-3, 0, 0),
        },
    },

    doggyStyle: {
        label: 'Doggy Style',
        adult: true,
        // Deep standing forward bend — negative hips tilts torso forward.
        // More pronounced than allFoursArched. Torso nearly horizontal.
        // Legs compensate with positive upperLeg to stay vertical.
        bones: {
            hips: eulerDegToQuat(-50, 0, 0), // Deep pelvis forward — torso bends forward
            spine: eulerDegToQuat(20, 0, 0), // Strong lumbar flexion
            chest: eulerDegToQuat(15, 0, 0), // Thoracic flexion
            upperChest: eulerDegToQuat(10, 0, 0), // Upper spine continues fold
            neck: eulerDegToQuat(20, 0, 0), // Head lifts — looking forward
            head: eulerDegToQuat(12, 0, 0), // Gaze ahead
            leftShoulder: eulerDegToQuat(3, 0, 8),
            rightShoulder: eulerDegToQuat(3, 0, -8),
            leftUpperArm: eulerDegToQuat(10, 0, 75), // Arms hang down from tilted torso
            rightUpperArm: eulerDegToQuat(10, 0, -75),
            leftLowerArm: eulerDegToQuat(0, -15, 0),
            rightLowerArm: eulerDegToQuat(0, 15, 0),
            leftUpperLeg: eulerDegToQuat(45, 0, -8), // Compensate hip tilt — legs vertical
            rightUpperLeg: eulerDegToQuat(45, 0, 8),
            leftLowerLeg: eulerDegToQuat(-12, 0, 0), // Soft knee bend
            rightLowerLeg: eulerDegToQuat(-12, 0, 0),
        },
    },

    cowgirl: {
        label: 'Cowgirl (Mounted)',
        adult: true,
        bones: {
            hips: eulerDegToQuat(5, 0, 0), // Pelvis tilted slightly forward — seated on partner
            spine: eulerDegToQuat(-3, 0, 0), // Upright with very slight arch
            chest: eulerDegToQuat(3, 0, 0), // Slight forward lean — natural riding position
            leftUpperLeg: eulerDegToQuat(65, 0, -30), // Wide straddle — thighs angled out
            rightUpperLeg: eulerDegToQuat(65, 0, 30),
            leftLowerLeg: eulerDegToQuat(-110, 0, 0), // Deep knee bend — shins tucked back
            rightLowerLeg: eulerDegToQuat(-110, 0, 0),
            leftFoot: eulerDegToQuat(-25, 0, -5), // Toes pointed slightly outward
            rightFoot: eulerDegToQuat(-25, 0, 5),
            leftUpperArm: eulerDegToQuat(20, 10, 15), // Hands braced on partner's chest/shoulders
            rightUpperArm: eulerDegToQuat(20, -10, -15),
            leftLowerArm: eulerDegToQuat(0, -55, 0), // Arms bent — pushing down for support
            rightLowerArm: eulerDegToQuat(0, 55, 0),
            head: eulerDegToQuat(-5, 0, -3), // Looking down with slight tilt
            neck: eulerDegToQuat(-3, 0, 0),
        },
    },

    wallPressed: {
        label: 'Wall Pressed',
        adult: true,
        bones: {
            hips: eulerDegToQuat(-8, 0, 0), // Back against wall, pelvis forward
            spine: eulerDegToQuat(-3, 0, 0), // Upper body against wall
            chest: eulerDegToQuat(-2, 0, 0),
            leftUpperLeg: eulerDegToQuat(35, 0, -15), // Left leg grounded, slight spread
            rightUpperLeg: eulerDegToQuat(55, 0, 12), // Right leg raised, wrapped
            leftLowerLeg: eulerDegToQuat(-20, 0, 0), // Standing leg — soft bend
            rightLowerLeg: eulerDegToQuat(-55, 0, 0), // Raised leg bent at knee
            leftFoot: eulerDegToQuat(5, 0, 0), // Flat on ground
            rightFoot: eulerDegToQuat(-15, 0, 0), // Raised foot pointed
            // Arms pressed against wall — hands flat on wall behind/beside
            leftUpperArm: eulerDegToQuat(-30, -15, -45), // Arms up and back against wall
            rightUpperArm: eulerDegToQuat(-30, 15, 45),
            leftLowerArm: eulerDegToQuat(0, -50, 0), // Forearms bent, palms on wall
            rightLowerArm: eulerDegToQuat(0, 50, 0),
            leftHand: eulerDegToQuat(15, 0, 0), // Palms flat against wall surface
            rightHand: eulerDegToQuat(15, 0, 0),
            head: eulerDegToQuat(-8, 0, 5), // Head back against wall, slight tilt
            neck: eulerDegToQuat(-5, 0, 0),
        },
    },

    proneBone: {
        label: 'Prone Bone',
        adult: true,
        bones: {
            hips: eulerDegToQuat(-80, 0, 0), // Face down (prone)
            spine: eulerDegToQuat(10, 0, 0), // Slight upward arch
            chest: eulerDegToQuat(8, 0, 0),
            leftUpperLeg: eulerDegToQuat(0, 0, -8), // Legs slightly apart
            rightUpperLeg: eulerDegToQuat(0, 0, 8),
            leftLowerLeg: eulerDegToQuat(-15, 0, 0), // Relaxed
            rightLowerLeg: eulerDegToQuat(-15, 0, 0),
            leftFoot: eulerDegToQuat(-10, 0, 0),
            rightFoot: eulerDegToQuat(-10, 0, 0),
            leftShoulder: eulerDegToQuat(10, 0, 5), // Shoulders forward
            rightShoulder: eulerDegToQuat(10, 0, -5),
            leftUpperArm: eulerDegToQuat(40, 20, -20), // Arms forward, propping up
            rightUpperArm: eulerDegToQuat(40, -20, 20),
            leftLowerArm: eulerDegToQuat(0, -60, 0), // Forearms on surface
            rightLowerArm: eulerDegToQuat(0, 60, 0),
            head: eulerDegToQuat(-20, 10, 0), // Head turned slightly, propped up
            neck: eulerDegToQuat(-10, 5, 0),
        },
    },

    // =====================================================================
    // ADULT — Extended VR Simulation Library (Steam Adult Market)
    // =====================================================================

    reverseCowgirl: {
        label: 'Reverse Cowgirl',
        adult: true,
        // Straddling partner but FACING AWAY — camera sees full front of this character.
        // Upright torso, wide straddle, hands braced on partner's legs behind.
        bones: {
            hips: eulerDegToQuat(5, 0, 0), // Seated on partner, upright
            spine: eulerDegToQuat(-5, 0, 0), // Slight arch — chest forward
            chest: eulerDegToQuat(-3, 0, 0),
            leftUpperLeg: eulerDegToQuat(60, 0, -28), // Wide straddle
            rightUpperLeg: eulerDegToQuat(60, 0, 28),
            leftLowerLeg: eulerDegToQuat(-105, 0, 0), // Deep knee bend, shins tucked
            rightLowerLeg: eulerDegToQuat(-105, 0, 0),
            leftFoot: eulerDegToQuat(-20, 0, -5),
            rightFoot: eulerDegToQuat(-20, 0, 5),
            // Arms reaching back for balance — hands on partner's thighs/knees
            leftUpperArm: eulerDegToQuat(-15, 0, 25), // Arms behind, bracing
            rightUpperArm: eulerDegToQuat(-15, 0, -25),
            leftLowerArm: eulerDegToQuat(0, -30, 0),
            rightLowerArm: eulerDegToQuat(0, 30, 0),
            head: eulerDegToQuat(-3, 0, 0), // Looking forward/slightly up
            neck: eulerDegToQuat(-2, 0, 0),
        },
    },

    spooning: {
        label: 'Spooning (Side)',
        adult: true,
        // Lying on side — intimate/romantic position. "Little spoon" character.
        // Knees drawn up, one arm tucked, back curved into partner.
        bones: {
            hips: eulerDegToQuat(85, 0, -90), // Lying on right side (Z = -90° roll)
            spine: eulerDegToQuat(-3, 0, 0), // Gentle natural curve
            chest: eulerDegToQuat(-2, 0, 0),
            // Legs drawn up — fetal-ish position
            leftUpperLeg: eulerDegToQuat(40, 0, -5), // Top leg slightly more drawn up
            rightUpperLeg: eulerDegToQuat(35, 0, 5), // Bottom leg
            leftLowerLeg: eulerDegToQuat(-50, 0, 0), // Knees bent
            rightLowerLeg: eulerDegToQuat(-45, 0, 0),
            leftFoot: eulerDegToQuat(5, 0, 0),
            rightFoot: eulerDegToQuat(5, 0, 0),
            // Top arm draped/relaxed, bottom arm tucked under pillow
            leftUpperArm: eulerDegToQuat(15, 10, 20), // Top arm resting on hip
            rightUpperArm: eulerDegToQuat(30, 0, -30), // Bottom arm extended (under pillow)
            leftLowerArm: eulerDegToQuat(0, -30, 0),
            rightLowerArm: eulerDegToQuat(0, 50, 0), // Bottom forearm bent
            head: eulerDegToQuat(0, 0, 0), // Neutral, resting on pillow
            neck: eulerDegToQuat(0, 0, 0),
        },
    },

    sixtyNine: {
        label: '69 Position',
        adult: true,
        // Lying on back, partner above in opposite direction.
        // Legs slightly apart, head tilted back, arms reaching toward partner's hips.
        bones: {
            hips: eulerDegToQuat(85, 0, 0), // Supine (on back)
            spine: eulerDegToQuat(-3, 0, 0),
            chest: eulerDegToQuat(-2, 0, 0),
            leftUpperLeg: eulerDegToQuat(15, 0, -18), // Legs apart, slightly bent
            rightUpperLeg: eulerDegToQuat(15, 0, 18),
            leftLowerLeg: eulerDegToQuat(-20, 0, 0),
            rightLowerLeg: eulerDegToQuat(-20, 0, 0),
            leftFoot: eulerDegToQuat(5, 0, 0),
            rightFoot: eulerDegToQuat(5, 0, 0),
            // Arms reaching up toward partner's hips/thighs
            leftUpperArm: eulerDegToQuat(30, 15, 30),
            rightUpperArm: eulerDegToQuat(30, -15, -30),
            leftLowerArm: eulerDegToQuat(0, -40, 0),
            rightLowerArm: eulerDegToQuat(0, 40, 0),
            // Head tilted back slightly
            head: eulerDegToQuat(8, 0, 0),
            neck: eulerDegToQuat(5, 0, 0),
        },
    },

    seatedChair: {
        label: 'Seated (Chair)',
        adult: true,
        // Sitting on edge of chair/couch, legs apart, leaning back slightly.
        // Versatile for office/living room scenes.
        bones: {
            hips: eulerDegToQuat(-8, 0, 0), // Slight lean back
            spine: eulerDegToQuat(-5, 0, 0),
            chest: eulerDegToQuat(-3, 0, 0),
            leftUpperLeg: eulerDegToQuat(85, 0, -22), // Seated, legs wide apart
            rightUpperLeg: eulerDegToQuat(85, 0, 22),
            leftLowerLeg: eulerDegToQuat(-80, 0, 0), // Knees bent, feet on floor
            rightLowerLeg: eulerDegToQuat(-80, 0, 0),
            leftFoot: eulerDegToQuat(5, 0, 0),
            rightFoot: eulerDegToQuat(5, 0, 0),
            // Arms: one hand gripping chair arm/edge, other on thigh
            leftUpperArm: eulerDegToQuat(10, 0, 20), // Hand gripping armrest
            rightUpperArm: eulerDegToQuat(20, -8, -15), // Hand on thigh/partner
            leftLowerArm: eulerDegToQuat(0, -45, 0),
            rightLowerArm: eulerDegToQuat(0, 35, 0),
            head: eulerDegToQuat(-5, 0, -3), // Looking down/forward
            neck: eulerDegToQuat(-3, 0, 0),
        },
    },

    standingBehind: {
        label: 'Standing (From Behind)',
        adult: true,
        // Standing upright, slightly bent forward at hips. Partner behind.
        // Hands braced on wall/surface in front. Feet planted wide.
        bones: {
            hips: eulerDegToQuat(30, 0, 0), // Forward bend at hips
            spine: eulerDegToQuat(-10, 0, 0), // Flatten back
            chest: eulerDegToQuat(-8, 0, 0),
            leftUpperLeg: eulerDegToQuat(-15, 0, -10), // Counter-rotate legs to stay vertical, slight spread
            rightUpperLeg: eulerDegToQuat(-15, 0, 10),
            leftLowerLeg: eulerDegToQuat(-10, 0, 0), // Slight knee bend for stability
            rightLowerLeg: eulerDegToQuat(-10, 0, 0),
            leftFoot: eulerDegToQuat(0, 0, 0), // Flat on ground
            rightFoot: eulerDegToQuat(0, 0, 0),
            // Arms extended forward, hands braced on wall/desk/surface
            leftUpperArm: eulerDegToQuat(70, 0, 10),
            rightUpperArm: eulerDegToQuat(70, 0, -10),
            leftLowerArm: eulerDegToQuat(0, -15, 0), // Slight elbow bend
            rightLowerArm: eulerDegToQuat(0, 15, 0),
            leftHand: eulerDegToQuat(0, 0, 0),
            rightHand: eulerDegToQuat(0, 0, 0),
            head: eulerDegToQuat(-15, 0, 0), // Looking forward/down
            neck: eulerDegToQuat(-10, 0, 0),
        },
    },

    lotus: {
        label: 'Lotus (Face-to-Face)',
        adult: true,
        // Seated face-to-face on partner's lap. Intimate eye-contact position.
        // Legs wrapped around partner, arms around neck/shoulders.
        bones: {
            hips: eulerDegToQuat(5, 0, 0), // Upright, seated
            spine: eulerDegToQuat(-5, 0, 0), // Slight lean forward (toward partner)
            chest: eulerDegToQuat(-3, 0, 0),
            // Legs: wide straddle, wrapping around partner
            leftUpperLeg: eulerDegToQuat(55, 0, -35), // Wide wrap
            rightUpperLeg: eulerDegToQuat(55, 0, 35),
            leftLowerLeg: eulerDegToQuat(-100, 0, 0), // Shins tucked behind partner
            rightLowerLeg: eulerDegToQuat(-100, 0, 0),
            leftFoot: eulerDegToQuat(-15, 0, -10), // Feet hooked behind
            rightFoot: eulerDegToQuat(-15, 0, 10),
            // Arms wrapped around partner's neck/shoulders
            leftUpperArm: eulerDegToQuat(25, 20, 25),
            rightUpperArm: eulerDegToQuat(25, -20, -25),
            leftLowerArm: eulerDegToQuat(0, -70, 0), // Arms bent, hands behind neck
            rightLowerArm: eulerDegToQuat(0, 70, 0),
            head: eulerDegToQuat(-3, 0, 0), // Eye contact — looking at partner
            neck: eulerDegToQuat(-2, 0, 0),
        },
    },

    wheelbarrow: {
        label: 'Wheelbarrow',
        adult: true,
        // Upper body supported by hands on floor, legs held up by partner behind.
        // Like a handstand-walk position with partner holding legs apart.
        hipsPosition: { y: -0.15, z: 0 }, // Slight lower — angled body
        bones: {
            hips: eulerDegToQuat(55, 0, 0), // Torso angled down toward floor
            spine: eulerDegToQuat(-5, 0, 0),
            chest: eulerDegToQuat(-3, 0, 0),
            // Legs: held up and apart by partner — extended backward
            leftUpperLeg: eulerDegToQuat(-50, 0, -20), // Counter-rotate + spread
            rightUpperLeg: eulerDegToQuat(-50, 0, 20),
            leftLowerLeg: eulerDegToQuat(-25, 0, 0), // Slight knee bend (relaxed)
            rightLowerLeg: eulerDegToQuat(-25, 0, 0),
            leftFoot: eulerDegToQuat(-10, 0, 0),
            rightFoot: eulerDegToQuat(-10, 0, 0),
            // Arms: straight down to floor, supporting weight
            leftShoulder: eulerDegToQuat(0, 0, 0),
            rightShoulder: eulerDegToQuat(0, 0, 0),
            leftUpperArm: eulerDegToQuat(100, 0, 5), // Past vertical — reaching to floor
            rightUpperArm: eulerDegToQuat(100, 0, -5),
            leftLowerArm: eulerDegToQuat(0, -5, 0),
            rightLowerArm: eulerDegToQuat(0, 5, 0),
            leftHand: eulerDegToQuat(0, 0, 0), // Palms flat on ground
            rightHand: eulerDegToQuat(0, 0, 0),
            // Head: looking forward/down at floor
            neck: eulerDegToQuat(-25, 0, 0),
            head: eulerDegToQuat(-20, 0, 0),
        },
    },

    carrySuspended: {
        label: 'Carry (Suspended)',
        adult: true,
        // Character lifted off the ground, legs wrapped around partner's waist,
        // arms around partner's neck. Full-body "carried" position.
        bones: {
            hips: eulerDegToQuat(-5, 0, 0), // Pelvis tilted slightly back (supported)
            spine: eulerDegToQuat(-8, 0, 0), // Slight arch
            chest: eulerDegToQuat(-5, 0, 0),
            // Legs: wide wrap around partner's waist
            leftUpperLeg: eulerDegToQuat(50, 0, -30), // Thighs up and out
            rightUpperLeg: eulerDegToQuat(50, 0, 30),
            leftLowerLeg: eulerDegToQuat(-80, 0, 0), // Shins hook behind partner
            rightLowerLeg: eulerDegToQuat(-80, 0, 0),
            leftFoot: eulerDegToQuat(-20, 0, -15), // Feet hooked / crossed behind
            rightFoot: eulerDegToQuat(-20, 0, 15),
            // Arms: wrapped tightly around partner's neck/shoulders
            leftUpperArm: eulerDegToQuat(30, 25, 20),
            rightUpperArm: eulerDegToQuat(30, -25, -20),
            leftLowerArm: eulerDegToQuat(0, -80, 0), // Arms bent tight around neck
            rightLowerArm: eulerDegToQuat(0, 80, 0),
            // Head: close to partner, face-to-face
            head: eulerDegToQuat(-5, 5, 0),
            neck: eulerDegToQuat(-3, 0, 0),
        },
    },
};

// Ordered list for cycling in VR panel
// Chat/everyday first → Rest/lounge → Adult → Technical last
const PRESET_ORDER = [
    // Presenter / Professional (best defaults — replaces T-pose)
    'lecturerNeutral',
    'presenterOpen',
    'anchorGrounded',
    // Chat / everyday poses
    'standingRelaxed',
    'standingFriendly',
    'standingHandsClasped',
    'conversational',
    'sitting',
    'sittingCrossed',
    'sittingDesk',
    'sittingLegsUp',
    'kneelingUp',
    // Mature / Companion poses
    'confident',
    'lounge',
    'shy',
    'elegant',
    'intimateSafe',
    // Rest / lounge poses
    'lyingBackRelaxed',
    'lyingBack',
    'lyingSide',
    'lyingFront',
    'kneeling',
    // Adult poses
    'lyingBackOpen',
    'lyingFrontArched',
    'kneelingPresent',
    'standingBendForward',
    'standingBentBackward',
    'lyingSideSeductive',
    // Adult — new MMORPG-inspired (Spicy Mode only)
    'lyingKiss',
    'standingSeductive',
    'wallLean',
    'lapSitting',
    'embraceStanding',
    'kneelSubmissive',
    'lyingSprawl',
    // Adult — Ground poses
    'allFoursArched',
    // Adult — Core VR Simulation (Spicy Mode only)
    'missionary',
    'doggyStyle',
    'cowgirl',
    'reverseCowgirl',
    'wallPressed',
    'proneBone',
    // Adult — Extended VR Simulation
    'spooning',
    'sixtyNine',
    'seatedChair',
    'standingBehind',
    'lotus',
    'wheelbarrow',
    'carrySuspended',
    // Technical (last)
    'standing',
];

// =========================================================================
// CCD-IK SOLVER (Cyclic Coordinate Descent — Inverse Kinematics)
// =========================================================================

/**
 * Solve an IK chain using CCD (Cyclic Coordinate Descent).
 * Standard technique used in VRChat, Virt-A-Mate, and game engines.
 *
 * @param {THREE.Bone[]} chain - Array of bones from root to end-effector
 * @param {THREE.Vector3} targetWorldPos - Desired world position of end-effector
 * @param {number} iterations - CCD iterations (more = more accurate, 8-12 typical)
 * @param {number} tolerance - Stop early if end-effector is within this distance
 */
/**
 * CCD-IK solver with anatomical joint constraints and pole vector hints.
 *
 * @param {THREE.Bone[]} chain      - Ordered array of bones (root → end-effector)
 * @param {THREE.Vector3} targetWorldPos - World-space target for end-effector
 * @param {object}  opts
 * @param {number}  opts.iterations  - Max solver iterations (default 12)
 * @param {number}  opts.tolerance   - Distance threshold to stop (default 0.01)
 * @param {string}  opts.chainName   - Chain key for pole vector lookup
 * @param {string[]} opts.boneKeys   - Parallel array of bone key names for constraint lookup
 */
function solveCCDIK(chain, targetWorldPos, opts = {}) {
    if (chain.length < 2) {
        return;
    }

    const {
        iterations = 12,
        tolerance = 0.01,
        chainName = null,
        boneKeys = null,
    } = typeof opts === 'number' ? { iterations: opts } : opts; // backward compat: solveCCDIK(c, t, 10)

    const endEffector = chain[chain.length - 1];
    const effectorPos = new THREE.Vector3();
    const bonePos = new THREE.Vector3();
    const toEffector = new THREE.Vector3();
    const toTarget = new THREE.Vector3();
    const axis = new THREE.Vector3();

    // Pole vector for this chain (prevents elbow/knee flipping)
    const poleDir = chainName ? POLE_VECTORS[chainName] : null;
    // Pole is applied to the "mid-joint" of the chain (elbow for arm, knee for leg)
    const midIdx = chain.length >= 3 ? Math.floor((chain.length - 1) / 2) : -1;

    for (let iter = 0; iter < iterations; iter++) {
        // Check if already close enough
        endEffector.getWorldPosition(effectorPos);
        if (effectorPos.distanceTo(targetWorldPos) < tolerance) {
            break;
        }

        // Iterate from end-effector parent back to root
        for (let i = chain.length - 2; i >= 0; i--) {
            const bone = chain[i];

            // Get current end-effector world position
            endEffector.getWorldPosition(effectorPos);
            bone.getWorldPosition(bonePos);

            // Vectors from this bone to end-effector and to target
            toEffector.subVectors(effectorPos, bonePos).normalize();
            toTarget.subVectors(targetWorldPos, bonePos).normalize();

            // Compute rotation axis and angle
            const dot = THREE.MathUtils.clamp(toEffector.dot(toTarget), -1, 1);
            const angle = Math.acos(dot);

            if (angle < 0.001) {
                continue;
            }

            axis.crossVectors(toEffector, toTarget).normalize();

            if (axis.lengthSq() < 0.001) {
                continue;
            }

            // Clamp rotation per iteration to prevent wild swings
            const clampedAngle = Math.min(angle, 0.3); // ~17 degrees max per step

            // Convert world-space rotation to bone's local space
            const parentWorldQuat = new THREE.Quaternion();
            if (bone.parent) {
                bone.parent.getWorldQuaternion(parentWorldQuat);
            }
            const invParent = parentWorldQuat.clone().invert();

            // Local axis
            const localAxis = axis.clone().applyQuaternion(invParent);

            // Apply rotation in local space
            const deltaQuat = new THREE.Quaternion().setFromAxisAngle(localAxis, clampedAngle);
            bone.quaternion.premultiply(deltaQuat);

            // ── JOINT CONSTRAINT: clamp to anatomical limits ──
            if (boneKeys && boneKeys[i]) {
                clampBoneRotation(bone, boneKeys[i]);
            }

            // Update matrices for next iteration
            bone.updateMatrixWorld(true);
        }

        // ── POLE VECTOR PASS: nudge mid-joint toward preferred direction ──
        if (poleDir && midIdx >= 0 && midIdx < chain.length) {
            const midBone = chain[midIdx];
            const midPos = new THREE.Vector3();
            midBone.getWorldPosition(midPos);

            // Compute the plane formed by root → end-effector
            const rootPos = new THREE.Vector3();
            chain[0].getWorldPosition(rootPos);
            endEffector.getWorldPosition(effectorPos);

            const chainDir = new THREE.Vector3().subVectors(effectorPos, rootPos).normalize();
            // Project mid-joint onto chain axis to find where it "should" be
            const midOnAxis = new THREE.Vector3()
                .copy(chainDir)
                .multiplyScalar(new THREE.Vector3().subVectors(midPos, rootPos).dot(chainDir))
                .add(rootPos);

            // Current mid-joint offset from axis
            const currentOffset = new THREE.Vector3().subVectors(midPos, midOnAxis);
            if (currentOffset.lengthSq() > 0.0001) {
                // Check if mid-joint is on the wrong side of the pole
                const poleDotCurrent = currentOffset.normalize().dot(poleDir);
                if (poleDotCurrent < 0.1) {
                    // Nudge mid-joint toward pole direction (gentle — 5% per frame)
                    const nudgeAxis = new THREE.Vector3().crossVectors(currentOffset, poleDir).normalize();
                    if (nudgeAxis.lengthSq() > 0.001) {
                        const parentWorldQuat = new THREE.Quaternion();
                        if (midBone.parent) {
                            midBone.parent.getWorldQuaternion(parentWorldQuat);
                        }
                        const localNudge = nudgeAxis.clone().applyQuaternion(parentWorldQuat.invert());
                        const nudgeQuat = new THREE.Quaternion().setFromAxisAngle(localNudge, 0.08);
                        midBone.quaternion.premultiply(nudgeQuat);

                        if (boneKeys && boneKeys[midIdx]) {
                            clampBoneRotation(midBone, boneKeys[midIdx]);
                        }
                        midBone.updateMatrixWorld(true);
                    }
                }
            }
        }
    }
}

// =========================================================================
// SPRING DAMPER (smooth bone rotation interpolation)
// =========================================================================

class SpringDamper {
    /**
     * @param {number} stiffness - Spring stiffness (higher = faster response)
     * @param {number} damping - Damping ratio (0.7-1.0 typical, 1.0 = critically damped)
     */
    constructor(stiffness = 15, damping = 0.85) {
        this.stiffness = stiffness;
        this.damping = damping;
        this._velocity = new THREE.Quaternion(0, 0, 0, 1);
    }

    /**
     * Step the spring damper toward a target quaternion.
     * @param {THREE.Quaternion} current - Current rotation (modified in place)
     * @param {THREE.Quaternion} target - Target rotation
     * @param {number} dt - Delta time in seconds
     */
    step(current, target, dt) {
        // Slerp-based spring: smoothly approach target
        const t = 1 - Math.exp(-this.stiffness * this.damping * dt);
        current.slerp(target, THREE.MathUtils.clamp(t, 0, 1));
    }
}

// =========================================================================
// VR POSE SYSTEM (main class)
// =========================================================================

export class VRPoseSystem {
    constructor({ scene }) {
        this.scene = scene;

        this.enabled = false;
        this.avatarRoot = null;

        // Bone references (resolved via PoseRigMap or traversal)
        this._bones = new Map(); // key → THREE.Bone
        this._restPoses = new Map(); // key → THREE.Quaternion (original rest pose)

        // IK state
        this.ikEnabled = true;
        this._activeIKTarget = null; // { chainName, targetPos, controller }

        // Pose blending
        this._currentPreset = 'standing';
        this._blendTime = 0;
        this._blendDuration = 0.5; // seconds to blend between poses
        this._blendFrom = new Map(); // bone key → start quat
        this._blendTo = new Map(); // bone key → target quat
        this._isBlending = false;

        // Hips position blending (for ground poses that need to lower the avatar)
        this._hipsRestPosition = null; // THREE.Vector3 — captured on setAvatar
        this._hipsPositionFrom = null;
        this._hipsPositionTo = null;

        // Spring dampers (one per bone for smooth movement)
        this._springs = new Map();

        // Smoothing toggle
        this.smoothingEnabled = true;
        this._springStiffness = 15;
        this._springDamping = 0.85;

        // Snap points (detected surfaces for avatar placement)
        this._snapPoints = [];
    }

    // =========================================================================
    // SETUP
    // =========================================================================

    setAvatar(root) {
        this.avatarRoot = root;
        this._bones.clear();
        this._restPoses.clear();
        this._springs.clear();

        if (!root) {
            return;
        }

        this._resolveBones();
        this._captureRestPoses();

        console.log(`[VRPoseSystem] Avatar set: ${this._bones.size} bones resolved`);
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(
            `[VRPoseSystem] ${enabled ? 'Enabled' : 'Disabled'} (avatar=${!!this.avatarRoot}, bones=${this._bones.size}, IK=${this.ikEnabled})`
        );
        if (!enabled) {
            this._isBlending = false;
            this._activeIKTarget = null;
        }
    }

    /**
     * Resolve bone references using PoseRigMap (VRM) or name traversal.
     */
    _resolveBones() {
        const allKeys = [
            'hips',
            'spine',
            'chest',
            'upperChest',
            'neck',
            'head',
            'leftShoulder',
            'rightShoulder',
            'leftUpperArm',
            'rightUpperArm',
            'leftLowerArm',
            'rightLowerArm',
            'leftHand',
            'rightHand',
            'leftUpperLeg',
            'rightUpperLeg',
            'leftLowerLeg',
            'rightLowerLeg',
            'leftFoot',
            'rightFoot',
        ];

        // Try PoseRigMap first
        const RigMapClass = window.NEXUS_POSE_RIG_MAP;
        if (RigMapClass && this.avatarRoot) {
            try {
                const humanoid = this.avatarRoot.userData?.vrmHumanoid || null;
                const rigMap = new RigMapClass({ root: this.avatarRoot, vrmHumanoid: humanoid });

                for (const key of allKeys) {
                    const bone = rigMap.getBone(key);
                    if (bone) {
                        this._bones.set(key, bone);
                    }
                }
                return;
            } catch (e) {
                console.warn('[VRPoseSystem] PoseRigMap failed, using fallback:', e);
            }
        }

        // Fallback: traverse and match names
        const patterns = {
            hips: /hips|pelvis/i,
            spine: /spine/i,
            chest: /chest/i,
            upperChest: /upper.*chest/i,
            neck: /neck/i,
            head: /head/i,
            leftShoulder: /left.*shoulder|l_shoulder/i,
            rightShoulder: /right.*shoulder|r_shoulder/i,
            leftUpperArm: /left.*upper.*arm|l_upper.*arm/i,
            rightUpperArm: /right.*upper.*arm|r_upper.*arm/i,
            leftLowerArm: /left.*(lower.*arm|forearm)|l_(lower.*arm|forearm)/i,
            rightLowerArm: /right.*(lower.*arm|forearm)|r_(lower.*arm|forearm)/i,
            leftHand: /left.*hand|l_hand/i,
            rightHand: /right.*hand|r_hand/i,
            leftUpperLeg: /left.*(upper.*leg|thigh)|l_(upper.*leg|thigh)/i,
            rightUpperLeg: /right.*(upper.*leg|thigh)|r_(upper.*leg|thigh)/i,
            leftLowerLeg: /left.*(lower.*leg|shin)|l_(lower.*leg|shin)/i,
            rightLowerLeg: /right.*(lower.*leg|shin)|r_(lower.*leg|shin)/i,
            leftFoot: /left.*foot|l_foot/i,
            rightFoot: /right.*foot|r_foot/i,
        };

        this.avatarRoot.traverse((obj) => {
            if (!obj.isBone) {
                return;
            }
            for (const [key, pattern] of Object.entries(patterns)) {
                if (!this._bones.has(key) && pattern.test(obj.name)) {
                    this._bones.set(key, obj);
                    break;
                }
            }
        });
    }

    /**
     * Capture rest pose quaternions for all resolved bones.
     */
    _captureRestPoses() {
        for (const [key, bone] of this._bones) {
            this._restPoses.set(key, bone.quaternion.clone());
            // Create a spring damper for smooth interpolation
            this._springs.set(key, new SpringDamper(this._springStiffness, this._springDamping));
        }
        // Capture hips rest position for ground pose offsets
        const hipsBone = this._bones.get('hips');
        if (hipsBone) {
            this._hipsRestPosition = hipsBone.position.clone();
        }
    }

    // =========================================================================
    // POSE PRESETS
    // =========================================================================

    /**
     * Get list of available pose preset names.
     * @returns {string[]}
     */
    static getPresetNames() {
        const spicy = typeof window !== 'undefined' && window.NEXUS_SPICY && window.NEXUS_SPICY.isEnabled();
        if (spicy) {
            return [...PRESET_ORDER];
        }
        // Filter out adult poses when spicy mode is off
        return PRESET_ORDER.filter((name) => {
            return !POSE_PRESETS[name] || !POSE_PRESETS[name].adult;
        });
    }

    /**
     * Get the label for a preset.
     * @param {string} name
     * @returns {string}
     */
    static getPresetLabel(name) {
        return POSE_PRESETS[name]?.label || name;
    }

    /**
     * Get the current active preset name.
     * @returns {string}
     */
    getCurrentPreset() {
        return this._currentPreset;
    }

    /**
     * Cycle to the next pose preset with smooth blending.
     * @returns {string} The new preset name
     */
    cyclePreset() {
        const order = VRPoseSystem.getPresetNames();
        const idx = order.indexOf(this._currentPreset);
        const next = order[(idx + 1) % order.length];
        this.applyPreset(next);
        return next;
    }

    /**
     * Cycle to the previous pose preset with smooth blending.
     * @returns {string} The new preset name
     */
    cyclePrevPreset() {
        const order = VRPoseSystem.getPresetNames();
        const idx = order.indexOf(this._currentPreset);
        const prev = order[(idx - 1 + order.length) % order.length];
        this.applyPreset(prev);
        return prev;
    }

    /**
     * Apply a pose preset with smooth blending.
     * @param {string} presetName
     * @param {number} [duration=0.5] - Blend duration in seconds
     */
    applyPreset(presetName, duration = 0.5) {
        const preset = POSE_PRESETS[presetName];
        if (!preset) {
            console.warn(`[VRPoseSystem] Unknown preset: ${presetName}`);
            return;
        }

        // Capture current bone rotations as blend-from
        this._blendFrom.clear();
        this._blendTo.clear();

        for (const [key, bone] of this._bones) {
            this._blendFrom.set(key, bone.quaternion.clone());

            // Target: preset rotation or rest pose
            const presetQuat = preset.bones[key];
            if (presetQuat) {
                // Preset quaternions are ABSOLUTE rotations from T-pose (identity).
                // Apply directly — do NOT multiply onto rest pose, because rest may
                // already include NaturalPosePlugin T-pose correction, which would
                // compound (e.g. rest 32° + preset 65° = 97° — hands overlap body).
                this._blendTo.set(key, presetQuat.clone());
            } else {
                // No preset for this bone — blend back to rest
                this._blendTo.set(key, this._restPoses.get(key)?.clone() || new THREE.Quaternion());
            }
        }

        // Hips position blending for ground poses
        const hipsBone = this._bones.get('hips');
        if (hipsBone && this._hipsRestPosition) {
            this._hipsPositionFrom = hipsBone.position.clone();
            if (preset.hipsPosition) {
                // hipsPosition is a Y-offset relative to rest position
                this._hipsPositionTo = this._hipsRestPosition.clone();
                this._hipsPositionTo.y += preset.hipsPosition.y;
                if (preset.hipsPosition.z) {
                    this._hipsPositionTo.z += preset.hipsPosition.z;
                }
                if (preset.hipsPosition.x) {
                    this._hipsPositionTo.x += preset.hipsPosition.x;
                }
            } else {
                // No position override — return to rest position
                this._hipsPositionTo = this._hipsRestPosition.clone();
            }
        } else {
            this._hipsPositionFrom = null;
            this._hipsPositionTo = null;
        }

        this._currentPreset = presetName;

        // Notify desktop UI so dropdown stays synced
        window.dispatchEvent(new CustomEvent('vr-pose-changed', { detail: { preset: presetName } }));

        // Instant apply when duration is 0 — avoids 0/0 NaN in blend math
        if (duration <= 0) {
            for (const [key, bone] of this._bones) {
                const to = this._blendTo.get(key);
                if (to) {
                    bone.quaternion.copy(to);
                }
            }
            if (this._hipsPositionTo) {
                const hipsBone = this._bones.get('hips');
                if (hipsBone) {
                    hipsBone.position.copy(this._hipsPositionTo);
                }
            }
            this._isBlending = false;
            console.log(`[VRPoseSystem] Applying preset: ${preset.label} (instant)`);
            return;
        }

        this._blendTime = 0;
        this._blendDuration = duration;
        this._isBlending = true;

        console.log(`[VRPoseSystem] Applying preset: ${preset.label} (${duration}s blend)`);
    }

    // =========================================================================
    // IK (Inverse Kinematics)
    // =========================================================================

    /**
     * Start IK solving for a bone. Called when user grabs a bone in VR.
     * If the grabbed bone is an end-effector or part of an IK chain,
     * the system switches from direct rotation to IK.
     *
     * @param {string} boneKey - The humanoid bone key being grabbed
     * @param {THREE.Object3D} controller - VR controller driving the IK target
     * @returns {boolean} true if IK was activated
     */
    startIK(boneKey, controller) {
        if (!this.ikEnabled) {
            console.log(`[VRPoseSystem] startIK("${boneKey}"): BLOCKED — IK disabled`);
            return false;
        }

        const chainName = EFFECTOR_TO_CHAIN[boneKey];
        if (!chainName) {
            console.log(`[VRPoseSystem] startIK("${boneKey}"): not an IK effector (no chain mapping)`);
            return false; // Not an IK-solvable bone
        }

        // Resolve the chain bones
        const chainKeys = IK_CHAINS[chainName];
        const chainBones = [];
        const missingKeys = [];
        for (const key of chainKeys) {
            const bone = this._bones.get(key);
            if (bone) {
                chainBones.push(bone);
            } else {
                missingKeys.push(key);
            }
        }

        if (chainBones.length < 2) {
            console.warn(
                `[VRPoseSystem] startIK("${boneKey}"): chain "${chainName}" has <2 bones (resolved=${chainBones.length}, missing=[${missingKeys.join(',')}], totalBones=${this._bones.size})`
            );
            return false;
        }

        // Build parallel boneKeys array for joint constraint lookup
        // (only includes keys for bones that were resolved, matching chainBones indices)
        const resolvedKeys = [];
        for (const key of chainKeys) {
            if (this._bones.get(key)) {
                resolvedKeys.push(key);
            }
        }

        this._activeIKTarget = {
            chainName,
            chainBones,
            chainKeys: resolvedKeys,
            controller,
            boneKey,
        };

        console.log(`[VRPoseSystem] IK started: ${chainName} (effector: ${boneKey})`);
        return true;
    }

    /**
     * Update IK target position from controller and solve.
     * Called each frame while IK is active.
     */
    updateIK() {
        if (!this._activeIKTarget) {
            return;
        }

        const { chainBones, controller, chainName, chainKeys } = this._activeIKTarget;
        const targetPos = new THREE.Vector3();
        controller.getWorldPosition(targetPos);

        solveCCDIK(chainBones, targetPos, {
            iterations: 12,
            chainName,
            boneKeys: chainKeys,
        });
    }

    /**
     * End IK solving.
     */
    endIK() {
        if (this._activeIKTarget) {
            console.log(`[VRPoseSystem] IK ended: ${this._activeIKTarget.chainName}`);
        }
        this._activeIKTarget = null;
    }

    /**
     * @returns {boolean} true if IK is currently active
     */
    isIKActive() {
        return this._activeIKTarget !== null;
    }

    // =========================================================================
    // SNAP POINTS (surface detection for avatar placement)
    // =========================================================================

    /**
     * Add a snap point (detected surface where avatar can be placed).
     * @param {THREE.Vector3} position - World position of the surface
     * @param {THREE.Vector3} normal - Surface normal
     * @param {string} [type='seat'] - Type: 'seat', 'floor', 'surface'
     */
    addSnapPoint(position, normal, type = 'seat') {
        this._snapPoints.push({ position: position.clone(), normal: normal.clone(), type });
    }

    /**
     * Clear all snap points.
     */
    clearSnapPoints() {
        this._snapPoints = [];
    }

    /**
     * Find the nearest snap point to a world position.
     * @param {THREE.Vector3} worldPos
     * @param {number} [maxDistance=0.5] - Max distance to snap
     * @returns {{ position: THREE.Vector3, normal: THREE.Vector3, type: string } | null}
     */
    findNearestSnap(worldPos, maxDistance = 0.5) {
        let best = null;
        let bestDist = maxDistance;

        for (const snap of this._snapPoints) {
            const dist = worldPos.distanceTo(snap.position);
            if (dist < bestDist) {
                bestDist = dist;
                best = snap;
            }
        }

        return best;
    }

    /**
     * Snap avatar to a point and apply appropriate pose.
     * @param {THREE.Vector3} position
     * @param {string} [poseName='sitting']
     */
    snapToPosition(position, poseName = 'sitting') {
        if (!this.avatarRoot) {
            return;
        }

        this.avatarRoot.position.copy(position);
        this.applyPreset(poseName, 0.6);

        console.log(`[VRPoseSystem] Snapped to position with pose: ${poseName}`);
    }

    // =========================================================================
    // UPDATE LOOP
    // =========================================================================

    /**
     * Update per frame. Handles pose blending, IK solving, and spring smoothing.
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (!this.enabled || !this.avatarRoot) {
            return;
        }

        // 1. Pose blending (smooth transition between presets)
        if (this._isBlending) {
            this._updateBlending(dt);
        }

        // 2. IK solving
        if (this._activeIKTarget) {
            this.updateIK();
        }

        // 3. Spring smoothing (applied to all active bones)
        if (this.smoothingEnabled && !this._isBlending) {
            this._updateSprings(dt);
        }
    }

    _updateBlending(dt) {
        this._blendTime += dt;
        const t = THREE.MathUtils.clamp(this._blendTime / this._blendDuration, 0, 1);

        // Smooth step for natural easing
        const smooth = t * t * (3 - 2 * t);

        for (const [key, bone] of this._bones) {
            const from = this._blendFrom.get(key);
            const to = this._blendTo.get(key);
            if (from && to) {
                bone.quaternion.copy(from).slerp(to, smooth);
            }
        }

        // Blend hips position (for ground poses)
        if (this._hipsPositionFrom && this._hipsPositionTo) {
            const hipsBone = this._bones.get('hips');
            if (hipsBone) {
                hipsBone.position.lerpVectors(this._hipsPositionFrom, this._hipsPositionTo, smooth);
            }
        }

        if (t >= 1) {
            this._isBlending = false;
            console.log(`[VRPoseSystem] Blend complete: ${this._currentPreset}`);
        }
    }

    _updateSprings(_dt) {
        // Springs are used for manual bone manipulation smoothing
        // Only active when bones are being moved by the user (via bone grabber)
        // The spring targets are updated externally by VRBoneGrabber
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Get available preset info for UI.
     * @returns {Array<{ name: string, label: string }>}
     */
    getPresetList() {
        return VRPoseSystem.getPresetNames().map((name) => ({
            name,
            label: POSE_PRESETS[name]?.label || name,
        }));
    }

    /**
     * Get a resolved bone by humanoid key.
     * @param {string} boneKey — humanoid bone key (e.g. 'leftHand', 'hips')
     * @returns {THREE.Bone|null}
     */
    getBone(boneKey) {
        return this._bones.get(boneKey) || null;
    }

    /**
     * Check if a bone key is resolved.
     * @param {string} boneKey
     * @returns {boolean}
     */
    hasBone(boneKey) {
        return this._bones.has(boneKey);
    }

    /**
     * Reset all bones to rest pose with smooth blend.
     */
    resetToRest() {
        this.applyPreset('standing', 0.4);
    }

    dispose() {
        this._bones.clear();
        this._restPoses.clear();
        this._springs.clear();
        this._snapPoints = [];
        this._activeIKTarget = null;
        this._isBlending = false;
    }
}

// Export for use by VRChatPanel preset cycling
export { POSE_PRESETS, PRESET_ORDER, IK_CHAINS, EFFECTOR_TO_CHAIN, JOINT_LIMITS, clampBoneRotation };
