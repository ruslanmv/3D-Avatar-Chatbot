/**
 * Playground entry point.
 *
 * The Together chooser is one DOM surface with responsive CSS: desktop uses the normal
 * activity grid and mobile turns that same grid into two columns. The regression we care
 * about is therefore not two implementations; it is that Playground is a normal native
 * contract activity, registers once, and renders as the same tile on both layouts.
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

beforeEach(() => {
    window.NEXUS_TOGETHER_SWITCH = { enable: jest.fn() };
});

afterEach(() => {
    delete window.NEXUS_TOGETHER_SWITCH;
    document.body.innerHTML = '';
});

describe('Playground activity contract', () => {
    test('is a family entry with Scene Tale and no capture permission', () => {
        const activity = PlaygroundActivity.attach();
        expect(activity.__contract).toBe(true);
        expect(activity.id).toBe('playground');
        expect(activity.title).toBe('Playground');
        expect(activity.order).toBe(45);
        expect(activity.inputs()).toEqual([
            expect.objectContaining({ id: 'scene-tale', label: 'Scene Tale', permission: null }),
        ]);
    });

    test('starts and stops without inventing story runtime state', async () => {
        const emit = jest.fn();
        const activity = PlaygroundActivity.attach({ bus: { emit } });
        const result = await activity.start({ input: { id: 'scene-tale' } });

        expect(result).toEqual(expect.objectContaining({ ok: true, mode: 'scene-tale' }));
        expect(activity.status()).toEqual({ label: 'Scene Tale', detail: 'Playground' });
        expect(emit).toHaveBeenCalledWith(
            'playground:start',
            expect.objectContaining({ mode: 'scene-tale', audience: 'family' })
        );

        expect(activity.stop('user')).toBe(true);
        expect(activity.status()).toBeNull();
        expect(emit).toHaveBeenCalledWith('playground:stop', { mode: 'scene-tale', why: 'user' });
    });
});

describe('Together chooser access', () => {
    test('Playground renders as a normal chooser tile and opens Scene Tale setup', () => {
        const p = panel();
        p.register(PlaygroundActivity.attach());
        p.open();

        const tile = document.querySelector('[data-activity="playground"]');
        expect(tile).not.toBeNull();
        expect(tile.classList.contains('nexus-bd-together-tile')).toBe(true);
        expect(tile.textContent).toContain('Playground');

        tile.click();
        expect(document.getElementById(TogetherPanel.PANEL_ID).textContent).toContain('Scene Tale');
        expect(document.getElementById(TogetherPanel.PANEL_ID).textContent).toContain(
            'A short interactive story inspired by where we are.'
        );
    });

    test('the shared launcher CSS keeps the activity grid responsive for desktop and mobile', () => {
        // One chooser, two responsive layouts. A separate mobile Playground implementation
        // would be the bug: it could drift in availability, focus or consent behavior.
        expect(TogetherLauncher.CSS).toContain('grid-template-columns: repeat(3, 1fr)');
        expect(TogetherLauncher.CSS).toContain('grid-template-columns: repeat(2, 1fr)');
    });
});
