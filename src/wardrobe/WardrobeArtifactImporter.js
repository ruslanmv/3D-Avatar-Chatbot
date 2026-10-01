/**
 * W14. Import a wardrobe pack in the browser: read it, check it whole, keep it here.
 *
 * A pack comes from 3D-Wardrobe-Forge (the Studio's "Export pack", or
 * `GET /v1/wardrobes/{avatar}/pack.zip`). Importing it is the same act as shipping
 * one — `npm run wardrobe:import` does it for `vendor/wardrobe/` — except that the
 * result lives in this browser only (IndexedDB) and nothing is written to any server.
 *
 * A downloaded zip is untrusted input, so the rules are the shipped pack's rules, and
 * every one of them is checked before a byte is stored:
 *
 * - **The zip itself.** Only `wardrobe.json`, `provenance.json`, `catalog.json` and
 *   model/image/JSON files under `looks/`; no absolute paths, `..`, backslashes,
 *   symlinks or encryption; size limits read from the directory before anything is
 *   inflated. Nothing in a pack is executed or rendered as HTML.
 * - **The manifest** goes through WardrobePackValidator like every other source, and a
 *   pack with any look it rejects is refused whole: half a pack is a pack nobody made.
 * - **Every file** is checked against its SHA-256 and size, every VRM for a humanoid,
 *   every preview for an image. A v1 bundle (no hashes) is accepted as *unverified*;
 *   its hashes are taken at import so it cannot change underneath her afterwards.
 * - **Private packs need private mode.** A pack with any look above `general` imports
 *   only while private mode (18+) is on. Importing is not showing: those looks still
 *   appear only when Try-On's own private gate is open for the avatar she is — private
 *   mode *and* the avatar's owner's declaration (W10). A pack cannot say otherwise; the
 *   validator does not carry any permission field it writes.
 *
 * `ImportedWardrobeSource` is the registry's "Imported" source (priority 2, unrated
 * looks gated). Looks are served from object URLs over the stored blobs, with the
 * `#look.vrm` fragment AvatarManager reads the file type from.
 *
 * Exposes window.NEXUS_WARDROBE_IMPORTER.
 */
(function (global) {
    'use strict';

    var MANIFESTS = ['wardrobe.json', 'provenance.json', 'catalog.json'];
    var LIMITS = Object.freeze({ files: 400, packBytes: 700 * 1024 * 1024, jsonBytes: 2 * 1024 * 1024 });
    var ROOT = 'https://imported.pack/';
    var TYPES = {
        vrm: 'model/gltf-binary',
        webp: 'image/webp',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
    };

    function validator() {
        return global.NEXUS_WARDROBE_PACK_VALIDATOR || null;
    }

    /** May a pack contain this path? Relative, no dot segments, only known places and types. */
    function safeEntry(name) {
        if (!name || name.indexOf('\\') !== -1 || name.charAt(0) === '/' || /^[a-z]:/i.test(name)) return false;
        var parts = name.split('/');
        if (parts.some((part) => part === '' || part === '.' || part === '..')) return false;
        // avatars.json: a v1 bundle's AvatarManager list. Allowed so v1 imports; never read.
        if (name === 'avatars.json') return true;
        return MANIFESTS.indexOf(name) !== -1 || (parts[0] === 'looks' && /\.(vrm|webp|png|jpe?g|json)$/i.test(name));
    }

    async function inflateRaw(bytes) {
        if (typeof DecompressionStream !== 'undefined' && typeof Response !== 'undefined') {
            var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        }
        if (typeof require === 'function') return new Uint8Array(require('zlib').inflateRawSync(bytes));
        throw new Error('this browser cannot read compressed files in a zip');
    }

    function bytesOf(buffer) {
        return ArrayBuffer.isView(buffer)
            ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
            : new Uint8Array(buffer);
    }

    /**
     * Read a zip into {path: Uint8Array}. Everything unsafe is refused from the central
     * directory, before any entry is inflated. Only JSON may be compressed: a pack stores
     * its VRMs and previews (they are already compressed), and a compressed model is how a
     * few kilobytes become gigabytes in memory.
     */
    async function readZip(buffer, options) {
        options = options || {};
        var bytes = bytesOf(buffer);
        var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        var end = -1;
        for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
            if (view.getUint32(i, true) === 0x06054b50) {
                end = i;
                break;
            }
        }
        if (end < 0) throw new Error('This is not a zip file.');
        var total = view.getUint16(end + 10, true);
        if (total > LIMITS.files)
            throw new Error('The pack has ' + total + ' files; a pack has at most ' + LIMITS.files + '.');
        var offset = view.getUint32(end + 16, true);
        var decoder = new (typeof TextDecoder !== 'undefined' ? TextDecoder : require('util').TextDecoder)('utf-8');
        var files = {};
        var unpacked = 0;
        for (var n = 0; n < total; n += 1) {
            if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
                throw new Error('The zip is damaged.');
            }
            var flags = view.getUint16(offset + 8, true);
            var method = view.getUint16(offset + 10, true);
            var compressed = view.getUint32(offset + 20, true);
            var size = view.getUint32(offset + 24, true);
            var nameLength = view.getUint16(offset + 28, true);
            var extra = view.getUint16(offset + 30, true);
            var comment = view.getUint16(offset + 32, true);
            var external = view.getUint32(offset + 38, true);
            var local = view.getUint32(offset + 42, true);
            var name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
            offset += 46 + nameLength + extra + comment;
            if (name.charAt(name.length - 1) === '/') continue;
            if (!safeEntry(name)) throw new Error('The pack contains a file a pack may not: ' + JSON.stringify(name));
            if (flags & 0x1) throw new Error(name + ' is encrypted.');
            if (((external >>> 16) & 0o170000) === 0o120000) throw new Error(name + ' is a symbolic link.');
            if (method !== 0 && !/\.json$/i.test(name)) throw new Error(name + ' is compressed; a pack stores it.');
            if (/\.json$/i.test(name) && size > LIMITS.jsonBytes) throw new Error(name + ' is too large.');
            unpacked += size;
            if (unpacked > LIMITS.packBytes) throw new Error('The pack is larger than a wardrobe may be.');
            var start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
            var data = bytes.subarray(start, start + compressed);
            var out;
            if (method === 0) out = data.slice();
            else if (method === 8) out = await (options.inflateRaw || inflateRaw)(data);
            else throw new Error(name + ' uses a compression this app cannot read.');
            if (out.length !== size) throw new Error(name + ' is not the size the zip says.');
            files[name] = out;
        }
        return files;
    }

    function isImage(bytes) {
        var text = function (from, to) {
            return String.fromCharCode.apply(null, Array.from(bytes.subarray(from, to)));
        };
        var png = [0x89, 0x50, 0x4e, 0x47].every((b, i) => bytes[i] === b);
        return (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') || png || (bytes[0] === 0xff && bytes[1] === 0xd8);
    }

    function slug(value) {
        return (
            String(value || '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 48) || 'pack'
        );
    }

    /**
     * Check a pack held in memory, whole. Answers
     * {ok, problems: [sentence], summary, record, files}, where `record` is what the store
     * keeps (a manifest with a pack id, and the hash of every file) and `files` the bytes.
     *
     *   options   {privateOn: boolean}
     */
    async function inspectPack(files, options) {
        options = options || {};
        var V = options.validator || validator();
        var fail = function (problem) {
            return { ok: false, problems: [problem], summary: null, record: null, files: null };
        };
        if (!V) return fail('The wardrobe cannot check packs right now.');
        var raw = files['wardrobe.json'];
        if (!raw) return fail('This zip has no wardrobe.json, so it is not a wardrobe pack.');
        var manifest;
        try {
            manifest = JSON.parse(
                new (typeof TextDecoder !== 'undefined' ? TextDecoder : require('util').TextDecoder)().decode(raw)
            );
        } catch (_) {
            return fail('The pack’s wardrobe.json does not parse.');
        }
        if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.looks)) {
            return fail('The pack’s wardrobe.json lists no looks.');
        }
        var schema = manifest.schemaVersion === undefined ? 1 : manifest.schemaVersion;
        // A v1 bundle has no pack id; give it one from its owner and its own bytes, so two
        // bundles never share a key and importing the same one twice replaces it.
        var stored = JSON.parse(JSON.stringify(manifest));
        if (!stored.pack || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(stored.pack.id || ''))) {
            var digest = await V.sha256Hex(raw);
            stored.pack = Object.assign({}, stored.pack, {
                id: 'bundle-' + slug(stored.avatarId) + '-' + digest.slice(0, 8),
                version: (stored.pack && stored.pack.version) || 'imported',
            });
        }
        var result = V.validateManifest(stored, {
            manifestUrl: ROOT + stored.pack.id + '/wardrobe.json',
            origin: 'imported',
            sourceId: 'imported',
            sourceLabel: 'Imported',
        });
        if (!result.ok) return fail('This pack cannot be used: ' + result.reason + '.');
        var problems = result.rejected.map((entry) => 'Look ' + entry.id + ': ' + entry.reason + '.');
        if (!result.looks.length && !problems.length) problems.push('The pack has no looks.');

        var hashes = {};
        var named = {};
        var root = ROOT + stored.pack.id + '/';
        for (var i = 0; i < result.looks.length; i += 1) {
            var look = result.looks[i];
            var vrmPath = look.vrmUrl.indexOf(root) === 0 ? look.vrmUrl.slice(root.length) : null;
            var vrm = vrmPath && files[vrmPath];
            if (!vrm) {
                problems.push('Look ' + look.name + ': its model file is not in the pack.');
                continue;
            }
            var verdict = await V.verifyBytes(vrm, look);
            if (!verdict.ok) {
                problems.push('Look ' + look.name + ': ' + verdict.reason + '.');
                continue;
            }
            hashes[vrmPath] = look.sha256 || (await V.sha256Hex(vrm));
            named[vrmPath] = vrm;
            if (look.previewUrl) {
                var previewPath = look.previewUrl.slice(root.length);
                var preview = files[previewPath];
                if (!preview || !isImage(preview)) {
                    problems.push('Look ' + look.name + ': its preview is missing or not an image.');
                    continue;
                }
                if (look.previewSha256 && (await V.sha256Hex(preview)) !== look.previewSha256) {
                    problems.push('Look ' + look.name + ': its preview does not match the pack.');
                    continue;
                }
                named[previewPath] = preview;
            }
        }

        var gated = result.looks.filter((look) => look.rating !== 'general');
        var isPrivate = stored.visibility === 'private' || gated.length > 0;
        if (isPrivate && options.privateOn !== true) {
            problems.push(
                'This pack has private looks. Turn on private mode (18+) in Settings to import it; ' +
                    'they show only for avatars their owner declares adult.'
            );
        }
        var avatars = {};
        (Array.isArray(stored.avatars) ? stored.avatars : []).forEach((a) => {
            if (a && a.avatarId) avatars[a.avatarId] = a.name || a.avatarId;
        });
        result.looks.forEach((look) => {
            if (look.avatarId && !avatars[look.avatarId]) avatars[look.avatarId] = look.avatarId;
        });
        var licences = Array.from(new Set(result.looks.map((look) => look.license.spdx).filter(Boolean)));
        var summary = {
            id: stored.pack.id,
            version: stored.pack.version || null,
            name: result.pack.sourceName || stored.pack.id,
            looks: result.looks.length,
            avatars: Object.keys(avatars).map((id) => avatars[id]),
            verified: schema >= 2,
            licences: licences,
            private: isPrivate,
            gated: gated.length,
            bytes: Object.keys(named).reduce((sum, path) => sum + named[path].length, 0),
        };
        var ok = problems.length === 0;
        return {
            ok: ok,
            problems: problems,
            summary: summary,
            record: ok
                ? {
                      id: stored.pack.id,
                      manifest: stored,
                      hashes: hashes,
                      summary: summary,
                      importedAt: new Date().toISOString(),
                  }
                : null,
            files: ok ? named : null,
        };
    }

    // ------------------------------------------------------------------ storage

    /** In memory: for tests, and for a browser that will not open IndexedDB (private windows). */
    class MemoryPackStore {
        constructor() {
            this._packs = new Map();
        }
        async list() {
            return Array.from(this._packs.values()).map((entry) => entry.record);
        }
        async put(record, files) {
            this._packs.set(record.id, { record: record, files: files });
        }
        async files(id) {
            var entry = this._packs.get(id);
            return entry ? entry.files : {};
        }
        async remove(id) {
            return this._packs.delete(id);
        }
    }

    function request(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function done(tx) {
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('the import was cancelled'));
        });
    }

    /**
     * IndexedDB, this browser only. Two stores: `packs` (the record) and `files` (one Blob
     * per path, keyed `packId \u0000 path`), written in one transaction so a pack is either
     * all there or not there.
     */
    class IndexedDbPackStore {
        constructor(options) {
            options = options || {};
            this.idb = options.indexedDB || global.indexedDB;
            this.name = options.name || 'nexus-wardrobe-packs';
            this._db = null;
        }
        _open() {
            if (!this._db) {
                var open = this.idb.open(this.name, 1);
                open.onupgradeneeded = () => {
                    var db = open.result;
                    if (!db.objectStoreNames.contains('packs')) db.createObjectStore('packs', { keyPath: 'id' });
                    if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
                };
                this._db = request(open);
            }
            return this._db;
        }
        _range(id) {
            return IDBKeyRange.bound(id + '\u0000', id + '\u0001', false, true);
        }
        async list() {
            var db = await this._open();
            return request(db.transaction('packs').objectStore('packs').getAll());
        }
        async put(record, files) {
            var db = await this._open();
            var tx = db.transaction(['packs', 'files'], 'readwrite');
            var fileStore = tx.objectStore('files');
            fileStore.delete(this._range(record.id));
            Object.keys(files).forEach((path) => {
                var ext = path.split('.').pop().toLowerCase();
                fileStore.put(
                    new Blob([files[path]], { type: TYPES[ext] || 'application/json' }),
                    record.id + '\u0000' + path
                );
            });
            tx.objectStore('packs').put(record);
            return done(tx);
        }
        async files(id) {
            var db = await this._open();
            var store = db.transaction('files').objectStore('files');
            var range = this._range(id);
            var keys = await request(store.getAllKeys(range));
            var values = await request(store.getAll(range));
            var out = {};
            keys.forEach((key, i) => {
                out[String(key).slice(id.length + 1)] = values[i];
            });
            return out;
        }
        async remove(id) {
            var db = await this._open();
            var tx = db.transaction(['packs', 'files'], 'readwrite');
            tx.objectStore('files').delete(this._range(id));
            tx.objectStore('packs').delete(id);
            await done(tx);
            return true;
        }
    }

    function defaultStore() {
        try {
            if (global.indexedDB && typeof IDBKeyRange !== 'undefined') return new IndexedDbPackStore();
        } catch (error) {
            console.warn('[Wardrobe] IndexedDB unavailable; imported packs last until the page closes', error);
        }
        return new MemoryPackStore();
    }

    // ------------------------------------------------------------------ the source

    /** The registry's "Imported" source: stored packs, as normalized looks on object URLs. */
    class ImportedWardrobeSource {
        constructor(options) {
            options = options || {};
            this.store = options.store;
            this.URLImpl = options.URLImpl || global.URL;
            this._urls = new Map(); // pack id -> {path: object URL}
        }

        async _urlsFor(id) {
            if (!this._urls.has(id)) {
                var files = await this.store.files(id);
                var urls = {};
                Object.keys(files).forEach((path) => {
                    var blob = files[path] instanceof Blob ? files[path] : new Blob([files[path]]);
                    urls[path] = this.URLImpl.createObjectURL(blob);
                });
                this._urls.set(id, urls);
            }
            return this._urls.get(id);
        }

        release(id) {
            var urls = this._urls.get(id);
            if (!urls) return;
            Object.keys(urls).forEach((path) => this.URLImpl.revokeObjectURL(urls[path]));
            this._urls.delete(id);
        }

        async listLooks() {
            var V = validator();
            if (!V || !this.store) return [];
            var packs = await this.store.list();
            var looks = [];
            for (var i = 0; i < packs.length; i += 1) {
                var record = packs[i];
                try {
                    var result = V.validateManifest(record.manifest, {
                        manifestUrl: ROOT + record.id + '/wardrobe.json',
                        origin: 'imported',
                        sourceId: 'imported',
                        sourceLabel: 'Imported',
                    });
                    if (!result.ok) throw new Error(result.reason);
                    var urls = await this._urlsFor(record.id);
                    var root = ROOT + record.id + '/';
                    result.looks.forEach((look) => {
                        var vrmPath = look.vrmUrl.slice(root.length);
                        if (!urls[vrmPath]) return;
                        var previewPath = look.previewUrl ? look.previewUrl.slice(root.length) : null;
                        looks.push(
                            Object.assign({}, look, {
                                vrmUrl: urls[vrmPath] + '#look.vrm',
                                previewUrl: previewPath && urls[previewPath] ? urls[previewPath] : null,
                                // v1 looks had no hash; the one taken at import still guards the bytes.
                                sha256: look.sha256 || (record.hashes && record.hashes[vrmPath]) || null,
                                packName: record.summary && record.summary.name,
                            })
                        );
                    });
                } catch (error) {
                    console.warn('[Wardrobe] imported pack skipped:', record && record.id, error);
                }
            }
            return looks;
        }
    }

    // ------------------------------------------------------------------ the flow

    /**
     * What the UI calls: prepare(file) checks and summarises without storing anything;
     * the answer's commit() stores it. list() and remove(id) manage what was imported.
     *
     *   options  {store, source (ImportedWardrobeSource), privateOn() -> boolean, onChange()}
     */
    class WardrobeImporter {
        constructor(options) {
            options = options || {};
            this.store = options.store || defaultStore();
            this.source = options.source || new ImportedWardrobeSource({ store: this.store });
            this.privateOn = options.privateOn || (() => false);
            this.onChange = options.onChange || function () {};
        }

        async prepare(file) {
            var buffer;
            try {
                buffer = file && typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : file;
                if (!buffer || buffer.byteLength > LIMITS.packBytes)
                    throw new Error('The pack is too large to import.');
                var files = await readZip(buffer);
                var checked = await inspectPack(files, { privateOn: this.privateOn() === true });
                return Object.assign(checked, {
                    commit: async () => {
                        if (!checked.ok) throw new Error(checked.problems[0]);
                        this.source.release(checked.record.id);
                        await this.store.put(checked.record, checked.files);
                        this.onChange();
                        return checked.summary;
                    },
                });
            } catch (error) {
                return { ok: false, problems: [error.message || String(error)], summary: null, commit: null };
            }
        }

        async list() {
            return (await this.store.list()).map((record) => Object.assign({ id: record.id }, record.summary));
        }

        async remove(id) {
            this.source.release(id);
            await this.store.remove(id);
            this.onChange();
        }
    }

    var api = {
        LIMITS: LIMITS,
        safeEntry: safeEntry,
        readZip: readZip,
        inspectPack: inspectPack,
        MemoryPackStore: MemoryPackStore,
        IndexedDbPackStore: IndexedDbPackStore,
        ImportedWardrobeSource: ImportedWardrobeSource,
        WardrobeImporter: WardrobeImporter,
        defaultStore: defaultStore,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_WARDROBE_IMPORTER = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
