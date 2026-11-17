#!/usr/bin/env node
/**
 * VW12. Prepare a downloaded scene for the app in one step: optimise, measure, cut a phone/Quest
 * version, and refuse what would run badly on a phone or a Quest.
 *
 *     node tools/vr/prepare-scene.mjs --sketchfab <model uid> --name <stem>
 *     node tools/vr/prepare-scene.mjs --file <scene.glb> --name <stem>
 *
 * Writes assets/vr-worlds/scenes/<stem>.glb and, when the scene is over the phone budget,
 * <stem>-light.glb. Prints, for each, the numbers worlds.json and
 * PROVENANCE.md need (triangles, draw calls, texture memory) and the next commands.
 *
 * Steps, in order (the batch VW12 found each one necessary):
 *   1. Sketchfab: the signed-in download API (a token for api.sketchfab.com in the environment's
 *      network secrets; the licence is read from the API and must be CC0 or CC BY).
 *   2. Textures to at most 1024 px WebP, unused data pruned. Geometry untouched and not
 *      compressed: tools/vr/*.mjs read GLB directly and do not decode Meshopt or Draco.
 *   3. split-by-material.mjs: one named top-level node per material, so spots can stand her
 *      "by the blackboard". A one-material scene keeps its node (use `anywhere` spots).
 *   4. Over 30 000 triangles, or over the light texture budget: a light version, simplified
 *      (meshoptimizer) to under 28 000, colour textures only at 512 px.
 *   5. Refused (nothing written) when even the light version breaks the phone/Quest budget:
 *      over 30 000 triangles, more than 40 draw calls, or more than 32 MB of texture memory.
 *      The night street (142 MB) and the grandma's house (36 draw calls, 44 MB) were refused so.
 *
 * gltf-transform and sharp are not dependencies of this repository: the first run installs
 * pinned versions into tmp/gltf-tools/ (gitignored), as subset-scene.mjs fetches its exporter.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCENES = path.join(ROOT, 'assets/vr-worlds/scenes');
const TOOLS = path.join(ROOT, 'tmp/gltf-tools');
const BUDGET = { triangles: 30000, lightTarget: 27000, drawCalls: 40, textureMB: 32 };

function arg(name) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : null;
}

async function tools() {
    if (!fs.existsSync(path.join(TOOLS, 'node_modules/@gltf-transform/functions'))) {
        fs.mkdirSync(TOOLS, { recursive: true });
        fs.writeFileSync(path.join(TOOLS, 'package.json'), '{"private":true}');
        execFileSync(
            'npm',
            [
                'install',
                '--silent',
                '@gltf-transform/core@4.1.1',
                '@gltf-transform/extensions@4.1.1',
                '@gltf-transform/functions@4.1.1',
                'meshoptimizer@0.22.0',
                'sharp@0.33.5',
            ],
            { cwd: TOOLS, stdio: 'inherit' }
        );
    }
    const req = createRequire(path.join(TOOLS, 'package.json'));
    const names = [
        '@gltf-transform/core',
        '@gltf-transform/extensions',
        '@gltf-transform/functions',
        'meshoptimizer',
        'sharp',
    ];
    return Promise.all(names.map((m) => import(pathToFileURL(req.resolve(m)).href)));
}

async function download(uid, out) {
    const api = (p) =>
        fetch(`https://api.sketchfab.com/v3/models/${uid}${p}`).then((r) => {
            if (!r.ok) throw new Error(`Sketchfab ${p || 'model'}: HTTP ${r.status} (a token for api.sketchfab.com?)`);
            return r.json();
        });
    const meta = await api('');
    const licence = (meta.license && meta.license.label) || '';
    if (!/^(CC0|CC Attribution)$/.test(licence))
        throw new Error(`"${meta.name}" is "${licence}": only CC0 or CC BY (not NC, ND or SA) ship here`);
    const links = await api('/download');
    if (!links.glb) throw new Error('no GLB download offered');
    const bytes = Buffer.from(await (await fetch(links.glb.url)).arrayBuffer());
    fs.writeFileSync(out, bytes);
    return {
        name: meta.name,
        author: (meta.user && meta.user.displayName) || '',
        username: (meta.user && meta.user.username) || '',
        licence,
        url: meta.viewerUrl,
    };
}

async function main() {
    const name = arg('--name');
    const uid = arg('--sketchfab');
    const file = arg('--file');
    if (!name || !/^[a-z0-9-]+$/.test(name) || (!uid && !file))
        throw new Error('usage: prepare-scene.mjs (--sketchfab <uid> | --file <x.glb>) --name <lowercase-dashed-stem>');
    const [{ NodeIO }, { ALL_EXTENSIONS }, F, { MeshoptSimplifier }, sharpModule] = await tools();
    const sharp = sharpModule.default || sharpModule;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const work = path.join(ROOT, 'tmp/prepare-scene');
    fs.mkdirSync(work, { recursive: true });
    const raw = path.join(work, `${name}.raw.glb`);
    let credit = null;
    if (uid) credit = await download(uid, raw);
    else fs.copyFileSync(path.resolve(file), raw);

    const measure = async (doc) => {
        const r = doc.getRoot();
        let tris = 0;
        let calls = 0;
        for (const m of r.listMeshes())
            for (const p of m.listPrimitives()) {
                calls++;
                tris += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
            }
        let mb = 0;
        for (const t of r.listTextures()) {
            const img = t.getImage();
            if (!img) continue;
            const m = await sharp(Buffer.from(img)).metadata();
            mb += (m.width * m.height * 4 * 1.33) / 1048576;
        }
        return { triangles: Math.round(tris), drawCalls: calls, textureMB: Math.round(mb) };
    };

    // 2. Desktop: textures to 1024 px WebP, pruned; geometry as authored.
    const full = await io.read(raw);
    await full.transform(
        F.prune(),
        F.dedup(),
        F.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] })
    );
    const fullOut = path.join(SCENES, `${name}.glb`);
    await io.write(fullOut, full);
    execFileSync(process.execPath, [path.join(ROOT, 'tools/vr/split-by-material.mjs'), fullOut], { stdio: 'inherit' });
    const fullCost = await measure(await io.read(fullOut));

    // 4. Phone/Quest: needed when the full scene is over any light budget.
    const needsLight =
        fullCost.triangles > BUDGET.triangles ||
        fullCost.drawCalls > BUDGET.drawCalls ||
        fullCost.textureMB > BUDGET.textureMB;
    let lightCost = null;
    if (needsLight) {
        const light = await io.read(fullOut);
        for (const m of light.getRoot().listMaterials()) {
            m.setNormalTexture(null);
            m.setOcclusionTexture(null);
            m.setMetallicRoughnessTexture(null);
            m.setMetallicFactor(0);
            m.setRoughnessFactor(1);
        }
        const ratio = Math.min(1, BUDGET.lightTarget / Math.max(1, fullCost.triangles));
        const steps = [F.prune(), F.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512] })];
        if (ratio < 1) {
            await MeshoptSimplifier.ready;
            steps.unshift(F.weld(), F.simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.03 }));
        }
        await light.transform(...steps);
        lightCost = await measure(light);
        const over = Object.entries({
            triangles: BUDGET.triangles,
            drawCalls: BUDGET.drawCalls,
            textureMB: BUDGET.textureMB,
        })
            .filter(([k, v]) => lightCost[k] > v)
            .map(([k, v]) => `${k} ${lightCost[k]} > ${v}`);
        if (over.length) {
            fs.rmSync(fullOut);
            console.error(`${name}: refused for phone and Quest even reduced (${over.join(', ')}). Nothing written.`);
            process.exit(2);
        }
        await io.write(path.join(SCENES, `${name}-light.glb`), light);
    }

    console.log(`\n${name}`);
    console.log(
        `  scenes/${name}.glb        ${JSON.stringify(fullCost)}  tiers: ${needsLight ? '["desktop"]' : '["mobile", "desktop", "vr"]'}`
    );
    if (lightCost)
        console.log(
            `  scenes/${name}-light.glb  ${JSON.stringify(lightCost)}  tiers: ["mobile", "vr"], lightFor: "${name}"`
        );
    if (credit)
        console.log(
            `  credit: "${credit.name}" by ${credit.author} (${credit.username}), ${credit.licence}, ${credit.url}`
        );
    console.log('\nNext (docs/claude/adding-a-place.md):');
    console.log(`  1. spot targets in tools/vr/spot-targets.json ("floorUnderRoof": true for a room with a ceiling)`);
    console.log(
        `  2. node tools/vr/measure-spots.mjs scenes/${name}.glb${lightCost ? `   and   scenes/${name}-light.glb` : ''}`
    );
    console.log(
        '  3. worlds.json entries (scene.at/turn from the first verified spot), PROVENANCE.md row, credit in the note'
    );
    console.log(
        '  4. node tools/vr/render-place-previews.mjs <id>; look at the pictures; world-audit; npm run validate'
    );
}

main().catch((e) => {
    console.error(String((e && e.message) || e));
    process.exit(1);
});
