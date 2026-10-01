#!/usr/bin/env node
/**
 * W11. Install a wardrobe pack as the app's built-in wardrobe, or check the one installed.
 *
 *   npm run wardrobe:import -- <pack folder or .zip> [--dry-run]
 *   npm run wardrobe:check
 *
 * A pack comes from 3D-Wardrobe-Forge (`tools/export_default_wardrobe.py OUT --zip PACK.zip`).
 * Nothing is copied into `vendor/wardrobe/` by hand: this validates every byte first
 * (scripts/wardrobe-pack.cjs says what, and why) and swaps the folder in whole, so the
 * wardrobe in git is always one the check accepts. `wardrobe:check` changes nothing and
 * exits 1 on any problem; a Jest test runs the same check, so `npm run validate` does too.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { checkPack, installPack, readDir } = require('./wardrobe-pack.cjs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'vendor', 'wardrobe');
const args = process.argv.slice(2);

function report(result) {
    result.problems.forEach((problem) => console.error(`  ✗ ${problem}`));
    if (result.ok) {
        const pack = result.manifest.pack || {};
        const avatars = new Set(result.looks.map((look) => look.avatarId));
        console.log(
            `  ✓ ${pack.id} ${pack.version}: ${result.looks.length} looks for ${avatars.size} avatars, verified`
        );
    }
}

if (args.includes('--check')) {
    const result = await checkPack(readDir(target));
    console.log(`vendor/wardrobe/`);
    report(result);
    process.exit(result.ok ? 0 : 1);
}

const source = args.find((arg) => !arg.startsWith('--'));
if (!source) {
    console.error('usage: npm run wardrobe:import -- <pack folder or .zip> [--dry-run]');
    process.exit(2);
}
try {
    const result = await installPack(path.resolve(source), target, { dryRun: args.includes('--dry-run') });
    console.log(source);
    report(result);
    if (result.installed) console.log(`  → installed as vendor/wardrobe/`);
    else if (result.ok) console.log('  (dry run: nothing changed)');
    else console.error('  nothing changed');
    process.exit(result.ok ? 0 : 1);
} catch (error) {
    console.error(`  ✗ ${error.message}\n  nothing changed`);
    process.exit(1);
}
