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
const MAX_CONTACT_HEIGHT_M = 0.08;
const MAX_PENETRATION_M = 0.06;
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
        });
        await page.goto(url, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(
            () => !!window.NEXUS_VIEWER?.avatarManager?.currentRoot && !!window.vrPoseSystem,
            null,
            { timeout: 120000 }
        );
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
        await page.waitForTimeout(1800); // blend and auto-ground, same cadence as pose-navigator audit
        const posed = await sample();
        const support = ['leftHand', 'rightHand', 'leftLowerLeg', 'rightLowerLeg'];
        const contact = support.map((name) => ({
            name,
            yAboveStandingFloorM: Number(((posed.p[name]?.y ?? NaN) - floor).toFixed(3)),
        }));
        const contactPass = contact.every((c) =>
            Number.isFinite(c.yAboveStandingFloorM) &&
            c.yAboveStandingFloorM <= MAX_CONTACT_HEIGHT_M &&
            c.yAboveStandingFloorM >= -MAX_PENETRATION_M
        );
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
        await page.evaluate(() => window.vrPoseSystem.applyPreset('standing', 0));
        await page.waitForTimeout(200);
        const restored = await sample();
        const resetPass = restored.preset === 'standing' && restored.rootUuid === standing.rootUuid;
        const result = {
            checkedAt: new Date().toISOString(),
            url,
            pose: POSE,
            contactThresholds: {
                maxHeightM: MAX_CONTACT_HEIGHT_M,
                maxPenetrationM: MAX_PENETRATION_M,
            },
            contact,
            checks: { contactPass, identityPass, posePass, resetPass },
            screenshots: shots,
            warnings,
            verdict:
                contactPass && identityPass && posePass && resetPass && !warnings.length
                    ? 'pass-contact-gate-only'
                    : 'fail-needs-pose-retarget-or-contact-correction',
            caution: 'Joint heights do not establish mesh contact, garment quality, or VR headset camera safety. Review screenshots manually.',
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
