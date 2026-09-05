/**
 * Looking at the user's other computer (batch RS1).
 *
 * The browser cannot photograph a machine it is not running on — no web API does that, and
 * pretending otherwise is where every design of this feature goes wrong. So a request to see
 * "my PC" is a *command that travels*: out through the OllaBridge the user already linked
 * for models, on to their HomePilot, which takes one still there and hands back a handle.
 *
 * This file is the client end of that path and nothing else. It decides nothing about the
 * chat, draws nothing, and holds no state beyond a cached capability probe.
 *
 * ## Everything degrades into a sentence
 *
 * There are five ways this can be unavailable and they need five different sentences,
 * because they have five different fixes and four of them are not on the machine the user is
 * looking at. `describe()` is where that lives; nothing else in the feature composes an
 * error message.
 *
 * ## The bytes come back as a blob, not as a URL
 *
 * An `<img src>` cannot send an Authorization header, so serving the frame by URL would mean
 * putting the bridge credential in a query string — into history, into any referrer, into
 * whatever logs the path. Fetching it and handing the card an object URL costs one extra
 * round trip and keeps the token in a header where it belongs.
 *
 * Exposes: window.NEXUS_SCREEN
 */
const RemoteScreen = (() => {
    'use strict';

    /** Milliseconds a capability answer is trusted before asking again. */
    const CAPABILITY_TTL_MS = 30 * 1000;

    /** A capture waits on HomePilot, which itself waits on a sharing tab. Be patient. */
    const CAPTURE_TIMEOUT_MS = 50 * 1000;
    const QUICK_TIMEOUT_MS = 12 * 1000;

    let cached = null;
    let cachedAt = 0;

    function discovery() {
        return (typeof window !== 'undefined' && window.NEXUS_BD_BRIDGE_DISCOVERY) || null;
    }

    /** Where the chat client keeps its provider settings. Read, never written. */
    const LLM_SETTINGS_KEY = 'nexus_llm_settings';

    /**
     * The bridge the chat is already pointed at, as `{base, auth}` — or `null`.
     *
     * BridgeDiscovery owns this answer and is asked first, so there is one place that knows
     * where the bridge lives. But it ships inside the behaviour engine, which a user can
     * switch off — and a user who has switched off the avatar's autonomy has not thereby
     * unlinked their bridge. Falling back to the same storage key it reads keeps "no
     * HomePilot" meaning *no HomePilot*, rather than "the engine is off".
     */
    function bridge(storage) {
        const d = discovery();
        if (d && typeof d.bridgeSettings === 'function') {
            const found = d.bridgeSettings(storage);
            if (found) {
                return found;
            }
        }
        return readSettings(storage);
    }

    function readSettings(storage) {
        const store = storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : storage;
        if (!store) {
            return null;
        }
        let parsed;
        try {
            parsed = JSON.parse(store.getItem(LLM_SETTINGS_KEY) || 'null');
        } catch (_) {
            return null;
        }
        const cfg = parsed && parsed.ollabridge;
        const base = String((cfg && cfg.base_url) || '')
            .trim()
            .replace(/\/+$/, '');
        if (!base) {
            return null;
        }
        // Whichever credential is actually filled in. `auth_mode` names the intent, but a
        // mode with an empty field is not a credential — the same rule BridgeDiscovery keeps.
        const key = String((cfg && cfg.api_key) || '').trim();
        const pair = String((cfg && cfg.pair_token) || '').trim();
        const preferPair = String((cfg && cfg.auth_mode) || '') === 'pair';
        return { base, auth: (preferPair ? pair || key : key || pair) || '' };
    }

    function headers(auth, json) {
        const h = {};
        if (json) {
            h['Content-Type'] = 'application/json';
        }
        if (auth) {
            h.Authorization = `Bearer ${auth}`;
        }
        return h;
    }

    /**
     * Reject rather than inherit fetch's default, which on a hung connection is minutes.
     * `AbortController` where there is one; a race everywhere else, including jsdom.
     */
    function withTimeout(promise, ms) {
        return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
    }

    function doFetch(deps) {
        return (deps && deps.fetch) || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    }

    // ── capability ──────────────────────────────────────────────────────────

    /** The shape every caller gets, whatever went wrong. Never throws, never rejects. */
    function nothing(reason, extra) {
        return Object.assign({ ok: true, available: false, reason, device: 'your computer' }, extra || {});
    }

    /**
     * Can we look at the user's computer right now, and if not, why not?
     *
     * Cached briefly. Not because the call is expensive but because the answer is asked for
     * on every keystroke-adjacent path — the composer hook wants to know before it decides
     * whether to claim a message — and a probe per keystroke is a probe per keystroke.
     */
    async function capability(deps = {}) {
        const at = (deps.now || Date.now)();
        if (!deps.force && cached && at - cachedAt < CAPABILITY_TTL_MS) {
            return cached;
        }
        const answer = await probe(deps);
        cached = answer;
        cachedAt = at;
        return answer;
    }

    async function probe(deps = {}) {
        const link = deps.bridge !== undefined ? deps.bridge : bridge(deps.storage);
        if (!link || !link.base) {
            return nothing('no-bridge');
        }
        const f = doFetch(deps);
        if (!f) {
            return nothing('no-fetch');
        }
        let res;
        try {
            res = await withTimeout(
                f(`${link.base}/v1/screen/capability`, { method: 'GET', headers: headers(link.auth, false) }),
                deps.timeoutMs || QUICK_TIMEOUT_MS
            );
        } catch (_) {
            return nothing('unreachable');
        }
        if (!res || res.status === 404 || res.status === 405) {
            // A bridge from before RS1. Absence means no, and it is not an error.
            return nothing('unsupported');
        }
        if (!res.ok) {
            return nothing(res.status === 401 || res.status === 403 ? 'unauthorized' : 'unreachable');
        }
        let body;
        try {
            body = await res.json();
        } catch (_) {
            return nothing('unreachable');
        }
        return Object.assign(
            { ok: true, available: false, reason: 'unreachable', device: 'your computer' },
            body || {}
        );
    }

    /** Throw the cached probe away — after a capture failed, or the user changed settings. */
    function invalidate() {
        cached = null;
        cachedAt = 0;
    }

    // ── the sentences ───────────────────────────────────────────────────────

    /**
     * One capability answer → what to say, and whether there is anything to offer instead.
     *
     * `fallback: 'share'` means the honest alternative is the screen the user is sitting at,
     * which needs no HomePilot at all — the standing rule that everything not requiring
     * HomePilot keeps working without it.
     */
    function describe(cap) {
        const device = (cap && cap.device) || 'your computer';
        const reason = (cap && cap.reason) || 'no-bridge';
        if (cap && cap.available) {
            return { ok: true, text: '', device };
        }
        switch (reason) {
            case 'no-bridge':
            case 'no-fetch':
                return {
                    ok: false,
                    device,
                    fallback: 'share',
                    text: 'I can look at this screen if you share it. To look at another computer, connect it to HomePilot.',
                };
            case 'unsupported':
                return {
                    ok: false,
                    device,
                    fallback: 'share',
                    text: `The HomePilot on ${device} is too old to take screenshots — update it there. I can still look at this screen if you share it.`,
                };
            case 'unauthorized':
                return {
                    ok: false,
                    device,
                    fallback: 'share',
                    text: 'Your bridge did not accept my credentials. Re-link OllaBridge in Settings.',
                };
            case 'disabled':
                return {
                    ok: false,
                    device,
                    fallback: 'share',
                    text: `Remote screen viewing is off on ${device}. Turn it on from HomePilot on that computer — or share your screen there and I can look at what you are sharing.`,
                };
            case 'no-backend':
                return {
                    ok: false,
                    device,
                    fallback: 'share',
                    text: `${device} allows remote screen viewing but has no way to take the picture yet.`,
                };
            default:
                return {
                    ok: false,
                    device,
                    fallback: 'share',
                    text: `${device} is offline. I will look as soon as it is back.`,
                };
        }
    }

    // ── capture / explain / bytes ───────────────────────────────────────────

    /**
     * Take one still. Resolves to `{ok, frame}` or `{ok:false, reason, message}`.
     *
     * Deliberately never rejects: every caller of this is about to put the outcome into a
     * conversation, and a thrown error there becomes a blank bubble.
     */
    async function capture(reason, deps = {}) {
        const link = deps.bridge !== undefined ? deps.bridge : bridge(deps.storage);
        const f = doFetch(deps);
        if (!link || !link.base || !f) {
            return { ok: false, reason: 'no-bridge', message: describe(nothing('no-bridge')).text };
        }
        let res;
        try {
            res = await withTimeout(
                f(`${link.base}/v1/screen/capture`, {
                    method: 'POST',
                    headers: headers(link.auth, true),
                    body: JSON.stringify({ reason: String(reason || '').slice(0, 200) }),
                }),
                deps.timeoutMs || CAPTURE_TIMEOUT_MS
            );
        } catch (_) {
            invalidate();
            return { ok: false, reason: 'timeout', message: 'Your computer did not answer in time.' };
        }
        let body = null;
        try {
            body = await res.json();
        } catch (_) {
            body = null;
        }
        if (!res.ok || !body || !body.ok || !body.frame) {
            invalidate();
            const cap = body && body.reason ? body : nothing((body && body.error) || 'unreachable', body || {});
            const said = (body && body.message) || describe(cap).text;
            return {
                ok: false,
                reason: (body && body.error) || 'unreachable',
                message: said,
                capability: body || null,
            };
        }
        return { ok: true, frame: body.frame };
    }

    /** Ask the vision model about a frame that already exists. Never rejects. */
    async function explain(frameId, question, deps = {}) {
        const link = deps.bridge !== undefined ? deps.bridge : bridge(deps.storage);
        const f = doFetch(deps);
        if (!link || !link.base || !f) {
            return { ok: false, error: 'no-bridge', message: describe(nothing('no-bridge')).text };
        }
        let res;
        try {
            res = await withTimeout(
                f(`${link.base}/v1/screen/explain`, {
                    method: 'POST',
                    headers: headers(link.auth, true),
                    body: JSON.stringify({ frame_id: frameId, question: String(question || '') }),
                }),
                deps.timeoutMs || CAPTURE_TIMEOUT_MS
            );
        } catch (_) {
            return { ok: false, error: 'timeout', message: 'I could not look at it just then.' };
        }
        try {
            const body = await res.json();
            return body && typeof body === 'object' ? body : { ok: false, error: 'bad-response' };
        } catch (_) {
            return { ok: false, error: 'bad-response' };
        }
    }

    /**
     * The image itself, as an object URL the card can hand to an `<img>`.
     *
     * Returns `null` rather than throwing on a 404: an expired frame is an ordinary outcome
     * here, not a fault, and the card shows the expiry rather than a broken image icon.
     */
    async function frameObjectUrl(frame, deps = {}) {
        const link = deps.bridge !== undefined ? deps.bridge : bridge(deps.storage);
        const f = doFetch(deps);
        if (!frame || !frame.url || !link || !link.base || !f) {
            return null;
        }
        let res;
        try {
            res = await withTimeout(
                f(`${link.base}${frame.url}`, { method: 'GET', headers: headers(link.auth, false) }),
                deps.timeoutMs || QUICK_TIMEOUT_MS
            );
        } catch (_) {
            return null;
        }
        if (!res || !res.ok || typeof res.blob !== 'function') {
            return null;
        }
        try {
            const blob = await res.blob();
            const maker = deps.URL || (typeof URL !== 'undefined' ? URL : null);
            return maker && maker.createObjectURL ? maker.createObjectURL(blob) : null;
        } catch (_) {
            return null;
        }
    }

    return {
        CAPABILITY_TTL_MS,
        LLM_SETTINGS_KEY,
        bridge,
        readSettings,
        capability,
        probe,
        invalidate,
        describe,
        capture,
        explain,
        frameObjectUrl,
    };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_SCREEN = RemoteScreen;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RemoteScreen;
}
