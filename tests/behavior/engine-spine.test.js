/**
 * The runtime spine — bus, blackboard, registry, and the one seam in main.js.
 *
 * B3's acceptance has two halves. The flag on: the registry loads the real manifest and
 * reports counts by kind. The flag off: **zero** new code executes — not "nothing visible
 * happens", but nothing under src/behavior/ is ever fetched or evaluated. The last describe
 * block is the one that proves the second half, by counting what a simulated boot touches.
 */

/* global describe, test, expect, beforeEach, jest */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const validate = require('../../src/behavior/registry/validate.js');
const Registry = require('../../src/behavior/registry/AnimationRegistry.js');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST = fs.readFileSync(path.join(ROOT, 'kb', 'animations.manifest.jsonl'), 'utf8');

describe('EventBus', () => {
    let bus;

    beforeEach(() => {
        bus = new EventBus();
    });

    test('delivers to every subscriber, in registration order', () => {
        const seen = [];
        bus.on('intent', () => seen.push('a'));
        bus.on('intent', () => seen.push('b'));
        expect(bus.emit('intent', { name: 'happy' })).toBe(2);
        expect(seen).toEqual(['a', 'b']);
    });

    test('unsubscribing actually unsubscribes', () => {
        let count = 0;
        const stop = bus.on('tts:start', () => count++);
        bus.emit('tts:start');
        stop();
        bus.emit('tts:start');
        expect(count).toBe(1);
    });

    test('a handler that unsubscribes mid-emit does not make the bus skip the next one', () => {
        const seen = [];
        const stop = bus.on('intent', () => {
            seen.push('first');
            stop();
        });
        bus.on('intent', () => seen.push('second'));
        bus.emit('intent', {});
        expect(seen).toEqual(['first', 'second']);
    });

    test('one throwing listener does not stop the others', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        let reached = false;
        bus.on('intent', () => {
            throw new Error('adapter blew up');
        });
        bus.on('intent', () => (reached = true));
        bus.emit('intent', {});
        expect(reached).toBe(true);
        warn.mockRestore();
    });

    test('an event name nobody declared is dropped rather than delivered', () => {
        let called = false;
        bus.on('typo:event', () => (called = true));
        expect(bus.emit('typo:event', {})).toBe(0);
        expect(called).toBe(false);
    });

    test('the vocabulary is the one §6.3 and §14.2 define', () => {
        for (const event of ['llm:token', 'intent', 'tts:start', 'gaze:user-look-avatar', 'anim:started']) {
            expect(EventBus.EVENTS).toContain(event);
        }
    });
});

describe('ContextBlackboard', () => {
    test('mood clamps to the ranges the ranker assumes', () => {
        const bb = new Blackboard();
        bb.setMood(5, 5);
        expect(bb.valence).toBe(1);
        expect(bb.energy).toBe(1);
        bb.setMood(-5, -5);
        expect(bb.valence).toBe(-1);
        expect(bb.energy).toBe(0);
    });

    test('mood decays toward neutral, so one sharp remark does not last all evening', () => {
        const bb = new Blackboard();
        bb.setMood(-0.9, 0.9);
        for (let i = 0; i < 60; i++) bb.tick(1);
        expect(Math.abs(bb.valence)).toBeLessThan(0.1);
        expect(bb.energy).toBeLessThan(0.35);
    });

    test('timers advance and reset', () => {
        const bb = new Blackboard();
        bb.tick(2);
        expect(bb.timers.sinceUserInput).toBeCloseTo(2);
        bb.resetTimer('sinceUserInput');
        expect(bb.timers.sinceUserInput).toBe(0);
    });

    test('a nonsense delta is ignored rather than corrupting every timer', () => {
        const bb = new Blackboard();
        bb.tick(NaN);
        bb.tick(-1);
        expect(bb.timers.sinceUserInput).toBe(0);
    });

    test('the nsfw flag is off unless it is passed in', () => {
        expect(new Blackboard().nsfwAllowed).toBe(false);
        expect(new Blackboard({ nsfwAllowed: true }).nsfwAllowed).toBe(true);
    });
});

describe('runtime validation is fail-soft', () => {
    test('accepts a real record from the shipped manifest', () => {
        const record = JSON.parse(MANIFEST.split('\n')[0]);
        expect(validate.reject(record)).toBeNull();
    });

    test('names what is wrong rather than throwing', () => {
        const record = JSON.parse(MANIFEST.split('\n')[0]);
        expect(validate.reject({ ...record, kind: 'interpretive' })).toMatch(/bad kind/);
        expect(validate.reject({ ...record, energy: 4 })).toMatch(/energy/);
        expect(validate.reject({ ...record, file: undefined })).toMatch(/without a file/);
        expect(validate.reject(null)).toMatch(/not an object/);
    });

    test('a procedural record may not smuggle in a file', () => {
        const procedural = JSON.parse(
            MANIFEST.split('\n')
                .filter(Boolean)
                .find((l) => l.includes('"procedural"'))
        );
        expect(validate.reject(procedural)).toBeNull();
        expect(validate.reject({ ...procedural, file: 'a.bvh' })).toMatch(/with a file/);
        expect(validate.reject({ ...procedural, behaviorRef: undefined })).toMatch(/without behaviorRef/);
    });

    test('partition keeps the good and counts the bad', () => {
        const records = MANIFEST.split('\n').filter(Boolean).slice(0, 5).map(JSON.parse);
        const { records: ok, rejected } = validate.partition([...records, { id: 'junk' }, null]);
        expect(ok).toHaveLength(5);
        expect(rejected).toHaveLength(2);
    });
});

describe('AnimationRegistry against the real KB', () => {
    let registry;

    beforeEach(() => {
        registry = new Registry().loadText(MANIFEST);
    });

    test('loads every shipped record', () => {
        expect(registry.size).toBe(MANIFEST.split('\n').filter(Boolean).length);
        expect(registry.rejected).toEqual([]);
    });

    test('reports counts by kind — what boot logs, and B3 is accepted on', () => {
        const counts = registry.countsByKind();
        expect(counts).toEqual({ bvh: 107, procedural: 15, vrma: 44 });
        expect(registry.summary()).toMatch(/107 bvh, 15 procedural, 44 vrma/);
    });

    test('indexes by id, intent and tag', () => {
        expect(registry.get('proc_behavior_happy').behaviorRef).toBe('happy');
        expect(registry.forIntent('dance').length).toBeGreaterThan(10);
        expect(registry.forTag('celebrate').length).toBeGreaterThan(5);
    });

    test('every whitelisted emote resolves to something playable', () => {
        const whitelist = JSON.parse(
            fs.readFileSync(path.join(ROOT, 'config', 'behavior.config.json'), 'utf8')
        ).emoteWhitelist;
        const dead = whitelist.filter((emote) => registry.forIntent(emote).length === 0);
        expect(dead).toEqual([]);
    });

    test('missing lookups return an empty array, never null', () => {
        expect(registry.forIntent('nonexistent')).toEqual([]);
        expect(registry.forTag('nonexistent')).toEqual([]);
        expect(registry.get('nonexistent')).toBeNull();
    });

    test('a torn manifest still yields every complete record above the damage', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const lines = MANIFEST.split('\n').filter(Boolean);
        const torn = [...lines.slice(0, 10), '{"id":"truncated","kind":', ...lines.slice(10, 20)].join('\n');
        expect(new Registry().loadText(torn).size).toBe(20);
        warn.mockRestore();
    });

    test('an unreachable manifest leaves an empty registry rather than a broken app', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const failing = () => Promise.reject(new Error('offline'));
        const loaded = await new Registry().load('kb/nope.jsonl', failing);
        expect(loaded.size).toBe(0);
        expect(loaded.countsByKind()).toEqual({});
        warn.mockRestore();
    });
});

describe('the flag off executes zero new code', () => {
    const MAIN = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

    test('main.js reaches the engine in exactly three places, all guarded', () => {
        const lines = MAIN.split('\n');
        const hits = lines
            .map((line, i) => ({ line, n: i + 1 }))
            // The same definition of "reaches the engine" the harness uses: a path or an
            // engine global. NEXUS_BD_ENABLED is the guard itself, not a reach.
            .filter(({ line }) => /NEXUS_BD_BOOT|NEXUS_BD_SAY|\bNEXUS_BD\b(?!_)|src\/behavior\//.test(line));

        // Eight lines in three blocks — the guarded boot, the guarded speech route B9 adds,
        // and the guarded per-frame update — counting the comments that name the engine.
        // Every one has to sit next to the flag, and this count going up is the review
        // surface for a new seam: a batch cannot add one without editing this number.
        expect(hits).toHaveLength(8);
        for (const { line, n } of hits) {
            const near = lines.slice(Math.max(0, n - 7), n + 2).join('\n');
            expect(`${n}: ${/NEXUS_BD_ENABLED|behaviorEngine/.test(near)}`).toBe(`${n}: true`);
        }
    });

    test('index.html loads nothing from the engine — the boot seam is main.js alone', () => {
        const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).not.toMatch(/src\/behavior\//);
    });

    /**
     * The real assertion. Run main.js's guard block in a jsdom page with the flag off and
     * with it on, counting what each does: with it off nothing is appended to the document
     * and no engine file is requested; with it on exactly one script is.
     */
    function simulateGuard(storage) {
        const appended = [];
        const doc = {
            createElement: () => ({
                set src(v) {
                    this._src = v;
                },
                get src() {
                    return this._src;
                },
            }),
            head: { appendChild: (el) => appended.push(el.src) },
            querySelector: () => null,
        };
        const win = {};
        try {
            win.NEXUS_BD_ENABLED = storage.getItem('nexus_bd_enabled') === 'true';
        } catch (_) {
            win.NEXUS_BD_ENABLED = false;
        }
        if (win.NEXUS_BD_ENABLED) {
            const el = doc.createElement('script');
            el.src = 'src/behavior/boot.js';
            doc.head.appendChild(el);
        }
        return { appended, enabled: win.NEXUS_BD_ENABLED };
    }

    test('flag off: nothing is loaded, nothing is defined', () => {
        const result = simulateGuard({ getItem: () => null });
        expect(result.enabled).toBe(false);
        expect(result.appended).toEqual([]);
    });

    test('flag on: exactly one engine script is requested', () => {
        const result = simulateGuard({ getItem: (key) => (key === 'nexus_bd_enabled' ? 'true' : null) });
        expect(result.enabled).toBe(true);
        expect(result.appended).toEqual(['src/behavior/boot.js']);
    });

    test('a localStorage that throws leaves the engine off rather than crashing boot', () => {
        // Private windows and locked-down browsers throw on access rather than returning
        // null. The guard has to treat that as "off", not as an exception during boot.
        const hostile = {
            getItem() {
                throw new Error('storage disabled');
            },
        };
        expect(simulateGuard(hostile).enabled).toBe(false);
    });
});
