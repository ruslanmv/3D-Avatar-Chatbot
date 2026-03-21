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
    // Allow configured upstream APIs
    if (ALLOW.some((base) => u.startsWith(base))) return true;
    // Allow local network URLs (OllaBridge, HomePilot, Ollama on LAN)
    if (isLocalNetworkUrl(u)) return true;
    return false;
}

function isLocalNetworkUrl(url) {
    try {
        const u = new URL(url);
        const host = u.hostname;
        return (
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host === '0.0.0.0' ||
            host.startsWith('192.168.') ||
            host.startsWith('10.') ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(host)
        );
    } catch {
        return false;
    }
}

function httpsOnly(url) {
    const u = String(url || '');
    // Allow HTTP for local network (OllaBridge, Ollama, HomePilot)
    if (isLocalNetworkUrl(u)) return true;
    return /^https:\/\//i.test(u);
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
// Avatar Proxy (binary passthrough for CORS-blocked avatar CDNs)
// GET /api/avatar-proxy?url=https://models.readyplayer.me/...
// -----------------------------
const AVATAR_PROXY_HOSTS = [
    'models.readyplayer.me',
    'api.readyplayer.me',
    'raw.githubusercontent.com',
    'github.com',
    'hub.vroid.com',
    'api.sketchfab.com',
    'media.sketchfab.com',
    'arweave.net',
    'gateway.irys.xyz',
    'cdn.discordapp.com',
    'pub-c8f0641365ad47e5b3e1c85c39874909.r2.dev',
    'r2.dev',
    'avatars.yourfriend.online',
    'vrm-avatar-catalog.cloud-data.workers.dev',
    'homepilotai.github.io',
];

function isAllowedAvatarHost(urlStr) {
    try {
        const u = new URL(urlStr);
        return (
            u.protocol === 'https:' && AVATAR_PROXY_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))
        );
    } catch {
        return false;
    }
}

app.get('/api/avatar-proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'Missing "url" query parameter.' });
    if (!isAllowedAvatarHost(targetUrl)) {
        return res.status(403).json({ error: 'Host not in avatar proxy allowlist.' });
    }

    try {
        console.log(`[Avatar Proxy] GET -> ${targetUrl}`);
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
        console.error('[Avatar Proxy Error]', err);
        return res.status(500).json({ error: err?.message || String(err) });
    }
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

// -----------------------------
// RPM Guest Token (mirrors api/rpm-guest.js for local dev)
// POST /api/rpm-guest  { apiKey?: string, subdomain?: string }
// -----------------------------
app.post('/api/rpm-guest', async (req, res) => {
    const apiKey = req.headers['x-rpm-api-key'] || req.body?.apiKey;
    if (!apiKey) {
        return res.status(400).json({ error: 'Missing RPM API key. Configure it in Avatar Library settings.' });
    }

    try {
        const userRes = await fetch('https://api.readyplayer.me/v1/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
            },
            body: JSON.stringify({ data: { applicationId: apiKey } }),
        });

        if (!userRes.ok) {
            const errText = await userRes.text();
            console.error('[rpm-guest] user creation failed:', userRes.status, errText);
            return res.status(userRes.status).json({ error: `RPM API error: ${userRes.status}` });
        }

        const userData = await userRes.json();
        const token = userData.data?.token;
        const userId = userData.data?.id;

        if (!token) {
            return res.status(502).json({ error: 'RPM returned no token.' });
        }

        return res.status(200).json({ token, userId });
    } catch (err) {
        console.error('[rpm-guest] error:', err);
        return res.status(500).json({ error: err?.message || String(err) });
    }
});

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
