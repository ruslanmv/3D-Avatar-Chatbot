# Private as a live scene — P14–P23

> Private is not a chatbot waiting for prompts and not a timer playing a script.
> It is a live scene. The character reacts to the user when they interact, reacts
> to the silence when they don't, gives them easy things to do when they hesitate,
> visibly changes when their choices matter, and never pressures them or ends the
> experience on its own.

That rule governs every decision below. Where this document and that rule
disagree, the rule wins.

Design target: `claude/together-private-improvements`, head `0a9a160`.

---

## 1. What already exists, honestly

This plan is an upgrade, not a rewrite. Five things are already true and must
survive:

| Already true | Where | Why it matters here |
| --- | --- | --- |
| Turn state is known exactly | `ConversationSurface.turn()` / `observe()` (P8) | The idle clock needs "is anyone mid-turn", not a guess |
| Intent is classified locally in ~50 µs | `PrivateTurnDirector` (P8) | Story events can react before a token returns |
| Repetition is prevented deterministically | `PrivateNovelty` (P11) | Beat selection gets its cooldowns free |
| Intensity is a two-way explicit control | `PrivatePace` + `ConsentFlow.initiated/eased` (P12) | Escalation already cannot happen on a timer |
| Choices arrive with no second round trip | `PrivateChoices` `<choices>` block (P13) | The pattern to extend, not replace |
| The session never ends on its own | P12 removed the 300 s completion | Already satisfies "no forced ending" |

**What is genuinely missing** is a session-level dramatic state and an event loop
to drive it. Today `IntimateExperienceSession` holds `mood`, `energy`, `_turn`,
`_advances` and three `_beat()` offsets. There is no `phase`, no `archetype`, no
`lastTopic`, no `recentBeats`, no idle stage — so nothing can react to silence
and nothing can call back to what was said.

---

## 2. Three defects that block this work

Found by reading the tree, not assumed. Each is small and each must be fixed
before or inside the milestone that depends on it.

### 2.1 The streaming path never gets the language directive

`AppLanguage._patchLLM` (`src/AppLanguage.js:373`) wraps exactly two methods:

```js
wrap('sendMessage');
wrap('sendMessageStructured');
```

`sendMessageStream` is not wrapped. `main.js:3792` routes OpenAI, Claude and
Ollama through the streaming path, so **those three providers never receive the
language instruction at all**. OllaBridge and watsonx are excluded from streaming
and therefore do get it, which is why this has not been noticed — the reported
sessions were OllaBridge.

Fix belongs in P14 and is one line plus a test. Without it, "Private speaks
Italian" is false for half the providers before any Private code is written.

### 2.2 Authored content is inseparable from English

`PrivateBeats.POOLS`, `LEVEL_LINES`, `EASE_LINES`, `PrivateChoices.fallback`,
`showStarting()`, the status chips and the completion card are English string
literals inside logic. A session on `it-IT` today produces Italian model replies
interleaved with English scripted beats and English buttons.

### 2.3 `this place` leaks into the header

`currentSceneLabel()` returns the literal phrase `'this place'` as a *sentence
fragment*, so the opening can read "…**this place** feels like a good place for
it." `PrivateConversationView.mount` uses the same value as a *label*, so with no
ambient scene the card's place slot reads `this place`. Carry the fix in P14.

---

## 3. The loop

```text
                    ┌──────────────────────────────┐
                    │  CHARACTER SAYS / DOES        │
                    └──────────────┬───────────────┘
                                   ▼
                          arm the idle clock
                                   │
                ┌──────────────────┴──────────────────┐
                │                                     │
         user interacts                         real silence
                │                                     │
                ▼                              60 s ──┤
     StoryDirector.on('user-message'                  ▼
        | 'user-choice' | 'pace-up' …)         one presence beat
                │                              (AI, story-aware, short,
                ▼                               carries motion + camera)
        AI replies reactively                          │
        + <choices> in the same                 arm again
          response                                     │
                │                              60 s ──┤
                └──────────────────┬──────────────────┘
                                   ▼
                        LOCAL contextual actions
                        [ Ask me something ]
                        [ Surprise me ]
                        [ Stay quiet ]
                                   │
                                   ▼
                        ambient presence only
                        (idle motion, no more lines)

                     END — only an explicit tap
```

**The timer advances liveness, never intimacy.** No idle path may call
`ConsentFlow.initiated`, change `level`, or raise `energy`. That is not a
convention; it should be a test.

### Why an LLM call at 60 s does not contradict P13

P13's rule is "no second round trip **while somebody is waiting**". At 60 s of
genuine silence nobody is waiting — latency is free there, and it is the only
place in Private where that is true. So:

- **live turn** → choices ride back inside the reply, one request (P13);
- **60 s idle** → one dedicated short generation, latency invisible;
- **120 s idle** → no model call at all, because by then a slow provider would
  make the card feel dead exactly when it is trying to prove it is not.

---

## 4. P14 — Language

### 4.1 One canonical source, read not owned

`window.AppLanguage.code` is canonical. Private adds **no** language selector.

Constraint the coder must respect: `src/AppLanguage.js` is an IIFE with **no
`module.exports`**, so Jest cannot `require()` it. `PrivateLocale` therefore reads
the global defensively at call time, the way `paceModel()` and `noveltyModel()`
already do, and accepts an override for tests:

```js
function languageCode(override) {
    if (override) return override;
    const app = global && global.AppLanguage;
    const code = app && app.code;
    return PACKS[code] ? code : 'en-US';
}
```

Ten languages ship today: `en-US`, `en-GB`, `es-ES`, `it-IT`, `fr-FR`, `de-DE`,
`pt-BR`, `ja-JP`, `ko-KR`, `zh-CN`.

### 4.2 `src/features/together/PrivateLocale.js`

```js
PrivateLocale.t('controls.closer');   // 'Più vicino →'
PrivateLocale.t('pace.warm');         // 'Caldo'
PrivateLocale.t('status.paceEased');  // '✓ Ritmo attenuato'
```

Missing key → English → the key itself. Never an empty button.

### 4.3 The translation budget, stated rather than discovered

Full authored translation is **not** a coding task. Counted:

| Tier | Strings | × 10 languages | Who writes it |
| --- | --- | --- | --- |
| **A** — controls, pace labels, status chips, completion card | ~24 | 240 | Ship complete. Short, mechanical, safe to machine-translate then review |
| **B** — local fallback choices (`PrivateChoices.fallback`) | ~10 | 100 | Ship complete. Two to six words each |
| **C** — authored beat text (`POOLS`, `LEVEL_LINES`, `EASE_LINES`) | ~45 | 450 | **Do not translate up front** |

Tier C is prose with register. A machine translation of "I notice I have stopped
thinking about what comes next" into Japanese will not carry the tone, and the
tone is the product.

**Recommendation:** tier C stays English-authored as the *last-resort floor* and
the model localises live. The model already receives the language directive (once
2.1 is fixed) and writes every live reply in-language; beat cards should prefer a
generated in-language variant and fall back to the English authored line only when
generation fails. A person on `it-IT` then sees English only when the provider is
down — which is the same moment they see a degraded experience anyway.

If you want tier C authored per language later, the beat-card `textKey` indirection
in P18 makes that a content drop with no code change. That is the point of doing
the indirection now.

### 4.4 Dynamic content gets the language explicitly

Even with 2.1 fixed, the Private planner and the idle-beat request should state it
rather than inherit it, because those prompts are assembled by
`TogetherCapability` and not by `sendMessage`'s wrapper:

```text
LANGUAGE: Italian (it-IT). Write only in Italian.
```

---

## 5. P15 — `PrivateStoryDirector`

`src/features/together/PrivateStoryDirector.js`. Owns dramatic state. **Owns no
consent.**

```js
{
    language: 'it-IT',
    archetype: 'coastal-night',
    phase: 'opening',            // opening | flowing | quiet | winding

    level: 1, ceiling: 3,        // MIRRORS ConsentFlow — never writes it
    mood: 'tender', energy: 'present',

    scene: 'coastal-terrace', soundtrack: 'auto',

    turnCount: 4,
    lastUserIntent: 'question',
    lastTopic: 'evening walks',
    pendingQuestion: null,

    recentBeats: ['arrival', 'look-at-ocean'],
    userChoices: ['surprise-me'],

    idleStage: 0,                // 0 live · 1 nudged · 2 buttons shown · 3 ambient
    lastInteractionAt: 0
}
```

Events: `session-start`, `user-message`, `user-choice`, `pace-up`, `pace-down`,
`assistant-finished`, `idle-60`, `idle-120`, `scene-change`, `music-change`,
`session-end`.

**The boundary that matters.** `level` and `ceiling` are a *read-only mirror* of
`ConsentFlow`, updated from `adult:level`. The StoryDirector may propose that a
beat is available at level 2; it may never move to level 2. Every existing
guarantee — `initiated()` needs an explicit request, `userStepMinMs`, the ceiling,
`proactiveNsfw: false` — stays exactly where it is. A test should assert that no
StoryDirector code path reaches `ConsentFlow`.

`PrivateTurnDirector` (user intent) and `PrivateNovelty` (repetition) stay as they
are and become inputs.

---

## 6. P16/P17 — The liveness clock

### 6.1 The busy predicate is the whole feature

Everything else is easy; getting "genuine silence" right is not. The repo already
has the authoritative audio answer at `main.js:5542`:

```js
window.companionMode?._replyAudioBusy()   // knows Piper/WebAudio, not just speechSynthesis
```

`PrivateIdleClock.busy()` must be true when **any** of these hold:

| Condition | Source |
| --- | --- |
| Generation in flight | `ConversationSurface.turn().phase !== 'idle'` |
| Speech playing | `companionMode._replyAudioBusy()`, else `speechSynthesis.speaking \|\| pending` |
| User typing | `_composingAt` within ~8 s, or a non-empty composer |
| Voice recognition live | `SpeechService` listening flag |
| Transition running | Private's own flag during scene/level change |

A naïve `speechSynthesis.speaking` check is wrong: Piper plays through WebAudio and
is invisible to it, which would make the nudge interrupt her own voice. That exact
bug is already documented in `arAudioBusy`'s comment — reuse the function, do not
re-derive it.

The clock is **wall-clock**, not `setTimeout` accumulation, for the reason P8's
`_beat` already documents: a hidden tab has its timers clamped to ~1/minute and
may freeze them outright. Same pattern — store the deadline, re-check on tick and
on `visibilitychange`.

### 6.2 Stages

```text
idleStage 0 → anything the user does resets to 0
     60 s  → stage 1: ONE presence beat (AI, ≤2 short sentences, + motion/camera)
     60 s  → stage 2: 2–3 LOCAL action buttons, no model call
     then  → stage 3: ambient only. No further lines, ever, until the user acts.
```

Stage 1 must never say "Are you still there?". It is a story beat that happens to
acknowledge quiet: *"Sei diventato silenzioso. Non mi dispiace."* System language
destroys the fantasy and is the one failure mode worth a dedicated test.

### 6.3 One unanswered question at a time

`PrivateNovelty`'s ignored-question rule already exists (P11). The idle path must
respect it: if she asked something and got silence, stage 1 may **release** the
question — *"Non devi rispondere. Ero solo curiosa."* — but may not ask a new one.
Three questions in three minutes is an interrogation.

### 6.4 Remove the story timers, keep only liveness

Delete the story-purpose `_beat(45 000 | 210 000 | 330 000)` calls. Beat selection
moves to the StoryDirector, triggered by events. `_beat`, `_tick`, `_armBeats` and
the `visibilitychange` wake-up survive as the idle clock's machinery — they are
good code solving the right problem, pointed at the wrong question.

---

## 7. P18 — Beat deck

Replaces `fallbackPlan()`'s whole-arc-up-front with cards selected *when they
fire*. This is the fix for the storytelling ceiling: today `middle` and `closing`
are chosen at `start()`, so the arc cannot know what happened.

```js
{
    id: 'terrace-look-away',
    family: 'scene-note',                    // PrivateNovelty family
    archetypes: ['coastal-night', 'quiet-date'],
    conditions: {
        scenes: ['coastal-terrace'],
        minLevel: 1, maxLevel: 3,
        moods: ['tender', 'playful'],
        idle: true,                          // only as an idle beat
        musicPlaying: null                   // null = don't care
    },
    weight: 8,
    cooldownTurns: 5,
    textKey: 'beat.terrace.lookAway',        // P14 indirection
    effects: [
        { type: 'motion', intent: 'look_away' },
        { type: 'camera', preset: 'medium-close' }
    ],
    choices: ['ask-something', 'surprise-me', 'stay-quiet']
}
```

Selection — deterministic enough to test, weighted enough not to repeat:

```js
candidates = deck.filter(b =>
    conditionsMatch(b, state) &&
    novelty.canUse(state.novelty, b.family).ok &&
    !state.recentBeats.includes(b.id) &&
    !(b.family === 'question' && state.pendingQuestion)
);
score = archetypeAffinity + sceneAffinity + moodAffinity
      + userIntentAffinity + idleAffinity + noveltyBonus
      - repetitionPenalty;
selected = weightedPick(candidates, seed);   // seeded → reproducible in tests
```

Then: authored text is available immediately; an AI variant may replace it if it
arrives and validates; if generation fails the authored line already ran. Same
floor-then-upgrade shape as `PrivateBeats.plan()` today.

`effects` are **metadata**, never text. `[smile]` in visible dialogue stays
forbidden and `StageDirections` stays as the defensive sanitiser (P14 of the
previous series — note the numbering collision with this P14; the earlier one is
the `[smile]` work).

---

## 8. P19 — `say` vs `action` choices, and a new trust boundary

```js
{ kind: 'say',    label: 'Fammi una domanda', text: 'Fammi una domanda.' }
{ kind: 'action', label: 'Sorprendimi',       action: 'story.surprise' }
```

`say` → `ConversationSurface.send()`, the normal pipeline (unchanged from P13).
`action` → straight to `StoryDirector.on('user-choice', { action })`.

**The new risk P13 did not have.** An `action` bypasses the conversation entirely,
so a model that could invent an action id could invoke runtime behaviour directly.
Mitigation, and it is not optional:

- the closed vocabulary lives in code, e.g. `story.surprise`, `story.ask`,
  `story.quiet`, `story.music`, `story.scene`;
- the prompt is *given* the ids available for this beat, and the model may only
  pick from that set;
- an unrecognised id is dropped and the whole set falls back to local, exactly as
  a refused `say` set does today;
- **no action id may touch intensity.** `story.closer` must not exist. The only
  route to a higher level stays the footer's `Closer →` and typed explicit
  requests, both through `ConsentFlow.initiated`.

That last bullet is the P13 rule restated for a channel that did not exist when
P13 was written, and it is the single most important line in this document.

---

## 9. P20 — Episode archetypes

Chosen at `session-start`, weighted against `PrivateMemory`'s "recently used".
Changes which cards score well; does not change the runtime.

`quiet-evening` · `playful-challenge` · `late-night-questions` · `music-moment` ·
`stargazing` · `rainy-night` · `small-date` · `confessions` · `choose-for-me` ·
`story-within-a-story`

Two sessions on the same preset then differ in *shape*, not just in prose — which
is the actual replay problem. Today's 24 playthroughs per preset are 24
rearrangements of one structure.

---

## 10. P21 — The avatar is the reward

Every beat may carry `effects`. The reward vocabulary:

```text
expression · pose · camera framing · scene lighting · music shift
· a callback to something they said · a small challenge
```

Constraint that already exists and must hold: `proactiveNsfw: false` and
`UtilityRanker`'s source rule mean she may never *initiate* an nsfw-tagged clip.
Beat effects use the ordinary presence vocabulary (`lean_in`, `look_away`,
`breathe`, `smile_soft`) — the same list `StageDirections.PRESENCE` already maps
to. A beat that wants the adult ceiling's clips is a beat that needs the user to
have asked, and that is `ConsentFlow`'s business.

---

## 11. P22 — Replay memory

Extend `PrivateMemory` (four enums today) with three session-level signals only:

```js
{ lastArchetypes: ['coastal-night'],  // last 3, to avoid immediate repeats
  recentBeatIds: [...],               // last ~12
  topics: ['evening walks'] }         // last ~5, for callbacks
```

`PrivateMemory`'s existing discipline holds: enums and slugs, never a word of what
was said, never a sentence. `topics` is the one addition that stores user-derived
content, so it should be short, slug-like, capped, and listed in
`ConversationReset.KEYS` so CLEAR erases it.

---

## 12. P23 — Tests

The ones that would actually catch a regression:

1. **Language coherence** — with `AppLanguage.code = 'it-IT'`, no visible string
   is English: controls, pace labels, status chips, fallback choices.
2. **Streaming directive** — `sendMessageStream` carries the language directive
   (defect 2.1).
3. **Idle gating** — the clock does not advance while generating, while
   `_replyAudioBusy()`, while typing, or while STT is live. One test per source.
4. **Stage 1 is a story beat** — the nudge never matches `/are you (still )?there/i`
   or any system-language pattern.
5. **Stage 2 is local** — no provider call is made at 120 s.
6. **Idle never escalates** — `adult.level` is unchanged after 10 minutes of
   silence, and `initiated` is never called from an idle path.
7. **No manufactured escalation** — no generated choice, `say` or `action`,
   produces a level change; an unknown `action` id drops the whole set.
8. **One question at a time** — a released question is not replaced by a new one.
9. **Beat selection is reproducible** — same seed and state, same card.
10. **Never ends** — 30 minutes of mixed activity and silence, session still
    `active`; only `End` completes it.

---

## 13. Simulation — Italian, coastal night

Settings: `AppLanguage.code = 'it-IT'` · preset ceiling Sensual · archetype
`coastal-night` · scene Coastal Terrace · music auto · level Warm.

```text
🔐 PRIVATE                                          Caldo

HER   Stasera questo posto sembra più tranquillo del solito.

      [ Fammi una domanda ]            say
      [ Sorprendimi ]                  action → story.surprise
      [ Restiamo così ]                action → story.quiet

  ● Caldo ─ • ─ •            [ Più vicino → ]              Fine
```

**+60 s, real silence.** `idle-60`. StoryDirector picks `terrace-quiet-01`
(archetype + scene + idle affinity), asks for one short Italian continuation,
attaches `look_away` and a camera settle.

```text
HER   Sei diventato silenzioso.
      Non mi dispiace — il mare si sente meglio quando
      nessuno dei due prova a riempire il silenzio.
```

Nothing else. No question. No buttons yet.

**+60 s more.** `idle-120`. **No model call.** Local actions from
`PrivateChoices.fallback` + StoryDirector state:

```text
      [ Fammi una domanda ]
      [ Scegli tu cosa facciamo ]
      [ Restiamo in silenzio ]
```

Then stage 3: ambient idle motion, no further lines.

**User taps `Scegli tu cosa facciamo`** → `action: story.surprise`. Instant, local:

```text
HER   Allora scelgo io.
      ↳ posture shift, camera in one step

HER   Una domanda ciascuno. Ma niente risposte preparate.

      [ Comincia tu ]  [ Comincio io ]  [ Cambia idea ]
```

**`Comincia tu`** → a `say` through the normal pipeline:

```text
HER   Qual è una cosa piccola che riesce quasi sempre
      a migliorarti la giornata?
```

**User types** `Camminare la sera.`

```text
HER   Capisco.
      Forse è per questo che questa terrazza ti sta bene.
```

StoryDirector records `lastTopic: 'evening walks'`, `pendingQuestion: null`. A
later card with a `callback` condition can reach for it.

**User taps `Più vicino →`** — the only route up. `ConsentFlow.initiated()`,
`userStepMinMs` satisfied:

```text
Caldo → Romantico

HER   Va bene. Un po' più vicino.
      ↳ camera tightens, expression shifts, music warms

  ● Caldo ─ ● Romantico ─ •     [ Ancora → ]
  ← Più piano                                          Fine
```

Then it continues. Two minutes or two hours. `Fine` is the only ending.

---

## 14. Fan service, mechanically

The transferable mechanic from adult VNs is not more explicit prose. It is the
loop:

```text
anticipation → the user's choice → immediate reaction → a sensory change
            → a new possibility that was not there before
```

"Ho un'idea." `[ Dimmi ]` `[ Sorprendimi ]` → camera moves, expression changes,
music shifts, *"Va bene. Allora niente preavviso."* — that is stronger fan service
than a paragraph, because the user caused it and can see that they caused it. A
paragraph is something you read; this is something you did.

Applied to this design:

- **anticipation** — a beat that opens a door without walking through it;
- **agency** — the reaction follows a tap, within ~100 ms, locally;
- **sensory payoff** — `effects`, not adjectives: pose, framing, light, music;
- **escalation stays the user's** — the reward for a choice is never a level. That
  is what keeps this a playground rather than a slot machine.

**On register.** The repo's boundary is warm/sensual and non-explicit —
`docs/INTIMATE_MODE.md`, `proactiveNsfw: false`, `PrivateBeats.BANNED`, and the
prompt suffix's "stay warm, relational and non-explicit". Everything in this
document is mechanics and works unchanged within that boundary. Moving the
boundary is a separate, explicit decision that is yours to make; it would mean
revisiting the validators and the profile, not this plan.

---

## 15. Sequence and risk

| # | Milestone | Depends on | Risk |
| --- | --- | --- | --- |
| P14 | Language + defects 2.1/2.3 | — | Low. Tier C scope is the only judgement call |
| P15 | StoryDirector state + events | P14 | Low. Additive; nothing reads it yet |
| P16 | Remove story timers | P15 | **Medium.** Private has no beats until P18 lands |
| P17 | Idle clock, stages 1–3 | P15 | **Medium.** The busy predicate is the whole risk |
| P18 | Beat deck | P15, P16 | **High.** Largest content migration |
| P19 | say/action choices | P15 | Medium. New trust boundary — see §8 |
| P20 | Archetypes | P18 | Low |
| P21 | Embodied rewards | P18 | Low |
| P22 | Replay memory | P20 | Low |
| P23 | Tests | all | — |

**Sequencing warning.** P16 removes the beats and P18 restores them. Landing P16
alone leaves Private with an opening line and nothing else. Either land P16+P18
together, or have P16 keep the existing beats firing through the StoryDirector as
a single legacy card until the deck exists. The second is safer and is what I
would do.

**Smallest useful slice**, if you want something shippable before the whole
sequence: P14 + P17. Language coherence and a character who notices silence, with
the beat system untouched. That is two milestones and it is most of the felt
difference.
