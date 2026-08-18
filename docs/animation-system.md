# Animation & Pose System

## Overview

The 3D Avatar Chatbot uses a **multi-layered procedural animation system** with additive compositing. All idle, breathing, and gesture animations are generated in real-time using sine waves, phase offsets, and bone-level oscillation channels — no pre-recorded clips needed for the default idle.

This is the same approach used by AAA games (Horizon Zero Dawn, FFXIV, Genshin Impact) for NPC idle animations: irrational frequency ratios produce non-repeating, organic motion that never visibly loops.

---

## T-Pose Correction

### The Problem

VRM/GLB models are authored in T-pose (arms horizontal). This is standard for rigging but looks unnatural.

### The Fix: NaturalPosePlugin

Applied **once** at avatar load time. Sets absolute quaternion rotations on VRM normalized bones.

**Default preset (`naturalIdle`, 55-degree arms):**

| Bone | Axis | Angle | Effect |
|------|------|-------|--------|
| leftShoulder | Z | +8 deg | Shoulder drops |
| rightShoulder | Z | -8 deg | Shoulder drops |
| leftUpperArm | Z | +55 deg | Arm lowered from horizontal |
| rightUpperArm | Z | -55 deg | Arm lowered |
| leftLowerArm | Y | -15 deg | Elbow bend |
| rightLowerArm | Y | +15 deg | Elbow bend |
| leftHand | Z | +8 deg | Hand droop |
| rightHand | Z | -8 deg | Hand droop |

**Other presets:** Relaxed Standing (40 deg), Portrait (65 deg), Presentation (30 deg).

### How AAA Games Do It

1. Models authored in T-pose / A-pose
2. A **rest pose** applied at load time (identical to our NaturalPosePlugin)
3. All runtime animations are **additive offsets** on the rest pose
4. The rest pose is never visible to the player

---

## Frame Pipeline (Every Frame, ~60fps)

```
1. restoreToRest()      ← Reset bones to corrected rest (T-pose + 55-deg fix)
       │
2. applyBasePose()      ← Apply standing posture offsets FROM rest
       │                   bone = rest × basePoseOffset
       │
3. Breathing            ← ADDITIVE on current state
       │                   bone.quaternion.multiply(breathOffset)
       │
4. Head Look            ← ADDITIVE (mouse/touch/face-tracking)
       │                   bone.quaternion.multiply(lookOffset)
       │
5. Mode Animation       ← ADDITIVE (waiting, happy, thinking, etc.)
       │                   bone.quaternion.multiply(modeOffset)
       │
   Final = rest × basePose × breathing × headLook × mode
```

### Head Look: eye contact is the resting state

The head follows a single normalized `mouse {x, y}` (−1..1 across the window).
A **mouse is a continuous presence**, so on desktop it follows the pointer
forever with no decay — unchanged, and deliberately so.

**Touch is not a pointer.** It's sparse and edge-biased: the last touch before
you look at her was probably a button near a screen edge. With no decay the head
held that value indefinitely, so she appeared to "prefer looking sideways" —
frozen in profile until the next touch happened to land centre-screen. Two
aggravators: in companion mode most taps *are* chrome at the edges, and
coordinates normalize against the whole window even when the avatar occupies a
small widget, so an edge touch maps to extreme yaw.

So a touch is a **glance**, not a command:

| | Behaviour |
| --- | --- |
| Mouse | Continuous follow, no decay (`lastTouchAt` is never set by `mousemove`) |
| Touch | Deflects the gaze, then eases back to centre `GAZE_GLANCE_HOLD_MS` (2.5 s) after the finger stops, over ~1.6 s |
| In conversation | Listening / thinking / speaking returns the gaze immediately — no 2.5 s wait |
| UI chrome | Touches on chat controls and the companion's own chrome (`.cm-drag`, `.cm-close`, `.cm-expand`, `.cm-resize`, `.cm-bar`, the mobile drawer) are ignored entirely |
| Companion open | `recenterGaze()` puts the gaze on the user at once — first impressions are eye contact |

**`setGazeOverride()` must not be decayed.** It is not a separate channel: it
*writes into* `mouse`, and the head look always reads `mouse`. `VRGazeController`
and `FaceTracker` follow-mode rewrite it **every frame**, so decaying underneath
them compounds — measured at a **0.44 → 0.32 yaw loss over 4 s (−27%), still
falling**, and because they keep writing non-zero values the rest threshold is
never reached, so it never stops. Hence the decay is guarded by
`if (lastTouchAt && !gazeOverride)`. Headset gaze and mobile face tracking are
per-frame authorities and always win.

**Wrong (replacement):**
```
bone = rest × modeOffset    ← base pose LOST, arms rise toward T-pose
```

**Correct (additive — what we use):**
```
bone = rest × basePose × modeOffset    ← all layers preserved
```

`applyAdditiveEuler(bone, euler)` multiplies on the bone's **current** quaternion. This is identical to Unity's Additive Animation Layers and Unreal's Layered Blend Per Bone.

---

## Waiting Mode (Default Idle)

Replicates VRoid Hub / FFXIV / Genshin idle. Uses irrational frequencies so the motion never visibly repeats.

### Oscillation Formula

```
rotation(t) = amplitude × sin(2π × frequency × t + phase) + offset
```

### Layer Table

| Layer | Bone | Freq (Hz) | Amp (deg) | Purpose |
|-------|------|-----------|-----------|---------|
| Weight shift | hips Z | 0.125 | 3.0 | Contrapposto L/R sway |
| Hip rotation | hips Y | 0.09 | 1.5 | Follows weight |
| Spine counter | spine Z | 0.125+phase | 1.8 | S-curve opposition |
| Breathing (spine) | spine X | 0.18 | 1.4 | Calm resting breath |
| Breathing (chest) | chest X | 0.18+phase | 1.8 | Wave propagation |
| Head drift | head Y | 0.08 | 3.5 | Slow look-around |
| Head tilt | head Z | 0.13 | 2.0 | Gentle tilt |
| Gaze stabilizer | head X | 0.18+phase | -0.4 | Counter-breathe |
| Neck lag | neck Z/Y | 0.11/0.06 | 1.5/1.0 | Organic delay |
| Arm swing | arms X | 0.14 (async) | 1.5 | Body sway response |
| Shoulder settle | shoulders Z | 0.09 (async) | 0.6 | Breaks rigidity |
| Shoulder breathe | shoulders X | 0.18+phase | 0.3 | Micro-rise |

### AAA Design Principles

1. **Irrational frequency ratios** — 0.125, 0.09, 0.08, 0.13, 0.18 Hz have no common period
2. **Phase offsets** — motion propagates as a wave up the spine
3. **Asymmetric arms** — left/right have different phase (not mirrored)
4. **Head counter-rotation** — stabilizes gaze during breathing
5. **Breathing at 0.18 Hz** — ~11 breaths/min (calm resting adult rate)

---

## Behavior State Machine

```
IDLE (waiting mode) ──12s──► MICRO_IDLE (+ gaze wander + micro-expressions)
  │                              │
  ├─ mic on ──► LISTENING        │
  │             (gaze→camera,    │
  │              attentive nod)  │
  │                              │
  ├─ message ─► THINKING         │
  │             (gaze up-left,   │
  │              hand near chin) │
  │                              │
  └───────────► SPEAKING ◄───────┘
                (lip sync, emotion, talk gestures)
                     │
                     └─ speech ends ─► IDLE
```

| State | ProceduralAnimator Mode | Gaze | Special |
|-------|------------------------|------|---------|
| IDLE | `waiting` | Mouse follow | — |
| MICRO_IDLE | `waiting` | Random wander (6s) | Micro-expressions (5-11s) |
| LISTENING | `idle` (minimal) | Locked to camera | Periodic nod (2.5-4s) |
| THINKING | `thinking` | Drifts up-left | Hand-on-chin pose |
| SPEAKING | `talk` | Locked to camera | Lip sync + emotion |

---

## Auto-Blink

| Parameter | Value |
|-----------|-------|
| Interval | 2.5-6.5s (random) |
| Duration | 150ms |
| Morph target | `blink` (0 → 1.0 → 0) |
| Disabled during | Face tracking active |

---

## Lip Sync (Text-Driven)

| Input | VRM Viseme | Intensity | Hold |
|-------|-----------|-----------|------|
| a | `aa` | 0.35-0.75 | 1.8x |
| e, i | `ee` | 0.20-0.55 | 1.8x |
| o, u | `oh` | 0.25-0.65 | 1.8x |
| m, b, p | closed | 0 | 0.8x |
| consonants | `aa` | 0.05-0.15 | 0.8x |

Base rate: 15 chars/sec. Smoothing factor: 0.14/frame.

---

## Base Poses (9 presets)

Applied as offsets on top of the T-pose-corrected rest. Values are `[pitch, yaw, roll]` in degrees.

### lecturerNeutral (default)

| Bone | Pitch | Yaw | Roll |
|------|-------|-----|------|
| hips | 0 | 0 | 0 |
| spine | -2 | 0 | 0 |
| chest | -3 | 0 | 0 |
| head | 3 | 0 | 0 |
| leftUpperArm | 4 | 0 | 36 |
| rightUpperArm | 4 | 0 | -36 |
| leftLowerArm | 0 | -12 | 0 |
| rightLowerArm | 0 | 12 | 0 |

**Effective arm rotation:** 55 deg (rest) + 36 deg (base) = **91 deg from T-pose**.

---

## Reset Behavior

**Reset All (Pose Studio):**
1. Resets all bones to neutral (NaturalPosePlugin-corrected) pose
2. Re-captures ProceduralAnimator rest pose (clean baseline)
3. Returns to `waiting` animation mode
4. Clears active animation chip

**Reset View (viewport):**
1. Resets camera to (0, 1.4, 2.8)
2. Resets orbit controls

---

## VRMA Clip Animation (Alternative)

A pre-recorded VRoid Hub "Waiting" clip is also available:

| | Procedural (default) | VRMA Clip |
|---|---|---|
| File | Built-in code | `vendor/animations/vrma/waiting-standard.vrma` |
| Gaze tracking | Yes (reactive) | No (static forward) |
| State machine | Yes | No (just loops) |
| Lip sync | Yes | No |
| Customizable | Yes (edit frequencies) | No (fixed recording) |
| VRoid Hub match | Approximation | Exact |

---

## File Reference

| File | Role |
|------|------|
| `src/AnimationPresets.js` | All data: poses, modes, talk styles, parameters |
| `src/ProceduralAnimator.js` | Per-frame bone animation + additive compositing |
| `src/NaturalPosePlugin.js` | T-pose → natural standing correction |
| `src/BehaviorEngine.js` | State machine (IDLE/LISTENING/THINKING/SPEAKING) |
| `src/LipSyncEngine.js` | Text-driven mouth visemes |
| `src/EmotionEngine.js` | Text sentiment → facial expression |
| `src/AvatarAliveness.js` | Bootstrap/wiring layer |
| `src/PoseStudioPanel.js` | Pose Studio UI + reset behavior |
| `vendor/animations/vrma/waiting-standard.vrma` | VRoid Hub clip idle |
