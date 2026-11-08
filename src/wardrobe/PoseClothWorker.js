/**
 * SW1. The posed cloth correction, off the main thread.
 *
 * Correcting a look's garments after a pose takes about two seconds of arithmetic; on the page
 * that is two seconds of a frozen viewer. Here it runs beside the page: the corrector posts the
 * skinned positions in, this answers with the corrected ones and the before/after numbers.
 * A classic worker, so it loads the same IIFE the tests require, with no build step.
 */
/* global importScripts, NEXUS_POSE_CLOTH_CORRECTION */
importScripts('PoseClothCorrection.js');

function ensureXpbd() {
    if (self.NEXUS_CLOTH_SIMULATION) return;
    importScripts('ClothAsset.js', 'BodyCollision.js', 'ClothSimulation.js', 'GarmentDeformation.js');
}

self.onmessage = function (event) {
    var job = event.data || {};
    if (job.solver === 'xpbd') {
        try {
            ensureXpbd();
            var choice = NEXUS_GARMENT_DEFORMATION.solverFor(job.summary, 'xpbd');
            if (choice !== 'xpbd') {
                self.postMessage({ id: job.id, ok: false, why: 'asset is not an xpbd skirt' });
                return;
            }
            var asset = NEXUS_CLOTH_ASSET.decode(new Uint8Array(job.asset));
            if (!job.initial || job.initial.length !== asset.positions.length) {
                throw new Error('missing world-space particle initialization');
            }
            if (!job.summary || asset.binding.length !== job.summary.renderVertices) {
                throw new Error('render binding does not match asset summary');
            }
            var state = NEXUS_CLOTH_SIMULATION.create(asset, {
                initial: job.initial,
                hemMask: job.hemMask,
                centreHemMask: job.centreHemMask,
                substeps: job.substeps || 2,
                iterations: job.iterations || 6,
            });
            var frames = Math.max(1, Math.min(60, job.frames || 1));
            var dt = job.dt || 1 / 60;
            for (var frame = 0; frame < frames; frame += 1) {
                NEXUS_CLOTH_SIMULATION.step(state, dt, {
                    gravity: job.gravity,
                    capsules: job.capsules || [],
                    thickness: job.thickness,
                    brief: job.brief || null,
                    briefGap: job.briefGap,
                    damping: job.summary.damping,
                    stretchCompliance: job.summary.stretchCompliance,
                    shearCompliance: job.summary.shearCompliance,
                    bendCompliance: job.summary.bendCompliance,
                    collide: NEXUS_BODY_COLLISION.collide,
                });
            }
            // WCL1 maps every render vertex to one or more simulation particles.
            // Return posed, WORLD-space render positions for inverse skinning.
            var render = new Float32Array(asset.binding.length * 3);
            for (var i = 0; i < asset.binding.length; i += 1) {
                var binding = asset.binding[i];
                var indices = [binding.i0, binding.i1, binding.i2];
                var weights = [binding.w0, binding.w1, binding.w2];
                for (var k = 0; k < 3; k += 1) {
                    for (var axis = 0; axis < 3; axis += 1) {
                        render[i * 3 + axis] += weights[k] * state.x[indices[k] * 3 + axis];
                    }
                }
            }
            self.postMessage({
                id: job.id, ok: true, positions: render,
                strain: NEXUS_CLOTH_SIMULATION.maxStrain(state),
                contacts: state.frames,
            }, [render.buffer]);
        } catch (error) {
            self.postMessage({ id: job.id, ok: false, why: String((error && error.message) || error) });
        }
        return;
    }
    try {
        var result = NEXUS_POSE_CLOTH_CORRECTION.correct(job.input);
        var transfer = [];
        var garments = result.garments.map(function (g) {
            transfer.push(g.positions.buffer);
            return { name: g.name, positions: g.positions, before: g.before, after: g.after };
        });
        self.postMessage({ id: job.id, ok: true, garments: garments }, transfer);
    } catch (error) {
        self.postMessage({ id: job.id, ok: false, why: String((error && error.message) || error) });
    }
};
