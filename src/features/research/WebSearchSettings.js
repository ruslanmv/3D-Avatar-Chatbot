/**
 * The web search fields in Settings (batch S4).
 *
 * Owned entirely here, the way `YouTubeSettings` owns the YouTube key: `main.js`'s
 * `saveSettings()` does not know these inputs exist, so deleting `src/features/research/`
 * removes the feature in one move and leaves the panel working.
 *
 * ## Whose key wins, and why it is the user's
 *
 * The same rule D13 settled for YouTube: somebody who typed a key meant to use it — their
 * quota, their restrictions, their account — and silently preferring the deployment's would
 * make the field decorative. With no key of their own, the site's route answers and they never
 * have to learn that keys exist, which is the point.
 *
 * ## Why a user key goes through the proxy
 *
 * Neither Brave nor Serper sends CORS headers, so a browser cannot call them directly however
 * good the key is. A user key therefore travels browser → their own deployment's proxy → the
 * API, which is the path an OpenAI or Anthropic key already takes in this app: the same
 * deployment, already trusted with those. The deployment's *own* key never comes this way —
 * it stays server-side in `api/research/search.js`, and the browser never sees it.
 *
 * Exposes: window.NEXUS_WEB_SEARCH_SETTINGS
 */
(function (global) {
    'use strict';

    const KEY_STORE = 'nexus.search.apiKey';
    const PROVIDER_STORE = 'nexus.search.provider';

    /** Where each provider lives, and how it wants to be asked. */
    const PROVIDERS = {
        brave: {
            label: 'Brave Search',
            url: (q, max) => `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${max}`,
            method: 'GET',
            headers: (key) => ({ Accept: 'application/json', 'X-Subscription-Token': key }),
            body: null,
            results: (body) => (body && body.web && body.web.results) || [],
            help: 'Get a key at brave.com/search/api — the free tier covers ordinary use.',
        },
        serper: {
            label: 'Serper',
            url: () => 'https://google.serper.dev/search',
            method: 'POST',
            headers: (key) => ({ 'X-API-KEY': key, 'Content-Type': 'application/json' }),
            body: (q, max) => ({ q, num: max }),
            results: (body) => (body && body.organic) || [],
            help: 'Get a key at serper.dev.',
        },
    };

    function store(name) {
        try {
            return global && global.localStorage ? global.localStorage.getItem(name) || '' : '';
        } catch (_) {
            return '';
        }
    }

    function put(name, value) {
        try {
            if (!global || !global.localStorage) {
                return false;
            }
            if (value) {
                global.localStorage.setItem(name, value);
            } else {
                global.localStorage.removeItem(name);
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    /** The provider the user chose, or `''` for "use the site's setup". */
    function provider() {
        const id = store(PROVIDER_STORE);
        return PROVIDERS[id] ? id : '';
    }

    function apiKey() {
        return store(KEY_STORE).trim();
    }

    /** A user key is only usable with a provider to spend it on, and vice versa. */
    function own() {
        const id = provider();
        const key = apiKey();
        return id && key ? { id, key, spec: PROVIDERS[id] } : null;
    }

    function save({ provider: id, key }) {
        put(PROVIDER_STORE, PROVIDERS[id] ? id : '');
        put(KEY_STORE, String(key || '').trim());
        return own();
    }

    /**
     * Wire the two inputs, if they are on the page.
     *
     * The key box is hidden until a provider is chosen, because an empty box labelled "API
     * key" above a dropdown that says "use this site's setup" is an invitation to fill in
     * something that will be ignored.
     */
    function attach(doc) {
        const d = doc || (global && global.document);
        if (!d) {
            return null;
        }
        const select = d.getElementById('web-search-provider');
        const input = d.getElementById('web-search-key');
        const hint = d.getElementById('web-search-hint');
        if (!select || !input) {
            return null;
        }

        select.value = provider();
        input.value = apiKey();

        const reflect = () => {
            const spec = PROVIDERS[select.value];
            input.style.display = spec ? '' : 'none';
            input.placeholder = spec ? `Your ${spec.label} API key` : 'Your search API key';
            if (hint && spec) {
                hint.textContent = `${spec.help} Wikipedia is still used first and needs no key.`;
            }
        };
        reflect();

        select.addEventListener('change', () => {
            reflect();
            save({ provider: select.value, key: input.value });
        });
        input.addEventListener('change', () => save({ provider: select.value, key: input.value }));
        return { select, input };
    }

    // Self-mounting, the same way `DiscoverySettings` does: the fields belong to this file,
    // so nothing in `main.js` has to know they exist and deleting the folder takes them with
    // it. The escape hatch is for tests, which build their own DOM.
    if (typeof window !== 'undefined' && typeof document !== 'undefined' && !global.__NEXUS_WEB_SEARCH_NOAUTO__) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => attach());
        } else {
            attach();
        }
    }

    const api = { KEY_STORE, PROVIDER_STORE, PROVIDERS, provider, apiKey, own, save, attach };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_WEB_SEARCH_SETTINGS = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
