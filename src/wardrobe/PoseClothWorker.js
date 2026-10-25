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

self.onmessage = function (event) {
    var job = event.data || {};
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
