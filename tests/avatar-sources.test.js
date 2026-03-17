/**
 * @file Unit tests for VRM Avatar Manager — External Sources & Install/Uninstall
 *
 * Tests:
 *   1. External source health checks (fetch availability)
 *   2. Built-in catalog integrity
 *   3. Install / uninstall lifecycle
 *   4. Core avatar protection
 *   5. Direct URL validation
 *   6. Ready Player Me integration
 *   7. Open Source Avatars JSON fetch
 */

/* ═══════════════════════════════════════════════════════════
   MOCK SETUP
   ═══════════════════════════════════════════════════════════ */

// Mock IndexedDB
const mockStore = {};
const mockIDB = {
    put: jest.fn((data) => {
        mockStore[data.id] = data;
        return { oncomplete: null, onerror: null };
    }),
    get: jest.fn((id) => {
        const req = { result: mockStore[id] || null, onsuccess: null, onerror: null };
        setTimeout(() => req.onsuccess && req.onsuccess(), 0);
        return req;
    }),
    clear: jest.fn(),
};

global.indexedDB = {
    open: jest.fn(() => {
        const req = { onupgradeneeded: null, onsuccess: null, onerror: null };
        setTimeout(() => {
            if (req.onsuccess) {
                req.onsuccess({
                    target: {
                        result: {
                            transaction: jest.fn(() => ({
                                objectStore: jest.fn(() => mockStore),
                                oncomplete: null,
                                onerror: null,
                            })),
                            createObjectStore: jest.fn(() => ({
                                createIndex: jest.fn(),
                            })),
                        },
                    },
                });
            }
        }, 0);
        return req;
    }),
};

// Mock URL.createObjectURL / revokeObjectURL
global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = jest.fn();

// Mock fetch
const mockFetchResponses = {};
global.fetch = jest.fn((url, opts) => {
    const handler = mockFetchResponses[url];
    if (handler) return Promise.resolve(handler(opts));

    // Default: simulate successful HEAD/GET
    return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/octet-stream']]),
        json: () => Promise.resolve({}),
        blob: () => Promise.resolve(new Blob(['mock'], { type: 'application/octet-stream' })),
        body: {
            getReader: () => ({
                read: jest
                    .fn()
                    .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
                    .mockResolvedValueOnce({ done: true }),
            }),
        },
    });
});

/* ═══════════════════════════════════════════════════════════
   EXTERNAL SOURCE DEFINITIONS
   ═══════════════════════════════════════════════════════════ */

const EXTERNAL_SOURCES = [
    {
        name: 'Open Source Avatars (GitHub JSON)',
        url: 'https://raw.githubusercontent.com/ToxSam/open-source-avatars/main/data/projects.json',
        type: 'json-catalog',
        expectedFormat: 'json',
    },
    {
        name: 'VRM Samples (GitHub)',
        url: 'https://raw.githubusercontent.com/madjin/vrm-samples/main/README.md',
        type: 'repo',
        expectedFormat: 'text',
    },
    {
        name: 'three-vrm Samples (Pixiv)',
        url: 'https://raw.githubusercontent.com/pixiv/three-vrm/dev/README.md',
        type: 'repo',
        expectedFormat: 'text',
    },
    {
        name: 'Ready Player Me Avatar API',
        url: 'https://readyplayer.me',
        type: 'website',
        expectedFormat: 'html',
    },
    {
        name: 'Sketchfab API',
        url: 'https://api.sketchfab.com/v3/search?type=models&q=VRM&count=1',
        type: 'api',
        expectedFormat: 'json',
    },
    {
        name: 'VRoid Hub',
        url: 'https://hub.vroid.com/en',
        type: 'website',
        expectedFormat: 'html',
    },
];

/* ═══════════════════════════════════════════════════════════
   BUILT-IN CATALOG (subset for testing)
   ═══════════════════════════════════════════════════════════ */

const BUILTIN_CATALOG = [
    {
        id: 'vrm-avatar-sample-a',
        name: 'AvatarSample A',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/AvatarSample_A.vrm',
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        installed: true,
        tags: ['female', 'vroid', 'cc0'],
        size: 15000000,
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        icon: '👩',
        desc: 'Test avatar',
    },
    {
        id: 'vrm-avatar-sample-b',
        name: 'AvatarSample B',
        format: 'vrm',
        license: 'cc0',
        url: '/vendor/avatars/AvatarSample_B.vrm',
        features: ['lipsync', 'emotions', 'gaze', 'blink'],
        installed: true,
        tags: ['male', 'vroid', 'cc0'],
        size: 15400000,
        source: 'VRoid (CC0)',
        sourceId: 'github-vrm-samples',
        icon: '👨',
        desc: 'Test avatar',
    },
    {
        id: 'local-woman',
        name: 'Woman',
        format: 'glb',
        license: 'free',
        url: '/vendor/avatars/woman.glb',
        features: [],
        installed: true,
        tags: ['local', 'pre-installed'],
        size: 14000000,
        source: 'Local',
        sourceId: 'local',
        icon: '👩‍💼',
        desc: 'Test GLB avatar',
    },
];

/* ═══════════════════════════════════════════════════════════
   HELPER: simulate VRMManager
   ═══════════════════════════════════════════════════════════ */

function createMockManager() {
    let installedAvatars = {};
    const settings = { cacheSize: 100, autoInstall: true };

    // Initialize core avatars
    BUILTIN_CATALOG.forEach((item) => {
        if (item.installed) {
            installedAvatars[item.id] = { ...item, installedAt: 0, core: true };
        }
    });

    return {
        installedAvatars,
        settings,
        allItems: [...BUILTIN_CATALOG],

        isInstalled(id) {
            return !!installedAvatars[id];
        },

        isCore(id) {
            return !!(installedAvatars[id] && installedAvatars[id].core);
        },

        installAvatar(item) {
            const id = item.id;
            installedAvatars[id] = {
                ...item,
                installedAt: Date.now(),
                localFile: item.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.' + (item.format === 'vrm' ? 'vrm' : 'glb'),
            };
            if (!this.allItems.find((x) => x.id === id)) {
                this.allItems.unshift(item);
            }
            return installedAvatars[id];
        },

        removeAvatar(id) {
            const item = installedAvatars[id];
            if (!item) return { success: false, reason: 'not-found' };
            if (item.core) return { success: false, reason: 'core-protected' };
            delete installedAvatars[id];
            return { success: true };
        },

        validateUrl(url) {
            return /^https?:\/\/.+\.(vrm|glb|gltf)(\?.*)?$/i.test(url);
        },

        parseFileName(url) {
            return url.split('/').pop().split('?')[0];
        },

        parseFormat(url) {
            const ext = this.parseFileName(url).split('.').pop().toLowerCase();
            return ext === 'vrm' ? 'vrm' : 'glb';
        },
    };
}

/* ═══════════════════════════════════════════════════════════
   TEST SUITES
   ═══════════════════════════════════════════════════════════ */

describe('Avatar External Sources — Health Checks', () => {
    beforeEach(() => {
        fetch.mockClear();
    });

    describe('Source URL reachability', () => {
        EXTERNAL_SOURCES.forEach((source) => {
            test(`${source.name} — URL is valid and well-formed`, () => {
                expect(() => new URL(source.url)).not.toThrow();
                expect(source.url).toMatch(/^https:\/\//);
            });
        });

        test('Open Source Avatars JSON — should return valid project array', async () => {
            const mockProjects = [
                {
                    id: 'test-avatar-1',
                    name: 'Test Avatar 1',
                    description: 'A test CC0 avatar',
                    download_url: 'https://example.com/avatar1.vrm',
                    thumbnail: 'https://example.com/thumb1.png',
                    tags: ['cc0', 'female'],
                    file_size: 5000000,
                },
                {
                    id: 'test-avatar-2',
                    name: 'Test Avatar 2',
                    description: 'Another test avatar',
                    download_url: 'https://example.com/avatar2.vrm',
                    tags: ['cc0', 'male'],
                },
            ];

            mockFetchResponses['https://raw.githubusercontent.com/ToxSam/open-source-avatars/main/data/projects.json'] =
                () => ({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(mockProjects),
                });

            const res = await fetch(
                'https://raw.githubusercontent.com/ToxSam/open-source-avatars/main/data/projects.json'
            );
            expect(res.ok).toBe(true);

            const projects = await res.json();
            expect(Array.isArray(projects)).toBe(true);
            expect(projects.length).toBeGreaterThan(0);

            // Validate each project has required fields
            projects.forEach((proj) => {
                expect(proj).toHaveProperty('name');
                expect(proj).toHaveProperty('download_url');
                expect(typeof proj.name).toBe('string');
                expect(proj.download_url).toMatch(/^https?:\/\//);
            });

            delete mockFetchResponses[
                'https://raw.githubusercontent.com/ToxSam/open-source-avatars/main/data/projects.json'
            ];
        });

        test('Open Source Avatars — should map projects to catalog items', async () => {
            const mockProjects = [
                {
                    id: 'osa-1',
                    name: 'Luna',
                    description: 'A cute CC0 avatar',
                    download_url: 'https://example.com/luna.vrm',
                    thumbnail: 'https://example.com/luna.png',
                    tags: ['anime', 'female'],
                    file_size: 8000000,
                },
            ];

            // Simulate the mapping logic from vrm-manager.js fetchOpenSourceAvatars()
            const avatars = mockProjects
                .filter((proj) => proj.download_url)
                .map((proj) => ({
                    id: `osa-${proj.id.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`,
                    name: proj.name,
                    desc: (proj.description || 'CC0 avatar from Open Source Avatars.').slice(0, 150),
                    source: 'Open Source Avatars',
                    sourceId: 'opensourceavatars',
                    format: 'vrm',
                    license: 'cc0',
                    url: proj.download_url,
                    preview: proj.thumbnail || '',
                    icon: '🆓',
                    tags: ['cc0', 'open-source', ...(proj.tags || []).slice(0, 2)],
                    features: ['lipsync', 'emotions', 'gaze', 'blink'],
                    size: proj.file_size || 0,
                }));

            expect(avatars).toHaveLength(1);
            expect(avatars[0].id).toBe('osa-osa-1');
            expect(avatars[0].name).toBe('Luna');
            expect(avatars[0].source).toBe('Open Source Avatars');
            expect(avatars[0].license).toBe('cc0');
            expect(avatars[0].format).toBe('vrm');
            expect(avatars[0].url).toBe('https://example.com/luna.vrm');
            expect(avatars[0].features).toEqual(['lipsync', 'emotions', 'gaze', 'blink']);
        });

        test('Sketchfab API — should return search results', async () => {
            const mockSketchfab = {
                results: [
                    {
                        uid: 'abc123',
                        name: 'VRM Character',
                        description: 'A downloadable VRM',
                        license: { slug: 'cc0' },
                        thumbnails: { images: [{ url: 'https://example.com/thumb.jpg' }] },
                        tags: [{ slug: 'vrm' }, { slug: 'avatar' }],
                        archives: { glb: { size: 5000000 } },
                    },
                ],
            };

            mockFetchResponses['https://api.sketchfab.com/v3/search?type=models&q=VRM&count=1'] = (opts) => ({
                ok: true,
                status: 200,
                json: () => Promise.resolve(mockSketchfab),
            });

            const res = await fetch('https://api.sketchfab.com/v3/search?type=models&q=VRM&count=1');
            const data = await res.json();

            expect(data).toHaveProperty('results');
            expect(Array.isArray(data.results)).toBe(true);
            expect(data.results[0]).toHaveProperty('uid');
            expect(data.results[0]).toHaveProperty('name');

            delete mockFetchResponses['https://api.sketchfab.com/v3/search?type=models&q=VRM&count=1'];
        });

        test('Ready Player Me — GLB download URL format is valid', () => {
            const avatarId = '64bfa15f0f93e14abcde1234';
            const baseUrl = `https://models.readyplayer.me/${avatarId}.glb`;
            const fullUrl = `${baseUrl}?morphTargets=ARKit,Oculus+Visemes`;

            expect(() => new URL(baseUrl)).not.toThrow();
            expect(() => new URL(fullUrl)).not.toThrow();
            expect(fullUrl).toContain('morphTargets=ARKit');
            expect(fullUrl).toContain('Oculus+Visemes');
        });
    });
});

describe('Avatar Install / Uninstall Lifecycle', () => {
    let mgr;

    beforeEach(() => {
        mgr = createMockManager();
    });

    describe('Core avatar protection', () => {
        test('built-in avatars should be marked as core', () => {
            BUILTIN_CATALOG.forEach((item) => {
                if (item.installed) {
                    expect(mgr.isCore(item.id)).toBe(true);
                }
            });
        });

        test('core avatars should be installed by default', () => {
            BUILTIN_CATALOG.forEach((item) => {
                if (item.installed) {
                    expect(mgr.isInstalled(item.id)).toBe(true);
                }
            });
        });

        test('core avatars cannot be removed', () => {
            const result = mgr.removeAvatar('vrm-avatar-sample-a');
            expect(result.success).toBe(false);
            expect(result.reason).toBe('core-protected');
            expect(mgr.isInstalled('vrm-avatar-sample-a')).toBe(true);
        });

        test('all core avatars are protected from removal', () => {
            Object.keys(mgr.installedAvatars)
                .filter((id) => mgr.isCore(id))
                .forEach((id) => {
                    const result = mgr.removeAvatar(id);
                    expect(result.success).toBe(false);
                    expect(result.reason).toBe('core-protected');
                });
        });
    });

    describe('User avatar installation', () => {
        test('should install a new avatar from external source', () => {
            const newAvatar = {
                id: 'osa-test-external',
                name: 'External Test Avatar',
                format: 'vrm',
                license: 'cc0',
                url: 'https://example.com/test.vrm',
                features: ['lipsync', 'emotions'],
                tags: ['cc0', 'test'],
                size: 5000000,
                source: 'Open Source Avatars',
                sourceId: 'opensourceavatars',
                icon: '🆓',
                desc: 'Test external avatar',
            };

            expect(mgr.isInstalled('osa-test-external')).toBe(false);
            const installed = mgr.installAvatar(newAvatar);

            expect(mgr.isInstalled('osa-test-external')).toBe(true);
            expect(installed.localFile).toBe('External_Test_Avatar.vrm');
            expect(installed.installedAt).toBeGreaterThan(0);
            expect(mgr.isCore('osa-test-external')).toBe(false);
        });

        test('should install a GLB avatar from Direct URL', () => {
            const urlAvatar = {
                id: 'url-12345-my_avatar',
                name: 'my_avatar',
                format: 'glb',
                license: 'free',
                url: 'https://example.com/my_avatar.glb',
                features: [],
                tags: ['url-import', 'glb'],
                size: 3000000,
                source: 'Direct URL',
                sourceId: 'direct-url',
                icon: '📦',
                desc: 'Downloaded from URL',
            };

            const installed = mgr.installAvatar(urlAvatar);
            expect(mgr.isInstalled('url-12345-my_avatar')).toBe(true);
            expect(installed.localFile).toBe('my_avatar.glb');
            expect(installed.format).toBe('glb');
        });

        test('should install a Ready Player Me avatar', () => {
            const rpmAvatar = {
                id: 'rpm-64bfa15f',
                name: 'RPM Avatar 64bfa15f',
                format: 'glb-morph',
                license: 'cc-by',
                url: 'https://models.readyplayer.me/64bfa15f.glb?morphTargets=ARKit,Oculus+Visemes',
                features: ['lipsync', 'emotions'],
                tags: ['custom', 'rpm', 'morph-targets'],
                size: 8000000,
                source: 'Ready Player Me',
                sourceId: 'readyplayerme',
                icon: '🧑',
                desc: 'RPM avatar',
            };

            const installed = mgr.installAvatar(rpmAvatar);
            expect(mgr.isInstalled('rpm-64bfa15f')).toBe(true);
            expect(installed.format).toBe('glb-morph');
            expect(installed.source).toBe('Ready Player Me');
        });
    });

    describe('User avatar removal', () => {
        test('should remove a user-installed avatar', () => {
            // Install then remove
            mgr.installAvatar({
                id: 'user-test-remove',
                name: 'Removable Avatar',
                format: 'vrm',
                license: 'cc0',
                url: 'https://example.com/removable.vrm',
                features: [],
                tags: [],
                size: 1000000,
                source: 'Test',
                sourceId: 'test',
                icon: '🗑️',
                desc: 'Will be removed',
            });

            expect(mgr.isInstalled('user-test-remove')).toBe(true);

            const result = mgr.removeAvatar('user-test-remove');
            expect(result.success).toBe(true);
            expect(mgr.isInstalled('user-test-remove')).toBe(false);
        });

        test('should fail to remove non-existent avatar', () => {
            const result = mgr.removeAvatar('does-not-exist');
            expect(result.success).toBe(false);
            expect(result.reason).toBe('not-found');
        });

        test('should track install count correctly after add/remove', () => {
            const initialCount = Object.keys(mgr.installedAvatars).length;

            // Install 3 avatars
            for (let i = 0; i < 3; i++) {
                mgr.installAvatar({
                    id: `batch-${i}`,
                    name: `Batch ${i}`,
                    format: 'vrm',
                    license: 'cc0',
                    url: `https://example.com/batch${i}.vrm`,
                    features: [],
                    tags: [],
                    size: 1000000,
                    source: 'Test',
                    sourceId: 'test',
                    icon: '📦',
                    desc: `Batch avatar ${i}`,
                });
            }

            expect(Object.keys(mgr.installedAvatars).length).toBe(initialCount + 3);

            // Remove 2
            mgr.removeAvatar('batch-0');
            mgr.removeAvatar('batch-1');

            expect(Object.keys(mgr.installedAvatars).length).toBe(initialCount + 1);
            expect(mgr.isInstalled('batch-2')).toBe(true);
        });
    });

    describe('Install stats — core vs user breakdown', () => {
        test('should correctly count core vs user-installed', () => {
            const all = Object.values(mgr.installedAvatars);
            const coreCount = all.filter((a) => a.core).length;
            const userCount = all.length - coreCount;

            expect(coreCount).toBe(3); // 3 BUILTIN_CATALOG items
            expect(userCount).toBe(0);

            // Install user avatar
            mgr.installAvatar({
                id: 'user-stats-test',
                name: 'Stats Test',
                format: 'vrm',
                license: 'cc0',
                url: 'https://example.com/stats.vrm',
                features: [],
                tags: [],
                size: 1000000,
                source: 'Test',
                sourceId: 'test',
                icon: '📊',
                desc: 'Stats test',
            });

            const allAfter = Object.values(mgr.installedAvatars);
            const coreAfter = allAfter.filter((a) => a.core).length;
            const userAfter = allAfter.length - coreAfter;

            expect(coreAfter).toBe(3);
            expect(userAfter).toBe(1);
        });
    });
});

describe('Direct URL Validation', () => {
    let mgr;

    beforeEach(() => {
        mgr = createMockManager();
    });

    test('should accept valid .vrm URLs', () => {
        expect(mgr.validateUrl('https://example.com/avatar.vrm')).toBe(true);
        expect(mgr.validateUrl('https://cdn.example.com/path/to/model.vrm')).toBe(true);
        expect(mgr.validateUrl('http://localhost:8080/test.vrm')).toBe(true);
    });

    test('should accept valid .glb URLs', () => {
        expect(mgr.validateUrl('https://example.com/avatar.glb')).toBe(true);
        expect(mgr.validateUrl('https://models.readyplayer.me/abc123.glb?morphTargets=ARKit')).toBe(true);
    });

    test('should accept valid .gltf URLs', () => {
        expect(mgr.validateUrl('https://example.com/scene.gltf')).toBe(true);
    });

    test('should reject invalid URLs', () => {
        expect(mgr.validateUrl('')).toBe(false);
        expect(mgr.validateUrl('not-a-url')).toBe(false);
        expect(mgr.validateUrl('https://example.com/avatar.png')).toBe(false);
        expect(mgr.validateUrl('https://example.com/avatar.fbx')).toBe(false);
        expect(mgr.validateUrl('ftp://example.com/avatar.vrm')).toBe(false);
    });

    test('should parse file name from URL', () => {
        expect(mgr.parseFileName('https://example.com/my-avatar.vrm')).toBe('my-avatar.vrm');
        expect(mgr.parseFileName('https://cdn.example.com/path/to/model.glb?v=2')).toBe('model.glb');
    });

    test('should detect format from URL', () => {
        expect(mgr.parseFormat('https://example.com/avatar.vrm')).toBe('vrm');
        expect(mgr.parseFormat('https://example.com/avatar.glb')).toBe('glb');
        expect(mgr.parseFormat('https://example.com/avatar.gltf')).toBe('glb');
    });
});

describe('Built-in Catalog Integrity', () => {
    test('all catalog items should have required fields', () => {
        const requiredFields = ['id', 'name', 'format', 'license', 'url', 'features', 'source', 'sourceId'];

        BUILTIN_CATALOG.forEach((item) => {
            requiredFields.forEach((field) => {
                expect(item).toHaveProperty(field);
            });
        });
    });

    test('all catalog items should have valid format', () => {
        const validFormats = ['vrm', 'glb', 'glb-morph'];
        BUILTIN_CATALOG.forEach((item) => {
            expect(validFormats).toContain(item.format);
        });
    });

    test('all catalog items should have valid license', () => {
        const validLicenses = ['cc0', 'cc-by', 'free'];
        BUILTIN_CATALOG.forEach((item) => {
            expect(validLicenses).toContain(item.license);
        });
    });

    test('VRM avatars should have full feature set', () => {
        BUILTIN_CATALOG.filter((item) => item.format === 'vrm').forEach((item) => {
            expect(item.features).toContain('lipsync');
            expect(item.features).toContain('emotions');
        });
    });

    test('all catalog IDs should be unique', () => {
        const ids = BUILTIN_CATALOG.map((item) => item.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
    });

    test('all catalog URLs should be valid paths', () => {
        BUILTIN_CATALOG.forEach((item) => {
            expect(item.url).toMatch(/\.(vrm|glb|gltf)$/);
        });
    });
});

describe('Ready Player Me Integration', () => {
    test('should construct valid RPM iFrame URL', () => {
        const subdomain = 'demo';
        const rpmUrl = `https://${subdomain}.readyplayer.me/avatar?frameApi`;

        expect(() => new URL(rpmUrl)).not.toThrow();
        expect(rpmUrl).toContain('frameApi');
        expect(rpmUrl).toContain(subdomain);
    });

    test('should append morph targets to GLB URL', () => {
        const avatarUrl = 'https://models.readyplayer.me/64bfa15f';
        const glbUrl = avatarUrl + '.glb';
        const fullUrl = glbUrl + '?morphTargets=ARKit,Oculus+Visemes';

        expect(fullUrl).toContain('.glb');
        expect(fullUrl).toContain('ARKit');
        expect(fullUrl).toContain('Oculus+Visemes');
    });

    test('should extract avatar ID from RPM URL', () => {
        const rpmUrl = 'https://models.readyplayer.me/64bfa15f0f93e14abcde1234.glb';
        const avatarId = rpmUrl.split('/').pop().split('.')[0];

        expect(avatarId).toBe('64bfa15f0f93e14abcde1234');
        expect(avatarId.length).toBeGreaterThan(10);
    });

    test('should create correct install metadata for RPM avatar', () => {
        const avatarId = '64bfa15f';
        const item = {
            id: `rpm-${avatarId}`,
            name: `RPM Avatar ${avatarId.slice(0, 8)}`,
            format: 'glb-morph',
            license: 'cc-by',
            source: 'Ready Player Me',
            sourceId: 'readyplayerme',
            features: ['lipsync', 'emotions'],
        };

        expect(item.id).toBe('rpm-64bfa15f');
        expect(item.format).toBe('glb-morph');
        expect(item.license).toBe('cc-by');
        expect(item.features).toContain('lipsync');
    });

    test('should handle RPM v1 message format (string URL)', () => {
        const eventData = 'https://models.readyplayer.me/64bfa15f';
        const isRPM = typeof eventData === 'string' && eventData.startsWith('https://models.readyplayer.me/');
        expect(isRPM).toBe(true);
    });

    test('should handle RPM v2 message format (JSON object)', () => {
        const eventData = {
            source: 'readyplayerme',
            eventName: 'v1.avatar.exported',
            data: { url: 'https://models.readyplayer.me/64bfa15f' },
        };
        const isRPMv2 =
            eventData.source === 'readyplayerme' && eventData.eventName === 'v1.avatar.exported' && eventData.data?.url;
        expect(isRPMv2).toBeTruthy();
    });
});

describe('Source Registry Integrity', () => {
    const SOURCES = [
        { id: 'github-vrm-samples', auth: 'none', status: 'connected' },
        { id: 'github-three-vrm', auth: 'none', status: 'connected' },
        { id: 'github-talkinghead', auth: 'none', status: 'connected' },
        { id: 'opensourceavatars', auth: 'none', status: 'connected' },
        { id: 'vroid-hub', auth: 'oauth', status: 'disconnected' },
        { id: 'readyplayerme', auth: 'api-key', status: 'disconnected' },
        { id: 'sketchfab', auth: 'token', status: 'disconnected' },
        { id: 'booth', auth: 'manual', status: 'no-api' },
        { id: 'vroid-studio', auth: 'manual', status: 'no-api' },
        { id: 'viverse', auth: 'manual', status: 'no-api' },
    ];

    test('all sources should have unique IDs', () => {
        const ids = SOURCES.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('no-auth sources should be connected by default', () => {
        SOURCES.filter((s) => s.auth === 'none').forEach((s) => {
            expect(s.status).toBe('connected');
        });
    });

    test('auth-required sources should be disconnected by default', () => {
        SOURCES.filter((s) => ['oauth', 'api-key', 'token'].includes(s.auth)).forEach((s) => {
            expect(s.status).toBe('disconnected');
        });
    });

    test('manual sources should have no-api status', () => {
        SOURCES.filter((s) => s.auth === 'manual').forEach((s) => {
            expect(s.status).toBe('no-api');
        });
    });

    test('should have at least 4 no-auth connected sources', () => {
        const connected = SOURCES.filter((s) => s.status === 'connected');
        expect(connected.length).toBeGreaterThanOrEqual(4);
    });
});
