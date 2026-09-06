# Selected is not playing

## The transcript

Real session, current `master`:

```
NEXUS  Playing “Flying: Relaxing Sleep Music…” — https://youtube.com/watch?v=1ZYbU82GVz4
YOU    can you please reproduce the video
NEXUS  I'm not capable of reproducing the video…
YOU    play it please
NEXUS  I'm a text-based AI assistant, I don't have the capability to play videos directly.
```

She is not confused, and she is not wrong. Choosing a tile in Together **publishes a card and
stops there** — `ConversationPublisher` says so in its own header: "nothing here plays
anything." But `selected` and `playing` were the same field, so the first message reported a
published card as playback, and the next one, asked to do the thing she had just claimed to be
doing, had nothing to act on.

Every other symptom follows from that one missing distinction.

---

## M1 — `MediaSession` ✅

One place that holds what was searched, what was chosen, and what is actually playing.

```
idle → results → selected → loading → playing ⇄ paused → ended
                                   ↘ blocked
```

`selected` is a card on screen with a thumbnail on it. `loading` is playback having been asked
for and nothing having confirmed it. `playing` means **the player said so** — not that the app
asked. `blocked` is the browser refusing to make noise, which is a state and not an error: the
copy that goes with it is "tap Play", not "something went wrong".

`results` is what makes "the first one" mean anything. `selectIndex` rejects anything that is
not an integer, `null` and `''` included — `Number(null)` is `0`, so a loose check turns
"nothing" into "the first one" and plays something nobody asked for.

Stopping is not forgetting: `stop()` keeps `current`, so *"what did we just listen to?"* still
has an answer. Only an explicit `clear()` takes that away.

Nothing here touches the DOM. The player belongs to `YouTubeEmbed2D`, the card to
`ConversationPublisher`, the prompt to `CurrentMediaContext`. A state machine that also reached
into an iframe would be a second owner of playback, and having two is the bug.

## M2 — hearing back from the player ✅

The iframe is a cross-origin document, so nothing on the page could contradict the app's
assumption — including when the browser had refused to play any sound at all.

`embedUrl` gained an opt-in `jsapi` flag (`enablejsapi=1`, off by default so nothing that
embeds a video for display changes shape), and `YouTubePlaybackAdapter` attaches YouTube's
IFrame API — lazily, on first playback, never on a page where nobody presses play.

`PLAYING`, `PAUSED` and `ENDED` map straight through. `BUFFERING` deliberately maps to nothing:
it is a moment inside playback, not a state of the session, and reporting it would make the
avatar stop and start every time a phone changed cell. A player that is asked to autoplay and
is still unstarted after four seconds has been refused — that is what an autoplay policy looks
like from inside the page — so it becomes `blocked`.

Every failure path degrades to what the card did before: it plays, and the app goes back to not
knowing. Nothing here may be the reason a video does not start. A second backstop in the embed
catches the case where the adapter never attached at all, so the session can never sit at
`loading` for the rest of a session while the prompt says "asked, not confirmed yet".

## M3 — `▶ Play` in Together ✅

A search row now has two meanings. The row **chooses** — publishes the card, exactly as it
always has. `▶` **plays** — publishes the same card and starts it.

A sibling rather than a child, because the row is a `<button>` and a button inside a button is
invalid HTML that browsers resolve by silently dropping one of them. The wrapper carries the
flex row, so every existing rule still applies to the element it always did.

**No capture is started by `▶`.** Playing a video in the chat needs no `getDisplayMedia` —
that belongs to Watch and the share-a-tab path, and §2a's consent machine stays its only owner.

`▶` starts playback by waiting for the card to appear and clicking its facade: the same code
path a finger takes, so playback, the collapse button and the state reporting behave
identically whether a person or the app started it. It gives up quietly after four seconds.

## What the card and the prompt now say

| situation | before | now |
|---|---|---|
| card published, nothing started | *Playing “…”* | *I found “…” — tap it to play* |
| `▶ Play` pressed | *Playing “…”* | *Playing “…”* |
| prompt, selected | "The user is watching something right now" | "It is NOT playing yet… tell them to tap the card" |
| prompt, playing | same sentence | "The app reports that this is playing right now" |
| prompt, blocked | same sentence | "The browser refused… tell them to tap the card" |

The one thing that survives every rewording, and is asserted in every state: she is never told
she watched or listened to it. Metadata is not perception.

## Verified in a browser

At 412×915 against the live gateway: publishing without `play` says *I found… tap it to play*
and the prompt says NOT playing; pressing the card emits an iframe carrying `enablejsapi=1` on
`youtube-nocookie.com`; the title survives the card path; and with YouTube unreachable the
session resolves to `blocked` with "tap the card" rather than claiming playback.

Eight mutants, all killed — including the original bug itself (`select` marking things
playing), optimistic `requestPlay`, `isPlaying` counting `loading`, and the prompt describing a
session about a different video.

## M4 — the verb is carried out ✅

Three transcripts, one root cause each.

**`play()` did not play.** The whole chain worked — the model understood, chose search terms,
emitted the directive; the directive reached `fulfil`; `fulfil` searched, picked one, called
`play()` — and `play()` published a card without the flag that starts it. The one function in
the app whose name is the verb was the single place the verb was not carried out. It is a
one-line fix and it was the entire third transcript.

**"play music please" listed five videos.** `play` and `find` were in the same verb list, so a
request to *start* something was answered with a catalogue and four more steps. Split into
`execute` (play, put on, start, execute, reproduce) and `discover` (find, search, show me,
list). The two sets are disjoint and a test asserts that, because the order of the checks is
only safe while it is true.

**"play the fist song of the list" searched YouTube for those words.** The app was holding the
list — `MediaSession` keeps it precisely so "the first one" can mean something — and nothing
was reading it. References now resolve *before* anything treats the sentence as a query, and
both search paths record what they drew. `fist` is in the pattern on purpose: it is what the
user typed and what dictation produces, and a parser that is right about English and wrong
about the sentence in front of it has failed.

**One action per Together row.** M3's second ▶ button is gone; the ▶ is now a cue inside the
row. "Choose this music but do not start it" is not a thing anybody wants inside a panel called
Watch, and offering it made every result carry two competing actions.

**Playback starts synchronously.** The first version polled — publish, wait 120 ms, hunt the
document, synthesise a click. That spent the user activation a browser grants for a short
window after a real tap, so the path most likely to be *allowed* to play was the one throwing
the permission away. It also fixed a real bug: the document-wide lookup would start an older
card for the same video further up the conversation.

**The prompt stopped contradicting itself.** `TogetherCapability` says "choose something and
play it"; `CurrentMediaContext` said "tell them to tap the card". Handed both, the model
followed the second — which is why "play it please" got "tap it to play" from an app that had
just been told it could play things. Only `blocked` says tap now, because there it is true.

Verified live at 412×915: `play: true` reaches the publisher, the session goes to `loading`,
and an `<iframe>` carrying `enablejsapi=1` is actually created; "play the fist song of the
list" resolves to index 0 with no provider call; execute and discover classify correctly.

Seven mutants; five died immediately. Of the two survivors, one exposed an untested branch
(every prompt test used a video, so a mutation to the music sentence survived the whole suite)
and one was provably equivalent — the verb sets are disjoint, so the check order cannot matter
today, and the test now asserts that invariant rather than the order.

---

## M5 — knowing it is playing, and being able to stop it ✅

    YOU    play a song about relaxation
    NEXUS  Playing “Relaxing music Relieves stress, Anxiety and Depression…”
    YOU    I like this song thank you
    NEXUS  ...it looks like the playback hasn't started yet. Please tap the card!

It was playing. The user could hear it.

**Silence was being read as refusal.** M2 added a nine-second backstop for the case where the
IFrame API never attaches — a blocked script, a slow network, an origin mismatch — and it
called that state `blocked`. But `blocked` means *the player reported ready and then did not
start*, which is evidence. Not hearing a player is the absence of evidence, and the app was
treating one as the other, then putting a flat contradiction of the user's own ears into her
mouth.

So there is a new state, `unconfirmed`, and its prompt says what is actually true: *"the app
cannot tell whether it is playing — it is most likely playing. Do NOT say it has not started,
do NOT tell them to tap anything."* `blocked` still says tap, because there it is honest.
`unconfirmed` is provisional and never overwrites something observed: a PLAYING that arrives
late still wins, and the timer cannot talk over a state the player actually reported.

**Stop, pause and continue.** Until now the only way to stop a video was the × on the card,
which is fine with a mouse and useless to somebody who has just said "stop the music" out
loud. The player handle has been on the card since M2; `control()` is the door to it, and the
transport patterns are whole-message anchored — *"stop talking about that"* and *"I had to stop
at the shop"* are not commands. Misreading a sentence as "stop" cuts off music somebody is
enjoying; missing a phrasing only means the model handles it.

Stop prefers the API, which silences the audio and **leaves the card where it is** — they asked
for it to stop, not to vanish, and *"what did we just listen to?"* is a question asked after the
music stops. With no player to talk to it collapses the iframe instead: cruder, loses the
position, and definitely works. There is no crude equivalent of pause, so pause without a
player returns false rather than claiming to have paused something.

Verified live: the backstop lands on `unconfirmed` rather than `blocked`; the prompt says
"most likely playing" and never "tap the card to start it"; "stop the music" classifies while
"stop talking about that" does not; and `control('stop')` removes the player element while the
session still knows what was playing.

Seven mutants. Three survived the first pass and each named a real gap — the embed's backstop
and `control()` had no tests at all, and the stop pattern's anchor was untested. All die now.

---

## M6 — finding is not playing ✅

    YOU    search music about dance
    NEXUS  Playing “70s & 80s Party Classics!…”

They asked to look. The app chose for them and started it — which is not a smaller version of
what was asked for, it is the opposite, and it cannot be walked back by saying "no, the other
one", because something is already making noise.

**The phrasings missed the patterns entirely.** `search music about dance`, `show me dance
videos`, `list me the top 3 dance songs` matched nothing, so they fell through to the model —
which had only ever been told *"choose something and play it"*, and did. The verb list now
covers them and they classify as `discover`.

**"The top 3" says how many, not what.** It was being left in the query, so a request for three
songs searched YouTube for the words *top 3* and came back with compilations called "Top 3".
The count is read out, capped, and honoured.

**A connector leaked.** Widening the verbs made `search` match before `search for`, so
`search for dance music` asked YouTube for *"for dance music"*.

**The model gets its own verb.** `<find kind="music">terms</find>` shows results and starts
nothing, with the prompt saying not to name titles it has not searched for. A reply carrying
both tags lists rather than plays — the less destructive of the two, since a list can be
followed by "play the first one" and something playing cannot be un-played.

**The rows are the panel's rows.** Same markup, same classes, in a chat message: one thing to
keep in step, one answer to "what does a result look like". One tap plays, through
`MediaIntent.play`, so the card, session and prompt behave as they do on every other route.

**Titles arrive readable.** The Data API escapes them, and the app renders titles as text —
correctly, since a title is untrusted uploader text that must never be parsed as markup. So
`Drake - One Dance ft. Wizkid &amp; Kyla` reached the screen with the entity intact. Decoded by
a five-entry table rather than by an HTML parser, for the same reason.

### Verified against a real YouTube search

The first time this has been possible — a real Data API key, held only in the dev server's
environment and never written to the repo (checked).

| | |
|---|---|
| `search music about dance` | 4 real rows listed, **nothing playing** |
| `can you list top 3 dance songs` | exactly 3 rows, nothing playing |
| `play the first one` | plays row 1, no new search |
| `play music about dance` | plays immediately, as before |

Seven mutants. One survived and named a real gap: every entity assertion called the helper
directly, so a mutation stopping `normalize` from using it passed the whole suite.

---

## M7 — the model sees what the person sees ✅

    YOU    can you dance
    NEXUS  It seems you're trying to play a video, but the user has not specified which
           video they want to watch...

Talking about "the user" in the third person, in reply to a question addressed to her. That is
what a model does when the transcript stops looking like a conversation it is part of — and
this one had holes in it.

`say` drew messages and recorded nothing. Every turn the media interceptor handled — "stop",
"play the first one", "can you search top music about love", and the app's replies to each —
was on screen and absent from the history. Meanwhile `ConversationPublisher` *did* record its
cards. So the model received:

    user       hello there
    assistant  Hello! Welcome...
    assistant  Playing “Relaxing music…” — url
    assistant  Playing “TOP10 LOVE SONGS…” — url
    assistant  Playing “New Love Songs 2020…” — url
    user       can you dance

Three assistant turns in a row with nothing from the user between them, because the cards were
recorded and the requests that caused them were not.

Now the screen and the transcript are written together, in the one function every path in this
file goes through. The publisher's own entry is gone — with `say` recording, writing it again
would put the card in twice, and a transcript that repeats itself is its own kind of confusion.
A page whose `ChatManager` keeps its own history is left alone, for the same reason.

### Verified by replaying the conversation

Same seven turns against the live model. The transcript alternates user/assistant throughout —
**longest run of same-role turns: 1**, where it had been three — and the question that broke it
now answers as herself:

> *"I can't dance physically, but I can definitely pick some fun dance music for you! Want me
> to search for some upbeat tracks? 💃"*

Five mutants, all killed.

---

## Not done here

**The conversational router** — "the first one", "number three", "pause it" as spoken commands,
and routing at `handleUserMessage` so voice and keyboard behave identically. `MediaSession`
holds the state those commands need; nothing reads it yet.

**Content awareness.** She has title, creator, description and URL. She has no frames, no
audio and no captions, and the prompt says so in every state. Understanding what is *said* in a
video is a separate feature (D11), and pretending otherwise would be the same class of bug this
document is about.
