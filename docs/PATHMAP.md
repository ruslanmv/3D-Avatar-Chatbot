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

## 2g. Modes and published poses (B7)

**A mode is data, and leaving one puts everything back.** The tempting implementation of
"restores companion exactly" is to undo each change on the way out; that is the version
that drifts, because a field added to a profile in six months needs a matching undo and the
one nobody adds is the one that breaks. `ModeManager` snapshots every field it is about to
touch and restores the snapshot verbatim, so a new field is covered because it was
captured, not because someone remembered it. Scene overlays (B14) stack the same way.

A mode **narrows and never opens**: `together` refuses clips that would walk her out of
joint attention, and `showcase` forces the adult tier off whatever the user setting says,
because a demo runs in front of whoever walks past.

**Published poses live in localStorage** (`nexus_bd_published_poses`), because
`kb/animations.manifest.jsonl` is a build artefact a browser cannot write. The registry
merges them over the shipped manifest at load, through the same runtime validator. Three
consequences worth knowing: they are per-browser until someone exports them; their ids are
namespaced `pose_user_`, so a user pose can never shadow a shipped clip; and
`publisher.publish()` adds to the *live* registry itself, so Pose Studio makes one call and
never reaches into the KB.

### The settings toggle

`index.html` gained one config section writing `localStorage.nexus_bd_enabled` — the key
`main.js` reads at boot. No engine script is registered there; deleting the section removes
the toggle and nothing else.

### Names that are already taken

| Wanted | Taken by | Use instead |
|---|---|---|
| `BehaviorEngine` | `src/BehaviorEngine.js` — the IDLE/LISTENING/THINKING/SPEAKING aliveness state machine on `window.NEXUS_BEHAVIOR` | `src/behavior/BehaviorDirector.js`, global `window.NEXUS_BD` |
| a new LLM→motion channel | `src/xr/MotionContract.js` + `MotionBlockParser.js` (```motion fenced plans) | The `[[emote:…]]` tag channel **coexists**; the tag parser chains after `MotionBlockParser.maskStreaming()` so the stream is masked once |
| a new capability gate | `src/xr/MotionPolicy.js` (Living-NPC tiers) | Stays the authority on locomotion; the ranker gates clip *selection* only |
| a new clip router | `src/AnimationResolver.js` | While the engine is on, playback requests route through it — one owner for the rig |

---

## 2h. The session channel (B9)

`src/behavior/adapters/SessionAdapter.js` is the client half of the protocol B8 mounts at
`/avatar/session` in HomePilot. Both halves read the same fixtures, `tests/fixtures/protocol/`,
which are byte-identical in the two repositories — change one and the other repo's contract
test goes red.

### A server intent has no privileges

The rule the adapter exists to enforce. An `intent` off the socket goes through the §6.2
whitelist and onto the same bus as a locally parsed `[[emote:…]]` tag, so §6.5's gates apply
to it unchanged. Nothing on this path can name a clip, and `source` is preserved rather than
rewritten, which is what makes the ranker's "she never initiates spicy" line (`source !==
'user'` blocks NSFW) mean anything once curiosity (B16) starts sending.

`vision_insight` carries intents too; they go through the same filter, counted in the same
`dropped.notWhitelisted`.

### The speech seam

`say` is the one message type that needs something the engine does not own. `speakText` is a
module-local function in `main.js`, not a global, so B9 adds a third guarded line there:

```js
if (window.NEXUS_BD_ENABLED) window.NEXUS_BD_SAY = (text) => speakText(text);
```

A server-started line is therefore spoken by exactly the path a chat reply takes —
normalisation, lipsync segmentation, Talk behaviour — rather than a second speech route that
would drift from the first. With the flag off the global does not exist.

`NEXUS_BD_SAY` had to be added to `ENGINE_GLOBALS` in both enforcement points: `\bNEXUS_BD\b`
does not match it, because the next character is an underscore. Same lesson as B3 — a reach
the harness cannot see is a reach nobody checks for a guard.

### Two settings, and why there are two

The BEHAVIOR ENGINE (BETA) section gains a "Connect HomePilot session" switch and a URL
field, writing `nexus_bd_session_url` and `nexus_bd_session_enabled`. `boot.js` overlays them
onto the shipped `session` block, which stays `enabled: false` in the JSON.

The switch is disabled until a URL is present, and a URL on its own does not connect: filling
in a field is not consent to open a socket to it. That is also why this is a second switch
rather than a consequence of the engine flag — everything else the Director does runs on this
device, and this is the one control that lets something off-device reach it.

### Losing the network

Two failure shapes, because they are not the same failure:

- **A clean close.** `onclose` fires: `session:down` is emitted, `sessionUp` clears,
  reconnection backs off 1 s → 30 s and a successful open resets it.
- **A pulled cable.** TCP does not notice, so `onclose` never fires and the socket sits there
  looking healthy. The only evidence is the server's 15 s heartbeat going quiet, so the
  adapter has a `tick` — the render loop already polls adapters — that abandons a socket
  silent for 2.5 heartbeats. It nulls the handlers first, so the real `onclose` arriving late
  cannot schedule a second reconnect.

Neither touches Tier 1. The selector, ranker and mixer are local and stay local; a dropped
session costs the server's contributions and nothing else.

### `adult_ack` is recorded, and unlocks nothing

Server attestation (§16.1) is one of three conjunctive conditions in the ranker's NSFW gate,
alongside the owner's `nsfwAllowed` setting and a mode that permits it. The adapter records it
on the blackboard, never in storage — a reload or a reconnect re-asks — and nothing reads it
yet; B28 wires it at the gate, which is the only place a gate may live.

---

## 2i. The microphone (B10)

`src/behavior/adapters/VoiceAdapter.js` observes the recogniser the app already has. It does
not build one, and the test that matters most in `tests/behavior/voice-uplink.test.js` is the
one asserting the file contains no `SpeechRecognition`, no `MediaRecorder` and no
`AudioContext`.

### What it observes, and how

`window.SpeechService` (`js/speech-service.js`) already owns Web Speech recognition, the
MediaRecorder fallback for Quest, permission handling and device selection. The adapter
**chains** onto `recognition.onspeechstart` / `onspeechend` / `onerror` / `onend` rather than
replacing them: the app's own handler still runs, and `detach()` restores the originals
object-for-object. Same decorate-and-restore pattern as B4's tag channel, so `js/speech-service.js`
stays untouched even though it is on the allowlist.

Those edges become `user:speaking` / `user:silent` on the bus — the browser's own VAD, from
the same engine doing the ASR, not a second audio analyser. `onerror` and `onend` also clear
the flag, because `onspeechend` is unreliable on some builds and a latched flag is how she
ends up waiting politely for a sentence that finished two minutes ago. A `tick()` releases it
after a 1.2 s tail as the last resort.

The adapter does **not** read `onresult`. SpeechService's own handler owns the app's
transcript; reading the raw event a second time here is how the two would eventually disagree
about what the user said. A final transcript is handed in by its caller.

### What the server does with it

`voice_transcript` → HomePilot's `rtc.py` → `voice_call.turn.run_turn` → a reply, split into
`intent` + `say` and sent back down the socket, both marked `source: "voice"`. Those are B9's
existing handlers, so speech reaches the rig by the path a `[[emote:…]]` tag already took.
`source: "voice"` is not `"user"`, so §6.5's NSFW gate holds against it exactly as it does
against a curiosity intent.

`voice_state` (listening / thinking / idle) drives a mic indicator and is deliberately **not**
put on the bus: it is a fact about the server, not something she should react to.

### Declining is an answer

`enable()` resolves to `'listening'` or `'unavailable'` and never throws. On a refusal the
adapter does not observe the recogniser at all, offers nothing to the server, and every other
channel — typed chat, the tag parser, idle, gaze, the session socket, the whole mixer — is
untouched. `attach()` asks for nothing; the microphone is requested only by
`director.enableVoice()`, which the settings button is the one caller of. An engine that
grabs the mic on load is one nobody should switch on.

---

## 2j. Consent and capture (B11)

Together Mode's gate, landed before any of its consumers. Four later batches want frames —
screen insight (B15), the game co-host (B23), the camera activities (B26, B27) — and the
ordering is the design: if any of them could reach `getDisplayMedia` directly there would be
four consent stories to keep true instead of one.

### Paths

The spec's tree names `capture/CapturePipeline.js` and `ui/TogetherPanel.js`. Two files it
does not name were needed to make the machine and the indicator separate things:

```
src/features/together/capture/ConsentMachine.js    the gate — spec calls it "consent state machine"
src/features/together/capture/CapturePipeline.js   as specified
src/features/together/ui/ConsentIndicator.js       the 2D + XR indicator, split out of the panel
src/features/together/ui/TogetherPanel.js          as specified
```

The indicator is deliberately **not** part of the panel: the panel is optional UI a batch
mounts, and an indicator that can be left unmounted is an indicator that lies. It subscribes
to the machine in `boot.js`, alongside the machine itself.

### There is no way around it

`ConsentMachine` is the only file in `src/behavior/` or `src/features/` that names
`getDisplayMedia` or `getUserMedia`, and `tests/behavior/capture.test.js` asserts that by
walking both trees. `CapturePipeline` contains no `navigator` at all: it is constructed *from
a grant*, and a grant only comes out of `request()`. So "capture requires consent" is the
shape of the API rather than a check somebody has to remember to write — a future consumer
has to ask for consent simply to obtain an object it can build a pipeline with.

Nothing is persisted. A reload starts at `idle`, because consent to share a screen five
minutes ago is not consent to share it now.

### Revocation is an integer

A grant reads `live` as `machine.epoch === myEpoch && state === 'active'`. Revoking bumps the
epoch **first**, before anything that can yield, so every grant ever issued is dead in the
same tick with no listener to fire and no promise to await. The sampler re-reads `grant.live`
after each await, which is what makes "cancels in-flight sampling within one frame" true
rather than approximately true: a sample mid-encode resolves to `null`, its bytes are never
handed over, and the canvas is wiped on the way out.

The epoch earns its keep in exactly one case the state flag cannot cover: requesting a new
source while one is active revokes and re-activates, so `state` is `'active'` again and only
the epoch tells the old grant apart from the new one. There is a test for that alone.

The user can also stop sharing from the browser's own bar, which ends the track without
telling the app. The machine listens for `ended` and revokes — an indicator still saying
"Sharing your screen" after that would be worse than no indicator.

### The caps, once

§6.2's `maxFps: 1`, `frameLongEdgePx: 512`, `jpegQuality: 0.7` are **ceilings**, enforced in
`CapturePipeline` and nowhere else. A caller asking for 30 fps gets 1; 1080 px gets 512; q1.0
gets 0.7. They are clamped from below too, so a config typo of `0` or `-5` cannot become a
divide-by-zero interval or an unbounded sampler. The server's own re-check (§6.13) is a second
opinion, not the only one.

### The indicator, in both places

One `onChange` subscription drives both surfaces, so they cannot disagree — the failure where
the badge clears and the headset keeps sharing is not reachable. The 2D half is a fixed badge
with `role="status"` and `aria-live`, so it is announced and not only drawn. The XR half is a
small plane parented to `NEXUS_VIEWER.camera` with `depthTest: false`: an immersive session
renders its own framebuffer and never sees the DOM, and parenting to the camera means turning
around cannot leave the marker behind. Either half failing is caught and logged; the other
still renders.

The wording comes from the grant — "Sharing your screen", "Camera on", "Sharing your game" —
because a generic "sharing" badge is not an honest one.

---

## 2k. Watch Together (B12)

`src/features/together/activities/watch.js` and `src/behavior/adapters/MediaAdapter.js`.
Zero pre-existing files touched.

### How YouTube gets on the screen

Not by embedding it. A DRM'd player cannot be read into a `VideoTexture`, and an iframe is
not a texture source. The route the spec chose and this batch implements is **tab capture**:
`getDisplayMedia` through B11's consent machine, `video.srcObject = grant.stream`, and from
there the same texture a local file gets. So "YouTube in VR" is the shared-tab path, and it
performs like a local file rather than like a screenshot loop because there is only one
frame path.

Source (a), a file or HLS URL, sets `video.src` and involves no grant — it is the user's own
file. Source (b) sets `video.srcObject` from a grant. That is the only difference between
them; both end at the same `VideoTexture` on the same mesh.

### Why it can hold 1080p

The claim rests on a property, not a measurement, and the tests say so. `THREE.VideoTexture`
is bound straight to the element and the GPU uploads from it; nothing in `watch.js` calls
`drawImage`, `getImageData`, `toDataURL` or `needsUpdate`, and a test reads the file to keep
it that way. The regression that would break 1080p is a per-frame canvas round trip, and
that is exactly what the source assertion forbids. Geometry and texture are built once
however many times placement is called.

A Node process is not a Quest. The measured number in `watch.test.js` is the per-frame cost
of joint attention plus a media tick, which stays inside `budgets.frameMs`; it says nothing
about a headset's GPU and the test's own comment says as much.

### Placement reuses the running systems

`src/gltf-viewer/ARSupport.js` already owns an AR session with a hit-test and a reticle.
B12 reads `viewer.arSupport.reticle.matrix` and creates **no second `XRHitTestSource`** — two
of those on one frame loop is a frame-rate bug and a pair of disagreeing reticles. VR
placement adds the mesh to `viewer.scene` in front of `viewer.camera`, and deliberately does
not parent it to the camera: a screen that follows your head is nauseating and is not a
cinema. Tests assert the file names no `WebGLRenderer`, no `new THREE.Scene`, no
`requestHitTestSource` and no `requestSession`.

The screen is a 60° open-ended cylinder section at 2.4 m, seen from the inside (`BackSide`),
`toneMapped: false` because a screen emits. 16:9 comes out of the arc length rather than a
hardcoded height.

Note the app runs two three.js instances of the same version — `window.THREE` for classic
scripts and the module build for `src/gltf-viewer/` — and `src/PoseGizmoOverlay.js` already
mixes them the same way. B11's indicator and B12's screen follow that precedent.

### Joint attention

Gaze rests on the screen; a jittered glance at the user every 8–20 s, from the profile's
`glanceUserEveryMs` rather than a constant here. `aimQuaternion` is plain arithmetic on
arrays — no three.js — so the maths is testable and produces the same numbers in a test
runner and on a headset. Yaw and pitch are clamped to ±1.2 and ±0.7 rad; past those she is
not glancing, she is possessed.

It writes into the mixer's `head` layer, which B6 built as an always-on masked layer for
exactly this, so the single-write rule holds. `boot.js` runs the activity's `update` **before**
`mixer.update()` — after it, gaze would be one frame stale, which is the lag that makes an
avatar's eyes feel wrong.

### Her silence is the feature

`CommentaryGate` is the single decision point, and it reads `commentaryOpenings` from the
active profile rather than keeping a list of its own — a second copy is a copy that drifts
from the mode that defines it. An opening stays open 2 s. Mid-scene with attention high the
answer is no; while the user is speaking the answer is no even at an opening; with attention
elsewhere she may speak, because then a remark is company rather than an interruption. The
refusal names the rule, so a silence in a log does not read as a bug.

### The cut detector reads pixels, and is gated for it

Luma on a 32×18 draw plus audio RMS, four times a second, in `MediaAdapter` — off the render
path. Reading pixels from a shared tab is a capture code path, so when the source came from a
grant the detector refuses unless that grant is live, and stops in the same tick on revoke. A
local file needs no grant because it is not capture. What it produces is a *scalar*: there is
no `toDataURL`, no `toBlob` and nothing here can hand anybody an image, which is the
distinction that makes reading pixels for a number acceptable where sending them would not be.

A cross-origin source that taints the canvas latches cut detection off after one warning
rather than throwing four times a second — a degraded feature, since the other openings still
work.

---

## 2l. Listen Together (B13)

`src/features/together/activities/music.js`. Zero pre-existing files touched.

### She dances to what the KB chooses

There is no clip id in the file, and a test proves it by loading every id from the manifest
and checking none of them appears in the source. A second test asserts the file contains no
`.request(` at all: the only thing it may do to the scheduler is **stop** it.

What it does instead is emit an `intent` named `dance` and stand back. Tier 1 does the rest —
the selector narrows to the 31 clips that declare that intent, and the ranker picks among
them partly on `1 - |clip.energy - blackboard.energy|`. That is the whole mechanism behind
"grooves in time": the same energy this file pushes onto the blackboard is what makes a loud
track pull an energetic dance and a quiet one pull a sway. No special code, and nothing that
goes stale when the KB is re-harvested. A live test runs the real manifest, selector and
ranker and asserts a clip comes back declaring `dance`.

The ask is emitted **on a beat**, not between beats, so the clip starts with the music rather
than a random distance into a bar. There is a test that the intent's timestamp is one of the
beat timestamps.

### Beat detection

Spectral flux in the bass band against its own rolling history — the standard approach,
standard because a fixed threshold cannot work across tracks. Bins 0–4 at a 1024-point FFT is
roughly everything under 200 Hz, which is where kick drums live; reading the whole spectrum
makes vocals and cymbals into beats. The threshold is `mean × 1.35 + √variance` over about a
second of history, with a 250 ms floor between beats (240 BPM — faster is one kick ringing).

A streak is *consistency*, not repetition: consecutive intervals have to agree within 28%
before they count, so four bangs at random distances is a noisy room rather than a tempo, and
does not start her dancing. BPM is the median of recent intervals, because one dropped beat
doubles an interval and would drag a mean halfway to nonsense.

### Energy climbs here and decays there

`EnergyDrift` pushes and never pulls. It raises `blackboard.energy` toward the smoothed
loudness — fast up (0.35), slow down (0.08), so a chorus lands and a last note does not snap —
and it explicitly refuses to lower it. Decay is the blackboard's own `MOOD_DECAY_TAU`, already
running every frame. Two systems easing the same number gives a rate that is neither, and
nobody can say which one is wrong; the test for this is behavioural rather than a source grep,
because the earlier grep version matched this paragraph.

### Silence never leaves a dance stuck on

Two independent mechanisms, because it is the failure that would be most obvious:

1. **A watchdog**, and it is the fast one. Four beat periods without a beat (never less than
   1.6 s — at 60 BPM a shorter grace would end the dance mid-bar) and the scheduler is
   stopped. It does not wait for anything to decay, and the test asserts the dance ends while
   `blackboard.energy` is still well above rest.
2. **Energy decay**, which handles the quieter half of the same bug: a stale high energy would
   keep pulling energetic clips long after the music stopped.

`media:paused`, `stop()` and the watchdog all go through one `_endDance`, so there is one way
a dance ends rather than three, and it goes through the scheduler because `AnimationResolver`
owns the rig (§6.6).

There are no timers in the file — `setInterval`, `setTimeout` and `requestAnimationFrame` are
all asserted absent. Everything runs from the render loop, so a backgrounded tab stops
analysing rather than dancing to a track nobody can hear.

### The analyser

`analyserFor(element)` builds one over WebAudio and connects it onward to `destination`. That
last connection is not optional: `createMediaElementSource` *re-routes* the element's audio
into the graph, so omitting it silences the track completely — the classic way a visualiser
ships with no sound. There is a test on the connection order.

---

## 2m. Journeys (B14)

`src/features/together/activities/scene-journey.js` plus three §6.11 manifests in
`src/features/together/scenes/`. Zero pre-existing files touched.

### Nothing is undone; everything is restored

Ten enter/exit cycles is the acceptance, and the way to fail it is an `exit` that reverses
each thing `enter` did — that drifts the moment somebody adds a field and forgets its undo,
and it fails silently for nine cycles. So `enter` snapshots every value it is about to
overwrite and `exit` writes the snapshot back verbatim, which is `ModeManager`'s approach one
level down (its header already said B14 would stack this way).

Two properties make the cycles safe, and both have their own test:

* the base profile is **never mutated** — an overlay produces a *derived* object, fresh each
  time, so overlays cannot compound;
* `exit` restores the original profile **by reference**, and the test asserts `toBe`, not
  `toEqual`. Restoring an equal copy passes a deep-equality check and is exactly how this bug
  hides. Mutating the restore to `{ ...snapshot.mode }` fails four tests.

There is also a guard test that `enter` really changes things, because a revert test passes
trivially if nothing was applied.

`initiative` merges field by field so a scene that only changes the budget does not drop
`minGapMs`; everything else replaces, because a scene's `commentaryOpenings` is a complete
statement — meditation's empty list means "nothing", not "the defaults". The derived profile
keeps `allows()`, which §6.5 calls; a spread that lost it would open a gate silently, so
there is a test for that too.

### Anchors, and the closed vocabulary

§6.11 spells an opening `anchor:waves`, but the bus vocabulary is closed on purpose — an
unknown event name is a typo, not a feature. So anchors travel as one new typed event,
`scene:anchor`, carrying a name, and `CommentaryGate` matches on the payload. The vocabulary
stays checkable and the manifests keep the spelling the spec wrote. A test asserts no
`anchor:*` event was added to `EventBus`.

### Meditation

The overlay sets `initiative.budgetPerSession: 0` and `commentaryOpenings: []`. The gate now
reads the budget: zero means refuse, **including at an opening and including when attention
is elsewhere** — that last case is the one that lets her speak mid-scene everywhere else, so
without the budget rule the mute would have a hole in it. The negative test fires every
opening the other scenes honour, ten times over, and requires every verdict to be `false`.

The guided script is the exception, and deliberately not routed through Tier 1: a line the
manifest promised at a fixed time must not be declinable by a cooldown or a gate. Its intents
carry `source: 'scene'` — not `'user'`, so §6.5's NSFW gate still holds against them.

### The art is not in the repository

The 8K KTX2 skyboxes and ambient `.ogg` loops are licensed assets and an art-direction
decision, not a code one. Every manifest carries a `fallbackColor`; a scene whose sky will not
load enters anyway in that colour, and the missing-asset path is a first-class tested case
rather than an error branch. `scenes/README.md` says where to drop the files.

`enter()` does every behavioural change **synchronously** and only the sky asynchronously — an
8K texture must not hold up the first line of a guided meditation or leave `scene:enter`
unannounced for two seconds. The returned promise settles when the sky does, for a caller who
wants to await the whole thing. An enter epoch (the same trick B11 uses for consent grants)
means a texture that arrives after the user left is disposed rather than painted over the room
they came back to.

**AR keeps the profile and the anchors and skips the sky.** Painting a skybox over passthrough
replaces the room the user is standing in, which is the opposite of what AR is for.

---

## 2n. Screen Insight (B15)

`src/features/together/activities/screen-insight.js`, against HomePilot's
`POST /avatar/vision/insight`. Zero pre-existing files touched on this side.

### On demand by default

§6.13 permits ≤1 fps while explicitly enabled, and this ships with that off. A companion who
reads your screen once a second is a different product from one who looks when you ask, and
the difference is a boolean nobody flipped. `startWatching()` exists and is tested; nothing
calls it, and its interval is floored at 1 s by the pipeline regardless of what a caller asks
for.

### It cannot obtain a frame

The same structural guarantee B11 built, and asserted the same way: no `navigator`, no
`getDisplayMedia`, no `createElement`, no `toDataURL` in the file. A frame comes from a
`CapturePipeline`, a pipeline comes from a grant, a grant comes from the consent machine. The
512 px / q0.7 caps are B11's and are not restated here.

### Consent can go while the model is thinking

The case this batch exists to get right. A round trip takes seconds; the frame was captured
legitimately and then the user stopped sharing. **An insight about a screen you have stopped
sharing is not one you agreed to**, however far along it was — so the answer is dropped on
arrival if the grant that produced the frame is no longer live, nothing is spoken, and
nothing reaches the bus. Mutating that check to always-deliver fails the test by name.

### Whitelist twice

The server checks returned intents against §6.2 (B15 server side, using B10's tag splitter)
and the client checks again on arrival. Belt and braces, as §6.9 intends. Delivered intents
carry `source: 'vision'` — not `'user'`, so §6.5's NSFW gate holds against them like every
other non-user source.

### Consent, as the server sees it

`user_event` `capture:start` / `capture:stop` on the session socket. No new message type:
§6.14 needs the server to know the client's consent state before it will answer an ask, and
"something happened on the client" is exactly what `user_event` already means.

### A note on source-grep tests

Four of these batches have now had a source assertion fail because the file explained in
prose the very thing it was being checked for not doing. `tests/behavior/capture.test.js`
now strips comments first (`codeOf`), and has a vacuity guard on the strip itself — if that
helper stopped working, every source assertion using it would start passing for the wrong
reason.

---

## 2o. QA and the three audits (B19)

```
src/behavior/debug/PickLog.js        the last sixteen decisions, and why
src/behavior/debug/DebugHUD.js       ?behaviorDebug=1
scripts/audit-budgets.mjs            §9's numbers, measured
scripts/audit-privacy.mjs            six promises, checked against the source
docs/QA_CHECKLIST.md                 the third audit — a person, a headset, forty minutes
```

### Two switches, not one

The HUD needs the engine flag *and* `?behaviorDebug=1` (or `behaviorEngine.debug`). Turning
the engine on does not produce a debug overlay, and there is a checklist row for that
specifically. The pick log costs one boolean per pick while off.

Both are asserted to be read-only: `PickLog.js` names no scheduler, mixer, bus or `emit(`;
`DebugHUD.js` names none of those plus no `handleIntent` or `setMood`. A debug facility that
could alter behaviour makes every observation it produces suspect — you would never know
whether the odd gesture was the bug or the logging.

The log records **refusals** as well as picks. "She did nothing" is the hardest behaviour to
debug and the one most worth a reason attached, so `handleIntent` records before its early
return.

### What each audit can and cannot say

**Budgets — measured, not claimed.** The frame cost and Tier-1 latency are pure CPU over the
shipped KB, so Node runs the same code the browser does and the numbers are real: currently
**0.19 ms/frame** against a 2 ms budget and **0.23 ms/pick** against 50 ms, best-of-five.

They are **not Quest measurements**. The audit therefore demands *headroom* rather than
compliance — a measurement must come in under 25% of its budget, because the device is
slower and the margin is the entire point of measuring here. An engine needing 1.9 ms on a
desktop core has already failed. Everything needing the device — texture upload, a real
scene load, sustained framerate with an avatar — is deferred by name to the checklist.

The texture check is **vacuously true and says so**: the scene art is not in the repository
(B14), so there is nothing to be over budget.

**Privacy — signed.** Every one of the six claims is a property of the source rather than of
a device, so a green run here is the whole client-side privacy story, not a proxy for it:
one door to a camera, no store, nothing persisted, an indicator in both surfaces from one
subscription, every documented refusal present, every master flag false. Comments are
stripped before reading source — four assertions in this project have failed because a file
explained the thing it was checked for not doing.

**Visual — a person.** `docs/QA_CHECKLIST.md`, forty rows across eight sections, run on each
avatar in the main set. It names the acceptance criteria the batches were bought on, in the
words a person can check: *no pop at the transition*, *lipsync keeps running*, *she says
nothing*, *nothing is left running*, *she says only the script lines*, *her answer never
arrives*. Section F (consent) may not ship amber — every other section is a judgement about
quality; F is a promise about the user's camera.

### The flip is not in this batch

`behaviorEngine.enabled` is still `false`, and a test asserts it. B19 builds the audits; the
flip is a one-line diff in its own PR with the signed checklist attached — so that if it has
to be reverted at midnight, reverting it is also one line.

---

## 2p. The panel channel (B20)

`src/features/together/panels/PanelRenderer.js`, against HomePilot's
`avatar_director/panels.py`. Zero pre-existing files touched.

### A texture, not DOM

The decision the batch turns on. A DOM panel works in 2D and vanishes in VR — an immersive
session renders its own framebuffer and never sees the page. A canvas texture works in all
three the same way, on the screen B12 already builds, so there is one renderer and one
appearance rather than a web panel and a VR panel that drift apart. A test asserts the file
names no `innerHTML`, `appendChild`, `document.body` or `style.cssText`.

It is also why the renderer is a separate batch from the assistant that uses it: tool
results, coach stats and share cards all land here.

### Legible is arithmetic

"Reads legibly at Quest resolution" is usually answered with a screenshot. Here it is a
number. B12's screen subtends 60°; the canvas spans it at 2048 px, so one canvas pixel is
**1.76 arc-minutes** at the eye, and a font size converts to arc-minutes of cap height
(≈70% of nominal). Twenty arc-minutes is the floor for comfortable reading:

| style | px | arc-min |
|---|---|---|
| title | 64 | 78.8 |
| row | 44 | 54.1 |
| key | 40 | 49.2 |
| meta | 32 | 39.4 |

Every one clears the floor with better than 1.5× headroom, and the tests find the exact size
where legible stops (between 15 and 17 px) — which is what makes it a measurement rather
than a threshold picked to let the current fonts pass.

The canvas resolution is chosen the same way: 2048 across 60° is **34 px/degree**, above a
Quest 3's ~25, so the *headset* is the limit rather than the texture. A test asserts a 512 px
canvas would be the wrong way round.

Note the failure mode is not the intuitive one: a smaller canvas makes each pixel cover
*more* arc, so text gets blockier rather than smaller. The first draft of that test asserted
the opposite and was wrong.

### The size limit lives on one side

The server rejects a payload over `panels.max_kb` (64, matching the client's
`assistant.panelMaxKb`) with its size named in bytes *and* in KB — the two answer different
questions and a sender needs both. **Nothing is truncated**: a shortened agenda is an agenda
with the afternoon missing, drawn as confidently as a complete one, and the user cannot tell
it from a short day.

The client deliberately does **not** re-check. Two ceilings eventually differ, and the one
that can refuse is the server's; a test asserts the renderer names no `panelMaxKb`, `maxKb`,
`byteLength` or `JSON.stringify`. What the renderer does refuse is a *kind* it cannot draw —
a blank screen is the least useful failure a panel can have.

`truncatable()` exists as **advice, not action**: it tells a caller roughly how many rows
would have to go, and changes nothing. A test asserts the caller's own object is byte-identical
afterwards.

### A client without the renderer

`display` is a type the client knows and may be unable to act on, which is a different case
from §6.9's unknown-type rule. It is ignored, counted in `dropped.noRenderer` so an operator
can see the panels are going nowhere, and the session stays open — with a test that every
other message type keeps working alongside it.

---

## 2q. Embodied HomePilot (B21)

`src/features/together/activities/assistant.js`, against HomePilot's
`avatar_director/assistant.py`. Zero pre-existing files touched on the server; on the client,
`boot.js` gains one module and one guarded attach.

The flagship beat of the plan, and it is nearly no code. Every tool already existed —
`hp_personal_plan_day` fetches the day, the seeded calendar servers know the meetings,
`daypilot_bridge` already carries a proposal to an Approval Center. What was missing was
somebody in the room to put the day on a screen, point at it, and say one short sentence.

### One approval path, and it is the one that was already there

The worst mistake available in this plan is a second approval path — an assistant that calls
a calendar API "just for the easy cases" and builds a second door into the same house, with
a different lock, maintained by nobody. So the server module is structurally incapable of
it rather than merely disciplined about it:

* it takes no executor, no client, no session — `compose()`'s parameters are data, and a
  test asserts the names `client`, `executor`, `session`, `http`, `tools`, `run` are not
  among them;
* its output type is `Proposal`, whose only public method is `as_directive()`. A test
  enumerates the callables on it and asserts the list is exactly that;
* a test greps the module for `httpx`, `requests`, `urllib`, `aiohttp`, `subprocess`,
  `socket`, `smtplib`, `googleapiclient`, `msgraph`. Adding `import subprocess` fails it.

The emitted directive is then handed to the bridge's own `_sanitize_directive` in a test, so
a proposal cannot silently fail validation on the far side and vanish between the persona
and the Approval Center — which would look, to the user, exactly like never being asked.

### Two safety namespaces, one door

Conflating them is how a gesture ends up needing approval and a calendar write does not.

| namespace | graded by | levels present |
|---|---|---|
| avatar tools (`play_animation`, `vision_insight`) | `safety.TOOL_SAFETY` | read-only, confirm, autonomous |
| DayPilot capabilities (`calendar.create`, `email.send`) | `daypilot_bridge.CAPABILITIES` | confirm, always |

`gate()` reads both and returns a level; a name in neither is **refused**, not defaulted to
confirm — grading a typo "confirm to be safe" lets it become a real-world action the user
then approves believing they read it. `propose()` refuses anything it grades autonomous:
asking permission to blink is how a user learns to approve without reading.

The capability set is read from the bridge rather than copied, and a test asserts identity
(`is`), because a copy is a second, staler statement of what may be approved.

### One proposal per brief

`MAX_PROPOSALS_PER_BRIEF = 1`. A brief that proposes five things is a to-do list you decline
four times before breakfast. The rest are **deferred, not dropped** — returned on the brief
so a caller can offer them when asked, with a test that `len(proposals) + len(deferred)`
accounts for every candidate, and another that deferred proposals are absent from
`directives()`: not offered means not sent, and a proposal arriving at the Approval Center
that the user was never shown the question for is the same bug in a different direction.

### She points at the panel rather than narrating into space

The UX gate, made into numbers on both sides.

* Server: the spoken summary names at most `SPOKEN_ITEM_LIMIT` (2) items and says how many
  more are on the screen, within `SPEECH_CHAR_BUDGET` (320) characters. A twelve-meeting day
  is two names and "and 10 more on the screen", while the panel carries all twelve.
* Client: the gesture is the client's own reading of its own screen. Only the `display`
  frame is delivered in the end-to-end test; the `point` intent that follows is emitted
  locally, which is what makes it embodiment rather than remote control.

`POINT_INTENT` is `point`, and it is built through `ProtocolHandler.intent()` so it still has
to clear `EMOTE_WHITELIST` — the first draft used `point_at_screen`, which is not in it.

### The client's half is attention, and nothing else

It draws nothing, says nothing, and cannot act.

* **Says nothing**: a test greps the module for `NEXUS_BD_SAY`, `speakText`,
  `speechSynthesis`, `.say(`. Every word of a brief arrives as a `say` frame on the normal
  TTS path, exactly as a chat reply does.
* **Cannot act**, stated the strong way: not "there is no handler" but *there is no frame*.
  A test feeds the session adapter `tool_call`, `proposal`, `approve`, `execute`, `action`
  and `directive` and asserts each comes back `ignored / unknown type` with the session
  still open. A proposal lives in `x_directives` on the chat response and never reaches this
  client at all.
* **Attention** it does own: `activityTarget` goes to `panel` on show and is restored *by
  reference* on close, §6.11's snapshot discipline one level down. It snapshots only when
  nothing is already attended, so a second panel over the first does not capture `panel` as
  the thing to restore and leave her never looking away again. Ten show/close cycles leave
  the value unchanged.
* She points **once** per panel, at `agenda`, `tool_result` and `stats` — the ones she is
  presenting. She looks at `cards` and `share` without pointing: those are the user's own
  things on her screen. After `ATTENTION_MS` (12 s) her attention drifts back to you, and
  the drift is the only thing a tick does.

No new protocol frame, and therefore no new fixture: a brief is `display` + `intent` + `say`,
all three of which B9 and B20 already carry.

---

## 2r. Body-doubling focus (B22)

`src/features/together/activities/focus.js` against HomePilot's `avatar_director/focus.py`.
Touched: `EventBus.js` (one event), `boot.js` (one module, one guarded attach),
`app/ltm.py` (one category), `avatar_director/protocol.py` (one optional constructor
argument). Everything else is new.

Somebody else working in the room, and the cheapest proof that §6.7's "quietly alive"
profile actually works: twenty-five minutes in which she is present, visibly breathing,
occasionally mirroring — and says nothing at all.

### The silence is structural, and it is B12's gate that enforces it

Not this module remembering not to speak. Entering a focus block installs an overlay with
`initiative.budgetPerSession: 0` and an empty `commentaryOpenings`, and `CommentaryGate`
checks the budget **before** openings and before attention, so every path through `may()`
returns false. Meditation's mechanism (§6.11), reused rather than reimplemented — including
`SceneJourney.derive`, so there is one answer to what an overlay does to `initiative`
rather than two.

The acceptance test drives a **real gate through a real twenty-five minutes**: 1500
simulated seconds, three openings fired at every one of them, and `gate.stats.allowed === 0`
at the end. Then it fires the same openings during the break and requires a *yes*, because a
test that only proves silence would also pass on a gate that refuses everything always.

Two independent mechanisms, and they are not equally load-bearing. Restoring the base
`commentaryOpenings` in the overlay does **not** break the twenty-five minutes — with the
budget at zero the gate refuses before it ever consults openings. Removing the overlay
entirely fails the headline test. So the budget is the guarantee and the empty openings list
is defence in depth; a separate test names the budget as the reason, so a change to it
cannot hide behind the other.

The corollary is uncomfortable and correct: **she will not start a block she cannot be quiet
in.** With no overlay function, `start()` refuses with a reason rather than running a focus
session on the ordinary profile — a companion who chats at you for twenty-five minutes is
worse than no feature.

### What she does instead of talking

Mirrors, from signals the engine already produces: `user:idle` → `breathe`, `user:active`
after an idle → `nod_along`. Intent *names* from the protocol whitelist, so the KB picks the
clip and this file names no animation. They are gestures, not speech, and they do not pass
through the gate. One-minute cooldown, because a companion who mirrors every twitch is a
mime — a test twitches sixty times in a minute and expects one mirror. She does not mirror
during a break: the ordinary profile's own idle behaviour has that.

### The streak is memory, not a scoreboard

`focus_streak` rows in `app.ltm`, alongside B16's `interest` rows. Not a table, not a file:
a parallel store is a second place a user's data hides from the delete button they already
have, and a test asserts `forget()` reaches it.

The arithmetic is pure and **takes the date as an argument** — a test greps `focus.py` for
`date.today`, `datetime.now`, `time.time` and `utcnow`, because a function that reads the
clock cannot be asked about a midnight or a gap. Three rules:

| case | effect |
|---|---|
| a second block **today** | `blocks` +1, `days` unchanged |
| a block **the next day** | `days` +1 |
| a block after **a gap** | `days` = 1; `best` is never lowered |

`days` counts days shown up rather than work done, or one frantic afternoon out-ranks a
fortnight of mornings. `is_live` is true on the day itself **and the day after**: at 9am on
Tuesday a Monday streak is alive and about to be continued, and showing a zero every morning
until the first block lands is the opposite of what this batch is for.

Client-side there is no count of record — a test asserts `focus.js` never says `days`. The
client sends one `streak` frame per completed block, at the **boundary** rather than at
`stop`, so a session abandoned mid-break still did the work. The server owns what a streak
means.

### The protocol seam was already there

`streak` has been a client message since B9 and landed in `SessionState.streaks`, which is
session-scoped and gone when the socket closes. B22 adds one optional `streaks=` argument to
`ProtocolHandler`; without it the frame behaves exactly as it did, asserted by a test. The
day comes from the handler's own injectable clock, not `date.today()`, and a store that
raises is logged rather than allowed to cost the client its session.

---

## 2s. Gaming co-host and the excitement heuristic (B23)

`src/behavior/modes/play.profile.js`, `src/features/together/heuristics/ExcitementDetector.js`,
`src/features/together/activities/cohost.js`. Touched: `EventBus.js` (one event), `boot.js`
(three modules, one guarded attach).

The most clippable experience in the product, and it is three files and almost no logic —
everything it needs was built by B7, B11 and B12.

### The reaction tiers finally exist

B7 shipped `play.profile.js` as optional and it was never written, so the tiers the plan
keeps citing were a paragraph in a use case. They are data now:

| tier | body | example | fires while she is watching closely? |
|---|---|---|---|
| `micro` | head and face | a nod on a hit | yes — that is the point of it |
| `medium` | upper body | a gasp-lean on a near-death | no |
| `macro` | whole body | a dance on the win, consoling on the loss | only for a **macro event** |

### A macro event is not the same as a macro tier

The distinction the acceptance criterion turns on, and the reason "except macro events" is a
meaningful exception rather than a hole.

`ExcitementDetector` infers moments from audio and pixels. It cannot tell a win from a total
defeat — both are loud and bright — so its top tier is `surge`, meaning *something big just
happened*, and `surge` is macro **for pacing** but is not a macro event. `win` and `loss`
come only from `mark()`, which is what a real game hook calls. A test asserts no inferred
kind carries `macroEvent`.

So while all she has is a flash detector, she never does a full-body anything while you are
concentrating. She does not do a victory dance because the screen went white.

`mayReact(kind, attention)` is the single place the rule lives — the co-host asks and does
not decide, and a test greps `cohost.js` for `0.8` and `HIGH_ATTENTION =` to keep it that
way. B24's clip engine wants the same moments, and a second consumer with its own copy of
the etiquette is how she ends up dancing in one code path and not the other.

### The detector reads numbers, never pixels

`MediaAdapter.sample()` already produces `{luma, rms, lumaJump, rmsJump}` from a 32×18 draw,
already gated on B11's consent for a shared source. Feeding the detector from those scalars
means there is no second pixel reader to audit and no second place a frame could be retained
— asserted by grepping the file for `drawImage`, `getImageData`, `toDataURL`, `toBlob`,
`getByteFrequencyData`, `getUserMedia`, `getDisplayMedia` and `createElement`.

### Two baselines, because one was not enough

Loudness is compared against a rolling mean over ~4 s: notable means notable *for this game*.
The first draft applied that to audio only and used a bare threshold for the flash — and a
permanently strobing shooter became a permanent nod, once every micro cooldown, forever. A
flash delta needs the same treatment as a loudness level, so both now take the same shape: a
floor so the arithmetic is not measuring noise, and a statistical test against the recent
past. A test drives 400 samples of an unbroken storm and requires the reactions to stop.

A building surge emits **once**, on its first sample. Emitting on each would be three gasps
and a dance, which is a person having a fit.

### Pacing lives in the detector

"Never more than one macro per thirty seconds" is enforced where moments are produced, not in
the co-host — otherwise B24's clip engine would see a storm the reaction path was shielded
from and the two would disagree about what happened. A test greps `cohost.js` for `COOLDOWN`
and requires its absence. Cooldowns are per tier (2 s / 8 s / 30 s), so a nod is not blocked
by a dance, and `mark()` goes through the same door: a game reporting a win twice is one win.

The acceptance test runs five minutes of a hook firing four times a second — the case where
the adaptive baseline cannot save it — and checks every macro's gap against the one before.

---

## 2t. The clip engine and the two distribution loops (B24, B25)

`src/features/clips/ClipRecorder.js`, `ShareCard.js`, `ui/ClipButton.js`. Touched:
`EventBus.js` (two events), `boot.js` (three modules, one guarded attach), and the two audit
scripts, which gained a claim and a budget row.

### The header problem, which is most of B24

`MediaRecorder` with a one-second timeslice does **not** produce thirty interchangeable
one-second files. The first blob carries the WebM EBML header and the initialisation
segment; every blob after it is a bare cluster. Concatenate blobs 6 through 35 and you get
thirty seconds of video that no player on earth will open — a file that is exactly the right
size and completely broken, which is the worst kind of bug to find in a share sheet.

So the header blob is kept outside the ring, never evicted, and prepended to every trim —
unless it is still inside the window, in which case prepending it would duplicate it. Four
lines, and `ChunkRing.headerIsResident` exists because the header is genuinely two things at
different times: for the first thirty-five seconds it is the oldest chunk *and* the
initialisation segment, and after that only the latter. Whoever measures a clip's length has
to know which — counting a prepended header reports a 31-second clip, and skipping a resident
one reported a four-second clip as five, which is how that distinction was found.

### 35 s in the ring, 30 s in the clip

Timeslices are a request, not a guarantee: a browser under load emits a 1400 ms blob and then
a 600 ms one. Five seconds of slack means the trim always has thirty seconds to choose from
rather than twenty-eight and an apology — there is a test that feeds exactly that jitter. A
chunk straddling the boundary is kept whole, so a clip is 30 s ± one chunk: cutting a cluster
in half produces a file that is the right length and unplayable.

The ring is bounded by **time**, not by entry count, so a four-hour session holds the same
memory as a forty-second one, and `stop()` clears it — thirty seconds of the user's living
room must not outlive the thing that was recording it.

### The trim was proven before any UI existed

`ChunkRing` is separate from `Recorder` precisely so the trim could be tested against a
scripted sequence of chunk durations — including the ugly ones — with no browser, no canvas
and no codec, and with no button anywhere in the repository. That ordering is the acceptance
criterion, and it is the only order in which "the saved clip is thirty seconds" is a claim
rather than a hope.

### Immersive XR cannot be captured, and that is documented, not worked around

In an immersive session the frames go to the headset's framebuffer; the page's canvas holds
the mirror view. No API hands a page the composited XR frame, on any platform, by design. So
the mirror view **is** the clip in XR — reported on every clip as `source: 'mirror'`, with a
test that the file names no `XRWebGLLayer`, `getViewerPose`, `readPixels` or `framebuffer`,
because a workaround that does not exist should not be half-attempted.

### Zero network, checked for files nobody has written yet

`scripts/audit-privacy.mjs` gained a seventh claim, `clips-offline`, which **walks the
directory** rather than naming the three files in it today, and fails on `fetch(`,
`XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`, `import(`, `importScripts`,
`axios` and a URL scheme. Planting a `fetch` fails it. The same check runs in Jest as well,
because an audit that only runs in CI is one a developer discovers after pushing.

A save is `createObjectURL`, an anchor with `download`, a click, a remove and a revoke on the
next tick — a live object URL pins the whole clip in memory for the life of the document, tens
of megabytes nothing will read again.

### The per-frame cost

`tick()` is one `drawImage` and two increments. The app's WebGL canvas has
`preserveDrawingBuffer: false` and reads back blank unless copied inside a render frame — the
constraint `CompanionMode` already hit and solved the same way, which is why this is a tick
rather than a timer. A tainted source is warned about once rather than every frame.

`audit-budgets.mjs` gained a `clip-frame` row against its own 1 ms budget (B24's number, not a
share of §9's 2 ms, because a frame that is not being clipped pays none of it). Measured at
**0.0000094 ms** of bookkeeping over 25 000 composites. The blit itself is the browser's cost
and there is no browser in Node, so the row carries a `draws > 0` guard: a recorder that
failed to start ticks in zero time and would otherwise look like the fastest code in the file.

### B25: two loops, and both stop in the adult tier

**Loop one** is the button. One tap saves; the nudge is a `role="status"` div with a timeout,
at most once a minute, triggered only by a **macro event** from B23 — a real win or loss from
a game hook, never the heuristic's `surge`, because a toast every time the screen flashes is
an advert. A test drives ten minutes of wins at one every two seconds and checks every gap.
"Never blocks" is checked as the absence of `await`, `confirm`, `alert`, `showModal` and
`aria-modal`.

**Loop two** is the "she remembered" card: her quote, the topic, the timestamp, a portrait
frame. It renders a **record**, and refuses one without a quote — a generated "she remembered"
would be a fabrication of the user's own relationship with the thing, printed and shareable,
and the fact that it would usually be roughly right makes it worse rather than better. The
portrait is drawn as handed over: no posing, no relighting, and a missing one is a design case
rather than an error branch.

Both tear down when the adult tier is active, and **tear down** means `recorder.stop()` with
the buffer dropped, not a hidden button — hiding it would leave thirty seconds of the session
buffered, which is the single worst artefact this product could hold. `adultActive()` requires
`adultVerified && nsfwAllowed`: either alone is a setting rather than a state, and a user who
ticked a box in settings keeps their clips.

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

1. **`index.html`** — settings markup only. B0 assumed a script-tag app needs a static
   `<script>` registration. **B3 found it does not:** `main.js` injects `boot.js` itself,
   and only when the flag is on, so with the engine off no engine file is fetched, parsed
   or evaluated at all. That is a stronger claim than a tag that loads and does nothing, so
   the seam stayed at one file. What the entry is actually used for is the settings panel:
   B7's engine toggle and B9's session switch and URL field. No engine script tag, ever.
2. **`src/PoseStudioPanel.js`** — the spec's optional "Publish to KB" action (B7); named
   here so the file is on the list before the batch needs it.

The allowlist, as enforced by `scripts/behavior-parity-baseline.mjs` and
`tests/behavior/parity.smoke.test.js`:

```
index.html                        settings toggles (B7, B9, B10) ✅ — no engine script, only flags
src/main.js                       guarded boot + update(dt) (B3) ✅
src/LLMManager.js                 llm:token emit (B4)
js/speech-service.js              tts:start / tts:end (B4)
src/tts/PiperWasmTTSProvider.js   tts:start / tts:end (B4)
src/FaceTracker.js                gaze:* emit, optional hook 5 (B4)
src/xr/MotionContract.js          §6.8 tag paragraph (B4)
src/PoseStudioPanel.js            "Publish to KB" action (B7) ✅
```

`src/main.js` now carries three guarded seams, not two: the boot injection and the per-frame
`update(dt)` from B3, and `NEXUS_BD_SAY` from B9. `tests/behavior/engine-spine.test.js` asserts
the exact count of engine-naming lines in that file, so a fourth seam cannot appear without a
reviewer seeing the number change.

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
| B14 → B19 | Where `TogetherPanel.mount()` is called from — three activities are registered now, so a real picker is worth drawing |
| B14 → B16 | How the server learns the active scene, so §6.12's "hard mutes: meditation scenes" has something to read. The blackboard carries `scene`; `ctx` does not, and adding the field is a shared-fixture change both repos have to make |
| B14 → art | The six skybox and ambient files the manifests name. See `src/features/together/scenes/README.md` |
| B15 | Where the insight endpoint URL comes from when no session URL is configured — today it is derived from `session.url`, so an install with the socket off has no vision either |
| B17 → someone | The standalone `mcp-server/`. Specified in `mcp-server/README.md`, not written: it serves only an install with no HomePilot, and B17's acceptance is met by the Forge-registered server |
| B13 | Where the music analyser is attached from in the running app — `analyserFor()` exists and is tested, but nothing calls it until a track has a source element |
| B12 | Whether the VR screen should sit at a fixed distance or be placed by a controller ray; today it is 2.4 m in front of the camera on entry |
| B16 | Whether a server `say` also lands in the chat transcript, or stays audio-only as it is in B9 |
| B10 → deployment | Whether HomePilot ships a WebRTC media terminus at all; without `aiortc` the server serves transcript mode and refuses `webrtc` offers by name |
| B10 | Who calls `VoiceAdapter.transcript()` in the running app — today the settings button starts listening and SpeechService's own `onresult` owns the text; wiring the two is a one-line hook when the chat path is next opened |
| B9 → B10 | Where the pairing token for `hello.auth` comes from; B9 reads `session.auth` from config and sends whatever is there — the panel collects a URL but no credential yet |
