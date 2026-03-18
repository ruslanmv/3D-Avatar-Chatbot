# T-Pose Correction System

A practical guide to how NEXUS fixes the T-pose, how to tune it, and how to
create your own poses and animations.

---

## Table of Contents

1. [What Is the T-Pose Problem?](#1-what-is-the-t-pose-problem)
2. [How the Fix Works (High Level)](#2-how-the-fix-works-high-level)
3. [The Math Behind It](#3-the-math-behind-it)
4. [Intensity — What the Slider Does](#4-intensity--what-the-slider-does)
5. [Two Paths: VRM vs GLB](#5-two-paths-vrm-vs-glb)
6. [Existing Presets Reference](#6-existing-presets-reference)
7. [Tutorial: Create a New Pose](#7-tutorial-create-a-new-pose)
8. [Tutorial: Create a Simple Animation](#8-tutorial-create-a-simple-animation)
9. [Settings & UI Controls](#9-settings--ui-controls)
10. [Architecture: Data Flow & Sync](#10-architecture-data-flow--sync)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. What Is the T-Pose Problem?

Most 3D avatar files (VRM, GLB) store the skeleton in **T-pose** — arms
stretched out horizontally, legs straight. This is the standard "bind pose" for
rigging, but it looks robotic.

```
     O          <- head
   --+--        <- arms horizontal (T-pose)
     |
    / \         <- legs
```

We want the avatar to look like a person standing naturally:

```
     O          <- head
    \|/         <- arms relaxed at sides
     |
    / \         <- legs
```

The pose correction system rotates each arm/shoulder/hand bone from the T-pose
direction toward a natural "relaxed standing" direction.

**Industry context:** VRoid Hub, Ready Player Me, and AAA titles (Genshin
Impact, Blue Protocol, Tower of Fantasy) all correct T-pose to natural idle with
arms at approximately 55 degrees from horizontal — the `naturalIdle` preset at
intensity 1.0.

---

## 2. How the Fix Works (High Level)

The system works in 4 steps:

1. **Detect the rig** — find bones by name (VRM API or pattern matching)
2. **Measure current direction** — for each bone, compute where it currently
   points in world space
3. **Compare to target** — look up where it _should_ point (from a preset)
4. **Rotate to fix** — compute and apply a correction quaternion

```
Step 1: Detect         Step 2: Measure        Step 3: Compare       Step 4: Rotate
+----------+          +----------+           +----------+          +----------+
| Find     |          | Bone ->  |           | Current  |          | Apply    |
| bones by |  --->    | child    |   --->    | vs       |   --->   | rotation |
| name/API |          | direction|           | target   |          | to bone  |
+----------+          +----------+           +----------+          +----------+
```

---

## 3. The Math Behind It

### 3.1 Getting the Current Direction

For any bone, we compute where it "points" by measuring the vector from the
bone's world position to its child bone's world position:

```
                    childPos
                   *
                  /
currentDir  =   /    <- this is the direction vector
               /
              *
           bonePos

Formula:
    currentDir = normalize(childPos - bonePos)
```

In code (`PoseNormalizer.js`):

```javascript
bone.getWorldPosition(bonePos);
childBone.getWorldPosition(childPos);
currentDir = (childPos - bonePos).normalize();
```

### 3.2 Computing the Correction Quaternion

A **quaternion** is a compact way to represent a 3D rotation. We need a rotation
that turns `currentDir` into `targetDir`:

```
                    targetDir (where we want it)
                   /
                  /
    rotation Q   /  angle theta
    ------>     /
               /
              currentDir (where it is now)

Formula:
    Q = quaternionFromUnitVectors(currentDir, targetDir)
```

The quaternion `Q` encodes:

- **Axis**: the line perpendicular to both vectors (their cross product)
- **Angle**: the angle between the two directions

```
axis  = normalize(currentDir x targetDir)
angle = arccos(currentDir . targetDir)

Q = [ axis * sin(angle/2),  cos(angle/2) ]
        ^ xyz components      ^ w component
```

In code:

```javascript
correction.setFromUnitVectors(currentDir, targetDir);
```

### 3.3 Converting World Correction to Local Space

Bones in a skeleton are in a **parent-child hierarchy**. A rotation computed in
world space must be converted to the bone's local space:

```
Formula:
    Q_local = Q_parent_inv * Q_world * Q_parent

Where:
    Q_parent     = parent bone's world rotation
    Q_parent_inv = inverse of Q_parent
    Q_world      = the correction we computed
```

In code (`PoseNormalizer.js` — `applyWorldCorrectionToBone`):

```javascript
bone.parent.getWorldQuaternion(_parentWorldQuat);
_parentWorldQuatInv.copy(_parentWorldQuat).invert();
_localCorrection
    .copy(_parentWorldQuatInv)
    .multiply(worldCorrection)
    .multiply(_parentWorldQuat);
```

Then we apply it:

```
bone.quaternion = Q_local * bone.quaternion
```

This is a "pre-multiply" — the correction is applied _before_ the existing
rotation, so it stacks correctly with animations.

### 3.4 Safety Clamp (Max Correction Angle)

To prevent wild deformations on unusual rigs, each correction is clamped to a
maximum angle:

```
angle = 2 * arccos(min(1, |Q.w|))      <- extract angle from quaternion

If angle > maxAngle:
    scale = maxAngle / angle
    Q = slerp(Q, identity, 1 - scale)   <- scale down the rotation
```

In code:

```javascript
const angle = 2 * Math.acos(Math.min(1, Math.abs(worldCorrection.w)));
if (angle > maxAngle) {
    const scale = maxAngle / angle;
    worldCorrection.slerp(_identity, 1 - scale);
}
```

### 3.5 Intensity Blend

After clamping, intensity is applied via slerp:

```javascript
if (intensity !== 1.0) {
    worldCorrection.slerp(_identity, 1 - intensity);
}
```

This gives: `blendedCorrection = slerp(identity, correction, intensity)`

Default max angles per bone category:

| Bone Category | Max Angle (rad) | Degrees | Why                                    |
| ------------- | --------------- | ------- | -------------------------------------- |
| Shoulder      | 0.35            | ~20     | Shoulders barely move in natural poses |
| Upper Arm     | 1.22            | ~70     | Arms travel the most from T-pose       |
| Lower Arm     | 0.52            | ~30     | Elbows bend moderately at rest         |
| Hand          | 0.35            | ~20     | Hands droop slightly                   |
| Chest         | 0.17            | ~10     | Chest stays nearly vertical            |

---

## 4. Intensity — What the Slider Does

The **Global Intensity** slider controls how much correction is applied.

### Core Formula

```
effectiveIntensity = globalIntensity * perBoneWeight

blendedRotation = slerp(identity, targetRotation, effectiveIntensity)
```

Where `slerp` is **Spherical Linear Interpolation** — a smooth blend between two
rotations.

### What Each Value Means

| Intensity | Effect                                                         |
| --------- | -------------------------------------------------------------- |
| 0.0       | No correction at all — raw T-pose                              |
| 0.5       | Arms halfway between T-pose and target                         |
| **1.0**   | **Default (industry standard)** — arms match the preset target |
| 1.5       | **Amplified** — arms go _past_ the target (more tucked in)     |

### Visual Example

```
Intensity 0.0 (T-pose):     Intensity 1.0 (default):     Intensity 1.5 (amplified):

       O                            O                            O
     --+--                         \|/                          \|/
       |                            |                            |
      / \                          / \                          / \

 Arms fully horizontal      Arms naturally at sides    Arms tight to body
```

### How slerp Works with Intensity > 1.0

`slerp(identity, target, t)` with `t > 1.0` **extrapolates** — it continues the
rotation beyond the target. This is mathematically valid and gives you more
correction range for models that need it.

```
t = 0.0  ->  identity (no rotation)
t = 0.5  ->  halfway to target
t = 1.0  ->  exactly at target
t = 1.5  ->  50% past target (extrapolation)
```

### Per-Bone Weights

Each bone has its own weight (0.0 to 1.0) that multiplies with the global
intensity. This lets you fine-tune individual bones:

```
Example: Global = 1.0, Left Upper Arm weight = 0.5

    effectiveIntensity = 1.0 * 0.5 = 0.50
    -> Left arm only gets 50% correction (arms at ~27 degrees from T-pose)
```

### Industry Standard: Why 1.0?

The default intensity of **1.0** was chosen to match industry practice:

- **VRoid Hub** displays models with full correction (~55 degrees arms at sides)
- **Ready Player Me** uses full correction for preview renders
- **AAA games** (Genshin Impact, Blue Protocol) use 50-65 degree idle arm angles

At intensity 1.0 with the `naturalIdle` preset (55 degree upper arm rotation),
the avatar matches these industry references exactly.

---

## 5. Two Paths: VRM vs GLB

The system handles VRM and GLB models differently.

### VRM Path (NaturalPosePlugin)

VRM models use a **normalized bone system** from the @pixiv/three-vrm library.
Normalized bones always start at identity quaternion `[0, 0, 0, 1]` in T-pose.

We simply set the desired rotation relative to T-pose:

```javascript
// T-pose identity
identity = Quaternion(0, 0, 0, 1);

// Target (e.g., left upper arm rotated 55 degrees around Z-axis)
target = quatFromAxisAngle(0, 0, 1, 55);

// Blend with intensity
result = slerp(identity, target, effectiveIntensity);

// Apply to normalized bone — vrm.update() syncs to raw skeleton
boneNode.quaternion = result;
```

In code (`NaturalPosePlugin.js` — `applyVRMPose`):

```javascript
for (const [boneName, quatArray] of Object.entries(preset.bones)) {
    const boneNode = humanoid.getNormalizedBoneNode(boneName);
    if (!boneNode) continue;

    const boneWeight =
        boneWeights[boneName] != null ? boneWeights[boneName] : 1.0;
    const effectiveIntensity = intensity * boneWeight;

    if (effectiveIntensity <= 0) {
        boneNode.quaternion.set(0, 0, 0, 1); // Reset to T-pose
        continue;
    }

    targetQuat.set(quatArray[0], quatArray[1], quatArray[2], quatArray[3]);
    blendedQuat.copy(identityQuat).slerp(targetQuat, effectiveIntensity);
    boneNode.quaternion.copy(blendedQuat);
}
```

The axis-angle to quaternion conversion (`_quatFromAxisAngle`):

```javascript
function _quatFromAxisAngle(ax, ay, az, angleDeg) {
    const half = (angleDeg * Math.PI) / 180 / 2;
    const s = Math.sin(half);
    const c = Math.cos(half);
    const len = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    return [(ax / len) * s, (ay / len) * s, (az / len) * s, c];
}
```

```
Given: axis (ax, ay, az) and angle theta in degrees

    halfRad = theta * pi / 180 / 2
    Q = [ ax * sin(halfRad),
          ay * sin(halfRad),
          az * sin(halfRad),
          cos(halfRad) ]
```

### GLB Path (PoseNormalizer)

GLB models don't have a normalized bone layer. The system uses **world-space
direction alignment**:

1. Compute `currentDir` (bone to child in world space)
2. Compute `targetDir` (from preset, e.g., `(-0.35, -0.90, 0.10)`)
3. Find correction quaternion: `currentDir -> targetDir`
4. Convert to local space and apply with intensity blend

In code (`PoseNormalizer.js` — `normalizeAvatarPose`):

```javascript
for (const boneName of targetBones) {
    const bone = rigMap[boneName];
    const target = preset.targets[boneName];
    const childBone = getChildBone(boneName, rigMap);

    const boneIntensity =
        settings.bones[boneName] != null ? settings.bones[boneName] : 1.0;
    const effectiveIntensity = globalIntensity * boneIntensity;

    if (effectiveIntensity <= 0) continue;

    const maxAngle = getMaxAngle(boneName);
    alignBoneToTarget(bone, childBone, target, effectiveIntensity, maxAngle);
}
```

This path is more complex but works with any humanoid rig.

### PoseStudioNormalizer (Simplified GLB Path)

`PoseStudioNormalizer.js` provides a simpler rotation-based approach for the
Pose Studio viewport, using base rotation constants scaled by intensity:

```javascript
var BASE = {
    shoulder: 0.087, // 5 degrees  — subtle shoulder drop
    upperArm: 0.698, // 40 degrees — main arm lowering
    lowerArmZ: 0.14, // 8 degrees  — slight elbow angle
    lowerArmX: 0.08, // forearm rotation for natural twist
    neckX: 0.01, // minimal neck tilt
    headX: -0.01, // minimal head counter-tilt
};

// Applied as: effectiveRotation = BASE_ROTATION * globalIntensity
safeRotateZ(leftUpperArm, -BASE.upperArm * intensity);
safeRotateZ(rightUpperArm, BASE.upperArm * intensity);
```

---

## 6. Existing Presets Reference

### VRM Presets (quaternion-based, in NaturalPosePlugin.js)

| Preset          | Upper Arm Angle | Shoulder | Elbow Bend | Hand Droop | Use Case         |
| --------------- | --------------- | -------- | ---------- | ---------- | ---------------- |
| naturalIdle     | 55 deg Z        | 8 deg    | 15 deg Y   | 8 deg      | **Default idle** |
| relaxedStanding | 40 deg Z        | 5 deg    | 8 deg Y    | 5 deg      | Casual standing  |
| portrait        | 65 deg Z        | 10 deg   | 20 deg Y   | 10 deg     | Thumbnails       |
| presentation    | 30 deg Z        | 4 deg    | 10 deg Y   | 5 deg      | Speaking pose    |

### GLB Presets (direction vectors, in PoseNormalizer.js)

Each target is a world-space direction vector `(X, Y, Z)`:

- **+X** = right, **-X** = left
- **+Y** = up, **-Y** = down
- **+Z** = toward camera

#### naturalIdle (default)

```
leftUpperArm:   (-0.35, -0.90,  0.10)  -> pointing left-and-down (55 deg)
rightUpperArm:  ( 0.35, -0.90,  0.10)  -> pointing right-and-down
leftLowerArm:   (-0.20, -0.95,  0.15)  -> more vertical (natural elbow)
rightLowerArm:  ( 0.20, -0.95,  0.15)
leftHand:       (-0.15, -0.96,  0.12)  -> nearly vertical
rightHand:      ( 0.15, -0.96,  0.12)
leftShoulder:   (-0.97, -0.15,  0.00)  -> nearly horizontal
rightShoulder:  ( 0.97, -0.15,  0.00)
```

#### relaxedStanding

```
leftUpperArm:   (-0.50, -0.82,  0.08)  -> pointing left-and-down (40 deg)
rightUpperArm:  ( 0.50, -0.82,  0.08)
leftLowerArm:   (-0.35, -0.90,  0.12)
rightLowerArm:  ( 0.35, -0.90,  0.12)
leftHand:       (-0.30, -0.92,  0.10)
rightHand:      ( 0.30, -0.92,  0.10)
leftShoulder:   (-0.98, -0.10,  0.00)
rightShoulder:  ( 0.98, -0.10,  0.00)
```

#### portrait

```
leftUpperArm:   (-0.25, -0.94,  0.10)  -> arms close to body (65 deg)
rightUpperArm:  ( 0.25, -0.94,  0.10)
leftLowerArm:   (-0.12, -0.98,  0.14)
rightLowerArm:  ( 0.12, -0.98,  0.14)
leftHand:       (-0.10, -0.98,  0.12)
rightHand:      ( 0.10, -0.98,  0.12)
leftShoulder:   (-0.97, -0.15,  0.00)
rightShoulder:  ( 0.97, -0.15,  0.00)
```

#### presentation

```
leftUpperArm:   (-0.40, -0.88,  0.06)  -> slightly open arms (30 deg)
rightUpperArm:  ( 0.40, -0.88,  0.06)
leftLowerArm:   (-0.25, -0.94,  0.10)
rightLowerArm:  ( 0.25, -0.94,  0.10)
leftHand:       (-0.20, -0.95,  0.08)
rightHand:      ( 0.20, -0.95,  0.08)
leftShoulder:   (-0.98, -0.08,  0.00)
rightShoulder:  ( 0.98, -0.08,  0.00)
```

---

## 7. Tutorial: Create a New Pose

### Step 1: Decide What the Pose Looks Like

Sketch or describe the arm positions. For example, a **"Crossed Arms"** pose:

```
     O
    \|/         <- arms crossed in front of chest
    /\
   /  \
```

### Step 2: Choose Bone Angles (VRM Preset)

For VRM, you define rotations as axis-angle values. The key axes:

| Axis      | Effect on Arms                      |
| --------- | ----------------------------------- |
| Z (0,0,1) | Lowers/raises arms (most important) |
| Y (0,1,0) | Rotates arms forward/backward       |
| X (1,0,0) | Twists arms                         |

For crossed arms:

- Upper arms: lower 50 deg (Z) + bring forward 30 deg (Y)
- Lower arms: bend elbows significantly (Y)

### Step 3: Add to NaturalPosePlugin.js

Open `src/NaturalPosePlugin.js` and add your preset inside the `PRESETS` object:

```javascript
crossedArms: {
    label: 'Crossed Arms',
    bones: {
        leftShoulder:  _quatFromAxisAngle(0, 0, 1, 8),     // slight shrug
        rightShoulder: _quatFromAxisAngle(0, 0, 1, -8),
        leftUpperArm:  _quatFromAxisAngle(0, 0.5, 1, 50),  // down + forward
        rightUpperArm: _quatFromAxisAngle(0, -0.5, 1, -50),
        leftLowerArm:  _quatFromAxisAngle(0, -1, 0, 45),   // strong elbow bend
        rightLowerArm: _quatFromAxisAngle(0, 1, 0, 45),
        leftHand:      _quatFromAxisAngle(0, 0, 1, 10),
        rightHand:     _quatFromAxisAngle(0, 0, 1, -10),
    },
},
```

### Step 4: Add the GLB Direction Vectors (PoseNormalizer.js)

Open `src/PoseNormalizer.js` and add a matching entry to the `PRESETS` object:

```javascript
crossedArms: {
    label: 'Crossed Arms',
    targets: {
        leftUpperArm:  new THREE.Vector3(-0.3, -0.7, 0.5),  // left, down, forward
        rightUpperArm: new THREE.Vector3( 0.3, -0.7, 0.5),
        leftLowerArm:  new THREE.Vector3( 0.2, -0.5, 0.7),  // crossing to right
        rightLowerArm: new THREE.Vector3(-0.2, -0.5, 0.7),  // crossing to left
        leftHand:      new THREE.Vector3( 0.3, -0.4, 0.6),
        rightHand:     new THREE.Vector3(-0.3, -0.4, 0.6),
        leftShoulder:  new THREE.Vector3(-0.95, -0.15, 0.0),
        rightShoulder: new THREE.Vector3( 0.95, -0.15, 0.0),
    },
},
```

> **Tip:** Direction vectors are automatically normalized, so only the
> _direction_ matters, not the length.

### Step 5: Test It

1. Load the app
2. Open Settings -> Pose Correction
3. Select your new preset from the dropdown
4. Adjust intensity to taste

### Quick Reference: Common Arm Positions

| Pose           | Upper Arm Z deg | Lower Arm Y deg | Notes                                 |
| -------------- | --------------- | --------------- | ------------------------------------- |
| T-pose (raw)   | 0               | 0               | No correction                         |
| Presentation   | 30              | 10              | Open, professional                    |
| Relaxed        | 40              | 8               | Casual                                |
| Natural Idle   | 55              | 15              | **Industry standard** (default)       |
| Portrait       | 65              | 20              | Formal, arms close to body            |
| One arm raised | L:40 R:-30      | varies          | Asymmetric — use different L/R values |

---

## 8. Tutorial: Create a Simple Animation

Animations in NEXUS are **procedural** — defined as parameter oscillations in
`AnimationPresets.js`, not keyframe files.

### How Procedural Animation Works

Each animated parameter oscillates over time using a sine wave:

```
value(t) = baseValue + amplitude * sin(2 * pi * frequency * t + phase)

Where:
    t         = time in seconds
    amplitude = how much the bone moves
    frequency = how fast (Hz — oscillations per second)
    phase     = offset to prevent all bones moving in sync
```

### Example: Add a "Waving" Animation Mode

In `src/AnimationPresets.js`, you would add to the `EMOTIONS` or modes section:

```javascript
waving: {
    label: 'Waving',
    icon: '...',
    mode: 'waving',
    // Right arm waves, left arm stays at side
    params: {
        rightUpperArm_z: { base: -30, amplitude: 25, frequency: 1.5 },
        // base: -30 degrees means arm starts raised
        // amplitude: 25 degrees means it swings +/-25 from base
        // frequency: 1.5 Hz = 1.5 waves per second
        rightLowerArm_y: { base: 20, amplitude: 15, frequency: 1.5, phase: 0.5 },
        // phase: 0.5 means this starts half a cycle later (natural elbow delay)
    }
}
```

### Animation Parameters Cheat Sheet

| Parameter   | What It Controls                                       |
| ----------- | ------------------------------------------------------ |
| `frequency` | Speed. 0.5 = slow breathing, 2.0 = fast wave           |
| `amplitude` | Size of movement in degrees                            |
| `phase`     | Timing offset (0-1). Use 0.5 for opposite timing       |
| `base`      | Center position. The bone oscillates around this angle |

### Combining Pose + Animation

The pose system and animation system stack together:

```
Final bone rotation = Pose correction * Procedural animation * Breathing

Each is applied as a quaternion multiplication (premultiply).
```

The pose runs once at load time; procedural animations update every frame.

---

## 9. Settings & UI Controls

### Single Source of Truth

```
AnimationPresets.js
    DEFAULT_POSE_INTENSITY = 1.0      <-- the canonical default
         |
         v
PoseNormalizer.js
    _DEFAULT_INTENSITY = AnimationPresets value (fallback: 1.0)
    DEFAULT_SETTINGS.intensity = _DEFAULT_INTENSITY
    DEFAULT_SETTINGS.preset = 'naturalIdle'
         |
         v
localStorage ('nexus_pose_normalizer')
    { intensity: 1.0, preset: 'naturalIdle', bones: { ... }, maxCorrection: { ... } }
         |
         v
All UI sliders read from PoseNormalizer.getSettings()
```

### Global Intensity Slider

- **Location:** Settings -> Pose Correction -> GLOBAL INTENSITY
- **Also in:** Pose Studio -> T-Pose Correction (synced bidirectionally)
- **Range:** 0 to 1.5
- **Default:** 1.0 (industry standard — full correction)
- **Stored in:** `localStorage` key `nexus_pose_normalizer`

### Per-Bone Sliders

Each bone has its own weight slider (0 to 1). The effective intensity for any
bone is:

```
effective = globalIntensity * boneWeight
```

Default per-bone weights (all 1.0):

| Bone          | Default Weight |
| ------------- | -------------- |
| leftShoulder  | 1.0            |
| rightShoulder | 1.0            |
| leftUpperArm  | 1.0            |
| rightUpperArm | 1.0            |
| leftLowerArm  | 1.0            |
| rightLowerArm | 1.0            |
| leftHand      | 1.0            |
| rightHand     | 1.0            |
| chest         | 1.0            |
| upperChest    | 1.0            |

### Preset Selector

Dropdown to switch between poses:

| Preset            | Default | Description                                |
| ----------------- | ------- | ------------------------------------------ |
| `naturalIdle`     | Yes     | Arms at sides (55 deg) — industry standard |
| `relaxedStanding` |         | Casual stance (40 deg arms)                |
| `portrait`        |         | Formal, arms close to body (65 deg)        |
| `presentation`    |         | Open professional stance (30 deg)          |

### Programmatic Access

```javascript
// Read current settings
const settings = window.NEXUS_POSE_NORMALIZER.getSettings();
console.log(settings.intensity); // 1.0
console.log(settings.preset); // 'naturalIdle'
console.log(settings.bones); // { leftUpperArm: 1.0, ... }

// Update settings (triggers live update + fires 'pose-settings-changed')
window.NEXUS_POSE_NORMALIZER.updateSettings({ intensity: 1.2 });

// Reset to defaults (intensity 1.0, preset 'naturalIdle')
window.NEXUS_POSE_NORMALIZER.resetSettings();

// Apply a specific preset via NaturalPosePlugin
window.NEXUS_NATURAL_POSE.setPreset('portrait');

// Read the canonical default from AnimationPresets
const canonical = window.NEXUS_ANIMATION_PRESETS.DEFAULT_POSE_INTENSITY; // 1.0
```

---

## 10. Architecture: Data Flow & Sync

### Settings Flow Diagram

```
                    AnimationPresets.js
                   DEFAULT_POSE_INTENSITY = 1.0
                            |
                            v
                    PoseNormalizer.js
              (loads from localStorage or defaults)
              settings = { intensity, preset, bones, maxCorrection }
                    |                       |
            getSettings()            updateSettings(patch)
                    |                       |
         +----------+-----------+           +---> saveSettings() -> localStorage
         |          |           |           |
         v          v           v           +---> dispatch 'pose-settings-changed'
    NaturalPose  PoseStudio  main.js                    |
    Plugin       Normalizer  Settings UI         +------+------+
    (VRM path)   (GLB path)                      |             |
                                           PoseStudio    main.js
                                           Panel sync    loadPoseSettingsIntoUI()
```

### Event System

| Event                   | Dispatched by                   | Listened by                          |
| ----------------------- | ------------------------------- | ------------------------------------ |
| `pose-settings-changed` | PoseNormalizer.updateSettings() | PoseStudioPanel, main.js Settings UI |
| `pose-settings-changed` | PoseNormalizer.resetSettings()  | PoseStudioPanel, main.js Settings UI |
| `vr-pose-changed`       | VRPoseSystem                    | main.js VR preset dropdown           |

### Cross-Sync: Two UI Panels

The Settings panel (`index.html #pose-intensity`) and Pose Studio panel
(`#poseTposeIntensitySlider`) stay synchronized:

```
Settings slider changes:
    -> user clicks "Apply" -> applyPoseSettingsLive()
    -> pn.updateSettings(patch)
    -> fires 'pose-settings-changed'
    -> PoseStudioPanel._settingsChangedHandler updates its slider

Pose Studio slider changes:
    -> tposeSlider 'input' event
    -> pnorm.updateSettings({ intensity: val })
    -> fires 'pose-settings-changed'
    -> main.js listener calls loadPoseSettingsIntoUI()
    -> Settings panel slider updates
```

No infinite loops: programmatic `.value = x` does not fire `input` events.

### Fallback Chain

When `NEXUS_POSE_NORMALIZER` is not loaded (e.g., script load order issue):

```
PoseNormalizer:      AnimationPresets.DEFAULT_POSE_INTENSITY -> fallback 1.0
NaturalPosePlugin:   AnimationPresets.DEFAULT_POSE_INTENSITY -> fallback 1.0
PoseStudioNormalizer: AnimationPresets.DEFAULT_POSE_INTENSITY -> fallback 1.0
```

All fallbacks are **1.0** — matching the canonical value in
`AnimationPresets.js`.

---

## 11. Troubleshooting

| Symptom                           | Cause                                            | Fix                                                                   |
| --------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| Arms still in T-pose              | Intensity = 0 or bones not detected              | Check console for `[PoseNormalizer] Rig detected` message             |
| Arms clip through body            | Intensity too high                               | Lower global intensity or per-bone weights                            |
| Pose looks different after reload | Saved settings in localStorage override defaults | Clear localStorage or click Reset in settings                         |
| Only one arm corrected            | Rig uses non-standard bone names                 | Check console for `Tier 3 (incomplete)` warning                       |
| VRM looks fine but GLB doesn't    | Different code paths                             | GLB uses direction vectors; VRM uses quaternions — check both presets |
| Slider stuck at max               | Old localStorage value cached                    | Clear localStorage key `nexus_pose_normalizer` or click Reset         |
| Settings/PoseStudio out of sync   | Missing cross-sync listener                      | Both panels listen for `pose-settings-changed` event                  |

---

## File Map

| File                          | Role                                                               |
| ----------------------------- | ------------------------------------------------------------------ |
| `src/AnimationPresets.js`     | Single source of truth for `DEFAULT_POSE_INTENSITY` (1.0)          |
| `src/PoseNormalizer.js`       | GLB path — world-space direction alignment, settings persistence   |
| `src/NaturalPosePlugin.js`    | VRM path — normalized bone quaternion rotations                    |
| `src/PoseStudioNormalizer.js` | Simplified GLB path for Pose Studio viewport                       |
| `src/PoseStudioPanel.js`      | Pose Studio UI — slider wiring + cross-sync listener               |
| `src/main.js`                 | Settings UI wiring, `applyPoseSettingsLive()`, cross-sync listener |
| `index.html`                  | UI sliders and controls (Settings panel)                           |

---

## Quick Reference: All Formulas

| Formula                  | Equation                                              | Where Used                |
| ------------------------ | ----------------------------------------------------- | ------------------------- |
| Effective intensity      | `globalIntensity * perBoneWeight`                     | All correction paths      |
| Slerp blend              | `slerp(identity, target, effectiveIntensity)`         | VRM + GLB intensity       |
| Direction vector         | `normalize(childPos - bonePos)`                       | GLB world-space alignment |
| Correction quaternion    | `setFromUnitVectors(currentDir, targetDir)`           | GLB path                  |
| World to local           | `parentInv * worldCorrection * parent`                | GLB path                  |
| Premultiply application  | `bone.quaternion = localCorrection * bone.quaternion` | GLB path                  |
| Angle from quaternion    | `2 * arccos(min(1, abs(Q.w)))`                        | Safety clamp              |
| Axis-angle to quaternion | `[axis * sin(theta/2), cos(theta/2)]`                 | VRM preset definitions    |
| PoseStudio rotation      | `BASE_ROTATION * globalIntensity`                     | PoseStudioNormalizer      |
