# Image Media Plugin

The image media plugin adds two image sources to the chatbot without changing the existing chat pipeline:

- **Pexels** — searches real stock photography.
- **Pollinations.ai** — generates an AI image from the request.

It extends the existing **Settings → Discovery & Media** provider registry with an **Image source** selector. `Auto` uses the first ready image provider; choosing Pexels or Pollinations pins that source while it is available.

## Setup

### Pexels — real photos

Preferred deployment setup:

```bash
PEXELS_API_KEY=your_pexels_key
```

A user may also paste their own Pexels key in Settings. That personal key takes priority over the deployment key, is stored in the browser, and is sent only to the application's same-origin `/api/proxy`, which is explicitly allowlisted for `https://api.pexels.com`. It is never committed to the repository.

Pexels requires attribution. Result cards therefore show **Photo by … on Pexels** and link back to the Pexels photo page.

### Pollinations.ai — AI generation

```bash
POLLINATIONS_API_KEY=sk_your_server_side_key
```

Pollinations' current generation API requires authentication. Secret `sk_` keys are server-side credentials, so the plugin deliberately does **not** provide a browser field for them. The same-origin `/api/images/search` function adds the bearer token upstream and returns only the generated image bytes.

This differs from older Pollinations examples using `image.pollinations.ai` without a key. Those examples are no longer a safe contract for a production integration.

## Chat usage

The interception is deliberately narrow so ordinary conversation still reaches the LLM.

```text
show me a picture of New York
find me some images of a modern office
find me a real photo of the Colosseum
generate an image of a robot drinking coffee
/image northern lights
/photo Tokyo skyline
/aiimage watercolor moon base
```

Generic requests use the **Image source** setting. Explicit generation requests use Pollinations; requests for a **real** or **stock** photo use Pexels.

## Architecture

```text
src/features/images/ImagePlugin.js
    provider adapters + settings extension + chat intent + result cards

api/images/search.js
    same-origin provider gateway
    GET  -> readiness / Pexels search
    POST -> Pollinations image generation

api/_allowlist.js
    adds api.pexels.com for an optional user-owned Pexels key through /api/proxy

tests/image-plugin.test.js
    intent, normalization, registry and settings invariants
```

The plugin is loaded by the already-existing `DiscoverySettings.js`. The loader is guarded and optional: if `src/features/images/ImagePlugin.js` is deleted or fails to load, video and music discovery keep working exactly as before.

## Provider contract

Both providers expose the same discovery-provider surface used elsewhere in the repository:

```js
{
  ID,
  ready(),
  status(),
  search(query, options)
}
```

Results use a small image-specific shape:

```js
{
  id,
  provider,
  kind: 'image',
  type: 'real' | 'ai',
  title,
  creator,
  alt,
  width,
  height,
  url,
  thumbnail,
  sourceUrl
}
```

This keeps Pexels JSON and Pollinations transport details out of the chat renderer and makes another image provider additive rather than a rewrite.

## Maintenance and safety decisions

- Native `fetch`; no new runtime dependencies.
- Provider secrets are not hardcoded or committed.
- Pollinations secret keys never enter localStorage or a public URL.
- Pexels user keys go only through the same-origin proxy and only to an exact allowlisted origin.
- Provider failures resolve to an empty result or a readable chat message rather than crashing the chatbot.
- Generated blob URLs are revoked on page unload.
- Remote text is rendered with `textContent`, not `innerHTML`.
- Image result cards use lazy loading and explicit attribution.
- Pexels result counts are capped, and the server endpoint is cache-friendly for repeated searches.

## Removing the plugin

Delete `src/features/images/`, `api/images/search.js`, and `tests/image-plugin.test.js`, remove the Pexels allowlist entry, and remove the small optional loader block at the bottom of `DiscoverySettings.js`. No central chat or settings save function needs to be restored.
