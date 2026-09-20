/**
 * Load the evening before it starts, and tell the truth about it (P20).
 *
 * `Begin →` used to begin immediately and race a hidden 2.5-second budget, so the session started
 * in whatever state the machine happened to be in. The reported log is what that looks like:
 *
 *     speech-service.js  🔊 Loaded 0 voices
 *     speech-service.js  ⚠️ Voices empty; will retry on voiceschanged
 *     …
 *     boot.js            [BD] Behavior Director up in 21362ms
 *
 * Twenty-one seconds of boot with nothing on screen saying so, and a first line spoken before
 * there was a voice to say it in.
 *
 * The rule these pin is the one that makes the screen worth showing: **a step reports what it
 * actually did.** `done` only when the work happened, `skipped` when there was nothing to do, and
 * `failed` when it was tried and did not work. A checklist that ticks things it did not do is
 * worse than no checklist, because it is the same picture whether or not it worked.
 */

/* global describe, test, expect, jest */

const Preflight = require('../../src/features/together/PrivatePreflight.js');

/**
 * Real timers, driven by hand.
 *
 * The module takes every timer through `deps` precisely so a test can own the clock without
 * `jest.useFakeTimers()` fighting the promise microtasks the steps resolve through.
 */
function clock() {
    let now = 0;
    const timeouts = new Map();
    const intervals = new Map();
    let next = 1;
    return {
        now: () => now,
        setTimeout: (fn, ms) => {
            const id = next++;
            timeouts.set(id, { fn, at: now + ms });
            return id;
        },
        clearTimeout: (id) => timeouts.delete(id),
        setInterval: (fn, ms) => {
            const id = next++;
            intervals.set(id, { fn, every: ms, at: now + ms });
            return id;
        },
        clearInterval: (id) => intervals.delete(id),
        /** Move the clock and run whatever is due, then let microtasks drain. */
        async advance(ms) {
            now += ms;
            for (const [id, t] of [...timeouts]) {
                if (t.at <= now) {
                    timeouts.delete(id);
                    t.fn();
                }
            }
            for (const [, t] of [...intervals]) {
                while (t.at <= now) {
                    t.at += t.every;
                    t.fn();
                }
            }
            await Promise.resolve();
            await Promise.resolve();
        },
        live: () => ({ timeouts: timeouts.size, intervals: intervals.size }),
    };
}

/** Everything green, so a test can name only what it is changing. */
function deps(overrides = {}) {
    const c = overrides.clock || clock();
    return {
        now: c.now,
        setTimeout: c.setTimeout,
        clearTimeout: c.clearTimeout,
        setInterval: c.setInterval,
        clearInterval: c.clearInterval,
        speechSynthesis: { getVoices: () => [{ name: 'a voice' }] },
        probeModel: () => Promise.resolve(true),
        storyReady: () => Promise.resolve({ opening: 'a written plan' }),
        sceneReady: () => Promise.resolve(true),
        intentResolves: () => true,
        trackReady: () => Promise.resolve(true),
        ...overrides,
        _clock: c,
    };
}

const byId = (result) => Object.fromEntries(result.list.map((entry) => [entry.id, entry.state]));

describe('the shape of the checklist', () => {
    test('a fresh run is every step pending and nothing claimed', () => {
        const shown = Preflight.describe(Preflight.create());
        expect(shown.list.map((entry) => entry.id)).toEqual([
            'voice',
            'model',
            'story',
            'place',
            'movement',
            'soundtrack',
        ]);
        expect(shown.list.every((entry) => entry.state === 'pending')).toBe(true);
        expect(shown.done).toBe(0);
        expect(shown.ready).toBe(false);
    });

    test('no step is a gate, and none declares itself one (P25)', () => {
        // The first version split these into required and optional, and a failed required step
        // withheld `Begin`. Every reason a step goes red is transient — a slow first request, a
        // cold provider, a 504 in the retry loop — and the cost of being wrong is the whole
        // feature. A warm-up that can refuse to let you in is a second gate, not a warm-up.
        for (const step of Preflight.STEPS) {
            expect(step.required).toBeUndefined();
        }
    });

    test('every step names a locale key, so the screen is not English by construction', () => {
        for (const step of Preflight.STEPS) {
            expect(step.key).toMatch(/^preflight\./);
        }
    });
});

describe('a run where everything works', () => {
    test('reports ready, with every step done', async () => {
        const result = await Preflight.run(deps());
        expect(byId(result)).toEqual({
            voice: 'done',
            model: 'done',
            story: 'done',
            place: 'done',
            movement: 'done',
            soundtrack: 'done',
        });
        expect(result.ready).toBe(true);
        expect(result.outcome).toBe('ready');
        expect(result.failed).toEqual([]);
    });

    test('the screen fills in as the work lands, rather than at the end', async () => {
        // The whole point of showing it. A progress list that arrives complete is a spinner with
        // words on it.
        const seen = [];
        await Preflight.run(deps({ onChange: (shown) => seen.push(shown.done) }));
        expect(seen.length).toBeGreaterThan(1);
        expect(seen[0]).toBe(0);
        expect(seen[seen.length - 1]).toBe(6);
        // Never goes backwards.
        expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    });

    test('a listener that throws does not abandon the remaining steps', async () => {
        const result = await Preflight.run(
            deps({
                onChange: () => {
                    throw new Error('a repaint blew up');
                },
            })
        );
        expect(result.ready).toBe(true);
    });
});

describe('work that was not done is never a tick', () => {
    test('no synthesiser is skipped, not done and not failed', async () => {
        const result = await Preflight.run(deps({ speechSynthesis: null }));
        expect(byId(result).voice).toBe('skipped');
        // Skipped still settles, so the evening is ready.
        expect(result.ready).toBe(true);
    });

    test('no scene chosen is skipped — "keep this place" loads nothing', async () => {
        const result = await Preflight.run(deps({ sceneReady: () => Promise.resolve(null) }));
        expect(byId(result).place).toBe('skipped');
        expect(result.ready).toBe(true);
    });

    test('music turned off is skipped, not a soundtrack that failed to appear', async () => {
        const result = await Preflight.run(deps({ trackReady: () => Promise.resolve(null) }));
        expect(byId(result).soundtrack).toBe('skipped');
        expect(result.ready).toBe(true);
    });

    test('a capability that is absent entirely is skipped everywhere', async () => {
        const result = await Preflight.run({
            ...deps(),
            probeModel: null,
            storyReady: null,
            sceneReady: null,
            intentResolves: null,
            trackReady: null,
        });
        const states = byId(result);
        expect(states.model).toBe('skipped');
        expect(states.story).toBe('skipped');
        expect(states.movement).toBe('skipped');
        expect(result.ready).toBe(true);
    });

    test('some of her movements missing is skipped, none of them is failed', async () => {
        // A missing clip plays nothing, which is the same fail-soft every caller of the intent bus
        // gets — but "none at all" is worth saying, because she would stand still for the evening.
        const some = await Preflight.run(deps({ intentResolves: (name) => name === 'breathe' }));
        expect(byId(some).movement).toBe('skipped');
        const none = await Preflight.run(deps({ intentResolves: () => false }));
        expect(byId(none).movement).toBe('failed');
        // Optional, so it still does not block.
        expect(none.ready).toBe(true);
    });
});

describe('a failure is a line on the summary, never a wall (P25)', () => {
    test('a provider that cannot answer is reported and does not stop anything', async () => {
        // The reported screen: `✕ Waking the model`, and the feature shut, in an app whose
        // provider had answered a minute earlier.
        const result = await Preflight.run(deps({ probeModel: () => Promise.resolve(false) }));
        expect(byId(result).model).toBe('failed');
        expect(result.ready).toBe(true);
        expect(result.outcome).toBe('ready');
        expect(result.failed.map((entry) => entry.id)).toEqual(['model']);
    });

    test('a probe that throws is a failure, not a crash', async () => {
        const result = await Preflight.run(
            deps({
                probeModel: () => {
                    throw new Error('network down');
                },
            })
        );
        expect(byId(result).model).toBe('failed');
        expect(result.ready).toBe(true);
    });

    test('several failures at once still leave it ready', async () => {
        const result = await Preflight.run(
            deps({
                probeModel: () => Promise.resolve(false),
                sceneReady: () => Promise.resolve(false),
                intentResolves: () => false,
            })
        );
        expect(result.failed.map((entry) => entry.id).sort()).toEqual(['model', 'movement', 'place']);
        expect(result.ready).toBe(true);
    });

    test('the reason survives, because "it failed" is not a diagnosis', async () => {
        const result = await Preflight.run(
            deps({ storyReady: () => Promise.reject(new Error('the planner refused')) })
        );
        const story = result.list.find((entry) => entry.id === 'story');
        expect(story.state).toBe('failed');
        expect(story.why).toContain('the planner refused');
    });
});

describe('the voice list, which is empty at boot and is why this exists', () => {
    test('an empty list resolves the moment the voices arrive', async () => {
        const c = clock();
        let voices = [];
        const listeners = [];
        const result = Preflight.run(
            deps({
                clock: c,
                speechSynthesis: {
                    getVoices: () => voices,
                    addEventListener: (name, fn) => listeners.push(fn),
                    removeEventListener: () => {},
                },
            })
        );
        await c.advance(300);
        // Still waiting — nothing has ticked it green.
        voices = [{ name: 'arrived late' }];
        await c.advance(300);
        expect(byId(await result).voice).toBe('done');
    });

    test('and gives up rather than hanging the screen forever', async () => {
        const c = clock();
        const result = Preflight.run(
            deps({
                clock: c,
                speechSynthesis: { getVoices: () => [], addEventListener: () => {}, removeEventListener: () => {} },
            })
        );
        await c.advance(Preflight.STEP_TIMEOUT_MS + 1000);
        const settled = await result;
        expect(byId(settled).voice).toBe('failed');
        // Reported, not blocking (P25).
        expect(settled.ready).toBe(true);
    });

    test('nothing it started outlives it', async () => {
        // A poll left running would keep calling `getVoices` for the rest of the session, and a
        // preflight restarts every time somebody changes the scene on step 2.
        const c = clock();
        const result = Preflight.run(
            deps({
                clock: c,
                speechSynthesis: { getVoices: () => [], addEventListener: () => {}, removeEventListener: () => {} },
            })
        );
        await c.advance(Preflight.STEP_TIMEOUT_MS + 1000);
        await result;
        expect(c.live().intervals).toBe(0);
    });

    test('a pluggable engine that owns its own audio answers first', async () => {
        // Piper plays through WebAudio and has a voice whatever `speechSynthesis` thinks — the same
        // precedence `_replyAudioBusy` uses, for the same reason.
        const result = await Preflight.run(
            deps({
                speechSynthesis: { getVoices: () => [] },
                ttsProvider: { ready: () => true },
            })
        );
        expect(byId(result).voice).toBe('done');
    });

    test('and an engine that throws falls through to the browser list', async () => {
        const result = await Preflight.run(
            deps({
                ttsProvider: {
                    ready() {
                        throw new Error('engine not loaded');
                    },
                },
            })
        );
        expect(byId(result).voice).toBe('done');
    });
});

describe('cancellation, because step 2 restarts this on every change', () => {
    test('a cancelled run reports cancelled and writes no ticks', async () => {
        let live = true;
        const seen = [];
        const result = await Preflight.run(
            deps({
                cancelled: () => !live,
                onChange: (shown) => {
                    seen.push(shown.done);
                    live = false;
                },
            })
        );
        expect(result.outcome).toBe('cancelled');
        // The first report is the all-pending one; nothing after it claims a step.
        expect(Math.max(...seen)).toBe(0);
    });
});

describe('the overall valve', () => {
    test('a step that never settles is reported rather than left spinning', async () => {
        const c = clock();
        const result = Preflight.run(
            deps({
                clock: c,
                // Never resolves, and unlike the voice check it has no deadline of its own.
                probeModel: () => new Promise(() => {}),
            })
        );
        await c.advance(Preflight.TOTAL_TIMEOUT_MS + 1000);
        const settled = await result;
        expect(byId(settled).model).toBe('failed');
        expect(settled.list.every((entry) => entry.state !== 'pending' && entry.state !== 'running')).toBe(true);
    });
});
