const { TryOnStageExperience, description } = require('../../src/wardrobe/TryOnStageExperience');

describe('avatar-first Try-On stage layout', () => {
    let view, session, stage, model, root, canvas;

    beforeEach(() => {
        document.body.innerHTML = [
            '<div class="avatar-preview-wrap">',
            '<div id="avatar-viewport"></div>',
            '</div>',
            '<div id="original-host"><div id="nexus-try-on-view"></div></div>',
        ].join('');
        canvas = document.createElement('canvas');
        document.getElementById('avatar-viewport').appendChild(canvas);
        root = document.getElementById('nexus-try-on-view');
        model = { key: 'jeans', name: 'Crop top & jeans', prompt: 'Black crop top + blue jeans', previewUrl: '/jeans.png' };
        session = {
            state: jest.fn(() => ({
                look: model, looks: [model, { key: 'dress', name: 'Evening dress' }],
                favorite: false, busy: false, landed: 1,
                total: 2, position: 0, error: null,
            })),
        };
        view = {
            root, collapsed: true, _keepOpen: false, turned: false,
            turner: { toggle: jest.fn() },
            _key: (look) => look.key,
            wear: jest.fn(), favorite: jest.fn(), turn: jest.fn(),
            _step: jest.fn(), render: jest.fn(),
        };
        stage = new TryOnStageExperience({ doc: document, session, view });
    });

    afterEach(() => {
        stage.unmount();
        delete window.NEXUS_VIEWER;
        document.body.innerHTML = '';
    });

    it('moves the original full wardrobe off the avatar until More opens it', () => {
        stage.mount();
        expect(root.hidden).toBe(true);
        expect(document.querySelector('.nexus-stage-ui')).not.toBeNull();
        expect(document.querySelector('.avatar-preview-wrap').contains(root)).toBe(true);
        expect(document.querySelector('#avatar-viewport canvas')).toBe(canvas);
        const looks = document.querySelectorAll('.nexus-stage-look-tile');
        expect(looks).toHaveLength(2);
        looks[1].click();
        expect(view.wear).toHaveBeenCalledWith(session.state().looks[1]);
    });

    it('uses the real session and view for Turn, Save and Next', () => {
        stage.mount();
        const turn = document.querySelector('[data-command="turn"]');
        const save = document.querySelector('[data-command="save"]');
        const next = document.querySelector('[data-command="next"]');
        turn.click();
        save.click();
        next.click();
        expect(view.turn).toHaveBeenCalledTimes(1);
        expect(view.favorite).toHaveBeenCalledTimes(1);
        expect(view._step).toHaveBeenCalledWith(1);
    });

    it('keeps the actual wardrobe controls available in More without losing the session', () => {
        stage.mount();
        const original = session;
        stage.toggleAdvanced();
        expect(root.hidden).toBe(false);
        expect(view.collapsed).toBe(false);
        expect(view._keepOpen).toBe(true);
        expect(view.render).toHaveBeenCalledTimes(1);
        stage.toggleAdvanced();
        expect(root.hidden).toBe(true);
        expect(view.collapsed).toBe(true);
        expect(session).toBe(original);
    });

    it('reframes the actual VRM only for a newly landed look', () => {
        const viewer = {
            avatarManager: { currentRoot: {} },
            resize: jest.fn(), frameObject: jest.fn(),
        };
        window.NEXUS_VIEWER = viewer;
        stage.mount();
        expect(viewer.frameObject).toHaveBeenCalledTimes(1);
        stage.render(session.state());
        expect(viewer.frameObject).toHaveBeenCalledTimes(1);
        const change = { ...session.state(), landed: 2 };
        stage.render(change);
        expect(viewer.frameObject).toHaveBeenCalledTimes(2);
        expect(viewer.frameObject).toHaveBeenCalledWith(viewer.avatarManager.currentRoot, 1.23);
    });

    it('restores the original DOM owner and actual canvas on teardown', () => {
        const originalParent = root.parentElement;
        stage.mount();
        stage.unmount();
        expect(root.parentElement).toBe(originalParent);
        expect(root.hidden).toBe(false);
        expect(document.querySelector('.nexus-stage-ui')).toBeNull();
        expect(document.getElementById('avatar-viewport').contains(canvas)).toBe(true);
        expect(view.stageExperience).toBeNull();
    });

    it('does not invent descriptions when outfit metadata is missing', () => {
        expect(description({ prompt: 'Black crop top + blue jeans' })).toBe('Black crop top · blue jeans');
        expect(description({ name: 'Look' })).toBe('');
    });
});
