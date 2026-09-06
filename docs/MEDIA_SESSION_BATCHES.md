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

## Not done here

**The conversational router** — "the first one", "number three", "pause it" as spoken commands,
and routing at `handleUserMessage` so voice and keyboard behave identically. `MediaSession`
holds the state those commands need; nothing reads it yet.

**Content awareness.** She has title, creator, description and URL. She has no frames, no
audio and no captions, and the prompt says so in every state. Understanding what is *said* in a
video is a separate feature (D11), and pretending otherwise would be the same class of bug this
document is about.
