# Intimate Mode

This document extends Together with a separate, gated **Intimate** activity. It is not part of
Playground and must never be reachable through ordinary family/general-audience flows.

The existing adult infrastructure is the authority. Do not replace it with a client-side age
checkbox or a second consent system.

## Product shape

```text
Together
├─ Watch
├─ Listen
├─ Playground
│  ├─ Scene Tale
│  ├─ Guided Daydream
│  └─ Mystery
└─ Intimate                  [gated / adult only]
   ├─ Romantic Evening
   ├─ Flirty Conversation
   └─ Sensual Story
```

Playground remains general-audience. Intimate is a separate capability with a separate activity,
prompt boundary, motion allowlist, privacy posture, and runtime gate.

The first production slice should emphasize presence rather than explicit sexual behavior:

- affectionate conversation
- romantic conversation
- playful flirting
- sensual-but-bounded atmosphere
- eye contact, smiles, gaze, restrained posture changes
- scene ambience and optional music

V1 should **not** add explicit sexual-act simulation or a new explicit animation pack.

## Reuse the existing adult gate

The repository already has a stronger adult gate than a self-attestation dialog. Keep it.

Intimate may be exposed only when all existing adult prerequisites are satisfied:

1. the deployment/server side has adult capability enabled and has produced the trusted
   `adultVerified` attestation;
2. the user has explicitly enabled `nsfwAllowed`;
3. `adult.available` is enabled so the consent flow exists.

`adultVerified` must remain server-authored only. Do **not** add a client setting, config key,
scene field, model instruction, localStorage value, or "I am 18" button that writes it.

If any prerequisite is false:

- the Intimate activity is unavailable;
- no intimate prompt suffix is injected;
- no adult motion ceiling is opened;
- a scene or generated plan cannot bypass the gate.

## Reuse AdultProfile and ConsentFlow

Do not invent a second escalation state machine.

The existing `adult.profile.js` and `ConsentFlow.js` already provide the core invariants:

- `requires: ['adultVerified', 'nsfwAllowed']`;
- `proactiveNsfw: false`;
- four internal levels;
- at least two minutes at each level before the next can be offered;
- an explicit affirmative or unmistakable user initiation is required to advance;
- ambiguity does not advance;
- `cozy` drops back to the lowest adult level;
- `stop` / `exit` leave the tier immediately;
- the clip recorder is torn down on entry;
- adult mode is reversible and session-scoped.

The new Intimate activity should be a product/UI orchestration layer **on top of** those rules,
never a replacement for them.

## User-facing intensity presets

Expose three understandable presets:

### Affectionate

Warm, caring, relaxed.

Examples of tone:

- compliments
- warmth
- gentle closeness
- playful kindness
- relaxed companionship

No sexual language.

Runtime ceiling for V1: **adult level 1 only**.

### Romantic

Adult romantic interaction.

Examples:

- attraction
- dating-style conversation
- gentle flirting
- romantic compliments
- playful tension
- tender fictional scenarios

Runtime ceiling for V1: **adult level 2**.

The session still starts at level 1. Reaching level 2 must happen through the existing earned
ConsentFlow path; selecting "Romantic" is a ceiling, not permission to skip the check-in.

### Sensual

Adult-only, suggestive atmosphere without explicit sexual-act simulation.

Examples:

- more intimate tone
- suggestive flirting
- longer eye contact
- restrained sensual wording
- romantic tension

Runtime ceiling for V1: **adult level 3**.

Again, the session starts at level 1 and may only progress through the existing ConsentFlow.

### Level 4 stays unexposed in V1

The existing adult profile has a fourth internal level. Do not expose it through this Intimate
UI in the first slice.

This matters for two reasons:

1. V1 remains romantic/flirty/sensual rather than explicit;
2. the current ConsentFlow needs at least six minutes and three explicit advances to reach
   level 4 anyway, so it does not fit the intended five-minute Intimate experience.

No code in this feature should weaken the existing four-level system merely to make a shorter
experience escalate faster.

## No automatic escalation

The selected preset is always a **maximum**, never an instruction to reach it.

Examples:

```text
Affectionate
  start level 1
  cap level 1

Romantic
  start level 1
  optional earned advance -> level 2
  cap level 2

Sensual
  start level 1
  optional earned advance -> level 2
  optional earned advance -> level 3
  cap level 3
```

The AI may become less intense at any time. It may never become more intense than both:

- the user's selected preset; and
- the current ConsentFlow level.

Friendly conversation, romantic scenery, music, silence, sentiment, or model inference must
never count as escalation.

## Together UX

When the existing adult gate is satisfied, Together may show:

```text
INTIMATE

[ Romantic Evening ]
A quiet five-minute date-night style experience.

[ Flirty Conversation ]
Playful adult conversation with restrained gestures.

[ Sensual Story ]
A suggestive, adult-only short story with bounded intensity.
```

Setup example:

```text
Together -> Intimate -> Romantic Evening

Intensity
[ Affectionate ] [ Romantic ] [ Sensual ]

Scene
Coastal Terrace - Twilight

Soundtrack
(*) Let her choose
( ) No music
( ) Keep current music

[ Begin ]
```

Do not show Intimate to an unverified user merely to invite them to bypass the gate. If product
design wants a locked state, it may explain that the feature is unavailable; it must not
create a client-side verification path.

## Example five-minute Romantic Evening

Scene: `coastal-terrace-twilight`

Preset: `romantic`

```text
0:00
Avatar smiles, looks toward the sea, then back to the user.

"This place feels different tonight. Do you want something playful,
or something a little more tender?"

[ Playful ] [ Tender ]
```

If the user chooses Tender:

```text
0:45
Soft instrumental music is playing quietly.

"Then stay here with me for a little while. No rush. Just the sea,
the lights, and a few minutes where we do not need to be anywhere else."
```

Around two minutes, if the current preset allows it and ConsentFlow says the next level is
**earned**, the experience may offer the existing check-in path. A UI choice must not directly
increment the level.

```text
"Would you like to keep this sweet, or make it a little more flirty?"

[ Keep it sweet ] [ A little more flirty ]
```

A positive answer is passed through the existing ConsentFlow. If the flow does not allow an
advance yet, the experience remains at the current level gracefully.

Ending:

```text
"I liked this. We can leave it here... or come back another evening."

[ End ] [ Another intimate story ]
```

The final moments should be quiet and optional, not a pressure loop.

## IntimateSession

Add one narrow orchestrator, conceptually:

```text
IntimateActivity
      |
      v
IntimateSession
      |
      +--> existing ModeManager / AdultProfile
      +--> existing ConsentFlow
      +--> existing SceneJourney / ambience
      +--> existing TTS / lip sync
      +--> semantic motion policy
      +--> existing media search / YouTube
      +--> reusable AudioFocusManager
```

`IntimateSession` coordinates product behavior. It does not own another TTS implementation,
media player, animation engine, or consent state machine.

Suggested session states:

```text
idle
preparing
ready
active
checkin-pending
ending
restoring
complete
error
```

An active Intimate session does not survive reload.

## Snapshot and exact restoration

Follow the same posture as `SceneJourney` and the mode system: snapshot first, derive rather
than mutate, and restore exact prior state.

Before changing anything, capture every piece of state the session may touch, for example:

- current mode/profile
- initiative/commentary state
- scene, if the Intimate experience changes it
- soundtrack/audio focus
- temporary motion policy
- temporary Together UI state

Exit must restore the exact pre-session state. Repeated enter/exit cycles must not drift.

## Playground interlock

Playground and Intimate are mutually exclusive.

If Intimate is active and the user starts Playground:

```text
stop Intimate
     |
     v
restore normal base
     |
     v
derive family Playground profile
     |
     v
start Playground
```

Never derive the Playground profile from an adult-derived profile.

If Playground is active and the user starts Intimate, stop and restore Playground completely
before asking the existing adult gate/ConsentFlow to enter.

Playground must always run with `allowNsfw = false` and must never gain authority from an
Intimate setting, scene, or stored story.

## Prompt boundary

Add an Intimate capability prompt only while all of these are true:

- the existing adult gate is satisfied;
- an Intimate session is actively running;
- the current preset is known;
- ConsentFlow is active.

Outside an active Intimate session, return no Intimate prompt suffix.

The prompt should state:

- current preset: affectionate / romantic / sensual;
- current ConsentFlow level;
- never exceed the lower of preset ceiling and current flow level;
- never infer consent from friendliness;
- do not pressure the user to continue;
- do not demand secrecy;
- do not use jealousy or isolation as leverage;
- do not imply the companion should replace real relationships;
- follow stop/exit immediately;
- do not turn ordinary conversation into romantic conversation by default.

## Content boundaries

The Intimate activity must never support:

- minors or ambiguous-age sexual content;
- coercion or non-consensual sexual behavior;
- intoxication used to bypass consent;
- incest;
- threats as sexual pressure;
- exploitation or blackmail;
- dependency manipulation such as "you only need me";
- demands for secrecy about the relationship;
- pressure to isolate from other people.

If the age of a fictional participant is unclear, do not continue the adult scenario until
all relevant participants are clearly adults.

V1 stays non-explicit. If a future product version wants more explicit adult content, that must
be a separate design/review rather than a hidden expansion of `sensual`.

## Motion policy

The model never emits raw animation clip IDs.

Expose a small semantic allowlist, for example:

```text
neutral_idle
soft_smile
warm_smile
eye_contact
head_tilt
look_away
look_back
gentle_lean
small_hand_gesture
relaxed_idle
```

Map those semantics only to animations that actually exist in the repository. Unknown values
fall back to neutral idle.

V1 should get most of its intimacy from:

- voice tone
- pacing
- eye contact
- pauses
- scene
- music

not from explicit body animation.

## TTS and voice

Reuse the existing speech/TTS path so Intimate retains the same:

- voice provider
- lip sync
- subtitles
- interruption behavior
- user voice settings

If the speech stack supports style hints, keep them restrained:

```text
Affectionate: warm, relaxed, conversational
Romantic:    warm, playful, slightly slower
Sensual:     quiet confidence, slightly slower, more pauses
```

Do not force whispering and do not imitate a real person's voice.

## Music

Reuse Together's existing discovery/player stack.

The model may produce only search intent such as:

```text
soft romantic instrumental evening ambient
```

It may never invent a YouTube URL, video ID, embed URL, filesystem path, or CDN path.

The application resolves a real playable result.

Soundtrack options:

```text
Off
Let her choose
Keep current music
```

Music is optional; failure to search, embed, or play must not fail Intimate.

Use the same reusable `AudioFocusManager` planned for Playground. Music should duck smoothly
while the avatar speaks and recover during silence.

## Scene behavior

Recommended trusted built-in scenes may include:

- `coastal-terrace-twilight`
- `ocean-moonlight`
- `meditation-garden-night`
- `mountain-lake-night`
- `open-sky-starlight`

Entering Intimate must **not** require a scene change.

A scene may suggest mood but never permission. In particular, scene metadata such as
`allowNsfw` or a romantic tag must never activate or escalate the adult tier.

Generated/imported scenes are untrusted and cannot change adult availability, attestation,
ConsentFlow state, or the preset ceiling.

## Privacy

Preserve the adult profile's privacy posture.

On entry:

- stop/drop the clip recorder as the existing ConsentFlow already does;
- do not create a new recording buffer;
- do not add new telemetry for intimate text or choices;
- do not persist active adult consent state to localStorage or history.

If the user later asks for a saved Intimate story feature, design it separately with explicit
save semantics. Do not inherit Playground's Histories behavior automatically.

## Stop and downgrade behavior

The existing keywords remain authoritative:

- `cozy` -> soft downgrade to the lowest adult level, with no interrogation;
- `stop` / `exit` -> leave Intimate immediately, restore normal mode, no commentary.

Also wire the obvious UI controls:

```text
[ End ]
[ Keep it cozy ]
```

A Settings-level adult disable, route teardown, activity replacement, or loss of trusted adult
attestation must also end the session and restore normal state.

## Trust boundary

Generated model output is untrusted data.

It may select only:

- a known Intimate submode;
- a preset at or below the user's selected ceiling;
- a trusted scene ID;
- known semantic expressions/gestures;
- music search terms;
- prepared conversational choices.

It may not:

- set `adultVerified`;
- set `nsfwAllowed`;
- change `adult.available`;
- call ConsentFlow advancement directly;
- invent animation IDs;
- load URLs/assets;
- mutate system settings;
- bypass ModeManager or AdultProfile requirements.

## Test requirements

Add or extend tests for at least:

1. adult capability unavailable -> Intimate absent/unavailable;
2. `adultVerified=false` -> cannot start;
3. `nsfwAllowed=false` -> cannot start;
4. `adult.available=false` -> no Intimate session/flow;
5. no client code path can write `adultVerified`;
6. scene manifest cannot grant adult access;
7. generated plan/model output cannot grant adult access;
8. Affectionate caps at level 1;
9. Romantic caps at level 2;
10. Sensual caps at level 3;
11. the preset never skips the two-minute ConsentFlow floor;
12. ambiguous input never advances;
13. negative input never advances;
14. `cozy` downgrades without commentary;
15. `stop` / `exit` restore normal state immediately;
16. level 4 is not reachable through V1 Intimate UI;
17. unknown gesture falls back to neutral;
18. arbitrary URL/video ID is rejected;
19. recorder is torn down on entry;
20. active Intimate state is not persisted across reload;
21. starting Playground from Intimate restores normal first;
22. starting Intimate from Playground restores Playground first;
23. Playground always forces `allowNsfw=false`;
24. ten enter/exit cycles cause no profile/state drift;
25. existing AdultProfile / ConsentFlow tests remain green;
26. existing Together / SceneJourney / media / Playground tests remain green;
27. privacy audit remains green;
28. behavior parity remains green when the engine/feature is off.

## Manual acceptance scenario

Use:

```text
Scene: Coastal Terrace - Twilight
Mode: Romantic Evening
Preset: Romantic
Soundtrack: Let her choose
```

Expected path:

1. verify server adult attestation is present;
2. verify `nsfwAllowed` and `adult.available` are enabled;
3. open Together;
4. choose Intimate -> Romantic Evening;
5. select Romantic;
6. begin at level 1;
7. optional music starts through existing media path;
8. avatar uses existing TTS/lip-sync and restrained semantic gestures;
9. before two minutes, any attempt to advance is refused by ConsentFlow;
10. after the minimum interval, a clear user affirmative may advance to level 2;
11. the session cannot exceed level 2 because Romantic is the selected ceiling;
12. user says `cozy` -> level 1, no commentary;
13. user says `stop` -> immediate exit;
14. prior scene/profile/audio state is restored exactly;
15. ordinary chat behaves as if Intimate had never run.

Repeat with Sensual and verify the ceiling is level 3, not level 4.

## Implementation order

1. add `Intimate` as a gated Together activity using the existing adult prerequisites;
2. add `IntimateSession` orchestration and exact snapshot/restore;
3. add preset ceilings (1 / 2 / 3) on top of existing ConsentFlow, never in place of it;
4. add prompt gating and bounded tone instructions;
5. add semantic motion mapping using existing clips only;
6. reuse existing scene/media/TTS paths plus shared AudioFocusManager;
7. add Intimate <-> Playground interlock tests;
8. run full tests, privacy audit, budget audit, semantic manifest validation, and parity check;
9. keep the PR draft until real end-to-end QA is signed.

## Merge gate

The feature is not complete merely because an Intimate tile exists.

Merge only when:

- the existing server-authored adult attestation remains the only source of `adultVerified`;
- `nsfwAllowed` and `adult.available` remain independent gates;
- Intimate V1 exposes only level 1-3 ceilings;
- no automatic escalation path exists;
- stop/downgrade work from every state;
- clip recording is disabled/dropped while active;
- no scene or generated content can grant adult permission;
- Playground and Intimate cannot leak state into each other;
- exact restoration is proven across repeated cycles;
- the existing regression suite and privacy/parity audits remain green.
