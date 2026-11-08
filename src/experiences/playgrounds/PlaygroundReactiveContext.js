/**
 * PlaygroundReactiveContext — the same companion, aware of where she is and what just happened (PG3, the V5 release).
 *
 * Before this, a playground was scenery plus four chips: the pub came up, the person tapped
 * Cheers, a line went into the chat — and she stood there exactly as she stands in the
 * discoteca or the academy. This module lets the one companion react, in small ways, to what
 * actually happened in the place she is in, and tells her model (on the person's own turns
 * only) what is true about it. It does that by *coordinating* what already exists; it owns no
 * renderer, no loop, no clip, no voice and no chat:
 *
 *   observe   untrusted reports — a world shown, a chip chosen, a dance started, speech;
 *   verify    each report against the trusted owner — the renderer's own active world, the
 *             template catalogue's allowlist, the Private experience's own gate;
 *   decide    one small reaction at most per throttle step, by a deterministic profile per
 *             venue, with cooldowns, anti-repeat and a budget — never while a dance owns her
 *             body, never chatter during a study block, nothing nonessential under reduced
 *             motion;
 *   execute   through `BehaviorRouter.request` (which forwards to the Behavior Director and
 *             defers anything but speech-safe intents while she talks — lip-sync is never cut);
 *   confirm   only an intent the director actually played (`applied: 'behavior'`) is ever
 *             described to the model; a fallback, a deferral or a refusal is not;
 *   converse  one short, sanitised paragraph appended at the existing prompt seam
 *             (`PromptContext`), on user turns only — no model call per frame, per tick or per
 *             reaction, and no speech of its own.
 *
 * Trust, spelled out, because the inputs are events anybody's script can dispatch:
 *
 *  - A world is accepted only when the renderer's `vrWorlds.activeId` says it is up. The
 *    event's `owner`, `rating` and `title` are never believed: the rating and the words come
 *    from the catalogue, and a private room needs `privateAuthorized()`, which reads the
 *    Private experience's own running state (Intimate active, consent flow active, private
 *    mode on, and the renderer's world request owned by it) — never a payload field.
 *  - An action id counts only if the verified venue's template lists it; an anchor only if the
 *    template declares it for that venue. Unknown ids do nothing and are not mentioned.
 *  - Every observation and every queued reaction carries the generation of the world it was
 *    made in; a world change bumps it, so a late report or a late reaction from the last place
 *    is dropped rather than played in the next one.
 *  - Private observations are kept apart and wiped when Private ends, the room goes, or the
 *    session moves to Copilot. Nothing private ever reaches the prompt paragraph — Private has
 *    its own conversation surface — and nothing here is ever written to storage.
 *
 * Exposes: window.NEXUS_PLAYGROUND_REACTIVE
 */
(function (global) {
    'use strict';

    /** At most this many reactions a minute, and at most one every STEP_MS (≈ 4 Hz ceiling). */
    const BUDGET_PER_MINUTE = 6;
    const STEP_MS = 250;
    /** The same intent is not repeated inside its cooldown. */
    const COOLDOWN_MS = Object.freeze({
        smile: 6000,
        listen: 4000,
        look_at_user: 8000,
        look_at_object: 6000,
        celebrate: 15000,
        relax: 15000,
        greet: 60000,
    });
    /** A reaction that waited this long (behind speech, say) is no longer a reaction to anything. */
    const STALE_MS = 4000;
    /** What a reduced-motion user still gets: posture that is not movement for its own sake. */
    const REDUCED_MOTION_OK = Object.freeze(['listen', 'smile', 'look_at_user']);
    /** Remembered confirmed reactions, newest last, for the prompt paragraph. */
    const RECENT = 4;

    /**
     * Per venue: what happens on arrival, and what each chip means for her. Keys are template
     * action ids (validated against the catalogue before use); values are BehaviorRouter
     * intents. `quiet` actions turn on study silence; `owns` actions mean a clip owns her body
     * while they run, so no gesture competes with it.
     */
    const PROFILES = Object.freeze({
        'irish-pub': Object.freeze({
            enter: null,
            actions: Object.freeze({ cheers: 'smile', story: 'listen' }),
            note: 'Warm and easy-going, like friends at a bar.',
        }),
        'neon-discoteca': Object.freeze({
            enter: null,
            actions: Object.freeze({ music: 'listen' }),
            owns: Object.freeze(['dance']),
            afterOwn: 'look_at_user',
            note: 'Playful and energetic, but never loud in words.',
        }),
        'creative-academy': Object.freeze({
            enter: null,
            actions: Object.freeze({ quiz: 'listen', explain: 'listen' }),
            quiet: Object.freeze(['study']),
            note: 'Helpful and clear, like a study partner. Not romantic.',
        }),
        'private-cabaret': Object.freeze({
            enter: null,
            actions: Object.freeze({ song: 'smile' }),
            owns: Object.freeze(['dance']),
            afterOwn: 'look_at_user',
            private: true,
        }),
        'private-stream-studio': Object.freeze({
            enter: null,
            actions: Object.freeze({ live: 'smile', chat: 'listen' }),
            private: true,
        }),
    });
    /**
     * Any other place by name: no reaction of its own. Arrival is not ours either — IC3's
     * ActivityVoice already turns her toward the person when a place starts, and a second
     * request here made her smile twice (seen in the browser walkthrough). `enter` stays in
     * the shape for a world reached some other way, and is null for every venue today.
     */
    const DEFAULT_PROFILE = Object.freeze({ enter: null, actions: Object.freeze({}) });

    /** Words for the paragraph: only what she did, in the past tense, only once confirmed. */
    const DID = Object.freeze({
        smile: 'you smiled',
        listen: 'you turned to listen',
        look_at_user: 'you looked back at them',
        look_at_object: 'you looked toward',
        celebrate: 'you celebrated with them',
        relax: 'you relaxed',
    });

    /** A chip's label without its emoji: "🍻 Cheers" → "Cheers". */
    function words(label) {
        return clean(String(label || '').replace(/[^\p{L}\p{N}\s'’-]/gu, ' '), 40);
    }

    /**
     * PG3. The model's half of the planner: at most one `<gesture intent="…" target="…"/>` in a
     * reply. Every tag is stripped — the person never sees or hears one — and only the first is
     * kept, as a proposal. Pure. Nothing here decides whether it runs; `propose` does.
     */
    const GESTURE_TAG = /<\s*gesture\b([^>]*?)\/?>(?:\s*<\s*\/\s*gesture\s*>)?/gi;
    const PLANNER_INTENTS = Object.freeze([
        'smile',
        'look_at_user',
        'look_at_object',
        'listen',
        'dance',
        'stop_dancing',
    ]);
    function readAttr(attrs, name) {
        const m = new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']{1,40})["\']', 'i').exec(attrs || '');
        return m ? m[1].trim() : null;
    }
    function parseGesture(text) {
        const src = String(text == null ? '' : text);
        let proposal = null;
        let found = false;
        const stripped = src.replace(GESTURE_TAG, (whole, attrs) => {
            found = true;
            if (!proposal) proposal = { intent: readAttr(attrs, 'intent'), target: readAttr(attrs, 'target') };
            return '';
        });
        return { text: found ? stripped.replace(/[ \t]{2,}/g, ' ').trim() : src, proposal };
    }

    /**
     * While a reply streams in, hide a gesture tag from its first character: a whole one, an
     * unfinished one, or a trailing "<", "<g", "<ge"… that may become one. The final reply goes
     * through `consumeReply` at the displayText seam; this only keeps it from flashing. Pure.
     */
    function maskStreaming(text) {
        const src = String(text == null ? '' : text);
        // LW3. main.js masks streamed text through this one function, so Living Worlds' <go …/>
        // is hidden here too (WorldPresence owns the tag; this only keeps it off the screen).
        const i = src.search(/<\s*(?:gesture|go)\b/i);
        if (i !== -1) return src.slice(0, i).replace(/\s+$/, '');
        const tail = src.match(/<\s*(?:g(?:o|e(?:s(?:t(?:u(?:r(?:e)?)?)?)?)?)?)?$/i);
        return tail ? src.slice(0, tail.index).replace(/\s+$/, '') : src;
    }

    function clean(text, max) {
        return String(text == null ? '' : text)
            .replace(/[<>{}[\]`]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max || 80);
    }

    /**
     * The pure core. Every effect goes through the injected adapters, so a test can drive it
     * with a fake clock and fake owners; `attach` (below) wires the real ones.
     */
    function create(options) {
        const o = options || {};
        const now = typeof o.now === 'function' ? o.now : () => Date.now();
        const deny = () => false;
        const adapters = {
            performIntent: typeof o.performIntent === 'function' ? o.performIntent : () => null,
            verifyWorld: typeof o.verifyWorld === 'function' ? o.verifyWorld : deny,
            privateAuthorized: typeof o.privateAuthorized === 'function' ? o.privateAuthorized : deny,
            validateAction: typeof o.validateAction === 'function' ? o.validateAction : deny,
            getAnchor: typeof o.getAnchor === 'function' ? o.getAnchor : () => null,
            describe: typeof o.describe === 'function' ? o.describe : () => null,
            speaking: typeof o.speaking === 'function' ? o.speaking : deny,
            reducedMotion: typeof o.reducedMotion === 'function' ? o.reducedMotion : deny,
            // PG3. Where an anchor is on screen now (for the gaze), and the place's things.
            gazePoint: typeof o.gazePoint === 'function' ? o.gazePoint : () => null,
            // PG3. Run a venue chip by id, through the chip router — the clip's one owner.
            runChip: typeof o.runChip === 'function' ? o.runChip : () => false,
            listAnchors: typeof o.listAnchors === 'function' ? o.listAnchors : () => [],
        };

        let generation = 0;
        let world = null; // { id, base, rating, profile, title, line }
        let session = { active: false, destination: null, activity: null };
        let queue = []; // { name, objectId, label, generation, at, cause }
        let recent = []; // confirmed: { name, label, cause, generation }
        let observed = []; // validated person actions: { label, generation }
        let owning = null; // action id of a clip that owns her body
        let quiet = null; // action id of a running study block
        let lastObject = null; // { id, label, generation } — the last thing they pointed out
        let stoppedAt = null; // { generation, at } — when a body-owning clip (a dance) last stopped
        let moments = []; // confirmed shared moments from an experience's own director: { text, at }
        let lastStep = -Infinity;
        let lastName = null;
        let lastAt = {};
        let spent = []; // timestamps of performed reactions, for the budget

        function softReset() {
            queue = [];
            recent = [];
            observed = [];
            owning = null;
            quiet = null;
            lastName = null;
            lastObject = null;
        }

        /** Private worlds are honoured only while the Private experience itself says so. */
        function allowed(w) {
            if (!w) return false;
            if (w.profile && w.profile.private) return adapters.privateAuthorized() === true;
            return true;
        }

        function enqueue(name, extra) {
            if (!name || !world) return;
            queue.push(
                Object.assign({ name, generation, at: now(), objectId: null, label: null, cause: null }, extra || {})
            );
            if (queue.length > 4) queue.shift();
        }

        /**
         * A world reported shown. Accepted only when the renderer confirms it; the payload's
         * owner and rating are ignored — a private room needs the Private gate itself.
         */
        function enterWorld(detail) {
            const d = detail || {};
            const id = typeof d.id === 'string' ? d.id : null;
            generation += 1;
            softReset();
            stoppedAt = null;
            world = null;
            if (!id || adapters.verifyWorld(id) !== true) return false;
            const info = adapters.describe(id) || {};
            const base = typeof info.base === 'string' ? info.base : id;
            const profile = PROFILES[base] || DEFAULT_PROFILE;
            const candidate = {
                id,
                base,
                rating: info.rating || 'general',
                profile,
                title: clean(info.title || '', 40),
                line: clean(info.line || '', 90),
            };
            if (candidate.rating === 'private' && !profile.private) return false; // unknown private room: nothing
            if (!allowed(candidate)) return false;
            world = candidate;
            if (profile.enter && !(adapters.reducedMotion() && REDUCED_MOTION_OK.indexOf(profile.enter) < 0))
                enqueue(profile.enter, { cause: 'arrived' });
            return true;
        }

        function leaveWorld() {
            generation += 1;
            softReset();
            world = null;
        }

        /** The companion session moved. Copilot, or the end of a session, sheds everything. */
        function syncSession(s) {
            const next = {
                active: Boolean(s && s.active),
                destination: (s && s.destination) || null,
                activity: (s && s.activity) || null,
            };
            const toCopilot = next.destination === 'copilot';
            if (next.activity !== session.activity || !next.active) moments = [];
            session = next;
            if (toCopilot && world && world.profile.private) leaveWorld();
            if (toCopilot) {
                observed = observed.filter((x) => !x.private);
                recent = recent.filter((x) => !x.private);
            }
        }

        /**
         * PG3. A moment an experience's own director confirmed (Seaside's lantern, its shell).
         * That director already asked for her gesture; this only remembers it for the
         * conversation, in the experience's own words, and adds no reaction of its own.
         */
        function sharedMoment(detail) {
            const d = detail || {};
            const text = clean(typeof d.line === 'string' ? d.line : '', 120);
            if (!text) return false;
            moments.push({ text, objectId: clean(d.objectId || '', 20), at: now() });
            if (moments.length > 2) moments.shift();
            return true;
        }

        /**
         * PG3. A gesture the model proposed in its reply. A proposal, never authority: the intent
         * must be on the planner's short list (a subset of BehaviorRouter's), a target must be one
         * of the verified place's own anchors, the place must still be the one the reply was
         * written in, and the usual budget, cooldowns, clip ownership and study quiet apply.
         * Private rooms take none — Private has its own conversation and its own rules.
         */
        function propose(p, at) {
            const q = p || {};
            if (!world || world.profile.private || !allowed(world)) return { ok: false, why: 'no-place' };
            if (session.destination === 'copilot') return { ok: false, why: 'copilot' };
            if (at != null && at !== generation) return { ok: false, why: 'stale-generation' };
            const intent = typeof q.intent === 'string' ? q.intent : '';
            if (PLANNER_INTENTS.indexOf(intent) < 0) return { ok: false, why: 'intent-not-allowed' };
            // A dance is the venue's own chip, started or stopped by the router that owns it —
            // only where the venue has one, and never in the middle of a study block.
            if (intent === 'dance' || intent === 'stop_dancing') {
                const chip = danceChip();
                if (!chip) return { ok: false, why: 'no-dance-here' };
                if (quiet) return { ok: false, why: 'quiet' };
                if (intent === 'dance' && owning) return { ok: false, why: 'already-dancing' };
                if (intent === 'stop_dancing' && owning !== chip) return { ok: false, why: 'not-dancing' };
                return adapters.runChip(chip) === true ? { ok: true, intent } : { ok: false, why: 'chip-refused' };
            }
            let anchor = null;
            if (intent === 'look_at_object') {
                anchor = adapters.getAnchor(world.base, typeof q.target === 'string' ? q.target : '');
                if (!anchor) return { ok: false, why: 'unknown-target' };
            }
            if (owning) return { ok: false, why: 'clip-owns-body' };
            if (quiet && intent !== 'listen') return { ok: false, why: 'quiet' };
            enqueue(intent, {
                cause: 'planned',
                objectId: anchor ? anchor.id : null,
                label: anchor ? clean(anchor.label || anchor.id, 30) : null,
            });
            return { ok: true, intent, target: anchor ? anchor.id : null };
        }

        /** Private ended (its own stop, consent withdrawn): wipe everything Private left here. */
        function privateEnded() {
            if (world && world.profile.private) leaveWorld();
            observed = observed.filter((x) => !x.private);
            recent = recent.filter((x) => !x.private);
        }

        /**
         * A report from the chips or the scene. Untrusted: checked against the verified world,
         * its template and its generation before it can change anything.
         */
        function observe(event) {
            const e = event || {};
            if (!world) return false;
            if (e.generation != null && e.generation !== generation) return false;
            if (e.world != null && e.world !== world.id && e.world !== world.base) return false;
            if (!allowed(world)) {
                privateEnded();
                return false;
            }
            const priv = Boolean(world.profile.private);
            if (e.type === 'action') {
                const id = typeof e.actionId === 'string' ? e.actionId : '';
                const action = adapters.validateAction(world.base, id);
                if (!action) return false;
                const phase = e.phase || 'selected';
                const profile = world.profile;
                const label = words(action.label || id) || id;
                if (phase === 'selected') {
                    observed.push({ label: 'they chose ' + label, generation, private: priv });
                    if (observed.length > RECENT) observed.shift();
                    // A chip that plays a clip owns her body for that clip: nothing of ours
                    // follows it (a smile request could cut a wave halfway through).
                    if (action.kind === 'clip') {
                        queue = [];
                        return true;
                    }
                    const intent = profile.actions[id];
                    if (intent && !owning) enqueue(intent, { cause: label, user: true });
                } else if (phase === 'started') {
                    if (profile.owns && profile.owns.indexOf(id) >= 0) {
                        owning = id;
                        queue = []; // nothing queued may compete with the clip that now owns her
                    }
                    if (profile.quiet && profile.quiet.indexOf(id) >= 0) quiet = id;
                } else if (phase === 'stopped' || phase === 'completed' || phase === 'failed') {
                    if (owning === id) {
                        owning = null;
                        if (phase === 'stopped') stoppedAt = { generation, at: now() };
                        if (phase === 'stopped' && profile.afterOwn)
                            enqueue(profile.afterOwn, { cause: 'the dance ended' });
                    }
                    if (quiet === id) quiet = null;
                }
                return true;
            }
            if (e.type === 'object') {
                const anchor = adapters.getAnchor(world.base, typeof e.anchorId === 'string' ? e.anchorId : '');
                if (!anchor) return false;
                const label = clean(anchor.label || anchor.id, 30);
                lastObject = { id: anchor.id, label, generation, private: priv };
                observed.push({ label: 'they pointed out the ' + label, generation, private: priv });
                if (observed.length > RECENT) observed.shift();
                if (owning) return true;
                enqueue('look_at_object', {
                    user: true,
                    objectId: anchor.id,
                    label: clean(anchor.label || anchor.id, 30),
                    cause: 'they pointed out the ' + clean(anchor.label || anchor.id, 30),
                });
                return true;
            }
            return false;
        }

        /** What may run now: one reaction, if nothing forbids it. */
        function permitted(item, t) {
            if (item.generation !== generation) return 'stale-generation';
            if (t - item.at > STALE_MS) return 'stale';
            if (owning) return 'clip-owns-body';
            if (quiet && item.name !== 'listen') return 'quiet';
            if (adapters.reducedMotion() && REDUCED_MOTION_OK.indexOf(item.name) < 0) return 'reduced-motion';
            const cool = COOLDOWN_MS[item.name] || 5000;
            if (lastAt[item.name] != null && t - lastAt[item.name] < cool) return 'cooldown';
            // Anti-repeat damps her own initiative (arriving, a dance ending); an answer to
            // something the person just did is held only to the cooldown above.
            if (!item.user && lastName === item.name && lastAt[item.name] != null && t - lastAt[item.name] < cool * 2)
                return 'repeat';
            spent = spent.filter((x) => t - x < 60000);
            if (spent.length >= BUDGET_PER_MINUTE) return 'budget';
            return null;
        }

        /** Called from the existing experience runtime each frame. Cheap; never throws. */
        function update() {
            const t = now();
            if (t - lastStep < STEP_MS) return null;
            lastStep = t;
            if (!world || !queue.length) return null;
            if (!allowed(world)) {
                privateEnded();
                return null;
            }
            const item = queue[0];
            const why = permitted(item, t);
            if (why) {
                // Cooldown and speech wait; everything else is dropped.
                if (why !== 'cooldown') queue.shift();
                return { skipped: why, name: item.name };
            }
            let result = null;
            try {
                const ctx = { speaking: adapters.speaking() === true, objectId: item.objectId };
                // The gaze needs the anchor where it is on screen now, not where it was queued.
                if (item.name === 'look_at_object' && item.objectId) ctx.gazePoint = adapters.gazePoint(item.objectId);
                result = adapters.performIntent(item.name, ctx);
            } catch (error) {
                result = { ok: false, applied: 'none', why: 'threw' };
            }
            const applied = result && result.applied;
            if (applied === 'deferred') return { deferred: item.name }; // behind lip-sync: try again
            queue.shift();
            lastAt[item.name] = t;
            lastName = item.name;
            spent.push(t);
            if (applied === 'behavior') {
                recent.push({
                    name: item.name,
                    label: item.label,
                    cause: item.cause,
                    generation,
                    private: Boolean(world.profile.private),
                });
                if (recent.length > RECENT) recent.shift();
            }
            return { performed: item.name, applied: applied || 'none' };
        }

        /**
         * The paragraph for the model, or ''. Never for a private room (Private has its own
         * conversation), never for Copilot, and only what is verified: the place from the
         * catalogue, what they chose, and what she actually did.
         */
        function promptSuffix() {
            if (session.destination === 'copilot') return '';
            const recentMoments = moments.filter((m) => now() - m.at < 10 * 60000);
            if (!world) {
                return recentMoments.length
                    ? clean(
                          'Shared moment just now: ' +
                              recentMoments.map((m) => m.text).join(' ') +
                              ' (it already happened; you may refer to it; do not add people, animals or things that were not mentioned).',
                          360
                      )
                    : '';
            }
            if (world.profile.private) return '';
            if (!allowed(world)) return '';
            const parts = [];
            const where = world.title
                ? world.title + (world.line ? ' (' + world.line.replace(/\.$/, '') + ')' : '')
                : '';
            if (where) parts.push('Where you are: ' + where + '.');
            if (world.profile.note) parts.push(world.profile.note);
            const things = (adapters.listAnchors(world.base) || [])
                .map((a) => clean(a && a.label, 30))
                .filter(Boolean)
                .slice(0, 5);
            if (things.length) parts.push('Things here you both can see: ' + things.join(', ') + '.');
            if (recentMoments.length)
                parts.push('Shared moment just now: ' + recentMoments.map((m) => m.text).join(' '));

            if (quiet)
                parts.push('A study block is running: stay quiet unless they speak, no new topics, no questions.');
            if (owning) parts.push('You are dancing together right now; keep words few.');
            else if (stoppedAt && stoppedAt.generation === generation && now() - stoppedAt.at < 120000)
                parts.push('The dance has stopped; you are not dancing now.');
            const did = recent
                .filter((r) => r.generation === generation && DID[r.name])
                .slice(-2)
                .map((r) => DID[r.name] + (r.name === 'look_at_object' && r.label ? ' the ' + r.label : ''))
                .filter((x, i, all) => all.indexOf(x) === i);
            const saw = observed
                .filter((x) => x.generation === generation)
                .slice(-2)
                .map((x) => x.label);
            if (saw.length)
                parts.push('Just now ' + saw.join(', then ') + (did.length ? '; ' + did.join(' and ') : '') + '.');
            else if (did.length) parts.push('Just now ' + did.join(' and ') + '.');
            parts.push(
                'Mention only what is listed here as having happened; never describe an object, action or gesture that is not, and do not add people, animals or things this description does not name.'
            );
            return clean(parts.join(' '), 720);
        }

        /**
         * PG3. The planner's offer, kept apart from the paragraph because it must carry angle
         * brackets the paragraph's sanitiser removes. Built only from constants and anchor ids
         * that match /^[a-z0-9-]+$/, and only where `promptSuffix` would speak at all.
         */
        /** The venue's body-owning clip chip (its dance), if it has one and the template lists it. */
        function danceChip() {
            if (!world || !world.profile.owns) return null;
            const id = world.profile.owns[0];
            const action = adapters.validateAction(world.base, id);
            return action && action.kind === 'clip' ? id : null;
        }

        function plannerOffer() {
            if (!world || world.profile.private || session.destination === 'copilot' || !allowed(world)) return '';
            const ids = (adapters.listAnchors(world.base) || [])
                .map((a) => (a && /^[a-z0-9-]{1,30}$/.test(String(a.id)) ? a.id : ''))
                .filter(Boolean)
                .slice(0, 5);
            return (
                'If a small gesture fits, you may end a reply with one tag: <gesture intent="smile"/>, ' +
                '<gesture intent="look_at_user"/>' +
                (danceChip() ? ', <gesture intent="dance"/>, <gesture intent="stop_dancing"/>' : '') +
                (ids.length ? ', or <gesture intent="look_at_object" target="' + ids.join('|') + '"/>' : '') +
                '. It is optional, never shown, and you must not say you did it.'
            );
        }

        function dispose() {
            leaveWorld();
            moments = [];
            session = { active: false, destination: null, activity: null };
            lastAt = {};
            spent = [];
        }

        return {
            enterWorld,
            leaveWorld,
            syncSession,
            privateEnded,
            sharedMoment,
            propose,
            plannerOffer,
            observe,
            update,
            promptSuffix,
            dispose,
            state() {
                return {
                    generation,
                    world: world ? { id: world.id, base: world.base, rating: world.rating } : null,
                    queue: queue.map((q) => q.name),
                    recent: recent.map((r) => ({ name: r.name, label: r.label })),
                    owning,
                    quiet,
                    lastObject: lastObject ? { id: lastObject.id, label: lastObject.label } : null,
                    moments: moments.map((m) => m.objectId),
                };
            },
        };
    }

    // ── wiring: the trusted adapters, and the untrusted reports they check ─────────────

    /**
     * Private is open only while the Private experience is itself running (its activity and
     * the consent flow both active, private mode on) and the renderer's current world request
     * is its own. Every one of those is state owned elsewhere; nothing in an event decides it.
     */
    function privateOpenNow(g) {
        try {
            const bd = g.NEXUS_BD;
            const spicy = g.NEXUS_SPICY;
            const engine = g.NEXUS_VIEWER;
            return Boolean(
                bd &&
                    bd.intimate &&
                    bd.intimate.active === true &&
                    bd.adult &&
                    bd.adult.active === true &&
                    spicy &&
                    typeof spicy.isEnabled === 'function' &&
                    spicy.isEnabled() &&
                    engine &&
                    engine._worldRequest &&
                    engine._worldRequest.owner === 'intimate'
            );
        } catch (_) {
            return false;
        }
    }

    function attach(options) {
        const o = options || {};
        const g = o.global || global;
        if (!g) return null;
        const live = o.live || null;
        const behavior = o.behavior || (live && live.behavior) || null;
        const catalogue = () => (g.__NEXUS_REACTIVE_CATALOGUE ? g.__NEXUS_REACTIVE_CATALOGUE.worlds || [] : []);
        const templates = () => g.NEXUS_PLAYGROUND_TEMPLATES || null;

        // The world catalogue, for titles and the light stand-in's base. Fetched once.
        try {
            const W = g.NEXUS_VR_WORLDS;
            if (W && typeof W.loadCatalogue === 'function' && !g.__NEXUS_REACTIVE_CATALOGUE)
                Promise.resolve(W.loadCatalogue())
                    .then((c) => {
                        g.__NEXUS_REACTIVE_CATALOGUE = c;
                    })
                    .catch(() => {});
        } catch (_) {
            /* titles fall back to nothing */
        }

        const core = create({
            performIntent(name, ctx) {
                return behavior && typeof behavior.request === 'function' ? behavior.request(name, ctx) : null;
            },
            verifyWorld(id) {
                try {
                    return Boolean(
                        g.NEXUS_VIEWER && g.NEXUS_VIEWER.vrWorlds && g.NEXUS_VIEWER.vrWorlds.activeId === id
                    );
                } catch (_) {
                    return false;
                }
            },
            describe(id) {
                const w = catalogue().find((x) => x.id === id);
                if (!w) return null;
                const base = w.lightFor || w.id;
                const b = catalogue().find((x) => x.id === base) || w;
                return { base, rating: b.rating, title: b.title, line: b.note };
            },
            privateAuthorized: () => privateOpenNow(g),
            validateAction(base, actionId) {
                const T = templates();
                const t = T && T.TEMPLATES ? T.TEMPLATES.find((x) => x.world === base) : null;
                return (t && t.actions.find((a) => a.id === actionId)) || null;
            },
            listAnchors(base) {
                const T = templates();
                const t = T && T.TEMPLATES ? T.TEMPLATES.find((x) => x.world === base) : null;
                return t && Array.isArray(t.anchors) ? t.anchors : [];
            },
            runChip(id) {
                const router = o.router || g.__NEXUS_PLAYGROUND_LIVE;
                if (!router || typeof router.act !== 'function' || !router.template) return false;
                router.act(id);
                return true;
            },
            gazePoint(anchorId) {
                const picker = o.picker || null;
                return picker && typeof picker.gazePoint === 'function' ? picker.gazePoint(anchorId) : null;
            },
            getAnchor(base, anchorId) {
                const T = templates();
                const t = T && T.TEMPLATES ? T.TEMPLATES.find((x) => x.world === base) : null;
                const anchor = t && Array.isArray(t.anchors) ? t.anchors.find((a) => a.id === anchorId) : null;
                return anchor || null;
            },
            speaking() {
                try {
                    const f = g.NEXUS_BD && g.NEXUS_BD.blackboard && g.NEXUS_BD.blackboard.flags;
                    return Boolean(f && f.ttsSpeaking);
                } catch (_) {
                    return false;
                }
            },
            reducedMotion() {
                try {
                    return Boolean(g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches);
                } catch (_) {
                    return false;
                }
            },
            now: o.now,
        });

        const onShown = (event) => {
            const d = (event && event.detail) || {};
            if (d.id) core.enterWorld(d);
            else core.leaveWorld();
        };
        const onAction = (event) => core.observe(Object.assign({ type: 'action' }, (event && event.detail) || {}));
        const onObject = (event) => core.observe(Object.assign({ type: 'object' }, (event && event.detail) || {}));
        if (g.addEventListener) {
            g.addEventListener('nexus-world-shown', onShown);
            g.addEventListener('nexus-playground-action', onAction);
            g.addEventListener('nexus-playground-object', onObject);
        }
        let offSession = () => {};
        const sess = live && live.session;
        if (sess && typeof sess.on === 'function') {
            const sync = () =>
                core.syncSession({
                    active: sess.active(),
                    destination: sess.destination(),
                    activity: sess.activity(),
                });
            sync();
            offSession = sess.on(sync) || (() => {});
        }
        // PG3. An experience's director confirms its own interactions (Seaside's lantern).
        let offDirector = () => {};
        const director = live && live.director;
        if (director && typeof director.on === 'function') {
            offDirector =
                director.on((detail) => {
                    if (detail && detail.type === 'interaction:completed') core.sharedMoment(detail);
                }) || (() => {});
        }
        // Private's own endings, on the bus's registered names.
        const offs = [];
        try {
            const bus = g.NEXUS_BD && g.NEXUS_BD.bus;
            if (bus && typeof bus.on === 'function')
                for (const name of ['private:session-stop', 'adult:exit'])
                    offs.push(bus.on(name, () => core.privateEnded()));
        } catch (_) {
            /* without the bus, the gate check on every step still wipes it */
        }

        return {
            core,
            update(dt) {
                try {
                    return core.update(dt);
                } catch (error) {
                    console.warn('[Reactive] update threw', error);
                    return null;
                }
            },
            promptSuffix() {
                try {
                    return core.promptSuffix();
                } catch (_) {
                    return '';
                }
            },
            plannerOffer() {
                try {
                    return core.plannerOffer();
                } catch (_) {
                    return '';
                }
            },
            /**
             * PG3. An assistant reply at the displayText seam: strip every gesture tag, and offer
             * the first to `propose`. Replies only — the caller never hands a user's text here.
             */
            consumeReply(text) {
                try {
                    const parsed = parseGesture(text);
                    if (parsed.proposal) core.propose(parsed.proposal, core.state().generation);
                    return parsed.text;
                } catch (_) {
                    return String(text == null ? '' : text).replace(GESTURE_TAG, '');
                }
            },
            detach() {
                if (g.removeEventListener) {
                    g.removeEventListener('nexus-world-shown', onShown);
                    g.removeEventListener('nexus-playground-action', onAction);
                    g.removeEventListener('nexus-playground-object', onObject);
                }
                try {
                    offSession();
                    offDirector();
                } catch (_) {
                    /* already gone */
                }
                for (const off of offs) {
                    try {
                        if (typeof off === 'function') off();
                    } catch (_) {
                        /* already gone */
                    }
                }
                core.dispose();
            },
        };
    }

    const api = {
        create,
        attach,
        parseGesture,
        maskStreaming,
        PLANNER_INTENTS,
        privateOpenNow,
        PROFILES,
        DEFAULT_PROFILE,
        COOLDOWN_MS,
        BUDGET_PER_MINUTE,
        STEP_MS,
        STALE_MS,
        REDUCED_MOTION_OK,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PLAYGROUND_REACTIVE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
