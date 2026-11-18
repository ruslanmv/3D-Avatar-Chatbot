#!/usr/bin/env node
/**
 * VW12. A world's `scene.at` / `turn` from one of its measured spots: never typed, never by eye.
 *
 *     node tools/vr/at-from-spot.mjs scenes/<file>.glb [spot-id] [--write]
 *
 * Reads assets/vr-worlds/spots/<file>.json (measure-spots.mjs) and takes the named spot, else the
 * first verified one with full-body framing, else the first verified one. Converts it exactly as
 * WorldSpots.placementFor does (turn = -facing, at = -R·p) and prints the two values. With
 * --write it sets them on every entry of assets/vr-worlds/worlds.json whose `scene.src` is this
 * file or its `-light` version, editing the text in place (worlds.json is never re-serialised:
 * see docs/claude/vr-worlds-and-playgrounds.md). The light version stands her where the full one
 * does, as docs/claude/adding-a-place.md asks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const write = process.argv.includes('--write');
const [scene, wanted] = args;
if (!scene) throw new Error('usage: at-from-spot.mjs scenes/<file>.glb [spot-id] [--write]');

const file = path.join(ROOT, 'assets/vr-worlds/spots', path.basename(scene, '.glb') + '.json');
const spots = JSON.parse(fs.readFileSync(file, 'utf8')).spots.filter((s) => s.verified === true);
const spot = wanted ? spots.find((s) => s.id === wanted) : spots.find((s) => s.framing === 'fullBody') || spots[0];
if (!spot) throw new Error(`${scene}: no verified spot${wanted ? ` "${wanted}"` : ''} in ${path.relative(ROOT, file)}`);

const r = (v) => Math.round(v * 1000) / 1000 + 0;
const turn = r(-spot.facingDeg);
const a = (turn * Math.PI) / 180;
const [x, y, z] = spot.position;
const at = [r(-(x * Math.cos(a) + z * Math.sin(a))), r(-y), r(-(-x * Math.sin(a) + z * Math.cos(a)))];
console.log(`${scene}: spot "${spot.id}" (${spot.framing}) → "at": [${at.join(', ')}], "turn": ${turn}`);

if (write) {
    const worldsFile = path.join(ROOT, 'assets/vr-worlds/worlds.json');
    let text = fs.readFileSync(worldsFile, 'utf8');
    const light = scene.replace(/\.glb$/, '-light.glb');
    let changed = 0;
    for (const src of [scene, light]) {
        const re = new RegExp(
            `("src": "${src.replace(/[.[\]]/g, '\\$&')}",\\s*"at": )\\[[^\\]]*\\](,\\s*"turn": )-?[0-9.]+`,
            'g'
        );
        text = text.replace(re, (_, head, mid) => {
            changed++;
            return `${head}[${at.join(', ')}]${mid}${turn}`;
        });
    }
    if (!changed) throw new Error(`no worlds.json entry has scene.src ${scene}`);
    fs.writeFileSync(worldsFile, text);
    console.log(`  written to ${changed} worlds.json entr${changed === 1 ? 'y' : 'ies'}`);
}
