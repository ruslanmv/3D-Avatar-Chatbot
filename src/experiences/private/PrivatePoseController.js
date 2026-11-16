/**
 * UN5. Her body's positions in Private: the Pose Studio presets, asked for in words.
 *
 * The poses already exist — `VRPoseSystem.POSE_PRESETS`, the ones Pose Studio's navigator offers
 * (kneeling, lying on her back, front or side, bent forward, the "Ground" pose on all fours) —
 * and passed the motion audit. Until now only the Pose Studio panel could put her in one. This
 * is the same path the panel takes, reachable from the conversation through
 * `PrivateActionBridge`, which decides *whether* (the policy: the person asked, and adult poses
 * only at the top of the pace); this decides only *how*.
 *
 * ## How, and how back
 *
 * Exactly the panel's way in (`PoseStudioPanel._enterPoseMode`): stop the clip, the procedural
 * animator yields (`setPoseMode(true)`), the chat motion stack holds (`holdForPoseStudio`, MO12)
 * so a queued idle cannot stand her back up, the humanoid syncs normalised bones. Then, per the
 * VR puppet rule (CLAUDE.md, VP), `claimBones()` before anything poses her, so the skeleton she
 * had is snapshotted — and `releaseBones()` writes that snapshot back. `release()` is the way
 * out: "stand up", getting dressed again, and the end of the session all come through it.
 *
 * Only ids in `POSES` are ever applied, and only if the runtime knows the preset; a pose this
 * build does not have is a refusal, never a substitute.
 *
 * Exposes: window.NEXUS_PRIVATE_POSES
 */
(function (global) {
    'use strict';

    /** The words' key → the preset, and whether it is one of Pose Studio's adult presets. */
    const POSES = Object.freeze({
        kneel: { preset: 'kneeling', adult: false },
        'kneel-up': { preset: 'kneelingUp', adult: false },
        // UN6. Hands and knees: the distinct `handsKnees` preset (never allFoursArched or
        // doggyStyle, which are standing forward bends). It rests on skinned knee surfaces and
        // turns its hands palm-down onto the floor; `confirm()` below checks it really did.
        'all-fours': { preset: 'handsKnees', adult: true },
        'lie-back': { preset: 'lyingBack', adult: false },
        'lie-front': { preset: 'lyingFront', adult: false },
        'lie-side': { preset: 'lyingSide', adult: false },
        'bend-forward': { preset: 'standingBendForward', adult: false },
        'arch-back': { preset: 'standingBentBackward', adult: false },
        lounge: { preset: 'sittingLegsUp', adult: false },
    });

    function create(options) {
        const o = options || {};
        const win = o.win || global;
        let held = null;
        /** The positions taken before this one, for "torna come prima". */
        const history = [];

        const system = () => o.system || (win && win.vrPoseSystem) || null;
        const call = (fn) => {
            try {
                fn();
            } catch (_) {
                /* one owner that cannot answer must not leave her half posed */
            }
        };

        function enterPoseMode() {
            call(() => win.NEXUS_CLIP_LOADER && win.NEXUS_CLIP_LOADER.stopClip({ fadeOut: 0.25 }));
            call(() => win.NEXUS_ANIMATION_RESOLVER && win.NEXUS_ANIMATION_RESOLVER.stop());
            call(() => win.NEXUS_PROCEDURAL_ANIMATOR && win.NEXUS_PROCEDURAL_ANIMATOR.setPoseMode(true));
            call(() => win.NEXUS_MOTION && win.NEXUS_MOTION.holdForPoseStudio(true));
            call(() => {
                const vrm =
                    win.NEXUS_VIEWER && win.NEXUS_VIEWER.avatarManager && win.NEXUS_VIEWER.avatarManager._currentVRM;
                if (vrm && vrm.humanoid && 'autoUpdateHumanBones' in vrm.humanoid)
                    vrm.humanoid.autoUpdateHumanBones = true;
            });
        }

        function exitPoseMode() {
            // UN6. Letting go of a position in Private is standing up: the claim's snapshot she is
            // handed back to is her standing idle. A sit/lie state the chat motion stack still
            // remembered would schedule `sit_idle`/`lay_idle` the moment the hold lifts — the
            // "Alzati" that reported standing and rendered crouched.
            call(() => {
                const st = win.NEXUS_MOTION && win.NEXUS_MOTION.state;
                if (st) {
                    st.sitting = false;
                    st.laying = false;
                }
            });
            call(() => win.NEXUS_PROCEDURAL_ANIMATOR && win.NEXUS_PROCEDURAL_ANIMATOR.setPoseMode(false));
            call(() => win.NEXUS_MOTION && win.NEXUS_MOTION.holdForPoseStudio(false));
            call(() => {
                const vrm =
                    win.NEXUS_VIEWER && win.NEXUS_VIEWER.avatarManager && win.NEXUS_VIEWER.avatarManager._currentVRM;
                if (vrm && vrm.humanoid && 'autoUpdateHumanBones' in vrm.humanoid)
                    vrm.humanoid.autoUpdateHumanBones = false;
            });
        }

        /**
         * Is this preset one the runtime offers right now? `getPresetList()` is Pose Studio's own
         * list, which already leaves the adult presets out while Spicy mode is off — so that gate
         * holds here too, whatever the policy said.
         */
        function known(vps, preset) {
            try {
                const list = typeof vps.getPresetList === 'function' ? vps.getPresetList() : [];
                return list.some((p) => p && p.name === preset);
            } catch (_) {
                return false;
            }
        }

        return {
            POSES,
            /** `{ok, why?}`. Holds her in the preset until `release()`. */
            apply(key, options) {
                if (key === 'back') return this.back();
                const entry = POSES[key];
                if (!entry) return { ok: false, why: 'unknown-pose' };
                if (!entry.preset) return { ok: false, why: 'unsupported-pose' };
                const vps = system();
                if (!vps || typeof vps.applyPreset !== 'function') return { ok: false, why: 'no-pose-system' };
                if (!known(vps, entry.preset)) return { ok: false, why: 'unknown-pose' };
                try {
                    enterPoseMode();
                    if (typeof vps.claimBones === 'function') vps.claimBones();
                    vps.applyPreset(entry.preset, 0.6);
                    // Confirmed by the pose system itself, never assumed: the preset it reports
                    // is the one it is now blending her into.
                    const now = typeof vps.getCurrentPreset === 'function' ? vps.getCurrentPreset() : entry.preset;
                    if (now !== entry.preset) {
                        this.release();
                        return { ok: false, why: 'not-applied' };
                    }
                    if (held && held !== key && !(options && options.restoring)) history.push(held);
                    if (history.length > 8) history.shift();
                    held = key;
                    return { ok: true, pose: key };
                } catch (_) {
                    this.release();
                    return { ok: false, why: 'pose-failed' };
                }
            },
            /** "Torna come prima": the position before this one, or standing when there was none. */
            back() {
                const previous = history.pop();
                if (!previous) {
                    const was = this.release();
                    return { ok: true, pose: 'stand', released: was };
                }
                const out = this.apply(previous, { restoring: true });
                return out.ok ? { ok: true, pose: previous } : out;
            },
            /** Back to her own idle: the snapshot the claim took is written back. */
            release(options) {
                const was = held;
                held = null;
                if (!(options && options.keepHistory)) history.length = 0;
                const vps = system();
                call(() => vps && typeof vps.releaseBones === 'function' && vps.releaseBones({ blendSeconds: 0.5 }));
                if (was) exitPoseMode();
                return Boolean(was);
            },
            held() {
                return held;
            },
            /**
             * UN6. A recognised request or a reported preset name is not proof: wait until the
             * pose system has finished moving her (blend, grounding, hands), then check what it
             * left. `{ok}` or `{ok:false, why:'not-rendered', measured}`. A pose that names its
             * supports must have them on the floor: knees/hips within 10 mm, palms within 20 mm.
             */
            confirm(key, opts) {
                const o = opts || {};
                const entry = POSES[key];
                const vps = system();
                const wait =
                    typeof o.wait === 'function'
                        ? o.wait
                        : (ms) => new Promise((r) => (win.setTimeout || setTimeout)(r, ms));
                const limit = Number.isFinite(o.timeoutMs) ? o.timeoutMs : 6000;
                const check = () => {
                    if (!entry || !entry.preset || !vps) return { ok: false, why: 'not-rendered' };
                    const now = typeof vps.getCurrentPreset === 'function' ? vps.getCurrentPreset() : null;
                    const holding = typeof vps.isHoldingBones === 'function' ? vps.isHoldingBones() : true;
                    if (now !== entry.preset || !holding)
                        return { ok: false, why: 'not-rendered', measured: { now, holding } };
                    const support = vps.lastSupport;
                    if (support && support.preset === entry.preset && support.hands) {
                        const palms = Object.values(support.hands).map((h) => h && h.palmAfterMm);
                        if (palms.some((mm) => mm == null || Math.abs(mm) > 20))
                            return { ok: false, why: 'not-rendered', measured: support };
                    }
                    return { ok: true, measured: support || null };
                };
                return (async () => {
                    let waited = 0;
                    while (vps && typeof vps.isSettling === 'function' && vps.isSettling() && waited < limit) {
                        await wait(100);
                        waited += 100;
                    }
                    if (vps && typeof vps.isSettling === 'function' && vps.isSettling())
                        return { ok: false, why: 'not-rendered', measured: { settling: true } };
                    return check();
                })();
            },
        };
    }

    const api = { POSES, create };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_POSES = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
