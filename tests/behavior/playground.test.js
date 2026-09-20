/**
 * Playground / Scene Tale end-to-end behavior.
 *
 * V1 has one real Playground experience, so the Playground tile opens Scene Tale setup
 * directly. Preparation and playback are deliberately different user actions: Create story
 * plans and validates without starting media; Start story is the explicit user gesture that
 * closes Together and gives the main viewport to StoryPlayer.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const TogetherPanel = require('../../src/features/together/ui/TogetherPanel.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');
const TogetherLauncher = require('../../src/features/together/ui/TogetherLauncher.js');

function consentMachine() {
    return {
        state: 'idle',
        onChange() {
            return () => {};
        },
        revoke() {
            this.state = 'idle';
            return true;
        },
    };
}

function panel() {
    document.body.innerHTML = '<div id="host"></div>';
    const p = TogetherPanel.attach({ consent: consentMachine(), doc: document, win: window });
    p.mount(document.getElementById('host'));
    return p;
}

function spicyOff() {
    return {
        isEnabled: () => false,
        onChange: () => () => {},
    };
}

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function eventually(assertion, attempts = 40) {
    let last;
    for (let i = 0; i < attempts; i += 1) {
        try {
            assertion();
            return;
        } catch (error) {
            last = error;
            await flush();
        }
    }
    throw last;
}

function scene() {
    return { id: 'coastal-terrace-twilight', label: 'Coastal Terrace · Twilight' };
}

function wireDirector(p, overrides = {}) {
    const s = scene();
    const director = {
        blackboard: {
            scene: s,
            activity: 'chat',
            escalationLevel: 0,
            nsfwAllowed: false,
        },
        togetherPanel: p,
        adult: null,
        bus: { emit: jest.fn(), on: jest.fn(() => () => {}) },
        ...overrides,
    };
    window.NEXUS_SPICY = spicyOff();
    window.NEXUS_BD = director;
    return director;
}

beforeEach(() => {
    window.NEXUS_TOGETHER_SWITCH = { enable: jest.fn() };
    localStorage.clear();
});

afterEach(() => {
    delete window.NEXUS_TOGETHER_SWITCH;
    delete window.NEXUS_BD;
    delete window.NEXUS_SPICY;
    delete window.NEXUS_MEDIA_SESSION;
    delete window.NEXUS_CONVERSATION_PUBLISHER;
    delete window.NEXUS_BD_SAY;
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('Playground activity contract', () => {
    test('is one family Scene Tale entry with no capture permission', () => {
        const p = panel();
        wireDirector(p);
        const activity = PlaygroundActivity.attach({ win: window, doc: document });

        expect(activity.__contract).toBe(true);
        expect(activity.id).toBe('playground');
        expect(activity.title).toBe('Playground');
        expect(activity.order).toBe(45);
        expect(activity.inputs()).toEqual([
            expect.objectContaining({ id: 'scene-tale', label: 'Scene Tale', permission: null }),
        ]);
        expect(activity.availability()).toEqual({ ok: true, why: '' });

        activity.detach();
    });

    test('refuses to report a successful start before a StoryPlan has been prepared', async () => {
        const p = panel();
        wireDirector(p);
        const activity = PlaygroundActivity.attach({ win: window, doc: document });

        const result = await activity.start({ input: { id: 'scene-tale' } });

        expect(result).toEqual({ ok: false, why: 'Create the story before starting it' });
        expect(activity.active).toBe(false);
        expect(activity.status()).toBeNull();
        expect(document.getElementById('nexus-scene-tale-hud')).toBeNull();

        activity.detach();
    });
});

describe('Scene Tale customer journey', () => {
    test('Together → Playground → configure → Create story → ready → Start story → choices → history', async () => {
        const p = panel();
        const director = wireDirector(p);
        const prepared = PlaygroundActivity.fallbackStory(scene(), 'A letter somebody never delivered', true);
        const planner = {
            prepare: jest.fn(({ onProgress }) => {
                ['scene', 'story', 'choices', 'music'].forEach((step) => onProgress(step));
                return Promise.resolve({ plan: prepared, soundtrack: null });
            }),
        };
        const activity = PlaygroundActivity.attach({
            bus: director.bus,
            planner,
            win: window,
            doc: document,
            timingScale: 0,
            say: jest.fn(),
        });
        p.register(activity);

        p.open();
        const tile = document.querySelector('[data-activity="playground"]');
        expect(tile).not.toBeNull();
        tile.click();

        const root = document.getElementById(TogetherPanel.PANEL_ID);
        expect(p.view).toBe('setup');
        expect(root.textContent).toContain('SCENE TALE');
        expect(root.textContent).toContain('Coastal Terrace · Twilight');
        expect(root.textContent).toContain('Give me an idea · optional');
        expect(root.textContent).toContain('Let her choose');
        expect(root.textContent).toContain('No music');

        const idea = document.getElementById('nexus-scene-tale-idea');
        idea.value = 'A letter somebody never delivered';
        const create = root.querySelector('[data-action="create-story"]');
        expect(create).not.toBeNull();
        create.click();

        // prepare() changes visible state before awaiting the planner. No TTS or media has
        // started yet; this is the exact distinction the old dead-end implementation lacked.
        expect(root.textContent).toContain('Creating our story…');
        expect(activity.active).toBe(false);
        expect(document.getElementById('nexus-scene-tale-hud')).toBeNull();

        await eventually(() => {
            expect(root.textContent).toContain('THE LETTER AT THE LAST LIGHT');
            expect(root.textContent).toContain('Fictional story inspired by this scene');
            expect(root.textContent).toContain('About 5 minutes · 2 choices');
            expect(root.querySelector('[data-action="start-story"]')).not.toBeNull();
        });
        // The scene reaches the planner under the catalogue's own id, not whichever alias the
        // blackboard happened to hold. `currentScene` resolves through `SceneArt` now, so a
        // generation key (`coastal-terrace-twilight`) and a label both arrive as
        // `ambient:terrace:night` — one spelling for one place, everywhere downstream.
        expect(planner.prepare).toHaveBeenCalledWith(
            expect.objectContaining({
                scene: { id: 'ambient:terrace:night', label: 'Coastal Terrace · Twilight' },
                idea: 'A letter somebody never delivered',
                music: 'auto',
            })
        );
        expect(activity.active).toBe(false);

        root.querySelector('[data-action="start-story"]').click();
        await eventually(() => {
            expect(p.activeActivity).toBe('playground');
            expect(activity.active).toBe(true);
            expect(activity.player).not.toBeNull();
            expect(document.getElementById('nexus-scene-tale-hud')).not.toBeNull();
        });
        expect(p.isOpen).toBe(false);
        expect(activity.status()).toEqual(expect.objectContaining({ label: 'Scene Tale' }));

        // With timingScale=0 the deterministic executor advances immediately to each
        // precomputed choice. No LLM call happens during playback.
        await eventually(() => expect(document.querySelector('[data-choice]')).not.toBeNull());
        document.querySelector('[data-choice]').click();
        await eventually(() => expect(document.querySelector('[data-choice]')).not.toBeNull());
        document.querySelector('[data-choice]').click();

        await eventually(() => {
            const hud = document.getElementById('nexus-scene-tale-hud');
            expect(hud.textContent).toContain('Story complete');
            expect(hud.textContent).toContain('Save to Histories');
            expect(hud.textContent).toContain('Another version');
            expect(hud.textContent).toContain('Back to Together');
        });

        const save = [...document.querySelectorAll('#nexus-scene-tale-hud button')].find(
            (button) => button.textContent === 'Save to Histories'
        );
        expect(save).toBeDefined();
        save.click();
        expect(activity.history.all()).toEqual([
            expect.objectContaining({
                title: 'The Letter at the Last Light',
                sceneId: 'ambient:terrace:night',
                fiction: true,
            }),
        ]);

        const back = [...document.querySelectorAll('#nexus-scene-tale-hud button')].find(
            (button) => button.textContent === 'Back to Together'
        );
        back.click();
        await eventually(() => expect(p.isOpen).toBe(true));
        expect(p.activeActivity).toBeNull();
        expect(document.getElementById('nexus-scene-tale-hud')).toBeNull();

        activity.detach();
    });

    test('StoryPlan validation rejects unsafe, cyclic and non-deterministic plans', () => {
        const valid = PlaygroundActivity.fallbackStory(scene(), '', false);
        expect(PlaygroundActivity.validateStoryPlan(valid, { musicEnabled: false }).ok).toBe(true);

        const unsafe = JSON.parse(JSON.stringify(valid));
        unsafe.nodes.opening.text = 'Visit https://example.com for the rest.';
        expect(PlaygroundActivity.validateStoryPlan(unsafe, { musicEnabled: false }).ok).toBe(false);

        const cyclic = JSON.parse(JSON.stringify(valid));
        cyclic.nodes.finale.next = 'opening';
        expect(PlaygroundActivity.validateStoryPlan(cyclic, { musicEnabled: false }).ok).toBe(false);

        const wrongChoices = JSON.parse(JSON.stringify(valid));
        wrongChoices.nodes['choice-two'].type = 'end';
        delete wrongChoices.nodes['choice-two'].prompt;
        delete wrongChoices.nodes['choice-two'].options;
        expect(PlaygroundActivity.validateStoryPlan(wrongChoices, { musicEnabled: false }).ok).toBe(false);
    });

    test('AudioFocusManager ducks other media during narration and restores it exactly', () => {
        const media = document.createElement('audio');
        media.volume = 0.72;
        document.body.appendChild(media);
        const bus = { emit: jest.fn() };
        const focus = new PlaygroundActivity.AudioFocusManager({ win: window, bus });

        focus.duck();
        expect(media.volume).toBeCloseTo(0.16);
        expect(bus.emit).toHaveBeenCalledWith('story:audio-duck', { volume: 0.16 });

        focus.restore();
        expect(media.volume).toBeCloseTo(0.72);
        expect(bus.emit).toHaveBeenCalledWith('story:audio-restore', {});
    });
});

describe('Together chooser access', () => {
    test('Playground is a normal chooser tile and opens Scene Tale setup directly', () => {
        const p = panel();
        wireDirector(p);
        const activity = PlaygroundActivity.attach({ win: window, doc: document });
        p.register(activity);
        p.open();

        const tile = document.querySelector('[data-activity="playground"]');
        expect(tile).not.toBeNull();
        expect(tile.classList.contains('nexus-bd-together-tile')).toBe(true);
        expect(tile.textContent).toContain('Playground');

        tile.click();
        const root = document.getElementById(TogetherPanel.PANEL_ID);
        expect(root.textContent).toContain('SCENE TALE');
        expect(root.textContent).toContain('A little story inspired by this place.');
        expect(root.querySelector('[data-action="create-story"]')).not.toBeNull();

        activity.detach();
    });

    test('the shared launcher CSS keeps the activity grid responsive for desktop and mobile', () => {
        expect(TogetherLauncher.CSS).toContain('grid-template-columns: repeat(3, 1fr)');
        expect(TogetherLauncher.CSS).toContain('grid-template-columns: repeat(2, 1fr)');
    });
});
