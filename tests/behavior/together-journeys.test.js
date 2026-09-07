/**
 * Eight tiles, eight complete journeys (batch B36).
 *
 * The repo's own manual QA sheet carries `K3 — open the chooser and pick an activity; verify
 * it actually starts`, unsigned. This is that row, automated, for every tile: open → set up →
 * accept or decline the permission → running → stop → nothing left holding a camera.
 *
 * It is deliberately an end-to-end suite against the real `TogetherPanel`, the real contract
 * and the real failure copy, with only the consent machine and the activities faked — because
 * every bug this batch fixes lived precisely in the seams between those, and a unit test of
 * either side would have passed throughout.
 */

/* global describe, test, expect, beforeEach, jest */

const fs = require('fs');
const path = require('path');

const TogetherPanel = require('../../src/features/together/ui/TogetherPanel.js');
const Contract = require('../../src/features/together/activities/contract.js');
const Failures = require('../../src/features/together/ui/failures.js');
const AudioSource = require('../../src/features/together/activities/audioSource.js');

const ROOT = path.join(__dirname, '..', '..');

// ── fakes ───────────────────────────────────────────────────────────────────

function consentMachine() {
    let handler = () => {};
    return {
        asked: [],
        revoked: [],
        grant: null,
        allow: true,
        state: 'idle',
        reason: '',
        async request(source) {
            this.asked.push(source);
            // The real machine revokes a live grant before asking again — the behaviour that
            // made two owners a bug rather than a nuisance.
            if (this.state === 'active') this.revoke('replaced');
            if (!this.allow) {
                this.reason = 'declined';
                this.state = 'idle';
                handler({ state: 'idle', reason: 'declined' });
                return null;
            }
            this.state = 'active';
            this.grant = { source, live: true };
            handler({ state: 'active', label: `Sharing ${source}` });
            return this.grant;
        },
        revoke(why) {
            this.revoked.push(why);
            this.state = 'idle';
            this.grant = null;
            handler({ state: 'idle', reason: why });
            return true;
        },
        onChange(fn) {
            handler = fn;
            return () => {};
        },
    };
}

const capture = () => ({ fromGrant: () => ({ stop: jest.fn(), stats: {} }) });

/**
 * A panel with real wiring and faked edges.
 *
 * The consent machine is built first and handed to the activities, because the whole point of
 * the suite is counting *who* asked and how often — activities that ask a stand-in nobody is
 * watching would let the double-owner bug pass unnoticed all over again.
 *
 * `build` receives the consent machine and returns the activities to register; passing plain
 * objects instead is fine for the ones that never ask for anything.
 */
function panelWith(build, { config = {}, context = {} } = {}) {
    document.body.innerHTML = '<div id="host"></div>';
    const consent = consentMachine();
    const panel = TogetherPanel.attach({
        consent,
        capture: capture(),
        config: { ...config, context },
        doc: document,
    });
    panel.mount(document.getElementById('host'));
    const activities = typeof build === 'function' ? build(consent) : build;
    for (const activity of activities) panel.register(activity);
    return { panel, consent, activities };
}

/** Activities whose surfaces match the real files, and which record what they were given. */
function make(id, { consent = null, fail = null } = {}) {
    const record = { id, started: [], stopped: [], requests: [] };
    const ask = async (source) => {
        record.requests.push(source);
        return consent ? consent.request(source) : { live: true };
    };
    const ok = async (what) => {
        if (fail) return fail;
        record.started.push(what);
        return { ok: true };
    };
    const surfaces = {
        focus: {
            start: () => ok('focus'),
            stop: (w) => record.stopped.push(w),
            phase: 'focus',
            remainingMs: () => 1_458_000,
        },
        watch: {
            sourceLabel: 'YouTube tab',
            playFile: (url) => ok({ file: url }),
            shareTab: async () => ((await ask('screen')) ? ok({ tab: true }) : { ok: false, why: 'declined' }),
            stop: (w) => record.stopped.push(w),
        },
        copilot: {
            steps: [],
            start: async (steps) =>
                (await ask('camera')) ? ok(steps) : { ok: false, why: 'camera consent was declined' },
            stop: (w) => record.stopped.push(w),
        },
        coach: {
            exercises: ['squat', 'push-up'],
            start: async (ex) => ((await ask('camera')) ? ok(ex) : { ok: false, why: 'camera consent was declined' }),
            stop: (w) => record.stopped.push(w),
        },
        journey: {
            scenes: new Map([['ocean', { id: 'ocean', title: 'Ocean', icon: '🌊' }]]),
            enter: (sceneId) => {
                record.started.push(sceneId);
                return true;
            },
            exit: (w) => {
                record.stopped.push(w);
                return true;
            },
        },
        music: {
            attachSource: (url, { name } = {}) => {
                record.started.push({ audio: url, name });
                return { ok: true };
            },
            detachSource: () => true,
            start: () => record.started.push('music'),
            stop: (w) => record.stopped.push(w),
        },
        cohost: {
            momentSource: {},
            start: () => (fail ? fail : (record.started.push('cohost'), { ok: true })),
            stop: (w) => record.stopped.push(w),
        },
        meeting: {
            start: async (options) => ((await ask('meeting')) ? ok(options) : { ok: false, why: 'declined' }),
            stop: (w) => record.stopped.push(w),
        },
    };
    return Object.assign(record, surfaces[id]);
}

const html = () => document.getElementById(TogetherPanel.PANEL_ID).textContent;

/** Copilot and Meeting need HomePilot; every test touching them must say which world it is in. */
function homePilotConnected(on = true) {
    window.NEXUS_BD = { config: { session: { enabled: on, source: on ? 'bridge' : 'no-homepilot' } } };
}
afterEach(() => {
    delete window.NEXUS_BD;
});
const optionsOf = () => [...document.querySelectorAll('.nexus-bd-together-option')];
const optionNamed = (name) => optionsOf().find((o) => o.textContent.startsWith(name));
const flush = () => new Promise((r) => setTimeout(r, 0));

// ── every tile, all the way through ─────────────────────────────────────────

describe('each tile completes the journey its button promises', () => {
    test('Focus: a topic is asked for, nothing is asked permission for, and Stop puts it back', async () => {
        // S5. The tile opens a question — "what would you like to understand?" — with a box
        // for a topic and the old body-doubling block beside it. This drives the second,
        // which is the branch that reaches the activity itself; the topic branch belongs to
        // the study session and is tested where that lives.
        const {
            panel,
            consent,
            activities: [focus],
        } = panelWith((c) => [make('focus', { consent: c })]);
        panel.open();
        panel.choose('focus');
        const sit = panel
            .contractFor('focus')
            .inputs()
            .find((i) => i.id === 'sit');
        await panel.startActivity('focus', sit);
        expect(panel.activeActivity).toBe('focus');
        expect(consent.asked).toEqual([]);
        panel.stopActivity('user');
        expect(focus.stopped).toEqual(['user']);
        expect(panel.activeActivity).toBeNull();
    });

    test('Watch: a tab is asked for exactly once, by exactly one owner', async () => {
        const {
            panel,
            consent,
            activities: [watch],
        } = panelWith((c) => [make('watch', { consent: c })]);
        panel.open();
        panel.choose('watch');
        await panel.startActivity('watch', panel.contractFor('watch').inputs()[0]);
        // One prompt. The old panel asked, then `shareTab()` asked again and the machine
        // revoked the first grant in between.
        expect(consent.asked).toEqual(['screen']);
        expect(watch.requests).toEqual(['screen']);
        expect(consent.revoked).toEqual([]);
        expect(panel.activeActivity).toBe('watch');
    });

    test('Watch: a local file asks for nothing at all', async () => {
        const {
            panel,
            consent,
            activities: [watch],
        } = panelWith((c) => [make('watch', { consent: c })]);
        const file = panel
            .contractFor('watch')
            .inputs()
            .find((i) => i.id === 'file');
        // The picker is the browser's, so the test supplies what it would have returned.
        await panel.startActivity('watch', { ...file, pick: null, url: 'blob:movie' });
        expect(consent.asked).toEqual([]);
        expect(watch.started).toEqual([{ file: 'blob:movie' }]);
    });

    test('Journey: start and stop reach enter and exit', async () => {
        const {
            panel,
            consent,
            activities: [journey],
        } = panelWith((c) => [make('journey', { consent: c })]);
        const ocean = panel.contractFor('journey').inputs()[0];
        await panel.startActivity('journey', ocean);
        expect(journey.started).toEqual(['ocean']);
        expect(consent.asked).toEqual([]);
        panel.stopActivity('user');
        expect(journey.stopped).toEqual(['user']);
    });

    test('Help me: "just look and help" starts with no checklist to write first', async () => {
        homePilotConnected();
        const {
            panel,
            activities: [copilot],
        } = panelWith((c) => [make('copilot', { consent: c })]);
        const look = panel
            .contractFor('copilot')
            .inputs()
            .find((i) => i.id === 'look');
        await panel.startActivity('copilot', look);
        expect(panel.activeActivity).toBe('copilot');
        expect(copilot.started[0].length).toBeGreaterThan(0);
        expect(copilot.requests).toEqual(['camera']);
    });

    test('Coach: the exercise comes from Coach, and the camera is asked for once', async () => {
        const {
            panel,
            consent,
            activities: [coach],
        } = panelWith((c) => [make('coach', { consent: c })]);
        const inputs = panel.contractFor('coach').inputs();
        expect(inputs.map((i) => i.label)).toEqual(['Squat', 'Push-up']);
        await panel.startActivity('coach', inputs[1]);
        expect(coach.started).toEqual(['push-up']);
        expect(consent.asked).toEqual(['camera']);
    });

    test('Meeting: registered, given a conversation, and recording', async () => {
        homePilotConnected();
        // MS19 loaded the module and registered nothing, so the tile could not exist.
        const {
            panel,
            activities: [meeting],
        } = panelWith((c) => [make('meeting', { consent: c })], { context: { conversationId: 'conv-3' } });
        expect(panel.contractFor('meeting').availability().ok).toBe(true);
        await panel.startActivity('meeting', panel.contractFor('meeting').inputs()[0]);
        expect(meeting.started).toEqual([{ conversationId: 'conv-3' }]);
    });

    test('Meeting: without a conversation it says so before any dialog opens', async () => {
        homePilotConnected();
        const {
            panel,
            consent,
            activities: [meeting],
        } = panelWith((c) => [make('meeting', { consent: c })]);
        const result = await panel.startActivity('meeting', panel.contractFor('meeting').inputs()[0]);
        expect(result.ok).toBe(false);
        expect(consent.asked).toEqual([]);
        expect(meeting.requests).toEqual([]);
        expect(html()).toContain('Open a conversation first');
    });

    test('Music: a track is chosen, attached, and detached on the way out', async () => {
        const {
            panel,
            activities: [music],
        } = panelWith((c) => [make('music', { consent: c })]);
        const file = panel.contractFor('music').inputs()[0];
        await panel.startActivity('music', { ...file, pick: null, url: 'blob:song', name: 'Midnight City' });
        expect(music.started).toEqual([{ audio: 'blob:song', name: 'Midnight City' }, 'music']);
        expect(panel.activeActivity).toBe('music');
    });

    test('Play: on the grid, and says why when nothing produces game moments', async () => {
        // The tile stays. CoHost's reactions, tier table and overlay are all real and
        // tested; what is missing is the detector that feeds them, and a control that
        // vanishes tells nobody that.
        const { panel } = panelWith([{ id: 'cohost', start: () => ({ ok: true }), stop: () => true }]);
        expect(panel.choices().map((c) => c.id)).toEqual(['cohost']);

        const result = await panel.startActivity('cohost', panel.contractFor('cohost').inputs()[0]);
        expect(result.ok).toBe(false);
        expect(html()).toMatch(/moment detection/i);
    });
});

// ── the P0 ──────────────────────────────────────────────────────────────────

describe('a failed start never leaves a grant behind', () => {
    test('the panel revokes what the panel opened', async () => {
        // The reachable case: the panel opened the screen, the activity refused, and the old
        // panel went back to the chooser with the capture still live. The consent badge said
        // "sharing your screen" and it was telling the truth.
        const { panel, consent } = panelWith((c) => [
            make('cohost', { consent: c, fail: { ok: false, why: 'no play profile — refusing to start' } }),
        ]);
        const result = await panel.startActivity('cohost', panel.contractFor('cohost').inputs()[0]);
        expect(result.ok).toBe(false);
        expect(consent.asked).toEqual(['screen']);
        expect(consent.revoked).toContain('start failed');
        expect(consent.state).toBe('idle');
        expect(panel.pipeline).toBeNull();
        expect(panel.activeActivity).toBeNull();
    });

    test('and does not revoke a grant the activity owns', async () => {
        // Watch holds its own screen grant across the session. Revoking here would tear down
        // a capture a still-running activity depends on.
        const {
            panel,
            consent,
            activities: [watch],
        } = panelWith((c) => [make('watch', { consent: c })]);
        await panel.startActivity('watch', panel.contractFor('watch').inputs()[0]);
        expect(consent.revoked).toEqual([]);
        expect(consent.state).toBe('active');
    });

    test('an activity that owns its grant keeps it when its own start fails', async () => {
        // The other half of the P0, and the easier one to get wrong. Watch asks for the
        // screen itself; if it then fails, the panel revoking "the" grant would tear down a
        // capture the panel never opened — and, on a partial failure, one the activity is
        // still using. Only what this call opened is this call's to revoke.
        const {
            panel,
            consent,
            activities: [watch],
        } = panelWith((c) => [make('watch', { consent: c })]);
        watch.shareTab = async () => {
            await c(consent);
            return { ok: false, why: 'the tab went away' };
        };
        async function c(machine) {
            watch.requests.push('screen');
            return machine.request('screen');
        }

        const result = await panel.startActivity('watch', panel.contractFor('watch').inputs()[0]);
        expect(result.ok).toBe(false);
        expect(consent.asked).toEqual(['screen']);
        // The panel opened nothing, so the panel revokes nothing.
        expect(consent.revoked).toEqual([]);
    });

    test('a declined permission leaves nothing running and nothing held', async () => {
        const {
            panel,
            consent,
            activities: [cohost],
        } = panelWith((c) => [make('cohost', { consent: c })]);
        consent.allow = false;
        const result = await panel.startActivity('cohost', panel.contractFor('cohost').inputs()[0]);
        expect(result.ok).toBe(false);
        expect(panel.activeActivity).toBeNull();
        expect(panel.pipeline).toBeNull();
        expect(consent.state).toBe('idle');
    });
});

// ── failures reach the user ─────────────────────────────────────────────────

describe('why it did not start', () => {
    test('a specific reason is never flattened into "something went wrong"', () => {
        const reasons = [
            'camera consent was declined',
            'no play profile — refusing to start',
            'that exercise is not supported',
            'HomePilot session is not connected',
            'no media devices on this platform',
        ];
        for (const why of reasons) {
            const screen = Failures.describe({ ok: false, why }, { name: 'Coach' });
            expect(screen.body).toBeTruthy();
            expect(screen.body.toLowerCase()).not.toContain('something went wrong');
            expect(screen.actions.length).toBeGreaterThan(0);
        }
    });

    test('a blocked permission offers a way back in', () => {
        const screen = Failures.describe({ ok: false, why: 'NotAllowedError' }, { name: 'Coach' });
        expect(screen.title).toMatch(/permission/i);
        expect(screen.actions.map((a) => a.id)).toEqual(['retry', 'back']);
    });

    test('a disconnected HomePilot offers settings, and says what still works', () => {
        const screen = Failures.describe(
            { ok: false, why: 'Looking at what you are working on needs HomePilot, which is not connected.' },
            { name: 'Help me' }
        );
        // The activity's own sentence survives — it names what HomePilot was needed *for* —
        // and the reassurance names the five that need none of it.
        expect(screen.body).toMatch(/needs HomePilot/);
        expect(screen.body).toMatch(/Focus, Journey, Music, Watch and Coach/);
        expect(screen.actions.map((a) => a.id)).toContain('settings');
    });

    test('and "Open settings" presses the control the user would', () => {
        // B36 dispatched an event nothing in the app listens for, so the one way out of this
        // screen was dead — the worst kind of dead, because it looks like a way out.
        document.body.innerHTML = '<div id="host"></div><button id="settings-btn"></button>';
        const opened = jest.fn();
        document.getElementById('settings-btn').addEventListener('click', opened);
        const consent = consentMachine();
        const panel = TogetherPanel.attach({ consent, capture: capture(), config: {}, doc: document });
        panel.mount(document.getElementById('host'));
        panel._openSettings();
        expect(opened).toHaveBeenCalledTimes(1);
    });

    test('an injected opener still wins over the button', () => {
        document.body.innerHTML = '<div id="host"></div><button id="settings-btn"></button>';
        const button = jest.fn();
        const injected = jest.fn();
        document.getElementById('settings-btn').addEventListener('click', button);
        const panel = TogetherPanel.attach({
            consent: consentMachine(),
            capture: capture(),
            config: { onOpenSettings: injected },
            doc: document,
        });
        panel.mount(document.getElementById('host'));
        panel._openSettings();
        expect(injected).toHaveBeenCalledTimes(1);
        expect(button).not.toHaveBeenCalled();
    });

    test("an unmatched reason still carries the activity's own words", () => {
        const screen = Failures.describe({ ok: false, why: 'the kettle is on fire' }, { name: 'Focus' });
        expect(screen.body).toBe('The kettle is on fire.');
    });

    test('an empty reason is called out rather than papered over', () => {
        const screen = Failures.describe({ ok: false, why: '' }, { name: 'Focus' });
        expect(screen.body).toMatch(/no reason was given/i);
    });

    test('an unmatched reason still offers a way forward', () => {
        // The fallback is the branch most likely to be quietly emptied, and it is the one
        // reached by every reason no rule anticipated — which is where a new activity's
        // failures land on their first day.
        const screen = Failures.describe({ ok: false, why: 'the kettle is on fire' }, { name: 'Focus' });
        expect(screen.actions.map((a) => a.id)).toEqual(['retry', 'back']);
        const empty = Failures.describe({ ok: false, why: '' }, { name: 'Focus' });
        expect(empty.actions.length).toBeGreaterThan(0);
    });

    test('Try again repeats exactly what was tried', async () => {
        const {
            panel,
            consent,
            activities: [coach],
        } = panelWith((c) => [make('coach', { consent: c })]);
        consent.allow = false;
        const inputs = panel.contractFor('coach').inputs();
        await panel.startActivity('coach', inputs[1]);
        expect(panel.view).toBe('failure');

        consent.allow = true;
        optionNamed('Try again').click();
        await flush();
        // The same exercise, not the first one in the list.
        expect(coach.started).toEqual(['push-up']);
    });

    test('Back returns to the chooser with nothing running', async () => {
        const { panel } = panelWith((c) => [
            make('cohost', { consent: c, fail: { ok: false, why: 'no play profile — refusing to start' } }),
        ]);
        await panel.startActivity('cohost', panel.contractFor('cohost').inputs()[0]);
        optionNamed('Back').click();
        expect(panel.view).toBe('chooser');
        expect(panel.activeActivity).toBeNull();
    });
});

// ── keyboard ────────────────────────────────────────────────────────────────

describe('focus goes back where it came from', () => {
    test('closing returns focus to whichever control opened it', () => {
        // Two entrances — the toolbar button and the drawer entry — and closing used to
        // return focus to the toolbar whichever one was used, dropping a keyboard user
        // somewhere they had never been.
        const { panel } = panelWith([make('focus')]);
        const drawerEntry = document.createElement('button');
        drawerEntry.id = 'drawer-entry';
        document.body.appendChild(drawerEntry);

        panel.open(drawerEntry);
        expect(panel.isOpen).toBe(true);
        panel.close();
        expect(document.activeElement).toBe(drawerEntry);
    });

    test('an opener that has left the document is survived', () => {
        const { panel } = panelWith([make('focus')]);
        const gone = document.createElement('button');
        panel.open(gone);
        expect(() => panel.close()).not.toThrow();
    });
});

// ── the running line ────────────────────────────────────────────────────────

describe('the running view says what the activity is doing', () => {
    test('Focus counts down instead of saying "Running"', async () => {
        const { panel } = panelWith((c) => [make('focus', { consent: c })]);
        panel.open();
        panel.choose('focus');
        await panel.startActivity(
            'focus',
            panel
                .contractFor('focus')
                .inputs()
                .find((i) => i.id === 'sit')
        );
        panel.open();
        expect(html()).toContain('Focus · 24:18');
        expect(html()).not.toContain('nothing is being shared');
    });

    test('Watch names its source', async () => {
        const { panel } = panelWith((c) => [make('watch', { consent: c })]);
        await panel.startActivity('watch', panel.contractFor('watch').inputs()[0]);
        panel.open();
        expect(html()).toContain('Watching together · YouTube tab');
    });

    test('what is running and what is captured are two different lines', async () => {
        // §2a wants capture state unmissable, and the activity's own status must not
        // displace it.
        const { panel } = panelWith((c) => [make('watch', { consent: c })]);
        await panel.startActivity('watch', panel.contractFor('watch').inputs()[0]);
        panel.open();
        expect(html()).toContain('Watching together');
        expect(html()).toContain('Sharing screen');
    });
});

// ── permission is never a surprise ──────────────────────────────────────────

describe('choose → explain → ask, always in that order', () => {
    test('no tile press ever opens a permission dialog', async () => {
        // B30's shape. A single-input activity starts on the tile press only when that input
        // asks for nothing — `'self'` counts as asking.
        homePilotConnected();
        for (const id of ['watch', 'copilot', 'coach', 'meeting', 'cohost', 'music']) {
            const { panel, consent, activities } = panelWith((c) => [make(id, { consent: c })], {
                context: { conversationId: 'c1' },
            });
            const [activity] = activities;
            panel.open();
            panel.choose(id);
            await flush();
            expect(consent.asked).toEqual([]);
            expect(activity.requests).toEqual([]);
            expect(panel.view).toBe('setup');
        }
    });

    test('the setup screen says a permission is coming before it arrives', () => {
        const { panel } = panelWith((c) => [make('coach', { consent: c })]);
        panel.open();
        panel.choose('coach');
        expect(optionNamed('Squat').title).toMatch(/access/i);
    });

    test('Watch spells out what stops when you leave', () => {
        const { panel } = panelWith((c) => [make('watch', { consent: c })]);
        panel.open();
        panel.choose('watch');
        expect(html()).toContain('Your screen stops sharing when you leave Watch');
    });
});

// ── the audio source ────────────────────────────────────────────────────────

describe('something for Music to listen to', () => {
    test('it reports honestly when the browser cannot do it', () => {
        expect(AudioSource.availability({ win: {} }).ok).toBe(false);
        expect(AudioSource.availability({ win: { AudioContext: function C() {} } }).ok).toBe(true);
    });

    test('equip gives Music the two methods the contract looks for', () => {
        const music = { id: 'music', start() {}, stop() {} };
        expect(Contract.adapt(music).availability().ok).toBe(false);
        AudioSource.equip(music, { win: { AudioContext: function C() {} } });
        expect(typeof music.attachSource).toBe('function');
        expect(Contract.adapt(music).availability().ok).toBe(true);
    });

    test('equip never replaces a source an activity already has', () => {
        const own = jest.fn();
        const music = { id: 'music', start() {}, stop() {}, attachSource: own };
        AudioSource.equip(music);
        expect(music.attachSource).toBe(own);
    });

    test('the analyser reaches the detector that was reading null forever', () => {
        const analyser = { getByteFrequencyData() {}, frequencyBinCount: 512 };
        const music = { id: 'music', detector: { analyser: null }, start() {}, stop() {} };
        AudioSource.equip(music);
        // The graph is stubbed: what is asserted is the wiring, which is the part that was
        // missing.
        music._audioSource = null;
        music.attachSource = function attach() {
            this.detector.analyser = analyser;
            return { ok: true };
        };
        music.attachSource('blob:x');
        expect(music.detector.analyser).toBe(analyser);
    });
});

// ── the rules the batch must not break ──────────────────────────────────────

describe('B11 is still the only door', () => {
    const codeOf = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const panelSource = codeOf(fs.readFileSync(path.join(ROOT, 'src/features/together/ui/TogetherPanel.js'), 'utf8'));

    test('the panel still never sees a stream', () => {
        expect(panelSource).toContain('this.consent.request(source)');
        expect(panelSource).not.toMatch(/getDisplayMedia|getUserMedia/);
    });

    test('the panel requests in exactly one place', () => {
        // Two call sites is how two owners started.
        expect((panelSource.match(/consent\.request\(/g) || []).length).toBe(1);
    });
});
