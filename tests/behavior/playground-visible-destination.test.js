/**
 * Acceptance regression for the Ready -> Playing hand-off.
 *
 * A successful Start story must have a visible destination: Together closes, Conversation
 * immediately owns the Scene Tale surface, and the avatar speech path starts. A state flag
 * saying "playing" is not enough.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const TogetherPanel = require('../../src/features/together/ui/TogetherPanel.js');
const Playground = require('../../src/features/together/activities/playground.js');
const SceneTaleView = require('../../src/features/together/ui/SceneTaleConversationView.js');

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

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function eventually(assertion, attempts = 50) {
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

beforeEach(() => {
    document.body.innerHTML = `
        <div id="chat-history" class="chat-history"><div class="empty-state">No transcript yet</div></div>
        <input id="speech-text" placeholder="Type your message..." />
        <button id="speak-btn">Send</button>
        <div id="together-host"></div>
    `;
    window.NEXUS_TOGETHER_SWITCH = { enable: jest.fn() };
    window.NEXUS_SPICY = { isEnabled: () => false, onChange: () => () => {} };
    SceneTaleView.detach();
    SceneTaleView.install(document, window);
    SceneTaleView.patchStoryPlayer(Playground);
});

afterEach(() => {
    SceneTaleView.detach();
    delete window.NEXUS_TOGETHER_SWITCH;
    delete window.NEXUS_SPICY;
    delete window.NEXUS_BD;
    document.body.innerHTML = '';
});

describe('Scene Tale visible destination', () => {
    test('Start story closes Together and immediately gives Conversation the live story UI', async () => {
        const panel = TogetherPanel.attach({ consent: consentMachine(), doc: document, win: window });
        panel.mount(document.getElementById('together-host'));
        const scene = { id: 'magical-forest-night', label: 'Magical Forest · Night' };
        const plan = Playground.fallbackStory(scene, 'A small light between the trees', false);
        const say = jest.fn();
        const bus = { emit: jest.fn(), on: jest.fn(() => () => {}) };
        const planner = {
            prepare: jest.fn(({ onProgress }) => {
                ['scene', 'story', 'choices', 'music'].forEach((step) => onProgress(step));
                return Promise.resolve({ plan, soundtrack: null });
            }),
        };
        const director = {
            blackboard: { scene, activity: 'chat', escalationLevel: 0, nsfwAllowed: false },
            togetherPanel: panel,
            adult: null,
            bus,
        };
        window.NEXUS_BD = director;

        const activity = Playground.attach({
            bus,
            planner,
            win: window,
            doc: document,
            say,
            timingScale: 0,
        });
        panel.register(activity);

        panel.open();
        document.querySelector('[data-activity="playground"]').click();
        const root = document.getElementById(TogetherPanel.PANEL_ID);
        root.querySelector('[data-action="create-story"]').click();

        await eventually(() => expect(root.querySelector('[data-action="start-story"]')).not.toBeNull());
        const start = root.querySelector('[data-action="start-story"]');
        start.click();
        expect(start.disabled).toBe(true);
        expect(start.textContent).toBe('Starting…');

        await eventually(() => {
            expect(panel.isOpen).toBe(false);
            expect(activity.active).toBe(true);
            expect(document.querySelector(`#chat-history #${SceneTaleView.HUD_ID}`)).not.toBeNull();
            expect(document.querySelector(`body > #${SceneTaleView.HUD_ID}`)).toBeNull();
            expect(say).toHaveBeenCalled();
        });

        const hud = document.getElementById(SceneTaleView.HUD_ID);
        expect(hud.textContent).toContain('SCENE TALE');
        expect(hud.textContent).toContain(plan.title);
        expect(hud.textContent).toContain('Fictional story inspired by this scene');
        expect(document.getElementById('speech-text').placeholder).toBe('Talk to the story…');
        expect(activity.status()).toEqual(expect.objectContaining({ label: 'Scene Tale' }));

        panel.stopActivity('test');
        activity.detach();
    });
});
