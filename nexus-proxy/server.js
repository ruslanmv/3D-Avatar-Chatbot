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
    's3.amazonaws.com',
    'amazonaws.com',
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

// -----------------------------
// VRoid Hub API Proxy (bypasses CORS for hub.vroid.com API)
// GET  /api/vroid-hub?action=list|search|account|...  (requires Authorization header)
// POST /api/vroid-hub  { action: 'token', params: {...} }
// -----------------------------
const VROID_API = 'https://hub.vroid.com';
const VROID_API_VERSION = '11';

app.get('/api/vroid-hub', async (req, res) => {
    const action = req.query.action;

    // env_config — tell client whether server has pre-configured credentials (no auth required)
    if (action === 'env_config') {
        const ENV_APP_ID = process.env.VROID_APP_ID || '';
        const ENV_APP_SECRET = process.env.VROID_APP_SECRET || '';
        return res.json({
            hasEnvCredentials: !!(ENV_APP_ID && ENV_APP_SECRET),
            appId: ENV_APP_ID || null,
        });
    }

    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

    if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

    const vroidHeaders = {
        'X-Api-Version': VROID_API_VERSION,
        Authorization: `Bearer ${token}`,
    };

    try {
        let apiPath;
        if (action === 'account') {
            apiPath = '/api/account';
        } else if (action === 'staff_picks') {
            const count = req.query.count || '50';
            apiPath = `/api/staff_picks?count=${count}${req.query.max_id ? `&max_id=${req.query.max_id}` : ''}`;
        } else if (action === 'list') {
            const count = req.query.count || '50';
            apiPath = `/api/account/character_models?count=${count}${req.query.max_id ? `&max_id=${req.query.max_id}` : ''}`;
        } else if (action === 'hearts') {
            const count = req.query.count || '50';
            let p = `/api/hearts?count=${count}`;
            if (req.query.application_id) p += `&application_id=${req.query.application_id}`;
            if (req.query.max_id) p += `&max_id=${req.query.max_id}`;
            apiPath = p;
        } else if (action === 'search') {
            if (!req.query.keyword) return res.status(400).json({ error: 'Missing keyword' });
            let p = `/api/search/character_models?keyword=${encodeURIComponent(req.query.keyword)}&count=${req.query.count || '50'}`;
            // Pass through official VRoid Hub search filter params
            const searchFilters = ['is_downloadable', 'characterization_allowed_user', 'sort'];
            searchFilters.forEach((f) => {
                if (req.query[f]) p += `&${f}=${encodeURIComponent(req.query[f])}`;
            });
            // Cursor-based pagination: search_after[] from _links.next.href
            if (req.query['search_after[]']) {
                const sa = Array.isArray(req.query['search_after[]'])
                    ? req.query['search_after[]']
                    : [req.query['search_after[]']];
                sa.forEach((v) => {
                    p += `&search_after[]=${encodeURIComponent(v)}`;
                });
            }
            apiPath = p;
        } else if (action === 'download_license') {
            if (!req.query.character_model_id) return res.status(400).json({ error: 'Missing character_model_id' });
            const dlRes = await fetch(`${VROID_API}/api/download_licenses`, {
                method: 'POST',
                headers: { ...vroidHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ character_model_id: req.query.character_model_id }),
            });
            return res.status(dlRes.status).json(await dlRes.json());
        } else if (action === 'download') {
            if (!req.query.license_id) return res.status(400).json({ error: 'Missing license_id' });
            const dlRes = await fetch(`${VROID_API}/api/download_licenses/${req.query.license_id}/download`, {
                headers: vroidHeaders,
                redirect: 'manual',
            });
            if (dlRes.status === 302 || dlRes.status === 301) {
                return res.json({ download_url: dlRes.headers.get('location') });
            }
            return res.status(dlRes.status).json(await dlRes.json().catch(() => ({})));
        } else {
            return res.status(400).json({ error: 'Unknown action' });
        }

        const upstream = await fetch(`${VROID_API}${apiPath}`, { headers: vroidHeaders });
        return res.status(upstream.status).json(await upstream.json());
    } catch (err) {
        console.error('[vroid-hub] error:', err);
        return res.status(500).json({ error: err?.message || String(err) });
    }
});

app.post('/api/vroid-hub', async (req, res) => {
    const { action, params } = req.body || {};
    if (action === 'token' && params) {
        try {
            const tokenRes = await fetch(`${VROID_API}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Api-Version': VROID_API_VERSION },
                body: new URLSearchParams(params).toString(),
            });
            return res.status(tokenRes.status).json(await tokenRes.json());
        } catch (err) {
            return res.status(500).json({ error: err?.message || String(err) });
        }
    }
    return res.status(400).json({ error: 'Unknown POST action' });
});

// -----------------------------
// VRoid Hub OAuth Callback (mirrors api/vroid-hub-callback.js for local dev)
// GET /api/vroid-hub-callback?code=...&state=...
// -----------------------------
app.get('/api/vroid-hub-callback', async (req, res) => {
    const { code, state, error } = req.query;

    const html = (body) => `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>VRoid Hub — OAuth</title>
<style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center;
           align-items: center; min-height: 100vh; margin: 0; background: #1a1a2e; color: #e0e0e0; }
    div { text-align: center; padding: 2rem; }
    h2 { color: #7c4dff; }
</style>
</head><body><div>${body}</div></body></html>`;

    const esc = (s) =>
        String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

    if (error) {
        return res.type('html').send(
            html(`<h2>Authorization Failed</h2>
                <p>${esc(error)}: ${esc(req.query.error_description)}</p>
                <script>
                    window.opener && window.opener.postMessage({ type: 'vroid-oauth-error', error: ${JSON.stringify(error)} }, '*');
                    setTimeout(() => window.close(), 3000);
                </script>`)
        );
    }

    if (!code || !state) {
        return res.type('html').send(html('<h2>Missing Parameters</h2><p>Authorization code or state missing.</p>'));
    }

    try {
        const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
        const { codeVerifier, clientId, clientSecret, redirectUri } = stateData;

        // Use server env vars as fallback
        const ENV_APP_ID = process.env.VROID_APP_ID || '';
        const ENV_APP_SECRET = process.env.VROID_APP_SECRET || '';
        const finalClientId = clientId || ENV_APP_ID;
        const finalClientSecret = clientSecret || ENV_APP_SECRET;

        const tokenRes = await fetch(`${VROID_API}/oauth/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Api-Version': VROID_API_VERSION,
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                client_id: finalClientId,
                client_secret: finalClientSecret,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier,
            }).toString(),
        });

        const tokenData = await tokenRes.json();

        if (!tokenData.access_token) {
            return res.type('html').send(
                html(`<h2>Token Exchange Failed</h2>
                    <p>${esc(tokenData.error || tokenData.error_description || 'Unknown error')}</p>
                    <script>
                        window.opener && window.opener.postMessage({
                            type: 'vroid-oauth-error',
                            error: ${JSON.stringify(tokenData.error || 'token_exchange_failed')}
                        }, '*');
                        setTimeout(() => window.close(), 3000);
                    </script>`)
            );
        }

        console.log('[vroid-hub-callback] OAuth token exchange successful');

        return res.type('html').send(
            html(`<h2>Connected!</h2>
                <p>VRoid Hub authorized successfully. This window will close automatically.</p>
                <script>
                    window.opener && window.opener.postMessage({
                        type: 'vroid-oauth-success',
                        accessToken: ${JSON.stringify(tokenData.access_token)},
                        refreshToken: ${JSON.stringify(tokenData.refresh_token || '')},
                        expiresIn: ${tokenData.expires_in || 3600}
                    }, '*');
                    setTimeout(() => window.close(), 1500);
                </script>`)
        );
    } catch (err) {
        console.error('[vroid-hub-callback] error:', err);
        return res.type('html').send(
            html(`<h2>Error</h2>
                <p>${esc(err.message)}</p>
                <script>
                    window.opener && window.opener.postMessage({ type: 'vroid-oauth-error', error: 'callback_error' }, '*');
                    setTimeout(() => window.close(), 3000);
                </script>`)
        );
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
