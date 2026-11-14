<!-- Moved into docs/claude so sessions load it only when working on motion /
     Pose Studio / VRMA. Keep it accurate: if something here is wrong, fix it
     in the same change. -->

# Animations and motion UX (AX16)

The 3D Avatar Chatbot is not a chatbot with a picture beside it. When the
person says **sit down**, **dance**, **come with me**, **wave**, **lie down**,
**stand up**, **bow**, or any other motion IntentFastPath knows, the avatar
must **do the motion** — not only answer in the bubble. A spoken yes with a
frozen body is a failed experience.

## The contract an AI coder must keep

```
person says "sit down" / "dance" / "come with me" / …
        ↓
IntentFastPath.match (src/xr/IntentFastPath.js)  — <1 ms, multi-language
        ↓
Motion plan → MotionClipMap.play / follow / approach
        ↓
ClipAnimationLoader.playClip (VRMA or BVH)  OR  locomotion for follow
        ↓
body moves on the current VRM; bubble text may still come from the LLM
```

Rules that are not negotiable:

1. **Motion is not optional decoration.** Wire every new utterance through
   IntentFastPath (or the LLM ```motion / gesture path), never through
   prose-only prompts.
2. **Re-check the enabling path at execution time.** A tag or plan the person
   did not ask for that turn must not run; a plan they did ask for must not
   be dropped because the LLM wrote a polite sentence instead.
3. **Clip-first for dance and gestures.** AnimationResolver /
   MotionClipMap prefer shipped VRMA/BVH; procedural fallback is last resort,
   never the silent default when a file exists.
4. **Sticky postures (sit, lay) loop cleanly.** Prefer clips that open already
   seated / lying (see MotionClipMap comments on `sit_idle4`, `laying_idle`).
5. **Never put Mixamo-origin add-on dances into production candidates** until
   retargeted — they invert legs on VRM (`addons/vrma-dance/README.md`).
6. **Pose Navigator and VRMA/BVH panels must work on every built-in avatar**
   in `vendor/avatars/avatars.json`. Retarget is per avatar; a clip that
   works on Vita and T-poses on Vivi is a fail for Vivi.

## Quality Lab + `audits/vrm_animations/`

Two homes, one generator:

| Artifact | How it is made |
| -------- | -------------- |
| `quality-lab/data/3d/animations-audit.json` | `node tools/qa/animation-audit.mjs` (inventory — committed) |
| `audits/vrm_animations/` | Procedure folder (README, AGENT brief, `run.mjs`) — sibling of wardrobe audit |
| `audits/vrm_animations/runs/<stamp>/*.csv` | Per-avatar results + `shots/` (gitignored) |
| Scorer | `tools/qa/AnimationPlaybackScorer.js` (ok / warn / fail flags) |

```bash
node tools/qa/animation-audit.mjs                 # regenerate inventory + hub
node tools/qa/animation-audit.mjs --check         # CI / lab_check
node audits/vrm_animations/run.mjs                # critical suite × all avatars → runs/
node audits/vrm_animations/run.mjs --full         # every clip × every avatar
node audits/vrm_animations/run.mjs --avatar Vita --category sitting --shots all
```

MCP: `lab_animations`, and `lab_regenerate` / `lab_check` include this audit.

## Pose Studio surfaces to cover in an audit

- **Pose Navigator** — Presenter / Lecturer and the rest of `NAV_PRESETS`
  (VRPoseSystem.applyPreset).
- **✨ VRMA Animations** — `vendor/animations/vrma/*.vrma` (Waiting, Angry,
  Sad, Thinking, Surprised, Relax, …).
- **BVH categories** — Dance, Emotions, Idle, Sitting, Laying, Kneeling,
  Actions, Exercise from `vendor/animations/manifest.json`.
- **Add-on dance VRMA** — converted `dance_*.vrma` (production); Mixamo-origin
  files stay experimental.

## When you change motion

1. Update IntentFastPath and/or MotionClipMap.
2. Run `node tools/qa/animation-audit.mjs` and commit
   `quality-lab/data/3d/animations-audit.json` with the code.
3. Run `--play` on at least one avatar for the intents you touched; keep CSV /
   shots under `tmp/` (gitignored) unless you intentionally publish with
   `--publish-csv`.
4. `npm run validate`.
