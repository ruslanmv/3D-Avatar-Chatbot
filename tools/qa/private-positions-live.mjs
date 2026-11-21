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
 *   L5       `--level5`: Closer at 4 opens step 5 (No limits) and Ease closes it; `--forge-grant`
 *            makes the second gate real (the grant from FORGE_GRANT in the environment, never a
 *            file); `--behind` adds each position from behind her; `--world <id>` picks the room
 *            (`window-room` has a bed and nothing behind her). Writes sheet.png with every frame.
 *   states   `--states doggy-fisted,doggy-anal-fisted-cum,…` (with the level-5 run): before the
 *            positions she changes into her bare look whose skin pack holds the most of them (as
 *            Forge lists it, `look.body.states`); after each position her skin is switched to each
 *            state in turn and framed from behind (`<key>-<state>.png`, on the sheet). The look is
 *            worn through the wardrobe controller and the state painted by the app's own
 *            SkinStateSwitcher, the way the bridge shows a fist or a finish.
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
// The room the evening runs in. The cabaret is the default; its tables stand behind her, so
// views from behind (`--behind`) read better in a room with a bed, e.g. `--world window-room`.
const WORLD = arg('--world', 'private-cabaret');
// L5. With `--forge-grant`, the second gate is real: the grant is read from FORGE_GRANT in the
// environment (never an argument, file or log) and given to the page as Settings would keep it,
// so the bridge's probe asks the deployed Forge. Without it, Forge's answer is stood in for.
const REAL_GRANT = process.argv.includes('--forge-grant') ? String(process.env.FORGE_GRANT || '').trim() : '';
if (process.argv.includes('--forge-grant') && !REAL_GRANT) {
    console.error('--forge-grant needs the grant in FORGE_GRANT');
    process.exit(2);
}
// L5. Skin states to show on her after each position (see `states` above). Empty: none.
const STATES = arg('--states', '').split(',').filter(Boolean);
// BD38. Lines the person types after each position (`|` between lines): see `--say` below.
// NL1. A playground mood for the room (`--mood normal-room`): see where it is applied below.
const MOOD = arg('--mood', '');
const SAY = (arg('--say') || '')
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);
// The library character whose prebuilt list holds those looks (Avatar A by default).
const SLUG = arg('--slug', 'avatar-sample-a');
const FORGE_URL = arg('--forge-url', '');
const AVATAR = arg('--avatar', '');
// HA1. `--hair-aside`: after each plain frame from behind, her hair is moved aside (the mode the
// ⋯ chip turns on, NEXUS_HAIR_ASIDE) and framed again; the state frames are then taken with it on.
const HAIR_ASIDE = process.argv.includes('--hair-aside');
// BD25. `--look-id <id>`: wear exactly this look (a rebuild Forge holds but has not listed, since
// bare looks are keep-existing), dressed with the listed look of the same body: same states, its
// own files. Without it, the best listed match is worn.
const LOOK_ID = arg('--look-id', '');
// With `--look-id`, the SHA-256 of that look's file (the listed look's hash is another file's).
const LOOK_SHA = arg('--look-sha', '');
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
        // `--avatar <file>`: another character from vendor/avatars, chosen as the avatar menu keeps it.
        if (AVATAR) await ctx.addInitScript((file) => localStorage.setItem('nexus_selected_avatar_file', file), AVATAR);
        if (REAL_GRANT)
            await ctx.addInitScript((grant) => localStorage.setItem('wardrobe_forge_grant', grant), REAL_GRANT);
        // `--forge-url`: another Forge than the default Space (a local one with looks just built),
        // chosen the way Settings stores a custom Forge.
        if (FORGE_URL)
            await ctx.addInitScript((url) => {
                localStorage.setItem('wardrobe_forge_mode', 'custom');
                localStorage.setItem('wardrobe_forge_url', url);
            }, FORGE_URL);
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
        report.started = await page.evaluate(async (world) => {
            const panel = window.NEXUS_BD.togetherPanel;
            const a = panel.activities.get('intimate');
            if (a.setAtmosphere) a.setAtmosphere({ world });
            const opt = (panel.contractFor('intimate')?.inputs() || []).find((x) => x.id === 'mature') || {
                id: 'mature',
            };
            const r = await panel.startActivity('intimate', opt);
            return { ok: !!(r && r.ok), why: r && r.why };
        }, WORLD);
        if (!report.started.ok) throw new Error(`Private did not start: ${report.started.why}`);
        await page
            .waitForFunction((w) => (window.NEXUS_VIEWER.vrWorlds?.activeId || '').includes(w), WORLD, {
                timeout: 120000,
            })
            .catch(() => fail(`start: ${WORLD} not shown`));
        await page.waitForTimeout(3000);
        // NL1. `--mood <id>`: the room in one of the playground moods (`normal-room`: the Window
        // Room in ordinary light, sky, fog and floor included), the way 💡 Light sets it.
        if (MOOD) {
            report.mood = await page.evaluate((id) => {
                const m = window.NEXUS_PLAYGROUND_MOODS && window.NEXUS_PLAYGROUND_MOODS.get(id);
                if (!m) return { ok: false, why: 'no such mood' };
                window.dispatchEvent(
                    new CustomEvent('nexus-world-mood', {
                        detail: { light: m.light, room: m.room || null, instant: true },
                    })
                );
                return { ok: true, label: m.label };
            }, MOOD);
            if (!report.mood.ok) fail(`mood ${MOOD}: ${report.mood.why}`);
            await page.waitForTimeout(800);
        }

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
                              // What the check measured when it refused (palms, hips, who held her).
                              measured:
                                  l.status === 'failed'
                                      ? JSON.stringify(l.result || l.measured || null).slice(0, 1500)
                                      : undefined,
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

        // states: wear the bare look whose skin pack holds the most of the states asked for.
        if (STATES.length) {
            const worn = await page.evaluate(
                async (want) => {
                    // Her looks as the closet reads them: the library character's prebuilt list (the
                    // read grant opens its private entries), each bare one with Forge's `body`.
                    const c = window.NEXUS_WARDROBE.service.controller;
                    const listed = await c.forge.request('/v1/library/' + encodeURIComponent(want.slug) + '/prebuilt');
                    const looks = (listed && listed.looks) || [];
                    const { lookId, lookSha } = want;
                    want = want.states;
                    want.lookId = lookId;
                    want.lookSha = lookSha;
                    const score = (l) =>
                        l && l.body && Array.isArray(l.body.states)
                            ? want.filter((x) => l.body.states.includes(x)).length
                            : 0;
                    // A tie goes to the newest build: after a repaint (BD25) the fresh paint is what to see.
                    let best = looks
                        .filter((l) => score(l) > 0)
                        .sort(
                            (a, b) => score(b) - score(a) || String(b.builtAt || '').localeCompare(a.builtAt || '')
                        )[0];
                    // A look not listed yet may hold states no listed look has (a new kind): any listed
                    // bare look serves as its template, its own id, file and hash put in below.
                    const template =
                        best ||
                        (want.lookId
                            ? looks
                                  .filter((l) => l && l.body)
                                  .sort((a, b) => String(b.builtAt || '').localeCompare(a.builtAt || ''))[0]
                            : null);
                    if (!template) return { ok: false, looks: looks.length };
                    if (!best) best = template;
                    if (want.lookId) {
                        best.lookId = best.id = want.lookId;
                        best.vrmUrl = '/v1/assets/looks/' + want.lookId + '/look.vrm';
                        if (want.lookSha) best.outputSha256 = best.sha256 = want.lookSha;
                    }
                    // As the closet hands it over (TryOnHaulActivity): the hash Forge listed, so the
                    // download is verified and carries the read grant. Without it the loader
                    // fetches a private file bare and Forge answers 404.
                    const wear = {
                        ...best,
                        vrmUrl: c.forge.resolveUrl(best.vrmUrl),
                        ...(best.outputSha256 && !best.sha256 ? { sha256: best.outputSha256 } : {}),
                    };
                    window.__qaStateLook = wear;
                    await c.applyLook(wear);
                    return {
                        ok: true,
                        id: best.id || best.lookId,
                        holds: want.lookId ? want.slice() : want.filter((x) => best.body.states.includes(x)),
                    };
                },
                { slug: SLUG, states: STATES, lookId: LOOK_ID, lookSha: LOOK_SHA }
            );
            report.stateLook = worn;
            if (!worn.ok) fail(`states: no listed look holds ${STATES.join(',')} (${worn.looks} looks)`);
            else console.log(`ok   wearing ${worn.id}: ${worn.holds.join(', ')}`);
            await page
                .waitForFunction(
                    () => window.NEXUS_VIEWER?.avatarManager?.currentRoot && window.vrPoseSystem?.avatarRoot,
                    null,
                    {
                        timeout: 240000,
                    }
                )
                .catch(() => {});
            await page.waitForTimeout(4000);
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
            // L5. `--behind`: the same position from behind her and a little above, the way the
            // person sees it from behind. "Behind" is read off her posed skeleton (hips to head,
            // flat), not her file's forward axis, which VRM 0.x and 1.0 disagree on.
            if (process.argv.includes('--behind')) {
                await page.evaluate(() => {
                    const T = window.THREE;
                    const v = window.NEXUS_VIEWER;
                    const h = v.avatarManager._currentVRM.humanoid;
                    const hips = h.getRawBoneNode('hips').getWorldPosition(new T.Vector3());
                    const head = h.getRawBoneNode('head').getWorldPosition(new T.Vector3());
                    const ahead = head.clone().sub(hips).setY(0);
                    if (ahead.lengthSq() < 1e-4) ahead.set(0, 0, 1); // upright: her own forward
                    ahead.normalize();
                    v.camera.position.copy(
                        hips
                            .clone()
                            .addScaledVector(ahead, -0.95)
                            .add(new T.Vector3(0, 0.3, 0))
                    );
                    v.controls.target.copy(hips);
                    v.controls.update();
                });
                await page.waitForTimeout(500);
                await canvas.screenshot({ path: path.join(out, `${key}-behind.png`) }).catch(() => {});
                if (HAIR_ASIDE) {
                    const moved = await page.evaluate(() =>
                        window.NEXUS_HAIR_ASIDE ? window.NEXUS_HAIR_ASIDE.applyCurrent('front') : -1
                    );
                    report.hairAside = { ...(report.hairAside || {}), [key]: moved };
                    if (!(moved > 0)) fail(`hair aside on ${key}: ${moved} joints`);
                    await page.waitForTimeout(2500);
                    await canvas.screenshot({ path: path.join(out, `${key}-behind-hair.png`) }).catch(() => {});
                }
                // L5. Each state asked for, painted by the app's own switcher on the look she wears.
                for (const st of report.stateLook && report.stateLook.ok ? STATES : []) {
                    const shown = await page.evaluate(async (st) => {
                        const look = window.__qaStateLook;
                        const root = window.NEXUS_VIEWER.avatarManager.currentRoot;
                        if (!window.__qaSkin || window.__qaSkinRoot !== root) {
                            const forge = window.NEXUS_WARDROBE.service.controller.forge;
                            window.__qaSkin = window.NEXUS_SKIN_STATES.create({
                                fetch: window.fetch.bind(window),
                                headersFor: async (url) =>
                                    forge && forge.downloadHeadersNow ? forge.downloadHeadersNow(url) : {},
                            });
                            window.__qaSkinRoot = root;
                            await window.__qaSkin.attach(root, look);
                        }
                        return window.__qaSkin.apply(st);
                    }, st);
                    if (!shown) fail(`state ${st}: not shown on ${key}`);
                    await page.waitForTimeout(700);
                    await canvas.screenshot({ path: path.join(out, `${key}-${st}.png`) }).catch(() => {});
                }
            }
            // BD38. `--say "line|line"`: each line typed into the chat as the person would (the
            // conversation surface a chip speaks through), after the position. What the bridge did
            // with it (action, status, the state shown) goes in the report, and she is framed
            // from behind: proof the words reach her body, not only the QA switcher above.
            for (const [i, line] of SAY.entries()) {
                const before = await page.evaluate(() => window.NEXUS_PRIVATE_ACTIONS.log().length);
                const sent = await page.evaluate(
                    (l) => !!(window.NEXUS_CONVERSATION_SURFACE && window.NEXUS_CONVERSATION_SURFACE.send(l)),
                    line
                );
                await page
                    .waitForFunction(
                        (n) => {
                            const fresh = window.NEXUS_PRIVATE_ACTIONS.log().slice(n);
                            return fresh.length && fresh.every((a) => a.status !== 'pending');
                        },
                        before,
                        { timeout: 90000, polling: 250 }
                    )
                    .catch(() => {});
                await page.waitForTimeout(2500);
                const did = await page.evaluate(
                    (n) =>
                        window.NEXUS_PRIVATE_ACTIONS.log()
                            .slice(n)
                            .map((a) => ({
                                name: a.name,
                                status: a.status,
                                why: a.why || null,
                                result: a.result || null,
                            })),
                    before
                );
                const skin = await page.evaluate(() => {
                    const b = window.NEXUS_PRIVATE_ACTIONS.snapshot();
                    return (b && b.skin) || null;
                });
                await canvas.screenshot({ path: path.join(out, `${key}-say-${i + 1}.png`) }).catch(() => {});
                report.said = [...(report.said || []), { key, line, sent, did, skin }];
                const body = did.find((a) => a.name.startsWith('body.'));
                if (!sent || !body || body.status !== 'completed')
                    fail(`say "${line}" on ${key}: ${JSON.stringify(body || did)}`);
                else console.log(`ok   say "${line}" on ${key} → ${body.name} ${JSON.stringify(body.result)}`);
            }
            if (HAIR_ASIDE) await page.evaluate(() => window.NEXUS_HAIR_ASIDE && window.NEXUS_HAIR_ASIDE.release());
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
        // L5. One sheet for the run: her renders at step 4 and 5, every position taken (and from
        // behind with --behind), and the card at step 5. Built by the same browser, so a run is
        // judged from one image rather than a folder (look at it: numbers missed a table in the way).
        await sheet(browser).catch((e) => console.warn('sheet not drawn:', e.message));
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

/** L5. `sheet.png`: every frame this run took, labelled, in the order of the evening. */
async function sheet(browser) {
    const order = [
        ['render-step-4', 'Step 4'],
        ['render-step-5', 'Step 5 · No limits'],
        ...KEYS.flatMap((k) => [
            [k, k],
            [`${k}-behind`, `${k} · behind`],
            [`${k}-behind-hair`, `${k} · behind · hair aside`],
            ...STATES.map((st) => [`${k}-${st}`, `${k} · ${st}`]),
            ...SAY.map((line, i) => [`${k}-say-${i + 1}`, `${k} · "${line}"`]),
        ]),
        ['level-5', 'The card at step 5'],
    ].filter(([f]) => fs.existsSync(path.join(out, `${f}.png`)));
    if (!order.length) return;
    const cells = order
        .map(([f, label]) => {
            const src = 'data:image/png;base64,' + fs.readFileSync(path.join(out, `${f}.png`)).toString('base64');
            return `<figure><figcaption>${label}</figcaption><img src="${src}"></figure>`;
        })
        .join('');
    const html =
        '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#111;color:#eee;font:13px system-ui;' +
        'display:flex;flex-wrap:wrap;width:1500px}figure{margin:4px;width:362px}img{width:362px;height:auto;display:block}' +
        'figcaption{padding:2px 0}</style>' +
        cells;
    const page = await browser.newPage({ viewport: { width: 1500, height: 600 } });
    await page.setContent(html);
    await page.screenshot({ path: path.join(out, 'sheet.png'), fullPage: true });
    await page.close();
    console.log(`sheet: ${path.join(out, 'sheet.png')}`);
}

main().then(
    (code) => process.exit(code),
    (error) => {
        console.error(error);
        process.exit(2);
    }
);
