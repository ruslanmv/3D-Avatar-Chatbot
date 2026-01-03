/**
 * VR Chat Panel Module
 * 3D UI panel for VR chatbot with canvas textures and interactive buttons
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

export class VRChatPanel {
    constructor({ scene, camera }) {
        this.scene = scene;
        this.camera = camera;

        this.mode = 'chat'; // 'chat' or 'settings'
        this.status = 'idle'; // 'idle', 'listening', 'thinking', 'speaking'
        this.messages = []; // { role, text }
        this.avatars = []; // { name, url, index }

        this.sttEnabled = true;
        this.ttsEnabled = true;

        // Panel dimensions
        this.panelWidth = 0.75;
        this.panelHeight = 0.42;

        // Create main group
        this.group = new THREE.Group();
        this.group.name = 'VRChatPanel';

        // Canvas for text UI
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1024;
        this.canvas.height = 512;
        this.ctx = this.canvas.getContext('2d');

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.needsUpdate = true;

        // [FIX] Use PlaneGeometry for stability - curved UI can wait for v2
        const panelGeo = new THREE.PlaneGeometry(this.panelWidth, this.panelHeight);
        const panelMat = new THREE.MeshBasicMaterial({
            map: this.texture,
            transparent: true,
            opacity: 0.95,
            side: THREE.FrontSide,
            depthTest: false, // [FIX] Ensure visibility over avatar
            depthWrite: false,
        });

        this.panelMesh = new THREE.Mesh(panelGeo, panelMat);
        this.panelMesh.name = 'PanelSurface';
        this.panelMesh.renderOrder = 999; // [FIX] Render on top
        this.group.add(this.panelMesh);

        // Interactable elements
        this.buttons = {};
        this.interactables = [];

        // Create UI elements
        this.createButtonRow();
        this.createQuickPrompts();
        this.createSettingsArea();

        // Position settings
        this.headLocked = true;
        this.group.position.set(0, 1.45, -0.85);
        this.group.rotation.set(0, 0, 0);

        // Add to scene
        this.scene.add(this.group);

        // Initial draw
        this.redraw();
    }

    /**
     * Update panel position (head-locked mode)
     */
    update() {
        if (!this.headLocked) return;

        const cam = this.camera;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        const pos = cam.position.clone().add(forward.multiplyScalar(0.85));
        pos.y -= 0.1;

        this.group.position.copy(pos);
        this.group.quaternion.copy(cam.quaternion);
    }

    /**
     * Set panel mode
     * @param {string} mode - 'chat' or 'settings'
     */
    setMode(mode) {
        this.mode = mode;
        this.refreshVisibility();
        this.redraw();
    }

    /**
     * Set status
     * @param {string} status - 'idle', 'listening', 'thinking', 'speaking'
     */
    setStatus(status) {
        this.status = status;
        this.redraw();
    }

    /**
     * Set avatar list for settings
     * @param {Array} avatars - Avatar list
     */
    setAvatars(avatars) {
        this.avatars = avatars || [];
        this.buildAvatarCards();
        this.redraw();
    }

    /**
     * Append message to chat
     * @param {string} role - 'user' or 'bot'
     * @param {string} text - Message text
     */
    appendMessage(role, text) {
        this.messages.push({ role, text });
        // Keep last 12 for VR readability
        if (this.messages.length > 12) {
            this.messages.shift();
        }
        this.redraw();
    }

    /**
     * Clear all messages
     */
    clearMessages() {
        this.messages = [];
        this.redraw();
    }

    /**
     * Set STT enabled state
     * @param {boolean} enabled
     */
    setSTTEnabled(enabled) {
        this.sttEnabled = enabled;
        this.redraw();
    }

    /**
     * Set TTS enabled state
     * @param {boolean} enabled
     */
    setTTSEnabled(enabled) {
        this.ttsEnabled = enabled;
        this.redraw();
    }

    /**
     * Create button row (Mic, Send, Clear, Settings, Pin)
     */
    createButtonRow() {
        const y = -this.panelHeight / 2 - 0.06;
        const buttonWidth = 0.09;
        const buttonHeight = 0.05;

        const createButton = (key, label, x, color = 0x4080ff) => {
            const geo = new THREE.PlaneGeometry(buttonWidth, buttonHeight);
            const mat = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.85,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, y, 0.01); // [FIX] Z=0.01 for proper hitbox alignment
            mesh.name = `Btn:${key}`;
            mesh.userData.label = label;
            mesh.userData.type = 'button';
            mesh.userData.color = color;
            mesh.userData.originalOpacity = 0.85;

            this.group.add(mesh);
            this.interactables.push(mesh);
            this.buttons[key] = mesh;
            return mesh;
        };

        createButton('mic', '🎤 Mic', -0.24, 0x40c080);
        createButton('send', '⏎ Send', -0.12, 0x4080ff);
        createButton('clear', '⟳ Clear', 0.0, 0xff8040);
        createButton('settings', '⚙ Settings', 0.12, 0x8040ff);
        createButton('pin', '📌 Pin', 0.24, 0xc0c0c0);
    }

    /**
     * Create quick prompt chips
     */
    createQuickPrompts() {
        const y = -this.panelHeight / 2 - 0.13;
        const chipWidth = 0.18;
        const chipHeight = 0.045;

        const prompts = [
            { key: 'q_summarize', text: 'Summarize' },
            { key: 'q_explain', text: 'Explain' },
            { key: 'q_next', text: 'Next step' },
        ];

        prompts.forEach((prompt, i) => {
            const geo = new THREE.PlaneGeometry(chipWidth, chipHeight);
            const mat = new THREE.MeshBasicMaterial({
                color: 0x40a0e0,
                transparent: true,
                opacity: 0.75,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(-0.2 + i * 0.2, y, 0.01); // [FIX] Z=0.01 for proper hitbox alignment
            mesh.name = `Chip:${prompt.key}`;
            mesh.userData.label = prompt.text;
            mesh.userData.type = 'chip';
            mesh.userData.color = 0x40a0e0;
            mesh.userData.originalOpacity = 0.75;

            this.group.add(mesh);
            this.interactables.push(mesh);
            this.buttons[prompt.key] = mesh;
        });
    }

    /**
     * Create settings area
     */
    createSettingsArea() {
        this.settingsGroup = new THREE.Group();
        this.settingsGroup.name = 'SettingsGroup';
        this.group.add(this.settingsGroup);

        const buttonWidth = 0.14;
        const buttonHeight = 0.05;

        // Back button
        const backGeo = new THREE.PlaneGeometry(buttonWidth, buttonHeight);
        const backMat = new THREE.MeshBasicMaterial({
            color: 0x6080a0,
            transparent: true,
            opacity: 0.85,
        });
        const back = new THREE.Mesh(backGeo, backMat);
        back.position.set(-0.3, this.panelHeight / 2 + 0.06, 0.01); // [FIX] Z=0.01
        back.name = 'Btn:back';
        back.userData.label = '← Back';
        back.userData.type = 'button';
        back.userData.color = 0x6080a0;
        back.userData.originalOpacity = 0.85;

        this.settingsGroup.add(back);
        this.interactables.push(back);
        this.buttons.back = back;

        // STT toggle button
        const toggleWidth = 0.2;
        const toggleGeo = new THREE.PlaneGeometry(toggleWidth, buttonHeight);

        const stt = new THREE.Mesh(toggleGeo, backMat.clone());
        stt.position.set(0.05, this.panelHeight / 2 + 0.06, 0.01); // [FIX] Z=0.01
        stt.name = 'Btn:stt';
        stt.userData.label = 'STT';
        stt.userData.type = 'toggle';
        stt.userData.color = 0x40c080;
        stt.userData.colorOff = 0xa0a0a0;
        stt.userData.originalOpacity = 0.85;

        this.settingsGroup.add(stt);
        this.interactables.push(stt);
        this.buttons.stt = stt;

        // TTS toggle button
        const tts = new THREE.Mesh(toggleGeo, backMat.clone());
        tts.position.set(0.28, this.panelHeight / 2 + 0.06, 0.01); // [FIX] Z=0.01
        tts.name = 'Btn:tts';
        tts.userData.label = 'TTS';
        tts.userData.type = 'toggle';
        tts.userData.color = 0x40c080;
        tts.userData.colorOff = 0xa0a0a0;
        tts.userData.originalOpacity = 0.85;

        this.settingsGroup.add(tts);
        this.interactables.push(tts);
        this.buttons.tts = tts;

        // Avatar cards container
        this.avatarCardsGroup = new THREE.Group();
        this.avatarCardsGroup.name = 'AvatarCards';
        this.settingsGroup.add(this.avatarCardsGroup);

        this.refreshVisibility();
    }

    /**
     * Build avatar selection cards
     */
    buildAvatarCards() {
        // Clear old cards
        while (this.avatarCardsGroup.children.length) {
            const child = this.avatarCardsGroup.children[0];
            this.avatarCardsGroup.remove(child);
            // Remove from interactables
            const idx = this.interactables.indexOf(child);
            if (idx >= 0) this.interactables.splice(idx, 1);
        }

        // Build grid of avatar cards
        const cols = 3;
        const cardW = 0.22;
        const cardH = 0.08;
        const startX = -0.24;
        const startY = 0.1;
        const gap = 0.03;

        this.avatars.forEach((avatar, idx) => {
            const r = Math.floor(idx / cols);
            const c = idx % cols;

            const geo = new THREE.PlaneGeometry(cardW, cardH);
            const mat = new THREE.MeshBasicMaterial({
                color: 0x5080c0,
                transparent: true,
                opacity: 0.8,
            });
            const card = new THREE.Mesh(geo, mat);

            card.position.set(startX + c * (cardW + gap), startY - r * (cardH + gap), 0.01); // [FIX] Z=0.01
            card.name = `AvatarCard:${idx}`;
            card.userData.avatarIndex = idx;
            card.userData.avatarName = avatar.name;
            card.userData.label = avatar.name;
            card.userData.type = 'avatar-card';
            card.userData.color = 0x5080c0;
            card.userData.originalOpacity = 0.8;

            this.avatarCardsGroup.add(card);
            this.interactables.push(card);
        });
    }

    /**
     * Refresh visibility based on mode
     */
    refreshVisibility() {
        const isSettings = this.mode === 'settings';
        this.settingsGroup.visible = isSettings;

        // Hide quick prompts in settings mode
        ['q_summarize', 'q_explain', 'q_next'].forEach((key) => {
            if (this.buttons[key]) {
                this.buttons[key].visible = !isSettings;
            }
        });
    }

    /**
     * Redraw canvas texture
     */
    redraw() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Clear
        ctx.clearRect(0, 0, w, h);
        ctx.globalAlpha = 1;

        // Background with holo effect
        ctx.fillStyle = 'rgba(10, 14, 20, 0.92)';
        ctx.fillRect(0, 0, w, h);

        // Header bar
        ctx.fillStyle = 'rgba(64, 160, 240, 0.25)';
        ctx.fillRect(0, 0, w, 64);

        // Title
        ctx.fillStyle = 'rgba(220, 245, 255, 0.95)';
        ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText('NEXUS // VR CHAT', 24, 42);

        // Status indicator
        ctx.font = '22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = this.getStatusColor();
        ctx.fillText(`● ${this.status.toUpperCase()}`, w - 240, 42);

        // Body content
        if (this.mode === 'chat') {
            this.drawChatMode(ctx, w, h);
        } else {
            this.drawSettingsMode(ctx, w, h);
        }

        // Update texture
        this.texture.needsUpdate = true;

        // Update toggle button colors
        this.updateToggleColors();
    }

    /**
     * Draw chat mode UI
     */
    drawChatMode(ctx, w, h) {
        const last = this.messages.slice(-6);
        let y = 100;

        ctx.font = '24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

        last.forEach((msg) => {
            const prefix = msg.role === 'user' ? 'YOU:' : 'BOT:';
            ctx.fillStyle = msg.role === 'user' ? 'rgba(100, 200, 255, 0.95)' : 'rgba(180, 255, 180, 0.92)';
            ctx.fillText(prefix, 24, y);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
            this.wrapText(ctx, msg.text, 110, y, w - 140, 30);
            y += 70;
        });

        // Input hint
        ctx.fillStyle = 'rgba(180, 240, 255, 0.75)';
        ctx.font = '20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText('Tap microphone to speak or use quick prompts below', 24, h - 30);
    }

    /**
     * Draw settings mode UI
     */
    drawSettingsMode(ctx, w, h) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText('SETTINGS', 24, 110);

        ctx.font = '22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(180, 240, 255, 0.92)';
        ctx.fillText(`Speech Recognition (STT): ${this.sttEnabled ? 'ON' : 'OFF'}`, 24, 160);
        ctx.fillText(`Text-to-Speech (TTS): ${this.ttsEnabled ? 'ON' : 'OFF'}`, 24, 195);

        ctx.font = '24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(220, 245, 255, 0.92)';
        ctx.fillText('SELECT AVATAR:', 24, 240);

        ctx.font = '18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(200, 220, 240, 0.85)';
        ctx.fillText('Point and click an avatar card below to switch instantly.', 24, 270);
    }

    /**
     * Update toggle button colors based on state
     */
    updateToggleColors() {
        // STT toggle
        if (this.buttons.stt) {
            const sttMat = this.buttons.stt.material;
            sttMat.color.setHex(this.sttEnabled ? 0x40c080 : 0xa0a0a0);
        }

        // TTS toggle
        if (this.buttons.tts) {
            const ttsMat = this.buttons.tts.material;
            ttsMat.color.setHex(this.ttsEnabled ? 0x40c080 : 0xa0a0a0);
        }
    }

    /**
     * Get status color
     */
    getStatusColor() {
        switch (this.status) {
            case 'listening':
                return 'rgba(80, 220, 120, 0.95)';
            case 'thinking':
                return 'rgba(255, 200, 80, 0.95)';
            case 'speaking':
                return 'rgba(120, 180, 255, 0.95)';
            default:
                return 'rgba(200, 200, 200, 0.85)';
        }
    }

    /**
     * Wrap text for canvas rendering
     */
    wrapText(ctx, text, x, y, maxWidth, lineHeight) {
        const words = (text || '').split(' ');
        let line = '';
        let yy = y;

        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            const metrics = ctx.measureText(testLine);

            if (metrics.width > maxWidth && n > 0) {
                ctx.fillText(line, x, yy);
                line = words[n] + ' ';
                yy += lineHeight;
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line, x, yy);
    }

    /**
     * Highlight interactable (for ray hover effect)
     * @param {THREE.Mesh} mesh - Mesh to highlight
     */
    highlightInteractable(mesh) {
        if (mesh && mesh.material) {
            mesh.material.opacity = 1.0;
        }
    }

    /**
     * Reset interactable highlight
     * @param {THREE.Mesh} mesh - Mesh to reset
     */
    resetInteractable(mesh) {
        if (mesh && mesh.material && mesh.userData.originalOpacity) {
            mesh.material.opacity = mesh.userData.originalOpacity;
        }
    }

    /**
     * Set head-locked mode
     * @param {boolean} enabled
     */
    setHeadLocked(enabled) {
        this.headLocked = enabled;
    }

    /**
     * Get all interactable meshes
     * @returns {Array<THREE.Mesh>}
     */
    getInteractables() {
        return this.interactables;
    }

    /**
     * Show/hide panel
     * @param {boolean} visible
     */
    setVisible(visible) {
        this.group.visible = visible;
    }

    /**
     * Dispose and cleanup
     */
    dispose() {
        // Dispose canvas texture
        if (this.texture) {
            this.texture.dispose();
        }

        // Dispose materials and geometries
        this.group.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });

        // Remove from scene
        this.scene.remove(this.group);
    }
}
