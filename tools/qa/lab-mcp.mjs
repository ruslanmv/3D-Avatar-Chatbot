#!/usr/bin/env node
/**
 * AX13. The Quality Lab as an MCP server, so Claude Code works the lab through typed tools instead of
 * reading the README and parsing JSON by hand.
 *
 *   registered in .mcp.json at the repository root (Claude Code asks once to enable it)
 *   node tools/qa/lab-mcp.mjs     # stdio, JSON-RPC 2.0, one message per line
 *
 * Why it helps, and what it does not do. The CLIs already exist; this does not make them faster.
 * What it changes is the cold start and the correctness: a new session asks `lab_next_actions` and
 * gets the ranked work with commands and files, asks `lab_world` for one world's whole record, scores
 * a candidate reply with `lab_score_reply` in milliseconds while it iterates on a prompt, and writes
 * lab data only through the generators (`lab_regenerate`, `lab_new_zone`), which validate. No tool
 * edits a run file or the catalogue by hand.
 *
 * Not exposed: the real-provider Character Lab. It needs the app running, a pairing token and
 * minutes per route; run `tools/qa/character-lab.mjs` from a shell and publish with lab-publish.
 *
 * No dependency: the protocol subset a tool server needs (initialize, tools/list, tools/call, ping)
 * is small, and adding the SDK would change package-lock.json for every install of the app.
 * Everything this process prints on stdout is protocol; logs go to stderr.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { audit, auditAtlas } from './world-audit.mjs';
import { buildHub, writeHub } from './hub.mjs';
import { loadScorer } from './lab-publish.mjs';
import { screenshot, shutdown } from './lab-screenshot.mjs';

// stdout is the protocol channel: nothing else may write to it
console.log = (...a) => console.error(...a);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DATA = path.join(ROOT, 'quality-lab/data');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const S = loadScorer();

const str = (description) => ({ type: 'string', description });
const strList = (description) => ({ type: 'array', items: { type: 'string' }, description });

export const TOOLS = [
    {
        name: 'lab_status',
        description:
            'Headline numbers for the three Quality Lab areas (AI quality, 3D quality, World atlas) and the files to read first. Start here.',
        inputSchema: { type: 'object', properties: {} },
        run: () => {
            const h = buildHub();
            return { readFirst: h.readFirst, areas: h.areas, openActions: h.nextActions.length };
        },
    },
    {
        name: 'lab_next_actions',
        description:
            'Ranked next actions derived from measured lab data (priority 1 blocks a device or release gate, 2 is a measured quality gap, 3 is missing coverage). Each has why, the command that starts it, and the files it touches.',
        inputSchema: {
            type: 'object',
            properties: { area: { type: 'string', enum: ['ai', '3d', 'atlas'] }, limit: { type: 'number' } },
        },
        run: (a) => {
            const list = buildHub().nextActions.filter((x) => !a.area || x.area === a.area);
            return list.slice(0, Number(a.limit) || list.length);
        },
    },
    {
        name: 'lab_worlds',
        description:
            'Compact list of catalogue worlds with desktop/mobile/VR availability, triangles, verified spots and issue counts, computed now from assets/vr-worlds/.',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['place', 'stand-in', 'activity world'] },
                missing_on: { type: 'string', enum: ['desktop', 'mobile', 'vr'] },
                issues_only: { type: 'boolean' },
            },
        },
        run: (a) =>
            audit()
                .worlds.filter(
                    (w) =>
                        (!a.kind || w.kind === a.kind) &&
                        (!a.missing_on || !w.devices[a.missing_on].ok) &&
                        (!a.issues_only || w.issues.length)
                )
                .map((w) => ({
                    id: w.id,
                    kind: w.kind,
                    rating: w.rating,
                    triangles: w.triangles,
                    desktop: w.devices.desktop.ok,
                    mobile: w.devices.mobile.ok,
                    vr: w.devices.vr.ok,
                    spots: w.spots ? w.spots.verified : 0,
                    issues: w.issues.length,
                })),
    },
    {
        name: 'lab_world',
        description:
            "One world's full audit record (files, preview, spots and scene hash match, devices with reasons, chips, issues) plus the atlas zone it belongs to.",
        inputSchema: {
            type: 'object',
            properties: { id: str('world id from assets/vr-worlds/worlds.json') },
            required: ['id'],
        },
        run: (a) => {
            const w = audit();
            const world = w.worlds.find((x) => x.id === a.id);
            if (!world) throw new Error(`no world ${a.id}`);
            const zone = auditAtlas(w).zones.find((z) => z.worlds.includes(a.id)) || null;
            return { world, zone };
        },
    },
    {
        name: 'lab_atlas',
        description:
            'The World atlas: regions, zone summaries (status, devices, links), walkable-from-home per device and the gateway zones that cut the map. Pass id for one zone in full.',
        inputSchema: { type: 'object', properties: { id: str('zone id (optional)') } },
        run: (a) => {
            const at = auditAtlas(audit());
            if (a.id) {
                const z = at.zones.find((x) => x.id === a.id);
                if (!z) throw new Error(`no zone ${a.id}`);
                return z;
            }
            return {
                summary: at.summary,
                regions: at.regions,
                zones: at.zones.map((z) => ({
                    id: z.id,
                    region: z.region,
                    status: z.status,
                    devices: z.devices,
                    links: z.links,
                })),
            };
        },
    },
    {
        name: 'lab_score_reply',
        description:
            "Score one companion reply with the deterministic Character Quality scorer (the rules Private's prompt states, language, repetition). Instant; use it while iterating on a prompt.",
        inputSchema: {
            type: 'object',
            properties: {
                text: str('the reply'),
                lang: { type: 'string', enum: ['en', 'it'] },
                asked_about_ai: { type: 'boolean', description: 'the person sincerely asked whether she is an AI' },
                previous: strList('her earlier replies, for repetition'),
                max_sentences: { type: 'number' },
            },
            required: ['text'],
        },
        run: (a) => ({
            ...S.score(a.text, {
                lang: a.lang,
                askedAboutAI: a.asked_about_ai === true,
                previous: a.previous || [],
                maxSentences: a.max_sentences || 4,
            }),
            weights: S.WEIGHTS,
        }),
    },
    {
        name: 'lab_replies',
        description: 'Recorded real-model replies from a published lab run, filterable by route, language and flag.',
        inputSchema: {
            type: 'object',
            properties: {
                run: str('run id (default: latest)'),
                route: str('e.g. free-best'),
                lang: { type: 'string', enum: ['en', 'it'] },
                flag: str('e.g. assistant-register'),
            },
        },
        run: (a) => {
            const index = read('index.json');
            const entry = a.run ? index.runs.find((r) => r.id === a.run) : index.runs[0];
            if (!entry) throw new Error('no such run');
            const doc = read(entry.file);
            const out = [];
            for (const r of doc.runs) {
                if ((a.route && r.route !== a.route) || (a.lang && r.lang !== a.lang)) continue;
                for (const t of r.turns)
                    if (!a.flag || t.flags.includes(a.flag))
                        out.push({
                            route: r.route,
                            lang: r.lang,
                            id: t.id,
                            user: t.user,
                            reply: t.reply,
                            score: t.score,
                            flags: t.flags,
                            servedModels: t.servedModels,
                            ms: t.ms,
                        });
            }
            return { run: doc.id, replies: out };
        },
    },
    {
        name: 'lab_new_zone',
        description:
            'Add a planned zone to the World atlas from a brief (validated by tools/qa/new-zone.mjs). dry_run defaults to true: it returns the zone without writing.',
        inputSchema: {
            type: 'object',
            properties: {
                id: str('lowercase-dashed id'),
                region: str('home | town | wilds | vistas | private'),
                title: str('display title'),
                purpose: str('why the two of you go there'),
                mood: str('light, sound, feel'),
                activities: strList('activities possible there'),
                spots: strList('spots she will need'),
                devices: { type: 'array', items: { type: 'string', enum: ['desktop', 'mobile', 'vr'] } },
                assets: strList('assets with licence'),
                links: strList('neighbouring zone ids'),
                dry_run: { type: 'boolean' },
            },
            required: ['id', 'region', 'purpose', 'mood', 'activities', 'spots', 'devices', 'assets'],
        },
        run: (a) => {
            const args = [path.join(HERE, 'new-zone.mjs'), a.id, '--region', a.region, '--title', a.title || a.id];
            for (const [flag, v] of [
                ['purpose', a.purpose],
                ['mood', a.mood],
                ['activities', (a.activities || []).join(',')],
                ['spots', (a.spots || []).join(',')],
                ['devices', (a.devices || []).join(',')],
                ['assets', (a.assets || []).join(',')],
                ['links', (a.links || []).join(',')],
            ])
                if (v) args.push('--' + flag, v);
            if (a.dry_run !== false) args.push('--dry-run');
            try {
                return {
                    written: a.dry_run === false,
                    output: execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' }),
                };
            } catch (e) {
                throw new Error(String(e.stderr || e.message).trim());
            }
        },
    },
    {
        name: 'lab_regenerate',
        description:
            'Regenerate the 3D audit, the atlas audit and hub.json from the files as they are now (after changing a world, the atlas or publishing a run). Returns the new summaries.',
        inputSchema: { type: 'object', properties: {} },
        run: () => {
            execFileSync(process.execPath, [path.join(HERE, 'world-audit.mjs')], { cwd: ROOT, encoding: 'utf8' });
            writeHub();
            const h = buildHub();
            return { areas: h.areas, openActions: h.nextActions.length };
        },
    },
    {
        name: 'lab_screenshot',
        description:
            'See a world (or any app path) on desktop (1280×800) and a phone (Pixel 7 emulation) and get the pictures inline, with requested → expected → shown world ids (VRWorlds.resolveFor at the page tier), tier, triangles, load time, console errors and the frame check. Reuses one Chromium and the app server (starts nexus-proxy on a free port if none answers). Writes only tmp/shots/. Headless SwiftShader render: evidence of what loads and how it is framed, NOT of frame rate or headset comfort.',
        inputSchema: {
            type: 'object',
            properties: {
                world: str('catalogue world id; opens /?vrWorld=<id>'),
                url: str('any app path instead of world, e.g. "/?area=atlas"'),
                devices: { type: 'array', items: { type: 'string', enum: ['desktop', 'mobile'] } },
                wait: { type: 'number', description: 'most ms to wait for the app and the world (default 60000)' },
                view: {
                    type: 'string',
                    enum: ['viewport', 'page'],
                    description: 'her viewport only (default) or the whole page',
                },
            },
        },
        run: (a) => screenshot(a),
    },
    {
        name: 'lab_check',
        description:
            'Is the committed lab data current? Runs the generators in --check mode (3D audit, atlas audit, hub). Run before committing.',
        inputSchema: { type: 'object', properties: {} },
        run: () => {
            const out = {};
            for (const [name, file] of [
                ['audits', 'world-audit.mjs'],
                ['hub', 'hub.mjs'],
            ]) {
                try {
                    execFileSync(process.execPath, [path.join(HERE, file), '--check'], {
                        cwd: ROOT,
                        encoding: 'utf8',
                        stdio: 'pipe',
                    });
                    out[name] = 'current';
                } catch (e) {
                    out[name] = String(e.stderr || e.message).trim();
                }
            }
            return out;
        },
    },
];

const INSTRUCTIONS =
    'NEXUS Quality Lab. Start with lab_status or lab_next_actions. Measure before and after a change; write lab data only through lab_regenerate, lab_new_zone or tools/qa/lab-publish.mjs; run lab_check and npm run validate before committing code and regenerated data together. Rules: quality-lab/README.md.';

export async function handle(msg) {
    const { id, method, params } = msg || {};
    const reply = (result) => ({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (method === 'initialize')
        return reply({
            protocolVersion: (params && params.protocolVersion) || '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'nexus-quality-lab', version: '1.0.0' },
            instructions: INSTRUCTIONS,
        });
    if (method === 'ping') return reply({});
    if (method === 'tools/list')
        return reply({
            tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        });
    if (method === 'tools/call') {
        const tool = TOOLS.find((t) => t.name === (params && params.name));
        if (!tool) return fail(-32602, `unknown tool ${params && params.name}`);
        try {
            const result = await tool.run((params && params.arguments) || {});
            // A tool that already speaks MCP content (pictures) is passed through as is.
            if (result && Array.isArray(result.content)) return reply(result);
            return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        } catch (e) {
            return reply({ content: [{ type: 'text', text: String(e.message || e) }], isError: true });
        }
    }
    if (id === undefined || id === null) return null; // a notification needs no answer
    return fail(-32601, `method not found: ${method}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const rl = readline.createInterface({ input: process.stdin });
    const pending = new Set();
    // stdin closed: answer what is in flight, then close Chromium and any app server we started.
    rl.on('close', async () => {
        await Promise.allSettled([...pending]);
        await shutdown();
        process.exit(0);
    });
    rl.on('line', (line) => {
        if (!line.trim()) return;
        let msg;
        try {
            msg = JSON.parse(line);
        } catch (_) {
            process.stdout.write(
                JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'
            );
            return;
        }
        const job = handle(msg).then((out) => {
            if (out) process.stdout.write(JSON.stringify(out) + '\n');
        });
        pending.add(job);
        job.finally(() => pending.delete(job));
    });
}
