/**
 * UI1. Private's setup screens as the person sees them, for a design review: step 1 (the mood)
 * and step 2 ("Scegli l'atmosfera": scene, soundtrack, duration), on a desktop window and a
 * phone, in the language asked. The real page, the real panel: Together ▸ Private, a mood
 * tapped, nothing started. Frames only, no checks: this is for looking at.
 *
 *   node tools/qa/private-setup-shot.mjs [--lang it-IT] [--out <dir>]
 *
 * Writes <out>/{desktop,phone}-step1.png and -step2.png (git-ignored under audits/…/runs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const LANG = arg('--lang', 'it-IT');
const out = path.resolve(
    arg('--out', path.join(ROOT, 'audits/private-setup/runs', new Date().toISOString().replace(/[:.]/g, '-')))
);

const SIZES = [
    ['desktop', { viewport: { width: 1400, height: 950 } }],
    ['phone', 'iPhone 13'], // a named device: its own viewport, scale and touch, as the other phone checks
];

async function main() {
    fs.mkdirSync(out, { recursive: true });
    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const { chromium } = require('playwright');
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:1');
    const browser = await chromium.launch();
    try {
        for (const [name, options] of SIZES) {
            const { devices } = require('playwright');
            const ctx = await browser.newContext(typeof options === 'string' ? devices[options] : options);
            await ctx.addInitScript((lang) => {
                localStorage.setItem('app_lang', lang);
                localStorage.setItem('nexus_together_enabled', 'on');
                localStorage.setItem('nexus_spicy_enabled', 'true');
                localStorage.setItem('nexus_spicy_verified', 'true');
                localStorage.setItem('npc_enabled', 'false');
            }, LANG);
            const page = await ctx.newPage();
            await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => window.NEXUS_BD?.togetherPanel?.activities?.get('intimate'), null, {
                timeout: 240000,
            });
            await page.waitForTimeout(2500);
            const shot = async (step) => {
                await page.waitForTimeout(900);
                const panel = page.locator('#' + (await page.evaluate(() => window.NEXUS_BD.togetherPanel.root.id)));
                await panel.screenshot({ path: path.join(out, `${name}-${step}.png`) });
                await page.screenshot({ path: path.join(out, `${name}-${step}-page.png`) });
            };
            await page.evaluate(() => {
                const p = window.NEXUS_BD.togetherPanel;
                p.open();
                p.choose('intimate');
            });
            await shot('step1');
            const moved = await page.evaluate(() => {
                const b = document.querySelector('.nexus-private-preset:not(.is-locked)');
                if (b) b.click();
                return !!b;
            });
            if (!moved) console.log(`${name}: no mood to choose`);
            await shot('step2');
            console.log(`${name}: ${out}/${name}-step1.png, ${name}-step2.png`);
            await ctx.close();
        }
    } finally {
        await browser.close();
        server.stop();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
