# NEXUS premium character architecture (AX7–AX8)

How one Private session becomes one coherent character: what she is told, what she says on her own, what
she sounds and looks like, and how anyone can measure whether it worked. Builds on
`NEXUS_ADULT_EXPERIENCE_ARCHITECTURE.md` (AX1–AX6: style, intensity, ceiling, capability, care), which
stays the reference for the content rules. The field-by-field contract is
`NEXUS_EXPERIENCE_PROFILE_CONTRACT.md`.

## 1. The audit this answers (HEAD `b97b74e`, before AX7)

Read from the source, not assumed:

| Question | Finding | Status |
| --- | --- | --- |
| Does a style change anything but words? | `PrivateExperienceProfile.presentationFor` computed a voice rate, a gaze and a light per style; **no code read it**. Affectionate and Mature sounded and looked identical. | Fixed — AX7 `PrivatePresentation` |
| Why does Mature feel like Sensual? | `PrivateBeats.poolFor('mature')` aliased the Sensual pool: same openings, same closings. | Fixed — own `POOLS.mature` |
| Do planner, live reply and provider share one ceiling? | No, and on purpose. The planner and the scripted beats are the **proactive** channel and are non-explicit by rule (`proactiveNsfw: false`, `plannerSystemPrompt`). Live replies are the **reactive** channel and follow the resolved capability. ConsentFlow's ceiling is min(style, capability) for both. | Documented — §3 |
| Does her face hold the mood? | Two owners reset the face to `neutral` unconditionally: BehaviorEngine's `_clearEmotion` (every IDLE and speech end) and AnimationManager's emotion timer. Measured by the lab: `happy` 0 at 6 s into a session that had applied 0.1. | Fixed — both settle to `restingExpression()` |
| Is gaze styled? | `presentation.gaze` (`soft`/`held`) is declared and not applied. Gaze belongs to BehaviorEngine (state-driven locks) and FaceTracker in Follow mode; a second writer would fight them per frame. | Not applied — stated, not claimed |
| Does music follow the style? | Yes, already: Private's preflight picks a soundtrack from the preset's query. | Exists |
| Is the model the same across turns? | **No.** OllaBridge routes are aliases over several backends; one 7-turn run on `free-best` was served by three different models. Persona drift between turns is partly that. | Measured — `NEXUS_CHARACTER_MODEL_EVALUATION.md` |
| What language does she answer in? | The app-wide language directive wins (`AppLanguage.directive`), so the app language — not the person's message — sets it. | Exists; the lab tests both |

## 2. The layers

```
deployment config ──► capability (tier)      PrivateExperienceProfile.resolveCapability
server attestation ─┘        │
style (chosen) ──────────────┼──► ceiling = min(style, capability) ──► ConsentFlow.maxLevel
person's steps ──────────────┘                                          │ (only the person moves it)
                                                                         ▼
                    ┌──────────────── level ─────────────────────────────┤
                    ▼                                                    ▼
   prompt (reactive channel)                         presentation (AX7)
   persona + register + capability lines            voice  adjustVoice() in both speech paths
   + length rule + scene + room + care              face   vrmLoader.setEmotion, resting warmth
                    │                               light  runtime.setMood, once, at start
                    ▼
   live reply ──► conversation surface ──► TTS (rate shaded) + lip-sync (same rate)

   beats + planner (proactive channel): non-explicit by rule, own pool per style
   care mode (AX6): overrides all of the above — calm voice, neutral face, care-only prompt
```

Owners do not change: ConsentFlow owns the level, the ranker and clip engine own her body, lip-sync
owns the mouth, the playground runtime owns the light, BehaviorEngine owns gaze. AX7 adds no new
writer for any of them; it asks the existing owner and records whether it answered.

## 3. Two channels, two rules

| | Proactive (beats, planner, ActivityVoice) | Reactive (her reply to the person) |
| --- | --- | --- |
| Who starts it | The app, on a timer or a step | The person's own turn |
| Content rule | Non-explicit, always (`proactiveNsfw: false`) | The resolved capability; undeclared adds no rule of NEXUS's own (AX1) |
| Ceiling | The level, never above it | The level, never above it |
| Why different | Nothing she says unprompted should outrun what the person asked for | The person leads; the deployment and provider bound it |

A Mature session therefore has a Mature voice in its beats — confident, unhurried, adult — written
within the proactive rule, and the explicitness of anything further is the reactive channel's.

## 4. Authorization is four questions with four owners

| Question | Owner | Can the person change it? |
| --- | --- | --- |
| Is the person an adult? | Private Mode confirmation (client) + `blackboard.adultVerified` from the server | Confirmation only; attestation is the server's |
| Does the avatar depict an adult? | `AvatarAdultDeclaration` (catalog / Forge `depictsAdult`) | No |
| What may this deployment and provider carry? | `NEXUS_ADULT_EXPERIENCE_CONFIG` + provider tier, lowest wins | No |
| How far tonight? | ConsentFlow, inside the ceiling | Yes — only the person |

Consent never widens a provider's or a deployment's tier, and none of these is a substitute for
another. Client checks are not authorization: release needs server-side enforcement
(`docs/qa/NEXUS_PREMIUM_RELEASE_GATES.md`).

## 5. Embodied presentation (AX7)

`src/features/together/PrivatePresentation.js`, boot list after `PrivateExperienceProfile`. The
session calls `_present(first)` at start, on every `adult:level`, and when care begins;
`afterActivityStop` calls `reset()`.

| Channel | How | Bounds | Measured in the running app |
| --- | --- | --- | --- |
| Voice | `adjustVoice({rate, pitch})`, consulted by `speakText`'s TTSProvider and WebSpeech paths after persona overrides; lip-sync starts at the same rate | ≥ 0.8 × the person's rate; −0.02 per step | Sensual: 0.92 → 0.90 after one step → 1 after End |
| Face | `vrmLoader.setEmotion('happy', i)`; transient expressions settle to it | 0.10 + 0.04 per step, ≤ 0.32 | VRM `happy` 0.14 at level 2, 0 after End |
| Light | `runtime.setMood(preset)` once, only with a room up | Never re-applied on a step | `applied.light` false without a room |
| Care | rate 0.95, neutral face, no light | Wins over everything | Unit-tested |

`state().applied` is `false` for every channel whose owner was missing. Nothing claims a face that
was not set.

## 6. The Character Quality Lab (AX8)

- **Deterministic:** `tools/qa/CharacterQualityScorer.js` — pure, same reply same score.
  Flags exactly what Private's prompt forbids (length, emoji, stage directions, unprompted AI
  disclaimer, topic menus, assistant register), the wrong language, and trigram repetition against
  earlier replies. `tests/private-world/character-scorer.test.js` uses replies real models gave.
- **Real provider:** `tools/qa/character-lab.mjs` drives the shipped page — Private started through
  the Together panel, each line through the conversation surface — so the model receives the product's
  real prompt. It reads the provider's responses for the served model and usage, times each turn,
  scores each reply with the same scorer, checks recall of an earlier turn, and records the AX7
  presentation at start, after a step and after End.
- **Human:** `docs/qa/NEXUS_PREMIUM_EXPERIENCE_SCORECARD.md` — what a script cannot judge.

Unit, browser, real-provider and device evidence are reported separately and never merged into one
number.
