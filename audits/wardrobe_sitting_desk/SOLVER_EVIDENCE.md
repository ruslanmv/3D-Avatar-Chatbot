# What the mesh can tell the next solver

Read this before replacing `PoseClothCorrection.js`. The catalog numbers are in [AGENT_MATRIX.md](AGENT_MATRIX.md). The published methods (Projective Dynamics, ARAP, XPBD, Bridson contact, True Seams) are a direction. They are not a fix that has passed the 62-garment catalog.

`evidenceOf(rest, indices)` in `src/wardrobe/PoseClothCorrection.js` answers the question those methods need. The tests are `tests/wardrobe/pose-cloth-evidence.test.js`.

## Decision

| Garment problem | What the mesh contains | What a new solver may do | What it must not do |
|---|---|---|---|
| Skirt or dress across the lap | One connected panel. Rest positions are the standing cut. `canEnforceKnownPanel` is true. `seatedDrapeInRest` is false. | Hold that panel together and keep it on the body support the posed thighs already provide. | Invent a drape from collision distance. Another upward lift of each vertex is the experiment that already failed on the live hem. |
| Open jeans crotch | Boundaries that pass near each other are not welded. `copiesWelded` is 0 unless the rest points already coincide within 0.1 mm. `canRepairOpenSeam` is false. | Report the missing seam. Add a seam-opening measure so a parted crotch cannot pass on penetration alone. | Pair nearby boundary edges and stitch them. Proximity is not a seam id. |
| Crossed leg and boot fold | The posed body has two surfaces whose normals face opposite ways. The garment topology does not say which way is outside. | Treat the two contacts together. If no position is outside both without tearing an edge past 6×, record the conflict. | Push one normal, then the other, then relax without a limit. That path made a 39× edge, and a final relax pulled other trousers back inside. |

## What the live frames showed

The upward lift, including a second lift after unfold that held the gained height, moved the A-line's span number from 83 mm to 0 and left the front picture a hoop. Those vertices had gone inside the body (37 mm, then 9 mm). The visible ring is the hem skinning swung up with the knee: the center-front hem vertex rests at y 0.38 and arrives at y 1.02, z 0.47.

`seatRisenHem` walks a hem that has risen more than 15 cm back toward that cut, at most 2 cm a step and never past 6×. A hem that has not risen is not pulled down. Recaptured fronts:

| Frame | Before | After | Picture |
|---|---|---|---|
| A-line, Sitting Wide | span 83 mm, the hoop, briefs visible | 9.9 mm inside, stretch 6×, span 11.2 mm | The hoop is gone. The skirt hangs over the lap. A gap remains at the waist. |
| Pencil skirt, Sitting Wide | span 80 mm, the same hoop | 1.6 mm inside, stretch 6×, span 20.8 mm | The hoop is gone. The skirt hangs between the knees. The waistband sits off the body. |
| A-line, standing | — | 0 mm, stretch 1.23×, span 0 | The standing cut is unchanged. |
| Leggings, Sitting Crossed | 6.1 mm inside, stretch 39× | 17.2 mm inside, stretch 11.4× | The picture did not change. The crossed knee still has no outside that also keeps the edge under 6×. |

The gate is still open on the seated skirts and on the leggings. `fixed` stays no. Briefs on these frames stayed at 0 mm.

## Still open

1. Crossed-leg contact on the leggings and the boots. Success is stretch at or under 6× and penetration at or under 1 mm on the same frame. The 11× leggings edge is the recorded conflict.
2. The seated skirts still miss 8 mm of span and the waist gap in the picture. Do not close that by lifting the hem back up to the knee.
3. The seamless leggings mesh is a worker budget. Do not treat a hang as a penetration bug.

The 2 mm foundation brief is the control. A change that pulls it off the body or through the outer garment fails even if a skirt number improves.

A green unit fixture is not a closed live picture. Recapture the front frame named in `catalog-matrix.csv` and run `review_pictures.py check` before `review_status` can be `pass`.
