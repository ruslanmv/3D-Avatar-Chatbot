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
import { VRMediaPanel } from './VRMediaPanel.js';
import { ModelViewerAR } from './ModelViewerAR.js';
import { PerformanceMonitor } from './PerformanceMonitor.js';
import { PassthroughEnhancer } from './PassthroughEnhancer.js';
import { VRBoneGrabber } from './VRBoneGrabber.js';
import { VRPoseSystem } from './VRPoseSystem.js';
import { VRPuppetInteraction } from './VRPuppetInteraction.js';
import { VRIntimacySystem } from './VRIntimacySystem.js';
import { VRGazeController } from './VRGazeController.js';
import { DesktopShadowEnhancer } from './DesktopShadowEnhancer.js';

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

        // Renderer — xrCompatible is required for WebXR immersive sessions
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: false,
            xrCompatible: true,
        });

        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(w, h);
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;
        this.renderer.physicallyCorrectLights = true;

        // Shadow configuration — off by default, togglable via settings
        this.renderer.shadowMap.enabled = false;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this._shadowsEnabled = false;

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
        this.directionalLight.castShadow = false; // toggled via setShadows()
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

        // Rim light — very subtle backlight for depth separation from background
        // Kept low to avoid bright edge outlines on dark VRM materials
        const rimLight = new THREE.DirectionalLight(0xeeeeff, 0.15);
        rimLight.position.set(0, 1.5, -2);
        this.scene.add(rimLight);

        // Bottom fill — prevents dark legs/lower body (Sketchfab uses env map for this)
        // Kept low to avoid bright edge outlines on trouser/leg seams
        const bottomFill = new THREE.DirectionalLight(0xffffff, 0.18);
        bottomFill.position.set(0, -0.5, 1);
        this.scene.add(bottomFill);

        // Ground shadow plane (desktop — makes avatar look grounded)
        this._desktopShadowPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2),
            new THREE.ShadowMaterial({ opacity: 0.06, transparent: true })
        );
        this._desktopShadowPlane.receiveShadow = true;
        this._desktopShadowPlane.position.y = 0;
        this._desktopShadowPlane.name = 'DesktopShadowPlane';
        this._desktopShadowPlane.visible = false; // toggled via setShadows()
        this.scene.add(this._desktopShadowPlane);

        // Desktop shadow enhancer — AAA-quality contact shadow + tuned frustum
        this.desktopShadowEnhancer = new DesktopShadowEnhancer({
            scene: this.scene,
            directionalLight: this.directionalLight,
        });

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

        // Passthrough Enhancer (industry-grade AR grounding, lighting, shadows)
        this.passthroughEnhancer = new PassthroughEnhancer({
            scene: this.scene,
            renderer: this.renderer,
            camera: this.camera,
            directionalLight: this.directionalLight,
        });

        // VR Pose System (IK + presets + snap + smoothing)
        this.vrPoseSystem = new VRPoseSystem({ scene: this.scene });
        // Expose globally for VRChatPanel preset cycling
        window.vrPoseSystem = this.vrPoseSystem;

        // VR Bone Grabber (direct bone manipulation via controller grip)
        this.vrBoneGrabber = new VRBoneGrabber({
            scene: this.scene,
            renderer: this.renderer,
        });
        this.vrBoneGrabber.setPoseSystem(this.vrPoseSystem);
        this.vrControllers.setBoneGrabber(this.vrBoneGrabber);

        // VR Puppet Interaction (unified puppet mode: handles + IK + two-hand transform)
        this.vrPuppetInteraction = new VRPuppetInteraction({
            scene: this.scene,
            renderer: this.renderer,
            camera: this.camera,
            controllers: this.vrControllers,
            poseSystem: this.vrPoseSystem,
            boneGrabber: this.vrBoneGrabber,
        });
        this.vrControllers.setPuppetInteraction(this.vrPuppetInteraction);

        // VR Intimacy / Close Presence System (non-destructive overlay on VR pose + puppet)
        this.vrIntimacySystem = new VRIntimacySystem({
            scene: this.scene,
            camera: this.camera,
            renderer: this.renderer,
            controllers: this.vrControllers,
            poseSystem: this.vrPoseSystem,
            puppetInteraction: this.vrPuppetInteraction,
        });

        // VR Gaze Controller — "Follow-Me Eyes" (avatar looks at user's HMD)
        this.vrGazeController = new VRGazeController(this.renderer, this.camera);

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
        this.perfMonitor.onQualityChange((level, _fps) => {
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

        // VR Media Panel (floating image display in VR)
        this.vrMediaPanel = new VRMediaPanel(this.scene);
        window.VRMediaPanel = this.vrMediaPanel;

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

            // Enable bone grabber, pose system, and puppet interaction for VR session
            this.vrBoneGrabber?.setEnabled(true);
            this.vrPoseSystem?.setEnabled(true);
            // Set puppet interaction avatar (may have been loaded before VR started)
            if (this.avatarManager?.currentRoot) {
                this.vrPuppetInteraction?.setAvatar(this.avatarManager.currentRoot);
            }
            // Auto-enable puppet mode so user can touch and move the character immediately
            this.vrPuppetInteraction?.setEnabled(true);
            this.vrControllers.setPuppetMode(true);
            if (this.vrChatPanel) {
                this.vrChatPanel.xrSettings.puppetMode = true;
            }
            if (window.poseEditor && this.vrBoneGrabber) {
                this.vrBoneGrabber.setPoseEditor(window.poseEditor);
            }

            // Enable intimacy system if toggled on
            this.vrIntimacySystem?.setAvatar(this.avatarManager?.currentRoot || null);
            this.vrIntimacySystem?.setEnabled(!!this.vrChatPanel?.xrSettings?.intimacyMode);

            // Follow-me eyes: point avatar gaze at user's HMD
            this.vrGazeController?.setAvatar(this.avatarManager?.currentRoot || null);
            this.vrGazeController?.setEnabled(this.vrChatPanel?.xrSettings?.followGaze !== false);

            // Diagnostic: log state of all VR pose/bone systems
            console.log('[ViewerEngine] VR Pose Systems State:', {
                boneGrabber: {
                    enabled: this.vrBoneGrabber?.enabled,
                    hasAvatar: !!this.vrBoneGrabber?.avatarRoot,
                    meshCount: this.vrBoneGrabber?.avatarMeshes?.length,
                    boneMapSize: this.vrBoneGrabber?._boneNameToKey?.size,
                    hasPoseSystem: !!this.vrBoneGrabber?.poseSystem,
                    hasPoseEditor: !!this.vrBoneGrabber?.poseEditor,
                },
                poseSystem: {
                    enabled: this.vrPoseSystem?.enabled,
                    hasAvatar: !!this.vrPoseSystem?.avatarRoot,
                    boneCount: this.vrPoseSystem?._bones?.size,
                    ikEnabled: this.vrPoseSystem?.ikEnabled,
                },
            });

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

            // Sync desktop settings (LLM provider, model, etc.) into VR chat panel
            this.vrChatPanel.syncFromDesktopSettings();

            if (!this.vrChatIntegration.isInitialized) {
                console.log('[ViewerEngine] Initializing VR Chat System...');
                try {
                    await this.vrChatIntegration.initialize('/vendor/avatars/avatars.json');
                } catch (e) {
                    console.error('[ViewerEngine] VR Chat initialization failed:', e);
                }
            }

            this.vrControllers.setMenuButtonCallback(() => {
                const isVisible = this.vrChatPanel.group.visible;
                console.log(
                    `[ViewerEngine] 🔄 Toggling chat panel: ${!isVisible} (integrationInitialized=${this.vrChatIntegration.isInitialized})`
                );

                if (this.vrChatIntegration.isInitialized) {
                    // Normal path: use integration (handles speech, avatar, etc.)
                    if (isVisible) {
                        this.vrChatIntegration.disable();
                    } else {
                        this.vrChatIntegration.enable();
                    }
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

            // Deactivate passthrough if it was enabled in VR
            this.passthroughEnhancer?.deactivate();

            // Restore opaque clear color for desktop rendering
            this.renderer.setClearColor(0x000000, 1);

            // Re-enable post-processing for desktop
            this.postProcessing?.onXRSessionEnd();

            // Restore desktop background from current setting
            const bgColor = ViewerEngine.BG_COLORS[this._desktopBgKey] ?? 0x000000;
            this.scene.background = new THREE.Color(bgColor);

            // Restore desktop hemisphere light intensity
            if (this._hemiLight && this._vrSavedHemiIntensity !== null) {
                this._hemiLight.intensity = this._vrSavedHemiIntensity;
            }

            // Restore desktop exposure
            if (this._vrSavedExposure !== null) {
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
            this.vrBoneGrabber?.setEnabled(false);
            this.vrPoseSystem?.setEnabled(false);
            this.vrPuppetInteraction?.endAll();
            this.vrIntimacySystem?.setEnabled(false);
            this.vrGazeController?.release(); // Release VR gaze override → resume mouse tracking
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

            // VR background color (black → blue → void → passthrough)
            if (key === 'vrBackground') {
                this._vrBackgroundColor = value;
                if (this.vrSupport?.isVRActive) {
                    if (value === 'passthrough') {
                        // Enable passthrough: transparent background shows camera feed
                        // Both scene.background=null AND clear color alpha=0 are required
                        // for Quest 3 passthrough. The XRWebGLLayer alpha:true (set in
                        // VRSupport.js) makes the framebuffer transparent, but only if
                        // the renderer doesn't fill it with an opaque clear color.
                        this.scene.background = null;
                        this.renderer.setClearColor(0x000000, 0); // alpha=0 → transparent
                        this._hideVRGround();
                        this.passthroughEnhancer?.activate(this.avatarManager?.currentRoot || null);
                    } else {
                        // Deactivate passthrough if it was on
                        if (this.passthroughEnhancer?.active) {
                            this.passthroughEnhancer.deactivate();
                        }
                        this.scene.background = new THREE.Color(value === 'blue' ? 0x1a1a2e : 0x000000);
                        this.renderer.setClearColor(0x000000, 1); // alpha=1 → opaque
                        // Show/hide floor grid based on mode
                        if (value === 'void') {
                            this._hideVRGround();
                        } else {
                            this._showVRGround();
                        }
                    }
                }
            }

            // Puppet mode toggle (free 3D avatar placement + puppet interaction)
            if (key === 'puppetMode') {
                this.vrControllers.setPuppetMode(value);
                this.vrPuppetInteraction?.setEnabled(!!value);
            }

            // Intimacy / close-presence mode toggle
            if (key === 'intimacyMode') {
                this.vrIntimacySystem?.setEnabled(!!value);
                console.log(`[ViewerEngine] Intimacy mode -> ${value ? 'ON' : 'OFF'}`);
            }

            // Joint visibility toggle (hoverOnly → alwaysVisible)
            if (key === 'jointVisibility') {
                this.vrPuppetInteraction?.setJointVisibility(value);
            }

            // Session mode switch (VR ↔ AR)
            if (key === 'sessionMode') {
                this._switchXRMode(value);
            }

            // Follow-me gaze toggle
            if (key === 'followGaze') {
                this.vrGazeController?.setEnabled(!!value);
            }
        });

        // --- Emotion bridge for VR Intimacy System ---
        window.addEventListener('avatar-emotion-changed', (e) => {
            this.vrIntimacySystem?.setEmotion?.(e.detail?.emotion || 'neutral');
        });

        // --- AR Event Listeners ---
        window.addEventListener('ar-session-start', () => {
            console.log('[ViewerEngine] AR Session Starting...');
            this.postProcessing?.onXRSessionStart();
            this.controls.enabled = false;

            // Transparent clear color required for AR passthrough on Quest 3
            this.renderer.setClearColor(0x000000, 0);

            // Update panel state to reflect AR mode
            if (this.vrChatPanel) {
                this.vrChatPanel.xrSettings.sessionMode = 'ar';
                this.vrChatPanel.redraw();
            }

            // Position avatar at floor level for AR
            if (this.avatarManager?.currentRoot) {
                this.avatarManager.currentRoot.position.y = 0;
            }

            // Activate passthrough enhancements (contact shadow, light estimation, depth)
            this.passthroughEnhancer?.activate(this.avatarManager?.currentRoot || null);
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

            // Restore opaque clear color for desktop rendering
            this.renderer.setClearColor(0x000000, 1);

            // Deactivate passthrough enhancements (restore desktop lighting)
            this.passthroughEnhancer?.deactivate();

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
     * Waits for isPresenting to clear before starting the new session.
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

            // Wait for renderer.xr.isPresenting to clear (poll up to 2s)
            await this._waitForXRCleanup(2000);

            if (targetMode === 'ar') {
                if (this.arSupport) {
                    const started = await this.arSupport.startAR();
                    if (!started) {
                        console.warn('[ViewerEngine] AR start failed — retrying after 500ms');
                        setTimeout(() => this.arSupport?.startAR(), 500);
                    }
                }
            } else {
                if (this.vrSupport) {
                    this.vrSupport.toggleVR();
                }
            }
        } catch (e) {
            console.error('[ViewerEngine] XR mode switch error:', e);
        }
    }

    /**
     * Wait for renderer.xr.isPresenting to become false.
     * @param {number} timeoutMs - max wait time in ms
     */
    _waitForXRCleanup(timeoutMs = 2000) {
        return new Promise((resolve) => {
            const start = performance.now();
            const check = () => {
                if (!this.renderer.xr.isPresenting || performance.now() - start > timeoutMs) {
                    resolve();
                    return;
                }
                setTimeout(check, 50);
            };
            // Give at least 100ms for session end event to propagate
            setTimeout(check, 100);
        });
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
        if (!object) {
            return;
        }

        const box = new THREE.Box3().setFromObject(object);
        if (box.isEmpty()) {
            return;
        }

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

        const fitOffset = isPortrait ? (this.mobileSupport?.getFitOffset?.() ?? 1.4) : 1.35;

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
        if (!root) {
            return;
        }

        root.updateWorldMatrix(true, true);

        const box = new THREE.Box3().setFromObject(root);
        if (!isFinite(box.min.x) || !isFinite(box.max.x)) {
            return;
        }

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
        const isMobileDevice = this.mobileSupport?.isMobile?.() || false;

        // Don't allow tiny models to push camera too close.
        // On mobile the narrower FOV already handles framing, so allow closer.
        const minDFloor = isMobileDevice ? 0.5 : 0.8;
        const minDCeil = isMobileDevice ? 1.2 : 2.0;
        const minD = THREE.MathUtils.clamp(maxSize * 0.9, minDFloor, minDCeil);

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
        if (!this.directionalLight) {
            return;
        }

        // Delegate to DesktopShadowEnhancer for AAA-quality frustum fitting
        if (this.desktopShadowEnhancer) {
            this.desktopShadowEnhancer.fitToAvatar(box, center, size);
        } else {
            // Fallback: basic frustum fitting
            const cam = this.directionalLight.shadow.camera;
            const padX = Math.max(size.x * 0.15, 0.2);
            const padY = Math.max(size.y * 0.1, 0.2);
            cam.left = -(size.x / 2 + padX);
            cam.right = size.x / 2 + padX;
            cam.top = size.y + padY;
            cam.bottom = -0.1;
            cam.near = 0.1;
            cam.far = Math.max(size.y * 2, size.z + 4);
            cam.updateProjectionMatrix();

            this.directionalLight.position.set(
                center.x + size.x * 0.6,
                center.y + size.y * 0.9,
                center.z + size.z * 0.8 + 1.0
            );
            this.directionalLight.target.position.copy(center);
            this.directionalLight.target.updateMatrixWorld();
        }

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

        // Stale load was superseded by a newer one — bail out
        if (!info) {
            console.log('[ViewerEngine] Desktop avatar load superseded, skipping setup');
            return null;
        }

        // Update model-viewer AR with current model URL
        this.modelViewerAR?.setModel(url);

        if (this.avatarManager.currentRoot) {
            this.vrControllers.registerAvatar(this.avatarManager.currentRoot);

            // Update passthrough enhancer with new avatar root
            this.passthroughEnhancer?.setAvatarRoot(this.avatarManager.currentRoot);

            // Preserve current pose preset across avatar change
            const savedPreset = this.vrPoseSystem?.getCurrentPreset() || null;

            // Update bone grabber, pose system, and puppet interaction with new avatar
            this.vrBoneGrabber?.setAvatar(this.avatarManager.currentRoot);
            this.vrPoseSystem?.setAvatar(this.avatarManager.currentRoot);
            // Enable pose system on desktop too (blending, presets)
            if (this.vrPoseSystem && !this.vrPoseSystem.enabled) {
                this.vrPoseSystem.setEnabled(true);
            }
            this.vrPuppetInteraction?.setAvatar(this.avatarManager.currentRoot);
            this.vrIntimacySystem?.setAvatar(this.avatarManager.currentRoot);
            this.vrGazeController?.setAvatar(this.avatarManager.currentRoot);
            if (window.poseEditor) {
                this.vrBoneGrabber?.setPoseEditor(window.poseEditor);
            }

            // Restore previous pose or fall back to standing (T-Pose reset)
            if (this.vrPoseSystem?.enabled) {
                const restorePreset = savedPreset || 'standing';
                this.vrPoseSystem.applyPreset(restorePreset, 0);
            }

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

            // VRM update FIRST — syncs normalized bone proxies → raw skeleton.
            // This must happen before ProceduralAnimator so that procedural
            // offsets (breathing, head-look, basePose) are applied ON TOP of
            // the VRM-normalized rest pose and are not overwritten.
            this.avatarManager?.update(dt);

            try {
                const t = this.clock.getElapsedTime();
                window.NEXUS_PROCEDURAL_ANIMATOR?.update?.(t, dt);
            } catch (_e) {
                // Procedural animator may not be loaded
            }
            this.vrControllers.update(dt);
            this.vrPoseSystem?.update(dt);
            this.vrPuppetInteraction?.update(dt);
            this.vrIntimacySystem?.update(dt);

            if (this.renderer.xr.isPresenting) {
                if (this.arSupport?.isARActive) {
                    // AR mode: update hit-test for surface placement
                    const frame = this.renderer.xr.getFrame?.();
                    this.arSupport.updateHitTest(this.renderer, frame);

                    // Update passthrough enhancements (contact shadow tracking, light estimation)
                    const refSpace = this.renderer.xr.getReferenceSpace?.();
                    this.passthroughEnhancer?.update(dt, frame, refSpace);
                } else {
                    // VR mode: update chat panel and mic indicator
                    this.vrChatPanel?.update();
                    this.vrChatPanel?._animateMicIndicator(dt);
                    this.vrChatPanel?._updateMicIndicatorPosition();

                    // Follow-me eyes: avatar looks at user's HMD position
                    this.vrGazeController?.update(dt);

                    // Update passthrough enhancements in VR passthrough mode
                    if (this.passthroughEnhancer?.active) {
                        const frame = this.renderer.xr.getFrame?.();
                        const refSpace = this.renderer.xr.getReferenceSpace?.();
                        this.passthroughEnhancer.update(dt, frame, refSpace);
                    }
                }
            } else {
                this.controls.update();
                // Adaptive quality only outside XR
                this.perfMonitor?.update(dt);
                // Update desktop contact shadow position (follows avatar root)
                this.desktopShadowEnhancer?.update(this.avatarManager?.currentRoot);
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

        // Place inside the avatar footer actions bar (next to emotion/avatar controls)
        const footerActions =
            containerEl.closest('.avatar-card')?.querySelector('.avatar-footer-actions') ||
            containerEl.closest('.avatar-section')?.querySelector('.avatar-footer-actions');
        if (footerActions) {
            footerActions.appendChild(this.xrLaunchBar);
        } else {
            // Fallback: after the viewport's parent
            const parent =
                containerEl.closest('.avatar-panel') ||
                containerEl.closest('.avatar-section') ||
                containerEl.parentElement;
            parent.appendChild(this.xrLaunchBar);
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
        if (color === undefined) {
            return;
        }
        this._desktopBgKey = key;
        if (!this.renderer.xr.isPresenting) {
            this.scene.background = new THREE.Color(color);
        }
        console.log(`[ViewerEngine] Desktop background → ${key}`);
    }

    /**
     * Enable or disable shadows (self-shadow on model + ground shadow plane).
     * @param {boolean} enabled
     */
    setShadows(enabled) {
        this._shadowsEnabled = enabled;
        this.renderer.shadowMap.enabled = enabled;

        // Toggle shadow casting on the key light
        if (this.directionalLight) {
            this.directionalLight.castShadow = enabled;
        }

        // Toggle ground shadow plane visibility
        if (this._desktopShadowPlane) {
            this._desktopShadowPlane.visible = enabled;
        }

        // Configure avatar meshes: castShadow=enabled, receiveShadow=false
        // receiveShadow on thin anime geometry causes starburst/fan shadow artifacts
        if (this.desktopShadowEnhancer && this.avatarManager?.currentRoot) {
            this.desktopShadowEnhancer.configureAvatarShadows(this.avatarManager.currentRoot, enabled);
        } else if (this.avatarManager?.currentRoot) {
            // Fallback without enhancer
            this.avatarManager.currentRoot.traverse((node) => {
                if (node.isMesh) {
                    node.castShadow = enabled;
                    node.receiveShadow = false;
                }
            });
        }

        // Enable/disable contact shadow enhancer
        if (this.desktopShadowEnhancer) {
            if (enabled) {
                this.desktopShadowEnhancer.enable();
            } else {
                this.desktopShadowEnhancer.disable();
            }
        }

        // Force shadow map recompilation
        this.renderer.shadowMap.needsUpdate = true;

        console.log(`[ViewerEngine] Shadows → ${enabled ? 'on' : 'off'}`);
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
