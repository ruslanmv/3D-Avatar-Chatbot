#!/usr/bin/env node
/**
 * harvest-existing — build the KB manifest from what this repo already knows.
 *
 * Spec §5.P0 assumes the KB is authored. It does not have to be: this repo already
 * carries four independent records of its own animation library, and reading them is both
 * faster and more truthful than describing 151 clips from memory.
 *
 *   vendor/animations/manifest.json  categories, the `experimental` flag, emotion→clip
 *                                   mappings, and the pack credits that give every asset
 *                                   its licence
 *   src/xr/MotionClipMap.js          which clips the running app can actually reach, with
 *                                   their loop/sticky flags — and the eight Mixamo-origin
 *                                   dance clips it deliberately excludes
 *   src/AnimationPresets.js          the procedural behaviours, including which are adult
 *   the filesystem                   the ground truth of what actually ships
 *
 * Both JS sources are read by *executing* them, not by pattern-matching their text, so
 * the KB cannot drift from the tables the app itself uses.
 *
 * What this script does NOT do is author meaning. `description`, `valence` and `energy`
 * are left as drafts for B2, where a human approves them; the measured numbers behind
 * them live in `stats`, where they are facts rather than opinions. Suggested energy
 * values are written to the harvest report so B2 starts from data instead of a blank page.
 *
 * Usage:
 *   node kb/scripts/harvest-existing.mjs           # report what would change
 *   node kb/scripts/harvest-existing.mjs --write   # write manifest + harvest report
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { bvhStatsFromFile } from './extract-bvh-stats.mjs';
import { vrmaStats } from './extract-vrma-stats.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MANIFEST = 'kb/animations.manifest.jsonl';
const REPORT = 'kb/harvest-report.json';

/** Where shipped animation assets live. `category` is the bucket the record inherits. */
const ASSET_ROOTS = [
    { dir: 'vendor/animations', pack: 'vendor', categoryFromDir: true },
    { dir: 'addons/vrma-actions', pack: 'addons-actions', category: 'action' },
    { dir: 'addons/vrma-dance', pack: 'addons-dance', category: 'dance' },
    { dir: 'addons/vrma-locomotion', pack: 'addons-locomotion', category: 'locomotion' },
];

/**
 * Playback defaults by category. These are policy, not measurement — the priority order
 * of §6.4 (Reaction > Talk > Emote > Idle) expressed as numbers, with a cooldown that
 * keeps a big clip from repeating. B2 reviews them alongside the descriptions.
 */
const CATEGORY_DEFAULTS = {
    idle: { priority: 1, cooldownMs: 0 },
    sitting: { priority: 2, cooldownMs: 5000 },
    laying: { priority: 2, cooldownMs: 5000 },
    kneeling: { priority: 2, cooldownMs: 5000 },
    emotion: { priority: 3, cooldownMs: 8000 },
    action: { priority: 3, cooldownMs: 8000 },
    exercise: { priority: 3, cooldownMs: 8000 },
    locomotion: { priority: 3, cooldownMs: 4000 },
    vrma: { priority: 3, cooldownMs: 8000 },
    dance: { priority: 4, cooldownMs: 20000 },
};
const DEFAULTS = { priority: 3, cooldownMs: 8000 };

/**
 * Licence and provenance, from vendor/animations/manifest.json's own credits block and
 * from the pack READMEs. Where the repo does not say, the record says it does not say —
 * an invented licence is worse than an honest "unknown".
 */
const PROVENANCE = {
    vendor: { source: 'sillytavern-vrm-assets-pack', license: 'Community use' },
    'vendor-vrma': { source: 'tk256ailab-vrm-viewer', license: 'Open source' },
    'addons-actions': { source: 'davincidreams-3dchat (mixamo origin)', license: 'unknown' },
    'addons-dance': { source: 'davincidreams-3dchat (mixamo origin)', license: 'unknown' },
    'addons-dance-converted': { source: 'bvh2vrma from vendor/animations/dance', license: 'Community use' },
    'addons-locomotion': { source: 'generated (retarget_mixamo_to_vrma.py)', license: 'unknown' },
    procedural: { source: 'in-repo (AnimationPresets)', license: 'Apache-2.0' },
};

/**
 * The retarget note the eight excluded clips carry. MotionClipMap states the fault and
 * why the files stay on disk; a record that dropped that note would look like an ordinary
 * clip to the ranker, which is exactly how a broken clip reaches an avatar.
 */
const MIXAMO_RETARGET_NOTE =
    'Mixamo rest-pose mismatch: raw quaternions applied to the normalized VRM rig drive ' +
    'the upper legs through ~180°, so the legs invert and splay. Excluded from ' +
    "MotionClipMap's candidate lists; restore only if the retarget grows rest-pose " +
    'conjugation for non-conformant sources. See addons/vrma-dance/README.md.';

/** Per-kind divisors that turn the measured energy proxy into a 0..1 suggestion for B2. */
const ENERGY_SCALE = { bvh: 0.8, vrma: 1.9 };

// ── sources ──────────────────────────────────────────────────────────────────

/**
 * Run one of the app's browser-side modules and hand back what it published.
 *
 * `require()` is not an option: package.json declares `"type": "module"`, so Node reads
 * these `.js` files as ESM, where the `module.exports = …` line at the bottom of
 * MotionClipMap is a no-op — the require would hand back an empty namespace and the
 * harvest would silently degrade to whatever the other sources knew. Running the source
 * in a sandbox with the globals it actually expects gets the real tables, and fails
 * loudly if a module ever stops publishing them.
 */
function loadBrowserModule(relPath, pick) {
    const source = readFileSync(join(ROOT, relPath), 'utf8');
    const sandbox = {
        window: {},
        module: { exports: {} },
        console: { log() {}, warn() {}, error() {} },
    };
    runInNewContext(source, sandbox, { filename: relPath });
    const value = pick(sandbox);
    if (!value) throw new Error(`${relPath} published nothing this harvest can read`);
    return value;
}

function loadMotionClipMap() {
    return loadBrowserModule('src/xr/MotionClipMap.js', (s) => s.window.NEXUS_MOTION_CLIPS || s.module.exports);
}

function loadAnimationPresets() {
    return loadBrowserModule('src/AnimationPresets.js', (s) => s.window.NEXUS_ANIMATION_PRESETS);
}

function loadVendorManifest() {
    return JSON.parse(readFileSync(join(ROOT, 'vendor/animations/manifest.json'), 'utf8'));
}

/** Every animation asset that ships, as a repo-relative path. */
function shippedAssets() {
    const out = [];
    for (const root of ASSET_ROOTS) {
        const abs = join(ROOT, root.dir);
        let entries;
        try {
            entries = walk(abs);
        } catch {
            continue; // an optional pack that is not installed
        }
        for (const file of entries) {
            const ext = extname(file).toLowerCase();
            if (ext !== '.bvh' && ext !== '.vrma') continue;
            const rel = relative(ROOT, file).split(sep).join('/');
            const category = root.categoryFromDir
                ? rel.split('/')[2] // vendor/animations/<category>/<file>
                : root.category;
            out.push({ file: rel, pack: root.pack, category });
        }
    }
    return out.sort((a, b) => a.file.localeCompare(b.file));
}

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry);
        if (statSync(abs).isDirectory()) walk(abs, out);
        else out.push(abs);
    }
    return out;
}

// ── derivation ───────────────────────────────────────────────────────────────

/** A stable id: kind, category, and the file's own name. Re-harvesting reproduces it. */
function makeId(kind, category, file) {
    const stem = basename(file, extname(file));
    return [kind, category, stem]
        .join('_')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
}

/** Which MotionClipMap entries can reach this file, and what flags they play it with. */
function clipMapFacts(clips, relPath) {
    const names = [];
    let loop = false;
    let sticky = false;

    for (const [name, entry] of Object.entries(clips.ENTRIES || {})) {
        const candidates = entry.candidates || [];
        if (!candidates.some((c) => c === relPath || relPath.endsWith(c))) continue;
        names.push(name);
        loop = loop || Boolean(entry.loop);
        sticky = sticky || Boolean(entry.sticky);
    }

    // The addon packs are listed by bare filename rather than by path.
    const base = basename(relPath);
    if ((clips.ADDON_DANCE || []).includes(base)) names.push('dance');
    if ((clips.ADDON_ACTIONS || []).includes(base)) names.push('action');

    return { names: [...new Set(names)].sort(), loop, sticky };
}

/** Emotions the vendor manifest already maps to this file — intents we did not invent. */
function mappedEmotions(vendorManifest, relPath) {
    const suffix = relPath.replace(/^vendor\/animations\//, '');
    const hits = [];
    for (const [emotion, files] of Object.entries(vendorManifest.emotionMapping || {})) {
        if ((files || []).some((f) => f === suffix)) hits.push(emotion);
    }
    return hits.sort();
}

/** Build one clip record. */
function clipRecord({ file, pack, category }, ctx) {
    const kind = extname(file).toLowerCase() === '.bvh' ? 'bvh' : 'vrma';
    const stats = kind === 'bvh' ? bvhStatsFromFile(join(ROOT, file)) : vrmaStats(join(ROOT, file));
    const facts = clipMapFacts(ctx.clips, file);
    const emotions = mappedEmotions(ctx.vendorManifest, file);

    const excluded = ctx.excludedMixamo.has(basename(file));
    // The vendor manifest's `experimental` flag describes *its own* categories. The
    // converted addons/vrma-dance pack shares the name "dance" but is the pack
    // MotionClipMap actually plays, so it must not inherit the BVH pack's caveat.
    const categoryExperimental = pack === 'vendor' && Boolean(ctx.vendorManifest.categories?.[category]?.experimental);
    const quality = excluded || categoryExperimental ? 'experimental' : 'production';

    const provenanceKey =
        pack === 'vendor' && kind === 'vrma'
            ? 'vendor-vrma'
            : pack === 'addons-dance' && !excluded
              ? 'addons-dance-converted'
              : pack;
    const provenance = PROVENANCE[provenanceKey] || { source: pack, license: 'unknown' };
    const policy = CATEGORY_DEFAULTS[category] || DEFAULTS;

    const record = {
        id: makeId(kind, category, file),
        kind,
        file,
        description: '',
        tags: [...new Set([category, pack])].sort(),
        intents: [...new Set([...facts.names, ...emotions])].sort(),
        valence: 0,
        energy: 0,
        stats: {
            duration: stats.duration,
            rootMotion: stats.rootMotion ?? null,
            meanJointVel: stats.meanJointVel ?? null,
        },
        layer: stats.layer,
        loop: facts.loop,
        priority: policy.priority,
        interruptible: !facts.sticky,
        cooldownMs: policy.cooldownMs,
        nsfw: false,
        quality,
        ...(quality === 'experimental'
            ? {
                  retarget: excluded
                      ? MIXAMO_RETARGET_NOTE
                      : `vendor/animations/manifest.json marks the "${category}" category experimental.`,
              }
            : {}),
        source: provenance.source,
        license: provenance.license,
        version: 1,
    };

    return { record, facts, emotions, excluded };
}

/** Build the procedural records from AnimationPresets — behaviourRef, never a file. */
function proceduralRecords(presets) {
    const emotions = [...(presets.EMOTIONS || []), ...(presets.ADULT_EMOTIONS || [])];
    const modes = presets.ANIMATION_MODES || presets.MODES || {};

    return emotions.map((emotion) => {
        const mode = modes[emotion.mode] || {};
        const bones = Object.keys(mode.anim || mode.bones || {});
        const drivesLegs = bones.some((b) => /hip|leg|knee|foot|toe|ankle/i.test(b));

        return {
            id: makeId('proc', 'behavior', emotion.id),
            kind: 'procedural',
            behaviorRef: emotion.id,
            description: '',
            tags: ['procedural', emotion.adult ? 'adult' : 'sfw'].sort(),
            intents: [emotion.id, emotion.mode].filter(Boolean).sort(),
            valence: 0,
            energy: 0,
            stats: {
                duration: emotion.duration ? emotion.duration / 1000 : null,
                rootMotion: 0,
                meanJointVel: null,
            },
            layer: drivesLegs ? 'fullBody' : 'upperBody',
            loop: !emotion.duration,
            priority: emotion.id === 'idle' || emotion.id === 'waiting' ? 1 : 3,
            interruptible: true,
            cooldownMs: emotion.id === 'idle' || emotion.id === 'waiting' ? 0 : 6000,
            nsfw: Boolean(emotion.adult),
            quality: 'production',
            source: PROVENANCE.procedural.source,
            license: PROVENANCE.procedural.license,
            version: 1,
        };
    });
}

// ── main ─────────────────────────────────────────────────────────────────────

export function harvest() {
    const clips = loadMotionClipMap();
    const presets = loadAnimationPresets();
    const vendorManifest = loadVendorManifest();

    // The eight clips MotionClipMap deliberately keeps out of its candidate lists: they
    // ship, so they get records, but never quietly as ordinary production clips.
    const excludedMixamo = new Set(
        readdirSync(join(ROOT, 'addons/vrma-dance'))
            .filter((f) => f.endsWith('.vrma'))
            .filter((f) => !(clips.ADDON_DANCE || []).includes(f))
    );

    const ctx = { clips, presets, vendorManifest, excludedMixamo };
    const assets = shippedAssets();

    const records = [];
    const orphans = [];
    const energySuggestions = {};

    for (const asset of assets) {
        const { record, facts, emotions } = clipRecord(asset, ctx);
        records.push(record);
        if (!facts.names.length && !emotions.length) orphans.push(record.id);
        const scale = ENERGY_SCALE[record.kind];
        if (record.stats.meanJointVel !== null && scale) {
            energySuggestions[record.id] = Math.min(1, Math.round((record.stats.meanJointVel / scale) * 100) / 100);
        }
    }

    records.push(...proceduralRecords(presets));
    records.sort((a, b) => a.id.localeCompare(b.id));

    // Candidates the clip map points at that are not on disk: a broken fallback chain is
    // invisible at runtime (the next candidate wins), and invisible is how it stays broken.
    const shipped = new Set(assets.map((a) => a.file));
    const danglingCandidates = [];
    for (const [name, entry] of Object.entries(clips.ENTRIES || {})) {
        for (const candidate of entry.candidates || []) {
            if (!shipped.has(candidate) && !candidate.startsWith('addons/vrma-locomotion/')) {
                danglingCandidates.push({ entry: name, candidate });
            }
        }
    }

    const report = {
        $comment:
            'Generated by kb/scripts/harvest-existing.mjs. Not a contract — this is the ' +
            'working note B2 picks up: what was derived, what is still a draft, and what ' +
            'the harvest noticed on the way past.',
        counts: {
            total: records.length,
            byKind: tally(records, (r) => r.kind),
            byQuality: tally(records, (r) => r.quality),
            nsfw: records.filter((r) => r.nsfw).length,
            withIntents: records.filter((r) => r.intents.length).length,
        },
        drafts: {
            note: 'description, valence and energy are empty by design in B1; B2 fills them with a human in the loop.',
            missingDescription: records.filter((r) => !r.description).length,
            energySuggestions,
            energyScale: ENERGY_SCALE,
        },
        excludedMixamoClips: [...excludedMixamo].sort(),
        orphans: {
            note: 'Shipped assets no MotionClipMap entry and no emotion mapping can reach today. The KB is what makes them selectable.',
            ids: orphans.sort(),
        },
        danglingCandidates,
        packs: PROVENANCE,
    };

    return { records, report };
}

function tally(records, key) {
    const out = {};
    for (const record of records) out[key(record)] = (out[key(record)] || 0) + 1;
    return Object.fromEntries(Object.entries(out).sort());
}

function main() {
    const write = process.argv.includes('--write');
    const { records, report } = harvest();

    if (write) {
        writeFileSync(join(ROOT, MANIFEST), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
        writeFileSync(join(ROOT, REPORT), JSON.stringify(report, null, 2) + '\n');
    }

    console.log(`harvested ${records.length} records`);
    console.log('  by kind    :', JSON.stringify(report.counts.byKind));
    console.log('  by quality :', JSON.stringify(report.counts.byQuality));
    console.log('  nsfw       :', report.counts.nsfw);
    console.log('  with intents:', report.counts.withIntents);
    console.log('  orphans    :', report.orphans.ids.length);
    console.log('  dangling candidates:', report.danglingCandidates.length);
    console.log(write ? `\nwrote ${MANIFEST} and ${REPORT}` : '\ndry run — pass --write to update the manifest');
}

if (process.argv[1] && process.argv[1].endsWith('harvest-existing.mjs')) main();
