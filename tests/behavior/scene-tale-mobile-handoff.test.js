/**
 * Real mobile Ready -> Playing regression.
 *
 * The failure this protects against is a MutationObserver microtask loop that can begin when
 * StoryPlayer mounts the HUD, before Together's awaited start continuation closes the launcher.
 */

/* global describe, test, expect, beforeEach, afterEach, afterAll, jest */

window.__NEXUS_SCENE_TALE_VIEW_NOAUTO__ = true;
window.__NEXUS_SCENE_TALE_SETUP_VIEW_NOAUTO__ = true;
window.__NEXUS_SCENE_TALE_MOBILE_NOAUTO__ = true;

const TogetherPanel = require('../../src/features/together/ui/TogetherPanel.js');
const Playground = require('../../src/features/together/activities/playground.js');
const SceneTaleView = require('../../src/features/together/ui/SceneTaleConversationView.js');
const SetupView = require('../../src/features/together/ui/SceneTaleSetupView.js');
const MobileMode = require('../../src/features/together/ui/SceneTaleMobileMode.js');

function consentMachine() {
    return {
        state: 'idle',
        grant: null,
        reason: '',
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

async function eventually(assertion, attempts = 80) {
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

function mountDom() {
    document.body.innerHTML = `
        <div class="app-shell">
            <header class="topbar">
                <span class="brand-inline-title">HomePilot Avatar</span>
                <span class="brand-inline-sub"><span id="status-indicator"></span><span id="status-text">READY</span></span>
            </header>
            <div class="content-layout">
                <section class="avatar-panel">
                    <div class="avatar-card">
                        <div class="avatar-preview-wrap"><div class="avatar-viewport"></div></div>
                        <div id="together-host"></div>
                    </div>
                </section>
                <section class="chat-panel chat-overlay--expanded">
                    <div class="chat-card">
                        <div class="chat-card-header">Conversation</div>
                        <main class="chat-main">
                            <div id="chat-history" class="chat-history"><div class="empty-state">No transcript yet</div></div>
                        </main>
                        <div class="chat-input-shell">
                            <div class="chat-input-bar">
                                <button class="voice-btn-compact">Mic</button>
                                <input id="speech-text" class="chat-input" placeholder="Type your message..." />
                                <button id="speak-btn" class="send-btn">Send</button>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    `;
}

function mobileMatchMedia(query) {
    return {
        matches: /max-width\s*:\s*767px/.test(String(query)),
        media: String(query),
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
    };
}

beforeEach(() => {
    mountDom();
    window.matchMedia = jest.fn(mobileMatchMedia);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    window.NEXUS_TOGETHER_SWITCH = { enable: jest.fn() };
    window.NEXUS_SPICY = { isEnabled: () => false, onChange: () => () => {} };
    SceneTaleView.detach();
    SetupView.detach();
    MobileMode.detach();
});

afterEach(() => {
    MobileMode.detach();
    SceneTaleView.detach();
    SetupView.detach();
    delete window.NEXUS_TOGETHER_SWITCH;
    delete window.NEXUS_SPICY;
    delete window.NEXUS_BD;
    document.documentElement.classList.remove(MobileMode.ACTIVE_CLASS, MobileMode.CONFIGURE_CLASS);
    document.body.innerHTML = '';
});

describe('Scene Tale mobile Ready -> Playing handoff', () => {
    test('closes Together, transfers mobile ownership, starts narration and settles observers', async () => {
        const panel = TogetherPanel.attach({ consent: consentMachine(), doc: document, win: window });
        panel.mount(document.getElementById('together-host'));

        const scene = { id: 'coastal-terrace-twilight', label: 'Coastal Terrace · Twilight' };
        const plan = Playground.fallbackStory(scene, 'A letter somebody never delivered', false);
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

        const activity = Playground.attach({ bus, planner, win: window, doc: document, say, timingScale: 0 });
        panel.register(activity);

        SceneTaleView.install(document, window);
        SceneTaleView.patchStoryPlayer(Playground);
        SetupView.install(document);
        expect(MobileMode.patchStartHandoff(window)).toBe(true);
        MobileMode.install(document, window);

        panel.open();
        document.querySelector('[data-activity="playground"]').click();
        SetupView.decorate(document);
        expect(document.documentElement.classList.contains(MobileMode.CONFIGURE_CLASS)).toBe(true);

        const root = document.getElementById(TogetherPanel.PANEL_ID);
        root.querySelector('[data-action="create-story"]').click();
        await eventually(() => expect(root.querySelector('[data-action="start-story"]')).not.toBeNull());
        expect(document.documentElement.classList.contains(MobileMode.CONFIGURE_CLASS)).toBe(true);

        const start = root.querySelector('[data-action="start-story"]');
        start.click();
        expect(start.disabled).toBe(true);
        expect(start.textContent).toBe('Starting…');

        await eventually(() => {
            expect(panel.isOpen).toBe(false);
            expect(activity.active).toBe(true);
            expect(document.documentElement.classList.contains(MobileMode.CONFIGURE_CLASS)).toBe(false);
            expect(document.documentElement.classList.contains(MobileMode.ACTIVE_CLASS)).toBe(true);
            expect(document.querySelector(`#chat-history #${MobileMode.HUD_ID}`)).not.toBeNull();
            expect(say).toHaveBeenCalled();
            expect(document.getElementById('speech-text').placeholder).toBe('Talk to the story…');
        });

        const hud = document.getElementById(MobileMode.HUD_ID);
        const watched = [
            document.querySelector('.brand-inline-title'),
            document.getElementById('status-text'),
            hud.querySelector('.nexus-story-place'),
        ].filter(Boolean);
        let mutations = 0;
        const observer = new MutationObserver((records) => {
            mutations += records.length;
        });
        watched.forEach((node) => observer.observe(node, { childList: true, characterData: true, subtree: true }));
        for (let i = 0; i < 12; i += 1) MobileMode.sync(hud);
        await flush();
        observer.disconnect();
        expect(mutations).toBe(0);

        const unrelated = document.createElement('div');
        const nestedHud = document.createElement('div');
        nestedHud.id = MobileMode.HUD_ID;
        expect(MobileMode.hudMutationRelevant([{ addedNodes: [unrelated], removedNodes: [] }])).toBe(false);
        expect(MobileMode.hudMutationRelevant([{ addedNodes: [nestedHud], removedNodes: [] }])).toBe(true);

        panel.stopActivity('test');
        activity.detach();
    });

    test('a thrown native activity start becomes a recoverable Together failure instead of a rejected promise', async () => {
        const panel = TogetherPanel.attach({ consent: consentMachine(), doc: document, win: window });
        panel.mount(document.getElementById('together-host'));
        const broken = {
            __contract: true,
            id: 'broken-mobile-start',
            title: 'Broken test activity',
            inputs: () => [{ id: 'start', permission: null, note: 'test' }],
            availability: () => ({ ok: true, why: '' }),
            start: jest.fn(async () => {
                throw new Error('mobile start exploded');
            }),
            stop: jest.fn(),
            status: () => null,
            detach: jest.fn(),
        };
        panel.register(broken);
        MobileMode.patchStartHandoff(window);

        panel.open();
        const result = await panel.startActivity('broken-mobile-start', {
            id: 'start',
            permission: null,
            note: 'test',
        });

        expect(result).toEqual(expect.objectContaining({ ok: false }));
        expect(panel.isOpen).toBe(true);
        expect(panel.view).toBe('failure');
        expect(document.getElementById(TogetherPanel.PANEL_ID).textContent).toMatch(
            /could not start|mobile start exploded/i
        );
    });
});

afterAll(() => {
    delete window.__NEXUS_SCENE_TALE_VIEW_NOAUTO__;
    delete window.__NEXUS_SCENE_TALE_SETUP_VIEW_NOAUTO__;
    delete window.__NEXUS_SCENE_TALE_MOBILE_NOAUTO__;
});
