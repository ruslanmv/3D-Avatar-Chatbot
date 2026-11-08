# Architecture decision — cloth runtime

Date: 2026-11-08. Status: proposed. This does not change runtime code.

## Decision

Keep WCL1 as the neutral asset. Do not replace `ClothSimulation.js` with another engine in the next pull request.

The next runtime change is the contract the solver sits on: file vertex order, pose-space rest lengths, capsules that match the skin, and pins that read the current skeleton. Those defects are confirmed in `CURRENT_STATE_AUDIT.md`. They will break Rapier and Jolt the same way.

After that contract holds for one A-line dress, the production solver to try is Rapier (`@dimforge/rapier3d-compat`, pinned, Apache-2.0), behind an adapter and behind `?cloth=rapier`. The fallback if that PoC loses is the repaired in-repo XPBD step, plus skinning on low-end phones. Jolt stays a written alternative, not a dependency, until Rapier fails a criterion Rapier was supposed to win.

## Why this is not "switch to Rapier now"

Local XPBD, once the mesh was left in file order, produced a closed standing A-line (penetration 0, stretch 1.06×) and a sitting-wide hoop (penetration 30.9 mm, stretch 2.87×, span drop 87.9 mm). The hoop comes from a 10 cm hem band lifted to the top of an oversized thigh capsule, on a 24-frame or 8-frame preroll, with pins frozen at the start pose. Rapier's cloth feature does not encode the thigh radius or the hem mask. Copying the same capsules into `World.createCollider` reproduces the hoop inside WASM.

Rapier becomes worth the dependency when the asset and the colliders are good enough that the remaining gap is one Rapier already fills and our step does not:

- `setParticleKinematicTarget` every frame, so the waist follows the skeleton
- a single world step instead of a 24-frame preroll
- the same rigid-body collision pipeline as the body, including a future mesh collider
- sleeping, which our step does not implement

None of those have been timed on a phone. Mobile score below is unverified on purpose.

## Scores

1 is a poor fit, 5 is a strong fit. **Unverified** means we did not run it. Unverified cells are not zeroes and are not averaged into a winner.

| Criterion | Weight | Repair our XPBD | Rapier adapter | Jolt adapter |
|---|---:|---|---|---|
| Garment collision and deformation on our skirts | 30% | Unverified as a product. Negative evidence: sitting-wide hoop and 30.9 mm penetration after the binding fix. Standing can pass stretch. | Unverified. API has cloth, edges, pins, kinematic targets. No A-line has been stepped. | Unverified. Grid sample only. No A-line. |
| Integration with Forge, WCL1, VRM | 25% | 3. Already loaded in the worker. Binding is wrong until three-vrm stops renumbering cloth meshes. | 2. `SoftBodyDesc` can take positions and edges. Adapter and worker `init()` do not exist. Vertex-order bug still applies. | 2. Possible. Larger adapter, manual `destroy`. Vertex-order bug still applies. |
| Mobile runtime | 20% | Unverified. In-repo step has no WASM startup. 0.332 ms was a 196-particle VM microbench, not a phone. | Unverified. Compat WASM is large. No phone number. | Unverified. Same, plus destroy discipline and no cross-origin-isolation requirement for the single-thread build. |
| Maintenance | 15% | 3. A few hundred lines we can read. We also have to keep every constraint correct. | 4. Apache-2.0, typed API, one `init()`. Soft body is new; pin the version. | 2. C++-shaped lifetime. Easy to leak. Hair path in 5.6 is not in the JS build. |
| License, maturity, ecosystem | 10% | 3. No extra license. Not a community engine. | 5. Apache-2.0, widely packaged, 0.21.0 publishes the soft-body declarations we checked. | 4 if the tag's LICENSE is MIT, which the PoC must confirm before install. Smaller web ecosystem than Rapier. |

There is no weighted total. Two of the three heaviest criteria are unverified for every option. Pretending otherwise would pick an engine by the license column.

## What stays, what is wrapped, what can leave later

| Module | Now | After a Rapier PoC wins | If the PoC loses |
|---|---|---|---|
| Forge garment build, PR #26 underskirt colour | Keep | Keep | Keep |
| WCL1 binary (`ClothAsset.js`, Forge `binary.py`) | Keep | Keep. Adapter reads it. Backends do not | Keep |
| `PoseClothCorrection.js` | Keep. Default page | Keep as `skeletal` and as the failure path | Keep as default until XPBD is actually better on the four poses |
| `ClothSimulation.js` | Keep | Becomes the `xpbd` backend behind the same interface. Not deleted in the PoC | Keep and fix |
| `BodyCollision.js` | Keep | `BodyColliderProvider` builds the same capsules for every backend | Keep |
| `XpbdSkirtPilot.js` | Keep until the three templates graduate | Eligibility and hem masks move to the asset. The pilot list goes away only when a fourth garment is intentionally added | Keep |
| `removeUnnecessaryVertices` on cloth meshes | Stop | Still stopped. Any backend needs file order | Still stopped |
| Ammo.js, PositionBasedDynamics, spring bones as a skirt solver | Do not add | Do not add | Do not add |
| meshoptimizer | Not yet | Forge LOD only | Forge LOD only |
| three-mesh-bvh | Not yet | Gate and diagnostics, not the first collision model | Same |

## Rollback

The default page never sends `solver`. A bad backend is a query flag (`?cloth=xpbd` or `?cloth=rapier`). Removing the flag, or throwing inside the worker, returns that garment to `PoseClothCorrection.correct()`. Do not make Rapier the default in the PoC PR.

## Non-goals

- No new percentage hem lift.
- No raising the 1 mm / 6× / 8 mm gates.
- No XPBD or Rapier on all 62 garments.
- No claim of 30 or 60 FPS on a phone.
- No merge of PRs #135–#140 or Forge #26–#28 from this decision.
