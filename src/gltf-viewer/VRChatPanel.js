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
        if (!scene || !camera) {
            throw new Error('[VRChatPanel] scene and camera are required');
        }

        this.scene = scene;
        this.camera = camera;
        this.leftController = controller || null;

        // -----------------------
        // State
        // -----------------------
        this.mode = 'chat'; // 'chat' | 'controls' | 'settings' (3-layer: Presence → Controls → Settings)
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
            puppetMode: false, // When true, grip translates avatar freely in 3D space
            intimacyMode: false, // Close-presence / comfort interaction mode in VR
            jointVisibility: 'hoverOnly', // 'hoverOnly' | 'alwaysVisible' — puppet handle spheres
            followGaze: true, // Follow-me eyes: avatar looks at user's HMD in VR
        };

        // Check AR support asynchronously
        if (navigator.xr) {
            navigator.xr
                .isSessionSupported('immersive-ar')
                .then((supported) => {
                    this.xrSettings.arSupported = supported;
                    console.log(`[VRChatPanel] AR supported: ${supported}`);
                    if (this.mode === 'settings') {
                        this.redraw();
                    }
                })
                .catch(() => {
                    // Quest browsers may reject the check during an active VR session.
                    // If user agent indicates Quest/Oculus, assume AR (passthrough) is supported.
                    const ua = navigator.userAgent || '';
                    if (/OculusBrowser|Quest/i.test(ua)) {
                        this.xrSettings.arSupported = true;
                        console.log('[VRChatPanel] Quest detected — assuming AR passthrough supported');
                        if (this.mode === 'settings') {
                            this.redraw();
                        }
                    }
                });
        } else {
            // No WebXR at all — check if Quest user agent (Meta browser may load XR late)
            const ua = navigator.userAgent || '';
            if (/OculusBrowser|Quest/i.test(ua)) {
                this.xrSettings.arSupported = true;
            }
        }

        // -----------------------
        // Drag & Position Logic (Quest-like controller-projection)
        // -----------------------
        this._isDragging = false;
        this._dragOffset = new THREE.Vector3(); // local offset from projected ray point to panel center
        this._dragDistance = 0; // distance along controller ray at grab start
        this._smoothPos = new THREE.Vector3(); // smoothed position target
        this._lerpFactor = 0.45; // position smoothing (0=frozen, 1=instant). 0.45 = Quest-like
        this._tmpCamPos = new THREE.Vector3();
        this._tmpVec3 = new THREE.Vector3();
        this._tmpVec3b = new THREE.Vector3();

        // Panel scale (Quest-style pinch-to-zoom)
        this._panelScale = 1.0;
        this._minScale = 0.5;
        this._maxScale = 2.5;

        // Comfortable range for Quest 3 (meters)
        // Increased spawn distance so panel doesn't appear too close on open
        this._minDistance = 0.35;
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
        if (s) {
            this.settings = { ...this.settings, ...s };
        }

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
                    model,
                    speech: speechSettings.speechVoice || 'auto',
                });

                return {
                    provider: unified.provider || 'none',
                    apiKey,
                    model,
                    baseUrl,
                    watsonxProjectId,
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

        // --- Mic icon sprite (white mic on dark circle, centered in ring) ---
        const iconSize = 128;
        const iconCanvas = document.createElement('canvas');
        iconCanvas.width = iconSize;
        iconCanvas.height = iconSize;
        const ic = iconCanvas.getContext('2d');

        // Dark circular background (sized to fit inside the pulsing ring)
        ic.fillStyle = 'rgba(20, 22, 28, 0.9)';
        ic.beginPath();
        ic.arc(iconSize / 2, iconSize / 2, iconSize / 2 - 4, 0, Math.PI * 2);
        ic.fill();

        // Mic icon (crisp vector: body capsule + cradle + stem + base)
        const cx = iconSize / 2;
        const cy = iconSize / 2 - 4;

        // Mic body (rounded capsule)
        const mw = 14,
            mh = 28,
            mr = 7;
        ic.fillStyle = '#ffffff';
        ic.beginPath();
        ic.moveTo(cx - mw / 2 + mr, cy - mh / 2);
        ic.lineTo(cx + mw / 2 - mr, cy - mh / 2);
        ic.quadraticCurveTo(cx + mw / 2, cy - mh / 2, cx + mw / 2, cy - mh / 2 + mr);
        ic.lineTo(cx + mw / 2, cy + mh / 2 - mr);
        ic.quadraticCurveTo(cx + mw / 2, cy + mh / 2, cx + mw / 2 - mr, cy + mh / 2);
        ic.lineTo(cx - mw / 2 + mr, cy + mh / 2);
        ic.quadraticCurveTo(cx - mw / 2, cy + mh / 2, cx - mw / 2, cy + mh / 2 - mr);
        ic.lineTo(cx - mw / 2, cy - mh / 2 + mr);
        ic.quadraticCurveTo(cx - mw / 2, cy - mh / 2, cx - mw / 2 + mr, cy - mh / 2);
        ic.fill();

        // Cradle arc under mic
        ic.strokeStyle = '#ffffff';
        ic.lineWidth = 3.5;
        ic.beginPath();
        ic.arc(cx, cy + 4, 15, 0, Math.PI, false);
        ic.stroke();

        // Stem
        ic.beginPath();
        ic.moveTo(cx, cy + 19);
        ic.lineTo(cx, cy + 28);
        ic.stroke();

        // Base
        ic.lineCap = 'round';
        ic.beginPath();
        ic.moveTo(cx - 9, cy + 28);
        ic.lineTo(cx + 9, cy + 28);
        ic.stroke();

        const iconTex = new THREE.CanvasTexture(iconCanvas);
        iconTex.needsUpdate = true;
        const iconMat = new THREE.SpriteMaterial({ map: iconTex, transparent: true, depthTest: false });
        const iconSprite = new THREE.Sprite(iconMat);
        iconSprite.scale.set(0.04, 0.04, 1);
        iconSprite.renderOrder = 999;
        this.micIndicator.add(iconSprite);

        // --- Pulsing red ring (larger, clearly frames the mic icon) ---
        const ringGeo = new THREE.RingGeometry(0.028, 0.035, 48);
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
        if (!this.micIndicator?.visible) {
            return;
        }

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
        if (!this.micIndicator?.visible || !this._micRing) {
            return;
        }

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

    /**
     * Begin drag using controller ray (Quest-style controller-projection).
     * @param {THREE.Vector3} rayOrigin   — controller world position
     * @param {THREE.Vector3} rayDirection — controller forward direction (unit)
     * @param {THREE.Vector3} hitPoint    — initial intersection point on panel
     */
    beginDrag(rayOrigin, rayDirection, hitPoint) {
        if (!rayOrigin || !rayDirection) {
            return false;
        }
        this._isDragging = true;

        // Record how far along the ray the panel sits at grab time
        this._dragDistance = hitPoint ? rayOrigin.distanceTo(hitPoint) : rayOrigin.distanceTo(this.group.position);

        // Offset between the projected point and the panel center (keeps grab
        // anchored where the user grabbed, not snapping to center)
        const projectedPoint = this._tmpVec3.copy(rayDirection).multiplyScalar(this._dragDistance).add(rayOrigin);
        this._dragOffset.copy(this.group.position).sub(projectedPoint);

        // Initialise smooth position to current position (no jump on first frame)
        this._smoothPos.copy(this.group.position);

        return true;
    }

    /**
     * Move panel along the controller ray each frame (no raycasting needed).
     * Uses lerp smoothing for Quest-native feel — eliminates jitter/blink.
     * @param {THREE.Vector3} rayOrigin    — controller world position this frame
     * @param {THREE.Vector3} rayDirection — controller forward direction (unit)
     */
    dragTo(rayOrigin, rayDirection) {
        if (!this._isDragging || !rayOrigin || !rayDirection) {
            return;
        }

        // Project controller ray forward by the stored grab distance + offset
        const targetPos = this._tmpVec3
            .copy(rayDirection)
            .multiplyScalar(this._dragDistance)
            .add(rayOrigin)
            .add(this._dragOffset);

        // Clamp distance from camera (comfort zone)
        this.camera.getWorldPosition(this._tmpCamPos);
        const dist = targetPos.distanceTo(this._tmpCamPos);
        const clamped = THREE.MathUtils.clamp(dist, this._minDistance, this._maxDistance);

        const dir = this._tmpVec3b.copy(targetPos).sub(this._tmpCamPos).normalize();
        const clampedTarget = this._tmpVec3.copy(this._tmpCamPos).add(dir.multiplyScalar(clamped));

        // Lerp for smooth movement (eliminates micro-jitter from controller tracking)
        this._smoothPos.lerp(clampedTarget, this._lerpFactor);
        this.group.position.copy(this._smoothPos);

        // Face user while dragging (Quest-like billboard)
        this.group.lookAt(this._tmpCamPos);
    }

    endDrag() {
        this._isDragging = false;
    }

    // =====================================================================
    // PANEL SCALE (Oculus Quest-style pinch-to-zoom / thumbstick zoom)
    // =====================================================================

    /**
     * Scale the panel by a delta factor (e.g. 0.05 to grow, -0.05 to shrink).
     * Called from VRControllers thumbstick Y while grip-dragging the panel.
     */
    scaleBy(delta) {
        this._panelScale = THREE.MathUtils.clamp(this._panelScale + delta, this._minScale, this._maxScale);
        this.group.scale.setScalar(this._panelScale);
    }

    /**
     * Set absolute scale for pinch-to-zoom (two-hand grab).
     */
    setScale(scale) {
        this._panelScale = THREE.MathUtils.clamp(scale, this._minScale, this._maxScale);
        this.group.scale.setScalar(this._panelScale);
    }

    getScale() {
        return this._panelScale;
    }

    /**
     * Check if a world-space hit point lands on the panel surface (for grab-anywhere).
     * Returns true if the point is within panel bounds (not just the handle).
     */
    isPointOnPanel(hitPoint) {
        if (!hitPoint || !this.group.visible) {
            return false;
        }
        // Check if ray hits the main panel mesh (broad area)
        return true; // If we got a hit on any interactable, it's on the panel
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
                this.group.translateX(0.18);
                this.group.translateY(0.08);
                this.group.translateZ(-0.35);

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
        if (mode === 'settings') {
            this.mode = 'settings';
        } else if (mode === 'controls') {
            this.mode = 'controls';
        } else {
            this.mode = 'chat';
        }
        this.redraw();
    }

    setStatus(status) {
        this.status = status || 'idle';

        // Show/hide floating mic indicator (works even when panel is hidden)
        if (this.micIndicator) {
            const listening = this.status === 'listening';
            this.micIndicator.visible = listening;
            if (listening) {
                this._micIndicatorTime = 0;
            }
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
        if (!this.avatars.length) {
            return 0;
        }
        this.currentAvatarIndex = (this.currentAvatarIndex + 1) % this.avatars.length;
        this.redraw();
        return this.currentAvatarIndex;
    }

    prevAvatar() {
        if (!this.avatars.length) {
            return 0;
        }
        this.currentAvatarIndex = (this.currentAvatarIndex - 1 + this.avatars.length) % this.avatars.length;
        this.redraw();
        return this.currentAvatarIndex;
    }

    appendMessage(role, text) {
        this.messages.push({ role, text: String(text ?? '').trim() });
        if (this.messages.length > 10) {
            this.messages.shift();
        }
        this.redraw();
    }

    /**
     * Phase 5: Append a rich message with text + attachments + directives.
     * @param {object} message - { role, text, attachments, directives }
     */
    appendRichMessage(message) {
        const entry = {
            role: message.role || 'bot',
            text: String(message.text ?? '').trim(),
            attachments: message.attachments || [],
            directives: message.directives || {},
        };
        this.messages.push(entry);
        if (this.messages.length > 10) {
            this.messages.shift();
        }
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

        // ─── LAYER 1: PRESENCE (Chat) ───────────────────────────────
        // Minimal header: title + status
        const handle = { x: P, y: P, w: W - P * 2, h: 80 };

        // Input bar at bottom (always visible in chat mode)
        // Increased button width and gap to prevent overlap
        const inputBarH = 100;
        const inputBarY = H - inputBarH - P;
        const inputBtnW = 130;
        const inputBtnGap = 16;
        const inputBar = {
            mic: { x: P, y: inputBarY, w: inputBtnW, h: inputBarH },
            send: { x: W - P - inputBtnW, y: inputBarY, w: inputBtnW, h: inputBarH },
            textArea: {
                x: P + inputBtnW + inputBtnGap,
                y: inputBarY,
                w: W - P * 2 - (inputBtnW * 2 + inputBtnGap * 2),
                h: inputBarH,
            },
        };

        // Status bar (just above input: pose name + controls button)
        // Added extra gap (16px) between buttons to prevent overlap
        const statusBarH = 64;
        const statusBarY = inputBarY - statusBarH - 14;
        const statusBtnW = 140;
        const statusBtnGap = 16;
        const statusBar = {
            poseName: { x: P, y: statusBarY, w: W - P * 2 - (statusBtnW * 2 + statusBtnGap + 20), h: statusBarH },
            controls: { x: W - P - statusBtnW * 2 - statusBtnGap, y: statusBarY, w: statusBtnW, h: statusBarH },
            settings: { x: W - P - statusBtnW, y: statusBarY, w: statusBtnW, h: statusBarH },
        };

        // Chat area (between header and status bar)
        const chatContentY = handle.y + handle.h + 14;
        const chatContentH = statusBarY - chatContentY - 10;
        const chatArea = { x: P, y: chatContentY, w: W - P * 2, h: chatContentH };

        // Quick chips (at bottom of chat area)
        const chipH = 56;
        const chipY = chatArea.y + chatArea.h - chipH - 8;
        const chipGap = 14;
        const chipW = (chatArea.w - chipGap * 2) / 3;
        const chips = [
            { key: 'q_sum', label: 'Summarize', x: P, y: chipY, w: chipW, h: chipH },
            { key: 'q_exp', label: 'Explain', x: P + chipW + chipGap, y: chipY, w: chipW, h: chipH },
            { key: 'q_nxt', label: 'Continue', x: P + (chipW + chipGap) * 2, y: chipY, w: chipW, h: chipH },
        ];

        // ─── LAYER 2: CONTROLS (Avatar Controls Panel) ──────────────
        const ctrlTopY = handle.y + handle.h + 14;
        const ctrlBtnH = 84;
        const ctrlGap = 16;
        const ctrlW = W - P * 2;

        // Back button
        const ctrlBack = { x: P, y: ctrlTopY, w: 180, h: 72 };
        // Title "Avatar Controls" (drawn, not a hitbox)

        // Section 1: POSE
        const poseSectionY = ctrlTopY + 90;
        const poseLabelRect = { x: P, y: poseSectionY, w: ctrlW, h: 48 };

        // Pose navigation: ◀ Prev | Pose Name | Next ▶ | Reset
        const poseNavY = poseSectionY + 56;
        const poseNavBtnW = (ctrlW - ctrlGap * 3) / 4;
        const ctrlPoseNav = {
            posePrev: { x: P, y: poseNavY, w: poseNavBtnW, h: ctrlBtnH },
            poseNext: { x: P + poseNavBtnW + ctrlGap, y: poseNavY, w: poseNavBtnW, h: ctrlBtnH },
            poseReset: { x: P + (poseNavBtnW + ctrlGap) * 2, y: poseNavY, w: poseNavBtnW, h: ctrlBtnH },
            clear: { x: P + (poseNavBtnW + ctrlGap) * 3, y: poseNavY, w: poseNavBtnW, h: ctrlBtnH },
        };

        // Section 2: INTERACTION
        const interSectionY = poseNavY + ctrlBtnH + 24;
        const interLabelRect = { x: P, y: interSectionY, w: ctrlW, h: 48 };

        const interNavY = interSectionY + 56;
        const interBtnW = (ctrlW - ctrlGap * 2) / 3;
        const interBtnW2 = (ctrlW - ctrlGap) / 2; // wider buttons for row 2
        const ctrlInteraction = {
            intensity: { x: P, y: interNavY, w: interBtnW, h: ctrlBtnH },
            puppet: { x: P + interBtnW + ctrlGap, y: interNavY, w: interBtnW, h: ctrlBtnH },
            place: { x: P + (interBtnW + ctrlGap) * 2, y: interNavY, w: interBtnW, h: ctrlBtnH },
            close: { x: P, y: interNavY + ctrlBtnH + ctrlGap, w: interBtnW2, h: ctrlBtnH },
            ar: { x: P + interBtnW2 + ctrlGap, y: interNavY + ctrlBtnH + ctrlGap, w: interBtnW2, h: ctrlBtnH },
        };

        // Section 3: AVATAR SELECTION
        const avatarSectionY = interNavY + ctrlBtnH + ctrlBtnH + ctrlGap + 24;
        const avatarLabelRect = { x: P, y: avatarSectionY, w: ctrlW, h: 48 };

        const avatarNavY = avatarSectionY + 56;
        const avatarNavBtnW = (ctrlW - ctrlGap) / 2;
        const ctrlAvatarNav = {
            prev: { x: P, y: avatarNavY, w: avatarNavBtnW, h: ctrlBtnH },
            next: { x: P + avatarNavBtnW + ctrlGap, y: avatarNavY, w: avatarNavBtnW, h: ctrlBtnH },
        };

        // Advanced Settings button at bottom of controls
        const ctrlAdvancedY = avatarNavY + ctrlBtnH + 20;
        const ctrlAdvanced = { x: P, y: ctrlAdvancedY, w: ctrlW, h: 72 };

        // ─── LAYER 3: SETTINGS (Advanced / Rarely Used) ──────────────
        const setTopY = handle.y + handle.h + 14;

        // Back button
        const settingsBack = { x: P, y: setTopY, w: 180, h: 72 };

        // STT / TTS toggles
        const toggleY = setTopY + 90;
        const toggleW = (ctrlW - ctrlGap) / 2;
        const settingsToggles = {
            stt: { x: P, y: toggleY, w: toggleW, h: ctrlBtnH },
            tts: { x: P + toggleW + ctrlGap, y: toggleY, w: toggleW, h: ctrlBtnH },
        };

        // XR Settings (6 buttons in 2 rows of 3)
        const xrLabelY = toggleY + ctrlBtnH + 20;
        const xrLabelRect = { x: P, y: xrLabelY, w: ctrlW, h: 44 };

        const xrY = xrLabelY + 52;
        const xrBtnW = (ctrlW - ctrlGap * 2) / 3;
        const xrH = ctrlBtnH;
        const xrSettingsRow = {
            scale: { x: P, y: xrY, w: xrBtnW, h: xrH },
            env: { x: P + (xrBtnW + ctrlGap), y: xrY, w: xrBtnW, h: xrH },
            speed: { x: P + (xrBtnW + ctrlGap) * 2, y: xrY, w: xrBtnW, h: xrH },
        };

        const xrY2 = xrY + xrH + ctrlGap;
        const xrSettingsRow2 = {
            distance: { x: P, y: xrY2, w: xrBtnW, h: xrH },
            bg: { x: P + (xrBtnW + ctrlGap), y: xrY2, w: xrBtnW, h: xrH },
            mode: { x: P + (xrBtnW + ctrlGap) * 2, y: xrY2, w: xrBtnW, h: xrH },
        };

        // Row 3: Joint visibility + Follow-me gaze toggle
        const xrY3 = xrY2 + xrH + ctrlGap;
        const xrSettingsRow3 = {
            joints: { x: P, y: xrY3, w: xrBtnW, h: xrH },
            gaze: { x: P + (xrBtnW + ctrlGap), y: xrY3, w: xrBtnW, h: xrH },
        };

        // Provider info (read-only display at bottom)
        const providerInfoY = xrY3 + xrH + 20;
        const providerInfoRect = { x: P, y: providerInfoY, w: ctrlW, h: 120 };

        return {
            W,
            H,
            handle,
            inputBar,
            statusBar,
            chatArea,
            chips,
            // Layer 2: Controls
            ctrlBack,
            poseLabelRect,
            ctrlPoseNav,
            interLabelRect,
            ctrlInteraction,
            avatarLabelRect,
            ctrlAvatarNav,
            ctrlAdvanced,
            // Layer 3: Settings
            settingsBack,
            settingsToggles,
            xrLabelRect,
            xrSettingsRow,
            xrSettingsRow2,
            xrSettingsRow3,
            providerInfoRect,
        };
    }

    _createHitboxes() {
        const L = this._layout;

        // ─── ALWAYS VISIBLE: Handle (drag) ───
        this.buttons.handle = this._makeHitbox('Handle:move', L.handle, 'handle', { key: 'handle' });

        // Full-panel grab surface — allows Quest-style grip-to-grab from anywhere on the panel
        // Positioned slightly behind other hitboxes so buttons still work with trigger
        const panelSurface = { x: 0, y: 0, w: this.canvasW, h: this.canvasH };
        this.buttons.panelGrab = this._makeHitbox('Handle:panel_grab', panelSurface, 'handle', { key: 'handle' });
        this.buttons.panelGrab.position.z = -0.005; // Behind button hitboxes

        // ─── LAYER 1: PRESENCE (Chat) ───
        this.chatGroup = new THREE.Group();
        this.chatGroup.name = 'ChatGroup';
        this.group.add(this.chatGroup);

        // Input bar: mic + send
        const mic = this._makeHitbox('Btn:mic', L.inputBar.mic, 'button', { key: 'mic', label: 'MIC' });
        const send = this._makeHitbox('Btn:send', L.inputBar.send, 'button', { key: 'send', label: 'SEND' });
        this.group.remove(mic);
        this.group.remove(send);
        this.chatGroup.add(mic);
        this.chatGroup.add(send);
        this.buttons.mic = mic;
        this.buttons.send = send;

        // Status bar: controls + settings buttons
        const ctrlBtn = this._makeHitbox('Btn:open_controls', L.statusBar.controls, 'button', { key: 'open_controls' });
        const setBtn = this._makeHitbox('Btn:open_settings', L.statusBar.settings, 'button', { key: 'open_settings' });
        this.group.remove(ctrlBtn);
        this.group.remove(setBtn);
        this.chatGroup.add(ctrlBtn);
        this.chatGroup.add(setBtn);
        this.buttons.open_controls = ctrlBtn;
        this.buttons.open_settings = setBtn;

        // Chat area hitbox (for attachment card tap detection)
        this.buttons.chatArea = this._makeHitbox('ChatArea:tap', L.chatArea, 'chat-area', { key: 'chat-area' });
        this.buttons.chatArea.position.z = 0.005;
        this.group.remove(this.buttons.chatArea);
        this.chatGroup.add(this.buttons.chatArea);

        // Chips
        L.chips.forEach((c) => {
            const chip = this._makeHitbox(`Chip:${c.key}`, c, 'chip', { key: c.key, label: c.label });
            this.group.remove(chip);
            this.chatGroup.add(chip);
            this.buttons[c.key] = chip;
        });

        // ─── LAYER 2: CONTROLS (Avatar Controls Panel) ───
        this.controlsGroup = new THREE.Group();
        this.controlsGroup.name = 'ControlsGroup';
        this.group.add(this.controlsGroup);

        // Back button
        const ctrlBack = this._makeHitbox('Btn:ctrl_back', L.ctrlBack, 'button', { key: 'back' });
        this.group.remove(ctrlBack);
        this.controlsGroup.add(ctrlBack);
        this.buttons.ctrl_back = ctrlBack;

        // Pose navigation
        const poseNav = L.ctrlPoseNav;
        const posePrev = this._makeHitbox('Btn:xr_pose_prev', poseNav.posePrev, 'button', { key: 'xr_pose_prev' });
        const poseNext = this._makeHitbox('Btn:xr_pose_next', poseNav.poseNext, 'button', { key: 'xr_pose_next' });
        const poseReset = this._makeHitbox('Btn:xr_pose_reset', poseNav.poseReset, 'button', { key: 'xr_pose_reset' });
        const clearBtn = this._makeHitbox('Btn:clear', poseNav.clear, 'button', { key: 'clear', label: 'CLEAR' });

        [posePrev, poseNext, poseReset, clearBtn].forEach((m) => {
            this.group.remove(m);
            this.controlsGroup.add(m);
        });
        this.buttons.xr_pose_prev = posePrev;
        this.buttons.xr_pose_next = poseNext;
        this.buttons.xr_pose_reset = poseReset;
        this.buttons.clear = clearBtn;

        // Interaction buttons
        const inter = L.ctrlInteraction;
        const ik = this._makeHitbox('Btn:xr_pose_intensity', inter.intensity, 'button', { key: 'xr_pose_intensity' });
        const puppet = this._makeHitbox('Btn:xr_puppet', inter.puppet, 'button', { key: 'xr_puppet' });
        const place = this._makeHitbox('Btn:xr_place', inter.place, 'button', { key: 'xr_place' });
        const closeBtn = this._makeHitbox('Btn:xr_intimacy', inter.close, 'button', { key: 'xr_intimacy' });
        const arBtn = this._makeHitbox('Btn:xr_ar', inter.ar, 'button', { key: 'xr_ar' });
        [ik, puppet, place, closeBtn, arBtn].forEach((m) => {
            this.group.remove(m);
            this.controlsGroup.add(m);
        });
        this.buttons.xr_pose_intensity = ik;
        this.buttons.xr_puppet = puppet;
        this.buttons.xr_place = place;
        this.buttons.xr_intimacy = closeBtn;
        this.buttons.xr_ar = arBtn;

        // Avatar navigation
        const avNav = L.ctrlAvatarNav;
        const avPrev = this._makeHitbox('Btn:avatar_prev', avNav.prev, 'button', { key: 'avatar_prev' });
        const avNext = this._makeHitbox('Btn:avatar_next', avNav.next, 'button', { key: 'avatar_next' });
        [avPrev, avNext].forEach((m) => {
            this.group.remove(m);
            this.controlsGroup.add(m);
        });
        this.buttons.avatar_prev = avPrev;
        this.buttons.avatar_next = avNext;

        // Advanced settings button
        const advanced = this._makeHitbox('Btn:open_advanced', L.ctrlAdvanced, 'button', { key: 'open_settings' });
        this.group.remove(advanced);
        this.controlsGroup.add(advanced);
        this.buttons.ctrl_advanced = advanced;

        // ─── LAYER 3: SETTINGS (Advanced) ───
        this.settingsGroup = new THREE.Group();
        this.settingsGroup.name = 'SettingsGroup';
        this.group.add(this.settingsGroup);

        // Back button
        const setBack = this._makeHitbox('Btn:set_back', L.settingsBack, 'button', { key: 'back' });
        this.group.remove(setBack);
        this.settingsGroup.add(setBack);
        this.buttons.set_back = setBack;

        // STT/TTS toggles
        const toggles = L.settingsToggles;
        const stt = this._makeHitbox('Btn:stt', toggles.stt, 'toggle', { key: 'stt' });
        const tts = this._makeHitbox('Btn:tts', toggles.tts, 'toggle', { key: 'tts' });
        [stt, tts].forEach((m) => {
            this.group.remove(m);
            this.settingsGroup.add(m);
        });
        this.buttons.stt = stt;
        this.buttons.tts = tts;

        // XR Settings row 1
        const xr = L.xrSettingsRow;
        const xrScale = this._makeHitbox('Btn:xr_scale', xr.scale, 'button', { key: 'xr_scale' });
        const xrEnv = this._makeHitbox('Btn:xr_env', xr.env, 'button', { key: 'xr_env' });
        const xrSpeed = this._makeHitbox('Btn:xr_speed', xr.speed, 'button', { key: 'xr_speed' });
        [xrScale, xrEnv, xrSpeed].forEach((m) => {
            this.group.remove(m);
            this.settingsGroup.add(m);
        });
        this.buttons.xr_scale = xrScale;
        this.buttons.xr_env = xrEnv;
        this.buttons.xr_speed = xrSpeed;

        // XR Settings row 2
        const xr2 = L.xrSettingsRow2;
        const xrDist = this._makeHitbox('Btn:xr_distance', xr2.distance, 'button', { key: 'xr_distance' });
        const xrBg = this._makeHitbox('Btn:xr_bg', xr2.bg, 'button', { key: 'xr_bg' });
        const xrMode = this._makeHitbox('Btn:xr_mode', xr2.mode, 'button', { key: 'xr_mode' });
        [xrDist, xrBg, xrMode].forEach((m) => {
            this.group.remove(m);
            this.settingsGroup.add(m);
        });
        this.buttons.xr_distance = xrDist;
        this.buttons.xr_bg = xrBg;
        this.buttons.xr_mode = xrMode;

        // XR Settings row 3
        const xr3 = L.xrSettingsRow3;
        const xrJoints = this._makeHitbox('Btn:xr_joints', xr3.joints, 'button', { key: 'xr_joints' });
        const xrGaze = this._makeHitbox('Btn:xr_gaze', xr3.gaze, 'button', { key: 'xr_gaze' });
        [xrJoints, xrGaze].forEach((m) => {
            this.group.remove(m);
            this.settingsGroup.add(m);
        });
        this.buttons.xr_joints = xrJoints;
        this.buttons.xr_gaze = xrGaze;
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

        // Header (handle) — always visible
        const h = L.handle;
        this._roundRect(ctx, h.x, h.y, h.w, h.h, 22);
        ctx.fillStyle = T.header;
        ctx.fill();

        // Handle pill (grabbable cue)
        this._roundRect(ctx, h.x + h.w / 2 - 70, h.y + 10, 140, 10, 999);
        ctx.fillStyle = T.handlePill;
        ctx.fill();

        // Title (left)
        ctx.fillStyle = T.text;
        ctx.font = '800 36px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('HomePilot', h.x + 22, h.y + 56);

        // Status indicator (right) — colored dot + label
        ctx.textAlign = 'right';
        const statusX = L.W - this.padding - 22;
        const statusY = h.y + 52;

        // Status dot
        ctx.beginPath();
        ctx.arc(statusX - ctx.measureText(this._statusLabel()).width - 20, statusY - 8, 8, 0, Math.PI * 2);
        ctx.fillStyle = this._statusColor();
        ctx.fill();

        ctx.font = '700 24px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillStyle = this._statusColor();
        ctx.fillText(this._statusLabel(), statusX, statusY);
        ctx.textAlign = 'left';

        // Draw the active layer
        if (this.mode === 'controls') {
            this._drawControls(ctx);
        } else if (this.mode === 'settings') {
            this._drawSettings(ctx);
        } else {
            this._drawChat(ctx);
        }

        // Show/hide layer groups
        this.chatGroup.visible = this.mode === 'chat';
        this.controlsGroup.visible = this.mode === 'controls';
        this.settingsGroup.visible = this.mode === 'settings';

        this.texture.needsUpdate = true;
    }

    _drawChat(ctx) {
        const L = this._layout;
        const T = this.theme;
        const area = L.chatArea;

        // Clear attachment hit areas for this frame
        this._attachmentHitAreas = [];

        // ─── Messages ───
        const pad = 16;
        let y = area.y + pad;

        const msgs = this.messages.slice(-6);

        msgs.forEach((m) => {
            const isUser = m.role === 'user';
            const label = isUser ? 'You' : 'AI';

            // Role label (small, subtle)
            ctx.font = '700 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
            ctx.fillStyle = isUser ? T.accent : 'rgba(140, 255, 180, 0.85)';
            ctx.fillText(label, area.x + 18, y + 18);
            y += 28;

            // Message text
            ctx.font = '500 30px system-ui, -apple-system, Segoe UI, Roboto, Arial';
            ctx.fillStyle = T.text;
            y = this._wrapText(ctx, m.text, area.x + 18, y + 8, area.x + area.w - 18, 38) + 14;

            // Attachment cards
            if (m.attachments && m.attachments.length > 0) {
                const images = m.attachments.filter((a) => a.type === 'image');
                images.forEach((att) => {
                    y += 6;
                    const cardH = this._drawAttachmentCard(ctx, att, area.x + 18, y, area.w - 36);
                    y += cardH;
                });
            }

            y += 12;
            if (y > area.y + area.h - 100) {
                return;
            }
        });

        // Transcript display (STT)
        if (this.transcript && this.transcriptMode !== 'idle') {
            const transcriptY = area.y + area.h - 120;
            const isInterim = this.transcriptMode === 'interim';

            ctx.font = '600 20px system-ui, -apple-system, Segoe UI, Roboto, Arial';
            ctx.fillStyle = isInterim ? T.accent : 'rgba(255, 215, 0, 0.95)';
            ctx.fillText(isInterim ? 'Listening...' : 'Heard:', area.x + 18, transcriptY);

            ctx.font = `${isInterim ? 'italic' : 'normal'} 28px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
            ctx.fillStyle = T.text;
            this._wrapText(ctx, this.transcript, area.x + 18, transcriptY + 30, area.x + area.w - 18, 34);
        }

        // Quick chips (only when no messages or idle)
        if (this.messages.length === 0 || this.status === 'idle') {
            L.chips.forEach((c) => {
                this._roundRect(ctx, c.x, c.y, c.w, c.h, 16);
                ctx.fillStyle = T.chipBg;
                ctx.fill();

                ctx.fillStyle = T.chipText;
                ctx.font = '700 24px system-ui, -apple-system, Segoe UI, Roboto, Arial';
                ctx.textAlign = 'center';
                ctx.fillText(c.label, c.x + c.w / 2, c.y + 38);
                ctx.textAlign = 'left';
            });
        }

        // ─── Status Bar: Pose name + Controls + Settings ───
        const sb = L.statusBar;

        // Pose name (subtle, informational)
        const poseName = this._getCurrentPoseName();
        this._roundRect(ctx, sb.poseName.x, sb.poseName.y, sb.poseName.w, sb.poseName.h, 14);
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fill();
        ctx.fillStyle = T.textDim;
        ctx.font = '600 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText(`Pose: ${poseName}`, sb.poseName.x + 14, sb.poseName.y + 40);

        // Controls button
        this._drawPresenceBtn(ctx, sb.controls, '⚙ Controls');

        // Settings button (gear icon)
        this._drawPresenceBtn(ctx, sb.settings, '⋯ More');

        // ─── Input Bar: Mic + Text + Send ───
        const ib = L.inputBar;

        // Mic button
        const isListening = this.status === 'listening';
        this._roundRect(ctx, ib.mic.x, ib.mic.y, ib.mic.w, ib.mic.h, 20);
        ctx.fillStyle = isListening ? 'rgba(255, 60, 60, 0.28)' : T.btnBg;
        ctx.fill();
        if (isListening) {
            ctx.strokeStyle = 'rgba(255, 80, 80, 0.6)';
            ctx.lineWidth = 2;
            this._roundRect(ctx, ib.mic.x, ib.mic.y, ib.mic.w, ib.mic.h, 20);
            ctx.stroke();
        }
        ctx.save();
        this._drawVectorIcon(ctx, 'mic', ib.mic.x + ib.mic.w / 2, ib.mic.y + 38, isListening);
        ctx.restore();
        ctx.fillStyle = isListening ? 'rgba(255, 120, 120, 0.95)' : T.textDim;
        ctx.font = '700 18px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText(isListening ? 'STOP' : 'SPEAK', ib.mic.x + ib.mic.w / 2, ib.mic.y + 80);
        ctx.textAlign = 'left';

        // Text area placeholder
        this._roundRect(ctx, ib.textArea.x, ib.textArea.y, ib.textArea.w, ib.textArea.h, 18);
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        this._roundRect(ctx, ib.textArea.x, ib.textArea.y, ib.textArea.w, ib.textArea.h, 18);
        ctx.stroke();
        ctx.fillStyle = T.textDim;
        ctx.font = '500 26px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('Speak or type a message...', ib.textArea.x + 18, ib.textArea.y + 58);

        // Send button
        this._roundRect(ctx, ib.send.x, ib.send.y, ib.send.w, ib.send.h, 20);
        ctx.fillStyle = T.btnBg;
        ctx.fill();
        ctx.save();
        this._drawVectorIcon(ctx, 'send', ib.send.x + ib.send.w / 2, ib.send.y + 38, false);
        ctx.restore();
        ctx.fillStyle = T.textDim;
        ctx.font = '700 18px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText('SEND', ib.send.x + ib.send.w / 2, ib.send.y + 80);
        ctx.textAlign = 'left';
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
        if (this._thumbnailCache.has(url)) {
            return;
        }

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
     * @returns {object | null} The attachment object if hit, null otherwise
     */
    handleAttachmentTap(canvasX, canvasY) {
        for (const area of this._attachmentHitAreas) {
            if (canvasX >= area.x && canvasX <= area.x + area.w && canvasY >= area.y && canvasY <= area.y + area.h) {
                return area.attachment;
            }
        }
        return null;
    }

    // ─── Helper: Get current pose name ───
    _getCurrentPoseName() {
        const vps = window.vrPoseSystem;
        const pn = window.NEXUS_POSE_NORMALIZER;

        if (vps) {
            const poseShort = vps.getCurrentPreset() || 'standing';
            return typeof vps.constructor.getPresetLabel === 'function'
                ? vps.constructor.getPresetLabel(poseShort)
                : poseShort;
        } else if (pn) {
            const pnSettings = pn.getSettings();
            const poseShort = pnSettings.preset || 'relaxedStanding';
            const pnNames = {
                relaxedStanding: 'Relaxed Standing',
                naturalIdle: 'Natural Idle',
                portrait: 'Portrait',
                presentation: 'Presentation',
            };
            return pnNames[poseShort] || poseShort;
        }
        return 'Standing (Rest)';
    }

    // ─── Helper: Draw a small presence button ───
    _drawPresenceBtn(ctx, rect, label) {
        const T = this.theme;
        this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
        ctx.stroke();

        ctx.fillStyle = T.textDim;
        ctx.font = '700 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText(label, rect.x + rect.w / 2, rect.y + 40);
        ctx.textAlign = 'left';
    }

    // ─── LAYER 2: CONTROLS (Avatar Controls Panel) ───
    _drawControls(ctx) {
        const L = this._layout;
        const T = this.theme;
        const P = this.padding;
        const xs = this.xrSettings;

        // Back button
        this._drawSoftBtn(ctx, L.ctrlBack, '← Back', false);

        // Title
        ctx.fillStyle = T.text;
        ctx.font = '800 34px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('Avatar Controls', P + 200, L.ctrlBack.y + 50);

        // ─── Section 1: POSE ───
        ctx.fillStyle = T.textDim;
        ctx.font = '700 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('POSE', L.poseLabelRect.x + 14, L.poseLabelRect.y + 34);

        // Current pose name
        const poseName = this._getCurrentPoseName();
        ctx.fillStyle = T.accent;
        ctx.font = '900 24px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText(poseName, L.poseLabelRect.x + 90, L.poseLabelRect.y + 35);

        // Pose buttons
        const pn = L.ctrlPoseNav;
        this._drawControlBtn(ctx, pn.posePrev, '◀ Prev');
        this._drawControlBtn(ctx, pn.poseNext, 'Next ▶');
        this._drawControlBtn(ctx, pn.poseReset, 'Reset');
        this._drawControlBtn(ctx, pn.clear, 'Clear Chat');

        // ─── Section 2: INTERACTION ───
        ctx.fillStyle = T.textDim;
        ctx.font = '700 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('INTERACTION', L.interLabelRect.x + 14, L.interLabelRect.y + 34);

        const inter = L.ctrlInteraction;
        const vps = window.vrPoseSystem;
        const ikLabel = vps && vps.ikEnabled ? 'IK: ON' : 'IK: OFF';
        this._drawControlBtn(ctx, inter.intensity, ikLabel, vps && vps.ikEnabled);

        const puppetActive = xs.puppetMode;
        this._drawControlBtn(ctx, inter.puppet, puppetActive ? 'Puppet: ON' : 'Puppet', puppetActive);

        const placeActive = xs.puppetMode && xs.vrBackground === 'passthrough';
        this._drawControlBtn(ctx, inter.place, placeActive ? 'Place: ON' : 'Place', placeActive);

        const closeActive = xs.intimacyMode;
        this._drawControlBtn(ctx, inter.close, closeActive ? 'Close: ON' : 'Close', closeActive);

        // AR Passthrough toggle button (switches VR ↔ AR session)
        const arActive = xs.sessionMode === 'ar';
        const arLabel = arActive ? 'AR: ON' : xs.arSupported ? 'AR' : 'AR N/A';
        this._drawControlBtn(ctx, inter.ar, arLabel, arActive);

        // Puppet hint
        if (puppetActive) {
            ctx.fillStyle = 'rgba(200, 255, 200, 0.5)';
            ctx.font = '500 18px system-ui, -apple-system, Segoe UI, Roboto, Arial';
            ctx.fillText(
                'Grip orbs to move avatar. Both hands on hips to rotate.',
                P + 14,
                inter.puppet.y + inter.puppet.h + 22
            );
        }

        // ─── Section 3: AVATAR SELECTION ───
        ctx.fillStyle = T.textDim;
        ctx.font = '700 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('AVATAR', L.avatarLabelRect.x + 14, L.avatarLabelRect.y + 34);

        // Avatar name + counter
        const total = this.avatars.length;
        const idx = total ? this.currentAvatarIndex : 0;
        const avatarName = total ? this.avatars[idx]?.name || `Avatar ${idx + 1}` : 'No avatars';
        ctx.fillStyle = T.text;
        ctx.font = '800 26px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText(
            `${avatarName}  (${total ? idx + 1 : 0}/${total})`,
            L.avatarLabelRect.x + 110,
            L.avatarLabelRect.y + 35
        );

        const avNav = L.ctrlAvatarNav;
        this._drawControlBtn(ctx, avNav.prev, '◀ Previous Avatar');
        this._drawControlBtn(ctx, avNav.next, 'Next Avatar ▶');

        // ─── Advanced Settings Link ───
        const adv = L.ctrlAdvanced;
        this._roundRect(ctx, adv.x, adv.y, adv.w, adv.h, 16);
        ctx.fillStyle = 'rgba(120, 220, 255, 0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(120, 220, 255, 0.2)';
        ctx.lineWidth = 1;
        this._roundRect(ctx, adv.x, adv.y, adv.w, adv.h, 16);
        ctx.stroke();

        ctx.fillStyle = T.accent;
        ctx.font = '700 24px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText('⚙  Advanced Settings  →', adv.x + adv.w / 2, adv.y + 46);
        ctx.textAlign = 'left';
    }

    // ─── Helper: Draw a control panel button ───
    _drawControlBtn(ctx, rect, label, isActive = false) {
        const T = this.theme;
        this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 16);

        if (isActive) {
            ctx.fillStyle = 'rgba(118, 255, 3, 0.12)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(118, 255, 3, 0.3)';
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        }
        ctx.lineWidth = 1;
        this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 16);
        ctx.stroke();

        ctx.fillStyle = isActive ? 'rgba(118, 255, 3, 0.95)' : T.text;
        ctx.font = '800 24px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 9);
        ctx.textAlign = 'left';
    }

    // ─── LAYER 3: SETTINGS (Advanced, rarely used) ───
    _drawSettings(ctx) {
        const L = this._layout;
        const T = this.theme;
        const P = this.padding;
        const xs = this.xrSettings;

        // Back button
        this._drawSoftBtn(ctx, L.settingsBack, '← Back', false);

        // Title
        ctx.fillStyle = T.text;
        ctx.font = '800 34px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('Settings', P + 200, L.settingsBack.y + 50);

        // STT/TTS Toggles
        this._drawSoftToggle(ctx, L.settingsToggles.stt, 'MIC INPUT', this.sttEnabled);
        this._drawSoftToggle(ctx, L.settingsToggles.tts, 'VOICE OUT', this.ttsEnabled);

        // XR Settings label
        ctx.fillStyle = T.textDim;
        ctx.font = '700 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('XR ENVIRONMENT', L.xrLabelRect.x + 14, L.xrLabelRect.y + 32);

        // Row 1: Scale, Env, Speed
        const xr = L.xrSettingsRow;
        const scaleLabel = xs.avatarScale === 0.5 ? 'S' : xs.avatarScale === 1.5 ? 'L' : 'M';
        this._drawXRSettingBtn(ctx, xr.scale, 'SCALE', scaleLabel);
        this._drawXRSettingBtn(ctx, xr.env, 'ENV', xs.showEnvironment ? 'ON' : 'OFF', xs.showEnvironment);
        const speedLabel = xs.moveSpeed === 'slow' ? 'SLOW' : xs.moveSpeed === 'fast' ? 'FAST' : 'MED';
        this._drawXRSettingBtn(ctx, xr.speed, 'SPEED', speedLabel);

        // Row 2: Distance, BG, Mode
        const xr2 = L.xrSettingsRow2;
        const distLabel = xs.panelDistance === 'near' ? 'NEAR' : xs.panelDistance === 'far' ? 'FAR' : 'MED';
        this._drawXRSettingBtn(ctx, xr2.distance, 'PANEL', distLabel);

        const bgLabel =
            xs.vrBackground === 'blue'
                ? 'BLUE'
                : xs.vrBackground === 'void'
                  ? 'VOID'
                  : xs.vrBackground === 'passthrough'
                    ? 'PASS'
                    : 'BLK';
        this._drawXRSettingBtn(ctx, xr2.bg, 'BG', bgLabel);

        // Green tint for passthrough
        if (xs.vrBackground === 'passthrough') {
            this._drawActiveTint(ctx, xr2.bg, 'BG', 'PASS');
        }

        // Mode button
        if (xs.arSupported) {
            const modeActive = xs.sessionMode === 'ar';
            this._drawXRSettingBtn(ctx, xr2.mode, 'VIEW', modeActive ? 'PASS' : 'VR', true);
            if (modeActive) {
                this._drawActiveTint(ctx, xr2.mode, 'VIEW', 'PASS');
            }
        } else {
            this._drawXRSettingBtn(ctx, xr2.mode, 'VIEW', 'VR', false);
        }

        // Row 3: Joint Visibility + Follow-me Gaze
        const xr3 = L.xrSettingsRow3;
        const jointLabel = xs.jointVisibility === 'alwaysVisible' ? 'ALL' : 'HOVER';
        const jointActive = xs.jointVisibility === 'alwaysVisible';
        this._drawXRSettingBtn(ctx, xr3.joints, 'JOINTS', jointLabel, true);
        if (jointActive) {
            this._drawActiveTint(ctx, xr3.joints, 'JOINTS', 'ALL');
        }

        const gazeActive = xs.followGaze !== false;
        const gazeLabel = gazeActive ? 'ON' : 'OFF';
        this._drawXRSettingBtn(ctx, xr3.gaze, 'GAZE', gazeLabel, true);
        if (gazeActive) {
            this._drawActiveTint(ctx, xr3.gaze, 'GAZE', 'ON');
        }

        // Provider info (read-only)
        const pi = L.providerInfoRect;
        this._roundRect(ctx, pi.x, pi.y, pi.w, pi.h, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fill();

        ctx.fillStyle = T.textDim;
        ctx.font = '600 20px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('AI CONFIGURATION (synced from desktop)', pi.x + 14, pi.y + 30);

        const providerText = this.settings.provider || 'none';
        const modelText = this.settings.model || '(auto)';
        ctx.fillStyle = providerText !== 'none' ? T.accent : T.textDim;
        ctx.font = '700 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText(`Provider: ${providerText.toUpperCase()}`, pi.x + 14, pi.y + 62);

        ctx.fillStyle = T.textDim;
        ctx.font = '500 20px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        const truncModel = modelText.length > 40 ? `${modelText.slice(0, 37)}...` : modelText;
        ctx.fillText(`Model: ${truncModel}`, pi.x + 14, pi.y + 90);

        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '500 18px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('Change provider/model in desktop settings.', pi.x + 14, pi.y + 112);
    }

    // ─── Helper: Green active tint overlay ───
    _drawActiveTint(ctx, rect, topLabel, bottomLabel) {
        ctx.save();
        this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
        ctx.fillStyle = 'rgba(118, 255, 3, 0.12)';
        ctx.fill();
        ctx.fillStyle = 'rgba(118, 255, 3, 0.7)';
        ctx.font = '700 18px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText(topLabel, rect.x + rect.w / 2, rect.y + 30);
        ctx.fillStyle = 'rgba(118, 255, 3, 0.95)';
        ctx.font = '900 20px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText(bottomLabel, rect.x + rect.w / 2, rect.y + 60);
        ctx.textAlign = 'left';
        ctx.restore();
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
                    if (i === 0) {
                        ctx.moveTo(px, py);
                    } else {
                        ctx.lineTo(px, py);
                    }
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

    /** Compact nav arrow button (smaller than full icon button) */
    _drawNavArrow(ctx, rect, icon) {
        const T = this.theme;
        this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = T.text;
        ctx.font = '700 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'center';
        ctx.fillText(icon, rect.x + rect.w / 2, rect.y + rect.h / 2 + 10);
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
            const test = `${line + words[i]} `;
            if (ctx.measureText(test).width > maxX - x && i > 0) {
                ctx.fillText(line, x, yy);
                line = `${words[i]} `;
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

        // ─── Layer navigation ───
        if (key === 'open_controls') {
            this.setMode('controls');
            return true;
        }
        if (key === 'open_settings') {
            // From chat → settings, or from controls → settings
            this.setMode('settings');
            return true;
        }
        if (key === 'back') {
            // Back: settings → controls, controls → chat
            if (this.mode === 'settings') {
                this.setMode('controls');
            } else {
                this.setMode('chat');
            }
            return true;
        }

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

        // XR Settings: Background Color (cycles black → blue → void → passthrough)
        if (key === 'xr_bg') {
            const cycle = { black: 'blue', blue: 'void', void: 'passthrough', passthrough: 'black' };
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

        // XR Settings: Mode toggle (VR ↔ AR/Passthrough)
        if (key === 'xr_mode') {
            if (!this.xrSettings.arSupported) {
                console.log('[VRChatPanel] AR/Passthrough not supported on this device');
                return true;
            }
            const newMode = this.xrSettings.sessionMode === 'vr' ? 'ar' : 'vr';
            this.xrSettings.sessionMode = newMode;
            console.log(`[VRChatPanel] View mode → ${newMode === 'ar' ? 'Passthrough (AR)' : 'VR'}`);
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
            const distMap = { near: 0.55, medium: 0.85, far: 1.4 };
            this._spawnDistance = distMap[this.xrSettings.panelDistance] || 0.55;
            console.log(`[VRChatPanel] Panel distance → ${this.xrSettings.panelDistance} (${this._spawnDistance}m)`);
            this.redraw();
            return true;
        }

        // XR Settings: Joint Visibility (cycles hoverOnly → alwaysVisible)
        if (key === 'xr_joints') {
            const modes = ['hoverOnly', 'alwaysVisible'];
            const idx = modes.indexOf(this.xrSettings.jointVisibility);
            this.xrSettings.jointVisibility = modes[(idx + 1) % modes.length];
            console.log(`[VRChatPanel] Joint visibility → ${this.xrSettings.jointVisibility}`);
            window.dispatchEvent(
                new CustomEvent('vr-setting-changed', {
                    detail: { key: 'jointVisibility', value: this.xrSettings.jointVisibility },
                })
            );
            this.redraw();
            return true;
        }

        // Pose NEXT — cycles forward through presets
        if (key === 'xr_pose_next') {
            const vps = window.vrPoseSystem;
            if (vps && vps.enabled) {
                const next = vps.cyclePreset();
                const label =
                    typeof vps.constructor.getPresetLabel === 'function' ? vps.constructor.getPresetLabel(next) : next;
                console.log(`[VRChatPanel] Pose → ${label}`);
                this.appendMessage('bot', `Pose: ${label}`);
            } else {
                const pn = window.NEXUS_POSE_NORMALIZER;
                if (pn) {
                    const presets = ['relaxedStanding', 'naturalIdle', 'portrait', 'presentation'];
                    const s = pn.getSettings();
                    const idx = presets.indexOf(s.preset);
                    const next = presets[(idx + 1) % presets.length];
                    pn.updateSettings({ preset: next });
                    console.log(`[VRChatPanel] Pose preset (legacy) → ${next}`);
                }
            }
            this.redraw();
            return true;
        }

        // Pose PREV — cycles backward through presets
        if (key === 'xr_pose_prev') {
            const vps = window.vrPoseSystem;
            if (vps && vps.enabled) {
                const prev = vps.cyclePrevPreset();
                const label =
                    typeof vps.constructor.getPresetLabel === 'function' ? vps.constructor.getPresetLabel(prev) : prev;
                console.log(`[VRChatPanel] Pose → ${label}`);
                this.appendMessage('bot', `Pose: ${label}`);
            } else {
                const pn = window.NEXUS_POSE_NORMALIZER;
                if (pn) {
                    const presets = ['relaxedStanding', 'naturalIdle', 'portrait', 'presentation'];
                    const s = pn.getSettings();
                    const idx = presets.indexOf(s.preset);
                    const prev = presets[(idx - 1 + presets.length) % presets.length];
                    pn.updateSettings({ preset: prev });
                    console.log(`[VRChatPanel] Pose preset (legacy) → ${prev}`);
                }
            }
            this.redraw();
            return true;
        }

        // Pose RESET — returns to default standing rest pose
        if (key === 'xr_pose_reset') {
            const vps = window.vrPoseSystem;
            if (vps && vps.enabled) {
                vps.resetToRest();
                console.log('[VRChatPanel] Pose reset to standing');
                this.appendMessage('bot', 'Pose: Standing (Rest / T-Pose)');
            } else {
                const pn = window.NEXUS_POSE_NORMALIZER;
                if (pn) {
                    pn.updateSettings({ preset: 'relaxedStanding' });
                    console.log('[VRChatPanel] Pose reset (legacy) → relaxedStanding');
                }
            }
            this.redraw();
            return true;
        }

        // Puppet Mode toggle (free 3D avatar placement)
        if (key === 'xr_puppet') {
            this.xrSettings.puppetMode = !this.xrSettings.puppetMode;
            console.log(`[VRChatPanel] Puppet mode → ${this.xrSettings.puppetMode ? 'ON' : 'OFF'}`);
            window.dispatchEvent(
                new CustomEvent('vr-setting-changed', {
                    detail: { key: 'puppetMode', value: this.xrSettings.puppetMode },
                })
            );
            this.redraw();
            return true;
        }

        // Intimacy / Close Presence toggle
        if (key === 'xr_intimacy') {
            this.xrSettings.intimacyMode = !this.xrSettings.intimacyMode;
            console.log(`[VRChatPanel] Intimacy mode -> ${this.xrSettings.intimacyMode ? 'ON' : 'OFF'}`);
            window.dispatchEvent(
                new CustomEvent('vr-setting-changed', {
                    detail: { key: 'intimacyMode', value: this.xrSettings.intimacyMode },
                })
            );
            this.redraw();
            return true;
        }

        // AR Passthrough toggle — switches between VR and AR sessions on Quest 3.
        // WebXR spec requires ending the current session and starting a new one
        // with 'immersive-ar' mode — passthrough cannot be toggled mid-session.
        // This is a dedicated one-tap button on the controls layer (layer 2)
        // so the user doesn't have to dig into settings (layer 3).
        if (key === 'xr_ar') {
            if (!this.xrSettings.arSupported) {
                console.log('[VRChatPanel] AR passthrough not supported on this device');
                return true;
            }
            const isAR = this.xrSettings.sessionMode === 'ar';
            const newMode = isAR ? 'vr' : 'ar';
            this.xrSettings.sessionMode = newMode;
            console.log(`[VRChatPanel] AR Passthrough → ${isAR ? 'OFF (back to VR)' : 'ON (switching to AR)'}`);
            window.dispatchEvent(
                new CustomEvent('vr-setting-changed', {
                    detail: { key: 'sessionMode', value: newMode },
                })
            );
            this.redraw();
            return true;
        }

        // PLACE button — one-tap combo: passthrough + sitting pose + puppet mode
        // Tap again to deactivate (restore VR background + standing + puppet off)
        if (key === 'xr_place') {
            const isActive = this.xrSettings.puppetMode && this.xrSettings.vrBackground === 'passthrough';

            if (isActive) {
                // Deactivate: restore normal VR mode
                // 1. Disable puppet mode
                this.xrSettings.puppetMode = false;
                window.dispatchEvent(
                    new CustomEvent('vr-setting-changed', {
                        detail: { key: 'puppetMode', value: false },
                    })
                );

                // 2. Restore VR background (black)
                this.xrSettings.vrBackground = 'black';
                window.dispatchEvent(
                    new CustomEvent('vr-setting-changed', {
                        detail: { key: 'vrBackground', value: 'black' },
                    })
                );

                // 3. Reset pose to relaxed standing
                const vps = window.vrPoseSystem;
                if (vps && vps.enabled) {
                    vps.applyPreset('standingRelaxed', 0.5);
                }

                console.log('[VRChatPanel] Place mode OFF — restored VR defaults');
            } else {
                // Activate: passthrough + sit + puppet

                // 1. Enable passthrough
                this.xrSettings.vrBackground = 'passthrough';
                window.dispatchEvent(
                    new CustomEvent('vr-setting-changed', {
                        detail: { key: 'vrBackground', value: 'passthrough' },
                    })
                );

                // 2. Apply sitting pose
                const vps = window.vrPoseSystem;
                if (vps && vps.enabled) {
                    vps.applyPreset('sitting', 0.6);
                }

                // 3. Enable puppet mode (grab to position on real furniture)
                this.xrSettings.puppetMode = true;
                window.dispatchEvent(
                    new CustomEvent('vr-setting-changed', {
                        detail: { key: 'puppetMode', value: true },
                    })
                );

                console.log('[VRChatPanel] Place mode ON — passthrough + sitting + puppet');
            }

            this.redraw();
            return true;
        }

        // Follow-me gaze toggle (avatar eyes track user's HMD)
        if (key === 'xr_gaze') {
            this.xrSettings.followGaze = !this.xrSettings.followGaze;
            console.log(`[VRChatPanel] Follow-me gaze → ${this.xrSettings.followGaze ? 'ON' : 'OFF'}`);
            window.dispatchEvent(
                new CustomEvent('vr-setting-changed', {
                    detail: { key: 'followGaze', value: this.xrSettings.followGaze },
                })
            );
            this.redraw();
            return true;
        }

        // IK toggle (enables/disables inverse kinematics for natural chain posing)
        if (key === 'xr_pose_intensity') {
            const vps = window.vrPoseSystem;
            if (vps) {
                vps.ikEnabled = !vps.ikEnabled;
                console.log(`[VRChatPanel] IK → ${vps.ikEnabled ? 'ON' : 'OFF'}`);
            } else {
                // Fallback: old intensity cycle for PoseNormalizer
                const pn = window.NEXUS_POSE_NORMALIZER;
                if (pn) {
                    const levels = [0.2, 0.5, 0.65, 0.8, 1.0];
                    const s = pn.getSettings();
                    const closest = levels.reduce((a, b) =>
                        Math.abs(b - s.intensity) < Math.abs(a - s.intensity) ? b : a
                    );
                    const idx = levels.indexOf(closest);
                    const next = levels[(idx + 1) % levels.length];
                    pn.updateSettings({ intensity: next });
                    console.log(`[VRChatPanel] Pose intensity → ${next}`);
                }
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
