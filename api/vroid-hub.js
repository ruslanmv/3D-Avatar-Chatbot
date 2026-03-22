/**
 * Vercel Edge — VRoid Hub API Proxy
 *
 * Proxies VRoid Hub API requests with OAuth Bearer token.
 * Browser cannot call hub.vroid.com directly due to CORS.
 *
 * Endpoints:
 *   GET  /api/vroid-hub?action=list&count=50       — list character models (staff picks)
 *   GET  /api/vroid-hub?action=search&keyword=...   — search character models
 *   GET  /api/vroid-hub?action=account              — verify token (get account info)
 *   POST /api/vroid-hub  { action: 'token', ... }   — exchange/refresh OAuth token
 *
 * Auth: Authorization header with Bearer token, or appId+appSecret for token exchange.
 */

export const config = { runtime: 'edge' };

const VROID_API = 'https://hub.vroid.com';
const API_VERSION = '11';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
    return Response.json(data, { status, headers: CORS_HEADERS });
}

async function vroidFetch(path, token, options = {}) {
    const headers = {
        'X-Api-Version': API_VERSION,
        ...options.headers,
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${VROID_API}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body,
    });
    return res;
}

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Server-configured VRoid Hub app credentials (Vercel env vars)
    const ENV_APP_ID = typeof process !== 'undefined' ? process.env.VROID_APP_ID || '' : '';
    const ENV_APP_SECRET = typeof process !== 'undefined' ? process.env.VROID_APP_SECRET || '' : '';

    try {
        // POST — token exchange / refresh
        if (req.method === 'POST') {
            const body = await req.json();
            const { action } = body;

            if (action === 'token') {
                // If client omits client_id/client_secret, use server env vars as fallback
                const params = { ...body.params };
                if (!params.client_id && ENV_APP_ID) params.client_id = ENV_APP_ID;
                if (!params.client_secret && ENV_APP_SECRET) params.client_secret = ENV_APP_SECRET;

                const tokenRes = await fetch(`${VROID_API}/oauth/token`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-Api-Version': API_VERSION,
                    },
                    body: new URLSearchParams(params).toString(),
                });
                const tokenData = await tokenRes.json();
                return jsonResponse(tokenData, tokenRes.status);
            }

            return jsonResponse({ error: 'Unknown POST action' }, 400);
        }

        // GET — API proxy
        if (req.method !== 'GET') {
            return jsonResponse({ error: 'Method Not Allowed' }, 405);
        }

        const { searchParams } = new URL(req.url);
        const action = searchParams.get('action');

        // env_config — tell client whether server has pre-configured credentials
        // Returns appId (safe to expose) but NEVER the secret.
        if (action === 'env_config') {
            return jsonResponse({
                hasEnvCredentials: !!(ENV_APP_ID && ENV_APP_SECRET),
                appId: ENV_APP_ID || null,
            });
        }

        const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

        if (!token) {
            return jsonResponse({ error: 'Missing Authorization header' }, 401);
        }

        if (action === 'account') {
            const res = await vroidFetch('/api/account', token);
            const data = await res.json();
            return jsonResponse(data, res.status);
        }

        if (action === 'staff_picks') {
            const count = searchParams.get('count') || '50';
            const maxId = searchParams.get('max_id') || '';
            let path = `/api/staff_picks?count=${count}`;
            if (maxId) path += `&max_id=${maxId}`;
            const res = await vroidFetch(path, token);
            const data = await res.json();
            return jsonResponse(data, res.status);
        }

        if (action === 'list') {
            const count = searchParams.get('count') || '50';
            const maxId = searchParams.get('max_id') || '';
            let path = `/api/account/character_models?count=${count}`;
            if (maxId) path += `&max_id=${maxId}`;
            const res = await vroidFetch(path, token);
            const data = await res.json();
            return jsonResponse(data, res.status);
        }

        if (action === 'hearts') {
            const count = searchParams.get('count') || '50';
            const maxId = searchParams.get('max_id') || '';
            const appId = searchParams.get('application_id') || '';
            let path = `/api/hearts?count=${count}`;
            if (appId) path += `&application_id=${appId}`;
            if (maxId) path += `&max_id=${maxId}`;
            const res = await vroidFetch(path, token);
            const data = await res.json();
            return jsonResponse(data, res.status);
        }

        if (action === 'search') {
            const keyword = searchParams.get('keyword') || '';
            const count = searchParams.get('count') || '50';
            if (!keyword) return jsonResponse({ error: 'Missing keyword' }, 400);
            let searchPath = `/api/search/character_models?keyword=${encodeURIComponent(keyword)}&count=${count}`;
            // Pass through official VRoid Hub search filter params
            for (const f of ['is_downloadable', 'characterization_allowed_user', 'sort']) {
                const v = searchParams.get(f);
                if (v) searchPath += `&${f}=${encodeURIComponent(v)}`;
            }
            // Cursor-based pagination: search_after[] from _links.next.href
            const sa = searchParams.getAll('search_after[]');
            for (const v of sa) {
                searchPath += `&search_after[]=${encodeURIComponent(v)}`;
            }
            const res = await vroidFetch(searchPath, token);
            const data = await res.json();
            return jsonResponse(data, res.status);
        }

        if (action === 'download_license') {
            const modelId = searchParams.get('character_model_id');
            if (!modelId) return jsonResponse({ error: 'Missing character_model_id' }, 400);
            const res = await vroidFetch('/api/download_licenses', token, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ character_model_id: modelId }),
            });
            const data = await res.json();
            return jsonResponse(data, res.status);
        }

        if (action === 'download') {
            const licenseId = searchParams.get('license_id');
            if (!licenseId) return jsonResponse({ error: 'Missing license_id' }, 400);
            const res = await vroidFetch(`/api/download_licenses/${licenseId}/download`, token, {
                redirect: 'manual',
            });
            // VRoid Hub returns 302 redirect to S3 presigned URL
            if (res.status === 302 || res.status === 301) {
                const location = res.headers.get('location');
                return jsonResponse({ download_url: location });
            }
            // If not a redirect, pass through the response
            const data = await res.json().catch(() => ({}));
            return jsonResponse(data, res.status);
        }

        return jsonResponse(
            { error: 'Unknown action. Use: account, list, hearts, staff_picks, search, download_license, download' },
            400
        );
    } catch (err) {
        console.error('[api/vroid-hub] error:', err);
        return jsonResponse({ error: err?.message || String(err) }, 500);
    }
}
