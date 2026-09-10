/**
 * Nexus Image Media Plugin
 *
 * Adds image discovery to the chatbot without changing the chat or discovery core:
 * - Pexels for real photography (deployment key or an optional user key via /api/proxy)
 * - Pollinations for hosted AI image generation (deployment-side key only)
 * - HomePilot Remote for paired/private AI generation through the existing OllaBridge link
 * - independent Discovery & Media preferences for "Image source" and "AI image generator"
 * - narrow natural-language interception for "show/find an image" and "generate an image"
 *
 * HomePilot credentials never enter this plugin. The browser reuses the OllaBridge base URL
 * and credential already stored by the LLM settings, and OllaBridge owns HomePilot secrets.
 *
 * Exposes: window.NEXUS_IMAGE_MEDIA
 */
(function (global) {
    'use strict';

    const ROUTE = '/api/images/search';
    const PROXY_ROUTE = '/api/proxy';
    const PEXELS_KEY_STORE = 'nexus.images.pexelsApiKey';
    const LLM_SETTINGS_KEY = 'nexus_llm_settings';
    const SETTINGS_PANEL_ID = 'nexus-image-settings';
    const GROUP = Object.freeze({ id: 'image', label: 'Image source', capability: 'image.search' });
    const GENERATOR_GROUP = Object.freeze({
        id: 'imageGenerator',
        label: 'AI image generator',
        capability: 'image.generate',
    });
    const HOMEPILOT_CAPABILITY_PATH = '/v1/media/homepilot/capability';
    const HOMEPILOT_GENERATE_PATH = '/v1/media/homepilot/generate';
    const HOMEPILOT_TTL_MS = 30 * 1000;
    const LIVE = Object.freeze({ history: 'chat-history', input: 'speech-text', send: 'speak-btn' });
    const OLD = Object.freeze({ history: 'chatHistory', input: 'chatInput', send: 'sendBtn' });
    const RATIO = Object.freeze({
        '1:1': { width: 1024, height: 1024 },
        '16:9': { width: 1280, height: 720 },
        '9:16': { width: 720, height: 1280 },
    });

    const objectUrls = new Set();
    let pexelsDeployment = null;
    let pexelsProbe = null;
    let pollinationsDeployment = null;
    let pollinationsProbe = null;
    let homePilotState = { available: false, reason: 'checking' };
    let homePilotProbe = null;
    let homePilotCheckedAt = 0;
    let mounted = false;

    function storage() {
        try {
            return global && global.localStorage ? global.localStorage : null;
        } catch (_) {
            return null;
        }
    }

    function getStored(name) {
        const s = storage();
        try {
            return s ? s.getItem(name) || '' : '';
        } catch (_) {
            return '';
        }
    }

    function putStored(name, value) {
        const s = storage();
        if (!s) return false;
        try {
            const clean = String(value || '').trim();
            if (clean) s.setItem(name, clean);
            else s.removeItem(name);
            return true;
        } catch (_) {
            return false;
        }
    }

    function pexelsKey() {
        return getStored(PEXELS_KEY_STORE).trim();
    }

    function setPexelsKey(value) {
        putStored(PEXELS_KEY_STORE, value);
        return pexelsKey();
    }

    function fetcher(injected) {
        if (typeof injected === 'function') return injected;
        return global && typeof global.fetch === 'function' ? global.fetch.bind(global) : null;
    }

    function registry() {
        return (global && global.NEXUS_DISCOVERY) || null;
    }

    function discoverySettings() {
        return (global && global.NEXUS_DISCOVERY_SETTINGS) || null;
    }

    function dimensions(ratio) {
        return Object.assign({}, RATIO[ratio] || RATIO['1:1']);
    }

    function cleanText(value, max = 500) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max);
    }

    function safeCount(value, fallback = 4, max = 12) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(1, Math.min(max, Math.floor(number)));
    }

    function readBridgeSettings(store) {
        const s = store === undefined ? storage() : store;
        if (!s) return null;
        let parsed;
        try {
            parsed = JSON.parse(s.getItem(LLM_SETTINGS_KEY) || 'null');
        } catch (_) {
            return null;
        }
        const cfg = parsed && parsed.ollabridge;
        const base = String((cfg && cfg.base_url) || '')
            .trim()
            .replace(/\/+$/, '');
        if (!base) return null;
        const key = String((cfg && cfg.api_key) || '').trim();
        const pair = String((cfg && cfg.pair_token) || '').trim();
        const preferPair = String((cfg && cfg.auth_mode) || '') === 'pair';
        return { base, auth: (preferPair ? pair || key : key || pair) || '' };
    }

    /** Reuse the exact bridge selection already used by Remote Screen when it is loaded. */
    function bridge(store) {
        if (global && global.NEXUS_SCREEN && typeof global.NEXUS_SCREEN.bridge === 'function') {
            try {
                const found = global.NEXUS_SCREEN.bridge(store);
                if (found) return found;
            } catch (_) {}
        }
        if (
            global &&
            global.NEXUS_BD_BRIDGE_DISCOVERY &&
            typeof global.NEXUS_BD_BRIDGE_DISCOVERY.bridgeSettings === 'function'
        ) {
            try {
                const found = global.NEXUS_BD_BRIDGE_DISCOVERY.bridgeSettings(store === undefined ? storage() : store);
                if (found) return found;
            } catch (_) {}
        }
        return readBridgeSettings(store);
    }

    function bridgeHeaders(auth, json) {
        const headers = {};
        if (json) headers['Content-Type'] = 'application/json';
        if (auth) headers.Authorization = `Bearer ${auth}`;
        return headers;
    }

    function bridgeUrl(link, path) {
        const value = String(path || '').trim();
        if (!link || !link.base || !value) return '';
        if (value.startsWith('/')) return `${link.base}${value}`;
        try {
            const url = new URL(value, `${link.base}/`);
            const base = new URL(`${link.base}/`);
            return url.origin === base.origin ? url.href : '';
        } catch (_) {
            return '';
        }
    }

    async function deploymentStatus(provider, injectedFetch) {
        const f = fetcher(injectedFetch);
        if (!f) return { configured: false, reason: 'unreachable' };
        try {
            const response = await f(`${ROUTE}?provider=${encodeURIComponent(provider)}`, {
                method: 'GET',
                headers: { Accept: 'application/json' },
            });
            const type = String(response.headers && response.headers.get ? response.headers.get('content-type') : '');
            if (!response.ok || !/application\/json/i.test(type)) {
                return { configured: false, reason: response.status === 404 ? 'no-route' : 'unreachable' };
            }
            const body = await response.json();
            return {
                configured: Boolean(body && body.configured),
                reason: body && body.configured ? 'deployment' : (body && body.reason) || 'no-key',
            };
        } catch (_) {
            return { configured: false, reason: 'unreachable' };
        }
    }

    function normalizePexels(photo, query) {
        if (!photo || !photo.id || !photo.src) return null;
        const src = photo.src || {};
        const url = cleanText(src.large2x || src.large || src.original, 1200);
        const thumbnail = cleanText(src.medium || src.small || url, 1200);
        if (!url) return null;
        return {
            id: String(photo.id),
            provider: 'pexels',
            kind: 'image',
            type: 'real',
            title: cleanText(photo.alt || query || 'Pexels photo', 220),
            creator: cleanText(photo.photographer || 'Pexels contributor', 160),
            alt: cleanText(photo.alt || query || 'Pexels photo', 300),
            width: Number(photo.width) || null,
            height: Number(photo.height) || null,
            url,
            thumbnail,
            sourceUrl: cleanText(photo.url, 1200),
            photographerUrl: cleanText(photo.photographer_url, 1200),
        };
    }

    async function pexelsViaDeployment(query, max, injectedFetch) {
        const f = fetcher(injectedFetch);
        if (!f) return [];
        const url = `${ROUTE}?provider=pexels&q=${encodeURIComponent(query)}&max=${max}`;
        const response = await f(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`Pexels search failed (${response.status}).`);
        const body = await response.json();
        return Array.isArray(body && body.results) ? body.results : [];
    }

    async function pexelsViaUserKey(query, max, injectedFetch) {
        const key = pexelsKey();
        const f = fetcher(injectedFetch);
        if (!key || !f) return [];
        const upstream = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${max}`;
        const response = await f(PROXY_ROUTE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                url: upstream,
                method: 'GET',
                headers: { Authorization: key, Accept: 'application/json' },
            }),
        });
        if (!response.ok) throw new Error(`Pexels proxy search failed (${response.status}).`);
        const body = await response.json();
        return (Array.isArray(body && body.photos) ? body.photos : [])
            .map((photo) => normalizePexels(photo, query))
            .filter(Boolean);
    }

    const PexelsProvider = {
        ID: 'pexels',
        async ready(deps = {}) {
            if (pexelsDeployment !== null && !deps.force) return this.status();
            if (!pexelsProbe || deps.force) {
                pexelsProbe = deploymentStatus('pexels', deps.fetch).then((state) => {
                    pexelsDeployment = Boolean(state.configured);
                    this._deploymentReason = state.reason;
                    return this.status();
                });
            }
            return pexelsProbe;
        },
        status() {
            const own = Boolean(pexelsKey());
            const available = own || Boolean(pexelsDeployment);
            return {
                id: this.ID,
                configured: available,
                available,
                capabilities: ['image.search'],
                reason: own
                    ? 'ok'
                    : pexelsDeployment
                      ? 'deployment'
                      : pexelsDeployment === null
                        ? 'checking'
                        : this._deploymentReason || 'no-key',
            };
        },
        async search(query, options = {}) {
            const q = cleanText(query, 240);
            if (!q) return [];
            const max = safeCount(options.max, 4, 12);
            if (pexelsKey()) return pexelsViaUserKey(q, max, options.fetch);
            if (pexelsDeployment) return pexelsViaDeployment(q, max, options.fetch);
            return [];
        },
        normalize: normalizePexels,
    };

    function generatedResult(prompt, blob, options = {}) {
        const URLImpl = global && global.URL;
        if (!blob || !URLImpl || typeof URLImpl.createObjectURL !== 'function') return null;
        const url = URLImpl.createObjectURL(blob);
        objectUrls.add(url);
        const provider = options.provider || 'pollinations';
        const homePilot = provider === 'homepilot-remote';
        return {
            id: `${provider}-${options.seed || Date.now()}`,
            provider,
            kind: 'image',
            type: 'ai',
            title: cleanText(prompt, 220),
            creator: homePilot ? 'HomePilot Remote' : 'Pollinations.ai',
            alt: cleanText(`AI-generated image: ${prompt}`, 300),
            width: options.width || null,
            height: options.height || null,
            url,
            thumbnail: url,
            sourceUrl: homePilot ? '' : 'https://pollinations.ai',
        };
    }

    const PollinationsProvider = {
        ID: 'pollinations',
        async ready(deps = {}) {
            if (pollinationsDeployment !== null && !deps.force) return this.status();
            if (!pollinationsProbe || deps.force) {
                pollinationsProbe = deploymentStatus('pollinations', deps.fetch).then((state) => {
                    pollinationsDeployment = Boolean(state.configured);
                    this._deploymentReason = state.reason;
                    return this.status();
                });
            }
            return pollinationsProbe;
        },
        status() {
            return {
                id: this.ID,
                configured: Boolean(pollinationsDeployment),
                available: Boolean(pollinationsDeployment),
                capabilities: ['image.search', 'image.generate'],
                reason: pollinationsDeployment
                    ? 'deployment'
                    : pollinationsDeployment === null
                      ? 'checking'
                      : this._deploymentReason || 'no-key',
            };
        },
        async search(query, options = {}) {
            const q = cleanText(query, 1200);
            if (!q || !pollinationsDeployment) return [];
            const f = fetcher(options.fetch);
            if (!f) return [];
            const size =
                options.width && options.height
                    ? { width: options.width, height: options.height }
                    : dimensions(options.ratio);
            const seed = Number.isFinite(Number(options.seed))
                ? Math.abs(Math.floor(Number(options.seed)))
                : Math.floor(Math.random() * 1000000);
            const response = await f(ROUTE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'image/*' },
                body: JSON.stringify({
                    provider: 'pollinations',
                    prompt: q,
                    width: size.width,
                    height: size.height,
                    seed,
                }),
            });
            if (!response.ok) throw new Error(`AI image generation failed (${response.status}).`);
            const blob = await response.blob();
            const one = generatedResult(q, blob, { width: size.width, height: size.height, seed });
            return one ? [one] : [];
        },
    };

    async function homePilotCapability(deps = {}) {
        const link = deps.bridge !== undefined ? deps.bridge : bridge(deps.storage);
        if (!link || !link.base) return { available: false, reason: 'no-bridge' };
        const f = fetcher(deps.fetch);
        if (!f) return { available: false, reason: 'unreachable' };
        let response;
        try {
            response = await f(`${link.base}${HOMEPILOT_CAPABILITY_PATH}`, {
                method: 'GET',
                headers: Object.assign({ Accept: 'application/json' }, bridgeHeaders(link.auth, false)),
            });
        } catch (_) {
            return { available: false, reason: 'unreachable' };
        }
        if (!response || response.status === 404 || response.status === 405) {
            return { available: false, reason: 'unsupported' };
        }
        if (!response.ok) {
            return {
                available: false,
                reason: response.status === 401 || response.status === 403 ? 'unauthorized' : 'unreachable',
            };
        }
        let body;
        try {
            body = await response.json();
        } catch (_) {
            return { available: false, reason: 'unreachable' };
        }
        const available = Boolean(body && (body.available || body.enabled || body.ready));
        return {
            available,
            reason: available ? 'ok' : cleanText((body && body.reason) || 'disabled', 80),
            device: cleanText((body && (body.device || body.name)) || 'HomePilot', 120),
        };
    }

    function invalidateHomePilot() {
        homePilotState = { available: false, reason: 'checking' };
        homePilotProbe = null;
        homePilotCheckedAt = 0;
    }

    function base64Blob(value, mime) {
        if (!value || typeof value !== 'string') return null;
        try {
            const raw = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
            if (typeof atob !== 'function') return null;
            const binary = atob(raw);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
            return new Blob([bytes], { type: mime || 'image/png' });
        } catch (_) {
            return null;
        }
    }

    function remoteItems(body) {
        if (!body) return [];
        if (Array.isArray(body.results)) return body.results;
        if (Array.isArray(body.images)) return body.images;
        if (body.media && Array.isArray(body.media.images)) return body.media.images;
        if (Array.isArray(body.data)) return body.data;
        return [];
    }

    async function homePilotResult(prompt, item, link, options, injectedFetch) {
        const width = options.width || null;
        const height = options.height || null;
        const seed = options.seed || null;
        if (item && typeof item === 'object') {
            const encoded = item.b64_json || item.base64 || '';
            if (encoded) {
                const blob = base64Blob(encoded, item.mime_type || item.content_type || 'image/png');
                return generatedResult(prompt, blob, {
                    provider: 'homepilot-remote',
                    width,
                    height,
                    seed,
                });
            }
        }
        const path = typeof item === 'string' ? item : item && (item.url || item.path || item.href);
        const url = bridgeUrl(link, path);
        if (!url) return null;
        const f = fetcher(injectedFetch);
        if (!f) return null;
        const response = await f(url, {
            method: 'GET',
            headers: Object.assign({ Accept: 'image/*' }, bridgeHeaders(link.auth, false)),
        });
        if (!response.ok || typeof response.blob !== 'function') return null;
        const blob = await response.blob();
        return generatedResult(prompt, blob, {
            provider: 'homepilot-remote',
            width,
            height,
            seed,
        });
    }

    const HomePilotProvider = {
        ID: 'homepilot-remote',
        async ready(deps = {}) {
            const now = Number.isFinite(Number(deps.now)) ? Number(deps.now) : Date.now();
            if (!deps.force && homePilotCheckedAt && now - homePilotCheckedAt < HOMEPILOT_TTL_MS) {
                return this.status();
            }
            if (!homePilotProbe || deps.force) {
                homePilotProbe = homePilotCapability(deps)
                    .then((state) => {
                        homePilotState = state;
                        homePilotCheckedAt = now;
                        return this.status();
                    })
                    .catch(() => {
                        homePilotState = { available: false, reason: 'unreachable' };
                        homePilotCheckedAt = now;
                        return this.status();
                    })
                    .finally(() => {
                        homePilotProbe = null;
                    });
            }
            return homePilotProbe;
        },
        status() {
            const linked = Boolean(bridge());
            return {
                id: this.ID,
                configured: linked,
                available: linked && Boolean(homePilotState.available),
                capabilities: ['image.generate'],
                reason: linked ? homePilotState.reason || 'checking' : 'no-bridge',
            };
        },
        async search(query, options = {}) {
            const q = cleanText(query, 1200);
            const link = options.bridge !== undefined ? options.bridge : bridge(options.storage);
            const f = fetcher(options.fetch);
            if (!q || !link || !link.base || !f) return [];
            const size =
                options.width && options.height
                    ? { width: options.width, height: options.height }
                    : dimensions(options.ratio);
            const seed = Number.isFinite(Number(options.seed))
                ? Math.abs(Math.floor(Number(options.seed)))
                : Math.floor(Math.random() * 1000000);
            const response = await f(`${link.base}${HOMEPILOT_GENERATE_PATH}`, {
                method: 'POST',
                headers: Object.assign({ Accept: 'application/json, image/*' }, bridgeHeaders(link.auth, true)),
                body: JSON.stringify({
                    prompt: q,
                    mode: 'imagine',
                    width: size.width,
                    height: size.height,
                    aspectRatio: options.ratio || '1:1',
                    seed,
                    count: 1,
                }),
            });
            if (!response.ok) throw new Error(`HomePilot image generation failed (${response.status}).`);
            const type = String(response.headers && response.headers.get ? response.headers.get('content-type') : '');
            if (/^image\//i.test(type) && typeof response.blob === 'function') {
                const blob = await response.blob();
                const one = generatedResult(q, blob, {
                    provider: 'homepilot-remote',
                    width: size.width,
                    height: size.height,
                    seed,
                });
                return one ? [one] : [];
            }
            const body = await response.json();
            const items = remoteItems(body).slice(0, 1);
            const results = [];
            for (const item of items) {
                const result = await homePilotResult(
                    q,
                    item,
                    link,
                    { width: size.width, height: size.height, seed },
                    options.fetch
                );
                if (result) results.push(result);
            }
            return results;
        },
    };

    function installDiscoveryGroup() {
        const settings = discoverySettings();
        if (!settings || !Array.isArray(settings.GROUPS)) return false;
        for (const group of [GROUP, GENERATOR_GROUP]) {
            if (!settings.GROUPS.some((item) => item && item.id === group.id)) {
                settings.GROUPS.push(Object.assign({}, group));
            }
        }
        return true;
    }

    function registerProviders() {
        const reg = registry();
        if (!reg || typeof reg.register !== 'function') return false;
        reg.register(PexelsProvider);
        reg.register(PollinationsProvider);
        reg.register(HomePilotProvider);
        return true;
    }

    function namedProvider(id) {
        const reg = registry();
        if (!reg || typeof reg.all !== 'function') return null;
        const row = reg.all().find((item) => item && item.id === id && item.provider);
        return row && row.provider ? row.provider : null;
    }

    function generatorPreference(options = {}) {
        const reg = registry();
        if (options.generatorProvider) return String(options.generatorProvider);
        if (!reg || typeof reg.preferences !== 'function') return 'auto';
        const prefs = reg.preferences(options.storage);
        return (prefs && prefs[GENERATOR_GROUP.id]) || 'auto';
    }

    async function chooseProvider(mode, options = {}) {
        const reg = registry();
        if (!reg) return null;
        if (typeof reg.warm === 'function') await reg.warm({ fetch: options.fetch });
        if (mode === 'ai') {
            const prefer = generatorPreference(options);
            if (typeof reg.forCapability === 'function') {
                return reg.forCapability('image.generate', Object.assign({}, options, { prefer }));
            }
            const ordered =
                prefer && prefer !== 'auto'
                    ? [prefer, 'pollinations', 'homepilot-remote']
                    : ['pollinations', 'homepilot-remote'];
            for (const id of ordered) {
                const provider = namedProvider(id);
                if (provider && provider.status().available) return provider;
            }
            return null;
        }
        if (mode === 'real') {
            const provider = namedProvider('pexels');
            return provider && provider.status().available ? provider : null;
        }
        return typeof reg.forCapability === 'function' ? reg.forCapability('image.search', options) : null;
    }

    async function search(query, options = {}) {
        const mode = options.mode || 'auto';
        const provider = options.provider ? namedProvider(options.provider) : await chooseProvider(mode, options);
        if (!provider || typeof provider.search !== 'function') return [];
        try {
            return await provider.search(query, options);
        } catch (error) {
            if (global && global.console) console.warn('[NEXUS_IMAGE_MEDIA] provider failed:', error);
            return [];
        }
    }

    const LEAD = '(?:(?:can|could|would|will)\\s+you\\s+)?(?:please\\s+)?';
    const IMAGE_NOUN = '(?:images?|pictures?|photos?|photographs?|illustrations?|artwork)';
    const AI_VERB = '(?:generate|create|render|draw|make)';
    const FIND_VERB = '(?:show(?:\\s+me)?|find(?:\\s+me)?|search(?:\\s+for)?|look\\s+up|give\\s+me)';
    const AI_INTENT = new RegExp(
        `^${LEAD}${AI_VERB}\\s+(?:me\\s+)?(?:an?\\s+)?(?:ai[- ]generated\\s+|ai\\s+)?${IMAGE_NOUN}\\s+(?:of|for|showing|with)\\s+(.+)$`,
        'i'
    );
    const REAL_INTENT = new RegExp(
        `^${LEAD}${FIND_VERB}\\s+(?:a\\s+|some\\s+|the\\s+)?(?:real\\s+|stock\\s+)(?:${IMAGE_NOUN})\\s+(?:of|for|showing|with)\\s+(.+)$`,
        'i'
    );
    const GENERIC_INTENT = new RegExp(
        `^${LEAD}${FIND_VERB}\\s+(?:a\\s+|some\\s+|the\\s+)?${IMAGE_NOUN}\\s+(?:of|for|showing|with)\\s+(.+)$`,
        'i'
    );

    function parseIntent(text) {
        const value = cleanText(text, 1400);
        if (!value) return null;
        let match = /^\/(?:aiimage|aipic)\s+(.+)$/i.exec(value);
        if (match) return { query: cleanText(match[1], 1200), mode: 'ai' };
        match = /^\/(?:photo|pexels)\s+(.+)$/i.exec(value);
        if (match) return { query: cleanText(match[1], 240), mode: 'real' };
        match = /^\/(?:image|img|pic)\s+(.+)$/i.exec(value);
        if (match) return { query: cleanText(match[1], 1200), mode: 'auto' };
        match = AI_INTENT.exec(value);
        if (match) return { query: cleanText(match[1], 1200), mode: 'ai' };
        match = REAL_INTENT.exec(value);
        if (match) return { query: cleanText(match[1], 240), mode: 'real' };
        match = GENERIC_INTENT.exec(value);
        if (match) return { query: cleanText(match[1], 1200), mode: 'auto' };
        return null;
    }

    function chatElements(doc) {
        const d = doc || (global && global.document);
        if (!d) return {};
        const liveInput = d.getElementById(LIVE.input);
        const oldInput = d.getElementById(OLD.input);
        return {
            history: d.getElementById(LIVE.history) || d.getElementById(OLD.history),
            input: liveInput || oldInput,
            send: liveInput ? d.getElementById(LIVE.send) : d.getElementById(OLD.send),
        };
    }

    function remember(text, who) {
        if (!global) return false;
        if (global.ChatManager && typeof global.ChatManager.addMessage === 'function') return false;
        const history = global.chatHistory;
        if (!history || typeof history.addMessage !== 'function') return false;
        try {
            history.addMessage(who === 'user' ? 'user' : 'assistant', String(text || ''));
            if (typeof global._persistChat === 'function') global._persistChat();
            return true;
        } catch (_) {
            return false;
        }
    }

    function say(text, who, doc, rememberIt = true) {
        const d = doc || (global && global.document);
        if (!d) return null;
        if (rememberIt) remember(text, who);
        if (global && global.ChatManager && typeof global.ChatManager.addMessage === 'function') {
            global.ChatManager.addMessage(text, who === 'user' ? 'user' : 'bot');
            return null;
        }
        const host = d.getElementById(LIVE.history) || d.getElementById(OLD.history);
        if (!host) return null;
        const empty = host.querySelector('.empty-state');
        if (empty) empty.remove();
        const row = d.createElement('div');
        row.className = 'chat-row';
        const message = d.createElement('div');
        message.className = `chat-message ${who === 'user' ? 'user' : 'avatar'}`;
        const sender = d.createElement('div');
        sender.className = `message-sender ${who === 'user' ? 'user' : 'avatar'}`;
        sender.textContent = who === 'user' ? 'YOU' : 'NEXUS';
        const body = d.createElement('div');
        body.className = 'message-text';
        body.textContent = text;
        message.appendChild(sender);
        message.appendChild(body);
        row.appendChild(message);
        host.appendChild(row);
        host.scrollTop = host.scrollHeight;
        return message;
    }

    function renderResults(message, results, doc) {
        const d = doc || (global && global.document);
        if (!d || !message || !Array.isArray(results) || !results.length) return 0;
        const grid = d.createElement('div');
        grid.className = 'nexus-image-grid';
        for (const item of results) {
            if (!item || !item.url) continue;
            const card = d.createElement('figure');
            card.className = 'nexus-image-card';
            const image = d.createElement('img');
            image.className = 'nexus-image-card-img';
            image.src = item.thumbnail || item.url;
            image.alt = item.alt || item.title || 'Image result';
            image.loading = 'lazy';
            image.decoding = 'async';
            card.appendChild(image);

            const caption = d.createElement('figcaption');
            caption.className = 'nexus-image-caption';
            const title = d.createElement('div');
            title.className = 'nexus-image-title';
            title.textContent = item.title || 'Image';
            caption.appendChild(title);

            const credit = d.createElement('div');
            credit.className = 'nexus-image-credit';
            if (item.provider === 'pexels') {
                credit.appendChild(d.createTextNode(`Photo by ${item.creator || 'a Pexels contributor'} on `));
                const link = d.createElement('a');
                link.href = item.sourceUrl || 'https://www.pexels.com';
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = 'Pexels';
                credit.appendChild(link);
            } else if (item.provider === 'homepilot-remote') {
                credit.textContent = 'AI image · HomePilot Remote';
            } else {
                credit.appendChild(d.createTextNode('AI image · '));
                const link = d.createElement('a');
                link.href = item.sourceUrl || 'https://pollinations.ai';
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = 'Pollinations.ai';
                credit.appendChild(link);
            }
            caption.appendChild(credit);
            card.appendChild(caption);
            grid.appendChild(card);
        }
        if (!grid.children.length) return 0;
        message.appendChild(grid);
        return grid.children.length;
    }

    function unavailableSentence(mode) {
        if (mode === 'ai') {
            return 'No AI image generator is ready. Configure Pollinations on the deployment or connect an OllaBridge that exposes enabled HomePilot Remote image generation, then choose it under Settings → Discovery & Media.';
        }
        if (mode === 'real') {
            return 'Pexels is not configured. Add PEXELS_API_KEY on the deployment or enter your own Pexels key in Settings → Discovery & Media.';
        }
        return 'No image provider is ready. Configure Pexels or an AI image provider in Settings → Discovery & Media.';
    }

    function generatedProvider(provider) {
        if (!provider || typeof provider.status !== 'function') return false;
        try {
            return provider.status().capabilities.includes('image.generate');
        } catch (_) {
            return false;
        }
    }

    async function handleIntent(intent, originalText, doc, options = {}) {
        const d = doc || (global && global.document);
        if (!d || !intent || !intent.query) return false;
        say(originalText, 'user', d, true);
        const provider = await chooseProvider(intent.mode, options);
        if (!provider) {
            say(unavailableSentence(intent.mode), 'bot', d, true);
            return true;
        }
        const isGenerated = generatedProvider(provider);
        const max = isGenerated ? 1 : safeCount(options.max, 4, 8);
        let results = [];
        try {
            results = await provider.search(intent.query, {
                max,
                ratio: options.ratio || '1:1',
                fetch: options.fetch,
            });
        } catch (error) {
            if (global && global.console) console.warn('[NEXUS_IMAGE_MEDIA] request failed:', error);
        }
        if (!results.length) {
            say(
                isGenerated
                    ? 'I could not generate that image right now.'
                    : 'I could not find matching photos right now.',
                'bot',
                d,
                true
            );
            return true;
        }
        let summary;
        if (provider.ID === 'homepilot-remote') {
            summary = 'Here is an AI-generated image from HomePilot Remote.';
        } else if (isGenerated) {
            summary = 'Here is an AI-generated image from Pollinations.ai.';
        } else {
            summary = `Here ${results.length === 1 ? 'is' : 'are'} ${results.length} photo${results.length === 1 ? '' : 's'} from Pexels.`;
        }
        const node = say(summary, 'bot', d, true);
        renderResults(node, results, d);
        return true;
    }

    function intercept(doc) {
        const d = doc || (global && global.document);
        if (!d || d.__nexusImageMediaIntercept) return () => {};
        d.__nexusImageMediaIntercept = true;

        const run = (event) => {
            const elements = chatElements(d);
            if (!elements.input) return false;
            const intent = parseIntent(elements.input.value);
            if (!intent) return false;
            if (event) {
                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
            }
            const original = String(elements.input.value || '').trim();
            elements.input.value = '';
            handleIntent(intent, original, d).catch((error) => {
                if (global && global.console) console.warn('[NEXUS_IMAGE_MEDIA] handler failed:', error);
            });
            return true;
        };

        const elements = chatElements(d);
        const click = (event) => {
            const target = event.target && event.target.closest ? event.target.closest('button') : event.target;
            if (target && elements.send && target === elements.send) run(event);
        };
        const keydown = (event) => {
            if (event.key === 'Enter' && !event.shiftKey && event.target === elements.input) run(event);
        };
        d.addEventListener('click', click, true);
        d.addEventListener('keydown', keydown, true);
        return () => {
            d.removeEventListener('click', click, true);
            d.removeEventListener('keydown', keydown, true);
            delete d.__nexusImageMediaIntercept;
        };
    }

    function injectStyle(doc) {
        const d = doc || (global && global.document);
        if (!d || d.getElementById('nexus-image-media-style')) return;
        const style = d.createElement('style');
        style.id = 'nexus-image-media-style';
        style.textContent = `
            .nexus-image-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; margin-top:10px; }
            .nexus-image-card { margin:0; overflow:hidden; border:1px solid rgba(255,255,255,.10); border-radius:12px; background:rgba(0,0,0,.16); }
            .nexus-image-card-img { display:block; width:100%; aspect-ratio:4/3; object-fit:cover; background:rgba(0,0,0,.2); }
            .nexus-image-caption { padding:8px 9px 9px; }
            .nexus-image-title { font-size:.78rem; line-height:1.25; color:var(--text-primary,#f4f7f8); }
            .nexus-image-credit { margin-top:4px; font-size:.66rem; line-height:1.3; color:var(--text-muted,#8da0a8); }
            .nexus-image-credit a { color:var(--primary,#00e5ff); text-decoration:none; }
            .nexus-image-settings-row { margin-top:10px; }
            .nexus-image-settings-note { margin:6px 2px 0; font-size:.68rem; line-height:1.35; color:rgba(255,255,255,.48); }
        `;
        (d.head || d.documentElement).appendChild(style);
    }

    function installSettingsPanel(doc) {
        const d = doc || (global && global.document);
        if (!d) return null;
        const host = d.getElementById('discovery-providers');
        if (!host || d.getElementById(SETTINGS_PANEL_ID)) return d.getElementById(SETTINGS_PANEL_ID);
        const panel = d.createElement('div');
        panel.id = SETTINGS_PANEL_ID;
        panel.className = 'nexus-image-settings-row';

        const label = d.createElement('label');
        label.className = 'input-label';
        label.htmlFor = 'nexus-image-pexels-key';
        label.textContent = '📷 PEXELS API KEY — OPTIONAL';
        const input = d.createElement('input');
        input.id = 'nexus-image-pexels-key';
        input.className = 'text-input';
        input.type = 'password';
        input.autocomplete = 'off';
        input.placeholder = 'Your Pexels API key (optional; your key takes priority)';
        input.value = pexelsKey();
        const note = d.createElement('p');
        note.className = 'nexus-image-settings-note';
        note.textContent =
            'Image source controls show/find requests; AI image generator controls generate/draw requests. A personal Pexels key uses this app’s same-origin proxy. Pollinations uses POLLINATIONS_API_KEY on the server. HomePilot Remote reuses your existing OllaBridge pairing and never sends HomePilot or bridge credentials to Vercel.';
        input.addEventListener('change', () => {
            setPexelsKey(input.value);
            const settings = discoverySettings();
            if (settings && typeof settings.render === 'function') settings.render(d);
        });
        panel.appendChild(label);
        panel.appendChild(input);
        panel.appendChild(note);
        host.insertAdjacentElement('afterend', panel);
        return panel;
    }

    function mount(doc) {
        if (mounted) return true;
        const d = doc || (global && global.document);
        installDiscoveryGroup();
        registerProviders();
        if (d) {
            injectStyle(d);
            installSettingsPanel(d);
            intercept(d);
            const opener = d.getElementById('settings-btn');
            if (opener) {
                opener.addEventListener('click', () => {
                    installDiscoveryGroup();
                    installSettingsPanel(d);
                    const settings = discoverySettings();
                    if (settings && typeof settings.render === 'function') settings.render(d);
                });
            }
            const settings = discoverySettings();
            if (settings && typeof settings.render === 'function') settings.render(d);
        }
        mounted = true;
        return true;
    }

    function cleanupObjectUrls() {
        const URLImpl = global && global.URL;
        if (!URLImpl || typeof URLImpl.revokeObjectURL !== 'function') return;
        for (const url of objectUrls) {
            try {
                URLImpl.revokeObjectURL(url);
            } catch (_) {}
        }
        objectUrls.clear();
    }

    const api = {
        ROUTE,
        PEXELS_KEY_STORE,
        LLM_SETTINGS_KEY,
        GROUP,
        GENERATOR_GROUP,
        HOMEPILOT_CAPABILITY_PATH,
        HOMEPILOT_GENERATE_PATH,
        RATIO,
        PexelsProvider,
        PollinationsProvider,
        HomePilotProvider,
        dimensions,
        normalizePexels,
        pexelsKey,
        setPexelsKey,
        readBridgeSettings,
        bridge,
        homePilotCapability,
        invalidateHomePilot,
        generatorPreference,
        parseIntent,
        search,
        chooseProvider,
        renderResults,
        installDiscoveryGroup,
        registerProviders,
        installSettingsPanel,
        mount,
        cleanupObjectUrls,
    };

    if (global) {
        global.NEXUS_IMAGE_MEDIA = api;
        if (typeof global.addEventListener === 'function') {
            global.addEventListener('beforeunload', cleanupObjectUrls, { once: true });
        }
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

    if (global && global.document && !global.__NEXUS_IMAGE_PLUGIN_NOAUTO__) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', () => mount());
        } else {
            mount();
        }
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
