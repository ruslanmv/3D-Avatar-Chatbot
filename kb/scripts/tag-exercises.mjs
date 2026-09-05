#!/usr/bin/env node
/**
 * tag-exercises — the B27 content pass (spec v1.1 §6.4, batch B27).
 *
 * Coach mode must choose a demo clip **by intent, never by name**. Today it cannot, and the
 * reason is a gap in the data rather than in the code: every exercise clip in the manifest
 * carries the single intent `exercise`. Asking the selector for `exercise` and getting a
 * crunch when the user asked for jumping jacks is selection by luck.
 *
 * So this pass adds the *specific* intent each clip already depicts, alongside the generic
 * one. It is deliberately tiny and deliberately mechanical:
 *
 *   * it only **adds** intents, never removes or reorders one. A record that already has
 *     the intent is left byte-identical;
 *   * it works from the tags the B1/B2 pipeline already extracted — `crunch`, `jumping
 *     jacks`, `jog` — rather than from a list of ids written here. A new exercise clip
 *     harvested later picks up its intent by running this again, with no edit;
 *   * it invents nothing. There is no squat, push-up or plank asset in the repository, and
 *     this does not pretend otherwise — `coach.js` refuses to demonstrate an exercise it
 *     has no clip for rather than playing a jog and calling it a squat.
 *
 * Run it, then re-run the validator. Both are idempotent.
 *
 * Usage:
 *   node kb/scripts/tag-exercises.mjs           # report what would change
 *   node kb/scripts/tag-exercises.mjs --write   # apply
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MANIFEST = join(ROOT, 'kb/animations.manifest.jsonl');

/**
 * tag → intent. The left side is what the harvester already wrote; the right side is what
 * `coach.js` asks the selector for. Keeping the mapping here, in data, is what makes a
 * sixth exercise a row rather than a batch.
 */
export const EXERCISE_INTENTS = {
    crunch: 'crunch',
    'jumping jacks': 'jumping_jacks',
    jog: 'jog',
    jogging: 'jog',
    squat: 'squat',
    'push up': 'pushup',
    pushup: 'pushup',
    plank: 'plank',
    lunge: 'lunge',
};

/** A record only earns a specific intent if it is already an exercise. */
const GENERIC = 'exercise';

export function plan(records) {
    const changes = [];
    for (const record of records) {
        const tags = record.tags || [];
        const intents = record.intents || [];
        if (!tags.includes(GENERIC) && !intents.includes(GENERIC)) continue;

        const wanted = new Set();
        // The generic intent too: a clip tagged `exercise` that somehow lacks the intent is
        // invisible to a generic ask, which is the same bug one level up.
        wanted.add(GENERIC);
        for (const tag of tags) {
            const intent = EXERCISE_INTENTS[tag];
            if (intent) wanted.add(intent);
        }

        const missing = [...wanted].filter((intent) => !intents.includes(intent));
        // Ordering is a change too. `intents` is an AUTHORED_FIELD, so a re-harvest carries
        // it forward verbatim while `draft-descriptions.mjs` emits it sorted — a record left
        // unsorted here regenerates differently from itself, and CI's reproducibility gate
        // is what catches it. Reporting it means this script can heal a manifest it did not
        // break rather than only ever adding.
        const sorted = [...new Set([...intents, ...missing])].sort();
        const unsorted = intents.join() !== [...intents].sort().join();
        if (missing.length || unsorted) {
            changes.push({ id: record.id, add: missing, sort: unsorted, intents: sorted });
        }
    }
    return changes;
}

export function apply(records, changes) {
    const byId = new Map(changes.map((c) => [c.id, c.intents]));
    for (const record of records) {
        const intents = byId.get(record.id);
        if (!intents) continue;
        record.intents = intents;
    }
    return records;
}

function read() {
    return readFileSync(MANIFEST, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function main() {
    const write = process.argv.includes('--write');
    const records = read();
    const changes = plan(records);

    console.log('KB content pass — exercise intents (B27)\n');
    if (!changes.length) {
        console.log('  Nothing to add; every exercise clip already names what it is.');
        return;
    }
    for (const change of changes) {
        const what = [
            change.add.length ? `+ ${change.add.join(', ')}` : '',
            change.sort ? '(sorted)' : '',
        ]
            .filter(Boolean)
            .join(' ');
        console.log(`  ${change.id.padEnd(38)} ${what}`);
    }

    if (!write) {
        console.log(`\n${changes.length} records would change. Re-run with --write to apply.`);
        return;
    }

    apply(records, changes);
    writeFileSync(MANIFEST, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`\nWrote ${changes.length} records. Now re-run kb/scripts/validate-manifest.mjs.`);
}

if (process.argv[1] && process.argv[1].endsWith('tag-exercises.mjs')) main();
