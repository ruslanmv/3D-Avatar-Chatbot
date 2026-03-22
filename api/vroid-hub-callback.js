/**
 * Vercel Edge — VRoid Hub OAuth Callback
 *
 * Handles the OAuth authorization_code callback from VRoid Hub.
 * Exchanges the authorization code for access + refresh tokens.
 *
 * Flow:
 *   1. User clicks "Connect" → popup opens hub.vroid.com/oauth/authorize
 *   2. User authorizes → VRoid redirects here with ?code=...&state=...
 *   3. We exchange the code for tokens (with PKCE code_verifier from state)
 *   4. Return an HTML page that sends tokens to the opener window via postMessage
 */

export const config = { runtime: 'edge' };

const VROID_API = 'https://hub.vroid.com';
const API_VERSION = '11';

export default async function handler(req) {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state'); // JSON: { codeVerifier, clientId, clientSecret, redirectUri }
    const error = searchParams.get('error');

    if (error) {
        return htmlResponse(`
            <h2>Authorization Failed</h2>
            <p>${escapeHtml(error)}: ${escapeHtml(searchParams.get('error_description') || '')}</p>
            <script>
                window.opener && window.opener.postMessage({ type: 'vroid-oauth-error', error: ${JSON.stringify(error)} }, '*');
                setTimeout(() => window.close(), 3000);
            </script>
        `);
    }

    if (!code || !state) {
        return htmlResponse(`
            <h2>Missing Parameters</h2>
            <p>Authorization code or state missing.</p>
        `);
    }

    try {
        const stateData = JSON.parse(atob(state));
        const { codeVerifier, clientId, clientSecret, redirectUri } = stateData;

        // Use server env vars as fallback when client didn't provide credentials
        // (simplified flow: user only clicks "Authorize", server has the app keys)
        const ENV_APP_ID = typeof process !== 'undefined' ? process.env.VROID_APP_ID || '' : '';
        const ENV_APP_SECRET = typeof process !== 'undefined' ? process.env.VROID_APP_SECRET || '' : '';
        const finalClientId = clientId || ENV_APP_ID;
        const finalClientSecret = clientSecret || ENV_APP_SECRET;

        console.log('[vroid-hub-callback] Token exchange debug:', {
            hasCode: !!code,
            redirectUri,
            finalClientId: finalClientId ? finalClientId.substring(0, 8) + '...' : '(empty)',
            hasSecret: !!finalClientSecret,
            secretSource: clientSecret ? 'state' : ENV_APP_SECRET ? 'env' : 'none',
            hasCodeVerifier: !!codeVerifier,
        });

        // Exchange authorization code for tokens
        const tokenRes = await fetch(`${VROID_API}/oauth/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Api-Version': API_VERSION,
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

        console.log('[vroid-hub-callback] Token response:', {
            status: tokenRes.status,
            hasAccessToken: !!tokenData.access_token,
            hasRefreshToken: !!tokenData.refresh_token,
            error: tokenData.error || null,
            errorDescription: tokenData.error_description || null,
        });

        if (!tokenData.access_token) {
            return htmlResponse(`
                <h2>Token Exchange Failed</h2>
                <p>${escapeHtml(tokenData.error || tokenData.error_description || 'Unknown error')}</p>
                <script>
                    window.opener && window.opener.postMessage({
                        type: 'vroid-oauth-error',
                        error: ${JSON.stringify(tokenData.error || 'token_exchange_failed')}
                    }, '*');
                    setTimeout(() => window.close(), 3000);
                </script>
            `);
        }

        // Send tokens back to opener window via postMessage
        return htmlResponse(`
            <h2>Connected!</h2>
            <p>VRoid Hub authorized successfully. This window will close automatically.</p>
            <script>
                window.opener && window.opener.postMessage({
                    type: 'vroid-oauth-success',
                    accessToken: ${JSON.stringify(tokenData.access_token)},
                    refreshToken: ${JSON.stringify(tokenData.refresh_token || '')},
                    expiresIn: ${tokenData.expires_in || 3600}
                }, '*');
                setTimeout(() => window.close(), 1500);
            </script>
        `);
    } catch (e) {
        return htmlResponse(`
            <h2>Error</h2>
            <p>${escapeHtml(e.message)}</p>
            <script>
                window.opener && window.opener.postMessage({
                    type: 'vroid-oauth-error',
                    error: 'callback_error'
                }, '*');
                setTimeout(() => window.close(), 3000);
            </script>
        `);
    }
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function htmlResponse(body) {
    return new Response(
        `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>VRoid Hub — OAuth</title>
<style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center;
           align-items: center; min-height: 100vh; margin: 0; background: #1a1a2e; color: #e0e0e0; }
    div { text-align: center; padding: 2rem; }
    h2 { color: #7c4dff; }
</style>
</head><body><div>${body}</div></body></html>`,
        {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }
    );
}
