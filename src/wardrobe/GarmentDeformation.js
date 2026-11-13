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
     * This PR simulates three skirts. Every other catalog name stays on the
     * pose corrector even when the page flag is on.
     */
    var LIVE_XPBD = {
        'a-line dress': true,
        'pencil skirt': true,
        'pleated mini skirt': true,
    };

    function catalogName(name) {
        return String(name || '')
            .replace(/\[Forge_[^\]]*\]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function liveXpbdGarment(name) {
        var text = catalogName(name);
        if (!text || /pencil mini skirt/.test(text)) return false;
        if (LIVE_XPBD[text]) return true;
        return (
            /(^| )a-line dress$/.test(text) || /(^| )pencil skirt$/.test(text) || /(^| )pleated mini skirt$/.test(text)
        );
    }

    function clothRequested(search) {
        var text = String(search || '');
        var match = /(?:^|[?&])cloth=([^&#]*)/.exec(text);
        if (!match) return '';
        try {
            return decodeURIComponent(match[1]) === 'xpbd' ? 'xpbd' : '';
        } catch (error) {
            return '';
        }
    }

    /**
     * XPBD only when the page asked, the asset is wardrobe.cloth/1 with
     * profile cloth or hybrid-skirt, and — when a name is given — it is one
     * of the three skirts. A tee, a trouser, a boot, or a missing schema
     * stays on the pose corrector.
     */
    function solverFor(assetSummary, requested, name) {
        if (requested !== 'xpbd') return 'pose-correction';
        if (name != null && !liveXpbdGarment(name)) return 'pose-correction';
        if (!assetSummary || assetSummary.schema !== 'wardrobe.cloth/1') return 'pose-correction';
        if (assetSummary.profile !== 'cloth' && assetSummary.profile !== 'hybrid-skirt') return 'pose-correction';
        return 'xpbd';
    }

    /**
     * The message the page posts. With the flag absent, or with no skirt that
     * qualifies, the object is `{id, input}` and has no solver field.
     */
    function jobFor(id, input, search) {
        var requested = clothRequested(search);
        var message = { id: id, input: input };
        if (requested !== 'xpbd') return message;
        var xpbd = [];
        var garments = (input && input.garments) || [];
        for (var index = 0; index < garments.length; index += 1) {
            var garment = garments[index];
            if (solverFor(garment.summary, requested, garment.name) !== 'xpbd') continue;
            if (!garment.asset) continue;
            xpbd.push({
                index: index,
                name: garment.name,
                summary: garment.summary,
                asset: garment.asset,
                capsules: garment.capsules || [],
                brief: garment.brief || null,
                hem: garment.hem || null,
                centre: garment.centre || null,
            });
        }
        if (!xpbd.length) return message;
        message.solver = 'xpbd';
        message.xpbd = xpbd;
        return message;
    }

    return {
        LIVE_XPBD: LIVE_XPBD,
        strategyFor: strategyFor,
        selectLod: selectLod,
        catalogName: catalogName,
        liveXpbdGarment: liveXpbdGarment,
        clothRequested: clothRequested,
        solverFor: solverFor,
        jobFor: jobFor,
    };
});
