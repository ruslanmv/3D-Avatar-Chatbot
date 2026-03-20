# Face Tracking - Technical Reference

This document explains the face tracking pipeline used in `src/FaceTracker.js`.
The system supports two tracking modes — **Imitate** (mirror the user's
expressions) and **Follow** (avatar watches/follows the user). Both modes share
the same MediaPipe webcam pipeline.

---

## Architecture Overview

```
                              ┌─────────────────────────┐
                              │   Settings UI toggle    │
                              │   Imitate  |  Follow    │
                              └──────┬──────────┬───────┘
                                     │          │
Webcam (640x480 @ 30fps)            │          │
  │                                  │          │
  v                                  │          │
MediaPipe FaceLandmarker (WASM)     │          │
  │                                  │          │
  ├── 52 ARKit blend shapes ────────┘          │
  │         │                                   │
  │   _mapARKitToVRM()                          │
  │         │                                   │
  │   _applyImitateMode() @ 60fps              │
  │         │                                   │
  │   VRM expressionManager                     │
  │   ProceduralAnimator.setFaceTrackingHead()  │
  │                                             │
  ├── 478 face landmarks ──────────────────────┘
  │         │
  │   nose tip (landmark #1) → screen coords
  │         │
  │   _applyFollowMode() @ 60fps
  │         │
  │   ├── Dead-zone (eyes first, head for large offsets)
  │   ├── Exponential damping (smooth head inertia)
  │   ├── Micro-saccades (tiny random eye jitter)
  │   ├── Blink-on-shift (natural blink on large gaze jumps)
  │   └── Eye leading (eyes track ahead of head)
  │         │
  │   ProceduralAnimator.setGazeOverride()
  │   BehaviorEngine eye expressions
  │
  └── facial transformation matrix
          │
    _extractHeadRotation() → yaw, pitch, roll
```

---

## Tracking Modes

### Imitate (default)

Avatar mirrors the user's facial expressions in real time. This is the
full-takeover mode:

| System                     | State    | Reason                               |
| -------------------------- | -------- | ------------------------------------ |
| BehaviorEngine expressions | Paused   | User's face drives emotions          |
| Auto-blink                 | Stopped  | User's real blinks drive blink       |
| LipSync                    | Paused   | User's mouth drives jaw/mouth shapes |
| Mouse/touch head follow    | Disabled | User's head rotation drives head     |
| Camera                     | Zoomed   | Transitions to head-level framing    |

**Data flow:** ARKit blend shapes → `_mapARKitToVRM()` → temporal lerp →
`expressionManager.setValue()` + `setFaceTrackingHead(yaw, pitch, roll)`.

### Follow

Avatar watches and follows the user's face position. Completely **additive and
non-destructive** — all AI-driven behaviors remain active:

| System                     | State      | Reason                                      |
| -------------------------- | ---------- | ------------------------------------------- |
| BehaviorEngine expressions | **Active** | AI emotions keep running naturally          |
| Auto-blink                 | **Active** | Periodic blinking continues                 |
| LipSync                    | **Active** | AI speech still drives mouth                |
| Mouse/touch head follow    | Replaced   | Face position overrides gaze direction      |
| Camera                     | Zoomed     | Same head-level framing for webcam tracking |

**Data flow:** Face landmarks → nose tip (landmark #1) → screen-space
normalization → natural gaze behaviors → `setGazeOverride({x, y})` +
`BehaviorEngine.gazeTargetYaw/Pitch`.

#### Follow Mode — Conversation Continuity

Follow mode maintains eye contact throughout the entire conversation cycle.
BehaviorEngine's state machine still runs normally (LISTENING → THINKING →
SPEAKING → IDLE), but when Follow mode is active, it yields gaze control:

| State     | Without Follow (default)            | With Follow active                     |
| --------- | ----------------------------------- | -------------------------------------- |
| LISTENING | Head locked to center, periodic nod | **Keeps watching user**, nod skipped   |
| THINKING  | Head locked, eyes drift up-left     | **Keeps watching user**, drift skipped |
| SPEAKING  | Head locked to center               | **Keeps watching user**                |
| IDLE      | Gaze released, mouse/touch resumes  | FaceTracker continues driving gaze     |

What **still works** during Follow mode conversations:

- Animation modes (`idle`, `thinking`, `talk`) — body animations play normally
- Emotions (`happy`, `surprised`, etc.) — facial expressions applied as usual
- Lip-sync — mouth shapes driven by TTS audio
- Auto-blink — periodic blinking continues
- Micro-expressions — subtle facial ticks in MICRO_IDLE

What **yields to Follow mode** (via `_isFollowGazeActive()` guard):

- `setGazeOverride()` calls in `_onEnterState()` — not locked to `{0, 0}`
- `gazeTargetYaw/Pitch` writes — not overwritten by state-specific patterns
- `_updateGaze()` eye expressions — FaceTracker sets `lookLeft/Right/Up/Down`
- `_updateThinking()` gaze drift — "look up-left" pattern skipped
- `_updateListening()` nod animation — gaze pitch nod skipped

#### Follow Mode — Natural Gaze Behaviors

Ported from `VRGazeController.js` (VR follow-me eyes, inspired by AAA NPC gaze
patterns from Half-Life: Alyx, God of War, RDR2):

| Behavior         | Description                                             | Constants                 |
| ---------------- | ------------------------------------------------------- | ------------------------- |
| Dead-zone        | Eyes move for small offsets; head only for large angles | `FOLLOW_DEAD_ZONE=0.15`   |
| Exponential damp | Smooth head inertia (never instant snap)                | `FOLLOW_DAMP_SPEED=4.0`   |
| Micro-saccades   | Tiny random eye jitter every 200-800ms                  | Offset ±0.03 X, ±0.02 Y   |
| Blink-on-shift   | Natural blink when gaze shifts significantly            | `FOLLOW_BLINK_SHIFT=0.35` |
| Eye leading      | Eyes track full target, head lags behind                | Built into dead-zone      |

#### Coordinate Mapping

The webcam image is mirrored. Face position is mapped to avatar gaze:

```
Webcam UV space (0..1)          Avatar gaze (-1..+1)
━━━━━━━━━━━━━━━━━━━━━         ━━━━━━━━━━━━━━━━━━━━━
face.x=0 (right edge)  ────→  gazeX=+1 (look right)
face.x=1 (left edge)   ────→  gazeX=-1 (look left)
face.y=0 (top edge)    ────→  gazeY=+1 (look up)
face.y=1 (bottom edge) ────→  gazeY=-1 (look down)
```

Formula: `rawX = -(faceCenterNorm.x - 0.5) * 2`

---

## Settings UI

The Face Tracking section in Settings provides:

1. **Tracking Mode** — radio selector: `Imitate | Follow`
    - Persisted in `localStorage` key `ft_mode` (values: `'imitate'` |
      `'follow'`)
    - Can be changed while tracking is stopped; takes effect on next `start()`

2. **Independent Eye Blink** — checkbox (shown only in Imitate mode)
    - Persisted in `localStorage` key `ft_independent_eyes` (values: `'true'` |
      `'false'`)

---

## VR Conversational Gaze

In VR, `VRGazeController` makes the avatar follow the user's HMD position. The
VR settings panel (Row 3) provides a 3-state **GAZE** toggle:

| Setting        | `followGaze` value | Head follows HMD? | Eyes lead during conversation? |
| -------------- | ------------------ | ----------------- | ------------------------------ |
| **GAZE: OFF**  | `false`            | No                | No                             |
| **GAZE: ON**   | `true`             | Yes               | No (thinking drift plays)      |
| **GAZE: LOCK** | `'lock'`           | Yes               | Yes (full conversational gaze) |

Default: **LOCK** (best conversational experience out of the box).

### How LOCK works

When `followGaze === 'lock'`, `VRGazeController.conversationalGaze` is set to
`true`. BehaviorEngine's `_isFollowGazeActive()` detects this and yields gaze
control during LISTENING/THINKING/SPEAKING — the same guard mechanism used by
desktop Follow mode.

```
Frame execution order in VR:

  1. ProceduralAnimator.update()
     └── BehaviorEngine.update()
         ├── _isFollowGazeActive() → true (VR + conversationalGaze)
         ├── _updateThinking() → early return (gaze drift skipped)
         └── _updateGaze() → skipped (eye expressions not overwritten)

  2. vrGazeController.update()
     ├── setGazeOverride({x, y})           ← head follows user ✓
     └── behavior.gazeTargetYaw/Pitch = …  ← eyes lead toward user ✓
```

Without LOCK (GAZE: ON), BehaviorEngine's `_updateThinking()` overwrites
`gazeTargetYaw/Pitch` with its "look up-left" drift every frame, which fights
VRGazeController's eye-leading values. The head still follows (VRGazeController
wins the last-write on `setGazeOverride`), but the eyes wander during thinking.

### What still works during LOCK

- Animation modes (`idle`, `thinking`, `talk`) — body animations play normally
- Emotions — facial expressions applied as usual
- Lip-sync — mouth shapes driven by TTS audio
- Auto-blink — periodic blinking continues
- Micro-expressions — subtle facial ticks in MICRO_IDLE

---

## Pipeline Overview (Imitate Mode)

```
Webcam (640x480 @ 30fps)
  |
  v
MediaPipe FaceLandmarker (WASM)
  |
  v
52 ARKit blend shape scores (eyeBlinkLeft, eyeBlinkRight, jawOpen, ...)
  |
  v
_mapARKitToVRM()        <-- Remap + stabilize
  |
  v
_applyLoop() @ 60fps   <-- Temporal lerp + apply to VRM
  |
  v
VRM expressionManager.setValue('blink', value)
```

---

## 1. Blink Remapping (`_remapBlink`)

### Problem

MediaPipe's ARKit `eyeBlink` scores are noisy. A relaxed open eye reads
~0.10-0.20, not 0.0. Without remapping the avatar appears to squint at rest.

### Formula

```
clamp(val, min, max) = max(min(val, max), min)
remap(val, low, high) = (clamp(val, low, high) - low) / (high - low)

blinkClosure = remap(rawEyeBlink, BLINK_LOW, BLINK_HIGH)
```

### Constants (KalidoKit MediaPipe defaults)

| Constant     | Value  | Meaning                                        |
| ------------ | ------ | ---------------------------------------------- |
| `BLINK_LOW`  | `0.35` | Scores <= this = eyes fully open (closure=0)   |
| `BLINK_HIGH` | `0.50` | Scores >= this = eyes fully closed (closure=1) |

### Visualization

```
Raw ARKit eyeBlink score:

  0.0          0.35         0.50          1.0
   |            |             |             |
   [  DEAD ZONE ]----ramp-----[ FULLY SHUT  ]
   closure = 0     0 to 1      closure = 1

Normal gaze noise (~0.10-0.20) falls entirely in the dead zone.
Only deliberate blinks (raw jumps to ~0.5-0.8) register.
```

### Source

KalidoKit `src/FaceSolver/calcEyes.ts` → `getEyeOpen()`:

- `high = 0.85`, `low = 0.55` (tfjs runtime)
- `high = 0.50`, `low = 0.35` (mediapipe runtime) **<-- we use these**

---

## 2. Eye-Wide Reduction

If the user opens their eyes wide (surprise), `eyeWide` counters blink:

```
blinkL = max(0, blinkL - eyeWideLeft * 0.6)
blinkR = max(0, blinkR - eyeWideRight * 0.6)
```

The `0.6` factor means a full eye-wide (1.0) reduces blink by 60%.

---

## 3. Blink Stabilization (`_stabilizeBlink`)

Ported from KalidoKit `src/FaceSolver/calcEyes.ts` → `stabilizeBlink()`.

### Purpose

- **L/R sync**: smooth out asymmetric noise between left and right eye
- **Head rotation compensation**: when head turns, the occluded eye mirrors the
  visible one
- **Wink preservation**: true winks (large L/R difference) are kept independent

### Algorithm

```javascript
clamp L, R to [0, 1]
diff = |L - R|
isClosing = L < 0.3 AND R < 0.3
isOpen    = L > 0.6 AND R > 0.6
isWink    = diff >= 0.8 AND NOT isClosing AND NOT isOpen

// Head rotation compensation (0.5 rad ~ 28 degrees)
if headYaw > 0.5:  return { left: R, right: R }   // right eye reliable
if headYaw < -0.5: return { left: L, right: L }    // left eye reliable

// L/R synchronization (95/5 lerp weighting)
if isWink:
    return { left: L, right: R }           // keep independent
else if R > L:
    return { left: lerp(R, L, 0.95), right: lerp(R, L, 0.95) }
else:
    return { left: lerp(R, L, 0.05), right: lerp(R, L, 0.05) }
```

The 95/5 lerp means both eyes converge to nearly the same value, eliminating the
asymmetric jitter that MediaPipe produces.

---

## 4. Temporal Lerp in Apply Loop (`_applyLoop`)

### The Key Insight (from KalidoKit `docs/script.js` → `rigFace()`)

KalidoKit does NOT just set the blink value directly. It lerps the new target
with the **current VRM blink value** (what the model is currently showing):

```javascript
// KalidoKit canonical demo (docs/script.js)
riggedFace.eye.l = lerp(
    clamp(1 - riggedFace.eye.l, 0, 1), // new blink closure target
    Blendshape.getValue(PresetName.Blink), // current VRM value
    0.5 // 50% blend
);
```

### Our Implementation

```javascript
smoothed = lerp(targetValue, em.getValue('blink'), 0.5)
         = currentVRM + (target - currentVRM) * 0.5
```

### Why This Matters - Auto Recovery

**Closing eyes** (target = 1.0):

```
frame 0: VRM=0.00 -> lerp(1.0, 0.00, 0.5) = 0.50
frame 1: VRM=0.50 -> lerp(1.0, 0.50, 0.5) = 0.75
frame 2: VRM=0.75 -> lerp(1.0, 0.75, 0.5) = 0.87
frame 3: VRM=0.87 -> lerp(1.0, 0.87, 0.5) = 0.94
```

**Opening eyes** (target = 0.0):

```
frame 0: VRM=1.00 -> lerp(0.0, 1.00, 0.5) = 0.50
frame 1: VRM=0.50 -> lerp(0.0, 0.50, 0.5) = 0.25
frame 2: VRM=0.25 -> lerp(0.0, 0.25, 0.5) = 0.12
frame 3: VRM=0.12 -> lerp(0.0, 0.12, 0.5) = 0.06
```

Eyes always recover to fully open within ~4-5 frames (~80ms at 60fps). They can
**never** get stuck closed because every frame pulls toward 0.

### lerp Definition

```
lerp(a, b, t) = a + (b - a) * t
              = a * (1-t) + b * t

When t = 0.5:  lerp(target, current, 0.5) = midpoint of target and current
```

---

## 5. Expression Modes (Imitate only)

These settings only apply when Imitate mode is selected. In Follow mode, the
avatar's expressions are driven by BehaviorEngine (AI emotions) and auto-blink.

### Default: Combined Blink (VRoid Hub style)

Only the `blink` expression is set. `blinkLeft` and `blinkRight` are skipped.
KalidoKit's canonical demo does the same
(`Blendshape.setValue(PresetName.Blink, eye.l)`).

This prevents expression conflicts on VRM models where `blink`, `blinkLeft`, and
`blinkRight` all affect the same morph targets.

### Optional: Independent Eye Blink

Enabled via Settings > Face Tracking > "Independent Eye Blink" toggle. When on,
`blinkLeft` and `blinkRight` are set independently (with the same temporal
lerp), and combined `blink` is skipped.

This allows winking but may cause visual artifacts on some VRM models.

Setting is persisted in `localStorage` key `ft_independent_eyes`.

---

## 6. Auto-Blink

Auto-blink (random periodic blinking) runs when face tracking is **off** or in
**Follow mode**. In Imitate mode, auto-blink is stopped (`stopAutoBlink()`) to
prevent conflicts with real-time blink data from the webcam.

| Mode    | Auto-blink | Reason                                       |
| ------- | ---------- | -------------------------------------------- |
| Off     | Active     | Avatar blinks naturally on its own           |
| Imitate | Stopped    | Real blinks from webcam drive blink directly |
| Follow  | Active     | No expression override — blinks keep running |

Auto-blink timing:

- **Eyes open**: 2.5 - 6.5 seconds (random)
- **Eyes closed**: 150ms

---

## 7. Constants Reference

### Imitate Mode

| Constant                   | Value  | Location       | Description                           |
| -------------------------- | ------ | -------------- | ------------------------------------- |
| `BLINK_LOW`                | `0.35` | FaceTracker.js | Dead-zone lower bound                 |
| `BLINK_HIGH`               | `0.50` | FaceTracker.js | Closure saturation upper bound        |
| `EYE_WIDE_BLINK_REDUCTION` | `0.6`  | FaceTracker.js | How much eyeWide counters blink       |
| `BLINK_STABILIZE_MAX_ROT`  | `0.5`  | FaceTracker.js | Head yaw (rad) for eye mirroring      |
| `BLEND_SHAPE_SMOOTHING`    | `0.4`  | FaceTracker.js | Lerp factor for non-blink expressions |
| `BLEND_SHAPE_EPSILON`      | `0.01` | FaceTracker.js | Noise gate threshold                  |
| Temporal lerp factor       | `0.5`  | FaceTracker.js | KalidoKit rigFace lerp for blink      |
| Stabilize wink threshold   | `0.8`  | FaceTracker.js | L/R diff for wink detection           |
| Stabilize isClosing        | `0.3`  | FaceTracker.js | Both eyes below = both closing        |
| Stabilize isOpen           | `0.6`  | FaceTracker.js | Both eyes above = both open           |

### Follow Mode

| Constant             | Value     | Location       | Description                                 |
| -------------------- | --------- | -------------- | ------------------------------------------- |
| `FOLLOW_DEAD_ZONE`   | `0.15`    | FaceTracker.js | Normalized radius — eyes only below this    |
| `FOLLOW_DAMP_SPEED`  | `4.0`     | FaceTracker.js | Exponential damping speed (higher = faster) |
| `FOLLOW_BLINK_SHIFT` | `0.35`    | FaceTracker.js | Gaze shift magnitude triggering a blink     |
| Saccade interval     | 200-800ms | FaceTracker.js | Random interval between micro-saccades      |
| Saccade offset X     | `±0.03`   | FaceTracker.js | Horizontal micro-saccade amplitude          |
| Saccade offset Y     | `±0.02`   | FaceTracker.js | Vertical micro-saccade amplitude            |

---

## 8. Troubleshooting

### Avatar squints at rest

Increase `BLINK_LOW` (e.g., `0.40`). This widens the dead zone so more noise is
filtered.

### Blink not registering / too hard to close

Decrease `BLINK_HIGH` (e.g., `0.45`). This makes the closure threshold easier to
reach.

### Eyes stay partially closed after blink

Check that blinkLeft/blinkRight are not conflicting with blink. Default mode
(Independent Eye Blink OFF) avoids this by only using combined `blink`.

### Winking doesn't work

Enable "Independent Eye Blink" in Settings > Face Tracking. The stabilize wink
threshold is `0.8` — only very pronounced winks are preserved.

### Eyes flicker / jitter

The 95/5 lerp in `_stabilizeBlink` should handle this. If still present, try
increasing the temporal lerp factor from `0.5` to `0.6` (more smoothing) in
`_applyImitateMode` where `_lerp(targetValue, currentVRM, 0.5)` is called.

### Follow mode: avatar looks the wrong direction

The webcam image is mirrored. The coordinate mapping inverts X so that if the
user moves left, the avatar looks left (toward the user). If this feels wrong,
flip the sign of `rawX` in `_applyFollowMode()`.

### Follow mode: head movement is too twitchy

Decrease `FOLLOW_DAMP_SPEED` (e.g., `2.0`). Lower values = more inertia,
smoother tracking. Or increase `FOLLOW_DEAD_ZONE` (e.g., `0.25`) so the head
only moves for larger face offsets.

### Follow mode: avatar doesn't blink

Verify auto-blink is running — in Follow mode, `_setExpressionOverride` is NOT
called, so `startAutoBlink()` should remain active. Check the browser console
for `[FaceTracker] Mode set to 'follow'` to confirm the mode is correct.

---

## 9. API Reference

```javascript
window.NEXUS_FACE_TRACKER = {
    start(),                    // Start face tracking (async, requests webcam)
    stop(),                     // Stop face tracking, restore AI-driven animation

    isActive,                   // Boolean — currently tracking?
    isInitializing,             // Boolean — loading model / requesting webcam?
    faceDetected,               // Boolean — face visible in current frame?

    mode,                       // 'imitate' | 'follow' (getter)
    setMode(mode),              // Set mode ('imitate' | 'follow')
                                // Change while stopped; takes effect on next start()

    independentEyes,            // Boolean (getter)
    setIndependentEyes(bool),   // Toggle L/R independent blink (Imitate only)

    getBlendShapes(),           // Current smoothed blend shape values (object)
    getDebugInfo(),             // Debug snapshot (active, mode, videoSize, etc.)
}
```

---

## 10. References

- [KalidoKit source (calcEyes.ts)](https://github.com/yeemachine/kalidokit/blob/main/src/FaceSolver/calcEyes.ts)
- [KalidoKit VRM demo (docs/script.js)](https://github.com/yeemachine/kalidokit/blob/main/docs/script.js)
- [KalidoKit FaceSolver (index.ts)](https://github.com/yeemachine/kalidokit/blob/main/src/FaceSolver/index.ts)
- [pixiv/ChatVRM AutoBlink](https://github.com/pixiv/ChatVRM/blob/main/src/features/emoteController/autoBlink.ts)
- [pixiv/three-vrm](https://github.com/pixiv/three-vrm)
- [MediaPipe FaceLandmarker](https://developers.google.com/mediapipe/solutions/vision/face_landmarker)
- [Eye Aspect Ratio (EAR) paper](https://peerj.com/articles/cs-943/)
