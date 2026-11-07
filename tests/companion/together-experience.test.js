/**
 * IC3. Life, Copilot and Experiences, reviewed click by click and fixed: every choice does what
 * its name says in one step, she says something when it starts, she can start it from the
 * conversation, and nothing claims to be running after it stopped.
 */
const fs = require('fs');
const path = require('path');

const Voice = require('../../src/companion/ActivityVoice');
const Directive = require('../../src/companion/ActivityDirective');
const Session = require('../../src/companion/CompanionSession');
const Intent = require('../../src/companion/ContextIntent');
require('../../src/companion/ActivityMarks');

function memoryStorage() {
    const data = new Map();
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => data.set(k, String(v)),
        removeItem: (k) => data.delete(k),
    };
}
const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};

function surface() {
    const posted = [];
    const stored = [];
    return {
        posted,
        stored,
        turn: () => ({ phase: 'idle' }),
        renderAssistant: (line) => posted.push(line),
        history: () => ({ addMessage: (role, text) => stored.push([role, text]), persist() {} }),
    };
}

describe('she says one line when an activity starts, in her own words', () => {
    function setup(reply) {
        const session = Session.create({ storage: memoryStorage() });
        session.load();
        const s = surface();
        const asked = [];
        const requests = [];
        Voice.attach({
            session,
            surface: s,
            ask: async (text) => {
                asked.push(text);
                return typeof reply === 'function' ? reply(text) : reply;
            },
            reset: { currentEpoch: () => 1, isCurrent: () => true },
            behavior: { request: (name) => requests.push(name) },
            label: Intent.label,
            say: () => {},
        });
        return { session, s, asked, requests };
    }

    test('a Together choice gets one line, posted and kept like any reply, and her posture follows', async () => {
        const { session, s, asked, requests } = setup("Sure. I'm right here.");
        session.enter('life', 'relax');
        await flush();
        expect(asked).toHaveLength(1);
        expect(asked[0]).toContain('"Relaxing together"');
        expect(asked[0]).toMatch(/at most 15 words/);
        expect(s.posted).toEqual(["Sure. I'm right here."]);
        expect(s.stored).toEqual([['assistant', "Sure. I'm right here."]]);
        expect(requests).toEqual(['relax']);
    });

    test('nothing for a context the conversation set, or a start she made herself', async () => {
        const { session, asked } = setup('Hi');
        session.enter('copilot', 'help', { source: 'conversation' });
        session.enter('experiences', 'seaside', { source: 'together', silent: true });
        await flush();
        expect(asked).toHaveLength(0);
    });

    test('no model configured, a tag, or a CLEAR: nothing posted', async () => {
        const a = setup('Provider not configured.');
        a.session.enter('life', 'talk');
        await flush();
        expect(a.s.posted).toEqual([]);
        const b = setup('Here we are. <activity name="relax"/>');
        b.session.enter('experiences', 'forest');
        await flush();
        expect(b.s.posted).toEqual(['Here we are.']);
    });

    test('tapping through options asks once per tap but only the newest line is posted', async () => {
        let n = 0;
        const { session, s } = setup(() => `line ${++n}`);
        session.enter('life', 'talk');
        session.enter('copilot', 'work');
        await flush();
        expect(s.posted).toEqual(['line 2']);
    });

    test('Learn and Tasks open with their own question, so she adds none', async () => {
        const { session, asked } = setup('Hi');
        session.enter('copilot', 'learn');
        session.enter('copilot', 'tasks');
        await flush();
        expect(asked).toHaveLength(0);
    });

    test('ending an activity she started gets one short closing line', async () => {
        const { session, asked } = setup('That was nice.');
        session.enter('experiences', 'meditation');
        await flush();
        session.end();
        await flush();
        expect(asked[1]).toContain('just ended "Ten quiet minutes"');
    });
});

describe('she can start it from the conversation: <activity name="…"/>', () => {
    test('the tag is stripped from what is shown, one per reply, closed set', () => {
        expect(Directive.extract('Let\'s breathe. <activity name="relax"/>')).toEqual({
            call: { name: 'relax', minutes: null },
            clean: "Let's breathe.",
        });
        expect(Directive.extract('<activity name="focus" minutes="200"/> Go.').call).toEqual({
            name: 'focus',
            minutes: 90,
        });
        const bad = Directive.extract('Sure <activity name="hack"/>');
        expect(bad.call).toBeNull();
        expect(bad.clean).toBe('Sure');
    });

    test('described to the model only while Together is on', () => {
        expect(Directive.systemPromptSuffix(false)).toBe('');
        const text = Directive.systemPromptSuffix(true);
        for (const name of Directive.NAMES) expect(text).toContain(`name="${name}"`);
        expect(text).toMatch(/never claim it started before the app has shown it/);
    });

    test('relax and focus start the same things the Together buttons start', async () => {
        const session = Session.create({ storage: memoryStorage() });
        session.load();
        const started = [];
        const panel = { startActivity: async (id, opt) => (started.push([id, opt]), { ok: true }) };
        await Directive.run({ name: 'relax' }, { session, panel: () => panel, enabled: () => true });
        expect(started[0]).toEqual(['focus', { id: 'sit', permission: null }]);
        expect(session.destination()).toBe('life');
        await Directive.run({ name: 'focus', minutes: 50 }, { session, panel: () => panel, enabled: () => true });
        expect(started[1]).toEqual(['focus', { id: 'work', permission: null, minutes: 50 }]);
        expect(session.source()).toBe('together');
    });

    test('Together switched off: the tag does nothing', async () => {
        const started = [];
        const panel = { startActivity: async (id) => started.push(id) };
        const result = await Directive.run({ name: 'relax' }, { panel: () => panel, enabled: () => false });
        expect(result).toEqual({ ok: false, why: 'together-off' });
        expect(started).toEqual([]);
    });

    test('main.js consumes the tag at both reply seams, next to the wardrobe tag', () => {
        const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
        expect((main.match(/NEXUS_COMPANION\.consume\(displayText\)/g) || []).length).toBe(2);
    });
});

describe('nothing claims to be running after it stopped', () => {
    test('a Together activity does not come back after a reload; conversation context does', () => {
        const storage = memoryStorage();
        const first = Session.create({ storage });
        first.load();
        first.enter('experiences', 'scene-tale');
        const index = fs.readFileSync(path.join(__dirname, '../../src/companion/index.js'), 'utf8');
        expect(index).toMatch(/session\.end\(\{ silent: true \}\)/);
        // The rule index.js applies on load, in isolation:
        const Marks = window.NEXUS_COMPANION_MARKS;
        const again = Session.create({ storage });
        again.load();
        if (again.active() && again.source() === 'together' && Marks.EXPLICIT.includes(again.activity()))
            again.end({ silent: true });
        expect(again.active()).toBe(false);
        const talk = Session.create({ storage: memoryStorage() });
        talk.load();
        talk.enter('life', 'relax', { source: 'conversation' });
        expect(Marks.EXPLICIT.includes(talk.activity()) && talk.source() === 'together').toBe(false);
    });
});

describe('each story setup screen is its own', () => {
    test('Life Evening shows its own title, question and example — not Scene Tale', () => {
        const Playground = require('../../src/features/together/activities/playground');
        window.NEXUS_BD_PLAYGROUND = Playground;
        const life = Playground.PLAYGROUNDS.find((p) => p.id === 'life-evening');
        expect(life.title).toBe('An evening together');
        const view = fs.readFileSync(
            path.join(__dirname, '../../src/features/together/ui/SceneTaleSetupView.js'),
            'utf8'
        );
        expect(view).toMatch(/storySpec\(doc, create\.dataset\.playground\)/);
        expect(view).not.toMatch(/title\.textContent = 'Scene Tale';/);
        const pg = fs.readFileSync(
            path.join(__dirname, '../../src/features/together/activities/playground.js'),
            'utf8'
        );
        expect(pg).toMatch(/create\.dataset\.playground = spec\.id/);
    });
});

describe('a start that fails is not greeted', () => {
    test('the session ends while she is asked: no line', async () => {
        const session = Session.create({ storage: memoryStorage() });
        session.load();
        const s = surface();
        let release;
        Voice.attach({
            session,
            surface: s,
            ask: () => new Promise((r) => (release = r)),
            label: Intent.label,
            say: () => {},
        });
        session.enter('life', 'move');
        session.end({ silent: true }); // the camera was blocked
        release('Let us move!');
        await flush();
        expect(s.posted).toEqual([]);
    });

    function moving() {
        jest.useFakeTimers();
        const session = Session.create({ storage: memoryStorage() });
        session.load();
        const s = surface();
        const panel = { activeActivity: null };
        Voice.attach({
            session,
            surface: s,
            ask: async () => "Let's move.",
            panel: () => panel,
            label: Intent.label,
            say: () => {},
        });
        return { session, s, panel };
    }
    afterEach(() => jest.useRealTimers());

    test('Move together waits for the coach to run before she speaks', async () => {
        const { session, s, panel } = moving();
        session.enter('life', 'move');
        await flush();
        jest.advanceTimersByTime(1000);
        await flush();
        expect(s.posted).toEqual([]); // the camera prompt is still up
        panel.activeActivity = 'coach';
        jest.advanceTimersByTime(250);
        await flush();
        expect(s.posted).toEqual(["Let's move."]);
    });

    test('Move together refused after a fast answer: no line', async () => {
        const { session, s } = moving();
        session.enter('life', 'move');
        await flush();
        session.end({ silent: true }); // the camera was blocked
        jest.advanceTimersByTime(250);
        await flush();
        expect(s.posted).toEqual([]);
    });
});

describe('a failure names what the person chose', () => {
    test('Move together under Life never says "Copilot needs permission"', () => {
        const src = fs.readFileSync(path.join(__dirname, '../../src/features/together/activities/contract.js'), 'utf8');
        expect(src).toMatch(/as: 'Move together'/);
        const panel = fs.readFileSync(path.join(__dirname, '../../src/features/together/ui/TogetherPanel.js'), 'utf8');
        expect(panel).toMatch(/attempt && attempt\.as/);
    });
});
