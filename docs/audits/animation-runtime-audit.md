# Animation runtime audit

Generated 2026-11-14T04:53:09.877Z by `tools/qa/animation-runtime-audit.mjs` against http://127.0.0.1:8080/. Every clip was fetched (bytes checked: BVH `HIERARCHY` / glTF, never an HTML page), loaded, played on the avatar and sampled for 3 s in desktop Chromium; after a failing clip the page is reloaded so the next clip starts clean.

**120 pass, 25 quarantined, 0 unquarantined failures, of 145 clips.** Vendor manifest: 113 of 113 pass. Addon packs: 7 of 32 pass; the rest are in `MotionClipMap.QUARANTINE` and cannot be drawn by any path.

"Pass" means the file is real, it loaded and retargeted, the skeleton moved, and the hips stayed in a believable range for its category. Visual quality (hands, clipping, cloth) is not judged by these numbers — see `docs/audits/animation-runtime/`. Tested on one VRM 0.x avatar, desktop only; mobile and XR not run.

| Clip | Category | Status | Duration s | Bone change rad | Hips min–max m | Reason |
| ---- | -------- | ------ | ---------: | --------------: | -------------: | ------ |
| `vendor/animations/dance/dance_1.bvh` | dance | pass | 22.1 | 1.963 | 0.672–0.869 |  |
| `vendor/animations/dance/dance_2.bvh` | dance | pass | 20.4 | 1.846 | 0.878–0.935 |  |
| `vendor/animations/dance/dance_backup.bvh` | dance | pass | 25.4 | 2.189 | 0.878–0.921 |  |
| `vendor/animations/dance/dance_dab.bvh` | dance | pass | 7.7 | 2.142 | 0.849–1.003 |  |
| `vendor/animations/dance/dance_gangnam_style.bvh` | dance | pass | 12.37 | 1.661 | 0.78–0.882 |  |
| `vendor/animations/dance/dance_headdrop.bvh` | dance | pass | 15.67 | 2.588 | 0.747–0.888 |  |
| `vendor/animations/dance/dance_marachinostep.bvh` | dance | pass | 3.23 | 3.125 | 0.671–0.803 |  |
| `vendor/animations/dance/dance_northern_soul_spin.bvh` | dance | pass | 8.83 | 2.838 | 0.564–1.05 |  |
| `vendor/animations/dance/dance_ontop.bvh` | dance | pass | 24.3 | 2.1 | 0.896–0.956 |  |
| `vendor/animations/dance/dance_pushback.bvh` | dance | pass | 17.8 | 2.268 | 0.872–0.899 |  |
| `vendor/animations/dance/dance_rumba.bvh` | dance | pass | 2.3 | 1.118 | 0.858–0.922 |  |
| `vendor/animations/emotion/admiration.bvh` | emotion | pass | 13.33 | 1.108 | 0.894–0.897 |  |
| `vendor/animations/emotion/admiration2.bvh` | emotion | pass | 1.13 | 0.187 | 0.894–0.894 |  |
| `vendor/animations/emotion/admiration3.bvh` | emotion | pass | 1.67 | 1.938 | 0.798–1.112 |  |
| `vendor/animations/emotion/amusement.bvh` | emotion | pass | 2.63 | 0.122 | 0.891–0.896 |  |
| `vendor/animations/emotion/amusement2.bvh` | emotion | pass | 1.13 | 0.28 | 0.894–0.894 |  |
| `vendor/animations/emotion/amusement3.bvh` | emotion | pass | 1.67 | 2.07 | 0.787–1.112 |  |
| `vendor/animations/emotion/anger.bvh` | emotion | pass | 19.17 | 1.734 | 0.89–0.9 |  |
| `vendor/animations/emotion/anger2.bvh` | emotion | pass | 20.77 | 0.933 | 0.91–0.916 |  |
| `vendor/animations/emotion/anger3.bvh` | emotion | pass | 28.13 | 1.428 | 0.784–0.883 |  |
| `vendor/animations/emotion/annoyance.bvh` | emotion | pass | 2.93 | 0.184 | 0.894–0.894 |  |
| `vendor/animations/emotion/annoyance1.bvh` | emotion | pass | 2.83 | 1.268 | 0.77–0.795 |  |
| `vendor/animations/emotion/approval.bvh` | emotion | pass | 4.7 | 1.541 | 0.887–0.904 |  |
| `vendor/animations/emotion/approval2.bvh` | emotion | pass | 1.13 | 0.148 | 0.894–0.894 |  |
| `vendor/animations/emotion/approval3.bvh` | emotion | pass | 1.67 | 2.407 | 0.795–1.097 |  |
| `vendor/animations/emotion/caring.bvh` | emotion | pass | 10 | 1.152 | 0.894–0.897 |  |
| `vendor/animations/emotion/caring1.bvh` | emotion | pass | 22.4 | 2.279 | 0.891–0.898 |  |
| `vendor/animations/emotion/confusion.bvh` | emotion | pass | 13.33 | 1.314 | 0.888–0.906 |  |
| `vendor/animations/emotion/confusion2.bvh` | emotion | pass | 4.77 | 1.529 | 0.889–0.899 |  |
| `vendor/animations/emotion/confusion3.bvh` | emotion | pass | 4.47 | 0.592 | 0.878–0.91 |  |
| `vendor/animations/emotion/curiosity.bvh` | emotion | pass | 4.23 | 2.312 | 0.884–0.904 |  |
| `vendor/animations/emotion/curiosity2.bvh` | emotion | pass | 5.8 | 2.087 | 0.879–0.892 |  |
| `vendor/animations/emotion/curiosity3.bvh` | emotion | pass | 6.3 | 0.549 | 0.901–0.907 |  |
| `vendor/animations/emotion/desire.bvh` | emotion | pass | 3.73 | 1.963 | 0.858–0.93 |  |
| `vendor/animations/emotion/desire1.bvh` | emotion | pass | 15.27 | 1.78 | 0.596–0.868 |  |
| `vendor/animations/emotion/desire2.bvh` | emotion | pass | 21.87 | 1.385 | 0.8–0.874 |  |
| `vendor/animations/emotion/disappointment.bvh` | emotion | pass | 4.2 | 1.238 | 0.89–0.898 |  |
| `vendor/animations/emotion/disappointment2.bvh` | emotion | pass | 5.5 | 1.551 | 0.879–0.908 |  |
| `vendor/animations/emotion/disapproval.bvh` | emotion | pass | 20.77 | 2.25 | 0.89–0.895 |  |
| `vendor/animations/emotion/disaproval1.bvh` | emotion | pass | 8.6 | 2.048 | 0.857–0.93 |  |
| `vendor/animations/emotion/disgust.bvh` | emotion | pass | 4.37 | 2.019 | 0.89–0.898 |  |
| `vendor/animations/emotion/disgust1.bvh` | emotion | pass | 3.27 | 2.281 | 0.876–0.911 |  |
| `vendor/animations/emotion/disgust2.bvh` | emotion | pass | 38.83 | 1.902 | 0.88–0.9 |  |
| `vendor/animations/emotion/embarrassment.bvh` | emotion | pass | 11 | 1.188 | 0.886–0.898 |  |
| `vendor/animations/emotion/excitement.bvh` | emotion | pass | 6.57 | 0.877 | 0.859–0.934 |  |
| `vendor/animations/emotion/excitement2.bvh` | emotion | pass | 5.3 | 2.504 | 0.781–0.853 |  |
| `vendor/animations/emotion/excitement3.bvh` | emotion | pass | 2.9 | 0.887 | 0.877–0.91 |  |
| `vendor/animations/emotion/fear.bvh` | emotion | pass | 20 | 2.367 | 0.764–0.871 |  |
| `vendor/animations/emotion/fear2.bvh` | emotion | pass | 3.87 | 0.782 | 0.75–0.813 |  |
| `vendor/animations/emotion/fear3.bvh` | emotion | pass | 3.77 | 0.962 | 0.778–0.848 |  |
| `vendor/animations/emotion/gratitude.bvh` | emotion | pass | 3 | 2.279 | 0.892–0.896 |  |
| `vendor/animations/emotion/grief.bvh` | emotion | pass | 6.73 | 1.9 | 0.876–0.913 |  |
| `vendor/animations/emotion/joy.bvh` | emotion | pass | 8.43 | 0.62 | 0.891–0.898 |  |
| `vendor/animations/emotion/joy2.bvh` | emotion | pass | 8.2 | 2.372 | 0.784–0.846 |  |
| `vendor/animations/emotion/joy3.bvh` | emotion | pass | 3.8 | 1.159 | 0.741–0.842 |  |
| `vendor/animations/emotion/love.bvh` | emotion | pass | 4.57 | 1.728 | 0.891–0.897 |  |
| `vendor/animations/emotion/love2.bvh` | emotion | pass | 10.83 | 1.635 | 0.895–0.899 |  |
| `vendor/animations/emotion/love3.bvh` | emotion | pass | 4.17 | 0.883 | 0.883–0.907 |  |
| `vendor/animations/emotion/nervousness.bvh` | emotion | pass | 6.27 | 0.701 | 0.874–0.903 |  |
| `vendor/animations/emotion/nervousness2.bvh` | emotion | pass | 3.87 | 1.265 | 0.746–0.894 |  |
| `vendor/animations/emotion/nervousnes3.bvh` | emotion | pass | 3.77 | 0.977 | 0.8–0.846 |  |
| `vendor/animations/emotion/optimism.bvh` | emotion | pass | 2.83 | 1.239 | 0.893–0.895 |  |
| `vendor/animations/emotion/pride.bvh` | emotion | pass | 2.33 | 0.096 | 0.893–0.895 |  |
| `vendor/animations/emotion/pride2.bvh` | emotion | pass | 2.9 | 0.989 | 0.869–0.919 |  |
| `vendor/animations/emotion/realization.bvh` | emotion | pass | 5.83 | 1.536 | 0.775–0.872 |  |
| `vendor/animations/emotion/relief.bvh` | emotion | pass | 3 | 0.61 | 0.887–0.902 |  |
| `vendor/animations/emotion/relief1.bvh` | emotion | pass | 10.5 | 1.911 | 0.894–0.895 |  |
| `vendor/animations/emotion/remorse.bvh` | emotion | pass | 2.33 | 0.02 | 0.468–0.469 |  |
| `vendor/animations/emotion/remorse2.bvh` | emotion | pass | 6.83 | 1.043 | 0.469–0.471 |  |
| `vendor/animations/emotion/remorse3.bvh` | emotion | pass | 9.63 | 1.648 | 0.395–0.896 |  |
| `vendor/animations/emotion/sadness.bvh` | emotion | pass | 3.1 | 0.104 | 0.891–0.897 |  |
| `vendor/animations/emotion/sadness2.bvh` | emotion | pass | 1.47 | 0.803 | 0.881–0.909 |  |
| `vendor/animations/emotion/surprise.bvh` | emotion | pass | 4 | 1.471 | 0.759–0.823 |  |
| `vendor/animations/emotion/surprise2.bvh` | emotion | pass | 3.67 | 0.743 | 0.878–0.91 |  |
| `vendor/animations/idle/neutral.bvh` | idle | pass | 8.33 | 0.174 | 0.894–0.894 |  |
| `vendor/animations/idle/neutral2.bvh` | idle | pass | 17.47 | 0.116 | 0.888–0.889 |  |
| `vendor/animations/idle/neutral3.bvh` | idle | pass | 6 | 0.551 | 0.888–0.9 |  |
| `vendor/animations/idle/neutral4.bvh` | idle | pass | 6.13 | 2.084 | 0.894–0.894 |  |
| `vendor/animations/idle/neutral_idle.bvh` | idle | pass | 8.77 | 0.184 | 0.893–0.896 |  |
| `vendor/animations/idle/neutral_idle2.bvh` | idle | pass | 19.83 | 0.186 | 0.882–0.898 |  |
| `vendor/animations/sitting/sit_idle.bvh` | sitting | pass | 19.9 | 1.695 | 0.896–0.896 |  |
| `vendor/animations/sitting/sit_idle2.bvh` | sitting | pass | 19.8 | 1.751 | 0.569–0.896 |  |
| `vendor/animations/sitting/sit_idle3.bvh` | sitting | pass | 9.9 | 0.918 | 0.569–0.896 |  |
| `vendor/animations/sitting/sit_idle4.bvh` | sitting | pass | 6.4 | 0.133 | 0.529–0.529 |  |
| `vendor/animations/laying/laying_idle.bvh` | laying | pass | 10.27 | 0.058 | 0.116–0.116 |  |
| `vendor/animations/laying/laying_idle2.bvh` | laying | pass | 0.8 | 0.182 | 0.115–0.116 |  |
| `vendor/animations/laying/laying_idle3.bvh` | laying | pass | 19.8 | 0.192 | 0.116–0.896 |  |
| `vendor/animations/kneeling/kneel_idle.bvh` | kneeling | pass | 3.3 | 0.014 | 0.894–0.896 |  |
| `vendor/animations/kneeling/kneel_idle2.bvh` | kneeling | pass | 3.3 | 2.192 | 0.391–0.896 |  |
| `vendor/animations/action/action_attention_seeking.bvh` | action | pass | 20.27 | 1.729 | 0.891–0.895 |  |
| `vendor/animations/action/action_crawling.bvh` | action | pass | 1.87 | 1.445 | 0.346–0.39 |  |
| `vendor/animations/action/action_crouch.bvh` | action | pass | 4.07 | 2.259 | 0.38–0.884 |  |
| `vendor/animations/action/action_gaming.bvh` | action | pass | 6.67 | 0.054 | 0.494–0.497 |  |
| `vendor/animations/action/action_greeting.bvh` | action | pass | 5.43 | 1.533 | 0.88–0.908 |  |
| `vendor/animations/action/action_greeting1.bvh` | action | pass | 4.73 | 1.768 | 0.893–0.895 |  |
| `vendor/animations/action/action_jog.bvh` | action | pass | 2.77 | 1.028 | 0.803–0.899 |  |
| `vendor/animations/action/action_jump.bvh` | action | pass | 3.27 | 1.318 | 0.53–1.23 |  |
| `vendor/animations/action/action_laydown.bvh` | action | pass | 5.73 | 1.167 | 0.707–0.752 |  |
| `vendor/animations/action/action_pat.bvh` | action | pass | 4.33 | 1.973 | 0.882–0.901 |  |
| `vendor/animations/action/action_pickingup.bvh` | action | pass | 4.7 | 1.753 | 0.778–0.888 |  |
| `vendor/animations/action/action_run.bvh` | action | pass | 0.7 | 1.604 | 0.791–0.863 |  |
| `vendor/animations/action/action_standup.bvh` | action | pass | 3.43 | 2.33 | 0.386–0.886 |  |
| `vendor/animations/action/action_walk.bvh` | action | pass | 1.37 | 0.979 | 0.874–0.908 |  |
| `vendor/animations/exercise/exercise_crunch.bvh` | exercise | pass | 2.33 | 0.6 | 0.113–0.136 |  |
| `vendor/animations/exercise/exercise_crunches.bvh` | exercise | pass | 1.1 | 1.628 | 0.152–0.166 |  |
| `vendor/animations/exercise/exercise_jogging.bvh` | exercise | pass | 2.53 | 0.831 | 0.792–0.897 |  |
| `vendor/animations/exercise/exercise_jumping_jacks.bvh` | exercise | pass | 1.07 | 2.112 | 0.764–1.018 |  |
| `vendor/animations/vrma/waiting-standard.vrma` | vrma | pass | 11.67 | 0.403 | 0.896–0.898 |  |
| `vendor/animations/vrma/Angry.vrma` | vrma | pass | 3.93 | 0.717 | 0.851–0.865 |  |
| `vendor/animations/vrma/Sad.vrma` | vrma | pass | 3.93 | 0.147 | 0.872–0.876 |  |
| `vendor/animations/vrma/Thinking.vrma` | vrma | pass | 3.93 | 1.468 | 0.851–0.896 |  |
| `vendor/animations/vrma/Surprised.vrma` | vrma | pass | 3.93 | 1.225 | 0.836–0.877 |  |
| `vendor/animations/vrma/Relax.vrma` | vrma | pass | 3.93 | 1.675 | 0.875–0.888 |  |
| `addons/vrma-actions/backflip.vrma` | vrma-actions | quarantined | 4.08 | 2.137 | 1.671–3.297 | hips reach 3.297 m: floats |
| `addons/vrma-actions/bowing.vrma` | vrma-actions | quarantined | 2.25 | 3.086 | 0.735–0.896 | body folds visibly wrong (see screenshot); numbers alone pass |
| `addons/vrma-actions/happyIdle.vrma` | vrma-actions | quarantined | 2.92 | 1.035 | 2.991–3.098 | hips reach 3.098 m: floats |
| `addons/vrma-actions/jumpingJacks.vrma` | vrma-actions | quarantined | 1.04 | 3.09 | 0.896–2.788 | hips reach 2.788 m: floats |
| `addons/vrma-actions/sadIdle.vrma` | vrma-actions | quarantined | 2.67 | 3.054 | 0.896–2.367 | hips reach 2.367 m: floats |
| `addons/vrma-actions/shrugging.vrma` | vrma-actions | quarantined | 2 | 2.946 | 0.896–2.381 | hips reach 2.381 m: floats |
| `addons/vrma-actions/singing.vrma` | vrma-actions | quarantined | 13.96 | 3.124 | 0.896–2.912 | hips reach 2.912 m: floats |
| `addons/vrma-actions/standingClap.vrma` | vrma-actions | quarantined | 4.42 | 3 | 0.894–2.352 | hips reach 2.352 m: floats |
| `addons/vrma-actions/standingGreeting.vrma` | vrma-actions | quarantined | 5.08 | 3.111 | 0.896–2.363 | hips reach 2.363 m: floats |
| `addons/vrma-actions/talking.vrma` | vrma-actions | quarantined | 3.75 | 3.105 | 0.896–2.352 | hips reach 2.352 m: floats |
| `addons/vrma-actions/victory.vrma` | vrma-actions | quarantined | 8.5 | 3.109 | 0.896–2.279 | hips reach 2.279 m: floats |
| `addons/vrma-actions/victoryIdle.vrma` | vrma-actions | pass | 1.79 | 3.082 | 0.896–2.086 |  |
| `addons/vrma-actions/waving.vrma` | vrma-actions | quarantined | 4.71 | 1.758 | 2.388–2.389 | hips reach 2.389 m: floats |
| `addons/vrma-dance/breakdanceUprock.vrma` | vrma-dance | quarantined | 2.08 | 3.129 | 0.896–2.986 | hips reach 2.986 m: floats |
| `addons/vrma-dance/dance_1.vrma` | vrma-dance | quarantined | 22.1 | 1.537 | -0.207–0.896 | hips reach -0.207 m: sinks into the floor |
| `addons/vrma-dance/dance_2.vrma` | vrma-dance | quarantined | 20.4 | 1.888 | -0.046–0.896 | hips reach -0.046 m: sinks into the floor |
| `addons/vrma-dance/dance_backup.vrma` | vrma-dance | quarantined | 25.4 | 2.135 | -0.016–0.896 | hips reach -0.016 m: sinks into the floor |
| `addons/vrma-dance/dance_dab.vrma` | vrma-dance | quarantined | 7.7 | 1.961 | -0.061–0.896 | hips reach -0.061 m: sinks into the floor |
| `addons/vrma-dance/dance_gangnam_style.vrma` | vrma-dance | pass | 12.37 | 1.721 | 0.813–0.905 |  |
| `addons/vrma-dance/dance_headdrop.vrma` | vrma-dance | quarantined | 15.67 | 2.657 | -0.084–0.896 | hips reach -0.084 m: sinks into the floor |
| `addons/vrma-dance/dance_marachinostep.vrma` | vrma-dance | pass | 3.23 | 3.018 | 0.722–0.896 |  |
| `addons/vrma-dance/dance_northern_soul_spin.vrma` | vrma-dance | pass | 8.83 | 2.727 | 0.789–0.95 |  |
| `addons/vrma-dance/dance_ontop.vrma` | vrma-dance | quarantined | 24.3 | 2.075 | 0.002–0.896 | hips reach 0.002 m: sinks into the floor |
| `addons/vrma-dance/dance_pushback.vrma` | vrma-dance | quarantined | 17.8 | 2.117 | -0.024–0.896 | hips reach -0.024 m: sinks into the floor |
| `addons/vrma-dance/dance_rumba.vrma` | vrma-dance | pass | 2.3 | 1.814 | 0.809–0.896 |  |
| `addons/vrma-dance/dancingTwerk.vrma` | vrma-dance | quarantined | 15.17 | 3.004 | 0.896–2.332 | hips reach 2.332 m: floats |
| `addons/vrma-dance/hipHopDance.vrma` | vrma-dance | pass | 13.75 | 3.136 | 0.785–0.896 |  |
| `addons/vrma-dance/hipHopDancing.vrma` | vrma-dance | quarantined | 7.04 | 2.179 | 2.072–2.315 | hips reach 2.315 m: floats |
| `addons/vrma-dance/rumbaDancing.vrma` | vrma-dance | quarantined | 2.33 | 3.091 | 0.894–2.335 | hips reach 2.335 m: floats |
| `addons/vrma-dance/sambaDancing.vrma` | vrma-dance | quarantined | 27.83 | 3.115 | 0.896–2.29 | hips reach 2.29 m: floats |
| `addons/vrma-dance/sillyDancing.vrma` | vrma-dance | quarantined | 3.83 | 2.981 | 0.896–2.766 | hips reach 2.766 m: floats |
| `addons/vrma-dance/twistDance.vrma` | vrma-dance | pass | 9.42 | 3.141 | 0.896–2.108 |  |
