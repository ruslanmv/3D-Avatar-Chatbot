(function (global) {
    'use strict';

    function readBool(value, fallback) {
        if (value === undefined || value === null || value === '') return fallback;
        if (typeof value === 'boolean') return value;
        return String(value).toLowerCase() === 'true' || String(value) === '1';
    }

    function resolveWardrobeConfig() {
        var supplied = global.NEXUS_WARDROBE_CONFIG || {};
        var storage = global.localStorage;
        // W11. `forge: {enabled, baseUrl}` names a Forge by URL, not by host: a Hugging Face
        // Space, Cloud Run or localhost all read the same. `forge.enabled: false` means no
        // Forge at all, whatever an older `apiUrl` or a stored URL says. `apiUrl` still works.
        var forge = supplied.forge && typeof supplied.forge === 'object' ? supplied.forge : null;
        var apiUrl =
            forge && forge.enabled === false
                ? ''
                : (forge && forge.baseUrl) ||
                  supplied.apiUrl ||
                  (storage && storage.getItem('wardrobe_forge_url')) ||
                  '';

        return {
            enabled: readBool(
                supplied.enabled !== undefined ? supplied.enabled : storage && storage.getItem('wardrobe_enabled'),
                true
            ),
            staticManifest:
                supplied.staticManifest ||
                (storage && storage.getItem('wardrobe_static_manifest')) ||
                '/vendor/wardrobe/wardrobe.json',
            apiUrl: String(apiUrl || '').replace(/\/$/, ''),
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

    var api = { resolveWardrobeConfig: resolveWardrobeConfig };
    global.NEXUS_WARDROBE_CONFIG_API = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
