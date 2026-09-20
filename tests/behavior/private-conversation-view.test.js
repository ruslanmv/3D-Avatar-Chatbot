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

describe('how much of a phone the card is allowed to have (P27)', () => {
    /**
     * These read the stylesheet, not the layout.
     *
     * jsdom has no layout engine: every box is 0×0, `getBoundingClientRect` returns zeros and no
     * media query is ever evaluated. So "the transcript gets more room than 30vh on a 390×844
     * screen" cannot be asserted here at all — it is a browser measurement, and pretending
     * otherwise would be a test that passes whatever the CSS says. What *is* worth pinning is the
     * contract the browser would apply, because every one of these lines was chosen against a
     * specific failure and a later edit that drops one brings the failure back.
     */
    const css = () => document.getElementById('nexus-private-conversation-styles').textContent;

    function mounted() {
        page();
        const view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Romantic' }, scene: '' });
        return view;
    }

    /** The `@media(max-width:560px)` block that sizes the row, brace-balanced out of the sheet. */
    function mobileBlock() {
        const text = css();
        const start = text.indexOf('@media(max-width:560px){#nexus-private-conversation-row');
        if (start < 0) return '';
        let depth = 0;
        for (let i = text.indexOf('{', start); i < text.length; i += 1) {
            if (text[i] === '{') depth += 1;
            else if (text[i] === '}') {
                depth -= 1;
                if (depth === 0) return text.slice(start, i + 1);
            }
        }
        return '';
    }

    test('the transcript is no longer capped at 30vh', () => {
        // The reported complaint, and the single line that caused it. 30vh of a 390×844 phone is
        // ~253px, which is four lines of her once the padding is paid — on a screen with room for
        // fifteen. The cap has no replacement, because the row below bounds the card already.
        const view = mounted();
        expect(css()).not.toMatch(/30vh/);
        expect(mobileBlock()).toMatch(/\.nexus-private-card\{[^}]*max-height:none/);
        view.destroy();
    });

    test('the row takes the history box instead, which is already the right box', () => {
        // On mobile `.chat-main` is `flex:1 1 0;min-height:0;position:relative` and
        // `.chat-history` fills it, so the history's height *is* the gap between the panel header
        // and the composer. Asking for 100% of it, less this row's own 14px of margin, is the
        // whole geometry — and it is re-resolved by the browser on rotation, on the address bar
        // retracting and on the keyboard opening, none of which we have to hear about.
        const view = mounted();
        expect(mobileBlock()).toMatch(
            /#nexus-private-conversation-row\{[^}]*height:calc\(100% - 14px\)[^}]*max-height:calc\(100% - 14px\)/
        );
        expect(mobileBlock()).toMatch(/\.nexus-private-shell\{flex:1 1 auto\}/);
        view.destroy();
    });

    test('growing downward is not the same as growing everywhere', () => {
        // The card extends toward the composer. It must not extend toward her: the avatar is the
        // reason the screen is on, and reading room bought with her face is not a trade this
        // layout makes. Nothing in the mobile block moves the row's top — no negative margin, no
        // offset, no `position` — so the card starts exactly where it started.
        const block = mounted();
        expect(mobileBlock()).toMatch(/margin:6px 0 8px/);
        expect(mobileBlock()).not.toMatch(/margin(-top)?:-/);
        expect(mobileBlock()).not.toMatch(/position:(absolute|fixed)/);
        expect(mobileBlock()).not.toMatch(/\btop:/);
        block.destroy();
    });

    test('and the controls do not go with it', () => {
        // The failure mode of "make the card taller" is one tall scroller that takes `Closer` and
        // `End` down with the transcript. The fixed parts keep `flex:0 0 auto` from the base sheet
        // and the mobile block overrides none of it, so only `.nexus-private-card` scrolls.
        const view = mounted();
        for (const fixed of ['heading', 'bar', 'soundtrack']) {
            expect(mobileBlock()).not.toMatch(new RegExp(`\\.nexus-private-${fixed}\\{[^}]*flex:1`));
        }
        expect(mobileBlock()).not.toMatch(/\.nexus-private-shell\{[^}]*overflow-y:auto/);
        expect(mobileBlock()).not.toMatch(/#nexus-private-conversation-row\{[^}]*overflow-y:auto/);
        view.destroy();
    });

    test('a short screen drops the soundtrack rather than the transcript', () => {
        // The keyboard-open case: `.chat-main` is itself capped at 30vh there, so the history box
        // this row fills is a couple of hundred pixels. Something has to go, and the strip naming
        // a track that is already playing is worth less than the line she just said.
        const view = mounted();
        expect(css()).toMatch(
            /@media\(max-width:560px\) and \(max-height:450px\)\{\.nexus-private-soundtrack\{display:none\}\}/
        );
        view.destroy();
    });

    test('nothing measures anything, so there is nothing to keep in sync', () => {
        // The obvious implementation is a resize listener that reads the composer's top and sets
        // a pixel height. It is also a measurement loop that fights the address bar on iOS, runs
        // during momentum scrolling and is wrong for one frame after every rotation. The CSS above
        // needs none of it — this pins that no later change quietly adds one.
        const source = require('fs').readFileSync(
            require('path').join(__dirname, '../../src/features/together/ui/PrivateConversationView.js'),
            'utf8'
        );
        const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '');
        expect(code).not.toMatch(/ResizeObserver|visualViewport|'resize'|getBoundingClientRect/);
    });
});

describe('following the conversation without being dragged along (P28)', () => {
    /**
     * Reported: her answer arrives and you have to scroll down to it by hand, every turn.
     *
     * Two things were wrong and the second one hid the first. `_scroll` moved `#chat-history`,
     * which was the scroller until P27 gave `.nexus-private-card` `overflow-y:auto` — after that
     * the card overflowed, the history did not, and setting `scrollTop` on the history was a
     * no-op. And `finish()`, which is where a non-streaming provider delivers the *entire*
     * reply, never called `_scroll` at all.
     *
     * jsdom has no layout, so every box measures zero: `scrollHeight`, `scrollTop` and
     * `clientHeight` are all 0 and assignments to `scrollTop` are recorded but never clamped.
     * That is enough to pin *which element is scrolled and when*, which is the whole bug. It is
     * not enough to prove the pixel landed in the right place — that needs a browser.
     */
    function mounted() {
        page();
        const view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Romantic' }, scene: '' });
        // Stand in for layout: a card with content taller than its box.
        Object.defineProperty(view.card, 'scrollHeight', { value: 1000, configurable: true });
        Object.defineProperty(view.card, 'clientHeight', { value: 300, configurable: true });
        view.card.scrollTop = 0;
        return view;
    }

    test('the reply landing scrolls the card, which is the thing that scrolls', () => {
        const view = mounted();
        const stream = view.beginAssistantTurn();
        // Opening the turn already follows; zero it so this pins `finish` on its own, which is
        // where a non-streaming provider delivers the whole reply and where nothing scrolled.
        view.card.scrollTop = 0;

        stream.finish('I was thinking about you all afternoon.');

        expect(view.card.scrollTop).toBe(view.card.scrollHeight);
        view.destroy();
    });

    test('and so does each chunk while she is still typing', () => {
        const view = mounted();
        const stream = view.beginAssistantTurn();
        stream.append('I was');
        expect(view.card.scrollTop).toBe(view.card.scrollHeight);
        view.destroy();
    });

    test('sending something scrolls to it too', () => {
        const view = mounted();
        view.renderUserTurn('go on');
        expect(view.card.scrollTop).toBe(view.card.scrollHeight);
        view.destroy();
    });

    test('a reader who scrolled up to re-read is left alone', () => {
        // The other half of getting this right. Yanking somebody back to the bottom on every
        // token, while they are reading a line further up, is the classic chat-window annoyance.
        const view = mounted();
        view.card.scrollTop = 100; // well above the bottom of a 1000/300 box
        view.card.dispatchEvent(new window.Event('scroll'));

        view.beginAssistantTurn().finish('a new line');

        expect(view.card.scrollTop).toBe(100);
        view.destroy();
    });

    test('and following resumes the moment they come back to the bottom', () => {
        const view = mounted();
        view.card.scrollTop = 100;
        view.card.dispatchEvent(new window.Event('scroll'));
        view.card.scrollTop = 700; // 1000 - 300 = the bottom
        view.card.dispatchEvent(new window.Event('scroll'));

        view.beginAssistantTurn().finish('and again');

        expect(view.card.scrollTop).toBe(view.card.scrollHeight);
        view.destroy();
    });

    test('taking a turn of your own resumes it as well', () => {
        // Sending a message is the clearest statement that you want to see the answer.
        const view = mounted();
        view.card.scrollTop = 100;
        view.card.dispatchEvent(new window.Event('scroll'));

        view.renderUserTurn('still here');

        expect(view.card.scrollTop).toBe(view.card.scrollHeight);
        view.destroy();
    });

    test('a couple of pixels short of the bottom still counts as the bottom', () => {
        // Fractional heights and momentum scrolling leave a reader who is plainly at the bottom
        // a pixel or two off it; an exact comparison would quietly stop following.
        const view = mounted();
        view.card.scrollTop = 700 - 8;
        view.card.dispatchEvent(new window.Event('scroll'));

        view.beginAssistantTurn().finish('still following');

        expect(view.card.scrollTop).toBe(view.card.scrollHeight);
        view.destroy();
    });

    test('the listener does not outlive the card', () => {
        const view = mounted();
        const card = view.card;
        view.destroy();
        // No throw, and nothing left holding a reference to a card that is gone.
        card.dispatchEvent(new window.Event('scroll'));
        expect(view.card).toBeNull();
    });
});
