/** Synthesis and presentation are separate responsibilities. */
const Presentation = require('../src/features/research/SearchPresentation.js');

beforeEach(() => {
    window.NEXUS_SEARCH_PRESENTATION = Presentation;
    window.NEXUS_SEARCH_UX = {
        unusableSynthesis: () => false,
        cleanSearchQuery: (q) => String(q || '').trim(),
    };
});

afterEach(() => {
    delete window.NEXUS_SEARCH_PRESENTATION;
    delete window.NEXUS_SEARCH_UX;
    delete window.callLLM;
    jest.resetModules();
});

test('link-heavy search result prose is retried and final chat text contains no URLs', async () => {
    const Quality = require('../src/features/research/SearchQuality.js');
    window.callLLM = jest
        .fn()
        .mockResolvedValueOnce(
            'Sure, here are the top results: 1. **Ruslan** [Website](https://ruslanmv.com) 2. **GitHub** [Profile](https://github.com/ruslanmv)'
        )
        .mockResolvedValueOnce(
            'The available sources describe Ruslan Magana as a senior AI engineer working across AI, machine learning, cloud systems, and automation.'
        );

    const answer = await Quality.synthesizeSearch('search about Ruslan Magana on internet', {
        query: 'Ruslan Magana',
        kind: 'web',
        results: [
            {
                title: 'Ruslan',
                snippet: 'Senior AI Engineer working on AI and cloud systems.',
                url: 'https://ruslanmv.com',
            },
            { title: 'GitHub', snippet: 'Cloud architect focused on automation.', url: 'https://github.com/ruslanmv' },
        ],
    });

    expect(window.callLLM).toHaveBeenCalledTimes(2);
    expect(window.callLLM.mock.calls[1][0]).toMatch(/Do NOT output URLs, Markdown links/i);
    expect(answer).toMatch(/senior AI engineer/i);
    expect(answer).not.toMatch(/https?:\/\/|\]\(/);
});

test('search grammar is removed from the stored subject', () => {
    const Quality = require('../src/features/research/SearchQuality.js');
    expect(Quality.cleanSearchSubject('about Ruslan Magana')).toBe('Ruslan Magana');
    expect(Quality.cleanSearchSubject('for restaurants in Genova')).toBe('restaurants in Genova');
});

test('second-pass prompt reserves source rendering for the UI', () => {
    const Quality = require('../src/features/research/SearchQuality.js');
    const prompt = Quality.secondPassPrompt('search about Ruslan Magana', { kind: 'web' });
    expect(prompt).toMatch(/interface renders sources separately/i);
    expect(prompt).toMatch(/Do NOT output URLs, Markdown links/i);
    expect(prompt).toMatch(/numbered list of source\/result titles/i);
});
