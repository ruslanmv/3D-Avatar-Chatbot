# Backplate production guide (A13)

How to author a scenic background that the 3D camera agrees with, instead of one
the avatar merely sits in front of.

## The problem, in one line

**Fitting an image to the viewport is not the same as matching its camera to the
3D camera.**

A2–A12 built a correct `background-size: cover` renderer. It is correct. A
backplate can still read as a cut-out, because a photograph or a generated image
has its own implicit horizon, eye height and vanishing lines, and nothing so far
made those agree with the `PerspectiveCamera` the avatar is projected through.

Telling an artist or an image model *"30 degree vertical FOV"* is weak guidance.
Telling it *"the horizon is at 44.4% of frame height and the feet touch the floor
at (50.0%, 89.7%)"* is a constraint it can satisfy and you can check.

## Get the numbers from the engine, not from this file

```
http://localhost:3000/?backgroundCalibration=1
```

This draws the horizon, the projected floor, the avatar-safe zone and the exact
foot-contact point over the live viewport, and prints the same figures to the
console as JSON. **Use that output**, because it is measured from the camera that
is actually rendering, with the avatar that is actually loaded.

The table below is what it produces for a 1.6 m avatar today. It is a reference,
not the authority — if they ever disagree, the overlay is right and this file is
stale.

## The two profiles

The app ships exactly two projections. Compose one master for each; **do not crop
one from the other.**

| | Landscape | Portrait |
| --- | ---: | ---: |
| Master | **1920 × 1080** | **1080 × 1920** |
| Vertical FOV | 30° | 42° |
| Camera pitch | 1.72° down | 1.72° down |
| **Horizon** | **44.4%** · y = 480 px | **46.1%** · y = 885 px |
| Foot contact | 50.0%, 89.7% · (960, 969) | 50.0%, 88.2% · (540, 1694) |
| Head top | 15.7% · y = 170 px | 16.9% · y = 325 px |
| Keep-clear band | 39.8–60.2% · x 765–1155 | 25.2–74.8% · x 272–808 |

### The horizon is not at the middle of the frame

It is the single most common thing to get wrong, and the reason is subtle:
`ViewerEngine.frameObject` places the eye at `target + normalize(0, 0.03, 1) ×
distance` — a slight lift, looking very slightly *down*. About 1.72°.

A first draft of the calibration module assumed a level camera and reported the
horizon at exactly 50%. Clean, memorable, and **60 px out** on a 1080-tall
master. If your image's horizon sits at mid-frame, the floor will not agree with
where the avatar's feet land.

### Ground-line convergence

For a landscape master, a level floor's depth lines fall at these heights. Match
a real floor, tiling, decking or paving against them and the perspective will
agree:

| Distance | Screen y | Pixels (1080) |
| ---: | ---: | ---: |
| 0.5 m | 84.8% | 915 |
| 1 m | 80.8% | 872 |
| 2 m | 74.8% | 807 |
| 4 m | 67.2% | 726 |
| 8 m | 59.7% | 644 |
| 16 m | 53.6% | 579 |

They converge on the horizon and never cross it — 53.6% at 16 m against a
horizon of 44.4%. That convergence *is* the
perspective cue — a floor whose lines converge somewhere else is the thing that
makes a composite read as flat.

## Composition rules

**Keep the band in the table clear of dominant foreground detail.** The avatar
stands there. A railing, a table edge or a tree trunk painted across it cannot
become a real occluder — with `scene.background` the avatar is always drawn in
front of the background pixels, so painted foreground reads as a mistake rather
than as depth.

The band is **not the same width in both profiles**, and that surprises people.
It is her projected silhouette plus a 3% margin, and in portrait `fitDistance` is
bound by her height, so the camera comes close and she fills far more of a narrow
frame: about 14% of the width at 16:9, but **over half** at 9:20. Earlier drafts
of this guide said "keep the central 40% clear" for both, which is conservative in
landscape and **narrower than the avatar herself** on a tall phone.

The practical consequence for portrait art: there is very little lateral room.
Put the interest **above and below** her, not beside her.

**Give the feet a surface.** There must be an unambiguous, continuous support
plane at the foot-contact row. This is the difference between standing on
something and hovering over a photograph.

**Never bake in an avatar, a person, or an avatar-shaped shadow.** The character
is real-time; a painted one is a duplicate, and a painted shadow will not match
where she is standing. Contact shadow is the renderer's job — note that desktop
shadows currently default **off** (`_shadowsEnabled = false`), which is worth
turning on when evaluating grounding.

**Compose for the avatar's lighting.** `ViewportBackgroundManager` deliberately
never touches lights, `scene.environment` or tone mapping, so a scene changes the
picture behind her and nothing about how she is lit. Until per-scene lighting
metadata exists, author images that sit comfortably with the default key/fill/rim
setup rather than ones that demand a relight.

## Using the numbers with an image generator

Text alone is weak for geometry. Research on controlled diffusion — ControlNet,
T2I-Adapter — is consistent that spatial conditions (depth, edges, segmentation,
pose) give far more reliable structural control than prose. So:

1. Run `?backgroundCalibration=1` at the target aspect.
2. Screenshot the overlay. That image *is* a spatial condition — horizon, floor
   convergence, safe zone and contact point, all in the right places.
3. Condition on it, and put the figures in the prompt as well.

A prompt fragment that carries the constraint:

> Horizon exactly at 44.4% of image height. Camera 0.99 m above a level floor,
> tilted 1.7° down, 30° vertical field of view. Continuous unobstructed floor
> across the lower third, reading clearly at the point 50% across and 89.7% down.
> No people, no characters, no cast figure shadows. Central 40% of the width free
> of foreground objects.

## What this does not yet cover

The renderer still takes **one image per scene** and crops it to fit. Authoring
two masters is useful immediately — the landscape one is what ships — but a
`variants: { landscape, portrait }` schema, and the manager choosing by viewport
geometry, is a separate piece of work and is not built.

Until it is, a portrait phone crops the landscape master to roughly 27% of its
width, centred. That is correct `cover` behaviour and it lands on the middle
third these images deliberately keep empty, so it reads as quiet sky or water —
but it is not the same as a portrait composition.

Foreground occlusion (a cutout layer drawn *in front of* the avatar) is likewise
out of scope. Three.js supports it via `colorWrite: false` depth-only geometry or
an RGBA overlay, but it is a second-generation feature.
