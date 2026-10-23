const { TryOnLiveLayout, recentRows, latestAssistantText } = require('../../src/wardrobe/TryOnLiveLayout');

function addMessage(who, message) {
    const row = document.createElement('div');
    row.className = 'chat-row';
    const bubble = document.createElement('div');
    bubble.className = 'chat-message ' + who;
    const body = document.createElement('div');
    body.className = 'message-text';
    body.textContent = message;
    bubble.appendChild(body);
    row.appendChild(bubble);
    document.getElementById('chat-history').appendChild(row);
    return row;
}

describe('avatar-first Try-On live presentation', () => {
    let layout;

    beforeEach(() => {
        document.body.innerHTML = [
            '<main class="content-layout">',
            '<section class="avatar-panel"></section>',
            '<section class="chat-panel"><div class="chat-card">',
            '<header class="chat-card-header"><button id="clear-history">Clear</button></header>',
            '<div class="chat-main"><div id="chat-history"></div></div>',
            '<footer class="chat-input-shell">',
            '<input id="speech-text"><button id="speak-btn">Send</button>',
            '</footer></div></section></main>',
        ].join('');
        addMessage('avatar', 'A conversation from before the haul');
        layout = new TryOnLiveLayout({ doc: document });
    });

    afterEach(() => {
        layout.unmount();
        document.body.innerHTML = '';
    });

    it('starts in Watch Mode without cloning or removing the actual transcript', () => {
        const input = document.getElementById('speech-text');
        const history = document.getElementById('chat-history');
        expect(layout.mount()).toBeTruthy();
        expect(document.querySelector('.content-layout').classList.contains('nexus-live-watch')).toBe(true);
        expect(document.getElementById('speech-text')).toBe(input);
        expect(document.getElementById('chat-history')).toBe(history);
        expect(history.querySelectorAll('.chat-row')).toHaveLength(1);
        expect(document.querySelector('.nexus-live-answer').textContent).not.toContain('before the haul');
    });

    it('shows only a new assistant reply in the Watch preview', () => {
        layout.mount();
        addMessage('user', 'Should we keep it?');
        addMessage('avatar', 'I love the silhouette. Shall we try the next look?');
        layout.update();
        expect(document.querySelector('.nexus-live-answer').textContent).toBe(
            'I love the silhouette. Shall we try the next look?'
        );
    });

    it('can switch to recent conversation and full history without losing content', () => {
        layout.mount();
        for (let i = 0; i < 6; i++) addMessage(i % 2 ? 'avatar' : 'user', 'Turn ' + i);
        layout.setMode('conversation');
        expect(document.querySelectorAll('.chat-row.nexus-live-older')).toHaveLength(3);
        expect(document.querySelector('.content-layout').classList.contains('nexus-live-conversation')).toBe(true);
        layout.setMode('history');
        expect(document.querySelector('.content-layout').classList.contains('nexus-live-history')).toBe(true);
        layout.setMode('watch');
        expect(document.querySelector('.content-layout').classList.contains('nexus-live-watch')).toBe(true);
    });

    it('reuses the existing Send button rather than sending via a duplicate chatbot', () => {
        layout.mount();
        const send = document.getElementById('speak-btn');
        const click = jest.fn();
        send.addEventListener('click', click);
        layout.ask('How would you style it?');
        expect(document.getElementById('speech-text').value).toBe('How would you style it?');
        expect(click).toHaveBeenCalledTimes(1);
    });

    it('removes only Try-On UI and restores normal conversation when closed', () => {
        layout.mount();
        addMessage('avatar', 'Beautiful choice!');
        layout.setMode('conversation');
        layout.unmount();
        expect(document.querySelector('.content-layout').classList.contains('nexus-live-tryon')).toBe(false);
        expect(document.querySelector('.nexus-live-summary')).toBeNull();
        expect(document.querySelectorAll('.chat-row')).toHaveLength(2);
        expect(document.querySelector('.nexus-live-older')).toBeNull();
    });

    it('keeps recent selection and caption helpers conservative', () => {
        expect(recentRows([1, 2, 3, 4, 5], 2)).toEqual([4, 5]);
        expect(latestAssistantText([])).toBe('');
        const first = addMessage('user', 'Hello');
        const second = addMessage('avatar', 'Hi!');
        expect(latestAssistantText([first, second])).toBe('Hi!');
    });
});
