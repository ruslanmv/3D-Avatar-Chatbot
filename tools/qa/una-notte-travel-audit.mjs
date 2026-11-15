#!/usr/bin/env node
/**
 * UN4/M2. A two-place Private evening in the real renderer, judged by what the renderer says.
 *
 *   node tools/qa/una-notte-travel-audit.mjs [--size desktop|phone] [--lang it-IT|en-US] [--out dir]
 *
 * In one Private session (level unchanged — travel is not gated by the pace):
 *   1. the opening world is shown; the evening's outline names a destination this device can show;
 *   2. her reply carries `<go place="DEST"/>` (through PrivateActionBridge.consumeTravel, the seam the
 *      companion's reply chain uses): the tag is stripped, an offer is made, NOTHING moves;
 *   3. the person answers with something that is not a yes: the offer closes, still nothing moves;
 *   4. she invites again and the person says yes in their language: the trip starts, the world is
 *      requested through the Private channel (`nexus-world-request`, owner intimate);
 *   5. ARRIVED only when `nexus-world-shown` names the destination and the runtime's activeId is it;
 *      the story's phase follows the renderer, and her prompt says "you came here together";
 *   6. "Possiamo andare altrove?" from the person: an offer for the outline's destination or another
 *      place (never the room she is in), declined; then Fine — the session ends cleanly.
 * Screenshots: before, offer, travelling, arrived. Writes report.json + report.md; exit 1 on failure.
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
const lang = arg('--lang', 'it-IT');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/poses/runs', `${stamp}-travel-${size}-${lang}`)));
fs.mkdirSync(out, { recursive: true });
const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
const { playwright } = D.loadPlaywright();
const server = await D.ensureServer(arg('--url', 'http://127.0.0.1:8080').replace(/\/$/, ''));
const YES = lang.startsWith('it') ? 'Sì, andiamo' : "Yes, let's go";
const NOT_YES = lang.startsWith('it') ? 'Restiamo ancora un po’ qui' : "Let's stay here a little longer";
const ELSEWHERE = lang.startsWith('it') ? 'Possiamo andare altrove?' : 'Can we go somewhere else?';

const report = { size, lang, steps: [], failures: [], errors: [] };
const fail = (step, what) => report.failures.push(`${step}: ${what}`);
const browser = await playwright.chromium.launch({ args: D.SWIFTSHADER });
try {
    const ctx = await browser.newContext(
        size === 'phone'
            ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
            : { viewport: { width: 1440, height: 900 } }
    );
    await ctx.addInitScript((code) => {
        localStorage.setItem('app_lang', code);
        localStorage.setItem('nexus_together_enabled', 'on');
        localStorage.setItem('nexus_spicy_enabled', 'true');
        localStorage.setItem('nexus_spicy_verified', 'true');
        localStorage.setItem('npc_enabled', 'false');
    }, lang);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(String(e.message).slice(0, 240)));
    await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () =>
            window.NEXUS_BD?.togetherPanel?.activities?.get('intimate') &&
            window.NEXUS_VIEWER?.avatarManager?.currentRoot &&
            window.__NEXUS_COMPANION_LIVE,
        null,
        { timeout: 240000 }
    );
    await page.waitForTimeout(2500);
    // Record every world request and every renderer announcement, in order.
    await page.evaluate(() => {
        window.__travelLog = [];
        window.addEventListener('nexus-world-request', (e) =>
            window.__travelLog.push({ t: Date.now(), kind: 'request', ...(e.detail || {}) })
        );
        window.addEventListener('nexus-world-shown', (e) =>
            window.__travelLog.push({ t: Date.now(), kind: 'shown', ...(e.detail || {}) })
        );
    });
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
        .catch(() => fail('start', 'opening world not shown'));
    await page.waitForFunction(() => window.NEXUS_PRIVATE_ACTIONS.snapshot().story, null, { timeout: 30000 });
    await page.waitForTimeout(2000);
    const state = (label) =>
        page.evaluate((label) => {
            const snap = window.NEXUS_PRIVATE_ACTIONS.snapshot();
            const lines = window.NEXUS_PRIVATE_ACTIONS.promptLines().join('\n');
            return {
                label,
                shown: window.NEXUS_VIEWER.vrWorlds?.activeId || null,
                phase: snap.story && snap.story.phase,
                story: snap.story,
                offer: snap.offer || null,
                last: snap.last ? { name: snap.last.name, status: snap.last.status, why: snap.last.why } : null,
                chip: (document.querySelector('.nexus-private-offer, [data-private-offer]') || {}).textContent || null,
                saysArrived: /You came here together tonight/.test(lines),
                saysOnTheWay: /You are on your way to/.test(lines),
                log: window.__travelLog.slice(),
            };
        }, label);
    const shoot = (label) => page.screenshot({ path: path.join(out, `${size}-${label}.png`) });

    const s0 = await state('00-opening');
    report.steps.push(s0);
    const outline = await page.evaluate(() => {
        const s = window.NEXUS_PRIVATE_ACTIONS.snapshot();
        return { destination: s.story && s.story.storyId, places: null };
    });
    report.outline = outline;
    await shoot('00-opening');
    // The destination this evening's outline names (the bridge resolves "elsewhere" to it).
    const dest = await page.evaluate(() => {
        const lines = window.NEXUS_PRIVATE_ACTIONS.promptLines().join('\n');
        const m = /<go place="([a-z0-9-]+)"\/>/.exec(lines);
        return m ? m[1] : null;
    });
    report.destination = dest;
    if (!dest) fail('outline', 'her prompt offers no destination (canTravel false or no second place)');

    // 2. Her invitation: the tag is stripped and nothing moves.
    const shownBefore = s0.shown;
    const cleaned = await page.evaluate(
        (d) => window.NEXUS_PRIVATE_ACTIONS.consumeTravel(`Ti porto in un posto più tranquillo?\n<go place="${d}"/>`),
        dest || 'elsewhere'
    );
    await page.waitForTimeout(1500);
    const s1 = await state('01-invited');
    report.steps.push({ ...s1, cleaned });
    if (/<go/.test(cleaned)) fail('invite', 'the <go> tag reached her reply');
    if (!s1.offer || s1.offer.kind !== 'travel') fail('invite', 'no travel offer was made');
    if (s1.shown !== shownBefore) fail('invite', 'the world changed on an invitation');
    if (s1.log.some((e) => e.kind === 'request' && e.id === dest)) fail('invite', 'a world was requested before a yes');
    await shoot('01-invited');

    // 3. Not a yes: the offer closes, nothing moves.
    await page.evaluate((t) => window.NEXUS_CONVERSATION_SURFACE.renderUser(t), NOT_YES);
    await page.waitForTimeout(2000);
    const s2 = await state('02-declined');
    report.steps.push(s2);
    if (s2.offer) fail('decline', 'the offer stayed open after a non-yes');
    if (s2.shown !== shownBefore) fail('decline', 'the world changed after a non-yes');

    // 4. Invited again, and yes.
    await page.evaluate(
        (d) => window.NEXUS_PRIVATE_ACTIONS.consumeTravel(`Allora vieni con me.\n<go place="${d}"/>`),
        dest || 'elsewhere'
    );
    await page.waitForTimeout(1000);
    const t0 = Date.now();
    await page.evaluate((t) => window.NEXUS_CONVERSATION_SURFACE.renderUser(t), YES);
    await page.waitForTimeout(800);
    const s3 = await state('03-travelling');
    report.steps.push(s3);
    if (!['travelling', 'arrived'].includes(s3.phase)) fail('yes', `phase is ${s3.phase} after yes`);
    if (s3.phase === 'travelling' && !s3.saysOnTheWay) fail('yes', 'her prompt does not say she is on her way');
    if (!s3.log.some((e) => e.kind === 'request' && e.id === dest && e.owner === 'intimate'))
        fail('yes', 'no nexus-world-request for the destination through the Private channel');
    await shoot('03-travelling');

    // 5. Arrived only on the renderer's word.
    await page
        .waitForFunction((d) => window.NEXUS_VIEWER.vrWorlds?.activeId === d, dest, { timeout: 120000 })
        .catch(() => fail('arrive', 'the renderer never showed the destination'));
    await page.waitForTimeout(2500);
    const s4 = await state('04-arrived');
    s4.travelSeconds = Math.round((Date.now() - t0) / 100) / 10;
    report.steps.push(s4);
    const shownAt = s4.log.find((e) => e.kind === 'shown' && (e.base === dest || e.id === dest));
    if (!shownAt) fail('arrive', 'no nexus-world-shown for the destination');
    if (s4.phase !== 'arrived') fail('arrive', `story phase is ${s4.phase}, not arrived`);
    if (!s4.saysArrived) fail('arrive', 'her prompt does not say you came here together');
    if (s4.last && s4.last.name === 'world.travel' && s4.last.status !== 'completed')
        fail('arrive', `travel action is ${s4.last.status}`);
    await shoot('04-arrived');

    // 6. "Somewhere else?" from the person: an offer, never the room she is in; declined.
    await page.evaluate((t) => window.NEXUS_CONVERSATION_SURFACE.renderUser(t), ELSEWHERE);
    await page.waitForTimeout(2000);
    const s5 = await state('05-elsewhere');
    report.steps.push(s5);
    if (s5.offer && s5.offer.world === s5.shown) fail('elsewhere', 'offered the room she is already in');
    if (s5.shown !== dest) fail('elsewhere', 'the world moved without a yes');
    await page.evaluate((t) => window.NEXUS_CONVERSATION_SURFACE.renderUser(t), NOT_YES);
    await page.waitForTimeout(1500);
    report.steps.push(await state('06-stayed'));

    await page.evaluate(() => window.NEXUS_BD.intimate.stop('user'));
    await page.waitForTimeout(3000);
    report.end = await page.evaluate(() => ({ active: window.NEXUS_PRIVATE_ACTIONS.active() }));
    if (report.end.active) fail('end', 'the bridge is still active after Fine');
    await ctx.close();
} catch (e) {
    report.crash = String(e && e.stack ? e.stack : e).slice(0, 1200);
    fail('audit', 'crashed');
} finally {
    for (const s of report.steps) delete s.log;
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
    const md = [
        `# Una Notte travel audit — ${size}, ${lang}`,
        '',
        `Destination from the outline: \`${report.destination}\`. ${report.failures.length} failed checks, ${report.errors.length} page errors.`,
        '',
        '| step | world shown | phase | offer | last action | prompt |',
        '| --- | --- | --- | --- | --- | --- |',
        ...report.steps.map(
            (s) =>
                `| ${s.label} | ${s.shown} | ${s.phase} | ${s.offer ? s.offer.kind + ' → ' + (s.offer.name || s.offer.world) : ''} | ${s.last ? `${s.last.name} ${s.last.status}${s.last.why ? ' / ' + s.last.why : ''}` : ''} | ${s.saysArrived ? 'came here together' : s.saysOnTheWay ? 'on the way' : ''}${s.travelSeconds ? ` (${s.travelSeconds} s)` : ''} |`
        ),
        '',
        ...(report.failures.length ? ['## Failed checks', '', ...report.failures.map((f) => `- ${f}`)] : []),
    ];
    fs.writeFileSync(path.join(out, 'report.md'), md.join('\n') + '\n');
    process.stdout.write(`${path.relative(ROOT, out)}: ${report.failures.length} failed checks\n`);
    await browser.close();
    server.stop();
    process.exitCode = report.failures.length ? 1 : 0;
}
