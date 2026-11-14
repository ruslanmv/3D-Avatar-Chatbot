# Needs fix — kept for future work

Clips that failed review on **2026-11-14** and are **not** integrated. Each one
is already unreachable in the app (`MotionClipMap.QUARANTINE`). Machine-readable
list: [`needs-fix.json`](needs-fix.json).

| Clip                                        | Tag                       | What is wrong               |
| ------------------------------------------- | ------------------------- | --------------------------- |
| `addons/vrma-actions/backflip.vrma`         | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-actions/bowing.vrma`           | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-actions/happyIdle.vrma`        | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-actions/jumpingJacks.vrma`     | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-actions/sadIdle.vrma`          | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-actions/shrugging.vrma`        | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-actions/singing.vrma`          | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-actions/standingClap.vrma`     | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-actions/standingGreeting.vrma` | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-actions/talking.vrma`          | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-actions/victory.vrma`          | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-actions/waving.vrma`           | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-dance/dancingTwerk.vrma`       | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-dance/hipHopDancing.vrma`      | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-dance/rumbaDancing.vrma`       | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-dance/sambaDancing.vrma`       | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-dance/sillyDancing.vrma`       | `needs-fix:legs-inverted` | legs flipped above the head |
| `addons/vrma-dance/dance_1.vrma`            | `needs-fix:sinks`         | hips below the floor        |
| `addons/vrma-dance/dance_2.vrma`            | `needs-fix:sinks`         | hips below the floor        |
| `addons/vrma-dance/dance_backup.vrma`       | `needs-fix:sinks`         | hips below the floor        |
| `addons/vrma-dance/dance_dab.vrma`          | `needs-fix:sinks`         | hips below the floor        |
| `addons/vrma-dance/dance_headdrop.vrma`     | `needs-fix:sinks`         | hips below the floor        |
| `addons/vrma-dance/dance_ontop.vrma`        | `needs-fix:sinks`         | hips below the floor        |
| `addons/vrma-dance/dance_pushback.vrma`     | `needs-fix:sinks`         | hips below the floor        |
| `addons/vrma-dance/breakdanceUprock.vrma`   | `needs-fix:sinks`         | hips below the floor        |

## How they were checked

1. Played on AvatarSample_A (0.89 m hips), VRM_Viewer_Sample (0.69 m) and Vita
   (0.98 m); hips height sampled over 3.3 s.
2. Frames checked by eye — hip height alone missed both the BOOTH tilt and the
   Mixamo leg flip.

## To bring one back

Fix it, re-run the same two checks on three avatar heights, take it off
`QUARANTINE` in `src/xr/MotionClipMap.js` and remove its row here.
