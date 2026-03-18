/**
 * Post-Processing Pipeline for ViewerEngine
 * Enterprise-grade rendering quality with SSAO, Bloom, and FXAA.
 *
 * Pipeline order:
 *   RenderPass → SSAOPass → UnrealBloomPass → FXAA (ShaderPass) → Screen
 *
 * Automatically disabled during WebXR sessions (VR/AR require direct rendering).
 * Includes adaptive quality: can disable individual passes for performance.
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';
import { EffectComposer } from '../../vendor/three-0.147.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/three-0.147.0/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from '../../vendor/three-0.147.0/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../../vendor/three-0.147.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from '../../vendor/three-0.147.0/examples/jsm/postprocessing/SSAOPass.js';
import { FXAAShader } from '../../vendor/three-0.147.0/examples/jsm/shaders/FXAAShader.js';

export class PostProcessing {
    /**
     * @param {THREE.WebGLRenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} [options]
     * @param {boolean} [options.ssao=true]        Enable SSAO
     * @param {boolean} [options.bloom=true]        Enable Bloom
     * @param {boolean} [options.fxaa=true]         Enable FXAA
     * @param {boolean} [options.isMobile=false]    Mobile mode (reduced quality)
     */
    constructor(renderer, scene, camera, options = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        this.enabled = true;
        this._xrActive = false;

        // Feature flags
        this._ssaoEnabled = options.ssao !== false;
        this._bloomEnabled = options.bloom !== false;
        this._fxaaEnabled = options.fxaa !== false;
        this._isMobile = options.isMobile || false;

        // Disable SSAO on mobile by default (expensive)
        if (this._isMobile) {
            this._ssaoEnabled = false;
        }

        this.composer = null;
        this.renderPass = null;
        this.ssaoPass = null;
        this.bloomPass = null;
        this.fxaaPass = null;

        this._init();

        // Re-initialize after WebGL context restore (old render targets are invalid)
        this.renderer.domElement.addEventListener('webglcontextrestored', () => {
            console.log('[PostProcessing] WebGL context restored — reinitializing pipeline');
            // Nullify old composer to avoid disposing invalid GL objects
            this.composer = null;
            this._init();
        });

        console.log(
            `[PostProcessing] Initialized | SSAO: ${this._ssaoEnabled} | Bloom: ${this._bloomEnabled} | FXAA: ${this._fxaaEnabled} | Mobile: ${this._isMobile}`
        );
    }

    _init() {
        const w = this.renderer.domElement.width;
        const h = this.renderer.domElement.height;
        const pixelRatio = this.renderer.getPixelRatio();

        // Mobile GPUs (Adreno, Mali, PowerVR) often silently fail with
        // HalfFloatType + MSAA render targets — producing a black screen
        // with no WebGL error. Use UnsignedByteType + no MSAA on mobile;
        // FXAA handles anti-aliasing, and bloom still works fine at 8-bit.
        const useMobileSafe = this._isMobile;
        const renderTarget = new THREE.WebGLRenderTarget(w, h, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: useMobileSafe ? THREE.UnsignedByteType : THREE.HalfFloatType,
        });
        renderTarget.samples = useMobileSafe ? 0 : 4;

        this.composer = new EffectComposer(this.renderer, renderTarget);

        // 1. Render Pass (base scene render)
        this.renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(this.renderPass);

        // 2. SSAO Pass (screen-space ambient occlusion)
        if (this._ssaoEnabled) {
            this.ssaoPass = new SSAOPass(this.scene, this.camera, w, h);
            this.ssaoPass.kernelRadius = 0.25; // Subtle AO — avoid over-darkening on light bg
            this.ssaoPass.minDistance = 0.003; // Min depth for AO
            this.ssaoPass.maxDistance = 0.05; // Tight range = minimal darkening
            this.ssaoPass.output = SSAOPass.OUTPUT.Default;
            this.composer.addPass(this.ssaoPass);
        }

        // 3. Bloom Pass (emissive glow)
        const bloomRes = this._isMobile
            ? new THREE.Vector2(w / 2, h / 2) // Half-res on mobile
            : new THREE.Vector2(w, h);

        this.bloomPass = new UnrealBloomPass(
            bloomRes,
            0.05, // strength — very subtle, avoids edge glow on dark VRM materials
            0.15, // radius  — tight spread to prevent halo bleeding
            0.98 // threshold — only truly bright emissive areas bloom
        );
        this.bloomPass.enabled = this._bloomEnabled;
        this.composer.addPass(this.bloomPass);

        // 4. FXAA Pass (fast approximate anti-aliasing — smooths edges)
        this.fxaaPass = new ShaderPass(FXAAShader);
        this.fxaaPass.uniforms['resolution'].value.set(1 / (w * pixelRatio), 1 / (h * pixelRatio));
        this.fxaaPass.enabled = this._fxaaEnabled;
        this.composer.addPass(this.fxaaPass);
    }

    // =========================================================================
    // RENDER
    // =========================================================================

    /**
     * Render the scene through the post-processing pipeline.
     * Falls back to direct render if disabled or in XR mode.
     * @returns {boolean} true if post-processing was used
     */
    render() {
        if (!this.enabled || this._xrActive || !this.composer) {
            this.renderer.render(this.scene, this.camera);
            return false;
        }

        // First-frame render target validation: some mobile GPUs silently
        // produce black output with certain texture types. After the first
        // few frames, check if the framebuffer status is incomplete and
        // permanently disable post-processing if so.
        if (this._renderFrameCount === undefined) this._renderFrameCount = 0;
        this._renderFrameCount++;
        if (this._renderFrameCount === 3) {
            try {
                const gl = this.renderer.getContext();
                const rt = this.composer.writeBuffer;
                if (rt?.__webglFramebuffer) {
                    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.__webglFramebuffer);
                    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                    if (status !== gl.FRAMEBUFFER_COMPLETE) {
                        console.warn(
                            '[PostProcessing] Render target incomplete on this GPU — disabling post-processing'
                        );
                        this.enabled = false;
                        this.renderer.render(this.scene, this.camera);
                        return false;
                    }
                }
            } catch (_) {
                // Ignore validation errors — direct render is the fallback
            }
        }

        try {
            this.composer.render();
        } catch (e) {
            // Context may have been lost mid-frame — fall back to direct render
            console.warn('[PostProcessing] Composer error — falling back to direct render:', e.message);
            this.enabled = false;
            this.renderer.render(this.scene, this.camera);
            return false;
        }
        return true;
    }

    // =========================================================================
    // XR SESSION MANAGEMENT
    // =========================================================================

    /**
     * Call when entering VR/AR. Disables post-processing
     * (WebXR requires direct rendering to the XR framebuffer).
     */
    onXRSessionStart() {
        this._xrActive = true;
    }

    /**
     * Call when exiting VR/AR. Re-enables post-processing.
     */
    onXRSessionEnd() {
        this._xrActive = false;
    }

    // =========================================================================
    // RESIZE
    // =========================================================================

    /**
     * Update composer and pass sizes after window/container resize.
     * @param {number} width
     * @param {number} height
     */
    setSize(width, height) {
        if (!this.composer) return;

        const pixelRatio = this.renderer.getPixelRatio();

        try {
            this.composer.setSize(width, height);
        } catch (e) {
            console.warn('[PostProcessing] setSize failed (context may be lost):', e.message);
            return;
        }

        if (this.ssaoPass) {
            this.ssaoPass.setSize(width, height);
        }

        if (this.fxaaPass) {
            this.fxaaPass.uniforms['resolution'].value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
        }
    }

    // =========================================================================
    // TOGGLE INDIVIDUAL EFFECTS
    // =========================================================================

    setSSAO(enabled) {
        this._ssaoEnabled = enabled;
        if (this.ssaoPass) {
            this.ssaoPass.enabled = enabled;
        }
        console.log(`[PostProcessing] SSAO: ${enabled}`);
    }

    setBloom(enabled) {
        this._bloomEnabled = enabled;
        if (this.bloomPass) {
            this.bloomPass.enabled = enabled;
        }
        console.log(`[PostProcessing] Bloom: ${enabled}`);
    }

    setFXAA(enabled) {
        this._fxaaEnabled = enabled;
        if (this.fxaaPass) {
            this.fxaaPass.enabled = enabled;
        }
        console.log(`[PostProcessing] FXAA: ${enabled}`);
    }

    /**
     * Adjust bloom parameters.
     * @param {object} params
     * @param {number} [params.strength]   0.0 – 3.0 (default 0.3)
     * @param {number} [params.radius]     0.0 – 1.0 (default 0.4)
     * @param {number} [params.threshold]  0.0 – 1.0 (default 0.85)
     */
    setBloomParams(params) {
        if (!this.bloomPass) return;
        if (params.strength !== undefined) this.bloomPass.strength = params.strength;
        if (params.radius !== undefined) this.bloomPass.radius = params.radius;
        if (params.threshold !== undefined) this.bloomPass.threshold = params.threshold;
    }

    /**
     * Adjust SSAO parameters.
     * @param {object} params
     * @param {number} [params.kernelRadius]   0.1 – 2.0 (default 0.6)
     * @param {number} [params.minDistance]     0.0001 – 0.01 (default 0.001)
     * @param {number} [params.maxDistance]     0.01 – 0.5 (default 0.15)
     */
    setSSAOParams(params) {
        if (!this.ssaoPass) return;
        if (params.kernelRadius !== undefined) this.ssaoPass.kernelRadius = params.kernelRadius;
        if (params.minDistance !== undefined) this.ssaoPass.minDistance = params.minDistance;
        if (params.maxDistance !== undefined) this.ssaoPass.maxDistance = params.maxDistance;
    }

    // =========================================================================
    // ADAPTIVE QUALITY
    // =========================================================================

    /**
     * Downgrade quality for performance.
     * Call this if FPS drops below target.
     * @param {number} level 0=full, 1=no SSAO, 2=no bloom, 3=no post-processing
     */
    setQualityLevel(level) {
        switch (level) {
            case 0: // Full quality
                this.setSSAO(true);
                this.setBloom(true);
                this.setFXAA(true);
                break;
            case 1: // Drop SSAO (most expensive)
                this.setSSAO(false);
                this.setBloom(true);
                this.setFXAA(true);
                break;
            case 2: // Drop SSAO + Bloom
                this.setSSAO(false);
                this.setBloom(false);
                this.setFXAA(true);
                break;
            case 3: // No post-processing
                this.enabled = false;
                break;
        }
        console.log(`[PostProcessing] Quality level set to ${level}`);
    }

    // =========================================================================
    // DISPOSE
    // =========================================================================

    dispose() {
        if (this.composer) {
            // Dispose render targets
            this.composer.renderTarget1?.dispose();
            this.composer.renderTarget2?.dispose();

            // Dispose pass-specific resources
            if (this.ssaoPass) {
                this.ssaoPass.dispose?.();
            }
        }
        this.composer = null;
        console.log('[PostProcessing] Disposed');
    }
}
