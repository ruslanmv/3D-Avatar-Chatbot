/**
 * W4. Which avatar is she, as far as Wardrobe Forge is concerned?
 *
 * Forge has two ways to dress an avatar. Its library route, `POST /v1/library/{slug}/jobs`,
 * takes nothing but the slug: the server already holds the eight avatars this site ships,
 * pinned by SHA-256, with the CC0 terms their provenance grants. Its generic route,
 * `POST /v1/generate`, takes a URL the server must fetch and a licence the caller must
 * vouch for. For a built-in avatar the library route is strictly better — no 15 MB upload,
 * no licence claim from a browser, and a look fitted to the very bytes she is — but only
 * if "built-in" is true. This module is the one place that decides it.
 *
 * Three things it deliberately does not trust:
 *
 * - **The current avatar.** While a look is on, `AvatarManager.getCurrent()` is the look,
 *   and a look is not an avatar Forge knows. Identity is taken from the controller's
 *   snapshot of the original — the caller passes that in; this module never reads the
 *   viewer, so it stays a pure function and testable without one.
 * - **A file name on its own.** A user can install any VRM called `AvatarSample_A.vrm`
 *   through VRM Manager. It is a library avatar only when it is also served from the
 *   bundled avatar folder (`vendor/avatars/`), where the eight pinned files live.
 * - **Its own table, when Forge publishes one.** The hashes below were read from
 *   Forge's `assets/library/models.json` and match this repository's files byte for byte.
 *   `matchesPublished()` checks them against what a running Forge says, so a Forge
 *   that ships different bytes is caught before a look is fitted to the wrong model.
 *
 * Exposes: window.NEXUS_AVATAR_IDENTITY
 */
(function (global) {
    'use strict';

    /** The eight avatars both repositories ship, and the Forge slug each one answers to. */
    var LIBRARY = Object.freeze([
        {
            slug: 'avatar-sample-a',
            file: 'AvatarSample_A.vrm',
            sha256: 'b86b0b8a66d48911431d6f920a5211a974226f83aa672eca3f3dfade58ac346e',
        },
        {
            slug: 'avatar-sample-b',
            file: 'AvatarSample_B.vrm',
            sha256: '4a271bd3b5a3d19e054fd113ee154635b72e7141f4a8ccbcdba3c7f9cea6ee8d',
        },
        {
            slug: 'avatar-sample-c',
            file: 'AvatarSample_C.vrm',
            sha256: '395d5b04696e888f07bc856ae01bf72a974b7e773132c7443dc59d1688045b8a',
        },
        {
            slug: 'fem-vroid',
            file: 'fem_vroid.vrm',
            sha256: '983631034570b7a70e2f158e48f12fe7f0fe3ebcba763363efd6e85a2fbbacb8',
        },
        {
            slug: 'masc-vroid',
            file: 'masc_vroid.vrm',
            sha256: 'ac5e30b9f875b54b13cddbe86d6351b4a8d2d418c2f885d89199281ad5c937cb',
        },
        // CG6. Forge's three VRoid Hub characters, so every library character can be opened here
        // (Try-On, Private's body states). Copied byte for byte from Forge's assets/library/vroid/.
        {
            slug: 'vroid-rinna',
            file: 'Rinna.vrm',
            sha256: 'd88320f4b0059af84ce75aed66672f4602caa376e4bd41ba454e657083b54d51',
        },
        {
            slug: 'vroid-model-girl',
            file: 'Model_Girl.vrm',
            sha256: '1a298a534c54c8f6d74ddf78de06ac1c9ecef88972552d18b9d5bf01cb7a42bb',
        },
        {
            slug: 'vroid-avatar-sample-o',
            file: 'AvatarSample_O.vrm',
            sha256: 'e5c0395b59b636e6e0731ba872f4885d1bf1b69eba5f2904e68c16bd105e1697',
        },
    ]);

    /** Where the bundled avatars are served from (`vendor/avatars/avatars.json` lists them). */
    var BUNDLED_FOLDERS = Object.freeze(['vendor/avatars/']);

    /** The path of a URL without query or fragment, decoded; '' for anything unreadable. */
    function pathOf(url) {
        if (!url || typeof url !== 'string') return '';
        var bare = url.split('#')[0].split('?')[0];
        try {
            return decodeURIComponent(bare);
        } catch (_) {
            return bare;
        }
    }

    function fileOf(url) {
        var path = pathOf(url);
        return path.slice(path.lastIndexOf('/') + 1);
    }

    /**
     * Whether a URL points into a bundled avatar folder. A blob: or data: URL — how an
     * avatar installed in the browser is often loaded — never does.
     */
    function isBundled(url, folders) {
        var path = pathOf(url);
        if (!path || /^(blob|data):/i.test(path)) return false;
        return (folders || BUNDLED_FOLDERS).some(function (folder) {
            return path.indexOf(folder) !== -1;
        });
    }

    function entryForFile(file, table) {
        var wanted = String(file || '').toLowerCase();
        if (!wanted) return null;
        return (
            (table || LIBRARY).find(function (entry) {
                return String(entry.file).toLowerCase() === wanted;
            }) || null
        );
    }

    /**
     * Resolve the avatar to dress.
     *
     *   original   the controller's snapshot: `{url, name, index}` — never the current look
     *   options    {conditionsOfUse, folders, library}
     *
     * Answers one of:
     *   {kind: 'library',  slug, file, sha256, name}
     *   {kind: 'external', url, file, name, conditionsOfUse}
     *   {kind: 'unknown',  why}
     */
    function resolve(original, options) {
        options = options || {};
        if (!original || !original.url) {
            return { kind: 'unknown', why: 'Wait for the avatar to finish loading.' };
        }
        var file = fileOf(original.url);
        var entry = isBundled(original.url, options.folders) ? entryForFile(file, options.library) : null;
        if (entry) {
            return {
                kind: 'library',
                slug: entry.slug,
                file: entry.file,
                sha256: entry.sha256,
                name: original.name || entry.file,
            };
        }
        return {
            kind: 'external',
            url: original.url,
            file: file,
            name: original.name || file || 'Avatar',
            conditionsOfUse: options.conditionsOfUse || null,
        };
    }

    /**
     * Does a running Forge hold the same bytes for this library avatar?
     *
     *   published   the `avatars` array of `GET /v1/library`
     *
     * true when the slug is listed, available and its sha256 matches; false when it is
     * listed with other bytes or unavailable; null when there is nothing to compare with
     * (Forge unreachable, or an external avatar) — the caller decides what an unknown means.
     */
    function matchesPublished(identity, published) {
        if (!identity || identity.kind !== 'library') return null;
        if (!Array.isArray(published)) return null;
        var entry = published.find(function (item) {
            return item && item.slug === identity.slug;
        });
        if (!entry) return false;
        if (entry.available === false) return false;
        if (!entry.sha256) return null;
        return String(entry.sha256).toLowerCase() === String(identity.sha256).toLowerCase();
    }

    var api = {
        LIBRARY: LIBRARY,
        BUNDLED_FOLDERS: BUNDLED_FOLDERS,
        resolve: resolve,
        matchesPublished: matchesPublished,
        fileOf: fileOf,
        isBundled: isBundled,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_AVATAR_IDENTITY = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
