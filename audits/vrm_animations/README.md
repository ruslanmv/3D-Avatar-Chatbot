# VRM animations audit (AX16)

Sibling of `audits/wardrobe_sitting_desk/`: repeatable evidence that every
built-in avatar can play Pose Navigator poses, VRMA clips and BVH categories
without looking broken — and that spoken motion (`sit down`, `dance`,
`come with me`, …) is wired to a real clip.

**Audit only.** This folder and its generators do **not** modify `src/`. Product
fixes for frozen sit / dance / follow belong in issue #150 / PR #152 (MO1–MO6).
The generators live in `tools/qa/animation-audit.mjs` and
`tools/qa/AnimationPlaybackScorer.js`; the committed inventory is
`quality-lab/data/3d/animations-audit.json`. This directory is the **procedure
and the run output** when auditing motion.

## Why this exists

A bubble that says “Mi siedo qui accanto” while she stays standing is a failed
experience. Pose Studio can list Lecturer / Presenter, ✨ VRMA Animations and
every BVH category — each must be checked **per avatar**, not once for the
default model. Retarget is avatar-specific; a clip that works on Vita and
T-poses on Vivi is a fail for Vivi.

## What it produces

| Output                                      | Meaning                                                 |
| ------------------------------------------- | ------------------------------------------------------- |
| `quality-lab/data/3d/animations-audit.json` | Inventory (avatars, poses, clips, intents) — committed  |
| `runs/<stamp>/<Avatar>.csv`                 | One row per pose/clip on that avatar                    |
| `runs/<stamp>/all.csv`                      | Combined matrix                                         |
| `runs/<stamp>/shots/*.jpg`                  | Frame screenshots (fail/warn by default; `--shots all`) |
| `runs/<stamp>/summary.json`                 | Counts of ok / warn / fail                              |

`runs/` is gitignored. Keep a few evidence frames under `reports/evidence/` only
when a bug report needs a stable path.

## Run

```bash
# Inventory (no browser) — also refreshes the Quality Lab hub
node tools/qa/animation-audit.mjs

# Critical suite × every built-in avatar (Pose Navigator sample + one clip
# per category + sit/dance/idle critical paths)
npm start   # in another terminal, or let the tool start nexus-proxy
npm i --no-save playwright && npx playwright install chromium
node audits/vrm_animations/run.mjs

# One avatar, one category, every frame saved
node audits/vrm_animations/run.mjs --avatar Vita --category sitting --shots all

# Full matrix (slow): every pose + every clip × every avatar
node audits/vrm_animations/run.mjs --full
```

Scorer flags (see `AnimationPlaybackScorer.js`): `play-failed`, `load-error`,
`nan-bones`, `near-black`, `legs-inverted`, `t-pose`, `no-motion`,
`experimental`, `sit-not-lowered`, `lay-not-lowered`, `hips-underground`.

## Surfaces to walk one by one

1. **Pose Navigator** — Presenter, Lecturer, Sitting, Kneeling, Lying, …
2. **✨ VRMA Animations** — Waiting-standard, Angry, Sad, Thinking, Surprised,
   Relax
3. **BVH categories** — Dance, Emotions, Idle, Sitting, Laying, Kneeling,
   Actions, Exercise
4. **Add-on dance VRMA** — `dance_*.vrma` (production); Mixamo-origin files stay
   experimental

## AI coder contract

Read `docs/claude/animations-and-motion.md` and `AGENT.md` in this folder.
Spoken sit / dance / follow must move the body through IntentFastPath →
MotionClipMap → ClipAnimationLoader. After a motion change: regenerate the
inventory, run `--play` on at least one avatar for the intents you touched,
commit code with `animations-audit.json`.
