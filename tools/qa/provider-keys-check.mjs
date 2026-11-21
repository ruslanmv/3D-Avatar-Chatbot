#!/usr/bin/env node
/**
 * K1. Can a key be pasted for every AI provider? Opened the way a person opens it (Settings, a
 * provider card clicked), from the state that hid the field: OllaBridge saved with Device
 * Pairing, whose auth mode hides the API key row. Reported 2026-11-21 ("we cannot add them from
 * the UI"): after pairing OllaBridge once, OpenAI, Claude and WatsonX showed no key field at all.
 *
 *   node tools/qa/provider-keys-check.mjs        # exit 1 when any provider's key field is hidden
 *
 * Starts nexus-proxy itself. Nothing is saved: the key typed is a placeholder, never a real one.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const require = createRequire(import.meta.url);
const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
const { chromium } = require('playwright');
const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:1');
const browser = await chromium.launch();
let failed = 0;
try {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    await ctx.addInitScript(() => {
        if (sessionStorage.getItem('k1-seeded')) return;
        sessionStorage.setItem('k1-seeded', '1');
        localStorage.setItem(
            'nexus_llm_settings',
            JSON.stringify({ provider: 'ollabridge', ollabridge: { auth_mode: 'pairing' } })
        );
    });
    const page = await ctx.newPage();
    await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('label.provider-card'), null, { timeout: 120000 });
    await page.waitForTimeout(6000);
    await page.click('#settings-btn');
    await page.waitForTimeout(1200);
    for (const provider of ['openai', 'claude', 'watsonx']) {
        await page.locator(`label.provider-card:has(input[value=${provider}])`).click();
        await page.waitForTimeout(500);
        const shown = await page.evaluate(() => !!document.getElementById('api-key').offsetParent);
        let typed = '';
        if (shown) {
            await page.fill('#api-key', '');
            await page.locator('#api-key').click();
            await page.keyboard.type('placeholder-key');
            typed = await page.inputValue('#api-key');
        }
        const ok = shown && typed === 'placeholder-key';
        if (!ok) failed++;
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${provider}: key field ${shown ? 'shown' : 'hidden'}`);
    }
} finally {
    await browser.close();
    server.stop();
}
process.exit(failed ? 1 : 0);
