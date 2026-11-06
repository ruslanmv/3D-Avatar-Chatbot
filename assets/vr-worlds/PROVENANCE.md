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

The walled town loads on desktop only: it is over the 30K-triangle phone budget
and over the 150K desktop target, though merged it draws in under twenty calls.

## Asked for and not included

- **Quiet Grove** (polyhangar, CC0) and **Low Poly Nature Pack** (svartskogen,
  CC0): their itch.io pages would not hand the files to an automated download.
  The kits above cover the same ground (trees, rocks, grass, bushes).
- **ambientCG** HDRIs and textures: not needed, Poly Haven covers the panoramas.
- **Sketchfab**: licences vary per model; nothing was taken from it.
- Poly Haven's _Alkantstrand Sunset_ and other Vault-only HDRIs: not free.
