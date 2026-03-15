# Plan: Fix Mobile VR Black Screen & Improve AR Floor-Level Placement

## Problem Analysis

### Mobile VR Black Screen (from screenshot)

The mobile VR session shows a completely black screen with only faint grid lines
because:

1. **`scene.background = null`** — No background color is ever set on the
   THREE.Scene
2. **`alpha: true`** on the WebGLRenderer — Transparent canvas + null background
   = transparent black in VR
3. **RoomEnvironment IBL may not render on mobile** — The PMREM texture can fail
   silently on Quest/mobile WebGL, leaving the scene pitch black
4. **No mobile-specific VR handling** — The VR code path is identical for
   desktop and mobile with no fallback

### AR Floor-Level Improvement

Currently AR mode:

- Sets `scene.background = null` for passthrough (correct)
- Has hit-test for surface placement (works)
- BUT avatar doesn't automatically anchor to the detected floor
- No automatic floor detection on session start — user must manually tap to
  place
- Avatar doesn't stand at real-world floor level automatically

---

## Implementation Plan

### Step 1: Fix Mobile VR Black Screen (CRITICAL)

**Files:** `ViewerEngine.js`, `VRSupport.js`

**Changes:**

1. **Set a visible scene background on VR enter** — Set `scene.background` to a
   dark color (e.g., `0x1a1a2e`) when VR session starts, so the avatar is
   visible against a non-transparent backdrop
2. **Save and restore background** — Save the current `scene.background` before
   VR, restore it on VR exit
3. **Ensure environment IBL is re-validated** — Check if `scene.environment`
   texture is still valid when entering VR; if not, regenerate it
4. **Boost VR lighting** — Increase HemisphereLight intensity from 0.25 to 0.6
   specifically in VR mode to ensure the avatar is always well-lit even if the
   IBL fails

### Step 2: Add VR Ground Plane & Spatial Context

**Files:** `ViewerEngine.js`

**Changes:**

1. **Create a subtle VR ground grid** at y=0 — A semi-transparent grid plane
   that gives spatial reference (so user knows where they are)
2. **Show/hide the grid** — Visible during VR sessions, hidden on desktop and in
   AR (AR uses the real floor)
3. **Grid material** — Use a shader or line grid pattern (cyan/dim color
   matching the UI theme) that fades to transparent at the edges

### Step 3: Improve AR Floor-Level Placement

**Files:** `ARSupport.js`, `ViewerEngine.js`

**Goal:** Avatar appears in your room, standing on your actual floor, at
real-world scale.

**Changes:**

1. **Auto-detect floor on AR session start** — Use the existing hit-test
   infrastructure but start it immediately on session start instead of waiting
   for user interaction
2. **Auto-place avatar on first floor hit** — When the first valid horizontal
   surface is detected, automatically move the avatar to that Y position. Store
   this as `floorY`
3. **Floor-anchor the avatar** — Keep avatar's feet at `floorY` so it doesn't
   float
4. **Set avatar to real-world scale (~1.0)** — Don't rescale avatar in AR; let
   it appear at natural GLB scale (most humanoid avatars are ~1.6-1.8m)
5. **Add `light-estimation`** to AR optionalFeatures — So avatar lighting
   matches the real room ambience
6. **Auto-place shadow plane** at detected floor Y — Makes avatar look grounded

### Step 4: VR Session Configuration Improvements

**Files:** `VRSupport.js`

**Changes:**

1. **Add `'layers'` to optionalFeatures** — Explicit XRWebGLLayer configuration
   helps some mobile browsers render correctly
2. **Set `XRWebGLLayer` options** — Configure `alpha: false` on the XR layer
   specifically (even though the renderer canvas has alpha:true for desktop) to
   ensure opaque VR rendering
3. **Fallback reference space** — If `'local-floor'` is not supported,
   gracefully fall back to `'local'` with a manual height offset

### Step 5: Mobile VR Performance Optimizations

**Files:** `MobileSupport.js`, `ViewerEngine.js`

**Changes:**

1. **Detect Quest/mobile entering VR** — Lower pixel ratio to 1.0 during VR on
   Quest for performance
2. **Disable shadow casting in VR on mobile** — Saves GPU on low-end mobile
   headsets
3. **Restore settings on VR exit**

---

## File Changes Summary

| File                               | Changes                                                                    | Risk |
| ---------------------------------- | -------------------------------------------------------------------------- | ---- |
| `src/gltf-viewer/ViewerEngine.js`  | VR background, VR ground grid, VR lighting boost, AR floor event handler   | Low  |
| `src/gltf-viewer/VRSupport.js`     | XRWebGLLayer alpha:false, save/restore background, 'layers' feature        | Low  |
| `src/gltf-viewer/ARSupport.js`     | Auto floor detection, light-estimation, auto-place avatar, floor-anchoring | Low  |
| `src/gltf-viewer/MobileSupport.js` | Quest VR pixel ratio + shadow optimizations                                | Low  |

## Execution Order

1. **Step 1** — Fix VR black screen (highest priority, fixes the screenshot
   issue)
2. **Step 4** — VR session config (XRWebGLLayer alpha:false, complements Step 1)
3. **Step 2** — VR ground grid (spatial context)
4. **Step 3** — AR floor-level placement (improved AR experience)
5. **Step 5** — Mobile optimizations (performance polish)

## Expected Outcome

- **VR on mobile:** Dark space-themed background with visible avatar, ground
  grid for spatial reference, proper lighting
- **AR on mobile:** Avatar auto-placed on your real floor, shadows grounded at
  floor level, natural real-world scale, room-matched lighting
- **Desktop:** No visual changes (background remains null for environment IBL
  rendering)
