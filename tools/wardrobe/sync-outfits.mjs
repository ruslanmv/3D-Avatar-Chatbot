#!/usr/bin/env node
// W15. Refresh assets/wardrobe/outfits.json — the offline copy of the outfit dictionary —
// from a running Wardrobe Forge's GET /v1/outfits (Forge OD1).
//
//   node tools/wardrobe/sync-outfits.mjs [forge-url]     (default: the Hugging Face Space)
//
// The snapshot is what Try-On and the companion fall back to when the Forge cannot answer,
// so it must be Forge's catalogue verbatim: ids, titles, groups, the request body a job
// sends, and Forge's own rating. Nothing here edits an entry; a rating is never written
// by hand. The result is checked with the same normalizer the page uses before it is saved.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
// The package is "type": "module", so Node loads the IIFE as ESM: it then publishes on the
// global (its browser path) rather than on module.exports. Read it from wherever it landed.
const loaded = require(path.join(root, 'src/wardrobe/OutfitDictionary.js'));
const { normalize } = loaded && loaded.normalize ? loaded : globalThis.NEXUS_OUTFIT_DICTIONARY;
const DEFAULT = 'https://ruslanmv-3d-wardrobe-forge.hf.space';
const base = String(process.argv[2] || DEFAULT).replace(/\/+$/, '');
const target = path.join(root, 'assets/wardrobe/outfits.json');

const response = await fetch(`${base}/v1/outfits`);
if (!response.ok) {
    console.error(`${base}/v1/outfits answered ${response.status}; the snapshot is unchanged.`);
    process.exit(1);
}
const catalogue = await response.json();
const checked = normalize(catalogue);
if (!checked || checked.outfits.length !== catalogue.outfits.length) {
    console.error('The Forge catalogue did not pass the page normalizer; the snapshot is unchanged.');
    process.exit(1);
}
const previous = JSON.parse(readFileSync(target, 'utf8'));
const snapshot = {
    version: catalogue.version,
    source: previous.source,
    license: previous.license,
    groups: catalogue.groups,
    outfits: catalogue.outfits.map(({ id, title, group, request, rating, slots, tags }) => ({
        id,
        title,
        group,
        request,
        rating,
        slots,
        tags,
    })),
};
writeFileSync(target, `${JSON.stringify(snapshot, null, 4)}\n`);
console.log(`${snapshot.outfits.length} outfits written to assets/wardrobe/outfits.json — run prettier on it.`);
