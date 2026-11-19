# CC0 dance clips (VA2)

Dance motions for the Private shows "Striptease" and "Table dance"
(`src/experiences/private/PrivateRoutines.js`). Both are **CC0 1.0** at their
source, which is compatible with this repository's Apache-2.0 licence. They were
converted here from GLB to VRMA with `tools/anim/glb2vrma.py` (MakeHuman
game-engine rig → VRM humanoid, 30 fps, rotations plus hips translation, the
last 0.5 s eased into the first pose so each clip loops without a jump).

| File                  | Source                                                                                                                                         | Licence                                                       | Source file SHA-256                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `slow_body_roll.vrma` | [Innerscene: Slow body roll](https://www.innerscene.com/tools/library/3d-parts/slow-body-roll-dancing-3d-person-animated-39377175)             | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | `f731f03c04d01d4e1c48117f7c308efcbc7f92a31aa1677b65b24efdf7d87468` |
| `club_phrase.vrma`    | [Innerscene: Four-bar club phrase](https://www.innerscene.com/tools/library/3d-parts/four-bar-club-phrase-dancing-3d-person-animated-86561105) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | `fcc9438c385bb8e5d5b23827501b0787713fed704734a745a307f6a61155e5fd` |

Innerscene lists the creator as "Innerscene, adapted from MakeHuman CC0 assets"
(schema.org `license` on each page, read 2026-11-19). Attribution is not
required by CC0; it is kept here as provenance.

To rebuild: download each GLB from its page, then

```bash
python3 -I tools/anim/glb2vrma.py <slow-body-roll>.glb addons/vrma-cc0/slow_body_roll.vrma --loop-blend 0.5
python3 -I tools/anim/glb2vrma.py <four-bar-club>.glb addons/vrma-cc0/club_phrase.vrma --loop-blend 0.5
```

Checked on AvatarSample_A with the animation review (`audits/animations/run.mjs`
stepping): no foot skate, no travel, at most 6° of turn, no reversed knees or
flipped legs, no twisted limbs in the frames.
