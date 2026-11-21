<!-- Index of the review and measurement tools. Keep it accurate: a tool added, renamed or retired changes this page in the same commit. -->

# QA tools: see it, measure it, fix it

Every tool below drives the real app in headless Chromium (Playwright is
pre-installed in cloud sessions; do not reinstall it) or reads the real files,
and writes its output under `audits/*/runs/` (gitignored — **never commit
frames of Private positions**). Start the app first and point the tool at it:

```bash
npm start                                   # the app on :8080, in another shell
export NEXUS_LAB_BASE=http://127.0.0.1:8080
```

Look at the frames, not only the numbers: every bug below was found by looking.

## Her standing idle and gestures (ID)

| Tool | What it answers |
| --- | --- |
| `node tools/qa/idle-pose-check.mjs [--vrm a.vrm,b.vrm] [--preset naturalIdle] [--talk "line"] [--mobile]` | How her arms hang at rest: angle from vertical, elbow bends (asymmetric?), hand gap outside the thigh, which preset; front, side and both-hand close-ups; then frames while she "speaks" a line (co-speech gestures) |

The idle is solved per body in `src/gltf-viewer/RelaxedIdle.js` and applied as
NaturalPosePlugin's default `relaxedIdle` (`tests/relaxed-idle.test.js`). Measured
2026-11-19 on AvatarSample_A and Vita: arms 6–8° from vertical, elbows 15° / 21°,
hands 7–9 cm outside the thigh line (before: ~25°, 19° both, 21 cm). Finger and
thumb signs were set by looking at the hand close-ups — re-check them there if
the bone conventions change. Co-speech gestures (`src/features/gestures/SpeechGestures.js`,
SG1–SG3) run on top; their strokes last 0.5–1.5 s and the screenshot loop is too
slow to catch them reliably — measure a hand's height per frame instead (a stroke
lifts the right hand from ~0.79 m to ~1.3 m on AvatarSample_A).

## A whole Private evening (EA, BS, PP, WR, PS)

**Every test is in underwear, on the floor (EA2, the owner's call 2026-11-19).**
Jeans and dresses tent and clip in positions and hid what was judged. Download
Forge's underwear sets for the avatar once (read-only; a token only in that one
command's environment) into `audits/poses/runs/looks/<avatar>/` (gitignored):
both tools dress her in the first set, and each undress cue changes to the next.
Positions stay on the floor; pass `--bed` to the evening tool to test the bed
placement (BS1) on purpose.

| Tool | What it answers |
| --- | --- |
| `node tools/qa/evening-stages.mjs --show window-evening --room bright-hotel --lang it` | One show played in its room, a frame per step: did each step move her (degrees), did each undress cue change her clothes, is she on the bed for bed positions, is the room right; `index.html` contact sheet. `--persona gina|isabelle|yuki`, `--looks a.vrm,b.vrm` for a real undress |
| `node tools/qa/private-shows-live.mjs` | The same shows driven through the real Private UI: the ⋯ menu at each pace step, what the bridge and the model are told |
| `node tools/vr/measure-bed.mjs [world-id …]` | Measures each room's bed from its model (centre, mattress height) and writes `bed` into worlds.json, idempotently; `tests/private-bed.test.js` measures again |
| `node tools/vr/render-place-previews.mjs <ids>` | The 640×480 picture of a new place (required for every place) |
| `node tools/qa/world-audit.mjs` | Every world valid, measured, within budget; regenerates the lab data — run after any worlds.json change |

## A real conversation, end to end (E2E)

| Tool | What it answers |
| --- | --- |
| `OLLABRIDGE_TOKEN=… FORGE_GRANT=… node tools/qa/private-e2e.mjs [--lang it] [--room bright-hotel] [--persona gina] [--turns file.json]` | A real Private evening: the real app, a real model (OllaBridge Cloud), the real wardrobe (Forge with a read grant), real words. Per turn: her reply, the action the bridge took, what she was told of her body, a frame; checks for leaked tags, silence, expected actions. `index.html` per run |

Before the browser starts, one direct call checks the model (E2E2): a model that
cannot answer stops the run in a second with the provider's reason. On 2026-11-19
`grok-best` answered HTTP 402 (its provider's credits ran out), and two whole
runs "failed" every turn on the app's own English filler lines — read a run whose
replies are all "Still here…", "Never mind the question…" as **no model**, not a
bad model. Pick another with `OLLABRIDGE_MODEL` (`free-best`, `homepilot-auto`
answered; both return their reasoning as text, so judge the words, not only the
actions).

Secrets come from the environment only (`OLLABRIDGE_TOKEN`, or `OLLABRIDGE_PAIR_CODE`
to pair first; `FORGE_GRANT`) and are never written to the report, the console or
a file. A reply through the cloud model takes about a minute; nine turns take ten.

## Positions on the floor (OL)

| Tool | What it answers |
| --- | --- |
| `node tools/qa/pose-shots.mjs --poses sittingOpen,lyingKneesUp --views front,side --grid` | A preset's front and side on the real avatar with a grid at her sole plane: is her seat on the floor or in the air? (`sittingOpen` floated in front of the bed until OL1 made it a floor seat) |
| `npm run audit:position-wiring -- [keys]` (`tools/qa/position-wiring.mjs`) | UN38. Is every Private position in every table it needs: preset, order, Pose Studio, provenance, controller, policy, words, nine locale packs whose chip line parses back to the key, and the ⋯ chip. Optional columns cover bed, motion, finish and category. Needs no browser and takes seconds. Exit 1 names what is missing. `pose-shots` also writes `sheet.png`, every pose front and side in one image. |
| `npm run audit:private-positions -- --level5 [--forge-grant] [--behind] [--world window-room] --keys all-fours,face-down` | L5. A real Private evening: Closer from Warm to the top, the chips at each step, then step 5 (No limits) opened by Closer and closed by Ease, each position taken from the ⋯ menu and confirmed on her body. `--forge-grant` uses the real grant from `FORGE_GRANT` in the environment (never a file), so she undresses through Forge's bare look. `--behind` adds each position from behind her, worked out from her skeleton. `--world` picks the room: the cabaret's tables stand behind her, the Window Room has a bed and nothing in the way. Writes `sheet.png` with every frame. Forge's side of the grant: `tools/qa/grant_check.py` there. |

Relative requests ("apri", "chiudi le gambe") are one table,
`PrivatePoseController.TRANSITIONS`; a new position gets a row there in the same
commit, or "open" leaves her as she is. A reply never moves a held position
(OL2: `handleIntent`, `_intent`, `ProceduralAnimator.setMode` check
`vrPoseSystem.isHoldingBones()`).

## Motion, poses and looks (VA, LM, MP)

See `docs/claude/visual-review.md` for the full table: clip playback against a
source rig (`audits/animations/run.mjs`), the living layer
(`tools/qa/living-motion-live.mjs`, `living-motion-compare.mjs`), a look head to
heels (`tools/qa/body-detail-render.mjs`), and the motion gallery
(`tools/qa/motion-gallery.mjs`).

## Her body from behind, and one exact Forge look (L5, HA, BD25–BD29)

Step by step from a pairing code, with what to look for in the sheet:
`/level5-sheet` (`.claude/commands/level5-sheet.md`).

`node tools/qa/private-positions-live.mjs --level5 --behind --keys all-fours,face-down,bent-over`
takes each position at the top of the pace and frames her from behind; writes `sheet.png`.

- `--forge-grant` (grant from `FORGE_GRANT` in the environment only) and `--forge-url <url>`:
  the second gate is real, against that Forge.
- `--states a,b` wears her bare look whose skin pack holds most of them and switches each one
  live (the app's own `NEXUS_SKIN_STATES`) after every position: `<key>-<state>.png`.
- `--avatar <file>` / `--slug <library slug>`: another character (`AvatarSample_B.vrm`,
  `avatar-sample-b`).
- `--hair-aside` adds `<key>-behind-hair.png` with her hair moved aside (HA1).
- `--say "line|line"` (BD38) types each line into the chat after every position, as the person
  would, and logs what the bridge did with it (`body.fist` completed with its state, or why
  not), with a frame from behind: `<key>-say-<n>.png`. The way to prove a request in words
  reaches her body; `--states` alone uses a QA switcher.
- **Which script for which UI question** (desktop, phone, level 5, chat requests, room light,
  before/after): `/ui-review` (`.claude/commands/ui-review.md`).
- `node tools/qa/private-setup-shot.mjs [--lang it-IT] [--out dir]` (UI1): Private's setup
  screens (step 1 mood, step 2 "Scegli l'atmosfera") on desktop and iPhone, for a design
  review. Plan and findings: `docs/qa/LIGHTING_AND_PRIVATE_SETUP_PLAN.md`.
- `--normal-light` (NL2) saves the person's choice "Normal room light in Private" before the
  page opens, so the room is checked in normal light exactly as the app applies it (the
  Settings switch, or the ⋯ chip 💡). Prefer it to `--mood` for Private rooms.
- `--mood <id>` (NL1) puts the room in a playground mood after it loads: `normal-room` is any
  place in ordinary light, sky, fog and floor included (the Window Room without its red).
- `--look-id <id> --look-sha <sha256>` wears exactly that look, even one Forge has not listed
  (a rebuilt bare look is keep-existing), with that file's own hash.
- With Forge's `tools/qa/verify_pack.sh` this is how a painter change is checked: one exact
  pack built on a local Forge that never publishes, worn here by id. Forge's
  `tools/qa/compare_frames.py` puts runs side by side.

The level-5 stories (BD31, BD32: Valentina's `fist-then-inside` and `fist-then-ass`, Chiara's
`worse-than-last-time`) need their states in the look she wears (Forge's fist and ring packs);
Forge's `tools/qa/verify_set.sh tools/qa/checks/painter.txt <out>` renders them on a real avatar.
What a finish shows after a fist is `AFTER_ANAL_FIST` in `PrivateActionBridge.js`.

`node tools/qa/provider-keys-check.mjs` (K1, K2): every provider's key field can be typed into,
and Test Connection tries the provider the form shows (after Fetch Models), not the saved one.

## Forge (the wardrobe service, its own repository)

`tools/prebuild_private.py` (BD21: every private bare look for every character —
all states in skin packs, plus looks with extras; admin token from a file;
idempotent; gate refusals reported, never worked around),
`tools/body_surface/detail_flat.py`, `detail_preview.py`, `build_outfits.py` —
see Forge's CLAUDE.md ▸ Looking at results. Read-only checks of the HF dataset
use a token only in one command's environment, never in a file.

## Lessons these tools taught (so the next session does not relearn them)

- Measure the body before changing a painter: Avatar A's thigh bands survived three paint
  fixes because her crotch landmark was 4 cm under her real crotch (Forge BD29); Forge's
  `tools/body_surface/anatomy_probe.py` finds that in seconds.
- A test look built on a Forge with the HF backend is published unless
  `WARDROBE_HF_PUBLISH=false`; a renderer that picks from the list shows the old look after a
  rebuild of a listed bare look: wear the new one by `--look-id`.

- Frame from her bones, never from the mesh box: a skinned mesh's box is its
  standing shape, so lying poses were framed as if she stood.
- Find her front from her eyes, not a facing flag: two tools filmed her back.
- A raycaster in this scene needs `raycaster.camera` set (sprites read it).
- Lying is "head near her lowest bone", not "flat box": raised knees fooled it.
- A maxi dress tents over raised knees and reads as a broken pose: judge
  positions in fitted clothes.
- Talk mode lapses without real audio in a headless page: hold it
  (`setMode('talk', …)`) while capturing.

Gestures while speaking: the 2026-11-21 audit (robotic hands on a phone), its measurements,
likely causes and the next steps are in `docs/qa/GESTURE_AUDIT.md` (SG6).
