(function (global) {
    'use strict';

    /**
     * W2. A forge for a wardrobe with no server behind it.
     *
     * The controller is the only thing in this feature that snapshots the avatar it replaced
     * and puts it back — the house rule is one owner of snapshot-and-restore, not a bespoke
     * undo per caller. It used to be built only when remote generation was configured, so in
     * the default static deployment the service swapped avatars itself, nothing was snapshotted,
     * `restore()` returned false, and the drawer answered "Original avatar restored" anyway.
     * The button did nothing and said it had.
     *
     * So the controller is always built, and without a server it gets this: URLs resolve to
     * themselves (a static look's URL is already absolute — StaticWardrobeSource resolves it
     * against the manifest), and anything that would need the pipeline refuses with the reason.
     * Try-On Haul over the looks already in the bundle needs none of it, and now works.
     */
    var LOCAL_ONLY = 'Remote wardrobe generation is disabled — set a Forge apiUrl to generate looks';

    var LOCAL_FORGE = {
        resolveUrl: function (url) {
            return url || null;
        },
        generateAndWait: function () {
            return Promise.reject(new Error(LOCAL_ONLY));
        },
        getWardrobe: function () {
            return Promise.reject(new Error(LOCAL_ONLY));
        },
    };

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
            this.remoteSource = null;
            this.onState = null;

            var remote = Boolean(this.config.remoteGeneration && this.config.apiUrl);
            var forge = remote
                ? new Client({ baseUrl: this.config.apiUrl, token: this.config.token || '' })
                : LOCAL_FORGE;

            this.controller = new Controller({
                forge: forge,
                viewer: this.viewer,
                onState: function (state, event) {
                    if (this.onState) this.onState(state, event);
                }.bind(this),
            });
            if (remote) this.remoteSource = new RemoteSource({ controller: this.controller });
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

        applyLook(look) {
            return this.controller.applyLook(look);
        }

        /** True when an avatar was put back, false when nothing had been replaced yet. */
        restore() {
            return this.controller.restore();
        }

        generate(prompt, options) {
            if (!this.remoteSource) throw new Error(LOCAL_ONLY);
            return this.remoteSource.generate(prompt, options || {});
        }

        /**
         * Wear a run of looks in turn and come back. Entries are looks, or prompts to generate
         * first — and a prompt is the only part of this that needs a server.
         */
        tryOnHaul(entries, options) {
            return this.controller.tryOnHaul(entries, options || {});
        }
    }

    global.NEXUS_WARDROBE_SERVICE = WardrobeService;
    if (typeof module !== 'undefined' && module.exports) module.exports = WardrobeService;
})(typeof window !== 'undefined' ? window : globalThis);
