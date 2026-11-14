# Agent brief: motion audit

One command tells you whether the avatar's motion works on the site **right
now**, and turns what it measured into conversation-design decisions for chat
and VR.

```bash
npm run audit:motion                 # 3 avatar heights, every stage (~20 min)
node audits/motion/run.mjs --quick   # AvatarSample_A only
node audits/motion/run.mjs --static  # no browser: tables, files, KB, inventory
node audits/motion/run.mjs --avatars Vita,Vivi --only gestures,phrases
node audits/motion/run.mjs --parallel # avatars side by side — only with a real GPU
```

Exit **0** = PASS, **1** = something failed, **2** = the audit itself crashed.
Results land in `audits/motion/runs/<stamp>/` (git-ignored); `runs/LATEST` names
the newest.

## Read in this order

1. **`report.md`** — verdict, static checks, then per avatar: UI, page errors,
   and only the gestures / phrases / poses that are not ok, with their numbers.
2. **`index.html`** — every action's frames. Look before you trust a number:
   hips height alone passed a sideways tilt and a leg flip on 2026-11-14.
3. **`conversation.md`** — the design brief (below).

## What each stage proves

| Stage      | Passes when                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `static`   | manifest files exist; every gesture offered to the model plays (file or procedural) and has a hint; every fast-path label has a chip; KB + inventory current |
| `ui`       | page boots with no page errors; Pose Studio opens with its sections and the VRMA list                                                                        |
| `gestures` | every `MotionClipMap.availableNames()` gesture plays as the model plays it — grounded, upright, legs below hips, visibly moving                              |
| `phrases`  | chat phrases (EN/IT, typos) are understood by the fast path and the body does it                                                                             |
| `poses`    | every Pose Navigator preset applies — upright, seated presets lowered                                                                                        |

Verdicts come from `tools/qa/MotionAuditScorer.js` (unit-tested in
`tests/motion-audit-scorer.test.js`): `floating`, `sinking`, `tipped-over`,
`legs-flipped`, `not-played`, `phrase-not-understood` fail; `no-visible-motion`,
`sit-not-lowered`, `lay-not-lowered` and `start-not-observed` (it moved, but the
start record came too late — usually a slow first VRMA load under software
rendering) warn. Dances are not judged on staying upright: they bend on purpose.
Thresholds are fractions of each avatar's own standing measurements.

## Using it for conversation design

`conversation.md` / `conversation.json` list every gesture with: the hint the
model sees, status across avatars (`safe everywhere` / `check` /
`do not offer`), timing against a spoken reply, energy and mood from the KB, VR
suitability, and its spoken phrases — then concrete recommendations:

- **do not offer** → take it out of the model's vocabulary (quarantine it in
  `src/xr/MotionClipMap.js` and tag it in `develop/NEEDS_FIX.md`) until fixed.
- **no spoken trigger** → add phrases to `src/xr/IntentFastPath.js` and
  `src/xr/ActionRegistry.js` if people should be able to ask for it.
- **long one-shots** → open a longer answer with them, or trim; mid-sentence
  they outlast the reply.
- **VR: on request only** → big hops and spins are jarring at arm's length; keep
  them out of unprompted VR turns. **VR: reaches toward the person** → prefer
  these for presence.
- **mood gaps** → empathy turns with no matching gesture fall back to face only.

Change hints in `MotionClipMap.USE`, phrases in the fast path, then re-run and
compare the two `conversation.md` files.

## Rules

- Never hand-edit lab data or the KB — regenerate with their tools.
- A fix to a clip or loader is a product change: its own MO batch, its tests,
  and this audit before and after.
