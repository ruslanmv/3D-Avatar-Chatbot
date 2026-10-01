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
            this.importer = null;
            this.importedSource = null;
            this.onState = null;

            var remote = Boolean(this.config.remoteGeneration && this.config.apiUrl);
            var forge = remote
                ? new Client({ baseUrl: this.config.apiUrl, token: this.config.token || '' })
                : LOCAL_FORGE;

            // W11. A look whose pack names its SHA-256 is downloaded and checked before the
            // loader sees it. Off only when a deployment says so (`verifyLooks: false`).
            var Validator = global.NEXUS_WARDROBE_PACK_VALIDATOR;
            var verifyLook =
                Validator && this.config.verifyLooks !== false
                    ? function (look) {
                          return Validator.fetchVerified(look);
                      }
                    : null;

            this.controller = new Controller({
                forge: forge,
                viewer: this.viewer,
                verifyLook: verifyLook,
                onState: function (state, event) {
                    if (this.onState) this.onState(state, event);
                }.bind(this),
            });
            if (remote) this.remoteSource = new RemoteSource({ controller: this.controller });

            // W11. Sources in order: what ships, then (later) what was imported, then Forge.
            // Without the registry loaded, listLooks() behaves exactly as before it existed.
            var Registry = global.NEXUS_WARDROBE_REGISTRY;
            this.registry = Registry ? new Registry() : null;
            if (this.registry) {
                var staticSource = this.staticSource;
                this.registry.add({
                    id: 'builtin',
                    label: 'HomePilot',
                    priority: 1,
                    capabilities: { list: true, generate: false },
                    unratedAs: 'general', // this repository's own pack
                    listLooks: function () {
                        return staticSource.listLooks();
                    },
                });
                // W14. Packs imported in this browser (IndexedDB). Untrusted: unrated looks
                // are gated, and a private pack only imports while private mode is on.
                var Importer = global.NEXUS_WARDROBE_IMPORTER;
                if (Importer && this.config.imports !== false) {
                    this.importer = new Importer.WardrobeImporter({
                        privateOn: function () {
                            var gate = global.NEXUS_SPICY;
                            try {
                                return Boolean(gate && typeof gate.isEnabled === 'function' && gate.isEnabled());
                            } catch (_) {
                                return false;
                            }
                        },
                    });
                    this.importedSource = this.importer.source;
                    var importedSource = this.importedSource;
                    this.registry.add({
                        id: 'imported',
                        label: 'Imported',
                        priority: 2,
                        capabilities: { list: true, generate: false },
                        unratedAs: 'swimwear',
                        listLooks: function () {
                            return importedSource.listLooks();
                        },
                    });
                }
                if (this.remoteSource) {
                    var remoteSource = this.remoteSource;
                    this.registry.add({
                        id: 'forge',
                        label: 'Created',
                        priority: 3,
                        capabilities: { list: true, generate: true },
                        unratedAs: 'general', // Forge gates on its side and hides private looks
                        listLooks: async function () {
                            return (await remoteSource.listLooks()).map(function (look) {
                                return Object.assign({}, look, {
                                    key: 'forge:' + (look.id || look.vrmUrl),
                                    origin: 'forge',
                                    sourceLabel: 'Created',
                                });
                            });
                        },
                    });
                }
            }
        }

        /**
         * Who she is right now, for choosing her looks: the avatar the controller snapshotted
         * (never a look she is wearing), else the one loaded. `privateOpen` is false here —
         * the drawer offers no private looks; Try-On asks TryOnPrivate itself.
         */
        context() {
            var Identity = global.NEXUS_AVATAR_IDENTITY;
            var manager = this.viewer && this.viewer.avatarManager;
            var original = this.controller.original;
            if (!original && manager && typeof manager.getCurrent === 'function') original = manager.getCurrent();
            var identity = Identity && original ? Identity.resolve(original) : null;
            return { identity: identity, privateOpen: false };
        }

        setStateListener(listener) {
            this.onState = listener || null;
        }

        get remoteEnabled() {
            return Boolean(this.remoteSource);
        }

        /**
         * Her looks. W11: through the registry — keyed by source, pack and avatar, and only the
         * ones made for the avatar she is (`context`, default `this.context()`).
         */
        async listLooks(context) {
            if (this.registry) {
                return (await this.registry.list(context === undefined ? this.context() : context)).looks;
            }
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
