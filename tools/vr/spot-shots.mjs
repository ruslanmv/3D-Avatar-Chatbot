#!/usr/bin/env node
/**
 * LW6. Every measured spot of every place, seen in the real app: a picture and a clipping check.
 *
 *     node tools/vr/spot-shots.mjs                    # every place that has verified spots
 *     node tools/vr/spot-shots.mjs restaurant cinema  # some
 *     node tools/vr/spot-shots.mjs --device mobile    # the phone's worlds (default: desktop)
 *
 * `measure-spots.mjs` proves a spot on the bare GLB. This proves it where it is used: the app is
 * opened on the place (`?vrWorld=<id>`, so a phone gets its light stand-in), the spots of the scene
 * file that is actually up are loaded through `NEXUS_WORLD_SPOTS` (the only reader the app has),
 * and for each one the runtime's own `goToSpot` moves the room under her, exactly as a
 * conversation would. Then, per spot:
 *
 *   - `moved`: goToSpot answered ok and reports this spot;
 *   - `inside`: how many of the scene's vertices are inside her body column (0.25 m round her,
 *     ankle to head) after the move. She stays at the origin, so this is a count in the renderer's
 *     own world space, independent of the measuring tool's rays. It must be 0;
 *   - a JPEG of the canvas, for a person to look at.
 *
 * Writes tmp/shots/spots/<world>-<spot>-<device>.jpg and tmp/shots/spots/report-<device>.json
 * (gitignored). Exit 1 when any spot did not move or has geometry inside her. Headless
 * SwiftShader: what is drawn and where, never frame rate or headset comfort.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
    ROOT,
    SWIFTSHADER,
    loadPlaywright,
    waitForApp,
    waitForWorld,
    ensureServer,
    catalogue,
    canvasJpeg,
    waitForFadeIn,
} from './page-driver.mjs';

const args = process.argv.slice(2);
const di = args.indexOf('--device');
const device = di >= 0 ? args[di + 1] : 'desktop';
const only = args.filter((a, i) => !a.startsWith('--') && (di < 0 || i !== di + 1));
const OUT = path.join(ROOT, 'tmp/shots/spots');
fs.mkdirSync(OUT, { recursive: true });

const { playwright, why } = loadPlaywright();
if (!playwright) {
    console.error(why);
    process.exit(2);
}
const worlds = catalogue();
const spotFiles = new Set(
    fs.readdirSync(path.join(ROOT, 'assets/vr-worlds/spots')).map((f) => f.replace(/\.json$/, ''))
);
const hasSpots = (w) => w && w.scene && spotFiles.has(path.basename(w.scene.src, '.glb'));
// A place is asked for by its own id; the page resolves it to what this device shows.
const places = worlds
    .filter((w) => w.place && !w.lightFor && w.rating !== 'private')
    .filter((w) => !only.length || only.includes(w.id))
    .filter((w) => hasSpots(w) || worlds.some((l) => l.lightFor === w.id && hasSpots(l)));

const server = await ensureServer('http://127.0.0.1:8080');
const browser = await playwright.chromium.launch({ args: SWIFTSHADER });
const report = { device, places: [], failures: [] };
try {
    const ctx = await browser.newContext(
        device === 'mobile'
            ? { ...playwright.devices['Pixel 7'], deviceScaleFactor: 1 }
            : { viewport: { width: 1280, height: 800 } }
    );
    await ctx.addInitScript(() => {
        localStorage.setItem('npc_enabled', 'false');
        localStorage.setItem('nexus_together_enabled', 'on');
    });
    for (const place of places) {
        const page = await ctx.newPage();
        const entry = { place: place.id, shown: null, scene: null, spots: [] };
        report.places.push(entry);
        try {
            await page.goto(`${server.base}/?vrWorld=${place.id}`, { waitUntil: 'domcontentloaded' });
            await waitForApp(page);
            await page.waitForFunction(() => window.NEXUS_VIEWER.vrWorlds.activeId && window.NEXUS_WORLD_SPOTS, null, {
                timeout: 180000,
            });
            entry.shown = await page.evaluate(() => window.NEXUS_VIEWER.vrWorlds.activeId);
            await waitForWorld(page, entry.shown, 60000);
            await waitForFadeIn(page);
            const shownWorld = worlds.find((w) => w.id === entry.shown);
            entry.scene = shownWorld && shownWorld.scene ? shownWorld.scene.src : null;
            const spots = entry.scene
                ? await page.evaluate(async (src) => {
                      const file = await window.NEXUS_WORLD_SPOTS.load(src);
                      return file ? file.spots : [];
                  }, entry.scene)
                : [];
            if (!spots.length) {
                entry.note = 'no verified spots for the scene this device shows';
                continue;
            }
            for (const spot of spots) {
                const r = await page.evaluate(
                    async ({ spot, src }) => {
                        const rt = window.NEXUS_VIEWER.vrWorlds;
                        const res = await rt.goToSpot(spot, { instant: true });
                        // The scene object the runtime placed, found by the name it gives it.
                        let node = null;
                        window.NEXUS_VIEWER.scene.traverse((o) => {
                            if (o.name === 'vr-world-scene:' + src) node = o;
                        });
                        let inside = 0;
                        let nearest = Infinity;
                        if (node) {
                            node.updateMatrixWorld(true);
                            node.traverse((m) => {
                                if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
                                const p = m.geometry.attributes.position;
                                const e = m.matrixWorld.elements;
                                for (let i = 0; i < p.count; i += 1) {
                                    const x = p.getX(i);
                                    const y = p.getY(i);
                                    const z = p.getZ(i);
                                    const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
                                    const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
                                    const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
                                    if (wy < 0.15 || wy > 1.6) continue;
                                    const d = Math.hypot(wx, wz);
                                    if (d < nearest) nearest = d;
                                    if (d < 0.25) inside += 1;
                                }
                            });
                        }
                        return {
                            ok: Boolean(res && res.ok),
                            why: res && res.why ? res.why : null,
                            spotId: res && res.spotId ? res.spotId : null,
                            sceneFound: Boolean(node),
                            inside,
                            nearestVertexM: Number.isFinite(nearest) ? Math.round(nearest * 100) / 100 : null,
                        };
                    },
                    { spot, src: entry.scene }
                );
                await page.waitForTimeout(500);
                const file = `${place.id}-${spot.id}-${device}.jpg`;
                fs.writeFileSync(path.join(OUT, file), await canvasJpeg(page));
                const moved = r.ok && r.sceneFound;
                entry.spots.push({ id: spot.id, moved, ...r, file });
                if (!moved) report.failures.push(`${place.id}/${spot.id}: did not move (${r.why || 'no scene'})`);
                if (r.inside > 0) report.failures.push(`${place.id}/${spot.id}: ${r.inside} scene vertices inside her`);
                console.log(
                    `${place.id.padEnd(18)} ${spot.id.padEnd(16)} ${moved ? 'moved' : 'NOT MOVED'}  inside ${r.inside}  nearest ${r.nearestVertexM} m  → ${file}`
                );
            }
        } catch (e) {
            entry.error = String(e && e.message ? e.message : e).slice(0, 200);
            report.failures.push(`${place.id}: ${entry.error}`);
            console.log(`${place.id}: ${entry.error}`);
        } finally {
            await page.close();
        }
    }
    await ctx.close();
} finally {
    fs.writeFileSync(path.join(OUT, `report-${device}.json`), JSON.stringify(report, null, 1));
    await browser.close();
    server.stop();
}
const total = report.places.reduce((n, p) => n + p.spots.length, 0);
console.log(`${device}: ${report.places.length} places, ${total} spots, ${report.failures.length} failures`);
process.exit(report.failures.length ? 1 : 0);
