# Alternate scene plates — 2026-09-19

Twenty plates supplied by the repository owner as
`scene_tale_20_images_original_webp.zip`, added here **alongside** production
rather than over it.

Nothing references these files. `scene-tale-art.json`, `backgrounds.json` and
`SceneCatalog` all still name `assets/ambient/{light,dark}/…`, which is
untouched. The filenames here are deliberately identical to the production ones,
so adopting the set is a directory copy and nothing else — the catalogue names
paths, not pixels.

## Why they are not in production

They do not satisfy the camera contract the shipped set was composed against,
and the gap is structural rather than a matter of taste. Two examples, both
visible at a glance:

- **`light/coastal-terrace-day.webp`** has a pergola post running floor to
  ceiling **down the centre of the frame**. The avatar's safe zone is 39.8–60.2%
  of the width in landscape, so she would stand inside the post. The bottom of
  the frame is a sofa, a coffee table and planters, so there is no ground for
  her feet either.
- **`light/ocean-sunrise.webp`** is breaking surf and wet sand at the bottom
  edge. The shipped plate is a flagstone terrace with a bench — continuous,
  readable ground at the row the contract puts her feet on (89.7%).

Neither is a bug in the images. They are good pictures of places; they are just
not composed for a camera that has a character standing in them.

The other difference is resolution of detail. Same pixel dimensions, far less
information:

| Set              | Total  | Per plate  | Look                            |
| ---------------- | ------ | ---------- | ------------------------------- |
| Production (A19) | 5.9 MB | 217–394 KB | Photoreal, sharp                |
| This set         | 878 KB | 23–81 KB   | Illustrated, soft, some banding |

6.9× smaller at 1920×1080 and 1080×1920. That shows as blur in the midground and
banding in large sky gradients, which a full-viewport background is the worst
possible place for.

## What is verified

- All twenty decode, and every one is its profile's master size from
  `camera-contract.json` — 1920×1080 landscape, 1080×1920 portrait. So they are
  installable; the objection above is about composition, not format.
- Filenames and the ten `generationKey` values match production exactly.

## Provenance — incomplete

The package arrived as images with no `provenance.json`, so **the generator, the
model and the prompts are not recorded**, and they must be before anything here
ships. The licence position is unchanged: anything at these paths has to be
Apache-2.0 or compatible, per `../../PROVENANCE.md`.

## If you want to adopt them anyway

```bash
cp assets/ambient/alternates/2026-09-19/light/*.webp assets/ambient/light/
cp assets/ambient/alternates/2026-09-19/dark/*.webp  assets/ambient/dark/
```

No code change is needed. Turn on `?backgroundCalibration=1` afterwards and
check where her feet land against the ground lines — that overlay is what the
composition objection above is measured with.
