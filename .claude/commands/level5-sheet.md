---
description:
    Level 5 on a real Forge (the hidden Space or a local one) — her positions
    from behind in chosen body states, one contact sheet to judge an improvement
---

Arguments: `$ARGUMENTS` — a pairing code from Forge's "Pair a headset" (e.g.
`WTR-B9N`), and optionally the positions and states to show. With no states:
`doggy-anal-fisted,doggy-anal-fisted-creampie,doggy-ring-creampie`.

The script is `tools/qa/private-positions-live.mjs`
(`npm run audit:private-positions`). It drives the real app in Chromium, as a
person would. Use it before and after any change to Private, the painter, a skin
state or a position, and put the two sheets side by side (step 5).

1. **A grant, never printed.** A pairing code works ONCE: redeeming it here uses
   it up, so the person needs a new one for their headset. Say so before
   redeeming. Redeem into an owner-only scratch file:

    ```bash
    umask 077; S=<scratchpad>; F=https://ruslanmv-3d-wardrobe-forge.hf.space
    curl -s -X POST -H 'Content-Type: application/json' -d '{"code":"<CODE>"}' \
      $F/v1/device-codes/redeem -o $S/.redeem.json
    python3 -c "import json;open('$S/.grant','w').write(json.load(open('$S/.redeem.json'))['token'])"
    rm $S/.redeem.json
    ```

    The grant is `private-read` for 7 days, so reuse `$S/.grant` for the rest of
    the session instead of asking for another code. Never write it to a repo
    file, a commit, a log or the console.

2. **Forge's side first (seconds).** In the Forge repo:
   `FORGE_GRANT="$(cat $S/.grant)" .venv/bin/python tools/qa/grant_check.py --forge $F`.
   Every line `ok` (the grant reads the body catalogue, After Dark and After
   Dark · Bare, while a guest gets none). If this fails, the sheet will too.

3. **The sheet (5 to 10 minutes).** Run it detached and wait for it to exit:

    ```bash
    export PATH=/opt/node24/bin:$PATH
    FORGE_GRANT="$(cat $S/.grant)" node tools/qa/private-positions-live.mjs \
      --level5 --forge-grant --forge-url $F --world window-room --behind \
      --keys all-fours,face-down \
      --states doggy-anal-fisted,doggy-anal-fisted-creampie,doggy-ring-creampie \
      > $S/l5.log 2>&1
    ```

    - `--keys`: the positions, as Private keys (`all-fours`, `face-down`,
      `bent-over`, `knees-up`, `kneel-wide` …).
    - `--states`: body states from Forge's `states.json`. She wears the bare
      look whose skin pack holds most of them, and each one is switched live
      after every position. A state no pack holds is skipped, so say which.
    - `--behind`: a camera behind her, aimed from her bones. Needed for every
      state below the waist.
    - `--world window-room`: the room with a bed and nothing in the way. The
      cabaret's tables stand behind her.
    - `--avatar AvatarSample_B.vrm --slug avatar-sample-b`: another character.
    - `--hair-aside`: an extra frame with her hair moved aside.
    - `--look-id <id> --look-sha <sha>`: one exact look, even one Forge has not
      listed (a rebuilt bare look is keep-existing).
    - `--lang en-US`: another language. Italian is the default.

4. **Read it.** The log says `ok` or `FAIL` per check: level 5 on with her bare,
   Ease back to 4, each position confirmed on her skeleton, easing to 3 stands
   her up. The run folder `audits/private-positions/runs/<time>-<lang>/`
   (git-ignored) holds `sheet.png`, one PNG per frame (`<key>.png`,
   `<key>-behind.png`, `<key>-<state>.png`), `level-5.png`, `menu-*.png` and
   `report.json`. **Open `sheet.png` and look at it**:
    - Step 4 dressed, Step 5 bare: the second gate is real.
    - From behind: is each state where it belongs, with no paint on her thighs
      or her back, no stripes, and the same state looking the same in every
      position?
    - The card at step 5: the ⋯ menu lists the level-5 shows.

    Send the sheet to the person with SendUserFile. Never commit a frame:
    explicit frames stay in the scratchpad or in ignored `runs/`.

5. **Before and after.** Copy the run's frames to `$S/<label>/` and, in Forge,
   `.venv/bin/python tools/qa/compare_frames.py --out $S/cmp.png --run "Before=$S/before" --run "After=$S/after" --frames all-fours-doggy-anal-fisted,face-down-doggy-anal-fisted`.
   You get one row per frame, from the same camera. A painter change is checked
   on a local Forge that never publishes, with `tools/qa/verify_pack.sh` in
   Forge (it calls this same script with `--look-id`).

Notes: `docs/claude/qa-tools.md` ("Her body from behind, and one exact Forge
look"). Forge side: its `CLAUDE.md` (grant check, verify_pack, compare_frames).
