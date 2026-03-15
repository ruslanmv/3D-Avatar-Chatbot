/**
 * Vercel Serverless — RPM Guest Token
 *
 * Creates an anonymous Ready Player Me guest account and returns
 * a short-lived token that bypasses the login/signup screen in the iframe.
 *
 * Usage:
 *   POST /api/rpm-guest
 *   Body: { "subdomain": "demo" }   (optional, defaults to "demo")
 *   Headers: { "x-rpm-api-key": "<your RPM Studio API key>" }
 *            OR the key can be sent in the body as "apiKey"
 *
 * Returns: { "token": "...", "userId": "..." }
 *
 * Security:
 *   - Requires a valid RPM API key (from RPM Studio dashboard)
 *   - No user data is stored server-side
 */

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-rpm-api-key');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const apiKey = req.headers['x-rpm-api-key'] || req.body?.apiKey;
    if (!apiKey) {
        return res.status(400).json({ error: 'Missing RPM API key. Configure it in Avatar Library settings.' });
    }

    try {
        // Step 1: Create anonymous user
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
        const userId = userData.data?.id;
        const token = userData.data?.token;

        if (!token) {
            return res.status(502).json({ error: 'RPM returned no token.' });
        }

        return res.status(200).json({ token, userId });
    } catch (err) {
        console.error('[rpm-guest] error:', err);
        return res.status(500).json({ error: err?.message || String(err) });
    }
}
