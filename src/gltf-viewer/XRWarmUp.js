/**
 * XRWarmUp — get the GPU ready for a VR session without freezing the page (XL2).
 *
 * The failure: entering VR from a PC driving a Quest over Link, Chrome put up "This page isn't
 * responding" ("Questa pagina non risponde") and the session ended. The 3D context had just moved
 * to the headset's GPU (XL1), so every shader program and every texture had to be rebuilt there —
 * and three.js does that inside the first frame it draws, one program after another, each one
 * waited on before the next starts. On Windows, Chrome compiles shaders through ANGLE/Direct3D,
 * where an MToon program takes a noticeable fraction of a second; a VRoid avatar has many. One
 * frame became one task many seconds long, and Chrome's hang detector fired. Even without the move,
 * the first VR frame compiled every VR-only program (the chat panel, controller rays, the puppet
 * handles) in one task: 2.4 s on the test machine.
 *
 * What this does instead is what three.js itself later shipped as `compileAsync`, done with r147's
 * own API:
 *
 *   1. `renderer.compile(scene, camera)` with `debug.checkShaderErrors` off. r147's compile walks
 *      every object (`scene.traverse`, invisible VR-only ones included), and with the check off the
 *      program constructor only dispatches compile + link — it never asks for a status, which is
 *      the call that waits. Chrome compiles them in parallel off the page's thread
 *      (KHR_parallel_shader_compile). The check is restored straight after, so programs made later
 *      still report their errors.
 *   2. Poll each program's COMPLETION_STATUS_KHR between short yields — a question that never
 *      blocks — until all are ready or the budget runs out.
 *   3. Upload textures a couple per task with `renderer.initTexture`, yielding between batches,
 *      instead of all of them inside the first frame.
 *
 * The page answers input the whole time, so Chrome has nothing to call hung. Nothing here can
 * fail the VR entry: any error is reported in the returned summary and the caller enters anyway.
 *
 * Pure orchestration: the renderer, scene, camera, GL context, clock and yield are passed in, so
 * every rule is tested in jsdom (tests/xr-warmup.test.js). ViewerEngine imports this file for its
 * side effect (window.NEXUS_XR_WARMUP); Jest requires it.
 */
(function (global) {
    'use strict';

    const DEFAULTS = Object.freeze({
        budgetMs: 20000, // give up waiting on compiles after this; the first frame finishes the rest
        pollMs: 50,
        texturesPerTask: 2,
    });

    /**
     * XL6. Hand the thread back for `ms`, in a way a hidden page cannot slow down.
     *
     * Chrome throttles timers to one wake-up a second while it considers a page hidden — and a
     * PC page often is hidden or covered while its person is wearing the headset. A Quest Link
     * log showed this warm-up take 34 418 ms for work that took 226 ms with the page in view:
     * about thirty-four yields at a second each. Message events are not throttled, so while the
     * page is hidden a yield goes through a MessageChannel, and a wait of N ms is a run of such
     * yields until the clock has moved N ms. While the page is visible a timer is exact and
     * cheaper, so it stays.
     */
    let channel = null;
    const queued = [];
    function post(fn) {
        if (!channel) {
            channel = new global.MessageChannel();
            channel.port1.onmessage = () => {
                const next = queued.shift();
                if (next) next();
            };
        }
        queued.push(fn);
        channel.port2.postMessage(0);
    }

    function pageHidden() {
        const doc = global && global.document;
        return !!(doc && doc.visibilityState === 'hidden');
    }

    function defaultYield(ms) {
        const wait = ms || 0;
        if (!pageHidden() || !global || typeof global.MessageChannel !== 'function') {
            return new Promise((resolve) => setTimeout(resolve, wait));
        }
        return new Promise((resolve) => {
            const end = defaultNow() + wait;
            const step = () => (defaultNow() >= end ? resolve() : post(step));
            post(step);
        });
    }

    function defaultNow() {
        return global && global.performance ? global.performance.now() : Date.now();
    }

    /** Every texture a material in `scene` uses — properties and shader uniforms — once each. */
    function collectTextures(scene) {
        const seen = new Map();
        const consider = (t) => {
            if (t && t.isTexture && !t.isRenderTargetTexture && t.image && !seen.has(t.uuid)) seen.set(t.uuid, t);
        };
        if (!scene || typeof scene.traverse !== 'function') return [];
        scene.traverse((object) => {
            const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
            for (const material of list) {
                for (const key in material) consider(material[key]);
                if (material.uniforms) {
                    for (const key in material.uniforms)
                        consider(material.uniforms[key] && material.uniforms[key].value);
                }
            }
        });
        return [...seen.values()];
    }

    /**
     * Compile every program and upload every texture `scene` needs, without one long task.
     * @returns {Promise<{ok: boolean, programs: number, parallel: boolean, pending: number,
     *   textures: number, ms: number, reason?: string}>}
     */
    async function warmUp(deps) {
        const d = Object.assign({}, DEFAULTS, deps || {});
        const yieldTo = typeof d.yieldTo === 'function' ? d.yieldTo : defaultYield;
        const now = typeof d.now === 'function' ? d.now : defaultNow;
        const { renderer, scene, camera, gl } = d;
        const report = { ok: true, programs: 0, parallel: false, pending: 0, textures: 0, ms: 0 };
        const started = now();

        // 1. Dispatch every program; wait on none of them.
        const debug = renderer && renderer.debug;
        const checked = debug ? debug.checkShaderErrors : undefined;
        try {
            if (debug) debug.checkShaderErrors = false;
            renderer.compile(scene, camera);
        } catch (err) {
            report.ok = false;
            report.reason = 'compile: ' + ((err && err.message) || err);
        } finally {
            if (debug) debug.checkShaderErrors = checked;
        }
        await yieldTo(0);

        // 2. Wait for them off the page's thread: COMPLETION_STATUS_KHR never blocks.
        const programs = ((renderer && renderer.info && renderer.info.programs) || [])
            .map((p) => p && p.program)
            .filter(Boolean);
        report.programs = programs.length;
        let ext = null;
        try {
            ext = gl && typeof gl.getExtension === 'function' ? gl.getExtension('KHR_parallel_shader_compile') : null;
        } catch (_) {
            ext = null;
        }
        if (ext && programs.length) {
            report.parallel = true;
            let pending = programs;
            while (pending.length && now() - started < d.budgetMs) {
                pending = pending.filter((p) => {
                    try {
                        return !gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR);
                    } catch (_) {
                        return false; // a program we cannot ask about is not one to wait for
                    }
                });
                if (pending.length) await yieldTo(d.pollMs);
            }
            report.pending = pending.length;
        }

        // 3. Textures, a couple per task.
        const textures = collectTextures(scene);
        for (let i = 0; i < textures.length; i += 1) {
            try {
                renderer.initTexture(textures[i]);
                report.textures += 1;
            } catch (_) {
                /* that texture uploads on first use instead, as before */
            }
            if ((i + 1) % d.texturesPerTask === 0) await yieldTo(0);
        }

        report.ms = Math.round(now() - started);
        return report;
    }

    const api = {
        defaultYield,
        DEFAULTS,
        warmUp,
        collectTextures,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_XR_WARMUP = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
