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
        function projectOut(allowLateral) {
            if (!hash) return;
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
                if (signed >= CLEARANCE_M) continue;
                // An inner-thigh normal points away from the midline and pins
                // the hem open. The iterative pass skips it. The last pass
                // does not: shortening a chord has already pulled the cloth in.
                var away = (x - centerX) * nx;
                var lateral = away > 0 && Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz);
                if (lateral && !allowLateral) continue;
                var push = CLEARANCE_M - signed;
                out[v * 3] += nx * push;
                out[v * 3 + 1] += ny * push;
                out[v * 3 + 2] += nz * push;
            }
        }

        for (var iter = 0; iter < ITERATIONS; iter += 1) {
            projectOut(false);
            relaxEdges(out, edges, lap);
        }
        for (var closing = 0; closing < 32; closing += 1) relaxEdges(out, edges, lap, 1);
        projectOut(true);
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

    // The panel on the mound. A brief gusset drafted wide and then pinched to a
    // few millimetres is a string, and the mound shows on both sides of it.
    var GUSSET_ON_MOUND_M = 0.024;
    var GUSSET_SEAM_M = 0.040;
    var GUSSET_COLLAPSED_M = 0.004;
    var GUSSET_ROW_GAP_M = 0.008;

    function _spanX(positions, row) {
        var lo = Infinity;
        var hi = -Infinity;
        for (var i = 0; i < row.length; i += 1) {
            var x = positions[row[i] * 3];
            if (x < lo) lo = x;
            if (x > hi) hi = x;
        }
        return hi - lo;
    }

    /**
     * Open a pinched brief gusset back to 24 mm. Positions are a flat xyz
     * array in the bind pose; indices are the triangle list. Seams stay.
     * A component whose seams are under 40 mm was drafted as a string and is
     * left alone. Returns how many rows were opened.
     */
    function widenCollapsedGusset(positions, indices) {
        var count = positions.length / 3;
        var adj = new Array(count);
        for (var v = 0; v < count; v += 1) adj[v] = [];
        var seenEdge = new Set();
        function link(a, b) {
            var key = a < b ? a + ',' + b : b + ',' + a;
            if (seenEdge.has(key)) return;
            seenEdge.add(key);
            adj[a].push(b);
            adj[b].push(a);
        }
        for (var t = 0; t + 2 < indices.length; t += 3) {
            link(indices[t], indices[t + 1]);
            link(indices[t + 1], indices[t + 2]);
            link(indices[t + 2], indices[t]);
        }
        var seen = new Uint8Array(count);
        var components = [];
        for (var start = 0; start < count; start += 1) {
            if (seen[start] || adj[start].length === 0) continue;
            var stack = [start];
            seen[start] = 1;
            var comp = [];
            while (stack.length) {
                var u = stack.pop();
                comp.push(u);
                var next = adj[u];
                for (var n = 0; n < next.length; n += 1) {
                    var w = next[n];
                    if (seen[w]) continue;
                    seen[w] = 1;
                    stack.push(w);
                }
            }
            components.push(comp);
        }
        if (components.length < 2) return 0;
        components.sort(function (a, b) { return a.length - b.length; });
        var gusset = components[0];
        var panel = components[components.length - 1];
        if (gusset.length < 12 || gusset.length > panel.length) return 0;
        var gussetY = 0;
        var panelY = 0;
        for (var i = 0; i < gusset.length; i += 1) gussetY += positions[gusset[i] * 3 + 1];
        for (var j = 0; j < panel.length; j += 1) panelY += positions[panel[j] * 3 + 1];
        // The gusset is the island under the panels, not a second copy of them.
        if (gussetY / gusset.length > panelY / panel.length) return 0;

        var order = gusset.slice().sort(function (a, b) {
            return positions[a * 3 + 2] - positions[b * 3 + 2];
        });
        var rows = [[order[0]]];
        for (var k = 1; k < order.length; k += 1) {
            var dz = positions[order[k] * 3 + 2] - positions[order[k - 1] * 3 + 2];
            if (dz > GUSSET_ROW_GAP_M) rows.push([]);
            rows[rows.length - 1].push(order[k]);
        }
        if (rows.length < 3) return 0;
        var first = _spanX(positions, rows[0]);
        var last = _spanX(positions, rows[rows.length - 1]);
        if (Math.min(first, last) < GUSSET_SEAM_M) return 0;
        var cap = Math.min(first, last, GUSSET_ON_MOUND_M);
        var opened = 0;
        for (var r = 1; r < rows.length - 1; r += 1) {
            var have = _spanX(positions, rows[r]);
            if (have < GUSSET_COLLAPSED_M || have >= cap) continue;
            var centre = 0;
            for (var c = 0; c < rows[r].length; c += 1) centre += positions[rows[r][c] * 3];
            centre /= rows[r].length;
            var scale = cap / have;
            for (var c2 = 0; c2 < rows[r].length; c2 += 1) {
                var at = rows[r][c2] * 3;
                positions[at] = centre + (positions[at] - centre) * scale;
            }
            opened += 1;
        }
        return opened;
    }

    // The mound panel. Sitting wide leaves the front of the mound bare under
    // the leg opening: the cloth stays on the hips while that skin swings
    // forward. A sheet of new triangles sits just in front of that skin.
    // The skinned brief is not rewritten and not hidden.
    var MOUND_SIZE = 168;
    var MOUND_CLEAR_M = 0.005;
    var MOUND_FOV = 26 * Math.PI / 180;

    function _dot(ax, ay, az, bx, by, bz) {
        return ax * bx + ay * by + az * bz;
    }

    function _norm(x, y, z) {
        var L = Math.hypot(x, y, z) || 1;
        return [x / L, y / L, z / L];
    }

    function _cross(a, b) {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ];
    }

    /**
     * Cloth over the mound skin the brief does not cover from the front.
     * Positions are posed, in the same space as `eye`. Returns the panel
     * vertices and triangles, or null when the brief already covers her.
     */
    function moundPanel(input) {
        var skin = input.skin;
        var skinFaces = input.skinFaces;
        var brief = input.brief;
        var briefFaces = input.briefFaces;
        var hips = input.hips;
        var front = _norm(input.front[0], input.front[1], input.front[2]);
        var up = _norm(input.up[0], input.up[1], input.up[2]);
        var rightC = _cross(front, up);
        var rightL = Math.hypot(rightC[0], rightC[1], rightC[2]);
        if (rightL < 1e-6) return null;
        var right = [rightC[0] / rightL, rightC[1] / rightL, rightC[2] / rightL];
        var eye = input.eye;
        var target = input.target;
        var forward = _norm(target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]);
        var camC = _cross(forward, up);
        var camL = Math.hypot(camC[0], camC[1], camC[2]);
        if (camL < 1e-6) return null;
        var camRight = [camC[0] / camL, camC[1] / camL, camC[2] / camL];
        var camUp = _cross(camRight, forward);
        var span = 2 * Math.tan(MOUND_FOV / 2);
        var size = MOUND_SIZE;

        function at(buf, i) {
            return [buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]];
        }
        function localOf(p) {
            var dx = p[0] - hips[0];
            var dy = p[1] - hips[1];
            var dz = p[2] - hips[2];
            return [
                _dot(dx, dy, dz, right[0], right[1], right[2]),
                _dot(dx, dy, dz, up[0], up[1], up[2]),
                _dot(dx, dy, dz, front[0], front[1], front[2]),
            ];
        }
        function project(p) {
            var dx = p[0] - eye[0];
            var dy = p[1] - eye[1];
            var dz = p[2] - eye[2];
            var z = _dot(dx, dy, dz, forward[0], forward[1], forward[2]);
            var x = _dot(dx, dy, dz, camRight[0], camRight[1], camRight[2]);
            var y = _dot(dx, dy, dz, camUp[0], camUp[1], camUp[2]);
            var inv = z > 1e-4 ? 1 / z : 0;
            return [(x * inv / span + 0.5) * size, (0.5 - y * inv / span) * size, z];
        }
        function inLap(p) {
            var L = localOf(p);
            return Math.abs(L[0]) < 0.16 && L[1] > -0.22 && L[1] < 0.08 && L[2] > -0.06 && L[2] < 0.16;
        }

        var zbuf = new Float32Array(size * size);
        var who = new Uint8Array(size * size);
        var posx = new Float32Array(size * size);
        var posy = new Float32Array(size * size);
        var posz = new Float32Array(size * size);
        for (var i = 0; i < zbuf.length; i += 1) zbuf[i] = Infinity;

        function draw(buf, faces, tag) {
            var nFaces = faces.length / 3;
            for (var f = 0; f < nFaces; f += 1) {
                var ia = faces[f * 3];
                var ib = faces[f * 3 + 1];
                var ic = faces[f * 3 + 2];
                var A = at(buf, ia);
                var B = at(buf, ib);
                var C = at(buf, ic);
                if (!inLap(A) && !inLap(B) && !inLap(C)) continue;
                var pa = project(A);
                var pb = project(B);
                var pc = project(C);
                if (pa[2] < 0.05 || pb[2] < 0.05 || pc[2] < 0.05) continue;
                var x0 = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0])));
                var x1 = Math.min(size - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0])));
                var y0 = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1])));
                var y1 = Math.min(size - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1])));
                if (x1 < x0 || y1 < y0 || (x1 - x0 + 1) * (y1 - y0 + 1) > 8000) continue;
                var v0x = pb[0] - pa[0];
                var v0y = pb[1] - pa[1];
                var v1x = pc[0] - pa[0];
                var v1y = pc[1] - pa[1];
                var den = v0x * v1y - v1x * v0y;
                if (Math.abs(den) < 1e-6) continue;
                for (var y = y0; y <= y1; y += 1) {
                    for (var x = x0; x <= x1; x += 1) {
                        var v2x = x + 0.5 - pa[0];
                        var v2y = y + 0.5 - pa[1];
                        var w1 = (v2x * v1y - v1x * v2y) / den;
                        var w2 = (v0x * v2y - v2x * v0y) / den;
                        var w0 = 1 - w1 - w2;
                        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                        var zz = w0 * pa[2] + w1 * pb[2] + w2 * pc[2];
                        var pix = y * size + x;
                        if (zz >= zbuf[pix]) continue;
                        zbuf[pix] = zz;
                        who[pix] = tag;
                        posx[pix] = w0 * A[0] + w1 * B[0] + w2 * C[0];
                        posy[pix] = w0 * A[1] + w1 * B[1] + w2 * C[1];
                        posz[pix] = w0 * A[2] + w1 * B[2] + w2 * C[2];
                    }
                }
            }
        }

        draw(brief, briefFaces, 2);
        draw(skin, skinFaces, 1);

        var bare = [];
        for (var p = 0; p < who.length; p += 1) {
            if (who[p] !== 1) continue;
            var point = [posx[p], posy[p], posz[p]];
            var L = localOf(point);
            // On the mound, below the waistband. A fold just behind the
            // hip plane is still this surface: the front camera sees it
            // in the notch, so it has to be cloth too.
            if (Math.abs(L[0]) < 0.052 && L[1] > -0.108 && L[1] < -0.016 && L[2] > -0.020 && L[2] < 0.12) {
                bare.push(point);
            }
        }
        if (bare.length < 24) return null;

        var bsx = [];
        var bsy = [];
        for (var b = 0; b < bare.length; b += 1) {
            var pr = project(bare[b]);
            bsx.push(pr[0]);
            bsy.push(pr[1]);
        }
        function minOf(a) { var m = a[0]; for (var k = 1; k < a.length; k += 1) if (a[k] < m) m = a[k]; return m; }
        function maxOf(a) { var m = a[0]; for (var k = 1; k < a.length; k += 1) if (a[k] > m) m = a[k]; return m; }
        var pad = 10;
        var gx0 = Math.floor(minOf(bsx)) - pad;
        var gx1 = Math.ceil(maxOf(bsx)) + pad;
        var gy0 = Math.floor(minOf(bsy)) - pad;
        var gy1 = Math.ceil(maxOf(bsy)) + 12;

        // Skin-only hits. Each grid vertex is placed on the skin under that
        // pixel, a few millimetres toward the eye. A thigh in front of the
        // mound is closer than every bare sample and is left out, so it
        // cannot drag the sheet off the body.
        zbuf = new Float32Array(size * size);
        who = new Uint8Array(size * size);
        posx = new Float32Array(size * size);
        posy = new Float32Array(size * size);
        posz = new Float32Array(size * size);
        for (var z = 0; z < zbuf.length; z += 1) zbuf[z] = Infinity;
        draw(skin, skinFaces, 1);

        var COLS = 21;
        var ROWS = 12;
        var bareZ = [];
        for (var bz = 0; bz < bare.length; bz += 1) bareZ.push(project(bare[bz])[2]);
        bareZ.sort(function (a, b) { return a - b; });
        var minBareZ = bareZ[0];

        function onRay(sx, sy, depth) {
            var nx = (sx / size - 0.5) * span;
            var ny = (0.5 - sy / size) * span;
            var t = Math.max(depth - MOUND_CLEAR_M, 0.05);
            return [
                eye[0] + (forward[0] + camRight[0] * nx + camUp[0] * ny) * t,
                eye[1] + (forward[1] + camRight[1] * nx + camUp[1] * ny) * t,
                eye[2] + (forward[2] + camRight[2] * nx + camUp[2] * ny) * t,
            ];
        }
        function eyeDist(p) {
            return Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
        }
        function skinUnder(sx, sy) {
            var ix = Math.max(0, Math.min(size - 1, Math.round(sx)));
            var iy = Math.max(0, Math.min(size - 1, Math.round(sy)));
            for (var rad = 0; rad <= 6; rad += 1) {
                var best = null;
                var bestD = Infinity;
                var yA = Math.max(0, iy - rad);
                var yB = Math.min(size - 1, iy + rad);
                var xA = Math.max(0, ix - rad);
                var xB = Math.min(size - 1, ix + rad);
                for (var yy = yA; yy <= yB; yy += 1) {
                    var yEdge = rad > 0 && yy !== yA && yy !== yB;
                    for (var xx = xA; xx <= xB; xx += 1) {
                        if (yEdge && xx !== xA && xx !== xB) continue;
                        var id = yy * size + xx;
                        if (who[id] !== 1) continue;
                        if (zbuf[id] < minBareZ - 0.008) continue;
                        var point = [posx[id], posy[id], posz[id]];
                        var Lp = localOf(point);
                        if (Math.abs(Lp[0]) > 0.07 || Lp[1] < -0.13 || Lp[1] > 0.02 || Lp[2] < -0.03 || Lp[2] > 0.16) continue;
                        var dist = eyeDist(point);
                        if (dist < bestD) {
                            best = point;
                            bestD = dist;
                        }
                    }
                }
                if (best) return best;
            }
            return null;
        }

        var xs = [];
        var ys = [];
        for (var c = 0; c < COLS; c += 1) xs.push(gx0 + (gx1 - gx0) * (c / (COLS - 1)));
        for (var r = 0; r < ROWS; r += 1) ys.push(gy0 + (gy1 - gy0) * (r / (ROWS - 1)));
        var depth = [];
        var known = 0;
        for (var c1 = 0; c1 < COLS; c1 += 1) {
            var colD = [];
            for (var r1 = 0; r1 < ROWS; r1 += 1) {
                var hit = skinUnder(xs[c1], ys[r1]);
                var hz = hit ? project(hit)[2] : null;
                if (hz != null) known += 1;
                colD.push(hz);
            }
            depth.push(colD);
        }
        if (!known) return null;
        // A bare sample closer than its cell pulls that cell forward. The
        // vertex stays on its own ray, so the sheet cannot fold open.
        var cellW = Math.max((gx1 - gx0) / Math.max(COLS - 1, 1), (gy1 - gy0) / Math.max(ROWS - 1, 1));
        var reach2 = cellW * cellW * 1.6;
        for (var bi = 0; bi < bare.length; bi += 1) {
            var bp = project(bare[bi]);
            var bestC = 0;
            var bestR = 0;
            var bestS = Infinity;
            for (var sc = 0; sc < COLS; sc += 1) {
                var dxs = xs[sc] - bp[0];
                for (var sr = 0; sr < ROWS; sr += 1) {
                    var dys = ys[sr] - bp[1];
                    var sd = dxs * dxs + dys * dys;
                    if (sd < bestS) {
                        bestS = sd;
                        bestC = sc;
                        bestR = sr;
                    }
                }
            }
            if (bestS > reach2) continue;
            if (depth[bestC][bestR] == null || bp[2] < depth[bestC][bestR]) depth[bestC][bestR] = bp[2];
        }
        // A valley between two closer sides is pulled up to the chord, so
        // the notch stays cloth instead of a crack you can see through.
        for (var pass = 0; pass < 2; pass += 1) {
            for (var fr = 0; fr < ROWS; fr += 1) {
                for (var fc = 1; fc < COLS - 1; fc += 1) {
                    if (depth[fc][fr] == null) continue;
                    var leftD = null;
                    var leftStep = 0;
                    var rightD = null;
                    var rightStep = 0;
                    for (var step = 1; step < COLS; step += 1) {
                        if (leftD == null && fc - step >= 0 && depth[fc - step][fr] != null && depth[fc - step][fr] < depth[fc][fr]) {
                            leftD = depth[fc - step][fr];
                            leftStep = step;
                        }
                        if (rightD == null && fc + step < COLS && depth[fc + step][fr] != null && depth[fc + step][fr] < depth[fc][fr]) {
                            rightD = depth[fc + step][fr];
                            rightStep = step;
                        }
                        if (leftD != null && rightD != null) break;
                    }
                    if (leftD == null || rightD == null) continue;
                    var chord = leftD + (rightD - leftD) * (leftStep / (leftStep + rightStep));
                    if (depth[fc][fr] > chord) depth[fc][fr] = chord;
                }
            }
        }
        function bridgeDepth(col, row) {
            var leftD = null;
            var leftStep = 0;
            var rightD = null;
            var rightStep = 0;
            for (var step = 1; step < COLS; step += 1) {
                if (leftD == null && col - step >= 0 && depth[col - step][row] != null) {
                    leftD = depth[col - step][row];
                    leftStep = step;
                }
                if (rightD == null && col + step < COLS && depth[col + step][row] != null) {
                    rightD = depth[col + step][row];
                    rightStep = step;
                }
                if (leftD != null && rightD != null) break;
            }
            if (leftD != null && rightD != null) return leftD + (rightD - leftD) * (leftStep / (leftStep + rightStep));
            if (leftD != null) return leftD;
            if (rightD != null) return rightD;
            for (var vr = 0; vr < ROWS; vr += 1) {
                if (depth[col][vr] != null) return depth[col][vr];
            }
            return minBareZ;
        }
        var grid = [];
        for (var c2 = 0; c2 < COLS; c2 += 1) {
            var col = [];
            for (var r2 = 0; r2 < ROWS; r2 += 1) {
                var dz = depth[c2][r2];
                if (dz == null) dz = bridgeDepth(c2, r2);
                col.push(onRay(xs[c2], ys[r2], dz));
            }
            grid.push(col);
        }
        // The centre of the notch faces downward. Drop that cloth a few
        // millimetres toward the underside so the fold stays covered.
        for (var tc = 0; tc < COLS; tc += 1) {
            for (var tr = 0; tr < ROWS; tr += 1) {
                var tuck = grid[tc][tr];
                var Lt = localOf(tuck);
                if (Math.abs(Lt[0]) > 0.028 || Lt[1] < -0.096 || Lt[1] > -0.055) continue;
                tuck[1] -= 0.005;
                tuck[2] += front[2] * 0.004;
            }
        }

        var positions = new Float32Array(COLS * ROWS * 3);
        for (var cc = 0; cc < COLS; cc += 1) {
            for (var rr = 0; rr < ROWS; rr += 1) {
                var o = (cc * ROWS + rr) * 3;
                positions[o] = grid[cc][rr][0];
                positions[o + 1] = grid[cc][rr][1];
                positions[o + 2] = grid[cc][rr][2];
            }
        }
        var indices = [];
        function vid(col, row) { return col * ROWS + row; }
        for (var c2 = 0; c2 < COLS - 1; c2 += 1) {
            for (var r2 = 0; r2 < ROWS - 1; r2 += 1) {
                var a = vid(c2, r2);
                var b = vid(c2 + 1, r2);
                var d = vid(c2, r2 + 1);
                var e = vid(c2 + 1, r2 + 1);
                indices.push(a, b, e, a, e, d);
            }
        }
        return { positions: positions, indices: new Uint32Array(indices) };
    }

    var api = {
        CLEARANCE_M: CLEARANCE_M,
        STRETCH_LIMIT: STRETCH_LIMIT,
        GUSSET_ON_MOUND_M: GUSSET_ON_MOUND_M,
        MOUND_CLEAR_M: MOUND_CLEAR_M,
        correct: correct,
        maxEdgeStretch: maxEdgeStretch,
        isBodyName: isBodyName,
        widenCollapsedGusset: widenCollapsedGusset,
        moundPanel: moundPanel,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_POSE_GARMENT_CORRECTION = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
