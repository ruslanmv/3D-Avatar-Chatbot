const { TryOnStageExperience } = require('../../src/wardrobe/TryOnStageExperience');

describe('reference-v2 Try-On stage: functional actions, untouched viewport', () => {
    let stage, view, session, look, viewport, canvas, dialog;
    beforeEach(() => {
        document.body.innerHTML = [
            '<div class="content-layout"><div class="avatar-preview-wrap" style="height:600px;width:700px">',
            '<div id="avatar-viewport" style="width:100%;height:100%"></div>',
            '</div><div class="chat-panel"></div></div>',
            '<div id="original-host"><div id="nexus-try-on-view"></div></div>',
        ].join('');
        viewport = document.getElementById('avatar-viewport');
        canvas = document.createElement('canvas');
        viewport.appendChild(canvas);
        dialog = document.getElementById('nexus-try-on-view');
        look = {
            key: 'jeans',
            name: 'Crop top & jeans',
            prompt: 'Black crop top + blue jeans',
            previewUrl: '/jeans.png',
        };
        session = {
            state: jest.fn(() => ({
                look,
                looks: [look, { key: 'dress', name: 'Evening dress' }],
                favorite: false,
                busy: false,
                landed: 1,
                position: 0,
                total: 2,
            })),
        };
        view = {
            root: dialog,
            collapsed: true,
            _keepOpen: false,
            turned: false,
            turner: { toggle: jest.fn() },
            _key: (l) => l.key,
            wear: jest.fn(),
            favorite: jest.fn(),
            turn: jest.fn(),
            _step: jest.fn(),
            render: jest.fn(),
        };
        stage = new TryOnStageExperience({ doc: document, view, session });
    });
    afterEach(() => {
        stage.unmount();
        delete window.NEXUS_VIEWER;
        document.body.innerHTML = '';
    });

    it('adds the reference-v2 UI but leaves the original canvas, viewport and grid dimensions intact', () => {
        const originalViewportParent = viewport.parentElement;
        const originalCanvasParent = canvas.parentElement;
        const originalDialogParent = dialog.parentElement;
        const originalViewportStyle = viewport.getAttribute('style');
        const originalGridStyle = document.querySelector('.content-layout').getAttribute('style');
        stage.mount();
        expect(document.querySelector('.nexus-stage-label').textContent).toContain('LIVE TRY-ON');
        expect(document.querySelector('.nexus-stage-look-name').textContent).toBe(look.name);
        expect(document.querySelector('.nexus-stage-count').textContent).toContain('1 / 2');
        expect(document.querySelector('.nexus-look-rail-title').textContent).toBe('Looks (2)');
        expect(viewport.parentElement).toBe(originalViewportParent);
        expect(canvas.parentElement).toBe(originalCanvasParent);
        expect(dialog.parentElement).toBe(originalDialogParent);
        expect(viewport.getAttribute('style')).toBe(originalViewportStyle);
        expect(document.querySelector('.content-layout').getAttribute('style')).toBe(originalGridStyle);
        expect(dialog.hidden).toBe(true);
    });

    it('selects clothing thumbnails through the real wear() method and keeps active look highlighted', () => {
        stage.mount();
        const tiles = document.querySelectorAll('.nexus-look-rail-item');
        expect(tiles).toHaveLength(2);
        expect(tiles[0].getAttribute('aria-pressed')).toBe('true');
        tiles[1].click();
        expect(view.wear).toHaveBeenCalledWith(session.state().looks[1]);
    });

    it('routes show-back, save, and next actions through existing TryOnView methods', () => {
        stage.mount();
        document.querySelector('[data-command="turn"]').click();
        document.querySelector('[data-command="save"]').click();
        document.querySelector('[data-command="next"]').click();
        expect(view.turn).toHaveBeenCalledTimes(1);
        expect(view.favorite).toHaveBeenCalledTimes(1);
        expect(view._step).toHaveBeenCalledWith(1);
    });

    it('shows the original advanced customization panel only after More is clicked', () => {
        stage.mount();
        const original = dialog.parentElement;
        expect(dialog.hidden).toBe(true);
        document.querySelector('.nexus-look-rail-edit').click();
        expect(dialog.hidden).toBe(false);
        expect(dialog.parentElement).toBe(original);
        expect(view._keepOpen).toBe(true);
        document.querySelector('.nexus-look-rail-edit').click();
        expect(dialog.hidden).toBe(true);
        expect(view.collapsed).toBe(true);
    });

    it('never automatically resizes or reframes the avatar when looks change', () => {
        const viewer = { frameObject: jest.fn(), resetCamera: jest.fn(), resize: jest.fn() };
        window.NEXUS_VIEWER = viewer;
        stage.mount();
        stage.render(session.state());
        stage.render({ ...session.state(), landed: 2 });
        expect(viewer.frameObject).not.toHaveBeenCalled();
        expect(viewer.resize).not.toHaveBeenCalled();
        expect(viewer.resetCamera).not.toHaveBeenCalled();
    });

    it('restores the old UI with no duplicate overlays on activity cleanup', () => {
        const originalDialogParent = dialog.parentElement;
        stage.mount();
        stage.unmount();
        expect(document.querySelector('.nexus-try-on-look-rail')).toBeNull();
        expect(document.querySelector('.nexus-stage-info')).toBeNull();
        expect(document.querySelector('.nexus-stage-label')).toBeNull();
        expect(dialog.parentElement).toBe(originalDialogParent);
        expect(dialog.hidden).toBe(false);
        expect(viewport.contains(canvas)).toBe(true);
    });

    it('handles an empty collection and blocks unavailable actions', () => {
        session.state.mockReturnValue({ look: null, looks: [], total: 0, position: 0, busy: false });
        stage.mount();
        expect(document.querySelector('.nexus-stage-look-name').textContent).toContain('Choose your first');
        expect(document.querySelector('[data-command="save"]').disabled).toBe(true);
        expect(document.querySelector('[data-command="next"]').disabled).toBe(true);
        expect(document.querySelector('.nexus-look-rail-edit')).not.toBeNull();
    });
});
