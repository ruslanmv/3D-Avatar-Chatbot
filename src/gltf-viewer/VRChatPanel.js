/**
 * VR Chat Panel Module (Quest 3 Styled + Shared Desktop Settings)
 * ------------------------------------------------------------------------
 * GOALS (your request):
 * 1) VR uses the SAME settings as Desktop (provider/model/apiKey/baseUrl/systemPrompt, speech prefs, etc.).
 *    - We read/write from the same localStorage keys your desktop UI already uses.
 *    - No separate VR-only settings menu is required; VR toggles are mirrors of Desktop settings.
 *
 * 2) Quest 3 friendly visuals:
 *    - Remove neon/outer borders (no "frame" box).
 *    - Soft glass card, subtle header handle, big readable type.
 *    - No hard cyan outlines everywhere.
 *
 * 3) Drag works reliably:
 *    - Always draggable via top handle (no pinned logic needed).
 *    - Comfortable distance clamp for Quest.
 *
 * IMPORTANT:
 * - You MUST call panel.syncFromDesktopSettings() once after desktop settings load/save,
 *   OR call it every time you open the VR panel.
 * - If you already have a settings save event in your desktop code, call:
 *     vrChatPanel.syncFromDesktopSettings();
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

        // Phase A: Attachment card hit areas for tap-to-view
        this._attachmentHitAreas = [];
        this._thumbnailCache = new Map(); // Phase B: url → Image | null

        // Speech-to-text transcript display
        this.transcript = '';
        this.transcriptMode = 'idle'; // 'idle' | 'interim' | 'final'

        // Mirrors desktop settings (synced via localStorage)
        this.settings = this._defaultSettings();

        // VR toggles mirror desktop speech toggles
        this.sttEnabled = true;
        this.ttsEnabled = true;

        // -----------------------
        // XR Settings (additive — VR/AR/mobile features)
        // -----------------------
        this.xrSettings = {
            avatarScale: 1.0, // 0.5, 1.0, 1.5
            showEnvironment: true, // toggle env visibility in VR
            moveSpeed: 'normal', // 'slow', 'normal', 'fast'
            panelDistance: 'medium', // 'near', 'medium', 'far'
            sessionMode: 'vr', // 'vr' | 'ar'
            arSupported: false, // set async after checking navigator.xr
            vrBackground: 'black', // 'black' | 'blue' | 'void'
        };

        // Check AR support asynchronously
        if (navigator.xr) {
            navigator.xr
                .isSessionSupported('immersive-ar')
                .then((supported) => {
                    this.xrSettings.arSupported = supported;
                    console.log(`[VRChatPanel] AR supported: ${supported}`);
                    if (this.mode === 'settings') this.redraw();
                })
                .catch(() => {});
        }

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

        // Floating mic recording indicator (lives outside this.group so it
        // stays visible even when the chat panel is hidden)
        this._buildMicIndicator();

        // Initial sync from desktop settings (safe even if empty)
        this.syncFromDesktopSettings();

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

        // Mirror common toggles (speech)
        this.sttEnabled = !!this.settings.sttEnabled;
        this.ttsEnabled = !!this.settings.ttsEnabled;

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
                try {
                    const speechRaw = localStorage.getItem('nexus_settings_v1');
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

    // =====================================================================
    // FLOATING MIC INDICATOR (visible even when panel is hidden)
    // =====================================================================

    _buildMicIndicator() {
        this.micIndicator = new THREE.Group();
        this.micIndicator.name = 'VRMicIndicator';
        this.micIndicator.visible = false;
        this._micIndicatorTime = 0;

        // --- Mic icon sprite (white mic on dark pill) ---
        const iconSize = 64;
        const iconCanvas = document.createElement('canvas');
        iconCanvas.width = iconSize;
        iconCanvas.height = iconSize;
        const ic = iconCanvas.getContext('2d');

        // Dark pill background
        ic.fillStyle = 'rgba(20, 22, 28, 0.85)';
        ic.beginPath();
        ic.arc(iconSize / 2, iconSize / 2, iconSize / 2 - 2, 0, Math.PI * 2);
        ic.fill();

        // Mic icon (simple vector: body + base)
        ic.strokeStyle = '#ffffff';
        ic.fillStyle = '#ffffff';
        ic.lineWidth = 3;
        const cx = iconSize / 2;
        const cy = iconSize / 2 - 4;
        // Mic body (rounded rect)
        const bw = 10,
            bh = 18,
            br = 5;
        ic.beginPath();
        ic.moveTo(cx - bw / 2 + br, cy - bh / 2);
        ic.lineTo(cx + bw / 2 - br, cy - bh / 2);
        ic.quadraticCurveTo(cx + bw / 2, cy - bh / 2, cx + bw / 2, cy - bh / 2 + br);
        ic.lineTo(cx + bw / 2, cy + bh / 2 - br);
        ic.quadraticCurveTo(cx + bw / 2, cy + bh / 2, cx + bw / 2 - br, cy + bh / 2);
        ic.lineTo(cx - bw / 2 + br, cy + bh / 2);
        ic.quadraticCurveTo(cx - bw / 2, cy + bh / 2, cx - bw / 2, cy + bh / 2 - br);
        ic.lineTo(cx - bw / 2, cy - bh / 2 + br);
        ic.quadraticCurveTo(cx - bw / 2, cy - bh / 2, cx - bw / 2 + br, cy - bh / 2);
        ic.fill();
        // Arc under mic
        ic.beginPath();
        ic.arc(cx, cy + 2, 10, 0, Math.PI, false);
        ic.stroke();
        // Stem
        ic.beginPath();
        ic.moveTo(cx, cy + 12);
        ic.lineTo(cx, cy + 18);
        ic.stroke();
        // Base
        ic.beginPath();
        ic.moveTo(cx - 6, cy + 18);
        ic.lineTo(cx + 6, cy + 18);
        ic.stroke();

        const iconTex = new THREE.CanvasTexture(iconCanvas);
        iconTex.needsUpdate = true;
        const iconMat = new THREE.SpriteMaterial({ map: iconTex, transparent: true, depthTest: false });
        const iconSprite = new THREE.Sprite(iconMat);
        iconSprite.scale.set(0.045, 0.045, 1);
        iconSprite.renderOrder = 999;
        this.micIndicator.add(iconSprite);

        // --- Pulsing red ring ---
        const ringGeo = new THREE.RingGeometry(0.024, 0.03, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xff4444,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            depthTest: false,
        });
        this._micRing = new THREE.Mesh(ringGeo, ringMat);
        this._micRing.renderOrder = 998;
        this.micIndicator.add(this._micRing);

        // --- "REC" label sprite ---
        const labelCanvas = document.createElement('canvas');
        labelCanvas.width = 64;
        labelCanvas.height = 24;
        const lc = labelCanvas.getContext('2d');
        lc.fillStyle = 'rgba(20, 22, 28, 0.80)';
        lc.beginPath();
        lc.roundRect(0, 0, 64, 24, 6);
        lc.fill();
        lc.fillStyle = '#ff4444';
        lc.font = 'bold 16px sans-serif';
        lc.textAlign = 'center';
        lc.textBaseline = 'middle';
        // Red dot
        lc.beginPath();
        lc.arc(14, 12, 4, 0, Math.PI * 2);
        lc.fill();
        // Text
        lc.fillText('REC', 42, 13);

        const labelTex = new THREE.CanvasTexture(labelCanvas);
        labelTex.needsUpdate = true;
        const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false });
        const labelSprite = new THREE.Sprite(labelMat);
        labelSprite.scale.set(0.035, 0.014, 1);
        labelSprite.position.set(0, -0.032, 0);
        labelSprite.renderOrder = 999;
        this.micIndicator.add(labelSprite);

        this.scene.add(this.micIndicator);
    }

    /**
     * Update mic indicator position — anchor to left controller wrist
     * (near the joystick, not blocking avatar view), fallback to camera HUD.
     */
    _updateMicIndicatorPosition() {
        if (!this.micIndicator?.visible) return;

        const controller = this.leftController;
        if (controller && controller.visible) {
            // Position on inner wrist of left hand, near the joystick area
            // - Slightly above controller (+0.02 Y) so it doesn't clip into hand
            // - Shifted inward toward body (+right axis from controller perspective)
            // - Forward toward user slightly (-Z in controller space)
            const ctrlRight = new THREE.Vector3(1, 0, 0).applyQuaternion(controller.quaternion);
            const ctrlForward = new THREE.Vector3(0, 0, -1).applyQuaternion(controller.quaternion);

            this.micIndicator.position.copy(controller.position);
            this.micIndicator.position.y += 0.02; // just above wrist
            this.micIndicator.position.add(ctrlRight.multiplyScalar(0.04)); // inward (right = toward body on left hand)
            this.micIndicator.position.add(ctrlForward.multiplyScalar(0.03)); // slightly forward toward user
        } else {
            // Fallback: camera-relative HUD — bottom-left of view
            const cam = this.camera;
            const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
            this.micIndicator.position.copy(cam.position).add(dir.multiplyScalar(0.3)).add(right.multiplyScalar(-0.2));
            this.micIndicator.position.y -= 0.1;
        }

        // Billboard: always face the camera
        this.micIndicator.lookAt(this.camera.position);
    }

    /**
     * Animate the pulsing ring (~2Hz sine wave).
     * @param {number} dt - delta time in seconds
     */
    _animateMicIndicator(dt) {
        if (!this.micIndicator?.visible || !this._micRing) return;

        this._micIndicatorTime += dt;
        const t = this._micIndicatorTime;

        // Pulse scale 1.0 → 1.4 at ~2Hz
        const pulse = 1.0 + 0.4 * (0.5 + 0.5 * Math.sin(t * Math.PI * 4));
        this._micRing.scale.set(pulse, pulse, 1);

        // Pulse opacity 0.5 → 1.0
        this._micRing.material.opacity = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(t * Math.PI * 4));
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

        // Show/hide floating mic indicator (works even when panel is hidden)
        if (this.micIndicator) {
            const listening = this.status === 'listening';
            this.micIndicator.visible = listening;
            if (listening) this._micIndicatorTime = 0;
        }

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
        this.currentAvatarIndex = Math.max(0, Math.min(this.currentAvatarIndex, this.avatars.length - 1));
        this.redraw();
    }

    nextAvatar() {
        if (!this.avatars.length) return 0;
        this.currentAvatarIndex = (this.currentAvatarIndex + 1) % this.avatars.length;
        this.redraw();
        return this.currentAvatarIndex;
    }

    prevAvatar() {
        if (!this.avatars.length) return 0;
        this.currentAvatarIndex = (this.currentAvatarIndex - 1 + this.avatars.length) % this.avatars.length;
        this.redraw();
        return this.currentAvatarIndex;
    }

    appendMessage(role, text) {
        this.messages.push({ role, text: String(text ?? '').trim() });
        if (this.messages.length > 10) this.messages.shift();
        this.redraw();
    }

    /**
     * Phase 5: Append a rich message with text + attachments + directives.
     * @param {Object} message - { role, text, attachments, directives }
     */
    appendRichMessage(message) {
        const entry = {
            role: message.role || 'bot',
            text: String(message.text ?? '').trim(),
            attachments: message.attachments || [],
            directives: message.directives || {},
        };
        this.messages.push(entry);
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

        // Chips
        const chipH = 64;
        const chipY = chatArea.y + chatArea.h - chipH - 10;
        const chipGap = 16;
        const chipW = (chatArea.w - chipGap * 2) / 3;
        const chips = [
            { key: 'q_sum', label: 'Summarize', x: P, y: chipY, w: chipW, h: chipH },
            { key: 'q_exp', label: 'Explain', x: P + chipW + chipGap, y: chipY, w: chipW, h: chipH },
            { key: 'q_nxt', label: 'Next', x: P + (chipW + chipGap) * 2, y: chipY, w: chipW, h: chipH },
        ];

        // Settings (mirrors desktop toggles)
        const setTopY = contentY + 10;
        const settingsTop = {
            back: { x: P, y: setTopY, w: 190, h: 92 },
            stt: { x: W - P - 520, y: setTopY, w: 250, h: 92 },
            tts: { x: W - P - 250, y: setTopY, w: 250, h: 92 },
        };

        const avatarRect = { x: P, y: setTopY + 120, w: W - P * 2, h: 280 };
        const navY = avatarRect.y + 112;
        const settingsNav = {
            prev: { x: P + 26, y: navY, w: 110, h: 110 },
            next: { x: W - P - 136, y: navY, w: 110, h: 110 },
        };

        // XR Settings row (below avatar card)
        const xrY = avatarRect.y + avatarRect.h + 16;
        const xrBtnW = (W - P * 2 - 14 * 5) / 6; // 6 buttons with gaps
        const xrH = 80;
        const xrSettingsRow = {
            scale: { x: P, y: xrY, w: xrBtnW, h: xrH },
            env: { x: P + (xrBtnW + 14), y: xrY, w: xrBtnW, h: xrH },
            speed: { x: P + (xrBtnW + 14) * 2, y: xrY, w: xrBtnW, h: xrH },
            distance: { x: P + (xrBtnW + 14) * 3, y: xrY, w: xrBtnW, h: xrH },
            bg: { x: P + (xrBtnW + 14) * 4, y: xrY, w: xrBtnW, h: xrH },
            mode: { x: P + (xrBtnW + 14) * 5, y: xrY, w: xrBtnW, h: xrH },
        };

        // Avatar Pose row (below XR settings)
        const poseY = xrY + xrH + 10;
        const poseBtnW = (W - P * 2 - 14) / 2;
        const poseSettingsRow = {
            preset: { x: P, y: poseY, w: poseBtnW, h: xrH },
            intensity: { x: P + poseBtnW + 14, y: poseY, w: poseBtnW, h: xrH },
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
            xrSettingsRow,
            poseSettingsRow,
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

        // Chat area hitbox (for attachment card tap detection)
        // Placed slightly behind other hitboxes (z=0.005 vs 0.01) so chips/buttons take priority
        this.buttons.chatArea = this._makeHitbox('ChatArea:tap', L.chatArea, 'chat-area', { key: 'chat-area' });
        this.buttons.chatArea.position.z = 0.005;

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

        [back, stt, tts, prev, next].forEach((m) => {
            this.group.remove(m);
            this.settingsGroup.add(m);
        });

        this.buttons.back = back;
        this.buttons.stt = stt;
        this.buttons.tts = tts;
        this.buttons.avatar_prev = prev;
        this.buttons.avatar_next = next;

        // XR Settings hitboxes
        const xr = L.xrSettingsRow;
        const xrScale = this._makeHitbox('Btn:xr_scale', xr.scale, 'button', { key: 'xr_scale' });
        const xrEnv = this._makeHitbox('Btn:xr_env', xr.env, 'button', { key: 'xr_env' });
        const xrSpeed = this._makeHitbox('Btn:xr_speed', xr.speed, 'button', { key: 'xr_speed' });
        const xrDist = this._makeHitbox('Btn:xr_distance', xr.distance, 'button', { key: 'xr_distance' });
        const xrBg = this._makeHitbox('Btn:xr_bg', xr.bg, 'button', { key: 'xr_bg' });
        const xrMode = this._makeHitbox('Btn:xr_mode', xr.mode, 'button', { key: 'xr_mode' });

        [xrScale, xrEnv, xrSpeed, xrDist, xrBg, xrMode].forEach((m) => {
            this.group.remove(m);
            this.settingsGroup.add(m);
        });

        this.buttons.xr_scale = xrScale;
        this.buttons.xr_env = xrEnv;
        this.buttons.xr_speed = xrSpeed;
        this.buttons.xr_distance = xrDist;
        this.buttons.xr_bg = xrBg;
        this.buttons.xr_mode = xrMode;

        // Pose settings hitboxes
        const pose = L.poseSettingsRow;
        const posePreset = this._makeHitbox('Btn:xr_pose_preset', pose.preset, 'button', { key: 'xr_pose_preset' });
        const poseIntensity = this._makeHitbox('Btn:xr_pose_intensity', pose.intensity, 'button', {
            key: 'xr_pose_intensity',
        });

        [posePreset, poseIntensity].forEach((m) => {
            this.group.remove(m);
            this.settingsGroup.add(m);
        });

        this.buttons.xr_pose_preset = posePreset;
        this.buttons.xr_pose_intensity = poseIntensity;
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
        ctx.fillText('HomePilot Avatar VR', h.x + 22, h.y + 66);

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

        // Clear attachment hit areas for this frame
        this._attachmentHitAreas = [];

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

            // Phase A: Render interactive attachment cards for images
            if (m.attachments && m.attachments.length > 0) {
                const images = m.attachments.filter((a) => a.type === 'image');
                images.forEach((att) => {
                    y += 6;
                    const cardH = this._drawAttachmentCard(ctx, att, area.x + 18, y, area.w - 36);
                    y += cardH;
                });
            }

            y += 18;
            if (y > area.y + area.h - 120) return;
        });

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

    // =================================================================
    // Phase A: Attachment card rendering + hit detection
    // Phase B: Inline thumbnail rendering (progressive enhancement)
    // =================================================================

    /**
     * Draw a styled attachment card under a message.
     * Phase B upgrades this to show an actual image thumbnail when cached.
     * @returns {number} total height consumed by the card
     */
    _drawAttachmentCard(ctx, attachment, x, y, maxW) {
        const T = this.theme;
        const cardH = 78;
        const cardW = Math.min(maxW, 420);
        const r = 12;

        // Phase B: Check thumbnail cache for inline image
        const cached = this._thumbnailCache.get(attachment.url);
        if (cached && cached instanceof Image && cached.complete && cached.naturalWidth > 0) {
            return this._drawAttachmentThumb(ctx, attachment, cached, x, y, cardW);
        }

        // Phase A: Styled card with icon and label
        // Card background
        ctx.save();
        this._roundRect(ctx, x, y, cardW, cardH, r);
        ctx.fillStyle = 'rgba(0, 229, 255, 0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Photo icon (camera-style)
        const iconX = x + 18;
        const iconY = y + cardH / 2;
        ctx.fillStyle = T.accent;
        ctx.font = '600 30px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textBaseline = 'middle';
        ctx.fillText('🖼', iconX, iconY);

        // Label
        const labelX = iconX + 44;
        ctx.font = '600 26px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillStyle = T.text;
        ctx.textBaseline = 'middle';
        const name = attachment.name || 'Photo';
        ctx.fillText(name, labelX, iconY - 10);

        // Hint
        ctx.font = '400 20px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillStyle = T.textDim;
        ctx.fillText('Tap to view', labelX, iconY + 16);

        ctx.textBaseline = 'alphabetic';
        ctx.restore();

        // Store hit area for tap detection
        this._attachmentHitAreas.push({ x, y, w: cardW, h: cardH, attachment });

        // Phase B: Trigger async thumbnail load
        if (!this._thumbnailCache.has(attachment.url)) {
            this._loadThumbnail(attachment.url);
        }

        return cardH;
    }

    /**
     * Phase B: Draw an inline thumbnail inside the attachment card.
     * Called when the thumbnail image is cached and loaded.
     * @returns {number} total height consumed
     */
    _drawAttachmentThumb(ctx, attachment, img, x, y, cardW) {
        const T = this.theme;
        const thumbMaxW = 180;
        const thumbMaxH = 120;

        // Scale image to fit within thumbnail bounds
        const scale = Math.min(thumbMaxW / img.naturalWidth, thumbMaxH / img.naturalHeight, 1);
        const thumbW = Math.round(img.naturalWidth * scale);
        const thumbH = Math.round(img.naturalHeight * scale);

        const cardH = thumbH + 44; // thumb + label + padding
        const r = 12;

        // Card background
        ctx.save();
        this._roundRect(ctx, x, y, cardW, cardH, r);
        ctx.fillStyle = 'rgba(0, 229, 255, 0.06)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Thumbnail image (with rounded corners via clip)
        const imgX = x + 14;
        const imgY = y + 10;
        ctx.save();
        this._roundRect(ctx, imgX, imgY, thumbW, thumbH, 8);
        ctx.clip();
        ctx.drawImage(img, imgX, imgY, thumbW, thumbH);
        ctx.restore();

        // Label to the right of thumbnail
        const labelX = imgX + thumbW + 16;
        const labelMaxW = cardW - thumbW - 50;
        if (labelMaxW > 60) {
            ctx.font = '600 24px system-ui, -apple-system, Segoe UI, Roboto, Arial';
            ctx.fillStyle = T.text;
            ctx.textBaseline = 'middle';
            const name = attachment.name || 'Photo';
            ctx.fillText(name, labelX, imgY + thumbH / 2 - 10, labelMaxW);

            ctx.font = '400 19px system-ui, -apple-system, Segoe UI, Roboto, Arial';
            ctx.fillStyle = T.textDim;
            ctx.fillText('Tap to expand', labelX, imgY + thumbH / 2 + 14, labelMaxW);
            ctx.textBaseline = 'alphabetic';
        }

        ctx.restore();

        // Store hit area
        this._attachmentHitAreas.push({ x, y, w: cardW, h: cardH, attachment });

        return cardH;
    }

    /**
     * Phase B: Load a thumbnail image asynchronously. Triggers redraw on completion.
     */
    _loadThumbnail(url) {
        if (this._thumbnailCache.has(url)) return;

        // Sentinel to prevent duplicate loads
        this._thumbnailCache.set(url, 'loading');

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            this._thumbnailCache.set(url, img);
            // Evict oldest if cache too large
            if (this._thumbnailCache.size > 20) {
                const oldest = this._thumbnailCache.keys().next().value;
                this._thumbnailCache.delete(oldest);
            }
            this.redraw();
        };
        img.onerror = () => {
            this._thumbnailCache.set(url, null); // null sentinel — don't retry
        };
        img.src = url;
    }

    /**
     * Check if a canvas-coordinate tap hit an attachment card.
     * @param {number} canvasX - X in canvas pixels
     * @param {number} canvasY - Y in canvas pixels
     * @returns {Object|null} The attachment object if hit, null otherwise
     */
    handleAttachmentTap(canvasX, canvasY) {
        for (const area of this._attachmentHitAreas) {
            if (canvasX >= area.x && canvasX <= area.x + area.w && canvasY >= area.y && canvasY <= area.y + area.h) {
                return area.attachment;
            }
        }
        return null;
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

        // Avatar name (reduced size to make room)
        ctx.fillStyle = T.text;
        ctx.font = '900 38px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText(name.slice(0, 36), rect.x + 22, rect.y + 100);

        // Counter
        ctx.fillStyle = T.textDim;
        ctx.font = '600 24px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText(total ? `${idx + 1} / ${total}` : '0 / 0', rect.x + 22, rect.y + 136);

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
                const foundVoice = voices.find((v) => v.voiceURI === voiceURI);
                if (foundVoice) {
                    voiceName = foundVoice.name;
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

        // Hint
        ctx.fillStyle = T.textDim;
        ctx.font = '500 20px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('Desktop settings are shared automatically.', rect.x + 22, rect.y + rect.h - 16);

        // XR Settings Row
        const xr = L.xrSettingsRow;
        const xs = this.xrSettings;

        // Scale button
        const scaleLabel = xs.avatarScale === 0.5 ? 'S' : xs.avatarScale === 1.5 ? 'L' : 'M';
        this._drawXRSettingBtn(ctx, xr.scale, 'SCALE', scaleLabel);

        // Environment toggle
        this._drawXRSettingBtn(ctx, xr.env, 'ENV', xs.showEnvironment ? 'ON' : 'OFF', xs.showEnvironment);

        // Speed button
        const speedLabel = xs.moveSpeed === 'slow' ? 'SLOW' : xs.moveSpeed === 'fast' ? 'FAST' : 'MED';
        this._drawXRSettingBtn(ctx, xr.speed, 'SPEED', speedLabel);

        // Panel distance button
        const distLabel = xs.panelDistance === 'near' ? 'NEAR' : xs.panelDistance === 'far' ? 'FAR' : 'MED';
        this._drawXRSettingBtn(ctx, xr.distance, 'PANEL', distLabel);

        // Background color button (black → blue → void)
        const bgLabel = xs.vrBackground === 'blue' ? 'BLUE' : xs.vrBackground === 'void' ? 'VOID' : 'BLK';
        this._drawXRSettingBtn(ctx, xr.bg, 'BG', bgLabel);

        // Mode button (VR ↔ AR toggle)
        if (xs.arSupported) {
            const modeLabel = xs.sessionMode === 'ar' ? 'AR' : 'VR';
            const modeActive = xs.sessionMode === 'ar';
            this._drawXRSettingBtn(ctx, xr.mode, 'MODE', modeLabel, true);
            // Green tint for AR mode
            if (modeActive) {
                const T = this.theme;
                const r = xr.mode;
                ctx.save();
                this._roundRect(ctx, r.x, r.y, r.w, r.h, 14);
                ctx.fillStyle = 'rgba(118, 255, 3, 0.12)';
                ctx.fill();
                // Redraw labels in green
                ctx.fillStyle = 'rgba(118, 255, 3, 0.7)';
                ctx.font = '700 18px system-ui, -apple-system, Segoe UI, Roboto, Arial';
                ctx.textAlign = 'center';
                ctx.fillText('MODE', r.x + r.w / 2, r.y + 30);
                ctx.fillStyle = 'rgba(118, 255, 3, 0.95)';
                ctx.font = '900 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
                ctx.fillText('AR', r.x + r.w / 2, r.y + 60);
                ctx.textAlign = 'left';
                ctx.restore();
            }
        } else {
            // AR not supported — show disabled
            this._drawXRSettingBtn(ctx, xr.mode, 'MODE', 'VR', false);
        }

        // Pose Settings Row
        const poseRow = L.poseSettingsRow;
        const pn = window.NEXUS_POSE_NORMALIZER;
        const pnSettings = pn ? pn.getSettings() : { preset: 'relaxedStanding', intensity: 0.35 };
        const presetLabels = { relaxedStanding: 'RELAX', naturalIdle: 'IDLE', portrait: 'PORT', presentation: 'PRES' };
        const presetLabel = presetLabels[pnSettings.preset] || 'RELAX';
        this._drawXRSettingBtn(ctx, poseRow.preset, 'POSE', presetLabel);

        const intLabel = (pnSettings.intensity * 100).toFixed(0) + '%';
        this._drawXRSettingBtn(ctx, poseRow.intensity, 'STRENGTH', intLabel);
    }

    _drawXRSettingBtn(ctx, rect, label, value, isActive = true) {
        const T = this.theme;
        this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
        ctx.fillStyle = isActive ? 'rgba(120, 220, 255, 0.10)' : 'rgba(255,255,255,0.04)';
        ctx.fill();

        ctx.fillStyle = T.textDim;
        ctx.font = '700 18px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText(label, rect.x + rect.w / 2, rect.y + 30);

        ctx.fillStyle = isActive ? T.accent : T.textDim;
        ctx.font = '900 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText(value, rect.x + rect.w / 2, rect.y + 60);
        ctx.textAlign = 'left';
    }

    _drawFooter(ctx) {
        const T = this.theme;
        const row = this._layout.btnRow;

        row.items.forEach((b) => {
            const isHot = b.key === 'mic' && this.status === 'listening';

            // Button background with subtle glow when active
            this._roundRect(ctx, b.x, b.y, b.w, b.h, 20);
            ctx.fillStyle = isHot ? 'rgba(255, 60, 60, 0.28)' : T.btnBg;
            ctx.fill();

            if (isHot) {
                // Pulsing border glow for active mic
                ctx.strokeStyle = 'rgba(255, 80, 80, 0.6)';
                ctx.lineWidth = 2;
                this._roundRect(ctx, b.x, b.y, b.w, b.h, 20);
                ctx.stroke();
            }

            // Draw vector icon (no emoji)
            const cx = b.x + b.w / 2;
            const cy = b.y + 42;
            ctx.save();
            this._drawVectorIcon(ctx, b.key, cx, cy, isHot);
            ctx.restore();

            // Label
            ctx.fillStyle = isHot ? 'rgba(255, 120, 120, 0.95)' : T.textDim;
            ctx.font = '800 20px system-ui, -apple-system, Segoe UI, Roboto, Arial';
            ctx.textAlign = 'center';
            ctx.fillText(b.label, cx, b.y + 92);
            ctx.textAlign = 'left';
        });
    }

    /**
     * Draw crisp vector icons for footer buttons (gaming-industry style).
     * All icons drawn with canvas path API — no emoji dependency.
     */
    _drawVectorIcon(ctx, key, cx, cy, isHot) {
        const color = isHot ? 'rgba(255, 120, 120, 0.95)' : 'rgba(255, 255, 255, 0.92)';
        const accent = isHot ? 'rgba(255, 80, 80, 0.7)' : 'rgba(120, 220, 255, 0.6)';

        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        switch (key) {
            case 'mic': {
                // Microphone body (rounded capsule)
                const mw = 10,
                    mh = 18;
                ctx.beginPath();
                ctx.moveTo(cx - mw, cy - mh + mw);
                ctx.arc(cx, cy - mh + mw, mw, Math.PI, 0); // top cap
                ctx.lineTo(cx + mw, cy + 2);
                ctx.arc(cx, cy + 2, mw, 0, Math.PI); // bottom cap
                ctx.closePath();
                ctx.fillStyle = isHot ? 'rgba(255, 100, 100, 0.85)' : 'rgba(120, 220, 255, 0.75)';
                ctx.fill();

                // Mic grille lines
                ctx.strokeStyle = isHot ? 'rgba(255, 180, 180, 0.4)' : 'rgba(180, 240, 255, 0.35)';
                ctx.lineWidth = 1.5;
                for (let i = -2; i <= 2; i++) {
                    const ly = cy - 8 + i * 6;
                    ctx.beginPath();
                    ctx.moveTo(cx - 6, ly);
                    ctx.lineTo(cx + 6, ly);
                    ctx.stroke();
                }

                // Cradle arc
                ctx.strokeStyle = color;
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(cx, cy + 2, 16, Math.PI * 0.15, Math.PI * 0.85);
                ctx.stroke();

                // Stem
                ctx.beginPath();
                ctx.moveTo(cx, cy + 17);
                ctx.lineTo(cx, cy + 24);
                ctx.stroke();

                // Base
                ctx.beginPath();
                ctx.moveTo(cx - 8, cy + 24);
                ctx.lineTo(cx + 8, cy + 24);
                ctx.stroke();

                // Pulsing ring when active
                if (isHot) {
                    ctx.strokeStyle = 'rgba(255, 80, 80, 0.3)';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
                    ctx.stroke();
                }
                break;
            }
            case 'send': {
                // Paper plane / send arrow
                ctx.fillStyle = accent;
                ctx.beginPath();
                ctx.moveTo(cx - 14, cy - 14);
                ctx.lineTo(cx + 16, cy);
                ctx.lineTo(cx - 14, cy + 14);
                ctx.lineTo(cx - 6, cy);
                ctx.closePath();
                ctx.fill();

                // Inner line
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(cx - 6, cy);
                ctx.lineTo(cx + 10, cy);
                ctx.stroke();
                break;
            }
            case 'clear': {
                // Circular refresh arrow
                ctx.strokeStyle = color;
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(cx, cy, 13, -Math.PI * 0.5, Math.PI * 1.2);
                ctx.stroke();

                // Arrow head
                const ax = cx + 13 * Math.cos(Math.PI * 1.2);
                const ay = cy + 13 * Math.sin(Math.PI * 1.2);
                ctx.beginPath();
                ctx.moveTo(ax - 6, ay - 4);
                ctx.lineTo(ax, ay);
                ctx.lineTo(ax + 2, ay - 7);
                ctx.stroke();
                break;
            }
            case 'settings': {
                // Gear icon
                const r = 12,
                    teeth = 6;
                ctx.beginPath();
                for (let i = 0; i < teeth * 2; i++) {
                    const angle = (i * Math.PI) / teeth - Math.PI / 2;
                    const rad = i % 2 === 0 ? r + 4 : r - 2;
                    const px = cx + rad * Math.cos(angle);
                    const py = cy + rad * Math.sin(angle);
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.stroke();

                // Center dot
                ctx.beginPath();
                ctx.arc(cx, cy, 4, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
                break;
            }
        }
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
     *   if (panel.handleUIAction(mesh.name, mesh.userData)) return;
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

        // XR Settings: Avatar Scale (cycles 0.5 → 1.0 → 1.5)
        if (key === 'xr_scale') {
            const scales = [0.5, 1.0, 1.5];
            const idx = scales.indexOf(this.xrSettings.avatarScale);
            this.xrSettings.avatarScale = scales[(idx + 1) % scales.length];
            console.log(`[VRChatPanel] Avatar scale → ${this.xrSettings.avatarScale}`);
            window.dispatchEvent(
                new CustomEvent('vr-setting-changed', {
                    detail: { key: 'avatarScale', value: this.xrSettings.avatarScale },
                })
            );
            this.redraw();
            return true;
        }

        // XR Settings: Environment toggle
        if (key === 'xr_env') {
            this.xrSettings.showEnvironment = !this.xrSettings.showEnvironment;
            console.log(`[VRChatPanel] Environment → ${this.xrSettings.showEnvironment}`);
            window.dispatchEvent(
                new CustomEvent('vr-setting-changed', {
                    detail: { key: 'showEnvironment', value: this.xrSettings.showEnvironment },
                })
            );
            this.redraw();
            return true;
        }

        // XR Settings: Movement Speed (cycles slow → normal → fast)
        if (key === 'xr_speed') {
            const speeds = ['slow', 'normal', 'fast'];
            const idx = speeds.indexOf(this.xrSettings.moveSpeed);
            this.xrSettings.moveSpeed = speeds[(idx + 1) % speeds.length];
            console.log(`[VRChatPanel] Move speed → ${this.xrSettings.moveSpeed}`);
            window.dispatchEvent(
                new CustomEvent('vr-setting-changed', {
                    detail: { key: 'moveSpeed', value: this.xrSettings.moveSpeed },
                })
            );
            this.redraw();
            return true;
        }

        // XR Settings: Background Color (cycles black → blue → void)
        if (key === 'xr_bg') {
            const cycle = { black: 'blue', blue: 'void', void: 'black' };
            this.xrSettings.vrBackground = cycle[this.xrSettings.vrBackground] || 'black';
            console.log(`[VRChatPanel] VR Background → ${this.xrSettings.vrBackground}`);
            window.dispatchEvent(
                new CustomEvent('vr-setting-changed', {
                    detail: { key: 'vrBackground', value: this.xrSettings.vrBackground },
                })
            );
            this.redraw();
            return true;
        }

        // XR Settings: Mode toggle (VR ↔ AR)
        if (key === 'xr_mode') {
            if (!this.xrSettings.arSupported) {
                console.log('[VRChatPanel] AR not supported on this device');
                return true;
            }
            const newMode = this.xrSettings.sessionMode === 'vr' ? 'ar' : 'vr';
            this.xrSettings.sessionMode = newMode;
            console.log(`[VRChatPanel] Session mode → ${newMode}`);
            window.dispatchEvent(
                new CustomEvent('vr-setting-changed', {
                    detail: { key: 'sessionMode', value: newMode },
                })
            );
            this.redraw();
            return true;
        }

        // XR Settings: Panel Distance (cycles near → medium → far)
        if (key === 'xr_distance') {
            const dists = ['near', 'medium', 'far'];
            const idx = dists.indexOf(this.xrSettings.panelDistance);
            this.xrSettings.panelDistance = dists[(idx + 1) % dists.length];
            const distMap = { near: 0.35, medium: 0.55, far: 0.85 };
            this._spawnDistance = distMap[this.xrSettings.panelDistance] || 0.55;
            console.log(`[VRChatPanel] Panel distance → ${this.xrSettings.panelDistance} (${this._spawnDistance}m)`);
            this.redraw();
            return true;
        }

        // Pose Preset cycle (relaxedStanding → naturalIdle → portrait → presentation)
        if (key === 'xr_pose_preset') {
            const pn = window.NEXUS_POSE_NORMALIZER;
            if (pn) {
                const presets = ['relaxedStanding', 'naturalIdle', 'portrait', 'presentation'];
                const s = pn.getSettings();
                const idx = presets.indexOf(s.preset);
                const next = presets[(idx + 1) % presets.length];
                pn.updateSettings({ preset: next });
                console.log(`[VRChatPanel] Pose preset → ${next}`);
            }
            this.redraw();
            return true;
        }

        // Pose Intensity cycle (0.2 → 0.35 → 0.55 → 0.75 → 1.0)
        if (key === 'xr_pose_intensity') {
            const pn = window.NEXUS_POSE_NORMALIZER;
            if (pn) {
                const levels = [0.2, 0.35, 0.55, 0.75, 1.0];
                const s = pn.getSettings();
                const closest = levels.reduce((a, b) =>
                    Math.abs(b - s.intensity) < Math.abs(a - s.intensity) ? b : a
                );
                const idx = levels.indexOf(closest);
                const next = levels[(idx + 1) % levels.length];
                pn.updateSettings({ intensity: next });
                console.log(`[VRChatPanel] Pose intensity → ${next}`);
            }
            this.redraw();
            return true;
        }

        return false;
    }

    // =====================================================================
    // DISPOSE
    // =====================================================================

    dispose() {
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

        // Clean up floating mic indicator
        if (this.micIndicator) {
            this.micIndicator.traverse((o) => {
                try {
                    o.geometry?.dispose?.();
                } catch (_) {}
                try {
                    o.material?.map?.dispose?.();
                } catch (_) {}
                try {
                    o.material?.dispose?.();
                } catch (_) {}
            });
            this.scene.remove(this.micIndicator);
        }
    }
}
