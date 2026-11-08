# Cloth physics architecture

The live Try-On path is still `PoseClothCorrection.js`. This change adds a
second solver and leaves the first one in place. A frame is simulated only
when a caller posts `solver: "xpbd"` and the Forge asset says
`simulation: "xpbd"` with schema `wardrobe.cloth/1`. Anything else, including
an omitted flag, stays on the pose corrector.

## Data flow

1. Forge writes `extras.wardrobeForge.clothAsset` and a `WCL1` buffer view.
   The layout is `wardrobe/cloth/binary.py` in 3D-Wardrobe-Forge.
2. `src/wardrobe/ClothAsset.js` reads that buffer. It does not stitch seams.
3. `src/wardrobe/GarmentDeformation.js` maps the profile:

   | Profile | What runs |
   |---|---|
   | `skinning` | skeletal skinning (briefs, bras, fitted tops) |
   | `corrective` | skinning plus joint corrections (leggings, jeans, trousers) |
   | `rigid` | articulated shoes and boots, not a cloth step |
   | `hybrid-skirt` | skinned waist, simulated hem |
   | `cloth` | XPBD (A-line skirts, loose dresses, capes) |

4. `src/wardrobe/ClothSimulation.js` keeps positions, velocities, and
   multipliers from frame to frame. `reset` returns the particles to the rest
   pose and clears velocity. That is the teleport and avatar-change path.
5. `src/wardrobe/BodyCollision.js` pushes dynamic particles out of bone
   capsules. Every capsule contributes, then the particle moves by the average,
   so two thighs are not applied one after the other.

`mobile-low` selects skinning even for an XPBD garment. `mobile-mid`,
`mobile-high`, and `desktop` use the LOD named in the asset, or the full mesh
when the asset is already under that budget.

## Solver

The step is XPBD with a fixed substep. Each substep integrates gravity and
damping, then iterates stretch, shear, and bend, then capsules.

* Stretch and bend are distance constraints. Compliance is `α / Δt²`.
* Shear is the triangle altitude onto its longest edge.
* A particle whose attachment weight is at least 0.999 has inverse mass 0.
* An edge that has collapsed to zero length separates along +Y instead of
  being skipped, so a later frame can open it again.

There is no `seatRisenHem`, no final unconstrained `relax()`, and no raised
penetration or stretch gate. The 1 mm, 6×, and 8 mm gates in
`audits/wardrobe_sitting_desk` still judge live pictures. A green unit test
does not close one.

## What is not wired

`PoseClothWorker.js` understands `solver: "xpbd"` and answers with positions.
The page does not send that message. Sitting Wide and Sitting Crossed in the
catalog are still the pose corrector. Do not mark a catalog row `fixed` or
`review_status=pass` from this solver.

The 2026-11-07 catalog CSV is the baseline. Do not overwrite it with a
candidate capture. `print_matrix.py --baseline-csv` compares a new run against
that file. Copy the CSV aside first if the output directory is the same folder.

## Migration and rollback

Ship the asset first. Viewers that do not know `clothAsset` ignore the extra.
Turn the worker flag on for one garment, recapture Standing, Sitting Desk,
Sitting Wide, and Sitting Crossed, including the transitions back to standing,
and run `review_pictures.py check`. If a picture regresses, stop sending
`solver: "xpbd"`. The pose corrector is still the default and does not read
the new modules unless that flag is set.

Deleting `PoseClothCorrection.js` is out of scope until those captures pass.

## PR pilot: opt-in seated skirt contact

Under `?cloth=xpbd`, `AvatarManager` retains the WCL1 glTF buffer view
for **only** `dress-a-line-v1`, `skirt-pencil-v1`, and
`skirt-pleated-mini-v1`. `PoseClothCorrector` validates the summary
(`wardrobe.cloth/1`, `profile: cloth|hybrid-skirt`, `simulation: xpbd`)
and the render binding before sending an XPBD worker message. Without the
query flag the worker receives the exact old message with no `solver` field.
Other garments still run in the pose-correction batch. If the pilot has no
valid WCL1 data or thigh bones, it falls back to the previous solver.

The pilot initializes particles from the *current posed render vertices* in
world space, not from the standing cut. The authored WCL1 stretch, shear and
bend rest constraints are used unchanged. The waistband particles with
attachment weight >=0.999 are pinned. Thigh capsules follow the current upper-
and lower-leg bones; a one-sided lap contact keeps skirt-hem particles out
of the underside of a **seated** thigh, with simultaneous capsule corrections
averaged. The centre-front hem also clears the lower silhouette of the
posed brief by a small testable gap; no geometry is cut or sewn.

The pilot currently pre-rolls 24 simulation frames upon pose settlement; it
is **not yet a verified continuous frame-by-frame real-time cloth engine**.
The skinned fallback remains essential until live captures show a good result.

Do not call a skirt fixed from this PR alone. The 1 mm penetration, 6x stretch,
8 mm span-drop gate and the reviewed front pictures must all pass. The 7 and
8 November CSV reports are immutable historical evidence: never write
`print_matrix.py --out` into either baseline directory when comparing it.
