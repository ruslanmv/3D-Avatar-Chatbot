/**
 * Nexus Proxy Server (Production-ready)
 *
 * What it does:
 * - Serves the static frontend (repo root) on the same origin
 * - Provides POST /proxy and POST /api/proxy to relay requests to AI providers (fixes browser CORS)
 *
 * Run:
 *   node nexus-proxy/server.js
 *
 * Env:
 *   PORT=8080                      (default: 8080; auto-fallback to next ports if busy)
 *   NEXUS_ALLOWED_ORIGINS=...       (optional comma list; if unset allows same-origin/no-origin)
 *
 * Security:
 * - HTTPS-only upstream + allowlist to avoid becoming an open proxy.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();

// -----------------------------
// Paths (ESM-safe __dirname)
// -----------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Repo root = one level above nexus-proxy/
const REPO_ROOT = path.resolve(__dirname, '..');

// -----------------------------
// Config
// -----------------------------
const BASE_PORT = Number(process.env.PORT || 8080);

// Optional strict frontend origins
const allowedOriginsEnv = (process.env.NEXUS_ALLOWED_ORIGINS || '').trim();
const allowedOrigins = allowedOriginsEnv
    ? allowedOriginsEnv
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
    : null;

// Upstream allowlist (prevents open relay)
const ALLOW = [
    'https://api.openai.com',
    'https://api.anthropic.com',
    'https://iam.cloud.ibm.com',
    'https://us-south.ml.cloud.ibm.com',
    'https://eu-de.ml.cloud.ibm.com',
];

// -----------------------------
// Middleware
// -----------------------------
app.use(express.json({ limit: '10mb' }));

app.use(
    cors({
        origin: (origin, cb) => {
            // Same-origin requests often have no Origin header
            if (!origin) return cb(null, true);

            // If no allowedOrigins configured, allow (good for dev)
            if (!allowedOrigins) return cb(null, true);

            return allowedOrigins.includes(origin)
                ? cb(null, true)
                : cb(new Error(`CORS blocked by proxy: origin not allowed: ${origin}`), false);
        },
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'anthropic-version', 'anthropic-beta'],
        maxAge: 600,
    })
);

// Preflight: always succeed quickly
app.options('*', (req, res) => res.sendStatus(204));

// Serve static frontend (repo root)
app.use(express.static(REPO_ROOT, { extensions: ['html'] }));

// -----------------------------
// Helpers
// -----------------------------
function isAllowedUrl(url) {
    const u = String(url || '');
    return ALLOW.some((base) => u.startsWith(base));
}

function httpsOnly(url) {
    return /^https:\/\//i.test(String(url || ''));
}

// Pass through only safe headers (but keep content-type)
function copySafeHeaders(upstreamHeaders) {
    const out = {};
    const ct = upstreamHeaders.get('content-type');
    if (ct) out['content-type'] = ct;

    // Optional: pass through rate-limit headers if you want them on the frontend.
    const rl = upstreamHeaders.get('x-ratelimit-remaining');
    if (rl) out['x-ratelimit-remaining'] = rl;

    return out;
}

// -----------------------------
// Health
// -----------------------------
app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'nexus-proxy', port: app.get('port') });
});

// -----------------------------
// Proxy route
// Body: { url, method, headers, body }
// -----------------------------
async function handleProxy(req, res) {
    try {
        const { url, method, headers, body } = req.body || {};

        if (!url || typeof url !== 'string') {
            // This is useful for "supportsApiProxy()" probe — it should return 400 if route exists.
            return res.status(400).json({ error: 'Missing "url" in request body.' });
        }
        if (!httpsOnly(url)) {
            return res.status(400).json({ error: 'Only https:// URLs are allowed.' });
        }
        if (!isAllowedUrl(url)) {
            return res.status(403).json({ error: 'Target URL not in allowlist.' });
        }

        const m = String(method || 'POST').toUpperCase();
        const h = headers && typeof headers === 'object' ? headers : {};
        const fetchHeaders = new Headers(h);

        const hasBody = body !== undefined && body !== null;
        if (hasBody && !fetchHeaders.has('content-type')) {
            fetchHeaders.set('content-type', 'application/json');
        }

        const upstreamBody = !hasBody ? undefined : typeof body === 'string' ? body : JSON.stringify(body);

        console.log(`[Proxy] ${m} -> ${url}`);

        const upstream = await fetch(url, {
            method: m,
            headers: fetchHeaders,
            body: upstreamBody,
        });

        const text = await upstream.text();

        res.status(upstream.status);

        const safe = copySafeHeaders(upstream.headers);
        Object.entries(safe).forEach(([k, v]) => res.setHeader(k, v));

        return res.send(text);
    } catch (err) {
        console.error('[Proxy Error]', err);
        return res.status(500).json({ error: err?.message || String(err) });
    }
}

app.post('/proxy', handleProxy);
app.post('/api/proxy', handleProxy); // alias for old frontends

// SPA fallback: serve index.html for unknown GET routes
app.get('*', (req, res) => {
    res.sendFile(path.join(REPO_ROOT, 'index.html'));
});

// -----------------------------
// Start server (auto-port fallback)
// -----------------------------
function listenWithFallback(startPort, tries = 20) {
    let port = startPort;

    const server = app.listen(port, () => {
        app.set('port', port);
        console.log(`🚀 Nexus (static + proxy) running: http://127.0.0.1:${port}`);
        console.log(`   Health:               http://127.0.0.1:${port}/health`);
        console.log(`   Proxy:                http://127.0.0.1:${port}/proxy`);
        console.log(`   Proxy (alias):        http://127.0.0.1:${port}/api/proxy`);
    });

    server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && tries > 0) {
            console.warn(`⚠️ Port ${port} in use. Trying ${port + 1}...`);
            server.close(() => listenWithFallback(port + 1, tries - 1));
            return;
        }
        console.error('❌ Server error:', err);
        process.exit(1);
    });
}

listenWithFallback(BASE_PORT);
