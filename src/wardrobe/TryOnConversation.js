/**
 * W17. The haul, hosted: Try-On in the conversation, the way a try-on haul is filmed.
 *
 * Try-On used to happen beside the conversation. Looks changed in a panel, a canned line
 * flickered for six seconds, and the chat — the place this app keeps what happened between
 * the two of you — never heard about it. Ask her afterwards "which one did you like?" and
 * she had no idea there had been a haul.
 *
 * A try-on haul on YouTube has a shape everybody recognises, and it is the shape this file
 * gives the session:
 *
 *     open      "Okay, try-on haul time! I've got six looks to show you — want to start
 *                with the sundress?"
 *     reveal    per look: first impression → one concrete detail (the fabric, the cut, the
 *                colour) → a verdict: a rating out of ten, or "keep or return?" to you
 *     the spin  every few looks she turns to show the back (the activity's Turn)
 *     outro     the recap: her top picks, what she is keeping, a warm sign-off
 *
 * Each beat is *her* line — the model's, in her voice and with the conversation behind it —
 * not a script. The app tells the model what just happened in a short hidden instruction
 * (never stored, never shown); the line she answers with is drawn in the chat, kept in the
 * history the model reads next turn, saved like any reply, and spoken. That is how Private
 * and the playground already keep their scripted lines (`TogetherCapability._remember`), and
 * it is the same three calls the main reply path makes: render, add to history, persist.
 *
 * Rules, each a failure it prevents:
 *
 * - **Never over somebody.** A beat waits for an idle conversation (`ConversationSurface
 *   .turn()`) and is dropped, not queued, if the person is mid-message or she is mid-reply.
 *   A newer reveal replaces an older one still waiting: the haul has moved on.
 * - **Not after every tap.** A made look always gets a reveal; a saved look gets one unless
 *   the last beat was moments ago — tapping through five looks is browsing, not five
 *   segments.
 * - **CLEAR wins.** The epoch is captured before the model is asked and checked before
 *   anything is written (ConversationReset), so a line that outlives a CLEAR writes nothing.
 * - **Nothing executes.** Her beat lines are scrubbed of every directive (`<wardrobe>`,
 *   `<play>`, `<ambience>`) and none is run: a reveal that answered itself with a tag would
 *   start a loop.
 * - **Private stays off the record.** A look rated private, and any tattoo, gets no beat in
 *   the chat: the persistent conversation is the opposite of the quiet ending Private
 *   promises, so those reveals stay in Try-On's own ephemeral reaction.
 * - **No model, no host.** With no provider configured the haul works as before — the
 *   canned reactions in Try-On — and nothing is posted.
 *
 * Exposes: window.NEXUS_TRY_ON_CONVERSATION
 */
(function (global) {
    'use strict';

    var MIN_GAP_MS = 9000; // between beats for saved looks; a made look always gets one
    var SPIN_EVERY = 3; // the spin, every third reveal
    var MAX_LINE = 600;

    var STYLE =
        'Host it like a YouTube try-on haul: upbeat, natural, specific about the clothes. Two or three short ' +
        'sentences at most. Talk to the person directly. Do not describe your body. Do not write tags, lists or ' +
        'stage directions. Do not repeat an opener you have already used.';

    function clean(text, max) {
        return String(text == null ? '' : text)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max || MAX_LINE);
    }

    /** "black fitted crop top + blue straight jeans" → "black fitted crop top, blue straight jeans" */
    function details(look) {
        var recipe = (look && (look.prompt || (look.provenance && look.provenance.prompt))) || '';
        return clean(
            recipe
                .split(/\s*[+&]\s*/)
                .filter(Boolean)
                .join(', '),
            160
        );
    }

    /** Strip every directive a reply could carry. Nothing from a beat ever runs. */
    function scrubAll(text, g) {
        var out = String(text || '');
        var scrubbers = [
            g.NEXUS_WARDROBE_TOOL && g.NEXUS_WARDROBE_TOOL.scrub,
            g.NEXUS_PLAY_DIRECTIVE && g.NEXUS_PLAY_DIRECTIVE.scrub,
            g.NEXUS_SCENE_AMBIENCE_DIRECTIVE && g.NEXUS_SCENE_AMBIENCE_DIRECTIVE.scrub,
        ];
        scrubbers.forEach(function (fn) {
            if (typeof fn === 'function') {
                try {
                    out = fn(out);
                } catch (_) {
                    /* a scrubber that throws leaves the text as it was */
                }
            }
        });
        // Anything still shaped like markup, and a motion block, never reach the chat.
        return clean(out.replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]{0,200}>/g, ' '));
    }

    /** The hidden instructions, one per beat. Exposed for tests; never stored or shown. */
    var PROMPTS = {
        open: function (e) {
            var parts = [
                'TRY-ON HAUL (a note from the app, not from the person): the person just opened your try-on haul.',
                'Open it — welcome them and say what you are trying on today',
            ];
            parts.push(
                e.total
                    ? ' (you have ' +
                          e.total +
                          ' looks ready' +
                          (e.canCreate ? ', and can make anything new' : '') +
                          ')'
                    : ''
            );
            parts.push(
                '. Suggest where to start' +
                    (e.ideas && e.ideas.length ? ', e.g. ' + e.ideas.slice(0, 3).join(', ') : '') +
                    ', or ask them what you should try first.'
            );
            return parts.join('') + ' ' + STYLE;
        },
        reveal: function (e) {
            var what = '“' + e.name + '”';
            var how = e.generated
                ? e.change
                    ? ' — made just now, the same outfit with a new ' + e.change
                    : ' — made for you just now'
                : '';
            var where = e.total && e.position >= 0 ? ' (look ' + (e.position + 1) + ' of ' + e.total + ')' : '';
            var verdict =
                e.beat % 2 === 0
                    ? 'then give it a rating out of 10 and why'
                    : 'then ask the person whether you should keep it or return it';
            return (
                'TRY-ON HAUL (a note from the app, not from the person): you just changed into ' +
                what +
                how +
                where +
                '. ' +
                (e.details ? 'It is: ' + e.details + '. ' : '') +
                'Show it like a haul host: your first impression, one concrete detail about it, ' +
                verdict +
                '.' +
                (e.previous ? ' Your previous look was “' + e.previous + '” — compare if it helps.' : '') +
                ' ' +
                STYLE
            );
        },
        spin: function () {
            return (
                'TRY-ON HAUL (a note from the app): you are turning around to show the back of this look. ' +
                'Say one short line about the back. ' +
                STYLE
            );
        },
        outro: function (e) {
            var tried = e.tried.length ? 'You tried: ' + e.tried.join(', ') + '. ' : '';
            var favs = e.favorites.length ? 'Your favourites: ' + e.favorites.join(', ') + '. ' : '';
            var ending = e.kept ? 'You are keeping “' + e.kept + '”. ' : 'You went back to your own outfit. ';
            var quiet = e.privateCount ? 'Do not mention any other looks. ' : '';
            return (
                'TRY-ON HAUL (a note from the app, not from the person): the haul just ended. ' +
                tried +
                favs +
                ending +
                quiet +
                'Close it like a haul host: a quick recap of your top picks and a warm sign-off. ' +
                STYLE
            );
        },
    };

    class TryOnConversation {
        /**
         * options.surface   NEXUS_CONVERSATION_SURFACE (renderAssistant, history, turn)
         * options.ask       (instruction) → Promise<reply>; default: main.js's `callLLM`
         * options.say       (text) → speech; default NEXUS_BD_SAY
         * options.reset     NEXUS_CONVERSATION_RESET (currentEpoch, isCurrent)
         * options.now, options.minGapMs   injected for tests
         */
        constructor(options) {
            options = options || {};
            var g = options.global || global || {};
            this.g = g;
            this.surface = options.surface || g.NEXUS_CONVERSATION_SURFACE || null;
            this.ask =
                options.ask ||
                (typeof g.callLLM === 'function'
                    ? function (text) {
                          return g.callLLM(text);
                      }
                    : null);
            this.say = options.say || g.NEXUS_BD_SAY || null;
            this.reset = options.reset || g.NEXUS_CONVERSATION_RESET || null;
            this.now =
                options.now ||
                function () {
                    return Date.now();
                };
            this.minGapMs = options.minGapMs === undefined ? MIN_GAP_MS : options.minGapMs;
            this.lastBeatAt = -Infinity;
            this.reveals = 0;
            this.tried = []; // general looks, by name, in the order she first wore them
            this.privateCount = 0;
            this._inFlight = null;
            this._pending = null;
        }

        /** Whether there is a model to host with and a conversation to post into. */
        available() {
            return Boolean(this.ask && this.surface && typeof this.surface.renderAssistant === 'function');
        }

        _idle() {
            try {
                var turn = this.surface && typeof this.surface.turn === 'function' ? this.surface.turn() : null;
                return !turn || !turn.phase || turn.phase === 'idle';
            } catch (_) {
                return true;
            }
        }

        _epoch() {
            try {
                return this.reset && typeof this.reset.currentEpoch === 'function' ? this.reset.currentEpoch() : null;
            } catch (_) {
                return null;
            }
        }

        _current(epoch) {
            try {
                return !this.reset || typeof this.reset.isCurrent !== 'function' || this.reset.isCurrent(epoch);
            } catch (_) {
                return true;
            }
        }

        /**
         * Ask for a beat and post it. Resolves to the line, or null when nothing was posted.
         * A newer beat waiting replaces an older one; a beat never interrupts a turn.
         */
        _beat(kind, instruction, options) {
            options = options || {};
            if (!this.available()) return Promise.resolve(null);
            if (this._inFlight) {
                // One at a time. The newest waiting beat is the only one worth saying.
                var self = this;
                if (this._pending) this._pending.resolve(null);
                return new Promise(function (resolve) {
                    self._pending = { kind: kind, instruction: instruction, options: options, resolve: resolve };
                });
            }
            if (!options.force && !this._idle()) return Promise.resolve(null);
            this._inFlight = this._run(kind, instruction).finally(
                function () {
                    this._inFlight = null;
                    var next = this._pending;
                    this._pending = null;
                    if (next) this._beat(next.kind, next.instruction, next.options).then(next.resolve);
                }.bind(this)
            );
            return this._inFlight;
        }

        async _run(kind, instruction) {
            var epoch = this._epoch();
            var reply;
            try {
                reply = await this.ask(instruction);
            } catch (error) {
                console.warn('[Try-On] the host could not be asked', error);
                return null;
            }
            var text = reply && typeof reply === 'object' ? reply.text || reply.content || '' : reply;
            var line = scrubAll(text, this.g);
            if (!line) return null;
            if (!this._current(epoch)) return null; // CLEAR happened while she was answering
            if (!this._idle()) return null; // the person started talking: the moment has passed
            try {
                this.surface.renderAssistant(line);
                var store = typeof this.surface.history === 'function' ? this.surface.history() : null;
                if (store && typeof store.addMessage === 'function') store.addMessage('assistant', line);
                if (store && typeof store.persist === 'function') store.persist();
            } catch (error) {
                console.warn('[Try-On] the host line could not be posted', error);
                return null;
            }
            try {
                if (typeof this.say === 'function') this.say(line);
            } catch (_) {
                /* a line on screen is worth more than one in the air */
            }
            this.lastBeatAt = this.now();
            return line;
        }

        /** The haul opens. */
        open(event) {
            event = event || {};
            return this._beat('open', PROMPTS.open(event), { force: false });
        }

        /**
         * A look arrived. event: {look, previous, generated, change, position, total, private}
         * Resolves to {line, spin} — `spin` asks the activity to turn her (every third reveal).
         */
        async reveal(event) {
            event = event || {};
            var look = event.look;
            if (!look || look.original) return { line: null, spin: false };
            if (event.private) {
                this.privateCount += 1;
                return { line: null, spin: false };
            }
            var name = clean(look.name || 'this look', 80);
            if (this.tried.indexOf(name) === -1) this.tried.push(name);
            if (!event.generated && this.now() - this.lastBeatAt < this.minGapMs) return { line: null, spin: false };
            var beat = this.reveals;
            this.reveals += 1;
            var line = await this._beat(
                'reveal',
                PROMPTS.reveal({
                    name: name,
                    generated: Boolean(event.generated),
                    change: event.change || null,
                    position: typeof event.position === 'number' ? event.position : -1,
                    total: event.total || 0,
                    details: details(look),
                    previous: event.previous && !event.previous.original ? clean(event.previous.name, 80) : null,
                    beat: beat,
                })
            );
            return { line: line, spin: Boolean(line) && (beat + 1) % SPIN_EVERY === 0 };
        }

        /** She has turned to show the back: one short line about it. */
        spin() {
            return this._beat('spin', PROMPTS.spin());
        }

        /** The haul ended. event: {favorites: [names], kept: name | null} */
        outro(event) {
            event = event || {};
            if (!this.tried.length && !event.kept) return Promise.resolve(null);
            return this._beat(
                'outro',
                PROMPTS.outro({
                    tried: this.tried.slice(0, 12),
                    favorites: (event.favorites || []).slice(0, 6),
                    kept: event.kept || null,
                    privateCount: this.privateCount,
                })
            );
        }
    }

    var api = {
        TryOnConversation: TryOnConversation,
        PROMPTS: PROMPTS,
        STYLE: STYLE,
        MIN_GAP_MS: MIN_GAP_MS,
        SPIN_EVERY: SPIN_EVERY,
        details: details,
        scrubAll: scrubAll,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_CONVERSATION = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
