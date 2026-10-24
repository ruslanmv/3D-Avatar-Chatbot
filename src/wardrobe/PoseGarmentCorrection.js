/**
 * PS4. A posed correction for the lap, applied once per pose from the skinned
 * positions — never from the previous correction, so it cannot accumulate.
 *
 * Linear blend skinning at a wide sit pulls the two sides of one lap sheet
 * toward opposite thighs. Smoothing the weights (PF2) shortens the worst
 * edges and does not bring the vertices back out of the body: the pose
 * contact record still has a bodycon 23 mm inside and edges past 2×.
 * This pass pushes those vertices out along the posed skin normal and
 * shortens edges that stretched past the cloth limit, then pushes again.
 * The body mesh is not moved. Her surface stays the one the file was fitted
 * on, including the pelvic outlet.
 */
(function (global) {
    'use strict';

    var CLEARANCE_M = 0.0015;
    var SEARCH_M = 0.08;
    var STRETCH_LIMIT = 1.45;
    var RELAX = 0.35;
    var ITERATIONS = 8;
    var CELL_M = 0.02;

    function cellKey(x, y, z) {
        return Math.floor(x / CELL_M) + ',' + Math.floor(y / CELL_M) + ',' + Math.floor(z / CELL_M);
    }

    function buildHash(bodyPos) {
        var map = new Map();
        var n = bodyPos.length / 3;
        for (var i = 0; i < n; i += 1) {
            var key = cellKey(bodyPos[i * 3], bodyPos[i * 3 + 1], bodyPos[i * 3 + 2]);
            var bucket = map.get(key);
            if (!bucket) {
                bucket = [];
                map.set(key, bucket);
            }
            bucket.push(i);
        }
        return map;
    }

    function nearest(hash, bodyPos, x, y, z) {
        var cx = Math.floor(x / CELL_M);
        var cy = Math.floor(y / CELL_M);
        var cz = Math.floor(z / CELL_M);
        var best = -1;
        var bestD = SEARCH_M * SEARCH_M;
        for (var ix = cx - 4; ix <= cx + 4; ix += 1) {
            for (var iy = cy - 4; iy <= cy + 4; iy += 1) {
                for (var iz = cz - 4; iz <= cz + 4; iz += 1) {
                    var bucket = hash.get(ix + ',' + iy + ',' + iz);
                    if (!bucket) continue;
                    for (var k = 0; k < bucket.length; k += 1) {
                        var i = bucket[k];
                        var dx = x - bodyPos[i * 3];
                        var dy = y - bodyPos[i * 3 + 1];
                        var dz = z - bodyPos[i * 3 + 2];
                        var d = dx * dx + dy * dy + dz * dz;
                        if (d < bestD) {
                            bestD = d;
                            best = i;
                        }
                    }
                }
            }
        }
        return best;
    }

    /**
     * @param {object} input
     * @param {Float32Array|number[]} input.posed garment positions, same space as the body
     * @param {Float32Array|number[]} input.rest bind positions, same space, for edge lengths
     * @param {Uint32Array|number[]} input.indices triangle indices
     * @param {Uint8Array|number[]} input.lap 1 for a vertex the pass may move
     * @param {Float32Array|number[]} input.bodyPos posed skin positions
     * @param {Float32Array|number[]} input.bodyNrm posed skin normals, outward
     * @returns {Float32Array}
     */
    function relaxEdges(out, edges, lap, gain) {
        for (var n = 0; n < edges.length; n += 1) {
            var edge = edges[n];
            var ia = edge[0];
            var ib = edge[1];
            if (!lap[ia] && !lap[ib]) continue;
            var ex = out[ib * 3] - out[ia * 3];
            var ey = out[ib * 3 + 1] - out[ia * 3 + 1];
            var ez = out[ib * 3 + 2] - out[ia * 3 + 2];
            var len = Math.hypot(ex, ey, ez);
            var limit = edge[2] * STRETCH_LIMIT;
            if (len <= limit || len < 1e-8) continue;
            // A vertex outside the lap stays put, so the hem is pulled back
            // up to the skirt instead of dragging the waist down with it.
            var excess = (len - limit) * (gain || RELAX);
            var shareA = lap[ia] ? (lap[ib] ? 0.5 : 1) : 0;
            var shareB = lap[ib] ? (lap[ia] ? 0.5 : 1) : 0;
            var inv = 1 / len;
            var dx = ex * inv * excess;
            var dy = ey * inv * excess;
            var dz = ez * inv * excess;
            out[ia * 3] += dx * shareA;
            out[ia * 3 + 1] += dy * shareA;
            out[ia * 3 + 2] += dz * shareA;
            out[ib * 3] -= dx * shareB;
            out[ib * 3 + 1] -= dy * shareB;
            out[ib * 3 + 2] -= dz * shareB;
        }
    }

    function correct(input) {
        var posed = input.posed;
        var rest = input.rest;
        var indices = input.indices;
        var lap = input.lap;
        var bodyPos = input.bodyPos;
        var bodyNrm = input.bodyNrm;
        var count = posed.length / 3;
        var out = new Float32Array(posed.length);
        out.set(posed);
        var hash = bodyPos && bodyPos.length ? buildHash(bodyPos) : null;
        var centerX = 0;
        var lapCount = 0;
        for (var c = 0; c < count; c += 1) {
            if (!lap[c]) continue;
            centerX += rest[c * 3];
            lapCount += 1;
        }
        centerX = lapCount ? centerX / lapCount : 0;
        var edges = [];
        var seen = new Set();
        for (var t = 0; t < indices.length; t += 3) {
            var tri = [indices[t], indices[t + 1], indices[t + 2]];
            for (var e = 0; e < 3; e += 1) {
                var a = tri[e];
                var b = tri[(e + 1) % 3];
                if (!lap[a] && !lap[b]) continue;
                if (a > b) {
                    var swap = a;
                    a = b;
                    b = swap;
                }
                var key = a + ':' + b;
                if (seen.has(key)) continue;
                seen.add(key);
                var rx = rest[a * 3] - rest[b * 3];
                var ry = rest[a * 3 + 1] - rest[b * 3 + 1];
                var rz = rest[a * 3 + 2] - rest[b * 3 + 2];
                var restLen = Math.hypot(rx, ry, rz);
                if (restLen > 1e-6) edges.push([a, b, restLen]);
            }
        }
        for (var iter = 0; iter < ITERATIONS; iter += 1) {
            if (hash) {
                for (var v = 0; v < count; v += 1) {
                    if (!lap[v]) continue;
                    var x = out[v * 3];
                    var y = out[v * 3 + 1];
                    var z = out[v * 3 + 2];
                    var i = nearest(hash, bodyPos, x, y, z);
                    if (i < 0) continue;
                    var nx = bodyNrm[i * 3];
                    var ny = bodyNrm[i * 3 + 1];
                    var nz = bodyNrm[i * 3 + 2];
                    var signed =
                        (x - bodyPos[i * 3]) * nx + (y - bodyPos[i * 3 + 1]) * ny + (z - bodyPos[i * 3 + 2]) * nz;
                    if (signed < CLEARANCE_M) {
                        // An inner-thigh normal points away from the midline and
                        // pins the hem open. Keep the push that lifts cloth off
                        // the pelvis; do not use it to spread the lap.
                        var away = (x - centerX) * nx;
                        if (away > 0 && Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz)) continue;
                        var push = CLEARANCE_M - signed;
                        out[v * 3] += nx * push;
                        out[v * 3 + 1] += ny * push;
                        out[v * 3 + 2] += nz * push;
                    }
                }
            }
            relaxEdges(out, edges, lap);
        }
        // The cloth limit is the last word, so a push cannot leave the hem open.
        for (var closing = 0; closing < 32; closing += 1) relaxEdges(out, edges, lap, 1);
        return out;
    }

    function maxEdgeStretch(positions, rest, indices) {
        var worst = 1;
        for (var t = 0; t < indices.length; t += 3) {
            for (var e = 0; e < 3; e += 1) {
                var a = indices[t + e];
                var b = indices[t + ((e + 1) % 3)];
                var restLen = Math.hypot(
                    rest[a * 3] - rest[b * 3],
                    rest[a * 3 + 1] - rest[b * 3 + 1],
                    rest[a * 3 + 2] - rest[b * 3 + 2]
                );
                if (restLen < 1e-6) continue;
                var len = Math.hypot(
                    positions[a * 3] - positions[b * 3],
                    positions[a * 3 + 1] - positions[b * 3 + 1],
                    positions[a * 3 + 2] - positions[b * 3 + 2]
                );
                worst = Math.max(worst, len / restLen);
            }
        }
        return worst;
    }

    // "Body" and three-vrm's "Body_(merged)baked" are the skin. "Bodycon" is a dress.
    function isBodyName(name) {
        if (!name || /bodycon/i.test(name)) return false;
        return /(^|[^a-z0-9])body([^a-z0-9]|$)/i.test(name);
    }

    var api = {
        CLEARANCE_M: CLEARANCE_M,
        STRETCH_LIMIT: STRETCH_LIMIT,
        correct: correct,
        maxEdgeStretch: maxEdgeStretch,
        isBodyName: isBodyName,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_POSE_GARMENT_CORRECTION = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
