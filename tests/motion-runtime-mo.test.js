'use strict';

/**
 * MO1–MO3. "sit down" — "Mi siedo qui vicino." — and nothing on screen (issue #150).
 *
 * Measured in a real browser before these fixes:
 *   - the Living-NPC stack was opt-in, so onUserUtterance returned at its first line for everyone
 *     who never opened Settings → EXPERIMENTAL (hips 0.894 m before and after "sit down");
 *   - with it on, "come with me" set following=true and called walkToPoint, but the locomotion
 *     update returned outside VR for every state, so on desktop she never moved;
 *   - "sirt down" matched no rule at all;
 *   - with the stack off the model was told nothing about her body and narrated actions freely;
 *   - a sit clip that failed to load left state.sitting true.
 * After them: sit lowers the hips to 0.529 m, "come with me" walks her 0 → 3.15 m toward the
 * viewer on desktop. These tests pin each cause.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const FastPath = require('../src/xr/IntentFastPath');
const Policy = require('../src/xr/MotionPolicy');
const MI = require('../src/xr/MotionIntegration');

describe('MO3 — the words people actually type reach the body', () => {
    const cases = {
        sit: [
            'sit down',
            'sirt down',
            'sitt down',
            'please sit down',
            'sit here',
            'siediti',
            'mettiti seduta',
            'siediti vicino a me',
        ],
        stand: ['stand up', 'alzati'],
        dance: ['dance', "let's dance", 'balla', 'balliamo', 'dacne'],
        follow: ['come with me', 'follow me', 'folow me', 'seguimi', 'vieni con me'],
        stop: ['stop', 'fermati'],
    };
    for (const [label, phrases] of Object.entries(cases)) {
        test(`${label}: ${phrases.join(' / ')}`, () => {
            for (const phrase of phrases) expect([phrase, FastPath.match(phrase)?.label]).toEqual([phrase, label]);
        });
    }

    test('a corrected typo says what it was read as', () => {
        expect(FastPath.match('sirt down')).toMatchObject({ label: 'sit', corrected: 'sit down' });
        expect(FastPath.match('sit down').corrected).toBeUndefined();
    });

    test('real words near a command, and ordinary sentences, are not commands', () => {
        for (const phrase of [
            'set the table',
            'I sat down yesterday',
            'top',
            'lance',
            'dunce',
            'fellow',
            'how are you',
            'stop being silly',
        ]) {
            expect([phrase, FastPath.match(phrase)]).toEqual([phrase, null]);
        }
    });

    test('typo correction only looks at short commands', () => {
        expect(FastPath.match('sirt down by the river with me')).toBeNull();
    });
});

describe('MO1 — a fresh install has a body', () => {
    afterEach(() => {
        localStorage.removeItem(Policy.KEY_ENABLED);
        localStorage.removeItem(Policy.KEY_MOVEMENT);
        Policy._setOverride(null);
    });

    test('with nothing stored, posture and following are allowed on desktop', () => {
        Policy._setOverride(null);
        expect(Policy.isEnabled()).toBe(true);
        expect(Policy.allows('sit', { inVR: false })).toBe(true);
        expect(Policy.allows('follow', { inVR: false })).toBe(true);
    });

    test('Settings shows the policy default, so saving cannot switch her off by accident', () => {
        const src = require('fs').readFileSync(require('path').join(__dirname, '../src/main.js'), 'utf8');
        const block = src.slice(src.indexOf("const npcEnabledEl = document.getElementById('npc-enabled')"));
        expect(block.slice(0, 900)).toMatch(/DEFAULTS\.enabled/);
        expect(block.slice(0, 900)).toMatch(/DEFAULTS\.movement/);
    });
});

describe('MO2 — the conversation never claims what the body did not do', () => {
    let playResult;
    beforeEach(() => {
        Policy._setOverride({ enabled: true, movement: 'all' });
        MI.state.booted = true;
        MI.state.sitting = false;
        MI.state.laying = false;
        MI.state.lastAction = null;
        playResult = { ok: false, reason: 'all_candidates_failed', tried: ['a.bvh'] };
        window.NEXUS_MOTION_CLIPS = {
            play: () => Promise.resolve(playResult),
            stop: () => {},
            availableNames: () => [],
        };
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        delete window.NEXUS_MOTION_CLIPS;
        Policy._setOverride(null);
        MI.state.booted = false;
        console.warn.mockRestore();
    });

    test('a sit clip that never played does not leave her "seated"', async () => {
        MI.state.sitting = true; // what the sit handler sets before the clip loads
        MI.playAnimation('sit');
        await new Promise((r) => setTimeout(r, 0));
        expect(MI.state.sitting).toBe(false);
        expect(MI.state.lastAction).toEqual({ type: 'sit', result: 'all_candidates_failed' });
    });

    test('a sit clip that played keeps her seated', async () => {
        playResult = { ok: true, duration: 6, loop: true, sticky: true };
        MI.state.sitting = true;
        MI.playAnimation('sit');
        await new Promise((r) => setTimeout(r, 0));
        expect(MI.state.sitting).toBe(true);
    });

    test('with body control off the model is told she cannot move', () => {
        Policy._setOverride({ enabled: false });
        const suffix = MI.systemPromptSuffix();
        expect(suffix).toMatch(/cannot sit, stand up/);
        expect(suffix).toMatch(/Never say or imply/);
    });
});

describe('MO1 — a point-walk runs outside VR', () => {
    class V3 {
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
        set(x, y, z) {
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
        }
        copy(v) {
            return this.set(v.x, v.y, v.z);
        }
        lengthSq() {
            return this.x * this.x + this.y * this.y + this.z * this.z;
        }
        length() {
            return Math.sqrt(this.lengthSq());
        }
        normalize() {
            const l = this.length() || 1;
            return this.set(this.x / l, this.y / l, this.z / l);
        }
    }
    class Q {
        setFromAxisAngle() {
            return this;
        }
        slerp() {
            return this;
        }
        angleTo() {
            return 0; // turning is not what this test measures
        }
    }

    let Loco;
    beforeEach(() => {
        window.THREE = { Vector3: V3, Quaternion: Q };
        window.NEXUS_LOCOMOTION_CONFIG = { isEnabled: () => true, get: () => undefined };
        window.NEXUS_VIEWER = { renderer: { xr: { isPresenting: false } } };
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.isolateModules(() => require('../src/AvatarLocomotionSystem'));
        Loco = window.NEXUS_LOCOMOTION;
    });
    afterEach(() => {
        console.log.mockRestore();
        delete window.THREE;
        delete window.NEXUS_LOCOMOTION_CONFIG;
        delete window.NEXUS_VIEWER;
        delete window.NEXUS_LOCOMOTION;
    });

    test('on desktop she walks to the point and stops there', () => {
        const root = { position: new V3(0, 0, 0), quaternion: new Q(), userData: { isVRM: true } };
        Loco.init(root, null);
        Loco.walkToPoint(0, 3);
        expect(Loco.isWalking()).toBe(true);
        for (let i = 0; i < 400 && Loco.isWalking(); i++) Loco.update(1 / 30);
        expect(root.position.z).toBeGreaterThan(2.5);
        expect(Loco.isWalking()).toBe(false);
    });

    test('an idle machine outside VR still does nothing', () => {
        const root = { position: new V3(0, 0, 0), quaternion: new Q(), userData: {} };
        Loco.init(root, null);
        for (let i = 0; i < 30; i++) Loco.update(1 / 30);
        expect(root.position.z).toBe(0);
        expect(Loco.isWalking()).toBe(false);
    });
});
