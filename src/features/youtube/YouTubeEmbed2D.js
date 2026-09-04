/**
 * YouTubeEmbed2D — inline YouTube in the 2D chat, done the way the fast sites do it (batch YT-3).
 *
 * ## The facade pattern
 *
 * A live YouTube iframe costs ~500 KB of script and a dozen requests before anyone presses
 * play. So a message with a link gets a *facade*: the real thumbnail, a play button, the
 * title from oEmbed — and only on click does it swap in the actual player
 * (`youtube-nocookie.com`, `autoplay=1`, so one tap is one tap). Hovering pre-connects to the
 * player origins so the swap feels instant. This is the lite-youtube-embed approach that
 * web.dev recommends, hand-rolled here because the app has no bundler and one dependency
 * fewer is one supply chain fewer.
 *
 * ## Non-destructive by construction
 *
 * Nothing in `js/chat-manager.js` changes. This wraps `ChatManager.createMessageElement`
 * on the singleton: the original builds the bubble exactly as before, then this appends
 * cards *under* it for every YouTube link in the text or `youtube` attachment on the
 * message. History restored from localStorage goes through the same method, so old links
 * get cards too. If anything here throws, the original element is returned untouched.
 *
 * Delete the script tag and the chat is byte-for-byte what it was.
 *
 * ## `/yt <query>`
 *
 * When a Data API key is configured, typing `/yt lofi` in the chat box searches YouTube
 * and posts the results as cards without a round trip to the LLM. The command is caught in
 * the capture phase on the input and the send button, so `js/main.js` never sees it. With
 * no key, the command explains how to add one and otherwise does nothing.
 *
 * Exposes: window.NEXUS_YT_2D
 */
const YouTubeEmbed2D = (() => {
    'use strict';

    const CSS_HREF = 'src/features/youtube/youtube.css';
    const MAX_CARDS_PER_MESSAGE = 3;
    const PRECONNECT = ['https://www.youtube-nocookie.com', 'https://www.google.com', 'https://i.ytimg.com'];

    const state = { hooked: false, observing: false, preconnected: false, active: null, doc: null };

    function YT() {
        return (typeof window !== 'undefined' && window.NEXUS_YT) || null;
    }
    /** Optional page config, the same object `YouTubeVRBridge` reads. */
    function cfg() {
        return (typeof window !== 'undefined' && window.NEXUS_YT_CONFIG) || {};
    }
    function companion() {
        return (typeof window !== 'undefined' && window.NEXUS_YT_COMPANION) || null;
    }

    function ensureCss(doc) {
        if (!doc || doc.querySelector(`link[href="${CSS_HREF}"]`)) {
            return;
        }
        const l = doc.createElement('link');
        l.rel = 'stylesheet';
        l.href = CSS_HREF;
        doc.head.appendChild(l);
    }

    function preconnect(doc) {
        if (state.preconnected || !doc) {
            return;
        }
        state.preconnected = true;
        for (const href of PRECONNECT) {
            const l = doc.createElement('link');
            l.rel = 'preconnect';
            l.href = href;
            l.crossOrigin = 'anonymous';
            doc.head.appendChild(l);
        }
    }

    function el(doc, tag, className, text) {
        const n = doc.createElement(tag);
        if (className) {
            n.className = className;
        }
        if (text !== null && text !== undefined) {
            n.textContent = text;
        }
        return n;
    }

    /** Videos referenced by a message: text links first, then attachments, deduped. */
    function videosFor(message) {
        const Y = YT();
        if (!Y || !message) {
            return [];
        }
        const out = [];
        const seen = new Set();
        const push = (v) => {
            if (v && !seen.has(v.id)) {
                seen.add(v.id);
                out.push(v);
            }
        };
        for (const v of Y.extract(message.content)) {
            push(v);
        }
        for (const att of message.attachments || []) {
            push(Y.fromAttachment(att));
        }
        return out.slice(0, MAX_CARDS_PER_MESSAGE);
    }

    function pageOrigin() {
        try {
            const o = window.location.origin;
            return /^https?:/.test(o) ? o : '';
        } catch {
            return '';
        }
    }

    /** Swap the facade for the real player. Only one card plays at a time. */
    function activate(card, video) {
        const Y = YT();
        const doc = card.ownerDocument;
        if (state.active && state.active !== card) {
            deactivate(state.active);
        }
        const frame = doc.createElement('iframe');
        frame.className = 'nexus-yt-player';
        frame.src = Y.embedUrl(video.id, { start: video.start, autoplay: true, origin: pageOrigin() });
        frame.title = card.dataset.title || 'YouTube video player';
        frame.setAttribute(
            'allow',
            'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
        );
        frame.setAttribute('allowfullscreen', '');
        frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        frame.setAttribute('loading', 'eager');
        const facade = card.querySelector('.nexus-yt-facade');
        if (facade) {
            facade.replaceWith(frame);
        }
        card.classList.add('is-playing');
        state.active = card;
    }

    /** Back to the facade (used when another card starts). */
    function deactivate(card) {
        const frame = card.querySelector('.nexus-yt-player');
        if (frame && card._nexusFacade) {
            frame.replaceWith(card._nexusFacade);
        }
        card.classList.remove('is-playing');
        if (state.active === card) {
            state.active = null;
        }
    }

    function buildFacade(doc, video, card) {
        const Y = YT();
        const btn = el(doc, 'button', 'nexus-yt-facade');
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Play video');
        const img = el(doc, 'img', 'nexus-yt-thumb');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = Y.thumbnail(video.id, 'hq');
        // hq → mq → the same-origin proxy. The third step is the one that matters on a
        // network that will not serve i.ytimg.com at all: `YouTubeVRBridge` already routes
        // VR thumbnails through `/api/yt/thumb/`, and there is no reason the 2D card should
        // give up where the VR card recovers. A card with no picture is still a working
        // card, so each step is a fallback and none is required.
        const thumbFallbacks = [
            () => Y.thumbnail(video.id, 'mq'),
            () => `${cfg().thumbProxy || '/api/yt/thumb/'}${video.id}`,
        ];
        img.onerror = () => {
            const next = thumbFallbacks[Number(img.dataset.fallback || 0)];
            if (!next) {
                return;
            }
            img.dataset.fallback = String(Number(img.dataset.fallback || 0) + 1);
            img.src = next();
        };
        const play = el(doc, 'span', 'nexus-yt-play');
        play.setAttribute('aria-hidden', 'true');
        btn.appendChild(img);
        btn.appendChild(play);
        btn.addEventListener('pointerenter', () => preconnect(doc), { once: true });
        btn.addEventListener('focus', () => preconnect(doc), { once: true });
        btn.addEventListener('click', () => activate(card, video));
        card._nexusFacade = btn;
        return btn;
    }

    /**
     * One card for one video. Pure DOM; safe to call from tests with a jsdom document.
     */
    function buildCard(video, { doc } = {}) {
        const Y = YT();
        const d = doc || document;
        const card = el(d, 'div', 'nexus-yt-card');
        card.dataset.ytId = video.id;
        if (video.name) {
            card.dataset.title = video.name;
        }

        card.appendChild(buildFacade(d, video, card));

        const meta = el(d, 'div', 'nexus-yt-meta');
        const title = el(d, 'div', 'nexus-yt-title', video.name || 'YouTube');
        const author = el(d, 'div', 'nexus-yt-author', video.author || '');
        const actions = el(d, 'div', 'nexus-yt-actions');

        const open = el(d, 'a', 'nexus-yt-open', 'Open on YouTube');
        open.href = Y.watchUrl(video.id, video.start);
        open.target = '_blank';
        open.rel = 'noopener noreferrer';
        actions.appendChild(open);

        const comp = companion();
        const xrCapable = typeof navigator !== 'undefined' && Boolean(navigator.xr);
        if (comp && xrCapable) {
            const vr = el(d, 'button', 'nexus-yt-vr', 'Watch in VR');
            vr.type = 'button';
            vr.title =
                'Opens this video in a companion tab and asks to share it, so it can play on the VR cinema screen';
            const status = el(d, 'div', 'nexus-yt-status', '');
            vr.addEventListener('click', async () => {
                vr.disabled = true;
                status.textContent = 'Opening a companion tab… pick it in the share dialog, then put the headset on.';
                const res = await comp.startParty(video.id, video.start);
                if (!res.companion) {
                    status.textContent =
                        'The browser blocked the companion tab. Allow pop-ups for this site and try again.';
                } else if (!res.watch) {
                    status.textContent = 'Companion tab is open. Share it from Together → Watch, then enter VR.';
                } else {
                    status.textContent =
                        'Sharing. Enter VR and it is on the cinema screen; later picks in VR reuse this tab.';
                }
                vr.disabled = false;
            });
            actions.appendChild(vr);
            meta.appendChild(title);
            meta.appendChild(author);
            meta.appendChild(actions);
            meta.appendChild(status);
        } else {
            meta.appendChild(title);
            meta.appendChild(author);
            meta.appendChild(actions);
        }
        card.appendChild(meta);

        if (!video.name && Y.oembed) {
            Y.oembed(video.id).then((info) => {
                if (!info) {
                    return;
                }
                title.textContent = info.title;
                author.textContent = info.author;
                card.dataset.title = info.title;
                const b = card.querySelector('.nexus-yt-facade');
                if (b) {
                    b.setAttribute('aria-label', `Play video: ${info.title}`);
                }
            });
        }
        return card;
    }

    /** Append cards to an already-built message element. Returns the number added. */
    function decorate(messageEl, message) {
        const videos = videosFor(message);
        if (!videos.length || !messageEl) {
            return 0;
        }
        const host = messageEl.querySelector('.message-content') || messageEl;
        const doc = messageEl.ownerDocument;
        for (const v of videos) {
            host.appendChild(buildCard(v, { doc }));
        }
        return videos.length;
    }

    /**
     * The ids the *shipped* `index.html` uses.
     *
     * `js/chat-manager.js` is referenced only by `index-old.html` and `index.backup.html`;
     * the live page has no `ChatManager` singleton and no `#chatMessages`. It builds
     * `.chat-row > .chat-message > .message-text` inline in `src/main.js` and appends it to
     * `#chat-history`. A hook on `ChatManager` alone therefore reaches nothing in the app
     * people actually load — which is what running it, rather than testing it, showed.
     *
     * So there are two attachments and both are optional: the hook for the old page, and an
     * observer for the current one. Neither knows about the other.
     */
    const LIVE = { history: 'chat-history', input: 'speech-text', send: 'speak-btn' };

    /** Marks a message we have already looked at, so a re-render cannot double a card. */
    const SEEN = 'data-nexus-yt-seen';

    /** Decorate one live `.chat-message`, reading the link out of its own text. */
    function decorateLive(node) {
        if (!node || node.nodeType !== 1 || node.hasAttribute(SEEN)) {
            return 0;
        }
        node.setAttribute(SEEN, '1');
        const text = node.querySelector('.message-text');
        if (!text) {
            return 0;
        }
        return decorate(node, { content: text.textContent || '' });
    }

    /**
     * Watch `#chat-history` for messages and give their links cards.
     *
     * A `MutationObserver` rather than a wrapper because the live renderer is four separate
     * inline functions in `src/main.js` — a streaming one, an error one, and two more — and
     * wrapping all four would be four edits to a file this feature promises not to touch.
     * It is also the idiom the repository already uses for this exact element: both
     * `AvatarAliveness` and `CompanionMode` observe `#chat-history` read-only.
     *
     * Streaming replies land empty and fill in token by token, so `characterData` is watched
     * too and the `SEEN` mark is cleared until a link appears — otherwise every bot reply
     * would be judged on its first empty frame.
     */
    function observeChatHistory(doc, { retryMs = 2000, retries = 5 } = {}) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d || typeof MutationObserver !== 'function') {
            return () => {};
        }
        const host = d.getElementById(LIVE.history);
        if (!host) {
            // The chat shell can mount after this script runs. Retry a bounded number of
            // times and then stop — a permanent interval looking for an element that is not
            // coming is a leak, not a feature.
            if (retries <= 0 || typeof setTimeout !== 'function') {
                return () => {};
            }
            let cancelled = false;
            const timer = setTimeout(() => {
                if (!cancelled) observeChatHistory(d, { retryMs, retries: retries - 1 });
            }, retryMs);
            return () => {
                cancelled = true;
                clearTimeout(timer);
            };
        }
        if (host.__nexusYtObserved) {
            return () => {};
        }

        const sweep = () => {
            for (const node of host.querySelectorAll('.chat-message')) {
                const text = node.querySelector('.message-text');
                // An empty streaming bubble is not "no link" — it is "not yet". Leave it
                // unmarked so the next mutation looks again.
                if (!text || !text.textContent.trim()) {
                    node.removeAttribute(SEEN);
                    continue;
                }
                try {
                    decorateLive(node);
                } catch (err) {
                    console.warn('[YouTube] card decoration skipped:', err);
                }
            }
        };

        const observer = new MutationObserver(sweep);
        observer.observe(host, { childList: true, subtree: true, characterData: true });
        host.__nexusYtObserved = true;
        state.observing = true;
        sweep(); // anything already on screen, including restored history

        return () => {
            observer.disconnect();
            delete host.__nexusYtObserved;
            state.observing = false;
        };
    }

    /** Wrap the singleton's `createMessageElement`. Idempotent; returns an unhook function. */
    function hookChatManager(cm) {
        const target = cm || (typeof window !== 'undefined' ? window.ChatManager : null);
        if (!target || typeof target.createMessageElement !== 'function' || target.__nexusYtHooked) {
            return () => {};
        }
        const original = target.createMessageElement;
        target.createMessageElement = function nexusYtCreateMessageElement(message) {
            const node = original.call(this, message);
            try {
                decorate(node, message);
            } catch (err) {
                console.warn('[YouTube] card decoration skipped:', err);
            }
            return node;
        };
        target.__nexusYtHooked = true;
        state.hooked = true;
        return () => {
            target.createMessageElement = original;
            delete target.__nexusYtHooked;
            state.hooked = false;
        };
    }

    // ── /yt command ────────────────────────────────────────────────────────

    const COMMAND_RE = /^\/(?:yt|youtube)\s+(.+)$/i;

    function parseCommand(text) {
        const m = COMMAND_RE.exec(String(text || '').trim());
        return m ? m[1].trim() : null;
    }

    async function runSearch(query) {
        const Y = YT();
        const comp = companion();
        const cm = window.ChatManager;
        if (!Y || !comp || !cm) {
            return false;
        }
        cm.addMessage(`/yt ${query}`, 'user');
        if (!comp.apiKey()) {
            cm.addMessage(
                'YouTube search needs a Data API key. Add one with ' +
                    `localStorage.setItem('${comp.KEY_STORAGE}', 'YOUR_KEY') and try again — or just paste a YouTube link.`,
                'bot'
            );
            return true;
        }
        const results = await comp.search(query);
        if (!results || !results.length) {
            cm.addMessage(`Nothing came back for “${query}”.`, 'bot');
            return true;
        }
        const attachments = results.map((r) => Y.toAttachment(r, { author: r.author }));
        if (typeof cm.addRichMessage === 'function') {
            cm.addRichMessage(`Here's what I found for “${query}”:`, 'bot', attachments);
        } else {
            cm.addMessage(attachments.map((a) => a.url).join('\n'), 'bot');
        }
        return true;
    }

    /**
     * Catch `/yt` before the app's own send handler does.
     *
     * Two id pairs, because the two pages disagree: `index-old.html` has
     * `#chatInput`/`#sendBtn`, and the shipped `index.html` has
     * `#speech-text`/`#speak-btn`. Whichever exists is used; on a page with neither, the
     * command is simply not available and nothing else changes.
     */
    function hookCommand(doc) {
        const d = doc || document;
        const input = d.getElementById('chatInput') || d.getElementById(LIVE.input);
        const send = d.getElementById('sendBtn') || d.getElementById(LIVE.send);
        if (!input) {
            return;
        }
        const intercept = (e) => {
            const q = parseCommand(input.value);
            if (!q) {
                return;
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            input.value = '';
            runSearch(q);
        };
        input.addEventListener(
            'keypress',
            (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    intercept(e);
                }
            },
            true
        );
        if (send) {
            send.addEventListener('click', intercept, true);
        }
    }

    function init(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) {
            return;
        }
        ensureCss(d);
        hookChatManager(); // index-old.html's ChatManager singleton, when there is one
        observeChatHistory(d); // the shipped index.html, which has neither
        hookCommand(d);
    }

    if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__NEXUS_YT_2D_NOAUTO__) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => init());
        } else {
            init();
        }
    }

    return {
        init,
        hookChatManager,
        observeChatHistory,
        decorateLive,
        LIVE,
        hookCommand,
        decorate,
        buildCard,
        videosFor,
        activate,
        deactivate,
        parseCommand,
        runSearch,
        MAX_CARDS_PER_MESSAGE,
        _state: state,
    };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_YT_2D = YouTubeEmbed2D;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = YouTubeEmbed2D;
}
