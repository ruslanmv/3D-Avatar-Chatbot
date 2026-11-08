#!/usr/bin/env node
/**
 * AX12. The Quality Lab's front door for an AI coder: quality-lab/data/hub.json.
 *
 *   node tools/qa/hub.mjs            # regenerate (world-audit, lab-publish and new-zone call it too)
 *   node tools/qa/hub.mjs --check    # exit 1 if stale
 *
 * A session that starts cold should not have to read three areas, four JSON files and five docs to
 * find out what to do. hub.json is one small file: each area's headline numbers and a ranked list
 * of next actions, each with why it matters, the command that starts it and the files it touches.
 * Every action is derived from measured data — the latest published AI run, the world audit and
 * the atlas audit — never typed in, so it cannot recommend work that is already done.
 *
 * Ranking: 1 = blocks a device or a release gate, 2 = a measured quality gap, 3 = coverage that
 * is missing (no human review, no spots). Ties keep the order the rules below emit them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DATA = path.join(ROOT, 'quality-lab/data');
const OUT = path.join(DATA, 'hub.json');

const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));

export function buildHub() {
    const index = read('index.json');
    const latest = index.runs[0] ? read(index.runs[0].file) : null;
    const worlds = read('3d/worlds-audit.json');
    const atlas = read('atlas/atlas-audit.json');
    const actions = [];
    const add = (a) => actions.push(a);

    // ── AI quality ────────────────────────────────────────────────────────
    if (latest) {
        for (const r of latest.runs)
            if (r.summary.meanScore < 90)
                add({
                    id: `ai-score-${r.route}-${r.lang}`,
                    area: 'ai',
                    priority: 1,
                    title: `Raise ${r.route} · ${r.lang} above 90 (now ${r.summary.meanScore})`,
                    why: `Release gate T7. Flags: ${
                        Object.entries(r.summary.flags)
                            .map(([f, n]) => `${f} ×${n}`)
                            .join(', ') || 'none'
                    }.`,
                    command: `node tools/qa/character-lab.mjs --routes ${r.route} --langs ${r.lang}`,
                    files: ['TogetherCapability.js (Private prompt)', 'PrivateExperienceProfile.js'],
                });
        const mixed = latest.runs.filter((r) => r.summary.distinctServedModels > 1);
        if (mixed.length)
            add({
                id: 'ai-pin-model',
                area: 'ai',
                priority: 1,
                title: 'Serve one model per session',
                why: `Release gate T8: ${mixed.length} of ${latest.runs.length} runs were answered by more than one model (up to ${Math.max(...mixed.map((r) => r.summary.distinctServedModels))}).`,
                command: 'node tools/qa/character-lab.mjs --routes <pinned-route> --langs en,it',
                files: ['docs/qa/NEXUS_PREMIUM_RELEASE_GATES.md'],
            });
        const flags = {};
        for (const r of latest.runs)
            for (const [f, n] of Object.entries(r.summary.flags)) flags[f] = (flags[f] || 0) + n;
        for (const [f, n] of Object.entries(flags).sort((a, b) => b[1] - a[1]))
            if (n >= 2 && f !== 'empty')
                add({
                    id: `ai-flag-${f}`,
                    area: 'ai',
                    priority: 2,
                    title: `Reduce "${f}" (${n} replies in the latest run)`,
                    why: 'A rule Private’s prompt states that models still break; change the prompt, re-run, compare.',
                    command: `open quality-lab/?area=ai and filter Replies by "${f}"`,
                    files: ['TogetherCapability.js (Private prompt)'],
                });
        if (!(latest.humanReview || []).length)
            add({
                id: 'ai-human-review',
                area: 'ai',
                priority: 3,
                title: 'Record a human review of the latest run',
                why: 'Release gate T9: warmth and character are not scored by any script.',
                command: 'docs/qa/NEXUS_PREMIUM_EXPERIENCE_SCORECARD.md → humanReview in the run file',
                files: [index.runs[0] ? `quality-lab/data/${index.runs[0].file}` : 'quality-lab/data/runs/'],
            });
    }

    // ── 3D quality and the atlas ────────────────────────────────────────────
    const gates = {};
    for (const [device, ids] of Object.entries(atlas.summary.gateways))
        for (const id of ids) (gates[id] = gates[id] || []).push(device);
    for (const [id, devices] of Object.entries(gates)) {
        const w = worlds.worlds.find((x) => x.id === id);
        add({
            id: `3d-gateway-${id}`,
            area: '3d',
            priority: 1,
            title: `Make ${id} load on ${devices.join(' and ')}`,
            why: `It is the only way from home to the rest of the map on ${devices.join('/')}: ${devices.map((d) => `${atlas.summary.reachableFromHome[d]}/${atlas.summary.publicZones} zones walkable on ${d}`).join(', ')}.${w ? ` ${w.triangles.toLocaleString('en')} triangles; ${devices.map((d) => w.devices[d].why).join('; ')}.` : ''}`,
            command:
                'node tools/vr/subset-scene.mjs  (recipe in tools/vr/playground-subsets.json), then add the tier in worlds.json',
            files: ['assets/vr-worlds/worlds.json', 'tools/vr/playground-subsets.json'],
        });
    }
    const noSpots = worlds.worlds
        .filter((w) => w.issues.some((i) => /no measured spots/.test(i.text)))
        .map((w) => w.id);
    if (noSpots.length)
        add({
            id: '3d-spots',
            area: '3d',
            priority: 2,
            title: `Measure spots in ${noSpots.length} places`,
            why: `She cannot move within ${noSpots.join(', ')} (LW2).`,
            command: 'add targets to tools/vr/spot-targets.json, then node tools/vr/measure-spots.mjs <scene>',
            files: ['tools/vr/spot-targets.json', 'assets/vr-worlds/spots/'],
        });
    for (const w of worlds.worlds)
        for (const i of w.issues.filter((x) => x.severity === 'fail'))
            add({
                id: `3d-fail-${w.id}`,
                area: '3d',
                priority: 1,
                title: `Fix ${w.id}`,
                why: i.text,
                command: 'node tools/qa/world-audit.mjs',
                files: ['assets/vr-worlds/'],
            });
    for (const z of atlas.zones.filter((x) => x.status === 'planned'))
        add({
            id: `atlas-build-${z.id}`,
            area: 'atlas',
            priority: 2,
            title: `Build planned zone ${z.id}`,
            why: z.brief ? z.brief.purpose : 'planned in the atlas',
            command: z.next[0] || 'see its card in the World atlas',
            files: ['quality-lab/data/atlas/atlas.json', 'assets/vr-worlds/worlds.json'],
        });

    actions.sort((a, b) => a.priority - b.priority);
    return {
        schema: 1,
        generator: 'tools/qa/hub.mjs',
        readFirst: ['quality-lab/README.md', 'CLAUDE.md'],
        areas: {
            ai: latest
                ? {
                      latestRun: latest.id,
                      runs: index.runs.length,
                      scores: Object.fromEntries(latest.runs.map((r) => [`${r.route}·${r.lang}`, r.summary.meanScore])),
                      humanReviews: (latest.humanReview || []).length,
                  }
                : null,
            '3d': {
                worlds: worlds.summary.worlds,
                offered: worlds.summary.offered,
                fails: worlds.summary.fails,
                warns: worlds.summary.warns,
            },
            atlas: {
                zones: atlas.summary.zones,
                shipped: atlas.summary.shipped,
                planned: atlas.summary.planned,
                walkableFromHome: atlas.summary.reachableFromHome,
                publicZones: atlas.summary.publicZones,
            },
        },
        nextActions: actions,
    };
}

export function writeHub() {
    fs.writeFileSync(OUT, JSON.stringify(buildHub(), null, 4) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const text = JSON.stringify(buildHub(), null, 4) + '\n';
    if (process.argv.includes('--brief')) {
        // AX14. What the SessionStart hook prints: short, so it costs little context.
        const h = JSON.parse(text);
        const top = h.nextActions.slice(0, 3);
        console.log('NEXUS Quality Lab — top next actions (quality-lab/data/hub.json, MCP: lab_next_actions):');
        for (const a of top) console.log(`- P${a.priority} [${a.area}] ${a.title} — start: ${a.command}`);
        console.log(
            `${h.nextActions.length} open in all. Feature notes: CLAUDE.md ▸ Feature map. /lab-next takes the top one.`
        );
    } else if (process.argv.includes('--check')) {
        if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== text) {
            console.error('quality-lab/data/hub.json is out of date: run node tools/qa/hub.mjs');
            process.exit(1);
        }
        console.log('hub up to date');
    } else {
        fs.writeFileSync(OUT, text);
        const h = JSON.parse(text);
        console.log(`hub: ${h.nextActions.length} next actions`);
        for (const a of h.nextActions) console.log(`  P${a.priority} [${a.area}] ${a.title}`);
    }
}
