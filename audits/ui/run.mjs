#!/usr/bin/env node
/**
 * UI1. A tour of the menu and Pose Studio: every screen opened, shot, and checked that it works.
 *
 *   npm run audit:ui
 *   node audits/ui/run.mjs --size desktop          # 1280×900 instead of a phone
 *
 * Two parts, in a fresh page with Private Mode off (so its adult entries stay hidden, as they do
 * for anyone who has not turned it on), at a phone's size by default:
 *
 *   1. The menu (☰ drawer): Avatar Manager, Upload Custom Avatar, Settings, Voice & Speech, Clear
 *      Chat, VR / AR Mode, Reset View, Companion, Pose Studio, Face Tracking, Tracking Settings,
 *      Fullscreen, Together, About, GitHub. Each from a freshly loaded page, so one screen left
 *      open cannot pass or fail the next. Each must do the thing it names — a dialog opens, a file
 *      picker is offered, the camera returns, the chat is emptied, a link leads where it says — or,
 *      where this browser cannot (no headset, no picture-in-picture), say so without a page error.
 *   2. Pose Studio: every Pose Navigator preset (her skeleton must change, nothing may go to NaN),
 *      T-pose intensity, Natural Pose Style, pose list Apply and Reset All, both editing toggles,
 *      a bone's three sliders and Reset Selected, Mirror Arms, Save Pose then Undo and Redo, each
 *      Behavior (Live) mode except the Spicy ones (she must move), a VRMA and a BVH clip.
 *
 * Output: audits/ui/runs/<stamp>/ — report.md, report.json, index.html, shots/ (git-ignored).
 * Exit 0 when nothing fails. A QA tool: the app never loads it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const arg = (f, d) => (argv.includes(f) && argv[argv.indexOf(f) + 1] ? argv[argv.indexOf(f) + 1] : d);
const SIZE = arg('--size', 'phone');
const VIEWPORT = SIZE === 'desktop' ? { width: 1280, height: 900 } : { width: 412, height: 915 };

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(HERE, 'runs', stamp);
const SHOTS = path.join(OUT, 'shots');
const rows = [];

function record(area, name, ok, detail, shotFile, warn = false) {
    const verdict = ok ? (warn ? 'warn' : 'ok') : 'fail';
    rows.push({ area, name, verdict, detail, shot: shotFile || null });
    console.log(`${verdict.padEnd(4)} ${area.padEnd(11)} ${name.padEnd(26)} ${detail}`);
}

async function shot(page, file) {
    await page.screenshot({ path: path.join(SHOTS, file), type: 'jpeg', quality: 70 });
    return 'shots/' + file;
}

/** In the page: what is on screen, her bones, the camera. */
function helpers() {
    const vrm = () => window.NEXUS_VIEWER?.avatarManager?._currentVRM;
    const BONES = [
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
    ];
    window.__ui = {
        visible() {
            const shown = (el) => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return (
                    r.width > 20 &&
                    r.height > 20 &&
                    s.visibility !== 'hidden' &&
                    s.display !== 'none' &&
                    Number(s.opacity) > 0.05
                );
            };
            const sel =
                'dialog[open], [role="dialog"], .modal, [id$="-modal"], [id$="Root"], [id$="-panel"], [class*="panel"], [class*="overlay"]';
            return [...document.querySelectorAll(sel)]
                .filter(shown)
                .map((el) => el.id || el.className.toString().split(' ')[0])
                .filter(Boolean);
        },
        quats() {
            const v = vrm();
            if (!v) return [];
            v.scene.updateMatrixWorld(true);
            return BONES.map((b) => {
                const n = v.humanoid.getRawBoneNode(b);
                return n ? n.quaternion.toArray().map((x) => +x.toFixed(4)) : null;
            });
        },
        diffDeg(a, b) {
            let m = 0;
            for (let i = 0; i < a.length; i++) {
                if (!a[i] || !b[i]) continue;
                const d = Math.abs(a[i][0] * b[i][0] + a[i][1] * b[i][1] + a[i][2] * b[i][2] + a[i][3] * b[i][3]);
                m = Math.max(m, 2 * Math.acos(Math.min(1, d)) * 57.2958);
            }
            return m;
        },
        finite() {
            return this.quats().every((q) => !q || q.every((x) => Number.isFinite(x)));
        },
        camera() {
            const p = window.NEXUS_VIEWER?.camera?.position;
            return p ? [p.x, p.y, p.z].map((x) => +x.toFixed(3)) : null;
        },
        chatCount() {
            const h = document.getElementById('chat-history');
            return h ? h.children.length : -1;
        },
    };
}

async function freshPage(D, browser, base, errors) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, permissions: ['camera', 'microphone'] });
    const page = await ctx.newPage();
    page.setDefaultTimeout(120000);
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    page.on('dialog', (d) => d.accept().catch(() => null)); // a "clear the chat?" confirm is the person saying yes
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await D.waitForApp(page, 180000);
    await page.waitForFunction(() => window.NEXUS_VIEWER?.avatarManager?._currentVRM);
    await page.waitForTimeout(2000);
    await page.evaluate(helpers);
    return page;
}

async function openDrawer(page) {
    const btn = page.locator('#mobile-menu-btn');
    if (await btn.isVisible().catch(() => false)) await btn.click();
    await page.waitForTimeout(500);
}

/** The menu: each item from a fresh page. `check` answers [ok, detail, warn?]. */
const MENU = [
    [
        'Avatar Manager',
        'a.drawer-nav-item[href="vrm-manager.html"]',
        async (page, base) => {
            const status = await page.evaluate(async (u) => (await fetch(u)).status, base + '/vrm-manager.html');
            return [status === 200, `vrm-manager.html answers ${status}`];
        },
        { noClick: true },
    ],
    ['Upload Custom Avatar', '#drawer-upload-btn', null, { fileChooser: true }],
    [
        'Settings',
        '#drawer-settings-btn',
        async (page) => {
            const open = await page.locator('#settings-modal').isVisible();
            return [open, open ? 'settings dialog open' : 'settings dialog did not open'];
        },
    ],
    ['Voice & Speech', '#drawer-voice-btn'],
    ['Clear Chat', '#drawer-clear-btn', null, { clearChat: true }],
    ['VR / AR Mode', '#drawer-vr-btn', null, { mayBeUnsupported: 'no headset in this browser' }],
    ['Reset View', '#drawer-reset-view-btn', null, { resetView: true }],
    ['Companion', '#drawer-companion-btn', null, { mayBeUnsupported: 'no picture-in-picture in a headless browser' }],
    [
        'Pose Studio',
        '#drawer-pose-studio-btn',
        async (page) => {
            const open = await page.locator('#poseStudioRoot').isVisible();
            return [open, open ? 'Pose Studio open' : 'Pose Studio did not open'];
        },
    ],
    ['Face Tracking', '#drawer-face-track-btn', null, { mayBeUnsupported: 'a fake camera here' }],
    ['Tracking Settings', '#drawer-tracking-settings-btn'],
    [
        'Fullscreen',
        '#drawer-fullscreen-btn',
        async (page) => {
            const fs = await page.evaluate(() => Boolean(document.fullscreenElement));
            return [true, fs ? 'fullscreen on' : 'fullscreen refused by the headless browser (no error)', !fs];
        },
    ],
    ['Together', '#drawer-together-btn, .drawer-nav-item:has-text("Together")'],
    ['About', '#drawer-info-btn'],
    [
        'GitHub',
        '.drawer-nav-item[href*="github.com"], a[href*="github.com/ruslanmv/3D-Avatar-Chatbot"]',
        async (page, base, el) => {
            const href = await el.getAttribute('href');
            return [/github\.com\/ruslanmv\/3D-Avatar-Chatbot/.test(href || ''), `links to ${href}`];
        },
        { noClick: true },
    ],
];

async function tourMenu(D, browser, base) {
    let n = 0;
    for (const [name, selector, check, opts = {}] of MENU) {
        n += 1;
        const errors = [];
        const page = await freshPage(D, browser, base, errors);
        try {
            if (n === 1) {
                await openDrawer(page);
                record('menu', 'the menu itself', true, 'drawer open', await shot(page, '00-menu.jpg'));
            } else await openDrawer(page);
            const el = page.locator(selector).first();
            if (!(await el.count())) {
                record('menu', name, false, `no "${selector}" in the page`);
                continue;
            }
            const before = await page.evaluate(() => ({
                v: window.__ui.visible(),
                cam: window.__ui.camera(),
                chat: window.__ui.chatCount(),
            }));
            let result = null;
            if (opts.resetView) {
                // Move the camera away first, then the item must bring it back.
                await page.evaluate(() => {
                    const c = window.NEXUS_VIEWER.camera;
                    c.position.x += 1.2;
                    c.position.y += 0.6;
                    window.NEXUS_VIEWER.controls?.update?.();
                });
            }
            if (opts.clearChat) {
                await page.evaluate(() => {
                    const h = document.getElementById('chat-history');
                    if (h)
                        for (let i = 0; i < 3; i++)
                            h.appendChild(
                                Object.assign(document.createElement('div'), {
                                    className: 'message',
                                    textContent: 'test ' + i,
                                })
                            );
                });
            }
            if (opts.fileChooser) {
                const chooser = page
                    .waitForEvent('filechooser', { timeout: 5000 })
                    .then(() => true)
                    .catch(() => false);
                await el.click();
                result = (await chooser) ? [true, 'file picker offered'] : [false, 'no file picker'];
            } else if (!opts.noClick) {
                await el.click();
            }
            await page.waitForTimeout(1800);
            const after = await page.evaluate(() => ({
                v: window.__ui.visible(),
                cam: window.__ui.camera(),
                chat: window.__ui.chatCount(),
            }));
            const shotFile = await shot(page, `${String(n).padStart(2, '0')}-${name.replace(/[^A-Za-z]+/g, '-')}.jpg`);
            if (!result && check) result = await check(page, base, el);
            if (!result && opts.resetView) {
                const moved =
                    before.cam && after.cam && Math.hypot(...after.cam.map((x, i) => x - before.cam[i])) < 0.05;
                result = [!moved, moved ? 'camera did not move back' : `camera reset (now ${after.cam})`];
            }
            if (!result && opts.clearChat) result = [after.chat === 0, `messages left: ${after.chat}`];
            if (!result) {
                const opened = after.v.filter((x) => !before.v.includes(x));
                if (opened.length) result = [true, `opened ${opened.slice(0, 3).join(', ')}`];
                else if (opts.mayBeUnsupported) result = [true, `nothing opened (${opts.mayBeUnsupported})`, true];
                else result = [false, 'nothing visible changed'];
            }
            if (errors.length) result = [false, `${result[1]}; page error: ${errors[0]}`];
            record('menu', name, result[0], result[1], shotFile, Boolean(result[2]));
        } catch (e) {
            record('menu', name, false, `could not run: ${String(e.message || e).slice(0, 160)}`);
        } finally {
            await page.context().close();
        }
    }
}

async function tourPoseStudio(D, browser, base) {
    const errors = [];
    const page = await freshPage(D, browser, base, errors);
    const changed = async (fn, label) => {
        const a = await page.evaluate(() => window.__ui.quats());
        await fn();
        await page.waitForTimeout(900);
        const b = await page.evaluate(() => window.__ui.quats());
        const deg = await page.evaluate(([x, y]) => window.__ui.diffDeg(x, y), [a, b]);
        return { deg, finite: await page.evaluate(() => window.__ui.finite()), label };
    };
    try {
        await openDrawer(page);
        await page.locator('#drawer-pose-studio-btn').click();
        await page.waitForTimeout(1500);
        record(
            'pose studio',
            'open',
            await page.locator('#poseStudioRoot').isVisible(),
            'panel shown',
            await shot(page, 'ps-00-open.jpg')
        );

        // Pose Navigator: every preset it offers with Private off.
        const catalogue = await page.evaluate(() =>
            (window.NEXUS_POSE_STUDIO_PANEL?.catalogue?.() || []).map((p) => [p.label, Boolean(p.adult)])
        );
        const adultLabels = new Set(catalogue.filter(([, a]) => a).map(([l]) => l));
        const counter = await page.locator('#poseNavCounter').innerText();
        const total = Number((counter.match(/\/\s*(\d+)/) || [])[1] || 0);
        let navOk = 0;
        const navBad = [];
        for (let i = 0; i < total; i++) {
            const label = await page.locator('#poseNavLabel').innerText();
            if (adultLabels.has(label)) {
                navBad.push(`${label}: an adult preset shown with Private off`);
            } else {
                const r = await changed(() => page.locator('#poseNavNext').click(), label);
                if (!r.finite) navBad.push(`${label}: bones not finite`);
                else navOk++;
                if (i % 4 === 0 || i === total - 1) await shot(page, `ps-nav-${String(i + 1).padStart(2, '0')}.jpg`);
                continue;
            }
            await page.locator('#poseNavNext').click();
        }
        const after = await page.locator('#poseNavCounter').innerText();
        record(
            'pose studio',
            'Pose Navigator',
            navBad.length === 0 && total > 0,
            `${navOk}/${total} presets applied cleanly, counter back to "${after}"${navBad.length ? '; ' + navBad.slice(0, 3).join('; ') : ''}`,
            'shots/ps-nav-01.jpg'
        );

        // T-pose intensity and Natural Pose Style.
        const slider = async (sel, value) =>
            page.evaluate(
                ([s, v]) => {
                    const el = document.querySelector(s);
                    el.value = String(v);
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                },
                [sel, value]
            );
        let r = await changed(() => slider('#poseTposeIntensitySlider', 0), 'intensity 0');
        const label0 = await page.locator('#poseTposeIntensityValue').innerText();
        await slider('#poseTposeIntensitySlider', 100);
        record(
            'pose studio',
            'T-Pose intensity',
            r.deg > 2 && /0\.00/.test(label0),
            `0 → arms moved ${r.deg.toFixed(1)}°, label "${label0}"`,
            await shot(page, 'ps-01-intensity.jpg')
        );
        const styles = await page.locator('#poseTposePresetSelect option').count();
        r = await changed(
            () => page.selectOption('#poseTposePresetSelect', { index: Math.min(1, styles - 1) }),
            'style'
        );
        record(
            'pose studio',
            'Natural Pose Style',
            styles > 0 && r.finite,
            `${styles} styles; second moved her ${r.deg.toFixed(1)}°`,
            null,
            r.deg < 0.5
        );
        await page.selectOption('#poseTposePresetSelect', { index: 0 });

        // Pose list: Apply then Reset All.
        const poses = await page.locator('#posePresetSelect option').count();
        await page.selectOption('#posePresetSelect', { index: Math.min(2, poses - 1) });
        r = await changed(() => page.locator('#poseApplyBtn').click(), 'apply');
        const reset = await changed(() => page.locator('#poseResetBtn').click(), 'reset');
        record(
            'pose studio',
            'Poses: Apply / Reset All',
            r.deg > 2 && reset.deg > 2,
            `${poses} poses; Apply moved her ${r.deg.toFixed(1)}°, Reset All ${reset.deg.toFixed(1)}°`,
            await shot(page, 'ps-02-apply.jpg')
        );

        // Editing toggles.
        for (const [id, name] of [
            ['#poseMouseEditToggle', 'Mouse Bone Editing'],
            ['#posePuppetToggle', 'Puppet Mode'],
        ]) {
            const was = await page.locator(id).isChecked();
            await page.locator(id).click({ force: true });
            const now = await page.locator(id).isChecked();
            await page.locator(id).click({ force: true });
            record('pose studio', name, was !== now, `toggles ${was} → ${now} and back`);
        }

        // A bone's sliders, then Reset Selected.
        await page
            .selectOption('#poseBoneSelect', { label: 'Head' })
            .catch(() => page.selectOption('#poseBoneSelect', { index: 0 }));
        const axes = [];
        for (const [axis, v] of [
            ['X', 30],
            ['Y', 30],
            ['Z', 40],
        ]) {
            r = await changed(() => slider(`#poseSlider${axis}`, v), axis);
            axes.push(`${axis} ${r.deg.toFixed(0)}° (label ${await page.locator(`#poseValue${axis}`).innerText()})`);
        }
        const moved = axes.every((a) => !/^\w 0°/.test(a));
        r = await changed(() => page.locator('#poseResetSelectedBtn').click(), 'reset selected');
        record('pose studio', 'Selected bone sliders', moved, axes.join(', '), await shot(page, 'ps-03-bone.jpg'));
        record('pose studio', 'Reset Selected', r.deg > 2, `put the head back ${r.deg.toFixed(1)}°`);

        // Mirror Arms: bend one arm, mirror it.
        await page.selectOption('#poseBoneSelect', { label: 'Left Upper Arm' }).catch(() => null);
        await slider('#poseSliderZ', 50);
        r = await changed(() => page.locator('#poseMirrorBtn').click(), 'mirror');
        record(
            'pose studio',
            'Mirror Arms',
            r.deg > 2,
            `the other arm followed ${r.deg.toFixed(1)}°`,
            await shot(page, 'ps-04-mirror.jpg')
        );

        // Save Pose, Undo, Redo.
        const before = await page.locator('#posePresetSelect option').count();
        await page.fill('#poseSaveName', 'UI tour pose');
        await page.locator('#poseSaveBtn').click();
        await page.waitForTimeout(600);
        const saved = await page.locator('#posePresetSelect option').count();
        const hasIt = await page.locator('#posePresetSelect option', { hasText: 'UI tour pose' }).count();
        record(
            'pose studio',
            'Save Pose',
            saved > before || hasIt > 0,
            `pose list ${before} → ${saved}${hasIt ? ', "UI tour pose" listed' : ''}`
        );
        const undo = await changed(() => page.locator('#poseUndoBtn').click(), 'undo');
        const redo = await changed(() => page.locator('#poseRedoBtn').click(), 'redo');
        record(
            'pose studio',
            'Undo / Redo',
            undo.deg > 1 && redo.deg > 1,
            `Undo moved her ${undo.deg.toFixed(1)}°, Redo ${redo.deg.toFixed(1)}°`
        );
        await page.locator('#poseResetBtn').click();
        await page.evaluate(() => {
            // The tour's saved pose is this browser's only; take it back out.
            for (const k of Object.keys(localStorage))
                if (/pose/i.test(k) && (localStorage.getItem(k) || '').includes('UI tour pose'))
                    localStorage.removeItem(k);
        });

        // Behavior (Live): every mode outside Spicy must make her move.
        const chips = page.locator('#poseAnimGridEmotes .pose-anim-chip');
        const count = await chips.count();
        for (let i = 0; i < count; i++) {
            const chip = chips.nth(i);
            const name = (await chip.innerText()).replace(/\s+/g, ' ').trim();
            const a = await page.evaluate(() => window.__ui.quats());
            await chip.click();
            let deg = 0;
            for (let k = 0; k < 6; k++) {
                await page.waitForTimeout(400);
                const b = await page.evaluate(() => window.__ui.quats());
                deg = Math.max(deg, await page.evaluate(([x, y]) => window.__ui.diffDeg(x, y), [a, b]));
            }
            const f = `ps-beh-${String(i + 1).padStart(2, '0')}-${name.replace(/[^A-Za-z]+/g, '')}.jpg`;
            record('behavior', name, deg > 1.5, `moved ${deg.toFixed(1)}°`, await shot(page, f), deg <= 3);
        }

        // A VRMA and a BVH clip from their lists.
        for (const [sel, play, stop, name] of [
            ['#poseVrmaSelect', '#poseVrmaPlayBtn', '#poseVrmaStopBtn', 'VRMA clip'],
            ['#poseBvhSelect', '#poseBvhPlayBtn', '#poseBvhStopBtn', 'BVH clip'],
        ]) {
            if (name === 'BVH clip')
                await page
                    .locator('#poseBvhArrow')
                    .click()
                    .catch(() => null);
            const n = await page.locator(`${sel} option`).count();
            if (!n) {
                record('pose studio', name, false, 'list is empty');
                continue;
            }
            await page.selectOption(sel, { index: Math.min(1, n - 1) });
            const a = await page.evaluate(() => window.__ui.quats());
            await page.locator(play).click();
            await page.waitForTimeout(3500);
            const b = await page.evaluate(() => window.__ui.quats());
            const deg = await page.evaluate(([x, y]) => window.__ui.diffDeg(x, y), [a, b]);
            const playing = await page.evaluate(
                () => window.NEXUS_CLIP_LOADER?.getCurrentPlaybackState?.()?.clip || null
            );
            record(
                'pose studio',
                name,
                deg > 2,
                `${n} in the list; played ${String(playing).split('/').pop()}, moved ${deg.toFixed(1)}°`,
                await shot(page, `ps-05-${name.replace(/\W+/g, '')}.jpg`)
            );
            if (
                await page
                    .locator(stop)
                    .isVisible()
                    .catch(() => false)
            )
                await page.locator(stop).click();
            await page.waitForTimeout(800);
        }
        if (errors.length) record('pose studio', 'page errors', false, errors.slice(0, 3).join(' | '));
    } catch (e) {
        record(
            'pose studio',
            'tour',
            false,
            `stopped: ${String(e.message || e).slice(0, 200)}`,
            await shot(page, 'ps-zz-stopped.jpg').catch(() => null)
        );
    } finally {
        await page.context().close();
    }
}

function writeReport() {
    const sum = {
        ok: rows.filter((r) => r.verdict === 'ok').length,
        warn: rows.filter((r) => r.verdict === 'warn').length,
        fail: rows.filter((r) => r.verdict === 'fail').length,
    };
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ stamp, size: SIZE, summary: sum, rows }, null, 1));
    const md = [
        `# UI tour ${stamp} (${SIZE})`,
        '',
        `${sum.fail ? 'FAIL' : 'PASS'} — ${sum.ok} ok · ${sum.warn} warn · ${sum.fail} fail`,
        '',
        '| area | item | verdict | what happened |',
        '|---|---|---|---|',
    ];
    for (const r of rows)
        md.push(`| ${r.area} | ${r.name} | **${r.verdict}** | ${String(r.detail).replace(/\|/g, '/')} |`);
    fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n') + '\n');
    const shots = fs.readdirSync(SHOTS).sort();
    const html = [
        '<!doctype html><meta charset="utf-8"><title>UI tour</title>',
        '<style>body{font:14px system-ui;background:#151317;color:#eee;margin:16px}figure{display:inline-block;margin:4px}img{width:200px;display:block;border-radius:6px}</style>',
        `<h1>UI tour ${stamp}</h1>`,
    ];
    for (const s of shots)
        html.push(`<figure><img src="shots/${s}" loading="lazy"><figcaption>${s}</figcaption></figure>`);
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
    const browser = await playwright.chromium.launch({
        args: [...D.SWIFTSHADER, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    });
    try {
        await tourMenu(D, browser, server.base);
        await tourPoseStudio(D, browser, server.base);
    } finally {
        await browser.close();
        if (server.stop) server.stop();
    }
    const sum = writeReport();
    fs.writeFileSync(path.join(HERE, 'runs', 'LATEST'), path.relative(HERE, OUT) + '\n');
    console.log(`\n${sum.fail ? 'FAIL' : 'PASS'} — ${sum.ok} ok · ${sum.warn} warn · ${sum.fail} fail`);
    console.log(`report: ${path.relative(ROOT, path.join(OUT, 'report.md'))}`);
    process.exit(sum.fail ? 1 : 0);
}

main().catch((e) => {
    console.error('UI tour crashed:', e && e.stack ? e.stack : e);
    process.exit(2);
});
