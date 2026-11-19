#!/usr/bin/env node
/**
 * EA1. An evening, stage by stage, on the real avatar in the real room: a screenshot of every
 * step of one of her shows — the room, each position, each danced step, each change of clothes —
 * with what she would say there, measured so a reviewer can see at a glance that it happened.
 *
 *   node tools/qa/evening-stages.mjs [--show window-evening] [--room window-room]
 *        [--persona gina] [--lang it] [--vrm vendor/avatars/AvatarSample_A.vrm]
 *        [--looks a.vrm,b.vrm,…] [--out dir]
 *
 * Why it exists: the unit tests prove the session *asks* for a position, a clip or an undress; they
 * cannot see whether her body took the pose, whether the clip played, or whether the dress really
 * came off. This plays the show's own steps (PrivateRoutines) through the same page modules Private
 * uses — her positions through Pose Studio's presets, the danced steps through the clip loader, the
 * room through the `intimate` world request — and checks each stage from the rendered skeleton and
 * the loaded avatar, not from what was asked:
 *
 *   moved      the largest bone rotation change from the stage before, in degrees (a position or a
 *              clip that did nothing shows ~0)
 *   lookChanged the avatar on stage is a different VRM after an undress cue (bytes swapped)
 *   world      the room the renderer reports is the one asked for
 *
 * Clothes: an undress cue loads the next file of `--looks` (paths under the repo), in order. Forge's
 * private looks (lingerie, bare) are not in the repo; point `--looks` at ones you downloaded (or at
 * Forge's detail previews in audits/poses/runs/) to audit a real undress. Without `--looks`, the
 * avatar's shipped looks in vendor/wardrobe/ stand in, which proves the swap, not the undress — the
 * report says which it was.
 *
 * Writes `report.json`, one PNG per stage and `index.html` (the contact sheet) under
 * `audits/poses/runs/` (gitignored). Frames of Private positions are never committed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const SHOW = arg('--show', 'window-evening');
const PERSONA = arg('--persona', '');
const LANG = arg('--lang', 'it');
const VRM = arg('--vrm', 'vendor/avatars/AvatarSample_A.vrm');
const SETTLE_MS = Number(arg('--settle', '2500'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/poses/runs', `${stamp}-evening-${SHOW}`)));

/** The avatar's shipped looks, as stand-ins when no private looks are given. */
function shippedLooks(vrm) {
    const slug = path
        .basename(vrm, '.vrm')
        .toLowerCase()
        .replace(/_/g, '-')
        .replace(/^avatarsample/, 'avatar-sample');
    const dir = path.join(ROOT, 'vendor/wardrobe/looks', slug);
    if (!fs.existsSync(dir)) return [];
    const found = [];
    for (const look of fs.readdirSync(dir)) {
        const versions = fs.readdirSync(path.join(dir, look)).sort();
        const file = path.join(dir, look, versions[versions.length - 1], 'look.vrm');
        if (fs.existsSync(file)) found.push(path.relative(ROOT, file));
    }
    // Dresses first, fitted trousers last: the stand-in on her for the positions is then a fitted
    // one (a maxi dress tents over raised knees and hid a whole knees-up frame).
    return found.sort((a, b) => Number(/dress/.test(b)) - Number(/dress/.test(a)));
}

/**
 * EA2. Underwear for every test (the owner's call, 2026-11-19): jeans and dresses tent and clip in
 * positions and hid what was being judged. Forge's underwear looks for this avatar, downloaded once
 * into audits/poses/runs/looks/<avatar>/ (gitignored, never committed), dress her from the start,
 * and each undress cue changes to the next set. Shipped looks only if no underwear is there.
 */
function underwearLooks(vrm) {
    const dir = path.join(ROOT, 'audits/poses/runs/looks', slugOf(vrm));
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir)
        .filter((f) => /\.vrm$/.test(f))
        .sort()
        .map((f) => path.relative(ROOT, path.join(dir, f)));
}

function slugOf(vrm) {
    return path
        .basename(vrm, '.vrm')
        .toLowerCase()
        .replace(/_/g, '-')
        .replace(/^avatarsample/, 'avatar-sample');
}

const givenLooks = arg('--looks', '').split(',').filter(Boolean);
const underwear = underwearLooks(VRM);
/** What she wears from the start: `--outfit`, else the first underwear set, else her own clothes. */
const OUTFIT = arg('--outfit', underwear[0] || '');
const LOOKS = givenLooks.length
    ? givenLooks
    : underwear.length
      ? [...underwear.slice(1), underwear[0]]
      : shippedLooks(VRM);
const LOOKS_KIND = givenLooks.length
    ? 'given'
    : underwear.length
      ? 'underwear sets'
      : LOOKS.length
        ? 'shipped stand-ins (proves the swap, not the undress)'
        : 'none';
/** EA2. Positions on the floor unless asked: the test judges the pose, not the bed. */
const ON_BED = process.argv.includes('--bed');

async function main() {
    fs.mkdirSync(out, { recursive: true });
    const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
    const { chromium } = createRequire(import.meta.url)('playwright');
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:1');
    const browser = await chromium.launch();
    const errors = [];
    const stages = [];
    try {
        const page = await (await browser.newContext({ viewport: { width: 1800, height: 1000 } })).newPage();
        page.setDefaultTimeout(240000);
        page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
        await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
        await D.waitForApp(page, 240000);
        await page.waitForFunction(
            () =>
                window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM &&
                window.vrPoseSystem &&
                window.NEXUS_PRIVATE_ROUTINES &&
                window.NEXUS_PRIVATE_POSES
        );

        // What the evening is: the show's steps, the room, and her lines in the chosen language.
        const plan = await page.evaluate(
            ({ show, persona, lang, roomArg }) => {
                const R = window.NEXUS_PRIVATE_ROUTINES;
                const L = window.NEXUS_PRIVATE_LOCALE;
                const P = window.NEXUS_PRIVATE_PERSONAS;
                const routine = R.ROUTINES[show];
                if (!routine) return { error: `no show "${show}" (known: ${Object.keys(R.ROUTINES).join(', ')})` };
                const who = persona && P ? P.get(persona) : null;
                const room = roomArg || (who && who.room) || (show === 'window-evening' ? 'window-room' : null);
                const t = (key) => {
                    const v = L && L.t(key, null, lang);
                    return v && v !== key ? v : '';
                };
                return {
                    name: routine.name,
                    level: R.level(show, window.NEXUS_PRIVATE_ACTION_POLICY?.poseLevel),
                    steps: routine.steps.map((s) => ({ ...s })),
                    room,
                    persona: who ? { id: who.id, name: who.name, age: who.age } : null,
                    lines: {
                        opening: who ? t(`persona.${who.id}.opening`) : room ? t(`place.${room}.opening`) : '',
                        deal: t(`place.deal.${show}`),
                        dealOk: who ? t(`persona.${who.id}.deal-ok`) : t('place.deal.ok'),
                        invite: t(`place.invite.${show}`),
                    },
                    presets: Object.fromEntries(
                        routine.steps
                            .filter((s) => s.pose && window.NEXUS_PRIVATE_POSES.POSES[s.pose])
                            .map((s) => [s.pose, window.NEXUS_PRIVATE_POSES.POSES[s.pose].preset])
                    ),
                };
            },
            { show: SHOW, persona: PERSONA, lang: LANG, roomArg: arg('--room', '') }
        );
        if (plan.error) throw new Error(plan.error);

        // Her avatar first, then the room (a world request reframes her).
        // In underwear when there is a set (EA2), else her own clothes.
        await loadVrm(page, OUTFIT || VRM);
        if (plan.room) {
            await page.evaluate((id) => {
                window.dispatchEvent(new CustomEvent('nexus-world-request', { detail: { id, owner: 'intimate' } }));
            }, plan.room);
            await page
                .waitForFunction((id) => window.NEXUS_VIEWER.vrWorlds?.activeId === id, plan.room, { timeout: 120000 })
                .catch(() => {});
            await page.waitForTimeout(2000);
        }

        // Stage 0: the door. Her opening line and the menu, on her standing in the room.
        let before = await skeleton(page);
        stages.push(
            await shoot(
                page,
                0,
                'arrival',
                { said: [plan.lines.opening, plan.lines.deal, plan.lines.dealOk, plan.lines.invite] },
                null,
                plan.room
            )
        );

        let lookIndex = 0;
        for (let i = 0; i < plan.steps.length; i += 1) {
            const step = plan.steps[i];
            const did = {
                kind: step.clip ? 'clip' : step.pose === 'turn' ? 'turn' : 'pose',
                what: step.clip || step.pose,
            };
            // An undress cue changes her clothes as the step begins, like the bridge does.
            if (step.undress) {
                const next = LOOKS[lookIndex];
                lookIndex += 1;
                if (next) {
                    const swapped = await loadVrm(page, next);
                    did.look = { file: next, swapped };
                } else did.look = { file: null, swapped: false, why: 'no look left to change into' };
            }
            const res = await page.evaluate(
                async ({ step, preset, settle, onBed }) => {
                    const vps = window.vrPoseSystem;
                    const v = window.NEXUS_VIEWER;
                    const root = v.avatarManager.currentRoot;
                    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                    const L = window.NEXUS_CLIP_LOADER;
                    try {
                        if (step.clip) {
                            // A danced step lets go of the held position, as the bridge does.
                            vps.releaseBones({ blendSeconds: 0 });
                            window.NEXUS_PROCEDURAL_ANIMATOR?.setPoseMode(false);
                            const played = L ? await L.playClip(step.clip, { loop: true, fadeIn: 0 }) : false;
                            // BS1. Off the bed for a danced step, as in Private.
                            await window.NEXUS_PRIVATE_BED?.sync(window, null, { instant: true });
                            await wait(settle);
                            return { ok: Boolean(played), why: played ? null : 'clip did not play' };
                        }
                        if (L && typeof L.stopClip === 'function') L.stopClip();
                        if (step.pose === 'turn') {
                            root.rotation.y += Math.PI;
                            await wait(settle);
                            return { ok: true };
                        }
                        if (!preset) return { ok: false, why: `no preset for position "${step.pose}"` };
                        window.NEXUS_PROCEDURAL_ANIMATOR?.setPoseMode(true);
                        vps.claimBones();
                        vps.applyPreset(preset, 0.4);
                        const t0 = performance.now();
                        while (vps.isSettling() && performance.now() - t0 < 8000) await wait(100);
                        // BS1. A bed position on the room's bed, as Private does (PrivateBed).
                        const bed = onBed
                            ? await window.NEXUS_PRIVATE_BED?.sync(window, step.pose, { instant: true })
                            : null;
                        await wait(settle);
                        return { ok: true, onBed: Boolean(bed && bed.onBed) };
                    } catch (e) {
                        return { ok: false, why: String(e && e.message ? e.message : e).slice(0, 160) };
                    }
                },
                { step, preset: plan.presets[step.pose] || null, settle: SETTLE_MS, onBed: ON_BED }
            );
            did.ok = res.ok;
            if (res.onBed) did.onBed = true;
            if (res.why) did.why = res.why;
            const after = await skeleton(page);
            did.moved = moved(before, after);
            before = after;
            stages.push(
                await shoot(page, i + 1, step.clip ? 'dance' : step.pose, { body: step.body, said: [] }, did, plan.room)
            );
        }

        const report = {
            show: SHOW,
            name: plan.name,
            level: plan.level,
            room: plan.room,
            persona: plan.persona,
            lang: LANG,
            avatar: VRM,
            outfit: OUTFIT || null,
            bed: ON_BED,
            looks: { kind: LOOKS_KIND, files: LOOKS },
            stages,
            verdict: verdictOf(stages),
            errors,
        };
        fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
        fs.writeFileSync(path.join(out, 'index.html'), sheet(report));
        console.log(`${stages.length} stages → ${path.relative(ROOT, out)}/index.html`);
        console.log(`verdict: ${JSON.stringify(report.verdict)}`);
        if (errors.length) console.log(`page errors: ${errors.length} (in report.json)`);
    } finally {
        await browser.close();
    }
}

/** Load a VRM onto the stage and report whether the avatar on stage really is a different one. */
async function loadVrm(page, file) {
    const url = '/' + file.replace(/^\/+/, '');
    return page.evaluate(async (u) => {
        const v = window.NEXUS_VIEWER;
        const was = v.avatarManager.currentRoot?.uuid;
        await v.loadAvatar(u);
        const t0 = performance.now();
        while (v.avatarManager.currentRoot?.uuid === was && performance.now() - t0 < 30000)
            await new Promise((r) => setTimeout(r, 200));
        await new Promise((r) => setTimeout(r, 2500));
        return v.avatarManager.currentRoot?.uuid !== was;
    }, url);
}

/** Her rendered bones (world quaternions) for the stage-to-stage movement measure. */
async function skeleton(page) {
    return page.evaluate(() => {
        const vrm =
            window.NEXUS_VIEWER.avatarManager._currentVRM || window.NEXUS_VIEWER.avatarManager.vrmLoader?.currentVRM;
        const h = vrm && vrm.humanoid;
        if (!h) return {};
        const names = [
            'hips',
            'spine',
            'chest',
            'neck',
            'head',
            'leftUpperArm',
            'rightUpperArm',
            'leftUpperLeg',
            'rightUpperLeg',
            'leftLowerLeg',
            'rightLowerLeg',
        ];
        const q = new window.THREE.Quaternion();
        const outq = {};
        for (const n of names) {
            const b = h.getNormalizedBoneNode ? h.getNormalizedBoneNode(n) : h.getBoneNode && h.getBoneNode(n);
            if (!b) continue;
            b.getWorldQuaternion(q);
            outq[n] = [q.x, q.y, q.z, q.w];
        }
        return outq;
    });
}

/** The largest bone rotation between two skeletons, in degrees. */
function moved(a, b) {
    let most = 0;
    for (const n of Object.keys(b)) {
        if (!a[n]) continue;
        const dot = Math.abs(a[n].reduce((s, x, i) => s + x * b[n][i], 0));
        most = Math.max(most, (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI);
    }
    return Math.round(most);
}

/** Frame her whole body from her bones (three-quarter view) and save the stage. */
async function shoot(page, index, label, text, did, room) {
    const info = await page.evaluate(() => {
        const v = window.NEXUS_VIEWER;
        const T = window.THREE;
        const root = v.avatarManager.currentRoot;
        root.updateMatrixWorld(true);
        // Her posed body, from her bones: a skinned mesh's box is its unposed (standing) shape, so
        // it never lies down. Head, hips, hands and feet, padded to her outline.
        const vrmB = v.avatarManager._currentVRM || v.avatarManager.vrmLoader?.currentVRM;
        const boneB = (n) => vrmB?.humanoid?.getNormalizedBoneNode?.(n) || vrmB?.humanoid?.getBoneNode?.(n);
        const box = new T.Box3();
        for (const n of [
            'head',
            'hips',
            'chest',
            'leftHand',
            'rightHand',
            'leftFoot',
            'rightFoot',
            'leftLowerLeg',
            'rightLowerLeg',
        ])
            if (boneB(n)) box.expandByPoint(boneB(n).getWorldPosition(new T.Vector3()));
        if (box.isEmpty()) box.setFromObject(root);
        else box.expandByScalar(0.22);
        const c = box.getCenter(new T.Vector3());
        const size = box.getSize(new T.Vector3());
        const half = T.MathUtils.degToRad(v.camera.fov) / 2;
        const dist = (Math.max(size.x, size.y, size.z) * 0.7) / Math.tan(half);
        // Her front from her own face: the eyes sit ahead of the head bone, whatever way the
        // file faces (+Z or -Z) and whatever a turn step did. Three-quarter from there.
        const vrm = v.avatarManager._currentVRM || v.avatarManager.vrmLoader?.currentVRM;
        const bone = (n) => vrm?.humanoid?.getNormalizedBoneNode?.(n) || vrm?.humanoid?.getBoneNode?.(n);
        const head = bone('head');
        const eyes = [bone('leftEye'), bone('rightEye')].filter(Boolean);
        let face = 0;
        if (head) {
            const hp = head.getWorldPosition(new T.Vector3());
            let ahead;
            if (eyes.length) {
                ahead = eyes.reduce((acc, e) => acc.add(e.getWorldPosition(new T.Vector3())), new T.Vector3());
                ahead.multiplyScalar(1 / eyes.length);
            } else {
                ahead = new T.Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(new T.Quaternion())).add(hp);
            }
            face = Math.atan2(ahead.x - hp.x, ahead.z - hp.z);
        }
        const yaw = face + 0.55;
        if (v.controls) v.controls.minDistance = 0.05;
        // Lying down her eyes look at the ceiling, so her face says nothing about where to stand:
        // film her from the side of her body's long axis, from above, looking down at her. Either
        // way, of two candidate spots the one with nothing of the room between the lens and her
        // (a bed edge hid a whole position) is used.
        // Lying is her head near the lowest point of her body (raised knees made the box tall and
        // a knees-up frame was filmed from behind the footboard), or a flat box.
        const headY = boneB('head') ? boneB('head').getWorldPosition(new T.Vector3()).y : box.max.y;
        const lying = headY - (box.min.y + 0.22) < 0.5 || size.y < 0.75;
        const spots = [];
        if (lying) {
            const long = size.x > size.z ? 0 : Math.PI / 2;
            const d = Math.max(size.x, size.z) * 1.1 + 0.6;
            for (const side of [long + Math.PI / 2, long - Math.PI / 2])
                spots.push(
                    new T.Vector3(c.x + Math.sin(side) * d * 0.8, c.y + d * 0.9, c.z + Math.cos(side) * d * 0.8)
                );
        } else {
            for (const y of [yaw, face - 0.55])
                spots.push(new T.Vector3(c.x + Math.sin(y) * dist, c.y + 0.2, c.z + Math.cos(y) * dist));
        }
        const mine = new Set();
        root.traverse((o) => mine.add(o));
        const blocked = (from) => {
            const dir = c.clone().sub(from);
            const far = dir.length() - 0.35;
            const ray = new T.Raycaster(from, dir.normalize(), 0.05, far);
            ray.camera = v.camera; // sprites in the scene read it while being tested
            return ray
                .intersectObjects(v.scene.children, true)
                .filter((hit) => hit.object.isMesh && !mine.has(hit.object) && hit.object.visible).length;
        };
        const count = (p) => {
            try {
                return blocked(p);
            } catch (_) {
                return 0; // a scene the ray cannot test: keep the first spot
            }
        };
        const best = spots.map((p) => [p, count(p)]).sort((a, b) => a[1] - b[1])[0][0];
        v.camera.position.copy(best);
        if (v.controls) {
            v.controls.target.copy(c);
            v.controls.update();
        }
        v.camera.lookAt(c);
        return { world: v.vrWorlds?.activeId || null, avatar: root.uuid };
    });
    await page.waitForTimeout(600);
    const file = `${String(index).padStart(2, '0')}-${String(label || 'stage').replace(/[^a-z0-9-]/gi, '')}.png`;
    await page
        .locator('canvas')
        .first()
        .screenshot({ path: path.join(out, file) });
    return { index, label, file, ...text, did, world: info.world, worldOk: !room || info.world === room };
}

/** What a reviewer checks first: every step ran, every position or clip moved her, every undress swapped her. */
function verdictOf(stages) {
    const steps = stages.filter((s) => s.did);
    return {
        steps: steps.length,
        ran: steps.filter((s) => s.did.ok).length,
        stillFrames: steps.filter((s) => s.did.ok && s.did.moved < 5).map((s) => s.index),
        undressSwapped: steps.filter((s) => s.did.look && s.did.look.swapped).length,
        undressMissed: steps.filter((s) => s.did.look && !s.did.look.swapped).map((s) => s.index),
        worldOk: stages.every((s) => s.worldOk),
    };
}

function esc(s) {
    return String(s == null ? '' : s).replace(
        /[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );
}

/** The contact sheet: every stage with its frame, what she says or does, and the measured result. */
function sheet(r) {
    const v = r.verdict;
    const card = (s) => {
        const d = s.did;
        const flags = [];
        if (d) {
            flags.push(d.ok ? `<b class=ok>ran</b>` : `<b class=bad>failed: ${esc(d.why)}</b>`);
            flags.push(d.moved < 5 ? `<b class=bad>moved ${d.moved}°</b>` : `moved ${d.moved}°`);
            if (d.onBed) flags.push('on the bed');
            if (d.look)
                flags.push(
                    d.look.swapped
                        ? `<b class=ok>clothes changed</b>`
                        : `<b class=bad>clothes not changed${d.look.why ? ': ' + esc(d.look.why) : ''}</b>`
                );
            flags.push(`${esc(d.kind)}: ${esc(d.what)}`);
        }
        flags.push(s.worldOk ? `room ${esc(s.world || '—')}` : `<b class=bad>room ${esc(s.world || 'none')}</b>`);
        const said = (s.said || [])
            .filter(Boolean)
            .map((x) => `<q>${esc(x)}</q>`)
            .join('');
        return `<figure><img src="${esc(s.file)}" loading=lazy><figcaption><h3>${s.index}. ${esc(s.label)}</h3>${s.body ? `<p>${esc(s.body)}</p>` : ''}${said}<p class=flags>${flags.join(' · ')}</p></figcaption></figure>`;
    };
    return `<!doctype html><meta charset=utf-8><title>Evening stages — ${esc(r.name)}</title>
<style>body{font:14px system-ui;background:#141218;color:#eee;margin:16px}h1{font-size:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px}
figure{margin:0;background:#201e24;border-radius:10px;overflow:hidden}img{width:100%;display:block}
figcaption{padding:10px}h3{margin:0 0 6px;font-size:15px}q{display:block;color:#e9b5a1;margin:4px 0}
.flags{color:#a9a1a8;font-size:12px}.ok{color:#7fd07f}.bad{color:#ff7a7a}</style>
<h1>${esc(r.name)} · ${esc(r.show)}${r.persona ? ' · ' + esc(r.persona.name) : ''} · room ${esc(r.room || 'none')} · ${esc(r.lang)}</h1>
<p>Avatar ${esc(r.avatar)} · looks: ${esc(r.looks.kind)} · opens at step ${esc(r.level)}</p>
<p>Ran ${v.ran}/${v.steps} steps · still frames: ${v.stillFrames.length ? v.stillFrames.join(', ') : 'none'} · clothes changed ${v.undressSwapped}${v.undressMissed.length ? ` (missed at ${v.undressMissed.join(', ')})` : ''} · room ${v.worldOk ? 'ok' : '<b class=bad>wrong</b>'}${r.errors.length ? ` · <b class=bad>${r.errors.length} page errors</b>` : ''}</p>
<div class=grid>${r.stages.map(card).join('')}</div>`;
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
