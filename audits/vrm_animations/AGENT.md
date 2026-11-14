# Agent brief: audit only (AX16)

This folder **measures** Pose Navigator, VRMA and BVH playback. It does **not**
change product motion code (`src/xr/*`, `MotionPolicy`, loaders, PoseSystem).

Product fixes for “sit down replies but she does not sit” live in issue #150 /
PR #152 (MO1–MO6). Use this audit to prove a clip or pose before and after such
a fix — never to ship a behaviour change.

## What must be true in a healthy build

| Person says                          | Body must            |
| ------------------------------------ | -------------------- |
| sit down / siediti / siéntate …      | sit                  |
| dance / balla / baila …              | dance on the floor   |
| come with me / follow me / seguimi … | walk / follow        |
| wave / saluda …                      | wave in frame        |
| lie down / sdraiati …                | lie                  |
| stand up / alzati …                  | stand at full height |
| bow / inchino …                      | bow                  |

A polite sentence in the bubble **without** the body moving is a failed
experience — report it; fix it in the motion PR, not here.

## Audit loop (this PR)

1. `node tools/qa/animation-audit.mjs` — inventory `fails: 0`.
2. `node audits/vrm_animations/run.mjs --avatar <file>` — CSV + shots.
3. Open fail/warn rows; look at `runs/.../shots/`.
4. File findings against the motion stack (or #152). Do not patch `src/` in this
   audit branch.
5. Re-run; commit only regenerated lab / audit artifacts with audit tooling.

## Companion runtime auditors (from #152, when present)

```bash
node tools/qa/animation-runtime-audit.mjs   # → docs/audits/animation-runtime*
node tools/qa/pose-navigator-audit.mjs      # → docs/audits/pose-navigator*
```

Those play every clip / every Pose Navigator preset once and write evidence
under `docs/audits/`. Prefer them for a full contact-sheet pass after a motion
fix lands. This folder’s `run.mjs` is the per-avatar CSV matrix for Quality Lab.

## Do not

- Hand-edit `quality-lab/data/3d/animations-audit.json`.
- Change `src/` on this branch.
- Add Mixamo-origin dances to production candidates from an audit finding alone.
- Skip Pose Navigator when auditing “animations”.
