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
and the how-to for adding a key, once.

## Search

`/yt lofi` searches with YouTube Data API v3 when a key is configured:

```js
localStorage.setItem('nexus.yt.apiKey', 'YOUR_KEY'); // or window.NEXUS_YT_CONFIG = { apiKey }
```

Without a key the command explains itself and the rest of the feature is unaffected.

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
