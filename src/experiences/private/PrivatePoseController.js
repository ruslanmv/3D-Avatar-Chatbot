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
        // UN27. The closer positions from Pose Studio's Adult set (UN24, UN26), each by its own key
        // and gated exactly as all fours is: open only at the top of the pace (the policy), and only
        // while Spicy mode lists them (`known` below reads Pose Studio's own list).
        'sit-open': { preset: 'sittingOpen', adult: true },
        'kneel-wide': { preset: 'kneelingWide', adult: true },
        'knees-up': { preset: 'lyingKneesUp', adult: true },
        straddle: { preset: 'straddle', adult: true },
    });

    /**
     * UN27. What her body is doing in each held position, in the second person, for the model.
     *
     * "Your body is in that position now (kneel wide)" gave the model a key and nothing else, so it
     * guessed — and a guess is how she says "I lie back on the bed" while the renderer shows her
     * kneeling on the floor, or narrates hands somewhere they are not. These are what the presets
     * actually do, read off `VRPoseSystem.POSE_PRESETS` and the renders (front and side, AvatarSample_A),
     * so her words can follow her body. Only what is visible: no sensation is put in her mouth here;
     * how it feels is hers to say, in character. A preset retuned in VRPoseSystem changes its line here.
     */
    const BODY = Object.freeze({
        kneel: 'kneeling on both knees, body upright',
        'kneel-up': 'kneeling upright, hands on your thighs',
        'all-fours': 'on your hands and knees, palms flat on the floor, back level, head up',
        'lie-back': 'lying on your back, arms open',
        'lie-front': 'lying on your stomach, propped on your forearms, chest lifted',
        'lie-side': 'lying on your side',
        'bend-forward': 'standing, bent forward from the hips',
        'arch-back': 'standing, arching your back',
        lounge: 'sitting on the floor, legs stretched out, leaning back a little',
        'sit-open':
            'sitting on the floor with your legs open wide in a V, leaning back a little, hands resting on the floor beside your hips, head tilted towards them',
        'kneel-wide':
            'kneeling with your knees wide apart, sitting back towards your heels, back arched, hands on your thighs',
        'knees-up':
            'lying on your back, knees raised and apart, feet flat on the floor, arms resting up by your head, looking down along your body at them',
        straddle:
            'kneeling up astride their lap, knees wide on either side of them, back arched, hands resting on their shoulders',
    });

    /** UN27. The closer positions, in the order they are offered: key and a short name for lists. */
    const INTIMATE = Object.freeze([
        Object.freeze({ key: 'sit-open', name: 'sitting with your legs open' }),
        Object.freeze({ key: 'kneel-wide', name: 'kneeling with your knees wide' }),
        Object.freeze({ key: 'knees-up', name: 'on your back with your knees up' }),
        Object.freeze({ key: 'straddle', name: 'straddling them' }),
        Object.freeze({ key: 'all-fours', name: 'on all fours' }),
    ]);

    /**
     * NL1. A preset asked for by its Pose Studio name: `preset:kneelingUp`. The words' keys above
     * were the only way in, so nine positions could be asked for and the other presets of the
     * navigator could not. The catalogue (`NEXUS_POSE_STUDIO_PANEL.catalogue()`) says which
     * names exist for this session and which are adult; this path applies only the ones that
     * are not. An adult preset is reached through its own key above and its own gate, or not
     * at all.
     */
    const PRESET = 'preset:';
    const presetKey = (name) => PRESET + name;

    /** NL1. What the rendered skeleton must show for a category of pose, checked in `confirm`. */
    const EXPECT = Object.freeze({
        // hips at most this share of her standing hips height; trunk at least this far from upright.
        // Seated with her legs up ("Lounging") her hips stay at 0.88 of standing height while her
        // feet come up to meet them: measured hips-above-feet 0.72 of standing, against 0.52–0.64
        // for the other seats and 0.97–1.0 for every standing preset. Either sign is sitting.
        Sitting: { hipsBelow: 0.85, orFeetGap: 0.8 },
        Kneeling: { hipsBelow: 0.85 },
        Lying: { hipsBelow: 0.6, trunkTiltMin: 50 },
        Ground: { hipsBelow: 0.9 },
    });
    const CATEGORY_OF_KEY = Object.freeze({
        kneel: 'Kneeling',
        'kneel-up': 'Kneeling',
        'all-fours': 'Ground',
        'lie-back': 'Lying',
        'lie-front': 'Lying',
        'lie-side': 'Lying',
        lounge: 'Sitting',
        // UN27. Grounded like the categories they share: the chair seat lowers her hips to her
        // feet, the floor seat to the floor, straddling kneels up (hips at kneel-up's height).
        'sit-open': 'Sitting',
        'kneel-wide': 'Kneeling',
        'knees-up': 'Lying',
        straddle: 'Kneeling',
    });

    function create(options) {
        const o = options || {};
        const win = o.win || global;
        let held = null;
        /** The positions taken before this one, for "torna come prima". */
        const history = [];

        const system = () => o.system || (win && win.vrPoseSystem) || null;
        /** NL1. Her standing skeleton, measured when a position is first taken: the reference. */
        let standing = null;
        /** NL1. Which avatar the held position belongs to: a switch releases, never carries over. */
        let heldRoot = null;

        const catalogue = () => {
            try {
                const panel = win && win.NEXUS_POSE_STUDIO_PANEL;
                return panel && typeof panel.catalogue === 'function' ? panel.catalogue() || [] : [];
            } catch (_) {
                return [];
            }
        };

        /** The preset a key stands for: one of POSES, or `preset:<name>` from the catalogue. */
        function entryOf(key) {
            if (POSES[key]) return Object.assign({ category: CATEGORY_OF_KEY[key] || 'Standing' }, POSES[key]);
            if (typeof key !== 'string' || !key.startsWith(PRESET)) return null;
            const name = key.slice(PRESET.length);
            const listed = catalogue().find((p) => p && p.name === name);
            if (!listed || listed.adult) return null;
            const cmd = win && win.NEXUS_POSE_COMMANDS;
            const label = cmd && typeof cmd.shownName === 'function' ? cmd.shownName(listed) : listed.label || name;
            return { preset: name, adult: false, category: listed.category || '', label };
        }

        /**
         * NL1. What the renderer is drawing: hips height and trunk tilt from the bones her mesh
         * is skinned to (`getVisualBone`), never from the preset's own numbers. `null` when the
         * pose system cannot say (a build without it, a test double): the caller then has only
         * the system's word, as before.
         */
        function measure() {
            const vps = system();
            if (!vps || typeof vps.getVisualBone !== 'function') return null;
            try {
                const at = (bone) => {
                    const node = vps.getVisualBone(bone);
                    if (!node || typeof node.getWorldPosition !== 'function') return null;
                    const THREE = win && win.THREE;
                    const v = node.getWorldPosition(THREE ? new THREE.Vector3() : { x: 0, y: 0, z: 0 });
                    return v && Number.isFinite(v.y) ? { x: v.x, y: v.y, z: v.z } : null;
                };
                const hips = at('hips');
                const head = at('head');
                if (!hips || !head) return null;
                const up = head.y - hips.y;
                const flat = Math.hypot(head.x - hips.x, head.z - hips.z);
                const feet = [at('leftFoot'), at('rightFoot')].filter(Boolean);
                const floor = feet.length ? Math.min(...feet.map((f) => f.y)) : 0;
                return {
                    hipsY: Math.round(hips.y * 1000) / 1000,
                    headY: Math.round(head.y * 1000) / 1000,
                    hipsAboveFeet: Math.round((hips.y - floor) * 1000) / 1000,
                    trunkTiltDeg: Math.round((Math.atan2(flat, up) * 180) / Math.PI),
                    root: vps.avatarRoot ? vps.avatarRoot.uuid || null : null,
                };
            } catch (_) {
                return null;
            }
        }

        /**
         * NL1. Is the skeleton the pose system holds the one being drawn? A load that swaps the
         * avatar without telling the pose system leaves it posing the character that just left
         * the scene: every number it reports is true of a skeleton nobody can see (measured:
         * "kneeling, confirmed" over an avatar standing on screen). `null` when the page cannot
         * say (no viewer): then there is no objection.
         */
        function onScreen() {
            try {
                const vps = system();
                const manager = win && win.NEXUS_VIEWER && win.NEXUS_VIEWER.avatarManager;
                const shown = manager && manager.currentRoot;
                if (!vps || !vps.avatarRoot || !shown) return null;
                return vps.avatarRoot === shown;
            } catch (_) {
                return null;
            }
        }

        /** Does `seen` show the kind of position `entry` is? `null` = no objection. */
        function objection(entry, seen) {
            const rule = EXPECT[entry.category];
            if (!rule || !seen || !standing) return null;
            if (rule.hipsBelow && standing.hipsY > 0.2 && seen.hipsY > standing.hipsY * rule.hipsBelow) {
                const tucked =
                    rule.orFeetGap &&
                    standing.hipsAboveFeet > 0.2 &&
                    seen.hipsAboveFeet <= standing.hipsAboveFeet * rule.orFeetGap;
                if (!tucked) return 'hips-still-at-standing-height';
            }
            if (rule.trunkTiltMin && seen.trunkTiltDeg < rule.trunkTiltMin) return 'trunk-still-upright';
            return null;
        }
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
                const entry = entryOf(key);
                if (!entry) return { ok: false, why: 'unknown-pose' };
                if (!entry.preset) return { ok: false, why: 'unsupported-pose' };
                const vps = system();
                if (!vps || typeof vps.applyPreset !== 'function') return { ok: false, why: 'no-pose-system' };
                if (!known(vps, entry.preset)) return { ok: false, why: 'unknown-pose' };
                try {
                    // The reference is her skeleton before the first position of a run: standing.
                    if (!held) standing = measure();
                    heldRoot = vps.avatarRoot || null;
                    enterPoseMode();
                    if (typeof vps.claimBones === 'function') vps.claimBones();
                    // UN36. A routine moves slowly (its own blend); everything else as before.
                    const blend = options && Number(options.duration) > 0 ? Number(options.duration) : 0.6;
                    vps.applyPreset(entry.preset, blend);
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
                heldRoot = null;
                if (!(options && options.keepHistory)) history.length = 0;
                const vps = system();
                call(() => vps && typeof vps.releaseBones === 'function' && vps.releaseBones({ blendSeconds: 0.5 }));
                if (was) exitPoseMode();
                return Boolean(was);
            },
            held() {
                return held;
            },
            /** NL1. `preset:<name>` for a Pose Studio preset asked for by name. */
            presetKey,
            /** NL1. The rendered skeleton right now (`null` when it cannot be read). */
            measure,
            /**
             * UN27. Could this keyed position run right now — is its preset in the runtime's list?
             * The adult presets are listed only while Spicy mode is on, so the model is never
             * offered a position `apply` would refuse as unknown.
             */
            available(key) {
                const entry = POSES[key];
                const vps = system();
                return Boolean(entry && vps && known(vps, entry.preset));
            },
            /** NL1. The preset and category a key stands for, or `null`. */
            describe(key) {
                const entry = entryOf(key);
                // UN27. `body`: what she looks like in it, for the reply (BODY above). Keyed only.
                return entry
                    ? {
                          preset: entry.preset,
                          category: entry.category,
                          label: entry.label || entry.preset,
                          body: BODY[key] || null,
                      }
                    : null;
            },
            /**
             * NL1. The avatar on screen is not the one this position was put on (the person
             * picked another character mid-pose): the hold is dropped, the old skeleton's claim
             * released, and nothing is carried to the new one. Returns whether it let go.
             */
            releaseIfAvatarChanged() {
                const vps = system();
                if (!held || !heldRoot || !vps || !vps.avatarRoot || vps.avatarRoot === heldRoot) return false;
                this.release();
                return true;
            },
            /**
             * UN6. A recognised request or a reported preset name is not proof: wait until the
             * pose system has finished moving her (blend, grounding, hands), then check what it
             * left. `{ok}` or `{ok:false, why:'not-rendered', measured}`. A pose that names its
             * supports must have them on the floor: knees/hips within 10 mm, palms within 20 mm.
             */
            confirm(key, opts) {
                const o = opts || {};
                const entry = entryOf(key);
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
                    if (onScreen() === false)
                        return { ok: false, why: 'not-rendered', measured: { wrong: 'pose-owner-not-on-screen' } };
                    // NL1. The pose system's word, and then the mesh: a preset reported as current
                    // while her rendered hips are still at standing height is not that position.
                    const seen = measure();
                    const wrong = objection(entry, seen);
                    if (wrong) return { ok: false, why: 'not-rendered', measured: { seen, standing, wrong } };
                    return { ok: true, measured: support || null, seen, standing };
                };
                return (async () => {
                    let waited = 0;
                    while (vps && typeof vps.isSettling === 'function' && vps.isSettling() && waited < limit) {
                        await wait(100);
                        waited += 100;
                    }
                    if (vps && typeof vps.isSettling === 'function' && vps.isSettling())
                        return { ok: false, why: 'not-rendered', measured: { settling: true } };
                    const first = check();
                    if (!first.ok || !first.seen || o.stableMs === 0) return first;
                    // NL1. And it stays: a moment later she is still in it. An idle clip or the
                    // procedural animator taking the skeleton back shows here, as a hold that is
                    // gone or hips that have risen again, and is a failure, not a success that
                    // quietly undid itself.
                    await wait(Number.isFinite(o.stableMs) ? o.stableMs : 500);
                    if (held !== key) return { ok: false, why: 'superseded', measured: { held } };
                    const second = check();
                    if (!second.ok) return Object.assign({}, second, { why: 'not-held' });
                    const drift = Math.abs(second.seen.hipsY - first.seen.hipsY);
                    if (drift > 0.05)
                        return { ok: false, why: 'not-held', measured: { first: first.seen, second: second.seen } };
                    return Object.assign({}, second, { stable: true });
                })();
            },
        };
    }

    /**
     * OL3. Her position remembered: what "open" and "close" mean from where she is.
     *
     * A request about her legs is a change to the position she holds, never a new one chosen from
     * the words alone. "Apri le gambe" read on its own was the chair seat, so from lying with her
     * knees up she sprang into a seat in mid-air (reported 2026-11-19). Every relative request
     * goes through this one table, keyed by the position she holds (`null` when standing), so the
     * same word lands differently on her back, kneeling or standing, and asking again where she
     * already is changes nothing. A position missing from a row stays as it is: "open" on her
     * front cannot open anything, and she is not moved somewhere else to obey the word.
     */
    const TRANSITIONS = Object.freeze({
        open: Object.freeze({
            '': 'sit-open', // standing: sit down on the floor, legs open
            'lie-back': 'knees-up',
            'lie-side': 'knees-up',
            'knees-up': 'knees-up',
            kneel: 'kneel-wide',
            'kneel-up': 'kneel-wide',
            'kneel-wide': 'kneel-wide',
            lounge: 'sit-open',
            'sit-open': 'sit-open',
            straddle: 'straddle',
            'all-fours': 'all-fours',
        }),
        close: Object.freeze({
            'knees-up': 'lie-back',
            'kneel-wide': 'kneel',
            'sit-open': 'lounge',
            straddle: 'kneel-up',
        }),
    });

    /** The position `verb` ("open" | "close") takes her to from `held`, or `held` itself. */
    function transition(verb, held) {
        const row = TRANSITIONS[verb];
        if (!row) return held || null;
        const from = held || '';
        return Object.prototype.hasOwnProperty.call(row, from) ? row[from] : held || null;
    }

    const api = { POSES, EXPECT, BODY, INTIMATE, TRANSITIONS, create, presetKey, transition };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_POSES = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
