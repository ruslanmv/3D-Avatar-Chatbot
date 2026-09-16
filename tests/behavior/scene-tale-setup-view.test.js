/**
 * Scene Tale Stage 1 should feel like an experience launcher, not a browser form.
 */

/* global describe, test, expect, beforeEach, afterEach, afterAll, jest */

window.__NEXUS_SCENE_TALE_SETUP_VIEW_NOAUTO__ = true;

const TogetherPanel = require('../../src/features/together/ui/TogetherPanel.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');
const SetupView = require('../../src/features/together/ui/SceneTaleSetupView.js');

function consentMachine() {
    return {
        state: 'idle',
        onChange() { return () => {}; },
        revoke() { this.state = 'idle'; return true; },
    };
}

function spicyOff() {
    return { isEnabled: () => false, onChange: () => () => {} };
}

function mountPanel() {
    document.body.innerHTML = '<div class="avatar-card"><div id="host"></div></div><footer class="chat-input-shell"></footer>';
    const panel = TogetherPanel.attach({ consent: consentMachine(), doc: document, win: window });
    panel.mount(document.getElementById('host'));
    const director = {
        blackboard: {
            scene: { id: 'coastal-terrace-twilight', label: 'Coastal Terrace · Twilight' },
            activity: 'chat',
            escalationLevel: 0,
            nsfwAllowed: false,
        },
        togetherPanel: panel,
        adult: null,
        bus: { emit: jest.fn(), on: jest.fn(() => () => {}) },
    };
    window.NEXUS_SPICY = spicyOff();
    window.NEXUS_BD = director;
    const activity = PlaygroundActivity.attach({ bus: director.bus, win: window, doc: document });
    panel.register(activity);
    return { panel, activity, director };
}

function openSceneTale(panel) {
    panel.open();
    document.querySelector('[data-activity=playground]').click();
    SetupView.install(document);
    SetupView.decorate(document);
    return document.getElementById(TogetherPanel.PANEL_ID);
}

beforeEach(() => {
    SetupView.detach();
    window.NEXUS_TOGETHER_SWITCH = { enable: jest.fn() };
});

afterEach(() => {
    SetupView.detach();
    delete window.NEXUS_TOGETHER_SWITCH;
    delete window.NEXUS_SCENE_AMBIENCE_CAPABILITY;
    delete window.NEXUS_VIEWPORT_BACKGROUND_CATALOG;
    delete window.NEXUS_VIEWER;
    delete window.NEXUS_BD;
    delete window.NEXUS_SPICY;
    document.body.innerHTML = '';
});

describe('Scene Tale Stage 1 premium setup surface', () => {
    test('decorates the real Together configure stage into the cinematic three-section launcher', () => {
        const { panel, activity } = mountPanel();
        const root = openSceneTale(panel);

        expect(root.classList.contains(SetupView.PANEL_CLASS)).toBe(true);
        expect(document.documentElement.classList.contains(SetupView.ROOT_CLASS)).toBe(true);
        expect(document.querySelector('.avatar-card').classList.contains(SetupView.OPEN_CLASS)).toBe(true);
        expect(root.querySelector('.nexus-bd-together-head').textContent).toBe('TOGETHER');
        expect(root.querySelector('.nexus-scene-tale-setup-title').textContent).toBe('Scene Tale');
        expect(root.querySelector('.nexus-bd-together-prompt').textContent).toBe('A little story inspired by this place.');

        const sections = [...root.querySelectorAll('.nexus-scene-tale-setup-section')];
        expect(sections).toHaveLength(3);
        expect(sections[0].textContent).toContain('Current place');
        expect(sections[1].textContent).toContain('Give me an idea');
        expect(sections[1].textContent).toContain('Optional');
        expect(sections[2].textContent).toContain('Soundtrack');

        const place = root.querySelector('.nexus-scene-tale-place-card');
        expect(place.textContent).toContain('Coastal Terrace · Twilight');
        const thumb = place.querySelector('.nexus-scene-tale-place-thumb');
        expect(thumb).not.toBeNull();
        expect(thumb.getAttribute('src')).toBe('assets/ambient/dark/coastal-terrace-twilight.webp');
        expect(thumb.getAttribute('alt')).toBe('Coastal Terrace · Twilight');

        const idea = root.querySelector('#nexus-scene-tale-idea');
        expect(idea.placeholder).toBe('A letter somebody never delivered');
        expect(idea.getAttribute('aria-label')).toBe('Give me an idea');
        expect(idea.rows).toBe(1);

        const soundOptions = [...root.querySelectorAll('.nexus-scene-tale-sound-option')];
        expect(soundOptions).toHaveLength(2);
        expect(soundOptions[0].textContent).toContain('Let her choose');
        expect(soundOptions[1].textContent).toContain('No music');
        expect(soundOptions[0].classList.contains('is-selected')).toBe(true);
        expect(soundOptions[1].classList.contains('is-selected')).toBe(false);
        expect(soundOptions.every((option) => option.querySelector('.nexus-scene-tale-radio-dot'))).toBe(true);

        const create = root.querySelector('[data-action=create-story]');
        expect(create.getAttribute('aria-label')).toBe('Create story');
        expect(create.textContent).toContain('Create story');
        expect(create.querySelector('.nexus-scene-tale-cta-arrow')).not.toBeNull();
        expect([...root.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Back')).toBe(true);
        activity.detach();
    });

    test('authoritative ambience state replaces Current Scene with the real label and thumbnail', () => {
        const { panel, activity, director } = mountPanel();
        director.blackboard.scene = { id: 'current-scene', label: 'Current Scene' };
        window.NEXUS_SCENE_AMBIENCE_CAPABILITY = { currentSceneLabel: jest.fn(() => 'Ocean — Moonlight') };

        const root = openSceneTale(panel);
        const place = root.querySelector('.nexus-scene-tale-place-card');
        const thumb = place.querySelector('.nexus-scene-tale-place-thumb');

        expect(window.NEXUS_SCENE_AMBIENCE_CAPABILITY.currentSceneLabel).toHaveBeenCalled();
        expect(place.textContent).toContain('Ocean · Moonlight');
        expect(place.textContent).not.toContain('Current Scene');
        expect(thumb.getAttribute('src')).toBe('assets/ambient/dark/ocean-moonlight.webp');
        expect(thumb.getAttribute('alt')).toBe('Ocean · Moonlight');
        activity.detach();
    });

    test('selected soundtrack follows the radio and launcher ownership is removed on exit', () => {
        const { panel, activity } = mountPanel();
        const root = openSceneTale(panel);
        const radios = [...root.querySelectorAll('.nexus-scene-tale-sound-option input[type=radio]')];
        const options = [...root.querySelectorAll('.nexus-scene-tale-sound-option')];
        radios[1].checked = true;
        radios[1].dispatchEvent(new Event('change', { bubbles: true }));

        expect(options[0].classList.contains('is-selected')).toBe(false);
        expect(options[1].classList.contains('is-selected')).toBe(true);
        expect(options[1].getAttribute('aria-checked')).toBe('true');

        panel.open();
        SetupView.decorate(document);
        expect(root.classList.contains(SetupView.PANEL_CLASS)).toBe(false);
        expect(document.documentElement.classList.contains(SetupView.ROOT_CLASS)).toBe(false);
        expect(document.querySelector('.avatar-card').classList.contains(SetupView.OPEN_CLASS)).toBe(false);
        activity.detach();
    });

    test('Configure, Preparing and Ready keep setup ownership until Start story', () => {
        const { panel, activity } = mountPanel();
        openSceneTale(panel);
        expect(document.documentElement.classList.contains(SetupView.ROOT_CLASS)).toBe(true);

        activity.sessionState = 'preparing';
        panel._paint();
        SetupView.decorate(document);
        expect(document.querySelector('[data-action=cancel-story]')).not.toBeNull();
        expect(document.documentElement.classList.contains(SetupView.ROOT_CLASS)).toBe(true);

        activity.preparedPlan = PlaygroundActivity.fallbackStory(
            { id: 'coastal-terrace-twilight', label: 'Coastal Terrace · Twilight' },
            'A letter somebody never delivered',
            false
        );
        activity.sessionState = 'ready';
        panel._paint();
        SetupView.decorate(document);
        expect(document.querySelector('[data-action=start-story]')).not.toBeNull();
        expect(document.documentElement.classList.contains(SetupView.ROOT_CLASS)).toBe(true);

        panel.open();
        SetupView.decorate(document);
        expect(document.documentElement.classList.contains(SetupView.ROOT_CLASS)).toBe(false);
        activity.detach();
    });

    test('mobile CSS keeps a floating card, hides ordinary chat and only stacks soundtrack below 390px', () => {
        expect(SetupView.CSS).toContain('top:50%;bottom:auto;left:50%;transform:translate(-50%,-50%)');
        expect(SetupView.CSS).toContain('backdrop-filter:blur(24px)');
        expect(SetupView.CSS).toContain(`html.${SetupView.ROOT_CLASS} .chat-input-shell`);
        expect(SetupView.CSS).toContain('top:calc(50% + 24px);bottom:auto;left:50%;right:auto');
        expect(SetupView.CSS).toContain('width:min(520px,calc(100vw - 28px))');
        expect(SetupView.CSS).toContain('min-height:3.5rem;height:3.5rem');
        expect(SetupView.CSS).toContain('@media(max-width:389px)');
        expect(SetupView.CSS).not.toContain('position:fixed;top:auto;bottom:0;left:0;right:0');
        expect(SetupView.sceneThumbnail('ambient:ocean:night')).toBe('assets/ambient/dark/ocean-moonlight.webp');
        expect(SetupView.sceneThumbnail('Coastal Terrace · Twilight')).toBe('assets/ambient/dark/coastal-terrace-twilight.webp');
    });
});

afterAll(() => { delete window.__NEXUS_SCENE_TALE_SETUP_VIEW_NOAUTO__; });
