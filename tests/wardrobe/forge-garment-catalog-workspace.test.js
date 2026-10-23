const { ForgeGarmentCatalogWorkspace } = require('../../src/wardrobe/ForgeGarmentCatalogWorkspace');
const { TryOnStageExperience } = require('../../src/wardrobe/TryOnStageExperience');

function mountPage() {
    document.body.innerHTML = [
        '<div class="content-layout">',
        '<div class="avatar-preview-wrap" style="width:700px;height:600px">',
        '<div id="avatar-viewport"><canvas id="keep-this-canvas"></canvas></div>',
        '</div>',
        '<div class="chat-panel"><div class="chat-card"></div></div>',
        '</div>',
        '<div id="legacy-host"><div id="nexus-try-on-view"></div></div>',
    ].join('');
}

const CATALOG = {
    categories: [
        {
            id: 'top',
            label: 'Tops',
            count: 2,
            garments: [
                {
                    id: 'top-crop-tee-v1',
                    name: 'Crop top',
                    category: 'top',
                    supportsColor: true,
                    previewStatus: 'ready',
                    previewUrl: '/v1/catalog/garments/top-crop-tee-v1/preview',
                },
                {
                    id: 'top-basic-tee-v1',
                    name: 'Basic tee',
                    category: 'top',
                    supportsColor: true,
                    previewStatus: 'pending',
                    previewUrl: null,
                },
            ],
        },
        {
            id: 'dress',
            label: 'Dresses',
            count: 1,
            garments: [
                {
                    id: 'dress-a-line-v1',
                    name: 'A-line dress',
                    category: 'dress',
                    supportsColor: true,
                    previewStatus: 'pending',
                    previewUrl: null,
                },
            ],
        },
    ],
};

describe('real garment catalog within Try-On', () => {
    let workspace, view, client, canvas, legacy, stage;
    beforeEach(() => {
        mountPage();
        canvas = document.getElementById('keep-this-canvas');
        legacy = document.getElementById('nexus-try-on-view');
        client = {
            getGarmentCatalog: jest.fn(async () => CATALOG),
            resolveUrl: jest.fn((url) => 'https://forge.example' + url),
        };
        view = {
            root: legacy,
            session: { state: jest.fn(() => ({ look: null, looks: [], position: 0, total: 0 })) },
            generator: { availability: () => ({ ok: true }) },
            create: jest.fn(async () => ({ id: 'generated1' })),
            Intent: { buildable: jest.fn(() => false) },
            render: jest.fn(),
            _key: jest.fn(),
            turner: null,
            favorite: jest.fn(),
            _step: jest.fn(),
        };
        workspace = new ForgeGarmentCatalogWorkspace({ doc: document, view, client });
    });
    afterEach(() => {
        if (stage) stage.unmount();
        else workspace.destroy();
        document.body.innerHTML = '';
        stage = null;
    });

    test('loads real category metadata without mounting another avatar renderer', async () => {
        const originalParent = canvas.parentElement;
        await workspace.open();
        expect(client.getGarmentCatalog).toHaveBeenCalledTimes(1);
        expect(document.querySelectorAll('.nexus-catalog-card')).toHaveLength(2);
        expect(document.querySelector('.nexus-catalog-image').src).toContain(
            '/v1/catalog/garments/top-crop-tee-v1/preview'
        );
        expect(document.querySelector('.nexus-catalog-placeholder').textContent).toMatch(/not ready/);
        expect(canvas.parentElement).toBe(originalParent);
        expect(document.querySelectorAll('canvas')).toHaveLength(1);
        expect(legacy.parentElement.id).toBe('legacy-host');
    });

    test('selection alone does not change the worn look; apply awaits real generation', async () => {
        await workspace.open();
        document.querySelector('.nexus-catalog-card').click();
        expect(view.create).not.toHaveBeenCalled();
        const colors = document.querySelectorAll('.nexus-catalog-swatch');
        expect(colors.length).toBeGreaterThan(0);
        const red = Array.from(colors).find((el) => el.getAttribute('aria-label') === 'red');
        red.click();
        await document.querySelector('.nexus-catalog-primary').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(view.create).toHaveBeenCalledWith(
            expect.objectContaining({
                templateId: 'top-crop-tee-v1',
                color: 'red',
                prompt: 'red Crop top',
            })
        );
        expect(workspace.opened).toBe(false);
    });

    test('generation failure leaves picker open and does not promise applied outfit', async () => {
        view.create = jest.fn(async () => null);
        view.createError = 'Fitting failed; look unchanged';
        await workspace.open();
        document.querySelector('.nexus-catalog-card').click();
        document.querySelector('.nexus-catalog-primary').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(workspace.opened).toBe(true);
        expect(document.querySelector('.nexus-catalog-error').textContent).toContain('look unchanged');
    });

    test('More opens catalog in right workspace, leaving legacy overlay hidden', async () => {
        const session = {
            state: jest.fn(() => ({
                look: null,
                looks: [],
                busy: false,
                position: 0,
                total: 0,
            })),
        };
        stage = new TryOnStageExperience({ doc: document, view, session, workspace });
        stage.mount();
        const originalParent = canvas.parentElement;
        document.querySelector('.nexus-look-rail-edit').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(workspace.opened).toBe(true);
        expect(legacy.hidden).toBe(true);
        expect(canvas.parentElement).toBe(originalParent);
        workspace.close();
        expect(document.querySelector('.nexus-catalog-overlay')).toBeNull();
    });
});
