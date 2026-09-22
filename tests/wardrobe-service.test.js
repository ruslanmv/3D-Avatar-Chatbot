describe('Wardrobe Forge integration', () => {
    beforeEach(() => {
        jest.resetModules();
        window.localStorage.clear();
        delete window.NEXUS_WARDROBE_CONFIG;
        delete window.NEXUS_WARDROBE_CONFIG_API;
        delete window.NEXUS_WARDROBE_CLIENT;
        delete window.NEXUS_STATIC_WARDROBE_SOURCE;
        delete window.NEXUS_REMOTE_WARDROBE_SOURCE;
        delete window.NEXUS_WARDROBE_CONTROLLER;
        delete window.NEXUS_WARDROBE_SERVICE;
    });

    test('defaults to static wardrobe with remote generation disabled', () => {
        const Config = require('../src/wardrobe/WardrobeConfig.js');
        const config = Config.resolveWardrobeConfig();

        expect(config.enabled).toBe(true);
        expect(config.staticManifest).toBe('/vendor/wardrobe/wardrobe.json');
        expect(config.apiUrl).toBe('');
        expect(config.remoteGeneration).toBe(false);
    });

    test('static source resolves Forge bundle URLs relative to the manifest', async () => {
        const StaticSource = require('../src/wardrobe/StaticWardrobeSource.js');
        const fetchImpl = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                looks: [
                    {
                        id: 'look_1',
                        name: 'Evening',
                        vrmUrl: 'looks/mira/look-1/look.vrm',
                        previewUrl: 'looks/mira/look-1/preview.webp',
                    },
                ],
            }),
        });

        const source = new StaticSource({
            manifestUrl: '/vendor/wardrobe/wardrobe.json',
            fetchImpl,
        });
        const looks = await source.listLooks();

        expect(looks).toHaveLength(1);
        expect(looks[0].source).toBe('static');
        expect(looks[0].vrmUrl).toContain('/vendor/wardrobe/looks/mira/look-1/look.vrm');
        expect(looks[0].previewUrl).toContain('/vendor/wardrobe/looks/mira/look-1/preview.webp');
    });

    test('remote client submits the stable generate facade', async () => {
        const ClientApi = require('../src/wardrobe/WardrobeClient.js');
        const fetchImpl = jest.fn().mockResolvedValue({
            ok: true,
            status: 202,
            json: async () => ({
                jobId: 'job_1',
                status: 'queued',
                statusUrl: '/v1/jobs/job_1',
                eventsUrl: '/v1/jobs/job_1/events',
            }),
        });

        const client = new ClientApi.WardrobeClient({
            baseUrl: 'https://forge.example',
            fetchImpl,
        });
        const accepted = await client.generate({
            avatarUrl: 'https://app.example/mira.vrm',
            avatarId: 'mira',
            prompt: 'burgundy evening dress',
        });

        expect(accepted.jobId).toBe('job_1');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const call = fetchImpl.mock.calls[0];
        expect(call[0]).toBe('https://forge.example/v1/generate');
        const payload = JSON.parse(call[1].body);
        expect(payload.avatar.url).toBe('https://app.example/mira.vrm');
        expect(payload.prompt).toBe('burgundy evening dress');
    });

    test('service preserves static operation without a remote server', async () => {
        require('../src/wardrobe/WardrobeConfig.js');
        require('../src/wardrobe/StaticWardrobeSource.js');
        require('../src/wardrobe/RemoteWardrobeSource.js');
        require('../src/wardrobe/WardrobeClient.js');
        require('../src/wardrobe/WardrobeController.js');
        const Service = require('../src/wardrobe/WardrobeService.js');

        window.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                looks: [{ id: 'look_1', name: 'Static', vrmUrl: 'looks/static.vrm' }],
            }),
        });

        const service = new Service({
            config: {
                staticManifest: '/vendor/wardrobe/wardrobe.json',
                apiUrl: '',
                remoteGeneration: false,
            },
            viewer: { avatarManager: {} },
        });

        expect(service.remoteEnabled).toBe(false);
        const looks = await service.listLooks();
        expect(looks).toHaveLength(1);
        expect(looks[0].source).toBe('static');
    });
});
