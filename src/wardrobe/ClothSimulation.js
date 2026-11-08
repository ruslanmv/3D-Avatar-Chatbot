/**
 * A persistent XPBD cloth step (Macklin, Müller, Chentanez 2016).
 *
 * State lives across frames: positions, velocities, and constraint multipliers.
 * It does not read the pose name and it does not call the seated-hem corrector.
 * A particle with attachment weight at or above 0.999 is kinematic.
 */
(function (global, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_CLOTH_SIMULATION = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null, function () {
    var Body = typeof require === 'function' ? require('./BodyCollision.js') :
        typeof self !== 'undefined' ? self.NEXUS_BODY_COLLISION : null;

    function create(asset, options) {
        options = options || {};
        var count = asset.positions.length / 3;
        var inverse = new Float32Array(count);
        for (var index = 0; index < count; index += 1) {
            inverse[index] = asset.attachment[index] >= 0.999 ? 0 : 1;
        }
        return {
            asset: asset,
            x: new Float32Array(options.initial || asset.positions),
            v: new Float32Array(count * 3),
            previous: new Float32Array(options.initial || asset.positions),
            inv: inverse,
            rest: new Float32Array(asset.positions),
            substeps: options.substeps || 4,
            iterations: options.iterations || 4,
            sleeping: false,
            frames: 0,
            hemMask: options.hemMask || null,
            centreHemMask: options.centreHemMask || null,
        };
    }

    function reset(state) {
        state.x.set(state.rest);
        state.v.fill(0);
        state.previous.set(state.rest);
        clearMultipliers(state.asset.stretch);
        clearMultipliers(state.asset.shear);
        clearMultipliers(state.asset.bend);
        state.sleeping = false;
        state.frames = 0;
    }

    function clearMultipliers(list) {
        if (!list) return;
        for (var index = 0; index < list.length; index += 1) list[index].lambda = 0;
    }

    function solvePairs(state, list, step, compliance) {
        if (!list || !list.length) return;
        var alpha = compliance / (step * step);
        var x = state.x;
        var inv = state.inv;
        for (var index = 0; index < list.length; index += 1) {
            var constraint = list[index];
            var ia = constraint.a;
            var ib = constraint.b;
            var ax = x[ia * 3] - x[ib * 3];
            var ay = x[ia * 3 + 1] - x[ib * 3 + 1];
            var az = x[ia * 3 + 2] - x[ib * 3 + 2];
            var length = Math.hypot(ax, ay, az);
            var nx = 0;
            var ny = 1;
            var nz = 0;
            if (length >= 1e-8) {
                nx = ax / length;
                ny = ay / length;
                nz = az / length;
            }
            var weight = inv[ia] + inv[ib];
            var delta = (-(length - constraint.rest) - alpha * constraint.lambda) / (weight + alpha);
            constraint.lambda += delta;
            x[ia * 3] += inv[ia] * delta * nx;
            x[ia * 3 + 1] += inv[ia] * delta * ny;
            x[ia * 3 + 2] += inv[ia] * delta * nz;
            x[ib * 3] -= inv[ib] * delta * nx;
            x[ib * 3 + 1] -= inv[ib] * delta * ny;
            x[ib * 3 + 2] -= inv[ib] * delta * nz;
        }
    }

    function solveShear(state, list, step, compliance) {
        if (!list || !list.length) return;
        var alpha = compliance / (step * step);
        var x = state.x;
        var inv = state.inv;
        for (var index = 0; index < list.length; index += 1) {
            var constraint = list[index];
            var ia = constraint.a;
            var ib = constraint.b;
            var ic = constraint.c;
            var mx = (x[ia * 3] + x[ib * 3]) * 0.5;
            var my = (x[ia * 3 + 1] + x[ib * 3 + 1]) * 0.5;
            var mz = (x[ia * 3 + 2] + x[ib * 3 + 2]) * 0.5;
            var dx = x[ic * 3] - mx;
            var dy = x[ic * 3 + 1] - my;
            var dz = x[ic * 3 + 2] - mz;
            var length = Math.hypot(dx, dy, dz);
            if (length < 1e-8) continue;
            var nx = dx / length;
            var ny = dy / length;
            var nz = dz / length;
            var weight = inv[ic] + inv[ia] * 0.25 + inv[ib] * 0.25;
            var delta = (-(length - constraint.rest) - alpha * constraint.lambda) / (weight + alpha);
            constraint.lambda += delta;
            x[ic * 3] += inv[ic] * delta * nx;
            x[ic * 3 + 1] += inv[ic] * delta * ny;
            x[ic * 3 + 2] += inv[ic] * delta * nz;
            var halfA = inv[ia] * delta * 0.5;
            var halfB = inv[ib] * delta * 0.5;
            x[ia * 3] -= halfA * nx;
            x[ia * 3 + 1] -= halfA * ny;
            x[ia * 3 + 2] -= halfA * nz;
            x[ib * 3] -= halfB * nx;
            x[ib * 3 + 1] -= halfB * ny;
            x[ib * 3 + 2] -= halfB * nz;
        }
    }

    /**
     * One frame. ``options.capsules`` are body capsules. ``options.gravity`` is
     * metres per second squared on Y. Returns a small report, not a pass/fail.
     */
    function step(state, dt, options) {
        options = options || {};
        var gravity = options.gravity == null ? -9.81 : options.gravity;
        var damping = options.damping == null ? 0.02 : options.damping;
        var keep = Math.max(0, 1 - damping);
        var collide = options.collide || (Body && Body.collide);
        var stepDt = dt / state.substeps;
        var moved = 0;
        state.sleeping = false;
        for (var sub = 0; sub < state.substeps; sub += 1) {
            clearMultipliers(state.asset.stretch);
            clearMultipliers(state.asset.shear);
            clearMultipliers(state.asset.bend);
            state.previous.set(state.x);
            for (var i = 0; i < state.inv.length; i += 1) {
                if (state.inv[i] === 0) continue;
                state.v[i * 3 + 1] += gravity * stepDt;
                state.v[i * 3] *= keep;
                state.v[i * 3 + 1] *= keep;
                state.v[i * 3 + 2] *= keep;
                state.x[i * 3] += state.v[i * 3] * stepDt;
                state.x[i * 3 + 1] += state.v[i * 3 + 1] * stepDt;
                state.x[i * 3 + 2] += state.v[i * 3 + 2] * stepDt;
            }
            for (var iteration = 0; iteration < state.iterations; iteration += 1) {
                solvePairs(state, state.asset.stretch, stepDt, options.stretchCompliance || 1e-6);
                solveShear(state, state.asset.shear, stepDt, options.shearCompliance || 1e-6);
                solvePairs(state, state.asset.bend, stepDt, options.bendCompliance || 1e-4);
                if (collide && options.capsules && options.capsules.length) {
                    moved += collide(state, options.capsules, options.thickness || 0.001);
                    if (Body && Body.collideLap) {
                        moved += Body.collideLap(state, options.capsules, state.hemMask, options.thickness);
                    }
                }
                if (Body && Body.clearBriefs && options.brief) {
                    moved += Body.clearBriefs(state, options.brief, state.centreHemMask, options.briefGap);
                }
            }
            var invDt = 1 / stepDt;
            for (var j = 0; j < state.inv.length; j += 1) {
                if (state.inv[j] === 0) {
                    state.v[j * 3] = 0;
                    state.v[j * 3 + 1] = 0;
                    state.v[j * 3 + 2] = 0;
                    continue;
                }
                state.v[j * 3] = (state.x[j * 3] - state.previous[j * 3]) * invDt;
                state.v[j * 3 + 1] = (state.x[j * 3 + 1] - state.previous[j * 3 + 1]) * invDt;
                state.v[j * 3 + 2] = (state.x[j * 3 + 2] - state.previous[j * 3 + 2]) * invDt;
            }
        }
        state.frames += 1;
        return { substeps: state.substeps, iterations: state.iterations, contacts: moved, sleeping: false };
    }

    function maxStrain(state) {
        var worst = 0;
        var list = state.asset.stretch || [];
        for (var index = 0; index < list.length; index += 1) {
            var constraint = list[index];
            var dx = state.x[constraint.a * 3] - state.x[constraint.b * 3];
            var dy = state.x[constraint.a * 3 + 1] - state.x[constraint.b * 3 + 1];
            var dz = state.x[constraint.a * 3 + 2] - state.x[constraint.b * 3 + 2];
            var length = Math.hypot(dx, dy, dz);
            if (constraint.rest > 1e-8) {
                var ratio = length / constraint.rest;
                if (ratio > worst) worst = ratio;
            }
        }
        return worst;
    }

    return { create: create, reset: reset, step: step, maxStrain: maxStrain };
});
