/**
 * YouTubeCompanion — how a YouTube video reaches the VR cinema screen (batch YT-2).
 *
 * ## The constraint this is built around
 *
 * A cross-origin iframe cannot be drawn into a WebGL texture, and an immersive WebXR
 * session shows only the framebuffer — there is no DOM in the headset. B12's `watch.js`
 * already says it: *a DRM'd player cannot be textured directly but the tab showing it can
 * be.* So the only compliant way to put YouTube on the cinema screen is to capture a tab
 * that is playing it, and that is what this module manages.
 *
 * ## The trick that makes it one permission per evening
 *
 * `getDisplayMedia` prompts on *every* call, and the picker cannot appear inside an
 * immersive session. But an opener may **navigate** a window it opened, even cross-origin —
 * it just cannot read it. So:
 *
 *   1. In 2D, before the headset goes on: `startParty(id)` opens a *named* companion tab
 *      on the video and asks B12's Watch activity to share a tab (the user picks it).
 *   2. In VR, every later pick calls `navigate(id)` — same tab, new video, no prompt.
 *
 * The name (`nexus-yt-companion`) is what makes `window.open` reuse the tab instead of
 * spawning another. Nothing here uses `noopener`; the handle is the whole point.
 *
 * ## Search (optional)
 *
 * `search(query)` calls YouTube Data API v3 `search.list` if a key is configured
 * (`window.NEXUS_YT_CONFIG.apiKey` or `localStorage['nexus.yt.apiKey']`). With no key it
 * resolves to `null` and the UI hides the feature — an install without a key is unchanged.
 *
 * Exposes: window.NEXUS_YT_COMPANION
 */
const YouTubeCompanion = (() => {
    'use strict';

    const WINDOW_NAME = 'nexus-yt-companion';
    const KEY_STORAGE = 'nexus.yt.apiKey';

    function link() {
        return (
            (typeof window !== 'undefined' && window.NEXUS_YT) ||
            (typeof require === 'function' ? require('./YouTubeLink.js') : null)
        );
    }

    function config() {
        return (typeof window !== 'undefined' && window.NEXUS_YT_CONFIG) || {};
    }

    /**
     * The Data API key, from whichever source has one (D1).
     *
     * `YouTubeSettings` owns the order — Settings, then the host page, then this file's
     * legacy `localStorage` key — and is asked first so a key typed into Settings wins. It
     * ships alongside this file; when it is absent (an older page, a test that loads only
     * this module) the original two sources still answer, unchanged.
     */
    function apiKey() {
        const settings = typeof window !== 'undefined' ? window.NEXUS_YT_SETTINGS : null;
        if (settings && typeof settings.apiKey === 'function') {
            return settings.apiKey();
        }
        const c = config();
        if (c.apiKey) {
            return c.apiKey;
        }
        try {
            return (typeof localStorage !== 'undefined' && localStorage.getItem(KEY_STORAGE)) || '';
        } catch {
            return '';
        }
    }

    class Companion {
        constructor({ win } = {}) {
            this.window = win || (typeof window !== 'undefined' ? window : null);
            this.handle = null;
            this.current = null; // { id, start }
            this.listeners = new Set();
        }

        isOpen() {
            return Boolean(this.handle && !this.handle.closed);
        }

        onChange(fn) {
            this.listeners.add(fn);
            return () => this.listeners.delete(fn);
        }

        _emit(event) {
            for (const fn of this.listeners) {
                try {
                    fn(event, this.current);
                } catch {
                    /* a listener's bug is not our bug */
                }
            }
        }

        /**
         * Open the companion on a video, or steer the existing one there. Must run inside a
         * user gesture the first time (popup blockers), which the 2D card guarantees.
         * @returns {Window|null}
         */
        open(id, start = 0) {
            const YT = link();
            if (!this.window || !YT || !YT.isId(id)) {
                return null;
            }
            const url = YT.watchUrl(id, start);
            if (this.isOpen()) {
                try {
                    this.handle.location.href = url; // navigate-only across origins: allowed
                } catch {
                    this.handle = null;
                    return this.open(id, start);
                }
            } else {
                this.handle = this.window.open(url, WINDOW_NAME);
                if (!this.handle) {
                    return null;
                }
            }
            this.current = { id, start };
            this._emit('navigate');
            return this.handle;
        }

        /** Alias that reads better at the call site in VR. */
        navigate(id, start = 0) {
            return this.open(id, start);
        }

        close() {
            if (this.isOpen()) {
                try {
                    this.handle.close();
                } catch {
                    /* already gone */
                }
            }
            this.handle = null;
            this.current = null;
            this._emit('close');
        }

        /**
         * The 2D → VR hand-off. Opens the companion, then — if Together Mode's Watch
         * activity is booted — asks it to share a tab so the user can pick the companion in
         * the browser's picker. Returns what `shareTab` returned, or `null` if Watch is not
         * available (the tab is still open; the user can share it from the Together panel).
         */
        async startParty(id, start = 0, { watch } = {}) {
            const handle = this.open(id, start);
            if (!handle) {
                return { companion: null, watch: null };
            }
            const activity = watch || (this.window && this.window.NEXUS_BD && this.window.NEXUS_BD.watch) || null;
            let result = null;
            if (activity && typeof activity.shareTab === 'function') {
                try {
                    result = await activity.shareTab();
                } catch {
                    result = null;
                }
            }
            this._emit('party');
            return { companion: handle, watch: result };
        }
    }

    /**
     * Ask the deployment's own search route (D13).
     *
     * `null` when this host has none — an older build, a static file server, a page opened
     * from disk. `[]` when it has one and found nothing, which is a different answer.
     *
     * The key behind this route stays on the server. That is the whole reason the route
     * exists rather than a config endpoint handing the operator's key to the page: a Data API
     * key in client JavaScript is a public key, and referrer restrictions only bind browsers.
     */
    async function serverSearch(query, { max = 5, fetchImpl } = {}) {
        const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        if (!f || !query) {
            return null;
        }
        try {
            const r = await f(`/api/yt/search?q=${encodeURIComponent(query)}&max=${encodeURIComponent(max)}`);
            if (!r || !r.ok) {
                return null;
            }
            const body = await r.json();
            return Array.isArray(body && body.results) ? body.results : null;
        } catch (_) {
            return null;
        }
    }

    /** Does this deployment search on its own key? `null` while unknown. */
    async function serverConfigured({ fetchImpl } = {}) {
        const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        if (!f) {
            return false;
        }
        try {
            const r = await f('/api/yt/search');
            if (!r || !r.ok) {
                return false;
            }
            const body = await r.json();
            return Boolean(body && body.configured);
        } catch (_) {
            return false;
        }
    }

    /**
     * YouTube Data API v3 search. Returns `null` when nothing can search so callers can hide
     * the affordance; returns `[]` on an API error so callers can say "nothing found".
     *
     * Two paths, and the user's own key wins (D13). Somebody who typed a key meant to use it —
     * their quota, their restrictions — and silently preferring the deployment's would make
     * that field decorative. With no key of their own, the deployment's route answers and they
     * never learn that keys exist, which is the point.
     */
    async function search(query, { max = 5, key, fetchImpl } = {}) {
        const YT = link();
        const k = key || apiKey();
        if (!query || !YT) {
            return null;
        }
        if (!k) {
            return serverSearch(query, { max, fetchImpl });
        }
        const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        if (!f) {
            return null;
        }
        const p = new URLSearchParams({
            part: 'snippet',
            type: 'video',
            videoEmbeddable: 'true',
            safeSearch: 'moderate',
            maxResults: String(Math.max(1, Math.min(10, max))),
            q: query,
            key: k,
        });
        try {
            const r = await f(`https://www.googleapis.com/youtube/v3/search?${p.toString()}`);
            if (!r.ok) {
                return [];
            }
            const j = await r.json();
            return (j.items || [])
                .filter((it) => it.id && YT.isId(it.id.videoId))
                .map((it) => ({
                    id: it.id.videoId,
                    start: 0,
                    name: (it.snippet && it.snippet.title) || '',
                    author: (it.snippet && it.snippet.channelTitle) || '',
                }));
        } catch {
            return [];
        }
    }

    const shared = new Companion();

    return {
        WINDOW_NAME,
        KEY_STORAGE,
        Companion,
        apiKey,
        search,
        serverSearch,
        serverConfigured,
        // convenience bindings to the shared instance
        isOpen: () => shared.isOpen(),
        open: (id, start) => shared.open(id, start),
        navigate: (id, start) => shared.navigate(id, start),
        close: () => shared.close(),
        startParty: (id, start, opts) => shared.startParty(id, start, opts),
        onChange: (fn) => shared.onChange(fn),
        get current() {
            return shared.current;
        },
        _shared: shared,
    };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_YT_COMPANION = YouTubeCompanion;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = YouTubeCompanion;
}
