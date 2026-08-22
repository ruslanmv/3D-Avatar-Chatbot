/**
 * Tests for the ActionRegistry (M-series): the data-only source of truth for
 * capability tiers and multilingual action phrases.
 *
 * These tests are the enforcement half of the design. The runtime
 * authorities stay literal on purpose — whitelists are security boundaries —
 * and THIS suite fails the moment the registry and those literals drift.
 */

/* global describe, test, expect */

const Registry = require('../src/xr/ActionRegistry');
const Parser = require('../src/xr/MotionBlockParser');
const Policy = require('../src/xr/MotionPolicy');
const FastPath = require('../src/xr/IntentFastPath');
const ClipMap = require('../src/xr/MotionClipMap');

describe('ActionRegistry ↔ runtime tables never drift', () => {
    test('tier table covers exactly the parser whitelist', () => {
        expect(Registry.commandTypes().sort()).toEqual(Parser.ALLOWED_TYPES.slice().sort());
    });

    test("the 'movement' tier equals MotionPolicy.MOVEMENT_TYPES", () => {
        expect(Registry.typesInTier('movement').sort()).toEqual(Policy.MOVEMENT_TYPES.slice().sort());
    });

    test("the 'control' tier equals MotionPolicy.ALWAYS_ALLOWED", () => {
        expect(Registry.typesInTier('control').sort()).toEqual(Policy.ALWAYS_ALLOWED.slice().sort());
    });

    test('every tier value is one of the three known tiers', () => {
        for (const type of Registry.commandTypes()) {
            expect(['control', 'movement', 'expressive']).toContain(Registry.tierOf(type));
        }
    });

    test('every fast-path label has a registry action (icon + phrases)', () => {
        for (const rule of FastPath.RULES) {
            const a = Registry.action(rule.label);
            expect(a).not.toBeNull();
        }
    });
});

describe('ActionRegistry phrase corpus (EN/ES/IT)', () => {
    test('every action ships at least 2 phrases per language', () => {
        for (const a of Registry.ACTIONS) {
            for (const lang of ['en', 'es', 'it']) {
                const phrases = Registry.phrasesFor(a.id, lang);
                expect(phrases.length).toBeGreaterThanOrEqual(2);
                for (const p of phrases) expect(typeof p).toBe('string');
            }
        }
    });

    test('every action has a toast icon', () => {
        for (const a of Registry.ACTIONS) {
            expect(typeof a.icon).toBe('string');
            expect(a.icon.length).toBeGreaterThan(0);
        }
    });

    test('action ids are unique and lowercase_snake', () => {
        const seen = new Set();
        for (const a of Registry.ACTIONS) {
            expect(a.id).toMatch(/^[a-z0-9_]+$/);
            expect(seen.has(a.id)).toBe(false);
            seen.add(a.id);
        }
    });

    test('phrasesFor flattens all languages when no language is given', () => {
        const all = Registry.phrasesFor('dance');
        expect(all.length).toBeGreaterThanOrEqual(6);
        expect(all).toEqual(expect.arrayContaining(['dance', 'baila', 'balla']));
    });

    test('gesture-only extras resolve to playable clips through the B5 index', () => {
        for (const id of ['victory', 'backflip']) {
            expect(ClipMap.resolve(id)).not.toBeNull();
        }
    });
});
