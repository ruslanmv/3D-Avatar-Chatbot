# CORS (Cross-Origin Resource Sharing)

## What is CORS?

CORS is a browser security mechanism that controls which websites can request resources from a different domain. By default, browsers block cross-origin requests to protect users from malicious sites stealing data.

## How it works

1. The browser sends a request with an `Origin` header (e.g. `Origin: https://www.yourfriend.online`).
2. The server responds with `Access-Control-Allow-Origin` indicating which origins are permitted.
3. If the origin matches, the browser allows the response through. If not, it blocks it.

For non-simple requests (custom headers, PUT/DELETE), the browser first sends an **OPTIONS preflight** request to check permissions before the actual request.

## Why we need it in this project

VRM avatar files are hosted on Cloudflare R2 (`avatars.yourfriend.online`), but the app runs on `www.yourfriend.online`. Without CORS headers, the browser would block all avatar downloads.

Our R2 bucket is configured to return CORS headers for allowed origins:

```
Access-Control-Allow-Origin: https://www.yourfriend.online
Access-Control-Allow-Methods: GET, HEAD
```

## When CORS isn't enough

Cloudflare's `r2.dev` development URLs add bot protection that blocks browser fetches entirely (no CORS headers on the challenge page). For these, we route through a server-side Edge proxy (`/api/avatar-proxy`) which bypasses bot protection since server-to-server requests aren't subject to CORS.

Custom domains like `avatars.yourfriend.online` don't have bot protection, so direct CORS fetch works reliably.
