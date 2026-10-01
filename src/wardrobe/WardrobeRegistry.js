/**
 * W11. Where the wardrobe's looks come from, in order, and which of them she may wear now.
 *
 * `WardrobeService.listLooks()` used to merge two arrays — static, then remote — and keep
 * one look per `id`. That was right while the shipped wardrobe was empty. It is wrong the
 * moment a pack carries the same look for five avatars: "crop-top-jeans" exists once per
 * avatar, a merge by id keeps one of them, and the drawer offers another character's file.
 * So looks are keyed by where they came from — `source:pack:avatar:id` — and never merged
 * by a human-readable name.
 *
 * A source is a small adapter, and the UI asks it what it can do instead of asking whether
 * "remote" is on:
 *
 *   { id, label, priority, capabilities: {list, generate}, unratedAs,
 *     available() -> bool, listLooks() -> Promise<look[]>, refresh?() }
 *
 * Priority: built-in (1) ships with the app and works offline; imported (2) is what this
 * browser added; Forge (3) is optional and may be asleep. A source that fails is skipped
 * with a warning — the house rule — so a cold Hugging Face Space never empties the drawer.
 *
 * `unratedAs` is per source because trust is: the built-in pack is this repository's own
 * and a Forge enforces its own gate before it answers, so their unrated looks are general;
 * an imported pack is untrusted, and its unrated looks are gated like swimwear.
 *
 * Exposes window.NEXUS_WARDROBE_REGISTRY.
 */
(function (global) {
    'use strict';

    class WardrobeRegistry {
        constructor(options) {
            options = options || {};
            this.validator = options.validator || global.NEXUS_WARDROBE_PACK_VALIDATOR || null;
            this._sources = [];
        }

        /** Add or replace a source (by id). */
        add(source) {
            if (!source || !source.id || typeof source.listLooks !== 'function') {
                throw new Error('a wardrobe source needs an id and listLooks()');
            }
            this._sources = this._sources.filter((existing) => existing.id !== source.id);
            this._sources.push(source);
            this._sources.sort((a, b) => (a.priority || 99) - (b.priority || 99));
            return source;
        }

        remove(id) {
            this._sources = this._sources.filter((source) => source.id !== id);
        }

        sources() {
            return this._sources.slice();
        }

        /** Can any source that is available right now do `capability`? */
        can(capability) {
            return this._sources.some(
                (source) =>
                    source.capabilities &&
                    source.capabilities[capability] &&
                    (typeof source.available !== 'function' || source.available())
            );
        }

        /**
         * Every look she may wear, in source order, plus what was hidden and why.
         *
         *   context   {identity, privateOpen} — see WardrobePackValidator.visibility. Omitted,
         *             nothing is filtered (tests and tools that want the raw list).
         *
         * Answers {looks, hidden: [{look, reason}], errors: [{source, error}]}.
         */
        async list(context) {
            var looks = [];
            var hidden = [];
            var errors = [];
            var seen = new Set();
            for (var i = 0; i < this._sources.length; i += 1) {
                var source = this._sources[i];
                if (typeof source.available === 'function' && !source.available()) continue;
                var found;
                try {
                    found = (await source.listLooks()) || [];
                } catch (error) {
                    console.warn('[Wardrobe] ' + (source.label || source.id) + ' unavailable:', error);
                    errors.push({ source: source.id, error: error });
                    continue;
                }
                found.forEach((look) => {
                    if (!look || !look.vrmUrl) return;
                    var key = look.key || source.id + ':' + (look.id || look.vrmUrl);
                    if (seen.has(key)) return;
                    seen.add(key);
                    var entry = look.key ? look : Object.assign({}, look, { key: key });
                    if (context && this.validator) {
                        var verdict = this.validator.visibility(entry, {
                            identity: context.identity,
                            privateOpen: context.privateOpen === true,
                            unratedAs: source.unratedAs || 'swimwear',
                        });
                        if (!verdict.visible) {
                            hidden.push({ look: entry, reason: verdict.reason });
                            return;
                        }
                    }
                    looks.push(entry);
                });
            }
            return { looks: looks, hidden: hidden, errors: errors };
        }
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = WardrobeRegistry;
    if (global) global.NEXUS_WARDROBE_REGISTRY = WardrobeRegistry;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
