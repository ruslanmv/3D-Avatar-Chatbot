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
| `node tools/qa/idle-pose-check.mjs [--vrm a.vrm,b.vrm] [--preset naturalIdle] [--talk "line"]` | How her arms hang at rest: angle from vertical, elbow bends (asymmetric?), hand gap outside the thigh, which preset; front, side and both-hand close-ups; then frames while she "speaks" a line (co-speech gestures) |

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

Secrets come from the environment only (`OLLABRIDGE_TOKEN`, or `OLLABRIDGE_PAIR_CODE`
to pair first; `FORGE_GRANT`) and are never written to the report, the console or
a file. A reply through the cloud model takes about a minute; nine turns take ten.

## Motion, poses and looks (VA, LM, MP)

See `docs/claude/visual-review.md` for the full table: clip playback against a
source rig (`audits/animations/run.mjs`), the living layer
(`tools/qa/living-motion-live.mjs`, `living-motion-compare.mjs`), a look head to
heels (`tools/qa/body-detail-render.mjs`), and the motion gallery
(`tools/qa/motion-gallery.mjs`).

## Forge (the wardrobe service, its own repository)

`tools/prebuild_private.py` (BD21: every private bare look for every character —
all states in skin packs, plus looks with extras; admin token from a file;
idempotent; gate refusals reported, never worked around),
`tools/body_surface/detail_flat.py`, `detail_preview.py`, `build_outfits.py` —
see Forge's CLAUDE.md ▸ Looking at results. Read-only checks of the HF dataset
use a token only in one command's environment, never in a file.

## Lessons these tools taught (so the next session does not relearn them)

- Frame from her bones, never from the mesh box: a skinned mesh's box is its
  standing shape, so lying poses were framed as if she stood.
- Find her front from her eyes, not a facing flag: two tools filmed her back.
- A raycaster in this scene needs `raycaster.camera` set (sprites read it).
- Lying is "head near her lowest bone", not "flat box": raised knees fooled it.
- A maxi dress tents over raised knees and reads as a broken pose: judge
  positions in fitted clothes.
- Talk mode lapses without real audio in a headless page: hold it
  (`setMode('talk', …)`) while capturing.
