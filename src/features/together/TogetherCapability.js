/**
 * Telling her what she can actually do (batch T2) and owning the active Private prompt/runtime seam.
 *
 * The media paragraph is still empty when Together is off or nothing can search. Private adds
 * nothing unless a verified Private activity is actively running, so ordinary chat keeps the
 * same prompt byte-for-byte.
 *
 * Exposes: window.NEXUS_TOGETHER_CAPABILITY
 */
(function (global) {
    'use strict';

    const OPEN = '<play';
    const CLOSE = '</play>';
    const PRIVATE_RUNTIME_VERSION = 1;
    const PrivateViewApi =
        (global && global.NEXUS_PRIVATE_CONVERSATION_VIEW) ||
        (typeof module !== 'undefined' && module.exports ? require('./ui/PrivateConversationView.js') : null);

    function optional(path, globalName) {
        if (global && global[globalName]) return global[globalName];
        try {
            // eslint-disable-next-line global-require
            return typeof require === 'function' ? require(path) : null;
        } catch (_) {
            return null;
        }
    }

    /** Resolved per use as well, because boot order is not require order. */
    function beats() {
        return optional('./PrivateBeats.js', 'NEXUS_PRIVATE_BEATS');
    }
    function memory() {
        return optional('./PrivateMemory.js', 'NEXUS_PRIVATE_MEMORY');
    }

    const PRIVATE_PRESETS = Object.freeze({
        affectionate: Object.freeze({
            id: 'affectionate',
            label: 'Affectionate',
            maxLevel: 1,
            music: 'warm gentle evening instrumental ambient no lyrics',
            opening:
                'I thought we could keep this simple and warm for a few minutes. No pressure, no agenda — just a little time together.',
            playful: 'Then let us keep it light. I am happy just being here with you and letting the moment be easy.',
            tender: 'Then let us make it gentle. You do not have to perform or prove anything here. We can just enjoy the quiet together.',
            middle: 'I like the slower pace. It gives the room a chance to feel like a place instead of a backdrop.',
            closing: 'That was nice. We can leave it exactly here — warm, simple, and complete.',
        }),
        romantic: Object.freeze({
            id: 'romantic',
            label: 'Romantic',
            maxLevel: 2,
            music: 'soft romantic evening instrumental ambient no lyrics',
            opening:
                'This place feels a little different tonight. I thought we could make the next few minutes feel like a small date, without rushing anything.',
            playful:
                'Playful it is. I like the idea of making you smile and letting the evening stay a little mischievous without pushing it anywhere.',
            tender: 'Tender sounds good. Then I want to keep this soft, unhurried, and a little romantic — just enough to make the moment feel special.',
            middle: 'There is something nice about not needing the next moment to be bigger than this one.',
            closing: 'I liked this. We can leave it here, with a little warmth still hanging in the room.',
        }),
        sensual: Object.freeze({
            id: 'sensual',
            label: 'Sensual',
            maxLevel: 3,
            music: 'slow intimate lounge instrumental ambient no lyrics',
            opening:
                'We can make this quieter and a little more intimate, while keeping everything comfortable and completely in your control.',
            playful:
                'Then I will keep a little spark in it — confident, teasing in a gentle way, and still easy to slow down whenever you want.',
            tender: 'Then I will keep it close and calm: slower words, longer pauses, and no need to make the moment more intense than you want it to be.',
            middle: 'I like the quiet confidence of this pace. Nothing has to happen for the moment to feel close.',
            closing:
                'That is enough for tonight. I would rather end on a good feeling than stretch it past the point where it feels natural.',
        }),
    });

    function sw() {
        return global && global.NEXUS_TOGETHER_SWITCH ? global.NEXUS_TOGETHER_SWITCH : null;
    }

    function canSearch() {
        const registry = global && global.NEXUS_DISCOVERY ? global.NEXUS_DISCOVERY : null;
        if (registry && typeof registry.forCapability === 'function') {
            try {
                if (registry.forCapability('video.search') || registry.forCapability('music.search')) return true;
            } catch (_) {
                /* a registry that throws is a registry that cannot search */
            }
        }
        const samples = global && global.NEXUS_DISCOVERY_SAMPLES ? global.NEXUS_DISCOVERY_SAMPLES : null;
        return Boolean(samples && typeof samples.forCapability === 'function');
    }

    const INSTRUCTION = [
        '',
        'MEDIA YOU CAN PLAY',
        'You can search for and play music and video directly in this chat. When someone asks',
        'for something to watch or listen to — including indirectly, as in "I want to relax" or',
        '"I need to focus" — choose something and play it by writing, on its own line:',
        '  <play kind="music">search terms</play>',
        'Use kind="video" for something to watch. Say one short sentence about what you are',
        'putting on, and write the tag. Choose something yourself and play it: do not ask',
        'permission, do not ask what mood or genre they want, and do not propose ("how about',
        'some acoustic guitar?") — proposing is asking. If the request is vague, pick something',
        'that fits and play it; they will tell you if they wanted something else. Do not list',
        'options unless you were asked for options. Write at most one tag per reply.',
        '',
        'NEVER write a URL, a link, or a video ID yourself, and never name a specific track or',
        'video as though you had already found it. You have not searched — the app does that',
        'when it reads your tag, and it shows the real result it found. A link you write is a',
        'guess that looks like a fact, and it will be wrong.',
        '',
        'WHEN THEY ASK YOU TO FIND, SEARCH, LIST OR SHOW — do not play anything. They are',
        'asking to choose. Write, on its own line:',
        '  <find kind="music">search terms</find>',
        'and the app will show them the results to pick from. Say one short sentence before',
        'it, and do not name any titles yourself — you have not searched and do not know what',
        'will come back. They can then say "play the first one".',
        '',
        '',
        'LOOKING THINGS UP',
        'You can search the web. When they ask about something you cannot know from training —',
        "today's news, the weather, whether something has happened yet, anything recent or local —",
        'write, on its own line:',
        '  <lookup>search terms</lookup>',
        'and say one short sentence first, like "let me check". The results come back to you and',
        'you answer from them.',
        'Do NOT use it for things you already know, for opinions, or for anything about this',
        'conversation. Guessing at a fact you could have looked up is worse than the extra second,',
        'and looking up something you know wastes it.',
        '',
        'Earlier messages in this chat include cards the app itself posted, which name a real',
        'track and its link. Those are the app speaking, not you. Never copy or imitate their',
        'wording — writing one yourself produces a card that looks official and is invented.',
    ].join('\n');

    function cleanText(value, max) {
        return String(value == null ? '' : value)
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max || 500);
    }

    function privateContext() {
        const director = global && global.NEXUS_BD;
        const activity = director && director.intimate;
        const adult = director && director.adult;
        const blackboard = director && director.blackboard;
        if (!director || !activity || !adult || !blackboard) return null;
        if (!activity.active || !adult.active) return null;
        const gate = global && global.NEXUS_SPICY;
        const eligible =
            gate && typeof gate.usable === 'function'
                ? gate.usable() === true
                : blackboard.adultVerified === true && blackboard.nsfwAllowed === true;
        if (!eligible) return null;
        const preset = PRIVATE_PRESETS[activity.preset] || PRIVATE_PRESETS.affectionate;
        const level = Math.max(1, Math.min(preset.maxLevel, Number(adult.level) || 1));
        // The live session, when one is running. It is what knows which way the mood choice
        // went, and the model answering in chat has no other way to find out.
        const session = activity._privateExperience || null;
        const mood = session && ['playful', 'tender'].includes(session.mood) ? session.mood : null;
        return { director, activity, adult, blackboard, preset, level, mood };
    }

    function privateSystemPromptSuffix() {
        const ctx = privateContext();
        if (!ctx) return '';
        const { preset, level, mood } = ctx;
        const moodLine = mood
            ? [
                  mood === 'playful'
                      ? 'The user chose a playful mood for this session: keep a light, warm spark in your replies without pushing anywhere.'
                      : 'The user chose a tender mood for this session: keep your replies slow, soft and unhurried.',
              ]
            : [];
        return [
            '',
            'ACTIVE PRIVATE EXPERIENCE',
            `The user deliberately started the ${preset.label} Private experience. Current consent level: ${level}. Preset ceiling: ${preset.maxLevel}.`,
            ...moodLine,
            'Stay warm, relational and non-explicit. Never exceed the lower of the current consent level and preset ceiling.',
            'Do not infer consent from friendliness, silence, scenery, music or previous turns. Do not pressure the user to continue or escalate.',
            'Never use jealousy, secrecy, isolation, dependency, threats, coercion or intoxication as leverage. Never imply that the companion should replace real relationships.',
            'If the user says cozy, immediately soften to the lowest level without interrogation. If they say stop or exit, end Private immediately and return to ordinary conversation.',
            'Do not expose internal levels, gates or implementation details unless the user explicitly asks about the product.',
            '',
        ].join('\n');
    }

    function systemPromptSuffix() {
        const state = sw();
        if (!state || !state.isOn()) return '';
        const chunks = [];
        if (canSearch()) chunks.push(INSTRUCTION);
        const privateSuffix = privateSystemPromptSuffix();
        if (privateSuffix) chunks.push(privateSuffix.trim());
        return chunks.length ? `\n${chunks.join('\n\n')}\n` : '';
    }

    function currentSceneLabel(win) {
        const bb = win && win.NEXUS_BD && win.NEXUS_BD.blackboard;
        const scene = bb && bb.scene;
        if (scene && typeof scene === 'object')
            return cleanText(scene.label || scene.title || scene.id || 'this place', 120);
        if (scene) return cleanText(scene, 120).replace(/[-_]+/g, ' ');
        return 'this place';
    }

    class IntimateExperienceSession {
        constructor({ activity, preset, soundtrack, adult, director, win, bus, say, timingScale, now } = {}) {
            this.activity = activity || null;
            this.preset = PRIVATE_PRESETS[preset] || PRIVATE_PRESETS.affectionate;
            this.soundtrack = ['choose', 'current', 'none'].includes(soundtrack) ? soundtrack : 'choose';
            this.adult = adult || null;
            this.director = director || (global && global.NEXUS_BD) || null;
            this.win = win || global || null;
            this.doc = this.win && this.win.document ? this.win.document : null;
            this.bus = bus || (this.director && this.director.bus) || null;
            this.say = say || (this.win && this.win.NEXUS_BD_SAY) || null;
            const configuredScale = timingScale == null && this.win ? this.win.NEXUS_PRIVATE_TIMING_SCALE : timingScale;
            this.timingScale = configuredScale == null ? 1 : Math.max(0, Number(configuredScale) || 0);
            this.now = typeof now === 'function' ? now : () => Date.now();
            this.state = 'idle';
            this.startedAt = null;
            this.view = null;
            this._conversationBusyUntil = 0;
            this._timers = new Set();
            this._unsubscribes = [];
            this._ownsMedia = false;
            this._modeEntered = false;
            this._stopped = false;
            /**
             * The beats for this session. The written plan is in hand before anything is
             * spoken, so the opening never waits on a provider; a generated one replaces it
             * in `_planAhead` if and when it arrives and validates, which is in time for
             * every beat after the opening.
             */
            this.plan = null;
            /**
             * Which way the 45-second choice went. It used to be spoken and thrown away —
             * `middle` and `closing` were the same strings either way — so the one branch in
             * the experience had no consequence. Now it selects them, and it reaches the
             * prompt suffix so the model answering in chat is in the same mood she is.
             */
            this.mood = null;
            /** Turns the user has taken. The arc waits for a talker; see `_schedule`. */
            this._turns = 0;
            this._lastTurnAt = 0;
            const bb = this.director && this.director.blackboard;
            const modes = this.director && this.director.modes;
            this.snapshot = {
                activity: bb ? bb.activity : undefined,
                escalationLevel: bb ? bb.escalationLevel : undefined,
                modeId: modes ? modes.activeId : null,
            };
            const Focus = this.win && this.win.NEXUS_BD_PLAYGROUND && this.win.NEXUS_BD_PLAYGROUND.AudioFocusManager;
            this.audioFocus = Focus ? new Focus({ win: this.win, bus: this.bus }) : null;
        }

        start() {
            if (this.state !== 'idle') return { ok: false, why: 'Private experience already started' };
            if (!this.adult || !this.adult.active) return { ok: false, why: 'Private consent flow is not active' };
            const bb = this.director && this.director.blackboard;
            const modes = this.director && this.director.modes;
            if (bb) bb.activity = 'intimate';
            if (modes && typeof modes.activate === 'function' && modes.activeId !== 'adult') {
                this._modeEntered = modes.activate('adult') === true;
            }
            this.startedAt = this.now();
            this.state = 'active';
            this._mount();
            if (!this.view) {
                this.state = 'idle';
                return { ok: false, why: 'Open Conversation before beginning Private' };
            }
            this._listen();
            // The written plan first, so the opening is instant. Asking a provider for one
            // before saying anything would put a silent card in front of somebody who just
            // pressed "Begin private moment", which is the worst possible place for a wait.
            const api = beats();
            this.plan = api ? api.fallbackPlan(this.preset, { mood: this._rememberedMood() }) : null;
            this._planAhead();
            this._speak(`${this._line('opening')} ${currentSceneLabel(this.win)} feels like a good place for it.`);
            this._startSoundtrack();
            this._schedule(45000, () => this._showMoodChoice());
            this._schedule(120000, () => this._offerCheckIn());
            this._schedule(210000, () => this._speak(this._moodLine('middle')));
            this._schedule(285000, () => this._speak(this._moodLine('closing')));
            this._schedule(300000, () => this._complete());
            this._emit('private:session-start', {
                preset: this.preset.id,
                maxLevel: this.preset.maxLevel,
                scene: currentSceneLabel(this.win),
                returning: !this._isFirstSession(),
            });
            return { ok: true, why: 'active', preset: this.preset.id };
        }

        beforeActivityStop(why) {
            if (this._stopped) return;
            this._stopped = true;
            this.state = 'restoring';
            this._clearTimers();
            this._stopSoundtrack();
            if (this.audioFocus && typeof this.audioFocus.restore === 'function') this.audioFocus.restore();
            const modes = this.director && this.director.modes;
            if (this._modeEntered && modes && modes.activeId === 'adult' && typeof modes.deactivate === 'function') {
                modes.deactivate();
            }
            this._emit('private:session-ending', { preset: this.preset.id, why: why || 'user' });
        }

        afterActivityStop(why) {
            const modes = this.director && this.director.modes;
            if (
                modes &&
                this.snapshot.modeId &&
                this.snapshot.modeId !== 'companion' &&
                modes.activeId === 'companion' &&
                typeof modes.deactivate === 'function'
            ) {
                modes.deactivate();
            }
            const bb = this.director && this.director.blackboard;
            if (bb) {
                bb.activity = this.snapshot.activity;
                bb.escalationLevel = this.snapshot.escalationLevel;
            }
            for (const stop of this._unsubscribes.splice(0)) {
                try {
                    stop();
                } catch (_) {}
            }
            this._unmount();
            this.state = 'complete';
            this._emit('private:session-stop', { preset: this.preset.id, why: why || 'user' });
        }

        statusDetail() {
            if (this.state === 'checkin-pending') return 'Your choice';
            if (this.state === 'complete') return 'Complete';
            if (this.state === 'restoring') return 'Restoring';
            return 'Private';
        }

        _listen() {
            if (!this.bus || typeof this.bus.on !== 'function') return;
            this._unsubscribes.push(
                this.bus.on('adult:level', () => this._paintLevel()),
                this.bus.on('adult:exit', (event) => {
                    if (event && event.kind === 'soft') {
                        this._paintLevel();
                        this._showMessage('Keeping it cozy. We can stay right here.', []);
                    }
                })
            );
        }

        _schedule(ms, fn) {
            if (!this.win || typeof this.win.setTimeout !== 'function') return null;
            const delay = Math.max(0, Number(ms) || 0) * this.timingScale;
            const id = this.win.setTimeout(() => {
                this._timers.delete(id);
                if (this.now() < this._conversationBusyUntil) {
                    this._schedule(1000, fn);
                } else if (!this._stopped && this.state !== 'complete') fn();
            }, delay);
            this._timers.add(id);
            return id;
        }

        /**
         * Ask for a written plan for this session, and quietly upgrade to a generated one.
         *
         * Deliberately not awaited by `start()`. The written plan is already good — it draws
         * from pools sized for twenty-four playthroughs per preset — so the model is an
         * improvement on a working floor rather than a dependency. If it lands, it lands
         * before the 45-second beat and every beat after the opening comes from it; if it
         * never lands, nobody can tell.
         */
        _planAhead() {
            const api = beats();
            if (!api || typeof api.plan !== 'function') return null;
            let promise = null;
            try {
                promise = api.plan({
                    preset: this.preset,
                    scene: currentSceneLabel(this.win),
                    win: this.win,
                    mood: this.mood,
                });
            } catch (_) {
                return null;
            }
            if (!promise || typeof promise.then !== 'function') return null;
            return promise
                .then((plan) => {
                    // A session that ended while the provider was thinking must not have its
                    // script swapped underneath a completion card.
                    if (!plan || this._stopped || this.state === 'complete') return null;
                    this.plan = plan;
                    this._emit('private:plan-ready', { preset: this.preset.id, source: plan.source });
                    return plan;
                })
                .catch(() => null);
        }

        _rememberedMood() {
            const store = memory();
            try {
                const kept = store && typeof store.read === 'function' ? store.read() : null;
                return (kept && kept.mood) || null;
            } catch (_) {
                return null;
            }
        }

        _isFirstSession() {
            const store = memory();
            try {
                return !store || typeof store.isFirstSession !== 'function' || store.isFirstSession();
            } catch (_) {
                return true;
            }
        }

        /** One plan field, falling back to the preset's original string for that beat. */
        _line(field) {
            const fromPlan = this.plan && typeof this.plan[field] === 'string' ? this.plan[field] : '';
            return fromPlan || this.preset[field] || '';
        }

        /**
         * A beat that depends on the mood.
         *
         * Before a mood is chosen there is no wrong answer, so the plan's tender variant
         * stands in — it is the gentler of the two, and defaulting to the gentler one is the
         * same instinct as starting at level 1.
         */
        _moodLine(field) {
            const section = this.plan && this.plan[field];
            if (section && typeof section === 'object') {
                const chosen = section[this.mood] || section.tender || section.playful;
                if (chosen) return chosen;
            }
            return this.preset[field] || '';
        }

        _clearTimers() {
            if (!this.win || typeof this.win.clearTimeout !== 'function') return;
            for (const id of this._timers) this.win.clearTimeout(id);
            this._timers.clear();
        }

        _mount() {
            if (!this.doc || !PrivateViewApi || !PrivateViewApi.View) return;
            const view = new PrivateViewApi.View({
                doc: this.doc,
                win: this.win,
                onCozy: () => {
                    if (this.adult && typeof this.adult.exit === 'function') this.adult.exit('soft');
                },
                onEnd: () => this._requestEnd(false),
                onUserMessage: () => this._yieldToConversation(),
            });
            if (!view.mount({ preset: this.preset, scene: currentSceneLabel(this.win) })) return;
            this.view = view;
            view.showStarting();
            this._paintLevel();
        }

        _paintLevel() {
            const level = Math.max(1, Math.min(this.preset.maxLevel, Number(this.adult && this.adult.level) || 1));
            const words = level === 1 ? 'Warm' : level === 2 ? 'Romantic' : 'Sensual';
            if (this.view) this.view.setPace(words);
        }

        _showMessage(text, actions) {
            if (this.view) this.view.showMessage(text, actions);
        }

        /**
         * The one branch in the session, now with something downstream of it.
         *
         * `this.mood` is read by `_moodLine` for the 210 s and 285 s beats and by
         * `privateSystemPromptSuffix`, so choosing Playful changes the rest of the evening in
         * both channels instead of buying one sentence.
         */
        _showMoodChoice() {
            if (this.state !== 'active') return;
            const choose = (mood) => {
                this.mood = mood;
                this._speak(this.plan && this.plan.moods ? this.plan.moods[mood] : this.preset[mood]);
                this._emit('private:mood', { preset: this.preset.id, mood });
            };
            const options = [
                { id: 'playful', label: 'Playful', run: () => choose('playful') },
                { id: 'tender', label: 'Tender', run: () => choose('tender') },
            ];
            if (this.view) this.view.showMoodChoice(options, this._line('moodPrompt'));
        }

        /**
         * A preset already at its ceiling gets a choice about texture, not an apology.
         *
         * `Affectionate` has `maxLevel: 1`, so this branch was its 120-second beat: a single
         * line saying that nothing further was going to happen, with no buttons. The gentlest
         * preset is the one most people try first, so the emptiest run in the feature was also
         * its first impression. Quieter-or-closer is a real choice that changes how she talks
         * without touching the ceiling, which is the whole point — it is texture, not
         * escalation, and it needs no consent step because it grants nothing.
         */
        _offerTextureChoice() {
            const texture = (this.plan && this.plan.texture) || null;
            if (!texture || !texture.prompt) {
                this._showMessage('This pace feels good. We can keep it right here.', []);
                return;
            }
            const choose = (id) => {
                this.texture = id;
                this._speak(texture[id]);
                this._emit('private:texture', { preset: this.preset.id, texture: id });
            };
            this._showMessage(texture.prompt, [
                { id: 'quieter', label: 'Quieter', run: () => choose('quieter') },
                { id: 'closer', label: 'Closer', run: () => choose('closer') },
            ]);
        }

        _offerCheckIn() {
            if (this.state === 'complete' || this._stopped || !this.adult) return;
            const level = Number(this.adult.level) || 1;
            if (level >= this.preset.maxLevel) {
                this._offerTextureChoice();
                return;
            }
            if (typeof this.adult.earned === 'function' && !this.adult.earned()) {
                this._schedule(1000, () => this._offerCheckIn());
                return;
            }
            this.state = 'checkin-pending';
            const nextLabel = level + 1 >= 3 ? 'A little more sensual' : 'A little more flirty';
            const options = [
                {
                    id: 'keep-sweet',
                    label: 'Keep it sweet',
                    run: () => {
                        if (level > 1 && typeof this.adult.exit === 'function') this.adult.exit('soft');
                        this.state = 'active';
                        this._showMessage('Sweet and easy it is.', []);
                    },
                },
                {
                    id: 'advance',
                    label: nextLabel,
                    run: () => this._acceptCheckIn(),
                },
            ];
            if (this.view) this.view.showConsentCheckIn(options);
        }

        _acceptCheckIn() {
            if (!this.adult || this.state !== 'checkin-pending') return false;
            const asked = typeof this.adult.checkIn === 'function' ? this.adult.checkIn() : { ok: false };
            if (!asked || asked.ok === false) {
                this.state = 'active';
                this._showMessage('We can keep the current pace.', []);
                return false;
            }
            const answer = typeof this.adult.hear === 'function' ? this.adult.hear('yes') : null;
            this.state = 'active';
            this._paintLevel();
            if (answer && answer.action === 'advanced') {
                const level = Number(this.adult.level) || 1;
                // Advancing used to repaint one word in the footer. Saying yes to a consent
                // question deserves an answer in her voice, and — since `proactiveNsfw: false`
                // means she may never initiate a motion the user did not ask for — words are
                // the honest place for an escalation to land.
                const lines = (this.plan && this.plan.levelLines) || null;
                const spoken = lines && (lines[level] || lines[String(level)]);
                if (spoken) this._speak(spoken);
                else this._showMessage('Okay. A little closer, still at your pace.', []);
                if (level < this.preset.maxLevel) {
                    const floor = Math.max(1000, Number(this.adult.perLevelMinMs) || 120000);
                    this._schedule(floor, () => this._offerCheckIn());
                }
                return true;
            }
            this._showMessage('We will keep the current pace.', []);
            return false;
        }

        async _startSoundtrack() {
            if (!this.win || this._stopped) return false;
            if (this.soundtrack === 'none' || this.soundtrack === 'current') return false;
            const media = this.win.NEXUS_MEDIA_SESSION;
            try {
                const existing = media && typeof media.get === 'function' ? media.get() : null;
                if (existing && ['playing', 'loading', 'paused'].includes(existing.status) && existing.current)
                    return false;
            } catch (_) {}
            const registry = this.win.NEXUS_DISCOVERY;
            if (!registry || typeof registry.forCapability !== 'function') return false;
            try {
                if (typeof registry.warm === 'function') await registry.warm();
                const provider = registry.forCapability('music.search');
                if (!provider || typeof provider.search !== 'function') return false;
                const found = await provider.search(this.preset.music, { max: 3, kind: 'music' });
                if (this._stopped || !Array.isArray(found) || !found.length) return false;
                const track = found[0];
                if (media && typeof media.requestPlay === 'function') media.requestPlay(track, { source: 'private' });
                if (this.view) this.view.attachSoundtrack(track);
                this._ownsMedia = true;
                return true;
            } catch (_) {
                return false;
            }
        }

        _stopSoundtrack() {
            if (!this._ownsMedia || !this.win) return;
            try {
                const media = this.win.NEXUS_MEDIA_SESSION;
                if (media && typeof media.stop === 'function') media.stop('private');
            } catch (_) {}
            this._ownsMedia = false;
        }

        /**
         * Put a line where the model can see it.
         *
         * `NEXUS_BD_SAY` is `(text) => speakText(text)` in `src/main.js` — text-to-speech and
         * nothing else. So every scripted Private line was spoken aloud and drawn in the card
         * while never entering `chatHistory`, which is the transcript the model reads. She
         * said four things the model answering the user had no record of, and could therefore
         * contradict in the very next chat bubble. Two channels in one card, neither aware of
         * the other.
         *
         * `chatHistory.addMessage` rather than `NEXUS_YT_ASK.say`, because `say` also *draws*
         * a chat bubble and the Private card is already the display. This records without
         * rendering, which is exactly the half that was missing.
         *
         * Nothing extra is persisted by doing this: the user's own messages and her chat
         * replies during a Private session already go into this transcript, because the
         * composer is observed rather than intercepted. This makes the record complete rather
         * than making it larger, and the completion card's promise — nothing is written to
         * Playground Histories — is untouched.
         */
        _remember(text) {
            const w = this.win;
            if (!w) return false;
            try {
                const cm = w.ChatManager;
                if (cm && typeof cm.addMessage === 'function') return false;
                const history = w.chatHistory;
                if (!history || typeof history.addMessage !== 'function') return false;
                history.addMessage('assistant', String(text || ''));
                return true;
            } catch (_) {
                // A line on screen and in the air is worth more than a tidy transcript.
                return false;
            }
        }

        _speak(text) {
            const line = cleanText(text, 700);
            if (!line) return;
            this._showMessage(line, []);
            this._remember(line);
            if (this.audioFocus && typeof this.audioFocus.duck === 'function') this.audioFocus.duck();
            try {
                if (typeof this.say === 'function') {
                    const result = this.say(line);
                    if (result && typeof result.then === 'function') {
                        result.finally(() => {
                            if (this.audioFocus && typeof this.audioFocus.restore === 'function')
                                this.audioFocus.restore();
                        });
                        return;
                    }
                }
            } catch (_) {}
            if (this.audioFocus && typeof this.audioFocus.restore === 'function') this.audioFocus.restore();
        }

        _yieldToConversation() {
            this._turns += 1;
            this._lastTurnAt = this.now();
            this._conversationBusyUntil = this.now() + 8000;
            try {
                if (this.win && this.win.speechSynthesis && typeof this.win.speechSynthesis.cancel === 'function')
                    this.win.speechSynthesis.cancel();
            } catch (_) {}
            if (this.audioFocus && typeof this.audioFocus.restore === 'function') this.audioFocus.restore();
            this._emit('private:user-turn', { preset: this.preset.id });
        }

        /** How far past the scripted 300 s a live conversation may push the ending. */
        static get GRACE_MS() {
            return 180000;
        }

        _complete() {
            if (this._stopped) return;
            // The arc was five wall-clock minutes regardless of whether the user had written
            // twenty messages or none, so somebody mid-sentence got the closing line and the
            // completion card on a timer that had never heard them. `_conversationBusyUntil`
            // already defers a *line* for a talker; an ending deserves at least as much.
            // Bounded, because "it never ends while you keep typing" is a different and worse
            // product than "it does not hang up on you".
            const elapsed = this.now() - (this.startedAt || 0);
            const talking = this.now() - this._lastTurnAt < 30000 * (this.timingScale || 1);
            if (talking && elapsed < (300000 + IntimateExperienceSession.GRACE_MS) * (this.timingScale || 1)) {
                this._schedule(20000, () => this._complete());
                return;
            }
            this.state = 'complete';
            this._clearTimers();
            // Only on a completed session, and only the four enums — never a word of what was
            // said. See `PrivateMemory`.
            const store = memory();
            try {
                if (store && typeof store.remember === 'function') {
                    store.remember({
                        preset: this.preset.id,
                        mood: this.mood,
                        soundtrack: this.soundtrack,
                    });
                }
            } catch (_) {
                // Not being remembered is exactly how every session behaved before.
            }
            if (this.view) {
                this.view.showComplete({
                    onAgain: () => this._requestEnd(true),
                    onBack: () => this._requestEnd(true),
                });
            }
            this._emit('private:session-complete', { preset: this.preset.id, mood: this.mood, turns: this._turns });
        }

        _requestEnd(openTogether) {
            const panel = this.director && this.director.togetherPanel;
            if (
                panel &&
                (panel.active === 'intimate' || panel.activeActivity === 'intimate') &&
                typeof panel.stopActivity === 'function'
            ) {
                panel.stopActivity('private complete');
                if (openTogether && typeof panel.open === 'function') panel.open();
                return;
            }
            if (this.activity && typeof this.activity.stop === 'function') this.activity.stop('private complete');
        }

        _unmount() {
            if (this.view) this.view.destroy();
            this.view = null;
        }

        _emit(name, payload) {
            if (this.bus && typeof this.bus.emit === 'function') this.bus.emit(name, payload);
        }
    }

    function installPrivateRuntime(playgroundApi) {
        const api = playgroundApi || (global && global.NEXUS_BD_PLAYGROUND);
        const Intimate = api && api.IntimateActivity && api.IntimateActivity.Intimate;
        if (!Intimate || !Intimate.prototype) return false;
        const proto = Intimate.prototype;
        if (proto.__privateExperienceInstalled) return true;

        const originalStart = proto.start;
        const originalStop = proto.stop;
        const originalStatus = proto.status;
        if (typeof originalStart !== 'function' || typeof originalStop !== 'function') return false;

        proto.start = async function (context) {
            const input = (context && context.input) || {};
            const presetId = String(input.id || 'affectionate');
            const director = global && global.NEXUS_BD;
            const session = new IntimateExperienceSession({
                activity: this,
                preset: presetId,
                soundtrack: input.soundtrack,
                adult: this.adult || (director && director.adult),
                director,
                win: global,
                bus: this.bus || (director && director.bus),
            });
            const result = await originalStart.call(this, context || {});
            if (!result || result.ok === false) return result;
            const started = session.start();
            if (!started || started.ok === false) {
                originalStop.call(this, 'private runtime failed');
                return started || { ok: false, why: 'Private experience could not start' };
            }
            this._privateExperience = session;
            return { ...result, experience: 'private-evening', runtimeVersion: PRIVATE_RUNTIME_VERSION };
        };

        proto.stop = function (why) {
            const session = this._privateExperience || null;
            if (session) session.beforeActivityStop(why || 'user');
            const result = originalStop.call(this, why || 'user');
            if (session) {
                session.afterActivityStop(why || 'user');
                this._privateExperience = null;
            }
            return result;
        };

        proto.status = function () {
            const base = typeof originalStatus === 'function' ? originalStatus.call(this) : null;
            if (!base) return null;
            const session = this._privateExperience;
            return session ? { ...base, detail: session.statusDetail() } : base;
        };

        Object.defineProperty(proto, '__privateExperienceInstalled', { configurable: true, value: true });
        return true;
    }

    function schedulePrivateRuntimeInstall() {
        if (!global || !global.document || !global.document.currentScript || typeof global.setTimeout !== 'function')
            return;
        let attempts = 0;
        const tryInstall = () => {
            if (installPrivateRuntime()) return;
            attempts += 1;
            if (attempts < 100) global.setTimeout(tryInstall, 50);
        };
        global.setTimeout(tryInstall, 0);
    }

    const api = {
        OPEN,
        CLOSE,
        INSTRUCTION,
        PRIVATE_PRESETS,
        PRIVATE_RUNTIME_VERSION,
        IntimateExperienceSession,
        canSearch,
        privateSystemPromptSuffix,
        installPrivateRuntime,
        systemPromptSuffix,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TOGETHER_CAPABILITY = api;
    schedulePrivateRuntimeInstall();
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
