/**
 * Nexus Proxy Server (2025)
 * Fixes browser CORS by relaying requests to AI providers.
 *
 * Contract:
 *  POST /proxy
 *  Body: { url, method, headers, body }
 *  Response: upstream status + upstream body (passthrough)
 *
 * Security notes:
 * - Uses allowlist of upstream domains
 * - Optionally restricts allowed frontend origins via env
 *
 * Env:
 * - PORT=3001 (default, avoids conflict with frontend on 8080)
 * - ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5500
 */

import express from 'express';
import cors from 'cors';

const app = express();
const PORT = Number(process.env.PORT || 3001);

// ---- CORS to allow your frontend to call the proxy ----
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

app.use(
    cors({
        origin: (origin, cb) => {
            if (!origin) return cb(null, true); // allow curl/postman
            if (allowedOrigins.includes('*')) return cb(null, true);
            if (allowedOrigins.includes(origin)) return cb(null, true);
            return cb(new Error('CORS blocked by proxy: origin not allowed'), false);
        },
    })
);

app.use(express.json({ limit: '10mb' }));

// ---- Upstream allowlist (prevents proxy from being an open relay) ----
const ALLOW = [
    'https://iam.cloud.ibm.com',
    'https://us-south.ml.cloud.ibm.com',
    'https://eu-de.ml.cloud.ibm.com',
    'https://api.openai.com',
    'https://api.anthropic.com',
];

function isAllowedUrl(url) {
    const u = String(url || '');
    return ALLOW.some((base) => u.startsWith(base));
}

function copySafeHeaders(upstreamHeaders) {
    // pass through only what's safe/needed; content-type is important
    const out = {};
    const ct = upstreamHeaders.get('content-type');
    if (ct) out['content-type'] = ct;
    return out;
}

app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'nexus-proxy', port: PORT });
});

app.post('/proxy', async (req, res) => {
    try {
        const { url, method, headers, body } = req.body || {};

        if (!url || !method) {
            return res.status(400).json({ error: 'Missing url or method' });
        }

        if (!isAllowedUrl(url)) {
            return res.status(403).json({ error: 'Target URL not in allowlist' });
        }

        const m = String(method || 'GET').toUpperCase();
        const h = headers && typeof headers === 'object' ? headers : {};

        // IMPORTANT:
        // If caller provides body as object, we JSON.stringify it.
        // If caller provides body as string, we forward it as-is.
        let upstreamBody = undefined;
        if (body !== undefined && body !== null) {
            upstreamBody = typeof body === 'string' ? body : JSON.stringify(body);
        }

        console.log(`[Proxy] ${m} -> ${url}`);

        const upstream = await fetch(url, {
            method: m,
            headers: h,
            body: upstreamBody,
        });

        const text = await upstream.text();

        res.status(upstream.status);
        const safe = copySafeHeaders(upstream.headers);
        Object.entries(safe).forEach(([k, v]) => res.setHeader(k, v));

        return res.send(text);
    } catch (err) {
        console.error('[Proxy Error]', err);
        return res.status(500).json({ error: err.message || String(err) });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Nexus Proxy running: http://localhost:${PORT}`);
    console.log(`   Health check:       http://localhost:${PORT}/health`);
});
