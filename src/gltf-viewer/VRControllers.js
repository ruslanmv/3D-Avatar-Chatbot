/**
 * VR Controllers Module (Production Ready - Standard Exploration)
 * --------------------------------------------------------
 * CONTROLS:
 * - Left Stick:  Move Walk / Strafe
 * - Right Stick: Turn (X-axis) / Fly Up & Down (Y-axis)
 * - Triggers:    "Grab and Spin" the Avatar
 *
 * FIX ADDED:
 * - UI dragging support for VRChatPanel handle when in MOVE mode (unpinned).
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

export class VRControllers {
  constructor(renderer, scene, camera, options = {}) {
    if (!renderer || !scene || !camera) {
      throw new Error('[VRControllers] CRITICAL: renderer, scene, and camera are required.');
    }

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.options = {
      moveSpeed: 1.8,
      verticalSpeed: 1.2,
      turnSpeed: 2.0,
      rotationSensitivity: 5.5,
      deadzone: 0.15,
      rayLength: 5,
      rayColor: 0x00e5ff,
      rayGrabColor: 0x00ff00,
      ...options,
    };

    this.enabled = false;
    this.playerRig = new THREE.Group();
    this.controllers = { left: null, right: null };
    this.controller1 = null;
    this.controller2 = null;
    this.controllerGrip1 = null;
    this.controllerGrip2 = null;

    this.raycaster = new THREE.Raycaster();
    this.tempMatrix = new THREE.Matrix4();
    this.interactables = [];
    this.uiInteractables = [];

    // Avatar drag
    this.dragState = { active: false, hand: null, object: null, previousX: 0 };

    // ✅ UI drag (VRChatPanel)
    this.chatPanel = null;
    this.uiDragState = { active: false, hand: null };

    this.onUIButtonClick = null;
    this.onMenuButtonPress = null;
    this.menuButtonWasPressed = false;
    this.hoveredUI = null;

    this.init();
  }

  // ✅ set panel reference so controller can call beginDrag/dragTo/endDrag
  setChatPanel(panel) {
    this.chatPanel = panel || null;
  }

  init() {
    console.log('[VRControllers] Initializing...');
    this.playerRig.add(this.camera);
    this.scene.add(this.playerRig);
    this.setupControllers();
    console.log('[VRControllers] Ready.');
  }

  setupControllers() {
    this.controller1 = this.renderer.xr.getController(0);
    this.playerRig.add(this.controller1);
    this._bindEvents(this.controller1, 0);

    this.controller2 = this.renderer.xr.getController(1);
    this.playerRig.add(this.controller2);
    this._bindEvents(this.controller2, 1);

    this.addRayVisual(this.controller1);
    this.addRayVisual(this.controller2);

    this.controllerGrip1 = this.renderer.xr.getControllerGrip(0);
    this.addControllerModel(this.controllerGrip1);
    this.playerRig.add(this.controllerGrip1);

    this.controllerGrip2 = this.renderer.xr.getControllerGrip(1);
    this.addControllerModel(this.controllerGrip2);
    this.playerRig.add(this.controllerGrip2);
  }

  _bindEvents(controller, index) {
    const getHand = (data) => data?.handedness || (index === 0 ? 'left' : 'right');

    controller.addEventListener('connected', (e) => {
      const hand = getHand(e.data);
      this.controllers[hand] = e.data;
    });

    controller.addEventListener('disconnected', (e) => {
      const hand = getHand(e.data);
      this.controllers[hand] = null;
      if (this.dragState.active && this.dragState.hand === hand) {
        this._endDrag(hand);
      }
      if (this.uiDragState.active && this.uiDragState.hand === hand) {
        this._endUIDrag(hand);
      }
    });

    controller.addEventListener('selectstart', (e) => {
      const hand = getHand(e.data);
      this._startDrag(controller, hand);
    });

    controller.addEventListener('selectend', (e) => {
      const hand = getHand(e.data);
      this._endDrag(hand);
      this._endUIDrag(hand);
    });
  }

  addRayVisual(controller) {
    if (!controller) return;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: this.options.rayColor, opacity: 0.8, transparent: true })
    );
    line.name = 'ray';
    line.scale.z = this.options.rayLength;
    controller.add(line);
  }

  addControllerModel(grip) {
    if (!grip) return;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0x00e5ff, roughness: 0.5 })
    );
    grip.add(sphere);
  }

  // --- Interaction ---

  _startDrag(controller, hand) {
    if (this.dragState.active || this.uiDragState.active) return;

    this.tempMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

    // 1) UI
    const uiIntersects = this.raycaster.intersectObjects(this.uiInteractables, false);
    if (uiIntersects.length > 0) {
      const hit = uiIntersects[0];
      const uiTarget = hit.object;

      // ✅ If it's the panel handle AND panel is in MOVE mode => start dragging instead of clicking
      if (
        this.chatPanel &&
        !this.chatPanel.isPinned &&
        uiTarget?.userData?.type === 'handle'
      ) {
        const ok = this.chatPanel.beginDrag(hit.point);
        if (ok) {
          this.uiDragState.active = true;
          this.uiDragState.hand = hand;

          const line = controller.getObjectByName('ray');
          if (line) line.material.color.setHex(this.options.rayGrabColor);
        }
        return;
      }

      // otherwise normal UI click
      this._handleUIClick(uiTarget);
      return;
    }

    // 2) Avatar
    const intersects = this.raycaster.intersectObjects(this.interactables, true);
    if (intersects.length > 0) {
      let target = intersects[0].object;
      while (target) {
        if (target.userData && target.userData.isRotatable) {
          this.dragState = { active: true, hand, object: target, previousX: controller.position.x };
          const line = controller.getObjectByName('ray');
          if (line) line.material.color.setHex(this.options.rayGrabColor);
          return;
        }
        target = target.parent;
      }
    }
  }

  _handleUIClick(mesh) {
    if (mesh && mesh.name && this.onUIButtonClick) {
      this.onUIButtonClick(mesh.name, mesh.userData);
    }
  }

  _endUIDrag(hand) {
    if (!this.uiDragState.active || this.uiDragState.hand !== hand) return;

    // end drag on panel
    if (this.chatPanel) this.chatPanel.endDrag();

    const controller = hand === 'left' ? this.controller1 : this.controller2;
    if (controller) {
      const line = controller.getObjectByName('ray');
      if (line) line.material.color.setHex(this.options.rayColor);
    }

    this.uiDragState.active = false;
    this.uiDragState.hand = null;
  }

  _updateUIDragging() {
    if (!this.uiDragState.active || !this.chatPanel) return;

    const controller = this.uiDragState.hand === 'left' ? this.controller1 : this.controller2;
    if (!controller) return;

    // ray update
    this.tempMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

    // we want a stable hitpoint on the panel while dragging:
    // easiest: raycast against the panel's own interactables (handle + buttons),
    // but while dragging you might move off the handle. So also raycast against panel surface.
    const hitsUI = this.raycaster.intersectObjects(this.chatPanel.getInteractables(), false);
    const hitsPanel = this.raycaster.intersectObject(this.chatPanel.panelMesh, false);

    const hit = (hitsPanel && hitsPanel.length) ? hitsPanel[0] : (hitsUI && hitsUI.length ? hitsUI[0] : null);
    if (!hit) return;

    this.chatPanel.dragTo(hit.point);
  }

  _updateUIHover() {
    if (!this.controller2) return; // Right hand pointer

    // If dragging, skip hover so it doesn't flicker
    if (this.uiDragState.active) return;

    this.tempMatrix.identity().extractRotation(this.controller2.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(this.controller2.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

    const intersects = this.raycaster.intersectObjects(this.uiInteractables, false);

    if (this.hoveredUI && (!intersects.length || intersects[0].object !== this.hoveredUI)) {
      if (this.hoveredUI.userData.onHoverExit) this.hoveredUI.userData.onHoverExit(this.hoveredUI);
      this.hoveredUI = null;
    }

    if (intersects.length > 0) {
      const newHover = intersects[0].object;
      if (newHover !== this.hoveredUI) {
        this.hoveredUI = newHover;
        if (this.hoveredUI.userData.onHoverEnter) this.hoveredUI.userData.onHoverEnter(this.hoveredUI);
      }
    }
  }

  _endDrag(hand) {
    if (this.dragState.active && this.dragState.hand === hand) {
      const controller = hand === 'left' ? this.controller1 : this.controller2;
      if (controller) {
        const line = controller.getObjectByName('ray');
        if (line) line.material.color.setHex(this.options.rayColor);
      }
      this.dragState.active = false;
      this.dragState.object = null;
      this.dragState.hand = null;
    }
  }

  _updateDragging() {
    if (!this.dragState.active || !this.dragState.object) return;
    const controller = this.dragState.hand === 'left' ? this.controller1 : this.controller2;
    if (!controller) return;
    const delta = controller.position.x - this.dragState.previousX;
    if (Math.abs(delta) > 0.0001) {
      this.dragState.object.rotation.y += delta * this.options.rotationSensitivity;
    }
    this.dragState.previousX = controller.position.x;
  }

  // --- Locomotion ---

  pollGamepadInput(dt) {
    const left = this.controllers.left;
    if (left && left.gamepad) {
      const menuBtn = left.gamepad.buttons[4] || left.gamepad.buttons[3];
      if (menuBtn && menuBtn.pressed && !this.menuButtonWasPressed) {
        this.menuButtonWasPressed = true;
        if (this.onMenuButtonPress) this.onMenuButtonPress();
      } else if (!menuBtn || !menuBtn.pressed) {
        this.menuButtonWasPressed = false;
      }

      const axes = left.gamepad.axes;
      if (axes.length >= 4) this._applyMove(axes[2], axes[3], dt);
    }

    const right = this.controllers.right;
    if (right && right.gamepad) {
      const axes = right.gamepad.axes;
      if (axes.length >= 4) {
        this._applyTurn(axes[2], dt);
        this._applyVertical(axes[3], dt);
      }
    }
  }

  _applyMove(x, y, dt) {
    if (Math.abs(x) < 0.15 && Math.abs(y) < 0.15) return;
    const cam = this.renderer.xr.getCamera(this.camera);
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0,1,0));
    const speed = this.options.moveSpeed * dt;
    this.playerRig.position.addScaledVector(fwd, -y * speed);
    this.playerRig.position.addScaledVector(right, x * speed);
  }

  _applyTurn(x, dt) {
    if (Math.abs(x) < 0.15) return;
    this.playerRig.rotateY(-x * this.options.turnSpeed * dt);
  }

  _applyVertical(y, dt) {
    if (Math.abs(y) < 0.15) return;
    this.playerRig.position.y += -y * this.options.verticalSpeed * dt;
  }

  // --- API ---

  update(dt) {
    if (!this.enabled || !this.renderer.xr.isPresenting) return;

    this.pollGamepadInput(dt);

    this._updateDragging();

    // ✅ update UI panel dragging each frame while trigger held
    this._updateUIDragging();

    this._updateUIHover();
  }

  registerAvatar(root) {
    if (!root) return;
    root.userData.isRotatable = true;
    if (!this.interactables.includes(root)) this.interactables.push(root);
  }

  registerUIInteractables(list) {
    this.uiInteractables = list || [];
  }

  setUIButtonCallback(cb) { this.onUIButtonClick = cb; }
  setMenuButtonCallback(cb) { this.onMenuButtonPress = cb; }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this.playerRig.position.set(0, 0, 2.5);
      this.playerRig.rotation.set(0, 0, 0);
    }
  }

  resetPosition() {
    this.playerRig.position.set(0, 0, 0);
    this.playerRig.rotation.set(0, 0, 0);
  }

  dispose() {
    if (this.controller1) this.playerRig.remove(this.controller1);
    if (this.controller2) this.playerRig.remove(this.controller2);
    if (this.controllerGrip1) this.playerRig.remove(this.controllerGrip1);
    if (this.controllerGrip2) this.playerRig.remove(this.controllerGrip2);
    if (this.playerRig) this.scene.remove(this.playerRig);
    this.interactables = [];
    this.uiInteractables = [];
  }
}
