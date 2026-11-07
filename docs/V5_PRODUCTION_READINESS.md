# V5 Reactive Playground Context — production readiness (PG3)

Date: 2026-11-07. Branch `feat/v5-reactive-playground-context-handoff` (PR #132).
This is the report for the production pass that followed the V5 implementation
(`docs/PLAYGROUND_REACTIVE_CONTEXT_V5_HANDOFF.md` ▸ Implementation). Everything
below says how it was measured. **No physical phone and no headset were
available**: every browser number comes from headless Chromium with SwiftShader
(a CPU rasteriser) in this container, and is labelled as such.

## Recommendation: CONDITIONAL GO

Ship to production **after** the two hardware checks in _Conditions_ pass. The
code is complete, the gate is green, and real-model dialogue was grounded in
every venue tried. What is not proven is how it behaves on a real phone and in a
real Quest. The design is fail-soft, so the expected risk is low, but it has not
been seen.

### Conditions (blocking)

1. **One physical phone run** (iOS Safari or Android Chrome): enter the Irish
   pub, tap the bar counter, chat three turns, and end the place with the X.
   Watch for the hover/tap label, her glance, and no layout regression in the
   DX5 row.
2. **One Quest 3 run** in the headset's own browser: in a playground, point the
   controller ray at an anchor and pull the trigger. `trySelectRay` should
   select it, and the VR panel's buttons should still click (VR2's
   `firstVisibleHit` order is unchanged, but it has not been seen).

### Not blocking, tracked

- **Private rooms with a real model were not run.** The private policy is
  covered by unit tests (`privateOpenNow`, never in the prompt, wiped on exit),
  not by a live conversation. A real-model run needs the person's explicit
  go-ahead, because it means sending private-room text to the gateway.
- **`gesture_toward_object` has no clip.** The library's only `point`-tagged
  clip is the arm-waving `action_attention_seeking`, tagged there by the
  draft-descriptions "attention → point" rule. The intent stays unrouted (it
  falls back, and fallbacks are never described to the model) until that clip
  is re-tagged and the embeddings rebuilt.
- **OllaBridge `/health` reports `homepilot_enabled: false`**, so there is no
  persona or avatar WebSocket session. Chat uses the ordinary
  `/v1/chat/completions` path, which is what was tested.
- **Some gateway error pages carry no CORS header.** The browser cannot read
  their status then. They now show the network sentence (see _Reliability_),
  which is the best the page can do.

## What PG3 changed

| Area | Change | Where |
| --- | --- | --- |
| Intent mapping | `smile` used to rank all 166 clips lexically, because `smile` is not a registry intent, and won `action_attention_seeking`. `BehaviorRouter.CHANNELS` now routes each intent to a face (`happy` 0.35, 2.2 s), a gaze (user or object, 2.5 s), or a registry intent that exists (`greeting`, `nod_along`, `talk`, `celebrate`, `idle`, `sit`, `stand`). An intent the registry does not declare falls back instead of guessing. | `src/companion/BehaviorRouter.js`, actuators in `src/companion/index.js` |
| Object selection | Hover label and pointer cursor on desktop; tap on touch (≤ 8 px, ≤ 450 ms; a drag selects nothing); VR controller ray within 0.45 m of an anchor. Anchors are the template's own, with coordinates in the world's space. | `src/experiences/playgrounds/PlaygroundObjectPicker.js`, `PlaygroundTemplateCatalog.js` anchors `at`/`space` |
| Seaside | `ExperienceDirector` emits `interaction:completed`. The reactive context records it as a shared moment in the prompt. It requests no gesture, because Seaside's director already reacted. | `src/experiences/ExperienceDirector.js`, `PlaygroundReactiveContext.sharedMoment` |
| Structured planner | She may end a reply with one `<gesture intent="…" target="…"/>`: smile, look_at_user, look_at_object (a template anchor only), listen, dance or stop_dancing. Dance and stop run only through the venue's own chip (`__NEXUS_PLAYGROUND_LIVE.act`). The tag is stripped at the `displayText` seam and masked while streaming. It is refused for Copilot, private rooms, while something owns her body, during quiet, and for stale generations. | `PlaygroundReactiveContext.propose/parseGesture/maskStreaming`, `PromptContext` `gestureOffer` |
| Grounding | The paragraph lists the things both of them can see, says when the dance has stopped, and forbids inventing people, animals or things. The cap was raised to 720 characters. | `PlaygroundReactiveContext`, `PromptContext` |
| Failure feedback | A failed reply says why and what to do next (re-pair, check connection, retry, pick another model). It never shows the error's own text. | `src/features/chat/ChatErrorText.js`, `src/main.js` `_addErrorWithRetry` |

The planner never runs model text as code, and **a tag is never treated as
authorization**. It is a request, checked against the same owners as a chip:
the allowlist, the template's anchors, private gates, ownership and quiet.
Everything else is dropped silently.

## Evidence

### Gate

`npm run validate`: exit 0 — lint clean, format clean, **5810 tests in 263
suites**. New: `tests/playground-pg3.test.js`, `tests/chat-error-text.test.js`.
Updated: `tests/playground-reactive.test.js`.
`node scripts/behavior-parity-baseline.mjs --check`: OK. The baseline was
re-recorded because `src/main.js` line numbers moved.

### OllaBridge (real gateway, sanitised)

Paired with the code the person supplied. The token was kept in a mode-600 file
in the session scratchpad and injected into throwaway browser profiles. It was
never printed, logged or committed, and it is not in this repository.

| Check | Result |
| --- | --- |
| `POST /pair` | 200 |
| `GET /health` | 200; `homepilot_enabled: false` |
| Missing or invalid token | 401 |
| `free-fast` round trip | 917 ms (direct, one short message) |
| `free-best` round trip | 433 ms (direct) |
| `grok-best` round trip | 1.7 s (direct) |
| Unknown model | 502 with an HTML error page |
| `stream: true` | ignored; returns one JSON body |

### Real-model dialogue in the real app (headless Chromium, `free-best`)

Five turns per venue, through the app's own chat path. No tag ever reached a
bubble (`bubbleHasTag` false on every turn). Typical latency was 3–7 s per turn.

- **Irish pub (iPhone SE emulation).**
  - Asked "Is there a fireplace here?", she answered: "There isn't a fireplace,
    just the warm glow from the pendant lamp and the inviting bar counter."
  - "Shall we sit at the table?" → `look_at_object` table via gaze.
  - The first turn proposed `smile` → face.
- **Neon discoteca.**
  - "Let's dance together" started the venue's Dance chip through the planner
    (`owning: dance`).
  - "Let's stop dancing" stopped it, and she looked back (`look_at_user`).
- **Creative academy.** She gave teaching answers (neural networks, a worked
  XOR example) and kept the study focus when asked what to read next.
- **Seaside.**
  - The lantern moment was recorded with no duplicate gesture.
  - The first run invented a gull. After the stronger grounding line, "What else
    is here with us?" answered only with the sunset, the waves and the rocks.
- **Outlier.** One discoteca turn took 92 s and the harness (90 s) read the
  previous bubble. The app's own deadline is 190 s; this was the gateway, under
  parallel load from the harness.

### Object picking (headless Chromium, real mouse and touch input)

| Run | Result |
| --- | --- |
| Desktop 1440×860, pub | hover label "bar counter" and pointer cursor; click → `look_at_object:behavior/gaze`; the paragraph says "Just now they pointed out the bar counter; you looked toward the bar counter." |
| Desktop, academy | study desk selected the same way |
| iPhone 13 emulation, touch, discoteca | tap on the DJ booth selected it |
| Drag across an anchor | nothing selected |

### Performance (headless Chromium, SwiftShader — not a device)

Frame rate under SwiftShader is about 2 fps on every page, the avatar alone
included, so it says nothing about a phone and is not reported as one. What it
can measure honestly is listed below.

| Venue | Device profile | World shown | World triangles (declared) | Rendered triangles (world + avatar) | Draw calls |
| --- | --- | --- | --- | --- | --- |
| Irish pub | desktop | irish-pub | 94 872 | 140 646 | 114 |
| Irish pub | iPhone 13 | irish-pub-light | **29 058** | 74 832 | 114 |
| Neon discoteca | desktop | neon-discoteca | 138 814 | 167 992 | 117 |
| Neon discoteca | iPhone 13 | neon-discoteca-light | **27 904** | 72 806 | 113 |
| Creative academy | desktop | creative-academy | 41 160 | 86 934 | 118 |
| Creative academy | iPhone 13 | creative-academy-light | **29 356** | 75 130 | 118 |

- A phone always got the light stand-in, under the **30 000** cap, which was
  not raised.
- PG3's new per-input work costs about 27–41 µs per anchor projection and
  17–26 µs per prompt-suffix build. Both run only on input or at prompt time,
  never per frame. The hover projection is rAF-throttled.

## Security, reliability, privacy

- **No credentials in the tree.** The diff was searched for token-shaped
  strings; none. No auth header, storage dump or network capture was committed.
- **Model output is data.**
  - `<gesture>` is parsed by an exact-shape regex.
  - Values come from fixed allowlists, and targets only from the venue
    template.
  - At most one gesture runs per reply.
  - A tag the person typed is never run, because the parser runs only on
    assistant replies.
  - The enabling state is re-checked when the gesture executes.
- **Private.**
  - Nothing private reaches the prompt.
  - The planner refuses outright in private rooms and in Copilot.
  - The picker selects only anchors of the verified, currently shown world.
- **Forged events do nothing.**
  - `nexus-playground-object` with an unknown anchor, or for a world that is
    not `vrWorlds.activeId`, is ignored.
  - So is a `nexus-world-shown` that disagrees with the renderer.
- **Failure feedback.** Auth, network, timeout, gateway and model failures each
  get a fixed sentence with a next step, verified in the real app for an
  aborted request, a 502 HTML page and a bad token. Raw error text is never
  shown.

## Rollback

The work is additive and in its own commits (`git log --grep PG3`).

- **Whole release:** revert the PG3 commits on the branch, or simply do not
  merge PR #132. Nothing outside it depends on these modules.
- **Planner only:** remove `gestureOffer` from `contextSuffix` in
  `src/companion/index.js`. She is no longer offered the tag, and
  `consumeReply` still strips any that appear.
- **Picker only:** remove `PlaygroundObjectPicker.js` from `boot.js`. The
  reactive context treats a missing picker as no objects.
- **Error sentences only:** remove `ChatErrorText.js` from `boot.js`. The
  bubble falls back to the old generic text.

Re-run `node scripts/behavior-parity-baseline.mjs --write` after changing the
boot list, then `npm run validate`.
