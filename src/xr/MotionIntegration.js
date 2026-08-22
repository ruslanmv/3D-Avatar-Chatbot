/**
 * MotionIntegration — the Living-NPC brain-stem.
 *
 * Wires everything into a single facade (window.NEXUS_MOTION) that main.js
 * and ViewerEngine touch with four one-liners:
 *
 *   NEXUS_MOTION.onUserUtterance(text)   — instant fast-path reactions
 *   NEXUS_MOTION.systemPromptSuffix()    — LLM body-control contract
 *   NEXUS_MOTION.processReply(text)      — execute ```motion plans, clean text
 *   NEXUS_MOTION.update(dt) / onAvatarChanged(root, vrm) — frame + avatar hooks
 *
 * Gameplay design:
 *   - Two brains, one body: IntentFastPath (<1 ms) and any LLM provider both
 *     emit the same MotionPlan JSON, executed by MotionDSL.
 *   - Locomotion is delegated to the existing AvatarLocomotionSystem
 *     (real walk cycle, turn-in-place, hysteresis) with a smooth manual
 *     fallback when it is unavailable.
 *   - Physical contact = pose clip + HandContactIK toward the user's real
 *     controller/hand, with haptic pulse on touch.
 *   - Everything degrades gracefully: missing clips fall back to procedural
 *     motion (head nods, arm reach) so no command ever "does nothing".
 *
 * Additive module: does not modify any existing code.
 *
 * @module MotionIntegration
 */

const MotionIntegration = (() => {
    'use strict';

    // ── Config ──────────────────────────────────────────────────────────
    const config = {
        enabled: true, // master switch (persisted)
        ambient: true, // ambient look_at/expression during plain chat
        followRefreshS: 0.25, // follow target re-plan throttle
        followHysteresisM: 0.35,
        walkTimeoutS: 12,
        expressionHoldS: 2.5,
        contactHapticMs: 90,
        debug: false,
    };
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('nexus-motion-enabled') === 'false') {
            config.enabled = false;
        }
        if (typeof localStorage !== 'undefined' && localStorage.getItem('npc_debug') === 'true') {
            config.debug = true;
        }
    } catch (_e) {
        /* storage unavailable */
    }

    // ── Runtime state ───────────────────────────────────────────────────
    const state = {
        booted: false,
        sitting: false,
        following: false,
        speaking: false,
        lastActivity: 'idle',
        // Closes the loop: what the last plan actually did. Injected into the
        // next world snapshot so the model can see its own outcome and answer
        // honestly ("I'd love to, but I can't walk yet") instead of repeating
        // a command that silently went nowhere.
        lastAction: null, // { type, result } | null
    };

    let _viewer = null;
    let _avatarRoot = null;
    let _vrm = null;
    let _lookProxy = null;
    let _lookGoal = null;
    let _suppressNextPlan = 0; // timestamp until which LLM plans are dropped
    let _idleTimer = null;

    // ── Telemetry (M1) ──────────────────────────────────────────────────
    // Session counters that answer ONE question cheaply: is the fast path's
    // recall gap big enough to justify a local ML tier? `recall_gap_hits`
    // counts utterances the regex missed where the LLM then DID emit a plan
    // — the decision number. `missed_recent` keeps the last few missed texts
    // in memory only (never persisted, never sent anywhere) so their
    // phrasings can be mined into ActionRegistry.
    const _telemetry = {
        utterances: 0,
        fastpath_hits: 0,
        by_label: Object.create(null),
        llm_plans: 0,
        suppressed_llm_plans: 0,
        recall_gap_hits: 0,
        policy_strips: 0,
        misfire_stops: 0,
        misfire_recent: [],
        missed_recent: [],
    };
    // -1 = nothing pending. A plain falsy check would misread a legitimate
    // timestamp of 0 — fake clocks in tests, and the first millisecond after
    // page load, start at 0.
    let _lastMissAt = -1;
    // When the body last acted on a non-control command. -1 = nothing pending
    // (a plain falsy check would misread a legitimate timestamp of 0 — fake
    // clocks in tests, and the first millisecond after page load, start at 0).
    let _lastActionAt = -1;
    let _lastActionLabel = '';

    /** Notify the UI (command-echo toast, M2) — decoupled via a DOM event. */
    function _emitAction(detail) {
        try {
            if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
                window.dispatchEvent(new CustomEvent('nexus-motion:action', { detail }));
            }
        } catch (_e) {
            /* UI feedback is optional */
        }
    }

    /** First non-ambient command type in a plan — what the echo toast names. */
    function _primaryType(plan) {
        const AMBIENT = ['look_at', 'expression', 'idle', 'pause', 'speak_start', 'speak_end'];
        if (!plan || !Array.isArray(plan.commands)) return null;
        for (const c of plan.commands) {
            const t = c ? String(c.type || '').toLowerCase() : '';
            if (t && AMBIENT.indexOf(t) === -1) return t === 'gesture' ? String(c.name || 'gesture') : t;
        }
        return null;
    }

    const _follow = { active: false, dist: 1.5, sinceRefresh: 0 };
    const _walk = { active: false, goal: null, resolve: null, deadline: 0, manual: false, speed: 0.9 };
    const _contact = { active: false, side: 'right', radius: 0.14, resolve: null, deadline: 0 };
    const _reach = { active: false, side: 'right', high: false };
    const _headFx = { active: false, axis: 'x', t: 0, dur: 1.1, amp: 0.28 };
    const _turn = { active: false, remaining: 0, speed: 2.6, resolve: null, deadline: 0 };
    const _expr = Object.create(null); // name → { w, until }

    function _log() {
        if (config.debug && typeof console !== 'undefined')
            console.log.apply(console, ['[Motion]'].concat([].slice.call(arguments)));
    }
    function _now() {
        return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    }
    function _T() {
        return typeof window !== 'undefined' ? window.THREE : null;
    }
    function _dsl() {
        return typeof window !== 'undefined' ? window.MotionDSL : null;
    }
    function _clips() {
        return typeof window !== 'undefined' ? window.NEXUS_MOTION_CLIPS : null;
    }
    function _ik() {
        return typeof window !== 'undefined' ? window.NEXUS_HAND_IK : null;
    }
    function _loco() {
        return typeof window !== 'undefined' ? window.NEXUS_LOCOMOTION : null;
    }
    function _locoOn() {
        const c = typeof window !== 'undefined' ? window.NEXUS_LOCOMOTION_CONFIG : null;
        return !!(_loco() && (!c || !c.isEnabled || c.isEnabled()));
    }

    // ── World queries ───────────────────────────────────────────────────

    function _xr() {
        return _viewer && _viewer.renderer && _viewer.renderer.xr ? _viewer.renderer.xr : null;
    }

    /** User (camera) world position — VR headset when presenting. */
    function getUserPosition() {
        const THREE = _T();
        if (!THREE || !_viewer) return null;
        const out = new THREE.Vector3();
        const xr = _xr();
        if (xr && xr.isPresenting && typeof xr.getCamera === 'function') {
            try {
                xr.getCamera().getWorldPosition(out);
                return out;
            } catch (_e) {
                /* fall through */
            }
        }
        if (_viewer.camera) {
            _viewer.camera.getWorldPosition(out);
            return out;
        }
        return null;
    }

    /** Tag controller grips with handedness once. @private */
    function _grip(i) {
        const xr = _xr();
        if (!xr || typeof xr.getControllerGrip !== 'function') return null;
        const g = xr.getControllerGrip(i);
        if (g && !g.userData.__motionTagged) {
            g.userData.__motionTagged = true;
            g.addEventListener('connected', (e) => {
                g.userData.handedness = e && e.data ? e.data.handedness : undefined;
            });
        }
        return g;
    }

    /** User hand world position (VR controller / tracked hand), else null. */
    function getUserHand(side) {
        const THREE = _T();
        const xr = _xr();
        if (!THREE || !xr || !xr.isPresenting) return null;
        let best = null;
        for (let i = 0; i < 2; i++) {
            const g = _grip(i);
            if (!g) continue;
            if (g.userData.handedness === side) {
                best = g;
                break;
            }
            if (!best) best = g;
        }
        return best ? best.getWorldPosition(new THREE.Vector3()) : null;
    }

    /** Short haptic pulse on the matching controller. Best-effort. */
    function _haptic(side, strength) {
        try {
            const session = _xr() && _xr().getSession ? _xr().getSession() : null;
            if (!session) return;
            for (const src of session.inputSources || []) {
                if (side && src.handedness && src.handedness !== side) continue;
                const act = src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
                if (act && act.pulse) act.pulse(strength || 0.6, config.contactHapticMs);
            }
        } catch (_e) {
            /* haptics are optional */
        }
    }

    const _anchors = Object.create(null);
    /** Register a named world anchor (e.g. a detected seat). */
    function setAnchor(type, position) {
        _anchors[type] = position ? { x: position.x, y: position.y || 0, z: position.z } : null;
    }
    function getAnchorPosition(type) {
        const THREE = _T();
        const a = _anchors[type === 'seat' ? 'seat' : type];
        if (a && THREE) return new THREE.Vector3(a.x, a.y, a.z);
        return null; // "sit here" fallback is handled by the sit routine
    }

    // ── Body primitives ─────────────────────────────────────────────────

    /**
     * Smallest signed equivalent of an angle, in (−π, π].
     *
     * JavaScript's % keeps the dividend's sign, so the previous inline
     * normalisation ((a + π) % 2π) − π returned values BELOW −π for negative
     * inputs — one of the two ways the avatar could take the long way round
     * and appear to spin.
     */
    function _normAngle(a) {
        return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
    }

    /**
     * The yaw at which THIS avatar's forward axis points along (dx, dz).
     *
     * VRM forward is −Z, and the app rests VRM roots at rotation.y = π —
     * ViewerEngine resets exactly `root.rotation.set(0, isVRM ? Math.PI : 0, 0)`.
     * The old math used atan2(dx, dz), the +Z-forward yaw, so every
     * "face the user" converged toward facing AWAY from the user: the first
     * ambient look_at of a reply spun her ~90–110°, the next reply ~40° more,
     * and so on — the reported "hello turns her left, every answer rotates
     * again". Plain GLB roots rest at 0 and face +Z, hence the offset switch.
     */
    function _yawToward(dx, dz) {
        const vrmForward = !!((_avatarRoot && _avatarRoot.userData && _avatarRoot.userData.isVRM) || _vrm);
        return _normAngle(Math.atan2(dx, dz) + (vrmForward ? Math.PI : 0));
    }

    /** Smoothly yaw the avatar root toward a world point. Idempotent at rest. */
    function _faceTarget(pos, amount) {
        if (!_avatarRoot || !pos) return;
        const dx = pos.x - _avatarRoot.position.x;
        const dz = pos.z - _avatarRoot.position.z;
        if (dx * dx + dz * dz < 1e-6) return;
        const target = _yawToward(dx, dz);
        const diff = _normAngle(target - _avatarRoot.rotation.y);
        _avatarRoot.rotation.y = _normAngle(
            _avatarRoot.rotation.y + diff * Math.min(1, amount == null ? 0.25 : amount)
        );
    }

    /**
     * Turn in place by a relative angle. Tier A: yaw only, the root never
     * translates, so this is safe on desktop and in VR whatever the movement
     * policy says — she cannot rotate into anything.
     *
     * @param {number} degrees - signed, clamped to +/-180 by the parser
     * @returns {Promise<boolean>} resolves when the turn finishes
     */
    function _turnBy(degrees) {
        if (!_avatarRoot) return Promise.resolve(false);
        _stopTurn(false); // a new turn supersedes one in flight
        const rad = (Math.max(-180, Math.min(180, Number(degrees) || 0)) * Math.PI) / 180;
        if (Math.abs(rad) < 1e-3) return Promise.resolve(true);

        _turn.active = true;
        _turn.remaining = rad;
        // Fixed angular speed, so a 180 takes about twice as long as a 90 and
        // the motion reads as one deliberate movement rather than a snap.
        _turn.speed = 2.6; // rad/s
        _turn.deadline = _now() + Math.abs(rad) / _turn.speed + 1.5;
        return new Promise((resolve) => {
            _turn.resolve = resolve;
        });
    }

    /** @private */
    function _stopTurn(value) {
        if (_turn.resolve) {
            const r = _turn.resolve;
            _turn.resolve = null;
            r(value !== false);
        }
        _turn.active = false;
        _turn.remaining = 0;
    }

    /** @private */
    function _updateTurn(dt) {
        if (!_turn.active) return;
        if (!_avatarRoot || _now() > _turn.deadline) {
            _stopTurn(false);
            return;
        }
        const step = Math.sign(_turn.remaining) * Math.min(Math.abs(_turn.remaining), _turn.speed * dt);
        // Wrap after every step: an unwrapped 2π of drift made the next
        // look_at's diff exceed −π, which the old normalisation turned into
        // a full extra revolution.
        _avatarRoot.rotation.y = _normAngle(_avatarRoot.rotation.y + step);
        _turn.remaining -= step;
        if (Math.abs(_turn.remaining) < 1e-3) _stopTurn(true);
    }

    /** Expression with auto-decay so faces never freeze. */
    function setExpression(name, weight) {
        if (!name) return;
        _expr[String(name)] = {
            w: Math.max(0, Math.min(1, weight == null ? 0.5 : weight)),
            until: _now() + config.expressionHoldS,
        };
    }

    function _applyExpressions(dt) {
        const em = _vrm && _vrm.expressionManager;
        if (!em || typeof em.setValue !== 'function') return;
        const t = _now();
        for (const name of Object.keys(_expr)) {
            const e = _expr[name];
            if (t > e.until) e.w = Math.max(0, e.w - dt * 1.5);
            try {
                em.setValue(name, e.w);
            } catch (_err) {
                delete _expr[name];
                continue;
            }
            if (e.w <= 0.01 && t > e.until) delete _expr[name];
        }
    }

    /** Eyes track a smoothed proxy target. */
    function setLookAtTarget(pos) {
        const THREE = _T();
        if (!THREE || !pos) return;
        _lookGoal = pos.clone();
        if (!_lookProxy && _viewer && _viewer.scene) {
            _lookProxy = new THREE.Object3D();
            _viewer.scene.add(_lookProxy);
            _lookProxy.position.copy(pos);
        }
        if (_vrm && _vrm.lookAt && _lookProxy) _vrm.lookAt.target = _lookProxy;
    }

    /** Procedural head nod / shake when no clip exists (never "do nothing"). */
    function _playHeadFx(kind) {
        _headFx.active = true;
        _headFx.t = 0;
        _headFx.axis = kind === 'headshake' ? 'y' : 'x';
        _headFx.dur = kind === 'headshake' ? 1.2 : 1.0;
        _headFx.amp = kind === 'headshake' ? 0.32 : 0.26;
    }

    function _headBone() {
        const h = _vrm && _vrm.humanoid;
        if (!h) return null;
        if (typeof h.getNormalizedBoneNode === 'function') return h.getNormalizedBoneNode('head');
        if (typeof h.getBoneNode === 'function') return h.getBoneNode('head');
        return null;
    }

    /** Return to a context-appropriate idle after one-shot gestures. */
    function _scheduleIdle(afterS) {
        if (_idleTimer) clearTimeout(_idleTimer);
        _idleTimer = setTimeout(
            () => {
                if (state.sitting) playAnimation('sit_idle');
                else if (state.speaking) playAnimation('talking');
                else if (_startPoseRestore()) {
                    /* she settles back first; idle follows from update() */
                } else playAnimation('idle');
            },
            Math.max(200, (afterS || 0.8) * 1000)
        );
    }

    /**
     * Snapshot the pose across BOTH humanoid rigs.
     *
     * Both formats now retarget onto the NORMALIZED rig, but capturing both
     * rigs is still the right call and is deliberately kept:
     *
     *   - A non-VRM (GLB) avatar has no normalized layer at all; its bones are
     *     resolved by name and written directly.
     *   - The ambient ProceduralAnimator writes RAW bones with
     *     autoUpdateHumanBones off, so raw can hold state normalized does not.
     *   - Before BVH was fixed it wrote raw bones directly, and capturing
     *     normalized alone made the settle a silent no-op — she stayed in the
     *     frame the dance ended on. Capturing both is what makes the restore
     *     independent of which pipeline last touched the body.
     *
     * The blend writes both; whichever rig is live gets restored, and the
     * other is left consistent for whatever plays next.
     */
    function _capturePoseSnapshot(pr) {
        try {
            const h = _vrm.humanoid;
            const names = Object.keys(h.humanBones || {});
            const bones = [];
            const seen = new Set();
            const pick = (fn, n) => (typeof h[fn] === 'function' ? h[fn](n) : null);
            for (const n of names) {
                // A rig without a normalized layer returns the same object for
                // both; dedupe so a bone is not captured twice.
                for (const node of [pick('getNormalizedBoneNode', n), pick('getRawBoneNode', n)]) {
                    if (node && !seen.has(node)) {
                        seen.add(node);
                        bones.push(node);
                    }
                }
            }
            if (!bones.length) return;
            // Hips carry translation: BVH animates hips position and leaves a
            // visible displacement behind. Restore it on whichever rig moved.
            const hips = [pick('getNormalizedBoneNode', 'hips'), pick('getRawBoneNode', 'hips')].filter(
                (n, i, a) => n && a.indexOf(n) === i
            );
            pr.capture({ bones: bones, hips: hips, root: _avatarRoot });
            _log('pose snapshot captured (' + bones.length + ' bones)');
        } catch (_e) {
            /* the snapshot is best-effort */
        }
    }

    /**
     * Settle the body back to the pre-animation snapshot (short eased blend),
     * then update() hands it to the ambient system. The current clip is
     * stopped first so the mixer cannot fight the blend.
     * @returns {boolean} false when there is nothing to restore
     */
    function _startPoseRestore() {
        const pr = _poseRestore();
        if (!pr || !pr.hasSnapshot() || (pr.isBlending && pr.isBlending())) return false;
        const clips = _clips();
        if (clips && clips.stop) clips.stop({ fadeOut: 0.15, _skipRestore: true });
        try {
            if (window.NEXUS_PROCEDURAL_ANIMATOR && window.NEXUS_PROCEDURAL_ANIMATOR.setAllowWithMixer) {
                window.NEXUS_PROCEDURAL_ANIMATOR.setAllowWithMixer(false); // the blend owns the bones
            }
            // The blend writes raw bones directly, so the humanoid must not
            // re-derive them from normalized mid-settle and undo the work.
            const C = window.__CLIP_ANIM_CONST__;
            if (C && C.setHumanoidAutoUpdate) C.setHumanoidAutoUpdate(false, _vrm);
        } catch (_e) {
            /* ambient animator is optional */
        }
        pr.start(0.5);
        _log('pose restore: settling back to the pre-animation pose');
        return true;
    }

    /**
     * Executor + plan facing clip player. Routes names through MotionClipMap,
     * schedules the return to idle, and falls back to procedural motion.
     */
    function playAnimation(name) {
        const clips = _clips();
        if (!clips) return;
        const key = String(name || '').toLowerCase();
        if (key === 'walk' || key === 'walk_backward' || key === 'run') return; // locomotion owns gait
        // Snapshot the pre-animation skeleton ONCE per sequence, so a stop or
        // a natural finish settles her back to exactly how she stood —
        // including a Pose-Studio pose. Ambient names never own the snapshot;
        // a posture change (sit / stand) starts a new baseline.
        const pr = _poseRestore();
        if (pr && key !== 'idle' && key !== 'sit_idle' && key !== 'talking') {
            if (key === 'sit' || key === 'stand') {
                pr.clear();
            } else if (!pr.hasSnapshot() && _vrm && _vrm.humanoid) {
                const loader = typeof window !== 'undefined' ? window.NEXUS_CLIP_LOADER : null;
                const st = loader && loader.getCurrentPlaybackState ? loader.getCurrentPlaybackState() : null;
                if (!st || !st.isPlaying) _capturePoseSnapshot(pr);
            }
        }
        clips.play(key).then((res) => {
            if (res.ok) {
                state.lastActivity = key;
                if (res.then && !res.loop) {
                    setTimeout(() => clips.play(res.then), Math.max(300, (res.duration || 1.2) * 900));
                } else if (!res.loop && !res.sticky) {
                    _scheduleIdle((res.duration || 1.2) + 0.2);
                }
            } else if (res.procedural === 'nod' || res.procedural === 'headshake') {
                _playHeadFx(res.procedural);
            } else if (res.procedural) {
                _reach.active = true; // arm raise handled purely by IK ramp
                _reach.high = res.procedural === 'reach_high';
            } else if (res.reason) {
                // Surface it. The reported symptom — "I say dance, the toast
                // appears, nothing moves" — was this branch running silently:
                // the reason was recorded for the LLM and logged only under
                // config.debug, so on a phone there was nothing to see.
                _emitAction({ source: 'clip_failed', label: key, reason: res.reason });
                // B5: nothing in the library matched and there is no procedural
                // stand-in. Tell the model on the next turn instead of leaving
                // it to promise something the body never did — and substitute a
                // talking idle so she is not frozen mid-sentence.
                state.lastAction = { type: 'gesture:' + key, result: res.reason };
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn(
                        '[Motion] gesture "' +
                            key +
                            '" did not play — ' +
                            res.reason +
                            (res.tried && res.tried.length ? '; tried: ' + res.tried.join(', ') : '') +
                            '. Run NEXUS_MOTION.debugMotion() for a full report.'
                    );
                }
                if (res.reason === 'unknown_clip' && key !== 'talking') clips.play('talking');
            }
        });
    }

    // ── Locomotion (walk with arrival promise) ─────────────────────────

    function _stopWalk(resolveValue) {
        if (_walk.resolve) {
            const r = _walk.resolve;
            _walk.resolve = null;
            r(resolveValue !== false);
        }
        _walk.active = false;
        _walk.goal = null;
        if (_walk.manual) {
            _walk.manual = false;
            _scheduleIdle(0.1);
        }
    }

    /**
     * Walk the avatar so it stops `stopDist` short of `target`.
     * Prefers the real walk state machine; manual glide fallback otherwise.
     * @returns {Promise<boolean>} resolves on arrival or timeout
     */
    function walkTo(target, stopDist) {
        const THREE = _T();
        if (!THREE || !_avatarRoot || !target) return Promise.resolve(false);
        const pr = _poseRestore();
        if (pr && pr.invalidateRoot) pr.invalidateRoot(); // locomotion owns the root now
        return new Promise(async (resolve) => {
            try {
                if (state.sitting) await _standRoutine();
            } catch (_e) {
                /* stand fallback failed — keep going */
            }
            _stopWalk(false);

            const dir = new THREE.Vector3().subVectors(target, _avatarRoot.position);
            dir.y = 0;
            const dist = dir.length();
            const goal = _avatarRoot.position.clone();
            if (dist > 1e-3) goal.add(dir.normalize().multiplyScalar(Math.max(0, dist - (stopDist || 0))));
            goal.y = _avatarRoot.position.y;

            _walk.goal = goal;
            _walk.resolve = resolve;
            _walk.deadline = _now() + config.walkTimeoutS;
            _walk.active = true;

            if (_locoOn() && typeof _loco().walkToPoint === 'function') {
                _walk.manual = false;
                _loco().walkToPoint(goal.x, goal.z);
            } else {
                _walk.manual = true;
                const loader = typeof window !== 'undefined' ? window.NEXUS_CLIP_LOADER : null;
                if (loader) loader.playClip('vendor/animations/action/action_walk.bvh', { loop: true, fadeIn: 0.3 });
            }
        });
    }

    function _updateWalk(dt) {
        if (!_walk.active || !_avatarRoot || !_walk.goal) return;
        const dx = _walk.goal.x - _avatarRoot.position.x;
        const dz = _walk.goal.z - _avatarRoot.position.z;
        const d = Math.sqrt(dx * dx + dz * dz);

        if (_walk.manual) {
            _faceTarget(_walk.goal, Math.min(1, dt * 6));
            const step = Math.min(d, _walk.speed * dt);
            if (d > 1e-4) {
                _avatarRoot.position.x += (dx / d) * step;
                _avatarRoot.position.z += (dz / d) * step;
            }
        }
        const arrived = d < 0.3 || (!_walk.manual && _loco() && _loco().isWalking && !_loco().isWalking() && d < 0.6);
        if (arrived || _now() > _walk.deadline) _stopWalk(true);
    }

    function _updateFollow(dt) {
        if (!_follow.active || !_avatarRoot) return;
        _follow.sinceRefresh += dt;
        const user = getUserPosition();
        if (!user) return;
        const dx = user.x - _avatarRoot.position.x;
        const dz = user.z - _avatarRoot.position.z;
        const d = Math.sqrt(dx * dx + dz * dz);

        if (d > _follow.dist + config.followHysteresisM) {
            if (_follow.sinceRefresh >= config.followRefreshS) {
                _follow.sinceRefresh = 0;
                walkTo(user, _follow.dist * 0.95);
            }
        } else if (!_walk.active) {
            _faceTarget(user, Math.min(1, dt * 3));
        }
    }

    // ── Contact (handshake / high five) ────────────────────────────────

    function _updateContact(dt) {
        const ik = _ik();
        if (!ik) return;

        // Keep the IK target glued to the user's real hand (or a natural
        // forward reach point when hands aren't tracked / on desktop).
        if (_reach.active || _contact.active) {
            const side = _contact.active ? _contact.side : _reach.side;
            let target = getUserHand(side === 'right' ? 'left' : 'right') || getUserHand(side);
            if (!target) {
                const THREE = _T();
                const user = getUserPosition();
                if (THREE && _avatarRoot && user) {
                    const dir = new THREE.Vector3().subVectors(user, _avatarRoot.position);
                    dir.y = 0;
                    if (dir.lengthSq() > 1e-6) dir.normalize();
                    target = _avatarRoot.position
                        .clone()
                        .add(dir.multiplyScalar(0.45))
                        .setY(_avatarRoot.position.y + (_reach.high ? 1.55 : 1.05));
                }
            }
            if (target) ik.setTarget(side, target);
        }

        if (_contact.active) {
            const hand = ik.getHandWorldPos(_contact.side);
            const user = getUserHand(_contact.side === 'right' ? 'left' : 'right') || getUserHand(_contact.side);
            if (hand && user && hand.distanceTo(user) < _contact.radius) {
                _haptic(null, 0.7);
                setExpression('happy', 0.7);
                const r = _contact.resolve;
                _contact.resolve = null;
                _contact.active = false;
                if (r) r('contact');
            } else if (_now() > _contact.deadline) {
                const r = _contact.resolve;
                _contact.resolve = null;
                _contact.active = false;
                _reach.active = false;
                ik.clearTargets();
                setExpression('sad', 0.25);
                _scheduleIdle(0.2);
                if (r) r('timeout');
            }
        }

        ik.update(dt);
    }

    function _updateHeadFx(dt) {
        if (!_headFx.active) return;
        const bone = _headBone();
        if (!bone) {
            _headFx.active = false;
            return;
        }
        _headFx.t += dt;
        const p = _headFx.t / _headFx.dur;
        if (p >= 1) {
            _headFx.active = false;
            return;
        }
        const wave = Math.sin(p * Math.PI * (_headFx.axis === 'y' ? 4 : 3)) * _headFx.amp * Math.sin(p * Math.PI);
        if (_headFx.axis === 'y') bone.rotation.y += wave;
        else bone.rotation.x += wave;
    }

    function _updateLook(dt) {
        if (_lookProxy && _lookGoal) _lookProxy.position.lerp(_lookGoal, Math.min(1, dt * 8));
    }

    // ── Behaviors (registered over MotionExecutor defaults) ────────────

    /**
     * Leave the seated posture, in the world state only.
     *
     * Split out from _standRoutine so a caller can clear the flag
     * SYNCHRONOUSLY. main.js calls onUserUtterance(text) and then builds the
     * chat request; systemPromptSuffix() reads getWorldSnapshot() in that same
     * synchronous run. Anything cleared after an `await` is therefore still
     * set when the model is prompted — which is why "stop" was answered with
     * "I'll sit back down": the snapshot said avatar_sitting=yes on the very
     * turn the user asked her to stop.
     *
     * @private
     */
    function _clearSeated() {
        state.sitting = false;
        state.lastActivity = 'idle';
    }

    /** Play the stand-up clip and give it time to read. @private */
    async function _playStandUp() {
        playAnimation('stand');
        await new Promise((r) => setTimeout(r, 1100));
    }

    async function _standRoutine() {
        if (!state.sitting) return;
        _clearSeated();
        await _playStandUp();
    }

    function _registerBehaviors() {
        const dsl = _dsl();
        if (!dsl) return;

        dsl.registerHandler('approach', async (cmd) => {
            const target = cmd.target === 'nearest_seat' ? getAnchorPosition('seat') : getUserPosition();
            if (!target) return;
            setLookAtTarget(target);
            await walkTo(target, cmd.distance_m || 1.0);
            const user = getUserPosition();
            if (user) _faceTarget(user, 1);
        });

        dsl.registerHandler('retreat', async (cmd) => {
            const THREE = _T();
            const user = getUserPosition();
            if (!THREE || !user || !_avatarRoot) return;
            const dir = new THREE.Vector3().subVectors(_avatarRoot.position, user);
            dir.y = 0;
            if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
            const goal = _avatarRoot.position.clone().add(dir.normalize().multiplyScalar(cmd.distance_m || 2.0));
            await walkTo(goal, 0);
            _faceTarget(user, 1);
        });

        dsl.registerHandler('follow', async (cmd) => {
            if (state.sitting) await _standRoutine();
            _follow.active = true;
            state.following = true;
            _follow.dist = cmd.distance_m || 1.5;
            _follow.sinceRefresh = config.followRefreshS;
        });

        const stopFollow = async () => {
            _follow.active = false;
            state.following = false;
            if (_loco() && _loco().forceStop) _loco().forceStop();
            _stopWalk(false);
        };
        dsl.registerHandler('stop_follow', stopFollow);
        dsl.registerHandler('stop', async () => {
            // Everything the world snapshot reports has to be settled BEFORE
            // the first await — see _clearSeated. last_action closes the loop
            // for the model: without it the only evidence it had about this
            // turn was a posture flag, and it narrated the posture.
            const wasSitting = state.sitting;
            if (wasSitting) _clearSeated();
            state.lastAction = { type: 'stop', result: wasSitting ? 'stood_up' : 'stopped' };

            await stopFollow();
            _reach.active = false;
            if (_ik()) _ik().clearTargets();
            if (_contact.resolve) {
                const r = _contact.resolve;
                _contact.resolve = null;
                _contact.active = false;
                r('interrupted');
            }
            // "Stop" is the universal escape hatch — MotionPolicy lets it
            // through at every setting — so it has to be able to escape
            // SITTING too. It could not: state.sitting stayed true, and
            // _scheduleIdle's first branch put her straight back into
            // sit_idle. Once seated, nothing but an explicit "stand up" got
            // her out of the chair, and the pose-restore settle in the third
            // branch was unreachable, so the body never returned to rest.
            if (wasSitting) {
                // playAnimation('stand') already scheduled the idle for the
                // clip's real length (action_standup is 3.47 s, while the wait
                // here is 1.1 s). Calling _scheduleIdle would clear that timer
                // and cut the stand-up off a third of the way through.
                await _playStandUp();
            } else {
                _scheduleIdle(0.1);
            }
        });

        dsl.registerHandler('sit', async (cmd) => {
            if (state.sitting) return;
            const seat = cmd.target === 'user' ? null : getAnchorPosition('seat');
            if (seat) {
                await walkTo(seat, 0.1);
                _faceTarget(getUserPosition() || seat, 1);
            }
            state.sitting = true;
            playAnimation('sit');
        });

        dsl.registerHandler('stand', async () => {
            await _standRoutine();
        });

        dsl.registerHandler('offer_hand', async (cmd) => {
            _reach.side = cmd.side === 'left' ? 'left' : 'right';
            _reach.high = cmd.name === 'high_five';
            _reach.active = true;
            const user = getUserPosition();
            if (user) {
                setLookAtTarget(user);
                _faceTarget(user, 1);
            }
            playAnimation(_reach.high ? 'high_five' : 'offer_hand');
        });

        dsl.registerHandler('wait_contact', (cmd) => {
            return new Promise((resolve) => {
                _contact.active = true;
                _contact.side = _reach.side;
                _contact.radius = cmd.radius_m || 0.14;
                _contact.deadline = _now() + (cmd.timeout_s || 6);
                _contact.resolve = resolve;
            });
        });

        dsl.registerHandler('gesture', async (cmd) => {
            const name = String(cmd.name || 'wave').toLowerCase();
            if (name === 'handshake') {
                playAnimation('handshake');
                _playHeadFx('nod');
                setTimeout(() => {
                    _reach.active = false;
                    if (_ik()) _ik().clearTargets();
                }, 1400);
                return;
            }
            playAnimation(name);
        });

        // Tier A: yaw only, never translates the root, so it runs whatever the
        // movement policy says. Registered through the public registerHandler,
        // so MotionDSL itself needs no edit.
        dsl.registerHandler('turn', async (cmd) => {
            if (cmd && cmd.target) {
                // "turn to face me" — aim at a point rather than a fixed angle.
                const p = cmd.target === 'nearest_seat' ? getAnchorPosition('seat') : getUserPosition();
                if (p) {
                    _faceTarget(p, 1);
                    return;
                }
            }
            await _turnBy(cmd && cmd.degrees != null ? cmd.degrees : 180);
        });

        dsl.registerHandler('raise_hand', async (cmd) => {
            playAnimation('raise_hand');
            _reach.side = cmd && cmd.side === 'left' ? 'left' : 'right';
        });

        dsl.registerHandler('nod', async () => playAnimation('nod'));
        dsl.registerHandler('point', async (cmd) => {
            const user = getUserPosition();
            if (user) _faceTarget(user, 0.8);
            playAnimation('point');
        });
        dsl.registerHandler('look_at', async (cmd) => {
            const p = cmd.target === 'nearest_seat' ? getAnchorPosition('seat') : getUserPosition();
            if (!p) return;
            setLookAtTarget(p);
            _faceTarget(p, 0.6);
        });
        dsl.registerHandler('expression', async (cmd) => setExpression(cmd.name || 'neutral', cmd.weight));
        dsl.registerHandler(
            'pause',
            (cmd) => new Promise((r) => setTimeout(r, Math.min(30, cmd.seconds || 0.5) * 1000))
        );
        dsl.registerHandler('speak_start', async () => {
            state.speaking = true;
            if (!_walk.active && !state.sitting) playAnimation('talking');
        });
        dsl.registerHandler('speak_end', async () => {
            state.speaking = false;
            if (!_walk.active) _scheduleIdle(0.1);
        });
        dsl.registerHandler('idle', async (cmd) => playAnimation(cmd.name || 'idle'));
    }

    // ── Plan I/O (called from main.js) ──────────────────────────────────

    /** Policy module, when loaded. Absent = everything allowed (pre-B2 behaviour). */
    function _policy() {
        return typeof window !== 'undefined' ? window.NEXUS_MOTION_POLICY : null;
    }

    /**
     * Master switch. Reads the policy when it is loaded so a Settings toggle
     * applies live; falls back to the local config when it is not, which keeps
     * the module standalone (and keeps its removal contract intact).
     */
    function _enabled() {
        const p = _policy();
        if (p && typeof p.isEnabled === 'function') return p.isEnabled();
        return config.enabled;
    }
    function _poseRestore() {
        return typeof window !== 'undefined' ? window.NEXUS_MOTION_POSE_RESTORE : null;
    }

    /** Environment the policy needs. Injected so MotionPolicy stays pure. */
    function _policyCtx() {
        const xr = _xr();
        return { inVR: !!(xr && xr.isPresenting) };
    }

    /**
     * SEAM 3 — the executor boundary. Disallowed types are stripped here even
     * if the fast path missed them or a provider hallucinated one, so no single
     * upstream mistake can move the avatar against policy.
     */
    function execute(plan) {
        const dsl = _dsl();
        if (!_enabled() || !dsl || !plan) return;

        const policy = _policy();
        if (policy && policy.filterPlan) {
            const res = policy.filterPlan(plan, _policyCtx());
            if (res.stripped.length) {
                // Record the first blocked command so the next prompt can
                // explain it; movement is the only thing the policy gates.
                state.lastAction = { type: res.stripped[0], result: 'movement_disabled' };
                _telemetry.policy_strips++;
                _emitAction({ source: 'policy', label: 'movement_disabled', stripped: res.stripped });
                _log('policy stripped:', res.stripped.join(','));
            }
            if (!res.plan) return;
            plan = res.plan;
        }

        dsl.execute(plan, { integration: 'nexus-motion' });
    }

    /**
     * Fast path: fire instant motion for recognized commands and let the LLM
     * still produce the verbal reply. The LLM's duplicate plan (for the same
     * utterance) is suppressed so actions never double-fire.
     * @param {string} text
     */
    function onUserUtterance(text) {
        if (!_enabled() || typeof window === 'undefined') return;
        const fp = window.NEXUS_INTENT_FASTPATH;
        const hit = fp && fp.match ? fp.match(text) : null;
        const user = getUserPosition();
        if (user) setLookAtTarget(user); // acknowledge instantly, always
        _telemetry.utterances++;
        // A new utterance opens a new pairing window: a previous turn's miss
        // must never pair with a later turn's reply.
        _lastMissAt = -1;
        if (!hit) {
            // Remember the miss: if the LLM emits a plan for this turn, that
            // pair is exactly the recall gap a local ML tier would close.
            _lastMissAt = _now();
            const t = String(text || '')
                .trim()
                .slice(0, 80);
            if (t) {
                _telemetry.missed_recent.push(t);
                if (_telemetry.missed_recent.length > 20) _telemetry.missed_recent.shift();
            }
            _log('no fast-path match → the LLM decides:', t);
            if (_telemetry.utterances % 20 === 0) _log('telemetry:', getTelemetry());
            return;
        }
        _telemetry.fastpath_hits++;
        _telemetry.by_label[hit.label] = (_telemetry.by_label[hit.label] || 0) + 1;
        if (hit.label === 'stop' || hit.label === 'stop_follow') {
            // Misfire proxy: a stop right after an action is the cheapest
            // observable correction signal — it measures the direction
            // recall_gap cannot see (the fast path acting when it should not,
            // e.g. "don't dance" → dance).
            if (_lastActionAt >= 0 && _now() - _lastActionAt < 5) {
                _telemetry.misfire_stops++;
                _telemetry.misfire_recent.push(_lastActionLabel);
                if (_telemetry.misfire_recent.length > 10) _telemetry.misfire_recent.shift();
            }
            _lastActionAt = -1;
        } else {
            _lastActionAt = _now();
            _lastActionLabel = hit.label;
        }
        _log('fast-path:', hit.label);
        _emitAction({ source: 'fastpath', label: hit.label });
        _suppressNextPlan = _now() + 20;
        execute(hit.plan);
    }

    /**
     * Extract + run the ```motion block from an LLM reply; returns clean text
     * for display/TTS. Never throws.
     * @param {string} text
     * @returns {string}
     */
    function processReply(text) {
        if (typeof window === 'undefined' || !window.NEXUS_MOTION_PARSER) return text;
        const { cleanText, plan } = window.NEXUS_MOTION_PARSER.extract(text);
        if (plan && _enabled()) {
            if (_now() < _suppressNextPlan) {
                _suppressNextPlan = 0;
                _telemetry.suppressed_llm_plans++;
                _log('LLM plan suppressed (fast-path already acted)');
            } else {
                _telemetry.llm_plans++;
                const primary = _primaryType(plan);
                // The recall gap is "the regex missed a COMMAND the LLM then
                // acted on" — so it must only count non-ambient plans. The
                // contract mandates an ambient plan (look_at + expression) on
                // every plain-conversation turn, so counting any plan here
                // scores 100% on pure small talk and the number becomes
                // meaningless. Consume _lastMissAt so one miss counts once.
                if (primary && _lastMissAt >= 0 && _now() - _lastMissAt < 30) {
                    _telemetry.recall_gap_hits++;
                    _lastMissAt = -1;
                }
                if (primary === 'stop' || primary === 'stop_follow') {
                    // A long-phrased "please stop that" the regex missed but
                    // the LLM honoured is the same correction signal.
                    if (_lastActionAt >= 0 && _now() - _lastActionAt < 5) {
                        _telemetry.misfire_stops++;
                        _telemetry.misfire_recent.push(_lastActionLabel);
                        if (_telemetry.misfire_recent.length > 10) _telemetry.misfire_recent.shift();
                    }
                    _lastActionAt = -1;
                } else if (primary) {
                    _lastActionAt = _now();
                    _lastActionLabel = primary;
                }
                if (primary) _emitAction({ source: 'llm', label: primary });
                execute(plan);
            }
        }
        return cleanText;
    }

    function maskStreaming(text) {
        return typeof window !== 'undefined' && window.NEXUS_MOTION_PARSER
            ? window.NEXUS_MOTION_PARSER.maskStreaming(text)
            : text;
    }

    function getWorldSnapshot() {
        const user = getUserPosition();
        const xr = _xr();
        let dist = 0;
        if (user && _avatarRoot) {
            const dx = user.x - _avatarRoot.position.x;
            const dz = user.z - _avatarRoot.position.z;
            dist = Math.sqrt(dx * dx + dz * dz);
        }
        return {
            user: {
                distance_to_avatar_m: dist,
                in_vr: !!(xr && xr.isPresenting),
                hands_tracked: !!getUserHand('right') || !!getUserHand('left'),
            },
            avatar: {
                state: _walk.active ? 'walking' : state.speaking ? 'speaking' : state.lastActivity,
                sitting: state.sitting,
                following: state.following,
            },
            anchors: Object.keys(_anchors)
                .filter((k) => _anchors[k])
                .map((k) => ({ type: k })),
            last_action: state.lastAction,
        };
    }

    function systemPromptSuffix() {
        if (!_enabled() || typeof window === 'undefined' || !window.NEXUS_MOTION_CONTRACT) return '';
        const clips = _clips() ? _clips().availableNames() : [];

        // SEAM 1 — the vocabulary. Telling the model only about commands that
        // are currently enabled is a stronger guarantee than asking it not to
        // use them: it cannot misuse a tool it was never handed.
        let types = null;
        const policy = _policy();
        const parser = window.NEXUS_MOTION_PARSER;
        if (policy && policy.allowedTypes && parser) {
            types = policy.allowedTypes(parser.ALLOWED_TYPES, _policyCtx());
        }

        return window.NEXUS_MOTION_CONTRACT.systemPromptSuffix(getWorldSnapshot(), clips, types);
    }

    // ── Lifecycle ───────────────────────────────────────────────────────

    /** ViewerEngine hook: avatar loaded / switched. */
    function onAvatarChanged(root, vrm) {
        _avatarRoot = root || null;
        _vrm = vrm || null;
        state.sitting = false;
        if (_ik()) _ik().attach(_vrm);
        if (_vrm && _vrm.lookAt && _lookProxy) _vrm.lookAt.target = _lookProxy;
        _log('avatar attached');
    }

    /** ViewerEngine hook: per-frame update (after mixer, before render). */
    function update(dt) {
        if (!_enabled() || !state.booted) return;
        const d = Math.min(0.1, dt || 0.016);
        const pr = _poseRestore();
        if (pr && pr.isBlending && pr.isBlending()) {
            if (!pr.update(d)) {
                // Settle finished — hand the body back to the ambient system.
                try {
                    if (window.NEXUS_PROCEDURAL_ANIMATOR && window.NEXUS_PROCEDURAL_ANIMATOR.setAllowWithMixer) {
                        window.NEXUS_PROCEDURAL_ANIMATOR.setAllowWithMixer(true);
                    }
                    const C = window.__CLIP_ANIM_CONST__;
                    if (C && C.setHumanoidAutoUpdate) C.setHumanoidAutoUpdate(false, _vrm);
                } catch (_e) {
                    /* ambient hand-back is best-effort */
                }
                _log('pose restore: done');
                _scheduleIdle(0.4);
            }
            return; // the settle owns the body this frame
        }
        _updateWalk(d);
        _updateFollow(d);
        _updateContact(d);
        _updateHeadFx(d);
        _updateTurn(d);
        _updateLook(d);
        _applyExpressions(d);
    }

    /** Poll until the viewer + avatar exist, then wire the executor. */
    function boot() {
        if (state.booted || typeof window === 'undefined') return;
        const tryInit = () => {
            _viewer = window.NEXUS_VIEWER || null;
            const S = window.__CLIP_ANIM_STATE__ || {};
            const root =
                S.avatarRoot || (_viewer && _viewer.avatarManager && _viewer.avatarManager.currentRoot) || null;
            const vrm = S.avatarVRM || (_viewer && _viewer.avatarManager && _viewer.avatarManager._currentVRM) || null;
            if (!_viewer || !root || !window.MotionDSL) return false;

            if (window.MotionExecutor && window.MotionExecutor.init) {
                window.MotionExecutor.init({
                    avatar: root,
                    scene: _viewer.scene,
                    getUserPosition,
                    getAnchorPosition,
                    setExpression,
                    playAnimation,
                    setLookAtTarget,
                });
            }
            _registerBehaviors(); // enhanced handlers win (registered last)
            onAvatarChanged(root, vrm);
            state.booted = true;
            if (typeof console !== 'undefined') {
                const pol = _policy();
                let lib = true;
                try {
                    lib = typeof localStorage === 'undefined' || localStorage.getItem('npc_library_anims') !== 'false';
                } catch (_e) {
                    /* storage unavailable */
                }
                console.log(
                    '[Motion] ready — enabled=' +
                        _enabled() +
                        ' movement=' +
                        (pol && pol.movementMode ? pol.movementMode() : 'n/a') +
                        ' libraryAnims=' +
                        lib +
                        ' debug=' +
                        config.debug +
                        ' | avatar ✓ dsl ✓ executor ' +
                        (window.MotionExecutor ? '✓' : '–') +
                        ' clips ' +
                        (_clips() ? '✓' : '–') +
                        ' loader ' +
                        (window.NEXUS_CLIP_LOADER ? '✓' : '–')
                );
            }
            return true;
        };
        if (tryInit()) return;
        let tries = 0;
        const timer = setInterval(() => {
            if (tryInit()) {
                clearInterval(timer);
                return;
            }
            if (++tries > 120) {
                clearInterval(timer);
                if (typeof console !== 'undefined' && console.warn) {
                    const am = window.NEXUS_VIEWER && window.NEXUS_VIEWER.avatarManager;
                    console.warn(
                        '[Motion] boot gave up after 60s — missing:' +
                            (window.NEXUS_VIEWER ? '' : ' viewer') +
                            (window.MotionDSL ? '' : ' MotionDSL') +
                            ((window.__CLIP_ANIM_STATE__ || {}).avatarRoot || (am && am.currentRoot) ? '' : ' avatar')
                    );
                }
            }
        }, 500);
    }

    if (typeof window !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
        else boot();
    }

    /**
     * Snapshot of the session's intent-detection counters. The number that
     * decides whether a local ML tier is worth building is
     * `recall_gap_hits / utterances` — see ActionRegistry's header.
     * In-memory only; resets on reload.
     */
    function getTelemetry() {
        return Object.assign({}, _telemetry, {
            by_label: Object.assign({}, _telemetry.by_label),
            misfire_recent: _telemetry.misfire_recent.slice(),
            missed_count: _telemetry.missed_recent.length,
            // Raw user speech only leaves this closure under debug: it is
            // never persisted or sent, but a window global is readable by any
            // script on the page, so the texts stay opt-in
            // (NEXUS_MOTION.config.debug = true).
            missed_recent: config.debug ? _telemetry.missed_recent.slice() : [],
        });
    }

    /** Toggle verbose [Motion]/[MotionClipMap] tracing; persists npc_debug. */
    function setDebug(on) {
        config.debug = !!on;
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem('npc_debug', on ? 'true' : 'false');
        } catch (_e) {
            /* storage unavailable */
        }
        if (typeof console !== 'undefined') console.log('[Motion] verbose tracing', on ? 'ON' : 'off');
        return config.debug;
    }

    /**
     * One-shot diagnostics for "she said she would, nothing moved".
     * Prints flags, module presence, clip availability and — in a browser —
     * live-probes representative asset URLs so a missing-deployment or
     * rewrite-to-HTML problem is identified in a single console line.
     *
     * @param {{probe?: boolean}} [opts] - probe:false skips network fetches
     * @returns {Promise<Object>} the collected report
     */
    async function debugMotion(opts) {
        const pol = _policy();
        const clips = _clips();
        const loader = typeof window !== 'undefined' ? window.NEXUS_CLIP_LOADER : null;
        let lib = true;
        try {
            lib = typeof localStorage === 'undefined' || localStorage.getItem('npc_library_anims') !== 'false';
        } catch (_e) {
            /* storage unavailable */
        }
        const report = {
            enabled: _enabled(),
            movement: pol && pol.movementMode ? pol.movementMode() : null,
            libraryAnims: lib,
            debug: config.debug,
            booted: state.booted,
            avatarAttached: !!_avatarRoot,
            modules: {
                dsl: !!_dsl(),
                executor: typeof window !== 'undefined' && !!window.MotionExecutor,
                policy: !!pol,
                clips: !!clips,
                parser: typeof window !== 'undefined' && !!window.NEXUS_MOTION_PARSER,
                loader: !!loader,
            },
            gestureNames: clips && clips.availableNames ? clips.availableNames().length : 0,
            libraryCatalog: loader && loader.getAllAnimations ? (loader.getAllAnimations() || []).length : 0,
            unavailable: clips && clips.getUnavailable ? clips.getUnavailable() : [],
            telemetry: getTelemetry(),
            probes: [],
        };
        const doProbe = !opts || opts.probe !== false;
        if (doProbe && typeof fetch === 'function' && clips && clips.probeCandidates) {
            const targets = clips.probeCandidates().concat(report.unavailable.slice(0, 2));
            for (const url of targets.slice(0, 5)) {
                try {
                    const r = await fetch(url, { cache: 'no-store' });
                    const type = r.headers && r.headers.get ? r.headers.get('content-type') || '?' : '?';
                    const head = (await r.text()).slice(0, 12);
                    report.probes.push({ url, status: r.status, type, html: head.trimStart().charAt(0) === '<' });
                } catch (err) {
                    report.probes.push({ url, error: String(err && err.message) });
                }
            }
        }
        if (typeof console !== 'undefined') {
            console.log('[Motion] diagnostics', report);
            for (const p of report.probes) {
                if (p.html || (p.type && p.type.indexOf('text/html') !== -1)) {
                    console.warn(
                        '[Motion] PROBE ' +
                            p.url +
                            ' → ' +
                            p.status +
                            ' ' +
                            p.type +
                            ' — the server returned HTML for a binary asset: the file is missing from ' +
                            'the deployment, or a catch-all rewrite intercepts it (vercel.json must pass ' +
                            '/addons and /assets through, like /vendor).'
                    );
                } else if (p.error) {
                    console.warn('[Motion] PROBE ' + p.url + ' → fetch failed: ' + p.error);
                }
            }
        }
        return report;
    }

    return {
        boot,
        update,
        onAvatarChanged,
        onUserUtterance,
        processReply,
        maskStreaming,
        systemPromptSuffix,
        getWorldSnapshot,
        setAnchor,
        execute,
        playAnimation,
        getTelemetry,
        setDebug,
        debugMotion,
        _faceTarget,
        _normAngle,
        _startPoseRestore,
        state,
        config,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_MOTION = MotionIntegration;
if (typeof module !== 'undefined' && module.exports) module.exports = MotionIntegration;
