/**
 * Vercel Serverless — YouTube search on the deployment's own key (batch D13).
 *
 *   GET /api/yt/search            → { configured: bool }   readiness, no quota spent
 *   GET /api/yt/search?q=lofi     → { results: [...] }
 *
 * Set `YOUTUBE_API_KEY` in the project's environment variables and every visitor can search,
 * with nobody typing a key of their own. Somebody who wants to spend their own quota still
 * can — a key in Settings wins over this route.
 *
 * **The key never reaches the browser.** That is the point of the route: a Data API key in
 * client JavaScript is a public key, readable by anyone who opens the page. Referrer
 * restrictions help inside a browser and are trivially skipped outside one, so the only
 * design where an operator's key stays the operator's is one where the browser never has it.
 *
 * Mirrors `nexus-proxy/youtube-routes.cjs`, which serves the same path when the app is run
 * locally — one client path, two hosts.
 */

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

    const key = (process.env.YOUTUBE_API_KEY || '').trim();
    const q = String((req.query && req.query.q) || '').trim();

    // A readiness probe. Settings asks this on every open, so it must not cost a unit of the
    // operator's daily quota to answer.
    if (!q) return res.status(200).json({ configured: Boolean(key) });
    if (!key) return res.status(503).json({ error: 'This deployment has no YouTube key configured.' });

    const max = Math.max(1, Math.min(10, Number((req.query && req.query.max) || 4)));
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
            // The status, never the body: Google's quota errors name the project and the key,
            // and this response is public.
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
            }));
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.status(200).json({ results });
    } catch (err) {
        return res.status(502).json({ error: 'search failed' });
    }
}
