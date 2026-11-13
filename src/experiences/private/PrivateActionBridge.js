/**
 * PX6. One avatar, one conversation: things she does happen inside the session that asked.
 *
 * Before this, anything she could *do* belonged to some other part of the app, and doing it
 * meant going there. Music was published into the ordinary chat (so Private refused it
 * outright); an outfit change started Try-On Haul (so Private ended); a model that was told
 * neither existed answered "tell me more". The person's experience was a companion who could
 * talk about an evening and not take part in it.
 *
 * The bridge is the one place an action enters a Private session, whoever wanted it:
 *
 *     their words ──► PrivateActionIntent.parse ─┐
 *     a tag she wrote (PlayDirective,            ├─► request() ─► PrivateActionPolicy
 *       WardrobeTool) ───────────────────────────┤                    │ allow
 *     a tap on the strip ────────────────────────┘                    ▼
 *                                              handler: PrivateMediaController,
 *                                              InSceneWardrobe, NEXUS_MOTION
 *
 * ## The contract every action carries
 *
 *   id         unique per request
 *   sessionId  the Private session it belongs to — a result for another session is dropped
 *   turnId     the person's turn it came from
 *   name       one of PrivateActionPolicy.ACTIONS
 *   params     validated by the policy; a model's arguments are never trusted as given
 *   source     `user` | `user-approved` | `control` | `model` — who authorized it
 *   locale     the app language when it was asked
 *   status     `pending` → `completed` | `blocked` | `failed`, with `why`
 *
 * ## What it never does
 *
 * It never starts or stops an activity, never renders into the ordinary chat, never clears or
 * writes the transcript, never changes the scene the person chose unless they asked, and never
 * reads or moves the consent level — there is no reference to `ConsentFlow` in this file, and a
 * test holds the level still across every action. `stop`, `cozy` and care mode are decided
 * before this runs (`_onUserTurn`), and a turn that is one of those is not parsed for actions.
 *
 * ## One per turn, and once
 *
 * A turn may produce the same request twice — the parser hears "suona Daft Punk" and the model,
 * told what is happening, writes a tag anyway. The second is the first: one music action and one
 * wardrobe action per turn, the later arrival returning the earlier record. Taps are their own
 * requests.
 *
 * Exposes: window.NEXUS_PRIVATE_ACTIONS
 */
(function (global) {
    'use strict';

    const OFFER_TURNS = 2;
    const LOG_MAX = 40;
    const GENERATE_KEY = 'nexus_private_wardrobe_generate';

    function pick(win, name, path) {
        if (win && win[name]) return win[name];
        if (typeof module !== 'undefined' && module.exports && path) {
            try {
                return require(path);
            } catch (_) {
                return null;
            }
        }
        return null;
    }

    let seq = 0;
    let state = null; // one Private session at a time
    const listeners = new Set();

    function emit() {
        const snap = snapshot();
        for (const fn of [...listeners]) {
            try {
                fn(snap);
            } catch (_) {
                /* one bad listener does not stop the others */
            }
        }
    }

    function onChange(fn) {
        if (typeof fn !== 'function') return () => {};
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    function localeOf(win) {
        try {
            return (win && win.AppLanguage && win.AppLanguage.code) || 'en-US';
        } catch (_) {
            return 'en-US';
        }
    }

    function generatePolicy(win) {
        try {
            return win.localStorage.getItem(GENERATE_KEY) === 'allow' ? 'allow' : 'ask';
        } catch (_) {
            return 'ask';
        }
    }

    /**
     * A Private session began. Returns its id; every action from here until `end` carries it.
     *
     * @param {object} session  the Private session (`view`, `preset`, `_stopped`, `_care`)
     * @param {object} [options] `{ win, pick, deps }` — `deps` are for tests
     */
    function begin(session, options) {
        const o = options || {};
        if (state) end(state.session);
        const win = o.win || (session && session.win) || global;
        const Media = pick(win, 'NEXUS_PRIVATE_MEDIA_CONTROLLER', './PrivateMediaController.js');
        const Wardrobe = pick(win, 'NEXUS_IN_SCENE_WARDROBE', './InSceneWardrobe.js');
        seq += 1;
        state = {
            sessionId: `private-${Date.now().toString(36)}-${seq}`,
            session,
            win,
            turnId: 0,
            turnText: '',
            asked: {},
            lastFamily: null,
            log: [],
            byTurn: new Map(),
            offer: null,
            music: null,
            wardrobe: null,
            media:
                (o.deps && o.deps.media) ||
                (Media ? new Media.PrivateMediaController({ win, session, pick: o.pick }) : null),
            closet:
                (o.deps && o.deps.wardrobe) ||
                (Wardrobe ? new Wardrobe.InSceneWardrobe({ win, deps: (o.deps && o.deps.wardrobeDeps) || {} }) : null),
            motion: (o.deps && o.deps.motion) || null,
            unwatch: [],
        };
        const s = state;
        if (s.media && typeof s.media.onChange === 'function') {
            s.unwatch.push(
                s.media.onChange((now) => {
                    if (state !== s) return;
                    // The player's word is what completes a play request, not the request itself.
                    const a = s.music;
                    if (a && a.status === 'pending') {
                        if (now.status === 'playing') finish(a, 'completed');
                        else if (now.status === 'blocked') {
                            finish(a, 'blocked', 'autoplay-blocked');
                            followUp(s, a);
                        } else if (now.status === 'failed') finish(a, 'failed', now.why || 'player-failed');
                    }
                    emit();
                })
            );
        }
        if (s.closet && typeof s.closet.onChange === 'function') {
            s.unwatch.push(
                s.closet.onChange(() => {
                    if (state === s) emit();
                })
            );
        }
        emit();
        return s.sessionId;
    }

    /** The session ended. Pending actions become stale; her outfit goes back unless kept. */
    function end(session, options) {
        const s = state;
        if (!s || (session && s.session !== session)) return false;
        state = null;
        for (const off of s.unwatch) {
            try {
                off();
            } catch (_) {
                /* already gone */
            }
        }
        for (const a of s.log) if (a.status === 'pending') settle(a, 'blocked', 'stale');
        try {
            if (s.media && typeof s.media.dispose === 'function') s.media.dispose();
        } catch (_) {
            /* the session's own teardown hands the music back */
        }
        if (s.closet && typeof s.closet.close === 'function') {
            Promise.resolve(s.closet.close({ keep: Boolean(options && options.keepOutfit) })).catch(() => null);
        }
        emit();
        return true;
    }

    function active() {
        return Boolean(state && state.session && !state.session._stopped);
    }

    function settle(action, status, why, result) {
        action.status = status;
        action.why = why || null;
        if (result !== undefined) action.result = result;
        action.settledAt = Date.now();
    }

    function finish(action, status, why, result) {
        settle(action, status, why, result);
        emit();
        return action;
    }

    /**
     * PX8. A request she had already said yes to failed after her reply was written ("I'm putting
     * it on" — and then the search found nothing). One short line in her voice, in the app's
     * language, so the conversation does not carry on as if it had worked. Only for the person's
     * own requests, only when her prompt had not already been told of the failure, never twice.
     */
    function speakLine(s, key) {
        try {
            const loc = s.win.NEXUS_PRIVATE_LOCALE;
            const line = loc && typeof loc.t === 'function' ? loc.t(key) : '';
            if (line && line !== key && typeof s.session._speak === 'function' && !s.session._stopped)
                s.session._speak(line);
        } catch (_) {
            /* the strip still says what is playing */
        }
    }

    function followUp(s, action) {
        if (!action || action.source === 'model' || !action.told || action.toldFailure || action.followed) return;
        if (!['failed', 'blocked'].includes(action.status) || action.why === 'stale') return;
        if (action.status === 'blocked' && action.why !== 'autoplay-blocked' && action.why !== 'needs-approval') return;
        if (action.why === 'needs-approval') return; // the chip is already asking
        action.followed = true;
        const key =
            action.family === 'music'
                ? action.why === 'autoplay-blocked'
                    ? 'followup.tap'
                    : 'followup.music'
                : 'followup.outfit';
        try {
            const loc = s.win.NEXUS_PRIVATE_LOCALE;
            const line = loc && typeof loc.t === 'function' ? loc.t(key) : '';
            if (line && line !== key && typeof s.session._speak === 'function' && !s.session._stopped)
                s.session._speak(line);
        } catch (_) {
            /* the strip still says what happened */
        }
    }

    function facts(s, action) {
        const Policy = pick(s.win, 'NEXUS_PRIVATE_ACTION_POLICY', './PrivateActionPolicy.js');
        const asked = {};
        for (const family of Object.keys(s.asked)) asked[family] = s.asked[family] === action.turnId;
        return {
            active: state === s && !s.session._stopped,
            care: Boolean(s.session._care),
            asked,
            autonomy: Policy ? Policy.autonomy(s.win) : 'suggest',
        };
    }

    /**
     * Ask for an action. Always resolves with the action record; never throws.
     *
     * @param {string} name
     * @param {object} [params]
     * @param {object} [options] `{ source, turnId }`
     */
    async function request(name, params, options) {
        const o = options || {};
        const s = state;
        const source = o.source || 'model';
        seq += 1;
        const action = {
            id: `act-${Date.now().toString(36)}-${seq}`,
            sessionId: s ? s.sessionId : null,
            turnId: s ? (o.turnId === undefined ? s.turnId : o.turnId) : null,
            name: String(name || ''),
            params: {},
            source,
            locale: localeOf(s ? s.win : global),
            status: 'pending',
            why: null,
            result: null,
            at: Date.now(),
        };
        if (!s) return (settle(action, 'blocked', 'not-in-private'), action);
        const Policy = pick(s.win, 'NEXUS_PRIVATE_ACTION_POLICY', './PrivateActionPolicy.js');
        if (!Policy) return (settle(action, 'blocked', 'no-policy'), action);

        const valid = Policy.validate(action.name, params);
        if (!valid.ok) return (record(s, action), finish(action, 'blocked', valid.why));
        action.params = valid.params;
        action.family = valid.family;

        // One per family per turn: the model's tag for a request the parser already heard *is*
        // that request. Taps are deliberate and separate. A request that failed or was refused
        // does not stand in the way: her tag may name exactly what their words only described.
        const key = `${action.turnId}:${action.family}`;
        if (source !== 'control') {
            const earlier = s.byTurn.get(key);
            if (earlier && ['pending', 'completed'].includes(earlier.status)) return earlier;
        }

        record(s, action);
        const verdict = Policy.decide(action, facts(s, action));
        if (!verdict.allow) {
            if (verdict.suggest) await offerFrom(s, action);
            return finish(action, 'blocked', verdict.why);
        }
        if (source !== 'control') s.byTurn.set(key, action);
        if (action.family === 'music' && ['music.play', 'music.search'].includes(action.name)) s.music = action;
        if (action.family === 'wardrobe') s.wardrobe = action;
        emit();

        const alive = () =>
            state === s && !s.session._stopped && (action.family !== 'wardrobe' || s.wardrobe === action);
        try {
            await run(s, action, alive);
        } catch (error) {
            console.warn('[PrivateActions] an action threw', action.name, error);
            if (action.status === 'pending') settle(action, 'failed', 'threw');
        }
        // Whatever the handler concluded, a session that ended meanwhile owns none of it.
        if (state !== s && action.status === 'pending') settle(action, 'blocked', 'stale');
        if (state === s) followUp(s, action);
        emit();
        return action;
    }

    function record(s, action) {
        s.log.push(action);
        if (s.log.length > LOG_MAX) s.log.shift();
    }

    async function run(s, action, alive) {
        const p = action.params;
        switch (action.name) {
            case 'music.play':
            case 'music.search': {
                if (!s.media) return settle(action, 'failed', 'no-player');
                const out = await s.media.play(p, alive);
                if (!alive()) return settle(action, 'blocked', 'stale');
                if (!out.ok) return settle(action, 'failed', out.why);
                action.result = { title: out.track.title || '', creator: out.track.creator || '' };
                // PX9. Her reply ("putting on Daft Punk") was written before the search said that
                // only the keyless song can play here. One line in her voice puts that right.
                if (out.track.sample && p.query && action.told && !action.followed) {
                    action.followed = true;
                    speakLine(s, 'followup.sample');
                }
                // Still `pending`: only the player can say it is playing (see `begin`).
                if (s.media.status().status === 'playing') settle(action, 'completed', null, action.result);
                return null;
            }
            case 'music.pause':
            case 'music.resume':
            case 'music.stop': {
                if (!s.media) return settle(action, 'failed', 'no-player');
                const out = s.media[action.name.split('.')[1]]();
                return settle(action, out.ok ? 'completed' : 'failed', out.ok ? null : out.why);
            }
            case 'wardrobe.wear':
                return wear(s, action, alive);
            case 'wardrobe.create':
            case 'wardrobe.change':
                return make(s, action, alive, {
                    prompt: p.prompt,
                    change: action.name === 'wardrobe.change',
                    label: null,
                });
            case 'wardrobe.undo': {
                if (!s.closet) return settle(action, 'failed', 'wardrobe-not-ready');
                const out = await s.closet.undo();
                return settle(action, out.ok ? 'completed' : 'failed', out.ok ? null : out.why);
            }
            case 'avatar.dance':
                return dance(s, action);
            case 'avatar.react':
                return react(s, action);
            case 'scene.change': {
                const controller = s.win.NEXUS_SCENE_AMBIENCE_CONTROLLER;
                if (!controller || typeof controller.apply !== 'function') return settle(action, 'failed', 'no-scenes');
                let applied = null;
                try {
                    applied = controller.apply(p.scene, { source: 'private' });
                } catch (_) {
                    applied = null;
                }
                return settle(action, applied ? 'completed' : 'failed', applied ? null : 'unknown-scene');
            }
            default:
                return settle(action, 'blocked', 'unknown-action');
        }
    }

    async function wear(s, action, alive) {
        if (!s.closet) return settle(action, 'failed', 'wardrobe-not-ready');
        const opened = await s.closet.open();
        if (!alive()) return settle(action, 'blocked', 'stale');
        if (!opened.ok) return settle(action, 'failed', opened.why);
        const planned = s.closet.plan(action.params);
        if (!planned.ok) return settle(action, 'failed', planned.why);
        const choice = planned.choice;
        if (!choice.generate) {
            const out = await s.closet.wearLook(choice.look, alive);
            if (out.ok) s.offer = null;
            return settle(
                action,
                out.ok ? 'completed' : out.why === 'stale' ? 'blocked' : 'failed',
                out.ok ? null : out.why,
                {
                    name: choice.look.name || '',
                }
            );
        }
        return make(s, action, alive, {
            prompt: choice.entry.request.prompt,
            preset: choice.entry.request.preset,
            outfitId: choice.entry.id,
            label: choice.entry.title,
            private: Boolean(choice.entry.private),
        });
    }

    /**
     * Something that has to be *made*. That takes a while and may cost, so it needs the person:
     * their yes to an offer, or their standing "make what I ask for". Otherwise it is offered.
     */
    async function make(s, action, alive, spec) {
        if (!s.closet) return settle(action, 'failed', 'wardrobe-not-ready');
        const opened = await s.closet.open();
        if (!alive()) return settle(action, 'blocked', 'stale');
        if (!opened.ok) return settle(action, 'failed', opened.why);
        const approved =
            action.source === 'user-approved' || (action.source === 'user' && generatePolicy(s.win) === 'allow');
        if (!approved) {
            s.offer = { kind: 'create', spec, name: spec.label || spec.prompt, turnId: s.turnId, from: action.id };
            return settle(action, 'blocked', 'needs-approval', { name: s.offer.name });
        }
        const out = spec.change ? await s.closet.change(spec.prompt, alive) : await s.closet.create(spec, alive);
        if (out.ok) s.offer = null;
        return settle(
            action,
            out.ok ? 'completed' : out.why === 'stale' ? 'blocked' : 'failed',
            out.ok ? null : out.why,
            {
                name: (out.look && out.look.name) || spec.label || '',
            }
        );
    }

    /** SUGGEST: her idea becomes a question for the person, with the look already resolved. */
    async function offerFrom(s, action) {
        if (!s.closet || action.family !== 'wardrobe') return;
        try {
            const opened = await s.closet.open();
            if (state !== s || !opened.ok) return;
            if (action.name === 'wardrobe.wear') {
                const planned = s.closet.plan(action.params);
                if (!planned.ok) return;
                const c = planned.choice;
                s.offer = c.generate
                    ? {
                          kind: 'create',
                          spec: {
                              prompt: c.entry.request.prompt,
                              preset: c.entry.request.preset,
                              outfitId: c.entry.id,
                              label: c.entry.title,
                              private: Boolean(c.entry.private),
                          },
                          name: c.entry.title,
                          turnId: s.turnId,
                          from: action.id,
                      }
                    : { kind: 'wear', look: c.look, name: c.look.name || '', turnId: s.turnId, from: action.id };
            } else if (action.params.prompt) {
                s.offer = {
                    kind: 'create',
                    spec: { prompt: action.params.prompt, change: action.name === 'wardrobe.change', label: null },
                    name: action.params.prompt,
                    turnId: s.turnId,
                    from: action.id,
                };
            }
        } catch (_) {
            /* no offer is a fine outcome */
        }
    }

    /** The person said yes to what was offered (their words, or the chip). */
    async function approveOffer(source) {
        const s = state;
        if (!s || !s.offer) return null;
        const offer = s.offer;
        s.offer = null;
        seq += 1;
        const action = {
            id: `act-${Date.now().toString(36)}-${seq}`,
            sessionId: s.sessionId,
            turnId: s.turnId,
            name: offer.kind === 'wear' ? 'wardrobe.wear' : offer.spec.change ? 'wardrobe.change' : 'wardrobe.create',
            params: offer.kind === 'wear' ? { look: offer.name } : { prompt: offer.spec.prompt },
            family: 'wardrobe',
            source: source === 'control' ? 'control' : 'user-approved',
            locale: localeOf(s.win),
            status: 'pending',
            why: null,
            result: null,
            at: Date.now(),
        };
        record(s, action);
        const Policy = pick(s.win, 'NEXUS_PRIVATE_ACTION_POLICY', './PrivateActionPolicy.js');
        const verdict = Policy ? Policy.decide(action, facts(s, action)) : { allow: false, why: 'no-policy' };
        if (!verdict.allow) return finish(action, 'blocked', verdict.why);
        s.wardrobe = action;
        s.byTurn.set(`${action.turnId}:wardrobe`, action);
        emit();
        const alive = () => state === s && !s.session._stopped && s.wardrobe === action;
        try {
            if (offer.kind === 'wear') {
                const out = await s.closet.wearLook(offer.look, alive);
                settle(
                    action,
                    out.ok ? 'completed' : out.why === 'stale' ? 'blocked' : 'failed',
                    out.ok ? null : out.why,
                    {
                        name: offer.name,
                    }
                );
            } else {
                action.source = 'user-approved';
                await make(s, action, alive, offer.spec);
            }
        } catch (error) {
            console.warn('[PrivateActions] the approved change threw', error);
            settle(action, 'failed', 'threw');
        }
        emit();
        return action;
    }

    function declineOffer() {
        if (!state || !state.offer) return false;
        state.offer = null;
        emit();
        return true;
    }

    function motionOf(s) {
        return s.motion || s.win.NEXUS_MOTION || null;
    }

    function dance(s, action) {
        const motion = motionOf(s);
        const fast = s.win.NEXUS_INTENT_FASTPATH;
        // "balla" / "dance" already ran through the motion fast path on this very utterance
        // (MotionIntegration.onUserUtterance); firing it again would restart the clip mid-step.
        let already = false;
        try {
            const hit = fast && typeof fast.match === 'function' ? fast.match(s.turnText) : null;
            already = Boolean(hit && hit.label === 'dance' && action.source === 'user');
        } catch (_) {
            already = false;
        }
        if (already) return settle(action, 'completed', null, { via: 'fastpath' });
        if (!motion || typeof motion.execute !== 'function') return settle(action, 'failed', 'no-motion');
        let plan = null;
        try {
            const hit = fast && typeof fast.match === 'function' ? fast.match('dance') : null;
            plan = hit && hit.plan;
        } catch (_) {
            plan = null;
        }
        plan = plan || {
            commands: [
                { type: 'gesture', name: 'dance' },
                { type: 'expression', name: 'happy', weight: 0.7 },
            ],
            interruptible: true,
            priority: 'high',
        };
        try {
            motion.execute(plan);
            return settle(action, 'completed');
        } catch (_) {
            return settle(action, 'failed', 'motion-failed');
        }
    }

    const EXPRESSION = {
        happy: 'happy',
        playful: 'happy',
        relaxed: 'relaxed',
        tender: 'relaxed',
        shy: 'relaxed',
        surprised: 'surprised',
    };

    function react(s, action) {
        const motion = motionOf(s);
        if (!motion || typeof motion.execute !== 'function') return settle(action, 'failed', 'no-motion');
        try {
            motion.execute({
                commands: [{ type: 'expression', name: EXPRESSION[action.params.emotion] || 'happy', weight: 0.6 }],
                interruptible: true,
                priority: 'low',
            });
            return settle(action, 'completed');
        } catch (_) {
            return settle(action, 'failed', 'motion-failed');
        }
    }

    /**
     * The person spoke. Called by the session after it has decided what kind of turn this was,
     * so `end`, `pace-down` and care never reach the parser.
     *
     * @returns {Promise<object>|null}  the action's promise, or null when nothing was asked
     */
    function onUserTurn(text, turn) {
        const s = state;
        if (!s || s.session._stopped) return null;
        s.turnId += 1;
        s.turnText = String(text == null ? '' : text);
        const intent = turn && turn.intent;
        if (intent === 'end' || intent === 'pace-down') return null;
        const Intent = pick(s.win, 'NEXUS_PRIVATE_ACTION_INTENT', './PrivateActionIntent.js');
        if (!Intent) return null;

        // An offer waits two turns for an answer, then stops waiting.
        if (s.offer && s.turnId - s.offer.turnId > OFFER_TURNS) s.offer = null;
        const yes = intent === 'affirmation' || (typeof Intent.affirms === 'function' && Intent.affirms(s.turnText));
        if (s.offer && yes && !s.session._care) {
            s.asked.wardrobe = s.turnId;
            return approveOffer('user');
        }

        const media = s.media ? s.media.status() : { status: 'idle' };
        const closet = s.closet ? s.closet.snapshot() : { canUndo: false };
        const parsed = Intent.parse(s.turnText, {
            musicStatus: media.status,
            canUndoOutfit: closet.canUndo,
            lastFamily: s.offer ? 'wardrobe' : s.lastFamily,
        });
        const topic = typeof Intent.topic === 'function' ? Intent.topic(s.turnText) : null;
        if (!parsed) {
            // Talk about music or clothes: remembered, so "you choose" next has a subject — and a
            // statement (not a question) about music lets a tag she writes for it run.
            if (topic) s.lastFamily = topic;
            if (topic === 'music' && !/[?？]\s*$/u.test(s.turnText.trim())) s.asked.music = s.turnId;
            return null;
        }
        s.asked[parsed.family] = s.turnId;
        s.lastFamily = parsed.family;
        // PX10. "Aspetto il brano": the same request again, with what they asked for last time.
        if (parsed.name === 'music.play' && parsed.params.again) {
            const before = [...s.log].reverse().find((a) => a.name === 'music.play' && a.source !== 'model');
            parsed.params = { query: (before && before.params.query) || '' };
        }
        return request(parsed.name, parsed.params, { source: 'user', turnId: s.turnId });
    }

    /** A tag she wrote, routed here instead of to the app-wide executor. */
    function fromModel(name, params) {
        if (!state) return Promise.resolve(null);
        return request(name, params, { source: 'model', turnId: state.turnId });
    }

    function snapshot() {
        const s = state;
        if (!s) return { active: false, sessionId: null, music: null, outfit: null, offer: null, last: null };
        return {
            active: !s.session._stopped,
            sessionId: s.sessionId,
            music: s.media ? s.media.status() : null,
            musicAction: s.music
                ? { status: s.music.status, why: s.music.why, query: s.music.params.query || '' }
                : null,
            outfit: s.closet ? s.closet.snapshot() : null,
            outfitAction: s.wardrobe
                ? {
                      status: s.wardrobe.status,
                      why: s.wardrobe.why,
                      name: (s.wardrobe.result && s.wardrobe.result.name) || '',
                  }
                : null,
            offer: s.offer ? { kind: s.offer.kind, name: s.offer.name } : null,
            last: s.log.length ? s.log[s.log.length - 1] : null,
        };
    }

    function log() {
        return state ? state.log.slice() : [];
    }

    const WHY_MUSIC = {
        'no-provider': 'no music search is connected in this app',
        'search-failed': 'the music search did not answer',
        'nothing-found': 'nothing was found for that',
        'player-failed': 'the player could not start',
        'no-player': 'there is no player to control right now',
        'nothing-playing': 'nothing is playing',
        'autoplay-blocked': 'the browser is waiting for them to tap play on the music strip',
    };
    const WHY_OUTFIT = {
        'wardrobe-not-ready': 'your wardrobe is not available right now',
        'haul-running': 'a try-on is already open',
        'no-outfits': 'you have no other outfits here yet',
        'no-match': 'you have nothing like that in your wardrobe',
        'adult-ineligible': 'that kind of outfit is not available for you here',
        'forge-unavailable': 'new outfits cannot be made right now',
        'create-failed': 'the new outfit could not be made',
        'load-failed': 'the outfit could not be put on, so you are still in what you had',
        'nothing-to-undo': 'there is no earlier outfit to go back to',
        busy: 'an outfit is already being made',
    };

    /**
     * What she is told: what she can do here, and — for this turn — what is actually happening.
     * English, like the rest of Private's prompt; `languageLines` beside it names the language
     * she answers in. Facts only: she never says music is playing unless the player said so.
     */
    function promptLines() {
        const s = state;
        if (!s || s.session._stopped || s.session._care) return [];
        const Policy = pick(s.win, 'NEXUS_PRIVATE_ACTION_POLICY', './PrivateActionPolicy.js');
        const autonomy = Policy ? Policy.autonomy(s.win) : 'suggest';
        const lines = ['', 'WHAT YOU CAN DO HERE — the app does it, in this room, while you keep talking:'];
        lines.push(
            '- Music: when they ask for music, the app finds it and plays it here. Never say you cannot play music, and never say you are only text.'
        );
        const closet = s.closet;
        const names = closet && typeof closet.names === 'function' ? closet.names().slice(0, 10) : [];
        const outfit = closet ? closet.snapshot() : null;
        if (closet && closet.availability().ok) {
            lines.push(
                `- Your outfit: you can change clothes right here, without leaving. You are wearing: ${(outfit && outfit.name) || 'your own outfit'}.${names.length ? ` Your saved looks: ${names.join('; ')}.` : ''}`
            );
            if (autonomy === 'autonomous')
                lines.push(
                    '  When a saved look suits the moment you may change into it: one short sentence, then <wardrobe action="wear" look="NAME"/> on its own line. Rarely — at most once in a while.'
                );
            else if (autonomy === 'suggest')
                lines.push(
                    '  You may suggest a saved look in words; to offer it, end with <wardrobe action="wear" look="NAME"/> on its own line — they are asked before anything changes. Never say you have changed until told so below.'
                );
            else lines.push('  Change only when they ask. Talking about clothes is not asking.');
        }
        lines.push('- Dancing: when they ask you to dance, you do.');
        lines.push(
            'An executable request is never answered with "tell me more" or a list of options: acknowledge it in one short sentence, as something you are doing.'
        );

        const now = [];
        const m = s.music;
        const heard = s.media ? s.media.status() : null;
        if (m && m.turnId === s.turnId) {
            m.told = true;
            const what = m.params.query ? `“${m.params.query}”` : 'something that suits the evening';
            // The controller may already know it cannot play (no search connected) while the
            // request is still formally pending.
            if (m.status === 'pending' && heard && heard.status === 'failed') {
                m.toldFailure = true;
                now.push(
                    `They asked for music (${what}) and it cannot be played here: ${WHY_MUSIC[heard.why] || 'it could not be played'}. Tell them so once, warmly, in your own voice. Do not pretend it is playing.`
                );
            } else if (m.status === 'pending')
                now.push(
                    `They just asked for music (${what}). The app is finding it now. Say, in one short sentence, that you are putting it on. Do not say it is playing yet.`
                );
            else if (m.status === 'completed' && heard && heard.sample && m.params.query)
                now.push(
                    `Music is playing now, but not ${what}: song search is not connected here, so the one song that plays without it is on (${heard.title}). Say so lightly, in one short sentence — never claim it is ${what}.`
                );
            else if (m.status === 'completed') now.push(`The music they asked for (${what}) is playing now.`);
            else if (m.status === 'failed' || m.status === 'blocked') {
                m.toldFailure = true;
                now.push(
                    `They asked for music (${what}) and it did not start: ${WHY_MUSIC[m.why] || 'it could not be played'}. Tell them so once, plainly and warmly, in your own voice. Do not pretend it is playing.`
                );
            }
        }
        // PX8. What is not happening is a fact too: without this she "felt the rhythm" of music
        // that had failed to start.
        if (!heard || heard.status !== 'playing')
            now.push('No music is playing right now. Do not describe music, a song or a rhythm as if one were.');
        const last = s.log.length ? s.log[s.log.length - 1] : null;
        if (last && last.turnId === s.turnId && last.family === 'music' && last !== m) {
            const word = { 'music.pause': 'paused', 'music.stop': 'stopped', 'music.resume': 'playing again' }[
                last.name
            ];
            if (word && last.status === 'completed') now.push(`They asked, and the music is ${word}.`);
            else if (word)
                now.push(
                    `They asked to change the music and it could not be done: ${WHY_MUSIC[last.why] || 'no player'}. Say so once.`
                );
        }
        const w = s.wardrobe;
        if (w && w.turnId === s.turnId) {
            const name = (w.result && w.result.name) || '';
            w.told = true;
            if (['failed', 'blocked'].includes(w.status)) w.toldFailure = true;
            if (w.name === 'wardrobe.undo') {
                now.push(
                    w.status === 'failed'
                        ? `They asked you to go back to your earlier outfit and it could not be done: ${WHY_OUTFIT[w.why] || 'it did not work'}. Say so once.`
                        : 'They asked you to go back to your earlier outfit, and you are changing back now.'
                );
            } else if (w.status === 'pending')
                now.push(
                    'They asked you to change. You are choosing and changing right now — say so in one short sentence, as something you are doing. Do not describe the outfit yet.'
                );
            else if (w.status === 'completed')
                now.push(
                    `You have just changed${name ? ` into “${name}”` : ''}, as they asked. You may mention it in a few words.`
                );
            else if (w.why === 'needs-approval')
                now.push(
                    `They asked you to change. ${name ? `“${name}” would have to be made for you, which takes a minute` : 'It would have to be made, which takes a minute'}; the app is asking them whether to make it. Say that in one short sentence.`
                );
            else
                now.push(
                    `They asked you to change and it did not happen: ${WHY_OUTFIT[w.why] || 'it could not be done'}. Tell them so once, in your own voice, and stay as you are.`
                );
        }
        const d = last && last.turnId === s.turnId && last.name === 'avatar.dance' ? last : null;
        if (d)
            now.push(
                d.status === 'completed'
                    ? 'They asked you to dance, and you are dancing now.'
                    : 'They asked you to dance and you cannot right now. Say so lightly.'
            );
        if (now.length) lines.push('', 'RIGHT NOW:', ...now.map((n) => `- ${n}`));
        lines.push('');
        return lines;
    }

    const api = {
        GENERATE_KEY,
        OFFER_TURNS,
        begin,
        end,
        active,
        request,
        onUserTurn,
        fromModel,
        approveOffer,
        declineOffer,
        snapshot,
        log,
        onChange,
        promptLines,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_ACTIONS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
