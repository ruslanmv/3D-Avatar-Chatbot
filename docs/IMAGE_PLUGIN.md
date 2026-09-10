# Image Media Plugin

The image media plugin adds image search and generation to the chatbot without changing the existing chat pipeline:

- **Pexels** — searches real stock photography.
- **Pollinations.ai** — hosted AI image generation through the Vercel/serverless gateway.
- **HomePilot Remote** — private AI image generation through the user's existing OllaBridge/HomePilot connection when that remote capability is enabled.

It extends **Settings → Discovery & Media** with two independent choices:

1. **Image source** — controls generic requests such as “show me a picture of Rome”.
2. **AI image generator** — controls explicit generation requests such as “generate an image of a moon base”.

Both selectors default to **Auto — recommended**. The AI generator list contains Pollinations and HomePilot Remote. HomePilot Remote is disabled in the selector until the paired bridge reports that remote image generation is available.

## Vercel environment variables

For a normal Vercel deployment, these are the only image-plugin secrets:

```bash
PEXELS_API_KEY=your_pexels_key
POLLINATIONS_API_KEY=sk_your_pollinations_server_side_key
```

Both are optional independently:

- `PEXELS_API_KEY` is needed only for deployment-owned Pexels search. A visitor can instead enter their own Pexels key in Settings.
- `POLLINATIONS_API_KEY` is needed only when Pollinations should be available as an AI image generator.
- If the deployment uses HomePilot Remote for AI generation, **no HomePilot or OllaBridge credential is added to Vercel**. The browser reuses the user's already-paired OllaBridge connection, and OllaBridge keeps the HomePilot credential server-side.

Add the secrets in **Vercel → Project → Settings → Environment Variables**, normally for Production and Preview, then redeploy so the serverless functions receive the new values.

## Pexels — real photos

Preferred deployment setup:

```bash
PEXELS_API_KEY=your_pexels_key
```

A user may also paste their own Pexels key in Settings. That personal key takes priority over the deployment key, is stored in the browser, and is sent only to the application's same-origin `/api/proxy`, which is explicitly allowlisted for `https://api.pexels.com`. It is never committed to the repository.

Pexels requires attribution. Result cards therefore show **Photo by … on Pexels** and link back to the Pexels photo page.

## Pollinations.ai — hosted AI generation

```bash
POLLINATIONS_API_KEY=sk_your_server_side_key
```

Pollinations' current generation API requires authentication. Secret `sk_` keys are server-side credentials, so the plugin deliberately does **not** provide a browser field for them. The same-origin `/api/images/search` function adds the bearer token upstream and returns only the generated image bytes.

## HomePilot Remote — private AI generation

HomePilot Remote deliberately does not introduce `HOMEPILOT_*` Vercel variables. It reuses the OllaBridge link already stored under `nexus_llm_settings.ollabridge`, the same ownership model used by Remote Screen.

The provider is capability-gated. A compatible OllaBridge exposes:

```text
GET  /v1/media/homepilot/capability
POST /v1/media/homepilot/generate
```

The capability route should report whether HomePilot image generation is currently enabled and ready. The generation route forwards the request to HomePilot's Imagine/ComfyUI pipeline and returns either image bytes or normalized image references. Returned HomePilot media should be rewritten through the existing authenticated `/v1/media/proxy/...` path.

The browser never puts the bridge token in an image URL. It fetches remote media with `Authorization: Bearer …` and converts the bytes to a temporary object URL, matching the Remote Screen pattern.

If the bridge is not paired, HomePilot is offline, generation is disabled, or the OllaBridge version does not expose the remote image routes, **HomePilot Remote stays unavailable** in Settings. Pexels and Pollinations continue to work independently.

### Expected generation request

The browser sends a compact normalized request to OllaBridge:

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

OllaBridge owns the mapping from that request to HomePilot `/chat` Imagine mode and owns all HomePilot credentials.

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

Generic show/find requests use **Image source**. Explicit generate/create/render/draw requests use **AI image generator**. Requests for a **real** or **stock** photo force Pexels.

Examples:

- `Image source = Pexels`, `AI image generator = HomePilot Remote` → “show me a photo…” searches Pexels, while “generate an image…” runs remotely through HomePilot.
- `AI image generator = Pollinations` → explicit generation uses the Vercel-side Pollinations key.
- `AI image generator = Auto` → the first ready generator is used; Pollinations remains the default when both are ready, preserving existing behavior.

## Architecture

```text
src/features/images/ImagePlugin.js
    Pexels + Pollinations + HomePilot Remote adapters
    independent source/generator settings groups
    chat intent + result cards

api/images/search.js
    same-origin hosted-provider gateway
    GET  -> readiness / Pexels search
    POST -> Pollinations image generation

existing OllaBridge link
    browser -> paired OllaBridge -> HomePilot Imagine/ComfyUI
    HomePilot credentials remain server-side

api/_allowlist.js
    api.pexels.com for an optional user-owned Pexels key through /api/proxy

tests/image-plugin.test.js
    intent, normalization, registry, independent settings and remote-auth invariants
```

The plugin is loaded by the already-existing `DiscoverySettings.js`. The loader is guarded and optional: if `src/features/images/ImagePlugin.js` is deleted or fails to load, video and music discovery keep working exactly as before.

## Provider contract

All image providers expose the same discovery-provider surface used elsewhere in the repository:

```js
{
  ID,
  ready(),
  status(),
  search(query, options)
}
```

Capabilities separate search from generation:

```text
pexels            -> image.search
pollinations      -> image.search, image.generate
homepilot-remote  -> image.generate
```

Results use one image-specific shape:

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

## Maintenance and safety decisions

- Native `fetch`; no new runtime dependencies.
- Provider secrets are not hardcoded or committed.
- Pollinations secret keys never enter localStorage or a public URL.
- HomePilot/OllaBridge credentials are not copied into Vercel variables.
- HomePilot media is fetched with an Authorization header and converted to object URLs instead of putting credentials in query strings.
- Pexels user keys go only through the same-origin proxy and only to an exact allowlisted origin.
- Provider failures resolve to an empty result or a readable chat message rather than crashing the chatbot.
- Generated blob URLs are revoked on page unload.
- Remote text is rendered with `textContent`, not `innerHTML`.
- Image result cards use lazy loading and explicit attribution.
- Pexels result counts are capped, and the server endpoint is cache-friendly for repeated searches.

## Removing the plugin

Delete `src/features/images/`, `api/images/search.js`, and `tests/image-plugin.test.js`, remove the Pexels allowlist entry, and remove the small optional loader block at the bottom of `DiscoverySettings.js`. No central chat or settings save function needs to be restored.