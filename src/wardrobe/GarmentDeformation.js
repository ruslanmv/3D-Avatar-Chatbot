/**
 * Which garments are simulated. The profile comes from the cloth asset.
 * A name is not consulted here: Forge already classified the template.
 */
(function (global, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_GARMENT_DEFORMATION = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null, function () {
    var STRATEGY = {
        skinning: 'skeletal skinning',
        corrective: 'skinning plus pose-space joint corrections',
        rigid: 'rigid and articulated, not cloth',
        'hybrid-skirt': 'skinned waist, simulated hem panel',
        cloth: 'xpbd',
        xpbd: 'xpbd',
    };

    function strategyFor(profile) {
        return STRATEGY[profile] || STRATEGY.skinning;
    }

    /**
     * Pick a LOD the device can pay for. mobile-low is always skinning,
     * including when the asset itself is an XPBD garment.
     */
    function selectLod(lods, tier) {
        var list = lods || [];
        if (tier === 'mobile-low') {
            return { name: 'mobile-low', particles: 0, simulation: 'skinning', mesh: 'none' };
        }
        for (var index = 0; index < list.length; index += 1) {
            if (list[index].name === tier) return list[index];
        }
        return { name: tier || 'desktop', particles: null, simulation: 'xpbd', mesh: 'full' };
    }

    /**
     * The live pose corrector stays in charge until a caller asks for xpbd
     * and the asset says the garment is allowed to simulate.
     */
    function solverFor(assetSummary, requested) {
        if (requested !== 'xpbd') return 'pose-correction';
        if (!assetSummary || assetSummary.simulation !== 'xpbd') return 'pose-correction';
        if (assetSummary.profile !== 'cloth' && assetSummary.profile !== 'hybrid-skirt') return 'pose-correction';
        if (assetSummary.schema !== 'wardrobe.cloth/1') return 'pose-correction';
        return 'xpbd';
    }

    // Only the first three explicitly audited skirt looks are opted in.
    // All other catalog garments retain the old correction even under the flag.
    var PILOT = {
        'dress-a-line-v1': true,
        'skirt-pencil-v1': true,
        'skirt-pleated-mini-v1': true,
    };

    function pilotFor(tag, requested) {
        if (requested !== 'xpbd' || !tag || !PILOT[tag.templateId]) return false;
        return solverFor(tag.clothAsset, requested) === 'xpbd';
    }

    return { strategyFor: strategyFor, selectLod: selectLod, solverFor: solverFor, pilotFor: pilotFor };
});
