/**
 * Consumer-facing credential adapter for image providers.
 *
 * ImagePlugin owns transport and rendering. This file owns the browser-side credential
 * preferences and the standalone Discovery & Media bootstrap. The settings surface must not
 * depend on Behavior Director being enabled.
 *
 * Exposes extra methods on window.NEXUS_IMAGE_MEDIA:
 *   pollinationsKey(), setPollinationsKey(), credentialStatus(providerId),
 *   bootstrapDiscoverySettings()
 */
(function (global) {
    'use strict';

    if (!global || !global.NEXUS_IMAGE_MEDIA) return;

    const Images = global.NEXUS_IMAGE_MEDIA;
    const POLLINATIONS_KEY_STORE = 'nexus.images.pollinationsApiKey';
    const localObjectUrls = new Set();
    let discoveryBootstrapPromise = null;

    const CAPABILITY_GROUPS = [
        { id: 'image', label: 'Image search', capability: 'image.search' },
        { id: 'video', label: 'Video search', capability: 'video.search' },
        { id: 'music', label: 'Music search', capability: 'music.search' },
        { id: 'imageGenerator', label: 'Image generation', capability: 'image.generate' },
    ];

    const DISCOVERY_CORE = [
        { src: 'src/features/research/ResearchSource.js', ready: () => Boolean(global.NEXUS_RESEARCH_SOURCE) },
        { src: 'src/features/research/WebSearchSettings.js', ready: () => Boolean(global.NEXUS_WEB_SEARCH_SETTINGS) },
        { src: 'src/features/research/providers/websearch.js', ready: () => Boolean(global.NEXUS_RESEARCH_WEB) },
        { src: 'src/features/discovery/MediaResult.js', ready: () => Boolean(global.NEXUS_MEDIA_RESULT) },
        {
            src: 'src/features/discovery/providers/youtube.js',
            ready: () => Boolean(global.NEXUS_DISCOVERY_YOUTUBE),
        },
        { src: 'src/features/discovery/ProviderRegistry.js', ready: () => Boolean(global.NEXUS_DISCOVERY) },
    ];

    function storage(injected) {
        if (injected !== undefined) return injected;
        try {
            return global.localStorage || null;
        } catch (_) {
            return null;
        }
    }

    function get(name, injected) {
        const s = storage(injected);
        if (!s) return '';
        try {
            return String(s.getItem(name) || '').trim();
        } catch (_) {
            return '';
        }
    }

    function put(name, value, injected) {
        const s = storage(injected);
        if (!s) return false;
        const clean = String(value || '').trim();
        try {
            if (clean) s.setItem(name, clean);
            else s.removeItem(name);
            return true;
        } catch (_) {
            return false;
        }
    }

    function pollinationsKey(injected) {
        return get(POLLINATIONS_KEY_STORE, injected);
    }

    function setPollinationsKey(value, injected) {
        put(POLLINATIONS_KEY_STORE, value, injected);
        return pollinationsKey(injected);
    }

    function preferences(injected) {
        const reg = global.NEXUS_DISCOVERY;
        if (!reg || typeof reg.preferences !== 'function') return {};
        try {
            return reg.preferences(injected) || {};
        } catch (_) {
            return {};
        }
    }

    function imagePreference(group, injected) {
        return String(preferences(injected)[group] || 'auto');
    }

    function credentialStatus(providerId, injected) {
        if (providerId === 'pexels') {
            return {
                supportsOwnKey: true,
                hasOwnKey: Boolean(Images.pexelsKey && Images.pexelsKey()),
            };
        }
        if (providerId === 'pollinations') {
            return {
                supportsOwnKey: true,
                hasOwnKey: Boolean(pollinationsKey(injected)),
            };
        }
        return { supportsOwnKey: false, hasOwnKey: false };
    }

    function dimensions(options) {
        if (options && options.width && options.height) {
            return { width: Number(options.width), height: Number(options.height) };
        }
        return typeof Images.dimensions === 'function'
            ? Images.dimensions(options && options.ratio)
            : { width: 1024, height: 1024 };
    }

    function fetcher(injected) {
        if (typeof injected === 'function') return injected;
        return typeof global.fetch === 'function' ? global.fetch.bind(global) : null;
    }

    function createGeneratedResult(prompt, blob, options) {
        const URLImpl = global.URL;
        if (!blob || !URLImpl || typeof URLImpl.createObjectURL !== 'function') return null;
        const url = URLImpl.createObjectURL(blob);
        localObjectUrls.add(url);
        return {
            id: `pollinations-${options.seed || Date.now()}`,
            provider: 'pollinations',
            kind: 'image',
            type: 'ai',
            title: String(prompt || '')
                .trim()
                .slice(0, 220),
            creator: 'Pollinations.ai',
            alt: `AI-generated image: ${String(prompt || '').trim()}`.slice(0, 300),
            width: options.width || null,
            height: options.height || null,
            url,
            thumbnail: url,
            sourceUrl: 'https://pollinations.ai',
        };
    }

    // Explicit Pexels means personal-key mode. Auto remains free to use deployment readiness.
    if (Images.PexelsProvider && !Images.PexelsProvider.__nexusCredentialAdapter) {
        const originalStatus = Images.PexelsProvider.status.bind(Images.PexelsProvider);
        Images.PexelsProvider.credentialStatus = (injected) => credentialStatus('pexels', injected);
        Images.PexelsProvider.status = function status() {
            const base = originalStatus();
            const pref = imagePreference('image');
            const own = credentialStatus('pexels').hasOwnKey;
            if (pref === 'disabled') {
                return Object.assign({}, base, {
                    configured: false,
                    available: false,
                    capabilities: ['image.search'],
                    reason: 'disabled',
                });
            }
            if (pref === 'pexels' && !own) {
                return Object.assign({}, base, {
                    configured: false,
                    available: false,
                    capabilities: ['image.search'],
                    reason: 'no-key',
                });
            }
            return base;
        };
        Images.PexelsProvider.__nexusCredentialAdapter = true;
    }

    if (Images.PollinationsProvider && !Images.PollinationsProvider.__nexusCredentialAdapter) {
        const originalStatus = Images.PollinationsProvider.status.bind(Images.PollinationsProvider);
        const originalSearch = Images.PollinationsProvider.search.bind(Images.PollinationsProvider);

        Images.PollinationsProvider.credentialStatus = (injected) => credentialStatus('pollinations', injected);

        Images.PollinationsProvider.status = function status() {
            const base = originalStatus();
            const pref = imagePreference('imageGenerator');
            const own = Boolean(pollinationsKey());
            const shaped = Object.assign({}, base, { capabilities: ['image.generate'] });
            if (pref === 'disabled') {
                return Object.assign({}, shaped, {
                    configured: false,
                    available: false,
                    reason: 'disabled',
                });
            }
            if (pref === 'pollinations' && !own) {
                return Object.assign({}, shaped, {
                    configured: false,
                    available: false,
                    reason: 'no-key',
                });
            }
            if (own) {
                return Object.assign({}, shaped, {
                    configured: true,
                    available: true,
                    reason: 'ok',
                });
            }
            return shaped;
        };

        Images.PollinationsProvider.search = async function search(query, options = {}) {
            const key = pollinationsKey(options.storage);
            if (!key) return originalSearch(query, options);
            if (imagePreference('imageGenerator', options.storage) === 'disabled') return [];

            const prompt = String(query || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 1200);
            if (!prompt) return [];
            const f = fetcher(options.fetch);
            if (!f) return [];
            const size = dimensions(options);
            const seed = Number.isFinite(Number(options.seed))
                ? Math.abs(Math.floor(Number(options.seed)))
                : Math.floor(Math.random() * 1000000);

            const response = await f(Images.ROUTE || '/api/images/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'image/*',
                    'X-Nexus-Pollinations-Key': key,
                },
                body: JSON.stringify({
                    provider: 'pollinations',
                    prompt,
                    width: size.width,
                    height: size.height,
                    seed,
                }),
            });
            if (!response || !response.ok) {
                throw new Error(`AI image generation failed (${response ? response.status : 'network'}).`);
            }
            const blob = await response.blob();
            const result = createGeneratedResult(prompt, blob, {
                width: size.width,
                height: size.height,
                seed,
            });
            return result ? [result] : [];
        };

        Images.PollinationsProvider.__nexusCredentialAdapter = true;
    }

    // HomePilot Remote reuses the OllaBridge credential; it does not expose another key field.
    if (Images.HomePilotProvider && !Images.HomePilotProvider.__nexusCredentialAdapter) {
        Images.HomePilotProvider.credentialStatus = () => ({ supportsOwnKey: true, hasOwnKey: true });
        Images.HomePilotProvider.__nexusCredentialAdapter = true;
    }

    function cleanup() {
        const URLImpl = global.URL;
        if (!URLImpl || typeof URLImpl.revokeObjectURL !== 'function') return;
        for (const url of localObjectUrls) {
            try {
                URLImpl.revokeObjectURL(url);
            } catch (_) {}
        }
        localObjectUrls.clear();
    }

    function settings() {
        return global.NEXUS_DISCOVERY_SETTINGS || null;
    }

    function hideLegacySettings(doc) {
        const d = doc || global.document;
        if (!d) return;
        for (const id of ['yt-api-key', 'web-search-provider', 'web-search-key']) {
            const node = d.getElementById(id);
            const row = node && node.closest ? node.closest('.input-group') : null;
            if (row && !row.contains(d.getElementById('discovery-providers'))) row.style.display = 'none';
        }
        const oldImage = d.getElementById('nexus-image-settings');
        if (oldImage) oldImage.style.display = 'none';
    }

    function enforceCapabilityOrder() {
        const Settings = settings();
        if (!Settings || !Array.isArray(Settings.GROUPS)) return false;
        Settings.GROUPS.splice(
            0,
            Settings.GROUPS.length,
            ...CAPABILITY_GROUPS.map((group) => Object.assign({}, group))
        );
        return true;
    }

    function ensureScript(doc, item) {
        if (item.ready()) return Promise.resolve(true);
        const existing = [...doc.querySelectorAll('script[src]')].find(
            (script) => script.getAttribute('src') === item.src
        );
        if (existing) {
            return new Promise((resolve) => {
                if (item.ready()) return resolve(true);
                const finish = () => resolve(Boolean(item.ready()));
                existing.addEventListener('load', finish, { once: true });
                existing.addEventListener('error', finish, { once: true });
                global.setTimeout(finish, 10000);
            });
        }

        return new Promise((resolve) => {
            const script = doc.createElement('script');
            script.src = item.src;
            script.defer = true;
            script.dataset.nexusDiscoveryCore = '1';
            script.addEventListener('load', () => resolve(Boolean(item.ready())), { once: true });
            script.addEventListener('error', () => {
                if (global.console) global.console.warn(`[ImageProviderSettings] Could not load ${item.src}.`);
                resolve(false);
            });
            (doc.head || doc.documentElement).appendChild(script);
        });
    }

    /**
     * The settings UI is a normal-page capability, not a Behavior Director capability.
     * Load the small discovery stack in order, then register image providers and repaint.
     */
    function bootstrapDiscoverySettings(doc) {
        const d = doc || global.document;
        if (!d) return Promise.resolve(false);
        if (discoveryBootstrapPromise) return discoveryBootstrapPromise;

        hideLegacySettings(d);
        enforceCapabilityOrder();
        const host = d.getElementById('discovery-providers');
        if (host && !global.NEXUS_DISCOVERY) {
            host.textContent = 'Loading discovery & media settings…';
        }

        discoveryBootstrapPromise = DISCOVERY_CORE.reduce(
            (chain, item) => chain.then(() => ensureScript(d, item)),
            Promise.resolve(true)
        ).then(() => {
            const reg = global.NEXUS_DISCOVERY;
            if (reg && typeof reg.register === 'function' && global.NEXUS_DISCOVERY_YOUTUBE) {
                reg.register(global.NEXUS_DISCOVERY_YOUTUBE);
            }
            if (typeof Images.installDiscoveryGroup === 'function') Images.installDiscoveryGroup();
            if (typeof Images.registerProviders === 'function') Images.registerProviders();
            enforceCapabilityOrder();
            hideLegacySettings(d);
            const Settings = settings();
            if (Settings && typeof Settings.render === 'function') Settings.render(d);
            if (!global.NEXUS_DISCOVERY) discoveryBootstrapPromise = null;
            return Boolean(global.NEXUS_DISCOVERY);
        });
        return discoveryBootstrapPromise;
    }

    Images.POLLINATIONS_KEY_STORE = POLLINATIONS_KEY_STORE;
    Images.pollinationsKey = pollinationsKey;
    Images.setPollinationsKey = setPollinationsKey;
    Images.credentialStatus = credentialStatus;
    Images.DISCOVERY_CORE = DISCOVERY_CORE;
    Images.CAPABILITY_GROUPS = CAPABILITY_GROUPS;
    Images.bootstrapDiscoverySettings = bootstrapDiscoverySettings;

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('beforeunload', cleanup, { once: true });
    }

    // Keep legacy credential owners alive but invisible. Their detached SAVE listeners would
    // otherwise be able to overwrite a newly entered key, so hide rather than delete them.
    if (global.document && !global.document.getElementById('nexus-image-provider-settings-style')) {
        const style = global.document.createElement('style');
        style.id = 'nexus-image-provider-settings-style';
        style.textContent = `
            #nexus-image-settings{display:none!important}
            #yt-api-key{visibility:hidden!important}
        `;
        (global.document.head || global.document.documentElement).appendChild(style);
    }

    enforceCapabilityOrder();
    hideLegacySettings(global.document);

    const isCommonJs = typeof module !== 'undefined' && module.exports;
    if (global.document && !isCommonJs) {
        bootstrapDiscoverySettings(global.document);
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
