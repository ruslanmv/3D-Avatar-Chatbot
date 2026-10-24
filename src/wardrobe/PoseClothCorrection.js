/**
 * SW1. Cloth that stays outside her when she sits: a posed collision correction.
 *
 * A garment is skinned like her: each vertex follows a blend of her bones. That is right for
 * cloth lying on her skin and wrong for cloth bridging a gap — the lap of a bodycon mini
 * spanning the space between her thighs, the back hem spanning the gap under her seat. Such a
 * vertex has to follow one bone or another, and when she sits wide her thighs rise through the
 * lap and her seat swings into the hem. Measured on the real look (Forge's pose contact tools,
 * HomePilot's own Sitting (Wide) rotations): the dress 23 mm inside her with edges stretched
 * 2.3×, the briefs under it 14 mm inside. No weighting fixes it — smoothing the weights changed
 * the depth by under a millimetre, hanging the dress from the pelvis made it 34 mm — because a
 * weight cannot make a vertex follow two surfaces at once. Cloth does it by being pushed.
 *
 * So once a pose has settled this pushes it: every garment vertex inside the surface under it
 * is moved out along that surface's normal to a small clearance, stretched edges are pulled
 * back toward their rest length (so a pushed vertex takes its neighbours with it, as fabric
 * does, instead of tenting), and the push is repeated until both hold. Inner layers are done
 * first and become part of the surface the next layer clears — the dress clears the briefs
 * as well as her — so a white brief does not show through a black dress.
 *
 * Pure: positions in, positions out, in one space. It never moves her body, never accumulates
 * (it starts from the skinned positions each time), and a vertex outside the surface and with
 * no stretched edge is left exactly where skinning put it.
 *
 * Exposes: window.NEXUS_POSE_CLOTH_CORRECTION
 */
(function (global) {
    'use strict';

    var DEFAULTS = {
        clearance: 0.0015, // metres outside the surface beneath
        cell: 0.025, // spatial hash cell
        reach: 2, // cells searched each way: 5 cm, deeper than any penetration measured (34 mm)
        stretchLimit: 1.3, // an edge longer than this × rest is pulled back
        stiffness: 0.5,
        iterations: 16,
        layerReach: 0.015, // a layer below counts only this close: farther, it is not beneath this cloth
        penetrating: 0.001, // what counts as inside, for the report (pose_contact's 1 mm)
        stretched: 1.5, // what counts as stretched, for the report (pose_contact's 1.5×)
    };

    function options(input) {
        var out = {};
        for (var key in DEFAULTS) out[key] = input && input[key] !== undefined ? input[key] : DEFAULTS[key];
        return out;
    }

    /** A spatial hash over a surface's points, for the nearest point and its normal. */
    function Surface(pos, nrm, cell) {
        this.pos = pos;
        this.nrm = nrm;
        this.cell = cell;
        this.map = new Map();
        for (var i = 0; i < pos.length / 3; i += 1) {
            var key = this.key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
            var bucket = this.map.get(key);
            if (!bucket) this.map.set(key, (bucket = []));
            bucket.push(i);
        }
    }

    Surface.prototype.key = function (x, y, z) {
        return Math.floor(x / this.cell) + ',' + Math.floor(y / this.cell) + ',' + Math.floor(z / this.cell);
    };

    /** Index of the nearest surface point within `reach` cells, or -1. */
    Surface.prototype.nearest = function (x, y, z, reach) {
        var cx = Math.floor(x / this.cell);
        var cy = Math.floor(y / this.cell);
        var cz = Math.floor(z / this.cell);
        var best = -1;
        var bestD = Infinity;
        for (var ix = cx - reach; ix <= cx + reach; ix += 1) {
            for (var iy = cy - reach; iy <= cy + reach; iy += 1) {
                for (var iz = cz - reach; iz <= cz + reach; iz += 1) {
                    var bucket = this.map.get(ix + ',' + iy + ',' + iz);
                    if (!bucket) continue;
                    for (var k = 0; k < bucket.length; k += 1) {
                        var i = bucket[k];
                        var dx = x - this.pos[i * 3];
                        var dy = y - this.pos[i * 3 + 1];
                        var dz = z - this.pos[i * 3 + 2];
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
    };

    /** Signed distance of (x,y,z) from the surface at point i, along its normal. */
    Surface.prototype.signed = function (i, x, y, z) {
        return (
            (x - this.pos[i * 3]) * this.nrm[i * 3] +
            (y - this.pos[i * 3 + 1]) * this.nrm[i * 3 + 1] +
            (z - this.pos[i * 3 + 2]) * this.nrm[i * 3 + 2]
        );
    };

    /** Unique edges [a, b, restLength] of a triangle list. */
    function edgesOf(indices, rest) {
        var seen = new Set();
        var edges = [];
        for (var t = 0; t + 2 < indices.length; t += 3) {
            for (var e = 0; e < 3; e += 1) {
                var a = indices[t + e];
                var b = indices[t + ((e + 1) % 3)];
                if (a === b) continue;
                var lo = a < b ? a : b;
                var hi = a < b ? b : a;
                var key = lo * 4194304 + hi;
                if (seen.has(key)) continue;
                seen.add(key);
                var len = Math.hypot(
                    rest[a * 3] - rest[b * 3],
                    rest[a * 3 + 1] - rest[b * 3 + 1],
                    rest[a * 3 + 2] - rest[b * 3 + 2]
                );
                if (len > 1e-6) edges.push([lo, hi, len]);
            }
        }
        return edges;
    }

    /**
     * Vertex normals of a posed triangle list, turned to face away from `surface` where the
     * winding disagrees: a garment is a single shell, and its outside is the side away from her.
     */
    function normalsOf(pos, indices, surface, reach) {
        var count = pos.length / 3;
        var nrm = new Float32Array(pos.length);
        for (var t = 0; t + 2 < indices.length; t += 3) {
            var a = indices[t] * 3;
            var b = indices[t + 1] * 3;
            var c = indices[t + 2] * 3;
            var ux = pos[b] - pos[a];
            var uy = pos[b + 1] - pos[a + 1];
            var uz = pos[b + 2] - pos[a + 2];
            var vx = pos[c] - pos[a];
            var vy = pos[c + 1] - pos[a + 1];
            var vz = pos[c + 2] - pos[a + 2];
            var nx = uy * vz - uz * vy;
            var ny = uz * vx - ux * vz;
            var nz = ux * vy - uy * vx;
            for (var k = 0; k < 3; k += 1) {
                var v = indices[t + k] * 3;
                nrm[v] += nx;
                nrm[v + 1] += ny;
                nrm[v + 2] += nz;
            }
        }
        var agree = 0;
        for (var i = 0; i < count; i += 1) {
            var len = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
            nrm[i * 3] /= len;
            nrm[i * 3 + 1] /= len;
            nrm[i * 3 + 2] /= len;
            if (surface) {
                var s = surface.nearest(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], reach);
                if (s >= 0) {
                    var away =
                        (pos[i * 3] - surface.pos[s * 3]) * nrm[i * 3] +
                        (pos[i * 3 + 1] - surface.pos[s * 3 + 1]) * nrm[i * 3 + 1] +
                        (pos[i * 3 + 2] - surface.pos[s * 3 + 2]) * nrm[i * 3 + 2];
                    agree += away >= 0 ? 1 : -1;
                }
            }
        }
        if (agree < 0) for (var j = 0; j < nrm.length; j += 1) nrm[j] = -nrm[j];
        return nrm;
    }

    /** pose_contact's numbers for one garment against her skin; fixed vertices are not counted. */
    function measure(pos, rest, edges, surface, o, movable) {
        var count = pos.length / 3;
        var deepest = 0;
        var inside = 0;
        for (var v = 0; v < count; v += 1) {
            if (movable && !movable[v]) continue;
            var i = surface.nearest(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], o.reach);
            if (i < 0) continue;
            var s = surface.signed(i, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
            if (-s > deepest) deepest = -s;
            if (s < -o.penetrating) inside += 1;
        }
        var worst = 1;
        var stretched = 0;
        for (var e = 0; e < edges.length; e += 1) {
            var a = edges[e][0] * 3;
            var b = edges[e][1] * 3;
            var r = Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]) / edges[e][2];
            if (r > worst) worst = r;
            if (r > o.stretched) stretched += 1;
        }
        return {
            maxPenetrationMm: Math.round(deepest * 10000) / 10,
            penetratingPct: Math.round((inside / Math.max(count, 1)) * 10000) / 100,
            maxEdgeStretch: Math.round(worst * 100) / 100,
            stretchedPct: Math.round((stretched / Math.max(edges.length, 1)) * 10000) / 100,
        };
    }

    /**
     * Correct one garment against her skin and the layers already corrected under it. Each is
     * tested on its own: one surface built from all of them answered with the nearest point of
     * any, so a dress vertex nearest a brief read as outside while it was inside her. A layer
     * counts only within `layerReach`; farther away it is not beneath this cloth.
     * `movable` (optional, 1 per vertex) says which vertices may move: a boot's foot is meant to
     * hold her foot inside it, and pushing it out of her toes only crumpled the boot.
     * `posed` is not modified.
     * @returns {Float32Array} corrected positions
     */
    function correctOne(posed, edges, body, layers, o, movable) {
        var out = new Float32Array(posed.length);
        out.set(posed);
        var count = posed.length / 3;
        var reach2 = o.layerReach * o.layerReach;
        var layerCells = Math.max(1, Math.ceil(o.layerReach / o.cell));
        // The nearest skin point is searched again only once a vertex has moved this far since
        // it was last searched: most never move, and the search is what costs.
        var again2 = 0.0015 * 0.0015;
        var asked = new Float32Array(posed.length).fill(NaN);
        var nearBody = new Int32Array(count).fill(-1);
        function pushOut(surface, v, i) {
            var s = surface.signed(i, out[v * 3], out[v * 3 + 1], out[v * 3 + 2]);
            if (s >= o.clearance) return;
            var push = o.clearance - s;
            out[v * 3] += surface.nrm[i * 3] * push;
            out[v * 3 + 1] += surface.nrm[i * 3 + 1] * push;
            out[v * 3 + 2] += surface.nrm[i * 3 + 2] * push;
        }
        function project(fresh) {
            for (var v = 0; v < count; v += 1) {
                if (movable && !movable[v]) continue;
                if (fresh) asked[v * 3] = NaN;
                var mx = out[v * 3] - asked[v * 3];
                var my = out[v * 3 + 1] - asked[v * 3 + 1];
                var mz = out[v * 3 + 2] - asked[v * 3 + 2];
                if (!(mx * mx + my * my + mz * mz <= again2)) {
                    nearBody[v] = body.nearest(out[v * 3], out[v * 3 + 1], out[v * 3 + 2], o.reach);
                    asked[v * 3] = out[v * 3];
                    asked[v * 3 + 1] = out[v * 3 + 1];
                    asked[v * 3 + 2] = out[v * 3 + 2];
                }
                var i = nearBody[v];
                if (i >= 0) pushOut(body, v, i);
                for (var l = 0; l < layers.length; l += 1) {
                    var layer = layers[l];
                    var j = layer.nearest(out[v * 3], out[v * 3 + 1], out[v * 3 + 2], layerCells);
                    if (j < 0) continue;
                    var dx = out[v * 3] - layer.pos[j * 3];
                    var dy = out[v * 3 + 1] - layer.pos[j * 3 + 1];
                    var dz = out[v * 3 + 2] - layer.pos[j * 3 + 2];
                    if (dx * dx + dy * dy + dz * dz > reach2) continue;
                    pushOut(layer, v, j);
                }
            }
        }
        function relax() {
            for (var e = 0; e < edges.length; e += 1) {
                var ia = edges[e][0];
                var ib = edges[e][1];
                var fa = movable ? movable[ia] : 1;
                var fb = movable ? movable[ib] : 1;
                if (!fa && !fb) continue;
                var a = ia * 3;
                var b = ib * 3;
                var dx = out[b] - out[a];
                var dy = out[b + 1] - out[a + 1];
                var dz = out[b + 2] - out[a + 2];
                var len = Math.hypot(dx, dy, dz);
                var limit = edges[e][2] * o.stretchLimit;
                if (len <= limit || len < 1e-9) continue;
                // A fixed end does not move, so the free end takes the whole correction.
                var k = ((len - limit) / len) * o.stiffness;
                var ka = fa ? (fb ? 0.5 : 1) : 0;
                var kb = fb ? (fa ? 0.5 : 1) : 0;
                out[a] += dx * k * ka;
                out[a + 1] += dy * k * ka;
                out[a + 2] += dz * k * ka;
                out[b] -= dx * k * kb;
                out[b + 1] -= dy * k * kb;
                out[b + 2] -= dz * k * kb;
            }
        }
        for (var it = 0; it < o.iterations; it += 1) {
            project();
            relax();
        }
        // The last word is the surface's, searched afresh. Where her surface folds (thigh into
        // seat) a push along one point's normal can land nearer another, so it is repeated.
        for (var last = 0; last < 3; last += 1) project(true);
        return out;
    }

    /**
     * Correct a stack of garments, innermost first.
     *
     * input = {bodyPos, bodyNrm, garments: [{name, posed, rest, indices, movable?}], ...options}
     * Returns {garments: [{name, positions, before, after}]}; before/after are the pose_contact
     * numbers against her skin, so the improvement is measured, not assumed.
     */
    function correct(input) {
        var o = options(input);
        var body = new Surface(Float32Array.from(input.bodyPos), Float32Array.from(input.bodyNrm), o.cell);
        var layers = [];
        var results = [];
        (input.garments || []).forEach(function (g) {
            var posed = Float32Array.from(g.posed);
            var rest = Float32Array.from(g.rest);
            var edges = edgesOf(g.indices, rest);
            var movable = g.movable ? Uint8Array.from(g.movable) : null;
            var before = measure(posed, rest, edges, body, o, movable);
            var positions = correctOne(posed, edges, body, layers, o, movable);
            var after = measure(positions, rest, edges, body, o, movable);
            results.push({ name: g.name, positions: positions, before: before, after: after });
            // This layer is now part of what the next one clears.
            layers.push(new Surface(positions, normalsOf(positions, g.indices, body, o.reach), o.cell));
        });
        return { garments: results };
    }

    var api = {
        DEFAULTS: DEFAULTS,
        correct: correct,
        edgesOf: edgesOf,
        normalsOf: normalsOf,
        Surface: Surface,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_POSE_CLOTH_CORRECTION = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
