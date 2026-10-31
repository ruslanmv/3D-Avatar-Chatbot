/**
 * PuppetSkeleton — VP1. What the VR puppet moves is what she does.
 *
 * The person reported it plainly: in VR, with puppet mode on (the default), grabbing her hand moved
 * the sphere and nothing else. Measured in an emulated Quest 3, dragging her left-foot sphere 26 cm
 * moved the pose system's foot bone 0.261 m and the bone that skins her mesh 0.000 m.
 *
 * Why. three-vrm 2.x gives every VRM two skeletons. The *raw* bones skin the mesh. The *normalized*
 * rig is a proxy with identity rest rotations, and `vrm.update()` copies it onto the raw bones —
 * but only while `humanoid.autoUpdateHumanBones` is true. This app keeps it false on purpose: the
 * idle animator (ProceduralAnimator: breathing, weight shift, base pose) writes the raw bones
 * directly, and a copy from the proxy every frame would erase that. VRPoseSystem, on the other
 * hand, resolves its bones through PoseRigMap, which hands out the *normalized* ones — so every IK
 * drag, every direct bone grab and every pose the VR panel chose was written to a skeleton nobody
 * draws. Pose Studio and the desktop pose dropdown get away with it because they switch the
 * animator into pose mode and turn the copy on first; nothing in VR ever did. The spheres sit on
 * the proxy rig, so they moved — and even at rest they floated ~6 cm off her visible body, because
 * the animator's sway moves the raw skeleton and not the proxy.
 *
 * What this does, in the three moments that matter:
 *
 *   claim    The person takes hold of her (an IK drag, a bone grab, a pose chosen in VR). Her
 *            visible pose is carried INTO the proxy rig first — the exact inverse of three-vrm's
 *            own copy — so the hand they grabbed is where they saw it and nothing pops. Then the
 *            animator yields (pose mode) and the copy is turned on. Anything that would fight
 *            the hand (a clip, the animation resolver) is stopped. Everything changed is
 *            snapshotted first.
 *   sync     Every frame she is held, the proxy is copied onto her skeleton right after the
 *            pose system has solved — so the mesh shows this frame's IK, not last frame's, and
 *            a behaviour mode (talk, think) that the animator still runs in pose mode cannot
 *            take her body away from the person's hand.
 *   release  Reset, Place mode off, or leaving VR. The snapshot is written back verbatim (both
 *            skeletons, the copy flag, the animator's modes) and, in the headset, her pose is
 *            blended into whatever her idle animation produces over a fraction of a second
 *            instead of snapping.
 *
 * Between a claim and a release she keeps the pose she was given — VaM-style posing, which is what
 * "play with her" means for a VR companion. Her face, lips and eyes are expressions and keep
 * running; the idle body motion pauses because the pose is the person's choice.
 *
 * three-vrm keeps the rig and the rest rotations its copy maps through on fields that are private
 * by convention (`_normalizedHumanBones`, `_parentWorldRotations`, `_boneRotations`; read from
 * 2.1.0). If a future version moves them, carry-over is skipped with a warning — the pose pops
 * once on the first grab — and sync falls back to the public `humanoid.update()`, so the drag
 * itself keeps working.
 *
 * IIFE with the dual export: VRPoseSystem imports this file for its side effect and reads
 * window.NEXUS_PUPPET_SKELETON; tests/puppet-skeleton.test.js requires it and runs it against the
 * vendored three.js and a rig built the way three-vrm builds one.
 */
(function (global) {
    'use strict';

    /** The normalized rig and what its copy needs, or null if this three-vrm keeps them elsewhere. */
    function rigOf(humanoid) {
        const rig = humanoid && humanoid._normalizedHumanBones;
        if (
            !rig ||
            typeof rig.update !== 'function' ||
            typeof rig.getBoneNode !== 'function' ||
            !rig.original ||
            typeof rig.original.getBoneNode !== 'function' ||
            !rig._parentWorldRotations ||
            !rig._boneRotations
        ) {
            return null;
        }
        return rig;
    }

    /** Every human bone the copy touches, as { name, raw, norm } — the set three-vrm iterates. */
    function pairsOf(humanoid) {
        const rig = rigOf(humanoid);
        const out = [];
        if (rig) {
            for (const name of Object.keys(rig._boneRotations)) {
                const raw = rig.original.getBoneNode(name);
                const norm = rig.getBoneNode(name);
                if (raw && norm) out.push({ name, raw, norm });
            }
            return out;
        }
        if (humanoid && typeof humanoid.getRawBoneNode === 'function') {
            for (const name of Object.keys(humanoid.humanBones || {})) {
                const raw = humanoid.getRawBoneNode(name);
                const norm =
                    typeof humanoid.getNormalizedBoneNode === 'function' ? humanoid.getNormalizedBoneNode(name) : null;
                if (raw) out.push({ name, raw, norm });
            }
        }
        return out;
    }

    /**
     * Put her visible pose into the proxy rig. three-vrm's copy is raw = P⁻¹·N·P·B (P the parent's
     * world rotation at rest, B the bone's rest rotation), so the proxy that reproduces a raw pose
     * is N = P·raw·B⁻¹·P⁻¹. The hips also carry the body's position: the copy puts the raw hips at
     * the proxy hips' world position, so the proxy hips go to the raw hips' world position.
     * Returns how many bones were carried; 0 when the rig's internals are not reachable.
     */
    function carryOver(humanoid) {
        const rig = rigOf(humanoid);
        if (!rig) return 0;
        let carried = 0;
        for (const name of Object.keys(rig._boneRotations)) {
            const raw = rig.original.getBoneNode(name);
            const norm = rig.getBoneNode(name);
            const P = rig._parentWorldRotations[name];
            const B = rig._boneRotations[name];
            if (!raw || !norm || !P || !B) continue;
            const invB = B.clone().invert();
            const invP = P.clone().invert();
            norm.quaternion.copy(P).multiply(raw.quaternion).multiply(invB).multiply(invP);
            carried += 1;
        }
        const rawHips = rig.original.getBoneNode('hips');
        const normHips = rig.getBoneNode('hips');
        if (rawHips && normHips && normHips.parent) {
            const world = rawHips.getWorldPosition(normHips.position.clone());
            normHips.parent.updateWorldMatrix(true, false);
            normHips.position.copy(normHips.parent.worldToLocal(world));
        }
        return carried;
    }

    /** Copy the proxy onto her skeleton now, whatever the auto-update flag says. */
    function sync(humanoid) {
        const rig = rigOf(humanoid);
        if (rig) {
            rig.update();
            return true;
        }
        if (humanoid && typeof humanoid.update === 'function' && 'autoUpdateHumanBones' in humanoid) {
            const was = humanoid.autoUpdateHumanBones;
            humanoid.autoUpdateHumanBones = true;
            try {
                humanoid.update();
            } finally {
                humanoid.autoUpdateHumanBones = was;
            }
            return true;
        }
        return false;
    }

    /** Snapshot of every node the claim may change: both skeletons' human bones plus `extra`. */
    function capture(humanoid, extra) {
        const seen = new Set();
        const items = [];
        const add = (node) => {
            if (!node || !node.quaternion || !node.position || seen.has(node)) return;
            seen.add(node);
            items.push({ node, q: node.quaternion.clone(), p: node.position.clone() });
        };
        for (const pair of pairsOf(humanoid)) {
            add(pair.raw);
            add(pair.norm);
        }
        for (const node of extra || []) add(node);
        return items;
    }

    function restore(items) {
        for (const item of items) {
            item.node.quaternion.copy(item.q);
            item.node.position.copy(item.p);
        }
    }

    /** The nodes she is drawn with: raw human bones for a VRM, the pose system's bones otherwise. */
    function visibleNodes(humanoid, bones) {
        const pairs = pairsOf(humanoid);
        if (pairs.length) return pairs.map((pair) => pair.raw);
        return (bones || []).filter((node) => node && node.quaternion && node.position);
    }

    const smoothstep = (t) => t * t * (3 - 2 * t);

    /**
     * The ownership state machine. `deps` are getters, read at the moment of use, so a module that
     * loads late still counts: { animator(), clips(), resolver(), warn(msg, err) }.
     */
    function create(deps) {
        const d = deps || {};
        const get = (name) => {
            try {
                return typeof d[name] === 'function' ? d[name]() : null;
            } catch (_) {
                return null;
            }
        };
        const warn = (msg, err) => {
            if (typeof d.warn === 'function') d.warn(msg, err);
        };

        let claim = null;
        let blend = null;
        let warnedCarry = false;

        function claimBones(opts) {
            const o = opts || {};
            if (claim) return false;
            blend = null; // a release still settling is superseded: the person took her again
            const humanoid = o.humanoid || null;
            const animator = get('animator');
            claim = {
                humanoid,
                bones: o.bones || [],
                pose: capture(humanoid, o.bones),
                autoUpdate: humanoid && 'autoUpdateHumanBones' in humanoid ? humanoid.autoUpdateHumanBones : undefined,
                poseMode: !!(animator && typeof animator.isPoseMode === 'function' && animator.isPoseMode()),
                editMode: !!(animator && typeof animator.isEditMode === 'function' && animator.isEditMode()),
            };

            // Nothing else may move her while she is held — but only stop what is actually playing:
            // both stops also reset the idle animator's mixer permission, and the resolver's
            // turns it off, which would outlive the release. Fail soft: a clip that will not stop
            // is a body that fights the hand for a moment, not a reason to refuse the grab.
            try {
                const clips = get('clips');
                const state =
                    clips && typeof clips.getCurrentPlaybackState === 'function'
                        ? clips.getCurrentPlaybackState()
                        : null;
                if (state && state.isPlaying && typeof clips.stopClip === 'function') {
                    clips.stopClip({ fadeOut: 0.25 });
                }
            } catch (err) {
                warn('could not stop the playing clip', err);
            }
            try {
                const resolver = get('resolver');
                const state =
                    resolver && typeof resolver.getCurrentState === 'function' ? resolver.getCurrentState() : null;
                if (state && state.clipPlaying && typeof resolver.stop === 'function') {
                    Promise.resolve(resolver.stop()).catch((err) => warn('the animation resolver did not stop', err));
                }
            } catch (err) {
                warn('could not stop the animation resolver', err);
            }

            if (humanoid) {
                const carried = carryOver(humanoid);
                if (!carried && pairsOf(humanoid).length && !warnedCarry) {
                    warnedCarry = true;
                    warn('this three-vrm keeps its normalized rig elsewhere; her pose will jump once on grab');
                }
                if ('autoUpdateHumanBones' in humanoid) humanoid.autoUpdateHumanBones = true;
            }
            try {
                if (animator && typeof animator.setPoseMode === 'function') animator.setPoseMode(true);
            } catch (err) {
                warn('the idle animator would not yield', err);
            }
            if (humanoid) sync(humanoid);
            return true;
        }

        function releaseBones(opts) {
            if (!claim) return false;
            const c = claim;
            claim = null;
            const seconds = Math.max(0, Number((opts && opts.blendSeconds) || 0));
            const nodes = visibleNodes(c.humanoid, c.bones);
            const held = nodes.map((node) => ({ node, q: node.quaternion.clone(), p: node.position.clone() }));

            restore(c.pose);
            if (c.humanoid && c.autoUpdate !== undefined) c.humanoid.autoUpdateHumanBones = c.autoUpdate;
            const animator = get('animator');
            try {
                if (animator) {
                    if (c.poseMode) {
                        if (typeof animator.setPoseMode === 'function') animator.setPoseMode(true);
                    } else {
                        if (typeof animator.setPoseMode === 'function') animator.setPoseMode(false);
                        // setPoseMode(true) also switched edit mode on, and setPoseMode(false) leaves
                        // it on — an animator left in edit mode never moves her again.
                        if (typeof animator.setEditMode === 'function') animator.setEditMode(c.editMode);
                    }
                }
            } catch (err) {
                warn('the idle animator could not be handed back', err);
            }

            if (seconds > 0 && held.length) {
                blend = {
                    t: 0,
                    duration: seconds,
                    items: held.map((h) => {
                        // Target to start with: the pre-claim pose just restored. Then show the held
                        // pose for this frame; the blend walks from it.
                        const item = {
                            node: h.node,
                            fromQ: h.q,
                            fromP: h.p,
                            toQ: h.node.quaternion.clone(),
                            toP: h.node.position.clone(),
                            wroteQ: h.q.clone(),
                            wroteP: h.p.clone(),
                        };
                        h.node.quaternion.copy(h.q);
                        h.node.position.copy(h.p);
                        return item;
                    }),
                };
            } else {
                blend = null;
            }
            return true;
        }

        /**
         * One release-blend step. Call AFTER her animator has written this frame. A bone somebody
         * wrote since our last step has a fresh target; a bone nobody touched keeps its previous
         * one — so bones the animator never drives settle on the restored snapshot instead of
         * creeping back towards the held pose.
         */
        function update(dt) {
            if (!blend) return false;
            blend.t += Math.max(0, Number(dt) || 0);
            const k = smoothstep(Math.min(1, blend.t / blend.duration));
            for (const it of blend.items) {
                const n = it.node;
                if (!n.quaternion.equals(it.wroteQ)) it.toQ.copy(n.quaternion);
                if (!n.position.equals(it.wroteP)) it.toP.copy(n.position);
                n.quaternion.copy(it.fromQ).slerp(it.toQ, k);
                n.position.copy(it.fromP).lerp(it.toP, k);
                it.wroteQ.copy(n.quaternion);
                it.wroteP.copy(n.position);
            }
            if (k >= 1) blend = null;
            return true;
        }

        return {
            claim: claimBones,
            release: releaseBones,
            /** While held: the proxy onto her skeleton, now. */
            sync: () => (claim && claim.humanoid ? sync(claim.humanoid) : false),
            update,
            isClaimed: () => !!claim,
            isBlending: () => !!blend,
            /** The avatar went away: drop everything that points at her bones, restore nothing. */
            forget: () => {
                claim = null;
                blend = null;
            },
        };
    }

    const api = { rigOf, pairsOf, carryOver, sync, capture, restore, visibleNodes, create };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PUPPET_SKELETON = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
