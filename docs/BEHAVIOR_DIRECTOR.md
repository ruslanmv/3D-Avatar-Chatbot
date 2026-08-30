# Behavior Director & Together Mode — Specification

**This file is the working copy of the specification for this repository.** It is the
document Appendix A's kickoff prompts refer to ("Read docs/BEHAVIOR_DIRECTOR.md fully").

- Execution plan (batches, dependencies, acceptance criteria): `docs/BEHAVIOR_DIRECTOR_BATCHES.md`
- Spec path → real repository path mapping: `docs/PATHMAP.md`
- Server-lane extract: HomePilot `docs/AVATAR_DIRECTOR_BATCHES.md`

The two specification texts below are reproduced verbatim. Where a path in them does not
exist in this repository, PATHMAP records the file that plays that role — the spec text is
never edited to match the repo, the mapping is recorded instead.

---

## Changelog

| Batch | Date | Change |
|---|---|---|
| B3 | 2026-08-30 | Runtime spine: `EventBus`, `ContextBlackboard`, `AnimationRegistry` + fail-soft runtime `validate`, and `boot.js`. One seam — a guarded boot and a guarded `update(dt)` in `src/main.js`; `index.html` proved unnecessary because main.js injects the engine only when the flag is on. Parity harness hardened to see reaches made through the `NEXUS_BD` global. |
| B2 | 2026-08-30 | Content pass: authored lexicon fills description/tags/intents/valence/energy for all 166 records; `bootstrap-lexical-v1` TF-IDF index over an explicit 3641-term vocabulary (`index.f32`, `index.vocab.tsv`, `index.meta.json`); review ledger + `--require-approval` gate; CI raised to `--level semantic`. MiniLM deferred to B5 (no bundler, and `package.json` is not on the §7 allowlist). No app code. |
| B1 | 2026-08-30 | KB harvested from the repo's own records: `kb/schema/animation.schema.json`, `harvest-existing.mjs`, `extract-bvh-stats.mjs`, `extract-vrma-stats.mjs`, `validate-manifest.mjs`, and a 166-record manifest (107 BVH + 44 VRMA + 15 procedural) covering every shipped asset exactly once. Semantic fields left as drafts for B2. No app code. |
| B0 | 2026-08-30 | Spec v1.1 + addendum v1.2 vendored into the repo; names frozen (`src/behavior/**`, `window.NEXUS_BD`, `avatar_director`); §7 allowlist amended (see PATHMAP §4); `config/behavior.config.json` added flags-off; shared protocol fixtures + parity harness landed. No product code. |

---

# Behavior Director & Together Mode — Implementation Spec v1.1

**Repos:**
- Client: `ruslanmv/3D-Avatar-Chatbot` — three.js/VRM avatar app; multi-provider LLM (OpenAI, Claude, Watsonx, Ollama, OllaBridge); Piper WASM TTS; WebXR VR (Quest 2/3, Pico) + passthrough AR; Pose Studio; MediaPipe face/gaze tracking; privacy-first (keys in localStorage).
- Server: `ruslanmv/HomePilot` — local-first AI backend (`:8000`, Python 3.11+, Makefile); Personas with long-term memory; Context Forge gateway (tool servers, MCP, A2A); three-level safety model (read-only / confirm / autonomous). Chat already flows **Avatar → OllaBridge (`:11435`) → HomePilot persona**.

**Design version:** 1.1 (supersedes v1.0; the game Play Mode is demoted to an optional sample — the flagship mode is **Together Mode**).
**Nature of change:** 100% additive / non-destructive in both repos. All new code in new directories, guarded by flags; the exhaustive list of touched existing files is in §7.

---

## 0. How to use this spec with an AI coder (Claude Code)

1. **One phase = one session = one PR.** Phases (§5) are ordered by dependency; do not start P(n+1) before P(n)'s acceptance criteria (AC) pass.
2. **Read §7 first, every session.** The modified-files list there is exhaustive. Any change to an existing file not listed in §7 is a spec violation — stop and flag instead.
3. **Contracts are law.** Schemas, event names, protocol messages, and config keys in §6 are exact. Do not rename, do not invent animation ids or intent names — the whitelist in §6.2 and the manifest in `kb/` are the only sources.
4. **Gates per phase:** `npm test` (client) / `make test` or `pytest` (HomePilot) green; `node kb/scripts/validate-manifest.mjs` green; app boots with `behaviorEngine.enabled=false` behaving byte-for-byte as before (smoke script §8).
5. **Flags default off.** Ship dark. Never flip a default in the same PR that introduces the feature.
6. **When the repo layout differs** from paths assumed here (e.g., the bootstrap file is not `src/main.js`), keep the *role* and adapt the path; record the mapping in `docs/PATHMAP.md` (new file) so later phases stay consistent.

Kickoff prompt template (Appendix A) is provided for each phase.

---

## 1. Goals and principles

The upgrade adds (a) an agentic animation brain — the **Behavior Director** — that selects and plays the right animation (procedural behavior, VRMA clip, BVH clip, saved pose) from context; and (b) **Together Mode** — shared activities (watch, music, screen insight, journeys) with a companion that takes genuine initiative via a **Curiosity Engine**, with heavy compute on HomePilot and a thin client that runs on any phone or standalone VR headset.

1. **Data-driven** — logic never hardcodes animation names; everything is selected from a tagged knowledge base (KB).
2. **Latency-tiered** — Tier 0 reflexes (every frame, client), Tier 1 semantic selector (<50 ms, client worker or HomePilot fallback), Tier 2 orchestration (turn-level, HomePilot). Nothing above Tier 0 ever blocks a frame.
3. **Intent, not clips** — LLM, activities, and server emit semantic intents; the KB resolves concrete clips. Whitelisted, rate-limited.
4. **Additive plugins** — modes and activities are data + plugin files. Adding one = adding files.
5. **Adapter pattern for legacy** — existing managers (LLMManager, SpeechService, face/gaze tracking, VR system) are *wrapped*, never rewritten. Chat keeps flowing through the existing OllaBridge → persona chain; Together Mode adds a parallel realtime session channel, it does not replace chat transport.
6. **Thin client** — client budget ≤2 ms/frame for the whole engine; media as textures, scenes as equirect skyboxes; anything heavier (LLM, ASR, vision, memory, TTS synthesis beyond local Piper) is HomePilot's job.
7. **Kill switches** — client `behaviorEngine.enabled=false` and HomePilot `avatar.enabled=false` make every new code path inert.

---

## 2. Use cases

**UC-1 · Emotional companion chat.** LLM streams reply with inline tags `[[emote:happy 0.8]]`; parser fires the intent mid-stream; Tier-1 picks a clip; the avatar gestures while TTS speaks. ~0 added latency.

**UC-2 · Idle liveliness.** No input for N seconds → base idle + randomized fidget micro-animations, anti-repeat, never a visible loop.

**UC-3 · Spicy gating.** Every Spicy behavior/clip carries `nsfw:true`. Eligible only when the user setting allows it AND the active mode/scene profile allows it. Enforced in exactly one place: the ranker (§6.5).

**UC-4 · Watch Together.** A curved cinema screen appears in VR (or pinned in AR passthrough). Sources: (a) direct media — file/HLS URL → `<video>` → `THREE.VideoTexture` (preferred, smoothest); (b) YouTube/any tab — `getDisplayMedia()` tab capture → same VideoTexture. The avatar sits beside the user in joint attention: gaze on screen, occasional glances at the user, commentary only at openings (pause, detected scene cut via luma/audio delta, user looks at her >1.5 s).

**UC-5 · Music Together.** Audio element + WebAudio `AnalyserNode` → beat/energy onto the blackboard → she genuinely grooves in time using the existing dance/behavior library; energy escalates with the track.

**UC-6 · Screen Insight (second screen).** User shares a screen/tab (same capture pipeline as UC-4). Frames are sent to HomePilot vision **only on demand** ("what do you think of this?") or at ≤1 fps while explicitly enabled. She answers with insight + matching gesture. Visible "sharing" indicator at all times.

**UC-7 · Journeys.** Forest, ocean, romantic meditation space: 8K equirect skybox scenes with ambient audio, gaze anchors, and a scene behavior profile (meditation → initiative≈0, breathing-synced idle, optional guided script; ocean → curious, pointing, commenting). AR variant: avatar in the user's real room via existing passthrough. Phone camera can feed the vision pipeline so "see what I see" works on a walk.

**UC-8 · Curiosity (takes interest in you).** HomePilot keeps a per-user interest graph on top of the existing persona memory. An initiative scheduler spends a per-session budget at polite openings to ask about unfinished threads or share observations. Arrives at the client as a normal `intent` + spoken line.

**UC-9 · External agent control.** Avatar-control tools are registered as a Context Forge tool server (MCP), so any persona/agent — or an external MCP client — can `search_animations` and `play_animation`. Safety level: animation playback = *autonomous*; vision/screen = *confirm* + client opt-in.

**UC-10 · Showcase mode.** A profile that cycles the entire KB with max novelty — demos, retarget QA, exercises all animations.

**UC-11 · Pose Studio interop.** "Save Pose" gains an optional "Publish to KB" action → a `kind:"pose"` KB entry, selectable by the same brain.

---

## 3. Architecture

### 3.1 Three tiers

```
Tier 2  HomePilot: persona LLM · curiosity · vision · MCP tools   (0.5–3 s, turn-level)
Tier 1  Semantic selector: embeddings + utility ranker            (<50 ms, per event)
Tier 0  Reflexes: idle, breathing, look-at, lipsync, mixer        (every frame)
```

### 3.2 Topology

```
┌──────────────────── Thin client (phone / Quest / Pico) ───────────────────┐
│ VRM render + LayerMixer (Tier 0) · Tier-1 worker (optional) · UI panels   │
│ Virtual screen (VideoTexture) · WebXR VR/AR · Piper WASM TTS · MediaPipe  │
└──────┬──────────────────────────────┬─────────────────────────────────────┘
       │ chat (unchanged)             │ NEW realtime session
       ▼                              ▼
  OllaBridge :11435  ──────►  HomePilot :8000
  (persona:* routing)         ├─ /avatar/session   WS  (intents, curiosity, events)
                              ├─ /avatar/rtc       WebRTC (mic ↑, screen/camera frames ↑)
                              ├─ services/avatar/  vision · curiosity · kb_search
                              └─ Context Forge     avatar_control tool server (MCP)
```

### 3.3 What runs where

| Concern | Client | HomePilot |
|---|---|---|
| Rendering, mixer, Tier 0 | ✅ always | — |
| Tier-1 KB search | ✅ MiniLM worker (default) | ✅ `kb_search` fallback for weakest devices |
| Chat LLM, persona memory | — | ✅ (existing, via OllaBridge) |
| ASR (streaming mic) | — | ✅ |
| TTS | ✅ Piper WASM (default, offline) | ✅ optional higher-quality voices |
| Vision (screen/camera) | capture + downsample only | ✅ model inference |
| Curiosity Engine | — | ✅ (extends persona memory) |
| MCP avatar tools | standalone fallback (`mcp-server/`, Node) | ✅ primary (Context Forge tool server) |

---

## 4. File trees

`[gen]` = generated. `(opt)` = optional. Trees are additive; §7 lists the only touched existing files.

### 4A. Client — `3D-Avatar-Chatbot`

```
├─ kb/                                        NEW  Animation knowledge base
│  ├─ animations.manifest.jsonl               NEW  Source of truth: 1 JSON record per clip
│  ├─ schema/animation.schema.json            NEW  JSON Schema (CI + runtime validation)
│  ├─ embeddings/index.f32                    NEW  [gen] Float32 embedding matrix
│  ├─ embeddings/index.meta.json              NEW  [gen] row↔id map, model, dims
│  └─ scripts/
│     ├─ extract-bvh-stats.mjs                NEW  BVH text → duration, rootMotion, energy
│     ├─ draft-descriptions.mjs               NEW  LLM drafts descriptions (human-approved)
│     ├─ build-embeddings.mjs                 NEW  MiniLM (transformers.js) → index.f32
│     └─ validate-manifest.mjs                NEW  Schema + uniqueness + file-exists (CI)
│
├─ src/behavior/                              NEW  The Director (pure JS, framework-agnostic)
│  ├─ boot.js                                 NEW  One-call bootstrap; wires adapters; returns director
│  ├─ BehaviorDirector.js                     NEW  sense→decide→act loop; public API (§6.4)
│  ├─ ContextBlackboard.js                    NEW  mood, energy, mode, timers, flags
│  ├─ EventBus.js                             NEW  Tiny typed pub/sub (no deps)
│  ├─ registry/AnimationRegistry.js           NEW  Manifest load + index by intent/tag/kind
│  ├─ registry/validate.js                    NEW  Runtime schema check (fail-soft, logs)
│  ├─ selector/SemanticSelector.js            NEW  Embed query, cosine top-k over index.f32
│  ├─ selector/UtilityRanker.js               NEW  Scoring + gates (§6.5)
│  ├─ selector/AntiRepeatMemory.js            NEW  Ring buffer of last N picks
│  ├─ selector/embedding.worker.js            NEW  transformers.js MiniLM in a Web Worker
│  ├─ scheduler/Scheduler.js                  NEW  Priority preemption, interruptibility, queue
│  ├─ scheduler/TransitionRules.js            NEW  Fade matrix, exit times, min-play
│  ├─ mixer/LayerMixer.js                     NEW  Layer stack, per-masked-bone slerp
│  ├─ mixer/ClipLayer.js                      NEW  VRMA/BVH via THREE.AnimationMixer
│  ├─ mixer/ProceduralLayer.js                NEW  Wraps EXISTING behavior fns → pose buffer
│  ├─ mixer/PoseLayer.js                      NEW  Saved poses as 1-frame clips
│  ├─ mixer/BoneMasks.js                      NEW  fullBody/upperBody/face/head (VRM humanoid)
│  ├─ adapters/LLMTagAdapter.js               NEW  Streaming [[emote:...]] parser, strips for TTS/UI
│  ├─ adapters/SpeechAdapter.js               NEW  tts:start/end → Talk state, lipsync gate
│  ├─ adapters/IdleAdapter.js                 NEW  Activity timers → user:idle/active
│  ├─ adapters/SentimentFallback.js           NEW  Keyword valence when no tags arrive
│  ├─ adapters/GazeAdapter.js                 NEW  Wraps existing MediaPipe gaze/XR pose → gaze:* events
│  ├─ adapters/MediaAdapter.js                NEW  play/pause/cut/track-beat → conversation beats
│  ├─ adapters/SessionAdapter.js              NEW  WS client to HomePilot /avatar/session (§6.9)
│  └─ modes/ModeManager.js                    NEW  register(profile)/activate(id)/gates
│  └─ modes/companion.profile.js              NEW  Default behavior, formalized
│  └─ modes/together.profile.js               NEW  Joint attention, initiative rules (§6.7)
│  └─ modes/showcase.profile.js               NEW  Max novelty, cycles full KB
│  └─ modes/play.profile.js                   NEW (opt) Sample game mode from v1.0
│
├─ src/features/together/                     NEW  Together Mode (flagship)
│  ├─ TogetherMode.js                         NEW  Activity manager: mount/unmount lifecycle
│  ├─ activities/watch.js                     NEW  Cinema screen, sources, sync, cut detection
│  ├─ activities/music.js                     NEW  Audio + AnalyserNode → beat/energy events
│  ├─ activities/screen-insight.js            NEW  Capture, sampler, on-demand vision asks
│  ├─ activities/scene-journey.js             NEW  Skybox scenes, anchors, scene profiles
│  ├─ capture/CapturePipeline.js              NEW  getDisplayMedia/camera → VideoTexture + frame sampler
│  ├─ scenes/forest.json                      NEW  Scene manifest (§6.11)
│  ├─ scenes/ocean.json                       NEW
│  ├─ scenes/meditation.json                  NEW
│  └─ ui/TogetherPanel.js                     NEW  Activity picker, sharing indicator, consent
│
├─ src/features/playmode/                     NEW (opt) v1.0 game demo, unchanged
├─ mcp-server/                                NEW (opt) Standalone Node MCP fallback (v1.0 §6.9 tools)
├─ config/behavior.config.json                NEW  Flags, weights, whitelist, session, privacy (§6.2)
├─ tests/behavior/                            NEW  registry/ranker/scheduler/tagparser/
│                                                  session-protocol/capture/scene tests
└─ docs/BEHAVIOR_DIRECTOR.md + PATHMAP.md     NEW  This spec + path mapping
```

### 4B. Server — `HomePilot`

```
├─ services/avatar/                           NEW  Python package (FastAPI-style, mounted at /avatar)
│  ├─ __init__.py                             NEW  register(app, config): mounts routes if avatar.enabled
│  ├─ session.py                              NEW  WS /avatar/session — auth, heartbeat, protocol §6.9
│  ├─ rtc.py                                  NEW  /avatar/rtc — WebRTC signaling; mic→ASR; frame intake
│  ├─ vision.py                               NEW  POST /avatar/vision/insight (§6.13); model adapter
│  ├─ curiosity.py                            NEW  Interest graph + initiative scheduler (§6.12)
│  ├─ kb_search.py                            NEW  Server-side Tier-1: embeds query, cosine over KB
│  ├─ kb_store.py                             NEW  Loads/serves kb manifest + index (synced from client repo)
│  └─ safety.py                               NEW  Maps tools → HomePilot safety levels (§6.14)
├─ context_forge/tool_servers/avatar_control/ NEW  MCP tool server: search/get/play/queue/set_mood/scene
│  └─ server.py, manifest.(json|yaml)         NEW  Registered like the 5 built-in tool servers
├─ config: avatar section in existing config  NEW keys only (avatar.enabled=false default, model ids,
│                                              frame limits, retention=0)
└─ tests/avatar/                              NEW  protocol, curiosity scoring, vision mock, safety map
```

Curiosity **extends** the existing persona memory store (new record *types*, same store) — it does not introduce a parallel memory system.

---

## 5. Phases

Client phases P0–P5 are carried from v1.0 (complete here, self-contained). Server and activity phases are new.

### P0 — Knowledge base authoring (no app code)
Tasks: create `kb/schema/animation.schema.json` (§6.1) and `animations.manifest.jsonl`; run `extract-bvh-stats.mjs` on the 11 BVH dances (BVH is plain text: `Frames`, `Frame Time`, root deltas → duration/rootMotion; mean joint angular velocity → energy proxy); run `draft-descriptions.mjs` (LLM drafts `description/tags/valence/energy` from clip name + preview; human approves; description formula = **action + body focus + tempo + emotion**); author entries for the 15 procedural behaviors (Idle, Waiting, Happy, Thinking, Dance, Talk, Sad, Angry, Surprised, Flirt, Tease, Intimate, Sensual Sway, Beckon, Slow Burn — last six `nsfw:true`) and every VRMA clip; `build-embeddings.mjs`; wire `validate-manifest.mjs` into CI.
**AC:** manifest validates; every asset has an entry; embeddings reproducible; script-level test: `search("energetic celebration dance")` returns a BVH dance in top-3.

### P1 — Registry, event bus, blackboard, bootstrap
Tasks: `EventBus`, `ContextBlackboard`, `AnimationRegistry`(+`validate`), `boot.js` stub, `config/behavior.config.json`; add the guarded bootstrap hook in `src/main.js` (§7).
**AC:** flag on → registry loads, logs counts by kind; flag off → zero new code executes (coverage-verified).

### P2 — Signal adapters (sense)
Tasks: `LLMTagAdapter` (parses `[[emote:name intensity]]` from the token stream across chunk boundaries; strips tags before TTS/UI), `SpeechAdapter`, `IdleAdapter`, `SentimentFallback`; add the guarded emit hooks in `LLMManager` and `SpeechService` (§7); extend the persona/system prompt with the tag contract (§6.8).
**AC:** a reply containing `[[emote:happy 0.8]]` produces an `intent` event mid-stream; tags never appear in chat text or TTS audio; malformed tags dropped silently (tests).

### P3 — Tier-1 brain (decide)
Tasks: `embedding.worker.js` (lazy MiniLM via transformers.js, IndexedDB cache), `SemanticSelector`, `UtilityRanker`, `AntiRepeatMemory`.
**AC:** intent → clip id <50 ms warm (perf test); nsfw never selected when gated; same intent twice → different clips (anti-repeat test).

### P4 — Executor (act)
Tasks: `BoneMasks`; `ClipLayer` (VRMA via `@pixiv/three-vrm-animation`, existing BVH retarget path); `ProceduralLayer` — wraps the existing behavior functions **unchanged**, capturing output into a pose buffer only when the engine is on; `PoseLayer`; `LayerMixer` (per-masked-bone quaternion slerp between layer buffers on VRM **normalized** humanoid bones; weights animated by `Scheduler`+`TransitionRules`); `Scheduler` (priority Reaction > Talk > Emote > Idle; respects `interruptible`, min-play, queue). T-pose correction + Natural Pose Style remain the base offset under all layers.
**AC:** Happy(procedural) → BVH dance → VRMA wave crossfades with no pops (visual checklist); lipsync + look-at continue during full-body clips; whole engine <2 ms/frame on reference device.

### P5 — Modes + Together shell + Pose Studio publish
Tasks: `ModeManager`; companion/together/showcase profiles (+optional play); `src/features/together/TogetherMode.js` + `ui/TogetherPanel.js` (activity picker only; activities land in P7–P9); optional "Publish to KB" button in Pose Studio (additive UI hook).
**AC:** mode toggle swaps intent maps and gates; toggling back restores companion exactly; companion regression suite green flag-on and flag-off.

### P6 — HomePilot session gateway + client SessionAdapter + WebRTC
Server: `services/avatar/{__init__,session,rtc}.py` mounted only when `avatar.enabled`; WS auth reuses HomePilot's existing auth/pairing; heartbeat 15 s; protocol §6.9. Mic upstream via WebRTC audio track → existing/added ASR path → persona chat as if typed (marked `source:"voice"`). Frame intake endpoint enforces limits (§6.10) and `retention=0`.
Client: `SessionAdapter` (auto-reconnect, backoff, offline-degrade: engine keeps working locally), config `session.url`.
**AC:** protocol contract tests pass against the real server and against the mock (client repo); pulling the network mid-session degrades gracefully (local Tier-1 continues); zero server code runs when `avatar.enabled=false`.

### P7 — Activities: Watch Together + Music Together
Tasks: `CapturePipeline` (getDisplayMedia **and** direct `<video>` sources → VideoTexture; camera variant for phones); `watch.js` (curved screen mesh placed via existing VR system, AR pin via existing hit-test; positional audio; play/pause/seek UI; scene-cut detector = luma+audio delta threshold; `MediaAdapter` emits `media:*`); `music.js` (AnalyserNode → `media:beat`, energy drift on blackboard). Commentary etiquette per together.profile (§6.7).
**AC:** a local mp4 and a captured YouTube tab both display on the VR screen ≥30 fps at 1080p on Quest-class hardware; avatar comments only at openings (test: no `intent(source:commentary)` while `media:playing` high-attention unless opening event preceded within 2 s); music makes energy climb and dance clips fire on `media:beat` streaks.

### P8 — Vision + Screen Insight (+ camera "see what I see")
Server: `vision.py` — POST `/avatar/vision/insight` (§6.13) with pluggable model adapter (local VLM via existing model runner, or configured API); responses may include suggested intents (whitelist-checked server-side too).
Client: `screen-insight.js` — explicit start/stop, persistent on-screen indicator, on-demand snapshot ("what do you think?") or ≤1 fps while enabled; 512 px JPEG, quality 0.7.
**AC:** insight round-trip ≤3 s on reference hardware; no frame leaves the device without active consent state; indicator visible in 2D and XR; disabling capture cancels in-flight sampling; server stores nothing (retention test).

### P9 — Journeys (scene system)
Tasks: `scene-journey.js` loads scene manifests (§6.11): 8K equirect skybox (KTX2), ambient loop, gaze anchors, scene profile overlay; `forest/ocean/meditation` manifests; meditation includes optional guided script (timed `say`+`intent` list executed via session or local TTS); AR variant skips skybox and keeps profile+anchors.
**AC:** each scene loads <3 s after first cache; scene profile overlays apply and revert cleanly; meditation sets initiative budget 0 (curiosity silent) except script lines; romantic/intimate anchors respect the nsfw gate.

### P10 — Curiosity Engine
Server: `curiosity.py` per §6.12 — interest records as new types in existing persona memory; scoring updates on every chat turn; initiative scheduler subscribed to session context events; output = `intent` + `say` over WS.
**AC:** unit tests for scoring/decay/budget; etiquette gates verified (never during `user:speaking`, `media:playing` high-attention, or meditation); a seeded memory produces a relevant proactive question at the next opening in an integration test.

### P11 — MCP avatar_control tool server (Context Forge)
Server: register `avatar_control` beside the built-in tool servers; tools = `search_animations(query, filters)`, `get_animation(id)`, `play_animation(id, layer?, fade?, loop?)`, `queue_sequence(ids[])`, `set_mood(valence, energy)`, `set_scene(sceneId)`; safety mapping per §6.14; commands route to the user's live session via `session.py` (error if no session). Keep client-repo `mcp-server/` as documented standalone fallback.
**AC:** an MCP client (Claude / MCP Inspector) searches the KB and executes a 3-clip queued sequence on the live avatar; `play_animation` runs at *autonomous* level, vision-related tools require *confirm*; killing the tool server has zero effect on local behavior.

### P12 — QA, performance, privacy, rollout
Tasks: debug HUD (`?behaviorDebug=1`: layer weights, last 5 picks with score breakdown, session state); pick-logging ring buffer; docs; visual QA checklist run on the main avatar set; budgets audit (§9); privacy audit (§10); then flip client flag default; HomePilot `avatar.enabled` stays opt-in.

---

## 6. Contracts and schemas

### 6.1 Manifest record (JSON Schema enforced)

```json
{ "id": "bvh_dance_07", "kind": "bvh",
  "file": "motions/dance_07.bvh",
  "description": "An energetic hip-hop groove: bouncing knees, alternating arm waves, head bobbing on beat. Confident, playful, high energy.",
  "tags": ["dance","hiphop","celebrate"],
  "intents": ["celebrate","happy","party"],
  "valence": 0.9, "energy": 0.9,
  "stats": { "duration": 8.2, "rootMotion": 0.3, "meanJointVel": 1.7 },
  "layer": "fullBody", "loop": true,
  "priority": 4, "interruptible": true,
  "cooldownMs": 20000, "nsfw": false,
  "quality": "experimental", "retarget": "hips offset -4cm on VRM0",
  "source": "mixamo", "license": "standard", "version": 2 }
```
`kind ∈ vrma|bvh|procedural|pose` (procedural uses `behaviorRef` instead of `file`). `layer ∈ fullBody|upperBody|face`. `quality ∈ production|experimental`.

### 6.2 `config/behavior.config.json` (client)

```json
{ "behaviorEngine": { "enabled": false, "debug": false },
  "nsfwAllowed": false,
  "weights": { "semantic": 0.5, "energy": 0.2, "valence": 0.1,
               "quality": 0.1, "novelty": 0.1 },
  "antiRepeatWindow": 5, "topK": 3,
  "emoteWhitelist": ["happy","sad","angry","surprised","thinking","celebrate",
    "dance","wave","flirt","tease","shy","agree","disagree","idle",
    "point","lean_in","nod_along","breathe","console"],
  "emoteRateLimit": { "maxPerReply": 3, "minGapMs": 1500 },
  "session": { "enabled": false, "url": "wss://<homepilot>/avatar/session",
               "tier1Remote": false },
  "capture":  { "maxFps": 1, "frameLongEdgePx": 512, "jpegQuality": 0.7 },
  "budgets":  { "tier1Ms": 50, "frameMs": 2 } }
```
HomePilot config adds an `avatar:` section — `enabled: false`, `vision.model`, `vision.max_image_px: 768`, `frames.retention: 0`, `curiosity.session_budget: 4`.

### 6.3 Event bus contract (client)

| event | payload | producer |
|---|---|---|
| `llm:token` | `{text}` | LLMManager hook |
| `intent` | `{name,intensity,source}` | tag parser · adapters · session · MCP |
| `tts:start` / `tts:end` | `{}` | SpeechService hook |
| `user:idle` / `user:active` | `{ms}` | IdleAdapter |
| `user:speaking` / `user:silent` | `{}` | mic VAD (SessionAdapter) |
| `gaze:user-look-avatar` / `gaze:user-look-away` | `{ms}` | GazeAdapter (MediaPipe / XR pose) |
| `media:playing` / `media:paused` / `media:cut` / `media:beat` | `{...}` | MediaAdapter |
| `scene:enter` / `scene:exit` | `{id}` | scene-journey |
| `vision:insight` | `{text,intents[]}` | SessionAdapter |
| `session:up` / `session:down` | `{}` | SessionAdapter |
| `mode:changed` | `{id}` | ModeManager |
| `anim:started` / `anim:ended` | `{id,layer}` | LayerMixer |

### 6.4 `BehaviorDirector` public API (skeleton)

```js
export class BehaviorDirector {
  constructor({ vrm, bus, config }) { /* bb, registry, selector, ranker,
    scheduler, mixer, modes; bus.on('intent', i => this.handleIntent(i)) */ }
  async init(manifestUrl) { /* registry.load + validate; selector.warmup();
    modes.register(companionProfile).activate('companion') */ }
  handleIntent(intent) {
    const c = this.selector.topK(intent, this.bb);     // semantic (local or remote)
    const pick = this.ranker.best(c, intent, this.bb); // utility + gates
    if (pick) this.scheduler.request(pick, intent);
  }
  update(dt) { this.bb.tick(dt); this.scheduler.tick(dt, this.mixer);
               this.mixer.update(dt); }                // Tier 0
  setMode(id) {} registerMode(profile) {}              // plugins
  say(text) {}                                         // route to TTS pipeline
}
```

### 6.5 `UtilityRanker.score()` — single enforcement point

```js
score(clip, intent, bb) {
  if (clip.nsfw && !(bb.nsfwAllowed && bb.mode.allowNsfw)) return -Infinity;
  if (!bb.mode.allows(clip)) return -Infinity;
  if (Date.now() - this.lastPlayed(clip.id) < clip.cooldownMs) return -Infinity;
  const w = this.weights;
  return w.semantic * intent.similarity(clip)
       + w.energy   * (1 - Math.abs(clip.energy  - bb.energy))
       + w.valence  * (1 - Math.abs(clip.valence - bb.valence))
       + w.quality  * (clip.quality === 'production' ? 1 : 0.4)
       + w.novelty  * this.antiRepeat.novelty(clip.id);
}
// Final pick: softmax-weighted random among topK — variety, not argmax.
```

### 6.6 Mixer notes (the one hard problem)
Existing procedural behaviors write bones directly. Under the engine, `ProceduralLayer` calls the same functions but captures output into a pose buffer; `ClipLayer` samples `THREE.AnimationMixer` into another; `LayerMixer` blends buffers per masked bone with quaternion slerp using scheduler-animated weights. Use `humanoid.getNormalizedBoneNode` so masks/retargets are avatar-independent. Face, lipsync, and look-at are always-on layers with their own masks; look-at target is set by joint attention (screen mesh, gaze anchor, or user camera).

### 6.7 Profiles

```js
// together.profile.js
export default {
  id: 'together', label: 'Together mode',
  adapters: ['gaze','media','session'],
  attention: { primary: 'activityTarget', glanceUserEveryMs: [8000, 20000] },
  commentaryOpenings: ['media:paused','media:cut',
                       'gaze:user-look-avatar>1500','user:silent>12000'],
  initiative: { budgetPerSession: 4, minGapMs: 90000 },
  allowNsfw: 'inherit',            // user setting decides; scenes may narrow
  idleProfile: 'relaxed-attentive'
};
// Scene manifests overlay fields onto the active profile (§6.11) and revert on scene:exit.
```
`play.profile.js` (optional sample) keeps the v1.0 reaction tiers.

### 6.8 LLM tag contract (appended to persona/system prompt)

```
When emotionally relevant, append at most one tag per sentence, max 3 per
reply: [[emote:<name> <intensity 0..1>]]
Allowed names: happy, sad, angry, surprised, thinking, celebrate, dance,
wave, flirt, tease, shy, agree, disagree, idle, point, lean_in, nod_along,
console. Never invent names. Tags are invisible to the user and stripped
before TTS.
```
Parser: unknown name or rate limit exceeded → drop tag, keep text. `SentimentFallback` covers models that ignore the contract. Server-initiated intents (curiosity, vision, MCP) arrive over the session channel and pass the same whitelist + ranker gates — no special powers.

### 6.9 Session protocol — WS `/avatar/session` (JSON lines, `v:1`)

Client → server:
```json
{"v":1,"type":"hello","client":"3dac","caps":["tier1local","xr","capture"],"auth":"<token|pairing>"}
{"v":1,"type":"ctx","mode":"together","activity":"watch","attention":0.8}
{"v":1,"type":"user_event","name":"media:paused"}
{"v":1,"type":"vision_ask","prompt":"what do you think of this?","frameId":"f123"}
{"v":1,"type":"chat_meta","msgId":"...","source":"voice"}
{"v":1,"type":"pong"}
```
Server → client:
```json
{"v":1,"type":"intent","name":"lean_in","intensity":0.6,"source":"curiosity"}
{"v":1,"type":"say","text":"You mentioned the aquarium trip — how was it?","source":"curiosity"}
{"v":1,"type":"vision_insight","frameId":"f123","text":"...","intents":[{"name":"thinking","intensity":0.5}]}
{"v":1,"type":"scene","id":"ocean"}
{"v":1,"type":"error","code":"...","msg":"..."}
{"v":1,"type":"ping"}
```
Rules: heartbeat 15 s, reconnect with exponential backoff (max 30 s); unknown `type` ignored (forward-compatible); all server intents pass client whitelist + ranker; `say` routes through the normal TTS pipeline so `tts:*` events and Talk behavior fire as usual.

### 6.10 WebRTC media plan
One `RTCPeerConnection` per session, signaled over the WS. Tracks: mic audio upstream (opt-in, VAD gates `user:speaking`); screen/camera video upstream **only** while consent state active — and even then the server samples at most `capture.maxFps`; client additionally sends discrete snapshots (`vision_ask` + JPEG data channel message ≤512 px long edge) for on-demand asks, which is the default mode. No downstream video. TTS audio may come as data-channel chunks when server voices are enabled; otherwise client Piper synthesizes locally from `say`.

### 6.11 Scene manifest schema + examples

```json
{ "id": "ocean", "title": "By the sea",
  "skybox": "scenes/ocean_8k.ktx2", "ambient": "scenes/ocean_loop.ogg",
  "lighting": { "exposure": 1.1, "hemi": "#bfd8e6" },
  "anchors": [ { "name": "waves", "dir": [0.2,-0.05,-1] },
               { "name": "horizon", "dir": [0,0.05,-1] } ],
  "avatarPlacement": { "pos": [0.6,0,-0.4], "faceUser": true },
  "profileOverlay": { "idleProfile": "curious-outdoor",
    "commentaryOpenings": ["anchor:waves","user:silent>10000"],
    "initiative": { "budgetPerSession": 6 } },
  "guidedScript": null }
```
`meditation.json`: `profileOverlay.initiative.budgetPerSession: 0`, `idleProfile:"breath-sync"`, optional `guidedScript:[{"t":0,"say":"...","intent":"breathe"},...]`. `forest.json`: calm-curious overlay. Romantic anchors/lines carry `nsfw:true` and ride the same gate.

### 6.12 Curiosity Engine spec (HomePilot)

Interest record (stored as a new type in the existing persona memory):
```json
{ "type": "interest", "topic": "user.hobby.aquarium",
  "summary": "Planning a visit to the new aquarium",
  "curiosity": 0.72, "lastTouched": "2026-08-28T18:20:00Z",
  "openThread": true, "sourceMsgIds": ["..."] }
```
Scoring per chat turn: `curiosity += 0.15` when the user responds to the topic with length above their median and positive valence; `−0.10` on short/negative response; global decay `×0.98`/day; clamp [0,1]; `openThread` set by unresolved questions/plans. Initiative scheduler: on each polite opening event from `ctx`/`user_event` (openings = the active profile's `commentaryOpenings` minus anything during `user:speaking`), if `sessionBudget > 0` and `now − lastInitiative > minGapMs`, pick argmax-curiosity `openThread` record, generate one question/observation via the persona LLM (grounded on `summary`), emit `say` + one whitelisted `intent`, decrement budget. Hard mutes: meditation scenes, `attention ≥ 0.9`, user opt-out flag.

### 6.13 Vision service API (HomePilot)

`POST /avatar/vision/insight` → `{ text, intents:[{name,intensity}] }`
Body: `{ image_b64, prompt, ctx:{activity,scene,lastUserMsg} }`.
Rules: max input 768 px long edge (server re-checks), model via config (local VLM through HomePilot's model runner, or configured API), **no persistence** (`frames.retention:0` enforced + tested), intents whitelist-checked server-side, p95 latency target ≤3 s local.

### 6.14 MCP `avatar_control` tools ↔ safety levels

| tool | HomePilot safety level |
|---|---|
| `search_animations`, `get_animation` | read-only |
| `play_animation`, `queue_sequence`, `set_mood`, `set_scene` | autonomous (low-risk output) |
| anything touching capture/vision | confirm + requires active client consent state |

Bridge invariant: MCP/persona tools speak intents at turn cadence; client Tier-1 resolves; nothing on the frame path.

---

## 7. Non-destructive contract — the ONLY existing files touched

**Client (4 hooks + 1 optional):**
```js
// src/main.js — after managers constructed:
import { bootBehavior } from './behavior/boot.js';
if (appConfig.behaviorEngine?.enabled) app.behavior = await bootBehavior(app); // NEW
// render loop:
app.behavior?.update(dt); // NEW

// src/managers/LLMManager.js — where stream chunks arrive:
this.bus?.emit('llm:token', { text: chunk }); // NEW — no-op when bus absent

// src/managers/SpeechService.js — around playback:
this.bus?.emit('tts:start'); // NEW
this.bus?.emit('tts:end');   // NEW

// SettingsPanel (or equivalent): one "Behavior engine (beta)" toggle
//   + one "Connect HomePilot session" toggle bound to session.enabled.

// OPTIONAL hook 5 — face/gaze tracking module, only if it exposes no event:
this.bus?.emit('gaze:user-look-avatar', { ms }); // NEW, guarded
```

**HomePilot (1 registration + config):**
```python
# app startup (where existing services/routers are mounted):
from services.avatar import register as register_avatar
register_avatar(app, config)   # NEW — mounts nothing when avatar.enabled is false
# + `avatar:` keys in config (new keys only)
# + avatar_control added to the Context Forge tool-server registry (new entry only)
```

**Rollback:** client flag off → emits fire into nothing, no `src/behavior/**` import, byte-for-byte today's app. HomePilot `avatar.enabled=false` → no routes mounted, no tool server registered. Deleting the new directories in either repo is a clean uninstall. Chat via OllaBridge is untouched in all states.

---

## 8. Testing strategy

Client unit: schema validation; ranker math (gates, cooldowns, anti-repeat, overlays); scheduler preemption matrix; streaming tag parser (split-across-chunks, malformed, rate limit); capture sampler (fps/size caps, consent cancel); scene manifest loader. Client integration (headless three.js): intent → `anim:started` within budget; mode/scene overlay idempotency; session mock server (protocol fixtures shared between repos in `tests/fixtures/protocol/*.json`). Server: pytest for protocol, curiosity scoring/decay/budget/etiquette, vision retention=0, safety mapping. E2E smoke script: boot both, pair, run a scripted session (chat with tags → watch → snapshot ask → scene → curiosity prompt), assert event log. Golden rule: companion regression suite passes with flags **on and off**; HomePilot's own test suite untouched and green.

## 9. Performance & device budgets

Client engine (Tier 0 + mixer + adapters): <2 ms/frame on Quest-class hardware. Tier-1 pick <50 ms warm (MiniLM in worker; brute-force cosine over ~200 clips <1 ms); MiniLM ~25 MB lazy + IndexedDB cache; `session.tier1Remote=true` moves selection to `kb_search` for the weakest devices with a keyword fallback offline. Video texture ≤1080p on mobile/XR. Skyboxes 8K equirect as KTX2 (GPU-compressed), <3 s warm load. Frames to vision: ≤512 px JPEG q0.7, ≤1 fps or on-demand. Zero cost anywhere when flags are off.

## 10. Privacy & safety

Screen/camera sharing is per-session opt-in with a persistent visible indicator (2D + XR); frames are ephemeral (server retention 0, tested); mic streaming opt-in with VAD; the existing privacy posture (keys in localStorage, no data collection) is unchanged until the user connects their **own** HomePilot. Spicy content: single gate in the ranker; Together default `allowNsfw:'inherit'`; meditation/guided content stays neutral; Play sample forces off. MCP tools mapped to HomePilot's read-only/confirm/autonomous levels per §6.14. Curiosity respects a user opt-out flag and per-session budget — a companion that takes interest, never one that nags.

## 11. Rollout & PR plan

One branch per phase: `feat/bd-p0-kb` … `feat/bd-p12-rollout` (client) and `feat/avatar-p6-session` … (HomePilot). Conventional commits; each PR updates `docs/BEHAVIOR_DIRECTOR.md` changelog + `PATHMAP.md`. Flag-flip criteria: visual QA checklist green on the main avatar set, budgets audit green, privacy audit green. HomePilot `avatar.enabled` remains opt-in documentation-first.

---

## Appendix A — Claude Code kickoff prompts

Template:
```
Read docs/BEHAVIOR_DIRECTOR.md fully. Implement Phase P<N> exactly as
specified in §5.P<N>, using the contracts in §6 verbatim. You may create
only files listed for this phase in §4; you may modify only files listed
in §7. Do not rename events, config keys, or protocol fields. Definition
of done = the phase's AC plus: npm test green, validate-manifest green,
app byte-identical with behaviorEngine.enabled=false. If a path in the
spec doesn't exist in this repo, find the file playing that role, use it,
and record the mapping in docs/PATHMAP.md.
```
Per-phase first lines: P0 "Author the KB per §5.P0/§6.1; touch no app code." · P4 "The only hard problem is §6.6 — implement pose-buffer blending before anything else." · P6 "Build the mock server + contract tests from tests/fixtures/protocol before the real endpoints." · P8 "Consent state machine first; no capture code path may exist outside it." · P10 "Pure functions for scoring; the scheduler consumes events only."

*End of spec v1.1.*

---

# Addendum v1.2 — UC-12…UC-18, Viral Clip Engine, Adult Tier

**Extends:** `BEHAVIOR_DIRECTOR_SPEC_v1.1.md`. All rules from v1.1 §0 (AI-coder working rules), §6 (contracts), and §7 (non-destructive contract) remain law. This addendum adds sections §12–§17 and phases P13–P15. Nothing here modifies any existing file beyond what §7 already allows; every addition below is a new file, a new config key, a new event, or a new protocol message type (forward-compatible by v1.1 §6.9 "unknown type ignored").

---

## 12. New use cases

### UC-12 · Embodied HomePilot (assistant face)
**Story:** "Good morning" → she greets you, your agenda fades onto the virtual screen, she walks you through it while pointing, and "dim the lights, movie time" executes through her tools with a gesture.
**Reuse:** the persona already owns calendar/email/home-automation via Context Forge; the avatar adds a body. Tool actions keep HomePilot safety levels (act = *confirm* unless the owner sets *autonomous*).
**New:** `activities/assistant.js`; session message `display` (§14.3) renders structured panels (agenda, tool results) onto the virtual screen as a canvas texture; intents used: `point`, `nod_along`, `talk`.
**AC:** scripted e2e — "good morning" produces panel + spoken summary + one *confirm*-level tool call; no tool ever invoked without the persona's safety layer.

### UC-13 · Gaming co-host
**Story:** You play; she watches via the existing capture pipeline and reacts with the Play reaction tiers — micro head-bobs on hits, a gasp-lean on near-deaths, a BVH dance on the clutch win, consoling on defeat. Curiosity remembers your games ("still stuck on that boss?").
**Reuse:** `CapturePipeline` + `play.profile` reaction tiers as an overlay; no game API needed — an excitement heuristic (audio RMS spikes + luma flash deltas) emits synthetic `game:*` events; real hooks can replace it later.
**New:** `activities/cohost.js`, `heuristics/ExcitementDetector.js`.
**AC:** reaction tiers fire correctly from a synthetic event script; no full-body reaction while `attention ≥ 0.8` except macro events; detector never emits >1 macro/30 s (coalescing per v1.0 pacing).

### UC-14 · Coach mode (workout & practice partner)
**Story:** Phone camera watches your squats (MediaPipe Pose), she counts reps aloud, demos the movement from the KB, mirrors your pace, celebrates the final set. Same skeleton = language practice inside a journey scene ("we're at the sea in Spain — solo español"), with vocabulary living in the interest graph.
**Reuse:** MediaPipe already ships in the app (face tracking); Pose is a lazy-loaded optional module at 15–20 fps, and avatar extras (fidgets) pause while it runs to hold the frame budget.
**New:** `activities/coach.js`, `heuristics/RepCounter.js`; KB extension: exercise demo clips tagged `exercise` (new manifest entries, P0 pipeline reused).
**AC:** rep events from a recorded video fixture match ground truth ±1; demo clip selected by exercise intent; total frame cost within §9 budget with Pose active.

### UC-15 · Hands-busy copilot (kitchen, DIY, repairs)
**Story:** Phone propped up, camera feeding the vision pipeline: "does the sauce look right?" → snapshot to your HomePilot → she leans in, points, gives her take; timers and next-step nudges; a wince when it breaks.
**Reuse:** camera variant of `CapturePipeline` + `vision_ask` (v1.1 §6.9/§6.13), consent indicator in phone UI.
**New:** `activities/copilot.js` (checklist state machine + timers via existing alarm/timer UX if present, else internal).
**AC:** camera snapshot round trip ≤3 s; timer flow works hands-free by voice; indicator visible whenever camera consent is active; snapshots on-demand only (no periodic frames in this activity).

### UC-16 · Body-doubling focus sessions
**Story:** "Study with me" → pomodoro cycles; she sits quietly alive, stretches when you stretch, nods when you refocus after drifting (idle/gaze signals), celebrates session end, and remembers your streak tomorrow.
**Reuse:** `IdleAdapter` + `GazeAdapter`; curiosity memory stores streaks.
**New:** `activities/focus.js` (pomodoro state machine + quiet profile overlay: initiative ~0 except block boundaries).
**AC:** full 25/5 cycle scripted test; zero `say` during focus blocks except boundaries; streak record persisted server-side and recalled next session.

### UC-17 · Date night (adult tier) — see §16.
### UC-18 · Intimate wind-down (adult tier) — see §16.

---

## 13. File tree delta

### Client
```
src/features/together/activities/assistant.js     NEW  UC-12
src/features/together/activities/cohost.js        NEW  UC-13
src/features/together/activities/coach.js         NEW  UC-14
src/features/together/activities/copilot.js       NEW  UC-15
src/features/together/activities/focus.js         NEW  UC-16
src/features/together/heuristics/ExcitementDetector.js  NEW
src/features/together/heuristics/RepCounter.js    NEW  (MediaPipe Pose, lazy)
src/features/together/panels/PanelRenderer.js     NEW  display→canvas texture (UC-12)
src/features/clips/ClipRecorder.js                NEW  §15 rolling buffer
src/features/clips/ShareCard.js                   NEW  §15 "she remembered" cards
src/features/clips/ui/ClipButton.js               NEW  one-tap save + suggest toast
src/behavior/modes/adult.profile.js               NEW  §16
src/behavior/ConsentFlow.js                       NEW  §16 check-ins, exits, level state
src/features/together/scenes/sunset.json          NEW  §16 (nsfw-capable anchors)
src/features/together/scenes/candlelit.json       NEW  §16
tests/behavior/{consent,cliprecorder,detectors}.test.js  NEW
```
### HomePilot
```
services/avatar/verification.py                   NEW  adult attestation (§16.2)
services/avatar/redaction.py                      NEW  memory redaction rules (§16.5)
tests/avatar/{verification,redaction,streaks}.py  NEW
```
All additive. The one in-family change: `UtilityRanker.js` (a file this project created in P3, not a legacy file) gains the two adult-source gate lines in §16.4 — permitted because §7 governs *pre-existing* repo files only.

---

## 14. Contract deltas

### 14.1 Config (client `behavior.config.json`, new keys only)
```json
{ "clips":  { "enabled": true, "bufferSec": 30, "suggestOnMacro": true },
  "adult":  { "available": false },
  "coach":  { "poseFps": 15 },
  "assistant": { "panelMaxKb": 64 } }
```
HomePilot config: `avatar.adult.enabled: false`, `avatar.adult.provider: "owner-attest" | "<plugin>"`, `avatar.redaction.enabled: true`.

### 14.2 Event bus (new events)
| event | payload | producer |
|---|---|---|
| `game:*` (synthetic) | `{...}` | ExcitementDetector |
| `coach:rep` / `coach:set_end` | `{count}` | RepCounter |
| `focus:block_start` / `focus:block_end` | `{kind}` | focus.js |
| `clip:saved` | `{file,durSec}` | ClipRecorder |
| `escalation:level` | `{level}` | ConsentFlow |
| `panel:shown` / `panel:closed` | `{kind}` | PanelRenderer |

### 14.3 Session protocol (new message types, `v:1`, ignored by older peers)
```json
S→C {"v":1,"type":"display","kind":"agenda|card|toolresult","data":{...}}
S→C {"v":1,"type":"adult_ack","verified":true,"exp":"2026-12-31"}
C→S {"v":1,"type":"adult_verify_request"}
C→S {"v":1,"type":"streak","activity":"focus","value":4}
```
`adult_ack` is the **only** way `adultVerified` becomes true on the client (never a local setting), is session-scoped, and is re-checked on every reconnect.

---

## 15. Viral Clip Engine

**Mechanism:** `ClipRecorder` keeps a rolling ~35 s buffer: `canvas.captureStream(30)` of the render canvas (2D and the XR mirror view — immersive framebuffers can't be captured directly, the mirror is the documented fallback) mixed with a WebAudio graph (TTS + activity audio; mic only if the user enables it). Implementation: `MediaRecorder` with 1 s timeslices into a ring of chunks; on save, concatenate the last 30 s of chunks into a `.webm` and download locally. **Never auto-uploads.**
**Triggers:** the ClipButton always; plus, when `clips.suggestOnMacro` and a macro moment fires (`game:win`, `coach:set_end`, `anim:started` on a `priority ≥ 4` clip), a small non-blocking toast: "Clip that?"
**Share cards:** `ShareCard.js` renders a PNG (canvas) of a curiosity callback — her quote, timestamp, avatar portrait frame — the "she remembered" loop.
**Hard rules:** disabled in adult mode (§16); indicator while mic is in the mix; nothing persists unless the user taps save.
**AC:** saved webm is 30±1 s and contains avatar + activity composite in 2D; XR path saves the mirror view; toast never appears more than once per 60 s; adult mode → recorder fully torn down (test).

---

## 16. Adult Tier (UC-17 Date night · UC-18 Intimate wind-down)

Professional, consent-first design. Nothing in this tier changes the animation system — it is gating, pacing, and UX around behaviors the app already ships (Flirt, Tease, Intimate, Sensual Sway, Beckon, Slow Burn).

### 16.1 Triple gate (all three required, checked every selection)
1. **`adultVerified`** — server attestation only (§16.2), delivered via `adult_ack`.
2. **`nsfwAllowed`** — the existing user setting.
3. **Active mode/scene `allowNsfw: true`** — only `adult.profile` sets it true by default.

Enforcement stays the v1.1 single point — the ranker — plus the source rule in §16.4.

### 16.2 Verification (`services/avatar/verification.py`)
Self-host default: **owner attestation** — the HomePilot instance owner flips `avatar.adult.enabled` and confirms age on their own server; the server then answers `adult_verify_request` with a signed, expiring `adult_ack`. Distribution builds **must** configure a real verification provider via `avatar.adult.provider` (pluggable interface: `verify(user) -> {verified, exp}`); the owner-attest provider refuses to load when the instance is multi-user. A "click yes" client dialog is never sufficient and must not be implemented. Compliance requirements vary by jurisdiction; the provider hook is where deployments meet their local obligations.

### 16.3 `adult.profile.js`
```js
export default {
  id: 'adult', label: 'Date night / wind-down',
  requires: ['adultVerified', 'nsfwAllowed'],   // ModeManager refuses activation otherwise
  adapters: ['gaze', 'media', 'session'],
  allowNsfw: true,
  proactiveNsfw: false,                         // she NEVER initiates — invariant
  escalation: {
    levels: 4, start: 1,
    advance: 'user-affirmative-or-checkin-yes', // §16.4
    checkInEveryLevel: true,
    perLevelMinMs: 120000,                      // earned, never rushed
    decayToLevel: 1,                            // cools down on inactivity
    softExitWord: 'cozy',                       // configurable; crossfade to warm companion
    hardExit: ['stop', 'exit']                  // immediate mode exit, neutral idle
  },
  intensityCeilingByLevel: {
    1: ['flirt'],
    2: ['flirt', 'tease', 'beckon'],
    3: ['sensual_sway', 'slow_burn'],
    4: ['intimate']
  },
  scenes: ['sunset', 'candlelit'],
  idleProfile: 'warm-attentive',
  initiative: { budgetPerSession: 3 },          // curiosity = relationship talk only (§16.5)
  privacy: { clipEngine: false, telemetry: false }
};
```

### 16.4 Consent mechanics (`ConsentFlow.js` + two ranker lines)
Blackboard gains `escalationLevel`. `ConsentFlow` owns it: level advances only on (a) an explicit user-affirmative to a check-in (`say` question → local yes/no keyword classifier, LLM-confirmed on ambiguity), or (b) unmistakable user initiation — and never before `perLevelMinMs`. Soft-exit word → level 1 + gentle crossfade, no commentary. Hard exit → mode exits to companion, neutral idle, no comment. Ranker additions (in this project's own `UtilityRanker.js`):
```js
if (clip.nsfw && intent.source !== 'user') return -Infinity;          // never proactive
if (clip.nsfw && !bb.mode.tierAllowed(clip, bb.escalationLevel)) return -Infinity;
```
`tierAllowed` maps clip intents/tags against `intensityCeilingByLevel`.

### 16.5 Privacy & memory in adult mode
Clip engine and any telemetry are disabled (profile `privacy`). `redaction.py`: curiosity/memory may store relationship warmth signals (e.g., "enjoyed date night, prefers slow pacing") but **never explicit content details** — a server-side redaction pass on memory writes while `mode==='adult'`, unit-tested with fixtures. Everything runs on the user's own HomePilot; nothing leaves their hardware.

### 16.6 UX arcs
**UC-17 Date night:** sunset/candlelit scene, her music, level starts at 1, warmth escalates only as earned (blackboard escalation meter), curiosity recalls *your* shared history so it feels like a relationship, not a script. **UC-18 Intimate wind-down:** the Slow Burn arc — dimmed scene, slower voice rate, breathing-adjacent idle, check-ins before every escalation, the user controls tempo, and the soft-exit word lands her back as a cozy companion with zero awkwardness.

### 16.7 Invariants (test-enforced)
1. No path sets `adultVerified` client-side.
2. `clip.nsfw` is selectable only when all three gates pass AND `intent.source==='user'` AND the tier ceiling allows it.
3. Curiosity/MCP/vision sources can never trigger nsfw clips (source rule).
4. Recorder torn down in adult mode.
5. Exits (soft and hard) work from any state within one scheduler tick.
6. The avatar and all adult-tier content are adult-presenting only; minors are excluded by verification, not honor.

---

## 17. Phases P13–P15

### P13 — Activities pack (UC-12…UC-16)
Order inside the phase: assistant (needs `display` + PanelRenderer) → cohost (detector) → focus → copilot → coach (heaviest, Pose module). Each sub-activity ships with its AC from §12 plus: mounts/unmounts cleanly via `TogetherMode`, and no activity code loads unless selected (dynamic import).
**Gate:** all §12 ACs; §9 budgets hold with each activity active; flag-off byte-identical.

### P14 — Viral Clip Engine
§15 as specified. **Gate:** §15 ACs; recorder adds <1 ms/frame while buffering; zero network calls from `src/features/clips/**` (static check).

### P15 — Adult Tier
Server first (`verification.py`, `redaction.py`, `adult_ack`), then `ConsentFlow` + profile + ranker lines + scenes.
**Gate:** §16.7 invariants as automated tests; check-in flow e2e with scripted affirmatives/negatives; soft/hard exits from every level; redaction fixtures pass; with `avatar.adult.enabled=false` the mode is invisible in UI and unactivatable via MCP/session (negative tests).

### Appendix A additions (kickoff prompt first lines)
P13: "Implement activities in the order listed in §17; PanelRenderer before assistant; dynamic-import every activity."
P14: "Ring-buffer MediaRecorder with 1 s timeslices; prove the 30 s trim with a test before wiring UI; no network imports."
P15: "Server attestation and the two ranker gate lines come first; write the §16.7 invariant tests before ConsentFlow; nothing in this phase may weaken a v1.1 gate."

*End of addendum v1.2.*
