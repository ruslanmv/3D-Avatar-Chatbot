<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# Worlds, in VR and on the screen (VW1–VW3, PG1)

Places in the headset: a Poly Haven panorama, CC0 kit props (Kenney, Quaternius,
KayKit) and retinted light. `src/gltf-viewer/VRWorlds.js` (IIFE, imported by
`ViewerEngine` for its side effect, `tests/vr-worlds.test.js`), catalogue
`assets/vr-worlds/worlds.json`, provenance beside it, `docs/VR_WORLDS.md`.

- **Plain VR stays black (XP1).** `chooseWorld`: never in AR, `off` never, a
  running activity's world (`activities` in the catalogue) first, else the
  Settings ▸ VR WORLD choice (`nexus_vr_world`); the default `auto` shows
  nothing. `ViewerEngine._applyVRWorld` runs at `vr-session-start` and on every
  companion session change or setting change while presenting.
- **The panorama is a sphere, not `scene.background`** — r147 cannot rotate a
  background — with every vertex below the camera height flattened onto the
  floor (`flattenBelow`), so the photograph is the ground.
- **Snapshot and restore:** `show()` records hemi/key/fill/rim and exposure,
  `hide()` writes them back and disposes what the world made. `hide()` runs
  first in `vr-session-end`, before the VR light restore.
- **Comfort rules are enforced, not suggested:** fade through black on every
  change (`tick` per frame from `animate()`, in its own `try`), load everything
  before swapping, and `comfortProblem` drops any prop within 1 m of the person,
  between the two of you, or inside her — the shipped catalogue must produce no
  problems.
- **Kits:** glTF/GLB only, textures ≤ 1024 px; Quaternius Sci-Fi's models were
  rewired to its `Textures/` folder. Props are centred on their bounding box
  (`placementOffset`) — kit origins are anywhere.
- `?vrWorld=<id>` draws a world on the desktop for checking without a headset.
- **On the screen too (VW2), and only light worlds on a phone.** The engine
  watches the companion session for the page's life (it arms once
  `__NEXUS_COMPANION_LIVE` appears — a phone boots it late) and shows the
  running experience's world on desktop and mobile; Seaside's placeholder
  `SceneRuntime` group (`live.scene`) is hidden while a world is up. `tierFor` →
  `mobile | desktop | vr`; `allowedOn` refuses a world over `MOBILE_TRIANGLES`
  (30 000) on a phone whatever its `tiers` say, and `chooseWorld` then takes the
  next world for that activity. Every world declares measured `triangles` (a
  test enforces it). Settings ▸ VR WORLD applies to the headset only; a screen
  shows a world only with an experience.
- **Assembled scenes** (`scene: { src, at, turn }`, `assets/vr-worlds/scenes/`,
  3dassets.dev, CC0) are merged by material at load (`mergeByMaterial`, keyed by
  what the material looks like, not its identity — every kit file has its own
  copy), and so are a world's props. `at`/`turn` put the measured clear spot
  under her; find one by raycasting, not by eye (a glade spot beside a fallen
  trunk looked clear from above). Stylized worlds use `sky` (a gradient) and
  `fog` (snapshotted and restored) instead of a photo. A wide-short screen goes
  to CameraPresets' `bust` while a world is up (`framingFor`).
- **Places by name, and private rooms only inside Private (VW3).** A world may
  be `place: true` with a `rating` of `general`, `romantic` or `private`, and a
  `lightFor` stand-in for devices the heavy one cannot load on (`resolveFor`,
  `placesFor`). Experiences ▸ Visit a place is the hidden native activity
  `src/features/together/activities/places.js` (boot list), which enters the
  session as `place-<id>` — **a dash, not a colon**: CompanionSession keeps only
  `[a-z0-9-]` activity ids and stored a colon id as no activity.
  `ActivityMarks.isExplicit` counts `place-*` as an activity with an end.
  Private's Atmosphere step lists `activity.places()` as "Or a 3D room"; the
  Intimate activity dispatches `nexus-world-request` `{ id, owner: 'intimate' }`
  only after `adult.enter()` succeeds, and `{ id: null }` on stop. The engine
  passes `privateOpen` only for that owner, so a private world is refused by
  `chooseWorld`, the Settings list, activity mappings and the `?vrWorld=`
  preview alike — `tests/vr-places.test.js` holds all four.
- **Playgrounds: venues with things to do (PG1, the V4 release).** Irish pub,
  Neon discoteca, Creative academy (general, in Visit a place as venue cards
  with a preview and category) and Private cabaret, Private stream studio
  (private, only in Private's rooms). `src/experiences/playgrounds/` (boot list,
  after ActivityMarks): `PlaygroundMoodPresets` (seven lights),
  `…TemplateCatalog` (data: up to four actions per venue, kinds `say` / `clip` /
  `mood` / `timer` / `pretend-live`, `validate`, `forShown`) and
  `…InteractionRouter` (the chip row, shown on the engine's `nexus-world-shown`
  and gone with the world). A template never chooses a world; a private one
  answers only for a private world shown at the `intimate` owner's request.
  Moods go through `nexus-world-mood` → `runtime.setMood` (a blend over
  `MOOD_SECONDS`, a cut under reduced motion, refused with no world up, snapshot
  untouched) — **no strobe, nothing animated**. The studio is pretend: its badge
  says nothing is recorded or sent, and a test greps the playground files for
  any capture or network API. The academy's text is checked against
  `LEARNING_BANNED`. Light stand-ins are cut by recipe
  (`tools/vr/playground-subsets.json`, `node tools/vr/subset-scene.mjs`), not by
  hand. `tests/playgrounds.test.js`; `docs/VR_WORLDS.md` ▸ Playgrounds.
- **She reacts to the place and the chips (PG3, the V5 release).**
  `src/experiences/playgrounds/PlaygroundReactiveContext.js` (boot list after
  the router, before `src/companion/index.js`;
  `__NEXUS_COMPANION_LIVE.reactive`) observes `nexus-world-shown` and the
  router's `nexus-playground-action` reports, believes a world only if
  `vrWorlds.activeId` agrees, an action only if the venue's template lists it,
  an anchor only from the template's `anchors` — never a payload's `owner`.
  Reactions go through `BehaviorRouter.request` only (lip-sync deferral reused),
  ticked inside `NEXUS_EXPERIENCE_RUNTIME`, throttled, cooled down, budgeted,
  generation-checked; nothing while a dance clip owns her body, only `listen`
  during a study block, nothing on arrival (ActivityVoice owns that). Only
  `applied: 'behavior'` is described: one sanitised `situation` paragraph via
  `PromptContext`, Life/Experiences only, never a private room. Private
  reactions need `privateOpenNow()` (Intimate + consent flow + private mode +
  the renderer's `intimate` request), re-checked each step and wiped on
  Private's end or Copilot. No loop, clip, timer, storage or network of its own
  — a test greps it. `tests/playground-reactive.test.js`;
  `docs/PLAYGROUND_REACTIVE_CONTEXT_V5_HANDOFF.md` ▸ Implementation.
- **PG3 production pass: intents are routed, objects are pickable, and she may
  ask for a gesture.** `BehaviorRouter.CHANNELS` sends each intent to a face, a
  gaze or a registry intent that really exists. An undeclared name used to rank
  all 166 clips lexically, so `smile` played `action_attention_seeking`. The
  actuators (`setEmotion`, `setGazeOverride`, timed and token-guarded) live in
  `src/companion/index.js`. `gesture_toward_object` is routed nowhere until the
  arm-waving clip loses its `point` tag. `PlaygroundObjectPicker` (boot list
  before the reactive context) gives hover/click, tap (≤ 8 px, ≤ 450 ms) and the
  VR ray (`trySelectRay`) over the template's `anchors`, which now carry `at`
  and `space`. Seaside's `interaction:completed` is a prompt moment only, with
  no gesture. The reply may end with one `<gesture intent target/>` (`propose`):
  allowlisted, anchors only, dance and stop only through the venue's chip,
  refused in Copilot and private rooms. It is stripped at both `displayText`
  seams and masked while streaming, and offered through `gestureOffer`, an
  exact-shape field separate from the sanitised paragraph.
  `src/features/chat/ChatErrorText.js` turns a failed reply into a fixed
  sentence with a next step and never echoes the error.
  `tests/playground-pg3.test.js`, `tests/chat-error-text.test.js`;
  `docs/V5_PRODUCTION_READINESS.md` holds the evidence and the rollback.
- **Every place has a picture (PG2).** `preview` (an image under
  `assets/vr-worlds/`, safe-path checked) and `category` on each place in
  `worlds.json`; `placesFor` hands the card `image`, `category` and `tint` (sky
  colours, the card's paint when there is no picture). The pictures are renders,
  not screenshots: `node tools/vr/render-place-previews.mjs [ids] [--gpu]` (app
  running on :8080) draws each place full-frame with one pose, one three-quarter
  camera (`SPEC`, per-place `PLACE_CAMERA` only to mirror the turn), eyes open,
  and refuses dark, flat or empty frames; 640×480 WebP ≤ 60 KB. Places is a
  two-column card grid (`.is-venues`, 4:3 art box). Together's stylesheet must
  stay in the `nexus-bd-together` namespace — a test enforces it.
  `tests/place-previews.test.js`.
