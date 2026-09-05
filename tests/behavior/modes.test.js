/**
 * Modes (B7).
 *
 * Two acceptance criteria, both about not losing anything: switching modes and switching
 * back restores companion *exactly*, and showcase cycles the full KB.
 */

/* global describe, test, expect, beforeEach */

const fs = require('fs');
const path = require('path');

const Registry = require('../../src/behavior/registry/AnimationRegistry.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const EventBus = require('../../src/behavior/EventBus.js');
const { Manager } = require('../../src/behavior/modes/ModeManager.js');
const { Ranker } = require('../../src/behavior/selector/UtilityRanker.js');
const companion = require('../../src/behavior/modes/companion.profile.js');
const together = require('../../src/behavior/modes/together.profile.js');
const showcase = require('../../src/behavior/modes/showcase.profile.js');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST = fs.readFileSync(path.join(ROOT, 'kb', 'animations.manifest.jsonl'), 'utf8');

let registry;
let bb;
let bus;
let modes;

beforeEach(() => {
    registry = new Registry().loadText(MANIFEST);
    bb = new Blackboard();
    bus = new EventBus();
    modes = new Manager({ blackboard: bb, bus, registry }).register(companion).register(together).register(showcase);
    modes.activate('companion');
});

describe('switching back restores companion exactly', () => {
    test('a round trip leaves the blackboard byte-identical', () => {
        const before = JSON.stringify(bb.snapshot());
        modes.activate('together');
        expect(JSON.stringify(bb.snapshot())).not.toBe(before);
        modes.deactivate();
        expect(JSON.stringify(bb.snapshot())).toBe(before);
        expect(modes.activeId).toBe('companion');
    });

    test('ten round trips do not drift', () => {
        const before = JSON.stringify(bb.snapshot());
        for (let i = 0; i < 10; i++) {
            modes.activate('together');
            modes.activate('showcase');
            modes.deactivate();
            modes.deactivate();
        }
        expect(JSON.stringify(bb.snapshot())).toBe(before);
        expect(modes.activeId).toBe('companion');
    });

    test('restore is a snapshot, so a field added later is covered without being listed', () => {
        // The reason this is not implemented as "undo each change": a new profile field
        // would need a matching undo, and the one nobody adds is the one that drifts.
        bb.mode = { ...companion, experimentalFutureField: 'set by some later batch' };
        const before = JSON.stringify(bb.mode);
        modes.activate('together');
        modes.deactivate();
        expect(JSON.stringify(bb.mode)).toBe(before);
    });

    test('mode:changed is announced on the way in and on the way out', () => {
        const seen = [];
        bus.on('mode:changed', (e) => seen.push(e.id));
        modes.activate('together');
        modes.deactivate();
        expect(seen).toEqual(['together', 'companion']);
    });

    test('activating the mode already active is a no-op, not a second push', () => {
        modes.activate('together');
        modes.activate('together');
        modes.deactivate();
        expect(modes.activeId).toBe('companion');
    });

    test('an unknown mode is refused rather than half-applied', () => {
        const before = JSON.stringify(bb.snapshot());
        expect(modes.activate('nonexistent')).toBe(false);
        expect(JSON.stringify(bb.snapshot())).toBe(before);
    });

    test('a mode that requires something unmet is refused — the B29 path', () => {
        modes.register({ id: 'adult', label: 'Adult', requires: ['adultVerified'], allowNsfw: true });
        expect(modes.activate('adult')).toBe(false);
        bb.adultVerified = true;
        expect(modes.activate('adult')).toBe(true);
    });
});

describe('a mode narrows, it never opens', () => {
    test('together refuses a clip that would walk her out of joint attention', () => {
        const travels = registry.records.find((r) => (r.stats.rootMotion || 0) > 0.8);
        expect(companion.allows(travels)).toBe(true);
        expect(together.allows(travels)).toBe(false);
    });

    test('showcase never unlocks the adult tier, whatever the user setting says', () => {
        const ranker = new Ranker({ random: () => 0 });
        bb.nsfwAllowed = true;
        modes.activate('showcase');
        const nsfw = registry.records.find((r) => r.nsfw);
        expect(ranker.score(nsfw, { name: 'flirt', source: 'user' }, bb)).toBe(-Infinity);
    });

    test('the mode reaches the ranker through the blackboard, not a second path', () => {
        modes.activate('together');
        expect(bb.mode.id).toBe('together');
        expect(typeof bb.mode.allows).toBe('function');
    });
});

describe('showcase cycles the full KB', () => {
    test('every safe record, exactly once per lap', () => {
        modes.activate('showcase');
        const cycler = modes.cycler('showcase');
        const expected = registry.records.filter((r) => !r.nsfw).length;
        expect(cycler.total).toBe(expected);

        const seen = new Set();
        for (let i = 0; i < cycler.total; i++) seen.add(cycler.next().id);
        expect(seen.size).toBe(expected);
        expect(cycler.remaining).toBe(0);
    });

    test('it wraps rather than stopping — a demo runs until someone stops it', () => {
        modes.activate('showcase');
        const cycler = modes.cycler('showcase');
        const first = cycler.next().id;
        for (let i = 1; i < cycler.total; i++) cycler.next();
        expect(cycler.next().id).toBe(first);
    });

    test('the order is stable, so two QA passes can be compared', () => {
        modes.activate('showcase');
        const a = [];
        const b = [];
        const one = modes.cycler('showcase');
        const two = modes.cycler('showcase');
        for (let i = 0; i < 20; i++) {
            a.push(one.next().id);
            b.push(two.next().id);
        }
        expect(a).toEqual(b);
    });

    test('the experimental clips are included — surfacing them is the point', () => {
        modes.activate('showcase');
        const cycler = modes.cycler('showcase');
        const ids = [];
        for (let i = 0; i < cycler.total; i++) ids.push(cycler.next().id);
        const experimental = registry.records.filter((r) => r.quality === 'experimental');
        for (const record of experimental) expect(ids).toContain(record.id);
    });

    test('no adult content in a mode that runs in front of whoever walks past', () => {
        modes.activate('showcase');
        const cycler = modes.cycler('showcase');
        for (let i = 0; i < cycler.total; i++) expect(cycler.next().nsfw).toBe(false);
    });
});

describe('publishing a pose to the KB (UC-11)', () => {
    const publisher = require('../../src/behavior/registry/PosePublisher.js');

    /** A localStorage that lives only for one test. */
    function memoryStorage() {
        const map = new Map();
        return {
            getItem: (k) => (map.has(k) ? map.get(k) : null),
            setItem: (k, v) => map.set(k, v),
        };
    }

    test('a saved pose becomes a valid KB record', () => {
        const storage = memoryStorage();
        const result = publisher.publish({ id: 'my-lean', name: 'My Lean' }, { storage });
        expect(result.ok).toBe(true);
        expect(result.record.kind).toBe('pose');
        expect(result.record.id).toBe('pose_user_my_lean');
        expect(publisher.published({ storage })).toHaveLength(1);
    });

    test('it is selectable by the same brain, immediately', () => {
        const storage = memoryStorage();
        const { record } = publisher.publish({ id: 'wave-high', name: 'Wave High' }, { storage, intents: ['wave'] });
        expect(registry.addRecord(record)).toBe(true);
        expect(registry.forIntent('wave').map((r) => r.id)).toContain(record.id);
        expect(registry.get(record.id).kind).toBe('pose');
    });

    test('republishing the same pose replaces it rather than duplicating it', () => {
        const storage = memoryStorage();
        publisher.publish({ id: 'x', name: 'First' }, { storage });
        publisher.publish({ id: 'x', name: 'Second' }, { storage });
        const stored = publisher.published({ storage });
        expect(stored).toHaveLength(1);
        expect(stored[0].description).toMatch(/Second/);
    });

    test('a published pose can never be adult content', () => {
        const storage = memoryStorage();
        const { record } = publisher.publish({ id: 'p', name: 'P' }, { storage, tags: ['intimate'] });
        expect(record.nsfw).toBe(false);
    });

    test('ids are namespaced, so a user pose cannot shadow a shipped clip', () => {
        const storage = memoryStorage();
        const { record } = publisher.publish({ id: 'bvh_emotion_joy', name: 'Not Joy' }, { storage });
        expect(record.id).toBe('pose_user_bvh_emotion_joy');
        expect(registry.get('bvh_emotion_joy').kind).toBe('bvh');
    });

    test('a malformed pose is refused rather than stored', () => {
        const storage = memoryStorage();
        expect(publisher.publish(null, { storage }).ok).toBe(false);
        expect(publisher.published({ storage })).toEqual([]);
    });

    test('storage that refuses is survivable', () => {
        const hostile = {
            getItem: () => null,
            setItem() {
                throw new Error('quota');
            },
        };
        expect(publisher.publish({ id: 'x', name: 'X' }, { storage: hostile }).ok).toBe(false);
    });
});
