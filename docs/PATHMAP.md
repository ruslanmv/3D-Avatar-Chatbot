# PATHMAP — spec paths → this repository

Spec v1.1 §0.6: *when the repo layout differs from the paths assumed in the spec, keep the
role and adapt the path; record the mapping here so later phases stay consistent.*

This file is the record. It is authoritative for names and paths; the spec text in
`docs/BEHAVIOR_DIRECTOR.md` stays verbatim and is never edited to match the repo.

Frozen in **B0**. Every later batch reads this file before writing code, and appends to it
in the same PR that introduces a new mapping.

---

## 1. The three facts that drive every mapping

**The client is a script-tag app, not a bundled ESM app.** `index.html` loads ~78 files as
`<script defer>` in a hand-maintained order; modules are IIFEs that publish themselves on
`window.NEXUS_*`. There is one ESM island (`src/engine-bridge.js`, loaded with an
importmap) and `npm run build` is a no-op — the site is served statically by
`nexus-proxy/server.js`.

*Consequences:* the bootstrap seam the spec puts in `src/main.js` is **two** seams here (a
script tag plus a guarded call); a new module is not "imported", it is *registered*; and
anything the engine needs at boot has to be inert on load, because a script tag runs
whether the flag is on or not.

**Jest tests are CommonJS.** `package.json` declares `"type": "module"`, but the 45
existing suites use `require()` and jest resolves them as CJS. New tests follow that; new
tooling scripts are `.mjs` and are exercised from tests as a subprocess rather than
imported.

**Formatting is enforced repo-wide, linting is not.** `npm run format:check` runs prettier
over `**/*.{js,json,css,html,md}` (4-space indent, single quotes, 120 cols; 2-space for
JSON; `docs/` and `vendor/` ignored). `npm run lint:check` only covers `js/**/*.js`. New
files must be prettier-clean or CI goes red.

---

## 2. Client path map

| Spec path | This repository | Note |
|---|---|---|
| `src/main.js` (bootstrap hook) | `index.html` (script registration) **+** `src/main.js` (guarded boot + `update(dt)`) | Two seams, not one — see §4 |
| `src/managers/LLMManager.js` | `src/LLMManager.js` | No `managers/` directory; 1750 lines, owns the provider chain incl. OllaBridge |
| `src/managers/SpeechService.js` | `js/speech-service.js` (Web Speech) **+** `src/tts/PiperWasmTTSProvider.js` (Piper WASM) | The role is split across two files; both get the `tts:*` hook |
| face/gaze tracking module | `src/FaceTracker.js` (MediaPipe FaceLandmarker), `src/HandTracker.js` | Optional hook 5 lands in `FaceTracker.js` |
| persona/system prompt (§6.8 tag contract) | `src/xr/MotionContract.js` | Already appends a contract to every request; the `[[emote:…]]` paragraph is an additive section of it |
| SettingsPanel (engine + session toggles) | `src/TrackingSettingsPanel.js` and the settings markup in `index.html` | Exact control location decided in B3; recorded here when it lands |
| Pose Studio ("Publish to KB") | `src/PoseStudioPanel.js` | B7 |
| existing procedural behaviours | `src/ProceduralAnimator.js`, data in `src/AnimationPresets.js` | `ProceduralLayer` wraps these unchanged |
| existing clip loaders | `src/ClipAnimationLoader.js`, `src/BVHAnimationLoader.js`, `src/VRMAAnimationLoader.js`, `src/ClipAnimationShared.js` | `ClipLayer` reuses them |
| saved poses | `src/PoseLibrary.js`, `src/PoseApplier.js`, `src/PoseState.js` | `PoseLayer` reuses them |
| VR / XR system | `src/WebXRChatbot.js`, `src/xr/**`, `src/gltf-viewer/**` | Screen placement and AR hit-test in B12 |
| NSFW setting | `src/SpicyGate.js` → `window.NEXUS_SPICY` | The **existing**, age-verified authority. §6.5's gate reads it; there is no second flag |
| animation assets | `addons/vrma-actions/`, `addons/vrma-dance/`, `addons/vrma-locomotion/`, `vendor/animations/` | 44 VRMA + 107 BVH, already mapped by `src/xr/MotionClipMap.js` |
| `kb/` | `kb/` | As specified. B1 harvests it (see §2b) rather than authoring from zero |
| `kb/scripts/extract-bvh-stats.mjs` | as specified | Pure text parser; no 3D library |
| *(not in the spec)* | `kb/scripts/extract-vrma-stats.mjs` | **Added in B1.** The spec assumes only BVH needs a stats reader. 44 of the 151 shipped clips are VRMA, in two different containers, and a record with no duration is a record the ranker cannot use |
| *(not in the spec)* | `kb/scripts/harvest-existing.mjs` | **Added in B1**, per the batch plan: the KB is derived from what the repo already knows |
| *(not in the spec)* | `kb/harvest-report.json` | **Added in B1.** Generated working note for B2 — drafts still open, energy suggestions, orphaned assets, provenance |
| `config/behavior.config.json` | as specified | Landed in B0, flags off |
| `tests/behavior/` | as specified | Jest picks it up automatically via `testMatch: **/tests/**/*.test.js` |
| `tests/fixtures/protocol/` | as specified | Byte-identical to HomePilot `backend/tests/fixtures/protocol/` |

## 2b. Where the KB comes from (B1)

The manifest is **harvested**, not authored. Four sources, in the order they are trusted:

| Source | What it settles |
|---|---|
| `vendor/animations/manifest.json` | Categories, the `experimental` flag on the BVH dance pack, `emotionMapping` (which becomes `intents`), and the `credits` block that gives every asset its `source` and `license` |
| `src/xr/MotionClipMap.js` | Which clips the running app can reach, their `loop`/`sticky` flags (`interruptible` is `!sticky`), and the eight Mixamo-origin dance clips it deliberately excludes |
| `src/AnimationPresets.js` | The 15 procedural behaviours and their `adult: true` flag, which becomes `nsfw` |
| The filesystem | Ground truth: 107 BVH + 44 VRMA. Coverage is checked in both directions |

Both JS sources are **executed**, not pattern-matched, so the KB cannot drift from the
tables the app itself uses. They are executed in a `vm` sandbox rather than `require`d:
`package.json` declares `"type": "module"`, so Node reads these `.js` files as ESM, where
`MotionClipMap`'s trailing `module.exports = …` is a no-op — a `require` hands back an
empty namespace and the harvest silently degrades. The sandbox supplies `window` and
`module`, and `loadBrowserModule` throws if a module ever stops publishing.

**What B1 does not do is author meaning.** `description` is empty, `valence` and `energy`
are `0`. The measured numbers behind them live in `stats` (`duration`, `rootMotion` in body
heights, `meanJointVel` in rad/s) where they are facts; `kb/harvest-report.json` carries
suggested energy values so B2 starts from data rather than a blank page. This is the split
the two validation levels enforce:

```bash
node kb/scripts/harvest-existing.mjs          # dry run
node kb/scripts/harvest-existing.mjs --write  # rewrite manifest + report
node kb/scripts/validate-manifest.mjs                    # structural — B1, what CI runs
node kb/scripts/validate-manifest.mjs --level semantic   # + descriptions — B2 raises CI to this
```

`validate-manifest.mjs` carries its own small JSON Schema validator rather than depending
on ajv: this repo has no bundler and no build step, and a gate that needs an install is a
gate that stops being run. It rejects any schema keyword it does not implement, so the
schema cannot quietly outgrow it.

### Names that are already taken

| Wanted | Taken by | Use instead |
|---|---|---|
| `BehaviorEngine` | `src/BehaviorEngine.js` — the IDLE/LISTENING/THINKING/SPEAKING aliveness state machine on `window.NEXUS_BEHAVIOR` | `src/behavior/BehaviorDirector.js`, global `window.NEXUS_BD` |
| a new LLM→motion channel | `src/xr/MotionContract.js` + `MotionBlockParser.js` (```motion fenced plans) | The `[[emote:…]]` tag channel **coexists**; the tag parser chains after `MotionBlockParser.maskStreaming()` so the stream is masked once |
| a new capability gate | `src/xr/MotionPolicy.js` (Living-NPC tiers) | Stays the authority on locomotion; the ranker gates clip *selection* only |
| a new clip router | `src/AnimationResolver.js` | While the engine is on, playback requests route through it — one owner for the rig |

---

## 3. Frozen names

Decided in B0; every later batch cites them.

| Thing | Value |
|---|---|
| Engine source root | `src/behavior/` |
| Feature roots | `src/features/together/`, `src/features/clips/`, `src/features/playmode/` |
| Global | `window.NEXUS_BD` (director), `window.NEXUS_BD_ENABLED` (guard, when a global is needed) |
| Config file | `config/behavior.config.json` |
| Server package | `backend/app/avatar_director/` (HomePilot — `backend/app/avatar/` is taken by avatar image generation) |
| Server routes | `/avatar/session`, `/avatar/rtc`, `/avatar/vision/insight`; documented fallback `/companion/*` |
| Protocol fixtures | `tests/fixtures/protocol/` (client) · `backend/tests/fixtures/protocol/` (HomePilot) |
| Parity harness | `scripts/behavior-parity-baseline.mjs` + `tests/behavior/baseline/boot-baseline.json` |

---

## 4. The amended §7 allowlist

Spec §7 lists the only pre-existing files any batch may touch. Two additions are forced by
§1 and are recorded here rather than taken silently:

1. **`index.html`** — the spec's `src/main.js` import has no equivalent in a script-tag
   app. Registering `src/behavior/boot.js` is a one-line `<script defer>` addition. It is
   additive, but it is an existing-file touch the spec did not list.
2. **`src/PoseStudioPanel.js`** — the spec's optional "Publish to KB" action (B7); named
   here so the file is on the list before the batch needs it.

The allowlist, as enforced by `scripts/behavior-parity-baseline.mjs` and
`tests/behavior/parity.smoke.test.js`:

```
index.html                        script registration (B3)
src/main.js                       guarded boot + update(dt) (B3)
src/LLMManager.js                 llm:token emit (B4)
js/speech-service.js              tts:start / tts:end (B4)
src/tts/PiperWasmTTSProvider.js   tts:start / tts:end (B4)
src/FaceTracker.js                gaze:* emit, optional hook 5 (B4)
src/xr/MotionContract.js          §6.8 tag paragraph (B4)
src/PoseStudioPanel.js            "Publish to KB" action (B7)
```

Anything else is a spec violation: stop and flag it, do not widen the list quietly. Adding
a file to the list is itself a reviewable change to this section and to both enforcement
points.

**What "no other file may touch it" means in practice:** no shipping file outside this list
may so much as *name* `src/behavior/`, `src/features/together/`, `src/features/clips/`,
`src/features/playmode/`, `kb/` or `config/behavior.config.json`. That is what makes §7's
uninstall claim true — delete those directories and nothing dangles.

---

## 5. Running the parity harness

```bash
node scripts/behavior-parity-baseline.mjs            # human-readable report
node scripts/behavior-parity-baseline.mjs --check    # exit 1 on drift (what CI runs)
node scripts/behavior-parity-baseline.mjs --write    # re-record the baseline, deliberately
npx jest tests/behavior                              # the same claims, checked independently
```

The baseline records what the engine contributes to the shipping app — engine script tags,
references from allowlisted files and whether each sits next to the flag guard, and the
config key set. It deliberately does **not** hash unrelated product files: that would pass
once and then fail on everyone else's unrelated edits. Total boot-script count is recorded
as informational only, for the same reason.

Re-recording is expected exactly once per §7 touch, in the PR that makes the touch, where
the baseline diff is the reviewer's summary of what changed about the app's boot.

---

## 6. Open mappings

Recorded when the batch that needs them lands.

| Batch | To decide |
|---|---|
| B3 | Exact settings-panel control location for the "Behavior engine (beta)" toggle |
| B4 | Whether `js/speech-service.js` and `PiperWasmTTSProvider` both emit, or one wraps the other |
| B5 | Where the MiniLM worker and its IndexedDB cache live given no bundler (vendored vs. CDN, matching the existing MediaPipe CDN pattern in `FaceTracker.js`) |
| B2 | Whether the 81 orphaned assets (shipped but reachable by no clip-map entry and no emotion mapping) all deserve descriptions, or whether some should be marked `experimental` first |
| B2 | Whether the per-category `priority`/`cooldownMs` defaults the harvest applies survive contact with the ranker |
| B6 | Whether `LayerMixer` drives `AnimationResolver` or registers as a source inside it |
| B12 | Screen mesh placement API on `WebXRChatbot` / `gltf-viewer` |
