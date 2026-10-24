# Sitting (Wide): why the dress tore, and the posed cloth correction (SW1)

Pose Studio → Sitting (Wide) (preset 17 of 26) with Forge's **Black Bodycon Mini Dress
& boots** over a white foundation, on `fem-vroid` (the avatar Forge's operator declares
adult): the dress folded into triangles across her lap and her thighs came through it.

## Reproduced, measured

Forge's pose contact tools (`tools/inspect/` in 3D-Wardrobe-Forge,
`docs/POSE_CONTACT_QA.md` there) fitted the exact outfit through the real pipeline
(`fit_look.py --foundation-color white`) and posed every garment and her skin with the
rotations this app's Pose Studio applies (`export_homepilot_poses.mjs`).

Before any change, Sitting (Wide):

| Garment | Deepest inside her | Share inside | Worst edge |
| --- | --- | --- | --- |
| Black Bodycon Mini Dress | 23.0 mm | 4.76 % | 2.32× |
| White Tailored Briefs | 13.9 mm | 8.16 % | 1.71× |
| Black Over-The-Knee Boots (shaft) | 28.1 mm | 5.97 % | 6.66× |

(Edge stretch as `pose_contact.py` samples it; the all-edges figures below are higher.)

## What it is not

Every dress vertex that ends up inside her is a **bridging** vertex: 20–36 mm from her
skin at rest, spanning a gap — the back hem across the gap under her seat, the lap
across the gap between her thighs. Their skin weights match the skin under them within
a few per cent. Variants of the weighting, same look, same pose:

| Dress, Sitting (Wide) | Deepest inside | Share inside | Worst edge |
| --- | --- | --- | --- |
| As shipped (PS3 skin binding + PF2 smoothing) | 23.0 mm | 4.76 % | 2.32× |
| No smoothing | 22.3 mm | 4.76 % | 3.92× |
| Smoothing, skin-near vertices held (6 mm / 10 mm) | 23.0 mm | 4.76 % | 2.32× |
| Hung from the pelvis (cursor/sittingwide-* branches) | 33.5 mm | 11.47 % | 2.10× |

A weight cannot make one vertex follow two surfaces. Smoothing only spreads the tear;
hanging the dress from the pelvis lets both thighs through it. So the fix is not in the
weights.

## The fix: push the cloth out once she has settled

`src/wardrobe/PoseClothCorrection.js` (pure, tested) takes the posed garments and her
posed skin and, innermost layer first:

1. pushes every garment vertex that is inside — her skin, or a layer already corrected
   under it within 15 mm — out along that surface's normal to 1.5 mm;
2. pulls edges stretched past 1.15× their rest length back toward it (SW2; 1.3× and half
   strength for a shoe), so a pushed vertex takes its neighbours with it instead of tenting;
3. repeats (48 rounds; 16 for a shoe), then pushes once more against a fresh search, three
   times, so nothing is left inside where her surface folds;
4. unfolds any triangle the pushes turned over (SW3, below).

A shoe's foot is fixed (it is meant to hold her foot inside it). Her body never moves.

`src/gltf-viewer/PoseClothCorrector.js` runs it in a Web Worker
(`src/wardrobe/PoseClothWorker.js`) two frames after a Pose Studio preset settles or a
dragged bone is let go, CPU-skins her and the Forge garments exactly as the GPU does,
and writes the answer back into each garment's bind space through the inverse of each
vertex's skin matrix. The original positions are snapshotted on first use and written
back verbatim when she moves again (a new preset, a drag, another avatar): snapshot and
restore, not undo. `window.NEXUS_POSE_CLOTH_ENABLED = false` turns it off.

## Result, same look, same poses (all edges counted)

| Sitting (Wide) | Inside: before → after | Worst edge: before → after |
| --- | --- | --- |
| Black Bodycon Mini Dress | 23.0 → 0 mm | 4.45 → 2.46 |
| White Tailored Briefs | 13.9 → 0 mm | 3.61 → 1.98 |
| Black Over-The-Knee Boots (shaft) | 23.2 → 0.4 mm | 6.66 → 5.89 |

| Sitting | Inside: before → after | Worst edge: before → after |
| --- | --- | --- |
| Black Bodycon Mini Dress | 11.4 → 0 mm | 5.26 → 1.85 |
| White Tailored Briefs | 9.5 → 0 mm | 3.73 → 2.30 |
| Black Over-The-Knee Boots (shaft) | 24.2 → 0 mm | 6.42 → 2.49 |

Standing (Relaxed) stays clean (dress 4.0 → 0.5 mm, stretch ≤ 1.36).

### Measured in the browser

The same function, in this app's viewer (`PoseClothCorrector`, software-rendered
Chromium), on the same look, Sitting (Wide) applied from Pose Studio's own Apply.
The corrector measures against her torso and legs only (see below), so its "before"
differs from the offline table:

| Sitting (Wide), in the viewer | Inside: before → after | Worst edge: before → after |
| --- | --- | --- |
| Black Bodycon Mini Dress | 11.0 → 0 mm | 4.02 → 1.93 |
| White Tailored Briefs | 9.5 → 0 mm | 4.97 → 2.56 |
| Black Over-The-Knee Boots (shaft) | 36.2 → 0 mm | 6.01 → 2.97 |
| Black Over-The-Knee Boots (lining) | 20.5 → 0 mm | 14.55 → 1.59 |

The correction lands about 4 s after Apply (0.5 s of that is the blend), off the
main thread.

**Her arms are not a collision surface.** With her arms down the nearest skin to a
dress's sides is her forearm; pushing the dress away from it drove it into her waist.
An arm through cloth is the pose's problem. Skin whose dominant bone is an arm, hand
or finger is left out of the surface the cloth is pushed out of.

## SW3: the six engineering checks, and what they found

Asked to verify the fix itself, not its appearance, Forge's QA tools were extended
(`fit_checks.py`, `bake_pose_correction.py`, `engineering_sheet.py` in
3D-Wardrobe-Forge, `docs/POSE_CONTACT_QA.md` there): this file's correction is run on
the real look under node, baked back into a VRM, and measured with the same tools, pose,
camera and measurement as the look it came from. Six checks — gusset width, leg-opening
loops, a side section, wireframe continuity, a contact heatmap, the layer stack — each
found something the full-body screenshots had not:

- **Seams tore.** A glTF mesh splits a vertex wherever its UVs do; each copy was corrected
  on its own, and the bodycon's seams stood 41 mm apart. Copies are now welded (same rest
  position within 0.1 mm), corrected as one particle and written back to all: 0 mm.
- **A boot's lining was pushed out through its shell.** One garment of three materials is
  three meshes here, and each was corrected as a layer over the last. Pieces of one Forge
  node now share a `group` and are corrected as one cloth.
- **SW2's crease fix over-pushed.** Clearing the four nearest skin points threw a boot rim
  60 mm along the normal of skin across a fold, and took the dress's worst edge to 3.9×.
  Only points within 2 mm of the nearest count now (`creaseWindow`).
- **Triangles turned over** where neighbours were pushed along different normals. Folded
  triangles' corners are relaxed toward their neighbours and cleared again
  (`unfoldRounds`), as Forge's own fit does.
- **Behind her knee there is no outside.** At 90° her calf and thigh skin intersect; a
  vertex pushed out of one is inside the other. A shoe's vertex now moves at most 25 mm
  from where skinning put it (`SHOE.maxMove`); cloth is not capped (capped, the briefs
  and dress ended inside again).

Two causes were in Forge, and were fixed there rather than corrected here:

- the boot's shaft was bound by distance to her bones: its rim, 20 cm above her knee,
  carried a fifth of its weight on her shin, and seated that drove it 22 mm into her
  thigh. It now takes her skin's weights, as leggings do (heel and sole still on the
  foot). Skinned only, the boot's worst edge went 6.66× → 2.73×, its lining 15.2× → 1.07×;
- the briefs' gusset was 5.8 mm of fabric across: seating squeezed it between her thighs
  (Forge's parked GF1). Applied to the foundation Auto Foundation adds under clothes, it
  is 32–35 mm. The 35 catalogue pieces are byte-identical (GF1's three regressions and a
  1.3 mm shift of the guêpière are why it does not reach them yet).

Final, Sitting (Wide), measured by Forge on the look as it fits today with this
correction (C), against the look as first reported, skinned only (A):

| Check | A | C |
| --- | --- | --- |
| Gusset, fabric across the middle | 5.8 mm (cut) | 32–35 mm cut, ≥ 78 % kept posed |
| Leg openings: deepest inside, sharpest corner | 8.8 mm, 97° / 6.1 mm, 123° | 0 mm, 98° / 0 mm, 95° |
| Briefs inside her | 14.2 mm, 10.85 % | 0 mm |
| Dress inside her / inside the briefs | 23.2 mm / 16 samples, 14.2 mm | 0 mm / 1 sample, 3.0 mm |
| Seam gap, open edges, parts | 0 mm, unchanged | 0 mm, unchanged |
| Worst edge: briefs / dress / boot | 3.55× / 4.40× / 6.66× | 3.80× / 1.37× / 5.23× |
| Inverted triangles: briefs / dress / boot | 60 / 80 / 2 | 30 / 59 / 81 |
| Boot inside her | 23.2 mm, 9.79 % | 13.2 mm, 0.68 % (behind her knee) |

In this app's viewer (Pose Studio's own Apply, its worker's own numbers, which measure
against her torso and legs only): briefs 9.8 → 0 mm, dress 8.1 → 0.1 mm, boot 10 → 0.3 mm,
boot lining 0 mm, worst edges 2.38× / 1.74× / 3.0×; the correction lands about 12 s after
Apply in software-rendered Chromium.

## What remains

- **The boot at her knee.** With her skin's weights the shaft collapses at the front of her
  knee as her skin does (15 of her own triangles invert there): 81 inverted triangles, and
  13.2 mm inside on 0.68 % of its vertices in the fold behind it, where there is no outside
  to push to. A knee needs corrective shapes or a cloth solver, not this pass.
- **Inversions in the hip fold.** Briefs 30 and dress 59 triangles face against their
  skinned frame where her hip flexes 90°; fewer than skinning left (60, 80), not none.
- **The gusset in the pose.** Seated wide it keeps 78 % of its cut width at its narrowest
  station; GF1 holds the rest shape, nothing yet holds the posed one.
- A cloth solver with real stretch limits (Forge's XPBD, `clothRelaxation`) is the next
  step for all three, not more weighting.
- It corrects the settled pose. While a preset blends in or a bone is dragged the cloth is
  plainly skinned, as before.
