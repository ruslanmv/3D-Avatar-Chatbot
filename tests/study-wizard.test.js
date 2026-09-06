/**
 * The topic is asked for in the panel, and she starts speaking (batch S5).
 *
 * Before this, Focus opened the tile, closed the panel, and asked "what shall we understand
 * today?" in the conversation — a question arriving on screen at the exact moment the user has
 * finished dismissing a panel, and answered by typing into a chat box that a study session had
 * to intercept before the media parser could mistake "play me some music theory" for a request
 * to play music.
 *
 * Every other activity that needs something from you collects it before it starts. Copilot
 * takes its checklist that way; Watch takes a file or a tab. Focus is now the same shape: the
 * question is the setup screen's prompt, the answer is a box, and pressing Start begins the
 * session — which means reading first, then handing over to her, out loud.
 */

const Contract = require('../src/features/together/activities/contract.js');
const TogetherPanel = require('../src/features/together/ui/TogetherPanel.js');
const Session = require('../src/features/study/StudySession.js');
const Loop = require('../src/features/study/StudyLoop.js');

const ARTICLE = {
    id: 'Photosynthesis',
    source: 'wikipedia',
    title: 'Photosynthesis',
    extract: 'Photosynthesis is a system of biological processes by which light becomes chemical energy. '.repeat(4),
    url: 'https://en.wikipedia.org/wiki/Photosynthesis',
};

/** What `YouTubeAsk.say` does, reduced to the two facts the loop depends on. */
function transcript() {
    const lines = [];
    window.NEXUS_YT_ASK = {
        say: (text, who) => {
            lines.push([who, String(text)]);
            return { text, who };
        },
    };
    return lines;
}

beforeEach(() => {
    localStorage.clear();
    Session.reset();
    window.NEXUS_STUDY_SESSION = Session;
    window.NEXUS_STUDY_LOOP = Loop;
    window.NEXUS_RESEARCH = { read: async () => ({ ok: true, sources: [ARTICLE], used: 'wikipedia' }) };
    delete window._handleNonStreamingResponse;
    delete window.NEXUS_YT_ASK;
});

// ── the setup screen ─────────────────────────────────────────────────────────

describe('the tile asks the question instead of the chat', () => {
    const focus = () => Contract.adapt({ id: 'focus', start: () => ({ ok: true }), stop: () => true });

    test('the prompt is the question she used to type into the conversation', () => {
        expect(focus().prompt).toMatch(/what would you like to understand/i);
    });

    test('there is a box to type a topic into, sized for a topic', () => {
        const start = focus()
            .inputs()
            .find((i) => i.id === 'study');
        expect(start.wantsText).toBe(true);
        // Copilot's checklist gets four rows. A topic is one line, and a four-row box asks
        // for an essay nobody intends to write.
        expect(start.rows).toBe(2);
        expect(start.placeholder).toBeTruthy();
    });

    test('and neither answer asks for a permission', () => {
        // Focus captures nothing. It did not before and the wizard has not changed that.
        for (const input of focus().inputs()) {
            expect(input.permission).toBeNull();
        }
    });

    test('body doubling survives as the second answer', () => {
        // "Just sit with me" is a real answer to "what would you like to understand?", and
        // the silent block is the best-engineered part of what Focus used to be.
        const sit = focus()
            .inputs()
            .find((i) => i.id === 'sit');
        expect(sit).toBeTruthy();
        expect(sit.label).toMatch(/sit with me/i);
    });
});

describe('what the button does with what was typed', () => {
    function focusWith(record) {
        return Contract.adapt({
            id: 'focus',
            start: () => {
                record.push('body-doubling');
                return { ok: true };
            },
            stop: () => true,
        });
    }

    test('a topic starts a study session about that topic', async () => {
        const record = [];
        const asked = [];
        window.NEXUS_STUDY_LOOP = { startWithTopic: (t) => asked.push(t) };
        const result = await focusWith(record).start({ input: { id: 'study', text: 'how photosynthesis works' } });
        expect(asked).toEqual(['how photosynthesis works']);
        expect(result.ok).toBe(true);
        expect(result.mode).toBe('study');
        expect(record).toEqual([]);
    });

    test('"just sit with me" is still the silent block, with nothing looked up', async () => {
        const record = [];
        const asked = [];
        window.NEXUS_STUDY_LOOP = { startWithTopic: (t) => asked.push(t) };
        await focusWith(record).start({ input: { id: 'sit' } });
        expect(asked).toEqual([]);
        expect(record).toEqual(['body-doubling']);
    });

    test('and "just sit with me" is body doubling even with a topic in the box', async () => {
        // The panel only puts the box's contents on the input that asked for them, so this
        // cannot happen through the UI today. It is asserted anyway: the contract reads a
        // field any caller can set, and "sit" means sit whatever else is on the screen.
        const record = [];
        const asked = [];
        window.NEXUS_STUDY_LOOP = { startWithTopic: (t) => asked.push(t) };
        await focusWith(record).start({ input: { id: 'sit', text: 'how photosynthesis works' } });
        expect(asked).toEqual([]);
        expect(record).toEqual(['body-doubling']);
    });

    test('Start with an empty box asks in the chat rather than refusing the tap', async () => {
        const record = [];
        const opened = [];
        window.NEXUS_STUDY_LOOP = { startWithTopic: () => opened.push('topic'), open: () => opened.push('open') };
        await focusWith(record).start({ input: { id: 'study', text: '   ' } });
        expect(opened).toEqual(['open']);
    });

    test('and a study session that throws still leaves a working tile', async () => {
        const record = [];
        window.NEXUS_STUDY_LOOP = {
            startWithTopic: () => {
                throw new Error('offline');
            },
        };
        await expect(
            focusWith(record).start({ input: { id: 'study', text: 'photosynthesis' } })
        ).resolves.toMatchObject({ ok: true });
        expect(record).toEqual(['body-doubling']);
    });

    test('an install with no study module at all is the old Focus, exactly', async () => {
        const record = [];
        delete window.NEXUS_STUDY_LOOP;
        await focusWith(record).start({ input: { id: 'study', text: 'photosynthesis' } });
        expect(record).toEqual(['body-doubling']);
    });
});

describe('Stop ends whichever of the two is running', () => {
    function focusWith(record) {
        return Contract.adapt({
            id: 'focus',
            start: () => {
                record.push('body-doubling');
                return { ok: true };
            },
            stop: (why) => record.push(`stopped:${why}`),
        });
    }

    test('a study session is finished, not abandoned behind a closed panel', async () => {
        const record = [];
        const lines = transcript();
        await Loop.startWithTopic('photosynthesis');
        expect(Session.isRunning()).toBe(true);
        focusWith(record).stop('user');
        expect(Session.isRunning()).toBe(false);
        // Finished rather than dropped: the closing line is the session's own record of what
        // happened, and it is the difference between stopping and losing it.
        expect(lines[lines.length - 1][1]).toMatch(/photosynthesis/);
        // And the block underneath was never running, so it was not stopped.
        expect(record).toEqual([]);
    });

    test('with no session it is the body-doubling block, exactly as before', () => {
        const record = [];
        focusWith(record).stop('user');
        expect(record).toEqual(['stopped:user']);
    });

    test('a study module that will not close still lets the tile turn off', async () => {
        const record = [];
        transcript();
        await Loop.startWithTopic('photosynthesis');
        window.NEXUS_STUDY_LOOP = {
            finish: () => {
                throw new Error('boom');
            },
        };
        expect(focusWith(record).stop('user')).toBe(true);
        expect(record).toEqual(['stopped:user']);
    });
});

// ── starting from a topic the panel collected ────────────────────────────────

describe('startWithTopic runs the three steps, in the order that teaches', () => {
    test('the topic goes in as the user said it, before the reading', async () => {
        const lines = transcript();
        await Loop.startWithTopic('how photosynthesis works');
        expect(lines[0]).toEqual(['user', 'how photosynthesis works']);
        expect(lines[1][0]).toBe('bot');
        expect(lines[1][1]).toMatch(/read up on/i);
    });

    test('because a model that cannot see the topic is teaching one nobody named', async () => {
        // The transcript is what the next turn is built from. A topic typed into a panel is
        // still something the user said, and leaving it out of the history was the bug M7
        // spent a batch fixing in the other direction.
        const lines = transcript();
        await Loop.startWithTopic('photosynthesis');
        expect(lines.filter(([who]) => who === 'user').map(([, text]) => text)).toEqual(['photosynthesis']);
    });

    test('the citation names where it actually came from', async () => {
        const lines = transcript();
        window.NEXUS_RESEARCH = { read: async () => ({ ok: true, sources: [ARTICLE], used: 'web' }) };
        await Loop.startWithTopic('photosynthesis');
        expect(lines[1][1]).toMatch(/the web/);
        expect(lines[1][1]).toContain(ARTICLE.url);
    });

    test('then she speaks — through the app’s own reply path, so it is said out loud', async () => {
        // The whole ask: "when we click start the ai will start speaking". Anything that
        // renders a bot line by itself would be text on a screen with no voice, no lipsync
        // and no tag stripping.
        transcript();
        const replied = [];
        window._handleNonStreamingResponse = async (text) => replied.push(text);
        await Loop.startWithTopic('photosynthesis');
        expect(replied).toEqual(['photosynthesis']);
    });

    test('and it does not record the turn twice on the way', async () => {
        // `handleUserMessage` would have been the obvious call and is the wrong one: its
        // first act is to write the user turn, which step one has already done.
        const lines = transcript();
        const replied = [];
        window._handleNonStreamingResponse = async (text) => replied.push(text);
        await Loop.startWithTopic('photosynthesis');
        expect(lines.filter(([who]) => who === 'user')).toHaveLength(1);
    });

    test('the session is left in the phase that asks what you already know', async () => {
        transcript();
        await Loop.startWithTopic('photosynthesis');
        expect(Session.get().phase).toBe('calibrating');
        expect(Session.get().topic).toBe('photosynthesis');
        expect(Session.get().sources).toHaveLength(1);
    });

    test('nothing found means nothing handed over', async () => {
        // Handing a failed lookup to her gets an answer invented from nothing, under a
        // heading that says a study session is in progress. Saying so is the only honest move.
        const lines = transcript();
        const replied = [];
        window._handleNonStreamingResponse = async (text) => replied.push(text);
        window.NEXUS_RESEARCH = { read: async () => ({ ok: false, sources: [], reason: 'rate-limited' }) };
        const out = await Loop.startWithTopic('photosynthesis');
        expect(out.ok).toBe(false);
        expect(replied).toEqual([]);
        expect(lines[lines.length - 1][1]).toMatch(/slow down/i);
    });

    test('an empty topic starts nothing at all', async () => {
        const lines = transcript();
        const out = await Loop.startWithTopic('   ');
        expect(out).toEqual({ ok: false, why: 'no-topic' });
        expect(lines).toEqual([]);
        expect(Session.isRunning()).toBe(false);
    });

    test('a page with no reply path keeps the session rather than losing the start', async () => {
        // A study session with a topic, sources and a citation on screen is worth having even
        // if the hand-off cannot happen — the user can carry on by typing.
        transcript();
        const out = await Loop.startWithTopic('photosynthesis');
        expect(out.ok).toBe(true);
        expect(Session.get().topic).toBe('photosynthesis');
    });

    test('and a reply path that throws does not take the session down with it', async () => {
        transcript();
        window._handleNonStreamingResponse = async () => {
            throw new Error('no model configured');
        };
        await expect(Loop.startWithTopic('photosynthesis')).resolves.toMatchObject({ ok: true });
        expect(Session.get().phase).toBe('calibrating');
    });
});

// ── the wiring, through the real panel ───────────────────────────────────────

describe('what the user types is what the session is about', () => {
    /** The real panel, with a fake Focus underneath and nothing else changed. */
    function panelWithFocus(record) {
        document.body.innerHTML = '<div id="host"></div>';
        const panel = TogetherPanel.attach({
            consent: {
                asked: [],
                async request() {
                    return null;
                },
                revoke() {
                    return true;
                },
                onChange: () => () => {},
            },
            capture: { fromGrant: () => ({ stop() {}, stats: {} }) },
            doc: document,
        });
        panel.mount(document.getElementById('host'));
        panel.register({
            id: 'focus',
            start: () => {
                record.push('body-doubling');
                return { ok: true };
            },
            stop: () => true,
        });
        return panel;
    }

    const optionNamed = (name) =>
        [...document.querySelectorAll('.nexus-bd-together-option')].find((o) => o.textContent.startsWith(name));

    test('the topic typed into the box reaches the session', async () => {
        // The seam this covers: the panel builds the input object the contract reads, and
        // Copilot's version only ever put `steps` on it — an array, which a topic is not.
        const asked = [];
        window.NEXUS_STUDY_LOOP = { startWithTopic: (t) => asked.push(t) };
        const panel = panelWithFocus([]);
        panel.open();
        panel.choose('focus');
        document.querySelector('.nexus-bd-together-steps').value = 'how photosynthesis works';
        optionNamed('Start').click();
        await new Promise((r) => setTimeout(r, 0));
        expect(asked).toEqual(['how photosynthesis works']);
    });

    test('and whitespace around it is not part of the topic', async () => {
        const asked = [];
        window.NEXUS_STUDY_LOOP = { startWithTopic: (t) => asked.push(t) };
        const panel = panelWithFocus([]);
        panel.open();
        panel.choose('focus');
        document.querySelector('.nexus-bd-together-steps').value = '  photosynthesis \n';
        optionNamed('Start').click();
        await new Promise((r) => setTimeout(r, 0));
        expect(asked).toEqual(['photosynthesis']);
    });

    test('the box is two rows, because the question wants a topic and not an essay', () => {
        const panel = panelWithFocus([]);
        panel.open();
        panel.choose('focus');
        expect(document.querySelector('.nexus-bd-together-steps').rows).toBe(2);
    });

    test('Copilot keeps its four, and keeps its checklist', () => {
        // The same box serves both, so the hint has to be a hint rather than a new default.
        document.body.innerHTML = '<div id="host"></div>';
        const panel = TogetherPanel.attach({
            consent: {
                asked: [],
                async request() {
                    return { live: true };
                },
                revoke() {
                    return true;
                },
                onChange: () => () => {},
            },
            capture: { fromGrant: () => ({ stop() {}, stats: {} }) },
            doc: document,
        });
        panel.mount(document.getElementById('host'));
        window.NEXUS_BD = { config: { session: { enabled: true, source: 'bridge' } } };
        panel.register({ id: 'copilot', steps: [], start: async () => ({ ok: true }), stop: () => true });
        panel.open();
        panel.choose('copilot');
        expect(document.querySelector('.nexus-bd-together-steps').rows).toBe(4);
        delete window.NEXUS_BD;
    });

    test('pressing Start with an empty box does not start a session about nothing', async () => {
        const asked = [];
        const opened = [];
        window.NEXUS_STUDY_LOOP = { startWithTopic: (t) => asked.push(t), open: () => opened.push('open') };
        const panel = panelWithFocus([]);
        panel.open();
        panel.choose('focus');
        optionNamed('Start').click();
        await new Promise((r) => setTimeout(r, 0));
        expect(asked).toEqual([]);
        expect(opened).toEqual(['open']);
    });
});
