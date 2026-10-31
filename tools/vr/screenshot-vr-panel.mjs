#!/usr/bin/env node
/**
 * screenshot-vr-panel.mjs — VR1. Pictures of the HomePilot VR chat panel, without a headset.
 *
 * The VR chat panel is drawn on a <canvas> and shown in the headset as a texture, so a change to it
 * (a removed button, a new status line, a longer message) could only be seen by putting a Quest on.
 * This loads the real page in headless Chromium, writes a conversation into the real panel
 * (`window.NEXUS_VIEWER.vrChatPanel`), and saves that canvas as a PNG for each layer — chat,
 * Controls, More (settings) — exactly as the headset would show it. It is how the panel without the
 * Summarize / Explain / Continue chips was checked (VR1).
 *
 * Usage:
 *   node tools/vr/screenshot-vr-panel.mjs                 # starts the local server itself
 *   npm run vr:panel-shot                                   # the same
 *   node tools/vr/screenshot-vr-panel.mjs --url http://localhost:8080   # use a server you started
 *
 * Options:
 *   --url <url>            Page to load. Without it the tool starts nexus-proxy on --port and stops
 *                          it afterwards.
 *   --port <n>             Port for the server it starts (default 8097).
 *   --out <dir>            Where the PNGs go (default tmp/vr-panel — git-ignored).
 *   --modes <list>         Comma-separated layers: chat,controls,settings (default: all three).
 *   --status <s>           Panel status: idle, listening, thinking, speaking (default idle).
 *   --transcript <text>    Show this as the live speech transcript (implies --status listening).
 *   --messages <file>      JSON array of { "role": "user"|"bot", "text": "…" } to show instead of
 *                          the built-in sample conversation.
 *   --no-sample            Show the panel with no messages at all.
 *   --ar <on|off>          Whether the panel believes AR is supported (default: what the browser
 *                          says — off in headless Chromium, as over Quest Link).
 *
 * Needs Playwright with Chromium, as tools/brand/render-app-icons.mjs does:
 *   npm i --no-save playwright && npx playwright install chromium
 * (A machine with Playwright installed globally works as is.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SAMPLE = [
    { role: 'user', text: 'so what do you think' },
    {
        role: 'bot',
        text: "It's fascinating how evolution has crafted such efficient yet unusual solutions in creatures like octopuses. What do you think about it?",
    },
    { role: 'user', text: 'tell me more' },
    {
        role: 'bot',
        text: 'They have blue blood based on hemocyanin, which helps them survive in cold, low-oxygen water.',
    },
];

function parseArgs(argv) {
    const o = { port: 8097, out: path.join(ROOT, 'tmp/vr-panel'), modes: ['chat', 'controls', 'settings'] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => argv[++i];
        if (a === '--url') o.url = next();
        else if (a === '--port') o.port = Number(next());
        else if (a === '--out') o.out = path.resolve(next());
        else if (a === '--modes')
            o.modes = next()
                .split(',')
                .map((m) => m.trim())
                .filter(Boolean);
        else if (a === '--status') o.status = next();
        else if (a === '--transcript') o.transcript = next();
        else if (a === '--messages') o.messagesFile = path.resolve(next());
        else if (a === '--no-sample') o.noSample = true;
        else if (a === '--ar') o.ar = next() === 'on';
        else if (a === '--help' || a === '-h') o.help = true;
        else {
            console.error(`Unknown option: ${a} (try --help)`);
            process.exit(2);
        }
    }
    return o;
}

async function loadPlaywright() {
    try {
        return await import('playwright');
    } catch {
        // A globally installed Playwright is found through NODE_PATH, which require() honours and
        // ESM import() does not.
        try {
            return createRequire(import.meta.url)('playwright');
        } catch {
            console.error('Playwright is not installed: npm i --no-save playwright && npx playwright install chromium');
            process.exit(2);
        }
    }
}

/** Start nexus-proxy on `port` and resolve once it answers; returns a stop() function. */
async function startServer(port) {
    const child = spawn(process.execPath, [path.join(ROOT, 'nexus-proxy/server.js')], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore',
    });
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) {
        try {
            const res = await fetch(`${url}/index.html`);
            if (res.ok) return { url, stop: () => child.kill() };
        } catch {
            /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    child.kill();
    throw new Error(`The local server did not start on port ${port} (is it taken? try --port).`);
}

async function main() {
    const o = parseArgs(process.argv.slice(2));
    if (o.help) {
        const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
        console.log(src.slice(src.indexOf('Usage:'), src.indexOf(' */')).replace(/^ \* ?/gm, ''));
        return;
    }
    const messages = o.noSample ? [] : o.messagesFile ? JSON.parse(fs.readFileSync(o.messagesFile, 'utf8')) : SAMPLE;

    const server = o.url ? { url: o.url.replace(/\/$/, ''), stop: () => {} } : await startServer(o.port);
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(e.message));
        await page.goto(`${server.url}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.NEXUS_VIEWER && window.NEXUS_VIEWER.vrChatPanel, null, {
            timeout: 120000,
        });
        fs.mkdirSync(o.out, { recursive: true });

        for (const mode of o.modes) {
            const url = await page.evaluate(
                ({ mode, messages, status, transcript, ar }) => {
                    const p = window.NEXUS_VIEWER.vrChatPanel;
                    p.messages = [];
                    for (const m of messages) p.appendMessage(m.role === 'user' ? 'user' : 'bot', m.text);
                    if (typeof ar === 'boolean') p.xrSettings.arSupported = ar;
                    p.setStatus(transcript ? 'listening' : status || 'idle');
                    if (transcript) p.setTranscript(transcript, 'interim');
                    p.setMode(mode);
                    p.redraw();
                    return p.canvas.toDataURL('image/png');
                },
                { mode, messages, status: o.status, transcript: o.transcript, ar: o.ar }
            );
            const file = path.join(o.out, `vr-panel-${mode}.png`);
            fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
            console.log(`saved ${path.relative(process.cwd(), file) || file}`);
        }
        if (pageErrors.length) console.warn(`page errors:\n  ${pageErrors.slice(0, 5).join('\n  ')}`);
    } finally {
        await browser.close();
        server.stop();
    }
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
