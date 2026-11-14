#!/usr/bin/env node
/**
 * MO4. Runtime audit of every animation clip the app ships (issue #150).
 *
 * "Do not assume an animation works because it appears in a list or passes a filename-resolution
 * test." This plays every clip on the real avatar in a real browser and records what it did:
 *
 *   file      the bytes are the format they claim (BVH "HIERARCHY", VRMA glTF magic) — an HTTP 200
 *             carrying the HTML fallback page is a missing file, not a clip
 *   load      NEXUS_CLIP_LOADER.loadClip returned a clip (parsed + retargeted onto the rig)
 *   play      playClip reported started
 *   motion    the skeleton actually changed: largest bone rotation change across 3 s of samples
 *   hips      world height of the hips over the samples: min / max / at rest
 *   floor     hips below 0.25 m in a clip whose category is not a floor posture → sinks into the floor
 *
 * Every clip gets its own entry and a screenshot (one contact sheet per category). Visual quality —
 * clipping, cloth, hands — is not judged by numbers; the sheet is the evidence for a person.
 *
 *   node tools/qa/animation-runtime-audit.mjs [--url http://127.0.0.1:8080/] [--only dance]
 *     → docs/audits/animation-runtime-audit.json, .md, and docs/audits/animation-runtime/*.jpg
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const URL_ = opt('--url', 'http://127.0.0.1:8080/');
const ONLY = opt('--only', '');
const OUT = path.join(ROOT, 'docs/audits');
const SHOTS = path.join(OUT, 'animation-runtime');

function chromium() {
    try {
        return require('playwright').chromium;
    } catch {
        const g = require('child_process').execSync('npm root -g').toString().trim();
        return require(path.join(g, 'playwright')).chromium;
    }
}

/** Every clip: the vendor manifest (113) plus the addon packs, each path once. */
function inventory() {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor/animations/manifest.json'), 'utf8'));
    const out = [];
    const seen = new Set();
    for (const [category, entry] of Object.entries(manifest.categories)) {
        for (const file of entry.files || []) {
            const p = 'vendor/animations/' + file;
            if (!seen.has(p))
                out.push({
                    id: path.basename(file).replace(/\.\w+$/, ''),
                    path: p,
                    category,
                    source: 'vendor-manifest',
                });
            seen.add(p);
        }
    }
    for (const dir of ['addons/vrma-actions', 'addons/vrma-dance', 'addons/vrma-locomotion']) {
        const abs = path.join(ROOT, dir);
        if (!fs.existsSync(abs)) continue;
        for (const f of fs.readdirSync(abs).sort()) {
            if (!/\.(vrma|bvh)$/i.test(f)) continue;
            const p = dir + '/' + f;
            if (!seen.has(p))
                out.push({ id: f.replace(/\.\w+$/, ''), path: p, category: dir.split('/')[1], source: 'addon' });
            seen.add(p);
        }
    }
    return out;
}

const FLOOR_POSTURES = new Set(['laying', 'kneeling', 'exercise', 'sitting']);

async function main() {
    let clips = inventory();
    if (ONLY) clips = clips.filter((c) => c.category.includes(ONLY) || c.id.includes(ONLY));
    fs.mkdirSync(SHOTS, { recursive: true });
    const browser = await chromium().launch({
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    // The audit plays clips itself: keep the Living-NPC idle scheduler and Behavior Director quiet.
    await page.addInitScript(() => localStorage.setItem('npc_enabled', 'false'));
    await page.goto(URL_, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(
        () => !!window.NEXUS_VIEWER?.avatarManager?.currentRoot && !!window.NEXUS_CLIP_LOADER,
        null,
        { timeout: 120000 }
    );
    await page.waitForTimeout(4000);
    const avatar = await page.evaluate(() => {
        const am = window.NEXUS_VIEWER.avatarManager;
        const vrm = am._currentVRM;
        return {
            name: am.currentName || am.currentRoot?.name || null,
            vrmVersion: vrm?.meta?.metaVersion || (vrm?.meta ? '0' : null),
        };
    });

    // A broken VRMA leaves the hips displaced for whatever plays next (the four good VRMA dances
    // read as sinking when they followed the floating Mixamo clips), so after any failing clip the
    // avatar is reloaded and the next one is measured on a fresh page.
    const fresh = async () => {
        await page.goto(URL_, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(
            () => !!window.NEXUS_VIEWER?.avatarManager?.currentRoot && !!window.NEXUS_CLIP_LOADER,
            null,
            { timeout: 120000 }
        );
        await page.waitForTimeout(2500);
    };
    const results = [];
    for (const [i, clip] of clips.entries()) {
        if (i > 0 && results[results.length - 1].status !== 'pass') await fresh();
        const file = await page.evaluate(async (p) => {
            try {
                const r = await fetch(p);
                const buf = new Uint8Array(await r.arrayBuffer());
                const head = new TextDecoder().decode(buf.slice(0, 16));
                return { status: r.status, bytes: buf.length, type: r.headers.get('content-type'), head };
            } catch (e) {
                return { status: 0, error: String(e) };
            }
        }, clip.path);
        const isVrma = /\.vrma$/i.test(clip.path);
        // VRMA may be binary glTF or glTF JSON; either is a real file. HTML is not.
        const fileOk =
            file.status === 200 &&
            (isVrma
                ? file.head.startsWith('glTF') || /^\{\s*"asset"/.test(file.head.trim())
                : /^HIERARCHY/i.test(file.head.trim()));
        let run = { load: false, play: false };
        if (fileOk) {
            run = await page.evaluate(async (p) => {
                const L = window.NEXUS_CLIP_LOADER;
                const am = window.NEXUS_VIEWER.avatarManager;
                const hum = am._currentVRM?.humanoid;
                const T = window.THREE;
                const names = [
                    'hips',
                    'spine',
                    'chest',
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
                // Raw bones: what is drawn. BVH writes them through the rig, VRMA through normalized → raw.
                const node = (n) => hum?.getRawBoneNode?.(n) || hum?.getNormalizedBoneNode?.(n);
                const hipsY = () => {
                    const v = new T.Vector3();
                    node('hips')?.getWorldPosition(v);
                    return v.y;
                };
                L.stopClip({ fadeOut: 0, _skipRestore: false });
                await new Promise((r) => setTimeout(r, 400));
                const restHips = hipsY();
                let clipObj = null;
                try {
                    clipObj = await L.loadClip(p);
                } catch (e) {
                    return { load: false, error: 'load threw: ' + e.message };
                }
                if (!clipObj) return { load: false, error: 'loadClip returned nothing' };
                const tracks = clipObj.tracks ? clipObj.tracks.length : 0;
                const ok = await L.playClip(p, { loop: true, fadeIn: 0.1 });
                if (!ok)
                    return {
                        load: true,
                        play: false,
                        tracks,
                        duration: clipObj.duration,
                        error: 'playClip returned false',
                    };
                const samples = [];
                for (let k = 0; k < 12; k++) {
                    await new Promise((r) => setTimeout(r, 250));
                    const q = {};
                    for (const n of names) {
                        const b = node(n);
                        if (b) q[n] = [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w];
                    }
                    samples.push({ y: hipsY(), q });
                }
                let maxDelta = 0;
                for (let k = 1; k < samples.length; k++) {
                    for (const n of Object.keys(samples[k].q)) {
                        const a = samples[0].q[n],
                            b = samples[k].q[n];
                        if (!a || !b) continue;
                        const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
                        maxDelta = Math.max(maxDelta, 2 * Math.acos(dot));
                    }
                }
                const ys = samples.map((s) => s.y).filter((y) => Number.isFinite(y));
                return {
                    load: true,
                    play: true,
                    tracks,
                    duration: +clipObj.duration.toFixed(2),
                    restHips: +restHips.toFixed(3),
                    minHips: +Math.min(...ys).toFixed(3),
                    maxHips: +Math.max(...ys).toFixed(3),
                    maxBoneChangeRad: +maxDelta.toFixed(3),
                };
            }, clip.path);
        }
        const shot = `${clip.category}--${clip.id}.jpg`;
        if (run.play)
            await page.screenshot({ path: path.join(SHOTS, shot), clip: { x: 16, y: 80, width: 474, height: 650 }, type: 'jpeg', quality: 60, scale: 'css' });

        const problems = [];
        if (!fileOk)
            problems.push(
                file.status !== 200
                    ? `file missing (HTTP ${file.status})`
                    : `not a ${isVrma ? 'VRMA' : 'BVH'} file (starts "${(file.head || '').slice(0, 9)}", ${file.type})`
            );
        else if (!run.load) problems.push(run.error || 'did not load');
        else if (!run.play) problems.push(run.error || 'did not start');
        else {
            if (run.maxBoneChangeRad < 0.02 && run.minHips === run.maxHips) problems.push('no visible motion in 3 s');
            if (!FLOOR_POSTURES.has(clip.category) && run.minHips < 0.25)
                problems.push(`hips reach ${run.minHips} m: sinks into the floor`);
            if (run.maxHips > 2.2) problems.push(`hips reach ${run.maxHips} m: floats`);
        }
        const status = problems.length ? 'fail' : 'pass';
        results.push({
            id: clip.id,
            path: clip.path,
            category: clip.category,
            source: clip.source,
            file: { ok: fileOk, status: file.status, bytes: file.bytes, contentType: file.type },
            loaded: !!run.load,
            retargetedTracks: run.tracks ?? null,
            started: !!run.play,
            durationS: run.duration ?? null,
            loops: true,
            motion: run.play
                ? {
                      maxBoneChangeRad: run.maxBoneChangeRad,
                      hipsRest: run.restHips,
                      hipsMin: run.minHips,
                      hipsMax: run.maxHips,
                  }
                : null,
            status,
            problems,
            evidence: run.play ? `docs/audits/animation-runtime/${shot}` : null,
            visual: 'not verified by numbers — see the contact sheet',
            vrm:
                avatar.vrmVersion === '1'
                    ? 'VRM 1.0 avatar tested'
                    : avatar.vrmVersion
                      ? 'VRM 0.x avatar tested'
                      : 'unknown',
            platform: 'desktop Chromium (SwiftShader); mobile and XR not run',
        });
        process.stdout.write(
            `${String(i + 1).padStart(3)}/${clips.length} ${status === 'pass' ? 'pass' : 'FAIL'} ${clip.path}${problems.length ? '  — ' + problems.join('; ') : ''}\n`
        );
    }
    await browser.close();

    const summary = {
        total: results.length,
        pass: results.filter((r) => r.status === 'pass').length,
        fail: results.filter((r) => r.status === 'fail').length,
    };
    const report = {
        generated: new Date().toISOString(),
        url: URL_,
        avatar,
        method: 'tools/qa/animation-runtime-audit.mjs',
        summary,
        clips: results,
    };
    fs.writeFileSync(path.join(OUT, 'animation-runtime-audit.json'), JSON.stringify(report, null, 2) + '\n');
    const lines = [
        '# Animation runtime audit',
        '',
        `Generated ${report.generated} by \`${report.method}\` against ${URL_}. Every clip was fetched, loaded, played on the avatar and sampled for 3 s in desktop Chromium.`,
        '',
        `**${summary.pass} pass, ${summary.fail} fail, of ${summary.total}.** "Pass" means the file is real, it loaded and retargeted, the skeleton moved, and the hips stayed in a believable range for its category. Visual quality (clipping, hands, cloth) is not judged by these numbers: see the screenshots in \`docs/audits/animation-runtime/\`.`,
        '',
        '| Clip | Category | Status | Duration | Bone change | Hips min–max | Problem |',
        '| ---- | -------- | ------ | -------: | ----------: | -----------: | ------- |',
        ...results.map(
            (r) =>
                `| \`${r.path}\` | ${r.category} | ${r.status} | ${r.durationS ?? '–'} | ${r.motion ? r.motion.maxBoneChangeRad : '–'} | ${r.motion ? r.motion.hipsMin + '–' + r.motion.hipsMax : '–'} | ${r.problems.join('; ')} |`
        ),
        '',
    ];
    fs.writeFileSync(path.join(OUT, 'animation-runtime-audit.md'), lines.join('\n'));
    console.log(JSON.stringify(summary));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
