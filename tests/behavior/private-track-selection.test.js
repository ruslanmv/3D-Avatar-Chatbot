/**
 * Private soundtrack recommendations must be mood-matched and explicitly requested.
 * A search result's rank is not consent and does not imply suitability.
 */
/* global describe, test, expect */
const Capability = require('../../src/features/together/TogetherCapability.js');

const track = (title) => ({
    id: 'track-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    provider: 'youtube',
    kind: 'music',
    title,
});

describe('Private soundtrack result selection', () => {
    test('refuses the energy and focus track from the reported Italian session', () => {
        expect(
            Capability.pickPrivateTrack([
                track('Upbeat Lofi Mix — Beats to Boost Your Energy & Focus'),
            ])
        ).toBeNull();
    });

    test('stays silent when every result is generic or unrelated', () => {
        expect(
            Capability.pickPrivateTrack([
                track('The Best Playlist'),
                track('Top 50 Trending Hits'),
            ])
        ).toBeNull();
    });

    test('selects an explicitly suitable result, not the first ranked hit', () => {
        const soft = track('Soft Piano Evening Instrumental');
        expect(
            Capability.pickPrivateTrack([
                track('Latest Music Mix'),
                track('Upbeat Romantic Energy Workout'),
                soft,
            ])
        ).toEqual(soft);
    });

    test('rejects contradictory results even when they contain a suitable keyword', () => {
        expect(
            Capability.pickPrivateTrack([
                track('Romantic Workout Motivation'),
                track('Soft Music for Focus and Study'),
            ])
        ).toBeNull();
    });

    test('handles empty and malformed result lists without playing anything', () => {
        for (const value of [null, undefined, {}, [], [null, false]]) {
            expect(Capability.pickPrivateTrack(value)).toBeNull();
        }
    });
});
