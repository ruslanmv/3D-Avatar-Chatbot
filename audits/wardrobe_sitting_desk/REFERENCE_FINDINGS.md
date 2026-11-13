# Reference finding — seated pencil skirt

The original screenshots were two rear views and one front view labelled **Black
Pencil Mini Skirt**, Look 5 / 6, Sitting (Desk). They were supplied in
conversation and were not produced by this runner.

## What the pictures suggested

- **Front:** the skirt looked lifted or parted over the seated thighs, with a
  pale underlayer showing.
- **Rear:** a flat grey panel and dark fragments near the hem.
- The stage label still said Black Pencil Mini Skirt.

## What is confirmed

`WARDROBE-CLIP-001`, owner `3D-Avatar-Chatbot`, component
`src/wardrobe/PoseClothCorrection.js`.

A skirt or dress panel bridges the opening between the thighs. Skinning drops
that panel into the opening. The opening is not inside either thigh, so the
nearest-surface push never moves it and the hem stays parted. On a two-thigh
fixture the uncorrected panel stays below the thighs while thigh penetration
itself goes to 0. With `profile: 'span'` the measured drop goes from 74 mm to 0.
The fixture picture is `reports/sd1-span-fixture.png`. It is a diagram of that
measurement, not a photograph of the avatar.

`profileFor` selects skirts, dresses and gowns from Forge's `templateId`
(`skirt-glam-pencil-mini-v1` is the catalog id of Pencil Mini Skirt). Jeans,
leggings, a catsuit and a dress shirt are not spans.

## What the live captures show

Two Try-On sessions, camera orbit, software WebGL, cloth phase `applied`.

`look_f9fae4dd7cf04838`, labelled Black Pencil Mini Skirt (bandeau and skirt),
Sitting (Desk):

|                                    | Span drop | Penetration | Edge stretch |
| ---------------------------------- | --------: | ----------: | -----------: |
| Cloth off                          |  124.1 mm |      8.5 mm |        4.97× |
| First lift, aimed at the rest pose |  130.5 mm |        0 mm |        1.85× |

The front frames are `reports/evidence/pencil-sittingDesk-cloth-off-front.png`
and `reports/evidence/pencil-sittingDesk-restward-front.png`. The hem is still
parted. Aiming the lift at the rest pose made the measured drop worse, because
that standing hem hangs below the seated knee. That direction is no longer used.

The same look key was not on the rail in a later session (the rail had grown
from 3 looks to 6, and this key was absent). A different saved look,
`look_698e7f5cac96421d`, also labelled Black Pencil Mini Skirt, was captured
with the cut-relative lift. Its skirt mesh went from 59.9 mm to 24.4 mm in
Sitting (Desk). 24.4 mm is still over the 8 mm gate. Standing on that look
passed the gate. It is not a before/after of the bandeau look, and it is not a
fix.

`WARDROBE-DEFORM-002` is separate. Crop top & jeans, Sitting (Desk), front:
after correction the jeans report 0 mm penetration and 2.77× stretch, and the
photograph shows the hips and crotch open. Standing on the same look is a closed
pair of jeans. The frames are under `reports/evidence/jeans-*.png`.

## What is not confirmed

The rear grey panel in the original reference shots may also be a material or
mesh assignment in Forge. That is not established. Neither live skirt is marked
fixed.

Missing catalog previews (High-Waist Leggings, Leggings, Seamless Scrunch
Leggings) are a separate P3 owned by 3D-Wardrobe-Forge. The inventory run
records them. They are not a reason to invent preview URLs.
