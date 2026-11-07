/**
 * PG3 — ChatErrorText turns a failed reply into one fixed sentence with a next step, and never
 * echoes the error's own text (which can carry a gateway's HTML page, a header or a token).
 */
const T = require('../src/features/chat/ChatErrorText.js');

describe('ChatErrorText', () => {
    afterEach(() => {
        delete window.NEXUS_CONNECTION_CHECK;
    });

    test('classifies the failures the chat actually sees', () => {
        expect(T.kind({ status: 401, message: 'x' })).toBe('auth');
        expect(T.kind(new Error('OllaBridge 403 forbidden'))).toBe('auth');
        expect(T.kind(new Error('No API key or pairing token configured'))).toBe('auth');
        expect(T.kind(new Error('model_not_found: free-nope'))).toBe('model');
        expect(T.kind(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }))).toBe('timeout');
        expect(T.kind(new Error('Request timed out after 190000 ms'))).toBe('timeout');
        expect(T.kind({ status: 502, message: '<!DOCTYPE html><title>502 Bad gateway</title>' })).toBe('gateway');
        expect(T.kind(new TypeError('Failed to fetch'))).toBe('network');
        expect(T.kind(new Error('something else entirely'))).toBe('');
        expect(T.kind(null)).toBe('');
    });

    test('borrows ConnectionCheck.looksLikeAuth when it is present', () => {
        window.NEXUS_CONNECTION_CHECK = { looksLikeAuth: () => true };
        expect(T.kind(new Error('opaque'))).toBe('auth');
    });

    test('every sentence names a next step and none echoes the raw error', () => {
        const secret = 'Bearer ob_secret_token_123 <html>cloudflare</html>';
        for (const err of [
            { status: 401, message: secret },
            { status: 502, message: secret },
            new TypeError('Failed to fetch ' + secret),
        ]) {
            const s = T.describe(err);
            expect(s).toBeTruthy();
            expect(s).not.toMatch(/ob_secret|Bearer|<|>/);
            expect(s).toMatch(/retry|Settings|pick/i);
        }
    });

    test('an unknown failure gets no sentence, so the bubble stays as it was', () => {
        expect(T.describe(new Error('weird'))).toBe('');
    });
});
