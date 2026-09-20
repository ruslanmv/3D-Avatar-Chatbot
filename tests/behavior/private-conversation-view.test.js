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

describe('Private owns the conversation, including its waiting indicator (P26)', () => {
    const mainSource = () => {
        // eslint-disable-next-line global-require
        const fs = require('fs');
        // eslint-disable-next-line global-require
        const path = require('path');
        return fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    };

    test('the generic NEXUS placeholder is never shown through a feature surface', () => {
        // Three signs of the same fact, one of them in a surface Private had already replaced:
        //   Top bar      THINKING…       ← global app status, fine
        //   Private card • • •           ← the one that belongs to the conversation
        //   #chat-history NEXUS • • •    ← the duplicate
        const source = mainSource();
        expect(source).toMatch(/function _conversationOwnedByFeature\(\)/);
        expect(source).toMatch(/window\.setTypingIndicator\(Boolean\(show\) && !_conversationOwnedByFeature\(\)\)/);
    });

    test('and every call site goes through the rule rather than around it', () => {
        // The rule is worth nothing if one of the seven paths keeps calling the global directly.
        const source = mainSource();
        const direct = source
            .split('\n')
            .filter((line) => !/^\s*(?:\*|\/\/)/.test(line))
            .filter((line) => /window\.setTypingIndicator\(/.test(line))
            // The definition inside `_setTyping` is the one place allowed to call it.
            .filter((line) => !/Boolean\(show\)/.test(line));
        expect(direct).toEqual([]);
        expect(source.match(/_setTyping\(/g).length).toBeGreaterThanOrEqual(7);
    });

    test('mounting clears one that was already on screen', () => {
        // `main.js` suppresses it from here on, but an indicator showing when Private mounted has
        // nothing left to clear it and would sit there for the whole session.
        page();
        const cleared = [];
        window.setTypingIndicator = (show) => cleared.push(show);
        const view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Romantic' }, scene: '' });
        expect(cleared).toContain(false);
        view.destroy();
        delete window.setTypingIndicator;
    });

    test('a synthesiser that throws does not fail the mount', () => {
        page();
        window.setTypingIndicator = () => {
            throw new Error('no such element');
        };
        const view = new PrivateConversationView.View({ doc: document, win: window });
        expect(view.mount({ preset: { label: 'Romantic' }, scene: '' })).toBe(true);
        view.destroy();
        delete window.setTypingIndicator;
    });

    test('the card keeps its own dots, which are the single inline indicator', () => {
        page();
        const view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Romantic' }, scene: '' });

        view.showThinking();
        expect(document.querySelector('[data-private-thinking="1"]')).not.toBeNull();
        expect(view.isThinking).toBe(true);

        // And they come down in place when the reply starts, rather than a second bubble opening.
        const before = document.querySelectorAll('[data-private-turn="her"]').length;
        const stream = view.beginAssistantTurn();
        expect(document.querySelector('[data-private-thinking="1"]')).toBeNull();
        stream.finish('I was thinking about you.');
        expect(document.querySelectorAll('[data-private-turn="her"]').length).toBe(before + 1);

        view.destroy();
    });
});

describe('the header and the controls stay on screen (P25)', () => {
    /** The one stylesheet the view injects, as text. */
    const css = () => document.getElementById('nexus-private-conversation-styles').textContent;

    function mounted() {
        page();
        const view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Romantic' }, scene: '' });
        return view;
    }

    test('the row never grows past the panel it lives in', () => {
        // The fix, and the whole of it. `#chat-history` has `height:100%`, so bounding the row to
        // its parent means nothing ever scrolls except the transcript inside the card — which is
        // what keeps the header at the top and the controls at the bottom without either having
        // to be positioned.
        const view = mounted();
        expect(css()).toMatch(/#nexus-private-conversation-row\{[^}]*max-height:calc\(100% - 18px\)/);
        expect(css()).toMatch(/#nexus-private-conversation-row\{[^}]*flex-direction:column/);
        view.destroy();
    });

    test('and the transcript is the only part that scrolls', () => {
        const view = mounted();
        expect(css()).toMatch(/\.nexus-private-card\{[^}]*flex:1 1 auto/);
        expect(css()).toMatch(/\.nexus-private-card\{[^}]*min-height:0/);
        expect(css()).toMatch(/\.nexus-private-card\{[^}]*overflow-y:auto/);
        for (const fixed of ['heading', 'bar', 'soundtrack']) {
            expect(css()).toMatch(new RegExp(`\\.nexus-private-${fixed}\\{[^}]*flex:0 0 auto`));
        }
        view.destroy();
    });

    test('nothing is sticky, because sticky was the overlap', () => {
        // `position:sticky` pinned the heading to the top of `#chat-history`, which is *below* the
        // card's own top once the card has scrolled — so the header was displaced downward and her
        // line painted in the band above it. Reported as the header overlaying the text. Bounding
        // the row removes the displacement and the need for sticky together.
        const view = mounted();
        expect(css()).not.toMatch(/position:sticky/);
        view.destroy();
    });

    test('the shell clips without becoming a scroll container', () => {
        // `overflow:hidden` rounds the corners *and* makes the shell a scroller, which would trap
        // the card's own scrolling in the wrong box. `overflow:clip` keeps the clipping and creates
        // no scroll container; the `hidden` before it is the fallback for a browser without `clip`.
        const view = mounted();
        expect(css()).toMatch(/\.nexus-private-shell\{[^}]*overflow:hidden;overflow:clip/);
        expect(css()).toMatch(/\.nexus-private-shell\{[^}]*flex-direction:column/);
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

    test('the ladder is dots, and the header badge carries the word (P26)', () => {
        // The word used to sit on the current step, which was right when the header showed the
        // *preset*. The header shows the current level now, so the footer was repeating it two
        // inches below — one more layer in a card the screenshot already read as too many.
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
        expect(rungs.map((n) => n.textContent)).toEqual(['•', '•', '•']);
        expect(rungs.filter((n) => n.classList.contains('is-reached'))).toHaveLength(2);
        // The word is in the header, once.
        expect(document.querySelector('.nexus-private-heading-title').textContent).toBe('Romantic');
        // And the shape is still spoken for anybody who cannot see it.
        expect(document.querySelector('.nexus-private-level').getAttribute('aria-label')).toMatch(
            /Romantic, step 2 of 3/
        );
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
