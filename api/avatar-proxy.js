/**
 * Vercel Edge Avatar Proxy (streaming)
 *
 * Proxies binary avatar downloads (GLB/VRM) from external sources
 * that don't support browser CORS or are blocked by Cloudflare bot
 * protection (R2 r2.dev domains).
 *
 * Uses Edge runtime with streaming — no response body size limit,
 * handles 50 MB+ VRM files without buffering into memory.
 *
 * Usage:
 *   GET /api/avatar-proxy?url=https://pub-...r2.dev/vroid_hub/model.vrm
 *
 * Security:
 *   - HTTPS only
 *   - Domain allowlist (avatar CDNs only)
 */

export const config = { runtime: 'edge' };

const ALLOWED_HOSTS = [
    'api.avaturn.me',
    'cdn.avaturn.me',
    'raw.githubusercontent.com',
    'github.com',
    'hub.vroid.com',
    'api.sketchfab.com',
    'media.sketchfab.com',
    'arweave.net',
    'gateway.irys.xyz',
    'cdn.discordapp.com',
    'pub-c8f0641365ad47e5b3e1c85c39874909.r2.dev',
    'r2.dev',
    'avatars.yourfriend.online',
    's3.amazonaws.com',
    'amazonaws.com',
];

function isAllowedHost(urlStr) {
    try {
        const u = new URL(urlStr);
        return u.protocol === 'https:' && ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
    } catch {
        return false;
    }
}

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (req.method !== 'GET') {
        return Response.json({ error: 'Method Not Allowed' }, { status: 405, headers: CORS_HEADERS });
    }

    const { searchParams } = new URL(req.url);
    const targetUrl = searchParams.get('url');

    if (!targetUrl) {
        return Response.json({ error: 'Missing "url" query parameter.' }, { status: 400, headers: CORS_HEADERS });
    }
    if (!isAllowedHost(targetUrl)) {
        return Response.json({ error: 'Host not in avatar proxy allowlist.' }, { status: 403, headers: CORS_HEADERS });
    }

    try {
        const upstream = await fetch(targetUrl);
        if (!upstream.ok) {
            return Response.json(
                { error: `Upstream: ${upstream.status} ${upstream.statusText}` },
                { status: upstream.status, headers: CORS_HEADERS }
            );
        }

        const ct = upstream.headers.get('content-type') || 'application/octet-stream';
        const cl = upstream.headers.get('content-length');

        const responseHeaders = {
            ...CORS_HEADERS,
            'Content-Type': ct,
            'Cache-Control': 'public, max-age=86400',
        };
        if (cl) responseHeaders['Content-Length'] = cl;

        // Stream the response body directly — no buffering, no size limit
        return new Response(upstream.body, {
            status: 200,
            headers: responseHeaders,
        });
    } catch (err) {
        console.error('[api/avatar-proxy] error:', err);
        return Response.json({ error: err?.message || String(err) }, { status: 500, headers: CORS_HEADERS });
    }
}
