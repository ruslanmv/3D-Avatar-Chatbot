# NEXUS Quality Lab

A small static site that shows how the companion really behaves with real
models, and the tooling an AI coder uses to improve it. Humans audit it in the
browser; agents read and write its JSON.

- **Open it:** `npm start`, then `http://127.0.0.1:8080/quality-lab/`
- **Data:** `quality-lab/data/index.json` → `quality-lab/data/runs/<id>.json`
- **Guarded by:** `tests/quality-lab.test.js`, plus the scorer's own tests in
  `tests/private-world/character-scorer.test.js`

## For an AI coder: start here

The loop is always the same: **measure → change one thing → measure again →
publish → commit both.**

```bash
npm start                                         # the lab drives the real app
OLLABRIDGE_PAIR_TOKEN=… node tools/qa/character-lab.mjs --routes free-best,free-fast --langs en,it
node tools/qa/lab-publish.mjs tmp/character-lab/<report>.json --id <yyyy-mm-dd-name> --label "<what changed>"
npx jest tests/quality-lab.test.js tests/private-world/character-scorer.test.js
npm run validate
```

### File map

| File                                            | What it is                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `tools/qa/character-lab.mjs`                    | Real-provider harness: the shipped page, Private started, fixed lines, raw report |
| `tools/qa/CharacterQualityScorer.js`            | Deterministic scorer (pure, browser + Jest). `WEIGHTS` is the rule table          |
| `tools/qa/lab-publish.mjs`                      | Raw report → schema-1 run file, rescored; `--rescore-all` after a scorer change   |
| `quality-lab/index.html`, `lab.js`, `lab.css`   | The page. No framework, no build                                                  |
| `quality-lab/data/`                             | Published runs. The only data the page reads                                      |
| `docs/qa/NEXUS_CHARACTER_MODEL_EVALUATION.md`   | The written findings for the AX8 matrix                                           |
| `docs/qa/NEXUS_PREMIUM_EXPERIENCE_SCORECARD.md` | The human rubric                                                                  |
| `docs/qa/NEXUS_PREMIUM_RELEASE_GATES.md`        | What must be true before release                                                  |

### Rules (non-negotiable)

1. **No fabricated results.** Every run file comes from `character-lab.mjs`
   output via `lab-publish.mjs`. Never hand-write or edit a reply, a latency, a
   served model or a token count. A human review is added by a human (or quoted
   from one), never invented.
2. **The served model is the provider's word.** OllaBridge routes are aliases
   over several backends; `servedModels` is the `model` field of the responses.
   When the provider does not say, it is empty — never the route name.
3. **Every stored score is the current scorer's.** Change the scorer → run
   `node tools/qa/lab-publish.mjs --rescore-all` → commit both. The test fails
   otherwise.
4. **No secrets.** The token comes from `OLLABRIDGE_PAIR_TOKEN` or
   `--token-file`; the publisher refuses any run file holding a token-like
   string.
5. **Fixtures stay non-explicit** and identical across languages, so a run
   compares models, not lines.
6. **Unit, browser, real-provider, device and human evidence stay separate.**
   Never average a human score with the scorer.

### Recipes

**Compare a prompt change.** Run the lab on the same routes before and after;
publish both with labels that name the change; the Overview's "Across runs"
table shows the difference. Compare by served model, not route name — the
backend mix varies run to run.

**Add a scorer flag.** Add the pattern and its `WEIGHTS` entry in
`CharacterQualityScorer.js`; add at least one real reply from a run file as a
test fixture (a reply that should be caught) and one that should not; run
`--rescore-all`; explain the flag in the evaluation doc if it changes
conclusions. Write patterns with the plain apostrophe — the scorer normalises
`’` first.

**Add a scenario.** Add the line to both languages in `SCENARIOS`
(`character-lab.mjs`), same `id` in each. A context check goes in `recall` as a
regex; remember it is a floor (it passed one reply that misattributed the
memory).

**Record a human review.** Append to the run file's `humanReview` array:

```json
{
    "reviewer": "name",
    "date": "2026-11-09",
    "route": "free-best",
    "lang": "en",
    "device": "desktop Chrome",
    "scores": { "A1": { "score": 2, "evidence": "quoted line or measurement" } }
}
```

Keys are the rubric ids (A1–A8, B1–B5, C1–C3, D1–D4); `score` is 0–3, or
`"pass"`/`"fail"` for D.

## Run file schema (version 1)

```text
{ schema: 1, id, date (ISO, minutes), label, harness, style, notes: [string],
  humanReview: [review],
  runs: [{
    route, lang, started: bool, servedModels: [string],
    presentation: { start|stepped|stopped: { active, level, rate, intended, faceHappy, applied } } | null,
    summary: { meanScore, answered, flags: {flag: count}, questionRatio, medianMs, maxMs,
               distinctServedModels, meanTokens|null },
    turns: [{ id, user, reply|null, ms, servedModels: [string], tokens|null,
              recalled: bool|null, score, flags: [string] }]
  }] }
```

`medianMs` and `maxMs` count answered turns only; an empty reply is visible in
its turn (`reply: null`, flag `empty`) with its own `ms`.

## For a human auditor

Each section of the page answers one question:

- **Overview:** how each route did in each language, and how runs compare.
- **Replies:** every line and reply, filterable by flag. Replies are shown as
  plain text exactly as received.
- **Presentation:** what her voice and face really did. `VRM happy` is read off
  the model, not assumed.
- **Scorer:** the rules in force, with a box to try any sentence.
- **Human review:** the rubric scores, kept apart from the machine.

If a number on the page looks wrong, the run file it came from is linked by id
in the Run picker, and `git log -- quality-lab/data` says who published it and
when.
