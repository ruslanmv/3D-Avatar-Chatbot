/**
 * W11. Checking and installing a wardrobe pack on disk — the core of
 * `npm run wardrobe:import` and `npm run wardrobe:check`, and of the Jest test that keeps
 * the shipped `vendor/wardrobe/` honest.
 *
 * The browser validates a manifest and each look as it is worn. This does the whole pack,
 * every byte, before anything is committed — the rule is that a malformed pack fails at
 * import, not in front of someone inside Three.js. On top of WardrobePackValidator it
 * requires what only the shipped pack must satisfy:
 *
 * - **Every look is general.** `vendor/wardrobe/` is served to every visitor with no
 *   gate in front of it; a pack whose visibility is not `public` is refused whole.
 * - **Every avatar is one this app ships, byte for byte.** A look is fitted to an exact
 *   file: `avatars[].sourceSha256` must equal the pin in AvatarIdentity for that slug, so a
 *   pack made from a different AvatarSample A cannot install.
 * - **Every file is accounted for.** Sizes and SHA-256 match, each VRM has a humanoid,
 *   each preview is an image, and nothing sits in the folder that the manifest does not
 *   name — an orphan is 15 MB of git history nobody can use.
 * - **A pack is installed whole or not at all.** It is written beside the old one and
 *   swapped in with two renames; a failure leaves the old wardrobe exactly as it was.
 *
 * CommonJS on purpose (`.cjs` in a `"type": "module"` package): Jest requires it, and the
 * ESM command line imports it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * Load a `src/wardrobe` module from either world. Under Jest (CommonJS) `require` returns
 * its exports. Under node, `"type": "module"` makes the `.js` an ES module, its
 * `typeof module` branch never fires, `require` hands back an empty namespace and the module
 * registers itself on `globalThis` instead — the trap `tools/ambience/export-camera-contract.mjs`
 * documents. Reading the global is the load-bearing half, not a fallback.
 */
function load(file, globalName, member) {
    const required = require(file);
    if (required && required[member]) return required;
    if (globalThis[globalName]) return globalThis[globalName];
    throw new Error(`${file} did not export or register itself`);
}

const Validator = load('../src/wardrobe/WardrobePackValidator.js', 'NEXUS_WARDROBE_PACK_VALIDATOR', 'validateManifest');
const Identity = load('../src/wardrobe/AvatarIdentity.js', 'NEXUS_AVATAR_IDENTITY', 'LIBRARY');

const MANIFESTS = new Set(['wardrobe.json', 'provenance.json', 'catalog.json']);
const LIMITS = { files: 400, packBytes: 700 * 1024 * 1024, jsonBytes: 2 * 1024 * 1024 };

/** Is this a path a pack may contain? Relative, no dot segments, only known places. */
function safeEntry(name) {
    if (!name || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name)) return false;
    const parts = name.split('/');
    if (parts.some((part) => part === '' || part === '.' || part === '..')) return false;
    return MANIFESTS.has(name) || (parts[0] === 'looks' && /\.(vrm|webp|png|jpe?g|json)$/i.test(name));
}

/**
 * Read a zip into {name: Buffer}, refusing anything unsafe before inflating it. A pack is
 * produced by `tools/export_default_wardrobe.py --zip`: stored VRMs and previews, deflated
 * JSON — no encryption, no zip64.
 */
function readZip(buffer) {
    const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end < 0) throw new Error('not a zip file');
    const total = buffer.readUInt16LE(end + 10);
    if (total > LIMITS.files) throw new Error(`the zip has ${total} files; a pack has at most ${LIMITS.files}`);
    let offset = buffer.readUInt32LE(end + 16);
    const files = {};
    let unpacked = 0;
    for (let i = 0; i < total; i += 1) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('the zip directory is damaged');
        const flags = buffer.readUInt16LE(offset + 8);
        const method = buffer.readUInt16LE(offset + 10);
        const compressed = buffer.readUInt32LE(offset + 20);
        const size = buffer.readUInt32LE(offset + 24);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const external = buffer.readUInt32LE(offset + 38);
        const local = buffer.readUInt32LE(offset + 42);
        const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
        offset += 46 + nameLength + extraLength + commentLength;
        if (name.endsWith('/')) continue; // a directory entry
        if (!safeEntry(name)) throw new Error(`the zip contains a path a pack may not: ${JSON.stringify(name)}`);
        if (flags & 0x1) throw new Error(`${name} is encrypted`);
        if (((external >>> 16) & 0o170000) === 0o120000) throw new Error(`${name} is a symbolic link`);
        unpacked += size;
        if (unpacked > LIMITS.packBytes) throw new Error('the pack is larger than a wardrobe may be');
        const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
        const data = buffer.subarray(start, start + compressed);
        let bytes;
        if (method === 0) bytes = Buffer.from(data);
        else if (method === 8) bytes = zlib.inflateRawSync(data, { maxOutputLength: size + 1 });
        else throw new Error(`${name} uses an unsupported compression method (${method})`);
        if (bytes.length !== size) throw new Error(`${name} is not the size the zip says`);
        files[name] = bytes;
    }
    return files;
}

/** Read a pack folder into {name: Buffer}, refusing symlinks and unknown paths. */
function readDir(root) {
    const files = {};
    let unpacked = 0;
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            const name = path.relative(root, full).split(path.sep).join('/');
            if (entry.isSymbolicLink()) throw new Error(`${name} is a symbolic link`);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!safeEntry(name)) throw new Error(`the pack contains a file a pack may not: ${name}`);
            files[name] = fs.readFileSync(full);
            unpacked += files[name].length;
            if (Object.keys(files).length > LIMITS.files) throw new Error('the pack has too many files');
            if (unpacked > LIMITS.packBytes) throw new Error('the pack is larger than a wardrobe may be');
        }
    };
    walk(root);
    return files;
}

function isImage(bytes) {
    const riff =
        bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
    const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    return riff || png || jpeg;
}

/**
 * Check a pack held in memory. Answers {ok, problems: [string], manifest, looks}.
 *
 *   files     {path: Buffer}
 *   options   {library: AvatarIdentity.LIBRARY (the pins), requirePublic: true}
 */
async function checkPack(files, options = {}) {
    const problems = [];
    const library = options.library || Identity.LIBRARY;
    const requirePublic = options.requirePublic !== false;
    const raw = files['wardrobe.json'];
    if (!raw) return { ok: false, problems: ['the pack has no wardrobe.json'], manifest: null, looks: [] };
    if (raw.length > LIMITS.jsonBytes) return { ok: false, problems: ['wardrobe.json is too large'], looks: [] };
    let manifest;
    try {
        manifest = JSON.parse(raw.toString('utf8'));
    } catch (error) {
        return { ok: false, problems: [`wardrobe.json does not parse: ${error.message}`], manifest: null, looks: [] };
    }
    if (manifest.schemaVersion !== Validator.SUPPORTED_SCHEMA) {
        problems.push(
            `a shipped pack is schema ${Validator.SUPPORTED_SCHEMA}; this one says ${manifest.schemaVersion}`
        );
    }
    const root = 'file:///pack/';
    const result = Validator.validateManifest(manifest, { manifestUrl: root + 'wardrobe.json', origin: 'builtin' });
    if (!result.ok) return { ok: false, problems: [result.reason], manifest, looks: [] };
    result.rejected.forEach((entry) => problems.push(`look ${entry.id}: ${entry.reason}`));
    if (requirePublic && manifest.visibility !== 'public') {
        problems.push('a shipped pack must be public (every look general)');
    }

    const pins = new Map(library.map((entry) => [entry.slug, entry]));
    const avatars = new Map();
    for (const avatar of Array.isArray(manifest.avatars) ? manifest.avatars : []) {
        const pin = pins.get(avatar && avatar.avatarId);
        if (!pin) {
            problems.push(`avatar ${avatar && avatar.avatarId}: not an avatar this app ships`);
            continue;
        }
        if (String(avatar.sourceSha256 || '').toLowerCase() !== pin.sha256) {
            problems.push(`avatar ${avatar.avatarId}: made from a different file than vendor/avatars/${pin.file}`);
        }
        if (!avatar.license || !avatar.license.spdx) problems.push(`avatar ${avatar.avatarId}: no licence`);
        avatars.set(avatar.avatarId, avatar);
    }

    const named = new Set(MANIFESTS);
    for (const look of result.looks) {
        const where = `look ${look.avatarId}/${look.id}`;
        if (!look.avatarId || !avatars.has(look.avatarId)) problems.push(`${where}: its avatar is not listed`);
        if (requirePublic && look.rating !== 'general') problems.push(`${where}: rated ${look.rating || 'unrated'}`);
        if (!look.license.spdx) problems.push(`${where}: no licence`);
        const vrmPath = look.vrmUrl.slice(root.length);
        const vrm = files[vrmPath];
        named.add(vrmPath);
        if (!vrm) {
            problems.push(`${where}: ${vrmPath} is missing`);
        } else {
            const verdict = await Validator.verifyBytes(vrm, look);
            if (!verdict.ok) problems.push(`${where}: ${verdict.reason}`);
        }
        if (look.previewUrl) {
            const previewPath = look.previewUrl.slice(root.length);
            const preview = files[previewPath];
            named.add(previewPath);
            if (!preview) problems.push(`${where}: ${previewPath} is missing`);
            else if (!isImage(preview)) problems.push(`${where}: the preview is not an image`);
            else if (look.previewSha256 && (await Validator.sha256Hex(preview)) !== look.previewSha256) {
                problems.push(`${where}: the preview does not match its pack (SHA-256)`);
            }
        }
    }
    Object.keys(files)
        .filter((name) => !named.has(name))
        .forEach((name) => problems.push(`${name}: in the pack but named by nothing in wardrobe.json`));
    return { ok: problems.length === 0, problems, manifest, looks: result.looks };
}

function readPack(source) {
    const stat = fs.statSync(source);
    return stat.isDirectory() ? readDir(source) : readZip(fs.readFileSync(source));
}

/**
 * Check `source` (a folder or a zip) and install it as `target`, whole, or change nothing.
 * Answers the check result; `installed` is true when the swap happened.
 */
async function installPack(source, target, options = {}) {
    const files = readPack(source);
    const result = await checkPack(files, options);
    if (!result.ok || options.dryRun) return { ...result, installed: false };
    const stamp = `${process.pid}-${Date.now()}`;
    const staging = `${target}.incoming-${stamp}`;
    const previous = `${target}.previous-${stamp}`;
    try {
        for (const [name, bytes] of Object.entries(files)) {
            const full = path.join(staging, ...name.split('/'));
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, bytes);
        }
        if (fs.existsSync(target)) fs.renameSync(target, previous);
        fs.renameSync(staging, target);
    } catch (error) {
        if (!fs.existsSync(target) && fs.existsSync(previous)) fs.renameSync(previous, target);
        fs.rmSync(staging, { recursive: true, force: true });
        throw error;
    }
    fs.rmSync(previous, { recursive: true, force: true });
    return { ...result, installed: true };
}

module.exports = { checkPack, installPack, readDir, readZip, readPack, safeEntry, LIMITS };
