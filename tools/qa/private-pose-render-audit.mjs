#!/usr/bin/env node
/**
 * UN6. Private positions on the real, clothed avatar — judged by what the renderer shows.
 *
 *   node tools/qa/private-pose-render-audit.mjs [--size desktop|phone] [--out dir] [--passes 2]
 *                                               [--url http://127.0.0.1:8080/]
 *
 * Drives the app the way the person does: the avatar the page loads itself (ViewerEngine's own
 * path), a Private evening in the cabaret, the composer's two listeners for every line (the
 * motion fast path first, then the conversation surface), Italian. The person's three "Più
 * vicino" presses are simulated by setting the ConsentFlow level to 4, as the screenshot
 * harness does; no gate is bypassed in the product.
 *
 * After every line it waits until the action has settled AND the pose system has stopped
 * moving her (blend, grounding, hand placement, release ease, cloth), then measures the raw
 * skeleton and the skinned surfaces (tools/qa/pose-render-probe.js) and shoots matching cameras.
 * Checks, per step:
 *   owner     vrPoseSystem.avatarRoot is the avatar on screen (a loader path that bypasses the
 *             viewer leaves the pose owner on another avatar)
 *   stand     after "alzati" / dressing again / the end: rendered hips within 4 cm of standing,
 *             trunk within 12° of vertical, soles on the plane, chat motion not sitting or lying
 *   expect    the per-pose rendered criteria below (trunk direction, height, supports)
 *
 * Heights are above the plane her standing soles rest on. An outfit change can move that plane
 * (shoes vs barefoot: −0.060 vs −0.001 m on AvatarSample_A), so contacts are read against the
 * plane the pose system grounded the current outfit on (`lastSupport.floor`) when it reports one.
 *
 * Writes audits/poses/runs/<stamp>-<size>/{report.json, report.md, *.png}. Exit 1 on a failed check.
 *   --rescore <report.json>  judge a saved run again with the current criteria (no browser)
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
};
const size = arg('--size', 'desktop');
const passes = Number(arg('--passes', '2'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/poses/runs', `${stamp}-${size}`)));

/** Rendered criteria. Heights are metres above the standing sole plane; angles in degrees. */
const EXPECT = {
    // Shins flat: the skin nearest the knee joint is the side of the knee, ~7 cm up; the shins
    // and insteps are what rest on the floor.
    kneeling: (m) =>
        m.kneeSurfY.every((y) => y >= -0.01 && y <= 0.1) &&
        m.footSurfY.every((y) => y >= -0.01 && y <= 0.06) &&
        m.trunk.tilt <= 20 &&
        m.hipsY <= 0.6,
    // On her stomach the chest is lifted on the forearms: the trunk is ~62° from vertical.
    lyingFront: (m) => m.trunk.tilt >= 55 && m.hipsY <= 0.3 && m.kneeSurfY.every((y) => y <= 0.08),
    lyingBack: (m) => m.trunk.tilt >= 70 && m.hipsY <= 0.3,
    lyingSide: (m) => m.trunk.tilt >= 70 && m.hipsY <= 0.3,
    standingBendForward: (m) => m.trunk.fwd >= 40 && m.footSurfY.every((y) => Math.abs(y) <= 0.05),
    standingBentBackward: (m) => m.trunk.fwd <= -15 && m.footSurfY.every((y) => Math.abs(y) <= 0.05),
    handsKnees: (m) =>
        m.kneeSurfY.every((y) => y >= -0.01 && y <= 0.03) &&
        m.palmSkinY.every((y) => y >= -0.01 && y <= 0.02) &&
        m.fingersFwd.every((f) => Math.abs(f) >= 0.8) && // she may be turned to show her back
        m.palmDown.every((p) => p >= 0.5),
};
// Her idle sways and shifts weight: one heel can lift ~3-5 cm while she stands.
const STAND = (m, ref) =>
    Math.abs(m.hipsY - ref.hipsY) <= 0.04 &&
    m.trunk.tilt <= 12 &&
    Math.min(...m.footSurfY) <= 0.05 &&
    m.footSurfY.every((y) => y >= -0.03 && y <= 0.06) &&
    !m.motion.sitting &&
    !m.motion.laying;

/** Contacts against the current outfit's own sole plane, when the pose system reports it. */
function onOwnPlane(m, ref) {
    const floor = m.support && m.support.floor;
    const shift = Number.isFinite(floor) && ref && Number.isFinite(ref.sole) ? floor - ref.sole : 0;
    const sub = (list) => (list || []).map((y) => (y == null ? y : +(y - shift).toFixed(3)));
    return Object.assign({}, m, {
        palmSkinY: sub(m.palmSkinY),
        kneeSurfY: sub(m.kneeSurfY),
        footSurfY: sub(m.footSurfY),
        hipsY: +(m.hipsY - shift).toFixed(3),
    });
}

/** The per-step verdicts, shared by a live run and --rescore. */
function judge(report) {
    const failures = [];
    const fail = (step, what) => failures.push(`${step}: ${what}`);
    const steps = report.steps || [];
    const start = steps[0];
    if (!start) return ['audit: no steps'];
    // Standing height belongs to the outfit (barefoot stands ~6 cm lower than in shoes): each
    // outfit is judged against the first time it was seen standing free.
    const standing = new Map([[start.url, start.hipsY]]);
    let prev = start;
    for (const raw of steps.slice(1)) {
        const m = onOwnPlane(raw, report.ref);
        const label = m.label;
        const said = m.said || '';
        if (m.owner === false) fail(label, 'pose owner is not the displayed avatar');
        // A new root is expected only when the outfit changed (re-dressing reloads the same URL).
        const outfitStep = /spogliati|rivestiti/i.test(said) || m.url !== prev.url;
        if (m.rootUuid !== prev.rootUuid && !outfitStep) fail(label, 'avatar root changed without an outfit change');
        const standStep = /^alzati/i.test(said) || /rivestiti/i.test(said) || label === 'fine';
        if (!m.held && !standing.has(m.url) && m.trunk && m.trunk.tilt <= 12) standing.set(m.url, m.hipsY);
        const standRef = { hipsY: standing.has(m.url) ? standing.get(m.url) : m.hipsY };
        if (standStep && m.last && m.last.status === 'completed' && !STAND(m, standRef))
            fail(
                label,
                `not standing: ${JSON.stringify({ hipsY: m.hipsY, trunk: m.trunk, soles: m.footSurfY, motion: m.motion })}`
            );
        if (label === 'fine' && (!STAND(m, standRef) || m.held)) fail(label, 'not released and standing after the end');
        const check = EXPECT[m.preset];
        const palmsKnown = report.palmMetric === 'thumb';
        const view = palmsKnown ? m : Object.assign({}, m, { palmDown: [1, 1] });
        if (m.held && check && !check(view))
            fail(
                label,
                `${m.preset} not rendered as expected: ${JSON.stringify({ hipsY: m.hipsY, trunk: m.trunk, palms: m.palmSkinY, knees: m.kneeSurfY, soles: m.footSurfY, fingers: m.fingersFwd, palmDown: m.palmDown })}`
            );
        if (m.last && m.last.status === 'completed' && m.last.name === 'avatar.pose' && m.held === false && !standStep)
            fail(label, 'reported a position completed while nothing holds her');
        prev = raw;
    }
    return failures;
}

function writeReport(out, report) {
    const lines = [
        `# Private pose render audit — ${report.size}`,
        '',
        `${report.steps.length} steps, ${report.failures.length} failed checks, ${(report.errors || []).length} page errors.`,
        '',
        '| step | said | status | preset | hips m | trunk tilt/fwd | palms m | knees m | soles m | outfit |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...report.steps.map(
            (s) =>
                `| ${s.label} | ${s.said || ''} | ${s.last ? s.last.status + (s.last.why ? ' / ' + s.last.why : '') : ''} | ${s.preset}${s.held ? '' : ' (free)'} | ${s.hipsY} | ${s.trunk ? s.trunk.tilt + ' / ' + s.trunk.fwd : ''} | ${(s.palmSkinY || []).join(', ')} | ${(s.kneeSurfY || []).join(', ')} | ${(s.footSurfY || []).join(', ')} | ${s.outfit} |`
        ),
        '',
        ...(report.failures.length ? ['## Failed checks', '', ...report.failures.map((f) => `- ${f}`)] : []),
    ];
    fs.writeFileSync(path.join(out, 'report.md'), lines.join('\n') + '\n');
}

if (process.argv.includes('--rescore')) {
    const file = path.resolve(arg('--rescore'));
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    report.failures = judge(report);
    report.rescoredAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(report, null, 1));
    writeReport(path.dirname(file), report);
    process.stdout.write(`${file}: ${report.failures.length} failed checks\n`);
    for (const f of report.failures) process.stdout.write(`  ${f.slice(0, 220)}\n`);
    process.exit(report.failures.length ? 1 : 0);
}

// Inside a world, side cameras at 4.4 m can land behind its walls; front, three-quarter and top
// stay in the room. The measurements never depend on what a camera sees.
const FULL = 'front,back,left,right,q3';
const POSE_SEQUENCE = [
    ['inginocchiati', 'Inginocchiati', 'front,left'],
    ['girati', 'Girati', 'front'],
    ['girati-ancora', 'Girati', 'front'],
    ['alzati-da-ginocchio', 'Alzati', 'left', 'stand'],
    ['sulla-pancia', 'Sdraiati sulla pancia', 'front,left'],
    ['alzati-da-pancia', 'Alzati', 'left', 'stand'],
    ['sulla-schiena', 'Sdraiati sulla schiena', 'front,left'],
    ['alzati-da-schiena', 'Alzati', 'left', 'stand'],
    ['sul-fianco', 'Sdraiati sul fianco', `${FULL},top`],
    ['alzati-da-fianco', 'Alzati', 'left', 'stand'],
    ['piegati', 'Piegati in avanti', FULL],
    ['inarca', 'Inarca la schiena', FULL],
    ['come-prima', 'Torna come prima', 'left'],
    ['alzati-da-piegata', 'Alzati', 'left', 'stand'],
    ['quattro-zampe', 'Mettiti a quattro zampe', `${FULL},top,hands`],
    ['girati-carponi', 'Girati', 'front,left'],
    ['girati-carponi-2', 'Girati', 'front'],
    ['spogliati-carponi', 'Spogliati', 'front,left,hands'],
    ['quattro-zampe-ancora', 'Mettiti a quattro zampe', 'left'],
    ['alzati-da-carponi', 'Alzati', 'front,left', 'stand'],
    ['inginocchiati-svestita', 'Inginocchiati', 'front'],
    ['rivestiti', 'Ho finito, rivestiti', 'front,left', 'stand'],
];

fs.mkdirSync(out, { recursive: true });
const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
const { playwright } = D.loadPlaywright();
const server = await D.ensureServer(arg('--url', 'http://127.0.0.1:8080').replace(/\/$/, ''));
const SEQUENCE = process.argv.includes('--quick')
    ? POSE_SEQUENCE.filter(([name]) =>
          [
              'inginocchiati',
              'alzati-da-ginocchio',
              'sul-fianco',
              'piegati',
              'inarca',
              'quattro-zampe',
              'spogliati-carponi',
              'alzati-da-carponi',
              'rivestiti',
          ].includes(name)
      ).map(([a, b, , d]) => [a, b, 'front,q3', d])
    : POSE_SEQUENCE;
const browser = await playwright.chromium.launch({ args: D.SWIFTSHADER });
const report = {
    size,
    passes,
    palmMetric: 'thumb',
    startedAt: new Date().toISOString(),
    steps: [],
    failures: [],
    errors: [],
};
const fail = (step, what) => report.failures.push(`${step}: ${what}`);
try {
    const ctx = await browser.newContext(
        size === 'phone'
            ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
            : { viewport: { width: 1440, height: 900 } }
    );
    await ctx.addInitScript(() => {
        localStorage.setItem('app_lang', 'it-IT');
        localStorage.setItem('nexus_together_enabled', 'on');
        localStorage.setItem('nexus_spicy_enabled', 'true');
        localStorage.setItem('nexus_spicy_verified', 'true');
        localStorage.setItem('npc_enabled', 'false');
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(String(e.message).slice(0, 240)));
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
    await page.addScriptTag({ path: path.join(ROOT, 'tools/qa/pose-render-probe.js') });

    const started = await page.evaluate(async () => {
        const panel = window.NEXUS_BD.togetherPanel;
        const a = panel.activities.get('intimate');
        if (a.setAtmosphere) a.setAtmosphere({ world: 'private-cabaret' });
        const opt = (panel.contractFor('intimate')?.inputs() || []).find((x) => x.id === 'romantic') || {
            id: 'romantic',
        };
        const r = await panel.startActivity('intimate', opt);
        return { ok: !!(r && r.ok), why: r && r.why };
    });
    report.started = started;
    await page
        .waitForFunction(() => /private-cabaret/.test(window.NEXUS_VIEWER.vrWorlds?.activeId || ''), null, {
            timeout: 120000,
        })
        .catch(() => fail('start', 'private-cabaret not shown'));
    await page.waitForTimeout(3000);
    report.level = await page.evaluate(() => (window.NEXUS_BD.adult.level = 4));
    report.ref =
        (await page.evaluate(() => window.__probe.loadThree()), await page.evaluate(() => window.__probe.standRef()));

    const settle = async () => {
        await page
            .waitForFunction(
                () => {
                    const l = window.NEXUS_PRIVATE_ACTIONS.snapshot().last;
                    const v = window.vrPoseSystem;
                    return (
                        (!l || l.status !== 'pending') && !(v.isSettling && v.isSettling()) && !(v._clothPending > 0)
                    );
                },
                null,
                { timeout: 60000, polling: 150 }
            )
            .catch(() => {});
        await page.waitForTimeout(1200);
    };
    const measure = () =>
        page.evaluate(() => {
            const m = window.__probe.measure().summary;
            const snap = window.NEXUS_PRIVATE_ACTIONS.snapshot();
            const v = window.vrPoseSystem;
            const am = window.NEXUS_VIEWER.avatarManager;
            return Object.assign(m, {
                owner: v.avatarRoot === am.currentRoot,
                yaw: +am.currentRoot.rotation.y.toFixed(2),
                motion: {
                    sitting: !!window.NEXUS_MOTION.state.sitting,
                    laying: !!window.NEXUS_MOTION.state.laying,
                },
                last: snap.last
                    ? { name: snap.last.name, status: snap.last.status, why: snap.last.why, result: snap.last.result }
                    : null,
                outfit: (am.current && am.current.url ? am.current.url : '').split('/').slice(-2).join('/'),
            });
        });
    const shoot = async (label, views) => {
        for (const v of views.split(',')) {
            await page.evaluate((v) => window.__probe.view(v), v);
            await page.waitForTimeout(450);
            // On a phone the whole screen is the view the person has; on desktop, the 3D panel.
            const file = path.join(out, `${size}-${label}-${v}.png`);
            if (size === 'phone') await page.screenshot({ path: file });
            else await page.locator('#avatar-viewport canvas, canvas').first().screenshot({ path: file });
        }
        await page.evaluate(() => window.__probe.view('reset'));
    };

    const start = await measure();
    report.steps.push({ label: '00-start', ...start });
    await shoot('00-start', 'front,left');
    let n = 1;
    for (let pass = 1; pass <= passes; pass++) {
        for (const [name, said, views, kind] of SEQUENCE) {
            const label = `${String(n++).padStart(2, '0')}-p${pass}-${name}`;
            await page.evaluate((text) => {
                try {
                    window.NEXUS_MOTION?.onUserUtterance?.(text);
                } catch (_) {
                    /* the fast path failing must not stop the audit */
                }
                window.NEXUS_CONVERSATION_SURFACE.renderUser(text);
            }, said);
            await settle();
            const m = await measure();
            report.steps.push({ label, said, ...m });
            process.stderr.write(
                `${label}: ${m.last && m.last.status}${m.last && m.last.why ? '/' + m.last.why : ''} preset=${m.preset} held=${m.held} hips=${m.hipsY} trunk=${JSON.stringify(m.trunk)} palms=${JSON.stringify(m.palmSkinY)} knees=${JSON.stringify(m.kneeSurfY)} soles=${JSON.stringify(m.footSurfY)} outfit=${m.outfit}\n`
            );
            await shoot(label, views);
        }
        if (pass < passes) {
            // Between passes: stand, then the next pass repeats every change in the same session.
            await page.evaluate(() => window.NEXUS_CONVERSATION_SURFACE.renderUser('Alzati'));
            await settle();
        }
    }
    await page.evaluate(() => window.NEXUS_BD.intimate.stop('user'));
    await page.waitForTimeout(3500);
    const end = await measure();
    report.steps.push({ label: 'fine', ...end });
    await shoot('99-fine', 'front,left');
    await ctx.close();
} catch (e) {
    report.crash = String(e && e.stack ? e.stack : e).slice(0, 1200);
    fail('audit', 'crashed');
} finally {
    report.finishedAt = new Date().toISOString();
    report.failures.push(...judge(report));
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
    writeReport(out, report);
    process.stdout.write(`${path.relative(ROOT, out)}: ${report.failures.length} failed checks\n`);
    await browser.close();
    server.stop();
    process.exitCode = report.failures.length ? 1 : 0;
}
