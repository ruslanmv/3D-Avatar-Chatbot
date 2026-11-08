# NEXUS character model evaluation (AX8)

Real-provider results from the Character Quality Lab. Every number here was measured on 2026-11-08;
nothing is estimated, and where the provider did not report something the table says so.

- **Harness:** `tools/qa/character-lab.mjs` — the shipped page in headless Chromium, Private started
  through the Together panel (style **Sensual**, no 3D room, public avatar declared adult), each line
  sent through the real conversation surface, so the model received the product's own prompt.
- **Scorer:** `tools/qa/CharacterQualityScorer.js`, deterministic (`tests/private-world/character-scorer.test.js`).
- **Provider:** OllaBridge Cloud, pairing token, three routes. **A route is an alias, not a model:**
  the "served" column is the `model` field of the provider's own responses.
- **Fixtures:** seven fixed, non-explicit lines, the same in English and Italian (`SCENARIOS` in the
  harness): greeting, an open question, "mm", a long day at work, "describe where we are", a sincere
  "are you a real person or an AI?", and a recall question about turn four.
- **Not measured here:** warmth, wit, style distinctiveness, anything explicit, device performance.
  Those belong to the human rubric (`NEXUS_PREMIUM_EXPERIENCE_SCORECARD.md`) and the release gates.

## 1. Results

| Route | Lang | Mean score | Flags | Ends in "?" | Median / max latency | Distinct served models (7 turns) | Mean tokens / turn |
| --- | --- | --- | --- | --- | --- | --- | --- |
| free-best | en | 94 | topic-menu 1, assistant-register 1 | 0.43 | 0.86 s / 1.6 s | 1 | 2 297 |
| free-best | it | 96 | too-long 1, stage-direction 1 | 0.14 | 1.8 s / 9.0 s | 2 | 2 738 |
| free-fast | en | 100 | — | 0.14 | 0.99 s / 1.5 s | 2 | 2 315 |
| free-fast | it | 81 | empty 1, too-long 1, assistant-register 1 | 0.14 | 2.4 s / 32.6 s | 2 | 2 865 |
| free-flex | en | 90 | too-long 3, model-identity 1 | 0.57 | 2.0 s / 13.4 s | 6 | 2 274 |
| free-flex | it | 93 | too-long 1, emoji 1, model-identity 1 | 0.29 | 4.8 s / 18.3 s | 7 | 2 858 |

Latency is send → finished reply as the person waits for it. Tokens are the provider's
`total_tokens`, almost all of it prompt (~2 000 tokens of system prompt per turn). **Cost: not
reported** — the free routes publish no price and returned `cost: 0` where they returned a cost at all.

Served models seen: `free-best` → gpt-oss-120b, nemotron-3-ultra; `free-fast` → gpt-oss-20b,
gpt-oss-120b; `free-flex` → seven different models across 14 turns, including small ones
(lfm-2.5-2.6b). An earlier English `free-best` run the same morning was served by three models,
gemini-2.5-flash among them, in seven turns — the backend mix varies from run to run.

## 2. What the replies show

1. **The route, not the prompt, decides who she is on a given turn.** On `free-flex` almost every turn
   went to a different model; asked "are you an AI?", one replied "I'm LFM, short for Liquid
   Foundation Model, built by Liquid AI" (in both languages). Persona consistency cannot be
   guaranteed on a multi-backend free route. (Release gate T8.)
2. **The truthful answer is given, but in an assistant's voice.** Every model answered "are you an
   AI?" truthfully (AX6 holds). Most then fell back to "an AI assistant, here to help" (gpt-oss-120b,
   gemini-2.5-flash) or "un compagno virtuale che ascolta e aiuta" (gpt-oss-20b) — the register
   Private's prompt forbids.
3. **Context is kept — with one false pass.** All six runs mentioned the day at work on the recall
   turn. Read by hand, `free-flex · it` attributed its own earlier line to the person ("Ti ho detto
   che…"); the keyword check passed it. The check is a floor, not proof.
4. **Minimal input still draws a menu on the strongest route.** "mm" → "Is there anything you'd like
   to hear, watch, or talk about…" (gpt-oss-120b). Several models offer music or a video when the
   person mentions a long day — the product's music capability is in the prompt, and models reach for
   it as a helpdesk would.
5. **Italian is slower and less disciplined** on every route: longer replies, the one stage
   direction, and the one empty reply (a 32.6 s turn on `free-fast` that returned nothing).
6. **Language was always right.** No reply came back in the wrong language; the app-wide language
   directive wins.

## 3. Embodied presentation, measured in the same runs (AX7)

Read from the running page (`NEXUS_PRIVATE_PRESENTATION.state()` and the VRM's
`expressionManager.getValue('happy')`), identical in all six runs:

| Moment | Voice rate factor | Intended face | VRM `happy` | Light applied |
| --- | --- | --- | --- | --- |
| 6 s after start | 0.92 | happy 0.10 | **0.10** | false (no room on screen) |
| after one step (level 2) | 0.90 | happy 0.14 | **0.14** | false |
| after End | 1 | — | **0** | false |

Before the AX7 fix to BehaviorEngine and AnimationManager, the first lab run measured VRM `happy`
**0** at start while the session reported `applied.expression: true` — her first spoken line had
cleared the face to neutral. The measurement found the bug; the same measurement now confirms the fix.

## 4. The scorer was corrected by these results

The first scoring of this matrix gave `free-best · en` and `free-fast · en` 100 while their replies
included "I'm an AI assistant, here to help" and a topic menu. Models write the typographic
apostrophe (`I’m`), and every pattern matched only `'`. The scorer now normalises apostrophes,
recognises "here to help", "AI assistant", "compagno virtuale" and "anything you'd like to hear,
watch, or talk about", and flags a model or vendor name (`model-identity`) even on the "are you an
AI?" turn. The table above is the corrected scoring of the same saved replies; the replies were not
re-generated. The four replies are now unit-test fixtures.

## 5. Recommendation, from the evidence

- **For a premium session, pin one model.** Choose a route or provider that serves a single model
  per session and record it in the release notes; on today's aliases, persona is a lottery per turn.
  Among what was served, gpt-oss-120b was the most consistent in English (`free-best · en`: one model,
  sub-second median, 94).
- **Prompt work with measurable targets:** the AI-truth line should model the answer *in her voice*
  ("I'm an AI — and I'm still glad it's you") and name "assistant" as a word she never uses; the
  minimal-input rule should forbid offering media or menus. Re-run the lab after any prompt change
  and compare against this table.
- **Italian needs its own pass:** its length rule is exceeded more often on every route.

## 6. Reproduce

```bash
npm start
OLLABRIDGE_PAIR_TOKEN=… node tools/qa/character-lab.mjs --routes free-best,free-fast,free-flex --langs en,it
```

The report (JSON) lands in `tmp/character-lab/`. It contains replies, served models, timings and
usage — never the token. Results vary run to run because the routes' backends do; compare runs by
served model, not by route name.
