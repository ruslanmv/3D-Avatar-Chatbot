#!/usr/bin/env node
/**
 * Install a published 3D-Ambience-Studio package into this app.
 *
 *     node tools/ambience/install-studio-package.mjs <package-dir> [--id ambient:terrace:night] [--dry-run]
 *
 * The Studio publishes to `data/public/environments/<id>/<version>/`; this app reads
 * `assets/ambient/backgrounds.json` and paths relative to its own root. Nothing connected the two,
 * so the last step of every batch was a person copying two files and hand-editing a JSON array —
 * which is exactly where a wrong path, a forgotten portrait variant or a duplicate id gets in.
 *
 * ## What it refuses to do
 *
 * A package missing either plate is rejected rather than installed as one picture. The runtime
 * would accept it happily and a phone would get a cropped landscape plate — the failure this whole
 * route exists to remove, arriving through the tool built to prevent it.
 *
 * It also refuses a package whose plates are not the master sizes the camera contract names. A
 * plate is composed for one projection; one that is not that shape was composed for something
 * else, whatever its manifest says.
 *
 * ## What it does not decide
 *
 * Whether a scene is any good. It copies, checks shapes and writes a catalogue entry; whether the
 * horizon sits where the contract wants it is a human judgement, made against the QA composites
 * the Studio leaves in its work directory.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOGUE = path.join(ROOT, 'assets', 'ambient', 'backgrounds.json');
const CONTRACT = path.join(ROOT, 'assets', 'ambient', 'camera-contract.json');

/** Studio variant → this app's catalogue field, and the contract profile that sizes it. */
const VARIANTS = [
    { studio: 'desktop', field: 'src', profile: 'landscape' },
    { studio: 'mobile', field: 'srcPortrait', profile: 'portrait' },
];

function fail(message) {
    console.error(`✗ ${message}`);
    process.exit(1);
}

/** Pixel dimensions of a WebP, read from the bitstream rather than trusted from the manifest. */
export function webpSize(file) {
    const buffer = fs.readFileSync(file);
    if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
    const format = buffer.toString('ascii', 12, 16);
    if (format === 'VP8 ') {
        return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (format === 'VP8L') {
        const bits = buffer.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (format === 'VP8X') {
        const w = buffer[24] | (buffer[25] << 8) | (buffer[26] << 16);
        const h = buffer[27] | (buffer[28] << 8) | (buffer[29] << 16);
        return { width: w + 1, height: h + 1 };
    }
    return null;
}

/** `ambient:<scene>:<variant>` — the id pattern the catalogue enforces at ingest. */
export function suggestId(manifest) {
    const slug = String(manifest.id || '')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-');
    const parts = slug.split('-').filter(Boolean);
    if (parts.length < 2) return `ambient:${parts[0] || 'scene'}:default`;
    const variant = parts[parts.length - 1];
    return `ambient:${parts.slice(0, -1).join('-')}:${variant}`;
}

export function checkPackage(dir, contract) {
    const manifestPath = path.join(dir, 'environment.json');
    if (!fs.existsSync(manifestPath)) return { problems: [`no environment.json in ${dir}`] };
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const problems = [];
    const plates = {};

    for (const { studio, profile } of VARIANTS) {
        const variant = manifest.variants?.[studio];
        if (!variant || variant.type !== 'plate') {
            // Both or neither. One plate installed as a whole scene is the exact failure this
            // route was built to remove.
            problems.push(`manifest has no "${studio}" plate — a scene needs both compositions`);
            continue;
        }
        const file = path.join(dir, variant.background);
        if (!fs.existsSync(file)) {
            problems.push(`${studio}: ${variant.background} is missing from the package`);
            continue;
        }
        const size = webpSize(file);
        const master = contract.profiles?.[profile]?.master;
        if (!size) {
            problems.push(`${studio}: ${variant.background} is not a readable WebP`);
        } else if (master && (size.width !== master.width || size.height !== master.height)) {
            problems.push(
                `${studio}: ${size.width}x${size.height} is not the ${profile} master ` +
                    `${master.width}x${master.height} — composed for a different camera`
            );
        } else {
            plates[studio] = { file, size };
        }
    }
    return { manifest, plates, problems };
}

function main() {
    const args = process.argv.slice(2);
    const dir = args.find((a) => !a.startsWith('--'));
    if (!dir) fail('usage: install-studio-package.mjs <package-dir> [--id ambient:a:b] [--dry-run]');
    const dryRun = args.includes('--dry-run');
    const idFlag = args.indexOf('--id');
    const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf-8'));

    const { manifest, plates, problems } = checkPackage(path.resolve(dir), contract);
    if (problems.length) {
        for (const problem of problems) console.error(`  - ${problem}`);
        fail(`refusing to install ${dir}`);
    }

    const id = idFlag > -1 ? args[idFlag + 1] : suggestId(manifest);
    const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, 'utf-8'));
    const night = /night|moonlight|starlight|twilight|dark/.test(manifest.id) ? 'dark' : 'light';
    const base = `assets/ambient/${night}/${manifest.id}`;

    const entry = {
        id,
        type: 'image',
        label: String(manifest.name || manifest.id)
            .split('—')[0]
            .trim(),
        variantLabel: String(manifest.name || '').includes('—')
            ? String(manifest.name).split('—').slice(1).join('—').trim()
            : '',
        src: `${base}.webp`,
        srcPortrait: `${base}-portrait.webp`,
        thumb: `${base}.webp`,
        focalPoint: 'center',
        intensity: 1,
        category: manifest.category || 'relax',
        tags: Array.isArray(manifest.tags) ? manifest.tags : [],
    };

    console.log(`${manifest.id} ${manifest.version} → ${id}`);
    for (const { studio, field } of VARIANTS) {
        console.log(
            `  ${studio.padEnd(8)} ${plates[studio].size.width}x${plates[studio].size.height} → ${entry[field]}`
        );
    }
    const digest = createHash('sha256').update(JSON.stringify(entry)).digest('hex').slice(0, 12);
    console.log(`  entry ${digest}`);

    if (dryRun) {
        console.log('\nDry run — nothing copied, nothing written.');
        return;
    }

    for (const { studio, field } of VARIANTS) {
        const target = path.join(ROOT, entry[field]);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(plates[studio].file, target);
    }

    const existing = catalogue.scenes.findIndex((s) => s.id === id);
    if (existing > -1) catalogue.scenes[existing] = entry;
    else catalogue.scenes.push(entry);
    fs.writeFileSync(CATALOGUE, `${JSON.stringify(catalogue, null, 2)}\n`, 'utf-8');
    console.log(`\n✓ installed. ${catalogue.scenes.length} scenes in the catalogue.`);
    console.log('  Record the provenance in assets/ambient/PROVENANCE.md before committing.');
}

// Only when run, so the helpers above stay importable by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
