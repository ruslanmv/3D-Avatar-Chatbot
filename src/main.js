/**
 * Nexus Avatar - Main Application Controller (PROD, GLOBAL build) — FIXED
 *
 * Fixes implemented:
 * ✅ Auto-center + auto-frame avatar (prevents bottom cropping / off-center framing)
 * ✅ Removes hardcoded scale/position hacks that caused cropping
 * ✅ Proper resize handling bound to viewport size (not just window)
 * ✅ Adds floor reference plane for depth + “not floating” feel
 * ✅ Adds Reset View + Auto Frame buttons support (if present in index.html)
 * ✅ Improves emotion button pressed-state + status text hooks (if present)
 *
 * - NO ES module imports
 * - Expects vendor scripts in index.html:
 *     THREE (global)
 *     OrbitControls + GLTFLoader (legacy examples/js)
 */

'use strict';

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

/* =========================================================
   LocalStorage keys for persistence
   ========================================================= */
const STORAGE_KEYS = {
    CHAT_HISTORY: 'nexus_chat_history',
    LAST_AVATAR: 'nexus_last_avatar',
};

/** Framing state */
let lastFrameFitOffset = 1.35;

/** Scene helpers */
let floorMesh = null;
let dirLight = null;

/* ============================
   Configuration & LLM Manager
   ============================ */
let llmManager = null;

// Initialize LLMManager when available
function initLLMManager() {
    if (typeof window.LLMManager !== 'undefined') {
        llmManager = new window.LLMManager();
        console.log('[Nexus] LLMManager initialized');
    } else {
        console.warn('[Nexus] LLMManager not loaded yet');
    }
}

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
}

/* =========================================================
   Avatar positioning helpers
   ========================================================= */

/**
 * Places the avatar so its lowest point sits at the specified floor height.
 * This prevents the model from being cut off by the floor plane.
 * @param {THREE.Object3D} avatarRoot - The loaded avatar object
 * @param {number} floorY - The Y coordinate of the floor (default: 0)
 * @returns {object} Object containing bounding box and size information
 */
function placeAvatarOnFloor(avatarRoot, floorY = 0) {
    const box = new THREE.Box3().setFromObject(avatarRoot);
    const size = box.getSize(new THREE.Vector3());
    const minY = box.min.y;

    // Move avatar so the lowest point touches the floor
    avatarRoot.position.y += floorY - minY;

    return { box, size };
}

/* =========================================================
   Camera framing — THE BIG FIX
   ========================================================= */
function frameObjectToCamera(object, fitOffset = 1.35) {
    if (!object || !camera) return;

    // Compute bounding box
    const box = new THREE.Box3().setFromObject(object);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Recenter model to origin
    object.position.sub(center);

    // Recompute after recenter
    const box2 = new THREE.Box3().setFromObject(object);
    const size2 = box2.getSize(new THREE.Vector3());
    const center2 = box2.getCenter(new THREE.Vector3());

    const maxSize = Math.max(size2.x, size2.y, size2.z);
    const fitHeightDistance = maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)));
    const fitWidthDistance = fitHeightDistance / camera.aspect;
    const distance = fitOffset * Math.max(fitHeightDistance, fitWidthDistance);

    // Nice diagonal view direction
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

    // Place floor just below the model
    if (floorMesh) {
        const worldBox = new THREE.Box3().setFromObject(object);
        const yMin = worldBox.min.y;
        floorMesh.position.y = yMin - 0.02;
    }

    // Keep for buttons
    lastFrameFitOffset = fitOffset;
}

function resetView() {
    if (!camera || !controls) return;
    camera.position.set(0, 1.5, 3);
    controls.target.set(0, 1, 0);
    controls.update();

    // If avatar exists, framing is usually better than a hard reset
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

    // Lighting
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

    // Floor reference plane (helps "floating in void" issue)
    floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 50),
        new THREE.MeshStandardMaterial({ color: 0x0b1f2b, roughness: 1, metalness: 0 })
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -1;
    floorMesh.receiveShadow = true;

    // Prevent floor from hiding avatar (depth buffer fix)
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

    // Resize both on window changes and on viewport size changes
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
function loadAvatar(url, source) {
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

    // Revoke previous blob URL if it exists and is different from the new one
    if (currentObjectURL && currentObjectURL !== url) {
        URL.revokeObjectURL(currentObjectURL);
        currentObjectURL = null;
    }

    // Store new blob URL if this is an upload
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

            // Remove old "hacky" transforms that caused cropping:
            // currentAvatar.scale.set(1.5, 1.5, 1.5);
            // currentAvatar.position.y = -1;

            // Ensure shadows and render order
            currentAvatar.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    // Ensure avatar renders after floor to prevent clipping
                    child.renderOrder = 1;
                }
            });

            // Place avatar on floor to prevent clipping through ground plane
            placeAvatarOnFloor(currentAvatar, 0);

            // Auto-center + auto-frame (the real fix)
            onWindowResize(); // ensure correct aspect first
            frameObjectToCamera(currentAvatar, lastFrameFitOffset);

            // Animations
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

            // Clean up blob URL after error
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

            // Validate file extension - prefer .glb over .gltf
            const fileName = file.name.toLowerCase();
            const ext = fileName.split('.').pop();

            if (ext !== 'glb' && ext !== 'gltf') {
                showMessage('Please upload a .glb or .gltf file', 'error');
                e.target.value = ''; // Reset file input
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

    // Viewport buttons (if present in HTML)
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

    // Support both "active class" and "hidden attribute" styles
    function showModal(modal) {
        if (!modal) return;
        modal.classList.add('active');
        modal.hidden = false;
    }
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

    // Proxy checkbox event listener
    const enableProxyCheckbox = $('enable-proxy');
    if (enableProxyCheckbox) {
        enableProxyCheckbox.addEventListener('change', toggleProxyUrlField);
    }

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
 * Toggle proxy URL input visibility based on checkbox state
 */
function toggleProxyUrlField() {
    const enableProxy = $('enable-proxy');
    const proxyUrlRow = $('proxy-url-row');
    if (enableProxy && proxyUrlRow) {
        proxyUrlRow.style.display = enableProxy.checked ? 'block' : 'none';
    }
}

async function updateProviderFields() {
    const selected = document.querySelector('input[name="provider"]:checked');
    const provider = selected ? selected.value : 'none';

    const modelSelect = $('model-select');
    const watsonxRow = $('watsonx-project-row');
    const baseurlRow = $('baseurl-row');
    const ollamaRow = $('ollama-baseurl-row');

    if (!modelSelect) return;

    // Show/hide provider-specific fields
    if (watsonxRow) watsonxRow.style.display = provider === 'watsonx' ? 'block' : 'none';
    if (baseurlRow) baseurlRow.style.display = provider === 'watsonx' || provider === 'openai' ? 'block' : 'none';
    if (ollamaRow) ollamaRow.style.display = provider === 'ollama' ? 'block' : 'none';

    if (provider === 'none') {
        modelSelect.innerHTML = '<option value="">No AI provider selected</option>';
        return;
    }

    // Show loading state
    modelSelect.innerHTML = '<option value="">Loading models...</option>';
    modelSelect.disabled = true;

    if (!llmManager) {
        modelSelect.innerHTML = '<option value="">LLMManager not initialized</option>';
        return;
    }

    // Temporarily update provider to fetch models
    llmManager.updateSettings({ provider: provider });

    // Fetch models dynamically
    const { models, error } = await llmManager.fetchAvailableModels();

    modelSelect.innerHTML = '';
    modelSelect.disabled = false;

    if (error) {
        console.warn('[Nexus] Model fetch warning:', error);
    }

    const settings = llmManager.getSettings();
    const currentModel = provider === 'watsonx' ? settings.watsonx.model_id : settings[provider]?.model || '';

    models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        if (m === currentModel) opt.selected = true;
        modelSelect.appendChild(opt);
    });
}

function loadConfigIntoUI() {
    if (!llmManager) {
        console.warn('[Nexus] LLMManager not initialized');
        return;
    }

    const settings = llmManager.getSettings();

    const providerRadio = document.querySelector(`input[name="provider"][value="${settings.provider}"]`);
    if (providerRadio) {
        providerRadio.checked = true;
        updateProviderFields();
    }

    const provider = settings.provider;
    if ($('api-key')) $('api-key').value = settings[provider]?.api_key || '';
    if ($('system-prompt')) $('system-prompt').value = settings.system_prompt;
    if ($('watsonx-project-id')) $('watsonx-project-id').value = settings.watsonx?.project_id || '';
    if ($('base-url')) {
        if (provider === 'watsonx') $('base-url').value = settings.watsonx?.base_url || '';
        else if (provider === 'openai') $('base-url').value = settings.openai?.base_url || '';
        else if (provider === 'ollama') $('base-url').value = settings.ollama?.base_url || '';
    }

    // Load proxy settings
    if ($('enable-proxy')) {
        $('enable-proxy').checked = settings.proxy?.enable_proxy || false;
        toggleProxyUrlField();
    }
    if ($('proxy-url')) {
        $('proxy-url').value = settings.proxy?.proxy_url || 'http://localhost:8080';
    }

    // Model will be set by updateProviderFields()
}

function saveSettings() {
    if (!llmManager) {
        return showMessage('LLMManager not initialized', 'error');
    }

    const selected = document.querySelector('input[name="provider"]:checked');
    const provider = selected ? selected.value : 'none';

    const apiKey = ($('api-key') && $('api-key').value) || '';
    const model = ($('model-select') && $('model-select').value) || '';
    const systemPrompt = ($('system-prompt') && $('system-prompt').value) || '';
    const watsonxProjectId = ($('watsonx-project-id') && $('watsonx-project-id').value) || '';
    const baseUrl = ($('base-url') && $('base-url').value) || '';

    if (provider !== 'none' && provider !== 'ollama' && !apiKey) {
        return showMessage('Please enter an API key', 'error');
    }
    if (provider !== 'none' && !model) {
        return showMessage('Please select a model', 'error');
    }

    // Get proxy settings
    const enableProxy = $('enable-proxy') ? $('enable-proxy').checked : false;
    const proxyUrl = $('proxy-url') ? $('proxy-url').value : 'http://localhost:8080';

    // Build updates object based on provider
    const updates = {
        provider: provider,
        system_prompt: systemPrompt,
        proxy: {
            enable_proxy: enableProxy,
            proxy_url: proxyUrl,
        },
    };

    if (provider === 'watsonx') {
        updates.watsonx = {
            api_key: apiKey,
            project_id: watsonxProjectId,
            model_id: model,
            base_url: baseUrl,
        };
    } else if (provider === 'ollama') {
        updates.ollama = {
            base_url: baseUrl || 'http://localhost:11434',
            model: model,
        };
    } else if (provider !== 'none') {
        updates[provider] = {
            api_key: apiKey,
            model: model,
            base_url: baseUrl,
        };
    }

    llmManager.updateSettings(updates);

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
        if (!llmManager) {
            throw new Error('LLMManager not initialized');
        }

        const settings = llmManager.getSettings();
        const response = await llmManager.sendMessage(text, settings.system_prompt);

        addMessageToHistory('avatar', response);
        speakText(response);
    } catch (error) {
        logError('Error processing message', error);
        const errorMsg = error.message || 'Unknown error';
        addMessageToHistory('avatar', `Sorry, I encountered an error: ${errorMsg}. Please check your settings.`);
        setStatus('idle', 'ERROR');
        setTimeout(() => setStatus('idle', 'READY'), 2000);
    }
}

/* Old LLM functions removed - now handled by LLMManager.js */

/* ============================
   Speech
   ============================ */
function speakText(text) {
    setStatus('speaking', 'SPEAKING...');
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.onend = () => setStatus('idle', 'READY');
    window.speechSynthesis.speak(utterance);
}

function initSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        logWarn('Speech recognition not supported in this browser.');
        return;
    }

    recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
        isListening = true;
        setStatus('listening', 'LISTENING...');
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

    // Stop any ongoing text-to-speech when user starts speaking
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
    }

    try {
        recognition.start();
    } catch (e) {
        logError('Error starting recognition', e);
    }
}

function stopVoiceInput() {
    isListening = false;
    setStatus('idle', 'READY');

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
    senderDiv.className = `message-sender ${sender}`;
    senderDiv.textContent = sender === 'user' ? 'YOU' : 'NEXUS';

    // Add timestamp
    const timestamp = document.createElement('span');
    timestamp.className = 'message-timestamp';
    timestamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    timestamp.style.cssText = 'margin-left: 8px; opacity: 0.6; font-size: 0.85em;';
    senderDiv.appendChild(timestamp);

    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.textContent = text;

    messageDiv.appendChild(senderDiv);
    messageDiv.appendChild(textDiv);
    chatHistory.appendChild(messageDiv);

    // Smart scroll: only auto-scroll if user is already near bottom
    const isNearBottom = chatHistory.scrollHeight - chatHistory.scrollTop - chatHistory.clientHeight < 100;
    if (isNearBottom) {
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    // Persist chat history to localStorage
    saveChatHistory();
}

function clearHistory() {
    const chatHistory = $('chat-history');
    if (!chatHistory) return;
    chatHistory.innerHTML = `
    <div class="empty-state">
      <p>System Log Ready.</p>
      <p class="sub-text">All transmissions will be recorded here.</p>
    </div>`;
    // Clear from localStorage
    try {
        localStorage.removeItem(STORAGE_KEYS.CHAT_HISTORY);
    } catch (e) {
        console.warn('Could not clear chat history from localStorage:', e);
    }
}

/**
 * Save current chat history to localStorage
 */
function saveChatHistory() {
    try {
        const chatHistory = $('chat-history');
        if (!chatHistory) return;

        const messages = [];
        chatHistory.querySelectorAll('.chat-message').forEach((msg) => {
            const sender = msg.classList.contains('user') ? 'user' : 'assistant';
            const textEl = msg.querySelector('.message-text');
            const timestampEl = msg.querySelector('.message-timestamp');

            if (textEl) {
                messages.push({
                    sender,
                    text: textEl.textContent,
                    timestamp: timestampEl ? timestampEl.textContent : new Date().toLocaleTimeString(),
                });
            }
        });

        localStorage.setItem(STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(messages));
    } catch (e) {
        console.warn('Could not save chat history to localStorage:', e);
    }
}

/**
 * Restore chat history from localStorage
 */
function restoreChatHistory() {
    try {
        const saved = localStorage.getItem(STORAGE_KEYS.CHAT_HISTORY);
        if (!saved) return;

        const messages = JSON.parse(saved);
        const chatHistory = $('chat-history');
        if (!chatHistory || !Array.isArray(messages)) return;

        // Clear empty state
        const emptyState = chatHistory.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        // Restore messages
        messages.forEach((msg) => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `chat-message ${msg.sender}`;

            const senderDiv = document.createElement('div');
            senderDiv.className = `message-sender ${msg.sender}`;
            senderDiv.textContent = msg.sender === 'user' ? 'YOU' : 'NEXUS';

            // Add timestamp
            const timestamp = document.createElement('span');
            timestamp.className = 'message-timestamp';
            timestamp.textContent = msg.timestamp;
            timestamp.style.cssText = 'margin-left: 8px; opacity: 0.6; font-size: 0.85em;';
            senderDiv.appendChild(timestamp);

            const textDiv = document.createElement('div');
            textDiv.className = 'message-text';
            textDiv.textContent = msg.text;

            messageDiv.appendChild(senderDiv);
            messageDiv.appendChild(textDiv);
            chatHistory.appendChild(messageDiv);
        });

        // Scroll to bottom
        chatHistory.scrollTop = chatHistory.scrollHeight;

        console.log(`[Nexus] Restored ${messages.length} messages from chat history`);
    } catch (e) {
        console.warn('Could not restore chat history from localStorage:', e);
    }
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

    if (!vendorAssertOrAbort()) return;

    try {
        // Initialize LLM Manager first
        initLLMManager();

        setupThreeJS();
        setupEventListeners();
        setupModals();
        initSpeechRecognition();
        loadConfigIntoUI();

        // Restore chat history from previous session
        restoreChatHistory();

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
