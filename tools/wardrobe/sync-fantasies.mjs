#!/usr/bin/env node
// FN1. Refresh assets/wardrobe/fantasies.json — Forge's fantasy catalogue, verbatim — from a
// Forge checkout (the file is assets/fantasies/fantasies.json there).
//
//   node tools/wardrobe/sync-fantasies.mjs [path-to-forge-checkout]   (default: ../3d-wardrobe-forge)
//
// The chatbot never edits this file: a fantasy, its words in nine languages, its outfits and
// the banned words all come from Forge, so a word means the same outfits on both sides. The
// contract test (tests/wardrobe/fantasy-contract.test.js) fails when the two drift.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const forge = path.resolve(process.argv[2] || path.join(root, '../3d-wardrobe-forge'));
const source = path.join(forge, 'assets/fantasies/fantasies.json');
const catalogue = JSON.parse(readFileSync(source, 'utf8'));
if (!Array.isArray(catalogue.fantasies) || !catalogue.fantasies.length || !catalogue.banned) {
    console.error(`${source} is not a fantasy catalogue; nothing written.`);
    process.exit(1);
}
const target = path.join(root, 'assets/wardrobe/fantasies.json');
writeFileSync(target, `${JSON.stringify(catalogue, null, 4)}\n`);
console.log(`${catalogue.fantasies.length} fantasies written to assets/wardrobe/fantasies.json — run prettier on it.`);
