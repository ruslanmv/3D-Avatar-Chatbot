# Three pilot garments under `?cloth=xpbd` — contract captures

Date 2026-11-08. Track A, POC 1 ("baseline asset and physics contract"). No
third-party physics engine. **Exit criterion not met**: no A-line pose is
visually acceptable and every pose fails the gate. The numbers below say which
contract fixes worked and which defects remain.

Nothing here marks a catalog row fixed. The November 7 and November 8 catalog
matrices were not touched.

## Setup

| Item    | Value                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------- |
| Viewer  | this branch (`claude/clothing-physics-upgrade-9cq16j`, on PR #141 `65a62a4`), `node nexus-proxy/server.js` on :8080          |
| Forge   | `3D-Wardrobe-Forge` branch `claude/clothing-physics-upgrade-9cq16j` (on PR #28 `b65d56e`), `uvicorn apps.api.main:app` on :8090 |
| Avatar  | `vendor/avatars/fem_vroid.vrm` (SHA-256 `98363103…bacb8`, same as Forge's library manifest)                                  |
| Capture | `audits/wardrobe_sitting_desk/capture.py` unchanged, four poses, four cameras, `--source catalog`, one garment per run        |
| Output  | `/tmp/cloth-contract-aline`, `/tmp/cloth-contract-pencil`, `/tmp/cloth-contract-pleated` (full PNGs and manifests, local)     |

Contact sheets (front, right, back, left; cropped to the avatar) are in
`captures/2026-11-08/`.

## What the Forge compiler now exports for `fem_vroid`

| Template                | Before (PR #28)                                        | After SB1 + PA1                                                                        |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `dress-a-line-v1`       | `fallback-skinning`, 32 missing seams, height-fallback pins (neckline) | `xpbd`, 0 missing, 32-pair 1.0 mm shell offset held by bridge rows, **bodice pinned** |
| `skirt-pencil-v1`       | `xpbd`, 0 missing, waistband section pins              | unchanged                                                                              |
| `skirt-pleated-mini-v1` | `fallback-skinning`, 1129 missing                      | `fallback-skinning`, **22 missing**: 1107 were hem folds; 22 are an unwelded front-centre waistband slit 0.13–6.0 mm wide |

The pleated mini therefore still runs the legacy pose corrector under the flag.
That is the correct outcome: its slit is a real gap and SB1 does not sew it.

## A-line, three builds

Gate limits 1 mm / 6x / 8 mm. Values are the XPBD row's `after` numbers from
each run's `manifest.json`.

| Build                      | Pose           | Pen mm | Stretch | Span mm | Picture                                                                      |
| -------------------------- | -------------- | -----: | ------: | ------: | ---------------------------------------------------------------------------- |
| M1 (file vertex order)     | standing       |   80.2 |    1.32 |     8.2 | Skirt rolled into a balloon, holes show the briefs                           |
|                            | sittingDesk    |   76.6 |    4.04 |    50.8 |                                                                              |
|                            | sittingWide    |   67.3 |    1.49 |     8.0 | Whole dress front gone behind her; torso and briefs exposed                  |
|                            | sittingCrossed |   63.1 |    4.75 |    58.4 |                                                                              |
| M1 + M2 (pose rests, fitted capsules) | standing |   72.3 |    1.25 |    24.2 | Front still torn at the waist, flap at the back                         |
|                            | sittingDesk    |   34.3 |    2.84 |    85.8 |                                                                              |
|                            | sittingWide    |   34.4 |    3.01 |    96.7 | Floating hoop at hip height, bodice torn                                     |
|                            | sittingCrossed |   33.8 |    2.92 |   101.7 |                                                                              |
| M1 + M2 + PA1 (bodice pins) | standing      |   75.4 |    1.28 |    11.2 | **Bodice and front closed**; one flap out at the back-left hip; hem frayed   |
|                            | sittingDesk    |   34.0 |    2.89 |    71.4 |                                                                              |
|                            | sittingWide    |   30.1 |    3.08 |    82.7 | **Waist no longer torn**; front skirt is still a hoop over the lap, briefs in the opening |
|                            | sittingCrossed |   39.9 |    2.93 |    81.8 |                                                                              |

For comparison, the audit's broken-binding build read 9.29x stretch standing.
Every M1 run reads 1.25–1.32x, which is the evidence the vertex-order guard
holds in the browser.

### What the solver itself reported (diagnostic run, same build)

| Pose        | Fitted thigh radius               | Solver strain | Gate pen | Penetrating |
| ----------- | --------------------------------- | ------------: | -------: | ----------: |
| standing    | 60.4 / 60.4 mm (bone formula 102.4) |          1.80 |  75.4 mm |      11.6 % |
| sittingWide | 68.0 / 62.2 mm                    |      **40.6** |  30.1 mm |      11.2 % |

- Standing: the solver is not tearing anything (strain 1.8), yet 11.6 % of the
  render vertices are inside her. The solver's only colliders are two thigh
  capsules. Nothing stops the skirt at the buttocks or the hips, which the
  legacy corrector handles by pushing against the whole body mesh. **Next
  defect: the body collider is too small**, not the capsule radius.
- Sitting wide: strain 40.6 means one constraint is 40x its pose rest. With
  1 mm shell bridges that is the skirt top pulled about 4 cm away from the
  pinned bodice, and it is the hoop in the picture. The lift comes from
  `BodyCollision.collideLap` raising a 10 cm hem band to the top of the thigh
  capsule (Problem D). **Next defect: replace the lap lift with contact.**
- `answer.contacts` from the worker is `state.frames` (always 24), not a
  contact count. A PR #140 reporting bug; recorded, not changed here.

## Pencil skirt (M1 + M2; its asset is unchanged by SB1/PA1)

| Pose           | Pen mm | Stretch | Span mm |
| -------------- | -----: | ------: | ------: |
| standing       |   66.4 |    1.34 |    16.1 |
| sittingDesk    |   39.9 |    2.71 |    68.6 |
| sittingWide    |   34.4 |    3.54 |    79.0 |
| sittingCrossed |   41.0 |    2.62 |    82.0 |

Standing picture: holes and side flaps, waistband gap. Same two remaining
defects as the A-line. The separate `Black Pencil Skirt Waistband` piece runs
the legacy corrector and passes standing (0 / 1.15 / 0).

## Pleated mini (legacy corrector: asset is `fallback-skinning`)

| Pose           | Pen mm | Stretch | Span mm |
| -------------- | -----: | ------: | ------: |
| standing       |      0 |    1.35 |       0 |
| sittingDesk    |   49.3 |       6 |    39.5 |
| sittingWide    |   60.3 |    8.68 |    61.2 |
| sittingCrossed |   25.4 |    6.03 |    47.9 |

These are the historical seated failures of the legacy path, unchanged.

## Order of the next fixes

1. Diagnostics console (M5) first, on this build: the 75 mm standing points are
   unknown and the console is what draws them.
2. A body collider beyond the two thighs (pelvis and buttock capsules fitted
   the same way as M2, or the three-mesh-bvh query in the console proving
   capsules insufficient).
3. Replace `collideLap`'s hem-band lift with one-sided contact on the seated
   thigh tops (Problem D). Do not add a percentage.
4. Forge: weld the pleated waistband's front-centre slit in the generator, then
   SB1 lets it simulate.

Rapier is not compared against this baseline yet. The baseline is not valid.
