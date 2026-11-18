#!/usr/bin/env node
/**
 * UI1–UI2. A tour of the ☰ menu and Pose Studio that proves each control does what it names.
 *
 *   npm run audit:ui                        # both parts
 *   node audits/ui/run.mjs --only menu      # or --only pose
 *
 * Every check runs in a disposable browser context (empty storage, nothing shared with the person's
 * own browser) with Private off. Private is read before any frame is taken: `NEXUS_SPICY.isEnabled()`
 * must be false and no "Talk privately…" composer may be on screen. If either is on, the tour stops
 * rather than photograph a private screen.
 *
 * Nothing here passes on a click alone. Each check states what it measured: a dialog's computed
 * visibility, the camera's position, a file the upload put on stage, her bones (the normalized rig
 * Pose Studio writes, and the raw skeleton that is rendered), the procedural mode, expression
 * weights, a clip's playback state, where keyboard focus went.
 *
 * Exclusions agreed with the owner: the Spicy behaviours (Flirt, Tease, Intimate, Sensual Sway,
 * Beckon) are never clicked, and their grid is masked in every frame; the adult presets are absent
 * because Private is off, and the tour fails if one shows up.
 *
 * Output: audits/ui/runs/<stamp>/ — report.md (per-control Pass / Fail / Blocked with the
 * measurement and the frame), report.json, inventory.md (every control: label, selector, expected
 * effect, found or not), index.html (contact sheet), shots/. Git-ignored. Exit 0 when nothing fails.
 * A QA tool: the app never loads it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const arg = (f, d) => (argv.includes(f) && argv[argv.indexOf(f) + 1] ? argv[argv.indexOf(f) + 1] : d);
const ONLY = arg('--only', 'menu,pose').split(',');
const FIXTURE_AVATAR = path.join(ROOT, 'vendor/avatars/Vita.vrm');
const DESKTOP = { viewport: { width: 1280, height: 900 } };

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(HERE, 'runs', stamp);
const SHOTS = path.join(OUT, 'shots');
const rows = [];
let shotSeq = 0;

/** verdict: 'pass' | 'fail' | 'blocked'. */
function record(area, control, verdict, measured, shot = null, extra = {}) {
    rows.push({ area, control, verdict, measured, shot, ...extra });
    console.log(`${verdict.padEnd(7)} ${area.padEnd(12)} ${control.padEnd(38)} ${measured}`);
}
const pf = (ok) => (ok ? 'pass' : 'fail');

async function shot(page, name, opts = {}) {
    shotSeq += 1;
    const file = `${String(shotSeq).padStart(3, '0')}-${name.replace(/[^A-Za-z0-9]+/g, '-')}.jpg`;
    // The Spicy grid is masked in every frame, whether or not it is shown.
    const mask = [page.locator('#poseAnimGridSpicy'), page.locator('.pose-anim-chip--spicy')];
    await page.screenshot({ path: path.join(SHOTS, file), type: 'jpeg', quality: 72, mask, ...opts });
    return 'shots/' + file;
}

// ─────────────────────────────────────────────────────────────────────────────
// In the page
// ─────────────────────────────────────────────────────────────────────────────

/** Installed into every page: read-only probes of app state. */
function installProbes() {
    const T = () => window.THREE;
    const vrm = () => window.NEXUS_VIEWER?.avatarManager?._currentVRM;
    const KEYS = [
        'hips',
        'spine',
        'chest',
        'neck',
        'head',
        'leftShoulder',
        'rightShoulder',
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
    ];
    const qa = (q) => [q.x, q.y, q.z, q.w].map((x) => +x.toFixed(5));
    const ang = (a, b) => {
        const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
        return 2 * Math.acos(Math.min(1, d)) * 57.29578;
    };
    window.__ui = {
        KEYS,
        ang,
        /** Raw (rendered) skeleton: local quaternions. */
        rendered() {
            const v = vrm();
            if (!v) return {};
            v.scene.updateMatrixWorld(true);
            const out = {};
            for (const k of KEYS) {
                const n = v.humanoid.getRawBoneNode(k);
                if (n) out[k] = qa(n.quaternion);
            }
            return out;
        },
        /** The rig Pose Studio writes (normalized bones). */
        normalized() {
            const rig = window.poseEditor?.rigMap;
            const out = {};
            if (!rig) return out;
            for (const k of KEYS) {
                const b = rig.getBone(k);
                if (b) out[k] = qa(b.quaternion);
            }
            return out;
        },
        diff(a, b, only) {
            let max = 0;
            let bone = null;
            const per = {};
            for (const k of only || Object.keys(a)) {
                if (!a[k] || !b[k]) continue;
                per[k] = +ang(a[k], b[k]).toFixed(2);
                if (per[k] > max) [max, bone] = [per[k], k];
            }
            return { max: +max.toFixed(2), bone, per };
        },
        finite() {
            return Object.values(this.rendered()).every((q) => q.every(Number.isFinite));
        },
        world(k) {
            const v = vrm();
            const n = v && v.humanoid.getRawBoneNode(k);
            if (!n) return null;
            v.scene.updateMatrixWorld(true);
            const p = n.getWorldPosition(new (T().Vector3)());
            return [p.x, p.y, p.z].map((x) => +x.toFixed(4));
        },
        /** Upper arm below horizontal, degrees (0 = T-pose, 90 = hanging). */
        armDrop(side) {
            const a = this.world(side + 'UpperArm');
            const b = this.world(side + 'LowerArm');
            if (!a || !b) return null;
            const dy = a[1] - b[1];
            const h = Math.hypot(a[0] - b[0], a[2] - b[2]);
            return +((Math.atan2(dy, h) * 180) / Math.PI).toFixed(1);
        },
        camera() {
            const c = window.NEXUS_VIEWER?.camera;
            const t = window.NEXUS_VIEWER?.controls?.target;
            return c ? { pos: [c.position.x, c.position.y, c.position.z], target: t ? [t.x, t.y, t.z] : null } : null;
        },
        /** A world point in page pixels. */
        toScreen(p) {
            const cam = window.NEXUS_VIEWER?.camera;
            const canvas = window.NEXUS_VIEWER?.renderer?.domElement;
            if (!p || !cam || !canvas) return null;
            const w = new (T().Vector3)(p[0], p[1], p[2]).project(cam);
            const r = canvas.getBoundingClientRect();
            return { x: r.left + ((w.x + 1) / 2) * r.width, y: r.top + ((1 - w.y) / 2) * r.height };
        },
        /** A gizmo handle's centre in page pixels. */
        handleXY(key) {
            const g = window.NEXUS_POSE_GIZMO_OVERLAY;
            const e = g && g._boneHandles && g._boneHandles.get(key);
            if (!e) return null;
            e.mesh.updateMatrixWorld(true);
            const p = e.mesh.getWorldPosition(new (T().Vector3)());
            return this.toScreen([p.x, p.y, p.z]);
        },
        privateState() {
            const shown = (el) => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
            };
            const privateComposer = [...document.querySelectorAll('input,textarea')].some(
                (el) => shown(el) && /privately|in privato|en privado|en privé|privat/i.test(el.placeholder || '')
            );
            let spicy = null;
            try {
                spicy = window.NEXUS_SPICY ? window.NEXUS_SPICY.isEnabled() === true : false;
            } catch (_) {
                spicy = null;
            }
            return { spicy, privateComposer, placeholder: document.getElementById('speech-text')?.placeholder || null };
        },
        shown(sel) {
            const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
            if (!el) return false;
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return (
                r.width > 1 &&
                r.height > 1 &&
                s.visibility !== 'hidden' &&
                s.display !== 'none' &&
                Number(s.opacity) > 0.05 &&
                !el.classList.contains('hidden')
            );
        },
        mode() {
            const pa = window.NEXUS_PROCEDURAL_ANIMATOR;
            return pa && pa.getMode ? pa.getMode() : null;
        },
        expression(name) {
            const em = vrm()?.expressionManager;
            try {
                return em ? +(em.getValue(name) || 0).toFixed(3) : null;
            } catch (_) {
                return null;
            }
        },
        clip() {
            const s = window.NEXUS_CLIP_LOADER?.getCurrentPlaybackState?.();
            return s ? { playing: Boolean(s.isPlaying), clip: s.clip || null } : null;
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// The inventory
// ─────────────────────────────────────────────────────────────────────────────

const INVENTORY = [
    ['Header', 'HomePilot (menu brand)', '.drawer-brand-title', 'reads "HomePilot"'],
    ['Header', 'v2.0', '.drawer-brand-version', 'reads "v2.0"'],
    ['Header', 'System status (menu footer)', '#drawer-status-label', 'reads "System Online" once the app is up'],
    ['Header', 'System status (top bar)', '#status-text', 'leaves "BOOTING..." once the app is up'],
    ['Header', '☰ menu button', '#mobile-menu-btn', 'opens the menu drawer'],
    ['Header', '⛶ top-level fullscreen', '#fullscreen-btn', 'phone only: toggles fullscreen, icon ⛶ ↔ ⊠'],
    ['Avatar', 'Avatar Manager', 'a.drawer-nav-item[href="vrm-manager.html"]', 'navigates to vrm-manager.html'],
    ['Avatar', 'Upload Custom Avatar', '#drawer-upload-btn', 'opens a file picker; a .vrm chosen replaces her'],
    ['Configuration', 'Settings', '#drawer-settings-btn', 'opens #settings-modal'],
    ['Configuration', 'Voice & Speech', '#drawer-voice-btn', 'opens #settings-modal at #speech-lang'],
    ['Configuration', 'Clear Chat', '#drawer-clear-btn', 'empties the chat, its history and its stored copy'],
    ['Experience', 'VR / AR Mode', '#drawer-vr-btn', 'enters WebXR; without it, says it is unsupported'],
    ['Experience', 'Reset View', '#drawer-reset-view-btn', 'camera and avatar back to the load framing'],
    ['Experience', 'Companion', '#drawer-companion-btn', 'opens the companion (PiP or in-page overlay)'],
    ['Experience', 'Pose Studio', '#drawer-pose-studio-btn', 'opens #poseStudioRoot, editor active'],
    ['Experience', 'Face Tracking', '#drawer-face-track-btn', 'starts the camera tracker, or reports why not'],
    ['Experience', 'Tracking Settings', '#drawer-tracking-settings-btn', 'opens #tracking-settings-panel'],
    ['Experience', 'Fullscreen', '#drawer-fullscreen-btn', 'toggles document fullscreen'],
    ['Experience', 'Together', '.drawer-nav-item:has-text("Together")', 'opens the Together panel'],
    ['Help', 'About', '#drawer-info-btn', 'opens #info-modal'],
    ['Help', 'GitHub', '#mobile-drawer a[href*="github.com"]', 'opens github.com/ruslanmv/3D-Avatar-Chatbot'],
    ['Pose Studio', 'Close', '#poseStudioCloseBtn', 'hides the panel, ends editing, focus back to the opener'],
    ['Pose Studio', 'Pose Navigator ‹ (back)', '#poseNavPrev', 'previous preset, wraps at 1'],
    ['Pose Studio', 'Pose Navigator › (next)', '#poseNavNext', 'next preset, wraps at the end'],
    ['Pose Studio', 'Navigator name / counter', '#poseNavLabel, #poseNavCounter', 'name and "i / N" of the pose held'],
    ['Pose Studio', 'T-Pose Correction intensity', '#poseTposeIntensitySlider', '0–1.5: how far the arms come down'],
    ['Pose Studio', 'Natural Pose Style', '#poseTposePresetSelect', 'four arm angles: 30°, 40°, 55°, 65°'],
    ['Pose Studio', 'Poses picker', '#posePresetSelect', 'lists presets and saved poses'],
    ['Pose Studio', 'Apply', '#poseApplyBtn', 'applies the picked pose'],
    ['Pose Studio', 'Reset All', '#poseResetBtn', 'stops everything, default standing idle, navigator 1'],
    ['Pose Studio', 'Mouse Bone Editing', '#poseMouseEditToggle', 'off: drag orbits; on: drag a joint handle'],
    ['Pose Studio', 'Puppet Mode', '#posePuppetToggle', 'off: drag rotates one bone; on: IK moves the chain'],
    ['Pose Studio', 'Selected bone', '#poseBoneSelect', 'which bone the sliders drive'],
    ['Pose Studio', 'Pitch X', '#poseSliderX', '−45°…+45° on the bone'],
    ['Pose Studio', 'Yaw Y', '#poseSliderY', '−45°…+45° on the bone'],
    ['Pose Studio', 'Roll Z', '#poseSliderZ', '−90°…+90° on the bone'],
    ['Pose Studio', 'Reset Selected', '#poseResetSelectedBtn', 'the selected bone back to neutral'],
    ['Pose Studio', 'Mirror Arms', '#poseMirrorBtn', 'right arm becomes the mirror of the left'],
    ['Pose Studio', 'Save Pose name', '#poseSaveName', 'name for the saved pose'],
    ['Pose Studio', 'Save Pose', '#poseSaveBtn', 'stores the pose, listed under Saved Poses'],
    ['Pose Studio', 'Undo', '#poseUndoBtn', 'previous pose'],
    ['Pose Studio', 'Redo', '#poseRedoBtn', 'the pose undone'],
    ['Pose Studio', 'Behavior (Live) chips', '#poseAnimGridEmotes .pose-anim-chip[data-anim]', 'procedural modes'],
    ['Pose Studio', 'Spicy chips (excluded)', '#poseAnimGridSpicy', 'never clicked; hidden with Private off'],
];

async function writeInventory(page) {
    const lines = [
        '# Control inventory',
        '',
        'Selectors are existing element IDs or stable classes. No test IDs were added: every control had one.',
        'The top-level ⛶ (`#fullscreen-btn`, created by MobileSupport on phones) is a separate control from the',
        "menu's Fullscreen item (`#drawer-fullscreen-btn`).",
        '',
        '| group | visible label | selector | expected effect | in page |',
        '|---|---|---|---|---|',
    ];
    for (const [group, label, sel, effect] of INVENTORY) {
        const found = await page
            .locator(sel.split(', ')[0])
            .count()
            .catch(() => 0);
        lines.push(`| ${group} | ${label} | \`${sel}\` | ${effect} | ${found ? 'yes' : 'no'} |`);
    }
    fs.writeFileSync(path.join(OUT, 'inventory.md'), lines.join('\n') + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Pages
// ─────────────────────────────────────────────────────────────────────────────

async function freshPage(D, browser, base, ctxOpts, { initScript } = {}) {
    const ctx = await browser.newContext({ ...ctxOpts, permissions: ['camera', 'microphone'] });
    if (initScript) await ctx.addInitScript(initScript);
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    const dialogs = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 240)));
    page.on('dialog', (d) => {
        dialogs.push(d.message());
        d.accept().catch(() => null);
    });
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await D.waitForApp(page, 180000);
    await page.waitForFunction(() => window.NEXUS_VIEWER?.avatarManager?._currentVRM, null, { timeout: 120000 });
    await page.waitForTimeout(2500);
    await page.evaluate(installProbes);
    const priv = await page.evaluate(() => window.__ui.privateState());
    if (priv.spicy !== false || priv.privateComposer)
        throw new Error(`Private is on in a fresh session (${JSON.stringify(priv)}); refusing to take frames`);
    return { page, ctx, errors, dialogs, priv };
}

async function openMenu(page) {
    await page.locator('#mobile-menu-btn').click();
    await page.waitForFunction(() => document.getElementById('mobile-drawer')?.classList.contains('open'));
    await page.waitForTimeout(400);
}

const drawerOpen = (page) => page.evaluate(() => document.getElementById('mobile-drawer').classList.contains('open'));

// ─────────────────────────────────────────────────────────────────────────────
// Part 1: the menu
// ─────────────────────────────────────────────────────────────────────────────

const MENU_ITEMS = [
    'Avatar Manager',
    'Upload Custom Avatar',
    'Settings',
    'Voice & Speech',
    'Clear Chat',
    'VR / AR Mode',
    'Reset View',
    'Companion',
    'Pose Studio',
    'Face Tracking',
    'Tracking Settings',
    'Fullscreen',
    'Together',
    'About',
    'GitHub',
];

async function tourMenu(D, browser, base, phone) {
    {
        const { page, ctx, errors, priv } = await freshPage(D, browser, base, phone);
        await writeInventory(page);
        record(
            'private',
            'Private setting',
            'pass',
            `off: NEXUS_SPICY.isEnabled()=false, composer "${priv.placeholder}"`
        );
        const h = await page.evaluate(() => ({
            brand: document.querySelector('.drawer-brand-title')?.textContent.trim(),
            version: document.querySelector('.drawer-brand-version')?.textContent.trim(),
            status: document.getElementById('drawer-status-label')?.textContent.trim(),
            top: document.getElementById('status-text')?.textContent.trim(),
        }));
        await openMenu(page);
        const s = await shot(page, 'menu-open');
        record(
            'header',
            'HomePilot v2.0',
            pf(h.brand === 'HomePilot' && h.version === 'v2.0'),
            `brand "${h.brand}", version "${h.version}"`,
            s
        );
        record(
            'header',
            'System status',
            pf(/online/i.test(h.status || '') && !/BOOTING/.test(h.top || '')),
            `menu footer "${h.status}", top bar "${h.top}"`,
            s
        );
        const items = await page.evaluate(() =>
            [...document.querySelectorAll('#mobile-drawer .drawer-nav-item')]
                .filter((el) => window.__ui.shown(el))
                .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
        );
        const missing = MENU_ITEMS.filter((w) => !items.some((i) => i.startsWith(w)));
        record(
            'menu',
            'menu opens with every item',
            pf(!missing.length),
            `${items.length} items shown${missing.length ? '; missing ' + missing.join(', ') : ''}`,
            s
        );

        // The top-level ⛶, separate from the menu item.
        await page.locator('#mobile-drawer-close').click();
        await page.waitForTimeout(400);
        const fsBtn = page.locator('#fullscreen-btn');
        if (await fsBtn.isVisible().catch(() => false)) {
            const read = () =>
                page.evaluate(() => ({
                    fs: Boolean(document.fullscreenElement),
                    icon: document.getElementById('fullscreen-btn').textContent,
                }));
            await fsBtn.click();
            await page.waitForTimeout(700);
            const on = await read();
            const s2 = await shot(page, 'top-fullscreen-on');
            await fsBtn.click();
            await page.waitForTimeout(700);
            const off = await read();
            record(
                'header',
                '⛶ top-level fullscreen',
                pf(on.fs && on.icon === '⊠' && !off.fs && off.icon === '⛶' && !errors.length),
                `on: fullscreenElement=${on.fs}, icon ${on.icon}; off: ${off.fs}, icon ${off.icon}${errors.length ? '; error ' + errors[0] : ''}`,
                s2
            );
        } else record('header', '⛶ top-level fullscreen', 'fail', 'no visible #fullscreen-btn on a phone');
        await ctx.close();
    }

    for (const item of MENU_CHECKS) {
        let env;
        try {
            env = await freshPage(D, browser, base, item.ctx === 'desktop' ? DESKTOP : phone, {
                initScript: item.initScript,
            });
            await openMenu(env.page);
            const r = await item.run(env, base);
            if (env.errors.length) {
                r.verdict = 'fail';
                r.measured += `; page error: ${env.errors[0]}`;
            }
            record('menu', item.name, r.verdict, r.measured, r.shot, {
                ran: r.ran || null,
                repro: r.repro || null,
                shots: r.shots || null,
            });
        } catch (e) {
            record('menu', item.name, 'fail', `could not run: ${String(e.message || e).slice(0, 200)}`);
        } finally {
            if (env) await env.ctx.close().catch(() => null);
        }
    }
}

const MENU_CHECKS = [
    {
        name: 'Avatar Manager',
        async run({ page }) {
            await Promise.all([
                page.waitForURL(/vrm-manager\.html/),
                page.locator('a.drawer-nav-item[href="vrm-manager.html"]').click(),
            ]);
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(2000);
            const title = await page.title();
            const s = await shot(page, 'avatar-manager');
            return {
                verdict: pf(/vrm-manager\.html$/.test(page.url())),
                measured: `navigated to ${new URL(page.url()).pathname}, title "${title}"`,
                shot: s,
            };
        },
    },
    {
        name: 'Upload Custom Avatar',
        async run({ page }) {
            const before = await page.evaluate(() => window.NEXUS_VIEWER.avatarManager._currentVRM.scene.uuid);
            const [chooser] = await Promise.all([
                page.waitForEvent('filechooser', { timeout: 8000 }),
                page.locator('#drawer-upload-btn').click(),
            ]);
            await chooser.setFiles(FIXTURE_AVATAR);
            await page.waitForFunction((u) => window.NEXUS_VIEWER.avatarManager._currentVRM?.scene.uuid !== u, before, {
                timeout: 90000,
            });
            await page.waitForTimeout(2500);
            const meta = await page.evaluate(() => {
                const v = window.NEXUS_VIEWER.avatarManager._currentVRM;
                return v.meta?.name || v.meta?.title || '(no name)';
            });
            const s = await shot(page, 'upload-fixture');
            return {
                verdict: 'pass',
                measured: `file picker offered; fixture Vita.vrm replaced the avatar (new VRM "${meta}")`,
                shot: s,
            };
        },
    },
    {
        name: 'Settings',
        async run({ page }) {
            await page.locator('#drawer-settings-btn').click();
            await page.waitForTimeout(800);
            const open = await page.evaluate(() => window.__ui.shown('#settings-modal'));
            const closed = !(await drawerOpen(page));
            const s = await shot(page, 'settings');
            await page.locator('#close-settings').click();
            await page.waitForTimeout(500);
            const gone = !(await page.evaluate(() => window.__ui.shown('#settings-modal')));
            return {
                verdict: pf(open && closed && gone),
                measured: `#settings-modal shown=${open}, menu closed=${closed}, its Close hides it=${gone}`,
                shot: s,
            };
        },
    },
    {
        name: 'Voice & Speech',
        async run({ page }) {
            await page.locator('#drawer-voice-btn').click();
            await page.waitForTimeout(1200);
            const r = await page.evaluate(() => {
                const el = document.getElementById('speech-lang');
                const b = el && el.getBoundingClientRect();
                return {
                    open: window.__ui.shown('#settings-modal'),
                    inView: Boolean(b && b.top >= 0 && b.bottom <= innerHeight),
                };
            });
            const s = await shot(page, 'voice-speech');
            return {
                verdict: pf(r.open && r.inView),
                measured: `#settings-modal shown=${r.open}, #speech-lang scrolled into view=${r.inView}`,
                shot: s,
            };
        },
    },
    {
        name: 'Clear Chat',
        // A conversation from an earlier visit, restored on load by the app's own persistence.
        initScript: () => {
            if (sessionStorage.getItem('__ui_seeded')) return;
            sessionStorage.setItem('__ui_seeded', '1');
            localStorage.setItem(
                'nexus_chat_display',
                JSON.stringify([
                    { sender: 'user', text: 'Fixture: hello' },
                    { sender: 'avatar', text: 'Fixture: hi there' },
                ])
            );
            localStorage.setItem(
                'nexus_chat_messages',
                JSON.stringify([
                    { role: 'user', content: 'Fixture: hello' },
                    { role: 'assistant', content: 'Fixture: hi there' },
                ])
            );
        },
        async run({ page }) {
            const read = () =>
                page.evaluate(() => ({
                    rows: document.querySelectorAll('#chat-history .chat-row').length,
                    history: window.chatHistory?.getHistory?.().length ?? null,
                    stored: ['nexus_chat_display', 'nexus_chat_messages'].filter(
                        (k) => localStorage.getItem(k) !== null
                    ),
                    residue: window.NEXUS_CONVERSATION_RESET?.residue?.() || null,
                }));
            const before = await read();
            const s0 = await shot(page, 'clear-chat-before');
            await page.locator('#drawer-clear-btn').click();
            await page.waitForTimeout(1200);
            const after = await read();
            const s = await shot(page, 'clear-chat-after');
            const ok =
                before.rows > 0 &&
                after.rows === 0 &&
                !after.history &&
                !after.stored.length &&
                (!after.residue || !after.residue.length);
            return {
                verdict: pf(ok),
                measured: `fixture restored ${before.rows} rows, ${before.history} history entries; after: ${after.rows} rows, history ${after.history}, stored keys [${after.stored}], residue [${after.residue}]`,
                shot: s,
                shots: [s0, s],
            };
        },
    },
    {
        name: 'VR / AR Mode (phone)',
        async run({ page, dialogs }) {
            const xr = await page.evaluate(async () => {
                try {
                    return navigator.xr
                        ? {
                              vr: await navigator.xr.isSessionSupported('immersive-vr'),
                              ar: await navigator.xr.isSessionSupported('immersive-ar'),
                          }
                        : null;
                } catch (_) {
                    return { vr: false, ar: false };
                }
            });
            await page.locator('#drawer-vr-btn').click();
            await page.waitForTimeout(1500);
            const s = await shot(page, 'vr-ar-phone');
            const presenting = await page.evaluate(() => Boolean(window.NEXUS_VIEWER?.renderer?.xr?.isPresenting));
            const fallback = dialogs.find((m) => /not available|not supported/i.test(m));
            if (xr && xr.ar)
                return {
                    verdict: pf(presenting),
                    measured: `immersive-ar supported; presenting=${presenting}`,
                    shot: s,
                    ran: 'supported',
                };
            return {
                verdict: fallback ? 'blocked' : 'fail',
                measured: `no WebXR AR here (navigator.xr ${xr ? JSON.stringify(xr) : 'absent'}); fallback said "${(fallback || 'nothing').split('\n')[0]}"; ${dialogs.length} dialog(s)`,
                shot: s,
                ran: 'fallback',
                repro: 'Supported path needs an AR-capable phone (Chrome on Android with ARCore, or Safari on iOS). The fallback was checked and passed.',
            };
        },
    },
    {
        name: 'VR / AR Mode (desktop)',
        ctx: 'desktop',
        async run({ page, dialogs }) {
            await page.locator('#drawer-vr-btn').click();
            await page.waitForTimeout(1500);
            const s = await shot(page, 'vr-ar-desktop');
            const presenting = await page.evaluate(() => Boolean(window.NEXUS_VIEWER?.renderer?.xr?.isPresenting));
            const fallback = dialogs.find((m) => /not available|not supported/i.test(m));
            return {
                verdict: presenting ? 'pass' : fallback ? 'blocked' : 'fail',
                measured: `presenting=${presenting}; ${dialogs.length} dialog(s): ${dialogs.map((d) => '"' + d.split('\n')[0] + '"').join(', ') || 'none'}`,
                shot: s,
                ran: presenting ? 'supported' : 'fallback',
                repro: 'Supported path needs a WebXR headset (Quest Browser, or PC VR with a runtime). The fallback was checked and passed.',
            };
        },
    },
    {
        name: 'Reset View',
        async run({ page }) {
            const home = await page.evaluate(() => window.__ui.camera());
            await page.evaluate(() => {
                const v = window.NEXUS_VIEWER;
                v.camera.position.x += 1.2;
                v.camera.position.y += 0.6;
                v.avatarManager.currentRoot.rotation.y += 1.0;
                v.controls?.update?.();
            });
            const moved = await page.evaluate(() => window.__ui.camera());
            await page.locator('#drawer-reset-view-btn').click();
            await page.waitForTimeout(1800);
            const after = await page.evaluate(() => ({
                cam: window.__ui.camera(),
                yaw: window.NEXUS_VIEWER.avatarManager.currentRoot.rotation.y,
            }));
            const d = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
            const back = d(after.cam.pos, home.pos);
            const s = await shot(page, 'reset-view');
            return {
                verdict: pf(back < 0.05 && Math.abs(after.yaw) < 0.02 && d(moved.pos, home.pos) > 1),
                measured: `camera moved ${d(moved.pos, home.pos).toFixed(2)} m away and came back to ${back.toFixed(3)} m of the load framing; avatar yaw ${after.yaw.toFixed(3)} rad`,
                shot: s,
            };
        },
    },
    {
        name: 'Companion',
        async run({ page }) {
            await page.locator('#drawer-companion-btn').click();
            await page.waitForTimeout(2500);
            const st = await page.evaluate(() => ({
                active: Boolean(window.companionMode?.active),
                strategy: window.companionMode?.strategy || null,
                pip: 'documentPictureInPicture' in window,
            }));
            const s = await shot(page, 'companion');
            if (st.active) await page.evaluate(() => window.companionMode.toggle());
            await page.waitForTimeout(1200);
            const off = await page.evaluate(() => !window.companionMode?.active);
            return {
                verdict: pf(st.active && off),
                measured: `active=${st.active} via "${st.strategy}" (Document PiP in this browser: ${st.pip}); toggled off again=${off}`,
                shot: s,
                ran: st.strategy,
            };
        },
    },
    {
        name: 'Pose Studio',
        async run({ page }) {
            await page.locator('#drawer-pose-studio-btn').click();
            await page.waitForTimeout(1500);
            const r = await page.evaluate(() => ({
                shown: window.__ui.shown('#poseStudioRoot'),
                editor: Boolean(window.poseEditor?.isActive()),
            }));
            const closed = !(await drawerOpen(page));
            const s = await shot(page, 'pose-studio-phone');
            return {
                verdict: pf(r.shown && r.editor && closed),
                measured: `panel shown=${r.shown}, editor active=${r.editor}, menu closed=${closed}`,
                shot: s,
            };
        },
    },
    {
        name: 'Face Tracking',
        async run({ page }) {
            await page.locator('#drawer-face-track-btn').click();
            let st = null;
            for (let i = 0; i < 50; i++) {
                await page.waitForTimeout(500);
                st = await page.evaluate(() => ({
                    active: Boolean(window.NEXUS_FACE_TRACKER?.isActive),
                    init: Boolean(window.NEXUS_FACE_TRACKER?.isInitializing),
                    label: document.querySelector('#drawer-face-track-btn span')?.textContent,
                }));
                if (st.active || (!st.init && i > 4)) break;
            }
            const s = await shot(page, 'face-tracking');
            if (st.active) {
                await openMenu(page);
                await page.locator('#drawer-face-track-btn').click();
                await page.waitForTimeout(800);
                const off = await page.evaluate(() => !window.NEXUS_FACE_TRACKER.isActive);
                return {
                    verdict: pf(off),
                    measured: `tracker active on the browser's fake camera (label "${st.label}"); a second press stopped it=${off}`,
                    shot: s,
                    ran: 'supported (fake camera)',
                };
            }
            return {
                verdict: st.label === 'Face Tracking' ? 'blocked' : 'fail',
                measured: `tracker did not start; button back to "${st.label}"`,
                shot: s,
                ran: 'fallback',
                repro: 'The tracker loads MediaPipe from cdn.jsdelivr.net and storage.googleapis.com; both must be reachable and a camera present.',
            };
        },
    },
    {
        name: 'Tracking Settings',
        async run({ page }) {
            await page.locator('#drawer-tracking-settings-btn').click();
            await page.waitForTimeout(900);
            const r = await page.evaluate(() => ({
                visible: Boolean(window.NEXUS_TRACKING_PANEL?.isVisible),
                shown: window.__ui.shown('#tracking-settings-panel'),
            }));
            const closed = !(await drawerOpen(page));
            const s = await shot(page, 'tracking-settings');
            return {
                verdict: pf(r.visible && r.shown && closed),
                measured: `NEXUS_TRACKING_PANEL.isVisible=${r.visible}, #tracking-settings-panel on screen=${r.shown}, menu closed=${closed}`,
                shot: s,
                repro: closed ? null : 'Open ☰, press Tracking Settings: the menu stays open over the panel.',
            };
        },
    },
    {
        name: 'Fullscreen',
        async run({ page }) {
            await page.locator('#drawer-fullscreen-btn').click();
            await page.waitForTimeout(800);
            const on = await page.evaluate(() => Boolean(document.fullscreenElement));
            const s = await shot(page, 'fullscreen');
            await openMenu(page);
            await page.locator('#drawer-fullscreen-btn').click();
            await page.waitForTimeout(800);
            const off = await page.evaluate(() => !document.fullscreenElement);
            return {
                verdict: pf(on && off),
                measured: `first press: fullscreenElement set=${on}; second press left fullscreen=${off}`,
                shot: s,
            };
        },
    },
    {
        name: 'Together',
        async run({ page }) {
            await page.locator('.drawer-nav-item:has-text("Together")').first().click();
            await page.waitForTimeout(1500);
            const shown = await page.evaluate(() => {
                const el = document.getElementById('nexus-bd-together-panel');
                return Boolean(el && window.__ui.shown(el));
            });
            const s = await shot(page, 'together');
            return { verdict: pf(shown), measured: `#nexus-bd-together-panel shown=${shown}`, shot: s };
        },
    },
    {
        name: 'About',
        async run({ page }) {
            await page.locator('#drawer-info-btn').click();
            await page.waitForTimeout(800);
            const open = await page.evaluate(() => window.__ui.shown('#info-modal'));
            const s = await shot(page, 'about');
            return { verdict: pf(open), measured: `#info-modal shown=${open}`, shot: s };
        },
    },
    {
        name: 'GitHub',
        async run({ page }) {
            const link = page.locator('#mobile-drawer a[href*="github.com"]').first();
            const attrs = {
                href: await link.getAttribute('href'),
                target: await link.getAttribute('target'),
                rel: await link.getAttribute('rel'),
            };
            const [popup] = await Promise.all([page.context().waitForEvent('page', { timeout: 10000 }), link.click()]);
            await popup.waitForLoadState('commit', { timeout: 15000 }).catch(() => null);
            const dest = popup.url();
            const ok =
                attrs.href === 'https://github.com/ruslanmv/3D-Avatar-Chatbot' &&
                dest.startsWith(attrs.href) &&
                attrs.target === '_blank' &&
                /noopener/.test(attrs.rel || '');
            const s = await shot(page, 'github');
            await popup.close().catch(() => null);
            return {
                verdict: pf(ok),
                measured: `href ${attrs.href}, target ${attrs.target}, rel "${attrs.rel}"; a new tab opened at ${dest}`,
                shot: s,
            };
        },
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// Part 2: Pose Studio
// ─────────────────────────────────────────────────────────────────────────────

async function tourPoseStudio(D, browser, base) {
    const { page, ctx, errors } = await freshPage(D, browser, base, DESKTOP);
    const ev = (fn, a) => page.evaluate(fn, a);
    const N = () => ev(() => window.__ui.normalized());
    const R = () => ev(() => window.__ui.rendered());
    const diff = (a, b, only) => ev(([x, y, o]) => window.__ui.diff(x, y, o), [a, b, only || null]);
    const nav = () =>
        ev(() => ({
            label: document.getElementById('poseNavLabel').textContent,
            category: document.getElementById('poseNavCategory').textContent,
            counter: document.getElementById('poseNavCounter').textContent,
            preset: window.vrPoseSystem?.getCurrentPreset?.() || null,
        }));
    const input = (sel, value) =>
        ev(
            ([s, v]) => {
                const el = document.querySelector(s);
                el.value = String(v);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            },
            [sel, value]
        );
    const settle = (ms = 900) => page.waitForTimeout(ms);
    const apply = async (name) => {
        await page.selectOption('#posePresetSelect', name);
        await page.locator('#poseApplyBtn').click();
        await settle(1100);
    };
    // UI3. The rig's T-pose is an Advanced action now, not an entry in the Poses list.
    const tpose = async () => {
        await ev(() => {
            document.getElementById('poseAdvanced').open = true;
        });
        await page.locator('#poseTposeStartBtn').click();
        await settle(900);
    };
    const step = async (name, fn) => {
        try {
            await fn();
        } catch (e) {
            const s = await shot(page, 'stopped-' + name).catch(() => null);
            record('pose studio', name, 'fail', `could not run: ${String(e.message || e).slice(0, 220)}`, s);
        }
    };

    let opener = '#openPoseStudioBtn';
    // Arms below horizontal at the default correction (intensity 1.0, Natural Idle): what "T-Pose
    // (Reset)" shows, because the T-pose correction is applied to the rest pose it returns to.
    let restDrop = null;
    try {
        // ── Open ─────────────────────────────────────────────────────────────
        if (!(await page.locator(opener).isVisible())) {
            opener = '#drawer-pose-studio-btn';
            await openMenu(page);
        }
        await page.locator(opener).focus();
        // UI3. Watch her arms while the studio opens: a frame with them out (near a T-pose) is
        // the flash a person sees before the first preset blends in.
        await ev(() => {
            window.__openDrops = [];
            const t0 = performance.now();
            const tick = () => {
                window.__openDrops.push(window.__ui.armDrop('left'));
                if (performance.now() - t0 < 1200) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
        await page.locator(opener).click();
        await settle(1500);
        const openDrops = await ev(() => window.__openDrops);
        const words = await ev(() => window.NEXUS_POSE_STUDIO_PANEL.catalogue());
        // The navigator's list: the catalogue minus the T-pose, which is an Advanced action (UI3).
        const cat = words.filter((p) => p.name !== 'standing');
        const st0 = await ev(() => ({
            shown: window.__ui.shown('#poseStudioRoot'),
            editor: window.poseEditor.isActive(),
            edit: window.NEXUS_PROCEDURAL_ANIMATOR.isEditMode(),
            pose: window.NEXUS_PROCEDURAL_ANIMATOR.isPoseMode(),
            spicyShown: window.__ui.shown(document.getElementById('poseAnimGridSpicy')?.closest('.spicy-gated')),
        }));
        const n0 = await nav();
        record(
            'pose studio',
            'open (initial panel)',
            pf(
                st0.shown &&
                    st0.editor &&
                    st0.edit &&
                    st0.pose &&
                    n0.counter === `1 / ${cat.length}` &&
                    n0.preset === cat[0].name &&
                    !st0.spicyShown
            ),
            `opened from ${opener}; editor active, edit and pose mode on; navigator "${n0.category} · ${n0.label}" ${n0.counter}, holding ${n0.preset}; Spicy grid shown=${st0.spicyShown}`,
            await shot(page, 'ps-open')
        );
        const minOpen = Math.min(...openDrops.filter((x) => x != null));
        record(
            'pose studio',
            'no T-pose flash while opening',
            pf(minOpen > 25),
            `${openDrops.length} frames sampled over 1.2 s from the click; arms never higher than ${minOpen}° below horizontal (a T-pose is 0°)`
        );
        record(
            'pose studio',
            'T-pose out of the navigator, still nameable in words',
            pf(
                words.some((p) => p.name === 'standing') &&
                    !(await page.locator('#posePresetSelect option[value="standing"]').count())
            ),
            `navigator and Poses list: ${cat.length} presets without the T-pose; catalogue for words: ${words.length} with it`
        );
        const adult = cat.filter((p) => p.adult);
        record(
            'pose studio',
            'adult presets absent (Private off)',
            pf(!adult.length),
            `${cat.length} presets offered, ${adult.length} adult`
        );

        // ── Navigator: every preset, both endpoints, backwards ───────────────
        await step('Pose Navigator', async () => {
            const bad = [];
            const sheet = [];
            let prev = await R();
            for (let i = 1; i <= cat.length; i++) {
                await page.locator('#poseNavNext').click();
                await settle(800);
                const k = i % cat.length;
                const want = cat[k];
                const n = await nav();
                const now = await R();
                const moved = (await diff(prev, now)).max;
                const finite = await ev(() => window.__ui.finite());
                if (
                    !(
                        n.label === want.label &&
                        n.category === want.category &&
                        n.counter === `${k + 1} / ${cat.length}` &&
                        n.preset === want.name
                    )
                )
                    bad.push(
                        `step ${i}: "${n.category} · ${n.label}" ${n.counter} holding ${n.preset}, expected "${want.category} · ${want.label}" ${k + 1} / ${cat.length} (${want.name})`
                    );
                if (!finite) bad.push(`${want.label}: a bone is NaN`);
                if (moved < 1) bad.push(`${want.label}: her pose did not change (${moved}°)`);
                sheet.push(await shot(page, `ps-nav-${String(k + 1).padStart(2, '0')}-${want.category}-${want.label}`));
                prev = now;
            }
            record(
                'pose studio',
                'Navigator › through every preset',
                pf(!bad.length),
                `${cat.length} presets, wrapping from ${cat.length} / ${cat.length} to 1 / ${cat.length}; name, category, counter and held preset checked at each, and the skeleton changed at each${bad.length ? '; ' + bad.slice(0, 4).join('; ') : ''}`,
                sheet[sheet.length - 1],
                { shots: sheet }
            );
            await page.locator('#poseNavPrev').click();
            await settle(800);
            const a = await nav();
            const sA = await shot(page, 'ps-nav-back-to-last');
            await page.locator('#poseNavPrev').click();
            await settle(800);
            const b = await nav();
            const last = cat[cat.length - 1];
            const before = cat[cat.length - 2];
            const ok =
                a.label === last.label &&
                a.counter === `${cat.length} / ${cat.length}` &&
                a.preset === last.name &&
                b.label === before.label &&
                b.counter === `${cat.length - 1} / ${cat.length}` &&
                b.preset === before.name;
            record(
                'pose studio',
                'Navigator ‹ back across the start',
                pf(ok),
                `from 1 / ${cat.length}: "${a.label}" ${a.counter} (${a.preset}); again: "${b.label}" ${b.counter} (${b.preset})`,
                sA
            );
        });

        // ── T-Pose Correction ────────────────────────────────────────────────
        await step('T-Pose Correction', async () => {
            await tpose();
            const out = [];
            const shots = [];
            for (const v of [0, 50, 100, 150]) {
                await input('#poseTposeIntensitySlider', v);
                await settle(700);
                out.push(
                    await ev(
                        (val) => ({
                            v: val,
                            label: document.getElementById('poseTposeIntensityValue').textContent,
                            stored: window.NEXUS_POSE_NORMALIZER?.getSettings?.().intensity,
                            drop: window.__ui.armDrop('left'),
                            dropR: window.__ui.armDrop('right'),
                        }),
                        v
                    )
                );
                shots.push(await shot(page, `ps-tpose-${v}`));
            }
            const labelsOk = out.every(
                (o) => o.label === (o.v / 100).toFixed(2) && Math.abs(o.stored - o.v / 100) < 1e-6
            );
            const mono = out.every((o, i) => i === 0 || o.drop > out[i - 1].drop + 1);
            record(
                'pose studio',
                'T-Pose Correction 0 / 0.5 / 1.0 / 1.5',
                pf(labelsOk && mono),
                out.map((o) => `${o.label}: arms ${o.drop}°/${o.dropR}° below horizontal`).join(', ') +
                    (labelsOk ? '' : '; label or stored intensity wrong') +
                    (mono ? '' : '; arms did not come further down as intensity rose'),
                shots[3],
                { shots }
            );
            await input('#poseTposeIntensitySlider', 100);
            await settle(500);
            restDrop = out.find((o) => o.v === 100).drop;
            await input('#poseTposeIntensitySlider', 20);
            const low = await ev(() => ({
                live: window.NEXUS_POSE_NORMALIZER.getSettings().intensity,
                stored: JSON.parse(localStorage.getItem('nexus_pose_normalizer') || '{}').intensity,
            }));
            record(
                'pose studio',
                'near-T-pose correction not remembered',
                pf(low.live === 0.2 && low.stored >= 0.5),
                `slider at 0.20: applies now (${low.live}), stored for the next visit ${low.stored}`
            );
            await input('#poseTposeIntensitySlider', 100);
            const toggles = await page
                .locator('#poseStudioRoot input[type="checkbox"]')
                .evaluateAll((els) => els.map((e) => e.id));
            const extra = toggles.filter((id) => !['poseMouseEditToggle', 'posePuppetToggle'].includes(id));
            record(
                'pose studio',
                'T-Pose correction toggle',
                pf(!extra.length),
                extra.length
                    ? `untested toggles: ${extra.join(', ')}`
                    : 'Pose Studio has no correction on/off toggle (its checkboxes are Mouse Bone Editing and Puppet Mode); intensity 0 is "off" and was measured above'
            );

            const styles = [];
            const sshots = [];
            for (const [value, deg] of [
                ['presentation', 30],
                ['relaxedStanding', 40],
                ['naturalIdle', 55],
                ['portrait', 65],
            ]) {
                await page.selectOption('#poseTposePresetSelect', value);
                await settle(700);
                styles.push(
                    await ev(
                        ([val, d]) => ({
                            value: val,
                            deg: d,
                            label: document.querySelector('#poseTposePresetSelect option:checked').textContent,
                            active: window.NEXUS_NATURAL_POSE?.getActivePreset?.(),
                            stored: window.NEXUS_POSE_NORMALIZER?.getSettings?.().preset,
                            drop: window.__ui.armDrop('left'),
                        }),
                        [value, deg]
                    )
                );
                sshots.push(await shot(page, `ps-style-${value}`));
            }
            const activeOk = styles.every((s) => s.active === s.value && s.stored === s.value);
            const order = styles.every((s, i) => i === 0 || s.drop > styles[i - 1].drop);
            record(
                'pose studio',
                'Natural Pose Style (all four)',
                pf(activeOk && order),
                styles.map((s) => `${s.label}: arms ${s.drop}°`).join(', ') +
                    (activeOk ? '' : `; active preset not the one picked (${styles.map((s) => s.active).join(',')})`) +
                    (order ? '' : '; arm angles not in the labelled order'),
                sshots[2],
                { shots: sshots }
            );
            await page.selectOption('#poseTposePresetSelect', 'naturalIdle');
            await settle(500);
        });

        // ── Pose picker, Apply, T-Pose (Reset), Reset All ────────────────────
        await step('Poses / Apply / Reset All', async () => {
            const sitting = cat.find((p) => p.name === 'sitting');
            await apply('sitting');
            const a = await nav();
            const hipsSit = await ev(() => window.__ui.world('hips')[1]);
            record(
                'pose studio',
                'Poses picker + Apply (Sitting)',
                pf(a.preset === 'sitting' && a.label === sitting.label && a.category === sitting.category),
                `holding ${a.preset}; navigator "${a.category} · ${a.label}" ${a.counter}; hips at ${hipsSit.toFixed(2)} m`,
                await shot(page, 'ps-apply-sitting')
            );

            const beforeT = await N();
            await tpose();
            const b = await nav();
            const tDrop = await ev(() => [window.__ui.armDrop('left'), window.__ui.armDrop('right')]);
            const hipsT = await ev(() => window.__ui.world('hips')[1]);
            const navOk = b.label === 'T-Pose' && b.counter === `\u2013 / ${cat.length}`;
            const sT = await shot(page, 'ps-advanced-tpose');
            record(
                'pose studio',
                'Advanced ▸ Start from T-pose',
                pf(navOk && Math.abs(tDrop[0]) < 6 && Math.abs(tDrop[1]) < 6 && hipsT > hipsSit + 0.1),
                `navigator "${b.category} · ${b.label}" ${b.counter} (named, not counted); arms ${tDrop[0]}°/${tDrop[1]}° from horizontal (a T-pose); hips up to ${hipsT.toFixed(2)} m`,
                sT
            );
            await page.locator('#poseUndoBtn').click();
            await settle(400);
            const back = (await diff(beforeT, await N())).max;
            record(
                'pose studio',
                'Undo after Start from T-pose',
                pf(back < 1),
                `the pose before (Sitting) back within ${back}°`,
                await shot(page, 'ps-advanced-tpose-undo')
            );
            await ev(() => {
                document.getElementById('poseTposeIntensitySlider').value = '20';
                document
                    .getElementById('poseTposeIntensitySlider')
                    .dispatchEvent(new Event('input', { bubbles: true }));
            });
            await page.locator('#poseTposeRestoreBtn').click();
            await settle(500);
            const restored = await ev(() => ({
                label: document.getElementById('poseTposeIntensityValue').textContent,
                live: window.NEXUS_POSE_NORMALIZER.getSettings().intensity,
                stored: JSON.parse(localStorage.getItem('nexus_pose_normalizer') || '{}').intensity,
            }));
            record(
                'pose studio',
                'Advanced ▸ Restore recommended (1.0)',
                pf(restored.label === '1.00' && restored.live === 1 && restored.stored === 1),
                `after 0.20: label ${restored.label}, live ${restored.live}, stored ${restored.stored}`
            );

            await page.locator('#poseResetBtn').click();
            await settle(1500);
            const c = await nav();
            const r = await ev(() => ({
                pose: window.NEXUS_PROCEDURAL_ANIMATOR.isPoseMode(),
                mode: window.__ui.mode(),
                drop: [window.__ui.armDrop('left'), window.__ui.armDrop('right')],
                sliders: ['X', 'Y', 'Z'].map((a) => document.getElementById('poseSlider' + a).value),
                active: document.querySelectorAll('.pose-anim-chip--active').length,
            }));
            record(
                'pose studio',
                'Reset All',
                pf(
                    !r.pose &&
                        c.counter === `1 / ${cat.length}` &&
                        r.drop[0] > 35 &&
                        r.drop[1] > 35 &&
                        r.sliders.every((v) => v === '0') &&
                        !r.active
                ),
                `pose mode off=${!r.pose}, procedural mode "${r.mode}", arms down ${r.drop[0]}°/${r.drop[1]}° (standing idle), navigator ${c.counter} "${c.label}", sliders ${r.sliders.join('/')}`,
                await shot(page, 'ps-reset-all')
            );
        });

        // ── Viewport dragging: Mouse Bone Editing × Puppet Mode ──────────────
        await step('Mouse Bone Editing / Puppet Mode', async () => {
            const drag = async (from, dx, dy) => {
                await page.mouse.move(from.x, from.y);
                await page.mouse.down();
                for (let k = 1; k <= 14; k++) await page.mouse.move(from.x + (dx * k) / 14, from.y + (dy * k) / 14);
                await page.mouse.up();
                await settle(500);
            };
            const setToggle = async (sel, on) => {
                if ((await page.locator(sel).isChecked()) !== on) await page.locator(sel).dispatchEvent('click');
                await settle(300);
                return page.locator(sel).isChecked();
            };
            const camDist = (a, b) => Math.hypot(...a.pos.map((x, i) => x - b.pos[i]));
            // OrbitControls damping keeps turning the camera for a moment after an orbit drag;
            // wait until it is still, so a later drag is not blamed for the previous one.
            const still = async () => {
                let prev = await ev(() => window.__ui.camera());
                for (let i = 0; i < 40; i++) {
                    await settle(150);
                    const cur = await ev(() => window.__ui.camera());
                    if (camDist(prev, cur) < 1e-4) return;
                    prev = cur;
                }
            };
            await tpose();

            // Off: a drag across her forearm orbits the camera and leaves her alone.
            await setToggle('#poseMouseEditToggle', false);
            const arm = await ev(() => window.__ui.toScreen(window.__ui.world('rightLowerArm')));
            let b0 = await N();
            let c0 = await ev(() => window.__ui.camera());
            await drag(arm, 140, 0);
            let b1 = await N();
            let c1 = await ev(() => window.__ui.camera());
            const boneMoved = (await diff(b0, b1)).max;
            record(
                'pose studio',
                'drag, Mouse Bone Editing off',
                pf(camDist(c0, c1) > 0.05 && boneMoved < 0.5),
                `drag across her right forearm: camera orbited ${camDist(c0, c1).toFixed(2)} m, her bones moved ${boneMoved}°`,
                await shot(page, 'ps-drag-off')
            );
            await still();
            await ev(() => document.getElementById('drawer-reset-view-btn').click());
            await settle(1300);
            await still();
            await tpose();

            // On, Puppet off: drag the right forearm handle — that one bone turns.
            const on = await setToggle('#poseMouseEditToggle', true);
            const gizmoOn = await ev(() => Boolean(window.NEXUS_POSE_GIZMO_OVERLAY._enabled));
            await setToggle('#posePuppetToggle', false);
            const puppetOff = await ev(() => !window.NEXUS_POSE_PUPPET_IK.isEnabled());
            await still();
            let h = await ev(() => window.__ui.handleXY('rightLowerArm'));
            b0 = await N();
            c0 = await ev(() => window.__ui.camera());
            await drag(h, 0, -100);
            b1 = await N();
            c1 = await ev(() => window.__ui.camera());
            let d = await diff(b0, b1);
            const others = Object.entries(d.per).filter(([k, v]) => k !== 'rightLowerArm' && v > 0.5);
            const sel = await ev(() => window.poseEditor.selectedBone);
            record(
                'pose studio',
                'drag, Mouse on + Puppet off (one bone)',
                pf(
                    on &&
                        gizmoOn &&
                        puppetOff &&
                        sel === 'rightLowerArm' &&
                        d.per.rightLowerArm > 5 &&
                        !others.length &&
                        camDist(c0, c1) < 0.01
                ),
                `gizmo on=${gizmoOn}, puppet off=${puppetOff}; handle selected ${sel}; rightLowerArm turned ${d.per.rightLowerArm}°; other bones moved: ${others.map(([k, v]) => k + ' ' + v + '°').join(', ') || 'none'}; camera moved ${camDist(c0, c1).toFixed(3)} m`,
                await shot(page, 'ps-drag-single')
            );

            // On, Puppet on: drag the right hand handle up — the chain follows (IK).
            await tpose();
            await setToggle('#posePuppetToggle', true);
            const puppetOn = await ev(() => window.NEXUS_POSE_PUPPET_IK.isEnabled());
            h = await ev(() => window.__ui.handleXY('rightHand'));
            const w0 = await ev(() => window.__ui.world('rightHand'));
            b0 = await N();
            await drag(h, -50, -120);
            b1 = await N();
            const w1 = await ev(() => window.__ui.world('rightHand'));
            d = await diff(b0, b1);
            const chain = Object.entries(d.per)
                .filter(([, v]) => v > 2)
                .map(([k, v]) => `${k} ${v}°`);
            const rise = w1[1] - w0[1];
            record(
                'pose studio',
                'drag, Mouse on + Puppet on (IK chain)',
                pf(puppetOn && chain.length >= 2 && rise > 0.05),
                `puppet on=${puppetOn}; hand handle dragged up: hand rose ${(rise * 100).toFixed(1)} cm; bones that followed: ${chain.join(', ') || 'none'}`,
                await shot(page, 'ps-drag-puppet')
            );
            await setToggle('#poseMouseEditToggle', false);
        });

        // ── Bone picker, sliders, Reset Selected, Mirror Arms ────────────────
        await step('Selected bone sliders', async () => {
            await tpose();
            const options = await page.locator('#poseBoneSelect option').allTextContents();
            const picked = [];
            for (const [lab, key] of [
                ['Left Upper Arm', 'leftUpperArm'],
                ['Right Hand', 'rightHand'],
                ['Head', 'head'],
            ]) {
                await page.selectOption('#poseBoneSelect', { label: lab });
                const got = await ev(() => window.poseEditor.selectedBone);
                picked.push({ lab, key, got });
            }
            record(
                'pose studio',
                'Selected bone picker',
                pf(picked.every((p) => p.got === p.key) && options.length === 19),
                `${options.length} bones listed; ${picked.map((p) => `${p.lab} → ${p.got}`).join(', ')}`
            );

            for (const [axis, lo, hi, name] of [
                ['X', -45, 45, 'Pitch X'],
                ['Y', -45, 45, 'Yaw Y'],
                ['Z', -90, 90, 'Roll Z'],
            ]) {
                const res = [];
                const shots = [];
                for (const v of [lo, 0, hi]) {
                    await input(`#poseSlider${axis}`, v);
                    await settle(300);
                    res.push(
                        await ev(
                            ([a, val]) => {
                                const ed = window.poseEditor;
                                const st = ed.applier.axisState.head || { x: 0, y: 0, z: 0 };
                                const T = window.THREE;
                                const n = ed.neutralPose.head.q;
                                const exp = new T.Quaternion(n[0], n[1], n[2], n[3]).multiply(
                                    new T.Quaternion().setFromEuler(new T.Euler(st.x, st.y, st.z, 'XYZ'))
                                );
                                const q = ed.rigMap.getBone('head').quaternion;
                                const vrm = window.NEXUS_VIEWER.avatarManager._currentVRM;
                                const rq = vrm.humanoid.getRawBoneNode('head').getWorldQuaternion(new T.Quaternion());
                                return {
                                    val,
                                    label: document.getElementById('poseValue' + a).textContent,
                                    state: +((st[a.toLowerCase()] * 180) / Math.PI).toFixed(1),
                                    err: +window.__ui
                                        .ang([q.x, q.y, q.z, q.w], [exp.x, exp.y, exp.z, exp.w])
                                        .toFixed(3),
                                    world: [rq.x, rq.y, rq.z, rq.w],
                                };
                            },
                            [axis, v]
                        )
                    );
                    shots.push(await shot(page, `ps-head-${axis}-${v}`));
                }
                const span = await ev(([a, b]) => window.__ui.ang(a, b), [res[0].world, res[2].world]);
                const ok =
                    res.every((r) => r.label === `${r.val}°` && Math.abs(r.state - r.val) < 0.6 && r.err < 0.5) &&
                    Math.abs(span - (hi - lo)) < 6;
                record(
                    'pose studio',
                    `Head ${name}: ${lo}° / 0 / +${hi}°`,
                    pf(ok),
                    `labels ${res.map((r) => r.label).join(' / ')}; editor state ${res.map((r) => r.state).join(' / ')}°; rig off by ≤ ${Math.max(...res.map((r) => r.err))}°; rendered head turned ${span.toFixed(1)}° end to end (expected ${hi - lo}°)`,
                    shots[2],
                    { shots }
                );
                await input(`#poseSlider${axis}`, 0);
            }

            await input('#poseSliderY', 30);
            await input('#poseSliderX', -20);
            await settle(300);
            await page.locator('#poseResetSelectedBtn').click();
            await settle(400);
            const rs = await ev(() => {
                const ed = window.poseEditor;
                const q = ed.rigMap.getBone('head').quaternion;
                return {
                    err: +window.__ui.ang([q.x, q.y, q.z, q.w], ed.neutralPose.head.q).toFixed(3),
                    labels: ['X', 'Y', 'Z'].map((a) => document.getElementById('poseValue' + a).textContent),
                };
            });
            record(
                'pose studio',
                'Reset Selected',
                pf(rs.err < 0.3 && rs.labels.every((l) => l === '0°')),
                `head at pitch −20°, yaw 30°, then reset: ${rs.err}° from neutral; labels ${rs.labels.join(' ')}`,
                await shot(page, 'ps-reset-selected')
            );

            await page.selectOption('#poseBoneSelect', { label: 'Left Upper Arm' });
            // Left arm raised to horizontal and forward; the right one stays at rest.
            await input('#poseSliderZ', 0);
            await input('#poseSliderX', 25);
            await page.selectOption('#poseBoneSelect', { label: 'Left Lower Arm' });
            await input('#poseSliderY', 40);
            await settle(400);
            const asym = await ev(() => [window.__ui.world('leftHand'), window.__ui.world('rightHand')]);
            const sA = await shot(page, 'ps-mirror-before');
            await page.locator('#poseMirrorBtn').click();
            await settle(600);
            const mir = await ev(() => {
                const rig = window.poseEditor.rigMap;
                const pairs = [
                    ['leftUpperArm', 'rightUpperArm'],
                    ['leftLowerArm', 'rightLowerArm'],
                    ['leftHand', 'rightHand'],
                ];
                const err = pairs.map(([l, r]) => {
                    const a = rig.getBone(l).quaternion;
                    const b = rig.getBone(r).quaternion;
                    return +window.__ui.ang([-a.x, a.y, -a.z, a.w], [b.x, b.y, b.z, b.w]).toFixed(3);
                });
                // The rendered skeleton: raw right-arm bones must be the mirror of the left ones.
                const vrm = window.NEXUS_VIEWER.avatarManager._currentVRM;
                vrm.update(0);
                const rawErr = pairs.map(([l, r]) => {
                    const a = vrm.humanoid.getRawBoneNode(l).quaternion;
                    const b = vrm.humanoid.getRawBoneNode(r).quaternion;
                    return +window.__ui.ang([-a.x, a.y, -a.z, a.w], [b.x, b.y, b.z, b.w]).toFixed(3);
                });
                return { err, rawErr, L: window.__ui.world('leftHand'), R: window.__ui.world('rightHand') };
            });
            const gapBefore = Math.hypot(asym[0][1] - asym[1][1]);
            const gapAfter = Math.abs(mir.L[1] - mir.R[1]);
            record(
                'pose studio',
                'Mirror Arms (asymmetric → mirrored)',
                pf(gapBefore > 0.1 && Math.max(...mir.err) < 0.5 && Math.max(...mir.rawErr) < 0.5 && gapAfter < 0.05),
                `before: hands ${(gapBefore * 100).toFixed(0)} cm apart in height; after: mirror error ${mir.err.join('/')}° (rig), ${mir.rawErr.join('/')}° (rendered skeleton); hands now ${(gapAfter * 100).toFixed(1)} cm apart in height`,
                await shot(page, 'ps-mirror-after'),
                { shots: [sA] }
            );
        });

        // ── Behavior (Live) ──────────────────────────────────────────────────
        await step('Behavior (Live)', async () => {
            await page.locator('#poseResetBtn').click();
            await settle(1200);
            const chips = await ev(() =>
                [...document.querySelectorAll('#poseAnimGridEmotes .pose-anim-chip')].map((c) => ({
                    id: c.dataset.anim,
                    label: c.querySelector('.pose-anim-chip-label').textContent.trim(),
                }))
            );
            const want = ['Idle', 'Waiting', 'Happy', 'Thinking', 'Dance', 'Talk', 'Sad', 'Angry', 'Surprised'];
            const spicyHidden = await ev(
                () => !window.__ui.shown(document.getElementById('poseAnimGridSpicy')?.closest('.spicy-gated'))
            );
            record(
                'behavior',
                'chips listed (Spicy excluded)',
                pf(want.every((w) => chips.some((c) => c.label === w)) && chips.length === 9 && spicyHidden),
                `${chips.map((c) => c.label).join(', ')}; Spicy grid hidden=${spicyHidden}`
            );
            const EXPR = { happy: 'happy', sad: 'sad', angry: 'angry', surprised: 'surprised' };
            for (const c of chips) {
                const id = c.id;
                const base = await R();
                await page.locator(`#poseAnimGridEmotes .pose-anim-chip[data-anim="${id}"]`).click();
                let motion = 0;
                let mode = null;
                let expr = 0;
                let clip = null;
                let hasExpr = true;
                for (let k = 0; k < 8; k++) {
                    await settle(350);
                    const s = await ev(
                        (e) => ({
                            r: window.__ui.rendered(),
                            mode: window.__ui.mode(),
                            expr: e ? window.__ui.expression(e) : 0,
                            has: e
                                ? Boolean(
                                      window.NEXUS_VIEWER.avatarManager._currentVRM.expressionManager?.getExpression?.(
                                          e
                                      )
                                  )
                                : true,
                            clip: window.__ui.clip(),
                        }),
                        EXPR[id] || null
                    );
                    motion = Math.max(motion, (await diff(base, s.r)).max);
                    mode = s.mode;
                    expr = Math.max(expr, s.expr || 0);
                    hasExpr = s.has;
                    if (s.clip && s.clip.playing) clip = s.clip.clip;
                }
                const active = await ev(
                    (x) =>
                        document
                            .querySelector(`.pose-anim-chip[data-anim="${x}"]`)
                            .classList.contains('pose-anim-chip--active'),
                    id
                );
                const s = await shot(page, `beh-${id}`);
                const modeOk = id === 'dance' ? Boolean(clip) || mode === 'musicIdle' : mode === id;
                // An avatar without that expression cannot show it; the body response still counts.
                const exprOk = EXPR[id] ? expr > 0.1 || !hasExpr : true;
                record(
                    'behavior',
                    c.label,
                    pf(motion > 1.5 && modeOk && exprOk),
                    `mode "${mode}"${id === 'dance' ? `, clip ${clip ? String(clip).split('/').pop() : 'none'}` : ''}${EXPR[id] ? `, "${EXPR[id]}" expression peak ${expr}${hasExpr ? '' : ' (this avatar defines no such expression)'}` : ''}; skeleton moved up to ${motion}° in 2.8 s; chip highlighted=${active}`,
                    s
                );
                await page.locator('#poseResetBtn').click();
                await settle(900);
            }
        });

        // ── Undo / Redo, Save, change avatar, reapply ────────────────────────
        await step('Save / Undo / Redo / other avatar', async () => {
            await tpose();
            const S0 = await N();
            // A press on a slider starts an undo step, as when a person drags it.
            await page.selectOption('#poseBoneSelect', { label: 'Left Upper Arm' });
            await page.locator('#poseSliderZ').scrollIntoViewIfNeeded();
            const box = await page.locator('#poseSliderZ').boundingBox();
            await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2);
            await page.mouse.up();
            await settle(300);
            const S1 = await N();
            await page.locator('#poseMirrorBtn').click();
            await settle(400);
            const S2 = await N();
            const steps = [];
            const near = async (A, label) => {
                const d = await diff(A, await N());
                steps.push(`${label} ${d.max}°`);
                return d.max < 0.5;
            };
            const d01 = (await diff(S0, S1)).max;
            const d12 = (await diff(S1, S2)).max;
            await page.locator('#poseUndoBtn').click();
            await settle(300);
            const u1 = await near(S1, 'Undo → S1');
            const sU1 = await shot(page, 'ps-undo-1');
            await page.locator('#poseUndoBtn').click();
            await settle(300);
            const u2 = await near(S0, 'Undo → S0');
            const sU2 = await shot(page, 'ps-undo-2');
            await page.locator('#poseRedoBtn').click();
            await settle(300);
            const r1 = await near(S1, 'Redo → S1');
            await page.locator('#poseRedoBtn').click();
            await settle(300);
            const r2 = await near(S2, 'Redo → S2');
            record(
                'pose studio',
                'Undo / Redo',
                pf(d01 > 5 && d12 > 5 && u1 && u2 && r1 && r2),
                `S0 (T-pose) → slider ${d01}° → S1 → Mirror ${d12}° → S2; distance from the expected pose after each press: ${steps.join(', ')}`,
                await shot(page, 'ps-redo'),
                { shots: [sU1, sU2] }
            );

            const name = `ui-tour-${stamp}`;
            await page.fill('#poseSaveName', name);
            await page.locator('#poseSaveBtn').click();
            await settle(500);
            const saved = await ev((nm) => {
                const p = window.poseEditor.getState().userPoses.find((x) => x.name === nm);
                const opt = [...document.querySelectorAll('#posePresetSelect option')].find(
                    (o) => o.textContent === nm
                );
                return {
                    id: p && p.id,
                    option: Boolean(opt),
                    stored: Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes(nm)),
                };
            }, name);
            record(
                'pose studio',
                'Save Pose (unique name)',
                pf(saved.id && saved.option && saved.stored),
                `"${name}" saved as ${saved.id}; listed under Saved Poses=${saved.option}; in storage=${saved.stored}`,
                await shot(page, 'ps-saved')
            );

            // Change the avatar with the studio open, then apply the saved pose to her.
            const before = await ev(() => window.NEXUS_VIEWER.avatarManager._currentVRM.scene.uuid);
            await ev((u) => window.NEXUS_VIEWER.loadAvatar(u), '/vendor/avatars/Vita.vrm');
            await page.waitForFunction((u) => window.NEXUS_VIEWER.avatarManager._currentVRM?.scene.uuid !== u, before, {
                timeout: 90000,
            });
            await settle(3000);
            await page.selectOption('#posePresetSelect', saved.id);
            await page.locator('#poseApplyBtn').click();
            await settle(800);
            const re = await ev((id) => {
                const ed = window.poseEditor;
                const pose = ed.library.getPoseById(id);
                const vrm = window.NEXUS_VIEWER.avatarManager._currentVRM;
                const T = window.THREE;
                let max = 0;
                let n = 0;
                for (const [k, d] of Object.entries(pose.bones)) {
                    const live = vrm.humanoid.getNormalizedBoneNode(k);
                    const neutral = ed.neutralPose && ed.neutralPose[k];
                    if (!live || !neutral) continue;
                    const exp = new T.Quaternion(...neutral.q).multiply(new T.Quaternion(...d.q));
                    const q = live.quaternion;
                    max = Math.max(max, window.__ui.ang([q.x, q.y, q.z, q.w], [exp.x, exp.y, exp.z, exp.w]));
                    n++;
                }
                return {
                    bound: ed.rigMap.root === window.NEXUS_VIEWER.avatarManager.currentRoot,
                    max: +max.toFixed(2),
                    n,
                    name: vrm.meta?.name || vrm.meta?.title,
                };
            }, saved.id);
            record(
                'pose studio',
                'saved pose on another avatar',
                pf(re.bound && re.n > 10 && re.max < 1),
                `switched to Vita.vrm ("${re.name}") with the studio open; editor bound to the avatar on stage=${re.bound}; ${re.n} bones of "${name}" applied, worst ${re.max}° from the saved pose`,
                await shot(page, 'ps-saved-on-vita'),
                {
                    repro: re.bound
                        ? null
                        : 'Open Pose Studio, load another avatar, pick a saved pose and press Apply: it is written to the previous skeleton.',
                }
            );
            await ev((nm) => {
                for (const k of Object.keys(localStorage))
                    if ((localStorage.getItem(k) || '').includes(nm)) {
                        try {
                            const v = JSON.parse(localStorage.getItem(k));
                            if (Array.isArray(v))
                                localStorage.setItem(k, JSON.stringify(v.filter((p) => p.name !== nm)));
                        } catch (_) {
                            /* not JSON */
                        }
                    }
            }, name);
        });

        // ── Close ────────────────────────────────────────────────────────────
        await step('Close', async () => {
            await page.locator('#poseStudioCloseBtn').click();
            await settle(1200);
            const r = await ev(() => ({
                shown: window.__ui.shown('#poseStudioRoot'),
                editor: window.poseEditor.isActive(),
                edit: window.NEXUS_PROCEDURAL_ANIMATOR.isEditMode(),
                pose: window.NEXUS_PROCEDURAL_ANIMATOR.isPoseMode(),
                focus:
                    document.activeElement && document.activeElement.id
                        ? '#' + document.activeElement.id
                        : document.activeElement?.tagName,
            }));
            record(
                'pose studio',
                'Close',
                pf(!r.shown && !r.editor && !r.edit && !r.pose && r.focus === opener),
                `panel hidden=${!r.shown}, editor off=${!r.editor}, procedural control back=${!r.edit && !r.pose}; focus on ${r.focus} (expected ${opener})`,
                await shot(page, 'ps-closed'),
                {
                    repro:
                        r.focus === opener
                            ? null
                            : `Open Pose Studio with ${opener} and press Close: focus lands on ${r.focus}.`,
                }
            );
        });
        if (errors.length) record('pose studio', 'page errors', 'fail', errors.slice(0, 3).join(' | '));
    } finally {
        await ctx.close();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────

function writeReport(cmd) {
    const sum = { pass: 0, fail: 0, blocked: 0 };
    for (const r of rows) sum[r.verdict] += 1;
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ stamp, cmd, summary: sum, rows }, null, 1));
    const cap = (v) => v[0].toUpperCase() + v.slice(1);
    const md = [
        `# UI tour ${stamp}`,
        '',
        `Run: \`${cmd}\` · Private off (checked in every session) · Spicy chips masked and never clicked`,
        '',
        `**${sum.fail ? 'FAIL' : 'PASS'}** — ${sum.pass} pass · ${sum.fail} fail · ${sum.blocked} blocked`,
        '',
        '| area | control | result | what was measured | path | frame |',
        '|---|---|---|---|---|---|',
    ];
    for (const r of rows)
        md.push(
            `| ${r.area} | ${r.control} | **${cap(r.verdict)}** | ${String(r.measured).replace(/\|/g, '/')} | ${r.ran || ''} | ${r.shot ? `[frame](${r.shot})` : ''} |`
        );
    const open = rows.filter((r) => r.verdict !== 'pass');
    if (open.length) {
        md.push('', '## Not passing', '');
        for (const r of open)
            md.push(`- **${r.control}** (${cap(r.verdict)}): ${r.measured}${r.repro ? `\n  - ${r.repro}` : ''}`);
    }
    fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n') + '\n');
    const html = [
        '<!doctype html><meta charset="utf-8"><title>UI tour</title>',
        '<style>body{font:14px system-ui;background:#151317;color:#eee;margin:16px}figure{display:inline-block;margin:4px;vertical-align:top;width:220px}img{width:220px;display:block;border-radius:6px}figcaption{font-size:12px}.fail{color:#ff7b7b}.blocked{color:#ffc46b}.pass{color:#8be28b}</style>',
        `<h1>UI tour ${stamp}</h1>`,
    ];
    for (const r of rows)
        for (const s of r.shots || (r.shot ? [r.shot] : []))
            html.push(
                `<figure><a href="${s}"><img src="${s}" loading="lazy"></a><figcaption class="${r.verdict}">${r.verdict.toUpperCase()} · ${r.control}</figcaption></figure>`
            );
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
    const phone = { ...playwright.devices['Pixel 7'] };
    const server = await D.ensureServer(process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:8080');
    const browser = await playwright.chromium.launch({
        args: [...D.SWIFTSHADER, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    });
    try {
        if (ONLY.includes('menu')) await tourMenu(D, browser, server.base, phone);
        if (ONLY.includes('pose')) await tourPoseStudio(D, browser, server.base);
    } finally {
        await browser.close();
        if (server.stop) server.stop();
    }
    const sum = writeReport(`node audits/ui/run.mjs${argv.length ? ' ' + argv.join(' ') : ''}`);
    fs.writeFileSync(path.join(HERE, 'runs', 'LATEST'), path.relative(HERE, OUT) + '\n');
    console.log(`\n${sum.fail ? 'FAIL' : 'PASS'} — ${sum.pass} pass · ${sum.fail} fail · ${sum.blocked} blocked`);
    console.log(`report: ${path.relative(ROOT, path.join(OUT, 'report.md'))}`);
    process.exit(sum.fail ? 1 : 0);
}

main().catch((e) => {
    console.error('UI tour crashed:', e && e.stack ? e.stack : e);
    process.exit(2);
});
