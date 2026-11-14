#!/usr/bin/env node
/**
 * MO11. One command that answers "does the avatar's motion work on the site right now?"
 *
 *   npm run audit:motion                         # 3 avatar heights, every stage
 *   node audits/motion/run.mjs --quick           # AvatarSample_A only
 *   node audits/motion/run.mjs --avatars Vita,Vivi
 *   node audits/motion/run.mjs --parallel        # avatars side by side (needs a real GPU)
 *   node audits/motion/run.mjs --static          # no browser: tables, files, KB, inventory
 *   node audits/motion/run.mjs --only gestures,phrases
 *
 * Stages
 *   static    every manifest file exists; every gesture the model is offered resolves to a
 *             playable, non-quarantined file (or a procedural) and carries a when-to-use hint;
 *             every fast-path label has an ActionRegistry chip; the KB passes semantic
 *             validation; the committed animation inventory is current.
 *   ui        the page boots with no page errors; Pose Studio opens and lists its sections and
 *             the VRMA library.
 *   gestures  every name in MotionClipMap.availableNames(), played the way the model plays it.
 *   phrases   chat phrases (several languages, typos) through the same entry point as the chat
 *             box; the fast path must understand them and the body must do it.
 *   poses     every Pose Navigator preset, applied the way Pose Studio applies it.
 *
 * Each action is judged by tools/qa/MotionAuditScorer.js — grounded, upright, legs below the
 * hips, visibly moved — on avatars of different heights (0.69 m / 0.89 m / 0.98 m hips by
 * default), because a clip that is fine on one rig can float, sink or tip over on another.
 *
 * Output: audits/motion/runs/<stamp>/ — report.md (read this first), report.json, index.html
 * (every frame, grouped), shots/, and conversation.md / conversation.json: the measurements
 * turned into conversation-design decisions for chat and VR (which gestures are safe to offer,
 * which fit one spoken sentence, which suit VR at arm's length, where the vocabulary has holes).
 * Exit 0 when nothing fails, 1 otherwise.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
// package.json is "type": "module", so require() of a dual-export IIFE hands back an empty
// namespace; run it in a sandbox and take the global it publishes (as kb/scripts do).
const Scorer = (() => {
    const sandbox = { console, Math };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'tools/qa/MotionAuditScorer.js'), 'utf8'), sandbox);
    return sandbox.NEXUS_MOTION_AUDIT_SCORER;
})();

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => (argv.includes(f) && argv[argv.indexOf(f) + 1] ? argv[argv.indexOf(f) + 1] : d);
const AVATARS = has('--quick')
    ? ['AvatarSample_A']
    : arg('--avatars', 'AvatarSample_A,VRM_Viewer_Sample,Vita')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
const STAGES = new Set(arg('--only', 'static,ui,gestures,phrases,poses').split(','));
if (has('--static')) for (const s of ['ui', 'gestures', 'phrases', 'poses']) STAGES.delete(s);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(HERE, 'runs', stamp);
const SHOTS = path.join(OUT, 'shots');

/** Chat phrases: text → the fast-path label it must reach, and what the body should end up as. */
const PHRASES = [
    ['wave', 'wave'],
    ['sit down', 'sit', 'sit'],
    ['stand up', 'stand'],
    ['lie down', 'lay', 'lay'],
    ['dance', 'dance'],
    ['bow', 'bow'],
    ['nod', 'nod_yes'],
    ['high five', 'high_five'],
    ['bye', 'goodbye'],
    ['jump', 'jump'],
    ['look around', 'look_around'],
    ['peace sign', 'peace_sign'],
    ['twirl', 'spin'],
    ['strike a pose', 'model_pose'],
    ['show me your outfit', 'show_outfit'],
    ['siediti', 'sit', 'sit'],
    ['balla', 'dance'],
    ['fammi vedere il vestito', 'show_outfit'],
    ['sitt down', 'sit', 'sit'],
    ['dacne', 'dance'],
    ['follow me', 'follow'],
];

/** Names whose body is not a standing gesture. */
function postureOf(name) {
    if (/^sit|sitting/i.test(name)) return 'sit';
    if (/^lay|^lie|lying/i.test(name)) return 'lay';
    if (/kneel|playful_dip|crouch/i.test(name)) return 'low';
    // Dances bend deep on purpose (dance_headdrop puts her head near her knees): judge them on
    // floating, sinking and legs, not on staying upright.
    if (/bend|bent|^dance$|^balla$|^dacne$/i.test(name)) return 'bend';
    return 'stand';
}
// Presets that are deliberately close to the neutral stance: little motion is not a fault.
const AMBIENT = new Set(['idle', 'talking', 'stand', 'standing', 'lecturerNeutral', 'anchorGrounded', 'presenterOpen']);

// ── static stage ──────────────────────────────────────────────────────────────

/** Run a browser IIFE module in a sandbox and return the global it publishes. */
function loadBrowserModule(rel, globalName, extra = {}) {
    const window = { ...extra };
    const ctx = vm.createContext({
        window,
        console,
        Math,
        Object,
        Array,
        JSON,
        setTimeout,
        clearTimeout,
        module: undefined,
    });
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
    return window[globalName];
}

function staticStage() {
    const checks = [];
    const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || '' });

    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor/animations/manifest.json'), 'utf8'));
    const missing = [];
    let files = 0;
    for (const cat of Object.values(manifest.categories)) {
        for (const f of cat.files || []) {
            files++;
            if (!fs.existsSync(path.join(ROOT, 'vendor/animations', f))) missing.push(f);
        }
    }
    add('manifest files exist', !missing.length, `${files} files, missing: ${missing.join(', ') || 'none'}`);

    const Clips = loadBrowserModule('src/xr/MotionClipMap.js', 'NEXUS_MOTION_CLIPS');
    Clips._setManifest(manifest);
    const names = Clips.availableNames();
    const noHint = names.filter((n) => !Clips.USE[n]);
    add(
        'every offered gesture has a when-to-use hint',
        !noHint.length,
        `${names.length} offered; missing: ${noHint.join(', ') || 'none'}`
    );
    const dead = [];
    for (const n of names) {
        const r = Clips.resolve(n);
        const files2 = (r && r.candidates) || [];
        const real = files2.filter((p) => fs.existsSync(path.join(ROOT, p)) && !Clips.QUARANTINE[p]);
        if (!real.length && !(r && r.procedural)) dead.push(n);
    }
    add(
        'every offered gesture resolves to a playable file or a procedural',
        !dead.length,
        `unplayable: ${dead.join(', ') || 'none'}`
    );

    const FastPath = loadBrowserModule('src/xr/IntentFastPath.js', 'NEXUS_INTENT_FASTPATH');
    const Registry = loadBrowserModule('src/xr/ActionRegistry.js', 'NEXUS_ACTION_REGISTRY');
    const noChip = FastPath.RULES.map((r) => r.label).filter(
        (l) => !(Registry && Registry.action && Registry.action(l))
    );
    add(
        'every fast-path label has an action chip',
        !noChip.length,
        `${FastPath.RULES.length} labels; without chip: ${noChip.join(', ') || 'none'}`
    );
    const wrong = PHRASES.filter(([t, l]) => (FastPath.match(t) || {}).label !== l).map(([t]) => t);
    add('every audited chat phrase is understood', !wrong.length, `not understood: ${wrong.join(', ') || 'none'}`);

    // Facts for the conversation-design brief: what each offered gesture is, from the KB.
    const kbIndex = new Map();
    for (const line of fs.readFileSync(path.join(ROOT, 'kb/animations.manifest.jsonl'), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
            const r = JSON.parse(line);
            if (r.file) kbIndex.set(r.file, r);
        } catch (_) {
            /* a bad line is the KB validator's business */
        }
    }
    const gestures = {};
    for (const n of names) {
        const r = Clips.resolve(n) || {};
        const file =
            (r.candidates || []).find((p) => fs.existsSync(path.join(ROOT, p)) && !Clips.QUARANTINE[p]) || null;
        const rec = file ? kbIndex.get(file) : null;
        const reg = Registry && Registry.action ? Registry.action(n) || Registry.action(n + '_yes') : null;
        gestures[n] = {
            use: Clips.USE[n] || null,
            file,
            procedural: r.procedural || null,
            durationS: rec && rec.stats ? rec.stats.duration : null,
            energy: rec ? rec.energy : null,
            valence: rec ? rec.valence : null,
            description: rec ? rec.description : null,
            phrases: reg && reg.phrases ? reg.phrases : null,
            loop: !!r.loop,
        };
    }

    const run = (cmd, a) => spawnSync(process.execPath, [cmd, ...a], { cwd: ROOT, encoding: 'utf8' });
    const inv = run('tools/qa/animation-audit.mjs', ['--check']);
    add('animation inventory is current', inv.status === 0, (inv.stdout + inv.stderr).trim().split('\n').pop());
    const kb = run('kb/scripts/validate-manifest.mjs', ['--level', 'semantic']);
    add('KB passes semantic validation', kb.status === 0, (kb.stdout + kb.stderr).trim().split('\n').pop());
    return { checks, offered: names, gestures };
}

// ── browser stages ────────────────────────────────────────────────────────────

async function loadPlaywrightOrReexec() {
    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const got = D.loadPlaywright();
    if (got.playwright) return { D, playwright: got.playwright };
    // Cloud containers ship Playwright globally, matched to /opt/pw-browsers; try that once.
    if (!process.env.__MOTION_AUDIT_REEXEC) {
        let globalRoot = '';
        try {
            globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
        } catch (_) {
            /* no npm */
        }
        if (globalRoot && fs.existsSync(path.join(globalRoot, 'playwright'))) {
            const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...argv], {
                stdio: 'inherit',
                env: { ...process.env, NODE_PATH: globalRoot, __MOTION_AUDIT_REEXEC: '1', __MOTION_AUDIT_OUT: OUT },
            });
            process.exit(r.status ?? 1);
        }
    }
    throw new Error(got.why || 'Playwright missing');
}

/** In-page helpers, installed once per page. */
const PAGE_HELPERS = () => {
    const V = () => window.NEXUS_VIEWER;
    const H = () => V().avatarManager.vrmLoader.currentVRM.humanoid;
    const BONES = [
        'hips',
        'spine',
        'chest',
        'neck',
        'head',
        'leftUpperArm',
        'rightUpperArm',
        'leftLowerArm',
        'rightLowerArm',
        'leftHand',
        'rightHand',
        'leftUpperLeg',
        'rightUpperLeg',
        'leftLowerLeg',
        'rightLowerLeg',
        'leftFoot',
        'rightFoot',
    ];
    const y = (b) => {
        const n = H().getRawBoneNode(b);
        if (!n) return null;
        n.updateWorldMatrix(true, false);
        return n.matrixWorld.elements[13];
    };
    window.__ma = {
        sample: () => ({ hipsY: y('hips'), headY: y('head'), footY: [y('leftFoot'), y('rightFoot')] }),
        quats: () =>
            BONES.map((b) => {
                const n = H().getRawBoneNode(b);
                return n ? n.getWorldQuaternion(new window.THREE.Quaternion()).toArray() : null;
            }),
        angle: (a, b) => {
            let m = 0;
            for (let i = 0; i < a.length; i++) {
                if (!a[i] || !b[i]) continue;
                const d = Math.abs(a[i][0] * b[i][0] + a[i][1] * b[i][1] + a[i][2] * b[i][2] + a[i][3] * b[i][3]);
                m = Math.max(m, 2 * Math.acos(Math.min(1, d)) * 57.2958);
            }
            return m;
        },
        frame: () => {
            const v = V(),
                r = v.avatarManager.currentRoot;
            const p = r.getWorldPosition(new window.THREE.Vector3());
            const L = H().getRawBoneNode('leftUpperLeg').getWorldPosition(new window.THREE.Vector3());
            const R = H().getRawBoneNode('rightUpperLeg').getWorldPosition(new window.THREE.Vector3());
            const right = R.sub(L);
            right.y = 0;
            right.normalize();
            const fwd = new window.THREE.Vector3(0, 1, 0).cross(right).normalize();
            const dir = fwd.multiplyScalar(0.85).add(right.multiplyScalar(-0.5)).normalize();
            v.camera.position.set(p.x + dir.x * 3.4, p.y + 1.0, p.z + dir.z * 3.4);
            v.controls.target.set(p.x, p.y + 0.8, p.z);
            v.controls.update();
        },
        stop: () => {
            try {
                window.NEXUS_MOTION.execute({ commands: [{ type: 'stop' }] });
            } catch (_) {}
        },
    };
};

async function playAndMeasure(page, ctx, label, fire, opts) {
    // Gestures and phrases start from a chat "stop" (the escape hatch a person has). Poses do
    // not: stop starts the motion stack's settle-and-resume-idle, and the idle then overwrote the
    // preset mid-sample. Pose Studio never sends stop, so poses reset to the neutral preset.
    if (opts.reset) await page.evaluate(opts.reset);
    else await page.evaluate(() => window.__ma.stop());
    await page.waitForTimeout(opts.settleMs || 2600);
    await page.evaluate(() => window.__ma.frame());
    const rest = await page.evaluate(() => window.__ma.quats());
    const before = await page.evaluate(() => JSON.stringify(window.NEXUS_MOTION.state.execution || null));
    await fire();
    // Wait for the action to actually start before sampling. A short gesture is replaced by the
    // idle within seconds, and the first play of a VRMA is a fetch + parse that can take over 2 s
    // under software rendering — sampling a fixed window from the click missed both.
    const startT = Date.now();
    let started = null;
    while (Date.now() - startT < (opts.startTimeoutMs ?? 15000)) {
        started = await page.evaluate(
            ({ want, before }) => {
                const ex = window.NEXUS_MOTION.state.execution || null;
                if (!ex || JSON.stringify(ex) === before) return null;
                if (want && ex.action !== want) return null;
                return ex.status === 'requested' ? null : { ...ex };
            },
            { want: opts.expectAction || null, before }
        );
        if (started) break;
        await page.waitForTimeout(100);
    }
    const samples = [];
    const clipsSeen = [];
    let motion = 0;
    const shots = [];
    const marks = opts.marks || [700, 1500, 2300];
    const t0 = Date.now();
    let k = 0;
    while (Date.now() - t0 < (opts.durationMs || 2700)) {
        const r = await page.evaluate(
            (rest) => ({
                s: window.__ma.sample(),
                a: window.__ma.angle(rest, window.__ma.quats()),
                clip: (window.NEXUS_CLIP_LOADER.getCurrentPlaybackState().clip || '').split('/').pop(),
            }),
            rest
        );
        if (r.clip && !clipsSeen.includes(r.clip)) clipsSeen.push(r.clip);
        samples.push(r.s);
        motion = Math.max(motion, r.a);
        if (k < marks.length && Date.now() - t0 >= marks[k]) {
            const file = `${ctx.avatar}-${opts.stage}-${String(ctx.n).padStart(3, '0')}-${k}.jpg`;
            await page.screenshot({
                path: path.join(SHOTS, file),
                type: 'jpeg',
                quality: 70,
                clip: { x: 300, y: 0, width: 300, height: 420 },
            });
            shots.push('shots/' + file);
            k++;
        }
        await page.waitForTimeout(60);
    }
    return {
        samples,
        motion,
        shots,
        ex: started,
        before,
        clipsSeen,
        startedAfterMs: started ? Date.now() - startT : null,
    };
}

async function auditAvatar(D, browser, base, avatar, offered) {
    const page = await (await browser.newContext({ viewport: { width: 900, height: 900 } })).newPage();
    page.setDefaultTimeout(180000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await D.waitForApp(page, 180000);
    await page.waitForFunction(
        () => window.NEXUS_MOTION?.state?.booted && window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM
    );
    if (avatar !== 'AvatarSample_A') {
        await page.evaluate((u) => window.NEXUS_VIEWER.loadAvatar(u), `/vendor/avatars/${avatar}.vrm`);
        await page.waitForFunction(
            (f) =>
                (window.NEXUS_VIEWER.avatarManager.currentRoot?.name || '').endsWith(f) &&
                window.NEXUS_VIEWER.avatarManager.vrmLoader.currentVRM,
            `${avatar}.vrm`
        );
        await page.evaluate(() =>
            window.NEXUS_MOTION.onAvatarChanged?.(
                window.NEXUS_VIEWER.avatarManager.currentRoot,
                window.NEXUS_VIEWER.avatarManager._currentVRM
            )
        );
    }
    await page.evaluate(PAGE_HELPERS);
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__ma.frame());
    const s0 = await page.evaluate(() => window.__ma.sample());
    const stand = { hipsY: s0.hipsY, headAboveHips: s0.headY - s0.hipsY };
    const rows = [];
    let n = 0;
    const push = (stage, name, played, m, extra = {}) => {
        const posture = extra.posture || postureOf(name);
        const sc0 = Scorer.score({
            kind: stage,
            played,
            stand,
            samples: m.samples,
            motionDeg: m.motion,
            posture,
            ambient: AMBIENT.has(name),
            ...extra.score,
        });
        const sc = { ...sc0, flags: [...sc0.flags, ...(extra.extraFlags || [])] };
        if (sc.verdict === 'ok' && (extra.extraFlags || []).length) sc.verdict = 'warn';
        rows.push({
            avatar,
            stage,
            name,
            posture,
            played,
            ...sc,
            clip: (m.clipsSeen || []).join(' → ') || (m.ex && m.ex.clip ? String(m.ex.clip).split('/').pop() : null),
            reason: m.ex && m.ex.reason,
            shots: m.shots,
            ...extra.meta,
        });
    };

    // UI — first avatar only: Pose Studio opens, its sections and the VRMA library are there.
    let ui = null;
    if (STAGES.has('ui')) {
        ui = await page.evaluate(async () => {
            const btn = document.getElementById('openPoseStudioBtn');
            if (btn) btn.click();
            await new Promise((r) => setTimeout(r, 1200));
            const labels = [...document.querySelectorAll('.pose-studio-label')].map((l) => l.textContent.trim());
            const sel = document.getElementById('poseVrmaSelect');
            return { button: !!btn, labels, vrmaOptions: sel ? sel.options.length : 0 };
        });
        await page.screenshot({ path: path.join(SHOTS, `${avatar}-ui-pose-studio.jpg`), type: 'jpeg', quality: 70 });
        ui.shot = `shots/${avatar}-ui-pose-studio.jpg`;
        await page.evaluate(() => document.getElementById('openPoseStudioBtn')?.click());
        await page.waitForTimeout(600);
    }

    if (STAGES.has('gestures')) {
        // Postures (sit / lay / stand) are commands with state — "stand" from standing plays a
        // sit-to-stand clip and dips her — so they are audited through the phrases, in order.
        const names = offered.filter((x) => !['talking', 'sit', 'lay', 'stand'].includes(x));
        for (const name of names) {
            n++;
            const m = await playAndMeasure(
                page,
                { avatar, n },
                name,
                () => page.evaluate((a) => window.NEXUS_MOTION.playAnimation(a), name),
                { stage: 'gesture', expectAction: name }
            );
            const ex = m.ex || {};
            // Under three software-rendered browsers a first VRMA load can outlast the wait. If the
            // body clearly moved, it played — flag the missing start record instead of failing it.
            const startSeen = ex.action === name && ex.status !== 'failed';
            const played = startSeen || (!m.ex && m.motion > 5);
            push('gesture', name, played, m, {
                meta: { startedAfterMs: m.startedAfterMs },
                extraFlags: startSeen ? [] : ['start-not-observed'],
            });
        }
    }

    if (STAGES.has('phrases')) {
        for (const [text, label, posture] of PHRASES) {
            n++;
            const got = await page.evaluate((t) => (window.NEXUS_INTENT_FASTPATH.match(t) || {}).label || null, text);
            const m = await playAndMeasure(
                page,
                { avatar, n },
                text,
                () => page.evaluate((t) => window.NEXUS_MOTION.onUserUtterance(t), text),
                { stage: 'phrase', startTimeoutMs: 4000 }
            );
            const ex = m.ex || {};
            // Locomotion and stop do not always write an execution record; a matched label with no
            // failed record counts as acted on, and the body numbers judge the rest.
            const played = got === label && ex.status !== 'failed';
            push('phrase', text, played, m, {
                posture: posture || (label === 'model_pose' ? 'stand' : postureOf(label)),
                score: { expectLabel: label, gotLabel: got },
                meta: { label: got },
            });
        }
    }

    if (STAGES.has('poses')) {
        // Through the real Pose Studio: its button opens the panel (show → _enterPoseMode, which
        // also holds the chat motion stack — MO12), presets apply as Next/Back apply them, and the
        // panel closes at the end. Copying what _enterPoseMode does missed exactly the bug it had:
        // after the chat stages, a queued idle stood her back up mid-pose.
        const inv = JSON.parse(fs.readFileSync(path.join(ROOT, 'quality-lab/data/3d/animations-audit.json'), 'utf8'));
        await page.evaluate(() => document.getElementById('openPoseStudioBtn')?.click());
        await page.waitForTimeout(1000);
        for (const p of inv.poses) {
            n++;
            const id = p.id;
            const m = await playAndMeasure(
                page,
                { avatar, n },
                id,
                () => page.evaluate((poseId) => window.vrPoseSystem.applyPreset(poseId, 0), id),
                {
                    stage: 'pose',
                    durationMs: 1600,
                    marks: [1200],
                    settleMs: 900,
                    startTimeoutMs: 0,
                    reset: () => window.vrPoseSystem.applyPreset('lecturerNeutral', 0),
                }
            );
            push('pose', id, true, m, { posture: postureOf(id) });
        }
        await page.evaluate(() => document.getElementById('openPoseStudioBtn')?.click());
        await page.waitForTimeout(600);
    }
    await page.close();
    return { avatar, stand, ui, errors, rows };
}

// ── report ────────────────────────────────────────────────────────────────────

function writeReport(report) {
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
    const L = [];
    L.push(`# Motion audit ${stamp}`, '', `Verdict: **${report.ok ? 'PASS' : 'FAIL'}**`, '');
    L.push('## Static', '', '| Check | Result | Detail |', '| --- | --- | --- |');
    for (const c of report.static.checks)
        L.push(`| ${c.name} | ${c.ok ? 'ok' : '**FAIL**'} | ${c.detail.replace(/\|/g, '/')} |`);
    for (const a of report.avatars) {
        L.push('', `## ${a.avatar} (standing hips ${a.stand.hipsY.toFixed(2)} m)`, '');
        if (a.ui)
            L.push(
                `UI: Pose Studio button ${a.ui.button ? 'ok' : '**missing**'}; sections: ${a.ui.labels.join(' · ')}; VRMA list: ${a.ui.vrmaOptions} clips`,
                ''
            );
        L.push(`Page errors: ${a.errors.length ? a.errors.map((e) => '`' + e + '`').join('; ') : 'none'}`, '');
        for (const stage of ['gesture', 'phrase', 'pose']) {
            const rows = a.rows.filter((r) => r.stage === stage);
            if (!rows.length) continue;
            const s = Scorer.summarize(rows);
            L.push(`### ${stage}s — ${s.ok} ok · ${s.warn} warn · ${s.fail} fail`, '');
            const bad = rows.filter((r) => r.verdict !== 'ok');
            if (bad.length) {
                L.push(
                    '| Action | Verdict | Flags | hips | upright | feet−hips | motion° | clip |',
                    '| --- | --- | --- | --- | --- | --- | --- | --- |'
                );
                for (const r of bad) {
                    const m = r.metrics;
                    L.push(
                        `| ${r.name} | ${r.verdict} | ${r.flags.join(', ')} | ${m.hipsMin}–${m.hipsMax} | ${m.uprightMin} | ${m.feetAboveHipsMax} | ${m.motionDeg} | ${r.clip || ''} |`
                    );
                }
                L.push('');
            }
        }
    }
    L.push('', 'Every frame: `index.html` in this folder. Raw numbers: `report.json`.', '');
    fs.writeFileSync(path.join(OUT, 'report.md'), L.join('\n'));

    const H = [
        `<!doctype html><meta charset="utf-8"><title>Motion audit ${stamp}</title>`,
        '<style>body{font:13px system-ui;background:#111;color:#ddd;margin:16px}h2{margin-top:28px}.g{display:flex;flex-wrap:wrap;gap:8px}.c{background:#1b1b1b;padding:6px;border-radius:6px;width:300px}.c img{width:96px}.ok{color:#7c7}.warn{color:#fc6}.fail{color:#f66}</style>',
        `<h1>Motion audit ${stamp} — ${report.ok ? 'PASS' : 'FAIL'}</h1>`,
    ];
    for (const a of report.avatars) {
        H.push(`<h2>${a.avatar}</h2>`);
        if (a.ui && a.ui.shot) H.push(`<p>UI <img src="${a.ui.shot}" width="320"></p>`);
        for (const stage of ['gesture', 'phrase', 'pose']) {
            const rows = a.rows.filter((r) => r.stage === stage);
            if (!rows.length) continue;
            H.push(`<h3>${stage}s</h3><div class="g">`);
            for (const r of rows) {
                H.push(
                    `<div class="c"><b>${r.name}</b> <span class="${r.verdict}">${r.verdict}</span> ${r.flags.join(', ')}<br>${r.shots.map((s) => `<img src="${s}">`).join('')}</div>`
                );
            }
            H.push('</div>');
        }
    }
    fs.writeFileSync(path.join(OUT, 'index.html'), H.join('\n'));
}

// ── conversation design ───────────────────────────────────────────────────────

/**
 * Turn the measurements into decisions for chat and VR conversation design: which gestures are
 * safe to offer everywhere, which fit inside one spoken sentence, which suit VR at arm's length,
 * where the model's vocabulary has holes. Written for a person tuning prompts and phrases, and
 * for an agent: conversation.json carries the same facts.
 */
const REACH = new Set(['point', 'offer_hand', 'high_five', 'handshake', 'raise_hand', 'present', 'open_arms']);
const LOCOMOTION_LABELS = new Set(['follow', 'come_here', 'go_away', 'turn_around']);

function conversationDesign(report) {
    const g = report.static.gestures || {};
    const rowsByName = new Map();
    for (const a of report.avatars) {
        for (const r of a.rows.filter((x) => x.stage === 'gesture')) {
            if (!rowsByName.has(r.name)) rowsByName.set(r.name, []);
            rowsByName.get(r.name).push(r);
        }
    }
    const items = [];
    for (const [name, facts] of Object.entries(g)) {
        const rows = rowsByName.get(name) || [];
        const failsOn = rows.filter((r) => r.verdict === 'fail').map((r) => r.avatar);
        const warnsOn = rows.filter((r) => r.verdict === 'warn').map((r) => `${r.avatar} (${r.flags.join(', ')})`);
        const hipsSwing = rows.length
            ? Math.max(...rows.map((r) => (r.metrics.hipsMax || 0) - (r.metrics.hipsMin || 0)))
            : null;
        const intense =
            (facts.energy !== null && facts.energy >= 0.5) ||
            (hipsSwing !== null && hipsSwing > 0.12) ||
            /spin|jump/.test(name);
        const vr = REACH.has(name)
            ? 'great — reaches toward the person'
            : intense
              ? 'on request only — big motion is jarring up close'
              : 'good';
        const fits = facts.loop
            ? 'held (loops until stopped)'
            : facts.durationS == null
              ? 'short (procedural)'
              : facts.durationS <= 3.5
                ? 'fits one sentence'
                : facts.durationS <= 7
                  ? 'fits a short reply'
                  : 'long — use for a beat of silence, not mid-sentence';
        items.push({
            name,
            use: facts.use,
            status: !rows.length
                ? 'not measured'
                : failsOn.length
                  ? 'do not offer'
                  : warnsOn.length
                    ? 'check'
                    : 'safe everywhere',
            failsOn,
            warnsOn,
            durationS: facts.durationS,
            timing: fits,
            energy: facts.energy,
            valence: facts.valence,
            vr,
            spoken: !!facts.phrases,
            phrasesEn: facts.phrases && facts.phrases.en ? facts.phrases.en : [],
            description: facts.description,
        });
    }

    const recs = [];
    const bad = items.filter((i) => i.status === 'do not offer');
    if (bad.length)
        recs.push(
            `Remove from the model's vocabulary until fixed (fails on some avatar): ${bad.map((i) => `${i.name} [${i.failsOn.join(', ')}]`).join('; ')}.`
        );
    const unspoken = items.filter((i) => !i.spoken && !['sit', 'lay', 'stand', 'talking'].includes(i.name));
    if (unspoken.length)
        recs.push(
            `No spoken trigger — only the model can use these; add phrases to IntentFastPath + ActionRegistry if people should ask for them: ${unspoken.map((i) => i.name).join(', ')}.`
        );
    const long = items.filter((i) => i.durationS && i.durationS > 7 && !/loops/.test(i.timing));
    if (long.length)
        recs.push(
            `Long one-shots (> 7 s) outlast a typical spoken reply; trigger them at the start of a longer answer or trim: ${long.map((i) => `${i.name} ${i.durationS.toFixed(1)} s`).join(', ')}.`
        );
    const negative = items.filter((i) => i.valence !== null && i.valence < 0.2);
    if (negative.length < 2)
        recs.push(
            `Few gestures for low or serious moods (valence < 0.2: ${negative.map((i) => i.name).join(', ') || 'none'}) — empathy turns fall back to expressions only; consider adding a comforting / thoughtful gesture.`
        );
    const intenseVr = items.filter((i) => /on request only/.test(i.vr));
    if (intenseVr.length)
        recs.push(
            `In VR, keep these off the model's unprompted repertoire (offer only when asked): ${intenseVr.map((i) => i.name).join(', ')}.`
        );
    const reach = items.filter((i) => /great/.test(i.vr));
    if (reach.length)
        recs.push(
            `In VR, prefer these for presence — they reach toward the person: ${reach.map((i) => i.name).join(', ')}.`
        );
    const phraseFails = report.avatars.flatMap((a) =>
        a.rows.filter((r) => r.stage === 'phrase' && r.verdict === 'fail').map((r) => `"${r.name}" on ${a.avatar}`)
    );
    if (phraseFails.length) recs.push(`Chat phrases that did not produce the body action: ${phraseFails.join('; ')}.`);

    const doc = {
        stamp,
        generatedFrom: 'audits/motion/run.mjs',
        gestures: items,
        recommendations: recs,
        locomotionLabels: [...LOCOMOTION_LABELS],
    };
    fs.writeFileSync(path.join(OUT, 'conversation.json'), JSON.stringify(doc, null, 1));
    const L = [
        `# Conversation design brief — ${stamp}`,
        '',
        (report.avatars.length
            ? 'Measured on ' + report.avatars.map((a) => `${a.avatar} (hips ${a.stand.hipsY.toFixed(2)} m)`).join(', ')
            : 'Static facts only (no browser run)') +
            '. Use it to tune the gesture hints the model sees (MotionClipMap.USE), the spoken phrases (IntentFastPath / ActionRegistry), and what to offer in VR.',
        '',
        '## Recommendations',
        '',
        ...(recs.length ? recs.map((r) => `- ${r}`) : ['- Nothing to change.']),
        '',
        '## Gestures',
        '',
        '| Gesture | When to use (model hint) | Status | Timing | Energy | Mood | VR | Spoken |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ];
    for (const i of items) {
        L.push(
            `| ${i.name} | ${i.use || '—'} | ${i.status}${i.failsOn.length ? ' (' + i.failsOn.join(', ') + ')' : ''} | ${i.timing}${i.durationS ? ` (${i.durationS.toFixed(1)} s)` : ''} | ${i.energy ?? '—'} | ${i.valence ?? '—'} | ${i.vr} | ${i.spoken ? i.phrasesEn.slice(0, 2).join(' / ') : '—'} |`
        );
    }
    fs.writeFileSync(path.join(OUT, 'conversation.md'), L.join('\n') + '\n');
    return doc;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
    fs.mkdirSync(SHOTS, { recursive: true });
    const report = { stamp, avatars: [], static: { checks: [] }, ok: true };
    const st = staticStage();
    report.static = st;
    for (const c of st.checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name} — ${c.detail}`);

    const browserStages = ['ui', 'gestures', 'phrases', 'poses'].some((s) => STAGES.has(s));
    if (browserStages) {
        const { D, playwright } = await loadPlaywrightOrReexec();
        const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:1');
        const browser = await playwright.chromium.launch({ args: D.SWIFTSHADER });
        try {
            // One avatar at a time by default: three software-rendered pages at once starve each
            // other's frame loop (clips that read 0° of motion, settles that crawl). --parallel
            // trades that reliability for speed on a machine with a real GPU.
            if (has('--parallel')) {
                report.avatars = await Promise.all(
                    AVATARS.map((a) => auditAvatar(D, browser, server.base, a, st.offered))
                );
            } else {
                for (const a of AVATARS) report.avatars.push(await auditAvatar(D, browser, server.base, a, st.offered));
            }
        } finally {
            await browser.close();
            server.stop();
        }
    }
    const allRows = report.avatars.flatMap((a) => a.rows);
    report.summary = Scorer.summarize(allRows);
    report.ok =
        st.checks.every((c) => c.ok) && report.summary.fail === 0 && report.avatars.every((a) => !a.errors.length);
    writeReport(report);
    const design = conversationDesign(report);
    console.log(
        `conversation brief: ${design.recommendations.length} recommendation(s) → ${path.relative(ROOT, path.join(OUT, 'conversation.md'))}`
    );
    fs.writeFileSync(path.join(HERE, 'runs', 'LATEST'), path.relative(HERE, OUT) + '\n');
    console.log(
        `\n${report.ok ? 'PASS' : 'FAIL'} — ${report.summary.ok} ok · ${report.summary.warn} warn · ${report.summary.fail} fail across ${report.avatars.length} avatar(s)`
    );
    console.log(`report: ${path.relative(ROOT, path.join(OUT, 'report.md'))}`);
    process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
    console.error('motion audit crashed:', e && e.stack ? e.stack : e);
    process.exit(2);
});
