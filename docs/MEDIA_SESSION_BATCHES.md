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

## Not done here

**The conversational router** — "the first one", "number three", "pause it" as spoken commands,
and routing at `handleUserMessage` so voice and keyboard behave identically. `MediaSession`
holds the state those commands need; nothing reads it yet.

**Content awareness.** She has title, creator, description and URL. She has no frames, no
audio and no captions, and the prompt says so in every state. Understanding what is *said* in a
video is a separate feature (D11), and pretending otherwise would be the same class of bug this
document is about.
