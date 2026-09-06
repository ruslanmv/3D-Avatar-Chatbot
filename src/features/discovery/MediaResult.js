/**
 * One shape for anything you can put on (batch D2, for D3).
 *
 * Together consumes *this*, never a provider's own JSON. That is the whole of the
 * abstraction, and it is worth the one file: the day a second provider arrives, the picker,
 * the publisher and every test go on working, because none of them has ever seen a
 * YouTube-shaped object.
 *
 * Deliberately small. There is no `views`, no `publishedAt`, no `description` — a picker
 * shows a thumbnail, a title and who made it, and a field nothing renders is a field that
 * goes stale without anybody noticing.
 *
 * Exposes: window.NEXUS_MEDIA_RESULT
 */
const MediaResult = (() => {
    'use strict';

    /** `video` for something you watch, `track` for something you listen to. */
    const KINDS = ['video', 'track'];

    function text(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    /**
     * Build one result, or `null` when it is not usable.
     *
     * Null rather than a partly-filled object: a card with no id cannot be played and a card
     * with no url cannot be published, so letting one through only moves the failure to a
     * place with less context.
     */
    function make(raw) {
        const id = text(raw && raw.id);
        const url = text(raw && raw.url);
        if (!id || !url) {
            return null;
        }
        const kind = KINDS.includes(raw.kind) ? raw.kind : 'video';
        return {
            id,
            provider: text(raw.provider) || 'unknown',
            kind,
            title: text(raw.title),
            creator: text(raw.creator),
            // D9. Not rendered anywhere — the picker shows a title and a creator — but the
            // model reads them, which is the difference between "I cannot know what you are
            // watching" and an answer.
            description: text(raw.description),
            publishedAt: text(raw.publishedAt),
            // One field, whatever the kind calls it. A music picker showing `artwork` and a
            // video picker showing `thumbnail` would be two components for one job.
            thumbnail: text(raw.thumbnail),
            duration: Number.isFinite(raw.duration) && raw.duration > 0 ? raw.duration : null,
            url,
            playback: {
                type: text(raw.playback && raw.playback.type) || text(raw.provider) || 'unknown',
                inline: raw.playback ? raw.playback.inline !== false : true,
                immersive: Boolean(raw.playback && raw.playback.immersive),
            },
        };
    }

    /** Build many, dropping the ones that are not usable. */
    function many(list) {
        return (Array.isArray(list) ? list : []).map(make).filter(Boolean);
    }

    /** `3:07`, or `''` when the duration is unknown — which is most of the time. */
    function clock(seconds) {
        const total = Number(seconds);
        if (!Number.isFinite(total) || total <= 0) {
            return '';
        }
        const m = Math.floor(total / 60);
        const s = Math.floor(total % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    return { KINDS, make, many, clock };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_MEDIA_RESULT = MediaResult;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MediaResult;
}
