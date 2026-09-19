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

    /**
     * How long the thinking dots stay up before giving in.
     *
     * A reply normally lands in the transcript and the view hides them itself. This is for the
     * reply that never comes — a provider timing out, the 504-and-retry loop in the reported
     * session — where dots spinning forever would be its own kind of lie.
     */
    const THINKING_TIMEOUT_MS = 90000;

    /**
     * How long after her last word a scheduled beat may land (P8).
     *
     * The eligibility rule is "the conversation is not mid-turn", and mid-turn is now known
     * exactly — `ConversationSurface` reports the phase. This is the small extra courtesy on
     * top: a scripted line arriving in the same instant her reply settles reads as two people
     * talking at once, or worse, as her saying two unrelated things.
     *
     * Deliberately much shorter than the 15–25 s idle window a *new* guided beat should want.
     * That window belongs to deciding whether guidance is wanted at all, which is a separate
     * job; this is only about not colliding with the sentence that just finished.
     */
    const BREATHING_ROOM_MS = 4000;
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
    function turnDirector() {
        return optional('./PrivateTurnDirector.js', 'NEXUS_PRIVATE_TURN_DIRECTOR');
    }
    function surfaceApi(win) {
        const scope = win || global;
        return (scope && scope.NEXUS_CONVERSATION_SURFACE) || null;
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

    /**
     * How long, and in what register, this particular reply should be (P9/P15).
     *
     * The budget is enforced by `max_tokens`, which truncates — so a model that writes two
     * hundred words gets a sentence cut in half rather than a short answer. Telling it the
     * length is the other half, and it is the half that makes the reply *finish*.
     *
     * The question rule is here because the default behaviour of every assistant is to end on
     * one, and a companion who answers every remark with a question is conducting an interview.
     * Silence is a legitimate reply to "this is nice"; so is agreeing and stopping.
     */
    function privateLengthLines(turn, style) {
        const lines = [];
        const words = turn && turn.words ? Number(turn.words) : 0;
        if (words > 0 && words <= 3) {
            lines.push(
                'They said very little. Answer in one short sentence, or a few words. Do not expand a two-word remark into a paragraph.'
            );
        } else if (words > 0 && words <= 12) {
            lines.push('Keep this reply to one or two sentences. Match their length rather than exceeding it.');
        } else {
            lines.push('Keep replies short — three sentences at most unless they asked for something longer.');
        }
        lines.push(
            'Do not end every reply with a question. Ask one only when you genuinely want an answer; otherwise say your thing and let the silence be comfortable.'
        );
        if (style === 'quiet') {
            lines.push(
                'They asked for fewer words. Be present rather than talkative: very short replies, long pauses, no new topics.'
            );
        } else if (style === 'conversational') {
            lines.push('They are talking with you rather than being led. Follow what they raise; do not steer.');
        }
        return lines;
    }

    function privateSystemPromptSuffix() {
        const ctx = privateContext();
        if (!ctx) return '';
        const { preset, level, mood } = ctx;
        const session = ctx.activity && ctx.activity._privateExperience;
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
            ...privateLengthLines(session && session._turn, session && session.style),
            'Stay warm, relational and non-explicit. Never exceed the lower of the current consent level and preset ceiling.',
            'Do not infer consent from friendliness, silence, scenery, music or previous turns. Do not pressure the user to continue or escalate.',
            'Never use jealousy, secrecy, isolation, dependency, threats, coercion or intoxication as leverage. Never imply that the companion should replace real relationships.',
            'If the user says cozy, immediately soften to the lowest level without interrogation. If they say stop or exit, end Private immediately and return to ordinary conversation.',
            'Do not expose internal levels, gates or implementation details unless the user explicitly asks about the product.',
            '',
        ].join('\n');
    }

    /**
     * How long her next answer is worth, or null when Private is not running (P9).
     *
     * `LLMManager` consults this where it builds each request body, the way the request path
     * already consults `systemPromptSuffix()`. Null for every request outside a Private session,
     * so ordinary chat asks for exactly the ceiling it always asked for.
     *
     * The number comes from the turn `PrivateTurnDirector` classified, not from the preset: the
     * budget is a reply to what somebody said, and `Mm` and a three-sentence question do not
     * deserve the same one. Eight hundred tokens for `So` is a hundred and fifty words nobody
     * wanted and several seconds of waiting for them, which is most of why Private read as slow.
     */
    function responseBudget() {
        const ctx = privateContext();
        const session = ctx && ctx.activity && ctx.activity._privateExperience;
        if (!session || session.state === 'complete' || session._stopped) return null;
        const td = turnDirector();
        if (!td || typeof td.budgetFor !== 'function') return null;
        try {
            const wanted = td.budgetFor(session._turn || null);
            return Number.isFinite(wanted) && wanted > 0 ? wanted : null;
        } catch (_) {
            return null;
        }
    }

    /**
     * The Private instructions, for a request that cannot carry a system prompt (P9).
     *
     * `_chatOllaBridge` does not send one at all for a remote persona — the gateway supplies the
     * persona's own, and overwriting it is the whole reason for the `if (!isRemotePersona)`. But
     * that also drops everything the app appends, and the app appends the *safety* half of
     * Private: the consent level, the ceiling, "do not infer consent from friendliness", "if
     * they say stop, end immediately". Silently. So a remote persona ran a Private session with
     * none of its rules, which is a correctness hole rather than a missing feature.
     *
     * An overlay, deliberately, not a replacement: this is an additional message that sits
     * alongside whatever the gateway prepends, and it is empty whenever Private is not running,
     * so ordinary remote-persona chat sends byte-for-byte what it sent before.
     */
    function experienceOverlay() {
        return privateSystemPromptSuffix().trim();
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
        constructor({
            activity,
            preset,
            soundtrack,
            plan,
            track,
            scene,
            adult,
            director,
            win,
            bus,
            say,
            timingScale,
            now,
        } = {}) {
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
            this.plan = plan || null;
            /** A track the prepare step already found, so the session plays rather than searches. */
            this.track = track || null;
            /** The ambience scene this evening asked for, and what was showing before it. */
            this.scene = scene || null;
            this._sceneBefore = null;
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
            /**
             * The last turn the person took, as `PrivateTurnDirector` read it (P8).
             *
             * Classified locally, so the experience can react before a single token comes back:
             * a pace request eases off at 50 ms rather than at whatever the provider costs, and
             * a question suppresses the next scheduled line immediately rather than being
             * talked over by it.
             */
            this._turn = null;
            /**
             * When the composer last saw a keystroke — which is not a turn.
             *
             * Kept separately from `_lastTurnAt` because the two answer different questions.
             * Taking the floor from a scheduled beat needs a turn that actually exists, or an
             * empty input somebody pressed Enter on would mute the session. Deciding whether to
             * *hang up* does not: a person still typing at the 300-second mark has not sent
             * anything yet and ending on them would be the worst possible reading of the clock.
             */
            this._composingAt = 0;
            /**
             * She was asked something and has not answered yet.
             *
             * Its own flag rather than a re-read of `_turn`, because it is cleared by the reply
             * landing — and what clears it is an event from the conversation surface, not
             * anything this session can see in the text.
             */
            this._pendingQuestion = false;
            /** How she should be talking, as the conversation has suggested. P15 acts on it. */
            this.style = null;
            /** Torn off the conversation surface in `_listen`, put back in `afterActivityStop`. */
            this._unwatchTurns = null;
            /** Beats as wall-clock offsets rather than live timers. See `_beat`. */
            this._beats = [];
            this._unwatchVisibility = null;
            /** The safety valve on the thinking dots. See `_yieldToConversation`. */
            this._thinkingTimer = null;
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
            // A prepared plan is the normal path now: the setup screen did the waiting, with
            // named steps, before anybody pressed Begin. The written-fallback-then-upgrade
            // dance below is what happens when a session is started without one — a test, or
            // a caller that skipped the prepare step.
            if (!this.plan) {
                const api = beats();
                this.plan = api ? api.fallbackPlan(this.preset, { mood: this._rememberedMood() }) : null;
                this._planAhead();
            }
            this._enterScene();
            // The scene sentence only when there is actually a scene. With no ambience chosen
            // `currentSceneLabel` returns the literal words "this place", and the opening then
            // ended "…this place feels like a good place for it", which is what a placeholder
            // sounds like when it reaches production.
            const place = currentSceneLabel(this.win);
            const named = place && place !== 'this place';
            this._speak(
                named ? `${this._line('opening')} ${place} feels like a good place for it.` : this._line('opening')
            );
            this._startSoundtrack();
            this._beat(45000, () => this._showMoodChoice());
            this._beat(120000, () => this._offerCheckIn());
            this._beat(210000, () => this._speak(this._moodLine('middle')));
            this._beat(285000, () => this._speak(this._moodLine('closing')));
            this._beat(300000, () => this._complete());
            this._armBeats();
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
            this._restoreScene();
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
            if (this._unwatchTurns) {
                try {
                    this._unwatchTurns();
                } catch (_) {}
                this._unwatchTurns = null;
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

        /**
         * Hear the conversation itself, not a guess about it (P8).
         *
         * Every turn in the application passes through `ConversationSurface`, so this is where
         * the session finds out that somebody typed something — with the text, at the moment
         * they sent it — and that her reply has actually finished. Before this the session
         * learned about a turn from a `keydown` on the composer and then assumed eight seconds.
         *
         * Separate from the bus subscriptions below because it is a different kind of fact: the
         * bus carries consent events, this carries whose turn it is.
         */
        _watchConversation() {
            const api = surfaceApi(this.win);
            if (!api || typeof api.observe !== 'function') return false;
            this._unwatchTurns = api.observe((event) => {
                if (!event || this._stopped) return;
                if (event.type === 'user') this._onUserTurn(event.text);
                else if (event.type === 'assistant-end') this._onAssistantFinished(true);
                else if (event.type === 'assistant-discarded') this._onAssistantFinished(false);
            });
            return true;
        }

        /**
         * A turn the person took, read locally before the provider is asked anything.
         *
         * The two safety intents act here rather than waiting for the model, and that is the
         * point of classifying locally at all: `ConsentFlow` already guarantees that easing off
         * and leaving happen "within one scheduler tick", and a person who types "slow down"
         * rather than saying it out loud deserves the same guarantee. Until now they did not
         * get it — `ConsentFlow.hear` is subscribed to `voice:final` only, so **typed** safe
         * words reached nothing at all and were answered, eventually, by whatever the model
         * made of them.
         */
        _onUserTurn(text) {
            const at = this.now();
            this._turns += 1;
            this._lastTurnAt = at;
            const td = turnDirector();
            const turn = td && typeof td.classify === 'function' ? td.classify(text) : null;
            this._turn = turn;
            this._pendingQuestion = Boolean(turn && turn.holdsTheFloor);
            const suggested = turn && td && typeof td.styleFor === 'function' ? td.styleFor(turn.intent) : null;
            if (suggested) this.style = suggested;
            this._userIsTalking();
            this._emit('private:user-turn', { preset: this.preset.id, intent: turn ? turn.intent : null });
            if (!turn) return null;
            if (turn.intent === 'end') {
                // Not `adult.exit('hard')`: stopping the activity runs the whole teardown —
                // soundtrack handed back, scene restored, mode left, blackboard put back — and
                // a bare hard exit would leave a mounted card in a session nobody is in.
                this._requestEnd(false);
                return turn;
            }
            if (turn.intent === 'pace-down' && this.adult && typeof this.adult.exit === 'function') {
                // The `adult:exit` handler below says the true thing about what changed, so the
                // acknowledgement is already written and already correct at level 1.
                this.adult.exit('soft');
            }
            return turn;
        }

        /**
         * Her reply landed, or was abandoned. Either way the floor is free.
         *
         * The dots come down here as well as in the view's own observer: this fires on the
         * reply *finishing*, which is the honest signal, where the view is watching the chat
         * container for a mutation that a Private-drawn reply no longer produces.
         *
         * `answered` is false for a turn that was thrown away — the user pressed CLEAR, the
         * stream died. A question asked into that is still owed an answer, so it stays pending
         * and `_beatIsEligible` keeps the script quiet for a while rather than changing the
         * subject in the second after her reply vanished.
         */
        _onAssistantFinished(answered = true) {
            if (answered) this._pendingQuestion = false;
            if (this.view && typeof this.view.hideThinking === 'function') this.view.hideThinking();
            if (this._thinkingTimer && this.win && typeof this.win.clearTimeout === 'function') {
                this.win.clearTimeout(this._thinkingTimer);
                this._thinkingTimer = null;
            }
        }

        /**
         * Is the conversation itself mid-turn?
         *
         * Reads the phase from `ConversationSurface` rather than from a deadline, so a beat
         * waits exactly as long as the reply takes — no longer, and no less.
         *
         * The one timeout left is a failure valve, not a guess: `main.js` does not close the
         * turn on every error path, and a provider stuck in the 504-and-retry loop the reported
         * session showed closes nothing at all. Without it a single dead request would mute the
         * rest of the evening, which is a worse failure than a line arriving late.
         */
        _conversationHasFloor() {
            const api = surfaceApi(this.win);
            const state = api && typeof api.turn === 'function' ? api.turn() : null;
            if (!state) return false;
            const stale = THINKING_TIMEOUT_MS * (this.timingScale || 1);
            if (state.phase === 'assistant') return this.now() - state.assistantAt < stale;
            if (state.phase === 'user') return this.now() - state.userAt < stale;
            // She finished a moment ago. Let the sentence land before scripting over it.
            const since = this.now() - (state.assistantEndedAt || 0);
            return state.assistantEndedAt > 0 && since < BREATHING_ROOM_MS * (this.timingScale || 1);
        }

        /**
         * Whether a scheduled beat may speak now.
         *
         * The whole of P8 in one expression, and the replacement for
         * `now() < _conversationBusyUntil`: never over the person, never over the model, and
         * never on top of a question she still owes an answer to.
         */
        _beatIsEligible() {
            if (this._conversationHasFloor()) return false;
            if (this._pendingQuestion) {
                // A question whose reply never arrived. Bounded by the same valve as the floor,
                // because "she owes you an answer" must not become a mute for the rest of the
                // evening — the same reasoning as `_conversationHasFloor`, for the same reason.
                if (this.now() - this._lastTurnAt < THINKING_TIMEOUT_MS * (this.timingScale || 1)) return false;
                this._pendingQuestion = false;
            }
            return true;
        }

        _listen() {
            this._watchConversation();
            if (!this.bus || typeof this.bus.on !== 'function') return;
            this._unsubscribes.push(
                this.bus.on('adult:level', () => this._paintLevel()),
                this.bus.on('adult:exit', (event) => {
                    if (!event || event.kind !== 'soft') return;
                    this._paintLevel();
                    // `Keep it cozy` from level 1 is `from: 1, to: 1` — the pace word already
                    // said Warm and still says Warm, so the old single line claimed something
                    // had been turned down when nothing had, and read as a dead button.
                    // Saying what is actually true costs one branch.
                    const eased = Number(event.from) > Number(event.to);
                    this._speak(
                        eased
                            ? 'Keeping it cozy. Back to gentle, and we can stay right here.'
                            : 'We are already as gentle as this gets. I am happy right here.',
                        // An interjection, so a question that was on screen comes back under
                        // it rather than being destroyed by a footer button.
                        { interjection: true, intent: 'breathe' }
                    );
                })
            );
        }

        /**
         * A timer in the session's timebase, tracked for teardown, with no eligibility check.
         *
         * `_schedule` defers when the conversation holds the floor, which is right for anything
         * that would *speak*. A timer whose job is to give up on a reply that is not coming
         * needs the opposite, so the two are separate rather than one function with a flag.
         */
        _delay(ms, fn) {
            if (!this.win || typeof this.win.setTimeout !== 'function') return null;
            const id = this.win.setTimeout(
                () => {
                    this._timers.delete(id);
                    if (!this._stopped) fn();
                },
                Math.max(0, Number(ms) || 0) * this.timingScale
            );
            this._timers.add(id);
            return id;
        }

        _schedule(ms, fn) {
            if (!this.win || typeof this.win.setTimeout !== 'function') return null;
            const delay = Math.max(0, Number(ms) || 0) * this.timingScale;
            const id = this.win.setTimeout(() => {
                this._timers.delete(id);
                if (!this._beatIsEligible()) {
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
            if (this._unwatchVisibility) {
                try {
                    this._unwatchVisibility();
                } catch (_) {}
                this._unwatchVisibility = null;
            }
            this._beats = [];
            if (!this.win || typeof this.win.clearTimeout !== 'function') return;
            for (const id of this._timers) this.win.clearTimeout(id);
            this._timers.clear();
        }

        /**
         * Register a beat at a wall-clock offset from the session's start.
         *
         * The five beats used to be five independent `setTimeout`s spanning five minutes with
         * gaps of 75, 90 and 75 seconds between them, and that is not a schedule a browser
         * will honour. A hidden tab has its timers clamped to roughly one a minute, and after
         * about five minutes hidden Chrome may freeze them outright; locking a phone or
         * switching apps does the same. So a session where somebody looked away after the
         * 210-second line simply never got the closing or the completion — the card sat there,
         * still mounted, still showing its buttons, with nothing left that would ever fire.
         * Reported, accurately, as "later nothing happens".
         *
         * Storing the offset instead of trusting a timer fixes it, because a late tick can
         * still work out what it missed. `_tick` fires everything now due.
         */
        _beat(at, run) {
            this._beats.push({ at: Math.max(0, Number(at) || 0), run, done: false });
            return this._beats.length;
        }

        /** Milliseconds since `start()`, in the session's own (test-scalable) timebase. */
        _elapsed() {
            const scale = this.timingScale > 0 ? this.timingScale : 1;
            return (this.now() - (this.startedAt || this.now())) / scale;
        }

        /**
         * Fire everything due, then arm for the next one.
         *
         * Deliberately catch-up rather than replay-in-order-with-delays: coming back to a tab
         * after four minutes should land you at the right point in the session, not walk you
         * through four minutes of backlog. Beats are marked done before running so a throw in
         * one cannot make it fire twice on the next tick.
         */
        _tick() {
            if (this._stopped || this.state === 'complete') return;
            // A person mid-sentence, or a reply mid-stream, outranks the clock. Come back in a
            // second rather than talking over either of them. This used to be
            // `now() < _conversationBusyUntil` — an eight-second guess at how long an answer
            // takes. See `_conversationHasFloor` for what replaced it and why.
            if (!this._beatIsEligible()) return this._armBeats(1000);
            const elapsed = this._elapsed();
            for (const beat of this._beats) {
                if (beat.done || beat.at > elapsed) continue;
                beat.done = true;
                try {
                    beat.run();
                } catch (error) {
                    // One beat that throws must not take the rest of the evening with it.
                    console.warn('[Private] a beat failed', error);
                }
                if (this._stopped || this.state === 'complete') return;
            }
            this._armBeats();
        }

        /**
         * One timer for the next beat, plus a wake-up when the tab comes back.
         *
         * `visibilitychange` is the half that makes the catch-up actually happen: a throttled
         * timer may be minutes late, but the event fires the moment somebody returns.
         */
        _armBeats(inMs) {
            if (this._stopped || this.state === 'complete') return null;
            if (!this._unwatchVisibility && this.doc && typeof this.doc.addEventListener === 'function') {
                const onVisible = () => {
                    if (!this.doc.hidden) this._tick();
                };
                this.doc.addEventListener('visibilitychange', onVisible);
                this._unwatchVisibility = () => this.doc.removeEventListener('visibilitychange', onVisible);
            }
            const pending = this._beats.filter((beat) => !beat.done);
            if (!pending.length) return null;
            const elapsed = this._elapsed();
            const next = Math.min(...pending.map((beat) => beat.at));
            // Never longer than a minute: that is roughly the resolution a background tab
            // gets anyway, and it keeps a stalled session self-healing without a visibility
            // event at all.
            const wait = Number.isFinite(inMs) ? inMs : Math.max(0, Math.min(next - elapsed, 60000));
            return this._schedule(wait, () => this._tick());
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
                onUserMessage: () => this._userIsTalking(),
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

        _showMessage(text, actions, options) {
            if (this.view) this.view.showMessage(text, actions, options);
        }

        /**
         * Ask for a movement, the way every other Together activity does.
         *
         * `bus.emit('intent', …)` is the seam — `boot.js` forwards it to
         * `director.handleIntent`, and Assistant, Coach, Focus, Music, Cohost, Scene Journey
         * and Screen Insight all use it. Private was the only activity that never emitted
         * anything at all, which is the whole of why the avatar stands still through a session
         * and the card reads as unresponsive.
         *
         * The names here are deliberately ordinary — `breathe`, `nod_along` — and never the
         * adult ceiling's `flirt`/`tease`/`sensualSway`. Those map to nsfw-tagged clips, and
         * `UtilityRanker` refuses an nsfw clip whose intent did not come from the user while
         * `proactiveNsfw: false` says she may never initiate one. So this asks for presence,
         * not performance, and an install whose registry has no clip for the name simply
         * plays nothing — the same fail-soft every other caller gets.
         */
        _intent(name, intensity = 0.3) {
            if (!this.bus || typeof this.bus.emit !== 'function' || this._stopped) return false;
            try {
                this.bus.emit('intent', { name, intensity, source: 'private' });
                return true;
            } catch (_) {
                // A movement that will not play is never a reason to lose the line it went with.
                return false;
            }
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
            // Prepared, normally. Searching here was what made the soundtrack arrive some
            // seconds into an evening that had already started talking.
            let track = this.track;
            if (!track) {
                const registry = this.win.NEXUS_DISCOVERY;
                if (!registry || typeof registry.forCapability !== 'function') return false;
                try {
                    if (typeof registry.warm === 'function') await registry.warm();
                    const provider = registry.forCapability('music.search');
                    if (!provider || typeof provider.search !== 'function') return false;
                    const found = await provider.search(this.preset.music, { max: 3, kind: 'music' });
                    if (this._stopped || !Array.isArray(found) || !found.length) return false;
                    track = found[0];
                } catch (_) {
                    return false;
                }
            }
            try {
                if (media && typeof media.requestPlay === 'function') media.requestPlay(track, { source: 'private' });
                if (this.view) this.view.attachSoundtrack(track);
                this._ownsMedia = true;
                return true;
            } catch (_) {
                return false;
            }
        }

        /**
         * Put the evening where it asked to be, and remember where it was.
         *
         * Private had no connection to the scene system at all. `adult.profile` declares
         * `scenes: ['sunset', 'candlelit']` and **nothing in the repository reads that field**
         * — the setup screen showed the current place as a read-only label and the session
         * never touched the background. So "a more personal moment" happened in whatever room
         * happened to be up, including the default black.
         *
         * Snapshot and restore rather than a bespoke undo, per the house rule: whatever was
         * showing is stashed verbatim and written back on exit, so a scene chosen for one
         * evening never leaks into the rest of the app.
         */
        _enterScene() {
            if (!this.scene || !this.win) return false;
            const controller = this.win.NEXUS_SCENE_AMBIENCE_CONTROLLER;
            if (!controller || typeof controller.apply !== 'function') return false;
            try {
                if (typeof controller.currentScene === 'function') this._sceneBefore = controller.currentScene();
                const result = controller.apply(this.scene, { source: 'private' });
                return Boolean(result && result.changed);
            } catch (_) {
                // A room that will not change is not a session that cannot happen.
                return false;
            }
        }

        _restoreScene() {
            if (this._sceneBefore === null || !this.win) return false;
            const previous = this._sceneBefore;
            this._sceneBefore = null;
            const controller = this.win.NEXUS_SCENE_AMBIENCE_CONTROLLER;
            if (!controller || typeof controller.apply !== 'function') return false;
            try {
                controller.apply(previous, { source: 'private' });
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

        _speak(text, { interjection = false, intent = 'nod_along' } = {}) {
            const line = cleanText(text, 700);
            if (!line) return;
            this._showMessage(line, [], { interjection });
            this._remember(line);
            // Something to look at while she talks. Gentle and non-adult by design — see
            // `_intent` for why the ceiling's own intents are not used here.
            if (intent) this._intent(intent, 0.3);
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

        /**
         * The person is composing. Presentation only — no counting, no classification.
         *
         * Called from the composer's `keydown`/click, which is the earliest possible moment and
         * fires even for a keystroke that never becomes a message, and again from `_onUserTurn`
         * for a send that did not come from the composer at all (voice, a programmatic send).
         * Whose turn it is is *not* set here: `ConversationSurface` owns that, and a keystroke
         * that never became a message must not be able to take the floor.
         */
        _userIsTalking() {
            this._composingAt = this.now();
            // Something moving while the provider works. The reported session sat through
            // `OllaBridge returned 504; retrying` with a completely static card, which is
            // indistinguishable from a crash. The view hides these again when a reply lands
            // in the transcript; this is only the safety valve for a reply that never does.
            if (this.view && typeof this.view.showThinking === 'function') {
                this.view.showThinking();
                if (this._thinkingTimer && this.win && typeof this.win.clearTimeout === 'function') {
                    this.win.clearTimeout(this._thinkingTimer);
                }
                // `_delay`, not `_schedule`: the valve on the dots must fire *because* the
                // conversation is stuck mid-turn, and `_schedule` now defers exactly then. Put
                // this on the beat scheduler and the one timer whose job is to admit that
                // nothing is coming would wait for something to come.
                this._thinkingTimer = this._delay(THINKING_TIMEOUT_MS, () => {
                    this._thinkingTimer = null;
                    if (this.view && typeof this.view.hideThinking === 'function') this.view.hideThinking();
                });
            }
            try {
                if (this.win && this.win.speechSynthesis && typeof this.win.speechSynthesis.cancel === 'function')
                    this.win.speechSynthesis.cancel();
            } catch (_) {}
            if (this.audioFocus && typeof this.audioFocus.restore === 'function') this.audioFocus.restore();
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
            // Either a turn they sent or a key they pressed. See `_composingAt`: mid-sentence
            // and mid-typing both deserve not to be hung up on, even though only one of them is
            // allowed to hold a scheduled line.
            const spokeAt = Math.max(this._lastTurnAt, this._composingAt);
            const talking = this.now() - spokeAt < 30000 * (this.timingScale || 1);
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
                        scene: this.scene,
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

        /**
         * Tell the bus, and never let the bus stop the session.
         *
         * This was unguarded, and `beforeActivityStop` emits — so a bus that threw took
         * teardown down with it, leaving the adult mode entered, the ceiling installed and the
         * blackboard unrestored. A telemetry line is not worth a session that cannot be
         * stopped, and exit is exactly where fail-soft matters most.
         */
        _emit(name, payload) {
            if (!this.bus || typeof this.bus.emit !== 'function') return;
            try {
                this.bus.emit(name, payload);
            } catch (_) {
                // Nobody heard it. Everything else still happens.
            }
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
                // Whatever the setup screen prepared. Absent on a caller that skipped it, and
                // the session falls back to doing the work itself.
                plan: input.preparedPlan || this.preparedPlan || null,
                track: input.preparedTrack || this.preparedTrack || null,
                scene: input.scene || this.sceneChoice || null,
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
        responseBudget,
        experienceOverlay,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TOGETHER_CAPABILITY = api;
    schedulePrivateRuntimeInstall();
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
