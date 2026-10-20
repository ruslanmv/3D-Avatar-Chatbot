const { TryOnStageExperience } = require('../../src/wardrobe/TryOnStageExperience');

describe('Try-On clothes rail preserves the original avatar viewport', () => {
    let view, session, rail, look, dialog, canvas, viewport;

    beforeEach(() => {
        document.body.innerHTML = [
            '<div class="content-layout"><section class="avatar-panel">',
            '<div class="avatar-preview-wrap" style="width:600px;height:700px">',
            '<div id="avatar-viewport" style="width:100%;height:100%"></div>',
            '</div></section><section class="chat-panel"></section></div>',
            '<div id="original-host"><div id="nexus-try-on-view"></div></div>',
        ].join('');
        viewport = document.getElementById('avatar-viewport');
        canvas = document.createElement('canvas');
        viewport.appendChild(canvas);
        dialog = document.getElementById('nexus-try-on-view');
        look = { key: 'jeans', name: 'Crop top & jeans', previewUrl: '/jeans.png' };
        session = {
            state: jest.fn(() => ({
                look, looks: [look, { key: 'dress', name: 'Evening dress' }],
                favorite: false, busy: false, landed: 1,
                total: 2, position: 0, error: null,
            })),
        };
        view = {
            root: dialog, collapsed: true, _keepOpen: false,
            _key: (item) => item.key,
            wear: jest.fn(),
            render: jest.fn(),
        };
        rail = new TryOnStageExperience({ doc: document, session, view });
    });

    afterEach(() => {
        rail.unmount();
        delete window.NEXUS_VIEWER;
        document.body.innerHTML = '';
    });

    it('adds ONLY a look rail without resizing or moving the actual avatar canvas', () => {
        const originalViewportParent = viewport.parentElement;
        const originalCanvasParent = canvas.parentElement;
        const originalDialogParent = dialog.parentElement;
        const originalViewportStyle = viewport.getAttribute('style');
        const originalLayoutStyle = document.querySelector('.content-layout').getAttribute('style');
        const originalPreviewStyle = originalViewportParent.getAttribute('style');
        rail.mount();

        expect(document.querySelector('.nexus-try-on-look-rail')).toBeTruthy();
        expect(document.querySelector('.nexus-stage-ui')).toBeNull();
        expect(document.querySelector('.nexus-stage-bottom')).toBeNull();
        expect(viewport.parentElement).toBe(originalViewportParent);
        expect(canvas.parentElement).toBe(originalCanvasParent);
        expect(dialog.parentElement).toBe(originalDialogParent);
        expect(viewport.getAttribute('style')).toBe(originalViewportStyle);
        expect(originalViewportParent.getAttribute('style')).toBe(originalPreviewStyle);
        expect(document.querySelector('.content-layout').getAttribute('style')).toBe(originalLayoutStyle);
        expect(dialog.hidden).toBe(true);
    });

    it('wears selected outfits using the actual session and existing view', () => {
        rail.mount();
        const looks = document.querySelectorAll('.nexus-look-rail-item');
        expect(looks).toHaveLength(2);
        expect(looks[0].getAttribute('aria-pressed')).toBe('true');
        looks[1].click();
        expect(view.wear).toHaveBeenCalledWith(session.state().looks[1]);
    });

    it('keeps full wardrobe functionality accessible without moving its root', () => {
        const originalParent = dialog.parentElement;
        rail.mount();
        document.querySelector('.nexus-look-rail-edit').click();
        expect(dialog.hidden).toBe(false);
        expect(dialog.parentElement).toBe(originalParent);
        expect(view.collapsed).toBe(false);
        expect(view._keepOpen).toBe(true);
        expect(view.render).toHaveBeenCalled();
        document.querySelector('.nexus-look-rail-edit').click();
        expect(dialog.hidden).toBe(true);
        expect(view.collapsed).toBe(true);
    });

    it('never reframes, zooms, resizes, or otherwise modifies the avatar camera', () => {
        const viewer = {
            camera: { position: { x: 0, y: 1, z: 4 } },
            frameObject: jest.fn(), resize: jest.fn(), resetCamera: jest.fn(),
        };
        window.NEXUS_VIEWER = viewer;
        rail.mount();
        rail.render(session.state());
        rail.render({ ...session.state(), landed: 2 });
        expect(viewer.frameObject).not.toHaveBeenCalled();
        expect(viewer.resize).not.toHaveBeenCalled();
        expect(viewer.resetCamera).not.toHaveBeenCalled();
        expect(viewer.camera.position).toEqual({ x: 0, y: 1, z: 4 });
    });

    it('restores the normal wardrobe dialog when the activity ends', () => {
        const parent = dialog.parentElement;
        rail.mount();
        rail.unmount();
        expect(dialog.parentElement).toBe(parent);
        expect(dialog.hidden).toBe(false);
        expect(document.querySelector('.nexus-try-on-look-rail')).toBeNull();
        expect(viewport.contains(canvas)).toBe(true);
        expect(view.stageExperience).toBeNull();
    });

    it('displays the wardrobe opener even before any outfit loads', () => {
        session.state.mockReturnValue({
            look: null, looks: [], favorite: false, busy: false, landed: 0, total: 0,
        });
        rail.mount();
        expect(document.querySelector('.nexus-look-rail-item')).toBeNull();
        expect(document.querySelector('.nexus-look-rail-edit')).not.toBeNull();
    });
});
