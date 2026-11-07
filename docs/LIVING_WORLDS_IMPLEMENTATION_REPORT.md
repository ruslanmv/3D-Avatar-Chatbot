# Living Worlds — implementation report (LW1–LW5)

Branch `feat/living-worlds-spatial-storytelling`, 2026-11-07. No pull request,
not merged. Everything below was run in this container. Browser results come from
headless Chromium with SwiftShader (a software renderer), on the real app at
`http://127.0.0.1:8080`. **No physical phone or Meta Quest was used.** Phone rows
are Playwright's iPhone 13 emulation.

## Status

| Milestone | State | Where |
| --- | --- | --- |
| LW1 place survives her tags and topic changes | Implemented, tested, verified with a real model | `src/companion/ActivityDirective.js`, `src/companion/index.js` (`noticeTopic`), `tests/companion/living-worlds-presence.test.js` |
| LW2 measured spots | Implemented, tested | `tools/vr/measure-spots.mjs`, `tools/vr/spot-targets.json`, `assets/vr-worlds/spots/*.json`, `src/gltf-viewer/WorldSpots.js`, `tests/living-worlds/world-spots.test.js` |
| LW3 confirmed moves inside a loaded world | Implemented, tested, verified in the real app | `VRWorlds` runtime `goToSpot`, `src/companion/WorldPresence.js`, `CameraPresets` `mid`, `ViewerEngine` `nexus-world-framing` |
| LW4 shared moment and in-place moods | Implemented, tested, verified with a real model | `WorldPresence.promptSuffix`/`setMood`, `PromptContext` `presence`/`goOffer`, ActivityDirective `inPlace` |
| LW5 travel that needs a yes | Implemented, tested, verified with a real model | `WorldPresence.observeUser`/`commitTrip`, `destinationsFor` |
| Walking along a navigation graph, sit/lie poses, holding objects | **Not implemented** (LW6+) | — |
| VR comfort on a headset | **Untested on hardware** | — |

## What was built

### The apartment

- `assets/vr-worlds/scenes/pixel-flat-home.glb` (26,468 triangles) is the
  CC0 one-bedroom flat already in the repository.
- It is cut by the `home` recipe in `tools/vr/playground-subsets.json`, which
  drops the six resident figures, the crib and the exercise bike. Rebuild it
  with `node tools/vr/subset-scene.mjs home`.
- It is the new `apartment` place on every device, and the phone version of
  the bedroom (`bedroom-light`) uses the same model.
- Provenance is in `assets/vr-worlds/PROVENANCE.md`.

### Measured spots

`node tools/vr/measure-spots.mjs [scene]` (tool version 4) raycasts the real
GLB. For each candidate spot it checks:

- **Floor.** There is floor under her and all around her.
- **Body.** Her body fits against a double-sided copy of the room.
- **Same room.** The object is in the same room as her.
- **VR view.** There are 2.2 m of open view for the VR person, and floor
  where they stand.
- **Screen view.** The screen camera sees all of her (feet to head, across
  her width) from 4.7 m, using the materials as drawn. If not, the tool
  tries the `mid` framing (2.3 m), then `bust` (1.0 m).
- **Spacing.** She is at least 1.2 m from every other spot.

The results:

| Scene | Spots verified | Not verified |
| --- | --- | --- |
| `pixel-flat-home.glb` | sofa, record-player (mid), kitchen, dining-table, bed (mid), desk (mid), bathroom, balcony (bust) | — |
| `bedroom-flat.glb` (desktop bedroom) | dressing-table (bust) | bed, sofa, bookcase: no point has room for her and a view of her |

Each file records the model's SHA-256, and a test re-hashes it.

### The world runtime

`goToSpot(spot)` on the runtime (`src/gltf-viewer/VRWorlds.js`) does five
things:

1. Fades to black.
2. Rewrites `rotation.y` and `position` of the loaded
   `vr-world-scene:<src>` object so the spot is under her and facing the
   person.
3. Runs `whileDark`, which applies the screen framing.
4. Fades back in.
5. Sets `spotId`.

It never reloads anything. A world change in the middle makes the move
`stale`, and nothing is half-applied.

### WorldPresence

`src/companion/WorldPresence.js` is on the boot list and attached as
`__NEXUS_COMPANION_LIVE.presence`. It is the one owner of where the two of you
are:

- It believes a world only when `runtime.activeId` agrees.
- The person's words or a menu move her at once.
- Her `<go spot/>` runs only on a turn where the person asked to move.
  Otherwise it is an offer that their next "sì" takes.
- Another place always waits for the person's own next-turn yes, and expires
  after 2 turns or 3 minutes.
- A trip that has not arrived after 45 s goes back to where you were.
- Private worlds get nothing. Copilot hears no romantic spots and no trips.
- Clear (`ConversationReset.onReset`) and the session ending forget it all.

## Evidence

### Automated tests

- `npm run validate` exits 0: lint and format clean, **5900 tests in 267
  suites**.
- `node scripts/behavior-parity-baseline.mjs --check`: OK.

| Suite | Tests |
| --- | --- |
| `tests/living-worlds/world-spots.test.js` | data, hashes, spacing, framing, transforms, trust boundary, intent words |
| `tests/living-worlds/world-presence.test.js` | 32: moves, failure, in-flight, stale, offer, tag rules, travel yes, no, expiry, timeout, Clear, Copilot, private, prompt shape, streaming mask |
| `tests/companion/living-worlds-presence.test.js` | 12: LW1 plus LW4 in-place |

### Real app, spot moves

`lw.cjs`, apartment, desktop 1440×860:

- 8 moves, all confirmed by `vrWorlds.spotId`, in 0.8–1.2 s each.
- **One** world load for the whole run.
- She stays at the origin, and the session stays `place-apartment`.

Picture: `docs/images/living-worlds/apartment-spots.jpg`.

### Real model

OllaBridge `free-best`, the app's own chat path, Italian, desktop and iPhone 13
emulation. Phone run:

| Person | World / spot after | Her reply (abridged) |
| --- | --- | --- |
| Che bello qui. Cosa facciamo stasera? | apartment / sofa | suggests a record, dinner |
| Andiamo in cucina | apartment / **kitchen** | "let's head to the kitchen…" |
| Mi prendi una coperta? | kitchen | "I'm not able to fetch it, but there's a blanket on the sofa" |
| si mi piace | **sofa** (her offer accepted) | "the blanket's on the sofa — just grab it" |
| Rilassiamoci un po' qui | sofa, mood **relax** | unwinding together |
| Andiamo in camera da letto | **bed** | "let's head to the bedroom" |
| Andiamo in discoteca? | bed, **pending discoteca** | asks for a quick yes |
| sì | **neon-discoteca-light** (phone version) | "the app is taking us there now" |
| Dove siamo adesso? | discoteca | describes the dance floor, the DJ booth and the booth seating |

- World loads: `apartment`, then `neon-discoteca-light`, and nothing else.
- No tag reached a bubble, and there were no page errors.
- Turns took 4.9–6.5 s.

The LW1 regression ("si mi piace" swapping the bedroom for a meadow) did not
recur. The place only changed on the person's "sì".

The throw blanket really is on the sofa: `102-throw-blanket` is 0.81 m from the
sofa spot, at seat height. The sofa's `sees` now says so.

## Known limits

- **Language.** She replied in English to Italian messages. That is the
  model's choice; Living Worlds does not set a reply language.
- **Bust framing on the balcony** is a close-up. The space is too tight for
  `mid`.
- **No physical actions.** No sitting, lying down or handling an object
  exists. Spots offer `stand-near` and `look-at` only, and the prompt says
  so. She still says things like "let's pull the blanket over us", which is
  a suggestion, not a claim it happened.
- **Spot menu.** There is no menu UI yet. Spots are reached by words, her
  accepted offer, or `presence.go(id)`.
- **No spots in the venues.** The discoteca, pub and academy have no spot
  files, so their PG3 anchors are used for gaze only.
- **VR.** A spot move re-places the world around both of you behind a fade.
  It only follows the person's own request or yes, but it has not been tried
  in a headset.
