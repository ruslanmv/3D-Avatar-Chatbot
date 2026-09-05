#!/usr/bin/env node
/**
 * make-pose-fixture — the recorded set B27's acceptance criterion counts against.
 *
 * ## What this fixture is, and what it is not
 *
 * It is **not a recording of a person**. There is no video in this repository and there is
 * no honest way to put one there — a real capture of somebody exercising is personal data,
 * and a stock clip would need a licence this project does not hold. So the fixture is
 * *synthesised*, and the file says so in its own `provenance` field rather than leaving a
 * reader to assume otherwise.
 *
 * What makes it a real test anyway is that it is not a clean sine wave. It is built from the
 * four shapes that actually break rep counters, each one deliberately placed and each one
 * accounted for in the ground truth:
 *
 *   1. **reps that slow down** — the last third of a set is 40% slower than the first;
 *   2. **a pause** — eight seconds of standing still in the middle, which a midpoint-crossing
 *      counter turns into dozens of reps;
 *   3. **a partial rep** — a descent to 118° that never reaches depth. It must NOT count,
 *      and it is the single most valuable frame range in the file;
 *   4. **tracking noise** — ±1.5° of jitter, which is what a lite pose model gives you at
 *      15 fps, applied with a fixed seed so the fixture is reproducible.
 *
 * Ground truth is therefore known by construction rather than by somebody watching a video
 * and counting, which is the one thing a synthetic fixture is genuinely better at.
 *
 * Usage:
 *   node scripts/make-pose-fixture.mjs           # report
 *   node scripts/make-pose-fixture.mjs --write   # write tests/fixtures/pose/squat-set.json
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'tests/fixtures/pose/squat-set.json');

/** The rate `coach.js` throttles Pose to on a desktop. */
const FPS = 20;

/** Standing, and the bottom of a good squat, in degrees of knee angle. */
const STANDING = 172;
const DEPTH = 88;

/** A rep that stops here has not reached depth. Above `RepCounter`'s `low` of 100. */
const PARTIAL = 118;

/** Deterministic jitter: a fixture that changes between runs is not a fixture. */
function mulberry32(seed) {
    return function random() {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const random = mulberry32(20260901);
const noise = (amplitude = 1.5) => (random() * 2 - 1) * amplitude;

/** One rep: down and back up, as a half-cosine so the turnaround is smooth like a body. */
function rep(samples, { bottom = DEPTH, durationMs }) {
    const frames = Math.round((durationMs / 1000) * FPS);
    for (let i = 0; i < frames; i++) {
        const phase = (i / frames) * Math.PI * 2;
        const depth = (STANDING - bottom) / 2;
        samples.push(STANDING - depth * (1 - Math.cos(phase)) + noise());
    }
}

function still(samples, seconds) {
    for (let i = 0; i < Math.round(seconds * FPS); i++) samples.push(STANDING + noise());
}

export function build() {
    const samples = [];
    let truth = 0;

    // Settle: two seconds of standing before anything happens.
    still(samples, 2);

    // Eight brisk reps.
    for (let i = 0; i < 8; i++) {
        rep(samples, { durationMs: 2000 });
        truth++;
    }

    // A partial. Deliberately the most interesting eighty frames in the file: it must not
    // count, and a counter with one threshold instead of two will count it.
    rep(samples, { bottom: PARTIAL, durationMs: 1800 });

    // The pause. A midpoint-crossing counter turns this into dozens of reps.
    still(samples, 8);

    // Four more, tiring: 40% slower than the opening reps.
    for (let i = 0; i < 4; i++) {
        rep(samples, { durationMs: 2800 });
        truth++;
    }

    still(samples, 2);

    return {
        provenance:
            'SYNTHESISED, not recorded. Built by scripts/make-pose-fixture.mjs from a ' +
            'parametric squat model with seeded noise. There is no video in this repository: ' +
            'a real capture is personal data and a stock clip needs a licence this project ' +
            'does not hold. See that script for the four shapes this encodes and why they ' +
            'are the ones that break rep counters.',
        exercise: 'squat',
        signal: 'kneeAngle',
        unit: 'degrees',
        fps: FPS,
        seed: 20260901,
        groundTruth: truth,
        contains: [
            '8 brisk reps at 2.0 s',
            '1 partial rep to 118 degrees that must not count',
            '8 s standing pause',
            '4 tiring reps at 2.8 s',
            '+/- 1.5 degrees of seeded tracking noise throughout',
        ],
        samples: samples.map((value) => Math.round(value * 100) / 100),
    };
}

function main() {
    const fixture = build();
    const seconds = (fixture.samples.length / FPS).toFixed(1);
    console.log('Pose fixture — a squat set (B27)\n');
    console.log(`  frames      : ${fixture.samples.length} (${seconds} s at ${FPS} fps)`);
    console.log(`  ground truth: ${fixture.groundTruth} reps`);
    console.log(
        `  range       : ${Math.min(...fixture.samples).toFixed(1)}–${Math.max(...fixture.samples).toFixed(1)}°`
    );
    for (const line of fixture.contains) console.log(`  · ${line}`);

    if (!process.argv.includes('--write')) {
        console.log('\ndry run — pass --write to update the fixture');
        return;
    }
    writeFileSync(OUT, JSON.stringify(fixture, null, 2) + '\n');
    console.log(`\nwrote ${OUT.replace(ROOT, '')}`);
}

if (process.argv[1] && process.argv[1].endsWith('make-pose-fixture.mjs')) main();
