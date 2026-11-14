# Agent brief: motion must happen

When improving the 3D Avatar Chatbot, treat **embodiment** as part of the reply.
The person asks for a motion; the avatar performs it.

## Required behaviours

| Person says (any supported language) | What must happen                                           |
| ------------------------------------ | ---------------------------------------------------------- |
| sit down / siediti / siéntate …      | IntentFastPath `sit` → seated clip (`sit_idle4` preferred) |
| dance / balla / baila …              | clip-first dance VRMA (not Mixamo-origin until retargeted) |
| come with me / follow me / seguimi … | follow / approach path, not only a spoken yes              |
| wave / saluda …                      | one-shot wave clip                                         |
| lie down / sdraiati …                | sticky lay posture                                         |
| stand up / alzati …                  | leave sticky posture                                       |
| bow / inchino …                      | bow clip                                                   |

A polite sentence in the bubble **without** the body moving is a regression.

## Audit loop

1. `node tools/qa/animation-audit.mjs` — inventory must stay `fails: 0`.
2. `node audits/vrm_animations/run.mjs --avatar <file>` — CSV + shots.
3. Open fail/warn rows; look at `runs/.../shots/`.
4. Fix retarget / candidate order / IntentFastPath — not the screenshot.
5. Re-run; commit `quality-lab/data/3d/animations-audit.json` with the code.

## Do not

- Hand-edit `animations-audit.json`.
- Add Mixamo-origin `addons/vrma-dance/*.vrma` to MotionClipMap candidates.
- Mark a clip production-ready from one avatar only.
- Skip Pose Navigator when auditing “animations” — poses are part of the suite.
