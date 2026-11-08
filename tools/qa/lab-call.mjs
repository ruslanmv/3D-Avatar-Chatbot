#!/usr/bin/env node
/**
 * AX15. Call one Quality Lab MCP tool from a shell, for sessions where the MCP server is not loaded.
 *   node tools/qa/lab-call.mjs lab_next_actions '{"area":"3d"}'
 *   node tools/qa/lab-call.mjs --list
 * Prints the tool's text; a picture is listed by size (lab_screenshot also writes it to tmp/shots/).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [tool, json = '{}'] = process.argv.slice(2);
const server = spawn(process.execPath, [fileURLToPath(new URL('./lab-mcp.mjs', import.meta.url))], {
    stdio: ['pipe', 'pipe', 'inherit'],
});
const send = (m) => server.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
let buf = '';
server.stdout.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
        const m = JSON.parse(buf.slice(0, i));
        if (m.id !== 2) continue;
        if (m.error) console.error(m.error.message);
        else if (m.result.tools) for (const t of m.result.tools) console.log(`${t.name} — ${t.description}`);
        else
            for (const c of m.result.content)
                console.log(c.type === 'image' ? `[image ${Math.round((c.data.length * 3) / 4 / 1024)} KB]` : c.text);
        process.exitCode = m.error || (m.result && m.result.isError) ? 1 : 0;
        server.stdin.end();
    }
});
send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } });
send({ method: 'notifications/initialized' });
if (!tool || tool === '--list') send({ id: 2, method: 'tools/list' });
else send({ id: 2, method: 'tools/call', params: { name: tool, arguments: JSON.parse(json) } });
