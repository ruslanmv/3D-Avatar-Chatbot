/**
 * @file Unit tests for VRoid Hub API Integration
 *
 * Tests:
 *   1. OAuth token storage and retrieval
 *   2. Token refresh flow
 *   3. VRoid Hub API proxy routing
 *   4. Character model mapping to catalog format
 *   5. Download license flow
 *   6. Credential validation
 */

/* ═══════════════════════════════════════════════════════════
   MOCK SETUP
   ═══════════════════════════════════════════════════════════ */

const mockFetchResponses = {};

global.fetch = jest.fn((url, opts) => {
    // Check for exact URL match first, then prefix match
    for (const [pattern, handler] of Object.entries(mockFetchResponses)) {
        if (url === pattern || url.startsWith(pattern)) {
            return Promise.resolve(typeof handler === 'function' ? handler(url, opts) : handler);
        }
    }
    // Default response
    return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        headers: new Map(),
    });
});

global.localStorage = {
    _store: {},
    getItem: jest.fn((key) => global.localStorage._store[key] || null),
    setItem: jest.fn((key, val) => {
        global.localStorage._store[key] = val;
    }),
    removeItem: jest.fn((key) => {
        delete global.localStorage._store[key];
    }),
    clear: jest.fn(() => {
        global.localStorage._store = {};
    }),
};

/* ═══════════════════════════════════════════════════════════
   MOCK VROID HUB API RESPONSES
   ═══════════════════════════════════════════════════════════ */

const MOCK_TOKEN_RESPONSE = {
    access_token: 'by8oCnMpo9OqymbZSooZYN7sddgsC0FGD_0FuUeWe8A',
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: 'ylOOvtCrUDvR3gQPxBE5M8655NlyfT2jE_ee3dygXH4',
    scope: 'default',
    created_at: 1774181085,
};

const MOCK_ACCOUNT_RESPONSE = {
    data: {
        user: {
            name: 'TestUser',
            id: '12345',
        },
    },
};

const MOCK_STAFF_PICKS_RESPONSE = {
    data: [
        {
            id: 'model-001',
            name: 'Cute Anime Girl',
            user: { name: 'Creator1' },
            is_downloadable: true,
            character_model_version: {
                id: 'ver-001',
                images: [
                    {
                        sq170: 'https://vroid-hub.pximg.net/thumb1.png',
                        sq150: 'https://vroid-hub.pximg.net/thumb1_sm.png',
                    },
                ],
            },
            tags: [{ name: 'anime' }, { name: 'girl' }],
        },
        {
            id: 'model-002',
            name: 'Cool Robot',
            user: { name: 'Creator2' },
            is_downloadable: false,
            character_model_version: {
                id: 'ver-002',
                images: [{ sq170: 'https://vroid-hub.pximg.net/thumb2.png' }],
            },
            tags: [{ name: 'robot' }],
        },
    ],
    _links: { next: { href: '/api/staff_picks?max_id=abc' } },
};

const MOCK_HEARTS_RESPONSE = {
    data: [
        {
            id: 'heart-001',
            heart: {
                character_model: {
                    id: 'model-003',
                    name: 'Liked Avatar',
                    user: { name: 'Creator3' },
                    is_downloadable: true,
                    character_model_version: {
                        id: 'ver-003',
                        images: [{ sq170: 'https://vroid-hub.pximg.net/thumb3.png' }],
                    },
                    tags: [],
                },
            },
        },
    ],
};

const MOCK_SEARCH_RESPONSE = {
    data: [
        {
            id: 'model-010',
            name: 'Search Result Avatar',
            user: { name: 'SearchCreator' },
            is_downloadable: true,
            character_model_version: {
                id: 'ver-010',
                images: [{ sq170: 'https://vroid-hub.pximg.net/search_thumb.png' }],
            },
            tags: [{ name: 'searchable' }],
        },
    ],
};

const MOCK_DOWNLOAD_LICENSE_RESPONSE = {
    data: {
        id: 'license-abc123',
        character_model_id: 'model-001',
        character_model_version_id: 'ver-001',
        expires_at: '2025-01-01T00:00:00Z',
    },
};

/* ═══════════════════════════════════════════════════════════
   HELPER: simulate VRoid Hub integration logic
   ═══════════════════════════════════════════════════════════ */

function createVroidManager() {
    let credentials = {
        vroid: {
            appId: 'test-app-id',
            appSecret: 'test-app-secret',
            accessToken: '',
            refreshToken: '',
            tokenExpiresAt: 0,
        },
    };

    return {
        credentials,

        setToken(accessToken, refreshToken, expiresIn = 3600) {
            credentials.vroid.accessToken = accessToken;
            credentials.vroid.refreshToken = refreshToken;
            credentials.vroid.tokenExpiresAt = Date.now() + expiresIn * 1000;
        },

        setAppCredentials(appId, appSecret) {
            credentials.vroid.appId = appId;
            credentials.vroid.appSecret = appSecret;
        },

        hasValidToken() {
            const v = credentials.vroid;
            return !!(v && v.accessToken && v.tokenExpiresAt > Date.now());
        },

        isTokenExpiringSoon() {
            const v = credentials.vroid;
            if (!v || !v.accessToken) return true;
            return v.tokenExpiresAt - Date.now() < 300000; // 5 min
        },

        async _getVroidToken() {
            const v = credentials.vroid;
            if (!v || !v.accessToken) return null;
            if (v.tokenExpiresAt && Date.now() > v.tokenExpiresAt - 300000) {
                const refreshed = await this._refreshVroidToken();
                if (!refreshed) return null;
            }
            return credentials.vroid.accessToken;
        },

        async _refreshVroidToken() {
            const v = credentials.vroid;
            if (!v || !v.refreshToken || !v.appId || !v.appSecret) return false;
            try {
                const res = await fetch('/api/vroid-hub', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'token',
                        params: {
                            grant_type: 'refresh_token',
                            client_id: v.appId,
                            client_secret: v.appSecret,
                            refresh_token: v.refreshToken,
                        },
                    }),
                });
                const data = await res.json();
                if (data.access_token) {
                    credentials.vroid.accessToken = data.access_token;
                    credentials.vroid.refreshToken = data.refresh_token || v.refreshToken;
                    credentials.vroid.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
                    return true;
                }
            } catch (_) {}
            return false;
        },

        _mapVroidModel(m, userLiked = false) {
            const modelData = m.heart?.character_model || m.character_model || m;
            const imgUrl = (img) => {
                if (!img) return '';
                if (typeof img === 'string') return img;
                return img.url || '';
            };
            const thumb =
                imgUrl(modelData.character_model_version?.images?.[0]?.sq170) ||
                imgUrl(modelData.character_model_version?.images?.[0]?.sq150) ||
                imgUrl(modelData.portrait_image?.sq300) ||
                imgUrl(modelData.portrait_image?.sq150) ||
                imgUrl(m.portrait_image?.sq300) ||
                imgUrl(m.portrait_image?.sq150) ||
                imgUrl(m.heart?.character_model?.portrait_image?.sq150) ||
                '';
            const name =
                modelData.name ||
                modelData.character?.name ||
                modelData.user?.name ||
                modelData.character?.user?.name ||
                'VRoid Hub Avatar';
            const creator =
                modelData.user?.name ||
                modelData.character?.user?.name ||
                m.heart?.character_model?.user?.name ||
                'Unknown';
            const isDownloadable = modelData.is_downloadable !== undefined ? modelData.is_downloadable : true;
            const versionId =
                modelData.character_model_version?.id || modelData.latest_character_model_version?.id || '';
            const characterId = modelData.character?.id || m.heart?.character_model?.character?.id || modelData.id;
            const vroidPageUrl = `https://hub.vroid.com/en/characters/${characterId}/models/${modelData.id}`;
            const canInstall = userLiked && isDownloadable;

            const lic = modelData.license || {};
            const conditionsOfUse = {
                avatarUse: lic.characterization_allowed_user || 'default',
                violentExpression: lic.violent_expression || 'default',
                sexualExpression: lic.sexual_expression || 'default',
                corporateCommercialUse: lic.corporate_commercial_use || 'default',
                personalCommercialUse: lic.personal_commercial_use || 'default',
                redistribution: lic.redistribution || 'default',
                modification: lic.modification || 'default',
                credit: lic.credit || 'default',
            };

            let desc = `By ${creator} on VRoid Hub.`;
            if (!isDownloadable) desc += ' See on VRoid Hub to enable download.';
            else if (!userLiked) desc += ' See on VRoid Hub to install.';

            return {
                id: `vroid-hub-${modelData.id || 'unknown'}`,
                name,
                desc,
                source: 'VRoid Hub',
                sourceId: 'vroid-hub',
                format: 'vrm',
                license: 'vroid-hub-terms',
                url: canInstall ? `vroid-hub:${modelData.id}` : vroidPageUrl,
                preview: thumb,
                icon: '🌐',
                tags: ['vroid-hub', 'community', ...(modelData.tags || []).map((t) => t.name || t).slice(0, 2)],
                features: ['lipsync', 'emotions', 'gaze', 'blink'],
                size: 0,
                likeCount: modelData.heart_count || 0,
                vroidModelId: modelData.id,
                vroidPageUrl,
                isDownloadable: canInstall,
                userLiked,
                conditionsOfUse,
            };
        },

        async fetchVroidHubAvatars() {
            const token = await this._getVroidToken();
            if (!token) return [];

            const appId = credentials.vroid?.appId || '';

            // Fetch staff picks and hearts in parallel
            const fetchers = [
                fetch('/api/vroid-hub?action=staff_picks&count=100', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            ];
            if (appId) {
                fetchers.push(
                    fetch(`/api/vroid-hub?action=hearts&count=100&application_id=${appId}`, {
                        headers: { Authorization: `Bearer ${token}` },
                    })
                );
            }

            const results = await Promise.allSettled(fetchers);

            if (results[0].status === 'fulfilled' && results[0].value.status === 401) {
                return [];
            }

            const mapped = [];
            const seenIds = new Set();

            // Process hearts first (user's liked models — can be installed)
            if (results[1]?.status === 'fulfilled' && results[1].value.ok) {
                const heartsData = await results[1].value.json();
                for (const m of heartsData.data || []) {
                    const modelData = m.heart?.character_model || m.character_model || m;
                    const modelId = modelData.id || m.id;
                    if (seenIds.has(modelId)) continue;
                    seenIds.add(modelId);
                    mapped.push(this._mapVroidModel(m, true));
                }
            }

            // Then add staff picks (browse-only — must Like on hub to install)
            if (results[0].status === 'fulfilled' && results[0].value.ok) {
                const staffData = await results[0].value.json();
                for (const m of staffData.data || []) {
                    const modelData = m.heart?.character_model || m.character_model || m;
                    const modelId = modelData.id || m.id;
                    if (seenIds.has(modelId)) continue;
                    seenIds.add(modelId);
                    mapped.push(this._mapVroidModel(m, false));
                }
            }

            return mapped;
        },

        async searchVroidHub(keyword) {
            const token = await this._getVroidToken();
            if (!token) return [];

            const res = await fetch(`/api/vroid-hub?action=search&keyword=${encodeURIComponent(keyword)}&count=50`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return [];
            const data = await res.json();
            return (data.data || []).map((m) => this._mapVroidModel(m));
        },

        async getVroidHubDownloadUrl(characterModelId) {
            const token = await this._getVroidToken();
            if (!token) return null;

            const licRes = await fetch(
                `/api/vroid-hub?action=download_license&character_model_id=${characterModelId}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!licRes.ok) return null;
            const licData = await licRes.json();
            const licenseId = licData.data?.id;
            if (!licenseId) return null;

            const dlRes = await fetch(`/api/vroid-hub?action=download&license_id=${licenseId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const dlData = await dlRes.json();
            return dlData.download_url || null;
        },
    };
}

/* ═══════════════════════════════════════════════════════════
   TEST SUITES
   ═══════════════════════════════════════════════════════════ */

describe('VRoid Hub — OAuth Token Management', () => {
    let mgr;

    beforeEach(() => {
        mgr = createVroidManager();
        fetch.mockClear();
        Object.keys(mockFetchResponses).forEach((k) => delete mockFetchResponses[k]);
    });

    test('should store access token and refresh token', () => {
        mgr.setToken(MOCK_TOKEN_RESPONSE.access_token, MOCK_TOKEN_RESPONSE.refresh_token, 3600);
        expect(mgr.credentials.vroid.accessToken).toBe(MOCK_TOKEN_RESPONSE.access_token);
        expect(mgr.credentials.vroid.refreshToken).toBe(MOCK_TOKEN_RESPONSE.refresh_token);
        expect(mgr.hasValidToken()).toBe(true);
    });

    test('should detect expired token', () => {
        mgr.setToken('test-token', 'test-refresh', 3600);
        // Force expiry
        mgr.credentials.vroid.tokenExpiresAt = Date.now() - 1000;
        expect(mgr.hasValidToken()).toBe(false);
    });

    test('should detect token expiring soon (within 5 min)', () => {
        mgr.setToken('test-token', 'test-refresh', 3600);
        // Set to expire in 2 minutes
        mgr.credentials.vroid.tokenExpiresAt = Date.now() + 120000;
        expect(mgr.isTokenExpiringSoon()).toBe(true);
    });

    test('should return null token when no credentials', async () => {
        const token = await mgr._getVroidToken();
        expect(token).toBeNull();
    });

    test('should refresh token using refresh_token grant', async () => {
        mgr.setAppCredentials('app-id-123', 'app-secret-456');
        mgr.setToken('old-token', 'old-refresh', 3600);
        // Force token near expiry
        mgr.credentials.vroid.tokenExpiresAt = Date.now() + 60000;

        mockFetchResponses['/api/vroid-hub'] = (url, opts) => {
            const body = JSON.parse(opts.body);
            if (body.action === 'token' && body.params.grant_type === 'refresh_token') {
                return {
                    ok: true,
                    status: 200,
                    json: () =>
                        Promise.resolve({
                            access_token: 'new-access-token',
                            refresh_token: 'new-refresh-token',
                            expires_in: 3600,
                        }),
                };
            }
            return { ok: false, status: 400, json: () => Promise.resolve({ error: 'unknown' }) };
        };

        const token = await mgr._getVroidToken();
        expect(token).toBe('new-access-token');
        expect(mgr.credentials.vroid.refreshToken).toBe('new-refresh-token');
    });

    test('should fail refresh without appId/appSecret', async () => {
        mgr.setToken('old-token', 'old-refresh', 0);
        mgr.credentials.vroid.tokenExpiresAt = Date.now() - 1000;

        const result = await mgr._refreshVroidToken();
        expect(result).toBe(false);
    });
});

describe('VRoid Hub — Character Model Mapping', () => {
    let mgr;

    beforeEach(() => {
        mgr = createVroidManager();
    });

    test('should map staff pick model to catalog format', () => {
        const model = MOCK_STAFF_PICKS_RESPONSE.data[0];

        // Staff pick (not liked) — browse only
        const browsed = mgr._mapVroidModel(model, false);
        expect(browsed.id).toBe('vroid-hub-model-001');
        expect(browsed.name).toBe('Cute Anime Girl');
        expect(browsed.source).toBe('VRoid Hub');
        expect(browsed.format).toBe('vrm');
        expect(browsed.isDownloadable).toBe(false); // can't install until liked
        expect(browsed.userLiked).toBe(false);
        expect(browsed.url).toContain('https://hub.vroid.com'); // web page link
        expect(browsed.desc).toContain('See on VRoid Hub to install');

        // Same model as liked (from hearts) — can install
        const liked = mgr._mapVroidModel(model, true);
        expect(liked.isDownloadable).toBe(true);
        expect(liked.userLiked).toBe(true);
        expect(liked.url).toBe('vroid-hub:model-001'); // vroid-hub: scheme
        expect(liked.preview).toBe('https://vroid-hub.pximg.net/thumb1.png');
        expect(liked.features).toEqual(['lipsync', 'emotions', 'gaze', 'blink']);
        expect(liked.vroidModelId).toBe('model-001');
        expect(liked.tags).toContain('vroid-hub');
        expect(liked.tags).toContain('anime');
    });

    test('should set URL to web page for non-downloadable models', () => {
        const model = MOCK_STAFF_PICKS_RESPONSE.data[1]; // is_downloadable: false
        const mapped = mgr._mapVroidModel(model);

        expect(mapped.isDownloadable).toBe(false);
        expect(mapped.url).toContain('https://hub.vroid.com/en/characters/model-002');
    });

    test('should handle heart model (nested structure)', () => {
        const heartEntry = MOCK_HEARTS_RESPONSE.data[0];
        const mapped = mgr._mapVroidModel(heartEntry);

        // Should extract from heart.character_model
        expect(mapped.name).toBe('Liked Avatar');
        expect(mapped.vroidModelId).toBe('model-003');
    });

    test('should extract thumbnail with priority (sq170 > sq150)', () => {
        const model = {
            id: 'test-model',
            name: 'Test',
            user: { name: 'Test' },
            character_model_version: {
                id: 'v1',
                images: [{ sq170: 'thumb170.png', sq150: 'thumb150.png' }],
            },
            tags: [],
        };
        const mapped = mgr._mapVroidModel(model);
        expect(mapped.preview).toBe('thumb170.png');
    });

    test('should fallback to sq150 when sq170 missing', () => {
        const model = {
            id: 'test-model',
            name: 'Test',
            user: { name: 'Test' },
            character_model_version: {
                id: 'v1',
                images: [{ sq150: 'thumb150.png' }],
            },
            tags: [],
        };
        const mapped = mgr._mapVroidModel(model);
        expect(mapped.preview).toBe('thumb150.png');
    });

    test('should handle model with no images', () => {
        const model = {
            id: 'no-img',
            name: 'No Image',
            user: { name: 'Test' },
            character_model_version: { id: 'v1', images: [] },
            tags: [],
        };
        const mapped = mgr._mapVroidModel(model);
        expect(mapped.preview).toBe('');
    });

    test('should extract URL from ImageSerializer objects (real API format)', () => {
        // Real VRoid API returns portrait_image.sq300 as { url, url2x, width, height }
        const model = {
            id: 'real-api-model',
            name: 'Real API Model',
            character: { user: { name: 'RealCreator' } },
            portrait_image: {
                sq300: { url: 'https://vroid-hub.pximg.net/thumb-sq300.png', url2x: null, width: 300, height: 300 },
                sq150: { url: 'https://vroid-hub.pximg.net/thumb-sq150.png', url2x: null, width: 150, height: 150 },
            },
            is_downloadable: true,
            latest_character_model_version: { id: 'ver-real' },
            tags: [{ name: 'anime' }],
            license: { modification: 'allow', credit: 'necessary' },
        };
        const mapped = mgr._mapVroidModel(model, false);
        expect(mapped.preview).toBe('https://vroid-hub.pximg.net/thumb-sq300.png');
        expect(typeof mapped.preview).toBe('string');
        expect(mapped.name).toBe('Real API Model');
        expect(mapped.desc).toContain('RealCreator');
        expect(mapped.conditionsOfUse.modification).toBe('allow');
        expect(mapped.conditionsOfUse.credit).toBe('necessary');
    });

    test('should handle plain string thumbnails (hearts/legacy format)', () => {
        const model = {
            id: 'legacy-model',
            name: 'Legacy',
            user: { name: 'Creator' },
            character_model_version: {
                id: 'v1',
                images: [{ sq170: 'https://vroid-hub.pximg.net/plain-string.png' }],
            },
            tags: [],
        };
        const mapped = mgr._mapVroidModel(model);
        expect(mapped.preview).toBe('https://vroid-hub.pximg.net/plain-string.png');
    });
});

/** Helper: mock empty staff picks for tests that focus on hearts */
function mockEmptyStaffPicks() {
    mockFetchResponses['/api/vroid-hub?action=staff_picks'] = () => ({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
    });
}

/** Helper: mock empty hearts for tests that focus on staff picks */
function mockEmptyHearts() {
    mockFetchResponses['/api/vroid-hub?action=hearts'] = () => ({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
    });
}

describe('VRoid Hub — Fetch Avatars (Staff Picks + Hearts)', () => {
    let mgr;

    beforeEach(() => {
        mgr = createVroidManager();
        mgr.setToken(MOCK_TOKEN_RESPONSE.access_token, MOCK_TOKEN_RESPONSE.refresh_token, 3600);
        fetch.mockClear();
        Object.keys(mockFetchResponses).forEach((k) => delete mockFetchResponses[k]);
    });

    test('should fetch staff picks even without hearts', async () => {
        mockFetchResponses['/api/vroid-hub?action=staff_picks'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_STAFF_PICKS_RESPONSE),
        });
        mockEmptyHearts();

        const avatars = await mgr.fetchVroidHubAvatars();
        expect(avatars.length).toBe(MOCK_STAFF_PICKS_RESPONSE.data.length);
        expect(avatars.find((a) => a.name === 'Cute Anime Girl')).toBeDefined();
        expect(avatars.find((a) => a.name === 'Cool Robot')).toBeDefined();
    });

    test('should fetch hearts alongside staff picks', async () => {
        mockFetchResponses['/api/vroid-hub?action=staff_picks'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_STAFF_PICKS_RESPONSE),
        });
        mockFetchResponses['/api/vroid-hub?action=hearts'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_HEARTS_RESPONSE),
        });

        const avatars = await mgr.fetchVroidHubAvatars();
        // Hearts model + staff picks (minus duplicates)
        expect(avatars.find((a) => a.name === 'Liked Avatar')).toBeDefined();
        expect(avatars.find((a) => a.name === 'Cute Anime Girl')).toBeDefined();
    });

    test('should merge hearts and staff picks without duplicates', async () => {
        mockFetchResponses['/api/vroid-hub?action=staff_picks'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_STAFF_PICKS_RESPONSE),
        });
        mockFetchResponses['/api/vroid-hub?action=hearts'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_HEARTS_RESPONSE),
        });

        const avatars = await mgr.fetchVroidHubAvatars();
        const ids = avatars.map((a) => a.vroidModelId);
        expect(new Set(ids).size).toBe(ids.length); // no duplicates
    });

    test('should include both downloadable and non-downloadable models', async () => {
        mockEmptyStaffPicks();
        const heartsWithMixed = {
            data: [
                {
                    id: 'heart-dl',
                    heart: {
                        character_model: {
                            id: 'model-dl',
                            name: 'Downloadable',
                            user: { name: 'Creator' },
                            is_downloadable: true,
                            character_model_version: { id: 'v1', images: [] },
                            tags: [],
                        },
                    },
                },
                {
                    id: 'heart-no-dl',
                    heart: {
                        character_model: {
                            id: 'model-no-dl',
                            name: 'Not Downloadable',
                            user: { name: 'Creator' },
                            is_downloadable: false,
                            character_model_version: { id: 'v2', images: [] },
                            tags: [],
                        },
                    },
                },
            ],
        };

        mockFetchResponses['/api/vroid-hub?action=hearts'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve(heartsWithMixed),
        });

        const avatars = await mgr.fetchVroidHubAvatars();
        expect(avatars.length).toBe(2);
        expect(avatars.find((a) => a.name === 'Downloadable').isDownloadable).toBe(true);
        expect(avatars.find((a) => a.name === 'Not Downloadable').isDownloadable).toBe(false);
    });

    test('should deduplicate models across hearts and staff picks', async () => {
        // Same model appears in both hearts and staff picks
        mockFetchResponses['/api/vroid-hub?action=staff_picks'] = () => ({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({
                    data: [
                        {
                            id: 'model-003',
                            name: 'Liked Avatar',
                            user: { name: 'Creator3' },
                            is_downloadable: true,
                            character_model_version: { id: 'ver-003', images: [] },
                            tags: [],
                        },
                    ],
                }),
        });
        mockFetchResponses['/api/vroid-hub?action=hearts'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_HEARTS_RESPONSE),
        });

        const avatars = await mgr.fetchVroidHubAvatars();
        const model003 = avatars.filter((a) => a.vroidModelId === 'model-003');
        expect(model003.length).toBe(1); // deduped
    });

    test('should return empty array when no token', async () => {
        mgr.credentials.vroid.accessToken = '';
        const avatars = await mgr.fetchVroidHubAvatars();
        expect(avatars).toEqual([]);
    });

    test('should handle API error gracefully', async () => {
        mockFetchResponses['/api/vroid-hub?action=staff_picks'] = () => ({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ error: 'Internal Server Error' }),
        });
        mockFetchResponses['/api/vroid-hub?action=hearts'] = () => ({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ error: 'Internal Server Error' }),
        });

        const avatars = await mgr.fetchVroidHubAvatars();
        expect(avatars).toEqual([]);
    });

    test('non-downloadable models should have correct URL and flag', () => {
        const model = MOCK_STAFF_PICKS_RESPONSE.data[1]; // is_downloadable: false
        const mapped = mgr._mapVroidModel(model);
        expect(mapped.isDownloadable).toBe(false);
        expect(mapped.url).toContain('https://hub.vroid.com');
        expect(mapped.url.startsWith('vroid-hub:')).toBe(false);
    });

    test('should skip hearts when no appId', async () => {
        mgr.credentials.vroid.appId = '';
        mockFetchResponses['/api/vroid-hub?action=staff_picks'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_STAFF_PICKS_RESPONSE),
        });
        // Hearts should NOT be fetched when appId is empty
        const avatars = await mgr.fetchVroidHubAvatars();
        expect(avatars.length).toBe(MOCK_STAFF_PICKS_RESPONSE.data.length);
    });
});

describe('VRoid Hub — Search', () => {
    let mgr;

    beforeEach(() => {
        mgr = createVroidManager();
        mgr.setToken(MOCK_TOKEN_RESPONSE.access_token, MOCK_TOKEN_RESPONSE.refresh_token, 3600);
        fetch.mockClear();
        Object.keys(mockFetchResponses).forEach((k) => delete mockFetchResponses[k]);
    });

    test('should search and return mapped models', async () => {
        mockFetchResponses['/api/vroid-hub?action=search'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_SEARCH_RESPONSE),
        });

        const results = await mgr.searchVroidHub('cute avatar');
        expect(results.length).toBe(1);
        expect(results[0].name).toBe('Search Result Avatar');
        expect(results[0].id).toBe('vroid-hub-model-010');
    });

    test('should return empty array on search failure', async () => {
        mockFetchResponses['/api/vroid-hub?action=search'] = () => ({
            ok: false,
            status: 401,
        });

        const results = await mgr.searchVroidHub('test');
        expect(results).toEqual([]);
    });
});

describe('VRoid Hub — Download License Flow', () => {
    let mgr;

    beforeEach(() => {
        mgr = createVroidManager();
        mgr.setToken(MOCK_TOKEN_RESPONSE.access_token, MOCK_TOKEN_RESPONSE.refresh_token, 3600);
        fetch.mockClear();
        Object.keys(mockFetchResponses).forEach((k) => delete mockFetchResponses[k]);
    });

    test('should get download URL via license flow', async () => {
        mockFetchResponses['/api/vroid-hub?action=download_license'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_DOWNLOAD_LICENSE_RESPONSE),
        });
        mockFetchResponses['/api/vroid-hub?action=download'] = () => ({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({
                    download_url: 'https://s3.amazonaws.com/vroid-hub/model-001.vrm?X-Amz-Signature=abc',
                }),
        });

        const url = await mgr.getVroidHubDownloadUrl('model-001');
        expect(url).toContain('s3.amazonaws.com');
        expect(url).toContain('model-001.vrm');
    });

    test('should return null when license request fails', async () => {
        mockFetchResponses['/api/vroid-hub?action=download_license'] = () => ({
            ok: false,
            status: 403,
            json: () => Promise.resolve({ error: { code: 'FORBIDDEN' } }),
        });

        const url = await mgr.getVroidHubDownloadUrl('model-001');
        expect(url).toBeNull();
    });

    test('should return null when no token available', async () => {
        mgr.credentials.vroid.accessToken = '';
        const url = await mgr.getVroidHubDownloadUrl('model-001');
        expect(url).toBeNull();
    });
});

describe('VRoid Hub — Credential Validation', () => {
    test('should consider connected with access token only', () => {
        const creds = { vroid: { accessToken: 'some-token', appId: '', appSecret: '' } };
        const hasToken = !!(creds.vroid && creds.vroid.accessToken);
        const hasCreds = !!(creds.vroid && creds.vroid.appId && creds.vroid.appSecret);
        expect(hasToken || hasCreds).toBe(true);
    });

    test('should consider connected with appId+appSecret only', () => {
        const creds = { vroid: { accessToken: '', appId: 'app123', appSecret: 'secret456' } };
        const hasToken = !!(creds.vroid && creds.vroid.accessToken);
        const hasCreds = !!(creds.vroid && creds.vroid.appId && creds.vroid.appSecret);
        expect(hasToken || hasCreds).toBe(true);
    });

    test('should not be connected without any credentials', () => {
        const creds = { vroid: { accessToken: '', appId: '', appSecret: '' } };
        const hasToken = !!(creds.vroid && creds.vroid.accessToken);
        const hasCreds = !!(creds.vroid && creds.vroid.appId && creds.vroid.appSecret);
        expect(hasToken || hasCreds).toBe(false);
    });

    test('vroid-hub: URL scheme should be recognized for download', () => {
        const url = 'vroid-hub:model-001';
        expect(url.startsWith('vroid-hub:')).toBe(true);
        expect(url.replace('vroid-hub:', '')).toBe('model-001');
    });
});

describe('VRoid Hub — API Proxy Allowlist', () => {
    const ALLOWED_HOSTS = ['models.readyplayer.me', 'hub.vroid.com', 's3.amazonaws.com', 'amazonaws.com'];

    function isAllowedHost(urlStr) {
        try {
            const u = new URL(urlStr);
            return (
                u.protocol === 'https:' && ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))
            );
        } catch {
            return false;
        }
    }

    test('should allow hub.vroid.com', () => {
        expect(isAllowedHost('https://hub.vroid.com/api/character_models')).toBe(true);
    });

    test('should allow S3 presigned URLs', () => {
        expect(isAllowedHost('https://vroid-hub-bucket.s3.amazonaws.com/model.vrm?X-Amz-Signature=abc')).toBe(true);
    });

    test('should allow regional S3 URLs', () => {
        expect(isAllowedHost('https://vroid-hub.s3.ap-northeast-1.amazonaws.com/model.vrm')).toBe(true);
    });

    test('should reject non-allowlisted hosts', () => {
        expect(isAllowedHost('https://evil.example.com/model.vrm')).toBe(false);
    });

    test('should reject non-HTTPS', () => {
        expect(isAllowedHost('http://hub.vroid.com/api/models')).toBe(false);
    });
});

describe('VRoid Hub — vroid-hub: URL Scheme Resolution', () => {
    let mgr;

    beforeEach(() => {
        mgr = createVroidManager();
        mgr.setToken(
            'by8oCnMpo9OqymbZSooZYN7sddgsC0FGD_0FuUeWe8A',
            'ylOOvtCrUDvR3gQPxBE5M8655NlyfT2jE_ee3dygXH4',
            3600
        );
        mgr.setAppCredentials(
            'ylP0q7XrOXvN1A6QnGH7GKw24MA4T5A35h8Qnu_MyGI',
            '1l9SNp0L7FSGVWAI0JAbLVhGRQRmux0VuvfDNTEXaxw'
        );
        fetch.mockClear();
        Object.keys(mockFetchResponses).forEach((k) => delete mockFetchResponses[k]);
    });

    test('vroid-hub: URL should not be passed to fetch/GLTFLoader directly', () => {
        const url = 'vroid-hub:12303502';
        // This URL scheme is not a real protocol — must be resolved first
        expect(url.startsWith('http')).toBe(false);
        expect(url.startsWith('vroid-hub:')).toBe(true);
    });

    test('should resolve vroid-hub: URL to S3 download URL via license flow', async () => {
        mockFetchResponses['/api/vroid-hub?action=download_license'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: { id: 'lic-999' } }),
        });
        mockFetchResponses['/api/vroid-hub?action=download'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ download_url: 'https://s3.amazonaws.com/vroid/12303502.vrm?sig=abc' }),
        });

        const downloadUrl = await mgr.getVroidHubDownloadUrl('12303502');
        expect(downloadUrl).toBe('https://s3.amazonaws.com/vroid/12303502.vrm?sig=abc');
        expect(downloadUrl.startsWith('https://')).toBe(true);
    });

    test('resolved URL should be valid for fetch/GLTFLoader', async () => {
        mockFetchResponses['/api/vroid-hub?action=download_license'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: { id: 'lic-123' } }),
        });
        mockFetchResponses['/api/vroid-hub?action=download'] = () => ({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({
                    download_url: 'https://vroid.s3.ap-northeast-1.amazonaws.com/model.vrm?X-Amz-Expires=3600',
                }),
        });

        const downloadUrl = await mgr.getVroidHubDownloadUrl('12303502');
        expect(() => new URL(downloadUrl)).not.toThrow();
        expect(downloadUrl).toMatch(/^https:\/\//);
    });

    test('_mapVroidModel should produce vroid-hub: URL for liked downloadable models', () => {
        const model = {
            id: '12303502',
            name: 'Test Avatar',
            user: { name: 'TestUser' },
            is_downloadable: true,
            character_model_version: { id: 'v1', images: [] },
            tags: [],
        };
        // Only liked + downloadable gets vroid-hub: URL
        const mapped = mgr._mapVroidModel(model, true);
        expect(mapped.url).toBe('vroid-hub:12303502');
        expect(mapped.vroidModelId).toBe('12303502');

        // Not liked → web URL even if is_downloadable
        const notLiked = mgr._mapVroidModel(model, false);
        expect(notLiked.url).toContain('https://hub.vroid.com');
    });

    test('_mapVroidModel should produce web URL for non-downloadable models', () => {
        const model = {
            id: '12303502',
            name: 'Test Avatar',
            user: { name: 'TestUser' },
            is_downloadable: false,
            character_model_version: { id: 'ver-abc', images: [] },
            tags: [],
        };
        const mapped = mgr._mapVroidModel(model);
        expect(mapped.url).toContain('https://hub.vroid.com');
        expect(mapped.url.startsWith('vroid-hub:')).toBe(false);
    });
});

describe('VRoid Hub — Full Credential Flow (Real Credentials Format)', () => {
    test('should store and validate real token format', () => {
        const mgr = createVroidManager();
        const tokenResponse = {
            access_token: 'by8oCnMpo9OqymbZSooZYN7sddgsC0FGD_0FuUeWe8A',
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: 'ylOOvtCrUDvR3gQPxBE5M8655NlyfT2jE_ee3dygXH4',
            scope: 'default',
            created_at: 1774181085,
        };

        mgr.setToken(tokenResponse.access_token, tokenResponse.refresh_token, tokenResponse.expires_in);
        mgr.setAppCredentials(
            'ylP0q7XrOXvN1A6QnGH7GKw24MA4T5A35h8Qnu_MyGI',
            '1l9SNp0L7FSGVWAI0JAbLVhGRQRmux0VuvfDNTEXaxw'
        );

        expect(mgr.hasValidToken()).toBe(true);
        expect(mgr.credentials.vroid.accessToken).toBe(tokenResponse.access_token);
        expect(mgr.credentials.vroid.refreshToken).toBe(tokenResponse.refresh_token);
        expect(mgr.credentials.vroid.appId).toBe('ylP0q7XrOXvN1A6QnGH7GKw24MA4T5A35h8Qnu_MyGI');
    });

    test('should build correct Authorization header', () => {
        const token = 'by8oCnMpo9OqymbZSooZYN7sddgsC0FGD_0FuUeWe8A';
        const header = `Bearer ${token}`;
        expect(header).toBe('Bearer by8oCnMpo9OqymbZSooZYN7sddgsC0FGD_0FuUeWe8A');
    });

    test('should build correct refresh token request body', () => {
        const params = {
            grant_type: 'refresh_token',
            client_id: 'ylP0q7XrOXvN1A6QnGH7GKw24MA4T5A35h8Qnu_MyGI',
            client_secret: '1l9SNp0L7FSGVWAI0JAbLVhGRQRmux0VuvfDNTEXaxw',
            refresh_token: 'ylOOvtCrUDvR3gQPxBE5M8655NlyfT2jE_ee3dygXH4',
        };
        const encoded = new URLSearchParams(params).toString();
        expect(encoded).toContain('grant_type=refresh_token');
        expect(encoded).toContain('client_id=ylP0q7XrOXvN1A6QnGH7GKw24MA4T5A35h8Qnu_MyGI');
        expect(encoded).toContain('refresh_token=ylOOvtCrUDvR3gQPxBE5M8655NlyfT2jE_ee3dygXH4');
    });

    test('should build correct VRoid Hub API request headers', () => {
        const headers = {
            'X-Api-Version': '11',
            Authorization: 'Bearer by8oCnMpo9OqymbZSooZYN7sddgsC0FGD_0FuUeWe8A',
        };
        expect(headers['X-Api-Version']).toBe('11');
        expect(headers.Authorization).toMatch(/^Bearer\s+\S+/);
    });

    test('full flow: token → fetch avatars → resolve download URL', async () => {
        const mgr = createVroidManager();
        mgr.setToken(
            'by8oCnMpo9OqymbZSooZYN7sddgsC0FGD_0FuUeWe8A',
            'ylOOvtCrUDvR3gQPxBE5M8655NlyfT2jE_ee3dygXH4',
            3600
        );

        // Mock staff picks + hearts
        mockEmptyStaffPicks();
        mockFetchResponses['/api/vroid-hub?action=hearts'] = () => ({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({
                    data: [
                        {
                            id: 'heart-12303502',
                            heart: {
                                character_model: {
                                    id: '12303502',
                                    name: 'Community Avatar',
                                    user: { name: 'AvatarCreator' },
                                    is_downloadable: true,
                                    character_model_version: { id: 'v1', images: [{ sq170: 'https://thumb.png' }] },
                                    tags: [{ name: 'anime' }],
                                },
                            },
                        },
                    ],
                }),
        });

        // Step 1: Fetch avatars (staff picks + liked models)
        const avatars = await mgr.fetchVroidHubAvatars();
        expect(avatars.length).toBe(1);
        expect(avatars[0].url).toBe('vroid-hub:12303502');
        expect(avatars[0].name).toBe('Community Avatar');
        expect(avatars[0].isDownloadable).toBe(true);

        // Step 2: Resolve download URL
        mockFetchResponses['/api/vroid-hub?action=download_license'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: { id: 'lic-abc' } }),
        });
        mockFetchResponses['/api/vroid-hub?action=download'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ download_url: 'https://s3.amazonaws.com/vroid/12303502.vrm?sig=xyz' }),
        });

        const downloadUrl = await mgr.getVroidHubDownloadUrl('12303502');
        expect(downloadUrl).toBe('https://s3.amazonaws.com/vroid/12303502.vrm?sig=xyz');
    });
});

/* ═══════════════════════════════════════════════════════════
   MOCK: Top 10 models with thumbnails and conditions of use
   ═══════════════════════════════════════════════════════════ */

function generateMockModels(count) {
    const models = [];
    for (let i = 1; i <= count; i++) {
        models.push({
            id: `heart-top-${i}`,
            heart: {
                character_model: {
                    id: `top-model-${i}`,
                    name: `Top Avatar ${i}`,
                    user: { name: `Creator${i}` },
                    is_downloadable: true,
                    character_model_version: {
                        id: `ver-top-${i}`,
                        images: [{ sq170: `https://vroid-hub.pximg.net/top-thumb-${i}.png` }],
                    },
                    tags: [{ name: `tag-${i}` }],
                    license: {
                        characterization_allowed_user: i % 2 === 0 ? 'everyone' : 'author',
                        violent_expression: 'disallow',
                        sexual_expression: 'disallow',
                        corporate_commercial_use: i <= 5 ? 'allow' : 'disallow',
                        personal_commercial_use: 'allow',
                        redistribution: 'disallow',
                        modification: 'allow',
                        credit: 'necessary',
                    },
                },
            },
        });
    }
    return models;
}

describe('VRoid Hub — Fetch Top 10 Models with Thumbnails', () => {
    let mgr;

    beforeEach(() => {
        mgr = createVroidManager();
        mgr.setToken(MOCK_TOKEN_RESPONSE.access_token, MOCK_TOKEN_RESPONSE.refresh_token, 3600);
        fetch.mockClear();
        Object.keys(mockFetchResponses).forEach((k) => delete mockFetchResponses[k]);
        mockEmptyStaffPicks();
    });

    test('should fetch 10 models and all have thumbnail URLs', async () => {
        const mockModels = generateMockModels(10);
        mockFetchResponses['/api/vroid-hub?action=hearts'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: mockModels }),
        });

        const avatars = await mgr.fetchVroidHubAvatars();
        expect(avatars.length).toBe(10);

        // Every model must have a valid thumbnail URL
        avatars.forEach((avatar, i) => {
            expect(avatar.preview).toBeTruthy();
            expect(avatar.preview).toMatch(/^https:\/\//);
            expect(avatar.preview).toContain(`top-thumb-${i + 1}.png`);
        });
    });

    test('each model should have a unique id and name', async () => {
        const mockModels = generateMockModels(10);
        mockFetchResponses['/api/vroid-hub?action=hearts'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: mockModels }),
        });

        const avatars = await mgr.fetchVroidHubAvatars();
        const ids = avatars.map((a) => a.id);
        const names = avatars.map((a) => a.name);
        expect(new Set(ids).size).toBe(10);
        expect(new Set(names).size).toBe(10);
    });

    test('all 10 models should be downloadable with vroid-hub: URL', async () => {
        const mockModels = generateMockModels(10);
        mockFetchResponses['/api/vroid-hub?action=hearts'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: mockModels }),
        });

        const avatars = await mgr.fetchVroidHubAvatars();
        avatars.forEach((avatar) => {
            expect(avatar.isDownloadable).toBe(true);
            expect(avatar.url).toMatch(/^vroid-hub:/);
            expect(avatar.vroidPageUrl).toContain('https://hub.vroid.com/en/characters/');
        });
    });

    test('each model should have conditions of use extracted from license', async () => {
        const mockModels = generateMockModels(10);
        mockFetchResponses['/api/vroid-hub?action=hearts'] = () => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: mockModels }),
        });

        const avatars = await mgr.fetchVroidHubAvatars();
        avatars.forEach((avatar, i) => {
            expect(avatar.conditionsOfUse).toBeDefined();
            expect(avatar.conditionsOfUse.violentExpression).toBe('disallow');
            expect(avatar.conditionsOfUse.sexualExpression).toBe('disallow');
            expect(avatar.conditionsOfUse.personalCommercialUse).toBe('allow');
            expect(avatar.conditionsOfUse.modification).toBe('allow');
            expect(avatar.conditionsOfUse.credit).toBe('necessary');

            // Even-numbered models allow everyone, odd allow author only
            const expectedAvatarUse = (i + 1) % 2 === 0 ? 'everyone' : 'author';
            expect(avatar.conditionsOfUse.avatarUse).toBe(expectedAvatarUse);

            // First 5 models allow corporate use, rest disallow
            const expectedCorpUse = i + 1 <= 5 ? 'allow' : 'disallow';
            expect(avatar.conditionsOfUse.corporateCommercialUse).toBe(expectedCorpUse);
        });
    });

    test('should handle portrait_image fallback for thumbnails', () => {
        const modelWithPortrait = {
            id: 'portrait-model',
            name: 'Portrait Fallback',
            user: { name: 'Creator' },
            is_downloadable: true,
            character_model_version: { id: 'v1', images: [] },
            portrait_image: { sq150: 'https://vroid-hub.pximg.net/portrait-fallback.png' },
            tags: [],
        };
        const mapped = mgr._mapVroidModel(modelWithPortrait);
        expect(mapped.preview).toBe('https://vroid-hub.pximg.net/portrait-fallback.png');
    });

    test('should default conditions of use when license is missing', () => {
        const modelNoLicense = {
            id: 'no-license-model',
            name: 'No License',
            user: { name: 'Creator' },
            is_downloadable: true,
            character_model_version: { id: 'v1', images: [{ sq170: 'https://thumb.png' }] },
            tags: [],
        };
        const mapped = mgr._mapVroidModel(modelNoLicense);
        expect(mapped.conditionsOfUse).toBeDefined();
        Object.values(mapped.conditionsOfUse).forEach((v) => {
            expect(v).toBe('default');
        });
    });

    test('non-downloadable models should show description with Like hint', () => {
        const model = {
            id: 'view-only',
            name: 'View Only Model',
            user: { name: 'Creator' },
            is_downloadable: false,
            character_model_version: { id: 'v1', images: [{ sq170: 'https://thumb.png' }] },
            tags: [],
        };
        const mapped = mgr._mapVroidModel(model);
        expect(mapped.desc).toContain('See on VRoid Hub to enable download');
        expect(mapped.isDownloadable).toBe(false);
    });

    test('liked downloadable models should not show Like hint in description', () => {
        const model = {
            id: 'dl-model',
            name: 'Downloadable Model',
            user: { name: 'Creator' },
            is_downloadable: true,
            character_model_version: { id: 'v1', images: [{ sq170: 'https://thumb.png' }] },
            tags: [],
        };
        const mapped = mgr._mapVroidModel(model, true); // userLiked=true
        expect(mapped.desc).not.toContain('See on VRoid Hub');
    });
});
