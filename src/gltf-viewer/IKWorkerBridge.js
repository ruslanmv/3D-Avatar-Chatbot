/**
 * IKWorkerBridge — Off-main-thread IK solver bridge
 * ===================================================
 * Bridges the main-thread Three.js bone hierarchy with the Web Worker
 * CCD-IK solver. Follows the Surma off-main-thread pattern:
 *
 *   Main thread:  Extracts bone chain data → posts to worker
 *   Worker:       Solves CCD-IK on plain arrays → returns quaternions
 *   Main thread:  Applies quaternion results back to Three.js bones
 *
 * The bridge is NON-DESTRUCTIVE: if the Worker fails to load or is
 * unavailable (e.g. older browser), falls back to the existing
 * on-main-thread solveCCDIK in VRPoseSystem.js.
 *
 * Performance benefit: IK solving (12 iterations × 4-6 bones per chain)
 * is moved off the render thread, keeping head-tracking latency stable
 * on Quest 3 at 72fps.
 *
 * @see https://surma.dev/things/omt-for-three-xr/
 */

import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';

export class IKWorkerBridge {
    /**
     * @param {object} opts
     * @param {string} [opts.workerUrl='workers/ik-solver.worker.js']
     */
    constructor({ workerUrl } = {}) {
        this._workerUrl = workerUrl || 'workers/ik-solver.worker.js';
        this._worker = null;
        this._ready = false;
        this._enabled = true;

        // Request tracking (for async solve → apply)
        this._nextId = 0;
        this._pendingResolves = new Map();

        // Fallback flag — set if worker fails to load
        this._fallbackMode = false;

        // Latest results cache (for non-awaited usage)
        this._latestResults = new Map(); // chainKey → quaternions array

        this._init();
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================

    _init() {
        try {
            this._worker = new Worker(this._workerUrl);

            this._worker.onmessage = (e) => {
                const msg = e.data;

                if (msg.type === 'ready') {
                    this._ready = true;
                    console.log('[IKWorkerBridge] Worker ready');
                } else if (msg.type === 'pong') {
                    // Health check response
                } else if (msg.type === 'result') {
                    this._handleResult(msg);
                } else if (msg.type === 'error') {
                    console.warn(`[IKWorkerBridge] Worker error (${msg.id}):`, msg.message);
                    this._resolvePending(msg.id, null);
                }
            };

            this._worker.onerror = (err) => {
                console.warn('[IKWorkerBridge] Worker failed, falling back to main thread:', err.message);
                this._fallbackMode = true;
                this._ready = false;
            };
        } catch (err) {
            console.warn('[IKWorkerBridge] Cannot create Worker, using main-thread fallback:', err.message);
            this._fallbackMode = true;
        }
    }

    /**
     * @returns {boolean} true if the worker is available and ready
     */
    get available() {
        return this._enabled && this._ready && !this._fallbackMode;
    }

    /**
     * Enable or disable the worker bridge.
     * When disabled, the caller should use the on-main-thread solver.
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this._enabled = enabled;
        console.log(`[IKWorkerBridge] ${enabled ? 'Enabled' : 'Disabled'}`);
    }

    // =========================================================================
    // SOLVE IK (async — fire and forget, or await result)
    // =========================================================================

    /**
     * Submit an IK solve request to the worker.
     *
     * @param {string} chainKey - Unique key for this chain (e.g. 'leftArm')
     * @param {THREE.Bone[]} chainBones - Three.js bone chain (root → effector)
     * @param {THREE.Vector3} targetWorldPos - World-space target position
     * @param {object} [options] - { iterations, tolerance }
     * @returns {Promise<Float32Array[]|null>} Resolved quaternions, or null on fallback
     */
    async solve(chainKey, chainBones, targetWorldPos, options = {}) {
        if (!this.available) {
            return null; // Caller should use on-main-thread fallback
        }

        // Extract bone data for the worker (plain arrays, no Three.js objects)
        const chain = this._extractChainData(chainBones);
        const target = new Float32Array([targetWorldPos.x, targetWorldPos.y, targetWorldPos.z]);

        const id = this._nextId++;

        return new Promise((resolve) => {
            this._pendingResolves.set(id, { resolve, chainKey });

            this._worker.postMessage({
                type: 'solve',
                id,
                chain,
                target,
                options,
            });

            // Timeout: if worker doesn't respond in 16ms (one frame), skip
            setTimeout(() => {
                if (this._pendingResolves.has(id)) {
                    this._pendingResolves.delete(id);
                    resolve(null);
                }
            }, 16);
        });
    }

    /**
     * Fire-and-forget IK solve. Results are cached and can be applied later
     * via applyLatestResult(). This avoids blocking the render loop.
     *
     * @param {string} chainKey
     * @param {THREE.Bone[]} chainBones
     * @param {THREE.Vector3} targetWorldPos
     * @param {object} [options]
     */
    solveAsync(chainKey, chainBones, targetWorldPos, options = {}) {
        if (!this.available) return;

        const chain = this._extractChainData(chainBones);
        const target = new Float32Array([targetWorldPos.x, targetWorldPos.y, targetWorldPos.z]);

        const id = this._nextId++;
        this._pendingResolves.set(id, {
            resolve: null,
            chainKey,
        });

        this._worker.postMessage({
            type: 'solve',
            id,
            chain,
            target,
            options,
        });
    }

    /**
     * Apply the latest cached result for a chain to the Three.js bones.
     *
     * @param {string} chainKey
     * @param {THREE.Bone[]} chainBones
     * @returns {boolean} true if a result was applied
     */
    applyLatestResult(chainKey, chainBones) {
        const quats = this._latestResults.get(chainKey);
        if (!quats || quats.length !== chainBones.length) return false;

        for (let i = 0; i < chainBones.length; i++) {
            const q = quats[i];
            chainBones[i].quaternion.set(q[0], q[1], q[2], q[3]);
        }

        return true;
    }

    // =========================================================================
    // INTERNAL
    // =========================================================================

    /**
     * Extract bone chain data as plain arrays for the worker.
     * @param {THREE.Bone[]} chainBones
     * @returns {Array<object>}
     */
    _extractChainData(chainBones) {
        return chainBones.map((bone, i) => ({
            localQuat: [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w],
            localPos: [bone.position.x, bone.position.y, bone.position.z],
            parentIndex: i > 0 ? i - 1 : -1, // chain-relative parent index
        }));
    }

    /**
     * Handle worker result message.
     */
    _handleResult(msg) {
        const pending = this._pendingResolves.get(msg.id);
        if (!pending) return;

        this._pendingResolves.delete(msg.id);

        // Cache the result for fire-and-forget usage
        if (pending.chainKey && msg.quaternions) {
            this._latestResults.set(pending.chainKey, msg.quaternions);
        }

        // Resolve promise if awaited
        pending.resolve?.(msg.quaternions || null);
    }

    _resolvePending(id, value) {
        const pending = this._pendingResolves.get(id);
        if (pending) {
            this._pendingResolves.delete(id);
            pending.resolve?.(value);
        }
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================

    dispose() {
        if (this._worker) {
            this._worker.terminate();
            this._worker = null;
        }
        this._ready = false;
        this._pendingResolves.clear();
        this._latestResults.clear();
    }
}
