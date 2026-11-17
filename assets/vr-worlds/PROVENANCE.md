# VR worlds — provenance

Everything in this folder is **CC0 1.0** (public domain dedication): free for
any use, no attribution required, except the anime places below
(`scenes/anime-*.glb`, VW12), which are **CC BY 4.0** and must be credited where
they are shown. Credits are given anyway. Downloaded 2026-11-06 for batch VW1;
nothing here was generated.

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

| Folder                        | Kit                                           | Author       | Source                                                       | Notes                                  |
| ----------------------------- | --------------------------------------------- | ------------ | ------------------------------------------------------------ | -------------------------------------- |
| `kenney-nature-kit`           | Nature Kit 2.1 (329 models)                   | Kenney       | <https://kenney.nl/assets/nature-kit>                        | GLB                                    |
| `kenney-furniture-kit`        | Furniture Kit 2.0 (140)                       | Kenney       | <https://kenney.nl/assets/furniture-kit>                     | GLB                                    |
| `kenney-fantasy-town-kit`     | Fantasy Town Kit 2.0 (167)                    | Kenney       | <https://kenney.nl/assets/fantasy-town-kit>                  | GLB                                    |
| `kaykit-forest-nature`        | KayKit Forest Nature Pack 1.0, free (105)     | Kay Lousberg | <https://kaylousberg.itch.io/kaykit-forest>                  | glTF                                   |
| `quaternius-stylized-nature`  | Stylized Nature MegaKit, Standard (68 of 116) | Quaternius   | <https://quaternius.com/packs/stylizednaturemegakit.html>    | glTF; the free Standard subset         |
| `quaternius-medieval-village` | Medieval Village MegaKit, Standard (176)      | Quaternius   | <https://quaternius.com/packs/medievalvillagemegakit.html>   | glTF                                   |
| `quaternius-modular-scifi`    | Modular Sci-Fi MegaKit, Standard (190)        | Quaternius   | <https://quaternius.com/packs/modularscifimegakit.html>      | glTF, see below                        |
| `3dassets-cozy-home`          | Cozy Home Interiors, starter scene            | 3dassets.dev | <https://3dassets.dev/packs/cozy-home-interiors>             | one GLB; not used by a world yet       |
| `3dassets-hotel-resort`       | Hotel and Resort Operations (9 of 140)        | 3dassets.dev | <https://3dassets.dev/packs/hotel-and-resort-operations>     | GLB; the bathroom's pieces             |
| `3dassets-japanese-street`    | Japanese School and City Street (9 of 46)     | 3dassets.dev | <https://3dassets.dev/packs/japanese-school-and-city-street> | GLB, CC0; the shopping street's pieces |

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

**LW2 — the apartment.** `pixel-flat-home.glb` (26 468 triangles) is
`pixel-flat.glb` above, cut by the recipe `home` in
`tools/vr/playground-subsets.json` (`node tools/vr/subset-scene.mjs home`): the
six `resident-*` figures, the crib and the exercise bike are dropped. A shared
flat for the two of you should not have strangers cooking in the kitchen or
reading in the bed, and she would otherwise talk past people standing beside
her; the bike stood in the walkway, in the foreground of every kitchen and
dining view (LW3 walkthrough). Nothing else changed; same CC0 source. It is the
scene of the `apartment` place on every device and of the phone's
`bedroom-light`. Its measured spots are
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

| File                               | From                                                                         | Source                                                                                        | Triangles |
| ---------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------- |
| `pub-bar-room.glb`                 | Bar room (Bar, Pub and Brewery Taproom), whole                               | <https://3dassets.dev/assets/bar-pub-and-brewery-taproom-bar-room-d134f615-starter-scene>     | 94 872    |
| `pub-bar-room-light.glb`           | the same, recipe `pub-light`                                                 | as above                                                                                      | 29 058    |
| `club-main-room.glb`               | Club main room (Nightclub and DJ Booth), whole                               | <https://3dassets.dev/assets/nightclub-and-dj-booth-club-main-room-4e00883e-starter-scene>    | 138 814   |
| `club-main-room-light.glb`         | the same, recipe `club-light`                                                | as above                                                                                      | 27 904    |
| `cabaret-stage.glb`                | Playhouse stage (Theatre Stage and Backstage)                                | <https://3dassets.dev/assets/theatre-stage-and-backstage-playhouse-st-bcd91a59-starter-scene> | 68 044    |
| `cabaret-stage-light.glb`          | the same, recipe `cabaret-light`                                             | as above                                                                                      | 25 160    |
| `academy-seminar.glb`              | Seminar room (University Lecture Hall and Campus)                            | <https://3dassets.dev/assets/university-lecture-hall-and-campus-teach-1377fb44-starter-scene> | 41 160    |
| `academy-seminar-light.glb`        | the same, recipe `academy-light`                                             | as above                                                                                      | 29 356    |
| `airship-dock-light.glb`           | `airship-dock.glb` above, recipe `airship-light`                             | as above (VW3 table)                                                                          | 29 140    |
| `cinema-auditorium.glb`            | Cinema Multiplex and Foyer, recipe `cinema`                                  | <https://3dassets.dev/packs/cinema-multiplex-and-foyer> (starter scene)                       | 98 472    |
| `cinema-auditorium-light.glb`      | the same, recipe `cinema-light`                                              | as above                                                                                      | 27 168    |
| `hotel-lobby.glb`                  | Hotel lobby (Hotel and Resort Operations), whole                             | <https://3dassets.dev/packs/hotel-and-resort-operations>                                      | 52 298    |
| `hotel-lobby-light.glb`            | the same, recipe `lobby-light`                                               | as above                                                                                      | 29 752    |
| `restaurant-dining-room.glb`       | Dining room, 40 covers (Restaurant Kitchen and Dining), whole                | <https://3dassets.dev/packs/restaurant-kitchen-and-dining>                                    | 99 184    |
| `restaurant-dining-room-light.glb` | the same, recipe `restaurant-light`                                          | as above                                                                                      | 26 172    |
| `cocktail-bar.glb`                 | the same, recipe `cocktail-bar` (its bar corner)                             | as above                                                                                      | 16 804    |
| `swimming-pool.glb`                | Municipal baths (Public Swimming Baths and Poolside), recipe `pool`          | <https://3dassets.dev/packs/public-swimming-baths-and-poolside>                               | 67 112    |
| `swimming-pool-light.glb`          | the same, recipe `pool-light`                                                | as above                                                                                      | 28 484    |
| `sports-hall-court.glb`            | Sports hall (Community Sports Hall and Changing Rooms), recipe `sports-hall` | <https://3dassets.dev/packs/community-sports-hall-and-changing-rooms>                         | 34 524    |
| `sports-hall-court-light.glb`      | the same, recipe `sports-hall-light`                                         | as above                                                                                      | 25 248    |
| `soccer-ground.glb`                | Assembled club ground (Football Soccer Club Grounds), whole                  | <https://3dassets.dev/packs/football-soccer-club-grounds>                                     | 14 020    |
| `guild-tavern.glb`                 | Two-storey tavern (Adventurers Tavern and Guild Hall), whole                 | <https://3dassets.dev/packs/adventurers-tavern-and-guild-hall>                                | 58 604    |
| `guild-tavern-light.glb`           | the same, recipe `tavern-light`                                              | as above                                                                                      | 29 344    |
| `dungeon-rooms.glb`                | Three-room dungeon (Dungeon Room Builder), whole                             | <https://3dassets.dev/packs/dungeon-room-builder>                                             | 10 268    |
| `jungle-ruins.glb`                 | Lost city (Jungle Temple and Stone City), recipe `ruins`                     | <https://3dassets.dev/packs/jungle-temple-and-stone-city>                                     | 70 924    |
| `jungle-ruins-light.glb`           | the same, recipe `ruins-light`                                               | as above                                                                                      | 28 032    |

`sources/cinema-multiplex.glb` (176 506 triangles, SHA-256 `94ba5463…62a347`,
downloaded 2026-11-15, CC0 1.0 as stated on the pack page, reported there as
AI-assisted) is the unmodified starter scene the two cinema recipes cut from: a
foyer with concessions and an auditorium in one file. The desktop cinema keeps
the auditorium (the screen, six of the eight tiered rows, the recliner rows, the
aisle, the acoustic walls, light strips and speakers) and drops the foyer and
the two front rows; the phone and VR stand-in keeps the screen, two rows, the
floor in front and the walls behind and beside it. Both were looked at in the
app on desktop and at phone size before shipping (`lab_screenshot`).

The hotel lobby (downloaded 2026-11-15, CC0 1.0 as stated on the pack page,
reported there as AI-assisted, SHA-256 `2063ec0d…4b3073b`) is shipped whole; its
stand-in drops the trolleys, the luggage rack, the second lounge group and a few
small things. Neither file has a floor mesh (the world's ground disk is the
floor), so `measure-spots.mjs` has nothing to cast onto: her spot was computed
from the scene's node boxes by `tools/vr/clear-spot.mjs`, not typed.

The restaurant's dining room (downloaded 2026-11-15, CC0 1.0 as stated on the
pack page, reported there as AI-assisted) is shipped whole; its stand-in keeps
the tables nearest her and three banquette benches, and the cocktail bar is the
same file's bar corner on its own (counter, four stools, back-bar shelving, wine
cabinet). The file has neither walls nor a floor: the three worlds add walls as
props (the hotel kit's partition wall module) and a ground disk, and her spots
were computed by `tools/vr/clear-spot.mjs`.

`sources/swimming-baths.glb` (142 452 triangles) and `sources/sports-hall.glb`
(116 410) are the unmodified starter scenes the pool and hall recipes cut from
(downloaded 2026-11-15, CC0 1.0 as stated on each pack page, reported there as
AI-assisted). Both recipes drop the changing rooms and the foyer; the pool also
drops the spectator gallery (it left no room on the deck for her and a camera)
and, on phones and VR, the tank under the water. The soccer ground is shipped
whole. Her spots were computed by `tools/vr/clear-spot.mjs` (the pool with its
water kept out and the camera kept inside the hall).

`sources/lost-city.glb` (680 598 triangles) is the unmodified lost-city starter
scene the two ruins recipes cut from (downloaded 2026-11-15 with the tavern and
the dungeon, all CC0 1.0 as stated on their pack pages and reported there as
AI-assisted). The ruins keep one walled compound of it (gate tower, arch, walls,
colonnade) and none of its pyramid, plaza or jungle floor, which are most of its
triangles; the tavern's stand-in drops its floor tiles (a ground disk stands in)
and the gallery rail. Spots computed by `tools/vr/clear-spot.mjs`.

`sources/playhouse-stage.glb` (202 994 triangles) and
`sources/lecture-campus.glb` (328 498) are the unmodified downloads the cabaret
and academy recipes cut from; the app never loads them. The cabaret keeps the
stage, its curtains and footlights and drops the stalls, the scenery flats and
backstage; the academy keeps the seminar room only (the tiered lecture hall is
118K triangles of benches on its own).

The airship dock's phone and VR stand-in (`airship-dock-light`, recipe
`airship-light`) keeps the airship itself (envelope, nose, keel, gondola, tail,
both engine pods), its mooring mast and boarding stair, the nine deck plates
under her and toward the ship, and a few crates, a bollard, sandbags, a toolbox
and the airscrew rack. It drops the workshop shed, the far deck, the gantry and
the catwalks, and on purpose every node whose bounding box comes within 1 m of
her standing spot other than the floor: the jib crane (whose box contains her),
the catwalk corner (0.03 m) and the ballast weights (0.47 m). In a headset those
would be in reach. Same `at`/`turn` as the desktop scene.

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

## The shopping street (`kits/3dassets-japanese-street/`, VW10)

Nine models of the CC0 "Japanese School and City Street" pack, downloaded
2026-11-15 from the pack's own download links and kept unmodified. Triangles per
file (`tools/vr/subset-scene.mjs --list`): ramen shop 2 236, bookshop 3 328,
laundrette 2 944, shutter 3 280, road section 512, road with drain 768, vending
machine 1 732, cherry tree 2 294, bicycle rack 640; the world places one of
each, 17 734 in all. The pack's school rooms (classroom, lockers, gate, gym
shell) were not taken: see `docs/VR_WORLDS.md` ▸ The shopping street.

## The school (`scenes/japanese-school-grounds*.glb`, VW11)

The "Japanese School and City Street" pack's own starter scene, CC0 1.0
Universal as the pack page states, downloaded 2026-11-15 from
<https://3dassets.dev/download/japanese-school-and-city-street-school-g-b3013a62-starter-scene>
(2.3 MB). `japanese-school-grounds.glb` is the file as downloaded: 88 606
triangles, 81 top-level nodes (the grounds, the lockers, one classroom, the
covered walkway, the gate, the street and shopfronts, cherry trees).
`japanese-school-grounds-light.glb` is cut from it by the recipe `school-light`
in `tools/vr/playground-subsets.json`
(`node tools/vr/subset-scene.mjs school-light`): 26 466 triangles, 24 nodes (the
courtyard and its floor, the covered walkway, the shoe lockers, the classroom
front, the gate, the bicycle shelter, the cherry trees and fountain). The pack
is listed by 3dassets.dev as AI-assisted; the scene was reviewed visually in the
app.

## Asked for and not included

- **Quiet Grove** (polyhangar, CC0) and **Low Poly Nature Pack** (svartskogen,
  CC0): their itch.io pages would not hand the files to an automated download.
  The kits above cover the same ground (trees, rocks, grass, bushes).
- **ambientCG** HDRIs and textures: not needed, Poly Haven covers the panoramas.
- **Sketchfab**: licences vary per model; nothing was taken from it.
- Poly Haven's _Alkantstrand Sunset_ and other Vault-only HDRIs: not free.

## Anime places (`scenes/anime-*.glb`, VW12)

Downloaded from Sketchfab on 2026-11-17 through the signed-in download API.
Every model is **CC BY 4.0** (<https://creativecommons.org/licenses/by/4.0/>):
free for commercial use and redistribution **with credit**. The credit is shown
in the app, in each place's note. Changes made (allowed by CC BY, and stated
here as it requires): textures resized to at most 1024 px and re-encoded as
WebP; unused data pruned; for the phone and Quest versions (`*-light.glb`) the
mesh simplified with gltf-transform (meshoptimizer) to under 30 000 triangles
and textures cut to 512 px, keeping colour textures only (normal, roughness and
occlusion maps removed); the entrance's light version also drops one object
(recipe `anime-entrance-light`). No model was taken from an existing game or
anime.

| File stem                | Model                         | Author                             | Source                                                                                           |
| ------------------------ | ----------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `anime-school-classroom` | The Japanese School Classroom | volvor                             | <https://sketchfab.com/3d-models/the-japanese-school-classroom-d9fc039ba0b6433db91ec129abe86b52> |
| `anime-school-corridor`  | The Japanese School Corridor  | volvor                             | <https://sketchfab.com/3d-models/the-japanese-school-corridor-f7775fea6fc34f518424ef9cad55c926>  |
| `anime-school-hallway`   | School\_[hallway]             | Comicaroid (yuuuusukeeee)          | <https://sketchfab.com/3d-models/school-hallway-0f1e9ea00ef94425a62c28d26773ed47>                |
| `anime-school-stairs`    | School\_[stairs]              | Comicaroid (yuuuusukeeee)          | <https://sketchfab.com/3d-models/school-stairs-287058f9d2034f26a9f00e05e2138310>                 |
| `anime-school-entrance`  | School\_[entrance]            | Comicaroid (yuuuusukeeee)          | <https://sketchfab.com/3d-models/school-entrance-62bf26754b2e42fd960dccfc3f9f6ceb>               |
| `anime-classroom-small`  | Japanese Classroom            | ouz209                             | <https://sketchfab.com/3d-models/japanese-classroom-54bdec1baa5c4855a45a4f956d947960>            |
| `anime-subway-car`       | Subway\_[interior]            | Comicaroid (yuuuusukeeee)          | <https://sketchfab.com/3d-models/subway-interior-b7f25426ac674a9291ba092fb9fe8406>               |
| `anime-tatami-room`      | Japanese Tatami Room Set      | Geraldo Pratama Wahyu Teddy (juyo) | <https://sketchfab.com/3d-models/japanese-tatami-room-set-8b5108dde0f24f76bda2313750e80134>      |

Not taken, for phone and Quest performance: _Japanese street at night_
(afx*cgmotion; 107 textures, 142 MB of GPU texture memory even reduced) and
\_Japanese Suburban Grandma's House* (trishalui; 36 draw calls and 44 MB of
textures, an exterior diorama). Also not taken: _School Rooftop_ (clonekrakein;
111 000 triangles over 120 × 205 m, with a skeleton and an animation, too heavy
to make light), and anything ripped from a game (_Yakuza 5 – Karaoke room_,
_Yandere Simulator_ props).
