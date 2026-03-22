/**
 * VRM Avatar Manager — Enterprise Solution
 *
 * Multi-source avatar browser with:
 * - Built-in catalog (CC0 / open-source VRM & GLB models)
 * - VRoid Hub API integration (OAuth)
 * - Sketchfab API integration (token)
 * - Ready Player Me integration
 * - Local file upload
 * - IndexedDB cache for downloaded files
 * - Auto-install to avatar manifest (avatars.json)
 *
 * Storage keys:
 *   vrm_manager_credentials   — API keys / tokens
 *   vrm_manager_installed     — installed avatar metadata
 *   vrm_manager_settings      — cache size, auto-install, etc.
 */

'use strict';

/* ═══════════════════════════════════════════════════════════
   CONFIGURATION
   ═══════════════════════════════════════════════════════════ */

const VM_CONFIG = {
    DB_NAME: 'vrm_avatar_cache',
    DB_VERSION: 1,
    STORE_NAME: 'avatars',
    MANIFEST_URL: '/vendor/avatars/avatars.json',
    AVATAR_DIR: '/vendor/avatars',
    PAGE_SIZE: 40,
    // Bump this version to force thumbnail regeneration when camera/framing changes
    THUMB_VERSION: 8,
};

/* ═══════════════════════════════════════════════════════════
   BUILT-IN CATALOG
   Curated free avatars from known sources
   ═══════════════════════════════════════════════════════════ */

const BUILTIN_CATALOG = [
    // ══════════════════════════════════════════════════════════
    // CC0 VRM — Full Face Animation
    // ══════════════════════════════════════════════════════════
    {
        id: 'vrm-avatar-sample-a',
        name: 'AvatarSample A',
        icon: '👩',
        desc: 'Official VRoid Studio sample A. Full expressions, lip-sync, gaze. CC0 public domain.',
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/AvatarSample_A.vrm',
        tags: ['female', 'vroid', 'cc0', 'stable'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 15000000,
        installed: true,
    },
    {
        id: 'vrm-avatar-sample-b',
        name: 'AvatarSample B',
        icon: '👨',
        desc: 'Official VRoid Studio sample B. Full expressions, lip-sync, gaze. CC0 public domain.',
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/AvatarSample_B.vrm',
        tags: ['male', 'vroid', 'cc0', 'stable'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 15400000,
        installed: true,
    },
    {
        id: 'vrm-avatar-sample-c',
        name: 'AvatarSample C',
        icon: '👧',
        desc: 'Official VRoid Studio sample C. Full expressions, lip-sync, gaze. CC0 public domain.',
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/AvatarSample_C.vrm',
        tags: ['female', 'vroid', 'cc0', 'stable'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 13100000,
        installed: true,
    },
    {
        id: 'vrm-fem-vroid',
        name: 'VRoid Female',
        icon: '👩',
        desc: 'Standard female VRM avatar with full expression set and visemes. CC0 public domain.',
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/fem_vroid.vrm',
        tags: ['female', 'vroid', 'cc0'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 12000000,
        installed: true,
    },
    {
        id: 'vrm-masc-vroid',
        name: 'VRoid Male',
        icon: '👨',
        desc: 'Standard male VRM avatar with full expression set and visemes. CC0 public domain.',
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/masc_vroid.vrm',
        tags: ['male', 'vroid', 'cc0'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 11800000,
        installed: true,
    },
    {
        id: 'vrm-sendagaya-shibu',
        name: 'Sendagaya Shibu',
        icon: '🧑',
        desc: 'VRoid beta character — Sendagaya Shibu. Full VRM expressions. CC0.',
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/Sendagaya_Shibu.vrm',
        tags: ['male', 'vroid', 'cc0', 'beta'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 15400000,
        installed: true,
    },
    {
        id: 'vrm-sendagaya-shino',
        name: 'Sendagaya Shino',
        icon: '👩',
        desc: 'VRoid beta character — Sendagaya Shino. Full VRM expressions. CC0.',
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/Sendagaya_Shino.vrm',
        tags: ['female', 'vroid', 'cc0', 'beta'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 14700000,
        installed: true,
    },
    {
        id: 'vrm-victoria-rubin',
        name: 'Victoria Rubin',
        icon: '👩‍🦰',
        desc: 'VRoid beta character — Victoria Rubin. Full VRM expressions. CC0.',
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/Victoria_Rubin.vrm',
        tags: ['female', 'vroid', 'cc0', 'beta'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 14200000,
        installed: true,
    },
    {
        id: 'vrm-vita',
        name: 'Vita',
        icon: '🧑‍🎤',
        desc: 'VRoid beta character — Vita. Full VRM expressions. CC0.',
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/Vita.vrm',
        tags: ['vroid', 'cc0', 'beta'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 16200000,
        installed: true,
    },
    {
        id: 'vrm-vivi',
        name: 'Vivi',
        icon: '👩‍🎨',
        desc: 'VRoid beta character — Vivi. Full VRM expressions. CC0.',
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/Vivi.vrm',
        tags: ['female', 'vroid', 'cc0', 'beta'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 17500000,
        installed: true,
    },
    {
        id: 'vrm-darkness-shibu',
        name: 'Darkness Shibu',
        icon: '🧛',
        desc: 'VRoid beta character — dark variant of Shibu. Full VRM expressions. CC0.',
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/Darkness_Shibu.vrm',
        tags: ['male', 'vroid', 'cc0', 'beta', 'dark'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 17200000,
        installed: true,
    },
    {
        id: 'vrm-hairsample-female',
        name: 'HairSample Female',
        icon: '💇‍♀️',
        desc: 'VRoid hair showcase — female model with detailed hair physics. CC0.',
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/HairSample_Female.vrm',
        tags: ['female', 'vroid', 'cc0', 'hair'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 19300000,
        installed: true,
    },
    {
        id: 'vrm-hairsample-male',
        name: 'HairSample Male',
        icon: '💇‍♂️',
        desc: 'VRoid hair showcase — male model with detailed hair physics. CC0.',
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/HairSample_Male.vrm',
        tags: ['male', 'vroid', 'cc0', 'hair'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 18200000,
        installed: true,
    },
    {
        id: 'vrm-sakurada-fumiriya',
        name: 'Sakurada Fumiriya',
        icon: '🧑‍💼',
        desc: 'VRoid beta character — Sakurada Fumiriya. Full VRM expressions. CC0.',
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/Sakurada_Fumiriya.vrm',
        tags: ['male', 'vroid', 'cc0', 'beta'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 20300000,
        installed: true,
    },

    {
        id: 'vrm-perfectsync-female',
        name: 'VRoid PerfectSync Female',
        icon: '\u{1F469}',
        desc: 'Enhanced VRoid female with 52 ARKit blendshapes for iPhone facial tracking (Perfect Sync). CC0.',
        source: 'hinzka/52blendshapes (CC0)',
        sourceId: 'github-52blendshapes',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/VRoid_PerfectSync_Female.vrm',
        tags: ['female', 'vroid', 'cc0', 'perfectsync', '52blendshapes'],
        features: ['lipsync', 'emotions', 'gaze', 'blink', 'perfectsync'],
        size: 23000000,
        installed: true,
    },
    {
        id: 'vrm-perfectsync-male',
        name: 'VRoid PerfectSync Male',
        icon: '\u{1F468}',
        desc: 'Enhanced VRoid male with 52 ARKit blendshapes for iPhone facial tracking (Perfect Sync). CC0.',
        source: 'hinzka/52blendshapes (CC0)',
        sourceId: 'github-52blendshapes',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/VRoid_PerfectSync_Male.vrm',
        tags: ['male', 'vroid', 'cc0', 'perfectsync', '52blendshapes'],
        features: ['lipsync', 'emotions', 'gaze', 'blink', 'perfectsync'],
        size: 22000000,
        installed: true,
    },
    {
        id: 'vrm-viewer-sample',
        name: 'VRM Viewer Sample',
        icon: '\u{2728}',
        desc: 'High-quality VRoid-compatible sample model with full expression set. Open source.',
        source: 'tk256ailab/vrm-viewer (Open Source)',
        sourceId: 'github-vrm-viewer',
        format: 'vrm',
        license: 'open-source',
        url: '/vendor/avatars/VRM_Viewer_Sample.vrm',
        tags: ['vroid', 'open-source', 'sample'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 18000000,
        installed: true,
    },
];

/* ═══════════════════════════════════════════════════════════
   SOURCES REGISTRY
   ═══════════════════════════════════════════════════════════ */

const SOURCES = [
    {
        id: 'github-vrm-samples',
        name: 'VRM Samples (GitHub)',
        icon: '📦',
        url: 'github.com/madjin/vrm-samples',
        desc: 'CC0 public domain VRM avatars. No API key needed — direct download from GitHub.',
        auth: 'none',
        formats: ['vrm'],
        status: 'connected',
    },
    {
        id: 'github-three-vrm',
        name: 'three-vrm Samples',
        icon: '🎮',
        url: 'github.com/pixiv/three-vrm',
        desc: 'Official Pixiv three-vrm sample models. VRM1_Constraint_Twist_Sample was removed from built-in catalog due to low quality.',
        auth: 'none',
        formats: ['vrm'],
        status: 'connected',
    },
    {
        id: 'github-talkinghead',
        name: 'TalkingHead Avatars',
        icon: '🗣️',
        url: 'github.com/met4citizen/TalkingHead',
        desc: 'Create your own GLB avatar with ARKit + Oculus viseme blend shapes. Legacy GLB models removed from built-in catalog — convert to VRM for full feature support.',
        auth: 'manual',
        formats: ['glb-morph'],
        status: 'no-api',
    },
    {
        id: 'vroid-hub',
        name: 'VRoid Hub',
        icon: '🌐',
        url: 'hub.vroid.com',
        desc: 'Thousands of community VRM avatars. Requires VRoid Hub Developer API credentials for search/download.',
        auth: 'oauth',
        formats: ['vrm'],
        status: 'disconnected',
        settingsKey: 'vroid',
        apiDocs: 'https://developer.vroid.com/en/api',
        signupUrl: 'https://hub.vroid.com/oauth/applications',
    },
    {
        id: 'readyplayerme',
        name: 'Ready Player Me',
        icon: '🧑',
        url: 'readyplayer.me',
        desc: 'Create custom avatars with 52 ARKit + 15 Oculus Viseme morph targets. Free tier available.',
        auth: 'api-key',
        formats: ['glb-morph'],
        status: 'disconnected',
        settingsKey: 'rpm',
        signupUrl: 'https://studio.readyplayer.me/',
    },
    {
        id: 'sketchfab',
        name: 'Sketchfab',
        icon: '🎨',
        url: 'sketchfab.com',
        desc: 'Massive 3D model library. Search for VRM/GLB with morph targets. API token required for downloads.',
        auth: 'token',
        formats: ['vrm', 'glb-morph', 'glb'],
        status: 'disconnected',
        settingsKey: 'sketchfab',
        signupUrl: 'https://sketchfab.com/settings/password',
        apiDocs: 'https://docs.sketchfab.com/data-api/v3/index.html',
    },
    {
        id: 'booth',
        name: 'Booth.pm',
        icon: '🏪',
        url: 'booth.pm',
        desc: 'Japanese marketplace with many free VRM models. No public API — download manually and upload here.',
        auth: 'manual',
        formats: ['vrm'],
        status: 'no-api',
    },
    {
        id: 'vroid-studio',
        name: 'VRoid Studio',
        icon: '✏️',
        url: 'vroid.com/studio',
        desc: 'Free desktop app to create your own VRM avatars from scratch. Export and upload here.',
        auth: 'manual',
        formats: ['vrm'],
        status: 'no-api',
    },
    {
        id: 'viverse',
        name: 'VIVERSE Avatar Maker',
        icon: '🌀',
        url: 'avatar.viverse.com',
        desc: 'Browser-based VRM avatar creator by HTC VIVE. Create online, download VRM, and upload here.',
        auth: 'manual',
        formats: ['vrm'],
        status: 'no-api',
    },
    {
        id: 'opensourceavatars',
        name: 'Open Source Avatars',
        icon: '🆓',
        url: 'opensourceavatars.com',
        desc: '300+ CC0 avatars fetched live from GitHub. No auth needed — enable to browse.',
        auth: 'none',
        formats: ['vrm'],
        status: 'connected',
        enabledByDefault: false,
    },
];

/* ── Source Enable/Disable ─────────────────────────────────── */
function getDisabledSources() {
    try {
        return new Set(JSON.parse(localStorage.getItem('vrm_manager_disabled_sources') || '[]'));
    } catch (_) {
        return new Set();
    }
}
function saveDisabledSources(set) {
    localStorage.setItem('vrm_manager_disabled_sources', JSON.stringify([...set]));
}
function isSourceEnabled(src) {
    const disabled = getDisabledSources();
    if (disabled.has(src.id)) return false;
    // On first run (nothing in localStorage), respect enabledByDefault
    if (!localStorage.getItem('vrm_manager_disabled_sources') && src.enabledByDefault === false) return false;
    return true;
}
function toggleSourceEnabled(srcId) {
    const disabled = getDisabledSources();
    // If first run, initialize disabled set from enabledByDefault flags
    if (!localStorage.getItem('vrm_manager_disabled_sources')) {
        SOURCES.forEach((s) => {
            if (s.enabledByDefault === false) disabled.add(s.id);
        });
    }
    if (disabled.has(srcId)) disabled.delete(srcId);
    else disabled.add(srcId);
    saveDisabledSources(disabled);
    return !disabled.has(srcId);
}

/* ── Custom Sources (user-added catalog URLs) ──────────────── */
function getCustomSources() {
    try {
        return JSON.parse(localStorage.getItem('vrm_manager_custom_sources') || '[]');
    } catch (_) {
        return [];
    }
}
function saveCustomSources(list) {
    localStorage.setItem('vrm_manager_custom_sources', JSON.stringify(list));
}
function addCustomSource(source) {
    const list = getCustomSources();
    // Prevent duplicates by URL
    if (list.some((s) => s.catalogUrl === source.catalogUrl)) return false;
    list.push(source);
    saveCustomSources(list);
    return true;
}
function removeCustomSource(catalogUrl) {
    const list = getCustomSources().filter((s) => s.catalogUrl !== catalogUrl);
    saveCustomSources(list);
}

/* ═══════════════════════════════════════════════════════════
   GLOBALS
   ═══════════════════════════════════════════════════════════ */

let allItems = [];
let currentFiltered = [];
let visibleCount = VM_CONFIG.PAGE_SIZE;
let installedAvatars = {};
let db = null;
let osAvatarsLoaded = false;

/* ═══════════════════════════════════════════════════════════
   INITIALIZATION
   ═══════════════════════════════════════════════════════════ */

const VRMManager = {
    async init() {
        await this.openDB();
        this.loadCredentials();
        this.loadInstalled();
        this.loadSettings();
        this.buildSourceCards();
        this.wireEvents();
        this.updateSourceStatuses();
        await this.loadCatalog();

        // Check if thumbnail version changed — if so, clear all cached thumbnails
        const savedThumbVer = localStorage.getItem('vrm_thumb_version');
        if (savedThumbVer !== String(VM_CONFIG.THUMB_VERSION)) {
            console.log('[VRM-Manager] Thumbnail version changed — clearing cached thumbnails for regeneration');
            Object.values(installedAvatars).forEach((it) => {
                it.preview = '';
            });
            this.saveInstalled();
            localStorage.setItem('vrm_thumb_version', String(VM_CONFIG.THUMB_VERSION));
        } else {
            // Restore thumbnails from IndexedDB
            await restoreThumbnailsFromDB();
        }

        this.applyFilters();
        this.renderInstalledGrid();

        // Auto-generate thumbnails for core avatars that still have no preview
        this.autoGenerateMissingThumbnails();

        // Handle ?install=URL parameter from gallery deep-link
        this.handleInstallParam();
    },

    handleInstallParam() {
        const params = new URLSearchParams(window.location.search);
        const installUrl = params.get('install');
        if (!installUrl) return;

        // Clean the URL param from address bar
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);

        // Auto-install the avatar from URL
        console.log('[VRM-Manager] Auto-installing from URL param:', installUrl);
        toast(`Installing avatar from catalog...`, 'info');
        this.installFromUrl(installUrl);
    },

    async autoGenerateMissingThumbnails() {
        // Include both local AND external installed avatars that are missing thumbnails
        const missing = Object.values(installedAvatars).filter((it) => {
            if (it.preview) return false;
            if (!it.url) return false;
            // Skip non-downloadable URLs (VRoid Hub web pages without .vrm extension)
            const isExternal = it.url.startsWith('https://') || it.url.startsWith('http://');
            if (isExternal && !/\.(vrm|glb|gltf)(\?.*)?$/i.test(it.url)) return false;
            return true;
        });
        if (missing.length === 0) return;

        // Pre-filter: for local URLs, check that the file actually exists
        // For external URLs with cached blobs, allow them through
        const valid = [];
        for (const item of missing) {
            const isLocal = item.url.startsWith('/');
            if (isLocal) {
                try {
                    // Use a range GET instead of HEAD — some servers return 200+HTML
                    // for missing files (SPA fallback), and HEAD may not expose content-type reliably.
                    const check = await fetch(item.url, {
                        method: 'GET',
                        headers: { Range: 'bytes=0-3' },
                    });
                    if (!check.ok && check.status !== 206) throw new Error('not found');
                    const ct = check.headers.get('content-type') || '';
                    if (ct.includes('text/html')) throw new Error('html response');
                    // Extra check: GLB files start with 'glTF' magic bytes, VRM (which is GLB) too
                    const buf = await check.arrayBuffer();
                    const magic = new Uint8Array(buf.slice(0, 4));
                    const isGLB = magic[0] === 0x67 && magic[1] === 0x6c && magic[2] === 0x54 && magic[3] === 0x46; // 'glTF'
                    if (!isGLB && !ct.includes('model/') && !ct.includes('application/octet-stream')) {
                        throw new Error('not a valid GLB/VRM file');
                    }
                    valid.push(item);
                } catch {
                    /* skip unreachable or non-binary local files */
                }
            } else {
                // External URL — check if we have a cached blob
                try {
                    const cached = await this.getCachedBlob(item.id);
                    if (cached && cached.blob) {
                        valid.push(item);
                    }
                } catch {
                    /* skip items without cached blobs */
                }
            }
        }
        if (valid.length === 0) return;

        console.log(`[VRM-Manager] Auto-generating ${valid.length} missing thumbnails...`);
        for (const item of valid) {
            await generateAndSaveThumbnail(item);
            const catalogItem = allItems.find((x) => x.id === item.id);
            if (catalogItem && item.preview) catalogItem.preview = item.preview;
        }
        this.applyFilters();
        this.renderInstalledGrid();
    },

    /* ── IndexedDB ─────────────────────────────────────── */

    openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(VM_CONFIG.DB_NAME, VM_CONFIG.DB_VERSION);
            req.onupgradeneeded = (e) => {
                const store = e.target.result.createObjectStore(VM_CONFIG.STORE_NAME, { keyPath: 'id' });
                store.createIndex('format', 'format', { unique: false });
            };
            req.onsuccess = (e) => {
                db = e.target.result;
                resolve();
            };
            req.onerror = (e) => {
                console.error('[VRM-Manager] DB error:', e);
                resolve();
            };
        });
    },

    async cacheBlob(id, blob, meta) {
        if (!db) return;
        return new Promise((resolve) => {
            const tx = db.transaction(VM_CONFIG.STORE_NAME, 'readwrite');
            tx.objectStore(VM_CONFIG.STORE_NAME).put({ id, blob, meta, cachedAt: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    },

    async getCachedBlob(id) {
        if (!db) return null;
        return new Promise((resolve) => {
            const tx = db.transaction(VM_CONFIG.STORE_NAME, 'readonly');
            const req = tx.objectStore(VM_CONFIG.STORE_NAME).get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    },

    async clearCache() {
        if (!db) return;
        return new Promise((resolve) => {
            const tx = db.transaction(VM_CONFIG.STORE_NAME, 'readwrite');
            tx.objectStore(VM_CONFIG.STORE_NAME).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    },

    /* ── Credentials ───────────────────────────────────── */

    loadCredentials() {
        try {
            const raw = localStorage.getItem('vrm_manager_credentials');
            this.credentials = raw ? JSON.parse(raw) : {};
        } catch (_) {
            this.credentials = {};
        }
        this.populateCredentialFields();
        // Check if server has pre-configured VRoid Hub credentials (env vars)
        this._checkServerVroidConfig();
    },

    /**
     * Check if the server has VROID_APP_ID/VROID_APP_SECRET env vars configured.
     * If yes, auto-populate appId so users just click "Authorize" without pasting keys.
     */
    async _checkServerVroidConfig() {
        // Skip if user already has credentials configured
        if (this.credentials.vroid && this.credentials.vroid.appId) return;
        try {
            const res = await fetch('/api/vroid-hub?action=env_config');
            if (!res.ok) return;
            const data = await res.json();
            if (data.hasEnvCredentials && data.appId) {
                // Server has credentials — store flag only, never store actual values locally
                this.credentials.vroid = {
                    ...this.credentials.vroid,
                    appId: data.appId, // Needed for OAuth authorize URL (client_id param)
                    appSecret: '', // Never stored — server uses env var directly
                    _serverConfigured: true,
                };
                // Hide credential fields entirely and show server-configured message
                const appIdEl = el('vm-vroid-app-id');
                const appSecretEl = el('vm-vroid-app-secret');
                // Clear and disable fields — never display credentials
                if (appIdEl) {
                    appIdEl.value = '';
                    appIdEl.closest('.vm-cred-row')?.classList.add('vm-hidden');
                }
                if (appSecretEl) {
                    appSecretEl.value = '';
                    appSecretEl.closest('.vm-cred-row')?.classList.add('vm-hidden');
                }
                // Show a hint instead
                const vroidFields = appIdEl && appIdEl.closest('.vm-cred-fields');
                if (vroidFields && !vroidFields.querySelector('.vm-server-config-hint')) {
                    const hint = document.createElement('div');
                    hint.className = 'vm-server-config-hint';
                    hint.style.cssText =
                        'font-size:12px;color:#4caf50;margin-top:8px;padding:8px 12px;background:rgba(76,175,80,0.08);border-radius:6px;line-height:1.5;';
                    hint.innerHTML =
                        '<strong>Server configured</strong> — VRoid Hub API credentials are managed by the server. ' +
                        'Click <strong>Authorize with VRoid Hub</strong> below to connect your account.';
                    vroidFields.appendChild(hint);
                }
                this.updateSourceStatuses();
                console.log('[VRM-Manager] VRoid Hub credentials auto-configured from server env vars');
            }
        } catch (_) {
            // Server doesn't have env_config endpoint or is unavailable — silent fallback
        }
    },

    saveCredentials() {
        // Read from UI fields — token fields allow direct paste
        const existingVroid = this.credentials.vroid || {};
        const isServerConfigured = existingVroid._serverConfigured;
        const uiAccessToken = el('vm-vroid-access-token') ? el('vm-vroid-access-token').value.trim() : '';
        const uiRefreshToken = el('vm-vroid-refresh-token') ? el('vm-vroid-refresh-token').value.trim() : '';
        this.credentials = {
            vroid: {
                // Preserve server-configured values — don't overwrite with UI placeholder text
                appId: isServerConfigured ? existingVroid.appId : el('vm-vroid-app-id').value.trim(),
                appSecret: isServerConfigured ? existingVroid.appSecret : el('vm-vroid-app-secret').value.trim(),
                _serverConfigured: isServerConfigured || false,
                accessToken: uiAccessToken || existingVroid.accessToken || '',
                refreshToken: uiRefreshToken || existingVroid.refreshToken || '',
                tokenExpiresAt:
                    uiAccessToken && uiAccessToken !== existingVroid.accessToken
                        ? Date.now() + 3600 * 1000 // assume 1h if new token pasted
                        : existingVroid.tokenExpiresAt || 0,
            },
            rpm: {
                subdomain: el('vm-rpm-subdomain').value.trim(),
                apiKey: el('vm-rpm-api-key').value.trim(),
            },
            sketchfab: {
                token: el('vm-sketchfab-token').value.trim(),
            },
        };
        localStorage.setItem('vrm_manager_credentials', JSON.stringify(this.credentials));
        this.updateSourceStatuses();
        toast('Settings saved', 'success');
    },

    populateCredentialFields() {
        const c = this.credentials;
        if (c.vroid) {
            // Never show server-configured credentials in UI fields
            if (c.vroid._serverConfigured) {
                setVal('vm-vroid-app-id', '');
                setVal('vm-vroid-app-secret', '');
            } else {
                setVal('vm-vroid-app-id', c.vroid.appId || '');
                setVal('vm-vroid-app-secret', c.vroid.appSecret || '');
            }
            setVal('vm-vroid-access-token', c.vroid.accessToken || '');
            setVal('vm-vroid-refresh-token', c.vroid.refreshToken || '');
        }
        if (c.rpm) {
            setVal('vm-rpm-subdomain', c.rpm.subdomain || '');
            setVal('vm-rpm-api-key', c.rpm.apiKey || '');
        }
        if (c.sketchfab) {
            setVal('vm-sketchfab-token', c.sketchfab.token || '');
        }
    },

    updateSourceStatuses() {
        const c = this.credentials;

        // VRoid Hub — connected if we have a valid token OR appId+appSecret
        const vroidHasToken = c.vroid && c.vroid.accessToken;
        const vroidHasCreds = c.vroid && c.vroid.appId && c.vroid.appSecret;
        const vroidOk = vroidHasToken || vroidHasCreds;
        setCredStatus('vm-vroid-status', vroidOk);
        const vroidSrc = SOURCES.find((s) => s.id === 'vroid-hub');
        if (vroidSrc) vroidSrc.status = vroidOk ? 'connected' : 'disconnected';

        // RPM
        const rpmOk = c.rpm && c.rpm.subdomain;
        setCredStatus('vm-rpm-status', rpmOk);
        const rpmSrc = SOURCES.find((s) => s.id === 'readyplayerme');
        if (rpmSrc) rpmSrc.status = rpmOk ? 'connected' : 'disconnected';

        // Sketchfab
        const sfOk = c.sketchfab && c.sketchfab.token;
        setCredStatus('vm-sketchfab-status', sfOk);
        const sfSrc = SOURCES.find((s) => s.id === 'sketchfab');
        if (sfSrc) sfSrc.status = sfOk ? 'connected' : 'disconnected';

        this.buildSourceCards();
    },

    async testCredential(provider) {
        toast(`Testing ${provider} connection...`, 'info');

        if (provider === 'vroid') {
            const existing = this.credentials.vroid || {};
            const isServerCfg = existing._serverConfigured;
            const appId = isServerCfg ? existing.appId : el('vm-vroid-app-id').value.trim();
            const appSecret = isServerCfg ? '' : el('vm-vroid-app-secret').value.trim();
            const canOAuth = isServerCfg || (appId && appSecret);
            const pastedToken = el('vm-vroid-access-token') ? el('vm-vroid-access-token').value.trim() : '';
            const pastedRefresh = el('vm-vroid-refresh-token') ? el('vm-vroid-refresh-token').value.trim() : '';

            if (!canOAuth && !pastedToken) {
                toast('Enter App ID + Secret, or paste an Access Token', 'error');
                return;
            }

            try {
                // Use pasted token, existing token, or start OAuth flow
                let token = pastedToken || existing.accessToken;

                // If token was pasted, save it immediately
                if (pastedToken && pastedToken !== existing.accessToken) {
                    this.credentials.vroid = {
                        ...existing,
                        appId: appId || existing.appId || '',
                        appSecret: isServerCfg ? '' : appSecret || existing.appSecret || '',
                        accessToken: pastedToken,
                        refreshToken: pastedRefresh || existing.refreshToken || '',
                        tokenExpiresAt: Date.now() + 3600 * 1000,
                    };
                    localStorage.setItem('vrm_manager_credentials', JSON.stringify(this.credentials));
                }

                if (!token) {
                    // No token available — start OAuth authorization_code + PKCE flow
                    if (canOAuth) {
                        this.startVroidOAuth();
                        return;
                    }
                    toast('Enter App ID + Secret to connect via OAuth, or paste an Access Token', 'error');
                    return;
                }

                // Test the token by fetching account info
                const testRes = await fetch('/api/vroid-hub?action=account', {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const testData = await testRes.json();
                if (testRes.ok && testData.data) {
                    const name = testData.data.user?.name || testData.data.name || 'Unknown';
                    toast(`VRoid Hub connected! Account: ${name}`, 'success');
                    this.updateSourceStatuses();
                } else if (testRes.status === 401) {
                    // Token expired — try refresh first, then OAuth flow
                    const refreshed = await this._refreshVroidToken();
                    if (refreshed) {
                        toast('VRoid Hub token refreshed and connected!', 'success');
                        this.updateSourceStatuses();
                    } else if (canOAuth) {
                        toast('Token expired — starting OAuth re-authorization...', 'info');
                        this.startVroidOAuth();
                    } else {
                        toast('VRoid Hub token expired. Enter App ID + Secret to re-authorize.', 'error');
                        this.credentials.vroid.accessToken = '';
                        localStorage.setItem('vrm_manager_credentials', JSON.stringify(this.credentials));
                    }
                } else {
                    toast(`VRoid Hub API error: ${testData.error?.message || testRes.status}`, 'error');
                }
            } catch (e) {
                console.error('[VRM-Manager] VRoid Hub test error:', e);
                toast(`VRoid Hub connection failed: ${e.message}`, 'error');
            }
        } else if (provider === 'rpm') {
            const subdomain = el('vm-rpm-subdomain').value.trim();
            if (!subdomain) {
                toast('Enter your Ready Player Me subdomain first', 'error');
                return;
            }
            toast('Ready Player Me uses iframe-based avatar creation. Subdomain saved.', 'success');
        } else if (provider === 'sketchfab') {
            const token = el('vm-sketchfab-token').value.trim();
            if (!token) {
                toast('Enter your Sketchfab API token first', 'error');
                return;
            }
            try {
                const res = await fetch('https://api.sketchfab.com/v3/me', {
                    headers: { Authorization: `Token ${token}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    toast(`Connected as: ${data.displayName || data.username}`, 'success');
                } else {
                    toast(`Sketchfab auth failed: ${res.status}`, 'error');
                }
            } catch (e) {
                toast('Sketchfab API not reachable: ' + e.message, 'error');
            }
        }
    },

    /* ── Settings ──────────────────────────────────────── */

    loadSettings() {
        try {
            const raw = localStorage.getItem('vrm_manager_settings');
            this.settings = raw ? JSON.parse(raw) : { cacheSize: 100, autoInstall: true };
        } catch (_) {
            this.settings = { cacheSize: 100, autoInstall: true };
        }
        setVal('vm-cache-size', String(this.settings.cacheSize || 100));
        const autoInstallEl = el('vm-auto-install');
        if (autoInstallEl) autoInstallEl.checked = this.settings.autoInstall !== false;
    },

    saveSettings() {
        this.settings.cacheSize = parseInt(el('vm-cache-size').value, 10) || 100;
        this.settings.autoInstall = el('vm-auto-install').checked;
        localStorage.setItem('vrm_manager_settings', JSON.stringify(this.settings));
    },

    /* ── Installed Avatars ─────────────────────────────── */

    loadInstalled() {
        try {
            const raw = localStorage.getItem('vrm_manager_installed');
            installedAvatars = raw ? JSON.parse(raw) : {};
        } catch (_) {
            installedAvatars = {};
        }

        // Remove legacy GLB models whose files were removed from the server.
        // These were TalkingHead-era .glb avatars that are no longer shipped;
        // their URLs return HTML 404 pages which break thumbnail generation.
        const LEGACY_GLB_IDS = [
            'glb-brunette',
            'glb-brunette-t',
            'glb-avaturn',
            'glb-avatarsdk',
            'glb-mpfb',
            'glb-readyplayerme',
            'local-woman',
            'local-girl',
            'local-student',
        ];
        let cleaned = false;
        for (const id of LEGACY_GLB_IDS) {
            if (installedAvatars[id]) {
                delete installedAvatars[id];
                cleaned = true;
            }
        }
        if (cleaned) {
            console.log('[VRM-Manager] Cleaned up legacy GLB entries from installed list');
            try {
                localStorage.setItem('vrm_manager_installed', JSON.stringify(installedAvatars));
            } catch (_) {}
        }

        // Mark pre-installed local avatars as core (non-removable)
        BUILTIN_CATALOG.forEach((item) => {
            if (item.installed) installedAvatars[item.id] = { ...item, installedAt: 0, core: true };
        });
    },

    isCore(id) {
        return !!(installedAvatars[id] && installedAvatars[id].core);
    },

    saveInstalled() {
        // Strip base64 preview data before saving to localStorage to avoid QuotaExceededError.
        // Thumbnails are stored separately in IndexedDB and restored on load.
        const stripped = {};
        for (const [id, item] of Object.entries(installedAvatars)) {
            const copy = { ...item };
            if (copy.preview && typeof copy.preview === 'string' && copy.preview.startsWith('data:')) {
                delete copy.preview;
            }
            stripped[id] = copy;
        }
        try {
            localStorage.setItem('vrm_manager_installed', JSON.stringify(stripped));
        } catch (e) {
            console.warn('[VRM-Manager] localStorage save failed:', e.message);
        }
    },

    isInstalled(id) {
        return !!installedAvatars[id];
    },

    /* ── Catalog Loading ───────────────────────────────── */

    resetCatalogControls() {
        const searchEl = el('vm-search');
        const sourceEl = el('vm-filter-source');
        const formatEl = el('vm-filter-format');
        const licenseEl = el('vm-filter-license');
        if (searchEl) {
            searchEl.value = '';
        }
        if (sourceEl) {
            sourceEl.value = '';
        }
        if (formatEl) {
            formatEl.value = '';
        }
        if (licenseEl) {
            licenseEl.value = '';
        }
        const accessEl = el('vm-filter-access');
        if (accessEl) {
            accessEl.value = '';
        }
    },

    async loadCatalog() {
        setStatus('Loading avatar catalog...');

        // Start with built-in catalog — reset everything
        allItems = [...BUILTIN_CATALOG];
        osAvatarsLoaded = false;

        // Reset filter controls so catalog always opens showing everything
        this.resetCatalogControls();

        // Build source filter immediately from built-ins
        this.populateSourceFilter();

        // Render immediately so catalog is never blank on first open
        this.applyFilters();

        // Fetch remote sources in parallel and merge in later.
        // Built-in sources only fetch when user has custom sources or explicitly
        // enabled API-based sources — keeps the default catalog clean.
        const fetchers = [];
        const customSources = getCustomSources();
        const hasCustomSources = customSources.length > 0;

        // GitHub VRM Samples — only fetch if user has custom sources active
        // (avoids showing placeholder thumbnails in default catalog)
        if (hasCustomSources) {
            const ghSrc = SOURCES.find((s) => s.id === 'github-vrm-samples');
            if (!ghSrc || isSourceEnabled(ghSrc)) {
                fetchers.push(this.fetchGitHubVRMSamples());
            }
        }

        // VRoid Hub (if connected and enabled)
        const vroidSrc = SOURCES.find((s) => s.id === 'vroid-hub');
        if (this.credentials.vroid && this.credentials.vroid.accessToken && (!vroidSrc || isSourceEnabled(vroidSrc))) {
            fetchers.push(this.fetchVroidHubAvatars());
        }

        // Sketchfab search (if connected and enabled)
        const sfSrc = SOURCES.find((s) => s.id === 'sketchfab');
        if (this.credentials.sketchfab && this.credentials.sketchfab.token && (!sfSrc || isSourceEnabled(sfSrc))) {
            fetchers.push(this.fetchSketchfabAvatars());
        }

        // Open Source Avatars (if enabled — disabled by default, user opts in via toggle)
        const osaSrc = SOURCES.find((s) => s.id === 'opensourceavatars');
        if (osaSrc && isSourceEnabled(osaSrc)) {
            fetchers.push(
                this.fetchOpenSourceAvatars().then((items) => {
                    osAvatarsLoaded = true;
                    return items;
                })
            );
        }

        // Custom sources (user-added catalog URLs)
        customSources.forEach((cs) => {
            fetchers.push(this.fetchCustomCatalog(cs));
        });

        try {
            const results = await Promise.allSettled(fetchers);
            results.forEach((r) => {
                if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                    allItems = allItems.concat(r.value);
                }
            });
        } catch (e) {
            console.warn('[VRM-Manager] API fetch error:', e);
        }

        // Rebuild filters and re-render with full merged catalog
        this.populateSourceFilter();
        setStatus('');
        this.applyFilters();
        this.updateHubBanner();
    },

    updateHubBanner() {
        const banner = el('vm-hub-banner');
        if (!banner) return;
        const customSources = getCustomSources();
        if (customSources.length > 0) {
            // Show installed custom source count
            const totalCustom = allItems.filter((a) => a.sourceId && a.sourceId.startsWith('custom-')).length;
            banner.innerHTML = `
                <span class="vm-hub-banner-icon">📂</span>
                <span>${customSources.length} custom source${customSources.length > 1 ? 's' : ''} installed (${totalCustom.toLocaleString()} avatars). Manage in the <strong>Sources</strong> tab.</span>`;
        } else {
            banner.innerHTML = `
                <span class="vm-hub-banner-icon">💡</span>
                <span>Want more avatars? Go to the <strong>Sources</strong> tab and click <strong>+ Add Source</strong> to add custom avatar catalogs.</span>`;
        }
    },

    /* ── Sketchfab API ─────────────────────────────────── */

    async fetchSketchfabAvatars() {
        const token = this.credentials.sketchfab?.token;
        if (!token) return [];

        try {
            const url =
                'https://api.sketchfab.com/v3/search?type=models&q=VRM+avatar&downloadable=true&sort_by=-likeCount&count=24';
            const res = await fetch(url, {
                headers: { Authorization: `Token ${token}` },
            });
            if (!res.ok) return [];

            const data = await res.json();
            return (data.results || []).map((m) => ({
                id: `sketchfab-${m.uid}`,
                name: m.name,
                desc: (m.description || '').slice(0, 120),
                source: 'Sketchfab',
                sourceId: 'sketchfab',
                format: m.name.toLowerCase().includes('vrm') ? 'vrm' : 'glb',
                license: m.license?.slug === 'cc0' ? 'cc0' : m.license?.slug?.startsWith('cc-by') ? 'cc-by' : 'free',
                url: `https://api.sketchfab.com/v3/models/${m.uid}/download`,
                preview: m.thumbnails?.images?.[0]?.url || '',
                icon: '🎨',
                tags: (m.tags || []).map((t) => t.slug).slice(0, 3),
                features: [],
                size: m.archives?.glb?.size || 0,
                sketchfabUid: m.uid,
            }));
        } catch (e) {
            console.warn('[VRM-Manager] Sketchfab fetch error:', e);
            return [];
        }
    },

    /* ── VRoid Hub API ─────────────────────────────────── */

    /** Generate PKCE code_verifier (43-128 chars, RFC 7636) */
    _generateCodeVerifier() {
        const array = new Uint8Array(48);
        crypto.getRandomValues(array);
        return btoa(String.fromCharCode(...array))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    },

    /** Generate PKCE code_challenge from code_verifier (S256) */
    async _generateCodeChallenge(verifier) {
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return btoa(String.fromCharCode(...new Uint8Array(digest)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    },

    /**
     * Start OAuth authorization_code + PKCE flow via popup window.
     * Opens VRoid Hub authorization page, handles callback via postMessage.
     */
    async startVroidOAuth() {
        const isServerConfigured = this.credentials.vroid && this.credentials.vroid._serverConfigured;
        const appId = isServerConfigured ? this.credentials.vroid.appId : el('vm-vroid-app-id').value.trim();
        const appSecret = isServerConfigured
            ? '' // Server holds the secret — don't send it in the state
            : el('vm-vroid-app-secret').value.trim();
        if (!appId) {
            toast('Enter Application ID first', 'error');
            return;
        }
        if (!appSecret && !isServerConfigured) {
            toast('Enter Application ID and Secret first', 'error');
            return;
        }

        const codeVerifier = this._generateCodeVerifier();
        const codeChallenge = await this._generateCodeChallenge(codeVerifier);

        // Build the redirect URI — callback handler on our own domain
        const origin = window.location.origin;
        const redirectUri = `${origin}/api/vroid-hub-callback`;

        // Encode state with PKCE verifier + credentials for the callback
        const state = btoa(
            JSON.stringify({
                codeVerifier,
                clientId: appId,
                clientSecret: appSecret,
                redirectUri,
            })
        );

        const authUrl =
            `https://hub.vroid.com/oauth/authorize?` +
            `response_type=code` +
            `&client_id=${encodeURIComponent(appId)}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&scope=default` +
            `&state=${encodeURIComponent(state)}` +
            `&code_challenge=${encodeURIComponent(codeChallenge)}` +
            `&code_challenge_method=S256`;

        const mask = (s) => (s ? s.substring(0, 4) + '****' + s.substring(s.length - 4) : '(empty)');
        console.log(`[VRM-Manager] OAuth flow starting:`);
        console.log(`[VRM-Manager]   origin:        ${origin}`);
        console.log(`[VRM-Manager]   redirect_uri:  ${redirectUri}`);
        console.log(`[VRM-Manager]   client_id:     ${mask(appId)}`);
        console.log(`[VRM-Manager]   serverConfig:  ${isServerConfigured}`);
        console.log(`[VRM-Manager]   hasSecret:     ${appSecret ? 'yes' : 'no (server holds it)'}`);
        console.log(`[VRM-Manager]   codeChallenge: ${codeChallenge.substring(0, 6)}...`);
        console.log(
            '[VRM-Manager] ⚠️  If you get 400 "Invalid parameters", the redirect_uri above MUST be ' +
                'registered in your VRoid Hub app → https://hub.vroid.com/oauth/applications\n' +
                '[VRM-Manager] ⚠️  Add EXACTLY this URI (including https/http and path) to the Redirect URI field.'
        );
        toast('Opening VRoid Hub authorization...', 'info');

        // Open popup
        const popup = window.open(authUrl, 'vroid-oauth', 'width=600,height=700,scrollbars=yes');

        // Listen for postMessage from callback page
        const handler = (event) => {
            if (!event.data || !event.data.type) return;
            if (event.data.type === 'vroid-oauth-success') {
                window.removeEventListener('message', handler);
                this._handleOAuthSuccess(event.data, appId, appSecret);
            } else if (event.data.type === 'vroid-oauth-error') {
                window.removeEventListener('message', handler);
                toast(`VRoid Hub authorization failed: ${event.data.error}`, 'error');
            }
        };
        window.addEventListener('message', handler);

        // Timeout after 5 minutes
        setTimeout(() => window.removeEventListener('message', handler), 300000);
    },

    /** Handle successful OAuth callback — store tokens and verify */
    async _handleOAuthSuccess(data, appId, appSecret) {
        const { accessToken, refreshToken, expiresIn } = data;
        const isServerCfg = this.credentials.vroid && this.credentials.vroid._serverConfigured;

        this.credentials.vroid = {
            ...this.credentials.vroid,
            appId,
            appSecret: isServerCfg ? '' : appSecret, // Never store server secret
            _serverConfigured: isServerCfg || false,
            accessToken,
            refreshToken: refreshToken || '',
            tokenExpiresAt: Date.now() + (expiresIn || 3600) * 1000,
        };
        localStorage.setItem('vrm_manager_credentials', JSON.stringify(this.credentials));

        // Populate fields so UI reflects the new state
        setVal('vm-vroid-access-token', accessToken);
        if (refreshToken) setVal('vm-vroid-refresh-token', refreshToken);

        // Verify the token
        try {
            const testRes = await fetch('/api/vroid-hub?action=account', {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            const testData = await testRes.json();
            if (testRes.ok && testData.data) {
                const name = testData.data.user?.name || testData.data.name || 'Unknown';
                toast(`VRoid Hub connected! Account: ${name}`, 'success');
            } else {
                toast('VRoid Hub authorized — token saved', 'success');
            }
        } catch (_) {
            toast('VRoid Hub authorized — token saved', 'success');
        }

        this.updateSourceStatuses();
    },

    async _refreshVroidToken() {
        const v = this.credentials.vroid;
        if (!v || !v.refreshToken) return false;
        // For server-configured apps, server fills client_id/client_secret from env
        const isServerCfg = v._serverConfigured;
        if (!isServerCfg && (!v.appId || !v.appSecret)) return false;

        try {
            const params = {
                grant_type: 'refresh_token',
                refresh_token: v.refreshToken,
            };
            // Only send client credentials if not server-configured (server uses env vars)
            if (!isServerCfg) {
                params.client_id = v.appId;
                params.client_secret = v.appSecret;
            }
            const res = await fetch('/api/vroid-hub', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'token', params }),
            });
            const data = await res.json();
            if (data.access_token) {
                this.credentials.vroid.accessToken = data.access_token;
                this.credentials.vroid.refreshToken = data.refresh_token || v.refreshToken;
                this.credentials.vroid.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
                localStorage.setItem('vrm_manager_credentials', JSON.stringify(this.credentials));
                return true;
            }
        } catch (e) {
            console.warn('[VRM-Manager] VRoid token refresh failed:', e);
        }
        return false;
    },

    async _getVroidToken() {
        const v = this.credentials.vroid;
        if (!v || !v.accessToken) return null;

        // If token expires within 5 minutes, try to refresh proactively
        if (v.tokenExpiresAt && Date.now() > v.tokenExpiresAt - 300000) {
            const refreshed = await this._refreshVroidToken();
            // If refresh fails, still return the token — let the API decide
            // (the 401 handler in fetchVroidHubAvatars will catch truly expired tokens)
            if (!refreshed) {
                console.log('[VRM-Manager] Token may be expired, trying anyway...');
            }
        }
        return this.credentials.vroid.accessToken;
    },

    /**
     * Fetch VRoid Hub avatars using the connected OAuth token.
     *
     * Sources (fetched in parallel):
     *   1. Staff picks — curated popular models, always has content
     *   2. Hearts — user's liked models (requires user-scoped token + application_id)
     *
     * All models shown in catalog. Non-downloadable get "♥ Like to Download" CTA.
     */
    // Pagination state for VRoid Hub discovery — tracks next-page cursors per keyword
    _vroidPagination: {
        seenIds: new Set(),
        // Each entry: { keyword, nextUrl (full query string from _links.next.href), exhausted }
        cursors: [],
        loadingMore: false,
    },

    async fetchVroidHubAvatars() {
        const token = await this._getVroidToken();
        if (!token) return [];

        const appId = this.credentials.vroid.appId || '';
        const authHeaders = { Authorization: `Bearer ${token}` };

        // Diverse discovery keywords — chosen to minimize overlap and maximize unique results.
        // Japanese keywords tap into VRoid Hub's large JP creator base.
        const DISCOVERY_KEYWORDS = [
            'VRM',
            'avatar',
            'anime',
            'original',
            'vtuber',
            'girl',
            'boy',
            'fantasy',
            'cute',
            'cool',
            'uniform',
            'maid',
            'knight',
            'witch',
            'robot',
        ];

        // Reset pagination state
        this._vroidPagination = { seenIds: new Set(), cursors: [], loadingMore: false };
        const { seenIds } = this._vroidPagination;

        try {
            // Fetch staff picks + hearts + discovery searches in parallel
            const fetchers = [
                // [0] Staff picks — curated by VRoid Hub team
                fetch('/api/vroid-hub?action=staff_picks&count=100', { headers: authHeaders }),
            ];

            // [1] Hearts — user's liked models (requires application_id)
            if (appId) {
                fetchers.push(
                    fetch(`/api/vroid-hub?action=hearts&count=100&application_id=${appId}`, {
                        headers: authHeaders,
                    })
                );
            }

            // [2+] Discovery searches — broad keyword queries for variety
            for (const kw of DISCOVERY_KEYWORDS) {
                fetchers.push(
                    fetch(`/api/vroid-hub?action=search&keyword=${encodeURIComponent(kw)}&count=100`, {
                        headers: authHeaders,
                    })
                );
            }

            const results = await Promise.allSettled(fetchers);

            // Handle 401 on staff_picks — token expired
            if (results[0].status === 'fulfilled' && results[0].value.status === 401) {
                const refreshed = await this._refreshVroidToken();
                if (refreshed) return this.fetchVroidHubAvatars(); // retry once
                return [];
            }

            const mapped = [];
            let heartsCount = 0;
            let staffCount = 0;
            let searchCount = 0;

            // Helper: process an array of VRoid models into mapped items
            const processModels = (models, userLiked) => {
                let count = 0;
                for (const m of models) {
                    const modelData = m.heart?.character_model || m.character_model || m;
                    const modelId = modelData.id || m.id;
                    if (seenIds.has(modelId)) continue;
                    seenIds.add(modelId);
                    mapped.push(this._mapVroidModel(m, userLiked));
                    count++;
                }
                return count;
            };

            // Process hearts first (user's liked models — highest priority, installable)
            const heartsIdx = appId ? 1 : -1;
            if (heartsIdx >= 0 && results[heartsIdx]?.status === 'fulfilled' && results[heartsIdx].value.ok) {
                const heartsData = await results[heartsIdx].value.json();
                heartsCount = processModels(heartsData.data || [], true);
            } else if (heartsIdx >= 0 && results[heartsIdx]?.status === 'fulfilled' && !results[heartsIdx].value.ok) {
                console.warn('[VRM-Manager] VRoid hearts: HTTP', results[heartsIdx].value.status);
            }

            // Process staff picks
            if (results[0].status === 'fulfilled' && results[0].value.ok) {
                const staffData = await results[0].value.json();
                staffCount = processModels(staffData.data || [], false);
            } else if (results[0].status === 'fulfilled') {
                console.warn('[VRM-Manager] VRoid staff_picks: HTTP', results[0].value.status);
            }

            // Process discovery search results + store pagination cursors
            const searchStartIdx = appId ? 2 : 1;
            for (let i = 0; i < DISCOVERY_KEYWORDS.length; i++) {
                const idx = searchStartIdx + i;
                if (results[idx]?.status === 'fulfilled' && results[idx].value.ok) {
                    const searchData = await results[idx].value.json();
                    searchCount += processModels(searchData.data || [], false);

                    // Store pagination cursor for this keyword if more pages exist
                    const nextHref = searchData._links?.next?.href || searchData.links?.next?.href || '';
                    if (nextHref) {
                        // Extract search_after[] params from the next URL
                        const nextUrl = new URL(nextHref, 'https://hub.vroid.com');
                        const searchAfter = nextUrl.searchParams.getAll('search_after[]');
                        if (searchAfter.length > 0) {
                            this._vroidPagination.cursors.push({
                                keyword: DISCOVERY_KEYWORDS[i],
                                searchAfter,
                                exhausted: false,
                            });
                        }
                    } else {
                        // No next page — mark as exhausted
                        this._vroidPagination.cursors.push({
                            keyword: DISCOVERY_KEYWORDS[i],
                            searchAfter: null,
                            exhausted: true,
                        });
                    }
                }
            }

            if (mapped.length > 0) {
                const moreAvailable = this._vroidPagination.cursors.some((c) => !c.exhausted);
                console.log(
                    `[VRM-Manager] VRoid Hub: ${mapped.length} models ` +
                        `(${heartsCount} liked, ${staffCount} staff picks, ${searchCount} discovered)` +
                        (moreAvailable ? ' — more pages available' : '')
                );
            } else {
                console.log(
                    '[VRM-Manager] VRoid Hub connected but no models found. ' +
                        'Like models on hub.vroid.com to see them here.'
                );
            }
            return mapped;
        } catch (e) {
            console.warn('[VRM-Manager] VRoid Hub fetch error:', e);
            return [];
        }
    },

    /**
     * Fetch the next page of VRoid Hub discovery results.
     * Called when the user clicks "Load More" and all current client items are displayed.
     * Returns new models appended to allItems, or empty array if no more pages.
     */
    async fetchMoreVroidHubAvatars() {
        const pag = this._vroidPagination;
        if (pag.loadingMore) return [];

        // Find cursors that still have pages
        const active = pag.cursors.filter((c) => !c.exhausted);
        if (active.length === 0) return [];

        pag.loadingMore = true;
        const token = await this._getVroidToken();
        if (!token) {
            pag.loadingMore = false;
            return [];
        }
        const authHeaders = { Authorization: `Bearer ${token}` };

        try {
            // Fetch next page for each active cursor in parallel
            const fetchers = active.map((cursor) => {
                const saParams = cursor.searchAfter.map((v) => `search_after[]=${encodeURIComponent(v)}`).join('&');
                return fetch(
                    `/api/vroid-hub?action=search&keyword=${encodeURIComponent(cursor.keyword)}&count=100&${saParams}`,
                    { headers: authHeaders }
                );
            });

            const results = await Promise.allSettled(fetchers);
            const mapped = [];
            let newCount = 0;

            for (let i = 0; i < active.length; i++) {
                if (results[i]?.status !== 'fulfilled' || !results[i].value.ok) {
                    active[i].exhausted = true;
                    continue;
                }
                const data = await results[i].value.json();
                const models = data.data || [];

                for (const m of models) {
                    const modelData = m.heart?.character_model || m.character_model || m;
                    const modelId = modelData.id || m.id;
                    if (pag.seenIds.has(modelId)) continue;
                    pag.seenIds.add(modelId);
                    mapped.push(this._mapVroidModel(m, false));
                    newCount++;
                }

                // Update cursor for next page
                const nextHref = data._links?.next?.href || data.links?.next?.href || '';
                if (nextHref && models.length > 0) {
                    const nextUrl = new URL(nextHref, 'https://hub.vroid.com');
                    const searchAfter = nextUrl.searchParams.getAll('search_after[]');
                    if (searchAfter.length > 0) {
                        active[i].searchAfter = searchAfter;
                    } else {
                        active[i].exhausted = true;
                    }
                } else {
                    active[i].exhausted = true;
                }
            }

            if (newCount > 0) {
                console.log(`[VRM-Manager] VRoid Hub: loaded ${newCount} more models (total: ${pag.seenIds.size})`);
            }

            pag.loadingMore = false;
            return mapped;
        } catch (e) {
            console.warn('[VRM-Manager] VRoid Hub pagination error:', e);
            pag.loadingMore = false;
            return [];
        }
    },

    /**
     * Check if more VRoid Hub pages are available for lazy loading.
     */
    hasMoreVroidHubPages() {
        return this._vroidPagination.cursors.some((c) => !c.exhausted);
    },

    /**
     * Search VRoid Hub models by keyword.
     */
    async searchVroidHub(keyword) {
        const token = await this._getVroidToken();
        if (!token) return [];

        try {
            const res = await fetch(`/api/vroid-hub?action=search&keyword=${encodeURIComponent(keyword)}&count=100`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return [];
            const data = await res.json();
            return (data.data || []).map((m) => this._mapVroidModel(m, false));
        } catch (e) {
            console.warn('[VRM-Manager] VRoid Hub search error:', e);
            return [];
        }
    },

    /**
     * Map a VRoid Hub character_model API object to our catalog item format.
     *
     * Handles multiple API response structures:
     *   - Hearts:       { heart: { character_model: { id, name, user, character_model_version, ... } } }
     *   - Staff picks:  { id, name, character: { user }, portrait_image, latest_character_model_version, ... }
     *   - Search:       Same as staff picks
     *
     * @param {object} m - Raw API model object
     * @param {boolean} userLiked - Whether this model was liked (from hearts endpoint)
     */
    _mapVroidModel(m, userLiked = false) {
        // Extract the core model data from various nesting patterns
        const modelData = m.heart?.character_model || m.character_model || m;

        // Helper: extract URL from an image field.
        // VRoid API returns ImageSerializer objects: { url: "...", url2x: "...", width, height }
        // Some fields may be plain strings (e.g. from hearts/older API versions).
        const imgUrl = (img) => {
            if (!img) return '';
            if (typeof img === 'string') return img;
            return img.url || '';
        };

        // Thumbnail: try all known image paths
        // Hearts: character_model_version.images[0].sq170
        // Staff picks/search: portrait_image.sq300 / sq150 / full_body_image.sq300
        const thumb =
            imgUrl(modelData.character_model_version?.images?.[0]?.sq170) ||
            imgUrl(modelData.character_model_version?.images?.[0]?.sq150) ||
            imgUrl(modelData.portrait_image?.sq300) ||
            imgUrl(modelData.portrait_image?.sq150) ||
            imgUrl(modelData.full_body_image?.sq300) ||
            imgUrl(modelData.full_body_image?.sq150) ||
            imgUrl(m.portrait_image?.sq300) ||
            imgUrl(m.portrait_image?.sq150) ||
            imgUrl(m.heart?.character_model?.portrait_image?.sq150) ||
            '';

        // Name: model name, or character name, or user name as fallback
        const name =
            modelData.name ||
            modelData.character?.name ||
            modelData.user?.name ||
            modelData.character?.user?.name ||
            'VRoid Hub Avatar';

        // Creator: user is at model.user (hearts) or model.character.user (staff picks/search)
        const creator =
            modelData.user?.name ||
            modelData.character?.user?.name ||
            m.heart?.character_model?.user?.name ||
            'Unknown';

        const isDownloadable = modelData.is_downloadable !== undefined ? modelData.is_downloadable : true;

        // Version ID: character_model_version (hearts) or latest_character_model_version (staff picks)
        const versionId = modelData.character_model_version?.id || modelData.latest_character_model_version?.id || '';

        // URL format: /characters/{CHARACTER_ID}/models/{MODEL_ID}
        // character.id is the parent character; modelData.id is the model itself
        const characterId = modelData.character?.id || m.heart?.character_model?.character?.id || modelData.id;
        const vroidPageUrl = `https://hub.vroid.com/en/characters/${characterId}/models/${modelData.id}`;

        // A model can only be installed if the user has liked it AND it's downloadable
        const canInstall = userLiked && isDownloadable;

        // Extract conditions of use from VRoid Hub license object (VRM 1.0 fields)
        const lic = modelData.license || {};
        const conditionsOfUse = {
            avatarUse: lic.characterization_allowed_user || 'default',
            violentExpression: lic.violent_expression || 'default',
            sexualExpression: lic.sexual_expression || 'default',
            corporateCommercialUse: lic.corporate_commercial_use || 'default',
            personalCommercialUse: lic.personal_commercial_use || 'default',
            redistribution: lic.redistribution || 'default',
            modification: lic.modification || 'default',
            credit: lic.credit || 'default',
        };

        // Description varies by state
        let desc = `By ${creator} on VRoid Hub.`;
        if (!isDownloadable) {
            desc += ' See on VRoid Hub to enable download.';
        } else if (!userLiked) {
            desc += ' See on VRoid Hub to install.';
        }

        return {
            id: `vroid-hub-${modelData.id || Math.random().toString(36).slice(2)}`,
            name,
            desc,
            source: 'VRoid Hub',
            sourceId: 'vroid-hub',
            format: 'vrm',
            license: 'vroid-hub-terms',
            // Only use vroid-hub: URL scheme for models the user can actually download
            url: canInstall ? `vroid-hub:${modelData.id}` : vroidPageUrl,
            preview: thumb,
            icon: '🌐',
            tags: ['vroid-hub', 'community', ...(modelData.tags || []).map((t) => t.name || t).slice(0, 2)],
            features: ['lipsync', 'emotions', 'gaze', 'blink'],
            size: modelData.latest_character_model_version?.original_file_size || 0,
            likeCount: modelData.heart_count || 0,
            vroidModelId: modelData.id,
            vroidPageUrl,
            isDownloadable: canInstall, // true only when user can actually install
            userLiked,
            conditionsOfUse,
        };
    },

    /**
     * Render VRoid Hub "Model Data Conditions of Use" panel (per VRoid developer guidelines).
     */
    _renderConditionsOfUse(cou) {
        const labelMap = {
            avatarUse: 'Avatar Use',
            violentExpression: 'Violent Expression',
            sexualExpression: 'Sexual Expression',
            corporateCommercialUse: 'Corporate Commercial Use',
            personalCommercialUse: 'Personal Commercial Use',
            redistribution: 'Redistribution',
            modification: 'Modification',
            credit: 'Credit',
        };
        const valueLabel = (v) => {
            if (v === 'allow' || v === 'everyone') return '✅ Allow';
            if (v === 'disallow') return '❌ Disallow';
            if (v === 'author') return '👤 Author Only';
            if (v === 'necessary') return '📝 Required';
            if (v === 'unnecessary') return '—  Not Required';
            if (v === 'profit') return '✅ Profit OK';
            if (v === 'nonprofit') return '⚠️ Nonprofit Only';
            return '— Not Set';
        };
        const rows = Object.entries(cou)
            .map(
                ([k, v]) =>
                    `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px"><span style="color:var(--vm-text-muted)">${labelMap[k] || k}</span><span>${valueLabel(v)}</span></div>`
            )
            .join('');
        return `<div style="margin-top:16px;padding:12px;background:rgba(255,193,7,0.06);border-radius:8px;border:1px solid rgba(255,193,7,0.2)">
        <div style="font-size:11px;color:#ffc107;font-weight:600;margin-bottom:6px">MODEL DATA CONDITIONS OF USE</div>
        ${rows}
      </div>`;
    },

    /**
     * Download a VRoid Hub model via download_license flow.
     * Returns the S3 presigned URL for the VRM file, or an object with error details.
     *
     * VRoid Hub requires:
     * 1. The model must have is_downloadable=true
     * 2. The user must have "liked" (hearted) the model on hub.vroid.com
     * 3. The model owner must allow downloads for the app
     */
    async getVroidHubDownloadUrl(characterModelId) {
        const token = await this._getVroidToken();
        if (!token) return null;

        try {
            // Step 1: Create download license
            const licRes = await fetch(
                `/api/vroid-hub?action=download_license&character_model_id=${characterModelId}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!licRes.ok) {
                const errData = await licRes.json().catch(() => ({}));
                const errCode = errData.error?.code || '';
                console.warn('[VRM-Manager] VRoid download license error:', licRes.status, errCode);

                // 404 = model not found or user hasn't liked it
                // 403 = model doesn't allow downloads for this app
                if (licRes.status === 404 || licRes.status === 403) {
                    toast(
                        `Cannot download this model. Visit hub.vroid.com, find this model, and click the ♥ (Like) button first. Then try again.`,
                        'error',
                        8000
                    );
                }
                return null;
            }
            const licData = await licRes.json();
            const licenseId = licData.data?.id;
            if (!licenseId) return null;

            // Step 2: Get download URL (S3 presigned)
            const dlRes = await fetch(`/api/vroid-hub?action=download&license_id=${licenseId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const dlData = await dlRes.json();
            return dlData.download_url || null;
        } catch (e) {
            console.warn('[VRM-Manager] VRoid download error:', e);
            return null;
        }
    },

    /* ── Open Source Avatars (GitHub JSON — nested format) ── */

    async fetchOpenSourceAvatars() {
        const OSA_BASE = 'https://raw.githubusercontent.com/ToxSam/open-source-avatars/main/data';
        try {
            const res = await fetch(`${OSA_BASE}/projects.json`, { mode: 'cors' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const projects = await res.json();

            // Each project has avatar_data_file pointing to a nested JSON
            // that contains the actual avatar entries with model_file_url
            const dataFetches = projects
                .filter((p) => p.avatar_data_file)
                .slice(0, 30) // cap to avoid too many requests
                .map(async (proj) => {
                    try {
                        const dataUrl = `${OSA_BASE}/${proj.avatar_data_file}`;
                        const r = await fetch(dataUrl, { mode: 'cors' });
                        if (!r.ok) return [];
                        const data = await r.json();

                        // data may be an array or have an "avatars" key
                        const entries = Array.isArray(data) ? data : data.avatars || data.models || [];
                        return entries
                            .map((av) => {
                                const downloadUrl = av.model_file_url || av.download_url || av.vrm_url || '';
                                if (!downloadUrl) return null;
                                const name = av.name || av.title || proj.name || 'Unknown';
                                return {
                                    id: `osa-${(av.id || av.slug || name)
                                        .toString()
                                        .replace(/[^a-zA-Z0-9]/g, '-')
                                        .toLowerCase()}-${Math.random().toString(36).slice(2, 6)}`,
                                    name,
                                    desc: (
                                        av.description ||
                                        proj.description ||
                                        'CC0 avatar from Open Source Avatars.'
                                    ).slice(0, 150),
                                    source: 'Open Source Avatars',
                                    sourceId: 'opensourceavatars',
                                    format: downloadUrl.endsWith('.glb') ? 'glb' : 'vrm',
                                    license: (av.license || proj.license || 'cc0').toLowerCase(),
                                    url: downloadUrl,
                                    preview: av.thumbnail_url || av.image || proj.thumbnail || '',
                                    icon: '🆓',
                                    tags: ['cc0', 'open-source'],
                                    features: ['lipsync', 'emotions', 'gaze', 'blink'],
                                    size: av.file_size || 0,
                                };
                            })
                            .filter(Boolean);
                    } catch (_) {
                        return [];
                    }
                });

            const results = await Promise.allSettled(dataFetches);
            const avatars = [];
            for (const r of results) {
                if (r.status === 'fulfilled') avatars.push(...r.value);
            }
            console.log(`[VRM-Manager] Open Source Avatars: found ${avatars.length} models`);
            return avatars;
        } catch (e) {
            console.warn('[VRM-Manager] Open Source Avatars fetch error:', e);
            return [];
        }
    },

    /* ── GitHub: madjin/vrm-samples (recursive tree) ──── */

    _generateVRMSampleSVG(name) {
        const colors = ['#e040fb', '#ff4081', '#7c4dff', '#00e5ff', '#ff9100', '#69f0ae', '#ea80fc', '#ffab40'];
        const hash = name.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
        const bg = colors[Math.abs(hash) % colors.length];
        const initial = (name.charAt(0) || '?').toUpperCase();
        const label = name.length > 18 ? name.slice(0, 18) + '...' : name;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="320" viewBox="0 0 256 320">
      <defs><linearGradient id="g${hash}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${bg}" stop-opacity="0.15"/><stop offset="100%" stop-color="${bg}" stop-opacity="0.03"/></linearGradient></defs>
      <rect width="256" height="320" rx="12" fill="url(#g${hash})"/>
      <circle cx="128" cy="100" r="40" fill="${bg}" opacity="0.18"/>
      <ellipse cx="128" cy="185" rx="55" ry="45" fill="${bg}" opacity="0.10"/>
      <text x="128" y="115" text-anchor="middle" font-family="sans-serif" font-size="36" font-weight="700" fill="${bg}" opacity="0.6">${initial}</text>
      <text x="128" y="260" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="600" fill="${bg}" opacity="0.7">${label}</text>
      <text x="128" y="282" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${bg}" opacity="0.4">CC0 \u00b7 VRM</text>
      <rect x="98" y="295" width="60" height="18" rx="9" fill="${bg}" opacity="0.12"/>
      <text x="128" y="308" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="600" fill="${bg}" opacity="0.5">GitHub</text>
    </svg>`;
        return `data:image/svg+xml;base64,${btoa(svg)}`;
    },

    async fetchGitHubVRMSamples() {
        // Files are spread across subdirectories, use Git Trees API with recursive flag
        const API_URL = 'https://api.github.com/repos/madjin/vrm-samples/git/trees/master?recursive=1';
        const RAW_BASE = 'https://raw.githubusercontent.com/madjin/vrm-samples/master';
        try {
            const res = await fetch(API_URL, { mode: 'cors', headers: { Accept: 'application/vnd.github.v3+json' } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            const avatars = (data.tree || [])
                .filter((f) => f.path.endsWith('.vrm') && f.type === 'blob')
                .map((f) => {
                    const fileName = f.path.split('/').pop();
                    const displayName = fileName.replace('.vrm', '').replace(/[_-]/g, ' ');
                    return {
                        id: `vrm-samples-${fileName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`,
                        name: displayName,
                        desc: 'CC0 VRM from madjin/vrm-samples repository.',
                        source: 'VRM Samples (GitHub)',
                        sourceId: 'github-vrm-samples',
                        format: 'vrm',
                        license: 'cc0',
                        url: `${RAW_BASE}/${f.path}`,
                        preview: this._generateVRMSampleSVG(displayName),
                        icon: '📦',
                        tags: ['cc0', 'github', 'vrm-samples'],
                        features: ['lipsync', 'emotions', 'gaze', 'blink'],
                        size: f.size || 0,
                    };
                });

            console.log(`[VRM-Manager] VRM Samples: found ${avatars.length} models`);
            return avatars;
        } catch (e) {
            console.warn('[VRM-Manager] VRM Samples fetch error:', e);
            return [];
        }
    },

    /* ── HomePilot Avatar Hub ────── */

    async fetchHomePilotCatalog() {
        const CATALOG_URL = 'https://homepilotai.github.io/vrm-avatar-catalog/catalog.json';
        try {
            const res = await fetch(CATALOG_URL, { mode: 'cors' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const catalog = await res.json();

            const avatars = catalog
                .filter((entry) => {
                    const url = entry.public_url || '';
                    // Must have a URL
                    if (!url && !entry.object_key) return false;
                    // Skip entries where public_url is a web page (not a direct model file)
                    // e.g. VRoid Hub pages like hub.vroid.com/en/characters/.../models/...
                    if (
                        url &&
                        !url.match(/\.(vrm|glb|gltf)(\?.*)?$/i) &&
                        !url.includes('r2.dev') &&
                        !url.includes('avatars.yourfriend.online')
                    )
                        return false;
                    return true;
                })
                .map((entry) => {
                    const format = (entry.format_type || 'vrm').toLowerCase();
                    const isVrm = format === 'vrm';
                    const sourceProject = entry.source_project || entry.source_name || 'homepilot';
                    return {
                        id: `hp-${(entry.id || entry.name || '')
                            .replace(/[^a-zA-Z0-9]/g, '-')
                            .toLowerCase()
                            .slice(0, 60)}`,
                        name: entry.name || entry.filename || 'Unknown',
                        desc: `From ${sourceProject.replace(/[-_]/g, ' ')}. ${entry.license || 'Free'}. ${entry.quality === 'curated' ? 'Curated quality.' : ''}`.trim(),
                        source: 'HomePilot Hub',
                        sourceId: 'homepilot-hub',
                        sourceCategory: entry.source_category || 'unknown',
                        format: isVrm ? 'vrm' : 'glb',
                        license: (entry.license || 'free').toLowerCase().includes('cc0')
                            ? 'cc0'
                            : (entry.license || '').toLowerCase().includes('cc-by')
                              ? 'cc-by'
                              : (entry.license || '').toLowerCase().includes('vroid hub')
                                ? 'vroid-hub-terms'
                                : 'free',
                        url: entry.public_url || '',
                        preview: entry.thumbnail_url || '',
                        icon: '🧑‍🚀',
                        tags: [sourceProject, entry.quality || 'community', format].filter(Boolean),
                        features: isVrm ? ['lipsync', 'emotions', 'gaze', 'blink'] : [],
                        size: entry.size_bytes || 0,
                        likeCount: (entry.metadata && entry.metadata.like_count) || 0,
                        quality: entry.quality || 'community',
                        homepilotId: entry.id || '',
                    };
                })
                .filter((a) => a.url);

            console.log(`[VRM-Manager] HomePilot Hub: found ${avatars.length} avatars`);
            return avatars;
        } catch (e) {
            console.warn('[VRM-Manager] HomePilot Hub fetch error:', e);
            return [];
        }
    },

    /* ── Custom Catalog Source Fetch ─────────────────── */

    async fetchCustomCatalog(customSrc) {
        try {
            // Build fetch headers — include auth token for private sources
            const headers = {};
            if (customSrc.isPrivate) {
                const token = localStorage.getItem(`vrm_src_token_${customSrc.id}`) || '';
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                    headers['Accept'] = 'application/vnd.github.v3.raw';
                    headers['X-GitHub-Api-Version'] = '2022-11-28';
                }
            }
            const res = await fetch(customSrc.catalogUrl, { mode: 'cors', headers });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const catalog = await res.json();

            // Support both array and {items:[...]} formats
            const entries = Array.isArray(catalog) ? catalog : catalog.items || [];

            const avatars = entries
                .filter((entry) => {
                    const url = entry.public_url || entry.url || entry.model_url || '';
                    if (!url) return false;
                    return true;
                })
                .map((entry) => {
                    const url = entry.public_url || entry.url || entry.model_url || '';
                    const format = (entry.format_type || entry.format || 'vrm').toLowerCase();
                    const isVrm = format === 'vrm';
                    return {
                        id: `custom-${customSrc.id}-${(entry.id || entry.name || Math.random().toString(36).slice(2))
                            .replace(/[^a-zA-Z0-9]/g, '-')
                            .toLowerCase()
                            .slice(0, 60)}`,
                        name: entry.name || entry.filename || 'Unknown',
                        desc: `From ${customSrc.name}. ${entry.license || 'Free'}.`.trim(),
                        source: customSrc.name,
                        sourceId: customSrc.id,
                        sourceCategory: entry.source_category || 'custom',
                        format: isVrm ? 'vrm' : 'glb',
                        license: (entry.license || 'free').toLowerCase().includes('cc0')
                            ? 'cc0'
                            : (entry.license || '').toLowerCase().includes('cc-by')
                              ? 'cc-by'
                              : (entry.license || '').toLowerCase().includes('vroid hub')
                                ? 'vroid-hub-terms'
                                : 'free',
                        url: url,
                        preview: entry.thumbnail_url || entry.preview || '',
                        icon: customSrc.icon || '📂',
                        tags: [customSrc.name, entry.quality || 'community', format].filter(Boolean),
                        features: isVrm ? ['lipsync', 'emotions', 'gaze', 'blink'] : [],
                        size: entry.size_bytes || entry.size || 0,
                        likeCount: (entry.metadata && entry.metadata.like_count) || 0,
                        quality: entry.quality || 'community',
                    };
                })
                .filter((a) => a.url);

            console.log(`[VRM-Manager] Custom source "${customSrc.name}": found ${avatars.length} avatars`);
            return avatars;
        } catch (e) {
            console.warn(`[VRM-Manager] Custom source "${customSrc.name}" fetch error:`, e);
            return [];
        }
    },

    /* ── Add Source Wizard ────────────────────────────── */

    openAddSourceWizard() {
        const modal = el('vm-add-source-modal');
        if (!modal) return;
        // Reset wizard state
        const stepUrl = el('vm-addsrc-step-url');
        const stepReview = el('vm-addsrc-step-review');
        const stepResult = el('vm-addsrc-step-result');
        if (stepUrl) stepUrl.classList.remove('vm-hidden');
        if (stepReview) stepReview.classList.add('vm-hidden');
        if (stepResult) stepResult.classList.add('vm-hidden');
        const input = el('vm-addsrc-url-input');
        if (input) input.value = '';
        const tokenInput = el('vm-addsrc-token-input');
        if (tokenInput) tokenInput.value = '';
        const authDetails = el('vm-addsrc-auth-details');
        if (authDetails) authDetails.removeAttribute('open');
        modal.classList.remove('vm-hidden');
        if (input) setTimeout(() => input.focus(), 100);
    },

    closeAddSourceWizard() {
        const modal = el('vm-add-source-modal');
        if (modal) modal.classList.add('vm-hidden');
    },

    async probeSourceUrl(rawUrl) {
        rawUrl = (rawUrl || '').trim();
        if (!rawUrl) {
            toast('Please enter a URL', 'error');
            return;
        }

        // Read optional GitHub PAT for private repo access
        const tokenInput = el('vm-addsrc-token-input');
        const token = ((tokenInput && tokenInput.value) || '').trim();

        // Build a list of candidate URLs to try in order
        // Each candidate: { url, headers } — headers carry auth when needed
        const candidates = [];

        const ghRepoMatch = rawUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i);

        // If a token is provided AND this is a GitHub repo, use ONLY the GitHub Contents API.
        // Don't try public URLs — they'll CORS-fail for private repos and spam the console.
        if (token && ghRepoMatch) {
            const [, owner, repo] = ghRepoMatch;
            const authHeaders = {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github.v3.raw',
                'X-GitHub-Api-Version': '2022-11-28',
            };
            candidates.push({
                url: `https://api.github.com/repos/${owner}/${repo}/contents/docs/catalog.json`,
                headers: authHeaders,
            });
            candidates.push({
                url: `https://api.github.com/repos/${owner}/${repo}/contents/catalog.json`,
                headers: authHeaders,
            });
        } else if (ghRepoMatch) {
            // Public repo — try GitHub Pages and raw URLs
            const [, owner, repo] = ghRepoMatch;
            candidates.push({ url: `https://${owner.toLowerCase()}.github.io/${repo}/catalog.json`, headers: {} });
            candidates.push({
                url: `https://raw.githubusercontent.com/${owner}/${repo}/main/docs/catalog.json`,
                headers: {},
            });
            candidates.push({
                url: `https://raw.githubusercontent.com/${owner}/${repo}/main/catalog.json`,
                headers: {},
            });
            candidates.push({
                url: `https://raw.githubusercontent.com/${owner}/${repo}/master/docs/catalog.json`,
                headers: {},
            });
        }

        // If it already ends with .json, try it directly (no auth — public URL)
        if (!token && rawUrl.endsWith('.json')) {
            candidates.push({ url: rawUrl, headers: {} });
        }

        // Generic URL without catalog.json (only for non-GitHub or no-token)
        if (!token && !rawUrl.endsWith('.json')) {
            candidates.push({ url: rawUrl.replace(/\/+$/, '') + '/catalog.json', headers: {} });
        }

        // Deduplicate by URL
        const seen = new Set();
        const uniqueCandidates = candidates.filter((c) => {
            if (seen.has(c.url)) return false;
            seen.add(c.url);
            return true;
        });

        const statusEl = el('vm-addsrc-status');
        if (statusEl) statusEl.textContent = 'Fetching catalog...';

        let catalogUrl = null;
        let catalogHeaders = {};
        let data = null;

        for (const candidate of uniqueCandidates) {
            try {
                if (statusEl) statusEl.textContent = `Trying ${new URL(candidate.url).hostname}...`;
                const res = await fetch(candidate.url, {
                    mode: 'cors',
                    headers: candidate.headers,
                });
                if (!res.ok) {
                    console.warn(`[VRM-Manager] Source probe ${res.status} for ${candidate.url}`);
                    // For GitHub API, provide specific feedback
                    if (candidate.url.includes('api.github.com') && res.status === 404) {
                        const body = await res.json().catch(() => null);
                        console.warn(
                            '[VRM-Manager] GitHub API 404 — repo may not exist, token may lack access, or catalog.json not found at this path.',
                            body?.message || ''
                        );
                    }
                    if (candidate.url.includes('api.github.com') && res.status === 401) {
                        if (statusEl) statusEl.textContent = '';
                        toast('Invalid GitHub token. Check that your PAT is correct and not expired.', 'error');
                        return;
                    }
                    if (candidate.url.includes('api.github.com') && res.status === 403) {
                        if (statusEl) statusEl.textContent = '';
                        toast(
                            'Token lacks "Contents: Read" permission. Edit your fine-grained PAT → Repository permissions → Contents → set to Read.',
                            'error'
                        );
                        return;
                    }
                    continue;
                }
                const contentType = res.headers.get('content-type') || '';
                if (contentType.includes('text/html')) continue; // Skip HTML pages
                const parsed = await res.json();
                const entries = Array.isArray(parsed) ? parsed : parsed.items || [];
                if (entries.length > 0) {
                    catalogUrl = candidate.url;
                    catalogHeaders = candidate.headers;
                    data = parsed;
                    break;
                }
            } catch (_) {
                continue;
            }
        }

        if (!catalogUrl || !data) {
            if (statusEl) statusEl.textContent = '';
            const hint = token
                ? 'Could not find a valid catalog. Check that the token has Contents:Read permission and the repo contains a catalog.json.'
                : 'Could not find a valid catalog at that URL. Make sure it points to a JSON catalog.';
            toast(hint, 'error');
            return;
        }

        try {
            const entries = Array.isArray(data) ? data : data.items || [];
            if (!entries.length) throw new Error('Catalog is empty or has no entries');

            // Extract info from the catalog
            const first = entries[0];
            const sourceName =
                first.source_label || first.origin_name || first.source_name || new URL(catalogUrl).hostname;
            const formats = new Set();
            const licenses = new Set();
            entries.forEach((e) => {
                formats.add(e.format_type || e.format || 'vrm');
                if (e.license) licenses.add(e.license);
            });

            // Extract base URL for display
            const urlObj = new URL(catalogUrl);
            const displayUrl = urlObj.hostname + urlObj.pathname.replace(/\/catalog\.json$/, '');

            // Show review step
            const stepUrl = el('vm-addsrc-step-url');
            const stepReview = el('vm-addsrc-step-review');
            if (stepUrl) stepUrl.classList.add('vm-hidden');
            if (stepReview) stepReview.classList.remove('vm-hidden');

            const reviewEl = el('vm-addsrc-review-content');
            if (reviewEl) {
                const fmtBadges = [...formats]
                    .map((f) => {
                        const cls =
                            f === 'vrm' ? 'vm-badge-vrm' : f === 'glb-morph' ? 'vm-badge-glb-morph' : 'vm-badge-glb';
                        const label = f === 'vrm' ? 'VRM' : f === 'glb-morph' ? 'GLB+M' : 'GLB';
                        return `<span class="vm-badge ${cls}" style="font-size:10px">${label}</span>`;
                    })
                    .join(' ');

                reviewEl.innerHTML = `
                    <div class="vm-addsrc-preview-card">
                        <div class="vm-source-card-header">
                            <div class="vm-source-card-icon">📂</div>
                            <div>
                                <div class="vm-source-card-title">${esc(sourceName)}</div>
                                <div class="vm-source-card-url">${esc(displayUrl)}</div>
                            </div>
                        </div>
                        <div class="vm-addsrc-stats">
                            <span><strong>${entries.length.toLocaleString()}</strong> avatars</span>
                            <span>${fmtBadges}</span>
                            <span>${[...licenses].slice(0, 3).join(', ')}</span>
                        </div>
                    </div>
                    <div class="vm-addsrc-name-row">
                        <label for="vm-addsrc-name">Source name</label>
                        <input type="text" id="vm-addsrc-name" value="${esc(sourceName)}" spellcheck="false">
                    </div>
                    <div class="vm-addsrc-name-row">
                        <label for="vm-addsrc-icon">Icon (emoji)</label>
                        <input type="text" id="vm-addsrc-icon" value="📂" maxlength="4" style="width:60px">
                    </div>`;
            }

            // Store probe result for confirm step
            this._pendingSource = {
                catalogUrl,
                catalogHeaders, // Auth headers (empty for public sources)
                displayUrl,
                totalAvatars: entries.length,
                formats: [...formats],
                licenses: [...licenses].slice(0, 3),
                defaultName: sourceName,
                token: token || '', // GitHub PAT — stored locally for refresh
            };
        } catch (e) {
            if (statusEl) statusEl.textContent = '';
            toast(`Failed to fetch catalog: ${e.message}`, 'error');
        }
    },

    confirmAddSource() {
        if (!this._pendingSource) return;
        const nameInput = el('vm-addsrc-name');
        const iconInput = el('vm-addsrc-icon');
        const name = (nameInput && nameInput.value.trim()) || this._pendingSource.defaultName;
        const icon = (iconInput && iconInput.value.trim()) || '📂';

        const sourceId = `custom-${name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .slice(0, 30)}-${Date.now().toString(36)}`;

        const customSource = {
            id: sourceId,
            name: name,
            icon: icon,
            url: this._pendingSource.displayUrl,
            catalogUrl: this._pendingSource.catalogUrl,
            desc: `${this._pendingSource.totalAvatars.toLocaleString()} avatars. ${this._pendingSource.licenses.join(', ') || 'Free'}.`,
            formats: this._pendingSource.formats,
            totalAvatars: this._pendingSource.totalAvatars,
            addedAt: Date.now(),
        };
        // Store auth token separately (not in the source object) for security.
        // Token is stored per-source in localStorage under its own key.
        if (this._pendingSource.token) {
            try {
                localStorage.setItem(`vrm_src_token_${sourceId}`, this._pendingSource.token);
            } catch (_) {}
            customSource.isPrivate = true;
        }

        const added = addCustomSource(customSource);
        if (!added) {
            toast('This source is already added', 'error');
            return;
        }

        // Show success step
        const stepReview = el('vm-addsrc-step-review');
        const stepResult = el('vm-addsrc-step-result');
        if (stepReview) stepReview.classList.add('vm-hidden');
        if (stepResult) {
            stepResult.classList.remove('vm-hidden');
            stepResult.innerHTML = `
                <div class="vm-addsrc-success">
                    <div class="vm-addsrc-success-icon">${icon}</div>
                    <h3>${esc(name)}</h3>
                    <p>${this._pendingSource.totalAvatars.toLocaleString()} avatars added</p>
                    <p style="font-size:12px;color:var(--vm-text-muted)">Reload catalog to see avatars</p>
                    <button class="vm-btn vm-btn-primary" id="vm-addsrc-done-btn">Done &amp; Reload</button>
                </div>`;
            el('vm-addsrc-done-btn').addEventListener('click', () => {
                this.closeAddSourceWizard();
                this.buildSourceCards();
                this.loadCatalog();
            });
        }

        this._pendingSource = null;
    },

    removeSource(catalogUrl) {
        const custom = getCustomSources().find((s) => s.catalogUrl === catalogUrl);
        const name = custom ? custom.name : 'Source';
        if (!confirm(`Remove "${name}"? Its avatars will be removed from the catalog.`)) return;
        // Clean up stored auth token for private sources
        if (custom && custom.isPrivate) {
            try {
                localStorage.removeItem(`vrm_src_token_${custom.id}`);
            } catch (_) {}
        }
        removeCustomSource(catalogUrl);
        this.buildSourceCards();
        // Remove avatars from that source from both catalog and installed
        const sourceId = custom ? custom.id : '';
        if (sourceId) {
            allItems = allItems.filter((a) => a.sourceId !== sourceId);

            // Clean up installed avatars that came from this source
            let removedInstalled = 0;
            for (const [id, item] of Object.entries(installedAvatars)) {
                if (item.sourceId === sourceId && !item.core) {
                    delete installedAvatars[id];
                    removedInstalled++;
                }
            }
            if (removedInstalled > 0) this.saveInstalled();

            this.populateSourceFilter();
            this.applyFilters();
            this.renderInstalledGrid();
        }
        toast(`${name} removed`, 'info');
        this.updateHubBanner();
    },

    /* ── Direct URL Download ──────────────────────────── */

    async installFromUrl(url) {
        url = (url || '').trim();
        if (!url) {
            toast('Please enter a URL', 'error');
            return;
        }

        // Basic validation — must be a direct model file URL
        if (!/^https?:\/\/.+\.(vrm|glb|gltf)(\?.*)?$/i.test(url)) {
            // Give helpful message for VRoid Hub page URLs
            if (url.includes('hub.vroid.com')) {
                toast(
                    'This is a VRoid Hub page link, not a direct model file. Download the .vrm file from hub.vroid.com first, then install via "Add Avatar → From File".',
                    'error'
                );
            } else {
                toast('URL must point to a .vrm, .glb, or .gltf file', 'error');
            }
            return;
        }

        const fileName = url.split('/').pop().split('?')[0];
        const ext = fileName.split('.').pop().toLowerCase();
        const format = ext === 'vrm' ? 'vrm' : 'glb';
        const baseName = fileName.replace(/\.[^.]+$/, '');
        const id = `url-${Date.now()}-${sanitizeFileName(baseName)}`;

        toast(`Downloading ${fileName}...`, 'info');

        try {
            // Download the model file with retry + proxy fallback
            const res = await fetchModelUrl(url);
            if (!res.ok) throw new Error(`Download failed: ${res.status}`);

            // Validate response is actually a binary file
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('text/html')) {
                throw new Error(
                    'Server returned HTML instead of a model file. The URL may require authentication or may not be a direct download link.'
                );
            }

            // Stream body via getReader (more reliable than res.blob() for large files
            // streamed through Edge proxies, which can drop the connection mid-transfer).
            const reader = res.body.getReader();
            const chunks = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            const blob = new Blob(chunks);

            const item = {
                id,
                name: baseName,
                desc: `Downloaded from URL: ${url.slice(0, 80)}`,
                source: 'Direct URL',
                sourceId: 'direct-url',
                format,
                license: 'free',
                url,
                preview: '',
                icon: ext === 'vrm' ? '🔗' : '📦',
                tags: ['url-import', ext],
                features: ext === 'vrm' ? ['lipsync', 'emotions', 'gaze', 'blink'] : [],
                size: blob.size,
                localFile: fileName,
                installedAt: Date.now(),
            };

            // Cache blob
            await this.cacheBlob(id, blob, { name: item.name, format });

            // Add to installed
            installedAvatars[id] = item;
            this.saveInstalled();

            // Add to manifest
            if (this.settings.autoInstall !== false) {
                await this.addToManifest(item, fileName, blob);
            }

            // Add to catalog
            allItems.unshift(item);
            this.applyFilters();
            this.renderInstalledGrid();

            toast(`${baseName} installed successfully!`, 'success');

            // Clear the URL input
            const urlInput = el('vm-url-input');
            if (urlInput) urlInput.value = '';

            // Generate thumbnail in background
            generateAndSaveThumbnail(item).then((preview) => {
                if (preview) {
                    this.applyFilters();
                    this.renderInstalledGrid();
                }
            });
        } catch (e) {
            console.error('[VRM-Manager] URL install error:', e);
            toast(`Failed: ${e.message}`, 'error');
        }
    },

    /* ── Ready Player Me iFrame Creator ───────────────── */

    async openRPMCreator() {
        const subdomain = this.credentials?.rpm?.subdomain || 'demo';
        const apiKey = this.credentials?.rpm?.apiKey;
        const iframe = el('vm-rpm-iframe');
        const fallback = el('vm-rpm-fallback');
        const loader = el('vm-rpm-loader');

        el('vm-rpm-modal').classList.remove('vm-hidden');

        // Update external link to use configured subdomain
        const extLink = el('vm-rpm-external-link');
        if (extLink) extLink.href = `https://${subdomain}.readyplayer.me/avatar`;

        // Show loading state while iframe loads
        if (loader) loader.classList.remove('vm-hidden');
        iframe.classList.remove('vm-hidden');
        if (fallback) fallback.classList.add('vm-hidden');

        // Build iframe URL — always try iframe-first with frameApi
        let rpmUrl;
        if (apiKey) {
            // If API key is configured, try guest token for premium features
            try {
                const res = await fetch('/api/rpm-guest', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-rpm-api-key': apiKey,
                    },
                    body: JSON.stringify({ subdomain }),
                });
                if (res.ok) {
                    const data = await res.json();
                    rpmUrl = `https://${subdomain}.readyplayer.me/avatar?frameApi&token=${data.token}&clearCache&bodyType=fullbody`;
                }
            } catch (e) {
                console.warn('[VRM-Manager] RPM guest token failed, using demo:', e);
            }
        }

        // Default: use demo.readyplayer.me with frameApi (no API key needed)
        if (!rpmUrl) {
            rpmUrl = `https://demo.readyplayer.me/avatar?frameApi&bodyType=fullbody&clearCache`;
        }

        iframe.src = rpmUrl;

        // Hide loader once iframe content loads; fall back if it errors
        const onIframeLoad = () => {
            if (loader) loader.classList.add('vm-hidden');
            iframe.removeEventListener('load', onIframeLoad);
        };
        iframe.addEventListener('load', onIframeLoad);

        // Timeout fallback — if iframe doesn't load within 12s, show manual mode
        this._rpmFallbackTimer = setTimeout(() => {
            if (loader && !loader.classList.contains('vm-hidden')) {
                console.warn('[VRM-Manager] RPM iframe timed out, showing fallback');
                this._showRPMFallback();
            }
        }, 12000);

        // Listen for messages from RPM iframe
        if (!this._rpmListenerAttached) {
            this._rpmListenerAttached = true;
            window.addEventListener('message', (event) => {
                // RPM sends the avatar URL when creation is complete (string format)
                if (typeof event.data === 'string' && event.data.startsWith('https://models.readyplayer.me/')) {
                    this.closeRPMCreator();
                    this.installRPMAvatar(event.data);
                }
                // RPM v2 sends JSON messages
                if (event.data && typeof event.data === 'object') {
                    if (event.data.source === 'readyplayerme' && event.data.eventName === 'v1.avatar.exported') {
                        const avatarUrl = event.data.data?.url;
                        if (avatarUrl) {
                            this.closeRPMCreator();
                            this.installRPMAvatar(avatarUrl);
                        }
                    }
                }
            });

            // Listen for RPM URL install from fallback form
            const rpmUrlInstall = el('vm-rpm-url-install');
            if (rpmUrlInstall) {
                rpmUrlInstall.addEventListener('click', () => {
                    const input = el('vm-rpm-url-input');
                    const url = (input?.value || '').trim();
                    if (!url) {
                        toast('Please paste a Ready Player Me avatar URL.', 'error');
                        return;
                    }
                    // Accept various RPM URL formats
                    if (!url.includes('readyplayer.me')) {
                        toast("This doesn't look like a Ready Player Me URL.", 'error');
                        return;
                    }
                    // Extract the GLB URL from demo page URLs like
                    // https://demo.readyplayer.me/avatar?id=69b6ec6afa04178f0ea8e732
                    let glbUrl = url;
                    const idMatch = url.match(/[?&]id=([a-f0-9]{24})/i);
                    if (idMatch) {
                        glbUrl = `https://models.readyplayer.me/${idMatch[1]}.glb`;
                    }
                    this.closeRPMCreator();
                    this.installRPMAvatar(glbUrl);
                });
            }
        }
    },

    /** Show fallback URL-paste mode (called when iframe fails) */
    _showRPMFallback() {
        const iframe = el('vm-rpm-iframe');
        const fallback = el('vm-rpm-fallback');
        const loader = el('vm-rpm-loader');
        if (loader) loader.classList.add('vm-hidden');
        iframe.classList.add('vm-hidden');
        iframe.src = 'about:blank';
        if (fallback) fallback.classList.remove('vm-hidden');
    },

    closeRPMCreator() {
        if (this._rpmFallbackTimer) clearTimeout(this._rpmFallbackTimer);
        el('vm-rpm-modal').classList.add('vm-hidden');
        el('vm-rpm-iframe').src = 'about:blank';
        el('vm-rpm-iframe').classList.remove('vm-hidden');
        const fallback = el('vm-rpm-fallback');
        if (fallback) fallback.classList.add('vm-hidden');
        const loader = el('vm-rpm-loader');
        if (loader) loader.classList.add('vm-hidden');
    },

    async installRPMAvatar(avatarUrl) {
        // Convert demo page URLs to GLB model URLs
        // e.g. https://demo.readyplayer.me/avatar?id=69b6ec6a → https://models.readyplayer.me/69b6ec6a.glb
        const idMatch = avatarUrl.match(/[?&]id=([a-f0-9]{24})/i);
        if (idMatch) {
            avatarUrl = `https://models.readyplayer.me/${idMatch[1]}.glb`;
        }

        // Append morphTargets to get full viseme + ARKit blend shapes
        const glbUrl = avatarUrl.endsWith('.glb') ? avatarUrl : avatarUrl + '.glb';
        const fullUrl = glbUrl + '?morphTargets=ARKit,Oculus+Visemes';

        toast('Downloading Ready Player Me avatar...', 'info');

        try {
            // Use avatar proxy to bypass CORS restrictions on RPM CDN
            const proxyUrl = '/api/avatar-proxy?url=' + encodeURIComponent(fullUrl);
            const res = await fetch(proxyUrl);
            if (!res.ok) throw new Error(`Download failed: ${res.status}`);

            const blob = await res.blob();
            const avatarId = avatarUrl.split('/').pop().split('.')[0];
            const id = `rpm-${avatarId}`;
            const fileName = `RPM_${avatarId}.glb`;

            const item = {
                id,
                name: `RPM Avatar ${avatarId.slice(0, 8)}`,
                desc: 'Custom avatar created with Ready Player Me. GLB with ARKit + Oculus Viseme morph targets.',
                source: 'Ready Player Me',
                sourceId: 'readyplayerme',
                format: 'glb-morph',
                license: 'cc-by',
                url: fullUrl,
                preview: avatarUrl + '.png',
                icon: '🧑',
                tags: ['custom', 'rpm', 'morph-targets'],
                features: ['lipsync', 'emotions'],
                size: blob.size,
                localFile: fileName,
                installedAt: Date.now(),
            };

            await this.cacheBlob(id, blob, { name: item.name, format: 'glb-morph' });

            installedAvatars[id] = item;
            this.saveInstalled();

            if (this.settings.autoInstall !== false) {
                await this.addToManifest(item, fileName, blob);
            }

            allItems.unshift(item);
            this.applyFilters();
            this.renderInstalledGrid();

            // Switch to "My Avatars" tab so user sees the new avatar at the top
            this.switchTab('installed');

            toast(`Avatar installed! Click "Use Now" to load it.`, 'success');

            // Generate thumbnail in background (RPM preview URL may already exist, but generate local one too)
            if (!item.preview) {
                generateAndSaveThumbnail(item).then((preview) => {
                    if (preview) {
                        this.applyFilters();
                        this.renderInstalledGrid();
                    }
                });
            }
        } catch (e) {
            console.error('[VRM-Manager] RPM install error:', e);
            toast(`Failed to install RPM avatar: ${e.message}`, 'error');
        }
    },

    /* ── Filter & Render ───────────────────────────────── */

    async onSourceFilterChange() {
        const sourceEl = el('vm-filter-source');
        const selected = (sourceEl && sourceEl.value) || '';

        // On-demand: fetch Open Source Avatars only when user selects that source
        if (selected === 'Open Source Avatars' && !osAvatarsLoaded) {
            setStatus('Loading Open Source Avatars...');
            try {
                const osaItems = await this.fetchOpenSourceAvatars();
                if (Array.isArray(osaItems) && osaItems.length > 0) {
                    allItems = allItems.concat(osaItems);
                    osAvatarsLoaded = true;
                    this.populateSourceFilter();
                }
            } catch (e) {
                console.warn('[VRM-Manager] On-demand OSA load error:', e);
            }
            setStatus('');
        }

        this.applyFilters();
    },

    populateSourceFilter() {
        const sourceSet = {};
        allItems.forEach((it) => {
            sourceSet[it.source] = true;
        });
        // Always show Open Source Avatars as a selectable source (loaded on-demand)
        sourceSet['Open Source Avatars'] = true;
        const select = el('vm-filter-source');
        while (select.options.length > 1) select.remove(1);
        Object.keys(sourceSet)
            .sort()
            .forEach((s) => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = s;
                select.appendChild(opt);
            });
    },

    applyFilters() {
        const searchEl = el('vm-search');
        const sourceEl = el('vm-filter-source');
        const formatEl = el('vm-filter-format');
        const licenseEl = el('vm-filter-license');
        const accessEl = el('vm-filter-access');

        const search = ((searchEl && searchEl.value) || '').trim().toLowerCase();
        const source = (sourceEl && sourceEl.value) || '';
        const format = (formatEl && formatEl.value) || '';
        const license = (licenseEl && licenseEl.value) || '';
        const access = (accessEl && accessEl.value) || '';

        const hasActiveFilter = !!(search || source || format || license || access);

        // Build sourceId → access type lookup from SOURCES definitions
        const accessTypeMap = {};
        SOURCES.forEach((s) => {
            // 'connected' = has API (auth: none, oauth, api-key, token)
            // 'manual' = no API, manual download (auth: manual)
            accessTypeMap[s.id] = s.auth === 'manual' ? 'manual' : 'connected';
        });

        currentFiltered = allItems.filter((item) => {
            if (source && item.source !== source) return false;
            if (format && item.format !== format) return false;
            if (license && item.license !== license) return false;
            if (access) {
                const itemAccess = accessTypeMap[item.sourceId] || 'connected';
                if (itemAccess !== access) return false;
            }
            if (search) {
                const hay = [item.name, item.desc, item.source, (item.tags || []).join(' ')].join(' ').toLowerCase();
                if (!hay.includes(search)) return false;
            }
            return true;
        });

        // Defensive: if no filters are active, always show all available items
        if (!hasActiveFilter && currentFiltered.length === 0 && allItems.length > 0) {
            currentFiltered = [...allItems];
        }

        // ── Sort ──
        // Primary key: format (VRM first — full face tracking, GLB last — body only).
        // Secondary key: user-selected sort criterion.
        // Installed items always sink to the bottom within each group.
        const FORMAT_ORDER = { vrm: 0, 'glb-morph': 1, glb: 2 };
        // Source priority: vroid_hub first, open_source last (matches Avatar Catalog)
        const SOURCE_ORDER = {
            'vroid-hub': 0,
            'github-vrm-samples': 1,
            'homepilot-hub': 2,
            sketchfab: 3,
            readyplayerme: 4,
            opensourceavatars: 5,
        };
        // Map sourceCategory from catalog to priority (vroid=0, sketchfab=1, open_source=2)
        const CAT_ORDER = { vroid: 0, marketplace: 1, unknown: 1, open_source: 2, sample: 3 };
        const fmtPri = (item) => FORMAT_ORDER[item.format] ?? 9;
        const srcPri = (item) => {
            // Use sourceCategory if available (from HomePilot catalog), else sourceId
            if (item.sourceCategory) return CAT_ORDER[item.sourceCategory] ?? 1;
            return SOURCE_ORDER[item.sourceId] ?? 3;
        };

        const sortEl = el('vm-filter-sort');
        const sortBy = (sortEl && sortEl.value) || 'popular';

        currentFiltered.sort((a, b) => {
            // Installed items always last
            const instDiff = (this.isInstalled(a.id) ? 1 : 0) - (this.isInstalled(b.id) ? 1 : 0);
            if (instDiff !== 0) return instDiff;

            // Format priority: VRM > GLB+Morph > GLB (always)
            const fmtDiff = fmtPri(a) - fmtPri(b);
            if (fmtDiff !== 0) return fmtDiff;

            // User-selected sort
            switch (sortBy) {
                case 'name':
                    return (a.name || '').localeCompare(b.name || '');
                case 'name-desc':
                    return (b.name || '').localeCompare(a.name || '');
                case 'size':
                    return (a.size || 0) - (b.size || 0);
                case 'size-desc':
                    return (b.size || 0) - (a.size || 0);
                case 'source':
                    return (
                        srcPri(a) - srcPri(b) ||
                        (a.source || '').localeCompare(b.source || '') ||
                        (a.name || '').localeCompare(b.name || '')
                    );
                case 'popular':
                default:
                    // Most Popular: like_count desc → source priority → name A-Z
                    return (
                        (b.likeCount || 0) - (a.likeCount || 0) ||
                        srcPri(a) - srcPri(b) ||
                        (a.name || '').localeCompare(b.name || '')
                    );
            }
        });

        visibleCount = VM_CONFIG.PAGE_SIZE;
        this.renderGrid(currentFiltered, { hasActiveFilter });
        this.updateStats();
    },

    renderGrid(items, { hasActiveFilter = false } = {}) {
        const grid = el('vm-grid');
        grid.innerHTML = '';

        if (!items.length) {
            grid.innerHTML = `
        <div class="vm-empty" style="grid-column:1/-1">
          <div class="vm-empty-icon">${hasActiveFilter ? '🔍' : '📦'}</div>
          <div class="vm-empty-title">${hasActiveFilter ? 'No avatars found' : 'Catalog is empty'}</div>
          <p>${hasActiveFilter ? 'Try a different search, adjust filters, or connect more sources in Settings.' : 'No catalog items are available yet.'}</p>
        </div>`;
            updateLoadMore(0, 0);
            return;
        }

        const slice = items.slice(0, visibleCount);
        slice.forEach((item) => grid.appendChild(this.buildCard(item)));
        updateLoadMore(visibleCount, items.length);
    },

    renderInstalledGrid() {
        const grid = el('vm-installed-grid');
        const emptyEl = el('vm-installed-empty');
        grid.innerHTML = '';

        const installed = Object.values(installedAvatars);
        if (!installed.length) {
            emptyEl.style.display = '';
            return;
        }

        emptyEl.style.display = 'none';

        // Sort: user-installed newest first, then core system avatars
        installed.sort((a, b) => {
            const aCustom = !a.core && a.installedAt;
            const bCustom = !b.core && b.installedAt;
            if (aCustom && !bCustom) return -1;
            if (!aCustom && bCustom) return 1;
            if (aCustom && bCustom) return (b.installedAt || 0) - (a.installedAt || 0);
            return 0;
        });

        installed.forEach((item) => grid.appendChild(this.buildCard(item, true)));
    },

    buildCard(item, isInstalledView = false) {
        const card = document.createElement('div');
        card.className = 'vm-card';
        card.style.cursor = 'pointer';

        // Click anywhere on the card opens preview (unless clicking a button)
        card.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            this.previewAvatar(item.id);
        });

        const isInst = this.isInstalled(item.id);
        const formatBadgeClass =
            item.format === 'vrm'
                ? 'vm-badge-vrm'
                : item.format === 'glb-morph'
                  ? 'vm-badge-glb-morph'
                  : 'vm-badge-glb';
        const formatLabel = item.format === 'vrm' ? 'VRM' : item.format === 'glb-morph' ? 'GLB+Morph' : 'GLB';

        // Feature badges
        const featureHtml = (item.features || [])
            .map((f) => {
                const cls = `vm-feature vm-feature-${f}`;
                return `<span class="${cls}">${esc(f)}</span>`;
            })
            .join('');

        // Tags
        const tagsHtml = (item.tags || [])
            .slice(0, 3)
            .map((t) => `<span class="vm-card-tag">${esc(t)}</span>`)
            .join('');

        // Preview image or icon placeholder
        const previewHtml = item.preview
            ? `<img class="vm-card-preview" src="${esc(item.preview)}" alt="${esc(item.name)}" loading="lazy" onerror="this.outerHTML='<div class=\\'vm-card-preview vm-placeholder\\'>${item.icon || '🎭'}</div>'" />`
            : `<div class="vm-card-preview vm-placeholder">${item.icon || '🎭'}</div>`;

        // Core badge for built-in system avatars
        const isCoreSys = this.isCore(item.id);

        // VRoid Hub models that can't be installed — either not liked or not downloadable
        const isViewOnly = item.sourceId === 'vroid-hub' && item.isDownloadable === false;
        const viewOnlyLabel = isViewOnly && item.userLiked === false ? 'See on VRoid Hub' : 'See on VRoid Hub';

        // Buttons
        let btnHtml;
        if (isInstalledView) {
            btnHtml = `
        <div class="vm-card-btn-row">
          <button class="vm-card-btn vm-card-btn-install" onclick="VRMManager.useAvatar('${esc(item.id)}')">Use Now</button>
          <button class="vm-card-btn vm-card-btn-preview" onclick="VRMManager.previewAvatar('${esc(item.id)}')">Details</button>
          ${!isCoreSys ? `<button class="vm-card-btn vm-card-btn-remove" onclick="VRMManager.removeAvatar('${esc(item.id)}')">Uninstall</button>` : ''}
        </div>`;
        } else if (isViewOnly) {
            btnHtml = `
        <div class="vm-card-btn-row">
          <a class="vm-card-btn vm-card-btn-install" href="${esc(item.vroidPageUrl)}" target="_blank" rel="noopener" style="text-decoration:none;text-align:center">${viewOnlyLabel}</a>
          <button class="vm-card-btn vm-card-btn-preview" onclick="VRMManager.previewAvatar('${esc(item.id)}')">Details</button>
        </div>`;
        } else if (isInst) {
            btnHtml = `
        <div class="vm-card-btn-row">
          <button class="vm-card-btn vm-card-btn-install installed" disabled>${isCoreSys ? 'Core' : 'Installed'}</button>
          <button class="vm-card-btn vm-card-btn-preview" onclick="VRMManager.previewAvatar('${esc(item.id)}')">Details</button>
        </div>`;
        } else {
            btnHtml = `
        <div class="vm-card-btn-row">
          <button class="vm-card-btn vm-card-btn-install" id="btn-install-${esc(item.id)}" onclick="VRMManager.installAvatar('${esc(item.id)}')">Install</button>
          <button class="vm-card-btn vm-card-btn-preview" onclick="VRMManager.previewAvatar('${esc(item.id)}')">Details</button>
        </div>
        <div class="vm-progress vm-hidden" id="progress-${esc(item.id)}">
          <div class="vm-progress-bar" id="progress-bar-${esc(item.id)}"></div>
        </div>`;
        }

        card.innerHTML = `
      <div class="vm-card-preview-wrap">
        ${previewHtml}
        <span class="vm-badge ${formatBadgeClass} vm-format-badge">${formatLabel}</span>
        ${isCoreSys ? '<span class="vm-core-badge">CORE</span>' : ''}
        ${isViewOnly ? `<span class="vm-core-badge" style="background:rgba(255,193,7,0.85);color:#000">${item.userLiked === false ? '♥ LIKE FIRST' : 'VIEW ONLY'}</span>` : ''}
        <span class="vm-source-badge">${esc(item.source)}</span>
      </div>
      <div class="vm-card-body">
        <div class="vm-card-name">${esc(item.name)}</div>
        <div class="vm-card-desc">${esc(item.desc)}</div>
        ${featureHtml ? `<div class="vm-card-features">${featureHtml}</div>` : ''}
        <div class="vm-card-meta">
          <div class="vm-card-tags">${tagsHtml}</div>
        </div>
        ${btnHtml}
        ${item.size ? `<div class="vm-card-size">${formatBytes(item.size)}</div>` : ''}
      </div>`;

        return card;
    },

    updateStats() {
        const statsEl = el('vm-stats');
        const total = allItems.length;
        const shown = currentFiltered.length;
        const allInst = Object.values(installedAvatars);
        const coreCount = allInst.filter((a) => a.core).length;
        const userCount = allInst.length - coreCount;
        statsEl.textContent = `${shown} of ${total} avatars | ${coreCount} core + ${userCount} user-installed`;
    },

    /* ── Install / Download ────────────────────────────── */

    async installAvatar(id) {
        const item = allItems.find((x) => x.id === id);
        if (!item) {
            toast('Avatar not found', 'error');
            return;
        }

        const btn = el(`btn-install-${id}`);
        const progress = el(`progress-${id}`);
        const progressBar = el(`progress-bar-${id}`);

        if (btn) {
            btn.textContent = 'Downloading...';
            btn.disabled = true;
        }
        if (progress) progress.classList.remove('vm-hidden');

        try {
            // Check cache first
            let cached = await this.getCachedBlob(id);
            let blob;

            if (cached && cached.blob) {
                blob = cached.blob;
                if (progressBar) progressBar.style.width = '100%';
            } else {
                // Download the file
                let downloadUrl = item.url;

                // VRoid Hub needs special download license flow
                if (item.vroidModelId || (downloadUrl && downloadUrl.startsWith('vroid-hub:'))) {
                    const modelId = item.vroidModelId || downloadUrl.replace('vroid-hub:', '');
                    downloadUrl = await this.getVroidHubDownloadUrl(modelId);
                    if (!downloadUrl)
                        throw new Error(
                            'VRoid Hub download requires you to "Like" (♥) this model on hub.vroid.com first. ' +
                                'Open the model page, click ♥, then try installing again.'
                        );
                }

                // Sketchfab needs special download flow
                if (item.sketchfabUid && this.credentials.sketchfab?.token) {
                    downloadUrl = await this.getSketchfabDownloadUrl(item.sketchfabUid);
                    if (!downloadUrl) throw new Error('Could not get Sketchfab download URL');
                }

                // Check if URL is a web page (not a direct model download)
                const isExternal = downloadUrl.startsWith('https://') || downloadUrl.startsWith('http://');
                if (isExternal && !/\.(vrm|glb|gltf)(\?.*)?$/i.test(downloadUrl)) {
                    // This is a VRoid Hub page or similar — not a direct download link
                    const isVroidHub = downloadUrl.includes('hub.vroid.com');
                    throw new Error(
                        isVroidHub
                            ? 'This VRoid Hub model requires download from hub.vroid.com first. Visit the model page to download the .vrm file, then install it via "Add Avatar → From File".'
                            : 'URL does not point to a downloadable model file (.vrm, .glb, or .gltf).'
                    );
                }

                // Download with retry + proxy fallback
                const res = await fetchModelUrl(downloadUrl);
                if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

                // Validate response is actually a binary file, not an HTML error page
                const contentType = res.headers.get('content-type') || '';
                if (contentType.includes('text/html')) {
                    throw new Error(
                        'Server returned an HTML page instead of a model file. The URL may require authentication.'
                    );
                }

                const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
                const reader = res.body.getReader();
                const chunks = [];
                let received = 0;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    received += value.length;
                    if (contentLength && progressBar) {
                        progressBar.style.width = Math.min(100, (received / contentLength) * 100) + '%';
                    }
                }

                blob = new Blob(chunks);
                if (progressBar) progressBar.style.width = '100%';

                // Cache it
                await this.cacheBlob(id, blob, { name: item.name, format: item.format });
            }

            // Determine file extension
            const ext = item.format === 'vrm' ? 'vrm' : 'glb';
            const fileName = sanitizeFileName(item.name) + '.' + ext;

            // Store install metadata
            installedAvatars[id] = {
                ...item,
                installedAt: Date.now(),
                localFile: fileName,
                blobSize: blob.size,
            };
            this.saveInstalled();

            // Update avatars.json manifest (if auto-install is on)
            if (this.settings.autoInstall !== false) {
                await this.addToManifest(item, fileName, blob);
            }

            // Update UI
            if (btn) {
                btn.textContent = 'Installed';
                btn.classList.add('installed');
            }
            toast(`${item.name} installed successfully!`, 'success');
            this.applyFilters();
            this.renderInstalledGrid();

            // Generate thumbnail in background (model is already cached in IndexedDB)
            generateAndSaveThumbnail(installedAvatars[id]).then((preview) => {
                if (preview) {
                    // Update preview on the catalog item too
                    const catalogItem = allItems.find((x) => x.id === id);
                    if (catalogItem) catalogItem.preview = preview;
                    this.applyFilters();
                    this.renderInstalledGrid();
                }
            });
        } catch (e) {
            console.error('[VRM-Manager] Install error:', e);
            if (btn) {
                btn.textContent = 'Install';
                btn.disabled = false;
            }
            if (progress) progress.classList.add('vm-hidden');
            toast(`Failed to install: ${e.message}`, 'error');
        }
    },

    async addToManifest(item, fileName, blob) {
        try {
            // Read current manifest
            const res = await fetch(VM_CONFIG.MANIFEST_URL, { cache: 'no-store' });
            let manifest = { basePath: VM_CONFIG.AVATAR_DIR, items: [] };
            if (res.ok) manifest = await res.json();

            // Check if already in manifest
            if (manifest.items.some((x) => x.file === fileName)) return;

            // Add new entry
            const entry = {
                name: item.name,
                file: fileName,
                format: item.format,
                features: item.features || [],
            };
            manifest.items.push(entry);

            // Store updated manifest and blob URL for the main app to use
            // Since we can't write files from the browser, we store in localStorage
            // and the main app reads from it
            localStorage.setItem('vrm_manager_manifest_override', JSON.stringify(manifest));

            // Also store the blob URL so the main app can load it
            const blobUrl = URL.createObjectURL(blob);
            const blobMap = JSON.parse(localStorage.getItem('vrm_manager_blob_urls') || '{}');
            blobMap[fileName] = blobUrl;
            localStorage.setItem('vrm_manager_blob_urls', JSON.stringify(blobMap));

            // Store blob in IndexedDB for persistence across page loads
            await this.cacheBlob(`file:${fileName}`, blob, { name: item.name, format: item.format });
        } catch (e) {
            console.warn('[VRM-Manager] Manifest update error:', e);
        }
    },

    async getSketchfabDownloadUrl(uid) {
        const token = this.credentials.sketchfab?.token;
        if (!token) return null;

        try {
            const res = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, {
                headers: { Authorization: `Token ${token}` },
            });
            if (!res.ok) return null;
            const data = await res.json();
            return data.glb?.url || data.gltf?.url || null;
        } catch (e) {
            return null;
        }
    },

    /* ── Use / Remove ──────────────────────────────────── */

    useAvatar(id) {
        const item = installedAvatars[id];
        if (!item) {
            toast('Avatar not found in installed list', 'error');
            return;
        }

        // Store selection for main app
        localStorage.setItem(
            'vrm_manager_use_avatar',
            JSON.stringify({
                id: item.id,
                name: item.name,
                file: item.localFile || item.file,
                url: item.url,
                format: item.format,
            })
        );

        // Show a visual selection overlay before redirecting
        const overlay = document.createElement('div');
        overlay.style.cssText =
            'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
            'background:rgba(0,0,0,0.85);backdrop-filter:blur(12px);animation:vm-slide-in 0.3s ease';
        overlay.innerHTML = `
            <div style="text-align:center;color:var(--vm-text)">
                <div style="font-size:64px;margin-bottom:16px">${item.icon || '🎭'}</div>
                <div style="font-family:var(--vm-font-display);font-size:18px;font-weight:700;color:var(--vm-primary);letter-spacing:1px;margin-bottom:8px">
                    ${esc(item.name)}
                </div>
                <div style="font-size:14px;color:var(--vm-text-muted);margin-bottom:24px">
                    Loading avatar into chatbot...
                </div>
                <div class="vm-spinner" style="width:24px;height:24px;margin:0 auto"></div>
            </div>`;
        document.body.appendChild(overlay);

        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1200);
    },

    removeAvatar(id) {
        const item = installedAvatars[id];
        if (!item) return;

        if (item.core) {
            toast('Core system avatars cannot be removed', 'error');
            return;
        }

        if (!confirm(`Remove "${item.name}" from installed avatars?`)) return;

        delete installedAvatars[id];
        this.saveInstalled();

        // Remove blob URL
        const blobMap = JSON.parse(localStorage.getItem('vrm_manager_blob_urls') || '{}');
        if (item.localFile && blobMap[item.localFile]) {
            try {
                URL.revokeObjectURL(blobMap[item.localFile]);
            } catch (_) {}
            delete blobMap[item.localFile];
            localStorage.setItem('vrm_manager_blob_urls', JSON.stringify(blobMap));
        }

        toast(`${item.name} removed`, 'info');
        this.applyFilters();
        this.renderInstalledGrid();
    },

    /* ── Preview Modal ─────────────────────────────────── */

    previewAvatar(id) {
        const item = allItems.find((x) => x.id === id) || installedAvatars[id];
        if (!item) return;

        el('vm-preview-title').textContent = item.name;

        const formatLabel =
            item.format === 'vrm'
                ? 'VRM (Full Face Animation)'
                : item.format === 'glb-morph'
                  ? 'GLB + Morph Targets (Beta)'
                  : 'GLB (Body Only)';

        const features =
            (item.features || []).length > 0
                ? item.features.map((f) => `<span class="vm-feature vm-feature-${f}">${f}</span>`).join(' ')
                : '<span style="color:var(--vm-text-muted)">None</span>';

        el('vm-preview-details').innerHTML = `
      <h3>${esc(item.name)}</h3>
      <p style="color:var(--vm-text-muted);font-size:13px;margin-bottom:16px">${esc(item.desc)}</p>
      <div class="vm-detail-row"><span class="vm-detail-label">Format</span><span class="vm-detail-value">${formatLabel}</span></div>
      <div class="vm-detail-row"><span class="vm-detail-label">Source</span><span class="vm-detail-value">${esc(item.source)}</span></div>
      <div class="vm-detail-row"><span class="vm-detail-label">License</span><span class="vm-detail-value">${esc(item.license === 'vroid-hub-terms' ? 'VRoid Hub Terms' : item.license.toUpperCase())}</span></div>
      <div class="vm-detail-row"><span class="vm-detail-label">Size</span><span class="vm-detail-value">${formatBytes(item.size)}</span></div>
      <div class="vm-detail-row"><span class="vm-detail-label">Tags</span><span class="vm-detail-value">${(item.tags || []).join(', ') || 'None'}</span></div>
      <div style="margin-top:12px"><span class="vm-detail-label">Features</span><div style="margin-top:6px">${features}</div></div>

      ${item.conditionsOfUse ? this._renderConditionsOfUse(item.conditionsOfUse) : ''}
      <div style="margin-top:16px;padding:12px;background:rgba(0,229,255,0.05);border-radius:8px;border:1px solid rgba(0,229,255,0.15)">
        <div style="font-size:11px;color:var(--vm-primary);font-weight:600;margin-bottom:4px">PHASE 3 COMPATIBILITY</div>
        <div style="font-size:12px;color:var(--vm-text-muted)">
          ${
              item.format === 'vrm'
                  ? '100% compatible — Full emotions, lip-sync, gaze tracking, blink, and micro-expressions.'
                  : item.format === 'glb-morph'
                    ? 'Beta — Same as VRM after MorphTargetAdapter processing. Lip-sync and emotions available.'
                    : 'Body only — Breathing, head movement, procedural animation. Use VRM Factory to convert.'
          }
        </div>
      </div>`;

        const isInst = this.isInstalled(item.id);
        const useBtn = `<button class="vm-btn" onclick="VRMManager.useAvatar('${esc(item.id)}');VRMManager.closePreview()">Use This Avatar</button>`;
        const installBtn = `<button class="vm-btn" onclick="VRMManager.installAvatar('${esc(item.id)}');VRMManager.closePreview()">Download &amp; Install</button>`;
        el('vm-preview-actions').innerHTML = isInst ? useBtn : installBtn;

        // Show live 3D preview in viewport
        const viewport = el('vm-preview-viewport');
        viewport.innerHTML = '<div class="vm-preview-loading">Loading 3D preview...</div>';
        el('vm-preview-modal').classList.remove('vm-hidden');

        this._startLivePreview(item, viewport);
    },

    /** Launch an interactive Three.js preview in the given container */
    async _startLivePreview(item, container) {
        this._cleanupLivePreview();

        if (typeof THREE === 'undefined' || !THREE.GLTFLoader) {
            container.innerHTML = item.preview
                ? `<img src="${esc(item.preview)}" style="width:100%;height:100%;object-fit:contain" alt="${esc(item.name)}" />`
                : `<div class="vm-preview-placeholder" style="font-size:80px">${item.icon || '🎭'}</div>`;
            return;
        }

        const width = container.clientWidth || 400;
        const height = container.clientHeight || 500;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.outputEncoding = THREE.sRGBEncoding;
        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a1520);

        const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);

        // Studio lighting
        scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.2));
        const key = new THREE.DirectionalLight(0xffffff, 1.4);
        key.position.set(1.2, 1.8, 2.5);
        scene.add(key);
        const fill = new THREE.DirectionalLight(0xbfdfff, 0.7);
        fill.position.set(-1.4, 1.0, 1.5);
        scene.add(fill);
        const rim = new THREE.DirectionalLight(0xaadfff, 0.5);
        rim.position.set(0.8, 1.5, -2.0);
        scene.add(rim);

        // Orbit state
        let rotY = 0;
        let rotX = 0;
        let zoom = 1;
        let isDragging = false;
        let lastX = 0;
        let lastY = 0;
        let modelCenter = new THREE.Vector3(0, 1, 0);
        let modelHeight = 2;

        const updateCamera = () => {
            const dist = modelHeight * 2.0 * zoom;
            camera.position.set(
                modelCenter.x + dist * Math.sin(rotY) * Math.cos(rotX),
                modelCenter.y + dist * Math.sin(rotX),
                modelCenter.z + dist * Math.cos(rotY) * Math.cos(rotX)
            );
            camera.lookAt(modelCenter);
        };

        // Mouse/touch orbit controls
        const onPointerDown = (e) => {
            isDragging = true;
            lastX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
            lastY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
        };
        const onPointerMove = (e) => {
            if (!isDragging) return;
            const x = e.clientX || (e.touches && e.touches[0].clientX) || 0;
            const y = e.clientY || (e.touches && e.touches[0].clientY) || 0;
            rotY += (x - lastX) * 0.008;
            rotX = Math.max(-1.2, Math.min(1.2, rotX + (y - lastY) * 0.008));
            lastX = x;
            lastY = y;
            updateCamera();
        };
        const onPointerUp = () => {
            isDragging = false;
        };
        const onWheel = (e) => {
            e.preventDefault();
            zoom = Math.max(0.3, Math.min(3, zoom + e.deltaY * 0.001));
            updateCamera();
        };

        renderer.domElement.addEventListener('mousedown', onPointerDown);
        renderer.domElement.addEventListener('mousemove', onPointerMove);
        renderer.domElement.addEventListener('mouseup', onPointerUp);
        renderer.domElement.addEventListener('mouseleave', onPointerUp);
        renderer.domElement.addEventListener('touchstart', onPointerDown, { passive: true });
        renderer.domElement.addEventListener('touchmove', onPointerMove, { passive: true });
        renderer.domElement.addEventListener('touchend', onPointerUp);
        renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
        renderer.domElement.style.cursor = 'grab';

        // Animation loop
        let animId = 0;
        const animate = () => {
            animId = requestAnimationFrame(animate);
            renderer.render(scene, camera);
        };

        // Load model
        const loader = new THREE.GLTFLoader();
        // Set up KTX2 loader for models that use KTX2/BasisU textures
        if (THREE.KTX2Loader && renderer) {
            const ktx2 = new THREE.KTX2Loader();
            ktx2.setTranscoderPath('/vendor/three-0.147.0/examples/jsm/libs/basis/');
            ktx2.detectSupport(renderer);
            loader.setKTX2Loader(ktx2);
        }
        // Set up meshopt decoder for models with meshopt compression
        if (THREE.MeshoptDecoder) {
            loader.setMeshoptDecoder(THREE.MeshoptDecoder);
        }

        // Resolve vroid-hub: scheme to actual URL or cached blob
        let modelUrl = item.url;
        const isVroidScheme = modelUrl && modelUrl.startsWith('vroid-hub:');
        const isVroidWebPage = modelUrl && modelUrl.includes('hub.vroid.com');

        // VRoid Hub web page URLs (non-liked models) — show static preview, don't try 3D load
        if (isVroidWebPage && !isVroidScheme) {
            const vroidLink = item.vroidPageUrl || modelUrl;
            container.innerHTML = item.preview
                ? `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center">
                    <img src="${esc(item.preview)}" style="max-width:90%;max-height:80%;object-fit:contain" alt="${esc(item.name)}" />
                    <a href="${esc(vroidLink)}" target="_blank" rel="noopener" style="margin-top:8px;color:#6af;font-size:13px">See on VRoid Hub to install</a>
                   </div>`
                : `<div class="vm-preview-placeholder" style="text-align:center">
                    <div style="font-size:60px;margin-bottom:12px">🌐</div>
                    <a href="${esc(vroidLink)}" target="_blank" rel="noopener" style="color:#6af;font-size:13px">See on VRoid Hub to install</a>
                   </div>`;
            return;
        }

        if (isVroidScheme) {
            // Try cached blob first (already downloaded)
            let cachedBlob = null;
            try {
                const cached = await VRMManager.getCachedBlob(item.id);
                if (cached && cached.blob) cachedBlob = cached.blob;
            } catch (_) {}

            if (cachedBlob) {
                // Load directly from cached blob
                try {
                    const arrayBuffer = await cachedBlob.arrayBuffer();
                    loader.parse(
                        arrayBuffer,
                        '',
                        (gltf) => {
                            const root = gltf.scene;
                            if (!root) return;
                            scene.add(root);
                            const isVRM = item.format === 'vrm';
                            if (isVRM) root.rotation.y = Math.PI;
                            const box = new THREE.Box3().setFromObject(root);
                            const size = new THREE.Vector3();
                            box.getSize(size);
                            box.getCenter(modelCenter);
                            modelHeight = size.y;
                            updateCamera();
                            animate();
                        },
                        (err) => {
                            console.error('[VRM-Manager] Live preview parse error:', err);
                            container.innerHTML = item.preview
                                ? `<img src="${esc(item.preview)}" style="width:100%;height:100%;object-fit:contain" alt="${esc(item.name)}" />`
                                : `<div class="vm-preview-placeholder">Failed to load 3D preview</div>`;
                        }
                    );
                } catch (e) {
                    console.error('[VRM-Manager] Live preview blob error:', e);
                    container.innerHTML = item.preview
                        ? `<img src="${esc(item.preview)}" style="width:100%;height:100%;object-fit:contain" alt="${esc(item.name)}" />`
                        : `<div class="vm-preview-placeholder">Failed to load 3D preview</div>`;
                }
                return;
            }

            // No cached blob — show static preview with VRoid Hub link
            // (Don't try download license here — it would trigger a toast error for every preview)
            {
                const vroidLink =
                    item.vroidPageUrl || `https://hub.vroid.com/en/characters/${modelUrl.replace('vroid-hub:', '')}`;
                container.innerHTML = item.preview
                    ? `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center">
                        <img src="${esc(item.preview)}" style="max-width:90%;max-height:80%;object-fit:contain" alt="${esc(item.name)}" />
                        <a href="${esc(vroidLink)}" target="_blank" rel="noopener" style="margin-top:8px;color:#6af;font-size:13px">See on VRoid Hub to enable download</a>
                       </div>`
                    : `<div class="vm-preview-placeholder" style="text-align:center">
                        <div style="font-size:60px;margin-bottom:12px">🌐</div>
                        <a href="${esc(vroidLink)}" target="_blank" rel="noopener" style="color:#6af;font-size:13px">See on VRoid Hub to enable download</a>
                       </div>`;
                return;
            }
        }

        loader.load(
            modelUrl,
            (gltf) => {
                const root = gltf.scene;
                if (!root) return;
                scene.add(root);

                // VRM models face -Z (VRM spec), rotate to face camera at +Z.
                // GLB models already face the camera without rotation.
                const isVRM = item.format === 'vrm' || (item.url && item.url.toLowerCase().endsWith('.vrm'));
                if (isVRM) {
                    root.rotation.y = Math.PI;
                }

                // Auto-frame
                const box = new THREE.Box3().setFromObject(root);
                const size = new THREE.Vector3();
                box.getSize(size);
                box.getCenter(modelCenter);
                modelHeight = size.y;

                updateCamera();
                animate();
            },
            undefined,
            (err) => {
                console.error('[VRM-Manager] Live preview load error:', err);
                container.innerHTML = item.preview
                    ? `<img src="${esc(item.preview)}" style="width:100%;height:100%;object-fit:contain" alt="${esc(item.name)}" />`
                    : `<div class="vm-preview-placeholder">Failed to load 3D preview</div>`;
            }
        );

        // Store cleanup reference
        this._livePreview = {
            renderer,
            animId: () => animId,
            cleanup: () => {
                cancelAnimationFrame(animId);
                animId = 0;
                renderer.dispose();
                scene.traverse((obj) => {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) {
                        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
                        else obj.material.dispose();
                    }
                });
            },
        };
    },

    _cleanupLivePreview() {
        if (this._livePreview) {
            this._livePreview.cleanup();
            this._livePreview = null;
        }
    },

    closePreview() {
        this._cleanupLivePreview();
        el('vm-preview-modal').classList.add('vm-hidden');
    },

    /* ── File Upload ───────────────────────────────────── */

    handleFileUpload(file) {
        if (!file) return;

        const name = file.name;
        const ext = name.split('.').pop().toLowerCase();

        if (!['vrm', 'glb', 'gltf'].includes(ext)) {
            toast('Please upload a .vrm, .glb, or .gltf file', 'error');
            return;
        }

        const format = ext === 'vrm' ? 'vrm' : 'glb';
        const id = `upload-${Date.now()}-${sanitizeFileName(name)}`;

        const blobUrl = URL.createObjectURL(file);

        const item = {
            id,
            name: name.replace(/\.[^.]+$/, ''),
            desc: `Uploaded file: ${name} (${formatBytes(file.size)})`,
            source: 'Local Upload',
            sourceId: 'local-upload',
            format,
            license: 'free',
            url: blobUrl,
            preview: '',
            icon: ext === 'vrm' ? '📁' : '📦',
            tags: ['uploaded', ext],
            features: ext === 'vrm' ? ['lipsync', 'emotions', 'gaze', 'blink'] : [],
            size: file.size,
            localFile: name,
            installedAt: Date.now(),
        };

        // Add to installed
        installedAvatars[id] = item;
        this.saveInstalled();

        // Add to catalog
        allItems.unshift(item);

        // Store blob URL
        const blobMap = JSON.parse(localStorage.getItem('vrm_manager_blob_urls') || '{}');
        blobMap[name] = blobUrl;
        localStorage.setItem('vrm_manager_blob_urls', JSON.stringify(blobMap));

        // Cache in IndexedDB
        file.arrayBuffer().then((buf) => {
            this.cacheBlob(`file:${name}`, new Blob([buf]), { name: item.name, format });
        });

        toast(`${name} uploaded and installed!`, 'success');
        this.applyFilters();
        this.renderInstalledGrid();

        // Generate thumbnail in background
        generateAndSaveThumbnail(item).then((preview) => {
            if (preview) {
                this.applyFilters();
                this.renderInstalledGrid();
            }
        });
    },

    /* ── Source Cards ───────────────────────────────────── */

    buildSourceCards() {
        const grid = el('vm-sources-grid');
        if (!grid) return;
        grid.innerHTML = '';

        // ── Add Source button (always first) ──
        const addCard = document.createElement('div');
        addCard.className = 'vm-source-card vm-source-add-card';
        addCard.innerHTML = `
        <div class="vm-source-add-inner">
          <div class="vm-source-add-icon">+</div>
          <div class="vm-source-add-label">Add Source</div>
          <div class="vm-source-add-hint">Add a custom catalog URL</div>
        </div>`;
        addCard.addEventListener('click', () => this.openAddSourceWizard());
        grid.appendChild(addCard);

        // ── Custom sources (user-added) ──
        const customSources = getCustomSources();
        customSources.forEach((src) => {
            const card = document.createElement('div');
            card.className = 'vm-source-card vm-source-custom';

            const formatBadges = (src.formats || ['vrm'])
                .map((f) => {
                    const cls =
                        f === 'vrm' ? 'vm-badge-vrm' : f === 'glb-morph' ? 'vm-badge-glb-morph' : 'vm-badge-glb';
                    const label = f === 'vrm' ? 'VRM' : f === 'glb-morph' ? 'GLB+M' : 'GLB';
                    return `<span class="vm-badge ${cls}" style="font-size:9px">${label}</span>`;
                })
                .join(' ');

            card.innerHTML = `
        <div class="vm-source-card-header">
          <div class="vm-source-card-icon">${src.icon || '📂'}</div>
          <div>
            <div class="vm-source-card-title">${esc(src.name)}</div>
            <div class="vm-source-card-url">${esc(src.url)}</div>
          </div>
          <span class="vm-source-card-status connected" style="margin-left:auto">Installed</span>
        </div>
        <div class="vm-source-card-desc">${esc(src.desc)}</div>
        <div class="vm-source-card-meta">
          ${formatBadges}
          ${src.isPrivate ? '<span class="vm-badge" style="font-size:9px;background:rgba(255,165,0,0.2);color:#ffa500">Private</span>' : ''}
          <span style="font-size:11px;color:var(--vm-text-muted)">Custom source</span>
        </div>
        <div class="vm-source-card-actions">
          <button class="vm-source-remove-btn">Uninstall</button>
        </div>`;

            // Wire remove button
            card.querySelector('.vm-source-remove-btn').addEventListener('click', () => {
                this.removeSource(src.catalogUrl);
            });

            grid.appendChild(card);
        });

        // ── Built-in sources ──
        SOURCES.forEach((src) => {
            const enabled = isSourceEnabled(src);
            const card = document.createElement('div');
            card.className = `vm-source-card${enabled ? '' : ' vm-source-disabled'}`;

            const statusClass =
                src.status === 'connected' ? 'connected' : src.status === 'no-api' ? 'no-api' : 'disconnected';
            const statusLabel =
                src.status === 'connected' ? 'Connected' : src.status === 'no-api' ? 'Manual' : 'Not Connected';

            const formatBadges = (src.formats || [])
                .map((f) => {
                    const cls =
                        f === 'vrm' ? 'vm-badge-vrm' : f === 'glb-morph' ? 'vm-badge-glb-morph' : 'vm-badge-glb';
                    const label = f === 'vrm' ? 'VRM' : f === 'glb-morph' ? 'GLB+M' : 'GLB';
                    return `<span class="vm-badge ${cls}" style="font-size:9px">${label}</span>`;
                })
                .join(' ');

            let actionsHtml = '';
            if (src.auth === 'none') {
                actionsHtml = '<span style="font-size:12px;color:var(--vm-green)">No setup needed</span>';
            } else if (src.auth === 'manual') {
                if (src.url) {
                    actionsHtml = `<a href="https://${esc(src.url)}" target="_blank" rel="noopener">Visit Site</a>`;
                }
            } else {
                actionsHtml = `
          <button onclick="VRMManager.openSettings()">Configure</button>
          ${src.signupUrl ? `<a href="${esc(src.signupUrl)}" target="_blank" rel="noopener">Sign Up</a>` : ''}`;
            }

            // Enable/disable toggle button
            const toggleLabel = enabled ? 'Enabled' : 'Disabled';
            const toggleClass = enabled ? 'vm-source-toggle-on' : 'vm-source-toggle-off';
            const toggleHtml = `<button class="vm-source-toggle ${toggleClass}" data-source-id="${esc(src.id)}" title="${enabled ? 'Click to disable this source' : 'Click to enable this source'}">${toggleLabel}</button>`;

            card.innerHTML = `
        <div class="vm-source-card-header">
          <div class="vm-source-card-icon">${src.icon}</div>
          <div>
            <div class="vm-source-card-title">${esc(src.name)}</div>
            <div class="vm-source-card-url">${esc(src.url)}</div>
          </div>
          ${toggleHtml}
        </div>
        <div class="vm-source-card-desc">${esc(src.desc)}</div>
        <div class="vm-source-card-meta">
          <span class="vm-source-card-status ${statusClass}">${statusLabel}</span>
          ${formatBadges}
        </div>
        <div class="vm-source-card-actions">${actionsHtml}</div>`;

            // Wire toggle button
            const toggleBtn = card.querySelector('.vm-source-toggle');
            toggleBtn.addEventListener('click', () => {
                const nowEnabled = toggleSourceEnabled(src.id);
                toast(`${src.name} ${nowEnabled ? 'enabled' : 'disabled'}. Reloading catalog...`, 'info');
                this.buildSourceCards();
                this.loadCatalog();
            });

            grid.appendChild(card);
        });
    },

    /* ── UI Events ─────────────────────────────────────── */

    wireEvents() {
        // Search
        el('vm-search').addEventListener(
            'input',
            debounce(() => this.applyFilters(), 200)
        );

        // Filters & sort
        el('vm-filter-sort').addEventListener('change', () => this.applyFilters());
        el('vm-filter-source').addEventListener('change', () => this.onSourceFilterChange());
        el('vm-filter-format').addEventListener('change', () => this.applyFilters());
        el('vm-filter-license').addEventListener('change', () => this.applyFilters());
        el('vm-filter-access').addEventListener('change', () => this.applyFilters());

        // Tabs
        document.querySelectorAll('.vm-tab').forEach((tab) => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        // Settings modal
        el('vm-settings-btn').addEventListener('click', () => this.openSettings());
        el('vm-settings-close').addEventListener('click', () => this.closeSettings());
        el('vm-settings-save').addEventListener('click', () => {
            this.saveCredentials();
            this.saveSettings();
            this.closeSettings();
            this.loadCatalog();
        });
        el('vm-settings-clear').addEventListener('click', () => {
            if (!confirm('This will clear all cached avatars, credentials, and installed list. Continue?')) return;
            localStorage.removeItem('vrm_manager_credentials');
            localStorage.removeItem('vrm_manager_installed');
            localStorage.removeItem('vrm_manager_settings');
            localStorage.removeItem('vrm_manager_manifest_override');
            localStorage.removeItem('vrm_manager_blob_urls');
            this.clearCache();
            installedAvatars = {};
            this.credentials = {};
            this.populateCredentialFields();
            this.updateSourceStatuses();
            toast('All data cleared', 'info');
            this.loadCatalog();
        });

        // Preview modal
        el('vm-preview-close').addEventListener('click', () => this.closePreview());
        el('vm-preview-modal').addEventListener('click', (e) => {
            if (e.target.id === 'vm-preview-modal') this.closePreview();
        });
        el('vm-settings-modal').addEventListener('click', (e) => {
            if (e.target.id === 'vm-settings-modal') this.closeSettings();
        });

        // Refresh
        const refreshBtn = el('vm-refresh-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => this.loadCatalog());

        // Upload (file input — used by wizard and drag-drop)
        el('vm-file-upload').addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) this.handleFileUpload(file);
            e.target.value = '';
        });

        // Load more — paginate client-side, then fetch more from VRoid Hub when exhausted
        const loadMoreBtn = document.querySelector('.vm-load-more-btn');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', async () => {
                visibleCount += VM_CONFIG.PAGE_SIZE;
                this.renderGrid(currentFiltered);

                // If all client items are now visible and VRoid Hub has more pages, fetch them
                if (visibleCount >= currentFiltered.length && this.hasMoreVroidHubPages()) {
                    loadMoreBtn.textContent = 'Loading more from VRoid Hub...';
                    loadMoreBtn.disabled = true;
                    try {
                        const moreModels = await this.fetchMoreVroidHubAvatars();
                        if (moreModels.length > 0) {
                            allItems = allItems.concat(moreModels);
                            this.applyFilters();
                        }
                    } finally {
                        loadMoreBtn.disabled = false;
                    }
                }
            });
        }

        // Direct URL install (now inside wizard modal)
        const urlBtn = el('vm-url-install-btn');
        if (urlBtn) {
            urlBtn.addEventListener('click', () => {
                const url = el('vm-url-input').value;
                this.installFromUrl(url);
                this.closeAddWizard();
            });
        }
        const urlInput = el('vm-url-input');
        if (urlInput) {
            urlInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.installFromUrl(urlInput.value);
                    this.closeAddWizard();
                }
            });
        }

        // RPM creator
        const rpmClose = el('vm-rpm-close');
        if (rpmClose) rpmClose.addEventListener('click', () => this.closeRPMCreator());
        const rpmModal = el('vm-rpm-modal');
        if (rpmModal)
            rpmModal.addEventListener('click', (e) => {
                if (e.target.id === 'vm-rpm-modal') this.closeRPMCreator();
            });

        // Generate all thumbnails button
        const genAllBtn = el('vm-generate-all-thumbs');
        if (genAllBtn) genAllBtn.addEventListener('click', () => this.generateAllThumbnails());

        // ── Add Source Wizard ──
        const addSrcClose = el('vm-addsrc-close');
        if (addSrcClose) addSrcClose.addEventListener('click', () => this.closeAddSourceWizard());
        const addSrcModal = el('vm-add-source-modal');
        if (addSrcModal)
            addSrcModal.addEventListener('click', (e) => {
                if (e.target.id === 'vm-add-source-modal') this.closeAddSourceWizard();
            });
        const addSrcFetchBtn = el('vm-addsrc-fetch-btn');
        if (addSrcFetchBtn)
            addSrcFetchBtn.addEventListener('click', () => {
                this.probeSourceUrl(el('vm-addsrc-url-input').value);
            });
        const addSrcUrlInput = el('vm-addsrc-url-input');
        if (addSrcUrlInput)
            addSrcUrlInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.probeSourceUrl(addSrcUrlInput.value);
            });
        const addSrcBackBtn = el('vm-addsrc-back-btn');
        if (addSrcBackBtn)
            addSrcBackBtn.addEventListener('click', () => {
                el('vm-addsrc-step-review').classList.add('vm-hidden');
                el('vm-addsrc-step-url').classList.remove('vm-hidden');
            });
        const addSrcConfirmBtn = el('vm-addsrc-confirm-btn');
        if (addSrcConfirmBtn) addSrcConfirmBtn.addEventListener('click', () => this.confirmAddSource());

        // ── Add Avatar Wizard ──
        const addBtn = el('vm-add-avatar-btn');
        if (addBtn) addBtn.addEventListener('click', () => this.openAddWizard());
        const addClose = el('vm-add-close');
        if (addClose) addClose.addEventListener('click', () => this.closeAddWizard());
        const addModal = el('vm-add-modal');
        if (addModal)
            addModal.addEventListener('click', (e) => {
                if (e.target.id === 'vm-add-modal') this.closeAddWizard();
            });

        // Wizard options
        const optUpload = el('vm-add-opt-upload');
        if (optUpload)
            optUpload.addEventListener('click', () => {
                this.closeAddWizard();
                el('vm-file-upload').click();
            });
        const optUrl = el('vm-add-opt-url');
        if (optUrl)
            optUrl.addEventListener('click', () => {
                el('vm-add-step-choose').classList.add('vm-hidden');
                el('vm-add-step-url').classList.remove('vm-hidden');
                el('vm-url-input').focus();
            });
        const optCatalog = el('vm-add-opt-catalog');
        if (optCatalog)
            optCatalog.addEventListener('click', () => {
                this.closeAddWizard();
                this.switchTab('catalog');
            });
        const optCreate = el('vm-add-opt-create');
        if (optCreate)
            optCreate.addEventListener('click', () => {
                this.closeAddWizard();
                this.openRPMCreator();
            });
        const urlBack = el('vm-add-url-back');
        if (urlBack)
            urlBack.addEventListener('click', () => {
                el('vm-add-step-url').classList.add('vm-hidden');
                el('vm-add-step-choose').classList.remove('vm-hidden');
            });

        // ── Drag & Drop ──
        let dragCounter = 0;
        const overlay = el('vm-drop-overlay');
        document.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            if (overlay) overlay.classList.remove('vm-hidden');
        });
        document.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                if (overlay) overlay.classList.add('vm-hidden');
            }
        });
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            if (overlay) overlay.classList.add('vm-hidden');
            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (file && /\.(vrm|glb|gltf)$/i.test(file.name)) {
                this.handleFileUpload(file);
            } else if (file) {
                toast('Unsupported file type. Use .vrm, .glb, or .gltf files.', 'error');
            }
        });

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeSettings();
                this.closePreview();
                this.closeRPMCreator();
                this.closeAddWizard();
                this.closeAddSourceWizard();
            }
        });
    },

    /* ── Add Avatar Wizard ───────────────────────────── */

    openAddWizard() {
        const modal = el('vm-add-modal');
        if (!modal) return;
        // Reset to step 1
        el('vm-add-step-choose').classList.remove('vm-hidden');
        const stepUrl = el('vm-add-step-url');
        if (stepUrl) stepUrl.classList.add('vm-hidden');
        modal.classList.remove('vm-hidden');
    },

    closeAddWizard() {
        const modal = el('vm-add-modal');
        if (modal) modal.classList.add('vm-hidden');
    },

    switchTab(tabName) {
        document.querySelectorAll('.vm-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.vm-tab-content').forEach((c) => c.classList.remove('active'));
        const tab = document.querySelector(`.vm-tab[data-tab="${tabName}"]`);
        if (tab) tab.classList.add('active');
        const content = el(`vm-tab-${tabName}`);
        if (content) content.classList.add('active');
        if (tabName === 'installed') this.renderInstalledGrid();
        if (tabName === 'catalog') {
            // If controls got into a stale state, reset them when opening catalog
            if (allItems.length && (!currentFiltered || !currentFiltered.length)) {
                this.resetCatalogControls();
            }
            this.applyFilters();

            // Focus search input so users can immediately start browsing/searching
            const searchInput = el('vm-search');
            if (searchInput) {
                setTimeout(() => searchInput.focus(), 100);
            }
        }
    },

    /* ── Thumbnail Recapture ──────────────────────────── */

    async recaptureThumbnail(id) {
        const item = installedAvatars[id] || allItems.find((x) => x.id === id);
        if (!item) return;

        toast('Generating thumbnail...', 'info');

        const preview = await generateAvatarThumbnail(item);
        if (!preview) {
            toast('Thumbnail generation failed', 'error');
            return;
        }

        item.preview = preview;
        if (installedAvatars[id]) {
            installedAvatars[id].preview = preview;
            this.saveInstalled();
        }
        await saveThumbToDB(id, preview);

        // Update allItems too
        const catalogItem = allItems.find((x) => x.id === id);
        if (catalogItem) catalogItem.preview = preview;

        this.applyFilters();
        this.renderInstalledGrid();
        toast('Thumbnail updated!', 'success');
    },

    /** Generate thumbnails for all installed avatars (force-regenerates all) */
    async generateAllThumbnails() {
        const items = Object.values(installedAvatars).filter((it) => it.url);
        if (items.length === 0) {
            toast('No installed avatars to generate thumbnails for', 'info');
            return;
        }

        toast(`Regenerating ${items.length} thumbnails...`, 'info');

        for (const item of items) {
            item.preview = ''; // clear old thumbnail to force regeneration
            await generateAndSaveThumbnail(item);
            // Update catalog
            const catalogItem = allItems.find((x) => x.id === item.id);
            if (catalogItem && item.preview) catalogItem.preview = item.preview;
        }

        this.saveInstalled();
        this.applyFilters();
        this.renderInstalledGrid();
        toast(`Regenerated thumbnails for ${items.length} avatars`, 'success');
    },

    openSettings() {
        el('vm-settings-modal').classList.remove('vm-hidden');
    },

    closeSettings() {
        el('vm-settings-modal').classList.add('vm-hidden');
    },
};

/* ═══════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════ */

function el(id) {
    return document.getElementById(id);
}
function setVal(id, val) {
    const e = el(id);
    if (e) e.value = val;
}

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function sanitizeFileName(name) {
    return name
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/__+/g, '_')
        .slice(0, 60);
}

/**
 * Resilient fetch for external model files (VRM/GLB).
 *
 * For R2 custom domain (avatars.yourfriend.online): proxy first for reliability,
 * fallback to direct CORS fetch (no bot protection on custom domain).
 *
 * For R2 r2.dev URLs: proxy FIRST (Cloudflare bot protection blocks direct
 * browser fetch on r2.dev domains), fallback to direct CORS fetch.
 *
 * For other external URLs: proxy first, fallback to direct CORS fetch.
 * For local URLs: direct fetch.
 */
async function fetchModelUrl(url) {
    const isR2Dev = url.includes('r2.dev') || url.includes('r2.cloudflarestorage.com');
    const isR2Custom = url.includes('avatars.yourfriend.online');
    const isExternal = /^https?:\/\//.test(url);

    if (!isExternal) return fetch(url);

    // R2 custom domain: direct CORS first (fast, no proxy overhead), proxy fallback.
    // Custom domains have proper CORS headers and no bot protection, so direct fetch
    // is more reliable than streaming through the Edge proxy (which can drop large bodies).
    if (isR2Custom) {
        console.log('[VRM-Manager] Custom domain detected, trying direct CORS first:', url);
        try {
            const res = await fetch(url, { mode: 'cors' });
            if (res.ok) {
                const ct = res.headers.get('content-type') || '';
                if (!ct.includes('text/html')) {
                    console.log('[VRM-Manager] Custom domain direct CORS fetch succeeded');
                    return res;
                }
            }
            console.warn(`[VRM-Manager] Custom domain direct CORS returned ${res.status}, trying proxy...`);
        } catch (e) {
            console.warn('[VRM-Manager] Custom domain direct CORS error:', e.message, '— trying proxy...');
        }
        // Fallback: server-side proxy (handles edge cases like corporate firewalls)
        try {
            console.log('[VRM-Manager] Trying proxy fallback for custom domain...');
            const proxyUrl = '/api/avatar-proxy?url=' + encodeURIComponent(url);
            const res = await fetch(proxyUrl);
            if (res.ok) {
                const ct = res.headers.get('content-type') || '';
                if (!ct.includes('text/html')) {
                    console.log('[VRM-Manager] Custom domain proxy fetch succeeded');
                    return res;
                }
            }
            console.warn(`[VRM-Manager] Custom domain proxy returned ${res.status}`);
        } catch (e) {
            console.warn('[VRM-Manager] Custom domain proxy error:', e.message);
        }
        throw new Error(
            'Failed to download from custom domain (both direct CORS and proxy failed). Please try again or use "Upload from device".'
        );
    }

    // R2 r2.dev domains are blocked by Cloudflare bot protection in browsers.
    // Always use the server-side proxy (Edge streaming, no size limit).
    if (isR2Dev) {
        const proxyUrl = '/api/avatar-proxy?url=' + encodeURIComponent(url);
        try {
            const res = await fetch(proxyUrl);
            if (res.ok) {
                const ct = res.headers.get('content-type') || '';
                if (!ct.includes('text/html')) return res;
            }
            console.warn(`[VRM-Manager] Proxy returned ${res.status}, trying direct...`);
        } catch (e) {
            console.warn('[VRM-Manager] Proxy error:', e.message, '— trying direct...');
        }
        // Fallback: direct CORS fetch (works if user already passed Cloudflare challenge)
        return fetch(url, { mode: 'cors' });
    }

    // Other external URLs: proxy first, fallback to direct
    const proxyUrl = '/api/avatar-proxy?url=' + encodeURIComponent(url);
    const res = await fetch(proxyUrl);
    if (res.ok) return res;
    console.warn(`[VRM-Manager] Proxy failed (${res.status}), trying direct download...`);
    return fetch(url, { mode: 'cors' });
}

function debounce(fn, ms) {
    let t;
    return function () {
        clearTimeout(t);
        const args = arguments;
        const self = this;
        t = setTimeout(function () {
            fn.apply(self, args);
        }, ms);
    };
}

function setStatus(msg) {
    const e = el('vm-status');
    if (e) e.textContent = msg || '';
}

function setCredStatus(id, connected) {
    const e = el(id);
    if (!e) return;
    e.textContent = connected ? 'Connected' : 'Not configured';
    e.className = 'vm-cred-status' + (connected ? ' connected' : '');
}

function updateLoadMore(visible, total) {
    const wrap = el('vm-load-more');
    if (!wrap) return;
    const hasMoreHub = VRMManager.hasMoreVroidHubPages();
    if (visible < total) {
        wrap.style.display = 'flex';
        wrap.querySelector('.vm-load-more-btn').textContent = `Load more (${total - visible} remaining)`;
    } else if (hasMoreHub) {
        // All client items shown but VRoid Hub has more pages
        wrap.style.display = 'flex';
        wrap.querySelector('.vm-load-more-btn').textContent = 'Load more from VRoid Hub...';
    } else {
        wrap.style.display = 'none';
    }
}

function toast(msg, type = 'info') {
    const container = el('vm-toast-container');
    if (!container) return;

    const t = document.createElement('div');
    t.className = `vm-toast ${type}`;
    t.textContent = msg;
    container.appendChild(t);

    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateX(100%)';
        t.style.transition = 'all 0.3s';
        setTimeout(() => t.remove(), 300);
    }, 4000);
}

/* ═══════════════════════════════════════════════════════════
   THUMBNAIL GENERATION — VRoid-style preview pipeline
   ═══════════════════════════════════════════════════════════ */

const THUMB_DB_NAME = 'vrm_avatar_thumbnails';
const THUMB_DB_VERSION = 1;
const THUMB_STORE = 'thumbnails';

/** Open (or create) the thumbnails IndexedDB */
function openThumbDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(THUMB_DB_NAME, THUMB_DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(THUMB_STORE)) {
                db.createObjectStore(THUMB_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** Save a thumbnail data-URL into IndexedDB */
async function saveThumbToDB(id, dataUrl) {
    try {
        const db = await openThumbDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(THUMB_STORE, 'readwrite');
            tx.objectStore(THUMB_STORE).put(dataUrl, 'thumb:' + id);
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error);
            };
        });
    } catch (e) {
        console.warn('[VM] Thumbnail DB save failed:', e);
    }
}

/** Load a thumbnail data-URL from IndexedDB */
async function loadThumbFromDB(id) {
    try {
        const db = await openThumbDB();
        return new Promise((resolve) => {
            const tx = db.transaction(THUMB_STORE, 'readonly');
            const req = tx.objectStore(THUMB_STORE).get('thumb:' + id);
            req.onsuccess = () => {
                db.close();
                resolve(req.result || '');
            };
            req.onerror = () => {
                db.close();
                resolve('');
            };
        });
    } catch (e) {
        return '';
    }
}

/** Pose presets for thumbnail framing */
const THUMB_POSE_PRESETS = {
    portrait: { rotY: 0.2, cameraYOff: 0.15, distFactor: 1.1 },
    threeQuarter: { rotY: 0.35, cameraYOff: 0.15, distFactor: 1.1 },
    fullbody: { rotY: 0, cameraYOff: 0.0, distFactor: 1.4 },
};

/**
 * Generate a VRoid-style thumbnail for an avatar.
 * Loads the model in an offscreen renderer, sets up studio lighting,
 * frames the character, renders, and returns a data-URL PNG.
 *
 * @param {Object} item - avatar item with .url and .format
 * @param {string} [pose='portrait'] - pose preset key
 * @returns {Promise<string>} data-URL or empty string on failure
 */
async function generateAvatarThumbnail(item, pose) {
    if (typeof THREE === 'undefined') {
        console.warn('[VM] Three.js not loaded — cannot generate thumbnail');
        return '';
    }
    if (!THREE.GLTFLoader) {
        console.warn('[VM] GLTFLoader not available — cannot generate thumbnail');
        return '';
    }

    // Wait briefly for ESM modules to load (KTX2Loader, MeshoptDecoder from vrm-manager.html)
    if (!THREE.KTX2Loader || !THREE.MeshoptDecoder) {
        await new Promise((r) => setTimeout(r, 500));
    }

    const preset = THUMB_POSE_PRESETS[pose] || THUMB_POSE_PRESETS.portrait;
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true,
        });
        renderer.setSize(size, size, false);
        renderer.setPixelRatio(1);
        renderer.outputEncoding = THREE.sRGBEncoding;
    } catch (e) {
        console.warn('[VM] WebGL context failed for thumbnail:', e);
        return '';
    }

    const scene = new THREE.Scene();
    const isVRM = item.format === 'vrm' || (item.url && item.url.toLowerCase().endsWith('.vrm'));
    // VRM: transparent background (looks great already)
    // GLB: match card background color so thumbnails look consistent with VRM
    scene.background = isVRM ? null : new THREE.Color(0x0a1018);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

    // Enhanced studio lighting (key + fill + rim + face)
    const ambient = new THREE.HemisphereLight(0xffffff, 0x334455, 1.6);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(1.0, 2.0, 2.5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xbfdfff, 0.9);
    fillLight.position.set(-1.5, 1.2, 1.5);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xaadfff, 0.7);
    rimLight.position.set(0.5, 1.5, -2.0);
    scene.add(rimLight);
    // Face fill — soft light from front to illuminate face details
    const faceLight = new THREE.DirectionalLight(0xffffff, 0.5);
    faceLight.position.set(0, 1.8, 3.0);
    scene.add(faceLight);

    try {
        const loader = new THREE.GLTFLoader();
        // Set up KTX2 loader for models that use KTX2/BasisU textures
        if (THREE.KTX2Loader && renderer) {
            const ktx2 = new THREE.KTX2Loader();
            ktx2.setTranscoderPath('/vendor/three-0.147.0/examples/jsm/libs/basis/');
            ktx2.detectSupport(renderer);
            loader.setKTX2Loader(ktx2);
        }
        // Set up meshopt decoder for models with meshopt compression
        if (THREE.MeshoptDecoder) {
            loader.setMeshoptDecoder(THREE.MeshoptDecoder);
        }

        // Determine how to load the model:
        // 1. Try cached blob from IndexedDB first (already downloaded models)
        // 2. For external URLs, use the proxy to avoid CORS issues
        // 3. For local URLs, load directly
        let loadUrl = item.url;

        // Resolve vroid-hub: scheme — not a real URL, resolve to actual download URL
        if (loadUrl && loadUrl.startsWith('vroid-hub:')) {
            if (typeof VRMManager !== 'undefined' && VRMManager.getVroidHubDownloadUrl) {
                try {
                    const modelId = loadUrl.replace('vroid-hub:', '');
                    const realUrl = await VRMManager.getVroidHubDownloadUrl(modelId);
                    if (realUrl) {
                        loadUrl = realUrl;
                    } else {
                        // Can't resolve — will try cached blob below
                        loadUrl = '';
                    }
                } catch (_) {
                    loadUrl = '';
                }
            } else {
                loadUrl = '';
            }
        }

        const isExternal = loadUrl && (loadUrl.startsWith('https://') || loadUrl.startsWith('http://'));

        // Skip non-downloadable URLs (VRoid Hub web pages, etc.)
        if (isExternal && !/\.(vrm|glb|gltf)(\?.*)?$/i.test(loadUrl)) {
            renderer.dispose();
            return '';
        }

        let gltf;
        // Try loading from cached blob first
        let cachedBlob = null;
        if (typeof VRMManager !== 'undefined' && VRMManager.getCachedBlob) {
            try {
                const cached = await VRMManager.getCachedBlob(item.id);
                if (cached && cached.blob) cachedBlob = cached.blob;
            } catch (_) {}
        }

        if (cachedBlob) {
            // Load from cached blob (no network needed)
            const arrayBuffer = await cachedBlob.arrayBuffer();
            gltf = await new Promise((resolve, reject) => {
                loader.parse(arrayBuffer, '', resolve, reject);
            });
        } else if (isExternal) {
            // Use resilient fetch (direct + retry + proxy fallback), then parse
            const modelRes = await fetchModelUrl(loadUrl);
            if (!modelRes.ok) throw new Error(`Download failed: ${modelRes.status}`);
            const ab = await modelRes.arrayBuffer();
            gltf = await new Promise((resolve, reject) => {
                loader.parse(ab, '', resolve, reject);
            });
        } else {
            // Local URL — fetch and validate before parsing to avoid cryptic GLTFLoader errors
            const resp = await fetch(loadUrl);
            if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${loadUrl}`);
            const ct = resp.headers.get('content-type') || '';
            if (ct.includes('text/html')) {
                throw new Error(`Server returned HTML instead of model file for ${loadUrl} (file may not exist)`);
            }
            const arrayBuffer = await resp.arrayBuffer();
            // Validate GLB magic bytes ('glTF') before parsing — catches SPA fallback
            // HTML pages served with application/octet-stream for missing files
            const magic = new Uint8Array(arrayBuffer.slice(0, 4));
            const isGLB = magic[0] === 0x67 && magic[1] === 0x6c && magic[2] === 0x54 && magic[3] === 0x46;
            if (!isGLB) {
                // Check if it starts with '<' (HTML) or '{' (JSON/glTF)
                const firstByte = magic[0];
                if (firstByte === 0x3c) {
                    // '<'
                    throw new Error(`Server returned HTML instead of model file for ${loadUrl} (file may not exist)`);
                }
                if (firstByte !== 0x7b) {
                    // not '{' either (valid glTF JSON)
                    throw new Error(`File at ${loadUrl} is not a valid GLB/glTF model`);
                }
            }
            gltf = await new Promise((resolve, reject) => {
                loader.parse(arrayBuffer, '', resolve, reject);
            });
        }

        const root = gltf.scene;
        if (!root) throw new Error('No scene in GLTF');

        scene.add(root);

        // Camera is at +Z looking toward center.
        // VRM models face -Z (VRM spec), rotate to face camera at +Z.
        // GLB models already face the camera without rotation.
        const isVRM = item.format === 'vrm' || (item.url && item.url.toLowerCase().endsWith('.vrm'));
        root.rotation.y = (isVRM ? Math.PI : 0) + preset.rotY;

        // Relax T-pose arms for more natural thumbnail look
        if (window.NEXUS_POSE_NORMALIZER) {
            window.NEXUS_POSE_NORMALIZER.applyThumbnailPose(root, {});
        } else {
            // Legacy fallback: fixed Euler rotation by bone name
            root.traverse((bone) => {
                if (!bone.isBone) return;
                const n = (bone.name || '').toLowerCase();
                if (
                    n.includes('leftupperarm') ||
                    n.includes('left_upper_arm') ||
                    n === 'j_buki_l' ||
                    n.includes('upperarm_l')
                ) {
                    bone.rotation.z += 0.7;
                }
                if (
                    n.includes('rightupperarm') ||
                    n.includes('right_upper_arm') ||
                    n === 'j_buki_r' ||
                    n.includes('upperarm_r')
                ) {
                    bone.rotation.z -= 0.7;
                }
                if (
                    n.includes('leftlowerarm') ||
                    n.includes('left_lower_arm') ||
                    n === 'j_ude_l' ||
                    n.includes('lowerarm_l')
                ) {
                    bone.rotation.z += 0.15;
                }
                if (
                    n.includes('rightlowerarm') ||
                    n.includes('right_lower_arm') ||
                    n === 'j_ude_r' ||
                    n.includes('lowerarm_r')
                ) {
                    bone.rotation.z -= 0.15;
                }
            });
        }

        // Auto-frame: full body with face visible
        const box = new THREE.Box3().setFromObject(root);
        const sizeVec = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(sizeVec);
        box.getCenter(center);

        // Frame based on HEIGHT (not max dim — T-pose arms inflate width)
        const targetY = center.y + sizeVec.y * preset.cameraYOff;
        const distance = Math.max(1.2, sizeVec.y * preset.distFactor);

        camera.position.set(center.x, targetY, center.z + distance);
        camera.lookAt(center.x, targetY, center.z);

        renderer.render(scene, camera);
        const dataUrl = canvas.toDataURL('image/png');

        // Dispose resources
        scene.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
                else obj.material.dispose();
            }
        });
        renderer.dispose();

        return dataUrl;
    } catch (err) {
        console.error('[VM] Thumbnail generation failed for', item.id, ':', err);
        renderer.dispose();
        return '';
    }
}

/**
 * Generate and persist a thumbnail for an avatar item.
 * Updates the item, saves to installedAvatars, and stores in IndexedDB.
 */
async function generateAndSaveThumbnail(item) {
    const preview = await generateAvatarThumbnail(item);
    if (!preview) return '';

    item.preview = preview;
    if (installedAvatars[item.id]) {
        installedAvatars[item.id].preview = preview;
        VRMManager.saveInstalled();
    }

    // Sync thumbnail to Browse Catalog (allItems) so both tabs show it
    const catalogItem = allItems.find((x) => x.id === item.id);
    if (catalogItem && !catalogItem.preview) {
        catalogItem.preview = preview;
    }

    // Persist in IndexedDB (avoids localStorage bloat from large base64)
    await saveThumbToDB(item.id, preview);

    return preview;
}

/**
 * Restore thumbnails from IndexedDB for installed avatars that have no preview.
 * Called once at startup.
 */
async function restoreThumbnailsFromDB() {
    for (const id of Object.keys(installedAvatars)) {
        const item = installedAvatars[id];
        if (item.preview) continue;
        const saved = await loadThumbFromDB(id);
        if (saved) {
            item.preview = saved;
        }
    }
    // Also patch allItems
    allItems.forEach((it) => {
        if (!it.preview && installedAvatars[it.id] && installedAvatars[it.id].preview) {
            it.preview = installedAvatars[it.id].preview;
        }
    });
}

/* ═══════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => VRMManager.init());
