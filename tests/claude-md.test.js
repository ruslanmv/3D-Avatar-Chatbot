/**
 * AX14. CLAUDE.md is loaded into every Claude Code session, so it stays short: the rules that apply
 * everywhere, and a feature map pointing at docs/claude/ for the rest. This keeps the map and the
 * files in step, keeps the file from growing back, and checks the session tooling it names exists.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');

describe('CLAUDE.md stays a short, accurate entry point', () => {
    test('it stays under 400 lines — put feature detail in docs/claude/', () => {
        expect(claude.split('\n').length).toBeLessThan(400);
    });

    test('every docs/claude note is on the feature map, and every map link exists', () => {
        const linked = [...claude.matchAll(/`(docs\/claude\/[a-z0-9-]+\.md)`/g)].map((m) => m[1]);
        for (const f of linked) expect(fs.existsSync(path.join(ROOT, f))).toBe(true);
        const files = fs.readdirSync(path.join(ROOT, 'docs', 'claude')).map((f) => `docs/claude/${f}`);
        expect(files.sort()).toEqual([...new Set(linked)].sort());
    });

    test('the session tooling it names exists: hook, slash commands, MCP server', () => {
        const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
        const cmd = settings.hooks.SessionStart[0].hooks[0].command;
        const hook = path.join(ROOT, cmd.replace('$CLAUDE_PROJECT_DIR/', ''));
        expect(fs.existsSync(hook)).toBe(true);
        expect(fs.statSync(hook).mode & 0o111).toBeTruthy();
        for (const c of ['nexus-start', 'lab-next', 'lab-check', 'new-zone']) {
            expect(claude).toContain('/' + c);
            expect(fs.existsSync(path.join(ROOT, '.claude', 'commands', c + '.md'))).toBe(true);
        }
        expect(fs.existsSync(path.join(ROOT, '.mcp.json'))).toBe(true);
    });
});
