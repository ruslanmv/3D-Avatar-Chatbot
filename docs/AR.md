# AR & Passthrough — Architecture Guide

> How augmented reality works in 3D Avatar Chatbot: from button click to avatar standing on your real floor.

## Table of Contents

- [Overview](#overview)
- [Entry Points — 3 Ways to Enter AR](#entry-points--3-ways-to-enter-ar)
- [AR Session Lifecycle](#ar-session-lifecycle)
- [How Passthrough Works](#how-passthrough-works)
- [VR Passthrough Toggle (Mid-Session)](#vr-passthrough-toggle-mid-session)
- [The 4 New AR/MR Modules](#the-4-new-armr-modules)
- [Module Comparison Table](#module-comparison-table)
- [Architecture Diagram](#architecture-diagram)
- [Key Files Reference](#key-files-reference)

---

## Overview

The app supports three AR modes depending on the device:

| Device | AR Mode | Technology |
|--------|---------|------------|
| **Meta Quest 3/Pro** | WebXR `immersive-ar` with full passthrough | Camera passthrough + WebXR hit-test, plane detection, mesh detection |
| **Desktop browser** | QR code redirect to mobile AR | ModelViewerAR generates a QR that opens the model on a phone |
| **iOS / Android** | Native AR viewers | AR Quick Look (iOS) or Scene Viewer (Android) via `<model-viewer>` |

---

## Entry Points — 3 Ways to Enter AR

```
User Interface
├── [ENTER AR] button          ← ARSupport.js creates this
│   │                            ModelViewerAR enhances it (desktop → QR, mobile → Scene Viewer)
│   │
│   ├── On Quest 3/Pro         → ARSupport.toggleAR() → immersive-ar session
│   ├── On Desktop             → ModelViewerAR QR code modal (scan with phone)
│   └── On iOS/Android         → ModelViewerAR → AR Quick Look / Scene Viewer
│
├── [ENTER VR] button          ← VRSupport.js (VR only, but supports passthrough toggle)
│
└── QR code scan               ← ModelViewerAR.checkAutoLaunchAR() on page load
```

### Quest 3/Pro (Full WebXR AR)

Clicking **ENTER AR** calls `ARSupport.toggleAR()`, which requests an `immersive-ar` WebXR session with the following features:

- **Required:** `local-floor`
- **Optional:** `hit-test`, `plane-detection`, `mesh-detection`, `anchors`, `hand-tracking`, `camera-access`, `light-estimation`, `layers`, `depth-sensing`

### Desktop (QR Code Redirect)

On desktop browsers without WebXR, `ModelViewerAR` enhances the AR button to show a QR code modal. Scanning the QR opens the model URL on a phone, which then launches the native AR viewer.

### Mobile (Native AR Viewers)

On iOS, the app exports a USDZ file and launches **AR Quick Look**. On Android, it uses Google's **Scene Viewer** via an intent URL. Both provide a native "place object in your room" experience without WebXR.

---

## AR Session Lifecycle

Here is the complete flow when a user clicks **ENTER AR** on a Quest 3:

```
User clicks "ENTER AR" on Quest 3
│
├─ ARSupport.toggleAR()
│  ├─ Checks VR not active (can't have both)
│  ├─ Requests immersive-ar session with features listed above
│  └─ renderer.xr.setSession(session)
│
├─ ARSupport.onSessionStart()              [automatic — renderer fires 'sessionstart']
│  ├─ scene.background = null              (transparent → passthrough visible)
│  ├─ toneMappingExposure = 0.7            (dim virtual lighting to match real world)
│  ├─ Creates reticle (green ring)         (surface placement indicator)
│  ├─ Creates shadow plane                 (avatar shadow on real floor)
│  └─ Dispatches 'ar-session-start'        ← THIS IS THE KEY EVENT
│
├─ ViewerEngine hears 'ar-session-start'
│  ├─ Disables post-processing             (XR needs direct framebuffer)
│  ├─ Disables orbit controls
│  ├─ renderer.setClearColor(0,0,0, 0)     (transparent clear → passthrough)
│  ├─ Activates PassthroughEnhancer:
│  │    ├─ Contact shadow (soft blob under feet)
│  │    ├─ Light estimation (match real-world lighting)
│  │    └─ Depth sensing (real objects occlude virtual ones)
│  └─ Positions avatar at floor (y=0)
│
├─ XRModuleRegistry hears 'ar-session-start'
│  ├─ Lazy import('./MRSceneUnderstanding.js')
│  │    └─ Loads RATK, detects room planes/meshes
│  ├─ Lazy import('./AvatarGrounding.js')
│  │    └─ Spring-damped floor tracking from RATK data
│  ├─ mrScene.activate()
│  └─ avatarGrounding.activate(avatarRoot, mrScene)
│
└─ RENDER LOOP (per frame while AR active)
   ├─ ARSupport.updateHitTest()            (basic: ray → surface point)
   ├─ PassthroughEnhancer.update()         (contact shadow + light estimation)
   └─ xrModules.update(dt, frame)          (RATK planes + avatar grounding)
```

### Session End

When the user exits AR (button click or headset removal):

1. `ARSupport` dispatches `'ar-session-end'`
2. `ViewerEngine` restores desktop state (post-processing, orbit controls, background, camera)
3. `XRModuleRegistry` deactivates `MRSceneUnderstanding` and `AvatarGrounding`
4. `PassthroughEnhancer` restores saved lighting and removes contact shadow

---

## How Passthrough Works

Passthrough is **automatic** on Quest 3 when you use `immersive-ar`. The browser activates the color cameras, and your rendered scene composites on top of the camera feed. Transparent pixels (alpha=0) show the real world through.

### The 4 Configuration Steps

| Step | File | Line | What It Does |
|------|------|------|-------------|
| 1 | `ARSupport.js` | 186 | Session mode = `'immersive-ar'` (triggers passthrough on Quest) |
| 2 | `ARSupport.js` | 223 | `scene.background = null` (no skybox blocking the view) |
| 3 | `VRSupport.js` | 175 | `XRWebGLLayer` created with `alpha: true` (framebuffer supports transparency) |
| 4 | `ViewerEngine.js` | 628 | `renderer.setClearColor(0x000000, 0)` (clear with alpha=0) |

**Result:** The avatar renders solid, everything else is transparent, and you see your real room behind it.

### Why `alpha: true` Matters

```js
// VRSupport.js line 175-182
const xrLayer = new XRWebGLLayer(session, gl, { alpha: true });
```

This creates the WebGL framebuffer with an alpha channel from the very start of the XR session. The Quest 3 compositor shows camera passthrough wherever pixels are transparent (alpha=0). This means:

- In **VR mode** with an opaque background color: alpha=1 everywhere, no passthrough visible
- In **AR mode** or **VR passthrough mode**: alpha=0 for empty space, passthrough visible
- **No session restart needed** — the alpha channel is always there, just unused until toggled

---

## VR Passthrough Toggle (Mid-Session)

You can enable passthrough (see your real room) **without leaving VR**. There are 3 methods, all accessible from the in-VR settings panel:

### Method 1: BG Button (Cycle)

The **BG** button in VR Chat Panel settings row 2 cycles through background modes:

```
black → blue → void → passthrough → black (repeat)
```

When you reach "passthrough" (`VRChatPanel.js:2327`):

1. `vrBackground = 'passthrough'` dispatched as `vr-setting-changed` event
2. `ViewerEngine` receives it (`ViewerEngine.js:554`)
3. Sets `scene.background = null` (removes skybox)
4. Sets `renderer.setClearColor(0x000000, 0)` (alpha=0 → transparent pixels)
5. Hides VR ground grid
6. Activates `PassthroughEnhancer` (contact shadow + light estimation)

**Result:** Your real room shows through transparent pixels. The avatar stays solid.

### Method 2: VIEW Button (VR/PASS Toggle)

The **VIEW** button (`VRChatPanel.js:1892-1901`) provides a direct toggle:

- Shows **"VR"** or **"PASS"**
- Toggles `sessionMode` between `'vr'` and `'ar'`
- Only enabled if `arSupported = true` on the device

### Method 3: PLACE Button (One-Tap Combo)

The **PLACE** button (`VRChatPanel.js:2518-2578`) is the most powerful — one tap does three things simultaneously:

```
PLACE ON:
  1. Enable passthrough         (vrBackground → 'passthrough')
  2. Apply sitting pose         (avatar sits down)
  3. Enable puppet mode         (grab avatar to position on real furniture)

PLACE OFF:
  1. Restore black background
  2. Reset to standing pose
  3. Disable puppet mode
```

This lets you place the avatar on your real couch or table with a single button press.

### VR Passthrough Flow

```
User in VR (opaque black background)
    │
    ├─ Tap [BG] button until "PASS"
    │   OR tap [PLACE] button
    │
    ├─ VRChatPanel dispatches 'vr-setting-changed' { vrBackground: 'passthrough' }
    │
    ├─ ViewerEngine.js receives event (line 551-563)
    │   ├─ scene.background = null
    │   ├─ clearColor alpha = 0
    │   ├─ Hide ground grid
    │   └─ PassthroughEnhancer.activate()
    │       ├─ Contact shadow under avatar feet
    │       ├─ Light estimation (match room brightness)
    │       └─ Depth sensing (real objects occlude avatar)
    │
    └─ Quest 3 compositor: transparent pixels → camera feed
       Avatar renders solid on top of your real room
```

---

## The 4 New AR/MR Modules

These modules are loaded lazily by `XRModuleRegistry` — zero boot cost, zero risk to existing production systems.

### 1. MRSceneUnderstanding.js — Room-Aware Scene Detection

**What it does:** Uses Meta's RATK (Reality Accelerator Toolkit) to detect real-world surfaces — floors, walls, tables, couches — as 3D meshes inside the Three.js scene.

**Why it was added:** The existing `ARSupport.js` has basic hit-test (a single ray → surface point). `MRSceneUnderstanding` gives you the **entire room model** — all planes, all furniture, labeled semantically (floor, wall, table, couch). This enables:

- Avatar standing on your real table
- Occlusion (avatar hidden behind your real couch)
- Collision with real walls

**How it complements existing code:** `ARSupport.updateHitTest()` finds ONE surface point per frame (where the controller ray hits). `MRSceneUnderstanding` gives you ALL detected surfaces simultaneously with semantic labels. Hit-test is for pointing; scene understanding is for the full room.

### 2. AvatarGrounding.js — Spring-Damped Floor Placement

**What it does:** Takes floor plane data from `MRSceneUnderstanding` and smoothly adjusts the avatar's Y position to match the real floor. Uses spring-damping so there's no jarring snap.

**Why it was added:** The existing production has two simpler approaches:

- `ARSupport.floorY` — a single Y value from the first hit-test detection (one-shot, no updates)
- `PassthroughEnhancer.contactShadow` — a visual shadow blob that follows the avatar (cosmetic only, doesn't move the avatar)

`AvatarGrounding` is the **actual physics layer** — it continuously tracks the floor plane and adjusts the avatar position with smooth spring damping. If you walk from a room with a higher floor to a lower one, the avatar follows smoothly.

### 3. IKWorkerBridge.js — Off-Main-Thread IK Solving

**What it does:** Moves the CCD-IK math (12 iterations x 4-6 bones per chain) off the render thread into a Web Worker.

**Why it was added:** `VRPoseSystem.solveCCDIK()` runs on the main thread. At 72fps on Quest 3, each frame budget is ~13.8ms. IK solving can take 1-3ms, which is significant. Moving it to a worker keeps the render thread free for head-tracking latency (critical for VR comfort — dropped frames cause nausea).

**Transparent fallback:** If the worker fails to load, `VRPoseSystem` keeps using its on-thread solver. Zero risk.

### 4. ik-solver.worker.js — The Actual Web Worker

**What it does:** Pure math CCD-IK solver with no Three.js dependency. Receives bone chain data via `postMessage`, solves IK, returns quaternions.

**Why it's a separate file:** Web Workers can't import Three.js (no DOM access). So the IK math was extracted into a standalone file that operates on raw arrays and quaternion values.

---

## Module Comparison Table

| Module | Role | Overlaps with | Relationship |
|--------|------|--------------|-------------|
| `MRSceneUnderstanding.js` | RATK planes/mesh/anchors | `ARSupport.updateHitTest()` (basic) | Complements — hit-test for pointing, RATK for full room model |
| `AvatarGrounding.js` | Room-aware floor placement | `ARSupport.floorY` + `PassthroughEnhancer.contactShadow` | Replaces one-shot floor + cosmetic shadow with continuous spring-damped tracking |
| `IKWorkerBridge.js` | Off-thread IK solving | `VRPoseSystem.solveCCDIK()` (on-thread) | Performance upgrade — same math, different thread |
| `ik-solver.worker.js` | Web Worker for IK | N/A | Pure math extraction, no Three.js dependency |

---

## Architecture Diagram

### How XRModuleRegistry Bridges New and Existing Systems

```
EXISTING (untouched)                    NEW (additive)                NEW MODULES
─────────────────────                   ──────────────                ───────────
'ar-session-start' ───────────────────→ XRModuleRegistry ──→ MRSceneUnderstanding
                                              │                (RATK room model)
'ar-session-end'   ───────────────────→       │            ──→ AvatarGrounding
                                              │                (spring floor tracking)
'vr-session-start' ───────────────────→       │            ──→ IKWorkerBridge
                                              │                (off-thread IK)
'vr-session-end'   ───────────────────→       │
                                              │
                                     update(dt, frame) ← called from render loop
```

### Fallback Guarantee

If any new module fails to load, the existing production systems continue working unchanged:

| Failure | Fallback |
|---------|----------|
| `MRSceneUnderstanding` import fails | `ARSupport.updateHitTest()` continues providing basic surface detection |
| `AvatarGrounding` import fails | `ARSupport.floorY` + `PassthroughEnhancer.contactShadow` remain active |
| `IKWorkerBridge` / worker fails | `VRPoseSystem.solveCCDIK()` continues solving on the main thread |
| `XRModuleRegistry` itself fails | All existing VR/AR systems are completely independent |

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/gltf-viewer/ARSupport.js` | Core AR session management, hit-test, reticle, shadow plane |
| `src/gltf-viewer/VRSupport.js` | VR session management, XRWebGLLayer with `alpha: true` |
| `src/gltf-viewer/ViewerEngine.js` | Central orchestrator — handles all XR events and state transitions |
| `src/gltf-viewer/PassthroughEnhancer.js` | Contact shadow, light estimation, depth sensing for AR/passthrough |
| `src/gltf-viewer/ModelViewerAR.js` | Desktop QR code + mobile native AR (Quick Look / Scene Viewer) |
| `src/gltf-viewer/VRChatPanel.js` | In-VR settings panel (BG, VIEW, PLACE buttons) |
| `src/gltf-viewer/XRModuleRegistry.js` | Event-driven lazy loader for the 4 new AR/MR modules |
| `src/gltf-viewer/MRSceneUnderstanding.js` | RATK-based room detection (planes, meshes, semantic labels) |
| `src/gltf-viewer/AvatarGrounding.js` | Spring-damped floor tracking from RATK data |
| `src/gltf-viewer/IKWorkerBridge.js` | Main-thread bridge to the IK Web Worker |
| `workers/ik-solver.worker.js` | Pure math CCD-IK solver (no Three.js dependency) |
