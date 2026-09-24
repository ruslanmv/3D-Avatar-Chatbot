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
        var apiUrl = supplied.apiUrl || (storage && storage.getItem('wardrobe_forge_url')) || '';

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
            token: supplied.token || '',
        };
    }

    var api = { resolveWardrobeConfig: resolveWardrobeConfig };
    global.NEXUS_WARDROBE_CONFIG_API = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
