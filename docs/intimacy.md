# VR Intimacy System — Complete Engineering Reference

**Author:** Ruslan Magana Vsevolodovna
**Enterprise-Grade Documentation for AI Avatar Close-Presence Interaction**
**System:** 3D-Avatar-Chatbot VR Intimacy Pipeline

---

## Part I: System Identity

### What It Is

A proximity-driven behavior orchestration layer that makes an AI avatar respond
naturally to the user's physical closeness in VR. It is the technology that transforms
a static 3D character into a socially-aware companion.

### What It Is NOT

- Not a physics engine
- Not a replacement for VRPoseSystem, ProceduralAnimator, or BehaviorEngine
- Not explicit — all interactions are comfort-safe (conversation, embrace, hand-hold)

### Why It Matters

Research shows that proxemic awareness is the single largest contributor to social
presence in VR after visual realism. Users who experience proximity-responsive avatars
report significantly higher engagement, emotional connection, and willingness to
continue interaction.

---

## Part II: Scientific Foundation — Hall's Proxemics

Edward T. Hall's 1963 proxemics theory defines four interpersonal distance zones:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                            │
│   INTIMATE          PERSONAL          SOCIAL            PUBLIC             │
│   0 ── 0.46m        0.46 ── 1.2m      1.2 ── 3.6m      > 3.6m            │
│                                                                            │
│   Touch, whisper    Conversation      Formal talk       Audience           │
│   Family, lovers    Friends, close    Acquaintances     Strangers          │
│                     colleagues                                             │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Critical VR finding:** Research shows VR users maintain ~160% greater distances
than in physical space. Our system accounts for this:

```
Hall's Real-World Zone       VR-Adjusted Range     System Profile
─────────────────────────────────────────────────────────────────
INTIMATE  (0–0.46m)      →  0–0.72m            →  comfortEmbrace
PERSONAL  (0.46–1.2m)    →  0.72–1.45m         →  closeConversation / awarePresence
SOCIAL    (1.2–3.6m)     →  > 1.45m            →  idle
PUBLIC    (> 3.6m)       →  (not tracked)       →  (out of range)
```

---

## Part III: File Architecture

```
src/gltf-viewer/
├── VRIntimacySystem.js      299 lines   Orchestrator: main loop, bridges, state machine
├── VRIntimacyProfiles.js    133 lines   Profile definitions + distance resolver
├── VRProximityTracker.js     83 lines   Spatial sensor: distance, seated, wall detection
└── VRContactAnchors.js      162 lines   Bone-attached contact spheres for hand interaction

Dependencies (used, NOT owned):
├── VRPoseSystem.js                      Pose presets + IK solver
├── VRPuppetInteraction.js               User-controlled root placement
├── ProceduralAnimator.js                Base pose + talk style + breathing
├── VRControllers.js                     Button state + haptic actuators
└── BehaviorEngine.js                    Emotion state machine (via event bridge)
```

---

## Part IV: System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ViewerEngine.animate() — 72 Hz                       │
│                                                                         │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ AvatarManager │  │ VRGazeController │  │   ProceduralAnimator     │  │
│  │  (VRM sync)   │  │   (eyes→HMD)     │  │   + BehaviorEngine       │  │
│  │   Step 1      │  │    Step 2        │  │      Step 3              │  │
│  └──────────────┘  └──────────────────┘  └──────────────────────────┘  │
│                                                                         │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ VRControllers │  │  VRPoseSystem    │  │  VRPuppetInteraction     │  │
│  │ (input poll)  │  │ (pose blend+IK)  │  │  (user root grab)        │  │
│  │   Step 4      │  │    Step 5        │  │      Step 6              │  │
│  └──────────────┘  └──────────────────┘  └──────────────────────────┘  │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │              ★ VRIntimacySystem — Step 7 (LAST)                  │  │
│  │                                                                    │  │
│  │  ┌─────────────────┐       ┌──────────────────┐                   │  │
│  │  │  VRProximity     │       │ VRContactAnchors │                   │  │
│  │  │  Tracker         │       │ (7 bone spheres)  │                   │  │
│  │  │  (distance/      │       │                    │                   │  │
│  │  │   seated/wall)   │       │  head, chest,      │                   │  │
│  │  └────────┬─────────┘       │  hips, 2 shoulder  │                   │  │
│  │           │                  │  2 hands           │                   │  │
│  │           ▼                  └────────┬───────────┘                   │  │
│  │  ┌─────────────────┐                │                               │  │
│  │  │ Profile Resolver │                │                               │  │
│  │  │ (distance →      │◄───────────────┘                               │  │
│  │  │  behavior set)   │                                                │  │
│  │  └────────┬─────────┘                                                │  │
│  │           │                                                          │  │
│  │  ┌────┴─────┬──────────┬──────────┬──────────┬─────────┐           │  │
│  │  ▼          ▼          ▼          ▼          ▼         ▼           │  │
│  │  Facing    Distance   Behavior   Hand       Loco                   │  │
│  │  (slerp    Band       Bridge     Contact    Feed                   │  │
│  │  toward    (slide to  (basePose  (IK via    (opt)                  │  │
│  │  user)     desired)   +talkStyle) solver)                          │  │
│  │                                                                    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌──────────────┐                                                       │
│  │  Locomotion   │  Step 8 (optional)                                   │
│  └──────────────┘                                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Part V: The Core Algorithm — Frame-by-Frame

### 5.1 Main Update Loop

```
VRIntimacySystem.update(dt)                     [VRIntimacySystem.js:87]
│
├─ GUARD: if (!enabled || !avatarRoot || !xr.isPresenting) → return
│
├─ COOLDOWN: _profileCooldown -= dt             (prevents profile thrashing)
│
├─ STEP 1: anchors.update()
│  Move each of 7 bone-attached spheres to current bone world position
│
├─ STEP 2: proximity.update() → snapshot
│  ├─ userHead   = XR camera world position
│  ├─ avatarPos  = avatar root world position
│  ├─ distance   = 3D Euclidean distance
│  ├─ distanceXZ = horizontal distance (ignores Y)
│  ├─ isSeated   = (userHead.y < 1.35m)
│  ├─ userHeight = raw head Y
│  └─ wallBehind = raycast backward from chest (0.6m range)
│
├─ STEP 3: anchors.clearVisualState()
│  Reset all hover/active opacity for fresh frame
│
├─ STEP 4: desiredProfile = resolveVRIntimacyProfile(snapshot)
│  Priority order:
│    1. seated + close     → closeSeated
│    2. wall + close       → supportedStanding
│    3. d < 0.72m          → comfortEmbrace
│    4. d < 1.1m           → closeConversation
│    5. d < 1.45m          → awarePresence
│    6. else               → idle
│
├─ STEP 5: if (profile changed AND cooldown expired):
│  ├─ currentProfile = desiredProfile
│  ├─ _applyProfile():
│  │   ├─ poseSystem.applyPreset(profile.posePreset, 0.45s)
│  │   ├─ proceduralAnimator.setBasePose(profile.basePose)
│  │   └─ proceduralAnimator.setTalkStyle(profile.talkStyle)
│  └─ cooldown = 0.4s
│
├─ STEP 6: _updateFacing(snapshot, dt)
│  ├─ if puppet/locomotion active → skip
│  ├─ toUser = userHead - avatarPos (Y zeroed)
│  ├─ targetYaw = atan2(toUser.x, toUser.z)
│  └─ avatarRoot.quaternion.slerp(targetQ, min(1, dt * 2.4))
│
├─ STEP 7: _updateDistanceBand(snapshot, dt)
│  ├─ if puppet/locomotion active → skip
│  ├─ delta = distance - profile.desiredDistance
│  ├─ if |delta| < 0.06m → dead zone, skip
│  └─ avatarRoot.position += toUser * clamp(delta * rootFollow * dt * 4, -0.04, 0.04)
│
├─ STEP 8: _updateBehaviorBridge()
│  ├─ if comfortEmbrace or closeConversation:
│  │   └─ proceduralAnimator.setMode('idle')     ← suppress talk gestures
│  └─ else: no-op
│
├─ STEP 9: _updateHandContact(dt)
│  ├─ if !profile.allowHandContact → end any active contact, return
│  ├─ For each hand (left, right):
│  │   ├─ controllerPos = controller.getWorldPosition()
│  │   ├─ nearest = anchors.findNearest(pos, 0.16m, ['leftHand','rightHand'])
│  │   ├─ if nearest: highlight anchor, pulse haptics (18)
│  │   ├─ if grip + nearest + no active contact:
│  │   │   ├─ poseSystem.startIK(anchorKey, controller) → CCD arm chain
│  │   │   ├─ set profile = handContact
│  │   │   └─ pulse haptics (35)
│  │   └─ if active + grip released:
│  │       ├─ poseSystem.endIK()
│  │       └─ pulse haptics (25)
│  │
│  └─ STEP 10: LOCOMOTION_HOOK (optional)
│
└─ locomotion.setProximityData(distance, userHead, rootPos)
```

---

## Part VI: Profile System — Complete Reference

### 6.1 Profile Definitions Table

```
Profile Key         Distance Band     Desired  Root   Hand  Pose Preset           Base Pose        Talk Style
                                      Dist     Follow Contact
────────────────────────────────────────────────────────────────────────────────────────────────────────────────
idle                > 1.45m           1.35m    0.00   No    standingRelaxed       lecturerNeutral  explainCalm
awarePresence       1.10 – 1.45m      1.15m    0.06   No    conversational        presenterOpen    explainCalm
closeConversation   0.72 – 1.10m      0.92m    0.12   Yes   intimateSafe          lecturerNeutral  explainCalm
comfortEmbrace      < 0.72m           0.78m    0.16   Yes   standingHandsClasped  anchorGrounded   broadcastAnchor
closeSeated         seated + < 1.15m  0.86m    0.10   Yes   sittingDesk           anchorGrounded   explainCalm
supportedStanding   wall + < 1.15m    0.95m    0.08   Yes   standingFriendly      presenterOpen    explainCalm
handContact         grip + near       0.88m    0.08   Yes   standingFriendly      presenterOpen    explainCalm
```

### 6.2 Profile Resolution Flow Diagram

```
                    ┌───────────────────┐
                    │  snapshot arrives  │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │  isSeated AND      │──── Yes ──→ closeSeated
                    │  distance < 1.15   │
                    └─────────┬─────────┘
                              │ No
                    ┌─────────▼─────────┐
                    │  wallBehind AND    │──── Yes ──→ supportedStanding
                    │  distance < 1.15   │
                    └─────────┬─────────┘
                              │ No
                    ┌─────────▼─────────┐
                    │  distance < 0.72   │──── Yes ──→ comfortEmbrace
                    └─────────┬─────────┘
                              │ No
                    ┌─────────▼─────────┐
                    │  distance < 1.10   │──── Yes ──→ closeConversation
                    └─────────┬─────────┘
                              │ No
                    ┌─────────▼─────────┐
                    │  distance < 1.45   │──── Yes ──→ awarePresence
                    └─────────┬─────────┘
                              │ No
                              ▼
                            idle
```

### 6.3 Transition Timing

```
Profile A ──── user moves ──── Profile B desired
                    │
                    │ cooldown check
                    │ (0.4s since last change)
                    │
                    ├── cooldown > 0 ────────────► stay on A (wait)
                    │
                    └── cooldown expired ────────► transition to B
                        │
                        ├── applyPreset(B.posePreset, 0.45s)  ← body pose blends over 450ms
                        ├── setBasePose(B.basePose)            ← instant (next frame uses it)
                        ├── setTalkStyle(B.talkStyle)          ← instant (next talk uses it)
                        └── cooldown = 0.4s                    ← lock for 400ms
```

---

## Part VII: Subsystem Deep-Dives

### 7.1 VRProximityTracker — Spatial Sensor

```
┌────────────────────────────────────────────────────────────────┐
│                     VRProximityTracker                          │
│                                                                │
│  Input:                                                        │
│    camera (XR HMD)  ──→  userHead position                     │
│    avatarRoot        ──→  avatarPos position                    │
│                                                                │
│  Computations:                                                 │
│    distance   = |userHead - avatarPos|          (3D)           │
│    distanceXZ = sqrt(dx² + dz²)                (horizontal)   │
│    isSeated   = userHead.y < 1.35m              (heuristic)    │
│    wallBehind = raycast(chest, backward, 0.6m)  (physics)      │
│                                                                │
│  Output: snapshot { userHead, avatarPos, distance,             │
│                     distanceXZ, isSeated, userHeight,          │
│                     wallBehind }                                │
└────────────────────────────────────────────────────────────────┘
```

**Wall Detection Detail:**

```
         ▲ avatar forward (+Z)
         │
         │
      ┌────┐
      │  ● │  chest origin (avatarPos.y + 1.15m)
      │    │
      └────┘
         │
         │  ←── raycast backward, 0.6m range
         │
  ┌──────┴──────┐
  │    WALL     │  ← any non-avatar mesh hit = wallBehind: true
  └─────────────┘
```

### 7.2 VRContactAnchors — Touch Points

**Anchor Map on Avatar Skeleton:**

```
              ┌─────────┐
              │  HEAD    │  r=0.10  #ff88cc
              │    ●     │
              └────┬────┘
        ┌──────────┼──────────┐
   L_SHOULDER      │      R_SHOULDER
     ● r=0.08      │        ● r=0.08
        │     ┌────┴────┐       │
        │     │  CHEST   │       │
        │     │    ●     │       │
        │     │  r=0.11  │       │
        │     └────┬────┘       │
   L_HAND          │        R_HAND
     ● r=0.07 ┌───┴───┐   ● r=0.07
              │  HIPS   │
              │    ●    │
              │  r=0.12 │
              └────────┘

★ Only leftHand and rightHand are interactive (IK targets)
○ Others are visual/debug indicators (future expansion)
```

**Visual State Machine per Anchor:**

```
┌──────────────┐
│   DEFAULT    │  opacity=0.12, scale=1.0
└──────┬───────┘
       │ controller enters 16cm radius
       ▼
┌──────────────┐
│   HOVERED    │  opacity=0.42, scale=1.12
│              │  haptic pulse 18
└──────┬───────┘
       │ grip button pressed
       ▼
┌──────────────┐
│   ACTIVE     │  opacity=0.66, scale=1.18
│  (IK running)│  haptic pulse 35
└──────┬───────┘
       │ grip released
       ▼
┌──────────────┐
│  RELEASED    │  → IK ends, haptic pulse 25
│  → DEFAULT   │  → back to default next frame
└──────────────┘
```

### 7.3 IK Chain — Hand Contact Mechanics

When the user grips near the avatar's hand:

```
Avatar Arm IK Chain (CCD Solver):

Shoulder ──→ UpperArm ──→ LowerArm ──→ Hand (effector)
   ●            ●            ●           ● ←── tracks controller position
```

**CCD Algorithm (12 iterations per frame):**

```
Iteration  1:  Rotate Hand toward target
Iteration  2:  Rotate LowerArm toward target
Iteration  3:  Rotate UpperArm toward target
Iteration  4:  Rotate Shoulder toward target
Iteration  5:  Rotate Hand toward target (refined)
...
Iteration 12:  Final refinement

Result: Avatar's arm naturally reaches toward user's controller
```

**CCD vs FABRIK — per research:**

```
Aspect         CCD (current)                FABRIK (recommended upgrade)
───────────────────────────────────────────────────────────────────────
Convergence    26 iterations avg             3-5 sweeps
Smoothness     Can flicker on long chains    Smooth, no oscillation
Implementation Simple (rotate each bone)     Moderate (forward+backward pass)
Joint limits   Harder to enforce             Natural integration
Best for       Short chains (3-4 bones)      All chain lengths
```

**Recommendation:** The current 4-bone arm chain works well with CCD. FABRIK would
be beneficial if we extend to full-body IK or longer chains.

---

## Part VIII: System Wiring — How Everything Connects

### 8.1 Activation Flow (CLOSE Button)

```
┌─────────────────────┐       ┌──────────────────────┐
│   VR Chat Panel     │       │    ViewerEngine       │
│ (Layer 2: Controls) │       │                       │
│                     │ event │                       │
│  [Close] button ────┼──────►│ 'vr-setting-changed'  │
│   Btn:xr_intimacy   │       │  key: 'intimacyMode'  │
│                     │       │  value: true/false     │
│  xrSettings.        │       │                       │
│  intimacyMode = !   │       │  vrIntimacySystem     │
│                     │       │  .setEnabled(value)    │
└─────────────────────┘       └──────────┬───────────┘
                                         │
                                         ▼
                              ┌──────────────────────┐
                              │  VRIntimacySystem     │
                              │                       │
                              │  if enabled:          │
                              │    starts running in  │
                              │    animate() loop     │
                              │                       │
                              │  if disabled:         │
                              │    endAllContacts()   │
                              │    profile = idle     │
                              └──────────────────────┘
```

### 8.2 Bridge Diagram — All Connected Systems

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         VRIntimacySystem                                 │
│                                                                          │
│  ┌─────────────────┐           READS FROM:                               │
│  │  VRProximity     │◄── XR Camera (HMD position)                        │
│  │  Tracker         │◄── Avatar Root (world position)                    │
│  │                  │◄── Scene meshes (wall detection raycast)           │
│  └────────┬─────────┘                                                    │
│           │ snapshot                                                     │
│           ▼                                                              │
│  ┌─────────────────┐           WRITES TO:                                │
│  │ Profile Resolver │                                                    │
│  └────────┬─────────┘                                                    │
│           │                                                              │
│  ┌────┴──────┬──────────┬──────────┬──────────┐                         │
│  ▼           ▼          ▼          ▼          ▼                         │
│  VRPose      Procedural Avatar     VRContact  Haptic                    │
│  System      Animator    Root      Anchors    Actuators                  │
│                         Transform                                        │
│  .apply      .setBasePose .quaternion .setHovered  .pulse()             │
│  Preset()    .setTalkStyle .slerp()  .setActive                         │
│  .startIK    .setMode     .position +=                                   │
│  .endIK                                                                  │
│                                                                          │
│  YIELDS TO:                                                              │
│  ├── VRPuppetInteraction (root translate/dual transform modes)           │
│  └── NEXUS_LOCOMOTION (walking state)                                    │
│                                                                          │
│  RECEIVES FROM:                                                          │
│  └── 'avatar-emotion-changed' event → setEmotion() [stored, unused]     │
└──────────────────────────────────────────────────────────────────────────┘
```

### 8.3 Render Loop Timing

```
Frame N (13.9ms at 72Hz)
│
├── 0.0ms  avatarManager.update()          VRM bone sync
├── 0.5ms  vrGazeController.update()       Eyes → HMD
├── 1.0ms  ProceduralAnimator.update()     Breathing + gestures
│          └── BehaviorEngine.update()     State machine
├── 2.5ms  vrControllers.update()          Input polling
├── 3.0ms  vrPoseSystem.update()           Pose blend + IK solve
├── 4.0ms  vrPuppetInteraction.update()    Root grab
├── 5.0ms  ★ vrIntimacySystem.update()     THIS SYSTEM
│          ├── proximity tracker   ~0.3ms  (1 raycast)
│          ├── profile resolve     ~0.01ms
│          ├── facing slerp        ~0.02ms
│          ├── distance band       ~0.02ms
│          ├── behavior bridge     ~0.01ms
│          └── hand contact        ~0.1ms  (anchor search)
├── 5.5ms  locomotion.update()             Walk system
├── 6.0ms  renderer.render()               GPU draw
└── 13.9ms frame complete
```

---

## Part IX: What Is Missing — Roadmap to World-Class Standard

### 9.1 Priority 1: Hysteresis (Prevents Profile Jitter)

**Problem:** The resolver uses hard thresholds. A user bobbing at exactly 1.1m
distance rapidly switches between `awarePresence` and `closeConversation`.

**Solution:** Add enter/exit thresholds per profile.

```
CURRENT (hard thresholds):
────────┤ 1.1m ├────────
  closeConv  │  awarePresence

PROPOSED (hysteresis):
────────┤ 1.05m ├── enter closeConversation
────────┤ 1.15m ├── exit closeConversation (back to awarePresence)
        ├ dead  ┤
        │ zone  │
```

The `minDistance` and `maxDistance` fields already exist in each profile but are
unused. They should drive the hysteresis.

### 9.2 Priority 2: Emotion Bridge (Facial Expressions)

**Problem:** `setEmotion()` stores the value but nothing reads it. During
`comfortEmbrace`, the avatar's face is neutral — it should express warmth.

**Solution:** Each profile should define expression overrides:

```javascript
comfortEmbrace: {
    ...existing fields,
    expressionOverride: { happy: 0.25, relaxed: 0.15 },
}

closeConversation: {
    expressionOverride: { happy: 0.12 },
}
```

Apply via BehaviorEngine's expression system during `_updateBehaviorBridge()`.

### 9.3 Priority 3: Audio Proximity Modulation

**Problem:** The avatar speaks at the same volume regardless of distance. Per
VRChat's spatial audio model and proximity chat standards, voice should attenuate
with distance.

**Solution:** Integrate with TTS output:

```
Proximity Zone          Volume   TTS Tone          Behavior
────────────────────────────────────────────────────────────
> 1.45m (idle)          100%     Normal            Standard voice
1.1–1.45m (aware)       100%     Slightly warmer   -
0.72–1.1m (close)        90%     Warm, softer      Reduce rate slightly
< 0.72m (embrace)        75%     Gentle whisper    Lower pitch, slower
```

This mimics the natural human behavior of speaking more softly when someone is
very close — a key finding from the IEEE VR 2025 "Whisper" paper on
proximity-based private communication.

### 9.4 Priority 4: Velocity Prediction

**Problem:** Profile resolution only considers instantaneous distance. A user
walking briskly toward the avatar should trigger earlier profile preparation.

**Solution:** Track `d(distance)/dt` over 3-5 frames:

```
if (approachVelocity > 0.3 m/s AND distance < threshold + 0.2m):
    pre-transition to next-closer profile
```

This creates anticipatory body language — the avatar starts to adjust posture
before the user arrives, like a real person noticing someone approaching.

### 9.5 Priority 5: Continuous Haptic Gradient

**Problem:** Haptics only pulse on discrete events (hover enter, grip
press/release). Per 2025 haptic research, continuous proximity-based feedback
significantly increases presence.

**Solution:** Add a gentle continuous vibration that intensifies as the hand
approaches an anchor:

```
distance to nearest anchor:
  > 16cm:   no haptics
  16–8cm:   intensity = 0.05  (barely perceptible)
   8–4cm:   intensity = 0.12  (gentle awareness)
   < 4cm:   intensity = 0.20  (about to touch)
  contact:  intensity = 0.35  (grip)
```

### 9.6 Priority 6: Seated Detection Improvement

**Problem:** `isSeated = userHead.y < 1.35m` is a static threshold. Tall seated
users may exceed 1.35m; short standing users may be below it.

**Solution:** Use velocity-based transition detection:

```
if (headY drops > 0.3m in < 1.5s AND new headY < 1.5m):
    isSeated = true

if (headY rises > 0.3m in < 1.5s AND new headY > 1.2m):
    isSeated = false
```

This detects the *act of sitting down* rather than absolute height, making it
robust across user heights.

### 9.7 Priority 7: Expand Interactive Anchors

**Problem:** Only `leftHand` and `rightHand` are interactive. The other 5 anchors
(head, chest, hips, 2 shoulders) are visual-only.

**Solution:** Enable shoulder contact for "shoulder pat" interaction:

```
if grip pressed near shoulder anchor:
    avatar responds with subtle head tilt toward that shoulder
    expression: grateful/touched (0.3)
    haptic: warm pulse
```

### 9.8 Priority 8: Wall Detection Optimization

**Problem:** `scene.traverse()` runs every frame to collect blocker meshes.
Expensive for complex scenes.

**Solution:** Cache non-avatar meshes on avatar load/scene change. Only invalidate
when scene objects are added/removed.

### 9.9 Priority 9: FABRIK Upgrade for IK

**Problem:** CCD can produce subtle flickering on edge cases.

**Solution:** Replace CCD solver with FABRIK for smoother convergence. FABRIK
produces visually smooth movements without oscillations, converges faster, and
handles joint constraints more naturally.

---

## Part X: Complete State Machine Diagram

```
                    ┌───────────────────────────┐
                    │        SYSTEM OFF          │
                    │    (CLOSE button = OFF)     │
                    └──────────────┬──────────────┘
                                   │
                          User taps CLOSE
                                   │
                    ┌──────────────▼──────────────┐
                    │        SYSTEM ON            │
                    │    (CLOSE button = ON)       │
                    │    intimacyMode = true       │
                    └──────────────┬──────────────┘
                                   │
          ┌────────────────────────┼─────────────────────────────┐
          │                        │                             │
┌─────────▼─────────┐   ┌────────▼────────┐   ┌───────▼──────────┐
│  CONTEXT CHECK     │   │ DISTANCE CHECK  │   │   HAND CHECK     │
│                    │   │                 │   │                   │
│  seated + < 1.15m? │   │  < 0.72m?       │   │  grip + near?    │
│  wall + < 1.15m?   │   │  < 1.10m?       │   │                   │
└────────┬───────────┘   │  < 1.45m?       │   └─────────┬─────────┘
         │               │  else           │             │
  ┌──────┴──────┐   └──┬──┬──┬──┬──┘             ▼
  ▼             ▼      │  │  │  │          handContact
closeSeated  supported │  │  │  │       (standingFriendly
(sittingDesk) Standing │  │  │  │          IK active
 d=0.86m) (standingFriendly│  │  │          d=0.88m)
           d=0.95m)    │  │  │  │
                       ▼  │  │  ▼
                   embrace│  │ idle
               (hands     │  │ (standing
                clasped   │  │  Relaxed
                d=0.78m)  │  │  d=1.35m)
                          ▼  ▼
                    close   awarePresence
                     Conv  (conversational
                 (intimate   d=1.15m)
                  Safe
                  d=0.92m)
```

**Each profile CONCURRENTLY drives:**

```
├── Facing:       avatar root slerps toward user (yaw)
├── Distance Band: avatar root slides to desiredDistance
├── Pose Preset:  VRPoseSystem blends body pose (450ms)
├── Base Pose:    ProceduralAnimator arm/body offset
├── Talk Style:   ProceduralAnimator gesture pattern
├── Behavior Mode: 'idle' for embrace/close (suppress talk)
└── Hand Contact:  anchor hover + IK (if allowHandContact)
```

---

## Part XI: Data Flow — End-to-End for a Typical Interaction

```
TIME    EVENT                   SYSTEM                    AVATAR RESPONSE
─────────────────────────────────────────────────────────────────────────────
 0.0s   User at 2m              idle profile              Standing relaxed, no tracking

 0.5s   User walks toward       still idle                No change

 1.2s   User crosses 1.45m      → awarePresence           Pose: conversational
                                                           Starts gently facing user
                                                           Root follow: 0.06 (very gentle)

 2.0s   User at 1.0m            → closeConversation       Pose: intimateSafe
                                                           Root follow: 0.12
                                                           Hand anchors become touchable

 3.5s   User at 0.6m            → comfortEmbrace          Pose: standingHandsClasped
                                                           Base: anchorGrounded
                                                           Root follow: 0.16
                                                           Talk gestures suppressed

 5.0s   User grips near         → handContact             IK starts: arm reaches toward
        avatar's right hand      (overrides current        user's controller
                                  profile)                 Haptic pulse: 35

 5.0s+  Grip held               IK solves every frame     Arm follows controller

 7.0s   Grip released           IK ends                   Arm returns to pose
                                → returns to distance-     Haptic pulse: 25
                                  based profile

 8.0s   User steps back to 1.3m → awarePresence           Pose: conversational
                                                           Gentle transition

10.0s   User at 1.6m            → idle                    Standing relaxed
                                                           Root follow stops
```

---

## Part XII: Quality Metrics — How to Measure Success

```
Metric                        Current                 Target (Standard)         How to Measure
──────────────────────────────────────────────────────────────────────────────────────────────────
Profile jitter at boundaries  Possible (no hysteresis) Zero jitter              Count profile changes/min at threshold
Transition smoothness         450ms blend              300-500ms with easing    Visual inspection, user comfort survey
Hand contact accuracy         16cm radius, CCD         12cm radius, FABRIK      IK endpoint error in cm
Haptic feedback coverage      3 discrete events        Continuous gradient       User awareness survey
Facial expression response    None (emotion unused)    Profile-specific exprs   Expression intensity at each profile
Audio proximity modulation    None                     Distance-based vol+tone  A/B test user preference
Seated detection accuracy     Height threshold only    Height + velocity        Correct detection rate across heights
Wall detection performance    scene.traverse()/frame   Cached mesh list         ms/frame cost
```

---

## Part XIII: Summary for Engineering Teams

### The 4-Sentence Pitch

The VR Intimacy System is a proximity-driven state machine that transforms a static
AI avatar into a socially-aware companion. It measures the spatial relationship
between the user and avatar every frame, selects the appropriate behavior profile
based on distance and context, and smoothly transitions the avatar's pose, position,
gaze, and interaction capabilities. It is built on Hall's proxemics theory (scaled
for VR) and layered non-destructively on top of existing animation systems. The 9
identified improvements (hysteresis, emotions, audio, velocity prediction, continuous
haptics, seated detection, expanded anchors, wall cache, FABRIK) would elevate it
to a world-class standard.

### Key Principles

1. **Additive, not destructive** — layers on top, never replaces
2. **Always yields** — puppet mode and locomotion take priority
3. **Pipeline position matters** — runs last so it has final say
4. **Cooldown prevents chaos** — 400ms minimum between transitions
5. **Proxemics are scientific** — distances are research-backed, VR-scaled

---

## Sources

- Hall's Proxemics — Wikipedia
- New Proxemics in VR — Springer Nature 2024
- Digital Proxemics in VR — ACM CHI 2022
- Navigation & Proxemics with Conversational Agents — IEEE 2025
- Pre-touch Proxemics in VR — PMC 2023
- Haptics in Social VR — Springer 2024
- Multi-User VR Social Touch — arXiv 2025
- Haptic Zone Design Tool — MDPI 2025
- FABRIK IK Solver
- CCD vs FABRIK Comparison — 2025
- VRChat Player Audio / Spatial Audio
- Proximity Voice Chat — GetStream
- Audio Spatial Presence in VR — Frontiers 2025
- VR Interaction Design Best Practices — arXiv 2025
- Avatars: Art & Science of Social Presence — Meta
- VRChat IK System — Wiki


