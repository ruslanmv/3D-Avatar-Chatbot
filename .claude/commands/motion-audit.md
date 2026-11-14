---
description:
    Audit the avatar's motion on the live site and report what to fix for chat
    and VR
---

1. Run `npm run audit:motion` (add `-- --quick` for one avatar). Read the run
   folder named in `audits/motion/runs/LATEST`.
2. Report the verdict and every failing or warning row from `report.md`, with
   its flags and numbers. Open the frames for each in `index.html` / `shots/`
   and say what you see — do not trust hips height alone.
3. Summarise `conversation.md`: the recommendations, and which gestures are not
   safe to offer.
4. Propose fixes as separate MO batches (clip map, fast path, loaders). Do not
   change product code in the same step as the audit.

See `audits/motion/AGENT.md` for what each stage proves.
