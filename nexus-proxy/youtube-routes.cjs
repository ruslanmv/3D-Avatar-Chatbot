/**
 * YouTube helper routes for nexus-proxy (batch YT-5). Optional: the browser modules try
 * YouTube directly first and only fall back to these.
 *
 *   GET /api/yt/oembed?url=<youtube url>   title/author, no API key needed
 *   GET /api/yt/thumb/:id                  thumbnail re-served with CORS headers, so a
 *                                          canvas texture in the headset is never tainted
 *
 * No stream URLs are ever proxied here. Playback stays in YouTube's player.
 */
'use strict';

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'];

function isYouTubeUrl(raw) {
    try {
        const u = new URL(raw);
        return u.protocol === 'https:' && YT_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
    } catch {
        return false;
    }
}

function mountYouTubeRoutes(app) {
    app.get('/api/yt/oembed', async (req, res) => {
        const url = req.query.url;
        if (!url || !isYouTubeUrl(url)) {
            return res.status(400).json({ error: 'A https YouTube url is required.' });
        }
        try {
            const upstream = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
            if (!upstream.ok) {
                return res.status(upstream.status).json({ error: `Upstream: ${upstream.status}` });
            }
            const j = await upstream.json();
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.json({ title: j.title, author_name: j.author_name, thumbnail_url: j.thumbnail_url });
        } catch (err) {
            res.status(502).json({ error: err.message || 'oembed failed' });
        }
    });

    app.get('/api/yt/thumb/:id', async (req, res) => {
        const { id } = req.params;
        if (!ID_RE.test(id)) {
            return res.status(400).json({ error: 'Bad video id.' });
        }
        const quality = ['default', 'mq', 'hq', 'sd', 'maxres'].includes(req.query.q) ? req.query.q : 'hq';
        const q = quality === 'default' ? '' : quality;
        try {
            const upstream = await fetch(`https://i.ytimg.com/vi/${id}/${q}default.jpg`);
            if (!upstream.ok) {
                return res.status(upstream.status).end();
            }
            res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (err) {
            res.status(502).json({ error: err.message || 'thumbnail failed' });
        }
    });
}

// This file is `.cjs` deliberately. `nexus-proxy/package.json` declares `"type": "module"`,
// so a `.js` here is an ES module and `module.exports` would be a ReferenceError the moment
// the server started — which is exactly how it shipped. `.cjs` is CommonJS regardless of the
// package type, Node's ESM can import named bindings from it, and jest (which has no ESM
// transform configured in this repo) can require it. One extension, three consumers happy.
module.exports = { mountYouTubeRoutes, isYouTubeUrl, ID_RE };
