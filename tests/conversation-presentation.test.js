/**
 * Presentation regressions from real chat transcripts.
 */

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="chat-history"></div>';
    localStorage.clear();
    delete window.NEXUS_CONVERSATION_PRESENTATION;
    delete window.NEXUS_SEARCH_PRESENTATION;
    delete window.NEXUS_SEARCH_UX;
    delete window.NEXUS_LOOKUP;
    delete window.NEXUS_MOTION;
});

test('legacy inline avatar tags render as emoji instead of raw control syntax', () => {
    const Presentation = require('../src/features/chat/ConversationPresentation.js');
    expect(Presentation.renderLegacyEmotes('Hello! [[wave:1]]')).toBe('Hello! 👋');
    expect(Presentation.renderLegacyEmotes('Nice to see you [[happy 0.7]]')).toBe('Nice to see you 😊');
    expect(Presentation.renderLegacyEmotes('Thinking [[thinking:0.6]]')).toBe('Thinking 🤔');
});

test('canonical emote control tags remain invisible if the behavior adapter is absent', () => {
    const Presentation = require('../src/features/chat/ConversationPresentation.js');
    expect(Presentation.renderLegacyEmotes('Hello [[emote:happy 0.8]]')).toBe('Hello');
});

test('partial legacy tags are hidden while streaming', () => {
    const Presentation = require('../src/features/chat/ConversationPresentation.js');
    expect(Presentation.renderLegacyEmotes('Hello [[wa', { streaming: true })).toBe('Hello');
});

test('lookup control plus retrieval placeholder is empty so SearchQuality retries synthesis', () => {
    window.NEXUS_LOOKUP = {
        extract(text) {
            return {
                clean: String(text).replace(/<lookup\b[^>]*>[\s\S]*?<\/lookup\s*>/gi, ' ').trim(),
                query: 'Ruslan Magana',
            };
        },
    };
    const Presentation = require('../src/features/chat/ConversationPresentation.js');
    const cleaned = Presentation.cleanSearchAnswer(
        '<lookup>Ruslan Magana</lookup> Let me check the latest information about Ruslan Magana for you.',
        (value) => value.trim()
    );
    expect(cleaned).toBe('');
});

test('stray svg accessibility or export text is not preserved in assistant prose', () => {
    const Presentation = require('../src/features/chat/ConversationPresentation.js');
    expect(Presentation.cleanSearchAnswer('Here is the grounded answer.\nsvg', (value) => value)).toBe(
        'Here is the grounded answer.'
    );
});

test('source panel is moved before the latest assistant answer and persistence anchor is repaired', () => {
    const chat = document.getElementById('chat-history');
    const user = document.createElement('div');
    user.className = 'chat-row';
    user.innerHTML = '<div class="chat-message user"><div class="message-text">search about Ruslan Magana</div></div>';
    const answer = document.createElement('div');
    answer.className = 'chat-row';
    answer.innerHTML = '<div class="chat-message avatar"><div class="message-text">Grounded answer</div></div>';
    chat.appendChild(user);
    chat.appendChild(answer);

    const key = 'nexus_search_source_panels_v1';
    window.NEXUS_SEARCH_PRESENTATION = {
        STORAGE_KEY: key,
        cleanAssistantAnswer: (value) => String(value || '').trim(),
        renderSourceCards() {
            const row = document.createElement('div');
            row.className = 'chat-row nexus-search-results-row';
            row.setAttribute('data-nexus-source-panel', 'panel-1');
            chat.appendChild(row);
            localStorage.setItem(
                key,
                JSON.stringify([{ id: 'panel-1', query: 'Ruslan Magana', results: [], afterDisplayIndex: 1 }])
            );
            return row;
        },
    };
    window.NEXUS_SEARCH_UX = {};

    const Presentation = require('../src/features/chat/ConversationPresentation.js');
    Presentation.patchSearchPresentation();
    const row = window.NEXUS_SEARCH_PRESENTATION.renderSourceCards([], 'Ruslan Magana');

    expect(chat.children[0]).toBe(user);
    expect(chat.children[1]).toBe(row);
    expect(chat.children[2]).toBe(answer);
    const stored = JSON.parse(localStorage.getItem(key));
    expect(stored[0].afterDisplayIndex).toBe(0);
});
