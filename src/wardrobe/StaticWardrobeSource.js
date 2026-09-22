(function (global) {
    'use strict';

    class StaticWardrobeSource {
        constructor(options) {
            options = options || {};
            this.manifestUrl = options.manifestUrl || '/vendor/wardrobe/wardrobe.json';
            this.fetchImpl = options.fetchImpl || global.fetch.bind(global);
            this._manifest = null;
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
