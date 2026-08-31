/**
 * Session-protocol fixtures — the cross-repo contract, checked from the client side.
 *
 * tests/fixtures/protocol/ is byte-identical to HomePilot's backend/tests/fixtures/protocol/.
 * Neither repo can see the other, so byte-identity is held by CHECKSUMS.txt: both repos
 * carry the same manifest, both verify their own copy against it, and a fixture edited on
 * one side goes red on that side immediately and shows up as a checksum diff in review.
 *
 * The fixtures exist before the endpoints do, on purpose (spec v1.1 §5.P6, Appendix A):
 * B6/B8 build the mock server and the contract tests from these files, not the other way
 * round.
 */

/* global describe, test, expect, beforeAll */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'fixtures', 'protocol');

/** The forward-compatibility case deliberately carries a type no peer knows. */
const FORWARD_COMPAT = 'unknown_type';

function read(file) {
    return JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
}

describe('protocol fixture set', () => {
    let index;

    beforeAll(() => {
        index = read('index.json');
    });

    test('index.json and the directory agree, both ways', () => {
        const onDisk = fs
            .readdirSync(DIR)
            .filter((f) => f.endsWith('.json') && f !== 'index.json')
            .sort();
        const listed = index.fixtures.map((f) => f.file).sort();
        expect(listed).toEqual(onDisk);
    });

    test('covers every message type in spec v1.1 §6.9 and addendum v1.2 §14.3', () => {
        const names = index.fixtures.map((f) => f.name).sort();
        expect(names).toEqual(
            [
                // v1.1 client → server
                'hello',
                'ctx',
                'user_event',
                'vision_ask',
                'chat_meta',
                'pong',
                // v1.1 server → client
                'intent',
                'say',
                'vision_insight',
                'scene',
                'error',
                'ping',
                // v1.2 additions
                'adult_verify_request',
                'streak',
                'display',
                'adult_ack',
                // spec v1.1 §6.10 — the voice uplink (B10)
                'voice_offer',
                'voice_ice',
                'voice_transcript',
                'voice_end',
                'voice_answer',
                'voice_state',
                // forward compatibility
                FORWARD_COMPAT,
            ].sort()
        );
    });

    test('protocol version is 1 everywhere', () => {
        expect(index.protocolVersion).toBe(1);
        for (const entry of index.fixtures) {
            expect(read(entry.file).message.v).toBe(1);
        }
    });

    test('each fixture carries every field its message contract requires', () => {
        for (const entry of index.fixtures) {
            const fixture = read(entry.file);
            expect(fixture.direction).toBe(entry.direction);
            for (const key of fixture.required) {
                expect(Object.keys(fixture.message)).toContain(key);
            }
        }
    });

    test('type matches name, except the forward-compatibility case', () => {
        for (const entry of index.fixtures) {
            const fixture = read(entry.file);
            if (fixture.name === FORWARD_COMPAT) {
                // The whole point: a type neither peer knows, which both must ignore silently.
                expect(fixture.message.type).not.toBe(fixture.name);
                expect(fixture.note).toMatch(/ignore it silently/);
            } else {
                expect(fixture.message.type).toBe(fixture.name);
            }
        }
    });

    test('server intents name only whitelisted emotes', () => {
        // §6.8: server-initiated intents get no special powers — they pass the same
        // whitelist as a locally parsed tag, so a fixture may not seed an illegal one.
        const whitelist = JSON.parse(
            fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'behavior.config.json'), 'utf8')
        ).emoteWhitelist;
        expect(whitelist).toContain(read('s2c-intent.json').message.name);
        for (const intent of read('s2c-vision_insight.json').message.intents) {
            expect(whitelist).toContain(intent.name);
        }
    });
});

describe('byte-identity with the HomePilot copy', () => {
    test('every fixture matches CHECKSUMS.txt', () => {
        const manifest = fs
            .readFileSync(path.join(DIR, 'CHECKSUMS.txt'), 'utf8')
            .trim()
            .split('\n')
            .map((line) => {
                const [hash, file] = line.split(/\s+/);
                return { hash, file };
            });

        for (const { hash, file } of manifest) {
            const actual = crypto
                .createHash('sha256')
                .update(fs.readFileSync(path.join(DIR, file)))
                .digest('hex');
            expect(`${file} ${actual}`).toBe(`${file} ${hash}`);
        }
    });

    test('the manifest covers every fixture — no file slips through unhashed', () => {
        const hashed = fs
            .readFileSync(path.join(DIR, 'CHECKSUMS.txt'), 'utf8')
            .trim()
            .split('\n')
            .map((line) => line.split(/\s+/)[1])
            .sort();
        const onDisk = fs
            .readdirSync(DIR)
            .filter((f) => f.endsWith('.json'))
            .sort();
        expect(hashed).toEqual(onDisk);
    });
});
