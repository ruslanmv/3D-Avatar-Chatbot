/**
 * The feature works before it is configured.
 *
 * Search needs a YouTube Data API key. Without one, Watch and Music could offer nothing but a
 * link to Settings and an invitation to go and get a key from Google Cloud — reasonable to ask
 * of an operator, absurd to ask of somebody deciding whether the feature is any good. A product
 * that cannot be tried until it is configured mostly does not get tried.
 *
 * Playback needs no key; only *search* does. So a small fixed set plays through exactly the code
 * path a real result takes, and one tap on a fresh deployment shows what the feature does.
 *
 * The rule these tests exist to hold: **a sample is never a search result.** Handing somebody a
 * fixed video labelled as a match for what they typed is a lie they cannot detect, and worse
 * than an empty state.
 */

const fs = require('fs');
const path = require('path');

const samples = require('../src/features/discovery/samples.js');
const Picker = require('../src/features/together/ui/MediaSearchPicker.js');

describe('the sample set itself', () => {
    test('one video and three songs — enough to show, few enough to keep true', () => {
        // One video, because it is this project's own and one demonstration does not need
        // three things kept alive to make its point.
        expect(samples.videos()).toHaveLength(1);
        expect(samples.music()).toHaveLength(3);
    });

    test('the video is the project own, which is why it can be the only one', () => {
        // Embedding, availability and takedown risk sit in the same hands as the app. That is a
        // stronger guarantee than any third-party pick, and it is the whole reason one suffices.
        const [only] = samples.VIDEOS;
        expect(only.id).toBe('XarKqjNoE7A');
        expect(only.creator).toContain('ruslanmv');
    });

    test('every id is a real YouTube id, because a typo is a 404', () => {
        for (const item of [...samples.VIDEOS, ...samples.MUSIC]) {
            expect(item.id).toMatch(samples.ID);
        }
    });

    test('no id appears twice, in either list or across them', () => {
        const ids = [...samples.VIDEOS, ...samples.MUSIC].map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('each one records why it is here, for whoever changes the list next', () => {
        // The quality being selected for is durability, not taste. Without the reason written
        // down, the next person swaps in whatever they happen to like and the list rots.
        for (const item of [...samples.VIDEOS, ...samples.MUSIC]) {
            expect(item.why.length).toBeGreaterThan(20);
            expect(item.title).toBeTruthy();
            expect(item.creator).toBeTruthy();
        }
    });

    test('a sample carries the flag that makes it un-mistakable for a result', () => {
        for (const result of [...samples.videos(), ...samples.music()]) {
            expect(result.sample).toBe(true);
            expect(result.provider).toBe('sample');
        }
    });

    test('it renders and plays like any other result', () => {
        // Same shape as `MediaResult`, so nothing downstream needs a special case — a sample
        // that needed one would be a second code path to keep working.
        const [first] = samples.videos();
        expect(first.url).toBe(`https://www.youtube.com/watch?v=${first.id}`);
        expect(first.thumbnail).toContain(first.id);
        expect(first.kind).toBe('video');
        expect(samples.music()[0].kind).toBe('music');
    });

    test('a capability nobody wrote samples for gets none, not borrowed ones', () => {
        // Three videos borrowed from a different feature is worse than the ordinary empty state.
        expect(samples.forCapability('screen.share')).toEqual([]);
        expect(samples.forCapability('')).toEqual([]);
        expect(samples.forCapability('video.search')).toHaveLength(1);
        expect(samples.forCapability('music.search')).toHaveLength(3);
    });
});

describe('where they are offered', () => {
    function harness({ why = 'no-key', provider = null } = {}) {
        document.body.innerHTML = '<div id="host"></div>';
        window.NEXUS_DISCOVERY = {
            warm: async () => [],
            forCapability: () => provider,
            why: () => why,
        };
        window.NEXUS_DISCOVERY_SAMPLES = samples;
        const root = Picker.build({ doc: document, mediaKind: 'video' });
        document.getElementById('host').appendChild(root);
        return { root, run: root.search };
    }

    afterEach(() => {
        delete window.NEXUS_DISCOVERY;
        delete window.NEXUS_DISCOVERY_SAMPLES;
    });

    test('with no key, the examples are there to try', async () => {
        const picker = harness();
        await picker.run('anything');
        const rows = [...document.querySelectorAll('.nexus-bd-together-result')];
        expect(rows).toHaveLength(samples.VIDEOS.length);
        expect(rows.every((r) => r.dataset.sample === 'true')).toBe(true);
        expect(rows[0].dataset.mediaId).toBe('XarKqjNoE7A');
    });

    test('and they are labelled as examples rather than passed off as matches', async () => {
        const picker = harness();
        await picker.run('jazz');
        const head = document.querySelector('.nexus-bd-together-samplehead');
        expect(head).not.toBeNull();
        expect(head.textContent.toLowerCase()).toContain('no setup needed');
        // The status still says plainly that search is not connected — the examples do not
        // paper over that, they just make the wait for a key survivable.
        expect(document.querySelector('[role="status"]').textContent).toContain("isn't connected");
    });

    test('Set up YouTube is still offered, so the examples are a floor and not a ceiling', async () => {
        const picker = harness();
        await picker.run('jazz');
        expect(document.querySelector('.nexus-bd-together-connect')).not.toBeNull();
    });

    test('once search works, no sample is ever shown', async () => {
        // The whole risk of this feature in one test: a real result set must never be mixed
        // with fixed content.
        const picker = harness({
            why: 'ok',
            provider: {
                search: async () => [{ id: 'aaaaaaaaaaa', title: 'A real hit', creator: 'Someone', kind: 'video' }],
            },
        });
        await picker.run('jazz');
        const rows = [...document.querySelectorAll('.nexus-bd-together-result')];
        expect(rows).toHaveLength(1);
        expect(rows[0].dataset.sample).toBeUndefined();
        expect(document.querySelector('.nexus-bd-together-samplehead')).toBeNull();
    });

    test('a build without the samples module still shows the setup path', async () => {
        const picker = harness();
        delete window.NEXUS_DISCOVERY_SAMPLES;
        await picker.run('jazz');
        expect(document.querySelector('.nexus-bd-together-connect')).not.toBeNull();
        expect(document.querySelectorAll('.nexus-bd-together-result')).toHaveLength(0);
    });

    test('music gets songs, not the video list', async () => {
        document.body.innerHTML = '<div id="host"></div>';
        window.NEXUS_DISCOVERY = { warm: async () => [], forCapability: () => null, why: () => 'no-key' };
        window.NEXUS_DISCOVERY_SAMPLES = samples;
        const root = Picker.build({ doc: document, mediaKind: 'music' });
        document.getElementById('host').appendChild(root);
        await root.search('anything');
        const ids = [...document.querySelectorAll('.nexus-bd-together-result')].map((r) => r.dataset.mediaId);
        expect(ids).toEqual(samples.MUSIC.map((s) => s.id));
    });
});

describe('the module is loaded before the picker that reads it', () => {
    test('boot lists it, and ahead of the launcher', () => {
        const boot = fs.readFileSync(path.join(__dirname, '..', 'src', 'behavior', 'boot.js'), 'utf8');
        const sampleAt = boot.indexOf('discovery/samples.js');
        const pickerAt = boot.indexOf('MediaSearchPicker.js');
        expect(sampleAt).toBeGreaterThan(-1);
        expect(pickerAt).toBeGreaterThan(-1);
        expect(sampleAt).toBeLessThan(pickerAt);
    });
});
