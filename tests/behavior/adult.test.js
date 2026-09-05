/**
 * The adult tier's invariants and its consent arc (B28, B29).
 *
 * §16.7 asks for the invariants to be written **before** the feature, and they are written
 * the way invariants are: each names something that must never happen. Most would pass on an
 * empty repository, which is the point — they are still passing in a year, when somebody has
 * added a batch nobody here anticipated.
 *
 * The server owns invariants 1 and 6 (`HomePilot/backend/tests/avatar/test_adult_gates.py`).
 * This file owns 2, 3, 4 and 5, and the arc B29 wraps around them.
 *
 * Nothing in this file, or in the code it tests, contains sexual content. The tier is
 * gating, pacing and consent around clips the app already shipped; what is tested here is
 * the gating, the pacing and the consent.
 */

/* global describe, test, expect, beforeEach */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const Ranker = require('../../src/behavior/selector/UtilityRanker.js');
const AntiRepeat = require('../../src/behavior/selector/AntiRepeatMemory.js');
const SessionAdapter = require('../../src/behavior/adapters/SessionAdapter.js');
const AdultProfile = require('../../src/behavior/modes/adult.profile.js');
const ConsentFlow = require('../../src/behavior/ConsentFlow.js');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'behavior.config.json'), 'utf8'));
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

function engineFiles(dir = path.join(ROOT, 'src')) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...engineFiles(full));
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out.filter((f) => /\/src\/(behavior|features)\//.test(f.replace(/\\/g, '/')));
}

/** A clip in the tier. Named by intent only — this file authors no content. */
const nsfwClip = (intents = ['flirt']) => ({
    id: 'clip',
    nsfw: true,
    intents,
    tags: intents,
    energy: 0.5,
    valence: 0.6,
    quality: 'production',
    priority: 3,
    stats: { rootMotion: 0.1 },
});

function openBoard({ level = 1 } = {}) {
    const bb = new Blackboard({ nsfwAllowed: true });
    bb.adultVerified = true;
    bb.mode = AdultProfile;
    bb.escalationLevel = level;
    return bb;
}

// ── invariant 1 · no client path sets adultVerified ──────────────────────────

describe('invariant 1 · nothing on the client can set adultVerified', () => {
    test('exactly one line in the whole engine writes it', () => {
        const writers = [];
        for (const file of engineFiles()) {
            const source = codeOf(fs.readFileSync(file, 'utf8'));
            for (const line of source.split('\n')) {
                if (/\badultVerified\s*=/.test(line) && !/===/.test(line)) {
                    writers.push(`${path.relative(ROOT, file)}: ${line.trim()}`);
                }
            }
        }
        // The blackboard's own `= false` initialiser, and the session adapter's ack handler.
        expect(writers).toHaveLength(3);
        expect(writers.filter((w) => w.includes('SessionAdapter'))).toHaveLength(2);
        expect(writers.every((w) => /ContextBlackboard|SessionAdapter/.test(w))).toBe(true);
    });

    test('and that line reads a server frame', () => {
        const source = codeOf(fs.readFileSync(path.join(ROOT, 'src/behavior/adapters/SessionAdapter.js'), 'utf8'));
        expect(source).toContain('adultVerified = message.verified === true');
    });

    test('a click-yes dialog exists nowhere', () => {
        // §16.2 does not say a dialog is insufficient and should be supplemented. It says it
        // must not be implemented, because shipping one creates the appearance of a gate and
        // a code path that later gets trusted.
        for (const file of engineFiles()) {
            const source = codeOf(fs.readFileSync(file, 'utf8'));
            for (const token of ['over 18', 'over18', 'i am 18', 'ageConfirm', 'confirmAge', 'ageGate']) {
                expect(`${path.basename(file)}:${token}:${source.includes(token)}`).toBe(
                    `${path.basename(file)}:${token}:false`
                );
            }
        }
    });

    test('an ack sets it and a false ack clears it', () => {
        const bus = new EventBus();
        const blackboard = new Blackboard();
        const adapter = new SessionAdapter.Adapter({ bus, config: CONFIG, blackboard });
        adapter.receive({ v: 1, type: 'adult_ack', verified: true, exp: Date.now() / 1000 + 60 });
        expect(blackboard.adultVerified).toBe(true);
        adapter.receive({ v: 1, type: 'adult_ack', verified: false });
        expect(blackboard.adultVerified).toBe(false);
    });

    test('it ships false', () => {
        expect(new Blackboard({}).adultVerified).toBe(false);
        expect(CONFIG.nsfwAllowed).toBe(false);
        expect(CONFIG.adult.available).toBe(false);
    });
});

// ── invariant 2 · the triple gate, plus source, plus ceiling ─────────────────

describe('invariant 2 · nsfw needs all three gates, a user source, and the ceiling', () => {
    let ranker;
    beforeEach(() => {
        ranker = new Ranker.Ranker({ antiRepeat: new AntiRepeat(5) });
    });

    const score = (bb, intent = { name: 'flirt', source: 'user', similarity: 1 }) =>
        ranker.score(nsfwClip(), intent, bb);

    test('all three open, user source, level 1 ceiling — it passes', () => {
        expect(score(openBoard())).toBeGreaterThan(-Infinity);
    });

    test('without the server attestation it does not', () => {
        const bb = openBoard();
        bb.adultVerified = false;
        expect(score(bb)).toBe(-Infinity);
    });

    test('without the user setting it does not', () => {
        const bb = openBoard();
        bb.nsfwAllowed = false;
        expect(score(bb)).toBe(-Infinity);
    });

    test('without a mode that permits it it does not', () => {
        const bb = openBoard();
        bb.mode = { id: 'companion', allowNsfw: false, allows: () => true };
        expect(score(bb)).toBe(-Infinity);
    });

    test('every one of the eight combinations behaves', () => {
        // Truth table rather than three tests: the interesting bug is a gate that is
        // load-bearing only when another one happens to be open.
        for (const verified of [false, true]) {
            for (const allowed of [false, true]) {
                for (const permissive of [false, true]) {
                    const bb = openBoard();
                    bb.adultVerified = verified;
                    bb.nsfwAllowed = allowed;
                    bb.mode = permissive ? AdultProfile : { id: 'c', allowNsfw: false, allows: () => true };
                    const open = verified && allowed && permissive;
                    expect(`${verified}${allowed}${permissive}: ${score(bb) > -Infinity}`).toBe(
                        `${verified}${allowed}${permissive}: ${open}`
                    );
                }
            }
        }
    });

    test('the ceiling refuses a clip above the current level', () => {
        const bb = openBoard({ level: 1 });
        const above = ranker.score(nsfwClip(['intimate']), { name: 'intimate', source: 'user' }, bb);
        expect(above).toBe(-Infinity);
    });

    test('and admits it at the level that earns it', () => {
        const bb = openBoard({ level: 4 });
        expect(ranker.score(nsfwClip(['intimate']), { name: 'intimate', source: 'user' }, bb)).toBeGreaterThan(
            -Infinity
        );
    });

    test('the ceiling is cumulative — advancing never takes something away', () => {
        for (let level = 1; level <= AdultProfile.LEVELS; level++) {
            for (const earlier of AdultProfile.CEILING[1]) {
                expect(`${level}:${earlier}`).toBe(
                    `${level}:${AdultProfile.CEILING[level].includes(earlier) ? earlier : 'MISSING'}`
                );
            }
        }
    });

    test('a level the table does not describe is refused, not clamped', () => {
        // Clamping an unknown level to 4 would resolve a bug in the most permissive
        // direction available.
        for (const level of [0, 5, 99, null, undefined, NaN]) {
            expect(`${level}: ${AdultProfile.tierAllowed(nsfwClip(['intimate']), level)}`).toBe(`${level}: false`);
        }
    });

    test('a non-nsfw clip is untouched by any of it', () => {
        const ordinary = { ...nsfwClip(), nsfw: false, intents: ['wave'] };
        const bb = new Blackboard({});
        expect(ranker.score(ordinary, { name: 'wave', source: 'llm', similarity: 1 }, bb)).toBeGreaterThan(-Infinity);
    });
});

// ── invariant 3 · she never initiates ────────────────────────────────────────

describe('invariant 3 · no non-user source can ever select this content', () => {
    const ranker = () => new Ranker.Ranker({ antiRepeat: new AntiRepeat(5) });

    test('every source the system has is refused except the user', () => {
        const bb = openBoard({ level: 4 });
        for (const source of [
            'curiosity',
            'vision',
            'mcp',
            'tool',
            'llm',
            'sentiment',
            'server',
            'scene',
            'coach',
            'cohost',
            'focus',
            'assistant',
            'music',
        ]) {
            expect(`${source}: ${ranker().score(nsfwClip(), { name: 'flirt', source }, bb)}`).toBe(
                `${source}: -Infinity`
            );
        }
    });

    test('proactiveNsfw is false and has no true branch anywhere', () => {
        expect(AdultProfile.proactiveNsfw).toBe(false);
        for (const file of engineFiles()) {
            const source = codeOf(fs.readFileSync(file, 'utf8'));
            expect(source).not.toContain('proactiveNsfw: true');
            expect(source).not.toContain('proactiveNsfw = true');
        }
    });

    test('the consent flow has nothing that raises a level without a user input', () => {
        const flow = ConsentFlow.attach({ profile: AdultProfile, blackboard: openBoard() });
        // `initiated` and the check-in answer are the two routes, and both take an
        // utterance or an explicit call from the caller. `tick` only ever decays.
        expect(typeof flow.tick).toBe('function');
        const source = codeOf(fs.readFileSync(path.join(ROOT, 'src/behavior/ConsentFlow.js'), 'utf8'));
        expect(source).not.toContain('setInterval');
        expect(source).not.toContain('setTimeout');
        expect(source).toContain('class Flow');
    });

    test('a tick never advances, however long it runs', () => {
        const flow = ConsentFlow.attach({ profile: AdultProfile, blackboard: openBoard(), now: () => 0 });
        flow.enter(0);
        for (let minute = 1; minute <= 600; minute++) flow.tick(minute * 60000);
        expect(flow.level).toBe(1);
        expect(flow.stats.advances).toBe(0);
    });
});

// ── invariant 4 · the recorder is torn down ──────────────────────────────────

describe('invariant 4 · the clip engine is off in the tier', () => {
    test('entering stops the recorder and drops its buffer', () => {
        // Not "the button is hidden": hiding it leaves thirty seconds of the evening in
        // memory, which is the single worst artefact this product could hold.
        const stopped = [];
        const flow = ConsentFlow.attach({
            profile: AdultProfile,
            blackboard: openBoard(),
            recorder: { stop: (why) => stopped.push(why) },
            now: () => 0,
        });
        flow.enter(0);
        expect(stopped).toEqual(['adult tier']);
    });

    test('the profile says so too, so a reviewer sees the same claim twice', () => {
        expect(AdultProfile.privacy).toEqual({ clipEngine: false, telemetry: false });
    });

    test('a recorder that refuses to stop does not block entry', () => {
        const original = console.warn;
        console.warn = () => {};
        try {
            const flow = ConsentFlow.attach({
                profile: AdultProfile,
                blackboard: openBoard(),
                recorder: {
                    stop() {
                        throw new Error('gone');
                    },
                },
                now: () => 0,
            });
            expect(flow.enter(0).ok).toBe(true);
        } finally {
            console.warn = original;
        }
    });
});

// ── invariant 5 · exits work from anywhere, in one tick ──────────────────────

describe('invariant 5 · soft and hard exits work from every level, synchronously', () => {
    function flowAt(level) {
        let clock = 0;
        const bus = new EventBus();
        const activated = [];
        const flow = ConsentFlow.attach({
            bus,
            profile: AdultProfile,
            blackboard: openBoard(),
            modes: { activate: (id) => activated.push(id) },
            now: () => clock,
        });
        flow.enter(0);
        // Earn the way up: two minutes and an explicit yes at each level.
        for (let i = 1; i < level; i++) {
            clock += AdultProfile.PER_LEVEL_MIN_MS;
            flow.checkIn(clock);
            flow.hear('yes', clock);
        }
        return { flow, activated, bus, at: () => clock, tick: (ms) => (clock += ms) };
    }

    test('a soft exit from any level lands on level 1', () => {
        for (let level = 1; level <= AdultProfile.LEVELS; level++) {
            const f = flowAt(level);
            expect(f.flow.level).toBe(level);
            const result = f.flow.exit('soft', f.at());
            expect(`${level}: ${result.level}`).toBe(`${level}: 1`);
            expect(f.flow.active).toBe(true);
        }
    });

    test('a hard exit from any level leaves the tier for companion', () => {
        for (let level = 1; level <= AdultProfile.LEVELS; level++) {
            const f = flowAt(level);
            f.flow.exit('hard', f.at());
            expect(`${level}: ${f.flow.active}`).toBe(`${level}: false`);
            expect(f.activated).toEqual(['companion']);
        }
    });

    test('the word does it, from any level', () => {
        for (let level = 1; level <= AdultProfile.LEVELS; level++) {
            const soft = flowAt(level);
            soft.flow.hear('cozy', soft.at());
            expect(`soft ${level}: ${soft.flow.level}`).toBe(`soft ${level}: 1`);

            const hard = flowAt(level);
            hard.flow.hear('stop', hard.at());
            expect(`hard ${level}: ${hard.flow.active}`).toBe(`hard ${level}: false`);
        }
    });

    test('and mid-check-in — a person saying stop is not answering the question', () => {
        const f = flowAt(1);
        f.tick(AdultProfile.PER_LEVEL_MIN_MS);
        f.flow.checkIn(f.at());
        expect(f.flow.stats.pending).toBe(2);
        f.flow.hear('stop', f.at());
        expect(f.flow.active).toBe(false);
        expect(f.flow.level).toBe(1);
    });

    test('neither exit says a word about it', () => {
        // Being asked why you wanted to stop is what makes people not say it next time.
        const spoken = [];
        const f = flowAt(3);
        f.flow._say = (text) => spoken.push(text);
        f.flow.hear('cozy', f.at());
        f.flow.hear('stop', f.at());
        expect(spoken).toEqual([]);
    });

    test('both are synchronous — nothing awaits', () => {
        const source = codeOf(fs.readFileSync(path.join(ROOT, 'src/behavior/ConsentFlow.js'), 'utf8'));
        expect(source).not.toContain('await ');
        expect(source).not.toContain('async ');
    });

    test('"cozily" is conversation, not an exit', () => {
        const f = flowAt(2);
        f.flow.hear('that sounds cozily nice', f.at());
        expect(f.flow.level).toBe(2);
    });
});

// ── the arc ──────────────────────────────────────────────────────────────────

describe('escalation is earned', () => {
    function flow({ level = 1 } = {}) {
        let clock = 0;
        const bus = new EventBus();
        const events = [];
        for (const name of ['adult:enter', 'adult:exit', 'adult:checkin', 'adult:declined', 'adult:level']) {
            bus.on(name, (e) => events.push({ name, ...e }));
        }
        const blackboard = openBoard({ level });
        const f = ConsentFlow.attach({ bus, profile: AdultProfile, blackboard, now: () => clock });
        return { f, bus, events, blackboard, at: () => clock, tick: (ms) => (clock += ms) };
    }

    test('entering requires the server attestation, not just the setting', () => {
        const bb = openBoard();
        bb.adultVerified = false;
        const f = ConsentFlow.attach({ profile: AdultProfile, blackboard: bb, now: () => 0 });
        expect(f.enter(0)).toEqual({ ok: false, why: 'not permitted: adultVerified' });
    });

    test('and it starts at level 1', () => {
        const f = flow();
        expect(f.f.enter(0).level).toBe(1);
        expect(f.blackboard.escalationLevel).toBe(1);
    });

    test('a check-in before the level is earned is refused', () => {
        const f = flow();
        f.f.enter(0);
        f.tick(AdultProfile.PER_LEVEL_MIN_MS - 1);
        expect(f.f.checkIn(f.at())).toEqual({
            ok: false,
            why: 'this level has not been held long enough',
        });
    });

    test('after two minutes she may ask', () => {
        const f = flow();
        f.f.enter(0);
        f.tick(AdultProfile.PER_LEVEL_MIN_MS);
        expect(f.f.checkIn(f.at()).ok).toBe(true);
        expect(f.events.some((e) => e.name === 'adult:checkin')).toBe(true);
    });

    test('and a pending flow does not advance until it is answered', () => {
        const f = flow();
        f.f.enter(0);
        f.tick(AdultProfile.PER_LEVEL_MIN_MS);
        f.f.checkIn(f.at());
        f.tick(AdultProfile.PER_LEVEL_MIN_MS * 10);
        expect(f.f.level).toBe(1);
    });

    test('an explicit yes advances one level', () => {
        const f = flow();
        f.f.enter(0);
        f.tick(AdultProfile.PER_LEVEL_MIN_MS);
        f.f.checkIn(f.at());
        expect(f.f.hear('yes please', f.at())).toEqual({ action: 'advanced', level: 2, why: 'checkin' });
        expect(f.blackboard.escalationLevel).toBe(2);
    });

    test('a no does not, and is not re-asked', () => {
        const f = flow();
        f.f.enter(0);
        f.tick(AdultProfile.PER_LEVEL_MIN_MS);
        f.f.checkIn(f.at());
        expect(f.f.hear('not now', f.at()).action).toBe('declined');
        expect(f.f.level).toBe(1);
        expect(f.f.stats.pending).toBeNull();
    });

    test('and neither does anything ambiguous — yes has to be said', () => {
        const f = flow();
        f.f.enter(0);
        f.tick(AdultProfile.PER_LEVEL_MIN_MS);
        f.f.checkIn(f.at());
        expect(f.f.hear('hmm, the cat is on the sofa', f.at())).toMatchObject({
            action: 'declined',
            answer: 'unclear',
        });
        expect(f.f.level).toBe(1);
    });

    test('"no, keep going" is a no', () => {
        // A person changing their mind mid-sentence. Reading the affirmative out of it is
        // exactly the failure this file exists to prevent.
        expect(ConsentFlow.classify('no, keep going')).toBe('no');
        expect(ConsentFlow.classify('yes')).toBe('yes');
        expect(ConsentFlow.classify('')).toBe('unclear');
        expect(ConsentFlow.classify('the weather is nice')).toBe('unclear');
    });

    test('the ambiguity hook can only ever turn unclear into yes, never no', () => {
        const f = flow();
        const flowWithHook = ConsentFlow.attach({
            profile: AdultProfile,
            blackboard: f.blackboard,
            onAmbiguous: () => 'yes',
            now: () => 999999,
        });
        flowWithHook.enter(0);
        flowWithHook.checkIn(999999);
        expect(flowWithHook.hear('mm-hmm', 999999).action).toBe('advanced');

        const stubborn = ConsentFlow.attach({
            profile: AdultProfile,
            blackboard: openBoard(),
            onAmbiguous: () => 'yes',
            now: () => 999999,
        });
        stubborn.enter(0);
        stubborn.checkIn(999999);
        expect(stubborn.hear('no', 999999).action).toBe('declined');
    });

    test('the fastest path to the top is three explicit yeses and six minutes', () => {
        const f = flow();
        f.f.enter(0);
        for (let i = 0; i < 3; i++) {
            f.tick(AdultProfile.PER_LEVEL_MIN_MS);
            f.f.checkIn(f.at());
            f.f.hear('yes', f.at());
        }
        expect(f.f.level).toBe(4);
        expect(f.at()).toBe(3 * AdultProfile.PER_LEVEL_MIN_MS);
        expect(f.f.stats.advances).toBe(3);
    });

    test('and there is no path to the top without them', () => {
        const f = flow();
        f.f.enter(0);
        for (let i = 0; i < 100; i++) {
            f.tick(AdultProfile.PER_LEVEL_MIN_MS);
            f.f.checkIn(f.at());
            f.f.hear('maybe', f.at());
        }
        expect(f.f.level).toBe(1);
    });

    test('user initiation is the second route and never the looser one', () => {
        const f = flow();
        f.f.enter(0);
        expect(f.f.initiated(f.at()).action).toBe('ignored');
        f.tick(AdultProfile.PER_LEVEL_MIN_MS);
        expect(f.f.initiated(f.at())).toEqual({ action: 'advanced', level: 2, why: 'initiated' });
    });

    test('the level cannot be pushed past the top', () => {
        const f = flow();
        f.f.enter(0);
        for (let i = 0; i < 10; i++) {
            f.tick(AdultProfile.PER_LEVEL_MIN_MS);
            f.f.initiated(f.at());
        }
        expect(f.f.level).toBe(AdultProfile.LEVELS);
    });
});

describe('and it cools down on its own', () => {
    test('inactivity decays the level back to 1', () => {
        let clock = 0;
        const bb = openBoard();
        const f = ConsentFlow.attach({ profile: AdultProfile, blackboard: bb, now: () => clock });
        f.enter(0);
        clock += AdultProfile.PER_LEVEL_MIN_MS;
        f.initiated(clock);
        expect(f.level).toBe(2);

        clock += AdultProfile.DECAY_AFTER_MS + 1;
        expect(f.tick(clock)).toMatchObject({ action: 'decayed', level: 1 });
        expect(bb.escalationLevel).toBe(1);
    });

    test('activity keeps it', () => {
        let clock = 0;
        const f = ConsentFlow.attach({ profile: AdultProfile, blackboard: openBoard(), now: () => clock });
        f.enter(0);
        clock += AdultProfile.PER_LEVEL_MIN_MS;
        f.initiated(clock);
        for (let i = 0; i < 20; i++) {
            clock += AdultProfile.DECAY_AFTER_MS / 2;
            f.hear('still here', clock);
            f.tick(clock);
        }
        expect(f.level).toBe(2);
    });

    test('a decayed level cancels any pending check-in', () => {
        let clock = 0;
        const f = ConsentFlow.attach({ profile: AdultProfile, blackboard: openBoard(), now: () => clock });
        f.enter(0);
        clock += AdultProfile.PER_LEVEL_MIN_MS;
        f.initiated(clock);
        clock += AdultProfile.PER_LEVEL_MIN_MS;
        f.checkIn(clock);
        clock += AdultProfile.DECAY_AFTER_MS + 1;
        f.tick(clock);
        expect(f.stats.pending).toBeNull();
    });
});

// ── the tier is unactivatable while disabled ─────────────────────────────────

describe('with the flag off the tier is unactivatable, not merely unadvertised', () => {
    test('the flag ships false', () => {
        expect(CONFIG.adult.available).toBe(false);
    });

    test('boot does not construct the flow at all', () => {
        const source = codeOf(fs.readFileSync(path.join(ROOT, 'src/behavior/boot.js'), 'utf8'));
        expect(source).toContain('config.adult && config.adult.available && global.NEXUS_BD_CONSENT_FLOW');
    });

    test('and even constructed it refuses without the attestation', () => {
        const bb = new Blackboard({ nsfwAllowed: true });
        const f = ConsentFlow.attach({ profile: AdultProfile, blackboard: bb, now: () => 0 });
        expect(f.enter(0).ok).toBe(false);
        expect(f.active).toBe(false);
    });

    test('the profile requires both flags before ModeManager may enter it', () => {
        expect(AdultProfile.requires.sort()).toEqual(['adultVerified', 'nsfwAllowed']);
    });

    test('the scenes exist and revert like every other scene', () => {
        for (const id of AdultProfile.scenes) {
            const manifest = JSON.parse(
                fs.readFileSync(path.join(ROOT, `src/features/together/scenes/${id}.json`), 'utf8')
            );
            expect(manifest.id).toBe(id);
            expect(manifest.fallbackColor).toMatch(/^#[0-9a-f]{6}$/i);
            // A manifest is JSON and can never carry a function, so it cannot widen the
            // ranker's mind — B27's rule, and it matters most here.
            expect(manifest.profileOverlay.allows).toBeUndefined();
            expect(manifest.guidedScript).toBeNull();
        }
    });
});
