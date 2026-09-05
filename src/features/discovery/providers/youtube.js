/**
 * YouTube, as a discovery provider (batch D2, for D3).
 *
 * A thin wrapper, on purpose. `YouTubeCompanion.search()` already talks to the Data API and
 * `YouTubeLink` already knows what a canonical watch URL looks like — copying either into
 * Together would give the app two YouTube implementations that drift.
 *
 * So this file contains no HTTP, no URL parsing and no key handling. What it adds is the
 * translation to `MediaResult` and an honest answer to "can you search right now?".
 *
 * Exposes: window.NEXUS_DISCOVERY_YOUTUBE
 */
const YouTubeProvider = (() => {
    'use strict';

    const ID = 'youtube';

    function companion() {
        return (typeof window !== 'undefined' && window.NEXUS_YT_COMPANION) || null;
    }
    function settings() {
        return (typeof window !== 'undefined' && window.NEXUS_YT_SETTINGS) || null;
    }
    function results() {
        return (typeof window !== 'undefined' && window.NEXUS_MEDIA_RESULT) || null;
    }

    /**
     * Readiness, as four separate facts rather than one boolean.
     *
     * `configured` and `available` are different questions and have different answers in the
     * UI: a provider whose code is missing needs a bug report, and one with no key needs a
     * button. Collapsing them is how "YouTube search isn't connected" ends up shown to
     * somebody whose page simply failed to load a script.
     */
    function status() {
        const comp = companion();
        if (!comp) {
            return { id: ID, configured: false, available: false, capabilities: [], reason: 'not-loaded' };
        }
        const set = settings();
        const key = set && typeof set.apiKey === 'function' ? set.apiKey() : comp.apiKey();
        if (!key) {
            return { id: ID, configured: false, available: false, capabilities: [], reason: 'no-key' };
        }
        return {
            id: ID,
            configured: true,
            available: true,
            capabilities: ['video.search', 'music.search', 'video.play'],
            reason: 'ok',
        };
    }

    function available() {
        return status().available;
    }

    /**
     * Search, normalized. Resolves to an array — never `null`, never a rejection.
     *
     * The companion returns `null` for "no key" and `[]` for "the API said no", which is a
     * useful distinction *there* and not here: this file has already answered the key
     * question through `status()`, and a picker asking for results wants results or nothing.
     */
    async function search(query, { max = 4, kind = 'video', search: injected } = {}) {
        const comp = companion();
        const R = results();
        if (!comp || !R) {
            return [];
        }
        const q = String(query || '').trim();
        if (!q) {
            return [];
        }
        let raw;
        try {
            raw = await (injected || comp.search)(q, { max });
        } catch (_) {
            // A provider that throws is a provider that found nothing, as far as Together is
            // concerned. The picker says "unavailable"; the chat is untouched either way.
            return [];
        }
        return R.many((raw || []).map((item) => normalize(item, kind)));
    }

    /** One companion result → one `MediaResult`. */
    function normalize(item, kind = 'video') {
        if (!item || !item.id) {
            return null;
        }
        return {
            id: item.id,
            provider: ID,
            kind: kind === 'music' || kind === 'track' ? 'track' : 'video',
            title: item.name || '',
            creator: item.author || '',
            // The facade thumbnail YouTube serves for every video. `hqdefault` rather than
            // `maxres`, which is absent for a large share of videos and yields a broken image
            // in a row of otherwise fine ones.
            thumbnail: `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
            duration: null,
            url: `https://www.youtube.com/watch?v=${item.id}`,
            playback: { type: 'youtube', inline: true, immersive: true },
        };
    }

    return { ID, status, available, search, normalize };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_DISCOVERY_YOUTUBE = YouTubeProvider;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = YouTubeProvider;
}
