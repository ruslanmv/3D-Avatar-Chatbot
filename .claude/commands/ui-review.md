---
description:
    Review the app as people see it, on desktop and phone (and the headset's
    view) — pick the right capture script, look at every frame, report what to
    improve
---

Arguments: `$ARGUMENTS`: what to review, e.g. `private setup`, `private chat`,
`level 5`, `two hands`, `room light`, `a world`, `an evening`,
`before/after <change>`. With nothing given, run the first two rows below, then
the Private evening row.

Every script here drives the **real app in Chromium** (Playwright is
preinstalled; run `npm ci` once, and use Node 24:
`export PATH=/opt/node24/bin:$PATH`). They render through SwiftShader, so they
show layout and look, never frame rate. **Look at every frame before you
report**; a number missed a table in the way more than once. **Never commit a
frame.** Write them to the scratchpad or to the git-ignored `runs/` folders, and
send the sheets to the person with SendUserFile.

## 1. Pick the script for the question

| Question                                                          | Command                                                                                                                                  | Gives                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| How do Private's setup screens look (mood, "Scegli l'atmosfera")? | `node tools/qa/private-setup-shot.mjs --lang it-IT --out <scratch>/setup`                                                                | desktop + iPhone, step 1 and 2, panel and full page         |
| Does the Private chat UI cover her? Is it readable at every size? | `npm start` in the background, then `node tools/qa/private-ui-shots.mjs --base http://127.0.0.1:8080 --out <scratch>/pui --label before` | four sizes, plus face-coverage numbers per shot             |
| A world/room on desktop and on a phone                            | the lab tool `lab_screenshot` (or `node tools/qa/lab-call.mjs lab_screenshot '{"world":"window-room"}'`)                                 | desktop + Pixel 7 frames of that world                      |
| Level 5 on a real Forge, and what she shows from behind           | `/level5-sheet` (`tools/qa/private-positions-live.mjs --level5 --forge-grant --behind …`)                                                | `sheet.png`: steps, positions, states, the ⋯ menu card      |
| Does a request typed in the chat reach her body?                  | add `--say "fammi il pugno nel culo\|mettimi le due mani"` to the line above                                                             | `ok say … → body.fist {state}` or why not; a frame per line |
| The room in the person's normal light                             | add `--normal-light` (the saved choice, NL2) or `--mood normal-room`                                                                     | the same frames, room in normal light                       |
| A whole evening/show, stage by stage                              | `node tools/qa/evening-stages.mjs --show window-evening --room window-room --persona gina --lang it`                                     | a frame per stage, what moved, what she says                |
| The shows in the ⋯ menu, run step by step                         | `node tools/qa/private-shows-live.mjs --lang it-IT --shows two-hands`                                                                    | each step's pose and skin                                   |
| A pose/position front and side                                    | `/pose-check` (`tools/qa/pose-shots.mjs`)                                                                                                | front and side on a floor grid                              |
| A look or body state head to heels                                | `node tools/qa/body-detail-render.mjs --vrm <file> --views full,fullback`                                                                | views of one VRM                                            |

A real headset is not available in a cloud session. For the Quest's view, the
closest check is the phone frame plus the comfort rules in
`docs/qa/LIGHTING_AND_PRIVATE_SETUP_PLAN.md` (no sudden brightness, no flicker,
readable type).

## 2. Before and after a change

1. Capture **before** into `<scratch>/<topic>-before` with the script from the
   table.
2. Make one change.
3. Capture **after** into `<scratch>/<topic>-after` with the same arguments.
4. Put them side by side with Forge's
   `tools/qa/compare_frames.py --run Before=<dir> --run After=<dir> --frames <names>`.
   For whole screens, send both sheets.

## 3. What to look for (a premium review)

- **Language:** every word in the chosen language, no English left under Italian
  (place names, card titles, the composer's placeholder).
- **She is visible:** no panel, chip or sheet over her face or body while she is
  the point. Desktop and phone both.
- **Above the fold:** on a phone the choice the screen asks for is visible
  without scrolling, and the main button is reachable (sticky if the list is
  long).
- **Hierarchy:** one clear title, then labels aligned with what they label,
  enough contrast (step dots, small text).
- **Light:** the room is as the person chose it (their light, NL2), with no
  sudden jumps.
- **Truth:** what she says matches what the frame shows (state names in the log
  against the frame).

## 4. Report

Say what you looked at (script, language, sizes), then each finding as: what is
wrong, where (file and function), the smallest fix. Send the sheets. Note
anything you could not check (the headset, frame rate). Findings that are not
fixed now go into the relevant plan in `docs/qa/` with the exact command to see
them again.
