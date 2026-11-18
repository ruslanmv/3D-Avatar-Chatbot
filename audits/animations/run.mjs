#!/usr/bin/env node
/**
 * AN1. Animation review: every clip Pose Studio lists, stepped through frame by frame on each
 * avatar, shown as a sequence of frames and checked the way an animation review checks a clip.
 *
 *   npm run audit:animations                                  # every clip, AvatarSample_A
 *   node audits/animations/run.mjs --avatars AvatarSample_A,Vita,VRM_Viewer_Sample
 *   node audits/animations/run.mjs --category dance           # one category (vrma, dance, idle, …)
 *   node audits/animations/run.mjs --only Clapping,dance_1    # clips whose path contains these
 *   node audits/animations/run.mjs --frames 8                 # frames per sequence (default 6)
 *
 * The list is exactly Pose Studio's: NEXUS_CLIP_LOADER.getAllAnimations(), the source of its
 * "VRMA Animations" list and its "BVH Library" categories. Each clip starts the way the Play
 * button starts it (playClip(id, loop), procedural idle underneath).
 *
 * How it is measured. A clip is paused and stepped to exact times — every 0.1 s from start to
 * end, at most 100 steps — as a review tool scrubs a timeline, and each step is read off the
 * rendered skeleton after the app has drawn it, with everything else that moves her bones in
 * play. So a slow software renderer does not skip frames, two runs measure the same poses, and
 * the numbers describe what is on screen. Then a few frames at even steps through the clip are captured: one row per clip in the
 * contact sheet, read left to right.
 *
 * What is checked, on her own proportions:
 *   fail  not-played · NaN bones · floating · sinking · tipped-over · legs-flipped
 *         (tools/qa/MotionAuditScorer.js) · feet-through-floor · knee-reversed
 *   warn  foot-skate · hand-in-body · pop · loop-seam · travels · turns · no-visible-motion
 *         (tools/qa/ClipQualityScorer.js — the limits and why are in its header)
 * The category says what a clip is meant to be: sitting clips may lower her, idle clips should
 * stay in place and loop cleanly, a dance may travel.
 *
 * Output: audits/animations/runs/<stamp>/ — report.md (verdicts, flags, numbers), report.json,
 * index.html (the sequences, failing clips first), shots/ (git-ignored). Exit 0 when nothing
 * fails. A QA tool: the app never loads it. It changes nothing: a clip that fails is reported,
 * and quarantining it (MotionClipMap.QUARANTINE, develop/NEEDS_FIX.md) is a separate decision.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const arg = (f, d) => (argv.includes(f) && argv[argv.indexOf(f) + 1] ? argv[argv.indexOf(f) + 1] : d);
const AVATARS = arg('--avatars', 'AvatarSample_A').split(',').filter(Boolean);
const CATEGORY = arg('--category', '');
const ONLY = arg('--only', '').split(',').filter(Boolean);
const FRAMES = Math.max(2, Number(arg('--frames', 6)));
// Samples per clip: one every 0.1 s, at most 40 (each waits for a rendered frame).
const MAX_SAMPLES = 40;
const MAX_SECONDS = 20;

const load = (rel, name) => {
    const sandbox = { console, Math };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox);
    return sandbox[name];
};
const Motion = load('tools/qa/MotionAuditScorer.js', 'NEXUS_MOTION_AUDIT_SCORER');
const Quality = load('tools/qa/ClipQualityScorer.js', 'NEXUS_CLIP_QUALITY_SCORER');

// Reviewed exceptions: clips meant to jump, crawl, lie or kneel (see the file's purpose).
const INTENT = JSON.parse(fs.readFileSync(path.join(HERE, 'clip-intent.json'), 'utf8')).clips;
const intentOf = (id) => INTENT[String(id).replace(/^vendor\/animations\//, '')] || null;

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(HERE, 'runs', stamp);
const SHOTS = path.join(OUT, 'shots');

/** MotionAuditScorer's posture for a category. A dance is choreography: it may drop low, fold
 * forward or go to the floor on purpose, so it is judged like a bend — its hips and head may come
 * down — while floating, flipped legs and feet in the floor still fail it. */
const POSTURE = { sitting: 'sit', laying: 'lay', kneeling: 'low', action: 'low', exercise: 'low', dance: 'bend' };

/** In the page: step the playing clip to a time and read her skeleton. */
function installSampler() {
    const T = window.THREE;
    const BC = window.NEXUS_GESTURE_BODY_CHECK;
    const vrm = () => window.NEXUS_VIEWER.avatarManager._currentVRM;
    const W = (v, k) => {
        const n = v.humanoid.getRawBoneNode(k);
        if (!n) return null;
        const p = n.getWorldPosition(new T.Vector3());
        return [p.x, p.y, p.z];
    };
    const QB = [
        'hips',
        'spine',
        'chest',
        'neck',
        'head',
        'leftUpperArm',
        'rightUpperArm',
        'leftLowerArm',
        'rightLowerArm',
        'leftUpperLeg',
        'rightUpperLeg',
        'leftLowerLeg',
        'rightLowerLeg',
    ];
    const read = () => {
        const v = vrm();
        v.scene.updateMatrixWorld(true);
        const get = (k) => W(v, k);
        const lUL = get('leftUpperLeg');
        const rUL = get('rightUpperLeg');
        const r = [rUL[0] - lUL[0], 0, rUL[2] - lUL[2]];
        const rl = Math.hypot(r[0], r[2]) || 1;
        const fwd = [r[2] / rl, 0, -r[0] / rl];
        const hq = v.humanoid.getRawBoneNode('hips').getWorldQuaternion(new T.Quaternion());
        const hf = new T.Vector3(0, 0, 1).applyQuaternion(hq);
        let inside = 0;
        try {
            const P = (k) => {
                const p = get(k);
                return p && { x: p[0], y: p[1], z: p[2] };
            };
            const f = BC.frame({
                hips: P('hips'),
                leftUpperLeg: P('leftUpperLeg'),
                rightUpperLeg: P('rightUpperLeg'),
                leftUpperArm: P('leftUpperArm'),
                rightUpperArm: P('rightUpperArm'),
                chest: P('upperChest') || P('chest'),
                neck: P('neck'),
                head: P('head'),
            });
            for (const side of ['left', 'right']) {
                const m = BC.measure(f, side, { hand: P(side + 'Hand'), elbow: P(side + 'LowerArm') }, null);
                inside = Math.max(inside, m.handInside, m.forearmInside);
            }
        } catch (_) {
            inside = 0;
        }
        const quats = {};
        let finite = true;
        for (const k of QB) {
            const n = v.humanoid.getRawBoneNode(k);
            if (!n) continue;
            const q = n.quaternion;
            quats[k] = [q.x, q.y, q.z, q.w];
            if (!quats[k].every(Number.isFinite)) finite = false;
        }
        return {
            hips: get('hips'),
            head: get('head'),
            feet: [get('leftFoot'), get('rightFoot')],
            // The lowest point of each foot — ankle or toes — for the floor check: a foot lying
            // flat (kneeling, sitting) puts the ankle lower than standing without entering the floor.
            soles: ['left', 'right'].map((s) => {
                const ys = [get(s + 'Foot'), get(s + 'Toes')].filter(Boolean).map((p) => p[1]);
                return Math.min(...ys);
            }),
            legs: {
                left: { hip: lUL, knee: get('leftLowerLeg'), ankle: get('leftFoot') },
                right: { hip: rUL, knee: get('rightLowerLeg'), ankle: get('rightFoot') },
            },
            fwd,
            yawDeg: (Math.atan2(hf.x, hf.z) * 180) / Math.PI,
            inside,
            quats,
            finite,
        };
    };
    /**
     * Hold the clip at time t (seconds). The app's own frame loop then applies it with everything
     * else that writes her bones (three-vrm's normalized → raw copy, ProceduralAnimator, the
     * VRMA proxies) — so what is read two frames later is what is on screen, not what the clip
     * would do alone. Reading the clip in isolation measured poses the screen never showed.
     */
    const seek = (t) => {
        const a = window.NEXUS_CLIP_LOADER.getCurrentAction();
        a.paused = true;
        a.time = Math.min(t, a.getClip().duration);
    };
    const frames = (n) =>
        new Promise((res) => {
            const step = (k) => (k <= 0 ? res() : requestAnimationFrame(() => step(k - 1)));
            step(n);
        });
    window.__an = {
        standing: () => read(),
        async start(id) {
            const L = window.NEXUS_CLIP_LOADER;
            try {
                L.stopClip?.();
            } catch (_) {}
            let ok = false;
            try {
                // As Pose Studio's Play button (PoseStudioPanel wireClipPlayStop).
                ok = await L.playClip(id, true);
                window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.('idle', 1);
                window.NEXUS_PROCEDURAL_ANIMATOR?.setAllowWithMixer?.(true);
            } catch (e) {
                return { ok: false, why: String(e && e.message ? e.message : e).slice(0, 160) };
            }
            const a = L.getCurrentAction && L.getCurrentAction();
            if (!ok || !a) return { ok: false, why: 'the loader did not start it' };
            a.stopFading();
            a.setEffectiveWeight(1);
            return { ok: true, duration: a.getClip().duration };
        },
        async sampleAll(duration, n) {
            const out = [];
            const end = Math.min(duration, 20);
            for (let i = 0; i < n; i++) {
                const t = (end * i) / (n - 1);
                seek(t);
                await frames(1);
                out.push({ t, ...read() });
            }
            return out;
        },
        async hold(t) {
            seek(t);
            await frames(2);
        },
        stop() {
            try {
                window.NEXUS_CLIP_LOADER.stopClip?.();
            } catch (_) {}
        },
    };
}

async function openAvatar(D, browser, base, avatar) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(180000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await D.waitForApp(page, 180000);
    await page.waitForFunction(
        () => window.NEXUS_VIEWER?.avatarManager?._currentVRM && window.NEXUS_CLIP_LOADER?.getAllAnimations?.().length
    );
    if (avatar !== 'AvatarSample_A') {
        await page.evaluate((u) => window.NEXUS_VIEWER.loadAvatar(u), `/vendor/avatars/${avatar}.vrm`);
        await page.waitForFunction(
            (n) => (window.NEXUS_VIEWER.avatarManager.currentRoot?.name || '').endsWith(n),
            `${avatar}.vrm`
        );
    }
    await page.waitForTimeout(2500);
    await page.addScriptTag({ path: path.join(ROOT, 'tools/qa/GestureBodyCheck.js') });
    await page.evaluate(installSampler);
    // Clips are reviewed where a person plays them: in Pose Studio, open. That is what keeps
    // ProceduralAnimator in edit mode (it stays off her bones) and the chat motion stack holding
    // still; outside the studio the procedural rest pose is rewritten over the clip every frame,
    // which is not what anyone sees after pressing Play. The panel is then hidden from the frames
    // (the editor stays active), and the camera frames her whole body once for every sequence.
    await page.locator('#openPoseStudioBtn').click();
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
        window.NEXUS_CLIP_LOADER.stopClip?.();
        document.getElementById('poseStudioRoot').style.visibility = 'hidden';
        const v = window.NEXUS_VIEWER;
        v.frameObject?.(v.avatarManager.currentRoot, 1.6);
    });
    await page.waitForTimeout(1500);
    return { page, ctx, errors };
}

function judge(clip, samples, stand, start, dt) {
    const category = clip.category;
    const intent = intentOf(clip.id);
    const played = Boolean(start.ok && samples.length);
    const nan = samples.some((x) => !x.finite);
    let motion = 0;
    if (samples.length) {
        const a = samples[0].quats;
        for (const x of samples)
            for (const k of Object.keys(x.quats)) {
                const q = a[k];
                const p = x.quats[k];
                if (!q || !p) continue;
                const d = Math.abs(q[0] * p[0] + q[1] * p[1] + q[2] * p[2] + q[3] * p[3]);
                motion = Math.max(motion, 2 * Math.acos(Math.min(1, d)) * 57.29578);
            }
    }
    const m = Motion.score({
        kind: 'gesture',
        played,
        stand: { hipsY: stand.hips[1], headAboveHips: stand.head[1] - stand.hips[1] },
        samples: samples.map((x) => ({ hipsY: x.hips[1], headY: x.head[1], footY: [x.feet[0][1], x.feet[1][1]] })),
        motionDeg: motion,
        posture: (intent && intent.posture) || POSTURE[category] || 'stand',
    });
    const q = played
        ? Quality.score({
              category,
              posture: intent && intent.posture,
              dt,
              stand: { footY: [stand.feet[0][1], stand.feet[1][1]] },
              ground: 0,
              samples,
          })
        : { fails: [], warns: [], metrics: {} };
    let motionFlags = m.flags;
    if (intent && intent.airborne) motionFlags = motionFlags.filter((f) => f !== 'floating');
    const fails = [
        ...motionFlags.filter((f) => ['not-played', 'floating', 'sinking', 'tipped-over', 'legs-flipped'].includes(f)),
        ...q.fails,
    ];
    if (nan) fails.push('nan-bones');
    const warns = [...motionFlags.filter((f) => !fails.includes(f)), ...q.warns];
    return {
        verdict: fails.length ? 'fail' : warns.length ? 'warn' : 'ok',
        fails,
        warns,
        metrics: {
            duration: start.duration ? +start.duration.toFixed(2) : null,
            samples: samples.length,
            ...m.metrics,
            ...q.metrics,
        },
        why: start.why || null,
        intent: intent ? intent.why : null,
    };
}

async function reviewAvatar(D, browser, base, avatar, rows) {
    const { page, ctx, errors } = await openAvatar(D, browser, base, avatar);
    const canvas = await page.evaluate(() => {
        const r = window.NEXUS_VIEWER.renderer.domElement.getBoundingClientRect();
        return {
            x: Math.max(0, r.left),
            y: Math.max(0, r.top),
            width: Math.min(r.width, innerWidth),
            height: Math.min(r.height, innerHeight),
        };
    });
    const stand = await page.evaluate(() => window.__an.standing());
    let clips = await page.evaluate(() =>
        window.NEXUS_CLIP_LOADER.getAllAnimations().map((c) => ({
            id: c.id,
            label: c.label,
            category: c.category || (String(c.id).includes('.vrma') ? 'vrma' : 'other'),
        }))
    );
    clips = clips.map((c) => ({ ...c, category: String(c.id).toLowerCase().includes('.vrma') ? 'vrma' : c.category }));
    if (CATEGORY) clips = clips.filter((c) => c.category === CATEGORY);
    if (ONLY.length) clips = clips.filter((c) => ONLY.some((o) => String(c.id).includes(o)));
    console.log(`\n${avatar}: ${clips.length} clips`);
    for (const clip of clips) {
        const t0 = Date.now();
        const start = await page.evaluate((id) => window.__an.start(id), clip.id);
        const n = start.ok
            ? Math.max(8, Math.min(MAX_SAMPLES, Math.ceil(Math.min(start.duration, MAX_SECONDS) / 0.1) + 1))
            : 0;
        const samples = start.ok
            ? await page.evaluate(([d, k]) => window.__an.sampleAll(d, k), [start.duration, n])
            : [];
        const dt = n > 1 ? Math.min(start.duration, MAX_SECONDS) / (n - 1) : 0.1;
        const result = judge(clip, samples, stand, start, dt);
        const frames = [];
        if (start.ok) {
            const end = Math.min(start.duration, MAX_SECONDS);
            for (let i = 0; i < FRAMES; i++) {
                const t = (end * i) / (FRAMES - 1);
                await page.evaluate((tt) => window.__an.hold(tt), t);
                const file = `${avatar}-${String(clip.id).replace(/[^A-Za-z0-9]+/g, '_')}-${i}.jpg`;
                await page.screenshot({ path: path.join(SHOTS, file), type: 'jpeg', quality: 62, clip: canvas });
                frames.push({ t: +t.toFixed(2), file: 'shots/' + file });
            }
        }
        await page.evaluate(() => window.__an.stop());
        const row = { avatar, id: clip.id, label: clip.label, category: clip.category, ...result, frames };
        rows.push(row);
        const flags = [...result.fails, ...result.warns.map((w) => '~' + w)];
        console.log(
            `${result.verdict.padEnd(4)} ${clip.category.padEnd(9)} ${String(clip.id).split('/').pop().padEnd(34)} ${String(result.metrics.duration ?? '-').padStart(6)} s  ${flags.join(' ') || ''}${result.why ? ' (' + result.why + ')' : ''}  [${Math.round((Date.now() - t0) / 100) / 10} s]`
        );
    }
    if (errors.length) console.log(`page errors on ${avatar}: ${errors.slice(0, 3).join(' | ')}`);
    await ctx.close();
    return errors;
}

function writeReport(rows, pageErrors) {
    const order = { fail: 0, warn: 1, ok: 2 };
    rows.sort(
        (a, b) =>
            order[a.verdict] - order[b.verdict] ||
            a.category.localeCompare(b.category) ||
            String(a.id).localeCompare(String(b.id))
    );
    const sum = { ok: 0, warn: 0, fail: 0 };
    for (const r of rows) sum[r.verdict]++;
    const byCat = {};
    for (const r of rows) {
        byCat[r.category] = byCat[r.category] || { ok: 0, warn: 0, fail: 0 };
        byCat[r.category][r.verdict]++;
    }
    const flagCount = {};
    for (const r of rows) for (const f of [...r.fails, ...r.warns]) flagCount[f] = (flagCount[f] || 0) + 1;
    fs.writeFileSync(
        path.join(OUT, 'report.json'),
        JSON.stringify(
            { stamp, avatars: AVATARS, limits: Quality.LIMITS, summary: sum, byCategory: byCat, rows },
            null,
            1
        )
    );
    const n = (v) => (v == null ? '' : v);
    const md = [
        `# Animation review ${stamp}`,
        '',
        `Avatars: ${AVATARS.join(', ')} · ${FRAMES} frames per sequence · stepped every 0.1 s (at most ${MAX_SAMPLES} steps), read after the app rendered each`,
        '',
        `**${sum.fail ? 'FAIL' : 'PASS'}** — ${sum.ok} ok · ${sum.warn} warn · ${sum.fail} fail`,
        '',
        '| category | ok | warn | fail |',
        '|---|---|---|---|',
        ...Object.entries(byCat).map(([c, v]) => `| ${c} | ${v.ok} | ${v.warn} | ${v.fail} |`),
        '',
        `Flags: ${
            Object.entries(flagCount)
                .map(([f, c]) => `${f} ${c}`)
                .join(' · ') || 'none'
        }`,
        '',
        pageErrors.length ? `Page errors: ${pageErrors.slice(0, 5).join(' | ')}\n` : '',
        '| verdict | avatar | category | clip | s | flags | hips min/max | floor cm | knee back cm | skate | inside | pop ° | seam ° | travel m | turn ° |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ];
    for (const r of rows) {
        const m = r.metrics;
        md.push(
            `| **${r.verdict}** | ${r.avatar} | ${r.category} | ${String(r.id).split('/').pop()} | ${n(m.duration)} | ${[...r.fails, ...r.warns].join(', ')}${r.why ? ' — ' + r.why : ''}${r.intent ? ' (reviewed — intended: ' + r.intent + ')' : ''} | ${n(m.hipsMin)}/${n(m.hipsMax)} | ${n(m.floorPenCm)} | ${n(m.kneeBehindCm)} | ${n(m.skateShare)} | ${n(m.insideShare)} | ${n(m.maxStepDeg)} | ${n(m.seamDeg)} | ${n(m.travelM)} | ${n(m.turnDeg)} |`
        );
    }
    fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n') + '\n');
    const html = [
        '<!doctype html><meta charset="utf-8"><title>Animation review</title>',
        '<style>body{font:13px system-ui;background:#141216;color:#eee;margin:16px}.row{margin:10px 0 18px}.strip{display:flex;gap:4px;overflow-x:auto}.strip figure{margin:0}.strip img{height:190px;border-radius:4px;display:block}figcaption{font-size:11px;opacity:.7;text-align:center}.fail h3{color:#ff7b7b}.warn h3{color:#ffc46b}.ok h3{color:#8be28b}h3{margin:0 0 4px;font-size:14px}.m{opacity:.75;font-size:12px}</style>',
        `<h1>Animation review ${stamp}</h1><p>${sum.ok} ok · ${sum.warn} warn · ${sum.fail} fail — failing clips first. Each row reads left to right through the clip.</p>`,
    ];
    for (const r of rows) {
        const m = r.metrics;
        html.push(
            `<div class="row ${r.verdict}"><h3>${r.verdict.toUpperCase()} · ${r.category} · ${String(r.id).split('/').pop()} · ${r.avatar}</h3><div class="m">${[...r.fails, ...r.warns].join(', ') || 'clean'} — ${m.duration ?? '-'} s, hips ${m.hipsMin ?? '-'}–${m.hipsMax ?? '-'} m, max step ${m.maxStepDeg ?? '-'}°${m.seamDeg != null ? `, seam ${m.seamDeg}°` : ''}${r.why ? ' — ' + r.why : ''}</div><div class="strip">${r.frames.map((f) => `<figure><img src="${f.file}" loading="lazy"><figcaption>${f.t} s</figcaption></figure>`).join('')}</div></div>`
        );
    }
    fs.writeFileSync(path.join(OUT, 'index.html'), html.join('\n'));
    return sum;
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
    const rows = [];
    const pageErrors = [];
    try {
        for (const avatar of AVATARS) pageErrors.push(...(await reviewAvatar(D, browser, server.base, avatar, rows)));
    } finally {
        await browser.close();
        if (server.stop) server.stop();
    }
    const sum = writeReport(rows, pageErrors);
    fs.writeFileSync(path.join(HERE, 'runs', 'LATEST'), path.relative(HERE, OUT) + '\n');
    console.log(`\n${sum.fail ? 'FAIL' : 'PASS'} — ${sum.ok} ok · ${sum.warn} warn · ${sum.fail} fail`);
    console.log(`report: ${path.relative(ROOT, path.join(OUT, 'report.md'))}`);
    process.exit(sum.fail ? 1 : 0);
}

main().catch((e) => {
    console.error('animation review crashed:', e && e.stack ? e.stack : e);
    process.exit(2);
});
