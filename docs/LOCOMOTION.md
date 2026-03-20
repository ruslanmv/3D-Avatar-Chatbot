# Avatar Locomotion & VR Intimacy System

Technical guide covering how the avatar moves, follows, and reacts to the user
in VR. Read this before editing any locomotion or intimacy code.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Locomotion System](#locomotion-system)
   - [State Machine](#state-machine)
   - [Auto-Follow Mode](#auto-follow-mode)
   - [Point-and-Walk (Arc Pointer)](#point-and-walk-arc-pointer)
   - [Animation Blend Controller](#animation-blend-controller)
   - [ProceduralAnimator Integration](#proceduralanimator-integration)
3. [VR Intimacy System](#vr-intimacy-system)
   - [Profiles & Distance Bands](#profiles--distance-bands)
   - [Proximity Tracker](#proximity-tracker)
   - [Facing & Distance Micro-Adjustments](#facing--distance-micro-adjustments)
   - [Hand Contact & IK](#hand-contact--ik)
   - [Contact Anchors](#contact-anchors)
4. [Configuration & Tuning](#configuration--tuning)
5. [UI Controls](#ui-controls)
6. [File Map](#file-map)
7. [Data Flow](#data-flow)
8. [How to Remove](#how-to-remove)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│ ViewerEngine.js  (animation loop — orchestrates everything)      │
│                                                                  │
│  Each frame:                                                     │
│    1. avatarManager.update(dt)         VRM skeleton sync         │
│    2. ProceduralAnimator.update(t,dt)  Breathing, head-look      │
│    3. vrControllers.update(dt)         Gamepad polling + arc     │
│    4. vrPoseSystem.update(dt)          IK solving                │
│    5. vrPuppetInteraction.update(dt)   Grab/drag avatar          │
│    6. vrIntimacySystem.update(dt)      Proximity + profiles      │
│    7. NEXUS_LOCOMOTION.update(dt)      Walk state machine        │
│    8. render                                                     │
└──────────────────────────────────────────────────────────────────┘
```

The locomotion and intimacy systems are **additive layers** — they sit on top
of the existing animation pipeline and never replace it. Both can be disabled
at runtime without side effects.

---

## Locomotion System

### Files

| File | Global API | Purpose |
|------|-----------|---------|
| `src/LocomotionConfig.js` | `window.NEXUS_LOCOMOTION_CONFIG` | Master toggle + all tuning constants |
| `src/AvatarLocomotionSystem.js` | `window.NEXUS_LOCOMOTION` | State machine driving root movement |
| `src/AnimationBlendController.js` | `window.NEXUS_ANIMATION_BLEND` | Crossfade controller with own mixer |
| `src/TeleportArcPointer.js` | `window.NEXUS_ARC_POINTER` | Parabolic arc pointer (left L3 click) |

### State Machine

```
         dist > walkTrigger
  IDLE ─────────────────────→ TURNING
   ↑                             │
   │  fade done                  │ facing aligned
   │                             ↓
  STOPPING ←──────────────── WALKING
         dist < stopDist
         OR arrived at point
```

| State | What happens | Exit condition |
|-------|-------------|----------------|
| **IDLE** | Nothing — ProceduralAnimator controls full body | User moves >1.8m away (auto-follow) OR arc pointer confirms target |
| **TURNING** | Avatar rotates to face walk target; walk clip fading in | Facing angle < 0.4 rad from target |
| **WALKING** | Root position lerps toward target at 0.85 m/s; walk BVH plays | Distance < stopDist (follow) OR remaining < 0.2m (point-walk) |
| **STOPPING** | Walk clip fading out; ProceduralAnimator regains full body | Fade timer expires (0.45s) |

### Auto-Follow Mode

Triggered automatically when **all** of these are true:

- Locomotion is enabled (Walk toggle ON)
- User is in VR (`renderer.xr.isPresenting`)
- User's distance from avatar exceeds `walkTriggerDistance` (1.8m) + hysteresis (0.15m)
- Puppet mode is not active (user isn't manually moving avatar)

The avatar walks toward the user, maintaining `stopDistance` (0.95m). It does
**not** walk on top of the user — the walk target is computed as a point at
`stopDistance` along the user→avatar direction vector.

Data flow:

```
VRIntimacySystem.update()
  → proximity.update() returns snapshot with distance + userHead
  → NEXUS_LOCOMOTION.setProximityData(dist, userHead, avatarPos, true)

NEXUS_LOCOMOTION.update(dt)
  → checks dist > walkTrigger + hysteresis
  → transitions IDLE → TURNING → WALKING
  → moves avatarRoot.position toward walkTarget
```

### Point-and-Walk (Arc Pointer)

Industry-standard VR pattern (Half-Life: Alyx, VRChat, Rec Room).

**How to use:**

1. Enable "Walk" in VR controls panel
2. Click and hold **left thumbstick (L3)** → cyan parabolic arc appears from left controller
3. Arc hits ground → pulsing disc marker at landing point
4. Release L3 → avatar walks to that point
5. Arc turns **red** if no valid landing found

> This follows the [Meta Quest standard](https://developers.meta.com/horizon/blog/tech-note-touch-button-mapping-best-practices/):
> left stick = locomotion/teleport, right stick = snap turn only.

**Physics:** Projectile motion simulation.

```
p(t) = p₀ + v₀·t + ½·g·t²

initialSpeed = 6.0 m/s
gravity      = -9.8 m/s²
stepSize     = 0.08 s  (Euler integration step)
maxSteps     = 80      (caps arc length)
maxDistance   = 12.0 m  (horizontal limit)
```

The arc is rendered as a `THREE.Line` with `BufferGeometry` updated each frame.
Ground intersection is detected when the simulated Y coordinate crosses
`groundY` (0.0), with exact hit point interpolated.

**Input:** Left thumbstick click (L3, `buttons[3]`).

| Action | Input | Result |
|--------|-------|--------|
| Show arc | Hold L3 | Parabolic arc from left controller |
| Confirm | Release L3 | Avatar walks to target point |
| Cancel | Release L3 without valid target | Arc disappears, no walk |

When the arc is active, smooth locomotion on the left stick is suppressed
so the user can aim without drifting. Right stick (snap turn + fly) remains
fully functional at all times.

**Integration:** On L3 release with a valid target, the arc pointer calls
`NEXUS_LOCOMOTION.walkToPoint(x, z)`, which sets `pointWalkTarget` and
transitions directly to TURNING → WALKING.

### Animation Blend Controller

Manages walk/run/jog animation clips using its **own** `THREE.AnimationMixer`,
completely separate from `ClipAnimationLoader`'s mixer. This prevents the two
systems from fighting over the skeleton.

**Crossfade pattern** (same as Unity Animator):

1. All states (walk, run, jog) are loaded as `AnimationAction` at weight 0
2. `transitionTo(state, fadeDuration)` calls `crossFadeTo()` between actions
3. `fadeOutAll(duration)` returns control to ProceduralAnimator

Clips are loaded via `ClipAnimationLoader.loadClip()` to reuse its BVH
retargeting pipeline. The blend controller just wraps them in its own mixer.

### ProceduralAnimator Integration

When the avatar is walking, the walk BVH clip drives the lower body
(hips, spine, legs). ProceduralAnimator must **not** overwrite those bones.

This is controlled via a window flag:

```javascript
// Set by AvatarLocomotionSystem when entering/exiting walk
window._NEXUS_LOCOMOTION_UPPER_BODY_ONLY = true;  // walking
window._NEXUS_LOCOMOTION_UPPER_BODY_ONLY = false;  // idle
```

ProceduralAnimator checks this flag each frame (search `LOCOMOTION_HOOK` in
`ProceduralAnimator.js`). When true, it only resets and animates:

- `chest`, `neck`, `head` (breathing, head-look)
- `leftUpperArm`, `rightUpperArm`, `leftLowerArm`, `rightLowerArm`
- `leftHand`, `rightHand`

When false (default), it controls all bones including `hips` and `spine`.

---

## VR Intimacy System

A non-explicit, consent-aware close-presence layer that adjusts the avatar's
pose, facing, and follow behaviour based on how close the user is.

### Files

| File | Purpose |
|------|---------|
| `src/gltf-viewer/VRIntimacySystem.js` | Main orchestrator (ES module, class) |
| `src/gltf-viewer/VRIntimacyProfiles.js` | Profile definitions + resolver |
| `src/gltf-viewer/VRProximityTracker.js` | Distance/seated/wall detection |
| `src/gltf-viewer/VRContactAnchors.js` | Bone-attached contact zones for hand IK |

### Profiles & Distance Bands

The intimacy system selects a **profile** based on the user's distance. Each
profile controls pose, talk style, follow strength, and whether hand contact
is allowed.

```
 Distance (m)
 ──────────────────────────────────────────────────→
 0.0    0.72    1.1     1.45     ∞

 ├──────┤ comfortEmbrace (0.78m desired, rootFollow 0.16)
        ├──────┤ closeConversation (0.92m desired, rootFollow 0.12)
               ├───────┤ awarePresence (1.15m desired, rootFollow 0.06)
                       ├────────────→ idle (1.35m desired, rootFollow 0.0)
```

**All 7 profiles:**

| Profile | Desired Dist | rootFollow | Pose | Hand Contact | Trigger |
|---------|-------------|-----------|------|-------------|---------|
| `idle` | 1.35m | 0.0 | standingRelaxed | No | Default (>1.45m) |
| `awarePresence` | 1.15m | 0.06 | conversational | No | <1.45m |
| `closeConversation` | 0.92m | 0.12 | intimateSafe | Yes | <1.1m |
| `comfortEmbrace` | 0.78m | 0.16 | standingHandsClasped | Yes | <0.72m |
| `closeSeated` | 0.86m | 0.10 | sittingDesk | Yes | Seated + <1.15m |
| `supportedStanding` | 0.95m | 0.08 | standingFriendly | Yes | Wall behind + <1.15m |
| `handContact` | 0.88m | 0.08 | standingFriendly | Yes | Grip on hand anchor |

**Profile resolution priority** (`resolveVRIntimacyProfile(snapshot)`):

1. Seated + close → `closeSeated`
2. Wall behind + close → `supportedStanding`
3. Distance < 0.72m → `comfortEmbrace`
4. Distance < 1.1m → `closeConversation`
5. Distance < 1.45m → `awarePresence`
6. Otherwise → `idle`

Profile changes have a **0.4s cooldown** to prevent rapid ping-pong.

### Proximity Tracker

`VRProximityTracker` computes a **snapshot** each frame:

```javascript
{
  userHead,      // Vector3 — XR camera world position
  avatarPos,     // Vector3 — avatar root world position
  distance,      // Number  — 3D distance (metres)
  distanceXZ,    // Number  — horizontal distance only
  isSeated,      // Boolean — userHead.y < 1.35m
  userHeight,    // Number  — userHead.y
  wallBehind,    // Boolean — raycast 0.6m behind avatar hit something
}
```

**Seated detection** is a height heuristic: if the user's head is below 1.35m,
they're likely sitting.

**Wall detection** uses a raycast from chest height (1.15m) backward from the
avatar. If it hits geometry within 0.6m, `wallBehind` is true.

### Facing & Distance Micro-Adjustments

**`_updateFacing(snapshot, dt)`** — Smooth slerp to rotate avatar root to face
the user. Speed: `dt * 2.4`. Skipped when:

- Profile has `allowRootFacing: false`
- Puppet mode is moving the root
- Locomotion system is walking (defers to walk facing)

**`_updateDistanceBand(snapshot, dt)`** — Soft micro-adjust to maintain
`desiredDistance`. The avatar slides forward/backward up to ±0.04m per frame.
Uses a comfort band of ±0.06m — no adjustment within the band. Skipped when:

- Profile has `rootFollow: 0` (idle profile)
- Puppet mode is active
- Locomotion system is walking (locomotion owns root movement)

### Hand Contact & IK

When `allowHandContact` is true in the current profile, the user can grip
near the avatar's hands/shoulders/chest to initiate IK contact.

**Flow:**

1. Each frame, check both controllers for nearest anchor within 0.16m
2. **Hover:** Controller near anchor → anchor glows, gentle haptic pulse (18)
3. **Grip press:** Start IK chain solving (`poseSystem.startIK(anchorKey, controller)`)
4. **Maintain:** IK updates each frame, anchor shows as active
5. **Grip release:** End IK, clear contact, haptic pulse (25)

Haptic pulses are throttled to 120ms minimum between pulses.

### Contact Anchors

`VRContactAnchors` creates translucent sphere meshes at key bone positions:

| Anchor | Bone | Radius | Colour |
|--------|------|--------|--------|
| head | head | 0.10m | Pink |
| chest | chest | 0.11m | Blue |
| hips | hips | 0.12m | Green |
| leftShoulder | leftShoulder | 0.08m | Orange |
| rightShoulder | rightShoulder | 0.08m | Orange |
| leftHand | leftHand | 0.07m | Cyan |
| rightHand | rightHand | 0.07m | Cyan |

Anchors sync to bone world positions each frame. Visual states:

| State | Opacity | Scale |
|-------|---------|-------|
| Default | 0.12 | 1.0 |
| Hovered | 0.42 | 1.12 |
| Active | 0.66 | 1.18 |

---

## Configuration & Tuning

### Locomotion Config (`NEXUS_LOCOMOTION_CONFIG`)

All values can be changed at runtime via browser console:

```javascript
// Enable locomotion
NEXUS_LOCOMOTION_CONFIG.enable();

// Adjust walk speed
NEXUS_LOCOMOTION_CONFIG.set('walkSpeed', 1.2);

// Make avatar follow from further away
NEXUS_LOCOMOTION_CONFIG.set('walkTriggerDistance', 2.5);

// Enable debug logging
NEXUS_LOCOMOTION_CONFIG.set('debug', true);

// Get all current values
NEXUS_LOCOMOTION_CONFIG.getAll();
```

| Key | Default | Unit | Description |
|-----|---------|------|-------------|
| `enabled` | `false` | bool | Master toggle |
| `walkTriggerDistance` | `1.8` | m | Distance to start auto-follow |
| `stopDistance` | `0.95` | m | Distance to stop walking |
| `hysteresisBand` | `0.15` | m | Prevents start/stop flicker |
| `walkSpeed` | `0.85` | m/s | Root movement speed |
| `idleToWalkFade` | `0.35` | s | Crossfade into walk clip |
| `walkToIdleFade` | `0.45` | s | Crossfade back to idle |
| `rootLerpFactor` | `4.0` | — | Movement smoothing |
| `rootYLocked` | `true` | bool | Keep avatar at Y=0 |
| `turnThreshold` | `0.4` | rad | Angle before turn-in-place |
| `turnSpeed` | `3.0` | rad/s | Turn rotation speed |
| `upperBodyOnlyDuringWalk` | `true` | bool | Split procedural/walk control |
| `debug` | `false` | bool | Console logging |

### Arc Pointer Config (`NEXUS_ARC_POINTER.CONFIG`)

```javascript
// Increase arc range
NEXUS_ARC_POINTER.CONFIG.maxDistance = 20.0;

// Faster arc launch
NEXUS_ARC_POINTER.CONFIG.initialSpeed = 8.0;

// Bigger ground marker
NEXUS_ARC_POINTER.CONFIG.markerRadius = 0.4;
```

### Intimacy System

The intimacy system is enabled/disabled via the VR panel "Close" toggle or
programmatically:

```javascript
// Via ViewerEngine's VR settings event
window.dispatchEvent(new CustomEvent('vr-setting-changed', {
  detail: { key: 'intimacyMode', value: true }
}));
```

Profile distances are defined in `VRIntimacyProfiles.js`. To change when
profiles activate, edit the distance thresholds in `resolveVRIntimacyProfile()`.

---

## UI Controls

### VR Panel (Controls Layer)

| Button | Label | Action |
|--------|-------|--------|
| Walk toggle | `Walk` / `Walk: ON` / `Walk: ACTIVE` | Toggle locomotion on/off |
| Close toggle | `Close` / `Close: ON` | Toggle intimacy system on/off |

The Walk button shows three states:

- **Walk** — Feature disabled
- **Walk: ON** — Enabled, avatar is idle (waiting)
- **Walk: ACTIVE** — Avatar is currently walking or turning

### Left Thumbstick Click — L3 (when Walk is ON)

| Input | Action |
|-------|--------|
| Hold L3 | Show parabolic arc pointer from left controller |
| Release L3 | Confirm walk target (avatar walks there) |

Right thumbstick is never affected — snap turn and fly up/down work normally
at all times, following [Meta Quest standard mapping](https://developers.meta.com/horizon/blog/tech-note-touch-button-mapping-best-practices/).

---

## File Map

### Locomotion Files (new, standalone)

```
src/
├── LocomotionConfig.js          # Toggle + tuning constants
├── AnimationBlendController.js  # Own mixer for walk/run crossfade
├── AvatarLocomotionSystem.js    # State machine (IDLE→WALK→STOP)
└── TeleportArcPointer.js        # Parabolic arc + ground marker
```

### Intimacy Files (existing)

```
src/gltf-viewer/
├── VRIntimacySystem.js          # Main orchestrator
├── VRIntimacyProfiles.js        # 7 distance-based profiles
├── VRProximityTracker.js        # Distance + seated + wall detection
└── VRContactAnchors.js          # Bone-attached IK contact zones
```

### Integration Hooks (in existing files)

Search for these markers to find all integration points:

| Marker | Files |
|--------|-------|
| `LOCOMOTION_HOOK` | ViewerEngine.js, VRIntimacySystem.js, ProceduralAnimator.js, VRChatPanel.js, index.html |
| `ARC_POINTER_HOOK` | VRControllers.js, AvatarLocomotionSystem.js, ViewerEngine.js |

---

## Data Flow

### Per-Frame Update (Walking)

```
VRControllers.pollGamepadInput(dt)
  │
  ├─→ Read left L3 button (thumbstick click)
  ├─→ NEXUS_ARC_POINTER.update(controller1, l3Pressed, time)
  │     If arc active: suppress smooth locomotion on left stick
  │     On L3 release: call NEXUS_LOCOMOTION.walkToPoint(x, z)
  │
VRIntimacySystem.update(dt)
  │
  ├─→ VRProximityTracker.update() → snapshot
  ├─→ resolveVRIntimacyProfile(snapshot) → profile
  ├─→ _updateFacing()     ← skipped if isWalking()
  ├─→ _updateDistanceBand() ← skipped if isWalking()
  ├─→ NEXUS_LOCOMOTION.setProximityData(dist, userHead, avatarPos, true)
  │
NEXUS_LOCOMOTION.update(dt)
  │
  ├─→ State machine: IDLE / TURNING / WALKING / STOPPING
  ├─→ Move avatarRoot.position toward target
  ├─→ Set window._NEXUS_LOCOMOTION_UPPER_BODY_ONLY flag
  │
ProceduralAnimator.update(t, dt)
  │
  ├─→ Check _NEXUS_LOCOMOTION_UPPER_BODY_ONLY
  ├─→ If true: only animate upper body (head, arms, hands)
  ├─→ If false: animate full body (default)
  │
NEXUS_ANIMATION_BLEND.update(dt)
  │
  └─→ Update walk clip mixer (crossfade weights)
```

### Avatar Load

```
ViewerEngine.loadAvatar()
  ├─→ NEXUS_LOCOMOTION.init(root, vrm)
  ├─→ NEXUS_LOCOMOTION.preload()        # Load walk/run BVH clips
  ├─→ NEXUS_ARC_POINTER.init(scene, renderer)
  └─→ vrIntimacySystem.setAvatar(root)
```

---

## How to Remove

### Remove Locomotion Only

1. Delete files:
   - `src/LocomotionConfig.js`
   - `src/AnimationBlendController.js`
   - `src/AvatarLocomotionSystem.js`
   - `src/TeleportArcPointer.js`

2. In `index.html`: delete the 4 `<script>` tags after ClipAnimationLoader

3. Search `LOCOMOTION_HOOK` across the project — delete those blocks:
   - `ViewerEngine.js`: ~6 lines (init + update call)
   - `VRIntimacySystem.js`: ~8 lines (proximity feed + facing/distance guards)
   - `ProceduralAnimator.js`: revert touched array to original (remove conditional)
   - `VRChatPanel.js`: ~20 lines (walk button layout, hitbox, handler, drawing)

4. Search `ARC_POINTER_HOOK` — delete those blocks:
   - `VRControllers.js`: ~10 lines (thumbstick feed)
   - `ViewerEngine.js`: ~3 lines (init)

### Remove Intimacy Only

The intimacy system is a standalone ES module. Disable via:

```javascript
vrIntimacySystem.setEnabled(false);
```

Or remove entirely by deleting the 4 intimacy files and the constructor /
update calls in `ViewerEngine.js`.

### Remove Both

Follow both sets of instructions above. No other systems depend on these
features.
