---
description:
    Add a position to Private — a grounded preset, wired into every table, seen
    on the real avatar and taken in a real evening
---

Arguments: `$ARGUMENTS` — the position's key and what it is, e.g.
`kneel-back kneeling, leaning back on her hands`.

The recipe UN38 followed for six positions
(`docs/claude/animations-and-motion.md`):

1. **Never trust an old preset by its name.** Render the candidates first with
   `npm run audit:poses -- --poses <a,b,c> --grid --cam 3.6,1.8` and open
   `sheet.png`, which shows every pose from the front and side. Of the "VR Sim"
   set, proneBone floated, reverseCowgirl hovered, spooning lay on her back and
   standingBehind held a T-pose.
2. **Copy a grounded template** into `src/gltf-viewer/VRPoseSystem.js`: the one
   whose legs already rest the way yours must (`handsKnees` knees and hands,
   `lyingKneesUp` back, `kneelingUp`/`kneelingWide`/`straddle` shins,
   `lyingSide` side, `standingBendForward` feet). Keep its legs; change only
   what the position adds. Pitching the hips? Add the same angle to the thighs
   so they stay where they were. Give it `support: { ground: [...] }` and
   `adult: true`; add it to `PRESET_ORDER`, Pose Studio's list
   (`src/PoseStudioPanel.js`) and `MotionProvenance.js`.
3. **Look again** with step 1. Tune until the sheet shows her on the floor, not
   above it, and the arms are where the body line will say they are.
4. **Wire it**: `PrivatePoseController` (`POSES`, `BODY` read off the frames,
   `INTIMATE`, `CATEGORY_OF_KEY`, both `TRANSITIONS` rows),
   `PrivateActionPolicy` (`POSE_KEYS`, `POSE_LEVEL`),
   `PrivateActionIntent.POSE_WORDS` (nine languages, put before any plainer
   position its words contain), `PrivateLocale` `position.<key>.label/say` in
   all nine packs, `PrivateConversationView.POSITION_KEYS`, and where it applies
   `PrivateBed.BED_POSES`, `PrivateLivingMotion.STYLE` and
   `PrivateActionBridge.POSE_GROUP` (finish places).
5. **Check the wiring**: `npm run audit:position-wiring -- <key>`. Exit 1 lists
   what is missing. The optional columns (bed, motion, finish, category) are
   your call per position.
6. **Take it in a real evening**:
   `npm run audit:private-positions -- --keys <key>`. It must say
   `ok <key> → <preset>` and list the chip at its own step.
7. Add the key to `tests/private-closer-positions.test.js` (`CLOSER`,
   `KEYS_IN_ORDER`). If the parity harness drifts only by line numbers,
   re-record it with `node scripts/behavior-parity-baseline.mjs --write`. Then
   run `npm run validate`.
8. Commit on the session branch, open a PR into `ultimate` titled `Updates`, and
   squash-merge it as `Updates`. Never commit to `main` or `master`.
