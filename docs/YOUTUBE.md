# YouTube Everywhere (batches YT-1 … YT-5)

Paste a YouTube link — or let the avatar answer with one — and it becomes a video card in the
2D chat and in the VR chat panel. Playback is always YouTube's own player. Everything is
additive: five script tags in `index.html`, two lines in `nexus-proxy/server.js`, and the
folder `src/features/youtube/`. Delete those and the app is what it was.

## What you get

| Where | What a link becomes | Press play → |
| --- | --- | --- |
| 2D chat (desktop, mobile) | Thumbnail + title card (facade) | Privacy-enhanced `youtube-nocookie` embed, inline, autoplay |
| VR chat panel | Tappable thumbnail card (the existing image-card renderer) | Companion tab navigates → cinema screen follows; or the pick waits for you in 2D |
| `/yt <query>` (2D) | Up to 5 result cards, no LLM round trip | Same as above |
| "play some lofi" (2D) | The same result cards — just ask her | Same as above |

Links in the user's own message, in the LLM reply, in `x_attachments` (`type: "youtube"`), and
in restored chat history all get cards. Start offsets (`?t=1h2m3s`) are honoured.

## Which page it attaches to

The shipped `index.html` has no `ChatManager` singleton — `js/chat-manager.js` is referenced
only by `index-old.html` and `index.backup.html`. So there are two attachments and both are
optional: a wrapper on `ChatManager.createMessageElement` for the old page, and a
`MutationObserver` on `#chat-history` for the current one, which is the idiom `AvatarAliveness`
and `CompanionMode` already use for that element. Input ids are tried in the same pairs
(`#chatInput`/`#sendBtn`, then `#speech-text`/`#speak-btn`).

## The constraint the VR design rests on

A cross-origin iframe cannot be textured into WebGL, and an immersive session shows only the
framebuffer — so YouTube cannot be *rendered* in VR by any compliant means. B12's `watch.js`
already solves it: capture the **tab** that is playing. This feature adds the missing wire:

1. In 2D, tap **Watch in VR** on any card. A *named* companion tab opens on the video and
   Together's Watch activity asks you to share a tab (pick the companion). One prompt.
2. Enter VR. The cinema screen shows the tab.
3. Tap any other YouTube card in the VR chat. The companion tab is **navigated** (an opener may
   navigate a window it opened, even cross-origin) — the screen follows, no prompt, no picker.

If there is no companion tab when you tap in VR, the pick is remembered and posted to the 2D
chat when the session ends.

Ripping stream URLs (the VRChat approach) is deliberately not implemented; a test asserts no
module references stream endpoints.

## Just ask her

`YouTubeAsk` recognises a request to play something and answers with result cards, without a
round trip to the model:

```
you    play some lofi hip hop music
nexus  Here's what I found for "lofi hip hop music". Press play on one, or Watch in VR.
       [card] [card] [card]
```

It also takes *"search youtube for X"*, *"youtube: X"*, *"play X on youtube"* and `/yt X`.

**Matching is deliberately narrow.** A bare *play* is never enough — a request qualifies only
when it names YouTube, or pairs a play verb with something plainly media (song, track, music,
video, mix, playlist…). *"play chess with me"*, *"let's play a game"* and *"I want to play
outside"* are ordinary conversation and reach the model untouched; a test pins each one,
because the expensive failure here is silent — a message meant for the assistant that never
arrives.

A message that already contains a YouTube link is not treated as a search request: its card is
about to appear on its own.

Without an API key it still helps — you get a link to the YouTube search for what you asked,
and a **Set up YouTube** button.

## Search — connecting it

Search uses YouTube Data API v3, which needs a key.

**Get one:** [Google Cloud Console](https://console.cloud.google.com) → new project → APIs &
Services → enable **YouTube Data API v3** → Credentials → **Create credentials → API key**.
Restrict it to that API and to your site's referrer before you use it anywhere public.

### Before any of that — it works with no key at all

Search needs a key. **Playback does not.** So Watch and Music each carry three fixed examples,
offered only where there is no search to do:

| Watch | Music |
|---|---|
| Me at the zoo — the first video ever uploaded | lofi hip hop radio — Lofi Girl |
| Rick Astley — Never Gonna Give You Up | Queen — Bohemian Rhapsody |
| PSY — GANGNAM STYLE | Alan Walker — Faded |

A product that cannot be tried until it is configured mostly does not get tried. These play
through exactly the code path a real result takes, so one tap on a fresh deployment shows what
the feature does — and **Set up YouTube** is still on screen, so they are a floor and not a
ceiling.

**A sample is never a search result.** They appear under their own heading — *"Or try one of
these — no setup needed"* — carry `sample: true` and `data-sample` in the DOM, and vanish the
moment a key is set. Handing somebody a fixed video labelled as a match for what they typed is a
lie they cannot detect, and worse than an empty state. `tests/discovery-samples.test.js` holds
that rule directly.

They are chosen for **durability, not taste**: every one is on a channel whose whole purpose is
being embedded on other people's pages. Each id was checked against YouTube's oEmbed endpoint
and exists; embeddability was not verified, because the sandbox this was written in blocks the
browser from reaching youtube.com. Nothing depends on all six surviving — a dead one is a single
card that says so, and the fix is one line in `src/features/discovery/samples.js`.

### For a deployment — one key, nobody types anything (D13)

Set a **private** environment variable on the host and every visitor can search without a key
of their own:

```sh
YOUTUBE_API_KEY=AIza…
```

* **Vercel** — Project → Settings → Environment Variables. A plain variable, *not* a
  `NEXT_PUBLIC_` one: this is a static site with serverless functions, so a plain variable is
  readable only by `api/yt-search.js` and never reaches the browser. Redeploy to apply it.
* **Local / self-hosted** — the same name in the environment `nexus-proxy` starts with;
  `nexus-proxy/youtube-routes.cjs` serves the identical path.

**The key never reaches the browser, and that is the point.** The obvious shortcut — a config
endpoint that hands the key to the page — publishes it: a Data API key in client JavaScript is
readable by anyone who opens the site, and Google's HTTP-referrer restriction binds browsers
and nothing else. So the browser calls `GET /api/yt/search?q=…` and gets results back; the key
stays on the server.

Two paths, one client:

| | route | key |
|---|---|---|
| Readiness | `GET /api/yt/search` | none spent — answers `{configured: bool}` |
| Search | `GET /api/yt/search?q=lofi&max=4` | the deployment's |

Still restrict the key in Google Cloud to the YouTube Data API. A server-side key cannot be
read from the page, but it can still be lost some other day.

### For one person — your own key

**Set it:** Settings → **Discovery & Media** → *Video search — your own YouTube key* → SAVE.
Optional wherever the deployment has its own; it wins when set, because somebody who typed a
key meant to use their quota, not the site's.

Three sources are read, in this order (`YouTubeSettings.apiKey()`):

| | source | who writes it |
|---|---|---|
| 1 | `localStorage['nexus_discovery_settings']` → `youtube.apiKey` | Settings |
| 2 | `window.NEXUS_YT_CONFIG.apiKey` | a host page shipping its own key |
| 3 | `localStorage['nexus.yt.apiKey']` | the legacy key — still read, never written |
| 4 | `GET /api/yt/search` on the deployment's `YOUTUBE_API_KEY` | the operator (D13) |

The first three are keys the browser holds and sends itself. The fourth is not a key at all
from the browser's side — it is a route that answers with results.

For a developer or a test, the second and third are still the fast way in:

```js
window.NEXUS_YT_CONFIG = { apiKey: 'YOUR_KEY' };
// or, legacy and still honoured:
localStorage.setItem('nexus.yt.apiKey', 'YOUR_KEY');
```

Those lines live here, in the developer documentation, and are no longer printed at users
who asked for a song. Without a key `/yt` and the natural-language path both still get you to
the YouTube search page, and the rest of the feature is unaffected.

## Optional server help

`nexus-proxy` gains `GET /api/yt/oembed?url=` (titles without a key) and
`GET /api/yt/thumb/:id` (thumbnails re-served with CORS, for headset browsers that refuse
`i.ytimg.com`). The browser tries YouTube directly first. To force the proxy for VR thumbnails:

```js
window.NEXUS_YT_CONFIG = { thumbProxy: '/api/yt/thumb/' };
```

## Files

```
src/features/youtube/YouTubeLink.js       parser + URL builders (pure, tested)
src/features/youtube/YouTubeCompanion.js  companion tab, startParty(), Data API search
src/features/youtube/YouTubeEmbed2D.js    facade cards, ChatManager hook, /yt command
src/features/youtube/YouTubeVRBridge.js   VR panel/media-panel wrappers, tap routing
src/features/youtube/YouTubeAsk.js        intent matching, "play some lofi" → cards
src/features/youtube/youtube.css          card styles (app tokens only)
nexus-proxy/youtube-routes.cjs            optional oEmbed + thumbnail routes
tests/youtube-everywhere.test.js          24 tests
```

Globals: `NEXUS_YT`, `NEXUS_YT_COMPANION`, `NEXUS_YT_2D`, `NEXUS_YT_VR`, `NEXUS_YT_ASK`, `NEXUS_YT_CONFIG` (optional input).

## Removing it

Delete the five `<script>` tags marked `NEXUS_YT` in `index.html`, the two marked lines in
`nexus-proxy/server.js`, `nexus-proxy/youtube-routes.cjs`, and the folder. No other file references the feature.
