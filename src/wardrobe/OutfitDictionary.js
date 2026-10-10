/**
 * W15. The outfit dictionary: what she can be dressed in, by name, and who may see it.
 *
 * Two things ask "what can she wear?" — the person, in Try-On or in the chat, and the
 * companion, who has to answer it truthfully and then make it happen. Neither can guess.
 * A companion that offers "a leather jacket with a hood" is promising something Forge's
 * planner turns into `no_garment_template_matched`; a list that puts a lingerie set among
 * the casual looks is a list that ignores the gate. Both answers belong to Forge, which
 * publishes them at `GET /v1/outfits` (Forge OD1): named sets, each planned by Forge's own
 * planner, each `rating`ed by Forge's own adult gate. This module reads that, and nothing
 * here writes a rating.
 *
 * - **Forge first, then the snapshot.** The Forge the page is pointed at answers; if it
 *   cannot (offline, asleep, an older Forge without the route) the snapshot this repository
 *   ships in `assets/wardrobe/outfits.json` answers instead — the same catalogue, exported
 *   from Forge, so the companion still knows the vocabulary while the Space wakes.
 * - **Private is hidden, not merely labelled.** `entries({privateOpen})` leaves out every
 *   entry that is private by its own rating *or* by its group's claim, unless TryOnPrivate
 *   has said `open` for her (private mode on, and her avatar declared adult by Forge's
 *   operator). Either flag is enough to hide: a custom Forge that marked a lingerie group
 *   general would still have it hidden by the group, and vice versa. Forge refuses the job
 *   on its side anyway; this is the half that keeps the offer honest.
 * - **Tattoos are private too.** Forge's body-art catalogue (`GET /v1/body-art`) is only
 *   offered when private outfits are open — the product's choice, stricter than Forge's.
 *   PT1: `load()` waits for it, so Try-On's Private tab is drawn with its Tattoos section
 *   (it used to arrive after the one render that followed the load, and the section was
 *   simply never there); and `assets/wardrobe/body-art.json` answers when the Forge cannot,
 *   as the outfit snapshot does. Each design carries its picture's URL on the Forge
 *   (`GET /v1/body-art/designs/{id}.png`) when there is a Forge to ask.
 * - **Validated on the way in.** Ids are words, titles are short, prompts are bounded; an
 *   entry that is not is dropped with a warning, so nothing odd reaches the companion's
 *   prompt or a job.
 *
 * Exposes: window.NEXUS_OUTFIT_DICTIONARY
 */
(function (global) {
    'use strict';

    var SNAPSHOT_URL = 'assets/wardrobe/outfits.json';
    var BODY_ART_SNAPSHOT_URL = 'assets/wardrobe/body-art.json';
    var MAX_DESCRIPTION = 160;
    var RATING = /^(general|swimwear|underwear|private)$/;
    var ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
    var MAX_TITLE = 60;
    var MAX_PROMPT = 300;

    function cleanText(value, max) {
        return String(value == null ? '' : value)
            .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max);
    }

    /** A catalogue as Forge (or the snapshot) sent it → {groups, outfits}, or null if unusable. */
    function normalize(raw) {
        if (!raw || !Array.isArray(raw.outfits)) return null;
        var groups = (Array.isArray(raw.groups) ? raw.groups : [])
            .filter(function (g) {
                return g && ID.test(String(g.id || ''));
            })
            .map(function (g) {
                return { id: g.id, title: cleanText(g.title || g.id, MAX_TITLE), private: g.private === true };
            });
        var byGroup = {};
        groups.forEach(function (g) {
            byGroup[g.id] = g;
        });
        var seen = {};
        var outfits = [];
        raw.outfits.forEach(function (entry) {
            var request = (entry && entry.request) || { prompt: entry && entry.prompt };
            var prompt = cleanText(request && request.prompt, MAX_PROMPT + 1);
            var preset = request && request.preset ? String(request.preset) : null;
            var ok =
                entry &&
                ID.test(String(entry.id || '')) &&
                !seen[entry.id] &&
                byGroup[entry.group] &&
                prompt &&
                prompt.length <= MAX_PROMPT &&
                (!preset || ID.test(preset));
            if (!ok) {
                console.warn('[Wardrobe] an outfit dictionary entry was skipped', entry && entry.id);
                return;
            }
            seen[entry.id] = true;
            var group = byGroup[entry.group];
            outfits.push({
                id: entry.id,
                title: cleanText(entry.title || entry.id, MAX_TITLE),
                group: group.id,
                request: preset ? { prompt: prompt, preset: preset } : { prompt: prompt },
                // Either Forge's rating or the group's claim is enough to make it private.
                private: entry.rating !== 'general' || group.private,
                slots: (Array.isArray(entry.slots) ? entry.slots : []).map(String).slice(0, 8),
                tags: (Array.isArray(entry.tags) ? entry.tags : []).map(String).slice(0, 8),
            });
        });
        if (!outfits.length) return null;
        return { groups: groups, outfits: outfits };
    }

    /**
     * Forge's body-art catalogue → {designs, placements}, or null. `imageUrl(id)`, when given,
     * names each design's picture (only ever a URL this page builds, never one from the data).
     */
    function normalizeBodyArt(raw, imageUrl) {
        if (!raw || !Array.isArray(raw.designs)) return null;
        var placements = (Array.isArray(raw.placements) ? raw.placements : [])
            .filter(function (p) {
                return p && ID.test(String(p.id || ''));
            })
            .map(function (p) {
                return {
                    id: p.id,
                    name: cleanText(p.name || p.id, MAX_TITLE),
                    facing: p.facing === 'front' ? 'front' : 'back',
                    rating: RATING.test(String(p.rating || '')) ? p.rating : 'private',
                };
            });
        var known = {};
        placements.forEach(function (p) {
            known[p.id] = p;
        });
        var designs = raw.designs
            .filter(function (d) {
                return d && ID.test(String(d.id || '')) && Array.isArray(d.placements);
            })
            .map(function (d) {
                var design = {
                    id: d.id,
                    name: cleanText(d.name || d.id, MAX_TITLE),
                    description: cleanText(d.description || '', MAX_DESCRIPTION),
                    placements: d.placements.filter(function (p) {
                        return known[p];
                    }),
                };
                // Forge's rating at each placement: the design's own, never below the placement's.
                // Anything unstated or unknown counts as private, so it can only be hidden.
                design.ratings = {};
                design.placements.forEach(function (p) {
                    var own = d.ratings && d.ratings[p];
                    design.ratings[p] = RATING.test(String(own || '')) ? own : known[p].rating;
                });
                if (typeof imageUrl === 'function') design.image = imageUrl(d.id);
                return design;
            })
            .filter(function (d) {
                return d.placements.length;
            });
        return designs.length ? { designs: designs, placements: placements } : null;
    }

    /** A design id → its picture on the Forge `library` talks to, or null without one. */
    function designImage(library) {
        var client = library && library.client;
        if (!client || typeof client.resolveUrl !== 'function') return null;
        return function (id) {
            return client.resolveUrl('/v1/body-art/designs/' + encodeURIComponent(id) + '.png');
        };
    }

    class OutfitDictionary {
        /**
         * options.library   a ForgeLibraryClient (or a function returning one: the endpoint can
         *                   change in Settings, WF1), options.fetch, options.snapshotUrl
         */
        constructor(options) {
            options = options || {};
            this._library = options.library || null;
            this.fetch = options.fetch || (global.fetch ? global.fetch.bind(global) : null);
            this.snapshotUrl = options.snapshotUrl || SNAPSHOT_URL;
            this.bodyArtSnapshotUrl = options.bodyArtSnapshotUrl || BODY_ART_SNAPSHOT_URL;
            this.catalogue = null; // {groups, outfits, source: 'forge' | 'snapshot'}
            this.bodyArtCatalogue = null;
            this._loading = null;
        }

        get library() {
            var library = typeof this._library === 'function' ? this._library() : this._library;
            return library && library.available ? library : null;
        }

        /** Load once (again after `refresh`). Resolves to the catalogue, or null. Never rejects. */
        load() {
            if (!this._loading) this._loading = this._load();
            return this._loading;
        }

        refresh() {
            this._loading = null;
            return this.load();
        }

        async _load() {
            var library = this.library;
            if (library && typeof library.outfits === 'function') {
                try {
                    var fromForge = normalize(await library.outfits());
                    if (fromForge) {
                        this.catalogue = Object.assign(fromForge, { source: 'forge' });
                        await this._loadBodyArt(library);
                        return this.catalogue;
                    }
                } catch (error) {
                    // A Forge without the route (404), or asleep: the snapshot answers.
                    if (!error || error.status !== 404) console.warn('[Wardrobe] Forge outfits unavailable', error);
                }
            }
            // PT1. Awaited: the view renders once when this resolves, and tattoos that land
            // after that render were never drawn.
            await this._loadBodyArt(library);
            try {
                var response = this.fetch ? await this.fetch(this.snapshotUrl) : null;
                var fromSnapshot = response && response.ok ? normalize(await response.json()) : null;
                if (fromSnapshot) this.catalogue = Object.assign(fromSnapshot, { source: 'snapshot' });
            } catch (error) {
                console.warn('[Wardrobe] the outfit dictionary snapshot could not be read', error);
            }
            return this.catalogue;
        }

        async _loadBodyArt(library) {
            var imageUrl = designImage(library);
            if (library && typeof library.bodyArt === 'function') {
                try {
                    // A Forge that answers is believed, even with nothing to offer: it is the one
                    // that would make the tattoo, and a design it lacks is a job it refuses.
                    this.bodyArtCatalogue = normalizeBodyArt(await library.bodyArt(), imageUrl);
                    return this.bodyArtCatalogue;
                } catch (_) {
                    // Asleep or an older Forge: the snapshot below answers.
                }
            }
            try {
                var response = this.fetch ? await this.fetch(this.bodyArtSnapshotUrl) : null;
                this.bodyArtCatalogue =
                    response && response.ok ? normalizeBodyArt(await response.json(), imageUrl) : null;
            } catch (_) {
                this.bodyArtCatalogue = null; // no tattoos to offer; nothing else changes
            }
            return this.bodyArtCatalogue;
        }

        /** Entries she may be offered now. Private ones only when private outfits are open. */
        entries(options) {
            var open = Boolean(options && options.privateOpen);
            var catalogue = this.catalogue;
            if (!catalogue) return [];
            return catalogue.outfits.filter(function (entry) {
                return open || !entry.private;
            });
        }

        /** Groups with at least one entry she may be offered, in Forge's order. */
        groups(options) {
            var entries = this.entries(options);
            var catalogue = this.catalogue;
            if (!catalogue) return [];
            return catalogue.groups.filter(function (group) {
                return entries.some(function (entry) {
                    return entry.group === group.id;
                });
            });
        }

        /** An entry by id or by title (any case), among those she may be offered. */
        find(idOrTitle, options) {
            var key = String(idOrTitle || '')
                .trim()
                .toLowerCase();
            if (!key) return null;
            return (
                this.entries(options).find(function (entry) {
                    return entry.id === key || entry.title.toLowerCase() === key;
                }) || null
            );
        }

        /**
         * Tattoo designs and placements. All of them when private outfits are open for her;
         * PT1: with private mode on but her avatar not declared adult (`privateMode`), only the
         * placements Forge rates `general` — a tattoo on the nape needs no declaration on
         * Forge's side, and hiding it too left private mode with nothing to show for most
         * avatars. Private mode never stands in for the declaration: anything above
         * `general` still waits for it. Off: none.
         */
        tattoos(options) {
            options = options || {};
            var catalogue = this.bodyArtCatalogue;
            if (!catalogue) return null;
            if (options.privateOpen) return catalogue;
            if (!options.privateMode) return null;
            var designs = catalogue.designs
                .map(function (d) {
                    var general = d.placements.filter(function (p) {
                        return d.ratings && d.ratings[p] === 'general';
                    });
                    return general.length ? Object.assign({}, d, { placements: general }) : null;
                })
                .filter(Boolean);
            return designs.length ? { designs: designs, placements: catalogue.placements } : null;
        }
    }

    var shared = null;

    /**
     * The page's dictionary, built on first use from the wardrobe service's Forge (and
     * following it when Settings re-points the Forge: the library is read on every load).
     */
    function forPage(g) {
        g = g || global;
        if (shared) return shared;
        var Library = g.NEXUS_FORGE_LIBRARY_CLIENT && g.NEXUS_FORGE_LIBRARY_CLIENT.ForgeLibraryClient;
        var lastClient = null;
        var lastLibrary = null;
        shared = new OutfitDictionary({
            library: function () {
                var wardrobe = g.NEXUS_WARDROBE;
                var service = wardrobe && wardrobe.service;
                var forge = service && service.remoteEnabled && service.controller && service.controller.forge;
                if (!Library || !forge || typeof forge.request !== 'function') return null;
                if (forge !== lastClient) {
                    lastClient = forge;
                    lastLibrary = new Library({ client: forge });
                }
                return lastLibrary;
            },
        });
        return shared;
    }

    var api = {
        SNAPSHOT_URL: SNAPSHOT_URL,
        BODY_ART_SNAPSHOT_URL: BODY_ART_SNAPSHOT_URL,
        OutfitDictionary: OutfitDictionary,
        normalize: normalize,
        normalizeBodyArt: normalizeBodyArt,
        forPage: forPage,
        _reset: function () {
            shared = null;
        },
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_OUTFIT_DICTIONARY = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
