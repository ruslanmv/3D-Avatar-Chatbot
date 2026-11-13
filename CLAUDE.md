# Working in this repository

Standing context for coding sessions. Everything here was verified against the
tree, not assumed. If something below is wrong, fix this file in the same
change.

## Start a session here

**One command: `/nexus-start [ai|3d|atlas] [goal]`** — it checks the setup,
takes the top lab action for the area, measures before and after, commits and
reports. The steps it follows:

1. **Read `quality-lab/data/hub.json`** (or the `nexus-quality-lab` MCP tool
   `lab_next_actions`): ranked work, each item with why, command and files. The
   SessionStart hook prints the top three.
2. **One measurable goal per session.** Plan first when it touches several
   files. `/clear` between unrelated tasks.
3. **Load only the feature you touch**: the map below names its file in
   `docs/claude/`. Read it before changing that feature.
4. **Measure, change one thing, measure again**, then `npm run validate` and
   commit code with any regenerated lab data. Slash commands: `/nexus-start`,
   `/lab-next`, `/lab-check`, `/new-zone`.

**Cloud sessions: attach only this repository.** Per the Claude Code docs
(code.claude.com/docs/en/settings.md ▸ Settings in cloud sessions, and
cloud-environments.md ▸ What carries over), a session with one repository starts
inside the clone and loads its `.claude/settings.json` (the hook, and
`enabledMcpjsonServers`) and `.mcp.json`; a session with several repositories
starts above the clones and reads neither. The VW4 test session started in
`/home/user` for that reason. If it happens anyway, `/nexus-start` falls back:
`cd` into the repo, run `./.claude/hooks/session-start.sh` by hand, and call any
lab tool with `node tools/qa/lab-call.mjs <tool> '<json>'`.

**Node 24.** Cloud containers ship `/opt/node24` but put Node 22 on PATH; the
hook puts 24 first for the session (through `$CLAUDE_ENV_FILE`). On Node 22 the
gate still passes, with an `EBADENGINE` warning from `npm ci`.

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

Jest, jsdom, `tests/**/*.test.js` (288 files today, nested ones included), setup
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

Measured 2026-11-08 with `npm ci` deps installed: `npm run validate` exits **0**
— lint clean, format clean, **6283 tests in 288 suites, all passing.**

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
the VR chat panel, `ST` for on-device speech-to-text (`docs/QUEST_STT.md`) and
`HV` for SonicAgent voice through OllaBridge Cloud (`docs/SONICAGENT_VOICE.md`),
`IC` for Life/Copilot/Experiences, `MV` for music levels in sessions, `TG` for
the Together grid, `VW` for VR worlds (`docs/VR_WORLDS.md`), `LW` for Living
Worlds (`docs/LIVING_WORLDS.md`), `PG` for the playgrounds (PG1–PG2 the V4
release, PG3 the V5 reactive context; never a VRoid `V` batch — the V5 release's
first four commits say `V5:` by mistake), `DX` for desktop control layout and
`PW` for the Private World (`docs/engine/PRIVATE_WORLD_ENGINE.md`), `AX` for the
adult experience configuration
(`docs/engine/NEXUS_ADULT_EXPERIENCE_ARCHITECTURE.md`) and `PX` for Private
3.0's in-session actions
(`docs/NEXUS_PRIVATE_3_SEAMLESS_COMPANION_IMPLEMENTATION.md`). Commit subjects
match: `A4: viewport background manager`. So `git log --grep 'A4'` and the
comment line up.

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

## Feature map

Each feature's full notes moved verbatim to `docs/claude/`. The rules below are
the ones that break things when missed; read the file before changing the
feature, and fix it there if it is wrong.

| Feature                                           | Rules you must not miss                                                                                                                                                                                                                              | Notes                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Quality Lab (AX7–AX15)                            | Read `hub.json` first; never hand-edit lab data — regenerate with `tools/qa/` (`world-audit.mjs`, `hub.mjs`, `lab-publish.mjs --rescore-all`); the MCP server stays dependency-free (Playwright only lazily, in `lab_screenshot`)                    | `quality-lab/README.md`                                     |
| Adult experience, Private presentation            | Intensity is only ConsentFlow's, moved by the person; ceiling only narrows; care mode is never configurable; client checks are not authorization                                                                                                     | `docs/claude/adult-experience-and-quality-lab.md`           |
| Private actions (PX1–PX7)                         | Every action in Private goes through `PrivateActionBridge`; never `startActivity` or `ConversationPublisher` from one; the policy never reads the consent level; a model's tag runs only if the person asked that turn; status comes from the player | `docs/NEXUS_PRIVATE_3_SEAMLESS_COMPANION_IMPLEMENTATION.md` |
| Private World (PW)                                | Off in every build; the avatar's adult declaration is never stood in for by private mode; Private's turns are read from the conversation surface, not `chatHistory`                                                                                  | `docs/claude/private-world.md`                              |
| Ambience (A0–A21)                                 | Three prompt-assembly sites (`_handleStreamingResponse`, `callLLM`, `__nexusMediaSuffix`); `src/gltf-viewer/ambience/` loads from `index.html`, not `boot.js`; `camera-contract.json` is generated; default crop is centred                          | `docs/claude/ambience.md`                                   |
| Life, Copilot, Experiences, Together (IC, TG, DX) | Together is the only way in; one quiet line per change, never stored; no backticks in a CSS comment inside a template literal                                                                                                                        | `docs/claude/life-copilot-experiences.md`                   |
| VR worlds and playgrounds (VW, PG)                | Plain VR stays black; place activity ids use a dash; private worlds only at the `intimate` owner's request; comfort rules enforced; every world declares measured `triangles`                                                                        | `docs/claude/vr-worlds-and-playgrounds.md`                  |
| Living Worlds (LW)                                | Spots are measured, never typed — re-measure when a model changes; another place waits for the person's yes                                                                                                                                          | `docs/claude/living-worlds.md`                              |
| World engine docs                                 | Start at `docs/engine/AI_CODER_START_HERE.md`; change a cited function or path and update the doc in the same commit                                                                                                                                 | `docs/claude/world-engine-docs.md`                          |
| Wardrobe / Try-On (W, LT, WF, FC, SW)             | `vendor/wardrobe/` changes only via `npm run wardrobe:import`; the controller is the only avatar swapper; the thirty `<script>` tags stay at the end of `<body>` (parity harness); never rebuild the service to switch Forge                         | `docs/claude/wardrobe.md`                                   |
| Speech-to-text (ST)                               | Construct recognizers only through `NEXUS_STT.recognitionClass()`; on-device chosen but impossible is an error, never a cloud fallback                                                                                                               | `docs/claude/speech-to-text.md`                             |
| SonicAgent voice (HV)                             | Never a silent fallback; consent only from the person's tick; a failure is session-only, never written to storage                                                                                                                                    | `docs/claude/sonicagent-voice.md`                           |
| Speech engines, Quest voice (Q1–Q7)               | Stored vs active engine; the Quest switch is off by default and never writes `tts_engine`; Piper never synthesizes on the main thread                                                                                                                | `docs/claude/speech-engines-quest-voice.md`                 |
| Page in Quest Browser (Q8–Q9)                     | Looks exactly like desktop Chrome; edit the icon SVGs, never the PNGs                                                                                                                                                                                | `docs/claude/quest-browser-page.md`                         |
| Entering VR from a PC (XL1–XL7)                   | Never call `renderer.setAnimationLoop` — use `_setLoop`; every per-frame call in `animate()` in its own `try`                                                                                                                                        | `docs/claude/vr-entry-from-pc.md`                           |
| Quest passthrough (XP)                            | Quest VR black, phone AR keeps its background — do not widen without asking; no VR floor grid in AR                                                                                                                                                  | `docs/claude/quest-passthrough.md`                          |
| Phone AR conversation (AR)                        | Drive voice only through CompanionMode's public API; the pipeline draws every turn once                                                                                                                                                              | `docs/claude/phone-ar-conversation.md`                      |
| VR puppet (VP)                                    | Anything that poses her in VR calls `vrPoseSystem.claimBones()` first; release writes the snapshot back                                                                                                                                              | `docs/claude/vr-puppet.md`                                  |
| VRoid Hub library (V)                             | Keep both proxies' action lists in step; a pasted link is a lookup, not a search                                                                                                                                                                     | `docs/claude/vroid-hub.md`                                  |
