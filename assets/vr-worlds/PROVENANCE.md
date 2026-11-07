# VR worlds — provenance

Everything in this folder is **CC0 1.0** (public domain dedication): free for
any use, no attribution required. Credits are given anyway. Downloaded
2026-11-06 for batch VW1; nothing here was generated.

## Panoramas (`panoramas/`)

Poly Haven HDRIs, taken from each asset's _Tonemapped JPG_ (8192×4096), resized
with Lanczos to 4096×2048 (quality 82) and 2048×1024 (quality 85). Licence: CC0,
<https://polyhaven.com/license>.

| File stem           | Name                  | Authors                    | Source                                      |
| ------------------- | --------------------- | -------------------------- | ------------------------------------------- |
| `courtyard_night`   | Courtyard Night       | Greg Zaal                  | <https://polyhaven.com/a/courtyard_night>   |
| `evening_field`     | Evening Field         | Sergej Majboroda           | <https://polyhaven.com/a/evening_field>     |
| `lakes`             | Lakes                 | Sergej Majboroda           | <https://polyhaven.com/a/lakes>             |
| `lakeside_night`    | Lakeside Night        | Greg Zaal, Jarod Guest     | <https://polyhaven.com/a/lakeside_night>    |
| `pond_bridge_night` | Pond Bridge Night     | Greg Zaal                  | <https://polyhaven.com/a/pond_bridge_night> |
| `qwantani_night`    | Qwantani Night        | Greg Zaal, Jarod Guest     | <https://polyhaven.com/a/qwantani_night>    |
| `secluded_beach`    | Secluded Beach        | Greg Zaal, Rico Cilliers   | <https://polyhaven.com/a/secluded_beach>    |
| `sunset_forest`     | Sunset Forest         | Andreas Mischok            | <https://polyhaven.com/a/sunset_forest>     |
| `sunset_jhbcentral` | Joburg Central Sunset | Greg Zaal, Dimitrios Savva | <https://polyhaven.com/a/sunset_jhbcentral> |
| `venice_sunset`     | Venice Sunset         | Greg Zaal                  | <https://polyhaven.com/a/venice_sunset>     |

## Model kits (`kits/`)

Only the glTF/GLB models and the textures they use are kept; each kit's FBX and
OBJ copies are not. Every PNG texture larger than 1024 px was resized to 1024 px
(Meta's guidance for Quest: mostly 512–1024 px textures). Each kit's own licence
file is beside it as `License.txt`.

| Folder                        | Kit                                           | Author       | Source                                                     | Notes                            |
| ----------------------------- | --------------------------------------------- | ------------ | ---------------------------------------------------------- | -------------------------------- |
| `kenney-nature-kit`           | Nature Kit 2.1 (329 models)                   | Kenney       | <https://kenney.nl/assets/nature-kit>                      | GLB                              |
| `kenney-furniture-kit`        | Furniture Kit 2.0 (140)                       | Kenney       | <https://kenney.nl/assets/furniture-kit>                   | GLB                              |
| `kenney-fantasy-town-kit`     | Fantasy Town Kit 2.0 (167)                    | Kenney       | <https://kenney.nl/assets/fantasy-town-kit>                | GLB                              |
| `kaykit-forest-nature`        | KayKit Forest Nature Pack 1.0, free (105)     | Kay Lousberg | <https://kaylousberg.itch.io/kaykit-forest>                | glTF                             |
| `quaternius-stylized-nature`  | Stylized Nature MegaKit, Standard (68 of 116) | Quaternius   | <https://quaternius.com/packs/stylizednaturemegakit.html>  | glTF; the free Standard subset   |
| `quaternius-medieval-village` | Medieval Village MegaKit, Standard (176)      | Quaternius   | <https://quaternius.com/packs/medievalvillagemegakit.html> | glTF                             |
| `quaternius-modular-scifi`    | Modular Sci-Fi MegaKit, Standard (190)        | Quaternius   | <https://quaternius.com/packs/modularscifimegakit.html>    | glTF, see below                  |
| `3dassets-cozy-home`          | Cozy Home Interiors, starter scene            | 3dassets.dev | <https://3dassets.dev/packs/cozy-home-interiors>           | one GLB; not used by a world yet |

**One repair.** The Sci-Fi MegaKit's glTF files name their textures as if they
sat beside them, but the zip ships them in a separate `Textures/` folder, so as
downloaded no model found its textures. The 21 textures are in
`quaternius-modular-scifi/Textures/` and 179 models were rewritten to point at
`../Textures/<name>`. Nothing else was changed. Three decal files the kit
references are not in its download at all; no world uses those decals.

## Assembled scenes (`scenes/`)

Whole starter scenes from 3dassets.dev, downloaded 2026-11-06 for batch VW2,
used unmodified (the runtime merges their meshes by material at load time).
Licence: CC0 1.0 Universal, as stated on each pack page. 3dassets.dev reports
these packs as AI-assisted; each was reviewed visually in the app before
shipping.

| File                 | Scene                                          | Source                                                                                        | Triangles | Meshes |
| -------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- | --------- | ------ |
| `oak-glade.glb`      | Oak woodland glade (Forest Trees and Woodland) | <https://3dassets.dev/assets/temperate-forest-ecology-oak-woodland-gl-d28b8a78-starter-scene> | 46 091    | 68     |
| `meadow-courier.glb` | Meadow Courier — cozy village starter scene    | <https://3dassets.dev/packs/meadow-courier>                                                   | 22 448    | 90     |
| `mmo-realm.glb`      | Medieval MMO Starter Realm — walled town       | <https://3dassets.dev/packs/medieval-mmo-starter-realm>                                       | 224 939   | 1 922  |

**VW3 spaces**, downloaded the same day, same licence, same review:

| File                  | Scene                                              | Source                                                                                        | Triangles | Meshes |
| --------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------- | ------ |
| `bedroom-flat.glb`    | Furnished flat: bedroom and living room            | <https://3dassets.dev/assets/bedroom-and-living-room-furniture-furnis-0989213f-starter-scene> | 39 772    | 161    |
| `pixel-flat.glb`      | One-bedroom flat (Pixel Modern Apartments)         | <https://3dassets.dev/assets/pixel-modern-apartments-one-bedroom-flat-9c2366e2-starter-scene> | 28 760    | 493    |
| `lagoon-beach.glb`    | Lagoon beach (Tropical Island and Palm Trees)      | <https://3dassets.dev/assets/tropical-island-ecology-lagoon-beach-122c3ee3-starter-scene>     | 14 208    | 63     |
| `downtown-office.glb` | Open-plan office floor (Downtown Office Interiors) | <https://3dassets.dev/assets/downtown-office-interiors-open-plan-floo-fc7431a0-starter-scene> | 72 326    | 233    |
| `airship-dock.glb`    | Airship dock and workshop (Steampunk)              | <https://3dassets.dev/assets/steampunk-airship-dock-and-workshop-airs-10f46afc-starter-scene> | 141 396   | 570    |
| `neon-dispatch.glb`   | Neon Dispatch (cyberpunk street)                   | <https://3dassets.dev/assets/neon-dispatch-starter-scene>                                     | 16 464    | 178    |
| `roadside-motel.glb`  | Roadside diner and motel stop                      | <https://3dassets.dev/assets/retro-diner-and-roadside-motel-roadside--784bde2d-starter-scene> | 38 582    | 643    |

**LW2 — the apartment.** `pixel-flat-home.glb` (26 936 triangles) is
`pixel-flat.glb` above, cut by the recipe `home` in
`tools/vr/playground-subsets.json` (`node tools/vr/subset-scene.mjs home`): the
six `resident-*` figures and the crib are dropped. A shared flat for the two of
you should not have strangers cooking in the kitchen or reading in the bed, and
she would otherwise talk past people standing beside her. Nothing else changed;
same CC0 source. It is the scene of the `apartment` place on every device and of
the phone's `bedroom-light`. Its measured spots are
`assets/vr-worlds/spots/pixel-flat-home.json`, written by
`tools/vr/measure-spots.mjs`, which records this file's SHA-256 so a changed
model invalidates them.

Tried and not shipped: the Hotel and Resort guest room (no spot inside it with a
clear line to the camera — the hotel and candlelit suites are built from the
Kenney furniture kit instead) and the Cyberpunk Apartment Block (323K triangles,
over every budget).

The walled town loads on desktop only: it is over the 30K-triangle phone budget
and over the 150K desktop target, though merged it draws in under twenty calls.

**PG1 playgrounds (the V4 release)**, downloaded 2026-11-06 from 3dassets.dev,
CC0 1.0 Universal as stated on each asset page (attribution not required), same
visual review in the app. Two are shipped whole; the rest are **cut down by
recipe**, not edited by hand: `tools/vr/playground-subsets.json` names each
output's source and the top-level nodes it keeps, and
`node tools/vr/subset-scene.mjs` rebuilds them (three r147's loader and exporter
in headless Chromium). The cut files are float, not quantized, so they are
larger on disk than their triangle count suggests.

| File                        | From                                              | Source                                                                                        | Triangles |
| --------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------- |
| `pub-bar-room.glb`          | Bar room (Bar, Pub and Brewery Taproom), whole    | <https://3dassets.dev/assets/bar-pub-and-brewery-taproom-bar-room-d134f615-starter-scene>     | 94 872    |
| `pub-bar-room-light.glb`    | the same, recipe `pub-light`                      | as above                                                                                      | 29 058    |
| `club-main-room.glb`        | Club main room (Nightclub and DJ Booth), whole    | <https://3dassets.dev/assets/nightclub-and-dj-booth-club-main-room-4e00883e-starter-scene>    | 138 814   |
| `club-main-room-light.glb`  | the same, recipe `club-light`                     | as above                                                                                      | 27 904    |
| `cabaret-stage.glb`         | Playhouse stage (Theatre Stage and Backstage)     | <https://3dassets.dev/assets/theatre-stage-and-backstage-playhouse-st-bcd91a59-starter-scene> | 68 044    |
| `cabaret-stage-light.glb`   | the same, recipe `cabaret-light`                  | as above                                                                                      | 25 160    |
| `academy-seminar.glb`       | Seminar room (University Lecture Hall and Campus) | <https://3dassets.dev/assets/university-lecture-hall-and-campus-teach-1377fb44-starter-scene> | 41 160    |
| `academy-seminar-light.glb` | the same, recipe `academy-light`                  | as above                                                                                      | 29 356    |

`sources/playhouse-stage.glb` (202 994 triangles) and
`sources/lecture-campus.glb` (328 498) are the unmodified downloads the cabaret
and academy recipes cut from; the app never loads them. The cabaret keeps the
stage, its curtains and footlights and drops the stalls, the scenery flats and
backstage; the academy keeps the seminar room only (the tiered lecture hall is
118K triangles of benches on its own).

The **stream studio** is built from the Kenney Furniture Kit already listed
above (sofa, floor lamps, desk, screen, speaker, plants): 1 912 triangles.

`previews/*.webp` (PG2) are 640×480 renders of every place by name, made by this
app itself (`tools/vr/render-place-previews.mjs`, headless Chromium with
SwiftShader) for the venue cards; same licence as the repository.

Suggested and not used: **Tavern and Street** by Polymancer (itch.io) — its
licence was not checked and nothing was downloaded, because the CC0 pub above
covered the Irish pub; and the taproom starter scene (61K triangles, open
brewery floor) was downloaded and measured but the bar room read better as a
pub. No audio was added for any venue: none of these packs ships music, and no
unlicensed track is used.

## Asked for and not included

- **Quiet Grove** (polyhangar, CC0) and **Low Poly Nature Pack** (svartskogen,
  CC0): their itch.io pages would not hand the files to an automated download.
  The kits above cover the same ground (trees, rocks, grass, bushes).
- **ambientCG** HDRIs and textures: not needed, Poly Haven covers the panoramas.
- **Sketchfab**: licences vary per model; nothing was taken from it.
- Poly Haven's _Alkantstrand Sunset_ and other Vault-only HDRIs: not free.
