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
    // Tier 1: CC0 VRM — Full Face Animation (18 avatars)
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
        id: 'vrm-avatar-orion',
        name: 'Avatar Orion',
        icon: '🚀',
        desc: 'Compact VRM avatar — Orion character. Full expressions. CC0.',
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/Avatar_Orion.vrm',
        tags: ['vroid', 'cc0', 'compact'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 6000000,
        installed: true,
    },
    {
        id: 'vrm-cryptovoxels',
        name: 'Cryptovoxels',
        icon: '🎮',
        desc: 'Voxel-style VRM avatar. Lightweight with VRM expressions. CC0.',
        source: 'Madjin (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/cryptovoxels.vrm',
        tags: ['voxel', 'cc0', 'tiny'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 232000,
        installed: true,
    },
    {
        id: 'vrm-seed-san',
        name: 'Seed-san',
        icon: '🌱',
        desc: 'Official VRoid Hub mascot character. VRM with standard blend shapes.',
        source: 'VRM Consortium (CC-BY)',
        sourceId: 'vroid-hub',
        format: 'vrm',
        license: 'cc-by',
        url: '/vendor/avatars/Seed-san.vrm',
        tags: ['mascot', 'vroid', 'official'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 10900000,
        installed: true,
    },
    {
        id: 'vrm-vrm1-sample',
        name: 'VRM1 Sample',
        icon: '🤖',
        desc: 'Official VRM 1.0 spec sample. Constraints, SpringBones, expressions.',
        source: 'Pixiv (CC0)',
        sourceId: 'github-three-vrm',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/VRM1_Constraint_Twist_Sample.vrm',
        tags: ['vrm1', 'pixiv', 'sample'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 10700000,
        installed: true,
    },

    {
        id: 'vrm-meebit',
        name: 'Meebit 09842',
        icon: '🧊',
        desc: 'Voxel-style Meebit character converted to VRM. Compact with expressions. CC0.',
        source: 'Madjin (CC0)',
        sourceId: 'github-vrm-samples',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/meebit_09842.vrm',
        tags: ['meebit', 'voxel', 'cc0', 'compact'],
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        size: 726000,
        installed: true,
    },

    // ══════════════════════════════════════════════════════════
    // Tier 2: GLB with Morph Targets — Beta (7 avatars)
    // ══════════════════════════════════════════════════════════
    {
        id: 'glb-brunette',
        name: 'Brunette (TalkingHead)',
        icon: '💃',
        desc: 'Full-body avatar with ARKit + Oculus viseme blend shapes. Ready for lip-sync.',
        source: 'TalkingHead',
        sourceId: 'github-talkinghead',
        format: 'glb-morph',
        license: 'free',
        url: '/vendor/avatars/brunette.glb',
        tags: ['arkit', 'visemes', 'female'],
        features: ['lipsync', 'emotions', 'blink'],
        size: 4700000,
        installed: true,
    },
    {
        id: 'glb-brunette-t',
        name: 'Brunette T-Pose (TalkingHead)',
        icon: '🧍‍♀️',
        desc: 'T-pose version of brunette avatar. ARKit + Oculus viseme blend shapes.',
        source: 'TalkingHead',
        sourceId: 'github-talkinghead',
        format: 'glb-morph',
        license: 'free',
        url: '/vendor/avatars/brunette-t.glb',
        tags: ['arkit', 'visemes', 'female', 't-pose'],
        features: ['lipsync', 'emotions', 'blink'],
        size: 2900000,
        installed: true,
    },
    {
        id: 'glb-avaturn',
        name: 'Avaturn (TalkingHead)',
        icon: '🧑‍🦱',
        desc: 'Avaturn-generated avatar with ARKit + Oculus viseme blend shapes.',
        source: 'TalkingHead',
        sourceId: 'github-talkinghead',
        format: 'glb-morph',
        license: 'free',
        url: '/vendor/avatars/avaturn.glb',
        tags: ['arkit', 'visemes', 'avaturn'],
        features: ['lipsync', 'emotions', 'blink'],
        size: 13700000,
        installed: true,
    },
    {
        id: 'glb-avatarsdk',
        name: 'AvatarSDK (TalkingHead)',
        icon: '🧑‍💻',
        desc: 'AvatarSDK-generated avatar with ARKit + Oculus viseme blend shapes.',
        source: 'TalkingHead',
        sourceId: 'github-talkinghead',
        format: 'glb-morph',
        license: 'free',
        url: '/vendor/avatars/avatarsdk.glb',
        tags: ['arkit', 'visemes', 'avatarsdk'],
        features: ['lipsync', 'emotions', 'blink'],
        size: 12300000,
        installed: true,
    },
    {
        id: 'glb-mpfb',
        name: 'MakeHuman (TalkingHead)',
        icon: '🧬',
        desc: 'MakeHuman/MPFB-generated avatar with ARKit + Oculus viseme blend shapes.',
        source: 'TalkingHead',
        sourceId: 'github-talkinghead',
        format: 'glb-morph',
        license: 'free',
        url: '/vendor/avatars/mpfb.glb',
        tags: ['arkit', 'visemes', 'makehuman'],
        features: ['lipsync', 'emotions', 'blink'],
        size: 36800000,
        installed: true,
    },

    {
        id: 'glb-facecap',
        name: 'FaceCap (ARKit)',
        icon: '😀',
        desc: 'Three.js ARKit face capture model with 52 facial blend shapes.',
        source: 'Three.js',
        sourceId: 'threejs',
        format: 'glb-morph',
        license: 'free',
        url: '/vendor/avatars/facecap.glb',
        tags: ['arkit', 'facecap', 'blendshapes'],
        features: ['lipsync', 'emotions', 'blink'],
        size: 333000,
        installed: true,
    },
    {
        id: 'glb-readyplayerme',
        name: 'ReadyPlayerMe Sample',
        icon: '🧑',
        desc: 'Ready Player Me sample avatar with morph targets. From three.js examples.',
        source: 'Ready Player Me',
        sourceId: 'readyplayerme',
        format: 'glb-morph',
        license: 'free',
        url: '/vendor/avatars/readyplayerme.glb',
        tags: ['rpm', 'morph-targets', 'sample'],
        features: ['lipsync', 'emotions', 'blink'],
        size: 1838000,
        installed: true,
    },

    // ══════════════════════════════════════════════════════════
    // Tier 3: GLB without Morph Targets — Body Only (5 avatars)
    // ══════════════════════════════════════════════════════════
    {
        id: 'glb-xbot',
        name: 'Xbot',
        icon: '🤖',
        desc: 'Three.js Xbot model. Rigged humanoid, no facial morph targets.',
        source: 'Three.js',
        sourceId: 'threejs',
        format: 'glb',
        license: 'free',
        url: '/vendor/avatars/Xbot.glb',
        tags: ['threejs', 'robot'],
        features: [],
        size: 2900000,
        installed: true,
    },
    {
        id: 'local-woman',
        name: 'Woman',
        icon: '👩‍💼',
        desc: 'Pre-installed GLB avatar. Body animation only.',
        source: 'Local',
        sourceId: 'local',
        format: 'glb',
        license: 'free',
        url: '/vendor/avatars/woman.glb',
        tags: ['local', 'pre-installed'],
        features: [],
        size: 14000000,
        installed: true,
    },
    {
        id: 'local-girl',
        name: 'Avatar',
        icon: '👧',
        desc: 'Pre-installed GLB avatar. Body animation only.',
        source: 'Local',
        sourceId: 'local',
        format: 'glb',
        license: 'free',
        url: '/vendor/avatars/girl.glb',
        tags: ['local', 'pre-installed'],
        features: [],
        size: 7700000,
        installed: true,
    },
    {
        id: 'local-student',
        name: 'Student',
        icon: '🧑‍🎓',
        desc: 'Pre-installed GLB avatar. Body animation only.',
        source: 'Local',
        sourceId: 'local',
        format: 'glb',
        license: 'free',
        url: '/vendor/avatars/student.glb',
        tags: ['local', 'pre-installed'],
        features: [],
        size: 1300000,
        installed: true,
    },
    {
        id: 'local-anime',
        name: 'Anime',
        icon: '🎌',
        desc: 'Pre-installed GLB avatar with anime style. Body animation only.',
        source: 'Local',
        sourceId: 'local',
        format: 'glb',
        license: 'free',
        url: '/vendor/avatars/anime.glb',
        tags: ['local', 'pre-installed', 'anime'],
        features: [],
        size: 4600000,
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
        desc: 'Official Pixiv three-vrm sample models. VRM 1.0 spec compliant.',
        auth: 'none',
        formats: ['vrm'],
        status: 'connected',
    },
    {
        id: 'github-talkinghead',
        name: 'TalkingHead Avatars',
        icon: '🗣️',
        url: 'github.com/met4citizen/TalkingHead',
        desc: 'Full-body GLB avatars with ARKit + Oculus viseme blend shapes. Three.js native.',
        auth: 'none',
        formats: ['glb-morph'],
        status: 'connected',
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
        signupUrl: 'https://hub.vroid.com/en/developers',
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
        desc: '300+ CC0 avatars fetched live from GitHub. No auth needed — automatic catalog.',
        auth: 'none',
        formats: ['vrm'],
        status: 'connected',
    },
];

/* ═══════════════════════════════════════════════════════════
   GLOBALS
   ═══════════════════════════════════════════════════════════ */

let allItems = [];
let currentFiltered = [];
let visibleCount = VM_CONFIG.PAGE_SIZE;
let installedAvatars = {};
let db = null;

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
    },

    async autoGenerateMissingThumbnails() {
        const missing = Object.values(installedAvatars).filter((it) => !it.preview && it.url && it.url.startsWith('/'));
        if (missing.length === 0) return;

        console.log(`[VRM-Manager] Auto-generating ${missing.length} missing thumbnails...`);
        for (const item of missing) {
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
    },

    saveCredentials() {
        // Read from UI fields
        this.credentials = {
            vroid: {
                appId: el('vm-vroid-app-id').value.trim(),
                appSecret: el('vm-vroid-app-secret').value.trim(),
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
            setVal('vm-vroid-app-id', c.vroid.appId || '');
            setVal('vm-vroid-app-secret', c.vroid.appSecret || '');
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

        // VRoid Hub
        const vroidOk = c.vroid && c.vroid.appId && c.vroid.appSecret;
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
            const appId = el('vm-vroid-app-id').value.trim();
            if (!appId) {
                toast('Enter your VRoid Hub App ID first', 'error');
                return;
            }
            // VRoid Hub uses OAuth — test by checking API availability
            try {
                const res = await fetch('https://hub.vroid.com/api/character_models?max_results=1', {
                    headers: { 'X-Api-Version': '11' },
                    mode: 'cors',
                });
                if (res.ok || res.status === 401) {
                    toast('VRoid Hub API is reachable. Note: Full OAuth flow requires server-side proxy.', 'info');
                } else {
                    toast(`VRoid Hub API returned ${res.status}`, 'error');
                }
            } catch (e) {
                toast('VRoid Hub API not reachable (CORS). A proxy server is needed for full integration.', 'error');
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
            if (copy.preview && copy.preview.startsWith('data:')) {
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

    async loadCatalog() {
        setStatus('Loading avatar catalog...');

        // Start with built-in catalog
        allItems = [...BUILTIN_CATALOG];

        // Try fetching from connected APIs in parallel
        const fetchers = [];

        // Open Source Avatars — always fetch (no auth, CC0)
        fetchers.push(this.fetchOpenSourceAvatars());

        // Sketchfab search (if connected)
        if (this.credentials.sketchfab && this.credentials.sketchfab.token) {
            fetchers.push(this.fetchSketchfabAvatars());
        }

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

        // Build source filter options
        this.populateSourceFilter();

        setStatus('');
        this.applyFilters();
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

    /* ── Open Source Avatars (GitHub JSON) ────────────── */

    async fetchOpenSourceAvatars() {
        const OSA_PROJECTS_URL = 'https://raw.githubusercontent.com/ToxSam/open-source-avatars/main/data/projects.json';
        try {
            const res = await fetch(OSA_PROJECTS_URL, { mode: 'cors' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const projects = await res.json();

            const avatars = [];
            for (const proj of projects) {
                // Each project may contain multiple avatars or be a single avatar
                const name = proj.name || proj.title || 'Unknown';
                const id = `osa-${(proj.id || proj.slug || name)
                    .toString()
                    .replace(/[^a-zA-Z0-9]/g, '-')
                    .toLowerCase()}`;
                const downloadUrl = proj.download_url || proj.vrm_url || proj.url || '';
                if (!downloadUrl) continue;

                avatars.push({
                    id,
                    name,
                    desc: (proj.description || proj.bio || `CC0 avatar from Open Source Avatars.`).slice(0, 150),
                    source: 'Open Source Avatars',
                    sourceId: 'opensourceavatars',
                    format: 'vrm',
                    license: 'cc0',
                    url: downloadUrl,
                    preview: proj.thumbnail || proj.image || proj.preview_url || '',
                    icon: '🆓',
                    tags: ['cc0', 'open-source', ...(proj.tags || []).slice(0, 2)],
                    features: ['lipsync', 'emotions', 'gaze', 'blink'],
                    size: proj.file_size || 0,
                });
            }
            return avatars;
        } catch (e) {
            console.warn('[VRM-Manager] Open Source Avatars fetch error:', e);
            return [];
        }
    },

    /* ── Direct URL Download ──────────────────────────── */

    async installFromUrl(url) {
        url = (url || '').trim();
        if (!url) {
            toast('Please enter a URL', 'error');
            return;
        }

        // Basic validation
        if (!/^https?:\/\/.+\.(vrm|glb|gltf)(\?.*)?$/i.test(url)) {
            toast('URL must point to a .vrm, .glb, or .gltf file', 'error');
            return;
        }

        const fileName = url.split('/').pop().split('?')[0];
        const ext = fileName.split('.').pop().toLowerCase();
        const format = ext === 'vrm' ? 'vrm' : 'glb';
        const baseName = fileName.replace(/\.[^.]+$/, '');
        const id = `url-${Date.now()}-${sanitizeFileName(baseName)}`;

        toast(`Downloading ${fileName}...`, 'info');

        try {
            // Use avatar proxy for external URLs to bypass CORS
            const isExternal = url.startsWith('https://') || url.startsWith('http://');
            const fetchUrl = isExternal ? '/api/avatar-proxy?url=' + encodeURIComponent(url) : url;
            const res = await fetch(fetchUrl);
            if (!res.ok) throw new Error(`Download failed: ${res.status}`);

            const blob = await res.blob();

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

    populateSourceFilter() {
        const sourceSet = {};
        allItems.forEach((it) => {
            sourceSet[it.source] = true;
        });
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
        const search = (el('vm-search').value || '').trim().toLowerCase();
        const source = el('vm-filter-source').value;
        const format = el('vm-filter-format').value;
        const license = el('vm-filter-license').value;

        currentFiltered = allItems.filter((item) => {
            if (source && item.source !== source) return false;
            if (format && item.format !== format) return false;
            if (license && item.license !== license) return false;
            if (search) {
                const hay = [item.name, item.desc, item.source, (item.tags || []).join(' ')].join(' ').toLowerCase();
                if (!hay.includes(search)) return false;
            }
            return true;
        });

        // Sort: VRM first, then GLB+morph, then GLB. Installed last.
        const formatOrder = { vrm: 0, 'glb-morph': 1, glb: 2 };
        currentFiltered.sort((a, b) => {
            const aInst = this.isInstalled(a.id) ? 1 : 0;
            const bInst = this.isInstalled(b.id) ? 1 : 0;
            if (aInst !== bInst) return aInst - bInst;
            return (formatOrder[a.format] || 9) - (formatOrder[b.format] || 9);
        });

        visibleCount = VM_CONFIG.PAGE_SIZE;
        this.renderGrid(currentFiltered);
        this.updateStats();
    },

    renderGrid(items) {
        const grid = el('vm-grid');
        grid.innerHTML = '';

        if (!items.length) {
            grid.innerHTML = `
        <div class="vm-empty" style="grid-column:1/-1">
          <div class="vm-empty-icon">🔍</div>
          <div class="vm-empty-title">No avatars found</div>
          <p>Try a different search, adjust filters, or connect more sources in Settings.</p>
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

        // Buttons
        let btnHtml;
        if (isInstalledView) {
            btnHtml = `
        <div class="vm-card-btn-row">
          <button class="vm-card-btn vm-card-btn-install" onclick="VRMManager.useAvatar('${esc(item.id)}')">Use Now</button>
          <button class="vm-card-btn vm-card-btn-preview" onclick="VRMManager.previewAvatar('${esc(item.id)}')">Details</button>
          ${!isCoreSys ? `<button class="vm-card-btn vm-card-btn-remove" onclick="VRMManager.removeAvatar('${esc(item.id)}')">Uninstall</button>` : ''}
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

                // Sketchfab needs special download flow
                if (item.sketchfabUid && this.credentials.sketchfab?.token) {
                    downloadUrl = await this.getSketchfabDownloadUrl(item.sketchfabUid);
                    if (!downloadUrl) throw new Error('Could not get Sketchfab download URL');
                }

                // Use avatar proxy for external URLs to bypass CORS
                const isExternal = downloadUrl.startsWith('https://') || downloadUrl.startsWith('http://');
                const fetchUrl = isExternal ? '/api/avatar-proxy?url=' + encodeURIComponent(downloadUrl) : downloadUrl;
                const res = await fetch(fetchUrl);
                if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

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
      <div class="vm-detail-row"><span class="vm-detail-label">License</span><span class="vm-detail-value">${esc(item.license.toUpperCase())}</span></div>
      <div class="vm-detail-row"><span class="vm-detail-label">Size</span><span class="vm-detail-value">${formatBytes(item.size)}</span></div>
      <div class="vm-detail-row"><span class="vm-detail-label">Tags</span><span class="vm-detail-value">${(item.tags || []).join(', ') || 'None'}</span></div>
      <div style="margin-top:12px"><span class="vm-detail-label">Features</span><div style="margin-top:6px">${features}</div></div>

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
    _startLivePreview(item, container) {
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
        const modelUrl = item.url;
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

        SOURCES.forEach((src) => {
            const card = document.createElement('div');
            card.className = 'vm-source-card';

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

            card.innerHTML = `
        <div class="vm-source-card-header">
          <div class="vm-source-card-icon">${src.icon}</div>
          <div>
            <div class="vm-source-card-title">${esc(src.name)}</div>
            <div class="vm-source-card-url">${esc(src.url)}</div>
          </div>
        </div>
        <div class="vm-source-card-desc">${esc(src.desc)}</div>
        <div class="vm-source-card-meta">
          <span class="vm-source-card-status ${statusClass}">${statusLabel}</span>
          ${formatBadges}
        </div>
        <div class="vm-source-card-actions">${actionsHtml}</div>`;

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

        // Filters
        el('vm-filter-source').addEventListener('change', () => this.applyFilters());
        el('vm-filter-format').addEventListener('change', () => this.applyFilters());
        el('vm-filter-license').addEventListener('change', () => this.applyFilters());

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

        // Load more
        const loadMoreBtn = document.querySelector('.vm-load-more-btn');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => {
                visibleCount += VM_CONFIG.PAGE_SIZE;
                this.renderGrid(currentFiltered);
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
        if (tabName === 'catalog') this.applyFilters();
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
    if (visible < total) {
        wrap.style.display = 'flex';
        wrap.querySelector('.vm-load-more-btn').textContent = `Load more (${total - visible} remaining)`;
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
        const gltf = await new Promise((resolve, reject) => {
            loader.load(item.url, resolve, undefined, reject);
        });

        const root = gltf.scene;
        if (!root) throw new Error('No scene in GLTF');

        scene.add(root);

        // Camera is at +Z looking toward center.
        // VRM models face -Z (VRM spec), rotate to face camera at +Z.
        // GLB models already face the camera without rotation.
        const isVRM = item.format === 'vrm' || (item.url && item.url.toLowerCase().endsWith('.vrm'));
        root.rotation.y = (isVRM ? Math.PI : 0) + preset.rotY;

        // Relax T-pose arms for more natural look
        root.traverse((bone) => {
            if (!bone.isBone) return;
            const n = (bone.name || '').toLowerCase();
            // Left upper arm — rotate down ~40 degrees
            if (
                n.includes('leftupperarm') ||
                n.includes('left_upper_arm') ||
                n === 'j_buki_l' ||
                n.includes('upperarm_l')
            ) {
                bone.rotation.z += 0.7;
            }
            // Right upper arm — rotate down ~40 degrees (opposite direction)
            if (
                n.includes('rightupperarm') ||
                n.includes('right_upper_arm') ||
                n === 'j_buki_r' ||
                n.includes('upperarm_r')
            ) {
                bone.rotation.z -= 0.7;
            }
            // Slight elbow bend for natural look
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
