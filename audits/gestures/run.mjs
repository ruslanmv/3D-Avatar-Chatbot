#!/usr/bin/env node
/**
 * SG4–SG5. Gesture audit: every co-speech gesture, in the real renderer, as a person would see it.
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
 * SG5 adds her body (tools/qa/GestureBodyCheck.js, the same check the tuner optimises): every
 * gesture is held at its peak on each hand in turn — right, left, or both for a two-handed one —
 * and for whole replies ("Hello! How are you today?", an Italian greeting, a longer conversation)
 * every gesture the planner schedules is held at its peak with the planner's own hand and size.
 * A phone showed a "hello" bringing her hand across her front into her cardigan; this is the check
 * that would have caught it.
 *
 * Verdicts (numbers first, frames to confirm):
 *   ok    the hand moved at least MIN_MOVE_CM, reached its target, stayed out of her torso, did
 *         not cross her midline, and her hands were back at rest afterwards
 *   warn  it did all that but moved less than MIN_MOVE_CM (too subtle to read)
 *   fail  anything else: missed-target, hand-inside-body, forearm-inside-body, crosses-body,
 *         no-visible-motion, did-not-return, or the planner chose a different gesture
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
const STAGES = new Set(arg('--only', 'gestures,replies,positions').split(','));
const AVATARS = arg('--avatars', 'AvatarSample_A')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const MIN_MOVE_CM = 5;
const RETURN_CM = 3;

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
/** Whole replies, checked gesture by gesture with the planner's own hands and sizes. */
const REPLIES = [
    ['hello', 'Hello! How are you today?', 'en-US'],
    ['ciao', 'Ciao! Come stai oggi? Penso che sia una bella giornata.', 'it-IT'],
    [
        'conversation',
        'Hi there! Honestly, I think today was lovely. Maybe we could walk by the sea later? ' +
            'You always find the best places, and everything feels calmer with you.',
        'en-US',
    ],
];

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(HERE, 'runs', stamp);
const SHOTS = path.join(OUT, 'shots');

/** Installed in the page: framing, her body check, holding a gesture still, speaking. */
function pageHelpers() {
    const BC = window.NEXUS_GESTURE_BODY_CHECK;
    const SG = window.NEXUS_SPEECH_GESTURES;
    const V = () => window.NEXUS_VIEWER;
    const vrm = () => V().avatarManager._currentVRM;
    const T = () => window.THREE;
    const W = (bone) => {
        const node = vrm().humanoid.getRawBoneNode(bone);
        if (!node) return null;
        const v = node.getWorldPosition(new (T().Vector3)());
        return { x: v.x, y: v.y, z: v.z };
    };
    const body = () => {
        vrm().scene.updateMatrixWorld(true);
        return BC.frame({
            hips: W('hips'),
            leftUpperLeg: W('leftUpperLeg'),
            rightUpperLeg: W('rightUpperLeg'),
            leftUpperArm: W('leftUpperArm'),
            rightUpperArm: W('rightUpperArm'),
            chest: W('upperChest') || W('chest'),
            neck: W('neck'),
            head: W('head'),
        });
    };
    window.__ga = {
        frame() {
            // Waist up, from her front and a little to one side. Her facing comes from her hips:
            // VRM 0.x and 1.0 face opposite ways in their own frames.
            const v = V();
            const p = v.avatarManager.currentRoot.getWorldPosition(new (T().Vector3)());
            const r = W('rightUpperLeg');
            const l = W('leftUpperLeg');
            const right = new (T().Vector3)(r.x - l.x, 0, r.z - l.z).normalize();
            const fwd = new (T().Vector3)(0, 1, 0).cross(right).normalize();
            const dir = fwd.clone().multiplyScalar(0.92).add(right.clone().multiplyScalar(-0.38)).normalize();
            const chestY = (W('head').y + W('hips').y) / 2;
            v.camera.position.set(p.x + dir.x * 1.9, chestY + 0.08, p.z + dir.z * 1.9);
            v.controls.target.set(p.x, chestY, p.z);
            v.controls.update();
        },
        hands() {
            vrm().scene.updateMatrixWorld(true);
            return { right: W('rightHand'), left: W('leftHand') };
        },
        /** Her body check for the hands that gesture, and the other hand's place too. */
        check(id, side) {
            const f = body();
            const sides = side === 'both' ? ['right', 'left'] : [side];
            const out = {};
            for (const s of ['right', 'left']) {
                const m = BC.measure(
                    f,
                    s,
                    { hand: W(s + 'Hand'), elbow: W(s + 'LowerArm') },
                    sides.includes(s) ? id : null
                );
                out[s] = {
                    gesturing: sides.includes(s),
                    flags: sides.includes(s)
                        ? BC.verdict(m)
                        : BC.verdict(m).filter((x) => x !== 'missed-target' && x !== 'crosses-body'),
                    toTargetCm: m.toTargetCm == null ? null : +m.toTargetCm.toFixed(1),
                    crossCm: +m.crossCm.toFixed(1),
                };
            }
            return out;
        },
        quiet() {
            this.release();
            try {
                window.NEXUS_LIP_SYNC.stop();
            } catch (_) {
                /* nothing was speaking */
            }
            try {
                window.NEXUS_BEHAVIOR?.onSpeechEnd?.();
            } catch (_) {
                /* no behaviour engine */
            }
            window.NEXUS_PROCEDURAL_ANIMATOR.setMode('talk', 120000);
        },
        speak(text, lang) {
            window.NEXUS_PROCEDURAL_ANIMATOR.setMode('talk', 120000);
            const settings = window.SpeechSettings || (window.SpeechSettings = {});
            this.lang = settings.lang;
            settings.lang = lang || 'en-US';
            this.t0 = performance.now() / 1000;
            window.NEXUS_LIP_SYNC.start(text, 1);
            settings.lang = this.lang;
            return SG.plan(text, { lang: lang || 'en-US' }).map((g) => ({
                ...g,
                peak: g.at + SG.GESTURES[g.id].prep + SG.GESTURES[g.id].hold / 2,
            }));
        },
        /**
         * Tell the app she is speaking, as a real reply does. Holding a gesture still involves no
         * audio, so BehaviorEngine saw silence and, a few seconds in, moved the animator to its idle
         * "waiting" mode, where gestures (talk mode only) correctly step aside: the first left-hand
         * beat of a run measured 1 cm for that reason, not because of its pose.
         */
        speaking() {
            try {
                window.NEXUS_BEHAVIOR?.onSpeechStart?.();
            } catch (_) {
                /* no behaviour engine: talk mode below is enough */
            }
            window.NEXUS_PROCEDURAL_ANIMATOR.setMode('talk', 120000);
        },
        /** Hold one gesture at its peak on a chosen hand: what the layer receives, nothing else. */
        hold(id, side) {
            this.speaking();
            const pose = SG.GESTURES[id].pose;
            const offsets =
                side === 'left' ? SG.mirror(pose) : side === 'both' ? { ...pose, ...SG.mirror(pose) } : pose;
            if (!this.orig) this.orig = SG.sample;
            SG.sample = () => offsets;
        },
        /** Hold a reply's own planned gestures still at `offsetSec` into it. */
        freeze(offsetSec) {
            this.speaking();
            if (!this.orig) this.orig = SG.sample;
            const at = this.t0 + offsetSec;
            SG.sample = () => this.orig.call(SG, at);
        },
        release() {
            if (this.orig) SG.sample = this.orig;
            this.orig = null;
        },
    };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 100;

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

/** Wait (up to 15 s) until no clip owns her arms; answer the clip that was playing, if any. */
async function clipIdle(page) {
    const playing = () => {
        const st = window.NEXUS_CLIP_LOADER?.getCurrentPlaybackState?.();
        return st && st.isPlaying
            ? String(st.clip || 'clip')
                  .split('/')
                  .pop()
            : null;
    };
    const was = await page.evaluate(playing);
    if (was) {
        await page
            .waitForFunction(() => !window.NEXUS_CLIP_LOADER?.getCurrentPlaybackState?.()?.isPlaying, null, {
                timeout: 15000,
            })
            .catch(() => null);
    }
    return was;
}

function judge(flags, moved) {
    const all = [...flags];
    if (moved != null && moved < 2) all.push('no-visible-motion');
    const fail = all.some((f) => f !== 'subtle' && !f.startsWith('clip-was-playing'));
    if (!fail && moved != null && moved < MIN_MOVE_CM) all.push('subtle');
    return { verdict: fail ? 'fail' : all.length ? 'warn' : 'ok', flags: all };
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
    await page.addScriptTag({ path: path.join(ROOT, 'tools/qa/GestureBodyCheck.js') });
    await page.waitForTimeout(2500);
    await page.evaluate(pageHelpers);
    await page.evaluate(() => window.__ga.frame());
    const rows = [];
    let n = 0;

    // 1. Every gesture, held at its peak on each hand.
    for (const [id, text] of STAGES.has('gestures') ? CASES : []) {
        await page.evaluate(() => window.__ga.quiet());
        await page.waitForTimeout(1500);
        const rest = await page.evaluate(() => window.__ga.hands());
        // The planner still picks this gesture for its sentence (a guard on the word tables).
        const planned = await page.evaluate((t) => window.__ga.speak(t, 'en-US'), text);
        await page.evaluate(() => window.__ga.quiet());
        const two = await page.evaluate((g) => Boolean(window.NEXUS_SPEECH_GESTURES.GESTURES[g].both), id);
        for (const side of two ? ['both'] : ['right', 'left']) {
            n += 1;
            const tag = `${avatar}-${String(n).padStart(2, '0')}-${id}-${side}`;
            // The layer steps aside while a clip owns her arms (SG3), and the behaviour engine can
            // start an idle flourish at any moment: wait for none, and say so if one was playing.
            const clipWas = await clipIdle(page);
            await page.evaluate(([g, s]) => window.__ga.hold(g, s), [id, side]);
            await page.waitForTimeout(1200); // several rendered frames of the held peak
            const at = await page.evaluate(() => window.__ga.hands());
            const check = await page.evaluate(([g, s]) => window.__ga.check(g, s), [id, side]);
            const clipDuring = await page.evaluate(() => {
                const st = window.NEXUS_CLIP_LOADER?.getCurrentPlaybackState?.();
                return st && st.isPlaying
                    ? String(st.clip || 'clip')
                          .split('/')
                          .pop()
                    : null;
            });
            const peakShot = await shot(page, `${tag}.jpg`);
            await page.evaluate(() => window.__ga.release());
            await page.waitForTimeout(1200);
            const after = await page.evaluate(() => window.__ga.hands());
            const moved = Math.max(
                side !== 'left' ? dist(at.right, rest.right) : 0,
                side !== 'right' ? dist(at.left, rest.left) : 0
            );
            const returned = Math.max(dist(after.right, rest.right), dist(after.left, rest.left));
            const flags = [...new Set([...check.right.flags, ...check.left.flags])];
            if (!planned.length || planned[0].id !== id)
                flags.push(`planned-${planned[0] ? planned[0].id : 'nothing'}`);
            if (returned > RETURN_CM) flags.push('did-not-return');
            if (clipWas) flags.push(`clip-was-playing:${clipWas}`);
            if (clipDuring) flags.push(`clip-playing-during-hold:${clipDuring}`);
            const { verdict, flags: all } = judge(flags, moved);
            const gest = check[side === 'left' ? 'left' : 'right'];
            rows.push({
                avatar,
                kind: 'gesture',
                name: `${id} (${side})`,
                text,
                verdict,
                flags: all,
                handMoveCm: +moved.toFixed(1),
                toTargetCm: gest.toTargetCm,
                returnedWithinCm: +returned.toFixed(2),
                shots: [peakShot],
            });
            console.log(
                `${verdict.padEnd(4)} ${avatar} ${`${id} (${side})`.padEnd(20)} moved ${moved.toFixed(1)} cm ${all.join(',')}`
            );
        }
    }

    // 2. Whole replies: each planned gesture held at its peak, with the planner's own hand and size.
    const replies = [];
    for (const [name, text, lang] of STAGES.has('replies') ? REPLIES : []) {
        await page.evaluate(() => window.__ga.quiet());
        await page.waitForTimeout(1500);
        const plan = await page.evaluate(([t, l]) => window.__ga.speak(t, l), [text, lang]);
        const items = [];
        for (const [i, g] of plan.entries()) {
            await page.evaluate((t) => window.__ga.freeze(t), g.peak);
            await page.waitForTimeout(1000);
            const check = await page.evaluate(([id, s]) => window.__ga.check(id, s), [g.id, g.side]);
            const flags = [...new Set([...check.right.flags, ...check.left.flags])];
            const { verdict } = judge(flags, null);
            const s = await shot(page, `${avatar}-reply-${name}-${i}.jpg`);
            items.push({ at: +g.at.toFixed(2), id: g.id, side: g.side, verdict, flags, shot: s });
            rows.push({
                avatar,
                kind: 'reply',
                name: `${name}: ${g.id} (${g.side}) at ${g.at.toFixed(2)} s`,
                text,
                verdict,
                flags,
                shots: [s],
            });
            console.log(
                `${verdict.padEnd(4)} ${avatar} reply ${name.padEnd(13)} ${g.id} (${g.side}) ${flags.join(',')}`
            );
        }
        await page.evaluate(() => window.__ga.quiet());
        const budgets = await page.evaluate(
            ([t, l]) =>
                Object.fromEntries(
                    ['desktop', 'mobile', 'vr'].map((p) => [
                        p,
                        window.NEXUS_SPEECH_GESTURES.plan(t, { profile: p, lang: l }).length,
                    ])
                ),
            [text, lang]
        );
        replies.push({ name, text, lang, items, budgets });
    }
    // 3. Everyday positions in combination (SG6), each step held and measured, then spoken in.
    if (STAGES.has('positions')) rows.push(...(await positionsStage(page, avatar)));
    await page.context().close();
    return { avatar, errors, rows, replies };
}

/**
 * SG6. Everyday positions, in combination: the body doing what was asked, upright, balanced and
 * grounded, and her hands out of her body while she talks in each one.
 *
 * Asked the way a person asks — `NEXUS_MOTION.onUserUtterance`, the entry typed chat, the mic and
 * VR voice share — in a fresh page where Private is off. Private's own positions are not audited
 * here. Each step is held a few seconds, then measured in her own frame:
 *
 *   posture   hips height against her standing height: stand ~1, sit ~0.6, lie ~0.15
 *   upright   the tilt of her spine (hips → neck) from vertical; standing and sitting stay near 0°
 *   balance   standing only: how far her hips are from the point between her feet, as a share of
 *             her leg length — the lean a phone showed after "stand up"
 *   grounded  her lowest foot against the floor she started on
 *   facing    after "turn around" her back is to the camera; after "face me" her front is
 *   speaking  a reply started in that position: both hands checked against her torso while it plays
 */
const POSITION_COMBOS = [
    ['sit and stand', ['sit down', 'stand up']],
    ['lie and stand', ['lie down', 'stand up']],
    ['sit, lie, sit, stand', ['sit down', 'lie down', 'sit down', 'stand up']],
    ['turn around and back', ['turn around', 'face me']],
    ['turn, sit, stand', ['turn around', 'sit down', 'stand up', 'face me']],
];
const EXPECT = {
    'sit down': { posture: 'sit' },
    'lie down': { posture: 'lie' },
    'stand up': { posture: 'stand' },
    'turn around': { posture: 'stand', facing: 'away' },
    'face me': { posture: 'stand', facing: 'toward' },
};
const LIMITS = { uprightDeg: 15, balance: 0.15, floatCm: 6, sinkCm: 6 };

function positionHelpers() {
    const T = () => window.THREE;
    const vrm = () => window.NEXUS_VIEWER.avatarManager._currentVRM;
    const W = (b) => {
        const n = vrm().humanoid.getRawBoneNode(b);
        if (!n) return null;
        const v = n.getWorldPosition(new (T().Vector3)());
        return { x: v.x, y: v.y, z: v.z };
    };
    window.__pos = {
        sample() {
            vrm().scene.updateMatrixWorld(true);
            const hips = W('hips');
            const neck = W('neck') || W('head');
            const lf = W('leftFoot');
            const rf = W('rightFoot');
            const lul = W('leftUpperLeg');
            const rul = W('rightUpperLeg');
            const cam = window.NEXUS_VIEWER.camera.position;
            // Her facing, from her legs (as the audits frame her): up × right = (r.z, 0, -r.x).
            const r = { x: rul.x - lul.x, z: rul.z - lul.z };
            const fwd = { x: r.z, z: -r.x };
            const fl = Math.hypot(fwd.x, fwd.z) || 1;
            const toCam = { x: cam.x - hips.x, z: cam.z - hips.z };
            const tl = Math.hypot(toCam.x, toCam.z) || 1;
            const spine = { x: neck.x - hips.x, y: neck.y - hips.y, z: neck.z - hips.z };
            const sl = Math.hypot(spine.x, spine.y, spine.z) || 1;
            const between = { x: (lf.x + rf.x) / 2, z: (lf.z + rf.z) / 2 };
            const legLen = Math.abs(lul.y - Math.min(lf.y, rf.y)) || 0.8;
            return {
                hipsY: hips.y,
                footY: Math.min(lf.y, rf.y),
                uprightDeg: (Math.acos(Math.max(-1, Math.min(1, spine.y / sl))) * 180) / Math.PI,
                balance: Math.hypot(hips.x - between.x, hips.z - between.z) / legLen,
                facingCam: (fwd.x * toCam.x + fwd.z * toCam.z) / (fl * tl),
            };
        },
        /** Frame her whole body wherever it is: standing, seated or lying on the floor. */
        frame() {
            const v = window.NEXUS_VIEWER;
            vrm().scene.updateMatrixWorld(true);
            const pts = ['head', 'hips', 'leftFoot', 'rightFoot', 'leftHand', 'rightHand'].map(W).filter(Boolean);
            const lo = (k) => Math.min(...pts.map((p) => p[k]));
            const hi = (k) => Math.max(...pts.map((p) => p[k]));
            const c = { x: (lo('x') + hi('x')) / 2, y: (lo('y') + hi('y')) / 2, z: (lo('z') + hi('z')) / 2 };
            const size = Math.max(hi('y') - lo('y'), hi('x') - lo('x'), hi('z') - lo('z'), 0.6);
            // From the camera's current side, a little above, far enough for her whole body.
            const dir = new (T().Vector3)(v.camera.position.x - c.x, 0, v.camera.position.z - c.z).normalize();
            const dist = size * 1.6 + 0.6;
            v.camera.position.set(c.x + dir.x * dist, c.y + size * 0.35 + 0.2, c.z + dir.z * dist);
            v.controls.target.set(c.x, c.y, c.z);
            v.controls.update();
        },
        clip() {
            const st = window.NEXUS_CLIP_LOADER?.getCurrentPlaybackState?.();
            return st && st.isPlaying
                ? String(st.clip || '')
                      .split('/')
                      .pop()
                : null;
        },
        hands() {
            const BC = window.NEXUS_GESTURE_BODY_CHECK;
            vrm().scene.updateMatrixWorld(true);
            const f = BC.frame({
                hips: W('hips'),
                leftUpperLeg: W('leftUpperLeg'),
                rightUpperLeg: W('rightUpperLeg'),
                leftUpperArm: W('leftUpperArm'),
                rightUpperArm: W('rightUpperArm'),
                chest: W('upperChest') || W('chest'),
                neck: W('neck'),
                head: W('head'),
            });
            const out = [];
            for (const s of ['right', 'left']) {
                const m = BC.measure(f, s, { hand: W(s + 'Hand'), elbow: W(s + 'LowerArm') }, null);
                if (m.handInside > 0) out.push(`${s}-hand-inside-body`);
                if (m.forearmInside > 0) out.push(`${s}-forearm-inside-body`);
            }
            return out;
        },
        stop() {
            try {
                window.NEXUS_MOTION.execute({ commands: [{ type: 'stop' }] });
            } catch (_) {
                /* nothing to stop */
            }
        },
    };
}

async function positionsStage(page, avatar) {
    await page.evaluate(positionHelpers);
    const rows = [];
    let n = 0;
    for (const [combo, steps] of POSITION_COMBOS) {
        // Each combination starts from her standing, facing the camera.
        await page.evaluate(() => {
            window.__ga.quiet();
            window.__pos.stop();
        });
        await page.waitForTimeout(3000);
        await page.evaluate(() => window.NEXUS_MOTION.onUserUtterance('face me'));
        await page.waitForTimeout(2500);
        await page.evaluate(() => window.__ga.frame());
        const base = await page.evaluate(() => window.__pos.sample());
        for (const said of steps) {
            n += 1;
            await page.evaluate((t) => window.NEXUS_MOTION.onUserUtterance(t), said);
            await page.waitForTimeout(5000); // a posture clip loads, plays its transition, settles
            const m = await page.evaluate(() => window.__pos.sample());
            const clip = await page.evaluate(() => window.__pos.clip());
            const state = await page.evaluate(() => ({
                sitting: Boolean(window.NEXUS_MOTION.state?.sitting),
                laying: Boolean(window.NEXUS_MOTION.state?.laying),
                exec: window.NEXUS_MOTION.state?.execution
                    ? `${window.NEXUS_MOTION.state.execution.action}:${window.NEXUS_MOTION.state.execution.status}`
                    : null,
            }));
            const want = EXPECT[said];
            const ratio = m.hipsY / base.hipsY;
            const posture = ratio > 0.85 ? 'stand' : ratio > 0.35 ? 'sit' : 'lie';
            const flags = [];
            if (want.posture !== posture) flags.push(`posture-${posture}-not-${want.posture}`);
            if (want.posture === 'sit' && !state.sitting) flags.push('not-sitting-state');
            if (want.posture === 'lie' && !state.laying) flags.push('not-laying-state');
            if (want.posture !== 'lie' && m.uprightDeg > LIMITS.uprightDeg)
                flags.push(`tilted-${m.uprightDeg.toFixed(0)}deg`);
            if (want.posture === 'stand' && m.balance > LIMITS.balance)
                flags.push(`off-balance-${m.balance.toFixed(2)}`);
            const floorCm = (m.footY - base.footY) * 100;
            if (want.posture === 'stand' && floorCm > LIMITS.floatCm) flags.push(`floating-${floorCm.toFixed(0)}cm`);
            if (floorCm < -LIMITS.sinkCm) flags.push(`sunk-${(-floorCm).toFixed(0)}cm`);
            if (want.facing === 'away' && m.facingCam > -0.3) flags.push('not-turned-away');
            if (want.facing === 'toward' && m.facingCam < 0.3) flags.push('not-facing');
            // Talking in this position: both hands out of her body while the reply plays.
            const before = await page.evaluate(() => window.__pos.hands());
            await page.evaluate(() => window.__ga.speak('Honestly, I think this is nice. Maybe you agree?', 'en-US'));
            let during = [];
            for (let k = 0; k < 4; k += 1) {
                await page.waitForTimeout(700);
                during = during.concat(await page.evaluate(() => window.__pos.hands()));
            }
            await page.evaluate(() => window.NEXUS_LIP_SYNC.stop());
            flags.push(...new Set([...before, ...during].map((f) => `speaking:${f}`)));
            await page.evaluate(() => window.__pos.frame());
            await page.waitForTimeout(400);
            const shotFile = await shot(
                page,
                `${avatar}-pos-${String(n).padStart(2, '0')}-${said.replace(/\s+/g, '-')}.jpg`
            );
            const verdict = flags.length ? 'fail' : 'ok';
            rows.push({
                avatar,
                kind: 'position',
                name: `${combo}: "${said}"`,
                text: said,
                verdict,
                flags,
                posture,
                hipsRatio: +ratio.toFixed(2),
                uprightDeg: +m.uprightDeg.toFixed(1),
                balance: +m.balance.toFixed(2),
                floorCm: +floorCm.toFixed(1),
                facing: +m.facingCam.toFixed(2),
                state: state.exec,
                clip,
                shots: [shotFile],
            });
            console.log(
                `${verdict.padEnd(4)} ${avatar} pos ${`${combo}: "${said}"`.padEnd(40)} ${posture} hips ${ratio.toFixed(2)} tilt ${m.uprightDeg.toFixed(0)}° bal ${m.balance.toFixed(2)} ${flags.join(',')}`
            );
        }
    }
    return rows;
}

function writeReport(report) {
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
    const md = [
        `# Gesture audit ${stamp}`,
        '',
        `${report.ok ? 'PASS' : 'FAIL'} — ${report.summary.ok} ok · ${report.summary.warn} warn · ${report.summary.fail} fail`,
        '',
        'ok = moved enough, reached its target, stayed out of her body and on its own side, back at rest after. ' +
            'Look at index.html before trusting a number.',
        '',
    ];
    for (const a of report.avatars) {
        md.push(
            `## ${a.avatar}`,
            '',
            a.errors.length ? `Page errors: ${a.errors.join(' | ')}` : 'Page errors: none',
            ''
        );
        md.push('| check | sentence | verdict | moved (cm) | to target (cm) | back within (cm) | flags |');
        md.push('|---|---|---|---|---|---|---|');
        for (const r of a.rows.filter((x) => x.kind !== 'position')) {
            md.push(
                `| ${r.name} | ${r.text} | **${r.verdict}** | ${r.handMoveCm ?? '—'} | ${r.toTargetCm ?? '—'} | ${r.returnedWithinCm ?? '—'} | ${r.flags.join(', ') || '—'} |`
            );
        }
        const positions = a.rows.filter((x) => x.kind === 'position');
        if (positions.length) {
            md.push(
                '',
                '### Positions (SG6)',
                '',
                '| step | verdict | posture | hips / standing | spine tilt (°) | balance | feet vs floor (cm) | facing camera | motion state | clip | flags |',
                '|---|---|---|---|---|---|---|---|---|---|---|'
            );
            for (const r of positions) {
                md.push(
                    `| ${r.name} | **${r.verdict}** | ${r.posture} | ${r.hipsRatio} | ${r.uprightDeg} | ${r.balance} | ${r.floorCm} | ${r.facing} | ${r.state || '—'} | ${r.clip || '—'} | ${r.flags.join(', ') || '—'} |`
                );
            }
        }
        md.push('');
        for (const r of a.replies) {
            md.push(
                `**${r.name}** (${r.lang}): "${r.text}" — gestures by device: desktop ${r.budgets.desktop}, phone ${r.budgets.mobile}, VR ${r.budgets.vr}.`,
                ''
            );
        }
    }
    fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n') + '\n');
    const img = (s, label) => `<figure><img src="${s}" loading="lazy"><figcaption>${label}</figcaption></figure>`;
    const html = [
        '<!doctype html><meta charset="utf-8"><title>Gesture audit</title>',
        '<style>body{font:14px system-ui;background:#151317;color:#eee;margin:16px}figure{display:inline-block;margin:4px}img{width:220px;display:block;border-radius:6px}.ok{color:#8fd6a0}.warn{color:#e8c46e}.fail{color:#ef8b80}</style>',
        `<h1>Gesture audit ${stamp}</h1>`,
    ];
    for (const a of report.avatars) {
        html.push(`<h2>${a.avatar}</h2><div>`);
        for (const r of a.rows)
            html.push(
                img(r.shots[0], `<span class="${r.verdict}">${r.name} — ${r.verdict}</span> ${r.flags.join(', ')}`)
            );
        html.push('</div>');
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
