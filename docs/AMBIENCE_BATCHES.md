# Ambience — batch plan (waves A0–A12)

Execution plan for the two designs:
[`VIEWPORT_IMAGE_BACKGROUNDS.md`](VIEWPORT_IMAGE_BACKGROUNDS.md) (rendering) and
[`AI_SCENE_AMBIENCE.md`](AI_SCENE_AMBIENCE.md) (language → intent → scene).

Built for agentic execution: **one batch = one session = one PR**. Every batch states what to
read before writing, what it may touch, what it must not touch, and a machine-checkable gate.

Batch prefix `A` (ambience). Verified free — the repo already uses `B`, `T`, `M`, `D`, `L`, `S`
and `MS`, and `grep -rhoE '\bA[0-9]{1,2}\b' src/` returns zero hits, so `A1` in a code comment
is unambiguous.

---

## 0. Rules for every batch

These are the house rules. They exist because the repo already enforces them.

**Module shape.** Every new module is an IIFE that assigns to *both* a global and
`module.exports`, exactly like `TogetherSwitch.js` and `PlayDirective.js`:

```js
(function (global) {
    'use strict';
    // …
    const api = { /* … */ };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_SCENE_AMBIENCE_SWITCH = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
```

There is no bundler (`"build": "echo 'Static site served by nexus-proxy (no bundle step)'"`) and
no `import` in `src/features/**`. Browser loading is via the ordered list in
`src/behavior/boot.js`; tests use `require()`. Both halves are required or the tests cannot see
the module.

**The gate, for every batch without exception:**

```bash
npm run validate     # = lint:check && format:check && test:ci
```

Know what it does and does not cover:

| Script | Covers | Gap to be aware of |
|---|---|---|
| `lint:check` | `js/**/*.js` only | **ESLint does not reach `src/`.** Do not rely on it to catch mistakes in new modules |
| `format:check` | `**/*.{js,json,css,html,md}` | Does cover `src/`. Run `npm run format` before committing or this fails |
| `test:ci` | `tests/**/*.test.js` (91 files today) | jsdom, no WebGL — design pure functions so they are testable |

**Never touch:** `app.js` (1.9 MB webpack bundle), `vendor/three-0.147.0/**`, `index-old.html`,
`index.backup.html`, `*.bak.*`, `build-viewer/`, `vrm-manager.*`, the `3D-Ambience-Studio` repo.

**Scope discipline.** A batch that needs to change a file outside its own list has found a
design problem. Stop, write it down, and raise it rather than widening the batch.

**Commit style.** Reference the batch: `A4: viewport background manager`. Matches the existing
`T5`/`B14` comment convention, so `git log --grep 'A4'` and a code comment line up.

---

## 1. Wave map

```
WAVE 0   A0  contract + CLAUDE.md                     ← unblocks everything, no product code
            │
WAVE 1   A1  cover transform        A2  catalogue        A3  intent resolver
         └── pure functions, zero shared files, fully parallel ──┘
            │
WAVE 2   A4  background manager     A7  ambience switch   A10 directive parser
         └── mechanisms; new files only, still fully parallel ──┘
            │
WAVE 3   A5  ViewerEngine wiring  ◄── sole owner of ViewerEngine.js
         A8  capability (prompt)     ── parallel, new file only
            │
WAVE 4   A6  assets + Settings scene grid  ◄── sole owner of index.html / main.js / styles
         A9  ambience controller           ── parallel, new file only
            │
WAVE 5   A11 AI path integration  ◄── sole owner of boot.js / main.js / index.html
            │
WAVE 6   A12 hardening: XR · Companion · AR · a11y · perf · memory
```

### File ownership — the thing that prevents merge pain

Contended files have exactly **one** owning batch. Nothing else in the same wave may edit them.

| File | Owner | Wave |
|---|---|---|
| `src/gltf-viewer/ViewerEngine.js` | **A5** | 3 |
| `index.html` | **A6** (scene grid) → **A11** (ambience section) | 4 → 5 |
| `src/main.js` | **A6** (bg listener) → **A11** (prompt/strip/settings) | 4 → 5 |
| `styles/main.css` | **A6** | 4 |
| `src/behavior/boot.js` | **A11** | 5 |
| `assets/ambient/backgrounds.json` | **A2** creates it complete (incl. `category`/`tags`) | 1 |

A2 writing `category` and `tags` in wave 1 — before anything consumes them — is deliberate: it
means no later batch reopens that file, and A3 can be written against the final shape.

---

## 2. Wave 0 — contract

### A0 · Freeze the data contract and write CLAUDE.md
*No product code. ~1 session, small.*

**Goal.** Make every later session cheap by writing down what it would otherwise rediscover.

**Create**
- `CLAUDE.md` at the repo root — there is none today, and it is the highest-leverage file in
  this plan. Contents: the module shape above; the `npm run validate` gate and its two gaps; the
  never-touch list; no-bundler/no-`import` rule; `boot.js` as the load mechanism; tests are
  CommonJS + jsdom; the batch-comment convention; a one-line pointer to the three ambience docs.
- `docs/ambience-contract.md` — the frozen entry shape both A2 and A3 code against:

```js
// colour entry
{ id: 'black', type: 'color', label: 'Black', swatch: '#000000' }

// image entry
{ id: 'ambient:terrace:night', type: 'image',
  label: 'Coastal Terrace', variantLabel: 'Twilight',
  src: 'assets/ambient/dark/coastal-terrace-twilight.webp',
  thumb: 'assets/ambient/dark/coastal-terrace-twilight.webp',
  focalPoint: 'center', intensity: 1,
  category: 'relax', tags: ['sea','ocean','coast','night','relax'] }
```

Plus the resolver signature, the event payload, and the two storage keys.

**Accept.** `CLAUDE.md` exists and names the gate, module shape and never-touch list.
`npm run validate` passes (format covers `.md`).
**Verify.** `npm run format:check && npm test`
**Rollback.** Delete two files.

> Freezing the entry shape here is what makes wave 1 genuinely parallel. Without it, A2 and A3
> negotiate a shape through merge conflicts.

---

## 3. Wave 1 — pure logic (3 batches, parallel)

Every batch in this wave is a pure function with no DOM, no WebGL, no renderer. They are the
cheapest to get right and the most expensive to get wrong later.

### A1 · Cover transform
**Depends** A0. **Create** `src/gltf-viewer/ambience/coverTransform.js`,
`tests/ambience-cover-transform.test.js`. **Touches nothing else.**

**Pre-read** `VIEWPORT_IMAGE_BACKGROUNDS.md` §B.3 — the formula and its verified numbers are
already there; do not re-derive them.

**Approach.** Tests first. `computeCoverTransform(imageAspect, viewAspect, focal)` →
`{repeat:{x,y}, offset:{x,y}}`, plus `parseFocalPoint(str)` → `{x,y}` handling keywords,
percentages and garbage → `center`.

**Accept.** The five viewport cases in §B.3 produce a sub-rectangle whose aspect equals the
viewport's, with the window inside `[0,1]` on both axes; focal extremes pin to the correct edge
on whichever axis crops; `focalY` provably has no effect when `repeat.y === 1`.
**Verify** `npx jest tests/ambience-cover-transform.test.js && npm run validate`

### A2 · Catalogue + asset data
**Depends** A0. **Create** `src/gltf-viewer/ambience/ViewportBackgroundCatalog.js`,
`assets/ambient/backgrounds.json`, `tests/ambience-catalog.test.js`.

**Pre-read** `VIEWPORT_IMAGE_BACKGROUNDS.md` §D, §G; `ViewerEngine.js:1321-1327` for `BG_COLORS`.

**Approach.** Wrap the five colours as `type:'color'` entries; load the JSON; `get(id)`,
`list()`, `images()`. Validate every entry on load: `src`/`thumb` must be a relative
same-origin path with no leading `/` and no `..`; anything else is dropped with one warning.
JSON carries the final shape from A0 including `category` and `tags`.

**Note.** Asset *files* land in A6, not here. This batch ships the JSON describing them, so the
catalogue is testable before 1.3 MB of WebP enters the repo.

**Accept.** All five colour ids resolve to the exact `BG_COLORS` values; a malformed entry is
dropped not thrown; an absolute URL or `..` path is rejected; no entry carries a function.
**Verify** `npx jest tests/ambience-catalog.test.js && npm run validate`

### A3 · Intent resolver
**Depends** A0 (shape only — **not** A2's code; use fixtures).
**Create** `src/features/ambience/SceneAmbienceResolver.js`,
`tests/scene-ambience-resolver.test.js`.

**Pre-read** `AI_SCENE_AMBIENCE.md` §8 — alias table and weights are specified; copy them.

**Accept.** The six worked examples in §8 resolve exactly; deterministic over 100 runs; stable
tie-break; preference ranks but never filters; an explicit request beats a conflicting
preference; below-threshold → `null`; empty catalogue → `null`; an entry missing `tags` does not
throw.
**Verify** `npx jest tests/scene-ambience-resolver.test.js && npm run validate`

---

## 4. Wave 2 — mechanisms (3 batches, parallel)

All three create new files only. No contended file is touched, so these can run simultaneously.

### A4 · ViewportBackgroundManager
**Depends** A1, A2. **Create** `src/gltf-viewer/ambience/ViewportBackgroundManager.js`,
`tests/ambience-background-manager.test.js`.

**Pre-read** `VIEWPORT_IMAGE_BACKGROUNDS.md` §H (lifecycle) and §B.4 (texture config).

**Approach.** Constructor takes injected `{ three, scene, loadTexture, catalog, getViewportSize }`
— injection is what makes it testable in jsdom, and it is how `scene-journey.js` already does it
(`loadTexture` is a constructor argument there). Implement: generation token, configure
(`encoding = sRGBEncoding`, `ClampToEdgeWrapping`, `generateMipmaps = false`,
`minFilter = LinearFilter`), apply cover transform, swap **then** dispose the previous texture,
`onResize(w,h)` recomputing on the existing texture, `reapplyCurrent()` reusing the loaded
texture, failure keeps the previous background.

**Accept.** Resolving three loads out of order leaves the newest active and disposes the other
two; a rejected load keeps the previous background and warns once; `onResize` mutates
`repeat`/`offset` without creating a texture; dispose is called after the swap, never before;
switching image→colour disposes the image.
**Verify** `npx jest tests/ambience-background-manager.test.js && npm run validate`

### A7 · SceneAmbienceSwitch
**Depends** A0. **Create** `src/features/ambience/SceneAmbienceSwitch.js`,
`tests/scene-ambience-switch.test.js`.

**Pre-read** `TogetherSwitch.js` in full (166 lines) — copy the `storage()` try/catch +
in-memory fallback and the `listeners` Set with an unsubscribing `onChange`. **Two-state, not
tri-state** (`AI_SCENE_AMBIENCE.md` §4 says why).

**Accept.** Default OFF; enable/disable persists; preference persists and defaults `auto`;
`onChange` fires for both; unknown stored values fall back to defaults; a throwing
`localStorage` degrades to memory without throwing.
**Verify** `npx jest tests/scene-ambience-switch.test.js && npm run validate`

### A10 · SceneAmbienceDirective
**Depends** A0. **Create** `src/features/ambience/SceneAmbienceDirective.js`,
`tests/scene-ambience-directive.test.js`.

**Pre-read** `PlayDirective.js` in full (203 lines) — `ORPHAN`/`BARE` exist for real failures;
reproduce them. Then `AI_SCENE_AMBIENCE.md` §7, whose regex and verification table are already
tested and can be used as-is.

**Approach.** `consume(text, options)` takes the controller and the switch via `options` with a
global fallback, exactly as `PlayDirective.consume` takes `intent`/`claim`. That is what lets
this batch ship before A9 exists.

**Accept.** The nine-row table in §7 behaves exactly as tabulated — in particular
`url="…"` **matches** (so it is stripped) and is **rejected** (so it never executes); two
directives → first executes, both stripped; orphan and bare forms stripped, never executed;
gate re-read at execution refuses when off; a throwing executor does not lose the reply.
**Verify** `npx jest tests/scene-ambience-directive.test.js && npm run validate`

---

## 5. Wave 3 — renderer integration

### A5 · Wire ViewerEngine  ◄ sole owner of `ViewerEngine.js`
**Depends** A4. **Modify** `src/gltf-viewer/ViewerEngine.js` **only**.
**Create** `tests/ambience-viewer-engine-background.test.js`.

**Pre-read** `VIEWPORT_IMAGE_BACKGROUNDS.md` §J; the five exact sites are
`:97`, `:1559-1569`, `:499-500`, `:905-928`, `:1457`.

Five edits, nothing else:
1. construct the manager in the constructor;
2. `setDesktopBackground(id)` — colour path byte-identical, otherwise delegate;
3. VR exit `:499-500` → `reapplyCurrent()` (fixes the image→black bug; `_vrSavedBackground` is
   written and never read today);
4. `resize()` → `backgroundManager.onResize(w, h)`;
5. `setRenderMode` `:1457` → `setDesktopBackground(this._desktopBgKey || 'black')`.

**Edit 5 is an intentional behaviour change** — call it out in the PR body. It also stops a
render-mode switch discarding a user's `white`. The fallback, if review objects, is in §J.

**Accept.** All five colours identical to before; an unknown id still no-ops; with no image
entries nothing observable changes; VR enter→exit with a colour selected is unchanged; Anime ↔
Cinematic preserves the selection.
**Verify** `npm run validate`, then **manual**: the five colours, and VR enter/exit with a
colour. No image exists yet — that is the point, this batch must be provably inert.

### A8 · SceneAmbienceCapability
**Depends** A7. **Create** `src/features/ambience/SceneAmbienceCapability.js`,
`tests/scene-ambience-capability.test.js`. New file only — parallel with A5.

**Pre-read** `TogetherCapability.js` in full, especially `canSearch()` (`:62-74`) and the
`systemPromptSuffix()` early-return; then `AI_SCENE_AMBIENCE.md` §6 for the instruction text.

**Accept.** OFF → `''`; ON with no runnable scene → `''`; ON → contains the tag syntax, the
14-word intent vocabulary, one example, the no-URL rule, "at most one", and the
talking-about-vs-asking-for distinction; never contains a URL or a catalogue dump.
**Verify** `npx jest tests/scene-ambience-capability.test.js && npm run validate`

---

## 6. Wave 4 — the feature becomes visible

### A6 · Assets + Settings scene grid  ◄ sole owner of `index.html`, `main.js`, `styles/main.css`
**Depends** A2, A5.
**Create** `assets/ambient/{light,dark}/*.webp` (10 files, ~1.28 MB).
**Modify** `index.html` (add `<div class="provider-grid" id="bg-scene-grid">` + "Scenes"
sub-heading **after line 1871**, which is where `#bg-selector` closes, and before line 1872,
which closes the enclosing `.config-section`), `styles/main.css` (`.provider-thumb`),
`src/main.js` (render cards from the catalogue; switch `:2333` to one delegated listener).

**Pre-read** `VIEWPORT_IMAGE_BACKGROUNDS.md` §J; `index.html:1784-1871` for the card structure;
`styles/main.css:1736-1790` — `.provider-radio:checked + .provider-content` is an **adjacent
sibling** selector, so the radio must stay immediately before `.provider-content`.

**Blocked until** asset rights are confirmed and recorded: `ruslanmv/yourfriend` has no
`LICENSE` file, and copying the images redistributes them under this repo's Apache-2.0.

**Why a delegated listener.** `main.js:2333` runs `querySelectorAll(...).forEach` once, so
radios injected later would get no handler. Delegation is order-independent and
listener-count-neutral. The save (`:3342`), sync (`:2627`) and pre-select (`:2670`) paths need
**no change** — they already pass opaque strings.

**Accept.** Scene cards render from the catalogue with no hard-coded URLs in HTML; selecting one
loads and renders it; selection persists across reload; cover holds through
landscape/portrait/narrow/mobile; a renamed asset keeps the previous background and warns; five
colours still work; keyboard reaches every card with a visible focus ring.
**Verify** `npm run validate` + the manual matrix in `VIEWPORT_IMAGE_BACKGROUNDS.md` §K.

> **This is the demo milestone.** Stop and look at it before continuing.

### A9 · SceneAmbienceController
**Depends** A5, A7. **Create** `src/features/ambience/SceneAmbienceController.js`,
`tests/scene-ambience-controller.test.js`. New file only — parallel with A6.

**Pre-read** `AI_SCENE_AMBIENCE.md` §9. The rule that matters: **the controller stores no copy
of the current scene.** It reads `getVisualState().background` and writes through
`setDesktopBackground()`. A `currentSceneId` field on this object is a bug, not a convenience.

**Accept.** Requesting the active scene is a no-op and fires no event; a second model change
inside 20 s is refused; cooldown does not apply to manual; disabled → model source refused,
settings source succeeds; the event fires exactly once per real change with the right `source`;
no duplicate state (assert the controller has no own scene field).
**Verify** `npx jest tests/scene-ambience-controller.test.js && npm run validate`

---

## 7. Wave 5 — the AI path

### A11 · Integration  ◄ sole owner of `boot.js`, `main.js`, `index.html`
**Depends** A6, A8, A9, A10.
**Modify** `src/behavior/boot.js` (add the five `src/features/ambience/*` modules after the
Together block at `:95-103`), `src/main.js` (capability at `:3572`, `:3851`, `:5330`; directive
at `:3595`, `:3657`; settings wiring; listen for the change event to sync the radios),
`index.html` (AI AMBIENCE section **after line 1499**, where the Calm-mode `.input-group` closes).

**Pre-read** `AI_SCENE_AMBIENCE.md` §3, §13, §14; `main.js:3563-3572` and `:3588-3600` for the
exact chains; `index.html:1464-1499` for the toggle markup.

**Do not** add the directive to the three research-module `consume` sites
(`SearchQuality.js:96`, `LookUp.js:417`, `SearchUX.js:139`) — fewer execution paths, and §14
explains why.

**Accept.** OFF (default) → prompt byte-identical to today and a directive refuses; ON → the
suffix appears at all three sites and a directive executes; the tag never appears in the bubble,
the transcript or TTS; a user typing the tag does nothing; toggling OFF mid-flight refuses the
reply's directive; the dropdown is disabled while off; an AI change updates the background radio
in an open Settings modal; `desktop_bg` written once; **turning AI ambience off does not change
the visible background**.
**Verify** `npm run validate` + the integration list in `AI_SCENE_AMBIENCE.md` §15.

---

## 8. Wave 6 — hardening

### A12 · XR, Companion, AR, a11y, perf, memory
**Depends** A11. **Modify** tests and docs only; any source change found necessary here is a
finding to raise, not to fold in silently.

Run and record: desktop → Companion → desktop (image restored, cover re-fitted — `resize()`
early-returns while `__COMPANION_ACTIVE__`); desktop → VR → desktop (no flat image in immersive
space, image restored on exit); an ambience directive *while in VR* (records, applies nothing
immersive, applies on exit); desktop → AR → desktop (camera feed not obscured); **a recorded
clip contains the scenery** (the regression that ruled out the CSS approach); 20 scene switches
leave exactly one live WebGL texture; no per-frame allocation; keyboard and screen-reader pass.

**Accept.** Every row in `VIEWPORT_IMAGE_BACKGROUNDS.md` §K and `AI_SCENE_AMBIENCE.md` §15
recorded pass/fail with a note. The ten enter/exit cycles invariant in
`tests/behavior/scenes.test.js` still passes.

---

## 9. Session prompt template

Paste per batch. The `Pre-read` list is the point: it stops the session spending half its context
rediscovering facts the designs already record.

```
Implement batch A4 from docs/AMBIENCE_BATCHES.md.

Read first, in order:
  docs/AMBIENCE_BATCHES.md          (section for A4, and section 0 — the house rules)
  docs/VIEWPORT_IMAGE_BACKGROUNDS.md  §H and §B.4
  src/features/together/PlayDirective.js   (module shape + dual export to copy)

You may create:  src/gltf-viewer/ambience/ViewportBackgroundManager.js
                 tests/ambience-background-manager.test.js
You may modify:  nothing
Never touch:     app.js, vendor/, index-old.html, *.bak.*, build-viewer/, vrm-manager.*

Write the tests first; the acceptance list in the A4 section is the test list.
Do not widen the scope. If you need a file outside the list, stop and say so.

Done when `npm run validate` passes. Run `npm run format` before committing.
Commit as: "A4: viewport background manager".
```

Four habits that matter more than the template:

1. **One batch per session.** Context stays small, the diff stays reviewable, and a bad batch
   reverts cleanly.
2. **Tests before implementation in waves 1–2.** Those batches are pure functions and the
   acceptance lists are already written as assertions — there is nothing to discover first.
3. **`npm run format` before every commit.** `format:check` covers `src/` and will fail the gate
   otherwise. And do not expect `lint:check` to help: it only reads `js/**/*.js`.
4. **Stop at A6 and look at it.** It is the first batch a human can see, and the first chance to
   catch an aesthetic problem before the AI path is built on top.

## 10. Why these waves

- **Waves 1–2 are pure and parallel** (6 of 13 batches) because nothing there touches a
  contended file. Three sessions can run at once without coordination.
- **Contended files have one owner per wave**, which is the whole reason the waves are ordered
  the way they are rather than by feature.
- **Every batch before A6 is provably inert.** A5 ships with no image in the catalogue, so the
  risky renderer edit is verified against unchanged behaviour before any new behaviour depends
  on it.
- **A0 pays for itself twice** — once as `CLAUDE.md` for every future session in this repo, once
  as the frozen entry shape that makes wave 1 parallel.
- **The AI path is last** because it is the only part that cannot be verified without the rest:
  a capability the model is told about with nothing to execute is worse than no capability.
