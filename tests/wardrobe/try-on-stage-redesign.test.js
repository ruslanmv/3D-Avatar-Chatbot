/**
 * LT3. The Try-On stage, phases 1–2 of the mobile-first redesign.
 *
 * Each block holds one property that a real browser run showed broken:
 *
 *   * **Together keeps its ten activities.** The redesign starts after an activity is chosen;
 *     the chooser's table and Try-On's own tile are pinned here, and the browser tour
 *     (`tools/try-on-tour.mjs`) checks the ten tiles a person actually sees.
 *   * **She keeps her size.** Wearing a look swapped the avatar file, and AvatarManager framed
 *     the new file further out than the startup framing: she shrank to about 60 % of her height
 *     on the stage. The controller now holds the camera across the swap and the restore.
 *   * **The commentary follows the outfit.** It said "Choose a look…" through every look.
 *   * **Zoom is a real close view and goes back exactly.**
 *   * **More never stacks over the stage summary.**
 */

const TogetherPanel = require('../../src/features/together/ui/TogetherPanel.js');
const TryOnHaulActivity = require('../../src/wardrobe/TryOnHaulActivity.js');
const WardrobeController = require('../../src/wardrobe/WardrobeController.js');
const { TryOnStageExperience } = require('../../src/wardrobe/TryOnStageExperience');
const { TryOnLiveLayout } = require('../../src/wardrobe/TryOnLiveLayout');

/** Just enough of THREE.Vector3 for the camera code: clone, copy, sub, add, scale, length. */
function vec(x, y, z) {
    return {
        x,
        y,
        z,
        clone() {
            return vec(this.x, this.y, this.z);
        },
        copy(v) {
            this.x = v.x;
            this.y = v.y;
            this.z = v.z;
            return this;
        },
        set(x2, y2, z2) {
            this.x = x2;
            this.y = y2;
            this.z = z2;
            return this;
        },
        sub(v) {
            this.x -= v.x;
            this.y -= v.y;
            this.z -= v.z;
            return this;
        },
        add(v) {
            this.x += v.x;
            this.y += v.y;
            this.z += v.z;
            return this;
        },
        multiplyScalar(s) {
            this.x *= s;
            this.y *= s;
            this.z *= s;
            return this;
        },
        length() {
            return Math.hypot(this.x, this.y, this.z);
        },
    };
}

function fakeViewer() {
    const manager = {
        current: { url: '/vendor/avatars/fem_vroid.vrm', name: 'VRoid Female', index: 0 },
        getCurrent() {
            return this.current;
        },
        // What AvatarManager does on every load: frames the new file its own way.
        async setAvatarByUrl(url, name, index) {
            viewer.camera.position.set(0, 1.1, 5.6);
            this.current = { url, name, index };
            return this.current;
        },
        frameAvatar: jest.fn(() => viewer.camera.position.set(0, 1.2, 6.0)),
    };
    const viewer = {
        avatarManager: manager,
        camera: { position: vec(0, 0.958, 4.391), updateProjectionMatrix: jest.fn() },
        controls: { target: vec(0, 0.825, -0.057), minDistance: 0.6, maxDistance: 17.6, update: jest.fn() },
    };
    return viewer;
}

describe('Together keeps its activities', () => {
    it('keeps the chooser table for the eight built-in activities, with their names and icons', () => {
        const steps = TogetherPanel.STEPS;
        expect(Object.keys(steps).sort()).toEqual(
            ['coach', 'cohost', 'copilot', 'focus', 'journey', 'meeting', 'music', 'watch'].sort()
        );
        const tiles = Object.fromEntries(Object.entries(steps).map(([id, step]) => [id, step.icon + ' ' + step.title]));
        expect(tiles).toMatchObject({
            watch: '📺 Watch',
            journey: '🌊 Journey',
            music: '🎧 Music',
            cohost: '🎮 Play',
            focus: '🎯 Focus',
            coach: '🏋 Coach',
            copilot: '👀 Help me with this',
        });
    });

    it('lists Try-On from its own tile metadata, next to the built-in ones', () => {
        expect(TryOnHaulActivity.UI).toMatchObject({ title: 'Try-On', icon: '👗' });
        const registry = new Map([
            ['watch', { id: 'watch' }],
            ['music', { id: 'music' }],
            ['try-on-haul', { id: 'try-on-haul', ui: TryOnHaulActivity.UI }],
        ]);
        expect(TogetherPanel.choosable(registry).map((a) => a.id)).toEqual(['watch', 'music', 'try-on-haul']);
    });
});

describe('she keeps her size when a look is worn', () => {
    const look = { name: 'Crop top & jeans', vrmUrl: '/vendor/wardrobe/looks/fem-vroid/crop-top-jeans/look.vrm' };

    function controller(viewer) {
        return new WardrobeController({ forge: { resolveUrl: (url) => url }, viewer });
    }

    it('holds the camera position, target and zoom range across a look', async () => {
        const viewer = fakeViewer();
        await controller(viewer).applyLook(look);
        expect([viewer.camera.position.x, viewer.camera.position.y, viewer.camera.position.z]).toEqual([
            0, 0.958, 4.391,
        ]);
        expect([viewer.controls.target.y, viewer.controls.target.z]).toEqual([0.825, -0.057]);
        expect(viewer.controls.minDistance).toBe(0.6);
        expect(viewer.controls.maxDistance).toBe(17.6);
        expect(viewer.avatarManager.frameAvatar).not.toHaveBeenCalled();
        expect(viewer.controls.update).toHaveBeenCalled();
    });

    it('holds it across the restore, and when the look fails to load', async () => {
        const viewer = fakeViewer();
        const wardrobe = controller(viewer);
        await wardrobe.applyLook(look);
        await wardrobe.restore();
        expect(viewer.camera.position.z).toBe(4.391);
        viewer.avatarManager.setAvatarByUrl = async () => {
            viewer.camera.position.set(0, 1, 9);
            throw new Error('network');
        };
        await expect(wardrobe.applyLook(look)).rejects.toThrow('network');
        expect(viewer.camera.position.z).toBe(4.391);
    });

    it('falls back to the manager framing when there is no camera to hold', async () => {
        const viewer = fakeViewer();
        delete viewer.controls;
        await controller(viewer).applyLook(look);
        expect(viewer.avatarManager.frameAvatar).toHaveBeenCalledTimes(1);
    });
});

describe('the stage', () => {
    let stage, view, session, state, onCommentary;
    const jeans = { key: 'jeans', name: 'Crop top & jeans', prompt: 'black fitted crop top + blue straight jeans' };
    const dress = { key: 'dress', name: 'Yellow sundress', prompt: 'yellow maxi sundress' };

    beforeEach(() => {
        document.body.innerHTML = [
            '<div class="content-layout"><div class="avatar-preview-wrap">',
            '<div id="avatar-viewport"></div>',
            '<div class="hud-overlay"><div class="hud-corner hud-tl"></div><div class="status-badge"></div></div>',
            '</div></div><div id="nexus-try-on-view"></div>',
        ].join('');
        state = { look: null, looks: [jeans, dress], favorite: false, busy: false, landed: 0, position: 0, total: 2 };
        session = { state: jest.fn(() => state) };
        view = {
            root: document.getElementById('nexus-try-on-view'),
            collapsed: true,
            turner: {},
            reaction: null,
            _key: (l) => l.key,
            wear: jest.fn(),
            favorite: jest.fn(),
            turn: jest.fn(),
            _step: jest.fn(),
            render: jest.fn(),
        };
        onCommentary = jest.fn();
        stage = new TryOnStageExperience({ doc: document, view, session, onCommentary });
    });

    afterEach(() => {
        stage.unmount();
        delete window.NEXUS_VIEWER;
        document.body.innerHTML = '';
    });

    it('names the looks on the rail', () => {
        stage.mount();
        const captions = [...document.querySelectorAll('.nexus-look-rail-caption')].map((c) => c.textContent);
        expect(captions).toEqual(['Crop top & jeans', 'Yellow sundress']);
    });

    it('says what she is wearing once each look lands, and nothing before', () => {
        stage.mount();
        expect(onCommentary).not.toHaveBeenCalled();
        stage.render((state = { ...state, look: jeans, landed: 1 }));
        expect(onCommentary).toHaveBeenLastCalledWith(
            'Now wearing Crop top & jeans: black fitted crop top, blue straight jeans.'
        );
        stage.render(state); // a re-render of the same landing says nothing new
        expect(onCommentary).toHaveBeenCalledTimes(1);
        view.reaction = { line: 'Okay, the sundress! That yellow is so sunny.' };
        stage.render((state = { ...state, look: dress, landed: 2, position: 1 }));
        expect(onCommentary).toHaveBeenLastCalledWith('Okay, the sundress! That yellow is so sunny.');
    });

    it('passes on her reaction when it arrives after the look', () => {
        stage.mount();
        stage.render((state = { ...state, look: dress, landed: 1 }));
        view.reaction = { line: 'Sundress season.' };
        stage.render(state);
        expect(onCommentary).toHaveBeenLastCalledWith('Sundress season.');
        expect(onCommentary).toHaveBeenCalledTimes(2);
    });

    it('zooms to a close view and back to exactly the camera the person had', () => {
        const viewer = fakeViewer();
        window.NEXUS_VIEWER = viewer;
        stage.mount();
        stage.render((state = { ...state, look: jeans, landed: 1 }));
        const zoom = () => document.querySelector('[data-command="zoom"]');
        zoom().click();
        const away = viewer.camera.position.clone().sub(viewer.controls.target).length();
        expect(away).toBeLessThan(0.6 * Math.hypot(0, 0.958 - 0.825, 4.391 + 0.057));
        expect(viewer.controls.target.y).toBeGreaterThan(0.825);
        expect(zoom().getAttribute('aria-pressed')).toBe('true');
        expect(zoom().textContent).toContain('Full body');
        zoom().click();
        expect([viewer.camera.position.y, viewer.camera.position.z]).toEqual([0.958, 4.391]);
        expect([viewer.controls.target.y, viewer.controls.target.z]).toEqual([0.825, -0.057]);
        expect(zoom().getAttribute('aria-pressed')).toBe('false');
    });

    it('hides the stage summary while the advanced panel is open, and marks the page while it runs', () => {
        stage.mount();
        const preview = document.querySelector('.avatar-preview-wrap');
        expect(document.documentElement.classList.contains('nexus-try-on-stage-on')).toBe(true);
        document.querySelector('.nexus-look-rail-edit').click();
        expect(preview.classList.contains('nexus-try-on-advanced-open')).toBe(true);
        document.querySelector('.nexus-look-rail-edit').click();
        expect(preview.classList.contains('nexus-try-on-advanced-open')).toBe(false);
        stage.unmount();
        expect(document.documentElement.classList.contains('nexus-try-on-stage-on')).toBe(false);
        expect(preview.classList.contains('nexus-try-on-stage-active')).toBe(false);
    });
});

describe('the Live commentary card', () => {
    let layout;

    function addMessage(who, text) {
        const row = document.createElement('div');
        row.className = 'chat-row';
        row.innerHTML = '<div class="chat-message ' + who + '"><div class="message-text"></div></div>';
        row.querySelector('.message-text').textContent = text;
        document.getElementById('chat-history').appendChild(row);
    }

    beforeEach(() => {
        document.body.innerHTML = [
            '<main class="content-layout"><section class="chat-panel"><div class="chat-card">',
            '<header class="chat-card-header"><span class="section-title">Conversation</span></header>',
            '<div class="chat-main"><div id="chat-history"></div></div>',
            '<footer class="chat-input-shell"><input id="speech-text"><button id="speak-btn">Send</button></footer>',
            '</div></section></main>',
        ].join('');
        layout = new TryOnLiveLayout({ doc: document });
        layout.mount();
    });

    afterEach(() => {
        layout.unmount();
        document.body.innerHTML = '';
    });

    it('shows the stage line, keeps it over an older reply, and gives way to a new one', () => {
        addMessage('avatar', 'Want to start with the jeans?');
        layout.update();
        layout.commentate('Now wearing Yellow sundress: yellow maxi sundress.');
        layout.update(); // the transcript did not change: the stage line stays
        const answer = () => document.querySelector('.nexus-live-answer').textContent;
        expect(answer()).toBe('Now wearing Yellow sundress: yellow maxi sundress.');
        addMessage('avatar', 'That yellow is perfect for a picnic.');
        layout.update();
        expect(answer()).toBe('That yellow is perfect for a picnic.');
        expect(document.querySelectorAll('#chat-history .chat-row')).toHaveLength(2); // nothing written into the chat
    });
});
