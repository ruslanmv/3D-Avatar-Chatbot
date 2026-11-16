#!/usr/bin/env node
/**
 * Inspect a legitimately downloaded humanoid GLB before attempting VRM retargeting.
 *
 * Download separately from the publisher's site and keep the source archive out
 * of the git history until license provenance and bone compatibility are reviewed.
 *
 * Usage: node tools/qa/hands-knees-asset-probe.mjs ./downloads/UAL1_Standard.glb
 *        node tools/qa/hands-knees-asset-probe.mjs ./downloads/kinemiq-crawl.glb
 *
 * This only checks the file and its animation/bone metadata. It does NOT prove
 * that the motion was retargeted, loaded, played or physically contacted the floor.
 */
import fs from 'node:fs';
import path from 'node:path';

const filename = process.argv[2];
if (!filename) {
    process.stderr.write('Usage: node tools/qa/hands-knees-asset-probe.mjs <local-animation.glb>\n');
    process.exit(2);
}
const raw = fs.readFileSync(filename);
if (raw.length < 20 || raw.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('Not a binary glTF 2.0 (.glb) file');
}
const version = raw.readUInt32LE(4);
const declaredLength = raw.readUInt32LE(8);
if (version !== 2 || declaredLength !== raw.length) {
    throw new Error('Invalid glTF version or file length');
}
const jsonLength = raw.readUInt32LE(12);
const jsonType = raw.readUInt32LE(16);
if (jsonType !== 0x4e4f534a || 20 + jsonLength > raw.length) {
    throw new Error('Missing or truncated GLB JSON chunk');
}
const gltf = JSON.parse(
    raw
        .subarray(20, 20 + jsonLength)
        .toString('utf8')
        .trim()
);
const animations = (gltf.animations || []).map((anim, i) => ({
    index: i,
    name: anim.name || '',
    channels: anim.channels?.length || 0,
    samplers: anim.samplers?.length || 0,
}));
const nodes = (gltf.nodes || []).map((n) => n.name || '');
const crawlClips = animations.filter((a) => /crawl|all.fours|hands?.knees|on.fours/i.test(a.name));
const hasHumanoidBones = [/hip|pelvis|hips/i, /spine/i, /arm|shoulder/i, /leg|thigh/i].every((pattern) =>
    nodes.some((n) => pattern.test(n))
);
const result = {
    file: path.resolve(filename),
    bytes: raw.length,
    gltfVersion: version,
    generator: gltf.asset?.generator || null,
    copyright: gltf.asset?.copyright || null,
    extras: gltf.asset?.extras || null,
    animationCount: animations.length,
    crawlClips,
    allAnimationNames: animations.map((a) => a.name),
    humanoidBoneNamesPresent: hasHumanoidBones,
    nodeCount: nodes.length,
    verdict: crawlClips.length && hasHumanoidBones ? 'candidate-for-retargeting' : 'inspect-manually',
    note: 'Author license and attribution must be checked against the source page; this parser does not determine the license or validate pose contact.',
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!crawlClips.length || !hasHumanoidBones) process.exitCode = 1;
