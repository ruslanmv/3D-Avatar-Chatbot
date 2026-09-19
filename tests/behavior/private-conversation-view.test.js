/* global describe, test, expect, beforeEach, afterEach, jest */

const PrivateConversationView = require('../../src/features/together/ui/PrivateConversationView.js');

function page({ collapsed = false } = {}) {
    document.body.innerHTML = `
        <section class="chat-panel${collapsed ? ' chat-overlay--collapsed' : ''}">
            <button id="chat-overlay-toggle" type="button">Expand</button>
            <div id="chat-history"><div class="empty-state">No transmissions recorded</div></div>
            <input id="speech-text" placeholder="Message">
            <button id="speak-btn" type="button">Send</button>
        </section>`;
    const panel = document.querySelector('.chat-panel');
    document.getElementById('chat-overlay-toggle').addEventListener('click', () => {
        panel.classList.remove('chat-overlay--collapsed');
    });
}

describe('PrivateConversationView', () => {
    beforeEach(() => page());
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('mounts visible Private content in Conversation and restores the composer on destroy', () => {
        const view = new PrivateConversationView.View({ doc: document, win: window });

        expect(view.mount({ preset: { label: 'Romantic' }, scene: 'Coastal Terrace · Twilight' })).toBe(true);
        view.showMessage('A private opening that must be visible.');

        const row = document.getElementById('nexus-private-conversation-row');
        expect(row.parentNode).toBe(document.getElementById('chat-history'));
        expect(row.textContent).toContain('Romantic');
        expect(row.textContent).toContain('A private opening that must be visible.');
        expect(document.querySelector('.empty-state')).toBeNull();
        expect(document.getElementById('speech-text').placeholder).toBe('Talk privately…');

        view.destroy();
        expect(document.getElementById('nexus-private-conversation-row')).toBeNull();
        expect(document.getElementById('speech-text').placeholder).toBe('Message');
    });

    test('expands collapsed mobile Conversation and survives a late history repaint', async () => {
        page({ collapsed: true });
        const view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Romantic' }, scene: 'Coastal Terrace · Twilight' });
        view.showMessage('Still here after chat restore.');

        expect(document.querySelector('.chat-panel').classList.contains('chat-overlay--collapsed')).toBe(false);

        const history = document.getElementById('chat-history');
        history.textContent = '';
        history.appendChild(document.createElement('div'));
        await Promise.resolve();

        const row = document.getElementById('nexus-private-conversation-row');
        expect(row).not.toBeNull();
        expect(row.parentNode).toBe(history);
        expect(row.textContent).toContain('Still here after chat restore.');
        view.destroy();
    });

    test('composer submission yields to the active conversation callback', () => {
        const onUserMessage = jest.fn();
        const view = new PrivateConversationView.View({ doc: document, win: window, onUserMessage });
        view.mount({ preset: { label: 'Affectionate' }, scene: 'Current place' });

        document.getElementById('speak-btn').click();
        expect(onUserMessage).toHaveBeenCalledTimes(1);
        view.destroy();
    });
});

describe('the gentle state, and a confirmation that is not conversation (P11)', () => {
    let view;

    function mount() {
        page();
        view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Sensual' }, scene: 'Coastal Terrace' });
        return view;
    }

    afterEach(() => {
        if (view) view.destroy();
        view = null;
    });

    test('the control says the request was accepted, and stops being a control', () => {
        // Half of why six taps happened: the button went on saying `↓ Slow down` at the floor,
        // which is an invitation.
        mount();
        const button = document.querySelector('[data-private-action="cozy"]');
        expect(button.textContent).toBe('↓ Slow down');
        expect(button.disabled).toBe(false);

        view.setGentle(true);
        expect(button.textContent).toBe('✓ Gentle');
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-label')).toMatch(/already as gentle/i);
    });

    test('the preset stops being the headline once somebody has asked for gentle', () => {
        // A Sensual session slowed to Warm showed `Sensual` in the heading and `Warm` in the
        // footer: both true, and together they read as the application insisting on a state the
        // person had just rejected.
        mount();
        expect(view.shell.classList.contains('is-gentle')).toBe(false);
        view.setGentle(true);
        expect(view.shell.classList.contains('is-gentle')).toBe(true);
        // The label is still there for anyone who wants it — CSS de-emphasises it rather than
        // deleting information.
        expect(document.querySelector('.nexus-private-heading-title').textContent).toBe('Sensual');
    });

    test('a status line fades, and never becomes a turn', () => {
        jest.useFakeTimers();
        mount();
        const turnsBefore = document.querySelectorAll('[data-private-turn]').length;

        view.showTransientStatus('✓ Pace softened');
        const status = document.querySelector('.nexus-private-status');
        expect(status.textContent).toBe('✓ Pace softened');
        expect(status.classList.contains('is-visible')).toBe(true);
        expect(document.querySelectorAll('[data-private-turn]').length).toBe(turnsBefore);

        jest.advanceTimersByTime(2000);
        expect(status.classList.contains('is-visible')).toBe(false);
        expect(status.textContent).toBe('');
        jest.useRealTimers();
    });

    test('a second status replaces the first rather than stacking', () => {
        jest.useFakeTimers();
        mount();
        view.showTransientStatus('✓ Pace softened');
        view.showTransientStatus('✓ Already gentle');
        expect(document.querySelectorAll('.nexus-private-status')).toHaveLength(1);
        expect(document.querySelector('.nexus-private-status').textContent).toBe('✓ Already gentle');
        jest.advanceTimersByTime(2000);
        expect(document.querySelector('.nexus-private-status').textContent).toBe('');
        jest.useRealTimers();
    });

    test('empty status text is not shown', () => {
        mount();
        expect(view.showTransientStatus('')).toBe(false);
        expect(view.showTransientStatus(null)).toBe(false);
    });

    test('offers on screen can be withdrawn without deleting the question', () => {
        mount();
        view.showMessage('Quieter, or closer?', [
            { id: 'quieter', label: 'Quieter', run: () => {} },
            { id: 'closer', label: 'Closer', run: () => {} },
        ]);
        expect(document.querySelectorAll('[data-private-action]')).toHaveLength(4);

        expect(view.consumePending()).toBe(true);
        // The words stay; the buttons stop being controls.
        expect(document.body.textContent).toContain('Quieter, or closer?');
        expect([...document.querySelectorAll('[data-private-action]')].map((b) => b.dataset.privateAction)).toEqual([
            'cozy',
            'end',
        ]);
        for (const button of document.querySelectorAll('.nexus-private-actions button')) {
            expect(button.disabled).toBe(true);
        }
        // Nothing left to withdraw.
        expect(view.consumePending()).toBe(false);
    });

    test('softening the soundtrack is best-effort, never fatal', () => {
        // The music is supporting material and must never be the reason a safety control fails.
        mount();
        expect(view.softenSoundtrack()).toBe(false);

        view._soundtrackCard = { _nexusPlayback: { setVolume: () => true } };
        expect(view.softenSoundtrack()).toBe(true);

        view._soundtrackCard = {
            _nexusPlayback: {
                setVolume: () => {
                    throw new Error('player is gone');
                },
            },
        };
        expect(view.softenSoundtrack()).toBe(false);
    });

    test('it asks for a level under the one the soundtrack came in at', () => {
        mount();
        let asked = null;
        view._soundtrackCard = {
            _nexusPlayback: {
                setVolume: (v) => {
                    asked = v;
                    return true;
                },
            },
        };
        view.softenSoundtrack();
        expect(asked).toBe(PrivateConversationView.QUIET_VOLUME);
        expect(asked).toBeLessThan(PrivateConversationView.VOLUME);
        // Lowered, not cut: the room gets quieter rather than the app announcing a change.
        expect(asked).toBeGreaterThan(0);
    });
});
