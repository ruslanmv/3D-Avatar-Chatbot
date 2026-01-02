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
   Speech Settings (persisted)
   ========================================================= */
const SpeechSettings = {
    lang: localStorage.getItem('speech_lang') || 'en-US',
    voiceURI: localStorage.getItem('speech_voice_uri') || '',
    voicePref: localStorage.getItem('speech_voice_pref') || 'any', // any|female|male
    rate: parseFloat(localStorage.getItem('speech_rate') || '0.9'),
    pitch: parseFloat(localStorage.getItem('speech_pitch') || '1.0'),
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
const config = {
    provider: localStorage.getItem('ai_provider') || 'none',
    apiKey: localStorage.getItem('ai_api_key') || '',
    model: localStorage.getItem('ai_model') || '',
    systemPrompt:
        localStorage.getItem('system_prompt') ||
        'You are a helpful AI assistant named Nexus. You are friendly, professional, and knowledgeable.',
    watsonxProjectId: localStorage.getItem('watsonx_project_id') || '',
    baseUrl: localStorage.getItem('base_url') || '',
};

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
   Avatar Manifest Loader
   ========================================================= */
async function loadAvatarManifest() {
    try {
        const res = await fetch(AVATAR_MANIFEST_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status} ${res.statusText}`);

        const data = await res.json();
        const basePath = (data && data.basePath) || '/vendor/avatars';
        const items = (data && data.items) || [];

        if (!Array.isArray(items)) throw new Error('Manifest format invalid: items must be an array');

        avatarBasePath = basePath.replace(/\/$/, '');
        avatarItems = items
            .filter((x) => x && x.file)
            .map((x) => ({
                name: x.name || x.file,
                file: x.file,
                url: `${avatarBasePath}/${x.file}`,
            }));

        populateAvatarSelect(avatarItems);
        window.__AVATAR_ITEMS__ = avatarItems; // expose to module bridge
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

    const direction = new THREE.Vector3(1, 0.6, 1).normalize();
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
function waitForViewerEngineReady(timeoutMs = 8000) {
    if (window.__NEXUS_VIEWER_READY__) {
        const p = window.__NEXUS_VIEWER_READY__;
        const t = new Promise((_, reject) => setTimeout(() => reject(new Error('ViewerEngine not ready')), timeoutMs));
        return Promise.race([p, t]).then(() => true);
    }

    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function tick() {
            if (window.NEXUS_VIEWER && typeof window.NEXUS_VIEWER.loadAvatar === 'function') return resolve(true);
            if (Date.now() - start > timeoutMs) return reject(new Error('ViewerEngine not ready'));
            setTimeout(tick, 50);
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
                await waitForViewerEngineReady(8000);
                await window.NEXUS_VIEWER.loadAvatar(url);

                /* NEXUS_PATCH_LIFE_ENGINE_REGISTER_VIEWER */
                try {
                    const root = window.NEXUS_VIEWER?.currentRoot || null;
                    const hasClips = Array.isArray(window.NEXUS_VIEWER?.clips) && window.NEXUS_VIEWER.clips.length > 0;
                    window.NEXUS_PROCEDURAL_ANIMATOR?.registerAvatar?.(root, hasClips);
                } catch (_) {}
                stopLoaderWatchdog();
                hideLoading();
                setStatus('idle', 'READY');
                const hint = document.getElementById('viewport-hint');
                if (hint) hint.classList.add('hidden');
                console.log(`[Nexus] Avatar loaded (viewer-engine):`, url);
            } catch (e) {
                stopLoaderWatchdog();
                console.error(e);
                showLoading('Viewer engine not ready / failed to load avatar. See console.');
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
            } catch (_) {}
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
    if (avatarItems && avatarItems.length > 0) {
        loadAvatar(avatarItems[0].url, 'manifest(default)');
    } else {
        showLoading('No avatars found in manifest. Upload a .glb/.gltf to test.');
        setStatus('idle', 'READY');
    }
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

    // Filter by language base to keep list relevant
    const filtered = voices.filter((v) => (v.lang || '').toLowerCase().startsWith(base));
    const list = filtered.length ? filtered : voices;

    voiceEl.innerHTML = `<option value="">Auto (best match)</option>`;
    for (const v of list) {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = `${v.name} — ${v.lang}`;
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
   UI / Events
   ============================ */
function setEmotionPressed(btn) {
    document.querySelectorAll('.emotion-btn').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    if (btn) btn.setAttribute('aria-pressed', 'true');
}

function setupEventListeners() {
    const avatarSelect = $('avatar-select');
    if (avatarSelect) {
        avatarSelect.addEventListener('change', (e) => {
            const idx = parseInt(e.target.value, 10);
            if (!Number.isFinite(idx)) return;
            if (!avatarItems[idx]) return;
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

            if (ext !== 'glb' && ext !== 'gltf') {
                showMessage('Please upload a .glb or .gltf file', 'error');
                e.target.value = '';
                return;
            }

            if (ext === 'gltf') {
                showMessage(
                    'Warning: .gltf files with external assets may not load correctly. .glb is recommended.',
                    'warning'
                );
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

            /* NEXUS_PATCH_LIFE_ENGINE_EMOTION_MODE */
            try {
                // Match your UI labels: IDLE/HAPPY/THINKING/DANCE/TALK
                window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.(emotion, 1600);
            } catch (_) {}
            const mapped = Object.keys(animations).find((k) => k.includes(emotion)) || findIdleAnimation();
            if (mapped) playAnimation(mapped, false);

            const emotionActive = $('emotion-active');
            if (emotionActive) emotionActive.textContent = emotion.toUpperCase();

            setEmotionPressed(btn);
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

function openSettings() {
    const modal = $('settings-modal');
    if (!modal) return;

    // Load config + speech settings into UI whenever settings opens
    loadConfigIntoUI();
    loadSpeechSettingsIntoUI();
    refreshVoiceList();

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
function updateProviderFields() {
    const selected = document.querySelector('input[name="provider"]:checked');
    const provider = selected ? selected.value : 'none';

    const modelSelect = $('model-select');
    const watsonxRow = $('watsonx-project-row');
    const baseurlRow = $('baseurl-row');

    if (!modelSelect) return;
    modelSelect.innerHTML = '<option value="">Select a model...</option>';

    if (provider === 'watsonx') {
        if (watsonxRow) watsonxRow.style.display = 'block';
        if (baseurlRow) baseurlRow.style.display = 'block';

        [
            'meta-llama/llama-3-70b-instruct',
            'meta-llama/llama-3-8b-instruct',
            'ibm/granite-13b-chat-v2',
            'mistralai/mixtral-8x7b-instruct-v01',
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

    if (provider === 'openai') {
        ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'].forEach((m) => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m.toUpperCase();
            modelSelect.appendChild(opt);
        });
    } else if (provider === 'claude') {
        [
            'claude-3-5-sonnet-20241022',
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307',
        ].forEach((m) => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m.toUpperCase().replace(/-/g, ' ');
            modelSelect.appendChild(opt);
        });
    }
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

    const apiKey = ($('api-key') && $('api-key').value) || '';
    const model = ($('model-select') && $('model-select').value) || '';
    const systemPrompt = ($('system-prompt') && $('system-prompt').value) || config.systemPrompt;
    const watsonxProjectId = ($('watsonx-project-id') && $('watsonx-project-id').value) || '';
    const baseUrl = ($('base-url') && $('base-url').value) || '';

    if (provider !== 'none' && !apiKey) return showMessage('Please enter an API key', 'error');
    if (provider !== 'none' && !model) return showMessage('Please select a model', 'error');

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

    // ✅ Persist speech settings
    saveSpeechSettingsFromUI();

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
    setStatus('listening', 'THINKING...');

    try {
        const response = config.provider === 'none' ? getSimpleResponse(text) : await callLLM(text);
        addMessageToHistory('avatar', response);
        speakText(response);
    } catch (error) {
        logError('Error processing message', error);
        addMessageToHistory('avatar', 'Sorry, I encountered an error. Please check your settings.');
        setStatus('idle', 'ERROR');
        setTimeout(() => setStatus('idle', 'READY'), 2000);
    }
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
    if (config.provider === 'openai') return callOpenAI(userMessage);
    if (config.provider === 'claude') return callClaude(userMessage);
    if (config.provider === 'watsonx') return callWatsonX(userMessage);
    return 'Provider not configured.';
}

/* ============================
   Speech
   ============================ */
function speakText(text) {
    setStatus('speaking', 'SPEAKING...');

    /* NEXUS_PATCH_LIFE_ENGINE_TALK_MODE */
    try {
        window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.('talk', 30000);
    } catch (_) {}
    try {
        window.NEXUS_VIEWER?.playAnimationByName?.('Talk');
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

    // ✅ Apply settings
    utterance.lang = SpeechSettings.lang;
    utterance.rate = SpeechSettings.rate;
    utterance.pitch = SpeechSettings.pitch;

    // Use smart voice picker (handles specific selection or auto-best-match)
    const v = pickBestVoice();
    if (v) utterance.voice = v;

    utterance.onend = () => {
        /* NEXUS_PATCH_LIFE_ENGINE_TALK_END */
        try {
            window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.('idle', 1);
        } catch (_) {}
        setStatus('idle', 'READY');
        try {
            window.NEXUS_VIEWER?.playAnimationByName?.('Idle');
        } catch (_) {}
    };

    utterance.onerror = () => {
        /* NEXUS_PATCH_LIFE_ENGINE_TALK_ERR */
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
    recognition.interimResults = false;

    recognition.onstart = () => {
        isListening = true;
        setStatus('listening', 'LISTENING...');
        try {
            window.NEXUS_VIEWER?.playAnimationByName?.('Idle');
        } catch (_) {}

        const btn = $('listen-btn');
        if (btn) btn.classList.add('active');
        if ($('voice-btn-text')) $('voice-btn-text').textContent = 'LISTENING...';
        if ($('recognition-status')) $('recognition-status').textContent = 'Listening to your voice...';
        if (btn) btn.setAttribute('aria-pressed', 'true');
    };

    recognition.onresult = (event) => {
        const transcript =
            (event && event.results && event.results[0] && event.results[0][0] && event.results[0][0].transcript) || '';
        if ($('speech-text')) $('speech-text').value = transcript;
        if (transcript) handleUserMessage(transcript);
    };

    recognition.onerror = (event) => {
        logError('Speech recognition error', event && event.error);
        stopVoiceInput();
    };

    recognition.onend = () => stopVoiceInput();
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
    if (btn) btn.classList.remove('active');
    if ($('voice-btn-text')) $('voice-btn-text').textContent = 'ACTIVATE VOICE';
    if ($('recognition-status')) $('recognition-status').textContent = 'Voice system standby';
    if (btn) btn.setAttribute('aria-pressed', 'false');

    if (recognition) {
        try {
            recognition.stop();
        } catch (_) {}
    }
}

/* ============================
   Chat UI
   ============================ */
function addMessageToHistory(sender, text) {
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
    chatHistory.appendChild(messageDiv);

    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function clearHistory() {
    const chatHistory = $('chat-history');
    if (!chatHistory) return;
    chatHistory.innerHTML = `
    <div class="empty-state">
      <p>System Log Ready.</p>
      <p class="sub-text">All transmissions will be recorded here.</p>
    </div>`;
}

function showMessage(text, type) {
    const notification = document.createElement('div');
    notification.textContent = text;

    const bg = type === 'error' ? '#ff5252' : type === 'success' ? '#00ff88' : '#00e5ff';
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
   Init
   ============================ */
async function init() {
    showLoading('Loading 3D Avatar...');
    setStatus('idle', 'BOOTING...');

    const useViewerEngine = !!window.__USE_GLTF_VIEWER_ENGINE__;

    if (!useViewerEngine) {
        if (!vendorAssertOrAbort()) return;
    }

    try {
        if (!useViewerEngine) {
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
        initSpeechRecognition();
        loadConfigIntoUI();
        loadSpeechSettingsIntoUI();
        refreshVoiceList(); // initial attempt

        await loadAvatarManifest();
        loadDefaultAvatarFromManifest();
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
