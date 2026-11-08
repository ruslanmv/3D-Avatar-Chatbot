# Open-source add-on adoption matrix

Checked 2026-11-08 by installing each package into a scratch directory (never
into this repository) and reading the installed files, not the docs site. Every
number below was measured in this session on a cloud VM unless it says
**unverified**. A cloud VM is not a phone: no row here is a mobile frame-rate
claim.

Extends `OPEN_SOURCE_ENGINE_COMPARISON.md` (PR #141). Where that file said
"not installed here", this one says what the installed package actually does.

## Verdicts

| Add-on                         | Verdict             | One-line reason                                                                                                                       |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| meshoptimizer 1.3.0            | **Adopt now** (Forge build-time only) | On the real pleated mini it reaches the 1200 desktop budget at 4.2 mm max deviation; Forge's own decimator stops at 2037 particles and 92 mm |
| Rapier 0.21.0 (`-compat`)      | **Prototype next**  | The soft-body API we need is really exported and pins follow kinematic targets exactly; quality on a garment is unproven and the payload is 1.66 MB gzip |
| three-mesh-bvh 0.5.23          | **Prototype next** (diagnostics only) | The last release that accepts our three r147; no `SkinnedMeshBVH` there, so it is built over posed positions we already compute |
| JoltPhysics.js 1.1.1           | **Reference only** for now | MIT, real soft bodies, but a 12.7 MB package and manual `destroy`; start only if Rapier fails a criterion it was meant to win       |
| PositionBasedDynamics          | **Reference only**  | MIT C++ algorithm reference for our existing XPBD step; nothing to install                                                             |
| three-vrm spring bones         | **Reference only** (hair, ribbons) | Already loaded (2.1.0); not a surface model. Its `removeUnnecessaryVertices` is the M1 defect                                     |
| Ammo.js 0.0.10                 | **Reject for now**  | npm release last modified 2022-06-13, no license field on the npm entry, nothing it does that Rapier or our XPBD does not             |

## Matrix

| Requirement            | meshoptimizer                                                                | Rapier `@dimforge/rapier3d-compat`                                                                                                                         | three-mesh-bvh                                                                                         | JoltPhysics.js                                    | Ammo.js                    |
| ---------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | -------------------------- |
| Version checked        | 1.3.0 (npm, modified 2026-09-25)                                             | 0.21.0 (npm, modified 2026-09-25)                                                                                                                          | 0.9.18 latest; **0.5.23 usable**                                                                       | 1.1.1 (npm, modified 2026-10-23)                  | 0.0.10 (2022-06-13)        |
| License                | MIT                                                                          | Apache-2.0                                                                                                                                                 | MIT                                                                                                    | MIT (npm field; read the tag's LICENSE before use) | none on the npm entry      |
| Replaces               | `wardrobe/cloth/topology.py` `simplify_particles`                            | `ClothSimulation.js` step + `BodyCollision.js` capsules, if it wins                                                                                       | Linear body-triangle scans in the quality gate (diagnostics first)                                     | Same as Rapier                                    | nothing                    |
| Browser / three r147   | Not in the browser at all (build-time)                                       | No three dependency; positions in and out                                                                                                                  | 0.9.x needs `three >= 0.159`; 0.6–0.7 need `>= 0.151`; **0.5.23 needs `>= 0.123`**                    | No three dependency                               | n/a                        |
| WASM                   | Yes, inlined; Node at build time                                             | Yes. `rapier_wasm3d_bg.wasm` 3.08 MB, inlined in `rapier.mjs` (4.34 MB raw, **1.66 MB gzip**)                                                              | No                                                                                                     | Yes, package 12.7 MB                              | Yes                        |
| Worker                 | n/a                                                                          | `init()` ran in Node in 83 ms; in a classic worker: **unverified** (our worker uses `importScripts`, Rapier ships ESM/CJS)                                  | Has a worker builder; unverified here                                                                  | unverified                                        | n/a                        |
| Asset compatibility    | Consumes WCL1 particle positions and triangles directly                      | `new SoftBodyDesc(positions).setEdges().setBendEdges().setPinnedParticles()` built the real A-line: 1536 particles, 8864 edges, no grid                      | Consumes the posed body positions `PoseClothCorrector` already builds                                  | Adapter needed; unverified                        | unverified                 |
| Measured               | See POC 2                                                                    | See POC 4                                                                                                                                                  | Not run                                                                                                | Not run                                           | Not run                    |
| Mobile                 | No runtime cost                                                              | **unverified**                                                                                                                                             | **unverified**                                                                                         | **unverified**                                    | **unverified**             |
| Risk                   | A collapse across a pleat fold; mitigated by boundary locks and a deviation gate | Default material is far too soft for cloth (34x strain); first step costs 70–90 ms; 1.66 MB on the critical path if not lazy                             | Building per settle on ~100k body triangles: cost unmeasured                                           | Native lifetime leaks                             | Unmaintained               |
| Rollback               | Keep `simplify_particles`; LOD rows fall back to `mesh: full`                | Remove `?cloth=rapier`; the default page never imports it                                                                                                  | Remove the debug flag                                                                                  | Never installed                                   | Never installed            |

## POC 2 — meshoptimizer on the real pleated mini (`skirt-pleated-mini-v1`)

Input: the WCL1 Forge built for `fem_vroid` through the real pipeline (SB1
compiler). 7495 particles, 14976 triangles, one connected component, 305
open-boundary vertices, **1734 pinned** (the whole waistband section) and 288
non-manifold edges.

Deviation is the distance from every original particle to the coarse surface,
computed the same way for both tools.

| Simplifier                       | Locks                       | Target | Particles | Triangles | Max dev mm | p95 dev mm | Time       |
| -------------------------------- | --------------------------- | -----: | --------: | --------: | ---------: | ---------: | ---------- |
| Forge `simplify_particles`       | boundary + pinned           |   1200 |  **2037** |      4058 |      91.97 |      60.53 | 3.7 s      |
| Forge `simplify_particles`       | boundary + pinned           |    500 |      2037 |      4058 |      91.97 |      60.53 | 3.8 s      |
| meshoptimizer `simplifyWithAttributes` | boundary + pinned     |    any |  **2180** |      4344 |          — |          — | < 0.1 s    |
| meshoptimizer, attachment as attribute | boundary only         |   1200 |  **1200** |      2125 |   **4.24** |   **1.96** | 59 ms      |
| meshoptimizer, attachment as attribute | boundary only         |    500 |       749 |      1198 |      57.28 |      34.97 | 70 ms      |

What this says:

- **No simplifier can meet 200 or 500 on this asset while every pin is kept**:
  2027 vertices are locked before anything collapses. That is an asset
  finding, not a tool limitation. A pinned particle is skinned, not simulated,
  so the right fix is to stop counting pinned waistband particles against the
  simulation budget, or to pin only the waistband's lower boundary. Neither is
  done here.
- Forge's decimator collapses the shortest edge first with no error metric. It
  never reaches the budget and still moves the surface by up to 92 mm.
- meshoptimizer with boundary locks keeps every open-boundary vertex (checked)
  and one component, and meets the desktop budget at 4.2 mm.
- 749 particles is meshoptimizer's floor with boundary locks; at that point
  the error is 57 mm, which is a damaged skirt, so **mobile-mid and
  mobile-high are reported as not achievable** for this template rather than
  shipped.

Integration shape (PR B): a Node build step in Forge (`tools/cloth/lod.mjs`,
`meshoptimizer` pinned exactly) called from `wardrobe/cloth/asset.py` `_lods`,
output checked by the existing Python LOD tests plus a deviation gate. The
simplifier returns an index buffer over the **same** vertex array, so particle
identity is never renumbered: the coarse map is "kept particle → itself,
removed particle → its collapse target", which is the M1 lesson applied to
LODs.

## POC 4 — Rapier, API verification on the real A-line

`@dimforge/rapier3d-compat@0.21.0`, Node 24, cloud VM. A-line WCL1 from the
SB1 compiler (1536 particles, 4512 stretch rows including 32+ shell bridges,
4352 bend pairs, 64 pins). Garment only, no avatar, no capsules, gravity, 24
steps. This verifies the API and gives a microbenchmark on our topology; it is
**not** a garment-quality result.

| Item                                   | Result                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `SoftBodyDesc`, `World.createSoftBody` | Present in the installed `.d.ts` and ran                                                     |
| Raw positions + our edges              | `new SoftBodyDesc(Float32Array)` + `setEdges` + `setBendEdges` built 1536 particles, 8864 edges |
| `setPinnedParticles`                   | Works                                                                                        |
| `setParticleKinematicTarget`           | Pins moved 10 mm and matched the target to 0.00 mm                                           |
| `particlePositions()`                  | Returns a `Float32Array` in particle order                                                   |
| `World.free()`                         | Ran; arrayBuffer delta 0.1 MB after                                                          |
| `init()`                               | 83 ms                                                                                        |
| `createSoftBody`                       | 7.6 ms                                                                                       |
| Step p50 / first step                  | 3.6–6.6 ms / 70–91 ms                                                                        |
| Strain after 24 steps, default material | **34.2x** (far too soft)                                                                     |
| Strain, `setSoftness(120 Hz, 1)`       | 2.7x                                                                                         |
| Strain, 480 Hz / 2000 Hz               | 7.0x / 7.9x (stiffer is not monotonically better)                                            |
| Repo XPBD, same 24 frames              | p50 5.6 ms, strain 4.0x                                                                      |

Both strains are large because this asset still pinned its neckline (height
fallback) and hung free with no body. That is Problem E, fixed in Forge PA1
after this measurement.

## Not run, and why

- **three-mesh-bvh**: nothing installed into the viewer. A BVH over the posed
  body is the right first use (diagnostics), but the contract still fails on
  the real garments, and a diagnostics overlay on a failing solver is the
  next PR, not this one.
- **Jolt, Ammo**: not installed. Rapier has not failed a criterion it was
  meant to win.
- **Phone timing**: no device in this session.
