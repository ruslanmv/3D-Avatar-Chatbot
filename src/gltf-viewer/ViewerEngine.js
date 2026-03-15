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
import { ARSupport } from './ARSupport.js';
import { MobileSupport } from './MobileSupport.js';
import { PostProcessing } from './PostProcessing.js';
import { ModelViewerAR } from './ModelViewerAR.js';
import { PerformanceMonitor } from './PerformanceMonitor.js';

export class ViewerEngine {
    constructor(containerEl) {
        console.log('[ViewerEngine] Initializing...');
        this.containerEl = containerEl;

        this.scene = new THREE.Scene();
        this.clock = new THREE.Clock();

        // Stable framing state — stores avatar bounds for resize reframing
        this.framingState = {
            bounds: null,
            center: null,
            size: null,
            baseFitOffset: 1.35,
            portraitFitOffset: 2.0,
            lastAspect: 1,
        };

        const { w, h } = this._getViewportSize();

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
        this.renderer.toneMappingExposure = 1.4;
        this.renderer.physicallyCorrectLights = true;

        // Shadow configuration — enterprise-grade soft shadows
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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

        // Desktop background (default: black — can be changed via settings)
        this._desktopBgKey = 'black';
        this.scene.background = new THREE.Color(0x000000);

        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x888899, 0.9));

        // Key light — main directional light with optimized shadows
        this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
        this.directionalLight.position.set(1, 2.5, 1.5);
        this.directionalLight.castShadow = true;
        this.directionalLight.shadow.mapSize.width = 2048;
        this.directionalLight.shadow.mapSize.height = 2048;
        this.directionalLight.shadow.camera.near = 0.1;
        this.directionalLight.shadow.camera.far = 10;
        this.directionalLight.shadow.camera.left = -2;
        this.directionalLight.shadow.camera.right = 2;
        this.directionalLight.shadow.camera.top = 3;
        this.directionalLight.shadow.camera.bottom = -0.5;
        this.directionalLight.shadow.bias = -0.0005;
        this.directionalLight.shadow.normalBias = 0.02;
        this.directionalLight.shadow.radius = 3; // Soft shadow edge (PCFSoft)
        this.scene.add(this.directionalLight);

        // Fill light — bright opposite side for even illumination (Sketchfab-style)
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.85);
        fillLight.position.set(-1, 1.5, -0.5);
        this.scene.add(fillLight);

        // Rim light — subtle backlight for depth separation from background
        const rimLight = new THREE.DirectionalLight(0xeeeeff, 0.4);
        rimLight.position.set(0, 1.5, -2);
        this.scene.add(rimLight);

        // Bottom fill — prevents dark legs/lower body (Sketchfab uses env map for this)
        const bottomFill = new THREE.DirectionalLight(0xffffff, 0.35);
        bottomFill.position.set(0, -0.5, 1);
        this.scene.add(bottomFill);

        // Ground shadow plane (desktop — makes avatar look grounded)
        this._desktopShadowPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2),
            new THREE.ShadowMaterial({ opacity: 0.08, transparent: true })
        );
        this._desktopShadowPlane.receiveShadow = true;
        this._desktopShadowPlane.position.y = 0;
        this._desktopShadowPlane.name = 'DesktopShadowPlane';
        this.scene.add(this._desktopShadowPlane);

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

        // Guard against WebGL context loss — stop animation loop so Three.js
        // doesn't try to render with a dead context. The cancelAnimationFrame
        // crash is fixed directly in three.module.js (null guard on context).
        this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault(); // allow WebGL context to be restored
            console.warn('[ViewerEngine] WebGL context lost — stopping animation loop');
            this.renderer.setAnimationLoop(null);
        });
        this.renderer.domElement.addEventListener('webglcontextrestored', () => {
            console.log('[ViewerEngine] WebGL context restored — restarting animation loop');
            this.animate();
        });

        // VR Systems
        this.vrSupport = new VRSupport(this.renderer, this.camera, this.scene, containerEl);
        this.vrControllers = new VRControllers(this.renderer, this.scene, this.camera);

        // AR Support
        this.arSupport = new ARSupport(this.renderer, this.camera, this.scene, containerEl);

        // Create centered XR launch bar inside the avatar viewport
        this._createXRLaunchBar(containerEl);

        // Model-Viewer AR (Sketchfab-style: QR on desktop, native AR on mobile)
        this.modelViewerAR = new ModelViewerAR();
        // Enhance AR button for all platforms (desktop QR + mobile fallback)
        setTimeout(() => {
            if (this.arSupport?.arButton) {
                this.modelViewerAR.enhanceARButton(this.arSupport.arButton, this.arSupport);
            }
            // Check if page was opened from QR code scan → auto-launch AR
            this.modelViewerAR.checkAutoLaunchAR();
        }, 1000); // Wait for async AR support checks

        // Mobile Support (auto-detects and applies optimizations)
        this.mobileSupport = new MobileSupport(this.renderer, this.camera, containerEl);

        // Post-Processing Pipeline (SSAO + Bloom + FXAA)
        this.postProcessing = new PostProcessing(this.renderer, this.scene, this.camera, {
            ssao: !this.mobileSupport.isMobileOrTablet(), // SSAO too expensive for mobile
            bloom: true,
            fxaa: true,
            isMobile: this.mobileSupport.isMobileOrTablet(),
        });

        // Adaptive Performance Monitor — auto-adjusts quality to maintain FPS
        this.perfMonitor = new PerformanceMonitor({
            initialLevel: this.mobileSupport.isMobileOrTablet() ? 1 : 0,
        });
        this.perfMonitor.onQualityChange((level, fps) => {
            this.postProcessing?.setQualityLevel(level);

            // At level 3 (lowest), also reduce shadow quality
            if (level >= 3) {
                this.directionalLight.shadow.mapSize.width = 1024;
                this.directionalLight.shadow.mapSize.height = 1024;
                this.directionalLight.shadow.map?.dispose();
                this.directionalLight.shadow.map = null;
            } else if (level < 3 && this.directionalLight.shadow.mapSize.width < 2048) {
                this.directionalLight.shadow.mapSize.width = 2048;
                this.directionalLight.shadow.mapSize.height = 2048;
                this.directionalLight.shadow.map?.dispose();
                this.directionalLight.shadow.map = null;
            }
        });

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

        // Wire chat panel to VR controllers for dragging support
        this.vrControllers.setChatPanel(this.vrChatPanel);

        // Integration
        this.vrChatIntegration = new VRChatIntegration({
            avatarManager: this.avatarManager,
            vrChatPanel: this.vrChatPanel,
            vrControllers: this.vrControllers,
            speechService: window.SpeechService || null,
            chatManager: window.ChatManager || null,
        });

        // VR ground grid (spatial reference) — created once, shown only during VR
        this.vrGroundGrid = null;
        this._vrSavedBackground = null;
        this._vrSavedHemiIntensity = null;
        this._hemiLight = this.scene.children.find((c) => c.isHemisphereLight);

        // --- Event Listeners ---
        window.addEventListener('vr-session-start', async () => {
            console.log('[ViewerEngine] VR Session Starting...');

            // Disable post-processing in XR (direct framebuffer rendering required)
            this.postProcessing?.onXRSessionStart();

            // Set VR background (default: black; can be changed via VR settings panel)
            this._vrSavedBackground = this.scene.background;
            this._vrBackgroundColor = this._vrBackgroundColor || 'black';
            this.scene.background = new THREE.Color(this._vrBackgroundColor === 'blue' ? 0x1a1a2e : 0x000000);

            // Adjust lighting for VR (different balance than desktop studio lighting)
            if (this._hemiLight) {
                this._vrSavedHemiIntensity = this._hemiLight.intensity;
                this._hemiLight.intensity = 0.6;
            }
            // Lower exposure for VR (desktop uses brighter studio exposure)
            this._vrSavedExposure = this.renderer.toneMappingExposure;
            this.renderer.toneMappingExposure = 1.0;

            // Show VR ground grid (hidden in 'void' mode — character only)
            if (this._vrBackgroundColor !== 'void') {
                this._showVRGround();
            }

            // Apply mobile VR performance optimizations
            this.mobileSupport?.applyVROptimizations();

            this.controls.enabled = false;
            this.vrControllers.setEnabled(true);

            // Position user closer to avatar and facing front
            // Offset the XR reference space so user spawns at z=1.2 instead of z=2.2
            try {
                const baseRefSpace = this.renderer.xr.getReferenceSpace();
                if (baseRefSpace && baseRefSpace.getOffsetReferenceSpace) {
                    // Move user forward (negative Z) and ensure eye-level height
                    const offset = new XRRigidTransform(
                        { x: 0, y: 0, z: 0.8, w: 1 }, // shift 0.8m forward toward avatar
                        { x: 0, y: 0, z: 0, w: 1 }
                    );
                    const newRefSpace = baseRefSpace.getOffsetReferenceSpace(offset);
                    this.renderer.xr.setReferenceSpace(newRefSpace);
                    console.log('[ViewerEngine] VR reference space offset applied — user positioned closer to avatar');
                }
            } catch (e) {
                console.warn('[ViewerEngine] Could not offset VR reference space:', e);
            }

            // Ensure avatar is visible in VR (safe position/scale)
            if (this.avatarManager?.currentRoot) {
                const root = this.avatarManager.currentRoot;
                root.position.x = 0;
                root.position.z = -1.2;
                if (root.position.y < -0.25 || root.position.y > 0.25) {
                    root.position.y = 0;
                }
            }

            // Refresh controller reference after VR session starts
            this.vrChatPanel.setLeftController(this.vrControllers.controller1);
            console.log('[ViewerEngine] 🎮 Controller reference refreshed for VR session');

            if (!this.vrChatIntegration.isInitialized) {
                console.log('[ViewerEngine] Initializing VR Chat System...');
                await this.vrChatIntegration.initialize('/vendor/avatars/avatars.json');
            }

            this.vrControllers.setMenuButtonCallback(() => {
                const isVisible = this.vrChatPanel.group.visible;
                console.log(
                    `[ViewerEngine] 🔄 Toggling chat panel: ${!isVisible} (integrationInitialized=${this.vrChatIntegration.isInitialized})`
                );

                if (this.vrChatIntegration.isInitialized) {
                    // Normal path: use integration (handles speech, avatar, etc.)
                    if (isVisible) this.vrChatIntegration.disable();
                    else this.vrChatIntegration.enable();
                } else {
                    // Fallback: show panel even if integration failed (for debugging)
                    this.vrChatPanel.setVisible(!isVisible);
                    console.warn(
                        '[ViewerEngine] ⚠️ VRChatIntegration not initialized, toggled panel directly (fallback mode)'
                    );
                }
            });

            console.log('[ViewerEngine] ✅ VR Started. Press Left X button to toggle chat.');
        });

        window.addEventListener('vr-session-end', () => {
            console.log('[ViewerEngine] VR Session Ending...');

            // Re-enable post-processing for desktop
            this.postProcessing?.onXRSessionEnd();

            // Restore desktop background from current setting
            const bgColor = ViewerEngine.BG_COLORS[this._desktopBgKey] ?? 0x000000;
            this.scene.background = new THREE.Color(bgColor);

            // Restore desktop hemisphere light intensity
            if (this._hemiLight && this._vrSavedHemiIntensity != null) {
                this._hemiLight.intensity = this._vrSavedHemiIntensity;
            }

            // Restore desktop exposure
            if (this._vrSavedExposure != null) {
                this.renderer.toneMappingExposure = this._vrSavedExposure;
            }

            // Hide VR ground grid
            this._hideVRGround();

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

            // Restore mobile rendering settings
            this.mobileSupport?.restoreFromVR();

            console.log('[ViewerEngine] VR Ended. Controls Enabled.');
        });

        // --- VR Settings Change Listener ---
        window.addEventListener('vr-setting-changed', (e) => {
            const { key, value } = e.detail || {};
            console.log(`[ViewerEngine] VR setting changed: ${key} = ${value}`);

            if (key === 'avatarScale' && this.avatarManager?.currentRoot) {
                this.avatarManager.currentRoot.scale.setScalar(value);
            }

            if (key === 'showEnvironment') {
                if (value) {
                    // Restore environment
                    if (this._savedEnvironment) {
                        this.scene.environment = this._savedEnvironment;
                    }
                } else {
                    // Hide environment (save first)
                    this._savedEnvironment = this.scene.environment;
                    this.scene.environment = null;
                }
            }

            if (key === 'moveSpeed') {
                const speedMap = { slow: 0.8, normal: 1.8, fast: 3.5 };
                this.vrControllers.options.moveSpeed = speedMap[value] || 1.8;
            }

            // VR background color (black → blue → void)
            if (key === 'vrBackground') {
                this._vrBackgroundColor = value;
                if (this.vrSupport?.isVRActive) {
                    this.scene.background = new THREE.Color(value === 'blue' ? 0x1a1a2e : 0x000000);
                    // Show/hide floor grid based on mode
                    if (value === 'void') {
                        this._hideVRGround();
                    } else {
                        this._showVRGround();
                    }
                }
            }

            // Session mode switch (VR ↔ AR)
            if (key === 'sessionMode') {
                this._switchXRMode(value);
            }
        });

        // --- AR Event Listeners ---
        window.addEventListener('ar-session-start', () => {
            console.log('[ViewerEngine] AR Session Starting...');
            this.postProcessing?.onXRSessionStart();
            this.controls.enabled = false;

            // Update panel state to reflect AR mode
            if (this.vrChatPanel) {
                this.vrChatPanel.xrSettings.sessionMode = 'ar';
                this.vrChatPanel.redraw();
            }

            // Position avatar at floor level for AR
            if (this.avatarManager?.currentRoot) {
                this.avatarManager.currentRoot.position.y = 0;
            }
        });

        // Auto-place avatar on detected floor in AR
        window.addEventListener('ar-floor-detected', (e) => {
            const { y, position } = e.detail || {};
            console.log(`[ViewerEngine] AR floor detected at Y=${y?.toFixed(3)}`);

            if (this.avatarManager?.currentRoot) {
                // Place avatar at the detected floor position, facing user
                this.avatarManager.currentRoot.position.set(
                    position?.x || 0,
                    y || 0,
                    (position?.z || 0) - 1.0 // 1m in front of detected point
                );
                console.log('[ViewerEngine] Avatar auto-placed on detected floor');
            }
        });

        window.addEventListener('ar-session-end', () => {
            console.log('[ViewerEngine] AR Session Ending...');
            this.postProcessing?.onXRSessionEnd();
            this.controls.enabled = true;

            // Reset panel state to VR
            if (this.vrChatPanel) {
                this.vrChatPanel.xrSettings.sessionMode = 'vr';
                this.vrChatPanel.redraw();
            }

            // Re-frame avatar for desktop view
            if (this.avatarManager?.currentRoot) {
                this.frameObject(this.avatarManager.currentRoot, 1.35);
            }
            this.controls.update();
        });

        this._resizeTimer = null;
        this._onResize = () => {
            clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => this.resize(), 100);
        };
        window.addEventListener('resize', this._onResize);

        if (window.visualViewport) {
            this._onVisualViewportResize = () => {
                clearTimeout(this._resizeTimer);
                this._resizeTimer = setTimeout(() => this.resize(), 100);
            };
            window.visualViewport.addEventListener('resize', this._onVisualViewportResize);
            window.visualViewport.addEventListener('scroll', this._onVisualViewportResize);
        }

        this.animate();
        console.log('[ViewerEngine] Ready.');
    }

    /**
     * Switch between VR and AR sessions.
     * WebXR only allows one active session, so we end the current one first.
     * @param {'vr'|'ar'} targetMode
     */
    async _switchXRMode(targetMode) {
        console.log(`[ViewerEngine] Switching XR mode to: ${targetMode}`);

        try {
            // End current XR session (VR or AR)
            const session = this.renderer.xr.getSession();
            if (session) {
                await session.end();
            }

            if (targetMode === 'ar') {
                // Wait for VR cleanup, then start AR
                setTimeout(() => {
                    if (this.arSupport) {
                        this.arSupport.startAR();
                    }
                }, 400);
            } else {
                // Wait for AR cleanup, then start VR
                setTimeout(() => {
                    if (this.vrSupport) {
                        this.vrSupport.toggleVR();
                    }
                }, 400);
            }
        } catch (e) {
            console.error('[ViewerEngine] XR mode switch error:', e);
        }
    }

    _getViewportSize() {
        const vv = window.visualViewport;
        const w = Math.max(1, Math.round(this.containerEl.clientWidth || vv?.width || window.innerWidth));
        const h = Math.max(1, Math.round(this.containerEl.clientHeight || vv?.height || window.innerHeight));
        return { w, h };
    }

    resize() {
        const { w, h } = this._getViewportSize();

        // Clamp aspect to prevent extreme distortion on very narrow/wide windows
        this.camera.aspect = Math.max(0.4, Math.min(w / h, 3.0));
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(w, h, false);

        const dprCap = this.mobileSupport?.isMobileOrTablet() ? 1.5 : 2.0;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));

        this.postProcessing?.setSize(w, h);

        // Only reframe on mobile orientation/viewport changes — not on desktop resize
        if (!this.renderer.xr.isPresenting && this.mobileSupport?.isMobileOrTablet()) {
            this._reframeAvatarPreserveAppearance();
        }
    }

    _storeFramingState(object) {
        if (!object) return;

        const box = new THREE.Box3().setFromObject(object);
        if (box.isEmpty()) return;

        const size = new THREE.Vector3();
        const center = new THREE.Vector3();

        box.getSize(size);
        box.getCenter(center);

        this.framingState.bounds = box.clone();
        this.framingState.size = size.clone();
        this.framingState.center = center.clone();
        this.framingState.lastAspect = this.camera.aspect || 1;
    }

    _reframeAvatarPreserveAppearance() {
        if (!this.avatarManager?.currentRoot || !this.framingState?.size || !this.framingState?.center) {
            return;
        }

        const size = this.framingState.size.clone();
        const center = this.framingState.center.clone();

        const aspect = this.camera.aspect || 1;
        const isPortrait = aspect < 1;

        const fitOffset = isPortrait ? (this.mobileSupport?.getFitOffset?.() ?? 2.0) : 1.35;

        const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);

        const fitHeightDistance = (size.y * fitOffset) / (2 * Math.tan(verticalFov / 2));
        const fitWidthDistance = (size.x * fitOffset) / (2 * Math.tan(horizontalFov / 2));

        const distance = Math.max(fitHeightDistance, fitWidthDistance);

        const targetY = center.y + size.y * (isPortrait ? 0.12 : 0.08);

        this.controls.target.set(center.x, targetY, center.z);

        this.camera.position.set(center.x, targetY + size.y * 0.02, center.z + distance);

        this.camera.lookAt(this.controls.target);
        this.controls.update();
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

        const fitHeightDistance = size.y / 2 / Math.tan(vFov / 2);
        const fitWidthDistance = size.x / 2 / Math.tan(hFov / 2);

        let distance = Math.max(fitHeightDistance, fitWidthDistance) * fitOffset;

        // Adaptive clamp based on model size
        const maxSize = Math.max(size.x, size.y, size.z);

        // Don't allow tiny models to push camera too close
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

        // Fit shadow camera frustum to avatar bounding box
        this._fitShadowCamera(box, center, size);
    }

    /**
     * Dynamically fit the directional light shadow camera to the avatar's bounding box.
     * Ensures crisp shadows without wasted shadow map resolution.
     */
    _fitShadowCamera(box, center, size) {
        if (!this.directionalLight) return;
        const cam = this.directionalLight.shadow.camera;
        const padding = 0.5;
        cam.left = -(size.x / 2 + padding);
        cam.right = size.x / 2 + padding;
        cam.top = size.y + padding;
        cam.bottom = -padding;
        cam.near = 0.1;
        cam.far = size.y + size.z + 5;
        cam.updateProjectionMatrix();

        // Position light relative to avatar center for optimal shadow angle
        this.directionalLight.position.set(center.x + 1, center.y + size.y * 0.8, center.z + 1.5);
        this.directionalLight.target.position.copy(center);
        this.directionalLight.target.updateMatrixWorld();

        // Position desktop shadow plane at avatar's feet
        if (this._desktopShadowPlane) {
            this._desktopShadowPlane.position.y = box.min.y;
        }
    }

    // Forward load calls to AvatarManager
    async loadAvatar(url, name = '') {
        if (this.renderer.xr.isPresenting) {
            console.log('[ViewerEngine] Skipping desktop loadAvatar because VR is active');
            return;
        }

        console.log(`[ViewerEngine] Loading desktop avatar: ${url}`);
        const info = await this.avatarManager.setAvatarByUrl(url, name);

        // Update model-viewer AR with current model URL
        this.modelViewerAR?.setModel(url);

        if (this.avatarManager.currentRoot) {
            this.vrControllers.registerAvatar(this.avatarManager.currentRoot);

            // Mobile-aware auto-frame (wider offset on phones)
            const fitOffset = this.mobileSupport?.getFitOffset() || 1.35;
            this.frameObject(this.avatarManager.currentRoot, fitOffset);
            this._storeFramingState(this.avatarManager.currentRoot);
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
                if (this.arSupport?.isARActive) {
                    // AR mode: update hit-test for surface placement
                    const frame = this.renderer.xr.getFrame?.();
                    this.arSupport.updateHitTest(this.renderer, frame);
                } else {
                    // VR mode: update chat panel and mic indicator
                    this.vrChatPanel?.update();
                    this.vrChatPanel?._animateMicIndicator(dt);
                    this.vrChatPanel?._updateMicIndicatorPosition();
                }
            } else {
                this.controls.update();
                // Adaptive quality only outside XR
                this.perfMonitor?.update(dt);
            }

            // Render through post-processing pipeline (falls back to direct render during XR)
            this.postProcessing.render();
        });
    }

    // =========================================================================
    // XR LAUNCH BAR (below avatar viewport — no overlap with character)
    // =========================================================================

    _createXRLaunchBar(containerEl) {
        // Create the launch bar container
        this.xrLaunchBar = document.createElement('div');
        this.xrLaunchBar.id = 'xr-launch-bar';
        this.xrLaunchBar.className = 'xr-launch-bar';

        // Append VR button
        if (this.vrSupport.vrButton) {
            this.xrLaunchBar.appendChild(this.vrSupport.vrButton);
        }

        // Append AR button
        if (this.arSupport.arButton) {
            this.xrLaunchBar.appendChild(this.arSupport.arButton);
        }

        // Place OUTSIDE the viewport — after it in the avatar-section
        // This prevents buttons from overlapping the character
        const avatarSection = containerEl.closest('.avatar-section') || containerEl.parentElement;
        if (avatarSection) {
            avatarSection.appendChild(this.xrLaunchBar);
        } else {
            // Fallback: append after the container
            containerEl.parentElement?.insertBefore(this.xrLaunchBar, containerEl.nextSibling);
        }
    }

    // =========================================================================
    // DESKTOP BACKGROUND
    // =========================================================================

    static BG_COLORS = {
        black: 0x000000,
        dark: 0x1a1a2e,
        gray: 0x808080,
        light: 0xb0b0b0,
    };

    /**
     * Change the desktop viewport background color.
     * @param {'black'|'dark'|'gray'|'light'|'white'} key
     */
    setDesktopBackground(key) {
        const color = ViewerEngine.BG_COLORS[key];
        if (color === undefined) return;
        this._desktopBgKey = key;
        if (!this.renderer.xr.isPresenting) {
            this.scene.background = new THREE.Color(color);
        }
        console.log(`[ViewerEngine] Desktop background → ${key}`);
    }

    // =========================================================================
    // VR GROUND GRID (spatial reference in VR mode)
    // =========================================================================

    _showVRGround() {
        if (!this.vrGroundGrid) {
            // Create a grid helper at floor level
            this.vrGroundGrid = new THREE.GridHelper(20, 40, 0x00e5ff, 0x0a1628);
            this.vrGroundGrid.material.transparent = true;
            this.vrGroundGrid.material.opacity = 0.3;
            this.vrGroundGrid.name = 'VRGroundGrid';
        }
        this.scene.add(this.vrGroundGrid);
    }

    _hideVRGround() {
        if (this.vrGroundGrid) {
            this.scene.remove(this.vrGroundGrid);
        }
    }
}
