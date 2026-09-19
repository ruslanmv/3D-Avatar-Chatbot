/**
 * One soundtrack strip, for the two experiences that have one.
 *
 * Scene Tale and Private both put background music under a card in the conversation, and they
 * had arrived at two different answers to the same question. Scene Tale built a compact strip
 * with a real collapsed player; Private wrote `♫ <title>` into a div and called
 * `MediaSession.requestPlay`, which records an intention and starts nothing — so a Private
 * session announced a track by name and then played silence for five minutes. The bug was not
 * in either file's reasoning. It was that the second one was written from scratch instead of
 * from the first.
 *
 * So the drawing lives here once and the two callers keep their own skins. `classes` and
 * `marker` are arguments rather than constants because Scene Tale's selectors are load-bearing
 * — the story view queries them and so do its tests — and because the two cards are
 * deliberately not the same colour: cyan belongs to Scene Tale, pink to Private, and a shared
 * component that flattened them would make Private look like a story.
 *
 * What is *not* an argument is the behaviour: every strip names the track the same way
 * (through `MediaTitle`, so a search-engine title does not become the label), credits the
 * creator the same way, and hides the same real player behind the same disclosure. Those are
 * the parts that were inconsistent, and they are the parts worth having one of.
 *
 * ## Nothing here is fatal
 *
 * Without `NEXUS_YT_2D` there is no player, and the strip still renders as copy — which is
 * exactly what Private used to be, now as a deliberate fallback rather than the whole feature.
 * A `buildCard` that throws loses the player and keeps the strip. The music is supporting
 * material; it never takes down the experience it is supporting.
 *
 * Exposes: window.NEXUS_SOUNDTRACK_STRIP
 */
(function (global) {
    'use strict';

    const Title =
        (typeof require === 'function' ? tryRequire('../MediaTitle.js') : null) ||
        (global && global.NEXUS_MEDIA_TITLE) ||
        null;

    function tryRequire(path) {
        try {
            // eslint-disable-next-line global-require
            return require(path);
        } catch (error) {
            return null;
        }
    }

    /** Resolved per call as well as at load, since boot order differs from require order. */
    function titles() {
        return Title || (global && global.NEXUS_MEDIA_TITLE) || null;
    }

    const DEFAULT_CLASSES = Object.freeze({
        strip: 'nexus-soundtrack',
        copy: 'nexus-soundtrack-copy',
        kicker: 'nexus-soundtrack-kicker',
        title: 'nexus-soundtrack-title',
        creator: 'nexus-soundtrack-creator',
        toggle: 'nexus-soundtrack-toggle',
        player: 'nexus-soundtrack-player',
        card: 'nexus-soundtrack-card',
    });

    function el(doc, tag, className, text) {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }

    /**
     * What the strip says, given a result.
     *
     * Split out so a caller can label something without drawing it — Private's completion
     * screen and the Scene Tale ready meta both want the name and neither wants a player.
     */
    function describe(result) {
        const api = titles();
        if (api && typeof api.display === 'function') return api.display(result);
        const title = String((result && result.title) || '').trim();
        return {
            title: title || 'Background music',
            creator: String((result && result.creator) || '').trim(),
            raw: title,
        };
    }

    /**
     * Build the strip and its collapsed player.
     *
     * Returns `{ strip, player, toggle, card, label }`, or `null` when there is nothing to
     * draw. Nothing is inserted into the document: where a strip belongs differs per caller —
     * Scene Tale puts it above its transport bar, Private inside its card — and a component
     * that decided that for them would be wrong in one of the two places.
     */
    function render(result, options = {}) {
        const doc = options.doc || (typeof document !== 'undefined' ? document : null);
        if (!doc || !result) return null;
        const win = options.win || global || null;
        const classes = { ...DEFAULT_CLASSES, ...(options.classes || {}) };
        const label = describe(result);

        const strip = el(doc, 'div', classes.strip);
        if (options.marker) strip.setAttribute(options.marker, '1');

        const copy = el(doc, 'div', classes.copy);
        copy.appendChild(el(doc, 'div', classes.kicker, options.kicker || 'Soundtrack'));
        const title = el(doc, 'div', classes.title, `♫ ${label.title || 'Background music'}`);
        // The full name in the tooltip, because the line is ellipsised by design and the
        // trimming this module does is a display decision the reader may want to see past.
        if (label.raw && label.raw !== label.title) title.title = label.raw;
        copy.appendChild(title);
        if (label.creator) copy.appendChild(el(doc, 'div', classes.creator, label.creator));
        strip.appendChild(copy);

        const player = el(doc, 'div', classes.player);
        player.setAttribute('aria-label', options.playerLabel || 'Soundtrack player');

        const embed = win && win.NEXUS_YT_2D;
        let card = null;
        let toggle = null;
        if (embed && typeof embed.buildCard === 'function' && result.id) {
            const video = {
                id: String(result.id),
                name: String(result.title || ''),
                author: String(result.creator || ''),
                start: Number(result.start) || 0,
            };
            try {
                card = embed.buildCard(video, { doc });
                card.dataset.kind = 'music';
                card.dataset.creator = String(result.creator || '');
                if (classes.card) card.classList.add(classes.card);
                player.appendChild(card);

                toggle = el(doc, 'button', classes.toggle, 'Show player');
                toggle.type = 'button';
                toggle.setAttribute('aria-expanded', 'false');
                toggle.addEventListener('click', () => {
                    const open = !player.classList.contains('is-open');
                    player.classList.toggle('is-open', open);
                    toggle.textContent = open ? 'Hide player' : 'Show player';
                    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
                    if (typeof options.onToggle === 'function') options.onToggle(open);
                });
                strip.appendChild(toggle);

                if (options.play !== false && typeof embed.activate === 'function') {
                    // A level only when the caller named one. `activate(card, video)` is the
                    // signature every other caller uses and the one older builds understand,
                    // so a strip with no opinion about volume must not start passing options.
                    const volume = Number(options.volume);
                    if (Number.isFinite(volume)) embed.activate(card, video, { volume });
                    else embed.activate(card, video);
                    // Told after the player was asked, not before: `requestPlay` means
                    // "playback has been asked for", and until `activate` has run it has not.
                    const session = win && win.NEXUS_MEDIA_SESSION;
                    if (options.source && session && typeof session.requestPlay === 'function') {
                        session.requestPlay(result, { source: options.source });
                    }
                }
            } catch (_) {
                // A card that will not build is not a reason to lose the line that names the
                // track. The strip degrades to the copy it always had.
                card = null;
                toggle = null;
                player.textContent = '';
            }
        }

        return { strip, player, toggle, card, label };
    }

    const api = { DEFAULT_CLASSES, describe, render };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_SOUNDTRACK_STRIP = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
