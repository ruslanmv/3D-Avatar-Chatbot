#!/usr/bin/env node
/**
 * BI4. Private body-state acceptance in the real renderer, through PrivateActionBridge only.
 *
 *   node tools/qa/private-body-state-acceptance.mjs --forge http://127.0.0.1:8092 --grant-file <file> \
 *        --look-id import-… [--character avatar-sample-a] [--state lingerie|bare] [--sha256 <hex>] \
 *        [--size desktop|phone] [--lang en-US|it-IT] [--out dir]
 *
 * Needs a Forge that holds an operator-imported body state for the character (Forge BI1) and a
 * read grant for her (Forge BI2). The app is given the grant, never the admin token. Nothing here
 * calls the wardrobe controller to wear anything: every change is the person's words, read by
 * the bridge, exactly as in a session. The controller and renderer are only *read*.
 *
 *   1. Private at level 4 (ConsentFlow's own Closer control, tapped three times as a person does):
 *      the wardrobe is available, she wears her own outfit; identity captured from the renderer.
 *   2. "Undress for me": the bridge picks her private imported state; the controller downloads it
 *      with the grant and checks its SHA-256; the renderer's root is that file (wornUrl = the
 *      verified blob, activeLook = the import), and her rig, expressions, face and hair are hers.
 *      The camera has not moved.
 *   3. "Take everything off": no bare state exists for her → honest refusal, nothing changes.
 *   4. "Get dressed again": her own outfit, the renderer root is her own file again.
 *   5. Failed download (Forge answers 503): refused, nothing changes.
 *   6. Wrong SHA-256 (the bytes are tampered in transit): refused before the loader, nothing changes.
 *   7. Cancelled: the download is held; the session ends while it waits; the look never reaches
 *      the renderer, and she is in her own outfit.
 * Screenshots are written to --out (keep them out of the repository). report.json, exit 1 on failure.
 *
 * BI6. `--character` and `--state`. The driver was written for one character and one state:
 * AvatarSample A, and a lingerie import, with step 3 asserting that asking for everything off
 * is refused because no bare state exists. Run as it was for another character it would have
 * tested A; run for a bare import it would have failed at step 3 on the import working.
 *
 * - `--character` is one of the five characters this app ships and pins to a Forge slug
 *   (`src/wardrobe/AvatarIdentity.js`). The page is opened on her, and step 1 checks that the
 *   renderer loaded her file and that its bytes are the pinned hash.
 * - `--state bare`: step 2 is the request for everything off and the import must be worn as
 *   `bare`; step 3 does not apply (there is a bare state) and is recorded as skipped. With
 *   `lingerie` (the default) every step is as before.
 * - The report records the SHA-256 of her own file and of the import as Forge serves it to the
 *   grant; `--sha256` states what the import must be, and a different file fails the run.
 *
 * It needs the import to exist: for a bare state that means a file a person reviewed, built or
 * delivered and imported by the operator (Forge `docs/qa/body-state-specs/`). Nothing here
 * makes one.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
};
const size = arg('--size', 'desktop');
const lang = arg('--lang', 'en-US');
const FORGE = arg('--forge', 'http://127.0.0.1:8092').replace(/\/$/, '');
const GRANT = fs.readFileSync(arg('--grant-file'), 'utf8').trim();
const LOOK_ID = arg('--look-id');
/** The characters this app ships and pins to a Forge slug (src/wardrobe/AvatarIdentity.js). */
const CHARACTERS = {
    'avatar-sample-a': {
        file: 'AvatarSample_A.vrm',
        sha256: 'b86b0b8a66d48911431d6f920a5211a974226f83aa672eca3f3dfade58ac346e',
    },
    'avatar-sample-b': {
        file: 'AvatarSample_B.vrm',
        sha256: '4a271bd3b5a3d19e054fd113ee154635b72e7141f4a8ccbcdba3c7f9cea6ee8d',
    },
    'avatar-sample-c': {
        file: 'AvatarSample_C.vrm',
        sha256: '395d5b04696e888f07bc856ae01bf72a974b7e773132c7443dc59d1688045b8a',
    },
    'fem-vroid': { file: 'fem_vroid.vrm', sha256: '983631034570b7a70e2f158e48f12fe7f0fe3ebcba763363efd6e85a2fbbacb8' },
    'masc-vroid': {
        file: 'masc_vroid.vrm',
        sha256: 'ac5e30b9f875b54b13cddbe86d6351b4a8d2d418c2f885d89199281ad5c937cb',
    },
};
const SLUG = arg('--character', 'avatar-sample-a');
const STATE = arg('--state', 'lingerie');
const EXPECTED_SHA = (arg('--sha256', '') || '').trim().toLowerCase();
const CHARACTER = CHARACTERS[SLUG];
if (!CHARACTER || !['lingerie', 'bare'].includes(STATE) || !LOOK_ID) {
    console.error(
        `--character must be one of ${Object.keys(CHARACTERS).join(', ')} (the characters this app ships; ` +
            'Model Girl, Rinna and AvatarSample_O are Forge library characters the app does not ship), ' +
            '--state lingerie or bare, and --look-id is required'
    );
    process.exit(2);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/wardrobe/runs', `${stamp}-${size}-${lang}`)));
fs.mkdirSync(out, { recursive: true });
const IT = lang.startsWith('it');
const SAY = {
    undress: IT ? 'Spogliati per me' : 'Undress for me',
    bare: IT ? 'Togliti tutto, ti voglio nuda' : 'Take everything off, I want you naked',
    redress: IT ? 'Rivestiti' : 'Get dressed again',
};

const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
const { playwright } = D.loadPlaywright();
const server = await D.ensureServer(arg('--url', 'http://127.0.0.1:8080').replace(/\/$/, ''));
const report = {
    size,
    lang,
    forge: FORGE,
    character: SLUG,
    state: STATE,
    lookId: LOOK_ID,
    steps: [],
    failures: [],
    errors: [],
};
const fail = (step, what) => report.failures.push(`${step}: ${what}`);
const lookUrl = `${FORGE}/v1/assets/looks/${LOOK_ID}/look.vrm`;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
// Her own file, as this app serves it, and the import, as Forge serves it to the grant: the
// two exact files this run is about, named by their bytes in the report.
report.avatarSha256 = sha256(fs.readFileSync(path.join(ROOT, 'vendor/avatars', CHARACTER.file)));
if (report.avatarSha256 !== CHARACTER.sha256)
    fail('source', `her file here is ${report.avatarSha256}, not the pinned one`);
try {
    const response = await fetch(lookUrl, { headers: { 'X-Wardrobe-Grant': GRANT } });
    if (!response.ok) fail('import', `Forge answered ${response.status} for the import with this grant`);
    else report.lookSha256 = sha256(Buffer.from(await response.arrayBuffer()));
} catch (error) {
    fail('import', `Forge could not be asked for the import: ${String(error && error.message)}`);
}
if (EXPECTED_SHA && report.lookSha256 && report.lookSha256 !== EXPECTED_SHA)
    fail('import', `the import is ${report.lookSha256}, not the reviewed file ${EXPECTED_SHA}`);

const browser = await playwright.chromium.launch({ args: D.SWIFTSHADER });
try {
    const ctx = await browser.newContext(
        size === 'desktop'
            ? { viewport: { width: 1440, height: 900 } }
            : {
                  viewport: { width: 390, height: 844 },
                  isMobile: true,
                  hasTouch: true,
                  userAgent: playwright.devices['Pixel 7'].userAgent,
                  deviceScaleFactor: 1,
              }
    );
    await ctx.addInitScript(
        ({ code, forge, grant, file }) => {
            localStorage.setItem('app_lang', code);
            // Her, as the avatar picker would have left it (main.js restores it by file name).
            localStorage.setItem('nexus_selected_avatar_file', file);
            localStorage.setItem('nexus_together_enabled', 'on');
            localStorage.setItem('nexus_spicy_enabled', 'true');
            localStorage.setItem('nexus_spicy_verified', 'true');
            localStorage.setItem('npc_enabled', 'false');
            localStorage.setItem('wardrobe_forge_mode', 'custom');
            localStorage.setItem('wardrobe_forge_url', forge);
            // BI2. The read grant, as Settings stores it. Never the admin token.
            localStorage.setItem('wardrobe_forge_grant', grant);
        },
        { code: lang, forge: FORGE, grant: GRANT, file: CHARACTER.file }
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(String(e.message).slice(0, 240)));
    // Every request to Forge, to prove the admin header never leaves the page.
    report.forgeRequests = [];
    page.on('request', (r) => {
        if (!r.url().startsWith(FORGE)) return;
        const h = r.headers();
        report.forgeRequests.push({
            url: r.url().slice(FORGE.length, FORGE.length + 90),
            grant: Boolean(h['x-wardrobe-grant']),
            admin: Boolean(h['x-wardrobe-admin']),
        });
    });
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
    // Record every model the manager is asked to load, in order (read-only hook).
    await page.evaluate(() => {
        const m = window.NEXUS_VIEWER.avatarManager;
        window.__loads = [];
        const original = m.setAvatarByUrl.bind(m);
        m.setAvatarByUrl = (url, ...rest) => {
            window.__loads.push(String(url).slice(0, 120));
            return original(url, ...rest);
        };
    });

    /** What the renderer is drawing, and who she is, read from the loaded VRM. */
    const renderer = (label) =>
        page.evaluate(
            ({ label, lookId }) => {
                const viewer = window.NEXUS_VIEWER;
                const m = viewer.avatarManager;
                const vrm = m._currentVRM || (m.vrmLoader && m.vrmLoader.currentVRM) || null;
                const controller = window.NEXUS_WARDROBE?.service?.controller || null;
                const bones = vrm && vrm.humanoid ? Object.keys(vrm.humanoid.humanBones || {}).sort() : [];
                const boneNodes =
                    vrm && vrm.humanoid
                        ? bones.map((b) => (vrm.humanoid.humanBones[b] && vrm.humanoid.humanBones[b].node?.name) || '')
                        : [];
                const expressions =
                    vrm && vrm.expressionManager
                        ? (vrm.expressionManager.expressions || []).map((e) => e.expressionName).sort()
                        : [];
                const meshes = [];
                m.currentRoot.traverse((o) => {
                    if (o.isMesh && /face|hair/i.test(o.name || '')) meshes.push(o.name);
                });
                const A = window.NEXUS_PRIVATE_ACTIONS;
                const w = A.log()
                    .filter((a) => a.family === 'wardrobe')
                    .pop();
                const cam = viewer.camera.position;
                return {
                    label,
                    rootUuid: m.currentRoot.uuid,
                    managerUrl: m.current && m.current.url ? String(m.current.url).slice(0, 120) : null,
                    wornUrl: controller && controller.wornUrl ? String(controller.wornUrl).slice(0, 120) : null,
                    originalUrl: controller && controller.original ? controller.original.url : null,
                    activeLook:
                        controller && controller.activeLook
                            ? {
                                  lookId: controller.activeLook.lookId || controller.activeLook.id,
                                  state: controller.activeLook.wardrobeState || null,
                                  origin: controller.activeLook.origin || null,
                                  private: Boolean(controller.activeLook.private),
                              }
                            : null,
                    wearingImport: Boolean(
                        controller &&
                            controller.activeLook &&
                            (controller.activeLook.lookId || controller.activeLook.id) === lookId
                    ),
                    bones: bones.length,
                    boneNodes: boneNodes.join('|'),
                    expressions: expressions.join('|'),
                    faceHair: meshes.sort().join('|'),
                    camera: [cam.x, cam.y, cam.z].map((v) => Math.round(v * 1000) / 1000),
                    wardrobe: w ? { name: w.name, status: w.status, why: w.why || null } : null,
                    // UN19. original | look | lingerie | bare: what is on her, as the bridge states it.
                    outfitState: A.snapshot().outfitState || null,
                    outfit: A.snapshot().outfit || null,
                    loads: window.__loads.slice(),
                    overflowX: document.documentElement.scrollWidth - window.innerWidth,
                };
            },
            { label, lookId: LOOK_ID }
        );
    const shoot = (label) => page.screenshot({ path: path.join(out, `${size}-${lang}-${label}.png`) });
    const say = (text) => page.evaluate((t) => window.NEXUS_CONVERSATION_SURFACE.renderUser(t), text);
    const settle = async (step, previousCount) => {
        await page
            .waitForFunction(
                (n) => {
                    const all = window.NEXUS_PRIVATE_ACTIONS.log().filter((a) => a.family === 'wardrobe');
                    const w = all[all.length - 1];
                    return all.length > n && w && w.status !== 'pending';
                },
                previousCount,
                { timeout: 180000 }
            )
            .catch(() => fail(step, 'the wardrobe action never settled'));
        await page.waitForTimeout(2500);
    };
    const wardrobeCount = () =>
        page.evaluate(() => window.NEXUS_PRIVATE_ACTIONS.log().filter((a) => a.family === 'wardrobe').length);

    // 1. Private, level 4.
    await page.evaluate(async () => {
        const panel = window.NEXUS_BD.togetherPanel;
        const a = panel.activities.get('intimate');
        if (a.setAtmosphere) a.setAtmosphere({ world: 'private-cabaret' });
        const opt = (panel.contractFor('intimate')?.inputs() || []).find((x) => x.id === 'mature') || { id: 'mature' };
        await panel.startActivity('intimate', opt);
    });
    await page.waitForFunction(() => window.NEXUS_PRIVATE_ACTIONS.snapshot().story, null, { timeout: 60000 });
    for (let i = 0; i < 3; i += 1) {
        await page.waitForTimeout(4600);
        await page.click('[data-private-action="closer"]').catch(() => fail('level', `Closer tap ${i + 1} failed`));
    }
    await page.waitForTimeout(1500);
    const s1 = await renderer('01-original');
    report.steps.push(s1);
    if (s1.activeLook) fail('original', 'a look is worn before anything was asked');
    if (!s1.managerUrl || !s1.managerUrl.split('?')[0].endsWith(CHARACTER.file))
        fail('original', `the page loaded ${s1.managerUrl}, not ${CHARACTER.file}`);
    await shoot('01-original');

    // 2. Undress → her private imported body state (for a bare import: everything off).
    const ASK = STATE === 'bare' ? SAY.bare : SAY.undress;
    let n = await wardrobeCount();
    await say(ASK);
    await settle('undress', n);
    const s2 = await renderer('02-imported-state');
    report.steps.push(s2);
    if (!s2.wardrobe || s2.wardrobe.status !== 'completed')
        fail('undress', `not completed: ${JSON.stringify(s2.wardrobe)}`);
    if (!s2.wearingImport) fail('undress', `the worn look is not the import: ${JSON.stringify(s2.activeLook)}`);
    if (!s2.wornUrl || !s2.wornUrl.startsWith('blob:')) fail('undress', 'not worn as verified bytes');
    if (s2.managerUrl !== s2.wornUrl) fail('undress', 'the renderer root is not the selected asset');
    if (s2.rootUuid === s1.rootUuid) fail('undress', 'the renderer root did not change');
    if (s2.outfitState !== STATE) fail('undress', `bridge says ${s2.outfitState}, not ${STATE}`);
    if (s2.activeLook && s2.activeLook.state && s2.activeLook.state !== STATE)
        fail('undress', `the import is recorded as ${s2.activeLook.state}, not ${STATE}`);
    if (s2.boneNodes !== s1.boneNodes) fail('identity', 'humanoid rig differs from hers');
    if (s2.expressions !== s1.expressions) fail('identity', 'expressions differ from hers');
    if (!s2.faceHair || s2.faceHair !== s1.faceHair) fail('identity', 'face/hair meshes differ from hers');
    if (JSON.stringify(s2.camera) !== JSON.stringify(s1.camera)) fail('camera', 'the camera moved across the swap');
    await shoot('02-imported-state');

    // 3. Everything off: no bare state for her → honest refusal, nothing changes. Only when the
    // import under test is not itself the bare state.
    if (STATE === 'bare') {
        report.skipped = ['03-bare-refused: the import under test is the bare state'];
    } else {
        n = await wardrobeCount();
        await say(SAY.bare);
        await settle('bare', n);
        const s3 = await renderer('03-bare-refused');
        report.steps.push(s3);
        if (s3.wardrobe && s3.wardrobe.status === 'completed' && s3.wardrobe.name !== 'wardrobe.pace')
            fail('bare', `claimed success with no bare state: ${JSON.stringify(s3.wardrobe)}`);
        if (s3.rootUuid !== s2.rootUuid) fail('bare', 'the avatar changed on a refused request');
        if (!s3.wardrobe || s3.wardrobe.why !== 'no-bare-look')
            fail('bare', `expected no-bare-look: ${JSON.stringify(s3.wardrobe)}`);
        if (s3.outfitState !== 'lingerie') fail('bare', `bridge says ${s3.outfitState} after a refused bare request`);
    }

    // 4. Redress → her own outfit.
    n = await wardrobeCount();
    await say(SAY.redress);
    await settle('redress', n);
    const s4 = await renderer('04-restored');
    report.steps.push(s4);
    if (!s4.wardrobe || s4.wardrobe.status !== 'completed')
        fail('redress', `not completed: ${JSON.stringify(s4.wardrobe)}`);
    if (s4.activeLook) fail('redress', 'controller still records a look');
    if (s4.outfitState !== 'original') fail('redress', `bridge says ${s4.outfitState}, not original`);
    if (s4.managerUrl !== s1.managerUrl) fail('redress', `renderer root is ${s4.managerUrl}, not her file`);
    if (s4.boneNodes !== s1.boneNodes || s4.expressions !== s1.expressions) fail('redress', 'not the same character');
    if (JSON.stringify(s4.camera) !== JSON.stringify(s1.camera)) fail('camera', 'the camera moved across the restore');
    await shoot('04-restored');

    // 5/6. A failed download, then tampered bytes: refused, nothing changes.
    for (const [step, handler] of [
        ['05-failed-download', (route) => route.fulfill({ status: 503, body: 'unavailable' })],
        [
            '06-wrong-sha',
            async (route) => {
                const response = await route.fetch();
                const body = Buffer.from(await response.body());
                body[body.length - 8] ^= 0xff; // one byte, in the binary chunk
                await route.fulfill({ response, body });
            },
        ],
    ]) {
        await page.route(lookUrl, handler);
        const before = await renderer(step + '-before');
        n = await wardrobeCount();
        await say(ASK);
        await settle(step, n);
        const after = await renderer(step);
        report.steps.push(after);
        await page.unroute(lookUrl);
        if (after.wardrobe && after.wardrobe.status === 'completed' && after.wardrobe.name === 'wardrobe.undress')
            fail(step, 'reported success');
        if (after.outfitState !== before.outfitState)
            fail(step, `bridge says ${after.outfitState} after a download that did not arrive`);
        if (after.rootUuid !== before.rootUuid) fail(step, 'the avatar changed');
        if (after.activeLook) fail(step, 'a look was recorded as worn');
    }

    // 7. Cancelled: the download is held, the session ends while it waits.
    let release;
    const held = new Promise((r) => (release = r));
    await page.route(lookUrl, async (route) => {
        await held;
        await route.continue().catch(() => {});
    });
    const loadsBefore = (await renderer('07-before')).loads.length;
    await say(ASK);
    await page.waitForTimeout(3000);
    const pending = await page.evaluate(() => Boolean(window.NEXUS_WARDROBE?.service?.controller?.pending));
    report.cancelPendingSeen = pending;
    await page.evaluate(() => window.NEXUS_BD.intimate.stop('user'));
    await page.waitForTimeout(1500);
    release();
    await page.waitForTimeout(8000);
    const s7 = await renderer('07-cancelled');
    report.steps.push(s7);
    await page.unroute(lookUrl);
    const late = s7.loads.slice(loadsBefore).filter((u) => u.startsWith('blob:'));
    if (!pending) fail('cancel', 'the wear was not pending when the session ended (nothing was cancelled)');
    if (late.length) fail('cancel', `the cancelled look reached the renderer: ${late.join(', ')}`);
    if (s7.activeLook) fail('cancel', 'a look is recorded after the cancel');
    if (s7.managerUrl !== s1.managerUrl) fail('cancel', `renderer root is ${s7.managerUrl}, not her file`);
    await shoot('07-cancelled');

    if (report.forgeRequests.some((r) => r.admin)) fail('privacy', 'the page sent an admin header to Forge');
    if (!report.forgeRequests.some((r) => r.grant && /looks\/import-/.test(r.url)))
        fail('privacy', 'the private look was not fetched with the grant');
    if (report.steps.some((s) => s.overflowX > 1)) fail('layout', 'horizontal overflow');
    await ctx.close();
} catch (e) {
    report.errors.push(`driver: ${e && e.stack ? e.stack.slice(0, 600) : e}`);
    fail('driver', String(e && e.message));
} finally {
    await browser.close();
    server.stop();
}
report.passed = report.failures.length === 0;
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(
    JSON.stringify(
        {
            character: SLUG,
            state: STATE,
            size,
            lang,
            avatarSha256: report.avatarSha256,
            lookSha256: report.lookSha256 || null,
            passed: report.passed,
            failures: report.failures,
            out,
        },
        null,
        2
    )
);
process.exit(report.passed ? 0 : 1);
