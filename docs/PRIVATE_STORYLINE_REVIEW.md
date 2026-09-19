# Private mode: is the storyline good enough?

> **Status: the five findings below have been fixed.** This document is kept as the record of
> what was wrong and why, because the fixes only make sense against it. §7 at the end says what
> shipped, what was deliberately not done, and what is still open.


An honest review of what a Private session actually contains, measured against what it needs
to be for someone to want a second one.

Short answer: **the architecture is excellent and the storyline is not.** The gate, the
consent flow, the escalation ceiling and the restore-on-exit are the best-built part of this
feature and should not be touched. What ships on top of them is four sentences on a timer,
which a user will exhaust in about half an hour and which cannot respond to anything they say.

Everything below is counted out of the source.

---

## 1. What a session actually contains

`IntimateExperienceSession.start()` (`src/features/together/TogetherCapability.js`) schedules
five `setTimeout`s and nothing else:

```text
 0s    opening          preset string, + "<scene> feels like a good place for it."
45s    mood choice      two buttons: Playful | Tender  →  one preset string
120s   consent check-in two buttons: Keep it sweet | A little more flirty/sensual
210s   middle           preset string
285s   closing          preset string
300s   complete         card swaps to "✓ Private moment complete"
```

So the authored content heard in one session is **four sentences**. The preset supplies five
strings — `opening`, `playful`, `tender`, `middle`, `closing` — and only one of `playful` /
`tender` is ever heard.

Three presets × 5 strings = **15 authored sentences for the entire feature**, of which any one
playthrough uses 4.

Between the beats there are three stretches of dead air on the card: 75 s, 90 s and 75 s. Over
a five-minute experience, the scripted layer is silent for four of them.

### Replay value, counted

| preset | distinct playthroughs |
| --- | --- |
| Affectionate | 2 (playful or tender) |
| Romantic | 2 |
| Sensual | 2 |

**Six.** After six sessions — thirty minutes — a user has seen every authored line in Private
mode. The seventh session is a literal repeat of the first.

---

## 2. The five findings that matter

### 2.1 The scripted voice and the conversational voice are two different people

This is the most serious one, and it is not a matter of taste.

`_speak(text)` does exactly two things: `view.showMessage(text)` — which writes into a div —
and `this.say(line)`, which is `window.NEXUS_BD_SAY = (text) => speakText(text)` in
`src/main.js:985`. That is **text-to-speech and nothing else.** It does not call
`addMessageToHistory`. It does not call `_persistChat`. The four scripted lines never enter the
conversation transcript.

Meanwhile the composer is not intercepted — `_bindComposer` only *observes* it — so anything
the user types goes to the ordinary LLM chat, which receives `privateSystemPromptSuffix()` and
answers in ordinary chat bubbles.

The consequence: **she says four things out loud that the model answering the user has never
heard.** She can open with "I thought we could keep this simple and warm", the user replies,
and the model — with no record that the line was ever spoken — answers as though the session
had not started. Two channels running in the same card, neither aware of the other.

Everything else in this document is a content problem. This one is a coherence problem, and it
is the reason a Private session can feel like talking to someone who is not listening.

### 2.2 The one branch in the whole experience has no consequence

At 45 s the user picks **Playful** or **Tender**. The handler speaks the matching preset string
and returns. The choice is never stored — there is no `this.mood = …` anywhere in the class —
so nothing downstream reads it. `middle` at 210 s and `closing` at 285 s are the same strings
either way, and the prompt suffix does not mention it.

A choice whose entire consequence is the sentence that acknowledges it is decoration. Compare
Scene Tale, whose two choices actually branch a plan.

### 2.3 Escalation changes the label and the prompt, not the performance

Accepting a check-in raises `adult.level`, which does three things: repaints a word in the
footer (`Warm` / `Romantic` / `Sensual`), changes a number in the prompt suffix, and widens
`intensityCeilingByLevel` in the adult profile.

That third one is where the expectation breaks. The ceiling maps levels to motion intents:

```js
1: ['flirt']
2: ['flirt', 'tease', 'beckon']
3: ['flirt', 'tease', 'beckon', 'sensualSway', 'slowBurn']
```

But **`IntimateExperienceSession` never emits a motion intent.** Not once. It activates the
`adult` mode and leaves the behaviour engine to its own idle profile. So advancing to level 3
opens a door that the Private storyline never walks through, and the user — who just answered a
consent question to get there — sees the pace word change and nothing else happen.

The scripted lines are also level-blind. `middle` and `closing` are identical at level 1 and
level 3.

### 2.4 Affectionate's check-in beat is a non-event

`Affectionate` has `maxLevel: 1`. At 120 s, `_offerCheckIn` hits
`if (level >= this.preset.maxLevel)` and shows *"This pace feels good. We can keep it right
here."* — no buttons, no choice.

So the gentlest preset, which is the one most people will try first, has its 120-second beat
replaced by a line that tells them nothing is going to happen. The first impression of Private
is its emptiest run.

### 2.5 Nothing carries over

Private stores nothing. `ConversationReset.KEPT` lists `nexus_study_history` as deliberate
between-sessions memory; there is no Private equivalent, and the completion card states the
position plainly: *"Nothing from this Private moment was added to Playground Histories."*

As a **privacy** promise that is correct and should stay. But it is currently doing double duty
as a **product** decision, and there it is costing a great deal: session 10 opens exactly like
session 1. No "last time you liked it tender." No sense that anything accumulated. For a
companion product, continuity is the single largest driver of wanting a next session, and this
feature has none of it by construction.

The two are separable — device-local, opt-in, nothing in the transcript, one line of
preference rather than a log of what was said — but nobody has separated them yet.

---

## 3. What is genuinely good, and must not be "improved"

Worth stating plainly, because the fixes below must not cost any of it:

- **Two questions, kept separate.** Settings preference decides whether the tile is *visible*;
  preference + `isEnabled()` + an attached `ConsentFlow` decide whether a session can *start*.
  A tile that vanished when a background flow had not attached would read as a feature that
  broke.
- **The ceiling is installed as a property descriptor and restored exactly.**
  `_installCeiling` stashes the original descriptor for `adult.maxLevel` and puts it back.
- **Escalation is earned and reversible.** Two minutes at a level before the next is offered,
  a check-in every level, `Keep it cozy` soft-exits to level 1 with no interrogation,
  `stop`/`exit` hard-exits immediately.
- **Exit restores everything.** `blackboard.activity`, `escalationLevel` and the active mode
  are snapshotted and written back; ten enter/exit cycles are covered by a test for drift.
- **Beats yield to the human.** `_conversationBusyUntil` pushes the next scheduled line 8
  seconds out every time the user types, re-checking each second. A scripted line never talks
  over someone mid-sentence. This is a small thing done properly and it is the one place the
  two channels *do* cooperate.
- **`proactiveNsfw: false` has no `true` branch**, and the ranker enforces it independently of
  the profile.

None of the recommendations below touch any of this.

---

## 4. Are three modes enough?

**The count is not the problem.** Three named intensities — Affectionate, Romantic, Sensual —
is a clear, legible ladder, and adding a fourth preset with five more sentences would produce
*eight* distinct playthroughs instead of six. That is not a fix; it is the same shallowness at
a larger size.

What the presets are missing is not siblings, it is **depth and reactivity**:

| what a preset has now | what makes a session feel different the second time |
| --- | --- |
| 5 fixed strings | lines chosen from a pool, or generated |
| 1 branch with no effect | a branch the later beats read |
| a fixed 300 s arc | beats that advance on turns taken |
| identical at every level | lines that know the current level |
| no memory | one remembered preference |

Six playthroughs of one preset that reacts beats eighteen playthroughs of three that do not.

---

## 5. Recommendations, ranked by effect per unit of work

**1. Put the scripted lines into the transcript. (biggest effect, smallest change)**
`_speak` should write the line where the model can see it, the same way every other assistant
message is written, instead of only speaking it. One call. It makes her the same person in both
channels, and every later improvement compounds on it. Until this is done, richer scripted
content just gives the model more to contradict.

**2. Let the beats be generated rather than fixed.**
Playground already proves the pattern in this repo: one LLM call up front, validated, with a
written fallback when the model or the JSON fails. Private could plan its four beats the same
way from `{ preset, scene, ceiling }` — and fall back to exactly today's strings, so the worst
case is what ships now. This is the single change that ends the six-playthrough ceiling, and it
reuses `StoryPlanner`'s shape rather than inventing one.

**3. Make the mood choice mean something.**
Store it. Read it in `middle` and `closing`, and put it in the prompt suffix. Even with today's
fixed strings this doubles the distinct playthroughs for the cost of one field and two extra
sentences per preset.

**4. Give Affectionate a real 120-second beat.**
A preset at its ceiling should get a *choice about texture* — quieter or closer, a memory or
the present — not a line explaining that nothing will happen.

**5. Let escalation change something you can see.**
The ceiling already maps levels to intents. Emitting one appropriate motion on a level change
would make the check-in the user just answered have a visible answer. Pace word → performance,
not pace word → label.

**6. Separate the privacy promise from the memory promise.**
One device-local, opt-in preference — preferred preset, preferred mood, whether the soundtrack
is wanted — restores continuity without storing a word of what was said. The completion card's
promise stays literally true.

**7. Advance on turns, not only on the wall clock.**
A 300-second arc delivers `closing` at 285 s whether the user has written twenty messages or
none. `_conversationBusyUntil` already defers a beat for a talker; the next step is beats that
*wait for* a turn, with the clock as a ceiling rather than the driver.

---

## 6. The verdict

The Private feature is a very well-built room with almost nothing in it. Its consent model,
restore discipline and gate separation are the strongest work in the Together tree. Its
storyline is four sentences, one inert choice and an escalation ladder whose rungs change a
word in a footer.

It is not yet good enough to make someone want a seventh session — and the reason is not that
three presets are too few. It is that the sessions do not differ, do not remember, and do not
listen. Recommendation 1 fixes *listening* for almost nothing; recommendation 2 fixes *differ*
by reusing a pattern the repo already ships; recommendation 6 fixes *remember* without giving
up the privacy promise.

Do those three and the count of presets stops mattering.


---

## 7. What shipped

Recommendations 1, 2, 3, 4, 6 and 7 are implemented. Recommendation 5 was **deliberately not
done** — see below.

### `src/features/together/PrivateBeats.js` — what she says

Two producers of one plan shape. `plan()` asks the model and validates the reply;
`fallbackPlan()` builds one from written pools. The fallback is the floor, not a degraded mode:
most installs of this app point at a local model or at nothing, so variety conditional on a
cloud provider is no variety. The pools give **24 distinct playthroughs per preset** with no
LLM at all — three openings × two mood lines × two middles × two closings — against six for the
whole feature before.

`validatePlan` is a trust boundary rather than a shape check. Every field is length-capped and
control-stripped, and a plan is refused whole — never patched — if any field carries a URL,
markup, talk of the machinery, or the register the prompt suffix already forbids: isolation,
secrecy, obligation. Half a generated plan and half a written one is a voice that changes
register mid-session, which is worse than either.

### `src/features/together/PrivateMemory.js` — what it remembers

Four enums and two numbers: last preset, last mood, last soundtrack choice, completed-session
count, timestamp. There is **no field for content**, and `write()` drops anything not in the
schema, so a later caller cannot start storing conversation through a door this file left open.
That is the difference between "we do not store it" and "we cannot". Device-local, written only
when a session *completes*, removable with `forget()`.

The completion card's promise is untouched: nothing reaches Playground Histories.

### Changes in `TogetherCapability.js`

| finding | fix |
| --- | --- |
| §2.1 split voice | `_speak` now calls `chatHistory.addMessage('assistant', line)` — the transcript the model reads. Not `NEXUS_YT_ASK.say`, which would also draw a second bubble next to the card. A page whose `ChatManager` owns its own history is left alone, or every line would double. |
| §2.2 inert branch | `this.mood` is stored, read by `_moodLine` for the 210 s and 285 s beats, and added to `privateSystemPromptSuffix` — so the model answering in chat is in the same mood she is. |
| §2.3 silent escalation | Accepting a check-in speaks `plan.levelLines[level]` instead of repainting one word. |
| §2.4 dead Affectionate beat | A preset at its ceiling gets `_offerTextureChoice` — quieter or closer. It is texture, not escalation: it grants nothing, so it needs no consent step and never calls `checkIn`. |
| §2.5 no continuity | A completed session records its four enums; the setup screen pre-selects the remembered preset. Pre-selected, never auto-started — `Begin private moment` is still a press. |
| §5.7 clock-driven ending | `_complete` defers while the user has taken a turn in the last 30 s, bounded by `GRACE_MS` (3 min). A silent session still ends on time; a live one is not hung up on. |

Planning is deliberately **not awaited**. `start()` speaks the written opening immediately and
`_planAhead()` upgrades the later beats if a generated plan arrives and validates. A silent card
in front of someone who just pressed *Begin private moment* is the worst possible place for a
wait, and a plan that lands after the session ended is discarded rather than swapped in under a
completion card.

### Recommendation 5 was not done, on purpose

"Let escalation change something you can see" meant emitting a motion intent on a level change.
It should not be built. `adult.profile` declares `proactiveNsfw: false` as *"an invariant with
no `true` branch anywhere"*, and `UtilityRanker.js:55` independently refuses an nsfw clip whose
intent did not come from the user. Making Private emit one would be working around a rule the
codebase states explicitly and enforces in two places. The escalation lands in words instead,
which is `levelLines`.

### Still open

- **`AudioFocusManager` cannot duck a YouTube iframe.** `duck()` walks `audio,video` elements
  and clamps `.volume`; a cross-origin iframe is neither. The `setVolume()` added to the
  playback handle in T10 is the missing piece. At a soundtrack volume of 15 it is much less
  pressing.
- **Beats advance on the clock, deferred by conversation.** Recommendation 7 is half done: the
  ending waits for a talker, but the 45 s / 120 s / 210 s beats are still wall-clock with a
  yield, not turn-driven.
- **One LLM call per session.** The beats are planned once. A session that reacted to what was
  actually said would need a second seam, and that is a larger design question than this change.

### Coverage

| file | tests |
| --- | --- |
| `tests/behavior/private-beats.test.js` | 19 — pool depth, mood divergence, the written lines clearing their own validator, and six refusal cases |
| `tests/behavior/private-memory.test.js` | 8 — what it keeps, and that unknown fields and out-of-enum values cannot survive a write |
| `tests/behavior/private-session-depth.test.js` | 11 — transcript, mood consequence, level lines, texture choice, deferred ending, continuity, and that the model path never delays or breaks a session |

160 suites / 4144 tests pass; lint clean; the 11 `format:check` failures are the same
pre-existing ones, none in files touched here.
