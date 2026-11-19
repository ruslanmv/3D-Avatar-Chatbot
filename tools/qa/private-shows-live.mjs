#!/usr/bin/env node
/**
 * UN36. The shows in a real Private evening, driven the way the person drives them: Closer to the
 * top, the ⋯ menu's Shows chips, and her body photographed at every step.
 *
 *   node tools/qa/private-shows-live.mjs [--lang en-US] [--shows open-for-you,from-behind] [--out dir]
 *
 * What a unit test cannot show, and this does:
 *
 *   menu     At every step of the pace the Shows chips must be exactly the shows
 *            `PrivateRoutines.openAt` opens there (none at Warm, Tease from Romantic…).
 *   run      At the top, each `--shows` chip is tapped. For every step the pose system must be
 *            blending her into that step's preset (`PrivatePoseController.POSES`) — a turn step
 *            keeps the preset — the bridge must report that step, and the model must be told it
 *            ("step i of n"). A photograph of her is written per step: look at them.
 *   end      After the last step she holds it, and the model is told to ask if they want more.
 *
 * A Mature evening (ceiling 4) in the private cabaret, Spicy on, as the private audits set it up.
 * No model is called. Starts nexus-proxy itself if needed. Writes
 * audits/private-shows/runs/<stamp>-<lang>/{report.json, menu-<level>.png, <show>-<n>.png}.
 * Exit 1 on a failed check, 2 when the run failed.
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
const LANG = arg('--lang', 'en-US');
const SHOWS = arg('--shows', 'open-for-you,from-behind').split(',').filter(Boolean);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/private-shows/runs', `${stamp}-${LANG}`)));

// The package is "type": "module": these IIFEs leave their globals behind, which is what is read.
for (const f of ['PrivateActionPolicy.js', 'PrivatePoseController.js', 'PrivateRoutines.js'])
    await import(pathToFileURL(path.join(ROOT, 'src/experiences/private', f)).href);
const Policy = globalThis.NEXUS_PRIVATE_ACTION_POLICY;
const Poses = globalThis.NEXUS_PRIVATE_POSES;
const Routines = globalThis.NEXUS_PRIVATE_ROUTINES;
const openAt = (level) => Routines.openAt(level, Policy.poseLevel);

async function main() {
    fs.mkdirSync(out, { recursive: true });
    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const { chromium } = require('playwright');
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:1');
    const browser = await chromium.launch();
    const report = { lang: LANG, shows: SHOWS, menu: [], runs: [], failures: [], errors: [] };
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
        const started = await page.evaluate(async () => {
            const panel = window.NEXUS_BD.togetherPanel;
            const a = panel.activities.get('intimate');
            if (a.setAtmosphere) a.setAtmosphere({ world: 'private-cabaret' });
            const opt = (panel.contractFor('intimate')?.inputs() || []).find((x) => x.id === 'mature') || {
                id: 'mature',
            };
            const r = await panel.startActivity('intimate', opt);
            return { ok: !!(r && r.ok), why: r && r.why };
        });
        if (!started.ok) throw new Error(`Private did not start: ${started.why}`);
        await page.waitForTimeout(4000);

        const row = '#nexus-private-conversation-row';
        const read = () =>
            page.evaluate((row) => {
                const snap = window.NEXUS_PRIVATE_ACTIONS.snapshot();
                return {
                    level: window.NEXUS_BD.adult.level,
                    chips: [...document.querySelectorAll(`${row} [data-private-routine]`)].map(
                        (b) => b.dataset.privateRoutine
                    ),
                    routine: snap.routine,
                    preset: window.vrPoseSystem.getCurrentPreset(),
                    now: window.NEXUS_PRIVATE_ACTIONS.promptLines().filter((x) => /show/i.test(x)),
                };
            }, row);
        const openMenu = () =>
            page.evaluate((row) => {
                const panel = document.querySelector('#nexus-private-more-panel');
                if (panel && panel.hidden) document.querySelector(`${row} .nexus-private-more`)?.click();
            }, row);
        const click = (sel) =>
            page.evaluate(
                ([row, sel]) => {
                    const b = document.querySelector(`${row} ${sel}`);
                    if (b) b.click();
                    return !!b;
                },
                [row, sel]
            );
        const photo = async (name) => {
            const canvas = await page.evaluateHandle(() => window.NEXUS_VIEWER.renderer.domElement);
            await canvas.screenshot({ path: path.join(out, `${name}.png`) }).catch(() => {});
        };

        // menu: the Shows chips at every step, Warm to the top.
        for (let guard = 0; guard < 8; guard++) {
            await openMenu();
            await page.waitForTimeout(500);
            const now = await read();
            const want = openAt(now.level);
            report.menu.push({ level: now.level, chips: now.chips, want });
            if (now.chips.join(',') !== want.join(','))
                fail(`step ${now.level}: show chips ${now.chips.join(',') || '—'} ≠ ${want.join(',') || '—'}`);
            await page
                .locator(row)
                .screenshot({ path: path.join(out, `menu-${now.level}.png`) })
                .catch(() => {});
            if (now.level >= 4) break;
            if (!(await click('[data-private-action="closer"]'))) {
                fail(`step ${now.level}: no Closer button below the top`);
                break;
            }
            await page.waitForTimeout(4700); // ConsentFlow's userStepMinMs is 4 s
        }

        // run: each show from its chip, photographed at every step.
        for (const id of SHOWS) {
            const steps = Routines.ROUTINES[id].steps;
            const run = { id, steps: [] };
            report.runs.push(run);
            await openMenu();
            if (!(await click(`[data-private-routine="${id}"]`))) {
                fail(`${id}: no chip at the top`);
                continue;
            }
            let preset = null;
            for (let n = 0; n < steps.length; n++) {
                const step = steps[n];
                const want = step.pose === 'turn' ? null : Poses.POSES[step.pose].preset;
                await page
                    .waitForFunction(
                        ([n]) => {
                            const r = window.NEXUS_PRIVATE_ACTIONS.snapshot().routine;
                            return r && r.step >= n;
                        },
                        [n],
                        { timeout: 30000, polling: 200 }
                    )
                    .catch(() => {});
                await page.waitForTimeout(Math.min(2600, step.hold - 400)); // the blend, then her held
                const now = await read();
                preset = want || preset || now.preset;
                run.steps.push({ n: n + 1, pose: step.pose, want: preset, ...now });
                await photo(`${id}-${n + 1}-${step.pose}`);
                if (!now.routine || now.routine.id !== id || now.routine.step !== n)
                    fail(`${id} step ${n + 1}: bridge at ${JSON.stringify(now.routine)}`);
                if (now.preset !== preset) fail(`${id} step ${n + 1}: preset ${now.preset} ≠ ${preset}`);
                if (!now.now.some((l) => l.includes(`step ${n + 1} of ${steps.length}`)))
                    fail(`${id} step ${n + 1}: the model is not told this step`);
                console.log(
                    `${now.preset === preset ? 'ok  ' : 'FAIL'} ${id} ${n + 1}/${steps.length} ${step.pose} → ${now.preset}`
                );
                await page.waitForTimeout(Math.max(0, step.hold - Math.min(2600, step.hold - 400)));
            }
            await page.waitForTimeout(1200);
            const end = await read();
            run.end = end;
            if (!end.now.some((l) => /finished the show/.test(l))) fail(`${id}: not told the show ended`);
            // Stand between shows, as the person would ask.
            await page.evaluate(() =>
                window.NEXUS_PRIVATE_ACTIONS.request('avatar.pose', { pose: 'stand' }, { source: 'control' })
            );
            await page.waitForTimeout(2500);
        }
    } finally {
        await browser.close();
        server.stop();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    for (const m of report.menu) console.log(`step ${m.level}: ${m.chips.join(', ') || '—'}`);
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
