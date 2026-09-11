/**
 * Consumer-facing credential adapter for image providers.
 *
 * ImagePlugin owns transport and rendering. This file owns only the browser-side
 * credential preference that Settings needs in order to offer the same grammar as
 * YouTube/Web search:
 *
 *   Auto — recommended
 *   Provider — my own key
 *   Disabled
 *
 * Pexels already has a personal-key path in ImagePlugin. Pollinations already accepts
 * a one-request personal key in the same-origin serverless gateway, but the original
 * plugin intentionally had no browser field for it. This adapter connects those two
 * pieces without putting a key in a URL or committing one to the repository.
 *
 * Exposes extra methods on window.NEXUS_IMAGE_MEDIA:
 *   pollinationsKey(), setPollinationsKey(), credentialStatus(providerId)
 */
(function (global) {
    'use strict';

    if (!global || !global.NEXUS_IMAGE_MEDIA) return;

    const Images = global.NEXUS_IMAGE_MEDIA;
    const POLLINATIONS_KEY_STORE = 'nexus.images.pollinationsApiKey';
    const localObjectUrls = new Set();

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
            title: String(prompt || '').trim().slice(0, 220),
            creator: 'Pollinations.ai',
            alt: `AI-generated image: ${String(prompt || '').trim()}`.slice(0, 300),
            width: options.width || null,
            height: options.height || null,
            url,
            thumbnail: url,
            sourceUrl: 'https://pollinations.ai',
        };
    }

    // Pexels already knows how to use a personal key. The only extra rule needed is that an
    // explicit "Pexels — my own key" preference is strict. If the key is missing, a real-photo
    // request must not silently spend the deployment key.
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
            // Pollinations creates images; it is not an "existing image search" provider.
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

    // HomePilot Remote does not expose a new key field: it reuses the user's already-owned
    // OllaBridge credential. Marking that credential as present makes an explicit HomePilot
    // preference strict in ProviderRegistry. If the bridge/HomePilot capability is unavailable,
    // generation reports that state instead of silently falling back to Pollinations. Auto is
    // still free to choose Pollinations when HomePilot is offline.
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

    Images.POLLINATIONS_KEY_STORE = POLLINATIONS_KEY_STORE;
    Images.pollinationsKey = pollinationsKey;
    Images.setPollinationsKey = setPollinationsKey;
    Images.credentialStatus = credentialStatus;

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('beforeunload', cleanup, { once: true });
    }

    // The old image plugin inserted a dedicated Pexels block after Discovery & Media. The new
    // capability-first Settings renderer owns credentials, so keep the legacy block harmless
    // without changing ImagePlugin's transport code.
    if (global.document && !global.document.getElementById('nexus-image-provider-settings-style')) {
        const style = global.document.createElement('style');
        style.id = 'nexus-image-provider-settings-style';
        style.textContent = '#nexus-image-settings{display:none!important}';
        (global.document.head || global.document.documentElement).appendChild(style);
    }

    const settings = global.NEXUS_DISCOVERY_SETTINGS;
    if (settings && typeof settings.render === 'function' && global.document) {
        settings.render(global.document);
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
