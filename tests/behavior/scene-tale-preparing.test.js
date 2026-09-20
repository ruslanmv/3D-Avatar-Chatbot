/**
 * `Creating our story…`, and the ways it used to stop being true.
 *
 * The reported failure: the checklist frozen on `✓ Understanding this place` with three empty
 * circles under it, on a second attempt, after a first story had prepared perfectly. Three
 * separate defects had to line up to produce that screen, and each has a test here.
 *
 * 1. **Nothing had a deadline.** The plan request was awaited bare, so a provider that never
 *    answered stopped the sequence for as long as the user was willing to watch.
 * 2. **Giving up did not call the request off.** Even once we stopped waiting, the fetch kept
 *    running and the provider kept its generation slot — and a provider that generates one
 *    completion at a time (Ollama, and anything relaying to it) made the *next* request queue
 *    behind work nobody was waiting for. That is why the first story was fine and the second
 *    hung.
 * 3. **A step had two states.** `✓` or `○`, so "working on this right now" and "never started"
 *    drew the same circle, and a slow evening was indistinguishable from a stuck one.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const Playground = require('../../src/features/together/activities/playground.js');

/** A node-graph plan the real validator accepts — `plan.choices` has never been a thing. */
function planJson() {
    return JSON.stringify({
        title: 'The Letter at the Last Light',
        startNode: 'n1',
        durationSec: 300,
        music: { query: 'gentle instrumental twilight' },
        nodes: {
            n1: { type: 'narration', text: 'The terrace held the last of the light.', next: 'c1' },
            c1: {
                type: 'choice',
                prompt: 'What was she carrying?',
                options: [
                    { id: 'confession', label: 'A confession', next: 'n2' },
                    { id: 'goodbye', label: 'A goodbye', next: 'n2' },
                ],
            },
            n2: { type: 'narration', text: 'She read it once more.', next: 'c2' },
            c2: {
                type: 'choice',
                prompt: 'And then?',
                options: [
                    { id: 'send', label: 'She sent it', next: 'e1' },
                    { id: 'keep', label: 'She kept it', next: 'e1' },
                ],
            },
            e1: { type: 'end', text: 'The light went.' },
        },
    });
}

const SCENE = { id: 'ambient:terrace:night', label: 'Coastal Terrace · Twilight' };

/** A planner whose clocks are short enough to assert against. */
function planner(sendMessage, extra = {}) {
    window._nexusLLM = { getSettings: () => ({ provider: 'ollabridge' }), sendMessage };
    return new Playground.StoryPlanner({
        win: window,
        timeouts: { plan: 60, music: 40, retryBase: 1, ...(extra.timeouts || {}) },
        ...extra,
    });
}

function run(instance, options = {}) {
    const steps = [];
    const done = instance.prepare({
        scene: SCENE,
        idea: '',
        music: 'none',
        onProgress: (id, state) => steps.push(`${id}:${state}`),
        ...options,
    });
    return { steps, done };
}

beforeEach(() => {
    window.NEXUS_BD = { blackboard: { scene: SCENE } };
});

afterEach(() => {
    delete window._nexusLLM;
    delete window.NEXUS_BD;
});

describe('a provider that answers', () => {
    test('every step runs and then settles, in order', async () => {
        const instance = planner(() => Promise.resolve(planJson()));
        const { steps, done } = run(instance);
        const result = await done;

        expect(steps).toEqual([
            'scene:running',
            'scene:done',
            'story:running',
            'story:done',
            'choices:running',
            'choices:done',
            'music:running',
            'music:skipped',
        ]);
        expect(result.planFrom).toBe('model');
        expect(result.plan.title).toBe('The Letter at the Last Light');
    });

    test('the choices step counts the graph, not a field that does not exist', async () => {
        // `plan.choices` is undefined on every validated plan — reading it reported "nothing to
        // do" about the two choices sitting in `plan.nodes`, on every story ever prepared.
        const instance = planner(() => Promise.resolve(planJson()));
        const { steps, done } = run(instance);
        await done;
        expect(steps).toContain('choices:done');
        expect(steps).not.toContain('choices:skipped');
    });
});

describe('a provider that does not answer', () => {
    test('the deadline fires and the evening continues on the written story', async () => {
        // The whole bug, in one assertion: this used to never settle.
        const instance = planner(() => new Promise(() => {}));
        const { steps, done } = run(instance);
        const result = await done;

        expect(steps).toContain('story:failed');
        expect(steps[steps.length - 1]).toBe('music:skipped');
        // A complete story either way — a deadline must not cost the user the evening.
        expect(result.plan).toBeTruthy();
        expect(result.planFrom).toBe('written');
    });

    test('and the request is aborted rather than left running', async () => {
        // Stopping waiting is not the same as stopping the work. The provider keeps the slot
        // until the socket closes, which is what made the *second* attempt queue forever.
        let signal = null;
        const instance = planner((_message, _prompt, _history, options) => {
            signal = options && options.signal;
            return new Promise(() => {});
        });
        await run(instance).done;
        expect(signal).toBeTruthy();
        expect(signal.aborted).toBe(true);
    });

    test('a timeout is not retried, because a retry spends the same budget again', async () => {
        const send = jest.fn(() => new Promise(() => {}));
        const instance = planner(send);
        await run(instance).done;
        expect(send).toHaveBeenCalledTimes(1);
    });
});

describe('a provider that fails', () => {
    test('is asked twice before we fall back', async () => {
        const send = jest.fn(() => Promise.reject(new Error('502 bad gateway')));
        const instance = planner(send);
        const result = await run(instance).done;
        expect(send).toHaveBeenCalledTimes(2);
        expect(result.planFrom).toBe('written');
    });

    test('and a retry that succeeds gives the model story after all', async () => {
        let call = 0;
        const instance = planner(() => {
            call += 1;
            return call === 1 ? Promise.reject(new Error('503')) : Promise.resolve(planJson());
        });
        const result = await run(instance).done;
        expect(result.planFrom).toBe('model');
    });

    test('an answer that is not a story is a failure, not a crash', async () => {
        const instance = planner(() => Promise.resolve('I would rather not.'));
        const { steps, done } = run(instance);
        const result = await done;
        expect(steps).toContain('story:failed');
        expect(result.plan).toBeTruthy();
    });
});

describe('the second story, which is the one that froze', () => {
    test('starting another preparation calls off the first request', async () => {
        const signals = [];
        const instance = planner((_message, _prompt, _history, options) => {
            signals.push(options && options.signal);
            // Slow enough that the first is unambiguously still in flight.
            return new Promise((resolve) => setTimeout(() => resolve(planJson()), 500));
        });

        const first = instance.prepare({ scene: SCENE, music: 'none', onProgress: () => {} });
        await new Promise((resolve) => setTimeout(resolve, 10));
        const second = instance.prepare({ scene: SCENE, music: 'none', onProgress: () => {} });
        await Promise.all([first.catch(() => {}), second]);

        expect(signals.length).toBe(2);
        // The first was cancelled so the provider could serve the second.
        expect(signals[0].aborted).toBe(true);
    });

    test('cancelling from the Cancel button does the same', async () => {
        let signal = null;
        const instance = planner((_message, _prompt, _history, options) => {
            signal = options && options.signal;
            return new Promise(() => {});
        });
        instance.prepare({ scene: SCENE, music: 'none', onProgress: () => {} });
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(instance.cancel('cancelled')).toBe(true);
        expect(signal.aborted).toBe(true);
    });

    test('cancelling when nothing is running is not an error', () => {
        expect(planner(() => Promise.resolve(planJson())).cancel()).toBe(false);
    });
});

describe('no provider at all', () => {
    test('is nothing to do, not something that failed', async () => {
        // A red cross against "Writing the story" would be a lie about a story that is about
        // to play perfectly well.
        delete window._nexusLLM;
        const instance = new Playground.StoryPlanner({ win: window, timeouts: { plan: 60, music: 40 } });
        const { steps, done } = run(instance);
        const result = await done;
        expect(steps).toContain('story:skipped');
        expect(steps).not.toContain('story:failed');
        expect(result.plan).toBeTruthy();
    });
});

describe('the soundtrack search, which can hang too', () => {
    test('has its own deadline and never holds the evening', async () => {
        window.NEXUS_DISCOVERY = {
            warm: () => Promise.resolve(),
            forCapability: () => ({ search: () => new Promise(() => {}) }),
        };
        const instance = planner(() => Promise.resolve(planJson()));
        const { steps, done } = run(instance, { music: 'auto' });
        const result = await done;
        expect(steps).toContain('music:failed');
        expect(result.soundtrack).toBeNull();
        expect(result.plan).toBeTruthy();
        delete window.NEXUS_DISCOVERY;
    });

    test('nothing found is skipped, which is not the same as never answered', async () => {
        window.NEXUS_DISCOVERY = {
            warm: () => Promise.resolve(),
            forCapability: () => ({ search: () => Promise.resolve([]) }),
        };
        const instance = planner(() => Promise.resolve(planJson()));
        const { steps, done } = run(instance, { music: 'auto' });
        await done;
        expect(steps).toContain('music:skipped');
        expect(steps).not.toContain('music:failed');
        delete window.NEXUS_DISCOVERY;
    });
});

describe('what the screen draws', () => {
    test('a step in progress has its own mark, so slow never looks like stuck', () => {
        // The distinction the frozen screenshot was missing. `…` is the whole point.
        const activity = Playground.attach({ win: window, doc: document });
        activity.sessionState = 'preparing';
        activity.prepareProgress = new Map([
            ['scene', 'done'],
            ['story', 'running'],
        ]);
        const root = document.createElement('div');
        activity._paintPreparing({ doc: document, root });

        const rows = [...root.querySelectorAll('[data-prepare-step]')];
        expect(rows.map((row) => row.dataset.prepareStep)).toEqual(['scene', 'story', 'choices', 'music']);
        expect(rows[0].textContent).toContain('✓');
        expect(rows[1].textContent).toContain('…');
        expect(rows[1].className).toContain('is-running');
        expect(rows[2].textContent).toContain('○');
        activity.detach();
    });

    test('Ready says which story this is rather than claiming the model wrote it', () => {
        const activity = Playground.attach({ win: window, doc: document });
        activity.preparedPlan = JSON.parse(planJson());
        activity.preparedPlan.nodes = JSON.parse(planJson()).nodes;
        activity.musicChoice = 'none';

        activity.preparedFrom = 'model';
        let root = document.createElement('div');
        activity._paintReady({ doc: document, root, startActivity: () => {} });
        expect(root.querySelector('.nexus-story-ready-meta').textContent).not.toContain('Written by the app');

        activity.preparedFrom = 'written';
        root = document.createElement('div');
        activity._paintReady({ doc: document, root, startActivity: () => {} });
        expect(root.querySelector('.nexus-story-ready-meta').textContent).toContain('Written by the app');
        activity.detach();
    });
});

describe('the Ready line, and the loop it used to be able to start', () => {
    const View = require('../../src/features/together/ui/SceneTaleConversationView.js');

    /**
     * `decorateReadyControls` runs from a `childList` observer on `body`, so every write it makes
     * re-enters it. It guarded on `/Story ready/i` but rewrote with a literal `replace`, so any
     * wording the literal did not match left the guard true and the write a no-op — the same
     * string assigned forever, at whatever rate the event loop allowed. It pegged a CPU and the
     * suite never finished.
     *
     * The rule is the one the `Edit setup` line next to it already followed: write only when the
     * value actually changes.
     */
    test('a line it cannot rewrite is left alone rather than rewritten identically', () => {
        const doc = document;
        doc.body.innerHTML = '<div class="nexus-story-ready-meta">About 5 minutes · 2 choices</div>';
        const meta = doc.querySelector('.nexus-story-ready-meta');
        // Any wording outside the literal it knows how to fold.
        meta.textContent = 'About 5 minutes · 2 choices\n✓ Story ready, sort of · ✓ Scene ready · No soundtrack';
        const before = meta.textContent;

        let writes = 0;
        const observer = new MutationObserver(() => (writes += 1));
        observer.observe(meta, { childList: true, characterData: true, subtree: true });
        View.decorateReadyControls(doc);
        observer.disconnect();

        expect(meta.textContent).toBe(before);
        expect(writes).toBe(0);
        doc.body.innerHTML = '';
    });

    test('and the line it does know is folded exactly once', () => {
        const doc = document;
        doc.body.innerHTML = '<div class="nexus-story-ready-meta">✓ Story ready · ✓ Scene ready · No soundtrack</div>';
        const meta = doc.querySelector('.nexus-story-ready-meta');
        View.decorateReadyControls(doc);
        expect(meta.textContent).toBe('Ready to begin · No soundtrack');

        // A second pass is a no-op, which is what makes it safe to run from an observer.
        View.decorateReadyControls(doc);
        expect(meta.textContent).toBe('Ready to begin · No soundtrack');
        doc.body.innerHTML = '';
    });

    test('the provenance clause survives the fold', () => {
        // It sits after the run the view rewrites, so the user still learns which story this is.
        const doc = document;
        doc.body.innerHTML =
            '<div class="nexus-story-ready-meta">✓ Story ready · ✓ Scene ready · No soundtrack · Written by the app</div>';
        View.decorateReadyControls(doc);
        expect(doc.querySelector('.nexus-story-ready-meta').textContent).toBe(
            'Ready to begin · No soundtrack · Written by the app'
        );
        doc.body.innerHTML = '';
    });
});

describe('waking the model, which is not the same as timing it (A23)', () => {
    const Preflight = require('../../src/features/together/PrivatePreflight.js');

    afterEach(() => {
        delete window._nexusLLM;
    });

    test('a provider that lists models is awake, without asking it to write anything', async () => {
        // The reported setup measures a completion at 45 seconds and a model listing at 289ms.
        // No warm-up can wait for the first, and anything shorter paints `✕ Waking the model`
        // over a provider that works. Listing answers all three ways this step can really fail:
        // unreachable, unauthenticated, no models.
        const sendMessage = jest.fn(() => new Promise(() => {}));
        window._nexusLLM = {
            fetchAvailableModels: () => Promise.resolve({ models: ['a', 'b'], error: null }),
            sendMessage,
        };
        // `_probeModel` belongs to Private, whose warm-up screen this is.
        const activity = new Playground.IntimateActivity.Intimate({ win: window, doc: document });
        await expect(activity._probeModel(window)).resolves.toBe(true);
        // The slow question is never asked.
        expect(sendMessage).not.toHaveBeenCalled();
    });

    test('a listing that reports an error is a real failure', async () => {
        window._nexusLLM = {
            fetchAvailableModels: () => Promise.resolve({ models: [], error: 'credential rejected' }),
            sendMessage: () => Promise.resolve('ready'),
        };
        const activity = new Playground.IntimateActivity.Intimate({ win: window, doc: document });
        await expect(activity._probeModel(window)).resolves.toBe(false);
    });

    test('a provider that cannot enumerate still gets asked the slow question', async () => {
        // Some providers offer no listing; for those a completion is the only question available.
        const sendMessage = jest.fn(() => Promise.resolve('ready'));
        window._nexusLLM = { sendMessage };
        const activity = new Playground.IntimateActivity.Intimate({ win: window, doc: document });
        await expect(activity._probeModel(window)).resolves.toBe(true);
        expect(sendMessage).toHaveBeenCalled();
    });

    test('the model step gets a longer budget than the local ones, and the total clears it', () => {
        // The total used to be 10s while the model step was allowed 20s, which made the per-step
        // budget a fiction: the overall valve cut it off first.
        expect(Preflight.budgetFor('model')).toBe(Preflight.MODEL_TIMEOUT_MS);
        expect(Preflight.budgetFor('voice')).toBe(Preflight.STEP_TIMEOUT_MS);
        expect(Preflight.MODEL_TIMEOUT_MS).toBeGreaterThan(Preflight.STEP_TIMEOUT_MS);
        expect(Preflight.TOTAL_TIMEOUT_MS).toBeGreaterThan(Preflight.MODEL_TIMEOUT_MS);
    });
});
