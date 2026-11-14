#!/usr/bin/env node
/**
 * MO5. Audit every Pose Navigator preset on the real avatar (issue #150).
 *
 * The inventory is read from the code, never retyped: NAV_PRESETS from src/PoseStudioPanel.js
 * (what Next/Back walks) and PRESET_ORDER / POSE_PRESETS from the VRPoseSystem module the page
 * itself loaded (what applyPreset and the VR cycle use). For each navigator entry:
 *
 *   defined      POSE_PRESETS has it (applyPreset only warns "Unknown preset" otherwise)
 *   ordered      it is in PRESET_ORDER, so the VR cycle reaches it too
 *   gate         the navigator's `adult` flag agrees with POSE_PRESETS[name].adult — the two
 *                lists decide visibility separately, so a disagreement shows a restricted pose
 *                (or hides an ordinary one) in one of the two places
 *   changes      applying it moves the skeleton away from the reset pose (largest bone change)
 *   hips         world height of the hips after the blend
 *   reset        applying `standing` afterwards returns every bone to the reset pose
 *
 * Restricted presets are applied with Spicy mode switched on in this test browser only; the
 * app's gating code is not touched or bypassed in the product.
 *
 *   node tools/qa/pose-navigator-audit.mjs → docs/audits/pose-navigator-audit.json + .md
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const URL_ = process.argv.includes('--url')
    ? process.argv[process.argv.indexOf('--url') + 1]
    : 'http://127.0.0.1:8080/';
const OUT = path.join(ROOT, 'docs/audits');
const SHOTS = path.join(OUT, 'pose-navigator');

function chromium() {
    try {
        return require('playwright').chromium;
    } catch {
        const g = require('child_process').execSync('npm root -g').toString().trim();
        return require(path.join(g, 'playwright')).chromium;
    }
}

/** NAV_PRESETS, parsed from the panel source: name, label, category, adult. */
function navPresets() {
    const src = fs.readFileSync(path.join(ROOT, 'src/PoseStudioPanel.js'), 'utf8');
    const block = src.slice(
        src.indexOf('const NAV_PRESETS = ['),
        src.indexOf('];', src.indexOf('const NAV_PRESETS = ['))
    );
    const out = [];
    const re = /\{\s*name:\s*'([^']+)',\s*label:\s*'([^']+)',\s*category:\s*'([^']+)'(,\s*adult:\s*true)?\s*\}/g;
    let m;
    while ((m = re.exec(block))) out.push({ name: m[1], label: m[2], category: m[3], adult: !!m[4] });
    return out;
}

async function main() {
    const nav = navPresets();
    fs.mkdirSync(SHOTS, { recursive: true });
    const browser = await chromium().launch({
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(() => {
        localStorage.setItem('npc_enabled', 'false'); // no idle scheduler fighting the poses
        localStorage.setItem('nexus_spicy_enabled', 'true'); // this test browser only
        localStorage.setItem('nexus_spicy_verified', 'true');
    });
    await page.goto(URL_, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => !!window.NEXUS_VIEWER?.avatarManager?.currentRoot && !!window.vrPoseSystem, null, {
        timeout: 120000,
    });
    await page.waitForTimeout(4000);

    const system = await page.evaluate(async () => {
        const mod = await import('/src/gltf-viewer/VRPoseSystem.js');
        return {
            order: mod.PRESET_ORDER.slice(),
            presets: Object.fromEntries(
                Object.entries(mod.POSE_PRESETS).map(([k, v]) => [k, { label: v.label || null, adult: !!v.adult }])
            ),
        };
    });

    const sample = () =>
        page.evaluate(() => {
            const hum = window.NEXUS_VIEWER.avatarManager._currentVRM?.humanoid;
            const names = [
                'hips',
                'spine',
                'chest',
                'neck',
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
            const q = {};
            for (const n of names) {
                const b = hum?.getRawBoneNode?.(n) || hum?.getNormalizedBoneNode?.(n);
                if (b) q[n] = [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w];
            }
            const v = new window.THREE.Vector3();
            (hum?.getRawBoneNode?.('hips') || hum?.getNormalizedBoneNode?.('hips'))?.getWorldPosition(v);
            const hips = v.y;
            // Lowest point of the body: feet, toes, knees, hands, head, hips. Standing, the feet
            // touch the floor; a pose whose lowest joint is well above it floats.
            let lowest = Infinity;
            for (const n of [
                'leftFoot',
                'rightFoot',
                'leftToes',
                'rightToes',
                'leftLowerLeg',
                'rightLowerLeg',
                'leftHand',
                'rightHand',
                'head',
                'hips',
            ]) {
                const b = hum?.getRawBoneNode?.(n);
                if (!b) continue;
                b.getWorldPosition(v);
                lowest = Math.min(lowest, v.y);
            }
            const root = window.NEXUS_VIEWER.avatarManager.currentRoot.position.y;
            return { q, hips, lowest: lowest - root };
        });
    const delta = (a, b) => {
        let max = 0;
        for (const n of Object.keys(a.q)) {
            if (!b.q[n]) continue;
            const x = a.q[n],
                y = b.q[n];
            const dot = Math.min(1, Math.abs(x[0] * y[0] + x[1] * y[1] + x[2] * y[2] + x[3] * y[3]));
            max = Math.max(max, 2 * Math.acos(dot));
        }
        return +max.toFixed(3);
    };
    const apply = async (name) => {
        const warnings = [];
        const onMsg = (m) =>
            /Unknown preset|VRPoseSystem/.test(m.text()) && m.type() === 'warning' && warnings.push(m.text());
        page.on('console', onMsg);
        await page.evaluate((n) => {
            window.vrPoseSystem.claimBones?.();
            window.vrPoseSystem.applyPreset(n, 0.3);
        }, name);
        await page.waitForTimeout(1800); // blend + grounding blend, at software-renderer frame rates
        page.off('console', onMsg);
        return warnings;
    };

    await apply('standing');
    const reset = await sample();

    const results = [];
    for (const [i, p] of nav.entries()) {
        const warnings = await apply(p.name);
        const after = await sample();
        const shot = `${String(i + 1).padStart(2, '0')}-${p.name}.jpg`;
        await page.screenshot({ path: path.join(SHOTS, shot), clip: { x: 16, y: 80, width: 474, height: 650 }, type: 'jpeg', quality: 60, scale: 'css' });
        await apply('standing');
        const back = await sample();

        const defined = !!system.presets[p.name];
        const ordered = system.order.includes(p.name);
        const gateAgrees = defined ? system.presets[p.name].adult === p.adult : null;
        const change = delta(reset, after);
        const residue = delta(reset, back);
        const problems = [];
        if (!defined) problems.push('not defined in POSE_PRESETS (applyPreset ignores it)');
        if (defined && !ordered) problems.push('missing from PRESET_ORDER: the VR cycle never reaches it');
        if (gateAgrees === false)
            problems.push(`adult flag disagrees: navigator ${p.adult}, POSE_PRESETS ${system.presets[p.name].adult}`);
        if (p.name !== 'standing' && change < 0.05)
            problems.push(`no visible change from the reset pose (${change} rad)`);
        if (residue > 0.05) problems.push(`reset leaves ${residue} rad of the previous pose`);
        // The reset pose stands on its feet (lowest joint = feet), so compare against that.
        const floating = after.lowest - reset.lowest;
        if (floating > 0.15)
            problems.push(
                `not grounded: lowest joint ${floating.toFixed(2)} m above where her feet stand (no hipsPosition offset)`
            );
        if (warnings.length) problems.push(warnings[0].slice(0, 120));
        results.push({
            index: i + 1,
            id: p.name,
            label: p.label,
            category: p.category,
            restricted: p.adult,
            defined,
            inPresetOrder: ordered,
            gateFlagsAgree: gateAgrees,
            maxBoneChangeRad: change,
            hipsAfter: +after.hips.toFixed(3),
            lowestJointAboveFloorM: +(after.lowest - reset.lowest).toFixed(3),
            resetResidueRad: residue,
            status: problems.length ? 'fail' : 'pass',
            problems,
            evidence: `docs/audits/pose-navigator/${shot}`,
            visual: 'not verified by numbers — see the screenshot',
        });
        process.stdout.write(
            `${String(i + 1).padStart(2)}/${nav.length} ${problems.length ? 'FAIL' : 'pass'} ${p.name}${problems.length ? '  — ' + problems.join('; ') : ''}\n`
        );
    }
    await browser.close();

    const navNames = new Set(nav.map((p) => p.name));
    const orderOnly = system.order.filter((n) => !navNames.has(n));
    const dupes = nav.map((p) => p.name).filter((n, i, a) => a.indexOf(n) !== i);
    const summary = {
        navigatorEntries: nav.length,
        pass: results.filter((r) => r.status === 'pass').length,
        fail: results.filter((r) => r.status === 'fail').length,
        inPresetOrderButNotNavigator: orderOnly,
        duplicateNavigatorIds: dupes,
    };
    fs.writeFileSync(
        path.join(OUT, 'pose-navigator-audit.json'),
        JSON.stringify(
            {
                generated: new Date().toISOString(),
                url: URL_,
                method: 'tools/qa/pose-navigator-audit.mjs',
                summary,
                presets: results,
            },
            null,
            2
        ) + '\n'
    );
    const md = [
        '# Pose Navigator audit',
        '',
        `Generated by \`tools/qa/pose-navigator-audit.mjs\`. Inventory read from \`NAV_PRESETS\` (src/PoseStudioPanel.js) and the page's own \`PRESET_ORDER\`/\`POSE_PRESETS\`. Each preset applied on the avatar in desktop Chromium, measured against the reset pose, screenshotted, then reset.`,
        '',
        `**${summary.pass} pass, ${summary.fail} fail, of ${summary.navigatorEntries} navigator entries.** In PRESET_ORDER but not the navigator: ${orderOnly.length ? orderOnly.map((n) => '`' + n + '`').join(', ') : 'none'}. Duplicate navigator ids: ${dupes.length ? dupes.join(', ') : 'none'}.`,
        '',
        '| # | Preset | Category | Restricted | Bone change | Hips after | Lowest joint above floor | Reset residue | Status | Problem |',
        '| -: | ------ | -------- | ---------- | ----------: | ---------: | -----------------------: | ------------: | ------ | ------- |',
        ...results.map(
            (r) =>
                `| ${r.index} | \`${r.id}\` (${r.label}) | ${r.category} | ${r.restricted ? 'yes' : 'no'} | ${r.maxBoneChangeRad} | ${r.hipsAfter} | ${r.lowestJointAboveFloorM} | ${r.resetResidueRad} | ${r.status} | ${r.problems.join('; ')} |`
        ),
        '',
    ].join('\n');
    fs.writeFileSync(path.join(OUT, 'pose-navigator-audit.md'), md);
    console.log(JSON.stringify(summary));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
