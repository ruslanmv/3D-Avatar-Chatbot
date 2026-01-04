/**
 * VR Chat Panel Module (Quest 3 Styled + Shared Desktop Settings)
 * ------------------------------------------------------------------------
 * GOALS (your request):
 * 1) VR uses the SAME settings as Desktop (provider/model/apiKey/baseUrl/systemPrompt, speech prefs, etc.).
 * - We read/write from the same localStorage keys your desktop UI already uses.
 * - No separate VR-only settings menu is required; VR toggles are mirrors of Desktop settings.
 *
 * 2) Quest 3 friendly visuals:
 * - Remove neon/outer borders (no "frame" box).
 * - Soft glass card, subtle header handle, big readable type.
 * - No hard cyan outlines everywhere.
 *
 * 3) Drag works reliably:
 * - Always draggable via top handle (no pinned logic needed).
 * - Comfortable distance clamp for Quest.
 *
 * IMPORTANT:
 * - You MUST call panel.syncFromDesktopSettings() once after desktop settings load/save,
 * OR call it every time you open the VR panel.
 * - If you already have a settings save event in your desktop code, call:
 * vrChatPanel.syncFromDesktopSettings();
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

export class VRChatPanel {
    constructor({ scene, camera, controller }) {
        if (!scene || !camera) throw new Error('[VRChatPanel] scene and camera are required');

        this.scene = scene;
        this.camera = camera;
        this.leftController = controller || null;

        // -----------------------
        // State
        // -----------------------
        this.mode = 'chat'; // 'chat' | 'settings' (settings here is just toggles + avatar nav)
        this.status = 'idle';
        this.messages = [];
        this.avatars = [];
        this.currentAvatarIndex = 0;

        // Speech-to-text transcript display
        this.transcript = '';
        this.transcriptMode = 'idle'; // 'idle' | 'interim' | 'final'

        // Mirrors desktop settings (synced via localStorage)
        this.settings = this._defaultSettings();

        // VR toggles mirror desktop speech toggles
        this.sttEnabled = true;
        this.ttsEnabled = true;

        // -----------------------
        // Voice Settings (VR UI State)
        // -----------------------
        this.availableVoices = [];
        this.currentVoiceIndex = 0;
        this.voiceGenderFilter = 'any'; // 'any' | 'male' | 'female'
        this.voiceRate = 0.9;
        this.voicePitch = 1.0;
        this._voicesLoaded = false;

        // -----------------------
        // Drag & Position Logic (Quest-like)
        // -----------------------
        this._isDragging = false;
        this._dragOffset = new THREE.Vector3();
        this._tmpCamPos = new THREE.Vector3();
        this._tmpVec3 = new THREE.Vector3();

        // Comfortable range for Quest 3 (meters)
        this._minDistance = 0.32;
        this._maxDistance = 1.65;
        this._spawnDistance = 0.55;

        // -----------------------
        // Physical Dimensions
        // -----------------------
        this.panelWidth = 0.56;
        this.panelHeight = 0.36;

        // -----------------------
        // Canvas Setup (bigger text, Quest friendly)
        // -----------------------
        this.canvasW = 1800;
        this.canvasH = 1080;
        this.padding = 44;

        this.canvas = document.createElement('canvas');
        this.canvas.width = this.canvasW;
        this.canvas.height = this.canvasH;
        this.ctx = this.canvas.getContext('2d', { alpha: true });

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.generateMipmaps = true;
        this.texture.anisotropy = 8;
        this.texture.needsUpdate = true;

        // -----------------------
        // 3D Mesh (no borders, soft glass)
        // -----------------------
        this.group = new THREE.Group();
        this.group.name = 'VRChatPanel';

        const geo = new THREE.PlaneGeometry(this.panelWidth, this.panelHeight);
        const mat = new THREE.MeshBasicMaterial({
            map: this.texture,
            transparent: true,
            opacity: 1.0,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true,
        });

        this.panelMesh = new THREE.Mesh(geo, mat);
        this.panelMesh.name = 'PanelSurface';
        this.panelMesh.renderOrder = 900;
        this.group.add(this.panelMesh);

        // -----------------------
        // Interaction
        // -----------------------
        this.interactables = [];
        this.buttons = {};

        // Quest-like minimal theme (no outer border)
        this.theme = {
            // soft dark glass
            bgTop: 'rgba(16, 18, 22, 0.92)',
            bgBot: 'rgba(10, 11, 14, 0.92)',
            shadow: 'rgba(0,0,0,0.35)',
            header: 'rgba(255,255,255,0.06)',
            handlePill: 'rgba(255,255,255,0.10)',
            text: 'rgba(255,255,255,0.96)',
            textDim: 'rgba(255,255,255,0.72)',
            accent: 'rgba(120, 220, 255, 0.95)',

            chipBg: 'rgba(255,255,255,0.06)',
            chipText: 'rgba(255,255,255,0.92)',

            btnBg: 'rgba(255,255,255,0.08)',
            btnBgHot: 'rgba(120, 220, 255, 0.18)',
            dangerBg: 'rgba(255, 80, 80, 0.18)',
        };

        this._layout = this._computeLayout();
        this._createHitboxes();

        this.group.visible = false;
        this.scene.add(this.group);

        // Initial sync from desktop settings (safe even if empty)
        this.syncFromDesktopSettings();

        // ✅ Auto-refresh if desktop settings change while panel is open (e.g. from another tab)
        this._onStorage = (e) => {
            const k = e.key;

            // Unified LLM settings used by VR panel (provider/model/apiKey/baseUrl/system prompt)
            if (k === 'nexus_llm_settings') {
                this.syncFromDesktopSettings();
                return;
            }

            // Speech settings live here in your code
            if (k === 'nexus_settings_v1') {
                this.syncFromDesktopSettings();
                return;
            }

            // Legacy compatibility keys (only if some older UI writes them)
            if (
                k === 'ai_provider' ||
                k === 'ai_model' ||
                k === 'ai_api_key' ||
                k === 'openai_model' || // very old desktop demo
                k === 'openai_api_key' // very old desktop demo
            ) {
                this.syncFromDesktopSettings();
                return;
            }
        };

        window.addEventListener('storage', this._onStorage);

        this.redraw();
    }

    // =====================================================================
    // SETTINGS SYNC (DESKTOP <-> VR)
    // =====================================================================

    /**
     * Reads your desktop settings from localStorage and mirrors them into VR.
     * Call this:
     * - when entering VR
     * - after saving settings on desktop
     */
    syncFromDesktopSettings() {
        const s = this._loadDesktopSettings();
        if (s) this.settings = { ...this.settings, ...s };

        // NEW: ensure avatar selection is applied whenever we sync
        this._syncAvatarSelectionFromStorage();

        // Mirror common toggles (speech)
        this.sttEnabled = !!this.settings.sttEnabled;
        this.ttsEnabled = !!this.settings.ttsEnabled;

        // ✅ Load voice settings from desktop
        this.voiceGenderFilter = this.settings.speechVoicePref || 'any';
        this.voiceRate = this.settings.speechRate || 0.9;
        this.voicePitch = this.settings.speechPitch || 1.0;

        // ✅ Load and filter voices, then try to match the saved voice
        this._loadAndFilterVoices();
        this._matchSavedVoice();

        this.redraw();
    }

    /**
     * When VR toggles STT/TTS, we write back to desktop storage so desktop UI stays consistent.
     */
    _writeSpeechTogglesToDesktop() {
        const merged = { ...this._loadDesktopSettings(), ...this.settings };
        merged.sttEnabled = !!this.sttEnabled;
        merged.ttsEnabled = !!this.ttsEnabled;
        this._saveDesktopSettings(merged);
    }

    _defaultSettings() {
        return {
            provider: 'none',
            apiKey: '',
            baseUrl: '',
            model: '',
            watsonxProjectId: '',
            systemPrompt:
                'You are a helpful AI assistant named Nexus. You are friendly, professional, and knowledgeable.',
            speechLang: 'en-US',
            speechVoicePref: 'any',
            speechVoice: '',
            speechRate: 0.9,
            speechPitch: 1.0,
            sttEnabled: true,
            ttsEnabled: true,
        };
    }

    /**
     * IMPORTANT:
     * Reads from unified LLM settings (nexus_llm_settings) which is shared between
     * desktop and VR. Falls back to legacy keys for backward compatibility.
     */
    _desktopStorageKey() {
        return 'nexus_llm_settings'; // Unified LLM settings key
    }

    _loadDesktopSettings() {
        try {
            // 1) FIRST: Try unified LLM settings (shared with desktop LLMManager)
            const unifiedRaw = localStorage.getItem('nexus_llm_settings');
            if (unifiedRaw) {
                const unified = JSON.parse(unifiedRaw);

                // Extract provider-specific settings from unified format
                let apiKey = '';
                let model = '';
                let baseUrl = '';
                let watsonxProjectId = '';

                if (unified.provider === 'openai' && unified.openai) {
                    apiKey = unified.openai.api_key || '';
                    model = unified.openai.model || 'gpt-4o';
                    baseUrl = unified.openai.base_url || '';
                } else if (unified.provider === 'claude' && unified.claude) {
                    apiKey = unified.claude.api_key || '';
                    model = unified.claude.model || 'claude-3-5-sonnet-20241022';
                    baseUrl = unified.claude.base_url || '';
                } else if (unified.provider === 'watsonx' && unified.watsonx) {
                    apiKey = unified.watsonx.api_key || '';
                    model = unified.watsonx.model_id || 'ibm/granite-13b-chat-v2';
                    baseUrl = unified.watsonx.base_url || '';
                    watsonxProjectId = unified.watsonx.project_id || '';
                } else if (unified.provider === 'ollama' && unified.ollama) {
                    model = unified.ollama.model || 'llama3';
                    baseUrl = unified.ollama.base_url || '';
                }

                // ✅ Also load speech settings from nexus_settings_v1
                let speechSettings = {};
                // FIX: Define speechRaw in outer scope so it can be logged later
                let speechRaw = null;
                try {
                    speechRaw = localStorage.getItem('nexus_settings_v1');
                    if (speechRaw) {
                        const speech = JSON.parse(speechRaw);
                        speechSettings = {
                            speechLang: speech.speechLang || this._defaultSettings().speechLang,
                            speechVoice: speech.speechVoice || this._defaultSettings().speechVoice,
                            speechVoiceURI: speech.speechVoiceURI || '',
                            speechVoicePref: speech.speechVoicePref || this._defaultSettings().speechVoicePref,
                            speechRate: speech.speechRate || this._defaultSettings().speechRate,
                            speechPitch: speech.speechPitch || this._defaultSettings().speechPitch,
                            sttEnabled: typeof speech.sttEnabled === 'boolean' ? speech.sttEnabled : true,
                            ttsEnabled: typeof speech.ttsEnabled === 'boolean' ? speech.ttsEnabled : true,
                        };
                    }
                } catch (e) {
                    console.warn('[VRChatPanel] Failed to load speech settings:', e);
                }

                // ✅ Enhanced debug logging for speech settings
                console.log('[VRChatPanel] 📥 Loaded TTS settings from nexus_settings_v1:', {
                    voiceName: speechSettings.speechVoice || '(empty)',
                    voiceURI: speechSettings.speechVoiceURI?.slice(0, 50) || '(empty)',
                    preference: speechSettings.speechVoicePref || 'any',
                    rate: speechSettings.speechRate,
                    pitch: speechSettings.speechPitch,
                    ttsEnabled: speechSettings.ttsEnabled,
                    rawDataExists: !!speechRaw, // Now accessing the variable declared above
                });
                console.log('[VRChatPanel] Loaded unified settings:', {
                    provider: unified.provider,
                    model: model,
                    speech: speechSettings.speechVoice || 'auto',
                });

                return {
                    provider: unified.provider || 'none',
                    apiKey: apiKey,
                    model: model,
                    baseUrl: baseUrl,
                    watsonxProjectId: watsonxProjectId,
                    systemPrompt: unified.system_prompt || this._defaultSettings().systemPrompt,
                    ...speechSettings,
                };
            }

            // 2) SECOND: Try legacy individual keys (backward compatibility)
            const legacyProvider = localStorage.getItem('ai_provider');
            if (legacyProvider) {
                console.log('[VRChatPanel] Loaded legacy settings:', { provider: legacyProvider });
                return {
                    provider: legacyProvider || 'none',
                    apiKey: localStorage.getItem('ai_api_key') || '',
                    model: localStorage.getItem('ai_model') || '',
                    baseUrl: localStorage.getItem('base_url') || '',
                    watsonxProjectId: localStorage.getItem('watsonx_project_id') || '',
                    systemPrompt: localStorage.getItem('system_prompt') || this._defaultSettings().systemPrompt,
                };
            }

            // 3) THIRD: Try old nexus_settings_v1 (speech-only, but check anyway)
            const oldRaw = localStorage.getItem('nexus_settings_v1');
            if (oldRaw) {
                const parsed = JSON.parse(oldRaw);
                // Only use if it has LLM settings (rare)
                if (parsed.provider && parsed.provider !== 'none') {
                    console.log('[VRChatPanel] Loaded old settings:', { provider: parsed.provider });
                    return parsed;
                }
            }

            console.log('[VRChatPanel] No settings found, using defaults');
            return null;
        } catch (e) {
            console.warn('[VRChatPanel] Failed to load desktop settings:', e);
            return null;
        }
    }

    _saveDesktopSettings(obj) {
        try {
            localStorage.setItem(this._desktopStorageKey(), JSON.stringify(obj));
        } catch (_) {}
    }

    // --- Avatar selection persistence (Desktop <-> VR) ---
    _avatarStorageKey() {
        return 'nexus_selected_avatar_name';
    }

    _loadSelectedAvatarName() {
        return (
            localStorage.getItem(this._avatarStorageKey()) ||
            localStorage.getItem('selected_avatar_name') ||
            localStorage.getItem('selected_avatar') ||
            ''
        );
    }

    _saveSelectedAvatarName(name) {
        try {
            localStorage.setItem(this._avatarStorageKey(), String(name || ''));
        } catch (_) {}
    }

    _syncAvatarSelectionFromStorage() {
        const selectedName = this._loadSelectedAvatarName();
        if (!selectedName || !Array.isArray(this.avatars) || !this.avatars.length) return;

        const idx = this.avatars.findIndex((a) => (a?.name || '') === selectedName);
        if (idx >= 0) {
            this.currentAvatarIndex = idx;
        }
    }

    // =====================================================================
    // UPDATE (required by engine; we keep it minimal)
    // =====================================================================

    update() {
        // Nothing required. Dragging is driven externally via beginDrag/dragTo/endDrag.
    }

    // =====================================================================
    // DRAGGING
    // =====================================================================

    beginDrag(hitPointWorld) {
        if (!hitPointWorld) return false;
        this._isDragging = true;
        this._dragOffset.copy(this.group.position).sub(hitPointWorld);
        return true;
    }

    dragTo(hitPointWorld) {
        if (!this._isDragging || !hitPointWorld) return;

        const targetPos = this._tmpVec3.copy(hitPointWorld).add(this._dragOffset);

        // Clamp distance
        this.camera.getWorldPosition(this._tmpCamPos);
        const dist = targetPos.distanceTo(this._tmpCamPos);
        const clamped = THREE.MathUtils.clamp(dist, this._minDistance, this._maxDistance);

        const dir = targetPos.sub(this._tmpCamPos).normalize();
        this.group.position.copy(this._tmpCamPos).add(dir.multiplyScalar(clamped));

        // Face user while dragging (Quest-like)
        this.group.lookAt(this._tmpCamPos);
    }

    endDrag() {
        this._isDragging = false;
    }

    /**
     * Kept for compatibility with your integration.
     * We don't "pin" in this Quest-like panel: always draggable using handle.
     */
    togglePinned() {
        // No pin concept here; return false to signal "movable".
        this.redraw();
        return false;
    }

    setVisible(v) {
        const visible = !!v;
        this.group.visible = visible;

        console.log('[VRChatPanel] 👁️ Panel visibility:', visible);

        if (!visible) {
            this._isDragging = false;
            return;
        }

        // Sync settings before showing, so VR matches desktop immediately
        this.syncFromDesktopSettings();

        this._spawnNearLeftHandOnce(this._spawnDistance);
        this.redraw();

        // Log final position and distance to camera for debugging
        const camPos = new THREE.Vector3();
        this.camera.getWorldPosition(camPos);
        const dist = this.group.position.distanceTo(camPos);
        console.log('[VRChatPanel] ✅ Panel visible at world position:', this.group.position.toArray());
        console.log('[VRChatPanel] 📏 Distance to camera:', dist.toFixed(2), 'm');
    }

    setLeftController(controller) {
        this.leftController = controller;
    }

    _spawnNearLeftHandOnce(dist = 0.55) {
        const camPos = new THREE.Vector3();
        const camQuat = new THREE.Quaternion();
        this.camera.getWorldPosition(camPos);
        this.camera.getWorldQuaternion(camQuat);

        // Spawn in front of camera (comfortable)
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat).multiplyScalar(dist);
        const down = new THREE.Vector3(0, -1, 0).applyQuaternion(camQuat).multiplyScalar(0.05);
        this.group.position.copy(camPos).add(fwd).add(down);
        this.group.quaternion.copy(camQuat);

        // If controller exists, bias towards it slightly (still comfortable)
        if (this.leftController) {
            // Update world matrix to ensure latest transforms
            this.leftController.updateWorldMatrix(true, false);

            // Use WORLD coordinates instead of local
            const ctrlWorldPos = new THREE.Vector3();
            const ctrlWorldQuat = new THREE.Quaternion();
            this.leftController.getWorldPosition(ctrlWorldPos);
            this.leftController.getWorldQuaternion(ctrlWorldQuat);

            // Check if position is valid (not NaN or zero)
            if (isFinite(ctrlWorldPos.x) && isFinite(ctrlWorldPos.y) && isFinite(ctrlWorldPos.z)) {
                console.log('[VRChatPanel] 🎯 Spawning from left controller world position:', ctrlWorldPos.toArray());

                this.group.position.copy(ctrlWorldPos);
                this.group.quaternion.copy(ctrlWorldQuat);
                this.group.translateX(0.14);
                this.group.translateY(0.05);
                this.group.translateZ(-0.12);

                // Clamp to dist from camera
                const toCam = this._tmpVec3.copy(this.group.position).sub(camPos);
                const d = toCam.length();
                if (d > dist) {
                    toCam.normalize();
                    this.group.position.copy(camPos).add(toCam.multiplyScalar(dist));
                }
            } else {
                console.warn('[VRChatPanel] ⚠️ Controller position invalid, using camera spawn');
            }
        }

        // Face camera on spawn
        this.group.lookAt(camPos);
        console.log('[VRChatPanel] 📍 Panel spawned at world position:', this.group.position.toArray());
    }

    // =====================================================================
    // PUBLIC API (existing style)
    // =====================================================================

    setMode(mode) {
        this.mode = mode === 'settings' ? 'settings' : 'chat';
        this.redraw();
    }

    setStatus(status) {
        this.status = status || 'idle';
        this.redraw();
    }

    /**
     * Set transcript text for VR speech-to-text display
     * @param {string} text - Transcript text
     * @param {string} mode - 'interim' or 'final'
     */
    setTranscript(text, mode = 'interim') {
        this.transcript = String(text ?? '');
        this.transcriptMode = mode;
        console.log(`[VRChatPanel] Transcript (${mode}): "${this.transcript}"`);
        this.redraw();
    }

    /**
     * Clear transcript display
     */
    clearTranscript() {
        this.transcript = '';
        this.transcriptMode = 'idle';
        this.redraw();
    }

    setAvatars(list) {
        this.avatars = Array.isArray(list) ? list : [];

        // NEW: sync chosen avatar from localStorage (desktop selection)
        this._syncAvatarSelectionFromStorage();

        this.currentAvatarIndex = Math.max(0, Math.min(this.currentAvatarIndex, this.avatars.length - 1));
        this.redraw();
    }

    nextAvatar() {
        if (!this.avatars.length) return 0;
        this.currentAvatarIndex = (this.currentAvatarIndex + 1) % this.avatars.length;

        // NEW: persist selection
        this._saveSelectedAvatarName(this.avatars[this.currentAvatarIndex]?.name || '');

        this.redraw();
        return this.currentAvatarIndex;
    }

    prevAvatar() {
        if (!this.avatars.length) return 0;
        this.currentAvatarIndex = (this.currentAvatarIndex - 1 + this.avatars.length) % this.avatars.length;

        // NEW: persist selection
        this._saveSelectedAvatarName(this.avatars[this.currentAvatarIndex]?.name || '');

        this.redraw();
        return this.currentAvatarIndex;
    }

    appendMessage(role, text) {
        this.messages.push({ role, text: String(text ?? '').trim() });
        if (this.messages.length > 10) this.messages.shift();
        this.redraw();
    }

    clearMessages() {
        this.messages = [];
        this.redraw();
    }

    getInteractables() {
        return this.interactables;
    }

    /**
     * Highlight an interactable mesh on hover (optional visual feedback)
     * @param {THREE.Mesh} mesh - The mesh to highlight
     */
    highlightInteractable(mesh) {
        // Quest 3 panel uses ray feedback instead of mesh highlighting
        // This is a no-op for compatibility with VRChatIntegration
    }

    /**
     * Reset an interactable mesh after hover exit
     * @param {THREE.Mesh} mesh - The mesh to reset
     */
    resetInteractable(mesh) {
        // Quest 3 panel uses ray feedback instead of mesh highlighting
        // This is a no-op for compatibility with VRChatIntegration
    }

    // =====================================================================
    // LAYOUT + HITBOXES
    // =====================================================================

    _computeLayout() {
        const W = this.canvasW,
            H = this.canvasH,
            P = this.padding;

        // Header handle (big, easy to grab)
        const handle = { x: P, y: P, w: W - P * 2, h: 96 };

        // Footer
        const footerH = 150;
        const footerY = H - footerH - P;

        const btnCount = 4; // VOICE / SEND / CLEAR / SETTINGS
        const btnGap = 18;
        const btnW = (W - P * 2 - btnGap * (btnCount - 1)) / btnCount;

        const btnRow = {
            items: [
                { key: 'mic', label: 'VOICE', icon: '🎤' },
                { key: 'send', label: 'SEND', icon: '➤' },
                { key: 'clear', label: 'CLEAR', icon: '⟳' },
                { key: 'settings', label: 'SETTINGS', icon: '⚙' },
            ].map((item, i) => ({
                ...item,
                x: P + i * (btnW + btnGap),
                y: footerY,
                w: btnW,
                h: 120,
            })),
        };

        // Content area
        const contentY = handle.y + handle.h + 18;
        const contentH = footerY - contentY - 18;
        const chatArea = { x: P, y: contentY, w: W - P * 2, h: contentH };

        // Chips (Disabled/Removed)
        const chips = [];

        // Settings (mirrors desktop toggles)
        const setTopY = contentY + 10;
        const settingsTop = {
            back: { x: P, y: setTopY, w: 190, h: 92 },
            stt: { x: W - P - 520, y: setTopY, w: 250, h: 92 },
            tts: { x: W - P - 250, y: setTopY, w: 250, h: 92 },
        };

        // ✅ FIX: COMPACT LAYOUT FOR SETTINGS TO PREVENT OVERLAP
        const avatarRect = { x: P, y: setTopY + 120, w: W - P * 2, h: 220 }; // Reduced from 240
        const navY = avatarRect.y + 65; // Center arrows vertically
        const settingsNav = {
            prev: { x: P + 26, y: navY, w: 110, h: 110 },
            next: { x: W - P - 136, y: navY, w: 110, h: 110 },
        };

        const voiceY = avatarRect.y + avatarRect.h + 15;
        const voiceRect = { x: P, y: voiceY, w: W - P * 2, h: 330 }; // Adjusted to 330

        const voiceNavY = voiceY + 50; // Shifted up
        const voiceNav = {
            prev: { x: P + 20, y: voiceNavY, w: 100, h: 100 },
            next: { x: W - P - 120, y: voiceNavY, w: 100, h: 100 },
        };

        const genderY = voiceY + 135; // Shifted up
        const genderBtnW = 140;
        const genderGap = 16;
        const genderStartX = P + (W - P * 2 - genderBtnW * 3 - genderGap * 2) / 2;
        const genderBtns = {
            any: { x: genderStartX, y: genderY, w: genderBtnW, h: 68 },
            male: { x: genderStartX + genderBtnW + genderGap, y: genderY, w: genderBtnW, h: 68 },
            female: { x: genderStartX + (genderBtnW + genderGap) * 2, y: genderY, w: genderBtnW, h: 68 },
        };

        const controlY = voiceY + 210; // Shifted up
        const controlBtnW = 80;
        const controlGap = 20;
        const rateControls = {
            label: { x: P + 30, y: controlY, w: 140, h: 50 },
            decrease: { x: P + 180, y: controlY, w: controlBtnW, h: 60 },
            increase: { x: P + 180 + controlBtnW + controlGap, y: controlY, w: controlBtnW, h: 60 },
        };
        const pitchControls = {
            label: { x: W - P - 380, y: controlY, w: 140, h: 50 },
            decrease: { x: W - P - 220, y: controlY, w: controlBtnW, h: 60 },
            increase: { x: W - P - 220 + controlBtnW + controlGap, y: controlY, w: controlBtnW, h: 60 },
        };

        const actionY = voiceY + 300; // Shifted up
        const actionBtnW = 200;
        const actionGap = 20;
        const actionStartX = P + (W - P * 2 - actionBtnW * 2 - actionGap) / 2;
        const voiceActions = {
            test: { x: actionStartX, y: actionY - 30, w: actionBtnW, h: 60 },
            save: { x: actionStartX + actionBtnW + actionGap, y: actionY - 30, w: actionBtnW, h: 60 },
        };

        return {
            W,
            H,
            handle,
            btnRow,
            chatArea,
            chips,
            settingsTop,
            avatarRect,
            settingsNav,
            voiceRect,
            voiceNav,
            genderBtns,
            rateControls,
            pitchControls,
            voiceActions,
        };
    }

    _createHitboxes() {
        const L = this._layout;

        // Handle (movement)
        this.buttons.handle = this._makeHitbox('Handle:move', L.handle, 'handle', { key: 'handle' });

        // Footer
        L.btnRow.items.forEach((b) => {
            this.buttons[b.key] = this._makeHitbox(`Btn:${b.key}`, b, 'button', { key: b.key, label: b.label });
        });

        // Chips
        L.chips.forEach((c) => {
            this.buttons[c.key] = this._makeHitbox(`Chip:${c.key}`, c, 'chip', { key: c.key, label: c.label });
        });

        // Settings group
        this.settingsGroup = new THREE.Group();
        this.settingsGroup.name = 'SettingsGroup';
        this.group.add(this.settingsGroup);

        const top = L.settingsTop;
        const nav = L.settingsNav;

        const back = this._makeHitbox('Btn:back', top.back, 'button', { key: 'back' });
        const stt = this._makeHitbox('Btn:stt', top.stt, 'toggle', { key: 'stt' });
        const tts = this._makeHitbox('Btn:tts', top.tts, 'toggle', { key: 'tts' });
        const prev = this._makeHitbox('Btn:avatar_prev', nav.prev, 'button', { key: 'avatar_prev' });
        const next = this._makeHitbox('Btn:avatar_next', nav.next, 'button', { key: 'avatar_next' });

        // ✅ Voice Settings Hitboxes
        const voiceNav = L.voiceNav;
        const voicePrev = this._makeHitbox('Btn:voice_prev', voiceNav.prev, 'button', { key: 'voice_prev' });
        const voiceNext = this._makeHitbox('Btn:voice_next', voiceNav.next, 'button', { key: 'voice_next' });

        const genderBtns = L.genderBtns;
        const genderAny = this._makeHitbox('Btn:gender_any', genderBtns.any, 'button', { key: 'gender_any' });
        const genderMale = this._makeHitbox('Btn:gender_male', genderBtns.male, 'button', { key: 'gender_male' });
        const genderFemale = this._makeHitbox('Btn:gender_female', genderBtns.female, 'button', {
            key: 'gender_female',
        });

        const rateControls = L.rateControls;
        const rateDec = this._makeHitbox('Btn:rate_dec', rateControls.decrease, 'button', { key: 'rate_dec' });
        const rateInc = this._makeHitbox('Btn:rate_inc', rateControls.increase, 'button', { key: 'rate_inc' });

        const pitchControls = L.pitchControls;
        const pitchDec = this._makeHitbox('Btn:pitch_dec', pitchControls.decrease, 'button', { key: 'pitch_dec' });
        const pitchInc = this._makeHitbox('Btn:pitch_inc', pitchControls.increase, 'button', { key: 'pitch_inc' });

        const voiceActions = L.voiceActions;
        const testVoice = this._makeHitbox('Btn:test_voice', voiceActions.test, 'button', { key: 'test_voice' });
        const saveVoice = this._makeHitbox('Btn:save_voice', voiceActions.save, 'button', { key: 'save_voice' });

        const settingsMeshes = [
            back,
            stt,
            tts,
            prev,
            next,
            voicePrev,
            voiceNext,
            genderAny,
            genderMale,
            genderFemale,
            rateDec,
            rateInc,
            pitchDec,
            pitchInc,
            testVoice,
            saveVoice,
        ];

        settingsMeshes.forEach((m) => {
            this.group.remove(m);
            this.settingsGroup.add(m);
        });

        this.buttons.back = back;
        this.buttons.stt = stt;
        this.buttons.tts = tts;
        this.buttons.avatar_prev = prev;
        this.buttons.avatar_next = next;
        this.buttons.voice_prev = voicePrev;
        this.buttons.voice_next = voiceNext;
        this.buttons.gender_any = genderAny;
        this.buttons.gender_male = genderMale;
        this.buttons.gender_female = genderFemale;
        this.buttons.rate_dec = rateDec;
        this.buttons.rate_inc = rateInc;
        this.buttons.pitch_dec = pitchDec;
        this.buttons.pitch_inc = pitchInc;
        this.buttons.test_voice = testVoice;
        this.buttons.save_voice = saveVoice;
    }

    _makeHitbox(name, rect, type, userData = {}) {
        const x = ((rect.x + rect.w / 2) / this.canvasW - 0.5) * this.panelWidth;
        const y = (0.5 - (rect.y + rect.h / 2) / this.canvasH) * this.panelHeight;
        const w = (rect.w / this.canvasW) * this.panelWidth;
        const h = (rect.h / this.canvasH) * this.panelHeight;

        // Invisible hit mesh
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ visible: false }));
        mesh.name = name;
        mesh.position.set(x, y, 0.01);
        mesh.userData = { type, ...userData };

        this.interactables.push(mesh);
        this.group.add(mesh);
        return mesh;
    }

    // =====================================================================
    // DRAWING (Quest 3 styled, borderless)
    // =====================================================================

    redraw() {
        const ctx = this.ctx;
        const L = this._layout;
        const T = this.theme;

        ctx.clearRect(0, 0, L.W, L.H);

        // Soft glass background (no border)
        const g = ctx.createLinearGradient(0, 0, 0, L.H);
        g.addColorStop(0, T.bgTop);
        g.addColorStop(1, T.bgBot);

        this._roundRect(ctx, 0, 0, L.W, L.H, 34);
        ctx.fillStyle = g;
        ctx.fill();

        // Subtle shadow strip (fake depth)
        ctx.fillStyle = T.shadow;
        this._roundRect(ctx, 12, 16, L.W - 24, 10, 8);
        ctx.fill();

        // Header (handle)
        const h = L.handle;
        this._roundRect(ctx, h.x, h.y, h.w, h.h, 24);
        ctx.fillStyle = T.header;
        ctx.fill();

        // Handle pill (grabbable cue)
        this._roundRect(ctx, h.x + h.w / 2 - 90, h.y + 30, 180, 16, 999);
        ctx.fillStyle = T.handlePill;
        ctx.fill();

        // Title
        ctx.fillStyle = T.text;
        ctx.font = '800 44px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('VR NEXUS AVATAR', h.x + 22, h.y + 66);

        // Status (right)
        ctx.textAlign = 'right';
        ctx.font = '700 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillStyle = this._statusColor();
        ctx.fillText(this._statusLabel(), L.W - this.padding - 22, h.y + 62);
        ctx.textAlign = 'left';

        // Content
        if (this.mode === 'settings') this._drawSettings(ctx);
        else this._drawChat(ctx);

        // Footer
        this._drawFooter(ctx);

        // Show/hide settings hitboxes
        this.settingsGroup.visible = this.mode === 'settings';

        this.texture.needsUpdate = true;
    }

    _drawChat(ctx) {
        const L = this._layout;
        const T = this.theme;
        const area = L.chatArea;

        // ✅ FIX: CLIP TEXT TO AREA (PREVENTS OVERFLOW INTO FOOTER)
        ctx.save();
        ctx.beginPath();
        ctx.rect(area.x, area.y, area.w, area.h);
        ctx.clip();

        // messages region top
        const pad = 18;
        let y = area.y + pad + 18;

        const msgs = this.messages.slice(-6);

        msgs.forEach((m) => {
            const isUser = m.role === 'user';
            const label = isUser ? 'YOU' : 'NEXUS';

            ctx.font = '800 26px system-ui, -apple-system, Segoe UI, Roboto, Arial';
            ctx.fillStyle = isUser ? T.accent : T.textDim;
            ctx.fillText(label, area.x + 18, y);

            y += 22;

            ctx.font = '500 32px system-ui, -apple-system, Segoe UI, Roboto, Arial';
            ctx.fillStyle = T.text;
            y = this._wrapText(ctx, m.text, area.x + 18, y + 18, area.x + area.w - 18, 40) + 18;

            y += 18;
            if (y > area.y + area.h - 120) return;
        });

        // ✅ RESTORE CONTEXT BEFORE DRAWING CHIPS
        ctx.restore();

        // Transcript display (show interim/final transcript during STT)
        if (this.transcript && this.transcriptMode !== 'idle') {
            const transcriptY = area.y + area.h - 160;
            const transcriptStyle = this.transcriptMode === 'interim' ? 'italic' : 'normal';

            ctx.font = '700 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
            ctx.fillStyle = this.transcriptMode === 'interim' ? T.accent : 'rgba(255, 215, 0, 0.95)';
            const prefix = this.transcriptMode === 'interim' ? '🎤 Listening...' : '🎤 Transcribed:';
            ctx.fillText(prefix, area.x + 18, transcriptY);

            ctx.font = `${transcriptStyle} 30px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
            ctx.fillStyle = T.text;
            this._wrapText(ctx, this.transcript, area.x + 18, transcriptY + 36, area.x + area.w - 18, 38);
        }

        // Chips
        L.chips.forEach((c) => {
            this._roundRect(ctx, c.x, c.y, c.w, c.h, 18);
            ctx.fillStyle = T.chipBg;
            ctx.fill();

            ctx.fillStyle = T.chipText;
            ctx.font = '800 26px system-ui, -apple-system, Segoe UI, Roboto, Arial';
            ctx.textAlign = 'center';
            ctx.fillText(c.label, c.x + c.w / 2, c.y + 43);
            ctx.textAlign = 'left';
        });
    }

    _drawSettings(ctx) {
        const L = this._layout;
        const T = this.theme;

        // Top controls
        const top = L.settingsTop;

        this._drawSoftBtn(ctx, top.back, '← Back', false);

        this._drawSoftToggle(ctx, top.stt, 'MIC INPUT', this.sttEnabled);
        this._drawSoftToggle(ctx, top.tts, 'VOICE OUT', this.ttsEnabled);

        // Avatar card
        const rect = L.avatarRect;
        this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 26);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fill();

        const total = this.avatars.length;
        const idx = total ? this.currentAvatarIndex : 0;
        const name = total ? this.avatars[idx]?.name || `Avatar ${idx + 1}` : 'No avatars loaded';

        // Title
        ctx.fillStyle = T.textDim;
        ctx.font = '700 26px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('AVATAR', rect.x + 22, rect.y + 52);

        // ✅ FIX: Center Name and Counter
        ctx.fillStyle = T.text;
        ctx.font = '900 38px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText(name.slice(0, 36), rect.x + rect.w / 2, rect.y + 100);

        // Counter
        ctx.fillStyle = T.textDim;
        ctx.font = '600 24px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText(total ? `${idx + 1} / ${total}` : '0 / 0', rect.x + rect.w / 2, rect.y + 136);
        ctx.textAlign = 'left';

        // Provider/Model settings (ABOVE nav arrows to prevent overlap)
        const providerText = this.settings.provider || 'none';
        const modelText = this.settings.model || '(auto)';
        const truncatedModel = modelText.length > 30 ? modelText.slice(0, 27) + '...' : modelText;

        ctx.fillStyle = providerText !== 'none' ? T.accent : T.textDim;
        ctx.font = '600 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText(`AI: ${providerText.toUpperCase()}`, rect.x + 22, rect.y + 174);

        ctx.fillStyle = T.textDim;
        ctx.font = '500 20px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText(`Model: ${truncatedModel}`, rect.x + 22, rect.y + 204);

        // ✅ Voice Settings Display (resolve from URI if name is empty)
        let voiceName = this.settings.speechVoice || '';
        const voiceURI = this.settings.speechVoiceURI || '';
        const voicePref = this.settings.speechVoicePref || 'any';

        // If voice name is empty but URI exists, try to resolve from available voices
        if (!voiceName && voiceURI && typeof speechSynthesis !== 'undefined') {
            try {
                const voices = speechSynthesis.getVoices() || [];
                console.log('[VRChatPanel] 🔍 Resolving voice name from URI:', {
                    targetURI: voiceURI.slice(0, 50),
                    availableVoices: voices.length,
                });
                const foundVoice = voices.find((v) => v.voiceURI === voiceURI);
                if (foundVoice) {
                    voiceName = foundVoice.name;
                    console.log('[VRChatPanel] ✅ Voice resolved:', voiceName);
                } else {
                    console.log('[VRChatPanel] ⚠️ Voice URI not found in available voices');
                }
            } catch (e) {
                console.warn('[VRChatPanel] Failed to resolve voice name:', e);
            }
        }

        const displayVoice = voiceName || 'Auto';
        const truncatedVoice = displayVoice.length > 30 ? displayVoice.slice(0, 27) + '...' : displayVoice;

        ctx.fillStyle = T.textDim;
        ctx.font = '500 20px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText(`Voice: ${truncatedVoice} [${voicePref}]`, rect.x + 22, rect.y + 234);

        // Nav arrows (positioned below provider/model/voice text)
        this._drawSoftIcon(ctx, L.settingsNav.prev, '◀');
        this._drawSoftIcon(ctx, L.settingsNav.next, '▶');

        // ✅ VOICE SETTINGS SECTION
        const voiceRect = L.voiceRect;

        // Voice settings card
        this._roundRect(ctx, voiceRect.x, voiceRect.y, voiceRect.w, voiceRect.h, 26);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fill();

        // Title
        ctx.fillStyle = T.accent;
        ctx.font = '700 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('VOICE SETTINGS', voiceRect.x + 22, voiceRect.y + 42);

        // Current voice display with navigation arrows
        const currentVoice = this._getCurrentVoice();
        const voiceDisplayName = currentVoice ? currentVoice.name : 'Loading voices...';
        const voiceGender = currentVoice ? this._guessGender(currentVoice) : 'unknown';
        const voiceCount = this.availableVoices.length;
        const voiceIndex = this.currentVoiceIndex + 1;

        ctx.fillStyle = T.text;
        ctx.font = '800 40px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        const truncatedName = voiceDisplayName.length > 24 ? voiceDisplayName.slice(0, 21) + '...' : voiceDisplayName;
        ctx.fillText(truncatedName, voiceRect.x + 140, voiceRect.y + 100); // Shifted Y

        ctx.fillStyle = T.textDim;
        ctx.font = '600 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText(`${voiceIndex} / ${voiceCount}  [${voiceGender}]`, voiceRect.x + 140, voiceRect.y + 142); // Shifted Y

        // Voice navigation arrows
        this._drawSoftIcon(ctx, L.voiceNav.prev, '◀');
        this._drawSoftIcon(ctx, L.voiceNav.next, '▶');

        // Gender filter buttons
        ctx.fillStyle = T.textDim;
        ctx.font = '600 24px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('Gender Filter:', voiceRect.x + 22, voiceRect.y + 210);

        this._drawGenderButton(ctx, L.genderBtns.any, 'Any', this.voiceGenderFilter === 'any');
        this._drawGenderButton(ctx, L.genderBtns.male, 'Male', this.voiceGenderFilter === 'male');
        this._drawGenderButton(ctx, L.genderBtns.female, 'Female', this.voiceGenderFilter === 'female');

        // Rate control
        ctx.fillStyle = T.textDim;
        ctx.font = '600 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('Rate:', L.rateControls.label.x, L.rateControls.label.y + 36);

        this._drawControlBtn(ctx, L.rateControls.decrease, '−');
        this._drawControlBtn(ctx, L.rateControls.increase, '+');

        ctx.fillStyle = T.text;
        ctx.font = '700 20px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        const rateValue = this.voiceRate.toFixed(1);
        ctx.textAlign = 'center';
        const rateCenter = L.rateControls.decrease.x + (L.rateControls.increase.x - L.rateControls.decrease.x) / 2;
        ctx.fillText(rateValue, rateCenter, L.rateControls.decrease.y + 86);
        ctx.textAlign = 'left';

        // Pitch control
        ctx.fillStyle = T.textDim;
        ctx.font = '600 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('Pitch:', L.pitchControls.label.x, L.pitchControls.label.y + 36);

        this._drawControlBtn(ctx, L.pitchControls.decrease, '−');
        this._drawControlBtn(ctx, L.pitchControls.increase, '+');

        ctx.fillStyle = T.text;
        ctx.font = '700 20px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        const pitchValue = this.voicePitch.toFixed(1);
        ctx.textAlign = 'center';
        const pitchCenter = L.pitchControls.decrease.x + (L.pitchControls.increase.x - L.pitchControls.decrease.x) / 2;
        ctx.fillText(pitchValue, pitchCenter, L.pitchControls.decrease.y + 86);
        ctx.textAlign = 'left';

        // ✅ FIX: Shortened labels for Test and Save
        this._drawActionBtn(ctx, L.voiceActions.test, '🔊 Test', false);
        this._drawActionBtn(ctx, L.voiceActions.save, '💾 Save', true);
    }

    _drawFooter(ctx) {
        const T = this.theme;
        const row = this._layout.btnRow;

        row.items.forEach((b) => {
            const isHot = b.key === 'mic' && this.status === 'listening';

            this._roundRect(ctx, b.x, b.y, b.w, b.h, 20);
            ctx.fillStyle = isHot ? T.dangerBg : T.btnBg;
            ctx.fill();

            // Icon
            ctx.fillStyle = T.text;
            ctx.textAlign = 'center';
            ctx.font = '36px system-ui, -apple-system, Segoe UI, Roboto, Arial';
            ctx.fillText(b.icon, b.x + b.w / 2, b.y + 52);

            // Label
            ctx.fillStyle = T.textDim;
            ctx.font = '800 20px system-ui, -apple-system, Segoe UI, Roboto, Arial';
            ctx.fillText(b.label, b.x + b.w / 2, b.y + 92);

            ctx.textAlign = 'left';
        });
    }

    _drawSoftBtn(ctx, rect, label, hot) {
        const T = this.theme;
        this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 18);
        ctx.fillStyle = hot ? T.btnBgHot : 'rgba(255,255,255,0.06)';
        ctx.fill();

        ctx.fillStyle = T.text;
        ctx.font = '800 26px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText(label, rect.x + rect.w / 2, rect.y + 58);
        ctx.textAlign = 'left';
    }

    _drawSoftIcon(ctx, rect, icon) {
        const T = this.theme;
        this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 22);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fill();

        ctx.fillStyle = T.text;
        ctx.font = '800 46px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText(icon, rect.x + rect.w / 2, rect.y + 70);
        ctx.textAlign = 'left';
    }

    _drawSoftToggle(ctx, rect, label, isOn) {
        const T = this.theme;
        this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 18);
        ctx.fillStyle = isOn ? T.btnBgHot : 'rgba(255,255,255,0.06)';
        ctx.fill();

        ctx.fillStyle = T.text;
        ctx.font = '800 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText(label, rect.x + rect.w / 2, rect.y + 40);

        ctx.fillStyle = isOn ? T.accent : T.textDim;
        ctx.font = '900 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText(isOn ? 'ON' : 'OFF', rect.x + rect.w / 2, rect.y + 72);

        ctx.textAlign = 'left';
    }

    _drawGenderButton(ctx, rect, label, isActive) {
        const T = this.theme;
        this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 16);
        ctx.fillStyle = isActive ? T.accent : 'rgba(255,255,255,0.04)';
        ctx.fill();

        ctx.fillStyle = isActive ? 'rgba(20,20,20,0.95)' : T.textDim;
        ctx.font = '800 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText(label, rect.x + rect.w / 2, rect.y + 46);
        ctx.textAlign = 'left';
    }

    _drawControlBtn(ctx, rect, label) {
        const T = this.theme;
        this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fill();

        ctx.fillStyle = T.text;
        ctx.font = '900 32px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText(label, rect.x + rect.w / 2, rect.y + 46);
        ctx.textAlign = 'left';
    }

    _drawActionBtn(ctx, rect, label, isHighlighted) {
        const T = this.theme;
        this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 16);
        ctx.fillStyle = isHighlighted ? T.accent : 'rgba(255,255,255,0.10)';
        ctx.fill();

        ctx.fillStyle = isHighlighted ? 'rgba(20,20,20,0.95)' : T.text;
        ctx.font = '800 24px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText(label, rect.x + rect.w / 2, rect.y + 46);
        ctx.textAlign = 'left';
    }

    _statusLabel() {
        switch (this.status) {
            case 'listening':
                return 'LISTENING';
            case 'thinking':
                return 'THINKING';
            case 'speaking':
                return 'SPEAKING';
            default:
                return 'READY';
        }
    }

    _statusColor() {
        switch (this.status) {
            case 'listening':
                return 'rgba(255, 95, 95, 0.95)';
            case 'thinking':
                return this.theme.accent;
            case 'speaking':
                return 'rgba(140, 255, 180, 0.95)';
            default:
                return this.theme.textDim;
        }
    }

    _roundRect(ctx, x, y, w, h, r) {
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
    }

    // =====================================================================
    // VOICE HELPERS
    // =====================================================================

    _guessGender(voice) {
        const n = (voice.name || '').toLowerCase();
        const m = /male|man|masculine|david|mark|james|paul|richard|daniel|alex\s*male|victor|oscar/i;
        const f =
            /female|woman|feminine|zira|samantha|victoria|kate|hazel|karen|moira|susan|fiona|joanna|salli|kendra|kimberly/i;
        if (f.test(n)) return 'female';
        if (m.test(n)) return 'male';
        return 'unknown';
    }

    _loadAndFilterVoices() {
        if (typeof speechSynthesis === 'undefined') {
            this.availableVoices = [];
            return;
        }

        const allVoices = speechSynthesis.getVoices() || [];
        const lang = this.settings.speechLang || 'en-US';
        const base = lang.split('-')[0].toLowerCase();

        // Filter by language
        let filtered = allVoices.filter((v) => (v.lang || '').toLowerCase().startsWith(base));
        if (!filtered.length) filtered = allVoices;

        // Filter by gender preference
        if (this.voiceGenderFilter === 'male' || this.voiceGenderFilter === 'female') {
            const byGender = filtered.filter((v) => this._guessGender(v) === this.voiceGenderFilter);
            if (byGender.length) {
                filtered = byGender;
            }
        }

        this.availableVoices = filtered;

        // Clamp current index
        if (this.currentVoiceIndex >= this.availableVoices.length) {
            this.currentVoiceIndex = Math.max(0, this.availableVoices.length - 1);
        }

        console.log('[VRChatPanel] 🎤 Loaded voices:', {
            total: allVoices.length,
            filtered: this.availableVoices.length,
            genderFilter: this.voiceGenderFilter,
            currentIndex: this.currentVoiceIndex,
        });
    }

    _getCurrentVoice() {
        if (!this.availableVoices.length) return null;
        return this.availableVoices[this.currentVoiceIndex] || null;
    }

    _matchSavedVoice() {
        if (!this.availableVoices.length) return;

        const savedURI = this.settings.speechVoiceURI || '';
        const savedName = this.settings.speechVoice || '';

        // Try to match by URI first (most reliable)
        if (savedURI) {
            const byURI = this.availableVoices.findIndex((v) => v.voiceURI === savedURI);
            if (byURI >= 0) {
                this.currentVoiceIndex = byURI;
                console.log('[VRChatPanel] ✅ Matched saved voice by URI:', this.availableVoices[byURI].name);
                return;
            }
        }

        // Fallback to name matching
        if (savedName) {
            const byName = this.availableVoices.findIndex((v) => v.name === savedName);
            if (byName >= 0) {
                this.currentVoiceIndex = byName;
                console.log('[VRChatPanel] ✅ Matched saved voice by name:', this.availableVoices[byName].name);
                return;
            }
        }

        console.log('[VRChatPanel] ℹ️ No saved voice match found, using first available');
        this.currentVoiceIndex = 0;
    }

    _wrapText(ctx, text, x, y, maxX, lineHeight) {
        const words = String(text || '').split(/\s+/);
        let line = '';
        let yy = y;

        for (let i = 0; i < words.length; i++) {
            const test = line + words[i] + ' ';
            if (ctx.measureText(test).width > maxX - x && i > 0) {
                ctx.fillText(line, x, yy);
                line = words[i] + ' ';
                yy += lineHeight;
            } else {
                line = test;
            }
        }
        ctx.fillText(line, x, yy);
        return yy;
    }

    // =====================================================================
    // CLICK HANDLERS (called from your VRChatIntegration / onUIButtonClick)
    // =====================================================================

    /**
     * Optional helper: call this from your UI click handler.
     * Example:
     * if (panel.handleUIAction(mesh.name, mesh.userData)) return;
     */
    handleUIAction(name, userData = {}) {
        const key = userData?.key;

        // Settings toggles should mirror desktop settings
        if (key === 'stt') {
            this.sttEnabled = !this.sttEnabled;
            this.settings.sttEnabled = this.sttEnabled;
            this._writeSpeechTogglesToDesktop();
            this.redraw();
            return true;
        }

        if (key === 'tts') {
            this.ttsEnabled = !this.ttsEnabled;
            this.settings.ttsEnabled = this.ttsEnabled;
            this._writeSpeechTogglesToDesktop();
            this.redraw();
            return true;
        }

        // ✅ Voice navigation
        if (key === 'voice_prev') {
            this._loadAndFilterVoices();
            if (this.availableVoices.length > 0) {
                this.currentVoiceIndex =
                    (this.currentVoiceIndex - 1 + this.availableVoices.length) % this.availableVoices.length;
                console.log('[VRChatPanel] ◀ Previous voice:', this._getCurrentVoice()?.name);
                this.redraw();
            }
            return true;
        }

        if (key === 'voice_next') {
            this._loadAndFilterVoices();
            if (this.availableVoices.length > 0) {
                this.currentVoiceIndex = (this.currentVoiceIndex + 1) % this.availableVoices.length;
                console.log('[VRChatPanel] ▶ Next voice:', this._getCurrentVoice()?.name);
                this.redraw();
            }
            return true;
        }

        // ✅ Gender filter
        if (key === 'gender_any') {
            this.voiceGenderFilter = 'any';
            this._loadAndFilterVoices();
            console.log('[VRChatPanel] Gender filter: Any');
            this.redraw();
            return true;
        }

        if (key === 'gender_male') {
            this.voiceGenderFilter = 'male';
            this._loadAndFilterVoices();
            console.log('[VRChatPanel] Gender filter: Male');
            this.redraw();
            return true;
        }

        if (key === 'gender_female') {
            this.voiceGenderFilter = 'female';
            this._loadAndFilterVoices();
            console.log('[VRChatPanel] Gender filter: Female');
            this.redraw();
            return true;
        }

        // ✅ Rate controls
        if (key === 'rate_dec') {
            this.voiceRate = Math.max(0.5, this.voiceRate - 0.1);
            console.log('[VRChatPanel] Rate decreased:', this.voiceRate.toFixed(1));
            this.redraw();
            return true;
        }

        if (key === 'rate_inc') {
            this.voiceRate = Math.min(2.0, this.voiceRate + 0.1);
            console.log('[VRChatPanel] Rate increased:', this.voiceRate.toFixed(1));
            this.redraw();
            return true;
        }

        // ✅ Pitch controls
        if (key === 'pitch_dec') {
            this.voicePitch = Math.max(0.5, this.voicePitch - 0.1);
            console.log('[VRChatPanel] Pitch decreased:', this.voicePitch.toFixed(1));
            this.redraw();
            return true;
        }

        if (key === 'pitch_inc') {
            this.voicePitch = Math.min(2.0, this.voicePitch + 0.1);
            console.log('[VRChatPanel] Pitch increased:', this.voicePitch.toFixed(1));
            this.redraw();
            return true;
        }

        // ✅ Test voice
        if (key === 'test_voice') {
            this._testVoice();
            return true;
        }

        // ✅ Save voice settings
        if (key === 'save_voice') {
            this._saveVoiceSettings();
            return true;
        }

        return false;
    }

    // =====================================================================
    // VOICE ACTIONS
    // =====================================================================

    _testVoice() {
        const voice = this._getCurrentVoice();
        if (!voice) {
            console.warn('[VRChatPanel] No voice selected for testing');
            return;
        }

        console.log('[VRChatPanel] 🔊 Testing voice:', voice.name);

        if (typeof speechSynthesis === 'undefined') {
            console.warn('[VRChatPanel] Speech synthesis not available');
            return;
        }

        // Stop any ongoing speech
        speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance('Hello! This is a voice test. How do I sound?');
        utterance.voice = voice;
        utterance.rate = this.voiceRate;
        utterance.pitch = this.voicePitch;
        utterance.volume = 1.0;

        utterance.onstart = () => {
            console.log('[VRChatPanel] ▶️ Voice test started');
        };

        utterance.onend = () => {
            console.log('[VRChatPanel] ✅ Voice test completed');
        };

        utterance.onerror = (event) => {
            if (event.error !== 'interrupted') {
                console.error('[VRChatPanel] ❌ Voice test error:', event.error);
            }
        };

        speechSynthesis.speak(utterance);
    }

    _saveVoiceSettings() {
        const voice = this._getCurrentVoice();
        if (!voice) {
            console.warn('[VRChatPanel] No voice selected to save');
            return;
        }

        console.log('[VRChatPanel] 💾 Saving voice settings to localStorage');

        // Build the TTS config object
        const ttsConfig = {
            speechVoice: voice.name,
            speechVoiceURI: voice.voiceURI,
            speechVoicePref: this.voiceGenderFilter,
            speechRate: this.voiceRate,
            speechPitch: this.voicePitch,
            speechVolume: 1.0,
            speechLang: voice.lang || 'en-US',
            ttsEnabled: this.ttsEnabled,
            sttEnabled: this.sttEnabled,
        };

        // Save to unified settings (nexus_settings_v1)
        try {
            let settings = {};
            const raw = localStorage.getItem('nexus_settings_v1');
            if (raw) {
                try {
                    settings = JSON.parse(raw);
                } catch (e) {
                    console.warn('[VRChatPanel] Failed to parse existing settings:', e);
                }
            }

            settings = { ...settings, ...ttsConfig };
            localStorage.setItem('nexus_settings_v1', JSON.stringify(settings));
            // ✅ Sync immediately within the same context
            this.syncFromDesktopSettings();

            console.log('[VRChatPanel] ✅ Voice settings saved:', {
                name: voice.name,
                uri: voice.voiceURI.slice(0, 50),
                gender: this.voiceGenderFilter,
                rate: this.voiceRate,
                pitch: this.voicePitch,
            });

            // Also save to individual localStorage keys for backward compatibility with desktop
            localStorage.setItem('speech_voice_uri', voice.voiceURI);
            localStorage.setItem('speech_rate', String(this.voiceRate));
            localStorage.setItem('speech_pitch', String(this.voicePitch));
            localStorage.setItem('speech_lang', voice.lang || 'en-US');

            // Update local settings state
            this.settings.speechVoice = voice.name;
            this.settings.speechVoiceURI = voice.voiceURI;
            this.settings.speechVoicePref = this.voiceGenderFilter;
            this.settings.speechRate = this.voiceRate;
            this.settings.speechPitch = this.voicePitch;

            // Update SpeechService if available
            if (window.SpeechService && typeof window.SpeechService.saveTTSConfig === 'function') {
                window.SpeechService.saveTTSConfig(ttsConfig);
            }

            // Visual feedback: redraw to show updated settings
            this.redraw();

            console.log('[VRChatPanel] 🔄 Settings synced across desktop and VR');
        } catch (error) {
            console.error('[VRChatPanel] ❌ Failed to save voice settings:', error);
        }
    }

    // =====================================================================
    // DISPOSE
    // =====================================================================

    dispose() {
        // ✅ cleanup storage listener
        if (this._onStorage) {
            window.removeEventListener('storage', this._onStorage);
            this._onStorage = null;
        }

        try {
            this.texture?.dispose?.();
        } catch (_) {}
        this.group.traverse((o) => {
            try {
                o.geometry?.dispose?.();
            } catch (_) {}
            try {
                o.material?.dispose?.();
            } catch (_) {}
        });
        this.scene.remove(this.group);
    }
}
