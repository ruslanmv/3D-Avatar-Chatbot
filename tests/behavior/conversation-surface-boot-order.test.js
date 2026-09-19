/**
 * The host's hooks have to arrive, whichever file loads first (P18).
 *
 * The reported symptom was one click: a dialogue choice appeared after the idle clock, the tap
 * spent the buttons, and no reply ever came. The cause was not in the button, the handler, or the
 * send — it was that `ConversationSurface.configure` had never run on any real page load.
 *
 * `main.js` calls it inside `startBehaviorDirector`, at the top, with optional chaining:
 *
 *     window.NEXUS_CONVERSATION_SURFACE?.configure?.({ …, send: (t) => handleUserMessage(t) });
 *     …
 *     document.head.appendChild(bdScript);          // ← boot.js, appended AFTER
 *
 * and `src/features/chat/ConversationSurface.js` is item eighty in `boot.js`'s module list,
 * fetched asynchronously. So the optional chaining evaluated to `undefined` every time and the
 * hooks were dropped without a warning.
 *
 * Private looked fine throughout — the card installs its own surface through `use()`, so `active`
 * was set and every line drew — which is exactly why this survived four batches. The two things
 * that read `host` were the ones that died, and `send` is one of them.
 *
 * Every other test in the suite calls `configure` in its own `beforeEach`, which is why none of
 * them caught it. These deliberately do not.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const fs = require('fs');
const path = require('path');

const SURFACE = path.join(__dirname, '../../src/features/chat/ConversationSurface.js');
const HOOKS_GLOBAL = 'NEXUS_CONVERSATION_SURFACE_HOOKS';

/** Load the module afresh, the way a page does — not the cached copy another test configured. */
function loadSurface() {
    jest.resetModules();
    delete window.NEXUS_CONVERSATION_SURFACE;
    // eslint-disable-next-line global-require
    return require('../../src/features/chat/ConversationSurface.js');
}

function hooks(drawn, sent) {
    return {
        addMessage: (sender, text) => drawn.push({ sender, text }),
        beginStream: () => ({ row: document.createElement('div'), textDiv: document.createElement('div') }),
        scroll: () => {},
        getHistory: () => [],
        addHistory: () => {},
        persist: () => {},
        send: (text) => sent.push(text),
    };
}

beforeEach(() => {
    delete window[HOOKS_GLOBAL];
});

afterEach(() => {
    delete window[HOOKS_GLOBAL];
    jest.resetModules();
});

describe('hooks published before the module loads', () => {
    test('are adopted at load, so a tapped choice reaches the host', () => {
        // The production order: `main.js` runs, then `boot.js` fetches this file.
        const drawn = [];
        const sent = [];
        window[HOOKS_GLOBAL] = hooks(drawn, sent);

        const Surface = loadSurface();

        expect(Surface.send('I am still here.')).toBe(true);
        expect(sent).toEqual(['I am still here.']);
    });

    test('and an ordinary turn draws through them', () => {
        // The second casualty, and the wider one: with no host, `fallback` stayed null, `current()`
        // was null and `guard` found no surface at all. `main.js` prefers this API over its own
        // renderers the moment the file exists, so a chat turn outside Private drew nothing.
        const drawn = [];
        const sent = [];
        window[HOOKS_GLOBAL] = hooks(drawn, sent);

        const Surface = loadSurface();

        expect(Surface.current().id).toBe('default');
        Surface.renderUser('hello');
        Surface.renderAssistant('hello back');
        expect(drawn).toEqual([
            { sender: 'user', text: 'hello' },
            { sender: 'avatar', text: 'hello back' },
        ]);
    });

    test('a surface installed afterwards still sends through the host', () => {
        // This is the shape of the bug as it was experienced. Private replaces the *drawing*; it
        // never supplies a `send`, because the host owns the pipeline. So the card looked alive
        // while the one thing that reads `host` was dead.
        const drawn = [];
        const sent = [];
        window[HOOKS_GLOBAL] = hooks(drawn, sent);
        const Surface = loadSurface();

        const card = [];
        Surface.use({ id: 'private', renderUser: (text) => card.push(text) });

        Surface.renderUser('a line inside the card');
        expect(card).toEqual(['a line inside the card']);
        expect(drawn).toEqual([]);
        // …and the tap still gets through.
        expect(Surface.send('Ask me something.')).toBe(true);
        expect(sent).toEqual(['Ask me something.']);
    });

    test('junk on the global costs nothing and never throws', () => {
        window[HOOKS_GLOBAL] = 'not an object';
        const Surface = loadSurface();
        expect(Surface.send('anything')).toBe(false);
    });
});

describe('the other order, and no order at all', () => {
    test('a direct configure still works — the path under Jest and a plain script tag', () => {
        const drawn = [];
        const sent = [];
        const Surface = loadSurface();
        expect(Surface.current()).toBeNull();

        Surface.configure(hooks(drawn, sent));
        expect(Surface.send('typed by hand')).toBe(true);
        expect(sent).toEqual(['typed by hand']);
    });

    test('configure is idempotent, so being offered the hooks twice changes nothing', () => {
        // Both halves of the handshake fire on a page that loaded the module with a script tag.
        const drawn = [];
        const sent = [];
        const published = hooks(drawn, sent);
        window[HOOKS_GLOBAL] = published;
        const Surface = loadSurface();
        Surface.configure(published);

        Surface.renderUser('once');
        expect(drawn).toEqual([{ sender: 'user', text: 'once' }]);
        expect(Surface.send('once')).toBe(true);
        expect(sent).toEqual(['once']);
    });

    test('with neither, every method is still a no-op rather than a throw', () => {
        // The guarantee the module's header makes, and the reason the failure was silent. It stays
        // true: a page that never configures — a test, `demo.html` — must not throw on a call.
        const Surface = loadSurface();
        expect(() => {
            Surface.renderUser('x');
            Surface.renderAssistant('y');
            Surface.renderError('z');
            Surface.beginAssistant().finish('w');
        }).not.toThrow();
        expect(Surface.send('x')).toBe(false);
        expect(Surface.history().id).toBe('null');
    });
});

describe('main.js holds up its end', () => {
    /**
     * A source check, and the right kind of blunt.
     *
     * `main.js` cannot be required — it is a 5000-line classic script that boots an app — so the
     * alternative to reading it is trusting that the half of the handshake living there stays.
     * The whole defect was one call that looked correct and ran too early.
     */
    const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

    test('it publishes the hooks on the window, not only into an optional call', () => {
        expect(main).toContain(`window.${HOOKS_GLOBAL} = conversationHooks`);
    });

    test('and the hooks it publishes are the ones it offers directly', () => {
        expect(main).toContain('window.NEXUS_CONVERSATION_SURFACE?.configure?.(conversationHooks)');
    });

    test('send goes to handleUserMessage, which is the whole pipeline', () => {
        // Not a reimplementation of it. A tapped choice has to be the same thing as typed text:
        // prompt assembly, the provider, the directives, the drawing and persistence.
        expect(main).toMatch(/send:\s*\(text\)\s*=>\s*handleUserMessage\(text\)/);
    });

    test('the global is spelled the same in both files', () => {
        expect(fs.readFileSync(SURFACE, 'utf8')).toContain(`global.${HOOKS_GLOBAL}`);
    });
});
