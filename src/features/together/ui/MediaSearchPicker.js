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

        function draw(results) {
            list.textContent = '';
            const M = media();
            for (const result of results.slice(0, MAX_RESULTS)) {
                const row = el(doc, 'button', 'nexus-bd-together-result');
                row.type = 'button';
                row.dataset.mediaId = result.id;

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
                list.appendChild(row);
            }
        }

        async function run(query) {
            const q = String(query || '').trim();
            if (!q) {
                return { ok: false, why: 'empty' };
            }
            const reg = registry();
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
