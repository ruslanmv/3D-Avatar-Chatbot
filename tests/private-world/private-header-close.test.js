/**
 * PV8. On a phone the card gave her more room (owner's mockup, 2026-11-21): End is a × at the
 * heading's right with ⋯ just before it, both 44 × 44 px; Closer / Ease sit in the body; the old
 * footer is gone; the card sits ~8 px above the message input.
 */
const Private = require('../../src/features/together/ui/PrivateConversationView.js');
const PrivateLocale = require('../../src/features/together/PrivateLocale.js');

describe('PV8. close in the heading, pace in the body', () => {
    let ended;
    let view;
    beforeEach(() => {
        document.body.innerHTML = '<div id="chat-history"></div>';
        ended = 0;
        view = new Private.View({ doc: document, win: window, onEnd: () => (ended += 1), onCloser: () => {} });
        view.mount({ scene: 'Window room' });
    });
    afterEach(() => view.destroy());

    test('× ends the evening, comes after ⋯, and is labelled for screen readers', () => {
        const heading = document.querySelector('.nexus-private-heading');
        const end = heading.querySelector('.nexus-private-end');
        expect(end).not.toBeNull();
        expect(end.previousElementSibling.classList.contains('nexus-private-more')).toBe(true);
        expect(end.getAttribute('aria-label')).toBe(PrivateLocale.t('controls.aria.end'));
        expect(PrivateLocale.PACKS['it-IT']['controls.aria.end']).toBe('Termina chat');
        end.click();
        expect(ended).toBe(1);
        // Only one End anywhere.
        expect(document.querySelectorAll('[data-private-action="end"]')).toHaveLength(1);
    });

    test('Closer lives in the body and the footer is gone', () => {
        expect(document.querySelector('.nexus-private-bar')).toBeNull();
        const pace = document.querySelector('.nexus-private-pace');
        expect(pace.querySelector('[data-private-action="closer"]')).not.toBeNull();
        expect(pace.nextElementSibling.classList.contains('nexus-private-card')).toBe(true);
    });

    test('44 px targets, × after ⋯ in the heading, the card close to the input on a phone', () => {
        const css = document.getElementById('nexus-private-conversation-styles').textContent;
        expect(css).toMatch(/\.nexus-private-end\{order:5;[^}]*width:44px;height:44px/);
        expect(css).toMatch(/@media\(pointer:coarse\)\{[^}]*\.nexus-private-more[^}]*min-height:44px/);
        expect(css).toMatch(
            /#nexus-private-conversation-row\{height:calc\(100% - 6px\);max-height:calc\(100% - 6px\);margin:6px 0 0/
        );
    });
});
