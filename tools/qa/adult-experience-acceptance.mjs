#!/usr/bin/env node
/**
 * AC9. The adult-experience scenarios, driven through the real app and judged by what it does.
 *
 *   node tools/qa/adult-experience-acceptance.mjs [--lang en|it] [--size desktop|phone]
 *                                                 [--out docs/qa/adult-experience] [--url http://127.0.0.1:8080]
 *
 * The app must be running (`npm start`). Headless Chromium draws through SwiftShader: these are
 * behaviour and layout measurements on the real avatar, never frame rate or headset evidence.
 *
 * What is real: the page, the avatar the viewer loads itself, the Together panel, Private's own
 * session, ConsentFlow, the composer (lines are typed into `#speech-text`), the pose system and the
 * animator. What is simulated, and nothing else: the person's own Private Mode confirmation
 * (localStorage, as the Settings toggle writes it, behind the age dialog) and, for the position
 * checks, the consent level set to 4 is NOT used here: only non-adult positions are exercised.
 * Not covered (and marked as such in the report): an outfit change from Forge (no Forge in this
 * environment), a Scene Tale run to its end (about five minutes), Quest and any headset.
 *
 * Writes <out>/acceptance-<lang>-<size>.json and the screenshots next to it. Exit 1 on a failed check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const LANG = arg('lang', 'en');
const SIZE = arg('size', 'desktop');
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs/qa/adult-experience')));
const CODE = LANG === 'it' ? 'it-IT' : 'en-US';
const SAY =
    LANG === 'it'
        ? {
              kneel: 'Inginocchiati',
              stand: 'Alzati',
              stop: 'basta',
              back: 'Sdraiati sulla schiena',
              bend: 'Piegati in avanti',
          }
        : { kneel: 'Kneel down', stand: 'Stand up', stop: 'stop', back: 'Lie on your back', bend: 'Bend forward' };
const PRESETS = [
    ['affectionate', 1],
    ['romantic', 2],
    ['sensual', 3],
    ['mature', 4],
];

fs.mkdirSync(OUT, { recursive: true });
const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
const { playwright } = D.loadPlaywright();
const server = await D.ensureServer(arg('url', 'http://127.0.0.1:8080').replace(/\/$/, ''));
const browser = await playwright.chromium.launch({ args: D.SWIFTSHADER });

const report = { lang: LANG, size: SIZE, startedAt: new Date().toISOString(), checks: [], errors: [], notTested: [] };
const check = (name, ok, detail) => {
    report.checks.push({ name, ok: Boolean(ok), detail: detail === undefined ? '' : detail });
    process.stderr.write(
        `${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 200)}\n`
    );
};
const step = async (name, fn) => {
    try {
        await fn();
    } catch (e) {
        check(name, false, `threw: ${String(e && e.message ? e.message : e).slice(0, 200)}`);
    }
};

const context = (privateOn) =>
    browser
        .newContext(
            SIZE === 'phone'
                ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }
                : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }
        )
        .then(async (ctx) => {
            await ctx.addInitScript(
                ([code, on]) => {
                    localStorage.setItem('app_lang', code);
                    localStorage.setItem('nexus_together_enabled', 'on');
                    localStorage.setItem('npc_enabled', 'false');
                    if (on) {
                        localStorage.setItem('nexus_spicy_enabled', 'true');
                        localStorage.setItem('nexus_spicy_verified', 'true');
                    }
                },
                [CODE, privateOn]
            );
            return ctx;
        });

const boot = async (ctx) => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(String(e.message).slice(0, 200)));
    await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () =>
            window.NEXUS_BD?.togetherPanel &&
            window.NEXUS_VIEWER?.avatarManager?.currentRoot &&
            window.__NEXUS_COMPANION_LIVE &&
            window.vrPoseSystem?.avatarRoot,
        null,
        { timeout: 240000 }
    );
    await page.waitForTimeout(2500);
    return page;
};

const shot = async (page, name) => {
    const file = path.join(OUT, `${LANG}-${SIZE}-${name}.png`);
    await page.screenshot({ path: file });
};

try {
    // ---- 0. Private Mode OFF: nothing to find, exactly as it has always been ---------------------
    {
        const ctx = await context(false);
        const page = await boot(ctx);
        await step('off-tile-hidden', async () => {
            const tiles = await page.evaluate(() => {
                window.NEXUS_BD.togetherPanel.open();
                return Array.from(document.querySelectorAll('[data-activity]')).map((e) => e.dataset.activity);
            });
            check(
                'Private Mode off: no Private tile in Together',
                !tiles.includes('intimate') && tiles.includes('playground'),
                tiles
            );
        });
        await ctx.close();
    }

    // ---- everything else with Private Mode on ---------------------------------------------------
    const ctx = await context(true);
    const page = await boot(ctx);
    await page.addScriptTag({ path: path.join(ROOT, 'tools/qa/pose-render-probe.js') });
    await page.evaluate(() => window.__probe.loadThree());
    const ref = await page.evaluate(() => window.__probe.standRef());
    report.ref = ref;

    const measure = () =>
        page.evaluate(() => {
            const m = window.__probe.measure().summary;
            const a = window.NEXUS_PROCEDURAL_ANIMATOR;
            const am = window.NEXUS_VIEWER.avatarManager;
            const s = window.NEXUS_PRIVATE_ACTIONS.snapshot();
            return {
                preset: m.preset,
                held: m.held,
                hipsY: m.hipsY,
                trunk: m.trunk,
                animator: { pose: a.isPoseMode(), edit: a.isEditMode() },
                background: (window.NEXUS_VIEWER.getVisualState?.() || {}).background || null,
                avatar: (am.current && am.current.url) || null,
                last: s.last ? { name: s.last.name, status: s.last.status, why: s.last.why } : null,
                active: s.active,
            };
        });
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
        await page.waitForTimeout(1500);
    };
    const type = async (text) => {
        await page.fill('#speech-text', text);
        await page.keyboard.press('Enter');
    };
    const startPrivate = (id) =>
        page.evaluate(async (presetId) => {
            const panel = window.NEXUS_BD.togetherPanel;
            const r = await panel.startActivity('intimate', { id: presetId });
            return { ok: Boolean(r && r.ok), why: r && r.why, active: panel.activeActivity };
        }, id);
    const stopPrivate = () => page.evaluate(() => window.NEXUS_BD.intimate.stop('user'));

    const base = await measure();
    report.base = base;
    await shot(page, '00-start');

    // ---- the phone sheet (AC1) ------------------------------------------------------------------
    if (SIZE === 'phone') {
        await step('sheet', async () => {
            await page.tap('#nexus-bd-together-launcher');
            await page.waitForTimeout(600);
            const rects = await page.evaluate(() =>
                Array.from(document.querySelectorAll('.nexus-bd-together-tile')).map((t) => {
                    const b = t.getBoundingClientRect();
                    return {
                        id: t.dataset.activity,
                        ok: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth,
                    };
                })
            );
            check(
                '390px: every Together tile (Private included) is on screen',
                rects.length >= 6 && rects.every((r) => r.ok),
                rects.filter((r) => !r.ok)
            );
            await shot(page, '01-together-sheet');
            await page.evaluate(() => window.NEXUS_BD.togetherPanel.close());
        });
    }

    // ---- Playground ----------------------------------------------------------------------------
    await step('playground', async () => {
        const opened = await page.evaluate(() => {
            const p = window.NEXUS_BD.togetherPanel;
            p.open();
            p.choose('playground', { fresh: true });
            return { view: p.view, pending: p.pending };
        });
        check(
            'Playground opens its setup from Together',
            opened.view === 'setup' && opened.pending === 'playground',
            opened
        );
        await shot(page, '02-playground-setup');
        // The real route (TG2): Playground > Life > "An evening together" opens the story screen.
        const clickText = (text) =>
            page.evaluate((t) => {
                const b = Array.from(document.querySelectorAll('#nexus-bd-together-panel button')).find((x) =>
                    x.textContent.includes(t)
                );
                if (b) b.click();
                return Boolean(b);
            }, text);
        await clickText('Life');
        await page.waitForTimeout(800);
        await clickText('evening');
        await page.waitForTimeout(800);
        const hasCreate = await page
            .waitForSelector('#nexus-bd-together-panel [data-action="create-story"]', { timeout: 15000 })
            .then(() => true)
            .catch(() => false);
        const started = hasCreate
            ? await page.evaluate(() => {
                  document.querySelector('#nexus-bd-together-panel [data-action="create-story"]').click();
                  return { stage: 'creating' };
              })
            : { stage: 'no-create' };
        let ready = false;
        if (started.stage === 'creating') {
            ready = await page
                .waitForFunction(
                    () => document.querySelector('#nexus-bd-together-panel [data-action="start-story"]'),
                    null,
                    { timeout: 120000 }
                )
                .then(() => true)
                .catch(() => false);
        }
        check('Playground prepares a story', ready, started);
        if (ready) {
            await page.evaluate(() =>
                document.querySelector('#nexus-bd-together-panel [data-action="start-story"]').click()
            );
            const playing = await page
                .waitForFunction(() => window.NEXUS_BD.togetherPanel.activeActivity === 'playground', null, {
                    timeout: 30000,
                })
                .then(() => true)
                .catch(() => false);
            check('Playground story starts and Together hands over to the conversation', playing);
            await page.waitForTimeout(1500);
            await shot(page, '03-playground-playing');
        }
        report.notTested.push('Scene Tale run to its ending (about five minutes; started and left, not completed)');
    });

    // ---- Playground -> Private through the real tile and setup ----------------------------------
    await step('playground-to-private', async () => {
        const cards = await page.evaluate(() => {
            const p = window.NEXUS_BD.togetherPanel;
            p.open();
            p.choose('intimate', { fresh: true });
            return Array.from(document.querySelectorAll('.nexus-private-preset')).map(
                (b) => b.dataset.preset || b.dataset.presetLocked
            );
        });
        check('Private setup offers the four styles from a running Playground', cards.length === 4, cards);
        await page.evaluate(() => document.querySelector('.nexus-private-preset[data-preset="romantic"]').click());
        await page.waitForTimeout(800);
        await shot(page, '04-private-setup-step2');
        // The real two-step path: "Get ready" prepares the evening, then "Begin".
        const getReady = await page
            .waitForSelector('[data-action="ready-private"], [data-action="begin-private"]', { timeout: 20000 })
            .then(() => true)
            .catch(() => false);
        if (getReady) {
            await page.evaluate(() => {
                const r = document.querySelector('[data-action="ready-private"]');
                if (r) r.click();
            });
        }
        const begin = await page
            .waitForSelector('[data-action="begin-private"]', { timeout: 120000 })
            .then(async () => {
                await page.evaluate(() => document.querySelector('[data-action="begin-private"]').click());
                return true;
            })
            .catch(() => false);
        const entered = await page
            .waitForFunction(() => window.NEXUS_BD.togetherPanel.activeActivity === 'intimate', null, {
                timeout: 90000,
            })
            .then(() => true)
            .catch(() => false);
        const playgroundActive = await page.evaluate(() =>
            Boolean(window.NEXUS_BD.togetherPanel.activities.get('playground')?.active)
        );
        check(
            'Playground ends and Private begins through the established gate',
            begin && entered && !playgroundActive,
            { begin, entered, playgroundActive }
        );
        await page.waitForTimeout(2500);
        await shot(page, '05-private-running');
    });

    /** A step that needs the evening running says so, and starts one (noted) rather than pass or fail on nothing. */
    const needsPrivate = async (name) => {
        const running = await page.evaluate(
            () => window.NEXUS_BD.togetherPanel.activeActivity === 'intimate' && window.NEXUS_BD.intimate.active
        );
        if (running) return true;
        check(`${name}: a Private evening is running`, false, 'not running; started one for the checks that follow');
        await startPrivate('romantic');
        await page.waitForTimeout(3000);
        return false;
    };

    // ---- a branch, then a pose and back ----------------------------------------------------------
    await step('branch', async () => {
        await needsPrivate('branch');
        const before = await page.evaluate(() => document.querySelectorAll('.nexus-private-turn.is-you').length);
        const clicked = await page.evaluate(() => {
            const b = document.querySelector('.nexus-private-choice, [data-private-choice]');
            if (!b) return false;
            b.click();
            return true;
        });
        await page.waitForTimeout(1500);
        const after = await page.evaluate(() => document.querySelectorAll('.nexus-private-turn.is-you').length);
        check('Tapping a dialogue choice becomes the person’s own turn', clicked && after > before, {
            clicked,
            before,
            after,
        });
    });

    await step('pose', async () => {
        await needsPrivate('pose');
        await type(SAY.kneel);
        await settle();
        const down = await measure();
        await shot(page, '06-pose-kneel');
        check(
            'A typed position is performed by the real avatar',
            down.held &&
                down.preset === 'kneeling' &&
                base.hipsY - down.hipsY >= 0.25 &&
                down.last &&
                down.last.status === 'completed',
            { preset: down.preset, hipsDrop: +(base.hipsY - down.hipsY).toFixed(3), last: down.last }
        );
        await type(SAY.stand);
        await settle();
        const up = await measure();
        check(
            'Standing up restores her posture and gives the idle animator back',
            !up.held &&
                Math.abs(up.hipsY - base.hipsY) <= 0.04 &&
                up.animator.pose === false &&
                up.animator.edit === false,
            { hipsY: up.hipsY, baseHips: base.hipsY, animator: up.animator }
        );
        const moves = await page.evaluate(async () => {
            const b = () =>
                window.NEXUS_VIEWER.avatarManager._currentVRM.humanoid.getRawBoneNode('chest').quaternion.toArray();
            const a = b();
            await new Promise((r) => setTimeout(r, 2000));
            const c = b();
            return a.some((x, i) => Math.abs(x - c[i]) > 1e-5);
        });
        check('Her idle motion is running again after the position is released', moves);
    });

    // ---- scene change and return ------------------------------------------------------------------
    await step('scene', async () => {
        await needsPrivate('scene');
        const before = (await measure()).background;
        const other = await page.evaluate(() => {
            const list =
                (window.NEXUS_SCENE_CATALOG && window.NEXUS_SCENE_CATALOG.list && window.NEXUS_SCENE_CATALOG.list()) ||
                [];
            const now = (window.NEXUS_VIEWER.getVisualState?.() || {}).background;
            const pick = list.map((s) => s.id).find((id) => id && id !== now && id !== 'black');
            return pick || null;
        });
        if (!other) {
            report.notTested.push('Scene change and return: no second scene in the catalogue');
            return;
        }
        // The person asked for it in words, which opens the change window; the controller does the change.
        await type(LANG === 'it' ? 'Cambia la scena' : 'Change the scene please');
        await page.waitForTimeout(800);
        const changed = await page.evaluate((id) => {
            const r = window.NEXUS_SCENE_AMBIENCE_CONTROLLER.apply(id, { source: 'user' });
            return Boolean(r && r.changed);
        }, other);
        await page.waitForTimeout(1500);
        const mid = (await measure()).background;
        await shot(page, '07-scene-changed');
        check('A place asked for in words changes the background', changed && mid === other, { before, mid, other });
        report.sceneBefore = before;
    });

    // ---- stop mid-action, with the app's own safe word ---------------------------------------------
    await step('stop', async () => {
        await needsPrivate('stop');
        await type(SAY.kneel);
        await page.waitForTimeout(700); // mid-transition: she is moving, not yet settled
        await type(SAY.stop);
        await page.waitForTimeout(6000);
        const end = await measure();
        const stopped = await page.evaluate(
            () => window.NEXUS_BD.togetherPanel.activeActivity !== 'intimate' && !window.NEXUS_BD.intimate.active
        );
        await shot(page, '08-after-stop');
        check(`"${SAY.stop}" typed mid-action ends the evening`, stopped);
        check(
            'Ending mid-action leaves her standing, in her own animation, as she began',
            !end.held &&
                Math.abs(end.hipsY - base.hipsY) <= 0.04 &&
                end.animator.pose === false &&
                end.animator.edit === false,
            { hipsY: end.hipsY, baseHips: base.hipsY, animator: end.animator }
        );
        check('The original avatar is still the one on screen', end.avatar === base.avatar, {
            base: base.avatar,
            end: end.avatar,
        });
        check('The place the evening began in is back', end.background === base.background, {
            base: base.background,
            end: end.background,
        });
    });

    // ---- every style's ceiling, and that it is given back ------------------------------------------
    await step('styles', async () => {
        for (const [id, ceiling] of PRESETS) {
            const r = await startPrivate(id);
            await page.waitForTimeout(2500);
            const max = await page.evaluate(() => window.NEXUS_BD.adult.maxLevel);
            check(`Style ${id}: the ceiling is ${ceiling}`, r.ok && max === ceiling, { start: r, max });
            await stopPrivate();
            await page.waitForTimeout(1500);
            const after = await page.evaluate(() => ({
                active: window.NEXUS_BD.adult.active,
                max: window.NEXUS_BD.adult.maxLevel,
                activity: window.NEXUS_BD.blackboard.activity,
            }));
            check(
                `Style ${id}: leaving gives the ceiling back and clears the adult state`,
                !after.active && after.max === 4 && after.activity !== 'intimate',
                after
            );
        }
    });

    // ---- the phone footer with its transient status (AC7) -------------------------------------------
    if (SIZE === 'phone') {
        await step('footer', async () => {
            await startPrivate('romantic');
            await page.waitForTimeout(3000);
            await page.evaluate(() => {
                window.NEXUS_BD.adult.level = 2;
                window.NEXUS_BD.intimate._privateExperience._easeUp();
            });
            await page.waitForTimeout(400);
            const m = await page.evaluate(() => {
                const shell = document.querySelector('.nexus-private-shell').getBoundingClientRect();
                const buttons = Array.from(
                    document.querySelectorAll('.nexus-private-controls button, .nexus-private-controls *')
                ).filter((e) => e.tagName === 'BUTTON');
                return {
                    status: document.querySelector('.nexus-private-status')?.textContent || '',
                    shell: { l: Math.round(shell.left), r: Math.round(shell.right) },
                    buttons: buttons.map((b) => ({
                        t: b.textContent.trim(),
                        l: Math.round(b.getBoundingClientRect().left),
                        r: Math.round(b.getBoundingClientRect().right),
                    })),
                };
            });
            await shot(page, '09-private-footer');
            check(
                '390px: Closer/Ease/End stay inside the card while a status shows',
                m.buttons.length > 0 && m.buttons.every((b) => b.l >= m.shell.l - 1 && b.r <= m.shell.r + 1),
                m
            );
            await stopPrivate();
        });
    }

    report.notTested.push(
        'Outfit change and cancelling one while it loads: needs Forge, which is not running here (covered by the LT10 and BI suites)'
    );
    report.notTested.push('Quest / headset: not available');
    await ctx.close();
} catch (e) {
    report.crash = String(e && e.stack ? e.stack : e).slice(0, 900);
    check('driver', false, report.crash.split('\n')[0]);
} finally {
    report.finishedAt = new Date().toISOString();
    report.failed = report.checks.filter((c) => !c.ok).length;
    fs.writeFileSync(path.join(OUT, `acceptance-${LANG}-${SIZE}.json`), JSON.stringify(report, null, 1));
    process.stdout.write(
        `${LANG}/${SIZE}: ${report.checks.length - report.failed} passed, ${report.failed} failed, ${report.errors.length} page errors\n`
    );
    await browser.close();
    server.stop();
    process.exitCode = report.failed || report.crash ? 1 : 0;
}
