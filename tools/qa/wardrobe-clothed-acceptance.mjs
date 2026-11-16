#!/usr/bin/env node
/**
 * LT10. Clothed outfit-change acceptance in the real renderer, for one built-in character.
 *
 *   node tools/qa/wardrobe-clothed-acceptance.mjs --character avatar-sample-b \
 *        [--size desktop|phone] [--lang en-US|it-IT] [--out dir] [--scale 1|2]
 *   node tools/qa/wardrobe-clothed-acceptance.mjs --matrix [--out dir]
 *
 * The first acceptance run (tools/qa/private-body-state-acceptance.mjs) proved the wear,
 * verify, cancel and restore path on AvatarSample A, in Private, with one imported state. This
 * is the same path for the other four characters this site ships with looks of their own
 * (AvatarSample B, AvatarSample C, VRoid Female, VRoid Male), with **clothed, general-rated**
 * looks: the two per character in the verified pack (vendor/wardrobe, W11), which are real VRM
 * files Forge fitted to each character's exact bytes. No Forge is contacted (the pack needs no
 * server) and no mannequin stands in for anyone.
 *
 * Nothing here calls the wardrobe controller to wear or restore anything. Outside Private the
 * path the application requires is Together ▸ Try-On (the only way in since W18): TryOnView →
 * TryOnSession → WardrobeController. PrivateActionBridge is required for actions *inside*
 * Private and is not in this path; tools/qa/wardrobe-scene-acceptance.mjs covers the bridge
 * across scenes. The controller, the manager and the renderer are only *read*.
 *
 * What is a person's own action here and what stands in for one, exactly:
 *   - wearing a look: a real tap on its card in the look rail on the stage;
 *   - opening Try-On: `panel.startActivity('try-on-haul')`, what the Together tile calls;
 *   - ending the haul: Try-On's own End button when it can be reached, else
 *     `panel.stopActivity('user')`, what Together's Stop calls (the report says which);
 *   - the stale request (step 7): the rail disables itself while a look loads, so a person
 *     cannot tap a second look there. The driver re-enables that one button and clicks it, to
 *     make the superseding request that the typed box and her wardrobe tool can still make.
 *     The report records that the rail was disabled (`railDisabledWhilePending`).
 *
 * Per character, viewport and language:
 *
 *   0. Files (before any browser): her avatar file hashes to AvatarIdentity's pin and to the
 *      pack's `sourceSha256`; each of her looks hashes to the pack's `sha256` and size.
 *   1. The page loads **her**: the manager's file is hers and the bytes it was served hash to
 *      her pin. Her rig, expressions, face and hair are read from the loaded VRM.
 *   2. Try-On lists her looks and nobody else's (correct asset selection), in the chosen language.
 *   3. Tap look 1: the controller wears exactly that look, as verified bytes (a `blob:` whose
 *      contents hash to the pack's SHA-256), and the renderer's root is that file. Same humanoid
 *      bones on the same node names, same expressions, same face and hair meshes (vertex for
 *      vertex), camera unmoved, the canvas actually redrawn, no horizontal overflow.
 *   4. Tap look 2: the same, from a look rather than from her own outfit.
 *   5. Failed download (503) of look 1 while she wears look 2: refused, look 2 stays on.
 *   6. Tampered bytes of look 1: refused before the loader, look 2 stays on.
 *   7. Stale request: look 1's download is held, look 1 is tapped, then look 2 is tapped again;
 *      the held download is released. Look 1 never reaches the renderer; look 2 is what she wears.
 *   8. End haul: her own file is the renderer's root again, the controller records no look, she
 *      is the same character, the camera has not moved.
 *   9. Cancellation: Try-On again, look 1 held and tapped, End haul while it waits, then
 *      released. The look never reaches the renderer; she is in her own outfit.
 *
 * Screenshots (real Chromium, SwiftShader) are written under --out, one folder per run, with
 * report.json. --matrix runs the four characters x two viewports x two languages one after
 * another and writes matrix.json and matrix.md beside them. Exit 1 on any failure.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
};
const has = (name) => process.argv.includes(name);

/** The four characters of this matrix, by the slug Forge and the pack know them by. */
export const CHARACTERS = [
    { slug: 'avatar-sample-b', name: 'AvatarSample B', file: 'AvatarSample_B.vrm' },
    { slug: 'avatar-sample-c', name: 'AvatarSample C', file: 'AvatarSample_C.vrm' },
    { slug: 'fem-vroid', name: 'VRoid Female', file: 'fem_vroid.vrm' },
    { slug: 'masc-vroid', name: 'VRoid Male', file: 'masc_vroid.vrm' },
];
const SIZES = ['desktop', 'phone'];
const LANGS = ['en-US', 'it-IT'];
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

if (has('--matrix')) {
    const out = path.resolve(arg('--out', path.join(ROOT, 'audits/wardrobe/runs', `${stamp}-clothed-matrix`)));
    fs.mkdirSync(out, { recursive: true });
    const only = arg('--characters', '');
    const rows = [];
    for (const character of CHARACTERS.filter((c) => !only || only.split(',').includes(c.slug))) {
        for (const size of SIZES) {
            for (const lang of LANGS) {
                const dir = path.join(out, character.slug, `${size}-${lang}`);
                const run = spawnSync(
                    process.execPath,
                    [
                        fileURLToPath(import.meta.url),
                        '--character',
                        character.slug,
                        '--size',
                        size,
                        '--lang',
                        lang,
                        '--out',
                        dir,
                        '--scale',
                        arg('--scale', '1'),
                    ],
                    { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', timeout: 30 * 60 * 1000 }
                );
                let report = null;
                try {
                    report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
                } catch (_) {
                    report = { passed: false, failures: ['driver: no report written'], checks: {} };
                }
                rows.push({ character: character.slug, name: character.name, size, lang, exit: run.status, report });
                console.log(
                    `${character.slug} ${size} ${lang}: ${report.passed ? 'PASS' : 'FAIL'}` +
                        (report.failures.length ? ` — ${report.failures.join('; ')}` : '')
                );
            }
        }
    }
    const checkNames = [...new Set(rows.flatMap((r) => Object.keys(r.report.checks || {})))];
    // A language or viewport check belongs to the runs in that language or viewport; for the
    // others it is not applicable, which is not the same as a check a failed run never reached.
    const applies = (name, r) =>
        !(
            (name === 'English' && r.lang.startsWith('it')) ||
            (name === 'Italian' && !r.lang.startsWith('it')) ||
            (name.startsWith('Desktop viewport') && r.size !== 'desktop') ||
            (name.startsWith('390 px') && r.size !== 'phone')
        );
    const md = [
        '# Clothed outfit-change acceptance matrix',
        '',
        `Run ${stamp} with \`tools/qa/wardrobe-clothed-acceptance.mjs --matrix\`. Real Chromium (SwiftShader), the real renderer, the verified pack's VRM files.`,
        '',
        `| Check | ${rows.map((r) => `${r.name}<br>${r.size} ${r.lang.slice(0, 2)}`).join(' | ')} |`,
        `|---|${rows.map(() => '---').join('|')}|`,
        ...checkNames.map(
            (name) =>
                `| ${name} | ${rows
                    .map((r) =>
                        r.report.checks && name in r.report.checks
                            ? r.report.checks[name]
                                ? 'pass'
                                : '**FAIL**'
                            : applies(name, r)
                              ? 'not run'
                              : 'n/a'
                    )
                    .join(' | ')} |`
        ),
        `| **Run** | ${rows.map((r) => (r.report.passed ? 'pass' : '**FAIL**')).join(' | ')} |`,
        '',
    ].join('\n');
    fs.writeFileSync(path.join(out, 'matrix.md'), md);
    fs.writeFileSync(
        path.join(out, 'matrix.json'),
        JSON.stringify(
            rows.map((r) => ({
                character: r.character,
                size: r.size,
                lang: r.lang,
                passed: r.report.passed,
                failures: r.report.failures,
                checks: r.report.checks,
                files: r.report.files,
                looks: r.report.looks,
                screenshots: r.report.screenshots,
            })),
            null,
            2
        )
    );
    const failed = rows.filter((r) => !r.report.passed);
    console.log(
        JSON.stringify({ runs: rows.length, passed: rows.length - failed.length, failed: failed.length, out }, null, 2)
    );
    process.exit(failed.length ? 1 : 0);
}

const character = CHARACTERS.find((c) => c.slug === arg('--character', ''));
if (!character) {
    console.error(`--character must be one of: ${CHARACTERS.map((c) => c.slug).join(', ')} (or --matrix)`);
    process.exit(2);
}
const size = arg('--size', 'desktop');
const lang = arg('--lang', 'en-US');
const scale = Number(arg('--scale', '1')) || 1;
const out = path.resolve(
    arg('--out', path.join(ROOT, 'audits/wardrobe/runs', `${stamp}-${character.slug}-${size}-${lang}`))
);
fs.mkdirSync(out, { recursive: true });

const report = {
    character: character.slug,
    name: character.name,
    size,
    lang,
    files: {},
    looks: [],
    steps: [],
    checks: {},
    failures: [],
    errors: [],
    screenshots: [],
};
const fail = (check, what) => {
    report.checks[check] = false;
    report.failures.push(`${check}: ${what}`);
};
/** A check passes unless something failed it; naming it up front keeps "not run" visible. */
const ok = (check) => {
    if (!(check in report.checks)) report.checks[check] = true;
};

// ---- 0. Files, before any browser ------------------------------------------------------------
const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor/wardrobe/wardrobe.json'), 'utf8'));
const identitySource = fs.readFileSync(path.join(ROOT, 'src/wardrobe/AvatarIdentity.js'), 'utf8');
const pin = (identitySource.match(new RegExp(`slug: '${character.slug}',[\\s\\S]*?sha256: '([0-9a-f]{64})'`)) || [])[1];
const avatarFile = path.join(ROOT, 'vendor/avatars', character.file);
const avatarSha = sha256(avatarFile);
const packAvatar = (pack.avatars || []).find((a) => a.avatarId === character.slug) || {};
const packLooks = (pack.looks || []).filter((l) => l.avatarId === character.slug);
report.files.avatar = {
    file: character.file,
    bytes: fs.statSync(avatarFile).size,
    sha256: avatarSha,
    pin,
    packSource: packAvatar.sourceSha256,
};
if (!pin || avatarSha !== pin)
    fail('File integrity (SHA-256)', `her file hashes to ${avatarSha}, AvatarIdentity pins ${pin}`);
if (packAvatar.sourceSha256 !== avatarSha)
    fail('File integrity (SHA-256)', 'the pack was not made from her exact file');
if (packLooks.length < 2)
    fail('Correct asset selection', `the pack has ${packLooks.length} looks for her; two are needed`);
for (const look of packLooks) {
    const file = path.join(ROOT, 'vendor/wardrobe', look.vrmUrl);
    const actual = {
        id: look.id,
        name: look.name,
        rating: look.rating,
        garments: (look.provenance || {}).garments,
        bytes: fs.statSync(file).size,
        sha256: sha256(file),
        expected: look.sha256,
    };
    report.looks.push(actual);
    if (actual.sha256 !== look.sha256 || actual.bytes !== look.bytes)
        fail('File integrity (SHA-256)', `${look.id} does not match the pack`);
    if (look.rating !== 'general')
        fail('Correct asset selection', `${look.id} is rated ${look.rating}; this matrix is clothed, general looks`);
}
ok('File integrity (SHA-256)');
const [lookA, lookB] = packLooks;
const FORGE_DEFAULT =
    (fs
        .readFileSync(path.join(ROOT, 'src/wardrobe/WardrobeConfig.js'), 'utf8')
        .match(/DEFAULT_FORGE_URL = '([^']+)'/) || [])[1] || 'https://invalid.invalid';
const lookPath = (look) => new RegExp(`${look.vrmUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\?.*)?$`);

const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
const { playwright, why } = D.loadPlaywright();
if (!playwright) {
    fail('driver', why);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ ...report, passed: false }, null, 2));
    process.exit(1);
}
const server = await D.ensureServer(arg('--url', 'http://127.0.0.1:8080').replace(/\/$/, ''));
const browser = await playwright.chromium.launch({ args: D.SWIFTSHADER });
try {
    const ctx = await browser.newContext(
        size === 'desktop'
            ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale }
            : {
                  // 390 px wide, as a phone: touch, a mobile user agent, the same page.
                  viewport: { width: 390, height: 844 },
                  isMobile: true,
                  hasTouch: true,
                  userAgent: playwright.devices['Pixel 7'].userAgent,
                  deviceScaleFactor: scale,
              }
    );
    await ctx.addInitScript(
        ({ code, file }) => {
            localStorage.setItem('app_lang', code);
            localStorage.setItem('nexus_together_enabled', 'on');
            localStorage.setItem('npc_enabled', 'false');
            // The pack only: no Forge, no network beyond this page's own server.
            localStorage.setItem('wardrobe_forge_mode', 'off');
            // Her, as the avatar picker would have left it (main.js restores it by file name).
            localStorage.setItem('nexus_selected_avatar_file', file);
        },
        { code: lang, file: character.file }
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(String(e.message).slice(0, 240)));
    // The pack needs no server: a request to any Forge (the default Space, or anything that
    // looks like Forge's API on another host) is recorded and fails the run. The page's own
    // fonts and module shim are not what this is about.
    report.forgeRequests = [];
    page.on('request', (r) => {
        const url = r.url();
        if (url.startsWith(server.base) || /^(blob|data):/.test(url)) return;
        if (
            url.startsWith(FORGE_DEFAULT) ||
            /\/v1\/(assets|library|wardrobes|jobs|generate|outfits|access|admin)\b/.test(url)
        )
            report.forgeRequests.push(url.slice(0, 160));
    });
    await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        (file) => {
            const m = window.NEXUS_VIEWER?.avatarManager;
            const current = m && (m.getCurrent ? m.getCurrent() : m.current);
            return (
                m?.currentRoot &&
                current?.url &&
                String(current.url).split('?')[0].endsWith(file) &&
                window.NEXUS_BD?.togetherPanel?.activities?.get('try-on-haul') &&
                window.NEXUS_WARDROBE?.service?.controller
            );
        },
        character.file,
        { timeout: 300000 }
    );
    await page.waitForTimeout(2500);

    // Read-only hooks: every model the manager is asked to load, and which look each verified
    // blob was made from, so a load can be traced back to the look it carries.
    await page.evaluate(() => {
        const m = window.NEXUS_VIEWER.avatarManager;
        const c = window.NEXUS_WARDROBE.service.controller;
        window.__loads = [];
        window.__verified = [];
        const load = m.setAvatarByUrl.bind(m);
        m.setAvatarByUrl = (url, ...rest) => {
            window.__loads.push(String(url));
            return load(url, ...rest);
        };
        if (c.verifyLook) {
            const verify = c.verifyLook;
            c.verifyLook = async (look, options) => {
                const result = await verify(look, options);
                window.__verified.push({ id: look.id, url: String(result.url) });
                return result;
            };
        }
    });

    /** What the renderer is drawing and who she is, read from the loaded VRM. */
    const renderer = (label) =>
        page.evaluate(async (label) => {
            const viewer = window.NEXUS_VIEWER;
            const m = viewer.avatarManager;
            const vrm = m._currentVRM || (m.vrmLoader && m.vrmLoader.currentVRM) || null;
            const c = window.NEXUS_WARDROBE.service.controller;
            const current = m.getCurrent ? m.getCurrent() : m.current;
            const bones = vrm && vrm.humanoid ? Object.keys(vrm.humanoid.humanBones || {}).sort() : [];
            const boneNodes = bones.map(
                (b) => (vrm.humanoid.humanBones[b] && vrm.humanoid.humanBones[b].node?.name) || ''
            );
            const expressions =
                vrm && vrm.expressionManager
                    ? (vrm.expressionManager.expressions || []).map((e) => e.expressionName).sort()
                    : vrm && vrm.blendShapeProxy
                      ? Object.keys(
                            vrm.blendShapeProxy._blendShapeGroups || vrm.blendShapeProxy.blendShapeGroups || {}
                        ).sort()
                      : [];
            // Face and hair, vertex for vertex: name, vertex count, morph count and a hash of positions.
            const parts = [];
            const hash = (array) => {
                let h = 2166136261;
                const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
                for (let i = 0; i < view.length; i += 1) h = Math.imul(h ^ view[i], 16777619);
                return (h >>> 0).toString(16);
            };
            m.currentRoot.traverse((o) => {
                if (!o.isMesh || !/face|hair/i.test(o.name || '')) return;
                const position = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
                const morphs = (o.geometry && o.geometry.morphAttributes && o.geometry.morphAttributes.position) || [];
                parts.push(
                    `${o.name}:${position ? position.count : 0}:${morphs.length}:${position ? hash(position.array) : ''}`
                );
            });
            let inScene = false;
            for (let o = m.currentRoot; o; o = o.parent) if (o === viewer.scene) inScene = true;
            // The bytes behind what is on stage, hashed in the page: the loader's own input.
            let loadedSha = null;
            try {
                const bytes = await (await fetch(String(current.url).split('#')[0])).arrayBuffer();
                const digest = await crypto.subtle.digest('SHA-256', bytes);
                loadedSha = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
            } catch (_) {
                loadedSha = null; // a revoked blob cannot be read back; only the worn one is asked for
            }
            const cam = viewer.camera.position;
            const canvas = viewer.renderer && viewer.renderer.domElement;
            return {
                label,
                rootUuid: m.currentRoot.uuid,
                rootInScene: inScene,
                rootVisible: m.currentRoot.visible !== false,
                managerUrl: current && current.url ? String(current.url) : null,
                loadedSha256: loadedSha,
                wornUrl: c.wornUrl ? String(c.wornUrl) : null,
                originalUrl: c.original ? String(c.original.url) : null,
                activeLook: c.activeLook
                    ? {
                          id: c.activeLook.id,
                          name: c.activeLook.name,
                          avatarId: c.activeLook.avatarId,
                          rating: c.activeLook.rating,
                      }
                    : null,
                pending: Boolean(c.pending),
                bones: bones.length,
                boneNodes: boneNodes.join('|'),
                expressions: expressions.join('|'),
                expressionCount: expressions.length,
                faceHair: parts.sort().join('|'),
                faceHairMeshes: parts.length,
                camera: [cam.x, cam.y, cam.z].map((v) => Math.round(v * 1000) / 1000),
                canvas: canvas ? [canvas.width, canvas.height] : null,
                loads: window.__loads.slice(),
                verified: window.__verified.slice(),
                overflowX: document.documentElement.scrollWidth - window.innerWidth,
            };
        }, label);
    const shoot = async (label) => {
        const file = `${label}.png`;
        const buffer = await page.screenshot({ path: path.join(out, file) });
        report.screenshots.push({
            file,
            bytes: buffer.length,
            sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        });
        return buffer;
    };
    const lookOf = (state, url) => (state.verified.find((v) => v.url === url) || {}).id || null;
    // The look rail on the stage (TryOnStageExperience) is what a person taps; a rail button
    // is disabled while a wear is on its way, exactly as it is for them.
    const card = (look) => `.nexus-look-rail-item[data-look-key$=":${look.id}"]`;
    /** On a phone the rail starts folded under its "Looks (n)" title; a person taps that first. */
    const showRail = async () => {
        const first = page.locator('.nexus-look-rail-item[data-look-key]').first();
        if (await first.isVisible().catch(() => false)) return;
        await page.locator('.nexus-look-rail-title').first().click({ timeout: 20000 });
        await first.waitFor({ state: 'visible', timeout: 20000 });
    };
    const tap = async (look, options = {}) => {
        await showRail();
        const target = page.locator(card(look)).first();
        await target.scrollIntoViewIfNeeded().catch(() => {});
        await target.click({ timeout: 20000, ...options });
    };
    const openTryOn = async () => {
        // Together ▸ Try-On: the tile starts the activity straight away (it asks nothing).
        await page.evaluate(async () => {
            const panel = window.NEXUS_BD.togetherPanel;
            await panel.startActivity('try-on-haul', { id: 'open' });
        });
        await page.waitForSelector('.nexus-look-rail-item[data-look-key]', { state: 'attached', timeout: 60000 });
        await page.waitForTimeout(800);
        await showRail();
    };
    /**
     * End the haul as a person does: "+ More" opens the full Try-On panel, whose own button is
     * End haul (Back before anything was worn). Returns how it was ended, for the report.
     */
    const endHaul = async () => {
        const end = page.locator('[data-key="end"], [data-key="back"]').first();
        if (!(await end.isVisible().catch(() => false))) {
            await page.locator('.nexus-look-rail-edit').first().click({ timeout: 20000 });
            await page.waitForTimeout(400);
        }
        if (await end.isVisible().catch(() => false)) {
            await end.click({ timeout: 20000 });
            return 'try-on-end-button';
        }
        // Together's own Stop for the running activity: the same thing its launcher's Stop does.
        await page.evaluate(() => window.NEXUS_BD.togetherPanel.stopActivity('user'));
        return 'together-stop';
    };
    const wearing = (look, timeout = 240000) =>
        page.waitForFunction(
            (id) => {
                const c = window.NEXUS_WARDROBE.service.controller;
                return c.activeLook && c.activeLook.id === id && !c.pending;
            },
            look.id,
            { timeout }
        );
    const settled = () =>
        page.waitForFunction(() => !window.NEXUS_WARDROBE.service.controller.pending, null, { timeout: 240000 });

    // ---- 1. The page loaded her ----------------------------------------------------------------
    const s1 = await renderer('01-original');
    report.steps.push(s1);
    if (!s1.managerUrl || !s1.managerUrl.split('?')[0].endsWith(character.file))
        fail('Correct asset selection', `the page loaded ${s1.managerUrl}`);
    if (s1.loadedSha256 !== avatarSha)
        fail('File integrity (SHA-256)', 'the bytes the renderer loaded are not her pinned file');
    if (s1.activeLook) fail('Original outfit restoration', 'a look is worn before anything was asked');
    if (s1.bones < 15) fail('Skeleton retention', `only ${s1.bones} humanoid bones were read from her file`);
    if (!s1.expressionCount) fail('Expression retention', 'no expressions were read from her file');
    if (!s1.faceHairMeshes) fail('Face and hair preservation', 'no face or hair meshes were found on her');
    report.identity = { bones: s1.bones, expressions: s1.expressionCount, faceHairMeshes: s1.faceHairMeshes };
    const shotOriginal = await shoot('01-original');

    // ---- 2. Try-On lists her looks, in this language --------------------------------------------
    await openTryOn();
    const listed = await page.evaluate(() => ({
        keys: Array.from(document.querySelectorAll('.nexus-look-rail-item[data-look-key]'), (n) =>
            n.getAttribute('data-look-key')
        ),
        // Two strings of the stage a person reads, and what the locale says they should be.
        more: (document.querySelector('.nexus-look-rail-edit') || {}).textContent || '',
        expectedMore: window.NEXUS_TRY_ON_LOCALE ? window.NEXUS_TRY_ON_LOCALE.tx('stage.more', '＋ More') : null,
        tryLabel: (
            document.querySelector('.nexus-look-rail-item[data-look-key]') || { getAttribute: () => '' }
        ).getAttribute('aria-label'),
        englishTry: 'Try ',
        appLang: localStorage.getItem('app_lang'),
    }));
    report.listed = listed;
    const others = CHARACTERS.map((c) => c.slug)
        .concat('avatar-sample-a')
        .filter((slug) => slug !== character.slug);
    const foreign = listed.keys.filter((key) => others.some((slug) => key.includes(`:${slug}:`)));
    if (foreign.length) fail('Correct asset selection', `another character's looks are offered: ${foreign.join(', ')}`);
    for (const look of [lookA, lookB]) {
        if (!listed.keys.some((key) => key.includes(`:${character.slug}:`) && key.endsWith(`:${look.id}`)))
            fail('Correct asset selection', `her look ${look.id} is not offered`);
    }
    ok('Correct asset selection');
    const italian = lang.startsWith('it');
    const language = italian ? 'Italian' : 'English';
    if (listed.more.trim() !== String(listed.expectedMore).trim())
        fail(language, `the stage shows "${listed.more.trim()}", the locale says "${listed.expectedMore}"`);
    if (italian && (listed.more.includes('More') || String(listed.tryLabel).startsWith(listed.englishTry)))
        fail('Italian', `Try-On is still in English ("${listed.more.trim()}", "${listed.tryLabel}")`);
    if (!italian && (!listed.more.includes('More') || !String(listed.tryLabel).startsWith(listed.englishTry)))
        fail('English', `Try-On shows "${listed.more.trim()}", "${listed.tryLabel}"`);
    ok(language);
    await shoot('02-try-on-open');

    /** Everything a worn look must satisfy; `from` is the state before the tap. */
    const expectWorn = (state, look, from, step) => {
        if (!state.activeLook || state.activeLook.id !== look.id)
            fail('Correct asset selection', `${step}: the controller wears ${JSON.stringify(state.activeLook)}`);
        if (state.activeLook && state.activeLook.avatarId && state.activeLook.avatarId !== character.slug)
            fail('Correct asset selection', `${step}: the worn look was fitted to ${state.activeLook.avatarId}`);
        if (!state.wornUrl || !state.wornUrl.startsWith('blob:'))
            fail('File integrity (SHA-256)', `${step}: not worn as verified bytes`);
        if (state.loadedSha256 !== look.sha256)
            fail(
                'File integrity (SHA-256)',
                `${step}: the renderer's bytes hash to ${state.loadedSha256}, the pack says ${look.sha256}`
            );
        if (state.managerUrl !== state.wornUrl)
            fail('Actual loaded renderer root', `${step}: the renderer's file is not the worn look`);
        if (state.rootUuid === from.rootUuid)
            fail('Actual loaded renderer root', `${step}: the renderer root did not change`);
        if (!state.rootInScene || !state.rootVisible)
            fail('Actual loaded renderer root', `${step}: the new root is not on stage`);
        if (state.bones !== s1.bones || state.boneNodes !== s1.boneNodes)
            fail('Skeleton retention', `${step}: humanoid rig differs from hers`);
        if (state.expressions !== s1.expressions) fail('Expression retention', `${step}: expressions differ from hers`);
        if (!state.faceHair || state.faceHair !== s1.faceHair)
            fail('Face and hair preservation', `${step}: face or hair meshes differ from hers`);
        if (JSON.stringify(state.camera) !== JSON.stringify(s1.camera))
            fail('Camera unmoved', `${step}: the camera moved`);
    };

    // ---- 3. Look 1, from her own outfit ----------------------------------------------------------
    await tap(lookA);
    await wearing(lookA).catch(() => fail('Correct asset selection', `look 1 (${lookA.id}) never landed`));
    await page.waitForTimeout(2500);
    const s3 = await renderer('03-look-1');
    report.steps.push(s3);
    expectWorn(s3, lookA, s1, 'look 1');
    const shotA = await shoot('03-look-1');
    if (Buffer.compare(shotA, shotOriginal) === 0)
        fail('Actual loaded renderer root', 'look 1: the picture did not change');

    // ---- 4. Look 2, from a look --------------------------------------------------------------------
    await tap(lookB);
    await wearing(lookB).catch(() => fail('Correct asset selection', `look 2 (${lookB.id}) never landed`));
    await page.waitForTimeout(2500);
    const s4 = await renderer('04-look-2');
    report.steps.push(s4);
    expectWorn(s4, lookB, s3, 'look 2');
    const shotB = await shoot('04-look-2');
    if (Buffer.compare(shotB, shotA) === 0) fail('Actual loaded renderer root', 'look 2: the picture did not change');
    ok('Actual loaded renderer root');
    ok('Skeleton retention');
    ok('Expression retention');
    ok('Face and hair preservation');

    // ---- 5/6. A failed download, then tampered bytes: refused, look 2 stays on ---------------------
    for (const [step, check, handler] of [
        [
            '05-failed-download',
            'Failed download rollback',
            (route) => route.fulfill({ status: 503, body: 'unavailable' }),
        ],
        [
            '06-tampered-bytes',
            'File integrity (SHA-256)',
            async (route) => {
                const response = await route.fetch();
                const body = Buffer.from(await response.body());
                body[body.length - 8] ^= 0xff; // one byte, in the binary chunk
                await route.fulfill({ response, body });
            },
        ],
    ]) {
        await page.route(lookPath(lookA), handler);
        const loadsBefore = (await renderer(`${step}-before`)).loads.length;
        await tap(lookA);
        await page.waitForTimeout(1500);
        await settled().catch(() => fail(check, `${step}: the wear never settled`));
        await page.waitForTimeout(2500);
        const after = await renderer(step);
        report.steps.push(after);
        await page.unroute(lookPath(lookA));
        if (!after.activeLook || after.activeLook.id !== lookB.id)
            fail(check, `${step}: she no longer wears look 2 (${JSON.stringify(after.activeLook)})`);
        if (after.rootUuid !== s4.rootUuid) fail(check, `${step}: the avatar on stage changed`);
        if (after.managerUrl !== s4.managerUrl || after.wornUrl !== s4.wornUrl)
            fail(check, `${step}: the renderer's file changed`);
        if (after.loads.length !== loadsBefore)
            fail(check, `${step}: something was loaded (${after.loads.slice(loadsBefore).length} loads)`);
        if (after.loadedSha256 !== lookB.sha256) fail(check, `${step}: what is on stage is no longer look 2's bytes`);
        if (step === '05-failed-download') await shoot('05-failed-download-kept-look-2');
    }
    ok('Failed download rollback');

    // ---- 7. A stale request cannot overwrite what she wears -----------------------------------------
    {
        let release;
        const held = new Promise((r) => (release = r));
        await page.route(lookPath(lookA), async (route) => {
            await held;
            await route.continue().catch(() => {});
        });
        const before = await renderer('07-before');
        await tap(lookA);
        await page
            .waitForFunction(() => window.NEXUS_WARDROBE.service.controller.pending, null, { timeout: 20000 })
            .catch(() => fail('Stale request handling', 'the held wear was never pending'));
        // The person changes their mind while it downloads. The rail greys out during a wear,
        // so the change is typed, as Try-On's own box takes it: the look's name.
        report.staleSecondChoice = await page.evaluate((key) => {
            const button = Array.from(document.querySelectorAll('.nexus-look-rail-item[data-look-key]')).find((n) =>
                n.getAttribute('data-look-key').endsWith(key)
            );
            const disabled = Boolean(button && button.disabled);
            // A disabled button does not answer a tap; its handler is the view's own wear().
            if (button) {
                button.disabled = false;
                button.click();
            }
            return { railDisabledWhilePending: disabled };
        }, `:${lookB.id}`);
        await page.waitForTimeout(1500);
        release();
        await page.waitForTimeout(9000);
        await settled().catch(() => fail('Stale request handling', 'the wear never settled'));
        const after = await renderer('07-stale');
        report.steps.push(after);
        await page.unroute(lookPath(lookA));
        const lateA = after.loads.slice(before.loads.length).filter((url) => lookOf(after, url) === lookA.id);
        if (lateA.length)
            fail('Stale request handling', `the superseded look reached the renderer (${lateA.length} loads)`);
        if (!after.activeLook || after.activeLook.id !== lookB.id)
            fail('Stale request handling', `she wears ${JSON.stringify(after.activeLook)}, not look 2`);
        if (after.loadedSha256 !== lookB.sha256) fail('Stale request handling', 'what is on stage is not look 2');
        if (after.pending) fail('Stale request handling', 'a wear is still pending');
        ok('Stale request handling');
        await shoot('07-stale-request-kept-look-2');
    }

    // ---- 8. End haul: her own outfit ------------------------------------------------------------------
    report.endedBy = await endHaul();
    await page
        .waitForFunction(
            (file) => {
                const m = window.NEXUS_VIEWER.avatarManager;
                const c = window.NEXUS_WARDROBE.service.controller;
                const current = m.getCurrent ? m.getCurrent() : m.current;
                return !c.activeLook && !c.pending && current && String(current.url).split('?')[0].endsWith(file);
            },
            character.file,
            { timeout: 240000 }
        )
        .catch(() => fail('Original outfit restoration', 'her own file never came back'));
    await page.waitForTimeout(2500);
    const s8 = await renderer('08-restored');
    report.steps.push(s8);
    if (s8.activeLook || s8.wornUrl) fail('Original outfit restoration', 'the controller still records a look');
    if (s8.managerUrl !== s1.managerUrl) fail('Original outfit restoration', `the renderer's file is ${s8.managerUrl}`);
    if (s8.loadedSha256 !== avatarSha)
        fail('Original outfit restoration', "what is on stage is not her pinned file's bytes");
    if (s8.boneNodes !== s1.boneNodes || s8.expressions !== s1.expressions || s8.faceHair !== s1.faceHair)
        fail('Original outfit restoration', 'not the same character');
    if (JSON.stringify(s8.camera) !== JSON.stringify(s1.camera))
        fail('Camera unmoved', 'the camera moved across the restore');
    ok('Original outfit restoration');
    ok('Camera unmoved');
    await shoot('08-restored-original');

    // ---- 9. Cancellation: the haul ends while a look is on its way -------------------------------------
    {
        await openTryOn();
        let release;
        const held = new Promise((r) => (release = r));
        await page.route(lookPath(lookA), async (route) => {
            await held;
            await route.continue().catch(() => {});
        });
        const before = await renderer('09-before');
        await tap(lookA);
        const pending = await page
            .waitForFunction(() => window.NEXUS_WARDROBE.service.controller.pending, null, { timeout: 20000 })
            .then(() => true)
            .catch(() => false);
        report.cancelPendingSeen = pending;
        report.cancelEndedBy = await endHaul();
        await page.waitForTimeout(1500);
        release();
        // Long enough for the held download to have finished and loaded, had it not been cancelled.
        await page.waitForTimeout(12000);
        await settled().catch(() => fail('Cancellation', 'the wear never settled'));
        const after = await renderer('09-cancelled');
        report.steps.push(after);
        await page.unroute(lookPath(lookA));
        const late = after.loads.slice(before.loads.length).filter((url) => url.startsWith('blob:'));
        if (!pending) fail('Cancellation', 'the wear was not pending when the haul ended (nothing was cancelled)');
        if (late.length) fail('Cancellation', `the cancelled look reached the renderer (${late.length} loads)`);
        if (after.activeLook || after.wornUrl) fail('Cancellation', 'a look is recorded after the cancel');
        if (after.managerUrl !== s1.managerUrl)
            fail('Cancellation', `the renderer's file is ${after.managerUrl}, not hers`);
        if (after.loadedSha256 !== avatarSha) fail('Cancellation', 'what is on stage is not her pinned file');
        ok('Cancellation');
        await shoot('09-cancelled-original');
    }

    const viewport = size === 'desktop' ? 'Desktop viewport (1440x900)' : '390 px viewport';
    const overflowing = report.steps.filter((s) => s.overflowX > 1);
    if (overflowing.length) fail(viewport, `horizontal overflow at ${overflowing.map((s) => s.label).join(', ')}`);
    const view = page.viewportSize();
    if (size === 'phone' && view.width !== 390) fail(viewport, `the viewport is ${view.width} px wide`);
    ok(viewport);
    if (report.forgeRequests.length) fail('No Forge request (pack only)', report.forgeRequests.slice(0, 3).join(', '));
    ok('No Forge request (pack only)');
    if (report.errors.length) fail('No page errors', report.errors.slice(0, 2).join(' | '));
    ok('No page errors');
    await ctx.close();
} catch (e) {
    report.errors.push(`driver: ${e && e.stack ? e.stack.slice(0, 700) : e}`);
    fail('driver', String(e && e.message));
} finally {
    await browser.close();
    server.stop();
}
// The per-step dumps are long; the report keeps what a reader checks and drops the load log.
for (const step of report.steps) {
    step.loads = step.loads.length;
    step.verified = step.verified.length;
}
report.passed = report.failures.length === 0;
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(
    JSON.stringify(
        { character: character.slug, size, lang, passed: report.passed, failures: report.failures, out },
        null,
        2
    )
);
process.exit(report.passed ? 0 : 1);
