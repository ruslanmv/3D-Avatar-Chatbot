/**
 * AvatarAdultDeclaration — is the avatar on screen one that is declared to depict an adult?
 * (PW, strengthening Private.)
 *
 * Why this exists. Private mode answers whether the PERSON is an adult. Whether the AVATAR
 * depicts one is a different question with a different owner: Wardrobe Forge's operator declares
 * it per library avatar (`depictsAdult` in `GET /v1/library`, set in Forge's
 * `assets/library/policy.json`), and Try-On's private gate (W10) already reads it. The Private
 * experience's own code claimed the same gate ("an avatar Forge declares adult … already stand[s]
 * in front") but nothing in the Intimate path checked it — so an adult experience could start
 * with any avatar, including an age-ambiguous one. This module is the one place that question is
 * asked, for both the Intimate activity and the premium Private World.
 *
 * It fails closed. The answer is yes only for a built-in library avatar whose bytes match what
 * Forge publishes and which Forge declares adult. An external or custom avatar, a Forge that
 * cannot be reached, a library that does not list her, or anything that throws is "no", with a
 * sentence that says why. A yes is remembered only for the same avatar and only for CACHE_MS; a
 * no is never remembered, so fixing the cause (Forge back online) is enough.
 *
 * Exposes: window.NEXUS_AVATAR_ADULT
 */
(function (global) {
    'use strict';

    const CACHE_MS = 10 * 60 * 1000;
    let cached = null; // { key, at }

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
     * AvatarSample A). The one exception is a worn Forge look: its `blob:` URL says nothing about
     * who she is, so the base avatar the controller snapshotted is the one that is judged.
     */
    function whoIsOnScreen(g, W) {
        const Id = g.NEXUS_AVATAR_IDENTITY;
        const m = g.NEXUS_VIEWER && g.NEXUS_VIEWER.avatarManager;
        const current = m && typeof m.getCurrent === 'function' ? m.getCurrent() : null;
        const controller = W && W.service && W.service.controller;
        const base =
            current && /^blob:/.test(String(current.url || '')) && controller && controller.original
                ? controller.original
                : current;
        return Id && typeof Id.resolve === 'function' ? Id.resolve(base) : null;
    }

    /**
     * Pure: the decision from the answers. `identity` is AvatarIdentity.resolve(...), `published`
     * the `avatars` of Forge's library (null when unreachable), `same` AvatarIdentity's
     * matchesPublished (true / false / null).
     */
    function decide(identity, published, same) {
        const name = (identity && identity.name) || 'this avatar';
        if (!identity || identity.kind !== 'library')
            return {
                ok: false,
                why:
                    'Private needs one of the built-in avatars that Wardrobe Forge’s operator has declared adult. ' +
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
        if (same === false) return { ok: false, why: 'This avatar’s file does not match the declared one.' };
        return { ok: true, why: 'declared-adult', slug: identity.slug };
    }

    /** Ask Forge, through the wardrobe's own generator and library client. Never throws. */
    async function check(g, options) {
        const o = options || {};
        const now = o.now || Date.now();
        const key = avatarKey(g);
        if (cached && key && cached.key === key && now - cached.at < CACHE_MS)
            return { ok: true, why: 'declared-adult' };
        try {
            const W = g.NEXUS_WARDROBE;
            const Gen = g.NEXUS_TRY_ON_GENERATOR && g.NEXUS_TRY_ON_GENERATOR.TryOnGenerator;
            if (!W || !W.service || !Gen)
                return { ok: false, why: 'The wardrobe is not ready, so Private can’t confirm this avatar yet.' };
            const gen = new Gen({ service: W.service });
            const identity = whoIsOnScreen(g, W);
            let published = null;
            if (identity && identity.kind === 'library' && gen.library) {
                try {
                    published = await gen.library.library();
                } catch (_) {
                    published = null;
                }
            }
            const Id = g.NEXUS_AVATAR_IDENTITY;
            const same =
                Id && typeof Id.matchesPublished === 'function' ? Id.matchesPublished(identity, published) : null;
            const r = decide(identity, published, same);
            // The avatar may have changed while Forge answered: an answer about another one is no answer.
            if (avatarKey(g) !== key) return { ok: false, why: 'The avatar changed; try again.' };
            cached = r.ok && key ? { key, at: now } : null;
            return r;
        } catch (_) {
            cached = null;
            return { ok: false, why: 'Private can’t confirm this avatar right now.' };
        }
    }

    const api = { CACHE_MS, decide, check, whoIsOnScreen, _reset: () => (cached = null) };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_AVATAR_ADULT = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
