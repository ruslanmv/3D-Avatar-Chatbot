#!/usr/bin/env node
/**
 * AX16. The animation half of the Quality Lab 3D folder: do every shipped avatar,
 * Pose Navigator pose, VRMA clip and BVH category file exist — and, when asked,
 * does each one actually play without looking broken?
 *
 *   node tools/qa/animation-audit.mjs              # write quality-lab/data/3d/animations-audit.json
 *   node tools/qa/animation-audit.mjs --check       # exit 1 if the committed audit is stale
 *   node tools/qa/animation-audit.mjs --play        # browser: sample clips × avatars → CSV + shots
 *   node tools/qa/animation-audit.mjs --play --full # every clip on every avatar (slow)
 *   node tools/qa/animation-audit.mjs --play --avatar Vita --category sitting
 *
 * Why two modes. The inventory is generated from files the same way world-audit
 * is — committed, deterministic, tested with --check. Playback needs a live page
 * and Playwright; its CSVs and frame JPEGs land under tmp/animation-audit/ (and
 * optionally under quality-lab/data/3d/animations/ when --publish-csv is set) so
 * a SwiftShader run never pretends to be a committed fact.
 *
 * Broken means the scorer's fail/warn flags (tools/qa/AnimationPlaybackScorer.js):
 * load failure, NaN bones, near-black frame, inverted legs, stuck T-pose, no
 * motion on a clip that should move. It does not mean frame rate or headset
 * comfort.
 *
 * Product rule this protects: when the person says "sit down", "dance", "come
 * with me" or any other IntentFastPath / MotionClipMap motion, the avatar must
 * move — a spoken yes in the bubble with a frozen body is a failed experience.
 * See docs/claude/animations-and-motion.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
    ROOT,
    SWIFTSHADER,
    loadPlaywright,
    waitForApp,
    frameCheck,
    canvasJpeg,
    ensureServer,
} from '../vr/page-driver.mjs';
import { writeHub } from './hub.mjs';

/** Load an IIFE dual-export the way Jest does — package.json is "type":"module". */
function loadIIFE(rel) {
    const mod = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), {
        module: mod,
        exports: mod.exports,
        console,
        window: undefined,
        globalThis: {},
    });
    return mod.exports;
}

const Scorer = loadIIFE('tools/qa/AnimationPlaybackScorer.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'quality-lab/data/3d/animations-audit.json');
const CSV_DIR_DEFAULT = path.join(ROOT, 'tmp/animation-audit');

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);

/** Pose Navigator list — keep in step with PoseStudioPanel NAV_PRESETS / VRPoseSystem. */
export const NAV_PRESETS = Object.freeze([
    { id: 'lecturerNeutral', label: 'Lecturer', category: 'Presenter' },
    { id: 'presenterOpen', label: 'Presenter', category: 'Presenter' },
    { id: 'anchorGrounded', label: 'Anchor', category: 'Presenter' },
    { id: 'standingRelaxed', label: 'Relaxed', category: 'Standing' },
    { id: 'standingFriendly', label: 'Friendly', category: 'Standing' },
    { id: 'standingHandsClasped', label: 'Hands Clasped', category: 'Standing' },
    { id: 'conversational', label: 'Conversational', category: 'Standing' },
    { id: 'standingBendForward', label: 'Bent Over', category: 'Standing' },
    { id: 'standingBentBackward', label: 'Bent Backward', category: 'Standing' },
    { id: 'confident', label: 'Confident', category: 'Companion' },
    { id: 'lounge', label: 'Lounge', category: 'Companion' },
    { id: 'shy', label: 'Shy', category: 'Companion' },
    { id: 'elegant', label: 'Elegant', category: 'Companion' },
    { id: 'intimateSafe', label: 'Intimate', category: 'Companion' },
    { id: 'sitting', label: 'Sitting', category: 'Sitting' },
    { id: 'sittingCrossed', label: 'Crossed', category: 'Sitting' },
    { id: 'sittingWide', label: 'Wide', category: 'Sitting' },
    { id: 'sittingDesk', label: 'Desk', category: 'Sitting' },
    { id: 'sittingLegsUp', label: 'Lounging', category: 'Sitting' },
    { id: 'kneeling', label: 'Kneeling', category: 'Kneeling' },
    { id: 'kneelingUp', label: 'Kneeling (Up)', category: 'Kneeling' },
    { id: 'lyingBack', label: 'Back', category: 'Lying' },
    { id: 'lyingBackRelaxed', label: 'Relaxed', category: 'Lying' },
    { id: 'lyingFront', label: 'Front', category: 'Lying' },
    { id: 'lyingSide', label: 'Side', category: 'Lying' },
    { id: 'standing', label: 'T-Pose (Reset)', category: 'Reset' },
]);

/** Spoken commands that must produce motion — the UX contract for AI coders. */
export const MOTION_UX_COMMANDS = Object.freeze([
    { utterance: 'sit down', intent: 'sit', why: 'posture; bubble yes with a standing body is a fail' },
    { utterance: 'dance', intent: 'dance', why: 'clip-first; must play a shipped dance VRMA/BVH' },
    { utterance: 'come with me', intent: 'follow', why: 'follow path, not only a spoken acknowledgement' },
    { utterance: 'wave', intent: 'wave', why: 'one-shot gesture' },
    { utterance: 'lie down', intent: 'lay', why: 'posture like sit' },
    { utterance: 'stand up', intent: 'stand', why: 'leave a sticky posture' },
    { utterance: 'bow', intent: 'bow', why: 'one-shot gesture' },
]);

/** Mixamo-origin add-on dances flagged NOT production-ready. */
const MIXAMO_EXPERIMENTAL = new Set([
    'hipHopDancing.vrma',
    'sambaDancing.vrma',
    'rumbaDancing.vrma',
    'sillyDancing.vrma',
    'twistDance.vrma',
    'hipHopDance.vrma',
    'dancingTwerk.vrma',
    'breakdanceUprock.vrma',
]);

function listFiles(dir, ext) {
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith(ext))
        .sort();
}

function fileExists(rel) {
    return fs.existsSync(path.join(ROOT, rel));
}

/**
 * Inventory every avatar, Pose Navigator pose, manifest clip and add-on VRMA.
 * Deterministic: sorted, no timestamps.
 */
export function audit() {
    const avatarsDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor/avatars/avatars.json'), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor/animations/manifest.json'), 'utf8'));
    const MotionClipMap = loadIIFE('src/xr/MotionClipMap.js');
    const IntentFastPath = loadIIFE('src/xr/IntentFastPath.js');

    const issues = [];
    const fail = (text) => issues.push({ severity: 'fail', text });
    const warn = (text) => issues.push({ severity: 'warn', text });

    const avatars = (avatarsDoc.items || []).map((item) => {
        const rel = path.posix.join(avatarsDoc.basePath.replace(/^\//, ''), item.file);
        const exists = fileExists(rel);
        if (!exists) fail(`avatar missing: ${rel}`);
        return {
            name: item.name,
            file: item.file,
            path: rel,
            exists,
            depictsAdult: !!item.depictsAdult,
            features: item.features || [],
        };
    });

    const poses = NAV_PRESETS.map((p) => ({ ...p, kind: 'pose' }));

    const clips = [];
    const categories = [];
    for (const [id, cat] of Object.entries(manifest.categories || {})) {
        const files = cat.files || [];
        categories.push({
            id,
            label: cat.label || id,
            experimental: !!cat.experimental,
            count: files.length,
        });
        for (const f of files) {
            const rel = path.posix.join(manifest.basePath || 'vendor/animations', f);
            const exists = fileExists(rel);
            if (!exists) fail(`clip missing: ${rel}`);
            clips.push({
                id: f.replace(/\//g, '_'),
                kind: f.toLowerCase().endsWith('.vrma') ? 'vrma' : 'bvh',
                category: id,
                path: rel,
                exists,
                experimental: !!cat.experimental,
                label: path.basename(f, path.extname(f)),
            });
        }
    }

    // Converted dance_* VRMA (production) + Mixamo-origin (experimental, on disk).
    const danceDir = 'addons/vrma-dance';
    for (const f of listFiles(path.join(ROOT, danceDir), '.vrma')) {
        const rel = `${danceDir}/${f}`;
        const experimental = MIXAMO_EXPERIMENTAL.has(f);
        if (experimental)
            warn(`Mixamo-origin dance kept on disk but not production: ${rel} (see addons/vrma-dance/README.md)`);
        clips.push({
            id: `addon_dance_${f}`,
            kind: 'vrma',
            category: experimental ? 'dance-mixamo' : 'dance-vrma',
            path: rel,
            exists: true,
            experimental,
            label: f.replace(/\.vrma$/i, ''),
        });
    }

    const actionsDir = 'addons/vrma-actions';
    for (const f of listFiles(path.join(ROOT, actionsDir), '.vrma')) {
        clips.push({
            id: `addon_action_${f}`,
            kind: 'vrma',
            category: 'actions-vrma',
            path: `${actionsDir}/${f}`,
            exists: true,
            experimental: false,
            label: f.replace(/\.vrma$/i, ''),
        });
    }

    // Intent coverage: every UX command must match IntentFastPath and resolve a candidate.
    const intentCoverage = [];
    for (const cmd of MOTION_UX_COMMANDS) {
        const matched = IntentFastPath.match(cmd.utterance);
        const entry =
            MotionClipMap.ENTRIES[cmd.intent] || MotionClipMap.ENTRIES[(MotionClipMap.ALIASES || {})[cmd.intent]];
        const candidates = entry && Array.isArray(entry.candidates) ? entry.candidates : [];
        const existing = candidates.filter((c) => fileExists(c));
        const ok =
            !!(matched && matched.label) && (cmd.intent === 'follow' || cmd.intent === 'stand' || existing.length > 0);
        if (!matched) fail(`IntentFastPath does not match "${cmd.utterance}"`);
        if (cmd.intent !== 'follow' && cmd.intent !== 'stand' && !existing.length)
            fail(`no playable candidate on disk for intent "${cmd.intent}" (${cmd.utterance})`);
        intentCoverage.push({
            utterance: cmd.utterance,
            intent: cmd.intent,
            fastPath: matched ? matched.label : null,
            candidates: candidates.length,
            existing: existing.length,
            ok,
            why: cmd.why,
        });
    }

    const summary = {
        avatars: avatars.length,
        avatarsMissing: avatars.filter((a) => !a.exists).length,
        poses: poses.length,
        clips: clips.length,
        clipsMissing: clips.filter((c) => !c.exists).length,
        categories: categories.length,
        experimentalClips: clips.filter((c) => c.experimental).length,
        intentsOk: intentCoverage.filter((i) => i.ok).length,
        intents: intentCoverage.length,
        fails: issues.filter((i) => i.severity === 'fail').length,
        warns: issues.filter((i) => i.severity === 'warn').length,
        matrixCells: avatars.filter((a) => a.exists).length * (poses.length + clips.filter((c) => c.exists).length),
    };

    return {
        schema: 1,
        generator: 'tools/qa/animation-audit.mjs',
        rules: {
            product:
                'Every spoken motion (sit down, dance, come with me, wave, lie down, stand up, bow) must move the body — IntentFastPath → MotionClipMap → ClipAnimationLoader. A text-only reply is a UX failure.',
            playback:
                'node tools/qa/animation-audit.mjs --play writes per-avatar CSV and frame screenshots under tmp/animation-audit/',
            scorer: 'tools/qa/AnimationPlaybackScorer.js',
        },
        summary,
        categories,
        avatars,
        poses,
        clips: clips.sort((a, b) => a.path.localeCompare(b.path)),
        intentCoverage,
        issues,
        playback: {
            defaultSuite: 'critical',
            criticalIntents: MOTION_UX_COMMANDS.map((c) => c.intent),
            csvDir: 'tmp/animation-audit',
            publishDir: 'quality-lab/data/3d/animations',
        },
    };
}

export function auditText(doc = audit()) {
    return JSON.stringify(doc, null, 4) + '\n';
}

/** Build the default --play work list (or --full / filters). */
export function buildPlayPlan(inventory, opts = {}) {
    const full = !!opts.full;
    const avatarFilter = (opts.avatar || '').toLowerCase();
    const categoryFilter = (opts.category || '').toLowerCase();
    const avatars = inventory.avatars.filter(
        (a) =>
            a.exists &&
            (!avatarFilter ||
                a.name.toLowerCase().includes(avatarFilter) ||
                a.file.toLowerCase().includes(avatarFilter))
    );

    const criticalPaths = new Set();
    // Prefer sit_idle4, waiting-standard, a dance, a wave action, laying_idle.
    for (const c of inventory.clips) {
        if (!c.exists) continue;
        const base = path.basename(c.path).toLowerCase();
        if (
            base === 'sit_idle4.bvh' ||
            base === 'waiting-standard.vrma' ||
            base === 'dance_1.vrma' ||
            base === 'dance_gangnam_style.vrma' ||
            base === 'waving.vrma' ||
            base === 'laying_idle.bvh' ||
            base === 'angry.vrma' ||
            base === 'sad.vrma' ||
            base === 'thinking.vrma' ||
            base === 'neutral_idle.bvh'
        )
            criticalPaths.add(c.path);
    }

    let clips = inventory.clips.filter((c) => c.exists);
    if (categoryFilter) clips = clips.filter((c) => c.category.toLowerCase() === categoryFilter);
    else if (!full) {
        // One sample per category + all critical paths; skip Mixamo experimental unless asked.
        const seenCat = new Set();
        clips = clips.filter((c) => {
            if (c.experimental) return false;
            if (criticalPaths.has(c.path)) return true;
            if (seenCat.has(c.category)) return false;
            seenCat.add(c.category);
            return true;
        });
    }

    let poses = inventory.poses.slice();
    if (categoryFilter) poses = poses.filter((p) => p.category.toLowerCase() === categoryFilter);
    else if (!full) {
        // Presenter defaults + one sitting + reset — enough to catch Pose Navigator breakage.
        const keep = new Set(['lecturerNeutral', 'presenterOpen', 'sitting', 'standing']);
        poses = poses.filter((p) => keep.has(p.id));
    }

    const jobs = [];
    for (const avatar of avatars) {
        for (const pose of poses) {
            jobs.push({
                avatar: avatar.name,
                avatarFile: avatar.file,
                avatarPath: avatar.path,
                kind: 'pose',
                category: pose.category,
                id: pose.id,
                path: pose.id,
                experimental: false,
            });
        }
        for (const clip of clips) {
            jobs.push({
                avatar: avatar.name,
                avatarFile: avatar.file,
                avatarPath: avatar.path,
                kind: clip.kind,
                category: clip.category,
                id: clip.id,
                path: clip.path,
                experimental: !!clip.experimental,
            });
        }
    }
    return jobs;
}

/** Advance mixers / VRM even when headless rAF is idle, then sample bones. */
async function tickAndSample(page, seconds = 0.35, opts = {}) {
    return page.evaluate(
        async ({ boneNames, seconds }) => {
            // Let the APP's own frame loop run for `seconds`, then read the skeleton it will draw.
            // Ticking the clip loader, vrm.update and VRPoseSystem by hand here disturbed what was
            // measured: with the raw rig sampled, every BVH clip read the same 0.297 rad with the
            // hips at standing height (sit_idle4 included), while the screenshot taken a moment
            // later from the app's loop showed her seated. The loop already orders mixer, humanoid
            // update and Pose Navigator correctly; the audit should measure that, not re-run it.
            const viewer = window.NEXUS_VIEWER;
            const vrm = viewer?.avatarManager?.vrmLoader?.currentVRM;
            await new Promise((resolve) => setTimeout(resolve, Math.max(50, seconds * 1000)));
            const h = vrm?.humanoid;
            if (!h || (typeof h.getRawBoneNode !== 'function' && typeof h.getNormalizedBoneNode !== 'function'))
                return null;
            const out = {};
            for (const name of boneNames) {
                // RAW bones: what is drawn. BVH clips are played onto the raw rig, so the
                // normalized nodes never move under them — sampling those scored every BVH clip
                // "no-motion" with the hips frozen at standing height, while the shots showed her
                // seated, lying or dancing. VRMA drives normalized → raw, so raw sees both.
                const node =
                    (typeof h.getRawBoneNode === 'function' && h.getRawBoneNode(name)) ||
                    (typeof h.getNormalizedBoneNode === 'function' && h.getNormalizedBoneNode(name));
                if (!node) continue;
                // Local quaternion + world position: rotation catches poses that
                // keep the hips planted; position catches sit/lay height changes.
                const q = node.quaternion;
                const p = new THREE.Vector3();
                node.getWorldPosition(p);
                out[name] = { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
            }
            return out;
        },
        { boneNames: Scorer.SAMPLE_BONES, seconds, clipOnly: !!opts.clipOnly } // clipOnly: kept for callers
    );
}

async function sampleBones(page) {
    return tickAndSample(page, 0.05);
}

async function ensureAvatar(page, avatarPath) {
    await page.evaluate(async (url) => {
        const want = url.startsWith('/') ? url : '/' + url;
        const root = window.NEXUS_VIEWER?.avatarManager?.currentRoot;
        const cur = (root && root.name) || '';
        // AvatarRoot:/vendor/avatars/X.vrm — skip reload when already on this file.
        if (cur.endsWith(want) || cur.endsWith(url) || cur.endsWith(want.split('/').pop())) return;
        // Must go through ViewerEngine.loadAvatar so vrPoseSystem.setAvatar,
        // ClipAnimationLoader.registerAvatar and gaze/intimacy rebind — calling
        // avatarManager.setAvatarByUrl alone leaves Pose Navigator writing a
        // disposed skeleton (motion samples stay at rest forever).
        if (typeof window.NEXUS_VIEWER.loadAvatar !== 'function') {
            throw new Error('NEXUS_VIEWER.loadAvatar missing');
        }
        await window.NEXUS_VIEWER.loadAvatar(want);
    }, avatarPath);
    await page.waitForFunction(
        () =>
            window.NEXUS_VIEWER?.avatarManager?.currentRoot &&
            window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM &&
            window.vrPoseSystem &&
            window.vrPoseSystem._bones &&
            window.vrPoseSystem._bones.size > 0,
        null,
        { timeout: 120000 }
    );
    // Let the mixer / procedural register settle.
    await page.waitForTimeout(800);
}

/**
 * Stop any previous clip/pose and plant a lecturerNeutral baseline so each
 * job's "rest" sample is order-independent (Codex P2: consecutive sit/lay
 * jobs were judged against already-seated hips).
 */
async function resetToNeutral(page) {
    await page.evaluate(async () => {
        const loader = window.NEXUS_CLIP_LOADER;
        try {
            if (loader && typeof loader.stopClip === 'function') await loader.stopClip({ fadeOut: 0 });
        } catch (_) {
            /* ignore */
        }
        // Leave pose mode between jobs (PoseStudioPanel._exitPoseMode) so a clip job is measured
        // the way it plays in the app, not under a pose job's settings.
        try {
            window.NEXUS_PROCEDURAL_ANIMATOR?.setPoseMode?.(false);
        } catch (_) {
            /* ignore */
        }
        const vr = window.vrPoseSystem || window.NEXUS_VIEWER?.vrPoseSystem;
        if (vr && typeof vr.applyPreset === 'function') {
            try {
                vr.setEnabled?.(true);
            } catch (_) {
                /* ignore */
            }
            // lecturerNeutral is the Pose Navigator default standing baseline.
            vr.applyPreset('lecturerNeutral', 0);
            for (let i = 0; i < 8; i++) {
                try {
                    vr.update?.(1 / 60);
                } catch (_) {
                    /* ignore */
                }
            }
        }
    });
    await tickAndSample(page, 0.12);
}

async function playJob(page, job) {
    const result = {
        played: false,
        loadError: null,
        rest: null,
        samples: [],
        frame: null,
    };
    try {
        await resetToNeutral(page);
        result.rest = await tickAndSample(page, 0.1);
        if (job.kind === 'pose') {
            const ok = await page.evaluate((poseId) => {
                // ViewerEngine assigns window.vrPoseSystem — that is the Pose Navigator API.
                const vr = window.vrPoseSystem || window.NEXUS_VIEWER?.vrPoseSystem;
                if (vr && typeof vr.applyPreset === 'function') {
                    try {
                        vr.setEnabled?.(true);
                    } catch (_) {
                        /* older builds */
                    }
                    // Exactly what the Pose Navigator does first (PoseStudioPanel._enterPoseMode):
                    // stop clips, let ProceduralAnimator yield, and have vrm.update copy the
                    // normalized pose to the raw bones that are drawn. Without it the preset is
                    // overwritten by the idle animator on the next frame and scores "no-motion".
                    try {
                        window.NEXUS_CLIP_LOADER?.stopClip?.({ fadeOut: 0 });
                        window.NEXUS_ANIMATION_RESOLVER?.stop?.();
                        window.NEXUS_PROCEDURAL_ANIMATOR?.setPoseMode?.(true);
                        const v = window.NEXUS_VIEWER?.avatarManager?._currentVRM;
                        if (v && v.humanoid && 'autoUpdateHumanBones' in v.humanoid)
                            v.humanoid.autoUpdateHumanBones = true;
                    } catch (_) {
                        /* fail soft: the preset is still applied and measured */
                    }
                    vr.applyPreset(poseId, 0);
                    return { ok: true, via: 'vrPoseSystem' };
                }
                const pa = window.NEXUS_PROCEDURAL_ANIMATOR;
                if (pa && typeof pa.setBasePose === 'function') {
                    pa.setBasePose(poseId);
                    return { ok: true, via: 'procedural' };
                }
                return { ok: false, via: null };
            }, job.id);
            result.played = !!ok.ok;
            if (!ok.ok) result.loadError = 'pose-apply-failed';
            result.samples.push(await tickAndSample(page, 0.4));
        } else {
            const played = await page.evaluate(async (clipPath) => {
                const loader = window.NEXUS_CLIP_LOADER;
                if (!loader || typeof loader.playClip !== 'function') return { ok: false, error: 'no-clip-loader' };
                try {
                    // Pose Navigator and procedural must release the skeleton or
                    // the mixer writes are overwritten every tick (same ownership
                    // fight Pose Studio solves by pausing idle while a clip plays).
                    try {
                        window.vrPoseSystem?.setEnabled?.(false);
                    } catch (_) {
                        /* ignore */
                    }
                    if (window.NEXUS_PROCEDURAL_ANIMATOR?.setAllowWithMixer)
                        window.NEXUS_PROCEDURAL_ANIMATOR.setAllowWithMixer(false);
                    if (loader.stopClip) await loader.stopClip({ fadeOut: 0 });
                    const am = window.NEXUS_VIEWER?.avatarManager;
                    if (loader.registerAvatar && am?.currentRoot)
                        loader.registerAvatar(am.currentRoot, am.vrmLoader?.currentVRM || am._currentVRM);
                    const ok = await loader.playClip(clipPath, { loop: true, fadeIn: 0 });
                    return { ok: !!ok, error: ok ? null : 'playClip-false', state: loader.getCurrentPlaybackState?.() };
                } catch (e) {
                    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 200) };
                }
            }, job.path);
            result.played = !!played.ok;
            result.loadError = played.error;
            if (result.played) {
                result.samples.push(await tickAndSample(page, 0.45, { clipOnly: true }));
                result.samples.push(await tickAndSample(page, 0.9, { clipOnly: true }));
            }
        }
        result.frame = await frameCheck(page);
    } catch (e) {
        result.loadError = String(e && e.message ? e.message : e).slice(0, 200);
    }
    return result;
}

/**
 * Run the browser playback suite. Returns rows + paths written.
 */
export async function playAudit(opts = {}) {
    const inventory = opts.inventory || audit();
    const jobs = buildPlayPlan(inventory, opts);
    const outDir = path.resolve(
        ROOT,
        opts.out || (opts.publishCsv ? 'quality-lab/data/3d/animations' : 'tmp/animation-audit')
    );
    const shotsDir = path.join(outDir, 'shots');
    fs.mkdirSync(shotsDir, { recursive: true });

    const { playwright, why } = loadPlaywright();
    if (!playwright) throw new Error(why || 'Playwright missing');

    const server = await ensureServer(opts.base || process.env.NEXUS_LAB_BASE || 'http://127.0.0.1:8080');
    const browser = await playwright.chromium.launch({ args: SWIFTSHADER });
    const rows = [];
    const byAvatar = new Map();

    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(180000);
        await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
        await waitForApp(page, 180000);

        let lastAvatar = null;
        let standingHipsY = null;
        for (const job of jobs) {
            if (job.avatarPath !== lastAvatar) {
                await ensureAvatar(page, job.avatarPath);
                lastAvatar = job.avatarPath;
                // Her standing height on the freshly loaded avatar. A broken VRMA can leave the hips
                // displaced through "reset to neutral", which made the NEXT job's rest baseline
                // wrong (gangnam_style read "floating" at 0.82 m after dance_1 sank her). Float and
                // sink are judged against this, not against a rest a previous clip may have moved.
                const fresh = await sampleBones(page);
                standingHipsY = fresh && fresh.hips ? fresh.hips.y : null;
            }
            const sample = await playJob(page, job);
            const scored = Scorer.score({
                ...sample,
                standingHipsY,
                kind: job.kind,
                category: job.category,
                experimental: job.experimental,
                expectedMotion: job.kind !== 'pose' || job.id !== 'standing',
                blackBackground: true,
            });

            let shot = '';
            const wantShot = opts.shots === 'all' || scored.verdict !== 'ok' || job.experimental;
            if (wantShot && opts.shots !== 'none') {
                const safeAvatar = job.avatarFile.replace(/\.vrm$/i, '');
                const safeId = String(job.id)
                    .replace(/[^\w.-]+/g, '_')
                    .slice(0, 80);
                shot = path.posix.join('shots', `${safeAvatar}__${job.kind}__${safeId}.jpg`);
                const jpeg = await canvasJpeg(page, 0.7, 640);
                fs.writeFileSync(path.join(outDir, shot), jpeg);
            }

            const row = {
                avatar: job.avatar,
                avatarFile: job.avatarFile,
                kind: job.kind,
                category: job.category,
                id: job.id,
                path: job.path,
                played: sample.played,
                verdict: scored.verdict,
                flags: scored.flags,
                motion: scored.motion,
                hipsY: scored.hipsY,
                frameMean: sample.frame ? sample.frame.mean : '',
                frameSd: sample.frame ? sample.frame.sd : '',
                frameVerdict: sample.frame ? sample.frame.verdict : '',
                shot,
                error: sample.loadError || '',
            };
            rows.push(row);
            if (!byAvatar.has(job.avatarFile)) byAvatar.set(job.avatarFile, []);
            byAvatar.get(job.avatarFile).push(row);
        }
        await ctx.close();
    } finally {
        await browser.close();
        server.stop();
    }

    for (const [file, list] of byAvatar) {
        const name = file.replace(/\.vrm$/i, '') + '.csv';
        fs.writeFileSync(path.join(outDir, name), Scorer.rowsToCsv(list));
    }
    fs.writeFileSync(path.join(outDir, 'all.csv'), Scorer.rowsToCsv(rows));

    const summary = {
        jobs: rows.length,
        ok: rows.filter((r) => r.verdict === 'ok').length,
        warn: rows.filter((r) => r.verdict === 'warn').length,
        fail: rows.filter((r) => r.verdict === 'fail').length,
        avatars: byAvatar.size,
        outDir: path.relative(ROOT, outDir).split(path.sep).join('/'),
    };
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ schema: 1, summary, rows }, null, 4) + '\n');
    return { summary, rows, outDir };
}

function writeInventory() {
    const text = auditText();
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    writeHub();
    return JSON.parse(text);
}

function main() {
    if (has('play')) {
        playAudit({
            full: has('full'),
            avatar: arg('avatar', ''),
            category: arg('category', ''),
            out: arg('out', ''),
            base: arg('base', ''),
            shots: arg('shots', 'fail'), // fail | all | none
            publishCsv: has('publish-csv'),
            inventory: audit(),
        })
            .then(({ summary }) => {
                console.log(
                    `playback ${summary.jobs} jobs · ${summary.ok} ok · ${summary.warn} warn · ${summary.fail} fail → ${summary.outDir}`
                );
                if (summary.fail) process.exitCode = 2;
            })
            .catch((e) => {
                console.error(e.message || e);
                process.exit(1);
            });
        return;
    }

    const text = auditText();
    if (has('check')) {
        const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
        if (old !== text) {
            console.error(
                'quality-lab/data/3d/animations-audit.json is out of date: run node tools/qa/animation-audit.mjs'
            );
            process.exit(1);
        }
        console.log('animations audit up to date');
        return;
    }

    const doc = writeInventory();
    const s = doc.summary;
    console.log(
        `audited ${s.avatars} avatars · ${s.poses} poses · ${s.clips} clips · intents ${s.intentsOk}/${s.intents} · ${s.fails} fail · ${s.warns} warn · matrix ${s.matrixCells}`
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
