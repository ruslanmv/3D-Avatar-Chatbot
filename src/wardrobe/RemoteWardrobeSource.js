(function (global) {
    'use strict';

    class RemoteWardrobeSource {
        constructor(options) {
            options = options || {};
            this.controller = options.controller;
        }

        async listLooks() {
            if (!this.controller) return [];
            try {
                var looks = await this.controller.getLooks();
                return (looks || []).filter(function (look) {
                    return look && look.vrmUrl;
                }).map(function (look) {
                    return Object.assign({}, look, { source: 'remote' });
                });
            } catch (error) {
                if (error && error.status === 404) return [];
                throw error;
            }
        }

        generate(prompt, options) {
            if (!this.controller) throw new Error('Remote wardrobe is not configured');
            return this.controller.createLook(Object.assign({ prompt: prompt }, options || {}));
        }
    }

    global.NEXUS_REMOTE_WARDROBE_SOURCE = RemoteWardrobeSource;
    if (typeof module !== 'undefined' && module.exports) module.exports = RemoteWardrobeSource;
})(typeof window !== 'undefined' ? window : globalThis);
