<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# The ambience feature

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
