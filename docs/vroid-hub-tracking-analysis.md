# VRoid Hub Tracking Page — Complete Technical Analysis

**Target:** https://hub.vroid.com/en/characters/5777472789731313581/models/2232118447580405504/tracking
**Model:** AvatarSample_A (29,131 triangles, 91 joints, 56 morph targets, 16 materials)
**Exporter:** VRoid Studio 1.0.0

---

## 1. VRoid Hub Tracking Page — Settings Panel Breakdown

The tracking page gear icon exposes these controls:

| Section | Control | Function |
|---------|---------|----------|
| **Camera** | Device selector | Selects webcam (e.g. "Integrated Camera 5986:1196") |
| **Background** | Toggle | Enables/disables background behind avatar |
| **Avatar movement** | Toggle | Enables/disables full-body motion tracking |
| **Flip** | Toggle | Mirrors the camera horizontally |
| **Facial Expressions** | "Overwrite facial expressions" | When ON, ARKit blendshapes from camera override preset emotions |
| **Eye direction** | "Look at camera" | Forces gaze toward the webcam |
| **Emotion** | Neutral / Fun / Sorrow / Angry / Joy | Preset emotion overlays applied to the avatar |
| **Eye** | Blink (right) / Blink (left) | Manual blink triggers per eye |
| **User Definition** | Surprised | Custom expression slot (user-defined blendshape preset) |

---

## 2. Technology Stack — What VRoid Hub Uses

VRoid Hub's tracking page is a **Next.js** application (buildId: `aKBEgSgfy88iaiq1mBRa_`) that dynamically loads tracking libraries client-side. Based on industry analysis and package fingerprinting:

### Core Libraries

| Library | Role | Version/Source |
|---------|------|----------------|
| **@mediapipe/tasks-vision** | Face + Hand landmark detection (WASM, GPU) | CDN: `cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.x/wasm` |
| **@mediapipe/holistic** (legacy) or **tasks-vision** (modern) | Combined face + pose + hand tracking | Google MediaPipe |
| **KalidoKit** | Blendshape/kinematics solver (ARKit → VRM mapping) | v1.1.5, npm: `kalidokit` |
| **@pixiv/three-vrm** | VRM model loading, expression manager, humanoid rig | Pixiv official |
| **Three.js** | WebGL 3D rendering engine | r147+ |

### Detection Pipeline

```
Webcam (getUserMedia)
  │
  v
MediaPipe (WASM + GPU delegate)
  ├── FaceLandmarker: 478 landmarks + 52 ARKit blendshapes + 4x4 transform matrix
  ├── HandLandmarker: 21 landmarks per hand × 2 hands + handedness
  └── (Optional) PoseLandmarker: 33 body pose landmarks
  │
  v
KalidoKit Solvers
  ├── Face.solve()  → head rotation (yaw/pitch/roll) + blendshape values
  ├── Hand.solve()  → wrist rotation + 15 finger joint angles per hand
  └── Pose.solve()  → spine/hip/arm/leg rotations (optional)
  │
  v
@pixiv/three-vrm
  ├── expressionManager.setValue() → facial expressions / visemes
  ├── humanoid.getNormalizedBoneNode() → bone rotations
  └── lookAt → eye gaze direction
  │
  v
Three.js WebGL Renderer → Canvas
```

### Motion Assets (.vrma format)

VRoid Hub pre-loads personality-driven animations in VRMA (VRM Animation) format:

| Personality | Waiting Motion | Appearing Motion | Liked Motion |
|-------------|---------------|------------------|--------------|
| Standard | `waiting-I3CZ3FBD.vrma` | `appearing-7KKFBBJ2.vrma` | `liked-JMZZ3B47.vrma` |
| Innocent | Custom set | Custom set | Custom set |
| Cool | Custom set | Custom set | Custom set |
| + 6 more personalities | ... | ... | ... |

These are glTF 2.0 binary files with `VRMC_vrm_animation` extension containing humanoid bone keyframes + facial expression keyframes.

---

## 3. How Synchronization Works

### Face → Avatar Sync

```
Frame loop (requestAnimationFrame @ 60fps):
  │
  ├─ MediaPipe detectForVideo(videoEl, timestamp)
  │    └─ Returns: faceBlendshapes[52], facialTransformationMatrixes[4x4], faceLandmarks[478]
  │
  ├─ KalidoKit Face.solve(faceLandmarks, {runtime:'mediapipe', video:el})
  │    ├─ head: { x: pitch, y: yaw, z: roll }  (Euler radians)
  │    ├─ eye.l / eye.r: blink closure (0=open, 1=closed)
  │    ├─ brow: elevation value
  │    ├─ pupil: { x, y } gaze direction
  │    └─ mouth: { x: width, y: open, shape: {A, E, I, O, U} }
  │
  ├─ Apply to VRM:
  │    ├─ Head bone rotation: humanoid.getNormalizedBoneNode('head').rotation.set(pitch, yaw, roll)
  │    ├─ Eye expressions: expressionManager.setValue('lookLeft/Right/Up/Down', value)
  │    ├─ Blink: expressionManager.setValue('blink', closure)
  │    ├─ Mouth visemes: expressionManager.setValue('aa'/'ee'/'ih'/'oh'/'ou', value)
  │    └─ Emotions (if overwrite OFF): expressionManager.setValue('happy'/'sad'/etc, value)
  │
  └─ Temporal smoothing: lerp(target, previous, 0.4-0.5) per frame
```

### Hand → Avatar Sync

```
MediaPipe HandLandmarker (21 landmarks × 2 hands)
  │
  ├─ Landmark indices:
  │    0: Wrist
  │    1-4: Thumb (CMC → MCP → IP → TIP)
  │    5-8: Index (MCP → PIP → DIP → TIP)
  │    9-12: Middle (MCP → PIP → DIP → TIP)
  │    13-16: Ring (MCP → PIP → DIP → TIP)
  │    17-20: Little (MCP → PIP → DIP → TIP)
  │
  ├─ KalidoKit Hand.solve(landmarks, "Right"|"Left")
  │    ├─ Wrist: { x, y, z } (rotation in radians)
  │    ├─ [Side]ThumbProximal/Intermediate/Distal: { x, y, z }
  │    ├─ [Side]IndexProximal/Intermediate/Distal: { x, y, z }
  │    ├─ [Side]MiddleProximal/Intermediate/Distal: { x, y, z }
  │    ├─ [Side]RingProximal/Intermediate/Distal: { x, y, z }
  │    └─ [Side]LittleProximal/Intermediate/Distal: { x, y, z }
  │
  └─ Apply to VRM bones:
       for each finger joint:
         bone = humanoid.getNormalizedBoneNode('leftIndexProximal')
         bone.rotation.set(joint.x, joint.y, joint.z)
```

### Emotion Override Logic

```
if ("Overwrite facial expressions" === ON) {
    // Camera ARKit blendshapes drive ALL expressions
    // Preset emotion buttons are disabled
} else {
    // Preset emotion (Neutral/Fun/Sorrow/Angry/Joy) is base layer
    // Camera only drives blink + eye gaze + head rotation
    // Mouth shapes from camera are blended additively
}

if ("Look at camera" === ON) {
    // Eye gaze forced to (0, 0) = straight ahead / at camera
    // Overrides pupil tracking from MediaPipe
} else {
    // Eye gaze follows KalidoKit pupil.x/y values
}
```

---

## 4. Gap Analysis — Our Project vs VRoid Hub

### What We HAVE (implemented)

| Feature | Our Implementation | File |
|---------|-------------------|------|
| Face detection | MediaPipe FaceLandmarker (478 landmarks + 52 ARKit blendshapes) | `src/FaceTracker.js` |
| Head rotation | 4x4 matrix → Euler YXZ decomposition | `src/FaceTracker.js:429-463` |
| Eye blink | KalidoKit-compatible pipeline (thresholds 0.35/0.50, stabilization) | `src/FaceTracker.js:69-175` |
| Eye gaze (webcam) | ARKit lookUp/Down/Left/Right averaging | `src/FaceTracker.js:250-254` |
| Eye gaze (VR) | AAA-quality VR gaze with micro-saccades, blink-on-shift | `src/gltf-viewer/VRGazeController.js` |
| Mouth / lip-sync (camera) | ARKit jawOpen/mouthFunnel/mouthPucker → aa/oh/ee/ih/ou | `src/FaceTracker.js:257-261` |
| Mouth / lip-sync (TTS) | Synthetic phoneme → viseme pipeline | `src/LipSyncEngine.js` |
| Emotion detection | Text-based + ARKit composite (happy/sad/angry/surprised) | `src/EmotionEngine.js` + `src/FaceTracker.js:263-281` |
| Imitate mode | Full expression mirroring | `src/FaceTracker.js` |
| Follow mode | AAA NPC gaze (eyes-lead-head) | `src/FaceTracker.js` |
| VRM loading | @pixiv/three-vrm with humanoid rig | `src/gltf-viewer/AvatarManager.js` |
| Finger bones (procedural) | Proximal bones only, for pose presets | `src/ProceduralAnimator.js:161-171` |
| VR hand controllers | WebXR gamepad (Meta Quest mapping) | `src/gltf-viewer/VRControllers.js` |

### What We're MISSING (VRoid Hub has, we don't)

| Feature | VRoid Hub | Our Gap |
|---------|-----------|---------|
| **Camera-based hand tracking** | MediaPipe HandLandmarker (21 landmarks × 2 hands) | **NOT IMPLEMENTED** — no `HandLandmarker` initialization |
| **Hand → VRM bone mapping** | KalidoKit Hand.solve() → 30 finger bones (Proximal/Intermediate/Distal × 5 fingers × 2 hands) + 2 wrist rotations | **Only proximal bones mapped** — missing Intermediate + Distal |
| **Camera selector UI** | Device enumeration + selection dropdown | **NOT IMPLEMENTED** — uses default camera |
| **Flip toggle** | Mirror camera horizontally | **NOT IMPLEMENTED** |
| **Expression overwrite toggle** | Switch between camera-driven and preset emotions | **Partially** — Imitate mode is all-or-nothing |
| **"Look at camera" toggle** | Force eye gaze to center | **NOT IMPLEMENTED** as explicit toggle |
| **Preset emotion buttons** | Neutral/Fun/Sorrow/Angry/Joy with overlay | **Partially** — EmotionEngine has keywords but no manual UI buttons |
| **Manual blink buttons** | Per-eye blink triggers | **NOT IMPLEMENTED** |
| **User-defined expressions** | Custom blendshape slots ("Surprised") | **NOT IMPLEMENTED** |
| **Personality motions** | 9 personality types with .vrma animations | **NOT IMPLEMENTED** — we have baked clips but not VRoid personality system |
| **VRMA animation playback** | Native .vrma (VRMC_vrm_animation) loading | **Partial** — we have vrma folder in animations but no dedicated loader for VRoid personality system |

---

## 5. VRM Finger Bone Specification (Required for Hand Tracking)

The VRM humanoid spec defines 30 optional finger bones:

```
Per hand (Left/Right):
  ├── Thumb:  Proximal → Intermediate → Distal
  ├── Index:  Proximal → Intermediate → Distal
  ├── Middle: Proximal → Intermediate → Distal
  ├── Ring:   Proximal → Intermediate → Distal
  └── Little: Proximal → Intermediate → Distal

VRM bone names:
  leftThumbProximal, leftThumbIntermediate, leftThumbDistal
  leftIndexProximal, leftIndexIntermediate, leftIndexDistal
  ... (same pattern for Middle, Ring, Little)
  rightThumbProximal, rightThumbIntermediate, rightThumbDistal
  ... etc.
```

AvatarSample_A has 91 joints — enough for full finger bones.

---

## 6. Required Packages to Download/Install

### Already in project (CDN-loaded):
- `@mediapipe/tasks-vision@0.10.14` — FaceLandmarker (WASM)
- `@pixiv/three-vrm` — VRM loader
- `Three.js r147` — 3D engine

### Need to add:
```
# MediaPipe Hand Landmarker model (WASM, same package, different model file)
https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

# KalidoKit (for Hand.solve() and Pose.solve() — our FaceTracker already implements Face.solve() natively)
npm install kalidokit@1.1.5
# OR CDN: https://cdn.jsdelivr.net/npm/kalidokit@1.1.5/dist/kalidokit.es.js
```

---

## References

- [KalidoKit GitHub](https://github.com/yeemachine/kalidokit) — Face, Pose, Hand solvers
- [KalidoKit npm](https://www.npmjs.com/package/kalidokit) — v1.1.5
- [MediaPipe Hand Landmarker Web Guide](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
- [MediaPipe Face Landmarker Web Guide](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)
- [@mediapipe/tasks-vision npm](https://www.npmjs.com/package/@mediapipe/tasks-vision)
- [VRM Humanoid Bone Spec](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md)
- [VTuber Studio Tutorial (Three.js + React + VRM)](https://wawasensei.dev/tuto/vrm-avatar-with-threejs-react-three-fiber-and-mediapipe)
