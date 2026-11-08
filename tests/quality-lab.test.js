/**
 * AX9. The Quality Lab site's data stays honest: every run file is schema 1, listed in the index,
 * free of token-like strings, and scored by the scorer as it is today — so a scorer change cannot
 * land without its rescoring (`node tools/qa/lab-publish.mjs --rescore-all`).
 */
const fs = require('fs');
const path = require('path');
const S = require('../tools/qa/CharacterQualityScorer.js');

const DATA = path.join(__dirname, '..', 'quality-lab', 'data');
const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
const files = fs.readdirSync(path.join(DATA, 'runs')).filter((f) => f.endsWith('.json'));
const docs = files.map((f) => [f, JSON.parse(fs.readFileSync(path.join(DATA, 'runs', f), 'utf8'))]);

describe('Quality Lab data', () => {
    test('the index lists exactly the run files, newest first', () => {
        expect(index.schema).toBe(1);
        expect(index.runs.map((r) => r.file).sort()).toEqual(files.map((f) => `runs/${f}`).sort());
        const dates = index.runs.map((r) => r.date);
        expect([...dates].sort().reverse()).toEqual(dates);
    });

    test.each(docs)('%s is schema 1 and well-formed', (file, doc) => {
        expect(doc.schema).toBe(1);
        expect(`${doc.id}.json`).toBe(file);
        expect(doc.harness).toBe('tools/qa/character-lab.mjs');
        expect(Array.isArray(doc.humanReview)).toBe(true);
        for (const r of doc.runs) {
            expect(['en', 'it']).toContain(r.lang);
            expect(Array.isArray(r.servedModels)).toBe(true);
            // the route name is never stood in for an unreported served model
            for (const t of r.turns) expect(t.servedModels).not.toContain(r.route);
        }
    });

    test.each(docs)('%s carries no token-like string', (file) => {
        const text = fs.readFileSync(path.join(DATA, 'runs', file), 'utf8');
        expect(text).not.toMatch(/[A-Za-z0-9_-]{40,}/);
    });

    test.each(docs)('%s is scored by the current scorer', (file, doc) => {
        for (const r of doc.runs) {
            const previous = [];
            for (const t of r.turns) {
                const s = S.score(t.reply || '', {
                    lang: r.lang,
                    maxSentences: 4,
                    askedAboutAI: t.id === 'truth',
                    previous: previous.slice(),
                });
                if (t.reply) previous.push(t.reply);
                expect({ id: t.id, score: t.score, flags: t.flags }).toEqual({
                    id: t.id,
                    score: s.score,
                    flags: s.flags,
                });
            }
            const mean = Math.round(r.turns.reduce((a, t) => a + t.score, 0) / r.turns.length);
            expect(r.summary.meanScore).toBe(mean);
        }
    });

    test.each(['lab.js', 'lab-3d.js', 'lab-atlas.js', 'lab-hub.js'])('%s draws data as text, never as HTML', (file) => {
        const js = fs.readFileSync(path.join(__dirname, '..', 'quality-lab', file), 'utf8');
        expect(js).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
    });
});

describe('Quality Lab 3D audit', () => {
    const audit = JSON.parse(fs.readFileSync(path.join(DATA, '3d', 'worlds-audit.json'), 'utf8'));

    test('the committed audit is what the generator computes from the files today', () => {
        // AX10. A world change and its audit land together: run `node tools/qa/world-audit.mjs`.
        const run = () =>
            require('child_process').execFileSync(process.execPath, ['tools/qa/world-audit.mjs', '--check'], {
                cwd: path.join(__dirname, '..'),
                stdio: 'pipe',
            });
        expect(run).not.toThrow();
    });

    test('every catalogue world is audited, on all three devices, with no failure', () => {
        const catalogue = JSON.parse(
            fs.readFileSync(path.join(__dirname, '..', 'assets', 'vr-worlds', 'worlds.json'), 'utf8')
        );
        expect(audit.worlds.map((w) => w.id).sort()).toEqual(catalogue.worlds.map((w) => w.id).sort());
        for (const w of audit.worlds) expect(Object.keys(w.devices).sort()).toEqual(['desktop', 'mobile', 'vr']);
        expect(audit.summary.fails).toBe(0);
    });
});

describe('Quality Lab atlas and hub', () => {
    const run = (args) =>
        require('child_process').execFileSync(process.execPath, args, {
            cwd: path.join(__dirname, '..'),
            stdio: 'pipe',
            encoding: 'utf8',
        });
    const atlas = JSON.parse(fs.readFileSync(path.join(DATA, 'atlas', 'atlas-audit.json'), 'utf8'));

    test('the atlas has no failure, and no link crosses the private boundary', () => {
        expect(atlas.summary.fails).toBe(0);
        expect(atlas.problems).toEqual([]);
        const byId = new Map(atlas.zones.map((z) => [z.id, z]));
        for (const z of atlas.zones)
            for (const to of z.links) expect(z.region === 'private').toBe(byId.get(to).region === 'private');
    });

    test('hub.json is what the generator computes from the lab data today', () => {
        expect(() => run(['tools/qa/hub.mjs', '--check'])).not.toThrow();
        const hub = JSON.parse(fs.readFileSync(path.join(DATA, 'hub.json'), 'utf8'));
        for (const a of hub.nextActions) {
            expect(['ai', '3d', 'atlas']).toContain(a.area);
            expect([1, 2, 3]).toContain(a.priority);
            expect(a.command && a.why && a.files.length).toBeTruthy();
        }
        const p = hub.nextActions.map((a) => a.priority);
        expect([...p].sort()).toEqual(p);
    });

    test('new-zone validates a brief and refuses a bad one, without writing on --dry-run', () => {
        const before = fs.readFileSync(path.join(DATA, 'atlas', 'atlas.json'), 'utf8');
        const out = run([
            'tools/qa/new-zone.mjs',
            'test-harbor',
            '--region',
            'town',
            '--purpose',
            'p',
            '--mood',
            'm',
            '--activities',
            'relax',
            '--spots',
            'stall',
            '--devices',
            'desktop,mobile,vr',
            '--assets',
            'kit (CC0)',
            '--links',
            'neon-street',
            '--dry-run',
        ]);
        expect(JSON.parse(out)).toMatchObject({ id: 'test-harbor', status: 'planned' });
        expect(() => run(['tools/qa/new-zone.mjs', 'x', '--region', 'nowhere', '--devices', 'ar'])).toThrow();
        expect(fs.readFileSync(path.join(DATA, 'atlas', 'atlas.json'), 'utf8')).toBe(before);
    });
});

describe('Quality Lab MCP server (AX13)', () => {
    const call = (lines) =>
        require('child_process')
            .execFileSync(process.execPath, ['tools/qa/lab-mcp.mjs'], {
                cwd: path.join(__dirname, '..'),
                input: lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
            })
            .trim()
            .split('\n')
            .map((l) => JSON.parse(l));

    test('speaks MCP over stdio: initialize, tools/list, tools/call, and nothing else on stdout', () => {
        const out = call([
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: { protocolVersion: '2025-06-18', capabilities: {} },
            },
            { jsonrpc: '2.0', method: 'notifications/initialized' },
            { jsonrpc: '2.0', id: 2, method: 'tools/list' },
            {
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: {
                    name: 'lab_score_reply',
                    arguments: { text: 'I’m an AI assistant, here to help.', lang: 'en' },
                },
            },
            {
                jsonrpc: '2.0',
                id: 4,
                method: 'tools/call',
                params: { name: 'lab_world', arguments: { id: 'no-such' } },
            },
            { jsonrpc: '2.0', id: 5, method: 'nope' },
        ]);
        expect(out.map((m) => m.id)).toEqual([1, 2, 3, 4, 5]); // the notification got no answer
        expect(out[0].result.serverInfo.name).toBe('nexus-quality-lab');
        const names = out[1].result.tools.map((t) => t.name);
        expect(names).toEqual(
            expect.arrayContaining(['lab_next_actions', 'lab_score_reply', 'lab_new_zone', 'lab_check'])
        );
        for (const t of out[1].result.tools) expect(t.inputSchema.type).toBe('object');
        expect(JSON.parse(out[2].result.content[0].text).flags).toContain('assistant-register');
        expect(out[3].result.isError).toBe(true);
        expect(out[4].error.code).toBe(-32601);
    });

    test('is registered for Claude Code in .mcp.json', () => {
        const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.mcp.json'), 'utf8'));
        expect(cfg.mcpServers['nexus-quality-lab'].args).toEqual(['tools/qa/lab-mcp.mjs']);
    });
});
