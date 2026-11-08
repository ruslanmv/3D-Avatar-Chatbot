# Consolidated upgrade plan

This is the target shape. It is not a rewrite to land in one pull request. Milestones are in section 8. The decision that orders them is `CLOTH_ARCHITECTURE_DECISION.md`.

## 1. Data flow

```text
Wardrobe Forge
  garment mesh, seams, attachment, fabric, LOD
        |
        v
Garment physics compiler
  WCL1 (wardrobe.cloth/1, later /2)
        |
        v
ClothAssetLoader  ->  ClothAssetValidator
        |
        v
ClothPhysicsBackend
  xpbd | rapier | skeletal
        |
        +-- AvatarAttachmentProvider   (current bone matrices -> pin targets)
        +-- BodyColliderProvider       (capsules now, mesh later)
        |
        v
GarmentSimulationScheduler
  fixed dt, LOD budget, sleep, one worker
        |
        v
RenderMeshBinding
  file vertex order, not three-vrm compact order
        |
        v
Three.js / VRM skinned mesh
```

The viewer never imports Rapier types outside the Rapier backend file. Forge never imports Rapier types at all.

## 2. Asset version

`wardrobe.cloth/1` stays the bytes already specified in Forge `wardrobe/cloth/binary.py` and `src/wardrobe/ClothAsset.js`: magic `WCL1`, particles, triangles, stretch, shear, bend, seams, attachments, a 3-weight binding that today stores `(particle, 0, 0, 1, 0, 0)`.

`wardrobe.cloth/2` is a later header, not part of the first milestones. It may add:

- a `pinGroup` per particle (neck, waist, hem) so a dress does not pin its neckline just because it is the top 4 cm
- rest lengths tagged as `bind` or `pose`. Until then the runtime treats bind rests as the T-pose and retargets them to the skinned pose at init
- an explicit LOD index the scheduler must use

A `/1` buffer remains loadable. Validators reject unknown versions. They do not guess.

## 3. Interfaces

These are the boundaries. Names are TypeScript-shaped so a later file can copy them. They are not a new compile step.

```ts
type ClothBackendId = 'xpbd' | 'rapier' | 'skeletal';

interface ClothAssetSummary {
  schema: 'wardrobe.cloth/1';
  simulation: 'xpbd' | 'fallback-skinning' | 'skinning';
  profile: string;
  particles: number;
  renderVertices: number;
  missingSeams: number;
  attachmentSource: string;
  bufferView: number;
}

interface ClothAssetLoader {
  /** GLB binary chunk + bufferViews. Returns null if this node has no cloth asset. */
  read(binary: Uint8Array, bufferViews: { byteOffset?: number; byteLength: number }[], summary: ClothAssetSummary): Uint8Array | null;
}

interface ClothAssetValidator {
  /** Throws a reason string the worker can put on `fallback`. Does not mutate the mesh. */
  assertSimulatable(asset: DecodedClothAsset, summary: ClothAssetSummary): void;
}

interface PinTarget {
  particle: number;
  /** World position of this pin for the pose being simulated. */
  position: [number, number, number];
}

interface BodyCapsule {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  radius: number;
  /** Seated thigh. Standing thighs stay out of the one-sided lap constraint. */
  lap: boolean;
}

interface ClothStepInput {
  dt: number;
  pins: PinTarget[];
  capsules: BodyCapsule[];
  /** World position of each render vertex, file order, length = renderVertices * 3. */
  skinned: Float32Array;
}

interface ClothStepOutput {
  /** World positions, file order, same length as skinned. */
  render: Float32Array;
  particles: number;
  contacts: number;
  strain: number;
  substeps: number;
  iterations: number;
  ms: number;
}

interface ClothPhysicsBackend {
  readonly id: ClothBackendId;
  init(asset: DecodedClothAsset): void;
  /** One fixed step or a short settle. Must not grow buffers each call. */
  step(input: ClothStepInput): ClothStepOutput;
  reset(): void;
  dispose(): void;
}

interface AvatarAttachmentProvider {
  /** Particles with attachment >= 0.999, moved to the current skinned position. */
  pins(asset: DecodedClothAsset, skinned: Float32Array): PinTarget[];
}

interface BodyColliderProvider {
  /** Thigh capsules in the same space as `skinned`. Radius from the body surface, not 0.29 * bone length. */
  capsules(skeletons: unknown[]): BodyCapsule[];
}

interface GarmentSimulationScheduler {
  /** Settled pose today. Per-frame later. Never both in one flag. */
  run(backend: ClothPhysicsBackend, input: ClothStepInput, budget: { maxParticles: number; maxMs: number }): ClothStepOutput;
}

interface RenderMeshBinding {
  /**
   * Map backend particle positions to render vertices using asset.binding.
   * Vertex i in the Three.js geometry must be file vertex i.
   * If three-vrm compacted the mesh, refuse and fall back.
   */
  scatter(asset: DecodedClothAsset, particles: Float32Array): Float32Array;
}

interface ClothDiagnostics {
  record(row: {
    templateId: string;
    backend: ClothBackendId;
    fallback?: string;
    particles: number;
    contacts: number;
    strain: number;
    ms: number;
    maxPenetrationMm?: number;
    maxEdgeStretch?: number;
    maxSpanDropMm?: number;
  }): void;
}

interface ClothQualityGate {
  /** Same limits as PoseClothCorrection.GATE. Do not raise them. */
  limits: { maxPenetrationMm: 1; maxEdgeStretch: 6; maxSpanDropMm: 8 };
}
```

`DecodedClothAsset` is the object `ClothAsset.decode` already returns.

## 4. Rules that stay in force

- Underwear stays a separate garment. PR #26 still paints a white underskirt 4 cm past a white panty hem, capped at the ankle. Beige catalog briefs stay beige.
- Do not cut holes to show briefs. Do not sew edges that are merely near each other. A 5 mm panel gap stays open. A 1 mm shell offset may be a stretch constraint only if positions do not move (geometry fingerprints).
- Default messages omit `solver` and call `PoseClothCorrection.correct()`.
- Do not regenerate `body_art_golden.json` or gallery geometry hashes.
- Do not write `print_matrix.py --out` into `catalog-matrix-2026-11-07` or `catalog-matrix-2026-11-08`.

## 5. Rollback

Each milestone is a query flag or a Forge export that still sets `simulation: fallback-skinning` when validation fails. Reverting the milestone commit returns the worker to the previous flag behaviour. The default page does not change in any milestone in this plan.

## 6. Modules

| File | Action |
|---|---|
| `src/wardrobe/ClothAsset.js` | Retain. Loader. |
| `src/wardrobe/ClothSimulation.js` | Retain as the `xpbd` backend. |
| `src/wardrobe/BodyCollision.js` | Retain. Move capsule construction behind `BodyColliderProvider` without changing the maths until the radius fix lands. |
| `src/wardrobe/PoseClothWorker.js` | Retain. It chooses a backend. It does not grow a second solver inline. |
| `src/wardrobe/PoseClothCorrection.js` | Retain. `skeletal` backend and the failure path. |
| `src/gltf-viewer/AvatarManager.js` | Change only so cloth meshes skip `removeUnnecessaryVertices`. |
| `src/gltf-viewer/PoseClothCorrector.js` | Pass pins from the current skin, and pass the skinned pose as the metric reference. Stop using rigid `matrixWorld` positions as "rest". |
| Forge `wardrobe/cloth/*` | Retain. LOD via meshoptimizer is a Forge PR, not a viewer hack. |
| New `src/wardrobe/backends/RapierClothBackend.js` | Only in the PoC milestone, dynamic import, flag gated. |

## 7. Mobile budgets

Hypotheses, not measured limits:

| Target | Particles | Backend |
|---|---:|---|
| Low-end phone | 0 simulated | `skeletal` (existing skinning + pose corrector) |
| Mid-range phone | 200 | LOD from the asset, not the full pleated mesh |
| High-end phone | 500 | same |
| Desktop | 1200 | same |

The scheduler refuses a mesh above the budget instead of silently simulating 7495 particles and hoping. Refusal uses `skeletal` and records `fallback: "over particle budget"`.

Measure p50, p95, and p99 of worker time and of main-thread time around `postMessage`, over at least 300 settled poses on a desktop session and, separately, on one Android and one iPhone before anyone writes "30 FPS". Sustained means the tab stays open for several minutes of pose changes without a climbing heap.

## 8. Milestones

Each one is its own PR. None of them merge #140.

### M0 — this document set

- Purpose: record the decision.
- Files: `docs/physics/*`.
- Depends on: nothing.
- Accept: the PR diff is markdown only, based on `5d68d65`.
- Risk: none to the viewer.
- Rollback: close the PR.

### M1 — file vertex order

- Purpose: stop three-vrm from renumbering meshes that carry `wardrobe.cloth/1`.
- Files: `src/gltf-viewer/AvatarManager.js`, `src/VRMLoader.js`, one test that a compact pass would remap index `34` to `2` and that a tagged mesh is skipped.
- Depends on: M0 for the explanation, not for the code.
- Accept: loading the A-line GLB, the geometry index prefix stays `0, 1, 34`. Body meshes may still be compacted.
- Risk: a cloth mesh that shared a geometry with a non-cloth primitive. The current dress does not.
- Rollback: revert the commit. Default page does not call the XPBD path.

### M2 — pose rests, skin-fitted capsules, metric reference

- Purpose: stop the solver pulling the waist back to T-pose bridges, and stop the 10 cm capsule.
- Files: `XpbdSkirtPilot.js`, `PoseClothCorrector.js` (metric `rest` becomes the skinned pose), `BodyCollision.js` only if the lap mask must be the rim.
- Depends on: M1, otherwise the pictures are still scrambled.
- Accept: local A-line standing under `?cloth=xpbd` keeps penetration ≤ 1 mm and stretch ≤ 6×. Span ≤ 8 mm is required before `fixed=yes` and is not assumed. Sitting wide must not be a hoop and must not hang through the thighs. If both cannot be true, the PR stays draft and says so.
- Risk: pose rests make the hem want to stay inside the thigh. That is the real seated problem, and it is not solved by a percentage lift.
- Rollback: flag off. Legacy corrector remains.

### M3 — animated pins inside the existing step

- Purpose: each preroll frame writes pin particles to the current skinned waist, not the first frame.
- Files: `ClothSimulation.js`, `PoseClothWorker.js`.
- Depends on: M2.
- Accept: a unit test moves the pin target between two steps and the pinned particle matches the second target. A dress neckline pin and a skirt waist pin are different groups if the asset says so; until `/2`, document that height-fallback still pins the top 4 cm.
- Rollback: revert. Pins freeze again.

### M4 — Rapier PoC, A-line only

- Purpose: `PHYSICS_BACKEND_POC.md`.
- Files: new backend module, worker branch on `solver: "rapier"`, no default change.
- Depends on: M1 and M2. M3's pin rule is implemented with `setParticleKinematicTarget`.
- Accept: the PoC's written pass/fail table. A fail keeps XPBD.
- Rollback: delete the flag. Do not leave a broken dynamic import on the default path.

### M5 — diagnostics console

- Purpose: `CLOTH_DIAGNOSTICS_CONSOLE.md`.
- Depends on: M1 so the overlay is not drawing the scrambled mesh.
- Accept: `?clothDebug=1` only. Production bundle path does not import the overlay when the flag is absent.
- Rollback: remove the flag check.

### M6 — Forge LOD with meshoptimizer

- Purpose: pleated mini must not ship 7495 simulated particles to a phone.
- Files: Forge `wardrobe/cloth/`, not the viewer.
- Depends on: a stable `/1` binding. Boundary vertices locked.
- Accept: unit test that a hem loop and the 1 mm shell offset survive simplification. `missingSeams` does not increase.
- Rollback: LOD entries stay `simulation: skinning`.

### Not in this sequence

Leggings pose-space correctives, Seamless Scrunch Leggings, boots, trousers, the 2 mm brief penetration, and making XPBD or Rapier the default. Those stay follow-ups until the three pilot skirts pass the existing gates and a visual review.
