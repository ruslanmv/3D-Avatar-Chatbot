#!/usr/bin/env node
/**
 * audit-budgets — is the engine inside §9's numbers? (batch B19)
 *
 * §9 budgets four things:
 *
 *   frame       < 2 ms per frame for the whole engine
 *   tier1       < 50 ms from intent to a chosen clip
 *   textures    ≤ 1080p
 *   scene load  < 3 s warm
 *
 * ## What a Node process can and cannot say
 *
 * Two of these are arithmetic and are measured here for real: the frame cost and the Tier-1
 * latency are pure CPU over the shipped knowledge base, and Node runs the same code the
 * browser does. The numbers below are honest measurements of that code.
 *
 * They are **not Quest measurements.** A headset has a slower core and a GPU this process
 * does not have, so what this audit establishes is *headroom*, not compliance: an engine
 * that needs 1.9 ms here has already failed, and one that needs 0.05 ms has room for the
 * ten-times-slower core it will meet. Where a claim needs the device — a texture upload, a
 * scene load over a real network — the audit says so and defers to `docs/QA_CHECKLIST.md`,
 * which a person runs on the hardware.
 *
 * Usage:
 *   node scripts/audit-budgets.mjs           # report
 *   node scripts/audit-budgets.mjs --check   # exit 1 if a measured budget is missed
 *   node scripts/audit-budgets.mjs --json    # machine-readable
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Load one of the engine's browser modules.
 *
 * `require()` cannot: `package.json` says `"type": "module"`, so Node reads a `.js` file as
 * ESM and its `module.exports =` is a silent no-op — the import succeeds and hands back an
 * empty namespace. That trap has bitten this repository before (see docs/PATHMAP.md §2b),
 * and it degrades quietly rather than throwing, so this throws instead when a module
 * publishes nothing.
 *
 * Loading in order matters: these files read each other off `window` at definition time.
 */
const sandbox = { window: {}, module: { exports: {} }, console: { log() {}, warn() {}, error() {} } };
const loaded = new Set();

function load(relPath, pick) {
    // One sandbox, loaded once each. These files are top-level `const` declarations, so
    // evaluating one twice in the same context is a redeclaration error — and evaluating
    // them in *separate* contexts would break the ones that read each other off `window`.
    if (!loaded.has(relPath)) {
        sandbox.module = { exports: {} };
        runInNewContext(readFileSync(join(ROOT, relPath), 'utf8'), sandbox, { filename: relPath });
        loaded.add(relPath);
    }
    const value = pick(sandbox);
    if (!value) throw new Error(`${relPath} published nothing the audit can read`);
    return value;
}

const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config/behavior.config.json'), 'utf8'));

/**
 * How much of the budget a Node measurement may use before the audit calls it a risk.
 * A quarter, because the device is slower and the margin is the whole point of measuring
 * here rather than pretending this is a headset.
 */
const HEADROOM = 0.25;

/** Best of N. The floor is what the code costs; the spread above it is the machine. */
const RUNS = 5;

function best(runs, fn) {
    let lowest = Infinity;
    for (let i = 0; i < runs; i++) {
        const started = process.hrtime.bigint();
        const iterations = fn();
        lowest = Math.min(lowest, Number(process.hrtime.bigint() - started) / 1e6 / iterations);
    }
    return lowest;
}

// ── frame ────────────────────────────────────────────────────────────────────

function measureFrame() {
    const Pose = load('src/behavior/mixer/PoseBuffer.js', (s) => s.window.NEXUS_BD_POSE_BUFFER);
    const Masks = load('src/behavior/mixer/BoneMasks.js', (s) => s.window.NEXUS_BD_BONE_MASKS);
    const { Mixer } = load('src/behavior/mixer/LayerMixer.js', (s) => s.window.NEXUS_BD_LAYER_MIXER);
    load('src/behavior/scheduler/TransitionRules.js', (s) => s.window.NEXUS_BD_TRANSITIONS);
    const { ClipScheduler } = load('src/behavior/scheduler/Scheduler.js', (s) => s.window.NEXUS_BD_SCHEDULER);
    const Blackboard = load('src/behavior/ContextBlackboard.js', (s) => s.window.NEXUS_BD_BLACKBOARD);

    const bones = Masks.bonesFor('fullBody');
    const blackboard = new Blackboard({});
    const written = [];
    const mixer = new Mixer({ applyBone: (bone, q) => written.push(bone) });
    mixer.basePose = new Pose.Buffer();
    for (const bone of bones) mixer.basePose.set(bone, [0, 0, 0, 1]);

    for (const [name, mask, order] of [
        ['procedural', 'fullBody', 0],
        ['clipA', 'fullBody', 1],
        ['clipB', 'fullBody', 2],
        ['head', 'head', 3],
    ]) {
        const layer = mixer.addLayer({ name, mask, order, weight: 0.5 });
        for (const bone of Masks.bonesFor(mask)) layer.buffer.set(bone, [0, 0.15, 0, 0.99]);
    }

    const scheduler = new ClipScheduler({ mixer, now: () => 0 });
    scheduler.request({ id: 'x', layer: 'fullBody', priority: 3, loop: true, stats: {} });

    const FRAMES = 600;
    const msPerFrame = best(RUNS, () => {
        for (let i = 0; i < FRAMES; i++) {
            blackboard.tick(0.0167);
            scheduler.tick(0.0167);
            mixer.update();
        }
        return FRAMES;
    });

    return { msPerFrame, bones: bones.length, writesPerFrame: mixer.lastWriteCount };
}

// ── tier 1 ───────────────────────────────────────────────────────────────────

function measureTier1() {
    load('src/behavior/registry/validate.js', (s) => s.window.NEXUS_BD_VALIDATE);
    const Registry = load('src/behavior/registry/AnimationRegistry.js', (s) => s.window.NEXUS_BD_REGISTRY);
    const AntiRepeat = load('src/behavior/selector/AntiRepeatMemory.js', (s) => s.window.NEXUS_BD_ANTI_REPEAT);
    const { Ranker } = load('src/behavior/selector/UtilityRanker.js', (s) => s.window.NEXUS_BD_RANKER);
    const { Selector } = load('src/behavior/selector/SemanticSelector.js', (s) => s.window.NEXUS_BD_SELECTOR);
    const Blackboard = load('src/behavior/ContextBlackboard.js', (s) => s.window.NEXUS_BD_BLACKBOARD);

    const registry = new Registry().loadText(readFileSync(join(ROOT, 'kb/animations.manifest.jsonl'), 'utf8'));
    const selector = new Selector()
        .loadVocabularyText(readFileSync(join(ROOT, 'kb/embeddings/index.vocab.tsv'), 'utf8'))
        .index(registry.records);
    const ranker = new Ranker({ antiRepeat: new AntiRepeat(CONFIG.antiRepeatWindow) });
    const blackboard = new Blackboard({});

    const intents = ['happy', 'dance', 'wave', 'thinking', 'celebrate', 'console', 'idle'];
    const PICKS = 200;
    const msPerPick = best(RUNS, () => {
        for (let i = 0; i < PICKS; i++) {
            const intent = { name: intents[i % intents.length], intensity: 0.6, source: 'llm' };
            ranker.best(selector.topK(intent, registry, CONFIG.topK), intent, blackboard);
        }
        return PICKS;
    });

    // Cold start is the other half: the vocabulary load and the index build happen once, at
    // boot, and a slow one delays the first gesture rather than every gesture.
    const coldStarted = process.hrtime.bigint();
    const cold = new Selector()
        .loadVocabularyText(readFileSync(join(ROOT, 'kb/embeddings/index.vocab.tsv'), 'utf8'))
        .index(registry.records);
    const coldMs = Number(process.hrtime.bigint() - coldStarted) / 1e6;

    return { msPerPick, coldMs, records: registry.size, vocabulary: cold.column.size };
}

// ── assets ───────────────────────────────────────────────────────────────────

/** Anything the engine's own directories would ship. §9 caps textures at 1080p. */
function measureAssets() {
    const roots = ['src/features/together/scenes', 'kb/embeddings'];
    const files = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }
        for (const entry of entries) {
            const abs = join(dir, entry);
            if (statSync(abs).isDirectory()) walk(abs);
            else files.push({ path: relative(ROOT, abs).split(sep).join('/'), bytes: statSync(abs).size });
        }
    };
    roots.forEach((r) => walk(join(ROOT, r)));

    const images = files.filter((f) => /\.(ktx2|png|jpe?g|webp|basis)$/i.test(f.path));
    const total = files.reduce((sum, f) => sum + f.bytes, 0);
    return {
        files: files.length,
        images: images.length,
        totalBytes: total,
        largest: files.sort((a, b) => b.bytes - a.bytes)[0],
    };
}

// ── report ───────────────────────────────────────────────────────────────────

function audit() {
    const frame = measureFrame();
    const tier1 = measureTier1();
    const assets = measureAssets();

    const frameCeiling = CONFIG.budgets.frameMs * HEADROOM;
    const tier1Ceiling = CONFIG.budgets.tier1Ms * HEADROOM;

    const checks = [
        {
            id: 'frame',
            budget: `${CONFIG.budgets.frameMs} ms/frame`,
            measured: `${frame.msPerFrame.toFixed(4)} ms`,
            ceiling: frameCeiling,
            value: frame.msPerFrame,
            pass: frame.msPerFrame < frameCeiling,
            note: `blend + scheduler over ${frame.bones} bones on 4 layers`,
        },
        {
            id: 'tier1',
            budget: `${CONFIG.budgets.tier1Ms} ms/pick`,
            measured: `${tier1.msPerPick.toFixed(4)} ms`,
            ceiling: tier1Ceiling,
            value: tier1.msPerPick,
            pass: tier1.msPerPick < tier1Ceiling,
            note: `select + rank over ${tier1.records} records, ${tier1.vocabulary}-term vocabulary`,
        },
        {
            id: 'tier1-cold',
            budget: '3000 ms boot',
            measured: `${tier1.coldMs.toFixed(1)} ms`,
            ceiling: 3000 * HEADROOM,
            value: tier1.coldMs,
            pass: tier1.coldMs < 3000 * HEADROOM,
            note: 'vocabulary load + index build, once at boot',
        },
        {
            id: 'textures',
            budget: '≤1080p',
            measured: `${assets.images} image assets in engine directories`,
            ceiling: null,
            value: assets.images,
            // Vacuously true today and honestly reported as such: the scene art is not in
            // the repository (B14), so there is nothing here to be over budget. A person
            // checks this on the device once the art lands.
            pass: assets.images === 0,
            note: assets.images === 0 ? 'no image assets shipped yet — see docs/QA_CHECKLIST.md' : 'measure on device',
        },
    ];

    return { checks, detail: { frame, tier1, assets }, headroom: HEADROOM };
}

function main() {
    const mode = process.argv[2] || '--report';
    const result = audit();

    if (mode === '--json') {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    console.log('Behavior Director — budgets audit (§9)\n');
    console.log('  Measured in Node, not on a Quest. These numbers establish headroom:');
    console.log(`  a measurement must come in under ${HEADROOM * 100}% of the budget, because the`);
    console.log('  device is slower and the margin is the point.\n');

    for (const check of result.checks) {
        const mark = check.pass ? 'PASS' : 'FAIL';
        console.log(`  [${mark}] ${check.id.padEnd(12)} ${check.measured.padEnd(28)} budget ${check.budget}`);
        console.log(`         ${check.note}`);
    }

    const failed = result.checks.filter((c) => !c.pass);
    console.log('');
    console.log('  On-device claims this audit cannot make — see docs/QA_CHECKLIST.md:');
    console.log('    · sustained framerate on Quest-class hardware with an avatar loaded');
    console.log('    · 1080p video texture upload during Watch Together');
    console.log('    · scene load under 3 s warm, with the art in place');

    if (mode === '--check') {
        if (failed.length) {
            console.error(`\nFAILED: ${failed.map((c) => c.id).join(', ')}`);
            process.exit(1);
        }
        console.log('\nOK — every measurable budget is inside its headroom.');
    }
}

if (process.argv[1] && process.argv[1].endsWith('audit-budgets.mjs')) main();

export { audit, HEADROOM };
