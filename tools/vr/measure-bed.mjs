#!/usr/bin/env node
/**
 * BS1. Measure each room's bed from its GLB and write it into the world's entry, as text.
 *
 *   node tools/vr/measure-bed.mjs [world-id …]     (no ids: every world with a bed prop)
 *
 * Writes `"bed": { "at": [x, z], "top": h, "length": l, "src": …, "sha": … }` on the line before the
 * world's `"preview"`, replacing an existing `"bed"` line. worlds.json is edited as text, never
 * parsed and re-written (AX15: a parse-and-write reflows the whole file). Re-run after changing a
 * bed prop or its model; tests/private-bed.test.js measures again and fails on any drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const FILE = path.join(ROOT, 'assets/vr-worlds/worlds.json');
const { measure, bedProp } = require('./bed-measure.cjs');

const only = process.argv.slice(2);
let text = fs.readFileSync(FILE, 'utf8');
const worlds = JSON.parse(text).worlds;
let written = 0;
for (const w of worlds) {
    if (only.length && !only.includes(w.id)) continue;
    const prop = bedProp(w);
    if (!prop) continue;
    const bed = measure(prop, path.join(ROOT, 'assets/vr-worlds', prop.src));
    const start = text.indexOf(`"id": "${w.id}"`);
    const end = text.indexOf('\n    }', start);
    let entry = text.slice(start, end);
    // The stored bed, on one line or as Prettier spreads it (no braces inside it).
    entry = entry.replace(/\n {6}"bed": \{[^}]*\},/g, '');
    const line = `\n      "bed": ${JSON.stringify(bed).replace(/,/g, ', ').replace(/:/g, ': ')},`;
    // Before the picture line; a light stand-in has none, so after its rating line instead.
    let at = entry.indexOf('\n      "preview"');
    if (at < 0) {
        const rating = entry.indexOf('\n      "rating"');
        at = rating < 0 ? -1 : entry.indexOf('\n', rating + 1);
    }
    if (at < 0) {
        console.warn(`${w.id}: no line to write the bed beside; skipped`);
        continue;
    }
    entry = entry.slice(0, at) + line + entry.slice(at);
    text = text.slice(0, start) + entry + text.slice(end);
    console.log(`${w.id}: bed at ${bed.at.join(', ')} · mattress ${bed.top} m · ${bed.length} m long`);
    written += 1;
}
fs.writeFileSync(FILE, text);
console.log(`${written} bed${written === 1 ? '' : 's'} measured`);
