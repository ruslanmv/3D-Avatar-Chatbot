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
    const CAPABILITIES = ['video.search', 'music.search', 'video.play'];

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
     * Does this deployment search on its own key? (D13)
     *
     * Tri-state and cached: `null` until the probe answers. `status()` is synchronous — the
     * registry and Settings both call it — so the fact has to be known by then, which is what
     * `ready()` is for. Reporting "available" before the probe returns would be the
     * dead-provider-shown-as-working failure the whole readiness model exists to prevent.
     */
    let deployment = null;
    let probe = null;

    /**
     * Why the deployment route could not answer, when it could not.
     *
     * Held beside `deployment` rather than folded into it, because a boolean cannot tell
     * somebody whose key is set that the problem is a login wall in front of the route.
     */
    let deploymentReason = null;

    function ready(deps = {}) {
        if (deployment !== null && !deps.force) {
            return Promise.resolve(status());
        }
        const comp = companion();
        if (!comp || typeof (comp.serverStatus || comp.serverConfigured) !== 'function') {
            deployment = false;
            return Promise.resolve(status());
        }
        if (!probe || deps.force) {
            // `serverStatus` where it exists, because *why* the deployment cannot search is
            // the difference between "add a key" and "your preview is behind a login wall".
            const ask =
                typeof comp.serverStatus === 'function'
                    ? comp.serverStatus(deps)
                    : comp
                          .serverConfigured(deps)
                          .then((c) => ({ configured: Boolean(c), reason: c ? 'ok' : 'no-key' }));
            probe = ask
                .then((answer) => {
                    deployment = Boolean(answer && answer.configured);
                    deploymentReason = (answer && answer.reason) || (deployment ? 'ok' : 'no-key');
                })
                .catch(() => {
                    deployment = false;
                    deploymentReason = 'unreachable';
                });
        }
        return probe.then(() => status());
    }

    /** The key the user typed, wherever they typed it. `''` when there is none. */
    function ownKey(comp) {
        const set = settings();
        if (set && typeof set.apiKey === 'function') return set.apiKey();
        return comp && typeof comp.apiKey === 'function' ? comp.apiKey() : '';
    }

    /**
     * Tell the generic capability picker whether an explicit YouTube choice can use a client
     * credential. Auto is allowed to use the site's deployment route; choosing YouTube in the
     * capability selector means "use my key" and must not silently spend the site's quota.
     *
     * `apiKey()` intentionally includes the legacy key path so existing installations that
     * explicitly selected YouTube keep working. The Settings renderer still only *shows* the
     * key it owns, so a legacy key is never copied into a new field without the user touching it.
     */
    function credentialStatus(storage) {
        const set = settings();
        let key = '';
        try {
            key = set && typeof set.apiKey === 'function' ? set.apiKey(storage) : ownKey(companion());
        } catch (_) {
            key = '';
        }
        return { supportsOwnKey: true, hasOwnKey: Boolean(String(key || '').trim()) };
    }

    /**
     * Readiness, as separate facts rather than one boolean.
     *
     * `configured` and `available` are different questions with different answers in the UI:
     * a provider whose code is missing needs a bug report, and one with no key needs a button.
     * Collapsing them is how "YouTube search isn't connected" ends up shown to somebody whose
     * page simply failed to load a script.
     *
     * D13 adds a third state between those. `deployment` means the site searches on its own
     * key and the visitor needs nothing — reported as its own reason so Settings can say so
     * rather than showing a key field that nobody has to fill in.
     */
    function status() {
        const comp = companion();
        if (!comp) {
            return { id: ID, configured: false, available: false, capabilities: [], reason: 'not-loaded' };
        }
        const key = ownKey(comp);
        if (!key && !deployment) {
            return {
                id: ID,
                configured: false,
                available: false,
                // Keep the declared capability visible even while setup is missing. Settings
                // needs to offer "YouTube — my own key" precisely when no key exists yet.
                capabilities: CAPABILITIES.slice(),
                // The route answering with a redirect or a login page is not a missing key,
                // and telling somebody to add one they already added sends them to the one
                // place the problem is not.
                reason:
                    deployment === null
                        ? 'checking'
                        : deploymentReason && deploymentReason !== 'ok'
                          ? deploymentReason
                          : 'no-key',
            };
        }
        return {
            id: ID,
            configured: true,
            available: true,
            capabilities: CAPABILITIES.slice(),
            // Which key is doing the work, so the UI can stop asking for one that is not needed.
            reason: key ? 'ok' : 'deployment',
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

    /**
     * The five entities YouTube's Data API escapes in titles and descriptions.
     *
     * It returns `Drake - One Dance ft. Wizkid &amp; Kyla`, and the app renders titles as
     * text — correctly, because a title is untrusted text from an uploader and must never be
     * parsed as markup. So the ampersand arrived on screen as `&amp;` and stayed there.
     *
     * Decoded by table rather than by a parser or an off-screen element: the whole point of
     * setting these as `textContent` is that nothing uploader-supplied is ever handed to an
     * HTML parser, and `innerHTML = title` to read it back would hand it to one.
     */
    const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };

    /** Undo the API's escaping, and nothing else. */
    function unescapeText(value) {
        return String(value === null || value === undefined ? '' : value).replace(
            /&(?:amp|lt|gt|quot|#39|apos);/g,
            (m) => ENTITIES[m] || m
        );
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
            title: unescapeText(item.name),
            creator: unescapeText(item.author),
            description: unescapeText(item.description),
            publishedAt: item.publishedAt || '',
            // The facade thumbnail YouTube serves for every video. `hqdefault` rather than
            // `maxres`, which is absent for a large share of videos and yields a broken image
            // in a row of otherwise fine ones.
            thumbnail: `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
            duration: null,
            url: `https://www.youtube.com/watch?v=${item.id}`,
            playback: { type: 'youtube', inline: true, immersive: true },
        };
    }

    return { ID, status, available, ready, credentialStatus, search, normalize, unescapeText };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_DISCOVERY_YOUTUBE = YouTubeProvider;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = YouTubeProvider;
}
