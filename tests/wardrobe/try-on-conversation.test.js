/**
 * W17. The haul hosted in the conversation: her lines come from the model, land in the chat
 * and the history like any reply, never over somebody, never after CLEAR, never with a
 * directive that runs — and nothing private is put on the record.
 */
const { TryOnConversation, PROMPTS } = require('../../src/wardrobe/TryOnConversation.js');

function surface({ phase = 'idle' } = {}) {
    const posted = [];
    const kept = [];
    const s = {
        phase,
        posted,
        kept,
        renderAssistant: jest.fn((text) => posted.push(text)),
        history() {
            return { addMessage: (role, text) => kept.push([role, text]), persist: jest.fn() };
        },
        turn: () => ({ phase: s.phase }),
    };
    return s;
}

function host({ answer = 'Okay this is SO cute!', phase, epochs } = {}) {
    const s = surface({ phase });
    let now = 100000;
    let epoch = 1;
    const reset = epochs || { currentEpoch: () => epoch, isCurrent: (e) => e === epoch };
    const ask = jest.fn(async () => answer);
    const say = jest.fn();
    const conv = new TryOnConversation({ surface: s, ask, say, reset, now: () => now, global: {} });
    return {
        conv,
        s,
        ask,
        say,
        tick: (ms) => (now += ms),
        clear: () => (epoch += 1),
    };
}

const LOOK = (name, extra) => ({ id: name, name, prompt: 'black satin cocktail dress', ...extra });

describe('TryOnConversation', () => {
    test('a reveal is her line from the model: drawn, kept in history, saved and spoken', async () => {
        const { conv, s, ask, say } = host();
        const result = await conv.reveal({ look: LOOK('Little black dress'), position: 0, total: 3 });
        expect(result.line).toBe('Okay this is SO cute!');
        expect(s.posted).toEqual(['Okay this is SO cute!']);
        expect(s.kept).toEqual([['assistant', 'Okay this is SO cute!']]);
        expect(say).toHaveBeenCalledWith('Okay this is SO cute!');
        // The instruction tells her what she is wearing, the details and the haul shape.
        const instruction = ask.mock.calls[0][0];
        expect(instruction).toMatch(/Little black dress/);
        expect(instruction).toMatch(/black satin cocktail dress/);
        expect(instruction).toMatch(/rating out of 10|keep it or return it/);
        expect(instruction).toMatch(/YouTube try-on haul/);
    });

    test('the haul has a shape: open, reveals that alternate rating and keep-or-return, outro', async () => {
        expect(PROMPTS.open({ total: 4, canCreate: true, ideas: ['Yellow sundress'] })).toMatch(/Yellow sundress/);
        expect(PROMPTS.reveal({ name: 'A', beat: 0 })).toMatch(/rating out of 10/);
        expect(PROMPTS.reveal({ name: 'A', beat: 1 })).toMatch(/keep it or return it/);
        const outro = PROMPTS.outro({ tried: ['A', 'B'], favorites: ['B'], kept: 'B', privateCount: 0 });
        expect(outro).toMatch(/You tried: A, B/);
        expect(outro).toMatch(/keeping “B”/);
    });

    test('every third reveal asks for the spin', async () => {
        const { conv, tick } = host();
        const spins = [];
        for (let i = 0; i < 6; i += 1) {
            tick(20000);
            spins.push((await conv.reveal({ look: LOOK('L' + i) })).spin);
        }
        expect(spins).toEqual([false, false, true, false, false, true]);
    });

    test('browsing quickly is not five segments; a look made for her always gets one', async () => {
        const { conv, ask, tick } = host();
        await conv.reveal({ look: LOOK('A') });
        tick(2000);
        expect((await conv.reveal({ look: LOOK('B') })).line).toBeNull();
        tick(2000);
        expect((await conv.reveal({ look: LOOK('C'), generated: true })).line).not.toBeNull();
        expect(ask).toHaveBeenCalledTimes(2);
    });

    test('never over somebody: a beat while a turn is running is dropped', async () => {
        const { conv, s, ask } = host({ phase: 'assistant' });
        expect((await conv.reveal({ look: LOOK('A'), generated: true })).line).toBeNull();
        expect(ask).not.toHaveBeenCalled();
        expect(s.posted).toEqual([]);
    });

    test('CLEAR while she was answering writes nothing', async () => {
        let release;
        const h = host();
        h.ask.mockImplementation(() => new Promise((resolve) => (release = resolve)));
        const pending = h.conv.reveal({ look: LOOK('A'), generated: true });
        h.clear();
        release('Love it');
        expect((await pending).line).toBeNull();
        expect(h.s.posted).toEqual([]);
        expect(h.s.kept).toEqual([]);
    });

    test('nothing in her line ever runs or shows: tags and markup are scrubbed', async () => {
        const { conv, s } = host({ answer: 'Gorgeous! <wardrobe action="keep"/> <b>wow</b>' });
        await conv.reveal({ look: LOOK('A'), generated: true });
        expect(s.posted[0]).not.toMatch(/[<>]|wardrobe/);
    });

    test('private looks stay off the record, and the outro does not name them', async () => {
        const { conv, s, ask, tick } = host();
        expect((await conv.reveal({ look: LOOK('Lace set'), private: true, generated: true })).line).toBeNull();
        tick(20000);
        await conv.reveal({ look: LOOK('Sundress') });
        await conv.outro({ favorites: ['Sundress'], kept: null });
        const outro = ask.mock.calls[ask.mock.calls.length - 1][0];
        expect(outro).toMatch(/Sundress/);
        expect(outro).not.toMatch(/Lace set/);
        expect(outro).toMatch(/Do not mention any other looks/);
        expect(s.posted.join(' ')).not.toMatch(/Lace/);
    });

    test('no model, no host: nothing is asked and nothing posted', async () => {
        const conv = new TryOnConversation({ surface: surface(), global: {} });
        expect(conv.available()).toBe(false);
        expect((await conv.reveal({ look: LOOK('A'), generated: true })).line).toBeNull();
    });

    test("callLLM's 'Provider not configured.' is not her line", async () => {
        const { conv, s, say } = host({ answer: 'Provider not configured.' });
        expect((await conv.reveal({ look: LOOK('A'), generated: true })).line).toBeNull();
        expect(s.posted).toEqual([]);
        expect(s.kept).toEqual([]);
        expect(say).not.toHaveBeenCalled();
    });
});
