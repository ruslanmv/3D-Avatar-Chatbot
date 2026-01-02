/**
 * Vercel Serverless Function - CORS Proxy for AI APIs
 *
 * This serverless function provides the same functionality as nexus-proxy/server.js
 * but runs as a Vercel Edge/Serverless Function.
 *
 * Endpoint: /api/proxy
 * Method: POST
 * Body: { url, method, headers, body }
 *
 * Usage in production:
 * - Frontend calls: https://yourdomain.vercel.app/api/proxy
 * - No separate server needed - fully serverless
 *
 * Local development:
 * - Use nexus-proxy/server.js on port 3001
 * - Or use `vercel dev` which will serve this function at http://localhost:3000/api/proxy
 */

// Allowlist of upstream domains (prevents open relay)
const ALLOWED_HOSTS = [
    'iam.cloud.ibm.com',
    'us-south.ml.cloud.ibm.com',
    'eu-de.ml.cloud.ibm.com',
    'api.openai.com',
    'api.anthropic.com',
];

/**
 * Check if URL is in allowlist
 */
function isAllowedUrl(urlString) {
    try {
        const parsed = new URL(urlString);
        return ALLOWED_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith('.' + h));
    } catch {
        return false;
    }
}

/**
 * Main handler for Vercel serverless function
 */
export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only POST allowed
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { url, method, headers, body } = req.body || {};

        // Validate inputs
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'Missing or invalid "url" in request body' });
        }

        if (!isAllowedUrl(url)) {
            return res.status(403).json({
                error: 'Target URL not in allowlist',
                hint: 'Only OpenAI, Anthropic, and IBM Watsonx APIs are allowed',
            });
        }

        const upstreamMethod = (method || 'GET').toUpperCase();

        // Build upstream request headers (filter unsafe headers)
        const upstreamHeaders = {};
        const unsafeHeaders = ['host', 'connection', 'content-length', 'transfer-encoding'];

        if (headers && typeof headers === 'object') {
            Object.keys(headers).forEach((key) => {
                const lower = key.toLowerCase();
                if (!unsafeHeaders.includes(lower)) {
                    upstreamHeaders[key] = headers[key];
                }
            });
        }

        // Build fetch options
        const fetchOptions = {
            method: upstreamMethod,
            headers: upstreamHeaders,
        };

        // Add body if not GET/HEAD
        if (upstreamMethod !== 'GET' && upstreamMethod !== 'HEAD' && body !== undefined) {
            fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        }

        // Make upstream request
        const upstream = await fetch(url, fetchOptions);

        // Get response text
        const text = await upstream.text();

        // Copy safe response headers
        const safeResponseHeaders = ['content-type', 'content-encoding', 'cache-control'];
        safeResponseHeaders.forEach((h) => {
            const val = upstream.headers.get(h);
            if (val) res.setHeader(h, val);
        });

        // Return upstream response
        return res.status(upstream.status).send(text);
    } catch (error) {
        console.error('[Proxy Error]', error);
        return res.status(500).json({
            error: 'Proxy request failed',
            message: error.message,
        });
    }
}
