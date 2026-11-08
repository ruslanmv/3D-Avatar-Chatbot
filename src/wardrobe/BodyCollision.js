/**
 * Bone capsules for cloth. A particle collects every contact, then moves once
 * by the average push, so two thighs do not take turns shoving it back inside.
 */
(function (global, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_BODY_COLLISION = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null, function () {
    function capsule(ax, ay, az, bx, by, bz, radius) {
        return { ax: ax, ay: ay, az: az, bx: bx, by: by, bz: bz, radius: radius };
    }

    function closest(point, capsule) {
        var abx = capsule.bx - capsule.ax;
        var aby = capsule.by - capsule.ay;
        var abz = capsule.bz - capsule.az;
        var length2 = abx * abx + aby * aby + abz * abz;
        var t = 0;
        if (length2 > 1e-12) {
            t = ((point[0] - capsule.ax) * abx + (point[1] - capsule.ay) * aby + (point[2] - capsule.az) * abz) / length2;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
        }
        return [capsule.ax + abx * t, capsule.ay + aby * t, capsule.az + abz * t];
    }

    /**
     * Push dynamic particles out of every capsule. ``state.x`` is xyz triples.
     * ``state.inv`` is 0 for a particle that stays on the skeleton.
     * Returns how many particles moved.
     */
    function collide(state, capsules, thickness) {
        var gap = thickness || 0.001;
        var count = state.inv.length;
        var correction = new Float32Array(count * 3);
        var hits = new Uint16Array(count);
        var moved = 0;
        for (var c = 0; c < capsules.length; c += 1) {
            var shape = capsules[c];
            var limit = shape.radius + gap;
            for (var i = 0; i < count; i += 1) {
                if (state.inv[i] === 0) continue;
                var point = [state.x[i * 3], state.x[i * 3 + 1], state.x[i * 3 + 2]];
                var near = closest(point, shape);
                var dx = point[0] - near[0];
                var dy = point[1] - near[1];
                var dz = point[2] - near[2];
                var dist = Math.hypot(dx, dy, dz);
                if (dist >= limit) continue;
                var nx = 0;
                var ny = 1;
                var nz = 0;
                if (dist > 1e-8) {
                    nx = dx / dist;
                    ny = dy / dist;
                    nz = dz / dist;
                }
                var push = limit - dist;
                correction[i * 3] += nx * push;
                correction[i * 3 + 1] += ny * push;
                correction[i * 3 + 2] += nz * push;
                hits[i] += 1;
            }
        }
        for (var j = 0; j < count; j += 1) {
            if (!hits[j]) continue;
            state.x[j * 3] += correction[j * 3] / hits[j];
            state.x[j * 3 + 1] += correction[j * 3 + 1] / hits[j];
            state.x[j * 3 + 2] += correction[j * 3 + 2] / hits[j];
            moved += 1;
        }
        return moved;
    }


    /**
     * A lap contact is one-sided: a skirt hem cannot tunnel to the lower
     * hemisphere of a seated thigh. Only explicitly tagged, near-horizontal
     * thigh capsules participate. Contacts are averaged, like collide().
     * This is not a screen-space hem lift or a standing-cut target.
     */
    function collideLap(state, capsules, hemMask, thickness) {
        if (!hemMask) return 0;
        var count = state.inv.length;
        var sum = new Float32Array(count);
        var hits = new Uint16Array(count);
        var clearance = thickness == null ? 0.001 : thickness;
        for (var c = 0; c < capsules.length; c += 1) {
            var shape = capsules[c];
            if (!shape.lap) continue;
            var vx = shape.bx - shape.ax;
            var vy = shape.by - shape.ay;
            var vz = shape.bz - shape.az;
            if (Math.abs(vy) > Math.hypot(vx, vz) * 0.85) continue; // standing thigh
            var radius = shape.radius + clearance;
            for (var i = 0; i < count; i += 1) {
                if (!hemMask[i] || state.inv[i] === 0) continue;
                var at = i * 3;
                var point = [state.x[at], state.x[at + 1], state.x[at + 2]];
                var near = closest(point, shape);
                var dx = point[0] - near[0];
                var dz = point[2] - near[2];
                var horizontal2 = dx * dx + dz * dz;
                if (horizontal2 >= radius * radius) continue;
                var top = near[1] + Math.sqrt(Math.max(0, radius * radius - horizontal2));
                if (point[1] >= top) continue;
                // Reject distant lower-body geometry, not a local contact.
                if (point[1] < near[1] - radius - 0.02) continue;
                sum[i] += top - point[1];
                hits[i] += 1;
            }
        }
        var moved = 0;
        for (var j = 0; j < count; j += 1) {
            if (!hits[j]) continue;
            state.x[j * 3 + 1] += sum[j] / hits[j];
            moved += 1;
        }
        return moved;
    }

    /**
     * Keep at least the lower strip of the briefs below the centre-front hem.
     * The obstacle is derived from a posed brief mesh; no hole is cut and no
     * percentage of a skinning rise is used. Side hem is not constrained here.
     */
    function clearBriefs(state, brief, centreHemMask, gap) {
        if (!brief || !centreHemMask || !Number.isFinite(brief.minY)) return 0;
        var minimum = brief.minY + (gap == null ? 0.012 : gap);
        var moved = 0;
        for (var i = 0; i < state.inv.length; i += 1) {
            if (!centreHemMask[i] || !state.inv[i]) continue;
            var y = i * 3 + 1;
            if (state.x[y] >= minimum) continue;
            state.x[y] = minimum;
            moved += 1;
        }
        return moved;
    }

    return { capsule: capsule, closest: closest, collide: collide, collideLap: collideLap, clearBriefs: clearBriefs };
});
