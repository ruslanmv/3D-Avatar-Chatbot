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
            t =
                ((point[0] - capsule.ax) * abx + (point[1] - capsule.ay) * aby + (point[2] - capsule.az) * abz) /
                length2;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
        }
        return [capsule.ax + abx * t, capsule.ay + aby * t, capsule.az + abz * t];
    }

    /**
     * Metres a centre-front hem must stay outside the brief or the pelvis.
     * This replaces the 0.9 rise fraction: the brief stays visible because the
     * hem stops short of it, and the side hem is not in the index list.
     */
    var BRIEF_GAP = 0.02;

    /**
     * Push dynamic particles out of every capsule. ``state.x`` is xyz triples.
     * ``state.inv`` is 0 for a particle that stays on the skeleton.
     * ``only`` limits the pass to those indices. Every contact is stored, then
     * the particle moves by the average, so two thighs do not take turns.
     * Returns how many particles moved.
     */
    function pushOut(state, capsules, thickness, only) {
        var gap = thickness || 0;
        var count = state.inv.length;
        var correction = new Float32Array(count * 3);
        var hits = new Uint16Array(count);
        var moved = 0;
        for (var c = 0; c < capsules.length; c += 1) {
            var shape = capsules[c];
            var limit = shape.radius + gap;
            for (var i = 0; i < count; i += 1) {
                if (state.inv[i] === 0) continue;
                if (only && !only[i]) continue;
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

    function collide(state, capsules, thickness) {
        return pushOut(state, capsules, thickness == null ? 0.001 : thickness, null);
    }

    /**
     * A hem particle that is inside a thigh capsule stops on the outside.
     * ``hem`` is particle indices. Other particles, including a side hem that
     * was left out of the list, are not moved. Two capsules still average.
     */
    function lap(state, capsules, hem, thickness) {
        var only = [];
        var list = hem || [];
        for (var h = 0; h < list.length; h += 1) only[list[h]] = 1;
        var thighs = [];
        for (var c = 0; c < capsules.length; c += 1) {
            var role = capsules[c].role;
            if (role && role !== 'thigh') continue;
            thighs.push(capsules[c]);
        }
        return pushOut(state, thighs, thickness || 0, only);
    }

    /**
     * Keep the centre-front hem in front of the brief. ``centre`` is the only
     * indices this may move, along the capsule normal, so a side hem is not
     * lowered through the thigh to open the centre.
     */
    function clearBrief(state, capsule, centre, gap) {
        if (!capsule || !centre || !centre.length) return 0;
        var clearance = gap == null ? BRIEF_GAP : gap;
        var shape = capsule;
        shape = {
            ax: capsule.ax,
            ay: capsule.ay,
            az: capsule.az,
            bx: capsule.bx,
            by: capsule.by,
            bz: capsule.bz,
            radius: capsule.radius,
        };
        var only = [];
        for (var i = 0; i < centre.length; i += 1) only[centre[i]] = 1;
        var before = new Float32Array(state.x);
        var moved = pushOut(state, [shape], clearance, only);
        for (var j = 0; j < centre.length; j += 1) {
            var index = centre[j];
            if (!only[index]) continue;
            // The obstacle pushes out. It does not drop the hem onto the thigh.
            if (state.x[index * 3 + 1] < before[index * 3 + 1]) state.x[index * 3 + 1] = before[index * 3 + 1];
        }
        return moved;
    }

    return {
        BRIEF_GAP: BRIEF_GAP,
        capsule: capsule,
        closest: closest,
        collide: collide,
        lap: lap,
        clearBrief: clearBrief,
    };
});
