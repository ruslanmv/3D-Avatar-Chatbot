/**
 * PV7. While Private runs, the chat from before it is not shown: on a phone the old bubbles filled
 * the screen above the card and over her (owner, 2026-11-21). When Private ends they are back,
 * untouched.
 */
const Private = require('../../src/features/together/ui/PrivateConversationView.js');

describe('PV7. the old chat is quiet during Private', () => {
    beforeEach(() => {
        document.body.innerHTML =
            '<div id="chat-history"><div class="message user">Cosa sai fare</div><div class="message assistant">Posso aiutarti…</div></div>';
    });

    test('hidden while the card is up, even when restore code re-appends it; back afterwards', () => {
        const host = document.getElementById('chat-history');
        const view = new Private.View({ doc: document, win: window });
        expect(view.mount({ scene: 'Window room' })).toBe(true);
        expect(host.classList.contains('nexus-private-quiet')).toBe(true);
        const css = document.getElementById('nexus-private-conversation-styles').textContent;
        expect(css).toMatch(
            /#chat-history\.nexus-private-quiet > :not\(#nexus-private-conversation-row\)\{display:none/
        );
        // Chat restore puts the old messages back: still under the same rule.
        const again = document.createElement('div');
        again.className = 'message assistant';
        host.insertBefore(again, host.firstChild);
        expect(host.classList.contains('nexus-private-quiet')).toBe(true);
        view.destroy();
        expect(host.classList.contains('nexus-private-quiet')).toBe(false);
        expect(host.querySelectorAll('.message')).toHaveLength(3); // nothing was removed
    });
});
