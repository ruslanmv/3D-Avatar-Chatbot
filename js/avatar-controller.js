/**
 * Avatar Controller Module
 * Manages the 3D avatar, animations, and states
 */

class AvatarController {
    constructor() {
        this.canvas = null;
        this.avatarViewer = null;
        this.isInitialized = false;
        this.currentState = 'idle'; // idle, listening, thinking, speaking
        this.statusIndicator = null;
        this.statusText = null;
    }

    /**
     * Initialize the avatar viewer
     */
    async initialize() {
        try {
            this.canvas = document.getElementById('avatarCanvas');
            this.statusIndicator = document.getElementById('avatarStatusIndicator');
            this.statusText = document.getElementById('avatarStatusText');

            // Check if app.js (avatar viewer) is loaded
            if (typeof window.GLTFAvatarViewer !== 'undefined') {
                // Initialize the existing avatar viewer
                this.initializeExistingViewer();
            } else {
                // Create a fallback placeholder
                this.createPlaceholder();
            }

            this.isInitialized = true;
            this.setState('idle');

            console.log('Avatar controller initialized');
        } catch (error) {
            console.error('Failed to initialize avatar:', error);
            this.createErrorPlaceholder(error.message);
        }
    }

    /**
     * Initialize existing GLTFAvatarViewer from app.js
     */
    initializeExistingViewer() {
        try {
            // The app.js file should have initialized the viewer
            // We'll just hook into it if it exists
            console.log('Using existing GLTF Avatar Viewer');

            // Set up canvas context
            const ctx = this.canvas.getContext('2d');
            if (ctx) {
                ctx.fillStyle = '#f0f0f0';
                ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            }
        } catch (error) {
            console.error('Failed to initialize existing viewer:', error);
            this.createPlaceholder();
        }
    }

    /**
     * Create a placeholder avatar
     */
    createPlaceholder() {
        const ctx = this.canvas.getContext('2d');
        if (!ctx) return;

        // Set canvas size
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;

        // Draw a simple placeholder
        ctx.fillStyle = '#f9fafb';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw avatar placeholder
        ctx.font = '48px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Avatar emoji
        ctx.fillText('🤖', this.canvas.width / 2, this.canvas.height / 2 - 40);

        // Text
        ctx.font = '16px Inter, sans-serif';
        ctx.fillStyle = '#6b7280';
        ctx.fillText('3D Avatar', this.canvas.width / 2, this.canvas.height / 2 + 40);

        // Animate placeholder
        this.animatePlaceholder();
    }

    /**
     * Animate placeholder avatar
     */
    animatePlaceholder() {
        if (!this.canvas) return;

        const ctx = this.canvas.getContext('2d');
        if (!ctx) return;

        let scale = 1;
        let direction = 0.01;

        const animate = () => {
            if (!this.isInitialized) return;

            // Clear canvas
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            // Background
            ctx.fillStyle = '#f9fafb';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

            // Update scale
            scale += direction;
            if (scale > 1.1 || scale < 0.9) {
                direction *= -1;
            }

            // Save context
            ctx.save();

            // Draw scaled emoji
            ctx.translate(this.canvas.width / 2, this.canvas.height / 2 - 40);
            ctx.scale(scale, scale);
            ctx.font = '48px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🤖', 0, 0);

            // Restore context
            ctx.restore();

            // Text
            ctx.font = '16px Inter, sans-serif';
            ctx.fillStyle = '#6b7280';
            ctx.textAlign = 'center';
            ctx.fillText('3D Avatar', this.canvas.width / 2, this.canvas.height / 2 + 40);

            // State indicator
            if (this.currentState !== 'idle') {
                ctx.font = '14px Inter, sans-serif';
                ctx.fillStyle = this.getStateColor();
                ctx.fillText(this.getStateText(), this.canvas.width / 2, this.canvas.height / 2 + 70);
            }

            requestAnimationFrame(animate);
        };

        animate();
    }

    /**
     * Create error placeholder
     */
    createErrorPlaceholder(errorMsg) {
        const ctx = this.canvas.getContext('2d');
        if (!ctx) return;

        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;

        ctx.fillStyle = '#fee';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.font = '48px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚠️', this.canvas.width / 2, this.canvas.height / 2 - 40);

        ctx.font = '14px Inter, sans-serif';
        ctx.fillStyle = '#c00';
        ctx.fillText('Avatar Error', this.canvas.width / 2, this.canvas.height / 2 + 20);
        ctx.font = '12px Inter, sans-serif';
        ctx.fillStyle = '#666';
        ctx.fillText(errorMsg, this.canvas.width / 2, this.canvas.height / 2 + 45);
    }

    /**
     * Set avatar state
     */
    setState(state) {
        this.currentState = state;

        // Update status indicator
        if (this.statusIndicator) {
            this.statusIndicator.className = 'status-indicator ' + state;
        }

        // Update status text
        if (this.statusText) {
            this.statusText.textContent = this.getStateText();
        }

        console.log('Avatar state:', state);
    }

    /**
     * Get state display text
     */
    getStateText() {
        const stateTexts = {
            'idle': 'Ready',
            'listening': 'Listening...',
            'thinking': 'Thinking...',
            'speaking': 'Speaking...'
        };
        return stateTexts[this.currentState] || 'Ready';
    }

    /**
     * Get state color
     */
    getStateColor() {
        const stateColors = {
            'idle': '#10b981',
            'listening': '#3b82f6',
            'thinking': '#6366f1',
            'speaking': '#f59e0b'
        };
        return stateColors[this.currentState] || '#10b981';
    }

    /**
     * Play animation (if avatar viewer supports it)
     */
    playAnimation(animationName) {
        if (this.avatarViewer && typeof this.avatarViewer.playAnimation === 'function') {
            try {
                this.avatarViewer.playAnimation(animationName);
            } catch (error) {
                console.error('Failed to play animation:', error);
            }
        }
    }

    /**
     * Trigger idle animation
     */
    idle() {
        this.setState('idle');
        this.playAnimation('idle');
    }

    /**
     * Trigger listening animation
     */
    listen() {
        this.setState('listening');
        this.playAnimation('listening');
    }

    /**
     * Trigger thinking animation
     */
    think() {
        this.setState('thinking');
        this.playAnimation('thinking');
    }

    /**
     * Trigger speaking animation
     */
    speak() {
        this.setState('speaking');
        this.playAnimation('speaking');
    }

    /**
     * Reset camera position
     */
    resetCamera() {
        if (this.avatarViewer && typeof this.avatarViewer.resetCamera === 'function') {
            this.avatarViewer.resetCamera();
        }
    }

    /**
     * Toggle avatar visibility
     */
    toggleVisibility() {
        if (this.canvas) {
            const isHidden = this.canvas.style.display === 'none';
            this.canvas.style.display = isHidden ? 'block' : 'none';
            return !isHidden;
        }
        return false;
    }

    /**
     * Handle window resize
     */
    handleResize() {
        if (this.canvas) {
            const parent = this.canvas.parentElement;
            if (parent) {
                this.canvas.width = parent.offsetWidth;
                this.canvas.height = parent.offsetHeight;

                if (!this.avatarViewer) {
                    this.createPlaceholder();
                }
            }
        }

        if (this.avatarViewer && typeof this.avatarViewer.resize === 'function') {
            this.avatarViewer.resize();
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        this.isInitialized = false;

        if (this.avatarViewer && typeof this.avatarViewer.destroy === 'function') {
            this.avatarViewer.destroy();
        }

        this.avatarViewer = null;
        this.canvas = null;
    }

    /**
     * Get current state
     */
    getState() {
        return this.currentState;
    }

    /**
     * Check if initialized
     */
    isReady() {
        return this.isInitialized;
    }
}

// Create a singleton instance
const avatarController = new AvatarController();

// Export for use in other modules
window.AvatarController = avatarController;
