/**
 * Scene Tale presentation belongs to Conversation, not a fixed overlay across the app.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const View = require('../../src/features/together/ui/SceneTaleConversationView.js');
const Publisher = require('../../src/features/together/ui/ConversationPublisher.js');

const SOUNDTRACK = {
    id: 'abc123xyz00',
    provider: 'youtube',
    kind: 'music',
    title: 'Gentle cinematic instrumental',
    creator: 'Example Artist',
    url: 'https://www.youtube.com/watch?v=abc123xyz00',
};

function hud() {
    const node = document.createElement('div');
    node.id = View.HUD_ID;
    node.innerHTML = `
        <div class="nexus-story-card">A quiet opening.</div>
        <div class="nexus-story-bar">
            <span class="nexus-story-title">The Light That Stayed</span>
            <span class="nexus-story-time">0:17</span>
            <button>Pause</button>
            <button>End</button>
        </div>
    `;
    document.body.appendChild(node);
    return node;
}

beforeEach(() => {
    View.detach();
    window.__NEXUS_SCENE_TALE_VIEW_NOAUTO__ = true;
    window.NEXUS_SCENE_TALE_VIEW = View;
    document.body.innerHTML = `
        <div id="chat-history" class="chat-history">
            <div class="empty-state">No transcript yet</div>
        </div>
    `;
});

afterEach(() => {
    View.detach();
    delete window.NEXUS_SCENE_TALE_VIEW;
    delete window.NEXUS_MEDIA_SESSION;
    delete window.NEXUS_CURRENT_MEDIA;
    delete window.NEXUS_YT_2D;
    delete window.NEXUS_YT_ASK;
    delete window.__NEXUS_SCENE_TALE_VIEW_NOAUTO__;
    document.body.innerHTML = '';
});

describe('Conversation-owned Scene Tale surface', () => {
    test('moves the fallback HUD into chat-history and neutralises fixed viewport positioning', () => {
        const node = hud();
        const row = View.adoptHud(document);

        expect(row).not.toBeNull();
        expect(row.id).toBe(View.ROW_ID);
        expect(row.parentElement).toBe(document.getElementById('chat-history'));
        expect(node.parentElement).toBe(row);
        expect(node.classList.contains('is-conversation')).toBe(true);
        expect(node.style.position).toBe('relative');
        expect(node.style.transform).toBe('none');
        expect(node.style.width).toBe('100%');
        expect(document.querySelector('#chat-history > .empty-state')).toBeNull();
    });

    test('completion is terminal UI: the Pause/End bar is hidden rather than left under Story complete', () => {
        const node = hud();
        View.adoptHud(document);
        const bar = node.querySelector('.nexus-story-bar');

        expect(bar.hidden).toBe(false);
        node.querySelector('.nexus-story-card').textContent = 'Story complete · Fictional story inspired by this scene';
        expect(View.sync(node)).toBe(true);
        expect(node.classList.contains('is-complete')).toBe(true);
        expect(bar.hidden).toBe(true);
        expect(bar.getAttribute('aria-hidden')).toBe('true');
    });

    test('an ordinary narration keeps one compact playback bar inside Conversation', () => {
        const node = hud();
        View.adoptHud(document);
        node.querySelector('.nexus-story-card').textContent = 'Mira stopped at the edge and listened.';

        expect(View.sync(node)).toBe(false);
        expect(node.querySelector('.nexus-story-bar').hidden).toBe(false);
        expect(document.querySelectorAll(`#${View.ROW_ID} .nexus-story-bar`)).toHaveLength(1);
    });
});

describe('Scene Tale soundtrack presentation', () => {
    test('publishes background music inside the Scene Tale card instead of another conversation message', () => {
        const node = hud();
        View.adoptHud(document);

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
