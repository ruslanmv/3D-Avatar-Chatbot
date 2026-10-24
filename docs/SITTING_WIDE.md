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
2. pulls edges stretched past 1.3× their rest length back toward it, so a pushed vertex
   takes its neighbours with it instead of tenting;
3. repeats (16 rounds), then pushes once more against a fresh search, three times, so
   nothing is left inside where her surface folds.

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

## What remains

- About 1 % of the dress's edges are still over 1.5× in Sitting (Wide): a bodycon across
  a wide lap is stretched, and the correction keeps cloth outside her before it keeps it
  short. A cloth solver with real stretch limits (Forge's XPBD, `clothRelaxation`) is
  the next step, not more weighting.
- The boot shaft's worst edges are at its top band over her thigh; penetration is fixed,
  the band is still stretched.
- It corrects the settled pose. While a preset blends in or a bone is dragged the cloth is
  plainly skinned, as before.
