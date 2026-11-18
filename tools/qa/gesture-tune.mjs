#!/usr/bin/env node
/**
 * SG5. Gesture tuner: find each co-speech gesture's arm angles from where the hand must end up.
 *
 *   node tools/qa/gesture-tune.mjs                      # three avatars, every gesture
 *   node tools/qa/gesture-tune.mjs --avatars AvatarSample_A,Vita --only wave,chinTouch
 *
 * The first poses were written by hand from the talk presets' axis conventions, and the gesture
 * audit showed four of them stopping low in front of her (a "wave" 29 cm below her shoulder), while
 * a phone showed a hand crossing her front into her cardigan. Guessing angles again would repeat
 * that. This searches them instead, against the same body check the audit uses
 * (tools/qa/GestureBodyCheck.js): reach the gesture's target, never put a hand or forearm inside
 * her torso, never cross her midline, and prefer the smallest rotation that does it.
 *
 * Each candidate is applied to her bones in the live page and measured by forward kinematics —
 * no frame is rendered — then the bones are put back exactly. Both hands are scored together
 * (the left is SpeechGestures.mirror of the right), so a pose that is right on one side and
 * through her body on the other is never chosen. Thousands of candidates take seconds.
 *
 * Several avatars at once: one set of angles has to suit them all, and tuned on one body alone a
 * palm reached its mark on AvatarSample_A and stopped 8.6 cm short on VRM_Viewer_Sample. Each
 * candidate is scored on every avatar's page and the costs are added.
 *
 * Prints the tuned `pose` for each gesture and the measurements before and after, and writes them
 * to tools/qa/gesture-tune.out.json (git-ignored). Copying them into SpeechGestures.GESTURES is a
 * deliberate, reviewed step: run the gesture audit afterwards and look at the frames.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const arg = (f, d) => (argv.includes(f) && argv[argv.indexOf(f) + 1] ? argv[argv.indexOf(f) + 1] : d);
const AVATARS = arg('--avatars', 'AvatarSample_A,Vita,VRM_Viewer_Sample')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const ONLY = arg('--only', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** In the page: score a pose on both hands, and search for the best one. */
function tunerInPage() {
    const BC = window.NEXUS_GESTURE_BODY_CHECK;
    const SG = window.NEXUS_SPEECH_GESTURES;
    const T = window.THREE;
    const vrm = window.NEXUS_VIEWER.avatarManager._currentVRM;
    const raw = (b) => vrm.humanoid.getRawBoneNode(b);
    const W = (b) => {
        const n = raw(b);
        if (!n) return null;
        const v = n.getWorldPosition(new T.Vector3());
        return { x: v.x, y: v.y, z: v.z };
    };
    vrm.scene.updateMatrixWorld(true);
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
    const e = new T.Euler();
    const q = new T.Quaternion();

    /** Apply, measure both hands, put back. */
    function score(id, pose, both) {
        let total = 0;
        const out = {};
        for (const side of ['right', 'left']) {
            // A two-handed gesture moves both arms at once; a one-handed one is scored on each hand.
            const applied = both ? { ...pose, ...SG.mirror(pose) } : side === 'left' ? SG.mirror(pose) : pose;
            const saved = [];
            for (const [b, v] of Object.entries(applied)) {
                const n = raw(b);
                if (!n) continue;
                saved.push([n, n.quaternion.clone()]);
                q.setFromEuler(e.set(v[0], v[1], v[2]));
                n.quaternion.multiply(q);
            }
            vrm.scene.updateMatrixWorld(true);
            const m = BC.measure(f, side, { hand: W(side + 'Hand'), elbow: W(side + 'LowerArm') }, id);
            for (const [n, qq] of saved) n.quaternion.copy(qq);
            vrm.scene.updateMatrixWorld(true);
            out[side] = m;
            let effort = 0;
            for (const v of Object.values(pose)) effort += v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
            total += BC.cost(m, effort);
        }
        return { total, out };
    }

    window.__score = (id, poses) => {
        const both = Boolean(SG.GESTURES[id].both);
        return poses.map((pose) => score(id, pose, both).total);
    };
    window.__detail = (id, pose) => {
        const r = score(id, pose, Boolean(SG.GESTURES[id].both));
        return Object.fromEntries(
            Object.entries(r.out).map(([side, m]) => [
                side,
                {
                    toTargetCm: m.toTargetCm == null ? null : +m.toTargetCm.toFixed(1),
                    crossCm: +m.crossCm.toFixed(1),
                    inside: +(m.handInside + m.forearmInside).toFixed(3),
                    flags: BC.verdict(m),
                },
            ])
        );
    };
}

const LO = [-2.2, -1.2, -2.2, -2.6, -0.8, -0.7];
const HI = [2.2, 1.2, 2.2, 2.6, 0.8, 0.7];
let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
const round = (v) => Math.round(v * 100) / 100;

/** The searched angles: upper arm (x, y, z), elbow (y, z), wrist (x). Other bones kept as authored. */
function poseFrom(base, p) {
    return { ...base, rightUpperArm: [p[0], p[1], p[2]], rightLowerArm: [0, p[3], p[4]], rightHand: [p[5], 0, 0] };
}

/** The summed cost of each pose over every avatar's page. */
async function costs(pages, id, poses) {
    const per = await Promise.all(pages.map((page) => page.evaluate(([g, ps]) => window.__score(g, ps), [id, poses])));
    return poses.map((_, i) => per.reduce((sum, list) => sum + list[i], 0));
}

async function detail(pages, id, pose) {
    const out = {};
    for (const [i, page] of pages.entries())
        out[AVATARS[i]] = await page.evaluate(([g, p]) => window.__detail(g, p), [id, pose]);
    return out;
}

async function tune(pages, id, g) {
    const base = Object.fromEntries(Object.entries(g.pose).filter(([b]) => !/^right(UpperArm|LowerArm|Hand)$/.test(b)));
    const start = [
        ...(g.pose.rightUpperArm || [0, 0, 0]),
        ...(g.pose.rightLowerArm || [0, 0, 0]).slice(1),
        (g.pose.rightHand || [0])[0],
    ];
    const [startCost] = await costs(pages, id, [g.pose]);
    let best = { p: start, c: startCost };
    for (let batch = 0; batch < 12; batch += 1) {
        const ps = Array.from({ length: 250 }, () => LO.map((lo, k) => lo + rand() * (HI[k] - lo)));
        const cs = await costs(
            pages,
            id,
            ps.map((p) => poseFrom(base, p))
        );
        cs.forEach((c, i) => {
            if (c < best.c) best = { p: ps[i], c };
        });
    }
    let step = 0.3;
    for (let batch = 0; batch < 12; batch += 1, step = Math.max(0.01, step * 0.7)) {
        const ps = Array.from({ length: 120 }, () =>
            best.p.map((v, k) => Math.min(HI[k], Math.max(LO[k], v + (rand() * 2 - 1) * step)))
        );
        const cs = await costs(
            pages,
            id,
            ps.map((p) => poseFrom(base, p))
        );
        cs.forEach((c, i) => {
            if (c < best.c) best = { p: ps[i], c };
        });
    }
    const pose = poseFrom(base, best.p.map(round));
    const [cost] = await costs(pages, id, [pose]);
    return {
        id,
        pose,
        cost: +cost.toFixed(2),
        before: await detail(pages, id, g.pose),
        after: await detail(pages, id, pose),
    };
}

async function openAvatar(D, browser, base, avatar) {
    const page = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
    page.setDefaultTimeout(180000);
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await D.waitForApp(page, 180000);
    await page.waitForFunction(
        () =>
            window.NEXUS_SPEECH_GESTURES &&
            window.NEXUS_PROCEDURAL_ANIMATOR &&
            window.NEXUS_VIEWER?.avatarManager?._currentVRM
    );
    if (avatar !== 'AvatarSample_A') {
        await page.evaluate((u) => window.NEXUS_VIEWER.loadAvatar(u), `/vendor/avatars/${avatar}.vrm`);
        await page.waitForFunction(
            (n) => (window.NEXUS_VIEWER.avatarManager.currentRoot?.name || '').endsWith(n),
            `${avatar}.vrm`
        );
    }
    await page.addScriptTag({ path: path.join(HERE, 'GestureBodyCheck.js') });
    // Her talking stance with no gesture on (what every gesture is added to), held as speech.
    await page.evaluate(() => {
        try {
            window.NEXUS_LIP_SYNC.stop();
        } catch (_) {
            /* not speaking */
        }
        try {
            window.NEXUS_BEHAVIOR?.onSpeechStart?.();
        } catch (_) {
            /* no behaviour engine */
        }
        window.NEXUS_PROCEDURAL_ANIMATOR.setMode('talk', 600000);
    });
    await page.waitForTimeout(2500);
    await page.evaluate(tunerInPage);
    return page;
}

async function main() {
    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const { playwright, why } = D.loadPlaywright();
    if (!playwright) {
        console.error(why);
        process.exit(2);
    }
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:8080');
    const browser = await playwright.chromium.launch({ args: D.SWIFTSHADER });
    const results = [];
    try {
        const pages = [];
        for (const avatar of AVATARS) pages.push(await openAvatar(D, browser, server.base, avatar));
        const ids = ONLY.length
            ? ONLY
            : await pages[0].evaluate(() => Object.keys(window.NEXUS_SPEECH_GESTURES.GESTURES));
        const gestures = await pages[0].evaluate(() => window.NEXUS_SPEECH_GESTURES.GESTURES);
        for (const id of ids) {
            const r = await tune(pages, id, gestures[id]);
            results.push(r);
            const flags = (o) =>
                Object.entries(o)
                    .map(
                        ([who, d]) =>
                            `${who} ` +
                            Object.entries(d)
                                .map(([s, m]) => `${s}:${m.flags.join('+') || 'ok'}(${m.toTargetCm ?? '-'}cm)`)
                                .join(' ')
                    )
                    .join(' | ');
            console.log(`${id.padEnd(12)} before ${flags(r.before)}\n${''.padEnd(12)} after  ${flags(r.after)}`);
        }
    } finally {
        await browser.close();
        if (server.stop) server.stop();
    }
    const out = path.join(HERE, 'gesture-tune.out.json');
    fs.writeFileSync(out, JSON.stringify({ avatars: AVATARS, results }, null, 1));
    console.log(`\nposes: ${path.relative(ROOT, out)}`);
}

main().catch((e) => {
    console.error('gesture tuner crashed:', e && e.stack ? e.stack : e);
    process.exit(2);
});
