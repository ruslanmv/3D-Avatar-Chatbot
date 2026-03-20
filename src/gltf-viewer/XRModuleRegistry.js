/**
 * XRModuleRegistry — Event-driven lazy loader for AR/MR modules
 * ===============================================================
 * Bridges the 4 new AR modules (MRSceneUnderstanding, AvatarGrounding,
 * IKWorkerBridge, ik-solver.worker) into the existing ViewerEngine
 * without modifying any production VR code.
 *
 * Design:
 *   - Listens to existing CustomEvents ('ar-session-start', 'vr-session-start', etc.)
 *   - Lazy-imports modules via dynamic import() on first session start
 *   - Provides a single update(dt, frame) hook for the render loop
 *   - Zero boot cost — no imports, no GPU work until a session starts
 *   - Graceful fallback — if any import fails, existing systems keep working
 *
 * Follows the existing NEXUS_* hook pattern used by locomotion/arc-pointer.
 *
 * Non-destructive: purely additive. Does NOT modify:
 *   VRSupport, ARSupport, PassthroughEnhancer, VRControllers,
 *   VRBoneGrabber, VRPuppetInteraction, VRPoseSystem, or any other file.
 */

export class XRModuleRegistry {
    /**
     * @param {object} engine - ViewerEngine instance (read-only access)
     */
    constructor(engine) {
        /** @private */
        this._engine = engine;

        // Module instances (null until lazy-loaded)
        /** @type {import('./MRSceneUnderstanding.js').MRSceneUnderstanding|null} */
        this.mrScene = null;
        /** @type {import('./AvatarGrounding.js').AvatarGrounding|null} */
        this.avatarGrounding = null;
        /** @type {import('./IKWorkerBridge.js').IKWorkerBridge|null} */
        this.ikWorkerBridge = null;

        // Loading state
        this._arModulesLoaded = false;
        this._ikModuleLoaded = false;
        this._arModulesLoading = false;
        this._ikModuleLoading = false;

        // Bind event listeners
        this._onARStart = this._onARSessionStart.bind(this);
        this._onAREnd = this._onARSessionEnd.bind(this);
        this._onVRStart = this._onVRSessionStart.bind(this);
        this._onVREnd = this._onVRSessionEnd.bind(this);

        window.addEventListener('ar-session-start', this._onARStart);
        window.addEventListener('ar-session-end', this._onAREnd);
        window.addEventListener('vr-session-start', this._onVRStart);
        window.addEventListener('vr-session-end', this._onVREnd);

        console.log('[XRModuleRegistry] Registered (zero-cost until session start)');
    }

    // =========================================================================
    // AR SESSION — lazy-load MRSceneUnderstanding + AvatarGrounding
    // =========================================================================

    async _onARSessionStart() {
        if (!this._arModulesLoaded && !this._arModulesLoading) {
            this._arModulesLoading = true;
            try {
                await this._loadARModules();
            } catch (e) {
                console.warn('[XRModuleRegistry] AR module load failed (existing AR systems unaffected):', e);
            }
            this._arModulesLoading = false;
        }

        // Activate loaded modules
        if (this.mrScene) {
            try {
                await this.mrScene.activate();
                console.log('[XRModuleRegistry] MRSceneUnderstanding activated');
            } catch (e) {
                console.warn('[XRModuleRegistry] MRSceneUnderstanding activation failed:', e);
            }
        }

        if (this.avatarGrounding) {
            const avatarRoot = this._engine.avatarManager?.currentRoot || null;
            this.avatarGrounding.activate(avatarRoot, this.mrScene);
            console.log('[XRModuleRegistry] AvatarGrounding activated');
        }
    }

    _onARSessionEnd() {
        if (this.mrScene) {
            try {
                this.mrScene.deactivate();
            } catch (_) {
                /* noop */
            }
        }
        if (this.avatarGrounding) {
            try {
                this.avatarGrounding.deactivate();
            } catch (_) {
                /* noop */
            }
        }
    }

    async _loadARModules() {
        const results = await Promise.allSettled([import('./MRSceneUnderstanding.js'), import('./AvatarGrounding.js')]);

        // MRSceneUnderstanding
        if (results[0].status === 'fulfilled') {
            const { MRSceneUnderstanding } = results[0].value;
            this.mrScene = new MRSceneUnderstanding({
                scene: this._engine.scene,
                renderer: this._engine.renderer,
                camera: this._engine.camera,
            });
            console.log('[XRModuleRegistry] MRSceneUnderstanding loaded');
        } else {
            console.warn('[XRModuleRegistry] MRSceneUnderstanding import failed:', results[0].reason);
        }

        // AvatarGrounding
        if (results[1].status === 'fulfilled') {
            const { AvatarGrounding } = results[1].value;
            this.avatarGrounding = new AvatarGrounding({
                scene: this._engine.scene,
            });
            console.log('[XRModuleRegistry] AvatarGrounding loaded');
        } else {
            console.warn('[XRModuleRegistry] AvatarGrounding import failed:', results[1].reason);
        }

        this._arModulesLoaded = true;
    }

    // =========================================================================
    // VR SESSION — lazy-load IKWorkerBridge for off-thread IK
    // =========================================================================

    async _onVRSessionStart() {
        if (!this._ikModuleLoaded && !this._ikModuleLoading) {
            this._ikModuleLoading = true;
            try {
                await this._loadIKModule();
            } catch (e) {
                console.warn('[XRModuleRegistry] IK worker load failed (on-thread IK unaffected):', e);
            }
            this._ikModuleLoading = false;
        }

        // Inject into VRPoseSystem (transparent — if bridge is null, on-thread IK continues)
        if (this.ikWorkerBridge && this._engine.vrPoseSystem) {
            this._engine.vrPoseSystem.ikWorkerBridge = this.ikWorkerBridge;
            console.log('[XRModuleRegistry] IKWorkerBridge injected into VRPoseSystem');
        }
    }

    _onVRSessionEnd() {
        // Detach IK worker bridge (VRPoseSystem falls back to on-thread)
        if (this._engine.vrPoseSystem) {
            this._engine.vrPoseSystem.ikWorkerBridge = null;
        }
    }

    async _loadIKModule() {
        const { IKWorkerBridge } = await import('./IKWorkerBridge.js');
        this.ikWorkerBridge = new IKWorkerBridge({
            workerUrl: 'workers/ik-solver.worker.js',
        });
        this._ikModuleLoaded = true;
        console.log('[XRModuleRegistry] IKWorkerBridge loaded');
    }

    // =========================================================================
    // PER-FRAME UPDATE — call from ViewerEngine render loop
    // =========================================================================

    /**
     * Update all active registry modules.
     * Safe to call every frame — noop if no modules are active.
     *
     * @param {number} dt - Delta time in seconds
     * @param {XRFrame|null} frame - Current XR frame (null outside XR)
     */
    update(dt, frame) {
        // MRSceneUnderstanding: sync RATK planes/meshes/anchors
        if (this.mrScene?.active) {
            try {
                this.mrScene.update(frame);
            } catch (_) {
                /* noop — don't break render loop */
            }
        }

        // AvatarGrounding: spring-damped floor tracking
        if (this.avatarGrounding?.active) {
            try {
                this.avatarGrounding.update(dt);
            } catch (_) {
                /* noop */
            }
        }
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================

    dispose() {
        window.removeEventListener('ar-session-start', this._onARStart);
        window.removeEventListener('ar-session-end', this._onAREnd);
        window.removeEventListener('vr-session-start', this._onVRStart);
        window.removeEventListener('vr-session-end', this._onVREnd);

        this.mrScene?.deactivate?.();
        this.avatarGrounding?.deactivate?.();
        this.ikWorkerBridge?.dispose?.();

        this.mrScene = null;
        this.avatarGrounding = null;
        this.ikWorkerBridge = null;

        console.log('[XRModuleRegistry] Disposed');
    }
}
