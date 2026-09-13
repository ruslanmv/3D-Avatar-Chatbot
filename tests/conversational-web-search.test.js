/**
 * Conversational web-search regressions.
 *
 * Covers durable results, multi-round refinement, weather follow-ups, suggestions,
 * ordinal references, and release of a queued next turn.
 */
const Source = require('../src/features/research/ResearchSource.js');
const SearchSession = require('../src/features/research/SearchSession.js');
const LookUp = require('../src/features/research/LookUp.js');

const RESULTS = [
    {
        title: 'Ruslan Magana — Profile',
        snippet: 'Ruslan Magana works on AI systems.',
        url: 'https://example.com/ruslan',
    },
    {
        title: 'Ruslan Magana — GitHub',
        snippet: 'Projects and repositories by Ruslan Magana.',
        url: 'https://github.com/ruslanmv',
    },
    {
        title: 'Ruslan Magana — Publications',
        snippet: 'Selected publications and technical work.',
        url: 'https://example.org/publications',
    },
];

beforeEach(() => {
    SearchSession.clear();
    LookUp.reset();
    window.NEXUS_SEARCH_SESSION = SearchSession;
    window.NEXUS_RESEARCH_SOURCE = Source;
});

afterEach(() => {
    delete window.NEXUS_RESEARCH_WEB;
});

function web(resultsForQuery) {
    const calls = [];
    return {
        calls,
        ready: async () => ({ available: true }),
        status: () => ({ available: true }),
        research: async (q) => {
            calls.push(q);
            return typeof resultsForQuery === 'function' ? resultsForQuery(q, calls.length) : resultsForQuery;
        },
    };
}

test('a weak first round is refined and deduplicated', async () => {
    const provider = web((_q, round) => (round === 1 ? RESULTS.slice(0, 2) : [RESULTS[0], RESULTS[2]]));
    window.NEXUS_RESEARCH_WEB = provider;

    const out = await LookUp.run('ruslan magana');
    expect(out.ok).toBe(true);
    expect(out.rounds).toBe(2);
    expect(provider.calls).toEqual(['ruslan magana', '"ruslan magana"']);
    expect(out.results).toHaveLength(3);
});

test('clear releases grounding but keeps results for follow-ups', async () => {
    window.NEXUS_RESEARCH_WEB = web(RESULTS);
    await LookUp.run('ruslan magana');

    expect(LookUp.systemPromptSuffix()).toMatch(/YOU JUST SEARCHED THE WEB/);
    LookUp.clear();

    const suffix = LookUp.systemPromptSuffix();
    expect(suffix).toMatch(/ACTIVE WEB SEARCH SESSION/);
    expect(suffix).toMatch(/show\/print\/list results/i);
    expect(suffix).toMatch(/Ruslan Magana — GitHub/);
});

test('print results is a deterministic cached follow-up', async () => {
    const provider = web(RESULTS);
    window.NEXUS_RESEARCH_WEB = provider;
    await LookUp.run('ruslan magana');
    LookUp.clear();

    expect(LookUp.followUpIntent('Print the results')).toMatchObject({ action: 'show' });
    const rendered = LookUp.formatResults();
    expect(rendered).toMatch(/1\. Ruslan Magana — Profile/);
    expect(rendered).toMatch(/2\. Ruslan Magana — GitHub/);
    expect(rendered).toMatch(/https:\/\/github\.com\/ruslanmv/);
    expect(provider.calls).toHaveLength(1);
});

test('ordinal references point at the held list', async () => {
    window.NEXUS_RESEARCH_WEB = web(RESULTS);
    await LookUp.run('ruslan magana');
    LookUp.clear();

    const follow = LookUp.followUpIntent('Tell me more about the second result');
    expect(follow.action).toBe('select');
    expect(follow.index).toBe(1);
    expect(follow.result.title).toMatch(/GitHub/);
    expect(SearchSession.get().selectedIndex).toBe(1);
});

test('weather stays fresh for tomorrow follow-ups', async () => {
    const weatherResults = [
        {
            title: 'Rome weather',
            snippet: 'Current weather and forecast for Rome.',
            url: 'https://weather.example/rome',
        },
        { title: 'Rome forecast', snippet: 'Weather forecast, rain and wind.', url: 'https://forecast.example/rome' },
        {
            title: 'Rome conditions',
            snippet: 'Temperature and weather conditions.',
            url: 'https://conditions.example/rome',
        },
    ];
    window.NEXUS_RESEARCH_WEB = web(weatherResults);
    await LookUp.run('weather in Rome today');
    LookUp.clear();

    expect(SearchSession.get().kind).toBe('weather');
    expect(LookUp.followUpIntent('What about tomorrow?')).toMatchObject({ action: 'refine', kind: 'weather' });
    expect(LookUp.systemPromptSuffix()).toMatch(/weather is time-sensitive/i);
    expect(LookUp.systemPromptSuffix()).toMatch(/fresh <lookup>/i);
});

test('suggestion searches keep a conversational refinement path', async () => {
    const suggestions = [
        { title: 'Option A', snippet: 'A recommended quiet cafe.', url: 'https://example.com/a' },
        { title: 'Option B', snippet: 'Another recommended quiet cafe.', url: 'https://example.com/b' },
        { title: 'Option C', snippet: 'A third recommended quiet cafe.', url: 'https://example.com/c' },
    ];
    window.NEXUS_RESEARCH_WEB = web(suggestions);
    await LookUp.run('best quiet cafe suggestions near the station');
    LookUp.clear();

    expect(SearchSession.get().kind).toBe('suggestion');
    expect(LookUp.followUpIntent('give me another option')).toMatchObject({ action: 'refine', kind: 'suggestion' });
    expect(LookUp.systemPromptSuffix()).toMatch(/another cached option/i);
    expect(LookUp.systemPromptSuffix()).toMatch(/preserving the user constraints/i);
});

test('a next turn waits for grounding to release', async () => {
    window.NEXUS_RESEARCH_WEB = web(RESULTS);
    await LookUp.run('ruslan magana');
    let released = false;
    const waiting = LookUp.waitUntilReleased().then(() => {
        released = true;
    });

    await Promise.resolve();
    expect(released).toBe(false);
    LookUp.clear();
    await waiting;
    expect(released).toBe(true);
});

test('stale result writes cannot overwrite a newer search', () => {
    const first = SearchSession.begin('first query');
    const second = SearchSession.begin('second query');
    const stale = SearchSession.setResults(first.requestId, RESULTS);
    expect(stale.stale).toBe(true);
    expect(SearchSession.get().query).toBe('second query');
    SearchSession.setResults(second.requestId, RESULTS);
    expect(SearchSession.get().results).toHaveLength(3);
});
