# Living Worlds walking: she walks a path, never through the furniture (LW6)

Status: **design**, 2026-11-18, on `claude/gestures-quest-mobile` (§9).
Nothing here is implemented yet. This fills in
the "LW6 — optional walking" line of `docs/LIVING_WORLDS.md`, which until now
said only: _measured connection/door graph + baked navigation mesh +
avatar-only walking … In VR, prefer user-controlled teleport/blink and stable
headset position; never glide the world or force the user viewpoint because an
LLM proposed a walk._ That sentence stays the rule; this document is how.

## 1. The goal, and what must never happen

When the person says "go to the sofa" or points the controller at the floor and
says "go here", the avatar works out a route through the room, turns and walks
it, and stops where she was sent, facing the person. Measured on a Meta Quest 3
it costs nothing the frame budget notices.

What must never happen, in order of how bad it looks:

1. **Her body passes through a wall, a table, a bed or a door.** The whole
   point. A straight-line walk (what `AvatarLocomotionSystem.walkToPoint` does
   today, and what `TeleportArcPointer` feeds it with a hit on the plane
   `y = 0`, not on the scene) does exactly this in any room with furniture.
2. **The person's view moves because she walked.** In a headset that is the
   fastest way to make someone sick. The world and the person's viewpoint stay
   still; only she moves.
3. **She walks through the person.** In VR the person is a body in the room,
   and they move physically.
4. **She "arrives" where she cannot be.** The conversation says she is by the
   window while she is stuck on a chair leg. Arrival is the renderer's answer,
   as for LW3's `goToSpot`, never a sentence.
5. **Moonwalking.** Feet sliding because the clip and the root disagree about
   speed. It reads as broken even when the path is perfect.

## 2. What the industry does, and what we take from it

Every major engine (Unreal, Unity, Godot, and most proprietary ones) answers
"NPC must not overlap walls" with the same stack. Each layer catches what the
one above misses:

| Layer                                                                          | Industry standard                                      | Here                                                                                                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Walkable surface, **eroded by the agent radius**                               | Recast navmesh, baked offline                          | **Yes** — baked by a tool, per scene file, like the spots                                                                         |
| Path search                                                                    | A\* over navmesh polygons                              | **Yes** — pure JS, a few hundred polygons                                                                                         |
| Path straightening                                                             | Funnel / string-pulling (Detour `findStraightPath`)    | **Yes** — Simple Stupid Funnel                                                                                                    |
| Constrained movement each frame                                                | Detour `moveAlongSurface`, UE "project to navmesh"     | **Yes** — the hard guarantee                                                                                                      |
| Local avoidance                                                                | Detour Crowd / RVO / ORCA for many agents              | **Only the person**, as one moving disc. One agent needs no crowd solver, and RVO is known to push agents off the navmesh         |
| Capsule collider + move-and-slide                                              | Character controller, physics engine                   | **No** at runtime. The navmesh already encodes the capsule; a physics engine on Quest costs 1–2 MB of wasm and a per-frame step   |
| Root motion clamped by the collider                                            | UE: capsule follows root motion                        | **Root driven by code**, clip in place, playback rate matched to speed                                                            |
| Steering whiskers / context steering                                           | Cheap fallback without a navmesh                       | **No.** Gets stuck behind big obstacles; we always have a navmesh or we blink                                                     |
| Offline validation of content                                                  | Navmesh debug draw, automated walk tests               | **Yes** — top-down review image, reachability written into the spot files, a headless walk test                                   |

The one rule every engine's documentation and forums agree on: **the navmesh's
agent radius must equal (or slightly exceed) the body radius**. Smaller, and
she paths into corners and clips them; much larger, and doors close. Our body
radius is already measured and written down: `measure-spots.mjs` checks
`bodyRadius: 0.32` at four heights. The navmesh uses the same number, from the
same place, so a spot and a path can never disagree about how wide she is.

## 3. Architecture

```
 OFFLINE (Node, tools/vr/, never shipped)              RUNTIME (browser, Quest 3)
 ───────────────────────────────────────              ──────────────────────────────────────────────

 scenes/<x>.glb ──► bake-navmesh.mjs                   "go to the sofa"   arc pointer hit
   (same loader,      Recast (recast-navigation,        │ WorldPresence     │ TeleportArcPointer
    three r147,       MIT, devDependency)               ▼                   ▼
    double-sided)     radius 0.32, height 1.75     ┌──────────────────────────────────┐
        │                                          │ walkTo → NavWalk (the one entry)  │
        ▼                                          │  target → NavQuery.closestPoint   │
 assets/vr-worlds/nav/<x>.nav.json ───────────────►│  path  ← NavQuery.findPath        │
   polygons + adjacency + sha256                   │  if none → LW3 goToSpot (blink)   │
        │                                          └───────────────┬──────────────────┘
        ▼                                                          ▼
 measure-spots.mjs (v6): every spot                ┌──────────────────────────────────┐
   must lie on the navmesh, and the                │ PathFollower (pure, per frame)    │
   spot file records which spots                   │  look-ahead, arrive, turn rate    │
   reach which (`reach`)                           │  NavQuery.moveAlongSurface ◄──────┼── hard clamp
        │                                          │  person disc: wait / re-path      │
        ▼                                          └───────────────┬──────────────────┘
 tools/vr/nav-shots.mjs: top-down PNG                              ▼
   of navmesh over the floor plan,                 AvatarLocomotionSystem (states, clips,
   spots and paths drawn — look at it              playback rate = speed / clip speed)
```

### 3.1 Bake offline, not in the headset

`tools/vr/bake-navmesh.mjs [scene]` loads the GLB exactly as `measure-spots.mjs`
does (vendored three r147, headless Chromium, double-sided), collects the
triangles of every node that is not marked decorative, and runs Recast through
`recast-navigation` (`@recast-navigation/generators`, MIT — compatible with
Apache-2.0; Recast itself is zlib). It writes
`assets/vr-worlds/nav/<scene-stem>.nav.json`:

```json
{
    "schemaVersion": 1,
    "scene": "scenes/pixel-flat-home.glb",
    "sha256": "…",
    "tool": { "name": "tools/vr/bake-navmesh.mjs", "version": 1, "params": { "…": "…" } },
    "agent": { "radius": 0.32, "height": 1.75, "maxClimb": 0.18, "maxSlopeDeg": 35 },
    "verts": [[x, y, z], "…"],
    "polys": [{ "v": [0, 1, 2, 3], "n": [-1, 4, 7, -1] }],
    "bounds": [[minX, minY, minZ], [maxX, maxY, maxZ]],
    "spotsSha256": "…",
    "spots": { "sofa": { "poly": 12, "point": [x, y, z] } },
    "reach": { "sofa": { "kitchen": 4.8, "window": 2.1 } }
}
```

Why offline:

- **Quest 3 CPU.** A Recast build of a furnished room is tens to hundreds of ms
  on a desktop and several times that in Quest's browser, plus the wasm module
  (`@recast-navigation/wasm` is ~2 MB unpacked) and its heap. Paid once on a
  developer machine, it costs the headset nothing.
- **Same discipline as the spots.** A navmesh is measured data. It records the
  source file's SHA-256, a test re-hashes it, and a changed model must be
  re-baked. A navmesh belongs to a **scene file**, not a world id, exactly like
  spots: where a phone or Quest world uses a different model it gets its own
  bake, and where two worlds share one file (the `apartment` and
  `bedroom-light` worlds both use `scenes/pixel-flat-home.glb`) one bake
  serves both. Coordinates never cross files.
- **Reviewable.** `nav-shots.mjs` draws the navmesh over a top-down render of
  the floor, with every spot and the path between each reachable pair. The
  motion work taught us that numbers miss what a picture shows; look at it.

Parameters (Recast names), chosen for a person-sized agent in rooms:

| Param                  | Value                    | Why                                                                                          |
| ---------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `walkableRadius`       | 0.32 m (`ceil(r / cs)`)  | The body radius `measure-spots` already uses                                                 |
| `cs` (cell size)       | 0.05 m                   | Rooms have 0.8 m doors; at 0.1 m a door loses up to a cell per side and can close            |
| `ch` (cell height)     | 0.05 m                   |                                                                                              |
| `walkableHeight`       | 1.75 m                   | Her height with margin; refuses to route under a table or a loft bed                         |
| `walkableClimb`        | 0.18 m                   | One stair riser; rugs and thresholds are fine, a bed is not                                  |
| `walkableSlopeAngle`   | 35°                      | Stairs and ramps yes, sofa backs no                                                          |
| `maxSimplificationError` | 0.6 m … tested         | Few, large polygons; checked against the 0.32 erosion in the review image                    |
| `minRegionArea`        | 1 m²                     | Drops islands on table tops and window sills                                                 |

Only the **floor region connected to the spots** is kept: a polygon island on a
counter top is not a place to walk. The bake refuses (exit non-zero, nothing
written) if any verified spot is not on the kept region.

### 3.2 Spots learn who they can reach

The bake reads the scene's spot file and writes reachability **into the
`.nav.json`**, not into the spot file: for each verified spot, the polygon it
stands on and `reach: { kitchen: 4.8, window: 2.1, … }` (path length in
metres). It records the spot file's SHA-256 next to the scene's, so a
re-measured spot file invalidates the reach table and a test says so.

Why not in the spot file (the first draft bumped `measure-spots` to version 6):
that would mean re-measuring all 43 spot files on `ultimate` just to add a
field, and `measure-spots` would have to depend on a bake that itself depends
on the spots. Keeping it in the nav file keeps one direction: spots, then the
navmesh, then reach. Two consequences:

- `NavQuery.load` is the trust boundary for it. It keeps a `reach` entry only
  for ids that `WorldSpots` normalized as verified spots of the same scene.
- `WorldPresence` can tell, before a word is said, whether this is a walk or a
  blink. The prompt can say "she can walk to the kitchen", but only if it can.

### 3.3 `NavQuery` — the runtime half, in pure JavaScript

`src/gltf-viewer/NavQuery.js`: an IIFE with the dual export
(`module.exports` + `window.NEXUS_NAV_QUERY`), no top-level `import`, no
`THREE` (plain `[x, y, z]` arrays), so Jest `require()`s it. It is the only
reader of `.nav.json` files.

```
load(json)                 → nav | null        validates schema, sha, polygon count, finite numbers
closestPoint(nav, p, ext)  → { poly, point }   point on the navmesh nearest p within a box
findPath(nav, a, b)        → [poly…] | null    A* on the polygon graph, cost = portal-midpoint distance
straightPath(nav, a, b, polys) → [[x,y,z]…]    Simple Stupid Funnel through the portals
moveAlongSurface(nav, poly, from, to) → { poly, point }   the hard clamp: slides along the boundary
raycast(nav, poly, from, to) → { hit, t }      is the straight segment clear (used for smoothing, look-ahead)
reach(nav, fromId, toId)   → metres | null      from the baked table (§3.2); no search at runtime
```

Why our own and not the wasm runtime: our rooms have tens to a few hundred
polygons. A\* plus funnel at that size takes microseconds in plain JS. There is
no bundler to ship a wasm module through, no ES module Jest could load, and
Quest's memory is better spent on the scene. If a scene ever needs tiled meshes
or many agents (an open-world place with NPCs), that is the moment to load the
wasm Detour at runtime, behind the same `NavQuery` API.

### 3.4 `PathFollower` — per frame, allocation-free

`src/gltf-viewer/PathFollower.js`, pure functions over numbers (same
convention). Given the straight path, her position and polygon, the person's
position and `dt`, it returns the next position, the heading and a speed.

- **Look-ahead carrot.** Steer toward the point 0.4 m ahead on the path, not the
  next corner, so she rounds corners in an arc instead of snapping at them. Before
  using the carrot, check `raycast(her → carrot)` on the navmesh; if blocked,
  pull the carrot back to the corner. A smoothed path that leaves the mesh is the
  bug every engine's forums report as "AI cuts corners into walls".
- **Turn first, then walk.** A heading error over 60° is a turn in place (the
  existing `TURNING` state), never a walk sideways. The turn rate is capped at
  180°/s.
- **Arrive.** Speed eases down over the last 0.6 m, and she stops within
  0.08 m, then turns to the spot's `facingDeg` (towards the person).
- **The clamp.** The new position always goes through `moveAlongSurface`. Even
  if the steering math, a frame hitch (`dt` capped at 0.05 s) or a bug asks for a
  point inside the sofa, she slides along its eroded edge instead. This is
  Detour's guarantee and the reason she cannot overlap geometry the bake knew
  about.
- **No garbage.** Scratch arrays are allocated once. A GC pause on Quest is a
  dropped frame you feel.

### 3.5 The person is the only moving obstacle

In VR the person walks around their room-scale space. A crowd solver is the
wrong tool for one agent and one human. RVO in particular is force-based and
ignores the navmesh, which is how agents get pushed through walls. Instead:

- The person is a disc of radius 0.28 m (`personRadius`, the spot tool's) at the
  headset's floor projection, read once per frame through
  `MotionIntegration.getUserPosition()`.
- If the disc is on her path within the next 1.2 m, she **slows and waits**
  (idle, looking at them) for up to 1.5 s. If they are still there, she
  **re-paths once** with the polygons under the disc costed ×20 (a soft block,
  so a doorway they stand in is still the way if it is the only way). Still
  blocked, she stops and the walk ends `blocked`.
- She never comes closer than 0.6 m to the person during a walk. Arrival at a
  spot is the exception, by design: the spot was measured with the person 1 m in
  front of her.

### 3.6 Animation: the root is ours, the feet follow it

- The walk clip comes from `NEXUS_MOTION_CLIPS` and is played **in place**. Root
  motion is not used: the root is set by `PathFollower`, which is what keeps it
  on the navmesh (this is Unreal's "capsule follows root motion" rule, turned
  around).
- `playbackRate = speed / clipStrideSpeed`, with `clipStrideSpeed` measured once
  per clip by the motion audit and stored next to the clip's `USE` hint. That
  keeps the feet planted at every speed of the arrive ramp.
- Walking is refused while anything holds her bones: Pose Studio, a VR puppet
  (`vrPoseSystem.claimBones()`), a Private pose. The walk asks; it does not
  take.
- `npm run audit:motion` before and after, frames looked at, as for any motion
  change.

## 4. VR on Quest 3: whose coordinates move

This is the part that differs from the desktop, and it is where a naive
implementation makes people sick.

Today LW3's `goToSpot` keeps **her at the origin** and moves the _room_ under
her during a fade. Walking cannot do that. Moving the room while the person
watches is a glide of their whole world. So during a walk:

1. **The room is still. The person's viewpoint is still. Only she moves**,
   inside the room's coordinates (`scene node` space, converted once with the
   node's matrix).
2. Every system that reads "where she is" must read it, not assume the origin.
   Before LW6.3 lands, list and fix the readers: `VRProximityTracker`,
   `AvatarLocomotionSystem` (already moves the root), the screen camera presets
   and orbit target, `VRChatPanel` placement, `HandContactIK`, the ambience
   camera contract. Add one accessor (`NEXUS_NAV_WALK.avatarPosition()`) and
   move them to it, rather than patching each.
3. **When she arrives, the person is where they were.** That is correct and not
   forced on them. They have two ways to join her, both their choice:
    - point the left-hand arc (their own teleport, the Alyx/VRChat pattern) at
      the floor beside her, or
    - say or tap "come with you". That is LW3's existing blink, run in reverse:
      fade, re-place the room so her spot is at the origin and the person is
      1 m in front of her, fade back. After it, the old invariant (her at the
      origin) holds again, so nothing downstream ever has to handle a
      half-moved world.
4. **The arc pointer hits the scene, not `y = 0`.** `TeleportArcPointer`
   intersects its parabola with the navmesh polygons (a few hundred triangles,
   not the 30 000 of the render mesh), snaps with `closestPoint` within 0.5 m
   horizontally, and shows the marker **green** only when `findPath` from her
   polygon succeeds. Otherwise it shows **red** and releasing does nothing. "Go
   here" is a promise the marker makes before the trigger is released.

Comfort rules unchanged: no camera motion the person did not cause, the fade
for every re-placement, reduced motion makes the arrival instant.

### 4.1 Quest 3 budget

Quest 3 runs the page at 72–90 Hz: 11–13.9 ms a frame for everything. The
place itself already spends most of it (≤ 30 000 triangles, ≤ 40 draw calls,
≤ 32 MB textures for the Quest version of a scene). Walking must be noise:

| Cost                            | When               | Budget              | How                                                                     |
| ------------------------------- | ------------------ | ------------------- | ----------------------------------------------------------------------- |
| Load `.nav.json`                | With the world     | < 60 KB gz, < 5 ms  | Fetched beside the GLB, parsed once, typed arrays                       |
| `findPath` + `straightPath`     | On request only    | < 1 ms              | A\* over ≤ 2 000 polys; refused by the bake if a scene exceeds it       |
| `PathFollower` + clamp          | Per frame, walking | < 0.05 ms           | O(1) plus a walk over 1–3 adjacent polygons                             |
| Person-disc check               | Per frame, walking | < 0.01 ms           | Segment-vs-disc on the next 1.2 m                                       |
| Arc pointer vs navmesh          | Per frame, aiming  | < 0.2 ms            | ~80 parabola steps against the navmesh's bounding grid, not the scene   |
| Garbage                         | Per frame          | 0 allocations       | Preallocated scratch                                                    |

No physics engine, no BVH over the render mesh, no Web Worker (the work is too
small to repay the message cost), no runtime navmesh build. Everything runs
inside `animate()` in its own `try`, per the XL rule, and never calls
`renderer.setAnimationLoop`.

## 5. Ownership, confirmation, failure

Following the LLM capability pattern and Living Worlds' rules:

- **`MotionIntegration.walkTo` is the one entry** for anything that moves her
  across the floor (§9.1): the DSL's `approach`, `retreat`, `follow` and seat
  walks, the arc pointer and `WorldPresence`. It plans through `NavWalk` and
  steps `PathFollower`. Nothing else moves her root.
- **The model never walks her on its own.** `<go spot/>` runs only on a turn
  where the person asked to move (LW3's rule, unchanged); walking is how the
  move is carried out when `reach` says it can be, and the blink when it cannot.
- **Arrived only from the renderer**: `walkTo` resolves `true` only after
  her root stopped inside 0.08 m of the goal and she turned. Ends:
  `arrived`, `blocked` (person), `stuck`, `stale` (world changed, Clear, session
  ended), `refused` (bones held, no navmesh, no path).
- **Stuck detection:** less than 5 cm of progress in 1.5 s → re-path once → still
  stuck → stop, end `stuck`. On a screen, `WorldPresence` may then fall back to
  the blink. In VR the person is told she could not get there; she is not
  teleported in front of them.
- **Fail soft**, as everywhere here: a scene without a `.nav.json`, a file that
  fails `NavQuery.load`, an old tool version → no walking in that scene, LW3's
  blink is used, one `console.warn` with the reason. Nothing throws into the
  reply.
- **Snapshot and restore:** a walk snapshots her root position/rotation and the
  locomotion state. `stale` writes the snapshot back. No bespoke undo.

## 6. Verification

Each layer is tested where it can be, and looked at where it cannot:

1. **Jest (`tests/living-worlds/nav-*.test.js`)**, against synthetic navmeshes:
   an L-shaped corridor, a room with a table in the middle, a door narrower than
   2 × radius. Properties, not sentences: every point of every path lies inside
   the mesh; `moveAlongSurface` never returns a point outside, for 10 000 random
   requests; the funnel path is no longer than the polygon-centre path; a
   closed door yields `null`; no allocation in `PathFollower.step` (count via a
   frozen scratch).
2. **Data tests:** every `.nav.json` re-hashes to its scene's SHA-256; every
   verified spot lies on its scene's navmesh; `reach` is symmetric.
3. **Bake review:** `nav-shots.mjs` images committed beside the spot shots for
   each baked scene; nobody ships a navmesh they have not looked at.
4. **Headless walk (the `walks` stage of `audits/gestures/run.mjs`, §9.4):** load the place,
   walk between every reachable pair, sample her root every frame, and check
   each sample offline against the **real** geometry: the 24-direction
   clearance rays of `measure-spots` at four heights. That catches a navmesh
   that disagrees with the mesh it was baked from (a missing decorative flag, a
   too-coarse simplification).
5. **On a Quest 3:** frame timing during a walk (OVR Metrics Tool, or the
   browser's `performance` marks), the arc marker on stairs and thresholds, a
   person standing in the doorway, and comfort with a person who did not know
   she would walk.

## 7. Rollout (commits say `LW6.n:`)

| Batch    | What                                                                                     | Done when                                                                    |
| -------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **LW6.1** | `bake-navmesh.mjs`, `nav-shots.mjs`, `.nav.json` for `pixel-flat-home` (serves `apartment` and `bedroom-light`) | Review images look right; data tests pass                                    |
| **LW6.2** | `NavQuery.js` + Jest property tests                                                     | All §6.1 properties hold                                                     |
| **LW6.3** | `PathFollower.js`, `NavWalk.js`; `MotionIntegration.walkTo` (approach, retreat, follow, seat) walks on the navmesh; gestures off while walking | `audit:conversation` clean with its new `walks` stage; positions 20/20, gestures no worse |
| **LW6.4** | `reach` from the nav file; `WorldPresence` walks when reachable, blinks otherwise        | Living Worlds tests extended; prompt says walk only when `reach` holds       |
| **LW6.5** | VR: arc pointer on the navmesh with green/red marker; person disc; "come with you" blink | Quest 3 session: no dropped frames during walks, comfort checklist passed    |
| **LW6.6** | Bake the remaining scenes that have spots; scenes without walking keep the blink        | Every scene with spots has a reviewed navmesh or a recorded reason not to    |

Each batch leaves `npm run validate` at exit 0, and updates
`docs/claude/living-worlds.md` in the same commit when a rule there changes.

## 8. Choices not taken, and why

- **A physics engine (Rapier, Ammo, cannon-es) with a capsule controller.** It
  is the right tool for a player character pushed around by physics. For an NPC
  that only walks, a navmesh gives the same guarantee for free at runtime, and
  it plans the route, which a capsule cannot. On Quest that means 1–2 MB of
  wasm and a solver step every frame, for nothing a person would see.
- **three-mesh-bvh capsule move-and-slide against the render mesh.** Good for
  a player-controlled body; it is what we would add if the person's own avatar
  ever needed to collide. For her, it catches walls but does not find doors.
- **Runtime Recast/Detour via wasm.** Right for big tiled worlds and crowds. Not
  needed for rooms with one walker; kept as the upgrade path behind `NavQuery`.
- **Context steering / whiskers only.** Cheap and good at "don't touch the
  wall", hopeless at "the kitchen is behind this wall". It is a navmesh
  fallback in some engines; ours is the blink.
- **Gliding the room instead of walking her.** It would keep her at the origin
  and save the accessor work in §4 (point 2). It is also exactly the motion that makes
  headsets sick, and `docs/LIVING_WORLDS.md` forbids it.

## 9. Implementation plan, file by file (on `claude/gestures-quest-mobile`)

Built on `claude/gestures-quest-mobile` at `fb5b5fd` (2026-11-18), 20 commits
ahead of `ultimate` and none behind. That is `ultimate` plus:
- SG1–SG8, the co-speech gestures and the conversation audit;
- MO15–MO17, the idle pool, the turn clock and the hips sway;
- UI1–UI3, the menu and Pose Studio tour (`npm run audit:ui`) and the Pose
  Studio fixes.

Every path and line below was read in that tree. Re-check them if the branch
has moved when a batch starts.

**Updated at `fb5b5fd`** (eight commits since `8e2a1de`, the first reading):
- MO17 quarantined one more idle, so the idle pool is four clips.
- MO17 moved the hips sway onto the hips bone; see §9.0 point 7.
- UI3 re-recorded the parity baseline, which now pins every `<script>` tag in
  `index.html`. The new modules therefore load from `ViewerEngine.js` (§9.4).
- MO17 added `tools/qa/idle-arm-check.mjs`; the walk clip is checked with it
  (§9.8).
- Line references were re-read: `ProceduralAnimator.js` moved; the rest held.

### 9.0 What this branch changes about the problem

The `ultimate` plan treated the Living Worlds spot move as the walk to fix. On
this branch there is a more common one, and it decides where the work goes:

1. **She already walks, model-driven, in straight lines, in every place.**
   `MotionIntegration.walkTo(target, stopDist)` (`src/xr/MotionIntegration.js:785`)
   is called by four DSL handlers the model can trigger:
    - `approach`, to the person or a seat (`:988-995`);
    - `retreat`, which walks 2 m **straight backwards** from the person, into
      whatever is behind her (`:997-1006`);
    - `follow`, which re-targets the person every 0.25 s (`:839-856`, config
      `followRefreshS`);
    - `sit` with a seat anchor (`:1061-1065`).

   `walkTo` drives either the dev-only `AvatarLocomotionSystem`, or, by default
   (locomotion is off), a **manual glide** in `_updateWalk` (`:821-837`): her
   root moves at 0.9 m/s toward the goal while
   `vendor/animations/action/action_walk.bvh` plays through
   `NEXUS_CLIP_LOADER`. Neither path knows a wall exists. In a place, `retreat`
   walks her through the wall behind her spot. **`walkTo` is the one choke
   point**: put the navmesh behind it, and all four, plus the arc pointer and
   Living Worlds, are covered at once.
2. **Gestures now run on her arms while she talks**
   (`src/features/gestures/SpeechGestures.js`, the SG3 additive layer applied by
   `ProceduralAnimator.update`). They step aside only when `NEXUS_CLIP_LOADER`
   reports a clip playing, or in pose mode, edit mode or Pose Studio
   (`src/ProceduralAnimator.js:798-811`). The manual glide plays its walk
   through `NEXUS_CLIP_LOADER`, so gestures stop. `AnimationBlendController`
   plays its walk on **its own mixer**, which that check does not see, so
   gestures would land on top of the arm swing. The walk must switch gestures
   off explicitly, whichever path plays it.
3. **Turning has one correct clock now (MO16).** `_turnBy` advances on
   `update()`'s capped `dt`, with a time budget on the same clock and a
   wall-clock net that finishes the turn (`:311-357`). The walk's turn in place
   and final facing reuse `_turnBy` / `_faceTarget`; `PathFollower` adds no
   second turning implementation.
4. **Standing still after a walk now has a balanced idle pool (MO15, MO17).**
   Four idles are quarantined (`MotionClipMap.js:637-642`):
    - `neutral.bvh`, `neutral_idle.bvh` and `neutral4.bvh` as `'lean'`;
    - `neutral3.bvh` as `'uneven'`, with one arm out and the other against
      her side.

   Four clips remain in the pool. The walk's stop must hand over to
   `_scheduleIdle` (the pool that respects the quarantine), never to a clip
   `AnimationBlendController` loads by path.
5. **Postures are handled already.** `walkTo` stands her up first when she sits
   or lies (`_inPosture` → `_standRoutine`, `:791`), and UN21 prepends `stand`
   to any body plan made while seated (`:1235-1244`). The walk inherits this
   unchanged.
6. **There is an audit to extend, not a new harness to write.**
   `audits/gestures/run.mjs` already measures, in the real renderer:
    - posture coherence (body and motion state agree);
    - balance (hips over the point between her feet, limit 0.15 of leg
      length);
    - feet against the floor (6 cm);
    - facing the camera.

   UI1–UI3 add `npm run audit:ui`, a tour of the menu and Pose Studio. It
   matters here only because walking must be refused while Pose Studio holds
   her (§9.4), and the tour is where that refusal gets a click-level check.
7. **The hips sway now turns about her pelvis (MO17).** `ProceduralAnimator`
   used to take VRoid's armature bone `Root` (the hips' parent, on the floor)
   for the hips, so every sway rolled her whole body about her feet. It now
   uses the VRM's raw `hips`, falling back to `Root` only when there is none.
   That fixes the name clash this plan would otherwise trip over: a walk
   moves her **avatar root object** (`_avatarRoot`, the scene node the
   viewer places), and must never write the armature bone called `Root`.
   The sway still runs while the walk clip plays, because
   `setAllowWithMixer(true)` is the default. The `walks` audit measures
   whether sway on top of the gait unbalances her. If it does, the
   `state.walking` gate below also covers the sway, not only the gestures.

   It does this across a 20-transition positions matrix, and
   `npm run audit:conversation` (SG8) runs it with the motion audit as one
   verdict. Walking becomes a stage of that suite.

Unchanged from the `ultimate` reading:
- `WorldSpots` is an IIFE side-effect-imported by `ViewerEngine.js:37`.
- `goToSpot` is at `VRWorlds.js:1166-1203`.
- The arc pointer's `groundY: 0` is at `TeleportArcPointer.js:44`, `:187-191`,
  and `walkToPoint` at `:345`.
- `CameraPresets.js:179` and `ViewerEngine.js:103` and `:706` assume the
  origin.
- `pixel-flat-home.glb` (26 468 triangles, 8 verified spots) serves
  `apartment` and `bedroom-light`.
- `recast-navigation@0.44.0` is MIT and goes in `devDependencies` only.

### 9.1 Where things live now

The owner changes from the first draft. There is no separate `WorldWalk`
competing with `walkTo`:

```
approach · retreat · follow · sit(seat)   arc pointer    WorldPresence <go spot/>
                 \            |               /                 |
                  ▼           ▼              ▼                  ▼
          MotionIntegration.walkTo(target, stopDist, opts)  ← the ONE entry (exists today)
                  │   stands her up first (exists), snapshots her root
                  ▼
          NEXUS_NAV_WALK.plan(from, goal, stopDist)   src/xr/NavWalk.js (new, IIFE)
                  │   scene-local ⇄ world via the vr-world-scene node's matrix
                  │   NavQuery: closestPoint → findPath → straightPath
                  │   no navmesh: §9.4 rules (no place → today's line; place → measured corridor only)
                  ▼
          _updateWalk(dt)  — per frame, both modes (manual glide and locomotion)
                  │   PathFollower.step → moveAlongSurface (the hard clamp)
                  │   turn in place > 60° → _turnBy (MO16 clock)
                  │   person disc (VR), stuck detection
                  ▼
          arrive: _faceTarget, _scheduleIdle (MO15 pool), resolve(true)
```

`AvatarLocomotionSystem.walkToPoint` and `TeleportArcPointer` stop moving her
root themselves. The pointer calls `NEXUS_MOTION.walkTo`, and the locomotion
system becomes only the clip and blend driver when it is switched on.

### 9.2 LW6.1 — bake and look (unchanged)

It shares nothing with the gesture work, so it is the safe first commit.

New files:

- `tools/vr/bake-navmesh.mjs`
    - Loads the GLB in headless Chromium with the vendored three r147, the way
      `measure-spots.mjs` does (same double-sided rule, same node-name
      filters). It hands world-space positions and indices back to Node.
    - Runs Recast there through `@recast-navigation/generators` with the §3.1
      parameters. `walkableRadius` is read from
      `assets/vr-worlds/spots/<stem>.json`'s recorded `tool.params.bodyRadius`,
      never typed a second time.
    - Keeps the region that holds the verified spots. It refuses (exit 1,
      nothing written) when a spot is off the mesh or the polygon count exceeds
      2 000.
    - Writes `assets/vr-worlds/nav/<stem>.nav.json`: verts, polys and
      neighbours, bounds, `agent`, the scene's SHA-256, the spot file's
      SHA-256, `spots: { id: { poly, point } }` and `reach`.
    - Supports `--check` (measure and print, write nothing), like its sibling.
- `tools/vr/nav-shots.mjs`: a top-down orthographic render of the scene through
  `page-driver.mjs`, with the navmesh drawn over it (polygons outlined, the
  0.32 m erosion visible at walls), spots as discs and the straight path
  between every reachable pair. Writes PNGs beside the existing spot shots.
- `assets/vr-worlds/nav/pixel-flat-home.nav.json`, plus its PNGs.
- `package.json`: `recast-navigation` in `devDependencies`; script
  `"vr:bake-nav": "node tools/vr/bake-navmesh.mjs"`. Lockfile regenerated with
  npm 11 (`npx npm@11 install --package-lock-only`), per CLAUDE.md.

Tests (`tests/living-worlds/nav-data.test.js`), over every file in
`assets/vr-worlds/nav/`:

- the scene re-hashes to `sha256`;
- the spot file re-hashes to `spotsSha256`;
- every verified spot has an entry, and its point lies inside its polygon;
- `reach` is symmetric, and lengths are at least the straight-line distance;
- no vertex is non-finite.

Done when: the PNGs have been looked at (doors open, the sofa and bed are holes
with a margin, no walkable island on a table), and `npm run validate` exits 0.

### 9.3 LW6.2 — `NavQuery` (unchanged)

- `src/gltf-viewer/NavQuery.js`: an IIFE exporting `window.NEXUS_NAV_QUERY`.
    - API: `load(json, spots)`, `fileFor(sceneSrc)`, `fetchFor(sceneSrc)`
      (cached, the `WorldSpots.load` shape), `closestPoint`, `findPath`,
      `straightPath`, `moveAlongSurface`, `raycast`, `reach(nav, fromId, toId)`.
    - Plain arrays in, plain arrays out. No `THREE`.
    - On load, polygons become a flat `Float32Array` plus an `Int32Array` of
      neighbours, so queries allocate nothing.
- `src/gltf-viewer/ViewerEngine.js`: `import './NavQuery.js';` next to line 37.
- `tests/living-worlds/nav-query.test.js`, on synthetic meshes built in the test
  (an L-corridor, a room with a table hole, a door narrower than 2 × radius):
    - every property in §6.1;
    - `load` rejects the wrong schema, NaN, out-of-range neighbour indices and
      `reach` naming an unknown spot;
    - one test runs `findPath` + `straightPath` against the real apartment file
      from LW6.1.

### 9.4 LW6.3 — `walkTo` walks on the navmesh

This is the batch that fixes the bug people see on this branch.

- **`src/gltf-viewer/PathFollower.js`**: as designed in §3.4, but **without a
  turn of its own**. It returns `{ point, poly, heading, speed, turnFirst }`.
  `turnFirst` tells the caller to turn in place with `_turnBy` before moving.
- **`src/xr/NavWalk.js`**: IIFE, `window.NEXUS_NAV_WALK`. It is
  **side-effect-imported from `ViewerEngine.js`**, beside `NavQuery` and
  `PathFollower` (after `import './WorldSpots.js'`, line 37). It is not a new
  `<script>` tag: since UI3, `tests/behavior/baseline/boot-baseline.json`
  (recorded by `scripts/behavior-parity-baseline.mjs`) pins every `<script>` in
  `index.html`, and a new tag would mean re-recording it. `MotionIntegration`
  (a `defer` tag at `index.html:3832`) reads `window.NEXUS_NAV_WALK` lazily at
  walk time, as it already does `NEXUS_LOCOMOTION`, so the order the two load
  in does not matter.
    - `plan(fromWorld, goalWorld, stopDist)` returns
      `{ ok, path, why }`:
        - converts to scene-local through the active `vr-world-scene:` node's
          `matrixWorld`;
        - snaps the goal with `closestPoint`;
        - stops `stopDist` short **along the path**, not along the straight
          line;
        - returns `why: 'no-path'` when the goal is unreachable.
    - `retreatGoal(her, person, metres)`: `moveAlongSurface` from her position
      directly away from the person. It returns how far back she really can go
      (0 with her back to a wall), so `retreat` steps back as far as the room
      allows and no further.
    - `seatApproach(seat)`: the nearest navmesh point to a seat anchor. The
      seat itself is a hole in the mesh; the sit clip covers the last
      centimetres, as it does now with `stopDist` 0.1.
- **`src/xr/MotionIntegration.js`**:
    - `walkTo` (`:785`) asks `NavWalk.plan` first. On `ok`, `_walk` holds the
      path and a `PathFollower` state instead of a single `goal`. On `no-path`,
      it resolves `false` without moving (the handler's reply stays truthful;
      the model was told nothing happened).
    - `_updateWalk` (`:821`) steps the follower in **both** modes. In manual
      mode it writes position and heading. In locomotion mode it feeds the
      follower's point to the locomotion system as its next target, which then
      only plays and blends clips.
    - `retreat` (`:997`) uses `NavWalk.retreatGoal`.
    - The `sit` seat walk (`:1065`) uses `seatApproach`.
    - `follow` (`:839`) re-plans at its existing 4 Hz. A path search at that
      rate costs under 1 ms a second.
    - Arrival: the follower's own arrive (0.08 m), then `_faceTarget` toward
      the person, `_scheduleIdle(0.1)`. The old `d < 0.3` and `d < 0.6`
      thresholds go.
    - Stuck: under 5 cm of progress in 1.5 s → re-plan once → still stuck →
      `_stopWalk(false)`.
    - Snapshot and restore: her root is captured at the start of `walkTo`. A
      world change, Clear or avatar swap mid-walk writes it back.
- **No navmesh: two cases, decided by whether a place is up**
  (`NEXUS_VIEWER.vrWorlds.activeId`):
    - *No place* (the plain viewer, plain VR, AR): there are no walls to hit.
      `walkTo` behaves exactly as today. Nothing changes for the desktop viewer
      or for passthrough.
    - *A place with no nav file*: only the corridor `measure-spots` measured is
      known clear. That is the 2.2 m of open view in front of her spot, at
      chest and eye height, with the person 1 m ahead. So `approach` toward the
      person, along that facing, is allowed up to the person's disc. `retreat`,
      `follow` and seat walks are refused with `why: 'no-navmesh'`, and she
      stays put. One `console.warn` per scene.
- **Gestures off while walking**: `ProceduralAnimator.update`'s `allowed`
  (`src/ProceduralAnimator.js:811`) gains
  `&& !window.NEXUS_MOTION?.state?.walking`. `walkTo` keeps a `state.walking`
  flag, which `state.lastActivity` already reports as `'walking'` through
  `bodyStatus` (`:1842`). Gestures come back with the next words after she
  stops. SG measured gestures only on a standing body. Gesturing while walking
  is a later, audited addition, not a side effect.
- **Tests**:
    - `tests/living-worlds/path-follower.test.js` (§6.1 properties, no
      allocation per step);
    - `tests/living-worlds/nav-walk.test.js`, on a synthetic mesh:
        - `retreatGoal` returns 0 against a wall;
        - stopping short is measured along the path;
        - the no-place, place-without-nav and place-with-nav cases each do
          what the bullet above says;
    - extend `tests/motion-runtime-mo.test.js`:
        - `walkTo` with a nav file never puts her root outside the mesh over
          600 simulated frames at 72 fps and at 4 fps (MO16's lesson: test the
          slow clock);
        - `retreat` in a corner does not move;
        - gestures are released while `state.walking`.
- **Audit**: `audits/gestures/run.mjs` gains a `walks` stage, and
  `--only walks` runs it alone. In `apartment` it runs:
    - `approach`, `retreat` from three spots (one with a wall behind);
    - `follow` across the room;
    - "go to the sofa".

  Every frame it records her root against the navmesh (inside) and against
  the real geometry (the 24-direction clearance rays of `measure-spots` at
  four heights). After each walk it reuses the positions checks: coherent
  (`walking` only while moving), balanced (≤ 0.15), feet on the floor,
  facing. Both hands are checked out of her body during the walk.
  `audit:conversation` includes the stage, so SG8's single verdict covers
  walking.

### 9.5 LW6.4 — words walk her to spots

The design, from the `ultimate` reading, followed by what this branch changes:

- `src/companion/WorldPresence.js` (spot move around `:278-287`): when the
  current scene's nav file has `reach[here][there]`, call `NEXUS_MOTION.walkTo`
  first. Otherwise, or on `blocked` / `stuck` on a screen, call `goToSpot`
  as today.
- "Arrived" waits on `walkTo` resolving `true` (with her root at the
  spot), the way it waits on `nexus-world-shown`, with the same 45 s timeout.
- The prompt's presence line says she can walk somewhere only when `reach`
  holds (sanitised as today).
- NL entry (`NEXUS_MOTION.onUserUtterance`) gains nothing new. "Go to the sofa"
  already resolves to a spot through `WorldSpots.intentOf`; only how the move
  is carried out changes.
- Tests: extend `tests/living-worlds/world-presence.test.js`. Walk when
  reachable, blink when not, and never "arrived" before `walkTo` resolves. A `<go/>`
  on a turn without the person's ask still only offers.

One change on this branch: `WorldPresence` calls
`NEXUS_MOTION.walkTo(spotPoint, 0, { spot })`, not a separate walker. It falls
back to `goToSpot` (the blink) on `no-path` or `no-navmesh`. "Arrived" waits for
`walkTo` to resolve `true` **and** her root within 0.08 m of the spot. The prompt
says she can walk somewhere only where `reach` holds.

### 9.6 LW6.5 — VR on Quest 3

- `src/TeleportArcPointer.js:187-191`: intersect the parabola with navmesh
  polygons (bounding-grid first), not `y = 0`. Snap with `closestPoint`
  (0.5 m). The marker turns green only if `findPath` from her polygon succeeds,
  red otherwise; on release, red does nothing. `:345` calls
  `NEXUS_MOTION.walkTo`.
- During a walk in VR: the room and the rig are untouched, and only her root
  moves (§4).
- "Come with you": a VR panel button and a phrase. It runs `goToSpot` on the
  spot she reached, or on a synthetic spot at her stop point facing the person,
  so the room is re-based behind a fade and her-at-origin holds again.
- The person disc reads `MotionIntegration.getUserPosition()` once per frame.
- Measure on a real Quest 3 (§6.5): OVR Metrics frame time during 20 walks in
  the apartment, dropped frames compared with standing idle, arc on thresholds,
  a person in the doorway. Results recorded in
  `docs/LIVING_WORLDS_IMPLEMENTATION_REPORT.md`.

On this branch, the pointer's release calls `NEXUS_MOTION.walkTo`, so a pointed walk gets the
same stand-up, gesture release, clamp and arrival as a spoken one. One
gesture-branch item to check in the headset: SG5 scales expressive gestures by
device, and the Quest's size must not bring them back mid-walk. The
`state.walking` gate covers it, and the headset check confirms it.

### 9.7 LW6.6 — the other places (unchanged)

Bake every scene with at least two verified spots. A scene that cannot get a
clean navmesh records why and keeps the §9.4 "place without nav file" rules.

### 9.8 Order, and what can go wrong between the two lines of work

1. **LW6.1 and LW6.2** first, in parallel. They touch no file the gesture work
   touched.
2. **LW6.3** next. It edits `MotionIntegration.js` and `ProceduralAnimator.js`,
   both changed on this branch (`MotionIntegration` by MO16;
   `ProceduralAnimator` by SG3 and MO17). Merge `ultimate` (and this
   branch's own updates) into the work branch **before** starting it, and
   run `npm run audit:conversation` before and after: the positions matrix
   (20/20 ok at `8e2a1de`) and the gesture audit (78 ok) must not regress.
   Re-run both at `fb5b5fd` first to set the baseline: MO17 changed the idle
   pool and the hips since those numbers. Also run `npm run audit:ui` before
   and after, for the Pose Studio refusal.
3. **LW6.4** and **LW6.5** after LW6.3, in either order.
4. Each batch: `LW6.n:` commit subjects, `npm run validate` at exit 0, and
   `develop/NEEDS_FIX.md` for any walk clip the audit fails, never shipped.
   For example, if `action_walk.bvh` turns out to lean or float the way the
   MO15 idles did. Before LW6.3, run
   `node tools/qa/idle-arm-check.mjs --clips vendor/animations/action/action_walk.bvh`
   on the three avatars. Read only its torso **clearance**: a walk swings the
   arms in turn, so its asymmetry limit (14°) does not apply. An arm through
   her cardigan on the swing is a quarantine, the same as MO17's.

## Sources

- Epic, _Using Avoidance with the Navigation System_ (Detour Crowd respects the
  navmesh; RVO does not):
  <https://dev.epicgames.com/documentation/unreal-engine/using-avoidance-with-the-navigation-system-in-unreal-engine>
- Epic, _Root Motion_ (capsule follows the animated root):
  <https://dev.epicgames.com/documentation/unreal-engine/root-motion-in-unreal-engine>
- UE5 navmesh settings, agent radius = capsule radius:
  <https://uhiyama-lab.com/en/notes/ue/navmesh-setting-optimization/>
- Unity, `NavMeshObstacle` (carving vs avoidance):
  <https://docs.unity.com/en-us/engine/6000.0/script-reference/unityengine/ai/navmeshobstacle>
- RVO2 / AIGameDev 2012 (Resistance 3 left walls to physics):
  <https://gamma.cs.unc.edu/RVO2/publications/AIGD12.pdf>
- RVO agents leaving the navmesh, and the fix (validate each position):
  <https://forum.arongranberg.com/t/how-to-prevent-rvo-agents-from-moving-outside-recast-navmesh-graphs/17001>
- Mike Lewis, _Smarter Steering: Using Context for Direction_:
  <https://gamedev.net/articles/programming/artificial-intelligence/smarter-steering-using-context-for-direction-r3149>
- `recast-navigation` (WebAssembly Recast/Detour, MIT, v0.44.0 on 2026-11-18):
  <https://www.npmjs.com/package/recast-navigation>
- three-mesh-bvh capsule controllers (BVHEcctrl, three-player-controller):
  <https://cdn.jsdelivr.net/npm/bvhecctrl@0.0.18/readme.md>
