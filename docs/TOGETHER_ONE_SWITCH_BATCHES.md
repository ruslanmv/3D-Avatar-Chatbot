# Together: one switch, and she can actually do it

**Status:** T1–T6 are **shipped**; T7 is still planning.
Below, the shipped batches keep their original text and carry a ✅ with what actually landed.

---

## 0. The conversation that started this

```
YOU    can you find music about relaxation
NEXUS  I'm sorry, but I don't have the capability to directly find specific music…
YOU    yes
NEXUS  Great! Here are some relaxation music categories: 1. Ambient & Nature Sounds…
YOU    can you play it
NEXUS  I'm sorry, but I don't have the ability to directly play music.
```

Every part of the machinery to do this already exists. `ProviderRegistry` searches YouTube,
`MediaSearchPicker` renders results, `ConversationPublisher` puts a player in the chat,
`CurrentMediaContext` tells the model what is playing, and the Music activity makes her dance
to it. The user asked three times and got three apologies.

**She is not missing a capability. She is missing the knowledge that she has one.**

---

## 1. Why it failed, line by line

Three separate faults, and they compound.

### "can you find music about relaxation" — the vocabulary is too narrow

`YouTubeAsk.PATTERNS` requires either the literal word *youtube* or a media noun after a play
verb:

```js
const PLAY = '(?:play|put on|start|queue up|pon)';
new RegExp(`^(?:search|look|find|browse)\\s+(?:on\\s+)?youtube\\s+…`)
new RegExp(`^${PLAY}\\s+…\\s+(?:on|in|from)\\s+youtube\\b…`)
```

*find music* has no "youtube" in it. *I want to relax* has no play verb. Neither matches, so
the message goes to the model as ordinary conversation.

### "can you play it" — the patterns are anchored at the start

Every pattern begins `^`. **"can you play…" never matches any of them**, and "can you" is how
most people ask. Nor is there a referent for *it*: the patterns are stateless, so a request
that points at the previous turn cannot be resolved even in principle.

### And then the real one: the model says no

This is the fault that makes the other two fatal rather than annoying. When a pattern misses,
the message reaches an LLM whose system prompt never mentions that this app can search or play
anything. So it answers the only honest way it can — *I don't have the capability* — and it
will keep doing that for every phrasing nobody thought to add to the regex.

**No list of patterns can be complete.** That is the design constraint, not an implementation
detail: any design whose only path is pattern-matching will produce this transcript again, in a
phrasing nobody predicted, forever.

---

## 2. What we are building toward

> "I want to relax" → she finds something, plays it in the chat, and settles into it. Eyes
> closed, it just plays.

Concretely, three properties.

**One switch.** Tapping any Together tile turns Together on — all of it, for good. Not seven
features with seven states. Settings gets one toggle to turn it back off, and that is the only
place the question is ever asked again.

**She can do it, and she knows she can.** When Together is on, her system prompt says what she
can actually do. She stops apologising, because the apology stops being true.

**It plays, without a detour.** A request that clearly names music or video ends with something
playing in the chat — not a picker to tap, not a list of genres, not "would you like me to
search?".

---

## 3. The design

### One switch, two paths, one place that plays

```
 you type ──► FAST PATH ─ unambiguous? ──yes──► search ──► play
              (patterns)                                    ▲
                    │ no                                    │
                    ▼                                       │
              MODEL PATH ─ she knows she can, and asks ──────┘
                                (a directive she emits)
```

The fast path is what makes *"play some lofi"* instant — no model round trip, no waiting. The
model path is what makes *"I've had a horrible day"* work at all. **Both end at the same
function**, so there is one implementation of "find this and play it" and one place where
consent, provider choice and failure live.

The fast path staying narrow is deliberate. It only fires when it is certain; everything
uncertain goes to the model, which is better at ambiguity than any regex will ever be. Widening
the patterns to cover "I want to relax" would be the wrong fix — it trades a false negative for
a false positive, and a false positive plays music at somebody who was telling you about their
day.

### Why she stops apologising

One paragraph appended to her system prompt while Together is on — the same seam
`NEXUS_MOTION` and `NEXUS_CURRENT_MEDIA` already use, so it costs one line at four call sites
and is empty when Together is off:

```
You can search for and play music and video in this chat. When someone asks for something to
watch or listen to — including indirectly, like "I want to relax" — pick something and play it
by emitting <play kind="music">search terms</play>. Do not ask permission first and do not list
options unless they asked for options.
```

The directive is a fenced tag rather than a tool call because this app talks to five providers
and only some support tools. A tag works on all of them, and the parser strips it before the
line is spoken, so she says *"Here's something calm"* and the music starts — the tag never
appears on screen or in the TTS.

---

## 4. The batches

### T1 — One switch ✅

**Shipped.** `TogetherSwitch` with three states rather than two, because "never touched" and
"deliberately off" are different facts: a fresh profile sees the launcher with the capabilities
off, any tile tap turns everything on for good, Settings turns it off. Off hides the launcher
**and** empties the prompt suffix.


`TogetherSwitch`: `isOn()`, `enable(reason)`, `disable()`, `onChange()`, persisted in one key.

Tapping any tile calls `enable('used-a-tile')` — **once**. It is not a prompt, not a modal, not
a first-run tour. Using the thing is the consent to have the thing.

Settings gets one toggle: *Together — shared watching, music and focus*. Off hides the launcher
and empties the prompt suffix. Nothing else in Settings gains a Together row, ever.

**Acceptance.** A fresh profile that taps Music has Together on afterwards, and still has it on
after a reload. Turning it off in Settings removes the launcher *and* the prompt suffix — a
switch that hides the button but leaves her claiming she can play music is worse than no switch.

---

### T2 — She knows what she can do ✅

**Shipped.** `TogetherCapability.systemPromptSuffix()` at the four sites that already append the
motion and now-playing suffixes. Empty when Together is off *or* when nothing can search, so no
promise is made that nothing can keep — and the keyless samples count as being able to play
something, because they are.


The prompt suffix above, added at the four existing call sites. `''` when Together is off or
the provider has no search, so a chat with Together off is byte-for-byte unchanged.

**Acceptance.** With Together on, "can you play music?" does not produce an apology. Asserted
against a recorded transcript rather than a live model, so the test is deterministic — what is
being tested is that the capability reaches the prompt, not that a model behaves.

---

### T3 — One function that finds and plays ✅

**Shipped.** `MediaIntent.fulfil`. First result rather than a list, empty query refused rather
than searched for, and `nothing-found` kept distinct from `search-failed`.


`MediaIntent.fulfil({ query, kind, source })`:

```
resolve provider ─► search ─► pick the first result ─► publish to chat ─► start the activity
```

Every caller uses it: the fast path, the model path, and the picker. One place for "nothing
found", "search not connected", "the provider died" — and one place where the samples from
`samples.js` are the answer when there is no key.

**Acceptance.** Three callers, one code path — proved by a test that stubs the search once and
drives all three.

---

### T4 — The fast path, unanchored ✅

**Shipped, with one deliberate change of plan.** The anchor is *kept* and an optional polite
lead-in matched at it — dropping `^` outright would have made "we could play something later" a
request. The modal requires a following "you", so "could we play music" is not addressed to her.
Verbs widened to `find`, `search for`, `look for`, `get me`; a play verb alone is still never
enough, which is what keeps "find my keys" out.

`play some jazz` still misses, on purpose: a bare genre has no media noun, and adding genres
would admit "play some football". The model path answers it in one round trip.


Drop `^`. Add the polite forms — *can you*, *could you*, *would you*, *please* — and the
non-YouTube verbs *find*, *put on*, *play me*. Keep it narrow: a play verb **and** a media noun,
or an explicit provider. Never fire on a bare "yes".

**Acceptance.** "can you play some jazz" plays jazz. "I had a hard day" does not play anything —
the false positive is the failure mode this batch is most likely to introduce, so it is the one
under test.

---

### T5 — The model path ✅

**Shipped.** `PlayDirective`, stripped beside the existing motion seam on `displayText` — which
covers the bubble, the transcript, the VR forward and `speakText` at once, because display and
speech are separate paths and "strip it" has to mean both. One directive runs however many she
writes; an unclosed tag from a truncated reply is hidden and never executed.


Parse `<play kind="…">…</play>` out of her reply, strip it before display and TTS, call
`MediaIntent.fulfil`. Cap it: **one directive per reply**, ignored entirely when Together is off,
and never honoured from a message that came from anywhere but the model.

**Acceptance.** The tag never reaches the screen or the speech synthesiser. A reply carrying
three directives plays one. A reply carrying a directive with Together off plays nothing and
shows nothing.

---

### T6 — "yes" means something ✅

**Shipped.** `PlayFollowUp`: one topic, two turns, taken from what the *user* typed and never
from what the assistant suggested — a model that offered five genres has not been chosen from.
The affirmative list is short by design; words that only sometimes mean yes are left out,
because a false positive here starts music at somebody mid-sentence.


A one-turn memory: when she has just offered to find something, the next affirmative fulfils it.
Expires after one turn, so a "yes" two minutes later about something else never plays music.

**Acceptance.** The transcript at the top of this document, replayed, ends with music playing.
That is the test — the whole design exists to change that transcript's ending.

---

### T7 — Eyes closed ✅

Once something is playing and nobody has typed for a while: she settles, and the chat quietens.
One tap, one key or one scroll brings it back.

**Shipped as an opt-in preference, off by default.** This is the one change from the plan as
written, and it was the right one. Every other batch here fixes something that was wrong;
this one is a matter of taste. Plenty of people put a track on precisely so they can keep
typing over the top of it, and for them an interface that fades is a fault they cannot explain
and would not know how to search for. So it is a box in Settings — *"Calm mode — dim the
interface while something is playing"* — and with that box unticked the app is the T6 app:
no attribute on the root element, no stylesheet in the page, no timer running, nothing.
`tests/together-ambient.test.js` asserts exactly that rather than leaving it to inspection.

**How it behaves once it is on.** Twenty-five seconds of quiet with something playing, and the
root element gets `data-nexus-ambient="on"`; CSS fades the topbar, the chat header, the avatar
footer, the launcher and the composer. Nothing moves, nothing is hidden, and nothing loses its
clicks — a dimmed composer is still a composer, and the tap that reaches for it wakes the page
on `pointerdown` before the `click` lands, so the control the finger arrives at is already at
full strength. Waking is instant: the transition is declared inside the settled rule, so it
fades on the way down and never on the way back. And a wake disarms for the current track —
settling once is atmosphere, settling again half a minute after somebody deliberately woke it
is the interface arguing with them.

**Acceptance, met.** No new permission and no new consent surface: this is the audio the user
already started. §2a is untouched, and loudly so — the recording indicator carries
`opacity: 1 !important` in the settled state, and both a unit test and a live browser check
assert it. The module contains no capture API at all, which is also asserted.

**One supporting change.** `CurrentMediaContext.set()` now dispatches `nexus:media`, because
T7 needs to know the moment something starts and polling for it would mean a timer running for
the whole life of every session to catch an event that happens twice an hour. It is guarded to
nothing and does not change what the model reads.


---

### T8 — She does what she says ✅

Found by running the shipped app against the live OllaBridge cloud gateway, not by reasoning
about it. Twelve turns of *"I want to relax play music"*, *"I want watch a very romantic
video"*, *"suggest me a music"*: **four played, eight did not**. The tag itself was fine — the
model emitted a usable `<play>` in 18 replies out of 20. Everything that went wrong went wrong
around it, and each failure was worse than the apology T2 removed, because each one *claimed
success*:

| what she said | what happened | fix |
|---|---|---|
| *"Playing a romantic video for you. 💕"* | no tag, nothing played | **claim backstop** |
| *"I'll put on some calming music for you."* | no tag, nothing played | claim backstop, immediate promises |
| *"Pulling up a sweet, romantic video for you."* | no tag, nothing played | claim backstop, verb found live |
| `play kind="video" tag="video"` | raw markup shown to the user | **bracket-less tag stripped** |
| *"Playing \"Ed Sheeran - Perfect\" — youtube.com/watch?v=2Vv-BfVoq4g"* | invented link, nothing played | **invented links stripped** |
| *"…here's a sample instead — “The Beatles — Here Comes the Sun”"* | invented card in the app's own voice | **fabricated cards stripped** |
| *(empty reply)* | empty bubble, nothing played | **silence is a backstop trigger** |
| *"I didn't find a playable result for that."* | search ran, found nothing, gave up | **samples on an empty search** |

**The claim backstop.** If a reply claims to be playing something and no directive ran, play
what the user asked for. Every word is load-bearing: *claims* (not "mentions music" — a reply
discussing a band starts nothing); *no directive ran* (this never competes with T5, so nothing
plays twice); *what the user asked for* (the query is the topic `PlayFollowUp` already holds,
never invented from her prose — no held request means nothing plays, whatever the reply says).
The verb list is an enumeration and enumerations are never complete; every verb in it was
added because a real reply used it, and none on speculation. This is a net under T5, not a
replacement for it.

**She does not know any URLs, so she must not write any.** She has never searched — a link she
writes is eleven plausible characters, and once it is in the bubble it is indistinguishable
from the app's real card. Worse, the app's own cards are in her context and she learned to
imitate them, titles and all. Both are stripped, and the prompt now forbids both. A guarantee
about what reaches the user cannot rest on the model choosing to comply.

**A search that found nothing is not a dead end.** The keyless samples were only ever consulted
when there was *no provider at all*, so a provider that registered and returned an empty list
skipped them and left the person with nothing. That was three of five remaining failures. The
card says in as many words that it is a sample, so nobody is misled — and something honest
beats a dead end.

**Result, same twelve turns against the same live gateway: 12/12.** No leaked markup, no
invented link, no fabricated card.

---

## 5. What we are deliberately not doing

**No autoplay without a request.** She plays what was asked for, never what she guessed somebody
might like.

**No widening the fast path until it guesses.** Ambiguity is the model's job. A regex that plays
music at somebody describing their day is a worse product than one that occasionally misses.

**No new consent surface.** Together is one switch. Every activity inside it already has its own
permission where it needs one, and this design adds none.

**No second player.** It plays where media already plays — in the chat, through
`ConversationPublisher`. A Together-only player would be a second thing to keep working.

---

## 6. Order

T1 and T2 first, in that order: they are small, and together they stop the apology, which is the
complaint. T3 next, because T4 and T5 both need it. Then T4 (cheap, instant, narrow), T5 (the
one that makes any phrasing work), T6 (the transcript's ending), T7 (the feeling).

The value is front-loaded on purpose: after T2 she stops saying no, and after T5 she actually
does it.
