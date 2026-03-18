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

// Import @pixiv/three-vrm in the background with timeout — do NOT block module execution.
// If the CDN is slow or unreachable, the ViewerEngine still initializes without VRM support.
// Mobile connections can be slow, so we retry once with a longer timeout before giving up.
(async () => {
    const loadVRM = async (timeoutMs) => {
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`CDN timeout (${timeoutMs / 1000}s)`)), timeoutMs)
        );
        return Promise.race([import('@pixiv/three-vrm'), timeout]);
    };

    const registerVRM = (vrmModule) => {
        if (vrmModule.VRMLoaderPlugin) {
            window.__THREE_VRM_PLUGIN__ = vrmModule.VRMLoaderPlugin;
            if (vrmModule.VRMUtils) {
                window.THREE_VRM = window.THREE_VRM || {};
                window.THREE_VRM.VRMUtils = vrmModule.VRMUtils;
            }
            console.log('[ViewerBridge] @pixiv/three-vrm loaded successfully');
            return true;
        }
        return false;
    };

    try {
        console.log('[ViewerBridge] Loading @pixiv/three-vrm from CDN...');
        registerVRM(await loadVRM(12000));
    } catch (e1) {
        console.warn('[ViewerBridge] First VRM load attempt failed:', e1.message, '— retrying with longer timeout...');
        try {
            registerVRM(await loadVRM(20000));
        } catch (e2) {
            console.warn('[ViewerBridge] @pixiv/three-vrm not available — VRM support disabled:', e2.message);
        }
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

    // Check WebGL availability before attempting 3D init
    const testCanvas = document.createElement('canvas');
    const gl =
        testCanvas.getContext('webgl2') ||
        testCanvas.getContext('webgl') ||
        testCanvas.getContext('experimental-webgl');
    if (!gl) {
        console.error('[ViewerBridge] WebGL not available — showing fallback');
        document.documentElement.classList.add('no-webgl');
        const fallback = document.getElementById('webgl-fallback');
        if (fallback) fallback.style.display = 'block';
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        // Still resolve the promise so main.js can run chat-only mode
        try {
            window.__resolveNexusViewerReady__?.(null);
        } catch (_) {}
        return;
    }

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

        // Apply saved visual effects settings (default: all on)
        const fxKeys = [
            { key: 'fx_envmap', apply: (v) => engine.setEnvironmentMap(v) },
            { key: 'fx_bloom', apply: (v) => engine.postProcessing?.setBloom(v) },
            { key: 'fx_ssao', apply: (v) => engine.postProcessing?.setSSAO(v) },
            { key: 'fx_tonemapping', apply: (v) => engine.setToneMapping(v) },
        ];
        for (const { key, apply } of fxKeys) {
            const saved = localStorage.getItem(key);
            if (saved !== null) apply(saved === 'true');
        }

        // Apply device-specific renderer optimizations
        if (window.NEXUS_DEVICE) {
            const settings = window.NEXUS_DEVICE.getRendererSettings();
            engine.renderer.setPixelRatio(settings.pixelRatio);
            if (settings.shadowMapEnabled !== undefined) {
                engine.setShadows(settings.shadowMapEnabled);
            }
        }

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

        // Show fallback on failure (e.g. WebGL context creation failed on low-memory mobile)
        document.documentElement.classList.add('no-webgl');
        const fallback = document.getElementById('webgl-fallback');
        if (fallback) fallback.style.display = 'block';
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) loadingOverlay.classList.add('hidden');

        // Resolve promise so chat still works
        try {
            window.__resolveNexusViewerReady__?.(null);
        } catch (_) {}
    }
};

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initEngine);
} else {
    // DOM already ready (module scripts run deferred, so this is common)
    initEngine();
}
