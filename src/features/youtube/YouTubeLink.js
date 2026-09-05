/**
 * YouTubeLink — the one place that knows what a YouTube URL looks like (batch YT-1).
 *
 * Pure: no DOM, no fetch on the hot path, no globals read. Everything else in
 * `src/features/youtube/` is a thin consumer of this module, so the parser has exactly one
 * test file and one reason to change.
 *
 * ## What it recognises
 *
 *   youtube.com/watch?v=ID        youtu.be/ID            youtube.com/shorts/ID
 *   youtube.com/embed/ID          youtube.com/live/ID    music.youtube.com/watch?v=ID
 *   m.youtube.com/…               …?t=90 / &t=1h2m3s / &start=90  (start offsets)
 *
 * An ID is exactly 11 characters of [A-Za-z0-9_-]; nothing here guesses.
 *
 * ## What it deliberately does not do
 *
 * It never produces a direct media stream URL. Playback is always YouTube's own player
 * (privacy-enhanced `youtube-nocookie.com` embed in 2D, a shared tab in VR). That is the
 * compliant path and the only one that survives YouTube changing their cipher.
 *
 * Exposes: window.NEXUS_YT
 */
const YouTubeLink = (() => {
    'use strict';

    const ID_RE = /^[A-Za-z0-9_-]{11}$/;

    // One alternation per URL shape. Group 1 is always the id, group 2 the trailing query.
    const URL_RE =
        /(?:https?:\/\/)?(?:(?:www|m|music)\.)?(?:youtube\.com\/(?:watch\?(?:[^\s"'<>]*?&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})([^\s"'<>)\]]*)?/g;

    const THUMB_QUALITY = { default: '', mq: 'mq', hq: 'hq', sd: 'sd', maxres: 'maxres' };

    /** "1h2m3s" | "90s" | "90" → seconds. Anything unparseable → 0. */
    function parseTime(raw) {
        if (raw === null || raw === undefined) {
            return 0;
        }
        const s = String(raw).trim();
        if (/^\d+$/.test(s)) {
            return Number(s);
        }
        const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s);
        if (!m || (!m[1] && !m[2] && !m[3])) {
            return 0;
        }
        return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
    }

    function startFromQuery(tail) {
        if (!tail) {
            return 0;
        }
        const q = tail.replace(/^[?&#]/, '');
        for (const part of q.split(/[&#]/)) {
            const [k, v] = part.split('=');
            if (k === 't' || k === 'start') {
                return parseTime(decodeURIComponent(v || ''));
            }
        }
        return 0;
    }

    function isId(id) {
        return typeof id === 'string' && ID_RE.test(id);
    }

    /**
     * Every YouTube video referenced in a piece of text, first occurrence wins.
     * @returns {Array<{id:string, start:number, raw:string}>}
     */
    function extract(text) {
        if (typeof text !== 'string' || !text) {
            return [];
        }
        const seen = new Set();
        const out = [];
        URL_RE.lastIndex = 0;
        let m;
        while ((m = URL_RE.exec(text)) !== null) {
            const id = m[1];
            if (!isId(id) || seen.has(id)) {
                continue;
            }
            seen.add(id);
            out.push({ id, start: startFromQuery(m[2]), raw: m[0] });
        }
        return out;
    }

    function thumbnail(id, quality = 'hq') {
        const q = Object.prototype.hasOwnProperty.call(THUMB_QUALITY, quality) ? THUMB_QUALITY[quality] : 'hq';
        return `https://i.ytimg.com/vi/${id}/${q}default.jpg`;
    }

    function watchUrl(id, start = 0) {
        return `https://www.youtube.com/watch?v=${id}${start > 0 ? `&t=${Math.floor(start)}s` : ''}`;
    }

    /**
     * Privacy-enhanced embed URL. `rel=0` keeps related videos to the same channel,
     * `playsinline` keeps iOS from going fullscreen on tap. `origin` lets YouTube's IFrame
     * API verify the host page; harmless when the API is not used.
     */
    function embedUrl(id, { start = 0, autoplay = true, origin = '' } = {}) {
        const p = new URLSearchParams();
        if (autoplay) {
            p.set('autoplay', '1');
        }
        p.set('rel', '0');
        p.set('playsinline', '1');
        if (start > 0) {
            p.set('start', String(Math.floor(start)));
        }
        if (origin) {
            p.set('origin', origin);
        }
        return `https://www.youtube-nocookie.com/embed/${id}?${p.toString()}`;
    }

    /** True for anything the chat may carry that points at a video. */
    function isYouTubeAttachment(att) {
        if (!att || typeof att !== 'object') {
            return false;
        }
        if (att.type === 'youtube' || isId(att.youtubeId)) {
            return true;
        }
        return typeof att.url === 'string' && extract(att.url).length > 0;
    }

    /** Normalise any attachment-ish object to `{ id, start, name }`. */
    function fromAttachment(att) {
        if (!isYouTubeAttachment(att)) {
            return null;
        }
        if (isId(att.youtubeId)) {
            return { id: att.youtubeId, start: att.start || 0, name: att.name || '' };
        }
        const [v] = extract(att.url);
        return v ? { id: v.id, start: v.start, name: att.name || '' } : null;
    }

    /** The attachment shape the 2D chat and the bridge both understand. */
    function toAttachment(video, extra = {}) {
        return {
            type: 'youtube',
            youtubeId: video.id,
            start: video.start || 0,
            name: video.name || extra.name || '',
            url: watchUrl(video.id, video.start),
            thumbnail: thumbnail(video.id),
            ...extra,
        };
    }

    /**
     * Same video, but wearing the `image` shape the VR chat panel already knows how to
     * draw and tap. `kind: 'youtube'` is how the bridge recognises it on the way back.
     */
    function toImageAttachment(video, extra = {}) {
        return {
            type: 'image',
            kind: 'youtube',
            youtubeId: video.id,
            start: video.start || 0,
            name: video.name || extra.name || 'YouTube video',
            url: extra.thumbnailUrl || thumbnail(video.id),
            watchUrl: watchUrl(video.id, video.start),
        };
    }

    /**
     * Title/author without an API key. Tries YouTube's oEmbed endpoint directly, then a
     * same-origin proxy (`/api/yt/oembed`) if the app is served by nexus-proxy. Never
     * throws: a missing title is cosmetic.
     */
    /** Milliseconds any one oEmbed candidate gets before the next is tried. */
    const OEMBED_TIMEOUT_MS = 4000;

    /**
     * An abort signal that fires after `ms`, or `undefined` where the platform has neither
     * `AbortSignal.timeout` nor `AbortController` — an old browser loses the deadline, not
     * the feature.
     */
    function timeoutSignal(ms) {
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
            return AbortSignal.timeout(ms);
        }
        if (typeof AbortController !== 'function' || typeof setTimeout !== 'function') {
            return undefined;
        }
        const c = new AbortController();
        setTimeout(() => c.abort(), ms);
        return c.signal;
    }

    async function oembed(id, { fetchImpl, proxyPath = '/api/yt/oembed', timeoutMs = OEMBED_TIMEOUT_MS } = {}) {
        const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        if (!f || !isId(id)) {
            return null;
        }
        const target = encodeURIComponent(watchUrl(id));
        const candidates = [`https://www.youtube.com/oembed?format=json&url=${target}`, `${proxyPath}?url=${target}`];
        for (const url of candidates) {
            try {
                // Each candidate gets its own deadline. Without one, a network that
                // blackholes youtube.com rather than refusing it — a corporate proxy, a
                // headset behind a captive portal, the very cases `proxyPath` exists for —
                // leaves this awaiting the first candidate forever and the same-origin
                // fallback below is never reached. Found by running the app: a stubbed
                // `fetchImpl` always answers, so no test could have caught it.
                const r = await f(url, { mode: 'cors', signal: timeoutSignal(timeoutMs) });
                if (!r || !r.ok) {
                    continue;
                }
                const j = await r.json();
                if (j && j.title) {
                    return { title: j.title, author: j.author_name || '', thumbnail: j.thumbnail_url || thumbnail(id) };
                }
            } catch {
                /* try the next candidate */
            }
        }
        return null;
    }

    return {
        ID_RE,
        URL_RE,
        OEMBED_TIMEOUT_MS,
        timeoutSignal,
        isId,
        parseTime,
        extract,
        thumbnail,
        watchUrl,
        embedUrl,
        isYouTubeAttachment,
        fromAttachment,
        toAttachment,
        toImageAttachment,
        oembed,
    };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_YT = YouTubeLink;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = YouTubeLink;
}
