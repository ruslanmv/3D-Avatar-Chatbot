/**
 * AvatarAdultDeclaration — is the avatar on screen one that is declared to depict an adult?
 * (PW, strengthening Private.)
 *
 * Why this exists. Private mode answers whether the PERSON is an adult. Whether the AVATAR
 * depicts one is a different question with a different owner: the operator, who declares it per
 * avatar. The Private experience's own code claimed that gate stood in front of it, but nothing
 * in the Intimate path checked it — so an adult experience could start with any avatar,
 * including an age-ambiguous one. This module is the one place that question is asked, for both
 * the Intimate activity and the premium Private World.
 *
 * Where a declaration comes from. Two places, both written by the operator:
 *
 * - **The public catalog this site ships** (`vendor/avatars/avatars.json`), `depictsAdult: true`
 *   per item. The operator declared every public built-in avatar adult (PW8, 2026-11-07). It
 *   counts only for a file actually served from `vendor/avatars/` and listed there — never for
 *   an avatar installed in this browser, an uploaded file, or a `blob:`/`data:` URL, however it
 *   is named. The catalog is fetched from its own fixed path, never from the merged avatar list
 *   (which also holds installed avatars).
 * - **Wardrobe Forge's library** (`depictsAdult` in `GET /v1/library`, set in Forge's
 *   `assets/library/policy.json`) — the same declaration Try-On's private gate (W10) reads, and
 *   the one Forge enforces on its own jobs.
 *
 * Before PW8 only Forge's answer counted. The person found Private refused on AvatarSample A —
 * "it has not been declared adult" — because Forge's policy declared one avatar and the
 * catalog's other public avatars were not even Forge library avatars.
 *
 * It fails closed. No identity, a file not in the catalog and not declared by Forge, a Forge
 * library avatar whose bytes differ from what Forge publishes, or anything that throws is "no",
 * with a sentence that says why. A yes is remembered only for the same avatar and only for
 * CACHE_MS; a no is never remembered, so fixing the cause is enough.
 *
 * Exposes: window.NEXUS_AVATAR_ADULT
 */
(function (global) {
    'use strict';

    const CACHE_MS = 10 * 60 * 1000;
    /** The public catalog, at the path the page itself loads it from (main.js AVATAR_MANIFEST_URL). */
    const CATALOG_URL = '/vendor/avatars/avatars.json';
    let cached = null; // { key, at }
    let catalogLoad = null; // Promise<catalog|null>; a failed load is not kept

    function avatarKey(g) {
        try {
            const m = g.NEXUS_VIEWER && g.NEXUS_VIEWER.avatarManager;
            const cur = m && typeof m.getCurrent === 'function' ? m.getCurrent() : null;
            return (cur && (cur.url || cur.name)) || null;
        } catch (_) {
            return null;
        }
    }

    /**
     * The avatar on screen now — not the wardrobe's `original`, which Try-On pins to the avatar a
     * haul STARTED from (the first walkthrough switched to VRoid Female and was still judged as
     * AvatarSample A). The one exception is a worn Forge look: its URL says nothing about who she
     * is, so the base avatar the controller snapshotted is judged — but only while the URL on
     * screen is exactly the look the controller is wearing.
     */
    function baseOnScreen(g, W) {
        const m = g.NEXUS_VIEWER && g.NEXUS_VIEWER.avatarManager;
        const current = m && typeof m.getCurrent === 'function' ? m.getCurrent() : null;
        const controller = W && W.service && W.service.controller;
        // PW8. Only the look the controller says it is wearing — the exact URL it loaded — stands
        // for its original. A `blob:` on its own used to: with a haul's snapshot in place, an avatar
        // uploaded afterwards (also a blob:) was judged as AvatarSample A and opened Private.
        const wearing =
            current &&
            controller &&
            controller.original &&
            controller.activeLook &&
            typeof controller.wornUrl === 'string' &&
            controller.wornUrl === current.url;
        return wearing ? controller.original : current;
    }

    function whoIsOnScreen(g, W) {
        const Id = g.NEXUS_AVATAR_IDENTITY;
        const base = baseOnScreen(g, W);
        return Id && typeof Id.resolve === 'function' ? Id.resolve(base) : null;
    }

    /**
     * Pure: the catalog's declaration for this base avatar, or null. Only a file served from this
     * site's bundled folder (never blob:, data:, another origin or an installed avatar) and
     * listed in the catalog with `depictsAdult === true` — the boolean, not a string — counts.
     */
    function catalogDeclaration(catalog, base, Id, origin) {
        if (!catalog || !Array.isArray(catalog.items) || !base || !base.url || !Id) return null;
        if (typeof Id.isBundled !== 'function' || !Id.isBundled(base.url)) return null;
        // isBundled accepts any URL whose path contains the folder; a declaration needs this
        // site's own file: a same-origin path of exactly vendor/avatars/<file>, nothing else.
        let path = String(base.url).split('#')[0].split('?')[0];
        if (origin && path.indexOf(origin + '/') === 0) path = path.slice(origin.length);
        if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(path)) return null;
        if (!/^\/?vendor\/avatars\/[^/]+$/.test(path)) return null;
        const file = String(Id.fileOf(base.url) || '').toLowerCase();
        if (!file) return null;
        const item = catalog.items.find((x) => x && String(x.file || '').toLowerCase() === file);
        return item && item.depictsAdult === true ? { file: item.file, name: item.name || item.file } : null;
    }

    /**
     * Pure: the decision from the answers. `identity` is AvatarIdentity.resolve(...), `published`
     * the `avatars` of Forge's library (null when unreachable), `same` AvatarIdentity's
     * matchesPublished (true / false / null), `declared` catalogDeclaration(...) (null when the
     * catalog does not declare this file).
     */
    function decide(identity, published, same, declared) {
        const name = (declared && declared.name) || (identity && identity.name) || 'this avatar';
        if (!identity || identity.kind === 'unknown')
            return { ok: false, why: 'Private can’t confirm this avatar yet: wait for her to finish loading.' };
        // A Forge library avatar whose bytes Forge says differ is not the avatar anyone declared.
        if (same === false) return { ok: false, why: 'This avatar’s file does not match the declared one.' };
        if (declared) return { ok: true, why: 'declared-adult', source: 'catalog', file: declared.file };
        if (identity.kind !== 'library')
            return {
                ok: false,
                why:
                    'Private needs one of the built-in avatars that have been declared adult. ' +
                    name +
                    ' is not one of them.',
            };
        if (!Array.isArray(published))
            return {
                ok: false,
                why: 'Wardrobe Forge can’t be reached, so Private can’t confirm this avatar right now.',
            };
        const entry = published.find((x) => x && x.slug === identity.slug);
        if (!entry || entry.depictsAdult !== true)
            return {
                ok: false,
                why: 'Private is off for ' + ((entry && entry.name) || name) + ': it has not been declared adult.',
            };
        return { ok: true, why: 'declared-adult', source: 'forge', slug: identity.slug };
    }

    /** The shipped catalog, fetched once; a failed fetch is forgotten so the next check retries. */
    function loadCatalog(g) {
        if (catalogLoad) return catalogLoad;
        const doFetch = g && typeof g.fetch === 'function' ? g.fetch.bind(g) : null;
        if (!doFetch) return Promise.resolve(null);
        catalogLoad = Promise.resolve(doFetch(CATALOG_URL))
            .then((r) => (r && r.ok ? r.json() : null))
            .catch(() => null)
            .then((c) => {
                if (!c) catalogLoad = null;
                return c;
            });
        return catalogLoad;
    }

    /** Ask the catalog and, for a Forge library avatar, Forge. Never throws. */
    async function check(g, options) {
        const o = options || {};
        const now = o.now || Date.now();
        const key = avatarKey(g);
        if (cached && key && cached.key === key && now - cached.at < CACHE_MS)
            return { ok: true, why: 'declared-adult' };
        try {
            const W = g.NEXUS_WARDROBE;
            const Id = g.NEXUS_AVATAR_IDENTITY;
            const base = baseOnScreen(g, W);
            const identity = Id && typeof Id.resolve === 'function' ? Id.resolve(base) : null;
            const catalog = 'catalog' in o ? o.catalog : await loadCatalog(g);
            const origin = g.location && typeof g.location.origin === 'string' ? g.location.origin : null;
            const declared = catalogDeclaration(catalog, base, Id, origin);
            // Forge is asked only about its own library avatars: it is what catches a library
            // file whose bytes differ, and the declaration source for one the catalog does not list.
            let published = null;
            const Gen = g.NEXUS_TRY_ON_GENERATOR && g.NEXUS_TRY_ON_GENERATOR.TryOnGenerator;
            if (identity && identity.kind === 'library' && W && W.service && Gen) {
                try {
                    const gen = new Gen({ service: W.service });
                    published = gen.library ? await gen.library.library() : null;
                } catch (_) {
                    published = null;
                }
            }
            const same =
                Id && typeof Id.matchesPublished === 'function' ? Id.matchesPublished(identity, published) : null;
            const r = decide(identity, published, same, declared);
            // The avatar may have changed while the answers came in: an answer about another one is no answer.
            if (avatarKey(g) !== key) return { ok: false, why: 'The avatar changed; try again.' };
            cached = r.ok && key ? { key, at: now } : null;
            return r;
        } catch (_) {
            cached = null;
            return { ok: false, why: 'Private can’t confirm this avatar right now.' };
        }
    }

    const api = {
        CACHE_MS,
        CATALOG_URL,
        decide,
        check,
        whoIsOnScreen,
        catalogDeclaration,
        _reset: () => {
            cached = null;
            catalogLoad = null;
        },
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_AVATAR_ADULT = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
