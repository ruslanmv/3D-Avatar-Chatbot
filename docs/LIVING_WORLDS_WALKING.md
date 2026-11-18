# Living Worlds walking: she walks a path, never through the furniture (LW6)

Status: **design**, 2026-11-18. Nothing here is implemented yet. This fills in
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
        │                                          │ WorldWalk  (LW6, the one owner)   │
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
   camera contract. Add one accessor (`NEXUS_WORLD_WALK.avatarPosition()`) and
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

- **`WorldWalk` (`src/gltf-viewer/WorldWalk.js`) is the one owner** of a walk,
  next to `goToSpot` in the world runtime. `WorldPresence`, the arc pointer and
  the NL motion entry (`NEXUS_MOTION.onUserUtterance`) all ask it. None of them
  moves her root.
- **The model never walks her on its own.** `<go spot/>` runs only on a turn
  where the person asked to move (LW3's rule, unchanged); walking is how the
  move is carried out when `reach` says it can be, and the blink when it cannot.
- **Arrived only from the renderer**: `nexus-world-walked` with
  `{ spot, ok: true }`, after she stopped inside 0.08 m and turned. Ends:
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
4. **Headless walk (`tools/vr/walk-audit.mjs`, Playwright):** load the place,
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
| **LW6.3** | `PathFollower.js`, `WorldWalk.js`; `AvatarLocomotionSystem` follows paths, not lines; the "where is she" accessor and its readers | Desktop/phone walk in the apartment, walk-audit clean, motion audit no worse |
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

## 9. Implementation plan, file by file

Checked against `ultimate` at `fa4e3ac` (2026-11-18). Every path and line below
was read in that tree; re-check them if `ultimate` has moved when a batch
starts.

### 9.0 What the tree gives us to build on

| Fact                                                                                                                                                  | Where                                                                                    | What it decides                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorldSpots` is an IIFE with the dual export, reaches the browser as a side-effect `import './WorldSpots.js'`, and fetches `spots/<stem>.json` once per scene through `fileFor` / `load` | `src/gltf-viewer/ViewerEngine.js:37`, `src/gltf-viewer/WorldSpots.js:266-290`            | `NavQuery` and `PathFollower` copy this exactly: IIFE, side-effect import from `ViewerEngine.js`, `nav/<stem>.json`. **No new `<script>` tag in `index.html`** |
| The locomotion trio loads by `defer` tags                                                                                                             | `index.html:3811-3814`                                                                   | Leave those tags alone (the parity harness counts lines); `AvatarLocomotionSystem` reads `window.NEXUS_PATH_FOLLOWER` lazily, at walk time             |
| Today's walk is a straight line toward a target, root lerped in x/z                                                                                   | `src/AvatarLocomotionSystem.js:254-279`                                                  | The one block LW6.3 replaces; the state machine (`IDLE/TURNING/WALKING/STOPPING`) stays                                                                |
| The arc pointer lands on the plane `groundY: 0` and calls `loco.walkToPoint(x, z)`                                                                    | `src/TeleportArcPointer.js:44`, `:187-191`, `:345`                                       | LW6.5 swaps the plane test for the navmesh and gates the call on a path                                                                                 |
| `goToSpot` keeps her at the origin and moves the room, behind a fade                                                                                  | `src/gltf-viewer/VRWorlds.js:1166-1203`                                                  | The blink fallback, and the "come with you" re-base, reuse it unchanged                                                                                 |
| Places that frame her assume she is at the origin                                                                                                     | `src/gltf-viewer/CameraPresets.js:179` (`x = 0`), `src/gltf-viewer/ViewerEngine.js:103`, `:706` (`controls.target.set(0, …, 0)`) | The origin readers LW6.3 must move to the accessor. Most other readers (`VRPoseSystem`, `HandContactIK`, `VRChatPanel`, …) use `getWorldPosition` and need no change, but each gets a check |
| The apartment is one file on every device: `scenes/pixel-flat-home.glb`, 26 468 triangles, **8 verified spots**, used by `apartment` and `bedroom-light` | `assets/vr-worlds/worlds.json`, `assets/vr-worlds/spots/pixel-flat-home.json`            | The first bake. It is already inside the Quest budget, so the first real-headset test needs no new scene                                                |
| The desktop bedroom is `scenes/bedroom-flat.glb`, 39 772 triangles, one spot                                                                          | same                                                                                     | Second bake; desktop only, so not a Quest test                                                                                                          |
| Living Worlds tests live in `tests/living-worlds/` (`place-spots`, `world-presence`, `world-spots`)                                                   | `tests/living-worlds/`                                                                   | New tests go beside them                                                                                                                                |
| Headless driving of the real app already exists, waiting on state, never sleeping                                                                     | `tools/vr/page-driver.mjs`                                                               | `walk-audit.mjs` and `nav-shots.mjs` use it; no new harness                                                                                             |
| No navmesh, physics or BVH dependency today; `dependencies` is only `cors` and `express`                                                              | `package.json`                                                                           | `recast-navigation@0.44.0` (MIT) goes in **`devDependencies`** only; nothing new is shipped to the browser                                              |

### 9.1 LW6.1 — bake and look

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

### 9.2 LW6.2 — `NavQuery`

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

### 9.3 LW6.3 — walk on a screen

- `src/gltf-viewer/PathFollower.js`: IIFE, `window.NEXUS_PATH_FOLLOWER`.
    - `create(path, opts)` returns a state; `step(state, pos, poly, person, dt,
      out)` writes into `out`.
    - Implements §3.4 (look-ahead 0.4 m, turn before walking above 60°, arrive
      ramp over 0.6 m, `dt` capped at 0.05 s, every move through
      `moveAlongSurface`) and §3.5 (the person disc).
    - Side-effect import from `ViewerEngine.js`.
- `src/gltf-viewer/WorldWalk.js`: IIFE, `window.NEXUS_WORLD_WALK`, the one
  owner of a walk.
    - `walkTo(target, opts)` returns `{ ok, why }` and, on success, emits
      `nexus-world-walked`.
    - Also: `cancel()`, `avatarPosition()`, `isWalking()`.
    - Snapshots her root on start; `stale` restores it.
    - Refuses while bones are held: it asks `vrPoseSystem` / Pose Studio / the
      Private pose controller, never takes.
- `src/AvatarLocomotionSystem.js:254-279`: when `NEXUS_WORLD_WALK` has a
  follower, the WALKING state takes position and heading from it instead of the
  straight lerp. Its own `walkToPoint` becomes a call to `WorldWalk.walkTo`. The
  old line stays only where no navmesh exists _and_ no place is up (plain
  viewer, unchanged behaviour).
- Origin readers moved to `NEXUS_WORLD_WALK.avatarPosition()`:
  `CameraPresets.js:179`, and `ViewerEngine.js:103` and `:706`, by following
  her rather than writing `0`. Every other module in the reader list below
  gets checked, and the check is recorded in the commit message.
- Walk clip: `playbackRate = speed / clipStrideSpeed`. The stride speed is
  measured by the motion audit and stored with the clip's `MotionClipMap.USE`
  hint. `npm run audit:motion` before and after, frames looked at.
- Tests: `tests/living-worlds/path-follower.test.js` (never outside the mesh
  over 10 000 random steps; arrives within 0.08 m; never inside the person
  disc; zero allocations per `step`) and `world-walk.test.js` (ownership,
  refusal while bones are held, `stale` restores the snapshot).
- `tools/vr/walk-audit.mjs` (§6.4) on the apartment: all 28 spot pairs.

Readers to check in LW6.3. This is the list from
`grep getWorldPosition|avatar…position` on `ultimate`, with the most hits
first; most of them are already position-independent:
`VRPoseSystem`, `experiences/SceneRuntime`, `SkeletonLineOverlay`,
`VRPuppetInteraction`, `VRControllers`, `PosePuppetIK`,
`xr/MotionIntegration`, `xr/HandContactIK`, `VRIntimacySystem`,
`VRChatPanel`, `PoseGizmoOverlay`, `xr/MotionExecutor`,
`xr/MotionResponseHandler`, `VRProximityTracker`, `CameraPresets`,
`VRMLoader`, `PoseNormalizer`, `XRSplash`, `VRWorlds`, `VRContactAnchors`,
`VRBoneGrabber`, `PuppetSkeleton`, `ARSupport`, `PrivatePoseController`.

### 9.4 LW6.4 — words walk her

- `src/companion/WorldPresence.js` (spot move around `:278-287`): when the
  current scene's nav file has `reach[here][there]`, call `WorldWalk.walkTo`
  first. Otherwise, or on `blocked` / `stuck` on a screen, call `goToSpot`
  as today.
- "Arrived" waits on `nexus-world-walked` the way it waits on
  `nexus-world-shown`, with the same 45 s timeout.
- The prompt's presence line says she can walk somewhere only when `reach`
  holds (sanitised as today).
- NL entry (`NEXUS_MOTION.onUserUtterance`) gains nothing new. "Go to the sofa"
  already resolves to a spot through `WorldSpots.intentOf`; only how the move
  is carried out changes.
- Tests: extend `tests/living-worlds/world-presence.test.js`. Walk when
  reachable, blink when not, and never "arrived" before the event. A `<go/>`
  on a turn without the person's ask still only offers.

### 9.5 LW6.5 — VR on Quest 3

- `src/TeleportArcPointer.js:187-191`: intersect the parabola with navmesh
  polygons (bounding-grid first), not `y = 0`. Snap with `closestPoint`
  (0.5 m). The marker turns green only if `findPath` from her polygon succeeds,
  red otherwise; on release, red does nothing. `:345` calls
  `WorldWalk.walkTo`.
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

### 9.6 LW6.6 — the other places

- Bake every scene in `assets/vr-worlds/spots/` that has at least two verified
  spots, desktop file and Quest file separately.
- A scene that cannot get a clean navmesh (open-sided, stairs Recast cannot
  climb, a floor made of props) gets a line in its spot file's notes saying
  why, and keeps the blink.
- Update `docs/claude/living-worlds.md`: "a move is a walk when the nav file
  says it is reachable, a blink otherwise; nav files are measured, never
  typed, and re-baked with their scene".

### 9.7 Order and size

LW6.1 and LW6.2 can be built in parallel: the synthetic-mesh tests do not need
the bake. LW6.3 needs both. LW6.4 and LW6.5 need LW6.3 but not each other.
Every batch is one commit series with `LW6.n:` subjects, `npm run validate`
at exit 0, and lab data regenerated if any lab check (motion, worlds) covers
what it touched.

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
