# Playground / Scene Tale

This document defines the first family-friendly Playground experience for Together.
It is intentionally additive: existing chat, Together activities, scene ambience, media,
and Intimate Mode must keep their current behavior unless the user explicitly starts
Playground.

## Product goal

Scene Tale turns the current ambience into a short interactive story rather than a
five-minute chatbot monologue.

- AI = director / writer
- 3D Avatar Chatbot = performer / player
- current scene = stage
- YouTube / ambience = soundtrack
- user = participant

The MVP target is one approximately five-minute experience with two prepared choices.
The AI creates and validates the complete plan before playback; the browser then executes
that plan locally so choices do not wait on another LLM round trip.

## Family-safe boundary

Playground is general-audience by design. While active it must force a family-safe derived
profile and must not inherit adult behavior from another mode.

If an Intimate session is active, Playground startup must perform this sequence:

```text
Intimate active
      |
      v
stop Intimate
      |
restore normal base
      |
      v
derive family Playground profile
      |
      v
Scene Tale
```

It must never derive Playground from an intimate-derived profile. `allowNsfw` is false while
Playground is active. Starting Playground must not enable Intimate Mode, and a scene manifest
must not be able to grant adult capability.

Disallowed Playground content includes sexual or erotic content, graphic violence, gore,
torture, dangerous challenges, gambling mechanics, hate content, coercion, frightening horror,
and dependency manipulation. Light suspense, gentle mystery, friendship, kindness, travel,
wonder, and storybook-level affection are allowed.

## Together UX

```text
TOGETHER

[ Watch ] [ Listen ] [ Playground ]

PLAYGROUND

[ Scene Tale ]
A short story inspired by where we are.

Future modes using the same player:
- Imagined History
- Guided Daydream
- Choose the Path
- Mystery
```

Scene Tale setup:

```text
Current place
Coastal Terrace - Twilight

Give me an idea - optional
[ A letter somebody never delivered ]

Soundtrack
(*) Let her choose
( ) No music

[ Begin ]
```

Preparation is separate from playback:

```text
Creating our story...

Story ready
Music found
Scene ready

"The Letter at the Last Light"
About 5 minutes

[ Begin story ]
```

The second button is intentional: it is the explicit browser user gesture that may also
start media playback.

## Five-minute pacing

Target: 4:30-5:30 total. Do not fill the whole interval with speech.

Suggested shape:

- 0:00-0:45 opening and invitation into the scene
- 0:45-1:30 establish world / mystery / emotion
- ~1:30 choice 1
- 1:30-3:00 development
- ~3:00 choice 2
- 3:00-4:30 resolution / emotional payoff
- 4:30-5:00 quiet ending with music and scene presence

Target narration is roughly 350-550 words depending on TTS rate.

## Example

Scene: `coastal-terrace-twilight`

Idea: `a letter somebody never delivered`

Opening:

> There is something about this terrace tonight that makes me think someone was meant to
> come back here.

> Let's imagine that many summers ago, someone named Elena came here every evening carrying
> a letter she never managed to send.

Choice 1:

```text
What do you think was inside?

[ A confession ]
[ A goodbye ]
```

Later:

> Until one evening, someone else was sitting on her step, holding an unopened envelope of
> his own.

Choice 2:

```text
Should Elena tell him why she is there?

[ Tell him ]
[ Keep quiet ]
```

The ending is gentle and unresolved: Elena finally sends the letter, but the story never
reveals the reply.

## StoryPlan contract

Generated plans are untrusted data. They must be parsed and validated before playback.

Conceptual schema:

```json
{
  "schemaVersion": 1,
  "id": "scene-tale-...",
  "mode": "scene-tale",
  "audience": "family",
  "sceneId": "coastal-terrace-twilight",
  "title": "The Letter at the Last Light",
  "fictional": true,
  "durationSec": 300,
  "music": {
    "enabled": true,
    "searchTerms": "gentle cinematic seaside instrumental no lyrics",
    "mood": "warm reflective"
  },
  "beats": [
    {
      "id": "opening",
      "type": "narration",
      "atSec": 0,
      "text": "...",
      "expression": "soft_smile",
      "gesture": "look_horizon",
      "anchor": "horizon"
    },
    {
      "id": "pause-1",
      "type": "pause",
      "durationSec": 5
    },
    {
      "id": "choice-1",
      "type": "choice",
      "prompt": "What do you think was inside?",
      "options": [
        { "id": "confession", "label": "A confession", "next": "branch-confession" },
        { "id": "goodbye", "label": "A goodbye", "next": "branch-goodbye" }
      ]
    }
  ]
}
```

MVP validation rules:

- trusted, known scene ID
- `mode === "scene-tale"`
- `audience === "family"`
- bounded duration
- maximum two choices
- exactly two options per MVP choice
- every branch reaches an ending
- known semantic expressions and gestures only
- known scene anchor names only
- music contains search terms, never a URL or video ID
- no HTML, code, shell commands, asset URLs, settings mutations, or permissions

A valid JSON parse is not enough; the plan must pass semantic validation before playback.

## Runtime architecture

Additive components should be narrow and compositional:

```text
PlaygroundActivity
      |
      v
PlaygroundSession
      |
      +--> StoryPlanner --> StoryPlanValidator
      |
      +--> StoryPlayer
              |
              +--> existing SceneJourney / scene catalogue
              +--> existing speakText / TTS / lip sync
              +--> semantic expression + gesture allowlist
              +--> existing media search / YouTube playback
              +--> AudioFocusManager
```

Do not create another TTS engine, YouTube client, scene renderer, or animation system.

Recommended session states:

```text
idle
preparing
ready
playing
waiting-choice
paused
ending
restoring
complete
error
```

Only one Playground session may be active.

## Snapshot and restoration

Follow the existing SceneJourney / ModeManager posture: snapshot first, derive rather than
mutate, and restore exact prior state on exit.

Potential temporary state includes:

- blackboard / mode profile
- initiative and commentary openings
- motion allowlist
- scene if the story changes it
- soundtrack and audio-focus state
- temporary Playground UI and choice state

`enter -> exit` repeated ten times must produce no drift.

## Semantic motion

The planner never emits raw animation clip IDs. It chooses only from a small semantic
allowlist, for example:

Expressions:

- neutral
- soft_smile
- warm_smile
- thoughtful
- curious
- surprised_gentle

Gestures:

- look_user
- look_horizon
- look_left
- look_right
- small_nod
- head_tilt
- gentle_hand
- relaxed_idle

Runtime maps those semantics to clips that actually exist. Unknown values fall back to
neutral idle.

## Music and YouTube

Reuse Together's existing media discovery and player. The plan may specify only search terms.
The application resolves a real result. The model must never invent a URL, video ID, or claim
that a specific track was found before search has actually succeeded.

Prefer instrumental, low-vocal music so TTS stays intelligible.

Music is optional. Search failure, embedding failure, autoplay failure, or a removed video
must not fail the story; continue with scene ambience or silence.

### Audio focus

Use or add a reusable `AudioFocusManager` rather than Playground-only volume hacks.
Suggested targets:

```text
avatar speaking: music ~10-15%
avatar silent:   music ~25-35%
```

Use smooth ramps, not hard cuts.

## Choices

The MVP has two meaningful decision points with two options each. Both branches are prepared
before playback and converge later, which gives immediate response without creating a huge
narrative tree.

No LLM call is required at a choice in the MVP.

## Interruption behavior

Always expose Pause and End story. Clear stop language such as `stop`, `end the story`, or
`let's stop` exits cleanly.

Normal initiative commentary must not talk over StoryPlayer. Unrelated user chat may pause the
story rather than creating parallel speech.

## Ending and Histories

The final 10-15 seconds should normally contain little or no speech. Show:

```text
Story complete

[ Save to Histories ]
[ Another version ]
[ Try another Playground ]
[ Back to Together ]
```

Saving is explicit opt-in only. Replay should validate and execute the stored StoryPlan without
calling the LLM again. `Another version` may call StoryPlanner again and must not overwrite a
saved version.

Saved metadata may include title, mode, scene ID/title, created timestamp, duration, selected
choices, validated StoryPlan, and soundtrack search terms. Do not create a new remote storage
path solely for Playground.

## Scene seeds

Safe thematic hints, not fixed scripts:

| Scene | Example themes |
| --- | --- |
| Ocean Sunrise | voyage, message in a bottle, returning boat, first day |
| Ocean Moonlight | lighthouse, constellation, quiet traveler, hidden signal |
| Mountain Lake Day | forgotten map, naturalist notebook, picnic mystery |
| Mountain Lake Night | reflected star, telescope note, cabin light |
| Meditation Garden Day | hidden inscription, gardener promise, small kindness |
| Meditation Garden Night | lantern, nighttime visitor, moon garden, quiet wish |
| Coastal Terrace Day | postcard, traveler, old photograph, returning guest |
| Coastal Terrace Twilight | unsent letter, farewell, reunion, old promise |
| Open Sky Day | cloud shapes, glider story, weather journal, horizon game |
| Open Sky Starlight | constellation, astronomer notebook, wish, distant light |

All generated stories should be labeled `Fictional story inspired by this scene`.

## Future modes

The same StoryPlayer should later support:

- `imagined-history`: fictional origin story, clearly labeled as imagined
- `guided-daydream`: fewer words, more silence, no challenge/failure
- `choose-the-path`: more playful branching
- `mystery`: clues, user guesses, gentle reveal

Do not build separate playback engines for each mode.

## Failure behavior

- planner failure -> show Retry, start no partial session
- invalid plan -> reject before playback
- music failure -> continue without music
- scene failure -> keep current/fallback scene and continue when possible
- unknown gesture -> neutral idle
- TTS failure -> keep readable text and follow existing speech recovery
- route/activity teardown -> restore previous state exactly

## Test requirements

At minimum add tests for:

1. Playground feature disabled -> old Together behavior unchanged
2. Playground visible when enabled
3. valid Scene Tale plan accepted
4. invalid plan rejected before playback
5. unknown scene / anchor handled safely
6. unknown gesture -> neutral fallback
7. URL or video ID in model music output rejected
8. two-choice graph reaches an ending
9. music failure does not stop the story
10. TTS uses the existing speech path
11. music ducks during speech and restores afterward
12. pause / stop / stop phrase work
13. normal commentary cannot collide with StoryPlayer
14. save occurs only on explicit user action
15. replay does not require the LLM
16. Another version creates a new plan
17. `allowNsfw` is false during Playground
18. Playground cannot enable Intimate Mode
19. starting Playground from Intimate restores normal state first
20. exiting Playground restores previous normal state exactly
21. ten enter/exit cycles cause no drift
22. existing SceneJourney, media, Intimate, Together, and parity tests remain green

## Manual acceptance scenario

Use `Coastal Terrace - Twilight`, idea `A letter somebody never delivered`, soundtrack `Let
her choose`.

Expected path:

1. Open Together
2. Choose Playground -> Scene Tale
3. Enter optional idea
4. Begin preparation
5. Validate StoryPlan
6. Show title + About 5 minutes
7. User presses Begin story
8. Music starts softly when available
9. Avatar narrates through existing TTS/lip-sync
10. Music ducks while speaking
11. Choice 1 appears and responds immediately
12. Choice 2 appears and responds immediately
13. Story resolves
14. 10-15 second quiet ending
15. Completion screen appears
16. Optional Save to Histories
17. Exit
18. Ordinary chat and Together state are exactly restored

## Implementation order

1. feature flag + native Together activity shell
2. `PlaygroundSession` lifecycle and family-safe snapshot/restore
3. StoryPlan schema, validator, and mocked planner tests
4. StoryPlayer narration, pauses, choices, scene anchors
5. semantic expression/gesture mapping through existing motion infrastructure
6. existing media search + reusable audio focus
7. explicit Histories save/replay
8. accessibility, reduced motion, mobile QA, and full regression suite

The merge gate is not "the code exists". It is: the complete existing regression suite remains
green, Playground cannot leak intimate state in either direction, and a user can finish the
five-minute Coastal Terrace scenario end-to-end and return to ordinary chat with no residual
state.