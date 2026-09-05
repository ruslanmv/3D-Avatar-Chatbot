/**
 * Sense adapters — the engine's inputs (B4).
 *
 * The acceptance is three sentences: a tag split across chunk boundaries still parses, a
 * tag never reaches the chat transcript or the TTS audio, and the existing motion-block
 * tests stay green. The first two are here; the third is guaranteed by construction,
 * because nothing in src/xr/ was edited — the tag channel decorates NEXUS_MOTION at boot
 * and restores it on detach, which the last block proves.
 */

/* global describe, test, expect, beforeEach, jest */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const TagAdapter = require('../../src/behavior/adapters/LLMTagAdapter.js');
const SentimentFallback = require('../../src/behavior/adapters/SentimentFallback.js');
const SpeechAdapter = require('../../src/behavior/adapters/SpeechAdapter.js');
const IdleAdapter = require('../../src/behavior/adapters/IdleAdapter.js');
const GazeAdapter = require('../../src/behavior/adapters/GazeAdapter.js');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'behavior.config.json'), 'utf8'));

const { EmoteTagParser } = TagAdapter;

/** Feed a reply one token at a time, exactly as the streaming callback does. */
function stream(parser, tokens, clock = () => 0) {
    let accumulated = '';
    const fired = [];
    const displayed = [];
    for (const token of tokens) {
        accumulated += token;
        fired.push(...parser.feed(accumulated, clock()));
        displayed.push(EmoteTagParser.maskStreaming(accumulated));
    }
    return { fired, displayed, accumulated };
}

describe('the tag parser', () => {
    let parser;

    beforeEach(() => {
        parser = new EmoteTagParser({ whitelist: CONFIG.emoteWhitelist, minGapMs: 0 });
    });

    test('reads a whole tag', () => {
        expect(parser.feed('Hello! [[emote:happy 0.8]]')).toEqual([{ name: 'happy', intensity: 0.8, source: 'llm' }]);
    });

    test('a tag split across chunk boundaries still parses', () => {
        // The acceptance case. Every split point in the tag, one at a time.
        const text = 'Nice to see you [[emote:wave 0.7]] again';
        for (let cut = 1; cut < text.length; cut++) {
            const fresh = new EmoteTagParser({ whitelist: CONFIG.emoteWhitelist, minGapMs: 0 });
            const { fired } = stream(fresh, [text.slice(0, cut), text.slice(cut)]);
            expect(`cut at ${cut}: ${JSON.stringify(fired)}`).toBe(
                `cut at ${cut}: [{"name":"wave","intensity":0.7,"source":"llm"}]`
            );
        }
    });

    test('a tag arriving one character at a time fires exactly once', () => {
        const { fired } = stream(parser, 'ok [[emote:happy 0.5]] done'.split(''));
        expect(fired).toHaveLength(1);
        expect(fired[0].name).toBe('happy');
    });

    test('never fires the same tag twice, however many tokens follow it', () => {
        const { fired } = stream(parser, ['[[emote:sad 0.4]]', ' a', ' b', ' c', ' d']);
        expect(fired).toHaveLength(1);
    });

    test('intensity is optional and defaults rather than dropping the tag', () => {
        expect(parser.feed('[[emote:thinking]]')[0]).toEqual({
            name: 'thinking',
            intensity: 0.6,
            source: 'llm',
        });
    });

    test('a name nobody whitelisted is dropped silently', () => {
        expect(parser.feed('[[emote:backflip 0.9]]')).toEqual([]);
        expect(parser.dropped.unknown).toBe(1);
    });

    test('a malformed tag is dropped and the text survives', () => {
        expect(parser.feed('[[emote]] [[emote:]] [[ happy ]] [emote:happy]')).toEqual([]);
        expect(EmoteTagParser.strip('[[emote]] hello')).toBe('[[emote]] hello');
    });

    test('the rate limit holds: three per reply, and a minimum gap', () => {
        const limited = new EmoteTagParser({ whitelist: CONFIG.emoteWhitelist, maxPerReply: 3, minGapMs: 1500 });
        let clock = 0;
        const tick = () => (clock += 2000);
        const text = '[[emote:happy]] a [[emote:sad]] b [[emote:angry]] c [[emote:wave]] d';
        let accumulated = '';
        const fired = [];
        for (const part of text.split(' ')) {
            accumulated += part + ' ';
            fired.push(...limited.feed(accumulated, tick()));
        }
        expect(fired).toHaveLength(3);
        expect(limited.dropped.budget).toBe(1);

        const bursty = new EmoteTagParser({ whitelist: CONFIG.emoteWhitelist, minGapMs: 1500 });
        bursty.feed('[[emote:happy]]', 1000);
        expect(bursty.feed('[[emote:happy]] [[emote:sad]]', 1100)).toEqual([]);
        expect(bursty.dropped.rateLimited).toBe(1);
    });

    test('reset gives the next reply a fresh budget', () => {
        const limited = new EmoteTagParser({ whitelist: CONFIG.emoteWhitelist, maxPerReply: 1, minGapMs: 0 });
        expect(limited.feed('[[emote:happy]]')).toHaveLength(1);
        limited.reset();
        expect(limited.feed('[[emote:sad]]')).toHaveLength(1);
    });
});

describe('a tag never reaches the user', () => {
    test('stripped from the final text', () => {
        expect(EmoteTagParser.strip('I did it! [[emote:celebrate 0.9]] Really.')).toBe('I did it! Really.');
    });

    test('and from every frame of the stream, including the half-arrived tag', () => {
        // The leak that matters: without masking the partial tail, the user watches
        // "[[emo" appear and vanish. Every intermediate frame must be clean.
        const parser = new EmoteTagParser({ whitelist: CONFIG.emoteWhitelist, minGapMs: 0 });
        const { displayed } = stream(parser, 'Great! [[emote:happy 0.8]] Well done.'.split(''));
        for (const frame of displayed) {
            expect(frame).not.toMatch(/\[\[/);
            expect(frame).not.toMatch(/emote:/);
        }
        expect(displayed[displayed.length - 1]).toBe('Great! Well done.');
    });

    test('the spacing a removed tag leaves behind is tidied', () => {
        expect(EmoteTagParser.strip('Hello [[emote:wave]] there')).toBe('Hello there');
        expect(EmoteTagParser.strip('Yes [[emote:agree]] .')).toBe('Yes.');
    });

    test('text with no tags is returned untouched', () => {
        const plain = 'A perfectly ordinary reply, with [brackets] and a [[double]] one.';
        expect(EmoteTagParser.strip(plain)).toBe(plain);
        expect(EmoteTagParser.maskStreaming(plain)).toBe(plain);
    });
});

describe('the adapter wraps NEXUS_MOTION rather than editing it', () => {
    let bus;
    let motion;
    let calls;

    beforeEach(() => {
        bus = new EventBus();
        calls = [];
        motion = {
            maskStreaming: (text) => {
                calls.push('mask');
                return text.replace(/```motion[\s\S]*$/, '');
            },
            processReply: (text) => {
                calls.push('process');
                return text.replace(/```motion[\s\S]*```/, '').trim();
            },
            systemPromptSuffix: () => '\n[existing motion contract]',
        };
    });

    test('the original still runs, and its result is what gets masked', () => {
        const adapter = TagAdapter.attach({ bus, config: CONFIG, motion });
        const out = motion.maskStreaming('Hi [[emote:happy 0.8]] ```motion {"a":1}');
        expect(calls).toContain('mask');
        // The motion fence is the original's work; the tag and the space it stood in are ours.
        expect(out).toBe('Hi');
        adapter.detach();
    });

    test('both channels are masked in one pass', () => {
        const adapter = TagAdapter.attach({ bus, config: CONFIG, motion });
        const reply = 'Done! [[emote:celebrate 0.9]]\n```motion\n{"commands":[]}\n```';
        expect(motion.processReply(reply)).toBe('Done!');
        adapter.detach();
    });

    test('the tag contract is appended to the existing one, not instead of it', () => {
        const adapter = TagAdapter.attach({ bus, config: CONFIG, motion });
        const suffix = motion.systemPromptSuffix();
        expect(suffix).toContain('[existing motion contract]');
        expect(suffix).toContain('[[emote:<name> <intensity 0..1>]]');
        expect(suffix).toContain('happy');
        expect(suffix).toContain('Never invent names');
        adapter.detach();
    });

    test('intents reach the bus while the reply is still streaming', () => {
        const adapter = TagAdapter.attach({ bus, config: CONFIG, motion });
        const seen = [];
        bus.on('intent', (i) => seen.push(i.name));

        let accumulated = '';
        for (const token of ['I ', 'am ', 'so ', 'glad ', '[[emote:', 'happy 0.9]]', ' to ', 'hear ', 'it.']) {
            accumulated += token;
            motion.maskStreaming(accumulated);
        }
        expect(seen).toEqual(['happy']);
        adapter.detach();
    });

    test('llm:token carries the delta, not the whole buffer', () => {
        const adapter = TagAdapter.attach({ bus, config: CONFIG, motion });
        const tokens = [];
        bus.on('llm:token', (t) => tokens.push(t.text));
        let accumulated = '';
        for (const token of ['one ', 'two ', 'three']) {
            accumulated += token;
            motion.maskStreaming(accumulated);
        }
        expect(tokens).toEqual(['one ', 'two ', 'three']);
        adapter.detach();
    });

    test('detach restores the originals exactly — the motion stack is untouched after', () => {
        const before = {
            mask: motion.maskStreaming,
            process: motion.processReply,
            suffix: motion.systemPromptSuffix,
        };
        const adapter = TagAdapter.attach({ bus, config: CONFIG, motion });
        expect(motion.maskStreaming).not.toBe(before.mask);
        adapter.detach();
        expect(motion.maskStreaming).toBe(before.mask);
        expect(motion.processReply).toBe(before.process);
        expect(motion.systemPromptSuffix).toBe(before.suffix);
        expect(motion.__nexusBdWrapped).toBeUndefined();
    });

    test('attaching twice does not double-wrap', () => {
        const first = TagAdapter.attach({ bus, config: CONFIG, motion });
        const wrapped = motion.maskStreaming;
        const second = TagAdapter.attach({ bus, config: CONFIG, motion });
        expect(motion.maskStreaming).toBe(wrapped);
        second.detach();
        first.detach();
    });

    test('a missing NEXUS_MOTION is survivable', () => {
        expect(() => TagAdapter.attach({ bus, config: CONFIG, motion: null }).detach()).not.toThrow();
    });
});

describe('SentimentFallback defers to the existing EmotionEngine', () => {
    let bus;
    let engine;

    beforeEach(() => {
        bus = new EventBus();
        engine = { analyze: jest.fn(() => ({ emotion: 'happy', intensity: 0.8 })) };
    });

    test('it has no opinion of its own — with no EmotionEngine it says nothing', () => {
        // The behavioural form of "carries no second keyword table": strip the engine away
        // and the adapter has nothing left to decide with. A duplicate table would still
        // fire here, and would have drifted from EmotionEngine's within a month.
        const adapter = SentimentFallback.attach({ bus, config: CONFIG, emotionEngine: null });
        expect(adapter.onReply('I am absolutely delighted, this is wonderful!')).toBeNull();
        adapter.detach();
    });

    test('the only mapping it owns is EmotionEngine vocabulary onto the whitelist', () => {
        for (const intent of Object.values(SentimentFallback.EMOTION_TO_INTENT)) {
            expect(CONFIG.emoteWhitelist).toContain(intent);
        }
    });

    test('fires when the model sent no tag', () => {
        const adapter = SentimentFallback.attach({ bus, config: CONFIG, emotionEngine: engine });
        const intent = adapter.onReply('That is wonderful news!');
        expect(engine.analyze).toHaveBeenCalled();
        expect(intent).toEqual({ name: 'happy', intensity: 0.8, source: 'sentiment' });
        adapter.detach();
    });

    test('stays quiet when the model did send one — explicit beats inferred', () => {
        const adapter = SentimentFallback.attach({ bus, config: CONFIG, emotionEngine: engine });
        bus.emit('intent', { name: 'sad', intensity: 0.7, source: 'llm' });
        expect(adapter.onReply('That is wonderful news!')).toBeNull();
        adapter.detach();
    });

    test('a weak guess is not worth moving her body for', () => {
        engine.analyze = () => ({ emotion: 'happy', intensity: 0.1 });
        const adapter = SentimentFallback.attach({ bus, config: CONFIG, emotionEngine: engine });
        expect(adapter.onReply('hm')).toBeNull();
        adapter.detach();
    });

    test('an emotion outside the whitelist is not forced into one that is', () => {
        engine.analyze = () => ({ emotion: 'nostalgic', intensity: 0.9 });
        const adapter = SentimentFallback.attach({ bus, config: CONFIG, emotionEngine: engine });
        expect(adapter.onReply('remember that?')).toBeNull();
        adapter.detach();
    });

    test('an engine that throws costs the fallback, not the reply', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        engine.analyze = () => {
            throw new Error('nope');
        };
        const adapter = SentimentFallback.attach({ bus, config: CONFIG, emotionEngine: engine });
        expect(adapter.onReply('anything')).toBeNull();
        warn.mockRestore();
        adapter.detach();
    });
});

describe('SpeechAdapter', () => {
    test('reports both edges exactly once', () => {
        const bus = new EventBus();
        const blackboard = new Blackboard();
        const speech = { speaking: false };
        const events = [];
        bus.on('tts:start', () => events.push('start'));
        bus.on('tts:end', () => events.push('end'));

        const adapter = SpeechAdapter.attach({ bus, blackboard, speech, intervalMs: 1e9 });
        expect(adapter.poll()).toBeNull();
        speech.speaking = true;
        expect(adapter.poll()).toBe('tts:start');
        expect(adapter.poll()).toBeNull();
        expect(blackboard.flags.ttsSpeaking).toBe(true);
        speech.speaking = false;
        expect(adapter.poll()).toBe('tts:end');
        expect(events).toEqual(['start', 'end']);
        adapter.detach();
    });

    test('detaching mid-sentence closes the Talk state rather than leaving it stuck on', () => {
        const bus = new EventBus();
        const speech = { speaking: true };
        const events = [];
        bus.on('tts:end', () => events.push('end'));
        const adapter = SpeechAdapter.attach({ bus, speech, intervalMs: 1e9 });
        adapter.poll();
        adapter.detach();
        expect(events).toEqual(['end']);
    });

    test('a Piper provider is preferred over speechSynthesis when both are present', () => {
        const bus = new EventBus();
        const adapter = SpeechAdapter.attach({
            bus,
            speech: { speaking: false },
            provider: { isSpeaking: () => true },
            intervalMs: 1e9,
        });
        expect(adapter.poll()).toBe('tts:start');
        adapter.detach();
    });
});

describe('IdleAdapter', () => {
    test('goes idle after the threshold and comes back on any activity', () => {
        const bus = new EventBus();
        const blackboard = new Blackboard();
        let clock = 0;
        const adapter = IdleAdapter.attach({
            bus,
            blackboard,
            target: null,
            idleAfterMs: 20000,
            now: () => clock,
        });

        clock = 19000;
        expect(adapter.tick()).toBeNull();
        clock = 21000;
        expect(adapter.tick()).toBe('user:idle');
        expect(adapter.tick()).toBeNull(); // does not repeat
        expect(blackboard.flags.userIdle).toBe(true);

        expect(adapter.markActive()).toBe('user:active');
        expect(adapter.isIdle).toBe(false);
        expect(blackboard.flags.userIdle).toBe(false);
        adapter.detach();
    });

    test('listens passively, and removes what it added', () => {
        const added = [];
        const removed = [];
        const target = {
            addEventListener: (type, fn, opts) => added.push([type, opts]),
            removeEventListener: (type) => removed.push(type),
        };
        const adapter = IdleAdapter.attach({ bus: new EventBus(), target });
        expect(added.map(([type]) => type)).toEqual(IdleAdapter.ACTIVITY_EVENTS);
        for (const [, opts] of added) expect(opts).toEqual({ passive: true });
        adapter.detach();
        expect(removed).toEqual(IdleAdapter.ACTIVITY_EVENTS);
    });
});

describe('GazeAdapter', () => {
    test('reports the edges and keeps reporting a held look', () => {
        const bus = new EventBus();
        const blackboard = new Blackboard();
        let clock = 0;
        const tracker = { isLookingAtAvatar: () => true };
        const adapter = GazeAdapter.attach({ bus, blackboard, tracker, now: () => clock });

        expect(adapter.tick()).toBe('gaze:user-look-avatar');
        expect(adapter.tick()).toBeNull(); // too soon to repeat
        clock = 600;
        expect(adapter.tick()).toBe('gaze:user-look-avatar');
        expect(blackboard.flags.lookingAtAvatar).toBe(true);

        tracker.isLookingAtAvatar = () => false;
        expect(adapter.tick()).toBe('gaze:user-look-away');
        adapter.detach();
    });

    test('a held look carries how long it has lasted, so "> 1.5 s" is expressible', () => {
        const bus = new EventBus();
        let clock = 0;
        const held = [];
        bus.on('gaze:user-look-avatar', (p) => held.push(p.ms));
        const adapter = GazeAdapter.attach({
            bus,
            tracker: { isLookingAtAvatar: () => true },
            now: () => clock,
        });
        adapter.tick();
        clock = 1600;
        adapter.tick();
        expect(held).toEqual([0, 1600]);
        adapter.detach();
    });

    test('no tracker means no events, not an exception', () => {
        const adapter = GazeAdapter.attach({ bus: new EventBus(), tracker: null });
        expect(adapter.tick()).toBeNull();
        adapter.detach();
    });

    test('falls back to head angles when the tracker exposes no helper', () => {
        const bus = new EventBus();
        const tracker = { headYaw: 0.1, headPitch: 0.1 };
        const adapter = GazeAdapter.attach({ bus, tracker });
        expect(adapter.tick()).toBe('gaze:user-look-avatar');
        adapter.detach();
    });
});
