# Current-state audit — clothing physics

Audit date: 2026-11-08. This document records the GitHub heads that existed that day and the defects confirmed by reading those commits and by local Try-On captures. It does not change the solvers.

Nothing in this audit marks a catalog row `fixed=yes`. The November 7 and November 8 CSVs were not rewritten.

## 1. GitHub heads

No pull request below is merged. No branch was reset.

### 3D-Avatar-Chatbot

| PR | State | Base | Head branch | Head SHA |
|---|---|---|---|---|
| [#140](https://github.com/ruslanmv/3D-Avatar-Chatbot/pull/140) | open draft | `cursor/cloth-xpbd-runtime-5f80` | `cursor/xpbd-skirt-lap-integration-20261108` | `5d68d651682bdcffb31b9ca59b7f9be63b202908` |
| [#138](https://github.com/ruslanmv/3D-Avatar-Chatbot/pull/138) | open | `cursor/wardrobe-catalog-matrix-5f80` | `cursor/cloth-xpbd-runtime-5f80` | `623d0b214f19cf597f1af85f430de82e9e1409b6` |
| [#137](https://github.com/ruslanmv/3D-Avatar-Chatbot/pull/137) | open | `cursor/wardrobe-audit-quality-5f80` | `cursor/wardrobe-catalog-matrix-5f80` | `5d78262461caf09f19265586bb2baa5d8c6e48f0` |
| [#136](https://github.com/ruslanmv/3D-Avatar-Chatbot/pull/136) | open | `audit/wardrobe-sitting-desk-capture-20261107` | `cursor/wardrobe-audit-quality-5f80` | `b345da33dd9d522c9e3113134df15d11cc94a52d` |
| [#135](https://github.com/ruslanmv/3D-Avatar-Chatbot/pull/135) | open draft | `feat/living-worlds-spatial-storytelling` | `audit/wardrobe-sitting-desk-capture-20261107` | `bb86483a32f9ab81a04b83a29e2c82db6cb6f025` |

`5d68d65` is still the tip of PR #140. Nothing on GitHub has superseded it. Checks on that commit succeeded for Behavior Director, the offline wardrobe audit, GitGuardian, and the Vercel preview. The capture job was skipped. Jest on that commit, as recorded by the PR, is 3 suites and 33 tests. A later local run of the same three files, after uncommitted test additions, was 36 tests. Those additions are not on `5d68d65`.

### 3D-Wardrobe-Forge

| PR | State | Base | Head branch | Head SHA |
|---|---|---|---|---|
| [#28](https://github.com/ruslanmv/3D-Wardrobe-Forge/pull/28) | open | `cursor/cloth-asset-contract-5f80` | `cursor/cloth-xpbd-asset-5f80` | `b65d56e7060b1eefc578072a5a9aec94ffd428a4` |
| [#27](https://github.com/ruslanmv/3D-Wardrobe-Forge/pull/27) | open | `main` | `cursor/cloth-asset-contract-5f80` | `529541d8ca476297615157b673f29da1f1e5b0a4` |
| [#26](https://github.com/ruslanmv/3D-Wardrobe-Forge/pull/26) | open | `main` | `cursor/skirt-underskirt-color-5f80` | `3a60652816ac5c02a3c71178ddbf539fcb1eb845` |

PR #26 is the underskirt colour rule (white panties, white underskirt, 4 cm past the outer hem, capped at the ankle). It is not part of the XPBD asset branch. Do not edit it from a physics PR.

The public Forge at `https://ruslanmv-3d-wardrobe-forge.hf.space` advertises bake-time relaxation. It does not serve the unreleased `wardrobe.cloth/1` buffer. A Try-On pointed at that host never executes XPBD. Local captures that did execute XPBD used a Forge process built from PR #28 plus uncommitted seam classification, with `--forge-url http://127.0.0.1:8090`.

## 2. What the committed runtime actually does

```text
Forge GLB (wardrobeForge.clothAsset + WCL1 bufferView)
  -> GLTFLoader
  -> AvatarManager retains the buffer only when ?cloth=xpbd
  -> three-vrm removeUnnecessaryVertices renumbers every indexed mesh
  -> PoseClothCorrector skins the renumbered mesh
  -> worker, only for dress-a-line-v1, skirt-pencil-v1, skirt-pleated-mini-v1
  -> ClothSimulation preroll (24 frames on 5d68d65)
  -> scatter binding i0 onto render vertices
  -> inverse skin back into the position attribute
```

Without `?cloth=xpbd` the worker message has no `solver` field and calls `NEXUS_POSE_CLOTH_CORRECTION.correct()`. That path is covered by `tests/wardrobe/pose-cloth-worker-default.test.js`.

The XPBD path is a settled-pose preroll, not a per-frame simulator. `PoseClothCorrector` posts `frames: 24` (`src/gltf-viewer/PoseClothCorrector.js` around the pilot job). `ClothSimulation.create` sets inverse mass to 0 when `attachment >= 0.999` and never reads a new bone matrix. Pins stay where the preroll started.

## 3. Confirmed defects

Each item names the commit or the local capture that established it.

### 3.1 Vertex order does not match the WCL1 binding — confirmed, runtime

`AvatarManager.js` in `5d68d65` calls `VRMUtils.removeUnnecessaryVertices(vrm.scene)` unconditionally (line 481). three-vrm 2.1.0 (`@pixiv/three-vrm@2.1.0`, `removeUnnecessaryVertices`) builds a new geometry whose vertices are ordered by first use in the index buffer, even when every vertex is already used.

Measured on a locally generated A-line (`look_e3d917fc41144714`, Forge PR #28 compiler):

| Source | First index values |
|---|---|
| GLB accessor | `0, 1, 34, 0, 34, 33, 1, 2, 35` |
| Browser mesh after three-vrm | `0, 1, 2, 0, 2, 3, 1, 4, 5` |

The binding still addresses the file order. The solver then writes particle positions onto the wrong vertices. Standing A-line on that scrambled mesh reported solver `xpbd`, 1536 particles, strain about 1.08, and render stretch 9.29×. The dress opened at the waist.

Skipping the compact pass for nodes whose `wardrobeForge.clothAsset.schema` is `wardrobe.cloth/1` restored the file index prefix. The same scene then reported standing stretch 1.17×. That skip is in the local working tree only. It is not on `5d68d65` and it is not a completed acceptance run.

This defect is independent of which solver runs. Rapier or Jolt would tear the same skirt if they consumed the renumbered mesh with the authored binding.

### 3.2 Authored rest lengths are the T-pose, particles are the skinned pose — confirmed, runtime

`XpbdSkirtPilot.initialParticles` (committed) initialises particles from skinned world positions. Stretch rests in the WCL1 blob are bind-space lengths. On `5d68d65`, `alignRestLengths` accepts a median ratio near 1 and leaves every rest at the bind length, including the 1 mm bodice/skirt bridges.

A node replay of the exported A-line (1536 particles, 4512 stretch constraints, no capsules, quasistatic, gravity) moved the worst constraint from 1.000 to about 2.17 over 24 frames. The worst edge was a bridge whose rest is 1.0017 mm. Separately, the live worker compared its output with `PoseClothCorrector`'s `rest` field, which is `mesh.matrixWorld` applied to bind positions (lines 289–303), not the skinned pose. Those two lengths are not the same measurement.

Pulling the skinned waist back toward bind-space bridges opened a beige gap in the standing dress before any capsule was involved. Adopting the skinned distance as the rest, in the local tree only, stopped that particular tear. Standing then read stretch 1.06× and penetration 0. Span drop stayed above the 8 mm gate (17.1 mm at 8 frames, 29.3 mm at 24 frames).

### 3.3 Thigh capsules are not the skin — confirmed, runtime

`XpbdSkirtPilot.thighCapsules` in `5d68d65` sets `radius = clamp(length * 0.29, 0.045, 0.14)`. On `fem_vroid` the upper-leg bone is 0.353 m, so the radius is about 0.102 m. A distance sample of the body mesh around that bone was a median of about 84 mm in a loose band, not a clean skin radius. The 102 mm capsule starts outside the skin and intersects the skirt.

Standing with that radius produced on the order of 10^5 collision reports across the preroll and tore the dress. One quasistatic step of the same asset with no capsules stayed near strain 1.02. The explosion is the capsule, not the rest lengths. Shrinking the radius in the local tree reduced standing contacts to the tens and stopped the standing tear. It did not make the seated hem rest on the lap.

`BodyCollision.collideLap` lifts every hem particle inside the capsule footprint up to the top of the capsule. The hem mask is the bottom 10 cm of the garment (`hemMax = loY + min(0.10, height * 0.16)`). That combination turns a knee-length skirt into a ring at the hips. Local sitting-wide frames show that ring, with beige briefs in the opening. That is a failed picture even where stretch stays under 6×.

### 3.4 A-line and pleated assets are not `simulation: xpbd` on the committed Forge compiler — confirmed, asset

PR #28 at `b65d56e` counts an open boundary whose nearest partner is within 15 mm as a missing seam and emits `fallback-skinning`. The A-line bodice ends at `hip_y` and the skirt starts at `hip_y + 1e-3` (`wardrobe/geometry/procedural.py`). Those are two loops, 1.0 mm apart, same XZ. The committed compiler reports missing seams and will not simulate. The pleated mini's "missing seams" on that compiler are folds of a single boundary loop, not a real gap.

A local classifier change (not committed, not on PR #28) treats same-loop folds as closed and holds a cross-loop gap of at most 1.5 mm with an extra stretch constraint instead of moving vertices. After that change the local Forge emitted:

| Template | Particles | Render verts | Simulation |
|---|---:|---:|---|
| `dress-a-line-v1` | 1536 | 1584 | xpbd |
| `skirt-pencil-v1` | 1312 | 1419 | xpbd (already, before the classifier change) |
| `skirt-pleated-mini-v1` | 7495 | 8834 | xpbd |

Pencil and pleated have not had a browser XPBD capture. Pleated at 7495 particles is the full mesh. The worker does not select the WCL1 LOD (`mobile-mid` 200, `mobile-high` 500, `desktop` 1200).

### 3.5 Pins do not follow the skeleton — confirmed, runtime

`ClothSimulation.create` freezes `attachment >= 0.999` by inverse mass. Nothing in `step` writes the current waistband bone into those particles. For a single settled pose this matches the pose that was just skinned. It is not an animated attachment. Height-fallback pins are the top 4 cm of the mesh (`wardrobe/cloth/topology.py`, `WAIST_FULL_M`). On a dress that is the neckline, not the hip join.

### 3.6 Seated A-line is still wrong after the local binding fix — confirmed, visual, not accepted

Local captures against `http://127.0.0.1:8080/?cloth=xpbd` and a local Forge. Avatar `fem_vroid.vrm`. These numbers are not on a PR.

| Build | Pose | Solver | Pen mm | Stretch | Span mm | Notes |
|---|---|---|---:|---:|---:|---|
| Legacy, local Forge | standing | pose corrector | 0 | 1.23× | 0 | Closed knee-length dress |
| Legacy, local Forge | sitting wide | pose corrector | 6 | 6× | 11.2 | Hem hangs through the lap |
| XPBD, scrambled vertices | standing | xpbd | 24 | 9.29× | 35.3 | Waist opened |
| XPBD, file vertex order, 8-frame preroll, narrower rim | standing | xpbd | 0 | 1.06× | 17.1 | Closed dress, span gate still open |
| Same | sitting wide | xpbd | 30.9 | 2.87× | 87.9 | Floating hoop, briefs visible, not on the lap |

Gates remain 1 mm, 6×, and 8 mm. A picture of a hoop with stretch under 6× is still a failure. A closed standing dress with 17 mm span drop is still a failure.

Historical catalog numbers (pose corrector, not XPBD) stay the baseline for the other garments: pencil sitting-desk collapse, pleated sitting-wide penetration, fitted-tee sitting-crossed regression, leggings stretch, boot articulation. Those were not re-measured on the XPBD flag. The flag does not select them.

## 4. What is missing, not just buggy

- No per-frame schedule. The worker runs once per settled pose.
- No animated kinematic targets.
- No garment self-collision.
- No LOD selection at runtime.
- No separation between the quality-gate mesh query and the collision primitive. The gate walks body triangles. The solver only sees two capsules.
- No proof that the public catalog can supply a WCL1 buffer. It cannot, until Forge PR #28 is released and the Try-On is pointed at it.
- Browser captures of pencil and pleated under `?cloth=xpbd` do not exist.
- No phone timing. The 0.332 ms grid benchmark in `docs/CLOTH_MOBILE_BENCHMARKS.md` is a 196-particle step on a cloud VM with no avatar and no capsules.

## 5. Coverage that does exist

- Default worker protocol test: no `solver` field, legacy `correct()`.
- Fitted tee cannot enter `seatRisenHem`.
- Lap, pin, and brief-clearance unit tests. They check one particle against a hand-built capsule. They do not load a VRM.
- Offline wardrobe audit workflow. It does not execute XPBD in a browser. The capture job on PR #140 was skipped.
- `print_matrix.py` and `review_pictures.py` exist. They were not run on the XPBD frames. The historical CSVs were left byte-for-byte.

## 6. Local work that must not be mistaken for this PR

The checkout of `cursor/xpbd-skirt-lap-integration-20261108` has uncommitted edits (vertex-order skip, pose rests, capsule radius, hem band, preroll length, Forge seam classifier). Those edits produced the measurements in section 3. They are not part of the architecture branch and they were not pushed to PR #140.
