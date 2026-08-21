# Pose Studio — Mouse Bone Editing fixes & Puppet Mode

## The two reported problems

1. **Handles/lines not synchronized with the body** (dots and skeleton lines
   float beside the avatar instead of sitting on the joints).
2. **Enable → disable → enable kills the feature** (the Mouse Bone Editing
   toggle stops doing anything; sometimes the whole viewport camera feels
   dead afterwards).

## Root causes found

### 1. Overlays were reading the wrong skeleton (desync)

`PoseRigMap` prefers `vrmHumanoid.getNormalizedBoneNode()`. With
three-vrm 2.x that returns the **normalized proxy rig** — a hidden helper
skeleton you *write* rotations to. Its world positions only reflect what was
written to *it*; the mesh you see is driven by the **raw** skeleton
(idle BVH clips, `vrPoseSystem` presets, the normalizer, locomotion).

`PoseGizmoOverlay` and `SkeletonLineOverlay` called `getWorldPosition()` on
those proxy nodes → dots/lines drawn at the proxy's rest/edited pose while
the body stands in its animated pose. Models where the humanoid has no
normalized rig fell back to raw bones and looked fine — which is why the bug
seemed intermittent.

**Fix:** `PoseRigMap` now also builds `visualBones` from
`getRawBoneNode()` and exposes `getVisualBone(key)`. Both overlays read all
positions (handles, joints, edges, highlights, drag anchors) from the visual
bones; *writes* still go to the same bones the sliders use, so slider sync,
undo and pose saving are untouched.

### 2. A stack of lifecycle bugs (enable/disable/enable)

- `PoseGizmoOverlay.init()` / `SkeletonLineOverlay.init()` ran once at
  `DOMContentLoaded + 100 ms`, but `NEXUS_VIEWER` is created by an **async
  module import** and is frequently not ready yet. Init bailed silently →
  renderer/scene/raycaster stayed `null` and **pointer listeners were never
  bound**. The first `enable()` then threw inside handle creation
  (`this._scene.add`), `disable()` threw on `this._renderer.domElement`, and
  the checkbox handler died mid-way — from then on the toggle did nothing.
  **Fix:** lazy `_ensureContext()` that (re)acquires the viewer and binds
  listeners exactly once; called from `init()`, retried on the
  `__NEXUS_VIEWER_READY__` promise and from every `enable()`. `enable()`
  returns `false` instead of corrupting state when the viewer isn't up, and
  the panel reverts the checkbox accordingly.
- Closing the studio (`PoseEditor.exit` is monkey-patched in
  `PoseStudioInit`) disables the gizmo **behind the checkbox's back** — on
  reopen the toggle showed ON while the gizmo was OFF, and users toggling
  off/on to "fix" it landed in the broken state above.
  **Fix:** `PoseStudioPanel.show()` re-syncs both toggles with reality and
  restores the saved preference (`localStorage: nexus-pose-mouse-edit`).
- `setExternalHandlesActive(true)` (skeleton overlay active) hid the gizmo
  spheres, but after `disable()` → `enable()` the recreated spheres came back
  visible while the flag was still set → duplicate handles.
  **Fix:** `enable()` re-applies the coordination flag.
- Toggling off (or the editor exiting) **mid-drag** left OrbitControls
  disabled and the pointer captured → camera dead, "everything stopped
  working". **Fix:** `_endDragCleanup()` releases capture and restores
  controls in `disable()`, and `pointerup` performs cleanup even when the
  module is already disabled.
- After an avatar switch the rig map still pointed at the old skeleton →
  handles froze in space and drags rotated an invisible ghost.
  **Fix:** `PoseEditor.rebindIfStale()` — both overlays call it on enable.

## New feature: Puppet Mode (natural whole-body dragging)

Toggle in Pose Studio, **on by default**: *"Puppet Mode — drag moves the
whole body naturally (IK). Off = rotate single bones."*

Grab any joint sphere (or a skeleton line) and drag: the part follows the
pointer in 3D (camera-plane target at constant depth, Blender-style) while
the rest of the chain co-operates with organic falloff — pull a hand and the
elbow bends, the shoulder rolls, the chest leans slightly. Feet recruit knee
+ hip; the head recruits neck + chest + spine.

Implementation: `src/PosePuppetIK.js` — weighted CCD over predefined chains
(3 iterations, per-joint angle clamps, reach limiting to avoid
hyperextension jitter). It rotates the **same bones the sliders write**, and
after the drag every moved bone's axis state is synced back, so sliders,
undo/redo, mirror and pose saving all keep working. Legacy single-bone
rotation remains available by switching the toggle off (preference persisted
in `localStorage: nexus-pose-puppet`).

### Frame correction inside the solver

The solver rotates the **write** bones but the handle you grab is drawn on the
**visual** bones — the same two-skeleton split as bug #1. Where the frames
diverge (anything animating the raw rig), a grab with *zero* pointer movement
would snap the limb across the gap: measured **0.50 m / 38°** on a 50°-divergent
arm, i.e. the pose jumped the instant you touched it.

`PosePuppetIK.frameOffset(rigMap, effectorKey, visualAnchorWorld)` measures the
gap at drag start; both overlays add it to every target before solving. This
makes dragging purely *relative* — the grab stays put, and pointer motion still
tracks 1:1. Covered by the `write-rig / visual-rig frame correction` tests,
which also pin the uncorrected jump so the regression can't come back silently.

## Files touched

| File | Change |
|---|---|
| `src/PosePuppetIK.js` | **new** — chains + CCD solver + screen-plane targeting |
| `src/PoseRigMap.js` | `visualBones` map + `getVisualBone()` (raw skeleton reads) |
| `src/PoseGizmoOverlay.js` | lazy context, safe enable/disable, drag cleanup, visual-bone positions, puppet drag path, multi-bone slider sync |
| `src/SkeletonLineOverlay.js` | same hardening + visual-bone positions + puppet drag for joints and lines |
| `src/PoseEditor.js` | `rebindIfStale()` for avatar switches |
| `src/PoseStudioPanel.js` | toggle persistence + resync on open, Puppet Mode toggle |
| `index.html` | one script tag for `PosePuppetIK.js` |

## Quick QA script

1. Open Pose Studio → enable Mouse Bone Editing → drag the right hand:
   elbow/shoulder/chest follow (Puppet Mode). Handles sit **on** the body.
2. Toggle off → on → off → on repeatedly: dragging keeps working every time.
3. Start a drag, toggle off mid-drag: camera orbit still works (no dead
   viewport). Toggle on: dragging works.
4. Close the studio, reopen: the toggle reflects your last choice and works
   immediately.
5. Switch avatars with the studio open, enable editing: handles attach to
   the new model.
6. Turn Puppet Mode off: classic single-bone rotation, sliders still sync.
