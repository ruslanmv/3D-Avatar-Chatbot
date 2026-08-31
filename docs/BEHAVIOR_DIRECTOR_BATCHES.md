# Behavior Director & Together Mode — Batch Plan (execution plan for spec v1.1 + addendum v1.2)

**Status:** planning artifact. No product code changes.
**Scope:** `ruslanmv/3D-Avatar-Chatbot` (client), `ruslanmv/HomePilot` (server),
`ruslanmv/ollabridge` + `ruslanmv/ollabridge-cloud` (transport conformance only).
**Source specs:** `BEHAVIOR_DIRECTOR_SPEC_v1.1` §§0–11 and
`BEHAVIOR_DIRECTOR_SPEC_v1.2_ADDENDUM` §§12–17 (UC-12…UC-18, clip engine, adult tier).
**Rule for every batch below:** additive only. New files in new directories; existing
files receive guarded hooks and nothing else; every path is inert with the flags off.

---

## 0. The experiences we're building toward

Batches are the *how*. This is the *what* — written from the user's side of the screen,
because every acceptance criterion downstream exists to protect one of these moments.

**The loop that makes all of them the same person:**
**notice → wait for an opening → say one thing with the right gesture → remember it.**
Get that loop right and every activity feels like her, just somewhere new with you. Every
activity batch (B12–B15, B20–B27) is accepted against this loop, not just against its own
feature list.

### Flagship experiences

**Movie night — the VR moment.** You put the headset on and say "let's watch something."
She's already there, and because of curiosity memory she opens with *"you never finished
that space documentary — tonight?"* The screen fades in, the room dims, she settles beside
you. Then the magic is mostly **restraint**: she actually watches — gaze on the screen,
leaning in when the music tenses, throwing you a glance every so often. She says nothing
during the good parts. When *you* pause, that's her opening: one line, one gesture. Look at
her a beat too long and she notices — *"what?"* At the credits she stretches, asks what you
thought, and your answer becomes memory for next week.
→ *Owned by* B12 (screen, joint attention, openings) + B13 (music-driven lean-in) + B16
(the opening line and the memory it leaves). **UX rule: her silence is the feature.**

**Second-screen copilot — the daily driver.** At your desk you tap "share this tab"; a
persistent indicator lights up and she shrinks to a corner of your monitor, idling alive
but quiet. You work. When you ask — *"what do you think of this chart?"* — one snapshot
goes to **your** HomePilot, and two seconds later she leans in, points at the screen, and
gives her take with a thinking-to-talk gesture arc, as if she'd walked over. Nothing
streams when you're not asking; stopping the share kills everything visibly; frames are
never stored.
→ *Owned by* B11 (consent as a glowing light, not a buried setting) + B15 (the insight).
**UX rule: insight arrives embodied — never as a chat toast.**

**Journeys — presence and wind-down.** *"Take me to the sea."* Crossfade to the ocean
skybox, waves in your ears, and she's beside you looking at the horizon — then at *you*
when you speak. She points at the waves, comments once in a while, and in a long
comfortable silence spends one curiosity token: *"you said work was heavy this week —
better today?"* Say "meditation" instead and her whole personality overlay changes:
initiative drops to zero, her idle syncs to a slow breathing rhythm, and she speaks only
the guided script. On a phone outside VR the same journey uses your camera — she sees what
you see on a real walk.
→ *Owned by* B14 + B16. **UX rule: joint attention *is* presence, and each place changes
who she is there.**

### The five usages that make it a product

| Usage | Why it matters | Batch |
|---|---|---|
| **Embodied HomePilot** — she becomes the face of your home | The strategic one. HomePilot's Context Forge already owns calendar, mail and home automation, so let her *be* that interface: "good morning" walks you through the day while she points at the agenda on the VR screen; "dim the lights, movie time" is her gesture, not a menu. No other companion app can do this, because none of them own the agent backend. | B20 · B21 |
| **Gaming co-host** | The single most clippable experience in the product. She watches through the same capture pipeline and the reaction tiers finally shine — micro head-bobs on kills, a gasp-lean on near-deaths, a BVH dance on a clutch win, a consoling line on defeat — and curiosity remembers your games. | B23 |
| **Coach mode** — workout and practice partner | MediaPipe already ships, so the camera counts reps and checks form while *she demos the movement* from the KB, mirrors your pace, and celebrates the last set. Same skeleton = language practice on a journey scene ("solo español"), vocabulary living in the interest graph. | B27 |
| **Hands-busy copilot** — kitchen, DIY, repairs | "See what I see" turned into daily-life utility: phone propped up, she sees your pan or your half-disassembled shelf and answers *"does this look right?"* with a point and an opinion. Timers, next-step nudges, a wince when the sauce breaks. | B26 |
| **Body-doubling focus sessions** | "Study with me" is already a massive content genre; this personalises it. She sits with you — quietly alive, pomodoro cycles, a stretch when you stretch, a nod when you refocus, a real celebration at the end, and a streak she remembers tomorrow. | B22 |

**The viral engine that ties them together.** One tap: *clip the last 30 s* — her reaction
plus your context (game moment, workout PR, cooking fail). Her reactions are the shareable
content, so every user becomes distribution. The second loop is **"she remembered"** share
cards — curiosity callbacks are inherently post-worthy. Ship both loops (B24, B25) and the
co-host, coach and focus usages market themselves. Hard rule: nothing ever auto-uploads,
and the recorder is fully torn down in the adult tier.

**The adult tier, stated plainly.** Two usages (date night, intimate wind-down) behind
three gates — server-side verification, the `nsfwAllowed` setting, and a mode that permits
it — and the privacy story *is* the selling point: it runs on your own HomePilot and
nothing leaves your hardware. Escalation is earned and reversible, the gate is enforced in
exactly one place, minors are excluded by verification rather than honour, and **she never
initiates — only reciprocates.** Batches B28–B29, and they are the last thing built, not
the first. → §7.

---

## 1. Why this differs from the spec's phase list

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

**The addendum's heaviest assumptions checked out — four of them are already paid for:**

| # | Reality in the repo | Consequence for the addendum batches |
|---|---|---|
| C6 | MediaPipe **tasks-vision 0.10.14** is already lazy-loaded from CDN by `FaceTracker.js` *and* `HandTracker.js` | UC-14's Pose is a third task on an **existing** loader, not a new dependency or a new vendor bundle. B27 adds `PoseLandmarker` beside them and reuses their lazy-load + fps-throttle pattern. |
| C7 | `backend/app/daypilot_bridge/` implements **propose-only** tool mode: the persona proposes structured operations in `x_directives`, and an Approval Center gates every external write | UC-12's "act = *confirm* unless the owner sets autonomous" is this contract, already built and frozen. B21 renders proposals as panels and confirms through it — it must not invent a second tool-approval path. |
| C8 | `agentic/integrations/mcp/personal_assistant_server.py` exposes `hp_personal_plan_day`; the Forge seed catalog ships `hp-google-calendar` and Microsoft Graph (mail + calendar) servers | UC-12's agenda has a real source on day one. B21 is a *presentation* batch over existing tools, which is why it is small enough to precede the heavier activities. |
| C9 | `MediaRecorder` is already used in `CompanionMode.js` and `js/speech-service.js`; `ltm.py` upserts on `(project_id, category, key)` | §15's ring buffer has in-repo precedent to copy rather than invent, and focus streaks (UC-16) are one more LTM **category** — same additive path as curiosity records. |

One assumption did **not** check out: the v1.0 Play-mode reaction tiers do not exist in the
client yet. `play.profile.js` is marked optional in B7 — the gaming co-host (B23) is the
batch that needs it, so **B23 promotes it from optional to required** and inherits the cost.

---

## 2. How the batches are cut

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
5. **One flag per activity, so shipping never becomes a big bang.** The core engine flips
   once (B19). Every activity after it carries its own flag and its own dynamic import, so
   the co-host can ship the week it is ready without waiting for coach mode — and can be
   turned off alone if it misbehaves in the wild.

**Definition of done — applies to every batch, no exceptions:**

- `npm test` (client) / `pytest` (HomePilot) green, including the pre-existing suites.
- `node kb/scripts/validate-manifest.mjs` green (from B1 onward).
- Flag-off parity: `behaviorEngine.enabled=false` → the app behaves as today, verified
  by the B0 parity smoke script, not by eyeball.
- Only files listed in the batch are touched; the §7 addendum (B0) is the allowlist.
- `docs/BEHAVIOR_DIRECTOR.md` changelog + `docs/PATHMAP.md` updated in the same PR.
- Rollback = revert the PR or delete the new directory. Nothing else.

---

## 3. Batch list

Thirty batches in ten waves. `[C]` client repo, `[S]` HomePilot, `[B]` bridge repos.
Waves 0–5 deliver spec v1.1 and end in the flag flip; waves 6–9 deliver addendum v1.2
and ship *after* it, each behind its own activity flag — see the note on B19.

### Wave 0 — Ground truth (blocks everything)

---

#### B0 · Path map, §7 addendum, parity harness `[C][S]` — ✅ landed
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
**Landed as:** client — `docs/PATHMAP.md`, `docs/BEHAVIOR_DIRECTOR.md` (both specs +
changelog), `config/behavior.config.json`, `tests/fixtures/protocol/` (17 fixtures +
`CHECKSUMS.txt`), `scripts/behavior-parity-baseline.mjs`, `tests/behavior/`,
`.github/workflows/behavior-director.yml`. Server — `backend/app/avatar_director/config.py`
(`AVATAR_*` env keys), `backend/tests/{avatar,fixtures/protocol}/`, `docs/PATHMAP.md`,
`.github/workflows/avatar-director.yml`. 47 suites / 1237 tests green on the client and 18
on the server, format and lint clean, **zero pre-existing files touched in either repo**.
Parity is asserted as *inertness* rather than as file hashes — nothing in the engine
namespace is loaded, imported or named outside the allowlist, and there only next to the
flag guard — because hashing product files would pass once and then fail on unrelated
work. A test plants a stray reference and requires the harness to fail, so the detector is
not vacuous.

---

### Wave 1 — The knowledge base (client, no app code)

---

#### B1 · KB schema + harvester `[C]` — ✅ landed
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
**Landed as:** `kb/schema/animation.schema.json`, `kb/scripts/{harvest-existing,
extract-bvh-stats,extract-vrma-stats,validate-manifest}.mjs`,
`kb/animations.manifest.jsonl` (166 records — 107 bvh + 44 vrma + 15 procedural, every
shipped asset covered exactly once), `kb/harvest-report.json`,
`tests/behavior/kb-manifest.test.js`, plus two CI steps. 48 suites / 1257 tests green.
The gate is proven non-vacuous: seven ways a record can be wrong are broken on purpose
against a copy of the manifest and each must fail. Two findings worth carrying forward —
`MotionClipMap` cannot be `require`d (ESM under `type: module` makes its `module.exports`
a no-op, and the first pass harvested an empty table without complaining), and **81 of the
151 shipped assets are reachable by nothing today**, which is the clearest statement of
what the KB is for.

---

#### B2 · Descriptions, tags, embeddings `[C]` — ✅ landed (drafts written, human review still open)
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
**Landed as:** `kb/scripts/{draft-descriptions,build-embeddings}.mjs`,
`kb/embeddings/{index.f32,index.vocab.tsv,index.meta.json}`,
`kb/descriptions.approved.json`, `tests/behavior/kb-search.test.js`; CI raised to
`--level semantic`. 49 suites / 1274 tests green. All 166 records carry real content and
`search("energetic celebration dance")` returns a dance at rank 3.
**The human dependency is real and still open:** the drafts are machine-written, the
ledger records that nothing is approved, and `--require-approval` is the gate a reviewer
flips — CI deliberately does not run it yet.
**Two findings for later batches:** hashing was the wrong vectoriser at this corpus size
(collisions made unmatched query words score, so *"sit down quietly"* returned a jump);
and the B1 harvester blanked B2's content until re-harvest was made content-preserving —
any batch that regenerates a shared artefact needs the same care.

---

### Wave 2 — Client engine (Tier 0/1). Parallel with Wave 3 after B0.

---

#### B3 · Runtime spine `[C]` — ✅ landed
**Branch:** `feat/bd-b3-spine` · **Depends on:** B1 (manifest shape), B0
**New:** `src/behavior/EventBus.js`, `ContextBlackboard.js`, `registry/AnimationRegistry.js`,
`registry/validate.js`, `boot.js`.
**Touched (§7):** `index.html` (script tags, defer, after `AnimationPresets`),
`src/main.js` (guarded `bootBehavior` + `update(dt)` in the render loop).
**AC:** flag on → registry logs counts by kind (`bvh`/`vrma`/`procedural`/`pose`);
flag off → no `src/behavior/**` code executes (coverage-asserted); parity smoke green.

---

#### B4 · Sense adapters `[C]` — ✅ landed
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

#### B5 · Tier-1 selector `[C]` — ✅ landed
**Branch:** `feat/bd-b5-select` · **Depends on:** B2, B3
**New:** `src/behavior/selector/{SemanticSelector,UtilityRanker,AntiRepeatMemory,embedding.worker}.js`,
plus a keyword-cosine fallback for devices that cannot host the worker.
**Touched:** none. **Notes:** §6.5 is the **single** enforcement point, and its NSFW
clause reads `window.NEXUS_SPICY.isEnabled()` — one gate, existing age verification,
no parallel flag. Final pick is softmax-weighted random over topK (variety), not argmax.
**AC:** intent → clip id <50 ms warm (perf assertion in CI); `nsfw` never selected while
the gate is closed (property test over the whole manifest); same intent twice → different
clips; MiniLM absent → keyword fallback still returns a legal pick.
**Forward-compat for B28 (do it here, it costs nothing now):** carry `intent.source`
through scoring and read `bb.escalationLevel` as an optional blackboard field. The adult
tier's two gate lines then *append* to this function instead of refactoring it — which is
the difference between an additive batch and a rewrite of the one file that enforces
every gate.

---

#### B6 · Executor & mixer `[C]` — **the hard batch** — ✅ landed
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

#### B7 · Modes + Pose Studio publish `[C]` — ✅ landed
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

#### B8 · Session gateway + mock + contract tests `[S]` — ✅ landed
**Branch:** `feat/avatar-b8-session` · **Depends on:** B0
**New:** `backend/app/avatar_director/{__init__,session,safety}.py`, `tests/avatar/test_protocol.py`,
a mock server driven by the B0 fixtures.
**Touched:** `backend/app/main.py` (one guarded `register_avatar(app, config)` beside the
existing ~60 `include_router` calls). **Notes:** build the mock + contract tests *before*
the real endpoints (spec Appendix A). WS auth reuses HomePilot's existing auth/pairing;
heartbeat 15 s; unknown `type` ignored for forward compatibility.
**AC:** every §6.9 message shape round-trips against fixtures; `avatar.enabled=false` →
no route mounted, no import cost (asserted); HomePilot's existing suite untouched and green.
**Forward-compat:** the "unknown `type` ignored" rule is what lets addendum v1.2 add
`display`, `adult_ack`, `adult_verify_request` and `streak` later without a version bump —
so it needs a test that an unknown type is ignored *silently*, not just tolerated.

---

#### B9 · Client SessionAdapter `[C]` — ✅ landed
**Branch:** `feat/bd-b9-session-client` · **Depends on:** B3 (bus), B8 (fixtures)
**New:** `src/behavior/adapters/SessionAdapter.js`.
**Touched (§7):** settings panel — one "Connect HomePilot session" toggle bound to
`session.enabled`. **Notes:** server-sent intents pass the *client* whitelist and ranker
gates — no special powers; `say` routes through the normal TTS pipeline so `tts:*` and
Talk behaviour fire as usual.
**AC:** contract tests pass against both the mock and the real B8 server; network pulled
mid-session → local Tier-1 keeps working, reconnect backoff caps at 30 s; a server intent
naming a non-whitelisted emote is dropped client-side.
**As landed:** the §7 touch turned out to be two, not one — the settings switch as planned,
plus a third guarded line in `src/main.js` publishing `NEXUS_BD_SAY`, because `speakText` is
module-local and `say` had no other route to the app's own speech path. Two disconnect shapes
are handled rather than one: a clean close, and a socket stranded by a pulled cable, which
never fires `onclose` and is caught instead by the server's heartbeat going quiet.

---

#### B10 · Voice uplink (WebRTC + ASR) `[S][C]` — ✅ landed
**Branch:** `feat/avatar-b10-rtc` · **Depends on:** B8, B9
**New:** `backend/app/avatar_director/rtc.py` (signalling over the B8 WS).
**Touched:** none beyond B8's registration. **Notes:** this is an **integration batch** —
`voice_call/{ws,barge_in,turn_stream}.py` already owns streaming turns and barge-in; the
mic track feeds that path and lands in persona chat marked `source:"voice"`. Do not build
a second ASR path.
**AC:** mic → ASR → persona reply with `[[emote:…]]` → avatar gestures, end to end;
`user:speaking`/`user:silent` VAD events reach the client bus; opting out of mic leaves
every other channel working.
**As landed:** the ASR is the browser's, and that is the integration rather than a shortcut —
`js/speech-service.js` already runs Web Speech with a MediaRecorder fallback for Quest, and
`voice_call` was already built to take a final transcript from a client. Server-side media
termination is a second, optional mode: `rtc.py` negotiates it, and refuses it by name unless
a terminus is installed, because `aiortc` is a deployment's decision and not a batch's. The
server strips `[[emote:…]]` out of the reply before sending it, since a `say` goes to
`speakText` and an unstripped tag is read aloud. The §7 touch is one button in the settings
panel — the only caller of `enableVoice()`, because a microphone is asked for by a person.

---

### Wave 4 — Together Mode (the flagship)

---

#### B11 · Consent state machine + capture pipeline + panel `[C]` — ✅ landed
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
**Forward-compat:** four later batches (B15, B23, B26, B27) are consumers of this one
machine. Build it with a source enum (screen · camera · game) from the start so adding the
camera and game consumers is registration, not surgery.
**As landed:** the bypass test is a source walk over `src/behavior/` and `src/features/`,
asserting `ConsentMachine.js` is the only file that names the two browser APIs — checked
against the files rather than the exports, because a bypass gets written by someone who never
read the machine. The stronger half is structural: `CapturePipeline` contains no `navigator`,
takes a grant in its constructor, and refuses to exist without one. The indicator was split
out of the panel: the panel is optional UI a batch mounts, and B11 ships it unmounted because
a picker for zero activities is a mock-up. The panel is the half that exists — sharing
controls, live state, and an `activities` registry B12–B14 register into.

---

#### B12 · Watch Together `[C]` — ✅ landed
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
**As landed:** the fps claim is asserted as the property that decides it — zero-copy
`VideoTexture`, geometry built once, and a source test forbidding `drawImage`,
`getImageData`, `toDataURL` and `needsUpdate` anywhere in the file — plus a Node-measured
per-frame budget that is explicitly not a Quest measurement. YouTube is the shared-tab path,
because a DRM'd player cannot be textured directly and the tab showing it can. The AR pin
reads `ARSupport`'s existing reticle and the file is asserted to contain no
`requestHitTestSource`. Two bugs the tests caught: a `lastCutAt` of `0` swallowed the first
cut of a session (now `null`), and joint attention ran after the blend rather than before it.

---

#### B13 · Music Together `[C]` — ✅ landed
**Branch:** `feat/bd-b13-music` · **Depends on:** B12 (MediaAdapter)
**New:** `src/features/together/activities/music.js`.
**Touched:** none. **AC:** `AnalyserNode` → `media:beat` on a click-track fixture within
one beat period; blackboard energy climbs with track energy and decays after; a beat
streak fires dance clips from the KB (not a hardcoded name); silence → energy returns to
baseline without a stuck dance.
**As landed:** "not a hardcoded name" is checked by loading every id from the manifest and
asserting none appears in the source, plus a second test that the file contains no
`.request(` — stopping the scheduler is the only thing it may do to it. The click track is
synthetic arithmetic on an injected clock, so "within one beat period" is a number rather
than an impression. Energy is pushed and never pulled: decay stays the blackboard's, because
two systems easing one number ease it at neither rate. The stuck-dance watchdog is separate
from and faster than that decay, and the test asserts the dance ends while energy is still
high. The `decay`-absent source grep was replaced with a behavioural test after it matched
its own explanatory comment.

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
**Scope note:** B19 flips the *core* engine only. Waves 6–9 (addendum v1.2) ship after it,
each activity behind its own flag and dynamic import, so none of them needs a second
big-bang flip — and the adult tier never gets one at all: it stays behind its triple gate
permanently.

---

### Wave 6 — Embodied assistant & the quiet daily loop `(addendum v1.2, P13a)`

Sequenced first among the addendum waves because these two usages are the ones people open
*every day*, and because both are small: one is presentation over tools that already exist,
the other is a state machine over adapters that already exist.

---

#### B20 · Panel channel — `display` + PanelRenderer `[S][C]`
**Branch:** `feat/bd-b20-panels` · **Depends on:** B9, B12 (screen mesh)
**New:** `src/features/together/panels/PanelRenderer.js` (structured data → canvas texture
on the virtual screen), server-side `display` emitter in `avatar_director/session.py`.
**Touched:** none — `display` is a new message type, ignored by older peers per §6.9.
**Notes:** the panel is a *texture*, not DOM, so it works identically in VR, AR and 2D.
`assistant.panelMaxKb: 64` is enforced on the server side of the wire, not the render side.
**AC:** an agenda payload renders legibly at Quest resolution and in 2D; oversized payloads
are rejected with an error message, never truncated silently; `panel:shown`/`panel:closed`
fire; a client without the renderer ignores `display` without erroring.
**Why split from B21:** the renderer is the reusable half (tool results, share cards,
coach stats all land on it); the assistant is one consumer.

---

#### B21 · Embodied HomePilot — assistant activity `[C][S]`
**Branch:** `feat/bd-b21-assistant` · **Depends on:** B20
**New:** `src/features/together/activities/assistant.js` (dynamic import).
**Touched:** none. **Notes:** this is a **presentation batch over tools that already
exist** — `hp_personal_plan_day`, the seeded `hp-google-calendar` and Microsoft Graph
servers. Tool actions route through the existing `daypilot_bridge` **propose-only**
contract and its Approval Center: the persona proposes, the user confirms, HomePilot's
safety layer executes. Inventing a second approval path here would be the single worst
mistake available in this plan.
**AC:** scripted e2e — "good morning" produces panel + spoken summary + exactly one
*confirm*-level tool call; no tool is ever invoked outside the persona safety layer
(negative test); she points at the panel rather than narrating into space.
**UX gate:** the beat is *assistant with a body and memory*, not a speaker puck with a
face — reviewed live, not by screenshot.

---

#### B22 · Body-doubling focus sessions `[C][S]`
**Branch:** `feat/bd-b22-focus` · **Depends on:** B7, B16
**New:** `src/features/together/activities/focus.js` (pomodoro machine + quiet profile
overlay, initiative ≈ 0 except block boundaries); streak records as a new LTM category.
**Touched:** none. **AC:** a full 25/5 cycle passes as a scripted test with **zero** `say`
inside a focus block; she stretches when you stretch and nods on refocus from idle/gaze
signals alone; the streak persists server-side and is recalled next session.
**Why here:** it is the cheapest proof that the "quietly alive" profile works, and it makes
the curiosity memory visible to the user in a way movie night alone does not.

---

### Wave 7 — Reaction & the two viral loops `(addendum v1.2, P13b + P14)`

---

#### B23 · Gaming co-host + ExcitementDetector `[C]`
**Branch:** `feat/bd-b23-cohost` · **Depends on:** B11, B12, B7
**New:** `src/features/together/activities/cohost.js`,
`src/features/together/heuristics/ExcitementDetector.js`, **plus `play.profile.js`
promoted from optional to required** (the reaction tiers do not exist in the repo yet).
**Touched:** none. **Notes:** no game API — audio RMS spikes + luma flash deltas emit
synthetic `game:*` events, and real hooks can replace the heuristic later behind the same
events. Macro coalescing at ≤1 per 30 s.
**AC:** reaction tiers fire correctly from a synthetic event script; no full-body reaction
while `attention ≥ 0.8` except macro events; the detector never exceeds one macro per 30 s.
**Priority note:** this is the most clippable experience in the product, which is why it
lands immediately before the clip engine rather than at the end of the activities pack.

---

#### B24 · Clip recorder — the 30-second ring buffer `[C]`
**Branch:** `feat/bd-b24-cliprecorder` · **Depends on:** B6 (render loop), B23 (macro events)
**New:** `src/features/clips/ClipRecorder.js`.
**Touched:** none. **Notes:** `canvas.captureStream(30)` + a WebAudio mix, `MediaRecorder`
with 1 s timeslices into a chunk ring — `CompanionMode.js` and `js/speech-service.js`
already use `MediaRecorder`, so copy the in-repo pattern. Immersive XR framebuffers cannot
be captured; the mirror view is the documented fallback, not a bug.
**AC:** prove the 30 s trim with a test **before** any UI exists; saved webm is 30±1 s with
avatar + activity composited; recorder adds <1 ms/frame while buffering; a static check
proves **zero network imports** anywhere under `src/features/clips/**`.

---

#### B25 · Clip button + "she remembered" share cards `[C]`
**Branch:** `feat/bd-b25-share` · **Depends on:** B24, B16
**New:** `src/features/clips/ui/ClipButton.js`, `src/features/clips/ShareCard.js`
(PNG of a curiosity callback — her quote, timestamp, portrait frame).
**Touched:** none. **AC:** one tap saves locally and **never** uploads; the "clip that?"
toast appears at most once per 60 s and never blocks; a share card renders from a real
curiosity record; both loops are fully torn down when the adult tier is active (tested in
B29, asserted here).
**Product note:** these are the two distribution loops. They are cheap, they are late
enough to have real moments to capture, and they are early enough to be in the first
public build.

---

### Wave 8 — Camera-side activities `(addendum v1.2, P13c)`

Both consume B11's consent machine through its camera source. Ordered copilot-then-coach
because copilot is the lighter of the two and shares the B15 round trip verbatim.

---

#### B26 · Hands-busy copilot `[C]`
**Branch:** `feat/bd-b26-copilot` · **Depends on:** B11, B15
**New:** `src/features/together/activities/copilot.js` (checklist state machine + timers).
**Touched:** none. **Notes:** **on-demand snapshots only** — no periodic frames in this
activity, which is both the privacy posture and the battery posture on a propped-up phone.
**AC:** camera snapshot round trip ≤3 s; the timer flow works hands-free by voice; the
consent indicator is visible whenever camera consent is active; a periodic-frame code path
does not exist (static check).

---

#### B27 · Coach mode — reps, form, practice `[C]`
**Branch:** `feat/bd-b27-coach` · **Depends on:** B26, B14 (journey scenes for language practice)
**New:** `src/features/together/activities/coach.js`,
`src/features/together/heuristics/RepCounter.js`; a small KB content pass adding
`exercise`-tagged demo clips through the B1/B2 pipeline.
**Touched:** none. **Notes:** `PoseLandmarker` joins the **existing** MediaPipe
tasks-vision 0.10.14 loader used by `FaceTracker` and `HandTracker` — same lazy-load, same
throttle, 15–20 fps. Avatar fidgets pause while Pose runs to hold the frame budget.
**AC:** rep events from a recorded video fixture match ground truth ±1; the demo clip is
selected by exercise *intent*, never by name; the §9 frame budget still holds with Pose
active (this is the batch most likely to break it, so the budget test runs on the
reference device, not a laptop).
**Heaviest of the activities pack** — schedule it last inside its wave and give it a full
session.

---

### Wave 9 — Adult tier `(addendum v1.2, P15)` — server first, always

Built last, gated hardest, and the only wave whose acceptance criteria are written as
**invariants that must never be violated** rather than features that must work.

---

#### B28 · Verification, redaction, and the two ranker lines `[S][C]`
**Branch:** `feat/avatar-b28-adult-gates` · **Depends on:** B5, B8, B16
**New (server):** `avatar_director/verification.py` (owner attestation by default, pluggable
`verify(user) -> {verified, exp}` provider; the owner-attest provider **refuses to load on
a multi-user instance**), `avatar_director/redaction.py`, `adult_ack` / `adult_verify_request`
message types, `tests/avatar/{verification,redaction}.py`.
**New (client):** the two gate lines in `UtilityRanker.js` — permitted because that file is
this project's own creation from B5, not a pre-existing repo file (addendum §13).
**Touched:** none pre-existing. **Notes:** `adult_ack` is the **only** way `adultVerified`
becomes true — session-scoped, re-checked on every reconnect. A "click yes" dialog is never
sufficient and must not be implemented.
**AC:** write the §16.7 invariant tests **before** the feature: no client path sets
`adultVerified`; curiosity, vision and MCP sources can never select an nsfw clip (source
rule); redaction fixtures prove warmth signals are stored and explicit details are not;
with `avatar.adult.enabled=false` the tier is invisible in UI and unactivatable over MCP or
session (negative tests).

---

#### B29 · ConsentFlow, adult profile, scenes `[C]`
**Branch:** `feat/bd-b29-adult-arc` · **Depends on:** B28
**New:** `src/behavior/ConsentFlow.js` (owns `escalationLevel`),
`src/behavior/modes/adult.profile.js`, `scenes/{sunset,candlelit}.json`.
**Touched:** none. **Notes:** the design rules are the deliverable, not the content:
escalation is **earned** (`perLevelMinMs`, check-in before every level, advance only on an
explicit user affirmative or unmistakable user initiation) and **reversible** (soft-exit
word → level 1 + gentle crossfade, no commentary; hard exit → companion mode, neutral idle,
no comment). `proactiveNsfw: false` is an invariant, not a setting.
**AC:** check-in flow e2e with scripted affirmatives *and* negatives; soft and hard exits
work from every level within one scheduler tick; the clip recorder is provably torn down;
level decays to 1 on inactivity; nothing in the tier is ever proactive.
**Why last:** it depends on the ranker, the profiles, the scenes, the session, curiosity
and the recorder — every one of which must be stable before a tier this sensitive rides on
top of it.

---

## 4. Dependency graph and parallel lanes

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

  ── addendum v1.2, ships behind per-activity flags after B19 ──────────────

  B12 ─► B20 ─► B21            (panels → embodied HomePilot)
  B16 ─► B22                   (focus / body-doubling, streaks)
  B11 ─┬► B23 ─► B24 ─► B25    (co-host → clip ring buffer → share loops)
       └► B26 ─► B27           (copilot → coach; Pose on the existing loader)
  B5·B8·B16 ─► B28 ─► B29      (adult tier: gates first, arc second)
```

**Lane A (client engine):** B1 → B2 → B3 → B4 → B5 → B6 → B7
**Lane B (server spine):** B8 → B9 → {B10, B16, B17}
**Lane C (content/QA):** B2 descriptions, scene assets for B14, exercise clips for B27
Lanes A and B are independent after B0 and meet at B9. Two sessions can run them
concurrently; a third can carry Lane C content work throughout.

After B19 the addendum waves fan out almost completely: **B20→B21**, **B22**, **B23→B24→B25**
and **B26→B27** share no files and can run as four concurrent lanes. Only the adult tier is
serialised behind everything, deliberately.

**Critical path:** B0 → B3 → B4 → B5 → B6 → B7 → B11 → B12 → B19. Everything else has
slack. B6 is the single largest risk on that path; B27 is the largest after the flip.

---

## 5. Risk register

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
| A second tool-approval path appears for UC-12 | B21 | Route every action through the existing `daypilot_bridge` propose-only contract and its Approval Center; a new approval path fails review |
| Pose tracking blows the frame budget | B27 | `PoseLandmarker` joins the existing MediaPipe loader at 15–20 fps, fidgets pause while it runs, and the budget test runs on the reference device |
| Reaction tiers assumed to exist | B23 | They do not — B23 owns promoting `play.profile.js` from optional to required and carries the cost in its estimate |
| Clip engine quietly becomes an upload feature | B24, B25 | Static check for zero network imports under `src/features/clips/**`; saving is local-only, always user-initiated |
| Adult gate becomes a refactor of the ranker | B5 → B28 | B5 carries `intent.source` and `bb.escalationLevel` from the start, so B28 appends two lines instead of rewriting the enforcement point |
| Adult tier ships on an honour-system age check | B28 | `adult_ack` server attestation is the only path; owner-attest refuses to load multi-user; a client "click yes" dialog must not exist |
| She initiates something spicy | B28, B29 | `intent.source !== 'user'` returns `-Infinity` in the ranker, and `proactiveNsfw:false` is an invariant test, not a setting |

---

## 6. Suggested cadence

| Wave | Batches | Can run in parallel | Ends with |
|---|---|---|---|
| 0 | B0 | — | Ground truth frozen, parity harness green |
| 1 | B1, B2 | B2 with Wave 2 | A searchable KB over 151 real clips |
| 2 | B3–B7 | with Wave 3 | **Demo:** showcase mode cycling the full KB |
| 3 | B8–B10 | with Wave 2 | **Demo:** speak to her, she answers and gestures |
| 4 | B11–B15 | B13/B14/B15 fan out after B11 | **Demo:** watch a film together in VR |
| 5 | B16–B19 | B16/B17/B18 fan out | **Demo:** she asks about your week, unprompted — then the flag flip |
| 6 | B20–B22 | B22 alongside B20/B21 | **Demo:** "good morning" — agenda on the screen, she walks you through it |
| 7 | B23–B25 | after B23 the loops are serial | **Demo:** a clutch win, her reaction, one tap, a shareable clip |
| 8 | B26, B27 | serial (shared camera consent) | **Demo:** "does this look right?" in a real kitchen; a counted set of squats |
| 9 | B28, B29 | strictly serial, server first | **Gate:** every §16.7 invariant green as an automated test |

Each wave-ending demo is the review gate. A wave is not done because its PRs merged; it
is done when the demo runs on the main avatar set with the flag on and the parity smoke
still green with it off.

Waves 0–5 are one release. Waves 6–9 are a stream of independently shippable activities —
which is the point of the per-activity flag: the co-host can be in users' hands while coach
mode is still being built.

---

## 7. Adult tier — the design rules, in one place

Two usages (UC-17 date night, UC-18 intimate wind-down), built last, in B28–B29. Nothing
here changes the animation system: it is gating, pacing and UX around behaviours the app
already ships. Six rules, all test-enforced:

1. **Triple gate, single enforcement point.** Server attestation (`adultVerified`) **and**
   the existing `nsfwAllowed` setting **and** an active profile with `allowNsfw:true` —
   checked on every selection, in the ranker and nowhere else. A second gate elsewhere is
   how one of them ends up open.
2. **Minors excluded by verification, not honour.** `adult_ack` is server-signed, expiring
   and session-scoped; the owner-attest provider refuses to load on a multi-user instance;
   distribution builds must configure a real provider. A client-side "click yes" dialog is
   never sufficient and must not be implemented.
3. **She never initiates.** `intent.source !== 'user'` → `-Infinity`. Curiosity, vision and
   MCP can never reach this content. `proactiveNsfw:false` is an invariant, not a setting.
4. **Escalation is earned and reversible.** Four levels, a check-in before each, a minimum
   dwell per level, decay to level 1 on inactivity, a soft-exit word that crossfades back to
   cozy companion with zero commentary, and a hard exit that works from any state within one
   scheduler tick.
5. **Privacy is the selling point, so it has to be real.** Clip engine and telemetry are off
   in this mode (torn down, not merely disabled); memory may store warmth signals
   ("prefers slow pacing") and never explicit detail, enforced by a server-side redaction
   pass with fixture tests. It runs on the user's own HomePilot; nothing leaves their
   hardware.
6. **Invisible when off.** With `avatar.adult.enabled=false` the mode is absent from the UI
   and unactivatable over MCP or the session channel — proven by negative tests, not by the
   absence of a button.

---

*Companion document to `docs/BEHAVIOR_DIRECTOR.md` (spec v1.1 + addendum v1.2). The
server-lane extract lives in HomePilot at `docs/AVATAR_DIRECTOR_BATCHES.md`.*
