import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';
import { OrbitControls } from '../../vendor/three-0.147.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from '../../vendor/three-0.147.0/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from '../../vendor/three-0.147.0/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from '../../vendor/three-0.147.0/examples/jsm/loaders/KTX2Loader.js';
import { RoomEnvironment } from '../../vendor/three-0.147.0/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from '../../vendor/three-0.147.0/examples/jsm/libs/meshopt_decoder.module.js';
import { VRSupport } from './VRSupport.js';
import { VRControllers } from './VRControllers.js';
import { AvatarManager } from './AvatarManager.js';
import { VRChatPanel } from './VRChatPanel.js';
import { VRChatIntegration } from './VRChatIntegration.js';

export class ViewerEngine {
  constructor(containerEl) {
    console.log('[ViewerEngine] Initializing...');
    this.containerEl = containerEl;

    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();

    const w = containerEl.clientWidth || window.innerWidth;
    const h = containerEl.clientHeight || window.innerHeight;

    // Camera
    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 100);
    // Initial desktop pose (auto-framed after avatar loads)
    this.camera.position.set(0, 1.4, 2.2);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.physicallyCorrectLights = true;

    containerEl.innerHTML = '';
    containerEl.appendChild(this.renderer.domElement);

    // OrbitControls (Desktop Interaction)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    // ✅ Defaults (will be adapted per-avatar in frameObject)
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 25.0; // ✅ allow zooming out for huge models
    this.controls.target.set(0, 1.0, 0);
    this.controls.update();

    // Environment
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.25));

    // Loaders
    this.loader = new GLTFLoader();
    this.loader.setCrossOrigin('anonymous');

    const draco = new DRACOLoader();
    draco.setDecoderPath('/vendor/three-0.147.0/examples/js/libs/draco/');
    this.loader.setDRACOLoader(draco);

    const ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath('/vendor/three-0.147.0/examples/jsm/libs/basis/');
    ktx2.detectSupport(this.renderer);
    this.loader.setKTX2Loader(ktx2);
    this.loader.setMeshoptDecoder(MeshoptDecoder);

    // VR Systems
    this.vrSupport = new VRSupport(this.renderer, this.camera, this.scene);
    this.vrControllers = new VRControllers(this.renderer, this.scene, this.camera);

    // Avatar Manager (Single Source of Truth)
    this.avatarManager = new AvatarManager({
      scene: this.scene,
      loader: this.loader,
      camera: this.camera,
      renderer: this.renderer,
    });

    // VR UI
    this.vrChatPanel = new VRChatPanel({
      scene: this.scene,
      camera: this.camera,
      controller: this.vrControllers.controller1,
    });
    this.vrChatPanel.setVisible(false);

    // Integration
    this.vrChatIntegration = new VRChatIntegration({
      avatarManager: this.avatarManager,
      vrChatPanel: this.vrChatPanel,
      vrControllers: this.vrControllers,
      speechService: window.SpeechService || null,
      chatManager: window.ChatManager || null,
    });

    // --- Event Listeners ---
    window.addEventListener('vr-session-start', async () => {
      console.log('[ViewerEngine] VR Session Starting...');

      this.controls.enabled = false;
      this.vrControllers.setEnabled(true);

      if (!this.vrChatIntegration.isInitialized) {
        console.log('[ViewerEngine] Initializing VR Chat System...');
        await this.vrChatIntegration.initialize('/vendor/avatars/avatars.json');
      }

      this.vrControllers.setMenuButtonCallback(() => {
        const isVisible = this.vrChatPanel.group.visible;
        console.log(`[ViewerEngine] Toggling Menu: ${!isVisible}`);
        if (isVisible) this.vrChatIntegration.disable();
        else this.vrChatIntegration.enable();
      });

      console.log('[ViewerEngine] VR Started. Controls Disabled. Press Left Menu/X to toggle chat.');
    });

    window.addEventListener('vr-session-end', () => {
      console.log('[ViewerEngine] VR Session Ending...');

      this.controls.enabled = true;

      // Reset, then re-frame if an avatar exists
      this.camera.position.set(0, 1.4, 2.2);
      this.controls.target.set(0, 1.0, 0);
      this.controls.update();

      if (this.avatarManager?.currentRoot) {
        // ✅ use improved framing (not too close, can zoom out for huge models)
        this.frameObject(this.avatarManager.currentRoot, 1.35);
      }

      this.vrControllers.setEnabled(false);
      this.vrControllers.resetPosition();
      this.vrChatIntegration.disable();

      console.log('[ViewerEngine] VR Ended. Controls Enabled.');
    });

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    this.animate();
    console.log('[ViewerEngine] Ready.');
  }

  resize() {
    const w = this.containerEl.clientWidth || window.innerWidth;
    const h = this.containerEl.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);

    // Optional: if you want perfect reframing after resize, uncomment:
    // if (!this.renderer.xr.isPresenting && this.avatarManager?.currentRoot) {
    //   this.frameObject(this.avatarManager.currentRoot, 1.35);
    // }
  }

  /**
   * ✅ Improved Auto-frame (not too close + supports huge models):
   * - Uses both vertical and horizontal FOV to compute a correct fit.
   * - Adaptive min/max distance based on model size.
   * - Updates OrbitControls min/maxDistance so user can zoom far enough.
   */
  frameObject(root, fitOffset = 1.35) {
    if (!root) return;

    root.updateWorldMatrix(true, true);

    const box = new THREE.Box3().setFromObject(root);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Better composition: bias target slightly upward (toward head/torso)
    const target = center.clone();
    target.y += size.y * 0.12;

    // Compute distance required to fit object in view (height + width)
    const aspect = this.camera.aspect;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    const fitHeightDistance = (size.y / 2) / Math.tan(vFov / 2);
    const fitWidthDistance = (size.x / 2) / Math.tan(hFov / 2);

    let distance = Math.max(fitHeightDistance, fitWidthDistance) * fitOffset;

    // Adaptive clamp based on model size
    const maxSize = Math.max(size.x, size.y, size.z);

    // Don’t allow tiny models to push camera too close
    const minD = THREE.MathUtils.clamp(maxSize * 0.9, 0.8, 2.0);

    // Allow huge models to be framed and allow zooming out
    const maxD = Math.max(6.0, maxSize * 4.0);

    distance = THREE.MathUtils.clamp(distance, minD, maxD);

    // Place camera on a pleasant diagonal view
    const dir = new THREE.Vector3(0.28, 0.08, 1).normalize();
    const newPos = target.clone().add(dir.multiplyScalar(distance));

    this.camera.position.copy(newPos);
    this.controls.target.copy(target);

    // ✅ Critical: allow user zoom range based on avatar size
    this.controls.minDistance = Math.max(0.35, minD * 0.5);
    this.controls.maxDistance = Math.max(10.0, distance * 4.0, maxD);

    this.controls.update();
    this.camera.updateProjectionMatrix();
  }

  // Forward load calls to AvatarManager
  async loadAvatar(url, name = '') {
    if (this.renderer.xr.isPresenting) {
      console.log('[ViewerEngine] Skipping desktop loadAvatar because VR is active');
      return;
    }

    console.log(`[ViewerEngine] Loading desktop avatar: ${url}`);
    const info = await this.avatarManager.setAvatarByUrl(url, name);

    if (this.avatarManager.currentRoot) {
      this.vrControllers.registerAvatar(this.avatarManager.currentRoot);

      // ✅ Improved auto-frame (balanced distance + supports huge models)
      this.frameObject(this.avatarManager.currentRoot, 1.35);
    }

    return info;
  }

  animate() {
    this.renderer.setAnimationLoop(() => {
      const dt = this.clock.getDelta();

      try {
        const t = this.clock.getElapsedTime();
        window.NEXUS_PROCEDURAL_ANIMATOR?.update?.(t, dt);
      } catch (_) {}

      this.avatarManager?.update(dt);
      this.vrControllers.update(dt);

      if (this.renderer.xr.isPresenting) {
        this.vrChatPanel?.update();
      } else {
        this.controls.update();
      }

      this.renderer.render(this.scene, this.camera);
    });
  }
}
