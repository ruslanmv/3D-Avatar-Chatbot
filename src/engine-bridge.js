import { ViewerEngine } from './gltf-viewer/ViewerEngine.js';

console.log('[ViewerBridge] Module loaded');

// Global flag read by src/main.js — set immediately so main.js knows to use ViewerEngine
window.__USE_GLTF_VIEWER_ENGINE__ = true;

// A single ready promise that classic scripts can await.
if (!window.__NEXUS_VIEWER_READY__) {
    window.__NEXUS_VIEWER_READY__ = new Promise((resolve) => {
        window.__resolveNexusViewerReady__ = resolve;
    });
}

// Import @pixiv/three-vrm in the background — do NOT block module execution.
// If the CDN is slow or unreachable, the ViewerEngine still initializes without VRM support.
(async () => {
    try {
        console.log('[ViewerBridge] Loading @pixiv/three-vrm from CDN...');
        const vrmModule = await import('@pixiv/three-vrm');
        if (vrmModule.VRMLoaderPlugin) {
            window.__THREE_VRM_PLUGIN__ = vrmModule.VRMLoaderPlugin;
            if (vrmModule.VRMUtils) {
                window.THREE_VRM = window.THREE_VRM || {};
                window.THREE_VRM.VRMUtils = vrmModule.VRMUtils;
            }
            console.log('[ViewerBridge] @pixiv/three-vrm loaded successfully');
        }
    } catch (e) {
        console.warn('[ViewerBridge] @pixiv/three-vrm not available — VRM support disabled:', e.message);
    }
})();

function $(id) {
    return document.getElementById(id);
}

// Initialize ViewerEngine as soon as DOM is ready
const initEngine = async () => {
    console.log('[ViewerBridge] DOM ready — initializing ViewerEngine...');

    const container =
        $('avatar-viewport') ||
        $('avatar-container') ||
        document.querySelector('.avatar-viewport') ||
        document.querySelector('.avatar-container') ||
        document.querySelector('#viewer') ||
        document.querySelector('.viewer');

    if (!container) {
        console.error(
            '[ViewerBridge] No avatar container found. Looked for: #avatar-viewport, #avatar-container, .avatar-viewport, .avatar-container, #viewer, .viewer'
        );
        console.error('[ViewerBridge] Available elements:', document.body?.children?.length, 'top-level children');
        return;
    }

    console.log('[ViewerBridge] Found container:', container.id || container.className);

    // Keep overlay on top, but ensure canvas is inside container
    const overlay = $('loading-overlay');
    if (overlay && overlay.parentElement === container) overlay.remove();

    try {
        const engine = new ViewerEngine(container);
        window.NEXUS_VIEWER = engine;
        console.log('[ViewerBridge] ViewerEngine created, NEXUS_VIEWER set');

        // Apply saved desktop background from settings
        const savedBg = localStorage.getItem('desktop_bg');
        if (savedBg) engine.setDesktopBackground(savedBg);

        // Apply saved shadow setting (default: off)
        const savedShadow = localStorage.getItem('desktop_shadow');
        engine.setShadows(savedShadow === 'on');

        // Resolve ready promise (for src/main.js)
        try {
            window.__resolveNexusViewerReady__?.(engine);
        } catch (_) {}
        try {
            delete window.__resolveNexusViewerReady__;
        } catch (_) {}

        // Put overlay back on top
        if (overlay) container.appendChild(overlay);

        console.log('[ViewerBridge] Viewer engine initialized successfully');
    } catch (err) {
        console.error('[ViewerBridge] Failed to create ViewerEngine:', err);
        console.error('[ViewerBridge] Container dimensions:', container.offsetWidth, 'x', container.offsetHeight);
    }
};

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initEngine);
} else {
    // DOM already ready (module scripts run deferred, so this is common)
    initEngine();
}
