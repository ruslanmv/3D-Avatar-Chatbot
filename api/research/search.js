/**
 * Web search on the deployment's own key (batch S1).
 *
 *   GET /api/research/search            → { configured, provider } readiness, no quota spent
 *   GET /api/research/search?q=…        → { results: [...] }
 *
 * Snippets only. This never fetches a result page — see `providers/websearch.js` for why that
 * is a deliberate boundary rather than a missing feature.
 */

const MAX_RESULTS = 8;

function text(value, max) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalise(items) {
    return items
        .filter((it) => it && (it.title || it.description || it.snippet))
        .slice(0, MAX_RESULTS)
        .map((it, index) => ({
            title: text(it.title, 200),
            snippet: text(it.description || it.snippet, 600),
            url: text(it.url || it.link, 600),
            siteName: text(it.siteName || it.source || (it.profile && it.profile.long_name), 100),
            published: text(it.published || it.date || it.age || it.page_age, 80),
            rank: Number(it.position || it.rank || index + 1) || index + 1,
        }));
}

async function brave(key, q, max) {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${max}`;
    const r = await fetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': key } });
    if (!r.ok) return { error: r.status };
    const body = await r.json();
    return { results: normalise((body.web && body.web.results) || []) };
}

async function serper(key, q, max) {
    const r = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, num: max }),
    });
    if (!r.ok) return { error: r.status };
    const body = await r.json();
    return { results: normalise(body.organic || []) };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

    const braveKey = (process.env.BRAVE_SEARCH_API_KEY || '').trim();
    const serperKey = (process.env.SERPER_API_KEY || '').trim();
    const key = braveKey || serperKey;
    const provider = braveKey ? 'brave' : serperKey ? 'serper' : '';
    const q = String((req.query && req.query.q) || '').trim();

    if (!q) {
        // Readiness is configuration state, not content. Never leave a stale "no key" answer
        // in a browser/CDN after an operator adds an environment variable and redeploys.
        res.setHeader('Cache-Control', 'private, no-store');
        return res.status(200).json({ configured: Boolean(key), provider });
    }
    if (!key) return res.status(503).json({ error: 'This deployment has no web search key configured.' });

    const max = Math.max(1, Math.min(MAX_RESULTS, Number((req.query && req.query.max) || 4)));
    try {
        const out = braveKey ? await brave(braveKey, q, max) : await serper(serperKey, q, max);
        if (out.error) {
            return res.status(out.error === 403 || out.error === 429 ? 429 : 502).json({
                error: `Upstream: ${out.error}`,
            });
        }
        return res.status(200).json({ results: out.results });
    } catch (e) {
        return res.status(502).json({ error: 'Search failed.' });
    }
}
