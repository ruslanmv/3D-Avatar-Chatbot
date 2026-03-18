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
10. [Troubleshooting](#10-troubleshooting)

---

## 1. What Is the T-Pose Problem?

Most 3D avatar files (VRM, GLB) store the skeleton in **T-pose** — arms
stretched out horizontally, legs straight. This is the standard "bind pose" for
rigging, but it looks robotic.

```
     O          ← head
   ──┼──        ← arms horizontal (T-pose)
     │
    / \         ← legs
```

We want the avatar to look like a person standing naturally:

```
     O          ← head
    \│/         ← arms relaxed at sides
     │
    / \         ← legs
```

The pose correction system rotates each arm/shoulder/hand bone from the T-pose
direction toward a natural "relaxed standing" direction.

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
┌──────────┐          ┌──────────┐           ┌──────────┐          ┌──────────┐
│ Find     │          │ Bone →   │           │ Current  │          │ Apply    │
│ bones by │  ──►     │ child    │   ──►     │ vs       │   ──►   │ rotation │
│ name/API │          │ direction│           │ target   │          │ to bone  │
└──────────┘          └──────────┘           └──────────┘          └──────────┘
```

---

## 3. The Math Behind It

### 3.1 Getting the Current Direction

For any bone, we compute where it "points" by measuring the vector from the
bone's world position to its child bone's world position:

```
                    childPos
                   •
                  /
currentDir  =   /    ← this is the direction vector
               /
              •
           bonePos

Formula:
    currentDir = normalize(childPos − bonePos)
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
                   ↗
                  /
    rotation Q   /  angle θ
    ──────►     /
               ↗
              currentDir (where it is now)

Formula:
    Q = quaternionFromUnitVectors(currentDir, targetDir)
```

The quaternion `Q` encodes:

- **Axis**: the line perpendicular to both vectors (their cross product)
- **Angle**: the angle between the two directions

```
axis  = normalize(currentDir × targetDir)
angle = arccos(currentDir · targetDir)

Q = [ axis × sin(angle/2),  cos(angle/2) ]
        ↑ xyz components      ↑ w component
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
    Q_local = Q_parent_inv × Q_world × Q_parent

Where:
    Q_parent     = parent bone's world rotation
    Q_parent_inv = inverse of Q_parent
    Q_world      = the correction we computed
```

Then we apply it:

```
bone.quaternion = Q_local × bone.quaternion
```

This is a "pre-multiply" — the correction is applied _before_ the existing
rotation, so it stacks correctly with animations.

### 3.4 Safety Clamp (Max Correction Angle)

To prevent wild deformations on unusual rigs, each correction is clamped to a
maximum angle:

```
angle = 2 × arccos(|Q.w|)          ← extract angle from quaternion

If angle > maxAngle:
    scale = maxAngle / angle
    Q = slerp(Q, identity, 1 − scale)   ← scale down the rotation
```

Default max angles: | Bone Category | Max Angle | Degrees |
|---------------|-----------|---------| | Shoulder | 0.35 rad | ~20° | | Upper
Arm | 1.22 rad | ~70° | | Lower Arm | 0.52 rad | ~30° | | Hand | 0.35 rad | ~20°
| | Chest | 0.17 rad | ~10° |

---

## 4. Intensity — What the Slider Does

The **Global Intensity** slider controls how much correction is applied.

### Formula

```
effectiveIntensity = globalIntensity × perBoneWeight

blendedRotation = slerp(identity, targetRotation, effectiveIntensity)
```

Where `slerp` is **Spherical Linear Interpolation** — a smooth blend between two
rotations.

### What Each Value Means

| Intensity | Effect                                                     |
| --------- | ---------------------------------------------------------- |
| 0.0       | No correction at all — raw T-pose                          |
| 0.5       | Arms halfway between T-pose and target                     |
| 0.7       | **Default** — subtle, natural-looking correction           |
| 1.0       | Full correction — arms exactly match the preset target     |
| 1.5       | **Amplified** — arms go _past_ the target (more tucked in) |

### Visual Example

```
Intensity 0.0 (T-pose):     Intensity 0.7 (default):     Intensity 1.5 (amplified):

       O                            O                            O
     ──┼──                         \│/                          \│/
       │                            │                            │
      / \                          / \                          / \

 Arms fully horizontal      Arms mostly down           Arms tight to body
```

### How slerp Works with Intensity > 1.0

`slerp(identity, target, t)` with `t > 1.0` **extrapolates** — it continues the
rotation beyond the target. This is mathematically valid and gives you more
correction range for models that need it.

```
t = 0.0  →  identity (no rotation)
t = 0.5  →  halfway to target
t = 1.0  →  exactly at target
t = 1.5  →  50% past target (extrapolation)
```

### Per-Bone Weights

Each bone has its own weight (0.0 to 1.0) that multiplies with the global
intensity. This lets you fine-tune individual bones:

```
Example: Global = 0.7, Left Upper Arm weight = 0.5

    effectiveIntensity = 0.7 × 0.5 = 0.35
    → Left arm only gets 35% correction (barely moves from T-pose)
```

---

## 5. Two Paths: VRM vs GLB

The system handles VRM and GLB models differently.

### VRM Path (NaturalPosePlugin)

VRM models use a **normalized bone system** from the @pixiv/three-vrm library.
Normalized bones always start at identity quaternion `[0, 0, 0, 1]` in T-pose.

We simply set the desired rotation relative to T-pose:

```javascript
// T-pose identity
identity = Quaternion(0, 0, 0, 1)

// Target (e.g., left upper arm rotated 40° around Z-axis)
target = quatFromAxisAngle(0, 0, 1, 40°)

// Blend with intensity
result = slerp(identity, target, effectiveIntensity)

// Apply to normalized bone — vrm.update() syncs to raw skeleton
boneNode.quaternion = result
```

The axis-angle → quaternion conversion:

```
Given: axis (ax, ay, az) and angle θ in degrees

    halfRad = θ × π / 180 / 2
    Q = [ ax × sin(halfRad),
          ay × sin(halfRad),
          az × sin(halfRad),
          cos(halfRad) ]
```

### GLB Path (PoseNormalizer)

GLB models don't have a normalized bone layer. The system uses **world-space
direction alignment**:

1. Compute `currentDir` (bone → child in world space)
2. Compute `targetDir` (from preset, e.g., `(-0.5, -0.82, 0.08)`)
3. Find correction quaternion: `currentDir → targetDir`
4. Convert to local space and apply

This path is more complex but works with any humanoid rig.

---

## 6. Existing Presets Reference

### VRM Presets (quaternion-based, in NaturalPosePlugin.js)

| Preset          | Upper Arm Angle | Lower Arm Bend | Use Case        |
| --------------- | --------------- | -------------- | --------------- |
| relaxedStanding | 40° Z           | 8° elbow       | Default idle    |
| naturalIdle     | 55° Z           | 15° elbow      | Casual standing |
| portrait        | 65° Z           | 20° elbow      | Thumbnails      |
| presentation    | 30° Z           | 10° elbow      | Speaking pose   |

### GLB Presets (direction vectors, in PoseNormalizer.js)

Each target is a world-space direction vector `(X, Y, Z)`:

- **+X** = right, **−X** = left
- **+Y** = up, **−Y** = down
- **+Z** = toward camera

Example — `relaxedStanding`:

```
leftUpperArm:  (-0.50, -0.82, 0.08)  → pointing left-and-down
rightUpperArm: ( 0.50, -0.82, 0.08)  → pointing right-and-down
leftLowerArm:  (-0.35, -0.90, 0.12)  → more vertical (natural elbow)
rightLowerArm: ( 0.35, -0.90, 0.12)
```

---

## 7. Tutorial: Create a New Pose

### Step 1: Decide What the Pose Looks Like

Sketch or describe the arm positions. For example, a **"Crossed Arms"** pose:

```
     O
    ╲│╱         ← arms crossed in front of chest
    ╱╲
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

- Upper arms: lower 50° (Z) + bring forward 30° (Y)
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
2. Open Settings → Pose Correction
3. Select your new preset from the dropdown
4. Adjust intensity to taste

### Quick Reference: Common Arm Positions

| Pose           | Upper Arm Z° | Lower Arm Y° | Notes                                 |
| -------------- | ------------ | ------------ | ------------------------------------- |
| T-pose (raw)   | 0°           | 0°           | No correction                         |
| Relaxed        | 40°          | 8°           | Default                               |
| Arms at sides  | 55°          | 15°          | Casual                                |
| Hands clasped  | 50°          | 40°          | Needs Y-axis on upper arm too         |
| One arm raised | L:40° R:−30° | varies       | Asymmetric — use different L/R values |

---

## 8. Tutorial: Create a Simple Animation

Animations in NEXUS are **procedural** — defined as parameter oscillations in
`AnimationPresets.js`, not keyframe files.

### How Procedural Animation Works

Each animated parameter oscillates over time using a sine wave:

```
value(t) = baseValue + amplitude × sin(2π × frequency × t + phase)

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
    icon: '👋',
    mode: 'waving',
    // Right arm waves, left arm stays at side
    params: {
        rightUpperArm_z: { base: -30, amplitude: 25, frequency: 1.5 },
        // base: -30° means arm starts raised
        // amplitude: 25° means it swings ±25° from base
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
| `phase`     | Timing offset (0–1). Use 0.5 for opposite timing       |
| `base`      | Center position. The bone oscillates around this angle |

### Combining Pose + Animation

The pose system and animation system stack together:

```
Final bone rotation = Pose correction × Procedural animation × Breathing

Each is applied as a quaternion multiplication (premultiply).
```

The pose runs once at load time; procedural animations update every frame.

---

## 9. Settings & UI Controls

### Global Intensity Slider

- **Location:** Settings → Pose Correction → GLOBAL INTENSITY
- **Range:** 0 to 1.5
- **Default:** 0.70
- **Stored in:** `localStorage` key `nexus_pose_normalizer`

### Per-Bone Sliders

Each bone has its own weight slider (0 to 1). The effective intensity for any
bone is:

```
effective = globalIntensity × boneWeight
```

### Preset Selector

Dropdown to switch between poses (relaxedStanding, naturalIdle, portrait,
presentation, and any custom ones you add).

### Programmatic Access

```javascript
// Read current settings
const settings = window.NEXUS_POSE_NORMALIZER.getSettings();
console.log(settings.intensity); // 0.7
console.log(settings.bones); // { leftUpperArm: 1.0, ... }

// Update settings (triggers live update)
window.NEXUS_POSE_NORMALIZER.updateSettings({ intensity: 1.2 });

// Reset to defaults
window.NEXUS_POSE_NORMALIZER.resetSettings();

// Apply a specific preset
window.NEXUS_NATURAL_POSE.setPreset('portrait');
```

---

## 10. Troubleshooting

| Symptom                           | Cause                                            | Fix                                                                   |
| --------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| Arms still in T-pose              | Intensity = 0 or bones not detected              | Check console for `[PoseNormalizer] Rig detected` message             |
| Arms clip through body            | Intensity too high                               | Lower global intensity or per-bone weights                            |
| Pose looks different after reload | Saved settings in localStorage override defaults | Clear localStorage or click Reset in settings                         |
| Only one arm corrected            | Rig uses non-standard bone names                 | Check console for `Tier 3 (incomplete)` warning                       |
| VRM looks fine but GLB doesn't    | Different code paths                             | GLB uses direction vectors; VRM uses quaternions — check both presets |
| Slider stuck at max               | Slider max was 1.0                               | Updated to 1.5 — clear localStorage if old value is cached            |

---

## File Map

| File                       | Role                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| `src/AnimationPresets.js`  | Single source of truth for `DEFAULT_POSE_INTENSITY` (0.7)        |
| `src/PoseNormalizer.js`    | GLB path — world-space direction alignment, settings persistence |
| `src/NaturalPosePlugin.js` | VRM path — normalized bone quaternion rotations                  |
| `index.html`               | UI sliders and controls                                          |
| `src/main.js`              | Wires UI to PoseNormalizer settings                              |
