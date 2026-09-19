/**
 * Who draws a conversation turn — and that Private becomes the one drawing while it runs.
 *
 * The defect this exists to close: `main.js` built chat rows itself, so a Private session
 * mounted its card into `#chat-history` and then watched `main.js` draw an ordinary blue `YOU`
 * bubble underneath it and stream an ordinary `NEXUS` bubble under that. Two presentation
 * systems in one scroll container, with the card reduced to observing the other one through a
 * MutationObserver. There is supposed to be one companion.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const Surface = require('../../src/features/chat/ConversationSurface.js');
const View = require('../../src/features/together/ui/PrivateConversationView.js');

function hostHooks() {
    const drawn = [];
    const streams = [];
    return {
        drawn,
        streams,
        hooks: {
            addMessage: (sender, text) => drawn.push({ sender, text }),
            beginStream: () => {
                const row = document.createElement('div');
                const textDiv = document.createElement('div');
                row.appendChild(textDiv);
                document.getElementById('chat-history').appendChild(row);
                streams.push({ row, textDiv });
                return { row, textDiv };
            },
            scroll: jest.fn(),
        },
    };
}

function page() {
    document.body.innerHTML =
        '<div id="chat-history"></div><input id="speech-text" placeholder="Message"><button id="speak-btn">Send</button>';
}

beforeEach(() => {
    page();
    Surface.reset();
});

afterEach(() => {
    Surface.reset();
    document.body.innerHTML = '';
});

describe('the default surface is what main.js always did', () => {
    test('user and assistant turns go through the host renderers', () => {
        const h = hostHooks();
        Surface.configure(h.hooks);

        Surface.renderUser('hello');
        Surface.renderAssistant('hi there');
        Surface.renderError('something broke');

        expect(h.drawn).toEqual([
            { sender: 'user', text: 'hello' },
            { sender: 'avatar', text: 'hi there' },
            { sender: 'avatar', text: 'something broke' },
        ]);
    });

    test('a streaming turn fills and settles the host row', () => {
        const h = hostHooks();
        Surface.configure(h.hooks);

        const stream = Surface.beginAssistant();
        stream.append('par');
        stream.append('partial');
        expect(h.streams[0].textDiv.textContent).toBe('partial');
        expect(h.hooks.scroll).toHaveBeenCalled();

        stream.finish('the whole thing');
        expect(h.streams[0].textDiv.textContent).toBe('the whole thing');
        expect(h.streams[0].row.isConnected).toBe(true);
    });

    test('a discarded turn is taken off screen', () => {
        const h = hostHooks();
        Surface.configure(h.hooks);
        const stream = Surface.beginAssistant();
        expect(h.streams[0].row.isConnected).toBe(true);
        stream.discard();
        expect(h.streams[0].row.isConnected).toBe(false);
    });

    test('before the host configures anything, nothing throws', () => {
        // A page without main.js — demo.html, a test — must not crash on a call.
        expect(() => Surface.renderUser('x')).not.toThrow();
        const stream = Surface.beginAssistant();
        expect(() => {
            stream.append('x');
            stream.finish('x');
            stream.discard();
        }).not.toThrow();
    });
});

describe('a surface can be swapped and put back', () => {
    test('use returns the one it replaced, and reset goes home', () => {
        const h = hostHooks();
        const base = Surface.configure(h.hooks);
        const other = { id: 'other', renderUser: jest.fn() };

        const previous = Surface.use(other);
        expect(previous).toBe(base);
        expect(Surface.current()).toBe(other);

        Surface.renderUser('routed');
        expect(other.renderUser).toHaveBeenCalledWith('routed', undefined);
        expect(h.drawn).toHaveLength(0);

        Surface.use(previous);
        expect(Surface.current()).toBe(base);
    });

    test('a surface that throws costs the drawing, not the turn', () => {
        const h = hostHooks();
        Surface.configure(h.hooks);
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        Surface.use({
            id: 'broken',
            renderUser() {
                throw new Error('renderer exploded');
            },
        });

        expect(() => Surface.renderUser('still said')).not.toThrow();
        // Fallen back, so the words reached the screen somewhere.
        expect(h.drawn).toEqual([{ sender: 'user', text: 'still said' }]);
        console.warn.mockRestore();
    });
});

describe('whose turn it is (P8)', () => {
    test('the phase follows the turn, and idles when it ends', () => {
        const h = hostHooks();
        Surface.configure(h.hooks);
        expect(Surface.turn().phase).toBe('idle');

        Surface.renderUser('are you there?');
        expect(Surface.turn().phase).toBe('user');
        expect(Surface.turn().userText).toBe('are you there?');

        const stream = Surface.beginAssistant();
        expect(Surface.turn().phase).toBe('assistant');

        stream.finish('I am.');
        expect(Surface.turn().phase).toBe('idle');
        expect(Surface.turn().assistantEndedAt).toBeGreaterThan(0);
    });

    test('an abandoned turn frees the floor too', () => {
        Surface.configure(hostHooks().hooks);
        Surface.renderUser('x');
        Surface.beginAssistant().discard();
        expect(Surface.turn().phase).toBe('idle');
    });

    test('a non-streaming reply and an error both end the turn', () => {
        // The error path is the one that matters: a consumer left believing she is still
        // composing holds its own timers for the whole of its own timeout.
        Surface.configure(hostHooks().hooks);
        Surface.renderUser('x');
        Surface.renderAssistant('done');
        expect(Surface.turn().phase).toBe('idle');

        Surface.renderUser('y');
        Surface.renderError('something broke');
        expect(Surface.turn().phase).toBe('idle');
    });

    test('a settled turn is not ended twice by a late discard', () => {
        Surface.configure(hostHooks().hooks);
        const seen = [];
        const stop = Surface.observe((event) => seen.push(event.type));
        const stream = Surface.beginAssistant();
        stream.finish('said');
        stream.discard();
        stop();
        expect(seen).toEqual(['assistant-start', 'assistant-end']);
    });

    test('observers see the transitions in order, and unsubscribe', () => {
        Surface.configure(hostHooks().hooks);
        const seen = [];
        const stop = Surface.observe((event) => seen.push(event.type));
        Surface.renderUser('hello');
        Surface.beginAssistant().finish('hi');
        stop();
        Surface.renderUser('ignored');
        expect(seen).toEqual(['user', 'assistant-start', 'assistant-end']);
    });

    test('an observer that throws costs neither the turn nor the other observers', () => {
        Surface.configure(hostHooks().hooks);
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        const seen = [];
        Surface.observe(() => {
            throw new Error('observer exploded');
        });
        Surface.observe((event) => seen.push(event.type));
        expect(() => Surface.renderUser('still said')).not.toThrow();
        expect(seen).toEqual(['user']);
        expect(Surface.turn().phase).toBe('user');
        console.warn.mockRestore();
    });

    test('the phase is recorded even when the renderer throws', () => {
        // Drawing is best-effort; whose turn it is, is not. A consumer holding its beats for
        // somebody mid-sentence must not start talking because a card failed to paint.
        Surface.configure(hostHooks().hooks);
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        Surface.use({
            id: 'broken',
            renderUser() {
                throw new Error('renderer exploded');
            },
        });
        Surface.renderUser('typed anyway');
        expect(Surface.turn().phase).toBe('user');
        console.warn.mockRestore();
    });

    test('a stream handle that throws still ends the turn', () => {
        Surface.configure(hostHooks().hooks);
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        Surface.use({
            id: 'broken',
            beginAssistant: () => ({
                finish() {
                    throw new Error('finish exploded');
                },
            }),
        });
        const stream = Surface.beginAssistant();
        expect(() => stream.finish('whatever')).not.toThrow();
        expect(Surface.turn().phase).toBe('idle');
        console.warn.mockRestore();
    });

    test('the host still gets real nodes through the tracked handle', () => {
        // The YouTube decorator and the attachment renderer work on them.
        const h = hostHooks();
        Surface.configure(h.hooks);
        const stream = Surface.beginAssistant();
        expect(stream.node).toBe(h.streams[0].row);
        expect(stream.textNode).toBe(h.streams[0].textDiv);
    });
});

describe('Private becomes the conversation while it runs', () => {
    let view;

    function mount() {
        const h = hostHooks();
        const base = Surface.configure(h.hooks);
        view = new View.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Romantic' }, scene: 'Coastal Terrace' });
        return { ...h, base };
    }

    afterEach(() => {
        if (view) view.destroy();
        view = null;
    });

    test('mounting installs the Private surface; destroying restores what was there', () => {
        const h = mount();
        expect(Surface.current().id).toBe('private');
        view.destroy();
        view = null;
        expect(Surface.current()).toBe(h.base);
    });

    test('a typed message becomes a row inside the card, not a bubble underneath it', () => {
        const h = mount();
        Surface.renderUser('Really?');

        // Nothing reached the ordinary chat renderer.
        expect(h.drawn).toHaveLength(0);
        const turns = [...document.querySelectorAll('[data-private-turn]')];
        const mine = turns.filter((t) => t.dataset.privateTurn === 'you');
        expect(mine).toHaveLength(1);
        expect(mine[0].textContent).toContain('Really?');
        expect(mine[0].closest('.nexus-private-card')).not.toBeNull();
    });

    test('her reply streams into the same transcript from its first token', () => {
        const h = mount();
        Surface.renderUser('Really?');
        const stream = Surface.beginAssistant();

        stream.append('Really. I don');
        stream.append('Really. I do not think we need anything louder.');
        stream.finish('Really. I do not think we need anything louder.');

        expect(h.streams).toHaveLength(0);
        const her = [...document.querySelectorAll('[data-private-turn="her"]')];
        expect(her[her.length - 1].textContent).toContain('anything louder');
    });

    test('a reply abandoned mid-sentence leaves no empty turn behind', () => {
        mount();
        const before = document.querySelectorAll('[data-private-turn]').length;
        const stream = Surface.beginAssistant();
        expect(document.querySelectorAll('[data-private-turn]').length).toBe(before + 1);

        stream.discard();
        expect(document.querySelectorAll('[data-private-turn]').length).toBe(before);
    });

    test('a finished reply is not removed by a late discard', () => {
        mount();
        const stream = Surface.beginAssistant();
        stream.finish('Said and done.');
        stream.discard();
        expect(document.body.textContent).toContain('Said and done.');
    });

    test('the transcript keeps the recent few rather than growing forever', () => {
        mount();
        for (let i = 0; i < 12; i += 1) {
            Surface.renderUser(`line ${i}`);
        }
        const turns = document.querySelectorAll('[data-private-turn]');
        expect(turns.length).toBeLessThanOrEqual(6);
        // And it keeps the newest, not the oldest.
        expect(document.body.textContent).toContain('line 11');
        expect(document.body.textContent).not.toContain('line 0');
    });

    test('an error inside a private moment still reads as her', () => {
        const h = mount();
        Surface.renderError('I lost my train of thought.');
        expect(h.drawn).toHaveLength(0);
        const her = [...document.querySelectorAll('[data-private-turn="her"]')];
        expect(her[her.length - 1].textContent).toContain('train of thought');
    });
});
