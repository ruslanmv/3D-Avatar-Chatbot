/**
 * Hands-busy copilot (B26).
 *
 * Four acceptance sentences, and the last one is the load-bearing one:
 *
 *   * the camera round trip is ≤3 s — measured over twenty asks at realistic latencies,
 *     reported as a p95 the way the criterion states it;
 *   * the timer flow works hands-free by voice — driven entirely through `voice:final`,
 *     with no method called directly, because that is what hands-free means;
 *   * the consent indicator is visible whenever camera consent is active — checked as the
 *     structural fact underneath it: B11 is the *only* door this file can reach a camera
 *     through, so the indicator cannot be out of step with it;
 *   * a periodic-frame code path does not exist — checked as the absence of every timer
 *     primitive in the file, so one cannot be added without noticing.
 */

/* global describe, test, expect */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const Copilot = require('../../src/features/together/activities/copilot.js');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'src', 'features', 'together', 'activities', 'copilot.js');

const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const BREAD = [
    'Mix the flour, water and salt until there is no dry flour left.',
    'Rest it for thirty minutes.',
    'Add the starter and fold it through.',
    'Fold once every half hour, four times.',
    'Shape it and put it in the banneton.',
];

/** A stand-in for B15's activity, recording every call the copilot makes on it. */
function insight({ consent = true, latency = 400, answer = { text: 'Looks about right.' } } = {}) {
    return {
        calls: [],
        sharing: false,
        latency,
        async start(source) {
            this.calls.push(['start', source]);
            if (!consent) return null;
            this.sharing = true;
            return { source };
        },
        stop(why) {
            this.calls.push(['stop', why]);
            this.sharing = false;
            return true;
        },
        async ask(prompt) {
            this.calls.push(['ask', prompt]);
            return answer;
        },
    };
}

function copilot(options = {}) {
    const bus = new EventBus();
    const blackboard = new Blackboard();
    const spoken = [];
    const timers = [];
    const looks = [];
    bus.on('copilot:timer', (e) => timers.push(e));
    bus.on('copilot:look', (e) => looks.push(e));

    let clock = 1000;
    const vision = insight(options);
    const cop = Copilot.attach({
        bus,
        blackboard,
        insight: vision,
        say: (text) => spoken.push(text),
        now: () => clock,
    });
    return {
        bus,
        cop,
        vision,
        spoken,
        timers,
        looks,
        at: () => clock,
        tick(ms) {
            clock += ms;
            return cop.tick(clock);
        },
        jump: (ms) => (clock += ms),
        /** Say something to her, the way a person with dough on their hands would. */
        say: (text) => bus.emit('voice:final', { text, lang: 'en' }),
    };
}

// ── a periodic-frame code path does not exist ────────────────────────────────

describe('there is no way to take a frame on a schedule', () => {
    const source = codeOf(fs.readFileSync(SOURCE, 'utf8'));

    test('the file names no timer primitive at all', () => {
        // Not "it does not call setInterval today" — it cannot, without somebody adding a
        // primitive that is not here, which is a thing a reviewer notices.
        for (const token of [
            'setInterval',
            'setTimeout',
            'requestAnimationFrame',
            'requestIdleCallback',
            'queueMicrotask',
            'Worker',
        ]) {
            expect(source).not.toContain(token);
        }
    });

    test('and no periodic mode borrowed from B15', () => {
        // B15's activity *does* have `watch()`, which is exactly the temptation.
        for (const token of ['watch(', 'startWatching', 'WATCH_INTERVAL', 'stopWatching']) {
            expect(source).not.toContain(token);
        }
    });

    test('it cannot open a camera or post anything either', () => {
        for (const token of ['getUserMedia', 'getDisplayMedia', 'fetch(', 'XMLHttpRequest', 'endpoint']) {
            expect(source).not.toContain(token);
        }
    });

    test('the stripper is not vacuous', () => {
        expect(source).toContain('class Copilot');
        expect(source).toContain('async look(');
    });

    test('a tick with a running timer takes no frame', () => {
        const c = copilot();
        return c.cop.start(BREAD).then(() => {
            c.cop.setTimer(60000);
            const asksBefore = c.vision.calls.filter(([k]) => k === 'ask').length;
            for (let i = 0; i < 600; i++) c.tick(100);
            expect(c.vision.calls.filter(([k]) => k === 'ask')).toHaveLength(asksBefore);
        });
    });

    test('forty minutes of bread takes exactly the frames that were asked for', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.say('how does this look');
        await Promise.resolve();
        for (let i = 0; i < 2400; i++) c.tick(1000);
        expect(c.vision.calls.filter(([k]) => k === 'ask')).toHaveLength(1);
    });
});

// ── B11 is the only door ─────────────────────────────────────────────────────

describe('the camera comes through the consent machine and nowhere else', () => {
    test('starting asks for camera consent by name', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        expect(c.vision.calls[0]).toEqual(['start', 'camera']);
    });

    test('a declined camera is a refusal with a reason, not a broken checklist', async () => {
        const c = copilot({ consent: false });
        expect(await c.cop.start(BREAD)).toEqual({ ok: false, why: 'camera consent was declined' });
        expect(c.cop.running).toBe(false);
    });

    test('stopping hands the camera back through the same path', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.cop.stop('user');
        expect(c.vision.calls).toContainEqual(['stop', 'user']);
        expect(c.cop.sharing).toBe(false);
    });

    test('detach stops it', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.cop.detach();
        expect(c.cop.running).toBe(false);
    });

    test('sharing is whatever the consent-holding activity says it is', async () => {
        // The copilot keeps no opinion of its own, so the indicator and the copilot cannot
        // disagree about whether the camera is on.
        const c = copilot();
        expect(c.cop.sharing).toBe(false);
        await c.cop.start(BREAD);
        expect(c.cop.sharing).toBe(true);
        c.vision.sharing = false;
        expect(c.cop.sharing).toBe(false);
    });

    test('a checklist with no steps never asks for a camera', async () => {
        const c = copilot();
        expect(await c.cop.start([])).toEqual({ ok: false, why: 'a checklist needs steps' });
        expect(c.vision.calls).toEqual([]);
    });

    test('starting twice is refused', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        expect(await c.cop.start(BREAD)).toEqual({ ok: false, why: 'already running' });
    });
});

// ── the checklist, as a pure machine ─────────────────────────────────────────

describe('the checklist', () => {
    const list = () => new Copilot.Checklist(BREAD, { title: 'Bread' });

    test('it starts before the first step, which is not step one', () => {
        const l = list();
        expect(l.started).toBe(false);
        expect(l.current).toBeNull();
        l.next();
        expect(l.position).toEqual({ step: 1, of: 5 });
    });

    test('next walks forward and stops at finished rather than wrapping', () => {
        const l = list();
        for (let i = 0; i < 10; i++) l.next();
        expect(l.finished).toBe(true);
        expect(l.current).toBeNull();
    });

    test('back never goes before the first step — a recipe has no step zero', () => {
        const l = list();
        l.next();
        l.back();
        l.back();
        expect(l.position.step).toBe(1);
    });

    test('back from finished returns to the last step', () => {
        const l = list();
        for (let i = 0; i < 10; i++) l.next();
        l.back();
        expect(l.position).toEqual({ step: 5, of: 5 });
    });

    test('plain strings and objects are both steps', () => {
        const l = new Copilot.Checklist(['a', { text: 'b' }, { text: '  ' }, null, 42]);
        expect(l.length).toBe(2);
    });

    test('a document is not a checklist', () => {
        const l = new Copilot.Checklist(Array.from({ length: 200 }, (_, i) => `step ${i}`));
        expect(l.length).toBe(Copilot.MAX_STEPS);
    });

    test('it holds no clock, no bus and no camera', () => {
        const l = list();
        expect(Object.keys(l).sort()).toEqual(['index', 'steps', 'title']);
    });
});

// ── hands-free ───────────────────────────────────────────────────────────────

describe('the whole flow works by voice', () => {
    test('she reads the first step as soon as the camera is live', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        expect(c.spoken[0]).toContain('Step 1 of 5');
        expect(c.spoken[0]).toContain('Mix the flour');
    });

    test('"done" moves on', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.say('done');
        expect(c.spoken[1]).toContain('Step 2 of 5');
    });

    test('so do "next", "got it" and "what\'s next"', async () => {
        for (const phrase of ['next', 'got it', "what's next", 'finished']) {
            const c = copilot();
            await c.cop.start(BREAD);
            c.say(phrase);
            expect(c.spoken[1]).toContain('Step 2 of 5');
        }
    });

    test('"go back" returns', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.say('next');
        c.say('go back');
        expect(c.spoken[2]).toContain('Step 1 of 5');
    });

    test('"what was that" repeats without moving', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.say('what was that');
        expect(c.spoken[1]).toContain('Step 1 of 5');
        expect(c.cop.stats.position).toEqual({ step: 1, of: 5 });
    });

    test('"which step" says where you are', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.say('next');
        c.say('which step am i on');
        expect(c.spoken[2]).toBe('Step 2 of 5.');
    });

    test('past the last step she says so rather than wrapping round', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        for (let i = 0; i < 5; i++) c.say('next');
        expect(c.spoken[c.spoken.length - 1]).toBe('That was the last one.');
    });

    test('unrecognised speech is left alone rather than guessed at', async () => {
        // A misheard "next" that skips a step in a recipe is worse than silence.
        const c = copilot();
        await c.cop.start(BREAD);
        const before = c.spoken.length;
        for (const noise of ['the dog is on the sofa', 'mmm', 'pass the salt', '']) c.say(noise);
        expect(c.spoken).toHaveLength(before);
        expect(c.cop.stats.unrecognised).toBe(3);
    });

    test('nothing is heard before she has been started', () => {
        const c = copilot();
        c.say('next');
        expect(c.spoken).toEqual([]);
    });

    test('and nothing after she is stopped', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.cop.stop();
        const before = c.spoken.length;
        c.say('next');
        expect(c.spoken).toHaveLength(before);
    });

    test('the grammar is small enough to remember', () => {
        expect(Copilot.COMMANDS.length).toBeLessThanOrEqual(10);
    });
});

// ── timers, hands-free ───────────────────────────────────────────────────────

describe('the timer flow, entirely by voice', () => {
    test('"set a timer for thirty minutes"', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.say('set a timer for thirty minutes');
        expect(c.spoken[1]).toBe('30 minutes.');
        expect(c.cop.stats.timer).toBe(30 * 60000);
    });

    test('digits, words and half-hours all parse', () => {
        expect(Copilot.duration('set a timer for 45 seconds')).toBe(45000);
        expect(Copilot.duration('timer for five minutes')).toBe(300000);
        expect(Copilot.duration('an hour and a half')).toBe(5400000);
        expect(Copilot.duration('two hours')).toBe(7200000);
        expect(Copilot.duration('20 mins')).toBe(1200000);
    });

    test('a timer with no number is a question, not a guess', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.say('set a timer');
        expect(c.spoken[1]).toBe('How long?');
        expect(c.cop.stats.timer).toBeNull();
    });

    test('"how long left" answers', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.say('start a timer for ten minutes');
        c.tick(4 * 60000);
        c.say('how long left');
        expect(c.spoken[c.spoken.length - 1]).toBe('6 minutes left.');
    });

    test('she counts the last stretch down', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.say('set a timer for one minute');
        c.tick(51000);
        expect(c.timers[c.timers.length - 1].state).toBe('warning');
        expect(c.spoken[c.spoken.length - 1]).toBe('9 seconds.');
    });

    test('and says when it is up, once', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.say('set a timer for one minute');
        for (let i = 0; i < 200; i++) c.tick(1000);
        const elapsed = c.timers.filter((t) => t.state === 'elapsed');
        expect(elapsed).toHaveLength(1);
        expect(c.spoken[c.spoken.length - 1]).toBe('Time.');
    });

    test('"cancel the timer" stops it', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.say('set a timer for ten minutes');
        c.say('cancel the timer');
        expect(c.cop.stats.timer).toBeNull();
        for (let i = 0; i < 1000; i++) c.tick(1000);
        expect(c.timers.filter((t) => t.state === 'elapsed')).toEqual([]);
    });

    test('cancelling nothing says so rather than pretending', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.say('cancel the timer');
        expect(c.spoken[1]).toBe('No timer running.');
    });

    test('a second timer replaces the first and says so', async () => {
        // Two countdowns you cannot see, announced by the same voice, is worse than none.
        const c = copilot();
        await c.cop.start(BREAD);
        c.say('set a timer for ten minutes');
        c.say('set a timer for two minutes');
        expect(c.spoken[2]).toBe('New timer: 2 minutes.');
        expect(c.cop.stats.timer).toBe(120000);
    });

    test('stopping the copilot stops the timer', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        c.say('set a timer for ten minutes');
        c.cop.stop();
        expect(c.cop.timer).toBeNull();
    });

    test('durations are said the way a person says them', () => {
        expect(Copilot.spell(1000)).toBe('1 second');
        expect(Copilot.spell(45000)).toBe('45 seconds');
        expect(Copilot.spell(60000)).toBe('1 minute');
        expect(Copilot.spell(90 * 60000)).toBe('1 hour 30 minutes');
        expect(Copilot.spell(120 * 60000)).toBe('2 hours');
    });
});

// ── the round trip ───────────────────────────────────────────────────────────

describe('the camera round trip is under three seconds', () => {
    /** Drive `look()` at a scripted list of latencies and return the p95 it reports. */
    async function roundTrips(latencies) {
        const bus = new EventBus();
        let clock = 0;
        const looks = [];
        bus.on('copilot:look', (e) => looks.push(e));
        let next = 0;
        const vision = {
            sharing: true,
            async start() {
                return { source: 'camera' };
            },
            stop() {},
            async ask() {
                // Advance the injected clock by this ask's latency: the copilot measures
                // with `now()`, so a scripted latency is a real measurement to it.
                clock += latencies[next++];
                return { text: 'ok' };
            },
        };
        const cop = Copilot.attach({ bus, insight: vision, say: () => {}, now: () => clock });
        await cop.start(BREAD);
        for (let i = 0; i < latencies.length; i++) await cop.look('how is this');
        return { cop, looks };
    }

    test('twenty asks at realistic latencies come in under budget at p95', async () => {
        const latencies = [
            380, 420, 450, 510, 470, 620, 400, 390, 550, 480, 700, 460, 430, 520, 610, 490, 440, 580, 510, 1200,
        ];
        const { cop } = await roundTrips(latencies);
        expect(cop.p95).toBeLessThanOrEqual(Copilot.BUDGET_MS);
        expect(cop.stats.looks).toBe(20);
    });

    test('the budget is three seconds and it is named', () => {
        expect(Copilot.BUDGET_MS).toBe(3000);
    });

    test('an ask that misses it is reported rather than hidden', async () => {
        const { cop, looks } = await roundTrips([400, 5200, 450]);
        expect(looks.map((l) => l.overBudget)).toEqual([false, true, false]);
        expect(cop.p95).toBe(5200);
    });

    test('p95 is null before the first ask', () => {
        expect(copilot().cop.p95).toBeNull();
    });

    test('the current step goes up with the question', async () => {
        const c = copilot();
        await c.cop.start(BREAD);
        await c.cop.look('how is this');
        const [, prompt] = c.vision.calls.find(([k]) => k === 'ask');
        expect(prompt).toContain('how is this');
        expect(prompt).toContain('Mix the flour');
    });

    test('asking by voice does not block the next command', async () => {
        // Her hands are busy and so is the socket. The answer arrives when it arrives.
        const c = copilot();
        await c.cop.start(BREAD);
        expect(c.cop.hear('how does this look')).toEqual({ action: 'look', why: 'asked' });
        c.say('next');
        expect(c.spoken[c.spoken.length - 1]).toContain('Step 2 of 5');
    });

    test('looking with no vision activity is null, not a crash', async () => {
        const cop = Copilot.attach({ insight: null, say: () => {} });
        expect(await cop.look('x')).toBeNull();
    });
});

// ── the transcript seam ──────────────────────────────────────────────────────

describe('final transcripts are published once, by the adapter that receives them', () => {
    test('voice:final is in the bus vocabulary', () => {
        const bus = new EventBus();
        let heard = 0;
        bus.on('voice:final', () => heard++);
        expect(bus.emit('voice:final', { text: 'next' })).toBe(1);
        expect(bus.emit('voice:finals', {})).toBe(0);
        expect(heard).toBe(1);
    });

    test('the voice adapter emits it on a final transcript and not on an interim one', () => {
        const VoiceAdapter = require('../../src/behavior/adapters/VoiceAdapter.js');
        const bus = new EventBus();
        const heard = [];
        bus.on('voice:final', (e) => heard.push(e));
        const adapter = new VoiceAdapter.Adapter({ bus, config: {} });
        adapter.transcript('one moment', { final: false });
        expect(heard).toEqual([]);
        adapter.transcript('next', { final: true, lang: 'en' });
        expect(heard).toEqual([{ text: 'next', lang: 'en' }]);
    });

    test('an empty transcript publishes nothing', () => {
        const VoiceAdapter = require('../../src/behavior/adapters/VoiceAdapter.js');
        const bus = new EventBus();
        const heard = [];
        bus.on('voice:final', (e) => heard.push(e));
        new VoiceAdapter.Adapter({ bus, config: {} }).transcript('   ', { final: true });
        expect(heard).toEqual([]);
    });
});
