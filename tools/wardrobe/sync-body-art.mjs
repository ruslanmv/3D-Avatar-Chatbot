#!/usr/bin/env node
// PT1. Refresh assets/wardrobe/body-art.json — the offline copy of the tattoo catalogue —
// from a running Wardrobe Forge's GET /v1/body-art (Forge BA1).
//
//   node tools/wardrobe/sync-body-art.mjs [forge-url]     (default: the Hugging Face Space)
//
// Try-On's Private tab lists tattoos from the Forge; this is what it lists while the Forge
// cannot answer (asleep, offline), exactly as assets/wardrobe/outfits.json is for outfits.
// It is Forge's catalogue verbatim — ids, names, placements, Forge's own ratings and each
// design's licence — and nothing here edits one. A tattoo is still made only by a Forge,
// which checks the design and placement again on every job. The result is checked with the
// page's own normalizer before it is saved.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
// The package is "type": "module", so Node loads the IIFE as ESM: it then publishes on the
// global (its browser path) rather than on module.exports. Read it from wherever it landed.
const loaded = require(path.join(root, 'src/wardrobe/OutfitDictionary.js'));
const { normalizeBodyArt } = loaded && loaded.normalizeBodyArt ? loaded : globalThis.NEXUS_OUTFIT_DICTIONARY;
const DEFAULT = 'https://ruslanmv-3d-wardrobe-forge.hf.space';
const base = String(process.argv[2] || DEFAULT).replace(/\/+$/, '');
const target = path.join(root, 'assets/wardrobe/body-art.json');

const response = await fetch(`${base}/v1/body-art`);
if (!response.ok) {
    console.error(`${base}/v1/body-art answered ${response.status}; the snapshot is unchanged.`);
    process.exit(1);
}
const catalogue = await response.json();
const checked = normalizeBodyArt(catalogue);
if (!checked || checked.designs.length !== catalogue.designs.length) {
    console.error('The Forge catalogue did not pass the page normalizer; the snapshot is unchanged.');
    process.exit(1);
}
const snapshot = {
    source: 'https://github.com/ruslanmv/3D-Wardrobe-Forge (assets/body_art), exported from GET /v1/body-art',
    license: 'Apache-2.0',
    placements: catalogue.placements.map(({ id, name, rating, facing, region }) => ({
        id,
        name,
        rating,
        facing,
        region,
    })),
    designs: catalogue.designs.map(({ id, name, family, placements, ratings, description, license }) => ({
        id,
        name,
        family,
        placements,
        ratings,
        description,
        license,
    })),
};
writeFileSync(target, `${JSON.stringify(snapshot, null, 4)}\n`);
console.log(`${snapshot.designs.length} designs written to assets/wardrobe/body-art.json — run prettier on it.`);
