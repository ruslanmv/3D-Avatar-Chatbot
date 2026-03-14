/**
 * VRMediaPanel — lightweight floating image panel for VR.
 *
 * Phase 5.5: Displays a single image attachment in 3D space.
 * Hidden by default. Opens when an image attachment exists.
 * Can be closed by the user.
 *
 * Uses a canvas-textured Three.js plane, same pattern as VRChatPanel.
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

export class VRMediaPanel {
    /**
     * @param {THREE.Scene} scene
     * @param {Object} [options]
     * @param {number} [options.width=512]
     * @param {number} [options.height=512]
     */
    constructor(scene, options = {}) {
        this.scene = scene;
        this.width = options.width || 512;
        this.height = options.height || 512;
        this.visible = false;
        this._currentAttachment = null;
        this._loadedImage = null;

        // Canvas
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.ctx = this.canvas.getContext('2d');
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.minFilter = THREE.LinearFilter;

        // Mesh — positioned to the right of the chat panel
        const geometry = new THREE.PlaneGeometry(0.5, 0.5);
        const material = new THREE.MeshBasicMaterial({
            map: this.texture,
            transparent: true,
            side: THREE.DoubleSide,
        });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.set(0.65, 1.4, -1.0); // right of the chat panel
        this.mesh.visible = false;
        this.mesh.name = 'VRMediaPanel';
        this.scene.add(this.mesh);

        // Close button interactable
        this._closeButton = null;

        this._drawEmpty();

        console.log('[VRMediaPanel] Initialized');
    }

    /**
     * Show an image attachment.
     * @param {Object} attachment - { type, name, url, mime }
     */
    show(attachment) {
        if (!attachment || attachment.type !== 'image') return;

        this._currentAttachment = attachment;
        this.visible = true;
        this.mesh.visible = true;

        // Draw loading state
        this._drawLoading(attachment.name || 'Image');

        // Load the image
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            this._loadedImage = img;
            this._drawImage(img, attachment.name || 'Image');
        };
        img.onerror = () => {
            this._drawError(attachment.name || 'Image');
        };
        img.src = attachment.url;
    }

    /**
     * Hide the media panel.
     */
    hide() {
        this.visible = false;
        this.mesh.visible = false;
        this._currentAttachment = null;
        this._loadedImage = null;
    }

    /**
     * Toggle visibility.
     */
    toggle() {
        if (this.visible) {
            this.hide();
        } else if (this._currentAttachment) {
            this.mesh.visible = true;
            this.visible = true;
        }
    }

    // ------------------------------------------------------------------
    // Drawing helpers
    // ------------------------------------------------------------------

    _drawEmpty() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);
        this.texture.needsUpdate = true;
    }

    _drawLoading(name) {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = 'rgba(10, 10, 20, 0.92)';
        ctx.fillRect(0, 0, w, h);

        // Border
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
        ctx.lineWidth = 2;
        ctx.strokeRect(2, 2, w - 4, h - 4);

        // Loading text
        ctx.font = '500 24px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.textAlign = 'center';
        ctx.fillText('Loading...', w / 2, h / 2 - 10);
        ctx.font = '400 18px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fillText(name, w / 2, h / 2 + 20);
        ctx.textAlign = 'left';

        this.texture.needsUpdate = true;
    }

    _drawImage(img, name) {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = 'rgba(10, 10, 20, 0.95)';
        ctx.fillRect(0, 0, w, h);

        // Draw image fitted to panel with padding
        const pad = 16;
        const labelH = 36;
        const maxW = w - pad * 2;
        const maxH = h - pad * 2 - labelH;

        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const drawX = (w - drawW) / 2;
        const drawY = pad + (maxH - drawH) / 2;

        ctx.drawImage(img, drawX, drawY, drawW, drawH);

        // Label bar at bottom
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, h - labelH, w, labelH);

        ctx.font = '500 18px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.textAlign = 'center';
        ctx.fillText(name, w / 2, h - 12);
        ctx.textAlign = 'left';

        // Border
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(2, 2, w - 4, h - 4);

        this.texture.needsUpdate = true;
    }

    _drawError(name) {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(10, 10, 20, 0.92)';
        ctx.fillRect(0, 0, w, h);

        ctx.font = '500 22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillStyle = 'rgba(255, 82, 82, 0.8)';
        ctx.textAlign = 'center';
        ctx.fillText('Failed to load image', w / 2, h / 2 - 10);
        ctx.font = '400 16px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fillText(name, w / 2, h / 2 + 16);
        ctx.textAlign = 'left';

        this.texture.needsUpdate = true;
    }

    /**
     * Dispose resources.
     */
    dispose() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }
        if (this.texture) {
            this.texture.dispose();
        }
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.VRMediaPanel = VRMediaPanel;
}
