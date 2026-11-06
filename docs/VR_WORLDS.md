# Worlds (VW1–VW3)

Places to be in, in the headset: a 360° photograph around you, a few real 3D
objects near her, and light that matches. 13 worlds, all CC0
(`assets/vr-worlds/PROVENANCE.md`).

## On the screen too (VW2)

An experience brings its world to the **desktop and the phone**, not only the
headset: Seaside evening, Under the trees, Ten quiet minutes, Relax together,
Scene Tale and the rest show their place around her in the normal viewport, and
Seaside's placeholder boxes are hidden while it is up. Ending the experience
fades back to the normal background.

**Phones get only light worlds.** Each world declares its triangles and the
devices it may load on (`tiers`); a world over 30 000 triangles never loads on a
phone, which then takes the next world for the same experience. Phones always get
the 2K picture. So Under the trees is the real oak glade on a desktop and in the
headset, and the light props version on a phone; Scene Tale is the walled town
on a desktop and the garden after dark elsewhere.

| World           | Scene                          | Triangles | Where             |
| --------------- | ------------------------------ | --------- | ----------------- |
| Oak glade       | 3dassets.dev oak woodland      | 46K       | desktop, VR       |
| Meadow village  | 3dassets.dev Meadow Courier    | 22K       | phone, desktop, VR|
| Walled town     | 3dassets.dev MMO starter realm | 225K      | desktop           |

Every scene is merged by material when it loads (68 meshes → 11 draw calls,
1 922 → 19), and so are each world's props. Stylized scenes get a painted
gradient sky and soft fog instead of a photograph. A wide, short viewport comes
in to conversation framing while a world is up (`framingFor`).

## Places by name (VW3)

**Experiences ▸ Visit a place** lists the spaces: Hotel suite, Bedroom, Lagoon
beach, Office, Airship dock (steampunk, desktop only), Neon street (cyberpunk).
Choosing one starts it like any experience — the status bar reads
"Experiences · Hotel suite" with End experience, she says one line, and the world
appears around her. On a phone each place is its light version, and a place with
none (the airship dock) is not listed.

**Private ▸ Set the atmosphere ▸ Or a 3D room** offers the romantic rooms and the
private ones — the Roadside motel and the Candlelit suite. A private room is
never offered anywhere else, never in Settings, never by an activity or a
`?vrWorld=` preview: the engine loads one only when the Private experience asks,
and Private asks only after its own gates (Private mode, an avatar Forge
declares adult, the consent flow) and only once Begin is pressed. Stopping
Private takes the room away. The rooms are places, nothing more: what happens
in them is the Private experience's own rules, unchanged.

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
