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
        // Cloth (SW2): pulled firmly back towards its length. Measured on the bodycon over briefs
        // in Sitting (Wide): at 16 rounds, half strength and a 1.3x limit the briefs' worst edge
        // went from 3.55x to 5.33x — the final pushes stretched the short binding edges round the
        // seat — and at these it is 2.19x, the dress 1.20x, nothing inside her either way.
        stretchLimit: 1.15, // an edge longer than this × rest is pulled back
        stiffness: 1,
        iterations: 48,
        layerReach: 0.015, // a layer below counts only this close: farther, it is not beneath this cloth
        penetrating: 0.001, // what counts as inside, for the report (pose_contact's 1 mm)
        stretched: 1.5, // what counts as stretched, for the report (pose_contact's 1.5×)
        maxMove: Infinity, // metres a vertex may move from where skinning put it (SW3: shoes only)
        unfoldRounds: 30, // passes of unfolding at most, each followed by clearing her surface again
        creaseWindow: 0.002, // in the last passes, also clear skin points this much farther than the nearest
    };

    /**
     * SW2. A shoe is not cloth: firm relaxation tore a boot's shaft where her calf and thigh press
     * together behind her knee (0.95x to 10.6x), while the gentle settings left it better than
     * skinning did (6.66x to 5.89x). A garment says which it is with `profile: 'shoe'`.
     */
    var SHOE = { stretchLimit: 1.3, stiffness: 0.5, iterations: 16, maxMove: 0.025 };

    function options(input, garment) {
        var out = {};
        var profile = garment && garment.profile === 'shoe' ? SHOE : {};
        for (var key in DEFAULTS) {
            if (input && input[key] !== undefined) out[key] = input[key];
            else if (profile[key] !== undefined) out[key] = profile[key];
            else out[key] = DEFAULTS[key];
        }
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

    /** The `k` nearest surface points within `reach` cells, nearest first. */
    Surface.prototype.nearestK = function (x, y, z, reach, k) {
        var cx = Math.floor(x / this.cell);
        var cy = Math.floor(y / this.cell);
        var cz = Math.floor(z / this.cell);
        var best = [];
        for (var ix = cx - reach; ix <= cx + reach; ix += 1) {
            for (var iy = cy - reach; iy <= cy + reach; iy += 1) {
                for (var iz = cz - reach; iz <= cz + reach; iz += 1) {
                    var bucket = this.map.get(ix + ',' + iy + ',' + iz);
                    if (!bucket) continue;
                    for (var n = 0; n < bucket.length; n += 1) {
                        var i = bucket[n];
                        var dx = x - this.pos[i * 3];
                        var dy = y - this.pos[i * 3 + 1];
                        var dz = z - this.pos[i * 3 + 2];
                        var d = dx * dx + dy * dy + dz * dz;
                        if (best.length < k || d < best[best.length - 1][0]) {
                            best.push([d, i]);
                            best.sort(function (a, b) {
                                return a[0] - b[0];
                            });
                            if (best.length > k) best.pop();
                        }
                    }
                }
            }
        }
        return best.map(function (b) {
            return b[1];
        });
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
     * `indices` (optional) are its triangles, for unfolding (SW3).
     * `posed` is not modified.
     * @returns {Float32Array} corrected positions
     */
    function correctOne(posed, edges, body, layers, o, movable, indices) {
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
        // SW3. Where her skin folds into itself (behind her knee at 90 degrees, calf against thigh)
        // there is no outside: out of her calf is into her thigh. A boot's rim there was pushed out
        // of one and back out of the other until it stood 60 mm off, its 5 mm rim edge torn to 13x.
        // A shoe's vertex goes no farther from where skinning put it than `maxMove`, deeper than
        // any penetration measured (23 mm). Not cloth's: briefs and a dress are carried out of
        // her and then out of each other, legitimately farther, and capped they ended inside.
        var maxMove2 = o.maxMove * o.maxMove;
        function tether() {
            for (var v = 0; v < count; v += 1) {
                var tx = out[v * 3] - posed[v * 3];
                var ty = out[v * 3 + 1] - posed[v * 3 + 1];
                var tz = out[v * 3 + 2] - posed[v * 3 + 2];
                var d2 = tx * tx + ty * ty + tz * tz;
                if (d2 <= maxMove2) continue;
                var k = o.maxMove / Math.sqrt(d2);
                out[v * 3] = posed[v * 3] + tx * k;
                out[v * 3 + 1] = posed[v * 3 + 1] + ty * k;
                out[v * 3 + 2] = posed[v * 3 + 2] + tz * k;
            }
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
                if (fresh) {
                    // SW2. In a crease (her thighs into her pelvis) the nearest point is a toss-up
                    // between patches, and cloth outside one can be inside the next: Forge's
                    // measurement found three brief vertices 5 mm inside where this pass, trusting
                    // one point, saw none. The last passes clear the few nearest.
                    // SW3. Only those about as near as the nearest (`creaseWindow`): a point across
                    // a wide fold — her calf, seen from the boot's thigh — is not the surface this
                    // vertex lies on, and pushing out along its normal threw a boot's rim 60 mm and
                    // took the briefs' worst edge from 2.6x to 3.8x, the dress's from 1.4x to 3.9x.
                    var near = body.nearestK(out[v * 3], out[v * 3 + 1], out[v * 3 + 2], o.reach, 4);
                    var first = -1;
                    for (var q = 0; q < near.length; q += 1) {
                        var ex = out[v * 3] - body.pos[near[q] * 3];
                        var ey = out[v * 3 + 1] - body.pos[near[q] * 3 + 1];
                        var ez = out[v * 3 + 2] - body.pos[near[q] * 3 + 2];
                        var dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
                        if (first < 0) first = dist;
                        else if (dist > first + o.creaseWindow) break;
                        pushOut(body, v, near[q]);
                    }
                } else if (i >= 0) pushOut(body, v, i);
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
            tether();
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
        if (indices) {
            // SW3. Pushed out along different normals in a crease, neighbouring vertices crossed
            // and their triangles turned over: Forge's check counted 53 on the boots where skinning
            // left 2, 72 on the boot lining's rim, 37 new on the dress at her hip. A triangle facing
            // against the way skinning faced it is folded; its corners (only theirs) move half way
            // to their neighbours' mean, the cloth is pulled back to length and the surface clears it again. As Forge's own fit does
            // (wardrobe/lingerie/fit.py `_unfold`).
            var reference = facesOf(posed, indices);
            var around = neighboursOf(edges, count);
            for (var round = 0; round < o.unfoldRounds; round += 1) {
                if (!unfold(out, indices, reference, around, movable)) break;
                relax();
                project(true);
            }
        }
        return out;
    }

    /** Each triangle's (unnormalised) normal. */
    function facesOf(pos, indices) {
        var faces = new Float32Array(indices.length);
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
            faces[t] = uy * vz - uz * vy;
            faces[t + 1] = uz * vx - ux * vz;
            faces[t + 2] = ux * vy - uy * vx;
        }
        return faces;
    }

    function neighboursOf(edges, count) {
        var around = [];
        for (var v = 0; v < count; v += 1) around.push([]);
        for (var e = 0; e < edges.length; e += 1) {
            around[edges[e][0]].push(edges[e][1]);
            around[edges[e][1]].push(edges[e][0]);
        }
        return around;
    }

    /** One unfolding pass; true when something was folded. In place. */
    function unfold(out, indices, reference, around, movable) {
        var now = facesOf(out, indices);
        var moving = new Set();
        for (var t = 0; t + 2 < indices.length; t += 3) {
            var dot = now[t] * reference[t] + now[t + 1] * reference[t + 1] + now[t + 2] * reference[t + 2];
            if (dot >= 0) continue;
            for (var k = 0; k < 3; k += 1) {
                var v = indices[t + k];
                if (!movable || movable[v]) moving.add(v);
            }
        }
        if (!moving.size) return false;
        var moved = [];
        moving.forEach(function (v) {
            var ring = around[v];
            if (!ring.length) return;
            var mx = 0;
            var my = 0;
            var mz = 0;
            for (var r = 0; r < ring.length; r += 1) {
                mx += out[ring[r] * 3];
                my += out[ring[r] * 3 + 1];
                mz += out[ring[r] * 3 + 2];
            }
            moved.push([v, mx / ring.length, my / ring.length, mz / ring.length]);
        });
        moved.forEach(function (m) {
            var v = m[0];
            out[v * 3] = out[v * 3] * 0.5 + m[1] * 0.5;
            out[v * 3 + 1] = out[v * 3 + 1] * 0.5 + m[2] * 0.5;
            out[v * 3 + 2] = out[v * 3 + 2] * 0.5 + m[3] * 0.5;
        });
        return true;
    }

    /**
     * SW3. A glTF mesh splits a vertex wherever its UVs or normals do, so one point of the cloth is
     * several vertices sharing a rest position. Corrected one by one, each copy found its own
     * nearest skin point and its own edges to relax, and Forge's seam check measured the bodycon's
     * seams 41 mm apart in Sitting (Wide) — the cloth torn along every UV island. Copies are welded
     * (same rest position within 0.1 mm) into one particle, corrected once, and written back to
     * every copy. Returns {of: copy → particle, reps: particle → first copy, count}.
     */
    function weldOf(rest) {
        var count = rest.length / 3;
        var of = new Int32Array(count);
        var reps = [];
        var seen = new Map();
        for (var v = 0; v < count; v += 1) {
            var key =
                Math.round(rest[v * 3] / 1e-4) +
                ',' +
                Math.round(rest[v * 3 + 1] / 1e-4) +
                ',' +
                Math.round(rest[v * 3 + 2] / 1e-4);
            var p = seen.get(key);
            if (p === undefined) {
                p = reps.length;
                seen.set(key, p);
                reps.push(v);
            }
            of[v] = p;
        }
        return { of: of, reps: reps, count: reps.length };
    }

    /**
     * SW3. One garment can arrive as several pieces — a glTF mesh with three materials is three
     * meshes in three.js: a boot's shell, sole and lining. Corrected one after another, the lining
     * met the shell as a layer beneath it and was pushed out through it, and the shell's worst
     * edge went from 6.66x to 11.4x. Pieces that name the same `group` are corrected as one cloth:
     * concatenated, welded across pieces where they meet, and split back afterwards.
     */
    function unitsOf(garments) {
        var units = [];
        var byGroup = new Map();
        garments.forEach(function (g, index) {
            var key = g.group !== undefined && g.group !== null ? String(g.group) : null;
            var unit = key !== null ? byGroup.get(key) : undefined;
            if (!unit) {
                unit = { members: [], profile: g.profile };
                units.push(unit);
                if (key !== null) byGroup.set(key, unit);
            }
            unit.members.push(index);
        });
        return units;
    }

    /**
     * Correct a stack of garments, innermost first.
     *
     * input = {bodyPos, bodyNrm, garments: [{name, posed, rest, indices, movable?, profile?, group?}], ...options}
     * Returns {garments: [{name, positions, before, after}]}, one per input garment in input order;
     * before/after are the pose_contact numbers against her skin, so the improvement is measured,
     * not assumed.
     */
    function correct(input) {
        var o = options(input, null);
        var body = new Surface(Float32Array.from(input.bodyPos), Float32Array.from(input.bodyNrm), o.cell);
        var garments = input.garments || [];
        var layers = [];
        var results = new Array(garments.length);
        unitsOf(garments).forEach(function (unit) {
            var total = 0;
            var faces = 0;
            unit.members.forEach(function (m) {
                total += garments[m].rest.length / 3;
                faces += garments[m].indices.length;
            });
            var fullRest = new Float32Array(total * 3);
            var fullPosed = new Float32Array(total * 3);
            var fullMovable = new Uint8Array(total).fill(1);
            var fullIndices = new Uint32Array(faces);
            var anyMovable = false;
            var offsets = [];
            var at = 0;
            var face = 0;
            unit.members.forEach(function (m) {
                var g = garments[m];
                offsets.push(at);
                fullRest.set(g.rest, at * 3);
                fullPosed.set(g.posed, at * 3);
                if (g.movable) {
                    anyMovable = true;
                    for (var k = 0; k < g.movable.length; k += 1) fullMovable[at + k] = g.movable[k] ? 1 : 0;
                }
                for (var t = 0; t < g.indices.length; t += 1) fullIndices[face + t] = g.indices[t] + at;
                face += g.indices.length;
                at += g.rest.length / 3;
            });
            var weld = weldOf(fullRest);
            // One particle per welded point: its posed position is its copies' mean (skinning can
            // part them by a hair where their weights differ), and it moves only if all may.
            var posed = new Float32Array(weld.count * 3);
            var rest = new Float32Array(weld.count * 3);
            var copies = new Uint16Array(weld.count);
            var movable = anyMovable ? new Uint8Array(weld.count).fill(1) : null;
            for (var v = 0; v < total; v += 1) {
                var p = weld.of[v];
                copies[p] += 1;
                for (var c = 0; c < 3; c += 1) posed[p * 3 + c] += fullPosed[v * 3 + c];
                if (movable && !fullMovable[v]) movable[p] = 0;
            }
            for (var q = 0; q < weld.count; q += 1) {
                for (var d = 0; d < 3; d += 1) {
                    posed[q * 3 + d] /= copies[q];
                    rest[q * 3 + d] = fullRest[weld.reps[q] * 3 + d];
                }
            }
            var indices = new Uint32Array(faces);
            for (var f = 0; f < faces; f += 1) indices[f] = weld.of[fullIndices[f]];
            var og = options(input, { profile: unit.profile });
            var welded = correctOne(posed, edgesOf(indices, rest), body, layers, og, movable, indices);
            var corrected = new Float32Array(total * 3);
            for (var w = 0; w < total; w += 1) {
                for (var e = 0; e < 3; e += 1) corrected[w * 3 + e] = welded[weld.of[w] * 3 + e];
            }
            // Each piece is reported on its own, with its own edges, as pose_contact measures it.
            unit.members.forEach(function (m, n) {
                var g = garments[m];
                var count = g.rest.length / 3;
                var pieceRest = fullRest.subarray(offsets[n] * 3, (offsets[n] + count) * 3);
                var piecePosed = fullPosed.subarray(offsets[n] * 3, (offsets[n] + count) * 3);
                var positions = corrected.slice(offsets[n] * 3, (offsets[n] + count) * 3);
                var pieceMovable = g.movable ? Uint8Array.from(g.movable) : null;
                var edges = edgesOf(g.indices, pieceRest);
                results[m] = {
                    name: g.name,
                    positions: positions,
                    before: measure(piecePosed, pieceRest, edges, body, og, pieceMovable),
                    after: measure(positions, pieceRest, edges, body, og, pieceMovable),
                };
            });
            // This cloth is now part of what the next one clears.
            layers.push(new Surface(corrected, normalsOf(corrected, fullIndices, body, o.reach), o.cell));
        });
        return { garments: results };
    }

    var api = {
        DEFAULTS: DEFAULTS,
        SHOE: SHOE,
        correct: correct,
        edgesOf: edgesOf,
        weldOf: weldOf,
        normalsOf: normalsOf,
        Surface: Surface,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_POSE_CLOTH_CORRECTION = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
