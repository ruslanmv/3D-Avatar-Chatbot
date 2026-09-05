#!/usr/bin/env node
/**
 * extract-bvh-stats — duration, root motion and an energy proxy, straight out of the
 * BVH text (spec v1.1 §5.P0).
 *
 * BVH is plain text: a HIERARCHY block declaring joints and their channels, then a
 * MOTION block with `Frames:`, `Frame Time:` and one whitespace-separated row per frame.
 * Nothing here needs a 3D library.
 *
 * Two of the three numbers need a decision, so they are stated rather than assumed:
 *
 *   rootMotion   in **body heights**, not centimetres. This pack's root offsets sit
 *                around 10.7 units, which is neither metres nor centimetres; dividing
 *                the travelled distance by the root's rest height gives a number that
 *                means the same thing on any rig and survives retargeting, which is the
 *                only reason the ranker would ever read it.
 *   meanJointVel mean absolute angular velocity across every rotation channel, in rad/s.
 *                A proxy for energy, exactly as §5.P0 asks for — not a physical measure.
 *
 * Usage:
 *   node kb/scripts/extract-bvh-stats.mjs vendor/animations/emotion/joy.bvh [...]
 */

import { readFileSync } from 'node:fs';

const DEG2RAD = Math.PI / 180;

/** Bone-name fragments that mean the clip drives the lower body. */
const LOWER_BODY = ['hip', 'upleg', 'upperleg', 'leg', 'knee', 'foot', 'toe', 'ankle'];

/**
 * Parse the HIERARCHY block into an ordered channel list.
 * Returns `{ channels: [{ joint, channel }], rootHeight, joints }`.
 */
function parseHierarchy(text) {
    const channels = [];
    const joints = [];
    let rootHeight = 0;
    let current = null;
    let seenRootOffset = false;

    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        if (line === 'MOTION') break;

        const named = line.match(/^(ROOT|JOINT)\s+(\S+)/);
        if (named) {
            current = named[2];
            joints.push(current);
            continue;
        }
        if (line.startsWith('End Site')) {
            current = `${current}_end`;
            continue;
        }
        if (line.startsWith('OFFSET') && !seenRootOffset && joints.length === 1) {
            // The root's rest offset. Its Y is the rig's hip height in this file's units.
            rootHeight = Math.abs(Number(line.split(/\s+/)[2]) || 0);
            seenRootOffset = true;
            continue;
        }
        if (line.startsWith('CHANNELS')) {
            for (const channel of line.split(/\s+/).slice(2)) {
                channels.push({ joint: current, channel });
            }
        }
    }

    return { channels, rootHeight, joints };
}

/** Parse the MOTION block into `{ frameCount, frameTime, frames: number[][] }`. */
function parseMotion(text) {
    const start = text.indexOf('MOTION');
    if (start < 0) throw new Error('no MOTION block');

    const lines = text.slice(start).split('\n');
    let frameCount = 0;
    let frameTime = 0;
    const frames = [];

    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line === 'MOTION') continue;
        if (line.startsWith('Frames:')) {
            frameCount = Number(line.split(':')[1]);
            continue;
        }
        if (line.startsWith('Frame Time:')) {
            frameTime = Number(line.split(':')[1]);
            continue;
        }
        const row = line.split(/\s+/).map(Number);
        if (row.length && row.every((n) => Number.isFinite(n))) frames.push(row);
    }

    return { frameCount, frameTime, frames };
}

/**
 * Statistics for one BVH file.
 *
 * @param {string} text raw BVH
 * @returns {{duration:number, rootMotion:number, meanJointVel:number, layer:string,
 *            frameCount:number, frameTime:number, animatedJoints:number}}
 */
export function bvhStats(text) {
    const { channels, rootHeight, joints } = parseHierarchy(text);
    const { frameCount, frameTime, frames } = parseMotion(text);

    const declared = frameCount || frames.length;
    const duration = round(declared * frameTime, 3);

    // Column indices we care about: root translation, and every rotation channel.
    const rootJoint = joints[0];
    const rootX = channels.findIndex((c) => c.joint === rootJoint && c.channel === 'Xposition');
    const rootY = channels.findIndex((c) => c.joint === rootJoint && c.channel === 'Yposition');
    const rootZ = channels.findIndex((c) => c.joint === rootJoint && c.channel === 'Zposition');
    const rotationCols = channels.map((c, i) => (c.channel.endsWith('rotation') ? i : -1)).filter((i) => i >= 0);

    // Root motion: furthest horizontal distance from the starting position, expressed in
    // body heights so the number is avatar-independent.
    let rootMotion = 0;
    if (frames.length && rootX >= 0 && rootZ >= 0) {
        const [x0, z0] = [frames[0][rootX], frames[0][rootZ]];
        let far = 0;
        for (const frame of frames) {
            const dx = frame[rootX] - x0;
            const dz = frame[rootZ] - z0;
            far = Math.max(far, Math.hypot(dx, dz));
        }
        const scale = rootHeight || (rootY >= 0 ? Math.abs(frames[0][rootY]) : 0) || 1;
        rootMotion = round(far / scale, 3);
    }

    // Energy proxy: mean absolute angular velocity over every rotation channel.
    let meanJointVel = 0;
    if (frames.length > 1 && rotationCols.length && frameTime > 0) {
        let total = 0;
        let samples = 0;
        for (let f = 1; f < frames.length; f++) {
            for (const col of rotationCols) {
                const delta = angleDelta(frames[f][col], frames[f - 1][col]);
                total += Math.abs(delta * DEG2RAD) / frameTime;
                samples++;
            }
        }
        meanJointVel = samples ? round(total / samples, 3) : 0;
    }

    // Layer: does the clip drive the lower body? Channels that never move do not count —
    // several clips declare leg channels and hold them still for the whole take.
    const movingJoints = new Set();
    if (frames.length > 1) {
        for (let i = 0; i < channels.length; i++) {
            for (let f = 1; f < frames.length; f++) {
                if (Math.abs(frames[f][i] - frames[f - 1][i]) > 1e-4) {
                    movingJoints.add(channels[i].joint.toLowerCase());
                    break;
                }
            }
        }
    }
    const drivesLegs = [...movingJoints].some((j) => LOWER_BODY.some((frag) => j.includes(frag)));

    return {
        duration,
        rootMotion,
        meanJointVel,
        layer: drivesLegs ? 'fullBody' : 'upperBody',
        frameCount: declared,
        frameTime,
        animatedJoints: movingJoints.size,
    };
}

/** Shortest signed difference between two Euler angles in degrees. */
function angleDelta(a, b) {
    let d = (a - b) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
}

function round(n, places) {
    const f = 10 ** places;
    return Math.round(n * f) / f;
}

/** Read and analyse one file. */
export function bvhStatsFromFile(path) {
    return bvhStats(readFileSync(path, 'utf8'));
}

if (process.argv[1] && process.argv[1].endsWith('extract-bvh-stats.mjs')) {
    const files = process.argv.slice(2);
    if (!files.length) {
        console.error('usage: node kb/scripts/extract-bvh-stats.mjs <file.bvh> [...]');
        process.exit(2);
    }
    for (const file of files) {
        console.log(file, JSON.stringify(bvhStatsFromFile(file)));
    }
}
