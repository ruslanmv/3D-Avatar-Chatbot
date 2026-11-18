#!/usr/bin/env node
/**
 * SG4. Gesture audit: every co-speech gesture, in the real renderer, as a person would see it.
 *
 *   node audits/gestures/run.mjs                      # AvatarSample_A
 *   node audits/gestures/run.mjs --avatars AvatarSample_A,Vita
 *   npm run audit:gestures
 *
 * The unit tests prove the planner's rules (which word gets which gesture, the per-device
 * budgets, that the additive layer never accumulates). They cannot prove that a hand reaches her
 * chin rather than her ear, or that a wave is visible on a character whose arms are shorter. That
 * needs the app's own renderer and a person looking at frames — the same lesson the motion audit
 * learned when hips height passed a sideways tilt.
 *
 * So for each gesture this makes her speak its trigger sentence through `NEXUS_LIP_SYNC.start` —
 * the one call desktop chat, VR chat and BehaviorEngine all make, so it is the path a real reply
 * takes — and records, per avatar:
 *
 *   - which gesture the planner chose for that sentence, and on which hand;
 *   - three frames: before she speaks, at the gesture's peak, and after it has returned;
 *   - how far each hand moved at the peak (cm), how close it came to her chest and head, and
 *     how far from rest it ended (cm) — a layer that does not hand the bones back drifts.
 *
 * And one "conversation" row: a longer reply carrying several gestures, captured every half second,
 * to judge the rhythm (strokes landing on words, hands resting between them).
 *
 * Verdicts (numbers first, frames to confirm):
 *   ok    the gesting hand moved at least MIN_MOVE_CM and returned within RETURN_CM
 *   warn  it moved, but less than MIN_MOVE_CM (too subtle to read), or came within TOO_CLOSE_CM
 *         of her chest centre (check the frame: a hand on the chest is meant to, a hand inside her
 *         is not)
 *   fail  the planner chose nothing, the hand did not move, or it did not return to rest
 *
 * Output: audits/gestures/runs/<stamp>/ — report.md, report.json, index.html (every frame) and
 * shots/. Runs are not committed (audits/gestures/.gitignore). Exit 0 when nothing fails.
 * This is a QA tool: nothing in the app loads it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const arg = (f, d) => (argv.includes(f) && argv[argv.indexOf(f) + 1] ? argv[argv.indexOf(f) + 1] : d);
const AVATARS = arg('--avatars', 'AvatarSample_A')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const MIN_MOVE_CM = 5;
const RETURN_CM = 3;
const TOO_CLOSE_CM = 6;

/**
 * Where the hand must end up for the gesture to read as itself. "It moved" is not enough: the
 * first run of this audit passed a "hand to chin" whose hand stopped in front of her stomach.
 * Distances are from her own bones, so they hold for any avatar height.
 */
const TARGETS = {
    wave: {
        what: 'hand above her shoulder',
        check: (p) => p.handAboveShoulderCm >= 5,
        value: (p) => p.handAboveShoulderCm,
    },
    chinTouch: {
        what: 'hand within 22 cm of her head',
        check: (p) => p.handToHeadCm <= 22,
        value: (p) => p.handToHeadCm,
    },
    hairTuck: {
        what: 'hand within 20 cm of her head',
        check: (p) => p.handToHeadCm <= 20,
        value: (p) => p.handToHeadCm,
    },
    handOnChest: {
        what: 'hand within 15 cm of her chest',
        check: (p) => p.handToChestCm <= 15,
        value: (p) => p.handToChestCm,
    },
};

/** One sentence per gesture, chosen so the planner's first pick is that gesture. */
const CASES = [
    ['beat', 'The weather turned cold this afternoon.'],
    ['wave', 'Hi.'],
    ['palmToYou', 'You.'],
    ['handOnChest', 'Honestly.'],
    ['chinTouch', 'Hmm.'],
    ['shrug', 'Maybe.'],
    ['openArms', 'Everything.'],
    ['negate', 'No.'],
    ['hairTuck', 'Sorry.'],
    ['palmsUp', 'Ok?'],
];
const CONVERSATION =
    'Hi there! Honestly, I think today was lovely. Maybe we could walk by the sea later? ' +
    'You always find the best places, and everything feels calmer with you.';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(HERE, 'runs', stamp);
const SHOTS = path.join(OUT, 'shots');

/** Installed in the page: framing, hand measurement and a gesture start that mirrors real speech. */
function pageHelpers() {
    const V = () => window.NEXUS_VIEWER;
    const vrm = () => V().avatarManager._currentVRM;
    const T = () => window.THREE;
    const local = (bone) => {
        const node = vrm().humanoid.getRawBoneNode(bone);
        if (!node) return null;
        return vrm().scene.worldToLocal(node.getWorldPosition(new (T().Vector3)()));
    };
    window.__ga = {
        frame() {
            // Waist up, from her front and a little to one side: both hands and her face in view.
            // Her facing comes from her hips, as the motion audit frames her: VRM 0.x and 1.0 face
            // opposite ways in their own frames, so a fixed axis frames half the library from behind.
            const v = V();
            const W = (bone) => vrm().humanoid.getRawBoneNode(bone).getWorldPosition(new (T().Vector3)());
            const p = v.avatarManager.currentRoot.getWorldPosition(new (T().Vector3)());
            const right = W('rightUpperLeg').sub(W('leftUpperLeg'));
            right.y = 0;
            right.normalize();
            const fwd = new (T().Vector3)(0, 1, 0).cross(right).normalize();
            const dir = fwd.clone().multiplyScalar(0.92).add(right.clone().multiplyScalar(-0.38)).normalize();
            const chestY = (W('head').y + W('hips').y) / 2;
            v.camera.position.set(p.x + dir.x * 1.9, chestY + 0.08, p.z + dir.z * 1.9);
            v.controls.target.set(p.x, chestY, p.z);
            v.controls.update();
        },
        hands() {
            const r = local('rightHand');
            const l = local('leftHand');
            const c = local('chest') || local('spine');
            const h = local('head');
            const rs = local('rightShoulder') || local('rightUpperArm');
            const ls = local('leftShoulder') || local('leftUpperArm');
            return {
                rightAboveShoulderCm: (r.y - rs.y) * 100,
                leftAboveShoulderCm: (l.y - ls.y) * 100,
                right: [r.x, r.y, r.z],
                left: [l.x, l.y, l.z],
                rightToChestCm: r.distanceTo(c) * 100,
                leftToChestCm: l.distanceTo(c) * 100,
                rightToHeadCm: r.distanceTo(h) * 100,
                leftToHeadCm: l.distanceTo(h) * 100,
            };
        },
        quiet() {
            try {
                window.NEXUS_LIP_SYNC.stop();
            } catch (_) {
                /* nothing was speaking */
            }
            window.NEXUS_PROCEDURAL_ANIMATOR.setMode('talk', 60000);
        },
        speak(text) {
            window.NEXUS_PROCEDURAL_ANIMATOR.setMode('talk', 60000);
            window.__ga.t0 = performance.now() / 1000;
            window.NEXUS_LIP_SYNC.start(text, 1);
            const plan = window.NEXUS_SPEECH_GESTURES.plan(text);
            return plan.map((g) => ({
                ...g,
                prep: window.NEXUS_SPEECH_GESTURES.GESTURES[g.id].prep,
                hold: window.NEXUS_SPEECH_GESTURES.GESTURES[g.id].hold,
                duration: window.NEXUS_SPEECH_GESTURES.duration(g.id),
            }));
        },
        // Hold the gesture still at `offsetSec` into the reply: under software rendering a few frames
        // a second miss a 0.2 s stroke, so the frame and the numbers are taken from a held pose.
        // sample() takes an explicit time; nothing in the app is changed, only this page's call.
        freeze(offsetSec) {
            const SG = window.NEXUS_SPEECH_GESTURES;
            if (!window.__ga.orig) window.__ga.orig = SG.sample;
            const at = window.__ga.t0 + offsetSec;
            SG.sample = () => window.__ga.orig.call(SG, at);
        },
        thaw() {
            if (window.__ga.orig) window.NEXUS_SPEECH_GESTURES.sample = window.__ga.orig;
            window.__ga.orig = null;
        },
        budgets(text) {
            const SG = window.NEXUS_SPEECH_GESTURES;
            return Object.fromEntries(
                ['desktop', 'mobile', 'vr'].map((p) => [p, SG.plan(text, { profile: p }).length])
            );
        },
    };
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;

async function shot(page, file) {
    // Cropped to the 3D view: the full page is mostly chat panel, and a gesture is a few
    // centimetres of hand that a full-page frame shrinks to a pixel or two.
    const box = await page
        .locator('.avatar-viewport canvas')
        .first()
        .boundingBox()
        .catch(() => null);
    const clip = box && box.width > 50 ? box : undefined;
    await page.screenshot({ path: path.join(SHOTS, file), type: 'jpeg', quality: 72, clip });
    return 'shots/' + file;
}

async function auditAvatar(D, browser, base, avatar) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.setDefaultTimeout(180000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await D.waitForApp(page, 180000);
    await page.waitForFunction(
        () =>
            window.NEXUS_SPEECH_GESTURES &&
            window.NEXUS_LIP_SYNC &&
            window.NEXUS_PROCEDURAL_ANIMATOR &&
            window.NEXUS_VIEWER?.avatarManager?._currentVRM
    );
    if (avatar !== 'AvatarSample_A') {
        await page.evaluate((u) => window.NEXUS_VIEWER.loadAvatar(u), `/vendor/avatars/${avatar}.vrm`);
        await page.waitForFunction(
            (f) =>
                (window.NEXUS_VIEWER.avatarManager.currentRoot?.name || '').endsWith(f) &&
                window.NEXUS_VIEWER.avatarManager._currentVRM,
            `${avatar}.vrm`
        );
    }
    await page.waitForTimeout(2500);
    await page.evaluate(pageHelpers);
    await page.evaluate(() => window.__ga.frame());
    const rows = [];
    let n = 0;

    for (const [expect, text] of CASES) {
        n += 1;
        const tag = `${avatar}-${String(n).padStart(2, '0')}-${expect}`;
        await page.evaluate(() => window.__ga.quiet());
        await page.waitForTimeout(1500);
        const rest = await page.evaluate(() => window.__ga.hands());
        const before = await shot(page, `${tag}-0-before.jpg`);
        const plan = await page.evaluate((t) => window.__ga.speak(t), text);
        const first = plan[0] || null;
        let peak = null;
        let target = null;
        let peakFrame = null;
        let maxMove = 0;
        let minChest = Infinity;
        if (first) {
            await page.evaluate((t) => window.__ga.freeze(t), first.at + first.prep + first.hold / 2);
            await page.waitForTimeout(1200); // several rendered frames of the held peak
            peak = await page.evaluate(() => window.__ga.hands());
            const right = dist(peak.right, rest.right);
            const left = dist(peak.left, rest.left);
            maxMove = first.side === 'left' ? left : first.side === 'both' ? Math.max(right, left) : right;
            minChest =
                first.side === 'left'
                    ? peak.leftToChestCm
                    : Math.min(peak.rightToChestCm, first.side === 'both' ? peak.leftToChestCm : Infinity);
            peakFrame = await shot(page, `${tag}-1-peak.jpg`);
            await page.evaluate(() => window.__ga.thaw());
            const onLeft = first.side === 'left';
            const at = {
                handAboveShoulderCm: onLeft ? peak.leftAboveShoulderCm : peak.rightAboveShoulderCm,
                handToHeadCm: onLeft ? peak.leftToHeadCm : peak.rightToHeadCm,
                handToChestCm: onLeft ? peak.leftToChestCm : peak.rightToChestCm,
            };
            const goal = TARGETS[first.id];
            target = goal ? { what: goal.what, reached: goal.check(at), measuredCm: +goal.value(at).toFixed(1) } : null;
        }
        await page.evaluate(() => window.NEXUS_LIP_SYNC.stop());
        await page.waitForTimeout(1200);
        const after = await page.evaluate(() => window.__ga.hands());
        const afterShot = await shot(page, `${tag}-2-after.jpg`);
        const returned = Math.max(dist(after.right, rest.right), dist(after.left, rest.left));
        let verdict = 'ok';
        const flags = [];
        if (!first) flags.push('nothing-planned');
        else if (first.id !== expect) flags.push(`planned-${first.id}`);
        if (first && maxMove < 2) flags.push('no-visible-motion');
        else if (first && maxMove < MIN_MOVE_CM) flags.push('subtle');
        if (returned > RETURN_CM) flags.push('did-not-return');
        if (first && minChest < TOO_CLOSE_CM && first.id !== 'handOnChest') flags.push('close-to-chest');
        if (target && !target.reached) flags.push('missed-target');
        if (flags.some((f) => ['nothing-planned', 'no-visible-motion', 'did-not-return', 'missed-target'].includes(f)))
            verdict = 'fail';
        else if (flags.length) verdict = 'warn';
        rows.push({
            avatar,
            gesture: expect,
            text,
            planned: plan.map((g) => `${g.id}:${g.side}`),
            verdict,
            flags,
            handMoveCm: +maxMove.toFixed(1),
            closestToChestCm: Number.isFinite(minChest) ? +minChest.toFixed(1) : null,
            peakHandToHeadCm: peak ? +Math.min(peak.rightToHeadCm, peak.leftToHeadCm).toFixed(1) : null,
            returnedWithinCm: +returned.toFixed(2),
            target,
            shots: [before, peakFrame, afterShot].filter(Boolean),
        });
        console.log(
            `${verdict.padEnd(4)} ${avatar} ${expect.padEnd(12)} moved ${maxMove.toFixed(1)} cm ${flags.join(',')}`
        );
    }

    // The conversation strip: rhythm across a whole reply.
    await page.evaluate(() => window.__ga.quiet());
    await page.waitForTimeout(1500);
    const plan = await page.evaluate((t) => window.__ga.speak(t), CONVERSATION);
    const budgets = await page.evaluate((t) => window.__ga.budgets(t), CONVERSATION);
    const strip = [];
    const t0 = Date.now();
    const total = (CONVERSATION.length / 15 + 1) * 1000;
    for (let i = 0; Date.now() - t0 < total && i < 24; i += 1) {
        strip.push({
            t: +((Date.now() - t0) / 1000).toFixed(1),
            shot: await shot(page, `${avatar}-conv-${String(i).padStart(2, '0')}.jpg`),
        });
        const wait = (i + 1) * 500 - (Date.now() - t0);
        if (wait > 0) await page.waitForTimeout(wait);
    }
    await page.evaluate(() => window.NEXUS_LIP_SYNC.stop());
    await page.context().close();
    return {
        avatar,
        errors,
        rows,
        conversation: {
            text: CONVERSATION,
            planned: plan.map((g) => ({ at: +g.at.toFixed(2), id: g.id, side: g.side })),
            budgets,
            strip,
        },
    };
}

function writeReport(report) {
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
    const md = [
        `# Gesture audit ${stamp}`,
        '',
        `${report.ok ? 'PASS' : 'FAIL'} — ${report.summary.ok} ok · ${report.summary.warn} warn · ${report.summary.fail} fail`,
        '',
        `Verdicts: ok = moved ≥ ${MIN_MOVE_CM} cm, reached its target where it has one, and back within ${RETURN_CM} cm. Look at index.html before trusting a number.`,
        '',
    ];
    for (const a of report.avatars) {
        md.push(
            `## ${a.avatar}`,
            '',
            a.errors.length ? `Page errors: ${a.errors.join(' | ')}` : 'Page errors: none',
            ''
        );
        md.push(
            '| gesture | sentence | planned | verdict | moved (cm) | target | closest to chest (cm) | hand to head at peak (cm) | back within (cm) | flags |'
        );
        md.push('|---|---|---|---|---|---|---|---|---|---|');
        for (const r of a.rows) {
            md.push(
                `| ${r.gesture} | ${r.text} | ${r.planned.join(' ') || '—'} | **${r.verdict}** | ${r.handMoveCm} | ${r.target ? `${r.target.what}: ${r.target.reached ? 'yes' : 'NO'} (${r.target.measuredCm})` : '—'} | ${r.closestToChestCm ?? '—'} | ${r.peakHandToHeadCm ?? '—'} | ${r.returnedWithinCm} | ${r.flags.join(', ') || '—'} |`
            );
        }
        const c = a.conversation;
        md.push(
            '',
            `**Conversation:** "${c.text}"`,
            '',
            `Planned (desktop): ${c.planned.map((g) => `${g.at}s ${g.id}`).join(', ')}`,
            '',
            `Gestures in this reply by device: desktop ${c.budgets.desktop}, phone ${c.budgets.mobile}, VR ${c.budgets.vr}.`,
            ''
        );
    }
    fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n') + '\n');
    const img = (s, label) => `<figure><img src="${s}" loading="lazy"><figcaption>${label}</figcaption></figure>`;
    const html = [
        '<!doctype html><meta charset="utf-8"><title>Gesture audit</title>',
        '<style>body{font:14px system-ui;background:#151317;color:#eee;margin:16px}figure{display:inline-block;margin:4px}img{width:200px;display:block;border-radius:6px}.ok{color:#8fd6a0}.warn{color:#e8c46e}.fail{color:#ef8b80}h3{margin:18px 0 4px}</style>',
        `<h1>Gesture audit ${stamp}</h1>`,
    ];
    for (const a of report.avatars) {
        html.push(`<h2>${a.avatar}</h2>`);
        for (const r of a.rows) {
            html.push(
                `<h3 class="${r.verdict}">${r.gesture} — ${r.verdict} · moved ${r.handMoveCm} cm · ${r.flags.join(', ') || 'no flags'}</h3><div>"${r.text}" → ${r.planned.join(' ') || 'nothing planned'}</div>`
            );
            html.push(r.shots.map((s, i) => img(s, ['before', 'peak', 'after'][i])).join(''));
        }
        html.push(`<h3>Conversation</h3><div>"${a.conversation.text}"</div>`);
        html.push(a.conversation.strip.map((s) => img(s.shot, s.t + ' s')).join(''));
    }
    fs.writeFileSync(path.join(OUT, 'index.html'), html.join('\n'));
}

async function main() {
    fs.mkdirSync(SHOTS, { recursive: true });
    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const { playwright, why } = D.loadPlaywright();
    if (!playwright) {
        console.error(why);
        process.exit(2);
    }
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:8080');
    const browser = await playwright.chromium.launch({ args: D.SWIFTSHADER });
    const report = { stamp, avatars: [] };
    try {
        for (const a of AVATARS) report.avatars.push(await auditAvatar(D, browser, server.base, a));
    } finally {
        await browser.close();
        if (server.stop) server.stop();
    }
    const rows = report.avatars.flatMap((a) => a.rows);
    report.summary = {
        ok: rows.filter((r) => r.verdict === 'ok').length,
        warn: rows.filter((r) => r.verdict === 'warn').length,
        fail: rows.filter((r) => r.verdict === 'fail').length,
    };
    report.ok = report.summary.fail === 0 && report.avatars.every((a) => !a.errors.length);
    writeReport(report);
    fs.writeFileSync(path.join(HERE, 'runs', 'LATEST'), path.relative(HERE, OUT) + '\n');
    console.log(
        `\n${report.ok ? 'PASS' : 'FAIL'} — ${report.summary.ok} ok · ${report.summary.warn} warn · ${report.summary.fail} fail`
    );
    console.log(`report: ${path.relative(ROOT, path.join(OUT, 'report.md'))}`);
    process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
    console.error('gesture audit crashed:', e && e.stack ? e.stack : e);
    process.exit(2);
});
