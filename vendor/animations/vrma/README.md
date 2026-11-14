# VRMA Animation Files

All clips here are native VRM Animation (`.vrma`) files. Licences and upstream
copyright notices: [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).

## Active (in `vendor/animations/manifest.json`, category `vrma`)

| File                    | Used for                                                          |
| ----------------------- | ----------------------------------------------------------------- |
| `waiting-standard.vrma` | idle pool                                                         |
| `idle_loop.vrma`        | idle pool — ChatVRM's breathing idle (MIT, staged in PR #153)     |
| `Angry.vrma`            | `angry` emotion                                                   |
| `Sad.vrma`              | `sad` emotion                                                     |
| `Thinking.vrma`         | `thinking` emotion                                                |
| `Surprised.vrma`        | `surprised` emotion                                               |
| `Relax.vrma`            | `relax` / idle state                                              |
| `Blush.vrma`            | `blush` gesture, `love` emotion                                   |
| `Clapping.vrma`         | `clap` gesture                                                    |
| `Goodbye.vrma`          | `goodbye` gesture ("bye", "see you")                              |
| `Jump.vrma`             | `jump` gesture, `surprised` emotion fallback                      |
| `LookAround.vrma`       | `look_around` gesture, `thinking` emotion fallback                |
| `Sleepy.vrma`           | `sleepy` gesture ("I'm tired")                                    |
| `show_outfit.vrma` | `show_outfit` — "show me your outfit" (BOOTH VRoid) |
| `peace_sign.vrma` | `peace_sign` — "peace sign" (BOOTH VRoid) |
| `finger_gun.vrma` | `finger_gun` (BOOTH VRoid) |
| `spin.vrma` | `spin` — "spin", "twirl" (BOOTH VRoid) |
| `model_pose.vrma` | `model_pose` — "strike a pose" (BOOTH VRoid) |
| `playful_dip.vrma` | `playful_dip` (BOOTH VRoid “Squat”) |
| `turn_aside.vrma` | `turn_aside` (mocopi) |
| `open_arms.vrma` | `open_arms` — welcome (mocopi) |
| `hand_on_heart.vrma` | `hand_on_heart` — sincere (mocopi) |
| `explain.vrma` | `explain` — talking with her hands (mocopi) |
| `present.vrma` | `present` — "look at this" (mocopi) |

## Why six of these were "inactive" until MO8

Blush, Clapping, Goodbye, Jump, LookAround and Sleepy were parked as "not
compatible with the avatar skeleton". The skeleton was never the problem. Every
tk256 clip stores its hips as glTF node **0**, and the loader looked that index
up with a helper that returns `value || null` — so the clip's rest hips height
read as 0, height scaling fell back to ×1, and the clip's absolute hips height
(~0.87 m, authored on a 0.90 m rig) was written onto every avatar as-is. On a
0.90 m avatar that is invisible; on VRM_Viewer_Sample (0.69 m) she floated
~0.2 m off the floor, on Vita (0.98 m) she sank into it. The same bug affected
the five "active" clips too. `src/VRMAAnimationLoader.js` (MO8) now reads the
index directly and scales to the avatar's recorded rest height.

## Rotated rest poses (MO10)

The BOOTH Spin, Model pose and Squat clips keep their hips under a `root` node
with a ~120° rest rotation. Played as raw tracks they tipped her over sideways
with her hips still at standing height. The loader now converts every bone track
out of the clip's own rest frame (`parentRest · track · rest⁻¹`, as
@pixiv/three-vrm-animation does) — the identity for every other clip here.

Clips that failed review are tagged in `develop/NEEDS_FIX.md`.

## Before adding a clip

1. Stage it under `develop/addons/stable/` and run
   `node develop/verification/audit-additive.mjs` (exit 0, all ok).
2. **Look at the frames**, not only the numbers: hips height missed both a
   sideways tilt and a leg flip. Measure it on more than one avatar height — a clip that is fine on
   AvatarSample_A can float or sink elsewhere. `node tools/qa/animation-audit.mjs
   --play --avatar <name>` covers the shipped matrix.
3. Record its upstream and licence in `THIRD_PARTY_LICENSES.md`, then add it to
   the `vrma` category in `vendor/animations/manifest.json`.
