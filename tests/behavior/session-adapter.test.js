/**
 * The session adapter — HomePilot's channel into the avatar (B9).
 *
 * Two sentences are the acceptance, and each has a test here that would fail if the claim
 * stopped being true:
 *
 *   1. A non-whitelisted server intent is dropped client-side. Not sanitised, not logged
 *      and forwarded — dropped, before it reaches the bus, by the same §6.2 whitelist a
 *      locally parsed `[[emote:...]]` tag passes.
 *   2. Pulling the network mid-session leaves local Tier-1 working. The pipeline in the
 *      last block is the one boot.js builds — real registry, real selector, real ranker —
 *      so "still working" means a real intent still resolves to a real clip after the
 *      socket has gone.
 *
 * No real WebSocket anywhere: the adapter takes a `socketFactory`, which is the only reason
 * these can be honest about close and silence without a network to unplug.
 */

/* global describe, test, expect, beforeAll, beforeEach, afterEach, jest */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const Registry = require('../../src/behavior/registry/AnimationRegistry.js');
const AntiRepeat = require('../../src/behavior/selector/AntiRepeatMemory.js');
const { Ranker } = require('../../src/behavior/selector/UtilityRanker.js');
const { Selector } = require('../../src/behavior/selector/SemanticSelector.js');
const SessionAdapter = require('../../src/behavior/adapters/SessionAdapter.js');

const { Adapter, SILENCE_LIMIT_MS, BACKOFF_CEILING_MS, PROTOCOL_VERSION } = SessionAdapter;

const ROOT = path.join(__dirname, '..', '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'protocol');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'behavior.config.json'), 'utf8'));

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
const INDEX = fixture('index.json');

/** A socket that records what it was told and lets a test decide what happens to it. */
class FakeSocket {
    constructor(url) {
        this.url = url;
        this.sent = [];
        this.closed = false;
        this.handlers = 0;
    }

    send(payload) {
        this.sent.push(JSON.parse(payload));
    }

    close() {
        this.closed = true;
    }

    /** The server accepted us. */
    open() {
        if (this.onopen) this.onopen();
    }

    /** One frame arrives, JSON-encoded exactly as it would be on the wire. */
    deliver(message) {
        if (this.onmessage) this.onmessage({ data: JSON.stringify(message) });
    }

    /** The socket closed cleanly — the polite failure, the one that fires an event. */
    drop() {
        if (this.onclose) this.onclose();
    }
}

/** An adapter with a live, opened fake socket. Returns both. */
function connected(overrides = {}) {
    const sockets = [];
    const bus = overrides.bus || new EventBus({});
    const blackboard = overrides.blackboard || new Blackboard({});
    const adapter = new Adapter({
        bus,
        blackboard,
        config: { ...CONFIG, session: { enabled: true, url: 'wss://test/avatar/session', tier1Remote: false } },
        socketFactory: (url) => {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
        ...overrides,
    });
    adapter.connect();
    sockets[0].open();
    return { adapter, bus, blackboard, socket: sockets[0], sockets };
}

let open = [];
let warnings = [];

beforeEach(() => {
    jest.useFakeTimers();
    open = [];
    warnings = [];
    // The adapter warns on every drop, which is the operator's only sign that a server is
    // asking for things it should not. Captured rather than silenced, so it can be asserted.
    jest.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(args.join(' ')));
});

afterEach(() => {
    for (const adapter of open) adapter.detach();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
});

/** Register an adapter for teardown, so a pending reconnect never outlives its test. */
function track(bundle) {
    open.push(bundle.adapter);
    return bundle;
}

describe('a server intent is an intent like any other', () => {
    test('a name outside the whitelist is dropped before it reaches the bus', () => {
        const { adapter, bus, socket } = track(connected());
        const seen = [];
        bus.on('intent', (intent) => seen.push(intent));

        const result = adapter.receive(JSON.stringify({ v: 1, type: 'intent', name: 'twerk', intensity: 1 }));

        expect(result).toEqual({ action: 'dropped', why: 'not whitelisted' });
        expect(seen).toEqual([]);
        expect(adapter.stats.dropped.notWhitelisted).toBe(1);
        // Silent dropping would make a misconfigured server impossible to diagnose.
        expect(warnings.join('\n')).toContain('"twerk" is not whitelisted');
        // But dropping a message is not a reason to hang up on the server.
        expect(adapter.stats.connected).toBe(true);
        expect(socket.closed).toBe(false);
    });

    test('the whitelist the server is held to is the config whitelist, not a copy', () => {
        const { adapter, bus } = track(connected());
        const seen = [];
        bus.on('intent', (intent) => seen.push(intent));

        for (const name of CONFIG.emoteWhitelist) {
            adapter.receive({ v: 1, type: 'intent', name, intensity: 0.5 });
        }
        expect(seen.map((i) => i.name)).toEqual(CONFIG.emoteWhitelist);
        expect(adapter.stats.dropped.notWhitelisted).toBe(0);
    });

    test('a whitelisted one arrives intact, with the server named as its source', () => {
        const { adapter, bus } = track(connected());
        const seen = [];
        bus.on('intent', (intent) => seen.push(intent));

        const result = adapter.receive(fixture('s2c-intent.json').message);

        expect(result.action).toBe('emitted');
        expect(seen).toEqual([{ name: 'lean_in', intensity: 0.6, source: 'curiosity' }]);
    });

    test('the source survives, because the ranker gates on it', () => {
        // §6.5 blocks NSFW for any intent whose source is not the user. That gate is worth
        // nothing if the adapter relabels a server intent as a local one on the way in.
        const { adapter, bus } = track(connected());
        const sources = [];
        bus.on('intent', (intent) => sources.push(intent.source));

        adapter.receive({ v: 1, type: 'intent', name: 'flirt', intensity: 0.9 });
        adapter.receive({ v: 1, type: 'intent', name: 'flirt', intensity: 0.9, source: 'curiosity' });

        expect(sources).toEqual(['server', 'curiosity']);
        expect(sources).not.toContain('user');
    });

    test('vision insights pass their intents through the same whitelist', () => {
        const { adapter, bus } = track(connected());
        const seen = [];
        bus.on('intent', (intent) => seen.push(intent));

        const result = adapter.receive({
            v: 1,
            type: 'vision_insight',
            frameId: 'f1',
            text: 'A bar chart with a broken y-axis.',
            intents: [
                { name: 'thinking', intensity: 0.5 },
                { name: 'undress', intensity: 1 },
            ],
        });

        expect(result.why).toBe('1/2 intents allowed');
        expect(seen.map((i) => i.name)).toEqual(['thinking']);
        expect(adapter.stats.dropped.notWhitelisted).toBe(1);
    });

    /**
     * The end-to-end version of the same claim: even a *whitelisted* server intent cannot
     * reach an NSFW clip, because the gate is the ranker's and it reads `source`. This is
     * the test that would catch someone "helpfully" giving the socket a bypass.
     */
    test('no server intent reaches an NSFW clip, whitelisted or not', () => {
        const bus = new EventBus({});
        const blackboard = new Blackboard({ nsfwAllowed: true });
        // All three of §16.1's gates open, so the only thing left standing is the source
        // rule — which is what this test is about.
        blackboard.adultVerified = true;
        blackboard.mode = { id: 'test', allowNsfw: true, allows: () => true };
        const ranker = new Ranker({ antiRepeat: new AntiRepeat(5) });
        const spicy = { id: 'x', nsfw: true, energy: 0.5, valence: 0.5, quality: 'production', intents: ['flirt'] };

        const { adapter } = track(connected({ bus, blackboard }));
        const picks = [];
        bus.on('intent', (intent) => picks.push(ranker.best([{ clip: spicy, similarity: 1 }], intent, blackboard)));

        adapter.receive({ v: 1, type: 'intent', name: 'flirt', intensity: 1, source: 'curiosity' });
        expect(picks).toEqual([null]);

        // The same clip, the same blackboard, the same ranker — only the source differs.
        bus.emit('intent', { name: 'flirt', intensity: 1, source: 'user' });
        expect(picks[1] && picks[1].clip.id).toBe('x');
    });
});

describe('the protocol', () => {
    test('every server→client fixture is handled without throwing', () => {
        const { adapter } = track(connected({ say: () => {} }));
        const s2c = INDEX.fixtures.filter((f) => f.direction === 'server->client');
        expect(s2c.length).toBeGreaterThan(8);

        for (const entry of s2c) {
            const { message } = fixture(entry.file);
            const result = adapter.receive(JSON.stringify(message));
            expect(`${entry.name} → ${typeof result.action}`).toBe(`${entry.name} → string`);
        }
    });

    test('an unknown type is ignored and the session stays open (§6.9)', () => {
        const { adapter, socket } = track(connected());
        const result = adapter.receive(fixture('s2c-unknown_type.json').message);

        expect(result).toEqual({ action: 'ignored', why: 'unknown type' });
        expect(adapter.stats.dropped.unknownType).toBe(1);
        expect(adapter.stats.connected).toBe(true);
        expect(socket.closed).toBe(false);
    });

    test('a wrong protocol version is dropped, not guessed at', () => {
        const { adapter } = track(connected());
        expect(adapter.receive({ v: 99, type: 'intent', name: 'wave' }).why).toBe('wrong protocol version');
        expect(adapter.stats.dropped.badVersion).toBe(1);
    });

    test('malformed frames do not take the adapter down', () => {
        const { adapter } = track(connected());
        expect(adapter.receive('{not json').action).toBe('dropped');
        expect(adapter.receive(null).action).toBe('dropped');
        expect(adapter.receive(42).action).toBe('dropped');
        expect(adapter.stats.connected).toBe(true);
    });

    test('a ping is answered with a pong that matches the fixture', () => {
        const { adapter, socket } = track(connected());
        adapter.receive(fixture('s2c-ping.json').message);
        expect(socket.sent.pop()).toEqual(fixture('c2s-pong.json').message);
    });

    test('what the client sends carries every key the fixtures require', () => {
        const blackboard = new Blackboard({});
        blackboard.mode = { id: 'together' };
        blackboard.activity = 'watch';
        blackboard.attention = 0.8;

        const { adapter, socket } = track(connected({ blackboard }));
        adapter.sendContext();
        adapter.sendUserEvent('media:paused');

        const byType = Object.fromEntries(socket.sent.map((m) => [m.type, m]));
        for (const name of ['hello', 'ctx', 'user_event']) {
            const { required, message } = fixture(`c2s-${name}.json`);
            expect(`${name}: ${Object.keys(byType[name] || {}).sort()}`).toBe(`${name}: ${[...required].sort()}`);
            expect(byType[name].v).toBe(PROTOCOL_VERSION);
            expect(typeof byType[name].type).toBe(typeof message.type);
        }
        expect(byType.ctx).toEqual({ v: 1, type: 'ctx', mode: 'together', activity: 'watch', attention: 0.8 });
    });

    test('say is routed through the app speech path, not spoken by the adapter', () => {
        const spoken = [];
        const { adapter } = track(connected({ say: (text, meta) => spoken.push([text, meta.source]) }));
        adapter.receive(fixture('s2c-say.json').message);
        expect(spoken).toEqual([['You mentioned the aquarium trip — how was it?', 'curiosity']]);
    });

    test('an empty say says nothing', () => {
        const spoken = [];
        const { adapter } = track(connected({ say: (text) => spoken.push(text) }));
        expect(adapter.receive({ v: 1, type: 'say', text: '   ' }).why).toBe('empty');
        expect(spoken).toEqual([]);
    });
});

describe('adult attestation is recorded, and unlocks nothing on its own', () => {
    test('it is session-scoped: nothing is written to storage', () => {
        const writes = [];
        const store = global.localStorage;
        global.localStorage = { setItem: (k, v) => writes.push([k, v]), getItem: () => null, removeItem: () => {} };
        try {
            const { adapter, blackboard } = track(connected());
            adapter.receive(fixture('s2c-adult_ack.json').message);
            expect(adapter.adultVerified).toBe(true);
            expect(blackboard.adultVerified).toBe(true);
            expect(writes).toEqual([]);
        } finally {
            global.localStorage = store;
        }
    });

    test('a verified session still cannot play an NSFW clip while the setting is off', () => {
        // The three conditions of §6.5 are conjunctive. Attestation is one of them, and the
        // owner's `nsfwAllowed` setting — which no server message can touch — is another.
        const { adapter, blackboard } = track(connected());
        adapter.receive({ v: 1, type: 'adult_ack', verified: true, exp: '2026-12-31' });

        expect(blackboard.nsfwAllowed).toBe(false);
        const ranker = new Ranker({ antiRepeat: new AntiRepeat(5) });
        const spicy = { id: 'x', nsfw: true, energy: 0.5, valence: 0, quality: 'production' };
        expect(ranker.score(spicy, { name: 'flirt', source: 'user' }, blackboard)).toBe(-Infinity);
    });
});

describe('losing the network', () => {
    test('a clean close reports itself, clears the flag and schedules a retry', () => {
        const { adapter, bus, blackboard, socket } = track(connected());
        const events = [];
        bus.on('session:down', () => events.push('down'));

        expect(blackboard.flags.sessionUp).toBe(true);
        socket.drop();

        expect(events).toEqual(['down']);
        expect(blackboard.flags.sessionUp).toBe(false);
        expect(adapter.stats.connected).toBe(false);
        expect(adapter.stats.nextRetryMs).toBe(1000);
    });

    /**
     * The failure a pulled cable actually produces. TCP does not notice, so `onclose` never
     * fires and the socket sits there looking healthy. The only evidence is the server's
     * heartbeat going quiet, which is what `tick` watches for.
     */
    test('a silent socket that never closes is abandoned anyway', () => {
        let clock = 10000;
        const { adapter, bus, socket } = track(connected({ now: () => clock }));
        const events = [];
        bus.on('session:down', () => events.push('down'));

        clock += SILENCE_LIMIT_MS - 1;
        adapter.tick();
        expect(adapter.stats.connected).toBe(true);
        expect(events).toEqual([]);

        clock += 2;
        adapter.tick();
        expect(events).toEqual(['down']);
        expect(socket.closed).toBe(true);
        expect(adapter.stats.connected).toBe(false);
    });

    test('any frame counts as a heartbeat, so a busy session is never declared dead', () => {
        let clock = 0;
        const { adapter } = track(connected({ now: () => clock }));
        for (let i = 0; i < 10; i++) {
            clock += SILENCE_LIMIT_MS - 1000;
            adapter.receive({ v: 1, type: 'intent', name: 'wave', intensity: 0.5 });
            adapter.tick();
        }
        expect(adapter.stats.connected).toBe(true);
    });

    test('the abandoned socket cannot schedule a second reconnect behind our back', () => {
        let clock = 0;
        const { adapter, socket } = track(connected({ now: () => clock }));
        clock += SILENCE_LIMIT_MS + 1;
        adapter.tick();

        const afterWatchdog = adapter.stats.attempts;
        socket.drop(); // the real socket's own onclose, arriving late
        expect(adapter.stats.attempts).toBe(afterWatchdog);
    });

    test('a reconnect that succeeds resets the backoff to one second', () => {
        // Otherwise a session that flaps once an hour ends up waiting 30 s to come back.
        const { adapter, sockets } = track(connected());
        const delays = [];
        for (let i = 0; i < 8; i++) {
            const socket = sockets[sockets.length - 1];
            socket.open();
            socket.drop();
            delays.push(adapter.stats.nextRetryMs);
            jest.advanceTimersByTime(adapter.stats.nextRetryMs);
        }
        expect(delays).toEqual([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000]);
    });

    test('a server that stays down backs off exponentially and stops at 30 s', () => {
        const adapter = new Adapter({
            bus: new EventBus({}),
            config: { ...CONFIG, session: { enabled: true, url: 'wss://test/x' } },
            socketFactory: () => {
                throw new Error('refused');
            },
        });
        open.push(adapter);

        const delays = [];
        for (let i = 0; i < 8; i++) {
            adapter.connect();
            delays.push(adapter.nextRetryMs);
        }
        expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
        expect(Math.max(...delays)).toBe(BACKOFF_CEILING_MS);
    });

    test('detach stops the retries for good', () => {
        const { adapter, socket } = track(connected());
        socket.drop();
        expect(adapter.stats.nextRetryMs).toBe(1000);

        adapter.detach();
        const attempts = adapter.stats.attempts;
        jest.advanceTimersByTime(120000);
        expect(adapter.stats.attempts).toBe(attempts);
        expect(adapter.stats.connected).toBe(false);
    });
});

describe('local Tier-1 outlives the session', () => {
    let registry;
    let selector;

    beforeAll(() => {
        registry = new Registry().loadText(fs.readFileSync(path.join(ROOT, 'kb', 'animations.manifest.jsonl'), 'utf8'));
        selector = new Selector()
            .loadVocabularyText(fs.readFileSync(path.join(ROOT, 'kb', 'embeddings', 'index.vocab.tsv'), 'utf8'))
            .index(registry.records);
    });

    /** The pipeline boot.js builds, minus the mixer: intent → selector → ranker → pick. */
    function tier1(bus, blackboard) {
        const ranker = new Ranker({ antiRepeat: new AntiRepeat(CONFIG.antiRepeatWindow) });
        const picks = [];
        bus.on('intent', (intent) => {
            picks.push(ranker.best(selector.topK(intent, registry, CONFIG.topK), intent, blackboard));
        });
        return picks;
    }

    test('pulling the network mid-session leaves local intents resolving', () => {
        const bus = new EventBus({});
        const blackboard = new Blackboard({});
        const picks = tier1(bus, blackboard);
        const { adapter, socket } = track(connected({ bus, blackboard }));

        // Before: the server can reach Tier-1 and Tier-1 answers.
        adapter.receive({ v: 1, type: 'intent', name: 'wave', intensity: 0.6 });
        expect(picks[0] && picks[0].clip.id).toBeTruthy();

        // The cable goes. Nothing in the engine is torn down by that.
        socket.drop();
        expect(adapter.stats.connected).toBe(false);
        expect(blackboard.flags.sessionUp).toBe(false);

        // After: a locally sensed intent — a parsed tag, an idle timeout — still resolves.
        bus.emit('intent', { name: 'dance', intensity: 0.8, source: 'user' });
        bus.emit('intent', { name: 'thinking', intensity: 0.4, source: 'user' });

        expect(picks).toHaveLength(3);
        for (const pick of picks) expect(pick && typeof pick.clip.id).toBe('string');
        expect(picks[1].clip.intents).toContain('dance');
    });

    test('and the server cannot reach it while the socket is down', () => {
        const bus = new EventBus({});
        const blackboard = new Blackboard({});
        const picks = tier1(bus, blackboard);
        const { adapter, socket } = track(connected({ bus, blackboard }));

        socket.drop();
        // Nothing is delivering frames any more; the queue is not replayed on reconnect.
        expect(picks).toEqual([]);
        expect(adapter.stats.received).toBe(0);
    });
});

describe('where the session URL comes from (B35)', () => {
    /**
     * `boot.js` is a browser IIFE with no CommonJS export, so it is evaluated the way the
     * page evaluates it and the seam it publishes is read off the sandbox.
     *
     * B35 made `sessionSettings` async and gave it a second source. Before it, reaching
     * HomePilot meant typing a `wss://` into Settings — an address the browser had to be able
     * to open itself, which is true on one machine and false everywhere the app is actually
     * served. Now an unfilled box means "ask the bridge the user already linked", and the
     * `source` field on the result says which answer won, because "off" and "the bridge said
     * no" are different states that used to look identical.
     *
     * @param {object} storage the localStorage seen by boot
     * @param {object} shipped the `session` block from behavior.config.json
     * @param {object|null} discovery a fake `NEXUS_BD_BRIDGE_DISCOVERY`; null means absent
     */
    function sessionSettings(storage, shipped, discovery = null) {
        const sandbox = {
            window: { localStorage: storage },
            document: { querySelector: () => null, head: { appendChild() {} }, createElement: () => ({}) },
            console,
        };
        sandbox.window.window = sandbox.window;
        if (discovery) sandbox.window.NEXUS_BD_BRIDGE_DISCOVERY = discovery;
        vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src', 'behavior', 'boot.js'), 'utf8'), sandbox, {
            filename: 'src/behavior/boot.js',
        });
        return sandbox.window.NEXUS_BD_BOOT.sessionSettings(shipped);
    }

    const store = (values) => ({ getItem: (k) => (k in values ? values[k] : null) });

    /** A bridge that answers. `NOTHING`-shaped refusals carry their reason. */
    const bridge = (answer) => ({ discover: async () => answer });
    const FOUND = {
        available: true,
        reason: 'ok',
        base: 'https://app.ollabridge.com',
        sessionUrl: 'wss://app.ollabridge.com/v1/avatar/session',
        auth: 'pair-token',
        features: ['directives', 'curiosity'],
    };
    const REFUSED = (reason) => ({ available: false, reason, base: null, sessionUrl: null, auth: '', features: [] });

    // ── nothing configured, no bridge ────────────────────────────────────────

    test('the shipped config alone opens nothing, placeholder URL and all', async () => {
        expect(CONFIG.session.enabled).toBe(false);
        expect(await sessionSettings(store({}), CONFIG.session)).toEqual({
            ...CONFIG.session,
            enabled: false,
            source: 'off',
        });
    });

    test('a ticked box with no URL is still off', async () => {
        const settings = await sessionSettings(store({ nexus_bd_session_enabled: 'true' }), CONFIG.session);
        expect(settings.enabled).toBe(false);
    });

    // ── the manual path, which B35 hid but did not remove ────────────────────

    test('a URL and a ticked box turn it on, and the placeholder is replaced', async () => {
        const settings = await sessionSettings(
            store({ nexus_bd_session_enabled: 'true', nexus_bd_session_url: ' wss://pilot.local/avatar/session ' }),
            CONFIG.session
        );
        expect(settings).toEqual({
            ...CONFIG.session,
            url: 'wss://pilot.local/avatar/session',
            enabled: true,
            source: 'manual',
        });
    });

    test('a URL without the box is off — filling a field is not consent to connect', async () => {
        const settings = await sessionSettings(store({ nexus_bd_session_url: 'wss://pilot.local/x' }), CONFIG.session);
        expect(settings.enabled).toBe(false);
    });

    test('storage that throws leaves the session off rather than breaking boot', async () => {
        const hostile = {
            getItem() {
                throw new Error('storage disabled');
            },
        };
        expect((await sessionSettings(hostile, CONFIG.session)).enabled).toBe(false);
    });

    // ── the bridge path ──────────────────────────────────────────────────────

    test('with no URL typed, a bridge that has HomePilot supplies one', async () => {
        const settings = await sessionSettings(store({}), CONFIG.session, bridge(FOUND));
        expect(settings.url).toBe(FOUND.sessionUrl);
        expect(settings.enabled).toBe(true);
        expect(settings.source).toBe('bridge');
    });

    test('and the credential comes with it, so the box never needed a token field', async () => {
        // The blocker this batch removes: the client had no field for a HomePilot token and
        // sent an empty one, which the server rejects. The bridge's own token is what travels
        // now, and the bridge holds HomePilot's key.
        const settings = await sessionSettings(store({}), CONFIG.session, bridge(FOUND));
        expect(settings.auth).toBe('pair-token');
    });

    test('a typed URL beats the bridge — the override has to actually override', async () => {
        const settings = await sessionSettings(
            store({ nexus_bd_session_enabled: 'true', nexus_bd_session_url: 'ws://localhost:8000/avatar/session' }),
            CONFIG.session,
            bridge(FOUND)
        );
        expect(settings.url).toBe('ws://localhost:8000/avatar/session');
        expect(settings.source).toBe('manual');
    });

    test.each([['no-bridge'], ['no-homepilot'], ['bridge-unreachable'], ['bridge-too-old']])(
        'a bridge that answers %s leaves the session off, and says why',
        async (reason) => {
            const settings = await sessionSettings(store({}), CONFIG.session, bridge(REFUSED(reason)));
            expect(settings.enabled).toBe(false);
            expect(settings.source).toBe(reason);
        }
    );

    test('auto can be switched off, and then no bridge is asked at all', async () => {
        let asked = 0;
        const counting = {
            discover: async () => {
                asked += 1;
                return FOUND;
            },
        };
        const settings = await sessionSettings(store({ nexus_bd_session_auto: 'false' }), CONFIG.session, counting);
        expect(asked).toBe(0);
        expect(settings.enabled).toBe(false);
    });

    test('a build without the discovery module is off, not broken', async () => {
        // The module is loaded by boot's own MODULES list. If a build ever drops it, the
        // session must be absent rather than throwing on a boot path.
        const settings = await sessionSettings(store({}), CONFIG.session, null);
        expect(settings.enabled).toBe(false);
        expect(settings.source).toBe('off');
    });
});

describe('shipped defaults', () => {
    test('with session.enabled false, attach opens no socket at all', () => {
        let asked = 0;
        const adapter = SessionAdapter.attach({
            bus: new EventBus({}),
            blackboard: new Blackboard({}),
            config: CONFIG,
            socketFactory: () => {
                asked++;
                return new FakeSocket('x');
            },
        });
        open.push(adapter);

        expect(CONFIG.session.enabled).toBe(false);
        expect(asked).toBe(0);
        expect(adapter.stats.connected).toBe(false);
        expect(adapter.stats.attempts).toBe(0);
        expect(adapter.name).toBe('SessionAdapter');
    });

    test('a disabled session never retries, because it never tried', () => {
        const adapter = new Adapter({ bus: new EventBus({}), config: CONFIG });
        open.push(adapter);
        expect(adapter.connect()).toBe(false);
        jest.advanceTimersByTime(60000);
        expect(adapter.stats.attempts).toBe(0);
    });
});
