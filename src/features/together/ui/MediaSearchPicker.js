/**
 * Choosing something to put on, inside Together (batch D3).
 *
 * A **picker**, and nothing more. No iframe, no player, no autoplay: four compact rows with a
 * thumbnail, a title and who made it. The moment one is chosen the panel closes and the media
 * becomes a message in the conversation, which is where it lives — see `ConversationPublisher`.
 *
 * ## What it will not do
 *
 * It does not search on mount, does not search an empty box, and does not start the activity.
 * Opening Watch must not cost a network request or a permission prompt, and typing "lofi" is
 * not a decision to share your screen.
 *
 * ## Stale results
 *
 * A slow query A must never overwrite a fast query B. Every search carries an epoch and a
 * result older than the current one is dropped on arrival — which is cheaper than an
 * `AbortController` here and works the same in jsdom.
 *
 * ## Every state is a sentence
 *
 * Idle, searching, results, empty, unavailable, not-connected. Never a status code, never a
 * quota payload, never `undefined`. Not-connected gets a button rather than an instruction,
 * for the same reason the chat stopped printing `localStorage.setItem`.
 *
 * Exposes: window.NEXUS_MEDIA_PICKER
 */
const MediaSearchPicker = (() => {
    'use strict';

    /** Enough to choose from, few enough to read without scrolling the panel. */
    const MAX_RESULTS = 4;

    function registry() {
        return (typeof window !== 'undefined' && window.NEXUS_DISCOVERY) || null;
    }
    function media() {
        return (typeof window !== 'undefined' && window.NEXUS_MEDIA_RESULT) || null;
    }
    function samples() {
        return typeof window !== 'undefined' ? window.NEXUS_DISCOVERY_SAMPLES : null;
    }

    function settings() {
        return (typeof window !== 'undefined' && window.NEXUS_YT_SETTINGS) || null;
    }

    function el(doc, tag, className, text) {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    /**
     * Build the picker for one media kind.
     *
     * @param {object} opts
     * @param {Document} opts.doc
     * @param {string} [opts.mediaKind] `video` (default) or `music`
     * @param {string} [opts.capability] defaults from `mediaKind`
     * @param {string} [opts.placeholder]
     * @param {function} opts.onChoose called with the chosen `MediaResult`
     * @param {function} [opts.onPlay] called with a `MediaResult` to start now. Absent, no ▶
     *   button is drawn at all — a control that cannot do anything is worse than no control.
     * @param {function} [opts.onSetup] pressed the connect button
     * @param {function} [opts.search] injected for tests
     * @returns {HTMLElement} the whole block, with `.focusInput()` attached
     */
    function build(opts = {}) {
        const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
        if (!doc) {
            return null;
        }
        const mediaKind = opts.mediaKind === 'music' ? 'music' : 'video';
        const capability = opts.capability || (mediaKind === 'music' ? 'music.search' : 'video.search');
        const noun = mediaKind === 'music' ? 'music' : 'videos';

        const root = el(doc, 'div', 'nexus-bd-together-search');
        if (mediaKind === 'music') {
            // D5. One component, one modifier. A track is a title and an artist against a
            // square sleeve; a video is a title and a channel against a 16:9 still. Two
            // components for that difference would be two places to fix the next bug.
            root.classList.add('is-music');
        }

        const form = el(doc, 'form', 'nexus-bd-together-searchform');
        // A form, so Enter submits without a keydown handler and the browser's own
        // "this is a search" affordances apply.
        form.setAttribute('role', 'search');
        const input = doc.createElement('input');
        input.type = 'search';
        input.className = 'nexus-bd-together-searchinput';
        input.placeholder = opts.placeholder || `Search ${noun}…`;
        input.setAttribute('aria-label', `Search ${noun}`);
        const go = el(doc, 'button', 'nexus-bd-together-searchgo', '🔎');
        go.type = 'submit';
        go.setAttribute('aria-label', `Search ${noun}`);
        form.appendChild(input);
        form.appendChild(go);
        root.appendChild(form);

        const status = el(doc, 'p', 'nexus-bd-together-searchstatus', '');
        // Announced, because the interesting states — searching, nothing found, unavailable —
        // are all changes to text that nobody's cursor is near.
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        root.appendChild(status);

        const list = el(doc, 'div', 'nexus-bd-together-results');
        root.appendChild(list);

        // D5. Said once, quietly, and only where it is true. YouTube plays in a cross-origin
        // iframe, so its audio cannot reach the analyser the beat detector reads — she will
        // not dance to it. Without this line that reads as dancing being broken; with it, the
        // local-audio option below is visibly the one that does more, rather than the older
        // one nobody has got round to removing.
        if (opts.note) {
            root.appendChild(el(doc, 'p', 'nexus-bd-together-searchnote', opts.note));
        }

        let epoch = 0;

        function say(text, tone) {
            status.textContent = text || '';
            status.dataset.tone = tone || '';
        }

        /** The connect button, for the one state where a person can fix it themselves. */
        function offerSetup() {
            const btn = el(doc, 'button', 'nexus-bd-together-connect', 'Set up YouTube');
            btn.type = 'button';
            btn.addEventListener('click', () => {
                if (typeof opts.onSetup === 'function') {
                    opts.onSetup();
                    return;
                }
                const set = settings();
                if (set && typeof set.openSettings === 'function') {
                    set.openSettings(doc);
                }
            });
            list.appendChild(btn);
        }

        /**
         * The examples, under their own heading, when there is no search to do.
         *
         * The heading is not decoration. These are not results — nobody searched for them — and
         * presenting them as matches for whatever was typed would be a lie the user cannot
         * detect. `draw` marks each row `data-sample` so the distinction survives in the DOM,
         * where a test can hold it.
         */
        function offerSamples() {
            const bank = samples();
            const picks = bank && typeof bank.forCapability === 'function' ? bank.forCapability(capability) : [];
            if (!picks.length) {
                return 0;
            }
            list.appendChild(el(doc, 'p', 'nexus-bd-together-samplehead', 'Or try one of these — no setup needed'));
            draw(picks, { append: true });
            return picks.length;
        }

        function draw(results, drawOpts) {
            if (!drawOpts || !drawOpts.append) {
                list.textContent = '';
            }
            const M = media();
            for (const result of results.slice(0, MAX_RESULTS)) {
                const row = el(doc, 'button', 'nexus-bd-together-result');
                row.type = 'button';
                row.dataset.mediaId = result.id;
                if (result.sample) {
                    // Kept in the DOM so "this was an example, not a match" is checkable rather
                    // than a matter of where it happened to be rendered.
                    row.dataset.sample = 'true';
                }

                const thumb = el(doc, 'span', 'nexus-bd-together-resultthumb');
                if (result.thumbnail) {
                    const img = doc.createElement('img');
                    img.alt = '';
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    img.src = result.thumbnail;
                    thumb.appendChild(img);
                }
                const body = el(doc, 'span', 'nexus-bd-together-resultmeta');
                body.appendChild(el(doc, 'span', 'nexus-bd-together-resulttitle', result.title || 'Untitled'));
                const by = [result.creator, M ? M.clock(result.duration) : ''].filter(Boolean).join(' · ');
                body.appendChild(el(doc, 'span', 'nexus-bd-together-resultby', by));

                row.appendChild(thumb);
                row.appendChild(body);
                row.setAttribute(
                    'aria-label',
                    `${result.title || 'Untitled'}${result.creator ? `, ${result.creator}` : ''}`
                );
                row.addEventListener('click', () => {
                    if (typeof opts.onChoose === 'function') {
                        opts.onChoose(result);
                    }
                });

                // M3. Two meanings for one row, which is what the old design was missing:
                // the row *chooses* (publishes the card, as it always has), and ▶ Play says
                // start it now. Before this, choosing was the only verb the panel had, and
                // "Playing…" appeared on a card that had never played anything.
                //
                // A sibling rather than a child: the row is a <button>, and a button inside a
                // button is invalid HTML that browsers resolve by dropping one of them. The
                // wrapper carries the flex row, so every existing rule on
                // `.nexus-bd-together-result` still applies to the same element it always did.
                const wrap = el(doc, 'div', 'nexus-bd-together-resultrow');
                wrap.appendChild(row);
                if (typeof opts.onPlay === 'function') {
                    const play = el(doc, 'button', 'nexus-bd-together-play', '▶');
                    play.type = 'button';
                    play.title = 'Play now';
                    play.setAttribute(
                        'aria-label',
                        `Play ${result.title || 'this'}${result.creator ? ` by ${result.creator}` : ''} now`
                    );
                    play.dataset.mediaId = result.id;
                    play.addEventListener('click', (event) => {
                        // The row behind it must not also fire: choosing and playing are
                        // different requests, and doing both would publish two cards.
                        event.stopPropagation();
                        opts.onPlay(result);
                    });
                    wrap.appendChild(play);
                }
                list.appendChild(wrap);
            }
        }

        async function run(query) {
            const q = String(query || '').trim();
            if (!q) {
                return { ok: false, why: 'empty' };
            }
            const reg = registry();
            // D13. A provider may still be finding out whether this deployment holds a key.
            // `forCapability` is synchronous, so the async path waits here once — otherwise a
            // site that searches perfectly well would report "not connected" on first open and
            // work on the second, which reads as flakiness rather than a probe.
            if (reg && typeof reg.warm === 'function') {
                await reg.warm();
            }
            const provider = reg ? reg.forCapability(capability) : null;
            if (!provider) {
                list.textContent = '';
                const reason = reg ? reg.why(capability) : 'no-provider';
                if (reason === 'no-key') {
                    say("YouTube search isn't connected.", 'weak');
                    offerSetup();
                } else {
                    say(`Searching for ${noun} isn't available right now.`, 'weak');
                }
                // A product that cannot be tried until it is configured mostly does not get
                // tried. Playback needs no key — only search does — so a handful of fixed
                // examples make the feature work on a fresh deployment, in one tap, through
                // exactly the same code path a real result takes.
                offerSamples();
                return { ok: false, why: reason };
            }

            const mine = ++epoch;
            say(`Searching ${noun}…`);
            let results = [];
            try {
                results = await (opts.search || provider.search)(q, { max: MAX_RESULTS, kind: mediaKind });
            } catch (_) {
                results = null;
            }
            if (mine !== epoch) {
                // A slower earlier query finishing after a newer one. Dropping it is the
                // whole of the fix; overwriting would show answers to a question the user
                // has already moved on from.
                return { ok: false, why: 'stale' };
            }
            if (results === null) {
                list.textContent = '';
                say(`${mediaKind === 'music' ? 'Music' : 'Video'} search is unavailable right now.`, 'weak');
                return { ok: false, why: 'failed' };
            }
            if (!results.length) {
                list.textContent = '';
                say(`Nothing found for “${q}”.`, 'weak');
                return { ok: true, why: 'empty', count: 0 };
            }
            const shown = results.slice(0, MAX_RESULTS);
            say(`${shown.length} result${shown.length === 1 ? '' : 's'}`);
            draw(shown);
            return { ok: true, why: 'results', count: shown.length };
        }

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            void run(input.value);
        });

        root.search = run;
        root.focusInput = () => {
            try {
                input.focus();
            } catch (_) {
                // Focusing is a courtesy.
            }
        };
        return root;
    }

    return { build, MAX_RESULTS };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_MEDIA_PICKER = MediaSearchPicker;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MediaSearchPicker;
}
