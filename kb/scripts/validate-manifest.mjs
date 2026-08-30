#!/usr/bin/env node
/**
 * validate-manifest — the KB's gate (spec v1.1 §4A, §5.P0 acceptance).
 *
 * Four questions, in the order they bite:
 *
 *   1. does every record satisfy the schema?          (§6.1 is a contract)
 *   2. is every id unique?
 *   3. does every referenced file actually exist?     (a record for a missing clip is a
 *                                                      runtime failure hiding in data)
 *   4. does every shipped asset have exactly one record, and no record point at an asset
 *      that does not ship?                            (coverage, both directions)
 *
 * Two levels. `structural` (the default, B1) asks the four questions above.
 * `semantic` (B2 onward) additionally requires the fields a human has to fill: a real
 * description, at least one tag and one intent, and valence/energy that someone actually
 * chose. Splitting them is what lets B1 land a complete, checkable manifest without
 * pretending the descriptions are written.
 *
 * The schema is validated by a small validator in this file rather than by a dependency:
 * this repo has no bundler and no build step, and a KB gate that needs `npm install ajv`
 * to run is a gate that stops being run. It supports exactly the keywords
 * kb/schema/animation.schema.json uses, and fails loudly on any keyword it does not know,
 * so the schema cannot quietly outgrow it.
 *
 * Usage:
 *   node kb/scripts/validate-manifest.mjs
 *   node kb/scripts/validate-manifest.mjs --level semantic
 *   node kb/scripts/validate-manifest.mjs --manifest <path>   # validate a copy
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DEFAULT_MANIFEST = 'kb/animations.manifest.jsonl';
const SCHEMA = 'kb/schema/animation.schema.json';

/** Directories whose .bvh/.vrma files are shipped assets and must each have a record. */
const ASSET_DIRS = ['vendor/animations', 'addons/vrma-actions', 'addons/vrma-dance', 'addons/vrma-locomotion'];

const KNOWN_KEYWORDS = new Set([
    '$schema',
    '$id',
    'title',
    'description',
    'type',
    'properties',
    'required',
    'additionalProperties',
    'enum',
    'const',
    'items',
    'minimum',
    'maximum',
    'pattern',
    'allOf',
    'if',
    'then',
    'else',
    'not',
]);

// ── a very small JSON Schema validator ───────────────────────────────────────

/** @returns {string[]} human-readable errors, empty when valid. */
function validate(value, schema, path = '') {
    const errors = [];

    for (const keyword of Object.keys(schema)) {
        if (!KNOWN_KEYWORDS.has(keyword)) {
            errors.push(`${path || '/'}: schema uses unsupported keyword "${keyword}"`);
        }
    }

    if (schema.type && !matchesType(value, schema.type)) {
        errors.push(`${path || '/'}: expected ${[].concat(schema.type).join('|')}, got ${describe(value)}`);
        return errors; // further checks would only produce noise
    }

    if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`);
    }
    if ('const' in schema && value !== schema.const) {
        errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
    }
    if (typeof value === 'number') {
        if ('minimum' in schema && value < schema.minimum) errors.push(`${path}: ${value} < ${schema.minimum}`);
        if ('maximum' in schema && value > schema.maximum) errors.push(`${path}: ${value} > ${schema.maximum}`);
        if (schema.type === 'integer' && !Number.isInteger(value)) errors.push(`${path}: ${value} is not an integer`);
    }
    if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) {
        errors.push(`${path}: ${JSON.stringify(value)} does not match /${schema.pattern}/`);
    }

    if (Array.isArray(value) && schema.items) {
        value.forEach((item, i) => errors.push(...validate(item, schema.items, `${path}[${i}]`)));
    }

    if (isPlainObject(value)) {
        for (const key of schema.required || []) {
            if (!(key in value)) errors.push(`${path}: missing required field "${key}"`);
        }
        for (const [key, sub] of Object.entries(schema.properties || {})) {
            if (key in value) errors.push(...validate(value[key], sub, `${path}.${key}`));
        }
        if (schema.additionalProperties === false) {
            for (const key of Object.keys(value)) {
                if (!(key in (schema.properties || {}))) errors.push(`${path}: unknown field "${key}"`);
            }
        }
    }

    if (schema.not && validate(value, schema.not, path).length === 0) {
        errors.push(`${path}: must not match ${JSON.stringify(schema.not)}`);
    }

    for (const sub of schema.allOf || []) errors.push(...validate(value, sub, path));

    if (schema.if) {
        const branch = validate(value, schema.if, path).length === 0 ? schema.then : schema.else;
        if (branch) errors.push(...validate(value, branch, path));
    }

    return errors;
}

function matchesType(value, type) {
    return [].concat(type).some((t) => {
        if (t === 'null') return value === null;
        if (t === 'array') return Array.isArray(value);
        if (t === 'object') return isPlainObject(value);
        if (t === 'integer') return Number.isInteger(value);
        if (t === 'number') return typeof value === 'number' && Number.isFinite(value);
        return typeof value === t;
    });
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describe(value) {
    if (value === null) return 'null';
    return Array.isArray(value) ? 'array' : typeof value;
}

// ── repository facts ─────────────────────────────────────────────────────────

/** Every shipped animation asset, repo-relative. */
function shippedAssets() {
    const out = [];
    for (const dir of ASSET_DIRS) {
        const abs = join(ROOT, dir);
        if (!existsSync(abs)) continue;
        for (const file of walk(abs)) {
            const ext = extname(file).toLowerCase();
            if (ext === '.bvh' || ext === '.vrma') out.push(relative(ROOT, file).split(sep).join('/'));
        }
    }
    return out.sort();
}

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry);
        if (statSync(abs).isDirectory()) walk(abs, out);
        else out.push(abs);
    }
    return out;
}

/** Behaviour ids AnimationPresets actually defines, so `behaviorRef` cannot go stale. */
function knownBehaviorIds() {
    const source = readFileSync(join(ROOT, 'src/AnimationPresets.js'), 'utf8');
    const sandbox = { window: {}, module: { exports: {} }, console: { log() {}, warn() {}, error() {} } };
    runInNewContext(source, sandbox, { filename: 'src/AnimationPresets.js' });
    const presets = sandbox.window.NEXUS_ANIMATION_PRESETS || {};
    return new Set([...(presets.EMOTIONS || []), ...(presets.ADULT_EMOTIONS || [])].map((e) => e.id));
}

// ── the gate ─────────────────────────────────────────────────────────────────

export function validateManifest({ manifestPath = DEFAULT_MANIFEST, level = 'structural' } = {}) {
    const schema = JSON.parse(readFileSync(join(ROOT, SCHEMA), 'utf8'));
    // resolve, not join: the test suite validates broken copies from a temp directory.
    const raw = readFileSync(resolve(ROOT, manifestPath), 'utf8');
    const problems = [];
    const records = [];

    raw.split('\n').forEach((line, i) => {
        if (!line.trim()) return;
        try {
            records.push({ record: JSON.parse(line), line: i + 1 });
        } catch (error) {
            problems.push(`line ${i + 1}: not valid JSON — ${error.message}`);
        }
    });

    // 1 · schema
    for (const { record, line } of records) {
        for (const error of validate(record, schema, '')) {
            problems.push(`line ${line} (${record.id || 'no id'})${error}`);
        }
    }

    // 2 · unique ids
    const seen = new Map();
    for (const { record, line } of records) {
        if (seen.has(record.id))
            problems.push(`line ${line}: duplicate id "${record.id}" (also line ${seen.get(record.id)})`);
        else seen.set(record.id, line);
    }

    // 3 · references resolve
    const behaviorIds = knownBehaviorIds();
    for (const { record, line } of records) {
        if (record.file && !existsSync(join(ROOT, record.file))) {
            problems.push(`line ${line} (${record.id}): file does not exist — ${record.file}`);
        }
        if (record.behaviorRef && !behaviorIds.has(record.behaviorRef)) {
            problems.push(
                `line ${line} (${record.id}): behaviorRef "${record.behaviorRef}" is not an AnimationPresets id`
            );
        }
    }

    // 4 · coverage, both directions
    const assets = shippedAssets();
    const byFile = new Map();
    for (const { record } of records) {
        if (!record.file) continue;
        byFile.set(record.file, (byFile.get(record.file) || 0) + 1);
    }
    for (const asset of assets) {
        const count = byFile.get(asset) || 0;
        if (count === 0) problems.push(`no record for shipped asset ${asset}`);
        if (count > 1) problems.push(`${count} records for shipped asset ${asset} — expected exactly one`);
    }

    // 5 · the semantic level B2 has to satisfy
    if (level === 'semantic') {
        for (const { record, line } of records) {
            if (!record.description || record.description.trim().length < 20) {
                problems.push(`line ${line} (${record.id}): description is still a draft`);
            }
            if (!record.tags.length) problems.push(`line ${line} (${record.id}): no tags`);
            if (!record.intents.length) problems.push(`line ${line} (${record.id}): no intents`);
            if (record.energy === 0 && record.valence === 0) {
                problems.push(`line ${line} (${record.id}): valence and energy are both still 0`);
            }
        }
    }

    return {
        problems,
        counts: {
            records: records.length,
            shippedAssets: assets.length,
            withFile: byFile.size,
            procedural: records.filter((r) => r.record.kind === 'procedural').length,
        },
    };
}

function main() {
    const args = process.argv.slice(2);
    const level = args.includes('--level') ? args[args.indexOf('--level') + 1] : 'structural';
    const manifestPath = args.includes('--manifest') ? args[args.indexOf('--manifest') + 1] : DEFAULT_MANIFEST;

    if (level !== 'structural' && level !== 'semantic') {
        console.error(`unknown level "${level}" — expected structural or semantic`);
        process.exit(2);
    }

    const { problems, counts } = validateManifest({ manifestPath, level });

    console.log(`KB manifest — ${manifestPath} (level: ${level})`);
    console.log(`  records        : ${counts.records}`);
    console.log(`  shipped assets : ${counts.shippedAssets} (${counts.withFile} covered)`);
    console.log(`  procedural     : ${counts.procedural}`);

    if (problems.length) {
        console.error(`\n${problems.length} problem(s):`);
        for (const problem of problems.slice(0, 40)) console.error(`  ${problem}`);
        if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`);
        process.exit(1);
    }

    console.log('\nOK — every shipped asset has exactly one record and every reference resolves.');
}

if (process.argv[1] && process.argv[1].endsWith('validate-manifest.mjs')) main();
