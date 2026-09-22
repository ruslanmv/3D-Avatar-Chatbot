(function (global) {
    'use strict';

    async function bootWardrobe() {
        var ConfigApi = global.NEXUS_WARDROBE_CONFIG_API;
        if (!ConfigApi) return;

        var config = ConfigApi.resolveWardrobeConfig();
        if (!config.enabled) return;

        try {
            if (global.__NEXUS_VIEWER_READY__) await global.__NEXUS_VIEWER_READY__;
        } catch (error) {
            console.warn('[Wardrobe] viewer readiness promise failed:', error);
        }

        var viewer = global.NEXUS_VIEWER;
        if (!viewer || !viewer.avatarManager) {
            console.warn('[Wardrobe] AvatarManager unavailable; feature not mounted');
            return;
        }

        var Service = global.NEXUS_WARDROBE_SERVICE;
        var Panel = global.NEXUS_WARDROBE_PANEL;
        var service = new Service({ config: config, viewer: viewer });
        var panel = new Panel({ service: service });
        panel.mount();

        global.NEXUS_WARDROBE = {
            config: config,
            service: service,
            panel: panel,
        };
        console.log('[Wardrobe] ready', {
            staticManifest: config.staticManifest,
            remoteGeneration: service.remoteEnabled,
        });
    }

    if (global.document && global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', bootWardrobe, { once: true });
    } else if (global.document) {
        bootWardrobe();
    }

    var api = { bootWardrobe: bootWardrobe };
    global.NEXUS_WARDROBE_BOOTSTRAP = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
