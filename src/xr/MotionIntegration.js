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
    };

    let _viewer = null;
    let _avatarRoot = null;
    let _vrm = null;
    let _lookProxy = null;
    let _lookGoal = null;
    let _suppressNextPlan = 0; // timestamp until which LLM plans are dropped
    let _idleTimer = null;

    const _follow = { active: false, dist: 1.5, sinceRefresh: 0 };
    const _walk = { active: false, goal: null, resolve: null, deadline: 0, manual: false, speed: 0.9 };
    const _contact = { active: false, side: 'right', radius: 0.14, resolve: null, deadline: 0 };
    const _reach = { active: false, side: 'right', high: false };
    const _headFx = { active: false, axis: 'x', t: 0, dur: 1.1, amp: 0.28 };
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

    /** Smoothly yaw the avatar root toward a world point. */
    function _faceTarget(pos, amount) {
        if (!_avatarRoot || !pos) return;
        const dx = pos.x - _avatarRoot.position.x;
        const dz = pos.z - _avatarRoot.position.z;
        if (dx * dx + dz * dz < 1e-6) return;
        const target = Math.atan2(dx, dz);
        let diff = target - _avatarRoot.rotation.y;
        diff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;
        _avatarRoot.rotation.y += diff * Math.min(1, amount == null ? 0.25 : amount);
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
                else playAnimation('idle');
            },
            Math.max(200, (afterS || 0.8) * 1000)
        );
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

    async function _standRoutine() {
        if (!state.sitting) return;
        state.sitting = false;
        playAnimation('stand');
        await new Promise((r) => setTimeout(r, 1100));
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
            await stopFollow();
            _reach.active = false;
            if (_ik()) _ik().clearTargets();
            if (_contact.resolve) {
                const r = _contact.resolve;
                _contact.resolve = null;
                _contact.active = false;
                r('interrupted');
            }
            _scheduleIdle(0.1);
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

    function execute(plan) {
        const dsl = _dsl();
        if (!config.enabled || !dsl || !plan) return;
        dsl.execute(plan, { integration: 'nexus-motion' });
    }

    /**
     * Fast path: fire instant motion for recognized commands and let the LLM
     * still produce the verbal reply. The LLM's duplicate plan (for the same
     * utterance) is suppressed so actions never double-fire.
     * @param {string} text
     */
    function onUserUtterance(text) {
        if (!config.enabled || typeof window === 'undefined') return;
        const fp = window.NEXUS_INTENT_FASTPATH;
        const hit = fp && fp.match ? fp.match(text) : null;
        const user = getUserPosition();
        if (user) setLookAtTarget(user); // acknowledge instantly, always
        if (!hit) return;
        _log('fast-path:', hit.label);
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
        if (plan && config.enabled) {
            if (_now() < _suppressNextPlan) {
                _suppressNextPlan = 0;
                _log('LLM plan suppressed (fast-path already acted)');
            } else {
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
        };
    }

    function systemPromptSuffix() {
        if (!config.enabled || typeof window === 'undefined' || !window.NEXUS_MOTION_CONTRACT) return '';
        const clips = _clips() ? _clips().availableNames() : [];
        return window.NEXUS_MOTION_CONTRACT.systemPromptSuffix(getWorldSnapshot(), clips);
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
        if (!config.enabled || !state.booted) return;
        const d = Math.min(0.1, dt || 0.016);
        _updateWalk(d);
        _updateFollow(d);
        _updateContact(d);
        _updateHeadFx(d);
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
            _log('booted — living NPC online');
            return true;
        };
        if (tryInit()) return;
        let tries = 0;
        const timer = setInterval(() => {
            if (tryInit() || ++tries > 120) clearInterval(timer);
        }, 500);
    }

    if (typeof window !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
        else boot();
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
        state,
        config,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_MOTION = MotionIntegration;
if (typeof module !== 'undefined' && module.exports) module.exports = MotionIntegration;
