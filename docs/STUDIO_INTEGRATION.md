# 3D-Ambience-Studio → this app

How the Studio works, and how to get assets out of it that this chatbot can
actually show.

Analysed at `ruslanmv/3D-Ambience-Studio@46a7c99` ("First commit") — 52 files,
21 Python modules, Apache-2.0.

## What the Studio is

A FastAPI + React asset factory. It does not render anything at runtime and the
chatbot never calls it; it produces static files that get committed.

```
prompt ──► panorama provider ──► optimise ──► validate ──► publish
           mock | panfusion      4096×2048     schema       catalog.json
           | text2vr             2048×1024     check        + environment.json
           (HTTP GPU worker)     768×384                    + panorama-*.webp
```

- `apps/api/ambience/workflow.py` — the five stages above, one method each
- `providers/` — `mock` (deterministic, for tests), plus `panfusion` and
  `text2vr` as **HTTP adapters**. Neither model is vendored; both expect an
  external GPU worker at `POST {base}/generate {prompt, seed}` returning image
  bytes or a `download_url`. `workers/` is a README and nothing else.
- `services/image_pipeline.py` — resizes to three targets, **never upscales**,
  and rejects anything not 2:1 within 1%
- `services/publisher.py` — writes `environment.json` + assets into
  `environments/<id>/<version>/`, atomically via a `.tmp` directory
- `schemas/environment.schema.json` — the manifest contract, `additionalProperties: false`

The security posture is sound and matches ours: a manifest carries **semantic**
lighting and effect presets (`"preset": "sunset-soft"`, `"type": "rain"`), never
executable JavaScript or shader source. `docs/AVATAR_CONTRACT.md` states that
explicitly.

## The mismatch, which is the whole story

**The Studio makes 360° equirectangular panoramas. This app consumes flat
backplates.**

| | Studio | This app |
| --- | --- | --- |
| Format | 2:1 equirectangular | flat, ~16:9 |
| Size | 4096×2048 / 2048×1024 | 1672×941 |
| Rendering | intended as a skybox | `scene.background` + `repeat`/`offset` cover crop |
| Id | `sunset-beach` | `ambient:sea:day` (`ID_PATTERN` enforced) |
| Manifest | `environment.json`, 11 top-level fields | one entry in `backgrounds.json`, 10 fields |
| Lighting | `lighting.preset`, `exposure`, `keyIntensity` | **no consumer** — the manager never touches lights |
| Effects | rain, snow, fireflies, dust, stars, fog | **no consumer** |
| Audio | `audio.ambient`, loop, volume | **no consumer** in the ambience path |
| Categories | 10-value enum | resolver's own vocabulary, partial overlap |

Copy a Studio panorama into `assets/ambient/` unchanged and it renders as a
**stretched, bowed rectangle** — three.js has no idea it is a panorama, so the 2:1
projection is squashed onto 16:9, poles smeared and horizon curved. Nothing lines
up with the avatar's floor.

### Why not just set the equirect mapping?

`texture.mapping = THREE.EquirectangularReflectionMapping` would fix the
projection and is still the wrong move here:

- In r147 it routes through `WebGLCubeMaps.get()`, building a
  `WebGLCubeRenderTarget` at `image.height / 2`. You pay for the source texture
  **and** the cube — tens of megabytes for a Quest-sized panorama, against a
  ~256 MB budget on that device.
- It replaces the cover crop with a live 360° view, so there is no longer a fixed
  composition to author against — and the whole point of
  `docs/BACKPLATE_PRODUCTION.md` is that the image and the camera have to agree.
- A12 established that VR, AR and Companion each snapshot and restore
  `scene.background`. A cube-mapped background is a different kind of value
  passing through those three hand-offs, which would need re-auditing.

## The bridge: reproject, don't reinterpret

`tools/ambience/studio-import.py` takes **one perspective view** out of the
panorama, through this app's exact camera:

```
360° equirect  ──►  sample along camera rays  ──►  flat 1920×1080 backplate
  (Studio)          30° vFOV, 16:9, 1.72° down      (what ViewerEngine wants)
```

This is the right shape of answer because it inverts the problem. Instead of
hoping a generated image happens to match the camera, it *derives* the image from
the camera — the horizon, floor convergence and vanishing lines come out correct
by construction.

```bash
python3 tools/ambience/studio-import.py <environment-dir> --scene cove --variant day
```

It writes a landscape and a portrait backplate and prints a ready catalogue
entry. It refuses anything that is not 2:1 rather than distorting it.

### Verified, not assumed

The reprojection and `CalibrationGeometry.js` are two implementations of one
camera, in two languages. They were checked against each other with a synthetic
panorama whose horizon is at latitude 0 exactly:

| | Result |
| --- | --- |
| Reprojected horizon | **44.44%** of frame height |
| `CalibrationGeometry` prediction | **44.40%** |
| Level-camera control | **50.00%** exactly |

`tests/ambience-studio-import.test.js` pins the constants behind that agreement —
`EYE_LIFT`, both FOVs, both master sizes — so the two cannot silently drift
apart.

### What the importer cannot fix

**Composition.** A panorama generated as a 360° sky has no avatar-safe zone and
no reason to keep its central 40% clear. The reprojection is geometrically
correct and can still put a tree through the avatar's head. Studio prompts need
the constraints from `docs/BACKPLATE_PRODUCTION.md`.

**Resolution.** A 30° vertical FOV at 16:9 is **50.9° horizontal**, so a
4096-wide panorama contributes only `4096 × 50.9/360 ≈ 580 px` across a view that
gets stretched to 1920 — **about a seventh of the panorama's width, upscaled
3.3×**. The Studio's pipeline never upscales its own outputs, but this step
unavoidably does.

**Generate wider than you need.** To land 1920 real pixels in the view you would
need a panorama about `1920 × 360/50.9 ≈ 13,600 px` wide. That is likely beyond
what a diffusion worker will produce in one pass, which is the honest limit of
this route and the reason route 2 below is worth the work.

**Lighting and effects.** `lighting.preset` and `effects[]` have no consumer here
and are dropped. The manager deliberately never touches lights or
`scene.environment` (asserted by test), so a "sunset-soft" manifest changes the
picture and nothing about how the avatar is lit.

## Three ways to use the Studio, in increasing order of work

**1. As a panorama source, reprojected.** What the importer does today. No app
changes, and it works now — but it throws away six-sevenths of the panorama and
upscales what is left, so expect softness unless the worker can generate very
wide.

**2. As a backplate generator.** Skip the panorama entirely: point a Studio
provider at a model conditioned on the calibration overlay
(`?backgroundCalibration=1`) and have it emit 1920×1080 directly. This wastes no
pixels and gives the compositional control the panorama route cannot. It needs a
new provider in `providers/` and a second shape in `image_pipeline.py`, which
currently hard-codes 2:1.

**3. As a full environment source.** Adopt the Studio's richer manifest —
lighting presets, effects, audio, per-device variants — and build the runtime to
consume it. This is a large piece of work and would change what "ambience" means
in this app. It is what `docs/AVATAR_CONTRACT.md` assumes, and it is not what
A0–A13 built.

Route 1 is available now. **Route 2 is the one I would spend effort on**, because
it attacks the resolution loss and the composition problem at once: a backplate
generated directly at 1920×1080 wastes no pixels and can be conditioned on the
calibration overlay, where a panorama can be neither.

## Two things to fix on the Studio side

**`workers/` is empty.** Both real providers are HTTP adapters to a GPU worker
that does not exist in the repo. Until one does, `mock` is the only provider that
runs, and it is deterministic test output rather than art.

**PanFusion and Text2VR need the licence audit the repo already flags.**
`providers/registry.py` says so in its own notes: *"Do not assume bundled Text2VR
dependencies are uniformly MIT."* Model weights, training data and
generated-output rights are separate questions from the repository licence, and
assets that ship here have to be Apache-2.0-compatible with provenance recorded —
see `assets/ambient/PROVENANCE.md` for the shape that record takes.
