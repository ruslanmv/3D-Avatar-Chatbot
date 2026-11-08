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
            var choice = NEXUS_GARMENT_DEFORMATION.solverFor(job.summary || { simulation: 'xpbd', schema: 'wardrobe.cloth/1' }, 'xpbd');
            if (choice !== 'xpbd') {
                self.postMessage({ id: job.id, ok: false, why: 'asset is not an xpbd cloth garment' });
                return;
            }
            var asset = NEXUS_CLOTH_ASSET.decode(new Uint8Array(job.asset));
            var state = NEXUS_CLOTH_SIMULATION.create(asset, job.options || {});
            var frames = job.frames || 1;
            var dt = job.dt || 1 / 60;
            for (var frame = 0; frame < frames; frame += 1) {
                NEXUS_CLOTH_SIMULATION.step(state, dt, {
                    gravity: job.gravity,
                    capsules: job.capsules || [],
                    thickness: job.thickness,
                    collide: NEXUS_BODY_COLLISION.collide,
                });
            }
            self.postMessage({
                id: job.id,
                ok: true,
                positions: state.x,
                strain: NEXUS_CLOTH_SIMULATION.maxStrain(state),
            }, [state.x.buffer]);
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
