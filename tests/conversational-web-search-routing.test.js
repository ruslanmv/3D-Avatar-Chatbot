/**
 * First-turn conversational search routing regressions.
 *
 * The important contract here is that an explicit/current-information request reaches the
 * web provider BEFORE the LLM gets a chance to say it cannot browse.
 */

describe('conversational web-search first-turn routing', () => {
    let LookUp;
    let SearchSession;
    let provider;
    let original;
    let order;
    let bubbles;

    const RESULTS = [
        {
            title: 'Genova news one',
            snippet: 'News today in Genova: first local update.',
            url: 'https://ansa.example/genova/1',
        },
        {
            title: 'Genova news two',
            snippet: 'News today in Genova: second local update.',
            url: 'https://secolo.example/genova/2',
        },
        {
            title: 'Genova news three',
            snippet: 'News today in Genova: third local update.',
            url: 'https://rai.example/genova/3',
        },
    ];

    beforeEach(() => {
        jest.resetModules();
        order = [];
        bubbles = [];
        original = jest.fn(async () => {
            order.push('original-llm-path');
            return 'ORIGINAL';
        });
        provider = {
            calls: [],
            ready: jest.fn(async () => ({ available: true })),
            status: jest.fn(() => ({ available: true })),
            research: jest.fn(async (query) => {
                order.push(`search:${query}`);
                provider.calls.push(query);
                return RESULTS;
            }),
        };

        window.handleUserMessage = original;
        window.NEXUS_RESEARCH_WEB = provider;
        window.callLLM = jest.fn(async () => {
            order.push('grounded-llm');
            return "I cannot perform real-time internet searches myself because my knowledge cutoff means I don't have access to today's news.";
        });
        window.addMessageToHistory = jest.fn((sender, text) => bubbles.push({ sender, text }));
        window.chatHistory = { addMessage: jest.fn() };
        window._persistChat = jest.fn();
        window.setStatus = jest.fn();
        window.speakText = jest.fn();

        SearchSession = require('../src/features/research/SearchSession.js');
        SearchSession.clear();
        window.NEXUS_SEARCH_SESSION = SearchSession;
        LookUp = require('../src/features/research/LookUp.js');
        window.NEXUS_LOOKUP = LookUp;
        LookUp.reset();
        LookUp.installFollowUpHook();
    });

    afterEach(() => {
        for (const key of [
            'NEXUS_RESEARCH_WEB',
            'NEXUS_SEARCH_SESSION',
            'NEXUS_LOOKUP',
            'callLLM',
            'addMessageToHistory',
            'chatHistory',
            '_persistChat',
            'setStatus',
            'speakText',
        ])
            delete window[key];
        delete window.handleUserMessage;
    });

    test('the exact Genova request searches before the LLM and suppresses a browsing refusal', async () => {
        const answer = await window.handleUserMessage('can you search on internet the news of today in Genova');

        expect(provider.calls[0]).toBe('news of today in Genova');
        expect(order[0]).toBe('search:news of today in Genova');
        expect(order).toContain('grounded-llm');
        expect(original).not.toHaveBeenCalled();
        expect(answer).toMatch(/Genova news one/);
        expect(answer).not.toMatch(/cannot perform real-time internet searches/i);
        expect(bubbles[0]).toEqual({ sender: 'user', text: 'can you search on internet the news of today in Genova' });
        expect(bubbles[bubbles.length - 1].text).toMatch(/Genova news one/);
    });

    test('print results reuses the cached search without another provider or LLM call', async () => {
        await window.handleUserMessage('search on internet news today in Genova');
        const searches = provider.research.mock.calls.length;
        const llmCalls = window.callLLM.mock.calls.length;

        const rendered = await window.handleUserMessage('print the results');

        expect(provider.research).toHaveBeenCalledTimes(searches);
        expect(window.callLLM).toHaveBeenCalledTimes(llmCalls);
        expect(rendered).toMatch(/Results for/);
        expect(rendered).toMatch(/Genova news two/);
    });

    test('weather follow-up preserves location and performs a fresh tomorrow search', async () => {
        await window.handleUserMessage("what's the weather in Rome today?");
        const before = provider.calls.length;

        await window.handleUserMessage('what about tomorrow?');

        const freshCalls = provider.calls.slice(before);
        expect(freshCalls.length).toBeGreaterThan(0);
        expect(freshCalls[0]).toMatch(/Rome/i);
        expect(freshCalls[0]).toMatch(/tomorrow/i);
        expect(original).not.toHaveBeenCalled();
    });

    test('local recommendation requests use search directly', async () => {
        await window.handleUserMessage('recommend the best cafes in Genova');
        expect(provider.calls[0]).toBe('recommend the best cafes in Genova');
        expect(original).not.toHaveBeenCalled();
    });

    test('speech-recognition command typos are corrected without changing the query name', () => {
        expect(LookUp.explicitSearchIntent('Seaech on interne ruslan magana')).toMatchObject({
            action: 'search',
            query: 'ruslan magana',
        });
    });
});
