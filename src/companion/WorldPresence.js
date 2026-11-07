/**
 * WorldPresence — where the two of you are, what is really there, and how you move (LW3–LW5).
 *
 * Living Worlds. The regression that started it: in the Bedroom the person said "sì mi piace";
 * her reply carried <activity name="relax"/>, Life ▸ Relax replaced the place, and the bedroom
 * became a meadow village — while her words promised a blanket and a lamp nothing could produce.
 * LW1 stopped her tags from replacing a place. This module is the rest: one place stays until
 * someone really leaves it, she moves WITHIN it on request, a different place needs the person's
 * yes, and the prompt is built only from what the renderer confirmed.
 *
 * Observe → Verify → Act → Confirm → Respond, the PG3 shape:
 *
 *   - OBSERVE the renderer's `nexus-world-shown` (believed only if `runtime.activeId` agrees) and
 *     the person's own turns. Her replies are read only through `consumeReply`, at main.js's
 *     displayText seam, which also strips every tag before the bubble, the transcript, the VR
 *     panel and speech.
 *   - VERIFY against data, not words: spots come from WorldSpots (measured on the scene file that
 *     is actually up — the phone and the desktop bedroom are different models); destinations from
 *     the world catalogue, never private, resolved for this device tier.
 *   - ACT through the owners. A spot change is the world runtime's `goToSpot` (fade, re-place the
 *     loaded scene, fade — no reload, never a glide). Travel is `session.enter(place-<id>)`, the
 *     same door the Places menu uses; the engine already follows the session.
 *   - CONFIRM before saying. A spot is current only once `goToSpot` answered ok for this world;
 *     a trip is "arrived" only once the renderer shows the destination. Until then the prompt says
 *     "on the way" or "waiting for their yes", never "here".
 *   - RESPOND with one short paragraph (`promptSuffix`) and one exact-shape tag offer
 *     (`goOffer`), only on conversational turns, never every frame.
 *
 * Who may move whom — the rules the tests hold:
 *
 *   - Within a place, the person's own words move you at once ("andiamo in cucina"), as does a
 *     tap in the spot menu. Her <go spot/> runs only on a turn where the person asked to move
 *     ("let's go somewhere") — a tag is a proposal, never permission, and a tag the person TYPED
 *     is never read at all (it is not a reply).
 *   - Another place always asks first. The person's request, or her <go place/>, opens ONE
 *     pending proposal; only the person's next turn can accept it ("sì", "yes", "andiamo") or
 *     turn it down. It expires after PROPOSAL_MS or two turns, and End, Clear, another proposal
 *     or any world change cancels it. A choice in the Places menu is already a yes and does not
 *     come through here.
 *   - A trip that does not arrive within TRAVEL_MS goes back to where you were, and says so.
 *   - Private rooms are none of this module's business: their worlds have no spots, they are
 *     never a destination, and while one is up nothing here offers or runs anything.
 *   - In-place activities (LW4): relax, focus and story change her manner here, not the world.
 *
 * No loop, timer of its own beyond the two expiries, storage, network or render call. State is
 * per conversation: Clear and the end of the place forget it.
 *
 * Exposes: window.NEXUS_WORLD_PRESENCE
 */
(function (global) {
    'use strict';

    const PROPOSAL_MS = 3 * 60 * 1000;
    const PROPOSAL_TURNS = 2;
    const TRAVEL_MS = 45 * 1000;
    const NOTE_MS = 2 * 60 * 1000;
    const MOODS = Object.freeze(['relax', 'focus', 'story']);
    const ID = /^[a-z0-9-]{1,30}$/;
    const GO_TAG = /<\s*go\b([^>]*?)\/?>(?:\s*<\s*\/\s*go\s*>)?/gi;

    /**
     * Places she may suggest and the person may ask for by name, with the words people use. A
     * target lists world ids in order of preference; the first one this device can show wins (the
     * forest is the oak glade on a desktop, the lighter wood on a phone). Never a private world.
     */
    const DESTINATIONS = Object.freeze([
        { id: 'apartment', worlds: ['apartment'], words: ['apartment', 'flat', 'home', 'appartamento', 'casa'] },
        { id: 'forest', worlds: ['oak-glade', 'under-the-trees'], words: ['forest', 'woods', 'foresta', 'bosco'] },
        { id: 'beach', worlds: ['lagoon-beach'], words: ['beach', 'lagoon', 'spiaggia', 'laguna'] },
        {
            id: 'discoteca',
            worlds: ['neon-discoteca'],
            words: ['nightclub', 'club', 'disco', 'discoteca', 'dance floor', 'pista da ballo'],
        },
        { id: 'pub', worlds: ['irish-pub'], words: ['pub', 'irish pub', 'birreria'] },
        { id: 'lake', worlds: ['starlit-lake', 'mountain-lake'], words: ['lake', 'lago'] },
        { id: 'meadow', worlds: ['meadow-sunset'], words: ['meadow', 'prato', 'sunset meadow'] },
        { id: 'hotel', worlds: ['hotel-suite'], words: ['hotel', 'suite', 'albergo'] },
        { id: 'city', worlds: ['neon-street'], words: ['city', 'street', 'città', 'citta', 'strada'] },
        { id: 'academy', worlds: ['creative-academy'], words: ['academy', 'school', 'accademia', 'scuola'] },
        { id: 'office', worlds: ['office'], words: ['office', 'ufficio'] },
        { id: 'airship', worlds: ['airship-dock'], words: ['airship', 'dirigibile'] },
    ]);

    const YES =
        /^(?:si|sì|yes|yeah|yep|yup|sure|ok|okay|va bene|certo|certamente|andiamo|let'?s go|let'?s do it|dai|perfetto|volentieri|of course|why not|perche no|perché no|absolutely|assolutamente)\b/;
    const NO = /\b(?:no|non|nope|nah|not now|later|dopo|meglio di no|restiamo|stay here|rather not|preferisco di no)\b/;
    const GO =
        /\b(?:let'?s|go|walk|move|head|come|take me|shall we|can we|could we|andiamo|spostiamoci|portami|vai|vieni|torniamo|possiamo|potremmo|vorrei andare|facciamo un salto)\b/;

    /**
     * LW4. The person's own words for a mood here. Their words set it directly (it never changes
     * the world); her <activity> tag does the same through ActivityDirective's in-place hook.
     */
    const MOOD_WORDS = Object.freeze({
        relax: /\b(?:rilassiamoci|rilassarci|relax(?:iamo)?|riposiamoci|let'?s (?:relax|unwind|chill)|unwind together)\b/,
        story: /\b(?:raccontami (?:una )?storia|una storia|tell me a story|a story (?:here|set here))\b/,
        focus: /\b(?:devo concentrarmi|mi concentro|let me focus|i need to focus|need to concentrate)\b/,
    });

    function norm(s) {
        return String(s || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[’`]/g, "'")
            .trim();
    }

    function clean(text, max) {
        return String(text == null ? '' : text)
            .replace(/[<>{}[\]`]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max || 80);
    }

    function wordIn(text, word) {
        const w = norm(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return w.length >= 3 && new RegExp('(?:^|[^a-z])' + w + '(?:$|[^a-z])').test(text);
    }

    /** Strip every <go …/> tag; return the text and the first one's attributes. Pure. */
    function parseGo(text) {
        const src = String(text == null ? '' : text);
        let first = null;
        const clean = src
            .replace(GO_TAG, (_, attrs) => {
                if (!first) {
                    const spot = /\bspot\s*=\s*"([^"]{1,40})"/i.exec(attrs || '');
                    const place = /\bplace\s*=\s*"([^"]{1,40})"/i.exec(attrs || '');
                    first = spot ? { spot: spot[1].trim() } : place ? { place: place[1].trim() } : { bad: true };
                }
                return '';
            })
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/\s+([,.!?])/g, '$1')
            .trim();
        return { clean, call: first };
    }

    /**
     * The core. `deps`:
     *   runtime()      → the world runtime (activeId, spotId, sceneSrc, scenePlacement, goToSpot)
     *   spotsApi       → WorldSpots
     *   session        → CompanionSession (active, activity, destination, enter)
     *   destinations() → [{ id, world, title }] resolvable here, never private
     *   behavior       → BehaviorRouter instance (optional; relax posture)
     *   now(), emit(name, detail), setTimer(fn, ms) / clearTimer(id)
     */
    function create(deps) {
        const d = deps || {};
        const now = d.now || (() => Date.now());
        const emit = d.emit || (() => {});
        const setTimer = d.setTimer || ((fn, ms) => setTimeout(fn, ms));
        const clearTimer = d.clearTimer || ((id) => clearTimeout(id));
        const S = d.spotsApi;

        let world = null; // { id, base, title, rating, scene }
        let worldGen = 0;
        let spots = [];
        let spotId = null;
        let moving = null; // { id, from }
        let mood = null; // { name, at }
        let turn = 0;
        let intent = null; // the person's latest turn: { kind, id?, turn }
        let pending = null; // { target, source, at, turn }
        let trip = null; // { target, from: { destination, activity }, at, timer }
        let note = null; // { text, at }
        let offer = null; // her <go spot/> suggestion: { id, turn } — the person's next yes takes it

        function runtime() {
            try {
                return d.runtime ? d.runtime() : null;
            } catch (_) {
                return null;
            }
        }
        function sessionActive() {
            const s = d.session;
            return Boolean(s && typeof s.active === 'function' && s.active());
        }
        function placeActivity() {
            const s = d.session;
            const a = s && typeof s.activity === 'function' ? String(s.activity() || '') : '';
            return /^place-[a-z0-9-]+$/.test(a) ? a : null;
        }
        function isPrivate() {
            return Boolean(world && world.rating === 'private');
        }
        /**
         * PW. Whether this instance may act in the world that is up. The public instance (no
         * `privateGate`) refuses every private world, exactly as before. The private-only instance
         * that PrivateWorldAdapter builds refuses every NON-private world, and a private one too
         * unless its gate answers true at this very moment — asked again at each step, never
         * remembered — so a withdrawn consent or a lost attestation stops it mid-conversation.
         */
        function blocked() {
            if (typeof d.privateGate !== 'function') return isPrivate();
            if (!isPrivate()) return true;
            try {
                return d.privateGate() !== true;
            } catch (_) {
                return true;
            }
        }
        function spotById(id) {
            return spots.find((s) => s.id === id) || null;
        }
        function say(text) {
            note = { text: clean(text, 220), at: now() };
        }

        function cancelProposal(why) {
            if (!pending) return;
            emit('nexus-presence', { kind: 'proposal-cancelled', target: pending.target.id, why });
            pending = null;
        }

        function endTrip() {
            if (trip && trip.timer) clearTimer(trip.timer);
            trip = null;
        }

        /** The renderer says which world is up. Believed only if the runtime agrees. */
        function onWorldShown(detail) {
            const rt = runtime();
            const id = detail && detail.id ? String(detail.id) : null;
            worldGen += 1;
            const gen = worldGen;
            moving = null;
            if (!id || !rt || rt.activeId !== id) {
                world = null;
                spots = [];
                spotId = null;
                cancelProposal('world-changed');
                return;
            }
            world = {
                id,
                base: detail.base ? String(detail.base) : id,
                title: clean(detail.title || id, 40),
                rating: detail.rating || null,
                scene: rt.sceneSrc || null,
            };
            spotId = rt.spotId || null;
            spots = [];
            if (trip && (trip.target.world === id || trip.target.world === world.base)) {
                say(`You have just arrived at ${trip.target.title} together; it is real and shown now.`);
                emit('nexus-presence', { kind: 'arrived', target: trip.target.id, world: id });
                endTrip();
            } else if (pending) {
                cancelProposal('world-changed');
            }
            // The public instance never even loads a private room's spots; the private one loads
            // only a private room's (whether it may use them is blocked()'s answer, per step).
            if ((typeof d.privateGate === 'function') !== isPrivate() || !S || !world.scene) return;
            Promise.resolve(S.load(world.scene))
                .then((n) => {
                    if (gen !== worldGen || !n) return;
                    spots = n.spots.slice();
                    if (!spotId) spotId = S.spotAtPlacement(spots, rt.scenePlacement);
                    emit('nexus-presence', { kind: 'spots', world: id, spots: spots.map((s) => s.id), spot: spotId });
                })
                .catch(() => {});
        }

        /** Move within the place. `source`: 'user' (their words), 'menu' (a tap) or 'assistant'. */
        async function go(id, options) {
            const o = options || {};
            if (!world || blocked()) return { ok: false, why: 'no-place' };
            const spot = typeof id === 'string' && ID.test(id) ? spotById(id) : null;
            if (!spot) return { ok: false, why: 'unknown-spot' };
            if (spot.id === spotId) return { ok: true, why: 'already-here', spot: spot.id };
            if (moving) return { ok: false, why: 'busy' };
            const rt = runtime();
            if (!rt || typeof rt.goToSpot !== 'function' || rt.activeId !== world.id)
                return { ok: false, why: 'no-renderer' };
            const gen = worldGen;
            const from = spotId;
            moving = { id: spot.id, from };
            emit('nexus-presence', { kind: 'moving', spot: spot.id, source: o.source || 'user' });
            let r;
            try {
                r = await rt.goToSpot(spot, {
                    instant: o.instant,
                    // A small room is framed closer on a screen; the engine owns the camera.
                    whileDark: (s) => emit('nexus-world-framing', { world: world.id, spot: s.id, framing: s.framing }),
                });
            } catch (error) {
                r = { ok: false, why: 'renderer-error' };
            }
            if (gen !== worldGen) return { ok: false, why: 'stale' };
            moving = null;
            if (!r || !r.ok || rt.spotId !== spot.id) {
                const here = from ? (spotById(from) || {}).label : null;
                say(
                    `The move did not work: you are not ${spot.label.en}, you are still ` +
                        (here ? here.en : 'where you were') +
                        '. Say so simply if it matters.'
                );
                return { ok: false, why: (r && r.why) || 'not-confirmed' };
            }
            spotId = spot.id;
            const was = from ? spotById(from) : null;
            say(
                'Just now you both moved: ' +
                    (was ? `you were ${was.label.en}, ` : '') +
                    `now you are ${spot.label.en} (confirmed).`
            );
            emit('nexus-presence', { kind: 'moved', spot: spot.id, from, source: o.source || 'user' });
            emit('nexus-world-spot', { world: world.id, spot: spot.id });
            return { ok: true, spot: spot.id };
        }

        function destinationIn(text) {
            const list = (d.destinations && d.destinations()) || [];
            let best = null;
            for (const t of list) {
                const def = DESTINATIONS.find((x) => x.id === t.id);
                for (const w of (def && def.words) || []) {
                    if (wordIn(text, w) && (!best || w.length > best.len)) best = { target: t, len: w.length };
                }
            }
            return best ? best.target : null;
        }

        function propose(target, source) {
            if (!target || blocked()) return false;
            if (world && (target.world === world.id || target.world === world.base)) return false;
            if (pending && pending.target.id === target.id) return true;
            cancelProposal('replaced');
            pending = { target, source, at: now(), turn };
            emit('nexus-presence', { kind: 'proposed', target: target.id, source });
            return true;
        }

        function commitTrip() {
            const target = pending.target;
            pending = null;
            const s = d.session;
            if (!s || typeof s.enter !== 'function') return false;
            const from = {
                destination: typeof s.destination === 'function' ? s.destination() : null,
                activity: typeof s.activity === 'function' ? s.activity() : null,
            };
            endTrip();
            trip = { target, from, at: now(), timer: null };
            mood = null;
            say(`They said yes: the app is taking you both to ${target.title} now. It is not shown yet.`);
            emit('nexus-presence', { kind: 'travelling', target: target.id });
            try {
                s.enter('experiences', 'place-' + target.world, { source: 'together', silent: true });
            } catch (error) {
                endTrip();
                say(`Going to ${target.title} did not work; you are still where you were.`);
                return false;
            }
            const mine = trip;
            trip.timer = setTimer(() => {
                if (trip !== mine) return;
                trip = null;
                // It never arrived: go back to where you were, the way you came (the session).
                try {
                    if (from.activity && /^place-/.test(from.activity))
                        s.enter(from.destination || 'experiences', from.activity, { source: 'together', silent: true });
                } catch (_) {
                    /* the session keeps what it has */
                }
                say(`Going to ${target.title} did not work; you are back where you were. Say so simply.`);
                emit('nexus-presence', { kind: 'travel-failed', target: target.id });
            }, TRAVEL_MS);
            return true;
        }

        /** The person's own turn (prompt time, once per message). Returns what it decided. */
        function observeUser(text) {
            turn += 1;
            intent = null;
            const t = norm(text);
            if (!t) return null;
            if (pending) {
                const expired = now() - pending.at > PROPOSAL_MS || turn - pending.turn > PROPOSAL_TURNS;
                if (expired) cancelProposal('expired');
                else if (NO.test(t)) {
                    const target = pending.target;
                    cancelProposal('declined');
                    say(`They would rather not go to ${target.title}; you both stay here.`);
                    intent = { kind: 'declined', turn };
                    return intent;
                } else if (YES.test(t)) {
                    commitTrip();
                    intent = { kind: 'travel', turn };
                    return intent;
                }
            }
            if (!world || blocked()) return null;
            // Her suggestion from the last reply ("shall we go to the sofa?") and their yes to it.
            const suggested = offer && offer.turn === turn - 1 ? offer : null;
            offer = null;
            if (suggested && YES.test(t) && !NO.test(t)) {
                intent = { kind: 'spot', id: suggested.id, turn };
                go(suggested.id, { source: 'assistant-accepted' });
                return intent;
            }
            for (const name of MOODS) {
                if (MOOD_WORDS[name].test(t)) {
                    setMood(name);
                    intent = { kind: 'mood', id: name, turn };
                    return intent;
                }
            }
            const local = S ? S.intentOf(text, spots) : null;
            if (local && local.spot) {
                intent = { kind: 'spot', id: local.spot, turn };
                go(local.spot, { source: 'user' });
                return intent;
            }
            if (GO.test(t)) {
                const target = destinationIn(t);
                if (target && propose(target, 'user')) {
                    intent = { kind: 'asked-travel', id: target.id, turn };
                    return intent;
                }
            }
            if (local && local.move) intent = { kind: 'move', turn };
            return intent;
        }

        /** Her reply: strip <go/> and act on it only within the rules above. Replies only. */
        function consumeReply(text) {
            const { clean: out, call } = parseGo(text);
            if (!call || call.bad || !world || blocked()) return out;
            if (call.spot) {
                const asked = intent && intent.turn === turn && (intent.kind === 'move' || intent.kind === 'spot');
                if (asked && !(intent.kind === 'spot' && intent.id === call.spot) && !moving)
                    go(call.spot, { source: 'assistant' });
                else if (!asked && spotById(call.spot) && call.spot !== spotId)
                    // Not asked: it is only her suggestion. Their next "sì" takes it; anything else drops it.
                    offer = { id: call.spot, turn };
                return out;
            }
            if (call.place) {
                const list = (d.destinations && d.destinations()) || [];
                const target = list.find((t) => t.id === call.place);
                if (target) propose(target, 'assistant');
            }
            return out;
        }

        /** LW4. relax / focus / story here, without touching the world. */
        function setMood(name) {
            if (!MOODS.includes(name) || !world) return { ok: false, why: 'not-here' };
            mood = { name, at: now() };
            if (name === 'relax' && d.behavior && typeof d.behavior.request === 'function') {
                try {
                    d.behavior.request('relax', { source: 'presence' });
                } catch (_) {
                    /* manner still changes */
                }
            }
            emit('nexus-presence', { kind: 'mood', mood: name });
            return { ok: true, why: 'in-place', mood: name };
        }

        function visibleSpots(destination) {
            return spots.filter((s) => destination !== 'copilot' || s.rating === 'general');
        }

        /** The SharedMoment paragraph, sanitised; '' when there is no place up. */
        function promptSuffix(destination) {
            if (!world || blocked() || !sessionActive()) return '';
            const here = spotById(spotId);
            const title = world.title;
            const parts = [];
            parts.push(
                `Where you are together: ${title}` +
                    (here ? `, ${here.label.en}` : '') +
                    '.' +
                    (here && here.sees ? ` Right here: ${here.sees.en}.` : '')
            );
            const others = visibleSpots(destination).filter((s) => s.id !== spotId && !(moving && moving.id === s.id));
            if (others.length)
                parts.push('Other spots in this place: ' + others.map((s) => s.label.en).join(', ') + '.');
            if (moving) {
                const to = spotById(moving.id);
                if (to)
                    parts.push(
                        `You are on your way right now; next you will be ${to.label.en} (the app is moving you both).`
                    );
            }
            if (note && now() - note.at < NOTE_MS) parts.push(note.text);
            if (pending)
                parts.push(
                    `You are waiting for their yes to go to ${pending.target.title}. ` +
                        (pending.source === 'user'
                            ? 'They asked for it: ask them to confirm in a few words.'
                            : 'Until they answer, you are still here; do not describe it as if you were there.')
                );
            if (offer && offer.turn === turn) {
                const o = spotById(offer.id);
                if (o) parts.push(`You suggested going ${o.label.en}; it happens only if they say yes.`);
            }
            if (intent && intent.turn === turn && intent.kind === 'move' && others.length)
                parts.push('They want to move somewhere: pick one spot from the list with them.');
            if (mood && mood.name === 'relax')
                parts.push('You are relaxing together right here: unhurried, few words, no new topics.');
            if (mood && mood.name === 'story')
                parts.push('They want a short story set right here: use only what is really in this place.');
            if (mood && mood.name === 'focus')
                parts.push('They are focusing on something here: stay quiet unless they speak.');
            // PW. A room that offers its own light changes (the Private World's presets, confirmed
            // by the renderer) must not also be told lights cannot be switched: the model got both
            // sentences in one prompt and had to pick one.
            const cannot =
                d.lightsOffered === true
                    ? 'sit, lie down, pick things up or open doors'
                    : 'sit, lie down, pick things up, open doors or switch lights';
            parts.push(
                `You can stand near things and look at them. You cannot ${cannot} yet: if they ask, say so warmly ` +
                    'or suggest it — never say it happened.'
            );
            return clean(parts.join(' '), 1100);
        }

        /** The exact tag offer, built only from verified ids; PromptContext checks its shape. */
        function goOffer(destination) {
            if (!world || blocked() || !sessionActive()) return '';
            const ids = visibleSpots(destination)
                .map((s) => s.id)
                .filter((id) => id !== spotId)
                .slice(0, 10);
            const places =
                destination === 'copilot'
                    ? []
                    : ((d.destinations && d.destinations()) || [])
                          .filter((t) => t.world !== world.id && t.world !== world.base)
                          .map((t) => t.id)
                          .slice(0, 12);
            let out = '';
            if (ids.length)
                out += `When they ask to move within this place, end your reply with one tag: <go spot="${ids.join('|')}"/>.`;
            if (places.length)
                out +=
                    (out ? ' ' : '') +
                    `To suggest going somewhere else, ask them and end with <go place="${places.join('|')}"/>; nothing changes until they say yes.`;
            return out;
        }

        function reset(why) {
            cancelProposal(why || 'reset');
            endTrip();
            mood = null;
            note = null;
            intent = null;
            offer = null;
        }

        return {
            onWorldShown,
            go,
            observeUser,
            consumeReply,
            setMood,
            promptSuffix,
            goOffer,
            reset,
            spots: () => spots.slice(),
            state: () => ({
                offer: offer ? offer.id : null,
                world: world ? { ...world } : null,
                spot: spotId,
                moving: moving ? { ...moving } : null,
                mood: mood ? mood.name : null,
                pending: pending ? { target: pending.target.id, source: pending.source } : null,
                travelling: trip ? trip.target.id : null,
                note: note ? note.text : null,
            }),
        };
    }

    /** Hide a <go …> tag while a reply streams in, so a half-written one is never shown. Pure. */
    function maskStreaming(text) {
        const src = String(text == null ? '' : text);
        const i = src.search(/<\s*go\b/i);
        if (i !== -1) return src.slice(0, i).replace(/\s+$/, '');
        const tail = src.match(/<\s*(?:go?)?$/i);
        return tail ? src.slice(0, tail.index).replace(/\s+$/, '') : src;
    }

    /** Destinations this device can show, from the catalogue: never private, never the light id. */
    function destinationsFor(worlds, tier, resolveFor) {
        const out = [];
        for (const def of DESTINATIONS) {
            for (const wid of def.worlds) {
                const w = (worlds || []).find((x) => x.id === wid);
                if (!w || w.rating === 'private') continue;
                const shown = resolveFor ? resolveFor(worlds, wid, tier, false) : wid;
                if (!shown) continue;
                out.push({ id: def.id, world: wid, title: clean(w.title, 40) });
                break;
            }
        }
        return out;
    }

    /** Wire the trusted owners: the engine's runtime, the catalogue, the session, Clear. */
    function attach(options) {
        const o = options || {};
        const g = o.global || global;
        const live = o.live;
        const Worlds = g.NEXUS_VR_WORLDS;
        let destinations = [];
        // The same tier rule the Places menu uses, so a destination is one this device can show.
        const tier = () => {
            const doc = g.document;
            const mobile = !!(doc && doc.documentElement && doc.documentElement.classList.contains('is-mobile'));
            return Worlds && typeof Worlds.tierFor === 'function' ? Worlds.tierFor({ xr: false, mobile }) : 'desktop';
        };
        const core = create({
            runtime: () => (g.NEXUS_VIEWER && g.NEXUS_VIEWER.vrWorlds) || null,
            spotsApi: g.NEXUS_WORLD_SPOTS || null,
            session: live && live.session,
            behavior: live && live.behavior,
            destinations: () => destinations,
            emit: (name, detail) => {
                try {
                    if (g.dispatchEvent && g.CustomEvent) g.dispatchEvent(new g.CustomEvent(name, { detail }));
                } catch (_) {
                    /* nobody is listening */
                }
            },
        });
        if (Worlds && typeof Worlds.loadCatalogue === 'function') {
            Promise.resolve(Worlds.loadCatalogue())
                .then((cat) => {
                    const worlds = (cat && cat.worlds) || [];
                    destinations = destinationsFor(worlds, tier(), Worlds.resolveFor);
                })
                .catch(() => {});
        }
        const onShown = (e) => core.onWorldShown(e && e.detail);
        g.addEventListener && g.addEventListener('nexus-world-shown', onShown);
        // Clear forgets the moment: proposals, the trip in flight, notes and mood.
        let offReset = null;
        const Reset = g.NEXUS_CONVERSATION_RESET;
        if (Reset && typeof Reset.onReset === 'function') offReset = Reset.onReset(() => core.reset('clear'));
        // Ending the session (End, or the place being left) forgets it too.
        let offSession = null;
        if (live && live.session && typeof live.session.on === 'function') {
            offSession = live.session.on(() => {
                if (!live.session.active()) core.reset('ended');
            });
        }
        return Object.assign(core, {
            detach() {
                g.removeEventListener && g.removeEventListener('nexus-world-shown', onShown);
                if (typeof offReset === 'function') offReset();
                if (typeof offSession === 'function') offSession();
                core.reset('detach');
            },
        });
    }

    const api = {
        DESTINATIONS,
        PROPOSAL_MS,
        TRAVEL_MS,
        MOODS,
        create,
        attach,
        parseGo,
        maskStreaming,
        destinationsFor,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_WORLD_PRESENCE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
