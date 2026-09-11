# Image Media Plugin

The image media plugin adds existing-image search and AI image generation to the chatbot while keeping provider details behind a consumer-facing **Discovery & Media** settings surface.

Providers currently used by the image capabilities are:

- **Pexels** — existing photography / image search.
- **Pollinations.ai** — hosted AI image generation.
- **HomePilot Remote** — private AI image generation through the user's existing OllaBridge/HomePilot connection when that capability is available.

## Settings model

Discovery & Media follows one grammar across web, image, video, music, and image generation:

```text
capability → preference → resolved provider → credentials only when necessary
```

The normal controls are:

```text
SEARCH & DISCOVERY
🌐 Web search
🖼 Image search
🎬 Video search
🎵 Music search

CREATION
✨ Image generation
```

Each capability starts with **Auto — recommended** and shows the resolved provider underneath, for example:

```text
🖼 IMAGE SEARCH
[ Auto — recommended                         ▾ ]
Ready · Pexels · provided by this site
```

or:

```text
✨ IMAGE GENERATION
[ Auto — recommended                         ▾ ]
Ready · Pollinations · provided by this site
```

Provider/API-key fields are progressively disclosed. A visitor sees a key field only after explicitly choosing an own-key option such as:

```text
Pexels — my own key
Pollinations — my own key
YouTube — my own key
Brave Search — my own key
Serper — my own key
```

Every capability also has **Disabled**. Search and generation are intentionally separate so someone can allow existing-image search while disabling generative imagery.

The old always-visible Pexels/Pollinations developer-style blocks are not part of the consumer UI.

## Image request routing

The two image capabilities are independent:

- **Image search** handles requests such as “find a picture of a cat” and uses Pexels.
- **Image generation** handles requests such as “generate a picture of a cat” and uses Pollinations or HomePilot Remote.

Pollinations advertises only `image.generate`; it is never selected to satisfy an existing-image search.

Examples:

- `Image search = Auto`, deployment Pexels key present → Pexels through the site gateway.
- `Image search = Pexels — my own key` → the personal Pexels key is used through the same-origin proxy.
- `Image generation = Auto`, deployment Pollinations key present → Pollinations through the site gateway.
- `Image generation = Pollinations — my own key` → the personal Pollinations key is sent only in the same-origin generation request header.
- `Image generation = HomePilot Remote` → generation goes through the paired OllaBridge/HomePilot path.
- either capability = `Disabled` → that capability does not silently fall back to another provider.

Explicit `real` / `stock` photo requests continue to force Pexels, subject to the Image search enabled/configured state.

## Deployment configuration

For a normal Vercel deployment, image provider credentials can be supplied server-side:

```bash
PEXELS_API_KEY=your_pexels_key
POLLINATIONS_API_KEY=sk_your_pollinations_server_side_key
```

Both are optional independently:

- `PEXELS_API_KEY` enables site-provided Pexels search.
- `POLLINATIONS_API_KEY` enables site-provided Pollinations generation.
- A visitor can instead choose the matching **my own key** mode in Settings.
- HomePilot Remote needs no HomePilot/OllaBridge secret in Vercel. The browser reuses the existing paired OllaBridge connection and OllaBridge owns the HomePilot credential.

Readiness responses use `Cache-Control: private, no-store` so adding/changing a deployment key does not leave a stale “not configured” answer cached in the browser/CDN.

## Pexels personal key

A personal Pexels key is stored only in that browser under the image plugin's local setting. It is sent to the application's same-origin `/api/proxy`, whose allowlist permits exactly the Pexels API origin used by this feature.

The key is placed in the upstream `Authorization` header; it is not put into the image URL and is never committed to the repository.

Pexels attribution is preserved on every rendered result card: **Photo by … on Pexels**, linked to the source photo.

## Pollinations personal key

The serverless image gateway already supports a per-request Pollinations credential through:

```text
X-Nexus-Pollinations-Key: <personal key>
```

The capability settings adapter exposes that path to the user. The key is:

- stored only in the user's browser,
- sent only to the same-origin `/api/images/search` endpoint,
- forwarded by the serverless route to Pollinations in an upstream bearer header,
- never placed in the request URL or generation JSON body,
- never returned by the server.

When no personal key is selected, Auto may use the deployment's `POLLINATIONS_API_KEY` instead.

## HomePilot Remote

HomePilot Remote reuses the OllaBridge link already stored under `nexus_llm_settings.ollabridge`, the same ownership model used by Remote Screen.

A compatible OllaBridge exposes:

```text
GET  /v1/media/homepilot/capability
POST /v1/media/homepilot/generate
```

The capability route reports whether HomePilot generation is currently available. The generation route maps the normalized browser request to HomePilot's Imagine pipeline, fetches generated media server-side, and returns image bytes or a normalized reference.

Expected request shape:

```json
{
  "prompt": "a moon base at sunrise",
  "mode": "imagine",
  "width": 1024,
  "height": 1024,
  "aspectRatio": "1:1",
  "seed": 12345,
  "count": 1
}
```

The browser never receives the HomePilot API key. Remote image bytes are converted into temporary object URLs for rendering and revoked when the page unloads.

## Chat usage

Intent interception is deliberately narrow so ordinary conversation still reaches the LLM.

```text
show me a picture of New York
find a picture of a cat
find me a real photo of the Colosseum
generate a picture of a cat
generate an image of a robot drinking coffee
/image northern lights
/photo Tokyo skyline
/aiimage watercolor moon base
```

The important boundary is:

```text
show / find / search image   → image.search
create / generate / draw     → image.generate
```

That prevents an AI generator from being used when the user asked to find an existing image.

## Provider contract

Image providers use the repository's existing discovery-provider surface:

```js
{
  ID,
  ready(),
  status(),
  search(query, options),
  credentialStatus?()
}
```

Current image capabilities are:

```text
pexels            -> image.search
pollinations      -> image.generate
homepilot-remote  -> image.generate
```

`credentialStatus()` is optional. Providers that expose it can tell the generic Settings renderer whether an explicit provider choice supports/has a personal key without teaching the central registry where that credential is stored.

## Files

```text
src/features/images/ImagePlugin.js
    provider transport, image intents and result cards

src/features/images/ImageProviderSettings.js
    personal Pollinations credential path
    image-provider credential metadata
    strict own-key / disabled image preference behavior

src/features/discovery/DiscoverySettings.js
    capability-first consumer settings UI

src/features/discovery/ProviderRegistry.js
    Auto / named provider / Disabled preference semantics

api/images/search.js
    site-key readiness, Pexels search, Pollinations generation

api/_allowlist.js
    exact Pexels origin for optional personal-key proxying

tests/image-provider-settings.test.js
    personal-key, capability-boundary, Disabled and Settings regressions
```

## Safety and maintenance decisions

- Native `fetch`; no new runtime dependency.
- No provider key is hardcoded or committed.
- Deployment keys remain server-side.
- Personal keys are progressively disclosed and stored only in the user's browser.
- Personal Pollinations credentials travel only in a same-origin request header.
- HomePilot credentials never enter Vercel or the browser.
- Existing-image search and AI generation are separate capabilities.
- Provider failures become empty results/readable chat messages instead of crashing the chatbot.
- Generated object URLs are revoked on unload.
- Remote/provider text is rendered as text, not parsed as HTML.
- Pexels result counts are capped and result searches remain cache-friendly; readiness itself is not cached.

## Removing the image feature

Remove `src/features/images/`, `api/images/search.js`, the image tests, the Pexels allowlist entry, and the small optional image loader at the bottom of `DiscoverySettings.js`. The central chat/LLM settings save path does not need to be restored.
