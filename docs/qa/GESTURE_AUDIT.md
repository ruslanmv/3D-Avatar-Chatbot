# Gestures while speaking: audit (SG6, 2026-11-21)

Owner's report, from a phone (Vercel deploy, a VRoid avatar with a brown bob, white
cardigan, black shorts, tights — most likely `Sendagaya_Shino`): "we don't like how
robotic the flexion of the hands is, very bad". Two frames: idle (20:51) and speaking
(20:53).

What the frames show:

- **Idle is an A-pose**: both arms held out about 40–45° from her sides, elbows
  straight.
- **Hands are flat paddles**: fingers straight and splayed, wrists bent so the
  fingers point out and down — the T-pose hand carried along by the arm, with no
  curl.
- **Speaking**: one forearm pushed forward toward the camera, the hand still a flat
  paddle; the other arm unchanged in the A-pose.

## The layers that move her arms (read in this order every frame)

| Layer                                                    | File                                                                                  | What it does                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relaxed idle (ID1)                                       | `src/gltf-viewer/RelaxedIdle.js` via `src/NaturalPosePlugin.js` (`relaxedIdle`)       | Arms solved per body so the hands hang beside the thighs (62–84° down), elbows 10°/17°, palms in, **fingers curled** (cascade toward the little finger), thumbs relaxed. Captured as her rest pose (`ProceduralAnimator.captureRestPose`).                                                                                          |
| Base pose                                                | `src/ProceduralAnimator.js` `applyBasePose()` → `AnimationPresets.BASE_POSES`         | Default `basePose = 'lecturerNeutral'`: upper arms 36° (`[4, 0, ±36]`), elbows 12°, **no hand, no fingers**. Applied on top of rest every frame.                                                                                                                                                                                    |
| Talk style                                               | `ProceduralAnimator.applyTalkStyle()` → `AnimationPresets.TALK_STYLES` `explainCalm`  | **Still running**: continuous sine waves on both upper arms (1.8 Hz) and the right forearm, for the whole reply. SG1's header says these were replaced by co-speech gestures, but `mode === 'talk'` still calls `applyTalkStyle` before the gesture layer — the metronome the owner sees as robotic.                                  |
| Co-speech gestures (SG1–SG5)                             | `src/features/gestures/SpeechGestures.js` (`GESTURES`, `PROFILES`, `createLayer`)     | Discrete strokes on words (beat, palm-to-you, hand on chest, chin, shrug, open arms, palms up, negate, wave). Poses touch **upper arm, forearm and wrist only — no gesture has a finger shape**, and `PROFILES.mobile/vr` set `fingers: false`, so on a phone and in VR the hand keeps whatever the layers below left it as.          |

## Measured (`node tools/qa/idle-pose-check.mjs`, desktop 1800×1000, local `ultimate`)

| Avatar         | armDown L / R (0 = hanging) | elbow L / R | handGap | pose        |
| -------------- | --------------------------- | ----------- | ------- | ----------- |
| AvatarSample_A | 8° / 5°                     | 15° / 21°   | 0.08 m  | relaxedIdle |
| AvatarSample_B | 7° / 6°                     | 15° / 21°   | 0.07 m  | relaxedIdle |
| AvatarSample_C | 6° / 4°                     | 15° / 21°   | 0.09 m  | relaxedIdle |

On desktop, locally, the idle is right: arms hang, elbows bent, fingers curled
(the `-hand` frames). So the owner's phone shows something else. In the 24 talk
frames (half a second apart) the arms barely change: on desktop the strokes are
too small to read at full-body framing.

## Likely causes, most likely first

1. **The phone is not running the relaxed idle.** Either the Vercel deploy is from
   a branch without ID1/VS2 (check which branch Vercel builds; `RelaxedIdle.js` and
   `SpeechGestures.js` are on `ultimate`), or a phone-only path skips
   `NaturalPosePlugin` / recaptures rest from the T-pose. The A-pose in the idle
   frame (not speaking) matches `lecturerNeutral` alone on top of a T-pose rest:
   36° down ≈ arms 54° out, hands uncurled.
2. **The talk-style sine waves are still on.** `explainCalm` swings both arms
   continuously under the gestures; it should be off when SpeechGestures is
   present (SG1 says so; the code does not).
3. **No hand shapes in any gesture**, and none at all on phone/VR. A real speaker's
   hand changes shape with the stroke (relaxed curl at rest, open palm for
   "you"/palms-up, loose fist for a beat, index for a point). Flat fingers on a
   moving arm read as a mannequin.
4. **Wrists never move.** Every gesture's `rightHand` offset is ~0, so the wrist
   stays locked in line with the forearm through the stroke; real wrists lag the
   forearm (follow-through) and settle a beat later.
5. **Gesture amplitude on desktop is too small to read** at full-body framing (no
   visible change across 24 talk frames), while on the phone the one visible
   stroke pushes the forearm straight at the camera.

## What to do next (in this order, measuring before and after each)

1. Reproduce on the phone viewport: `node tools/qa/idle-pose-check.mjs --mobile
   --vrm vendor/avatars/Sendagaya_Shino.vrm --wait 6 --out <scratch>` (the
   `--mobile` flag was added for this; the first run timed out at 400 s in a cloud
   container — give it `timeout 900`). If the phone shows the A-pose locally, find
   the phone path that loses `relaxedIdle`; if it does not, the deploy is stale.
2. Turn `applyTalkStyle` off in talk mode whenever `NEXUS_SPEECH_GESTURES` is
   loaded (keep the jaw fallback); measure the talk frames again.
3. Add hand shapes per gesture (finger curls, as `RelaxedIdle.CURL` does for the
   idle): `open` for palm-to-you/palms-up/open-arms, `soft` (the idle curl) between
   strokes, `beat` a loose fist. Keep fingers on phone and VR but with fewer bones
   (proximal joints only) instead of none.
4. Wrist follow-through: a small wrist offset that peaks ~80 ms after the forearm
   and settles in the hold (`prep`/`rel` already exist per gesture).
5. Re-tune amplitudes with `tools/qa/gesture-tune.mjs` against
   `tools/qa/GestureBodyCheck.js`, then `npm run audit:gestures` (desktop) and the
   `--mobile` idle check; look at every frame, not only the numbers.

Tools: `audits/gestures/run.mjs` (every gesture held at its peak, body checks),
`tools/qa/idle-pose-check.mjs` (idle measured + talk frames; `--mobile`),
`tools/qa/gesture-tune.mjs` (the tuner). Frames go to the scratchpad or `runs/`,
never committed.
