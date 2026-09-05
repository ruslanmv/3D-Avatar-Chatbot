/**
 * The screenshot card (batch RS1).
 *
 * The picture is the answer, so the picture is the hero: a full-width still with a thin foot
 * under it carrying the three things a person actually needs — which computer, how long ago,
 * and one primary action. Everything else the feature knows (frame id, byte count, which
 * mechanism took it, the model that will read it) exists and stays out of the way.
 *
 * ## Freshness is stated, never faked
 *
 * A screenshot is one moment, not a feed. Nothing here refreshes on a timer, and the only
 * thing that ticks is the *label* — `Just now` becoming `18 sec ago` becoming `4 min ago` —
 * so the user always knows how old the thing they are looking at is. Refresh is a button
 * because taking a new picture is a decision, and a silent one would leave nobody able to
 * say which image the assistant just described.
 *
 * ## It expires in front of you
 *
 * The frame is deleted on the user's own machine when its ten minutes are up. The card
 * follows it: the image goes, the actions go, and the foot says so — which is better than an
 * `Ask about this` button that fails a full round trip after being pressed.
 *
 * Exposes: window.NEXUS_SCREEN_CARD
 */
const ScreenCard = (() => {
    'use strict';

    /** How often the age label is recomputed. Coarse on purpose — this is not a stopwatch. */
    const TICK_MS = 5000;

    function store() {
        return (typeof window !== 'undefined' && window.NEXUS_SCREEN_FRAMES) || null;
    }

    /**
     * "Just now" / "18 sec ago" / "4 min ago" / "1 h ago".
     *
     * Ten seconds of "Just now" rather than a live second counter: a number ticking under a
     * still image reads as a stream that is failing to update.
     */
    function freshness(ms) {
        const s = Math.max(0, Math.round(Number(ms) / 1000));
        if (s < 10) {
            return 'Just now';
        }
        if (s < 60) {
            return `${s} sec ago`;
        }
        const m = Math.round(s / 60);
        if (m < 60) {
            return `${m} min ago`;
        }
        const h = Math.floor(m / 60);
        return `${h} h ago`;
    }

    /** Where the pixels are analysed, in two words. Shown in the privacy detail, not on the card. */
    function analysisLabel(frame) {
        return frame && frame.analysis === 'remote' ? 'Remote' : 'On your computer';
    }

    function el(doc, tag, className, text) {
        const node = doc.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined && text !== null) {
            node.textContent = text;
        }
        return node;
    }

    // ── the lightbox ────────────────────────────────────────────────────────

    /**
     * Full-screen view of one frame. Click toggles 2× zoom around the point clicked; Escape
     * and the backdrop both close it.
     *
     * Built fresh each time and removed on close rather than kept hidden: it holds the same
     * object URL as the card, and a detached copy of somebody's desktop sitting in the DOM
     * after they closed it is exactly the thing this feature should not do.
     */
    function openLightbox(doc, src, caption) {
        const back = el(doc, 'div', 'nexus-screen-lightbox');
        back.setAttribute('role', 'dialog');
        back.setAttribute('aria-modal', 'true');
        back.setAttribute('aria-label', caption || 'Screenshot');

        const img = doc.createElement('img');
        img.className = 'nexus-screen-lightbox-img';
        img.alt = caption || 'Screenshot';
        img.src = src;

        const close = el(doc, 'button', 'nexus-screen-lightbox-close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close');

        const foot = el(doc, 'div', 'nexus-screen-lightbox-foot', caption || '');

        let zoomed = false;
        img.addEventListener('click', (e) => {
            zoomed = !zoomed;
            if (zoomed) {
                const box = img.getBoundingClientRect();
                const x = box.width ? ((e.clientX - box.left) / box.width) * 100 : 50;
                const y = box.height ? ((e.clientY - box.top) / box.height) * 100 : 50;
                img.style.transformOrigin = `${x}% ${y}%`;
            }
            img.classList.toggle('is-zoomed', zoomed);
        });

        const dismiss = () => {
            doc.removeEventListener('keydown', onKey, true);
            back.remove();
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                dismiss();
            }
        };
        back.addEventListener('click', (e) => {
            if (e.target === back || e.target === foot) {
                dismiss();
            }
        });
        close.addEventListener('click', dismiss);
        doc.addEventListener('keydown', onKey, true);

        back.appendChild(close);
        back.appendChild(img);
        back.appendChild(foot);
        doc.body.appendChild(back);
        try {
            close.focus();
        } catch (_) {
            // A document without focus support is still a working lightbox.
        }
        return { root: back, close: dismiss };
    }

    // ── the card ────────────────────────────────────────────────────────────

    /**
     * Build a card for one captured frame.
     *
     * @param {object} frame handle from the store
     * @param {object} opts
     * @param {Document} [opts.doc]
     * @param {string} [opts.src] object URL for the image; omitted renders the empty state
     * @param {function} [opts.onAsk] pressed "Ask about this"
     * @param {function} [opts.onRefresh] pressed "Refresh"
     * @param {function} [opts.now] injectable clock
     * @returns {HTMLElement} with `.destroy()` attached, which stops the tick
     */
    function build(frame, opts = {}) {
        const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
        if (!doc || !frame) {
            return null;
        }
        const clock = opts.now || Date.now;
        const frames = store();

        const card = el(doc, 'figure', 'nexus-screen-card');
        card.dataset.frameId = frame.frame_id;

        const shot = el(doc, 'button', 'nexus-screen-shot');
        shot.type = 'button';
        shot.setAttribute('aria-label', `Enlarge screenshot of ${frame.device || 'your computer'}`);

        if (opts.src) {
            const img = doc.createElement('img');
            img.alt = `Screenshot of ${frame.device || 'your computer'}`;
            img.decoding = 'async';
            img.src = opts.src;
            shot.appendChild(img);
            shot.addEventListener('click', () =>
                openLightbox(doc, opts.src, `${frame.device || 'Your computer'} · ${label()}`)
            );
        } else {
            // The image did not come back. Still a card, because the *capture* happened and
            // the assistant may still have something to say about it.
            shot.appendChild(el(doc, 'div', 'nexus-screen-missing', 'The image could not be loaded.'));
            shot.disabled = true;
        }

        const foot = el(doc, 'figcaption', 'nexus-screen-foot');
        const device = el(doc, 'span', 'nexus-screen-device', frame.device || 'Your computer');
        const age = el(doc, 'span', 'nexus-screen-age', '');
        const actions = el(doc, 'div', 'nexus-screen-actions');

        const ask = el(doc, 'button', 'nexus-screen-ask', 'Ask about this');
        ask.type = 'button';
        const refresh = el(doc, 'button', 'nexus-screen-refresh', 'Refresh');
        refresh.type = 'button';
        refresh.setAttribute('aria-label', 'Take a new screenshot');

        if (typeof opts.onAsk === 'function') {
            ask.addEventListener('click', () => opts.onAsk(frame));
        } else {
            ask.hidden = true;
        }
        if (typeof opts.onRefresh === 'function') {
            refresh.addEventListener('click', () => opts.onRefresh(frame));
        } else {
            refresh.hidden = true;
        }

        actions.appendChild(ask);
        actions.appendChild(refresh);
        foot.appendChild(device);
        foot.appendChild(age);
        foot.appendChild(actions);

        card.appendChild(shot);
        card.appendChild(foot);
        card.appendChild(privacyChip(doc, frame, clock));

        function label() {
            const ms = frames ? frames.ageOf(frames.get(frame.frame_id, clock()) || frame, clock()) : 0;
            return freshness(Number.isFinite(ms) ? ms : clock() - (frame.taken_at_local || clock()));
        }

        /** Recompute the age label, and retire the card once the frame is gone. */
        function tick() {
            const live = frames ? frames.get(frame.frame_id, clock()) : frame;
            if (!live) {
                card.classList.add('is-expired');
                age.textContent = 'Expired';
                ask.disabled = true;
                shot.disabled = true;
                const img = shot.querySelector('img');
                if (img) {
                    img.remove();
                    shot.appendChild(el(doc, 'div', 'nexus-screen-missing', 'This screenshot has expired.'));
                }
                stop();
                return;
            }
            age.textContent = freshness(frames ? frames.ageOf(live, clock()) : 0);
        }

        let timer = null;
        function stop() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        }
        tick();
        if (typeof setInterval === 'function' && opts.tick !== false) {
            timer = setInterval(tick, TICK_MS);
        }

        card.destroy = stop;
        card.refreshLabel = tick;
        return card;
    }

    /**
     * The one privacy affordance on the card: a quiet line, expanding to the facts.
     *
     * Collapsed by default because a security notice on every capture is a security notice
     * nobody reads. Present on every capture because a feature that photographs somebody's
     * desk should never be the one that says nothing about where the picture went.
     */
    function privacyChip(doc, frame, clock) {
        const wrap = el(doc, 'details', 'nexus-screen-privacy');
        const head = el(doc, 'summary', 'nexus-screen-privacy-head');
        head.textContent = `${frame.device || 'Your computer'} · remote capture allowed`;
        const body = el(doc, 'div', 'nexus-screen-privacy-body');

        const ttl = Number(frame.expires_in_s);
        const rows = [
            ['Taken on', frame.device || 'your computer'],
            ['Deleted in', Number.isFinite(ttl) ? `${Math.max(0, Math.round(ttl / 60))} min` : '10 min'],
            ['Analysis', analysisLabel(frame)],
            [
                'How',
                frame.mechanism === 'share'
                    ? 'From the screen you are sharing there'
                    : 'Taken directly on that computer',
            ],
        ];
        for (const [key, value] of rows) {
            const row = el(doc, 'div', 'nexus-screen-privacy-row');
            row.appendChild(el(doc, 'span', 'nexus-screen-privacy-key', key));
            row.appendChild(el(doc, 'span', 'nexus-screen-privacy-value', String(value)));
            body.appendChild(row);
        }
        wrap.appendChild(head);
        wrap.appendChild(body);
        void clock;
        return wrap;
    }

    return { build, freshness, openLightbox, analysisLabel, TICK_MS };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_SCREEN_CARD = ScreenCard;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScreenCard;
}
