# NEXUS adult experience architecture (AX)

How a Private session decides what kind of evening it is, how far it may go, and what the model may
write — as four separate questions with four owners. The audit behind this is
`docs/qa/NEXUS_ADULT_EXPERIENCE_GAP_REPORT.md`.

**Status:** implemented, tested, and inert in every build. Every build resolves to the behaviour
Private already had: three styles, a ceiling of three steps, and no content rule of NEXUS's own on top
of the provider's. The new fourth step and the content declarations open only when a deployment
declares them *and* the session carries the server's attestation.

## 1. The four dimensions

| Dimension | Question | Owner | Where |
| --- | --- | --- | --- |
| **Style** | What kind of evening? | The person, on the setup screen | `STYLES` in `src/features/together/PrivateExperienceProfile.js`; presets in `TogetherCapability.PRIVATE_PRESETS` and `INTIMATE_PRESETS` in `src/features/together/activities/playground.js` |
| **Intensity** | How far, right now? | The person, one deliberate step at a time | `src/behavior/ConsentFlow.js` (`initiated`, `eased`, `hear`) — unchanged |
| **Ceiling** | How far may it go? | min(style, capability) | `ceilingFor()`, installed on ConsentFlow by `Intimate._installCeiling` |
| **Content capability** | What may the model write? | Provider × deployment × attestation | `resolveCapability()` / `capabilityFor()` |

A higher consent level is permission inside the capability, never past it. The capability never moves a
level, and nothing here reads what the person says.

## 2. Styles

| Style | Ceiling | Needs tier | Notes |
| --- | --- | --- | --- |
| Affectionate | 1 (Warm) | romantic | unchanged |
| Romantic | 2 | romantic | unchanged |
| Sensual | 3 | sensual | unchanged |
| **Mature** (AX1) | 4 (Intimate) | mature | new; offered only where the capability reaches `mature` |

Playful and Tender stay what they were: a *mood* chosen inside any style, not a style of their own.
The fourth step was already defined by the adult profile (`intensityCeilingByLevel[4]`, the procedural
`proc_behavior_intimate` behaviour) and was unreachable from Private: `PrivatePace.ceilingOf` and the
prompt's register both clamped to three. They now go to four; only Mature's ceiling uses it.

## 3. Content capability

Tiers, least first: `romantic` < `sensual` < `mature` < `explicit`.

```
providerTier = deployment.providers[provider]  ?? NEXUS default for the provider (sensual)
siteTier     = deployment.contentTier          ?? sensual
tier         = lowest(providerTier, siteTier)
if tier > sensual and not blackboard.adultVerified:  tier = sensual
```

- **Deployment** is `window.NEXUS_ADULT_EXPERIENCE_CONFIG`, set by the site before the app loads — never
  a setting, never storage. Absent is the shipped state.
- **Provider** is `nexus_llm_settings.provider`. NEXUS's default for every provider (OpenAI, Claude,
  watsonx, Ollama, OllaBridge, none) is `sensual`. That is NEXUS's conservative baseline, **not a claim
  about any provider's policy**. A deployment raises a provider's tier only by naming it, after checking
  that provider's current terms and the model it actually serves. Hosted providers' acceptable-use
  policies are the provider's to set; NEXUS never tries to route around them and never disguises what
  the application is.
- **Attestation** is `blackboard.adultVerified`, written only by `SessionAdapter` from the server's
  message. Without it nothing above `sensual` resolves.
- `limitedBy` records which input set the tier (`provider`, `deployment`, `needs-server-attestation`,
  `no-deployment-config`, `unknown-provider`, `bad-…`), so "why can it not do X here" has an answer.

What the model is told (`capabilityLines`):

- **Undeclared** (every build today): no content rule of NEXUS's own — the product decision recorded in
  `tests/behavior/private-register.test.js` ("how explicit this gets belongs to the model and to whoever
  runs the install") is kept. One line tells her how to meet a boundary *in her own voice*: once, warmly,
  no policy language, no apology, no repetition.
- **Declared:** the tier is stated plainly (`CONTENT IN THIS SESSION: …`), plus the same line.

## 4. Storytelling (AX2–AX5)

- **Register per level**, including level 4 (`registerLines`). Written as who she is at that level, not
  as a page of prohibitions.
- **Length follows the turn** (`lengthLines`): one short sentence when they asked for quiet, three
  sentences at most in conversation, four when they asked a question, asked for something, or asked
  about the place. Still a stated hard limit, still repeated last (P22's fix kept), and the token budget
  (`PrivateTurnDirector.BUDGET`) still bounds it.
- **The room**: when Private asked for a world and it is on screen, one `WHERE YOU ARE` line from the
  catalogue (`sceneLines`, `TogetherCapability.privateScene`). The premium Private World paragraph
  replaces it when its own gate holds.
- **Scripted lines**: Mature speaks from Sensual's written pools (`PrivateBeats.poolFor`); its difference
  is the step and the capability, which the model carries.

Unchanged and still in force: who she is (`presenceLines`), attention, no stage directions, the choices
block, language lines, "do not infer consent", the soft and hard exit words, no coercion or dependency,
adults only and no real person.

## 5. Presentation and behaviour

`presentationFor(style, level, AdultProfile.intensityCeilingByLevel)` returns the style's voice rate,
gaze and mood preset, and the motion intents the ranker would admit at that level — so a style can only
name behaviours that exist and are already gated per level. A style cannot present a level above its
own ceiling. Wiring these into the live voice and animation selection is not done yet (gap report AX-G9).

## 6. Adding a premium setting

A new setting (romantic apartment, premium suite, lounge…) needs no new runtime:

1. A world rated as the experience requires, with measured spots (`HOW_TO_CREATE_A_PRIVATE_WORLD.md`).
2. If it is a private room with interactions, a Private World config.
3. If it needs a new kind of evening, a `STYLES` entry plus the matching preset in both preset tables,
   with its `needs` tier. Its ceiling is narrowed by the capability automatically.

## 7. Deploying a higher tier

```html
<script>
  window.NEXUS_ADULT_EXPERIENCE_CONFIG = {
    contentTier: 'mature',            // the site's own ceiling
    providers: { ollabridge: 'mature' } // per provider, after reviewing its terms
  };
</script>
```

This alone changes nothing for a session without the server attestation. Release blockers (server-side
enforcement, age assurance, compliance review) are in `docs/qa/PRIVATE_WORLD_RELEASE_READINESS.md` and
apply unchanged.

## 8. Tests

`tests/private-world/adult-experience.test.js` (25): style selection, intensity and ceiling against the
real ConsentFlow, provider capability resolution, no unsolicited escalation, stop and cleanup, no
leakage, context, languages, honest unavailability. The P22 length tests in
`tests/behavior/private-register.test.js` were rewritten to the new policy's properties.

## Turning Intenso on (AX21)

Intenso is the fourth Private style (`id: mature`, four steps). Every build in this repository
ships it **locked**: the setup screen shows the card disabled with one reason, and
`Intimate.start()` refuses it. It unlocks only when all three of these are true, checked again at
Start (not trusted from the setup screen):

1. **The site declares the level** for the provider in use, before the app boots:

   ```html
   <script>
       window.NEXUS_ADULT_EXPERIENCE_CONFIG = {
           contentTier: 'mature',
           providers: { ollabridge: 'mature' }, // only the provider(s) whose terms you checked
       };
   </script>
   ```

   Declare a provider only after reading its current terms for the model it actually serves. A
   provider that is not named keeps the `sensual` default.

2. **The server attests the person is an adult.** Only `SessionAdapter` writes
   `blackboard.adultVerified`, from the server's message. The in-app Private Mode switch never
   stands in for it; without it nothing above `sensual` resolves
   (`limitedBy: needs-server-attestation`, shown on the card as "Requires age verification").

3. **Private Mode is on** for the person, as for every Private style.

What Intenso changes once unlocked: four steps instead of three, all moved by the person; the
step-4 register and example lines (`PrivateVoice` `intense`, nine languages); six sentences for a
scene or a request from step 3 (`PrivateExperienceProfile.maxSentences`, the single source for the
prompt and for `shapePrivateReply`); the `intimate` animation intents of `adult.profile` level 4.

What it does not change: she never initiates, the proactive lines stay non-explicit
(`proactiveNsfw: false`), "cozy" and "stop" work as everywhere, care mode replaces the whole
register, and a provider's refusal is said once in her voice and never worked around.

Use one model for the whole session (not a route that switches backends per turn): her voice at
step 4 depends on it more than anything in the prompt.

The `explicit` tier is separate, uses the same two locks, and is not part of AX21.
