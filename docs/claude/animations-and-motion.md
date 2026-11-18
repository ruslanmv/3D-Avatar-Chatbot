<!-- Loaded when working on motion / Pose Studio / VRMA audits. Keep accurate. -->

# Animations and motion UX (AX16) — audit vs product

**Two PRs, two jobs:**

| PR | Scope |
| -- | ----- |
| **This audit work** (`audits/vrm_animations/`, `tools/qa/animation-audit.mjs`, Quality Lab) | Measure inventory + playback. **No `src/` changes.** |
| **#152 MO1–MO6** (`fix/conversation-motion-runtime-audit`) | Product fixes so sit / dance / come-with-me actually move the body, plus `animation-runtime-audit.mjs` / `pose-navigator-audit.mjs` evidence under `docs/audits/`. |

When the person says **sit down**, **dance**, **come with me**, **wave**,
**lie down**, **stand up** or **bow**, the avatar must **do the motion** — not
only answer in the bubble. That contract is enforced by product code (#152);
this audit proves it per avatar and per clip.

## Audit tools (this tree)

| Artifact | Command |
| -------- | ------- |
| `quality-lab/data/3d/animations-audit.json` | `node tools/qa/animation-audit.mjs` |
| Per-avatar CSV + shots | `node audits/vrm_animations/run.mjs` |
| Scorer | `tools/qa/AnimationPlaybackScorer.js` |

```bash
node tools/qa/animation-audit.mjs
node tools/qa/animation-audit.mjs --check
npm i --no-save playwright && npx playwright install chromium
npm start   # or let the harness start nexus-proxy
node audits/vrm_animations/run.mjs
node audits/vrm_animations/run.mjs --avatar Vita --category sitting --shots all
```

MCP: `lab_animations`; `lab_regenerate` / `lab_check` include the inventory.

## Runtime auditors (from #152, when merged)

```bash
node tools/qa/animation-runtime-audit.mjs   # docs/audits/animation-runtime*
node tools/qa/pose-navigator-audit.mjs      # docs/audits/pose-navigator*
```

## Surfaces to walk one by one

- Pose Navigator (Presenter / Lecturer / Sitting / …)
- ✨ VRMA Animations
- BVH categories (Dance, Emotions, Idle, Sitting, Laying, Kneeling, Actions, Exercise)
- Add-on `dance_*.vrma` (production); Mixamo-origin stays experimental / quarantined

## When product motion changes

Change IntentFastPath / MotionClipMap / loaders / VRPoseSystem **on the motion
PR**, then re-run both the inventory and a `--play` (or #152’s runtime audit)
and commit regenerated audit data with that fix — not as a silent edit of lab
JSON alone.

## How `--play` measures (and why)

- It samples **raw** bones (what is drawn); BVH drives the raw rig, so the
  normalized rig read every BVH as "no-motion".
- It waits on the **app's own frame loop** instead of ticking the mixer itself;
  manual ticks overwrote the clip and gave every BVH the same numbers.
- Pose jobs mirror `PoseStudioPanel._enterPoseMode()` (stop clips, procedural
  pose mode, `autoUpdateHumanBones`), else presets read "no-motion".
- Float/sink are judged against her **standing height on the freshly loaded
  avatar**, not the per-job rest: a sinking VRMA displaces the next job's rest.
  `hips-floating` (> 1.6× standing) is a fail — Mixamo root tracks lift her
  2.4–3.6 m.

## Gestures the model and chat can trigger (MO7–MO9)

- `MotionClipMap.availableNames()` offers only names her body can perform (a
  playable candidate or a procedural stand-in). backflip is withheld: its only
  clip floats her.
- Quarantined Mixamo gestures fall through to grounded clips: clap →
  `vrma/Clapping.vrma` then `emotion/approval2.bvh`, victory →
  `emotion/excitement2.bvh`, shrug → `emotion/confusion.bvh`, sing →
  `emotion/joy.bvh`, jumping_jacks → `exercise/exercise_jumping_jacks.bvh`; bow,
  nod, headshake are procedural on raw bones; point / high five / raise hand /
  offer hand / handshake are IK on raw bones.
- tk256 VRMA re-enabled (MO8 fixed their hips scaling): goodbye ("bye"), jump,
  look_around, blush, sleepy. Idle pool prefers ChatVRM `idle_loop.vrma`
  (weight 3).
- Before adding a VRMA: measure it on more than one avatar height —
  AvatarSample_A's hips (0.89 m) match the authoring rig, so a scaling bug is
  invisible there.

## Library additions (MO10)

- Eleven more VRMA gestures, each with a when-to-use hint the model sees
  (`MotionClipMap.USE`, rendered by `MotionContract`): show_outfit, peace_sign,
  finger_gun, spin, model_pose, playful_dip (VRoid BOOTH), turn_aside, open_arms,
  hand_on_heart, explain, present (mocopi). Spoken: "peace sign", "spin/twirl",
  "strike a pose", "show me your outfit".
- The loader converts tracks out of a clip's rest frame and ignores a hips rest
  at or below the floor (Mixamo FBX2glTF) in favour of the track's median.
- Failed clips are tagged, not shipped: `develop/NEEDS_FIX.md`.

## Motion audit (MO11)

`npm run audit:motion` (or `/motion-audit`) checks the live site end to end —
static tables, UI, every offered gesture, chat phrases, every pose — on three
avatar heights, and writes `report.md`, `index.html` (all frames) and
`conversation.md` (design brief for chat and VR) to `audits/motion/runs/`. See
`audits/motion/AGENT.md`.

## Preset transitions and the open-knees poses (UN23, UN24)

- **UN23.** `VRPoseSystem.applyPreset` no longer blends every bone on one fixed
  curve. `src/gltf-viewer/PoseTransition.js` (IIFE, `NEXUS_POSE_TRANSITION`,
  unit-tested in `tests/pose-transition.test.js`) stretches the caller's
  duration for a large change (past 60° on any bone, plus hips travel; capped at
  1.6 s; `0` stays instant) and staggers the bones: trunk first, hands and feet
  last, each on smootherstep. Grounding's own 0.35 s hips blend stays on one
  curve. Without the global, the old single smoothstep runs.
- **UN24.** Adult presets `sittingOpen`, `kneelingWide`, and the existing
  `seatedChair` added to Pose Studio's Adult category. `floorOpen` was too, and
  is out again (UN27): its seat and palms float 25–30 cm, see
  `develop/NEEDS_FIX.md`. Spicy mode only; no NL phrases (adult). Rendered on
  AvatarSample_A front and side before committing. The parity baseline was
  re-recorded for the five-line shift in `PoseStudioPanel.js` only.
- **UN25.** Pose Studio ▸ Transition speed (Slow 1.6× / Normal / Fast 0.6×),
  `PoseTransition.setSpeed`, stored per device in
  `nexus_pose_transition_speed` (a setting: not in ConversationReset). Instant
  stays instant.
- **UN26.** Adult `lyingKneesUp` (on her back, knees up and apart, feet on the
  floor; elbows fold about Z because Y folds a supine forearm up at the
  ceiling) and `straddle` (kneeling up astride, knees wide, hands forward).
- **UN27.** Private reaches the closer positions by key (`sit-open`,
  `kneel-wide`, `knees-up`, `straddle`, with `all-fours`): words in nine
  languages, gated at the top of the pace, described to the model as her body
  is (`PrivatePoseController.BODY`), and offered as chips at the top of the ⋯
  menu that send the person's line through the conversation surface. Verified
  in a real Private evening: no chips below level 4, each chip completed and
  confirmed on the rendered body at it.
- **UN28.** The closer positions open by step, not all at the top:
  `PrivateActionPolicy.POSE_LEVEL` — 2 Romantic `kneel-wide`; 3 Sensual
  `sit-open`, `straddle`; 4 Intimate `knees-up`, `all-fours` (undressing stays
  at 4). The prompt lists what is open now and what opens next (with its step);
  the ⋯ chips follow the step; easing below a held position's step stands her up
  (`PrivateActionBridge.fitPoseToPace`, called after every pace repaint).
  Verified live: chips 0 / 1 / 3 / 5 by step, straddle at 3, Ease up → standing.

## Tools for poses and Private positions (UN29)

Kept so the next session starts from evidence, not from a screenshot that
"looks seated". `/pose-check` walks them in order.

| Tool                                                       | What it answers                                                                                                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run audit:poses -- --poses a,b [--grid] [--cam d,h]`  | Front/side shots of presets on the real avatar, the blend PoseTransition chose, `lastSupport` (grounding, palms). Exit 1: a reaching palm > 20 mm off the floor.           |
| `node tools/qa/pose-sweep.mjs --preset X --variants f.json` | Bone variants applied live to the real `POSE_PRESETS` object: grounding and palm heights plus a side shot per variant. No source edits per try.                              |
| `npm run audit:private-positions [-- --lang en-US]`        | A real Private evening: chips per step vs `POSE_LEVEL`, every position taken from the ⋯ menu and confirmed on her body, Ease up stands her. Records the model's lines/step. |

Output goes to `audits/poses/runs/` and `audits/private-positions/runs/`
(gitignored). Two traps they encode: under plain Node the `src/` IIFEs load as
ES modules (`"type": "module"`), so read their global, not `module.exports`; and
proxy-rig joint heights are offset from the rendered body — judge contact by
`lastSupport` palms and by the side view.
