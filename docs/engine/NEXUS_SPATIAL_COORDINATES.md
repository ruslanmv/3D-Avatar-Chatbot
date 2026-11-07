# NEXUS spatial coordinates — how positions really work

**Version:** 1.0, 2026-11-07.

**Ground truth:**

- `src/gltf-viewer/VRWorlds.js` (`buildPlace`, `goToSpot`, `comfortProblem`)
- `src/gltf-viewer/WorldSpots.js`
- `tools/vr/measure-spots.mjs` (tool version 4)
- `assets/vr-worlds/spots/*.json`

Every number in this document was copied from those files. None was typed by
hand.

## 1. Conventions

- **Units:** metres. Three.js r147 (`vendor/three-0.147.0`).
- **Axes:** right-handed. **+Y is up**, and the floor is the **X–Z plane**.
- **Her frame:** the avatar root stands at the world **origin**, facing
  **+Z**.
  - The person is assumed **1 m in front of her at +Z**:
    `VRWorlds.comfortProblem` uses `USER_AT = [0, 1]`.
  - The screen camera is 3.8–4.65 m further along +Z (§7).
- **Yaw:** a rotation about +Y, in degrees in data and radians in Three.
  - A facing of `f` degrees is the direction `(sin f, cos f)` on X–Z, so
    0° = +Z and 90° = +X.
- **Rotation about Y (three's `rotation.y = a`):**
  - `x' = x·cos a + z·sin a`
  - `z' = −x·sin a + z·cos a`

## 2. Two coordinate spaces

| Space | What lives there | Who uses it |
| --- | --- | --- |
| **Scene-local** (the GLB's own space, after its internal node transforms) | spots, anchors measured from the model, floor height | `measure-spots.mjs`, `assets/vr-worlds/spots/*.json` (`coordinateSpace: "scene"`) |
| **World / place frame** (the renderer, her at the origin) | her, the person, the camera, the sky, the props | `VRWorlds.buildPlace`, `ViewerEngine`, XR |

A world never moves her. **The room moves.** `buildPlace` adds the loaded scene
as an object named `vr-world-scene:<src>` and applies these, in this order:

```js
built.scale.setScalar(spec.scale);              // default 1
built.rotation.y = (spec.turn * Math.PI) / 180; // worlds.json scene.turn
built.position.set(spec.at[0], spec.at[1], spec.at[2]); // worlds.json scene.at
```

So a scene point `p` lands at `R(turn)·(s·p) + at` in the place frame.

## 3. From a spot to `turn` and `at` (implemented)

To stand her on scene point `p`, facing `f` (toward the person), we need:

- `R(turn)·p + at = 0`, so her feet are on `p`
- `R(turn)·(sin f, cos f) = (0, 1)`, so she faces +Z

The solution is:

```
turn = −f
at   = −R(turn)·p      (y: at.y = −p.y, so the floor under her becomes y = 0)
```

That is `WorldSpots.placementFor(spot, scale)`. A test checks it reproduces the
phone bedroom's hand-measured placement exactly. That placement is spot
`(-4, 0.13, 1)` facing 180°, giving `turn −180, at [-4, -0.13, 1]`.

`WorldSpots.spotAtPlacement(spots, scene)` goes the other way: it tells which
measured spot a world's own `scene.at`/`turn` already stands her on.

**Real example, the apartment:**

- The measured `sofa` spot is `(1.15, 0.16, −0.325)`, facing −80°.
- `placementFor` gives `turn 80, at [0.12, −0.16, 1.189]`.
- That is exactly the `apartment` entry's `scene` in `worlds.json`, and a
  test asserts `spotAtPlacement(...) === 'sofa'`.

## 4. Scene variants have their own coordinates

Spots are keyed by **scene file**, not by world id. `WorldSpots.fileFor`
maps `scenes/x.glb` to `spots/x.json`.

| World id | Tiers | Scene file | Spots file |
| --- | --- | --- | --- |
| `apartment` | mobile, desktop, vr | `scenes/pixel-flat-home.glb` | `spots/pixel-flat-home.json` |
| `bedroom-light` | mobile | `scenes/pixel-flat-home.glb` (same model) | same file |
| `bedroom` | desktop, vr | `scenes/bedroom-flat.glb` (a different model) | `spots/bedroom-flat.json` |

Desktop `bedroom` and phone `bedroom-light` share a name and nothing else. Their
coordinates must never cross: `WorldSpots.load` refuses a file whose `scene`
field is not the scene that was asked for.

## 5. How a spot is measured

`node tools/vr/measure-spots.mjs [scene]` loads the GLB with the vendored three
r147 `GLTFLoader`, in headless Chromium, with files served from the repository.
It needs no app server.

**Inputs:**

- the authoring intent in `tools/vr/spot-targets.json`: id, labels in English
  and Italian, `room`, `near` (node-name regexes), `sees`, `can` and `rating`
- the parameters in `PARAMS`, inside the tool

**Two copies of the room:**

- **solid:** every material is `DoubleSide`, so walls are solid from both
  sides. Used for floor, body and same-room checks.
- **as drawn:** the original materials. Used for camera sightlines, cast
  *from* the camera, the way the renderer culls back faces.

**Steps for each spot:**

1. **Floor height.** Rays straight down on a 25 cm grid over the scene's
   bounding box. Upward faces (normal.y > 0.9) vote by height, and the mode
   wins. `floorY` is 0.16 in the apartment and 0.06 in the desktop bedroom.
2. **The thing.** The union bounding box of top-level nodes matching
   `near`.
3. **Candidates.** A 10 cm grid of floor points 0.3–1.3 m from that box,
   skipping any within `minSpacing` 1.2 m of an earlier spot in the scene.
4. **Floor under her.** A ray down from `floorY + 2.1` must hit an upward
   face within ±0.06 m of `floorY`.
5. **Body.** `BODY_RADIUS` 0.32 m, checked at heights 0.12, 0.55, 1.05 and
   1.55 in 24 directions, with no hit (solid copy), and floor at 8 points
   around her.
6. **Same room.** From her chest toward the thing, the first hit must
   belong to the thing. A wall or door between you fails.
7. **Facing.** Try 72 facings. Each needs all of these:
   - 2.2 m open at heights 0.95 and 1.5 (the VR person)
   - floor and a 0.28 m clearance where the person stands, 1 m ahead
   - **the screen camera sees all of her**: rays from three camera points
     (±0.3 m) at 4.7 m and 0.95 m height, to five body points (0.08–1.45 m)
     across her width (±0.3 m), cross nothing in the as-drawn copy
   - if no point passes, the tool retries with CameraPresets `mid` (2.3 m,
     1.1 m high, knees up), then `bust` (1.0 m, chest to head), and records
     `framing`
   - the thing must be within 80° of "behind her", so the camera sees what
     she stands by
8. **Score.** `min(open, 4) + 2·cos(offBehind) − 0.6·distance`. The best
   candidate wins.
9. **Write.** `assets/vr-worlds/spots/<scene>.json` gets `schemaVersion`,
   `scene`, the model's **`sha256`**, `tool` (name, version, params),
   `floorY` and the spots. A spot with no passing point gets
   `verified: false` plus the rejection counts.

**Why each check exists**, from the first walkthrough (2026-11-07):

| Problem seen | Check that now prevents it |
| --- | --- |
| Four of six spots were wrong on screen. Two were behind walls, because the camera is 4.7 m away, not 2.2 m | the camera sightline check |
| One spot was behind an exercise bike | sightlines to her full width; the bike was also removed by recipe |
| She stood half inside a one-sided wall | the double-sided body check |
| The desktop bedroom's "sofa" spot was inside `007-flat-wall-4m` | the double-sided body check |

## 6. The measured data today (production)

`scenes/pixel-flat-home.glb`:

- SHA-256 `891983a267e2ed54…`
- floorY 0.16
- tool v4

| Spot | Position (scene) | Facing | Framing | From thing | Open ahead |
| --- | --- | --- | --- | --- | --- |
| sofa | (1.15, 0.16, −0.325) | −80° | fullBody | 0.40 m | 6 m |
| record-player | (4.97, 0.16, −0.68) | −115° | mid | 0.40 m | 5.71 m |
| kitchen | (−2.75, 0.16, −2.18) | 60° | fullBody | 0.30 m | 6 m |
| dining-table | (−2.50, 0.129, −0.55) | 95° | fullBody | 0.70 m | 6 m |
| bed | (−2.28, 0.16, 3.80) | 65° | mid | 0.34 m | 2.45 m |
| desk | (−2.445, 0.16, 1.60) | −60° | mid | 0.60 m | 4.09 m |
| bathroom | (1.12, 0.16, 3.26) | 75° | fullBody | 0.31 m | 4.99 m |
| balcony | (−1.66, 0.16, 6.075) | 55° | bust | 0.38 m | 6 m |

`scenes/bedroom-flat.glb`:

- SHA-256 `0bec12c1e79f431f…`
- floorY 0.06

| Spot | Result |
| --- | --- |
| dressing-table | (−3.10, 0.06, 0.925), facing −50°, bust |
| bed | **unverified**: no point passed |
| sofa | **unverified**: no point passed |
| bookcase | **unverified**: no point passed |

An unverified spot is never offered: `WorldSpots.normalize` drops it, so it
reaches neither the prompt nor `intentOf`.

## 7. Camera, person and headset

The camera offset was measured in the real app with the apartment shown
(the `cam.cjs` walkthrough). Each value is relative to her root:

| Device profile | Camera (x, y, z) | FOV |
| --- | --- | --- |
| desktop 1440×860 | (0, 0.96, 4.49) | 30° |
| iPhone 13 | (0, 0.94, 3.80) | 42° |
| iPhone 13 landscape | (0, 0.95, 4.04) | 30° |
| Pixel 7 | (0, 0.97, 4.65) | 42° |

**Framing.** `CameraPresets` (`src/gltf-viewer/CameraPresets.js`) offers:

- `fullBody`, the default
- `mid`: target at centre + 0.18·height, distance 1.35·height (LW3)
- `bust`: distance 0.55·height
- `face`

A spot's `framing` is applied by `ViewerEngine` on `nexus-world-framing`, which
`WorldPresence` emits from `goToSpot`'s `whileDark` hook. The closer of "spot
framing" and "screen framing" (`VRWorlds.framingFor`) wins. **Never in XR.**

**In a headset:**

- The person is the camera. Nothing in this pipeline moves the XR reference
  space.
- A spot move re-places the room around both of you behind a 0.25 s fade
  (`FADE_SECONDS`). It runs only on the person's own request or yes.
- Smooth movement of the world is never used.
- **Headset comfort is untested on hardware.**

## 8. Five kinds of movement, and what exists

| Movement | What happens | Status |
| --- | --- | --- |
| Another spot in the same loaded scene | `runtime.goToSpot`: fade, rewrite `vr-world-scene:` `rotation.y`/`position`, fade; `spotId` confirms | **Implemented** (LW3) |
| Repositioning scene geometry relative to the avatar | the same mechanism; she stays at the origin | **Implemented** |
| Changing the active world | `session.enter('experiences', 'place-<id>')` → `ViewerEngine._applyVRWorld` → `runtime.show` (preload, fade, swap) | **Implemented** (VW3, LW5) |
| The avatar walking a navigable path | `AvatarLocomotionSystem.walkToPoint` exists (VR arc pointer) but has no collision and no route; no nav graph | **Future** (LW6/LW8) |
| Teleporting the user in VR | `TeleportArcPointer` makes *her* walk; the person moves by thumbstick | user teleport is **future** |

## 9. When coordinates become invalid

- **The model changes.** A recipe change, a new export or a re-import changes
  its SHA-256, and `tests/living-worlds/world-spots.test.js` fails until you
  re-run `measure-spots.mjs`.
- **A world points at another scene file.** It gets that file's spots or none;
  coordinates never cross.
- **`scale` changes in `worlds.json`.** `placementFor(spot, scale)` scales the
  spot. Re-measure anyway, because the clearances were measured at scale 1.
- **The camera framing changes** (CameraPresets distances, the default FOV).
  Update `PARAMS.camera`, `mid` and `bust` in the tool and re-measure every
  scene.
- **Labels and `sees` change.** Edit `spot-targets.json` and the measured file
  identically, or re-run the tool. A test fails on drift.

## 10. References

- three.js `Object3D` transforms and `Raycaster`: https://threejs.org/docs/#api/en/core/Raycaster
- Khronos glTF 2.0 coordinate system (+Y up, metres): https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units
- WebXR reference spaces: https://www.w3.org/TR/webxr/#xrreferencespace-interface
- Meta comfort guidance (blink and teleport over smooth motion): https://developers.meta.com/horizon/resources/locomotion-comfort-usability/
