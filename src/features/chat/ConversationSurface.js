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
 * ## It also knows whose turn it is (P8)
 *
 * Every turn in the application already passes through here, which makes this the one place
 * that can answer "is somebody mid-sentence right now?" without guessing. Private used to
 * guess: on a keystroke it set `_conversationBusyUntil = now + 8000` and held its scheduled
 * beats until that passed. Eight seconds is wrong in both directions — a local model answers
 * in seven hundred milliseconds and the reported session sat through `OllaBridge returned
 * 504; retrying` for far longer than eight — so a beat could land on top of a reply still
 * streaming, or the session could sit mute long after one had finished.
 *
 * So `renderUser`, `beginAssistant` and the handle it returns record the phase, and `observe()`
 * reports the transitions. `turn()` is the state; the events are for reacting the instant a
 * turn starts rather than on the next poll.
 *
 * ```text
 *   renderUser        ─▶ phase 'user'       (she owes an answer)
 *   beginAssistant    ─▶ phase 'assistant'  (tokens arriving)
 *   finish / discard  ─▶ phase 'idle'
 *   renderAssistant   ─▶ phase 'idle'       (the non-streaming providers)
 * ```
 *
 * Deliberately *not* a timeout: a phase ends when the thing itself ends. A consumer that must
 * not be muted by a provider which never answers puts its own valve on top, because how long
 * to wait for a dead provider is that consumer's judgement, not this file's.
 *
 * ## And where the turns are kept (P10)
 *
 * The card in `#chat-history` was only the visible half of the problem. `handleUserMessage` also
 * writes every turn into `window.chatHistory` and calls `_persistChat`, which puts it in
 * `localStorage` under `nexus_chat_messages` — so a Private conversation survived the session,
 * the page and the browser restart, and came back as ordinary chat scrollback. The completion
 * card promises a quiet ending; ordinary chat persistence is the opposite of one.
 *
 * So the surface owns the store as well as the drawing. `history()` returns
 * `{ getHistory, addMessage, persist, id }` and the default one is `window.chatHistory` plus
 * `_persistChat`, unchanged. Private's is a small in-memory buffer that is never written to disk
 * and is dropped when the card comes down.
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
            /**
             * Where the turns are kept — `window.chatHistory` and `_persistChat`, unchanged.
             *
             * Built from the host's callbacks for the same reason the renderers are: this file
             * must not grow a second opinion about where a conversation lives.
             */
            history() {
                return {
                    id: 'default',
                    getHistory() {
                        return typeof hooks.getHistory === 'function' ? hooks.getHistory() : [];
                    },
                    addMessage(role, text) {
                        if (typeof hooks.addHistory === 'function') hooks.addHistory(role, text);
                    },
                    persist() {
                        if (typeof hooks.persist === 'function') hooks.persist();
                    },
                };
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

    /** A store that remembers nothing, for a surface that did not supply `history`. */
    function nullHistory() {
        return { id: 'null', getHistory: () => [], addMessage() {}, persist() {} };
    }

    let host = {};
    let fallback = null;
    let active = null;

    /**
     * Whose turn it is, and when each phase started. See the header.
     *
     * `userAt` is kept across the assistant phase on purpose: a consumer that wants "how long
     * ago did they say something" should not have to observe events to find out.
     */
    let phase = 'idle';
    let userAt = 0;
    let userText = '';
    let assistantAt = 0;
    let assistantEndedAt = 0;
    const observers = new Set();

    function clock() {
        return Date.now();
    }

    /** A copy, so a consumer holding it cannot be surprised by the next turn. */
    function turn() {
        return { phase, userAt, userText, assistantAt, assistantEndedAt };
    }

    /**
     * Watch the phase change. Returns an unsubscribe.
     *
     * Every listener is called in its own try/catch: a consumer that throws while reacting to a
     * turn must not stop the turn, and must not stop the *other* consumers either — the reason
     * this is a set of independent calls rather than one composed handler.
     */
    function observe(listener) {
        if (typeof listener !== 'function') return () => {};
        observers.add(listener);
        return () => observers.delete(listener);
    }

    function announce(event) {
        for (const listener of [...observers]) {
            try {
                listener(event);
            } catch (error) {
                console.warn('[ConversationSurface] a turn observer threw', error);
            }
        }
    }

    /**
     * Recording the phase and announcing it are two steps, and the drawing goes between them.
     *
     * The phase is set first so that a renderer which throws still leaves the turn correctly
     * owned — a consumer holding its beats while somebody is mid-sentence must not start talking
     * because a card failed to paint. The *announcement* comes after the drawing, because an
     * observer reacting to it draws too: Private's session puts thinking dots on the card, and
     * with the order reversed the card's own `renderUser` — which clears them, as it should when
     * a turn is drawn — wiped the dots in the same tick they appeared.
     */
    function beganUserTurn(text) {
        phase = 'user';
        userAt = clock();
        userText = String(text == null ? '' : text);
    }

    function beganAssistantTurn() {
        phase = 'assistant';
        assistantAt = clock();
    }

    function endedAssistantTurn(type, text) {
        phase = 'idle';
        assistantEndedAt = clock();
        // Already after the drawing at every call site, for the reason in `beganUserTurn`.
        announce({ type, text: String(text == null ? '' : text), at: assistantEndedAt });
    }

    function forgetTurn() {
        phase = 'idle';
        userAt = assistantAt = assistantEndedAt = 0;
        userText = '';
    }

    /**
     * The handle, plus the phase bookkeeping.
     *
     * Wrapped here rather than inside each surface so that every surface — including one written
     * later, and including Private's — reports its phase without having to remember to. A
     * surface that forgets is a session that goes mute.
     */
    function trackStream(handle) {
        const inner = handle && typeof handle === 'object' ? handle : nullStream();
        let settled = false;
        const call = (name, args) => {
            if (typeof inner[name] !== 'function') return undefined;
            try {
                return inner[name](...args);
            } catch (error) {
                console.warn(`[ConversationSurface] stream.${name} threw`, error);
                return undefined;
            }
        };
        return {
            id: inner.id || 'stream',
            append(full) {
                return call('append', [full]);
            },
            finish(full) {
                const out = call('finish', [full]);
                if (!settled) {
                    settled = true;
                    endedAssistantTurn('assistant-end', full);
                }
                return out;
            },
            discard() {
                const out = call('discard', []);
                if (!settled) {
                    settled = true;
                    endedAssistantTurn('assistant-discarded', '');
                }
                return out;
            },
            get node() {
                return inner.node || null;
            },
            get textNode() {
                return inner.textNode || null;
            },
        };
    }

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
        // Boot, or a re-boot. Nothing is mid-sentence at that point by definition, and a stale
        // phase would make the first scheduled beat of the next session wait for a turn that
        // finished in a previous page.
        forgetTurn();
        return fallback;
    }

    /** Install a surface. Returns the one it replaced, for the caller to restore. */
    function use(surface) {
        const previous = active;
        active = surface && typeof surface === 'object' ? surface : fallback;
        return previous || fallback;
    }

    /**
     * Back to whatever the host installed, with no turn in flight.
     *
     * The only production caller is a surface tearing down with nothing to restore, so "the
     * conversation that was being drawn is over" is true there as well as in a test's
     * `beforeEach`. Private restores through `use(previous)` instead and keeps the phase, which
     * is what you want when a reply is still arriving as the card comes down.
     */
    function reset() {
        active = fallback;
        forgetTurn();
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
        beganUserTurn(text);
        const out = guard('renderUser', [text, attachments], true);
        announce({ type: 'user', text: userText, at: userAt });
        return out;
    }

    function renderAssistant(text, attachments) {
        const out = guard('renderAssistant', [text, attachments], true);
        endedAssistantTurn('assistant-end', text);
        return out;
    }

    function renderError(text) {
        const out = guard('renderError', [text], true);
        // An error is how a turn ended, and the turn did end. A consumer left believing she is
        // still composing would hold its beats for the whole of its own timeout.
        endedAssistantTurn('assistant-end', '');
        return out;
    }

    function beginAssistant() {
        beganAssistantTurn();
        const handle = trackStream(guard('beginAssistant', [], true));
        announce({ type: 'assistant-start', text: '', at: assistantAt });
        return handle;
    }

    /**
     * Where this conversation's turns are kept (P10).
     *
     * Falls back to the default store rather than to nothing, because a surface that draws but
     * forgot to say where it keeps its turns should keep them somewhere real. Only a surface with
     * no store at all — and no default configured — gets `nullHistory`, which is the same
     * "nothing throws before `configure`" guarantee the renderers have.
     */
    function history() {
        const current = guard('history', [], true);
        if (current && typeof current === 'object') return current;
        return nullHistory();
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
        history,
        defaultSurface,
        nullStream,
        nullHistory,
        turn,
        observe,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_CONVERSATION_SURFACE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
