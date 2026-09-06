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
    /** How long the skeleton waits before admitting no picture is coming. */
    const THUMB_TIMEOUT_MS = 6000;
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

    /**
     * How long the app will wait for the player to say anything before admitting it does not
     * know.
     *
     * Longer than the adapter's own blocked timer, because this is the backstop for the case
     * where the adapter never attached at all — and it ends in `unconfirmed`, not `blocked`,
     * because not hearing a player is not the same as watching one refuse.
     */
    const UNCONFIRMED_MS = 9000;

    /** Swap the facade for the real player. Only one card plays at a time. */
    function activate(card, video) {
        const Y = YT();
        const doc = card.ownerDocument;
        if (state.active && state.active !== card) {
            deactivate(state.active);
        }
        const frame = doc.createElement('iframe');
        frame.className = 'nexus-yt-player';
        // M2. `jsapi` is what lets the IFrame API attach below and tell us what the player is
        // really doing. Without it this function could only ever report that it *asked* for
        // playback, which is the assumption this batch exists to remove.
        frame.src = Y.embedUrl(video.id, {
            start: video.start,
            autoplay: true,
            origin: pageOrigin(),
            jsapi: true,
        });
        frame.title = card.dataset.title || 'YouTube video player';
        frame.setAttribute(
            'allow',
            'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
        );
        frame.setAttribute('allowfullscreen', '');
        frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        frame.setAttribute('loading', 'eager');
        // The card never disappears because playback failed: it says so and keeps the link.
        frame.addEventListener('error', () => {
            card.classList.add('is-error');
            const status = card.querySelector('.nexus-yt-status');
            if (status) {
                status.textContent = "This video couldn't load. Open it on YouTube instead.";
            }
        });

        const facade = card.querySelector('.nexus-yt-facade');
        if (facade) {
            facade.replaceWith(frame);
        }

        // Expanding was the user's decision, so collapsing has to be one too.
        const stage = card.querySelector('.nexus-yt-stage');
        if (stage && !stage.querySelector('.nexus-yt-collapse')) {
            const back = el(doc, 'button', 'nexus-yt-collapse', '×');
            back.type = 'button';
            back.title = 'Back to the preview';
            back.setAttribute('aria-label', 'Collapse this video back to its preview');
            back.addEventListener('click', (e) => {
                e.stopPropagation();
                deactivate(card);
            });
            stage.appendChild(back);
        }

        card.classList.add('is-playing');
        state.active = card;

        // M1/M2. Tapping a card is a choice, and it is the moment the app stops guessing what
        // the user is doing. `requestPlay` is deliberately not `markPlaying`: nothing has
        // confirmed anything yet, and the browser may still refuse to make noise.
        const session = typeof window !== 'undefined' ? window.NEXUS_MEDIA_SESSION : null;
        if (session && typeof session.requestPlay === 'function') {
            try {
                // A card built from a bare URL has no title — the link carried none. But the
                // app very often knows one anyway, because the publisher put the card there
                // from a real search result. Preferring what is already known keeps "what am
                // I listening to?" answerable for a card the user tapped rather than chose.
                const known =
                    (typeof session.current === 'function' && session.current()) ||
                    (window.NEXUS_CURRENT_MEDIA &&
                        typeof window.NEXUS_CURRENT_MEDIA.get === 'function' &&
                        window.NEXUS_CURRENT_MEDIA.get()) ||
                    null;
                const same = known && known.id === video.id ? known : null;
                session.requestPlay(
                    {
                        id: video.id,
                        provider: 'youtube',
                        kind: (same && same.kind) || card.dataset.kind || 'video',
                        title: card.dataset.title || (same && same.title) || '',
                        creator: (same && same.creator) || card.dataset.creator || '',
                        url: `https://www.youtube.com/watch?v=${video.id}`,
                    },
                    { source: 'card' }
                );
            } catch (_) {
                // Knowing what is playing is never worth losing the playback over.
            }
        }

        // Then listen for what actually happens. Every failure path here degrades to the
        // behaviour this card had before the adapter existed: it plays, and the app goes back
        // to not knowing. Nothing in here may be the reason a video does not start.
        // If nothing ever reports back — the API script blocked, an old browser, a network
        // that will not serve youtube.com — the session would otherwise sit at `loading`
        // forever, and the prompt would keep saying "asked, not confirmed yet" for the rest of
        // the session. Silence for this long is indistinguishable from a refusal, and saying
        // "tap Play" is the right answer to both.
        if (session && typeof session.status === 'function' && typeof window.setTimeout === 'function') {
            window.setTimeout(() => {
                try {
                    if (state.active === card && session.status() === 'loading') {
                        // `markUnconfirmed`, not `markBlocked`. Nothing here observed a
                        // refusal — the player simply never spoke, which happens when the
                        // IFrame API cannot load at all. Calling that "blocked" told a user
                        // their music had not started while it was playing.
                        session.markUnconfirmed();
                    }
                } catch (_) {
                    /* nothing to do about it either way */
                }
            }, UNCONFIRMED_MS);
        }

        const playback = typeof window !== 'undefined' ? window.NEXUS_YT_PLAYBACK : null;
        if (playback && typeof playback.attach === 'function') {
            try {
                Promise.resolve(playback.attach(frame))
                    .then((handle) => {
                        if (!handle) {
                            return;
                        }
                        // A card that was replaced while the API was loading must not leave a
                        // player reporting state for a video nobody is watching.
                        if (state.active !== card) {
                            handle.stop();
                            return;
                        }
                        card._nexusPlayback = handle;
                    })
                    .catch(() => null);
            } catch (_) {
                /* no observation, same playback */
            }
        }
    }

    /**
     * Stop, pause or resume whatever is playing (batch M5).
     *
     * Until now the only way to stop a video was to find the × on the card, which is fine
     * with a mouse and useless to somebody who has just said "stop the music" out loud. The
     * player handle has been sitting on the card since M2; this is the door to it.
     *
     * Two routes, and the order matters. The IFrame API handle is preferred because it stops
     * the audio and leaves the card where it is — the user asked for silence, not for the
     * thing to vanish. Collapsing back to the thumbnail is the fallback for a player the API
     * never attached to, which is the same situation `unconfirmed` describes: it is cruder,
     * it loses the position, and it is much better than being unable to stop a noise.
     *
     * Returns whether anything was actually done, so a caller can say "nothing is playing"
     * rather than claiming to have stopped something that was not.
     */
    function control(action) {
        const card = state.active;
        if (!card) {
            return false;
        }
        const handle = card._nexusPlayback;
        if (handle) {
            if (action === 'pause' && typeof handle.pause === 'function') {
                return Boolean(handle.pause());
            }
            if (action === 'resume' && typeof handle.resume === 'function') {
                return Boolean(handle.resume());
            }
            if (action === 'stop' && typeof handle.stopVideo === 'function' && handle.stopVideo()) {
                // The card stays. They asked for it to stop, not to disappear.
                const session = typeof window !== 'undefined' ? window.NEXUS_MEDIA_SESSION : null;
                if (session && typeof session.stop === 'function') {
                    try {
                        session.stop();
                    } catch (_) {
                        /* stopped either way */
                    }
                }
                return true;
            }
        }
        if (action === 'stop') {
            // No handle to talk to. Collapsing the player is the blunt instrument that
            // definitely silences it, and silence is what was asked for.
            deactivate(card);
            return true;
        }
        return false;
    }

    /** Back to the facade (used when another card starts). */
    function deactivate(card) {
        // Let go of the player first: destroying the iframe out from under a live listener is
        // how a state change arrives for a video that is no longer on screen.
        if (card._nexusPlayback) {
            try {
                card._nexusPlayback.stop();
            } catch (_) {
                /* already gone */
            }
            card._nexusPlayback = null;
        }
        // The choice survives, the playback does not. `stop()` keeps `current` so "what did we
        // just listen to?" still has an answer; only an explicit clear takes that away.
        const session = typeof window !== 'undefined' ? window.NEXUS_MEDIA_SESSION : null;
        if (session && typeof session.stop === 'function') {
            try {
                const now = typeof session.current === 'function' ? session.current() : null;
                if (now && card.dataset.ytId && now.id === card.dataset.ytId) {
                    session.stop();
                }
            } catch (_) {
                /* not worth failing a collapse over */
            }
        }
        const frame = card.querySelector('.nexus-yt-player');
        if (frame && card._nexusFacade) {
            frame.replaceWith(card._nexusFacade);
        }
        const back = card.querySelector('.nexus-yt-collapse');
        if (back) {
            back.remove();
        }
        card.classList.remove('is-playing');
        card.classList.remove('is-error');
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
        // Three settled states, and the box is the same size in all of them:
        //   pending  the skeleton, while the image is on its way
        //   ready    the image, faded in
        //   none     a labelled placeholder — never an unexplained black rectangle
        img.onload = () => {
            card.dataset.thumb = 'ready';
        };
        // A request that *hangs* fires neither event, and the skeleton would shimmer for the
        // life of the page. Found by running it on a network with no route to i.ytimg.com —
        // a shimmer promises something is coming, so it has to be able to give up.
        if (typeof setTimeout === 'function') {
            setTimeout(() => {
                if (card.dataset.thumb === 'pending') {
                    card.dataset.thumb = 'none';
                }
            }, THUMB_TIMEOUT_MS);
        }
        img.onerror = () => {
            const next = thumbFallbacks[Number(img.dataset.fallback || 0)];
            if (!next) {
                card.dataset.thumb = 'none';
                return;
            }
            img.dataset.fallback = String(Number(img.dataset.fallback || 0) + 1);
            img.src = next();
        };
        const play = el(doc, 'span', 'nexus-yt-play');
        play.setAttribute('aria-hidden', 'true');
        const placeholder = el(doc, 'span', 'nexus-yt-placeholder');
        placeholder.appendChild(play.cloneNode(true));
        placeholder.appendChild(el(doc, 'span', '', 'Video preview'));
        btn.appendChild(img);
        btn.appendChild(play);
        btn.appendChild(placeholder);
        btn.addEventListener('pointerenter', () => preconnect(doc), { once: true });
        btn.addEventListener('focus', () => preconnect(doc), { once: true });
        btn.addEventListener('click', () => activate(card, video));
        card._nexusFacade = btn;
        return btn;
    }

    /**
     * One card for one video. Pure DOM; safe to call from tests with a jsdom document.
     */
    /**
     * One video, compact (YT-7).
     *
     * The rest state is a thumbnail, a play glyph and two lines of text — roughly the height
     * of a normal message. The player is what a *click* buys, not what a recommendation
     * costs. Two recommendations used to be two full-width players stacked inside a coloured
     * bubble, which turned a minor answer into a media catalogue and pushed the messages
     * either side of it off the screen.
     *
     * The action hierarchy follows from that: **the thumbnail is Play**, and everything else
     * is smaller. `YouTube ↗` opens the source; `•••` holds Watch in VR, Copy link and Open
     * externally. VR leaves the menu and becomes a button only where VR is the actual
     * context — an exceptional path should not carry the weight of the ordinary one.
     */
    function buildCard(video, { doc } = {}) {
        const d = doc || document;
        const card = el(d, 'div', 'nexus-yt-card');
        card.dataset.ytId = video.id;
        if (video.name) {
            card.dataset.title = video.name;
        }
        // The 16:9 box is reserved from this moment. `pending` becomes `ready` or `none`, and
        // in every case the card's height is the height it will keep — a thumbnail that
        // arrives and *then* makes room is how a conversation jumps under a reader.
        card.dataset.thumb = 'pending';

        const stage = el(d, 'div', 'nexus-yt-stage');
        stage.appendChild(buildFacade(d, video, card));
        card.appendChild(stage);

        const meta = el(d, 'div', 'nexus-yt-meta');
        const title = el(d, 'div', 'nexus-yt-title', video.name || 'YouTube');
        // "Rick Astley · YouTube" — the source is worth naming when the title is not enough.
        const author = el(d, 'div', 'nexus-yt-author', video.author ? `${video.author} · YouTube` : 'YouTube');
        const actions = el(d, 'div', 'nexus-yt-actions');

        const open = el(d, 'a', 'nexus-yt-open', 'YouTube ↗');
        open.href = YT().watchUrl(video.id, video.start);
        open.target = '_blank';
        open.rel = 'noopener noreferrer';
        open.title = 'Open this video on YouTube';
        actions.appendChild(open);

        const status = el(d, 'div', 'nexus-yt-status', '');
        const comp = companion();
        const xrCapable = typeof navigator !== 'undefined' && Boolean(navigator.xr);

        /** Open the companion tab and hand it to Watch. Shared by the menu and the button. */
        const watchInVr = async (trigger) => {
            if (trigger) {
                trigger.disabled = true;
            }
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
            if (trigger) {
                trigger.disabled = false;
            }
        };

        // VR is promoted only when VR is the context the user is actually in.
        if (comp && xrCapable && vrContextActive()) {
            const vr = el(d, 'button', 'nexus-yt-vr', 'Watch in VR');
            vr.type = 'button';
            vr.addEventListener('click', () => void watchInVr(vr));
            actions.appendChild(vr);
        }

        actions.appendChild(buildMenu(d, video, { comp, xrCapable, watchInVr, status }));

        meta.appendChild(title);
        meta.appendChild(author);
        meta.appendChild(actions);
        meta.appendChild(status);
        card.appendChild(meta);

        const Y = YT();
        if (!video.name && Y && Y.oembed) {
            Y.oembed(video.id).then((info) => {
                if (!info) {
                    return;
                }
                title.textContent = info.title;
                author.textContent = `${info.author} · YouTube`;
                card.dataset.title = info.title;
                const b = card.querySelector('.nexus-yt-facade');
                if (b) {
                    b.setAttribute('aria-label', `Play: ${info.title}`);
                }
            });
        }
        if (video.duration) {
            setDuration(card, video.duration);
        }
        return card;
    }

    /** `3:33` in the corner, when the duration is known. Never invented. */
    function setDuration(card, seconds) {
        const n = Number(seconds);
        if (!Number.isFinite(n) || n <= 0) {
            return;
        }
        const facade = card.querySelector('.nexus-yt-facade');
        if (!facade || facade.querySelector('.nexus-yt-duration')) {
            return;
        }
        const h = Math.floor(n / 3600);
        const m = Math.floor((n % 3600) / 60);
        const sec = Math.floor(n % 60);
        const pad = (v) => String(v).padStart(2, '0');
        const chip = el(
            card.ownerDocument,
            'span',
            'nexus-yt-duration',
            h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
        );
        facade.appendChild(chip);
    }

    /**
     * Whether VR is the context right now, rather than merely possible.
     *
     * A headset-capable browser is not a person wearing one. `navigator.xr` says the machine
     * could; an active session, or the launcher reporting one, says the person is.
     */
    function vrContextActive() {
        if (typeof window === 'undefined') {
            return false;
        }
        const cfg = (window.NEXUS_YT_CONFIG || {}).vrActive;
        if (typeof cfg === 'boolean') {
            return cfg;
        }
        const bd = window.NEXUS_BD;
        if (bd && bd.xr && typeof bd.xr.isPresenting === 'boolean') {
            return bd.xr.isPresenting;
        }
        const renderer = window.__NEXUS_RENDERER__ || (window.NEXUS && window.NEXUS.renderer);
        return Boolean(renderer && renderer.xr && renderer.xr.isPresenting);
    }

    /** The `•••` menu: everything that is not Play and not the source link. */
    function buildMenu(d, video, { comp, xrCapable, watchInVr, status }) {
        const wrap = el(d, 'div', 'nexus-yt-menu');
        const trigger = el(d, 'button', 'nexus-yt-more', '•••');
        trigger.type = 'button';
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', 'More actions for this video');
        trigger.title = 'More';
        wrap.appendChild(trigger);

        let sheet = null;
        const close = () => {
            if (sheet) {
                sheet.remove();
                sheet = null;
            }
            trigger.setAttribute('aria-expanded', 'false');
            d.removeEventListener('mousedown', onDown, true);
            d.removeEventListener('keydown', onKey, true);
        };
        const onDown = (e) => {
            if (!wrap.contains(e.target)) {
                close();
            }
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                close();
            }
        };
        const item = (label, fn) => {
            const b = el(d, 'button', '', label);
            b.type = 'button';
            b.setAttribute('role', 'menuitem');
            b.addEventListener('click', () => {
                close();
                fn(b);
            });
            return b;
        };

        trigger.addEventListener('click', () => {
            if (sheet) {
                close();
                return;
            }
            sheet = el(d, 'div', 'nexus-yt-sheet');
            sheet.setAttribute('role', 'menu');
            if (comp && xrCapable && !vrContextActive()) {
                sheet.appendChild(item('Watch in VR', (b) => void watchInVr(b)));
            }
            sheet.appendChild(
                item('Copy link', () => {
                    const url = YT().watchUrl(video.id, video.start);
                    const nav = typeof navigator !== 'undefined' ? navigator : null;
                    if (nav && nav.clipboard && nav.clipboard.writeText) {
                        nav.clipboard.writeText(url).then(
                            () => {
                                status.textContent = 'Link copied.';
                            },
                            () => {
                                status.textContent = url;
                            }
                        );
                    } else {
                        // No clipboard permission is not a dead end — show the link to copy.
                        status.textContent = url;
                    }
                })
            );
            sheet.appendChild(
                item('Open externally', () => {
                    const url = YT().watchUrl(video.id, video.start);
                    if (typeof window !== 'undefined' && window.open) {
                        window.open(url, '_blank', 'noopener');
                    }
                })
            );
            wrap.appendChild(sheet);
            trigger.setAttribute('aria-expanded', 'true');
            d.addEventListener('mousedown', onDown, true);
            d.addEventListener('keydown', onKey, true);
        });

        return wrap;
    }

    /** Append cards to an already-built message element. Returns the number added. */
    function decorate(messageEl, message) {
        const videos = videosFor(message);
        if (!videos.length || !messageEl) {
            return 0;
        }
        const host = messageEl.querySelector('.message-content') || messageEl;
        const doc = messageEl.ownerDocument;
        // Two recommendations used to be two full-width players stacked down the thread. A
        // group lays them side by side on a desktop pane and swipes on a phone, so an answer
        // costs about a message and only the one somebody picks becomes a player.
        const parent = videos.length > 1 ? el(doc, 'div', 'nexus-yt-group') : host;
        for (const v of videos) {
            parent.appendChild(buildCard(v, { doc }));
        }
        if (parent !== host) {
            host.appendChild(parent);
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
        control,
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
