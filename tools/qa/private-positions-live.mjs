#!/usr/bin/env node
/**
 * UN29. The closer positions in a real Private evening, driven the way the person drives it:
 * the Closer button, the ⋯ menu's Positions chips, Ease up. Judged against the code's own table.
 *
 *   node tools/qa/private-positions-live.mjs [--lang it-IT] [--keys sit-open,kneel-wide,knees-up,straddle]
 *                                            [--out dir]
 *
 * What a unit test cannot show, and this does (UN27/UN28):
 *
 *   steps    From Warm, Closer is pressed until the top (ConsentFlow's 4 s floor between presses is
 *            respected, never bypassed — the level is moved only by the button). At every step the
 *            chips in the ⋯ menu must be exactly the positions `PrivateActionPolicy.POSE_LEVEL`
 *            opens at that step, and the prompt the model gets must list the same ones as open.
 *   take     At the top, every `--keys` chip is tapped: the line goes through the conversation
 *            surface and PrivateActionBridge; it must complete AND be confirmed on her rendered
 *            body (`result.seen`). A chip tapped below its step must be refused (`why: pace`).
 *   ease     Holding the last position, Ease up is pressed until the evening is below its step:
 *            she must be standing again (UN28 `fitPoseToPace`).
 *
 * A Mature evening (ceiling 4) in the private cabaret, Spicy on, as the private audits set it up.
 * No model is needed or called for: the bridge acts on the person's turn before any reply. The
 * model-facing lines are recorded per step in report.json (`prompt`) so they can be read.
 *
 * Starts nexus-proxy itself if needed. Writes audits/private-positions/runs/<stamp>-<lang>/
 * {report.json, menu-<step>.png, <key>.png}. Exit 1 on a failed check, 2 when the run failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const require = createRequire(import.meta.url);
const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
};
const LANG = arg('--lang', 'it-IT');
const KEYS = arg('--keys', 'sit-open,kneel-wide,knees-up,straddle').split(',').filter(Boolean);
// L5. Also take the No-limits step: Forge's grant answer is stood in for (this page has no Forge
// grant in a test run), then Closer at 4 must open step 5 and Ease must close it again.
const LEVEL5 = process.argv.includes('--level5');
// L5. With `--forge-grant`, the second gate is real: the grant is read from FORGE_GRANT in the
// environment (never an argument, file or log) and given to the page as Settings would keep it,
// so the bridge's probe asks the deployed Forge. Without it, Forge's answer is stood in for.
const REAL_GRANT = process.argv.includes('--forge-grant') ? String(process.env.FORGE_GRANT || '').trim() : '';
if (process.argv.includes('--forge-grant') && !REAL_GRANT) {
    console.error('--forge-grant needs the grant in FORGE_GRANT');
    process.exit(2);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/private-positions/runs', `${stamp}-${LANG}`)));

// The package is "type": "module", so Node loads this IIFE as an ES module: `module.exports` is
// not there, and the file's global is what it leaves behind (the same one the page reads).
await import(pathToFileURL(path.join(ROOT, 'src/experiences/private/PrivateActionPolicy.js')).href);
const Policy = globalThis.NEXUS_PRIVATE_ACTION_POLICY;
/** The positions open at a step, by the policy's own table; compared with the chips as a set. */
const openAt = (level) => Policy.ADULT_POSES.filter((k) => Policy.poseLevel(k) <= level).sort();

async function main() {
    fs.mkdirSync(out, { recursive: true });
    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const { chromium } = require('playwright');
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:1');
    const browser = await chromium.launch();
    const report = { lang: LANG, keys: KEYS, steps: [], takes: [], ease: null, failures: [], errors: [] };
    const fail = (what) => report.failures.push(what);
    try {
        const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
        await ctx.addInitScript((lang) => {
            localStorage.setItem('app_lang', lang);
            localStorage.setItem('nexus_together_enabled', 'on');
            localStorage.setItem('nexus_spicy_enabled', 'true');
            localStorage.setItem('nexus_spicy_verified', 'true');
            localStorage.setItem('npc_enabled', 'false');
        }, LANG);
        if (REAL_GRANT)
            await ctx.addInitScript((grant) => localStorage.setItem('wardrobe_forge_grant', grant), REAL_GRANT);
        const page = await ctx.newPage();
        page.on('pageerror', (e) => report.errors.push(String(e.message || e).slice(0, 240)));
        await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
            () =>
                window.NEXUS_BD?.togetherPanel?.activities?.get('intimate') &&
                window.NEXUS_VIEWER?.avatarManager?.currentRoot &&
                window.__NEXUS_COMPANION_LIVE &&
                window.vrPoseSystem?.avatarRoot,
            null,
            { timeout: 240000 }
        );
        await page.waitForTimeout(2500);
        if (LEVEL5 && !REAL_GRANT)
            await page.evaluate(() => {
                // The second gate, answered as Forge answers a valid grant (200 on the catalogue).
                const w = window.NEXUS_WARDROBE;
                const c = w && w.service && w.service.controller;
                if (!c) return;
                const forge = c.forge || (c.forge = {});
                const original = typeof forge.request === 'function' ? forge.request.bind(forge) : null;
                forge.request = (p, ...rest) =>
                    p === '/v1/body-surface/catalog'
                        ? Promise.resolve({ states: [] })
                        : original
                          ? original(p, ...rest)
                          : Promise.reject(new Error('no forge in this run'));
            });
        report.started = await page.evaluate(async () => {
            const panel = window.NEXUS_BD.togetherPanel;
            const a = panel.activities.get('intimate');
            if (a.setAtmosphere) a.setAtmosphere({ world: 'private-cabaret' });
            const opt = (panel.contractFor('intimate')?.inputs() || []).find((x) => x.id === 'mature') || {
                id: 'mature',
            };
            const r = await panel.startActivity('intimate', opt);
            return { ok: !!(r && r.ok), why: r && r.why };
        });
        if (!report.started.ok) throw new Error(`Private did not start: ${report.started.why}`);
        await page
            .waitForFunction(() => /private-cabaret/.test(window.NEXUS_VIEWER.vrWorlds?.activeId || ''), null, {
                timeout: 120000,
            })
            .catch(() => fail('start: private-cabaret not shown'));
        await page.waitForTimeout(3000);

        const row = '#nexus-private-conversation-row';
        const read = () =>
            page.evaluate((row) => {
                const l = window.NEXUS_PRIVATE_ACTIONS.snapshot().last;
                return {
                    level: window.NEXUS_BD.adult.level,
                    chips: [...document.querySelectorAll(`${row} [data-private-position]`)].map(
                        (b) => b.dataset.privatePosition
                    ),
                    last: l
                        ? {
                              pose: l.params && l.params.pose,
                              status: l.status,
                              why: l.why,
                              seen: !!(l.result && l.result.seen),
                          }
                        : null,
                    preset: window.vrPoseSystem.getCurrentPreset(),
                    prompt: window.NEXUS_PRIVATE_ACTIONS.promptLines().filter((x) =>
                        /Closer positions|Not open yet/.test(x)
                    ),
                };
            }, row);
        const click = (action) =>
            page.evaluate(
                ([row, action]) => {
                    const b = document.querySelector(`${row} [data-private-action="${action}"]`);
                    if (b) b.click();
                    return !!b;
                },
                [row, action]
            );
        const openMenu = () =>
            page.evaluate((row) => {
                const panel = document.querySelector('#nexus-private-more-panel');
                if (panel && panel.hidden) document.querySelector(`${row} .nexus-private-more`)?.click();
            }, row);
        const settle = async () => {
            await page
                .waitForFunction(
                    () => {
                        const l = window.NEXUS_PRIVATE_ACTIONS.snapshot().last;
                        const v = window.vrPoseSystem;
                        return (!l || l.status !== 'pending') && !(v.isSettling && v.isSettling());
                    },
                    null,
                    { timeout: 60000, polling: 150 }
                )
                .catch(() => {});
            await page.waitForTimeout(900);
        };
        const tap = (key) =>
            page.evaluate(
                ([row, key]) => {
                    const b = document.querySelector(`${row} [data-private-position="${key}"]`);
                    if (b) b.click();
                    return !!b;
                },
                [row, key]
            );

        // steps: Warm → the top, one Closer at a time.
        for (let guard = 0; guard < 8; guard++) {
            const now = await read();
            const want = openAt(now.level);
            report.steps.push({ ...now, want });
            if ([...now.chips].sort().join(',') !== want.join(','))
                fail(`step ${now.level}: chips ${now.chips.join(',') || '—'} ≠ ${want.join(',') || '—'}`);
            // The model must be told of exactly as many open positions as the menu offers.
            const openLine = now.prompt.find((l) => /Closer positions open/.test(l)) || '';
            const told = openLine ? (openLine.split(':')[1] || '').split('. ')[0].split(';').length : 0;
            if (told !== want.length) fail(`step ${now.level}: the prompt names ${told} open, the menu ${want.length}`);
            await openMenu();
            await page
                .locator(row)
                .screenshot({ path: path.join(out, `menu-${now.level}.png`) })
                .catch(() => {});
            if (now.level >= 4) break;
            if (!(await click('closer'))) {
                fail(`step ${now.level}: no Closer button below the top`);
                break;
            }
            await page.waitForTimeout(4700); // ConsentFlow's userStepMinMs is 4 s
        }

        // L5. Closer at 4 opens No limits; the ladder shows a fifth step; Ease closes it.
        if (LEVEL5) {
            const five = () =>
                page.evaluate((row) => {
                    const snap = window.NEXUS_PRIVATE_ACTIONS.snapshot();
                    return {
                        level: window.NEXUS_BD.adult.level,
                        u: snap.unrestrained,
                        outfit: snap.outfitState,
                        dots: document.querySelectorAll(`${row} [data-private-step]`).length,
                        current: document.querySelector(`${row} .nexus-private-step.is-current`)?.dataset.privateStep,
                        closer: !!document.querySelector(`${row} [data-private-action="closer"]`),
                    };
                }, row);
            // The real probe is a request to Forge: give it time to answer.
            await page
                .waitForFunction(() => window.NEXUS_PRIVATE_ACTIONS.snapshot().unrestrained?.available, null, {
                    timeout: 90000,
                })
                .catch(() => {});
            await page.waitForTimeout(1500);
            const shot = async (name) => {
                const canvas = await page.evaluateHandle(() => window.NEXUS_VIEWER.renderer.domElement);
                await canvas.screenshot({ path: path.join(out, `${name}.png`) }).catch(() => {});
            };
            await shot('render-step-4');
            const before = await five();
            if (!(before.u && before.u.available)) fail(`level5: not available at 4 (${JSON.stringify(before.u)})`);
            if (before.dots !== 5 || !before.closer)
                fail(`level5: at 4 the ladder has ${before.dots} dots, Closer ${before.closer}`);
            await click('closer');
            // Entering 5 undresses her through Forge's bare look: wait for the wardrobe to answer.
            await page
                .waitForFunction(
                    () => {
                        const snap = window.NEXUS_PRIVATE_ACTIONS.snapshot();
                        const l = snap.last;
                        return (
                            snap.outfitState === 'bare' ||
                            (l && l.name === 'wardrobe.undress' && l.status !== 'pending')
                        );
                    },
                    null,
                    { timeout: 240000, polling: 500 }
                )
                .catch(() => {});
            await settle();
            await page.waitForTimeout(3000);
            const on = await five();
            on.undress = await page.evaluate(() => {
                const l = window.NEXUS_PRIVATE_ACTIONS.snapshot().last;
                return l ? { name: l.name, status: l.status, why: l.why } : null;
            });
            on.voice = await page.evaluate(() =>
                window.NEXUS_PRIVATE_ACTIONS.promptLines()
                    .filter((x) => /NO LIMITS|UNRESTRAINED/.test(x))
                    .map((x) => x.slice(0, 90))
            );
            await shot('render-step-5');
            report.level5 = { before, on };
            if (!(on.u && on.u.on) || on.current !== '5' || on.level !== 4)
                fail(`level5: Closer did not open step 5 (${JSON.stringify(on)})`);
            else console.log(`ok   level 5: on, ConsentFlow still at ${on.level}, she is ${on.outfit}`);
            await page
                .locator(row)
                .screenshot({ path: path.join(out, 'level-5.png') })
                .catch(() => {});
            await click('ease');
            await page.waitForTimeout(1500);
            const off = await five();
            report.level5.off = off;
            if (off.u && off.u.on) fail('level5: Ease did not close step 5');
            else if (off.level !== 4) fail(`level5: Ease from 5 dropped ConsentFlow to ${off.level}`);
            else console.log('ok   level 5: Ease back to 4');
        }

        // take: every key at the top, from the menu.
        for (const key of KEYS) {
            await openMenu();
            if (!(await tap(key))) {
                fail(`take ${key}: no chip at the top`);
                continue;
            }
            await settle();
            const now = await read();
            report.takes.push({ key, ...now });
            const canvas = await page.evaluateHandle(() => window.NEXUS_VIEWER.renderer.domElement);
            await canvas.screenshot({ path: path.join(out, `${key}.png`) }).catch(() => {});
            if (!now.last || now.last.pose !== key || now.last.status !== 'completed' || !now.last.seen)
                fail(`take ${key}: ${JSON.stringify(now.last)}`);
            console.log(`${now.last && now.last.status === 'completed' ? 'ok  ' : 'FAIL'} ${key} → ${now.preset}`);
        }

        // ease: below the step of what she holds, she stands.
        const held = KEYS[KEYS.length - 1];
        const need = Policy.poseLevel(held);
        let now = await read();
        for (let guard = 0; guard < 4 && now.level >= need; guard++) {
            await click('ease');
            await settle();
            await page.waitForTimeout(1200);
            now = await read();
        }
        report.ease = { held, need, ...now };
        if (now.level >= need) fail(`ease: still at ${now.level}, not below ${need}`);
        else if (now.preset !== 'standing' || (now.last && now.last.pose !== 'stand'))
            fail(`ease: at ${now.level} she is still in ${now.preset}`);
        else console.log(`ok   ease to ${now.level}: standing`);
    } finally {
        await browser.close();
        server.stop();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    for (const s of report.steps) console.log(`step ${s.level}: ${s.chips.join(', ') || '—'}`);
    for (const f of report.failures) console.log(`FAIL ${f}`);
    if (report.errors.length) console.log(`page errors: ${report.errors.length}`);
    console.log(`\n${out}`);
    return report.failures.length ? 1 : 0;
}

main().then(
    (code) => process.exit(code),
    (error) => {
        console.error(error);
        process.exit(2);
    }
);
