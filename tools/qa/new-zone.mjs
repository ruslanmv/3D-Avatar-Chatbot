#!/usr/bin/env node
/**
 * AX11. Start a new zone of the Nexus world: a planned entry in the atlas with a complete brief,
 * then the audits regenerated so the Quality Lab's World atlas shows it with its next steps.
 *
 *   node tools/qa/new-zone.mjs harbor-market --region town --title "Harbor market" \
 *       --purpose "browse stalls together at dusk" --mood "busy, warm lanterns, sea air" \
 *       --activities relax,story --spots stall,pier-end,fountain --devices desktop,mobile,vr \
 *       --assets "market stalls kit (CC0), harbor panorama (CC0)" --links neon-street [--dry-run]
 *
 * Why a brief first. A zone that starts as a GLB dropped into the catalogue tends to arrive
 * without a reason to be there, spots nobody planned, and no phone version. The brief states the
 * purpose, the spots she will need, the devices it must run on and the assets with their licence
 * before any art is chosen; the audit then turns it into a checklist and refuses an incomplete one.
 * Planned zones never reach the app: the runtime reads only assets/vr-worlds/worlds.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, auditAtlas } from './world-audit.mjs';
import { writeHub } from './hub.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const ATLAS = path.join(ROOT, 'quality-lab/data/atlas/atlas.json');

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const list = (name) =>
    String(arg(name, ''))
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);

function main() {
    const id = process.argv[2];
    const atlas = JSON.parse(fs.readFileSync(ATLAS, 'utf8'));
    const errors = [];
    if (!id || !/^[a-z0-9-]{1,40}$/.test(id)) errors.push('zone id: lowercase letters, digits and dashes');
    if (atlas.zones.some((z) => z.id === id)) errors.push(`zone ${id} already exists`);
    const region = arg('region', '');
    if (!atlas.regions.some((r) => r.id === region))
        errors.push(`--region must be one of: ${atlas.regions.map((r) => r.id).join(', ')}`);
    const devices = list('devices');
    if (!devices.length || devices.some((d) => !['desktop', 'mobile', 'vr'].includes(d)))
        errors.push('--devices: some of desktop, mobile, vr');
    const links = list('links');
    for (const l of links) if (!atlas.zones.some((z) => z.id === l)) errors.push(`--links: unknown zone ${l}`);

    const zone = {
        id,
        region,
        title: arg('title', id),
        status: 'planned',
        links,
        brief: {
            purpose: arg('purpose', ''),
            mood: arg('mood', ''),
            activities: list('activities'),
            spotsWanted: list('spots'),
            devices,
            assets: list('assets'),
        },
    };
    if (errors.length) {
        console.error(errors.map((e) => '✗ ' + e).join('\n'));
        process.exit(2);
    }
    const next = { ...atlas, zones: [...atlas.zones, zone] };
    if (process.argv.includes('--dry-run')) {
        console.log(JSON.stringify(zone, null, 4));
        return;
    }
    fs.writeFileSync(ATLAS, JSON.stringify(next, null, 4) + '\n');
    const worldAudit = audit();
    const atlasAudit = auditAtlas(worldAudit);
    fs.writeFileSync(
        path.join(ROOT, 'quality-lab/data/3d/worlds-audit.json'),
        JSON.stringify(worldAudit, null, 4) + '\n'
    );
    fs.writeFileSync(
        path.join(ROOT, 'quality-lab/data/atlas/atlas-audit.json'),
        JSON.stringify(atlasAudit, null, 4) + '\n'
    );
    writeHub();
    const z = atlasAudit.zones.find((x) => x.id === id);
    for (const i of z.issues) console.log(`${i.severity}: ${i.text}`);
    console.log(`planned ${id} in ${region}. Next:\n` + z.next.map((n, k) => `  ${k + 1}. ${n}`).join('\n'));
}

main();
