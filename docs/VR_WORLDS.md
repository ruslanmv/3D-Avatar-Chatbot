# VR worlds (VW1)

Places to be in, in the headset: a 360° photograph around you, a few real 3D
objects near her, and light that matches. 13 worlds, all CC0
(`assets/vr-worlds/PROVENANCE.md`).

## Using it

- **Plain VR is unchanged.** With Settings ▸ VR WORLD on *Automatic* (the
  default) a session nobody asked a place for stays black with the floor grid.
- **Experiences bring their place.** Seaside evening → *Seaside evening*
  (Venice at sunset), Under the trees → *Under the trees*, Ten quiet minutes →
  *Starlit lake*, Scene Tale → *Garden after dark*, Relax together → *Meadow at
  sunset*, Work on something / Copilot Hour → *City rooftop*, An evening
  together → *Cozy room*. Start or end one in the headset and the place
  changes.
- **Or pick one** in Settings ▸ VR WORLD to always be there. *Off* never shows a
  world. AR never does (passthrough is your room).
- **Check a world without a headset:** open `/?vrWorld=under-the-trees` (any
  id from `assets/vr-worlds/worlds.json`) and it is drawn on the desktop.

## How a world is built

| Layer      | What                                                                             |
| ---------- | -------------------------------------------------------------------------------- |
| Panorama   | 4096×2048 JPG (2048 fallback) on a sphere whose lower half is flattened onto the floor, so the photo's ground lies under her feet |
| Foreground | ≤ 40 props from the kits, each sized by `height` or `width` in metres and centred on `at` |
| Light      | the scene's own hemisphere/key/fill/rim lights retinted; no new lights, no shadows |
| Contact    | one soft shadow under her                                                        |

Coordinates in `worlds.json` are metres around her: +z toward the person,
−z behind her. `yaw` turns the photograph, `activities` names the Together
activities that bring it.

## Comfort and performance (Meta's guidance, applied)

- **Fade through black** for every change of place (0.25 s each way), never a
  cut; the change happens while the view is black.
- **Nothing streams in:** the photo and every model load first, then the swap.
- **Personal space:** the catalogue check refuses any prop within 1 m of the
  person, between the two of you, or inside her (flat things like a rug may lie
  under her). A test holds every shipped world to it.
- **World-locked, real scale, stationary:** nothing follows the head except the
  fade; no locomotion; the floor is the floor.
- **She stays lit:** a night world may be dark, her face may not (minimum
  hemisphere and fill light).
- **Budget:** panoramas ≤ 4096 px, kit textures ≤ 1024 px, no real-time shadows,
  anisotropic filtering on the photo's ground. Measured frame times on a Quest
  are still to be taken — see below.

## Not done yet

- **No measurement on a headset.** Everything above was checked in headless
  Chromium on the desktop (`?vrWorld=`), not at 72 Hz on a Quest.
- **No ambient sound.** The code plays a world's `ambient` loop, but the scene
  loops the Together scenes name (`src/features/together/scenes/assets/*.ogg`)
  are not in the repository, so no world names one.
- New materials compile on the first frame a world is shown; that frame is
  under the black of the fade.
