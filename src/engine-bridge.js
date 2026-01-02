import { ViewerEngine } from './gltf-viewer/ViewerEngine.js';

// Global flag read by src/main.js
window.__USE_GLTF_VIEWER_ENGINE__ = true;

// A single ready promise that classic scripts can await.
if (!window.__NEXUS_VIEWER_READY__) {
    window.__NEXUS_VIEWER_READY__ = new Promise((resolve) => {
        window.__resolveNexusViewerReady__ = resolve;
    });
}

function $(id) {
    return document.getElementById(id);
}

window.addEventListener('DOMContentLoaded', async () => {
    // ✅ Correct container in this repo:
    const container =
        $('avatar-viewport') ||
        $('avatar-container') ||
        document.querySelector('.avatar-viewport') ||
        document.querySelector('.avatar-container') ||
        document.querySelector('#viewer') ||
        document.querySelector('.viewer');

    if (!container) {
        console.error('[NEXUS][ViewerBridge] No avatar container found (#avatar-viewport).');
        return;
    }

    // Keep overlay on top, but ensure canvas is inside container
    const overlay = $('loading-overlay');
    if (overlay && overlay.parentElement === container) overlay.remove();

    const engine = new ViewerEngine(container);
    window.NEXUS_VIEWER = engine;

    // Resolve ready promise (for src/main.js)
    try {
        window.__resolveNexusViewerReady__?.(engine);
    } catch (_) {}
    try {
        delete window.__resolveNexusViewerReady__;
    } catch (_) {}

    // Put overlay back on top
    if (overlay) container.appendChild(overlay);

    console.log('[NEXUS][ViewerBridge] Viewer engine initialized.');
});
