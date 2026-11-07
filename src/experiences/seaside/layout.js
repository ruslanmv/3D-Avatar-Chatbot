/**
 * Seaside terrace as data (IC3).
 *
 * The numbers are the scene. Meshes are built from them by SceneRuntime, so
 * the layout can be tested without WebGL and a missing art pack cannot blank
 * the experience: there is no art pack. Every body is a box, plane, cylinder
 * or sphere. A single backdrop plane is not in this list.
 *
 * The avatar stays at the origin. The camera in ViewerEngine sits near
 * (0, 1.25, 2), looking back at her, so the terrace extends behind her toward
 * negative Z and the ocean sits on that horizon. Nothing here writes the
 * camera.
 *
 * Low preset cuts segments for standalone headsets. It does not remove the
 * floor, the table, or the two interactive objects — those are the experience,
 * not the decoration.
 *
 * Exposes: window.NEXUS_SEASIDE_LAYOUT
 */
const SeasideLayout = (() => {
    'use strict';

    function bodies(preset) {
        const low = preset === 'low';
        const seg = low ? 8 : 16;
        const oceanBands = low ? 3 : 5;
        const list = [
            { id: 'floor', shape: 'box', size: [4.6, 0.08, 5.2], position: [0, -0.04, -0.8], color: 0xc2b39a },
            {
                id: 'railing-left',
                shape: 'box',
                size: [0.06, 0.55, 4.4],
                position: [-2.2, 0.35, -1.1],
                color: 0x8d7358,
            },
            {
                id: 'railing-right',
                shape: 'box',
                size: [0.06, 0.55, 4.4],
                position: [2.2, 0.35, -1.1],
                color: 0x8d7358,
            },
            {
                id: 'chair-seat',
                shape: 'box',
                size: [0.48, 0.06, 0.48],
                position: [-0.85, 0.42, 0.15],
                color: 0x6e5844,
            },
            {
                id: 'chair-back',
                shape: 'box',
                size: [0.48, 0.42, 0.06],
                position: [-0.85, 0.66, -0.08],
                color: 0x6e5844,
            },
            { id: 'table-top', shape: 'box', size: [0.7, 0.04, 0.7], position: [0.85, 0.62, 0.05], color: 0xdec7a2 },
            {
                id: 'table-leg',
                shape: 'cylinder',
                radius: 0.04,
                height: 0.58,
                position: [0.85, 0.31, 0.05],
                color: 0x8d7358,
                segments: seg,
            },
            {
                id: 'shell',
                shape: 'sphere',
                radius: 0.07,
                segments: seg,
                position: [0.7, 0.71, 0.15],
                color: 0xf2e2c4,
                selectable: true,
            },
            {
                id: 'lantern',
                shape: 'box',
                size: [0.12, 0.18, 0.12],
                position: [1.02, 0.75, -0.08],
                color: 0xf6d98a,
                selectable: true,
            },
            {
                id: 'exit-stone',
                shape: 'box',
                size: [0.34, 0.08, 0.34],
                position: [1.55, 0.08, 1.15],
                color: 0x9aa7b2,
                selectable: true,
            },
            {
                id: 'sky',
                shape: 'sphere',
                radius: 16,
                segments: seg,
                position: [0, 1.2, 0],
                color: 0x143047,
                side: 'back',
                skipInPassthrough: true,
            },
        ];
        for (let i = 0; i < oceanBands; i++) {
            list.push({
                id: 'ocean-' + i,
                shape: 'box',
                size: [14, 0.02, 1.1],
                position: [0, 0.01 + i * 0.004, -3.4 - i * 1.15],
                color: i % 2 === 0 ? 0x1d6e8a : 0x164e68,
                skipInPassthrough: true,
            });
        }
        return list;
    }

    function manifest(preset, options) {
        const opts = options || {};
        const quality = preset === 'desktop' ? 'desktop' : 'low';
        return {
            schemaVersion: 1,
            id: 'seaside-evening',
            title: 'Seaside Evening',
            sceneType: opts.passthrough ? 'mixed-reality' : 'interactive-3d',
            assetPaths: Array.isArray(opts.assetPaths) ? opts.assetPaths : [],
            requiredCapabilities: [],
            qualityPresets: {
                low: { segments: 8 },
                desktop: { segments: 16 },
            },
            lighting: { mode: 'unlit', dynamicShadows: false },
            audio: { ambience: 'waves', duckWhileSpeaking: true },
            avatarPlacement: { position: [0, 0, 0], yaw: 0, move: false },
            interactionAnchors: [
                { id: 'shell', position: [0.7, 0.71, 0.15] },
                { id: 'lantern', position: [1.02, 0.75, -0.08] },
                { id: 'exit-stone', position: [1.55, 0.08, 1.15] },
            ],
            navigationBounds: { min: [-2.1, 0, -3.2], max: [2.1, 2, 1.6] },
            fallbackScene: 'seaside-evening-procedural',
            bodies: bodies(quality).filter((body) => !(opts.passthrough && body.skipInPassthrough)),
            quality: quality,
        };
    }

    return { bodies: bodies, manifest: manifest };
})();

if (typeof window !== 'undefined') window.NEXUS_SEASIDE_LAYOUT = SeasideLayout;
if (typeof module !== 'undefined' && module.exports) module.exports = SeasideLayout;
