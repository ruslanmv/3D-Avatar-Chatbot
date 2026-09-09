/**
 * Search rendering should behave like a modern assistant UI: clean answer prose, structured
 * citations, and no raw URLs leaking into copied/persisted chat text.
 */
const Presentation = require('../src/features/research/SearchPresentation.js');

const RESULTS = [
    {
        title: 'Ruslan Magana Vsevolodovna',
        snippet: 'Senior AI Engineer building agentic AI and cloud-native automation.',
        url: 'https://ruslanmv.com/?srsltid=tracking123&utm_source=test',
        siteName: 'ruslanmv.com',
    },
    {
        title: 'Ruslan Magana Vsevolodovna - GitHub',
        snippet: 'Senior AI Engineer & Cloud Architect focused on distributed AI systems.',
        url: 'https://github.com/ruslanmv',
        siteName: 'GitHub',
    },
];

beforeEach(() => {
    document.body.innerHTML =
        '<div id="chat-history">' +
        '  <div class="chat-row"><div class="chat-message avatar"><div class="message-text">A clean summary.</div></div></div>' +
        '</div>';
    localStorage.clear();
    window.NEXUS_SEARCH_UX = {};
    window.open = jest.fn(() => null);
    Presentation.install();
});

afterEach(() => {
    delete window.NEXUS_SEARCH_UX;
    delete window.open;
});

test('removes Markdown links, escaped nested links and raw URLs from assistant prose', () => {
    const bad =
        'Sure, see [ruslanmv.com]([https://ruslanmv.com/x](https://ruslanmv.com/x)) and ' +
        '[GitHub](https://github.com/ruslanmv). More: https://example.com/raw';
    const clean = Presentation.cleanAssistantAnswer(bad);
    expect(clean).toContain('ruslanmv.com');
    expect(clean).toContain('GitHub');
    expect(clean).not.toMatch(/https?:\/\//);
    expect(clean).not.toMatch(/\]\(/);
});

test('recognizes a link-heavy numbered result dump as presentation, not synthesis', () => {
    const answer =
        'Sure, here are the top results: 1. **One** [site](https://one.test) 2. **Two** [site](https://two.test) 3. Three';
    expect(Presentation.looksLikeResultDump(answer)).toBe(true);
});

test('renders source cards without anchors or visible URLs', () => {
    const row = Presentation.renderSourceCards(RESULTS, 'Ruslan Magana');
    expect(row).not.toBeNull();
    expect(row.querySelector('.chat-message')).toBeNull();
    expect(row.querySelectorAll('a[href]')).toHaveLength(0);
    expect(row.querySelectorAll('button.nexus-search-result-card')).toHaveLength(2);
    expect(row.textContent).toContain('Ruslan Magana Vsevolodovna');
    expect(row.textContent).toContain('ruslanmv.com');
    expect(row.textContent).not.toMatch(/https?:\/\//);
});

test('source buttons open a canonical URL without search tracking parameters', () => {
    Presentation.renderSourceCards(RESULTS, 'Ruslan Magana');
    document.querySelector('button.nexus-search-result-card').click();
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(window.open.mock.calls[0][0]).toBe('https://ruslanmv.com/');
});

test('main chat persistence ignores structured source rows', () => {
    Presentation.renderSourceCards(RESULTS, 'Ruslan Magana');
    const display = [];
    document.querySelectorAll('#chat-history .chat-row').forEach((row) => {
        const msg = row.querySelector('.chat-message');
        if (!msg) return;
        const text = msg.querySelector('.message-text')?.textContent || '';
        if (text) display.push(text);
    });
    expect(display).toEqual(['A clean summary.']);
    expect(JSON.stringify(display)).not.toMatch(/ruslanmv\.com|github\.com/);
});

test('structured sources restore after reload without becoming raw chat links', () => {
    localStorage.setItem(
        Presentation.CHAT_DISPLAY_KEY,
        JSON.stringify([{ sender: 'avatar', text: 'A clean summary.' }])
    );
    Presentation.renderSourceCards(RESULTS, 'Ruslan Magana');
    document.querySelector('.nexus-search-results-row').remove();

    expect(Presentation.restoreSourcePanels()).toBe(1);
    const restored = document.querySelector('.nexus-search-results-row');
    expect(restored).not.toBeNull();
    expect(restored.querySelector('.chat-message')).toBeNull();
    expect(restored.querySelectorAll('a[href]')).toHaveLength(0);
    expect(restored.textContent).not.toMatch(/https?:\/\//);
});

test('migrates legacy flattened source rows out of ordinary chat history', () => {
    localStorage.setItem(
        Presentation.CHAT_DISPLAY_KEY,
        JSON.stringify([
            { sender: 'avatar', text: 'A clean summary.' },
            { sender: 'avatar', text: '4 sources · Ruslan Magana1. Ruslan Magana Vsevolodovna ruslanmv.com' },
        ])
    );
    const chat = document.getElementById('chat-history');
    const legacy = document.createElement('div');
    legacy.className = 'chat-row';
    legacy.innerHTML = '<div class="chat-message avatar"><div class="message-text">4 sources · Ruslan Magana1. Old source</div></div>';
    chat.appendChild(legacy);

    expect(Presentation.migrateLegacyFlattenedSources()).toBe(1);
    const display = JSON.parse(localStorage.getItem(Presentation.CHAT_DISPLAY_KEY));
    expect(display).toEqual([{ sender: 'avatar', text: 'A clean summary.' }]);
    expect(chat.textContent).not.toContain('Old source');
});
