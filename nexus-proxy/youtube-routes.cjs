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
    /**
     * Search on the deployment's own key (batch D13).
     *
     *   GET /api/yt/search            → { configured: bool }   readiness, no quota spent
     *   GET /api/yt/search?q=lofi     → { results: [...] }
     *
     * The key lives in `YOUTUBE_API_KEY` and **never reaches the browser**. That is the whole
     * reason this route exists rather than a config endpoint handing the key to the page: a
     * Data API key in client JavaScript is a public key, readable by anyone who opens the
     * page, and spending an operator's quota is the least of what they could then do with it.
     * Referrer restrictions help in a browser and are trivially skipped outside one.
     *
     * The response shape is the one `YouTubeCompanion.search` already returns, so the client
     * treats the two paths identically.
     */
    app.get('/api/yt/search', async (req, res) => {
        const key = (process.env.YOUTUBE_API_KEY || '').trim();
        const q = String(req.query.q || '').trim();
        if (!q) {
            // A readiness probe. Answers whether search is available here without spending a
            // unit of quota to find out, so Settings can say "Ready" on every page load.
            return res.json({ configured: Boolean(key) });
        }
        if (!key) {
            return res.status(503).json({ error: 'This deployment has no YouTube key configured.' });
        }
        const max = Math.max(1, Math.min(10, Number(req.query.max) || 4));
        const params = new URLSearchParams({
            part: 'snippet',
            type: 'video',
            videoEmbeddable: 'true',
            safeSearch: 'moderate',
            maxResults: String(max),
            q,
            key,
        });
        try {
            const upstream = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
            if (!upstream.ok) {
                // The upstream status, never its body: a quota error from Google names the
                // project and the key's identifier, and this response is public.
                return res.status(upstream.status === 403 ? 429 : 502).json({ error: `Upstream: ${upstream.status}` });
            }
            const body = await upstream.json();
            const results = (body.items || [])
                .filter((it) => it.id && ID_RE.test(it.id.videoId || ''))
                .map((it) => ({
                    id: it.id.videoId,
                    start: 0,
                    name: (it.snippet && it.snippet.title) || '',
                    author: (it.snippet && it.snippet.channelTitle) || '',
                    // D9. Carried here too, or a deployment-key search would tell the model
                    // less than a visitor's own key does.
                    description: (it.snippet && it.snippet.description) || '',
                    publishedAt: (it.snippet && it.snippet.publishedAt) || '',
                }));
            res.setHeader('Cache-Control', 'public, max-age=300');
            return res.json({ results });
        } catch (err) {
            return res.status(502).json({ error: 'search failed' });
        }
    });

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
