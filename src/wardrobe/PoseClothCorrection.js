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
        // SD1. A skirt or dress panel bridges the opening between her thighs. Skinning drops that
        // panel into the opening (it is not inside either thigh, so a push out of the nearest
        // surface never sees it) and the seated hem parts. These are the gap test.
        span: false,
        spanReach: 0.14, // metres: from the lap opening, far enough to see the top of each thigh
        spanDisagree: 0.25, // surface normals dotted below this face two different ways — a gap
        spanClear: 0.008, // deeper inside than this belongs to one surface, which the push owns
        spanDrop: 0.004, // a panel this close to its support is already sitting on it
        spanFace: 0.35, // a thigh only supports the panel where its normal faces the cloth's rest
        // A push that would leave an edge longer than this is shortened. The crossed knee has
        // no outside: an unlimited push walked a leggings edge to 39×. 6× is the tear gate.
        tearLimit: 6,
    };

    /**
     * SW2. A shoe is not cloth: firm relaxation tore a boot's shaft where her calf and thigh press
     * together behind her knee (0.95x to 10.6x), while the gentle settings left it better than
     * skinning did (6.66x to 5.89x). A garment says which it is with `profile: 'shoe'`.
     */
    var SHOE = { stretchLimit: 1.3, stiffness: 0.5, iterations: 16, maxMove: 0.025 };

    /**
     * SD1. Skirts and dresses. The push below still runs: cloth that is inside a thigh comes out.
     * What a skirt adds is the opening between the thighs, which is not inside either of them.
     */
    var SPAN = { span: true };

    function options(input, garment) {
        var out = {};
        var profile = {};
        if (garment && garment.profile === 'shoe') profile = SHOE;
        else if (garment && garment.profile === 'span') profile = SPAN;
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

    /** Every surface point in the `reach` cells around (x,y,z). `fn(index, distanceSquared)`. */
    Surface.prototype.visit = function (x, y, z, reach, fn) {
        var cx = Math.floor(x / this.cell);
        var cy = Math.floor(y / this.cell);
        var cz = Math.floor(z / this.cell);
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
                        fn(i, dx * dx + dy * dy + dz * dz);
                    }
                }
            }
        }
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

    /**
     * SD1. A skirt vertex that has fallen into the opening between two surfaces (her thighs, or
     * her thigh and the seat) is not inside either of them, so pushing it out of the nearest
     * one leaves it in the hole and the hem parts. The support is the pair of upward-facing
     * surface points, one on each thigh. `need` is how far the vertex sits below that support.
     * The lift only travels upward, and only while the rest cut is still above the vertex:
     * moving toward a standing hem that hangs below the seated knee pushed the live pencil
     * skirt deeper into the opening. Returns null when the vertex is not bridging.
     */
    function spanNeed(surface, x, y, z, _rx, ry, _rz, o) {
        var reachCells = Math.max(1, Math.ceil(o.spanReach / surface.cell));
        var maxD = o.spanReach * o.spanReach;
        var nearest = -1;
        var nearestD = Infinity;
        surface.visit(x, y, z, reachCells, function (i, d2) {
            if (d2 > maxD || d2 >= nearestD) return;
            nearestD = d2;
            nearest = i;
        });
        if (nearest < 0) return null;
        // Inside one thigh by more than the gap tolerance: that is the push's job, and lifting
        // it toward the standing shape would pull a fitted side off the leg.
        if (surface.signed(nearest, x, y, z) < -o.spanClear) return null;
        var n0x = surface.nrm[nearest * 3];
        var n0y = surface.nrm[nearest * 3 + 1];
        var n0z = surface.nrm[nearest * 3 + 2];
        var opposing = -1;
        var opposeDot = o.spanDisagree;
        var opposeD = Infinity;
        surface.visit(x, y, z, reachCells, function (i, d2) {
            if (d2 > maxD || i === nearest) return;
            var dot = n0x * surface.nrm[i * 3] + n0y * surface.nrm[i * 3 + 1] + n0z * surface.nrm[i * 3 + 2];
            if (dot < opposeDot || (dot === opposeDot && d2 < opposeD)) {
                opposeDot = dot;
                opposeD = d2;
                opposing = i;
            }
        });
        if (opposing < 0) return null;
        var ax = surface.pos[nearest * 3] - surface.pos[opposing * 3];
        var ay = surface.pos[nearest * 3 + 1] - surface.pos[opposing * 3 + 1];
        var az = surface.pos[nearest * 3 + 2] - surface.pos[opposing * 3 + 2];
        var alen = Math.hypot(ax, ay, az);
        if (alen < 1e-6) return null;
        ax /= alen;
        ay /= alen;
        az /= alen;
        var mx = (surface.pos[nearest * 3] + surface.pos[opposing * 3]) * 0.5;
        var my = (surface.pos[nearest * 3 + 1] + surface.pos[opposing * 3 + 1]) * 0.5;
        var mz = (surface.pos[nearest * 3 + 2] + surface.pos[opposing * 3 + 2]) * 0.5;
        // Sitting in this viewer keeps her root upright, so the lap opens downward. The support
        // is the skin that faces up, one point on each thigh. Following the rest position
        // instead pointed a pencil mini the wrong way: its standing hem hangs below the seated
        // knee, and moving toward that rest pushed the panel deeper into the opening
        // (measured 124 mm to 130 mm on Black Pencil Mini Skirt, Sitting Desk).
        var ux = 0;
        var uy = 1;
        var uz = 0;
        var left = -1;
        var right = -1;
        var leftScore = -Infinity;
        var rightScore = -Infinity;
        surface.visit(x, y, z, reachCells, function (i, d2) {
            if (d2 > maxD) return;
            var side =
                (surface.pos[i * 3] - mx) * ax +
                (surface.pos[i * 3 + 1] - my) * ay +
                (surface.pos[i * 3 + 2] - mz) * az;
            var score = surface.nrm[i * 3 + 1];
            if (side >= 0 && score > leftScore) {
                leftScore = score;
                left = i;
            } else if (side < 0 && score > rightScore) {
                rightScore = score;
                right = i;
            }
        });
        if (left < 0 || right < 0 || leftScore < o.spanFace || rightScore < o.spanFace) return null;
        var lx = surface.pos[left * 3];
        var ly = surface.pos[left * 3 + 1];
        var lz = surface.pos[left * 3 + 2];
        var bx = surface.pos[right * 3] - lx;
        var by = surface.pos[right * 3 + 1] - ly;
        var bz = surface.pos[right * 3 + 2] - lz;
        var chord2 = bx * bx + by * by + bz * bz;
        if (chord2 < 1e-8) return null;
        var t = ((x - lx) * bx + (y - ly) * by + (z - lz) * bz) / chord2;
        // Past either thigh the panel is draping a leg, not bridging the opening.
        if (t < 0.15 || t > 0.85) return null;
        var cx = lx + bx * t;
        var cy = ly + by * t;
        var cz = lz + bz * t;
        var vx = x - cx;
        var vy = y - cy;
        var vz = z - cz;
        if (vx * vx + vy * vy + vz * vz > maxD) return null;
        var along = vy;
        var belowSupport = o.clearance - along;
        if (belowSupport < o.spanDrop) return null;
        // A hem that is still at its cut has not fallen, even when that cut hangs below
        // the tops of the thighs. Counting every such hem made a standing pencil skirt
        // fail the gate at 134 mm. The drop is how far this vertex has left the cut,
        // and no further than the support.
        var belowCut = ry - y;
        if (belowCut < o.spanDrop) return null;
        var need = Math.min(belowSupport, belowCut);
        var travel = need > o.spanReach ? o.spanReach : need;
        return { need: need, travel: travel, x: ux, y: uy, z: uz, move: travel > 0 };
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
        var drop = 0;
        if (o.span && rest) {
            for (var s = 0; s < count; s += 1) {
                if (movable && !movable[s]) continue;
                var hit = spanNeed(
                    surface,
                    pos[s * 3],
                    pos[s * 3 + 1],
                    pos[s * 3 + 2],
                    rest[s * 3],
                    rest[s * 3 + 1],
                    rest[s * 3 + 2],
                    o
                );
                if (hit && hit.need > drop) drop = hit.need;
            }
        }
        return {
            maxPenetrationMm: Math.round(deepest * 10000) / 10,
            penetratingPct: Math.round((inside / Math.max(count, 1)) * 10000) / 100,
            maxEdgeStretch: Math.round(worst * 100) / 100,
            stretchedPct: Math.round((stretched / Math.max(edges.length, 1)) * 10000) / 100,
            // SD1. 0 for a garment that is not a span, and for a span panel sitting on its support.
            maxSpanDropMm: Math.round(drop * 10000) / 10,
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
    function correctOne(posed, rest, edges, body, layers, o, movable, indices) {
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
        // SW3. Where her skin folds into itself (behind her knee at 90 degrees, calf against thigh)
        // there is no outside: out of her calf is into her thigh. A boot's rim there was pushed out
        // of one and back out of the other until it stood 60 mm off, its 5 mm rim edge torn to 13x.
        // A shoe's vertex goes no farther from where skinning put it than `maxMove`, deeper than
        // any penetration measured (23 mm). Not cloth's: briefs and a dress are carried out of
        // her and then out of each other, legitimately farther, and capped they ended inside.
        var maxMove2 = o.maxMove * o.maxMove;
        var nbrs = [];
        var nbrRest = [];
        for (var n = 0; n < count; n += 1) {
            nbrs.push([]);
            nbrRest.push([]);
        }
        for (var e = 0; e < edges.length; e += 1) {
            var ea = edges[e][0];
            var eb = edges[e][1];
            nbrs[ea].push(eb);
            nbrRest[ea].push(edges[e][2]);
            nbrs[eb].push(ea);
            nbrRest[eb].push(edges[e][2]);
        }
        // Largest step along N that keeps every edge of v at or under tearLimit × rest.
        function stepWithinTear(v, nx, ny, nz, push) {
            var limit = o.tearLimit;
            if (!(limit > 0) || !isFinite(limit)) return push;
            var t = push;
            var ring = nbrs[v];
            var rests = nbrRest[v];
            for (var n = 0; n < ring.length; n += 1) {
                var u = ring[n] * 3;
                var dx = out[u] - out[v * 3];
                var dy = out[u + 1] - out[v * 3 + 1];
                var dz = out[u + 2] - out[v * 3 + 2];
                var restLen = rests[n] * limit;
                var limit2 = restLen * restLen;
                var b = dx * nx + dy * ny + dz * nz;
                var c = dx * dx + dy * dy + dz * dz - limit2;
                var disc = b * b - c;
                if (disc < 0) {
                    t = 0;
                    break;
                }
                var span = Math.sqrt(disc);
                var hi = Math.min(t, b + span);
                var lo = Math.max(0, b - span);
                t = lo <= hi ? hi : 0;
            }
            return t;
        }
        function pushOut(surface, v, i) {
            var nx = surface.nrm[i * 3];
            var ny = surface.nrm[i * 3 + 1];
            var nz = surface.nrm[i * 3 + 2];
            var nlen = Math.hypot(nx, ny, nz) || 1;
            nx /= nlen;
            ny /= nlen;
            nz /= nlen;
            // signed() is the raw dot with the stored normal. A unit normal makes the
            // clearance a distance, which is what the tear cap's step is measured in.
            var s = surface.signed(i, out[v * 3], out[v * 3 + 1], out[v * 3 + 2]) / nlen;
            if (s >= o.clearance) return false;
            var push = stepWithinTear(v, nx, ny, nz, o.clearance - s);
            if (push <= 1e-8) return false;
            out[v * 3] += nx * push;
            out[v * 3 + 1] += ny * push;
            out[v * 3 + 2] += nz * push;
            return true;
        }
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
                    // The first surface that actually moves this vertex wins this pass. A later
                    // point whose normal faces the other way is the other side of a fold, and
                    // pushing along both walks the vertex between them. A point that did not
                    // need to move does not win, so cloth outside one surface and inside the
                    // next is still pushed out of the next.
                    var leadX = 0;
                    var leadY = 0;
                    var leadZ = 0;
                    var lead = false;
                    for (var q = 0; q < near.length; q += 1) {
                        var pi = near[q];
                        var ex = out[v * 3] - body.pos[pi * 3];
                        var ey = out[v * 3 + 1] - body.pos[pi * 3 + 1];
                        var ez = out[v * 3 + 2] - body.pos[pi * 3 + 2];
                        var dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
                        if (first < 0) first = dist;
                        else if (dist > first + o.creaseWindow) break;
                        var nx = body.nrm[pi * 3];
                        var ny = body.nrm[pi * 3 + 1];
                        var nz = body.nrm[pi * 3 + 2];
                        if (lead && leadX * nx + leadY * ny + leadZ * nz < 0) continue;
                        if (pushOut(body, v, pi) && !lead) {
                            leadX = nx;
                            leadY = ny;
                            leadZ = nz;
                            lead = true;
                        }
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
        var restoreSpan = function () {};
        if (o.span) {
            // SD1. Do this after the push. A vertex in the opening is outside both thighs, so the
            // push never moves it, and a relax that runs last pulls a lifted hem back into the
            // hole along the edge it just shortened. The support gets the last word; one more
            // projection keeps that lift from landing inside her.
            function liftSpans() {
                var moved = false;
                for (var v = 0; v < count; v += 1) {
                    if (movable && !movable[v]) continue;
                    var hit = spanNeed(
                        body,
                        out[v * 3],
                        out[v * 3 + 1],
                        out[v * 3 + 2],
                        rest[v * 3],
                        rest[v * 3 + 1],
                        rest[v * 3 + 2],
                        o
                    );
                    if (!hit || !hit.move) continue;
                    var travel = stepWithinTear(v, hit.x, hit.y, hit.z, hit.travel);
                    if (travel <= 1e-8) continue;
                    out[v * 3] += hit.x * travel;
                    out[v * 3 + 1] += hit.y * travel;
                    out[v * 3 + 2] += hit.z * travel;
                    moved = true;
                }
                return moved;
            }
            // A projection after the lift pushes a bridged hem back down. Hold the height
            // it just gained, and let the push clear her only in the other two axes.
            function holdSpan() {
                var beforeY = new Float32Array(count);
                for (var v = 0; v < count; v += 1) beforeY[v] = out[v * 3 + 1];
                if (!liftSpans()) return false;
                var floorY = new Float32Array(count);
                for (var v = 0; v < count; v += 1) floorY[v] = out[v * 3 + 1];
                for (var pass = 0; pass < 3; pass += 1) {
                    project(true);
                    for (var u = 0; u < count; u += 1) {
                        if (movable && !movable[u]) continue;
                        if (floorY[u] <= beforeY[u] + 1e-4) continue;
                        var drop = floorY[u] - out[u * 3 + 1];
                        if (drop <= 0.001) continue;
                        var step = stepWithinTear(u, 0, 1, 0, drop);
                        out[u * 3 + 1] += step;
                    }
                }
                return true;
            }
            restoreSpan = holdSpan;
            for (var spanRound = 0; spanRound < 3; spanRound += 1) {
                if (!liftSpans()) break;
                relax();
                project(true);
            }
            liftSpans();
            project(true);
        }
        function seatRisenHem() {
            var yMin = Infinity;
            var yMax = -Infinity;
            for (var i = 0; i < count; i += 1) {
                var ry = rest[i * 3 + 1];
                if (ry < yMin) yMin = ry;
                if (ry > yMax) yMax = ry;
            }
            var hemTop = yMin + (yMax - yMin) * 0.4;
            var moved = false;
            for (var v = 0; v < count; v += 1) {
                if (movable && !movable[v]) continue;
                if (rest[v * 3 + 1] > hemTop) continue;
                var dx = rest[v * 3] - out[v * 3];
                var dy = rest[v * 3 + 1] - out[v * 3 + 1];
                var dz = rest[v * 3 + 2] - out[v * 3 + 2];
                // Risen with the leg, not dropped into the lap.
                if (-dy < 0.15) continue;
                var dist = Math.hypot(dx, dy, dz);
                if (dist < 0.01) continue;
                var step = stepWithinTear(v, dx / dist, dy / dist, dz / dist, Math.min(0.02, dist));
                if (step <= 1e-8) continue;
                out[v * 3] += (dx / dist) * step;
                out[v * 3 + 1] += (dy / dist) * step;
                out[v * 3 + 2] += (dz / dist) * step;
                moved = true;
            }
            return moved;
        }
        if (indices) {
            // SW3. Pushed out along different normals in a crease, neighbouring vertices crossed
            // and their triangles turned over: Forge's check counted 53 on the boots where skinning
            // left 2, 72 on the boot lining's rim, 37 new on the dress at her hip. A triangle facing
            // against the way skinning faced it is folded; its corners (only theirs) move half way
            // to their neighbours' mean, the cloth is pulled back to length and the surface clears
            // it again. As Forge's own fit does (wardrobe/lingerie/fit.py `_unfold`).
            var reference = facesOf(posed, indices);
            var around = neighboursOf(edges, count);
            for (var round = 0; round < o.unfoldRounds; round += 1) {
                if (!unfold(out, indices, reference, around, movable)) break;
                relax();
                project(true);
            }
        }
        // Skinning swings a long hem up with the knee, so the cut stands out as a ring and the
        // lap is bare. Walk that hem back toward its cut. A hem that has not risen is left
        // where it is: pulling a hem down to a cut that already hangs below the knee only
        // pushed it deeper into the opening.
        if (o.span) {
            for (var seat = 0; seat < 30; seat += 1) {
                if (!seatRisenHem()) break;
                relax();
            }
            project(true);
        }
        // Unfold relaxes after the span lift and pulls a bridged hem back into the opening.
        // The support is the last word. Nothing after this may shorten that edge.
        restoreSpan();
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
        // SD1. The page does not load this file (the worker does, via importScripts), so the
        // profile has to be decided here. A fixture that only has a display name is left alone:
        // the SW1 tests label a square "dress" and must keep the push-only behaviour.
        garments.forEach(function (g) {
            if (g.profile) return;
            if (g.templateId || g.slot || /\[Forge_/.test(g.name || '')) g.profile = profileFor(g);
        });
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
            var welded = correctOne(posed, rest, edgesOf(indices, rest), body, layers, og, movable, indices);
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

    /**
     * Which correction a Forge garment gets. Shoes stay shoes. A skirt, a dress or a gown is a
     * span: its panel crosses an opening. Jeans, leggings and a tee do not, and neither does a
     * shirt that merely has "dress" in its name ("dress shirt"). Template ids win, because the
     * material name is a sentence and the id is the catalog's own word.
     */
    function profileFor(info) {
        var slot = String((info && info.slot) || '');
        var name = String((info && info.name) || '');
        var template = String((info && info.templateId) || '');
        if (/shoes/i.test(slot) || /\[Forge_Shoes/i.test(name)) return 'shoe';
        if (/skirt|dress|gown/i.test(template)) return 'span';
        var bare = name.replace(/\s*\[Forge_[^\]]+\]/g, '');
        if (/\bdress\s+shirt\b/i.test(bare)) return undefined;
        if (/\b(skirt|nightgown)\b/i.test(bare)) return 'span';
        if (/\b(dress|gown)\b/i.test(bare)) return 'span';
        return undefined;
    }

    /** What a corrected garment must still satisfy before a look is called production-ready. */
    var GATE = { maxPenetrationMm: 1, maxEdgeStretch: 6, maxSpanDropMm: 8 };

    /**
     * Quality gate over `correct()`'s garments (each `{name, before, after}`). A miss is a
     * finding, not a thrown error: the audit records it and the look can still be inspected.
     * Thresholds are the pose_contact ones (1 mm inside, and a span panel more than 8 mm below
     * its support). Stretch stays loose because a seated boot shaft is still several times its
     * rest length after the shoe cap (docs/SITTING_WIDE.md) — 6× is the tear, not the residual.
     */
    function assess(garments, limits) {
        var lim = {};
        var key;
        for (key in GATE) lim[key] = limits && limits[key] !== undefined ? limits[key] : GATE[key];
        var issues = [];
        var list = garments || [];
        for (var i = 0; i < list.length; i += 1) {
            var g = list[i] || {};
            var after = g.after || {};
            var checks = [
                ['penetration', 'P1', 'maxPenetrationMm'],
                ['stretch', 'P2', 'maxEdgeStretch'],
                ['span-drop', 'P1', 'maxSpanDropMm'],
            ];
            for (var c = 0; c < checks.length; c += 1) {
                var metric = checks[c][2];
                if (!(after[metric] > lim[metric])) continue;
                issues.push({
                    code: checks[c][0],
                    severity: checks[c][1],
                    garment: g.name || '',
                    metric: metric,
                    value: after[metric],
                    limit: lim[metric],
                });
            }
        }
        return { ok: issues.length === 0, issues: issues };
    }

    /**
     * What this mesh can tell a later solver about a seated shape.
     *
     * Welded copies are the only seam pairs we have: vertices that already share a rest
     * position within 0.1 mm. A boundary that merely passes near another boundary is not a
     * seam. Rest positions are the authored surface, which for these garments is the standing
     * cut, so they do not contain a seated drape. A connected panel that crosses the opening
     * can be held together. An open crotch cannot be stitched from proximity alone.
     */
    function evidenceOf(rest, indices) {
        var count = rest.length / 3;
        var weld = weldOf(rest);
        var uses = new Map();
        function tally(a, b) {
            if (a > b) {
                var swap = a;
                a = b;
                b = swap;
            }
            var key = a + ',' + b;
            uses.set(key, (uses.get(key) || 0) + 1);
        }
        for (var t = 0; t + 2 < indices.length; t += 3) {
            var a = weld.of[indices[t]];
            var b = weld.of[indices[t + 1]];
            var c = weld.of[indices[t + 2]];
            tally(a, b);
            tally(b, c);
            tally(c, a);
        }
        var parent = [];
        for (var i = 0; i < weld.count; i += 1) parent.push(i);
        function find(v) {
            while (parent[v] !== v) v = parent[v] = parent[parent[v]];
            return v;
        }
        var boundary = [];
        uses.forEach(function (countUses, key) {
            var parts = key.split(',');
            var pa = Number(parts[0]);
            var pb = Number(parts[1]);
            var ra = find(pa);
            var rb = find(pb);
            if (ra !== rb) parent[rb] = ra;
            if (countUses === 1) boundary.push([pa, pb]);
        });
        var roots = {};
        for (var p = 0; p < weld.count; p += 1) roots[find(p)] = true;
        var unpaired = 0;
        for (var e = 0; e < boundary.length; e += 1) {
            for (var f = e + 1; f < boundary.length; f += 1) {
                var e0 = boundary[e];
                var f0 = boundary[f];
                if (e0[0] === f0[0] || e0[0] === f0[1] || e0[1] === f0[0] || e0[1] === f0[1]) continue;
                var ax = rest[weld.reps[e0[0]] * 3] + rest[weld.reps[e0[1]] * 3];
                var ay = rest[weld.reps[e0[0]] * 3 + 1] + rest[weld.reps[e0[1]] * 3 + 1];
                var az = rest[weld.reps[e0[0]] * 3 + 2] + rest[weld.reps[e0[1]] * 3 + 2];
                var bx = rest[weld.reps[f0[0]] * 3] + rest[weld.reps[f0[1]] * 3];
                var by = rest[weld.reps[f0[0]] * 3 + 1] + rest[weld.reps[f0[1]] * 3 + 1];
                var bz = rest[weld.reps[f0[0]] * 3 + 2] + rest[weld.reps[f0[1]] * 3 + 2];
                var dist = Math.hypot(ax - bx, ay - by, az - bz) * 0.5;
                if (dist > 1e-4 && dist < 0.015) unpaired += 1;
            }
        }
        var xMin = Infinity;
        var xMax = -Infinity;
        for (var q = 0; q < weld.count; q += 1) {
            var x = rest[weld.reps[q] * 3];
            if (x < xMin) xMin = x;
            if (x > xMax) xMax = x;
        }
        var onePiece = Object.keys(roots).length === 1;
        var crosses = onePiece && xMin < -0.02 && xMax > 0.02;
        return {
            vertices: count,
            particles: weld.count,
            copiesWelded: count - weld.count,
            components: Object.keys(roots).length,
            boundaryEdges: boundary.length,
            unpairedBoundaries: unpaired,
            panelCrossesOpening: crosses,
            seatedDrapeInRest: false,
            canEnforceKnownPanel: crosses && unpaired === 0,
            canRepairOpenSeam: false,
        };
    }

    var api = {
        DEFAULTS: DEFAULTS,
        SHOE: SHOE,
        SPAN: SPAN,
        GATE: GATE,
        correct: correct,
        assess: assess,
        profileFor: profileFor,
        spanNeed: spanNeed,
        edgesOf: edgesOf,
        weldOf: weldOf,
        evidenceOf: evidenceOf,
        normalsOf: normalsOf,
        Surface: Surface,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_POSE_CLOTH_CORRECTION = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
