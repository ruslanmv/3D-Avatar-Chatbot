#!/usr/bin/env node
/**
 * Experimental hands-and-knees browser gate. This is NOT a unit-test substitute:
 * it loads the real avatar in Chromium and checks FOUR joint heights against
 * the standing feet, saves four views, checks reset and keeps a JSON audit.
 *
 * node tools/qa/hands-knees-visual-audit.mjs --url http://127.0.0.1:8080/
 *
 * If contact fails, keep the candidate on this audit branch. Do not claim it
 * is production-ready or silently lower the thresholds.
 *
 * UN6 changes. Joint heights alone measured the wrist ~6 cm above the palm and the knee joint
 * ~5 cm above the knee's skin, and a fixed 1.8 s wait sampled half-finished blends under
 * software rendering. Now: the avatar is the one the page loaded through ViewerEngine and the
 * pose owner must be attached to it; sampling waits for vrPoseSystem.isSettling() to end; the
 * contacts are rendered skin (tools/qa/pose-render-probe.js) against the plane the standing
 * soles rest on, with palms down and fingers forward checked on the raw skeleton.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const argument = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
};
const url = argument('--url', 'http://127.0.0.1:8080/');
const out = path.resolve(argument('--out', path.join(ROOT, 'docs/audits/hands-knees-candidate')));
const MAX_PALM_GAP_M = 0.02;
const MAX_KNEE_GAP_M = 0.03;
const MAX_PENETRATION_M = 0.01;
const POSE = 'handsKnees';
const VIEWS = [
    ['front', 0],
    ['right', Math.PI / 2],
    ['back', Math.PI],
    ['left', -Math.PI / 2],
];

function chromium() {
    try {
        return require('playwright').chromium;
    } catch {
        const { execFileSync } = require('node:child_process');
        const globalModules = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
        return require(path.join(globalModules, 'playwright')).chromium;
    }
}

async function main() {
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium().launch({
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    const warnings = [];
    page.on('pageerror', (error) => warnings.push(String(error)));
    try {
        await page.addInitScript(() => {
            // Disable only the unrelated automatic NPC scheduler in this audit tab.
            localStorage.setItem('npc_enabled', 'false');
            // The candidate is adult-gated: list it in this test browser only.
            localStorage.setItem('nexus_spicy_enabled', 'true');
            localStorage.setItem('nexus_spicy_verified', 'true');
        });
        await page.goto(url, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(
            () => !!window.NEXUS_VIEWER?.avatarManager?.currentRoot && !!window.vrPoseSystem?.avatarRoot,
            null,
            { timeout: 120000 }
        );
        await page.waitForTimeout(2500);
        await page.addScriptTag({ path: path.join(ROOT, 'tools/qa/pose-render-probe.js') });
        const owner = await page.evaluate(
            () => window.vrPoseSystem.avatarRoot === window.NEXUS_VIEWER.avatarManager.currentRoot
        );
        if (!owner) throw new Error('vrPoseSystem is attached to a different avatar than the one displayed');
        const settle = () =>
            page.waitForFunction(
                () => !window.vrPoseSystem.isSettling() && !(window.vrPoseSystem._clothPending > 0),
                null,
                { timeout: 60000, polling: 100 }
            );
        const ref =
            (await page.evaluate(() => window.__probe.loadThree()),
            await page.evaluate(() => window.__probe.standRef()));
        const sample = () =>
            page.evaluate(() => {
                const root = window.NEXUS_VIEWER.avatarManager.currentRoot;
                const hum = window.NEXUS_VIEWER.avatarManager._currentVRM?.humanoid;
                if (!root || !hum) throw new Error('Expected real VRM humanoid and avatar root');
                root.updateMatrixWorld(true);
                const names = [
                    'hips',
                    'chest',
                    'leftHand',
                    'rightHand',
                    'leftLowerLeg',
                    'rightLowerLeg',
                    'leftFoot',
                    'rightFoot',
                ];
                const p = {};
                const pos = new window.THREE.Vector3();
                for (const key of names) {
                    const bone = hum.getRawBoneNode?.(key) || hum.getNormalizedBoneNode?.(key);
                    if (!bone) continue;
                    bone.getWorldPosition(pos);
                    p[key] = { x: pos.x, y: pos.y, z: pos.z };
                }
                return {
                    rootUuid: root.uuid,
                    preset: window.vrPoseSystem.getCurrentPreset?.(),
                    p,
                };
            });
        await page.evaluate(() => {
            window.vrPoseSystem.claimBones?.();
            window.vrPoseSystem.applyPreset('standing', 0);
        });
        await page.waitForTimeout(400);
        const standing = await sample();
        const floor = Math.min(standing.p.leftFoot?.y ?? Infinity, standing.p.rightFoot?.y ?? Infinity);
        if (!Number.isFinite(floor)) throw new Error('Cannot measure standing floor from foot joints');

        await page.evaluate((id) => {
            window.vrPoseSystem.claimBones?.();
            window.vrPoseSystem.applyPreset(id, 0.35);
        }, POSE);
        await settle();
        await page.waitForTimeout(500);
        const posed = await sample();
        const rendered = await page.evaluate(() => window.__probe.measure().summary);
        const contact = [
            ['leftPalmSkin', rendered.palmSkinY[0], MAX_PALM_GAP_M],
            ['rightPalmSkin', rendered.palmSkinY[1], MAX_PALM_GAP_M],
            ['leftKneeSkin', rendered.kneeSurfY[0], MAX_KNEE_GAP_M],
            ['rightKneeSkin', rendered.kneeSurfY[1], MAX_KNEE_GAP_M],
        ].map(([name, y, max]) => ({ name, yAboveSolePlaneM: y, maxM: max }));
        const contactPass =
            contact.every(
                (c) =>
                    Number.isFinite(c.yAboveSolePlaneM) &&
                    c.yAboveSolePlaneM <= c.maxM &&
                    c.yAboveSolePlaneM >= -MAX_PENETRATION_M
            ) &&
            rendered.fingersFwd.every((f) => f >= 0.8) &&
            rendered.palmDown.every((p) => p >= 0.5); // thumb towards her midline: palm down
        const identityPass = standing.rootUuid === posed.rootUuid;
        const posePass = posed.preset === POSE;
        const shots = [];
        const oldRotation = await page.evaluate(() => window.NEXUS_VIEWER.avatarManager.currentRoot.rotation.y);
        for (const [label, angle] of VIEWS) {
            await page.evaluate((rot) => {
                const root = window.NEXUS_VIEWER.avatarManager.currentRoot;
                root.rotation.y = rot;
                root.updateMatrixWorld(true);
            }, oldRotation + angle);
            await page.waitForTimeout(240);
            const file = path.join(out, 'hands-knees-' + label + '.png');
            const avatar = page.locator('#avatar-viewport');
            if (await avatar.count()) await avatar.screenshot({ path: file });
            else await page.screenshot({ path: file });
            shots.push(file);
        }
        await page.evaluate((rot) => {
            window.NEXUS_VIEWER.avatarManager.currentRoot.rotation.y = rot;
            window.NEXUS_VIEWER.avatarManager.currentRoot.updateMatrixWorld(true);
        }, oldRotation);
        await page.evaluate(() => window.vrPoseSystem.releaseBones({ blendSeconds: 0.4 }));
        await settle();
        await page.waitForTimeout(500);
        const restored = await sample();
        const back = await page.evaluate(() => window.__probe.measure().summary);
        const resetPass =
            restored.preset === 'standing' &&
            restored.rootUuid === standing.rootUuid &&
            Math.abs(back.hipsY - ref.hips[1] + ref.sole) < 0.1 &&
            back.footSurfY.every((y) => Math.abs(y) <= 0.03);
        const result = {
            checkedAt: new Date().toISOString(),
            url,
            pose: POSE,
            contactThresholds: {
                palmM: MAX_PALM_GAP_M,
                kneeM: MAX_KNEE_GAP_M,
                maxPenetrationM: MAX_PENETRATION_M,
            },
            solePlaneY: ref.sole,
            contact,
            hands: {
                fingersForward: rendered.fingersFwd,
                palmDown: rendered.palmDown,
                support: rendered.support,
            },
            body: { hipsY: rendered.hipsY, trunk: rendered.trunk, shin: rendered.shinL, thigh: rendered.thighL },
            checks: { contactPass, identityPass, posePass, resetPass },
            screenshots: shots,
            warnings,
            verdict:
                contactPass && identityPass && posePass && resetPass && !warnings.length
                    ? 'pass-contact-gate-only'
                    : 'fail-needs-pose-retarget-or-contact-correction',
            caution:
                'Rendered-skin contact on the default outfit; review the screenshots for garment clipping and wrist shape.',
        };
        fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        if (result.verdict !== 'pass-contact-gate-only') process.exitCode = 1;
    } finally {
        await browser.close();
    }
}

main().catch((err) => {
    process.stderr.write('[hands-knees-audit] ' + (err?.stack || err) + '\n');
    process.exitCode = 1;
});
