(function (global) {
    'use strict';

    /**
     * WF1. Which Wardrobe Forge the page talks to, by default and by choice.
     *
     * Until WF1 a Forge was opt-in: nothing was configured, so the deployment that ships
     * offered the bundled looks and a line saying new ones "need Wardrobe Forge" — while the
     * project's own Forge was running on Hugging Face the whole time, its five library avatars
     * byte-identical to the five this site pins (AvatarIdentity), CORS open to any page and
     * no key required. Every visitor met the feature switched off.
     *
     * So the public Space is now the default, and Settings ▸ Wardrobe Forge lets a person
     * point at their own (a local Forge while developing one, a private Space) or turn it off.
     * The order of authority is deliberate:
     *
     *   1. the page's own `NEXUS_WARDROBE_CONFIG` — a deployment that names a Forge (or says
     *      `forge.enabled: false`) has decided, and Settings shows that rather than override it;
     *   2. the person's stored choice — `wardrobe_forge_mode` of `default`, `custom` or `off`,
     *      with the custom URL in `wardrobe_forge_url` (a URL stored there before WF1, with no
     *      mode beside it, still counts as custom: nobody's endpoint is silently replaced);
     *   3. the default Space.
     *
     * Nothing here fetches anything; Settings tests a connection, this only says where.
     */
    var DEFAULT_FORGE_URL = 'https://ruslanmv-3d-wardrobe-forge.hf.space';
    var MODE_KEY = 'wardrobe_forge_mode';
    var URL_KEY = 'wardrobe_forge_url';
    var MODES = ['default', 'custom', 'off'];

    function read(storage, key) {
        try {
            return storage ? storage.getItem(key) : null;
        } catch (_) {
            return null; // a browser that blocks storage still gets the default
        }
    }

    /**
     * A Forge base URL from what a person typed, or null. http(s) only; the paths people
     * copy from the Forge itself (`/studio/`, `/v1/...`, `/docs`) are taken back to its root.
     */
    function normalizeForgeUrl(text) {
        var raw = String(text || '').trim();
        if (!raw) return null;
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;
        var url;
        try {
            url = new URL(raw);
        } catch (_) {
            return null;
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        if (url.username || url.password) return null; // never a credential in a URL we store
        var path = url.pathname.replace(/\/(studio|docs|v1)(\/.*)?$/i, '').replace(/\/+$/, '');
        return url.origin + path;
    }

    /** The person's choice as stored: {mode, url}. Never throws. */
    function storedForgeChoice(storage) {
        storage = storage === undefined ? global.localStorage : storage;
        var mode = read(storage, MODE_KEY);
        var url = normalizeForgeUrl(read(storage, URL_KEY));
        if (MODES.indexOf(mode) === -1) mode = url ? 'custom' : 'default';
        if (mode === 'custom' && !url) mode = 'default';
        return { mode: mode, url: url };
    }

    /** Store a choice from Settings. `{mode, url}`; answers {ok, why}. */
    function saveForgeChoice(choice, storage) {
        storage = storage === undefined ? global.localStorage : storage;
        choice = choice || {};
        var mode = MODES.indexOf(choice.mode) === -1 ? 'default' : choice.mode;
        var url = null;
        if (mode === 'custom') {
            url = normalizeForgeUrl(choice.url);
            if (!url) return { ok: false, why: 'That is not a web address. Use one like https://my-forge.hf.space' };
        }
        try {
            storage.setItem(MODE_KEY, mode);
            if (url) storage.setItem(URL_KEY, url);
            else if (mode === 'default') storage.removeItem(URL_KEY);
        } catch (error) {
            console.warn('[Wardrobe] the Forge choice could not be stored', error);
            return { ok: false, why: 'This browser would not save the setting.' };
        }
        return { ok: true, why: '' };
    }

    /**
     * Where the Forge comes from: {source: 'site' | 'default' | 'custom' | 'off', url}.
     * `site` means the page's configuration decided and Settings cannot change it.
     */
    function resolveForge(supplied, storage) {
        supplied = supplied || {};
        var forge = supplied.forge && typeof supplied.forge === 'object' ? supplied.forge : null;
        // W11. `forge: {enabled, baseUrl}` names a Forge by URL, not by host: a Hugging Face
        // Space, Cloud Run or localhost all read the same. `forge.enabled: false` means no
        // Forge at all, whatever an older `apiUrl` or a stored URL says. `apiUrl` still works.
        if (forge && forge.enabled === false) return { source: 'site', url: '' };
        var pinned = (forge && forge.baseUrl) || supplied.apiUrl;
        if (pinned) return { source: 'site', url: String(pinned).replace(/\/$/, '') };
        var choice = storedForgeChoice(storage);
        if (choice.mode === 'off') return { source: 'off', url: '' };
        if (choice.mode === 'custom') return { source: 'custom', url: choice.url };
        return { source: 'default', url: DEFAULT_FORGE_URL };
    }

    function readBool(value, fallback) {
        if (value === undefined || value === null || value === '') return fallback;
        if (typeof value === 'boolean') return value;
        return String(value).toLowerCase() === 'true' || String(value) === '1';
    }

    function resolveWardrobeConfig() {
        var supplied = global.NEXUS_WARDROBE_CONFIG || {};
        var storage = null;
        try {
            storage = global.localStorage;
        } catch (_) {
            storage = null; // storage blocked: the page's settings and the default still apply
        }
        var forge = resolveForge(supplied, storage);
        var apiUrl = forge.url;

        return {
            enabled: readBool(
                supplied.enabled !== undefined ? supplied.enabled : read(storage, 'wardrobe_enabled'),
                true
            ),
            staticManifest:
                supplied.staticManifest ||
                read(storage, 'wardrobe_static_manifest') ||
                '/vendor/wardrobe/wardrobe.json',
            apiUrl: String(apiUrl || '').replace(/\/$/, ''),
            // WF1. Where that came from, for Settings: site | default | custom | off.
            forgeSource: forge.source,
            remoteGeneration: readBool(supplied.remoteGeneration, Boolean(apiUrl)),
            // For development against a keyed Forge only. A public page never holds a key: a
            // hosted Forge trusts its pages by origin (Forge F5) or sits behind a proxy (F4).
            token: supplied.token || '',
            // W11. Check a look against its pack's SHA-256 before wearing it.
            verifyLooks: readBool(supplied.verifyLooks, true),
            // W14. Importing wardrobe packs into this browser.
            imports: readBool(supplied.imports, true),
        };
    }

    var api = {
        DEFAULT_FORGE_URL: DEFAULT_FORGE_URL,
        resolveWardrobeConfig: resolveWardrobeConfig,
        resolveForge: resolveForge,
        normalizeForgeUrl: normalizeForgeUrl,
        storedForgeChoice: storedForgeChoice,
        saveForgeChoice: saveForgeChoice,
    };
    global.NEXUS_WARDROBE_CONFIG_API = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
