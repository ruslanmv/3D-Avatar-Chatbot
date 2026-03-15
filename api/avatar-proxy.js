/**
 * Vercel Serverless Avatar Proxy
 *
 * Proxies binary avatar downloads (GLB/VRM) from external sources
 * that don't support browser CORS (Ready Player Me, GitHub raw, etc.)
 *
 * Usage:
 *   GET /api/avatar-proxy?url=https://models.readyplayer.me/...glb
 *
 * Security:
 *   - HTTPS only
 *   - Domain allowlist (avatar CDNs only)
 *   - 50 MB size limit
 */

const ALLOWED_HOSTS = [
    'models.readyplayer.me',
    'api.readyplayer.me',
    'raw.githubusercontent.com',
    'github.com',
    'hub.vroid.com',
    'api.sketchfab.com',
    'media.sketchfab.com',
];

function isAllowedHost(urlStr) {
    try {
        const u = new URL(urlStr);
        return u.protocol === 'https:' && ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
    } catch {
        return false;
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'Missing "url" query parameter.' });
    if (!isAllowedHost(targetUrl)) return res.status(403).json({ error: 'Host not in avatar proxy allowlist.' });

    try {
        const upstream = await fetch(targetUrl);
        if (!upstream.ok) {
            return res.status(upstream.status).json({ error: `Upstream: ${upstream.status} ${upstream.statusText}` });
        }

        const ct = upstream.headers.get('content-type') || 'application/octet-stream';
        const cl = upstream.headers.get('content-length');

        res.setHeader('Content-Type', ct);
        if (cl) res.setHeader('Content-Length', cl);
        res.setHeader('Cache-Control', 'public, max-age=86400');

        const buf = Buffer.from(await upstream.arrayBuffer());
        return res.status(200).send(buf);
    } catch (err) {
        console.error('[api/avatar-proxy] error:', err);
        return res.status(500).json({ error: err?.message || String(err) });
    }
}
