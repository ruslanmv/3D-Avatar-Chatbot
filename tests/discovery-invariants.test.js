/**
 * The invariants D3–D6 have to keep (batch D8).
 *
 * Every test in the other discovery suites checks that a thing works. These check that the
 * things which must *not* happen still do not — the class of failure nobody writes a test for
 * until it has shipped once:
 *
 *   * an eager iframe per result, which would make a search cost a player;
 *   * a media card that reserves no space, so a late thumbnail yanks the conversation under
 *     somebody's finger;
 *   * a second `getDisplayMedia` outside the consent machine;
 *   * a provider throwing and taking the chat with it;
 *   * the local paths — video file, audio file, share a tab — quietly disappearing because a
 *     search box was added above them.
 *
 * Read from source where the claim is about code, and from the DOM where it is about what a
 * user sees. Neither alone is enough: source cannot prove a thumbnail reserves its box, and a
 * DOM test cannot prove that no other file calls the capture API.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Source with comments stripped — a file that *explains* a rule must not fail it. */
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const read = (rel) => codeOf(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const DISCOVERY_FILES = [
    'src/features/discovery/MediaResult.js',
    'src/features/discovery/ProviderRegistry.js',
    'src/features/discovery/DiscoverySettings.js',
    'src/features/discovery/providers/youtube.js',
    'src/features/together/ui/MediaSearchPicker.js',
    'src/features/together/ui/ConversationPublisher.js',
];

const MediaResult = require('../src/features/discovery/MediaResult.js');
const Registry = require('../src/features/discovery/ProviderRegistry.js');
const Picker = require('../src/features/together/ui/MediaSearchPicker.js');
const Publisher = require('../src/features/together/ui/ConversationPublisher.js');
const Contract = require('../src/features/together/activities/contract.js');

beforeEach(() => {
    document.body.innerHTML = '<div id="chat-history"></div>';
    localStorage.clear();
    Registry.reset();
    window.NEXUS_MEDIA_RESULT = MediaResult;
    window.NEXUS_DISCOVERY = Registry;
    window.__NEXUS_YT_ASK_NOAUTO__ = true;
    window.NEXUS_YT_ASK = require('../src/features/youtube/YouTubeAsk.js');
});

function provider(results) {
    return {
        ID: 'fake',
        status: () => ({ id: 'fake', configured: true, available: true, capabilities: ['video.search'], reason: 'ok' }),
        search: async () => MediaResult.many(results),
    };
}

const ROWS = [
    { id: 'a', provider: 'fake', url: 'https://www.youtube.com/watch?v=a', title: 'One', creator: 'Someone' },
    { id: 'b', provider: 'fake', url: 'https://www.youtube.com/watch?v=b', title: 'Two', creator: 'Someone' },
];

// ── nothing plays until somebody presses play ───────────────────────────────

describe('no player where a picker belongs', () => {
    test('no discovery file creates an iframe', () => {
        // The facade pattern is the whole performance story: a search costs a thumbnail, not
        // a player. `YouTubeEmbed2D` is the one file allowed to make an iframe, on a click.
        for (const file of DISCOVERY_FILES) {
            expect(`${file} :: ${/iframe/i.test(read(file))}`).toBe(`${file} :: false`);
        }
    });

    test('searching leaves the document without one', async () => {
        Registry.register(provider(ROWS));
        const node = Picker.build({ doc: document, onChoose: () => {} });
        document.body.appendChild(node);
        await node.search('x');
        expect(document.querySelector('iframe')).toBeNull();
    });

    test('publishing leaves the document without one', () => {
        Publisher.publish(MediaResult.make(ROWS[0]), { doc: document, win: window });
        expect(document.querySelector('iframe')).toBeNull();
    });
});

// ── the layout does not move under the reader ───────────────────────────────

describe('thumbnails cannot yank the page', () => {
    const launcherCss = require('../src/features/together/ui/TogetherLauncher.js').CSS;

    test('the result thumbnail reserves its box before the image arrives', () => {
        const block = /\.nexus-bd-together-resultthumb\s*\{([^}]*)\}/.exec(launcherCss);
        expect(block).not.toBeNull();
        // Width and an aspect ratio: the box exists whether or not the picture does.
        expect(block[1]).toMatch(/width:/);
        expect(block[1]).toMatch(/aspect-ratio:/);
    });

    test('images are lazy, so four rows are not four requests up front', async () => {
        Registry.register(provider(ROWS));
        const node = Picker.build({ doc: document, onChoose: () => {} });
        await node.search('x');
        for (const img of node.querySelectorAll('img')) {
            expect(img.getAttribute('loading')).toBe('lazy');
        }
    });
});

// ── one door for capture ────────────────────────────────────────────────────

describe('nothing here can open a camera or a screen', () => {
    test('no discovery file names the capture APIs', () => {
        for (const file of DISCOVERY_FILES) {
            const text = read(file);
            expect(`${file} :: ${/getDisplayMedia|getUserMedia/.test(text)}`).toBe(`${file} :: false`);
        }
    });

    test('nor does any of them reach the consent machine directly', () => {
        // The panel owns that conversation. A picker asking for a grant would be a second
        // owner, which is the thing `ConsentMachine` exists to prevent.
        for (const file of DISCOVERY_FILES) {
            expect(`${file} :: ${/consent/i.test(read(file))}`).toBe(`${file} :: false`);
        }
    });
});

// ── failure is contained ────────────────────────────────────────────────────

describe('a broken provider breaks nothing else', () => {
    test('a provider that throws leaves a sentence, not an exception', async () => {
        Registry.register({
            ID: 'fake',
            status: () => ({
                id: 'fake',
                configured: true,
                available: true,
                capabilities: ['video.search'],
                reason: 'ok',
            }),
            search: async () => {
                throw new Error('quota');
            },
        });
        const node = Picker.build({ doc: document, onChoose: () => {} });
        document.body.appendChild(node);
        await expect(node.search('x')).resolves.toMatchObject({ ok: false });
        expect(node.textContent).not.toMatch(/quota|Error/);
    });

    test('a provider whose status throws does not take the registry down', () => {
        // Written first as `.toThrow()`, which passed — and named a property the code did not
        // have. `all()` and `forCapability` walk every provider, so one that cannot say how it
        // is was breaking search for the two that could. It is reported as unavailable now.
        Registry.register({
            ID: 'broken',
            status: () => {
                throw new Error('boom');
            },
        });
        Registry.register(provider(ROWS));

        expect(Registry.forCapability('video.search').ID).toBe('fake');
        const listed = Registry.all().find((p) => p.id === 'broken');
        expect(listed).toMatchObject({ available: false, reason: 'broken' });
        expect(() => Registry.why('video.search')).not.toThrow();
    });

    test('a provider that answers nonsense is not available either', () => {
        Registry.register({ ID: 'weird', status: () => null });
        Registry.register(provider(ROWS));
        expect(Registry.forCapability('video.search').ID).toBe('fake');
        expect(Registry.all().find((p) => p.id === 'weird').capabilities).toEqual([]);
    });

    test('publishing with no chat host returns null rather than throwing', () => {
        document.body.innerHTML = '';
        expect(Publisher.publish(MediaResult.make(ROWS[0]), { doc: document, win: window })).toBeNull();
    });
});

// ── what a search must never take away ──────────────────────────────────────

describe('the paths that need nothing are still there', () => {
    const inputs = (id) => Contract.ADAPTERS[id].inputs();

    test('Watch keeps sharing a tab and opening a file', () => {
        const ids = inputs('watch').map((i) => i.id);
        expect(ids).toContain('tab');
        expect(ids).toContain('file');
    });

    test('Music keeps opening an audio file', () => {
        expect(inputs('music').map((i) => i.id)).toContain('file');
    });

    test('every local path still asks for no permission and picks a real file', () => {
        for (const id of ['watch', 'music']) {
            const file = inputs(id).find((i) => i.id === 'file');
            expect(file.permission).toBeNull();
            expect(typeof file.pick).toBe('function');
        }
    });

    test("sharing a tab is still the activity's own grant, not the panel's", () => {
        // `'self'` is what stops the panel asking first and having the grant revoked under it.
        expect(inputs('watch').find((i) => i.id === 'tab').permission).toBe('self');
    });
});
