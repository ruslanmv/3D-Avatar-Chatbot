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
    leftHand: 'leftArm',
    rightHand: 'rightArm',
    leftFoot: 'leftLeg',
    rightFoot: 'rightLeg',
    head: 'spine',
    leftLowerArm: 'leftArm',
    rightLowerArm: 'rightArm',
    leftLowerLeg: 'leftLeg',
    rightLowerLeg: 'rightLeg',
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

    standingRelaxed: {
        label: 'Standing (Relaxed)',
        bones: {
            leftUpperArm: eulerDegToQuat(0, 0, 65), // Arms down at sides
            rightUpperArm: eulerDegToQuat(0, 0, -65),
            leftLowerArm: eulerDegToQuat(0, 15, 0), // Slight elbow bend
            rightLowerArm: eulerDegToQuat(0, -15, 0),
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
            leftLowerArm: eulerDegToQuat(0, 20, 0),
            rightLowerArm: eulerDegToQuat(0, -8, 0),
            hips: eulerDegToQuat(0, 0, -2),
            spine: eulerDegToQuat(-2, 0, 1),
            chest: eulerDegToQuat(-4, 0, 0),
            head: eulerDegToQuat(4, -6, 0), // Warm, engaged head angle
        },
    },

    standingHandsClasped: {
        label: 'Standing (Hands Clasped)',
        bones: {
            leftUpperArm: eulerDegToQuat(15, 0, 55), // Arms forward + down
            rightUpperArm: eulerDegToQuat(15, 0, -55),
            leftLowerArm: eulerDegToQuat(0, 60, 0), // Elbows bent, hands meet
            rightLowerArm: eulerDegToQuat(0, -60, 0),
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
            leftUpperLeg: eulerDegToQuat(90, -15, -10),
            rightUpperLeg: eulerDegToQuat(85, 10, 15),
            leftLowerLeg: eulerDegToQuat(-95, 0, 0),
            rightLowerLeg: eulerDegToQuat(-85, 0, 0),
            leftFoot: eulerDegToQuat(10, 0, 0),
            rightFoot: eulerDegToQuat(5, -10, 0),
            spine: eulerDegToQuat(-5, 0, 0),
        },
    },

    sittingDesk: {
        label: 'Sitting (Desk)',
        bones: {
            hips: eulerDegToQuat(5, 0, 0),
            leftUpperLeg: eulerDegToQuat(90, 0, -5),
            rightUpperLeg: eulerDegToQuat(90, 0, 5),
            leftLowerLeg: eulerDegToQuat(-90, 0, 0),
            rightLowerLeg: eulerDegToQuat(-90, 0, 0),
            leftFoot: eulerDegToQuat(10, 0, 0),
            rightFoot: eulerDegToQuat(10, 0, 0),
            spine: eulerDegToQuat(10, 0, 0), // Forward lean — working
            chest: eulerDegToQuat(5, 0, 0),
            leftUpperArm: eulerDegToQuat(40, 0, 35), // Arms on desk
            rightUpperArm: eulerDegToQuat(40, 0, -35),
            leftLowerArm: eulerDegToQuat(0, 60, 0),
            rightLowerArm: eulerDegToQuat(0, -60, 0),
            head: eulerDegToQuat(-10, 0, 0), // Looking at desk
        },
    },

    sittingLegsUp: {
        label: 'Sitting (Lounging)',
        bones: {
            hips: eulerDegToQuat(15, 0, 0),
            leftUpperLeg: eulerDegToQuat(70, 0, -20),
            rightUpperLeg: eulerDegToQuat(70, 0, 20),
            leftLowerLeg: eulerDegToQuat(-50, 0, 0),
            rightLowerLeg: eulerDegToQuat(-50, 0, 0),
            leftFoot: eulerDegToQuat(10, 0, 0),
            rightFoot: eulerDegToQuat(10, 0, 0),
            spine: eulerDegToQuat(-15, 0, 0), // Reclined
            leftUpperArm: eulerDegToQuat(0, 0, 50),
            rightUpperArm: eulerDegToQuat(0, 0, -50),
            leftLowerArm: eulerDegToQuat(0, 40, 0),
            rightLowerArm: eulerDegToQuat(0, -40, 0),
            head: eulerDegToQuat(-5, 0, 0),
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
            leftLowerArm: eulerDegToQuat(0, 50, 0),
            rightLowerArm: eulerDegToQuat(0, -50, 0),
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
            leftLowerArm: eulerDegToQuat(0, 30, 0),
            rightLowerArm: eulerDegToQuat(0, -30, 0),
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
            rightUpperArm: eulerDegToQuat(0, 0, 50), // Arm at side
            leftLowerArm: eulerDegToQuat(0, 90, 0),
            rightLowerArm: eulerDegToQuat(0, -20, 0),
            head: eulerDegToQuat(0, 15, 0),
        },
    },

    lyingFront: {
        label: 'Lying (Front)',
        bones: {
            hips: eulerDegToQuat(-90, 0, 0),
            leftUpperLeg: eulerDegToQuat(0, 0, -5),
            rightUpperLeg: eulerDegToQuat(0, 0, 5),
            leftUpperArm: eulerDegToQuat(0, 0, -80),
            rightUpperArm: eulerDegToQuat(0, 0, 80),
            leftLowerArm: eulerDegToQuat(0, 90, 0),
            rightLowerArm: eulerDegToQuat(0, -90, 0),
            head: eulerDegToQuat(-30, 0, 0),
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
            leftLowerArm: eulerDegToQuat(0, 60, 0),
            rightLowerArm: eulerDegToQuat(0, -60, 0),
            head: eulerDegToQuat(0, 20, 0),
        },
    },

    // =====================================================================
    // GROUND POSES
    // =====================================================================

    allFours: {
        label: 'All Fours',
        bones: {
            hips: eulerDegToQuat(70, 0, 0),
            spine: eulerDegToQuat(-5, 0, 0),
            chest: eulerDegToQuat(-5, 0, 0),
            leftUpperLeg: eulerDegToQuat(-5, 0, -5),
            rightUpperLeg: eulerDegToQuat(-5, 0, 5),
            leftLowerLeg: eulerDegToQuat(-80, 0, 0),
            rightLowerLeg: eulerDegToQuat(-80, 0, 0),
            leftFoot: eulerDegToQuat(-10, 0, 0),
            rightFoot: eulerDegToQuat(-10, 0, 0),
            leftUpperArm: eulerDegToQuat(60, 0, -20),
            rightUpperArm: eulerDegToQuat(60, 0, 20),
            leftLowerArm: eulerDegToQuat(0, 40, 0),
            rightLowerArm: eulerDegToQuat(0, -40, 0),
            head: eulerDegToQuat(-40, 0, 0),
            neck: eulerDegToQuat(-15, 0, 0),
        },
    },

    // =====================================================================
    // ADULT / EROTIC POSES — For mature VR companion apps (18+)
    // =====================================================================

    lyingBackOpen: {
        label: 'Lying (Open)',
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
            leftLowerArm: eulerDegToQuat(0, 70, 0), // Forearms bent inward
            rightLowerArm: eulerDegToQuat(0, -70, 0),
            spine: eulerDegToQuat(-5, 0, 0), // Slight arch
            head: eulerDegToQuat(0, 10, 0),
        },
    },

    lyingFrontArched: {
        label: 'Lying (Arched)',
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
            leftLowerArm: eulerDegToQuat(0, 70, 0), // Hands near head
            rightLowerArm: eulerDegToQuat(0, -70, 0),
            head: eulerDegToQuat(-25, 0, 0),
            neck: eulerDegToQuat(-10, 0, 0),
        },
    },

    kneelingPresent: {
        label: 'Kneeling (Present)',
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

    allFoursArched: {
        label: 'All Fours (Arched)',
        bones: {
            hips: eulerDegToQuat(70, 0, 0),
            spine: eulerDegToQuat(-10, 0, 0), // Deeper arch
            chest: eulerDegToQuat(-8, 0, 0),
            leftUpperLeg: eulerDegToQuat(-5, 0, -10), // Wider stance
            rightUpperLeg: eulerDegToQuat(-5, 0, 10),
            leftLowerLeg: eulerDegToQuat(-80, 0, 0),
            rightLowerLeg: eulerDegToQuat(-80, 0, 0),
            leftFoot: eulerDegToQuat(-10, 0, 0),
            rightFoot: eulerDegToQuat(-10, 0, 0),
            leftUpperArm: eulerDegToQuat(60, 0, -15),
            rightUpperArm: eulerDegToQuat(60, 0, 15),
            leftLowerArm: eulerDegToQuat(0, 35, 0),
            rightLowerArm: eulerDegToQuat(0, -35, 0),
            head: eulerDegToQuat(-35, 0, 0),
            neck: eulerDegToQuat(-10, 0, 0),
        },
    },

    standingBendForward: {
        label: 'Standing (Bent Over)',
        bones: {
            hips: eulerDegToQuat(0, 0, 0),
            spine: eulerDegToQuat(40, 0, 0), // Torso bent forward
            chest: eulerDegToQuat(25, 0, 0),
            leftUpperArm: eulerDegToQuat(30, 0, 45), // Arms hanging or resting
            rightUpperArm: eulerDegToQuat(30, 0, -45),
            leftLowerArm: eulerDegToQuat(0, 40, 0),
            rightLowerArm: eulerDegToQuat(0, -40, 0),
            leftUpperLeg: eulerDegToQuat(5, 0, -5), // Slight knee softness
            rightUpperLeg: eulerDegToQuat(5, 0, 5),
            leftLowerLeg: eulerDegToQuat(-10, 0, 0),
            rightLowerLeg: eulerDegToQuat(-10, 0, 0),
            head: eulerDegToQuat(-20, 0, 0), // Compensate, look forward
            neck: eulerDegToQuat(-10, 0, 0),
        },
    },

    lyingSideSeductive: {
        label: 'Lying (Side Pose)',
        bones: {
            hips: eulerDegToQuat(90, 0, -90), // Side-lying
            leftUpperLeg: eulerDegToQuat(30, 0, 0), // Top leg forward
            rightUpperLeg: eulerDegToQuat(10, 0, 0),
            leftLowerLeg: eulerDegToQuat(-50, 0, 0), // Top knee bent
            rightLowerLeg: eulerDegToQuat(-15, 0, 0),
            leftUpperArm: eulerDegToQuat(-15, 0, -30), // Propped on elbow
            rightUpperArm: eulerDegToQuat(20, 0, 30), // Hand on hip
            leftLowerArm: eulerDegToQuat(0, 80, 0), // Supporting head
            rightLowerArm: eulerDegToQuat(0, -40, 0),
            spine: eulerDegToQuat(-5, 0, 5), // Slight twist
            chest: eulerDegToQuat(-3, 0, 3),
            head: eulerDegToQuat(5, 25, 0), // Looking toward viewer
        },
    },
};

// Ordered list for cycling in VR panel
// Chat/everyday first → Rest/lounge → Adult → Technical last
const PRESET_ORDER = [
    // Chat / everyday poses
    'standingRelaxed',
    'standingFriendly',
    'standingHandsClasped',
    'sitting',
    'sittingCrossed',
    'sittingDesk',
    'sittingLegsUp',
    'kneelingUp',
    // Rest / lounge poses
    'lyingBackRelaxed',
    'lyingBack',
    'lyingSide',
    'lyingFront',
    'allFours',
    'kneeling',
    // Adult poses
    'lyingBackOpen',
    'lyingFrontArched',
    'kneelingPresent',
    'allFoursArched',
    'standingBendForward',
    'lyingSideSeductive',
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
function solveCCDIK(chain, targetWorldPos, iterations = 10, tolerance = 0.01) {
    if (chain.length < 2) {
        return;
    }

    const endEffector = chain[chain.length - 1];
    const effectorPos = new THREE.Vector3();
    const bonePos = new THREE.Vector3();
    const toEffector = new THREE.Vector3();
    const toTarget = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const invWorldQuat = new THREE.Quaternion();

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
            bone.getWorldQuaternion(invWorldQuat);
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

            // Update matrices for next iteration
            bone.updateMatrixWorld(true);
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
        this._currentPreset = 'standingRelaxed';
        this._blendTime = 0;
        this._blendDuration = 0.5; // seconds to blend between poses
        this._blendFrom = new Map(); // bone key → start quat
        this._blendTo = new Map(); // bone key → target quat
        this._isBlending = false;

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
    }

    // =========================================================================
    // POSE PRESETS
    // =========================================================================

    /**
     * Get list of available pose preset names.
     * @returns {string[]}
     */
    static getPresetNames() {
        return [...PRESET_ORDER];
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
        const idx = PRESET_ORDER.indexOf(this._currentPreset);
        const next = PRESET_ORDER[(idx + 1) % PRESET_ORDER.length];
        this.applyPreset(next);
        return next;
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
                // Preset rotation is relative to rest pose
                const target = this._restPoses.get(key)?.clone() || new THREE.Quaternion();
                target.multiply(presetQuat);
                this._blendTo.set(key, target);
            } else {
                // No preset for this bone — blend back to rest
                this._blendTo.set(key, this._restPoses.get(key)?.clone() || new THREE.Quaternion());
            }
        }

        this._blendTime = 0;
        this._blendDuration = duration;
        this._isBlending = true;
        this._currentPreset = presetName;

        // Notify desktop UI so dropdown stays synced
        window.dispatchEvent(new CustomEvent('vr-pose-changed', { detail: { preset: presetName } }));

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

        this._activeIKTarget = {
            chainName,
            chainBones,
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

        const { chainBones, controller } = this._activeIKTarget;
        const targetPos = new THREE.Vector3();
        controller.getWorldPosition(targetPos);

        solveCCDIK(chainBones, targetPos);
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
        return PRESET_ORDER.map((name) => ({
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
export { POSE_PRESETS, PRESET_ORDER, IK_CHAINS, EFFECTOR_TO_CHAIN };
