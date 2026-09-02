# Behavior Director — visual QA checklist

**Batch B19.** The third audit, and the one no script can run. Two are automated
(`scripts/audit-budgets.mjs`, `scripts/audit-privacy.mjs`); this one is a person, a headset
and about forty minutes.

It exists because the things that make an avatar feel alive are not properties of the code.
A crossfade with no pop, a glance that lands at the right moment, a silence that reads as
company rather than absence — a test can prove the quaternions are unit-length and the gate
refused, and none of that tells you whether it looked right.

## How to run it

```bash
node scripts/audit-budgets.mjs --check     # must pass first
node scripts/audit-privacy.mjs --check     # must pass first
```

Then, in the browser:

1. Settings → **BEHAVIOR ENGINE (BETA)** → on. Reload.
2. Add `?behaviorDebug=1` to the URL. The HUD appears bottom-right: layer weights, the last
   five picks with scores, and the session state.
3. Work down the list below on **each avatar in the main set**. A row is green only if it is
   green on all of them — a blend that works on one rig and not another is a retarget bug,
   which is exactly the class this catches.

Record the result at the bottom, signed. An unsigned checklist is not a green audit.

---

## A · Boot and inertness

| # | Check | Green when |
|---|---|---|
| A1 | Flag **off**, reload, use the app for five minutes | Nothing changed. No network request under `src/behavior/`, nothing new in the console |
| A2 | Flag **on**, reload | Console logs clip counts by kind; the avatar behaves as before until she is spoken to |
| A3 | Flag on, no `?behaviorDebug=1` | **No HUD.** The HUD is a second switch, not a consequence of the first |
| A4 | Toggle the flag off again, reload | Back to A1 exactly |

## B · Motion quality — the reason this engine exists

| # | Check | Green when |
|---|---|---|
| B1 | Say something warm, then something sad, in quick succession | The handover is a crossfade, not a cut. **No pop at the transition** |
| B2 | Trigger a procedural idle, then a BVH clip, then a VRMA clip | All three handovers are smooth. Watch the hips especially |
| B3 | While a full-body clip plays, keep talking | Lipsync keeps running. The mouth does not freeze for the clip's duration |
| B4 | Same, but watch the head | She still looks where she was looking. The head layer survives the body clip |
| B5 | Ask for the same emotion five times in a row | Five different clips, or at least not the same one twice running |
| B6 | Watch her idle for two minutes with no input | She moves. It does not loop visibly |

## C · Joint attention (Together Mode)

| # | Check | Green when |
|---|---|---|
| C1 | Start Watch Together with a local file | The screen is curved, in front of you, and does **not** follow your head as you turn |
| C2 | Same, in AR | The screen pins to a surface. No skybox is drawn over the room |
| C3 | Watch for two minutes | Her gaze rests on the screen and glances at you every 8–20 s. The glance is about a second — a look, not a stare |
| C4 | Watch a dialogue-heavy scene | **She says nothing.** This is the flagship behaviour: silence between openings is the feature |
| C5 | Pause the film | She may speak now, and it feels like a natural moment rather than an interruption |
| C6 | Talk over her while she is mid-sentence | She stops or does not start. She does not talk over you |

## D · Music

| # | Check | Green when |
|---|---|---|
| D1 | Play a track with a clear beat | She starts moving within a few bars, in time |
| D2 | Play a quiet acoustic track | She sways. She does not break into a full dance |
| D3 | Stop the track mid-dance | The dance ends within about two seconds. **Nothing is left running** |
| D4 | Play a track with a long quiet intro | She waits for the beat rather than dancing to the silence |

## E · Scenes

| # | Check | Green when |
|---|---|---|
| E1 | Enter forest, ocean, meditation in turn | Each loads under 3 s warm. Fallback colour is acceptable while the art is absent |
| E2 | Enter and leave a scene ten times | Everything is exactly as it was. Lighting, background, her manner |
| E3 | Sit a full meditation | **She says only the script lines**, at their times. Nothing else, at any point |
| E4 | Enter a scene in AR | Profile and anchors apply. No skybox over the room |

## F · Consent — nothing here may be amber

| # | Check | Green when |
|---|---|---|
| F1 | Start a screen share | The red indicator appears **immediately**, in 2D |
| F2 | Same, in the headset | The marker is visible in XR and stays in view when you turn around |
| F3 | Stop sharing from the browser's own bar | The indicator clears **at once**. Not on the next frame you happen to look |
| F4 | Ask "what do you think of this?", then stop sharing before she answers | Her answer never arrives. Nothing is spoken |
| F5 | Decline the microphone when asked | Everything else keeps working. Typed chat, gestures, the session |
| F6 | Decline the screen share | Same |

## G · The HUD itself

| # | Check | Green when |
|---|---|---|
| G1 | Watch a crossfade with the HUD open | Layer weights move visibly and sum sensibly |
| G2 | Trigger a gesture | A new pick appears at the top, with the runners-up and their scores |
| G3 | Trigger something with no matching clip | An entry appears with `—` as the choice. A refusal is a decision worth seeing |
| G4 | Leave the HUD open for ten minutes | No slowdown. The pick list stays at five |

## H · Budgets, on the device

The numbers the Node audit cannot produce. Use the headset's own performance overlay.

| # | Check | Green when |
|---|---|---|
| H1 | Idle with the engine on | Framerate is the same as with it off |
| H2 | Watch Together, 1080p source | Sustained ≥ 30 fps on Quest-class hardware |
| H3 | A busy moment: clip playing, music analysing, session up | Frame time stays under budget; no stutter at a crossfade |
| H4 | Enter a scene | Under 3 s warm |

---

## Result

```
Avatars tested       ____________________________________
Device               ____________________________________
Build / commit       ____________________________________

Section A  ☐ green   ☐ issues: ______________________
Section B  ☐ green   ☐ issues: ______________________
Section C  ☐ green   ☐ issues: ______________________
Section D  ☐ green   ☐ issues: ______________________
Section E  ☐ green   ☐ issues: ______________________
Section F  ☐ green   ☐ issues: ______________________
Section G  ☐ green   ☐ issues: ______________________
Section H  ☐ green   ☐ issues: ______________________

Signed               ____________________  Date __________
```

**Section F may not ship amber.** Every other section is a judgement about quality; F is a
promise about the user's camera and screen, and a doubt there is a stop.

## Then, and only then

The client default flips — `config/behavior.config.json` → `behaviorEngine.enabled: true` —
**in its own PR**, with this signed checklist and two green audit runs attached. Never in a
PR that also changes behaviour: a default flip should be a one-line diff, so that if it has
to be reverted at midnight, reverting it is also one line.

HomePilot's `avatar.enabled` does **not** flip. It stays opt-in and documentation-first —
see `HomePilot/docs/AVATAR_ENABLING.md`.

## I. Coach mode on the reference device (B27)

The one acceptance criterion in this plan that names a device. `scripts/audit-budgets.mjs`
measures the engine half (0.0009 ms/frame) and cannot measure the rest.

| # | Check | Result |
|---|---|---|
| I1 | Sustained framerate with Pose active and an avatar loaded, Quest-class hardware | ☐ |
| I2 | Pose detection holds 15–20 fps rather than degrading under thermal load | ☐ |
| I3 | Fidgets visibly stop while a set is running, and resume when it ends | ☐ |
| I4 | Reps counted from a real person match what they counted, ±1, over three sets | ☐ |
| I5 | A squat, push-up, plank or lunge demo is refused by name rather than substituted | ☐ |

Section I may not ship amber.

## J. Adult tier, end to end (B28, B29)

Every invariant in §16.7 is enforced by a test, and those tests pass. What no test in either
repository can do is drive the whole round trip on a real instance with a real socket — the
tests set a blackboard flag where a person would wait for an ack. That is what this section
is for, and it is the reason the tier's flag stays false until somebody signs it.

| #  | Check | Result |
|----|-------|--------|
| J1 | With `avatar.adult.enabled=false`, `adult_verify_request` over a live socket returns `adult_unavailable` and the tier is absent from the UI | ☐ |
| J2 | On a second user account, the server logs owner-attest refusing to load and the tier stays unavailable | ☐ |
| J3 | On a single-user instance with the flag on, the ack arrives, `adultVerified` goes true, and the mode activates | ☐ |
| J4 | Killing the socket mid-session drops verification; reconnecting re-asks rather than resuming | ☐ |
| J5 | The clip recorder is observably stopped on entry — ring buffer empty, not merely the button hidden | ☐ |
| J6 | Soft exit (`cozy`) from level 4 lands warm with no remark; hard exit (`stop`) lands in companion with a neutral idle | ☐ |
| J7 | Over a full session, nothing in the tier is ever initiated by her | ☐ |
| J8 | A memory write after an evening contains warmth and pacing only — read the LTM row directly | ☐ |
| J9 | Leaving the tab idle past `decayAfterMs` returns the level to 1 | ☐ |

Section J may not ship amber, and the tier's flag may not flip until it is signed.

## K. Ignition, in a browser (B33)

Every section above assumes the engine is running. Until B33 it never was: the bootstrap sat
in a function only the legacy engine path calls, so the toggle wrote a key nothing read. No
automated gate caught it, because each one tests the engine rather than its ignition, and
each unit test is handed the dependency production forgot.

So this section is short and it is not optional: **open the app and look.** It is the check
that would have failed on the day B3 landed, and it is worth more than the 2,159 tests
around it.

| #  | Check | Result |
|----|-------|--------|
| K1 | With the toggle **off**, the Network panel shows no request under `src/behavior/`, and `window.NEXUS_BD_ENABLED` is `false` — not `undefined` | ☐ |
| K2 | With the toggle **on** and a reload, `window.NEXUS_BD` exists and the footer reads 🎯 🎭 👤 👥 🪟 📞 — the two-person button in cyan, the same square as its neighbours | ☐ |
| K3 | It opens the chooser, and picking an activity starts it — the round trip a console call never proved | ☐ |
| K3b | While an activity runs, the button turns green with a corner dot and its tooltip reads "Together — <name> running" | ☐ |
| K4 | `?behaviorDebug=1` shows the HUD ticking: Tier 0 is advancing, so the ViewerEngine path's own rAF is running | ☐ |
| K5 | Toggling off and reloading returns the footer to exactly the five buttons it shipped with | ☐ |

### Reproducing the README screenshots

`assets/companion-mode.png` and `assets/together-mode.png` are captures of this build, not
mockups. To retake them: serve the repo (`npm run dev`), drive it with a headless Chromium at
1440×900 and `deviceScaleFactor: 1.5`, seed `localStorage.nexus_bd_enabled = 'true'` before
load, and give the avatar ~20 s to arrive.

Two notes for whoever redoes them. `@pixiv/three-vrm` is loaded from unpkg through the import
map, so a machine without egress must serve that one module locally or the avatar never
appears — the app degrades to chat-only rather than failing loudly, which is easy to mistake
for a broken capture. And on Chromium, 🪟 opens a Document Picture-in-Picture window that a
page screenshot cannot see; `companionMode.activate('inpage')` selects the in-page overlay,
which is the strategy Firefox, Safari and mobile get anyway.
