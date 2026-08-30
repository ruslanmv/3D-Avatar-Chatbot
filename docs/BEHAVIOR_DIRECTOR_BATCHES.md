# Behavior Director & Together Mode — Batch Plan (execution plan for spec v1.1)

**Status:** planning artifact. No product code changes.
**Scope:** `ruslanmv/3D-Avatar-Chatbot` (client), `ruslanmv/HomePilot` (server),
`ruslanmv/ollabridge` + `ruslanmv/ollabridge-cloud` (transport conformance only).
**Source spec:** `BEHAVIOR_DIRECTOR_SPEC_v1.1` §§0–11.
**Rule for every batch below:** additive only. New files in new directories; existing
files receive guarded hooks and nothing else; every path is inert with the flags off.

---

## 0. Why this differs from the spec's phase list

The spec's P0–P12 assume a greenfield layout (`src/main.js` ESM bootstrap, empty
`src/behavior/`, a free `services/avatar/` on the server). The real repos already ship
a large part of this problem solved, so the batches below **re-cut the phases around
what exists**. Five collisions drive every re-cut in this plan:

| # | Reality in the repo | Consequence for the plan |
|---|---|---|
| C1 | `src/BehaviorEngine.js` (586 ln) already exists — an IDLE/LISTENING/THINKING/SPEAKING state machine on `window.NEXUS_BEHAVIOR` | The new engine must namespace as `src/behavior/**` + `window.NEXUS_BD`. "BehaviorEngine" is a taken name; Tier 0 wraps it, never replaces it. |
| C2 | A motion brain already ships in `src/xr/`: `MotionContract` (system-prompt contract), `MotionBlockParser` (```motion fenced plans + `maskStreaming`), `IntentFastPath`, `MotionPolicy`, `MotionExecutor`, `MotionClipMap` (999 ln), `ActionRegistry` | The `[[emote:…]]` channel of §6.8 is a **second, coexisting** channel. The tag parser must chain with `MotionBlockParser.maskStreaming()` so the stream is masked once, not twice. `MotionPolicy` stays the authority on locomotion tiers. |
| C3 | The client is a **script-tag app**: ~100 `<script defer>` tags in `index.html`, IIFE modules on `window.NEXUS_*`, one ESM island (`src/engine-bridge.js` + importmap), no bundler (`npm run build` = no-op) | Spec §7's "`src/main.js` bootstrap hook" maps to *two* seams: a script tag in `index.html` and a guarded boot call. §7 must be amended (B0) — adding a script tag is additive, but it is an existing-file touch the spec did not list. |
| C4 | `backend/app/avatar/` is **taken** (StyleGAN / hybrid avatar image generation, 18 modules); `backend/app/embodiment/{motion_dsl,planner}.py` already emits server-side motion plans | The new server package is `backend/app/avatar_director/`, routes stay `/avatar/session`, `/avatar/rtc`, `/avatar/vision/insight` (path prefix is free; the *package* name is not). Server-emitted motion reuses `embodiment.motion_dsl`, it does not fork it. |
| C5 | Voice, memory and MCP infrastructure exist: `backend/app/voice_call/` (`ws.py`, `barge_in.py`, `turn_stream.py`), `backend/app/ltm.py` ("additive only" by its own golden rule), `backend/app/agentic/` (Context Forge installer/registry) | Mic uplink (B10), curiosity memory (B16) and the MCP tool server (B17) are **integrations**, not new subsystems. This removes roughly a phase of work and all of the duplicate-memory risk in §4B. |

Two more facts shape sequencing: the client ships **107 BVH + 44 VRMA** clips already
mapped by `MotionClipMap` (so the KB is *harvested*, not authored from zero), and
`SpicyGate.js` (`window.NEXUS_SPICY`, age-verified) is the existing NSFW authority
(so §6.5's single gate *reads* it rather than introducing a second flag).

---

## 1. How the batches are cut

**One batch = one session = one PR = one flag-off-safe increment.** Batches are sized
so that a single session can finish code + tests + docs without a context handoff.

Four principles from the entertainment side of the house shape the cut:

1. **Tooling batches and content batches are separate.** Harvesting 151 clips is
   engineering; writing 151 descriptions that make the ranker *feel* right is content
   direction with a human in the loop. Mixing them produces bad clips and bad tools.
2. **Ship dark, demo bright.** Every wave ends with something a stakeholder can watch
   (`?behaviorDebug=1`, showcase mode, a scene). Flags stay off in `main`; the demo is
   a URL parameter, never a default flip.
3. **Consent and silence are features.** The consent state machine lands *before* any
   capture code path exists (B11 before B12/B15), and commentary etiquette is tested as
   a negative assertion — she must be provably quiet when the moment isn't hers.
4. **Budgets are gates, not reports.** The <2 ms/frame and <50 ms Tier-1 numbers are
   asserted in CI from B5 onward, so a regression fails a PR instead of surfacing at QA.

**Definition of done — applies to every batch, no exceptions:**

- `npm test` (client) / `pytest` (HomePilot) green, including the pre-existing suites.
- `node kb/scripts/validate-manifest.mjs` green (from B1 onward).
- Flag-off parity: `behaviorEngine.enabled=false` → the app behaves as today, verified
  by the B0 parity smoke script, not by eyeball.
- Only files listed in the batch are touched; the §7 addendum (B0) is the allowlist.
- `docs/BEHAVIOR_DIRECTOR.md` changelog + `docs/PATHMAP.md` updated in the same PR.
- Rollback = revert the PR or delete the new directory. Nothing else.

---

## 2. Batch list

Twenty batches in five waves. `[C]` client repo, `[S]` HomePilot, `[B]` bridge repos.

### Wave 0 — Ground truth (blocks everything)

---

#### B0 · Path map, §7 addendum, parity harness `[C][S]`
**Branch:** `feat/bd-b0-groundwork` (both repos) · **Depends on:** —
**New:** `docs/PATHMAP.md`, `docs/BEHAVIOR_DIRECTOR.md` (the spec, verbatim, + changelog),
`docs/BEHAVIOR_DIRECTOR_BATCHES.md` (this file), `tests/fixtures/protocol/*.json`
(shared, byte-identical in both repos), `tests/behavior/parity.smoke.test.js`,
`config/behavior.config.json` (flags off, §6.2 keys exactly), `avatar:` config block in
HomePilot (`enabled:false`, `vision.max_image_px:768`, `frames.retention:0`,
`curiosity.session_budget:4`), one additive CI job per repo.
**Touched:** none. **Decisions frozen here:** client namespace `src/behavior/**` +
`window.NEXUS_BD`; server package `backend/app/avatar_director/`; route prefix
`/avatar/*`; the amended §7 allowlist (adds `index.html` script-tag registration).
**AC:** parity harness proves flag-off byte-identical boot; protocol fixtures load in
both repos' test runners; new CI job green; zero product files touched.
**Why first:** every later batch cites the §7 allowlist, and a cross-repo protocol needs
one set of fixtures owned by neither side.

---

### Wave 1 — The knowledge base (client, no app code)

---

#### B1 · KB schema + harvester `[C]`
**Branch:** `feat/bd-b1-kb-harvest` · **Depends on:** B0
**New:** `kb/schema/animation.schema.json` (§6.1 verbatim), `kb/scripts/harvest-existing.mjs`
(**not in the spec — required here**: walks `MotionClipMap`'s tables +
`AnimationPresets` + `addons/vrma-*` + `vendor/animations/` and emits draft records),
`kb/scripts/extract-bvh-stats.mjs`, `kb/scripts/validate-manifest.mjs`,
`kb/animations.manifest.jsonl` (mechanical fields only).
**Touched:** none. **Notes:** honour `MotionClipMap`'s exclusion comment — the eight
Mixamo-origin clips with broken VRM leg orientation land as `quality:"experimental"`
with the retarget note carried into the record, never silently into the pool. Procedural
entries use `behaviorRef` pointing at `AnimationPresets` ids.
**AC:** every shipped asset has exactly one record; ids unique; every `file` resolves on
disk; schema validation wired into CI and red on a hand-broken record.

---

#### B2 · Descriptions, tags, embeddings `[C]`
**Branch:** `feat/bd-b2-kb-embed` · **Depends on:** B1
**New:** `kb/scripts/draft-descriptions.mjs`, `kb/scripts/build-embeddings.mjs`,
`kb/embeddings/index.f32`, `kb/embeddings/index.meta.json`, `tests/behavior/kb-search.test.js`.
**Touched:** `kb/animations.manifest.jsonl` (fills `description/tags/intents/valence/energy/nsfw`).
**Notes:** description formula = *action + body focus + tempo + emotion*; LLM drafts,
**a human approves every line** — this is the file that decides whether she feels right.
NSFW flags mirror the categories `SpicyGate` already gates; no new taxonomy.
**AC:** `search("energetic celebration dance")` returns a dance clip in top-3;
embeddings reproducible from the manifest (rebuild → identical bytes); every `nsfw:true`
record cross-checked against the SpicyGate category list.
**Sizing note:** the only batch with a hard human dependency (~151 descriptions). Run it
in parallel with Wave 2 if review capacity is the bottleneck — B5 is the first batch
that actually needs the vectors.

---

### Wave 2 — Client engine (Tier 0/1). Parallel with Wave 3 after B0.

---

#### B3 · Runtime spine `[C]`
**Branch:** `feat/bd-b3-spine` · **Depends on:** B1 (manifest shape), B0
**New:** `src/behavior/EventBus.js`, `ContextBlackboard.js`, `registry/AnimationRegistry.js`,
`registry/validate.js`, `boot.js`.
**Touched (§7):** `index.html` (script tags, defer, after `AnimationPresets`),
`src/main.js` (guarded `bootBehavior` + `update(dt)` in the render loop).
**AC:** flag on → registry logs counts by kind (`bvh`/`vrma`/`procedural`/`pose`);
flag off → no `src/behavior/**` code executes (coverage-asserted); parity smoke green.

---

#### B4 · Sense adapters `[C]`
**Branch:** `feat/bd-b4-sense` · **Depends on:** B3
**New:** `src/behavior/adapters/{LLMTagAdapter,SpeechAdapter,IdleAdapter,SentimentFallback,GazeAdapter}.js`.
**Touched (§7):** `src/LLMManager.js` (`this.bus?.emit('llm:token')`),
`js/speech-service.js` + `src/tts/PiperWasmTTSProvider.js` (`tts:start`/`tts:end`),
`src/FaceTracker.js` (optional hook 5, guarded), `src/xr/MotionContract.js` (append the
§6.8 tag paragraph as an additive section of the existing contract).
**Notes:** `SentimentFallback` delegates to the existing `EmotionEngine` rather than
carrying a second keyword table. The tag parser runs **after**
`MotionBlockParser.maskStreaming()` in the same pipeline — one masking pass, verified by
a fixture containing both a ```motion block and `[[emote:…]]` tags.
**AC:** `[[emote:happy 0.8]]` fires an `intent` mid-stream; tags never reach chat text or
TTS audio; tags split across chunk boundaries still parse; malformed/unknown/over-rate
tags drop silently; the existing motion-block tests stay green.

---

#### B5 · Tier-1 selector `[C]`
**Branch:** `feat/bd-b5-select` · **Depends on:** B2, B3
**New:** `src/behavior/selector/{SemanticSelector,UtilityRanker,AntiRepeatMemory,embedding.worker}.js`,
plus a keyword-cosine fallback for devices that cannot host the worker.
**Touched:** none. **Notes:** §6.5 is the **single** enforcement point, and its NSFW
clause reads `window.NEXUS_SPICY.isEnabled()` — one gate, existing age verification,
no parallel flag. Final pick is softmax-weighted random over topK (variety), not argmax.
**AC:** intent → clip id <50 ms warm (perf assertion in CI); `nsfw` never selected while
the gate is closed (property test over the whole manifest); same intent twice → different
clips; MiniLM absent → keyword fallback still returns a legal pick.

---

#### B6 · Executor & mixer `[C]` — **the hard batch**
**Branch:** `feat/bd-b6-mixer` · **Depends on:** B5
**New:** `src/behavior/mixer/{BoneMasks,ClipLayer,ProceduralLayer,PoseLayer,LayerMixer}.js`,
`src/behavior/scheduler/{Scheduler,TransitionRules}.js`.
**Touched:** none. **Notes:** §6.6 first, everything else after — pose-buffer blending on
`humanoid.getNormalizedBoneNode`. Reuse, do not reimplement: `ClipAnimationLoader` /
`BVHAnimationLoader` / `VRMAAnimationLoader` for clips, `ProceduralAnimator` captured
into a buffer for procedural, `PoseLibrary`+`PoseApplier` for poses. **Single-owner rule:**
while the engine is on, playback requests route through the existing `AnimationResolver`
so the rig never has two owners; T-pose correction and Natural Pose Style stay the base
offset under all layers.
**AC:** procedural → BVH → VRMA crossfade with no pops (visual checklist, recorded);
lipsync + look-at continue during full-body clips; engine <2 ms/frame on Quest-class
hardware, asserted; existing `motion-*.test.js` suite green flag-on and flag-off.
**Sizing note:** the one batch worth splitting if it runs long — B6a mixer/masks,
B6b scheduler/transitions. Do not merge B6a alone with the flag on.

---

#### B7 · Modes + Pose Studio publish `[C]`
**Branch:** `feat/bd-b7-modes` · **Depends on:** B6
**New:** `src/behavior/modes/{ModeManager,companion.profile,together.profile,showcase.profile}.js`
(+ optional `play.profile.js`), `src/features/together/TogetherMode.js` (lifecycle shell only).
**Touched (§7):** settings panel — one "Behavior engine (beta)" toggle; `PoseStudioPanel.js`
— one additive "Publish to KB" action writing a `kind:"pose"` record.
**AC:** mode toggle swaps intent maps and gates; toggling back restores companion exactly
(idempotency test); showcase mode cycles the full KB; published pose is selectable by the
ranker on next load; companion regression suite green both flag states.
**Demo gate for Wave 2:** showcase mode on the main avatar set, recorded, reviewed.

---

### Wave 3 — Server spine `[S]`. Runs in parallel with Wave 2.

---

#### B8 · Session gateway + mock + contract tests `[S]`
**Branch:** `feat/avatar-b8-session` · **Depends on:** B0
**New:** `backend/app/avatar_director/{__init__,session,safety}.py`, `tests/avatar/test_protocol.py`,
a mock server driven by the B0 fixtures.
**Touched:** `backend/app/main.py` (one guarded `register_avatar(app, config)` beside the
existing ~60 `include_router` calls). **Notes:** build the mock + contract tests *before*
the real endpoints (spec Appendix A). WS auth reuses HomePilot's existing auth/pairing;
heartbeat 15 s; unknown `type` ignored for forward compatibility.
**AC:** every §6.9 message shape round-trips against fixtures; `avatar.enabled=false` →
no route mounted, no import cost (asserted); HomePilot's existing suite untouched and green.

---

#### B9 · Client SessionAdapter `[C]`
**Branch:** `feat/bd-b9-session-client` · **Depends on:** B3 (bus), B8 (fixtures)
**New:** `src/behavior/adapters/SessionAdapter.js`.
**Touched (§7):** settings panel — one "Connect HomePilot session" toggle bound to
`session.enabled`. **Notes:** server-sent intents pass the *client* whitelist and ranker
gates — no special powers; `say` routes through the normal TTS pipeline so `tts:*` and
Talk behaviour fire as usual.
**AC:** contract tests pass against both the mock and the real B8 server; network pulled
mid-session → local Tier-1 keeps working, reconnect backoff caps at 30 s; a server intent
naming a non-whitelisted emote is dropped client-side.

---

#### B10 · Voice uplink (WebRTC + ASR) `[S][C]`
**Branch:** `feat/avatar-b10-rtc` · **Depends on:** B8, B9
**New:** `backend/app/avatar_director/rtc.py` (signalling over the B8 WS).
**Touched:** none beyond B8's registration. **Notes:** this is an **integration batch** —
`voice_call/{ws,barge_in,turn_stream}.py` already owns streaming turns and barge-in; the
mic track feeds that path and lands in persona chat marked `source:"voice"`. Do not build
a second ASR path.
**AC:** mic → ASR → persona reply with `[[emote:…]]` → avatar gestures, end to end;
`user:speaking`/`user:silent` VAD events reach the client bus; opting out of mic leaves
every other channel working.

---

### Wave 4 — Together Mode (the flagship)

---

#### B11 · Consent state machine + capture pipeline + panel `[C]`
**Branch:** `feat/bd-b11-consent-capture` · **Depends on:** B7
**New:** `src/features/together/capture/CapturePipeline.js`,
`src/features/together/ui/TogetherPanel.js`, consent state machine + persistent indicator
(2D **and** XR), `tests/behavior/capture.test.js`.
**Touched:** none. **Notes:** **no capture code path may exist outside the consent
machine** — this is why the batch precedes every consumer. Caps enforced here once:
`maxFps:1`, 512 px long edge, JPEG q0.7.
**AC:** capture cannot start without an active consent state (test asserts the *absence*
of a bypass); indicator visible in 2D and in XR; revoking consent cancels in-flight
sampling within one frame; no frames retained client-side.

---

#### B12 · Watch Together `[C]`
**Branch:** `feat/bd-b12-watch` · **Depends on:** B11
**New:** `src/features/together/activities/watch.js`,
`src/behavior/adapters/MediaAdapter.js`.
**Touched:** none. **Notes:** both sources — direct `<video>` (file/HLS → `VideoTexture`,
the smooth path) and `getDisplayMedia()` tab capture. Screen mesh placed via the existing
`WebXRChatbot` VR system; AR pin via the existing hit-test. Joint attention: gaze on
screen, timed glances at the user; commentary only at §6.7 openings.
**AC:** a local mp4 and a captured tab both render ≥30 fps at 1080p on Quest-class
hardware; **negative assertion** — no `intent(source:commentary)` while `media:playing`
with high attention unless an opening preceded it within 2 s; scene-cut detector fires on
a luma/audio delta fixture.

---

#### B13 · Music Together `[C]`
**Branch:** `feat/bd-b13-music` · **Depends on:** B12 (MediaAdapter)
**New:** `src/features/together/activities/music.js`.
**Touched:** none. **AC:** `AnalyserNode` → `media:beat` on a click-track fixture within
one beat period; blackboard energy climbs with track energy and decays after; a beat
streak fires dance clips from the KB (not a hardcoded name); silence → energy returns to
baseline without a stuck dance.

---

#### B14 · Journeys (scenes) `[C]`
**Branch:** `feat/bd-b14-journeys` · **Depends on:** B7 (profiles), B11
**New:** `src/features/together/activities/scene-journey.js`,
`scenes/{forest,ocean,meditation}.json`, KTX2 skyboxes + ambient loops.
**Touched:** none. **AC:** each scene loads <3 s warm; profile overlay applies on
`scene:enter` and **reverts exactly** on `scene:exit` (idempotency test, run 10×);
meditation sets initiative budget 0 — curiosity provably silent except script lines;
romantic anchors ride the same single NSFW gate; AR variant skips the skybox, keeps
profile + anchors.

---

#### B15 · Vision & Screen Insight `[S][C]`
**Branch:** `feat/avatar-b15-vision` · **Depends on:** B11, B8
**New:** `backend/app/avatar_director/vision.py` (`POST /avatar/vision/insight`, pluggable
model adapter through HomePilot's existing model runner),
`src/features/together/activities/screen-insight.js`, `tests/avatar/test_vision_retention.py`.
**Touched:** none. **AC:** insight round-trip ≤3 s p95 on reference hardware; server
re-checks the 768 px cap and stores **nothing** (retention test inspects disk + logs);
returned intents are whitelist-checked server-side *and* client-side; disabling capture
mid-flight cancels the ask.

---

### Wave 5 — Initiative, ecosystem, rollout

---

#### B16 · Curiosity Engine `[S]`
**Branch:** `feat/avatar-b16-curiosity` · **Depends on:** B8, B9
**New:** `backend/app/avatar_director/curiosity.py`, `tests/avatar/test_curiosity.py`.
**Touched:** none — interest records are **new categories in the existing `ltm.py` store**
(whose own golden rule is additive-only), not a parallel memory.
**Notes:** scoring is pure functions; the scheduler consumes events only. Hard mutes:
`user:speaking`, `attention ≥ 0.9`, meditation scenes, user opt-out.
**AC:** unit tests for scoring/decay/budget/clamping; etiquette gates verified as negative
assertions; a seeded memory produces a relevant proactive question at the next opening in
an integration test; budget exhaustion silences initiative for the session.
**UX gate:** she takes interest, she never nags — a reviewer sits through a 20-minute
session and reports the initiative count and whether any felt intrusive.

---

#### B17 · MCP `avatar_control` tool server `[S][C]`
**Branch:** `feat/avatar-b17-mcp` · **Depends on:** B9 (live session routing)
**New:** `backend/app/avatar_director/tool_servers/avatar_control/{server.py,manifest.json}`
registered through the existing `backend/app/agentic/` Context Forge registry;
`mcp-server/` in the client repo as the documented standalone fallback.
**Touched:** the Context Forge tool-server registry (one new entry).
**AC:** an MCP client searches the KB and executes a 3-clip queued sequence on the live
avatar; safety mapping enforced (`play_animation` autonomous, capture/vision tools
`confirm` + active client consent); no live session → clean error, never a silent drop;
killing the tool server has zero effect on local behaviour.

---

#### B18 · Bridge conformance `[B]`
**Branch:** `feat/bd-b18-bridge-conformance` (both bridge repos) · **Depends on:** B4
**New:** tests only — `tests/` fixtures in `ollabridge` and `ollabridge-cloud` proving the
persona chain preserves what the client now depends on.
**Touched:** none expected. **Notes:** OllaBridge is on the chat path (`:11435` →
persona), so it must pass through `[[emote:…]]` tags and ```motion blocks byte-exact,
must not re-chunk in a way that breaks streaming tag reassembly, and must not truncate the
system prompt now that the §6.8 contract is appended to it. **If a test fails, that is a
finding to escalate, not a licence to change bridge behaviour in this batch.**
**AC:** tag-bearing and motion-block-bearing streams survive both bridges intact; system
prompt length headroom measured and documented; any failure filed with a proposed
additive fix and its own batch.

---

#### B19 · QA, budgets, privacy, rollout `[C][S]`
**Branch:** `feat/bd-b19-rollout` · **Depends on:** all
**New:** debug HUD (`?behaviorDebug=1`: layer weights, last 5 picks with score breakdown,
session state), pick-logging ring buffer, visual QA checklist, budgets audit, privacy audit.
**Touched:** docs. **AC:** visual checklist green across the main avatar set; budgets audit
green (<2 ms/frame, <50 ms Tier-1, ≤1080p textures, <3 s scene loads); privacy audit green
(retention 0 proven, indicators present, opt-outs honoured); **then** — and only then, in
its own PR — the client `behaviorEngine.enabled` default flips. HomePilot `avatar.enabled`
stays opt-in, documentation-first.
**Hard rule:** never flip a default in the same PR that introduces a feature.

---

## 3. Dependency graph and parallel lanes

```
B0 ──┬─► B1 ─► B2 ──────────────┐
     │                          ▼
     ├─► B3 ─► B4 ─────────────► B5 ─► B6 ─► B7 ─┬─► B11 ─┬─► B12 ─► B13
     │         │                                 │        ├─► B14
     │         └─► B18 (bridge, any time ≥B4)    │        └─► B15 ◄─┐
     │                                           │                  │
     └─► B8 ─► B9 ─┬─► B10                       └──────────────────┘
                   ├─► B16
                   └─► B17
                                    all ─► B19 ─► flag flip (separate PR)
```

**Lane A (client engine):** B1 → B2 → B3 → B4 → B5 → B6 → B7
**Lane B (server spine):** B8 → B9 → {B10, B16, B17}
**Lane C (content/QA):** B2 descriptions, scene assets for B14, visual checklists
Lanes A and B are independent after B0 and meet at B9. Two sessions can run them
concurrently; a third can carry Lane C content work throughout.

**Critical path:** B0 → B3 → B4 → B5 → B6 → B7 → B11 → B12 → B19. Everything else has
slack. B6 is the single largest risk on that path.

---

## 4. Risk register

| Risk | Where | Mitigation (built into a batch) |
|---|---|---|
| Two brains fight over the rig | B6 | Single-owner rule: engine requests route through `AnimationResolver`; `motion-*.test.js` must stay green in both flag states |
| Double-masking mangles the stream | B4 | Tag parser chains after `MotionBlockParser.maskStreaming()`; fixture carries both channels |
| Second NSFW flag drifts from `SpicyGate` | B5, B14 | Ranker reads `window.NEXUS_SPICY`; property test sweeps the whole manifest |
| `backend/app/avatar` name collision | B8 | Package is `avatar_director`; route prefix verified free at mount time, `/companion/*` is the documented fallback |
| Parallel memory system | B16 | Interest records are new categories inside `ltm.py`; no new store, no new tables beyond LTM's additive path |
| Duplicate ASR path | B10 | Reuse `voice_call`; the batch is explicitly an integration, and a new ASR path fails review |
| §7 violation by necessity (`index.html`) | B0 | Amend §7 with the script-tag seam *before* B3 needs it, rather than silently touching it |
| Perf regression discovered at QA | B5, B6 | Budgets asserted in CI from B5 onward, not audited at B19 |
| KB descriptions rushed → she feels generic | B2 | Content batch with named human approval; run it in parallel so it is never the thing being hurried |

---

## 5. Suggested cadence

| Wave | Batches | Can run in parallel | Ends with |
|---|---|---|---|
| 0 | B0 | — | Ground truth frozen, parity harness green |
| 1 | B1, B2 | B2 with Wave 2 | A searchable KB over 151 real clips |
| 2 | B3–B7 | with Wave 3 | **Demo:** showcase mode cycling the full KB |
| 3 | B8–B10 | with Wave 2 | **Demo:** speak to her, she answers and gestures |
| 4 | B11–B15 | B13/B14/B15 fan out after B11 | **Demo:** watch a film together in VR |
| 5 | B16–B19 | B16/B17/B18 fan out | **Demo:** she asks about your week, unprompted — then the flag flip |

Each wave-ending demo is the review gate. A wave is not done because its PRs merged; it
is done when the demo runs on the main avatar set with the flag on and the parity smoke
still green with it off.

---

*Companion document to `docs/BEHAVIOR_DIRECTOR.md` (spec v1.1). The server-lane extract
lives in HomePilot at `docs/AVATAR_DIRECTOR_BATCHES.md`.*
