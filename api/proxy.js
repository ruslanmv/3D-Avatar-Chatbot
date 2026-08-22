/**
 * Vercel Serverless Proxy (Production)
 *
 * Endpoint:
 *   POST /api/proxy
 * Body:
 *   { url, method, headers, body }
 *
 * Security:
 * - HTTPS only
 * - Allowlist upstream domains (prevents open relay)
 * - Supports PROXY_ALLOWLIST env var for additional domains
 *
 * Notes:
 * - Returns upstream status + upstream response body as text (passthrough)
 * - Copies only safe response headers (content-type)
 */

import { isAllowedUrl } from './_allowlist.js';

// Upstream request budget, in milliseconds.
//
// This MUST stay below the function's `maxDuration` in vercel.json (60s), so
// that a slow upstream produces our own JSON 504 — which the client can
// explain to the user — rather than Vercel killing the invocation and
// returning an opaque FUNCTION_INVOCATION_TIMEOUT page.
//
// 60s is also the Hobby-plan ceiling. OllaBridge Cloud relays chat
// completions to the user's own PC and waits up to 120s for it, so a very
// slow local model can still exceed this; the error body says so explicitly
// instead of failing silently.
const UPSTREAM_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 55000);

function httpsOnly(url) {
    return /^https:\/\//i.test(String(url || ''));
}

function copySafeHeaders(upstreamHeaders) {
    const out = {};
    const ct = upstreamHeaders.get('content-type');
    if (ct) out['content-type'] = ct;
    return out;
}

// Remove hop-by-hop + unsafe headers from client to upstream
function sanitizeRequestHeaders(headersObj) {
    const unsafe = new Set([
        'host',
        'connection',
        'content-length',
        'transfer-encoding',
        'keep-alive',
        'proxy-authenticate',
        'proxy-authorization',
        'te',
        'trailer',
        'upgrade',
        'origin', // let upstream decide; don't forward browser origin
        'referer',
    ]);

    const out = {};
    const h = headersObj && typeof headersObj === 'object' ? headersObj : {};
    for (const [k, v] of Object.entries(h)) {
        const key = String(k || '').toLowerCase();
        if (!key || unsafe.has(key)) continue;
        out[k] = v;
    }
    return out;
}

export default async function handler(req, res) {
    // CORS: in production you can set this to your domain instead of "*"
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type,Authorization,X-Requested-With,anthropic-version,x-api-key,Accept'
    );

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const { url, method, headers, body } = req.body || {};

        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'Missing "url" in request body.' });
        }
        if (!httpsOnly(url)) {
            return res.status(400).json({ error: 'Only https:// URLs are allowed.' });
        }
        if (!isAllowedUrl(url)) {
            return res.status(403).json({ error: 'Target URL not in allowlist.' });
        }

        const m = String(method || 'POST').toUpperCase();

        // Build upstream request headers
        const upstreamHeadersObj = sanitizeRequestHeaders(headers);
        const upstreamHeaders = new Headers(upstreamHeadersObj);

        const hasBody = body !== undefined && body !== null;

        // If body exists and CT missing, set JSON by default
        if (hasBody && !upstreamHeaders.has('content-type')) {
            upstreamHeaders.set('content-type', 'application/json');
        }

        const upstreamBody = !hasBody ? undefined : typeof body === 'string' ? body : JSON.stringify(body);

        const ac = new AbortController();
        const started = Date.now();
        const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);

        let upstream;
        try {
            upstream = await fetch(url, {
                method: m,
                headers: upstreamHeaders,
                body: upstreamBody,
                signal: ac.signal,
            });
        } catch (err) {
            clearTimeout(timer);
            if (err && err.name === 'AbortError') {
                const secs = Math.round((Date.now() - started) / 1000);
                console.error(`[api/proxy] upstream timeout after ${secs}s: ${url}`);
                return res.status(504).json({
                    error:
                        `Upstream did not respond within ${secs}s. If this is OllaBridge ` +
                        `Cloud with Device Pairing, your PC may be offline or the model is ` +
                        `still loading — check the connector and try a smaller model.`,
                    code: 'UPSTREAM_TIMEOUT',
                    url,
                });
            }
            throw err;
        }
        clearTimeout(timer);

        const text = await upstream.text();

        res.status(upstream.status);

        // Copy safe response headers
        const safe = copySafeHeaders(upstream.headers);
        for (const [k, v] of Object.entries(safe)) res.setHeader(k, v);

        return res.send(text);
    } catch (err) {
        console.error('[api/proxy] error:', err);
        return res.status(500).json({ error: err?.message || String(err) });
    }
}
