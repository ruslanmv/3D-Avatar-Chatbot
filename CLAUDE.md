# Working in this repository

Standing context for coding sessions. Everything here was verified against the
tree, not assumed. If something below is wrong, fix this file in the same
change.

## What this is

A 3D VRM avatar chatbot: a static site rendered with Three.js, served by a small
Node proxy. Multi-provider LLM chat, TTS/STT, WebXR (Quest), AR/passthrough, and
a Desktop Companion picture-in-picture mode.

- Node 20 (`.node-version`, `engines.node: 20.x`)
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

## Testing

Jest, jsdom, `tests/**/*.test.js` (139 files today, nested ones included), setup
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

Measured 2026-09-12 with `npm ci` deps installed: `npm run validate` exits **0**
— lint clean, format clean, **3922 tests in 139 suites, all passing.**

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
never reformat them) and `docs/`.

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
`D`, `L`, `S`, `MS`, and `A` for the ambience work. Commit subjects match:
`A4: viewport background manager`. So `git log --grep 'A4'` and the comment line
up.

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
**Waves A0–A12 are complete.** The designs are still the reference:

- `docs/AMBIENCE_BATCHES.md` — the execution plan, A0–A12
- `docs/VIEWPORT_IMAGE_BACKGROUNDS.md` — the rendering design
- `docs/AI_SCENE_AMBIENCE.md` — the language → intent → scene design
- `docs/ambience-contract.md` — the frozen data shapes
- `docs/AMBIENCE_HARDENING.md` — the A12 audit; both findings fixed
- `docs/BACKPLATE_PRODUCTION.md` — **how to author art the camera agrees with**

Ten scenes in `assets/ambient/` with provenance beside them, a Settings scene
grid, and five `src/features/ambience/` modules in `boot.js`. The switch is
**off by default** and the capability returns `''` while it is, so a profile
that never enables it sends the prompt it always sent.

Four things to know before touching it:

- **`src/gltf-viewer/ambience/` is loaded by `index.html`, not `boot.js`.**
  `ViewerEngine` needs the catalogue synchronously at construction. Moving those
  three into the boot list disables scenic backgrounds with no error message.
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
