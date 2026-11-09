/**
 * AX16. What a model wrote for itself never reaches the person. The cases are the lines a real
 * Italian session showed in the chat (2026-11-09).
 */
/* global describe, test, expect, afterEach */
const Clean = require('../src/features/chat/ReplyClean.js');
const Parser = require('../src/xr/MotionBlockParser.js');

const MOTION =
    '```motion {"commands":[{"type":"look_at","target":"user_head"}],"interruptible":true,"priority":"normal"} ```';

describe('a "THOUGHT:" paragraph is not hers to say', () => {
    test('the reported line: an English thought run into an Italian answer', () => {
        const reply =
            'THOUGHT: The user wants to go to the lake. I need to acknowledge their agreement and state that we are going to the lake. Since the system is already taking us there, I just need to confirm. Certo, andiamo al lago. È un posto meraviglioso per ammirare il cielo stellato.';
        expect(Clean.stripThought(reply, { lang: 'it-IT' })).toBe(
            'Certo, andiamo al lago. È un posto meraviglioso per ammirare il cielo stellato.'
        );
    });

    test('in English, the sentences about the reply go and the reply stays', () => {
        const reply =
            'Thought: The user agreed. I should confirm we are leaving. Of course, let us go to the lake. It is lovely at night.';
        expect(Clean.stripThought(reply, { lang: 'en-US' })).toBe(
            'Of course, let us go to the lake. It is lovely at night.'
        );
    });

    test('a thought in its own paragraph is cut at the paragraph break', () => {
        const reply = '**Reasoning:** They want music. I will offer some.\n\nVuoi che metta qualcosa di morbido?';
        expect(Clean.stripThought(reply, { lang: 'it-IT' })).toBe('Vuoi che metta qualcosa di morbido?');
    });

    test('an ordinary reply is never rewritten, even when it talks about thinking', () => {
        for (const reply of [
            'Ci ho pensato: il lago è perfetto stasera.',
            'I thought about you today. The user manual can wait.',
            'Mm. I like that you said it out loud.',
        ])
            expect(Clean.stripThought(reply, { lang: 'it-IT' })).toBe(reply);
    });

    test('a reply rebuilt from the reasoning channel keeps only its answer', () => {
        const reasoning =
            'The user greeted me. I should answer warmly and briefly.\n\nCiao! Che bello sentirti stasera.';
        expect(Clean.fromReasoning(reasoning, { lang: 'it-IT' })).toBe('Ciao! Che bello sentirti stasera.');
    });
});

describe('every line posted outside the main seam is cleaned the same way', () => {
    afterEach(() => {
        delete global.NEXUS_MOTION_PARSER;
    });

    test('the reported start line loses its motion block', () => {
        global.NEXUS_MOTION_PARSER = Parser;
        expect(Clean.forDisplay(`Benvenuto nella suite, ti va di esplorare? ${MOTION}`, { lang: 'it-IT' })).toBe(
            'Benvenuto nella suite, ti va di esplorare?'
        );
    });

    test('without the parser loaded, a motion block and any tag still never reach the chat', () => {
        expect(
            Clean.forDisplay(`È stato un piacere condividere questo momento con te. ${MOTION} <activity name="end"/>`)
        ).toBe('È stato un piacere condividere questo momento con te.');
    });

    test('run: true executes the plan through NEXUS_MOTION, as the main chat does', () => {
        const ran = [];
        const g = {
            NEXUS_MOTION: { processReply: (t) => (ran.push(t), Parser.extract(t).cleanText) },
        };
        expect(Clean.forDisplay(`Ciao! ${MOTION}`, { global: g, run: true, lang: 'it-IT' })).toBe('Ciao!');
        expect(ran).toHaveLength(1);
    });
});

describe('ActivityVoice posts the clean line (the reported leak)', () => {
    const Session = require('../src/companion/CompanionSession');
    const Voice = require('../src/companion/ActivityVoice');
    const flush = () => new Promise((r) => setTimeout(r, 0));

    function memory() {
        const m = new Map();
        return {
            getItem: (k) => (m.has(k) ? m.get(k) : null),
            setItem: (k, v) => m.set(k, String(v)),
            removeItem: (k) => m.delete(k),
        };
    }

    test('a start line with a motion block is posted without it, with or without the shared cleaner', async () => {
        for (const withCleaner of [true, false]) {
            if (withCleaner) global.NEXUS_REPLY_CLEAN = Clean;
            else delete global.NEXUS_REPLY_CLEAN;
            const session = Session.create({ storage: memory() });
            session.load();
            const posted = [];
            Voice.attach({
                session,
                surface: {
                    turn: () => ({ phase: 'idle' }),
                    renderAssistant: (l) => posted.push(l),
                    history: () => ({ addMessage() {}, persist() {} }),
                },
                ask: async () => `Andiamo a scoprire qualche posto speciale, dove ti piacerebbe iniziare? ${MOTION}`,
                reset: { currentEpoch: () => 1, isCurrent: () => true },
                label: (id) => id,
                say: () => {},
            });
            session.enter('life', 'relax');
            await flush();
            expect(posted).toEqual(['Andiamo a scoprire qualche posto speciale, dove ti piacerebbe iniziare?']);
        }
        delete global.NEXUS_REPLY_CLEAN;
    });
});
