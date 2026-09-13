/**
 * CLEAR actually clearing (conversation reset).
 *
 * The bug: CLEAR emptied the transcript and the in-memory message list and left both
 * localStorage copies alone, so `_restoreChat()` put the whole conversation back on the next
 * page load. It compounded twice over — the drawer's Clear Chat removed the storage keys
 * through a *separate* listener, so the same action behaved differently depending on which
 * button you pressed, and the failure only surfaced after a reload, long after the click.
 *
 * The assertions worth their place:
 *
 *   * **storage is emptied**, because that is the actual bug, tested against a real store
 *     rather than a mock (jsdom's Storage is real — see CLAUDE.md).
 *   * **the prompt context goes too.** `LookUp.systemPromptSuffix()` injects "YOU JUST
 *     SEARCHED THE WEB" plus results. Clearing only the message list left that standing, so
 *     the first message after a CLEAR could still carry the previous conversation's search.
 *   * **study memory survives.** Deliberate between-sessions memory, not part of any one
 *     conversation. A chat-clear deleting somebody's learning history would be a surprise of
 *     exactly the kind this module exists to remove, so it is asserted, not assumed.
 *   * **the epoch**, which closes the race where pressing CLEAR mid-reply let the in-flight
 *     turn write itself back afterwards.
 */

const fs = require('fs');
const path = require('path');

const Reset = require('../src/features/chat/ConversationReset.js');
const mainSrc = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf-8');

/**
 * The body of one top-level function in main.js.
 *
 * Verified rather than trusted: an earlier version of this helper silently produced an empty
 * string, and every assertion built on it passed for that reason. `assertExtractable` below is
 * the guard, and it runs first.
 */
function mainFn(name) {
    const start = mainSrc.indexOf(`\nfunction ${name}(`);
    if (start === -1) throw new Error(`no function ${name} in main.js`);
    const end = mainSrc.indexOf('\n}', start);
    const body = mainSrc.slice(start, end === -1 ? undefined : end);
    if (body.trim().length < 40) throw new Error(`extractor produced an empty body for ${name}`);
    return body;
}

const CHAT_KEYS = ['nexus_chat_messages', 'nexus_chat_display'];

function seedConversation() {
    localStorage.setItem('nexus_chat_messages', JSON.stringify([{ role: 'user', content: 'my medical results' }]));
    localStorage.setItem('nexus_chat_display', JSON.stringify([{ sender: 'user', text: 'my medical results' }]));
}

beforeEach(() => {
    localStorage.clear();
    delete global.chatHistory;
    delete global.NEXUS_LOOKUP;
    delete global.NEXUS_SEARCH_SESSION;
    delete global.NEXUS_STUDY_SESSION;
});

describe('the extractor is not lying to the rest of this file', () => {
    test('it returns real function bodies', () => {
        expect(mainFn('clearHistory')).toContain('chat-history');
        expect(mainFn('_turnIsCurrent')).toContain('isCurrent');
    });

    test('and it throws rather than returning nothing', () => {
        expect(() => mainFn('aFunctionThatDoesNotExist')).toThrow(/no function/);
    });
});

describe('the bug: the conversation used to come back on reload', () => {
    test('forget removes both persisted copies', () => {
        seedConversation();
        Reset.forget();
        for (const key of CHAT_KEYS) {
            expect(localStorage.getItem(key)).toBeNull();
        }
    });

    test('residue reports nothing left afterwards', () => {
        seedConversation();
        expect(Reset.residue().sort()).toEqual([...CHAT_KEYS].sort());
        Reset.forget();
        expect(Reset.residue()).toEqual([]);
    });

    test('the keys it owns are stated once, as data', () => {
        // So "what does CLEAR remove?" has one answer a test can read, and adding a new
        // conversation key without adding it here is visible rather than silent.
        expect([...Reset.KEYS].sort()).toEqual([...CHAT_KEYS].sort());
    });

    test('clearHistory goes through the module rather than its own half-implementation', () => {
        const body = mainFn('clearHistory');
        expect(body).toContain('NEXUS_CONVERSATION_RESET');
        expect(body).toContain('reset.forget()');
    });

    test('the drawer no longer carries a second, partial clear', () => {
        // It removed the storage keys but not the message list, while MobileDrawerWiring
        // forwarded the same click to #clear-history for the other half. Two implementations
        // of one action, each doing a different part of it.
        expect(mainSrc).not.toContain("_drawerClearBtn.addEventListener('click'");
        expect(mainSrc).not.toMatch(/const _drawerClearBtn = document\.getElementById/);
    });

    test('a storage-less browser is reported, not silently treated as success', () => {
        const body = mainFn('clearHistory');
        expect(body).toContain('reset.residue()');
        expect(body).toMatch(/would not let it be erased|nothing was stored/);
    });
});

describe('everything that can reach the prompt', () => {
    test('the in-memory message list is emptied', () => {
        global.chatHistory = {
            messages: [{ role: 'user', content: 'x' }],
            clear() {
                this.messages = [];
            },
        };
        Reset.forget();
        expect(global.chatHistory.messages).toEqual([]);
    });

    test('a history object without clear() still gets emptied', () => {
        global.chatHistory = { messages: [{ role: 'user', content: 'x' }] };
        Reset.forget();
        expect(global.chatHistory.messages).toEqual([]);
    });

    test('the search results that feed the system prompt go too', () => {
        // Without this, the first message after a CLEAR still arrives carrying
        // "YOU JUST SEARCHED THE WEB — you looked up …" from the cleared conversation.
        const calls = [];
        global.NEXUS_LOOKUP = { reset: () => calls.push('lookup'), systemPromptSuffix: () => '' };
        global.NEXUS_SEARCH_SESSION = { clear: () => calls.push('session') };
        Reset.forget();
        expect(calls).toEqual(['lookup', 'session']);
    });

    test('a running study session is ended', () => {
        const calls = [];
        global.NEXUS_STUDY_SESSION = { reset: () => calls.push('study') };
        Reset.forget();
        expect(calls).toEqual(['study']);
    });

    test('it reports what it actually cleared', () => {
        seedConversation();
        global.chatHistory = { messages: [], clear() {} };
        global.NEXUS_LOOKUP = { reset() {} };
        const result = Reset.forget();
        expect(result.cleared).toContain('chatHistory');
        expect(result.cleared).toContain('nexus_chat_messages');
        expect(result.cleared).toContain('NEXUS_LOOKUP.reset()');
    });

    test('a module that throws does not leave the rest of the conversation standing', () => {
        // Half a clear is worse than none: the user is told it worked and some of it remains.
        seedConversation();
        global.NEXUS_LOOKUP = {
            reset() {
                throw new Error('boom');
            },
        };
        global.chatHistory = {
            messages: [{ role: 'user', content: 'x' }],
            clear() {
                this.messages = [];
            },
        };
        expect(() => Reset.forget()).not.toThrow();
        expect(localStorage.getItem('nexus_chat_messages')).toBeNull();
        expect(global.chatHistory.messages).toEqual([]);
    });

    test('missing modules are the normal case, not an error', () => {
        // A chat-only deployment has no study modules and no search provider.
        expect(() => Reset.forget()).not.toThrow();
    });
});

describe('what it deliberately leaves alone', () => {
    test('study memory survives — it is not part of this conversation', () => {
        localStorage.setItem('nexus_study_history', JSON.stringify([{ topic: 'entanglement' }]));
        Reset.forget();
        expect(localStorage.getItem('nexus_study_history')).not.toBeNull();
    });

    test('and that choice is recorded as data, not left implicit', () => {
        expect(Reset.KEPT).toContain('nexus_study_history');
        for (const kept of Reset.KEPT) {
            expect(Reset.KEYS).not.toContain(kept);
        }
    });

    test('settings are not conversation', () => {
        const settings = {
            ai_api_key: 'sk-secret',
            ai_provider: 'openai',
            speech_voice_pref: 'a-voice',
            selected_personality: 'friendly',
            desktop_bg: 'ambient:ocean:day',
            app_lang: 'en',
        };
        for (const [k, v] of Object.entries(settings)) localStorage.setItem(k, v);
        Reset.forget();
        for (const [k, v] of Object.entries(settings)) {
            expect(localStorage.getItem(k)).toBe(v);
        }
    });
});

describe('the epoch — pressing CLEAR mid-reply', () => {
    test('a token taken before a reset is no longer current after it', () => {
        const turn = Reset.currentEpoch();
        expect(Reset.isCurrent(turn)).toBe(true);
        Reset.forget();
        expect(Reset.isCurrent(turn)).toBe(false);
    });

    test('a token taken after the reset is current', () => {
        Reset.forget();
        expect(Reset.isCurrent(Reset.currentEpoch())).toBe(true);
    });

    test('every reset advances it, so two clears in a row both count', () => {
        const a = Reset.currentEpoch();
        Reset.forget();
        const b = Reset.currentEpoch();
        Reset.forget();
        expect(new Set([a, b, Reset.currentEpoch()]).size).toBe(3);
    });

    test('an absent token is treated as current', () => {
        // So a caller that never captured one behaves exactly as it did before this existed.
        expect(Reset.isCurrent(undefined)).toBe(true);
        expect(Reset.isCurrent(null)).toBe(true);
    });

    test('both turn handlers capture it at the start', () => {
        const streaming = mainSrc.slice(mainSrc.indexOf('async function _handleStreamingResponse'));
        expect(streaming.slice(0, 600)).toContain('currentEpoch');
        const plain = mainSrc.slice(mainSrc.indexOf('async function _handleNonStreamingResponse'));
        expect(plain.slice(0, 400)).toContain('currentEpoch');
    });

    test('and check it before writing anything back', () => {
        // Three places: the streaming result, the plain result, and the error path — each of
        // which appends to the transcript or persists.
        expect(mainSrc.match(/if \(!_turnIsCurrent\(turn\)\)/g)).toHaveLength(4);
    });

    test('the streaming fallback does not retry a cleared turn', () => {
        // The fallback captures a *fresh* epoch and would therefore consider itself current,
        // putting the old question's answer into the new conversation. The one hole a per-turn
        // token does not close by itself.
        const streaming = mainSrc.slice(mainSrc.indexOf('async function _handleStreamingResponse'));
        const catchBlock = streaming.slice(
            streaming.indexOf('Fallback to non-streaming') - 500,
            streaming.indexOf('Fallback to non-streaming')
        );
        expect(catchBlock).toContain('_turnIsCurrent(turn)');
    });

    test('a missing reset module leaves turns behaving exactly as before', () => {
        const body = mainFn('_turnIsCurrent');
        expect(body).toContain('return true;');
    });
});

describe('house shape', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/features/chat/ConversationReset.js'), 'utf-8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    test('no top-level import or export', () => {
        expect(code).not.toMatch(/^\s*import\s/m);
        expect(code).not.toMatch(/^\s*export\s/m);
    });

    test('dual export', () => {
        expect(code).toContain('module.exports = api;');
        expect(code).toContain('global.NEXUS_CONVERSATION_RESET = api;');
    });

    test('it fails soft', () => {
        expect(code).toContain('console.warn');
        expect(code).not.toMatch(/\bthrow new\b/);
    });

    test('boot.js loads it', () => {
        const boot = fs.readFileSync(path.resolve(__dirname, '../src/behavior/boot.js'), 'utf-8');
        expect(boot).toContain('src/features/chat/ConversationReset.js');
    });

    test('onReset returns a working unsubscribe', () => {
        const seen = [];
        const off = Reset.onReset((e) => seen.push(e));
        Reset.forget();
        off();
        Reset.forget();
        expect(seen).toHaveLength(1);
    });
});
