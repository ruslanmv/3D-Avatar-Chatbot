---
description:
    Check Pose Studio presets and Private's closer positions on the real avatar
    — look at them, measure them, and tune one live
---

Arguments: `$ARGUMENTS` — preset names (e.g. `straddle lyingKneesUp`), or
`private`, or `sweep <preset> <variants.json>`.

1. **Look first.** `npm run audit:poses -- --poses <a,b>` (add `--grid` for a
   floor at her sole plane, `--cam 3.6,1.8` for lying poses). Open the run's
   `index.html` and say what you see from the front AND the side. A front view
   alone shipped `floorOpen` floating (develop/NEEDS_FIX.md). Exit 1 means a
   `support.reach` palm is more than 20 mm off the floor.
2. **Tune live, without editing source per try.**
   `node tools/qa/pose-sweep.mjs --preset <name> --variants <file.json> --grid`.
   Start from `tools/qa/pose-sweep-variants/` and read the header of
   `tools/qa/pose-sweep.mjs` for what the floorOpen hunt learnt (IK joint
   limits, shin angle). Put the winner in `src/gltf-viewer/VRPoseSystem.js` and
   confirm it with step 1.
3. **Private, end to end.** `npm run audit:private-positions` (`-- --lang en-US`
   for another language). It climbs the pace with Closer, checks the ⋯ chips at
   every step against `PrivateActionPolicy.POSE_LEVEL`, takes each position from
   the menu (completed and confirmed on her rendered body), then eases off and
   checks she stands. Read `report.json` → `steps[].prompt` for what the model
   was told at each step.
4. Then `npm run validate`. A new or retuned position also needs its words
   (`PrivateActionIntent.POSE_WORDS`), its body line
   (`PrivatePoseController.BODY`), its step (`POSE_LEVEL`) and its chip lines in
   all nine `PrivateLocale` packs — `tests/private-closer-positions.test.js`
   checks every chip line parses back to its position.

Notes: `docs/claude/animations-and-motion.md` (UN23–UN29).
