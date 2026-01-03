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
        this.camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 1000);
        // Initial desktop pose (auto-framed later)
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

        // Avatar Manager
        this.avatarManager = new AvatarManager({
            scene: this.scene,
            loader: this.loader,
            camera: this.camera,
            renderer: this.renderer,
        });

        // VR UI (Attached to Left Controller)
        this.vrChatPanel = new VRChatPanel({
            scene: this.scene,
            camera: this.camera,
            controller: this.vrControllers.controller1, 
        });
        this.vrChatPanel.setVisible(false);

        // Allow controllers to drag the panel
        this.vrControllers.setChatPanel(this.vrChatPanel);

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
            
            // Disable desktop controls to stop conflict
            this.controls.enabled = false;
            this.vrControllers.setEnabled(true);

            // Lazy Load VR Avatar System
            if (!this.vrChatIntegration.isInitialized) {
                await this.vrChatIntegration.initialize('/vendor/avatars/avatars.json');
            }

            // Menu Toggle (Left Button)
            this.vrControllers.setMenuButtonCallback(() => {
                const isVisible = this.vrChatPanel.group.visible;
                if (isVisible) this.vrChatIntegration.disable();
                else this.vrChatIntegration.enable();
            });

            console.log('[ViewerEngine] VR Started. Left Menu/X toggles chat.');
        });

        window.addEventListener('vr-session-end', () => {
            console.log('[ViewerEngine] VR Session Ending...');
            
            this.controls.enabled = true;
            this.vrControllers.setEnabled(false);
            this.vrControllers.resetPosition();
            this.vrChatIntegration.disable();

            // Re-frame desktop camera if avatar exists
            if (this.avatarManager?.currentRoot) {
                this.frameObject(this.avatarManager.currentRoot, 1.35);
            }
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
    }

    /**
     * [FIX] Smart Auto-Framing
     * Adjusts camera distance based on object bounding box size.
     * Works for tiny objects (zoom in) and huge objects (zoom out).
     */
    frameObject(root, fitOffset = 1.35) {
        if (!root) return;

        root.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(root);
        if (box.isEmpty()) return;

        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        // Focus on upper body (better for avatars)
        const target = center.clone();
        target.y += size.y * 0.15; 

        // Calculate size-based distance
        const maxSize = Math.max(size.x, size.y, size.z);
        const fitHeightDistance = (size.y / 2) / Math.tan((Math.PI * this.camera.fov) / 360);
        const fitWidthDistance = (size.x / 2) / Math.tan((Math.PI * this.camera.fov * this.camera.aspect) / 360);
        
        let distance = Math.max(fitHeightDistance, fitWidthDistance) * fitOffset;

        // [FIX] Clamping logic for Tiny vs Huge
        // If tiny (<0.5m), allow camera very close (0.1m)
        // If huge (>10m), allow camera very far (100m)
        const minAllowed = Math.max(0.1, maxSize * 0.5); 
        const maxAllowed = Math.max(10.0, maxSize * 10.0);
        
        distance = THREE.MathUtils.clamp(distance, minAllowed, maxAllowed);

        // Position Camera
        const direction = new THREE.Vector3(0, 0.1, 1).normalize(); // Slight angle
        const newPos = target.clone().add(direction.multiplyScalar(distance));

        this.camera.position.copy(newPos);
        this.controls.target.copy(target);

        // [FIX] Update OrbitControls limits so user isn't stuck
        this.controls.minDistance = minAllowed * 0.5;
        this.controls.maxDistance = maxAllowed * 2.0;
        
        this.controls.update();
    }

    // Load Desktop Avatar
    async loadAvatar(url, name = '') {
        // Skip if in VR (prevents overlap)
        if (this.renderer.xr.isPresenting) return;

        console.log(`[ViewerEngine] Loading desktop avatar: ${url}`);
        const info = await this.avatarManager.setAvatarByUrl(url, name);

        if (this.avatarManager.currentRoot) {
            // Register for VR interaction (so it's ready if we enter VR)
            this.vrControllers.registerAvatar(this.avatarManager.currentRoot);
            
            // Frame it on desktop
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