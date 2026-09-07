/**
 * Web search on the deployment's own key (batch S1).
 *
 *   GET /api/research/search            → { configured: bool }   readiness, no quota spent
 *   GET /api/research/search?q=…        → { results: [...] }
 *
 * Second source, never first. `ResearchRegistry` reaches for this only when Wikipedia has
 * nothing or too little, so on most topics this route is never called and no key is needed.
 *
 * **The key never reaches the browser**, which is the entire reason the route exists rather
 * than a config endpoint handing the page a key. Same argument as `api/yt-search.js`: a search
 * key in client JavaScript is a public key, readable by anyone who opens the page.
 *
 * Snippets only. This never fetches a result page — see `providers/websearch.js` for why that
 * is a deliberate boundary rather than a missing feature.
 *
 * Supports Brave and Serper, whichever key is set. Two rather than one because neither has a
 * free tier that suits everybody, and adding a third is a `case` here plus a mapper.
 */

const MAX_RESULTS = 8;

function normalise(items) {
    return items
        .filter((it) => it && (it.title || it.description || it.snippet))
        .slice(0, MAX_RESULTS)
        .map((it) => ({
            title: String(it.title || '').slice(0, 200),
            snippet: String(it.description || it.snippet || '').slice(0, 600),
            url: String(it.url || it.link || '').slice(0, 600),
        }));
}

async function brave(key, q, max) {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${max}`;
    const r = await fetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': key } });
    if (!r.ok) {
        return { error: r.status };
    }
    const body = await r.json();
    return { results: normalise((body.web && body.web.results) || []) };
}

async function serper(key, q, max) {
    const r = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, num: max }),
    });
    if (!r.ok) {
        return { error: r.status };
    }
    const body = await r.json();
    return { results: normalise(body.organic || []) };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

    const braveKey = (process.env.BRAVE_SEARCH_API_KEY || '').trim();
    const serperKey = (process.env.SERPER_API_KEY || '').trim();
    const key = braveKey || serperKey;
    const q = String((req.query && req.query.q) || '').trim();

    // The readiness probe. `ResearchRegistry` asks this the first time a topic escalates, so
    // it must not cost a unit of the operator's quota to answer.
    if (!q) return res.status(200).json({ configured: Boolean(key) });
    if (!key) return res.status(503).json({ error: 'This deployment has no web search key configured.' });

    const max = Math.max(1, Math.min(MAX_RESULTS, Number((req.query && req.query.max) || 4)));
    try {
        const out = braveKey ? await brave(braveKey, q, max) : await serper(serperKey, q, max);
        if (out.error) {
            // The status, never the body: a provider's quota errors name the account and key,
            // and this response is public.
            return res.status(out.error === 403 || out.error === 429 ? 429 : 502).json({
                error: `Upstream: ${out.error}`,
            });
        }
        return res.status(200).json({ results: out.results });
    } catch (e) {
        return res.status(502).json({ error: 'Search failed.' });
    }
}
