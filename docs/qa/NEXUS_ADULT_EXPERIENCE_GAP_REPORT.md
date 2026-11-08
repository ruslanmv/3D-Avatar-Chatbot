# NEXUS adult experience — gap report (AX)

**Date:** 2026-11-08 · **Branch:** `feat/living-worlds-spatial-storytelling` · **Design:** `docs/engine/NEXUS_ADULT_EXPERIENCE_ARCHITECTURE.md`

Every restriction found in the Private experience, read from the code, classified, and what was done.
Categories:

- **Product** — a configuration choice from the earlier specification
- **Defect** — the code does not do what its own design says
- **Provider** — set by the AI provider, not by NEXUS
- **Compliance** — a legal or deployment requirement
- **Safeguard** — a real protection, kept intact

Evidence for every implemented row:

- `tests/private-world/adult-experience.test.js` (25 tests)
- `npm run validate` exit 0: 6077 tests in 275 suites
- the behaviour parity check: OK

## 1. Restrictions found

| # | Current behaviour (before AX) | Source | Root cause | Category | Correction | Status |
| --- | --- | --- | --- | --- | --- | --- |
| AX-G1 | Private never reaches level 4, although ConsentFlow and the adult profile define four levels and a procedural `intimate` behaviour exists | `PrivatePace.ceilingOf` clamps to 3; `registerLines` clamps to 3; `PACE_LABELS` has three names; presets stop at `maxLevel: 3` | The earlier spec stopped at Sensual, and three files hardcoded it independently | Product | Mature style (ceiling 4), pace step "Intimate" in all nine languages, a level-4 register; ceiling = min(style, capability), installed on ConsentFlow | **Implemented**; tests 1, 2–3, 9 |
| AX-G2 | No notion of what the model may write; Sensual was presented as the top of everything | `TogetherCapability.privateSystemPromptSuffix` | Style, intensity and content capability were one value | Product | `PrivateExperienceProfile.resolveCapability`: provider × deployment × attestation, with `limitedBy` reasons | **Implemented**; test 4 |
| AX-G3 | A provider's refusal arrived as whatever the model wrote — often a pasted policy apology that broke the scene | prompt had no instruction for meeting a boundary | Not designed | Defect (experience) | One line: say it once, warmly, in her own words, no policy language or apology, never repeated | **Implemented**; test 10 |
| AX-G4 | Every reply hard-limited to two sentences, including "tell me about this place" | `privateLengthLines`, `lengthReminder` (P22) | P22 fixed a reported nine-sentence reply with a flat limit | Product | Length follows the turn: 1 (quiet), ≤3 (conversation), ≤4 (question, request, scene). Still a stated hard limit, still repeated last; the token budget is unchanged | **Implemented**; tests 8 and rewritten P22 tests |
| AX-G5 | The room on screen was not described unless the premium Private World gate was open | `privateRoomChunk` only | Scene context existed only in the PW adapter | Defect (context) | `privateScene` + `sceneLines`: the world Private asked for, once on screen | **Implemented**; test 8 |
| AX-G6 | The ladder printed the preset's ceiling, not the session's | `privateSystemPromptSuffix`, `IntimateExperienceSession` | One number assumed | Defect (once the capability can narrow it) | `sessionCeiling` / `_ceiling()` everywhere the ladder is drawn or stepped | **Implemented**; tests 2–3 |
| AX-G7 | Mature would have spoken Affectionate's scripted lines and been dropped from session memory | `PrivateBeats.poolFor`, `PrivateMemory.FIELDS` | Closed lists | Defect (new) | Mature uses Sensual's pool; memory accepts it | **Implemented** |
| AX-G8 | Repeated consent talk, formulaic questions, AI disclaimers, topic menus | `presenceLines`, `attentionLines`, `slowedLines` | — | Already addressed (P21, P22, P32) | Kept: these instructions already say not to re-check consent, not to end every reply with a question, not to explain itself | No change needed |
| AX-G9 | Style presentation (voice rate, gaze, mood light, level intents) is computed but not yet applied to TTS rate or the behaviour selector | `PrivateExperienceProfile.presentationFor` | New | Product (open) | Wire `voiceRate` into `speakText`'s Private path and `mood` into `runtime.setMood` at session start | **Not done**; needs a browser check |
| AX-G10 | Hosted providers may refuse adult content regardless of NEXUS settings | provider APIs | Each provider's acceptable-use policy | **Provider** | NEXUS defaults every provider to `sensual`; a deployment raises one only by naming it after reviewing its terms. NEXUS does not try to defeat a provider's safeguards or hide the application's purpose | By design |
| AX-G11 | The client trusts `blackboard.adultVerified`; anyone can set it from the console | `SessionAdapter`, every gate | Client-side checks | **Compliance** | Unchanged and documented. Server-side enforcement on every model request and private asset is required | Release blocker 1 (`PRIVATE_WORLD_RELEASE_READINESS.md`) |
| AX-G12 | Age assurance is a device-local self-declaration (`SpicyGate`) | `src/SpicyGate.js` | Earlier specification | **Compliance** | Tiers above `sensual` additionally need the server attestation | Release blocker 2 |
| AX-G13 | `proactiveNsfw: false`; the ranker refuses an nsfw clip the person did not ask for | `adult.profile.js`, ranker | — | **Safeguard** | Kept; test 5 asserts it | Kept |
| AX-G14 | Live consent: the person's steps only, a 4 s double-tap guard, decay, soft and hard exit words | `ConsentFlow.js` | — | **Safeguard** | Kept; tests 2–3 and 6 run against the real flow at level 4 | Kept |
| AX-G15 | Avatar adulthood declaration | `AvatarAdultDeclaration.js` | — | **Safeguard** | Kept; Mature starts only after it, as every style does | Kept |
| AX-G16 | Private state isolated from Copilot, Life, Experiences and history | `PromptContext`, the Private card's in-memory history | — | **Safeguard** | Kept; test 7 | Kept |
| AX-G17 | "Adults only, fiction, never a real or underage person" line | `privateSystemPromptSuffix` | — | **Safeguard** | Kept verbatim at every tier | Kept |

## 2. What a person sees today

Nothing changes in any shipped build:

- same three styles, same ceilings, same prompts' safety half
- no NEXUS content rule beyond the provider's
- replies may now run to three or four sentences when the turn calls for it
- she is told how to meet a boundary gracefully

Mature and the declared tiers appear only on a deployment that sets `NEXUS_ADULT_EXPERIENCE_CONFIG` and
attests the session server-side.

## 3. Not verified

- **Real-model behaviour.** No real-model run was made for this change: the register, length and
  boundary lines are untested against a live provider. The next step is the existing harness pattern
  (`docs/qa/PRIVATE_WORLD_EXPERIENCE_EVALUATION.md`) with non-explicit lines, per provider.
- **Browser.** No browser run of the Mature setup screen; the ladder's fourth step is tested in jsdom
  only.
- **Hardware.** No hardware.

## 4. Remaining blockers before any deployment raises a tier

1. Server-side enforcement of eligibility and tier on every model request and private asset.
2. Age assurance per market.
3. Compliance review of each declared tier per market.
4. A provider-terms review for each provider a deployment names.
5. Real-model evaluation per provider with the rubric.
6. AX-G9 wiring, then a browser check.
