/**
 * Forgetting a conversation, properly.
 *
 * CLEAR looked like it worked and did not. It emptied the transcript on screen and the
 * in-memory message list, and left both localStorage copies untouched — so the next page load
 * called `_restoreChat()` and put the whole conversation back, context and bubbles alike. The
 * user had every reason to believe it was gone.
 *
 * Two things made that easy to miss. The drawer's "Clear Chat" *did* remove the storage keys,
 * because a second listener on that button happened to do it — so the same action worked from
 * one entry point and not from the other, which is the worst possible symptom. And the
 * conversation only reappeared after a reload, by which time the CLEAR that failed was
 * several minutes in the past.
 *
 * ## What a conversation actually is here
 *
 * More than the message list. Each turn builds the prompt from the history *plus* a set of
 * suffix providers, and two of them carry conversation content:
 *
 *     history                  window.chatHistory        the rolling message list
 *     "YOU JUST SEARCHED…"     NEXUS_LOOKUP              the last query and its results
 *     "ACTIVE WEB SEARCH…"     NEXUS_SEARCH_SESSION      the subject under discussion
 *     a running study session  NEXUS_STUDY_SESSION       topic, phase, what was shaky
 *
 * Clearing only the message list left those standing, so the first message after a CLEAR could
 * still arrive with "You looked up ‘my medical results’" attached to it. Forgetting has to mean
 * everything that can reach the prompt, or it does not mean anything.
 *
 * ## What it deliberately does NOT touch
 *
 * **Settings.** The API key, voice, personality, language and viewport background are not
 * conversation. Clearing a chat and losing your API key would be a bug in the other direction.
 *
 * **`NEXUS_STUDY_MEMORY` (`nexus_study_history`).** That is deliberate between-sessions memory —
 * the thing that lets her open with "Last time: quantum entanglement. Measurement was the shaky
 * part." It is not part of any single conversation, and a chat-clear silently deleting somebody's
 * learning history would be a surprise of exactly the kind this module exists to remove. It needs
 * its own control, named for what it does.
 *
 * That line is worth stating rather than leaving implicit: `forget()` erases *this conversation*,
 * not *this person*.
 *
 * ## The epoch, and the reply that arrives after you clear
 *
 * Pressing CLEAR while she is mid-sentence used to resurrect the conversation. The turn was
 * already in flight; when it finished it appended the assistant's message and called
 * `_persistChat()`, writing a fresh conversation to the storage that had just been emptied.
 *
 * So every reset bumps an epoch. A turn captures the epoch when it starts and checks it before
 * writing anything back. A turn that began before the reset is a turn about a conversation that
 * no longer exists, and it writes nothing — no message, no storage, no speech.
 *
 * Exposes: window.NEXUS_CONVERSATION_RESET
 */
(function (global) {
    'use strict';

    /**
     * The localStorage keys that hold conversation content.
     *
     * Named here rather than in `main.js` so that "what does CLEAR remove?" has one answer that
     * a test can read. Adding a key that stores conversation and not adding it here is the
     * failure this list exists to make visible.
     */
    const KEYS = Object.freeze(['nexus_chat_messages', 'nexus_chat_display']);

    /**
     * Keys that look like conversation and are deliberately left alone. Kept as data, and
     * asserted in tests, so that "we forgot to clear this" and "we chose not to" stay
     * distinguishable a year from now.
     */
    const KEPT = Object.freeze(['nexus_study_history']);

    let epoch = 1;
    const listeners = new Set();

    function storage() {
        try {
            return global && global.localStorage ? global.localStorage : null;
        } catch (_) {
            return null;
        }
    }

    /** The current epoch. Capture this at the start of a turn. */
    function currentEpoch() {
        return epoch;
    }

    /**
     * Whether a turn that started at `token` may still write its result.
     *
     * False means the user cleared the conversation while the reply was in flight, and the reply
     * belongs to a conversation that no longer exists.
     */
    function isCurrent(token) {
        return token === undefined || token === null || token === epoch;
    }

    /** Subscribe to resets. Returns an unsubscribe function, always. */
    function onReset(listener) {
        if (typeof listener !== 'function') return function () {};
        listeners.add(listener);
        return function () {
            listeners.delete(listener);
        };
    }

    /**
     * Call one optional method on one optional global, and never let it stop the reset.
     *
     * Every one of these is a feature that may not be loaded: a chat-only deployment has no
     * study modules, a build without a search provider has no LookUp. A missing module is the
     * normal case, not an error, and one module throwing must not leave the rest of the
     * conversation in place — which is precisely what "clear" failing halfway would mean.
     */
    function callQuietly(name, methods, cleared) {
        const target = global && global[name];
        if (!target) return;
        for (const method of methods) {
            if (typeof target[method] !== 'function') continue;
            try {
                target[method]();
                cleared.push(`${name}.${method}()`);
                return;
            } catch (error) {
                console.warn(`[ConversationReset] ${name}.${method}() failed:`, error && error.message);
            }
        }
    }

    /**
     * Forget the current conversation.
     *
     * Order matters in one place only: the epoch is bumped **first**, so that a turn finishing
     * during this function still sees a stale token and declines to write itself back.
     *
     * @returns {{epoch:number, cleared:string[], storageAvailable:boolean}} what was actually
     *   done, so a caller can tell the user the truth rather than assuming.
     */
    function forget() {
        epoch += 1;
        const cleared = [];

        // The message list the LLM is sent.
        const history = global && global.chatHistory;
        if (history) {
            try {
                if (typeof history.clear === 'function') {
                    history.clear();
                } else {
                    history.messages = [];
                }
                cleared.push('chatHistory');
            } catch (error) {
                console.warn('[ConversationReset] chatHistory.clear() failed:', error && error.message);
            }
        }

        // The two persisted copies. Without this the conversation returns on the next load,
        // which is the bug this module was written for.
        const store = storage();
        let storageAvailable = false;
        if (store) {
            storageAvailable = true;
            for (const key of KEYS) {
                try {
                    store.removeItem(key);
                    cleared.push(key);
                } catch (error) {
                    storageAvailable = false;
                    console.warn(`[ConversationReset] could not remove ${key}:`, error && error.message);
                }
            }
        }

        // Everything else that can reach the prompt. Each is optional.
        callQuietly('NEXUS_LOOKUP', ['reset', 'clear'], cleared);
        callQuietly('NEXUS_SEARCH_SESSION', ['clear', 'reset'], cleared);
        callQuietly('NEXUS_STUDY_SESSION', ['reset', 'end'], cleared);

        for (const listener of Array.from(listeners)) {
            try {
                listener({ epoch });
            } catch (_) {
                // One bad listener must not stop the others, or leave the reset half-done.
            }
        }

        console.log(`[ConversationReset] forgot the conversation (epoch ${epoch}):`, cleared.join(', '));
        return { epoch, cleared, storageAvailable };
    }

    /**
     * Whether anything conversational is still on disk.
     *
     * Exposed because "CLEAR silently did not work" is the failure being fixed, and a caller
     * that wants to tell the user the truth needs to be able to check rather than assume.
     */
    function residue() {
        const store = storage();
        if (!store) return [];
        const left = [];
        for (const key of KEYS) {
            try {
                if (store.getItem(key) !== null) left.push(key);
            } catch (_) {
                // Unreadable is not the same as present; say nothing rather than guess.
            }
        }
        return left;
    }

    const api = {
        KEYS,
        KEPT,
        currentEpoch,
        forget,
        isCurrent,
        onReset,
        residue,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_CONVERSATION_RESET = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
