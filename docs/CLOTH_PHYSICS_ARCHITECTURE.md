# Cloth physics architecture

The live Try-On path is still `PoseClothCorrection.js`. This change adds a
second solver and leaves the first one in place. The page posts
`solver: "xpbd"` only when the address has `?cloth=xpbd`, the garment is
A-line dress, Pencil skirt, or Pleated Mini Skirt, and its cloth summary says
profile `cloth` or `hybrid-skirt` with schema `wardrobe.cloth/1`. Anything
else, including an omitted flag, stays on the pose corrector. A tee is not
sent to XPBD, and `seatRisenHem` does not run on one: that walk is not on
this branch.

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
* A hem particle that would enter a thigh capsule stops on the outside of
  that capsule. Two capsules in one pass are averaged.
* The centre-front hem stays `BodyCollision.BRIEF_GAP` (2 cm) outside the
  pelvis capsule, which stands in for the brief. The side hem is not in that
  list, so it is not lowered through the thigh to open the centre. This is a
  collision gap, not a cut in the skirt and not the old 0.9 rise fraction.

There is no standing-cut hem walk, no final unconstrained `relax()`, and no
raised penetration or stretch gate. The 1 mm, 6×, and 8 mm gates in
`audits/wardrobe_sitting_desk` still judge live pictures. A green unit test
does not close one. The 7 November and 8 November catalog tables are not
rewritten by this change.

## What the page sends

`PoseClothCorrector` reads `cloth=xpbd`. When the parameter is absent the
worker message is `{id, input}`, the same object as before. When it is
present, only a qualifying skirt is added under `solver: "xpbd"`. Tops,
underwear, leggings, jeans, trousers, shorts, and boots stay in the pose
corrector. The public catalog garments do not carry a `wardrobe.cloth/1`
buffer yet, so the flag does not change those pictures until Forge ships the
asset on the garment.

Do not mark a catalog row `fixed` or `review_status=pass` from this solver.

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
