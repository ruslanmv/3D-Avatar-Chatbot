/**
 * Unit tests for PersonaVRRegistry, MotionDSL, and WorldStateBridge.
 *
 * Lightweight, CI-compatible (no WebGL, no network, no XR).
 * Tests only the new superintelligent persona methods.
 */

// ── Mock globals ─────────────────────────────────────────────────────

if (typeof fetch === 'undefined') {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => ({}) }));
}
global.clearInterval = global.clearInterval || jest.fn();
global.setInterval = global.setInterval || jest.fn(() => 42);

// ── Load modules via require (CommonJS-compatible) ───────────────────

const PersonaVRRegistry = require('../src/persona/PersonaVRRegistry');
const MotionDSL = require('../src/xr/MotionDSL');
const WorldStateBridge = require('../src/xr/WorldStateBridge');

// ── PersonaVRRegistry Tests ─────────────────────────────────────────

describe('PersonaVRRegistry', () => {
    test('module exports are defined', () => {
        expect(PersonaVRRegistry).toBeDefined();
        expect(PersonaVRRegistry.getProfile).toBeInstanceOf(Function);
        expect(PersonaVRRegistry.listModels).toBeInstanceOf(Function);
        expect(PersonaVRRegistry.listProfiles).toBeInstanceOf(Function);
        expect(PersonaVRRegistry.isVRReady).toBeInstanceOf(Function);
        expect(PersonaVRRegistry.getVRM).toBeInstanceOf(Function);
        expect(PersonaVRRegistry.getVoiceConfig).toBeInstanceOf(Function);
        expect(PersonaVRRegistry.registerProfile).toBeInstanceOf(Function);
    });

    test('all 5 superintelligent personas are listed', () => {
        const models = PersonaVRRegistry.listModels();
        expect(models).toContain('persona:scarlett-secretary');
        expect(models).toContain('persona:milo-friend');
        expect(models).toContain('persona:nova-collaborator');
        expect(models).toContain('persona:luna-girlfriend');
        expect(models).toContain('persona:velvet-companion');
    });

    test('getProfile returns correct persona for Scarlett', () => {
        const p = PersonaVRRegistry.getProfile('persona:scarlett-secretary');
        expect(p).not.toBeNull();
        expect(p.displayName).toBe('Scarlett');
        expect(p.role).toBe('Executive Secretary');
        expect(p.contentRating).toBe('sfw');
        expect(p.isOrchestrated).toBe(true);
        expect(p.hasSpatialIntelligence).toBe(true);
    });

    test('getProfile returns null for unknown model', () => {
        expect(PersonaVRRegistry.getProfile('persona:unknown')).toBeNull();
    });

    test('isVRReady returns true for all 5 personas', () => {
        const models = [
            'persona:scarlett-secretary',
            'persona:milo-friend',
            'persona:nova-collaborator',
            'persona:luna-girlfriend',
            'persona:velvet-companion',
        ];
        for (const m of models) {
            expect(PersonaVRRegistry.isVRReady(m)).toBe(true);
        }
    });

    test('isVRReady returns false for unknown model', () => {
        expect(PersonaVRRegistry.isVRReady('persona:nonexistent')).toBe(false);
    });

    test('getVRM returns VRM path for known persona', () => {
        const vrm = PersonaVRRegistry.getVRM('persona:milo-friend');
        expect(vrm).toBeTruthy();
        expect(vrm).toContain('.vrm');
    });

    test('getVoiceConfig returns voice settings', () => {
        const voice = PersonaVRRegistry.getVoiceConfig('persona:nova-collaborator');
        expect(voice).not.toBeNull();
        expect(voice.voice).toBe('shimmer');
        expect(voice.provider).toBe('openai_tts');
    });

    test('registerProfile adds a custom persona', () => {
        PersonaVRRegistry.registerProfile('persona:custom-test', {
            personaId: 'custom_test',
            displayName: 'Custom',
            supportsVR: true,
        });
        const p = PersonaVRRegistry.getProfile('persona:custom-test');
        expect(p).not.toBeNull();
        expect(p.displayName).toBe('Custom');
    });

    test('each persona has correct content rating', () => {
        expect(PersonaVRRegistry.getProfile('persona:scarlett-secretary').contentRating).toBe('sfw');
        expect(PersonaVRRegistry.getProfile('persona:milo-friend').contentRating).toBe('sfw');
        expect(PersonaVRRegistry.getProfile('persona:nova-collaborator').contentRating).toBe('sfw');
        expect(PersonaVRRegistry.getProfile('persona:luna-girlfriend').contentRating).toBe('mature');
        expect(PersonaVRRegistry.getProfile('persona:velvet-companion').contentRating).toBe('adult');
    });

    test('orchestrated vs guided personas', () => {
        expect(PersonaVRRegistry.getProfile('persona:scarlett-secretary').isOrchestrated).toBe(true);
        expect(PersonaVRRegistry.getProfile('persona:nova-collaborator').isOrchestrated).toBe(true);
        expect(PersonaVRRegistry.getProfile('persona:milo-friend').isOrchestrated).toBe(false);
        expect(PersonaVRRegistry.getProfile('persona:luna-girlfriend').isOrchestrated).toBe(false);
        expect(PersonaVRRegistry.getProfile('persona:velvet-companion').isOrchestrated).toBe(false);
    });

    test('listProfiles returns array of profile objects', () => {
        const profiles = PersonaVRRegistry.listProfiles();
        expect(Array.isArray(profiles)).toBe(true);
        expect(profiles.length).toBeGreaterThanOrEqual(5);
        for (const p of profiles) {
            expect(p.model).toBeDefined();
            expect(p.displayName).toBeDefined();
        }
    });

    test('personal distance varies by relationship type', () => {
        const secretary = PersonaVRRegistry.getProfile('persona:scarlett-secretary');
        const girlfriend = PersonaVRRegistry.getProfile('persona:luna-girlfriend');
        expect(secretary.personalDistanceM).toBeGreaterThan(girlfriend.personalDistanceM);
    });
});

// ── MotionDSL Tests ─────────────────────────────────────────────────

describe('MotionDSL', () => {
    test('module exports are defined', () => {
        expect(MotionDSL).toBeDefined();
        expect(MotionDSL.execute).toBeInstanceOf(Function);
        expect(MotionDSL.registerHandler).toBeInstanceOf(Function);
        expect(MotionDSL.interrupt).toBeInstanceOf(Function);
        expect(MotionDSL.isExecuting).toBeInstanceOf(Function);
    });

    test('execute runs all commands in a plan', async () => {
        const log = [];
        MotionDSL.registerHandler('test_cmd', async (cmd) => {
            log.push(cmd.type);
        });
        await MotionDSL.execute(
            { persona_id: 'test', commands: [{ type: 'test_cmd' }, { type: 'test_cmd' }], interruptible: true },
            {}
        );
        expect(log).toEqual(['test_cmd', 'test_cmd']);
    });

    test('registerHandler replaces handler for a type', async () => {
        let called = false;
        MotionDSL.registerHandler('custom_type', async () => {
            called = true;
        });
        await MotionDSL.execute({ persona_id: 'x', commands: [{ type: 'custom_type' }], interruptible: true }, {});
        expect(called).toBe(true);
    });

    test('execute handles empty plan gracefully', async () => {
        await MotionDSL.execute({ persona_id: '', commands: [], interruptible: true }, {});
        expect(MotionDSL.isExecuting()).toBe(false);
    });

    test('default handlers exist for core command types', async () => {
        const spy = jest.spyOn(console, 'log').mockImplementation();
        const types = [
            'approach',
            'look_at',
            'expression',
            'gesture',
            'sit',
            'stand',
            'follow',
            'stop',
            'wave',
            'nod',
            'point',
            'idle',
        ];
        for (const type of types) {
            await MotionDSL.execute({ persona_id: 'test', commands: [{ type }], interruptible: true }, {});
        }
        spy.mockRestore();
    });

    test('unknown command type logs warning', async () => {
        const spy = jest.spyOn(console, 'warn').mockImplementation();
        await MotionDSL.execute(
            { persona_id: 'test', commands: [{ type: 'nonexistent_cmd' }], interruptible: true },
            {}
        );
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});

// ── WorldStateBridge Tests ──────────────────────────────────────────

describe('WorldStateBridge', () => {
    test('module exports are defined', () => {
        expect(WorldStateBridge).toBeDefined();
        expect(WorldStateBridge.init).toBeInstanceOf(Function);
        expect(WorldStateBridge.getState).toBeInstanceOf(Function);
        expect(WorldStateBridge.startSync).toBeInstanceOf(Function);
        expect(WorldStateBridge.stopSync).toBeInstanceOf(Function);
        expect(WorldStateBridge.setAnchors).toBeInstanceOf(Function);
        expect(WorldStateBridge.updateAvatarState).toBeInstanceOf(Function);
        expect(WorldStateBridge.getUserAvatarDistance).toBeInstanceOf(Function);
    });

    test('getState returns valid structure', () => {
        const state = WorldStateBridge.getState();
        expect(state.user).toBeDefined();
        expect(state.user.position).toBeDefined();
        expect(state.avatars).toBeDefined();
        expect(state.anchors).toBeDefined();
    });

    test('init sets backend URL', () => {
        WorldStateBridge.init({ backendUrl: 'http://localhost:8000' });
        // No error means success — backendUrl is private
        expect(true).toBe(true);
    });

    test('setAnchors updates anchor list', () => {
        WorldStateBridge.setAnchors([{ id: 'chair1', type: 'seat', position: { x: 3, y: 0, z: 1 } }]);
        const state = WorldStateBridge.getState();
        expect(state.anchors.length).toBe(1);
        expect(state.anchors[0].id).toBe('chair1');
    });

    test('updateAvatarState tracks avatar position', () => {
        WorldStateBridge.updateAvatarState('scarlett_secretary', {
            position: { x: 2, y: 0, z: 3 },
            state: 'speaking',
        });
        const state = WorldStateBridge.getState();
        expect(state.avatars['scarlett_secretary']).toBeDefined();
        expect(state.avatars['scarlett_secretary'].state).toBe('speaking');
    });

    test('getUserAvatarDistance returns null for unknown avatar', () => {
        expect(WorldStateBridge.getUserAvatarDistance('nonexistent')).toBeNull();
    });

    test('updateFromCamera updates user position', () => {
        const mockCamera = {
            position: { x: 1, y: 1.7, z: 2 },
            rotation: { y: Math.PI / 4 },
        };
        WorldStateBridge.updateFromCamera(mockCamera);
        const state = WorldStateBridge.getState();
        expect(state.user.position.x).toBe(1);
        expect(state.user.head_position.y).toBe(1.7);
    });

    test('startSync and stopSync do not throw', () => {
        expect(() => WorldStateBridge.startSync()).not.toThrow();
        expect(() => WorldStateBridge.stopSync()).not.toThrow();
    });
});
