/**
 * The soundtrack strip, and the two experiences that draw one.
 *
 * Two defects are pinned here because both were visible on screen rather than in a log:
 *
 *   1. Private named a track and played silence. It called `MediaSession.requestPlay`, which
 *      records that playback was asked for and owns no player, and then wrote the title into a
 *      div. Five minutes of quiet with a line insisting otherwise.
 *   2. Scene Tale stacked strips. `removeSoundtrack` used `querySelector`, so a second track
 *      over a story that already had one left both — two `Soundtrack` rows, two `Show player`
 *      buttons, one of them wired to a replaced iframe.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const Strip = require('../../src/features/together/ui/SoundtrackStrip.js');
const PrivateConversationView = require('../../src/features/together/ui/PrivateConversationView.js');
const View = require('../../src/features/together/ui/SceneTaleConversationView.js');
const Playground = require('../../src/features/together/activities/playground.js');

const SEO_TITLE = 'Epic Motivational and Cinematic Inspirational Music | Force - by AShamaluevMusic (Full Album)';

function track(overrides = {}) {
    return {
        id: 'track-000001',
        provider: 'youtube',
        kind: 'music',
        title: SEO_TITLE,
        url: 'https://www.youtube.com/watch?v=track-000001',
        ...overrides,
    };
}

/** A minimal stand-in for the 2D embed, which is the only thing that can actually play. */
function embed() {
    const cards = [];
    const api = {
        buildCard: jest.fn((video, { doc }) => {
            const card = doc.createElement('div');
            card.className = 'nexus-yt-card';
            card.dataset.ytId = video.id;
            cards.push(card);
            return card;
        }),
        activate: jest.fn(),
        cards,
    };
    window.NEXUS_YT_2D = api;
    return api;
}

function chatPage() {
    document.body.innerHTML = `
        <section class="chat-panel">
            <button id="chat-overlay-toggle" type="button">Expand</button>
            <div id="chat-history"><div class="empty-state">No transmissions recorded</div></div>
            <input id="speech-text" placeholder="Message">
            <button id="speak-btn" type="button">Send</button>
        </section>`;
}

afterEach(() => {
    document.body.innerHTML = '';
    delete window.NEXUS_YT_2D;
    delete window.NEXUS_MEDIA_SESSION;
    delete window.NEXUS_BD;
    jest.clearAllMocks();
});

describe('SoundtrackStrip', () => {
    beforeEach(() => chatPage());

    test('names the track by its name, not by the keywords it was filed under', () => {
        embed();
        const built = Strip.render(track(), { doc: document, win: window });
        const title = built.strip.querySelector('.nexus-soundtrack-title').textContent;

        expect(title).toContain('Epic Motivational');
        expect(title).not.toMatch(/AShamaluevMusic/);
        expect(title).not.toMatch(/Full Album/i);
        expect(built.strip.querySelector('.nexus-soundtrack-creator').textContent).toBe('AShamaluevMusic');
    });

    test('the untouched title stays reachable as a tooltip', () => {
        embed();
        const built = Strip.render(track(), { doc: document, win: window });
        expect(built.strip.querySelector('.nexus-soundtrack-title').title).toBe(SEO_TITLE);
    });

    test('builds a collapsed player and starts it', () => {
        const yt = embed();
        const built = Strip.render(track(), { doc: document, win: window });

        expect(yt.buildCard).toHaveBeenCalledTimes(1);
        expect(yt.activate).toHaveBeenCalledTimes(1);
        expect(built.player.classList.contains('is-open')).toBe(false);
        expect(built.toggle.textContent).toBe('Show player');
        expect(built.toggle.getAttribute('aria-expanded')).toBe('false');

        built.toggle.click();
        expect(built.player.classList.contains('is-open')).toBe(true);
        expect(built.toggle.textContent).toBe('Hide player');
        expect(built.toggle.getAttribute('aria-expanded')).toBe('true');
    });

    test('announces playback to the session only when a source is named and a player exists', () => {
        const session = { requestPlay: jest.fn() };
        window.NEXUS_MEDIA_SESSION = session;
        embed();

        Strip.render(track(), { doc: document, win: window });
        expect(session.requestPlay).not.toHaveBeenCalled();

        Strip.render(track(), { doc: document, win: window, source: 'scene-tale' });
        expect(session.requestPlay).toHaveBeenCalledWith(expect.objectContaining({ id: 'track-000001' }), {
            source: 'scene-tale',
        });
    });

    test('degrades to copy with no embed, and survives one that throws', () => {
        const bare = Strip.render(track(), { doc: document, win: window });
        expect(bare.card).toBeNull();
        expect(bare.toggle).toBeNull();
        expect(bare.strip.textContent).toContain('Epic Motivational');

        window.NEXUS_YT_2D = {
            buildCard: () => {
                throw new Error('no');
            },
            activate: jest.fn(),
        };
        const broken = Strip.render(track(), { doc: document, win: window });
        expect(broken.card).toBeNull();
        expect(broken.strip.textContent).toContain('Epic Motivational');
    });

    test('play:false draws the player without starting it', () => {
        const yt = embed();
        Strip.render(track(), { doc: document, win: window, play: false });
        expect(yt.buildCard).toHaveBeenCalledTimes(1);
        expect(yt.activate).not.toHaveBeenCalled();
    });
});

describe('Private soundtrack', () => {
    beforeEach(() => chatPage());

    test('plays the track it names instead of writing a line about it', () => {
        const yt = embed();
        const view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Affectionate' }, scene: 'Coastal Terrace · Twilight' });

        view.attachSoundtrack(track({ title: 'Relaxing Chill Music – Stress Relief Lounge Music | Background Music' }));

        const slot = document.querySelector('.nexus-private-soundtrack');
        expect(slot.hidden).toBe(false);
        expect(slot.querySelector('[data-private-soundtrack="1"]')).not.toBeNull();
        expect(slot.querySelector('.nexus-private-soundtrack-title').textContent).toBe('♫ Relaxing Chill Music');
        expect(slot.querySelector('.nexus-yt-card')).not.toBeNull();
        expect(yt.activate).toHaveBeenCalledTimes(1);

        view.destroy();
    });

    test('a second track replaces the first rather than joining it', () => {
        embed();
        const view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Affectionate' }, scene: 'Coastal Terrace · Twilight' });

        view.attachSoundtrack(track({ id: 'first-0000001', title: 'First' }));
        view.attachSoundtrack(track({ id: 'second-000001', title: 'Second' }));

        const slot = document.querySelector('.nexus-private-soundtrack');
        expect(slot.querySelectorAll('[data-private-soundtrack="1"]')).toHaveLength(1);
        expect(slot.querySelectorAll('.nexus-private-soundtrack-toggle')).toHaveLength(1);
        expect(slot.textContent).toContain('Second');
        expect(slot.textContent).not.toContain('First');

        view.destroy();
    });

    test('nothing playable still leaves the track named', () => {
        const view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Affectionate' }, scene: 'Coastal Terrace · Twilight' });
        view.attachSoundtrack(track({ title: 'Soft instrumental' }));

        const slot = document.querySelector('.nexus-private-soundtrack');
        expect(slot.hidden).toBe(false);
        expect(slot.textContent).toContain('Soft instrumental');
        view.destroy();
    });
});

describe('Scene Tale soundtrack', () => {
    beforeEach(() => {
        chatPage();
        window.NEXUS_BD = { togetherPanel: { activities: new Map() } };
        View.install(document, window);
        View.patchStoryPlayer(Playground);
    });

    test('a replacement track leaves exactly one strip and one player', () => {
        embed();
        window.NEXUS_MEDIA_SESSION = { requestPlay: jest.fn(), get: () => ({ source: 'scene-tale' }) };
        const player = new Playground.StoryPlayer({
            plan: Playground.fallbackStory({ id: 'ocean', label: 'Ocean' }, '', false),
            win: window,
            doc: document,
            say: jest.fn(),
            timingScale: 0,
            bus: { emit: jest.fn() },
        });
        window.NEXUS_BD.togetherPanel.activities.set('playground', { player });
        player.start();

        View.attachSoundtrack(track({ id: 'first-0000001', title: 'First' }), { doc: document, win: window });
        View.attachSoundtrack(track({ id: 'second-000001', title: 'Second' }), { doc: document, win: window });

        const hud = document.getElementById(View.HUD_ID);
        expect(hud.querySelectorAll('[data-scene-tale-soundtrack="1"]')).toHaveLength(1);
        expect(hud.querySelectorAll('.nexus-scene-tale-soundtrack-player')).toHaveLength(1);
        expect(hud.querySelectorAll('.nexus-scene-tale-soundtrack-toggle')).toHaveLength(1);
        expect(hud.textContent).toContain('Second');
        expect(hud.textContent).not.toContain('First');

        player.detach();
    });

    test('the strip shows the name and credits the channel', () => {
        embed();
        window.NEXUS_MEDIA_SESSION = { requestPlay: jest.fn(), get: () => ({ source: 'scene-tale' }) };
        const player = new Playground.StoryPlayer({
            plan: Playground.fallbackStory({ id: 'ocean', label: 'Ocean' }, '', false),
            win: window,
            doc: document,
            say: jest.fn(),
            timingScale: 0,
            bus: { emit: jest.fn() },
        });
        window.NEXUS_BD.togetherPanel.activities.set('playground', { player });
        player.start();

        View.attachSoundtrack(track(), { doc: document, win: window });

        const hud = document.getElementById(View.HUD_ID);
        const title = hud.querySelector('.nexus-scene-tale-soundtrack-title').textContent;
        expect(title).not.toMatch(/Full Album/i);
        expect(title).not.toMatch(/AShamaluevMusic/);
        expect(hud.querySelector('.nexus-scene-tale-soundtrack-creator').textContent).toBe('AShamaluevMusic');

        player.detach();
    });
});
