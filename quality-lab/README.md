# NEXUS Quality Lab

The research hub for building Nexus: one world to explore with her, a zone at a
time, on desktop, mobile and VR. A static site with three areas, and the tools
an AI coder uses to improve each. Humans audit it in the browser; agents read
and write its JSON.

- **AI quality** (`?area=ai`): how the companion behaves with real models —
  replies, served models, scores, her voice and face, human reviews.
- **3D quality** (`?area=3d`): whether every world is ready on desktop, phone
  and headset — device availability, triangle budget, previews, measured spots,
  interactions, and a work queue of what is missing — plus the **animations
  audit** (every built-in avatar × Pose Navigator / VRMA / BVH, spoken motion
  intents, playback CSV + frame shots).
- **World atlas** (`?area=atlas`): the Nexus map as regions of zones, what is
  walkable from home on each device, which zone cuts the map, and new zones as
  briefs. Phases: `docs/engine/NEXUS_OPEN_WORLD_ROADMAP.md`.

- **Open it:** `npm start`, then `http://127.0.0.1:8080/quality-lab/`
- **Data:** `quality-lab/data/index.json` → `quality-lab/data/runs/<id>.json`
- **Guarded by:** `tests/quality-lab.test.js`, plus the scorer's own tests in
  `tests/private-world/character-scorer.test.js`

## For an AI coder: start here

**Read `quality-lab/data/hub.json` first.** It is small and generated: each
area's headline numbers and a ranked list of `nextActions`, each with `why`, the
`command` that starts it and the `files` it touches (priority 1 blocks a device
or a release gate, 2 is a measured quality gap, 3 is missing coverage). Every
action is derived from measured data, so it never asks for work already done.
The page shows the same list with a ready-to-paste prompt for each.

**Or use the MCP server.** `.mcp.json` registers `nexus-quality-lab`
(`tools/qa/lab-mcp.mjs`, no dependencies); Claude Code asks once to enable it.
Its tools: `lab_status`, `lab_next_actions`, `lab_worlds`, `lab_world`,
`lab_animations` (AX16 inventory + intent coverage), `lab_atlas`,
`lab_screenshot` (a world on desktop and a Pixel 7, inline, with the world each
really loaded), `lab_score_reply` (instant scoring while you iterate on a
prompt), `lab_replies`, `lab_new_zone` (dry run by default), `lab_regenerate`
and `lab_check`. They run the same generators as the CLIs, so data written
through them passes the same tests. Without the server loaded, call any tool
from a shell:
`node tools/qa/lab-call.mjs lab_screenshot '{"world":"irish-pub"}'`. The
real-provider lab is not a tool: it needs the app running, a token and minutes
per route. Animation **playback** (CSV + screenshots) is also CLI-only:
`node tools/qa/animation-audit.mjs --play`.

The loop is always the same: **measure → change one thing → measure again →
regenerate → commit code and lab data together.**

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

## The 3D area: worlds on desktop, mobile and VR

```bash
node tools/qa/world-audit.mjs          # regenerate quality-lab/data/3d/worlds-audit.json
node tools/qa/world-audit.mjs --check  # what the test runs: fails if the audit is stale
node tools/qa/animation-audit.mjs      # regenerate quality-lab/data/3d/animations-audit.json
node tools/qa/animation-audit.mjs --play   # per-avatar CSV + frame shots → tmp/animation-audit/
```

The world audit is **generated, never written**. It reads `assets/vr-worlds/`
(catalogue, scenes, panoramas, props, previews, spots, private configs) and asks
the shipping code the questions the app asks at runtime: `VRWorlds`'
`validateCatalogue`, `allowedOn`, `resolveFor` (a place shows its light stand-in
where it cannot load itself) and `comfortProblem`, and the playground
`TEMPLATES`. Change a world → regenerate → commit both;
`tests/quality-lab.test.js` fails otherwise, and fails on any `fail` issue.

### Animations audit (AX16)

**Audit only** — this lab surface does not change product motion (`src/`).
Spoken sit / dance / follow fixes live in issue #150 / PR #152 (MO1–MO6).

Same folder rule: `quality-lab/data/3d/animations-audit.json` is generated from
`vendor/avatars/avatars.json`, `vendor/animations/manifest.json`,
`addons/vrma-dance|actions`, Pose Navigator presets, `IntentFastPath` and
`MotionClipMap`. Product rule: **sit down / dance / come with me / wave / lie
down / stand up / bow must move the body** — see
`docs/claude/animations-and-motion.md`. Playback (`--play`) writes one CSV per
avatar plus JPEG frames for fail/warn under `tmp/animation-audit/` (gitignored);
use `--full` for every clip × avatar, `--avatar` / `--category` to focus.

| Severity | Raised when                                                                                                                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fail     | catalogue problem; scene, panorama, prop or preview file missing; a prop within 1 m of the person, between you, or inside her; a place without a preview, or a preview over 60 KB; spots measured on a different version of the GLB |
| warn     | a place not offered on a device (no tier, or over the 30 000-triangle phone budget with no stand-in); a place with a scene but no measured spots, so she cannot move within it                                                      |

### Recipe: a new VR space

The page's **New space** section lists the pipeline in order, each step with the
tool that owns it. In short:

1. art (CC0 / Apache-compatible, provenance recorded)
2. a `worlds.json` entry with measured `triangles`
3. a clear spot found by raycasting
4. a light stand-in if over budget
5. measured spots
6. a rendered preview
7. optional venue template or private config
8. tests
9. `node tools/qa/world-audit.mjs`

Then run the browser checks in **Checks you run** and say in the commit which
you ran. The engine guide is `docs/engine/AI_CODER_START_HERE.md`.

### Recipe: a new integration (a chip, an activity, a behaviour in a place)

Follow the capability pattern in `CLAUDE.md` (switch → capability → directive →
trusted code), add interactions as data (`PlaygroundTemplateCatalog`, or a
private config), and let the owner confirm them. The audit shows a world's chips
and private interactions; the AI area's lab measures how she talks about them.
Run both areas after an integration: `world-audit.mjs` for the place,
`character-lab.mjs` for her.

### What the 3D area cannot see

Frame rate, how a scene looks, how she stands in it, comfort beyond prop
placement, a real phone's GPU, a real headset. Those are the **Checks you run**
— browser renders and simulations, and device procedures. The audit never marks
them done.

## The World atlas

`quality-lab/data/atlas/atlas.json` is the one hand-written file in `data/`: the
design of the map. Everything else about a zone is computed into
`atlas-audit.json` by `node tools/qa/world-audit.mjs`.

- A **shipped** zone names its catalogue worlds (`worlds`); its device
  availability, spots, preview and issues come from the 3D audit.
- A **planned** zone has a `brief` (purpose, mood, activities, spotsWanted,
  devices, assets) and no worlds; the audit turns it into next steps. Start one
  with `node tools/qa/new-zone.mjs <id> --region … --dry-run`.
- **Links** are undirected and are the intended map; the runtime does not use
  them yet (roadmap W3). A private zone links only to private zones.
- **Gateways**: a public zone that does not load on a device but sits next to
  zones you can walk to from home there. Fixing one opens everything behind it;
  the hub ranks it priority 1.

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
