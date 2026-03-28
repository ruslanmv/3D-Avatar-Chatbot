# Avatar Pose System — Complete Engineering Reference

**Author:** Ruslan Magana Vsevolodovna
**System:** 3D-Avatar-Chatbot VR Pose & IK Pipeline
**Files:** `VRPoseSystem.js` (2410 lines) · `PoseNormalizer.js` (606 lines)

Complete reference for the avatar pose preset system, IK solvers, full-body equations,
and proposed VAM-style torso upgrade. Covers all available poses, the API for
programmatic control (useful for AI-driven pose selection), and how VR and Desktop
stay synchronized.

---

## Part I: Architecture

The pose system has two layers:

| Layer | File | Purpose |
|-------|------|---------|
| **VRPoseSystem** | `src/gltf-viewer/VRPoseSystem.js` | Full-body IK-grade poses with spring-damped blending. Primary system. |
| **PoseNormalizer** | `src/PoseNormalizer.js` | Legacy T-pose correction (arms only). Desktop fallback. |

VRPoseSystem is the authoritative source. It runs on both desktop and VR.
Changes made in either context sync via the `vr-pose-changed` event.

### Supporting Files

| File | Purpose |
|------|---------|
| `src/PoseApplier.js` | High-level bone manipulation with slider-based editing, mirroring |
| `src/PoseRigMap.js` | Unified bone mapping (VRM humanoid API or name-based fallback) |
| `src/PoseState.js` | Pose capture/restore with delta quaternions relative to neutral snapshot |
| `src/PoseHandleIK.js` | Stub for phase 3 IK handle system (not yet implemented) |
| `src/gltf-viewer/VRBoneGrabber.js` | Direct bone rotation via VR controller grip |

---

## Part II: IK Solver Architecture

The system routes each grabbed bone to the appropriate solver based on body region:

```
┌─────────────────────────────────────────────────────────────────┐
│                       updateIK() Router                        │
├──────────────┬──────────────────────┬──────────────────────────┤
│    Legs      │       Arms           │         Spine            │
│ solveLegIK() │   solveCCDIK()       │     solveCCDIK()         │
│              │   (production)       │                          │
│ Analytical   │                      │ Iterative CCD            │
│ 2-bone IK    │ Iterative CCD        │ (12 iter, 6-bone chain)  │
│ + hinge knee │ (12 iter, 4-bone)    │                          │
│ + pole vector│ + pole vector nudge  │                          │
│ + SLERP      │ + joint constraints  │                          │
└──────────────┴──────────────────────┴──────────────────────────┘
```

**Key insight:** Legs use the VaM-style analytical solver. Arms and spine currently
use CCD-IK. A VaM-style arm solver (`solveArmIK`) based on the ozz-animation
IKTwoBoneJob has been designed but is **not yet integrated** into the `updateIK()`
router (see Part VIII for the code review). The spine uses CCD because it is a
6-bone chain with no simple analytical solution.

### IK Chain Definitions

```javascript
const IK_CHAINS = {
    leftArm:  ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'],
    rightArm: ['rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'],
    leftLeg:  ['leftUpperLeg', 'leftLowerLeg', 'leftFoot'],
    rightLeg: ['rightUpperLeg', 'rightLowerLeg', 'rightFoot'],
    spine:    ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head'],
};
```

### Grab Offset (All Chains)

When the user grabs a bone, the controller is at the user's **hand**, not at the bone.
Without correction, the bone would teleport to the hand on the first frame.

**At grab time (`startIK`):**

```
offset = boneWorldPosition - controllerWorldPosition
```

**Each frame (`updateIK`):**

```
targetPosition = controllerWorldPosition + offset
```

Result: the bone stays in its original position and only moves when the hand physically moves.

---

## Part III: Legs — `solveLegIK()` — VaM-Style Analytical Solver

**Chain:** `[upperLeg, lowerLeg, foot]`
**Source:** `VRPoseSystem.js:1409–1589`

The leg is a 2-bone system: thigh (hip→knee) + shin (knee→foot). The hip joint is a
3-DOF ball joint that handles all 3D positioning. The knee is a 1-DOF hinge that only
flexes/extends.

### 3.1 Bone Lengths

```
thighLen = distance(hipWorldPos, kneeWorldPos)
shinLen  = distance(kneeWorldPos, footWorldPos)
```

### 3.2 Step 1 — Clamp Target to Reachable Range

```
maxReach = (thighLen + shinLen) × 0.999    // avoid singularity at full extension
minReach = |thighLen - shinLen| × 1.01     // avoid singularity when folded
dist     = clamp(distance(hip, target), minReach, maxReach)
```

### 3.3 Step 2 — Law of Cosines: Exact Knee Angle

The triangle formed by hip, knee, and foot target has known side lengths (thighLen, shinLen,
dist). The law of cosines gives the exact angles with zero iteration:

```
            hip
           / \
  thighLen/   \ dist
         /     \
       knee────foot
         shinLen
```

**Hip angle** (angle at hip vertex):

```
cos(hipAngle) = (thighLen² + dist² - shinLen²) / (2 · thighLen · dist)
hipAngle = acos(clamp(cos(hipAngle), -1, 1))
```

**Knee angle** (angle at knee vertex):

```
cos(kneeAngle) = (thighLen² + shinLen² - dist²) / (2 · thighLen · shinLen)
kneeAngle = acos(clamp(cos(kneeAngle), -1, 1))
```

**Knee flexion** (how much the knee bends from straight):

```
kneeFlexion = π - kneeAngle
```

When `kneeAngle = π` → leg is straight (no flexion).
When `kneeAngle < π` → knee is bent.

### 3.4 Step 3 — Pole Vector: Knee Plane

The pole vector defines which direction the knee points. For human legs, knees point
forward (+Z) with a slight outward bias to prevent knees from touching.

```
poleVector = normalize(lateralSign, 0, 1)
  where lateralSign = -0.15 (left leg) or +0.15 (right leg)
```

Build orthonormal frame from hip→target direction and pole vector:

```
forward = normalize(target - hip)
side    = normalize(cross(forward, poleVector))
up      = normalize(cross(side, forward))
```

### 3.5 Step 4 — Knee World Position

The knee sits on the triangle at the computed hip angle:

```
kneeWorldPos = hip + thighLen × (cos(hipAngle) × forward + sin(hipAngle) × up)
```

### 3.6 Step 5 — Aim Rotations

**Upper leg (hip ball joint, 3-DOF)** — aims from hip toward computed knee position:

```
thighDirection = normalize(kneeWorldPos - hipWorldPos)
upperLeg.quaternion = aimQuat(upperLeg, thighDirection)
```

**Lower leg (knee hinge, 1-DOF)** — analytical flexion applied directly:

```
lowerLeg.quaternion = Quaternion.fromAxisAngle(X_AXIS, -kneeFlexion)
```

The flexion is applied as a **pure X-axis rotation**. The hip's 3-DOF ball joint already
positioned the knee correctly in 3D space via the pole vector, so the shin only needs
the correct bend amount — no aim-then-constrain.

### 3.7 Knee Hinge Constraint

The knee is physically a 1-DOF hinge joint:

| Axis | Allowed | Range |
|------|---------|-------|
| **X (flexion)** | Yes | 0° to 155° (bend) |
| **Y (lateral)** | No | Zeroed |
| **Z (twist)** | No | Zeroed |

Hyperextension (flamingo) is blocked at 5° with a soft spring zone.

Implementation (`applyKneeHingeConstraint`):

```javascript
euler.y = 0;  // zero lateral
euler.z = 0;  // zero twist
// Soft-limit flexion: 0° to 155° with 15° spring zone
if (euler.x > 0) euler.x = softClamp(euler.x, 5°, 15°);   // hyperextension
if (euler.x < 0) euler.x = -softClamp(-euler.x, 155°, 15°); // over-flexion
```

### 3.8 Knee Grab Mode

When the user grabs the knee instead of the foot:

```
1. upperLeg aims from hip → grabbed position (ball joint follows controller)
2. lowerLeg hangs with gravity blend: shinDir = lerp((0,-1,0), toOriginalFoot, 0.3)
3. Hinge constraint applied to shin quaternion
4. SLERP damping on both bones
```

---

## Part IV: Arms — Current Production Solver (CCD-IK)

**Chain:** `[shoulder, upperArm, lowerArm, hand]`
**Source:** `VRPoseSystem.js:1626–1750` (via `solveCCDIK`)

Arms currently use the **CCD-IK solver** — the same general-purpose solver used for
the spine. This is adequate for a 4-bone chain but has known limitations compared
to an analytical approach.

### 4.1 CCD Algorithm

For each iteration (max 12):

```
for bone in chain (end-effector parent → root):
    effectorPos = endEffector.getWorldPosition()
    bonePos     = bone.getWorldPosition()

    toEffector = normalize(effectorPos - bonePos)
    toTarget   = normalize(targetPos - bonePos)

    angle = acos(clamp(dot(toEffector, toTarget), -1, 1))
    axis  = normalize(cross(toEffector, toTarget))

    clampedAngle = min(angle, 0.3)    // ~17° max per step

    // Convert to local space
    localAxis = axis × inverse(parent.worldQuaternion)
    bone.quaternion = Quaternion.fromAxisAngle(localAxis, clampedAngle) × bone.quaternion

    // Constrain to anatomical limits
    clampBoneRotation(bone, boneKey)
```

**Early termination:** Stops if `distance(effector, target) < 0.01`.

### 4.2 Pole Vector Pass (Elbow Steering)

After each CCD iteration, the mid-joint (elbow) is nudged toward the preferred
direction to prevent flipping:

```
poleDir = (0, 0, -1)    // elbows point backward

// Project elbow offset onto chain axis
chainDir = normalize(effectorPos - rootPos)
midOnAxis = rootPos + dot(midPos - rootPos, chainDir) × chainDir
currentOffset = midPos - midOnAxis

// If elbow is on wrong side of pole vector:
if dot(normalize(currentOffset), poleDir) < 0.1:
    nudge by 0.04 rad toward pole direction
```

### 4.3 Limitations of CCD for Arms

| Issue | Description |
|-------|-------------|
| Iterative convergence | 12 iterations per frame vs. 0 for analytical |
| Pole vector is post-hoc | Nudging fights the solver rather than being built into geometry |
| No SLERP damping | Frame-to-frame popping possible |
| No shoulder pre-rotation | Clavicle doesn't help expand workspace |
| No separate wrist solve | Wrist orientation tied to positional solve |

---

## Part V: Spine — `solveCCDIK()`

**Chain:** `[hips, spine, chest, upperChest, neck, head]`
**Source:** `VRPoseSystem.js:1626–1750`

The spine is a 6-bone chain with no analytical solution (not a simple 2-bone system).
CCD-IK is the correct choice here.

### 5.1 Algorithm

Same CCD as described in Part IV, with:
- Max 12 iterations
- 0.3 rad (~17°) max rotation per bone per iteration
- Anatomical joint constraints applied via `clampBoneRotation()`
- No pole vector pass (none defined for spine)

### 5.2 Spine Joint Limits

| Bone | X (pitch) | Y (yaw) | Z (roll) |
|------|-----------|---------|----------|
| hips | ±45° | ±30° | ±30° |
| spine | ±35° | ±25° | ±20° |
| chest | ±25° | ±20° | ±15° |
| upperChest | ±15° | ±15° | ±10° |
| neck | -40° to 30° | ±40° | ±30° |
| head | -35° to 40° | ±50° | ±20° |

---

## Part VI: Shared Utilities

### 6.1 `computeAimQuat(bone, worldDirection)`

Computes the local quaternion needed to aim a bone's axis along a world direction:

```
parentWorldQuat = bone.parent.getWorldQuaternion()
localDirection  = worldDirection × inverse(parentWorldQuat)
boneAxis = bone.children[0].position.normalize()   // auto-detect from child
         // fallback: (0, 1, 0) for VRM
quaternion = Quaternion.fromUnitVectors(boneAxis, localDirection)
```

### 6.2 `softClamp(angle, limit, softZone)`

VaM-style spring falloff instead of hard clamp:

```
if angle ≤ limit - softZone:  return angle           // safe zone
if angle ≥ limit:             return limit            // past hard limit

// Spring zone: smooth hermite interpolation
t = (angle - (limit - softZone)) / softZone           // 0 → 1
smooth = t² × (3 - 2t)                                // smoothstep
return (limit - softZone) + smooth × softZone
```

```
Force ▲
      │          ┌── hard limit
      │         ╱
      │        ╱  ← spring zone (15°)
      │       ╱
      │──────╱     ← safe zone (no resistance)
      └──────────────► angle
```

### 6.3 SLERP Damping

Previous frame's quaternion blends toward the new solution:

```
result = slerp(previousQuat, targetQuat, 1 - dampingFactor)
```

| Chain | Damping Factor | Convergence |
|-------|---------------|-------------|
| Legs | 0.30 | ~3 frames |
| Arms (proposed) | 0.25 | ~2-3 frames (faster for responsiveness) |

Damping state resets when the grab ends (`endIK`), so each new grab starts fresh.

### 6.4 Spring Damper (Pose Blending)

Used for smooth pose preset transitions (not IK):

```javascript
class SpringDamper {
    constructor(stiffness = 15, damping = 0.85)

    step(current, target, dt) {
        const t = 1 - Math.exp(-stiffness × damping × dt)
        current.slerp(target, clamp(t, 0, 1))
    }
}
```

Pose blending uses smoothstep easing:

```
t = blendTime / blendDuration    // 0 → 1
smooth = t² × (3 - 2t)          // smoothstep
bone.quaternion = slerp(fromQuat, toQuat, smooth)
```

---

## Part VII: Complete Joint Limits Reference

All limits in degrees. Soft spring zone = 15° before each hard limit.

### Arms

| Joint | X (flex/extend) | Y (lateral) | Z (twist) |
|-------|----------------|-------------|-----------|
| leftShoulder | ±30° | ±15° | ±15° |
| rightShoulder | ±30° | ±15° | ±15° |
| leftUpperArm | -120° to 80° | -85° to 130° | -90° to 30° |
| rightUpperArm | -120° to 80° | -130° to 85° | -30° to 90° |
| leftLowerArm | -5° to 150° | -5° to 5° | -90° to 80° |
| rightLowerArm | -5° to 150° | -5° to 5° | -80° to 90° |
| leftHand | ±75° | -40° to 30° | ±20° |
| rightHand | ±75° | -30° to 40° | ±20° |

### Legs

| Joint | X (flex/extend) | Y (lateral) | Z (twist) |
|-------|----------------|-------------|-----------|
| leftUpperLeg | -130° to 35° | -45° to 60° | -30° to 45° |
| rightUpperLeg | -130° to 35° | -60° to 45° | -45° to 30° |
| leftLowerLeg | -155° to 5° | -5° to 5° | -5° to 5° |
| rightLowerLeg | -155° to 5° | -5° to 5° | -5° to 5° |
| leftFoot | -45° to 55° | ±25° | ±20° |
| rightFoot | -45° to 55° | ±25° | ±20° |

### Spine

| Joint | X (pitch) | Y (yaw) | Z (roll) |
|-------|-----------|---------|----------|
| hips | ±45° | ±30° | ±30° |
| spine | ±35° | ±25° | ±20° |
| chest | ±25° | ±20° | ±15° |
| upperChest | ±15° | ±15° | ±10° |
| neck | -40° to 30° | ±40° | ±30° |
| head | -35° to 40° | ±50° | ±20° |

---

## Part VIII: Proposed VaM-Style Arm IK — Code Review

A `solveArmIK()` function based on the ozz-animation IKTwoBoneJob (same approach as
VaM) has been designed but is **not yet wired** into `updateIK()`. Below is the
complete design, equations, and code review with identified issues.

### 8.1 Why Arms Need a Different Approach Than Legs

| Aspect | Legs | Arms |
|--------|------|------|
| Rotation type | Absolute (set from scratch) | **Correction** (delta applied to current) |
| Hinge axis | Fixed X axis | **Computed** from bone cross product |
| Solve order | Upper first, then lower | **Lower first** (mid joint), then upper |
| Pole vector | Part of triangle geometry | **Separate plane rotation** step |
| Orientation | Always point downward (gravity) | Can be **any orientation** (T-pose, raised, behind back) |

Legs can use absolute rotations because the bone's local X axis consistently maps to
the flexion axis. Arms CANNOT because in T-pose the local X axis points **along the arm**
— rotating around it would spin the forearm like a propeller, not bend the elbow.

### 8.2 Proposed Algorithm — ozz-Style Two-Bone IK

#### Step 0: Shoulder Pre-Rotation

VaM solves the shoulder independently. The clavicle subtly rotates toward the target
to expand the arm's reachable workspace:

```
shoulderAim = computeAimQuat(shoulder, normalize(target - shoulderPos))
shoulderRotation = slerp(identity, shoulderAim, 0.2)   // 20% contribution
```

Clamped to anatomical shoulder limits (±30° all axes).

#### Step 1: Clamp Target Distance

```
upperLen = distance(upperArmPos, elbowPos)
foreLen  = distance(elbowPos, handPos)
maxReach = (upperLen + foreLen) × 0.999
minReach = |upperLen - foreLen| × 1.01
dist     = clamp(distance(upperArm, target), minReach, maxReach)
```

#### Step 2: Mid Joint Correction (Elbow) — Solved FIRST

**Critical: the elbow is corrected FIRST** (before the upper arm). The mid joint
correction changes the end-effector position, and the start joint then aims the
corrected chain at the target.

**2a. Compute current elbow angle:**

```
boneA = elbowPos - upperArmPos      // upper arm direction
boneB = handPos - elbowPos           // forearm direction
currentAngle = π - angleBetween(boneA, boneB)
```

**2b. Compute target elbow angle from law of cosines:**

```
cos(targetAngle) = (upperLen² + foreLen² - dist²) / (2 · upperLen · foreLen)
targetAngle = π - acos(clamp(cos(targetAngle), -1, 1))
```

**2c. Compute natural hinge axis:**

The hinge axis is the **cross product of the two bone directions** — the axis
perpendicular to the plane formed by the three joints:

```
hingeAxisWorld = normalize(cross(boneA, boneB))
```

If the arm is nearly straight (degenerate cross product), a fallback axis
perpendicular to the bone direction is used.

**2d. Apply correction:**

```
deltaAngle = targetAngle - currentAngle
hingeAxisLocal = hingeAxisWorld × inverse(parent.worldQuaternion)
midCorrection = Quaternion.fromAxisAngle(hingeAxisLocal, deltaAngle)
lowerArm.quaternion = midCorrection × lowerArm.quaternion   // premultiply
```

#### Step 3: Start Joint Correction (Upper Arm) — Solved SECOND

**3a. Aim correction — rotate current effector → target:**

```
currentDir = normalize(handPos_afterMidCorrection - upperArmPos)
targetDir  = normalize(targetPos - upperArmPos)
aimCorrection = Quaternion.fromUnitVectors(currentDir, targetDir)
```

**3b. Pole vector alignment — rotate chain plane to match pole:**

After aiming, the elbow can still be anywhere around the aim axis (like a
clock hand). The pole vector picks which position:

```
poleVector = normalize(lateralSign, -0.3, -1)     // backward + down/outward
  where lateralSign = +0.15 (left) or -0.15 (right)

1. Project elbow position onto the aim axis → get perpendicular offset
2. Project pole vector onto same perpendicular plane
3. Compute angle between current elbow direction and pole direction
4. Rotate around aim axis by that angle

elbowProjected = elbowPos - dot(elbowOffset, aimAxis) × aimAxis
poleProjected  = poleVector - dot(poleVector, aimAxis) × aimAxis
poleAngle = acos(dot(normalize(elbowProjected), normalize(poleProjected)))
sign = sign(dot(cross(elbowProjected, poleProjected), aimAxis))
poleRotation = Quaternion.fromAxisAngle(aimAxis, sign × poleAngle)
totalCorrection = poleRotation × aimCorrection
```

**3c. Convert to local space and apply:**

```
localCorrection = inverse(parentWorldQuat) × totalCorrection × parentWorldQuat
upperArm.quaternion = localCorrection × upperArm.quaternion   // premultiply
```

#### Step 4: Wrist Orientation (Separate Solver)

VaM separates arm IK (position) from wrist solving (orientation):

```
controllerWorldQuat = controller.getWorldQuaternion()
parentWorldQuat     = hand.parent.getWorldQuaternion()
handLocalQuat       = inverse(parentWorldQuat) × controllerWorldQuat
```

Clamped to anatomical wrist limits:

| Axis | Range |
|------|-------|
| X (flex/extend) | ±75° |
| Y (radial/ulnar deviation) | ±40° |
| Z (pronation/supination) | ±20° |

### 8.3 Code Review — Issues Found in `solveArmIK()`

The proposed `solveArmIK()` code has several issues that must be fixed before integration:

**Issue 1: `hLimit` used as function but is a function reference**

```javascript
// BUG (line ~wrist solver):
const hLimit = THREE.MathUtils.degToRad;
handEuler.x = THREE.MathUtils.clamp(handEuler.x, -hLimit(75), hLimit(75));
```

This actually works because `hLimit` is assigned the function reference `degToRad`,
so `hLimit(75)` calls `degToRad(75)`. It's functional but confusing — should be
written as:

```javascript
// CLEARER:
const toRad = THREE.MathUtils.degToRad;
handEuler.x = THREE.MathUtils.clamp(handEuler.x, -toRad(75), toRad(75));
```

**Issue 2: `midCorrection.multiply()` mutates the quaternion**

```javascript
// BUG:
const midCorrection = new THREE.Quaternion().setFromAxisAngle(hingeAxisLocal, deltaAngle);
const midResultQ = midCorrection.multiply(lowerArm.quaternion.clone());
```

`midCorrection.multiply(x)` modifies `midCorrection` in place and returns it. So
`midResultQ === midCorrection` (same reference). This works but is misleading.
Clearer:

```javascript
const midResultQ = midCorrection.clone().multiply(lowerArm.quaternion);
```

**Issue 3: `localCorrection` chain mutation**

```javascript
// BUG:
const localCorrection = _armInvParentQ.clone().multiply(aimCorrection).multiply(_armParentQ.clone());
const upperResultQ = localCorrection.multiply(upperArm.quaternion.clone());
```

Same issue — `localCorrection` is mutated by `.multiply(upperArm.quaternion.clone())`.
The result is correct but confusing. After this line, `localCorrection` is no longer
the local correction — it's the final result.

**Issue 4: No integration with `updateIK()` router**

The current `updateIK()` sends arms to `solveCCDIK()`:

```javascript
// VRPoseSystem.js:2202-2214
const isLeg = chainName === 'leftLeg' || chainName === 'rightLeg';
if (isLeg) {
    solveLegIK(chainBones, targetPos, chainName, boneKey);
} else {
    solveCCDIK(chainBones, targetPos, { ... });  // ← arms go here
}
```

To integrate `solveArmIK`, the router needs:

```javascript
const isLeg = chainName === 'leftLeg' || chainName === 'rightLeg';
const isArm = chainName === 'leftArm' || chainName === 'rightArm';
if (isLeg) {
    solveLegIK(chainBones, targetPos, chainName, boneKey);
} else if (isArm) {
    solveArmIK(chainBones, targetPos, chainName, boneKey, controller);
} else {
    solveCCDIK(chainBones, targetPos, { ... }); // spine only
}
```

**Issue 5: `resetArmDampState` not called in `endIK()`**

`endIK()` only calls `resetLegDampState()`. It must also call `resetArmDampState()`
for arm chains, or stale SLERP state will persist across grabs.

**Issue 6: Asymmetric wrist Y limits not handled**

The wrist clamping uses symmetric ±40° for Y, but the joint limits table defines
asymmetric values (leftHand Y: -40° to 30°, rightHand Y: -30° to 40°). The code
should read from `JOINT_LIMITS[boneKey]` instead of hardcoding.

---

## Part IX: Proposed VAM-Style Torso IK — Analytical Spine Solver

### 9.1 Problem Statement

The spine currently uses CCD-IK, which is adequate but has known issues for torso
dragging:

| Issue | Description |
|-------|-------------|
| **Convergence cost** | 12 iterations × 6 bones = 72 rotations per frame |
| **Distribution** | CCD concentrates rotation on bones closest to effector |
| **Oscillation** | Can jitter when target is near-but-not-at a joint limit |
| **No twist distribution** | Axial twist isn't spread across vertebrae |

### 9.2 Proposed Solution: Segmented Analytical Torso IK

Split the 6-bone spine into **two 2-bone analytical segments** plus a **head aim**:

```
Segment 1 (Lumbar):    hips → spine → chest
Segment 2 (Thoracic):  chest → upperChest → neck
Head Aim:              neck → head (single-bone aim)
```

Each 2-bone segment uses the **same law-of-cosines solver as legs**, with
per-segment pole vectors and soft constraints:

```
┌─────────────────────────────────────────────────────────────────┐
│              Proposed: solveTorsoIK()                           │
├──────────────┬──────────────────────┬──────────────────────────┤
│  Lumbar      │   Thoracic           │         Head             │
│  2-bone      │   2-bone             │     Single aim           │
│  analytical  │   analytical         │                          │
│  hips→chest  │   chest→neck         │     neck→head            │
│              │                      │                          │
│ pole: (0,1,0)│ pole: (0,1,0)        │ lookAt target            │
│ (bend fwd)   │ (bend fwd)           │                          │
└──────────────┴──────────────────────┴──────────────────────────┘
```

### 9.3 Equations — Lumbar Segment

**Chain:** `[hips, spine, chest]`

```
lumbarLen = distance(hipsPos, spinePos)
thoracicLen = distance(spinePos, chestPos)
dist = clamp(distance(hips, chestTarget), minReach, maxReach)

// Law of cosines — exact angle at spine
cos(spineAngle) = (lumbarLen² + thoracicLen² - dist²) / (2 · lumbarLen · thoracicLen)
spineAngle = acos(clamp(cos(spineAngle), -1, 1))
spineFlexion = π - spineAngle
```

**Pole vector** for torso: `(0, 0, 1)` — bending forward is the primary motion:

```
forward = normalize(chestTarget - hipsPos)
side    = normalize(cross(forward, (0, 0, 1)))
up      = normalize(cross(side, forward))

// Spine world position from triangle
spineWorldPos = hips + lumbarLen × (cos(hipAngle) × forward + sin(hipAngle) × up)
```

**Hips** aim at computed spine position (3-DOF ball joint):

```
hips.quaternion = aimQuat(hips, normalize(spineWorldPos - hipsPos))
```

**Spine** gets analytical flexion:

```
spine.quaternion = Quaternion.fromAxisAngle(X_AXIS, -spineFlexion)
```

### 9.4 Equations — Thoracic Segment

Same approach, applied to `[chest, upperChest, neck]`:

```
upperLen = distance(chestPos, upperChestPos)
neckLen  = distance(upperChestPos, neckPos)
dist = clamp(distance(chest, neckTarget), minReach, maxReach)

cos(upperChestAngle) = (upperLen² + neckLen² - dist²) / (2 · upperLen · neckLen)
upperChestFlexion = π - acos(clamp(cos(upperChestAngle), -1, 1))
```

### 9.5 Twist Distribution

Unlike legs (no twist needed), the torso needs **axial twist distributed across
vertebrae**. When the user rotates the grabbed bone around the spine axis:

```
totalTwist = extractTwistComponent(targetRotation, spineAxis)

// Distribute proportionally (lumbar gets less, thoracic gets more)
hips.twist        = totalTwist × 0.15
spine.twist       = totalTwist × 0.20
chest.twist       = totalTwist × 0.25
upperChest.twist  = totalTwist × 0.25
neck.twist        = totalTwist × 0.15
```

This mimics real human spine mechanics where rotation is distributed across all
vertebrae, with the thoracic region contributing the most.

### 9.6 Soft Constraints Per Segment

Each segment uses the same `softClamp` as legs, with segment-specific limits:

| Segment | Max Flexion | Max Lateral | Max Twist | Soft Zone |
|---------|------------|-------------|-----------|-----------|
| Lumbar (hips→chest) | 60° | 40° | 30° | 12° |
| Thoracic (chest→neck) | 35° | 25° | 20° | 10° |
| Head (neck→head) | 55° | 55° | 30° | 15° |

### 9.7 Advantages Over CCD

| Aspect | CCD (current) | VAM Analytical (proposed) |
|--------|---------------|--------------------------|
| Iterations | 72 rotations/frame | **0** (analytical) |
| Twist | Uncontrolled | **Distributed** proportionally |
| Bend distribution | Concentrates at effector-end | **Even** across segment |
| Jitter at limits | Possible | **Eliminated** by soft clamp |
| Frame smoothing | None | **SLERP damping** |
| Performance | ~0.5ms | **~0.1ms** (estimated) |

### 9.8 Integration Path — Additive Mode Toggle

This should be implemented as an **alternative mode**, not a replacement. A mode
flag in `updateIK()` would select between solvers:

```javascript
// Proposed addition to updateIK() — NOT modifying existing infrastructure
const isLeg = chainName === 'leftLeg' || chainName === 'rightLeg';
const isSpine = chainName === 'spine';

if (isLeg) {
    solveLegIK(chainBones, targetPos, chainName, boneKey);
} else if (isSpine && this._useAnalyticalSpine) {
    // Future: VAM-style segmented analytical solve
    solveTorsoIK(chainBones, targetPos, chainName, boneKey);
} else {
    solveCCDIK(chainBones, targetPos, { iterations: 12, chainName, boneKeys });
}
```

The `_useAnalyticalSpine` flag would default to `false`, preserving current behavior.

---

## Part X: Available Pose Presets (42 total)

### Presenter / Professional Poses

| Preset Key | Label | Description |
|------------|-------|-------------|
| `lecturerNeutral` | Lecturer (Neutral) | Arms at ~36° abduction, subtle spine offset. |
| `presenterOpen` | Presenter (Open) | Wider arm spread, forward spine tilt. |
| `anchorGrounded` | Anchor (Grounded) | Professional neutral, low arm position. |

### Chat / Everyday Poses

| Preset Key | Label | Description | Best For |
|------------|-------|-------------|----------|
| `standingRelaxed` | Standing (Relaxed) | Arms at sides (65° abduction), slight S-curve weight shift, subtle head tilt. **Default pose.** | General chat, idle, spawn |
| `standingFriendly` | Standing (Friendly) | Asymmetric arm hang, warmer body language, engaged head angle. | Companion interaction |
| `standingHandsClasped` | Standing (Hands Clasped) | Hands clasped in front, professional upright posture. | Secretary, presenter |
| `conversational` | Conversational | Engaged dialogue pose, asymmetric arms. | Active conversation |
| `sitting` | Sitting | Standard chair sit, legs at 90°, spine leaned back slightly. | Chair, bench |
| `sittingCrossed` | Sitting (Crossed) | Left leg crossed over right, casual sitting. | Casual seated |
| `sittingDesk` | Sitting (Desk) | Forward lean, arms on desk surface, looking down at work. | Working at desk |
| `sittingLegsUp` | Sitting (Lounging) | Reclined, legs up, arms resting on sides. | Couch, sofa |
| `kneelingUp` | Kneeling (Up) | Knees on ground, torso upright, hands on thighs, looking up. | Attentive kneeling |

### Companion / Mature (Non-Explicit)

| Preset Key | Label | Description |
|------------|-------|-------------|
| `confident` | Confident | Asymmetric positioning, hips shifted. |
| `lounge` | Lounge | Relaxed asymmetric arms, head tilt. |
| `shy` | Shy | Enclosed posture, arms closer to body. |
| `elegant` | Elegant | Refined asymmetric pose, slight spine twist. |
| `intimateSafe` | Intimate | Close interpersonal distance pose. |

### Rest / Lounge Poses

| Preset Key | Label | Description |
|------------|-------|-------------|
| `lyingBackRelaxed` | Lying (Relaxed) | Supine, one leg bent, one arm behind head, natural asymmetry. |
| `lyingBack` | Lying (Back) | Supine, symmetrical, arms out to sides. |
| `lyingSide` | Lying (Side) | Side-lying, legs staggered, arms positioned naturally. |
| `lyingFront` | Lying (Front) | Face down (prone), arms forward, head turned. |
| `kneeling` | Kneeling | Seiza-style, sitting on heels, shins folded back. |

### Standing Variations

| Preset Key | Label | Description |
|------------|-------|-------------|
| `standingBendForward` | Standing (Bent Over) | Hip hinge forward, arms hanging. |
| `standingBentBackward` | Standing (Bent Backward) | Lumbar extension, chest opens. |

### Adult Poses (18+ — Spicy Mode Only)

| Preset Key | Label | Adult |
|------------|-------|-------|
| `lyingBackOpen` | Lying (Open) | Yes |
| `lyingFrontArched` | Lying (Arched) | Yes |
| `kneelingPresent` | Kneeling (Present) | Yes |
| `allFoursArched` | Bent Forward (Arched) | Yes |
| `lyingSideSeductive` | Lying (Side Pose) | Yes |
| `lyingKiss` | Lying (Kiss Me) | Yes |
| `standingSeductive` | Standing (Seductive) | Yes |
| `wallLean` | Wall Lean | Yes |
| `lapSitting` | Lap Sitting | Yes |
| `embraceStanding` | Embrace (Standing) | Yes |
| `kneelSubmissive` | Kneeling (Submissive) | Yes |
| `lyingSprawl` | Lying (Sprawl) | Yes |
| `missionary` | Missionary | Yes |
| `doggyStyle` | Doggy Style | Yes |
| `cowgirl` | Cowgirl (Mounted) | Yes |
| `reverseCowgirl` | Reverse Cowgirl | Yes |
| `wallPressed` | Wall Pressed | Yes |
| `proneBone` | Prone Bone | Yes |
| `spooning` | Spooning (Side) | Yes |
| `sixtyNine` | 69 Position | Yes |
| `seatedChair` | Seated (Chair) | Yes |
| `standingBehind` | Standing (From Behind) | Yes |
| `lotus` | Lotus (Face-to-Face) | Yes |
| `wheelbarrow` | Wheelbarrow | Yes |
| `carrySuspended` | Carry (Suspended) | Yes |

### Technical

| Preset Key | Label | Description |
|------------|-------|-------------|
| `standing` | Standing (Rest / T-Pose) | VRM rest pose (T-pose). Arms at 90°. For debug/reset only. |

---

## Part XI: Cycle Order

When cycling poses with the VR panel POSE button, presets follow this order:

```
Presenter → lecturerNeutral → presenterOpen → anchorGrounded

Chat → standingRelaxed → standingFriendly → standingHandsClasped
     → conversational → sitting → sittingCrossed → sittingDesk
     → sittingLegsUp → kneelingUp

Companion → confident → lounge → shy → elegant → intimateSafe

Rest → lyingBackRelaxed → lyingBack → lyingSide → lyingFront → kneeling

Adult → lyingBackOpen → lyingFrontArched → kneelingPresent
      → standingBendForward → standingBentBackward → lyingSideSeductive
      → lyingKiss → standingSeductive → wallLean → lapSitting
      → embraceStanding → kneelSubmissive → lyingSprawl
      → allFoursArched → missionary → doggyStyle → cowgirl
      → reverseCowgirl → wallPressed → proneBone → spooning
      → sixtyNine → seatedChair → standingBehind → lotus
      → wheelbarrow → carrySuspended

Tech → standing (T-Pose)
```

Adult poses are filtered out when Spicy Mode is disabled.

---

## Part XII: API Reference (for AI / LLM Integration)

The AI can control avatar poses programmatically via `window.vrPoseSystem`.
This is the recommended interface for LLM-driven pose selection.

### Apply a Pose

```javascript
// Apply a pose with smooth blending (0.6s transition)
window.vrPoseSystem.applyPreset('sittingDesk', 0.6);

// Quick snap (0.2s)
window.vrPoseSystem.applyPreset('standingRelaxed', 0.2);

// Slow dramatic transition (1.5s)
window.vrPoseSystem.applyPreset('lyingBackRelaxed', 1.5);
```

### Query Current Pose

```javascript
const current = window.vrPoseSystem.getCurrentPreset();
// → 'standingRelaxed'
```

### List All Available Poses

```javascript
const names = VRPoseSystem.getPresetNames();
// → ['lecturerNeutral', 'presenterOpen', ..., 'standing']

const list = window.vrPoseSystem.getPresetList();
// → [{ name: 'lecturerNeutral', label: 'Lecturer (Neutral)' }, ...]

const label = VRPoseSystem.getPresetLabel('sittingDesk');
// → 'Sitting (Desk)'
```

### Cycle Poses

```javascript
const next = window.vrPoseSystem.cyclePreset();    // forward
const prev = window.vrPoseSystem.cyclePrevPreset(); // backward
```

### Reset to Default

```javascript
window.vrPoseSystem.resetToRest();
// Blends back to T-pose (0.4s)
```

### Listen for Pose Changes

```javascript
window.addEventListener('vr-pose-changed', (e) => {
    console.log('Pose changed to:', e.detail.preset);
});
```

---

## Part XIII: Desktop / VR Sync

Both interfaces share the same VRPoseSystem instance via `window.vrPoseSystem`:

```
Desktop Dropdown (index.html #vr-pose-preset)
    │
    ├── change event → vrPoseSystem.applyPreset()
    │                       │
    │                       ├── Blends bones via spring damper
    │                       └── Dispatches 'vr-pose-changed' event
    │                                          │
    │                                          └── VR Panel listens → updates label
    │
VR Panel POSE Button (VRChatPanel.js)
    │
    └── tap → vrPoseSystem.cyclePreset()
                    │
                    ├── Blends bones
                    └── Dispatches 'vr-pose-changed' event
                                       │
                                       └── Desktop dropdown listens → updates selection
```

Priority: VR changes always win. Desktop is a convenience mirror.

---

## Part XIV: Bone Reference

Each pose defines rotations for a subset of these humanoid bones:

```
                    head
                     │
                    neck
                     │
                 upperChest
                     │
                   chest
                  /     \
        leftShoulder   rightShoulder
              │               │
        leftUpperArm    rightUpperArm
              │               │
        leftLowerArm    rightLowerArm
              │               │
          leftHand        rightHand
                     │
                   spine
                     │
                    hips
                   /    \
        leftUpperLeg    rightUpperLeg
              │               │
        leftLowerLeg    rightLowerLeg
              │               │
          leftFoot        rightFoot
```

Rotations are specified as quaternions derived from Euler degrees (X=pitch, Y=yaw, Z=roll)
relative to the VRM rest pose (T-pose).

---

## Part XV: PoseNormalizer — Legacy Desktop System

`PoseNormalizer.js` is the legacy T-pose correction system. It operates on **arms only**
using world-space direction alignment — a fundamentally different approach from the
IK solvers.

### Algorithm

Instead of IK chains, PoseNormalizer:

1. Computes each limb's **current** world-space direction (bone → child bone)
2. Compares to a **target** relaxed-standing direction vector
3. Solves a correction quaternion: `correction = fromUnitVectors(currentDir, targetDir)`
4. Converts to local bone space: `localCorrection = invParent × correction × parent`
5. Applies with intensity blend: `bone.quaternion.premultiply(slerp(identity, localCorrection, intensity))`

### Presets (Direction Vectors, Not Quaternions)

| Preset | Purpose |
|--------|---------|
| `relaxedStanding` | Natural arms-down standing |
| `naturalIdle` | Default idle (slightly more tucked) |
| `portrait` | Tight arms for thumbnails |
| `presentation` | Wider arms for stage |

Each preset defines world-space target direction vectors per bone (e.g., leftUpperArm:
`(-0.5, -0.82, 0.08)` meaning mostly down with slight left and forward offset).

### When It's Used

PoseNormalizer runs on desktop **before** VRPoseSystem takes over. Once VRPoseSystem
is active (VR or desktop dropdown), PoseNormalizer corrections are overridden by
the absolute quaternion presets.

---

## Part XVI: Comparison — All Three Solvers

| Aspect | Leg (VaM Analytical) | Arm (CCD, production) | Arm (ozz, proposed) | Spine (CCD) |
|--------|---------------------|----------------------|--------------------|----|
| Solver type | One-shot law of cosines | Iterative CCD (12 iter) | Correction quaternions | Iterative CCD (12 iter) |
| Iterations/frame | **0** | 48 (12 × 4 bones) | **0** | 72 (12 × 6 bones) |
| Hinge constraint | True 1-DOF (Y/Z zeroed) | Hard Euler clamp | Cross-product axis | Hard Euler clamp |
| Pole vector | Built into triangle | Post-hoc nudge (0.04 rad) | Plane rotation step | None |
| SLERP damping | Yes (0.30) | No | Yes (0.25) | No |
| Shoulder | N/A | Part of CCD chain | Independent pre-rotation | N/A |
| Wrist | N/A | Part of CCD chain | Separate orientation solver | N/A |
| Mid-chain grab | Dedicated knee mode | Same solver | Dedicated elbow mode | Same solver |

---

## Part XVII: VaM Techniques Summary

| Technique | Equation | Purpose |
|-----------|----------|---------|
| Law of cosines | `cos(θ) = (a² + b² - c²) / 2ab` | Exact joint angle — no iteration |
| Pole vector plane | `knee = hip + len × (cos(θ)·fwd + sin(θ)·up)` | Decides which way joint bends |
| Hinge constraint | `euler.y = 0; euler.z = 0` | Restricts to single-axis rotation |
| Soft clamp | `smoothstep(t) = t²(3-2t)` | Gradual spring at limits |
| SLERP damping | `slerp(prev, target, 1 - factor)` | Smooth frame-to-frame transitions |
| Grab offset | `offset = bone - controller` | Prevents teleport on grab |
| Correction quats (ozz) | `delta × current` | Orientation-agnostic joint correction |
| Cross-product hinge | `axis = cross(boneA, boneB)` | Natural hinge axis for any pose |
| Twist distribution | `bone.twist = total × weight` | Spread rotation across chain |

---

## Part XVIII: Pose Mode — Pose Navigator Integration

The Pose Navigator (inside Pose Studio panel) allows users to cycle through predefined
poses using arrow buttons or keyboard left/right arrows. This section documents how
pose mode coordinates bone control between VRPoseSystem and ProceduralAnimator.

### The Problem

Three systems compete for bone control every frame:

| System | Runs in | Writes to | Purpose |
|--------|---------|-----------|---------|
| **ClipAnimationLoader** | `AvatarAliveness` hook | Raw or normalized bones | BVH/VRMA clip playback |
| **ProceduralAnimator** | `ViewerEngine.animate()` | Raw bones | Breathing, head tracking, base pose |
| **VRPoseSystem** | `ViewerEngine.animate()` | Normalized bones (via PoseRigMap) | Pose presets with smooth blending |

Without coordination, ProceduralAnimator resets all bones to rest pose every frame
(to prevent drift), then applies its own base pose — destroying whatever VRPoseSystem
just set. Active clip animations also overwrite bones before either system runs.

### Frame Execution Order

```
ViewerEngine.animate() {
    1. avatarManager.update(dt)            // vrm.update() — syncs normalized → raw IF autoUpdateHumanBones=true
    2. NEXUS_PROCEDURAL_ANIMATOR.update()  // Wrapped by AvatarAliveness:
       2a. NEXUS_CLIP_LOADER.update(dt)    //   → Clip mixer writes bones
       2b. originalUpdate(t, dt)           //   → ProceduralAnimator: reset → basePose → breathing → head
    3. vrPoseSystem.update(dt)             // Blends pose quaternions on normalized bones
    4. vrPuppetInteraction.update(dt)
    5. vrIntimacySystem.update(dt)
}
```

### Pose Mode Solution

`PoseStudioPanel` manages pose mode transitions:

**Entering Pose Mode** (`_enterPoseMode()`):
1. Stop active clip animations (`NEXUS_CLIP_LOADER.stopClip()`)
2. Stop animation resolver (`NEXUS_ANIMATION_RESOLVER.stop()`)
3. Activate pose mode (`NEXUS_PROCEDURAL_ANIMATOR.setPoseMode(true)`)
4. Enable `autoUpdateHumanBones = true` on VRM humanoid

**Exiting Pose Mode** (`_exitPoseMode()`):
1. Deactivate pose mode (`NEXUS_PROCEDURAL_ANIMATOR.setPoseMode(false)`)
2. Restore `autoUpdateHumanBones = false`

### Why autoUpdateHumanBones Matters

VRPoseSystem resolves bones via `PoseRigMap`, which prefers `getNormalizedBoneNode()`
over `getRawBoneNode()`. This means VRPoseSystem writes quaternions to **normalized
proxy bones**, not the raw skeleton.

- `autoUpdateHumanBones = true`: `vrm.update()` syncs normalized → raw each frame.
  VRPoseSystem's changes become visible on the rendered skeleton.
- `autoUpdateHumanBones = false`: Normalized bone values are NOT synced to raw bones.
  ProceduralAnimator writes raw bones directly (breathing, base pose).

| Mode | autoUpdateHumanBones | Bone Control Owner | Use Case |
|------|---------------------|--------------------|----------|
| Normal (procedural) | `false` | ProceduralAnimator (raw) | Default: breathing, head tracking, base pose |
| Pose mode | `true` | VRPoseSystem (normalized) | Pose Navigator, pose presets |
| VRMA clip playback | `true` | ClipAnimationLoader (normalized) | .vrma animation files |
| BVH clip playback | `false` | ClipAnimationLoader (raw) | .bvh animation files |

### ProceduralAnimator State Machine

```javascript
// State variables
let editMode = false;   // Pose Studio mouse editing active
let poseMode = false;   // Pose Navigator active — VRPoseSystem owns bones
let animOverride = false; // Animation playing from Pose Studio panel

// Decision tree in update():
if (editMode && !poseMode && !animOverride) return; // Mouse editing: skip all
if (poseMode) return;                                // Pose mode: skip all (no additive!)
// ... normal procedural animation follows
```

**Important**: Pose mode skips ALL procedural effects including breathing and head
tracking. Additive effects (`applyAdditiveEuler`) compound each frame without a
bone reset, causing rotation drift (spinning head artifact). VRPoseSystem has
exclusive bone control in pose mode.

### Pose Navigator UX Flow

```
Open Pose Studio  → poseEditor.enter() + show()
                    → Stop clips, enter pose mode, apply first preset

Navigate (← →)    → _navigatePose(±1)
                    → Ensure pose mode, apply preset with 0.5s blend

Select dropdown    → _applySelectedPreset()
                    → Ensure pose mode, apply preset with 0.5s blend

Close panel        → hide() + editor.exit()
                    → Exit pose mode, restore procedural animations
```

### Files Modified

| File | Change |
|------|--------|
| `src/ProceduralAnimator.js` | Added `poseMode` state + `setPoseMode()` API |
| `src/PoseStudioPanel.js` | Added `_enterPoseMode()`, `_exitPoseMode()`, `hide()` |

---

## Part XIX: Modular Animation Architecture (VRMA Fix)

The animation loading system was refactored from a single monolithic file into
four modular files following the official `@pixiv/three-vrm-animation` pipeline.

### File Structure

```
Load order (all via <script defer>):

1. ClipAnimationShared.js    → Shared state, constants, bone maps, utilities
2. BVHAnimationLoader.js     → BVH parsing & retargeting
3. VRMAAnimationLoader.js    → VRMA retargeting (official pipeline)
4. ClipAnimationLoader.js    → Thin orchestrator + public API
```

### Module Communication

All modules communicate through two global objects:

| Object | Purpose | Scope |
|--------|---------|-------|
| `window.__CLIP_ANIM_STATE__` | Mutable shared state (mixer, avatar, clips, proxy state) | Internal |
| `window.__CLIP_ANIM_CONST__` | Read-only constants + utility functions | Internal |
| `window.__BVH_LOADER__` | BVH sub-loader API | Internal |
| `window.__VRMA_LOADER__` | VRMA sub-loader API | Internal |
| `window.NEXUS_CLIP_LOADER` | Public API for all consumers | External |

### VRMA Animation Fixes

Three bugs were fixed in the VRMA retargeting pipeline:

#### Fix 1: VRM 0.x Coordinate System Transform

VRMA animations use VRM 1.0 coordinates. VRM 0.x models (like AvatarSample_A) use
a different coordinate system. The official `@pixiv/three-vrm-animation` library
handles this by negating X and Z quaternion components:

```javascript
// Official formula: negate every even-indexed value in flat array
// [x₀, y₀, z₀, w₀, ...] → [-x₀, y₀, -z₀, w₀, ...]
// Per quaternion: (x, y, z, w) → (-x, y, -z, w)
function transformQuatForVRM0(values) {
    var out = new Float32Array(values.length);
    for (var i = 0; i < values.length; i++) {
        out[i] = (i % 2 === 0) ? -values[i] : values[i];
    }
    return out;
}
```

Hips position uses the same principle: `(x, y, z) → (-x, y, -z)`.

The old code incorrectly normalized `w >= 0` (flipping all components when w < 0),
which caused arms-up and inverted facing artifacts.

#### Fix 2: Direct Bone Targeting (No Proxies)

The old approach created intermediate proxy `Object3D` nodes and copied quaternions
via `syncProxies()` every frame. The new approach targets normalized bone nodes
directly on `vrm.scene`:

```javascript
// NEW: mixer writes directly to normalized bone
var normNode = humanoid.getNormalizedBoneNode(humanoidName);
var qValues = isVRM0 ? transformQuatForVRM0(track.values) : track.values;
new THREE.QuaternionKeyframeTrack(normNode.name + '.quaternion', times, qValues);
```

The `AnimationMixer` on `vrm.scene` finds these nodes by name and writes to them
directly. No per-frame `syncProxies()` needed for bone quaternions.

#### Fix 3: VRMRoot Scene Rotation

The `VRMRoot` rotation track (present in appearing/waiting VRMA files) controls the
entire character's facing direction. This was previously silently skipped because
`VRMRoot` is not a humanoid bone. Now it uses a lightweight proxy:

```javascript
// VRMRoot proxy — applied to vrm.scene quaternion each frame
if (trackNode === 'VRMRoot' && property === 'quaternion') {
    vrmaRootProxy = new THREE.Object3D();
    vrmaRootProxy.name = '__vrma_root';
    proxyRoot.add(vrmaRootProxy);
    newTracks.push(new THREE.QuaternionKeyframeTrack(
        '__vrma_root.quaternion', track.times, rootValues
    ));
}

// Per-frame in syncProxies():
scene.quaternion.copy(originalSceneQuat).multiply(vrmaRootProxy.quaternion);
```

### VRMA Retargeting Pipeline

```
.vrma file
    ↓ GLTFLoader
gltf result
    ↓ extractVRMAExtension()
VRMC_vrm_animation extension + node list
    ↓ buildNodeToHumanoidMap()
node name → humanoid bone name mapping
    ↓ retargetVRMAClip()
For each track:
    ├── VRMRoot.quaternion     → proxy Object3D (scene rotation)
    ├── expression tracks      → proxy Object3D (userData.weight)
    ├── bone.quaternion        → normalized bone node (direct targeting)
    │   └── VRM 0.x?          → transformQuatForVRM0() (negate X, Z)
    ├── hips.position          → normalized bone node (height-scaled)
    │   └── VRM 0.x?          → transformPosForVRM0() (negate X, Z)
    └── scale, lookAt          → filtered out
    ↓
THREE.AnimationClip (retargeted for target VRM)
    ↓ AnimationMixer on vrm.scene
Playback (autoUpdateHumanBones=true syncs normalized → raw)
```

### Public API (unchanged)

The public `window.NEXUS_CLIP_LOADER` API is unchanged:

```javascript
NEXUS_CLIP_LOADER.playClip(path, loopOrOptions)  // Play BVH or VRMA
NEXUS_CLIP_LOADER.stopClip(options)               // Stop with fadeOut
NEXUS_CLIP_LOADER.loadClip(path)                  // Preload
NEXUS_CLIP_LOADER.update(dt)                      // Per-frame (called by AvatarAliveness)
NEXUS_CLIP_LOADER.registerAvatar(root, vrm)       // Set target avatar
```

---

## Part XX: VRMA Animation Library

The project includes VRMA animation files from multiple sources, organized by category.

### File Structure

```
vendor/animations/
├── vrma/                    # Original VRMA pack (tk256ailab/vrm-viewer)
│   ├── Angry.vrma
│   ├── Sad.vrma
│   ├── Thinking.vrma
│   ├── Surprised.vrma
│   ├── Relax.vrma
│   └── waiting-standard.vrma
├── vrma-dance/              # Dance VRMA (DavinciDreams/3dchat, Mixamo-derived)
│   ├── hipHopDancing.vrma
│   ├── sambaDancing.vrma
│   ├── rumbaDancing.vrma
│   ├── sillyDancing.vrma
│   ├── twistDance.vrma
│   ├── hipHopDance.vrma
│   ├── dancingTwerk.vrma
│   └── breakdanceUprock.vrma
├── vrma-actions/            # Action/gesture VRMA (DavinciDreams/3dchat)
│   ├── waving.vrma
│   ├── bowing.vrma
│   ├── standingGreeting.vrma
│   ├── standingClap.vrma
│   ├── victory.vrma
│   ├── backflip.vrma
│   ├── jumpingJacks.vrma
│   ├── singing.vrma
│   ├── talking.vrma
│   ├── shrugging.vrma
│   ├── happyIdle.vrma
│   ├── sadIdle.vrma
│   └── victoryIdle.vrma
└── dance/                   # BVH dance (experimental, deprecated)
    └── *.bvh
```

### Adding New VRMA Files

1. Place `.vrma` file in the appropriate directory
2. Add the path to `vendor/animations/manifest.json` under the correct category
3. Optionally add to `emotionMapping` or `intentMapping` for automatic routing
4. For dance: add to `CLIP_INTENTS.dance.preferredFiles` in `AnimationPresets.js`

### Sources

| Source | URL | License |
|--------|-----|---------|
| tk256ailab vrm-viewer | https://github.com/tk256ailab/vrm-viewer | Open source |
| DavinciDreams 3dchat | https://github.com/DavinciDreams/3dchat | Mixamo royalty-free |
| VRoid Project (BOOTH) | https://booth.pm/ja/items/5512385 | pixiv Inc. free use |

---

## Part XXI: BVH Retargeting — Known Issues & Future Fix Plan

BVH dance files are currently **experimental** due to a rest-pose retargeting bug.
This section documents the issue and planned fix for future implementation.

### The Bug

`retargetQuaternionValues()` in `BVHAnimationLoader.js` reads the target bone's
**current quaternion** as the rest pose. On first play this is correct (T-pose),
but on subsequent plays the bones still hold the previous animation's values:

```
1st play: tRest = identity (T-pose) → correct retargeting
2nd play: tRest = dance pose quaternion → corrupted retargeting
           output = dancePoseQuat × identity × frameQuat → double-rotated
```

### BVH File Origin

The BVH files were created via: **Mixamo FBX → SystemAnimatorOnline → VRM-named BVH**

- Source: [VRM Assets Pack for SillyTavern](https://github.com/test157t/VRM-Assets-Pack-For-Silly-Tavern)
- Converter: [SystemAnimatorOnline](https://github.com/ButzYung/SystemAnimatorOnline)
- Result: BVH files with VRM bone names (`hips`, `leftUpperArm`, etc.) and T-pose rest

### Planned Fix (not yet implemented)

**Option A — Same-skeleton direct application:**

Since the BVH files use VRM bone names and T-pose (identity) rest, the retargeting
formula `tRest × sRest⁻¹ × frame` simplifies to `identity × identity × frame = frame`.
Skip `retargetQuaternionValues()` entirely for same-skeleton BVH:

```javascript
function isSameSkeletonBVH(sourceSkeleton) {
    // Check if BVH uses VRM bone names (hips, spine, leftUpperArm, etc.)
    var coreNames = ['hips', 'spine', 'chest', 'head', 'leftUpperArm', 'rightUpperArm'];
    var matchCount = 0;
    for (var i = 0; i < sourceSkeleton.bones.length; i++) {
        if (coreNames.indexOf(sourceSkeleton.bones[i].name) >= 0) matchCount++;
    }
    return matchCount >= 5;
}

// In retargetBVHClip():
if (isSameSkeletonBVH(sourceSkeleton)) {
    // Apply quaternions directly — no rest-pose multiplication
    finalValues = cloneQuaternionArray(track.values);
} else {
    // Foreign skeleton — use rest-pose delta retargeting
    finalValues = retargetQuaternionValues(track.values, sBone, tBone, vrmName);
}
```

**Option B — Store bind pose separately:**

Capture T-pose quaternions once at avatar registration, store them in a separate
map (not on live bone objects), and use those for retargeting:

```javascript
// At registration:
var bindPose = {};
for (var name in boneMap) {
    bindPose[name] = boneMap[name].quaternion.clone();
}

// In retargetQuaternionValues():
var tRest = bindPose[vrmName] || new THREE.Quaternion(); // Always clean T-pose
```

**Option C — Reset bones before retarget:**

Before each `retargetBVHClip()` call, reset all target bones to identity so the
captured `tRest` is always clean:

```javascript
// Before retargeting:
for (var name in boneMap) {
    boneMap[name].quaternion.set(0, 0, 0, 1);
}
```

### Additional BVH Improvements Needed

- **Include hips position tracks** for sitting/ground BVH animations
- **Height-ratio scaling** for hips position (like pixiv's `loadMixamoAnimation.js`)
- **VRM 0.x coordinate flip** for BVH (negate X/Z like VRMA pipeline does)
- **World-space retargeting** for foreign skeletons (Mixamo `mixamorig*` names)
