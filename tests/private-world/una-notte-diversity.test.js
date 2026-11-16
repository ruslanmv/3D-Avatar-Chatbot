/**
 * UN10. How different is each Una Notte evening from the ones before it?
 *
 * Deals consecutive evenings exactly as the bridge does — StoryWeaver.weave over the real
 * catalogue's Private places, with the stored history between them — and holds what a person
 * would notice: no evening repeats any of the last ten outright, and the closest of those ten
 * shares little with it (similarity 0 nothing … 8 identical). Measured 2026-11-15 over 20 × 200
 * evenings: room chosen (opening fixed) mean 2.88, max 4, 3172 distinct of 4000; no room chosen
 * mean 1.93, max 3, 3871 distinct; every field spread evenly (normalised entropy ≥ 0.999).
 */
const fs = require('fs');
const path = require('path');
const Weaver = require('../../src/features/together/StoryWeaver.js');
const VRWorlds = require('../../src/gltf-viewer/VRWorlds.js');

const FIELDS = ['openingVenue', 'narrativeHook', 'characterMood', 'destination', 'outfitTheme', 'storyArc'];
const key = (f) => FIELDS.map((k) => f[k]).join('|');
const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, '../../assets/vr-worlds/worlds.json'), 'utf8'));
const places = VRWorlds.placesFor(catalogue.worlds, {
    tier: VRWorlds.tierFor({ xr: false, mobile: false }),
    include: ['general', 'romantic', 'private'],
    privateOpen: true,
});

function seeded(seed) {
    let x = seed >>> 0;
    return () => {
        x = (x * 1664525 + 1013904223) >>> 0;
        return x / 4294967296;
    };
}

function deal(current, runs, evenings) {
    const out = { sims: [], repeats: 0, distinct: new Set(), fields: {} };
    for (let run = 0; run < runs; run += 1) {
        const rng = seeded(1000 + run);
        let history = [];
        for (let i = 0; i < evenings; i += 1) {
            const o = Weaver.weave({ places, current, history, rng });
            if (history.some((h) => key(h) === key(o.fingerprint))) out.repeats += 1;
            out.sims.push(o.similarity);
            out.distinct.add(key(o.fingerprint));
            for (const f of FIELDS) (out.fields[f] = out.fields[f] || new Set()).add(o[f]);
            history = history.concat(o.fingerprint).slice(-Weaver.HISTORY_MAX);
        }
    }
    out.mean = out.sims.reduce((a, b) => a + b, 0) / out.sims.length;
    out.max = Math.max(...out.sims);
    return out;
}

describe('UN10. consecutive evenings are different evenings', () => {
    test('the real catalogue offers openings and more than one destination', () => {
        expect(places.length).toBeGreaterThan(4);
    });

    test.each([
        ['the room they chose (opening fixed)', 'private-cabaret', 3, 4],
        ['no room chosen yet', null, 2, 3],
    ])('%s: no repeat of the last ten, and little in common with the closest', (label, current, mean, max) => {
        const r = deal(current, 5, 120);
        expect(r.repeats).toBe(0);
        expect(r.mean).toBeLessThanOrEqual(mean);
        expect(r.max).toBeLessThanOrEqual(max);
        expect(r.distinct.size).toBeGreaterThan(500);
        for (const f of ['narrativeHook', 'characterMood', 'storyArc', 'outfitTheme'])
            expect(r.fields[f].size).toBeGreaterThan(4);
    });
});
