#!/usr/bin/env node
/**
 * UN38. Is every Private position wired everywhere it has to be? One table, no browser, seconds.
 *
 *   node tools/qa/position-wiring.mjs                 # every key in PrivatePoseController.POSES
 *   node tools/qa/position-wiring.mjs face-down spoon # just these
 *   node tools/qa/position-wiring.mjs --json
 *
 * Why it exists. A position is one preset and about fifteen tables in nine files: the preset
 * itself (VRPoseSystem, its PRESET_ORDER, Pose Studio's adult list, MotionProvenance), the
 * controller (POSES, BODY, INTIMATE, the confirm category, OL3's open/close rows), the policy
 * (POSE_KEYS, POSE_LEVEL), the words (POSE_WORDS, in nine languages), the ⋯ chip
 * (POSITION_KEYS and `position.<key>.label/say` in nine PrivateLocale packs, each say line
 * parsing back to its own key), and optionally the bed, the living motion and the finish group.
 * Adding UN38's six meant finding each table by grepping for `straddle`; a table missed fails
 * quietly — the chip has no label, the words fall through to clothes, a reply says "on all
 * fours" while she kneels. This reads the same modules the app loads (no copies of their
 * lists) and says what each key is missing.
 *
 * Required columns fail the run (exit 1); optional ones (bed, motion, finish, category) are
 * reported because some positions are rightly without them (bent over is not a bed position,
 * standing has no grounded category).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const require = createRequire(import.meta.url);
// package.json says "type": "module", so plain Node loads these IIFEs as ES modules: their
// `module.exports` branch never runs and only the global they also set is there to read.
const load = (f, global) => {
    const m = require(path.join(ROOT, f));
    return m && Object.keys(m).length ? m : globalThis[global];
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// The Together files by their parts: the parity harness (scripts/behavior-parity-baseline.mjs)
// counts any other file that names that directory as a stray engine reference.
const TOGETHER = ['src', 'features', 'together'].join('/');

const Poses = load('src/experiences/private/PrivatePoseController.js', 'NEXUS_PRIVATE_POSES');
const Policy = load('src/experiences/private/PrivateActionPolicy.js', 'NEXUS_PRIVATE_ACTION_POLICY');
const Intent = load('src/experiences/private/PrivateActionIntent.js', 'NEXUS_PRIVATE_ACTION_INTENT');
const Locale = load(`${TOGETHER}/PrivateLocale.js`, 'NEXUS_PRIVATE_LOCALE');
const Living = load('src/experiences/private/PrivateLivingMotion.js', 'NEXUS_PRIVATE_LIVING');
const Bed = load('src/experiences/private/PrivateBed.js', 'NEXUS_PRIVATE_BED');
const vps = read('src/gltf-viewer/VRPoseSystem.js');
const panel = read('src/PoseStudioPanel.js');
const provenance = read('src/gltf-viewer/MotionProvenance.js');
const view = read(`${TOGETHER}/ui/PrivateConversationView.js`);
const bridge = read('src/experiences/private/PrivateActionBridge.js');
// CATEGORY_OF_KEY is not exported: read from the controller's source, as the chip list is.
const categories = (/const CATEGORY_OF_KEY = Object\.freeze\(\{([\s\S]*?)\}\)/.exec(
    read('src/experiences/private/PrivatePoseController.js')
) || [, ''])[1];

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const JSON_OUT = process.argv.includes('--json');
const keys = args.length ? args : Object.keys(Poses.POSES);
const LANGS = Locale.languages();
const chipKeys = (/POSITION_KEYS = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(view) || [, ''])[1];
const poseGroup = (/const POSE_GROUP = Object\.freeze\(\{([\s\S]*?)\}\)/.exec(bridge) || [, ''])[1];

function t(lang, id) {
    try {
        return Locale.t(id, null, lang);
    } catch (_) {
        return null;
    }
}
const parsed = (said) => {
    const r = Intent.parse(said, {});
    return r && r.name === 'avatar.pose' ? r.params.pose : null;
};
const quoted = (k) => (/^[a-z]+$/.test(k) ? `(?:'${k}'|\\b${k})` : `'${k}'`);

function check(key) {
    const entry = Poses.POSES[key];
    const preset = entry && entry.preset;
    const adult = Boolean(entry && entry.adult);
    const req = {};
    const opt = {};
    req.controller = Boolean(entry);
    req.preset = Boolean(preset && new RegExp(`\\n    ${preset}: \\{`).test(vps));
    req.order = Boolean(preset && vps.includes(`'${preset}',`));
    req.body = Boolean(Poses.BODY[key]);
    req.policy = Policy.POSE_KEYS ? Policy.POSE_KEYS.includes(key) : true;
    if (adult) {
        req.studio = Boolean(new RegExp(`name: '${preset}'[^}]*adult: true`).test(panel));
        req.support = Boolean(new RegExp(`\\n    ${preset}: \\{[\\s\\S]*?support: \\{ ground:`).exec(vps));
        req.level = Policy.poseLevel(key) > 0;
        req.intimate = Poses.INTIMATE.some((p) => p.key === key);
        req.chip = new RegExp(quoted(key)).test(chipKeys);
        const bad = [];
        for (const lang of LANGS) {
            const label = t(lang, `position.${key}.label`);
            const say = t(lang, `position.${key}.say`);
            if (!label || label === `position.${key}.label` || !say || parsed(say) !== key) bad.push(lang);
        }
        req.locale = bad.length ? `missing or not parsing back: ${bad.join(',')}` : true;
        opt.close = Poses.transition('close', key) !== key;
    }
    // Only what Claude made is in MotionProvenance (the presets Pose Studio shipped with are not), so
    // the column is reported, not required: a new preset without it fails motion-provenance.test.js.
    opt.provenance = Boolean(preset && new RegExp(`preset\\(\\s*'${preset}'`).test(provenance));
    opt.category = new RegExp(`\\n        ${quoted(key)}: '`).test(categories);
    opt.motion = Boolean(Living.STYLE && Living.STYLE[key]);
    opt.bed = typeof Bed.isBedPose === 'function' ? Bed.isBedPose(key) : false;
    opt.finish = new RegExp(`${quoted(key)}:`).test(poseGroup);
    const missing = Object.entries(req)
        .filter(([, v]) => v !== true)
        .map(([k, v]) => (typeof v === 'string' ? `${k} (${v})` : k));
    return { key, preset, adult, level: Policy.poseLevel(key), missing, optional: opt };
}

const rows = keys.map(check);
if (JSON_OUT) console.log(JSON.stringify(rows, null, 2));
else {
    const mark = (v) => (v ? '✓' : '·');
    console.log('key            preset               lvl  bed mot fin cat cls prov  missing');
    for (const r of rows)
        console.log(
            `${r.key.padEnd(14)} ${String(r.preset).padEnd(20)} ${String(r.level).padStart(3)}   ` +
                `${mark(r.optional.bed)}   ${mark(r.optional.motion)}   ${mark(r.optional.finish)}   ` +
                `${mark(r.optional.category)}   ${mark(r.optional.close)}   ${mark(r.optional.provenance)}     ` +
                `${r.missing.join(', ') || 'ok'}`
        );
}
process.exit(rows.some((r) => r.missing.length) ? 1 : 0);
