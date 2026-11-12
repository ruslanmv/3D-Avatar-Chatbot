/**
 * The only door a Private action goes through (SAE).
 *
 * A model can propose a song or a dress. It cannot decide that the proposal is
 * allowed, and it cannot decide that the proposal worked. This bridge checks the
 * live session, asks the policy, and runs the one controller that owns that kind
 * of action. The same request id inside a few seconds returns the first result,
 * so a user sentence and the reply's tag do not start two players or two jobs.
 *
 * An action that outlives the session is dropped. The check runs again after the
 * await, because a search or a Forge job finishes later than the person who
 * pressed End.
 *
 * Exposes: window.NEXUS_PRIVATE_ACTION_BRIDGE
 */
(function (global) {
    'use strict';

    var REPLAY_MS = 8000;
    var epoch = 0;
    var inflight = new Map();
    var done = new Map();

    function pick(name) {
        return global && global[name] ? global[name] : null;
    }

    function policyApi() {
        return pick('NEXUS_PRIVATE_ACTION_POLICY');
    }

    function currentSession() {
        var capability = pick('NEXUS_TOGETHER_CAPABILITY');
        try {
            if (capability && typeof capability.privateSessionSnapshot === 'function') {
                return capability.privateSessionSnapshot();
            }
        } catch (_) {
            return null;
        }
        return null;
    }

    function sessionStill(sessionId) {
        var session = currentSession();
        if (!session || session.stopped) return false;
        if (sessionId && session.id && session.id !== sessionId) return false;
        return true;
    }

    function granted(kind) {
        var capability = pick('NEXUS_TOGETHER_CAPABILITY');
        try {
            if (capability && typeof capability.privateActionAllowed === 'function') {
                return capability.privateActionAllowed(kind) === true;
            }
        } catch (_) {
            return false;
        }
        return false;
    }

    function requestId(request) {
        if (request && request.id) return String(request.id);
        var args = (request && request.args) || {};
        var key = [
            request && request.kind,
            args.query || args.outfit || args.look || args.occasion || args.prompt || '',
        ]
            .join('|')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
        return key || 'action';
    }

    function resultOf(ok, status, reason, extra) {
        var out = { ok: Boolean(ok), status: status, reason: reason || '' };
        if (extra) {
            Object.keys(extra).forEach(function (key) {
                out[key] = extra[key];
            });
        }
        return out;
    }

    async function dispatch(request) {
        var kind = request.kind || '';
        if (kind.indexOf('music.') === 0) {
            var media = pick('NEXUS_PRIVATE_MEDIA');
            if (!media || typeof media.execute !== 'function') return resultOf(false, 'failed', 'no-player');
            return (await media.execute(request)) || resultOf(false, 'failed', 'no-player');
        }
        if (kind.indexOf('wardrobe.') === 0) {
            var scene = pick('NEXUS_IN_SCENE_WARDROBE');
            if (!scene || typeof scene.execute !== 'function') return resultOf(false, 'failed', 'no-wardrobe');
            var name =
                kind === 'wardrobe.undo'
                    ? 'wardrobe_undo'
                    : kind === 'wardrobe.create'
                      ? 'wardrobe_create'
                      : 'wardrobe_wear';
            return (
                (await scene.execute(name, request.args || {}, {
                    source: request.source,
                    sessionId: request.sessionId,
                    requestId: request.id,
                })) || resultOf(false, 'failed', 'no-wardrobe')
            );
        }
        return resultOf(false, 'blocked', 'not-in-session-action');
    }

    async function execute(request) {
        var req = request || {};
        var session = currentSession();
        if (!session) return resultOf(false, 'blocked', 'stale-session');
        req.sessionId = req.sessionId || session.id;
        req.source = req.source === 'user' ? 'user' : 'assistant';
        req.id = requestId(req);
        var policy = policyApi();
        var decision = { ok: false, reason: 'not-authorized' };
        try {
            decision =
                policy && typeof policy.authorize === 'function'
                    ? policy.authorize(req, session, {
                          musicGranted: granted('music'),
                          wardrobeGranted: granted('wardrobe'),
                      })
                    : decision;
        } catch (_) {
            decision = { ok: false, reason: 'not-authorized' };
        }
        if (!decision.ok) return resultOf(false, 'blocked', decision.reason || 'not-authorized');
        if (decision.effect === 'none') return resultOf(true, 'completed', 'offer-only');
        var cached = done.get(req.id);
        if (cached && cached.ok && Date.now() - cached.at < REPLAY_MS) return cached.result;
        if (inflight.has(req.id)) return inflight.get(req.id);
        var stamp = epoch;
        var job = (async function () {
            var result = await dispatch(req);
            if (stamp !== epoch || !sessionStill(req.sessionId)) {
                return resultOf(false, 'blocked', 'session-ended');
            }
            if (result && result.ok) done.set(req.id, { at: Date.now(), ok: true, result: result });
            return result || resultOf(false, 'failed', 'failed');
        })();
        inflight.set(req.id, job);
        try {
            return await job;
        } finally {
            inflight.delete(req.id);
        }
    }

    /** Drop anything still in flight for this session. A later result must not apply. */
    function cancel(sessionId) {
        epoch += 1;
        inflight.clear();
        done.clear();
        return { ok: true, status: 'completed', reason: sessionId ? 'cancelled' : 'cancelled' };
    }

    function reset() {
        cancel();
        epoch = 0;
    }

    var api = {
        REPLAY_MS: REPLAY_MS,
        execute: execute,
        cancel: cancel,
        reset: reset,
        currentSession: currentSession,
        sessionStill: sessionStill,
        requestId: requestId,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_ACTION_BRIDGE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
