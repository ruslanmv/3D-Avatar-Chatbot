/**
 * Dress her where she already is (SAE).
 *
 * Try-On Haul is a whole activity: it opens a panel, takes the conversation, and
 * walks a sequence of looks. A sentence during Private — "put on something
 * elegant" — is not a request to leave the evening. This module wears a look
 * through the same wardrobe service and controller the haul uses, and it never
 * starts that activity.
 *
 * The look is announced only after the controller accepts it. A Forge job that
 * finishes after Private has ended does not touch the avatar: the session is
 * read again immediately before the swap, and a newer request cancels the older
 * one so two loads cannot cross. Whole-model replacement is the swap Forge looks
 * already are; a separate garment mesh is not invented here, because these looks
 * are complete VRMs and the controller is what keeps the camera and the pose.
 *
 * Exposes: window.NEXUS_IN_SCENE_WARDROBE
 */
(function (global) {
    'use strict';

    var job = 0;
    var tail = Promise.resolve();
    var previous = null;
    var recent = [];

    function pick(name) {
        return global && global[name] ? global[name] : null;
    }

    function policyApi(deps) {
        return (deps && deps.policy) || pick('NEXUS_PRIVATE_ACTION_POLICY');
    }

    function sessionOf(deps) {
        if (deps && deps.session) return deps.session;
        var bridge = pick('NEXUS_PRIVATE_ACTION_BRIDGE');
        try {
            if (bridge && typeof bridge.currentSession === 'function') return bridge.currentSession();
        } catch (_) {
            /* fall through */
        }
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

    function still(deps, sessionId) {
        if (deps && typeof deps.still === 'function') {
            try {
                return deps.still(sessionId) !== false;
            } catch (_) {
                return false;
            }
        }
        var session = sessionOf(deps);
        if (!session || session.stopped) return false;
        if (sessionId && session.id && session.id !== sessionId) return false;
        return true;
    }

    function enqueue(fn) {
        var run = tail.then(fn, fn);
        tail = run.then(
            function () {},
            function () {}
        );
        return run;
    }

    function kindOf(name) {
        if (name === 'wardrobe_undo' || name === 'undo') return 'wardrobe.undo';
        if (name === 'wardrobe_create' || name === 'create' || name === 'wardrobe_change' || name === 'change') {
            return 'wardrobe.create';
        }
        if (name === 'wardrobe_wear' || name === 'wear') return 'wardrobe.wear';
        return null;
    }

    function textOf(value) {
        return String(value == null ? '' : value)
            .trim()
            .toLowerCase();
    }

    /**
     * Rank looks for an occasion. Saved looks that can be worn now sort ahead of
     * a dictionary entry that still has to be made, and anything worn a moment
     * ago sorts last so she does not repeat herself.
     */
    function rankLooks(candidates, options) {
        var opts = options || {};
        var occasion = opts.occasion || null;
        var groups =
            occasion === 'elegant'
                ? ['dressy', 'smart', 'discoteca']
                : occasion === 'comfortable'
                  ? ['cozy', 'casual']
                  : occasion === 'evening'
                    ? ['discoteca', 'dressy', 'smart']
                    : [];
        var seen = Array.isArray(opts.recent) ? opts.recent : recent;
        return (Array.isArray(candidates) ? candidates : [])
            .map(function (look, index) {
                var group = textOf(look && (look.group || ''));
                var name = textOf(look && (look.name || look.title || look.id || ''));
                var score = 0;
                groups.forEach(function (entry, at) {
                    if (group === entry || name.indexOf(entry) !== -1) score += 40 - at;
                });
                if (occasion === 'elegant' && /dress|abito|gown|elegan|satin/.test(name)) score += 15;
                if (occasion === 'comfortable' && /cozy|comf|home|knit|maglia|casa/.test(name)) score += 15;
                if (occasion === 'evening' && /night|sera|black|disco/.test(name)) score += 15;
                var id = String((look && (look.id || look.name)) || '');
                if (seen.indexOf(id) !== -1) score -= 25;
                if (look && (look.vrmUrl || look.vrm_url)) score += 8;
                return { look: look, score: score, index: index };
            })
            .sort(function (a, b) {
                return b.score - a.score || a.index - b.index;
            })
            .map(function (row) {
                return row.look;
            });
    }

    async function savedLooks(deps) {
        if (deps && Array.isArray(deps.looks)) return deps.looks.slice();
        var service = (deps && deps.service) || (pick('NEXUS_WARDROBE') && pick('NEXUS_WARDROBE').service) || null;
        try {
            if (service && typeof service.listLooks === 'function') return (await service.listLooks()) || [];
        } catch (_) {
            return [];
        }
        return [];
    }

    function dictionaryEntries(deps) {
        if (deps && Array.isArray(deps.entries)) return deps.entries.slice();
        var dict = (deps && deps.dictionary) || pick('NEXUS_OUTFIT_DICTIONARY');
        var page = dict && typeof dict.forPage === 'function' ? dict.forPage() : dict;
        try {
            if (page && typeof page.entries === 'function') {
                var open = Boolean(deps && deps.eligibility && deps.eligibility.mode === 'open');
                return page.entries({ privateOpen: open }) || [];
            }
        } catch (_) {
            return [];
        }
        return [];
    }

    function sameIdentity(look, wanted) {
        var id = textOf(wanted);
        if (!id || !look) return false;
        return (
            textOf(look.id) === id ||
            textOf(look.name) === id ||
            textOf(look.title) === id ||
            textOf(look.outfit) === id
        );
    }

    function belongsToAvatar(look, controller) {
        if (!look || !look.avatarId) return true;
        var avatar = controller && (controller.avatarId || (controller.original && controller.original.name));
        if (!avatar) return true;
        return String(look.avatarId) === String(avatar);
    }

    function viewOf(deps) {
        if (deps && deps.view) return deps.view;
        var session = sessionOf(deps);
        return session && session.view;
    }

    function phrase(key, fallback) {
        var locale = pick('NEXUS_PRIVATE_LOCALE');
        try {
            if (locale && typeof locale.t === 'function') {
                var said = locale.t(key);
                if (said && said !== key) return said;
            }
        } catch (_) {
            /* the fallback is the sentence */
        }
        return fallback;
    }

    function show(deps, fields) {
        var view = viewOf(deps);
        if (!view || typeof view.showSeamlessStatus !== 'function') return;
        try {
            view.showSeamlessStatus(fields);
        } catch (_) {
            /* the swap matters more than the line that names it */
        }
    }

    function blocked(reason, why) {
        return { ok: false, status: 'blocked', reason: reason, why: why || reason };
    }

    async function resolveLook(args, deps, allowGenerate) {
        var looks = await savedLooks(deps);
        var entries = dictionaryEntries(deps);
        var wanted = args.outfit || args.look || args.name || '';
        var pool = looks.concat(entries);
        if (wanted && !args.choose) {
            var found = null;
            pool.forEach(function (look) {
                if (!found && sameIdentity(look, wanted)) found = look;
            });
            return found;
        }
        var occasion = args.occasion || null;
        if (!occasion && args.said) {
            var policy = policyApi(deps);
            var parsed = policy && policy.wardrobeRequest ? policy.wardrobeRequest(args.said) : null;
            occasion = parsed && parsed.args && parsed.args.occasion;
        }
        var ranked = rankLooks(pool, { occasion: occasion, recent: recent });
        var wearable = ranked.filter(function (look) {
            return look && (look.vrmUrl || look.vrm_url || (allowGenerate && look.request));
        });
        return wearable[0] || ranked[0] || null;
    }

    function serviceOf(deps) {
        if (deps && deps.service) return deps.service;
        var wardrobe = pick('NEXUS_WARDROBE');
        return (wardrobe && wardrobe.service) || null;
    }

    /**
     * The controller that can actually swap the avatar.
     *
     * Bootstrap publishes `{ config, service, panel }`. The controller lives on the
     * service (`service.controller`), which is also where `applyLook` and `restore`
     * already go. A top-level `wardrobe.controller` is accepted for a test double
     * and is not what the page sets.
     */
    function controllerOf(deps) {
        if (deps && deps.controller) return deps.controller;
        var service = serviceOf(deps);
        if (service && service.controller) return service.controller;
        var wardrobe = pick('NEXUS_WARDROBE');
        return (wardrobe && wardrobe.controller) || null;
    }

    /**
     * A generator that has `create`, built the way the haul builds one.
     *
     * The page global is `{ TryOnGenerator, TryOnError, ... }`. `create` is a method
     * of an instance that needs the wardrobe service, so the export itself cannot
     * be called. An injected object that already has `create` is used as it is.
     */
    function generatorOf(deps) {
        var given = deps && deps.generator;
        if (given && typeof given.create === 'function') return given;
        var exported = given || pick('NEXUS_TRY_ON_GENERATOR');
        if (!exported) return null;
        if (typeof exported.create === 'function') return exported;
        var Ctor = exported.TryOnGenerator;
        if (typeof Ctor !== 'function') return null;
        try {
            return new Ctor({
                service: serviceOf(deps),
                identity: pick('NEXUS_AVATAR_IDENTITY'),
                reasons: pick('NEXUS_TRY_ON_REASONS'),
            });
        } catch (_) {
            return null;
        }
    }

    async function materialise(look, deps, sessionId, mine) {
        if (!look) return null;
        if (look.vrmUrl || look.vrm_url) return look;
        if (mine !== job || !still(deps, sessionId)) return null;
        var generator = generatorOf(deps);
        var prompt = (look.request && look.request.prompt) || look.prompt || look.title || '';
        if (!generator || typeof generator.create !== 'function' || !prompt) return null;
        try {
            var created = await generator.create(prompt);
            return created || null;
        } catch (_) {
            return null;
        }
    }

    async function apply(controller, look) {
        if (!controller || typeof controller.applyLook !== 'function') {
            throw new Error('wardrobe controller is not available');
        }
        if (typeof controller.snapshot === 'function' && !controller.original) controller.snapshot();
        return controller.applyLook(look);
    }

    function remember(controller) {
        if (previous || !controller) return;
        previous = {
            look: controller.activeLook || null,
            hadLook: Boolean(controller.activeLook),
        };
    }

    async function restorePrevious(deps) {
        var controller = (deps && deps.controller) || controllerOf(deps);
        var held = previous;
        previous = null;
        if (!controller) return false;
        try {
            if (held && held.hadLook && held.look && typeof controller.applyLook === 'function') {
                await controller.applyLook(held.look);
                return true;
            }
            if (typeof controller.restore === 'function') {
                await controller.restore();
                return true;
            }
        } catch (_) {
            return false;
        }
        return false;
    }

    async function execute(name, args, deps) {
        var kind = kindOf(name);
        var options = deps || {};
        var input = args || {};
        if (!kind) return blocked('not-in-scene', 'That stays out of Private.');
        var mine = ++job;
        return enqueue(async function () {
            if (mine !== job) return blocked('superseded', 'A newer outfit request replaced that one.');
            var session = sessionOf(options);
            var sessionId = options.sessionId || (session && session.id);
            if (!still(options, sessionId)) return blocked('session-ended');
            var policy = policyApi(options);
            var source = options.source === 'user' ? 'user' : 'assistant';
            if (policy && typeof policy.authorize === 'function' && options.skipAuthorize !== true) {
                var wardrobeGranted = source === 'user' || options.wardrobeGranted === true;
                if (!wardrobeGranted) {
                    var capability = pick('NEXUS_TOGETHER_CAPABILITY');
                    try {
                        wardrobeGranted = Boolean(
                            capability &&
                                typeof capability.privateActionAllowed === 'function' &&
                                capability.privateActionAllowed('wardrobe')
                        );
                    } catch (_) {
                        wardrobeGranted = false;
                    }
                }
                var decision = policy.authorize(
                    { kind: kind, source: source, sessionId: sessionId, args: input },
                    session || { id: sessionId, active: true, stopped: false },
                    { musicGranted: false, wardrobeGranted: wardrobeGranted }
                );
                if (!decision.ok) return blocked(decision.reason || 'not-authorized');
            }
            if (kind === 'wardrobe.undo') {
                var undone = await restorePrevious(options);
                show(options, {
                    kicker: phrase('action.wardrobeDone', 'Outfit changed'),
                    title: phrase('action.undo', 'Undo'),
                    detail: '',
                });
                return {
                    ok: undone,
                    status: undone ? 'completed' : 'failed',
                    reason: undone ? '' : 'nothing-to-restore',
                    why: '',
                };
            }
            show(options, {
                kicker: phrase('action.wardrobeWorking', 'Changing outfit…'),
                title: '',
                detail: '',
            });
            var allowGenerate = kind === 'wardrobe.create' || source === 'user';
            var look = await resolveLook(input, options, allowGenerate);
            if (!look && input.prompt && (kind === 'wardrobe.create' || allowGenerate)) {
                look = { title: input.prompt, prompt: input.prompt, request: { prompt: input.prompt } };
            }
            if (mine !== job || !still(options, sessionId)) return blocked('session-ended');
            if (!look) return blocked('not-on-hand', 'No saved look matches that.');
            var controller = controllerOf(options);
            if (!belongsToAvatar(look, controller)) return blocked('wrong-avatar');
            var eligibility = options.eligibility || { mode: 'off' };
            if (policy && typeof policy.outfitAllowed === 'function') {
                var gate = policy.outfitAllowed(look, eligibility);
                if (!gate.ok) return blocked(gate.reason || 'avatar-ineligible');
            }
            var ready = look;
            if (!(look.vrmUrl || look.vrm_url)) {
                if (!allowGenerate) return blocked('needs-confirmation');
                ready = await materialise(look, options, sessionId, mine);
                if (mine !== job || !still(options, sessionId)) return blocked('session-ended');
                if (!ready || !(ready.vrmUrl || ready.vrm_url))
                    return blocked('not-on-hand', 'That look is not ready.');
                if (policy && typeof policy.outfitAllowed === 'function') {
                    var again = policy.outfitAllowed(ready, eligibility);
                    if (!again.ok) return blocked(again.reason || 'avatar-ineligible');
                }
            }
            if (mine !== job || !still(options, sessionId)) return blocked('session-ended');
            remember(controller);
            try {
                await apply(controller, ready);
            } catch (error) {
                return {
                    ok: false,
                    status: 'failed',
                    reason: 'apply-failed',
                    why: (error && error.message) || 'That could not be worn.',
                };
            }
            if (mine !== job || !still(options, sessionId)) {
                await restorePrevious(options);
                return blocked('session-ended');
            }
            var id = String(ready.id || ready.name || '');
            if (id) recent.push(id);
            if (recent.length > 8) recent.shift();
            show(options, {
                kicker: phrase('action.wardrobeDone', 'Outfit changed'),
                title: ready.name || ready.title || '',
                detail: '',
                undoLabel: phrase('action.undo', 'Undo'),
                onUndo: function () {
                    execute('wardrobe_undo', {}, Object.assign({}, options, { source: 'user', skipAuthorize: true }));
                },
            });
            return { ok: true, status: 'completed', reason: '', why: '', look: ready };
        });
    }

    async function release(deps) {
        job += 1;
        var options = deps || {};
        var policy = policyApi(options);
        return enqueue(async function () {
            if (policy && typeof policy.keepAfterPrivate === 'function' && policy.keepAfterPrivate()) {
                previous = null;
                return { ok: true, status: 'completed', restored: false };
            }
            var restored = await restorePrevious(options);
            return { ok: true, status: 'completed', restored: restored };
        });
    }

    function reset() {
        job += 1;
        previous = null;
        recent = [];
        tail = Promise.resolve();
    }

    var api = {
        rankLooks: rankLooks,
        execute: execute,
        release: release,
        reset: reset,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_IN_SCENE_WARDROBE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
