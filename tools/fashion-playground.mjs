#!/usr/bin/env node
/**
 * FC2 / SW1. The NEXUS fashion playground: a look, a pose, a question about what is underneath,
 * and the colour changed on her — through the real UI, against a real Forge.
 *
 *     npm start                                         # this site
 *     uvicorn apps.api.main:app --port 8781             # Forge (FC2), in its own repository
 *     node tools/fashion-playground.mjs OUT_DIR --forge http://127.0.0.1:8781 [--url URL]
 *
 * The garments are Forge's, made by this run; the avatar is the viewer's; the pose is Pose
 * Studio's. One thing is not real and the report says so: NEXUS's replies. With no model key
 * in a test run, `window._nexusLLM.sendMessageStream` is replaced by a script that answers the
 * two questions of the scenario — but the system prompt the app built for each turn, wardrobe
 * paragraph included, is recorded as it was sent, and the `<wardrobe action="underneath"/>`
 * tag in the scripted answer goes through the app's own directive path like a model's would.
 *
 * Framing: the avatar is shown fully clothed, standing, and in Sitting (Wide) from the side.
 * No camera looks up a skirt.
 *
 * Writes OUT_DIR/report.json (Forge requests, the cloth correction's before/after numbers as
 * measured in the browser, the prompts, the timeline) and a screenshot per beat.
 */
import fs from 'node:fs';
import path from 'node:path';

const OUTFIT = 'black matte strapless bodycon mini dress + black stretch leather over-the-knee boots';
const QUESTION = 'Do you like my white lingerie with this dress, or would black look better?';
const STYLIST =
    'Black would be gorgeous with this dress—sleek, elegant, and beautifully coordinated with your boots. ' +
    'Want to try it?';
const AGREE = 'Yes, let’s try black!';
const OFFER =
    'Here you go — both colours side by side, with black picked for you.\n<wardrobe action="underneath" color="black"/>';
const AFTER = 'I love it. Black looks so polished with the boots — shall we save this one?';
const CLOSING = 'Saved! Black underneath keeps the whole look seamless. What should we try next?';

function args(argv) {
    const out = { dir: null, url: 'http://127.0.0.1:8090/', forge: null, size: '1600x900' };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--url') out.url = argv[++i];
        else if (a === '--forge') out.forge = argv[++i];
        else if (a === '--size') out.size = argv[++i];
        else out.dir = a;
    }
    if (!out.dir || !out.forge) {
        console.error('usage: node tools/fashion-playground.mjs OUT_DIR --forge URL [--url URL]');
        process.exit(2);
    }
    return out;
}

const opts = args(process.argv.slice(2));
fs.mkdirSync(opts.dir, { recursive: true });
const { chromium } = await import('playwright');
const [width, height] = opts.size.split('x').map(Number);
const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width, height } });
await context.addInitScript(
    ({ forge }) => {
        localStorage.setItem('wardrobe_forge_mode', 'custom');
        localStorage.setItem('wardrobe_forge_url', forge);
        localStorage.setItem('nexus_selected_avatar_file', 'fem_vroid.vrm');
        localStorage.setItem('nexus_wardrobe_ai_enabled', 'true');
        // An adult who has turned private mode on: the look has lingerie under it.
        localStorage.setItem('nexus_spicy_enabled', 'true');
        localStorage.setItem('nexus_spicy_verified', 'true');
        // FC1: she chose white underneath before this haul.
        localStorage.setItem('nexus_tryon_foundation_color', 'white');
        localStorage.setItem(
            'nexus_llm_settings',
            JSON.stringify({ provider: 'openai', openai: { api_key: 'playground-stub', model: 'stub' } })
        );
    },
    { forge: opts.forge }
);
const page = await context.newPage();
const report = { outfit: OUTFIT, timeline: [], forge: [], prompts: [], correction: {}, stubbed: 'NEXUS replies' };
const t00 = Date.now();
const log = (what, detail) => {
    const entry = { s: Math.round((Date.now() - t00) / 100) / 10, what, detail };
    report.timeline.push(entry);
    console.log(`+${entry.s}s ${what}${detail ? ': ' + detail : ''}`);
};
page.on('pageerror', (e) => report.timeline.push({ what: 'page error', detail: e.message }));
page.on('request', (r) => {
    if (r.url().startsWith(opts.forge) && r.method() === 'POST') {
        report.forge.push({ method: r.method(), url: r.url().replace(opts.forge, ''), body: r.postData() });
    }
});
// What Forge made, from its own answers: every completed job's look.
report.jobs = [];
page.on('response', async (r) => {
    if (!r.url().startsWith(opts.forge) || !/\/v1\/jobs\/job_/.test(r.url())) return;
    try {
        const job = await r.json();
        if (job.state === 'completed' && job.look && !report.jobs.some((j) => j.id === job.id)) {
            const options = (job.request && job.request.options) || {};
            report.jobs.push({
                id: job.id,
                look: job.look.id,
                name: job.look.name,
                vrmUrl: job.look.vrmUrl,
                outfit: job.request && job.request.outfit ? job.request.outfit.prompt : null,
                foundationColor: options.foundationColor || null,
                garments: ((job.plan && (job.plan.layers || job.plan.garments)) || []).map(
                    (g) => `${g.role}: ${g.name}`
                ),
                warnings: (job.fitReport && job.fitReport.warnings) || [],
            });
        }
    } catch (_) {
        // not JSON (an event stream): nothing to record
    }
});
const shot = (name) => page.screenshot({ path: path.join(opts.dir, `${name}.png`) });

/** Turn her to face `degrees` from the front, for a side view; 0 puts her back. */
const turnTo = (degrees) =>
    page.evaluate((deg) => {
        const root = window.NEXUS_VIEWER?.avatarManager?.currentRoot;
        if (!root) return false;
        if (root.userData.__playgroundYaw === undefined) root.userData.__playgroundYaw = root.rotation.y;
        root.rotation.y = root.userData.__playgroundYaw + (deg * Math.PI) / 180;
        return true;
    }, degrees);

const clothNumbers = () => page.evaluate(() => window.vrPoseSystem?.cloth?.last || null);

async function waitCorrected(previous, limitMs = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < limitMs) {
        const last = await clothNumbers();
        if (last && last !== previous && JSON.stringify(last) !== JSON.stringify(previous)) return last;
        await page.waitForTimeout(500);
    }
    return null;
}

async function applyPose(value) {
    if (!(await page.isVisible('#posePresetSelect').catch(() => false))) {
        await page.$eval('#openPoseStudioBtn', (e) => e.click()); // 🎭 in the avatar toolbar
        await page.waitForSelector('#posePresetSelect', { state: 'visible', timeout: 15000 });
    }
    await page.selectOption('#posePresetSelect', value);
    await page.click('#poseApplyBtn');
    await page.waitForTimeout(1200); // the blend
}

async function closePoseStudio() {
    if (await page.isVisible('#poseStudioCloseBtn').catch(() => false)) await page.click('#poseStudioCloseBtn');
}

async function ask(text) {
    await page.fill('#speech-text', text);
    await page.click('#speak-btn');
    log('asked NEXUS', text);
    await page.waitForTimeout(2500);
}

try {
    await page.goto(opts.url, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.NEXUS_VIEWER?.avatarManager?.currentRoot, null, { timeout: 180000 });
    await page.waitForFunction(() => typeof window.LLMManager === 'function', null, { timeout: 60000 });
    log('avatar on stage', 'fem_vroid');
    // The stub: NEXUS's words are scripted; the prompt the app built is kept as sent.
    await page.evaluate(
        ({ STYLIST, OFFER, AFTER, CLOSING }) => {
            window.__playgroundPrompts = [];
            // As the app makes it (main.js): one LLMManager, created on demand.
            window._nexusLLM = window._nexusLLM || new window.LLMManager();
            const stub = async (text, system, _history, onToken) => {
                window.__playgroundPrompts.push({ text, system });
                const t = String(text).toLowerCase();
                const reply = /lingerie|underneath/.test(t)
                    ? STYLIST
                    : /^yes/.test(t)
                      ? OFFER
                      : /saved|save/.test(t)
                        ? CLOSING
                        : AFTER;
                for (const word of reply.split(/(?<= )/)) {
                    onToken(word);
                    await new Promise((r) => setTimeout(r, 15));
                }
                return reply;
            };
            window.LLMManager.prototype.sendMessageStream = stub;
            window._nexusLLM.sendMessageStream = stub;
        },
        { STYLIST, OFFER, AFTER, CLOSING }
    );

    await page.click('#nexus-bd-together-launcher');
    await page.waitForSelector('.nexus-bd-together-tile', { timeout: 15000 });
    await page.$eval('.nexus-bd-together-tile[data-activity="try-on-haul"]', (e) => e.click());
    await page.waitForSelector('.nexus-look-rail-item', { state: 'attached', timeout: 90000 });
    log('Try-On open');

    // 1. The look, made by Forge, with white underneath (FC1).
    if (!(await page.isVisible('.nexus-try-on-composer input').catch(() => false))) {
        await page.click('.nexus-look-rail-edit');
        if (!(await page.isVisible('.nexus-try-on-composer input').catch(() => false))) {
            await page.getByRole('button', { name: 'Advanced' }).click();
        }
        await page.waitForSelector('.nexus-try-on-composer input', { timeout: 10000 });
    }
    await page.fill('.nexus-try-on-composer input', OUTFIT);
    await page.press('.nexus-try-on-composer input', 'Enter');
    log('asked Forge for the look', OUTFIT);
    await page.waitForFunction(() => (document.body.innerText || '').match(/look\s+\d+\s+of\s+\d+/i), null, {
        timeout: 20 * 60000,
        polling: 1000,
    });
    log('look landed');
    // Close the advanced panel so the stage and the conversation are what is on screen.
    // The rail's "Close ×" (it was "+ More") folds the workspace back to the Live conversation.
    const rail = page.locator('.nexus-look-rail-edit');
    if ((await rail.count()) && /Close/.test(await rail.first().innerText())) await rail.first().click();
    await page.waitForSelector('#speech-text', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(3000);
    report.correction.standing = await waitCorrected(null, 20000);
    await shot('01-dress-standing');

    // 2. Pose Studio → Sitting (Wide), seen from the side; cloth correction off, then on.
    let before = await clothNumbers();
    await applyPose('sittingWide');
    report.correction.sittingWide = await waitCorrected(before);
    log('Sitting (Wide) corrected', JSON.stringify(report.correction.sittingWide));
    await closePoseStudio();
    await turnTo(90);
    await page.waitForTimeout(800);
    await shot('02-sitting-wide-side-corrected');
    await page.evaluate(() => window.vrPoseSystem.cloth.release(window.vrPoseSystem.avatarRoot));
    await page.waitForTimeout(800);
    await shot('03-sitting-wide-side-skinning-only');
    // Put the correction back (a settled pose is corrected again).
    before = await clothNumbers();
    await page.evaluate(() => window.vrPoseSystem._settleCloth());
    await waitCorrected(before, 30000).catch(() => null);
    await turnTo(-90);
    await page.waitForTimeout(800);
    await shot('04-sitting-wide-other-side');
    await turnTo(0);

    // 3. Back to standing for the conversation: the fully clothed view.
    before = await clothNumbers();
    await applyPose('standing');
    await waitCorrected(before, 30000);
    await closePoseStudio();
    await ask(QUESTION);
    await shot('05-nexus-answers');

    // 4. She agrees: NEXUS's tag opens the White / Black chooser with black picked.
    await ask(AGREE);
    await page.waitForSelector('.nexus-under', { timeout: 15000 });
    log('chooser open', await page.$eval('.nexus-under', (e) => e.innerText.replace(/\s+/g, ' ').slice(0, 200)));
    await shot('06-white-black-product-cards');

    // 5. Try black: Forge recolours only what is underneath; "on" only once it has loaded.
    const forgeBefore = report.forge.length;
    await page.click('.nexus-under .nexus-under-primary');
    await page.waitForTimeout(800);
    await shot('07-making-it-black');
    await page.waitForSelector('.nexus-under-done, .nexus-under-error', { timeout: 10 * 60000 });
    const outcome = await page.$eval('.nexus-under', (e) => e.innerText.replace(/\s+/g, ' '));
    log('colour change', outcome.slice(0, 220));
    report.recolourRequests = report.forge.slice(forgeBefore);
    await page.waitForTimeout(3000);
    await shot('08-black-is-on');

    // 6. Compare, back, save, and carry on talking.
    const compare = page.locator('.nexus-under button', { hasText: /Compare with/ });
    if (await compare.count()) {
        await compare.first().click();
        await page.waitForTimeout(4000);
        await shot('09-compare-white');
        await page
            .locator('.nexus-under button', { hasText: /Back to/ })
            .first()
            .click();
        await page.waitForTimeout(4000);
    }
    await page.locator('.nexus-under button', { hasText: 'Save look' }).first().click();
    await page.waitForTimeout(800);
    await shot('10-saved');
    await ask('Saved — I love it!');
    await shot('11-conversation-continues');
} catch (error) {
    report.timeline.push({ what: 'stopped', detail: error.message.split('\n')[0] });
    console.error('stopped:', error.message.split('\n')[0]);
    await shot('99-stopped').catch(() => {});
} finally {
    report.prompts = await page.evaluate(() => window.__playgroundPrompts || []).catch(() => []);
    fs.writeFileSync(path.join(opts.dir, 'report.json'), JSON.stringify(report, null, 1));
    await browser.close();
}
