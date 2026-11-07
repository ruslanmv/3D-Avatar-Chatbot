# How to create dynamic stories

**Version:** 1.0, 2026-11-07.

**The goal:** many stories in the same place, reacting to the person and to
*confirmed* events, without swapping worlds, starting a new conversation, or
claiming things that did not happen.

## 1. What exists today

| System | Where | Shape | Good for |
| --- | --- | --- | --- |
| **Shared moment** (LW4) | `src/companion/WorldPresence.js` `promptSuffix`, `setMood` | place, spot, `sees`, last confirmed move, mood (`relax` / `story` / `focus`) | open-ended, model-written stories grounded in the room |
| **Seaside Evening** | `src/experiences/seaside/story.js` + `ExperienceDirector` | beats plus flags (`shellTouched`, `lanternLit`); objects change later lines; only the beat id and flags are persisted, never sentences | an authored branching evening with real object interactions |
| **Scene Tale** | `src/features/together/activities/playground.js` `validateStoryPlan` | `{ title, startNode, nodes{ id: { text, next \| choices[{id,label,next}] } } }`, bounded by `MAX_NODES` | a generated, validated, deterministic plan |
| **Scene journeys** | `src/features/together/activities/scene-journey.js` | manifest `guidedScript` (system-trust sources only) | a guided ambience sequence |
| **Venue reactions** | `PlaygroundReactiveContext` `PROFILES`, `moments` | chip → intent; "shared moment just now" | small reactive beats in venues |
| **Start or end lines** | `src/companion/ActivityVoice.js` | one bounded `callLLM` per Together start | a single greeting, never repeated |

**Rule:** a story is a *mood plus context* in the current place, not a new
world. `<activity name="story"/>` in a place becomes
`presence.setMood('story')`. Since LW4 it never enters Scene Tale or swaps the
background.

## 2. Building blocks

**Story goal.** One sentence in the shared moment: "They want a short story set
right here: use only what is really in this place." The goal is a *mood*, not a
script.

**World-aware dialogue.** The model gets:

- the place, the spot and `sees` (verified)
- the other spots
- the venue note
- confirmed reactions

Write `sees` like a set designer: concrete, true and short. The model writes the
lines.

**Choices.** Use whichever fits:

- explicit chips (playground `actions`)
- Seaside-style choices (`ExperienceDirector.interact`)
- the person's own words: "andiamo sul balcone" → a confirmed spot move,
  which *is* a story choice with a visible consequence

**Branch conditions.** Branch on verified state only:

- the spot (`presence.state().spot`)
- the mood
- flags an owner set (`lanternLit`)
- a confirmed `interaction:completed`

Never branch on the model saying something happened.

**Verified events** a story may react to:

- `nexus-world-spot` (arrived at a spot)
- `nexus-world-shown`
- `interaction:completed`
- `nexus-playground-action` phases
- `nexus-presence` `{ kind: 'moved' | 'mood' | 'arrived' | 'travel-failed' }`

**Consequences.** These must be executed by an owner:

- a spot move (`presence.go`)
- a mood
- a light mood (`runtime.setMood` via the router)
- a travel *proposal* that the person confirms
- a flag in the experience's own state

**Short-term story memory.** `WorldPresence` notes last 2 minutes, PG3 moments
last 10 minutes, and Seaside persists the beat and flags. Nothing stores
transcripts. Clear (`ConversationReset`) and End forget it.

**Re-entry and continuation.** Seaside resumes from the persisted beat. A
Living Worlds story resumes naturally: the place and spot are still there, and
the model is told where you are.

**Safe endings:**

- the person's End (X)
- `<activity name="end"/>`, which is refused inside a place: leaving is
  theirs
- the Seaside close beat

**Replay without repetition.** Moods and spots vary the context. Seaside's lines
depend on flags. Avoid fixed opening lines: `ActivityVoice` greets once per
start, and Living Worlds moves never re-greet.

## 3. Four examples

### Romantic evening, in the apartment (works today)

1. The person picks Apartment.
2. "Rilassiamoci un po' qui" → mood `relax`, posture `idle`.
3. She suggests the balcony with `<go spot="balcony"/>`, which becomes an offer.
4. "sì" → a confirmed move. The prompt now says "on the balcony", and its
   `sees` names the little table and planter.

**The relationship style** comes from approved settings (`MemoryScopes` `life`).
She cannot sit or hold hands. She says so warmly if asked, and never narrates
it.

### Nightclub (works today)

1. "Andiamo in discoteca?" → a proposal.
2. "sì" → the world loads and is confirmed.
3. Dance through the chip, or her `<gesture intent="dance"/>`, both through
   the router. While the dance owns her body she keeps words few; when it
   stops she looks back once (`afterOwn`).
4. Music is a `say` chip.

The discoteca has no spots file. Its PG3 anchors serve gaze only.

### Forest adventure (partly future)

1. "andiamo nella foresta" → proposal → yes → `oak-glade`, or
   `under-the-trees` on a phone.
2. **Today:** no spots and no forest discoveries exist. She can talk about
   what the shared moment lists, and nothing else.
3. **To make it an adventure:** measure spots (a clearing, the fallen trunk),
   add anchors, and add a Seaside-style story with one discovery object
   (Tutorial C).

### Workplace (works today, by design)

1. In the office with Copilot: Copilot's prompt has no relationship text, and
   presence gives no romantic spots and no trips.
2. The story mood is not offered for work. Use `focus`.

## 4. Template

`docs/engine/templates/story.branching.example.json` is a **proposed** shape that
maps to Seaside's beats and flags and Scene Tale's nodes and choices. Until a
loader exists, implement a new authored story the Seaside way: a pure state
module plus `ExperienceDirector` registration. Test it the way
`tests/companion/platform.test.js` tests Seaside's story.

## 5. Checklist

- Every beat condition reads verified state.
- Every consequence goes through an owner.
- No line claims sitting, holding, lights or walking unless that actuator
  exists.
- English and Italian labels.
- It works in Life and Experiences; Copilot stays professional.
- Private content stays in Private.
- Clear forgets it, and End ends it.
