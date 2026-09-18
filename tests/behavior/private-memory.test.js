/**
 * What Private is allowed to remember.
 *
 * The privacy promise on the completion card — nothing from a Private moment is written to
 * Playground Histories — stays true, and that is not what these tests are about. They are
 * about the other half: that the store *cannot* hold content, not merely that today's callers
 * do not put any in. A schema that drops unknown fields is the difference between "we do not
 * store the conversation" and "we can".
 */

/* global describe, test, expect, beforeEach */

const Memory = require('../../src/features/together/PrivateMemory.js');

beforeEach(() => {
    // jsdom's localStorage is real despite tests/setup.js — see CLAUDE.md.
    localStorage.clear();
});

describe('what it keeps', () => {
    test('nothing, until a session completes', () => {
        expect(Memory.read()).toEqual(Memory.EMPTY);
        expect(Memory.isFirstSession()).toBe(true);
        expect(Memory.preferredPreset()).toBeNull();
        expect(localStorage.getItem(Memory.KEY)).toBeNull();
    });

    test('a completed session records the choices and the count', () => {
        Memory.remember({ preset: 'romantic', mood: 'tender', soundtrack: 'choose' });
        const kept = Memory.read();
        expect(kept.preset).toBe('romantic');
        expect(kept.mood).toBe('tender');
        expect(kept.soundtrack).toBe('choose');
        expect(kept.sessions).toBe(1);
        expect(kept.lastAt).toBeGreaterThan(0);
        expect(Memory.isFirstSession()).toBe(false);
        expect(Memory.preferredPreset()).toBe('romantic');
    });

    test('a later session updates rather than replaces what is known', () => {
        Memory.remember({ preset: 'romantic', mood: 'tender', soundtrack: 'none' });
        Memory.remember({ preset: 'sensual' });
        const kept = Memory.read();
        expect(kept.preset).toBe('sensual');
        // Not cleared by a session that did not reach the mood beat.
        expect(kept.mood).toBe('tender');
        expect(kept.soundtrack).toBe('none');
        expect(kept.sessions).toBe(2);
    });

    test('forget removes it entirely', () => {
        Memory.remember({ preset: 'sensual', mood: 'playful' });
        expect(Memory.forget()).toBe(true);
        expect(Memory.read()).toEqual(Memory.EMPTY);
        expect(localStorage.getItem(Memory.KEY)).toBeNull();
    });
});

describe('what it cannot keep', () => {
    test('a field outside the schema does not survive a write', () => {
        Memory.write({
            preset: 'romantic',
            transcript: 'something she said',
            userMessage: 'something he said',
            level: 3,
            scene: 'Coastal Terrace',
        });
        const stored = JSON.parse(localStorage.getItem(Memory.KEY));
        expect(Object.keys(stored).sort()).toEqual(['lastAt', 'mood', 'preset', 'sessions', 'soundtrack']);
        expect(JSON.stringify(stored)).not.toMatch(/something|Coastal/);
    });

    test('a value outside the enum is dropped, not stored', () => {
        Memory.write({ preset: 'anything at all', mood: '<script>', soundtrack: 'loud' });
        const kept = Memory.read();
        expect(kept.preset).toBeNull();
        expect(kept.mood).toBeNull();
        expect(kept.soundtrack).toBeNull();
    });

    test('a hand-edited or corrupted key cannot put arbitrary text in front of a caller', () => {
        localStorage.setItem(Memory.KEY, JSON.stringify({ preset: 'DROP TABLE', sessions: 'lots', lastAt: NaN }));
        const kept = Memory.read();
        expect(kept.preset).toBeNull();
        expect(kept.sessions).toBe(0);
        expect(kept.lastAt).toBe(0);
    });

    test('unparseable storage reads as empty rather than throwing', () => {
        localStorage.setItem(Memory.KEY, 'not json');
        expect(Memory.read()).toEqual(Memory.EMPTY);
    });
});
