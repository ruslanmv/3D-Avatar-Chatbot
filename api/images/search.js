/**
 * Same-origin image provider gateway.
 *
 * GET  /api/images/search?provider=pexels                     readiness
 * GET  /api/images/search?provider=pexels&q=...&max=4         Pexels search
 * GET  /api/images/search?provider=pollinations               readiness
 * POST /api/images/search { provider:'pollinations', ... }    generated image bytes
 *
 * Deployment provider secrets live only in environment variables. A visitor may
 * optionally send their own Pollinations key in X-Nexus-Pollinations-Key for one
 * request; it is used in memory only and is never returned by this endpoint.
 */

const MAX_PEXELS_RESULTS = 12;
const MAX_PROMPT = 1200;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 45000;
const MAX_PERSONAL_KEY = 512;

function cleanText(value, max) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

function clampInteger(value, min, max, fallback) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function pexelsKey() {
    return String(process.env.PEXELS_API_KEY || '').trim();
}

function pollinationsKey(personalKey = '') {
    return cleanText(personalKey, MAX_PERSONAL_KEY) || String(process.env.POLLINATIONS_API_KEY || '').trim();
}

function normalizePexels(photo, query) {
    if (!photo || !photo.id || !photo.src) return null;
    const src = photo.src || {};
    const url = cleanText(src.large2x || src.large || src.original, 1200);
    if (!url) return null;
    return {
        id: String(photo.id),
        provider: 'pexels',
        kind: 'image',
        type: 'real',
        title: cleanText(photo.alt || query || 'Pexels photo', 220),
        creator: cleanText(photo.photographer || 'Pexels contributor', 160),
        alt: cleanText(photo.alt || query || 'Pexels photo', 300),
        width: Number(photo.width) || null,
        height: Number(photo.height) || null,
        url,
        thumbnail: cleanText(src.medium || src.small || url, 1200),
        sourceUrl: cleanText(photo.url, 1200),
        photographerUrl: cleanText(photo.photographer_url, 1200),
    };
}

async function searchPexels(query, max) {
    const key = pexelsKey();
    if (!key) return { error: 503, message: 'Pexels is not configured on this deployment.' };
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${max}`;
    const response = await fetch(url, {
        headers: { Authorization: key, Accept: 'application/json' },
    });
    if (!response.ok) {
        return {
            error:
                response.status === 401 || response.status === 403 || response.status === 429 ? response.status : 502,
            message: `Pexels upstream returned ${response.status}.`,
        };
    }
    const body = await response.json();
    const results = (Array.isArray(body && body.photos) ? body.photos : [])
        .slice(0, max)
        .map((photo) => normalizePexels(photo, query))
        .filter(Boolean);
    return { results };
}

async function generatePollinations(prompt, width, height, seed, personalKey = '') {
    const key = pollinationsKey(personalKey);
    if (!key) return { error: 503, message: 'Pollinations is not configured on this deployment.' };

    const target = new URL(`https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}`);
    target.searchParams.set('model', 'flux');
    target.searchParams.set('width', String(width));
    target.searchParams.set('height', String(height));
    target.searchParams.set('seed', String(seed));
    target.searchParams.set('nologo', 'true');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    let response;
    try {
        response = await fetch(target, {
            method: 'GET',
            headers: { Authorization: `Bearer ${key}`, Accept: 'image/*' },
            signal: controller.signal,
        });
    } catch (error) {
        clearTimeout(timer);
        if (error && error.name === 'AbortError') return { error: 504, message: 'AI image generation timed out.' };
        return { error: 502, message: 'AI image generation failed.' };
    }
    clearTimeout(timer);

    if (!response.ok) {
        return {
            error:
                response.status === 401 || response.status === 403 || response.status === 429 ? response.status : 502,
            message: `Pollinations upstream returned ${response.status}.`,
        };
    }

    const contentType = String(response.headers.get('content-type') || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
    if (!contentType.startsWith('image/')) return { error: 502, message: 'AI provider returned a non-image response.' };
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_IMAGE_BYTES) return { error: 413, message: 'Generated image is too large.' };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) return { error: 413, message: 'Generated image is too large.' };
    return { bytes, contentType };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept,X-Nexus-Pollinations-Key');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') return res.status(204).end();

    const provider = cleanText((req.query && req.query.provider) || (req.body && req.body.provider), 40).toLowerCase();
    if (!['pexels', 'pollinations'].includes(provider)) {
        return res.status(400).json({ error: 'provider must be pexels or pollinations' });
    }

    if (req.method === 'GET') {
        if (provider === 'pollinations') {
            res.setHeader('Cache-Control', 'private, no-store');
            return res.status(200).json({
                provider,
                configured: Boolean(pollinationsKey()),
                reason: pollinationsKey() ? 'deployment' : 'no-key',
                supportsPersonalKey: true,
            });
        }

        const query = cleanText(req.query && req.query.q, 240);
        if (!query) {
            res.setHeader('Cache-Control', 'private, no-store');
            return res.status(200).json({
                provider,
                configured: Boolean(pexelsKey()),
                reason: pexelsKey() ? 'deployment' : 'no-key',
                supportsPersonalKey: true,
            });
        }

        const max = clampInteger(req.query && req.query.max, 1, MAX_PEXELS_RESULTS, 4);
        try {
            const output = await searchPexels(query, max);
            if (output.error) return res.status(output.error).json({ error: output.message });
            res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
            return res.status(200).json(output);
        } catch (_) {
            return res.status(502).json({ error: 'Pexels search failed.' });
        }
    }

    if (req.method === 'POST') {
        if (provider !== 'pollinations')
            return res.status(405).json({ error: 'POST is only used for AI image generation.' });
        const prompt = cleanText(req.body && req.body.prompt, MAX_PROMPT);
        if (!prompt) return res.status(400).json({ error: 'prompt is required' });
        const width = clampInteger(req.body && req.body.width, 256, 2048, 1024);
        const height = clampInteger(req.body && req.body.height, 256, 2048, 1024);
        const seed = clampInteger(req.body && req.body.seed, 0, 2147483647, Math.floor(Math.random() * 1000000));
        const personalKey = cleanText(req.headers && req.headers['x-nexus-pollinations-key'], MAX_PERSONAL_KEY);
        const output = await generatePollinations(prompt, width, height, seed, personalKey);
        if (output.error) return res.status(output.error).json({ error: output.message });
        res.setHeader('Content-Type', output.contentType);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.status(200).send(output.bytes);
    }

    return res.status(405).json({ error: 'GET or POST only' });
}

export { cleanText, clampInteger, normalizePexels, searchPexels, generatePollinations };
