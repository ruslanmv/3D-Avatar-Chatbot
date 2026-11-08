/**
 * PrivateWorldAdapter — the premium Private World: measured places, real interactions, and a gate
 * that fails closed (PW, the NEXUS Premium Private World Engine).
 *
 * Why this exists. Living Worlds (LW1–LW5) gave general places measured spots, confirmed moves
 * and a grounded shared moment — and deliberately gave private rooms none of it: WorldPresence
 * refuses every private world. That refusal is right and stays. A private room still deserves the
 * same quality (she knows where she is, moves on request, and never narrates what did not happen),
 * but only under a gate stricter than the general one. So this module does not loosen anything:
 * it builds a SECOND, private-only WorldPresence instance and lets it act only while every one of
 * these is true at that very moment (asked again at each step, never cached as "yes"):
 *
 *   1. DEPLOYMENT  — the site itself enabled it: `NEXUS_PRIVATE_WORLD_CONFIG = { enabled: true,
 *      eligibility: 'server-attested' }`. Absent (every build today), nothing here ever acts.
 *      A device-local self-declaration is not accepted as age assurance for this experience.
 *   2. ATTESTATION — the server's adult attestation is on the Behavior Director's blackboard
 *      (`adultVerified === true`). Only SessionAdapter writes it, from the server's message.
 *   3. PRIVATE RUNNING — PG3's `privateOpenNow()`: the Intimate activity and ConsentFlow are both
 *      active, private mode is on, and the renderer's world request is the `intimate` owner's.
 *   4. WORLD — the renderer really shows one of this experience's worlds, rated private in the
 *      catalogue (`vrWorlds.activeId`); an event that says so is not enough.
 *   5. AVATAR — the avatar on screen is a library avatar that Wardrobe Forge's operator has
 *      declared adult (`depictsAdult`, the same declaration Try-On's private gate uses). Unknown,
 *      external or unreachable answers "no". Never an age-ambiguous character in an adult room.
 *
 * The moment any of them turns false, `revoke()` runs: the private presence forgets everything,
 * a light it changed goes back to the room's own, a dance it started stops, and no word of the
 * private room reaches any later prompt. The experience's own ending (`private:session-stop`,
 * `adult:exit`), Clear and the session ending do the same.
 *
 * What she can do in the room is data — `assets/vr-worlds/private/<id>.json`, validated here
 * against what exists (catalogue worlds rated private, mood presets, the venue template's chips
 * and anchors; spots against the measured spots file). A config can only name these; it can
 * never grant access, change a rating or run code. Each interaction is executed by its owner and
 * reported only once that owner confirms it:
 *
 *   go     → the private WorldPresence → VRWorlds `goToSpot` (spotId)
 *   light  → VRWorlds `setMood` (true / false)
 *   chip   → the playground router's clip chip (its `nexus-playground-action` 'started'/'failed')
 *   look   → BehaviorRouter `look_at_object` at a template anchor (`applied: 'behavior'`)
 *
 * The person's own words run an interaction ("luce più calda", "balla per me"); her
 * <act id="…"/> is only an offer that their next "sì" takes — never permission. Text sent to
 * the model is non-explicit and spatial: where you are, what is here, what can happen. Tone and
 * intensity stay with the Private experience and ConsentFlow, which this module never calls.
 *
 * Exposes: window.NEXUS_PRIVATE_WORLD
 */
(function (global) {
    'use strict';

    const SCHEMA = 1;
    const ID = /^[a-z0-9-]{1,40}$/;
    const KINDS = Object.freeze(['go', 'light', 'chip', 'chip-stop', 'look']);
    const FIELDS = Object.freeze(['schemaVersion', 'id', 'title', 'worlds', 'template', 'tone', 'interactions']);
    const ACT_FIELDS = Object.freeze(['id', 'kind', 'preset', 'chip', 'anchor', 'spot', 'label', 'words']);
    const CONFIRM_MS = 6000;
    const ACT_TAG = /<\s*act\b([^>]*?)\/?>(?:\s*<\s*\/\s*act\s*>)?/gi;
    const YES =
        /^(?:si|sì|yes|yeah|yep|sure|ok|okay|va bene|certo|dai|perfetto|volentieri|of course|why not|perche no|perché no)\b/;
    const NO = /\b(?:no|non|nope|nah|not now|later|dopo|meglio di no|preferisco di no)\b/;

    function norm(s) {
        return String(s || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[’`]/g, "'")
            .trim();
    }

    /**
     * The session the room's presence reads. Intimate runs no companion session, so "active" is
     * the gate itself; there is no `enter`, so nothing in the room can start another activity.
     */
    function roomSession(isOpen) {
        return Object.freeze({
            active: () => {
                try {
                    return isOpen() === true;
                } catch (_) {
                    return false;
                }
            },
            activity: () => null,
            destination: () => 'life',
        });
    }

    function text(v, max) {
        return typeof v === 'string'
            ? v
                  .replace(/[<>{}[\]`]/g, '')
                  .trim()
                  .slice(0, max || 80)
            : '';
    }

    function label2(v, max) {
        const en = text(v && v.en, max || 80);
        return en ? { en, it: text(v.it, max || 80) || en } : null;
    }

    /**
     * Validate an experience config against what really exists. Pure given `ctx`:
     *   ctx.worlds          the catalogue's worlds (VRWorlds.validateCatalogue(...).worlds)
     *   ctx.preset(id)      PlaygroundMoodPresets.get
     *   ctx.template(id)    the venue template (PlaygroundTemplateCatalog), or null
     * Returns { ok, config, problems }. A config with any problem is refused whole: half a
     * private experience is worse than none.
     */
    function validateConfig(raw, ctx) {
        const c = ctx || {};
        const problems = [];
        if (!raw || typeof raw !== 'object') return { ok: false, config: null, problems: ['not an object'] };
        for (const k of Object.keys(raw)) if (!FIELDS.includes(k)) problems.push(`unknown field ${k}`);
        if (raw.schemaVersion !== SCHEMA) problems.push('schemaVersion must be 1');
        if (typeof raw.id !== 'string' || !ID.test(raw.id)) problems.push('bad id');
        const title = label2(raw.title);
        if (!title) problems.push('title.en required');
        const worlds = Array.isArray(raw.worlds) ? raw.worlds : [];
        if (!worlds.length) problems.push('worlds required');
        for (const w of worlds) {
            const found = (c.worlds || []).find((x) => x.id === w);
            if (!found) problems.push(`world ${w} is not in the catalogue`);
            // A config can never make a general world private context, or anything else.
            else if (found.rating !== 'private') problems.push(`world ${w} is not rated private`);
        }
        const template = typeof raw.template === 'string' && c.template ? c.template(raw.template) : null;
        if (!template) problems.push('template not found');
        else if (template.rating !== 'private') problems.push('template is not private');
        const interactions = [];
        const seen = new Set();
        for (const a of Array.isArray(raw.interactions) ? raw.interactions : []) {
            const where = `interaction ${a && a.id}`;
            if (!a || typeof a !== 'object') {
                problems.push('interaction must be an object');
                continue;
            }
            for (const k of Object.keys(a)) if (!ACT_FIELDS.includes(k)) problems.push(`${where}: unknown field ${k}`);
            if (typeof a.id !== 'string' || !ID.test(a.id) || seen.has(a.id))
                problems.push(`${where}: bad or repeated id`);
            seen.add(a.id);
            if (!KINDS.includes(a.kind)) problems.push(`${where}: unknown kind ${a.kind}`);
            if (a.kind === 'light' && a.preset !== null && !(c.preset && c.preset(a.preset)))
                problems.push(`${where}: unknown preset ${a.preset}`);
            if ((a.kind === 'chip' || a.kind === 'chip-stop') && template) {
                const action = template.actions.find((x) => x.id === a.chip);
                if (!action || action.kind !== 'clip') problems.push(`${where}: template has no clip chip ${a.chip}`);
            }
            if (a.kind === 'look' && template && !(template.anchors || []).some((x) => x.id === a.anchor))
                problems.push(`${where}: template has no anchor ${a.anchor}`);
            if (a.kind === 'go' && (typeof a.spot !== 'string' || !ID.test(a.spot)))
                problems.push(`${where}: bad spot`);
            const label = label2(a.label);
            if (!label) problems.push(`${where}: label.en required`);
            const words = {
                en: (Array.isArray(a.words && a.words.en) ? a.words.en : [])
                    .map((w) => norm(text(w, 40)))
                    .filter(Boolean),
                it: (Array.isArray(a.words && a.words.it) ? a.words.it : [])
                    .map((w) => norm(text(w, 40)))
                    .filter(Boolean),
            };
            interactions.push({
                id: a.id,
                kind: a.kind,
                preset: a.kind === 'light' ? a.preset : undefined,
                chip: a.chip,
                anchor: a.anchor,
                spot: a.spot,
                label,
                words,
            });
        }
        if (!interactions.length) problems.push('interactions required');
        if (problems.length) return { ok: false, config: null, problems };
        return {
            ok: true,
            problems: [],
            config: Object.freeze({
                id: raw.id,
                title,
                worlds: worlds.slice(),
                template: raw.template,
                // A sentence, not a label: 80 characters cut the shipped tone mid-word ("let a qu").
                tone: label2(raw.tone, 240),
                interactions,
            }),
        };
    }

    /**
     * The gate, as a pure function of the five answers. Order matters only for the reason given
     * back — every one must be true. Returns { ok, why }.
     */
    function evaluateGate(s) {
        const x = s || {};
        if (x.deployment !== true) return { ok: false, why: 'disabled-in-this-build' };
        if (x.attested !== true) return { ok: false, why: 'no-server-attestation' };
        if (x.privateOpen !== true) return { ok: false, why: 'private-experience-not-active' };
        if (x.world !== true) return { ok: false, why: 'not-this-experience-world' };
        if (x.avatarAdult !== true) return { ok: false, why: 'avatar-not-declared-adult' };
        return { ok: true, why: 'open' };
    }

    /** The person's own words → an interaction id, or null. Longest phrase wins. Pure. */
    function actIntentOf(message, interactions) {
        const t = norm(message);
        if (!t) return null;
        let best = null;
        for (const a of interactions || []) {
            for (const w of [].concat(a.words.en, a.words.it)) {
                if (w.length >= 3 && t.includes(w) && (!best || w.length > best.len))
                    best = { id: a.id, len: w.length };
            }
        }
        return best ? best.id : null;
    }

    /** Strip every <act …/> tag; the first one's id, if any. Pure. */
    function parseAct(raw) {
        const src = String(raw == null ? '' : raw);
        let first = null;
        const clean = src
            .replace(ACT_TAG, (_, attrs) => {
                if (!first) {
                    const m = /\bid\s*=\s*"([^"]{1,40})"/i.exec(attrs || '');
                    first = m ? m[1].trim() : '';
                }
                return '';
            })
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/\s+([,.!?])/g, '$1')
            .trim();
        return { clean, id: first };
    }

    /**
     * The core. `deps`: gate() → {ok, why}; presence (a WorldPresence core built with a
     * privateGate); runtime() (VRWorlds runtime); preset(id); router() (playground router);
     * behavior (BehaviorRouter); gazePoint(anchor) → {x,y} | null; waitFor(chip, phases, ms) →
     * Promise<phase|null>; config (validated); emit(name, detail); now().
     */
    function create(deps) {
        const d = deps || {};
        const now = d.now || (() => Date.now());
        const emit = d.emit || (() => {});
        const config = d.config;
        let turn = 0;
        let offer = null; // { id, turn }
        let last = null; // { id, ok, why, at }
        let lit = false; // a light this module changed
        let dancing = false; // a dance this module started and has not seen stop
        let revoked = null; // { why, at }
        let epoch = 0; // bumped by every revoke: an await that outlives one is stale
        let inFlight = null; // { id } while an owner has not answered yet
        let wasOpen = false;

        function gate() {
            let g;
            try {
                g = d.gate ? d.gate() : { ok: false, why: 'no-gate' };
            } catch (_) {
                g = { ok: false, why: 'gate-error' };
            }
            if (g.ok) {
                wasOpen = true;
                revoked = null;
            } else if (wasOpen) revoke(g.why);
            return g;
        }

        function find(id) {
            return (config && config.interactions.find((a) => a.id === id)) || null;
        }

        /** Undo what this module changed and forget the room. Safe to call at any time. */
        function revoke(why) {
            epoch += 1;
            // Idempotent: one consent exit arrives as adult:exit and then private:session-stop, and
            // the second must not report a second revocation of a room already forgotten.
            const had = Boolean(wasOpen || lit || dancing || offer || last || !revoked);
            wasOpen = false;
            if (had) revoked = { why: String(why || 'revoked'), at: now() };
            offer = null;
            last = null;
            try {
                if (d.presence) d.presence.reset('private-revoked');
            } catch (_) {
                /* forgotten anyway */
            }
            if (lit) {
                lit = false;
                try {
                    const rt = d.runtime && d.runtime();
                    if (rt && typeof rt.setMood === 'function') rt.setMood(null, { instant: true });
                } catch (_) {
                    /* the world's own light comes back with the world */
                }
            }
            if (dancing) {
                dancing = false;
                try {
                    const r = d.router && d.router();
                    const stop = config && config.interactions.find((a) => a.kind === 'chip');
                    if (r && stop && typeof r.act === 'function') r.act(stop.chip);
                } catch (_) {
                    /* leaving the world stops it too */
                }
            }
            if (had) emit('nexus-private-world', { kind: 'revoked', why: revoked.why });
        }

        function note(id, ok, why) {
            last = { id, ok, why: why || (ok ? 'confirmed' : 'failed'), at: now() };
            emit('nexus-private-world', { kind: ok ? 'confirmed' : 'failed', act: id, why: last.why });
            return { ok, act: id, why: last.why };
        }

        /** Run one interaction through its owner; report it only when the owner confirms. */
        function worldNow() {
            try {
                const rt = d.runtime && d.runtime();
                return (rt && rt.activeId) || null;
            } catch (_) {
                return null;
            }
        }

        async function act(id, options) {
            const o = options || {};
            const g = gate();
            if (!g.ok) return { ok: false, act: id, why: g.why };
            const mine = { id };
            inFlight = mine;
            try {
                return await run(id, o);
            } finally {
                if (inFlight === mine) inFlight = null;
            }
        }

        async function run(id, o) {
            // Matrix 8. What an await brings back belongs to the world and the opening it started
            // in. A revoke-and-reopen, or the other variant of this room, while a dance or a move
            // was pending is a different session: its answer is dropped, never narrated.
            const started = { epoch, world: worldNow() };
            const stale = () => !gate().ok || epoch !== started.epoch || worldNow() !== started.world;
            const a = find(id);
            if (!a) return { ok: false, act: id, why: 'unknown-interaction' };
            if (a.kind === 'go') {
                const r = await d.presence.go(a.spot, { source: o.source || 'user' });
                if (stale()) return { ok: false, act: id, why: 'stale' };
                return note(id, Boolean(r && r.ok), r && r.why);
            }
            if (a.kind === 'light') {
                const rt = d.runtime && d.runtime();
                const preset = a.preset ? d.preset && d.preset(a.preset) : null;
                if (!rt || typeof rt.setMood !== 'function' || (a.preset && !preset))
                    return note(id, false, 'no-light');
                const ok = rt.setMood(preset ? preset.light : null, { instant: Boolean(o.instant) }) === true;
                lit = ok ? Boolean(a.preset) : lit;
                return note(id, ok, ok ? 'confirmed' : 'refused');
            }
            if (a.kind === 'chip' || a.kind === 'chip-stop') {
                const r = d.router && d.router();
                if (!r || !r.template || r.template.id !== config.template || typeof r.act !== 'function')
                    return note(id, false, 'no-venue');
                if (a.kind === 'chip' && dancing) return note(id, true, 'already');
                if (a.kind === 'chip-stop' && !dancing) return note(id, true, 'not-dancing');
                const waiting = d.waitFor
                    ? d.waitFor(a.chip, a.kind === 'chip' ? ['started', 'failed'] : ['stopped'], CONFIRM_MS)
                    : Promise.resolve(null);
                r.act(a.chip);
                const phase = await waiting;
                if (stale()) return { ok: false, act: id, why: 'stale' };
                if (a.kind === 'chip') {
                    dancing = phase === 'started';
                    return note(id, dancing, phase || 'no-answer');
                }
                dancing = phase === 'stopped' ? false : dancing;
                return note(id, phase === 'stopped', phase || 'no-answer');
            }
            if (a.kind === 'look') {
                const point = d.gazePoint ? d.gazePoint(a.anchor) : null;
                if (!point || !d.behavior || typeof d.behavior.request !== 'function')
                    return note(id, false, 'no-anchor');
                const r = d.behavior.request('look_at_object', {
                    gazePoint: point,
                    objectId: a.anchor,
                    source: 'private',
                });
                return note(id, Boolean(r && r.applied === 'behavior'), r && r.applied);
            }
            return note(id, false, 'unsupported');
        }

        /** The person's own turn: answer an offer, run what they asked for, or move. */
        function observeUser(message) {
            turn += 1;
            const g = gate();
            if (!g.ok) return null;
            const t = norm(message);
            const offered = offer && offer.turn === turn - 1 ? offer : null;
            offer = null;
            if (offered && YES.test(t) && !NO.test(t)) {
                act(offered.id, { source: 'assistant-accepted' });
                return { kind: 'act', id: offered.id };
            }
            const id = actIntentOf(message, config && config.interactions);
            if (id) {
                act(id, { source: 'user' });
                return { kind: 'act', id };
            }
            return d.presence ? d.presence.observeUser(message) : null;
        }

        /** Her reply: strip <act/>; while open, an <act/> becomes an offer, <go spot/> goes to presence. */
        function consumeReply(reply) {
            const { clean, id } = parseAct(reply);
            if (!gate().ok) return clean;
            if (id && find(id)) offer = { id, turn };
            return d.presence ? d.presence.consumeReply(clean) : clean;
        }

        /** Non-explicit, spatial and verified: where you are, what is here, what can happen. */
        function promptSuffix(destination) {
            if (destination === 'copilot') return '';
            if (!gate().ok || !d.presence) return '';
            const parts = [];
            const here = d.presence.promptSuffix(destination);
            if (here) parts.push(here);
            if (config && config.tone) parts.push(config.tone.en);
            parts.push(
                'Here you can offer: ' +
                    config.interactions.map((a) => a.label.en).join(', ') +
                    '. They happen only when the person asks or says yes, and only once the app confirms them.'
            );
            if (last && now() - last.at < 120000) {
                const a = find(last.id);
                if (a) parts.push(last.ok ? `Just now: ${a.label.en} (confirmed).` : `${a.label.en} did not happen.`);
            }
            if (inFlight) {
                const a = find(inFlight.id);
                if (a)
                    parts.push(
                        `Happening now: ${a.label.en}. The app is doing it and has not confirmed it yet: ` +
                            'do not say it is done.'
                    );
            }
            if (offer && offer.turn === turn) {
                const a = find(offer.id);
                if (a) parts.push(`You offered ${a.label.en}; it happens only if they say yes.`);
            }
            return parts
                .join(' ')
                .replace(/[<>{}[\]`]/g, '')
                .slice(0, 1400);
        }

        /** The exact tag offer; PromptContext accepts only this shape. */
        function actOffer(destination) {
            if (destination === 'copilot' || !gate().ok || !config) return '';
            const ids = config.interactions.map((a) => a.id).slice(0, 12);
            return `To offer one of these, end your reply with one tag: <act id="${ids.join('|')}"/>; it happens only if they say yes.`;
        }

        function reset(why) {
            epoch += 1;
            offer = null;
            last = null;
            try {
                if (d.presence) d.presence.reset(why || 'reset');
            } catch (_) {
                /* nothing to keep */
            }
        }

        return {
            act,
            observeUser,
            consumeReply,
            promptSuffix,
            actOffer,
            goOffer: (destination) => (destination === 'copilot' || !gate().ok ? '' : d.presence.goOffer(destination)),
            reset,
            revoke,
            gate,
            onRouterReport(detail) {
                // The router also stops a clip on its own (the person's chip tap, the place
                // ending); its report is the truth about whether she is still dancing.
                if (
                    detail &&
                    config &&
                    detail.phase === 'stopped' &&
                    config.interactions.some((a) => a.kind === 'chip' && a.chip === detail.actionId)
                )
                    dancing = false;
            },
            state: () => ({
                open: gate().ok,
                inFlight: inFlight ? inFlight.id : null,
                revoked: revoked ? revoked.why : null,
                offer: offer ? offer.id : null,
                last: last ? { id: last.id, ok: last.ok, why: last.why } : null,
                dancing,
                lit,
                presence: d.presence ? d.presence.state() : null,
            }),
        };
    }

    /** Wire the trusted owners. Nothing here runs unless the gate opens. */
    function attach(options) {
        const o = options || {};
        const g = o.global || global;
        const live = o.live;
        const Presence = g.NEXUS_WORLD_PRESENCE;
        const Spots = g.NEXUS_WORLD_SPOTS;
        const Worlds = g.NEXUS_VR_WORLDS;
        const Templates = g.NEXUS_PLAYGROUND_TEMPLATES;
        const Moods = g.NEXUS_PLAYGROUND_MOODS;
        const Reactive = g.NEXUS_PLAYGROUND_REACTIVE;
        if (!Presence || !Spots || !Worlds) return null;
        const runtime = () => (g.NEXUS_VIEWER && g.NEXUS_VIEWER.vrWorlds) || null;
        let config = null;
        let catalogue = [];
        let avatar = { key: null, adult: false };

        function deployment() {
            const c = g.NEXUS_PRIVATE_WORLD_CONFIG;
            return Boolean(c && c.enabled === true && c.eligibility === 'server-attested');
        }
        function attested() {
            const bb = g.NEXUS_BD && g.NEXUS_BD.blackboard;
            return Boolean(bb && bb.adultVerified === true);
        }
        function worldOk() {
            const rt = runtime();
            if (!rt || !config || !config.worlds.includes(rt.activeId)) return false;
            const w = catalogue.find((x) => x.id === rt.activeId);
            return Boolean(w && w.rating === 'private');
        }
        function avatarKey() {
            try {
                const m = g.NEXUS_VIEWER && g.NEXUS_VIEWER.avatarManager;
                const cur = m && typeof m.getCurrent === 'function' ? m.getCurrent() : null;
                return (cur && (cur.url || cur.name)) || null;
            } catch (_) {
                return null;
            }
        }
        /** AvatarAdultDeclaration: the one owner of "is this avatar declared adult?"; no is the default. */
        async function checkAvatar() {
            const key = avatarKey();
            avatar = { key, adult: false };
            const A = g.NEXUS_AVATAR_ADULT;
            if (!A || typeof A.check !== 'function') return;
            const r = await A.check(g);
            if (avatarKey() === key) avatar = { key, adult: Boolean(r && r.ok === true) };
        }
        function gateNow() {
            return evaluateGate({
                deployment: deployment(),
                attested: attested(),
                privateOpen: Boolean(Reactive && Reactive.privateOpenNow && Reactive.privateOpenNow(g)),
                world: worldOk(),
                avatarAdult: avatar.adult === true && avatar.key === avatarKey(),
            });
        }

        const emit = (name, detail) => {
            try {
                if (g.dispatchEvent && g.CustomEvent) g.dispatchEvent(new g.CustomEvent(name, { detail }));
            } catch (_) {
                /* nobody is listening */
            }
        };
        const presence = Presence.create({
            runtime,
            spotsApi: Spots,
            // The companion session is not what is running here — Intimate is, and it has no
            // companion session at all — so "active" for this room is the gate itself. Without
            // this, presence wrote no "where you are" line in a Private World (the first
            // walkthrough's prompt had the tone and the offers and nowhere to stand). No `enter`:
            // nothing here may start another activity.
            session: roomSession(() => gateNow().ok),
            behavior: live && live.behavior,
            destinations: () => [], // no travel out of a private room: leaving is the person's End
            emit,
            privateGate: () => gateNow().ok,
            lightsOffered: true, // the room's light presets are among its interactions
        });
        const waiters = new Set();
        function waitFor(chip, phases, ms) {
            return new Promise((resolve) => {
                const w = { chip, phases, resolve };
                waiters.add(w);
                setTimeout(() => {
                    if (waiters.delete(w)) resolve(null);
                }, ms);
            });
        }
        let core = null;
        const onAction = (e) => {
            const det = (e && e.detail) || {};
            for (const w of Array.from(waiters))
                if (w.chip === det.actionId && w.phases.includes(det.phase)) {
                    waiters.delete(w);
                    w.resolve(det.phase);
                }
            if (core) core.onRouterReport(det);
        };
        const onShown = (e) => {
            presence.onWorldShown(e && e.detail);
            const id = e && e.detail && e.detail.id;
            if (config && id && config.worlds.includes(id)) checkAvatar();
            if (core) core.gate();
        };
        /**
         * The person's latest turn, read from the conversation surface that took it. A Private
         * session keeps its turns in its own card, never in `window.chatHistory` (nothing of it is
         * persisted), so reading chatHistory alone meant the room never heard a Private turn: the
         * first real-model walkthrough asked for warmer light, nothing changed, and she said "a
         * warm glow just for us" anyway. Called first thing when Private's prompt is built, so the
         * request has run (or is in flight) before the room is described; a second call for the
         * same turn does nothing.
         */
        let lastSeen = null;
        function observeSurface() {
            if (!core) return null;
            let list = [];
            try {
                const S = g.NEXUS_CONVERSATION_SURFACE;
                const store = S && typeof S.history === 'function' ? S.history() : g.chatHistory;
                list = (store && typeof store.getHistory === 'function' && store.getHistory()) || [];
            } catch (_) {
                return null;
            }
            let latest = null;
            for (let i = list.length - 1; i >= 0; i--) {
                if (list[i] && list[i].role === 'user') {
                    latest = list[i];
                    break;
                }
            }
            if (!latest || latest === lastSeen) return null;
            lastSeen = latest;
            return core.observeUser(typeof latest.content === 'string' ? latest.content : '');
        }

        const proxy = {
            act: (id, opts) => (core ? core.act(id, opts) : Promise.resolve({ ok: false, why: 'not-ready' })),
            observeUser: (t) => (core ? core.observeUser(t) : null),
            observeSurface,
            consumeReply: (t) => (core ? core.consumeReply(t) : parseAct(t).clean),
            promptSuffix: (dst) => (core ? core.promptSuffix(dst) : ''),
            actOffer: (dst) => (core ? core.actOffer(dst) : ''),
            goOffer: (dst) => (core ? core.goOffer(dst) : ''),
            reset: (why) => core && core.reset(why),
            revoke: (why) => core && core.revoke(why),
            gate: () => gateNow(),
            state: () => (core ? core.state() : { open: false, revoked: 'not-ready' }),
            get config() {
                return config;
            },
        };

        Promise.all([
            Promise.resolve(Worlds.loadCatalogue ? Worlds.loadCatalogue() : null).catch(() => null),
            g.fetch
                ? g
                      .fetch('assets/vr-worlds/private/private-sanctuary.json')
                      .then((r) => (r && r.ok ? r.json() : null))
                      .catch(() => null)
                : null,
        ]).then(([cat, raw]) => {
            catalogue = (cat && cat.worlds) || [];
            const v = validateConfig(raw, {
                worlds: catalogue,
                preset: (id) => (Moods && Moods.get ? Moods.get(id) : null),
                template: (id) =>
                    Templates && Templates.TEMPLATES ? Templates.TEMPLATES.find((t) => t.id === id) : null,
            });
            if (!v.ok) {
                if (raw) console.warn('[PrivateWorld] experience config refused:', v.problems.join('; '));
                return;
            }
            config = v.config;
            core = create({
                gate: gateNow,
                presence,
                runtime,
                preset: (id) => (Moods && Moods.get ? Moods.get(id) : null),
                router: () => g.__NEXUS_PLAYGROUND_LIVE || null,
                behavior: live && live.behavior,
                gazePoint: (anchor) =>
                    live && live.picker && live.picker.gazePoint ? live.picker.gazePoint(anchor) : null,
                waitFor,
                config,
                emit,
            });
        });

        g.addEventListener && g.addEventListener('nexus-world-shown', onShown);
        g.addEventListener && g.addEventListener('nexus-playground-action', onAction);
        const offs = [];
        try {
            const bus = g.NEXUS_BD && g.NEXUS_BD.bus;
            if (bus && typeof bus.on === 'function')
                for (const name of ['private:session-stop', 'adult:exit'])
                    offs.push(bus.on(name, () => core && core.revoke(name)));
        } catch (_) {
            /* the gate check on every step still revokes */
        }
        const Reset = g.NEXUS_CONVERSATION_RESET;
        if (Reset && typeof Reset.onReset === 'function') offs.push(Reset.onReset(() => core && core.revoke('clear')));
        if (live && live.session && typeof live.session.on === 'function')
            offs.push(
                live.session.on(() => {
                    if (!live.session.active() && core) core.revoke('session-ended');
                })
            );

        return Object.assign(proxy, {
            detach() {
                g.removeEventListener && g.removeEventListener('nexus-world-shown', onShown);
                g.removeEventListener && g.removeEventListener('nexus-playground-action', onAction);
                for (const off of offs) if (typeof off === 'function') off();
                if (core) core.revoke('detach');
            },
        });
    }

    /**
     * The room's chunk for Private's own prompt (TogetherCapability's private suffix calls this,
     * only while a Private session is live). The paragraph is already sanitised; each tag offer is
     * accepted only in PromptContext's exact shape. '' whenever the gate is closed.
     */
    function promptChunk(g) {
        try {
            const live = g && g.__NEXUS_COMPANION_LIVE;
            const room = live && live.privateWorld;
            if (!room || typeof room.promptSuffix !== 'function') return '';
            // The person's request in this turn runs before the room is described.
            if (typeof room.observeSurface === 'function') room.observeSurface();
            const text = room.promptSuffix('life');
            if (!text) return '';
            const P = g.NEXUS_COMPANION_PROMPT;
            const parts = [text];
            const act = room.actOffer('life');
            if (act && P && P.ACT_OFFER && P.ACT_OFFER.test(act)) parts.push(act);
            const go = room.goOffer('life');
            if (go && P && P.GO_OFFER && P.GO_OFFER.test(go)) parts.push(go);
            return parts.join(' ');
        } catch (_) {
            return '';
        }
    }

    const api = {
        SCHEMA,
        KINDS,
        validateConfig,
        evaluateGate,
        actIntentOf,
        parseAct,
        roomSession,
        create,
        attach,
        promptChunk,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_WORLD = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
