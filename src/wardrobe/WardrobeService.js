(function (global) {
    'use strict';

    class WardrobeService {
        constructor(options) {
            options = options || {};
            this.config = options.config || {};
            this.viewer = options.viewer || global.NEXUS_VIEWER || null;

            var Client = global.NEXUS_WARDROBE_CLIENT && global.NEXUS_WARDROBE_CLIENT.WardrobeClient;
            var Controller = global.NEXUS_WARDROBE_CONTROLLER;
            var StaticSource = global.NEXUS_STATIC_WARDROBE_SOURCE;
            var RemoteSource = global.NEXUS_REMOTE_WARDROBE_SOURCE;

            this.staticSource = new StaticSource({ manifestUrl: this.config.staticManifest });
            this.controller = null;
            this.remoteSource = null;

            if (this.config.remoteGeneration && this.config.apiUrl) {
                var client = new Client({ baseUrl: this.config.apiUrl, token: this.config.token || '' });
                this.controller = new Controller({
                    forge: client,
                    viewer: this.viewer,
                    onState: function (state, event) {
                        if (this.onState) this.onState(state, event);
                    }.bind(this),
                });
                this.remoteSource = new RemoteSource({ controller: this.controller });
            }
            this.onState = null;
        }

        setStateListener(listener) {
            this.onState = listener || null;
        }

        get remoteEnabled() {
            return Boolean(this.remoteSource);
        }

        async listLooks() {
            var lists = [];
            try {
                lists.push(await this.staticSource.listLooks());
            } catch (error) {
                console.warn('[Wardrobe] static wardrobe unavailable:', error);
                lists.push([]);
            }
            if (this.remoteSource) {
                try {
                    lists.push(await this.remoteSource.listLooks());
                } catch (error) {
                    console.warn('[Wardrobe] remote wardrobe unavailable:', error);
                    lists.push([]);
                }
            }

            var byId = new Map();
            lists.flat().forEach(function (look) {
                var key = look.id || look.vrmUrl;
                if (key) byId.set(key, look);
            });
            return Array.from(byId.values());
        }

        async applyLook(look) {
            if (this.controller) return this.controller.applyLook(look);
            var manager = this.viewer && this.viewer.avatarManager;
            if (!manager) throw new Error('AvatarManager is not ready');
            await manager.setAvatarByUrl(look.vrmUrl, look.name || 'Wardrobe look', -1);
            if (manager.frameAvatar) manager.frameAvatar();
            return look;
        }

        restore() {
            if (!this.controller) return Promise.resolve(false);
            return this.controller.restore();
        }

        generate(prompt, options) {
            if (!this.remoteSource) throw new Error('Remote wardrobe generation is disabled');
            return this.remoteSource.generate(prompt, options || {});
        }

        tryOnHaul(entries, options) {
            if (!this.controller) throw new Error('Try-On Haul requires the remote wardrobe controller');
            return this.controller.tryOnHaul(entries, options || {});
        }
    }

    global.NEXUS_WARDROBE_SERVICE = WardrobeService;
    if (typeof module !== 'undefined' && module.exports) module.exports = WardrobeService;
})(typeof window !== 'undefined' ? window : globalThis);
