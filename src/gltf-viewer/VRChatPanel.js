/**
 * VR Chat Panel Module (Quest-like Move + Frozen Default, Production Ready)
 * ------------------------------------------------------------------------
 * - Frozen by default (Pinned).
 * - PIN toggles Move Mode (unpinned) where the panel can be dragged ONLY by handle.
 * - No wrist-follow / no head-follow.
 * - Spawns closer so text is readable.
 *
 * Controller usage:
 * - When trigger press begins and ray hits handle: panel.beginDrag(hit.point)
 * - While trigger held: panel.dragTo(hit.point)
 * - On trigger release: panel.endDrag()
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
    this.mode = 'chat';
    this.status = 'idle';
    this.messages = [];
    this.avatars = [];
    this.currentAvatarIndex = 0;

    this.sttEnabled = true;
    this.ttsEnabled = true;

    // -----------------------
    // Placement
    // -----------------------
    this.isPinned = true;   // ✅ frozen default
    this._isDragging = false;

    this._dragOffset = new THREE.Vector3();
    this._tmpCamPos = new THREE.Vector3();
    this._tmpVec3 = new THREE.Vector3();

    // ✅ Better distance limits for readability
    this._minDistance = 0.20;
    this._maxDistance = 2.00;

    // ✅ Spawn closer (readable)
    this._spawnDistance = 1.00; // meters (try 0.32–0.40)

    // -----------------------
    // Physical size (meters)
    // -----------------------
    // Slightly larger helps readability too
    this.panelWidth = 0.58;
    this.panelHeight = 0.36;

    // -----------------------
    // Canvas
    // -----------------------
    this.canvasW = 2048;
    this.canvasH = 1024;
    this.padding = 44;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvasW;
    this.canvas.height = this.canvasH;
    this.ctx = this.canvas.getContext('2d', { alpha: false });

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.needsUpdate = true;

    try {
      const maxAniso = this.scene?.renderer?.capabilities?.getMaxAnisotropy?.();
      if (maxAniso) this.texture.anisotropy = Math.min(8, maxAniso);
    } catch (_) {}

    // -----------------------
    // 3D group + panel mesh
    // -----------------------
    this.group = new THREE.Group();
    this.group.name = 'VRChatPanel';

    const geo = new THREE.PlaneGeometry(this.panelWidth, this.panelHeight);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0.98,
      side: THREE.FrontSide,
      depthTest: false,
      depthWrite: false,
    });

    this.panelMesh = new THREE.Mesh(geo, mat);
    this.panelMesh.name = 'PanelSurface';
    this.panelMesh.renderOrder = 999;
    this.group.add(this.panelMesh);

    // -----------------------
    // Interaction / hitboxes
    // -----------------------
    this.interactables = [];
    this.buttons = {};

    this._layout = this._computeLayout();
    this._createHitboxes();

    this.group.visible = false;
    this.scene.add(this.group);

    this.redraw();
  }

  // ===========================================================================
  // UPDATE: never follows hand/head automatically
  // ===========================================================================

  update() {
    if (!this.group.visible) return;
    if (this._isDragging) return; // movement done in dragTo()
  }

  // ===========================================================================
  // Visibility + spawn
  // ===========================================================================

  setVisible(v) {
    const visible = !!v;
    this.group.visible = visible;

    if (!visible) {
      this._isDragging = false;
      return;
    }

    // ✅ Spawn close and readable ONCE
    this._spawnNearLeftHandOnce(this._spawnDistance);

    // ✅ Frozen by default
    this.isPinned = true;
    this._isDragging = false;
    this.redraw();
  }

  setLeftController(controller) {
    this.leftController = controller;
  }

  // ===========================================================================
  // Pin / Move mode
  // ===========================================================================

  togglePinned() {
    this.isPinned = !this.isPinned;
    if (this.isPinned) this._isDragging = false;
    this.redraw();
    return this.isPinned;
  }

  beginDrag(hitPointWorld) {
    if (this.isPinned) return false;     // only in move mode
    if (!hitPointWorld) return false;

    this._isDragging = true;
    this._dragOffset.copy(this.group.position).sub(hitPointWorld);
    return true;
  }

  dragTo(hitPointWorld) {
    if (this.isPinned || !this._isDragging) return;
    if (!hitPointWorld) return;

    // target = hit + offset
    const targetPos = this._tmpVec3.copy(hitPointWorld).add(this._dragOffset);

    // Clamp distance to camera
    this.camera.getWorldPosition(this._tmpCamPos);
    const d = targetPos.distanceTo(this._tmpCamPos);
    const clampedD = THREE.MathUtils.clamp(d, this._minDistance, this._maxDistance);
    if (clampedD !== d) {
      const dir = targetPos.clone().sub(this._tmpCamPos).normalize();
      targetPos.copy(this._tmpCamPos).add(dir.multiplyScalar(clampedD));
    }

    // Apply
    this.group.position.copy(targetPos);

    // Face camera while dragging (Quest-like)
    this.group.lookAt(this._tmpCamPos);
    this.group.rotateX(-0.12);
  }

  endDrag() {
    this._isDragging = false;
  }

  _spawnNearLeftHandOnce(distMeters = 0.36) {
    // If no controller, spawn in front of camera
    if (!this.leftController) {
      const camPos = new THREE.Vector3();
      const camQuat = new THREE.Quaternion();
      this.camera.getWorldPosition(camPos);
      this.camera.getWorldQuaternion(camQuat);

      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat).multiplyScalar(distMeters);
      const left = new THREE.Vector3(-1, 0, 0).applyQuaternion(camQuat).multiplyScalar(0.18);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camQuat).multiplyScalar(0.02);

      this.group.position.copy(camPos).add(forward).add(left).add(up);
      this.group.quaternion.copy(camQuat);
      this.group.rotateX(-0.10);
      return;
    }

    // Spawn near left hand
    this.group.position.copy(this.leftController.position);
    this.group.quaternion.copy(this.leftController.quaternion);

    // ✅ Bring it closer in front of the user (not too much to the side)
    this.group.translateX(0.16);
    this.group.translateY(0.06);
    this.group.translateZ(-0.10);

    // Nudge to desired distance from camera
    this.camera.getWorldPosition(this._tmpCamPos);
    const toPanel = this._tmpVec3.copy(this.group.position).sub(this._tmpCamPos);
    const d = toPanel.length();
    if (d > distMeters) {
      toPanel.normalize();
      this.group.position.copy(this._tmpCamPos).add(toPanel.multiplyScalar(distMeters));
    }

    // Face camera once (then frozen)
    this.group.lookAt(this._tmpCamPos);
    this.group.rotateX(-0.12);
  }

  // ===========================================================================
  // Chat/settings API (unchanged)
  // ===========================================================================

  setMode(mode) {
    this.mode = mode === 'settings' ? 'settings' : 'chat';
    this.redraw();
  }

  setStatus(status) {
    this.status = status || 'idle';
    this.redraw();
  }

  setSTTEnabled(enabled) {
    this.sttEnabled = !!enabled;
    this.redraw();
  }

  setTTSEnabled(enabled) {
    this.ttsEnabled = !!enabled;
    this.redraw();
  }

  setAvatars(avatars) {
    this.avatars = Array.isArray(avatars) ? avatars : [];
    if (this.currentAvatarIndex >= this.avatars.length) {
      this.currentAvatarIndex = Math.max(0, this.avatars.length - 1);
    }
    this.redraw();
  }

  setCurrentAvatarIndex(index) {
    const n = this.avatars.length;
    if (!n) {
      this.currentAvatarIndex = 0;
      this.redraw();
      return;
    }
    const i = Math.max(0, Math.min(n - 1, index | 0));
    this.currentAvatarIndex = i;
    this.redraw();
  }

  nextAvatar() {
    const n = this.avatars.length;
    if (!n) return 0;
    this.currentAvatarIndex = (this.currentAvatarIndex + 1) % n;
    this.redraw();
    return this.currentAvatarIndex;
  }

  prevAvatar() {
    const n = this.avatars.length;
    if (!n) return 0;
    this.currentAvatarIndex = (this.currentAvatarIndex - 1 + n) % n;
    this.redraw();
    return this.currentAvatarIndex;
  }

  appendMessage(role, text) {
    this.messages.push({ role, text: String(text ?? '') });
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

  highlightInteractable(mesh) {
    if (!mesh?.material) return;
    mesh.material.opacity = 0.02;
  }
  resetInteractable(mesh) {
    if (!mesh?.material) return;
    mesh.material.opacity = mesh.userData?.originalOpacity ?? 0.001;
  }

  // ===========================================================================
  // Layout + Hitboxes
  // ===========================================================================

  _computeLayout() {
    const W = this.canvasW;
    const H = this.canvasH;

    const headerH = 110;
    const footerH = 150;
    const chipsH = 80;

    // ✅ bigger handle target
    const handle = {
      x: this.padding,
      y: 10,
      w: W - this.padding * 2 - 420,
      h: 98,
    };

    const chatArea = {
      x: this.padding,
      y: headerH + 20,
      w: W - this.padding * 2,
      h: H - headerH - footerH - chipsH - 40,
    };

    const chipY = headerH + 20 + chatArea.h + 18;
    const footerY = H - footerH + 20;

    const gap = 22;
    const btnH = 96;
    const btnW = Math.floor((W - this.padding * 2 - gap * 4) / 5);

    const btnRow = {
      y: footerY,
      items: [
        { key: 'mic', label: '🎤 MIC', x: this.padding + (btnW + gap) * 0, y: footerY, w: btnW, h: btnH },
        { key: 'send', label: '⏎ SEND', x: this.padding + (btnW + gap) * 1, y: footerY, w: btnW, h: btnH },
        { key: 'clear', label: '⟳ CLEAR', x: this.padding + (btnW + gap) * 2, y: footerY, w: btnW, h: btnH },
        { key: 'settings', label: '⚙ SETTINGS', x: this.padding + (btnW + gap) * 3, y: footerY, w: btnW, h: btnH },
        { key: 'pin', label: '📌 PIN', x: this.padding + (btnW + gap) * 4, y: footerY, w: btnW, h: btnH },
      ],
    };

    const chipW = Math.floor((W - this.padding * 2 - gap * 2) / 3);
    const chips = [
      { key: 'q_summarize', label: 'Summarize', x: this.padding + (chipW + gap) * 0, y: chipY, w: chipW, h: 64 },
      { key: 'q_explain', label: 'Explain', x: this.padding + (chipW + gap) * 1, y: chipY, w: chipW, h: 64 },
      { key: 'q_next', label: 'Next step', x: this.padding + (chipW + gap) * 2, y: chipY, w: chipW, h: 64 },
    ];

    const topBtnY = 22;
    const topBtnH = 74;
    const settingsTop = {
      back: { x: this.padding, y: topBtnY, w: 240, h: topBtnH },
      stt: { x: W - this.padding - 520, y: topBtnY, w: 250, h: topBtnH },
      tts: { x: W - this.padding - 255, y: topBtnY, w: 250, h: topBtnH },
      prev: { x: this.padding, y: 340, w: 260, h: 90 },
      next: { x: W - this.padding - 260, y: 340, w: 260, h: 90 },
    };

    return { W, H, headerH, handle, chatArea, chips, btnRow, settingsTop };
  }

  _canvasRectToPanelPlane(rect) {
    const W = this.canvasW;
    const H = this.canvasH;

    const nx = (rect.x + rect.w / 2) / W;
    const ny = (rect.y + rect.h / 2) / H;

    const x = (nx - 0.5) * this.panelWidth;
    const y = (0.5 - ny) * this.panelHeight;
    const w = (rect.w / W) * this.panelWidth;
    const h = (rect.h / H) * this.panelHeight;

    return { x, y, w, h };
  }

  _makeHitbox(name, rect, type, userData = {}) {
    const m = this._canvasRectToPanelPlane(rect);

    const geo = new THREE.PlaneGeometry(m.w, m.h);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.001,
      depthTest: false,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.position.set(m.x, m.y, 0.003);
    mesh.userData = { type, ...userData, originalOpacity: 0.001 };

    this.group.add(mesh);
    this.interactables.push(mesh);
    return mesh;
  }

  _createHitboxes() {
    // ✅ Handle hitbox for moving
    this.buttons.handle = this._makeHitbox('Handle:move', this._layout.handle, 'handle', {
      key: 'handle',
      label: 'Move Handle',
    });

    // Footer buttons
    this._layout.btnRow.items.forEach((b) => {
      this.buttons[b.key] = this._makeHitbox(`Btn:${b.key}`, b, 'button', { key: b.key, label: b.label });
    });

    // Chips
    this._layout.chips.forEach((c) => {
      this.buttons[c.key] = this._makeHitbox(`Chip:${c.key}`, c, 'chip', { key: c.key, label: c.label });
    });

    // Settings group
    this.settingsGroup = new THREE.Group();
    this.settingsGroup.name = 'SettingsGroup';
    this.group.add(this.settingsGroup);

    const top = this._layout.settingsTop;

    const back = this._makeHitbox('Btn:back', top.back, 'button', { label: 'Back', key: 'back' });
    const stt = this._makeHitbox('Btn:stt', top.stt, 'toggle', { label: 'STT', key: 'stt' });
    const tts = this._makeHitbox('Btn:tts', top.tts, 'toggle', { label: 'TTS', key: 'tts' });

    const prev = this._makeHitbox('Btn:avatar_prev', top.prev, 'button', { label: 'Prev Avatar', key: 'avatar_prev' });
    const next = this._makeHitbox('Btn:avatar_next', top.next, 'button', { label: 'Next Avatar', key: 'avatar_next' });

    [back, stt, tts, prev, next].forEach((m) => {
      this.group.remove(m);
      this.settingsGroup.add(m);
    });

    this.buttons.back = back;
    this.buttons.stt = stt;
    this.buttons.tts = tts;
    this.buttons.avatar_prev = prev;
    this.buttons.avatar_next = next;
  }

  // ===========================================================================
  // Drawing
  // ===========================================================================

  redraw() {
    const ctx = this.ctx;
    const { W, H } = this._layout;

    ctx.fillStyle = 'rgb(8, 12, 18)';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(0, 229, 255, 0.55)';
    ctx.lineWidth = 10;
    ctx.strokeRect(10, 10, W - 20, H - 20);

    ctx.fillStyle = 'rgba(0, 229, 255, 0.10)';
    ctx.fillRect(0, 0, W, this._layout.headerH);

    // subtle handle strip
    ctx.fillStyle = 'rgba(0, 229, 255, 0.06)';
    const h = this._layout.handle;
    this._roundRect(ctx, h.x, h.y, h.w, h.h, 18, true, false);

    ctx.fillStyle = 'rgba(235, 250, 255, 0.96)';
    ctx.font = '800 54px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText('NEXUS VR CHAT', this.padding, 74);

    ctx.font = '700 34px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillStyle = this._statusColor();
    ctx.fillText(`● ${String(this.status).toUpperCase()}`, W - this.padding - 360, 74);

    ctx.font = '700 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillStyle = this.isPinned ? 'rgba(255,220,120,0.95)' : 'rgba(120,220,255,0.90)';
    ctx.fillText(this.isPinned ? 'PINNED (frozen)' : 'MOVE MODE (drag handle)', W - this.padding - 360, 104);

    if (this.mode === 'chat') this._drawChat(ctx);
    else this._drawSettings(ctx);

    this._drawButtons(ctx);

    this.settingsGroup.visible = this.mode === 'settings';
    this.texture.needsUpdate = true;
  }

  _drawChat(ctx) {
    const area = this._layout.chatArea;

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    this._roundRect(ctx, area.x, area.y, area.w, area.h, 26, true, false);

    const last = this.messages.slice(-6);
    let y = area.y + 60;

    ctx.font = '700 34px system-ui, -apple-system, Segoe UI, Roboto, Arial';

    last.forEach((m) => {
      const isUser = m.role === 'user';
      ctx.fillStyle = isUser ? 'rgba(120, 220, 255, 0.95)' : 'rgba(170, 255, 200, 0.92)';
      ctx.fillText(isUser ? 'YOU' : 'BOT', area.x + 22, y);

      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = '500 34px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      y = this._wrapText(ctx, m.text, area.x + 120, y, area.x + area.w - 22, 44) + 28;

      ctx.font = '700 34px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    });

    this._layout.chips.forEach((c) => {
      ctx.fillStyle = 'rgba(40, 140, 200, 0.78)';
      this._roundRect(ctx, c.x, c.y, c.w, c.h, 18, true, false);

      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = '700 30px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      const tw = ctx.measureText(c.label).width;
      ctx.fillText(c.label, c.x + (c.w - tw) / 2, c.y + 44);
    });
  }

  _drawSettings(ctx) {
    const top = this._layout.settingsTop;
    const W = this._layout.W;

    this._drawTopButton(ctx, top.back, '← BACK', 'rgba(90,120,150,0.85)');
    this._drawTopButton(ctx, top.stt, `STT: ${this.sttEnabled ? 'ON' : 'OFF'}`,
      this.sttEnabled ? 'rgba(50,190,120,0.9)' : 'rgba(120,120,120,0.75)');
    this._drawTopButton(ctx, top.tts, `TTS: ${this.ttsEnabled ? 'ON' : 'OFF'}`,
      this.ttsEnabled ? 'rgba(50,190,120,0.9)' : 'rgba(120,120,120,0.75)');

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '900 56px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText('SETTINGS', this.padding, 220);

    const total = this.avatars.length;
    const idx = total ? this.currentAvatarIndex : 0;
    const name = total ? (this.avatars[idx]?.name || `Avatar ${idx + 1}`) : 'No avatars loaded';

    this._drawTopButton(ctx, top.prev, '◀ PREV', 'rgba(0, 229, 255, 0.18)');
    this._drawTopButton(ctx, top.next, 'NEXT ▶', 'rgba(0, 229, 255, 0.18)');

    ctx.fillStyle = 'rgba(200,230,240,0.92)';
    ctx.font = '700 34px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText('Current Avatar:', this.padding, 320);

    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.font = '900 44px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText(name.slice(0, 32), this.padding, 395);

    ctx.fillStyle = 'rgba(200,230,240,0.75)';
    ctx.font = '600 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText(total ? `${idx + 1} / ${total}` : '0 / 0', W - this.padding - 160, 395);

    ctx.fillStyle = 'rgba(200,230,240,0.75)';
    ctx.font = '500 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText('Use PREV/NEXT to browse. (Fast + works with thousands)', this.padding, this._layout.H - 190);
  }

  _drawButtons(ctx) {
    const row = this._layout.btnRow;

    row.items.forEach((b) => {
      const isMicActive = b.key === 'mic' && this.status === 'listening';
      const isPinActive = b.key === 'pin' && this.isPinned;

      ctx.fillStyle = isMicActive
        ? 'rgba(220,60,60,0.92)'
        : isPinActive
          ? 'rgba(255,220,120,0.85)'
          : this._buttonColor(b.key);

      this._roundRect(ctx, b.x, b.y, b.w, b.h, 18, true, false);

      ctx.strokeStyle = 'rgba(0,229,255,0.25)';
      ctx.lineWidth = 4;
      this._roundRect(ctx, b.x, b.y, b.w, b.h, 18, false, true);

      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = '900 30px system-ui, -apple-system, Segoe UI, Roboto, Arial';

      const label = b.key === 'pin' ? (this.isPinned ? '📌 PINNED' : '✋ MOVE') : b.label;
      const tw = ctx.measureText(label).width;
      ctx.fillText(label, b.x + (b.w - tw) / 2, b.y + 62);
    });
  }

  _drawTopButton(ctx, rect, label, color) {
    ctx.fillStyle = color;
    this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 16, true, false);

    ctx.strokeStyle = 'rgba(0,229,255,0.20)';
    ctx.lineWidth = 3;
    this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 16, false, true);

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '900 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    const tw = ctx.measureText(label).width;
    ctx.fillText(label, rect.x + (rect.w - tw) / 2, rect.y + 50);
  }

  _buttonColor(key) {
    switch (key) {
      case 'mic': return 'rgba(60,190,120,0.88)';
      case 'send': return 'rgba(60,120,220,0.88)';
      case 'clear': return 'rgba(240,140,60,0.88)';
      case 'settings': return 'rgba(140,80,240,0.88)';
      case 'pin': return 'rgba(220,220,220,0.55)';
      default: return 'rgba(80,110,140,0.75)';
    }
  }

  _statusColor() {
    switch (this.status) {
      case 'listening': return 'rgba(80,230,120,0.95)';
      case 'thinking': return 'rgba(255,200,80,0.95)';
      case 'speaking': return 'rgba(120,180,255,0.95)';
      default: return 'rgba(200,200,200,0.85)';
    }
  }

  _roundRect(ctx, x, y, w, h, r, fill, stroke) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  _wrapText(ctx, text, x, y, maxX, lineHeight) {
    const words = String(text || '').split(/\s+/);
    let line = '';
    let yy = y;

    for (let i = 0; i < words.length; i++) {
      const test = line + words[i] + ' ';
      if (ctx.measureText(test).width > (maxX - x) && i > 0) {
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

  dispose() {
    try { this.texture?.dispose?.(); } catch (_) {}
    this.group.traverse((o) => {
      try { o.geometry?.dispose?.(); } catch (_) {}
      try { o.material?.dispose?.(); } catch (_) {}
    });
    this.scene.remove(this.group);
  }
}
