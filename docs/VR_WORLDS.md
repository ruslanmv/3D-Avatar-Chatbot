# Worlds (VW1–VW3, PG1)

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
beach, Office, Airship dock (steampunk), Neon street (cyberpunk).
Choosing one starts it like any experience — the status bar reads
"Experiences · Hotel suite" with End experience, she says one line, and the world
appears around her. On a phone each place is its light version, and a place with
none is not listed.

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

## Playgrounds: places with things to do (PG1, the V4 release)

Five venues, each a world in `worlds.json` plus a **template** of things to do
there:

| Venue                 | Rating  | Desktop                  | Phone (light stand-in)   | VR          |
| --------------------- | ------- | ------------------------ | ------------------------ | ----------- |
| Irish pub             | general | bar room, 94 872 tris    | 29 058 tris              | light       |
| Neon discoteca        | general | club room, 138 814 tris  | 27 904 tris              | light       |
| Private cabaret       | private | stage, 68 044 tris       | 25 160 tris              | full        |
| Private stream studio | private | Kenney props, 1 912 tris | the same                 | the same    |
| Creative academy      | general | seminar room, 41 160     | 29 356 tris              | full        |

The general three are listed in Experiences ▸ Visit a place as **venue cards**
(preview picture, category, one line). The private two are listed only in
Private ▸ Atmosphere ▸ "Or a 3D room", and load only through the VW3 rule:
`nexus-world-request` from the `intimate` owner after `adult.enter()`. Nothing in
PG1 adds a way in: `tests/playgrounds.test.js` checks Places, Settings, a guessed
`place-` id, a request without `privateOpen`, an activity mapping and the
preview for both, on every tier.

**Light stand-ins are cut by recipe.** `tools/vr/playground-subsets.json` names
each output's source and the top-level nodes it keeps (index ranges, as the kits
number them) with a triangle budget; `node tools/vr/subset-scene.mjs` rebuilds
them with three r147's own loader and exporter in headless Chromium, and fails
an output over its budget. Spots were found by raycast (floor under her, 0.55 m
clear around her, a 3.6 m corridor to the camera, a backdrop 2.5–9 m behind).

**Templates** (`src/experiences/playgrounds/PlaygroundTemplateCatalog.js`) are
data: up to four actions per venue, each an existing system —

- `say` sends one line as the person's turn through `NEXUS_CONVERSATION_SURFACE`
  (Cheers, A story, Quiz me, Pretend chat). Never a tag.
- `clip` plays a shipped clip by short name (`CLIPS`: wave, bow, dance, groove)
  through `NEXUS_CLIP_LOADER`; a looping clip is a toggle and stops with the
  place.
- `mood` cycles the venue's light presets
  (`PlaygroundMoodPresets.js`: cozy-warm, pub-amber, neon-blue-purple,
  cabaret-gold, studio-soft, classroom-day, romantic-evening).
- `timer` is the academy's 25-minute study block, counted in the chip. It does
  not start the Focus activity: that would end the place.
- `pretend-live` is the studio's badge — "Pretend show · Not recording · nothing
  leaves this device". It draws a label and opens nothing; the playground files
  name no capture or network API, and a test reads them to keep it so.

**The chips** (`PlaygroundInteractionRouter.js`) appear when the engine reports
`nexus-world-shown` for a world with a template — a private template only for a
private world shown at the `intimate` owner's request — and go with the world.
Desktop: a row under the status bar in the composer. Phone portrait: docked in
`<body>` above the status bar's mini-player (or the chat sheet), one row that
scrolls sideways, 44 px targets.

**Moods are light only, and never flash.** `runtime.setMood(light)` (event
`nexus-world-mood`) blends the world's lights to a preset over `MOOD_SECONDS`
(0.9 s), or cuts under `prefers-reduced-motion`. It does not touch the snapshot
`hide()` restores, and it is refused with no world up. A preset goes through
`normalizeLight`, so the floors that keep her face lit still apply. Nothing
alternates, and nothing is animated: no strobe, no pulsing badge.

**The academy is for adults learning together.** Its title, card and lines are
checked against `LEARNING_BANNED` (school-age words, uniforms, student/teacher
roles). The guard is in `validate`, and a test proves it would catch a slip.

**Partner demo, in order:** Together ▸ Playground ▸ Experiences ▸ Visit a place
▸ Irish pub → Cheers, then Light (Amber → Cozy) → End experience → Neon
discoteca → Dance, Dance again to stop → Creative academy → Study 25 min → End.
Private, after its own gates: Atmosphere ▸ Or a 3D room ▸ Private cabaret or
Private stream studio → Begin → the chips appear (Pretend show in the studio).

Not done: sitting on a seat (she has no seat-aligned pose, and a sitting clip
in mid-air looked wrong), venue music (no licensed tracks), and any measurement
on a real phone or headset — all of the above is headless Chromium.

## Place pictures (PG2)

Every place by name carries `preview` and `category` in `worlds.json`. The
pictures are made by `node tools/vr/render-place-previews.mjs` with the app
running: the real page in headless Chromium, everything but the viewport hidden,
the place shown the way a person reaches it (the companion session, or for a
private room the Private experience's own request — simulated by the tool),
then one shared `SPEC` — `idle/neutral_idle.bvh`, a camera 22° round her at
3.7 m, eye-closing expressions zeroed for the one frame — and a quality gate
(not near-black, not one colour, her head in frame). Output: 640×480 WebP,
q≈84, ≤ 60 KB. `--gpu` uses the machine's GPU instead of SwiftShader;
`--out` writes elsewhere for comparison. `PLACE_CAMERA` may only mirror the turn
for a place where a chair crossed her legs (pub, office).

The lagoon beach was turned 180° about her spot (`at` mirrored, `turn` +180):
its water and palm had been behind the person, so both the card and the place
showed bare sand.

## Not done yet

- **No measurement on a headset.** Everything above was checked in headless
  Chromium on the desktop (`?vrWorld=`), not at 72 Hz on a Quest.
- **No ambient sound.** The code plays a world's `ambient` loop, but the scene
  loops the Together scenes name (`src/features/together/scenes/assets/*.ogg`)
  are not in the repository, so no world names one.
- New materials compile on the first frame a world is shown; that frame is
  under the black of the fade.

## The cinema (VW5)

A place to go on a date: `cinema` (desktop, 98 472 triangles: the auditorium with its screen,
six tiered rows, the recliner rows, the aisle and the acoustic walls) and its stand-in
`cinema-light` (phones and VR, 27 168: the screen, two rows, the floor in front of them and the
walls behind and beside). Both are cut by recipe from one CC0 starter scene
(`sources/cinema-multiplex.glb`, 3dassets.dev "Cinema Multiplex and Foyer"; recipes `cinema`
and `cinema-light` in `tools/vr/playground-subsets.json`); the foyer and its concessions are
not used yet.

She stands on a measured spot, in front of the screen (`spots/cinema-auditorium*.json`: `screen`
and `seats`, both verified by `tools/vr/measure-spots.mjs`). It is a place only: listed in
Experiences ▸ Visit a place under "Going out", general rating, no template of things to do, no
film playing on the screen and no sitting — a seat-aligned pose does not exist yet, so nothing
claims one. Known: in the VR stand-in the screen is 0.4 m behind her spot (the audit's comfort
warning); it has not been checked in a headset.

## The hotel lobby and the hotel bathroom (VW6)

Both from 3dassets.dev's CC0 "Hotel and Resort Operations" pack.

**Hotel lobby** (`hotel-lobby`, desktop, 52 298 triangles, shipped whole; `hotel-lobby-light`,
phones and VR, 29 752, recipe `lobby-light`): the check-in desk with the world clocks behind
it, the fireplace lounge, the revolving door. General rating, "Going out". The scene has no
floor mesh, so there are no measured spots (the audit says so) and she cannot move within it;
where she stands was computed by `node tools/vr/clear-spot.mjs scenes/hotel-lobby.glb --behind
check-in-desk`: the point most clear of every node box, with the desk behind her and nothing
on the camera's line (the first placement had a sofa across her legs).

**Hotel bathroom** (`hotel-bathroom`, every tier, 11 728 triangles): nine models of the pack
placed as props (`kits/3dassets-hotel-resort/`): a back wall and two side walls, a bath with
its screen, a vanity under a lit mirror, a walk-in shower, a heated towel rail, a towel shelf
and a robe hook. Romantic rating. It is assembled, not cut: the pack's own en-suite is 1.8 m
across, with no room for her and a camera, and on its own it was a shower cubicle in a void.
Everything is at least 1.7 m from her, so the comfort rule has nothing to drop. Nothing runs
(no water, no steam) and nothing is claimed about a shower or a bath: it is a room to be in.

## The restaurant and the cocktail bar (VW7)

One CC0 scene (3dassets.dev, "Restaurant Kitchen and Dining", the 40-cover dining room), three
worlds, all general, listed in Visit a place.

**Restaurant** (`restaurant`, desktop, 105 232 triangles with its walls: the whole dining room,
laid tables, booths, banquettes, the bar at the back; `restaurant-light`, phones and VR,
28 636: the nine tables nearest her and three banquette benches, recipe `restaurant-light`).
She stands by the entrance with the tables behind her.

**Cocktail bar** (`cocktail-bar`, every tier, 19 268): the same file's bar corner cut out by
recipe `cocktail-bar` (the counter, four stools, the back-bar shelving, the wine cabinet), in
its own darker light. The shelves are as the pack made them: empty, no bottles.

The source has no walls and no floor, so each world adds partition walls as props behind the
scene (computed from the scene's `at`/`turn`, so they sit on its own grid) and a ground disk.
A first set of bar walls put one between the camera and the bar; the pictures caught it.
Spots are computed by `tools/vr/clear-spot.mjs`; there are no measured spots (no floor mesh),
so she does not move within these places. Nothing is served, nobody else is there, and she
does not sit.

## The sports club: pool, hall and soccer ground (VW8)

Three general places under the category "Sport", framed as an adult sports club. All from
3dassets.dev CC0 packs.

| Place         | Desktop                         | Phones                  | VR      |
| ------------- | ------------------------------- | ----------------------- | ------- |
| Swimming pool | 67 112 (`pool`)                 | 28 484 (`pool-light`)   | light   |
| Sports hall   | 34 524 (`sports-hall`)          | 25 248 (`…-hall-light`) | full    |
| Soccer ground | 14 020, whole                   | the same                | the same |

The pool and the hall drop their changing rooms and foyers; the pool also drops its spectator
gallery, and its phone and VR version has no tank under the water. Her spots are computed by
`tools/vr/clear-spot.mjs`, which learned three things here: a floor thinner than a step is
floor, not an obstacle (the pitch and the pool deck blocked every point); `--keepout` for a
footprint nothing marks as solid (the first "clear" point was in the water); and with
`--margin` at or below zero the camera must be inside the building too (the pool's first spot
looked at the hall from outside).

Nothing is played or swum: there is no ball, no water motion and no sport animation. The
pool's wall has a gap behind her spot that shows the backdrop. A Japanese school campus was
asked for alongside these and was not built: this app's stories lead to undressing, and a
school setting for that is not something to make.

## Fantasy places: guild tavern, dungeon, jungle ruins (VW9)

Three general places under "Fantasy", from 3dassets.dev CC0 starter scenes.

| Place        | Desktop                 | Phones                     | VR       |
| ------------ | ----------------------- | -------------------------- | -------- |
| Guild tavern | 58 604, whole           | 29 344 (`tavern-light`)    | light    |
| Dungeon      | 10 268, whole           | the same                   | the same |
| Jungle ruins | 70 924 (`ruins`)        | 28 032 (`ruins-light`)     | light    |

The tavern is one timbered hall (fireplace, bar, quest board, a gallery upstairs). The dungeon
is three connected stone rooms in one file; she stands in the first, the store room. The ruins
are one walled compound cut out of a 680 598-triangle lost city. Spots are computed by
`tools/vr/clear-spot.mjs`. The dungeon's first spot left the app's camera inside a wall and the
preview renderer refused the frame as one colour: its spot now needs 5 m of clear view
(`--view 5`), and a floor up to 0.3 m thick counts as floor.

She does not walk between the dungeon's rooms (no measured spots), there are no doors to open,
nothing to fight and nobody else there: these are places to be in, not a game yet. Walking
from town to tavern to dungeon needs Living Worlds travel between them, which is not wired.

## The shopping street (VW10)

One general place under "Going out", every tier, 17 734 triangles, no light version (under the
30 000 phone budget). Assembled, not cut: nine CC0 models of 3dassets.dev's "Japanese School and
City Street" pack placed as props (`kits/3dassets-japanese-street/`): a row of four shopfronts
(bookshop, ramen shop, laundrette, a shuttered shop), two road sections in front of them, a
vending machine, a bicycle rack and a cherry tree in blossom, on a ground disk. Each prop's
`width` is the model's own measured width (shopfronts 4 m, road sections 8 m), so they sit edge to
edge without overlap.

She stands at the origin on the pavement with the ramen shop behind her; every prop is at least
1.7 m from her and none is between her and the camera, so the comfort rule drops nothing. There is
no floor mesh and no measured spot: she does not walk the street, the shops cannot be entered and
nobody else is there. The first layout put the laundrette's machines behind her and the place card
read as a laundrette; the pictures caught it and the row was re-spaced.

The pack's school is its own place, below (VW11).

Not checked: a headset, frame rate on a real phone or Quest, and the road sections' kerbs at
eye level (the pictures show them from the standing camera only).

## The school (VW11)

A general place under "School": the pack's own starter scene (`school`, desktop, 88 606
triangles) and its phone and VR cut (`school-light`, 26 466, recipe `school-light`). The courtyard
with the covered walkway, the shoe lockers, a classroom front, the gate, a bicycle shelter and
cherry trees. Every character in it is the companion; there is nobody else. It is in Experiences ▸
Visit a place and in Private's destination list, and her story outline may suggest it.

**Always General** (`generalOnly: true` on the world, inherited by its light cut;
`src/features/together/GeneralOnlyPlaces.js`, boot list after `places.js`, test
`tests/general-only-places.test.js`). One hand-off serves every route into it: the room card in
Private's setup, her invitation once the person says yes, a link, a saved visit, and Private
started while she is there. It cancels a wear still on its way (the wardrobe controller's
`cancel`), stops Private through its own path (pending actions go stale, her body is released, the
story ends and is remembered as an evening, her outfit goes back to hers, the consent flow exits,
the room request is withdrawn), and only then visits the school as an ordinary place. Nothing is drawn on screen for the rule: no badge, no button. The hand-off remembers the place
she was in (`previous`, with `goBack()` to visit it again) for code to use; there is no control for
it, and she is reached again through Visit a place or Private's own controls. Nothing about the school is filtered: it
is the General experience, whole. Going to any other place leaves Private as it is; the rule is
scoped to the school and its light cut and adds no restriction anywhere else.

Spot: `node tools/vr/clear-spot.mjs scenes/japanese-school-grounds.glb --behind 060-shoe-locker-bank
--view 7`, used for both cuts. The first spot (cherry tree behind her) put a fence post across
the picture; the second (`--view 5`, tree) was fine from the front but the phone showed her half
hidden by a perimeter fence. Not checked: a headset, frame rate on a real phone or Quest, walking
the school (no floor mesh, so no measured spots, no stairs, no doors), a live Private evening
carried through to the school with a real model's reply.


## Anime school and Japan places (VW12)

Seven general places downloaded from Sketchfab (all **CC BY 4.0**; credit in each place's note and
in `assets/vr-worlds/PROVENANCE.md`), each with a phone and Quest version where the full one is over
budget:

| id                      | category  | desktop triangles | phone / Quest version          |
| ----------------------- | --------- | ----------------- | ------------------------------ |
| `anime-classroom`       | School    | 22 102            | `-light`, 22 102, 512 px colour |
| `anime-classroom-small` | School    | 13 264            | the same file on every tier    |
| `anime-corridor`        | School    | 26 663            | `-light`, 26 663, 8 MB texture  |
| `anime-hallway`         | School    | 39 940            | `-light`, 26 998               |
| `anime-stairs`          | School    | 47 636            | `-light`, 27 091               |
| `anime-subway`          | Going out | 35 066            | `-light`, 27 006               |
| `anime-tatami`          | Home      | 57 611            | `-light`, 29 821               |

Every school place is `generalOnly: true` (see the VW11 section: going there ends Private through
its own path). The subway carriage and the tatami room are ordinary places.

**Budgets.** A phone or Quest version stays within 30 000 triangles, 40 draw calls and 32 MB of
texture memory (`tools/vr/prepare-scene.mjs` measures all three and refuses a scene that stays
over). Refused so: a Japanese night street (142 MB of textures even reduced) and a grandma's house
(36 draw calls, 44 MB). Left out by eye: the school entrance (a flat, untextured grey box, an empty
picture from every spot and camera angle).

**Spots.** Every place has measured spots (`assets/vr-worlds/spots/<scene>.json`, both versions),
with English and Italian words in `WorldSpots.WORDS`, so "andiamo alla lavagna" walks her to the
blackboard and the model may suggest one. Rooms with named things (classroom: teacher's desk, desks,
windows, bookshelf; tatami room: low table, cushions; corridor: windows) were split one node per
material (`tools/vr/split-by-material.mjs`) so a spot can name them; the others are single merged
meshes and use `anywhere` spots (`<room>`, `<room>-far`). The start (`scene.at` / `turn`) comes from
a verified spot through `tools/vr/at-from-spot.mjs --write`, never typed.

**Previews.** The preview camera's default 22° turn put a desk top, a stair wall or a grab pole in
front of her in the classroom, the stairs and the subway; those three use the straight camera
(`PLACE_CAMERA` in `tools/vr/render-place-previews.mjs`), as their spots were raycast for.

Not checked: a headset, frame rate on a real phone or Quest, a live conversation walking her
between spots with a real model's reply.
