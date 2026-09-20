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
        // The heading shows the level, not the preset (P12) — the preset is a ceiling and the
        // ladder in the footer carries it.
        expect(row.querySelector('.nexus-private-heading-title').textContent).toBe('Warm');
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

describe('the header and the controls stay on screen (P24)', () => {
    /** The one stylesheet the view injects, as text. */
    const css = () => document.getElementById('nexus-private-conversation-styles').textContent;

    test('the heading sticks to the top of the scroller', () => {
        // Reported: `🔐 PRIVATE / Warm` scrolled out of sight. The row lives in `#chat-history`,
        // and `_scroll()` pins that container to the bottom after every turn — so on a tall phone,
        // where the card is taller than the panel, the header was pushed off the top on each line.
        page();
        const view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Romantic' }, scene: '' });
        expect(css()).toMatch(/\.nexus-private-heading\{[^}]*position:sticky/);
        expect(css()).toMatch(/\.nexus-private-heading\{[^}]*top:0/);
        view.destroy();
    });

    test('and the controls stick to the bottom', () => {
        // Same failure, other end: `← Ease up`, `Closer →` and `End` are the safety controls, and
        // a safety control you have to scroll to find is one you do not have.
        page();
        const view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Romantic' }, scene: '' });
        expect(css()).toMatch(/\.nexus-private-bar\{[^}]*position:sticky/);
        expect(css()).toMatch(/\.nexus-private-bar\{[^}]*bottom:0/);
        view.destroy();
    });

    test('both are opaque, so the transcript does not read through them', () => {
        page();
        const view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Romantic' }, scene: '' });
        expect(css()).toMatch(/\.nexus-private-heading\{[^}]*background:linear-gradient/);
        expect(css()).toMatch(/\.nexus-private-bar\{[^}]*background:linear-gradient/);
        view.destroy();
    });

    test('the shell clips without becoming a scroll container', () => {
        // `overflow:hidden` rounds the corners *and* makes the shell a scroller, which would trap
        // a sticky child inside it — sticking to the top of the card rather than to the top of the
        // view. `overflow:clip` keeps the clipping and creates no scroll container; the `hidden`
        // before it is the fallback for a browser that does not know `clip`.
        page();
        const view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Romantic' }, scene: '' });
        expect(css()).toMatch(/\.nexus-private-shell\{overflow:hidden;overflow:clip/);
        view.destroy();
    });
});

describe('the footer, and a confirmation that is not conversation (P12)', () => {
    let view;

    function mount() {
        page();
        view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Sensual' }, scene: 'Coastal Terrace' });
        return view;
    }

    const ids = () => [...document.querySelectorAll('[data-private-action]')].map((b) => b.dataset.privateAction);

    afterEach(() => {
        if (view) view.destroy();
        view = null;
    });

    test('forward is the prominent control and easing the quiet one', () => {
        // P11 made de-escalation the loudest thing in the card, which is backwards for an experience
        // whose emotional action is moving forward.
        mount();
        view.setPace({
            pace: 'Romantic',
            level: 2,
            maxLevel: 3,
            hasLadder: true,
            steps: [
                { level: 1, label: 'Warm', reached: true, current: false },
                { level: 2, label: 'Romantic', reached: true, current: true },
                { level: 3, label: 'Sensual', reached: false, current: false },
            ],
            forward: 'More',
            canEase: true,
        });

        expect(ids()).toEqual(['ease', 'closer', 'end']);
        const forward = document.querySelector('[data-private-action="closer"]');
        const ease = document.querySelector('[data-private-action="ease"]');
        expect(forward.textContent).toBe('More →');
        expect(forward.classList.contains('is-primary')).toBe(true);
        expect(ease.textContent).toBe('← Ease up');
        expect(ease.classList.contains('is-secondary')).toBe(true);
    });

    test('a control that cannot act is not drawn at all, rather than drawn and disabled', () => {
        // Half of the reported bug was a button that went on inviting a tap it could not act on. The
        // set of controls changes with the level, so the footer is rebuilt rather than toggled.
        mount();
        view.setPace({
            pace: 'Warm',
            level: 1,
            maxLevel: 3,
            hasLadder: true,
            steps: [],
            forward: 'Closer',
            canEase: false,
        });
        expect(ids()).toEqual(['closer', 'end']);

        view.setPace({
            pace: 'Sensual',
            level: 3,
            maxLevel: 3,
            hasLadder: true,
            steps: [],
            forward: '',
            canEase: true,
        });
        expect(ids()).toEqual(['ease', 'end']);
    });

    test('the ladder shows where the evening is, with one word not three', () => {
        // Three labels in a phone-width footer is a legend, and a legend is something to read rather
        // than glance at.
        mount();
        view.setPace({
            pace: 'Romantic',
            level: 2,
            maxLevel: 3,
            hasLadder: true,
            steps: [
                { level: 1, label: 'Warm', reached: true, current: false },
                { level: 2, label: 'Romantic', reached: true, current: true },
                { level: 3, label: 'Sensual', reached: false, current: false },
            ],
            forward: 'More',
            canEase: true,
        });

        const rungs = [...document.querySelectorAll('[data-private-step]')];
        expect(rungs).toHaveLength(3);
        expect(rungs.map((n) => n.textContent)).toEqual(['•', 'Romantic', '•']);
        expect(rungs.filter((n) => n.classList.contains('is-reached'))).toHaveLength(2);
        expect(document.querySelector('.nexus-private-level').getAttribute('aria-label')).toMatch(/step 2 of 3/);
    });

    test('a one-level preset gets the word instead of a one-dot ladder', () => {
        mount();
        view.setPace({ pace: 'Warm', level: 1, maxLevel: 1, hasLadder: false, steps: [], forward: '', canEase: false });
        expect(document.querySelectorAll('[data-private-step]')).toHaveLength(0);
        expect(document.querySelector('.nexus-private-level').textContent).toBe('Warm');
        expect(ids()).toEqual(['end']);
    });

    test('the heading follows the level rather than the preset', () => {
        mount();
        expect(document.querySelector('.nexus-private-heading-title').textContent).toBe('Warm');
        view.setPace({
            pace: 'Sensual',
            level: 3,
            maxLevel: 3,
            hasLadder: true,
            steps: [],
            forward: '',
            canEase: true,
        });
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
            'closer',
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
