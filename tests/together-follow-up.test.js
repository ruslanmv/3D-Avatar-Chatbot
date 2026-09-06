/**
 * "yes" and "can you play it" mean something (batches T4, T6).
 *
 * The transcript that started this work has three turns, and a pattern matcher can only ever
 * fix the first of them:
 *
 *     YOU  can you find music about relaxation   ← T4
 *     YOU  yes                                   ← nothing to match
 *     YOU  can you play it                       ← "it" has no referent
 *
 * A pattern is a function of one message. The second and third turns are only requests *given*
 * the first, so no amount of widening reaches them; what is missing is a memory one turn deep.
 */

const Ask = require('../src/features/youtube/YouTubeAsk.js');
const Follow = require('../src/features/together/PlayFollowUp.js');

beforeEach(() => Follow.clear());

describe('T4 — the fast path accepts how people actually ask', () => {
    const q = (t) => (Ask.parseIntent(t) || {}).query || null;

    test('a polite lead-in is still a request', () => {
        expect(q('can you find music about relaxation')).toBe('music about relaxation');
        expect(q('could you play some relaxing music')).toBe('relaxing music');
        expect(q('please play some jazz music')).toBe('jazz music');
    });

    test('and the anchor still holds, which is what keeps it honest', () => {
        // Dropping `^` outright would make every one of these a request to play something.
        for (const text of [
            'we could play something later',
            'I want to relax',
            'my kids play music all day',
            'remind me to play the album tonight',
        ]) {
            expect(q(text)).toBeNull();
        }
    });

    test('the modal needs a "you", or it is not addressed to her', () => {
        // "could we", "should I", "we could" are not requests to this assistant.
        expect(q('could we play music')).toBeNull();
        expect(q('can you play music')).not.toBeNull();
    });

    test('a play verb alone is never enough', () => {
        // Every pattern also needs the word youtube or a media noun. That is what keeps the
        // widened verb list safe.
        expect(q('find my keys')).toBeNull();
        expect(q('start the timer')).toBeNull();
        expect(q('can you find my glasses')).toBeNull();
    });

    test('a bare genre still goes to the model, on purpose', () => {
        // "play some jazz" has no media noun. Adding genres would let "play some football" in,
        // and the model path handles it in one round trip — ambiguity is its job, not a regex's.
        expect(q('play some jazz')).toBeNull();
    });
});

describe('T6 — one topic, two turns', () => {
    test('the transcript, replayed, ends with something to play', () => {
        // The whole design exists to change this ending.
        Follow.note('can you find music about relaxation');
        expect(Follow.resolve('yes')).toEqual({
            query: 'music about relaxation',
            kind: 'music',
            source: 'follow-up',
        });
    });

    test('and "can you play it" resolves the same topic', () => {
        Follow.note('can you find music about relaxation');
        expect(Follow.resolve('can you play it').query).toBe('music about relaxation');
    });

    test('the topic drops the asking and keeps the subject', () => {
        // A query containing "can you find" returns videos titled *can you find*.
        expect(Follow.topicOf('can you find music about relaxation')).toBe('music about relaxation');
        expect(Follow.topicOf('please play some lofi beats')).toBe('lofi beats');
    });

    test('audio is remembered as music, everything else as video', () => {
        Follow.note('find me a song about rain');
        expect(Follow.peek().kind).toBe('music');
        Follow.clear();
        Follow.note('find me a video about rain');
        expect(Follow.peek().kind).toBe('video');
    });

    test('a yes with nothing pending plays nothing', () => {
        expect(Follow.resolve('yes')).toBeNull();
    });

    test('a yes to something else entirely plays nothing', () => {
        // Two unrelated turns and the topic is gone, so a later "yes" cannot resurrect it.
        Follow.note('can you find music about relaxation');
        Follow.note('what is the weather like');
        Follow.note('and tomorrow');
        expect(Follow.resolve('yes')).toBeNull();
    });

    test('a message with content of its own is not a follow-up', () => {
        // Anything that says something is the pattern matcher's or the model's, not this.
        Follow.note('can you find music about relaxation');
        expect(Follow.resolve('yes but something calmer')).toBeNull();
        expect(Follow.resolve('what else can you do')).toBeNull();
    });

    test('words that only sometimes mean yes are left out', () => {
        // A false positive here starts music at somebody mid-sentence.
        Follow.note('find me a song');
        for (const maybe of ['right', 'fine', 'well', 'sure thing mate', 'no']) {
            expect(Follow.resolve(maybe)).toBeNull();
        }
    });

    test('the assistant own suggestions are never the topic', () => {
        // A model that listed five genres has not been chosen from; playing the first because
        // somebody said "yes" would be putting words in their mouth. Only user text is noted.
        Follow.note('can you find music about relaxation');
        const before = Follow.peek().topic;
        Follow.note('yes'); // an affirmative points at the topic, it never becomes one
        expect(Follow.peek().topic).toBe(before);
    });

    test('a handled message clears rather than sets', () => {
        // Something is about to play; a following "yes" would start a second thing.
        Follow.note('play some lofi music', { handled: true });
        expect(Follow.peek()).toBeNull();
    });

    test('playing clears it, so one topic is never fulfilled twice', () => {
        Follow.note('find me a song about rain');
        expect(Follow.resolve('yes')).not.toBeNull();
        Follow.clear();
        expect(Follow.resolve('yes')).toBeNull();
    });
});

describe('the wiring', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'youtube', 'YouTubeAsk.js'), 'utf8');

    test('the composer consults the memory before giving up', () => {
        expect(src).toContain('NEXUS_PLAY_FOLLOWUP');
        expect(src).toMatch(/follow\.resolve\(input\.value\)/);
    });

    test('and notes every message that was not already handled', () => {
        expect(src).toMatch(/follow\.note\(input\.value, \{ handled: Boolean\(intent\) \}\)/);
    });

    test('and clears the memory when it plays from it', () => {
        expect(src).toMatch(/follow\.clear\(\);\s*\n\s*void fulfil/);
    });
});
