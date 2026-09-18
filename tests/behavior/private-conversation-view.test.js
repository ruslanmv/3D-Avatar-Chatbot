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
