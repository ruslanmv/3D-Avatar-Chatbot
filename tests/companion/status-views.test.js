/**
 * DX3. The status bar is quiet, collapsible and never a dead end; clean view hides overlays
 * without stopping anything.
 *
 * Held here: End is an X with an accessible name and a 44 px target; the bar has three views
 * (compact, minimal, hidden) that the person picks and the page remembers; hidden leaves one
 * restore control; End asks first only when the running activity says ending would lose
 * something; and Immersive mode is CSS on the page — nothing it does reaches the session.
 */
const fs = require('fs');
const path = require('path');
const Marks = require('../../src/companion/ActivityMarks');
const Immersive = require('../../src/companion/ImmersiveMode');

if (window.__NEXUS_IMMERSIVE_LIVE) window.__NEXUS_IMMERSIVE_LIVE.detach();

function rig({ destination = 'experiences', activity = 'seaside', panel = null } = {}) {
    document.body.className = '';
    document.documentElement.className = '';
    document.body.innerHTML = '<div class="chat-card"><div class="chat-input-shell"><textarea></textarea></div></div>';
    const session = {
        on: () => () => {},
        active: () => true,
        source: () => 'together',
        activity: () => activity,
        destination: () => destination,
        end: jest.fn(),
    };
    const marks = Marks.attach({
        doc: document,
        session,
        label: (id) => (id === 'seaside' ? 'Seaside Evening' : id),
        panel: () => panel,
    });
    return { marks, session };
}

const button = (marks, cls) => marks.pill.querySelector('.' + cls);

beforeEach(() => window.localStorage.clear());

describe('End is an X', () => {
    test('no words on it, "End experience" as its name, an icon, and it still ends', () => {
        const { marks, session } = rig();
        const end = marks.pill.querySelector('[data-role="end"]');
        expect(end.textContent.trim()).toBe('');
        expect(end.querySelector('svg')).not.toBeNull();
        expect(end.getAttribute('aria-label')).toBe('End experience');
        expect(marks.pill.textContent).not.toMatch(/End experience/);
        end.click();
        expect(session.end).toHaveBeenCalledTimes(1);
    });

    test('touch screens get a 44 px target around a small icon', () => {
        expect(Marks.CSS).toMatch(
            /@media \(pointer: coarse\) \{\s*#nexus-activity-pill \.nexus-activity-end \{ width: 44px; height: 44px; \}/
        );
        expect(Marks.CSS).toMatch(/\.nexus-activity-end svg \{ width: 14px; height: 14px;/);
    });

    test('asks first only when the running activity says ending would lose something', () => {
        window.confirm = jest.fn(() => false);
        const panel = { activeActivity: { unsavedProgress: () => 'Your plan is not saved.' }, stopActivity: jest.fn() };
        const { marks, session } = rig({ panel });
        marks.pill.querySelector('[data-role="end"]').click();
        expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/not saved/));
        expect(session.end).not.toHaveBeenCalled();
        window.confirm = jest.fn(() => true);
        marks.pill.querySelector('[data-role="end"]').click();
        expect(session.end).toHaveBeenCalledTimes(1);
        // Nothing unsaved: no question.
        window.confirm = jest.fn();
        const plain = rig({ panel: { activeActivity: {}, stopActivity: jest.fn() } });
        plain.marks.pill.querySelector('[data-role="end"]').click();
        expect(window.confirm).not.toHaveBeenCalled();
        expect(plain.session.end).toHaveBeenCalled();
        delete window.confirm;
    });
});

describe('only the X (DX5)', () => {
    test('one control and nothing else to look at: no name, no dot, no minimise', () => {
        const { marks } = rig();
        const buttons = marks.pill.querySelectorAll('button');
        expect(buttons.length).toBe(1);
        expect(buttons[0].dataset.role).toBe('end');
        expect(marks.pill.querySelector('.nexus-activity-dot')).toBeNull();
        // The name is kept for screen readers only.
        const words = marks.pill.querySelector('.nexus-activity-words');
        expect(words.textContent).toBe('Experiences · Seaside Evening');
        expect(Marks.CSS).toMatch(/\.nexus-activity-words \{\s*position: absolute; width: 1px; height: 1px;[^}]*clip/);
        expect(words.getAttribute('role')).toBe('status');
        expect(marks.pill.getAttribute('role')).toBeNull();
    });

    test('the X says what it ends: in its name and in its tooltip', () => {
        const { marks } = rig();
        const end = marks.pill.querySelector('[data-role="end"]');
        expect(end.getAttribute('aria-label')).toBe('End experience');
        expect(end.title).toBe('End Seaside Evening');
        const life = rig({ destination: 'life', activity: 'relax' });
        expect(life.marks.pill.querySelector('[data-role="end"]').getAttribute('aria-label')).toBe('End relax');
    });

    test('quiet: a small round button with a thin border, no colour of its own, no shadow', () => {
        const rule = Marks.CSS.match(/\.nexus-activity-end \{[^}]*\}/)[0];
        expect(rule).toMatch(/border-radius: 50%/);
        expect(rule).toMatch(/border: 1px solid rgba\(255, 255, 255, \.12\)/);
        expect(rule).not.toMatch(/box-shadow|--mark/);
        expect(Marks.CSS).toMatch(/\}\s*$/); // no backtick closed the template early
    });

    test('nothing explicit running: no X', () => {
        const { marks } = rig({ destination: 'life', activity: 'talk' });
        expect(marks.pill.hidden).toBe(true);
    });

    test('on a phone it docks at the right above the chat sheet, inside the safe area', () => {
        expect(Marks.CSS).toMatch(
            /body\.nexus-mobile\.nexus-portrait #nexus-activity-pill \{\s*position: fixed; bottom: var\(--nexus-activity-dock, 120px\); right: calc\(12px \+ env\(safe-area-inset-right, 0px\)\)/
        );
        const { marks } = rig();
        document.body.classList.add('nexus-mobile', 'nexus-portrait');
        marks.refresh();
        expect(marks.pill.parentNode).toBe(document.body);
    });

    test('one component, removed cleanly', () => {
        const { marks } = rig();
        expect(document.querySelectorAll('#' + Marks.PILL_ID).length).toBe(1);
        marks.detach();
        expect(document.getElementById(Marks.PILL_ID)).toBeNull();
    });
});

describe('Immersive mode (clean view)', () => {
    let live;
    beforeEach(() => {
        document.documentElement.className = '';
        document.body.className = '';
        document.body.innerHTML =
            '<div class="avatar-viewport"><div class="hud-overlay"></div></div>' +
            '<div class="chat-card"><div class="chat-input-shell"><textarea></textarea></div></div>';
        live = Immersive.attach({ doc: document });
    });
    afterEach(() => live.detach());

    test('a discreet way in, one way out, and Escape', () => {
        const toggle = document.getElementById(Immersive.TOGGLE_ID);
        const exit = document.getElementById(Immersive.EXIT_ID);
        expect(toggle.parentNode.className).toBe('avatar-viewport');
        expect(toggle.getAttribute('aria-label')).toBe('Clean view');
        expect(exit.hidden).toBe(true);
        toggle.click();
        expect(live.on).toBe(true);
        expect(document.documentElement.classList.contains(Immersive.CLASS)).toBe(true);
        expect(exit.hidden).toBe(false);
        expect(exit.getAttribute('aria-label')).toBe('Show controls');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(live.on).toBe(false);
        expect(exit.hidden).toBe(true);
    });

    test("hides the status, chips and viewport chrome; the chat only by the person's choice", () => {
        for (const sel of [
            '#nexus-activity-pill',
            '#nexus-playground-bar',
            '.avatar-viewport .hud-overlay',
            '.avatar-viewport .status-badge',
        ])
            expect(Immersive.CSS).toContain(sel);
        live.set(true);
        expect(document.documentElement.classList.contains(Immersive.CHAT_CLASS)).toBe(true); // default
        live.setHideChat(false);
        expect(document.documentElement.classList.contains(Immersive.CHAT_CLASS)).toBe(false);
        expect(window.localStorage.getItem(Immersive.CHAT_KEY)).toBe('show');
        expect(Immersive.readHideChat(window.localStorage)).toBe(false);
    });

    test('nothing keeps running or stops because of it: the module never touches a session', () => {
        const src = fs.readFileSync(path.join(__dirname, '../../src/companion/ImmersiveMode.js'), 'utf8');
        expect(src).not.toMatch(/__NEXUS_COMPANION_LIVE|\.end\(|stopActivity|\.pause\(|vrWorlds/);
    });

    test('entering VR or AR leaves clean view, so the controls are there on return', () => {
        live.set(true);
        window.dispatchEvent(new Event('vr-session-start'));
        expect(live.on).toBe(false);
    });

    test('Settings gets one checkbox for the chat', () => {
        document.body.insertAdjacentHTML(
            'beforeend',
            '<div id="settings-modal"><div class="modal-content"><div class="config-section"><h3 class="config-title">DEVELOPER</h3></div></div></div>'
        );
        const section = Immersive.attachSettings(live, { doc: document });
        const box = section.querySelector('input[type="checkbox"]');
        expect(box.checked).toBe(true);
        box.checked = false;
        box.dispatchEvent(new Event('change'));
        expect(live.hideChat).toBe(false);
        expect(section.nextElementSibling.querySelector('.config-title').textContent).toBe('DEVELOPER');
    });
});
