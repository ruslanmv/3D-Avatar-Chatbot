# Face Tracking - Technical Reference

This document explains the blink detection pipeline used in `src/FaceTracker.js`.
The implementation is ported from [KalidoKit](https://github.com/yeemachine/kalidokit),
the open-source blendshape solver used by VRoid Hub, Kalidoface 3D, and other VTuber apps.

---

## Pipeline Overview

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
MediaPipe's ARKit `eyeBlink` scores are noisy. A relaxed open eye reads ~0.10-0.20,
not 0.0. Without remapping the avatar appears to squint at rest.

### Formula

```
clamp(val, min, max) = max(min(val, max), min)
remap(val, low, high) = (clamp(val, low, high) - low) / (high - low)

blinkClosure = remap(rawEyeBlink, BLINK_LOW, BLINK_HIGH)
```

### Constants (KalidoKit MediaPipe defaults)

| Constant     | Value  | Meaning                                      |
|-------------|--------|----------------------------------------------|
| `BLINK_LOW` | `0.35` | Scores <= this = eyes fully open (closure=0)  |
| `BLINK_HIGH`| `0.50` | Scores >= this = eyes fully closed (closure=1)|

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
- **Head rotation compensation**: when head turns, the occluded eye mirrors the visible one
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

The 95/5 lerp means both eyes converge to nearly the same value,
eliminating the asymmetric jitter that MediaPipe produces.

---

## 4. Temporal Lerp in Apply Loop (`_applyLoop`)

### The Key Insight (from KalidoKit `docs/script.js` → `rigFace()`)

KalidoKit does NOT just set the blink value directly. It lerps the new target
with the **current VRM blink value** (what the model is currently showing):

```javascript
// KalidoKit canonical demo (docs/script.js)
riggedFace.eye.l = lerp(
    clamp(1 - riggedFace.eye.l, 0, 1),     // new blink closure target
    Blendshape.getValue(PresetName.Blink),   // current VRM value
    0.5                                       // 50% blend
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

Eyes always recover to fully open within ~4-5 frames (~80ms at 60fps).
They can **never** get stuck closed because every frame pulls toward 0.

### lerp Definition

```
lerp(a, b, t) = a + (b - a) * t
              = a * (1-t) + b * t

When t = 0.5:  lerp(target, current, 0.5) = midpoint of target and current
```

---

## 5. Expression Modes

### Default: Combined Blink (VRoid Hub style)

Only the `blink` expression is set. `blinkLeft` and `blinkRight` are skipped.
KalidoKit's canonical demo does the same (`Blendshape.setValue(PresetName.Blink, eye.l)`).

This prevents expression conflicts on VRM models where `blink`, `blinkLeft`,
and `blinkRight` all affect the same morph targets.

### Optional: Independent Eye Blink

Enabled via Settings > Face Tracking > "Independent Eye Blink" toggle.
When on, `blinkLeft` and `blinkRight` are set independently (with the same
temporal lerp), and combined `blink` is skipped.

This allows winking but may cause visual artifacts on some VRM models.

Setting is persisted in `localStorage` key `ft_independent_eyes`.

---

## 6. Auto-Blink

Auto-blink (random periodic blinking) runs when face tracking is **off**.
When face tracking starts, `stopAutoBlink()` is called. When it stops,
`startAutoBlink()` resumes.

Auto-blink timing:
- **Eyes open**: 2.5 - 6.5 seconds (random)
- **Eyes closed**: 150ms

---

## 7. Constants Reference

| Constant                  | Value  | Location       | Description                              |
|--------------------------|--------|----------------|------------------------------------------|
| `BLINK_LOW`              | `0.35` | FaceTracker.js | Dead-zone lower bound                    |
| `BLINK_HIGH`             | `0.50` | FaceTracker.js | Closure saturation upper bound           |
| `EYE_WIDE_BLINK_REDUCTION`| `0.6` | FaceTracker.js | How much eyeWide counters blink          |
| `BLINK_STABILIZE_MAX_ROT`| `0.5`  | FaceTracker.js | Head yaw (rad) for eye mirroring         |
| `BLEND_SHAPE_SMOOTHING`  | `0.4`  | FaceTracker.js | Lerp factor for non-blink expressions    |
| `BLEND_SHAPE_EPSILON`    | `0.01` | FaceTracker.js | Noise gate threshold                     |
| Temporal lerp factor     | `0.5`  | FaceTracker.js | KalidoKit rigFace lerp for blink         |
| Stabilize wink threshold | `0.8`  | FaceTracker.js | L/R diff for wink detection              |
| Stabilize isClosing      | `0.3`  | FaceTracker.js | Both eyes below = both closing           |
| Stabilize isOpen          | `0.6`  | FaceTracker.js | Both eyes above = both open              |

---

## 8. Troubleshooting

### Avatar squints at rest
Increase `BLINK_LOW` (e.g., `0.40`). This widens the dead zone so more noise is filtered.

### Blink not registering / too hard to close
Decrease `BLINK_HIGH` (e.g., `0.45`). This makes the closure threshold easier to reach.

### Eyes stay partially closed after blink
Check that blinkLeft/blinkRight are not conflicting with blink.
Default mode (Independent Eye Blink OFF) avoids this by only using combined `blink`.

### Winking doesn't work
Enable "Independent Eye Blink" in Settings > Face Tracking.
The stabilize wink threshold is `0.8` — only very pronounced winks are preserved.

### Eyes flicker / jitter
The 95/5 lerp in `_stabilizeBlink` should handle this. If still present,
try increasing the temporal lerp factor from `0.5` to `0.6` (more smoothing)
in `_applyLoop` where `_lerp(targetValue, currentVRM, 0.5)` is called.

---

## 9. References

- [KalidoKit source (calcEyes.ts)](https://github.com/yeemachine/kalidokit/blob/main/src/FaceSolver/calcEyes.ts)
- [KalidoKit VRM demo (docs/script.js)](https://github.com/yeemachine/kalidokit/blob/main/docs/script.js)
- [KalidoKit FaceSolver (index.ts)](https://github.com/yeemachine/kalidokit/blob/main/src/FaceSolver/index.ts)
- [pixiv/ChatVRM AutoBlink](https://github.com/pixiv/ChatVRM/blob/main/src/features/emoteController/autoBlink.ts)
- [pixiv/three-vrm](https://github.com/pixiv/three-vrm)
- [MediaPipe FaceLandmarker](https://developers.google.com/mediapipe/solutions/vision/face_landmarker)
- [Eye Aspect Ratio (EAR) paper](https://peerj.com/articles/cs-943/)
