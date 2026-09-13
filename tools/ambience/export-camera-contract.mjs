/**
 * Write the camera contract the asset pipeline is generated against (batch A15).
 *
 * `CalibrationGeometry.js` is the single source of truth for this app's projection. It runs in
 * the browser and under Jest — but not in the Python asset pipeline, and not in
 * 3D-Ambience-Studio, both of which need the same figures to generate a backplate that will
 * agree with the camera.
 *
 * The wrong fix is to reimplement the projection a third time. The right one is to publish it as
 * **data**: this script runs the real module and writes `assets/ambient/camera-contract.json`,
 * which the Studio reads. One implementation, one set of numbers, and a test
 * (`tests/ambience-camera-contract.test.js`) that fails if the committed file drifts from what
 * the module computes.
 *
 *     node tools/ambience/export-camera-contract.mjs
 */

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Load the geometry module, which is neither quite CommonJS nor quite ESM here.
 *
 * `package.json` declares `"type": "module"`, so node treats every `.js` under it as ESM — and
 * the module's dual export is written for a CommonJS world. Under ESM its
 * `typeof module !== 'undefined'` branch never fires, so `require()` hands back an empty
 * namespace and the module quietly assigns itself to `globalThis` instead.
 *
 * Requiring for the side effect and then reading the global is therefore the load-bearing part,
 * not a fallback. The same trap catches `node -e "require(...)"` on anything in `src/`.
 */
function loadGeometry() {
    const required = require(resolve(ROOT, 'src/gltf-viewer/ambience/CalibrationGeometry.js'));
    if (required && required.PROFILES) return required;
    if (globalThis.NEXUS_AMBIENCE_CALIBRATION_GEOMETRY) return globalThis.NEXUS_AMBIENCE_CALIBRATION_GEOMETRY;
    throw new Error('CalibrationGeometry did not export or register itself');
}

const Geometry = loadGeometry();

/**
 * The avatar the contract is computed for.
 *
 * A nominal 1.6 m figure rather than whichever VRM happens to be loaded, because the contract is
 * a *production* target: art is authored once and has to suit any avatar. `?backgroundCalibration=1`
 * reports the measured figures for the model actually in front of you, and those two answering
 * differently is expected rather than a fault.
 */
const NOMINAL_AVATAR = { height: 1.6, width: 0.55, footY: 0 };

const round = (n, places = 5) => Number(n.toFixed(places));

export function buildContract() {
    const profiles = {};
    for (const key of ['landscape', 'portrait']) {
        const profile = Geometry.PROFILES[key];
        const view = Geometry.frameFor(profile, NOMINAL_AVATAR);
        const guide = Geometry.guide(profile, NOMINAL_AVATAR);
        const master = key === 'landscape' ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
        profiles[key] = {
            master,
            fovDeg: profile.fovDeg,
            aspect: round(master.width / master.height, 6),
            pitchDeg: round(view.pitchDeg, 4),
            eyeHeightMetres: round(guide.camera.eyeHeight, 4),
            cameraDistanceMetres: round(guide.camera.distance, 4),
            horizonY: round(guide.horizonY),
            headTopY: round(guide.headTopY),
            footAnchor: { x: round(guide.footAnchor.x), y: round(guide.footAnchor.y) },
            safeZone: {
                x0: round(guide.safeZone.x0),
                x1: round(guide.safeZone.x1),
                y0: round(guide.safeZone.y0),
                y1: round(guide.safeZone.y1),
            },
            groundLines: guide.groundLines.map((l) => ({ metres: l.metres, y: round(l.y) })),
        };
    }
    return {
        schemaVersion: 1,
        id: 'avatar-chatbot',
        runtime: '3D-Avatar-Chatbot',
        generatedBy: 'tools/ambience/export-camera-contract.mjs',
        sourceOfTruth: 'src/gltf-viewer/ambience/CalibrationGeometry.js',
        nominalAvatar: NOMINAL_AVATAR,
        // No timestamp, deliberately: the file is committed and diffed, and a date that changed
        // on every run would make every regeneration look like a change.
        profiles,
    };
}

const OUT = resolve(ROOT, 'assets/ambient/camera-contract.json');

if (import.meta.url === `file://${process.argv[1]}`) {
    writeFileSync(OUT, JSON.stringify(buildContract(), null, 2) + '\n');
    console.log(`wrote ${OUT}`);
}
