# Together Media Discovery & Conversation Playback — Batch Plan

**Status:** **D1–D10 and D13 are shipped**. D11–D12 (§7) are design only.
The shipped batches keep their original text and carry a ✅ with what actually landed.
**Scope:** `ruslanmv/3D-Avatar-Chatbot`, branch `claude/upgrade-feature-batches-3x0z82`.
**Rule for every batch below:** additive only. New modules plus guarded hooks and one small
contract extension; `TogetherPanel.js`, `watch.js` and `music.js` are not rewritten, and
`ConsentMachine` stays the single owner of every capture prompt.

**The balance to hold:** do not optimise for the smallest diff at the expense of
architectural correctness — and do not build a provider framework for hypothetical services
before the YouTube path works end to end. **Reuse first, abstract second.**

---

## 0. The product rule

> **Together is where you choose an experience.**
> **Conversation is where the chosen media lives and plays.**

Together may show a lightweight picker for a moment. The player belongs in the chat, because
that is the thing that persists, scrolls, and is still there when you carry on talking.

The finished feel:

```text
TOGETHER → 📺 Watch → Search videos → small results → choose one
   ↓
Together disappears
   ↓
CONVERSATION → compact YouTube card → play inline → keep talking to Nexus
```

Not *"I configured a media-provider subsystem."*

---

## 1. What is actually true today

Read before planning, because three assumptions in the brief turned out to need adjusting.

### The failure the user sees

```text
YOU    play a video in youtube of music
NEXUS  I can't search YouTube without an API key, but here's the search for "video".
       Add a key with localStorage.setItem('nexus.yt.apiKey', 'YOUR_KEY') …
```

Two separate defects in one message:

* **No key is configured.** `YouTubeCompanion.search()` (`YouTubeCompanion.js:167`) returns
  `null` when `apiKey()` is empty, and `YouTubeAsk.fulfil()` renders that sentence. Key
  resolution is already layered — `window.NEXUS_YT_CONFIG.apiKey` then
  `localStorage['nexus.yt.apiKey']` — so a settings-backed source slots in at the front
  without breaking anyone.
* **The copy teaches JavaScript.** A normal user is being shown a `localStorage.setItem`
  call. That is a developer instruction in a consumer surface.

Worth noting separately: the query extracted was `"video"`, not `"music"` —
`play a video in youtube of music` matches the `PLAY … MEDIA` pattern and captures the first
media word. Small parser issue, fixed alongside the copy.

### The canonical conversation path — and the constraint it imposes

The brief says to publish "either the canonical YouTube URL **or** the existing structured
youtube attachment shape". **Only the first survives a reload.**

`addMessageToHistory(sender, text, attachments)` (`main.js:4193`) does accept attachments, but
`_persistChat()` (`main.js:4608`) saves only this:

```js
const text = msg.querySelector('.message-text')?.textContent || '';
if (text) display.push({ sender, text });
```

Attachments are dropped. `_restoreChat()` replays `{sender, text}` through
`addMessageToHistory`, `NEXUS_YT_2D.observeChatHistory` sees the new rows and decorates them —
so a restored card exists **only because the URL is in the message text**.

**Decision:** publish the selected media as a normal assistant message whose text contains the
canonical `https://www.youtube.com/watch?v=…`. Nothing new to persist, nothing new to restore,
and the existing decorator does the rest. Extending persistence to carry attachments is a
separate, larger change and is explicitly out of scope here.

### What already exists and must not be rebuilt

| Piece | Reuse for |
|---|---|
| `NEXUS_YT` (`YouTubeLink.js`) | URL parsing, `isId`, extraction |
| `NEXUS_YT_COMPANION.search()` | the YouTube provider's `search()` |
| `NEXUS_YT_COMPANION.startParty()` | VR / companion-tab handoff |
| `NEXUS_YT_2D` — `buildCard`, `decorate`, `observeChatHistory`, `activate`/`deactivate` | Conversation card, facade, and the one-active-player rule |
| `contract.js` `inputs()` | the setup screen Together already renders |
| `audioSource.js` | local audio → analyser → beat detector |

`watch.js` already does `local video → <video> → VideoTexture` and
`captured tab → MediaStream → <video> → VideoTexture`. No new rendering path.

### The contract already has the seam

`contract.js:143` and `:268` describe Watch's and Music's setup screens declaratively:

```js
inputs: () => [
    { id: 'tab',  label: 'Share a tab',       permission: 'self', note: '…' },
    { id: 'file', label: 'Open a video file', permission: null, pick: pickFile('video/*') },
]
```

So a discovery entry is one more input, not a special case threaded through the panel:

```js
{ id: 'search', label: 'Search videos', kind: 'discovery',
  mediaKind: 'video', providerCapability: 'video.search' }
```

The panel learns `kind: 'discovery'` **once**, generically. No `if (activity.id === 'watch')`.

---

## 2. The batches

### D1 — Stop teaching JavaScript, and let Settings hold the key

✅ **Shipped** (`d2732ec`). Key in Settings ▸ Discovery & Media, legacy `localStorage` still read and never written, and the parser fix so *"play a video in youtube of music"* searches for **music**.

The smallest batch, and the one that fixes what the user actually hit.

* Key resolution gains a front entry: **Settings** → `NEXUS_YT_CONFIG` → legacy
  `localStorage['nexus.yt.apiKey']`. The legacy path stays; nobody is broken.
* Settings gains **Discovery & Media → Video search**, with a field for the key and a
  readiness line.
* Copy in `YouTubeAsk` and anywhere else becomes:

  ```text
  YouTube search isn't connected yet.        [ Set up YouTube ]
  ```

  The search link stays — the request is still honoured — but the `localStorage.setItem`
  sentence moves to `docs/YOUTUBE.md` and debug mode.
* Fix the query capture so `play a video in youtube of music` searches `music`.

**Acceptance.** A test greps the rendered no-key UI for `localStorage`, `setItem` and
`nexus.yt.apiKey` and fails if any appears. A key set in Settings reaches
`YouTubeCompanion.search()`. A key set the legacy way still works.

---

### D2 — One normalized media result, one provider

✅ **Shipped, at the size D3 needed.** `MediaResult`, `providers/youtube.js` wrapping `NEXUS_YT_COMPANION.search()`, and a registry asked by capability. No priority configuration and no fallback chain — those are D6, when there is something to order.

`src/features/discovery/` — `ProviderRegistry.js`, `MediaResult.js`,
`providers/youtube.js`. The YouTube provider **wraps** `NEXUS_YT_COMPANION.search()`; the
search implementation is not copied.

```js
{ id, provider: 'youtube', kind: 'video' | 'track',
  title, creator, thumbnail, duration: null,
  url: 'https://www.youtube.com/watch?v=…',
  playback: { type: 'youtube', inline: true, immersive: true } }
```

Readiness is explicit, so a dead provider is never offered as working:

```js
{ configured, available, capabilities: ['video.search', 'music.search', 'video.play'], reason }
```

**Acceptance.** Raw API JSON never reaches Together. A provider that throws yields
`available: false` with a reason, and the registry keeps working.

**Do not over-build.** One provider, enough abstraction to add a second later. No Jamendo, no
SearXNG, no Brave in this batch.

---

### D3 — The Watch picker

✅ **Shipped.** A `kind: 'discovery'` input the panel recognises generically, so Watch and Music share one implementation. Search-on-submit only, epoch-guarded against stale results, `aria-live` status, real `<button>` rows. Verified in a browser: opening Together, opening Watch and searching each reach the consent machine zero times.

`contract.js` gains the `search` input above `Share a tab`. `TogetherPanel.js` learns
`kind: 'discovery'` and renders `src/features/together/ui/MediaSearchPicker.js`.

```text
📺 Watch    What are we watching?

[ 🔎 lofi hip hop                    ]   YouTube

  ┌───────┐ Lofi hip hop radio
  │ thumb │ Lofi Girl
  └───────┘
  ┌───────┐ Chillhop essentials
  │ thumb │ Chillhop Music
  └───────┘

──────── or ────────
Share a tab
Open a video file            Back
```

* 3–4 results. Thumbnail, title, creator. Real `<button>`s, keyboard reachable, `aria-live`
  on the status line.
* **No iframe in the dialog, ever.** The picker is a picker.
* State machine with no raw errors: `Search videos…` / `Searching YouTube…` / `3 results` /
  `No videos found for "…"` / `YouTube search is unavailable right now. [Try again]` /
  `YouTube search isn't connected. [Set up YouTube]`.
* Stale-result protection by request id or `AbortController`: a slow query A must never
  overwrite query B's results.
* **Searching is not starting Watch.** No capture prompt on opening Watch, on typing, or on
  searching. Only entering the immersive flow starts the activity.

**Acceptance.** Opening Together, opening Watch, and searching each trigger zero
`getDisplayMedia`. Search failure leaves `Share a tab` and `Open a video file` present. No
`<iframe>` exists in the Together DOM at any point in this flow.

---

### D4 — Selection publishes into the Conversation

✅ **Shipped.** Together closes *first*, then an ordinary assistant message carrying the canonical URL goes through `YouTubeAsk.say` plus the app's own `_persistChat`. `NEXUS_YT_2D` decorates it into the card that already existed. Verified in a browser, end to end.

The batch the whole plan exists for.

```text
select result → Together closes → assistant message with the canonical URL
              → NEXUS_YT_2D decorates it → card in Conversation
```

A small `ConversationPublisher` writes through `addMessageToHistory('avatar', text)` so
`_persistChat` picks it up. Text reads `Playing "Lofi hip hop radio" — <url>`.

* Together **closes** on selection. Nothing floats over the avatar after a choice is made.
* Reopening Together while Watch is running shows session status (`● WATCH · Watching
  together · Lofi hip hop radio · Stop · Change`) — never a second player.
  **One media item, one visual owner.**
* No autoplay from search, from history restore, or from Nexus mentioning a video. Playback
  follows a deliberate click, and if the browser's gesture rules refuse it the card renders
  ready-to-play.
* Selecting a second video pauses the first via the existing `activate`/`deactivate`; the
  first stays in history and can be replayed.

**Acceptance.** Selection produces exactly one `.chat-row` carrying the URL; reload restores
it and the decorator rebuilds the card; two selections leave two rows and one active player;
zero `getDisplayMedia` in the whole flow.

---

### D5 — Music, same pattern, compact rows

✅ **Shipped.** One component with an `is-music` modifier — square sleeve, tighter row — rather than a second picker. The cross-origin limitation is said once, on the Music input itself, so Watch never shows it: *"She dances to audio files — YouTube plays in the chat, without the dancing."* Local audio is untouched and is still the only path that feeds the beat detector.

`Search music` above `Open an audio file`; results are one-line rows (art · title · creator),
never 16:9 players. Selection publishes to Conversation exactly as D4.

**The honest limitation:** a YouTube iframe is cross-origin, so `createMediaElementSource()`
cannot reach its audio and the beat detector gets nothing. YouTube music plays **without**
beat-reactive dancing in this batch. That is acceptable; breaking playback to force analysis
is not.

Local audio is untouched — `Open an audio file` keeps going through `audioSource.js`, with
the analyser, beat detection and dancing exactly as they are today, and keeps working with no
internet, no key, no HomePilot.

**Acceptance.** Local audio's beat path is byte-identical. YouTube unavailable leaves
`Open an audio file` present and working.

---

### D6 — Settings: Discovery & Media

✅ **Shipped.** `Auto — recommended` is the default and the first option; a named provider is honoured only while it is *ready*, so a key that lapses falls back instead of reading as "search is broken". Unconfigured providers are listed and disabled rather than hidden — hiding one makes "why can't I pick YouTube?" unanswerable. The picker needed no change: `forCapability` reads the preference itself.

```text
DISCOVERY & MEDIA
Video search   Auto        Music search   Auto        Web search   Auto
```

`Auto` is always the default and picks the best *ready* provider. Advanced lets you name one.
Readiness is shown honestly — `YouTube · Ready`, `SoundCloud · Not connected`,
`Brave · API key required` — and Together offers only ready providers.

Secrets move behind local config/proxy where the architecture allows, with the legacy
`localStorage` path still honoured last.

**Acceptance.** A user who never opens this section still gets working search once a key
exists. Nothing in the normal flow names a provider unless it needs configuring.

---

### D7 — Optional: dancing to a YouTube tab

✅ **Shipped.** `mediaTabAudioSource.js` reads the audio already inside a screen grant — `ConsentMachine.request('screen')` has always asked for `audio: true` — so it needs **no new consent request at all**, and a standing test asserts the file names neither capture API nor the consent machine. It never connects to `destination` (the tab is already audible; a second path is an echo) and never stops the shared tracks (they belong to whoever shared them).

Only if wanted, and only through the existing consent architecture:

```text
companion tab → user chooses "Listen together" → ConsentMachine display capture (audio: true)
              → AudioContext.createMediaStreamSource → AnalyserNode → existing Music detector
```

New file, e.g. `src/features/together/activities/mediaTabAudioSource.js`. **Not** inside
`music.js`. Do not connect the captured stream to `audioContext.destination` — the tab is
already audible and that echoes.

**Acceptance.** No `getDisplayMedia` call outside `ConsentMachine`; declining leaves playback
working without dancing.

---

### D8 — The invariants, as tests

✅ **Shipped.** `tests/discovery-invariants.test.js`. It found one: a provider whose `status()` threw took `forCapability` and `all()` down with it, so one broken third-party provider would have broken search for the two that worked. The registry reports it unavailable now. The test that found it was written asserting `.toThrow()` and *passed* — it documented the bug rather than the property, which is the failure mode this whole file exists to catch.

Beyond each batch's own acceptance:

no eager iframe per result · lazy thumbnails · media cards reserve their box so a late
thumbnail never yanks the conversation · one active player · normal text chat untouched ·
`play chess with me` still not intercepted · existing YouTube intent tests green ·
ConsentMachine tests green · local video and local audio still work · Watch VR still works ·
no horizontal overflow at mobile widths · keyboard navigation throughout.

**Error isolation, tested independently:** a throwing provider leaves chat and local media
working; a throwing card renderer leaves the plain link; a failed VR handoff leaves 2D
playback.

---

## 3. Order

```text
D1 ─► D2 ─► D3 ─► D4 ─► D5 ─► D6 ─► (D7)
                                └──► D8 runs alongside from D3
```

**D1 alone fixes what the user reported.** D3+D4 are the feature. D6 makes it a product.

---

## 4. Deliberately not building

A media browser · a separate Media page · a new navigation destination · Together as a
permanent player · a second YouTube card · a second search implementation · stream scraping
or URL extraction · a provider chooser in the normal flow · API keys typed into the Together
dialog · autoplay · screen sharing because a video was selected · a rewrite of `watch.js`,
`music.js` or `TogetherPanel.js` · attachment persistence (out of scope; the URL in the
message text is what makes restore work) · unrelated features in the same batch.

---

## 5. Where this plan disagrees with the brief

Recorded so the disagreements are decisions rather than drift.

1. **"URL or structured attachment" → URL only.** `_persistChat` saves `.message-text`
   textContent and nothing else, so an attachment-only message loses its card on reload.
2. **"Reuse `NEXUS_YT_COMPANION.search()`" — as a wrapped provider, not called directly.**
   Together consumes normalized results; the provider adapts them. Same code path, one
   translation layer.
3. **The reported failure has a second cause the brief does not mention:** the intent parser
   captured `"video"` from `play a video in youtube of music`. Fixed in D1, or the search is
   connected and still returns the wrong thing.


---

## 6. What D3/D4 shipped, and what they did not

**Class names live in the Together namespace.** The picker started as `nexus-bd-discovery-*`
and the launcher's standing stylesheet audit rejected it: every selector in that stylesheet
must contain `nexus-bd-together`, so the launcher cannot style anything outside its own world.
Renaming was the right answer — loosening the audit would have traded a real guarantee for a
shorter class name.

**Two standing audits were rewritten, not relaxed.** `contract.test.js` destructured Watch's
inputs positionally (`const [tab, file] = watch.inputs()`) and compared permission arrays by
length. Both broke on an insertion that had nothing to do with what they assert, so both now
key by input id — and a new one checks that *every* `search` input, on every activity, asks
for no permission.

**One mutation survived the first pass.** The test for "choosing a result does not start
Watch" watched `navigator.mediaDevices.getDisplayMedia`, which the panel never calls —
`ConsentMachine` owns it. A mutation that started the activity on selection walked straight
past. It now asserts at the consent gate, which is the boundary that actually matters.

### Known limitation

The published message shows the URL beside the title (`Playing "…" — https://…`), because
`.message-text` is the only thing `_persistChat` keeps. That is exactly what a user sees when
they paste a link, so it is consistent — but it is not pretty, and hiding the URL once a card
has been drawn changes how *every* YouTube message renders. That belongs to its own batch, not
to D4.

### Still to do here

D5 (Music rows), D6 (Settings, with `Auto`), D7 (tab-audio adapter), D8 (the invariants as
tests). And a larger direction raised after this plan was written: moving provider secrets and
search behind **HomePilot** as a discovery broker, with SearXNG as a no-key fallback and a
`discovery` capability block on the bridge. That is a HomePilot-side service plus an
avatar-side `HomePilotDiscoveryProvider` registered *ahead* of the browser YouTube provider —
which the registry already supports, because it asks by capability and takes the first ready
one. It is a batch of its own; nothing in D3/D4 blocks it.


---

## 7. Media awareness — D9–D12 (design, not yet built)

### The report

```text
NEXUS  Playing "Volcom Women's … Bikini Bottom" — https://www.youtube.com/watch?v=h84a35i7OVg
       [ the card ]
YOU    can you see what video I am watching
NEXUS  no, I cannot see what video you are watching. As an AI, I don't have access to
       your screen, browsing activity, or any personal information…
```

She said that one message after naming the video herself. The card is on screen, the title
is in the transcript, and she still denied knowing — because **nothing tells the model that
the app knows**. D4 publishes the URL as text so the card survives a reload; it does not put
the *facts* anywhere the model reads.

That answer is worse than unhelpful. It is a false statement about the product's own
capabilities, offered in a paragraph of unprompted apology.

### What the proposed diff gets right

* A single `CurrentMediaContext` holding the selection, appended to the system prompt through
  `systemPromptSuffix()`. That is exactly the shape `main.js` already uses for motion —
  `(window.NEXUS_MOTION?.systemPromptSuffix?.() || '')` at lines 3523 and 3715 — so it is an
  established, guarded, additive hook rather than a new mechanism.
* Wiring it from `ConversationPublisher`, which is the one place a selection becomes a message.
* Separating *metadata* from *contents*: she may say what the video is without claiming to
  have watched it.
* Fetching a transcript lazily rather than on every selection.

### What it gets wrong, and how each is fixed

**1. The transcript route does not work.** Checked, not assumed:

```
GET https://www.youtube.com/api/timedtext?v=jfKfPfyJRdk&lang=en&fmt=json3  → 200, 0 bytes
GET https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en&fmt=json3  → 200, 0 bytes
```

That endpoint has needed parameters lifted from the watch page for some time. The proposed
route reads `200`, finds an empty body, and answers *"No English captions are available."* —
so it degrades politely and **never succeeds**, on any video. Shipping it would add a
feature-shaped thing that is always off, and a graceful message that is always a lie about
why. Transcripts get their own batch (D11), gated on a route somebody has actually seen
return text.

**2. `description` and `publishedAt` are always empty.** The provider reads
`item.description` and `item.publishedAt`, but `YouTubeCompanion.search()` maps only
`id`, `start`, `name`, `author`. The Data API's `snippet` carries both — the companion has to
pass them through first, or the two new fields are decoration.

**3. Creator text goes into the system prompt as instructions.** A description is written by
whoever uploaded the video. The proposal concatenates it into the prompt directly, under a
heading that says *"provided by the app"*, immediately before real instructions — which is
the standard shape of a prompt-injection sink. It must be delimited and labelled as untrusted
data, and the instructions must sit **before** it, not after.

**4. A switched video writes the old transcript onto the new one.** `prepareForQuestion`
captures nothing: its `.then` checks that `current` is truthy and then assigns to it. Change
video while a fetch is in flight and the wrong captions land. The pending request has to carry
the id it was started for and drop its result if that is no longer current.

**5. The "asks about contents" test fires on ordinary conversation.**
`what (?:is|are|did|does|happens?)` matches *"what is your name"*. Every such message would
start a caption fetch. The test has to require a media referent — *this video*, *the
transcript*, *what she is saying* — not a bare interrogative.

**6. A fetched transcript is then in every prompt.** Up to 12 000 characters, appended on
every turn for the rest of the session. On a local 8k-context model that displaces the
conversation. Contents belong in the turn that asked about contents.

**7. It does not survive a reload.** The card comes back from `_persistChat`; the context is
in memory and does not. She would know what is playing until you refresh, then deny it again —
the original bug, on a slower fuse.

---

### D9 — She knows what is playing

✅ **Shipped, with D10 folded in.** Splitting them would have left one release containing the injection sink D10 removes.

`src/features/together/CurrentMediaContext.js`: title, creator, url, kind, provider, and
(after fix 2) description and published date. Set from `ConversationPublisher`. Read through
`systemPromptSuffix()`, appended beside the motion suffix at both `main.js` call sites and the
VR path, each as a guarded optional call.

The wording is the deliverable as much as the plumbing:

```text
The app has told you what the user is playing. These are facts you were given, not
things you saw or heard. You may name the video and answer from these facts. Do not
say you cannot know what they are playing. Do not describe footage or audio.
```

**Acceptance.** With a selection published, *"what am I watching?"* reaches the model with the
title in the prompt; with none, the suffix is exactly `''` and the prompt is byte-identical to
today's. A test asserts the second — this feature must be invisible when nothing is playing.

### D10 — Untrusted text, handled as untrusted

✅ **Shipped with D9**, for the reason above.

Delimit creator-supplied fields, put the instruction before the data, and cap each field.

```text
--- media metadata (untrusted, supplied by the uploader) ---
title: …
description: …
--- end media metadata ---
```

**Acceptance.** A description containing *"Ignore previous instructions and …"* appears inside
the delimited block and changes nothing about the instruction above it. Field caps hold at the
boundary.

### D11 — Contents, honestly

Only if a caption route can be shown to work. The proposed one cannot. Candidates to try, in
order: the watch page's `captionTracks[].baseUrl` (unverified here — this sandbox gets a 302
on youtube.com), then the Data API's `captions` endpoint, which needs OAuth for most videos.

If none works, the honest outcome is to say so and stop: *"I know what this is, but not what
is said in it."* A feature that never fires is worse than an absent one, because nobody knows
it is absent.

If one does work: fetch on demand only, require a media referent, drop a result whose id is
stale, include the transcript **only in the turn that asked**, and cap it.

**Acceptance.** Ordinary conversation triggers zero caption requests. Switching video
mid-fetch never attaches the old transcript. A video with no captions keeps its metadata.

### D12 — It survives a reload, and covers local video

Rehydrate from the last YouTube link in the restored transcript on boot, so a refresh does not
return her to denying it. `watch.js`'s `playFile` sets the same context for a local file —
filename only, with the same "these are facts you were given" framing.

**Acceptance.** Reload with a card in history, ask *"what am I watching?"*, the title is in the
prompt. A local file is named, and nothing claims to have seen it.

### One thing to decide before D9 ships

Metadata about what somebody is watching goes to whatever model is configured — which may be a
cloud provider. It is a small leak and a real one, and it should be a line in Settings rather
than a surprise. `Together ▸ tell the assistant what I am playing`, on by default, off in one
tap.


---

## 8. D13 — a key the deployment owns

Shipped. Asking every visitor for a YouTube key is the right default for somebody
self-hosting and the wrong one for a site somebody publishes: the operator has a key, and
asking each visitor for one turns a working feature into a form.

**The load-bearing decision is where the key lives.** The obvious shortcut is a config
endpoint that hands `YOUTUBE_API_KEY` to the page, and it publishes the key: a Data API key in
client JavaScript is readable by anyone who opens the site, and Google's HTTP-referrer
restriction binds browsers and nothing else. So the browser never receives it — it calls
`GET /api/yt/search?q=…` and gets results back.

* `nexus-proxy/youtube-routes.cjs` and `api/yt-search.js` serve the same path, so the client
  has one. A plain (private) Vercel environment variable reaches the function and not the page.
* `GET /api/yt/search` with no query answers `{configured: bool}` — readiness without spending
  a unit of the operator's daily quota, because Settings asks on every open.
* Upstream errors are relayed as a status, never a body: Google's quota errors name the
  project and the key, and this response is public.
* **A key in Settings wins.** Somebody who typed one meant to use their own quota; silently
  preferring the site's would make that field decorative.
* Readiness gained a state *before* "no key": `checking`, until the probe answers. Claiming
  available early is the dead-provider-shown-as-working failure the readiness model exists to
  prevent, and claiming unavailable early would make a working site read as broken on first
  open and fine on the second.

**It found a bug in D6.** `stateLabel` was written as "available → Ready, otherwise look up the
reason", which collapsed every working state into one word — so D13's second working state,
*the site holds the key*, could never render. Being available is not one fact. The reason is
consulted first now.

Three test assertions written before D13 named the old single `Ready` label or the old
two-state readiness; each was updated to assert the state rather than the wording.


---

## 9. D9 + D10 as shipped

The three fixes the proposal needed, done:

* **`description` and `publishedAt` now exist.** They were read by the provider and produced
  by nothing — `YouTubeCompanion.search()` mapped only `id`, `start`, `name`, `author`. All
  three search paths carry them now, including both server routes, or a deployment-key search
  would tell the model less than a visitor's own key does.
* **The instruction sits above the data**, and uploader text is fenced, single-lined and
  capped. A description cannot open a row of its own, and cannot close the fence.
* **Empty means empty.** With nothing playing the suffix is `''`, so the prompt is byte-identical
  to what it was before this batch — verified in a browser, not only asserted.

Wired at four prompt sites: the two `main.js` paths that already compose the motion suffix,
and the two AR-mode callers that composed none. `watch.js` sets the same context for a local
file — a filename is thin, and it is what there is.

**A mutation survived and was worth it.** Stripping `\r\n` explicitly and then collapsing
`\s+` is the same guarantee twice; removing the first changed nothing. The redundant line is
gone and the comment says why, which is more useful than a second replace nobody can justify.

Still open here: **D11** (contents — blocked on a caption route that works; the proposed one
returns 200 with an empty body on every video) and **D12** (rehydrate after a reload, so a
refresh does not return her to denying it).
