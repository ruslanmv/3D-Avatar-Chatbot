/**
 * Vercel Serverless — RPM Guest Token (DEPRECATED)
 *
 * Ready Player Me was acquired by Netflix (Dec 2025) and shut down on Jan 31, 2026.
 * This endpoint is no longer functional. The avatar creator has been replaced by Avaturn.
 *
 * Kept as a stub to avoid 404 errors from cached clients.
 */

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-rpm-api-key');

    if (req.method === 'OPTIONS') return res.status(204).end();

    return res.status(410).json({
        error: 'Ready Player Me was discontinued on Jan 31, 2026 (acquired by Netflix). Use Avaturn instead.',
        alternative: 'https://avaturn.me',
        docs: 'https://docs.avaturn.me/docs/integration/web/html/',
    });
}
