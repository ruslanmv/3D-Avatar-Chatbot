/**
 * NL1. A position asked for in ordinary conversation: taken by the same controller Pose Studio
 * and Private use, and reported as done only when the renderer shows it.
 *
 * Outside Private there was no way to ask for a held position in words at all: the motion
 * fast path knows "sit down", "lie down" and gestures, which are clips, and every Pose Studio
 * preset was reachable only by opening the panel. A request like "kneel down" went to the
 * model with nothing behind it, and the model said it had.
 *
 * This is not a second pose engine. It owns no bones and knows no presets: it is the request's
 * lifecycle around `NEXUS_PRIVATE_POSES` (PrivatePoseController), the controller that already
 * enters pose mode as the panel does, claims her skeleton, applies the preset and checks what
 * the pose system left. Text typed on the desktop, a spoken command there, and a spoken
 * command in VR all reach it from one place (`MotionIntegration.onUserUtterance`); while
 * Private is running its own bridge keeps the same controller and this stands aside.
 *
 * ## The lifecycle
 *
 *     requested → validated → started → applied → confirmed
 *     requested → blocked | failed | cancelled
 *
 * - `validated`: the preset is in this session's catalogue and the pose system is there.
 * - `started`: pose mode entered, the skeleton claimed, the preset handed to the pose system.
 * - `applied`: the pose system reports that preset as the one it is blending her into.
 * - `confirmed`: it has finished moving her, her rendered skeleton shows that kind of position
 *   (hips, trunk: `PrivatePoseController.confirm`), and half a second later she is still in
 *   it, so an idle clip taking the skeleton back is a failure and not a quiet undo.
 *
 * Nothing may be called done before `confirmed`: `fact()` is what the reply is told, and it
 * says "getting into it" until then and "could not" on a failure. Every request carries its
 * own id, the avatar it was made for and the session it belongs to; a newer request, another
 * avatar or the end of the session cancels the one in flight, and a cancelled request can no
 * longer report anything.
 *
 * Exposes: window.NEXUS_BODY_POSES
 */
(function (global) {
    'use strict';

    const PENDING = ['requested', 'validated', 'started', 'applied'];
    const DONE = ['confirmed', 'failed', 'blocked', 'cancelled'];

    function create(options) {
        const o = options || {};
        const win = o.win || global;
        const now = typeof o.now === 'function' ? o.now : () => Date.now();
        let controller = o.controller || null;
        let seq = 0;
        /** The request in flight or the last one settled. */
        let current = null;
        /** The avatar the held position was put on. */
        let avatarId = null;
        /** The position she was asked to leave by "stand up": what "the previous position" means next. */
        let stoodFrom = null;
        /** Her standing skeleton, as the controller measured it before the first position. */
        let upright = null;

        function poses() {
            if (controller) return controller;
            const make = win && win.NEXUS_PRIVATE_POSES;
            if (make && typeof make.create === 'function') controller = make.create({ win });
            return controller;
        }
        const system = () => (win && win.vrPoseSystem) || null;
        const rootId = () => {
            const vps = system();
            return vps && vps.avatarRoot ? vps.avatarRoot.uuid || 'avatar' : null;
        };
        const privateActive = () => {
            try {
                const pa = win && win.NEXUS_PRIVATE_ACTIONS;
                return Boolean(pa && typeof pa.active === 'function' && pa.active());
            } catch (_) {
                return false;
            }
        };

        function emit(request) {
            try {
                if (typeof o.onChange === 'function') o.onChange(snapshot(request));
                if (win && typeof win.CustomEvent === 'function' && typeof win.dispatchEvent === 'function')
                    win.dispatchEvent(new win.CustomEvent('nexus-body:pose', { detail: snapshot(request) }));
            } catch (_) {
                /* a listener that throws must not stop her body */
            }
        }

        function snapshot(request) {
            if (!request) return null;
            return {
                id: request.id,
                avatarId: request.avatarId,
                sessionId: request.sessionId,
                kind: request.kind,
                preset: request.preset || null,
                label: request.label || '',
                said: request.said || '',
                options: request.options || null,
                state: request.state,
                why: request.why || null,
                at: request.at,
                settledAt: request.settledAt || null,
                seen: request.seen || null,
                history: request.history.slice(),
                key: request.key || null,
            };
        }

        function move(request, state, extra) {
            // A request that was cancelled reports nothing more, whatever comes back for it later.
            if (DONE.includes(request.state)) return request;
            request.state = state;
            Object.assign(request, extra || {});
            request.history.push(state);
            if (DONE.includes(state)) request.settledAt = now();
            emit(request);
            return request;
        }

        /** The request in flight, if it is still pending, is over: something newer owns her. */
        function cancelPending(why) {
            if (current && PENDING.includes(current.state)) move(current, 'cancelled', { why: why || 'superseded' });
        }

        /**
         * @param {object} found  what `NEXUS_POSE_COMMANDS.resolve` returned
         * @param {object} [meta]  `{text, source, sessionId}`
         * @returns {Promise<object>} the request's final snapshot
         */
        async function request(found, meta) {
            const m = meta || {};
            cancelPending('superseded');
            seq += 1;
            const req = {
                id: `pose-${now().toString(36)}-${seq}`,
                avatarId: rootId(),
                sessionId: m.sessionId || null,
                source: m.source || 'user',
                kind: found && found.kind,
                preset: (found && found.preset) || null,
                label: (found && found.label) || '',
                said: (found && found.said) || '',
                options: (found && found.options) || null,
                state: 'requested',
                why: null,
                at: now(),
                history: ['requested'],
            };
            current = req;
            emit(req);
            const mine = () => current === req && !DONE.includes(req.state);

            if (privateActive()) return snapshot(move(req, 'blocked', { why: 'private-owns-body' }));
            if (!found) return snapshot(move(req, 'failed', { why: 'unsupported-pose' }));
            if (found.kind === 'unknown-position') return snapshot(move(req, 'failed', { why: 'unsupported-pose' }));
            if (found.kind === 'ambiguous') return snapshot(move(req, 'failed', { why: 'ambiguous-pose' }));
            const ctl = poses();
            if (!ctl || !system()) return snapshot(move(req, 'failed', { why: 'no-pose-system' }));

            /** Let go, wait for her to be up again, and say so only if her hips are back up. */
            const stand = async () => {
                const was = ctl.held();
                if (was) stoodFrom = was;
                ctl.release();
                avatarId = null;
                move(req, 'applied', { label: 'standing' });
                if (!was) return snapshot(move(req, 'confirmed', { already: true }));
                const seen = await settled(ctl);
                if (!mine()) return snapshot(req);
                if (seen && upright && upright.hipsY > 0.2 && seen.hipsY < upright.hipsY * 0.85)
                    return snapshot(move(req, 'failed', { why: 'not-rendered', seen }));
                return snapshot(move(req, 'confirmed', { seen }));
            };

            if (found.kind === 'stand') {
                move(req, 'validated', { label: 'standing' });
                move(req, 'started');
                return stand();
            }

            let key;
            if (found.kind === 'previous' && !ctl.held() && stoodFrom) {
                // "Kneel." "Stand up." "Go back to the previous position." is kneeling again.
                key = stoodFrom;
                stoodFrom = null;
                const named = typeof ctl.describe === 'function' ? ctl.describe(key) : null;
                if (!named) return snapshot(move(req, 'failed', { why: 'unknown-pose' }));
                move(req, 'validated', { preset: named.preset, label: named.label });
                move(req, 'started');
                const out = ctl.apply(key);
                if (!out.ok) return snapshot(move(req, 'failed', { why: out.why || 'pose-failed' }));
                avatarId = req.avatarId;
                move(req, 'applied');
            } else if (found.kind === 'previous') {
                move(req, 'validated', { label: 'previous position' });
                move(req, 'started');
                const leaving = ctl.held();
                const back = ctl.back();
                if (!back.ok) return snapshot(move(req, 'failed', { why: back.why || 'pose-failed' }));
                if (back.pose === 'stand') {
                    if (leaving) stoodFrom = leaving;
                    avatarId = null;
                    move(req, 'applied', { label: 'standing' });
                    if (!leaving) return snapshot(move(req, 'confirmed', { already: true }));
                    const seen = await settled(ctl);
                    if (!mine()) return snapshot(req);
                    return snapshot(move(req, 'confirmed', { seen }));
                }
                key = back.pose;
                const named = typeof ctl.describe === 'function' ? ctl.describe(key) : null;
                move(req, 'applied', { preset: named && named.preset, label: (named && named.label) || key });
            } else {
                key = ctl.presetKey ? ctl.presetKey(found.preset) : `preset:${found.preset}`;
                if (typeof ctl.describe === 'function' && !ctl.describe(key))
                    return snapshot(move(req, 'failed', { why: 'unknown-pose' }));
                move(req, 'validated');
                move(req, 'started');
                const out = ctl.apply(key);
                if (!out.ok) return snapshot(move(req, 'failed', { why: out.why || 'pose-failed' }));
                avatarId = req.avatarId;
                move(req, 'applied');
            }

            req.key = key;
            const seen = await ctl.confirm(key, o.confirm);
            if (seen && seen.standing) upright = seen.standing;
            if (!mine()) return snapshot(req);
            if (rootId() !== req.avatarId) return snapshot(move(req, 'cancelled', { why: 'avatar-changed' }));
            if (seen && seen.ok) return snapshot(move(req, 'confirmed', { seen: seen.seen || null }));
            if (seen && seen.why === 'superseded') return snapshot(move(req, 'cancelled', { why: 'superseded' }));
            // It did not land: she goes back to what she held before (or stands), and it is said.
            try {
                ctl.back();
                if (!ctl.held()) avatarId = null;
            } catch (_) {
                /* she keeps whatever she shows; the failure is still reported */
            }
            return snapshot(
                move(req, 'failed', { why: (seen && seen.why) || 'not-rendered', measured: seen && seen.measured })
            );
        }

        /** After a release: wait for the pose system to stop moving her, then read her skeleton. */
        async function settled(ctl) {
            const vps = system();
            const wait =
                typeof o.wait === 'function'
                    ? o.wait
                    : (ms) => new Promise((r) => (win.setTimeout || setTimeout)(r, ms));
            const read = () => (typeof ctl.measure === 'function' ? ctl.measure() : null);
            const up = (seen) => !seen || !upright || !(upright.hipsY > 0.2) || seen.hipsY >= upright.hipsY * 0.85;
            let waited = 0;
            // The release blends her back; she is up when the pose system has stopped moving
            // her and her rendered hips are back near where they were before the first position.
            while (waited < 4000) {
                const moving = vps && typeof vps.isSettling === 'function' && vps.isSettling();
                if (!moving && waited >= 300 && up(read())) break;
                await wait(100);
                waited += 100;
            }
            return read();
        }

        /** Let go of a held position (an animation was asked for, the session ended). */
        function release(why) {
            cancelPending(why || 'released');
            const ctl = controller;
            const key = ctl && ctl.held();
            if (key) {
                stoodFrom = key;
                ctl.release();
            }
            avatarId = null;
            return Boolean(key);
        }

        /** The avatar on screen changed: a position held on the old one is not carried over. */
        function onAvatarChanged() {
            const id = rootId();
            if (current && PENDING.includes(current.state) && current.avatarId !== id)
                move(current, 'cancelled', { why: 'avatar-changed' });
            if (controller && controller.held() && avatarId && avatarId !== id) {
                if (typeof controller.releaseIfAvatarChanged === 'function') controller.releaseIfAvatarChanged();
                if (controller.held()) controller.release();
                avatarId = null;
            }
            // Nothing measured or remembered on the old skeleton describes the new one.
            if (avatarId !== id) {
                stoodFrom = null;
                upright = null;
            }
        }

        /**
         * One sentence for the reply's prompt: what her body is doing about the last request.
         * `''` when there is nothing to say. English, like the rest of the body contract.
         */
        function fact() {
            const r = current;
            // Only a hold the pose system still has: Pose Studio closing its panel lets go of the
            // skeleton without telling anyone, and "you are holding …" would then be a fiction.
            const vps = system();
            const gripped = !vps || typeof vps.isHoldingBones !== 'function' || vps.isHoldingBones();
            const held = gripped && controller && controller.held && controller.held();
            const named = held && controller.describe ? controller.describe(held) : null;
            const holding = named ? `You are holding the position "${named.label}" (${named.category || 'pose'}).` : '';
            // A request's outcome is news for the turn it was made in. On the turns after it the
            // reply is told only what is still true: the position she holds, if any. (Measured:
            // "ask which one" from an unanswered question was still being told three turns
            // later, under "dance for me".)
            if (!r || r.told) return holding;
            const age = now() - (r.settledAt || r.at);
            if (PENDING.includes(r.state))
                return `They asked for the position "${r.label || r.said}" and you are moving into it right now; it is not confirmed on screen yet. Say you are getting into it, in a few words. Do not say it is done.`;
            if (age > 90000) return holding;
            if (r.state === 'confirmed' && r.label === 'standing') return 'You are standing again, as they asked.';
            // Confirmed, and then let go of for an animation or by the studio: no longer a fact.
            if (r.state === 'confirmed' && held !== r.key) return holding;
            if (r.state === 'confirmed')
                return `Your body is in the position they asked for ("${r.label}"), confirmed on screen. Stay in it until they ask you to stand or to change.`;
            if (r.state === 'failed' && r.why === 'ambiguous-pose')
                return `They named a position that could be more than one of yours (${(r.options || []).map((x) => x.label).join(' / ')}). You have not moved. Ask which one, in a few words.`;
            if (r.state === 'failed' && r.why === 'unsupported-pose')
                return `They asked for a position your body cannot take here ("${r.said}"). You have not moved. Say plainly that you can't take that one; never say you are in it.`;
            if (r.state === 'failed')
                return `You tried to take the position "${r.label || r.said}" and it did not show on your body: you are still as you were. Say plainly that you could not; never say you are in it.`;
            return holding;
        }

        /** A new turn began: a settled request stops being news. One still in flight is not. */
        function turnOver() {
            if (current && DONE.includes(current.state)) current.told = true;
        }

        return {
            request,
            turnOver,
            release,
            onAvatarChanged,
            fact,
            held: () => (controller && controller.held ? controller.held() : null),
            /** Is there a position "the previous position" can mean right now? */
            canGoBack: () => Boolean(stoodFrom || (controller && controller.held && controller.held())),
            current: () => snapshot(current),
            measure: () => (poses() && poses().measure ? poses().measure() : null),
        };
    }

    const api = { create, PENDING, DONE };
    if (global && typeof global.window !== 'undefined') {
        const service = create({ win: global });
        Object.assign(api, service);
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_BODY_POSES = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
