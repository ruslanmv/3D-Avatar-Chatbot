/**
 * @jest-environment node
 *
 * @file Unit tests for OllaBridge model fetching + grouped selector.
 * @module tests/ollabridge-models
 *
 * Regression: the client used to reduce /v1/models to a flat, alphabetically
 * sorted list of ids, discarding x_source. Five private local models then
 * rendered as 20+ unlabelled entries mixed with cloud routes and personas.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Load LLMManager.js (an IIFE that assigns to global.LLMManager) into an
 * isolated vm context. The module references a bare `fetch`, which resolves
 * against the sandbox — so tests inject their mock as `sandbox.fetch`.
 */
function loadLLMManager() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'LLMManager.js'), 'utf8');
    const sandbox = { window: {}, console, setTimeout, clearTimeout };
    sandbox.global = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return sandbox;
}

describe('OllaBridge _fetchOllaBridgeModels', () => {
    let sandbox;
    let LLMManager;
    let LLMProvider;

    beforeAll(() => {
        sandbox = loadLLMManager();
        LLMManager = sandbox.window.LLMManager;
        LLMProvider = sandbox.window.LLMProvider;
    });

    function makeManager(dataPayload) {
        const mgr = new LLMManager();
        mgr.updateSettings({
            provider: LLMProvider.OLLABRIDGE,
            ollabridge: {
                api_key: 'k',
                pair_token: '',
                auth_mode: 'api-key',
                base_url: 'https://app.ollabridge.com',
            },
            proxy: { enable_proxy: false },
        });
        // The module calls a bare `fetch` — inject the mock into the sandbox.
        sandbox.fetch = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => dataPayload,
        }));
        return mgr;
    }

    test('preserves x_source metadata and does not sort ids', async () => {
        const mgr = makeManager({
            object: 'list',
            data: [
                { id: 'llama3.1:latest', x_source: 'shared_device', x_device_name: 'My PC', x_available: true },
                { id: 'gemma:2b', x_source: 'shared_device', x_device_name: 'My PC', x_available: true },
                { id: 'free-best', x_source: 'route_alias' },
            ],
        });

        const result = await mgr._fetchOllaBridgeModels();

        // Server order preserved (not alphabetically sorted).
        expect(result.models).toEqual(['llama3.1:latest', 'gemma:2b', 'free-best']);

        // Structured entries carry the source metadata.
        expect(result.modelEntries).toHaveLength(3);
        expect(result.modelEntries[0]).toMatchObject({
            id: 'llama3.1:latest',
            source: 'shared_device',
            deviceName: 'My PC',
            available: true,
        });
        expect(result.modelEntries[2].source).toBe('route_alias');
        expect(result.error).toBeNull();
    });

    test('drops unavailable models from the flat list but keeps them as entries', async () => {
        const mgr = makeManager({
            data: [
                { id: 'online:latest', x_source: 'shared_device', x_available: true },
                { id: 'offline:latest', x_source: 'shared_device', x_available: false },
            ],
        });

        const result = await mgr._fetchOllaBridgeModels();
        expect(result.models).toEqual(['online:latest']);
        expect(result.modelEntries).toHaveLength(2);
    });

    test('infers persona source when x_source is absent', async () => {
        const mgr = makeManager({
            data: [{ id: 'persona:my-therapist--v2' }],
        });
        const result = await mgr._fetchOllaBridgeModels();
        expect(result.modelEntries[0].source).toBe('homepilot');
        expect(result.modelEntries[0].displayName).toBe('My Therapist');
    });

    test('classifies persona/personality ids as HomePilot even when the relay tags them shared_device', async () => {
        // Personas shared from a local HomePilot reach the cloud over the relay,
        // which tags every relay model x_source:'shared_device'. The id prefix
        // must win so they group under HomePilot Agents, not "My Private Models".
        const mgr = makeManager({
            data: [
                { id: 'llama3:8b', x_source: 'shared_device', x_available: true },
                { id: 'persona:girlfriend--d1ee423b', x_source: 'shared_device', x_available: true },
                { id: 'personality:assistant', x_source: 'shared_device', x_available: true },
            ],
        });
        const result = await mgr._fetchOllaBridgeModels();
        const bySource = Object.fromEntries(result.modelEntries.map((e) => [e.id, e.source]));
        expect(bySource['llama3:8b']).toBe('shared_device');
        expect(bySource['persona:girlfriend--d1ee423b']).toBe('homepilot');
        expect(bySource['personality:assistant']).toBe('homepilot');
    });
});
