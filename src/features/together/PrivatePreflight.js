/**
 * Load the evening before it starts, and say what is loading (P20).
 *
 * ## What this replaces
 *
 * `Begin →` used to begin, immediately, and race a hidden 2.5-second budget:
 *
 * ```js
 *   if (win && typeof win.setTimeout === 'function') win.setTimeout(once, PRIVATE_START_BUDGET);
 *   activity.prepared.then(once, once);
 * ```
 *
 * Whichever finished first won, so the session started in whatever state the machine happened to
 * be in. In the reported session that meant: the first line was spoken before
 * `speech-service` had any voices (`🔊 Loaded 0 voices`), the scene's backplate decoded *after*
 * the card was already up, and the very first reply came back empty because nothing had checked
 * that the provider could answer at the cap it was going to be asked at. All three read to a
 * person as the feature being broken, and all three are knowable in the second before you press
 * the button.
 *
 * Scene Tale already got this right — `Creating our story…` with a named line per step and a ✓ as
 * each lands — and the reason it feels different is not the spinner. It is that the work is *real*
 * and the screen is telling the truth about it. This is the same shape for Private.
 *
 * ## Nothing here is a gate (P25)
 *
 * The first version split the steps into required and optional, and a failed required step stopped
 * at a screen with no way forward but `Start anyway`. That was reported in the obvious way: a green
 * checklist with one red row —
 *
 * ```text
 *   ✓ Finding her voice      ✕ Waking the model       ✓ Writing the evening
 *   · Loading this place     ✓ Warming up her movements   · Finding a soundtrack
 *   Not ready: Waking the model.
 * ```
 *
 * — in an app whose provider demonstrably worked a minute earlier. A warm-up that can refuse to let
 * you in is not a warm-up, it is a second gate in front of a feature that already has one; and it
 * fails in the worst direction, because every reason it goes red is transient — a slow first
 * request, a cold provider, a 504 in the retry loop — while the cost of being wrong is the whole
 * feature.
 *
 * So this warms and reports, and that is all. `Begin` is always available. A step that did not work
 * is a line on the summary, not a wall, which is the same fail-soft the rest of this codebase
 * already uses for a bad manifest and a missing asset.
 *
 * The one thing that genuinely could not work — no `PrivateBeats` at all, so she has nothing to
 * say — is not checkable here anyway: `Private` would not have started.
 *
 * ## Deliberately not a spinner with nice words on it
 *
 * Every step does the thing it names. `voice` waits for the synthesiser's voice list to be
 * populated; `model` sends a real completion at the real cap; `place` decodes the actual image the
 * viewport will show. If a step cannot be performed on this page — no synthesiser, no scene chosen
 * — it reports `skipped` rather than a ✓, because a checklist that ticks things it did not do is
 * worse than no checklist.
 *
 * ## Pure, and driven from outside
 *
 * No timers, no DOM, no globals reached for directly: every dependency arrives in `deps` so the
 * interesting half is testable and so a step cannot quietly depend on boot order. The caller owns
 * the clock and the repaint; this owns what the steps are and what "done" means for each.
 *
 * Exposes: window.NEXUS_PRIVATE_PREFLIGHT
 */
(function (global) {
    'use strict';

    /**
     * How long any one step may take before it is given up on.
     *
     * Per step rather than overall, so one slow provider cannot eat the whole budget and leave the
     * scene unloaded. Generous: this screen is honest work being shown, and a person watching a
     * named step tick over waits far longer than somebody staring at a frozen card — the reported
     * boot took 21 seconds and nothing said so.
     */
    const STEP_TIMEOUT_MS = 6000;

    /**
     * Except the one step that leaves the machine.
     *
     * Five of the six checks are local — a voice list, a written plan, an image, a clip table —
     * and six seconds is luxurious for all of them. `model` asks a provider for a real completion,
     * which on a cloud route through a serverless proxy is a cold function, a relay hop and a
     * model that may need loading. Measured against a live OllaBridge gateway: 12 to 25 seconds.
     *
     * So the old budget could not be met by a *working* provider, and the reported screen is what
     * that looks like — `✕ Waking the model` in an app whose console shows forty models loaded and
     * completions posting. The step was not detecting a broken provider, it was detecting that an
     * LLM is slower than six seconds.
     */
    const MODEL_TIMEOUT_MS = 20000;

    /**
     * And the whole preflight, after which whatever landed is what we go with.
     *
     * The steps run concurrently, so this needs headroom over the *longest* of them, not their
     * sum. At 10000 it was below `MODEL_TIMEOUT_MS`, which made the per-step budget a fiction: the
     * overall valve would have cut the model step off at ten seconds however long it was given.
     */
    const TOTAL_TIMEOUT_MS = MODEL_TIMEOUT_MS + 5000;

    /** What each step is allowed, falling back to the shared budget. */
    function budgetFor(id) {
        return id === 'model' ? MODEL_TIMEOUT_MS : STEP_TIMEOUT_MS;
    }

    /**
     * The voice list, which is populated asynchronously and is empty at boot.
     *
     * `speechSynthesis.getVoices()` returns `[]` until the browser has loaded them, and fires
     * `voiceschanged` when it has. The reported session logged `Loaded 0 voices` and then started
     * Private, so her opening line had no voice to be said in. Polling rather than only listening
     * to the event because Chrome sometimes populates the list without firing it.
     */
    const VOICE_POLL_MS = 150;

    const STATES = Object.freeze(['pending', 'running', 'done', 'skipped', 'failed']);

    /**
     * The steps, in the order they are shown.
     *
     * No `required` flag, deliberately — see the header. The labels are locale keys, resolved by
     * the view: this module names what is happening, and `PrivateLocale` says it in the language
     * the rest of the card is in.
     */
    const STEPS = Object.freeze([
        Object.freeze({ id: 'voice', key: 'preflight.voice' }),
        Object.freeze({ id: 'model', key: 'preflight.model' }),
        Object.freeze({ id: 'story', key: 'preflight.story' }),
        Object.freeze({ id: 'place', key: 'preflight.place' }),
        Object.freeze({ id: 'movement', key: 'preflight.movement' }),
        Object.freeze({ id: 'soundtrack', key: 'preflight.soundtrack' }),
    ]);

    /** The intents Private actually emits. See `TogetherCapability._intent`. */
    const PRIVATE_INTENTS = Object.freeze(['breathe', 'nod_along', 'lean_in']);

    function create() {
        const steps = {};
        for (const step of STEPS) steps[step.id] = { id: step.id, state: 'pending', why: '' };
        return { steps, startedAt: 0, finishedAt: 0, outcome: '' };
    }

    function mark(run, id, state, why) {
        if (!run || !run.steps || !run.steps[id]) return null;
        if (!STATES.includes(state)) return null;
        run.steps[id].state = state;
        run.steps[id].why = String(why || '');
        return run.steps[id];
    }

    /** `{ done, total, ready, failed }` — everything a progress line needs and nothing else. */
    function describe(run) {
        const list = STEPS.map((step) => ({
            ...step,
            state: (run && run.steps && run.steps[step.id] && run.steps[step.id].state) || 'pending',
            why: (run && run.steps && run.steps[step.id] && run.steps[step.id].why) || '',
        }));
        const settled = (entry) => entry.state === 'done' || entry.state === 'skipped' || entry.state === 'failed';
        const failed = list.filter((entry) => entry.state === 'failed');
        return {
            list,
            done: list.filter((entry) => entry.state === 'done').length,
            total: list.length,
            /** Every step has settled. Nothing blocks, so settled is all `ready` can mean. */
            ready: list.every(settled),
            /** What did not work, for the one line under the summary. Never a reason to stop. */
            failed,
            running: list.filter((entry) => entry.state === 'running').map((entry) => entry.id),
        };
    }

    /**
     * Race a promise against a deadline without leaving the loser running.
     *
     * The timer is cleared on settle, because a preflight that is cancelled and restarted — which
     * happens every time somebody changes the scene on step 2 — would otherwise leave one timer per
     * attempt pending for twelve seconds each.
     */
    function withTimeout(promise, ms, deps, label) {
        const setTimer = deps && deps.setTimeout;
        const clearTimer = deps && deps.clearTimeout;
        if (typeof setTimer !== 'function') return Promise.resolve(promise);
        return new Promise((resolve, reject) => {
            let settled = false;
            const id = setTimer(() => {
                if (settled) return;
                settled = true;
                reject(new Error(`${label || 'step'} took longer than ${ms}ms`));
            }, ms);
            Promise.resolve(promise).then(
                (value) => {
                    if (settled) return;
                    settled = true;
                    if (typeof clearTimer === 'function') clearTimer(id);
                    resolve(value);
                },
                (error) => {
                    if (settled) return;
                    settled = true;
                    if (typeof clearTimer === 'function') clearTimer(id);
                    reject(error);
                }
            );
        });
    }

    /**
     * Does she have a voice to say the first line in?
     *
     * Resolves `'skipped'` on a page with no synthesiser at all — a headless test, an install using
     * Piper only — because a missing capability is not a failure. Resolves `'done'` the moment the
     * list is non-empty, which it usually already is by the time anybody has chosen a mood.
     */
    function checkVoice(deps) {
        const synth = deps && deps.speechSynthesis;
        if (!synth || typeof synth.getVoices !== 'function') return Promise.resolve('skipped');
        // A pluggable engine that does its own audio — Piper through WebAudio — has a voice
        // whatever `speechSynthesis` thinks. Asking it first is the same precedence
        // `_replyAudioBusy` uses, and for the same reason.
        const engine = deps.ttsProvider;
        if (engine && typeof engine.ready === 'function') {
            try {
                if (engine.ready() === true) return Promise.resolve('done');
            } catch (_) {
                // Fall through to the browser list.
            }
        }
        const has = () => (synth.getVoices() || []).length > 0;
        if (has()) return Promise.resolve('done');
        return new Promise((resolve) => {
            let poll = null;
            let deadline = null;
            let settled = false;
            // Every exit runs this, and it is idempotent, because the two ways out — the list
            // arriving and the deadline passing — can happen in either order and a listener or an
            // interval that outlived the step would keep polling for the rest of the session.
            const stop = () => {
                if (poll !== null && typeof deps.clearInterval === 'function') deps.clearInterval(poll);
                if (deadline !== null && typeof deps.clearTimeout === 'function') deps.clearTimeout(deadline);
                poll = deadline = null;
                if (typeof synth.removeEventListener === 'function') synth.removeEventListener('voiceschanged', look);
            };
            const finish = (outcome) => {
                if (settled) return;
                settled = true;
                stop();
                resolve(outcome);
            };
            function look() {
                if (has()) finish('done');
            }
            if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', look);
            // Chrome populates the list without always firing the event, so the poll is what
            // actually resolves this in practice and the listener is the fast path.
            if (typeof deps.setInterval === 'function') poll = deps.setInterval(look, VOICE_POLL_MS);
            // Its own deadline rather than leaving this to `run`'s race: the race rejects the outer
            // promise and cannot reach in here to stop the interval. A step that cleans up after
            // itself is the only kind that can be cancelled.
            if (typeof deps.setTimeout === 'function') {
                deadline = deps.setTimeout(() => finish('failed'), STEP_TIMEOUT_MS);
            }
            if (poll === null && deadline === null) finish('failed');
        });
    }

    /**
     * Can the provider answer, at the cap it is about to be asked at?
     *
     * The step the reported session most needed and did not have. A reachability check that asks
     * for 800 tokens proves nothing about a session that will ask for 384 — and the failure was
     * precisely that the model produced no visible token inside its allowance. So this asks the
     * real question: one tiny completion, at the budget Private is going to use.
     */
    function checkModel(deps) {
        const ask = deps && deps.probeModel;
        if (typeof ask !== 'function') return Promise.resolve('skipped');
        return Promise.resolve(ask()).then((ok) => (ok === true ? 'done' : 'failed'));
    }

    /** Is the written or generated plan in hand? `prepared` is the promise step 1 started. */
    function checkStory(deps) {
        const wait = deps && deps.storyReady;
        if (typeof wait !== 'function') return Promise.resolve('skipped');
        return Promise.resolve(wait()).then((plan) => (plan ? 'done' : 'failed'));
    }

    /**
     * Is the scene's picture decoded, so the viewport does not pop mid-sentence?
     *
     * `skipped` when no scene was chosen, which is the common case — `Keep this place` means there
     * is nothing new to load. A scene whose file will not load is optional on purpose: the fallback
     * colour is what `ViewportBackgroundCatalog` exists to provide.
     */
    function checkPlace(deps) {
        const load = deps && deps.sceneReady;
        if (typeof load !== 'function') return Promise.resolve('skipped');
        return Promise.resolve(load()).then((outcome) => {
            if (outcome === null || outcome === undefined) return 'skipped';
            return outcome === true ? 'done' : 'failed';
        });
    }

    /**
     * Will she move when asked to?
     *
     * Private emits `breathe`, `nod_along` and `lean_in` and nothing else — never the adult
     * ceiling's own intents, see `TogetherCapability._intent`. The reported log had
     * `[AnimResolver] No intent config for: …` lines, so this is worth knowing before rather than
     * discovering a session where she stands still. Optional: a missing clip plays nothing, which
     * is the same fail-soft every other caller of the intent bus gets.
     */
    function checkMovement(deps) {
        const resolves = deps && deps.intentResolves;
        if (typeof resolves !== 'function') return Promise.resolve('skipped');
        return Promise.resolve()
            .then(() => PRIVATE_INTENTS.filter((name) => resolves(name) === true))
            .then((found) => {
                if (!found.length) return 'failed';
                return found.length === PRIVATE_INTENTS.length ? 'done' : 'skipped';
            });
    }

    /** Music, if it was asked for. `skipped` when it was not, never a ✓ for work not done. */
    function checkSoundtrack(deps) {
        const find = deps && deps.trackReady;
        if (typeof find !== 'function') return Promise.resolve('skipped');
        return Promise.resolve(find()).then((outcome) => {
            if (outcome === null || outcome === undefined) return 'skipped';
            return outcome === true ? 'done' : 'failed';
        });
    }

    const CHECKS = Object.freeze({
        voice: checkVoice,
        model: checkModel,
        story: checkStory,
        place: checkPlace,
        movement: checkMovement,
        soundtrack: checkSoundtrack,
    });

    /**
     * Run every step concurrently, reporting each as it settles.
     *
     * Concurrent, not sequential, because none of them depends on another and serially the wait is
     * their sum rather than their maximum. `onChange` fires per settle so the screen fills in as
     * the work lands — which is the whole point of showing it — and it is called inside a try/catch
     * because a repaint that throws must not abandon the remaining steps.
     *
     * `cancelled()` is checked before every report, so changing the scene on step 2 and restarting
     * cannot have the old attempt writing ✓s into the new one's screen.
     */
    function run(deps = {}) {
        const state = create();
        state.startedAt = typeof deps.now === 'function' ? deps.now() : 0;
        const cancelled = typeof deps.cancelled === 'function' ? deps.cancelled : () => false;
        const report = () => {
            if (typeof deps.onChange !== 'function') return;
            try {
                deps.onChange(describe(state), state);
            } catch (error) {
                console.warn('[PrivatePreflight] a progress listener threw', error);
            }
        };

        const one = (step) => {
            if (cancelled()) return Promise.resolve();
            mark(state, step.id, 'running');
            const check = CHECKS[step.id];
            if (typeof check !== 'function') {
                mark(state, step.id, 'skipped', 'no check');
                return Promise.resolve();
            }
            let attempt;
            try {
                attempt = check(deps);
            } catch (error) {
                mark(state, step.id, 'failed', (error && error.message) || 'threw');
                report();
                return Promise.resolve();
            }
            return withTimeout(attempt, budgetFor(step.id), deps, step.id).then(
                (outcome) => {
                    if (cancelled()) return;
                    mark(state, step.id, STATES.includes(outcome) ? outcome : 'done');
                    report();
                },
                (error) => {
                    if (cancelled()) return;
                    // A step that timed out is a step that failed, and the reason says which.
                    mark(state, step.id, 'failed', (error && error.message) || 'failed');
                    report();
                }
            );
        };

        report();
        const all = Promise.all(STEPS.map(one));
        const bounded = withTimeout(all, TOTAL_TIMEOUT_MS, deps, 'preflight').catch(() => {
            // The overall valve. Whatever has not settled by now is reported as failed so the
            // screen never sits on a ○ forever. It is still a line on the summary, never a wall.
            for (const step of STEPS) {
                const entry = state.steps[step.id];
                if (entry && (entry.state === 'pending' || entry.state === 'running')) {
                    mark(state, step.id, 'failed', 'timed out');
                }
            }
        });
        return bounded.then(() => {
            state.finishedAt = typeof deps.now === 'function' ? deps.now() : 0;
            const shown = describe(state);
            state.outcome = cancelled() ? 'cancelled' : 'ready';
            report();
            return { ...shown, outcome: state.outcome, state };
        });
    }

    const api = {
        STEPS,
        STATES,
        PRIVATE_INTENTS,
        STEP_TIMEOUT_MS,
        MODEL_TIMEOUT_MS,
        TOTAL_TIMEOUT_MS,
        budgetFor,
        create,
        mark,
        describe,
        run,
        CHECKS,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_PREFLIGHT = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
