#!/usr/bin/env node
/**
 * extract-vrma-stats — duration and layer for a `.vrma` clip.
 *
 * The spec names only a BVH stats script (§4A), because BVH is the format you can read
 * with your eyes. VRMA needs its own reader for the same three questions, and the KB is
 * only as good as its weakest record, so here it is.
 *
 * Two container shapes ship in this repo and both have to work: 23 clips are binary GLB
 * and 21 are glTF JSON (the Mixamo-origin sets — see addons/vrma-dance/README.md). The
 * difference is where the buffer lives, nothing else.
 *
 * Duration comes from the animation sampler *input* accessors — the keyframe times. When
 * an accessor declares `max` we trust it; when it does not, the times are read out of the
 * buffer, which is exact and costs a few kilobytes.
 *
 * Layer comes from which humanoid bones the channels drive. `VRMC_vrm_animation` maps
 * node indices to humanoid bone names, so on a well-formed VRMA this is precise rather
 * than a guess at node names.
 *
 * Usage:
 *   node kb/scripts/extract-vrma-stats.mjs addons/vrma-dance/dance_1.vrma [...]
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Humanoid bone names that mean the clip drives the lower body. */
const LOWER_BODY = /^(hips|(left|right)(UpperLeg|LowerLeg|Foot|Toes))$/;

/** Fallback for clips with no humanoid map: node-name fragments that mean the same. */
const LOWER_BODY_FRAGMENTS = ['hips', 'upleg', 'upperleg', 'leg', 'foot', 'toe'];

const COMPONENT_TYPES = {
    5120: { array: Int8Array, size: 1 },
    5121: { array: Uint8Array, size: 1 },
    5122: { array: Int16Array, size: 2 },
    5123: { array: Uint16Array, size: 2 },
    5125: { array: Uint32Array, size: 4 },
    5126: { array: Float32Array, size: 4 },
};

/** Split a GLB into its JSON chunk and its BIN chunk. */
function parseGlb(buffer) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const length = view.getUint32(8, true);
    let offset = 12;
    let json = null;
    let bin = null;

    while (offset < length) {
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        const body = buffer.subarray(offset + 8, offset + 8 + chunkLength);
        if (chunkType === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
        if (chunkType === 0x004e4942) bin = body;
        offset += 8 + chunkLength + ((4 - (chunkLength % 4)) % 4);
    }

    if (!json) throw new Error('GLB has no JSON chunk');
    return { json, bin };
}

/** Resolve a glTF buffer to bytes: the GLB chunk, a data: URI, or a sidecar file. */
function resolveBuffer(gltf, index, binChunk, baseDir) {
    const buffer = gltf.buffers?.[index];
    if (!buffer) return null;
    if (!buffer.uri) return binChunk;
    if (buffer.uri.startsWith('data:')) {
        return Buffer.from(buffer.uri.slice(buffer.uri.indexOf(',') + 1), 'base64');
    }
    try {
        return readFileSync(resolve(baseDir, decodeURIComponent(buffer.uri)));
    } catch {
        return null; // a sidecar we do not ship; duration falls back to accessor.max
    }
}

/** Element counts for the accessor types this reader supports. */
const TYPE_COMPONENTS = { SCALAR: 1, VEC3: 3, VEC4: 4 };

/**
 * Read a float accessor as an array of `count` tuples. Returns null when the bytes are
 * not reachable — a clip with a sidecar buffer we do not ship still yields a duration
 * from `accessor.max`, it just contributes no motion statistics.
 */
function readAccessor(gltf, accessorIndex, binChunk, baseDir) {
    const accessor = gltf.accessors?.[accessorIndex];
    const components = TYPE_COMPONENTS[accessor?.type];
    if (!accessor || !components) return null;

    const view = gltf.bufferViews?.[accessor.bufferView];
    const spec = COMPONENT_TYPES[accessor.componentType];
    if (!view || !spec || spec.array !== Float32Array) return null;

    const bytes = resolveBuffer(gltf, view.buffer, binChunk, baseDir);
    if (!bytes) return null;

    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const stride = view.byteStride || components * spec.size;
    const out = [];
    for (let i = 0; i < accessor.count; i++) {
        const tuple = new Array(components);
        for (let c = 0; c < components; c++) {
            tuple[c] = data.getFloat32(start + i * stride + c * spec.size, true);
        }
        out.push(tuple);
    }
    return out;
}

function round(n, places) {
    const f = 10 ** places;
    return Math.round(n * f) / f;
}

/** Angle in radians between two unit quaternions, sign-insensitive. */
function quatAngle(a, b) {
    const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    return 2 * Math.acos(Math.min(1, dot));
}

/**
 * Statistics for one VRMA file.
 *
 * @returns {{duration:number|null, rootMotion:number, meanJointVel:number|null,
 *            layer:string, animations:number, channels:number, humanoidBones:string[],
 *            container:'glb'|'gltf'}}
 */
export function vrmaStats(path) {
    const raw = readFileSync(path);
    const isGlb = raw.subarray(0, 4).toString('ascii') === 'glTF';
    const { json: gltf, bin } = isGlb ? parseGlb(raw) : { json: JSON.parse(raw.toString('utf8')), bin: null };
    const baseDir = dirname(path);

    // Duration: the largest keyframe time across every sampler.
    let duration = null;
    for (const animation of gltf.animations || []) {
        for (const sampler of animation.samplers || []) {
            const accessor = gltf.accessors?.[sampler.input];
            if (!accessor) continue;
            let last = Array.isArray(accessor.max) ? accessor.max[0] : null;
            if (last === null) {
                const times = readAccessor(gltf, sampler.input, bin, baseDir);
                if (times && times.length) last = times[times.length - 1][0];
            }
            if (typeof last === 'number' && Number.isFinite(last)) {
                duration = Math.max(duration ?? 0, last);
            }
        }
    }

    // Which humanoid bones does it drive? Prefer the VRM humanoid map over node names.
    const humanBones = gltf.extensions?.VRMC_vrm_animation?.humanoid?.humanBones || {};
    const nodeToBone = new Map();
    for (const [bone, entry] of Object.entries(humanBones)) {
        if (entry && typeof entry.node === 'number') nodeToBone.set(entry.node, bone);
    }

    // Motion statistics, so a VRMA record is comparable with a BVH one: mean angular
    // speed over every rotation channel (rad/s, the energy proxy), and how far the hips
    // travel horizontally. VRM humanoid space is metres, and a nominal 1.6 m body height
    // converts that to the same body-heights unit the BVH reader reports.
    const NOMINAL_BODY_HEIGHT_M = 1.6;
    const driven = new Set();
    let channels = 0;
    let angularTotal = 0;
    let angularSamples = 0;
    let rootMotion = 0;

    for (const animation of gltf.animations || []) {
        for (const channel of animation.channels || []) {
            channels++;
            const node = channel.target?.node;
            if (typeof node !== 'number') continue;
            const bone = nodeToBone.get(node) || gltf.nodes?.[node]?.name || '';
            if (bone) driven.add(bone);

            const sampler = animation.samplers?.[channel.sampler];
            if (!sampler) continue;
            const path = channel.target?.path;
            if (path !== 'rotation' && !(path === 'translation' && bone === 'hips')) continue;

            const times = readAccessor(gltf, sampler.input, bin, baseDir);
            const values = readAccessor(gltf, sampler.output, bin, baseDir);
            if (!times || !values || times.length < 2 || values.length < times.length) continue;

            if (path === 'rotation') {
                for (let i = 1; i < times.length; i++) {
                    const dt = times[i][0] - times[i - 1][0];
                    if (dt <= 0) continue;
                    angularTotal += quatAngle(values[i], values[i - 1]) / dt;
                    angularSamples++;
                }
            } else {
                const [x0, , z0] = values[0];
                for (const v of values) {
                    rootMotion = Math.max(rootMotion, Math.hypot(v[0] - x0, v[2] - z0));
                }
                rootMotion /= NOMINAL_BODY_HEIGHT_M;
            }
        }
    }

    const meanJointVel = angularSamples ? round(angularTotal / angularSamples, 3) : null;

    const drivesLegs = [...driven].some(
        (bone) => LOWER_BODY.test(bone) || LOWER_BODY_FRAGMENTS.some((frag) => bone.toLowerCase().includes(frag))
    );

    return {
        duration: duration === null ? null : round(duration, 3),
        rootMotion: round(rootMotion, 3),
        meanJointVel,
        layer: drivesLegs ? 'fullBody' : 'upperBody',
        animations: (gltf.animations || []).length,
        channels,
        humanoidBones: [...nodeToBone.values()].sort(),
        container: isGlb ? 'glb' : 'gltf',
    };
}

if (process.argv[1] && process.argv[1].endsWith('extract-vrma-stats.mjs')) {
    const files = process.argv.slice(2);
    if (!files.length) {
        console.error('usage: node kb/scripts/extract-vrma-stats.mjs <file.vrma> [...]');
        process.exit(2);
    }
    for (const file of files) {
        const { humanoidBones, ...rest } = vrmaStats(file);
        console.log(file, JSON.stringify({ ...rest, humanoidBones: humanoidBones.length }));
    }
}
