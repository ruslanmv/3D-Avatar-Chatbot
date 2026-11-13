/**
 * AX17. Music in Private: silent unless chosen (see private-prepare and private-wizard-preflight),
 * and when it is chosen — one track that fits the evening, one card, and no title for her to narrate.
 * Cases are from a real Italian session (2026-11-09).
 */
/* global describe, test, expect, beforeEach, afterEach */
const Capability = require('../../src/features/together/TogetherCapability.js');

const track = (id, title) => ({ id, title, url: `https://www.youtube.com/watch?v=${id}` });

describe('a Private track must fit the evening', () => {
    test('the reported first hit, a study/energy mix, is refused', () => {
        const found = [
            track('1J4a9cT2lkw', 'Upbeat Lofi Mix ⚡️ Beats to Boost Your Energy & Focus'),
            track('aaaaaaaaaa1', 'Slow Late Night Lounge Jazz — Instrumental'),
        ];
        expect(Capability.pickPrivateTrack(found).id).toBe('aaaaaaaaaa1');
    });

    test('nothing that fits means no music, never the wrong music', () => {
        expect(
            Capability.pickPrivateTrack([
                track('b1', 'Workout Motivation Mix 2026'),
                track('b2', 'Lofi beats to study and focus'),
                track('b3', 'Party Hits — Upbeat Dance'),
            ])
        ).toBeNull();
        expect(Capability.pickPrivateTrack([])).toBeNull();
        expect(Capability.pickPrivateTrack(null)).toBeNull();
    });

    test('among neutral titles, one that says it is slow or instrumental is preferred', () => {
        const found = [track('c1', 'Mix Vol. 3 Collection'), track('c2', 'Soft Piano for a Candlelit Evening')];
        expect(Capability.pickPrivateTrack(found).id).toBe('c2');
        // 13d180d: a title that says nothing about the mood is not chosen — silence instead.
        expect(Capability.pickPrivateTrack([track('c3', 'Mix Vol. 3')])).toBeNull();
    });
});

describe('one card per track in the chat', () => {
    beforeEach(() => {
        jest.resetModules();
        document.body.innerHTML = '<div id="chat-history"></div>';
        window.__NEXUS_YT_ASK_NOAUTO__ = true;
        window.NEXUS_YT_ASK = require('../../src/features/youtube/YouTubeAsk.js');
    });
    afterEach(() => {
        delete window.NEXUS_YT_ASK;
        delete window.__NEXUS_YT_ASK_NOAUTO__;
        document.body.innerHTML = '';
    });

    test('the same track published three times leaves one card; a different one adds a card', () => {
        const Publisher = require('../../src/features/together/ui/ConversationPublisher.js');
        const lofi = track('1J4a9cT2lkw', 'Upbeat Lofi Mix');
        const a = Publisher.publish(lofi, { doc: document, win: window });
        const b = Publisher.publish(lofi, { doc: document, win: window });
        const c = Publisher.publish(lofi, { doc: document, win: window });
        expect(a).not.toBeNull();
        expect(b).toBe(a);
        expect(c).toBe(a);
        const cards = () =>
            [...document.querySelectorAll('#chat-history *')].filter(
                (n) => /1J4a9cT2lkw/.test(n.textContent || '') && n.children.length === 0
            );
        expect(cards()).toHaveLength(1);
        const other = Publisher.publish(track('dddddddddd1', 'Soft Piano'), { doc: document, win: window });
        expect(other).not.toBe(a);
    });

    test('after its card is gone, the same track may be published again', () => {
        const Publisher = require('../../src/features/together/ui/ConversationPublisher.js');
        const lofi = track('1J4a9cT2lkw', 'Upbeat Lofi Mix');
        const a = Publisher.publish(lofi, { doc: document, win: window });
        document.getElementById('chat-history').innerHTML = '';
        const b = Publisher.publish(lofi, { doc: document, win: window });
        expect(b).not.toBeNull();
        expect(b).not.toBe(a);
    });
});

describe('in Private she is not told the title', () => {
    const Media = require('../../src/features/together/CurrentMediaContext.js');
    afterEach(() => {
        delete window.NEXUS_TOGETHER_CAPABILITY;
        Media.clear();
    });

    test('ordinary chat names the track; a Private evening only knows soft music is on', () => {
        Media.set(track('1J4a9cT2lkw', 'Upbeat Lofi Mix ⚡️ Beats to Boost Your Energy & Focus'));
        expect(Media.systemPromptSuffix()).toContain('Upbeat Lofi Mix');
        window.NEXUS_TOGETHER_CAPABILITY = { privateSessionActive: () => true };
        const inPrivate = Media.systemPromptSuffix();
        expect(inPrivate).not.toContain('Lofi');
        expect(inPrivate).toMatch(/Do not name it/);
    });
});
