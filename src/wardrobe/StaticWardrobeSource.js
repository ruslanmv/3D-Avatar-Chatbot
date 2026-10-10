(function (global) {
    'use strict';

    /**
     * The wardrobe this app ships (`vendor/wardrobe/`): always there, offline, no Forge.
     *
     * W11. Its looks go through WardrobePackValidator like any other pack's, so the built-in
     * wardrobe and an imported one become the same normalized look — keyed by pack and
     * avatar, named with its origin ("HomePilot"), and never carrying a field the validator
     * did not choose to keep. Without the validator loaded it lists exactly as it always has.
     */
    class StaticWardrobeSource {
        constructor(options) {
            options = options || {};
            this.manifestUrl = options.manifestUrl || '/vendor/wardrobe/wardrobe.json';
            this.fetchImpl = options.fetchImpl || global.fetch.bind(global);
            this.validator = options.validator || null;
            this._manifest = null;
            this.pack = null;
            this.rejected = [];
        }

        async load(force) {
            if (this._manifest && !force) return this._manifest;
            var response = await this.fetchImpl(this.manifestUrl, { cache: 'no-store' });
            if (!response.ok) throw new Error('Wardrobe manifest fetch failed: ' + response.status);
            this._manifest = await response.json();
            return this._manifest;
        }

        async listLooks() {
            var manifest = await this.load(false);
            var base = new URL(this.manifestUrl, global.location ? global.location.href : 'http://localhost/');
            var validator = this.validator || global.NEXUS_WARDROBE_PACK_VALIDATOR;
            if (validator) {
                var result = validator.validateManifest(manifest, {
                    manifestUrl: base.href,
                    origin: 'builtin',
                    legacySource: 'static',
                    // This repository's own manifest has always been allowed site paths.
                    allowRootPaths: true,
                });
                if (!result.ok) throw new Error('The built-in wardrobe cannot be read: ' + result.reason);
                this.pack = result.pack;
                this.rejected = result.rejected;
                result.rejected.forEach(function (entry) {
                    console.warn('[Wardrobe] built-in look skipped:', entry.id, '—', entry.reason);
                });
                return result.looks;
            }
            return (manifest.looks || [])
                .filter(function (look) {
                    return look && look.vrmUrl;
                })
                .map(function (look) {
                    var copy = Object.assign({}, look, { source: 'static' });
                    copy.vrmUrl = new URL(look.vrmUrl, base).href;
                    if (look.previewUrl) copy.previewUrl = new URL(look.previewUrl, base).href;
                    return copy;
                });
        }
    }

    global.NEXUS_STATIC_WARDROBE_SOURCE = StaticWardrobeSource;
    if (typeof module !== 'undefined' && module.exports) module.exports = StaticWardrobeSource;
})(typeof window !== 'undefined' ? window : globalThis);
