# UN6 — Private positions, verified on the rendered avatar

**Branch:** `una-notte` (on top of `e77ae51`, the UN5 real-3D check).
**Source integrated:** `feat/grounded-hands-knees-pose-audit-20261114` (7 commits,
cherry-picked unchanged as `ff0c5bc`…`abad369`; base `6b4e123` is an ancestor of
`una-notte`, so no conflicts).
**Avatar:** `vendor/avatars/AvatarSample_A.vrm`, its own clothing, and the
Private lingerie look Forge serves after "Spogliati".

A recognised request, or the preset name the pose system reports, is not proof
of a posture. Every result below was measured on what the GPU draws: the raw
humanoid bones that skin the mesh, and skinned vertex positions
(`SkinnedMesh.boneTransform`), against the plane her standing soles rest on.

## Tools

| Tool                                        | What it does                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/qa/pose-render-probe.js`             | Page-side measuring: sole plane (T-pose, lowest foot/toe skin), trunk and limb directions, palm / knee / sole skin heights, fingers-forward, palm-down (thumb towards her midline), raw-vs-normalized hips, avatar identity. Matching cameras (front, back, left, right, q3, top, low, hands) and a grid drawn exactly at the sole plane while shooting — never moved to fake contact. |
| `tools/qa/private-pose-render-audit.mjs`    | The real Private flow: the page's own avatar load, the cabaret, ConsentFlow at 4 (as the screenshot harness simulates "Più vicino"), the composer's two listeners per line (motion fast path, then the conversation surface), Italian. Waits for `vrPoseSystem.isSettling()` to end before sampling. `--rescore` judges a saved run again; `--quick` is the short sequence.            |
| `tools/qa/hands-knees-visual-audit.mjs`     | The source branch's gate, upgraded: pose owner asserted to be the displayed avatar, real settle wait instead of a fixed 1.8 s, rendered palm and knee skin instead of joints, fingers-forward and palm-down.                                                                                                                                                                      |

## Root causes found

1. **"Alzati" reported standing while she rendered crouched.** The composer
   hands every line to the motion fast path _before_ the conversation reaches
   Private. "Sdraiati sul fianco" therefore started the chat stack's lie-down
   clip and set `NEXUS_MOTION.state.laying`; the pose system then claimed her.
   On "Alzati" the release lifted the hold, `_scheduleIdle` saw `laying` and
   played `lay_idle`: the pose system said `standing`, her rendered hips were at
   0.18 m. Fix: `PrivateActionBridge.ownsBody(text)` — the fast path stands
   aside (look-at only) for words Private turns into a position — and releasing
   a Private position leaves the motion stack standing
   (`PrivatePoseController.exitPoseMode`). Verified: standing after every
   ground pose, both passes, desktop and phone (hips 0.95–0.96 m, soles on the
   plane, `sitting`/`laying` false).
2. **Bent over / bent backward: reversed signs, no leg counter-rotation.** On
   the normalized rig a negative X on hips/spine flexes forward. The old "Bent
   Over" leaned her whole body 40° _backward_ like a plank (soles 7 cm in the
   floor); "Bent Backward" leaned 22° forward; the upper arms sat 25–30° below
   the T-pose. From the front all of it read as "upright, arms out".
3. **Lying on the side was on her back.** Euler order is XYZ: hips
   `(90, 0, -90)` rolled her and then turned her chest up. Now `(0, 0, -90)`.
4. **Joint grounding floated every ground pose.** MO5 lowered the lowest
   _joint_ to the height of her standing toe joint; on this avatar that left
   kneeling with the knees' skin 12–14 cm up and hands-and-knees ~10 cm up. The
   front camera hid it. Settled poses are now grounded on rendered skin
   (`lowestSkinY`), raised as well as lowered, with joint grounding as the
   fallback.
5. **A transparent strip in the tights.** A 28 cm strip at floor level, 30 cm
   out from the right foot, drawn but cut out by the texture's alpha, read as
   "the lowest point of her foot" and held her back 17–19 cm off the floor when
   lying on it. Contact skin now skips undrawn vertices, vertices leaning on
   non-humanoid bones, and per-bone bind-pose outliers (distance from the bone
   segment beyond 2 × p95 + 3 cm, pooled over all meshes). The standing-sole
   reference keeps outliers (the sole is an extreme by definition).
6. **Kneeling had its shins tipped 45° up** (knee −145° with upright thighs):
   grounded properly, the feet hung 27 cm in the air. Now −96° knee, −70° ankle.
7. **Lying on the stomach was a push-up's top** (straight arms). Now a natural
   prone rest: pelvis, thighs and forearms on the floor, chest lifted, head up.

## Results — desktop 1440×900 and phone 390×844, the same numbers

Heights in metres above the plane her soles stand on (shoes: −0.060 m; the
barefoot lingerie look: −0.001 m). Two passes in one session on desktop, one on
phone; 0 page errors.

| Said                    | Routed preset          | Rendered                                                                                       | Classification        |
| ----------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- | --------------------- |
| Inginocchiati           | `kneeling`             | upright trunk (3–5°), shins on the floor (0.003–0.013), insteps 0.03–0.04                      | **READY**             |
| Girati (×2)             | turn (root yaw)        | 3.14 → 6.28 → 3.14, posture identical, every step                                              | **READY**             |
| Sdraiati sulla pancia   | `lyingFront`           | pelvis 0.003, thighs 0.012, forearms 0.012–0.029; chest lifted                                 | **READY**             |
| Sdraiati sulla schiena  | `lyingBack`            | back of hips/thighs/head on the floor (0.003–0.035); heels 14–16 cm _below_ the plane          | NEEDS IMPROVEMENT     |
| Sdraiati sul fianco     | `lyingSide`            | trunk horizontal on her right side, facing front; right arm/hip/thigh on the floor             | **READY**             |
| Piegati in avanti       | `standingBendForward`  | trunk 57° forward, legs vertical, arms hanging, soles 0.003–0.008                              | **READY**             |
| Inarca la schiena       | `standingBentBackward` | trunk 30° back, chest open, arms down, soles 0.003–0.018                                       | **READY**             |
| Torna come prima        | previous position      | back to the bend, identical numbers                                                            | **READY**             |
| Mettiti a quattro zampe | `handsKnees` (level 4) | knees 0.001–0.020, palms 0.010–0.016, fingers forward 0.99, thumbs medial (palms down)         | **READY** (see below) |
| Spogliati (in position) | lingerie look          | position kept on the new outfit; palms/knees on its own sole plane (−2 mm)                     | **READY**             |
| Alzati (after any)      | release                | hips 0.95–0.96, trunk ≤ 8°, soles on the plane, motion stack standing                          | **READY**             |
| Ho finito, rivestiti    | original outfit        | dressed again, standing, same avatar URL                                                       | **READY**             |
| Fine                    | end                    | released, standing, original outfit                                                            | **READY**             |

**Hands and knees.** The approved body is unchanged: hips −78°, knees −99°,
legs and feet as in the candidate. The hands are turned palm-down, fingers
forward, from the rig's own frame (normalized rest = VRM T-pose, palms down;
a yaw about "up" until the middle finger points the way she faces), computed
before the blend so they ease in. The knees' skin is grounded on the sole
plane; then each hand is brought down by the arm chain's existing CCD IK
(shoulder, upper and lower arm), never by the hips. **Residual palm gap
10–16 mm**: the arms are straight at the elbow's joint limit, so the hand
cannot go lower without lowering the pelvis, which the brief rules out.
`PrivatePoseController.confirm()` accepts ≤ 20 mm; a pose whose palms do not
land is reported `failed / not-rendered` and she returns to the previous
position.

**Lying on the back** is classified NEEDS IMPROVEMENT: her back now rests on the
floor, but with the legs straight along the rest line the shoes sit 14–16 cm
below the plane (they were 13 cm below before, with her body also floating).
It needs a small hip flexion that lifts the legs — a shared preset change to
make with the same measure-and-look loop.

**Pace.** "Ho finito" lowers the pace (ConsentFlow, the person's move): in the
second pass "Mettiti a quattro zampe" was `blocked / pace`, as the gates
require. The audit does not raise it again.

## Asset provenance

No third-party animation or model was imported or derived in this work. The
KinemIQ Female Crawl (CC BY 3.0, Open Motion Project by ACCAD / The Ohio State
University, https://creativecommons.org/licenses/by/3.0/), KinemIQ Idle Lying
Female (CC BY 3.0, same attribution), KinemIQ Fixing Kneeling (CC0 1.0) and the
Quaternius Universal Animation Library (CC0 1.0) were reviewed in an earlier
session; the trial crawl retarget was rejected as a held reference (asymmetric
reaching) and nothing from them is in this branch. `handsKnees` is a
hand-authored preset; its hand orientation is computed at runtime from the
avatar's own bones.

## Gates

- `npx jest tests/vr/hands-knees-candidate.test.js --runInBand` — 4 passed.
- `tests/vr/un6-pose-fixes.test.js` — the causes above, locked (7 tests).
- `tests/behavior/private-actions.test.js` — all-fours is `handsKnees`, never a
  standing bend; a hands-and-knees whose palms did not land is a failure and
  she goes back; with Spicy off it is refused.
- Parity baseline re-recorded: the candidate's one `NAV_PRESETS` line moved
  five frozen `PoseStudioPanel.js` references down by one; nothing else.

## Measured gates (2026-11-15)

| Gate                                                        | Before edits         | After                                                |
| ----------------------------------------------------------- | -------------------- | ---------------------------------------------------- |
| `node audits/motion/run.mjs --quick --only poses`           | PASS 26 · 0 · 0      | PASS 26 · 0 · 0                                      |
| `tools/qa/hands-knees-visual-audit.mjs`                     | (joints, fixed wait) | `pass-contact-gate-only`: palms 12–16 mm, knees 3–20 mm |
| `tools/qa/private-pose-render-audit.mjs` desktop, 2 passes  | —                    | 46 steps, 0 page errors; 1 flag (see below)          |
| `tools/qa/private-pose-render-audit.mjs --quick` phone 390  | —                    | 0 failed checks, 0 page errors                       |
| `npm run validate`                                          | parity drift (3)     | exit 0 — 306 suites, 6582 tests                      |

The one desktop flag is kneeling on the barefoot look, measured against the
shoe plane because that run predates `lastSupport.floor`; against its own
plane the knees are at 0.04 m.

The motion audit caught a regression on the way: instant presets applied by
Pose Studio without a claim were grounded on the previous pose's skin (three-vrm
copies the normalized rig to the skinned bones only in the next
`vrm.update()`), and her hips climbed preset by preset. Skin grounding now
syncs that copy first, and falls back to joints when nothing copies this
system's pose to the mesh.

## Screenshots

Same avatar, matching cameras, the grid drawn at the measured sole plane.

- Before: `un6/before-bend-arch-side-handsknees.jpg` (bent over leaning back,
  bent backward leaning forward, "on the side" on her back, candidate floating),
  `un6/before-private-flow-desktop.jpg` (the reported defects in Private).
- After: `un6/after-side-on-sole-plane.jpg` (every position from the side, on
  the plane), `un6/after-bend-arch-side-views.jpg` (front, back, three-quarter,
  top), `un6/after-handsknees-kneeling-views.jpg` (hands and knees from six
  views plus the palm close-up; kneeling), `un6/after-private-flow-phone-390.jpg`
  (the Private flow at 390 px: the 3D view is the compact card, unchanged).
