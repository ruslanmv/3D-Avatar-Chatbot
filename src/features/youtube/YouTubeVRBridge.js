/**
 * YouTubeVRBridge — YouTube links inside the headset (batch YT-4).
 *
 * ## What VR can and cannot do
 *
 * It can show a thumbnail and a title, and it can react to a tap. It cannot play a YouTube
 * iframe — see `YouTubeCompanion.js` for why, and for the compliant way around it (a
 * companion tab shared *before* the session, navigated *during* it).
 *
 * ## Reusing what exists, wrapping nothing that isn't an instance
 *
 * `VRChatPanel` already draws `image` attachments as tappable cards with cached
 * thumbnails, and `VRChatIntegration` already routes a card tap to `VRMediaPanel.show`.
 * So a YouTube link becomes an `image` attachment whose `url` is the video's thumbnail and
 * whose `kind` is `'youtube'`; the panel draws it with no knowledge of YouTube at all.
 *
 * Three methods are wrapped, all on the *instances* the engine created (never on
 * prototypes, never on modules), and each wrapper falls through to the original:
 *
 *   vrChatPanel.appendMessage      text with a link  → appendRichMessage with a card
 *   vrChatPanel.appendRichMessage  `youtube` attachments → `image` cards
 *   VRMediaPanel.show              `kind === 'youtube'` → poster + route to playback
 *
 * ## Routing a tap
 *
 *   companion tab open  → navigate it (the shared tab changes; the cinema screen follows)
 *   otherwise           → remember the pick; when the session ends, post it to the 2D
 *                          chat so the person finds the video waiting where they can play it
 *
 * Nothing is prompted for inside the session — nothing can be.
 *
 * Exposes: window.NEXUS_YT_VR
 */
const YouTubeVRBridge = (() => {
    'use strict';

    const state = { attached: false, pending: null, unhooks: [] };

    function YT() {
        return (typeof window !== 'undefined' && window.NEXUS_YT) || null;
    }
    function companion() {
        return (typeof window !== 'undefined' && window.NEXUS_YT_COMPANION) || null;
    }
    function thumbFor(id) {
        const cfg = (typeof window !== 'undefined' && window.NEXUS_YT_CONFIG) || {};
        // Optional same-origin proxy for headsets whose browser refuses i.ytimg.com CORS.
        return cfg.thumbProxy ? `${cfg.thumbProxy}${id}` : YT().thumbnail(id);
    }

    /** `youtube` attachments and link-bearing text → `image` cards the panel can draw. */
    function normaliseAttachments(text, attachments) {
        const Y = YT();
        if (!Y) {
            return attachments || [];
        }
        const out = [];
        const seen = new Set();
        const push = (video, name) => {
            if (!video || seen.has(video.id)) {
                return;
            }
            seen.add(video.id);
            out.push(Y.toImageAttachment({ ...video, name: name || video.name }, { thumbnailUrl: thumbFor(video.id) }));
        };
        for (const att of attachments || []) {
            if (Y.isYouTubeAttachment(att) && att.type !== 'image') {
                push(Y.fromAttachment(att), att.name);
            } else if (att && att.kind === 'youtube') {
                out.push(att);
                seen.add(att.youtubeId);
            } else {
                out.push(att);
            }
        }
        for (const v of Y.extract(text)) {
            push(v);
        }
        return out;
    }

    function wrapPanel(panel) {
        if (!panel || panel.__nexusYtHooked) {
            return;
        }
        const origAppend = panel.appendMessage;
        const origRich = panel.appendRichMessage;
        if (typeof origRich === 'function') {
            panel.appendRichMessage = function nexusYtAppendRich(message) {
                try {
                    const m = message || {};
                    return origRich.call(this, { ...m, attachments: normaliseAttachments(m.text, m.attachments) });
                } catch {
                    return origRich.call(this, message);
                }
            };
        }
        if (typeof origAppend === 'function') {
            panel.appendMessage = function nexusYtAppend(role, text) {
                try {
                    const Y = YT();
                    if (Y && typeof this.appendRichMessage === 'function' && Y.extract(text).length) {
                        return this.appendRichMessage({ role, text });
                    }
                } catch {
                    /* fall through */
                }
                return origAppend.call(this, role, text);
            };
        }
        panel.__nexusYtHooked = true;
        state.unhooks.push(() => {
            panel.appendMessage = origAppend;
            panel.appendRichMessage = origRich;
            delete panel.__nexusYtHooked;
        });
    }

    /** What happens when a YouTube card is tapped in VR. */
    function route(att, { panel } = {}) {
        const comp = companion();
        const say = (t) => {
            try {
                if (panel && typeof panel.appendMessage === 'function') {
                    panel.appendMessage('bot', t);
                }
            } catch {
                /* cosmetic */
            }
        };
        if (comp && comp.isOpen()) {
            comp.navigate(att.youtubeId, att.start || 0);
            state.pending = null;
            say('▶ On the cinema screen.');
            return 'companion';
        }
        state.pending = att;
        say(
            'Saved — it will be in the chat when you take the headset off. Tap “Watch in VR” on a video before entering to play it here.'
        );
        return 'pending';
    }

    function wrapMediaPanel(media, panel) {
        if (!media || typeof media.show !== 'function' || media.__nexusYtHooked) {
            return;
        }
        const origShow = media.show;
        media.show = function nexusYtShow(att) {
            const r = origShow.call(this, att); // poster: the thumbnail, drawn by the existing panel
            try {
                if (att && att.kind === 'youtube' && YT() && YT().isId(att.youtubeId)) {
                    route(att, { panel });
                }
            } catch (err) {
                console.warn('[YouTube] VR routing skipped:', err);
            }
            return r;
        };
        media.__nexusYtHooked = true;
        state.unhooks.push(() => {
            media.show = origShow;
            delete media.__nexusYtHooked;
        });
    }

    /** After the session: hand a pick made in VR to the 2D chat, where it can actually play. */
    function flushPending() {
        const att = state.pending;
        state.pending = null;
        if (!att) {
            return false;
        }
        const Y = YT();
        const cm = typeof window !== 'undefined' ? window.ChatManager : null;
        if (!Y || !cm) {
            return false;
        }
        const a = Y.toAttachment({
            id: att.youtubeId,
            start: att.start || 0,
            name: att.name === 'YouTube video' ? '' : att.name,
        });
        if (typeof cm.addRichMessage === 'function') {
            cm.addRichMessage('The video you picked in VR:', 'bot', [a]);
        } else if (typeof cm.addMessage === 'function') {
            cm.addMessage(a.url, 'bot');
        }
        return true;
    }

    function attach(viewer) {
        const v = viewer || (typeof window !== 'undefined' ? window.NEXUS_VIEWER : null);
        if (!v || state.attached) {
            return false;
        }
        wrapPanel(v.vrChatPanel);
        wrapMediaPanel(v.vrMediaPanel || (typeof window !== 'undefined' ? window.VRMediaPanel : null), v.vrChatPanel);
        state.attached = true;
        return true;
    }

    function detach() {
        for (const fn of state.unhooks.splice(0)) {
            fn();
        }
        state.attached = false;
    }

    function init() {
        if (typeof window === 'undefined') {
            return;
        }
        window.addEventListener('vr-session-end', flushPending);
        const ready = window.__NEXUS_VIEWER_READY__;
        if (ready && typeof ready.then === 'function') {
            ready.then(() => attach());
        } else if (window.NEXUS_VIEWER) {
            attach();
        } else {
            window.addEventListener('vr-session-start', () => attach(), { once: true });
        }
    }

    if (typeof window !== 'undefined' && !window.__NEXUS_YT_VR_NOAUTO__) {
        init();
    }

    return { init, attach, detach, route, flushPending, normaliseAttachments, _state: state };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_YT_VR = YouTubeVRBridge;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = YouTubeVRBridge;
}
