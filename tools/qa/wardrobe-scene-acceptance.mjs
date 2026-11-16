#!/usr/bin/env node
/**
 * LT10. Her wardrobe across scenes: clothed looks, worn in a Private evening, through
 * PrivateActionBridge only, while the evening travels from one place to another and ends.
 *
 *   node tools/qa/wardrobe-scene-acceptance.mjs [--size desktop|phone] [--lang it-IT|en-US] [--out dir]
 *
 * The clothed matrix (tools/qa/wardrobe-clothed-acceptance.mjs) proves wear, verify, cancel and
 * restore on Try-On's own path. Inside Private that path is not allowed: every action goes
 * through PrivateActionBridge (PX1), which reads the person's words, and the in-scene wardrobe
 * wears without leaving the place. The places themselves (VW, the travel of UN4/M2) were merged
 * after the wardrobe's cancellation work, so this run is the two together:
 *
 *   1. A Private evening opens in its first place (the `romantic` style; nobody touches the
 *      pace, and no Forge is contacted: her looks are the verified pack's, general-rated).
 *   2. The person asks her to put on jeans. The bridge chooses her clothed pack look; the
 *      controller wears it as verified bytes; the renderer's root is that file.
 *   3. She invites, the person says yes, the evening travels. On arrival (the renderer's own
 *      `nexus-world-shown` for the destination) she still wears that look: the same file is the
 *      renderer's root, nothing was reloaded, and the destination is the one the evening's
 *      outline named before any outfit was touched.
 *   4. Stale request: the other look's download is held and asked for; before it arrives the
 *      person asks for the jeans again. Released, the held look never reaches the renderer.
 *   5. Pending load at the end of the session: the other look is held and asked for again, and
 *      the session ends while it waits. Released, it never reaches the renderer; she is in her
 *      own outfit, on her own file, and the place is handed back.
 *
 * Read-only: the bridge's log, the controller, the manager, the world runtime. Screenshots and
 * report.json under --out; exit 1 on failure.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
};
const size = arg('--size', 'desktop');
const lang = arg('--lang', 'it-IT');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/wardrobe/runs', `${stamp}-scenes-${size}-${lang}`)));
fs.mkdirSync(out, { recursive: true });
const IT = lang.startsWith('it');
const SAY = {
    jeans: IT ? 'Mettiti i jeans' : 'Put on the jeans',
    sundress: IT ? 'Mettiti il vestito giallo' : 'Put on the yellow sundress',
    yes: IT ? 'Sì, andiamo' : "Yes, let's go",
};
const AVATAR = { slug: 'avatar-sample-a', file: 'AvatarSample_A.vrm' };
const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor/wardrobe/wardrobe.json'), 'utf8'));
const looks = pack.looks.filter((l) => l.avatarId === AVATAR.slug);
const byId = Object.fromEntries(looks.map((l) => [l.id, l]));
const avatarSha = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, 'vendor/avatars', AVATAR.file)))
    .digest('hex');
const lookPath = (look) => new RegExp(`${look.vrmUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\?.*)?$`);

const report = { size, lang, steps: [], checks: {}, failures: [], errors: [], screenshots: [] };
const fail = (check, what) => {
    report.checks[check] = false;
    report.failures.push(`${check}: ${what}`);
};
const ok = (check) => {
    if (!(check in report.checks)) report.checks[check] = true;
};

const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
const { playwright } = D.loadPlaywright();
const server = await D.ensureServer(arg('--url', 'http://127.0.0.1:8080').replace(/\/$/, ''));
const browser = await playwright.chromium.launch({ args: D.SWIFTSHADER });
try {
    const ctx = await browser.newContext(
        size === 'desktop'
            ? { viewport: { width: 1440, height: 900 } }
            : {
                  viewport: { width: 390, height: 844 },
                  isMobile: true,
                  hasTouch: true,
                  userAgent: playwright.devices['Pixel 7'].userAgent,
                  deviceScaleFactor: 1,
              }
    );
    await ctx.addInitScript((code) => {
        localStorage.setItem('app_lang', code);
        localStorage.setItem('nexus_together_enabled', 'on');
        localStorage.setItem('nexus_spicy_enabled', 'true');
        localStorage.setItem('nexus_spicy_verified', 'true');
        localStorage.setItem('npc_enabled', 'false');
        // The pack only. No Forge, so no private-rated look exists in this run at all.
        localStorage.setItem('wardrobe_forge_mode', 'off');
    }, lang);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(String(e.message).slice(0, 240)));
    await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () =>
            window.NEXUS_BD?.togetherPanel?.activities?.get('intimate') &&
            window.NEXUS_VIEWER?.avatarManager?.currentRoot &&
            window.NEXUS_WARDROBE?.service?.controller &&
            window.__NEXUS_COMPANION_LIVE,
        null,
        { timeout: 300000 }
    );
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
        const m = window.NEXUS_VIEWER.avatarManager;
        const c = window.NEXUS_WARDROBE.service.controller;
        window.__loads = [];
        window.__verified = [];
        window.__travelLog = [];
        const load = m.setAvatarByUrl.bind(m);
        m.setAvatarByUrl = (url, ...rest) => {
            window.__loads.push(String(url));
            return load(url, ...rest);
        };
        if (c.verifyLook) {
            const verify = c.verifyLook;
            c.verifyLook = async (look, options) => {
                const result = await verify(look, options);
                window.__verified.push({ id: look.id, url: String(result.url) });
                return result;
            };
        }
        window.addEventListener('nexus-world-request', (e) =>
            window.__travelLog.push({ kind: 'request', ...(e.detail || {}) })
        );
        window.addEventListener('nexus-world-shown', (e) =>
            window.__travelLog.push({ kind: 'shown', ...(e.detail || {}) })
        );
    });

    const state = (label) =>
        page.evaluate(async (label) => {
            const viewer = window.NEXUS_VIEWER;
            const m = viewer.avatarManager;
            const c = window.NEXUS_WARDROBE.service.controller;
            const A = window.NEXUS_PRIVATE_ACTIONS;
            const current = m.getCurrent ? m.getCurrent() : m.current;
            const snap = A.snapshot();
            const w = A.log()
                .filter((a) => a.family === 'wardrobe')
                .pop();
            let sha = null;
            try {
                const bytes = await (await fetch(String(current.url).split('#')[0])).arrayBuffer();
                const digest = await crypto.subtle.digest('SHA-256', bytes);
                sha = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
            } catch (_) {
                sha = null;
            }
            let inScene = false;
            for (let o = m.currentRoot; o; o = o.parent) if (o === viewer.scene) inScene = true;
            const id = viewer.vrWorlds?.activeId || null;
            const said = window.__travelLog.filter((e) => e.kind === 'shown' && e.id === id).pop();
            return {
                label,
                world: (said && said.base) || id,
                phase: snap.story && snap.story.phase,
                level: snap.level === undefined ? null : snap.level,
                outfitState: snap.outfitState || null,
                wardrobe: w ? { name: w.name, status: w.status, why: w.why || null } : null,
                wardrobeActions: A.log().filter((a) => a.family === 'wardrobe').length,
                rootUuid: m.currentRoot.uuid,
                rootInScene: inScene,
                managerUrl: current && current.url ? String(current.url) : null,
                loadedSha256: sha,
                wornUrl: c.wornUrl ? String(c.wornUrl) : null,
                activeLook: c.activeLook ? { id: c.activeLook.id, rating: c.activeLook.rating || null } : null,
                pending: Boolean(c.pending),
                loads: window.__loads.slice(),
                verified: window.__verified.slice(),
                travel: window.__travelLog.slice(),
                overflowX: document.documentElement.scrollWidth - window.innerWidth,
            };
        }, label);
    const shoot = async (label) => {
        const file = `${size}-${lang}-${label}.png`;
        const buffer = await page.screenshot({ path: path.join(out, file) });
        report.screenshots.push({ file, bytes: buffer.length });
    };
    const say = (text) => page.evaluate((t) => window.NEXUS_CONVERSATION_SURFACE.renderUser(t), text);
    const settle = async (check, previous) => {
        await page
            .waitForFunction(
                (n) => {
                    const all = window.NEXUS_PRIVATE_ACTIONS.log().filter((a) => a.family === 'wardrobe');
                    const w = all[all.length - 1];
                    return all.length > n && w && w.status !== 'pending';
                },
                previous,
                { timeout: 240000 }
            )
            .catch(() => fail(check, 'the wardrobe action never settled'));
        await page.waitForTimeout(2500);
    };
    const lookOf = (s, url) => (s.verified.find((v) => v.url === url) || {}).id || null;

    // ---- 1. The evening opens ---------------------------------------------------------------------
    await page.evaluate(async () => {
        const panel = window.NEXUS_BD.togetherPanel;
        const a = panel.activities.get('intimate');
        if (a.setAtmosphere) a.setAtmosphere({ world: 'private-cabaret' });
        const opt = (panel.contractFor('intimate')?.inputs() || []).find((x) => x.id === 'romantic') || {
            id: 'romantic',
        };
        await panel.startActivity('intimate', opt);
    });
    await page
        .waitForFunction(() => /private-cabaret/.test(window.NEXUS_VIEWER.vrWorlds?.activeId || ''), null, {
            timeout: 120000,
        })
        .catch(() => fail('Scene navigation', 'the opening place was not shown'));
    await page.waitForFunction(() => window.NEXUS_PRIVATE_ACTIONS.snapshot().story, null, { timeout: 30000 });
    await page.waitForTimeout(2000);
    const s1 = await state('01-opening');
    report.steps.push(s1);
    if (!s1.managerUrl || !s1.managerUrl.split('?')[0].endsWith(AVATAR.file))
        fail('Session start', `the page loaded ${s1.managerUrl}`);
    if (s1.loadedSha256 !== avatarSha) fail('Session start', 'the renderer is not on her pinned file');
    if (s1.activeLook) fail('Session start', 'a look is worn before anything was asked');
    ok('Session start');
    const destination = await page.evaluate(() => {
        const m = /<go place="([a-z0-9-]+)"\/>/.exec(window.NEXUS_PRIVATE_ACTIONS.promptLines().join('\n'));
        return m ? m[1] : null;
    });
    report.destination = destination;
    if (!destination) fail('Existing destinations', 'the evening offers no destination');
    await shoot('01-opening');

    // ---- 2. Jeans, by her words, through the bridge ---------------------------------------------
    let n = s1.wardrobeActions;
    await say(SAY.jeans);
    await settle('Wear through PrivateActionBridge', n);
    const s2 = await state('02-jeans');
    report.steps.push(s2);
    const first = s2.activeLook && byId[s2.activeLook.id];
    if (!s2.wardrobe || s2.wardrobe.status !== 'completed')
        fail('Wear through PrivateActionBridge', `not completed: ${JSON.stringify(s2.wardrobe)}`);
    if (!first)
        fail(
            'Wear through PrivateActionBridge',
            `she wears ${JSON.stringify(s2.activeLook)}, not one of her pack looks`
        );
    if (first && first.rating !== 'general')
        fail('Wear through PrivateActionBridge', `a ${first.rating} look was worn; this run is clothed looks`);
    if (first && s2.loadedSha256 !== first.sha256)
        fail('Wear through PrivateActionBridge', "the renderer is not on that look's verified bytes");
    if (s2.managerUrl !== s2.wornUrl || !String(s2.wornUrl).startsWith('blob:'))
        fail('Wear through PrivateActionBridge', 'the renderer root is not the worn look');
    if (s2.level !== s1.level) fail('Wear through PrivateActionBridge', `the pace moved (${s1.level} → ${s2.level})`);
    ok('Wear through PrivateActionBridge');
    report.firstLook = first ? first.id : null;
    const second = looks.find((l) => !first || l.id !== first.id);
    await shoot('02-jeans');
    const destinationAfter = await page.evaluate(() => {
        const m = /<go place="([a-z0-9-]+)"\/>/.exec(window.NEXUS_PRIVATE_ACTIONS.promptLines().join('\n'));
        return m ? m[1] : null;
    });
    if (destinationAfter !== destination)
        fail('Existing destinations', `the destination changed with her outfit (${destination} → ${destinationAfter})`);

    // ---- 3. Travel: she arrives wearing it ---------------------------------------------------------
    await page.evaluate(
        (d) => window.NEXUS_PRIVATE_ACTIONS.consumeTravel(`Vieni con me.\n<go place="${d}"/>`),
        destination || 'elsewhere'
    );
    await page.waitForTimeout(1000);
    await say(SAY.yes);
    await page
        .waitForFunction(
            (d) => {
                const id = window.NEXUS_VIEWER.vrWorlds?.activeId || '';
                const shown = window.__travelLog.filter((e) => e.kind === 'shown').pop();
                const base = (shown && shown.id === id && shown.base) || id;
                return base === d && window.NEXUS_PRIVATE_ACTIONS.snapshot().story?.phase === 'arrived';
            },
            destination,
            { timeout: 180000 }
        )
        .catch(() => fail('Scene navigation', `never arrived at ${destination}`));
    await page.waitForTimeout(2500);
    const s3 = await state('03-arrived');
    report.steps.push(s3);
    if (s3.world !== destination) fail('Scene navigation', `the renderer shows ${s3.world}`);
    if (!s3.travel.some((e) => e.kind === 'request' && e.id === destination && e.owner === 'intimate'))
        fail('Scene navigation', 'the place was not requested through the Private channel');
    ok('Scene navigation');
    if (!s3.activeLook || !first || s3.activeLook.id !== first.id)
        fail('Outfit travels with her', `on arrival she wears ${JSON.stringify(s3.activeLook)}`);
    if (s3.managerUrl !== s2.managerUrl || s3.rootUuid !== s2.rootUuid)
        fail('Outfit travels with her', 'her model was reloaded by the trip');
    if (first && s3.loadedSha256 !== first.sha256) fail('Outfit travels with her', 'what is on stage is not that look');
    if (!s3.rootInScene) fail('Outfit travels with her', 'she is not on stage in the new place');
    if (s3.loads.length !== s2.loads.length)
        fail('Outfit travels with her', `${s3.loads.length - s2.loads.length} model loads happened during the trip`);
    ok('Outfit travels with her');
    ok('Existing destinations');
    await shoot('03-arrived-in-jeans');

    // ---- 4. A stale request cannot overwrite what she wears ------------------------------------------
    {
        let release;
        const held = new Promise((r) => (release = r));
        await page.route(lookPath(second), async (route) => {
            await held;
            await route.continue().catch(() => {});
        });
        n = s3.wardrobeActions;
        await say(SAY.sundress);
        const pending = await page
            .waitForFunction(() => window.NEXUS_WARDROBE.service.controller.pending, null, { timeout: 30000 })
            .then(() => true)
            .catch(() => false);
        report.stalePendingSeen = pending;
        if (!pending) fail('Stale request handling', 'the second look was never on its way');
        await say(SAY.jeans); // changed their mind while it downloads
        await page.waitForTimeout(2500);
        release();
        await page.waitForTimeout(12000);
        await page
            .waitForFunction(() => !window.NEXUS_WARDROBE.service.controller.pending, null, { timeout: 120000 })
            .catch(() => {});
        const s4 = await state('04-stale');
        report.steps.push(s4);
        await page.unroute(lookPath(second));
        const late = s4.loads.slice(s3.loads.length).filter((url) => lookOf(s4, url) === second.id);
        if (late.length)
            fail('Stale request handling', `the superseded look reached the renderer (${late.length} loads)`);
        if (!s4.activeLook || s4.activeLook.id !== first.id)
            fail('Stale request handling', `she wears ${JSON.stringify(s4.activeLook)}`);
        if (s4.loadedSha256 !== first.sha256)
            fail('Stale request handling', 'what is on stage is not the look she had on');
        if (s4.world !== destination) fail('Stale request handling', 'the place changed');
        ok('Stale request handling');
        await shoot('04-stale-request-kept-jeans');
    }

    // ---- 5. The session ends while a look is on its way ------------------------------------------------
    {
        let release;
        const held = new Promise((r) => (release = r));
        await page.route(lookPath(second), async (route) => {
            await held;
            await route.continue().catch(() => {});
        });
        const before = await state('05-before');
        await say(SAY.sundress);
        const pending = await page
            .waitForFunction(() => window.NEXUS_WARDROBE.service.controller.pending, null, { timeout: 30000 })
            .then(() => true)
            .catch(() => false);
        report.cancelPendingSeen = pending;
        await page.evaluate(() => window.NEXUS_BD.intimate.stop('user'));
        await page.waitForTimeout(1500);
        release();
        await page
            .waitForFunction(
                (file) => {
                    const m = window.NEXUS_VIEWER.avatarManager;
                    const c = window.NEXUS_WARDROBE.service.controller;
                    const current = m.getCurrent ? m.getCurrent() : m.current;
                    return !c.activeLook && !c.pending && current && String(current.url).split('?')[0].endsWith(file);
                },
                AVATAR.file,
                { timeout: 240000 }
            )
            .catch(() => fail('Session end restores her', 'her own file never came back'));
        await page.waitForTimeout(12000);
        const s5 = await state('05-ended');
        report.steps.push(s5);
        await page.unroute(lookPath(second));
        const late = s5.loads.slice(before.loads.length).filter((url) => lookOf(s5, url) === second.id);
        if (!pending) fail('Pending load cancelled', 'the look was not on its way when the session ended');
        if (late.length)
            fail('Pending load cancelled', `the cancelled look reached the renderer (${late.length} loads)`);
        ok('Pending load cancelled');
        if (s5.activeLook || s5.wornUrl) fail('Session end restores her', 'a look is still recorded');
        if (s5.loadedSha256 !== avatarSha) fail('Session end restores her', 'what is on stage is not her own file');
        if (!s5.rootInScene) fail('Session end restores her', 'she is not on stage');
        ok('Session end restores her');
        if (/^private-/.test(String(s5.world || '')) || s5.world === destination)
            fail('Place handed back', `the renderer still shows ${s5.world}`);
        ok('Place handed back');
        await shoot('05-session-ended-original');
    }
    if (report.steps.some((s) => s.overflowX > 1)) fail('Layout', 'horizontal overflow');
    ok('Layout');
    if (report.errors.length) fail('No page errors', report.errors.slice(0, 2).join(' | '));
    ok('No page errors');
    await ctx.close();
} catch (e) {
    report.errors.push(`driver: ${e && e.stack ? e.stack.slice(0, 700) : e}`);
    fail('driver', String(e && e.message));
} finally {
    await browser.close();
    server.stop();
}
for (const step of report.steps) {
    step.loads = step.loads.length;
    step.verified = step.verified.length;
    step.travel = step.travel.filter((e) => e.kind === 'shown').map((e) => e.base || e.id);
}
report.passed = report.failures.length === 0;
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(
    JSON.stringify(
        { size, lang, passed: report.passed, checks: report.checks, failures: report.failures, out },
        null,
        2
    )
);
process.exit(report.passed ? 0 : 1);
