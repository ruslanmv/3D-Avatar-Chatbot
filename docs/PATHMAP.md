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
| `kb/scripts/draft-descriptions.mjs` | as specified | **B2.** Carries the authored lexicon — the content artefact of the batch |
| `kb/scripts/build-embeddings.mjs` | as specified | **B2.** Model is `bootstrap-lexical-v1`, not MiniLM — see §2c |
| `kb/embeddings/index.f32` | as specified | `[gen]` count × dims Float32 matrix |
| `kb/embeddings/index.meta.json` | as specified | `[gen]` model, dims, count, row↔id map, manifest hash |
| *(not in the spec)* | `kb/embeddings/index.vocab.tsv` | **Added in B2.** `term<TAB>idf` per column. A query cannot be embedded into the same space without it, and it keeps the numbers out of a prettier-formatted JSON file |
| *(not in the spec)* | `kb/descriptions.approved.json` | **Added in B2.** The human review ledger — see §2c |
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

## 2c. The semantic half of the KB (B2)

`draft-descriptions.mjs` fills `description`, `tags`, `intents`, `valence` and `energy`
from an authored lexicon of ~90 concepts — the `emotion/` pack is the GoEmotions taxonomy,
so the emotional vocabulary maps onto it directly. The formula is §5.P0's: **action + body
focus + tempo + emotion**, where tempo comes from the *measurement* rather than the label,
so three takes of the same joy capture read at three different tempos and the anti-repeat
memory of §6.5 has something to tell them apart by.

Two decisions worth knowing before editing it:

- **Tempo words are measurement-backed synonyms.** A clip measured fast is tagged
  `energetic`, `quick`, `high energy`. Without that, "energetic" was a rare word appearing
  in one description, IDF made it enormous, and *"energetic celebration dance"* returned a
  jump.
- **Colliding descriptions are disambiguated by source.** `dance_1.bvh` and the
  `dance_1.vrma` converted from it are the same motion at the same tempo, so they drafted
  identically — 14 records did. Identical prose means identical vectors, which means the
  selector cannot tell them apart. Each now names its source file.

### The model is not MiniLM yet

Spec §4A names transformers.js MiniLM. There is no bundler, no build step, and
`package.json` is not on the §7 allowlist, so adding the dependency here would be a spec
violation dressed as a build detail. **B5 owns that decision** (it is listed in §5 below)
and regenerates these artefacts with a real encoder.

`bootstrap-lexical-v1` is TF-IDF over an **explicit vocabulary** (3641 terms) — unigrams,
adjacent bigrams and 4-character shingles, tags and intents weighted 3× over prose.
Explicit, not hashed, because hashing was measurably wrong here: at 512 buckets every
bucket was occupied, so query words matching nothing still landed somewhere and scored, and
*"sit down quietly"* returned a jump followed by three angry clips. Raising the bucket count
and zeroing empty buckets each helped and neither fixed it. With a vocabulary, an unknown
term has no column and contributes nothing. The same query now returns the four sitting
idles.

### The approval ledger

The batch plan says a human approves every line. `kb/descriptions.approved.json` is where
that is recorded — id → `sha256(description)` prefix, who, when — so editing a line
silently un-approves it. `validate-manifest.mjs --require-approval` fails while anything is
pending, and **CI does not run that flag**: all 166 descriptions are machine-drafted and
have not been through human review. CI runs `--level semantic`, which checks the fields are
real; the flag is what a reviewer flips when the read-through is done.

```bash
node kb/scripts/draft-descriptions.mjs --write   # redraft from the lexicon
node kb/scripts/build-embeddings.mjs --write     # rebuild the index
node kb/scripts/build-embeddings.mjs --search "energetic celebration dance"
node kb/scripts/validate-manifest.mjs --level semantic      # what CI runs
node kb/scripts/validate-manifest.mjs --require-approval    # the human gate
```

## 2d. The runtime switch (B3)

The engine is **opt-in at runtime** through `localStorage.nexus_bd_enabled`. That key is
the switch; `config/behavior.config.json` holds the shipped defaults and everything else
the engine reads (weights, whitelist, budgets). B7 adds the settings toggle that writes it.

```js
// src/main.js, before the render loop starts — the whole seam:
window.NEXUS_BD_ENABLED = localStorage.getItem('nexus_bd_enabled') === 'true';  // in a try
if (window.NEXUS_BD_ENABLED) { /* inject src/behavior/boot.js, then NEXUS_BD_BOOT() */ }

// src/main.js, in animate() — one boolean per frame while the engine is off:
if (window.NEXUS_BD_ENABLED) window.NEXUS_BD?.update?.(delta);
```

`boot.js` loads its own dependencies in order, reads the config, builds the bus, blackboard
and registry, and logs the KB summary. Booting twice returns the running instance;
`NEXUS_BD.teardown()` detaches every adapter and clears the global.

Globals published by the engine: `NEXUS_BD_ENABLED` (the guard), `NEXUS_BD_BOOT` (the
entry point), `NEXUS_BD` (the director), and one per module — `NEXUS_BD_EVENT_BUS`,
`NEXUS_BD_BLACKBOARD`, `NEXUS_BD_REGISTRY`, `NEXUS_BD_VALIDATE`.

**A note for whoever touches the parity harness next.** B3 hardened it twice, and both were
real gaps rather than tuning: the engine's own files were being reported as stray references
to the engine, and a reach made through the `NEXUS_BD` global rather than a path was
invisible to it, so `main.js`'s boot call and update call were not being guard-checked at
all. Both are fixed in `scripts/behavior-parity-baseline.mjs` and mirrored in
`tests/behavior/parity.smoke.test.js`.

## 2e. The tag channel (B4)

`[[emote:…]]` is a **second** LLM→body channel, alongside the ```motion fence this repo
already ships. It does not add a call site: `main.js` already routes every reply through
`window.NEXUS_MOTION` in the three places that matter, and each is a place a tag must not
survive — so `LLMTagAdapter` **decorates that facade** at boot and restores it exactly on
detach. Spec §1.5 asks for this ("existing managers are wrapped, never rewritten") and the
repo's own `BehaviorEngine.js` set the precedent.

| Wrapped | What the tag channel adds |
|---|---|
| `maskStreaming(accumulated)` | Fires newly complete tags as intents mid-stream, emits `llm:token` deltas, and hides complete **and partial** tags from the transcript |
| `processReply(text)` | Fires tags on the non-streaming path, strips them before display **and TTS** (`speakText` receives this output), then resets the per-reply budget |
| `systemPromptSuffix()` | Appends the §6.8 paragraph *after* the existing motion contract |

**B4 touched no pre-existing file at all.** The consequence worth knowing: the two channels
are masked in one pass rather than two, which is the failure mode §7 warns about, and the
existing `src/xr/` suites cannot regress because nothing in them changed.

Three defects the tests caught, all worth keeping in mind when editing this file:

- The partial-tag mask used `\[\[[^\]]*$`, which does not match `[[emote:happy 0.8]` —
  that string contains a `]`. It leaked one frame of raw tag onto the screen. The rule is a
  `[[` with no `]]` after it, not a `[[` with no `]`.
- `detach()` restored a **bound copy** of the original method, so `motion.maskStreaming`
  came back as a different function object. "Restores it exactly" means identity.
- Removing a tag leaves the space it stood in. Tidying is part of stripping, not cosmetic.

`SentimentFallback` carries no keyword table: `EmotionEngine` already has one (emoji,
weighted patterns, punctuation, HomePilot directives, in a documented priority order) and a
second would drift from it. It only speaks when the model sent no tag — explicit beats
inferred.

`SpeechAdapter` polls rather than listening: `speechSynthesis` drops `end` when a tab is
backgrounded or an utterance is cancelled mid-word, and a missed `tts:end` leaves her mouth
moving after the audio stops. A poll can arrive a tick late; it cannot miss an edge.

## 2f. The mixer (B5–B6)

§6.6 calls pose-buffer blending "the one hard problem". The hard part is not the slerp: it
is that three sources in this app write bones **directly** — `ProceduralAnimator` sets
rotations, the clip loaders drive a `THREE.AnimationMixer`, and `PoseApplier` applies a
saved pose. Whoever writes last wins, and that is the pop. Under the engine each layer
writes into its own **pose buffer**; `LayerMixer` blends the buffers and performs exactly
one write per bone per frame.

The buffers are plain `[x, y, z, w]` arrays and the maths has no THREE dependency, matching
the convention `tests/bvh-retarget.test.js` already sets: the maths is pinned in Jest, the
playback is a browser concern.

### Two things that had to be got right

**The double cover.** `q` and `−q` are the same rotation. Interpolating between them without
flipping the sign spins the bone almost all the way round — that is the pop, and it is three
lines of slerp.

**A crossfade needs two clip slots.** The first implementation faded a single clip layer
from 0 to 1, which blends the incoming clip against the *base pose* rather than against the
clip it replaces: the outgoing pose vanishes in one frame. The pop detector measured it as a
**2.16 rad jump**. The scheduler now ping-pongs `clipA`/`clipB`: the outgoing clip holds full
weight underneath for the whole fade while the incoming ramps up above it, and the per-bone
slerp is then exactly the crossfade. Dropping both weights together would dip through the
base pose in the middle, which is the other version of the same bug.

### The single-owner rule

`AnimationResolver` already owns the rig, clip-first with a procedural fallback. The engine
does **not** become a second owner: every request the scheduler approves is handed to it
(`source: 'behavior-director'`), so `NEXUS_MOTION`, Pose Studio and the Director all queue
behind one door. A refused request never reaches it — tested.

### Layer stack

| Order | Layer | Mask | What it is |
|---|---|---|---|
| — | base pose | — | T-pose correction + Natural Pose Style, the floor under everything (§5.P4) |
| 0 | `procedural` | fullBody | `ProceduralAnimator`, run unchanged and read back into a buffer |
| 1–2 | `clipA` / `clipB` | fullBody | The two crossfade slots, fed by the existing clip loaders |
| 3 | `head` | head | Look-at and lipsync — above everything, so a full-body dance never takes the head with it |

A layer at weight 0 reveals the corrected base pose, never a raw T-pose.

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

1. **`index.html`** — reserved, **not used**. B0 assumed a script-tag app needs a static
   `<script>` registration. **B3 found it does not:** `main.js` injects `boot.js` itself,
   and only when the flag is on, so with the engine off no engine file is fetched, parsed
   or evaluated at all. That is a stronger claim than a tag that loads and does nothing, so
   the seam stayed at one file. The entry remains for B7's settings markup; a batch that
   uses it must say so here.
2. **`src/PoseStudioPanel.js`** — the spec's optional "Publish to KB" action (B7); named
   here so the file is on the list before the batch needs it.

The allowlist, as enforced by `scripts/behavior-parity-baseline.mjs` and
`tests/behavior/parity.smoke.test.js`:

```
index.html                        reserved for the B7 settings toggle — unused as of B3
src/main.js                       guarded boot + update(dt) (B3) ✅
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
| B7 | Exact settings-panel control location for the "Behavior engine (beta)" toggle that writes `localStorage.nexus_bd_enabled` |
| B4 | Whether `js/speech-service.js` and `PiperWasmTTSProvider` both emit, or one wraps the other |
| B5 | Where the MiniLM worker and its IndexedDB cache live given no bundler (vendored vs. CDN, matching the existing MediaPipe CDN pattern in `FaceTracker.js`) |
| B2 → human | Read-through and sign-off of all 166 descriptions into `kb/descriptions.approved.json`, then turn on `--require-approval` in CI |
| B5 | Whether the per-category `priority`/`cooldownMs` defaults and the lexicon's valence values survive contact with the ranker |
| B6 | Whether `LayerMixer` drives `AnimationResolver` or registers as a source inside it |
| B12 | Screen mesh placement API on `WebXRChatbot` / `gltf-viewer` |
