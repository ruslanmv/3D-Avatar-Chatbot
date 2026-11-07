/**
 * IC2. One companion; Life, Copilot and Experiences are what is going on, not modes she is put
 * in. The conversation moves the context on a clear signal, one quiet line marks a change, and
 * only a real activity (focus block, Seaside, a story) gets an End control.
 */
const fs = require('fs');
const path = require('path');

const Intent = require('../../src/companion/ContextIntent');
const Marks = require('../../src/companion/ActivityMarks');
const Session = require('../../src/companion/CompanionSession');
const Prompt = require('../../src/companion/PromptContext');

function memoryStorage() {
    const data = new Map();
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => data.set(k, String(v)),
        removeItem: (k) => data.delete(k),
    };
}

function page() {
    document.body.innerHTML =
        '<div class="avatar-card"></div>' +
        '<div class="chat-history" id="chat-history"><div class="empty-state">No transmissions recorded</div></div>' +
        '<footer class="chat-input-shell"><div class="chat-input-bar"><input id="speech-text" /></div></footer>';
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('the conversation moves the context, only on a clear signal', () => {
    test.each([
        ["I'm tired. Can we spend some time together?", 'life', 'relax'],
        ['Actually, I need help finishing something first.', 'copilot', 'help'],
        ['Help me write the summary for tomorrow', 'copilot', 'help'],
        ["Let's go somewhere peaceful", 'experiences', 'explore'],
        ['Can we just talk for a bit?', 'life', 'talk'],
        ['Sono stanca, vorrei rilassarmi', 'life', 'relax'],
        ['Aiutami a finire la relazione', 'copilot', 'help'],
    ])('%s → %s', (text, destination, activity) => {
        expect(Intent.classify(text)).toMatchObject({ destination, activity });
    });

    test.each(['ok', 'What do you think about octopuses?', 'Thanks!', ''])('no move for %p', (text) => {
        expect(Intent.classify(text)).toBeNull();
    });

    test('two destinations in one message: the later one is what they want now', () => {
        expect(Intent.classify("I'm tired but I need to finish my report")).toMatchObject({ destination: 'copilot' });
    });
});

describe('one quiet line per change, no cards', () => {
    function setup() {
        page();
        const session = Session.create({ storage: memoryStorage() });
        session.load();
        const director = {
            state: 'idle',
            status() {
                return { status: this.state };
            },
            stop() {
                this.state = 'stopped';
            },
        };
        Marks.attach({ doc: document, session, director, label: Intent.label });
        return { session, director };
    }
    const lines = () => [...document.querySelectorAll('#chat-history .nexus-activity-mark')];
    const pill = () => document.getElementById(Marks.PILL_ID);

    test('a change posts one small line; the same context again posts nothing', () => {
        const { session } = setup();
        session.enter('life', 'relax', { source: 'conversation' });
        session.enter('life', 'relax', { source: 'conversation' });
        session.enter('copilot', 'help', { source: 'conversation' });
        expect(lines().map((l) => l.textContent)).toEqual(['Life· Relaxing together', 'Copilot· Ready to help']);
        expect(lines()[1].dataset.destination).toBe('copilot');
        expect(document.querySelector('.nexus-session-card')).toBeNull();
        expect(document.querySelector('#chat-history .empty-state')).toBeNull();
    });

    test('everyday conversation shows nothing above the composer', () => {
        const { session } = setup();
        session.enter('life', 'talk', { source: 'conversation' });
        expect(pill().hidden).toBe(true);
        session.enter('copilot', 'tasks');
        expect(pill().hidden).toBe(true);
    });

    test('a real activity started in Together gets End; End stops it and clears the context', () => {
        const { session, director } = setup();
        session.enter('experiences', 'seaside');
        director.state = 'active';
        expect(pill().hidden).toBe(false);
        expect(pill().textContent).toContain('Seaside Evening');
        // DX5: read by a screen reader, not shown; the X names the place in its tooltip.
        expect(pill().querySelector('[data-role="end"]').title).toBe('End Seaside Evening');
        pill().querySelector('[data-role="end"]').click();
        expect(director.state).toBe('stopped');
        expect(session.active()).toBe(false);
        expect(pill().hidden).toBe(true);
    });

    test('no face, portrait or picture in the chat, and nothing scripted', () => {
        const { session } = setup();
        session.enter('life', 'relax', { source: 'conversation' });
        expect(document.querySelectorAll('#chat-history img, #chat-history canvas')).toHaveLength(0);
        const src = fs.readFileSync(path.join(__dirname, '../../src/companion/ActivityMarks.js'), 'utf8');
        expect(src).not.toMatch(/createElement\('img'\)/);
        expect(src).not.toMatch(/Let's spend some time|What feels good|What should we work on/);
    });

    test('the line is drawn, never stored in the conversation', () => {
        window.chatHistory = {
            messages: [],
            addMessage(m) {
                this.messages.push(m);
            },
        };
        const { session } = setup();
        session.enter('life', 'relax', { source: 'conversation' });
        expect(window.chatHistory.messages).toHaveLength(0);
        delete window.chatHistory;
    });

    test('colours match the Together tiles', () => {
        expect(Marks.DESTINATIONS.life.color).toBe('#38A9FF');
        expect(Marks.DESTINATIONS.copilot.color).toBe('#26D89A');
        expect(Marks.DESTINATIONS.experiences.color).toBe('#F2C94C');
        const launcher = fs.readFileSync(
            path.join(__dirname, '../../src/features/together/ui/TogetherLauncher.js'),
            'utf8'
        );
        for (const c of ['#38A9FF', '#26D89A', '#F2C94C']) expect(launcher).toContain(c);
    });
});

describe('one companion, told what is going on', () => {
    const base = { customized: true, active: true };

    test('every context starts from the same identity and never asks her to name a mode', () => {
        for (const destination of ['life', 'copilot', 'experiences']) {
            const text = Prompt.suffix(Object.assign({ destination }, base));
            expect(text).toContain(Prompt.SAME.trim());
            expect(text).toContain('Do not announce what kind of moment this is or name a mode');
            expect(text).toContain('one to three conversational sentences');
            expect(text).not.toMatch(/You are in (Life|Copilot|Experiences)/);
        }
        expect(Prompt.suffix(Object.assign({ destination: 'copilot' }, base))).toMatch(
            /Never say something is done.*unless the app has confirmed it/
        );
        expect(Prompt.suffix(Object.assign({ destination: 'experiences' }, base))).toMatch(
            /only after the app has done it/
        );
    });

    test('Copilot never receives Life text; an ended context sends nothing', () => {
        const copilot = Prompt.suffix(
            Object.assign(
                {
                    destination: 'copilot',
                    relationship: { style: 'romance', address: 'dear one' },
                    memories: [{ title: 'our evening' }],
                },
                base
            )
        );
        expect(copilot).not.toContain('dear one');
        expect(copilot).not.toContain('our evening');
        expect(Prompt.suffix({ customized: true, active: false, destination: 'life' })).toBe('');
    });
});

describe('the facade notices the topic at prompt time', () => {
    let Companion;
    let handle;
    beforeAll(() => {
        for (const rel of [
            'companion/MemoryScopes',
            'companion/PrivacyGate',
            'companion/BehaviorRouter',
            'companion/DestinationCatalog',
            'companion/TaskBoard',
            'companion/ActivityBridge',
            'companion/DestinationBar',
            'companion/ContextIntent',
            'companion/ActivityMarks',
            'experiences/SceneManifest',
            'experiences/seaside/layout',
            'experiences/seaside/story',
            'experiences/SceneRuntime',
            'experiences/SpatialAudioManager',
            'experiences/ExperienceRegistry',
            'experiences/ExperienceSession',
            'experiences/ExperienceDirector',
            'experiences/seaside/SeasideEvening',
            'experiences/formats',
            'experiences/ExperienceMemory',
            'experiences/InteractionRouter',
        ])
            require('../../src/' + rel);
        window.NEXUS_COMPANION_SESSION = Session;
        window.NEXUS_COMPANION_PROMPT = Prompt;
        Companion = require('../../src/companion/index');
    });
    afterEach(() => {
        if (handle) handle.detach();
        handle = null;
        delete window.chatHistory;
    });

    function start() {
        page();
        const messages = [];
        window.chatHistory = { getHistory: () => messages.slice() };
        handle = Companion.attach({
            storage: memoryStorage(),
            doc: document,
            panel: {
                open() {},
                choose() {
                    return { ok: true };
                },
            },
            bus: { on() {} },
        });
        return messages;
    }

    test('the mock-up conversation: Life, then Copilot, with no announcement and no extra call', () => {
        const messages = start();
        expect(Companion.systemPromptSuffix()).toBe('');
        messages.push({ role: 'user', content: "I'm tired. Can we spend some time together?" });
        expect(Companion.systemPromptSuffix()).toContain('personal time together');
        messages.push({ role: 'assistant', content: 'Of course. Want to put on some music and relax?' });
        messages.push({ role: 'user', content: 'Actually, I need help finishing something first.' });
        expect(Companion.systemPromptSuffix()).toContain('practical help with real work');
        // Asked again for the same turn (three prompt sites): nothing changes, no second line.
        Companion.systemPromptSuffix();
        const marks = [...document.querySelectorAll('.nexus-activity-mark')].map((l) => l.textContent);
        expect(marks).toEqual(['Life· Relaxing together', 'Copilot· Ready to help']);
    });

    test('small talk keeps the context it had', () => {
        const messages = start();
        messages.push({ role: 'user', content: 'Help me plan my week' });
        Companion.systemPromptSuffix();
        messages.push({ role: 'user', content: 'ok thanks' });
        expect(Companion.systemPromptSuffix()).toContain('practical help with real work');
    });

    test('a running Together activity is not replaced by a remark', () => {
        const messages = start();
        handle.live.session.enter('copilot', 'focus-block');
        messages.push({ role: 'user', content: "I'm so tired" });
        expect(Companion.systemPromptSuffix()).toContain('A focus block is running');
    });
});
