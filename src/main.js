/**
 * Nexus Avatar - Main Application Controller (PROD, GLOBAL build) — UPDATED (LANG + VOICE PREFS)
 *
 * Key additions in this version:
 * ✅ Speech Settings persisted (language, voice, preference, rate, pitch)
 * ✅ "Any / Male / Female" preference filter (heuristic based)
 * ✅ Voice dropdown filters by selected Language
 * ✅ "Auto (best match)" logic in speakText
 * ✅ "TEST VOICE" button support
 * ✅ Preserves ViewerEngine + Proxy + Test Connection patch logic
 */

'use strict';

/* =========================================================
   Device Detection — early, before any DOM mutation
   Adds classes to <html> so CSS can adapt immediately.
   ========================================================= */
(function applyDeviceMode() {
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    const isTablet = window.matchMedia('(min-width: 768px) and (max-width: 1024px)').matches;
    const ua = navigator.userAgent || '';
    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isHeadset = /OculusBrowser|Quest|Vive|Pico|Wolvic/i.test(ua);

    const cl = document.documentElement.classList;
    cl.toggle('is-mobile', isMobile);
    cl.toggle('is-tablet', isTablet);
    cl.toggle('is-desktop', !isMobile && !isTablet);
    cl.toggle('is-android-phone', isAndroid && !isHeadset);
    cl.toggle('is-ios', isIOS);
    cl.toggle('is-headset', isHeadset);

    // Re-evaluate on resize (orientation changes)
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const mob = window.matchMedia('(max-width: 767px)').matches;
            const tab = window.matchMedia('(min-width: 768px) and (max-width: 1024px)').matches;
            cl.toggle('is-mobile', mob);
            cl.toggle('is-tablet', tab);
            cl.toggle('is-desktop', !mob && !tab);
        }, 150);
    });
})();

/* =========================================================
   Speech Settings (persisted)
   ========================================================= */
const SpeechSettings = {
    lang: localStorage.getItem('speech_lang') || 'en-US',
    voiceURI: localStorage.getItem('speech_voice_uri') || '',
    voicePref: localStorage.getItem('speech_voice_pref') || 'any', // any|female|male
    rate: parseFloat(localStorage.getItem('speech_rate') || '0.9'),
    pitch: parseFloat(localStorage.getItem('speech_pitch') || '1.0'),
    autoSend: localStorage.getItem('stt_auto_send') === 'true',
};

/* =========================================================
   Strict Global Aliases (GLOBAL build)
   ========================================================= */
const THREE = window.THREE;
const OrbitControls = window.OrbitControls || (THREE && THREE.OrbitControls) || null;
const GLTFLoader = window.GLTFLoader || (THREE && THREE.GLTFLoader) || null;

/* =========================================================
   Config: Avatar Manifest
   ========================================================= */
const AVATAR_MANIFEST_URL = '/vendor/avatars/avatars.json';

/* ============================
   Application State
   ============================ */
let scene, camera, renderer, controls, clock;
let currentAvatar = null;
let mixer = null;
let animations = {};
let currentAnimationAction = null;

let recognition = null;
let isListening = false;

let currentObjectURL = null;
let loaderWatchdogTimer = null;

/** Dynamic avatar list loaded from manifest */
let avatarItems = []; // [{name,file,url}]
let avatarBasePath = '/vendor/avatars';

/** Framing state */
let lastFrameFitOffset = 1.35;

/** Scene helpers */
let floorMesh = null;
let dirLight = null;

/* ============================
   Configuration (Providers)
   ============================ */

/**
 * Load config from unified LLMManager settings or fall back to legacy keys.
 * This ensures desktop and VR share the same settings (nexus_llm_settings).
 */
function loadConfig() {
    const defaults = {
        provider: 'none',
        apiKey: '',
        model: '',
        systemPrompt: 'You are a helpful AI assistant named Nexus. You are friendly, professional, and knowledgeable.',
        watsonxProjectId: '',
        baseUrl: '',
    };

    try {
        // 1) Try loading from unified LLMManager key (shared with VR)
        const unified = localStorage.getItem('nexus_llm_settings');
        if (unified) {
            const settings = JSON.parse(unified);
            console.log('[Main] Loading config from unified settings (nexus_llm_settings):', settings.provider);

            // Extract provider-specific settings
            let apiKey = '';
            let model = '';
            let baseUrl = '';
            let watsonxProjectId = '';

            if (settings.provider === 'openai' && settings.openai) {
                apiKey = settings.openai.api_key || '';
                model = settings.openai.model || 'gpt-4o';
                baseUrl = settings.openai.base_url || '';
            } else if (settings.provider === 'claude' && settings.claude) {
                apiKey = settings.claude.api_key || '';
                model = settings.claude.model || 'claude-3-5-sonnet-20240620';
                baseUrl = settings.claude.base_url || '';
            } else if (settings.provider === 'watsonx' && settings.watsonx) {
                apiKey = settings.watsonx.api_key || '';
                model = settings.watsonx.model_id || 'ibm/granite-13b-chat-v2';
                baseUrl = settings.watsonx.base_url || 'https://us-south.ml.cloud.ibm.com';
                watsonxProjectId = settings.watsonx.project_id || '';
            } else if (settings.provider === 'ollama' && settings.ollama) {
                model = settings.ollama.model || 'llama3';
                baseUrl = settings.ollama.base_url || 'http://localhost:11434';
            } else if (settings.provider === 'ollabridge' && settings.ollabridge) {
                apiKey = settings.ollabridge.api_key || '';
                model = settings.ollabridge.model || 'default';
                baseUrl = settings.ollabridge.base_url || 'http://localhost:11435';
            }

            return {
                provider: settings.provider || defaults.provider,
                apiKey: apiKey,
                model: model,
                systemPrompt: settings.system_prompt || defaults.systemPrompt,
                watsonxProjectId: watsonxProjectId,
                baseUrl: baseUrl,
            };
        }
    } catch (e) {
        console.warn('[Main] Failed to load unified settings, falling back to legacy keys:', e);
    }

    // 2) Fall back to legacy localStorage keys (backward compatible)
    console.log('[Main] Loading config from legacy localStorage keys');
    return {
        provider: localStorage.getItem('ai_provider') || defaults.provider,
        apiKey: localStorage.getItem('ai_api_key') || defaults.apiKey,
        model: localStorage.getItem('ai_model') || defaults.model,
        systemPrompt: localStorage.getItem('system_prompt') || defaults.systemPrompt,
        watsonxProjectId: localStorage.getItem('watsonx_project_id') || defaults.watsonxProjectId,
        baseUrl: localStorage.getItem('base_url') || defaults.baseUrl,
    };
}

const config = loadConfig();

/* ============================
   One-Time Migration: Legacy → Unified Settings
   ============================ */
// Automatically migrate existing settings to unified format for VR compatibility
(function migrateLegacySettings() {
    try {
        // Check if unified settings already exist
        if (localStorage.getItem('nexus_llm_settings')) {
            console.log('[Main] Unified settings already exist, skipping migration');
            return;
        }

        // Check if legacy settings exist
        const legacyProvider = localStorage.getItem('ai_provider');
        if (!legacyProvider || legacyProvider === 'none') {
            console.log('[Main] No legacy settings to migrate');
            return;
        }

        // Create LLMManager and save current config to unified format
        if (typeof window.LLMManager === 'function') {
            console.log('[Main] 🔄 Migrating legacy settings to unified format...');
            window._nexusLLM = new window.LLMManager();

            const patch = {
                provider: config.provider,
                system_prompt: config.systemPrompt,
                proxy: {
                    enable_proxy: true,
                    proxy_url: '/api/proxy',
                },
            };

            if (config.provider === 'openai') {
                patch.openai = {
                    api_key: config.apiKey,
                    model: config.model || 'gpt-4o',
                    base_url: config.baseUrl || '',
                };
            } else if (config.provider === 'claude') {
                patch.claude = {
                    api_key: config.apiKey,
                    model: config.model || 'claude-3-5-sonnet-20240620',
                    base_url: config.baseUrl || '',
                };
            } else if (config.provider === 'watsonx') {
                patch.watsonx = {
                    api_key: config.apiKey,
                    project_id: config.watsonxProjectId || '',
                    model_id: config.model || 'ibm/granite-13b-chat-v2',
                    base_url: config.baseUrl || 'https://us-south.ml.cloud.ibm.com',
                };
            } else if (config.provider === 'ollama') {
                patch.ollama = {
                    base_url: config.baseUrl || 'http://localhost:11434',
                    model: config.model || 'llama3',
                };
            } else if (config.provider === 'ollabridge') {
                patch.ollabridge = {
                    api_key: config.apiKey,
                    base_url: config.baseUrl || 'http://localhost:11435',
                    model: config.model || 'default',
                };
            }

            window._nexusLLM.updateSettings(patch);
            console.log('[Main] ✅ Migration complete! VR will now use:', config.provider);
        } else {
            console.warn('[Main] LLMManager not loaded yet, migration will retry on settings save');
        }
    } catch (e) {
        console.warn('[Main] Migration failed (non-fatal):', e);
    }
})();

/* ============================
   One-Time Migration: Legacy TTS Settings → Unified Settings
   ============================ */
// Migrate existing TTS settings from individual keys to nexus_settings_v1
(function migrateLegacyTTSSettings() {
    try {
        // Check if unified settings already have TTS config
        const unifiedRaw = localStorage.getItem('nexus_settings_v1');
        if (unifiedRaw) {
            try {
                const settings = JSON.parse(unifiedRaw);
                // If speechVoice or speechRate exists, assume migration already done
                if (settings.speechVoice !== undefined || settings.speechRate !== undefined) {
                    console.log('[Main] TTS settings already in unified format, skipping migration');
                    return;
                }
            } catch (e) {
                // Invalid JSON, will recreate below
            }
        }

        // Check if legacy TTS settings exist
        const legacyVoiceURI = localStorage.getItem('speech_voice_uri');
        const legacyRate = localStorage.getItem('speech_rate');
        const legacyPitch = localStorage.getItem('speech_pitch');
        const legacyLang = localStorage.getItem('speech_lang');

        if (!legacyVoiceURI && !legacyRate && !legacyPitch && !legacyLang) {
            console.log('[Main] No legacy TTS settings to migrate');
            return;
        }

        console.log('[Main] 🔄 Migrating legacy TTS settings to unified format...');

        // Resolve the voice object from URI
        const voices = window.speechSynthesis?.getVoices?.() || [];
        const resolvedVoice = legacyVoiceURI ? voices.find((v) => v.voiceURI === legacyVoiceURI) : null;

        // Build unified TTS config from legacy settings
        const ttsConfig = {
            // ✅ Name goes here
            speechVoice: resolvedVoice?.name || '',

            // ✅ URI goes here
            speechVoiceURI: legacyVoiceURI || '',

            speechRate: legacyRate ? parseFloat(legacyRate) : 0.9,
            speechPitch: legacyPitch ? parseFloat(legacyPitch) : 1.0,
            speechVolume: 1.0, // Default (not stored in legacy)
            speechLang: legacyLang || 'en-US',
            ttsEnabled: true, // Default (not stored in legacy)
        };

        // Save to unified format
        if (window.SpeechService) {
            window.SpeechService.saveTTSConfig(ttsConfig);
            console.log('[Main] ✅ TTS migration complete! VR will now use desktop voice settings');
        } else {
            // Fallback: save directly if SpeechService not loaded yet
            let settings = {};
            if (unifiedRaw) {
                try {
                    settings = JSON.parse(unifiedRaw);
                } catch (e) {
                    // Ignore parse error
                }
            }
            localStorage.setItem('nexus_settings_v1', JSON.stringify({ ...settings, ...ttsConfig }));
            console.log('[Main] ✅ TTS migration complete (direct save)');
        }
    } catch (e) {
        console.warn('[Main] TTS migration failed (non-fatal):', e);
    }
})();

/* ============================
   Helpers
   ============================ */
function $(id) {
    return document.getElementById(id);
}

function safeClass(el, action, cls) {
    if (!el) return;
    if (action === 'add') el.classList.add(cls);
    if (action === 'remove') el.classList.remove(cls);
}

function logWarn(msg, extra) {
    console.warn(`[Nexus] ${msg}`, extra || '');
}

function logError(msg, extra) {
    console.error(`[Nexus] ${msg}`, extra || '');
}

/* ============================
   Loading Overlay
   ============================ */
function showLoading(message = 'Loading 3D Avatar...') {
    const overlay = $('loading-overlay');
    const text = $('loading-text') || document.querySelector('.loading-text');
    if (text) text.textContent = message;
    if (overlay) safeClass(overlay, 'remove', 'hidden');
}

function hideLoading() {
    const overlay = $('loading-overlay');
    if (overlay) safeClass(overlay, 'add', 'hidden');
}

function startLoaderWatchdog(ms = 20000) {
    stopLoaderWatchdog();
    loaderWatchdogTimer = setTimeout(() => {
        showLoading('Avatar load timed out. Try another avatar.');
        setStatus('idle', 'TIMEOUT');
    }, ms);
}

function stopLoaderWatchdog() {
    if (loaderWatchdogTimer) {
        clearTimeout(loaderWatchdogTimer);
        loaderWatchdogTimer = null;
    }
}

/* ============================
   Status Indicator
   ============================ */
function setStatus(mode, text) {
    const indicator = $('status-indicator');
    const statusText = $('status-text');
    if (statusText) statusText.textContent = text || '';

    const sessionSubtitle = $('session-subtitle');
    if (sessionSubtitle) sessionSubtitle.textContent = text || '';

    const aiStatus = $('ai-response-status');
    if (aiStatus)
        aiStatus.textContent =
            mode === 'speaking' ? 'Speaking…' : mode === 'listening' ? 'Listening…' : 'Awaiting input…';

    if (indicator) {
        indicator.classList.remove('speaking', 'listening');
        if (mode === 'speaking') indicator.classList.add('speaking');
        if (mode === 'listening') indicator.classList.add('listening');
    }
}

/* =========================================================
   Vendor Guard
   ========================================================= */
function vendorAssertOrAbort() {
    const missing = [];
    if (!THREE) missing.push('THREE');
    if (!GLTFLoader) missing.push('GLTFLoader');
    if (!OrbitControls) missing.push('OrbitControls');

    if (missing.length === 0) return true;

    const el = $('loading-text');
    if (el) el.textContent = `Initialization failed: ${missing.join(', ')} missing. Open DevTools console.`;
    console.error('[Nexus] Missing vendor globals:', missing);
    return false;
}

/* =========================================================
   VRM Manager IndexedDB Blob Restore
   ========================================================= */
function loadBlobFromVRMCache(fileKey) {
    return new Promise((resolve) => {
        try {
            const req = indexedDB.open('vrm_avatar_cache', 1);
            req.onerror = () => resolve(null);
            req.onsuccess = () => {
                try {
                    const db = req.result;
                    const tx = db.transaction('avatars', 'readonly');
                    const get = tx.objectStore('avatars').get(fileKey);
                    get.onsuccess = () => {
                        if (get.result && get.result.blob) {
                            const url = URL.createObjectURL(get.result.blob);
                            resolve(url);
                        } else {
                            resolve(null);
                        }
                    };
                    get.onerror = () => resolve(null);
                } catch (_) {
                    resolve(null);
                }
            };
            req.onupgradeneeded = (e) => {
                // DB doesn't exist yet — nothing cached
                e.target.transaction.abort();
                resolve(null);
            };
        } catch (_) {
            resolve(null);
        }
    });
}

/* =========================================================
   Avatar Manifest Loader
   ========================================================= */
async function loadAvatarManifest() {
    try {
        // Check for VRM Manager manifest override (includes downloaded VRM avatars)
        const override = localStorage.getItem('vrm_manager_manifest_override');
        let data;

        if (override) {
            try {
                data = JSON.parse(override);
                console.log('[Main] Using VRM Manager manifest override with', (data.items || []).length, 'avatars');
            } catch (_) {
                data = null;
            }
        }

        if (!data) {
            const res = await fetch(AVATAR_MANIFEST_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status} ${res.statusText}`);
            data = await res.json();
        }

        const basePath = (data && data.basePath) || '/vendor/avatars';
        const items = (data && data.items) || [];

        if (!Array.isArray(items)) throw new Error('Manifest format invalid: items must be an array');

        // Collect blob URLs from VRM Manager downloads
        const blobMap = JSON.parse(localStorage.getItem('vrm_manager_blob_urls') || '{}');

        avatarBasePath = basePath.replace(/\/$/, '');
        avatarItems = items
            .filter((x) => x && x.file)
            .map((x) => ({
                name: x.name || x.file,
                file: x.file,
                url: blobMap[x.file] || `${avatarBasePath}/${x.file}`,
                format: x.format || (x.file.endsWith('.vrm') ? 'vrm' : 'glb'),
            }));

        populateAvatarSelect(avatarItems);
        window.__AVATAR_ITEMS__ = avatarItems; // expose to module bridge

        // Check if VRM Manager directed us to load a specific avatar
        const useAvatar = localStorage.getItem('vrm_manager_use_avatar');
        if (useAvatar) {
            try {
                const selection = JSON.parse(useAvatar);
                localStorage.removeItem('vrm_manager_use_avatar');

                // Try to find in manifest items by file or name
                let idx = avatarItems.findIndex((x) => x.file === selection.file || x.name === selection.name);

                // If not found in manifest, add it dynamically (e.g. downloaded via VRM Manager)
                if (idx < 0 && selection.url) {
                    // For downloaded avatars, blob URLs expire on page reload.
                    // Try to restore from VRM Manager's IndexedDB cache.
                    let resolvedUrl = selection.url;
                    if (resolvedUrl.startsWith('blob:')) {
                        const fileKey = 'file:' + (selection.file || selection.id);
                        const cached = await loadBlobFromVRMCache(fileKey);
                        if (cached) resolvedUrl = cached;
                    }

                    avatarItems.push({
                        name: selection.name || selection.file || 'VRM Avatar',
                        file: selection.file || selection.id,
                        url: resolvedUrl,
                        format: selection.format || 'vrm',
                    });
                    idx = avatarItems.length - 1;
                    populateAvatarSelect(avatarItems);
                    window.__AVATAR_ITEMS__ = avatarItems;
                }

                if (idx >= 0) {
                    // For existing manifest items with stale blob URLs, try IndexedDB restore
                    const item = avatarItems[idx];
                    if (item.url && item.url.startsWith('blob:')) {
                        const fileKey = 'file:' + item.file;
                        const cached = await loadBlobFromVRMCache(fileKey);
                        if (cached) item.url = cached;
                    }

                    const select = $('avatar-select');
                    if (select) select.value = String(idx);
                    // Store the index so loadDefaultAvatarFromManifest loads it
                    window.__vrm_manager_avatar_idx = idx;
                    console.log('[Main] VRM Manager selected avatar:', selection.name, 'at index', idx);
                }
            } catch (e) {
                console.warn('[Main] VRM Manager avatar selection error:', e);
            }
        }

        return avatarItems;
    } catch (e) {
        logError('Avatar manifest load failed', e);
        showLoading('Failed to load avatar list (vendor/avatars/avatars.json missing?)');
        setStatus('idle', 'ERROR');
        populateAvatarSelect([]);
        return [];
    }
}

function populateAvatarSelect(items) {
    const select = $('avatar-select');
    if (!select) return;

    select.innerHTML = '';

    if (!items || items.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No avatars found (check avatars.json)';
        select.appendChild(opt);
        return;
    }

    items.forEach((it, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = it.name;
        select.appendChild(opt);
    });

    // Expose manifest to module engine (ViewerEngine)
    window.__AVATAR_ITEMS__ = avatarItems;
    window.__AVATAR_BASE_PATH__ = avatarBasePath;
}

/* =========================================================
   Avatar positioning helpers
   ========================================================= */
function placeAvatarOnFloor(avatarRoot, floorY = 0) {
    const box = new THREE.Box3().setFromObject(avatarRoot);
    const size = box.getSize(new THREE.Vector3());
    const minY = box.min.y;

    avatarRoot.position.y += floorY - minY;
    return { box, size };
}

/* =========================================================
   Camera framing
   ========================================================= */
function frameObjectToCamera(object, fitOffset = 1.35) {
    if (!object || !camera) return;

    const box = new THREE.Box3().setFromObject(object);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return;

    const center = box.getCenter(new THREE.Vector3());

    // Recenter model to origin
    object.position.sub(center);

    const box2 = new THREE.Box3().setFromObject(object);
    const size2 = box2.getSize(new THREE.Vector3());
    const center2 = box2.getCenter(new THREE.Vector3());

    const maxSize = Math.max(size2.x, size2.y, size2.z);
    const fitHeightDistance = maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)));
    const fitWidthDistance = fitHeightDistance / camera.aspect;
    const distance = fitOffset * Math.max(fitHeightDistance, fitWidthDistance);

    const direction = new THREE.Vector3(0, 0.5, 1).normalize();
    camera.position.copy(direction.multiplyScalar(distance));

    camera.near = Math.max(0.01, distance / 100);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();

    if (controls) {
        controls.target.copy(center2);
        controls.update();
    } else {
        camera.lookAt(center2);
    }

    if (floorMesh) {
        const worldBox = new THREE.Box3().setFromObject(object);
        const yMin = worldBox.min.y;
        floorMesh.position.y = yMin - 0.02;
    }

    lastFrameFitOffset = fitOffset;
}

function resetView() {
    if (!camera || !controls) return;
    camera.position.set(0, 1.5, 3);
    controls.target.set(0, 1, 0);
    controls.update();

    if (currentAvatar) frameObjectToCamera(currentAvatar, lastFrameFitOffset);
}

/* ============================
   Three.js Setup (GLOBAL)
   ============================ */
function setupThreeJS() {
    const viewport = $('avatar-viewport');
    if (!viewport) {
        showLoading('UI error: #avatar-viewport not found');
        throw new Error('#avatar-viewport not found');
    }

    const w = viewport.clientWidth || 640;
    const h = viewport.clientHeight || 480;

    scene = new THREE.Scene();
    scene.background = null;

    camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 1000);
    camera.position.set(0, 1.5, 3);

    let canvas = viewport.querySelector('canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        viewport.appendChild(canvas);
    }

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    scene.add(dirLight);

    const pointLight = new THREE.PointLight(0xffffff, 0.35, 100);
    pointLight.position.set(-5, 5, 5);
    scene.add(pointLight);

    floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 50),
        new THREE.MeshStandardMaterial({ color: 0x0b1f2b, roughness: 1, metalness: 0 })
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -1;
    floorMesh.receiveShadow = true;
    floorMesh.material.depthWrite = false;
    floorMesh.material.depthTest = true;
    floorMesh.renderOrder = 0;
    scene.add(floorMesh);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 0.5;
    controls.maxDistance = 25;
    controls.enablePan = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(0, 1, 0);

    clock = new THREE.Clock();

    window.addEventListener('resize', onWindowResize);

    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => onWindowResize());
        ro.observe(viewport);
    }

    animate();
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock ? clock.getDelta() : 0;
    if (mixer) mixer.update(delta);

    /* NEXUS_PATCH_LIFE_ENGINE_UPDATE_LOOP */
    try {
        // clock exists only in legacy ThreeJS path; guard it.
        const t = typeof clock !== 'undefined' && clock ? clock.getElapsedTime() : performance.now() * 0.001;
        window.NEXUS_PROCEDURAL_ANIMATOR?.update?.(t, delta);
    } catch (_) {}
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
}

function onWindowResize() {
    const viewport = $('avatar-viewport');
    if (!viewport || !camera || !renderer) return;

    const w = viewport.clientWidth || 640;
    const h = viewport.clientHeight || 480;

    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
}

/* ============================
   Disposal
   ============================ */
function disposeObject3D(obj) {
    if (!obj) return;
    obj.traverse((child) => {
        if (!child.isMesh) return;

        if (child.geometry && child.geometry.dispose) child.geometry.dispose();

        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((mat) => {
            if (!mat) return;
            for (const k in mat) {
                const v = mat[k];
                if (v && v.isTexture && v.dispose) v.dispose();
            }
            if (mat.dispose) mat.dispose();
        });
    });
}

/* ============================
   Avatar Loading
   ============================ */
function waitForViewerEngineReady(timeoutMs = 30000) {
    // If already ready, resolve immediately
    if (window.NEXUS_VIEWER && typeof window.NEXUS_VIEWER.loadAvatar === 'function') {
        console.log('[Main] ViewerEngine already ready');
        return Promise.resolve(true);
    }

    console.log('[Main] Waiting for ViewerEngine...', {
        hasReadyPromise: !!window.__NEXUS_VIEWER_READY__,
        hasNexusViewer: !!window.NEXUS_VIEWER,
    });

    // Hybrid: poll for NEXUS_VIEWER (handles any load path) with timeout
    const start = Date.now();
    return new Promise((resolve, reject) => {
        // Also listen to the ready promise if available
        if (window.__NEXUS_VIEWER_READY__) {
            window.__NEXUS_VIEWER_READY__.then(() => {
                console.log('[Main] ViewerEngine ready via promise');
                resolve(true);
            });
        }

        (function tick() {
            if (window.NEXUS_VIEWER && typeof window.NEXUS_VIEWER.loadAvatar === 'function') {
                console.log('[Main] ViewerEngine ready via polling after', Date.now() - start, 'ms');
                return resolve(true);
            }
            if (Date.now() - start > timeoutMs) {
                console.error('[Main] ViewerEngine not ready after', timeoutMs, 'ms', {
                    hasNexusViewer: !!window.NEXUS_VIEWER,
                    docReadyState: document.readyState,
                });
                return reject(new Error('ViewerEngine not ready (timeout)'));
            }
            setTimeout(tick, 100);
        })();
    });
}

function loadAvatar(url, source) {
    // ViewerEngine path
    if (window.__USE_GLTF_VIEWER_ENGINE__) {
        showLoading('Loading 3D Avatar...');
        setStatus('idle', 'LOADING...');
        startLoaderWatchdog(20000);

        (async () => {
            try {
                await waitForViewerEngineReady(15000);
                await window.NEXUS_VIEWER.loadAvatar(url);

                // Sync saved pose settings to the live viewport immediately.
                // Without this, localStorage settings only take effect on "Save".
                applyPoseSettingsLive();

                /* NEXUS_PATCH_LIFE_ENGINE_REGISTER_VIEWER */
                // Note: ProceduralAnimator registration now handled inside AvatarManager.setAvatarByUrl()
                // Auto-blink also starts automatically via AvatarManager._buildVRMLoaderBridge()
                console.log('[Main] Avatar loaded via ViewerEngine', {
                    root: !!window.NEXUS_VIEWER?.avatarManager?.currentRoot,
                    vrmLoader: !!window.NEXUS_VIEWER?.avatarManager?.vrmLoader,
                    clips: window.NEXUS_VIEWER?.avatarManager?.currentClips?.length || 0,
                    proceduralAnimator: !!window.NEXUS_PROCEDURAL_ANIMATOR,
                });
                stopLoaderWatchdog();
                hideLoading();
                setStatus('idle', 'READY');
                const hint = document.getElementById('viewport-hint');
                if (hint) hint.classList.add('hidden');
                console.log(`[Nexus] Avatar loaded (viewer-engine):`, url);
            } catch (e) {
                stopLoaderWatchdog();
                console.error('[Main] loadAvatar failed:', e.message, {
                    url,
                    source,
                    hasNexusViewer: !!window.NEXUS_VIEWER,
                    hasLoadAvatar: typeof window.NEXUS_VIEWER?.loadAvatar,
                    useGltfEngine: !!window.__USE_GLTF_VIEWER_ENGINE__,
                    hasReadyPromise: !!window.__NEXUS_VIEWER_READY__,
                    docReadyState: document.readyState,
                    containerExists: !!(
                        document.getElementById('avatar-viewport') || document.getElementById('avatar-container')
                    ),
                });
                const detail = e.message || String(e);
                showLoading(`Failed to load avatar: ${detail}`);
                setStatus('idle', 'ERROR');
            }
        })();

        return;
    }

    // Legacy path
    showLoading('Loading 3D Avatar...');
    setStatus('idle', 'LOADING...');
    startLoaderWatchdog(20000);

    if (!scene) {
        stopLoaderWatchdog();
        showLoading('Initialization failed: scene not ready');
        setStatus('idle', 'ERROR');
        return;
    }

    if (currentAvatar) {
        scene.remove(currentAvatar);
        disposeObject3D(currentAvatar);
        currentAvatar = null;
    }

    if (mixer) {
        mixer.stopAllAction();
        mixer = null;
    }
    animations = {};
    currentAnimationAction = null;

    if (currentObjectURL && currentObjectURL !== url) {
        URL.revokeObjectURL(currentObjectURL);
        currentObjectURL = null;
    }

    if (url && url.startsWith('blob:')) {
        currentObjectURL = url;
    }

    const loader = new GLTFLoader();

    loader.load(
        url,
        (gltf) => {
            stopLoaderWatchdog();

            currentAvatar = gltf.scene;
            scene.add(currentAvatar);

            /* NEXUS_PATCH_LIFE_ENGINE_REGISTER_LEGACY */
            try {
                window.NEXUS_PROCEDURAL_ANIMATOR?.registerAvatar?.(
                    currentAvatar,
                    Array.isArray(gltf.animations) && gltf.animations.length > 0
                );
                // Set natural standing pose (replaces T-pose) and default talk style
                window.NEXUS_PROCEDURAL_ANIMATOR?.setBasePose?.('lecturerNeutral');
                window.NEXUS_PROCEDURAL_ANIMATOR?.setTalkStyle?.('explainCalm');
            } catch (_) {}

            // Sync saved pose settings to the live viewport immediately.
            applyPoseSettingsLive();
            currentAvatar.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.renderOrder = 1;
                }
            });

            placeAvatarOnFloor(currentAvatar, 0);

            onWindowResize();
            frameObjectToCamera(currentAvatar, lastFrameFitOffset);

            if (Array.isArray(gltf.animations) && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(currentAvatar);
                gltf.animations.forEach((clip) => {
                    const key = (clip.name || 'clip').toLowerCase();
                    animations[key] = clip;
                });

                // Register clips in central AnimationManager
                try {
                    window.NEXUS_ANIMATION_MANAGER?.registerClips?.(gltf.animations);
                } catch (_) {}

                const idleKey = findIdleAnimation();
                if (idleKey) playAnimation(idleKey, true);
            }

            hideLoading();
            setStatus('idle', 'READY');

            const hint = $('viewport-hint');
            if (hint) safeClass(hint, 'add', 'hidden');

            console.log(`[Nexus] Avatar loaded (${source}):`, url);
            console.log('[Nexus] Animations:', Object.keys(animations));
        },
        (progress) => {
            const loaded = progress && typeof progress.loaded === 'number' ? progress.loaded : 0;
            const total = progress && typeof progress.total === 'number' ? progress.total : 0;

            if (total > 0) {
                const percent = Math.round((loaded / total) * 100);
                showLoading(`Loading 3D Avatar... ${percent}%`);
            } else {
                showLoading('Loading 3D Avatar...');
            }
        },
        (error) => {
            stopLoaderWatchdog();
            logError('Error loading avatar', error);
            showLoading('Failed to load avatar. Try another preset.');
            setStatus('idle', 'ERROR');
            showMessage('Failed to load avatar. Please try another one.', 'error');

            if (currentObjectURL && currentObjectURL.startsWith('blob:')) {
                URL.revokeObjectURL(currentObjectURL);
                currentObjectURL = null;
            }
        }
    );
}

function loadDefaultAvatarFromManifest() {
    if (!avatarItems || avatarItems.length === 0) {
        showLoading('No avatars found in manifest. Upload a .glb/.gltf to test.');
        setStatus('idle', 'READY');
        return;
    }

    // If VRM Manager selected a specific avatar, load that one
    const vmIdx = window.__vrm_manager_avatar_idx;
    if (vmIdx != null && avatarItems[vmIdx]) {
        delete window.__vrm_manager_avatar_idx;
        loadAvatar(avatarItems[vmIdx].url, 'vrm-manager');
        return;
    }

    // Restore previously chosen avatar from localStorage (persists across navigation)
    try {
        const savedFile = localStorage.getItem('nexus_selected_avatar_file');
        const savedIdx = parseInt(localStorage.getItem('nexus_selected_avatar_idx') || '', 10);
        if (savedFile) {
            // Match by filename first (more reliable across manifest changes)
            const fileIdx = avatarItems.findIndex((x) => x.file === savedFile);
            if (fileIdx >= 0) {
                const select = $('avatar-select');
                if (select) select.value = String(fileIdx);
                loadAvatar(avatarItems[fileIdx].url, 'manifest(persisted)');
                console.log('[Main] Restored persisted avatar:', avatarItems[fileIdx].name, 'at index', fileIdx);
                return;
            }
        }
        if (Number.isFinite(savedIdx) && avatarItems[savedIdx]) {
            const select = $('avatar-select');
            if (select) select.value = String(savedIdx);
            loadAvatar(avatarItems[savedIdx].url, 'manifest(persisted)');
            console.log('[Main] Restored persisted avatar by index:', savedIdx);
            return;
        }
    } catch (_) {}

    loadAvatar(avatarItems[0].url, 'manifest(default)');
}

/* ============================
   Animation Control
   ============================ */
function findIdleAnimation() {
    const keys = Object.keys(animations);
    return keys.find((k) => k.includes('idle')) || keys[0] || null;
}

function playAnimation(name, loop) {
    if (
        window.__USE_GLTF_VIEWER_ENGINE__ &&
        window.NEXUS_VIEWER &&
        typeof window.NEXUS_VIEWER.playAnimationByName === 'function'
    ) {
        window.NEXUS_VIEWER.playAnimationByName(name);
        return;
    }

    const key = (name || '').toLowerCase();
    if (!mixer || !animations[key]) {
        logWarn(`Animation "${key}" not found; falling back to idle/first.`);
        const fallback = findIdleAnimation();
        if (!fallback || !mixer || !animations[fallback]) return;
        name = fallback;
    } else {
        name = key;
    }

    if (currentAnimationAction) currentAnimationAction.fadeOut(0.2);

    const clip = animations[name];
    const action = mixer.clipAction(clip);

    action.reset();
    action.fadeIn(0.2);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce);
    action.clampWhenFinished = true;
    action.play();

    currentAnimationAction = action;

    if (!loop) {
        setTimeout(
            () => {
                const idleKey = findIdleAnimation();
                if (idleKey) playAnimation(idleKey, true);
            },
            Math.max(0, (clip.duration - 0.2) * 1000)
        );
    }
}

/* =========================================================
   Speech Settings UI & Logic
   ========================================================= */

// Heuristic to guess gender from voice name
function guessGender(voice) {
    const s = `${voice.name} ${voice.voiceURI}`.toLowerCase();
    // Common patterns across OS/browsers (not perfect, but helpful)
    if (/(female|woman|zira|susan|samantha|victoria|tessa|karen|serena|monica|lucia|alice|emma|olivia)/i.test(s))
        return 'female';
    if (/(male|man|david|mark|daniel|george|alex|fred|tom|diego|luca|paul|joel)/i.test(s)) return 'male';
    return 'unknown';
}

function pickBestVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    if (!voices.length) return null;

    const targetLang = (SpeechSettings.lang || 'en-US').toLowerCase();
    const base = targetLang.split('-')[0];
    const pref = (SpeechSettings.voicePref || 'any').toLowerCase();

    // 1) exact voiceURI preference
    if (SpeechSettings.voiceURI) {
        const exact = voices.find((v) => v.voiceURI === SpeechSettings.voiceURI);
        if (exact) return exact;
    }

    // 2) Exact language match
    let candidates = voices.filter((v) => (v.lang || '').toLowerCase() === targetLang);
    if (!candidates.length) {
        // 3) Base language match
        candidates = voices.filter((v) => (v.lang || '').toLowerCase().startsWith(base));
    }
    // Fallback: all voices if no lang match (rare, but possible)
    if (!candidates.length) candidates = voices;

    // 4) Apply Gender Preference
    if (pref === 'female' || pref === 'male') {
        const preferred = candidates.filter((v) => guessGender(v) === pref);
        if (preferred.length) return preferred[0];
    }

    // 5) Default best match
    return candidates[0] || null;
}

function refreshVoiceList() {
    const voiceEl = document.getElementById('speech-voice');
    if (!voiceEl || !('speechSynthesis' in window)) return;

    const voices = window.speechSynthesis.getVoices() || [];
    const lang = (SpeechSettings.lang || 'en-US').toLowerCase();
    const base = lang.split('-')[0];
    const genderPref = (SpeechSettings.voicePref || 'any').toLowerCase();

    // Filter by language base to keep list relevant
    let filtered = voices.filter((v) => (v.lang || '').toLowerCase().startsWith(base));
    const list = filtered.length ? filtered : voices;

    // ✅ Filter by gender preference
    let genderFiltered = list;
    if (genderPref === 'female' || genderPref === 'male') {
        const byGender = list.filter((v) => guessGender(v) === genderPref);
        if (byGender.length) {
            genderFiltered = byGender;
        }
    }

    voiceEl.innerHTML = `<option value="">Auto (best match)</option>`;
    for (const v of genderFiltered) {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        const gender = guessGender(v);
        const genderLabel = gender !== 'unknown' ? ` [${gender}]` : '';
        opt.textContent = `${v.name}${genderLabel} — ${v.lang}`;
        voiceEl.appendChild(opt);
    }

    // restore selection
    voiceEl.value = SpeechSettings.voiceURI || '';
}

function saveSpeechSettingsFromUI() {
    const langEl = document.getElementById('speech-lang');
    const voiceEl = document.getElementById('speech-voice');
    const prefEl = document.getElementById('speech-voice-pref');
    const rateEl = document.getElementById('speech-rate');
    const pitchEl = document.getElementById('speech-pitch');

    if (langEl) {
        SpeechSettings.lang = langEl.value || 'en-US';
        localStorage.setItem('speech_lang', SpeechSettings.lang);
    }
    if (voiceEl) {
        SpeechSettings.voiceURI = voiceEl.value || '';
        localStorage.setItem('speech_voice_uri', SpeechSettings.voiceURI);
    }
    if (prefEl) {
        SpeechSettings.voicePref = prefEl.value || 'any';
        localStorage.setItem('speech_voice_pref', SpeechSettings.voicePref);
    }
    if (rateEl) {
        const v = parseFloat(rateEl.value || '0.9');
        SpeechSettings.rate = Number.isFinite(v) ? v : 0.9;
        localStorage.setItem('speech_rate', String(SpeechSettings.rate));
    }
    if (pitchEl) {
        const v = parseFloat(pitchEl.value || '1.0');
        SpeechSettings.pitch = Number.isFinite(v) ? v : 1.0;
        localStorage.setItem('speech_pitch', String(SpeechSettings.pitch));
    }

    // Apply to recognition immediately if running
    if (recognition) recognition.lang = SpeechSettings.lang;

    // Also save to unified nexus_settings_v1 for VR compatibility
    if (window.SpeechService) {
        // Resolve the selected voice object so we can store BOTH name and URI
        const voices = window.speechSynthesis?.getVoices?.() || [];
        const selectedVoiceObj = SpeechSettings.voiceURI
            ? voices.find((v) => v.voiceURI === SpeechSettings.voiceURI)
            : null;

        window.SpeechService.saveTTSConfig({
            // ✅ Store NAME here (what legacy VR logic expects)
            speechVoice: selectedVoiceObj?.name || '',

            // ✅ Store URI explicitly (best identifier)
            speechVoiceURI: SpeechSettings.voiceURI || '',

            // ✅ Store voice preference (gender filter)
            speechVoicePref: SpeechSettings.voicePref || 'any',

            speechRate: SpeechSettings.rate,
            speechPitch: SpeechSettings.pitch,
            speechVolume: 1.0, // Default volume (not exposed in UI yet)
            speechLang: SpeechSettings.lang,
            ttsEnabled: true, // Default enabled (not exposed in UI yet)
        });
    }
}

function loadSpeechSettingsIntoUI() {
    const langEl = document.getElementById('speech-lang');
    const voiceEl = document.getElementById('speech-voice');
    const prefEl = document.getElementById('speech-voice-pref');
    const rateEl = document.getElementById('speech-rate');
    const pitchEl = document.getElementById('speech-pitch');

    if (langEl) langEl.value = SpeechSettings.lang;
    if (prefEl) prefEl.value = SpeechSettings.voicePref || 'any';
    if (rateEl) rateEl.value = String(SpeechSettings.rate);
    if (pitchEl) pitchEl.value = String(SpeechSettings.pitch);

    if (voiceEl) voiceEl.value = SpeechSettings.voiceURI || '';
}

/* ============================
   STT Settings Helpers
   ============================ */
function loadSTTSettingsIntoUI() {
    if (!window.SpeechService) return;

    const sttConfig = window.SpeechService.getSTTConfig();

    const sttProvider = $('stt-provider');
    const wasmModelSize = $('wasm-model-size');
    const openaiWhisperModel = $('openai-whisper-model');
    const openaiSTTKey = $('openai-stt-key');
    const googleSTTKey = $('google-stt-key');
    const googleSTTModel = $('google-stt-model');
    const sttLanguage = $('stt-language');
    const sttInterimResults = $('stt-interim-results');
    const sttMicrophone = $('stt-microphone');

    if (sttProvider) sttProvider.value = sttConfig.provider;
    if (wasmModelSize) wasmModelSize.value = sttConfig.wasm.modelSize;
    if (openaiWhisperModel) openaiWhisperModel.value = sttConfig.openai.model;
    if (openaiSTTKey) openaiSTTKey.value = sttConfig.openai.apiKey;
    if (googleSTTKey) googleSTTKey.value = sttConfig.google.apiKey;
    if (googleSTTModel) googleSTTModel.value = sttConfig.google.model;
    if (sttLanguage) sttLanguage.value = sttConfig.language;
    if (sttInterimResults) sttInterimResults.checked = sttConfig.interimResults;
    if (sttMicrophone && sttConfig.microphoneDeviceId) sttMicrophone.value = sttConfig.microphoneDeviceId;

    // Auto-send setting
    const sttAutoSend = $('stt-auto-send');
    if (sttAutoSend) {
        sttAutoSend.checked = SpeechSettings.autoSend;
        sttAutoSend.addEventListener('change', () => {
            SpeechSettings.autoSend = sttAutoSend.checked;
            localStorage.setItem('stt_auto_send', sttAutoSend.checked ? 'true' : 'false');
            console.log('[Main] Auto-send', sttAutoSend.checked ? 'enabled' : 'disabled');
        });
    }

    // Update provider-specific UI
    updateSTTProviderUI(sttConfig.provider);
}

function saveSTTSettingsFromUI() {
    if (!window.SpeechService) return;

    const sttProvider = $('stt-provider');
    const wasmModelSize = $('wasm-model-size');
    const openaiWhisperModel = $('openai-whisper-model');
    const openaiSTTKey = $('openai-stt-key');
    const googleSTTKey = $('google-stt-key');
    const googleSTTModel = $('google-stt-model');
    const sttLanguage = $('stt-language');
    const sttInterimResults = $('stt-interim-results');
    const sttMicrophone = $('stt-microphone');

    window.SpeechService.saveSTTConfig({
        provider: sttProvider ? sttProvider.value : 'webspeech',
        language: sttLanguage ? sttLanguage.value : 'en-US',
        interimResults: sttInterimResults ? sttInterimResults.checked : true,
        microphoneDeviceId: sttMicrophone ? sttMicrophone.value : '',
        wasm: {
            modelSize: wasmModelSize ? wasmModelSize.value : 'base',
        },
        openai: {
            apiKey: openaiSTTKey ? openaiSTTKey.value.trim() : '',
            model: openaiWhisperModel ? openaiWhisperModel.value : 'whisper-1',
        },
        google: {
            apiKey: googleSTTKey ? googleSTTKey.value.trim() : '',
            model: googleSTTModel ? googleSTTModel.value : 'default',
        },
    });

    // Update recognition options
    window.SpeechService.setRecognitionOptions({
        lang: sttLanguage ? sttLanguage.value : 'en-US',
        interimResults: sttInterimResults ? sttInterimResults.checked : true,
    });
}

function updateSTTProviderUI(provider) {
    const wasmSTTSettings = $('wasm-stt-settings');
    const openaiSTTSettings = $('openai-stt-settings');
    const googleSTTSettings = $('google-stt-settings');

    // Hide all provider-specific settings
    if (wasmSTTSettings) wasmSTTSettings.style.display = 'none';
    if (openaiSTTSettings) openaiSTTSettings.style.display = 'none';
    if (googleSTTSettings) googleSTTSettings.style.display = 'none';

    // Show relevant provider settings
    switch (provider) {
        case 'wasm':
            if (wasmSTTSettings) wasmSTTSettings.style.display = 'block';
            break;
        case 'openai':
            if (openaiSTTSettings) openaiSTTSettings.style.display = 'block';
            break;
        case 'google':
            if (googleSTTSettings) googleSTTSettings.style.display = 'block';
            break;
    }
}

async function testSTT() {
    if (!window.SpeechService) {
        showMessage('Speech service not available', 'error');
        return;
    }

    const statusElement = $('test-stt-status');

    try {
        if (statusElement) {
            statusElement.textContent = 'Starting STT test...';
            statusElement.style.color = '#3b82f6';
        }

        // Start STT with test callbacks
        const started = await window.SpeechService.startSTT({
            onStart: () => {
                if (statusElement) {
                    statusElement.textContent = '🎤 Listening... (speak now)';
                    statusElement.style.color = '#10b981';
                }
            },
            onInterim: (interimText) => {
                if (statusElement) {
                    statusElement.textContent = `📝 Interim: "${interimText}"`;
                    statusElement.style.color = '#f59e0b';
                }
            },
            onResult: (transcript, confidence) => {
                const confidencePercent = Math.round(confidence * 100);
                if (statusElement) {
                    statusElement.textContent = `✅ Transcribed: "${transcript}" (${confidencePercent}% confidence)`;
                    statusElement.style.color = '#10b981';
                }
                console.log('[STT Test] Result:', transcript);

                // Show success message
                setTimeout(() => {
                    if (statusElement) {
                        statusElement.textContent = 'Test completed successfully!';
                    }
                }, 2000);
            },
            onError: (error, context) => {
                const errorMsg = context ? `${error}: ${context}` : error;
                if (statusElement) {
                    statusElement.textContent = `❌ Error: ${errorMsg}`;
                    statusElement.style.color = '#ef4444';
                }
                console.error('[STT Test] Error:', error, context);
            },
            onEnd: () => {
                console.log('[STT Test] Recognition ended');
            },
        });

        if (!started) {
            throw new Error('Failed to start STT');
        }

        // Auto-stop after 10 seconds
        setTimeout(() => {
            if (window.SpeechService.isRecognizing) {
                window.SpeechService.stopSTT();
                if (statusElement) {
                    statusElement.textContent = 'Test timeout (10s limit)';
                    statusElement.style.color = '#f59e0b';
                }
            }
        }, 10000);
    } catch (error) {
        console.error('[STT Test] Failed:', error);
        if (statusElement) {
            statusElement.textContent = `❌ Failed: ${error.message}`;
            statusElement.style.color = '#ef4444';
        }
    }
}

/**
 * Load available microphones into the selector
 */
async function loadAvailableMicrophones() {
    const microphoneSelect = $('stt-microphone');
    if (!microphoneSelect) return;

    try {
        console.log('[Main] Loading available microphones...');

        // Request microphone permission first (required for device labels)
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
            // Stop the stream immediately, we just needed permission
            stream.getTracks().forEach((track) => track.stop());
        });

        // Enumerate devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter((device) => device.kind === 'audioinput');

        console.log(`[Main] Found ${audioInputs.length} microphones`);

        // Clear existing options (except default)
        microphoneSelect.innerHTML = '<option value="">Default (System Default)</option>';

        // Add microphone options
        audioInputs.forEach((device, index) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Microphone ${index + 1}`;
            microphoneSelect.appendChild(option);
        });

        // Load selected microphone from config
        if (window.SpeechService) {
            const sttConfig = window.SpeechService.getSTTConfig();
            if (sttConfig.microphoneDeviceId) {
                microphoneSelect.value = sttConfig.microphoneDeviceId;
            }
        }

        console.log('[Main] Microphones loaded successfully');
    } catch (error) {
        console.error('[Main] Failed to load microphones:', error);
        // If permission denied, show a helpful message
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Permission denied - click to allow microphone access';
        microphoneSelect.innerHTML = '';
        microphoneSelect.appendChild(option);
    }
}

/* ============================
   UI / Events
   ============================ */
function setEmotionPressed(btn) {
    document.querySelectorAll('.emotion-btn').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    if (btn) btn.setAttribute('aria-pressed', 'true');
}

function setupEventListeners() {
    // Clear chat input on load (prevents browser autocomplete filling stale text)
    const chatInput = $('speech-text');
    if (chatInput) chatInput.value = '';

    const avatarSelect = $('avatar-select');
    if (avatarSelect) {
        avatarSelect.addEventListener('change', (e) => {
            const idx = parseInt(e.target.value, 10);
            if (!Number.isFinite(idx)) return;
            if (!avatarItems[idx]) return;
            // Persist chosen avatar so it survives navigation to settings/manager
            try {
                localStorage.setItem('nexus_selected_avatar_idx', String(idx));
                localStorage.setItem('nexus_selected_avatar_file', avatarItems[idx].file || '');
            } catch (_) {}
            loadAvatar(avatarItems[idx].url, 'manifest');
        });
    }

    const avatarUpload = $('avatar-upload');
    if (avatarUpload) {
        avatarUpload.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const fileName = file.name.toLowerCase();
            const ext = fileName.split('.').pop();

            if (ext !== 'glb' && ext !== 'gltf' && ext !== 'vrm') {
                showMessage('Please upload a .glb, .gltf, or .vrm file', 'error');
                e.target.value = '';
                return;
            }

            if (ext === 'gltf') {
                showMessage(
                    'Warning: .gltf files with external assets may not load correctly. .glb is recommended.',
                    'warning'
                );
            }

            if (ext === 'vrm') {
                console.log('[Main] VRM file detected — loading via VRMLoader path');
            }

            const blobURL = URL.createObjectURL(file);
            loadAvatar(blobURL, 'upload');
        });
    }

    const speechText = $('speech-text');
    const speakBtn = $('speak-btn');
    if (speakBtn && speechText) {
        speakBtn.addEventListener('click', () => {
            const text = speechText.value.trim();
            if (!text) return;
            handleUserMessage(text);
            speechText.value = '';
        });

        speechText.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const text = speechText.value.trim();
                if (!text) return;
                handleUserMessage(text);
                speechText.value = '';
            }
        });
    }

    const listenBtn = $('listen-btn');
    if (listenBtn) listenBtn.addEventListener('click', toggleVoiceInput);

    document.querySelectorAll('.emotion-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const emotion = (btn.dataset.emotion || '').toLowerCase();

            /* Route through AnimationManager for proper durations */
            if (window.NEXUS_ANIMATION_MANAGER?.applyEmotion) {
                window.NEXUS_ANIMATION_MANAGER.applyEmotion(emotion);
            } else {
                try {
                    window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.(emotion, 5000);
                } catch (_) {}
            }
            const mapped = Object.keys(animations).find((k) => k.includes(emotion)) || findIdleAnimation();
            if (mapped) playAnimation(mapped, false);

            const emotionActive = $('emotion-active');
            if (emotionActive) emotionActive.textContent = emotion.toUpperCase();

            setEmotionPressed(btn);
            setStatus('idle', `FEELING ${emotion.toUpperCase()}`);
            setTimeout(() => setStatus('idle', 'READY'), 1500);
        });
    });

    // Emotion dropdown menu items in avatar footer
    document.querySelectorAll('.emotion-menu-item').forEach((btn) => {
        btn.addEventListener('click', () => {
            const emotion = (btn.dataset.emotion || '').toLowerCase();
            /* Route through AnimationManager for proper durations */
            if (window.NEXUS_ANIMATION_MANAGER?.applyEmotion) {
                window.NEXUS_ANIMATION_MANAGER.applyEmotion(emotion);
            } else {
                try {
                    window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.(emotion, 5000);
                } catch (_) {}
            }
            const mapped = Object.keys(animations).find((k) => k.includes(emotion)) || findIdleAnimation();
            if (mapped) playAnimation(mapped, false);
            if (window.setEmotionIcon) window.setEmotionIcon(emotion);
            setStatus('idle', `FEELING ${emotion.toUpperCase()}`);
            setTimeout(() => setStatus('idle', 'READY'), 1500);
        });
    });

    const clearBtn = $('clear-history');
    if (clearBtn) clearBtn.addEventListener('click', clearHistory);

    const settingsBtn = $('settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', openSettings);

    const infoBtn = $('info-btn');
    if (infoBtn) infoBtn.addEventListener('click', openInfo);

    const resetBtn = $('reset-view-btn');
    if (resetBtn) resetBtn.addEventListener('click', () => resetView());

    const frameBtn = $('frame-avatar-btn');
    if (frameBtn)
        frameBtn.addEventListener(
            'click',
            () => currentAvatar && frameObjectToCamera(currentAvatar, lastFrameFitOffset)
        );

    const readyBtn = $('ready-btn');
    if (readyBtn) {
        readyBtn.addEventListener('click', () => {
            setStatus('idle', 'READY');
            showMessage('Session started.', 'success');
        });
    }

    // --- SPEECH SETTINGS UI WIRING ---
    const langEl = document.getElementById('speech-lang');
    if (langEl) {
        langEl.addEventListener('change', () => {
            SpeechSettings.lang = langEl.value || 'en-US';
            localStorage.setItem('speech_lang', SpeechSettings.lang);

            // Changing language implies resetting voice specific URI to Auto (so we don't keep an English voice for Italian text)
            SpeechSettings.voiceURI = '';
            localStorage.setItem('speech_voice_uri', '');

            if (recognition) recognition.lang = SpeechSettings.lang;

            refreshVoiceList();
            loadSpeechSettingsIntoUI();
        });
    }

    const prefEl = document.getElementById('speech-voice-pref');
    if (prefEl) {
        prefEl.addEventListener('change', () => {
            SpeechSettings.voicePref = prefEl.value || 'any';
            localStorage.setItem('speech_voice_pref', SpeechSettings.voicePref);

            // ✅ Refresh voice list to show only matching gender
            refreshVoiceList();
        });
    }

    const voiceEl = document.getElementById('speech-voice');
    if (voiceEl) {
        voiceEl.addEventListener('change', (e) => {
            SpeechSettings.voiceURI = e.target.value || '';
            localStorage.setItem('speech_voice_uri', SpeechSettings.voiceURI);
        });
    }

    document.getElementById('speech-rate')?.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value || '0.9');
        SpeechSettings.rate = Number.isFinite(v) ? v : 0.9;
        localStorage.setItem('speech_rate', String(SpeechSettings.rate));
    });

    document.getElementById('speech-pitch')?.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value || '1.0');
        SpeechSettings.pitch = Number.isFinite(v) ? v : 1.0;
        localStorage.setItem('speech_pitch', String(SpeechSettings.pitch));
    });

    // TEST VOICE BUTTON
    document.getElementById('test-tts')?.addEventListener('click', () => {
        const sampleByLang = {
            'en-US': 'Hello! This is Nexus. Your voice settings are working.',
            'en-GB': 'Hello! This is Nexus. Voice test complete.',
            'it-IT': 'Ciao! Sono Nexus. Le impostazioni della voce funzionano.',
            'es-ES': '¡Hola! Soy Nexus. La configuración de voz funciona.',
            'fr-FR': 'Bonjour ! Je suis Nexus. Les paramètres de voix fonctionnent.',
            'de-DE': 'Hallo! Ich bin Nexus. Deine Spracheinstellungen funktionieren.',
            'pt-BR': 'Olá! Eu sou Nexus. O teste de voz funcionou.',
            'ja-JP': 'こんにちは、Nexusです。音声テストは成功しました。',
            'ko-KR': '안녕하세요, 넥서스입니다. 음성 설정이 작동 중입니다.',
        };
        const sample = sampleByLang[SpeechSettings.lang] || 'Voice test successful.';
        speakText(sample);
    });

    // --- STT SETTINGS UI WIRING ---
    const sttProvider = document.getElementById('stt-provider');
    if (sttProvider) {
        sttProvider.addEventListener('change', (e) => {
            updateSTTProviderUI(e.target.value);
        });
    }

    const testSTTBtn = document.getElementById('test-stt');
    if (testSTTBtn) {
        testSTTBtn.addEventListener('click', () => {
            testSTT();
        });
    }

    const refreshMicrophonesBtn = document.getElementById('refresh-microphones');
    if (refreshMicrophonesBtn) {
        refreshMicrophonesBtn.addEventListener('click', () => {
            loadAvailableMicrophones();
        });
    }

    // Load microphones on page load
    loadAvailableMicrophones();
}

/* ============================
   Modals
   ============================ */
function setupModals() {
    const settingsModal = $('settings-modal');
    const infoModal = $('info-modal');

    const closeSettings = $('close-settings');
    const closeInfo = $('close-info');
    const cancelSettings = $('cancel-settings');
    const saveSettingsBtn = $('save-settings');

    function hideModal(modal) {
        if (!modal) return;
        modal.classList.remove('active');
        modal.hidden = true;
    }

    if (closeSettings && settingsModal) closeSettings.addEventListener('click', () => hideModal(settingsModal));
    if (cancelSettings && settingsModal) cancelSettings.addEventListener('click', () => hideModal(settingsModal));
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);

    if (closeInfo && infoModal) closeInfo.addEventListener('click', () => hideModal(infoModal));

    document.querySelectorAll('input[name="provider"]').forEach((radio) => {
        radio.addEventListener('change', updateProviderFields);
    });

    // Live preview: change desktop background immediately when radio is selected
    document.querySelectorAll('input[name="desktop-bg"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            window.NEXUS_VIEWER?.setDesktopBackground(radio.value);
        });
    });

    // Live preview: toggle shadows immediately when radio is selected
    document.querySelectorAll('input[name="desktop-shadow"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            window.NEXUS_VIEWER?.setShadows(radio.value === 'on');
        });
    });

    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) hideModal(settingsModal);
        });
    }
    if (infoModal) {
        infoModal.addEventListener('click', (e) => {
            if (e.target === infoModal) hideModal(infoModal);
        });
    }
}

// =========================================================================
// Pose Normalizer Settings UI
// =========================================================================
function setupPoseNormalizerUI() {
    const pn = window.NEXUS_POSE_NORMALIZER;
    if (!pn) return;

    const s = pn.getSettings();

    // Global intensity slider
    const intensitySlider = document.getElementById('pose-intensity');
    const intensityVal = document.getElementById('pose-intensity-val');
    if (intensitySlider) {
        intensitySlider.value = s.intensity;
        if (intensityVal) intensityVal.textContent = s.intensity.toFixed(2);
        intensitySlider.addEventListener('input', () => {
            const v = parseFloat(intensitySlider.value);
            if (intensityVal) intensityVal.textContent = v.toFixed(2);
        });
    }

    // Preset selector
    const presetSelect = document.getElementById('pose-preset');
    if (presetSelect) presetSelect.value = s.preset || 'relaxedStanding';

    // Per-bone sliders
    document.querySelectorAll('.pose-bone-slider').forEach((slider) => {
        const bone = slider.dataset.bone;
        if (bone && s.bones[bone] != null) {
            slider.value = s.bones[bone];
        }
        const valSpan = document.getElementById('pose-bone-' + bone + '-val');
        if (valSpan) valSpan.textContent = parseFloat(slider.value).toFixed(2);
        slider.addEventListener('input', () => {
            if (valSpan) valSpan.textContent = parseFloat(slider.value).toFixed(2);
        });
    });

    // Apply Live button
    const applyBtn = document.getElementById('pose-apply-btn');
    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            applyPoseSettingsLive();
        });
    }

    // Reset Defaults button
    const resetBtn = document.getElementById('pose-reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            const defaults = pn.resetSettings();
            // Update UI to defaults
            if (intensitySlider) {
                intensitySlider.value = defaults.intensity;
                if (intensityVal) intensityVal.textContent = defaults.intensity.toFixed(2);
            }
            if (presetSelect) presetSelect.value = defaults.preset;
            document.querySelectorAll('.pose-bone-slider').forEach((sl) => {
                const bone = sl.dataset.bone;
                if (bone && defaults.bones[bone] != null) {
                    sl.value = defaults.bones[bone];
                    const vs = document.getElementById('pose-bone-' + bone + '-val');
                    if (vs) vs.textContent = defaults.bones[bone].toFixed(2);
                }
            });
            applyPoseSettingsLive();
        });
    }

    // VR Pose Preset dropdown — uses VRPoseSystem (same as VR chat panel)
    const vrPoseSelect = document.getElementById('vr-pose-preset');
    if (vrPoseSelect) {
        vrPoseSelect.addEventListener('change', () => {
            const vps = window.vrPoseSystem;
            if (vps && vps.enabled) {
                vps.applyPreset(vrPoseSelect.value, 0.6);
                console.log(`[Desktop] VR pose preset → ${vrPoseSelect.value}`);
            } else {
                console.warn('[Desktop] VRPoseSystem not available — load an avatar first');
            }
        });

        // Listen for VR-side pose changes to sync dropdown back
        window.addEventListener('vr-pose-changed', (e) => {
            if (e.detail && e.detail.preset) {
                vrPoseSelect.value = e.detail.preset;
            }
        });
    }
}

function collectPoseSettingsFromUI() {
    const patch = { bones: {} };
    const intensitySlider = document.getElementById('pose-intensity');
    if (intensitySlider) patch.intensity = parseFloat(intensitySlider.value);

    const presetSelect = document.getElementById('pose-preset');
    if (presetSelect) patch.preset = presetSelect.value;

    document.querySelectorAll('.pose-bone-slider').forEach((slider) => {
        const bone = slider.dataset.bone;
        if (bone) patch.bones[bone] = parseFloat(slider.value);
    });
    return patch;
}

function applyPoseSettingsLive() {
    const pn = window.NEXUS_POSE_NORMALIZER;
    if (!pn) return;

    const patch = collectPoseSettingsFromUI();
    pn.updateSettings(patch);

    // Re-apply pose to current avatar if loaded
    const vrm = window.vrmLoader?.currentVRM || window.NEXUS_VIEWER?.getCurrentVRM?.();
    if (vrm) {
        const root = vrm.scene || vrm;
        const np = window.NEXUS_NATURAL_POSE;
        const humanoid = vrm.humanoid || root.userData?.vrmHumanoid || null;

        // ── VRM path: use NaturalPosePlugin (industry-standard normalized bones)
        // This matches how VRoid Hub displays models in natural poses.
        if (np && humanoid && typeof humanoid.getNormalizedBoneNode === 'function') {
            np.reset();
            np.setPreset(patch.preset || 'relaxedStanding');
            np.apply(root, { humanoid, preset: patch.preset });
        } else {
            // ── GLB fallback: world-space alignment via PoseNormalizer
            pn.restoreNeutralPose(root);
            pn.normalizeAvatarPose(root, {
                rig: humanoid,
            });
        }

        // Re-capture rest pose for ProceduralAnimator
        if (window.NEXUS_PROCEDURAL_ANIMATOR) {
            window.NEXUS_PROCEDURAL_ANIMATOR.registerAvatar(root, false);
        }
    }
}

function loadPoseSettingsIntoUI() {
    const pn = window.NEXUS_POSE_NORMALIZER;
    if (!pn) return;

    const s = pn.getSettings();
    const intensitySlider = document.getElementById('pose-intensity');
    const intensityVal = document.getElementById('pose-intensity-val');
    if (intensitySlider) {
        intensitySlider.value = s.intensity;
        if (intensityVal) intensityVal.textContent = s.intensity.toFixed(2);
    }

    const presetSelect = document.getElementById('pose-preset');
    if (presetSelect) presetSelect.value = s.preset || 'relaxedStanding';

    document.querySelectorAll('.pose-bone-slider').forEach((slider) => {
        const bone = slider.dataset.bone;
        if (bone && s.bones[bone] != null) {
            slider.value = s.bones[bone];
            const valSpan = document.getElementById('pose-bone-' + bone + '-val');
            if (valSpan) valSpan.textContent = s.bones[bone].toFixed(2);
        }
    });
}

function openSettings() {
    const modal = $('settings-modal');
    if (!modal) return;

    // Load config + speech settings into UI whenever settings opens
    loadConfigIntoUI();
    loadSpeechSettingsIntoUI();

    // Pre-select saved desktop background
    const savedBg = localStorage.getItem('desktop_bg') || 'black';
    const bgRadio = document.querySelector(`input[name="desktop-bg"][value="${savedBg}"]`);
    if (bgRadio) bgRadio.checked = true;

    // Pre-select saved shadow setting
    const savedShadow = localStorage.getItem('desktop_shadow') || 'off';
    const shadowRadio = document.querySelector(`input[name="desktop-shadow"][value="${savedShadow}"]`);
    if (shadowRadio) shadowRadio.checked = true;

    loadSTTSettingsIntoUI();
    refreshVoiceList();

    // Load pose normalizer settings into UI
    loadPoseSettingsIntoUI();

    // Auto-refresh model list if stale (e.g. persona was unpublished)
    if (window._nexusLLM && window._nexusLLM.modelsStale) {
        const fetchBtn = document.getElementById('fetch-models-btn');
        if (fetchBtn) setTimeout(() => fetchBtn.click(), 300);
    }

    modal.classList.add('active');
    modal.hidden = false;
}

function openInfo() {
    const modal = $('info-modal');
    if (!modal) return;
    modal.classList.add('active');
    modal.hidden = false;
}

/* ============================
   Provider UI + Storage
   ============================ */

/**
 * Fetch available models from LLMManager and populate dropdown
 * @param {string} provider - Provider name (openai, claude, etc.)
 * @param {HTMLSelectElement} selectElement - The select element to populate
 */
async function fetchAndPopulateModels(provider, selectElement) {
    if (!selectElement) {
        console.warn('[Main] Cannot fetch models: missing selectElement');
        return;
    }

    // Ensure LLMManager instance exists
    if (!window._nexusLLM) {
        if (typeof window.LLMManager !== 'function') {
            console.error('[Main] LLMManager not loaded');
            selectElement.innerHTML = '<option value="">LLMManager not loaded</option>';
            return;
        }
        console.log('[Main] Creating LLMManager instance for model fetching');
        window._nexusLLM = new window.LLMManager();
    }

    // Add loading option
    selectElement.innerHTML = '<option value="">Loading models...</option>';

    try {
        // Temporarily update provider to fetch models for selected provider
        // (User may have selected different provider but not saved yet)
        const currentSettings = window._nexusLLM.getSettings();
        const originalProvider = currentSettings.provider;

        if (provider !== originalProvider) {
            console.log(
                `[Main] Temporarily switching provider from ${originalProvider} to ${provider} for model fetch`
            );
            window._nexusLLM.updateSettings({ provider: provider });
        }

        const result = await window._nexusLLM.fetchAvailableModels();

        // Restore original provider if we changed it
        if (provider !== originalProvider) {
            window._nexusLLM.updateSettings({ provider: originalProvider });
        }

        if (result.error) {
            console.warn(`[Main] Model fetch warning: ${result.error}`);

            // Show error prominently if it's an authentication issue
            if (
                result.error.includes('401') ||
                result.error.includes('Authentication') ||
                result.error.includes('invalid')
            ) {
                alert(
                    `⚠️ ${provider.toUpperCase()} Authentication Error\n\n${result.error}\n\nPlease check your API key in Settings and try again.`
                );
            }
        }

        selectElement.innerHTML = '<option value="">Select a model...</option>';

        if (result.models && result.models.length > 0) {
            const nameMap = result.modelNames || {};

            // Deduplicate display names — add numeric suffix when the same
            // persona name appears more than once (e.g. "Lina (1)", "Lina (2)")
            const displayNames = result.models.map((m) => nameMap[m] || m.toUpperCase().replace(/-/g, ' '));
            const nameFreq = {};
            displayNames.forEach((n) => {
                nameFreq[n] = (nameFreq[n] || 0) + 1;
            });
            const nameCounter = {};

            result.models.forEach((m, i) => {
                const baseName = displayNames[i];
                let label = baseName;
                if (nameFreq[baseName] > 1) {
                    nameCounter[baseName] = (nameCounter[baseName] || 0) + 1;
                    label = `${baseName} (${nameCounter[baseName]})`;
                }
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = label;
                selectElement.appendChild(opt);
            });

            const statusMsg = result.error
                ? `⚠️ Loaded ${result.models.length} ${provider} models (using defaults due to error)`
                : `✅ Loaded ${result.models.length} ${provider} models`;
            console.log(`[Main] ${statusMsg}`);
        } else {
            selectElement.innerHTML = '<option value="">No models available</option>';
        }

        // Restore current selection if it exists
        if (config.model && result.models.includes(config.model)) {
            selectElement.value = config.model;
        }
    } catch (e) {
        console.error('[Main] Failed to fetch models:', e);
        selectElement.innerHTML = '<option value="">Error loading models</option>';
    }
}

function updateProviderFields() {
    const selected = document.querySelector('input[name="provider"]:checked');
    const provider = selected ? selected.value : 'none';

    const modelSelect = $('model-select');
    const apiKeyInput = $('api-key');
    const baseUrlInput = $('base-url');
    const watsonxRow = $('watsonx-project-row');
    const baseurlRow = $('baseurl-row');

    if (!modelSelect) return;
    modelSelect.innerHTML = '<option value="">Select a model...</option>';

    // Load provider-specific API key from unified settings
    try {
        const unified = localStorage.getItem('nexus_llm_settings');
        if (unified && apiKeyInput) {
            const settings = JSON.parse(unified);

            // Update API key field to show the correct provider's key
            if (provider === 'openai' && settings.openai?.api_key) {
                apiKeyInput.value = settings.openai.api_key;
                if (baseUrlInput) baseUrlInput.value = settings.openai.base_url || '';
            } else if (provider === 'claude' && settings.claude?.api_key) {
                apiKeyInput.value = settings.claude.api_key;
                if (baseUrlInput) baseUrlInput.value = settings.claude.base_url || '';
            } else if (provider === 'watsonx' && settings.watsonx?.api_key) {
                apiKeyInput.value = settings.watsonx.api_key;
                if (baseUrlInput) baseUrlInput.value = settings.watsonx.base_url || 'https://us-south.ml.cloud.ibm.com';
            } else if (provider === 'ollama') {
                apiKeyInput.value = ''; // Ollama doesn't need API key
                if (baseUrlInput) baseUrlInput.value = settings.ollama?.base_url || 'http://localhost:11434';
            } else if (provider === 'ollabridge' && settings.ollabridge) {
                apiKeyInput.value = settings.ollabridge.api_key || '';
                if (baseUrlInput) baseUrlInput.value = settings.ollabridge.base_url || 'http://localhost:11435';
            } else {
                // No key saved for this provider, clear the field
                apiKeyInput.value = '';
                if (baseUrlInput) baseUrlInput.value = '';
            }
        } else if (apiKeyInput && !unified) {
            // No unified settings, check if current config matches this provider
            if (config.provider === provider) {
                apiKeyInput.value = config.apiKey || '';
                if (baseUrlInput) baseUrlInput.value = config.baseUrl || '';
            } else {
                // Different provider, clear the field
                apiKeyInput.value = '';
                if (baseUrlInput) baseUrlInput.value = '';
            }
        }
    } catch (e) {
        console.warn('[Main] Failed to load provider-specific API key:', e);
    }

    if (provider === 'watsonx') {
        if (watsonxRow) watsonxRow.style.display = 'block';
        if (baseurlRow) baseurlRow.style.display = 'block';

        // Updated Watsonx models (latest versions as of 2025/2026)
        [
            'ibm/granite-3-1-8b-instruct', // Updated from granite-3-8b-instruct
            'meta-llama/llama-3-3-70b-instruct', // Updated from llama-3-70b (3.3 offers 405B performance)
            'meta-llama/llama-3-1-8b-instruct', // Updated from llama-3-8b (3.1 has 128k context)
            'mistralai/mistral-large-2407', // Updated from mixtral-8x7b (Mistral Large 2 flagship)
            'mistralai/mistral-nemo', // New mid-sized model (12B)
        ].forEach((m) => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            modelSelect.appendChild(opt);
        });
        return;
    }

    if (watsonxRow) watsonxRow.style.display = 'none';
    if (baseurlRow) baseurlRow.style.display = 'none';
    const pairRowHide = $('ollabridge-pair-row');
    if (pairRowHide) pairRowHide.style.display = 'none';
    const authRowHide = $('ollabridge-auth-row');
    if (authRowHide) authRowHide.style.display = 'none';
    const remotePromptRow = $('ollabridge-remote-prompt-row');
    if (remotePromptRow) remotePromptRow.style.display = 'none';

    // Only fetch models if valid API key is present
    const currentKey = apiKeyInput ? apiKeyInput.value.trim() : '';
    const hasValidKey = currentKey && currentKey.length > 10;

    if (provider === 'openai' && hasValidKey) {
        // Only fetch if key looks valid (starts with sk-)
        if (currentKey.startsWith('sk-') && !currentKey.startsWith('sk-ant-')) {
            fetchAndPopulateModels('openai', modelSelect);
        } else {
            modelSelect.innerHTML =
                '<option value="">⚠️ Please enter a valid OpenAI API key (starts with "sk-") and save settings first</option>';
        }
    } else if (provider === 'claude' && hasValidKey) {
        // Only fetch if key looks valid (starts with sk-ant-)
        if (currentKey.startsWith('sk-ant-')) {
            fetchAndPopulateModels('claude', modelSelect);
        } else {
            modelSelect.innerHTML =
                '<option value="">⚠️ Please enter a valid Claude API key (starts with "sk-ant-") and save settings first</option>';
        }
    } else if (provider === 'ollabridge') {
        if (baseurlRow) baseurlRow.style.display = 'block';
        // Show auth mode dropdown for OllaBridge
        const authRow = $('ollabridge-auth-row');
        if (authRow) authRow.style.display = 'block';

        // Show remote prompt checkbox
        if (remotePromptRow) {
            remotePromptRow.style.display = 'block';
            // Load saved value
            try {
                const unified = JSON.parse(localStorage.getItem('nexus_llm_settings') || '{}');
                const cb = $('ollabridge-use-remote-prompt');
                if (cb) cb.checked = unified.ollabridge?.use_remote_prompt !== false;
            } catch (_) {}
        }

        // Show/hide correct fields based on current auth mode selection
        _updateOllaBridgeAuthUI();

        // Fetch models from OllaBridge gateway (includes HomePilot personas)
        const ollaKey = apiKeyInput ? apiKeyInput.value.trim() : '';
        // Also check for stored pair token
        let hasPairToken = false;
        try {
            const unified = JSON.parse(localStorage.getItem('nexus_llm_settings') || '{}');
            hasPairToken = !!(unified.ollabridge && unified.ollabridge.pair_token);
        } catch (_) {}
        if (ollaKey || hasPairToken) {
            fetchAndPopulateModels('ollabridge', modelSelect);
        } else {
            modelSelect.innerHTML = '<option value="default">default</option>';
        }
    } else if (provider === 'openai' || provider === 'claude') {
        // No API key configured yet
        modelSelect.innerHTML = '<option value="">⚠️ Please enter your API key above and save settings first</option>';
    }
}

/**
 * Update the OllaBridge settings UI based on the selected auth mode dropdown.
 * Shows/hides fields dynamically: pairing code, API key, or just base URL.
 */
function _updateOllaBridgeAuthUI() {
    const authModeSelect = $('ollabridge-auth-mode');
    const authHint = $('ollabridge-auth-hint');
    const pairRow = $('ollabridge-pair-row');
    const apiKeyInput = $('api-key');
    const apiKeyRow = apiKeyInput ? apiKeyInput.closest('.input-group') : null;

    if (!authModeSelect) return;

    // Restore saved auth mode from settings
    try {
        const unified = JSON.parse(localStorage.getItem('nexus_llm_settings') || '{}');
        if (unified.ollabridge?.auth_mode) {
            authModeSelect.value = unified.ollabridge.auth_mode;
        }
    } catch (_) {}

    function applyAuthMode() {
        const mode = authModeSelect.value;

        if (mode === 'pairing') {
            // Device Pairing: show pair code row, hide API key
            if (pairRow) pairRow.style.display = 'block';
            if (apiKeyRow) apiKeyRow.style.display = 'none';
            if (authHint) {
                authHint.textContent = 'Enter the 6-digit pairing code from OllaBridge console and click Pair.';
                authHint.style.color = '#888';
            }
        } else if (mode === 'apikey') {
            // API Key: show API key field, hide pair code
            if (pairRow) pairRow.style.display = 'none';
            if (apiKeyRow) apiKeyRow.style.display = 'block';
            if (authHint) {
                authHint.textContent = 'Enter your OllaBridge API key.';
                authHint.style.color = '#888';
            }
        } else if (mode === 'local-trust') {
            // Local Trust: hide both API key and pair code
            if (pairRow) pairRow.style.display = 'none';
            if (apiKeyRow) apiKeyRow.style.display = 'none';
            if (authHint) {
                authHint.textContent = 'No credentials needed — requests from localhost are trusted.';
                authHint.style.color = '#22c55e';
            }
        }
    }

    // Apply immediately
    applyAuthMode();

    // Re-apply on dropdown change
    authModeSelect.removeEventListener('change', applyAuthMode);
    authModeSelect.addEventListener('change', applyAuthMode);
}

function loadConfigIntoUI() {
    const providerRadio = document.querySelector(`input[name="provider"][value="${config.provider}"]`);
    if (providerRadio) {
        providerRadio.checked = true;
        updateProviderFields();
    }

    if ($('api-key')) $('api-key').value = config.apiKey;
    if ($('model-select')) $('model-select').value = config.model;
    if ($('system-prompt')) $('system-prompt').value = config.systemPrompt;
    if ($('watsonx-project-id')) $('watsonx-project-id').value = config.watsonxProjectId;
    if ($('base-url')) $('base-url').value = config.baseUrl;
}

function saveSettings() {
    const selected = document.querySelector('input[name="provider"]:checked');
    const provider = selected ? selected.value : 'none';

    const apiKey = ($('api-key') && $('api-key').value.trim()) || '';
    const model = ($('model-select') && $('model-select').value) || '';
    const systemPrompt = ($('system-prompt') && $('system-prompt').value) || config.systemPrompt;
    const watsonxProjectId = ($('watsonx-project-id') && $('watsonx-project-id').value) || '';
    const baseUrl = ($('base-url') && $('base-url').value) || '';

    if (provider !== 'none' && provider !== 'ollama' && provider !== 'ollabridge' && !apiKey) {
        return showMessage('Please enter an API key', 'error');
    }
    if (provider !== 'none' && !model) {
        return showMessage('Please select a model', 'error');
    }

    // Validate API key format matches provider
    if (apiKey) {
        if (provider === 'claude' && !apiKey.startsWith('sk-ant-')) {
            return showMessage(
                '❌ Invalid Claude API Key!\n\nClaude keys must start with "sk-ant-"\n\nYou entered a key starting with: ' +
                    apiKey.substring(0, 7) +
                    '\n\nThis looks like an OpenAI key. Please check your API key.',
                'error'
            );
        }
        if (provider === 'openai' && (!apiKey.startsWith('sk-') || apiKey.startsWith('sk-ant-'))) {
            return showMessage(
                '❌ Invalid OpenAI API Key!\n\nOpenAI keys must start with "sk-" (NOT "sk-ant-")\n\nYou entered a key starting with: ' +
                    apiKey.substring(0, 10) +
                    '\n\nThis looks like a Claude key. Please check your API key.',
                'error'
            );
        }
    }

    // Persist viewport background
    const bgRadio = document.querySelector('input[name="desktop-bg"]:checked');
    const desktopBg = bgRadio ? bgRadio.value : 'black';
    localStorage.setItem('desktop_bg', desktopBg);
    window.viewerEngine?.setDesktopBackground(desktopBg);

    // Persist shadow setting
    const shadowRadio = document.querySelector('input[name="desktop-shadow"]:checked');
    const desktopShadow = shadowRadio ? shadowRadio.value : 'off';
    localStorage.setItem('desktop_shadow', desktopShadow);
    window.NEXUS_VIEWER?.setShadows(desktopShadow === 'on');

    // Persist pose normalizer settings and apply live
    if (window.NEXUS_POSE_NORMALIZER) {
        const posePatch = collectPoseSettingsFromUI();
        window.NEXUS_POSE_NORMALIZER.updateSettings(posePatch);
        applyPoseSettingsLive();
    }

    // ✅ Persist provider settings
    localStorage.setItem('ai_provider', provider);
    localStorage.setItem('ai_api_key', apiKey);
    localStorage.setItem('ai_model', model);
    localStorage.setItem('system_prompt', systemPrompt);
    localStorage.setItem('watsonx_project_id', watsonxProjectId);
    localStorage.setItem('base_url', baseUrl);

    config.provider = provider;
    config.apiKey = apiKey;
    config.model = model;
    config.systemPrompt = systemPrompt;
    config.watsonxProjectId = watsonxProjectId;
    config.baseUrl = baseUrl;

    // ✅ ALSO persist to unified LLMManager storage (for VR)
    // Production-safe: desktop keeps legacy keys; VR gets nexus_llm_settings.
    try {
        if (typeof window.LLMManager === 'function') {
            window._nexusLLM = window._nexusLLM || new window.LLMManager();

            // Build the unified settings object that matches LLMManager defaults structure.
            const patch = {
                provider: provider,
                system_prompt: systemPrompt,

                // Enable proxy for production to avoid CORS (VR browsers need this)
                proxy: {
                    enable_proxy: true,
                    proxy_url: '/api/proxy',
                },
            };

            if (provider === 'openai') {
                patch.openai = {
                    api_key: apiKey,
                    model: model || 'gpt-4o',
                    base_url: baseUrl || '',
                };
            } else if (provider === 'claude') {
                patch.claude = {
                    api_key: apiKey,
                    model: model || 'claude-3-5-sonnet-20240620',
                    base_url: baseUrl || '',
                };
            } else if (provider === 'watsonx') {
                patch.watsonx = {
                    api_key: apiKey,
                    project_id: watsonxProjectId || '',
                    model_id: model || 'ibm/granite-13b-chat-v2',
                    base_url: baseUrl || 'https://us-south.ml.cloud.ibm.com',
                };
            } else if (provider === 'ollama') {
                patch.ollama = {
                    base_url: baseUrl || 'http://localhost:11434',
                    model: model || 'llama3',
                };
            } else if (provider === 'ollabridge') {
                const authModeSelect = $('ollabridge-auth-mode');
                const authMode = authModeSelect ? authModeSelect.value : 'pairing';
                const remotePromptCb = $('ollabridge-use-remote-prompt');
                patch.ollabridge = {
                    api_key: authMode === 'apikey' ? apiKey : '',
                    base_url: baseUrl || 'http://localhost:11435',
                    model: model || 'default',
                    auth_mode: authMode,
                    use_remote_prompt: remotePromptCb ? remotePromptCb.checked : true,
                };
            }

            window._nexusLLM.updateSettings(patch);
            console.log('[Main] ✅ Unified LLM settings saved to nexus_llm_settings for VR:', provider);
        } else {
            console.warn('[Main] LLMManager not loaded; VR will not inherit unified settings.');
        }
    } catch (e) {
        console.warn('[Main] Failed to save unified LLM settings:', e);
    }

    // ✅ Persist speech settings
    saveSpeechSettingsFromUI();

    // ✅ Persist STT settings
    saveSTTSettingsFromUI();

    const modal = $('settings-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.hidden = true;
    }

    showMessage('Settings saved successfully', 'success');
}

/* ============================
   Chat + LLM
   ============================ */
async function handleUserMessage(text) {
    addMessageToHistory('user', text);

    // Add user message to chat session history
    chatHistory.addMessage('user', text);

    // Persist chat
    _persistChat();

    setStatus('listening', 'THINKING...');

    // Try streaming first, fallback to non-streaming
    const canStream =
        window._nexusLLM &&
        typeof window._nexusLLM.sendMessageStream === 'function' &&
        config.provider !== 'none' &&
        config.provider !== 'ollabridge' &&
        config.provider !== 'watsonx';

    if (canStream) {
        await _handleStreamingResponse(text);
    } else {
        await _handleNonStreamingResponse(text);
    }
}

// Streaming response: tokens appear word-by-word in the chat
async function _handleStreamingResponse(text) {
    // Create an empty bot message element that we'll fill progressively
    const { textDiv, row } = _createStreamingBotMessage();

    if (window.setTypingIndicator) window.setTypingIndicator(true);

    try {
        const history = window.chatHistory.getHistory();
        const systemPrompt = config.systemPrompt || 'You are a helpful AI assistant named Nexus.';
        let accumulated = '';

        const fullText = await window._nexusLLM.sendMessageStream(text, systemPrompt, history, (token) => {
            // Hide typing indicator on first token
            if (!accumulated && window.setTypingIndicator) window.setTypingIndicator(false);
            accumulated += token;
            textDiv.textContent = accumulated;
            // Scroll chat
            const chatEl = $('chat-history');
            if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
        });

        if (window.setTypingIndicator) window.setTypingIndicator(false);

        const displayText = fullText || accumulated || 'No response';
        textDiv.textContent = displayText;

        // Mirror to AR overlay
        if (window._arAppendBubble) window._arAppendBubble('bot', displayText);

        // Forward to VR
        if (window.sendBotResponseToVR) {
            window.sendBotResponseToVR({
                text: displayText,
                attachments: [],
                avatar_directives: {},
                persona_context: null,
            });
        }

        chatHistory.addMessage('assistant', displayText);
        _persistChat();
        _applyEmotionFromText(displayText);
        speakText(displayText);
        setStatus('idle', 'READY');
    } catch (error) {
        if (window.setTypingIndicator) window.setTypingIndicator(false);
        logError('Streaming error, falling back', error);

        // Remove the empty streaming message
        if (row.parentElement) row.parentElement.removeChild(row);

        // Fallback to non-streaming
        await _handleNonStreamingResponse(text);
    }
}

// Non-streaming response (original behavior + retry button)
async function _handleNonStreamingResponse(text) {
    if (window.setTypingIndicator) window.setTypingIndicator(true);

    try {
        const response = config.provider === 'none' ? getSimpleResponse(text) : await callLLM(text);

        if (window.setTypingIndicator) window.setTypingIndicator(false);

        let displayText;
        let attachments = [];
        if (response && typeof response === 'object' && typeof response.text === 'string') {
            displayText = response.text;
            attachments = response.attachments || [];
        } else {
            displayText = String(response);
        }

        addMessageToHistory('avatar', displayText, attachments);

        if (window.sendBotResponseToVR) {
            window.sendBotResponseToVR({
                text: displayText,
                attachments: attachments,
                avatar_directives: response?.avatar_directives || {},
                persona_context: response?.persona_context || null,
            });
        }

        chatHistory.addMessage('assistant', displayText);
        _persistChat();
        _applyEmotionFromText(displayText);
        speakText(displayText);
        setStatus('idle', 'READY');
    } catch (error) {
        if (window.setTypingIndicator) window.setTypingIndicator(false);
        logError('Error processing message', error);

        if (error.name === 'PersonaUnavailableError') {
            const friendlyMsg =
                `The persona "${error.modelName}" is no longer available. ` +
                `You can select a different model in Settings, or refresh the model list.`;
            addMessageToHistory('avatar', friendlyMsg);
            chatHistory.addMessage('assistant', friendlyMsg);
            showMessage('Persona unavailable \u2014 open Settings to choose another model', 'warning');
            setStatus('idle', 'READY');
        } else {
            // Show error with retry button
            _addErrorWithRetry(text, error);
            setStatus('idle', 'ERROR');
            setTimeout(() => setStatus('idle', 'READY'), 2000);
        }
    }
}

// Creates an empty bot message div for streaming token-by-token
function _createStreamingBotMessage() {
    const chatEl = $('chat-history');
    if (!chatEl) return { textDiv: document.createElement('div'), row: document.createElement('div') };

    const emptyState = chatEl.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message avatar';

    const senderDiv = document.createElement('div');
    senderDiv.className = 'message-sender avatar';
    senderDiv.textContent = 'NEXUS';

    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.textContent = '';

    messageDiv.appendChild(senderDiv);
    messageDiv.appendChild(textDiv);

    const row = document.createElement('div');
    row.className = 'chat-row';
    row.appendChild(messageDiv);
    chatEl.appendChild(row);
    chatEl.scrollTop = chatEl.scrollHeight;

    return { textDiv, row };
}

// Show error message with a retry button
function _addErrorWithRetry(originalText, error) {
    const chatEl = $('chat-history');
    if (!chatEl) return;

    const row = document.createElement('div');
    row.className = 'chat-row';

    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message avatar';

    const senderDiv = document.createElement('div');
    senderDiv.className = 'message-sender avatar';
    senderDiv.textContent = 'NEXUS';

    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.textContent = 'Sorry, I encountered an error. ';

    const retryBtn = document.createElement('button');
    retryBtn.className = 'retry-btn';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => {
        // Remove this error message
        if (row.parentElement) row.parentElement.removeChild(row);
        // Retry the message (don't re-add to user history)
        _handleNonStreamingResponse(originalText);
    });

    textDiv.appendChild(retryBtn);
    msgDiv.appendChild(senderDiv);
    msgDiv.appendChild(textDiv);
    row.appendChild(msgDiv);
    chatEl.appendChild(row);
    chatEl.scrollTop = chatEl.scrollHeight;
}

function getSimpleResponse(text) {
    const t = (text || '').toLowerCase();
    if (t.includes('hello') || t.includes('hi')) return 'Hello! How can I assist you today?';
    if (t.includes('how are you')) return "I'm functioning perfectly, thank you for asking! How can I help you?";
    if (t.includes('bye') || t.includes('goodbye')) return 'Goodbye! Have a wonderful day!';
    if (t.includes('help')) return 'I can chat with you. To use AI features, configure an AI provider in Settings.';
    return "That's interesting! Could you tell me more about that?";
}

async function callLLM(userMessage) {
    // ✅ Use LLMManager with conversation history if available
    if (window._nexusLLM && config.provider !== 'none') {
        const history = window.chatHistory.getHistory();
        const systemPrompt = config.systemPrompt || 'You are a helpful AI assistant named Nexus.';

        // Use structured response for OllaBridge to get attachments
        if (config.provider === 'ollabridge' && typeof window._nexusLLM.sendMessageStructured === 'function') {
            const raw = await window._nexusLLM.sendMessageStructured(userMessage, systemPrompt, history);
            // Normalize via BridgeResponseAdapter if available
            if (typeof window.BridgeResponseAdapter?.normalizeResponse === 'function') {
                return window.BridgeResponseAdapter.normalizeResponse(raw);
            }
            // Manual extraction fallback
            const text = raw?.choices?.[0]?.message?.content || raw?.text || String(raw);
            return {
                text,
                attachments: raw?.x_attachments || [],
                avatar_directives: raw?.x_avatar_directives || raw?.x_directives || {},
                persona_context: raw?.x_persona_context || null,
                meta: {},
            };
        }

        return await window._nexusLLM.sendMessage(userMessage, systemPrompt, history);
    }

    // Fallback to legacy provider functions
    if (config.provider === 'openai') return callOpenAI(userMessage);
    if (config.provider === 'claude') return callClaude(userMessage);
    if (config.provider === 'watsonx') return callWatsonX(userMessage);
    return 'Provider not configured.';
}

/* ============================
   Speech
   ============================ */
/**
 * Detect emotion from response text and apply to avatar expression.
 * Uses simple keyword heuristics — lightweight and instant.
 */
function _applyEmotionFromText(text) {
    const t = (text || '').toLowerCase();
    let emotion = 'neutral';
    let mode = 'idle';

    if (/\b(haha|lol|😂|😄|great|awesome|wonderful|fantastic|love|exciting|glad|happy)\b/.test(t)) {
        emotion = 'happy';
        mode = 'happy';
    } else if (/\b(sorry|unfortunately|sad|miss|regret|disappointed|😢)\b/.test(t)) {
        emotion = 'sad';
        mode = 'idle';
    } else if (/\b(think|hmm|consider|perhaps|interesting|curious|wonder)\b/.test(t)) {
        emotion = 'neutral';
        mode = 'thinking';
    } else if (/\b(wow|amazing|incredible|surprise|shocked|😮|😲)\b/.test(t)) {
        emotion = 'surprised';
        mode = 'idle';
    }

    try {
        window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.setEmotion?.(emotion, 0.5);
    } catch (_) {}
    if (mode !== 'idle') {
        try {
            window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.(mode, 4000);
        } catch (_) {}
    }

    // Bridge emotion to VR Intimacy System
    window.dispatchEvent(
        new CustomEvent('avatar-emotion-changed', {
            detail: { emotion: emotion || 'neutral' },
        })
    );
}

function speakText(text) {
    setStatus('speaking', 'SPEAKING...');

    /* NEXUS_PATCH_LIFE_ENGINE_TALK_MODE */
    try {
        window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.('talk', 30000);
    } catch (_) {}
    try {
        window.NEXUS_VIEWER?.playAnimationByName?.('Talk');
    } catch (_) {}
    // Start lip-sync while speaking (Phase 3 engine + legacy oscillator fallback)
    try {
        const rate = window.SpeechSettings?.rate || 1.0;
        window.NEXUS_LIP_SYNC?.start?.(text, rate);
    } catch (_) {}
    try {
        window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.startLipSync?.();
    } catch (_) {}

    if (!('speechSynthesis' in window)) {
        setStatus('idle', 'READY');
        return;
    }

    // Stop any current utterance to avoid overlapping
    try {
        window.speechSynthesis.cancel();
    } catch (_) {}

    const utterance = new SpeechSynthesisUtterance(text);

    // ✅ Apply settings (with optional persona voice overrides)
    utterance.lang = SpeechSettings.lang;
    utterance.rate = SpeechSettings.rate;
    utterance.pitch = SpeechSettings.pitch;

    // Apply persona voice_style overrides from HomePilot (additive)
    if (typeof window.PersonaContextBridge !== 'undefined') {
        const voiceOverrides = window.PersonaContextBridge.getVoiceOverrides({
            rate: SpeechSettings.rate,
            pitch: SpeechSettings.pitch,
        });
        if (voiceOverrides) {
            utterance.rate = voiceOverrides.rate;
            utterance.pitch = voiceOverrides.pitch;
        }
    }

    // Use smart voice picker (handles specific selection or auto-best-match)
    const v = pickBestVoice();
    if (v) utterance.voice = v;

    utterance.onend = () => {
        /* NEXUS_PATCH_LIFE_ENGINE_TALK_END */
        try {
            window.NEXUS_LIP_SYNC?.stop?.();
        } catch (_) {}
        try {
            window.NEXUS_BEHAVIOR?.onSpeechEnd?.();
        } catch (_) {}
        try {
            window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.stopLipSync?.();
        } catch (_) {}
        const personaMode =
            typeof window.PersonaContextBridge !== 'undefined'
                ? window.PersonaContextBridge.getDefaultAvatarMode()
                : 'idle';
        try {
            window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.(personaMode, personaMode === 'idle' ? 1 : 5000);
        } catch (_) {}
        setStatus('idle', 'READY');
        try {
            const clipName = personaMode === 'happy' ? 'Happy' : 'Idle';
            window.NEXUS_VIEWER?.playAnimationByName?.(clipName);
        } catch (_) {}
    };

    utterance.onerror = () => {
        /* NEXUS_PATCH_LIFE_ENGINE_TALK_ERR */
        try {
            window.NEXUS_LIP_SYNC?.stop?.();
        } catch (_) {}
        try {
            window.NEXUS_BEHAVIOR?.onSpeechEnd?.();
        } catch (_) {}
        try {
            window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.stopLipSync?.();
        } catch (_) {}
        try {
            window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.('idle', 1);
        } catch (_) {}
        setStatus('idle', 'READY');
        try {
            window.NEXUS_VIEWER?.playAnimationByName?.('Idle');
        } catch (_) {}
    };

    window.speechSynthesis.speak(utterance);
}

function initSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        logWarn('Speech recognition not supported in this browser.');
        return;
    }

    recognition = new SR();

    // ✅ Apply persisted language
    recognition.lang = SpeechSettings.lang;

    recognition.continuous = false;
    recognition.interimResults = true; // ✅ Enable interim results for real-time feedback

    recognition.onstart = () => {
        isListening = true;
        setStatus('listening', 'LISTENING...');

        console.log('[Desktop STT] 🎙️ Recognition started');
        if (window.NEXUS_LOGGER) {
            window.NEXUS_LOGGER.info('Desktop STT started', {
                browser: navigator.userAgent.includes('Quest') ? 'Quest' : 'Desktop',
            });
        }

        try {
            window.NEXUS_VIEWER?.playAnimationByName?.('Idle');
        } catch (_) {}

        const btn = $('listen-btn');
        if (btn) {
            btn.classList.add('active');
        }
        if ($('voice-btn-text')) {
            $('voice-btn-text').textContent = 'LISTENING...';
        }
        if ($('recognition-status')) {
            $('recognition-status').textContent = 'Listening to your voice...';
        }
        if (btn) {
            btn.setAttribute('aria-pressed', 'true');
        }

        // Clear input and set placeholder
        const inputField = $('speech-text');
        console.log('[Desktop STT] 🖱️ Input field found:', !!inputField);
        if (inputField) {
            inputField.value = '';
            inputField.placeholder = 'Listening...';
            inputField.style.fontStyle = 'normal';
            inputField.style.opacity = '1';
        } else {
            console.error('[Desktop STT] ❌ ERROR: speech-text input not found!');
        }
    };

    recognition.onresult = (event) => {
        const inputField = $('speech-text');
        if (!inputField) {
            console.error('[Desktop STT] ❌ ERROR: speech-text input field not found in onresult!');
            if (window.NEXUS_LOGGER) {
                window.NEXUS_LOGGER.error('Desktop STT input field missing');
            }
            return;
        }

        // Check if this is the final result
        const result = event.results[event.results.length - 1];
        const transcript = result[0].transcript || '';
        const confidence = result[0].confidence || 0;
        const isFinal = result.isFinal;

        if (isFinal) {
            // Final result - show with confidence
            const confidencePercent = Math.round(confidence * 100);

            console.log(`[Desktop STT] ✅ FINAL: "${transcript}" (${confidencePercent}% confidence)`);
            if (window.NEXUS_LOGGER) {
                window.NEXUS_LOGGER.info('Desktop STT final', { text: transcript, confidence: confidencePercent });
            }

            inputField.value = transcript;
            inputField.style.fontStyle = 'normal';
            inputField.style.opacity = '1';
            inputField.placeholder = 'Type your message…';

            console.log('[Desktop STT] 📤 Populated input field with:', transcript);

            // Stop listening after final result
            stopVoiceInput();

            // Auto-send if enabled and confidence > 80%
            if (SpeechSettings.autoSend && confidence >= 0.8 && transcript.trim().length > 0) {
                console.log(`[Desktop STT] Auto-sending (${confidencePercent}% confidence)`);
                showMessage(`🎤 Auto-sent (${confidencePercent}% confidence): "${transcript}"`, 'info');
                handleUserMessage(transcript.trim());
                inputField.value = '';
            } else {
                // Show confidence feedback and let user review
                showMessage(
                    `🎤 Transcribed (${confidencePercent}% confidence): "${transcript}"\nReview and press SEND, or click ACTIVATE VOICE to record again.`,
                    'info'
                );
                inputField.focus();
                inputField.select();
            }
        } else {
            // Interim result - show in italic
            console.log(`[Desktop STT] 📝 INTERIM: "${transcript}"`);
            if (window.NEXUS_LOGGER) {
                window.NEXUS_LOGGER.info('Desktop STT interim', { text: transcript });
            }

            inputField.value = transcript;
            inputField.style.fontStyle = 'italic';
            inputField.style.opacity = '0.7';
        }
    };

    recognition.onerror = (event) => {
        const errorType = event && event.error;
        console.error(`[Desktop STT] ⚠️ ERROR: ${errorType}`);
        if (window.NEXUS_LOGGER) {
            window.NEXUS_LOGGER.error('Desktop STT error', { error: errorType });
        }
        logError('Speech recognition error', errorType);
        stopVoiceInput();
    };

    recognition.onend = () => {
        console.log('[Desktop STT] ⏹️ Recognition ended');
        if (window.NEXUS_LOGGER) {
            window.NEXUS_LOGGER.info('Desktop STT ended');
        }
        stopVoiceInput();
    };
}

function toggleVoiceInput() {
    if (isListening) stopVoiceInput();
    else startVoiceInput();
}

function startVoiceInput() {
    if (!recognition) return showMessage('Speech recognition not supported in this browser', 'error');
    try {
        recognition.lang = SpeechSettings.lang; // ✅ ensure current setting
        recognition.start();
    } catch (e) {
        logError('Error starting recognition', e);
    }
}

function stopVoiceInput() {
    isListening = false;
    setStatus('idle', 'READY');
    try {
        window.NEXUS_VIEWER?.playAnimationByName?.('Idle');
    } catch (_) {}

    const btn = $('listen-btn');
    if (btn) {
        btn.classList.remove('active');
    }
    if ($('voice-btn-text')) {
        $('voice-btn-text').textContent = 'ACTIVATE VOICE';
    }
    if ($('recognition-status')) {
        $('recognition-status').textContent = 'Voice system standby';
    }
    if (btn) {
        btn.setAttribute('aria-pressed', 'false');
    }

    // Reset input field styling
    const inputField = $('speech-text');
    if (inputField) {
        inputField.style.fontStyle = 'normal';
        inputField.style.opacity = '1';
        if (!inputField.value) {
            inputField.placeholder = 'Type your message…';
        }
    }

    if (recognition) {
        try {
            recognition.stop();
        } catch (_) {}
    }
}

/* ============================
   Chat UI
   ============================ */
function addMessageToHistory(sender, text, attachments) {
    const chatHistory = $('chat-history');
    if (!chatHistory) return;

    const emptyState = chatHistory.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;

    const senderDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;
    senderDiv.className = `message-sender ${sender}`;
    senderDiv.textContent = sender === 'user' ? 'YOU' : 'NEXUS';

    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.textContent = text;

    messageDiv.appendChild(senderDiv);
    messageDiv.appendChild(textDiv);

    // Render image attachments inline
    if (Array.isArray(attachments) && attachments.length > 0) {
        attachments.forEach((att) => {
            if (att.type === 'image' && att.url) {
                const imgContainer = document.createElement('div');
                imgContainer.style.cssText = 'margin-top: 8px; max-width: 300px;';

                const img = document.createElement('img');
                img.src = att.url;
                img.alt = att.name || 'Image';
                img.style.cssText =
                    'width: 100%; border-radius: 8px; cursor: pointer; border: 1px solid rgba(0,229,255,0.3);';
                img.loading = 'lazy';

                // Click to open in new tab
                img.addEventListener('click', () => window.open(att.url, '_blank'));

                if (att.name) {
                    const label = document.createElement('div');
                    label.textContent = att.name;
                    label.style.cssText =
                        'font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 4px; text-align: center;';
                    imgContainer.appendChild(img);
                    imgContainer.appendChild(label);
                } else {
                    imgContainer.appendChild(img);
                }

                messageDiv.appendChild(imgContainer);
            }
        });
    }

    // Wrap in a clearfix row so floated bubbles stack properly
    const row = document.createElement('div');
    row.className = 'chat-row';
    row.appendChild(messageDiv);
    chatHistory.appendChild(row);
    chatHistory.scrollTop = chatHistory.scrollHeight;

    // Mirror message to AR overlay (if active)
    if (window._arAppendBubble) {
        window._arAppendBubble(sender === 'user' ? 'user' : 'bot', text);
    }
}

function clearHistory() {
    const chatHistoryEl = $('chat-history');
    if (!chatHistoryEl) return;
    chatHistoryEl.innerHTML = `
    <div class="empty-state">
      <p>System Log Ready.</p>
      <p class="sub-text">All transmissions will be recorded here.</p>
    </div>`;

    // ✅ Also clear the chat session history (context memory)
    if (window.chatHistory) {
        window.chatHistory.clear();
        showMessage('Chat history and context memory cleared', 'success');
    }
}

function showMessage(text, type) {
    const notification = document.createElement('div');
    notification.textContent = text;

    const bg =
        type === 'error' ? '#ff5252' : type === 'success' ? '#00ff88' : type === 'warning' ? '#f59e0b' : '#00e5ff';
    notification.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${bg};
    color: #000;
    padding: 12px 24px;
    border-radius: 8px;
    font-family: var(--font-display, system-ui);
    font-weight: 600;
    z-index: 2000;
  `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s ease-out';
        setTimeout(() => notification.remove(), 350);
    }, 3000);
}

/* ============================
   Chat Session History (Token-Limited Context)
   ============================ */
class ChatSessionHistory {
    constructor(maxTokens = 500) {
        this.maxTokens = maxTokens;
        this.messages = []; // Array of {role: 'user'|'assistant', content: string}
    }

    /**
     * Estimate token count (rough approximation: 1 token ≈ 4 characters)
     * @param {string} text
     * @returns {number} Estimated token count
     */
    estimateTokens(text) {
        return Math.ceil((text || '').length / 4);
    }

    /**
     * Get total token count of current history
     * @returns {number} Total tokens
     */
    getTotalTokens() {
        return this.messages.reduce((sum, msg) => sum + this.estimateTokens(msg.content), 0);
    }

    /**
     * Add a message to history with sliding window token management
     * @param {string} role - 'user' or 'assistant'
     * @param {string} content - Message content
     */
    addMessage(role, content) {
        this.messages.push({ role, content });

        // ✅ Sliding window: Remove oldest messages if over token limit
        while (this.getTotalTokens() > this.maxTokens && this.messages.length > 2) {
            // Keep at least the last exchange (1 user + 1 assistant)
            const removed = this.messages.shift();
            console.log(`[ChatHistory] Removed oldest message (${this.estimateTokens(removed.content)} tokens)`);
        }

        console.log(`[ChatHistory] History: ${this.messages.length} messages, ${this.getTotalTokens()} tokens`);
    }

    /**
     * Get message history in format suitable for LLM APIs
     * @returns {Array} Message history
     */
    getHistory() {
        return [...this.messages];
    }

    /**
     * Clear all history (e.g., when starting new session)
     */
    clear() {
        this.messages = [];
        console.log('[ChatHistory] History cleared');
    }

    /**
     * Get history summary for display
     * @returns {string}
     */
    getSummary() {
        return `${this.messages.length} messages (${this.getTotalTokens()} tokens / ${this.maxTokens} max)`;
    }
}

// Global chat session instance (accessible via window for VR integration)
window.chatHistory = new ChatSessionHistory(500);

/* ============================
   Chat Persistence (localStorage)
   ============================ */
const CHAT_STORAGE_KEY = 'nexus_chat_messages';
const CHAT_DISPLAY_KEY = 'nexus_chat_display';

function _persistChat() {
    try {
        // Save LLM history (for context)
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(window.chatHistory.getHistory()));
        // Save display messages (user-facing, with sender labels)
        const chatEl = document.getElementById('chat-history');
        if (chatEl) {
            const rows = chatEl.querySelectorAll('.chat-row');
            const display = [];
            rows.forEach((row) => {
                const msg = row.querySelector('.chat-message');
                if (!msg) return;
                const sender = msg.classList.contains('user') ? 'user' : 'avatar';
                const text = msg.querySelector('.message-text')?.textContent || '';
                if (text) display.push({ sender, text });
            });
            localStorage.setItem(CHAT_DISPLAY_KEY, JSON.stringify(display));
        }
    } catch (_) {
        /* storage full or unavailable */
    }
}

function _restoreChat() {
    try {
        // Restore LLM context history
        const saved = localStorage.getItem(CHAT_STORAGE_KEY);
        if (saved) {
            const msgs = JSON.parse(saved);
            if (Array.isArray(msgs) && msgs.length > 0) {
                window.chatHistory.messages = msgs;
                console.log(`[ChatPersist] Restored ${msgs.length} context messages`);
            }
        }
        // Restore display messages
        const display = localStorage.getItem(CHAT_DISPLAY_KEY);
        if (display) {
            const items = JSON.parse(display);
            if (Array.isArray(items) && items.length > 0) {
                items.forEach((m) => addMessageToHistory(m.sender, m.text));
                console.log(`[ChatPersist] Restored ${items.length} display messages`);
            }
        }
    } catch (e) {
        console.warn('[ChatPersist] Restore failed:', e);
    }
}

/* ============================
   Collapsible Panels
   ============================ */
function initCollapsiblePanels() {
    document.querySelectorAll('[data-collapsible]').forEach((panel) => {
        const toggle = panel.querySelector('.collapse-toggle');
        if (!toggle) return;

        // Set initial state
        const defaultState = panel.dataset.default;
        const isExpanded = defaultState !== 'collapsed';
        panel.dataset.expanded = isExpanded ? 'true' : 'false';
        toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

        // Toggle on click
        toggle.addEventListener('click', () => {
            const expanded = panel.dataset.expanded === 'true';
            panel.dataset.expanded = expanded ? 'false' : 'true';
            toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        });
    });
}

/* ============================
   Init
   ============================ */
async function init() {
    console.log('[Main] init() called', {
        readyState: document.readyState,
        useGltfEngine: !!window.__USE_GLTF_VIEWER_ENGINE__,
        hasNexusViewer: !!window.NEXUS_VIEWER,
        hasReadyPromise: !!window.__NEXUS_VIEWER_READY__,
        device: window.NEXUS_DEVICE?.device || 'unknown',
        os: window.NEXUS_DEVICE?.os || 'unknown',
    });
    showLoading('Loading 3D Avatar...');
    setStatus('idle', 'BOOTING...');

    const useViewerEngine = !!window.__USE_GLTF_VIEWER_ENGINE__;

    if (!useViewerEngine) {
        if (!vendorAssertOrAbort()) return;
    }

    try {
        // Wait for ViewerEngine with a timeout for mobile reliability
        if (useViewerEngine && window.__NEXUS_VIEWER_READY__) {
            const viewerOrNull = await Promise.race([
                window.__NEXUS_VIEWER_READY__,
                new Promise((resolve) => setTimeout(() => resolve(null), 15000)),
            ]);

            if (!viewerOrNull) {
                console.warn('[Main] ViewerEngine not available (timeout or WebGL failure) — running chat-only mode');
                hideLoading();
                setStatus('idle', 'CHAT MODE');
            }
        } else if (!useViewerEngine) {
            setupThreeJS();
        }

        // Voices load async in Chrome; keep list current
        if ('speechSynthesis' in window) {
            window.speechSynthesis.onvoiceschanged = () => {
                refreshVoiceList();
            };
        }

        setupEventListeners();
        setupModals();
        setupPoseNormalizerUI();
        initSpeechRecognition();
        loadConfigIntoUI();
        loadSpeechSettingsIntoUI();
        refreshVoiceList(); // initial attempt
        _restoreChat(); // restore previous conversation from localStorage

        await loadAvatarManifest();

        // Only try to load avatar if 3D engine is available
        if (window.NEXUS_VIEWER) {
            loadDefaultAvatarFromManifest();
        } else {
            hideLoading();
            setStatus('idle', 'READY');
        }
    } catch (err) {
        logError('Initialization failed', err);
        showLoading(`Initialization failed: ${err && err.message ? err.message : err}`);
        setStatus('idle', 'ERROR');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

/* =====================================================================
   AR CHAT OVERLAY — Bridges AR DOM overlay with the main chat system.
   Activates voice + text input over the camera feed so users can speak
   with the avatar while in AR mode on mobile.
   ===================================================================== */
(function initAROverlay() {
    const overlay = document.getElementById('ar-dom-overlay');
    if (!overlay) return;

    const arChat = document.getElementById('ar-chat');
    const arInput = document.getElementById('ar-chat-input');
    const arSendBtn = document.getElementById('ar-send-btn');
    const arVoiceBtn = document.getElementById('ar-voice-btn');
    const arExitBtn = document.getElementById('ar-exit-btn');
    const arPlaceBtn = document.getElementById('ar-place-btn');
    const arScaleBtn = document.getElementById('ar-scale-btn');
    const arStatus = document.getElementById('ar-status');

    let arVoiceActive = false;

    // --- Overlay activation via AR session events ---
    window.addEventListener('ar-session-start', () => {
        overlay.classList.add('ar-active');
        if (arStatus) arStatus.textContent = 'Point at a surface';
    });

    window.addEventListener('ar-session-end', () => {
        overlay.classList.remove('ar-active');
        stopARVoice();
    });

    window.addEventListener('ar-floor-detected', () => {
        if (arStatus) arStatus.textContent = 'Avatar placed — talk to me!';
    });

    // --- Send text message from AR input ---
    function arSendMessage() {
        if (!arInput) return;
        const text = arInput.value.trim();
        if (!text) return;
        arInput.value = '';
        appendARBubble('user', text);
        // Reuse the main chat pipeline
        if (typeof handleUserMessage === 'function') {
            handleUserMessage(text);
        }
    }

    if (arSendBtn) arSendBtn.addEventListener('click', arSendMessage);
    if (arInput) {
        arInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') arSendMessage();
        });
    }

    // --- Voice input in AR ---
    function startARVoice() {
        arVoiceActive = true;
        if (arVoiceBtn) arVoiceBtn.classList.add('ar-listening');
        // Use the existing speech recognition system
        if (typeof startVoiceInput === 'function') {
            startVoiceInput();
        }
    }

    function stopARVoice() {
        arVoiceActive = false;
        if (arVoiceBtn) arVoiceBtn.classList.remove('ar-listening');
        if (typeof stopVoiceInput === 'function') {
            stopVoiceInput();
        }
    }

    if (arVoiceBtn) {
        arVoiceBtn.addEventListener('click', () => {
            if (arVoiceActive) stopARVoice();
            else startARVoice();
        });
    }

    // --- Exit AR ---
    if (arExitBtn) {
        arExitBtn.addEventListener('click', () => {
            try {
                const engine = window.NEXUS_VIEWER;
                if (engine?.arSupport?.isARActive) {
                    engine.arSupport.toggleAR();
                }
            } catch (e) {
                console.warn('[AR Overlay] Exit error:', e);
            }
        });
    }

    // --- Place avatar ---
    if (arPlaceBtn) {
        arPlaceBtn.addEventListener('click', () => {
            try {
                const engine = window.NEXUS_VIEWER;
                if (engine?.arSupport && engine?.avatarManager?.currentRoot) {
                    engine.arSupport.placeAvatarAtReticle(engine.avatarManager.currentRoot);
                    if (arStatus) arStatus.textContent = 'Avatar placed — talk to me!';
                }
            } catch (e) {
                console.warn('[AR Overlay] Place error:', e);
            }
        });
    }

    // --- Scale toggle ---
    let arScaleLevel = 1;
    const SCALE_LEVELS = [1, 0.5, 0.25, 1.5];
    if (arScaleBtn) {
        arScaleBtn.addEventListener('click', () => {
            try {
                arScaleLevel = (arScaleLevel + 1) % SCALE_LEVELS.length;
                const engine = window.NEXUS_VIEWER;
                if (engine?.arSupport && engine?.avatarManager?.currentRoot) {
                    engine.arSupport.setAvatarScale(engine.avatarManager.currentRoot, SCALE_LEVELS[arScaleLevel]);
                    if (arScaleBtn) arScaleBtn.textContent = `SIZE ${SCALE_LEVELS[arScaleLevel]}x`;
                }
            } catch (e) {
                console.warn('[AR Overlay] Scale error:', e);
            }
        });
    }

    // --- Mirror chat messages into the AR overlay ---
    function appendARBubble(role, text) {
        if (!arChat) return;
        const bubble = document.createElement('div');
        bubble.className = `ar-chat-bubble ar-chat-bubble--${role === 'user' ? 'user' : 'bot'}`;
        bubble.textContent = text;
        arChat.appendChild(bubble);
        // Keep only last 8 messages visible to avoid clutter over camera
        while (arChat.children.length > 8) {
            arChat.removeChild(arChat.firstChild);
        }
        arChat.scrollTop = arChat.scrollHeight;
    }

    // Expose so the main addMessageToHistory can mirror to AR
    window._arAppendBubble = appendARBubble;
})();

/* =====================================================================
   PATCH_LLM_PROXY_TEST_CONNECTION_V1
   - Fixes CORS by routing Claude + WatsonX (and OpenAI) via proxy
   - Adds Settings -> "Test Connection" button
   - Improves WatsonX auth: accept IAM API key OR Bearer access token
   ===================================================================== */

async function __nexusDetectProxyUrl() {
    if (window.__NEXUS_PROXY_URL__) return window.__NEXUS_PROXY_URL__;

    // Prefer same-origin /api/proxy if it exists.
    try {
        const r = await fetch('/api/proxy', { method: 'OPTIONS' });
        if (r && (r.status === 200 || r.status === 204)) {
            window.__NEXUS_PROXY_URL__ = '/api/proxy';
            return window.__NEXUS_PROXY_URL__;
        }
    } catch (_) {}

    // Fallback: local nexus-proxy
    const candidates = ['http://127.0.0.1:3001/proxy', 'http://localhost:3001/proxy'];
    for (const url of candidates) {
        try {
            const health = url.replace(/\/proxy$/, '/health');
            const r = await fetch(health, { method: 'GET' });
            if (r && r.ok) {
                window.__NEXUS_PROXY_URL__ = url;
                return window.__NEXUS_PROXY_URL__;
            }
        } catch (_) {}
    }

    window.__NEXUS_PROXY_URL__ = null;
    return null;
}

async function __nexusProxyFetch(upstreamUrl, fetchOptions) {
    const proxyUrl = await __nexusDetectProxyUrl();
    if (!proxyUrl) {
        throw new Error(
            'CORS proxy not running. Start it with: `node nexus-proxy/server.js` (local), or deploy on Vercel (production).'
        );
    }

    const method = (fetchOptions?.method || 'GET').toUpperCase();
    const headers = fetchOptions?.headers || {};
    const body = fetchOptions?.body;

    const payload = { url: upstreamUrl, method, headers, body: body === undefined ? undefined : body };

    const res = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    return res;
}

// ---- WatsonX: turn IAM API key into Bearer token (cached) ----
let __nexusWatsonxTokenCache = { token: null, expMs: 0 };

function __looksLikeJwt(s) {
    return typeof s === 'string' && s.split('.').length === 3;
}

async function __getWatsonxBearer(apiKeyOrToken) {
    const raw = (apiKeyOrToken || '').trim();
    if (!raw) throw new Error('Missing WatsonX credential.');

    if (__looksLikeJwt(raw)) return raw;
    if (raw.toLowerCase().startsWith('bearer ')) return raw.slice(7).trim();

    const now = Date.now();
    if (__nexusWatsonxTokenCache.token && __nexusWatsonxTokenCache.expMs - now > 60_000) {
        return __nexusWatsonxTokenCache.token;
    }

    const form = new URLSearchParams();
    form.set('grant_type', 'urn:ibm:params:oauth:grant-type:apikey');
    form.set('apikey', raw);

    const res = await __nexusProxyFetch('https://iam.cloud.ibm.com/identity/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: form.toString(),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`WatsonX IAM token error: ${res.status} ${text}`);

    const data = JSON.parse(text);
    const token = data.access_token;
    const expiresIn = Number(data.expires_in || 3600);
    if (!token) throw new Error('WatsonX IAM token response missing access_token.');

    __nexusWatsonxTokenCache = { token, expMs: now + expiresIn * 1000 };
    return token;
}

/**
 * Override: OpenAI via proxy.
 */
async function callOpenAI(userMessage) {
    const upstreamUrl = 'https://api.openai.com/v1/chat/completions';
    const res = await __nexusProxyFetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
            model: config.model,
            messages: [
                { role: 'system', content: config.systemPrompt },
                { role: 'user', content: userMessage },
            ],
            max_tokens: 500,
        }),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${text}`);
    const data = JSON.parse(text);
    return data?.choices?.[0]?.message?.content || 'No response.';
}

/**
 * Override: Claude via proxy.
 */
async function callClaude(userMessage) {
    const upstreamUrl = 'https://api.anthropic.com/v1/messages';
    const res = await __nexusProxyFetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
            model: config.model,
            max_tokens: 500,
            system: config.systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
        }),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`Claude API error: ${res.status} ${text}`);
    const data = JSON.parse(text);
    return data?.content?.[0]?.text || 'No response.';
}

/**
 * Override: WatsonX via proxy.
 */
async function callWatsonX(userMessage) {
    const baseUrl = config.baseUrl || 'https://us-south.ml.cloud.ibm.com';
    const bearer = await __getWatsonxBearer(config.apiKey);

    const upstreamUrl = `${baseUrl}/ml/v1/text/generation?version=2023-05-29`;
    const res = await __nexusProxyFetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
        body: JSON.stringify({
            model_id: config.model,
            input: `${config.systemPrompt}\n\nUser: ${userMessage}\n\nAssistant:`,
            parameters: { max_new_tokens: 300, temperature: 0.7 },
            project_id: config.watsonxProjectId,
        }),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`WatsonX API error: ${res.status} ${text}`);
    const data = JSON.parse(text);
    return data?.results?.[0]?.generated_text || 'No response.';
}

// ---- Test Connection button (Settings modal) ----
async function __nexusTestConnection() {
    if (!config || config.provider === 'none') return { ok: false, message: 'Select a provider first.' };
    if (!config.apiKey) return { ok: false, message: 'Enter an API key/token first.' };
    if (!config.model) return { ok: false, message: 'Select a model first.' };

    const ping = 'Respond with the single word: OK';

    try {
        const reply = await callLLM(ping);
        const short = String(reply || '')
            .trim()
            .slice(0, 120);
        return { ok: true, message: `✅ Connected. Reply: ${short || 'OK'}` };
    } catch (e) {
        return { ok: false, message: `❌ ${e.message || e}` };
    }
}

function __nexusWireTestButton() {
    const btn = document.getElementById('test-connection-btn');
    const status = document.getElementById('test-connection-status');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        // Pull latest values from the Settings inputs (test without saving)
        try {
            const selected = document.querySelector('input[name="provider"]:checked');
            const provider = selected ? selected.value : 'none';
            const apiKey = (document.getElementById('api-key')?.value || '').trim();
            const model = (document.getElementById('model-select')?.value || '').trim();
            const systemPrompt = (document.getElementById('system-prompt')?.value || config.systemPrompt).trim();
            const watsonxProjectId = (document.getElementById('watsonx-project-id')?.value || '').trim();
            const baseUrl = (document.getElementById('base-url')?.value || '').trim();

            config.provider = provider;
            config.apiKey = apiKey;
            config.model = model;
            config.systemPrompt = systemPrompt;
            config.watsonxProjectId = watsonxProjectId;
            config.baseUrl = baseUrl;
        } catch (_) {}

        btn.disabled = true;
        if (status) status.textContent = 'Testing...';

        const result = await __nexusTestConnection();
        if (status) status.textContent = result.message;

        btn.disabled = false;
    });
}

window.addEventListener('DOMContentLoaded', __nexusWireTestButton);

/* =====================================================================
   FETCH MODELS BUTTON
   - Manually fetch latest available models from the selected provider
   - Useful for refreshing model list without reloading the page
   ===================================================================== */
function __nexusWireFetchModelsButton() {
    const btn = document.getElementById('fetch-models-btn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        const selected = document.querySelector('input[name="provider"]:checked');
        const provider = selected ? selected.value : 'none';

        if (provider === 'none') {
            alert('Please select a provider first (OpenAI, Claude, Watsonx, Ollama, or OllaBridge)');
            return;
        }

        if (provider === 'watsonx') {
            alert('Watsonx models are fetched automatically. Use the dropdown to see available models.');
            return;
        }

        if (provider === 'ollama') {
            alert('Ollama models are fetched automatically. Use the dropdown to see available models.');
            return;
        }

        const modelSelect = document.getElementById('model-select');
        if (!modelSelect) return;

        // Disable button during fetch
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = '⏳ Fetching...';

        try {
            await fetchAndPopulateModels(provider, modelSelect);

            // Show success feedback
            btn.textContent = '✅ Updated!';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 2000);
        } catch (e) {
            console.error('[Main] Failed to fetch models:', e);
            btn.textContent = '❌ Error';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 2000);
        }
    });
}

window.addEventListener('DOMContentLoaded', __nexusWireFetchModelsButton);

/* =====================================================================
   OllaBridge Pairing Button
   - Exchanges a 6-digit code for a persistent bearer token
   - Stores the token in LLMManager settings (ollabridge.pair_token)
   ===================================================================== */
function __nexusWireOllaBridgePairButton() {
    const btn = document.getElementById('ollabridge-pair-btn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        const codeInput = document.getElementById('ollabridge-pair-code');
        const statusDiv = document.getElementById('ollabridge-pair-status');
        if (!codeInput) return;

        const code = codeInput.value.trim();
        if (!code || code.length < 4) {
            if (statusDiv) {
                statusDiv.textContent = 'Please enter the pairing code from the OllaBridge console.';
                statusDiv.style.color = '#f59e0b';
            }
            return;
        }

        btn.disabled = true;
        btn.textContent = '⏳ Pairing...';
        if (statusDiv) {
            statusDiv.textContent = 'Exchanging code...';
            statusDiv.style.color = '#888';
        }

        try {
            // Auto-create LLMManager if not yet instantiated
            if (!window._nexusLLM) {
                if (typeof window.LLMManager !== 'function') {
                    throw new Error('LLMManager script not loaded. Refresh the page.');
                }
                window._nexusLLM = new window.LLMManager();
            }

            // Apply the current base_url and enable proxy before pairing
            // (proxy avoids CORS when pairing from a different origin)
            const baseUrlInput = document.getElementById('base-url');
            const pairPatch = {
                proxy: { enable_proxy: true, proxy_url: '/api/proxy' },
            };
            if (baseUrlInput && baseUrlInput.value.trim()) {
                pairPatch.ollabridge = { base_url: baseUrlInput.value.trim() };
            }
            window._nexusLLM.updateSettings(pairPatch);

            const result = await window._nexusLLM.pairWithOllaBridge(code);

            if (result.ok) {
                codeInput.value = '';
                if (statusDiv) {
                    statusDiv.textContent = `✅ Paired successfully! Device: ${result.device_id || 'unknown'}. Token saved.`;
                    statusDiv.style.color = '#22c55e';
                }
                btn.textContent = '✅ Paired!';

                // Refresh models now that we have a token
                const modelSelect = document.getElementById('model-select');
                if (modelSelect) {
                    fetchAndPopulateModels('ollabridge', modelSelect);
                }
            } else {
                if (statusDiv) {
                    statusDiv.textContent = `❌ ${result.error || 'Pairing failed'}`;
                    statusDiv.style.color = '#ef4444';
                }
                btn.textContent = '❌ Failed';
            }
        } catch (e) {
            if (statusDiv) {
                statusDiv.textContent = `❌ Error: ${e.message}`;
                statusDiv.style.color = '#ef4444';
            }
            btn.textContent = '❌ Error';
        }

        setTimeout(() => {
            btn.textContent = '🔗 Pair';
            btn.disabled = false;
        }, 3000);
    });
}

window.addEventListener('DOMContentLoaded', __nexusWireOllaBridgePairButton);

/* =====================================================================
   DEBUG HELPER: Check Stored API Keys
   - Run window.debugAPIKeys() in console to see what's stored
   - Helps diagnose authentication issues
   ===================================================================== */
window.debugAPIKeys = function () {
    console.log('=== NEXUS API KEY DEBUGGER ===\n');

    try {
        // Check unified settings
        const unified = localStorage.getItem('nexus_llm_settings');
        if (unified) {
            const settings = JSON.parse(unified);
            console.log('📦 Unified Settings (nexus_llm_settings):');
            console.log('  Provider:', settings.provider || 'none');

            if (settings.openai?.api_key) {
                const key = settings.openai.api_key;
                console.log(
                    '  OpenAI Key:',
                    key.substring(0, 12) + '...' + key.substring(key.length - 4),
                    `(${key.length} chars)`
                );
                console.log('    ✓ Starts with:', key.substring(0, 7));
                console.log('    ✓ Valid format:', key.startsWith('sk-') && !key.startsWith('sk-ant-') ? '✅' : '❌');
            }

            if (settings.claude?.api_key) {
                const key = settings.claude.api_key;
                console.log(
                    '  Claude Key:',
                    key.substring(0, 12) + '...' + key.substring(key.length - 4),
                    `(${key.length} chars)`
                );
                console.log('    ✓ Starts with:', key.substring(0, 7));
                console.log('    ✓ Valid format:', key.startsWith('sk-ant-') ? '✅' : '❌');
            }

            if (settings.watsonx?.api_key) {
                const key = settings.watsonx.api_key;
                console.log(
                    '  Watsonx Key:',
                    key.substring(0, 12) + '...' + key.substring(key.length - 4),
                    `(${key.length} chars)`
                );
            }

            if (settings.ollama?.base_url) {
                console.log('  Ollama URL:', settings.ollama.base_url);
            }
        } else {
            console.log('📦 No unified settings found (nexus_llm_settings is empty)');
        }

        // Check legacy settings
        console.log('\n📜 Legacy Settings:');
        const legacyProvider = localStorage.getItem('ai_provider');
        const legacyKey = localStorage.getItem('ai_api_key');
        if (legacyProvider) {
            console.log('  Provider:', legacyProvider);
        }
        if (legacyKey) {
            console.log('  API Key:', legacyKey.substring(0, 12) + '...' + legacyKey.substring(legacyKey.length - 4));
        }

        console.log('\n💡 Tips:');
        console.log('  - OpenAI keys should start with "sk-" (NOT "sk-ant-")');
        console.log('  - Claude keys should start with "sk-ant-"');
        console.log('  - If keys look wrong, delete them in Settings and re-enter');
        console.log('  - To reset: localStorage.clear() then reload page');
        console.log('\n=== END DEBUG ===');
    } catch (e) {
        console.error('Error debugging API keys:', e);
    }
};

console.log('💡 Tip: Run window.debugAPIKeys() in console to check your stored API keys');

/* =====================================================================
   SPICY MODE — Refresh UI when spicy toggle changes
   ===================================================================== */
if (window.NEXUS_SPICY) {
    window.NEXUS_SPICY.onChange(function () {
        // Refresh Pose Studio panel (re-filters NAV_PRESETS)
        if (window.poseStudioPanel && typeof window.poseStudioPanel.refresh === 'function') {
            window.poseStudioPanel.refresh();
        }
        // Show/hide adult optgroup in settings VR pose dropdown
        var adultGroup = document.getElementById('vr-pose-adult-group');
        if (adultGroup) {
            adultGroup.style.display = window.NEXUS_SPICY.isEnabled() ? '' : 'none';
        }
        // Refresh talk style dropdown if present in Pose Studio
        var talkSelect = document.getElementById('poseTalkStyleSelect');
        if (talkSelect && window.NEXUS_ANIMATION_MANAGER) {
            var styles = window.NEXUS_ANIMATION_MANAGER.getTalkStyles();
            talkSelect.innerHTML = '';
            for (var i = 0; i < styles.length; i++) {
                var opt = document.createElement('option');
                opt.value = styles[i].id;
                opt.textContent = styles[i].label;
                talkSelect.appendChild(opt);
            }
        }
        console.log('[main] Spicy mode changed:', window.NEXUS_SPICY.isEnabled() ? 'ON' : 'OFF');
    });
}
