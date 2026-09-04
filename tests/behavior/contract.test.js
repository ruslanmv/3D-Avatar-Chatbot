/**
 * One activity execution contract (B36).
 *
 * The chooser looked finished and four of its eight tiles could not complete the journey the
 * button promised: `watch` has no `start`, `journey` has `enter`/`exit`, `copilot` refuses
 * without a checklist the panel never passed, and `meeting` wants an options object and was
 * never registered at all. On top of that, the panel requested a grant and then called
 * activities that request their own — and `ConsentMachine.request()` revokes a live grant
 * before asking again, so the user was prompted twice for one camera.
 *
 * These tests are written against the *contract*, not against the adapters, so an activity
 * that later implements it natively drops its adapter and keeps its coverage.
 */

/* global describe, test, expect, beforeEach, jest */

const fs = require('fs');
const path = require('path');

const Contract = require('../../src/features/together/activities/contract.js');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'src', 'features', 'together', 'activities', 'contract.js');
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

// ── stand-ins with each activity's *real* surface ───────────────────────────

const fakes = {
    focus: () => ({
        id: 'focus',
        phase: 'focus',
        start: jest.fn(() => ({ ok: true })),
        stop: jest.fn(() => true),
        remainingMs: () => 1_458_000,
    }),
    watch: () => ({
        id: 'watch',
        sourceLabel: 'YouTube tab',
        playFile: jest.fn(async () => ({ ok: true })),
        shareTab: jest.fn(async () => ({ ok: true })),
        stop: jest.fn(() => true),
    }),
    journey: () => ({
        id: 'journey',
        current: 'ocean',
        scenes: new Map([
            ['ocean', { id: 'ocean', title: 'Ocean', icon: '🌊' }],
            ['forest', { id: 'forest', title: 'Forest' }],
        ]),
        enter: jest.fn(() => true),
        exit: jest.fn(() => true),
    }),
    copilot: () => ({
        id: 'copilot',
        steps: [],
        index: 0,
        start: jest.fn(async () => ({ ok: true })),
        stop: jest.fn(() => true),
    }),
    coach: () => ({
        id: 'coach',
        exercises: ['squat', 'push-up'],
        exercise: 'squat',
        reps: 8,
        start: jest.fn(async () => ({ ok: true })),
        stop: jest.fn(() => true),
    }),
    meeting: () => ({
        id: 'meeting',
        elapsedMs: 763_000,
        start: jest.fn(async () => ({ ok: true })),
        stop: jest.fn(() => true),
    }),
    music: () => ({
        id: 'music',
        trackName: 'Midnight City',
        attachSource: jest.fn(() => ({ ok: true })),
        detachSource: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(() => true),
    }),
    cohost: () => ({ id: 'cohost', momentSource: {}, start: jest.fn(() => ({ ok: true })), stop: jest.fn(() => true) }),
};

const adaptAll = (context = {}) =>
    Object.fromEntries(Object.entries(fakes).map(([id, make]) => [id, Contract.adapt(make(), context)]));

// ── the contract itself ────────────────────────────────────────────────────

describe('every activity answers the same surface', () => {
    test('all eight adapt', () => {
        const adapted = adaptAll({ conversationId: 'c1' });
        for (const [id, activity] of Object.entries(adapted)) {
            expect(activity).not.toBeNull();
            expect(activity.id).toBe(id);
            for (const method of ['inputs', 'availability', 'start', 'stop', 'status']) {
                expect(typeof activity[method]).toBe('function');
            }
        }
    });

    test('an activity with no adapter is refused rather than half-registered', () => {
        // A registry that silently accepted these is how a tile that cannot start got into
        // a finished-looking chooser.
        expect(Contract.adapt({ id: 'nonesuch', start: () => {} })).toBeNull();
        expect(Contract.adapt(null)).toBeNull();
        expect(Contract.adapt({ start: () => {} })).toBeNull();
    });

    test('an activity that already speaks the contract is passed through untouched', () => {
        const native = { id: 'ninth', __contract: true, start: () => {} };
        expect(Contract.adapt(native)).toBe(native);
    });
});

// ── the four that were broken ──────────────────────────────────────────────

describe('the tiles that could not complete', () => {
    test('watch: a shared tab goes to shareTab, a file goes to playFile', async () => {
        const raw = fakes.watch();
        const watch = Contract.adapt(raw);
        const [tab, file] = watch.inputs();

        await watch.start({ input: tab });
        expect(raw.shareTab).toHaveBeenCalled();
        expect(raw.playFile).not.toHaveBeenCalled();

        await watch.start({ input: { ...file, url: 'blob:x' } });
        expect(raw.playFile).toHaveBeenCalledWith('blob:x');
    });

    test('journey: start/stop reach enter/exit', async () => {
        const raw = fakes.journey();
        const journey = Contract.adapt(raw);
        const ocean = journey.inputs().find((i) => i.id === 'ocean');
        expect(ocean.label).toContain('Ocean');

        await journey.start({ input: ocean });
        expect(raw.enter).toHaveBeenCalledWith('ocean');
        journey.stop('user');
        expect(raw.exit).toHaveBeenCalledWith('user');
    });

    test('journey offers only the scenes that are actually registered', () => {
        // A tile that offers Sunset when no sunset scene is loaded is a tile that fails
        // after the user has chosen.
        const journey = Contract.adapt(fakes.journey());
        expect(
            journey
                .inputs()
                .map((i) => i.id)
                .sort()
        ).toEqual(['forest', 'ocean']);
    });

    test('copilot: "just look and help" starts without a checklist', async () => {
        // B26 refuses to start without steps, which turned the broadest and most valuable
        // use of the camera into the one thing it could not do.
        const raw = fakes.copilot();
        const copilot = Contract.adapt(raw);
        const look = copilot.inputs().find((i) => i.id === 'look');
        expect(look).toBeTruthy();

        const result = await copilot.start({ input: look });
        expect(result.ok).toBe(true);
        const [steps] = raw.start.mock.calls[0];
        expect(Array.isArray(steps)).toBe(true);
        expect(steps.length).toBeGreaterThan(0);
    });

    test('copilot: a supplied checklist is passed through instead', async () => {
        const raw = fakes.copilot();
        const copilot = Contract.adapt(raw);
        const steps = [{ title: 'Chop' }, { title: 'Fry' }];
        await copilot.start({ input: { id: 'steps', steps } });
        expect(raw.start).toHaveBeenCalledWith(steps);
    });

    test('meeting: gets the conversation id it has always required', async () => {
        const raw = fakes.meeting();
        const meeting = Contract.adapt(raw, { conversationId: 'conv-7' });
        expect(meeting.availability().ok).toBe(true);
        await meeting.start({ input: meeting.inputs()[0] });
        expect(raw.start).toHaveBeenCalledWith({ conversationId: 'conv-7' });
    });

    test('meeting: says why rather than failing after the permission prompt', () => {
        // A meeting has to land in a conversation. Finding that out *after* the screen and
        // microphone dialogs is the worst possible moment.
        const meeting = Contract.adapt(fakes.meeting(), {});
        const why = meeting.availability();
        expect(why.ok).toBe(false);
        expect(why.why).toMatch(/conversation/i);
    });
});

// ── who owns a permission ──────────────────────────────────────────────────

describe('exactly one permission owner', () => {
    const owners = () => {
        const adapted = adaptAll({ conversationId: 'c1' });
        const out = {};
        for (const [id, activity] of Object.entries(adapted)) {
            out[id] = activity.inputs().map((i) => i.permission);
        }
        return out;
    };

    test('every activity that asks for itself is marked self, and the panel must not ask for it', () => {
        // `ConsentMachine.request()` revokes a live grant before asking again. Any activity
        // whose own code path reaches `consent.request` — watch.shareTab, meeting.start, and
        // coach/copilot through ScreenInsight.start('camera') — must be `'self'`, or the
        // panel's grant is destroyed and the user is prompted a second time.
        const table = owners();
        expect(table.watch).toEqual(['self', null]);
        expect(table.meeting).toEqual(['self']);
        expect(new Set(table.coach)).toEqual(new Set(['self']));
        expect(new Set(table.copilot)).toEqual(new Set(['self']));
    });

    test('activities that capture nothing ask for nothing', () => {
        const table = owners();
        expect(table.focus).toEqual([null]);
        expect(table.journey.every((p) => p === null)).toBe(true);
        expect(table.music).toEqual([null]);
    });

    test('the one panel-owned grant is the one whose activity never requests', () => {
        // CoHost takes a pipeline and never touches the consent machine, so the panel is
        // the right owner there and only there.
        expect(owners().cohost).toEqual(['screen']);
    });

    test('a permission value is always null, self, or a consent source', () => {
        const valid = new Set([null, 'self', 'screen', 'camera', 'meeting']);
        for (const permissions of Object.values(owners())) {
            for (const permission of permissions) expect(valid.has(permission)).toBe(true);
        }
    });
});

// ── availability, honestly ─────────────────────────────────────────────────

describe('a tile that cannot complete says so', () => {
    test('music without an audio source refuses, with a reason', () => {
        // B14's `Music.start()` set a flag and the beat detector read an analyser that was
        // never given a source: the tile started something that could not hear anything.
        const bare = { id: 'music', start: jest.fn(), stop: jest.fn() };
        const music = Contract.adapt(bare);
        expect(music.availability().ok).toBe(false);
        expect(music.availability().why).toMatch(/audio source/i);
    });

    test('music with a source is available', () => {
        expect(Contract.adapt(fakes.music()).availability().ok).toBe(true);
    });

    test('play refuses while nothing produces game moments', () => {
        // The reactions, the tier table and the overlay are all real. What is missing is the
        // detector that feeds them, so sharing a game would start a co-host that never sees
        // a moment.
        const bare = { id: 'cohost', start: jest.fn(), stop: jest.fn() };
        const why = Contract.adapt(bare).availability();
        expect(why.ok).toBe(false);
        expect(why.why).toMatch(/moment detection/i);
    });

    test('an availability check that throws becomes a reason, not a crash', () => {
        const angry = {
            id: 'music',
            get attachSource() {
                throw new Error('boom');
            },
        };
        const result = Contract.adapt(angry).availability();
        expect(result.ok).toBe(false);
        expect(result.why).toMatch(/boom/);
    });
});

// ── failures and refusals ──────────────────────────────────────────────────

describe('a refusal keeps its own words', () => {
    test('an activity that answers ok:false is not overruled', async () => {
        const raw = fakes.coach();
        raw.start = jest.fn(async () => ({ ok: false, why: 'that exercise is not supported' }));
        const coach = Contract.adapt(raw);
        const result = await coach.start({ input: { id: 'cartwheel', arg: 'cartwheel' } });
        expect(result.ok).toBe(false);
        expect(result.why).toBe('that exercise is not supported');
    });

    test('a throw becomes a reason rather than escaping into the panel', async () => {
        const raw = fakes.focus();
        raw.start = jest.fn(() => {
            throw new Error('no profile overlay');
        });
        const result = await Contract.adapt(raw).start({ input: { id: 'start' } });
        expect(result.ok).toBe(false);
        expect(result.why).toMatch(/no profile overlay/);
    });

    test('an activity that reports by not throwing counts as started', async () => {
        // `journey.enter` and `music.start` return the activity or nothing at all.
        const journey = Contract.adapt(fakes.journey());
        expect((await journey.start({ input: { id: 'ocean', arg: 'ocean' } })).ok).toBe(true);
    });

    test('an explicit false is a refusal', async () => {
        const raw = fakes.journey();
        raw.enter = jest.fn(() => false);
        expect((await Contract.adapt(raw).start({ input: { id: 'ocean' } })).ok).toBe(false);
    });

    test('a stop that throws is survived and reported', () => {
        const raw = fakes.focus();
        raw.stop = jest.fn(() => {
            throw new Error('nope');
        });
        expect(Contract.adapt(raw).stop('user')).toBe(false);
    });
});

// ── the compact running status ─────────────────────────────────────────────

describe("status is the activity's own, not a generic line", () => {
    test('each activity says what it is doing', () => {
        const a = adaptAll({ conversationId: 'c1' });
        expect(a.focus.status()).toEqual({ label: 'Focus', detail: '24:18' });
        expect(a.meeting.status()).toEqual({ label: 'Recording', detail: '12:43' });
        expect(a.coach.status()).toEqual({ label: 'Squat', detail: '8 reps' });
        expect(a.watch.status()).toEqual({ label: 'Watching together', detail: 'YouTube tab' });
        expect(a.music.status()).toEqual({ label: 'Listening together', detail: 'Midnight City' });
        expect(a.journey.status()).toEqual({ label: 'Ocean', detail: '' });
    });

    test('copilot counts steps only when there is a list to count', () => {
        const bare = Contract.adapt(fakes.copilot());
        expect(bare.status().label).toBe('Watching with you');
        const raw = fakes.copilot();
        raw.steps = [1, 2, 3, 4, 5, 6];
        raw.index = 1;
        expect(Contract.adapt(raw).status().label).toBe('Step 2 of 6');
    });

    test('a status that throws is absent, not a crash', () => {
        const raw = fakes.focus();
        Object.defineProperty(raw, 'phase', {
            get() {
                throw new Error('x');
            },
        });
        expect(Contract.adapt(raw).status()).toBeNull();
    });
});

// ── the first screen ───────────────────────────────────────────────────────

describe('the chooser is ordered by user value', () => {
    test('exactly four tiles are primary', () => {
        const adapted = Object.values(adaptAll({ conversationId: 'c1' }));
        const primary = adapted.filter((a) => a.primary).map((a) => a.id);
        // Eight equal boxes is a product catalogue. These four are the ones somebody opens
        // the launcher to do.
        expect(primary.sort()).toEqual(['coach', 'copilot', 'focus', 'watch']);
    });

    test('order is stable and has no ties', () => {
        const orders = Object.values(adaptAll()).map((a) => a.order);
        expect(new Set(orders).size).toBe(orders.length);
    });
});

// ── the file's own promises ────────────────────────────────────────────────

describe('the adapter layer stays an adapter layer', () => {
    const code = codeOf(fs.readFileSync(SOURCE, 'utf8'));

    test('it never calls a media API of its own', () => {
        // B11's rule: `ConsentMachine` is the only thing that touches browser media. An
        // adapter that opened a stream would make the machine advisory.
        expect(code).not.toMatch(/getUserMedia|getDisplayMedia/);
    });

    test('it never requests consent — it only says who should', () => {
        expect(code).not.toMatch(/consent\s*\.\s*request/);
    });

    test('the only DOM it touches is a file input', () => {
        // `pickFile` is a file dialog, which is not capture and never reaches the machine.
        const creates = code.match(/createElement\(([^)]*)\)/g) || [];
        expect(creates).toEqual(["createElement('input')"]);
    });
});
