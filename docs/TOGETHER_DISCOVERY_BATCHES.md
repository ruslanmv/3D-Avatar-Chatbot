# Together Media Discovery & Conversation Playback — Batch Plan

**Status:** **D1–D5 are shipped**; D6–D8 are still planning.
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
