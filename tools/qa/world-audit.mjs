#!/usr/bin/env node
/**
 * AX10. The 3D half of the Quality Lab: is every world ready for desktop, phone and headset?
 *
 *   node tools/qa/world-audit.mjs            # write quality-lab/data/3d/worlds-audit.json
 *   node tools/qa/world-audit.mjs --check    # exit 1 if the committed audit is out of date
 *
 * Why generated and not written. The facts about a world are already in the repository —
 * assets/vr-worlds/worlds.json (tiers, measured triangles, places, ratings, light stand-ins),
 * the scene and panorama files, the place previews, the measured spots (with the SHA-256 of the
 * GLB they were measured on) and the playground templates. A page that restated them by hand
 * would drift the first time someone re-cut a light scene. So this reads the files and asks the
 * shipping code — VRWorlds' own `validateCatalogue`, `allowedOn`, `resolveFor` and
 * `comfortProblem`, the template catalogue's `TEMPLATES` — the same questions the app asks at
 * runtime, and writes down the answers. tests/quality-lab.test.js regenerates it and fails on
 * any difference, so a world change and its audit land in the same commit.
 *
 * What it cannot see, and says so: frame rate, how a scene looks, whether she stands well in
 * it, headset comfort beyond prop placement. Those are browser and device checks (the README's
 * "Checks you run" table); this audit never marks them done.
 *
 * Deterministic: no timestamps, sorted output, hashes only of files the spots claim to match.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const WORLDS_DIR = path.join(ROOT, 'assets/vr-worlds');
const OUT = path.join(ROOT, 'quality-lab/data/3d/worlds-audit.json');

/** Rules the audit enforces; the page prints them, so they are stated once, here. */
export const RULES = Object.freeze({
    previewMaxBytes: 60 * 1024,
    devices: ['desktop', 'mobile', 'vr'],
});

function loadIIFE(rel) {
    const mod = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { module: mod, globalThis: {}, console });
    return mod.exports;
}

function fileInfo(rel) {
    if (!rel) return null;
    const abs = path.join(WORLDS_DIR, rel);
    const exists = fs.existsSync(abs);
    return { src: rel, exists, bytes: exists ? fs.statSync(abs).size : null };
}

function sha256(abs) {
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function spotsFor(sceneSrc) {
    if (!sceneSrc) return null;
    const file = path.join(WORLDS_DIR, 'spots', path.basename(sceneSrc, '.glb') + '.json');
    if (!fs.existsSync(file)) return null;
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const glb = path.join(WORLDS_DIR, sceneSrc);
    const spots = Array.isArray(doc.spots) ? doc.spots : [];
    return {
        file: path.relative(ROOT, file).split(path.sep).join('/'),
        total: spots.length,
        verified: spots.filter((s) => s.verified === true).length,
        ids: spots.filter((s) => s.verified === true).map((s) => s.id),
        matchesScene: fs.existsSync(glb) ? sha256(glb) === doc.sha256 : false,
    };
}

export function audit() {
    const V = loadIIFE('src/gltf-viewer/VRWorlds.js');
    const T = loadIIFE('src/experiences/playgrounds/PlaygroundTemplateCatalog.js');
    const catalogue = JSON.parse(fs.readFileSync(path.join(WORLDS_DIR, 'worlds.json'), 'utf8'));
    const { worlds, problems } = V.validateCatalogue(catalogue);
    const privateConfigs = fs
        .readdirSync(path.join(WORLDS_DIR, 'private'))
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(WORLDS_DIR, 'private', f), 'utf8')));

    const out = [];
    for (const w of worlds) {
        const issues = [];
        const fail = (text) => issues.push({ severity: 'fail', text });
        const warn = (text) => issues.push({ severity: 'warn', text });

        for (const p of problems.filter((x) => x.startsWith(`world ${w.id}`))) fail(p);

        const scene = w.scene ? fileInfo(w.scene.src) : null;
        if (scene && !scene.exists) fail(`scene file missing: ${scene.src}`);
        const panoramas = Object.values(w.panorama || {}).map(fileInfo);
        for (const p of panoramas) if (!p.exists) fail(`panorama missing: ${p.src}`);
        const props = (w.props || []).map((p) => ({
            src: p.src,
            exists: fs.existsSync(path.join(WORLDS_DIR, p.src)),
            comfort: V.comfortProblem(p),
        }));
        for (const p of props) {
            if (!p.exists) fail(`prop missing: ${p.src}`);
            if (p.comfort) fail(`prop ${path.basename(p.src)} is ${p.comfort}`);
        }

        const preview = fileInfo(w.preview);
        if (w.place && !w.lightFor) {
            if (!preview) fail('place has no preview picture (PG2)');
            else if (!preview.exists) fail(`preview missing: ${preview.src}`);
            else if (preview.bytes > RULES.previewMaxBytes)
                fail(`preview is ${Math.round(preview.bytes / 1024)} KB, over 60 KB`);
        }

        const spots = spotsFor(w.scene && w.scene.src);
        if (spots && !spots.matchesScene)
            fail('spots were measured on a different version of the scene — re-run measure-spots');
        if (w.place && w.scene && !spots && !w.lightFor)
            warn('no measured spots: she cannot move within this place (LW2)');

        const standIn = worlds.find((x) => x.lightFor === w.id) || null;
        const devices = {};
        for (const tier of RULES.devices) {
            if (w.lightFor) {
                const ok = V.allowedOn(w, tier);
                devices[tier] = {
                    ok,
                    shows: ok ? w.id : null,
                    why: ok ? `stand-in for ${w.lightFor}` : 'not a tier of this stand-in',
                };
                continue;
            }
            const shows = w.place ? V.resolveFor(worlds, w.id, tier, true) : V.allowedOn(w, tier) ? w.id : null;
            let why;
            if (shows === w.id) why = 'loads itself';
            else if (shows) why = `loads its light stand-in ${shows}`;
            else if (tier === 'mobile' && Number(w.triangles) > V.MOBILE_TRIANGLES)
                why = `${w.triangles} triangles > ${V.MOBILE_TRIANGLES}, no stand-in`;
            else why = 'not in its tiers';
            devices[tier] = { ok: Boolean(shows), shows: shows || null, why };
        }
        if (w.place && !w.lightFor)
            for (const tier of RULES.devices)
                if (!devices[tier].ok) warn(`not offered on ${tier}: ${devices[tier].why}`);

        const template = (T.TEMPLATES || []).find((t) => t.world === w.id || t.world === w.lightFor) || null;
        const privateWorld = privateConfigs.find((c) => (c.worlds || []).includes(w.id)) || null;

        out.push({
            id: w.id,
            title: w.title,
            kind: w.lightFor ? 'stand-in' : w.place ? 'place' : 'activity world',
            rating: w.rating || null,
            category: w.category || null,
            activities: w.activities || [],
            lightFor: w.lightFor || null,
            standIn: standIn ? standIn.id : null,
            triangles: Number(w.triangles) || 0,
            look: w.scene ? 'assembled scene' : panoramas.length ? 'panorama' : w.sky ? 'stylized sky' : 'colour',
            scene,
            preview,
            props: props.length,
            spots,
            template: template
                ? { id: template.id || template.world, actions: (template.actions || []).map((a) => a.id) }
                : null,
            privateConfig: privateWorld
                ? { id: privateWorld.id, interactions: (privateWorld.interactions || []).length }
                : null,
            devices,
            issues,
        });
    }

    const count = (fn) => out.filter(fn).length;
    const summary = {
        worlds: out.length,
        places: count((w) => w.kind === 'place'),
        standIns: count((w) => w.kind === 'stand-in'),
        withSpots: count((w) => w.spots && w.spots.verified > 0),
        fails: out.reduce((n, w) => n + w.issues.filter((i) => i.severity === 'fail').length, 0),
        warns: out.reduce((n, w) => n + w.issues.filter((i) => i.severity === 'warn').length, 0),
        offered: Object.fromEntries(
            RULES.devices.map((d) => [d, count((w) => w.kind !== 'stand-in' && w.devices[d].ok)])
        ),
        catalogueProblems: problems.length,
        mobileTriangleBudget: V.MOBILE_TRIANGLES,
    };
    return { schema: 1, generator: 'tools/qa/world-audit.mjs', rules: RULES, summary, worlds: out };
}

function main() {
    const text = JSON.stringify(audit(), null, 4) + '\n';
    if (process.argv.includes('--check')) {
        const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
        if (old !== text) {
            console.error('quality-lab/data/3d/worlds-audit.json is out of date: run node tools/qa/world-audit.mjs');
            process.exit(1);
        }
        console.log('world audit up to date');
        return;
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    const s = JSON.parse(text).summary;
    console.log(`audited ${s.worlds} worlds: ${s.fails} fail, ${s.warns} warn ·`, JSON.stringify(s.offered));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
