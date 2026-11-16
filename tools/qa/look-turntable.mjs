#!/usr/bin/env node
/**
 * LT10. A look, as this app's renderer draws it, from four sides: pictures for a person to look at.
 *
 *   node tools/qa/look-turntable.mjs --vrm a.vrm [--vrm b.vrm ...] --out dir \
 *        [--focus hips|body] [--distance 1.0] [--labels before,after]
 *
 * Forge's fit report measures a look; its preview is drawn by Forge's own software renderer. What
 * a person sees is this app's renderer (Three.js r147, the VRM loader, MToon), so a fitting
 * change is looked at here: each file is loaded through the viewer exactly as the avatar picker
 * loads one and framed as the app frames her; for `--focus hips` the camera is brought in level
 * with her hip joint. She is turned to 0, 90, 180 and 270 degrees and the stage is saved. One row per file in `sheet.html`; the PNGs are beside it.
 *
 * The files are served to the page from disk under a throwaway path; nothing is uploaded and
 * no wardrobe state is touched (the wardrobe controller is not involved: this is a viewer of
 * files, not a way to wear them).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const all = (name) => process.argv.flatMap((value, i) => (value === name ? [process.argv[i + 1]] : []));
const arg = (name, fallback) => all(name)[0] ?? fallback;
const files = all('--vrm').map((file) => path.resolve(file));
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/wardrobe/runs', 'turntable')));
const focus = arg('--focus', 'hips');
const distance = Number(arg('--distance', focus === 'hips' ? '1.0' : '2.6'));
const labels = (arg('--labels', '') || '').split(',').filter(Boolean);
if (!files.length || files.some((file) => !fs.existsSync(file))) {
    console.error('usage: look-turntable.mjs --vrm file.vrm [--vrm ...] --out dir');
    process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const VIEWS = [
    ['front', 0],
    ['left', 90],
    ['back', 180],
    ['right', 270],
];

const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
const { playwright, why } = D.loadPlaywright();
if (!playwright) {
    console.error(why);
    process.exit(1);
}
const server = await D.ensureServer(arg('--url', 'http://127.0.0.1:8080').replace(/\/$/, ''));
const browser = await playwright.chromium.launch({ args: D.SWIFTSHADER });
const rows = [];
try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => {
        localStorage.setItem('npc_enabled', 'false');
        localStorage.setItem('wardrobe_forge_mode', 'off');
    });
    const page = await ctx.newPage();
    files.forEach((file, i) =>
        page.route(`**/__qa/look-${i}.vrm`, (route) =>
            route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: fs.readFileSync(file) })
        )
    );
    await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
    await D.waitForApp(page, 300000);
    await page.waitForTimeout(2500);
    // A look is judged against a plain mid-grey, not the stage's black (black denim on black
    // shows nothing). The stage itself is left as the app lays it out.
    await page.evaluate(() => {
        const viewer = window.NEXUS_VIEWER;
        if (viewer.scene && window.THREE) viewer.scene.background = new window.THREE.Color(0x8d9198);
    });
    const stage = async () => {
        const box = await page.locator('.avatar-viewport canvas').first().boundingBox();
        return box || { x: 0, y: 0, width: 900, height: 900 };
    };
    for (let i = 0; i < files.length; i += 1) {
        const label = labels[i] || path.basename(files[i], '.vrm');
        const before = await page.evaluate(() => window.NEXUS_VIEWER.avatarManager.currentRoot.uuid);
        await page.evaluate(
            async ({ url, name }) => {
                const viewer = window.NEXUS_VIEWER;
                if (typeof viewer.loadAvatar === 'function') await viewer.loadAvatar(url, name, -1);
                else await viewer.avatarManager.setAvatarByUrl(url, name, -1);
            },
            { url: `/__qa/look-${i}.vrm`, name: label }
        );
        await page.waitForFunction((uuid) => window.NEXUS_VIEWER.avatarManager.currentRoot.uuid !== uuid, before, {
            timeout: 240000,
        });
        await page.waitForTimeout(3000);
        // The app's own framing of her, then (for hips) the camera brought in along the line it
        // already looks down, level with her hip joint. She is turned; the camera is not.
        const base = await page.evaluate(
            ({ focus, distance }) => {
                const viewer = window.NEXUS_VIEWER;
                const m = viewer.avatarManager;
                const THREE = window.THREE;
                if (m.frameAvatar) m.frameAvatar();
                const vrm = m._currentVRM || (m.vrmLoader && m.vrmLoader.currentVRM) || null;
                const hips = vrm && vrm.humanoid && vrm.humanoid.getBoneNode ? vrm.humanoid.getBoneNode('hips') : null;
                if (focus === 'hips' && hips) {
                    const at = hips.getWorldPosition(new THREE.Vector3());
                    const target = viewer.controls.target.clone();
                    target.y = at.y;
                    const away = viewer.camera.position.clone().sub(viewer.controls.target);
                    away.y = 0;
                    away.setLength(distance);
                    viewer.controls.target.copy(target);
                    viewer.camera.position.copy(target).add(away);
                    viewer.camera.position.y = target.y + 0.03;
                    viewer.controls.update();
                }
                return m.currentRoot.rotation.y;
            },
            { focus, distance }
        );
        const shots = [];
        for (const [view, degrees] of VIEWS) {
            await page.evaluate(
                ({ base, degrees }) => {
                    window.NEXUS_VIEWER.avatarManager.currentRoot.rotation.y = base + (degrees * Math.PI) / 180;
                },
                { base, degrees }
            );
            await page.waitForTimeout(900);
            const file = `${String(i + 1).padStart(2, '0')}-${label}-${view}.png`.replace(/[^A-Za-z0-9._-]+/g, '-');
            // Clipped to the stage. (An element capture waits for the canvas to stop changing,
            // and a live renderer never does.)
            await page.screenshot({ path: path.join(out, file), clip: await stage() });
            shots.push({ view, file });
        }
        await page.evaluate((base) => {
            window.NEXUS_VIEWER.avatarManager.currentRoot.rotation.y = base;
        }, base);
        rows.push({ label, source: path.basename(files[i]), shots });
        console.log(`${label}: ${shots.map((s) => s.file).join(', ')}`);
    }
    await ctx.close();
} finally {
    await browser.close();
    server.stop();
}
const html = [
    '<!doctype html><meta charset="utf-8"><title>Look turntable</title>',
    '<style>body{background:#111;color:#ddd;font:14px system-ui;margin:16px}figure{display:inline-block;margin:4px}',
    'img{width:300px;display:block}h2{font-size:15px;margin:18px 0 4px}</style>',
    ...rows.map(
        (row) =>
            `<h2>${row.label} <small>(${row.source})</small></h2>` +
            row.shots
                .map(
                    (s) =>
                        `<figure><img src="${s.file}" alt="${row.label} ${s.view}"><figcaption>${s.view}</figcaption></figure>`
                )
                .join('')
    ),
].join('\n');
fs.writeFileSync(path.join(out, 'sheet.html'), html);
fs.writeFileSync(path.join(out, 'turntable.json'), JSON.stringify({ focus, distance, rows }, null, 2));
