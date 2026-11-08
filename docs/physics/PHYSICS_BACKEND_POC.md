# Physics backend proof of concept

Compare one real A-line dress in the current XPBD worker and in Rapier. Do not start from a hanging grid. Do not enable either backend for the other 61 garments. Do not change the default page.

## Preconditions

These are defects, not tuning, and the PoC is invalid if any of them is still true:

1. The loaded dress index prefix matches the GLB (`0, 1, 34, …` for the current A-line). If three-vrm has renumbered the mesh, stop.
2. Both backends read the same WCL1 bytes from the same GLB.
3. Both backends pin the same particles and move those pins to the current skinned position every step. Rapier uses `setParticleKinematicTarget`. XPBD writes the same positions into inverse-mass-zero particles at the start of each step.
4. Both backends receive the same capsule list, in world space, with a radius taken from the body surface. Do not use `0.29 * bone length` in one backend and a hand-tuned radius in the other.
5. The Forge that generated the GLB reports `simulation: "xpbd"` for `dress-a-line-v1`. The committed PR #28 compiler does not, because of the 1 mm bodice/skirt split. Use a build that classifies that split without moving vertices, or the PoC is comparing two fallbacks.

## Setup

- Avatar: `fem_vroid.vrm` (the library file already used by the audit).
- Garment: Black A-line Dress, template `dress-a-line-v1`.
- Page: `http://127.0.0.1:8080/?cloth=xpbd` and the same URL with `?cloth=rapier`.
- Forge: a local server that actually embeds WCL1. Pass `--forge-url` to `audits/wardrobe_sitting_desk/capture.py`. The public Hugging Face Forge does not.
- Package: pin `@dimforge/rapier3d-compat` to a version whose exports include `World.createSoftBody` and `SoftBodyDesc`. If the installed package does not, the PoC fails closed. Do not copy a newer snippet into the repo.
- Worker: Rapier `init()` once per worker. Dispose the world when the garment changes. No Rapier import on the main thread except the dynamic import inside the worker.

Build the Rapier body from WCL1:

- particle positions = the same skinned initial positions XPBD uses
- edges = WCL1 stretch pairs
- pins = attachment ≥ 0.999
- do not also call `SoftBodyDesc.cloth` (that builds a new grid and ignores our mesh)

## Protocol

Poses, in this order, from a fresh load each time: standing, sitting desk, sitting wide, sitting crossed. Four cameras: front, right, back, left. Same capture command the audit already uses, separate output directories:

```text
/tmp/poc-aline-xpbd
/tmp/poc-aline-rapier
```

Do not point `--out` at `audits/wardrobe_sitting_desk/reports/catalog-matrix-2026-11-07` or `catalog-matrix-2026-11-08`.

For each pose record: particle count, contacts, strain, worker milliseconds, main-thread round-trip milliseconds, penetration millimetres, edge stretch, span drop, and the fallback string if the worker refused.

Then repeat the pair for `skirt-pencil-v1` and `skirt-pleated-mini-v1` only if A-line has a decision. Pleated must use the asset LOD that fits the desktop budget (1200) or the PoC records `fallback: over particle budget` rather than simulating 7495 particles and calling it a Rapier win.

## Adoption

Rapier is adopted for the three pilot templates only if all of the following hold:

- No fallback on those three templates for the four poses.
- Penetration ≤ 1 mm, stretch ≤ 6×, span drop ≤ 8 mm on every captured frame.
- A person looking at the four fronts can say the hem is on the lap in the seated poses, the waist is attached, the standing dress is closed to the knee, and the beige briefs are still visible in the seated front opening. A gate pass with a floating hoop is a fail.
- Worker p95 for the A-line settle is not worse than the XPBD settle by more than 2× on the same machine, or the extra time is explained by a measured collision feature XPBD lacks and the picture requires.
- The heap after 50 pose changes is flat (no unbounded growth from missed `free` / world rebuild).

If Rapier loses the picture or the gate, delete the flag in a follow-up and keep the repaired XPBD path. Do not keep a second solver that is worse "because we might tune it later" without a written defect and a single next experiment.

## Rejection

Reject the backend, and do not start pencil, if any of these happen on A-line:

- The WASM build in the worker fails to init, or the published package has no `SoftBodyDesc`.
- The skirt tears at the waist the way the scrambled binding did. That means the PoC is not on file vertex order.
- Sitting wide is a hoop or a hem through the thighs.
- Standing opens the front.
- Memory grows on every pose change.

## What this PoC does not decide

Phone frame rate, self-collision, boots, leggings, or replacing `PoseClothCorrection.js` as the default. Those need their own measurements after this one passes.
