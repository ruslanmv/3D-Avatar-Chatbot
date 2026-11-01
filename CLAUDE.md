# Working in this repository

Standing context for coding sessions. Everything here was verified against the
tree, not assumed. If something below is wrong, fix this file in the same
change.

## What this is

A 3D VRM avatar chatbot: a static site rendered with Three.js, served by a small
Node proxy. Multi-provider LLM chat, TTS/STT, WebXR (Quest), AR/passthrough, and
a Desktop Companion picture-in-picture mode.

- Node 24 (`.node-version`, `engines.node: 24.x`). Vercel discontinued 20.x and
  refuses to build a project that pins it, so do not move this back.
- Regenerate `package-lock.json` with npm 11 (Node 24's), e.g.
  `npx npm@11 install --package-lock-only`. npm 10 wrote a lockfile without the
  macOS-only `fsevents` entry, and npm 11's `npm ci` refuses that as out of
  sync, which failed every CI job at its install step.
- Licence: **Apache-2.0** (`LICENSE`, `package.json`). Anything added — code,
  assets, fixtures — must be Apache-2.0 or compatible, and asset provenance gets
  recorded where the asset lands.
- Run locally: `npm start` (→ `node nexus-proxy/server.js`)
- **There is no build step.** `"build"` is literally
  `echo 'Static site served by nexus-proxy (no bundle step)'`. Nothing bundles,
  nothing transpiles, nothing rewrites an asset URL. Paths in source are the
  paths the browser requests.

Entry points: `index.html` (main), `index-vr.html`, `demo.html`,
`vrm-manager.html`.

## Two module conventions, and which directory uses which

This is the single most important thing to get right, because the two halves of
`src/` load differently and are tested differently.

**`src/features/` and `src/behavior/` — IIFE, no ESM.** Verified: zero top-level
`import`/`export` anywhere in either tree. Each file is an IIFE that assigns to
**both** a global and `module.exports`, so the browser gets a global and Jest
can `require()` it:

```js
(function (global) {
    'use strict';
    const api = {
        /* … */
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_THING = api;
})(
    typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
          ? globalThis
          : null
);
```

Loaded by the **ordered list in `src/behavior/boot.js`**, not by script tags.
Order matters — a module that reads another's global must load after it. See
`TogetherSwitch.js` and `PlayDirective.js` for the canonical shape.

**`src/gltf-viewer/` — mixed.** `ViewerEngine.js`, `ARSupport.js`,
`AvatarManager.js` and friends are **ES modules** with `import`, pulled in
through `src/engine-bridge.js`, which `index.html:119` loads as
`<script type="module">`.

But the _unit-tested_ files in that same directory — `CameraPresets.js`,
`CameraFraming.js`, `CameraKeyboard.js` — have **zero imports and zero
exports**. They are IIFEs attaching to `window.NEXUS_*`, because there is **no
Babel config** in this repo and Jest therefore cannot `require()` an ES module.

So the rule for new code in `src/gltf-viewer/`:

> If you want it unit-tested, write it with no top-level `import`/`export`: an
> IIFE with the dual export above. Take `THREE` and other dependencies by
> injection or from the global. An ES module there is only testable by reading
> the file and `eval`-ing it.

**`src/wardrobe/` — IIFE, but loaded by `index.html`, not `boot.js`.** Same dual
export as `src/features/`, and for the same reason: Jest `require()`s these
directly. What differs is how they reach the browser — thirty plain `<script>`
tags at the very end of `<body>`, after the Pose Studio root. That placement is
deliberate and the commit that moved them there says why: the parity harness
counts boot scripts by line, so adding them near the top of `index.html` shifted
every frozen line reference below. Load order within those matters —
`WardrobeClient` defines the error class `WardrobeController` and
`WardrobePanel` read off the window at module scope, and `WardrobeBootstrap`
runs on `DOMContentLoaded`, after every tag has loaded.

## Testing

Jest, jsdom, `tests/**/*.test.js` (240 files today, nested ones included), setup
in `tests/setup.js`. CommonJS — `require('../src/…')`.

Two things that will bite:

- **`localStorage` is real, despite what `tests/setup.js` looks like.** That
  file assigns `global.localStorage = { getItem: jest.fn(), … }`, but
  jest-environment-jsdom has `global === window` and jsdom defines
  `localStorage` as a Window accessor, so the assignment does not take —
  verified empirically: a `setItem`/`getItem` round trip works and
  `localStorage.clear()` really clears. Write persistence tests against a real
  store, and call `clear()` plus the module's own `reset()` in `beforeEach`.
  (The mock is still worth knowing about in case jsdom's behaviour changes.)
- For an ES module under `src/gltf-viewer/`, the house pattern is
  `fs.readFileSync(...)` then `eval(src)` — see
  `tests/camera-presets.test.js:135`. Prefer writing new code so you never need
  this.

No WebGL in jsdom. Design logic as pure functions that take numbers and return
numbers, and inject the renderer-facing parts, so the interesting half is
testable.

## The gate

```bash
npm run validate      # lint:check && format:check && test:ci
npm run format        # run this BEFORE committing
```

Know the coverage gaps, because they are not intuitive:

| Script         | Actually covers                            | Gap                                                           |
| -------------- | ------------------------------------------ | ------------------------------------------------------------- |
| `lint:check`   | `js/**/*.js` only                          | **ESLint never sees `src/`.** It will not catch your mistakes |
| `format:check` | `**/*.{js,json,css,html,md}` minus ignores | **`docs/` is in `.prettierignore`** — docs are not checked    |
| `test:ci`      | `tests/**/*.test.js`                       | jsdom only, no WebGL, no real network                         |

### The gate passes. Keep it that way.

Measured 2026-11-01 with `npm ci` deps installed: `npm run validate` exits **0**
— lint clean, format clean, **5418 tests in 240 suites, all passing.**

This is recent. For most of this project's life the gate did not pass, and
earlier revisions of this file told you to judge your own work against a
baseline of "4 failures, not 5". That advice is gone because the baseline is
gone: **any failure is now yours.**

What was fixed, in case it recurs — all four were stale _tests_, not code:

- a test called `SearchQuality.cleanSubjectQuery`, which never existed on the
  module (the export is `cleanSearchSubject`), so it threw rather than failed
- two tests pinned the exact wording of a LookUp prompt paragraph that had since
  been reworded; the guarantees were intact
- one pinned `'Ready · provided by this site'` after Settings started naming the
  resolved provider — it failed on an improvement

The lesson is in how they were rewritten: assert the **property**, not the
sentence. A test pinned to prose fails on an edit that changes nothing.

```bash
npx prettier --check <files you touched>
npx jest <your test file>
npm run validate              # must stay exit 0
```

Format only what you touched — `npx prettier --write <your files>` — so your
diff stays readable. Bare `npm run format` is now safe (nothing unrelated is
unformatted) but still rewrites more than you meant.

Note `npx` alone pulls the _latest_ ESLint (v10), which rejects `.eslintrc` and
exits 2. Install deps first (`npm ci`) so the pinned ESLint 8 is used.

`.prettierignore` excludes `vendor/`, `coverage/`, `package-lock.json`,
`tests/fixtures/protocol/` (those fixture bytes are a cross-repo contract —
never reformat them), `docs/` and `.pytest_cache/` — pytest writes a
`.gitignore` inside its own cache, so git never sees it while `format:check`,
which walks the filesystem, finds its README and fails the gate.

Prettier settings that change how you write: 4-space indent, single quotes,
`printWidth` 120 for code — but **Markdown is `printWidth` 80 with
`proseWrap: "always"`**. A root-level `.md` file like this one is checked and
will be rewrapped; files under `docs/` are exempt.

## Never touch

- `app.js` — a 1.9 MB generated webpack bundle
- `vendor/three-0.147.0/**` — vendored Three.js r147, the version the app runs
- `index-old.html`, `index.backup.html`, `*.bak.*`, `build-viewer/`,
  `vrm-manager.js` unless that is explicitly the task
- `tests/fixtures/protocol/**` — byte-identical with another repository

## Conventions

**Batch comments.** Work lands in numbered batches and the code says which:
`// T5. Take the <play> tag out…`, `// B14. …`. Prefixes in use: `B`, `T`, `M`,
`D`, `L`, `S`, `MS`, `A` for the ambience work, `P` for the Private experience
(`PT` its tattoos), `W` for the wardrobe (`WF` its Forge settings, `LT` live
Try-On, `OD` the outfit dictionary shared with Forge), `V` for VRoid Hub in the
Avatar Library, `VP` for the VR puppet, `AR` for the AR conversation, `VR` for
the VR chat panel and `ST` for on-device speech-to-text (`docs/QUEST_STT.md`).
Commit subjects match: `A4: viewport background manager`. So
`git log --grep 'A4'` and the comment line up.

**Comments explain why, at length.** This codebase documents the failure a piece
of code prevents, not what the code does — read the header of
`src/features/together/PlayDirective.js` or
`src/features/together/activities/scene-journey.js` for the register. Match it.
A comment that only restates the code is noise here.

**Fail soft.** The established pattern is to warn and degrade, not throw: a bad
scene manifest is skipped with a reason, a directive that cannot run must not
take the assistant's reply down with it, a missing asset falls back to a colour.
Look for `try`/`catch` with a `console.warn` and a sensible default.

**Snapshot and restore, do not undo.** Modes that change shared state
(`CompanionMode`, `ARSupport`, scene journeys) snapshot every value they
overwrite and write the snapshot back verbatim on exit. Writing a bespoke "undo"
drifts the moment somebody adds a field.

## LLM capability pattern

Model-driven actions follow one shape, and a new one should be a fifth instance
of it rather than anything new:

```
switch module        state + localStorage + onChange listeners
      ↓ isOn()
capability module    systemPromptSuffix() → '' when off, or when the
      ↓              capability genuinely cannot run
 [model emits a tag: <play kind="music">…</play>]
      ↓
directive module     extract / strip / execute — assistant replies ONLY
      ↓
trusted app code     does the actual thing
```

Rules that are not negotiable: a tag rather than provider-specific tool calling
(only some of the five providers expose tools through this client); strip the
tag once at the `displayText` seam in `src/main.js`, which covers the bubble,
the transcript, the VR forward **and** TTS together; at most one directive per
reply, enforced by the parser and not only by the prompt; never execute a tag a
_user_ typed; re-check the enabling switch at execution time, not when the
prompt was built.

## The ambience feature

Scenic viewport backgrounds, and letting the companion change them on request.
**Waves A0–A17 are complete.** The designs are still the reference:

- `docs/AMBIENCE_BATCHES.md` — the execution plan, A0–A12
- `docs/VIEWPORT_IMAGE_BACKGROUNDS.md` — the rendering design
- `docs/AI_SCENE_AMBIENCE.md` — the language → intent → scene design
- `docs/ambience-contract.md` — the frozen data shapes
- `docs/AMBIENCE_HARDENING.md` — the A12 audit; both findings fixed
- `docs/BACKPLATE_PRODUCTION.md` — **how to author art the camera agrees with**
- `docs/STUDIO_INTEGRATION.md` — 3D-Ambience-Studio: what it makes, the
  reprojection that turns it into something this app can show, and the camera
  contract the Studio's backplate route generates against

Ten scenes in `assets/ambient/` with provenance beside them, a Settings scene
grid, and six `src/features/ambience/` modules in `boot.js`. **The art is
generated, not photographed (A19):** twenty plates from 3D-Ambience-Studio
through OpenAI's image API, two independent compositions per scene, each
composed against this app's camera contract. `PROVENANCE.md` has the model, the
sizes and why they replaced the previous photographic set. The switch is **off
by default** and the capability returns `''` while it is, so a profile that
never enables it sends the prompt it always sent.

Things to know before touching it:

- **`SceneCatalog.js` is the library, and it is a trust boundary (A17).** Every
  scene reaches the Settings grid through it, tagged with the source it came
  from and a `trust` of `system` or `user-content`. Untrusted sources lose
  `profileOverlay` and `guidedScript` — the two top-level fields a manifest uses
  to change how she behaves. A source registered without stating its trust is
  treated as untrusted, and the path check is _borrowed_ from
  `ViewportBackgroundCatalog.isSafeRelativePath` rather than copied: with that
  module absent the library accepts nothing at all. Adding a behavioural field
  to a scene manifest means adding it to `BEHAVIOUR_FIELDS` in the same change —
  a test reads the scene-journey activity and fails on any manifest field that
  is in neither list.
- **Installing a Studio package is a tool, not a copy (A19).**
  `node tools/ambience/install-studio-package.mjs <package-dir> [--dry-run]`
  copies both plates in and writes the catalogue entry. It refuses a package
  with only one plate, and refuses a plate that is not its profile's master size
  — both read from `camera-contract.json`, so re-exporting the camera
  invalidates art composed against the old one instead of installing it
  silently.
- **The grounded crop is an option, and off (A20).** A centred crop is exact at
  the two shapes each plate was composed for and drifts elsewhere — in the
  desktop layout's 472×564 avatar panel a portrait plate's floor lands at
  106.9%, off the bottom edge.
  `Settings ▸ Scenes ▸ Keep the ground under her feet` (`nexus_scene_grounded`,
  `manager.setGrounded`) anchors the crop to the camera's foot row instead,
  using `anchorY`/`anchorYPortrait` from the catalogue and `CalibrationGeometry`
  for the camera's row. **Default is centred** — that is what the scenes were
  art-directed against and what production ships; do not change the default
  without asking. Both paths compute the same `repeat`; only `offset` moves, so
  it is never a stretch.
- **A scene may ship two pictures (A19).** `srcPortrait` on a catalogue entry is
  the composition for a portrait viewport;
  `ViewportBackgroundCatalog.sourceFor(entry, aspect)` chooses, and `onResize`
  _reloads_ rather than re-crops when rotating the device crosses the 1.0 aspect
  boundary. Absent is the normal case — the ten shipped scenes have one picture
  each — and an entry without it behaves exactly as before. A crop is not a
  substitute: a 16:9 plate cropped to 9:16 keeps a third of its width and none
  of its calibration.
- **Together shows the same plates, read-only (A21).**
  `src/features/together/SceneArt.js` is the only resolver from a scene id to a
  picture URL, backed by `assets/ambient/scene-tale-art.json`. It exists so the
  Scene Tale tile, the `Current place` card and the Preparing/Ready strips can
  reference production art without any of them getting a way to _select_ a
  background: the module names no viewport API at all, and
  `tests/behavior/scene-art.test.js` greps it to keep that true. Its `BUILTIN`
  table is a synchronous first-paint answer, not a second library — a test fails
  if one field has drifted from the manifest. Add a scene to the ambience set
  and the manifest gains a row; nothing in Together needs a matching edit.
- **Settings has two sections, not one (A17).** `SCENES` holds the grid;
  `FALLBACK BACKGROUND` holds the five colours, which are what shows when no
  scene is chosen or a scene's file will not load. Both still share one
  `desktop-bg` radio group — two groups is how the panel ends up showing _Ocean_
  while the background is black.
- **`src/gltf-viewer/ambience/` is loaded by `index.html`, not `boot.js`.**
  `ViewerEngine` needs the catalogue synchronously at construction. Moving those
  three into the boot list disables scenic backgrounds with no error message.
  `SceneCatalog` bridges the two trees: `_adoptBuiltinScenes` in `main.js` hands
  it the catalogue's entries once the fetch has landed, because neither tree can
  import the other.
- **There are three prompt-assembly sites**, and they are not the two request
  handlers: `_handleStreamingResponse`, `callLLM`, and `__nexusMediaSuffix`. The
  non-streaming handler delegates to `callLLM`. A new capability needs all
  three.
- **`scene.background` now sometimes holds a `Texture` with an owner**, where it
  used to always be a `Color` rebuildable from a constant. VR, AR and Companion
  each snapshot and restore it, so those hand-offs are load-bearing. A12 audited
  them; `docs/AMBIENCE_HARDENING.md` has the results.
- **The camera is not level, and there are two projections, not three.**
  `frameObject` lifts the eye by `normalize(0, 0.03, 1)` — about 1.72° down — so
  the horizon sits at 44.4% of frame height, not 50%. And `MobileSupport`'s
  non-portrait FOV was 35 while desktop kept `ViewerEngine`'s 30; A13 made
  both 30. Run `?backgroundCalibration=1` for the live figures rather than
  trusting a number written down anywhere, this file included.
- **`assets/ambient/camera-contract.json` is generated, not written.** It is how
  the projection leaves this app for the Python asset pipeline and for
  3D-Ambience-Studio, neither of which can run `CalibrationGeometry.js`. Change
  the camera and you must re-run
  `node tools/ambience/export-camera-contract.mjs`; a test regenerates it and
  fails if the committed copy has drifted.
- **`reapplyCurrent(id)` takes the selection of record, and that argument is
  load-bearing.** While XR is presenting, `setDesktopBackground` records the
  choice and deliberately does not call the manager, so the manager's own `_id`
  goes stale. Dropping the argument silently discards a scene chosen in the
  headset (finding A12-1). Both XR exit handlers pass `this._desktopBgKey`.

## Clearing a conversation

`clearHistory()` delegates to `NEXUS_CONVERSATION_RESET`
(`src/features/chat/ConversationReset.js`), which is the single owner of
forgetting. If you add a store that holds conversation content — anything that
reaches the prompt, or any localStorage key — add it there. `KEYS` lists what it
erases and `KEPT` lists what it deliberately does not (`nexus_study_history` is
between-sessions memory, not part of a conversation; settings are not
conversation either).

Turns capture `currentEpoch()` at the start and check `isCurrent(turn)` before
writing anything back, so a reply that outlives a CLEAR writes no message, no
storage and no speech. A new code path that persists a reply needs that check.

## The wardrobe feature (Try-On Haul)

New outfits for the avatar, from the pack this repository ships or from a
running [3D-Wardrobe-Forge](https://github.com/ruslanmv/3D-Wardrobe-Forge).
Thirty-two modules in `src/wardrobe/`: the original eight behind a floating 👗
drawer (`docs/WARDROBE.md`), eleven that put Try-On inside Together as a tile
and hide the drawer from the moment the page loads — W18: the wardrobe is
reached only through Together ▸ Try-On (`docs/TRY_ON_TOGETHER.md`), three that
make every look an artifact and let a pack be imported
(`docs/WARDROBE_IMPORT.md`), the Settings section that chooses the Forge (WF1),
and three that put her wardrobe in the conversation — the outfit dictionary, the
wardrobe tool and the hosted haul (`docs/WARDROBE_TOOL.md`). **The shipped pack
needs no server, and the project's Hugging Face Forge is the default for
creating looks (WF1)** — see the Forge bullet below.

- **`vendor/wardrobe/` is a verified pack, not a folder you edit (W11).** Ten
  looks, two per bundled avatar, ~137 MB of VRMs made by the Forge's
  `tools/export_default_wardrobe.py`. Change it only with
  `npm run wardrobe:import -- <pack>`; `npm run wardrobe:check` — also a Jest
  test, so `validate` runs it — re-hashes every file, checks each avatar against
  AvatarIdentity's pins, and fails on a file the manifest does not name.
  Provenance is `vendor/wardrobe/provenance.json`; the pack refuses a README
  beside it on purpose.
- **Every source goes through `WardrobePackValidator`, and a look is keyed
  `source:pack:avatar:id` (W11).** The pack carries the same look id for five
  avatars; the old merge by `id` kept one and offered another character's file.
  `WardrobeRegistry` lists sources in order (built-in, imported, Forge) and
  never merges by name. A look is shown only on the avatar it was fitted to —
  per look, not per manifest — and its `rating` can only hide it. The normalized
  look is built from a field list, so a pack cannot carry `depictsAdult` or any
  other permission in.
- **An imported pack is checked whole, kept only on yes, and gated (W14).**
  `WardrobeArtifactImporter` reads the zip (known paths only; only JSON may be
  compressed), validates and hashes everything, and stores it in IndexedDB —
  this browser only. A pack with any non-general look, or an unrated v1 bundle,
  imports only with private mode on, and its looks still show only when Try-On's
  private gate is open for her. Look keys, not ids, identify looks in
  `TryOnSession` and `TryOnView`: an imported look may share a built-in one's id
  on the same avatar.
- **A look that names a SHA-256 is worn as a verified `blob:…#look.vrm` (W11).**
  The fragment is load-bearing: `AvatarManager` picks VRM-or-glTF by the URL's
  extension. The controller revokes the blob on the next wear or restore; a
  mismatch refuses before anything is swapped.

- **The whole feature ends at
  `AvatarManager.setAvatarByUrl(url, name, index)`.** A look is a VRM URL.
  Nothing here touches Three.js, the renderer, or the ambience background — a
  generated outfit loads through the same path the avatar picker already uses,
  which is why the feature adds no rendering code.
- **`WardrobeController` is the only owner of snapshot-and-restore**, and it is
  built whether or not a server is configured (W2). It was previously built only
  for remote generation, so the static deployment — the one that ships — swapped
  avatars without snapshotting, `restore()` answered false, and the drawer
  reported success anyway. Without a server it gets `LOCAL_FORGE`: URLs resolve
  to themselves and anything needing the pipeline refuses with the reason. A
  Try-On Haul over looks already in the bundle therefore works offline.
- **A look is never worn without a snapshot to go back to (W3).** The drawer
  mounts as soon as `avatarManager` exists, which is before the startup avatar
  has loaded; inside that window `getCurrent()` answers null, so a tap recorded
  no original and Restore could never work again. `applyLook` now refuses with
  "Wait for the avatar to finish loading" rather than stranding the user.
- **Forge types `avatar.license.conditionsOfUse` as `dict[str, str]` with a
  default factory, not as optional (W1).** A `null` is a 422 and so is a boolean
  value. Omit the key when there is nothing to say, and send strings — the "I
  have permission" path is exactly the path with no conditions to send, so
  getting this wrong broke only the attestation retry.
- **The thirty `<script>` tags live at the end of `index.html`'s `<body>`, and
  moving them is not free.** The parity harness counts boot scripts by line;
  `node scripts/behavior-parity-baseline.mjs --check` is the check. None of them
  may point into an engine folder (`src/behavior/`, Together's own tree): those
  load only through `boot.js`, which is why the Try-On activity is
  `src/wardrobe/TryOnHaulActivity.js` and not a file among Together's
  activities.
- **Try-On keeps the controller as the only avatar swapper (W4–W9).** Its
  session paces the haul and the controller wears and restores; identity for
  Forge comes from the controller's snapshot of the original avatar, never the
  current look. `tryOnInTogether: false` restores the drawer-only behaviour.
- **Try-On is live play, not select-then-Start (LT1–LT2).** Tapping a look wears
  it; the haul begins (and the controller snapshots) on the first wear. Every
  landed look is a step in `TryOnSession`'s history; a wear that has not landed
  is the _pending_ head and the next tap replaces it, so coalesced taps never
  enter the history — keep that, it is what Undo stands on. Compare swaps the
  VRM without touching the history; favourites are not Keep. Typed text goes
  through `TryOnIntent`, which is pure and decides navigation versus a Forge
  request; "change X" is sent as only the new garment with `baseLookId` when
  Forge made the current look on her library route, and otherwise rebuilt from
  the look's own recipe with only that part rewritten. Turn rotates
  `avatarManager.currentRoot` relative to its load-time yaw and writes that yaw
  back on finish.
- **The Forge is the Hugging Face Space unless someone says otherwise (WF1).**
  `WardrobeConfig.resolveForge` decides, in this order: the page's own
  `NEXUS_WARDROBE_CONFIG` (`forge.baseUrl`, `apiUrl`, or `forge.enabled: false`
  — Settings then shows "Set by this site" and offers no control); the person's
  choice from `Settings ▸ Wardrobe Forge` (`wardrobe_forge_mode` of `default`,
  `custom` or `off`, the URL in `wardrobe_forge_url` — a URL stored there before
  WF1 still counts as custom); then `DEFAULT_FORGE_URL`. A change applies
  without a reload through `WardrobeService.setForge()`, which swaps the client
  and the Forge source but keeps the controller — never rebuild the service to
  switch, that drops the snapshot. `WardrobeForgeSettings.js` owns the section
  (inserted before DEVELOPER, like the YouTube and web-search fields), so
  `main.js` knows nothing about it. The default works because the Space's five
  library avatars hash-match AvatarIdentity's pins and its CORS allows any
  origin; if either changes, Test connection in Settings says so.
- **Her wardrobe is a tool, a fifth instance of the capability pattern
  (W15–W17).** `WardrobeTool` holds the MCP-shaped `TOOLS` and the one executor
  `call`; the chat reaches it with `<wardrobe action="…"/>`, consumed at both
  `displayText` seams and suffixed at all three prompt sites. What she is told
  comes from `OutfitDictionary` (Forge's `GET /v1/outfits`, else
  `assets/wardrobe/outfits.json` — refresh with
  `node tools/wardrobe/sync-outfits.mjs`); ratings are Forge's, and an entry is
  private if its rating _or_ its group says so. Private sets and tattoos reach
  the prompt only while the activity's `privateOpen()` (TryOnPrivate `open`) is
  true. `TryOnConversation` hosts the haul in the chat — her lines from
  `callLLM`, posted with `renderAssistant` + `history().addMessage` + `persist`,
  epoch-checked, scrubbed of directives, and never for a private look or a
  tattoo. Do not let a beat run a directive: that is a loop.
- **Try-On asks Forge for Auto Foundation (MG3).** `TryOnGenerator` sends
  `ensureFoundation: true` on both routes (never on a tattoo-only job). Forge
  then adds a foundation only where she has none and carries it from look to
  look: a seamless tube top and slip shorts, or bralette and briefs on an avatar
  Forge declares adult. It is also what lets a dress VRoid filed as _Tops_
  (Model Girl's) come off under a new skirt instead of the skirt going over its
  hem. Other callers do not send it, so their requests are unchanged.
- **She chooses what she wears underneath, once for the haul (FC1).**
  Customize's _Underneath_ row (beige, nude, white, black, red, pink) stores
  `nexus_tryon_foundation_color` through `TryOnGenerator.setFoundationColor`,
  and every look then sends `foundationColor` with `ensureFoundation`. Forge
  colours the foundation it adds, keeps one in that colour, and replaces one in
  another colour where the new clothes go (a half under clothes she keeps
  changes with them). Nothing chosen sends nothing. Every value must be in
  Forge's vocabulary — anything else is a 422 on every look.
- **What she wears underneath changes colour on her, and only that (FC2).** The
  companion's `<wardrobe action="underneath" color="black"/>` — or the
  "Underneath · White · Change" chip on the current look (W18) — opens
  `TryOnUnderneath`, a pop-up (bottom sheet on a phone, dialog elsewhere) with
  White/Black product cards and more colours as chips, the stylist's pick
  highlighted; the person chooses. `TryOnView.underneath` asks Forge for a
  recolour-only job (no outfit, `baseLookId`, `foundationColor`) so the dress
  and boots come back byte for byte, wears an already-made sibling colour
  instead of asking again, and answers ok only once the VRM has loaded. Her
  prompt hears what she has underneath only for a look Forge made here, and for
  a private look (a dress over adult underwear is rated intimate) only while
  Try-On's private gate is open.
- **Cloth is pushed out of her once a pose settles (SW1).** Skinning alone left
  a bodycon's lap 23 mm inside her thighs in Sitting (Wide); no weighting fixes
  a vertex that bridges two surfaces. `PoseClothCorrection` (pure, tested) runs
  in `PoseClothWorker` via `src/gltf-viewer/PoseClothCorrector.js`, two frames
  after `VRPoseSystem` settles a preset; garments' original positions are
  snapshotted and restored when she moves. `docs/SITTING_WIDE.md` has the
  measurements. SW3: a seam's split vertices are welded and corrected as one
  (corrected apart, the bodycon's seams opened 41 mm), pieces of one Forge node
  share a `group` and are one cloth (a boot's lining went out through its
  shell), and a shoe moves at most `SHOE.maxMove` — behind her knee her skin
  meets itself and there is no outside. Verify a change with Forge's
  `bake_pose_correction.py` + `fit_checks.py --baked`, which run this file on
  the real look; a screenshot cannot show a torn seam.
- **Private mode unlocks private outfits only for avatars Forge declares adult
  (W10).** `TryOnPrivate.evaluate()` answers `off`, `locked` with a sentence, or
  `open` with quick picks. Private mode (`NEXUS_SPICY.isEnabled()`) says the
  _person_ is an adult; whether the _avatar_ depicts one is Forge's
  `depictsAdult` from `GET /v1/library`, set by its operator in
  `assets/library/policy.json`, and Forge checks it again on every job. Never
  make private mode stand in for the avatar's declaration — the two questions
  have different owners.
- The licence terms come from VRM Manager's `vrm_manager_installed` localStorage
  entry, which keeps `conditionsOfUse` through `saveInstalled()`'s strip. A
  source that forbids modification is never overridden — Forge refuses with
  `source_model_modification_not_permitted` and the drawer says so.

## On-device speech-to-text (ST)

Meta Quest Browser has `webkitSpeechRecognition` with no service behind it, so
every listener heard nothing there. **STT PROVIDER ▸ On-device Whisper** (the
old "WASM Whisper" option, `stt_config.provider === 'wasm'`; `?localStt=1`
forces it) runs Whisper in `workers/whisper-worker.js` through Transformers.js.
Off by default. `docs/QUEST_STT.md` has the design, results and the Quest
procedure.

- **One switch, three listeners.** `NEXUS_STT.recognitionClass()` answers the
  class to construct: `WhisperRecognition` (the browser recognizer's surface
  over Whisper) or the browser's own. `main.js`'s mic button
  (`micRecognizerClass`), `SpeechService._recognitionClass` (VR panel and
  push-to-talk) and `CompanionMode._SR()` all ask it, so their endpointing and
  UI are unchanged. Construct recognizers only through these.
- **On-device chosen but impossible is an error, never the browser's
  recognizer** (`SttRouter` `unavailable`), and `startSTT` never falls through
  from `wasm` to a cloud provider.
- **The STT choice applies on change, not on SAVE (ST8).** A Quest user who
  chose On-device Whisper and closed Settings with ✕ stayed on the browser's
  recognizer and heard nothing. `SttSettings` writes provider, model size,
  language and microphone at once, and draws the section's MICROPHONE TEST (real
  input meter; "No sound" vs "no words recognized" vs "recognized"). ST9: its
  Web Speech test runs the recognizer exactly as the mic button does and opens a
  meter capture only on desktop (`browserMeterSafe`) — on a phone a second
  capture took the audio and the recognizer heard nothing.
- **No interim text, no confidence.** Surfaces show "Transcribing…" at
  `onaudioend` (SpeechService passes `onTranscribing`); `confidence` is
  `undefined` → `null` to callers, which show no percentage and treat it as "no
  score" for auto-send.
- **A release before the microphone opened records nothing** — in
  `MicrophoneSession` (lease closed before open stops the stream on arrival),
  `SpeechService.stopRecognition()` (`_startSeq` voids a pending start) and VR
  push-to-talk (`_pttHeld`).
- **Pinned**: Transformers.js 3.8.1 and each model's Hugging Face commit and
  file SHA-256 in `QuestWhisperConfig.js`; a site can self-host via
  `NEXUS_STT_CONFIG`. Transformers.js assumes English when no language is given,
  so the app's language is always passed.
- **Every utterance is timed (ST10–ST16, `docs/QUEST_STT_PERFORMANCE.md`).**
  `SttPerformance` traces one utterance per surface (`perfSurface` on the
  recognizer: `mic-button`, `vr-ptt`, `vr-panel`, `companion`, …); the primary
  number is recording stopped → text displayed, never the time spent speaking.
  Worker numbers are durations measured in the worker (two clocks, two time
  origins — never subtract across them); a stage that did not happen is `null` /
  `not_measured`, never 0; a threshold (`sttWarningMs` 3000) is a label and
  never cancels. `SttDiagnosticReport` builds the schema-1 report: no audio, no
  transcript text, scrubbed strings. Frames are sampled only inside a trace.
  `runTranscription` in `LocalWhisperSTT` is the one instrumented gate → worker
  → judge path — keep new transcription callers on it.
- **Test with the real model**: `npm run stt:real-model` (Piper makes the speech
  in the browser, Whisper transcribes it, then the real app is driven through
  Chromium's fake microphone). English is gated; Italian is reported (29–57% WER
  on Tiny, 14–36% on Base with Piper's synthetic voice). That is this machine's
  CPU — Quest timings come from `stt-check.html` on the headset.

## Speech engines and the Meta Quest voice switch

`src/TTSProvider.js` keeps two engines apart: the **stored** one (`tts_engine`,
written only by `setEngine()` — a person's choice in Settings) and the
**active** one (what speaks). `boot()` makes the stored engine active at
`DOMContentLoaded` (Q2; before that, a saved Piper choice was ignored after
every reload). Desktop replies go through `speakText()` in `main.js`; the VR
panel goes through `js/speech-service.js` — two speech paths, not one.

- **"Natural voice on Meta Quest" is off by default, and off means unchanged
  (Q1–Q6).** `src/tts/QuestVoice.js` holds the switch (`nexus_quest_voice`) and
  every decision, pure and tested; every function answers "what you had" unless
  the page is in a Quest browser _and_ the switch is on. On, Piper speaks every
  reply — the VR panel too, via `TTSProvider.routesVR()` — except languages
  Piper has no voice for, falls back to the system voice when Piper can't load,
  and preloads the model at idle. The person asked for this to be opt-in; do not
  make it the default without asking.
- **The switch's engine is an in-memory override, never written to
  `tts_engine`.** While it is in force, TTS ENGINE is locked and Save/TEST VOICE
  skip `setEngine()`; an unlocked dropdown would save the override as the
  person's own choice, and turning the switch off could no longer restore it.
- The three script tags (`QuestVoice` before `TTSProvider`, `QuestVoiceSettings`
  after Piper) sit after every line the parity harness has frozen. The toggle is
  drawn from JS, not written into `index.html`, for the same reason.
- `?questVoice=1` makes any browser count as a Quest, so this is testable from a
  desk. Docs: `docs/TTS.md` ▸ _Natural voice on Meta Quest_.
- **Piper must never synthesize on the main thread (Q7).** This site is not
  crossOriginIsolated, so ONNX Runtime ignored Piper's thread count and ran the
  model on the main thread: 1.0–2.7 s frozen per reply, which in VR stops the
  frame loop — no rendering, no controller tracking, puppet handles that will
  not drag. `_offMainThread()` sets `env.wasm.proxy` on the import-map instance
  of `onnxruntime-web` before any session exists; `_degradeProxy()` retries on
  the main thread only when the worker itself failed.

## The page in Meta Quest Browser (Q8)

The 2D page looks **exactly** like desktop Chrome at the same window size — the
person asked for that, and a Playwright check compared every toolbar icon and
the chat row pixel for pixel. Headset-only CSS in `styles/main.css` may add
invisible hit area for controller rays (`::after` with `inset: -5px`) and size
ENTER VR/AR, nothing else; the old headset block that resized icons and text
also hid the ☰ menu, so its drawer could not be opened in the headset.

**The app's icon is the HomePilot mark (Q9).** `assets/app-icon.svg` and its
padded `app-icon-maskable.svg` are the sources; every PNG and `favicon.ico` is
rendered from them by `node tools/brand/render-app-icons.mjs` — edit the SVGs,
never the PNGs. A Quest shows these (and `short_name`, "HomePilot") for an
installed PWA; the headset's own loading transition for a browser tab is drawn
by the system and no page can change it. `tests/app-icons.test.js` guards the
favicon (it used to 404) and the maskable safe zone.

## Entering VR from a PC (XL1)

Quest Link and SteamVR put the headset on a GPU the page may not be rendering
on. `xrCompatible: true` in `ViewerEngine`'s renderer options is **ignored** by
three r147 (its context attributes are a fixed list), so ENTER VR's
`makeXRCompatible()` can _move_ the context: Chrome loses it, restores it on the
headset's GPU, and rejects that first call with `InvalidStateError`.
`VRSupport.toggleVR` requests the session first (the click's activation is spent
at once), then `_makeXRCompatible()` waits a move out and retries; a rejection
with no context loss behind it is thrown, and a session the page cannot draw
into is ended. The old "continuing anyway" entered VR with a dead context whose
loss handler then ran `forceExit()` mid-session. Do not create the context
`xrCompatible` up front instead: in desktop Chrome that starts the installed VR
runtime on page load for every visitor. Tested in
`tests/vr-entry-gpu-move.test.js`.

**XL2: no frame may build the GPU's work in one task.** After that move every
shader and texture is rebuilt, and three r147 does it inside the first frame,
one program waited on after another — on Windows (ANGLE/Direct3D) long enough
for Chrome's "page not responding". `VRSupport` now calls
`ViewerEngine._prepareForXR()` between `_makeXRCompatible()` and `setSession()`:
it holds the loop and runs `src/gltf-viewer/XRWarmUp.js` — `renderer.compile()`
with `debug.checkShaderErrors` off (so programs compile in parallel off-thread),
`COMPLETION_STATUS_KHR` polling, textures two per task. Rules: the loop is not
restarted on a context restore while `vrSupport.isToggling`, nor at the end of
the warm-up (a desktop frame there recompiled post-processing: 1.2 s) —
`vrSupport.onEntryFinished` restarts it after `setSession()` and on every
failure. No custom `XRWebGLLayer`: three's own layer already has alpha, and the
extra one allocated a second full-resolution framebuffer. A new object that only
appears in VR should exist in the scene (hidden) before the warm-up, as the
floor grid now does via `_vrGround()`. Tested in `tests/xr-warmup.test.js`.

**XL3: the headset shows the HomePilot loading card while she gets ready.** The
order in `VRSupport.toggleVR` is request → `_makeXRCompatible` → `beginSplash` →
`setSession` → `prepareForSession` (the XL2 warm-up) → `onEntryFinished`.
`src/gltf-viewer/XRSplash.js` (THREE injected, pure placement maths tested in
`tests/xr-splash.test.js`) draws its own tiny scene — app colour #071821,
`assets/app-icon-512.png` with the name, a turning ring — lazily following the
gaze (yaw only, never head-locked) for at least `MIN_MS` _after the headset
first shows it_ (XL7); the warm-up runs behind it, then the loop is hers and the
card is disposed. Its icon is fetched on the first ENTER VR, never on page load.
three r147 already sets fixed foveation to maximum in `setSession` — do not add
a second call.

**XL4: every step of entering VR is recorded, and a frame cannot freeze the
headset.** A Quest Link log showed the warm-up finish and then nothing until the
person quit — and "no frames asked for", "stuck on the card", "her loop never
started" and "her loop died" all look identical from inside the headset.
`src/gltf-viewer/XREntryTrace.js` (pure, `tests/xr-entry-trace.test.js`) records
request → granted → gpu → card → session → warmup → warmed → finished → scene
with times, counts `card` and `scene` frames, and prints a report **when the
session ends, however it ends** (`NEXUS_XR_ENTRY.report()` any time). The
running step is shown on the loading card and, as one word, on the desktop VR
button. Rules:

- **Every subsystem call in `animate()` is in its own `try`.** three's XR loop
  schedules the next frame only after the callback returns, so one exception
  stopped the headset for good — measured: 0 frames in 4 s after one throw,
  still presenting. A throwing subsystem is now reported once with its stack and
  skipped; she still draws. Add new per-frame calls inside a `try`; a test
  checks the list.
- **`VRSupport.onSessionStart()` clears `isToggling` before the warm-up runs** —
  use `_entering` for "entry still in progress".
- A watchdog 2.5 s after entry re-arms her loop once if she has drawn nothing —
  but waits while the session is hidden (XL7): that is the runtime's screen, not
  her loop failing.
- The "Multiple instances of Three.js" warning is expected (a global r147 for
  classic scripts, a module r147 for the engine and three-vrm; her scene and VRM
  materials are all module objects). Its silencer was an inline
  `<script defer>`, which `defer` does not affect; it is now
  `src/three-instance-marker.js`.
- **XL5: `'layers'` is requested only in a headset's own browser**
  (`VRSupport.wantsLayers`; `?xrLayers=1|0` forces it). Nothing here draws a
  layer, but asking for one moves three r147 off the classic `XRWebGLLayer` onto
  its projection-layer path. Desktop Chrome on Windows now offers layers too (an
  older comment said it did not), and there the path blits a 4× multisampled
  buffer into the layer every frame — untested anywhere, and a Chrome 157 / Link
  session granted it stayed on the loading screen. The trace also prints a
  status line 3, 8 and 20 s into a session (`pulse()`), so a log copied from
  inside a stuck headset says whether frames are being drawn.
- `[Violation] … unload is not allowed` from `jquery.js` is a browser
  extension's injected jQuery; this repository ships no jQuery.
- **XL6: what the first full Link report showed.** Request → granted took **55
  s** (Chrome's sandboxed XR service and the Meta Horizon Link runtime — a
  report on Meta's tracker matches it; nothing of the page runs then), the
  session went hidden and ended 1.6 s later with **0 frames**, and the warm-up
  took 34 s because a hidden page's timers fire once a second. So: three r147
  picks its path from `session.renderState.layers === undefined`, which Chrome
  on Windows defines without the `'layers'` feature — XL5 alone did not keep a
  PC off the projection-layer path; `VRSupport.hideLayersFromThree` shadows it
  for three's one read, and the report says whether that held (`layersHidden`).
  The session step records the path three took (`XRWebGLLayer` / projection
  layer) and the granted features, not just what was asked. The warm-up yields
  through a `MessageChannel` while the page is hidden. A session that ended is
  judged whole — 0 frames is a finding, never "no problem detected" — and the
  page names its own ends (`pageEnding`), so the report can say whether the
  headset or the page closed it.
- **XL7: over Air Link the card was disposed before it could be seen.** Link
  hides the session ~60 ms after it starts, for about a second; the card's 900
  ms was counted from its creation, so it was gone 86 ms before the session
  turned visible (1 frame drawn, 0 seen). The Quest's own browser is visible
  from the first frame, which is why only the PC lost it. Now the hand-over is
  `XRSplash.handOverAt`: ready **and** `MIN_MS` since the first card frame drawn
  while `visibilityState === 'visible'`, or `MAX_UNSEEN_MS` (6 s) after ready if
  the session is never shown — a timer, since a hidden session gets no frames.
  **Never call `renderer.setAnimationLoop` directly — use `_setLoop(fn)`.**
  three r147's `setAnimationLoop` always starts its _window_ rAF loop, even
  mid-session, so every switch inside a session made her frame run twice (once
  per XR frame, once per desktop frame — the real log shows her drawn while the
  session was hidden); `_setLoop` hands three one trampoline once and only swaps
  the function it calls. A context restore with the card up re-arms the card
  (and repaints it), not her loop; a context loss after entry ends the real
  session. The report gives `loading card: V of N frames while visible`, when it
  was first seen, her first frame, and `ended by:` the page (with its reason) or
  the headset/runtime. `npm run vr:entry-scenarios`
  (`tools/vr/xr-entry-scenarios.mjs`, IWER in headless Chromium) runs five
  startups — Quest native, Air Link hidden-then-visible, a GPU move, a context
  loss mid-card, a session ended while hidden. That is simulation; the procedure
  on a real Quest 3 + Air Link is in `docs/VR_STARTUP.md`. Link's own loading
  screen is the runtime's, and no page can draw into it.
- **Over Link there is no AR, by design of the platform.** Desktop Chrome offers
  no `immersive-ar` session, so passthrough exists only in the Quest's own
  browser. The VR panel's AR buttons read "AR N/A" there, and pressing one now
  says why once in the panel (`VRChatPanel._explainNoAR`, VR1) instead of only
  logging it. A Link session with the classic layer was confirmed working end to
  end: 36 327 frames, puppet IK on her skeleton, Web Speech recognition.
- **VR1: the VR chat panel has no quick chips.** "Summarize", "Explain" and
  "Continue" were removed at the person's request;
  `tests/vr-panel-chips.test.js` keeps them out.
- **VR2: hold the right trigger to talk, let go to send.** The trigger is also
  the panel's click, so `src/gltf-viewer/TriggerTalk.js` (pure,
  `tests/trigger-talk.test.js`) decides: a hit on a panel button you can _see_
  is a click; anywhere else the right controller's trigger is push-to-talk. Only
  a real right controller in VR (`environmentBlendMode` `'opaque'`) — never a
  phone AR tap (`targetRayMode: 'screen'`), a Quest AR session or a
  hand-tracking pinch. Trigger, Y and B share one recording (`createHolders`),
  each edge buzzes the controller, and disconnecting or leaving VR mid-hold ends
  it. Hidden panel hit-boxes used to catch clicks (hiding with X keeps them
  registered); `firstVisibleHit` ignores them now.
- **See the VR panel without a headset: `npm run vr:panel-shot`**
  (`tools/vr/screenshot-vr-panel.mjs`). It loads the real page in headless
  Chromium, fills the real panel and saves its canvas for each layer (chat,
  Controls, More) to `tmp/vr-panel/`; `--transcript`, `--status`, `--messages`,
  `--ar on|off` set the state. `docs/VR_PANEL_SCREENSHOTS.md` has the how-to. It
  found the "You" / "AI" labels overlapping each message's first line (fixed: 38
  px under the label, not 28).

## Quest passthrough (XP1)

`vr-session-start` fires for **AR sessions too** — VRSupport's `sessionstart`
listener has no mode check, and it is registered before ARSupport's. On a Meta
Quest, an AR session therefore must not be painted, gridded or offset by that
handler: `src/gltf-viewer/XRBackground.js` (pure, imported by `ViewerEngine` for
its side effect, tested in `tests/xr-background.test.js`) answers "paint
nothing, no grid, no eye-level boost" for Quest AR and the old answer for
everything else. **Quest VR stays black and phone AR keeps its background and
viewpoint — both at the person's request; do not widen this without asking.**
`ar-session-start` re-nulls the background on a Quest, and
`ARSupport.forceExit()` resets `_arSessionSetupDone`, without which the next AR
session skipped its setup. Docs: `docs/AR.md` ▸ _Quest: ENTER AR lands in
passthrough_.

**XP2: the VR floor grid is never drawn in AR, on any device** — on a phone it
cut through the room at waist height (it sits at y = 0 of the AR space, which is
where the phone started, not the floor). Surfaces in phone AR are shown the
industry way instead: `ARSupport`'s floor guide, a 2 m grid on the surface the
hit test found, only while she is being placed (before TAP TO PLACE), then gone.
`Settings ▸ Companion ▸ Show floor grid in AR` (`overlay_arfloorgrid`, off by
default, wired in `CompanionMode`'s settings map beside `overlay_arfollow`)
keeps it under her. The rule is `XRBackground.arFloorGuide`, pure and tested; it
never shows on a Quest, where nothing calls `placeAvatarAtReticle`.

## Talking to her in phone AR (AR1)

AR is another surface for the same conversation, not a mode of its own.
`initAROverlay` in `src/main.js` is the bridge (TAP TO PLACE, mic, SEND,
captions, the 💬 transcript); `src/gltf-viewer/ARConversation.js` (IIFE,
`tests/ar-conversation.test.js`, loaded after `ARCoachingOverlay.js`) holds its
rules.

- **`ARSupport.placeAvatarAtReticle` answers `{ placed, reason }`** and
  dispatches `ar-avatar-placed` on success, which ends the coaching card at
  once. It used to return nothing, so a tap before any surface said "Avatar
  placed" and opened the mic with her placed nowhere. The mic opens only on a
  real placement (`afterPlaceTap`); the tap stays the gesture that authorises
  it.
- **The pipeline draws every turn once.** `handleUserMessage` renders through
  `addMessageToHistory`, which mirrors into AR — so SEND must not draw a bubble
  itself (it did, and every typed message showed twice).
- **The transcript is the conversation.** Each `ar-session-start` rebuilds it
  from `_surface().history()` (replies there are already tag-stripped), and
  mirroring is ignored while AR is closed — so leave/re-enter neither loses nor
  repeats a turn.
- **AR2: AR drives voice only through CompanionMode's public conversation API**
  — `startConversation()` (answers `{ ok, reason, message }`),
  `stopConversation()`, `conversationStatus()`
  (`{ live, state, micReady, muted }`) and the window event
  `companion-conversation` (`event`: `state`, `mic-open` or `error` with
  `reason`). `micReady` turns true only when the browser really opened the mic
  (recognition `onstart`, or the silent between-turns listener got its stream)
  and stays true across turn gaps. A blocked or busy mic is an `error` event
  _before_ the call goes idle — the companion's own toast is outside the AR DOM
  overlay and invisible in AR, so AR shows the sentence itself
  (`ARConversation.voiceView`, `tests/ar-voice.test.js` with a scripted
  recognizer). Never read `_live`, `_convState` or call `_startLive()` from
  outside CompanionMode; a test checks the AR overlay.
- Not done yet (the plan's phases 4–5): `domOverlayState` checks,
  `beforexrselect` on the controls, barge-in while she speaks.

## The VR puppet moves her skeleton (VP1)

three-vrm 2.x gives a VRM two skeletons: the **raw** bones skin the mesh, the
**normalized** rig is a proxy that `vrm.update()` copies onto them — only while
`humanoid.autoUpdateHumanBones` is true. This app keeps it **false** so
ProceduralAnimator can write the raw bones (breathing, base pose). VRPoseSystem
resolves the _normalized_ bones (PoseRigMap's `getBone`), so until VP1 every VR
IK drag, direct bone grab and VR-panel pose moved a skeleton nobody draws: the
sphere moved, she did not (measured: 0.261 m vs 0.000 m).

- **Anything in VR that poses her calls `vrPoseSystem.claimBones()` first**
  (`startIK`, the bone grabber's direct grab, `cyclePreset`, Place mode,
  intimacy presets). `src/gltf-viewer/PuppetSkeleton.js` (IIFE, tested in
  `tests/puppet-skeleton.test.js` against a transcribed three-vrm rig) snapshots
  both skeletons, the copy flag and the animator's pose/edit modes, carries her
  visible pose into the proxy (N = P·raw·B⁻¹·P⁻¹ — the inverse of three-vrm's
  copy, so a grab does not pop), puts the animator in pose mode, and stops a
  clip only if one is playing (the resolver's `stop()` turns the animator's
  mixer permission off for good).
- **While held, `VRPoseSystem.update` copies proxy → skeleton after solving**,
  and the puppet does again after its own solve/grab (`syncSkeleton()`), so the
  mesh shows this frame's pose and a BehaviorEngine talk/think mode cannot take
  her body from the person's hand. She keeps the pose after release — that is
  the feature.
- **Reset, Place mode off, leaving VR, or a new avatar release** —
  `releaseBones()` writes the snapshot back verbatim and, in the headset, blends
  into her idle over 0.4 s. Restoring edit mode matters: `setPoseMode(false)`
  leaves `editMode` on, and an animator left in edit mode never moves her again.
- **Handles sit on the drawn skeleton** (`getVisualBone`), not the proxy, which
  was ~6 cm off her body at rest.

## VRoid Hub in the Avatar Library

`vrm-manager.html` / `vrm-manager.js` is the Avatar Library. Its VRoid Hub
sign-in (OAuth + PKCE, registered redirect origins), keyword search and
download-licence install predate this note and are unchanged.

- **A pasted model link is a lookup, not a keyword search (V1).**
  `src/avatar-library/VroidLinks.js` finds model ids in whatever was typed — one
  link, a pasted list with names between the links, links glued together by an
  `<input>` dropping newlines, or nothing but bare ids. The Library then matches
  those ids, fetches the missing models and _appends_ them; nothing is removed,
  and the text is never sent to VRoid Hub's keyword search.
- **Model details are public; downloading is not.** `action=detail` works signed
  out in both proxies (`nexus-proxy/server.js` had no `detail` at all until V1 —
  keep the two proxies' action lists in step). Every other action still needs
  the user's token, and installing says "sign in" when there is none.
- **VRoid Hub nests a detail answer in `data.character_model`**, and a VRM 1.0
  model keeps its conditions of use in
  `latest_character_model_version.vrm_meta`, not in `license` (whose fields are
  null for VRM 1.0). `unwrapDetail` and `conditionsFromVrmMeta` read both.
