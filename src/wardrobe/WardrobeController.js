(function (global) {
    'use strict';

    var ClientApi = global.NEXUS_WARDROBE_CLIENT || {};
    var WardrobeForgeError = ClientApi.WardrobeForgeError || Error;

    class WardrobeController {
        constructor(options) {
            options = options || {};
            this.forge = options.forge;
            this.viewer = options.viewer || global.NEXUS_VIEWER || null;
            this.avatarId = options.avatarId || null;
            this.onState = options.onState || null;
            this.original = null;
            this.activeLook = null;
            this.looks = [];
        }

        get avatarManager() {
            return this.viewer && this.viewer.avatarManager ? this.viewer.avatarManager : null;
        }

        _requireManager() {
            var manager = this.avatarManager;
            if (!manager) throw new WardrobeForgeError('AvatarManager is not ready');
            return manager;
        }

        snapshot() {
            var manager = this.avatarManager;
            var current = manager && manager.getCurrent ? manager.getCurrent() : manager && manager.current;
            this.original = current ? Object.assign({}, current) : null;
            if (this.original && !this.avatarId) this.avatarId = this.original.name || 'avatar';
            return this.original;
        }

        async applyLook(look) {
            var url = this.forge.resolveUrl(look && (look.vrmUrl || look.vrm_url));
            if (!url) throw new WardrobeForgeError('look has no vrmUrl');
            var manager = this._requireManager();
            if (!this.original) this.snapshot();
            await manager.setAvatarByUrl(url, look.name || 'Generated look', -1);
            if (manager.frameAvatar) manager.frameAvatar();
            this.activeLook = look;
            return look;
        }

        async restore() {
            if (!this.original || !this.original.url) return false;
            var manager = this._requireManager();
            await manager.setAvatarByUrl(
                this.original.url,
                this.original.name || 'Avatar',
                this.original.index === undefined ? -1 : this.original.index
            );
            if (manager.frameAvatar) manager.frameAvatar();
            this.activeLook = null;
            return true;
        }

        _conditionsForCurrentAvatar() {
            try {
                var installed = JSON.parse(global.localStorage.getItem('vrm_manager_installed') || '{}');
                var currentUrl = this.original && this.original.url;
                var currentFile = currentUrl ? currentUrl.split('/').pop() : '';
                var entries = Object.values(installed);
                for (var i = 0; i < entries.length; i += 1) {
                    var entry = entries[i];
                    if (!entry) continue;
                    if (entry.localFile === currentFile || entry.url === currentUrl) {
                        return entry.conditionsOfUse || null;
                    }
                }
            } catch (_) {
                return null;
            }
            return null;
        }

        async createLook(options) {
            options = options || {};
            if (!this.original) this.snapshot();
            var avatarUrl = this.original && this.original.url;
            if (!avatarUrl) throw new WardrobeForgeError('no avatar is loaded in the viewer');

            var conditions = options.conditionsOfUse || this._conditionsForCurrentAvatar();
            var result = await this.forge.generateAndWait(
                {
                    avatarUrl: avatarUrl,
                    avatarId: this.avatarId || 'avatar',
                    prompt: options.prompt,
                    mode: options.mode || 'auto',
                    templateId: options.templateId || null,
                    engine: options.engine || 'auto',
                    renderPreview: options.renderPreview !== false,
                    conditionsOfUse: conditions,
                    attestModificationAllowed: Boolean(options.attestModificationAllowed),
                },
                {
                    onState: function (state, event) {
                        if (this.onState) this.onState(state, event);
                    }.bind(this),
                }
            );

            var look = result.look;
            this.looks.push(look);
            if (options.apply) await this.applyLook(look);
            return look;
        }

        async getLooks() {
            if (!this.avatarId) this.snapshot();
            if (!this.avatarId) return this.looks.slice();
            return this.forge.getWardrobe(this.avatarId).then(function (manifest) {
                return manifest.looks || [];
            });
        }

        async tryOnHaul(entries, options) {
            options = options || {};
            var holdMs = options.holdMs === undefined ? 4000 : options.holdMs;
            var restoreAtEnd = options.restoreAtEnd !== false;
            var worn = [];

            if (!this.original) this.snapshot();
            for (var i = 0; i < entries.length; i += 1) {
                var entry = entries[i];
                var look = typeof entry === 'string' ? await this.createLook({ prompt: entry }) : entry;
                await this.applyLook(look);
                worn.push(look);
                if (options.onLook) options.onLook(look, i);
                if (holdMs > 0 && i < entries.length - 1) {
                    await new Promise(function (resolve) {
                        global.setTimeout(resolve, holdMs);
                    });
                }
            }
            if (restoreAtEnd) await this.restore();
            return worn;
        }
    }

    global.NEXUS_WARDROBE_CONTROLLER = WardrobeController;
    if (typeof module !== 'undefined' && module.exports) module.exports = WardrobeController;
})(typeof window !== 'undefined' ? window : globalThis);
