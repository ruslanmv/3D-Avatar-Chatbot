# Scene background provenance

Ten starter scenes for the viewport background feature (batch A6).

## Where these files came from

Copied from **[`ruslanmv/yourfriend`](https://github.com/ruslanmv/yourfriend)**,
at `public/ambient/{light,dark}/`, commit `80bd1fe`. The filenames are
unchanged, so the two sets stay diffable.

They are photoreal scenes, 1672×941 WebP, in matched light/dark pairs — the same
place by day and by night. Composition matters as much as content here: each one
keeps the middle third open and puts its detail at the edges, which is what a
viewport background has to do when an avatar stands in the centre of the frame.

**Total: 1.25 MB across ten files.**

## Licence — read this before reusing them elsewhere

`ruslanmv/yourfriend` **declares no licence.** Its README states that until the
owner adds explicit terms, everything in it — imagery included — is _all rights
reserved and unavailable for redistribution or commercial reuse without
permission_.

These files are here because **the owner of both repositories (ruslanmv)
directed their use here**, and this repository is Apache-2.0. They are covered
by that permission, not by anything visible in the source repository.

That distinction matters to anyone auditing the chain. A third party reading
`ruslanmv/yourfriend` today would conclude these images may not be
redistributed, and nothing there contradicts that. **The clean fix is
upstream**: add a licence file, or a note beside `public/ambient/`, recording
that this set is released under Apache-2.0. Until that exists, this file is the
only record of the permission.

Anything that later replaces these must be Apache-2.0 or compatible, with its
real provenance recorded here.

## The fallback set

[`tools/ambience/generate-backgrounds.py`](../../tools/ambience/generate-backgrounds.py)
generates ten abstract stand-ins at the same ten paths — gradient skies, horizon
bands, silhouettes, water. They are **not** photoreal and are not what ships.

They exist for the case where the photoreal set cannot be used: they are a
deterministic function of a script in this repository, so they are Apache-2.0 by
construction, with no third-party provenance to trace at all. Run:

```bash
python3 tools/ambience/generate-backgrounds.py
```

and they overwrite the files below. Nothing else in the feature changes — the
catalogue names paths, not pixels, which is the property that makes either set
droppable.

## The files

| Path                                 | Scene id                | Reads as                      |
| ------------------------------------ | ----------------------- | ----------------------------- |
| `light/ocean-sunrise.webp`           | `ambient:ocean:day`     | Sun low over open sea         |
| `dark/ocean-moonlight.webp`          | `ambient:ocean:night`   | Moon and lantern over water   |
| `light/mountain-lake.webp`           | `ambient:lake:day`      | Peaks mirrored in a lake      |
| `dark/mountain-lake-night.webp`      | `ambient:lake:night`    | The same under a moon         |
| `light/meditation-garden.webp`       | `ambient:garden:day`    | Stone garden, open water      |
| `dark/meditation-garden-night.webp`  | `ambient:garden:night`  | The same, lantern-lit         |
| `light/coastal-terrace.webp`         | `ambient:terrace:day`   | Balustrade above a bright sea |
| `dark/coastal-terrace-twilight.webp` | `ambient:terrace:night` | The same at night             |
| `light/open-sky.webp`                | `ambient:sky:day`       | Cloud and blue, nothing else  |
| `dark/starlight-sky.webp`            | `ambient:sky:night`     | Moon, stars, thin cloud       |

## What the catalogue cannot satisfy

The resolver knows fourteen intents; this set answers the sea, lake, garden,
terrace and sky ones. There is **no forest, fire, rain, city or fantasy scene.**
That is a content gap, not a bug — `Resolver.satisfiableIntents()` computes the
companion's vocabulary from whatever is actually here, so she never offers to
take somebody to a forest and then quietly declines.
