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
        // NL3. A position asked for in ordinary chat is not brought into Private: this session
        // keeps its own controller and its own history of positions, and a hold it does not know
        // about is one it could never let go of. She starts Private standing.
        try {
            if (win && win.NEXUS_BODY_POSES && typeof win.NEXUS_BODY_POSES.release === 'function')
                win.NEXUS_BODY_POSES.release('private-started');
        } catch (_) {
            /* Private still begins */
        }
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
            // UN3. The evening's outline and narrative state (StoryWeaver / StoryDirector).
            story: null,
            // UN5. Her held position (PrivatePoseController), and what she wore before undressing.
            poses: (o.deps && o.deps.poses) || makePoses(win),
            dressedLook: null,
        };
        const s = state;
        startStory(s, o.deps && o.deps.story);
        // LM1. Her body alive in a held position: breathing, rocking, her hands. Reads the
        // evening (position, step, finish) each frame; never moves any of it.
        s.living = startLiving(s, o.deps && o.deps.living);
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
                    if (state !== s) return;
                    syncSkin(s); // UN32. a bare look with a skin pack switches state live
                    emit();
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
        if (s.skin) s.skin.detach(); // UN32. her skin as it was loaded
        if (s.living) {
            try {
                s.living.detach(); // LM1. before the pose is released below
            } catch (_) {
                /* the pose system is gone with the page */
            }
            s.living = null;
        }
        clearAfterglow(s);
        clearFinish(s);
        stopDoggy(s);
        stopRoutine(s);
        state = null;
        for (const off of s.unwatch) {
            try {
                off();
            } catch (_) {
                /* already gone */
            }
        }
        for (const a of s.log) if (a.status === 'pending') settle(a, 'blocked', 'stale');
        // CV1. Private is over: her clothing is shown again, exactly as it was, whatever ended it.
        try {
            const clothing = s.win && s.win.NEXUS_CLOTHING;
            if (clothing && typeof clothing.showClothing === 'function') clothing.showClothing('private-ended');
        } catch (_) {
            /* nothing hidden, or already restored */
        }
        if (s.travel) clearTimeout(s.travel.timer);
        s.travel = null;
        // UN5. Whatever ended the evening, her skeleton is hers again.
        try {
            if (s.poses) s.poses.release();
        } catch (_) {
            /* the pose system restores itself on its own reset */
        }
        faceFront(s);
        // UN13. An evening that ended before its opening was confirmed is still one evening.
        commitStory(s);
        if (s.story) s.story.end();
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

    // ------------------------------------------------------------------ UN3. the evening
    /**
     * The places this device can show for Private (the setup screen's rooms plus the nightlife
     * openings), resolved for its tier. `VRWorlds.placesFor` is the only source: a place that is
     * not in the catalogue for this device can never be named in her outline.
     */
    async function storyPlaces(win) {
        const W = win && win.NEXUS_VR_WORLDS;
        if (!W || typeof W.loadCatalogue !== 'function' || typeof W.placesFor !== 'function') return [];
        const catalogue = await W.loadCatalogue();
        const doc = win.document;
        const mobile = !!(doc && doc.documentElement && doc.documentElement.classList.contains('is-mobile'));
        return W.placesFor(catalogue.worlds, {
            tier: W.tierFor({ xr: false, mobile }),
            include: ['general', 'romantic', 'private'],
            privateOpen: true,
        });
    }

    /** The world the renderer shows right now, by catalogue id, or null. */
    function shownWorld(win) {
        try {
            const runtime = win && win.NEXUS_VIEWER && win.NEXUS_VIEWER.vrWorlds;
            return (runtime && runtime.activeId) || null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Deal this session's outline, and follow the renderer. Nothing here moves anything: the
     * outline is guidance for her prompt, and `nexus-world-shown` — the renderer's own
     * announcement — is the only thing that says where she is.
     *
     * UN13. An outline is *provisional* until the opening room is authoritative: the renderer's
     * `activeId` when it is dealt, or its first `nexus-world-shown`. While provisional and before
     * the person has done anything, the renderer's opening may re-deal it from the room she is
     * really in (UN12 did this only when the room was the destination). It is remembered in the
     * between-evenings history exactly once — `commitStory` — at the first of: the opening is
     * confirmed, the person's first turn or action, a trip, or the end of the session. Before,
     * every deal called `remember`, so a UN12 re-deal stored two fingerprints for one evening.
     * After the person has interacted, a late opening announcement only says where she is: it
     * never replaces the evening they are already in. Every deal carries a generation, so a
     * catalogue that resolves late, or after the session ended, cannot overwrite a newer one.
     */
    function startStory(s, injected) {
        const Weaver = pick(s.win, 'NEXUS_STORY_WEAVER', '../../features/together/StoryWeaver.js');
        const Director = pick(s.win, 'NEXUS_STORY_DIRECTOR', '../../features/together/StoryDirector.js');
        if (!Weaver || !Director) return;
        s.storyGen = 0;
        s.storyCommitted = false;
        s.storyWeaver = Weaver;
        const deal = (places, shownNow, gen) => {
            if (state !== s || s.session._stopped) return;
            if (gen !== undefined && gen !== s.storyGen) return; // a newer deal already happened
            if (s.story && !shownNow) return;
            s.storyGen += 1;
            const known = (injected && injected.current) || shownWorld(s.win);
            const current = shownNow || known;
            const outline = Weaver.weave({
                places,
                current,
                history: Weaver.history(s.win),
                rng: injected && injected.rng,
            });
            s.places = places;
            s.canTravel =
                injected && injected.canTravel !== undefined
                    ? Boolean(injected.canTravel)
                    : places.length > 1 && Boolean(s.win && s.win.NEXUS_VIEWER && s.win.CustomEvent);
            s.story = Director.create(outline, { places, current, weaver: Weaver });
            s.storyProvisional = !current;
            if (current) commitStory(s);
            emit();
        };
        const first = s.storyGen;
        if (injected && Array.isArray(injected.places)) deal(injected.places, undefined, first);
        else
            storyPlaces(s.win)
                .then((places) => deal(places, undefined, first))
                .catch(() => deal([], undefined, first));
        if (s.win && typeof s.win.addEventListener === 'function') {
            const onShown = (event) => {
                if (state !== s || !s.story || s.session._stopped) return;
                const d = (event && event.detail) || {};
                const id = d.base || d.id || null;
                if (s.travel && (id === s.travel.world || d.id === s.travel.world)) arrive(s, id);
                else if (id && !s.travel && !s.interacted && s.story.phase === 'opening' && s.story.outline) {
                    const outline = s.story.outline;
                    // UN12/UN13. Before anything has happened, the room the renderer reports is the
                    // opening: an outline guessed without it, or one that leads to this very room,
                    // is dealt again from here. Otherwise the outline stands and is now confirmed.
                    if (outline.destination === id || (s.storyProvisional && outline.openingVenue !== id))
                        deal(s.places || [], id);
                    else {
                        s.story.shown(id);
                        s.storyProvisional = false;
                        commitStory(s);
                    }
                } else s.story.shown(id);
                emit();
            };
            s.win.addEventListener('nexus-world-shown', onShown);
            s.unwatch.push(() => s.win.removeEventListener('nexus-world-shown', onShown));
        }
    }

    /** UN13. Keep tonight's outline in the between-evenings history — once per Private session. */
    function commitStory(s) {
        if (!s || s.storyCommitted || !s.story || !s.story.outline || !s.storyWeaver) return;
        s.storyCommitted = true;
        s.storyProvisional = false;
        try {
            s.storyWeaver.remember(s.story.outline.fingerprint, s.win);
        } catch (_) {
            /* a history that cannot be written only makes the next evening less different */
        }
    }

    /** UN13. The person did something: the evening is theirs now, and late openings cannot replace it. */
    function touched(s) {
        if (!s || s.interacted) return;
        s.interacted = true;
        commitStory(s);
    }

    // ------------------------------------------------------------------ UN4. going somewhere else
    /** How long a trip may take before the room she was in is asked for again (as WorldPresence). */
    const TRAVEL_MS = 45 * 1000;
    const PLACE_KEYS = {
        hotel: /hotel|suite/,
        apartment: /apartment|flat|home/,
        bedroom: /bedroom/,
        motel: /motel/,
        discoteca: /discoteca|club/,
        cabaret: /cabaret/,
        rooftop: /rooftop/,
        street: /street/,
    };

    /**
     * A keyword or a catalogue id → one of the places this device can show, or null. "elsewhere"
     * is tonight's destination. Never a world that is not in `s.places`: the outline and the
     * catalogue are the only sources, so nobody can type their way into a room.
     */
    function resolvePlace(s, key) {
        const places = s.places || [];
        const here = s.story ? s.story.snapshot().shown : null;
        const outline = s.story ? s.story.outline : null;
        const id = String(key || '').toLowerCase();
        if (id === 'elsewhere') {
            const dest = outline && outline.destination;
            return places.find((p) => p.id === dest && p.id !== here) || null;
        }
        const exact = places.find((p) => p.id === id || p.world === id);
        if (exact) return exact;
        const re = PLACE_KEYS[id];
        if (!re) return null;
        const matches = places.filter(
            (p) => re.test(`${p.id} ${String(p.title || '').toLowerCase()}`) && p.id !== here
        );
        if (!matches.length) return null;
        return (outline && matches.find((p) => p.id === outline.destination)) || matches[0];
    }

    /** Her invitation, or "somewhere else": one question for the person, nothing moves. */
    function travelOffer(s, place, action) {
        s.offer = {
            kind: 'travel',
            world: place.id,
            name: String(place.title || place.id),
            turnId: s.turnId,
            from: action ? action.id : null,
        };
        if (s.story) s.story.propose(place.id);
        emit();
    }

    function requestWorld(s, id) {
        try {
            s.win.dispatchEvent(
                new s.win.CustomEvent('nexus-world-request', { detail: { id: id || null, owner: 'intimate' } })
            );
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * The person agreed (their words naming the place, their yes, their tap): ask the renderer
     * for the room through the Private experience's own channel (`nexus-world-request`, owner
     * `intimate` — the request the setup screen's choice makes), and wait for its word. Nothing
     * here says she has arrived: `arrive` does, when `nexus-world-shown` names this room. A trip
     * that does not land in TRAVEL_MS asks for the room she was in, and says it did not happen.
     */
    function travel(s, action) {
        if (!s.canTravel) return settle(action, 'failed', 'no-travel');
        const place = resolvePlace(s, action.params.world);
        if (!place) {
            if (action.params.world === 'elsewhere') return settle(action, 'failed', 'no-destination');
            return settle(action, 'failed', 'not-a-place');
        }
        const here = s.story ? s.story.snapshot().shown : null;
        if (place.id === here)
            return settle(action, 'completed', null, { name: place.title || place.id, already: true });
        // "Somewhere else", or her invitation: the place is the evening's idea, so it is asked.
        if (action.params.world === 'elsewhere' && action.source === 'user') {
            travelOffer(s, place, action);
            return settle(action, 'blocked', 'needs-approval', { name: place.title || place.id });
        }
        if (s.travel) clearTimeout(s.travel.timer);
        const from = here;
        s.travel = { action, world: place.id, from, timer: null };
        s.offer = null;
        if (s.story) s.story.travelling(place.id);
        action.result = { name: String(place.title || place.id) };
        if (!requestWorld(s, place.id)) {
            s.travel = null;
            if (s.story) s.story.failed('no-renderer');
            return settle(action, 'failed', 'no-renderer');
        }
        const trip = s.travel;
        trip.timer = setTimeout(() => {
            if (state !== s || s.travel !== trip) return;
            s.travel = null;
            if (s.story) s.story.failed('timeout');
            s.travelNews = { name: (action.result && action.result.name) || trip.world };
            finish(action, 'failed', 'timeout');
            requestWorld(s, from);
            emit();
        }, TRAVEL_MS);
        emit();
        // Stays `pending` until the renderer answers; the prompt says "on your way" meanwhile.
        return action;
    }

    /** The renderer confirmed a world. Only the trip in progress arrives. */
    function arrive(s, id) {
        const trip = s.travel;
        if (!trip) return s.story && s.story.shown(id);
        clearTimeout(trip.timer);
        s.travel = null;
        if (s.story) s.story.arrived(trip.world);
        s.arrivedNews = { world: trip.world, name: (trip.action.result && trip.action.result.name) || trip.world };
        finish(trip.action, 'completed');
        return true;
    }

    /** UN4. Her `<go place="…"/>` inside Private: an invitation, never a trip. Strips every <go>. */
    const GO_TAG = /<\s*go\b([^>]*?)\/?>(?:\s*<\s*\/\s*go\s*>)?/gi;
    function consumeTravel(text) {
        const raw = String(text == null ? '' : text);
        const s = state;
        if (!s || s.session._stopped) return raw;
        let first = null;
        const clean = raw.replace(GO_TAG, (whole, attrs) => {
            if (!first) {
                const m = /place\s*=\s*["']([a-z0-9-]{1,40})["']/i.exec(attrs || '');
                if (m) first = m[1].toLowerCase();
            }
            return ' ';
        });
        if (first) {
            try {
                Promise.resolve(fromModel('world.travel', { world: first })).catch(() => null);
            } catch (_) {
                /* an invitation that cannot be made must not take her reply down */
            }
        }
        return clean
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .trim();
    }

    function active() {
        return Boolean(state && state.session && !state.session._stopped);
    }

    /**
     * NL5. The reply waits for her body: resolves when the position asked for this turn has
     * settled (completed, failed or blocked), and at `maxMs` at the latest. `null` when no
     * position is in flight. Only positions: a search or a download is not waited for.
     */
    function whenPoseSettled(maxMs) {
        const pending = () => {
            const last = state && state.log.length ? state.log[state.log.length - 1] : null;
            return Boolean(last && last.name === 'avatar.pose' && last.status === 'pending');
        };
        if (!pending()) return null;
        const win = state.win || global;
        const limit = Number.isFinite(maxMs) ? maxMs : 3000;
        return new Promise((resolve) => {
            let waited = 0;
            const tick = () => {
                if (!pending() || waited >= limit) return resolve();
                waited += 50;
                (win.setTimeout || setTimeout)(tick, 50);
            };
            tick();
        });
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

    /** UN20. The outcome lines shared with the reply check (TogetherCapability.outfitLineKey). */
    const FOLLOW_OUTFIT = {
        'no-bare-look': 'outfit.say.noBare',
        // CG1. The same outcome, with Forge's reason for her exact file: her line is the same.
        'bare-needs-review': 'outfit.say.noBare',
        'bare-blocked': 'outfit.say.noBare',
        'last-layer': 'outfit.say.lastLayer',
        pace: 'outfit.say.pace',
        'already-dressed': 'outfit.say.alreadyDressed',
        'nothing-to-undo': 'outfit.say.nothingToUndo',
    };

    function followUp(s, action) {
        if (!action || action.source === 'model' || !action.told || action.toldFailure || action.followed) return;
        // UN20. Her reply to this very turn is still being written and checked: the check says the
        // reason if it is needed (`explained`), so the follow-up waits for it rather than saying
        // it a second time.
        if (action.family === 'wardrobe' && s.replyDue === action.turnId) {
            action.heldForReply = true;
            return;
        }
        if (!['failed', 'blocked'].includes(action.status) || action.why === 'stale') return;
        if (action.status === 'blocked' && action.why !== 'autoplay-blocked' && action.why !== 'needs-approval') return;
        if (action.why === 'needs-approval') return; // the chip is already asking
        action.followed = true;
        const key =
            action.family === 'music'
                ? action.why === 'autoplay-blocked'
                    ? 'followup.tap'
                    : 'followup.music'
                : // UN20. A refusal says its own reason, as the reply check would have.
                  FOLLOW_OUTFIT[action.why] || 'followup.outfit';
        try {
            const loc = s.win.NEXUS_PRIVATE_LOCALE;
            const line = loc && typeof loc.t === 'function' ? loc.t(key, { control: closerLabel(s) }) : '';
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
            // UN1. Read at the moment of the decision, for undressing only; never written.
            level: levelOf(s),
        };
    }

    /**
     * LM1. The living layer for this evening (PrivateLivingMotion.attach), or `null` when this
     * page has no pose system to draw it on. What it reads is the evening as the bridge holds it:
     * her held position, ConsentFlow's step, when they last finished, the afterglow, care mode.
     */
    function startLiving(s, injected) {
        if (injected) return injected;
        const Living = pick(s.win, 'NEXUS_PRIVATE_LIVING', './PrivateLivingMotion.js');
        if (!Living || typeof Living.attach !== 'function') return null;
        try {
            return Living.attach({
                win: s.win,
                read: () => {
                    if (state !== s) return {};
                    let speaking = false;
                    try {
                        // Codex (#196). Any of her voices: the app's TTS provider (Piper, SonicAgent, cloud)
                        // as SpeechAdapter reads it, then the browser's own speech.
                        const tts = s.win.NEXUS_TTS_PROVIDER;
                        speaking = Boolean(
                            (tts && typeof tts.isSpeaking === 'function' && tts.isSpeaking()) ||
                                (s.win.speechSynthesis && s.win.speechSynthesis.speaking)
                        );
                    } catch (_) {
                        speaking = false;
                    }
                    const m = movingNow(s);
                    return {
                        moving: m ? m.tempo : null,
                        pose: s.poses && typeof s.poses.held === 'function' ? s.poses.held() : null,
                        level: levelOf(s),
                        finishAt: s.finish ? s.finish.at : null,
                        afterglow: s.afterglow ? s.afterglow.stage : null,
                        care: Boolean(s.session && s.session._care),
                        speaking,
                    };
                },
            });
        } catch (error) {
            console.warn('[Private] LM1 living layer not started', error);
            return null;
        }
    }

    /** ConsentFlow's current level for this session (UN1), or 0 when there is none. */
    /** UN1. Kept equal to `PrivateActionPolicy.UNDRESS_LEVEL`; a test holds them together. */
    const UNDRESS_AT = 4;

    function levelOf(s) {
        try {
            const flow = s && s.session && s.session.adult;
            return flow && flow.active !== false ? Number(flow.level) || 0 : 0;
        } catch (_) {
            return 0;
        }
    }

    /** The haul's layer ranking (LT9), the one the undress step reads its layers from. */
    function allureOf(s) {
        const haul = s.win && s.win.NEXUS_TRY_ON_HAUL_ACTIVITY;
        if (haul && typeof haul.allureOf === 'function') return haul.allureOf;
        try {
            return require('../../wardrobe/TryOnHaulActivity.js').allureOf || null;
        } catch (_) {
            return null;
        }
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
        // UN13. Their words or their tap; her own tags follow a turn of theirs and do not count.
        if (source !== 'model') touched(s);
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
            // UN1. "Not yet" is this turn's answer about her clothes: the reply is told so, and a
            // request that never ran cannot be described as having happened.
            if (action.name === 'wardrobe.undress' && verdict.why === 'pace') s.wardrobe = action;
            return finish(action, 'blocked', verdict.why);
        }
        if (source !== 'control') s.byTurn.set(key, action);
        if (action.family === 'music' && ['music.play', 'music.search'].includes(action.name)) s.music = action;
        if (action.family === 'wardrobe') {
            // LT10. This request replaces the one before it (`alive()` below turns false for
            // that one). If its look is still downloading, it is stopped now: before, it landed
            // on her first and was undone afterwards, so an outfit she no longer wanted (in
            // Private, possibly a state she had just asked to leave) was shown for a moment.
            const earlier = s.wardrobe;
            if (earlier && earlier !== action && earlier.status === 'pending') {
                try {
                    if (s.closet && typeof s.closet.cancelPending === 'function') s.closet.cancelPending();
                } catch (error) {
                    console.warn('[PrivateActions] could not stop the earlier outfit change', error);
                }
            }
            s.wardrobe = action;
        }
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
            case 'wardrobe.undress':
                return undress(s, action, alive);
            case 'wardrobe.redress': {
                // Codex (#193). Dressing again lets go of her position: the sweat clock follows.
                const out = await redress(s, action, alive);
                watchDoggy(s);
                return out;
            }
            case 'avatar.routine':
                return routine(s, action);
            case 'avatar.move':
                return move(s, action);
            case 'avatar.pose': {
                // UN36. A position they ask for ends any show she is giving: their words lead.
                stopRoutine(s);
                // UN35. Whatever position she ends up in, the doggy sweat clock follows it.
                const out = await pose(s, action);
                watchDoggy(s);
                return out;
            }
            case 'wardrobe.undo': {
                if (!s.closet) return settle(action, 'failed', 'wardrobe-not-ready');
                const out = await s.closet.undo();
                return settle(action, out.ok ? 'completed' : 'failed', out.ok ? null : out.why);
            }
            case 'avatar.dance':
                return dance(s, action);
            case 'avatar.react':
                return react(s, action);
            case 'body.finish':
                return finishOn(s, action);
            case 'body.fist':
                return fistOn(s, action);
            case 'world.travel':
                return travel(s, action);
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

    /**
     * UN1. One layer off: the next look down from the one she has on, chosen from her own looks
     * (`OutfitDecisionEngine.undressStep`), worn the way every look is worn — the controller keeps
     * her on screen until the new file has loaded, and a stale result is taken off again.
     */
    function makePoses(win) {
        const Poses = pick(win, 'NEXUS_PRIVATE_POSES', './PrivatePoseController.js');
        return Poses && typeof Poses.create === 'function' ? Poses.create({ win }) : null;
    }

    /**
     * UN5. A look is a whole avatar file: a pose held on the old one would be held on bones that
     * are gone. Let go before the swap, and take the same position again on the new one, so she
     * stays kneeling while a layer comes off.
     */
    async function keepingPose(s, change) {
        const was = s.poses && typeof s.poses.held === 'function' ? s.poses.held() : null;
        if (was) s.poses.release({ keepHistory: true });
        const out = await change();
        if (was && state === s) {
            try {
                s.poses.apply(was, { restoring: true });
            } catch (_) {
                /* she stands in the new outfit; the next request poses her */
            }
        }
        return out;
    }

    /**
     * UN5. Her whole body turned in place, the pose kept: the try-on's own turner (it eases the
     * root's yaw and keeps it across an outfit swap, so a layer coming off does not spin her
     * back to the front). Made once per session, on first use.
     */
    /*
     * UN36. Routines: a show she moves through on her own (PrivateRoutines). Started by their words
     * or a chip, never by her tag alone (the policy's `asked` rule for the avatar family). Every
     * step is re-checked against the pace when it comes — a show never reaches further than its
     * positions could one by one — and a position they ask for, the pace easing below the show,
     * or the session ending stops it where it is. When it ends she holds the last step, and for a
     * few turns "again" / "ancora" plays it once more.
     */
    const ROUTINE_DONE_TURNS = 3;

    function routinesOf(s) {
        return pick(s.win, 'NEXUS_PRIVATE_ROUTINES', './PrivateRoutines.js');
    }

    function poseLevelFn(s) {
        const Policy = pick(s.win, 'NEXUS_PRIVATE_ACTION_POLICY', './PrivateActionPolicy.js');
        return (key) => (Policy && typeof Policy.poseLevel === 'function' ? Policy.poseLevel(key) || 1 : 1);
    }

    /** `running`, `done` (for a few turns after it ended) or null. */
    function routineState(s) {
        if (!s || !s.routine) return null;
        if (!s.routine.done) return 'running';
        return s.turnId - s.routine.doneTurn <= ROUTINE_DONE_TURNS ? 'done' : null;
    }

    /**
     * Codex (#194). A step's line as it really is: an undress step whose layer did not come off
     * says she dances on still dressed, and the closing step drops "naked" when any layer stayed.
     */
    function showBody(r, steps, k) {
        const step = steps[k];
        const kept = r.kept && r.kept.size > 0;
        if (step.undress && r.kept && r.kept.has(k))
            return 'still dancing for them, the layer you meant to take off still on you (it could not come off here)';
        if (kept && step.kept) return step.kept;
        return step.body;
    }

    /** VA3. The clip a show started stops with it (or when it moves on to a held position). */
    function stopShowClip(s, r) {
        if (!r || !r.clip) return;
        r.clip = null;
        try {
            const L = s.win.NEXUS_CLIP_LOADER;
            if (L && typeof L.stopClip === 'function') L.stopClip();
        } catch (_) {
            /* nothing playing */
        }
    }

    function stopRoutine(s) {
        if (!s || !s.routine) return;
        stopShowClip(s, s.routine);
        try {
            (s.win.clearTimeout || clearTimeout)(s.routine.timer);
        } catch (_) {
            /* already fired */
        }
        s.routine = null;
    }

    /**
     * LM7. Motion as a response. She holds a position still; she moves in it only because the
     * person asked ("move for me", "slower", "faster", "stay still"), at the tempo they asked for, and
     * stops when they say so, when the position changes, or once they have finished (the finish
     * has its own reaction, then she is still again). Nothing here moves her: it records what was
     * asked, and the living layer (PrivateLivingMotion) reads it each frame.
     */
    const TEMPOS = ['slow', 'normal', 'fast'];
    function movingNow(s) {
        const m = s && s.moving;
        if (!m) return null;
        const held = s.poses && typeof s.poses.held === 'function' ? s.poses.held() : null;
        // A different position (or none) starts still; so does the moment after the finish.
        if (!held || held !== m.pose || (s.finish && s.finish.at >= m.at)) {
            s.moving = null;
            return null;
        }
        return m;
    }
    function move(s, action) {
        const p = action.params || {};
        if (p.move === 'still') {
            const was = Boolean(movingNow(s));
            s.moving = null;
            emit();
            return settle(action, 'completed', null, { move: 'still', was });
        }
        const held = s.poses && typeof s.poses.held === 'function' ? s.poses.held() : null;
        if (!held) return settle(action, 'failed', 'not-posed');
        if (s.routine && !s.routine.done) return settle(action, 'failed', 'show-running');
        const now = movingNow(s);
        let tempo = now ? now.tempo : p.tempo || 'normal';
        if (p.move === 'start' && p.tempo) tempo = p.tempo;
        if (p.move === 'slower') tempo = TEMPOS[Math.max(0, TEMPOS.indexOf(tempo) - 1)];
        if (p.move === 'faster') tempo = TEMPOS[Math.min(TEMPOS.length - 1, TEMPOS.indexOf(tempo) + 1)];
        s.moving = { pose: held, tempo, at: Date.now() };
        emit();
        return settle(action, 'completed', null, { move: p.move, tempo });
    }

    function routine(s, action) {
        const R = routinesOf(s);
        if (!R || !s.poses) return settle(action, 'failed', 'no-routines');
        const p = action.params;
        const at = levelOf(s) || 1;
        const live = routineState(s) === 'running' ? s.routine : null;
        if (p.move === 'stop') {
            if (!live) return settle(action, 'failed', 'no-routine');
            stopRoutine(s);
            return settle(action, 'completed', null, { move: 'stop' });
        }
        if (p.move === 'slower' || p.move === 'faster') {
            if (!live) return settle(action, 'failed', 'no-routine');
            // One line heard twice changes the speed once.
            if (live.speedAt != null && Date.now() - live.speedAt < 1000)
                return settle(action, 'completed', null, { move: p.move, speed: live.speed });
            live.speedAt = Date.now();
            const before = live.speed;
            live.speed = R.stepSpeed(live.speed, p.move === 'faster' ? 1 : -1);
            // The step she is in now changes pace too: what is left of it, at the new speed.
            if (live.timer && live.stepAt != null) {
                const steps = R.ROUTINES[live.id].steps;
                const hold = steps[live.index] ? steps[live.index].hold : 0;
                const left = Math.max(0, hold - (Date.now() - live.stepAt) * before);
                try {
                    (s.win.clearTimeout || clearTimeout)(live.timer);
                } catch (_) {
                    /* already fired */
                }
                live.stepAt = Date.now() - (hold - left) / live.speed;
                live.timer = (s.win.setTimeout || setTimeout)(() => nextStep(s, live), left / live.speed);
            }
            return settle(action, 'completed', null, { move: p.move, speed: live.speed });
        }
        const levels = poseLevelFn(s);
        const id =
            p.move === 'again'
                ? s.routine && s.routine.id
                : !p.routine || p.routine === 'choose'
                  ? R.boldest(at, levels)
                  : p.routine;
        if (!id || !R.ROUTINES[id]) return settle(action, 'failed', p.move === 'again' ? 'no-routine' : 'none-open');
        // MP1. Switched off in Settings (Motion created by Claude): not a matter of the pace.
        if (typeof R.available === 'function' && !R.available(id))
            return settle(action, 'failed', 'show-off', { routine: id });
        if (R.level(id, levels) > at) return settle(action, 'blocked', 'pace', { routine: id });
        // The same show asked for again in the same moment (one line heard twice) is the one running.
        if (live && live.id === id && live.index === 0 && Date.now() - live.stepAt < 1500)
            return settle(action, 'completed', null, { routine: id, name: R.ROUTINES[id].name });
        const speed = s.routine ? s.routine.speed : 1;
        stopRoutine(s);
        const r = { id, index: -1, speed, timer: null, done: false, doneTurn: null, turnId: action.turnId };
        s.routine = r;
        // PP2. A show that takes clothes off needs clothes to take off. With nothing left (she is
        // bare, or her wardrobe has no layer under what she wears), she first puts on one of her
        // ready striptease sets — a look already made for her, so it loads at once and nothing is
        // generated — and the show begins once it is on. Without one, the show runs as before.
        const outfit = needsShowOutfit(s, R.ROUTINES[id]) ? showOutfit(s) : null;
        if (outfit) {
            r.dressing = true;
            emit();
            const alive = () => state === s && s.routine === r && !r.done;
            keepingPose(s, () => s.closet.wearLook(outfit, alive))
                .catch(() => ({ ok: false }))
                .then(() => {
                    if (!alive()) return;
                    r.dressing = false;
                    nextStep(s, r);
                });
            return settle(action, 'completed', null, {
                routine: id,
                name: R.ROUTINES[id].name,
                outfit: outfit.name || '',
            });
        }
        nextStep(s, r);
        if (s.routine !== r) return settle(action, 'failed', 'not-rendered', { routine: id });
        return settle(action, 'completed', null, { routine: id, name: R.ROUTINES[id].name });
    }

    /** PP2. Does this show undress her, and is there nothing left on her to take off? */
    function needsShowOutfit(s, routine) {
        if (!routine || !routine.steps.some((x) => x.undress)) return false;
        if (!s.closet || !s.closet.privateOpen || typeof s.closet.wearLook !== 'function') return false;
        try {
            return !nextLayer(s, { step: 'next' }).look;
        } catch (_) {
            return false;
        }
    }

    /**
     * PP2. One of her ready striptease sets: a look made from Forge's striptease outfits
     * (`show-strip-*`, the Striptease Show collection), not bare, not the one she has on. The
     * first in her wardrobe's own order, so the same evening picks the same set.
     */
    function showOutfit(s) {
        const looks = (s.closet && s.closet.looks) || [];
        const Engine = pick(s.win, 'NEXUS_OUTFIT_DECISION_ENGINE', './OutfitDecisionEngine.js');
        const keyOf = Engine && typeof Engine.keyOf === 'function' ? Engine.keyOf : (l) => l && (l.lookId || l.id);
        let current = null;
        try {
            current = typeof s.closet.current === 'function' ? s.closet.current() : null;
        } catch (_) {
            current = null;
        }
        const here = current ? keyOf(current) : null;
        return (
            looks.find(
                (l) =>
                    l &&
                    /^show-strip-/.test(String(l.outfitId || '')) &&
                    !(Engine && typeof Engine.isBare === 'function' && Engine.isBare(l)) &&
                    keyOf(l) !== here
            ) || null
        );
    }

    function nextStep(s, r) {
        if (state !== s || s.routine !== r || r.done) return;
        const R = routinesOf(s);
        const steps = R.ROUTINES[r.id].steps;
        r.index += 1;
        if (r.index >= steps.length) {
            r.done = true;
            r.doneTurn = s.turnId;
            emit();
            return;
        }
        const step = steps[r.index];
        if (step.pose && poseLevelFn(s)(step.pose) > (levelOf(s) || 1)) {
            stopRoutine(s);
            emit();
            return;
        }
        let ok = true;
        try {
            if (step.clip) {
                // VA3. A danced step: her held position lets go, the clip plays looped (as Pose
                // Studio's Play does), and an undress cue takes a layer off as the step begins.
                const L = s.win.NEXUS_CLIP_LOADER;
                if (!L || typeof L.playClip !== 'function') ok = false;
                else {
                    if (s.poses && typeof s.poses.held === 'function' && s.poses.held()) s.poses.release();
                    r.clip = step.clip;
                    const at = r.index;
                    // Codex (#194). A clip loads before it plays, and the loader has no cancel: a
                    // show stopped (or moved on) while it loaded would start dancing over whatever
                    // came next. The load only plays if this show is still on this step.
                    const owns = () => s.routine === r && r.index === at && r.clip === step.clip;
                    Promise.resolve(L.playClip(step.clip, { loop: true }))
                        .then((played) => {
                            if (played && !owns()) {
                                try {
                                    L.stopClip();
                                } catch (_) {
                                    /* already stopped */
                                }
                                return;
                            }
                            if (!played && s.routine === r) {
                                console.warn('[Private] a show clip did not play', step.clip);
                                stopRoutine(s);
                                emit();
                            }
                        })
                        .catch(() => {});
                    if (step.undress) {
                        r.cues = r.cues || [];
                        r.cues.push({ step: r.index, at: Date.now() });
                        // A layer off is another look: a new avatar file, and the clip loader is
                        // registered afresh for her (AvatarManager → registerAvatar), so the dance
                        // bound to the body that left stops. Still on this step when it settles, she
                        // dances on in what she has now — measured live: without this, every cue
                        // step stood still from the cue to the end of the step.
                        request('wardrobe.undress', { step: 'next' }, { source: 'control', turnId: r.turnId })
                            .catch(() => null)
                            .then((done) => {
                                // Codex (#194). What came off is the wardrobe's answer, not the
                                // show's script: a layer that did not (no lower look, no bare look,
                                // a load that failed) is recorded, and her lines say she is still
                                // dressed rather than announcing what did not happen.
                                if (!done || done.status !== 'completed') (r.kept = r.kept || new Set()).add(at);
                                if (!owns()) return;
                                try {
                                    Promise.resolve(L.playClip(step.clip, { loop: true })).catch(() => {});
                                } catch (_) {
                                    /* the next step moves on regardless */
                                }
                            });
                    }
                }
            } else if (step.pose === 'turn') {
                // Fail soft: a show does not end because she cannot turn round here; it goes on.
                const turner = turnerOf(s);
                if (turner) turner.toggle();
                else console.warn('[Private] a show turn was skipped: nothing can turn her here');
            } else {
                stopShowClip(s, r);
                ok = Boolean(s.poses.apply(step.pose, { duration: R.BLEND_S / r.speed }).ok);
            }
        } catch (error) {
            console.warn('[Private] a show step could not run', error);
            ok = false;
        }
        if (!ok) {
            stopRoutine(s);
            emit();
            return;
        }
        watchDoggy(s);
        emit();
        r.stepAt = Date.now();
        r.timer = (s.win.setTimeout || setTimeout)(() => nextStep(s, r), step.hold / r.speed);
    }

    function turnerOf(s) {
        if (s.turner !== undefined) return s.turner;
        const haul = pick(s.win, 'NEXUS_TRY_ON_HAUL_ACTIVITY', '../../wardrobe/TryOnHaulActivity.js');
        const manager = s.win && s.win.NEXUS_VIEWER && s.win.NEXUS_VIEWER.avatarManager;
        s.turner =
            haul && typeof haul.makeTurner === 'function' && manager && 'currentRoot' in manager
                ? haul.makeTurner(manager, s.win)
                : null;
        return s.turner;
    }

    function faceFront(s) {
        try {
            if (s.turner && typeof s.turner.reset === 'function') s.turner.reset();
        } catch (_) {
            /* she faces wherever the turner left her */
        }
    }

    const ORIGINAL = { original: true };

    async function redress(s, action, alive) {
        if (!s.closet) return settle(action, 'failed', 'wardrobe-not-ready');
        if (!s.dressedLook) return settle(action, 'failed', 'already-dressed');
        const back = s.dressedLook;
        if (s.poses) s.poses.release(); // dressed again, she stands, facing them
        faceFront(s);
        const out = back === ORIGINAL ? await s.closet.wearOriginal(alive) : await s.closet.wearLook(back, alive);
        if (out.ok) s.dressedLook = null;
        return settle(
            action,
            out.ok ? 'completed' : out.why === 'stale' ? 'blocked' : 'failed',
            out.ok ? null : out.why,
            { name: back === ORIGINAL ? '' : back.name || '' }
        );
    }

    function pose(s, action) {
        if (!s.poses) return settle(action, 'failed', 'no-pose-system');
        if (action.params.pose === 'stand') {
            s.poses.release();
            faceFront(s);
            return settle(action, 'completed', null, { name: 'stand' });
        }
        if (action.params.pose === 'turn') {
            const turner = turnerOf(s);
            if (!turner) return settle(action, 'failed', 'no-turn');
            // UN5. A held position turns with her, in place: "girati" on all fours shows her back
            // on all fours. (UN21 stood her up first; the real-page audit measured every such turn
            // as a position reported done while nothing held her. A seated chat posture, which is
            // the motion engine's, still stands up first: MotionIntegration.execute.)
            const back = turner.toggle();
            return settle(action, 'completed', null, { name: back ? 'turned' : 'front' });
        }
        if (action.params.pose === 'back') {
            const out = s.poses.back();
            return settle(action, out.ok ? 'completed' : 'failed', out.ok ? null : out.why, { name: out.pose || '' });
        }
        // NL1. A position that was asked for and that this build does not have: nothing runs, and
        // the reply is told so. `ask` is set when the words fit more than one preset.
        if (action.params.pose === 'unknown')
            return settle(action, 'failed', action.params.ask ? 'ambiguous-pose' : 'unsupported-pose', {
                name: action.params.said || '',
                ask: action.params.ask || '',
            });
        // NL1. A Pose Studio preset by name goes the same way as the keyed ones: one controller.
        const key =
            action.params.pose === 'preset' && typeof s.poses.presetKey === 'function'
                ? s.poses.presetKey(action.params.preset || '')
                : action.params.pose;
        const named = (typeof s.poses.describe === 'function' && s.poses.describe(key)) || null;
        const shown = named && action.params.pose === 'preset' ? named.label : action.params.pose;
        const out = s.poses.apply(key);
        if (!out.ok || typeof s.poses.confirm !== 'function')
            return settle(action, out.ok ? 'completed' : 'failed', out.ok ? null : out.why, {
                name: shown,
            });
        // UN6. Success only once the renderer shows it. A pose that did not land is taken back:
        // she returns to the position she held before (or stands), and the reply says it failed.
        return s.poses.confirm(key).then((seen) => {
            if (state !== s) return settle(action, 'blocked', 'stale');
            // NL1. Another position was asked for while this one was being checked: it is not
            // a failure of this one, and the newer request owns her body.
            if (seen && seen.why === 'superseded') return settle(action, 'blocked', 'stale');
            if (seen && seen.ok) return settle(action, 'completed', null, { name: shown, seen: seen.seen || null });
            try {
                s.poses.back();
            } catch (_) {
                /* she keeps whatever she shows; the failure is still reported */
            }
            return settle(action, 'failed', (seen && seen.why) || 'not-rendered', {
                name: shown,
                measured: seen && seen.measured,
            });
        });
    }

    /** NL1. What the parser needs to read a position request: the live catalogue, the language. */
    function poseContext(s) {
        const Commands = pick(s.win, 'NEXUS_POSE_COMMANDS', '../../xr/PoseCommands.js');
        let catalogue = [];
        let hit = false;
        try {
            catalogue = Commands && typeof Commands.catalogueFrom === 'function' ? Commands.catalogueFrom(s.win) : [];
        } catch (_) {
            catalogue = [];
        }
        try {
            const fast = s.win && s.win.NEXUS_INTENT_FASTPATH;
            hit = Boolean(fast && typeof fast.match === 'function' && fast.match(s.turnText || ''));
        } catch (_) {
            hit = false;
        }
        return {
            poseCatalogue: catalogue,
            lang: Commands && typeof Commands.langKey === 'function' ? Commands.langKey(localeOf(s.win)) : 'en',
            fastPathHit: hit,
        };
    }

    /**
     * UN19. Which look answers this undress request, and which state it is: `bare` (her authored
     * body, nothing on) or `lingerie`. A request for everything is answered only by her bare
     * look; without one the plan has no look and says `no-bare-look` — lingerie is never
     * substituted for complete removal.
     */
    function nextLayer(s, params) {
        const Engine = pick(s.win, 'NEXUS_OUTFIT_DECISION_ENGINE', './OutfitDecisionEngine.js');
        const rank = allureOf(s);
        if (!Engine || typeof Engine.undressPlan !== 'function' || !rank)
            return { look: null, state: null, why: 'last-layer' };
        const looks = (s.closet && s.closet.looks) || [];
        if (params && params.look) {
            const named = looks.find((l) => String(l.name || '') === params.look);
            if (named) return { look: named, state: Engine.isBare(named) ? 'bare' : 'lingerie', why: null };
        }
        return Engine.undressPlan({
            looks,
            current: s.closet && typeof s.closet.current === 'function' ? s.closet.current() : null,
            step: (params && params.step) || 'next',
            naked: Boolean(params && params.naked),
            allureOf: rank,
        });
    }

    async function undress(s, action, alive) {
        if (!s.closet) return settle(action, 'failed', 'wardrobe-not-ready');
        const opened = await s.closet.open();
        if (!alive()) return settle(action, 'blocked', 'stale');
        if (!opened.ok) return settle(action, 'failed', opened.why);
        if (!s.closet.privateOpen) return settle(action, 'failed', 'adult-ineligible');
        const plan = nextLayer(s, action.params);
        const look = plan.look;
        // Nothing changes: what she has on stays, and the reason is told (no-bare-look, last-layer).
        // CG1. With no bare look, Forge's answer for her exact file says why, so the person sees
        // what this character needs rather than a generic failure: her file awaits a review, or a
        // review found it not clearly adult. Scoped to her; nothing else in Private changes.
        if (!look) {
            let why = plan.why || 'last-layer';
            const body = s.closet.bodyState && s.closet.bodyState.status;
            if (why === 'no-bare-look' && body === 'needs-review') why = 'bare-needs-review';
            else if (why === 'no-bare-look' && body === 'blocked') why = 'bare-blocked';
            return settle(action, 'failed', why);
        }
        const Engine = pick(s.win, 'NEXUS_OUTFIT_DECISION_ENGINE', './OutfitDecisionEngine.js');
        const bare = plan.state === 'bare';
        // UN5. What she wore before the first layer came off is what "rivestiti" puts back.
        if (!s.dressedLook) s.dressedLook = s.closet.current() || ORIGINAL;
        const out = await keepingPose(s, () => s.closet.wearLook(look, alive));
        // UN19. The renderer's answer before anything is announced: the look the wardrobe now
        // reports on her is the one asked for, and for bare it is her bare look.
        let worn = null;
        try {
            worn = typeof s.closet.current === 'function' ? s.closet.current() : null;
        } catch (_) {
            worn = null;
        }
        const keyOf = Engine && typeof Engine.keyOf === 'function' ? Engine.keyOf : (l) => l && (l.lookId || l.id);
        let rendered = Boolean(out.ok && worn && keyOf(worn) === keyOf(look) && (!bare || Engine.isBare(worn)));
        // BL2. For bare, the loaded asset itself must show no garment Forge put on her. (Its
        // bytes were already checked against Forge's hash by the controller before loading.)
        if (rendered && bare && typeof s.closet.renderedGarments === 'function') {
            const garments = s.closet.renderedGarments();
            if (typeof garments === 'number' && garments > 0) rendered = false;
        }
        if (out.ok && !rendered) {
            // What is on her is not what was asked for: back to the look she had, and say so.
            try {
                if (typeof s.closet.undo === 'function') await s.closet.undo();
            } catch (_) {
                /* the session's own end restores her */
            }
            return settle(action, 'failed', 'not-rendered', { name: look.name || '' });
        }
        if (out.ok) s.offer = null;
        return settle(
            action,
            out.ok ? 'completed' : out.why === 'stale' ? 'blocked' : 'failed',
            out.ok ? null : out.why,
            { name: look.name || '', bare, state: plan.state, covers: coveredBy(s, look) }
        );
    }

    /**
     * UN17. The one look the evening's outfit theme suggests, while nothing about her clothes has
     * happened yet this session — no request, no offer, no change. Once anything has, it is the
     * person's evening and the theme is quiet. Never a change on its own: a line in her prompt.
     */
    function themeSuggestion(s) {
        if (!s.story || !s.story.outline || !s.closet || s.story.phase === 'epilogue') return null;
        if (s.log.some((a) => a.family === 'wardrobe') || (s.offer && s.offer.kind !== 'travel')) return null;
        const Engine = pick(s.win, 'NEXUS_OUTFIT_DECISION_ENGINE', './OutfitDecisionEngine.js');
        if (!Engine || typeof Engine.themeLook !== 'function') return null;
        try {
            const here = s.story.snapshot().shown || '';
            const place = (s.places || []).find((p) => p.id === here);
            const look = Engine.themeLook(s.story.outline.outfitTheme, s.closet.looks || [], {
                venue: `${here} ${(place && place.title) || ''}`,
                current: typeof s.closet.current === 'function' ? s.closet.current() : null,
            });
            return look ? String(look.name || '') || null : null;
        } catch (_) {
            return null;
        }
    }

    function wardrobeState(s) {
        const Engine = pick(s.win, 'NEXUS_OUTFIT_DECISION_ENGINE', './OutfitDecisionEngine.js');
        try {
            const worn = s.closet && typeof s.closet.current === 'function' ? s.closet.current() : null;
            return Engine && typeof Engine.outfitState === 'function' ? Engine.outfitState(worn, allureOf(s)) : null;
        } catch (_) {
            return null;
        }
    }

    /**
     * UN20. The control that moves the evening closer, as the person sees it ("Più vicino"), for
     * the lines where she tells them how undressing opens. Pointing at it is hers; moving it is
     * only ever theirs (intensity is ConsentFlow's alone).
     */
    function closerLabel(s) {
        try {
            const loc = s && s.win && s.win.NEXUS_PRIVATE_LOCALE;
            const label = loc && typeof loc.t === 'function' ? String(loc.t('controls.closer') || '') : '';
            const clean = label.replace(/\s*[→>]+\s*$/u, '').trim();
            return clean && clean !== 'controls.closer' ? clean : 'Closer';
        } catch (_) {
            return 'Closer';
        }
    }
    /**
     * UN27. The closer positions this session can run: `PrivatePoseController.INTIMATE`, kept to
     * the ones the pose system lists now. A controller without `available` (a test double) is
     * taken at its word.
     */
    function closerPositions(s) {
        try {
            const Poses = pick(s.win, 'NEXUS_PRIVATE_POSES', './PrivatePoseController.js');
            const all = (Poses && Poses.INTIMATE) || [];
            if (!s.poses) return [];
            if (typeof s.poses.available !== 'function') return all.slice();
            return all.filter((p) => s.poses.available(p.key));
        } catch (_) {
            return [];
        }
    }

    /** UN28. The step of the pace a keyed position opens at (`PrivateActionPolicy.POSE_LEVEL`). */
    function poseLevelOf(s, key) {
        try {
            const Policy = pick(s.win, 'NEXUS_PRIVATE_ACTION_POLICY', './PrivateActionPolicy.js');
            return Policy && typeof Policy.poseLevel === 'function' ? Policy.poseLevel(key) : UNDRESS_AT;
        } catch (_) {
            return UNDRESS_AT;
        }
    }

    /**
     * UN28. Easing off means easing off. When the pace is lowered (Ease up, cozy) below the step
     * the position she holds opened at, she stands — through this bridge, as the person's own
     * control, like every other action. Called after every repaint of the pace; does nothing when
     * what she holds is still open, or when she holds nothing. Never raises or lowers the level.
     */
    function fitPoseToPace() {
        fitSkinToPace();
        const s = state;
        // UN36. Easing below what a running show needs stops it where it is.
        if (s && routineState(s) === 'running') {
            const R = routinesOf(s);
            if (R && R.level(s.routine.id, poseLevelFn(s)) > (levelOf(s) || 1)) stopRoutine(s);
        }
        if (!s || s.session._stopped || !s.poses || typeof s.poses.held !== 'function') return false;
        const held = s.poses.held();
        if (!held) return false;
        const need = poseLevelOf(s, held);
        if (!need || levelOf(s) >= need) return false;
        request('avatar.pose', { pose: 'stand' }, { source: 'control' }).catch(() => null);
        return true;
    }

    /** UN35. For callers that move her body outside this bridge (Pose Studio): re-read it. */
    function noticePose() {
        if (state) watchDoggy(state);
    }

    /**
     * UN32. Her skin follows the pace live when the look on stage is a bare look with a skin pack
     * (Forge BD7): Romantic and below closed, Sensual flushed, Intimate open — each only if the
     * pack holds it, else the next listed. Read on every pace repaint; never moves the pace.
     */
    const SKIN_FOR_LEVEL = Object.freeze({
        1: ['closed'],
        2: ['closed'],
        3: ['flushed', 'aroused'],
        4: ['open', 'aroused', 'flushed'],
    });

    function skinSwitcher(s) {
        if (s.skin) return s.skin;
        const Skin = pick(s.win, 'NEXUS_SKIN_STATES', '../../wardrobe/SkinStateSwitcher.js');
        if (!Skin || typeof Skin.create !== 'function') return null;
        const forge = (() => {
            try {
                return s.win.NEXUS_WARDROBE.service.controller.forge;
            } catch (_) {
                return null;
            }
        })();
        s.skin = Skin.create({
            fetch: s.win.fetch && s.win.fetch.bind(s.win),
            headersFor: async (url) =>
                forge && typeof forge.downloadHeadersNow === 'function' ? forge.downloadHeadersNow(url) : {},
        });
        return s.skin;
    }

    function syncSkin(s) {
        try {
            const look = s.closet && typeof s.closet.current === 'function' ? s.closet.current() : null;
            if (look === s.skinLook) return;
            s.skinLook = look;
            s.skinStates = [];
            clearAfterglow(s); // another look starts from the pace, not from the last one's afterglow
            clearFinish(s);
            // Codex (#193). Sweat stays only while she is still held on all fours on the new look.
            if (s.doggySweaty || s.doggyTimer) {
                let held = null;
                try {
                    held = s.poses && typeof s.poses.held === 'function' ? s.poses.held() : null;
                } catch (_) {
                    held = null;
                }
                if (held !== 'all-fours') stopDoggy(s);
            }
            s.skinLevel = null;
            const Skin = pick(s.win, 'NEXUS_SKIN_STATES', '../../wardrobe/SkinStateSwitcher.js');
            if (!look || !Skin || !Skin.mayHavePack(look)) {
                if (s.skin) s.skin.detach();
                return;
            }
            const switcher = skinSwitcher(s);
            const root =
                s.win.NEXUS_VIEWER && s.win.NEXUS_VIEWER.avatarManager && s.win.NEXUS_VIEWER.avatarManager.currentRoot;
            if (!switcher || !root) return;
            switcher
                .attach(root, look)
                .then((states) => {
                    if (state !== s || s.skinLook !== look) return;
                    s.skinStates = states || [];
                    fitSkinToPace();
                    emit(); // UN35. the ⋯ menu's finish chips follow what the pack holds
                })
                .catch((error) => console.warn('[Private] skin pack not attached', error));
        } catch (error) {
            console.warn('[Private] skin states skipped', error);
        }
    }

    /**
     * UN33. Afterglow fades. Coming down from Intimate, her body does not snap back to closed: when
     * the pack holds it she shows `afterglow` (flushed, nipples still hard, wet, a little open) for
     * a few minutes, then cools to `flushed`, then settles to what the pace shows. Going back up to
     * Intimate ends the fade at once. The timers live on the session and die with it (or with the
     * look); they only ever re-read the pace, never move it.
     */
    const AFTERGLOW_MS = 4 * 60 * 1000;
    const COOLING_MS = 3 * 60 * 1000;

    function clearAfterglow(s) {
        if (s && s.afterglow) {
            try {
                (s.win.clearTimeout || clearTimeout)(s.afterglow.timer);
            } catch (_) {
                /* already fired */
            }
        }
        if (s) s.afterglow = null;
    }

    function startAfterglow(s, names) {
        clearAfterglow(s);
        const later = (fn, ms) => (s.win.setTimeout || setTimeout)(fn, ms);
        const step = () => {
            if (state !== s || !s.afterglow) return;
            if (s.afterglow.stage === 'afterglow' && names.includes('flushed')) {
                s.afterglow.stage = 'flushed';
                s.afterglow.timer = later(step, COOLING_MS);
            } else {
                s.afterglow = null;
            }
            fitSkinToPace();
        };
        s.afterglow = { stage: 'afterglow', timer: later(step, AFTERGLOW_MS) };
    }

    function fitSkinToPace() {
        const s = state;
        if (!s || !s.skin || !s.skinStates || !s.skinStates.length) return false;
        const names = s.skinStates.map((x) => x.name);
        const level = Math.max(1, Math.min(4, levelOf(s) || 1));
        const was = s.skinLevel;
        s.skinLevel = level;
        if (level >= 4) clearAfterglow(s);
        else if (was >= 4 && names.includes('afterglow') && !s.finish) startAfterglow(s, names);
        const fading = s.afterglow && names.includes(s.afterglow.stage) ? s.afterglow.stage : null;
        // UN34. Where they finished stays on her through pace changes until its hold ends.
        const finished = s.finish && names.includes(s.finish.state) ? s.finish.state : null;
        // UN35. Held on all fours a while at Sensual or closer: sweat builds on her back.
        const sweating =
            s.doggySweaty && level >= 3
                ? (level >= 4 ? ['doggy-sweaty-open', 'doggy-sweaty'] : ['doggy-sweaty']).find((n) => names.includes(n))
                : null;
        // UN37. Held in missionary or cowgirl at the closest step: wet, open and flushed for it.
        const held = level >= 4 ? (HELD_SKIN[poseGroup(s)] || []).find((n) => names.includes(n)) : null;
        const want =
            finished || fading || sweating || held || (SKIN_FOR_LEVEL[level] || []).find((n) => names.includes(n));
        if (!want || s.skin.current() === want) return false;
        s.skin.apply(want).catch((error) => console.warn('[Private] skin state not applied', error));
        return true;
    }

    /**
     * UN34. Where they finished, as her body can show it: the skin-pack states for each place, best
     * first. Doggy states lead (the position this is most asked in), then the general ones; the
     * first the look's pack holds is shown. Names are Forge's (assets/body_detail/states.json).
     */
    const FINISH_STATES = Object.freeze({
        back: ['lower-back-cum-heavy', 'lower-back-cum', 'lower-back-cum-open', 'cum-on-back', 'doggy-cum-covered'],
        inside: ['doggy-creampie', 'lower-back-cum-creampie', 'creampie', 'doggy-double-creampie', 'cum'],
        ass: ['anal-creampie', 'doggy-anal-fisted-cum', 'lower-back-cum-gaping', 'doggy-double-creampie'],
        both: ['doggy-double-creampie', 'doggy-anal-fisted-cum', 'doggy-open-cum', 'doggy-finish'],
        all: [
            'doggy-finish',
            'doggy-cum-covered',
            'sado-full',
            'doggy-gaping-cum',
            'sado-used-cum',
            'missionary-covered',
            'cowgirl-everything',
        ],
        // UN37. Facing them (Forge BD20).
        belly: ['missionary-belly', 'cowgirl-belly'],
        chest: ['missionary-chest', 'missionary-covered'],
    });

    /**
     * UN37. The position she holds decides how it lies on her: lying back it runs off her sides and
     * down to her anus (missionary), upright on top it runs down her belly and her thighs
     * (cowgirl), on all fours it runs forward and up her spine (the doggy states above). Tried
     * before the general lists; the order of places for "I'm coming" alone follows the position.
     */
    const POSE_GROUP = Object.freeze({
        'all-fours': 'doggy',
        'knees-up': 'missionary',
        'lie-back': 'missionary',
        straddle: 'cowgirl',
    });
    const FINISH_BY_POSE = Object.freeze({
        missionary: {
            inside: ['missionary-creampie'],
            belly: ['missionary-belly'],
            chest: ['missionary-chest'],
            all: ['missionary-covered'],
        },
        cowgirl: {
            inside: ['cowgirl-creampie'],
            belly: ['cowgirl-belly'],
            all: ['cowgirl-everything'],
        },
    });
    const CHOOSE_BY_POSE = Object.freeze({
        doggy: ['back', 'inside', 'both', 'ass', 'all'],
        missionary: ['belly', 'inside', 'chest', 'all'],
        cowgirl: ['inside', 'belly', 'chest', 'all'],
    });
    /** UN37. While she holds one of these at the closest step, her skin shows it (Forge BD20). */
    const HELD_SKIN = Object.freeze({ missionary: ['missionary-open'], cowgirl: ['cowgirl-riding'] });

    function poseGroup(s) {
        try {
            return POSE_GROUP[s.poses && typeof s.poses.held === 'function' ? s.poses.held() : null] || null;
        } catch (_) {
            return null;
        }
    }
    /** SW5. How many replies after the finish keep the aftercare line. */
    const AFTERCARE_TURNS = 3;
    /** How long where they finished stays on her before the afterglow fade (UN33) takes over. */
    const FINISH_HOLD_MS = 6 * 60 * 1000;
    /** UN34. Without a place: what this look can show, the lower back first (asked for most). */
    const FINISH_ORDER = ['back', 'inside', 'both', 'ass', 'all', 'belly', 'chest'];

    /**
     * UN35. Again, while the first is still on her: a second load (Forge BD19) instead of showing
     * the first one a second time, which read as nothing having happened.
     */
    const AGAIN_AFTER_MS = 30 * 1000;
    const AGAIN_STATES = Object.freeze({
        back: ['lower-back-cum-second'],
        inside: ['doggy-second-creampie'],
    });

    function finishState(s, where) {
        const names = (s.skinStates || []).map((x) => x.name);
        const group = poseGroup(s);
        const places = where === 'choose' ? CHOOSE_BY_POSE[group] || FINISH_ORDER : [where];
        // Again only from a later turn and after a real pause: the same line heard twice, or two
        // quick messages about one climax, are one finish, never a second load.
        const again = Boolean(s.finish && s.finish.turnId !== s.turnId && Date.now() - s.finish.at >= AGAIN_AFTER_MS);
        for (const place of places) {
            // Said again too soon for a second load: what is shown stays (never back to the first).
            if (s.finish && !again && s.finish.place === place && names.includes(s.finish.state))
                return { place, state: s.finish.state };
            const second = again ? (AGAIN_STATES[place] || []).find((n) => names.includes(n)) : null;
            if (second) return { place, state: second };
            const posed = ((FINISH_BY_POSE[group] || {})[place] || []).find((n) => names.includes(n));
            if (posed) return { place, state: posed };
            const found = (FINISH_STATES[place] || []).find((n) => names.includes(n));
            if (found) return { place, state: found };
        }
        return null;
    }

    /**
     * PS2. Their fist, as her body can show it: Forge's fisted states (assets/body_detail/
     * states.json) by the position she holds, best first, and the first the look's pack holds is
     * shown. Lying back it is the missionary states; on all fours the doggy ones; otherwise
     * whichever exists. Stays until her skin changes again (a finish, the pace, the afterglow).
     */
    const FIST_STATES = Object.freeze({
        doggy: { front: ['doggy-both-fisted'], anal: ['doggy-anal-fisted'], both: ['doggy-both-fisted'] },
        missionary: {
            front: ['missionary-fisted'],
            anal: ['missionary-fisted-anal'],
            both: ['missionary-fisted', 'missionary-fisted-anal'],
        },
    });
    /*
     * Codex (#200). What each target may show when her position has none of its own: never a
     * different act (an anal request showed the front state). Asked for one target and it cannot
     * be shown: nothing is, and they are told in words.
     */
    const FIST_BY_TARGET = Object.freeze({
        front: ['missionary-fisted'],
        anal: ['doggy-anal-fisted', 'missionary-fisted-anal'],
        both: ['doggy-both-fisted'],
    });

    function fistState(s, where) {
        const names = (s.skinStates || []).map((x) => x.name);
        const group = poseGroup(s);
        const byPose = FIST_STATES[group] || null;
        const asked = where && where !== 'choose' ? where : null;
        const targets = asked ? [asked] : group === 'doggy' ? ['anal', 'both', 'front'] : ['front', 'anal', 'both'];
        for (const target of targets) {
            const ordered = [...((byPose && byPose[target]) || []), ...FIST_BY_TARGET[target]];
            const found = ordered.find((n) => names.includes(n));
            if (found) return found;
        }
        return null;
    }

    function fistOn(s, action) {
        if (!s.skin || !s.skinStates || !s.skinStates.length) return settle(action, 'failed', 'no-skin-pack');
        const chosen = fistState(s, action.params && action.params.where);
        if (!chosen) return settle(action, 'failed', 'no-fist-state');
        s.fist = { state: chosen, turnId: action.turnId, at: Date.now() };
        action.result = { state: chosen };
        return Promise.resolve(s.skin.apply(chosen))
            .then((ok) => settle(action, ok ? 'completed' : 'failed', ok ? null : 'not-shown', action.result))
            .catch(() => settle(action, 'failed', 'not-shown'));
    }

    function finishOn(s, action) {
        if (!s.skin || !s.skinStates || !s.skinStates.length) return settle(action, 'failed', 'no-skin-pack');
        const chosen = finishState(s, action.params.where);
        if (!chosen) return settle(action, 'failed', 'no-finish-state');
        clearAfterglow(s);
        clearFinish(s);
        const later = (fn, ms) => (s.win.setTimeout || setTimeout)(fn, ms);
        s.finish = {
            state: chosen.state,
            place: chosen.place,
            turnId: action.turnId,
            at: Date.now(),
            timer: later(() => {
                if (state !== s || !s.finish) return;
                s.finish = null;
                // Then the UN33 fade: afterglow, flushed, the pace — if the pack has them.
                const names = s.skinStates.map((x) => x.name);
                if (names.includes('afterglow')) startAfterglow(s, names);
                fitSkinToPace();
                emit();
            }, FINISH_HOLD_MS),
        };
        action.result = { place: chosen.place, state: chosen.state };
        return Promise.resolve(s.skin.apply(chosen.state))
            .then((ok) => settle(action, ok ? 'completed' : 'failed', ok ? null : 'not-shown', action.result))
            .catch(() => settle(action, 'failed', 'not-shown'));
    }

    /**
     * UN35. How long she is held on all fours before sweat shows on her back. Watched from the
     * position she holds (read, never set): taken, the clock starts; any other position, standing
     * or the end of the session stops it, and her skin goes back to what the pace shows.
     */
    const DOGGY_SWEAT_MS = 150 * 1000;

    function watchDoggy(s) {
        if (!s || !s.poses || typeof s.poses.held !== 'function') return;
        let held = null;
        try {
            held = s.poses.held();
        } catch (_) {
            held = null;
        }
        if (held === 'all-fours') {
            if (s.doggyTimer || s.doggySweaty) return;
            s.doggyTimer = (s.win.setTimeout || setTimeout)(() => {
                s.doggyTimer = null;
                if (state !== s) return;
                let still = null;
                try {
                    still = s.poses.held();
                } catch (_) {
                    still = null;
                }
                if (still !== 'all-fours') return;
                s.doggySweaty = true;
                fitSkinToPace();
                emit();
            }, DOGGY_SWEAT_MS);
            return;
        }
        stopDoggy(s);
        fitSkinToPace();
    }

    function stopDoggy(s) {
        if (!s) return;
        if (s.doggyTimer) {
            try {
                (s.win.clearTimeout || clearTimeout)(s.doggyTimer);
            } catch (_) {
                /* already fired */
            }
        }
        s.doggyTimer = null;
        s.doggySweaty = false;
    }

    function clearFinish(s) {
        if (s && s.finish) {
            try {
                (s.win.clearTimeout || clearTimeout)(s.finish.timer);
            } catch (_) {
                /* already fired */
            }
        }
        if (s) s.finish = null;
    }

    /** UN32. Her skin's state right now, for the reply: the pack's own line, when not closed. */
    function skinLine(s) {
        if (!s.skin || !s.skinStates) return null;
        const now = s.skin.current();
        if (!now || now === 'closed') return null;
        const entry = s.skinStates.find((x) => x.name === now);
        return entry && entry.body ? entry.body : null;
    }

    /** UN27. What her body is doing in the position this action asked for, or `null`. */
    function bodyOf(s, action) {
        try {
            if (!s.poses || typeof s.poses.describe !== 'function' || !action || !action.params) return null;
            const key =
                action.params.pose === 'preset' && typeof s.poses.presetKey === 'function'
                    ? s.poses.presetKey(action.params.preset || '')
                    : action.params.pose;
            const named = s.poses.describe(key);
            return (named && named.body) || null;
        } catch (_) {
            return null;
        }
    }

    function closerControl(s) {
        return `the “${closerLabel(s)}” control`;
    }

    /** UN19. What the wardrobe reports on her right now, for a line that must not be wrong. */
    function currentName(s) {
        try {
            const worn = s.closet && typeof s.closet.current === 'function' ? s.closet.current() : null;
            return worn && worn.name ? `“${worn.name}”` : 'your own outfit';
        } catch (_) {
            return 'what you had on';
        }
    }

    /** UN14. The regions a look covers, from Forge's templates (WardrobeCoverage); [] when unknown. */
    function coveredBy(s, look) {
        const Coverage = pick(s.win, 'NEXUS_WARDROBE_COVERAGE', './WardrobeCoverage.js');
        try {
            const facts = look && (look.coverage !== undefined ? look.coverage : Coverage && Coverage.describe(look));
            return facts && Array.isArray(facts.regions) ? facts.regions.slice() : [];
        } catch (_) {
            return [];
        }
    }

    const REGION_WORDS = {
        chest: 'chest',
        waist: 'waist',
        hips: 'hips',
        upperLegs: 'thighs',
        lowerLegs: 'calves',
        upperArms: 'upper arms',
        lowerArms: 'forearms',
        shoulders: 'shoulders',
        feet: 'feet',
    };
    function regionText(regions) {
        const words = (regions || []).map((r) => REGION_WORDS[r] || r);
        return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0] || '';
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
        if (action.name === 'avatar.routine') {
            // PP1. Her own show tag is an invitation, never a start: offered only when the show is
            // open at the pace now and switched on; their yes runs it as their request.
            const id = action.params && action.params.routine;
            if (id && id !== 'choose') offerShowNow(s, id);
            return;
        }
        if (action.family === 'world') {
            // UN4. Her invitation: the place she named, if it is one of tonight's places.
            if (!s.canTravel || s.travel) return;
            // UN9. Once they said the evening is drawing to a close she proposes nothing new;
            // the person can still ask to go, which is their request, not her invitation.
            if (s.story && s.story.phase === 'epilogue') return;
            const place = resolvePlace(s, action.params.world);
            const here = s.story ? s.story.snapshot().shown : null;
            if (place && place.id !== here) travelOffer(s, place, action);
            return;
        }
        if (!s.closet || action.family !== 'wardrobe') return;
        try {
            const opened = await s.closet.open();
            if (state !== s || !opened.ok) return;
            if (action.name === 'wardrobe.undress') {
                // UN1. Her idea, at level 4, under SUGGEST: the layer is resolved now and offered;
                // the yes runs it as an undress again, so the level is checked a second time.
                if (!s.closet.privateOpen) return;
                const look = nextLayer(s, action.params).look;
                if (look)
                    s.offer = {
                        kind: 'wear',
                        undress: true,
                        look,
                        name: look.name || '',
                        turnId: s.turnId,
                        from: action.id,
                    };
            } else if (action.name === 'wardrobe.wear') {
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

    /**
     * PP1. Invite them to one of her shows: an offer their yes, the card's button or their own
     * words take. Only a show that exists, is switched on (MP1) and is open at the pace now; never
     * over an outfit offer still waiting for its answer, and never in care.
     */
    function offerShowNow(s, id) {
        const R = routinesOf(s);
        if (!R || !R.ROUTINES || !R.ROUTINES[id] || s.session._care) return false;
        if (typeof R.available === 'function' && !R.available(id)) return false;
        if (R.level(id, poseLevelFn(s)) > (levelOf(s) || 1)) return false;
        if (s.offer && s.offer.kind !== 'show') return false;
        if (routineState(s) === 'running') return false;
        s.offer = { kind: 'show', routine: id, name: R.ROUTINES[id].label, turnId: s.turnId };
        emit();
        return true;
    }

    function offerShow(id) {
        return state ? offerShowNow(state, String(id || '')) : false;
    }

    /** The person said yes to what was offered (their words, or the chip). */
    async function approveOffer(source) {
        const s = state;
        if (!s || !s.offer) return null;
        touched(s);
        const offer = s.offer;
        s.offer = null;
        if (offer.kind === 'show') {
            // PP1. Their yes is the show: asked of the policy and the pace again, as their approval.
            return request(
                'avatar.routine',
                { routine: offer.routine, move: 'start' },
                { source: source === 'control' ? 'control' : 'user-approved', turnId: s.turnId }
            );
        }
        if (offer.kind === 'travel') {
            // UN4. Their yes is the trip: asked again of the policy, as `user-approved`.
            return request(
                'world.travel',
                { world: offer.world },
                {
                    source: source === 'control' ? 'control' : 'user-approved',
                    turnId: s.turnId,
                }
            );
        }
        seq += 1;
        const action = {
            id: `act-${Date.now().toString(36)}-${seq}`,
            sessionId: s.sessionId,
            turnId: s.turnId,
            name: offer.undress
                ? 'wardrobe.undress'
                : offer.kind === 'wear'
                  ? 'wardrobe.wear'
                  : offer.spec.change
                    ? 'wardrobe.change'
                    : 'wardrobe.create',
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
            if (offer.undress) {
                // UN5. Through the undress step itself: it remembers what she wore and keeps her pose.
                await undress(s, action, alive);
            } else if (offer.kind === 'wear') {
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
        if (state.offer.kind === 'travel' && state.story) state.story.decline();
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
        touched(s);
        const intent = turn && turn.intent;
        if (intent === 'end' || intent === 'pace-down') {
            // Codex (#196). Easing off (or hesitating) stills her too: a position allowed at the
            // lower step stays held, and the movement they had asked for must not go on under it.
            if (s.moving) {
                s.moving = null;
                emit();
            }
            return null;
        }
        const Intent = pick(s.win, 'NEXUS_PRIVATE_ACTION_INTENT', './PrivateActionIntent.js');
        if (!Intent) return null;

        // UN9. The evening's own cues move nothing in the world: the epilogue changes how she
        // speaks, and forgetting erases only the between-evenings outline history.
        const cue = typeof Intent.storyCue === 'function' ? Intent.storyCue(s.turnText) : null;
        if (cue === 'epilogue' && s.story && s.story.epilogue()) {
            s.offer = null;
            s.storyNews = { kind: 'epilogue', turnId: s.turnId };
            emit();
            return null;
        }
        if (cue === 'forget') {
            const Weaver = pick(s.win, 'NEXUS_STORY_WEAVER', '../../features/together/StoryWeaver.js');
            let done = false;
            try {
                done = Boolean(Weaver && typeof Weaver.forget === 'function' && (Weaver.forget(s.win), true));
            } catch (_) {
                done = false;
            }
            s.storyNews = { kind: done ? 'forgotten' : 'not-forgotten', turnId: s.turnId };
            emit();
            return null;
        }

        // An offer waits two turns for an answer, then stops waiting.
        if (s.offer && s.turnId - s.offer.turnId > OFFER_TURNS) s.offer = null;
        const travelling = s.offer && s.offer.kind === 'travel';
        const yes =
            intent === 'affirmation' ||
            (travelling && typeof Intent.affirmsGoing === 'function'
                ? Intent.affirmsGoing(s.turnText)
                : typeof Intent.affirms === 'function' && Intent.affirms(s.turnText));
        if (s.offer && yes && !s.session._care) {
            s.asked[travelling ? 'world' : s.offer.kind === 'show' ? 'avatar' : 'wardrobe'] = s.turnId;
            return approveOffer('user');
        }
        // UN4. A trip not taken: the next turn that is not a yes closes the invitation.
        if (travelling && s.turnId > s.offer.turnId) {
            s.offer = null;
            if (s.story) s.story.decline();
        }

        const media = s.media ? s.media.status() : { status: 'idle' };
        const closet = s.closet ? s.closet.snapshot() : { canUndo: false };
        const parsed = Intent.parse(s.turnText, {
            musicStatus: media.status,
            canUndoOutfit: closet.canUndo,
            lastFamily: s.offer ? 'wardrobe' : s.lastFamily,
            poseHeld: Boolean(s.poses && typeof s.poses.held === 'function' && s.poses.held()),
            undressed: Boolean(s.dressedLook),
            ...poseContext(s),
            routine: routineState(s),
            moving: Boolean(movingNow(s)),
        });
        const topic = typeof Intent.topic === 'function' ? Intent.topic(s.turnText) : null;
        s.topic = topic;
        s.topicTurn = s.turnId;
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

    /**
     * UN6. Are these words a position for her body that Private will take? The composer hands
     * every utterance to the motion fast path BEFORE the conversation reaches this bridge, so
     * "sdraiati sul fianco" first started the chat stack's lie-down clip and set its `laying`
     * state; the pose system then claimed her mid-clip. On "alzati" the release scheduled
     * `lay_idle` — measured: the pose system said "standing" while her rendered hips were at
     * 0.18 m, crouched. The fast path asks this first and stands aside (look-at only).
     * Pure: parses, changes nothing.
     */
    function ownsBody(text) {
        const s = state;
        if (!s || s.session._stopped || !s.poses) return false;
        const Intent = pick(s.win, 'NEXUS_PRIVATE_ACTION_INTENT', './PrivateActionIntent.js');
        if (!Intent || typeof Intent.parse !== 'function') return false;
        try {
            const parsed = Intent.parse(String(text == null ? '' : text), {
                poseHeld: Boolean(typeof s.poses.held === 'function' && s.poses.held()),
                undressed: Boolean(s.dressedLook),
                ...poseContext(Object.assign({}, s, { turnText: String(text == null ? '' : text) })),
            });
            // NL1. A request that will only be refused (`unknown`) moves nothing: the fast path
            // need not stand aside for it.
            return Boolean(parsed && parsed.name === 'avatar.pose' && parsed.params.pose !== 'unknown');
        } catch (_) {
            return false;
        }
    }

    /** A tag she wrote, routed here instead of to the app-wide executor. */
    function fromModel(name, params) {
        if (!state) return Promise.resolve(null);
        return request(name, params, { source: 'model', turnId: state.turnId });
    }

    /**
     * PX14. What really happened to her outfit on the person's latest turn, for the reply check
     * (TogetherCapability.privateRevise): `changed` once the wardrobe confirmed it, `pending` while
     * it is loading or being made, otherwise why not — `offer` (waiting for their yes), `failed`,
     * or `none` (nothing ran).
     */
    function outfitTruth() {
        const s = state;
        if (!s) return { state: 'none' };
        // UN20. Whether the person's own turn was about her clothes. "Per ora resto come sono."
        // opened a transcript where nobody had asked anything about them: the reply check put an
        // outfit line under a reply that was not about an outfit action. It now speaks only when
        // the person asked, or an action of theirs ran.
        const talked = s.topicTurn === s.turnId && s.topic === 'wardrobe';
        const w = s.wardrobe;
        if (!w || w.turnId !== s.turnId) {
            const offer = s.offer && s.offer.turnId === s.turnId;
            return { state: offer ? 'offer' : 'none', asked: talked };
        }
        const asked = w.source !== 'model';
        if (w.status === 'completed')
            return {
                state: 'changed',
                name: (w.result && w.result.name) || '',
                bare: Boolean(w.result && w.result.bare),
                asked,
            };
        if (w.status === 'pending') return { state: 'pending', asked };
        if (w.why === 'needs-approval') return { state: 'offer', asked };
        // A request overtaken by a newer turn is not an answer to give.
        if (w.why === 'stale') return { state: 'none', asked: false };
        return {
            state: 'failed',
            why: w.why,
            action: w.name,
            naked: Boolean(w.params && (w.params.naked || w.params.step === 'all')),
            asked,
        };
    }

    /**
     * UN22. What happened to a position the person asked for on their latest turn, for the reply
     * check (TogetherCapability.poseTruthful): `done`, `pending`, `failed` (with why: `pace`
     * below the evening's top, a position that did not render, …) or `none`. "Mi metto a quattro
     * zampe." under a refused request read as done while her body stayed standing.
     */
    function poseTruth() {
        const s = state;
        if (!s) return { state: 'none' };
        const mine = [...s.log]
            .reverse()
            .find((a) => a.name === 'avatar.pose' && a.turnId === s.turnId && a.source !== 'model');
        if (!mine) return { state: 'none' };
        if (mine.status === 'completed') return { state: 'done', pose: mine.params && mine.params.pose };
        if (mine.status === 'pending') return { state: 'pending' };
        if (mine.why === 'stale') return { state: 'none' };
        return { state: 'failed', why: mine.why, pose: mine.params && mine.params.pose };
    }

    /**
     * UN20. Wait, briefly, for this turn's outfit action to stop being `pending`.
     *
     * In the real page, "Toglili tutti" was still pending — her looks were being listed — when the
     * reply was checked, so "Le tolgo tutte per te." passed as an action in progress, and the
     * refusal arrived after it as a generic follow-up ("Mm, non è andata. Per ora resto così.").
     * A refusal for no bare look, the last layer or the pace is known within moments: the reply
     * check waits for it, bounded, so she is checked against what happened. A real change (a look
     * loading) outlasts the bound and is still reported as in progress, which is true.
     */
    function whenSettled(ms) {
        const s = state;
        const limit = Math.max(0, Number(ms) || 0);
        if (!s) return Promise.resolve(outfitTruth());
        const turn = s.turnId;
        const busy = () =>
            state === s &&
            s.turnId === turn &&
            s.wardrobe &&
            s.wardrobe.turnId === turn &&
            s.wardrobe.status === 'pending';
        if (!busy() || !limit) return Promise.resolve(outfitTruth());
        return new Promise((resolve) => {
            const started = Date.now();
            const tick = () => {
                if (!busy() || Date.now() - started >= limit) return resolve(outfitTruth());
                setTimeout(tick, 50);
            };
            setTimeout(tick, 50);
        });
    }

    /**
     * UN20. The reply check is done with this turn: `said` is whether the reply shown carries the
     * outcome's reason. If it does, the follow-up line is not spoken; if it does not, and the
     * action has since been refused, it is spoken now — once.
     */
    function explained(said) {
        const s = state;
        if (!s) return;
        const w = s.wardrobe;
        s.replyDue = null;
        if (!w || w.turnId !== s.turnId) return;
        if (said && ['failed', 'blocked'].includes(w.status)) {
            w.toldFailure = true;
            return;
        }
        if (w.heldForReply) {
            w.heldForReply = false;
            followUp(s, w);
        }
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
            // UN19. original | look | lingerie | bare — what is on her, never what was asked for.
            outfitState: wardrobeState(s),
            outfitAction: s.wardrobe
                ? {
                      status: s.wardrobe.status,
                      why: s.wardrobe.why,
                      name: (s.wardrobe.result && s.wardrobe.result.name) || '',
                  }
                : null,
            offer: s.offer
                ? { kind: s.offer.kind, name: s.offer.name, ...(s.offer.routine ? { routine: s.offer.routine } : {}) }
                : null,
            last: s.log.length ? s.log[s.log.length - 1] : null,
            // UN35. Where they can finish that this look can show on her, at the closest step only:
            // the ⋯ menu draws a chip for each, so no chip is offered that could only be refused.
            // The view gates these by the pace it shows (a pace change repaints the menu without a
            // new snapshot, so a list cut to the pace here went stale and drew no chips).
            finishPlaces: FINISH_ORDER.filter((place) => finishState(s, place)),
            // UN36. The shows open at this step (the ⋯ menu's chips), and the one she is giving.
            // A snapshot reads; it never loads a module (loading the policy here put the outfit
            // autonomy switch on the setup panel of a page that had not loaded it).
            routines: (() => {
                const R = s.win && s.win.NEXUS_PRIVATE_ROUTINES;
                const Policy = s.win && s.win.NEXUS_PRIVATE_ACTION_POLICY;
                if (!R || !Policy || typeof Policy.poseLevel !== 'function') return [];
                return R.ORDER.map((id) => ({ id, level: R.level(id, (key) => Policy.poseLevel(key) || 1) }));
            })(),
            routine: s.routine ? { id: s.routine.id, state: routineState(s), step: s.routine.index } : null,
            // UN13. `provisional`: the opening room is not confirmed yet; `committed`: kept in history.
            story: s.story
                ? {
                      ...s.story.snapshot(),
                      provisional: Boolean(s.storyProvisional),
                      committed: Boolean(s.storyCommitted),
                  }
                : null,
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
        // UN15. A change that did not finish in time is given up and she is put back.
        // UN19. Bare is its own state: no bare look, no change, and no lingerie in its place.
        'no-bare-look':
            'this body has no bare look in your wardrobe, so nothing was taken off and you are still wearing what you had',
        'bare-needs-review':
            'being fully bare is not open for this body yet, so nothing was taken off and you are still wearing what you had',
        'bare-blocked': 'being fully bare is not available for this body, so nothing was taken off',
        'not-rendered': 'the change did not show on you, so you are still as you were',
        timeout: 'it was taking far too long, so it was stopped and you are still in what you had — they can ask again',
        'nothing-to-undo': 'there is no earlier outfit to go back to',
        busy: 'an outfit is already being made',
    };

    /**
     * What she is told: what she can do here, and — for this turn — what is actually happening.
     * English, like the rest of Private's prompt; `languageLines` beside it names the language
     * she answers in. Facts only: she never says music is playing unless the player said so.
     */
    /**
     * PB5. Her saved looks for the prompt: at most ten names, at least one of every kind she has
     * (so lingerie is never crowded out by tees), and the kinds counted over all of them.
     */
    const KIND_LABEL = {
        lingerie: 'lingerie',
        hosiery: 'stockings',
        night: 'nightwear',
        swim: 'swimwear',
        dress: 'dresses',
        top: 'tops',
        bottom: 'skirts and trousers',
        shoes: 'shoes',
        outer: 'outerwear',
    };
    function closetSummary(allNames, Intent, max) {
        const limit = max || 10;
        const list = (allNames || []).map((n) => String(n || '')).filter(Boolean);
        const byKind = new Map();
        for (const name of list) {
            const cats = Intent && typeof Intent.garmentsIn === 'function' ? Intent.garmentsIn(name) : [];
            for (const g of cats) {
                if (!KIND_LABEL[g.cat]) continue;
                if (!byKind.has(g.cat)) byKind.set(g.cat, []);
                if (!byKind.get(g.cat).includes(name)) byKind.get(g.cat).push(name);
            }
        }
        const names = [];
        for (const named of byKind.values())
            if (names.length < limit && !names.includes(named[0])) names.push(named[0]);
        for (const name of list) if (names.length < limit && !names.includes(name)) names.push(name);
        const kinds = [...byKind.entries()].map(([cat, named]) => `${KIND_LABEL[cat]} (${named.length})`);
        return { names, kinds };
    }

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
        const Intent = pick(s.win, 'NEXUS_PRIVATE_ACTION_INTENT', './PrivateActionIntent.js');
        const ready = closetSummary(closet && typeof closet.names === 'function' ? closet.names() : [], Intent);
        const names = ready.names;
        const outfit = closet ? closet.snapshot() : null;
        if (closet && closet.availability().ok) {
            lines.push(
                `- Your outfit: you can change clothes right here, without leaving. You are wearing: ${(outfit && outfit.name) || 'your own outfit'}.${names.length ? ` Your saved looks: ${names.join('; ')}.` : ''}`
            );
            // PB5. "¿Quieres lencería?" — "Sí" — "No tengo lencería guardada", while a prebuilt
            // lingerie set was hers all along: the ten names she was shown happened not to include
            // one. She is told every kind she has ready, so a kind she has is never denied.
            if (ready.kinds.length)
                lines.push(
                    `  Ready to wear now, no waiting: ${ready.kinds.join(', ')}. When they want one of these kinds, offer a saved look of that kind by its name — never say you have none.`
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
            const themed = themeSuggestion(s);
            if (themed && autonomy !== 'off')
                lines.push(
                    `  Tonight suits “${themed}” (saved, ready now). If the moment invites it you may suggest it once, in your own words — a suggestion, never a change: they decide.`
                );
            // UN1. Undressing: one layer at a time, from her own looks, and only at the top of the
            // evening's pace. Below it she is told so, and never to describe it as happening.
            const at = levelOf(s);
            // UN1. At the top of the pace, her looks are loaded in the background (once) so the
            // layers are known by the time anybody asks; until they are, she is told what the
            // level allows and the handler checks her eligibility when it runs.
            // `_loadedAt` starts at -Infinity: finite means her looks have been listed.
            const listed = Number.isFinite(closet._loadedAt);
            if (at >= UNDRESS_AT && !listed && !s.undressWarm && typeof closet.open === 'function') {
                s.undressWarm = true;
                Promise.resolve()
                    .then(() => closet.open())
                    .then(() => state === s && emit())
                    .catch(() => {});
            }
            if (closet.privateOpen || !listed) {
                if (at >= UNDRESS_AT) {
                    lines.push(
                        '- Undressing: the evening is at its closest, so you may take your clothes off, one layer at a time (the app changes you into what is underneath). When they ask, you do it; when the moment feels right and you want to, you may do it yourself.'
                    );
                    if (autonomy === 'autonomous')
                        lines.push(
                            '  To take a layer off: one short sentence, then <wardrobe action="undress"/> on its own line. Use step="all" only when they ask for everything at once.'
                        );
                    else if (autonomy === 'suggest')
                        lines.push(
                            '  To offer it on your own, end with <wardrobe action="undress"/> on its own line — they are asked before anything comes off. When they ask, it simply happens.'
                        );
                    else lines.push('  Take something off only when they ask.');
                } else
                    lines.push(
                        // UN20. "Not yet", teased, with no way forward read as a refusal. She says
                        // why and names the control the person moves it with; she never moves it.
                        `- Undressing is not open yet: the evening is at ${at || 1} of ${UNDRESS_AT}. If they ask, say plainly and warmly: not yet, it is not open at this level, and it opens when they bring the evening closer with ${closerControl(s)}. Never describe yourself undressing before then.`
                    );
            }
        }
        // PX14. The rule that stops the reported transcript: "Mi tolgo il vestito per te. Ora ho
        // solo mutande e reggiseno." while the avatar wore exactly what she had on. Her clothes are
        // the wardrobe's to change; her words follow it. Said whether or not a wardrobe exists here.
        lines.push(
            '- What you wear changes ONLY when the app changes it. Never say you are taking something off, putting something on, or now wearing something different unless RIGHT NOW below says it has happened. Until then you may want it or tease about it — but when they asked for a change, say what RIGHT NOW below says happened, never a vague "maybe later".'
        );
        lines.push('- Dancing: when they ask you to dance, you do.');
        // UN5. Positions and dressing again, as the app can do them.
        if (s.poses) {
            lines.push(
                '- Positions: when they ask you to kneel, lie on your back, front or side, bend forward or arch your back, the app puts your body in that position and holds it — turning round keeps it — until they ask you to stand or to go back to how you were. Say it in a few words, in the moment.'
            );
            if (s.dressedLook)
                lines.push(
                    '- Getting dressed again: when they say they are done or ask you to get dressed, the app puts back the outfit you wore before; then the evening can end gently.'
                );
            // UN27/UN28. The closer positions, by what they are and by the step each opens at.
            // Before this the model knew of kneeling and lying and nothing else, so a request for
            // any other was met with a guess, and its own invitations named positions the app had
            // no way to take. Listed only when this build can run them (Spicy lists the presets);
            // open ones by name, the next ones with the step they open at, so her teasing points
            // at something the person can actually reach by bringing the evening closer.
            const closer = closerPositions(s);
            if (closer.length) {
                const at = levelOf(s) || 1;
                const need = (p) => poseLevelOf(s, p.key);
                const open = closer.filter((p) => need(p) <= at);
                const later = closer.filter((p) => need(p) > at);
                if (open.length)
                    lines.push(
                        `- Closer positions open at this step of the evening (${at} of ${UNDRESS_AT}): ${open.map((p) => p.name).join('; ')}. When they ask for one, the app moves your body into it and holds it until they ask you to stand or to go back to how you were. You never take one on your own: you may invite one in a few words, by its name, and it happens only if they ask. Once you are in it, stay in character — a sentence or two, unhurried, about being there for them like that and what you want next — and follow what RIGHT NOW below says your body is doing; never describe more than it shows.`
                    );
                if (later.length)
                    lines.push(
                        `- Not open yet: ${later.map((p) => `${p.name} (at ${need(p)} of ${UNDRESS_AT})`).join('; ')}. If they ask for one, say so warmly, once: not yet, it opens when they bring the evening closer with ${closerControl(s)}. You may let them know it is waiting there; never describe yourself taking one before then.`
                    );
            }
        }
        // UN36. The shows she knows, open at this step, by name. She may invite one; it runs only
        // when they ask (their words or a chip).
        {
            const R = s.poses ? routinesOf(s) : null;
            const open = R ? R.openAt(levelOf(s) || 1, poseLevelFn(s)) : [];
            if (open.length)
                lines.push(
                    `- Shows you know, open now: ${open.map((id) => `${R.ROUTINES[id].label} (${R.ROUTINES[id].name})`).join('; ')}. When they ask for one by name, or just "show me", the app moves your body through it step by step, slowly, holding each position. You never start one on your own: you may invite one by name in a few words. During a show, say a short, sensual line at each step about what you are showing them and how it feels to be watched; they can say slower, faster or stop. When it ends, ask them if they want more.`
                );
        }
        // UN34. Helping them finish. What she says leads them there; what is shown on her follows
        // their words only. The places are the ones this look can show, so she never invites
        // something the app cannot put on her body.
        if (levelOf(s) >= UNDRESS_AT && s.skinStates && s.skinStates.length) {
            const places = FINISH_ORDER.filter((place) => finishState(s, place));
            if (places.length) {
                const said = {
                    back: 'on your lower back',
                    inside: 'inside you',
                    ass: 'in your ass',
                    both: 'in both your holes',
                    all: 'all over you',
                    belly: 'on your belly',
                    chest: 'on your breasts',
                };
                lines.push(
                    `- Bringing them to climax: this is the closest part of the evening, and it is about their pleasure. Follow their rhythm and what they tell you they like; say what you feel and want in short, vivid, unhurried sentences; build it slowly and let them lead the pace. When they are close, ask where they want to finish — ${places.map((p) => said[p]).join(', ')} — and when they say they are coming and where, the app shows it on your body. Respond to it in the moment, then stay close and tender afterwards. Never describe it on your body before RIGHT NOW below says it is there.`
                );
            }
        }
        // UN2. Her body is hers to move: every gesture in the motion list above (sit, lie down,
        // turn round, spin, model pose, show your outfit, blow a kiss…) is available here too,
        // asked for in any language. The motion contract carries the names; this says they apply.
        lines.push(
            '- Poses and moves: every gesture in your motion list works here — sit, lie down, stand, turn round, spin, a model pose, showing your outfit, and the rest. When they ask for a pose in any language, take it, and say so in a few words.'
        );
        lines.push(
            'An executable request is never answered with "tell me more" or a list of options: acknowledge it in one short sentence, as something you are doing.'
        );
        // UN20. The other half: a request that cannot happen. "Per ora resto come sono.", twice,
        // under a clear request at the level they chose, read as censorship. The reason is a fact
        // the app gives her below; she says it, she does not hint at it.
        lines.push(
            'When they ask for a change and RIGHT NOW says it could not happen, say that exact reason once, in plain words and in your own warm voice, then what you can do instead. Never a vague "not now", "maybe later" or "I\'m staying as I am" without the reason.'
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
            // UN20. Still pending as her reply is written: hold the follow-up until the reply
            // check has run (`explained`), or for 15 s if it never does.
            else if (w.status === 'pending' && s.replyDue !== s.turnId) {
                const turn = s.turnId;
                s.replyDue = turn;
                setTimeout(() => {
                    if (state === s && s.replyDue === turn) explained(false);
                }, 15000);
            }
            if (w.name === 'wardrobe.redress') {
                // UN5. Told in its own words below.
            } else if (w.name === 'wardrobe.undress') {
                // UN1. What the layer step did, in the words the reply must not contradict.
                // UN7. The renderer's answer, never her draft: what is on the avatar now is the
                // only thing she may say she wears — naked only when the bare look is the one shown.
                const bare = Boolean(w.result && w.result.bare);
                const askedNaked = Boolean(w.params && w.params.naked);
                if (w.status === 'completed' && bare)
                    now.push(
                        'You have just taken everything off: you are naked now, as they asked. Say it in a few words, in the moment.'
                    );
                else if (['no-bare-look', 'bare-needs-review', 'bare-blocked'].includes(w.why))
                    // UN19. Everything was asked for and this body has no bare look: nothing was
                    // changed and no lingerie was put on in its place. She says exactly that.
                    now.push(
                        `They asked you to take everything off. Being fully bare is not available for this body in your wardrobe, so nothing was changed: you are still wearing ${currentName(s)}. Say so once, warmly and honestly — that being fully bare is not available for this body yet — and never say you are naked or that you took anything off. Then say what you can do instead, as a choice for them: stay like this with them, ${wardrobeState(s) === 'lingerie' ? 'another of your looks' : 'your lingerie or another of your looks'}, or a position they like — a suggestion, not a change.`
                    );
                else if (w.status === 'completed') {
                    // UN14. Forge swaps her whole look in one change; it does not peel garments off
                    // one by one. She says what she wears now — as playfully as the moment allows —
                    // and never narrates removing a piece the renderer never showed coming off.
                    const covers = regionText(w.result && w.result.covers);
                    now.push(
                        `You have just changed into lingerie${name ? `: you are now wearing “${name}”` : ''}${covers ? ` (it covers your ${covers}; nothing of your earlier outfit shows)` : ''}. You are in lingerie, not naked. It was one change, all at once: say what you wear now, in a few words, in the moment — not a piece-by-piece undressing.`
                    );
                } else if (w.status === 'pending')
                    // UN20. "Everything off" is never "something lighter": it ends in her bare body or
                    // in a refusal. Reported: "Mi metto qualcosa di più leggero adesso." under "Toglili tutti".
                    now.push(
                        askedNaked || (w.params && w.params.step === 'all')
                            ? 'They asked you to take everything off. The app is checking whether that is possible for this body right now: say only that you heard them, in a few words. Do not say you are taking anything off, and never offer something lighter instead.'
                            : 'You are changing into something lighter right now — say so in one short sentence.'
                    );
                else if (w.why === 'pace' && w.source === 'model')
                    now.push('Undressing is not open yet. Stay as you are and do not describe taking anything off.');
                else if (w.why === 'pace')
                    now.push(
                        `They asked you to undress, but the evening is not that close yet (undressing opens at ${UNDRESS_AT} of ${UNDRESS_AT}, and it is at ${levelOf(s) || 1}). Say so plainly and warmly, once: not yet, not at this level, and it opens when they bring the evening closer with ${closerControl(s)}. Stay dressed and do not describe undressing.`
                    );
                else if (w.why === 'needs-approval')
                    now.push('You offered to take something off; the app is asking them. Wait for their answer.');
                else if (w.why === 'last-layer' && askedNaked)
                    now.push(
                        'They asked to see you naked. You are already wearing the least you have here, and being fully bare is not in your wardrobe yet. Say so once, warmly and honestly; nothing changes, and never say you are naked.'
                    );
                else if (w.why === 'last-layer')
                    now.push(
                        'They asked you to undress, and you are already down to the last layer you have here. Say plainly, in your own playful voice, that this is as far as your wardrobe goes; nothing changes.'
                    );
                else
                    now.push(
                        `They asked you to undress and it did not happen: ${WHY_OUTFIT[w.why] || 'it could not be done'}. Tell them so once, in your own voice, and stay as you are.`
                    );
            } else if (w.name === 'wardrobe.undo') {
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
        // PX14. They talked about her clothes and nothing ran: say so, so the reply cannot invent it.
        if (!(w && w.turnId === s.turnId) && s.topicTurn === s.turnId && s.topic === 'wardrobe')
            now.push('Nothing about your outfit has changed this turn. You are still wearing the same thing.');
        const d = last && last.turnId === s.turnId && last.name === 'avatar.dance' ? last : null;
        if (d)
            now.push(
                d.status === 'completed'
                    ? 'They asked you to dance, and you are dancing now.'
                    : 'They asked you to dance and you cannot right now. Say so lightly.'
            );
        // UN4. Where she is going, in the words the renderer allows. Arrival and a failed trip
        // land between turns, so they are news told once, on the next prompt.
        const trip = [...s.log].reverse().find((a) => a.name === 'world.travel' && a.turnId === s.turnId);
        const tripName = trip && trip.result && trip.result.name;
        if (s.arrivedNews) {
            now.push(
                `You have just arrived at ${s.arrivedNews.name} together, as they agreed — it is around you now. Welcome them there in your own words.`
            );
            s.arrivedNews = null;
        } else if (s.travelNews) {
            now.push(
                `The trip to ${s.travelNews.name} did not happen; you are still where you were. Say so once, lightly, and stay.`
            );
            s.travelNews = null;
        } else if (trip && trip.status === 'pending')
            now.push(
                `They said yes: you are on your way to ${tripName || 'the other place'} right now. Say so in one short sentence; do not describe arriving yet.`
            );
        else if (trip && trip.status === 'completed' && trip.result && trip.result.already)
            now.push(`You are already at ${tripName}.`);
        else if (trip && trip.why === 'needs-approval')
            now.push(
                `Going to ${(s.offer && s.offer.name) || tripName || 'another place'} has been suggested; the app is asking them. Wait for their answer — you are still here.`
            );
        else if (trip && ['not-a-place', 'no-destination', 'no-travel'].includes(trip.why))
            now.push(
                'They asked to go somewhere you cannot take them from here tonight. Say so warmly and stay where you are.'
            );
        // UN5. What her body and her clothes just did.
        const body = [...s.log].reverse().find((a) => a.name === 'avatar.pose' && a.turnId === s.turnId);
        if (body) {
            const result = (body.result && body.result.name) || body.params.pose;
            // NL1. A preset asked for by name is named by its Pose Studio label, not by "preset".
            const named = String(
                body.params.pose === 'preset'
                    ? (body.result && body.result.name) || body.params.preset || ''
                    : body.params.pose || ''
            ).replace(/-/g, ' ');
            // NL1. Checked first: at the moment the reply is asked for, a position just requested
            // is usually still being taken (the blend, then the check against her rendered
            // skeleton). There was no line for that, so the last `else` below told her she could
            // not take a position she was in the middle of taking; and nothing may be called done
            // before the renderer has shown it.
            // UN27. What the position is, for her words to follow: the key alone told her nothing.
            const shape = bodyOf(s, body);
            if (body.status === 'pending')
                now.push(
                    `You are moving into that position right now (${named}${shape ? `: ${shape}` : ''}); it is not confirmed on screen yet. Say you are getting into it, in a few words. Do not say it is done.`
                );
            else if (body.why === 'ambiguous-pose')
                now.push(
                    `They named a position that could be more than one of yours (${(body.result && body.result.ask) || 'several'}). You have not moved. Ask which one, in a few words.`
                );
            else if (
                body.status === 'failed' &&
                ['not-rendered', 'not-held', 'not-applied', 'pose-failed'].includes(body.why)
            )
                now.push(
                    'You tried to take that position and it did not show on your body: you are still as you were. Say plainly that you could not take it. Never say you are in it.'
                );
            else if (body.status === 'completed' && result === 'stand') now.push('You are standing again.');
            else if (body.status === 'completed' && result === 'turned')
                now.push('You have turned round, holding your position: they see your back now.');
            else if (body.status === 'completed' && result === 'front')
                now.push('You have turned to face them again, holding your position.');
            else if (body.status === 'completed' && body.params.pose === 'back')
                now.push(`You are back in the position you had before (${String(result).replace(/-/g, ' ')}).`);
            else if (body.status === 'completed')
                now.push(
                    shape
                        ? `Your body is in that position now (${named}): ${shape}. Whatever you say about your body matches that. Stay in it until they ask you to stand.`
                        : `Your body is in that position now (${named}). Stay in it until they ask you to stand.`
                );
            else if (body.why === 'pace')
                now.push(
                    `They asked for a position the evening is not close enough for yet (it opens at ${poseLevelOf(s, body.params.pose) || UNDRESS_AT} of ${UNDRESS_AT}; the evening is at ${levelOf(s) || 1}). Say so plainly and warmly, once: it opens when they bring the evening closer with ${closerControl(s)}. You stay as you are.`
                );
            else if (body.why === 'unsupported-pose')
                now.push(
                    'They asked for a position your body cannot take here yet. Say so honestly and lightly, offer one you can (kneeling, lying on your back, front or side, bending forward), and stay as you are until they choose.'
                );
            else now.push('They asked for a position you cannot take here. Say so lightly and stay as you are.');
        }
        const back =
            s.wardrobe && s.wardrobe.turnId === s.turnId && s.wardrobe.name === 'wardrobe.redress' ? s.wardrobe : null;
        if (back) {
            if (back.status === 'completed')
                now.push('You are dressed again, in what you wore before. If they are done, close the evening warmly.');
            else if (back.status === 'pending')
                now.push('You are getting dressed again right now — say so in a few words.');
            else if (back.why === 'already-dressed') now.push('You are already dressed.');
            else now.push('Getting dressed again did not work just now. Say so once, lightly.');
        }
        // UN3. Tonight's outline, after what she can do and before what is happening now.
        if (s.story) lines.push(...s.story.lines({ canTravel: Boolean(s.canTravel) }));
        // UN9. This turn's answer about the evening itself.
        const news = s.storyNews && s.storyNews.turnId === s.turnId ? s.storyNews.kind : null;
        if (news === 'forgotten')
            lines.push(
                'RIGHT NOW: they asked you to forget your past evenings together, and it is done — this evening goes on. Say so in a few warm words.'
            );
        else if (news === 'not-forgotten')
            lines.push(
                'RIGHT NOW: they asked you to forget your past evenings, and this device would not let it be erased. Say so once.'
            );
        {
            const R = s.routine ? routinesOf(s) : null;
            const r = s.routine;
            const now_ = routineState(s);
            if (R && r && now_ === 'running' && r.index >= 0) {
                const steps = R.ROUTINES[r.id].steps;
                const k = Math.min(r.index, steps.length - 1);
                const next = steps[r.index + 1];
                now.push(
                    `You are giving them a show — ${R.ROUTINES[r.id].name}, step ${r.index + 1} of ${steps.length}: you are ${showBody(r, steps, k)}.${next ? ` Next you will be ${next.body}.` : ' This is the last step.'} Stay in it and speak to them from it.`
                );
            } else if (R && r && now_ === 'done') {
                const steps = R.ROUTINES[r.id].steps;
                now.push(
                    `You have finished the show (${R.ROUTINES[r.id].name}); you are still ${showBody(r, steps, steps.length - 1)}. Ask them, warmly and in your own words, if they want more — again, another show, or something else.`
                );
            }
            const asked = [...s.log].reverse().find((a) => a.name === 'avatar.routine' && a.turnId === s.turnId);
            if (asked && asked.status === 'blocked' && asked.why === 'pace')
                now.push(
                    `They asked for a show that is not open at this step of the evening: say so warmly, once — it opens when they bring the evening closer with ${closerControl(s)}.`
                );
            else if (asked && asked.status === 'failed' && asked.why !== 'no-routine')
                now.push(
                    'They asked for a show and your body could not take it here: say so plainly, once, in your own warm voice.'
                );
        }
        if (s.finish && s.finish.turnId === s.turnId)
            now.push(
                // SW4. In proportion, not a performance: no scripted crescendo timed to their climax
                // (Brewer & Hendrie 2011 — performed reactions are the partner-pleasing kind).
                'They just came, and it shows on your body as the next line says. Answer it sincerely and in proportion: warm, present, about the two of you — never a scripted crescendo or a performance for them.'
            );
        else if (s.finish && s.turnId - s.finish.turnId <= AFTERCARE_TURNS)
            now.push(
                // SW5. Afterwards is its own phase (Muise, Giang & Impett 2014: affection after sex
                // predicts satisfaction): a few replies of closeness before anything new.
                'Afterwards: stay close and unhurried. Short, tender, specific words about being together just now; slow and soft. Offer nothing new — no position, show, outfit or place — and do not ask for more; if they want more, they will say so. Never hurry them or make them feel they must leave or stay.'
            );
        // PS2. Their fist, this turn: what her body shows, or why it could not.
        const lastFist = [...s.log].reverse().find((a) => a.name === 'body.fist' && a.turnId === s.turnId);
        if (lastFist && lastFist.status === 'completed')
            now.push(
                'Their fist is inside you now, as your body shows: stay in it, feel it, react in your own voice and in proportion, and check in with them.'
            );
        else if (lastFist && lastFist.status !== 'pending')
            now.push(
                lastFist.why === 'pace'
                    ? 'They asked for their fist; the evening is not at its closest step, so nothing happens yet — tease them about it in words.'
                    : 'They asked for their fist; this look cannot show it on your body, so answer them in words, without describing it on your skin.'
            );
        const lastFinish = [...s.log].reverse().find((a) => a.name === 'body.finish' && a.turnId === s.turnId);
        if (lastFinish && lastFinish.status !== 'completed' && lastFinish.status !== 'pending')
            now.push(
                lastFinish.why === 'pace'
                    ? `They said they are coming; the evening is not at its closest step, so nothing is shown on your body — answer them warmly in words.`
                    : 'They said they are coming; this look cannot show it on your body, so answer them in words, warmly, without describing it on your skin.'
            );
        const skin = skinLine(s);
        if (skin) now.push(`Your body right now: ${skin}. What you say about your body matches that.`);
        // LM1. Her hands, when the living layer has them on her: read from the frame that moves them.
        let hands = null;
        try {
            hands = s.living && typeof s.living.describe === 'function' ? s.living.describe() : null;
        } catch (_) {
            hands = null;
        }
        if (hands) now.push(`Your hands right now: ${hands}. What you say about your hands matches that.`);
        // LM7. Moving or still, as the person asked: her words follow her body.
        const TEMPO_WORDS = { slow: 'slowly', normal: 'at an easy rhythm', fast: 'faster, with more urgency' };
        const askedMove = [...s.log].reverse().find((a) => a.name === 'avatar.move' && a.turnId === s.turnId);
        const moveNow = movingNow(s);
        if (moveNow)
            now.push(
                `You are moving in that position for them, ${TEMPO_WORDS[moveNow.tempo]}, because they asked. Keep your words in time with it; you stop the moment they ask.`
            );
        else if (askedMove && askedMove.status === 'completed')
            now.push('You have stopped moving and hold still, as they asked.');
        else if (askedMove && askedMove.why === 'not-posed')
            now.push('They asked you to move, but you are not holding a position yet: say so warmly, and invite one.');
        else if (s.poses && typeof s.poses.held === 'function' && s.poses.held())
            now.push('You hold that position still; you move in it only if they ask you to.');
        if (now.length) lines.push('', 'RIGHT NOW:', ...now.map((n) => `- ${n}`));
        lines.push('');
        return lines;
    }

    const api = {
        GENERATE_KEY,
        OFFER_TURNS,
        UNDRESS_AT,
        TRAVEL_MS,
        begin,
        end,
        active,
        request,
        fitPoseToPace,
        noticePose,
        onUserTurn,
        ownsBody,
        whenPoseSettled,
        fromModel,
        consumeTravel,
        approveOffer,
        declineOffer,
        offerShow,
        snapshot,
        outfitTruth,
        poseTruth,
        whenSettled,
        explained,
        log,
        onChange,
        promptLines,
        closetSummary,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_ACTIONS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
