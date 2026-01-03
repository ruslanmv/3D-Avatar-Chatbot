/**
 * WebXR-Enabled Chatbot System
 * Supports both desktop and VR modes (Meta Quest 3, etc.)
 */

class WebXRChatbot {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);

        if (!this.container) {
            throw new Error(`Container ${containerId} not found`);
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.vrmLoader = null;

        this.isVRMode = false;
        this.vrButton = null;

        this.init();
    }

    /**
     * Initialize the 3D scene and WebXR
     */
    init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x303030);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            30.0,
            this.container.clientWidth / this.container.clientHeight,
            0.1,
            20.0
        );
        this.camera.position.set(0.0, 1.4, 1.5);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.xr.enabled = true; // Enable WebXR

        this.container.appendChild(this.renderer.domElement);

        // Lighting
        this.setupLights();

        // VRM Loader
        this.vrmLoader = new VRMLoader(this.scene, this.camera, this.renderer);

        // Controls (desktop)
        this.setupControls();

        // VR Button
        this.setupVRButton();

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());

        // Start animation loop
        this.renderer.setAnimationLoop(() => this.animate());

        console.log('[WebXRChatbot] Initialized successfully');
    }

    /**
     * Setup scene lighting
     */
    setupLights() {
        // Directional light
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(1.0, 1.0, 1.0).normalize();
        this.scene.add(dirLight);

        // Ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        // Hemisphere light for better ambient lighting
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
        hemiLight.position.set(0, 20, 0);
        this.scene.add(hemiLight);
    }

    /**
     * Setup desktop controls (OrbitControls)
     */
    setupControls() {
        if (THREE.OrbitControls) {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.target.set(0, 1.0, 0);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.update();
        }
    }

    /**
     * Setup VR button
     */
    setupVRButton() {
        // Check if VRButton is available
        if (THREE.VRButton) {
            this.vrButton = THREE.VRButton.createButton(this.renderer);
            this.container.appendChild(this.vrButton);
        } else {
            console.warn('[WebXRChatbot] VRButton not available');
            // Create custom VR button
            this.createCustomVRButton();
        }

        // Listen for VR session changes
        this.renderer.xr.addEventListener('sessionstart', () => {
            this.isVRMode = true;
            console.log('[WebXRChatbot] VR session started');
        });

        this.renderer.xr.addEventListener('sessionend', () => {
            this.isVRMode = false;
            console.log('[WebXRChatbot] VR session ended');
        });
    }

    /**
     * Create custom VR button (fallback)
     */
    createCustomVRButton() {
        const button = document.createElement('button');
        button.style.position = 'absolute';
        button.style.bottom = '20px';
        button.style.left = '50%';
        button.style.transform = 'translateX(-50%)';
        button.style.padding = '12px 24px';
        button.style.background = '#00e5ff';
        button.style.border = 'none';
        button.style.borderRadius = '8px';
        button.style.color = '#000';
        button.style.fontWeight = 'bold';
        button.style.cursor = 'pointer';
        button.style.zIndex = '999';
        button.textContent = 'ENTER VR';

        button.onclick = () => {
            if (navigator.xr) {
                navigator.xr.requestSession('immersive-vr').then((session) => {
                    this.renderer.xr.setSession(session);
                });
            } else {
                alert('WebXR not supported in this browser');
            }
        };

        this.container.appendChild(button);
        this.vrButton = button;
    }

    /**
     * Load VRM avatar
     * @param {string} url - URL to VRM file
     */
    async loadAvatar(url) {
        try {
            await this.vrmLoader.loadVRM(url);
            console.log(`[WebXRChatbot] Avatar loaded: ${url}`);
        } catch (error) {
            console.error('[WebXRChatbot] Failed to load avatar:', error);
            throw error;
        }
    }

    /**
     * Set avatar expression
     * @param {string} expression - Expression name
     * @param {number} value - Value 0-1
     */
    setExpression(expression, value = 1.0) {
        this.vrmLoader.setExpression(expression, value);
    }

    /**
     * Trigger blink animation
     */
    blink() {
        this.vrmLoader.blink();
    }

    /**
     * Start talking animation
     * @param {number} intensity - Mouth opening intensity 0-1
     */
    startTalking(intensity = 0.5) {
        this.vrmLoader.talk(intensity);
    }

    /**
     * Stop talking animation
     */
    stopTalking() {
        this.vrmLoader.stopTalking();
    }

    /**
     * Animation loop
     */
    animate() {
        // Update controls (desktop mode)
        if (this.controls && !this.isVRMode) {
            this.controls.update();
        }

        // Update VRM avatar
        if (this.vrmLoader) {
            this.vrmLoader.update();
        }

        // Render
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Handle window resize
     */
    onWindowResize() {
        if (!this.container) return;

        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    /**
     * Dispose of resources
     */
    dispose() {
        if (this.vrmLoader) {
            this.vrmLoader.dispose();
        }

        if (this.renderer) {
            this.renderer.dispose();
        }

        if (this.controls) {
            this.controls.dispose();
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebXRChatbot;
} else {
    window.WebXRChatbot = WebXRChatbot;
}
