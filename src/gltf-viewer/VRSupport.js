/**
 * VR Support Module for ViewerEngine
 * Adds WebXR capabilities to the existing 3D viewer
 */

export class VRSupport {
    constructor(renderer, camera, scene) {
        this.renderer = renderer;
        this.camera = camera;
        this.scene = scene;
        this.vrButton = null;
        this.isVRActive = false;

        this.init();
    }

    init() {
        // Enable WebXR on renderer
        this.renderer.xr.enabled = true;

        // Create VR button
        this.createVRButton();

        // Listen for VR session events
        this.renderer.xr.addEventListener('sessionstart', () => {
            this.isVRActive = true;
            console.log('[VR] Session started');
            this.onSessionStart();
        });

        this.renderer.xr.addEventListener('sessionend', () => {
            this.isVRActive = false;
            console.log('[VR] Session ended');
            this.onSessionEnd();
        });
    }

    createVRButton() {
        // Check if WebXR is supported
        if (!navigator.xr) {
            console.warn('[VR] WebXR not supported in this browser');
            return;
        }

        // Create VR button
        this.vrButton = document.createElement('button');
        this.vrButton.id = 'vr-button';
        this.vrButton.textContent = 'ENTER VR';

        // Style the button
        Object.assign(this.vrButton.style, {
            position: 'absolute',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '12px 24px',
            fontSize: '16px',
            fontWeight: 'bold',
            color: '#000',
            background: 'linear-gradient(135deg, #00e5ff 0%, #00b8d4 100%)',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            zIndex: '999',
            fontFamily: 'Orbitron, sans-serif',
            boxShadow: '0 4px 12px rgba(0, 229, 255, 0.4)',
            transition: 'all 0.3s',
        });

        // Hover effect
        this.vrButton.onmouseenter = () => {
            this.vrButton.style.transform = 'translateX(-50%) translateY(-2px)';
            this.vrButton.style.boxShadow = '0 6px 16px rgba(0, 229, 255, 0.6)';
        };

        this.vrButton.onmouseleave = () => {
            this.vrButton.style.transform = 'translateX(-50%) translateY(0)';
            this.vrButton.style.boxShadow = '0 4px 12px rgba(0, 229, 255, 0.4)';
        };

        // Check VR support and setup button
        navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
            if (supported) {
                this.vrButton.onclick = () => this.toggleVR();
                document.body.appendChild(this.vrButton);
                console.log('[VR] Button added - WebXR supported');
            } else {
                console.warn('[VR] immersive-vr not supported');
                // Show button but disabled
                this.vrButton.textContent = 'VR NOT AVAILABLE';
                this.vrButton.style.opacity = '0.5';
                this.vrButton.style.cursor = 'not-allowed';
                this.vrButton.onclick = () => {
                    alert('WebXR not available. Use HTTPS or Meta Quest Browser.');
                };
                document.body.appendChild(this.vrButton);
            }
        });
    }

    async toggleVR() {
        if (this.renderer.xr.isPresenting) {
            // Exit VR
            await this.renderer.xr.getSession().end();
        } else {
            // Enter VR
            try {
                const sessionInit = {
                    optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
                };
                const session = await navigator.xr.requestSession('immersive-vr', sessionInit);
                await this.renderer.xr.setSession(session);
                this.vrButton.textContent = 'EXIT VR';
            } catch (error) {
                console.error('[VR] Failed to start session:', error);
                alert('Failed to start VR: ' + error.message);
            }
        }
    }

    onSessionStart() {
        // Update button text
        if (this.vrButton) {
            this.vrButton.textContent = 'EXIT VR';
        }

        // Dispatch custom event
        window.dispatchEvent(new CustomEvent('vr-session-start'));
    }

    onSessionEnd() {
        // Update button text
        if (this.vrButton) {
            this.vrButton.textContent = 'ENTER VR';
        }

        // Dispatch custom event
        window.dispatchEvent(new CustomEvent('vr-session-end'));
    }

    dispose() {
        if (this.vrButton && this.vrButton.parentElement) {
            this.vrButton.parentElement.removeChild(this.vrButton);
        }
    }
}
