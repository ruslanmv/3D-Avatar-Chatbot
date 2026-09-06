/**
 * A short list in the chat, and nothing playing (batch M6).
 *
 *     YOU    search music about dance
 *     NEXUS  Playing “70s & 80s Party Classics!…”
 *
 * They asked to look. The app chose for them, and started it — which is not a smaller version
 * of what was asked for, it is the opposite of it, and it cannot be undone by the user saying
 * "no, the other one" because something is already making noise.
 *
 * So a request to find ends here: a sentence, then rows they can read and pick from.
 *
 * ## Why it borrows Together's row
 *
 * The panel already has a compact result row — thumbnail, title, creator, a ▶ cue — designed
 * for exactly this and already carrying the app's visual language. Building a second one for
 * the chat would mean two things to keep in step and two answers to "what does a result look
 * like". So this renders the same classes, inside a chat message. If Together's stylesheet is
 * not in the page the rows still read as a list, because the markup is a list either way.
 *
 * ## One tap plays it
 *
 * Same rule as the panel, for the same reason: there is no useful state between "I picked
 * this" and "it is playing". `MediaIntent.play` is what runs, so the card, the session and the
 * prompt all behave exactly as they do for every other route into playback.
 *
 * Exposes: window.NEXUS_MEDIA_RESULT_LIST
 */
(function (global) {
    'use strict';

    /** The heading above the rows. Says what they are and what to do with them. */
    function heading(count, query) {
        const q = String(query || '').trim();
        const many = count === 1 ? 'one' : String(count);
        return q
            ? `Here ${count === 1 ? 'is' : 'are'} ${many} for “${q}” — tap one to play it.`
            : 'Tap one to play it.';
    }

    function el(doc, tag, className, text) {
        const node = doc.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    /** The app's own way of putting a bot message in the chat, whichever shape this page uses. */
    function say(text, doc) {
        const ask = global && global.NEXUS_YT_ASK;
        if (!ask || typeof ask.say !== 'function') {
            return null;
        }
        try {
            return ask.say(text, 'bot', doc) || null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Put the list in the chat. Returns the message node, or `null` if it could not.
     *
     * Nothing here starts playback, and that is the whole contract — a caller that wanted
     * something to play should have called `fulfil`.
     */
    // `kind` is accepted and unused on purpose: every other entry point in this feature takes
    // it, and a renderer that silently rejected the shape its callers pass would be a trap.
    // eslint-disable-next-line no-unused-vars
    function publish(results, { query = '', kind = 'video', doc, win } = {}) {
        const w = win || global;
        const d = doc || (w && w.document) || null;
        const rows = Array.isArray(results) ? results.filter(Boolean) : [];
        if (!d || !rows.length) {
            return null;
        }

        const node = say(heading(rows.length, query), d);
        if (!node) {
            return null;
        }

        const list = el(d, 'div', 'nexus-bd-together-results nexus-bd-together-chatlist');
        list.setAttribute('role', 'list');
        for (const result of rows) {
            const row = el(d, 'button', 'nexus-bd-together-result');
            row.type = 'button';
            row.setAttribute('role', 'listitem');
            row.dataset.mediaId = String(result.id || '');
            if (result.sample) {
                row.dataset.sample = 'true';
            }

            const thumb = el(d, 'span', 'nexus-bd-together-resultthumb');
            if (result.thumbnail) {
                const img = el(d, 'img');
                img.alt = '';
                img.loading = 'lazy';
                img.decoding = 'async';
                img.src = result.thumbnail;
                thumb.appendChild(img);
            }
            row.appendChild(thumb);

            const meta = el(d, 'span', 'nexus-bd-together-resultmeta');
            meta.appendChild(el(d, 'span', 'nexus-bd-together-resulttitle', result.title || 'Untitled'));
            meta.appendChild(el(d, 'span', 'nexus-bd-together-resultby', result.creator || ''));
            row.appendChild(meta);

            const cue = el(d, 'span', 'nexus-bd-together-playcue', '▶');
            cue.setAttribute('aria-hidden', 'true');
            row.appendChild(cue);

            row.setAttribute(
                'aria-label',
                `Play ${result.title || 'this'}${result.creator ? ` by ${result.creator}` : ''}`
            );
            row.addEventListener('click', () => {
                const intent = w && w.NEXUS_MEDIA_INTENT;
                if (intent && typeof intent.play === 'function') {
                    try {
                        intent.play(result, 'list');
                    } catch (_) {
                        // A row that cannot play is not a reason to lose the list.
                    }
                }
            });
            list.appendChild(row);
        }
        node.appendChild(list);

        // The same call the app makes after its own messages, so the list survives a reload
        // exactly as a card does.
        try {
            if (w && typeof w._persistChat === 'function') {
                w._persistChat();
            }
        } catch (_) {
            // Storage full or disabled. The list is live either way.
        }
        return node;
    }

    const api = { publish, heading };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_MEDIA_RESULT_LIST = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
