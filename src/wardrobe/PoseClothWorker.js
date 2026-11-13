/**
 * SW1. The posed cloth correction, off the main thread.
 *
 * Correcting a look's garments after a pose takes about two seconds of arithmetic; on the page
 * that is two seconds of a frozen viewer. Here it runs beside the page: the corrector posts the
 * skinned positions in, this answers with the corrected ones and the before/after numbers.
 * A classic worker, so it loads the same IIFE the tests require, with no build step.
 *
 * A message without `solver` is the pose corrector, the same call as before.
 * `solver: "xpbd"` is answered only for the skirts the message lists. Every other
 * garment in that message still goes through the pose corrector.
 */
/* global importScripts, NEXUS_POSE_CLOTH_CORRECTION, NEXUS_CLOTH_SIMULATION, NEXUS_CLOTH_ASSET, NEXUS_BODY_COLLISION, NEXUS_GARMENT_DEFORMATION */
importScripts('PoseClothCorrection.js');

function ensureXpbd() {
    if (self.NEXUS_CLOTH_SIMULATION) return;
    importScripts('ClothAsset.js', 'BodyCollision.js', 'ClothSimulation.js', 'GarmentDeformation.js');
}

function isPayload(bytes) {
    if (!bytes || typeof bytes !== 'object') return false;
    if (bytes.stretch && bytes.positions) return true;
    return bytes instanceof ArrayBuffer || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(bytes));
}

function simulateXpbd(item, skinned) {
    var summary = item.summary || {};
    var choice = NEXUS_GARMENT_DEFORMATION.solverFor(summary, 'xpbd', item.name);
    if (choice !== 'xpbd') return null;
    var bytes = item.asset;
    if (!isPayload(bytes)) return null;
    var asset = bytes.stretch ? bytes : NEXUS_CLOTH_ASSET.decode(bytes);
    var state = NEXUS_CLOTH_SIMULATION.create(asset, item.options || {});
    if (skinned && skinned.length === state.x.length) {
        state.x.set(skinned);
        state.previous.set(skinned);
    }
    var frames = item.frames || 8;
    var dt = item.dt || 1 / 60;
    var hem = item.hem || NEXUS_CLOTH_SIMULATION.hemIndices(asset);
    var centre = item.centre || NEXUS_CLOTH_SIMULATION.centreIndices(asset, hem);
    for (var frame = 0; frame < frames; frame += 1) {
        NEXUS_CLOTH_SIMULATION.step(state, dt, {
            gravity: item.gravity,
            capsules: item.capsules || [],
            brief: item.brief,
            thickness: item.thickness,
            hem: hem,
            centre: centre,
            briefGap: item.briefGap,
            collide: NEXUS_BODY_COLLISION.collide,
        });
    }
    return { positions: new Float32Array(state.x), strain: NEXUS_CLOTH_SIMULATION.maxStrain(state) };
}

self.onmessage = function (event) {
    var job = event.data || {};
    if (job.solver === 'xpbd') {
        try {
            ensureXpbd();
            var result = NEXUS_POSE_CLOTH_CORRECTION.correct(job.input);
            var transfer = [];
            var simulated = job.xpbd || [];
            for (var s = 0; s < simulated.length; s += 1) {
                try {
                    var item = simulated[s];
                    var skinned =
                        job.input &&
                        job.input.garments &&
                        job.input.garments[item.index] &&
                        job.input.garments[item.index].posed;
                    var solved = simulateXpbd(item, skinned);
                    var garment = result.garments[item.index];
                    if (!solved || !garment || solved.positions.length !== garment.positions.length) continue;
                    garment.positions = solved.positions;
                    garment.after = garment.after || {};
                    garment.after.solver = 'xpbd';
                    garment.after.maxEdgeStretch = solved.strain;
                } catch (error) {
                    // One bad asset must not drop the pose correction already computed.
                }
            }
            var garments = result.garments.map(function (g) {
                transfer.push(g.positions.buffer);
                return { name: g.name, positions: g.positions, before: g.before, after: g.after };
            });
            self.postMessage({ id: job.id, ok: true, garments: garments }, transfer);
        } catch (error) {
            self.postMessage({ id: job.id, ok: false, why: String((error && error.message) || error) });
        }
        return;
    }
    try {
        var corrected = NEXUS_POSE_CLOTH_CORRECTION.correct(job.input);
        var buffers = [];
        var posed = corrected.garments.map(function (g) {
            buffers.push(g.positions.buffer);
            return { name: g.name, positions: g.positions, before: g.before, after: g.after };
        });
        self.postMessage({ id: job.id, ok: true, garments: posed }, buffers);
    } catch (error) {
        self.postMessage({ id: job.id, ok: false, why: String((error && error.message) || error) });
    }
};
