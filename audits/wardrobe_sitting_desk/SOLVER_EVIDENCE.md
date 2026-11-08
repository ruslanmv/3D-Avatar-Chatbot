# What the mesh can tell the next solver

Read this before replacing `PoseClothCorrection.js`. The catalog numbers are in [AGENT_MATRIX.md](AGENT_MATRIX.md). The published methods (Projective Dynamics, ARAP, XPBD, Bridson contact, True Seams) are a direction. They are not a fix that has passed the 62-garment catalog.

`evidenceOf(rest, indices)` in `src/wardrobe/PoseClothCorrection.js` answers the question those methods need. The tests are `tests/wardrobe/pose-cloth-evidence.test.js`.

## Decision

| Garment problem | What the mesh contains | What a new solver may do | What it must not do |
|---|---|---|---|
| Skirt or dress across the lap | One connected panel. Rest positions are the standing cut. `canEnforceKnownPanel` is true. `seatedDrapeInRest` is false. | Hold that panel together and keep it on the body support the posed thighs already provide. | Invent a drape from collision distance. Another upward lift of each vertex is the experiment that already failed on the live hem. |
| Open jeans crotch | Boundaries that pass near each other are not welded. `copiesWelded` is 0 unless the rest points already coincide within 0.1 mm. `canRepairOpenSeam` is false. | Report the missing seam. Add a seam-opening measure so a parted crotch cannot pass on penetration alone. | Pair nearby boundary edges and stitch them. Proximity is not a seam id. |
| Crossed leg and boot fold | The posed body has two surfaces whose normals face opposite ways. The garment topology does not say which way is outside. | Treat the two contacts together. If no position is outside both without tearing an edge past 6×, record the conflict. | Push one normal, then the other, then relax without a limit. That path made a 39× edge, and a final relax pulled other trousers back inside. |

## Experiments still to run

Do these on the existing `correct()` and on one candidate, with the same posed input. Keep the gate at 1 mm, 6×, and 8 mm.

1. Crossed-leg contact on plain leggings, high-waist leggings, over-the-knee boots, and combat boots. Success is stretch at or under 6× and penetration at or under 1 mm on the same frame. A conflict that cannot meet both is a recorded failure, not a torn edge.
2. Panel shape on the A-line, pencil, bodycon, and wrap. Success is span drop at or under 8 mm and a continuous lap in the front picture. Stop if the hem becomes a hoop or a standing dress changes shape.
3. The seamless leggings mesh is a worker budget. Count vertices and time to finish. Do not treat a hang as a penetration bug.

The 2 mm foundation brief is the control. A change that pulls it off the body or through the outer garment fails even if a skirt number improves.

A green unit fixture is not a closed live picture. Recapture the front frame named in `catalog-matrix.csv` and run `review_pictures.py check` before `review_status` can be `pass`.
