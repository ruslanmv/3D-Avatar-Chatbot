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

/**
 * AX15. Every file a stand-in or gateway change touches. VW4 was told two and changed six: the test
 * that pinned "no stand-in", the provenance table, the VR worlds doc's "desktop only", the atlas
 * zone (its worlds list) and the roadmap (now generated). Tests are found by grepping for the id, so
 * the list stays right as tests move.
 */
function standInFiles(id) {
    const tests = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.test.js') && fs.readFileSync(p, 'utf8').includes(`'${id}'`))
                tests.push(path.relative(ROOT, p).split(path.sep).join('/'));
        }
    };
    walk(path.join(ROOT, 'tests'));
    return [
        'assets/vr-worlds/worlds.json',
        'tools/vr/playground-subsets.json',
        'assets/vr-worlds/PROVENANCE.md',
        'docs/VR_WORLDS.md',
        "quality-lab/data/atlas/atlas.json (the zone's worlds list)",
        ...tests.sort(),
    ];
}

/** Public zones walkable from home on a device if one more zone loaded there. */
function walkableIfOpened(atlas, openId, device) {
    const byId = new Map(atlas.zones.map((z) => [z.id, z]));
    const seen = new Set();
    const stack = ['apartment'];
    while (stack.length) {
        const id = stack.pop();
        const z = byId.get(id);
        if (!z || seen.has(id) || z.region === 'private' || !(z.devices[device] || id === openId)) continue;
        seen.add(id);
        for (const to of z.links) stack.push(to);
    }
    return seen.size;
}

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
        const after = Object.fromEntries(devices.map((d) => [d, walkableIfOpened(atlas, id, d)]));
        const total = atlas.summary.publicZones;
        add({
            id: `3d-gateway-${id}`,
            area: '3d',
            priority: 1,
            title: `Make ${id} load on ${devices.join(' and ')}`,
            // AX15. VW4 read "the only way" as "closing it reaches the whole map"; a second gateway
            // sat behind it. Say "first gateway" and give the number it actually opens.
            why: `The first gateway on ${devices.join('/')}: walkable from home ${devices
                .map((d) => `${atlas.summary.reachableFromHome[d]}/${total} → ${after[d]}/${total} on ${d}`)
                .join(
                    ', '
                )} if it loads there.${w ? ` ${w.triangles.toLocaleString('en')} triangles; ${devices.map((d) => w.devices[d].why).join('; ')}.` : ''}`,
            command:
                w && w.scene
                    ? `node tools/vr/subset-scene.mjs --list ${w.scene.src}  (choose nodes), add a recipe to tools/vr/playground-subsets.json, cut it, add ${id}-light to worlds.json`
                    : `give ${id} a light version or the missing tier in worlds.json`,
            files: standInFiles(id),
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
    const near = worlds.worlds.filter((w) => (w.vrNear || []).length);
    if (near.length)
        add({
            id: '3d-vr-comfort',
            area: '3d',
            priority: 3,
            title: `Check VR comfort near her spot in ${near.length} worlds`,
            why: `Scene parts within 1 m of her spot (boxes over-reach; some are on purpose): ${near.map((w) => w.id).join(', ')}.`,
            command: 'node tools/vr/subset-scene.mjs --list <scenes/x.glb>, then lab_screenshot or a headset',
            files: ['assets/vr-worlds/worlds.json', 'tools/vr/playground-subsets.json'],
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

const ROADMAP = path.join(ROOT, 'docs/engine/NEXUS_OPEN_WORLD_ROADMAP.md');
const START =
    '<!-- lab:where-we-are:start — generated by node tools/qa/hub.mjs from the lab audits; do not edit by hand -->';
const END = '<!-- lab:where-we-are:end -->';

/**
 * AX15. The roadmap's "Where we are" table, from the audits. It was typed by hand and went stale on
 * the first regenerate (VW4 had to edit it); now the hub writes it and `--check` covers it.
 */
export function whereWeAre() {
    const w = read('3d/worlds-audit.json').summary;
    const a = read('atlas/atlas-audit.json').summary;
    const gw = [...new Set(Object.values(a.gateways).flat())];
    const rows = [
        ['Worlds in the catalogue', `${w.worlds} (${w.places} places, ${w.standIns} phone stand-ins)`, '3D audit'],
        ['Zones on the map', `${a.zones} in ${a.regions} regions, ${a.publicZones} public`, 'atlas audit'],
        [
            'Offered on desktop / mobile / VR',
            `${w.offered.desktop} / ${w.offered.mobile} / ${w.offered.vr} worlds`,
            '3D audit',
        ],
        [
            'Walkable from home on desktop / mobile / VR',
            `${a.reachableFromHome.desktop} / ${a.reachableFromHome.mobile} / ${a.reachableFromHome.vr} of ${a.publicZones} public zones`,
            'atlas audit',
        ],
        [
            'First gateway cutting a device off',
            gw.length
                ? gw
                      .map(
                          (id) =>
                              '`' +
                              id +
                              '` (' +
                              Object.entries(a.gateways)
                                  .filter(([, ids]) => ids.includes(id))
                                  .map(([d]) => d)
                                  .join(', ') +
                              ')'
                      )
                      .join('; ')
                : 'none',
            'atlas audit',
        ],
        ['3D failures / warnings', `${w.fails} / ${w.warns}`, '3D audit'],
    ];
    return [
        START,
        '',
        '| Figure | Value | Source |',
        '| --- | --- | --- |',
        ...rows.map((r) => `| ${r.join(' | ')} |`),
        '',
        'Live figures and the ranked next actions: `quality-lab/data/hub.json`.',
        '',
        END,
    ].join('\n');
}

function roadmapWith(text) {
    const a = text.indexOf(START);
    const b = text.indexOf(END);
    if (a < 0 || b < 0) throw new Error('roadmap markers missing in ' + path.relative(ROOT, ROADMAP));
    return text.slice(0, a) + whereWeAre() + text.slice(b + END.length);
}

export function writeHub() {
    fs.writeFileSync(ROADMAP, roadmapWith(fs.readFileSync(ROADMAP, 'utf8')));
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
        const doc = fs.readFileSync(ROADMAP, 'utf8');
        if (roadmapWith(doc) !== doc) {
            console.error('the roadmap\'s "Where we are" is out of date: run node tools/qa/hub.mjs');
            process.exit(1);
        }
        console.log('hub up to date');
    } else {
        writeHub();
        const h = JSON.parse(text);
        console.log(`hub: ${h.nextActions.length} next actions`);
        for (const a of h.nextActions) console.log(`  P${a.priority} [${a.area}] ${a.title}`);
    }
}
