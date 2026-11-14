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
