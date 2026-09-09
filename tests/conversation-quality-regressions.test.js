/**
 * Regressions taken from real conversational transcripts.
 *
 * 1) `search about Ruslan Magana on internet` must not be echoed back as the answer.
 * 2) `give me asummary about him` must resolve to the held search session.
 * 3) `do you like this music` should not collapse into a generic capability disclaimer.
 */
const SearchQuality = require('../src/features/research/SearchQuality.js');
const Media = require('../src/features/together/CurrentMediaContext.js');

const PERSON_RESULTS = [
    {
        title: 'Ruslan Magana Vsevolodovna',
        snippet: 'Senior AI Engineer building agentic AI, machine learning systems, and cloud-native automation.',
        url: 'https://ruslanmv.com/',
    },
    {
        title: 'Ruslan Magana Vsevolodovna - GitHub',
        snippet: 'Senior AI Engineer & Cloud Architect focused on AI-augmented DevOps and Resiliency Engineering.',
        url: 'https://github.com/ruslanmv',
    },
];

afterEach(() => {
    delete window.callLLM;
    delete window.NEXUS_SEARCH_UX;
    Media.clear();
});

test('a search-command echo is rejected and retried as a grounded summary', async () => {
    const request = 'search about Ruslan Magana on internet';
    window.NEXUS_SEARCH_UX = { unusableSynthesis: () => false };
    window.callLLM = jest
        .fn()
        .mockResolvedValueOnce('search about Ruslan Magana on internet.')
        .mockResolvedValueOnce(
            'The search results describe Ruslan Magana as a senior AI engineer and cloud architect working on AI, machine learning, automation, and resilient cloud systems.'
        );

    const answer = await SearchQuality.synthesizeSearch(request, {
        query: 'about Ruslan Magana',
        kind: 'web',
        results: PERSON_RESULTS,
    });

    expect(window.callLLM).toHaveBeenCalledTimes(2);
    expect(SearchQuality.looksLikeEcho(window.callLLM.mock.results[0].value ? 'search about Ruslan Magana on internet.' : '', request)).toBe(true);
    expect(window.callLLM.mock.calls[1][0]).toMatch(/ACTIVE WEB SEARCH SESSION/);
    expect(window.callLLM.mock.calls[1][0]).toMatch(/do not infer education, credentials, employers or biography/i);
    expect(answer).toMatch(/senior AI engineer/i);
    expect(answer).not.toMatch(/^search about/i);
});

test('the real typo follow-up "give me asummary about him" is recognized as grounded search context', () => {
    const session = { query: 'about Ruslan Magana', results: PERSON_RESULTS };
    expect(SearchQuality.isGroundedSummaryFollowUp('give me asummary about him', session)).toBe(true);
    expect(SearchQuality.isGroundedSummaryFollowUp('give me a summary about him', session)).toBe(true);
});

test('search retry prompt forbids unsupported biography and credentials', () => {
    const prompt = SearchQuality.secondPassPrompt('search about Ruslan Magana on internet', {
        query: 'about Ruslan Magana',
        kind: 'web',
        results: PERSON_RESULTS,
    });
    expect(prompt).toMatch(/only facts explicitly present/i);
    expect(prompt).toMatch(/do not infer education, credentials, employers or biography/i);
});

test('current music context invites a companion opinion without pretending to hear it', () => {
    Media.set({
        id: 'LFASWuckB1c',
        provider: 'youtube',
        kind: 'music',
        title: 'Relaxing Music For Deep Sleep',
        creator: 'Inner Healing Sleep',
        description: 'Relaxing ambient music for sleep and anxiety relief.',
        url: 'https://www.youtube.com/watch?v=LFASWuckB1c',
    });

    const suffix = Media.systemPromptSuffix();
    expect(suffix).toMatch(/do you like this/i);
    expect(suffix).toMatch(/Do NOT lead with a generic capability disclaimer/i);
    expect(suffix).toMatch(/cannot directly hear or see the media itself/i);
    expect(suffix).toContain('Relaxing Music For Deep Sleep');
});
