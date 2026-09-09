/**
 * Search conversation UX regressions.
 */
const Source = require('../src/features/research/ResearchSource.js');
const SearchSession = require('../src/features/research/SearchSession.js');
const LookUp = require('../src/features/research/LookUp.js');
const SearchUX = require('../src/features/research/SearchUX.js');

const RESULTS = [
    {
        title: 'GenovaToday - cronaca e notizie da Genova',
        snippet: 'Latest local reporting and updates from Genova.',
        url: 'https://www.genovatoday.it/',
        siteName: 'GenovaToday',
        published: '2 hours ago',
    },
    {
        title: 'Genova - Euronews.com',
        snippet: 'News and updates related to Genova.',
        url: 'https://www.euronews.com/tag/genova',
        siteName: 'Euronews',
        published: 'Today',
    },
    {
        title: 'Genoa - latest news',
        snippet: 'Recent news and reporting about Genoa.',
        url: 'https://www.the-independent.com/topic/genoa',
        siteName: 'The Independent',
        published: 'Today',
    },
];

function appendMessage(sender, text) {
    const chat = document.getElementById('chat-history');
    const row = document.createElement('div');
    row.className = 'chat-row';
    const msg = document.createElement('div');
    msg.className = `chat-message ${sender}`;
    const body = document.createElement('div');
    body.className = 'message-text';
    body.textContent = text;
    msg.appendChild(body);
    row.appendChild(msg);
    chat.appendChild(row);
}

beforeEach(() => {
    document.body.innerHTML = '<div id="chat-history"><div class="empty-state"></div></div>';
    SearchSession.clear();
    LookUp.reset();
    window.NEXUS_SEARCH_SESSION = SearchSession;
    window.NEXUS_RESEARCH_SOURCE = Source;
    window.NEXUS_RESEARCH_WEB = {
        ready: async () => ({ available: true }),
        status: () => ({ available: true }),
        research: async () => RESULTS,
    };
    window.addMessageToHistory = appendMessage;
    window.chatHistory = { addMessage: jest.fn() };
    window._persistChat = jest.fn();
    window.setStatus = jest.fn();
    window.speakText = jest.fn();
    window.callLLM = jest.fn(async () => 'I found several current Genova sources. GenovaToday and Euronews both have active coverage.');
});

afterEach(() => {
    delete window.NEXUS_RESEARCH_WEB;
    delete window.callLLM;
    delete window.addMessageToHistory;
    delete window.chatHistory;
    delete window._persistChat;
    delete window.setStatus;
    delete window.speakText;
});

test('search query keeps the subject and removes UI instructions', () => {
    expect(SearchUX.cleanSearchQuery('Ruslan Magana and summarize')).toBe('Ruslan Magana');
    expect(SearchUX.cleanSearchQuery('news today in Genova on internet')).toBe('news today in Genova');
});

test('a search acknowledgement appears before retrieval finishes', async () => {
    let releaseSearch;
    window.NEXUS_RESEARCH_WEB.research = jest.fn(() => new Promise((resolve) => { releaseSearch = resolve; }));

    const pending = SearchUX.executeSearchTurn(
        'can you search the news today in Genova on internet',
        'news today in Genova on internet'
    );

    // The user gets feedback immediately, before the provider promise is released.
    expect(document.querySelector('[data-nexus-search-status="searching"]')).not.toBeNull();
    expect(document.querySelector('[data-nexus-search-status] .message-text').textContent).toMatch(/Searching current web sources/i);

    await Promise.resolve();
    releaseSearch(RESULTS);
    await pending;
});

test('synthesis uses the original user request and renders real clickable source cards', async () => {
    const original = 'search on internet Ruslan Magana and summarize';
    const results = RESULTS.map((r, index) => ({ ...r, title: `Ruslan source ${index + 1}` }));
    window.NEXUS_RESEARCH_WEB.research = jest.fn(async () => results);

    await SearchUX.executeSearchTurn(original, 'Ruslan Magana and summarize');

    expect(window.callLLM).toHaveBeenCalledWith(original);
    expect(window.callLLM.mock.calls[0][0]).not.toMatch(/application has already completed/i);
    expect(document.querySelector('[data-nexus-search-status]')).toBeNull();

    const cards = [...document.querySelectorAll('.nexus-search-result-card')];
    expect(cards).toHaveLength(3);
    expect(cards[0].tagName).toBe('A');
    expect(cards[0].getAttribute('href')).toBe('https://www.genovatoday.it/');
    expect(cards[0].textContent).toMatch(/GenovaToday/);
    expect(cards[0].textContent).toMatch(/2 hours ago/);
    expect(cards[0].textContent).toMatch(/Open source/);
});

test('bad internal/refusal replies are rejected instead of shown to the user', () => {
    expect(SearchUX.unusableSynthesis('The application has already completed a live web search. The user asked: "x"')).toBe(true);
    expect(SearchUX.unusableSynthesis("I'm sorry, but I can't assist with that request.")).toBe(true);
    expect(SearchUX.unusableSynthesis('Here are the main Genova stories reported by the sources.')).toBe(false);
});

test('source normalization preserves readable publisher/date metadata', () => {
    const one = Source.one({
        title: 'A result',
        snippet: 'A snippet',
        url: 'https://example.com/a',
        siteName: 'Example News',
        published: '3 hours ago',
        rank: 2,
    });
    expect(one).toMatchObject({ siteName: 'Example News', published: '3 hours ago', rank: 2 });
});
