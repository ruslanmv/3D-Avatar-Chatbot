#!/usr/bin/env node
/**
 * SG8. One command for everything her body does in a conversation, before a release.
 *
 *   npm run audit:conversation
 *   node tools/qa/conversation-suite.mjs --avatars AvatarSample_A,Vita --skip motion
 *
 * Runs, one after another (each audit starts its own browser; running them side by side starves
 * the software renderer and turns timing into failures):
 *
 *   1. audits/gestures/run.mjs on every avatar: each gesture on each hand, whole replies gesture by
 *      gesture ("Hello! How are you today?", an Italian greeting, a conversation), and the positions
 *      matrix (standing, sitting, lying, turned away × sit, lie, stand, turn around, face me) with
 *      her hands checked while she talks in each position;
 *   2. audits/motion/run.mjs --quick: every gesture the model can ask for, the chat phrases, and
 *      the Pose Navigator presets.
 *
 * Then writes audits/suite/runs/<stamp>/summary.md: one verdict, every failure with the avatar and
 * the step, and where each audit's frames are. Exit 0 only when every audit passed. A QA tool: the
 * app never loads it. Private and VR are outside it on purpose.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const arg = (f, d) => (argv.includes(f) && argv[argv.indexOf(f) + 1] ? argv[argv.indexOf(f) + 1] : d);
const AVATARS = arg('--avatars', 'AvatarSample_A,Vita,VRM_Viewer_Sample');
const SKIP = new Set(arg('--skip', '').split(',').filter(Boolean));

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(ROOT, 'audits', 'suite', 'runs', stamp);
fs.mkdirSync(OUT, { recursive: true });

function run(label, args) {
    console.log(`\n▶ ${label}: node ${args.join(' ')}`);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    fs.writeFileSync(path.join(OUT, `${label}.log`), out);
    const report = (out.match(/report: (\S+report\.md)/) || [])[1] || null;
    const verdict = (out.match(/^(PASS|FAIL) — .*$/m) || [])[0] || `exit ${r.status}`;
    console.log(`  ${verdict} (${Math.round((Date.now() - t0) / 1000)} s)`);
    return { label, status: r.status, verdict, report };
}

function failures(reportMd) {
    if (!reportMd || !fs.existsSync(path.join(ROOT, reportMd))) return [];
    const text = fs.readFileSync(path.join(ROOT, reportMd), 'utf8');
    let avatar = '';
    const out = [];
    for (const line of text.split('\n')) {
        const h = line.match(/^## (.+)$/);
        if (h) avatar = h[1];
        if (/\| \*\*(fail|warn)\*\* \||\| (fail|warn) \|/.test(line))
            out.push(`${avatar}: ${line.replace(/\s+/g, ' ').slice(0, 220)}`);
    }
    return out;
}

const results = [];
if (!SKIP.has('gestures')) results.push(run('gestures', ['audits/gestures/run.mjs', '--avatars', AVATARS]));
if (!SKIP.has('motion')) results.push(run('motion', ['audits/motion/run.mjs', '--quick']));

const ok = results.every((r) => r.status === 0);
const md = [
    `# Conversation suite ${stamp}`,
    '',
    `**${ok ? 'PASS' : 'FAIL'}** — avatars: ${AVATARS}`,
    '',
    '| audit | verdict | report |',
    '|---|---|---|',
    ...results.map((r) => `| ${r.label} | ${r.verdict} | ${r.report || '—'} |`),
    '',
];
for (const r of results) {
    const list = failures(r.report);
    md.push(`## ${r.label}: ${list.length ? `${list.length} to look at` : 'nothing to look at'}`, '');
    md.push(...list.map((l) => `- ${l}`), '');
    if (r.report) md.push(`Frames: ${path.join(path.dirname(r.report), 'index.html')}`, '');
}
fs.writeFileSync(path.join(OUT, 'summary.md'), md.join('\n') + '\n');
console.log(`\n${ok ? 'PASS' : 'FAIL'} — summary: ${path.relative(ROOT, path.join(OUT, 'summary.md'))}`);
process.exit(ok ? 0 : 1);
