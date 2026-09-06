/**
 * Three videos and three songs that work with no key at all.
 *
 * Search needs a YouTube Data API key. Without one the Watch and Music setup screens could
 * offer nothing but a link to Settings and an invitation to go and get an API key from Google
 * Cloud — which is a reasonable thing to ask of an operator and an absurd thing to ask of
 * somebody who wanted to see whether the feature is any good. A product that cannot be tried
 * until it is configured mostly does not get tried.
 *
 * So there is a small fixed set. Playback needs no key — only *search* does — so these play
 * exactly the way a real result plays, through the same code path, and the feature is
 * demonstrable in one tap on a fresh deployment.
 *
 * ## The rule these must never break
 *
 * **A sample is never a search result.** If somebody types "jazz" and gets handed one of these
 * labelled as a match, the product has lied to them, and that is worse than an empty state.
 * They are offered only where there is no search to do — no key anywhere — and they are always
 * rendered under their own heading, as examples. That is why this is a plain list rather than a
 * provider registered with `ProviderRegistry`: a provider would make them answer queries, and
 * the registry is for things that actually search.
 *
 * ## Why these six
 *
 * Every one is on a channel whose entire purpose is being embedded on other people's pages —
 * the first video ever uploaded to YouTube, the most-embedded video in the history of the
 * internet, and the record-breakers everybody recognises. Not a taste recommendation: the
 * quality being selected for is *durability*. These are the least likely six ids on YouTube to
 * be deleted, go private, or turn off embedding.
 *
 * ## What was actually verified, and what was not
 *
 * Each id was checked against YouTube's oEmbed endpoint and returned 200 with the title and
 * channel recorded below, so all six exist and are public. **Embeddability was not verified**:
 * the sandbox this was written in blocks the browser from reaching youtube.com, so the one test
 * that would settle it could not be run. `tests/discovery-samples.test.js` re-checks existence
 * against oEmbed when the network allows and skips itself when it does not.
 *
 * Which is why nothing here is load-bearing. A sample that has died since is one card that says
 * so; the other five still play, search still works once a key is set, and the fix is one line
 * of data in this file.
 */
(function (global) {
    'use strict';

    /** YouTube ids are exactly 11 characters. Anything else is a typo, and a typo is a 404. */
    const ID = /^[A-Za-z0-9_-]{11}$/;

    /**
     * @typedef {object} Sample
     * @property {string} id      YouTube video id
     * @property {string} title   as YouTube reports it
     * @property {string} creator the channel
     * @property {string} why     why this one is here, for whoever changes the list next
     */

    /** @type {Sample[]} */
    const VIDEOS = [
        {
            id: 'jNQXAC9IVRw',
            title: 'Me at the zoo',
            creator: 'jawed',
            why: 'the first video ever uploaded to YouTube, April 2005 — 19 seconds, and it will outlive this app',
        },
        {
            id: 'dQw4w9WgXcQ',
            title: 'Rick Astley — Never Gonna Give You Up',
            creator: 'Rick Astley',
            why: 'the most-embedded video on the internet; the entire rickroll depends on embedding working',
        },
        {
            id: '9bZkp7q19f0',
            title: 'PSY — GANGNAM STYLE',
            creator: 'officialpsy',
            why: 'the first video to pass a billion views, and the reason YouTube had to widen its counter',
        },
    ];

    /** @type {Sample[]} */
    const MUSIC = [
        {
            id: 'jfKfPfyJRdk',
            title: 'lofi hip hop radio — beats to relax/study to',
            creator: 'Lofi Girl',
            why: 'a stream that exists to be left playing in other people’s tabs',
        },
        {
            id: 'fJ9rUzIMcZQ',
            title: 'Queen — Bohemian Rhapsody',
            creator: 'Queen Official',
            why: 'the first music video, on the band’s own channel',
        },
        {
            id: '60ItHLz5WEA',
            title: 'Alan Walker — Faded',
            creator: 'Alan Walker',
            why: 'an artist-owned channel rather than a label’s, so embedding is not a licensing decision',
        },
    ];

    /** The shape `MediaResult` produces, so a sample renders and plays like any other result. */
    function toResult(sample, kind) {
        return {
            id: sample.id,
            provider: 'sample',
            kind,
            title: sample.title,
            creator: sample.creator,
            url: `https://www.youtube.com/watch?v=${sample.id}`,
            thumbnail: `https://i.ytimg.com/vi/${sample.id}/mqdefault.jpg`,
            duration: 0,
            start: 0,
            description: '',
            publishedAt: '',
            // The flag the picker groups on, and the reason this can never be mistaken for a
            // match: a result carrying `sample: true` is one nobody searched for.
            sample: true,
        };
    }

    function videos() {
        return VIDEOS.map((s) => toResult(s, 'video'));
    }

    function music() {
        return MUSIC.map((s) => toResult(s, 'music'));
    }

    /**
     * Samples for a discovery capability, or `[]` for one that has none.
     *
     * `[]` rather than a guess: a capability nobody wrote samples for should show the ordinary
     * empty state, not three videos borrowed from a different feature.
     */
    function forCapability(capability) {
        if (capability === 'video.search') {
            return videos();
        }
        if (capability === 'music.search') {
            return music();
        }
        return [];
    }

    const api = { ID, VIDEOS, MUSIC, videos, music, forCapability, toResult };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_DISCOVERY_SAMPLES = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
