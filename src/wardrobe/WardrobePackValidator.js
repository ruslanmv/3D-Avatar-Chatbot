/**
 * W11. The one boundary every wardrobe pack crosses before a look reaches the drawer.
 *
 * A look is an artifact: a whole VRM, fitted to one avatar, made by Wardrobe Forge
 * yesterday or last year, shipped in `vendor/wardrobe/`, imported from a zip, or created
 * on a Forge a minute ago. Where it came from must stop mattering once it is here — so
 * every source hands its manifest to this module and gets back the same normalized look,
 * and nothing downstream (the drawer, Try-On, WardrobeController) learns a second shape.
 *
 * What it prevents, each of which is a way a look used to be able to go wrong:
 *
 * - **A look for another avatar.** A look *is* the avatar it was fitted to, dressed.
 *   Worn on anyone else it replaces her with someone else. Each look names its owner
 *   (`avatarId`, and the source's SHA-256 in `fit.sourceSha256`); `visibility()` shows it
 *   only on that avatar, and hides it with a sentence on a different version of her.
 * - **A pack granting itself something.** The normalized look is built from a list of
 *   fields, never by copying the manifest, so `depictsAdult`, `trusted`, `private` or any
 *   other claim a downloaded file makes about permissions is simply not carried. A
 *   `rating` can only hide a look: `general` shows, anything else needs the app's own
 *   private gate to be open, and an unknown rating counts as the strictest.
 * - **A path out of the pack.** Relative URLs must stay under the manifest's folder; the
 *   only absolute scheme is `https:`. `javascript:`, `data:`, `blob:` and friends are
 *   refused, as is any `..` segment, encoded or not.
 * - **A corrupt or swapped file.** `verifyBytes` checks size, SHA-256, the binary glTF
 *   header and a VRM humanoid with hips — so a bad file fails here with a reason, not
 *   seconds later inside Three.js. `fetchVerified` does that before the loader sees it.
 *
 * Fail soft, the house rule: a bad look is dropped with its reason and the rest of the
 * pack still lists; only a manifest that cannot be read at all fails whole.
 *
 * Pure apart from `fetchVerified`, and IIFE with the dual export, so Jest `require`s it
 * and `tools`/`scripts` reuse it in Node. Exposes window.NEXUS_WARDROBE_PACK_VALIDATOR.
 */
(function (global) {
    'use strict';

    var SUPPORTED_SCHEMA = 2;
    var RATINGS = ['general', 'swimwear', 'intimate'];
    var LIMITS = Object.freeze({ looks: 500, vrmBytes: 60 * 1024 * 1024, previewBytes: 2 * 1024 * 1024 });
    var ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
    var SHA256 = /^[0-9a-f]{64}$/;
    var PREVIEW_EXT = /\.(webp|png|jpe?g)$/i;
    var GLB_MAGIC = 0x46546c67; // 'glTF'
    var CHUNK_JSON = 0x4e4f534a; // 'JSON'

    /** The origin labels a person sees, instead of `static` / `remote`. */
    var ORIGIN_LABELS = Object.freeze({ builtin: 'HomePilot', imported: 'Imported', forge: 'Created' });

    function text(value, max) {
        if (value === undefined || value === null) return null;
        var s = String(value).trim();
        return s ? s.slice(0, max || 200) : null;
    }

    function sha(value) {
        var s = typeof value === 'string' ? value.trim().toLowerCase() : '';
        return SHA256.test(s) ? s : null;
    }

    function count(value, max) {
        return Number.isInteger(value) && value > 0 && value <= max ? value : null;
    }

    function hasDotSegment(path) {
        var decoded;
        try {
            decoded = decodeURIComponent(path);
        } catch (_) {
            return true; // an undecodable path is not one we can reason about
        }
        return decoded.split(/[\\/]/).some(function (part) {
            return part === '..' || part === '.';
        });
    }

    /**
     * An artifact URL, resolved against the manifest, or {error}.
     *
     * relative   stays under the manifest's folder (the pack root)
     * https:     allowed as written — a pack may point at a CDN
     * same-origin absolute paths (`/vendor/...`) only for a builtin v1 manifest, which
     * has always resolved them; everything else is refused.
     */
    function resolveArtifactUrl(raw, manifestUrl, options) {
        var value = typeof raw === 'string' ? raw.trim() : '';
        if (!value) return { error: 'no URL' };
        if (/[\u0000-\u001f\\]/.test(value)) return { error: 'URL has control characters or backslashes' };
        var scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value);
        var base = new URL(manifestUrl);
        var root = new URL('./', base);
        if (scheme) {
            var absolute = scheme[1].toLowerCase();
            // https anywhere; plain http only on the page's own origin (a local dev server).
            if (absolute === 'https') return { url: new URL(value).href };
            if (absolute === 'http' && new URL(value).origin === base.origin) return { url: new URL(value).href };
            return { error: scheme[1] + ': URLs are not allowed' };
        }
        if (value.startsWith('//')) return { error: 'protocol-relative URLs are not allowed' };
        if (hasDotSegment(value.split(/[?#]/)[0])) return { error: 'URL leaves the pack folder' };
        if (value.startsWith('/')) {
            if (!options.allowRootPaths) return { error: 'absolute paths are not allowed in a pack' };
            return { url: new URL(value, base).href };
        }
        var resolved = new URL(value, base);
        if (resolved.origin !== root.origin || !resolved.pathname.startsWith(root.pathname)) {
            return { error: 'URL leaves the pack folder' };
        }
        return { url: resolved.href };
    }

    function pathOf(url) {
        try {
            return new URL(url).pathname;
        } catch (_) {
            return '';
        }
    }

    /**
     * Read a manifest (v1 or v2) into normalized looks.
     *
     *   manifest    the parsed wardrobe.json
     *   options     {manifestUrl, origin: 'builtin'|'imported'|'forge', sourceId?, sourceLabel?,
     *                legacySource?: the old `source` value ('static'), allowRootPaths?}
     *
     * Answers {ok, reason?, pack, looks, rejected: [{id, reason}]}. `ok` is false only when
     * the manifest as a whole cannot be used; a bad look is in `rejected` and the rest list.
     */
    function validateManifest(manifest, options) {
        options = options || {};
        var origin = options.origin || 'builtin';
        var fail = function (reason) {
            return { ok: false, reason: reason, pack: null, looks: [], rejected: [] };
        };
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
            return fail('not a wardrobe manifest');
        var schema = manifest.schemaVersion === undefined ? 1 : manifest.schemaVersion;
        if (!Number.isInteger(schema) || schema < 1) return fail('schemaVersion is not a number');
        if (schema > SUPPORTED_SCHEMA) return fail('made by a newer Wardrobe Forge (schema ' + schema + ')');
        if (!Array.isArray(manifest.looks)) return fail('the manifest lists no looks');
        if (manifest.looks.length > LIMITS.looks) return fail('more than ' + LIMITS.looks + ' looks');
        var manifestUrl;
        try {
            manifestUrl = new URL(
                options.manifestUrl || '',
                global.location ? global.location.href : 'http://localhost/'
            ).href;
        } catch (_) {
            return fail('the manifest has no usable URL');
        }

        var packInfo = manifest.pack && typeof manifest.pack === 'object' ? manifest.pack : {};
        var pack = {
            schemaVersion: schema,
            id: ID.test(String(packInfo.id || '')) ? String(packInfo.id) : origin + '-v' + schema,
            version: text(packInfo.version, 32),
            sourceName: text(manifest.sourceName, 80),
            generatedBy: text(packInfo.generatedBy, 80),
            createdAt: text(packInfo.createdAt, 40),
            visibility: manifest.visibility === 'public' ? 'public' : manifest.visibility ? 'private' : null,
        };
        var sourceId = options.sourceId || origin;
        var label = options.sourceLabel || pack.sourceName || ORIGIN_LABELS[origin] || origin;

        // The avatars a v2 pack was fitted to, by id: their source hash travels with each look.
        var avatars = {};
        (Array.isArray(manifest.avatars) ? manifest.avatars : []).forEach(function (entry) {
            if (entry && ID.test(String(entry.avatarId || ''))) avatars[entry.avatarId] = entry;
        });
        var packOwner = ID.test(String(manifest.avatarId || '')) ? String(manifest.avatarId) : null;

        var looks = [];
        var rejected = [];
        var seen = new Set();
        manifest.looks.forEach(function (raw, index) {
            var id = raw && ID.test(String(raw.id || '')) ? String(raw.id) : null;
            var reject = function (reason) {
                rejected.push({ id: id || '#' + index, reason: reason });
            };
            if (!raw || typeof raw !== 'object') return reject('not a look');
            if (!raw.vrmUrl) return; // a v1 source entry ("original") has no file: not a look to list
            if (!id) return reject('look id is missing or has unsafe characters');
            var owner = ID.test(String(raw.avatarId || '')) ? String(raw.avatarId) : packOwner;
            var key = sourceId + ':' + pack.id + ':' + (owner || '-') + ':' + id;
            if (seen.has(key)) return reject('look id appears twice for the same avatar');

            var vrm = resolveArtifactUrl(raw.vrmUrl, manifestUrl, { allowRootPaths: options.allowRootPaths });
            if (vrm.error) return reject('vrmUrl: ' + vrm.error);
            if (!/\.vrm$/i.test(pathOf(vrm.url))) return reject('vrmUrl is not a .vrm file');
            var preview = null;
            if (raw.previewUrl) {
                preview = resolveArtifactUrl(raw.previewUrl, manifestUrl, { allowRootPaths: options.allowRootPaths });
                if (preview.error) return reject('previewUrl: ' + preview.error);
                if (!PREVIEW_EXT.test(pathOf(preview.url))) return reject('previewUrl is not an image');
            }
            var digest = sha(raw.sha256);
            if (raw.sha256 !== undefined && !digest) return reject('sha256 is not a SHA-256 digest');
            if (schema >= 2 && !digest) return reject('a v2 look must name its sha256');
            if (raw.bytes !== undefined && count(raw.bytes, LIMITS.vrmBytes) === null) {
                return reject('bytes is missing or over ' + LIMITS.vrmBytes);
            }
            if (raw.previewBytes !== undefined && count(raw.previewBytes, LIMITS.previewBytes) === null) {
                return reject('previewBytes is over ' + LIMITS.previewBytes);
            }
            // Unknown ratings count as the strictest: a rating can only ever hide a look.
            var rating = raw.rating === undefined ? null : RATINGS.indexOf(raw.rating) >= 0 ? raw.rating : 'intimate';
            var fit = raw.fit && typeof raw.fit === 'object' ? raw.fit : {};
            var avatar = owner ? avatars[owner] : null;
            var license = raw.license && typeof raw.license === 'object' ? raw.license : {};
            var provenance = raw.provenance && typeof raw.provenance === 'object' ? raw.provenance : {};

            seen.add(key);
            looks.push({
                key: key,
                id: id,
                type: 'vrmVariant',
                name: text(raw.name, 80) || 'Look',
                avatarId: owner,
                vrmUrl: vrm.url,
                previewUrl: preview ? preview.url : null,
                sha256: digest,
                bytes: count(raw.bytes, LIMITS.vrmBytes),
                previewSha256: sha(raw.previewSha256),
                previewBytes: count(raw.previewBytes, LIMITS.previewBytes),
                prompt: text(raw.prompt || provenance.prompt, 500),
                tags: (Array.isArray(raw.tags) ? raw.tags : [])
                    .map(function (tag) {
                        return text(tag, 32);
                    })
                    .filter(Boolean)
                    .slice(0, 12),
                rating: rating,
                fit: {
                    quality: fit.quality === 'verified' ? 'verified' : fit.quality ? 'unverified' : null,
                    clipping: text(fit.clipping, 32),
                    sourceSha256: sha(avatar && avatar.sourceSha256),
                },
                license: { spdx: text(license.spdx, 64), derivedFrom: text(license.derivedFrom, 128) },
                provenance: {
                    generator: text(provenance.generator || pack.generatedBy, 80),
                    generatorVersion: text(provenance.generatorVersion, 32),
                    recipeId: text(provenance.recipeId, 128),
                },
                pack: { id: pack.id, version: pack.version, schemaVersion: schema },
                origin: origin,
                sourceLabel: label,
                source: options.legacySource || origin,
            });
        });
        return { ok: true, pack: pack, looks: looks, rejected: rejected };
    }

    /**
     * May this look be offered right now? {visible, reason}.
     *
     *   context  {identity: AvatarIdentity.resolve(...) result, privateOpen: boolean,
     *             unratedAs: 'general' | 'swimwear'}
     *
     * `privateOpen` is the app's own decision (private mode on *and* the avatar declared adult
     * by its owner — TryOnPrivate). Nothing in a pack feeds it.
     */
    function visibility(look, context) {
        context = context || {};
        var owner = look && look.avatarId;
        if (owner && owner !== 'default') {
            var identity = context.identity || null;
            var names = identity ? [identity.slug, identity.name, identity.file] : [];
            if (names.indexOf(owner) < 0) return { visible: false, reason: 'made for another avatar' };
            var made = look.fit && look.fit.sourceSha256;
            var worn = identity && identity.sha256 ? String(identity.sha256).toLowerCase() : null;
            if (made && worn && made !== worn) {
                return { visible: false, reason: 'made for a different version of this avatar' };
            }
        }
        var rating = (look && look.rating) || context.unratedAs || 'swimwear';
        if (rating === 'general') return { visible: true, reason: null };
        if (context.privateOpen === true) return { visible: true, reason: null };
        return { visible: false, reason: 'private' };
    }

    /**
     * Is this binary a VRM with a humanoid? {ok, spec?, reason?}. Reads the GLB header and the
     * JSON chunk only — no Three.js, no textures decoded.
     */
    function inspectVrm(buffer) {
        // Not `instanceof`: a buffer from another realm (a worker, Node under jsdom) fails it.
        var bytes = !buffer
            ? null
            : ArrayBuffer.isView(buffer)
              ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
              : new Uint8Array(buffer);
        if (!bytes || bytes.byteLength < 20) return { ok: false, reason: 'too short to be a VRM' };
        var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (view.getUint32(0, true) !== GLB_MAGIC) return { ok: false, reason: 'not a binary glTF file' };
        if (view.getUint32(4, true) !== 2) return { ok: false, reason: 'not glTF 2.0' };
        var total = view.getUint32(8, true);
        if (total > bytes.byteLength) return { ok: false, reason: 'the file is truncated' };
        var chunkLength = view.getUint32(12, true);
        if (view.getUint32(16, true) !== CHUNK_JSON || 20 + chunkLength > total) {
            return { ok: false, reason: 'the glTF has no JSON chunk' };
        }
        var json;
        try {
            // jsdom has no TextDecoder; Node's is the same API.
            var Decoder = typeof TextDecoder !== 'undefined' ? TextDecoder : require('util').TextDecoder;
            json = JSON.parse(new Decoder('utf-8').decode(bytes.subarray(20, 20 + chunkLength)));
        } catch (_) {
            return { ok: false, reason: 'the glTF JSON does not parse' };
        }
        var ext = (json && json.extensions) || {};
        var vrm1 = ext.VRMC_vrm && ext.VRMC_vrm.humanoid && ext.VRMC_vrm.humanoid.humanBones;
        if (vrm1 && vrm1.hips) return { ok: true, spec: 'VRM1' };
        var vrm0 = ext.VRM && ext.VRM.humanoid && ext.VRM.humanoid.humanBones;
        if (Array.isArray(vrm0) && vrm0.some((bone) => bone && bone.bone === 'hips')) return { ok: true, spec: 'VRM0' };
        if (vrm1 || vrm0) return { ok: false, reason: 'the VRM humanoid has no hips' };
        return { ok: false, reason: 'not a VRM (no humanoid)' };
    }

    async function sha256Hex(buffer, digest) {
        if (digest) return digest(buffer);
        var subtle = global.crypto && global.crypto.subtle;
        if (!subtle && typeof require === 'function') subtle = require('crypto').webcrypto.subtle;
        var hash = await subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(hash))
            .map(function (b) {
                return b.toString(16).padStart(2, '0');
            })
            .join('');
    }

    /** Check downloaded bytes against the look: size, hash, VRM. {ok, reason?, spec?}. */
    async function verifyBytes(buffer, look, options) {
        options = options || {};
        var length = buffer.byteLength;
        if (length > LIMITS.vrmBytes) return { ok: false, reason: 'the file is larger than a look may be' };
        if (look.bytes && look.bytes !== length) return { ok: false, reason: 'the file is not the size its pack says' };
        if (look.sha256) {
            var actual = await sha256Hex(buffer, options.digest);
            if (actual !== look.sha256) return { ok: false, reason: 'the file does not match its pack (SHA-256)' };
        }
        return inspectVrm(buffer);
    }

    /**
     * Download a look, verify it, and hand back a URL the loader can use without fetching
     * again: {url, revoke}. The `#look.vrm` fragment is for AvatarManager, which decides
     * VRM-or-glTF by the URL's extension; a fragment is never sent in a blob fetch.
     */
    async function fetchVerified(look, options) {
        options = options || {};
        var fetchImpl = options.fetchImpl || global.fetch.bind(global);
        var response = await fetchImpl(look.vrmUrl);
        if (!response.ok) throw new Error('The look could not be downloaded (' + response.status + ').');
        var buffer = await response.arrayBuffer();
        var verdict = await verifyBytes(buffer, look, options);
        if (!verdict.ok) {
            var error = new Error('This look was not worn: ' + verdict.reason + '.');
            error.reason = 'look_failed_verification';
            throw error;
        }
        var URLImpl = options.URLImpl || global.URL;
        var objectUrl = URLImpl.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
        return {
            url: objectUrl + '#look.vrm',
            revoke: function () {
                URLImpl.revokeObjectURL(objectUrl);
            },
        };
    }

    var api = {
        SUPPORTED_SCHEMA: SUPPORTED_SCHEMA,
        RATINGS: RATINGS,
        LIMITS: LIMITS,
        ORIGIN_LABELS: ORIGIN_LABELS,
        validateManifest: validateManifest,
        resolveArtifactUrl: resolveArtifactUrl,
        visibility: visibility,
        inspectVrm: inspectVrm,
        sha256Hex: sha256Hex,
        verifyBytes: verifyBytes,
        fetchVerified: fetchVerified,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_WARDROBE_PACK_VALIDATOR = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
