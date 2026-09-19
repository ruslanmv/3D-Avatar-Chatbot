/**
 * Scene Tale presentation belongs to Conversation, not a fixed overlay across the app.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const View = require('../../src/features/together/ui/SceneTaleConversationView.js');
const Publisher = require('../../src/features/together/ui/ConversationPublisher.js');
const Playground = require('../../src/features/together/activities/playground.js');

const SOUNDTRACK = {
    id: 'abc123xyz00',
    provider: 'youtube',
    kind: 'music',
    title: 'Gentle cinematic instrumental',
    creator: 'Example Artist',
    url: 'https://www.youtube.com/watch?v=abc123xyz00',
};

function scene() {
    return { id: 'magical-forest-night', label: 'Magical Forest · Night' };
}

function story() {
    return Playground.fallbackStory(scene(), 'A small light between the trees', false);
}

function legacyHud() {
    const node = document.createElement('div');
    node.id = View.HUD_ID;
    node.innerHTML = `
        <div class="nexus-story-card">A quiet opening.</div>
        <div class="nexus-story-bar">
            <span class="nexus-story-title">The Magical Forest</span>
            <span class="nexus-story-time">0:17</span>
            <button>Pause</button>
            <button>End</button>
        </div>
    `;
    document.body.appendChild(node);
    return node;
}

function installConversation() {
    document.body.innerHTML = `
        <div id="chat-history" class="chat-history">
            <div class="empty-state">No transcript yet</div>
        </div>
        <input id="speech-text" placeholder="Type your message..." />
        <button id="speak-btn">Send</button>
    `;
    window.NEXUS_BD = {
        togetherPanel: {
            activities: new Map(),
        },
    };
    View.install(document, window);
    View.patchStoryPlayer(Playground);
}

beforeEach(() => {
    View.detach();
    window.__NEXUS_SCENE_TALE_VIEW_NOAUTO__ = true;
    window.NEXUS_SCENE_TALE_VIEW = View;
    installConversation();
});

afterEach(() => {
    View.detach();
    delete window.NEXUS_SCENE_TALE_VIEW;
    delete window.NEXUS_MEDIA_SESSION;
    delete window.NEXUS_CURRENT_MEDIA;
    delete window.NEXUS_YT_2D;
    delete window.NEXUS_YT_ASK;
    delete window.NEXUS_BD;
    delete window.__NEXUS_SCENE_TALE_VIEW_NOAUTO__;
    document.body.innerHTML = '';
});

describe('Conversation-owned Scene Tale surface', () => {
    test('StoryPlayer mounts directly into Conversation with a visible Starting state', () => {
        const player = new Playground.StoryPlayer({
            plan: story(),
            win: window,
            doc: document,
            say: jest.fn(),
            timingScale: 0,
            bus: { emit: jest.fn() },
        });
        window.NEXUS_BD.togetherPanel.activities.set('playground', { player });

        const result = player.start();

        expect(result).toEqual({ ok: true, why: 'playing' });
        const row = document.getElementById(View.ROW_ID);
        const hud = document.getElementById(View.HUD_ID);
        expect(row).not.toBeNull();
        expect(row.parentElement).toBe(document.getElementById('chat-history'));
        expect(hud.parentElement).toBe(row);
        expect(document.querySelector(`body > #${View.HUD_ID}`)).toBeNull();
        expect(hud.textContent).toContain('SCENE TALE');
        expect(hud.textContent).toContain(player.plan.title);
        expect(hud.textContent).toContain('Fictional story inspired by this scene');
        expect(hud.textContent).toContain('Starting the story…');
        expect(hud.textContent).toContain('Pause');
        expect(hud.textContent).toContain('End');
        expect(document.getElementById('speech-text').placeholder).toBe('Talk to the story…');

        player.detach();
    });

    test('the compatibility path still adopts an old fallback HUD when Conversation exists', () => {
        const node = legacyHud();
        const row = View.adoptHud(document);

        expect(row).not.toBeNull();
        expect(row.id).toBe(View.ROW_ID);
        expect(row.parentElement).toBe(document.getElementById('chat-history'));
        expect(node.parentElement).toBe(row);
        expect(node.classList.contains('is-conversation')).toBe(true);
        expect(node.style.position).toBe('relative');
        expect(document.querySelector('#chat-history > .empty-state')).toBeNull();
        expect(node.textContent).toContain('SCENE TALE');
    });

    test('normal chat submission pauses active story speech and exposes Resume', () => {
        const player = new Playground.StoryPlayer({
            plan: story(),
            win: window,
            doc: document,
            say: jest.fn(),
            timingScale: 0,
            bus: { emit: jest.fn() },
        });
        window.NEXUS_BD.togetherPanel.activities.set('playground', { player });
        player.start();
        expect(player.state).toBe('playing');

        document.getElementById('speak-btn').click();

        expect(player.state).toBe('paused');
        expect(document.getElementById(View.HUD_ID).textContent).toContain('Resume');
        player.detach();
    });

    test('completion is terminal: timer/Pause/End disappear and composer returns to normal', () => {
        const player = new Playground.StoryPlayer({
            plan: story(),
            win: window,
            doc: document,
            say: jest.fn(),
            timingScale: 0,
            bus: { emit: jest.fn() },
        });
        window.NEXUS_BD.togetherPanel.activities.set('playground', { player });
        player.start();
        expect(document.getElementById('speech-text').placeholder).toBe('Talk to the story…');

        player._finish('complete');

        const hud = document.getElementById(View.HUD_ID);
        const bar = hud.querySelector('.nexus-story-bar');
        expect(hud.textContent).toContain('Story complete');
        expect(hud.textContent).toContain('Save to Histories');
        expect(hud.textContent).toContain('Another version');
        expect(hud.textContent).toContain('Back to Together');
        expect(bar.hidden).toBe(true);
        expect(bar.getAttribute('aria-hidden')).toBe('true');
        expect(document.getElementById('speech-text').placeholder).toBe('Type your message...');

        player.detach();
    });

    test('no Conversation surface keeps the fixed HUD fallback available', () => {
        View.detach();
        document.body.innerHTML = '';
        View.install(document, window);
        View.patchStoryPlayer(Playground);
        const player = new Playground.StoryPlayer({
            plan: story(),
            win: window,
            doc: document,
            say: jest.fn(),
            timingScale: 0,
            bus: { emit: jest.fn() },
        });

        player.start();

        const hud = document.getElementById(View.HUD_ID);
        expect(hud).not.toBeNull();
        expect(hud.parentElement).toBe(document.body);
        expect(hud.classList.contains('is-conversation')).toBe(false);
        player.detach();
    });
});

describe('Ready transition polish', () => {
    test('Start story immediately reads Starting and Edit setup replaces the premature another-version action', () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <div class="nexus-story-ready-meta">About 5 minutes · 2 choices\n✓ Story ready · ✓ Scene ready · Soundtrack ready</div>
            <button data-action="start-story">Start story</button>
            <button data-action="another-version">Create another version</button>
        `;
        document.body.appendChild(root);
        View.decorateReadyControls(document);

        const start = root.querySelector('[data-action="start-story"]');
        const edit = root.querySelector('[data-action="another-version"]');
        start.click();

        expect(start.disabled).toBe(true);
        expect(start.textContent).toBe('Starting…');
        expect(edit.textContent).toBe('Edit setup');
        expect(root.querySelector('.nexus-story-ready-meta').textContent).toContain('Ready to begin');
    });
});

describe('Scene Tale soundtrack presentation', () => {
    test('publishes background music inside the Scene Tale card instead of another conversation message', () => {
        const player = new Playground.StoryPlayer({
            plan: story(),
            win: window,
            doc: document,
            say: jest.fn(),
            timingScale: 0,
            bus: { emit: jest.fn() },
        });
        window.NEXUS_BD.togetherPanel.activities.set('playground', { player });
        player.start();
        const node = document.getElementById(View.HUD_ID);

        const card = document.createElement('div');
        card.className = 'nexus-yt-card';
        card.dataset.ytId = SOUNDTRACK.id;
        const buildCard = jest.fn(() => card);
        const activate = jest.fn();
        window.NEXUS_YT_2D = { buildCard, activate };
        window.NEXUS_MEDIA_SESSION = {
            get: jest.fn(() => ({ source: 'scene-tale' })),
            requestPlay: jest.fn(),
        };
        window.NEXUS_CURRENT_MEDIA = { set: jest.fn() };
        window.NEXUS_YT_ASK = { say: jest.fn(() => document.createElement('div')) };

        const published = Publisher.publish(SOUNDTRACK, { doc: document, win: window, play: true });

        expect(published).toBe(node);
        expect(window.NEXUS_YT_ASK.say).not.toHaveBeenCalled();
        expect(window.NEXUS_CURRENT_MEDIA.set).toHaveBeenCalledWith(SOUNDTRACK);
        expect(buildCard).toHaveBeenCalledTimes(1);
        expect(activate).toHaveBeenCalledTimes(1);
        expect(node.textContent).toContain('Soundtrack');
        expect(node.textContent).toContain('Gentle cinematic instrumental');
        expect(node.querySelector('[data-scene-tale-soundtrack="1"]')).not.toBeNull();
        expect(node.querySelector('.nexus-scene-tale-soundtrack-player')).not.toBeNull();

        player.detach();
    });

    test('non-Scene-Tale media still uses the existing ordinary ConversationPublisher path', () => {
        window.NEXUS_MEDIA_SESSION = { get: () => ({ source: 'music' }) };
        window.NEXUS_CURRENT_MEDIA = { set: jest.fn() };
        const message = document.createElement('div');
        const say = jest.fn(() => message);
        window.NEXUS_YT_ASK = { say };

        const published = Publisher.publish(SOUNDTRACK, { doc: document, win: window, play: false });

        expect(published).toBe(message);
        expect(say).toHaveBeenCalledTimes(1);
        expect(say.mock.calls[0][0]).toContain('tap it to play');
    });
});
