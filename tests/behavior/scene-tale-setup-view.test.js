/**
 * Scene Tale Stage 1 should feel like an experience launcher, not a browser form.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

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
    return {
        isEnabled: () => false,
        onChange: () => () => {},
    };
}

function mountPanel() {
    document.body.innerHTML = '<div class="avatar-card"><div id="host"></div></div>';
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
    return { panel, activity };
}

beforeEach(() => {
    SetupView.detach();
    window.NEXUS_TOGETHER_SWITCH = { enable: jest.fn() };
});

afterEach(() => {
    SetupView.detach();
    delete window.NEXUS_TOGETHER_SWITCH;
    delete window.NEXUS_BD;
    delete window.NEXUS_SPICY;
    document.body.innerHTML = '';
});

describe('Scene Tale Stage 1 premium setup surface', () => {
    test('decorates the real Together configure stage into the cinematic three-section launcher', () => {
        const { panel, activity } = mountPanel();
        panel.open();
        document.querySelector('[data-activity="playground"]').click();
        SetupView.install(document);
        SetupView.decorate(document);

        const root = document.getElementById(TogetherPanel.PANEL_ID);
        expect(root.classList.contains(SetupView.PANEL_CLASS)).toBe(true);
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

        const soundOptions = [...root.querySelectorAll('.nexus-scene-tale-sound-option')];
        expect(soundOptions).toHaveLength(2);
        expect(soundOptions[0].textContent).toContain('Let her choose');
        expect(soundOptions[1].textContent).toContain('No music');
        expect(soundOptions[0].classList.contains('is-selected')).toBe(true);
        expect(soundOptions[1].classList.contains('is-selected')).toBe(false);
        expect(soundOptions.every((option) => option.querySelector('.nexus-scene-tale-radio-dot'))).toBe(true);

        const create = root.querySelector('[data-action="create-story"]');
        expect(create.getAttribute('aria-label')).toBe('Create story');
        expect(create.textContent).toContain('Create story');
        expect(create.querySelector('.nexus-scene-tale-cta-arrow')).not.toBeNull();

        const back = [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Back');
        expect(back).toBeDefined();

        activity.detach();
    });

    test('selected soundtrack card follows the underlying radio and setup styling does not leak back to chooser', () => {
        const { panel, activity } = mountPanel();
        panel.open();
        document.querySelector('[data-activity="playground"]').click();
        SetupView.install(document);
        SetupView.decorate(document);

        const root = document.getElementById(TogetherPanel.PANEL_ID);
        const radios = [...root.querySelectorAll('.nexus-scene-tale-sound-option input[type="radio"]')];
        const options = [...root.querySelectorAll('.nexus-scene-tale-sound-option')];
        radios[1].checked = true;
        radios[1].dispatchEvent(new Event('change', { bubbles: true }));

        expect(options[0].classList.contains('is-selected')).toBe(false);
        expect(options[1].classList.contains('is-selected')).toBe(true);
        expect(options[1].getAttribute('aria-checked')).toBe('true');

        panel.open();
        SetupView.decorate(document);
        expect(root.classList.contains(SetupView.PANEL_CLASS)).toBe(false);
        expect(document.querySelector('.avatar-card').classList.contains(SetupView.OPEN_CLASS)).toBe(false);

        activity.detach();
    });

    test('CSS pins the desktop setup to a centered glass card and visually hides native radio chrome', () => {
        expect(SetupView.CSS).toContain('top:50%; bottom:auto; left:50%; transform:translate(-50%,-50%)');
        expect(SetupView.CSS).toContain('backdrop-filter:blur(24px)');
        expect(SetupView.CSS).toContain('grid-template-columns:1fr 1fr');
        expect(SetupView.CSS).toContain('input{position:absolute;width:1px;height:1px;opacity:0');
        expect(SetupView.sceneThumbnail('Coastal Terrace · Twilight')).toBe('assets/ambient/dark/coastal-terrace-twilight.webp');
    });
});

afterAll(() => {
    delete window.__NEXUS_SCENE_TALE_SETUP_VIEW_NOAUTO__;
});
