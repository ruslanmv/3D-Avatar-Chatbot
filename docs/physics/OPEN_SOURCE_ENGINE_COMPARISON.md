# Open-source engine comparison

Reviewed 2026-11-08 against upstream docs and published packages. This repository does not depend on any of these libraries. Nothing here was executed on a Try-On garment. Where a behaviour was not run, it is marked unverified.

## Rapier — candidate A

- Repository: https://github.com/dimforge/rapier
- JavaScript docs: https://rapier.rs/docs/user_guides/javascript/soft_bodies/ and https://rapier.rs/javascript3d/classes/SoftBodyDesc.html
- Package: `@dimforge/rapier3d` and `@dimforge/rapier3d-compat`
- Published version observed on npm: 0.21.0 (package page updated 2026-09-25)
- License: Apache-2.0

### What the published JavaScript API actually contains

`@dimforge/rapier2d-deterministic@0.21.0` ships `dynamics/soft_body.d.ts` on jsDelivr. That file is the 2D build. It declares:

- `SoftBodyDesc` constructed from particle positions, plus `setEdges`, `addEdges`, `setPinnedParticles`, `setParticleRadius`, `setLinearDamping`, `setSoftness`
- `SoftBody.setParticlePinned`, `setParticlePosition`, `setParticleVelocity`
- `SoftBody.setParticleKinematicTarget(i, position)` — a pinned particle is moved to a target over the next step and then held
- `SoftBody.attachParticle(i, body)`
- sleeping, forces, impulses, cluster stiffness, and tear events

The official 3D class page additionally documents generators `SoftBodyDesc.cloth`, `clothAnisotropic`, `clothTube`, and a raw-position constructor, and it lists `trimesh` among the 3D generators. This workspace did not `npm install` the 3D package, so a PoC must pin `@dimforge/rapier3d-compat@0.21.0` (or a newer release that still exports `SoftBodyDesc`) and fail the build if `createSoftBody` is missing. Do not vendor a docs snippet that the installed version does not export.

### Fit for our garments

| Need | In the published API | Still ours |
|---|---|---|
| Arbitrary triangle mesh, not only a grid | Documented as `trimesh` / raw positions + `setEdges`. Not executed here | WCL1 already stores particles, triangles, stretch, shear, bend |
| Structural and bend constraints | Edges and cells exist | Map WCL1 stretch and bend. Do not also invent grid springs |
| Animated waist pins | `setParticleKinematicTarget` | Read the current skinned waist every frame. Our solver does not |
| Body collision | Same `World` as cuboids, capsules, trimeshes | Build capsules or a body collider. Radius still has to match the avatar |
| Render mesh that is not the sim mesh | `meshVertices` / skinned collision mesh accessors exist on `SoftBody` | Our scatter binding stays. Vertex order must match the file, not three-vrm's compact order |
| Self-collision | Particle radius is a setter. Full self-collision quality on a 1500-particle skirt is unverified | Start with it off. Enable only if the A-line PoC is stable without it |
| Worker | WASM is initialised with an async `init()`. It can live in a worker. Moving the world across threads is unverified | Keep one world per worker, reuse buffers |
| Mobile CPU and memory | Unverified. The compat build inlines WASM as base64 and is large | Measure on a phone before claiming a frame budget |

Rapier will not fix a binding that points at the wrong vertex, a 1 mm hip gap classified as a missing seam, or a capsule wider than the thigh. Those are asset and loader bugs. See `CURRENT_STATE_AUDIT.md`.

## JoltPhysics.js — candidate B

- Repository: https://github.com/jrouwe/JoltPhysics.js
- Example: `Examples/soft/soft_body.html` builds a grid with `SoftBodySharedSettings`, faces, and `mInvMass = 0` on pinned corners
- npm: `jolt-physics`. A 2026 release note updates the port to Jolt 5.6.0 and says the new hair system is not exposed because compute is not usable from JavaScript
- License: treat as MIT only after reading the `LICENSE` file of the exact tag the PoC installs

Useful and real: soft-body vertices, faces, inverse-mass pins, bend constraints, and a WASM build that can sit in a worker. The author has stated that `ShapeGetTriangles` is the wrong way to recover an indexed render mesh; the example reads faces and positions directly.

Costs that matter here:

- Every `new Jolt.*` must be `Jolt.destroy`'d. Ref-counted objects (`SoftBodySharedSettings` among them) need `AddRef` / `Release`. A long-running Try-On will leak the WASM heap if a pose change forgets one of these.
- The API is the C++ API. It does not match our WCL1 records. An adapter is larger than the Rapier TypeScript one.
- Soft-body versus soft-body and soft-body versus a skinned triangle mesh are not re-verified in this review. Release notes mention double-sided soft-body faces and a fix for scaled triangle meshes. That is not a skirt-on-thighs test.
- Multithreaded WASM needs cross-origin isolation. Our page does not promise that. The single-threaded build is the one a PoC may use.

Jolt is a credible second WASM backend. It is a worse first backend than Rapier for this codebase because of manual lifetime and a less web-shaped API. No garment in this repo has been simulated with it.

## PositionBasedDynamics — candidate C

- Repository: https://github.com/InteractiveComputerGraphics/PositionBasedDynamics
- License: MIT
- Role: algorithm reference (XPBD, PBD, collision projections), not a browser engine

Our `ClothSimulation.js` is already a small XPBD step in that family (persistent positions, velocities, and multipliers; compliance over `dt²`). Porting this C++ repository into the viewer would duplicate that step and add a build we would have to keep. Take algorithms from it when a constraint is wrong. Do not adopt the project as a dependency.

## Ammo.js / Bullet — candidate D

- Repository: https://github.com/kripken/ammo.js
- Upstream: Bullet `btSoftBody` (anchors, clusters, collision)
- License: Bullet's zlib license, carried by the port

Bullet soft bodies can hang a cloth and pin vertices. The JavaScript port is a stale Emscripten binding with a difficult upgrade path. It has no maintained story for a WCL1 render binding, animated VRM pins, or a small mobile WASM payload. It does not beat Rapier or a repaired in-repo XPBD step for this viewer. Do not add it.

## meshoptimizer — candidate E

- Repository: https://github.com/zeux/meshoptimizer
- License: MIT
- JavaScript build exists and is the usual tool for LOD

Use it in Forge, not in the viewer hot path, to build the WCL1 LOD meshes (`mobile-mid` 200, `mobile-high` 500, `desktop` 1200). Constraints:

- Do not weld across an open hem, a slit, or the 1 mm bodice/skirt shell offset. Simplification must lock boundary vertices that the asset marks as seams, hems, or attachment weight ≥ 0.999.
- The sim mesh and the render mesh stay distinct. LOD reduces particles. It does not replace the render binding.
- Attribute-aware simplification (`simplifyWithAttributes`) is the mode that can keep a material boundary. Verify on the pleated mini before trusting a 200-particle LOD: pleat folds collapsed into one particle are a failed asset, not a faster one.

This replaces a custom decimator if Forge grows one. It does not replace the solver.

## three-mesh-bvh — candidate F

- Repository: https://github.com/gkjohnson/three-mesh-bvh
- License: MIT

The quality gate already needs nearest-point queries on the skinned body. A BVH answers those faster than a linear scan and can be refit after skinning. That is a measurement and, later, a collision-query tool. It is not a cloth model. Capsules can stay the cheap collision until a BVH contact is shown to be cheaper than a bad capsule on a phone. Do not swap the thigh capsule for a BVH and call the skirt solved.

## three-vrm spring bones — candidate G

- Repository: https://github.com/pixiv/three-vrm
- Already loaded by the viewer as `@pixiv/three-vrm@2.1.0`
- License: MIT

Spring bones are a chain of joints with stiffness and gravity. They are the right cheap motion for hair, a ribbon, or a loose accessory on low-end phones. They do not represent a surface. A skirt needs edges that keep their length, a hem that can fold over two thighs, and a binding back to a render mesh. A spring chain cannot do those, and `removeUnnecessaryVertices` in this same package is currently renumbering the cloth mesh (see the audit). Use spring bones only as the mobile-low secondary-motion path for non-surface attachments. Do not use them for `dress-a-line-v1`, `skirt-pencil-v1`, or `skirt-pleated-mini-v1`.
