/**
 * copilot — hands-busy help (spec v1.1 UC-14, addendum v1.2 §13c, batch B26).
 *
 * Your phone is propped against the flour bag and your hands are covered in dough. She holds
 * the recipe, counts the proving time, and — when you ask — looks at what you are doing.
 *
 * ## On-demand snapshots only, and the absence is structural
 *
 * There is no periodic-frame path in this file, and there is no way to add one without
 * noticing, because **this file names no timer primitive at all**. Not `setInterval`, not
 * `setTimeout`, not `requestAnimationFrame`. Even the proving timer is a deadline compared
 * against the clock on each `tick()` from the render loop, the way every other activity in
 * this engine is driven — so a frame can only be taken by someone asking for one.
 *
 * That is the privacy posture and it is also the battery posture: a phone propped up for
 * forty minutes of bread, sampling the camera once a second, is a phone that is hot and
 * flat by the second prove. A test greps this file for the primitives, and for `watch`,
 * because B15's activity *does* have a periodic mode and the temptation is to reach for it.
 *
 * ## It reuses B15's round trip rather than describing it again
 *
 * The copilot holds a `ScreenInsight` activity and calls `start('camera')` and `ask()`. It
 * builds no pipeline, opens no camera and posts nothing — a test asserts the file names no
 * `getUserMedia`, no `fetch` and no endpoint. So B11's consent machine is the only door,
 * which means B11's indicator lights up for the copilot without the copilot knowing the
 * indicator exists; and a revoke from the browser's own bar tears this down through the
 * path that already handles it.
 *
 * ## Hands-free means the grammar is small and said out loud
 *
 * A command list you have to remember is not hands-free, it is a keyboard made of words. So
 * the vocabulary is nine phrases, each with the synonyms people actually use mid-task
 * ("done" is "next", "what was that" is "repeat"), and anything unrecognised is left alone
 * rather than guessed at — a misheard "next" that skips a step in a recipe is worse than a
 * copilot that says nothing.
 *
 * Exposes: window.NEXUS_BD_COPILOT
 */
const CopilotActivity = (() => {
    'use strict';

    /** §6.13's round-trip target, and B26's acceptance criterion. */
    const BUDGET_MS = 3000;

    /** A checklist longer than this is a document, and a document is not hands-free. */
    const MAX_STEPS = 60;

    /** She counts the last stretch down out loud. */
    const TIMER_WARN_MS = 10000;

    /** Spoken numbers people use for timers. Beyond twenty they say the digits. */
    const NUMBERS = {
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
        eleven: 11,
        twelve: 12,
        thirteen: 13,
        fourteen: 14,
        fifteen: 15,
        sixteen: 16,
        seventeen: 17,
        eighteen: 18,
        nineteen: 19,
        twenty: 20,
        thirty: 30,
        forty: 40,
        fifty: 50,
        sixty: 60,
        half: 0.5,
        a: 1,
        an: 1,
    };

    /**
     * The grammar. Order matters: the first match wins, so the specific patterns sit above
     * the general ones — "start a timer" must be read before a bare "start".
     */
    const COMMANDS = [
        { name: 'timer', pattern: /\b(?:set|start)\s+(?:a\s+)?timer\b/i },
        { name: 'remaining', pattern: /\b(?:how\s+long|time\s+left|how\s+much\s+longer)\b/i },
        { name: 'cancel', pattern: /\b(?:cancel|stop)\s+(?:the\s+)?timer\b/i },
        {
            name: 'look',
            pattern:
                /\b(?:how(?:'s| is| does)\s+(?:this|it)|check\s+this|look\s+at\s+(?:this|it)|does\s+this\s+look)\b/i,
        },
        { name: 'repeat', pattern: /\b(?:repeat|again|say\s+that\s+again|what\s+was\s+that)\b/i },
        { name: 'back', pattern: /\b(?:back|previous|go\s+back|last\s+step)\b/i },
        { name: 'next', pattern: /\b(?:next|done|finished|got\s+it|what(?:'s| is)\s+next)\b/i },
        { name: 'where', pattern: /\b(?:where\s+(?:am\s+i|was\s+i)|which\s+step)\b/i },
    ];

    /**
     * Parse a duration out of a spoken phrase. Returns null rather than guessing — "set a
     * timer" with no number is a question, not an instruction.
     */
    function duration(text) {
        const words = String(text || '').toLowerCase();
        const match = words.match(
            /\b(\d+(?:\.\d+)?|[a-z]+)\s*(?:and\s+a\s+half\s*)?(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/
        );
        if (!match) return null;
        const raw = match[1];
        const value = /^\d/.test(raw) ? parseFloat(raw) : NUMBERS[raw];
        if (!Number.isFinite(value)) return null;
        const half = /and\s+a\s+half/.test(words) ? 0.5 : 0;
        const unit = match[2];
        const scale = /^h/.test(unit) ? 3600000 : /^m/.test(unit) ? 60000 : 1000;
        const ms = Math.round((value + half) * scale);
        return ms > 0 ? ms : null;
    }

    /** Which command, if any. Unrecognised speech is left alone — see the header. */
    function parse(text) {
        const clean = String(text || '').trim();
        if (!clean) return null;
        for (const command of COMMANDS) {
            if (command.pattern.test(clean)) return { name: command.name, text: clean };
        }
        return null;
    }

    // ── the checklist ────────────────────────────────────────────────────────

    /**
     * Where you are in a list of steps. A pure state machine: no clock, no bus, no camera,
     * so the ordering rules can be checked directly rather than inferred from behaviour.
     */
    class Checklist {
        constructor(steps = [], { title = '' } = {}) {
            this.title = title;
            this.steps = (Array.isArray(steps) ? steps : [])
                .map((step) => (typeof step === 'string' ? { text: step } : step))
                .filter((step) => step && typeof step.text === 'string' && step.text.trim())
                .slice(0, MAX_STEPS);
            /** -1 is "not started". Distinct from step 0, which is a real place to be. */
            this.index = -1;
        }

        get length() {
            return this.steps.length;
        }

        get started() {
            return this.index >= 0;
        }

        get finished() {
            return this.index >= this.steps.length;
        }

        get current() {
            return this.started && !this.finished ? this.steps[this.index] : null;
        }

        get position() {
            return { step: this.index + 1, of: this.steps.length };
        }

        /** Move on. Past the last step is `finished`, not an error and not a wrap. */
        next() {
            if (!this.steps.length) return null;
            this.index = Math.min(this.index + 1, this.steps.length);
            return this.current;
        }

        /**
         * Back one. Never before the first step: a recipe has no step zero.
         *
         * From `finished` it returns to the *last* step rather than the one before it —
         * "back" after the last "next" means you have not finished after all, not that you
         * did the last step twice.
         */
        back() {
            if (!this.steps.length) return null;
            const from = this.finished ? this.steps.length : this.index;
            this.index = Math.max(0, from - 1);
            return this.current;
        }

        reset() {
            this.index = -1;
            return this;
        }
    }

    // ── the activity ─────────────────────────────────────────────────────────

    class Copilot {
        constructor({ bus, blackboard, insight, say, config = {}, now = () => Date.now() } = {}) {
            this.id = 'copilot';
            this.label = 'Hands-busy copilot';

            this.bus = bus || null;
            this.blackboard = blackboard || null;
            this.insight = insight || null;
            this.now = now;
            this.config = config;
            this.budgetMs = (config.copilot && config.copilot.budgetMs) || BUDGET_MS;

            this._say = say === undefined ? defaultSay : say;

            this.checklist = new Checklist([]);
            this.running = false;
            /** `{ endsAt, ms, label, warned }` or null. One at a time — see `timer()`. */
            this.timer = null;
            this.spoken = [];
            this.looks = 0;
            this.roundTrips = [];
            this.heard = 0;
            this.unrecognised = 0;
            this._unsubscribes = [];
        }

        get name() {
            return 'Copilot';
        }

        get sharing() {
            return Boolean(this.insight && this.insight.sharing);
        }

        // ── lifecycle ────────────────────────────────────────────────────────

        /**
         * Begin a checklist. The camera is asked for through B11 — this file has no other
         * way to one — so the consent indicator appears because consent happened.
         */
        async start(steps, { title = '' } = {}) {
            if (this.running) return { ok: false, why: 'already running' };
            if (!this.insight) return { ok: false, why: 'no vision activity available' };

            this.checklist = new Checklist(steps, { title });
            if (!this.checklist.length) return { ok: false, why: 'a checklist needs steps' };

            const started = await this.insight.start('camera');
            if (!started) return { ok: false, why: 'camera consent was declined' };

            this.running = true;
            this._listen();
            this.checklist.next();
            this._announce();
            return { ok: true, why: 'started', steps: this.checklist.length };
        }

        stop(why = 'user') {
            if (!this.running) return false;
            for (const stop of this._unsubscribes.splice(0)) stop();
            this.timer = null;
            this.running = false;
            if (this.insight) this.insight.stop(why);
            this.checklist.reset();
            return true;
        }

        detach() {
            this.stop('detached');
        }

        _listen() {
            if (!this.bus) return;
            this._unsubscribes.push(this.bus.on('voice:final', (event) => this.hear(event && event.text)));
        }

        // ── hands-free ───────────────────────────────────────────────────────

        /**
         * A final transcript. Returns what it did, or null when it heard nothing it knows —
         * a misheard "next" that skips a step in a recipe is worse than a copilot that says
         * nothing, so unrecognised speech is counted and left alone.
         */
        hear(text) {
            if (!this.running) return null;
            // Silence is not speech she failed to understand. `VoiceAdapter` guards this
            // too; `hear()` is public, so it guards it as well rather than trusting a caller.
            if (!String(text || '').trim()) return null;
            this.heard++;
            const command = parse(text);
            if (!command) {
                this.unrecognised++;
                return null;
            }
            switch (command.name) {
                case 'next':
                    return this.next();
                case 'back':
                    return this.back();
                case 'repeat':
                    return this.repeat();
                case 'where':
                    return this.where();
                case 'timer': {
                    const ms = duration(command.text);
                    // "Set a timer" with no number is a question. Say so rather than
                    // inventing a length and counting down from it.
                    if (!ms) return this._speak('How long?', 'timer-unclear');
                    return this.setTimer(ms);
                }
                case 'remaining':
                    return this.remaining();
                case 'cancel':
                    return this.cancelTimer();
                case 'look':
                    // Deliberately not awaited: her hands are busy and so is the socket.
                    // The answer arrives when it arrives, through the same speech path.
                    this.look(command.text);
                    return { action: 'look', why: 'asked' };
                default:
                    return null;
            }
        }

        // ── the checklist ────────────────────────────────────────────────────

        next() {
            const step = this.checklist.next();
            if (!step) return this._speak('That was the last one.', 'finished');
            return this._announce();
        }

        back() {
            this.checklist.back();
            return this._announce();
        }

        repeat() {
            return this._announce('repeat');
        }

        where() {
            const { step, of } = this.checklist.position;
            return this._speak(`Step ${Math.min(step, of)} of ${of}.`, 'where');
        }

        _announce(why = 'step') {
            const step = this.checklist.current;
            if (!step) return this._speak('Nothing left.', 'finished');
            const { step: n, of } = this.checklist.position;
            return this._speak(`Step ${n} of ${of}. ${step.text}`, why);
        }

        // ── timers ───────────────────────────────────────────────────────────

        /**
         * One timer at a time. A second one replaces the first and says so: two countdowns
         * you cannot see, announced by the same voice, is worse than no timer.
         */
        setTimer(ms, label = '') {
            const at = this.now();
            const replaced = Boolean(this.timer);
            this.timer = { endsAt: at + ms, ms, label, warned: false, startedAt: at };
            const words = spell(ms);
            return this._speak(replaced ? `New timer: ${words}.` : `${words}.`, 'timer-set');
        }

        cancelTimer() {
            if (!this.timer) return this._speak('No timer running.', 'timer-none');
            this.timer = null;
            return this._speak('Timer cancelled.', 'timer-cancelled');
        }

        remaining(at = this.now()) {
            if (!this.timer) return this._speak('No timer running.', 'timer-none');
            const left = Math.max(0, this.timer.endsAt - at);
            return this._speak(`${spell(left)} left.`, 'timer-remaining');
        }

        /**
         * Called from the render loop. The timer is a deadline compared against the clock —
         * there is no scheduled callback in this file, which is what makes "no periodic
         * frame path" a property of the source rather than a promise about it.
         */
        tick(at = this.now()) {
            if (!this.running || !this.timer) return null;
            const left = this.timer.endsAt - at;
            if (left <= 0) {
                const label = this.timer.label;
                this.timer = null;
                if (this.bus) this.bus.emit('copilot:timer', { state: 'elapsed', label, at });
                return this._speak(label ? `${label} — time.` : 'Time.', 'timer-elapsed');
            }
            if (!this.timer.warned && left <= TIMER_WARN_MS) {
                this.timer.warned = true;
                if (this.bus) this.bus.emit('copilot:timer', { state: 'warning', ms: left, at });
                return this._speak(`${spell(left)}.`, 'timer-warning');
            }
            return null;
        }

        // ── the one snapshot ─────────────────────────────────────────────────

        /**
         * One frame, one question, one answer — B15's round trip, unmodified. Nothing in
         * this file can take a frame any other way, and nothing schedules this.
         */
        async look(prompt = '') {
            if (!this.insight) return null;
            const step = this.checklist.current;
            const asked = step ? `${prompt} (step: ${step.text})` : prompt;
            const started = this.now();
            this.looks++;
            const answer = await this.insight.ask(asked);
            const elapsed = this.now() - started;
            this.roundTrips.push(elapsed);
            if (this.bus) {
                this.bus.emit('copilot:look', {
                    ms: elapsed,
                    overBudget: elapsed > this.budgetMs,
                    answered: Boolean(answer),
                });
            }
            return answer;
        }

        /** The 95th percentile round trip this session, or null before the first. */
        get p95() {
            if (!this.roundTrips.length) return null;
            const sorted = [...this.roundTrips].sort((a, b) => a - b);
            const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
            return sorted[Math.max(0, index)];
        }

        // ── speech ───────────────────────────────────────────────────────────

        _speak(text, why) {
            this.spoken.push({ text, why, at: this.now() });
            if (typeof this._say === 'function') this._say(text, { source: 'copilot' });
            return { action: why, text };
        }

        get stats() {
            return {
                running: this.running,
                sharing: this.sharing,
                position: this.checklist.position,
                timer: this.timer ? Math.max(0, this.timer.endsAt - this.now()) : null,
                heard: this.heard,
                unrecognised: this.unrecognised,
                looks: this.looks,
                p95: this.p95,
                budgetMs: this.budgetMs,
                spoken: this.spoken.length,
            };
        }
    }

    /** A duration, said the way a person says it. */
    function spell(ms) {
        const seconds = Math.round(ms / 1000);
        if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        const head = `${hours} hour${hours === 1 ? '' : 's'}`;
        return rest ? `${head} ${rest} minute${rest === 1 ? '' : 's'}` : head;
    }

    function defaultSay(text, options) {
        try {
            const say = typeof window !== 'undefined' ? window.NEXUS_BD_SAY : null;
            if (typeof say === 'function') say(text, options);
        } catch (error) {
            console.warn('[BD] the copilot could not speak', error);
        }
    }

    function attach(deps) {
        return new Copilot(deps);
    }

    return {
        attach,
        Copilot,
        Checklist,
        parse,
        duration,
        spell,
        COMMANDS,
        NUMBERS,
        BUDGET_MS,
        MAX_STEPS,
        TIMER_WARN_MS,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_COPILOT = CopilotActivity;
if (typeof module !== 'undefined' && module.exports) module.exports = CopilotActivity;
