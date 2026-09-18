/**
 * Who draws a conversation turn.
 *
 * `main.js` has always rendered chat by building the DOM itself: `addMessageToHistory` makes a
 * `.chat-message` with a `YOU`/`NEXUS` sender label, and `_createStreamingBotMessage` makes the
 * empty one that tokens stream into. That is correct and it is the only implementation, which
 * is why Private looked the way it did.
 *
 * A Private session mounts a rose card into `#chat-history` and speaks its scripted beats
 * inside it — and then the moment the person typed anything, `main.js` drew an ordinary blue
 * `YOU` bubble underneath it and streamed an ordinary `NEXUS` bubble under that. Two
 * presentation systems in one scroll container, and the card could only *watch* the other one
 * through a `MutationObserver` to know when a reply had landed. The person is left deciding
 * which of the two things on screen they are talking to, and the answer is supposed to be that
 * there is only one companion.
 *
 * So this is the seam. `main.js` stops drawing and starts asking whoever owns the conversation
 * to draw, and the default owner does exactly what `main.js` did before — the same elements,
 * the same classes, the same `_persistChat`. Nothing about ordinary chat changes.
 *
 * ```text
 *   handleUserMessage ─▶ surface.renderUser(text)
 *                        surface.beginAssistant() ─▶ { append, finish, discard }
 *
 *   ordinary chat   surface = the default: .chat-message rows in #chat-history
 *   Private         surface = the Private card's own transcript
 *   Scene Tale      could be a third, and is not one yet
 * ```
 *
 * ## Why a handle rather than three more methods
 *
 * A streaming reply is one object with a lifetime: it appears empty, fills, and then either
 * settles or is thrown away because the user pressed CLEAR mid-sentence. `main.js` already
 * held `{ textDiv, row }` for exactly that and passed them around. `beginAssistant()` returns
 * the same idea with the DOM hidden behind it, so a surface that is not made of `textDiv` and
 * `row` — the Private card is not — can still be one.
 *
 * ## Install and restore, never patch
 *
 * `use()` returns what was there. Private restores it on exit rather than assuming the default,
 * because the day a third surface exists, assuming would silently drop it.
 *
 * Exposes: window.NEXUS_CONVERSATION_SURFACE
 */
(function (global) {
    'use strict';

    /**
     * What `main.js` did, unchanged — installed as the default so that swapping surfaces is
     * the only new behaviour and ordinary chat is byte-identical to what it was.
     *
     * Deliberately built from the callbacks the host hands over rather than from its own DOM
     * knowledge: this file must not grow a second opinion about what a chat row looks like.
     */
    function defaultSurface(hooks = {}) {
        return {
            id: 'default',
            renderUser(text, attachments) {
                if (typeof hooks.addMessage === 'function') hooks.addMessage('user', text, attachments);
            },
            renderAssistant(text, attachments) {
                if (typeof hooks.addMessage === 'function') hooks.addMessage('avatar', text, attachments);
            },
            renderError(text) {
                if (typeof hooks.addMessage === 'function') hooks.addMessage('avatar', text);
            },
            beginAssistant() {
                const made = typeof hooks.beginStream === 'function' ? hooks.beginStream() : null;
                const textDiv = made && made.textDiv;
                const row = made && made.row;
                return {
                    id: 'default',
                    append(full) {
                        if (textDiv) textDiv.textContent = String(full == null ? '' : full);
                        if (typeof hooks.scroll === 'function') hooks.scroll();
                    },
                    finish(full) {
                        if (textDiv) textDiv.textContent = String(full == null ? '' : full);
                    },
                    discard() {
                        if (row && row.parentElement) row.parentElement.removeChild(row);
                    },
                    // The host still needs these on the default path: the YouTube decorator
                    // and the attachment renderer work on real nodes.
                    node: row || null,
                    textNode: textDiv || null,
                };
            },
        };
    }

    /** A handle that draws nothing, for a surface that did not supply `beginAssistant`. */
    function nullStream() {
        return { id: 'null', append() {}, finish() {}, discard() {}, node: null, textNode: null };
    }

    let host = {};
    let fallback = null;
    let active = null;

    /**
     * Tell the module how the host draws. Called once by `main.js` at boot.
     *
     * Until this runs every method is a no-op that returns a null handle, which is what keeps
     * a page without `main.js` — a test, `demo.html` — from throwing on a call.
     */
    function configure(hooks) {
        const wasDefault = !active || active === fallback;
        host = hooks && typeof hooks === 'object' ? hooks : {};
        fallback = defaultSurface(host);
        // Re-point the active surface when it *was* the default, or a second `configure` would
        // leave every later turn drawing through the hooks of the first one. Something that
        // deliberately installed its own surface keeps it: reconfiguring the host is not a
        // reason to evict Private from the middle of a session.
        if (wasDefault) active = fallback;
        return fallback;
    }

    /** Install a surface. Returns the one it replaced, for the caller to restore. */
    function use(surface) {
        const previous = active;
        active = surface && typeof surface === 'object' ? surface : fallback;
        return previous || fallback;
    }

    /** Back to whatever the host installed. */
    function reset() {
        active = fallback;
        return active;
    }

    function current() {
        return active || fallback;
    }

    /**
     * Every call is guarded.
     *
     * A surface that throws must not take the turn down with it — a broken renderer should
     * cost the drawing, not the reply, the transcript or the voice. On a throw the default is
     * asked instead, so the words still reach the screen somewhere.
     */
    function guard(method, args, retry) {
        const surface = current();
        if (surface && typeof surface[method] === 'function') {
            try {
                return surface[method](...args);
            } catch (error) {
                console.warn(`[ConversationSurface] ${surface.id || 'surface'}.${method} threw`, error);
            }
        }
        if (retry && fallback && surface !== fallback && typeof fallback[method] === 'function') {
            try {
                return fallback[method](...args);
            } catch (_) {
                /* nothing left to try */
            }
        }
        return null;
    }

    function renderUser(text, attachments) {
        return guard('renderUser', [text, attachments], true);
    }

    function renderAssistant(text, attachments) {
        return guard('renderAssistant', [text, attachments], true);
    }

    function renderError(text) {
        return guard('renderError', [text], true);
    }

    function beginAssistant() {
        return guard('beginAssistant', [], true) || nullStream();
    }

    const api = {
        configure,
        use,
        reset,
        current,
        renderUser,
        renderAssistant,
        renderError,
        beginAssistant,
        defaultSurface,
        nullStream,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_CONVERSATION_SURFACE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
