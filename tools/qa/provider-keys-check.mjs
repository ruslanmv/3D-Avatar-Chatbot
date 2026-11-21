#!/usr/bin/env node
/**
 * K1. Can a key be pasted for every AI provider? Opened the way a person opens it (Settings, a
 * provider card clicked), from the state that hid the field: OllaBridge saved with Device
 * Pairing, whose auth mode hides the API key row. Reported 2026-11-21 ("we cannot add them from
 * the UI"): after pairing OllaBridge once, OpenAI, Claude and WatsonX showed no key field at all.
 *
 * K2. Then Test Connection with OpenAI picked and a key typed, nothing saved: the request must go
 * to OpenAI (through the site's proxy, answered here by a stand-in), never to OllaBridge, and
 * the saved provider must still be OllaBridge afterwards. Reported 2026-11-21: "Failed at
 * completion: OllaBridge is unreachable (HTTP 503)" while testing an OpenAI key.
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

    // K2. Test Connection tries what the form shows.
    const targets = [];
    await page.route('**/*', (route) => {
        const req = route.request();
        const url = req.url();
        if (/\/api\/proxy/.test(url)) {
            if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, body: '' }); // the proxy is there
            let target = '';
            try {
                target = JSON.parse(req.postData() || '{}').url || '';
            } catch (_) {}
            targets.push(target);
            if (/api\.openai\.com\/v1\/models/.test(target)) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4-turbo' }] }),
                });
            }
            if (/api\.openai\.com/.test(target)) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }),
                });
            }
            return route.fulfill({ status: 503, body: '{}' });
        }
        if (/ollabridge/i.test(url)) targets.push(url);
        return route.continue();
    });
    await page.locator('label.provider-card:has(input[value=openai])').click();
    await page.waitForTimeout(400);
    await page.fill('#api-key', 'sk-placeholder-not-a-real-key');
    // As in the report: Fetch Models first. It creates the app's LLM manager, which still holds
    // the saved provider (OllaBridge); Test Connection then went through it.
    await page.click('#fetch-models-btn').catch(() => {});
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
        const sel = document.getElementById('model-select');
        if (![...sel.options].some((o) => o.value === 'gpt-4o-mini')) sel.add(new Option('gpt-4o-mini', 'gpt-4o-mini'));
        sel.value = 'gpt-4o-mini';
    });
    await page.click('#test-connection-btn');
    await page.waitForFunction(
        () => /✅|❌/.test(document.getElementById('test-connection-status')?.textContent || ''),
        null,
        { timeout: 60000 }
    );
    const status = await page.textContent('#test-connection-status');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nexus_llm_settings') || '{}').provider);
    const toOpenAI = targets.some((t) => /api\.openai\.com/.test(t));
    const toBridge = targets.filter((t) => /ollabridge/i.test(t));
    const ok2 = toOpenAI && !toBridge.length && /✅/.test(status) && saved === 'ollabridge';
    if (!ok2) failed++;
    console.log(
        `${ok2 ? 'ok  ' : 'FAIL'} test connection with OpenAI: ${status.trim()} · sent to OpenAI ${toOpenAI} · ` +
            `to OllaBridge ${toBridge.length} · saved provider still ${saved}`
    );
} finally {
    await browser.close();
    server.stop();
}
process.exit(failed ? 1 : 0);
