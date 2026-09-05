/**
 * Watch Together (B12).
 *
 * The batch is bought on two sentences, and they pull in opposite directions:
 *
 *   * a local file and a captured tab both hold 1080p at ≥30 fps — a claim about the
 *     frame path, which is checked as the property that decides it (zero-copy
 *     `VideoTexture`, geometry built once, nothing drawing on the render path) plus a
 *     measured per-frame budget. A Node process is not a Quest, and the tests say which
 *     of the two they are speaking about.
 *   * a negative test proves she stays quiet mid-scene — the one the mode exists for.
 *     "Her silence is the feature" is only true if something fails when it stops being.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const { Mixer } = require('../../src/behavior/mixer/LayerMixer.js');
const TogetherProfile = require('../../src/behavior/modes/together.profile.js');
const CompanionProfile = require('../../src/behavior/modes/companion.profile.js');
const MediaAdapter = require('../../src/behavior/adapters/MediaAdapter.js');
const ConsentMachine = require('../../src/features/together/capture/ConsentMachine.js');
const Watch = require('../../src/features/together/activities/watch.js');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'behavior.config.json'), 'utf8'));

const { CinemaScreen, JointAttention, CommentaryGate, aimQuaternion, SCREEN, OPENING_WINDOW_MS } = Watch;

// ── stand-ins ────────────────────────────────────────────────────────────────

/** Just enough three.js to build and place a mesh, and to notice how it was built. */
function fakeThree() {
    const built = { geometries: [], textures: [], materials: [] };
    class Vector3 {
        constructor(x = 0, y = 0, z = 0) {
            Object.assign(this, { x, y, z });
        }
        set(x, y, z) {
            Object.assign(this, { x, y, z });
            return this;
        }
        copy(v) {
            return this.set(v.x, v.y, v.z);
        }
        setFromMatrixPosition(m) {
            return this.set(m.elements[12], m.elements[13], m.elements[14]);
        }
    }
    const three = {
        Vector3,
        BackSide: 'BackSide',
        LinearFilter: 'LinearFilter',
        sRGBEncoding: 'sRGB',
        CylinderGeometry: class {
            constructor(...args) {
                this.args = args;
                built.geometries.push(this);
            }
            dispose() {
                this.disposed = true;
            }
        },
        VideoTexture: class {
            constructor(video) {
                this.video = video;
                built.textures.push(this);
            }
            dispose() {
                this.disposed = true;
            }
        },
        MeshBasicMaterial: class {
            constructor(options) {
                Object.assign(this, options);
                built.materials.push(this);
            }
            dispose() {
                this.disposed = true;
            }
        },
        Mesh: class {
            constructor(geometry, material) {
                this.geometry = geometry;
                this.material = material;
                this.position = new Vector3();
                this.rotation = new Vector3();
                this.parent = null;
            }
        },
    };
    three.built = built;
    return three;
}

function fakeScene() {
    const children = [];
    return {
        children,
        add(mesh) {
            mesh.parent = this;
            children.push(mesh);
        },
        remove(mesh) {
            const i = children.indexOf(mesh);
            if (i >= 0) children.splice(i, 1);
            mesh.parent = null;
        },
    };
}

/** A viewer with the pieces the app really exposes: scene, camera, arSupport. */
function fakeViewer({ ar = false, reticleVisible = true, at = [1, 0, -2] } = {}) {
    return {
        scene: fakeScene(),
        camera: { position: { x: 0, y: 1.6, z: 0 } },
        arSupport: {
            isARActive: ar,
            reticle: {
                visible: reticleVisible,
                matrix: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, at[0], at[1], at[2], 1] },
            },
        },
    };
}

/** A video element with the two source shapes and working listeners. */
function fakeVideo({ width = 1920, height = 1080 } = {}) {
    const listeners = {};
    return {
        videoWidth: width,
        videoHeight: height,
        paused: true,
        src: '',
        srcObject: null,
        play() {
            this.paused = false;
            this.fire('play');
            return Promise.resolve();
        },
        pause() {
            this.paused = true;
            this.fire('pause');
        },
        addEventListener(name, handler) {
            (listeners[name] = listeners[name] || []).push(handler);
        },
        removeEventListener(name, handler) {
            const list = listeners[name] || [];
            const i = list.indexOf(handler);
            if (i >= 0) list.splice(i, 1);
        },
        fire(name, payload) {
            for (const handler of (listeners[name] || []).slice()) handler(payload);
        },
        get listenerCount() {
            return Object.values(listeners).reduce((n, l) => n + l.length, 0);
        },
    };
}

/** A canvas whose pixels a test dictates — the scene-cut fixture. */
function fakeProbe(lumaSequence) {
    let index = 0;
    return {
        width: 0,
        height: 0,
        getContext: () => ({
            drawImage() {},
            clearRect() {},
            getImageData: (x, y, w, h) => {
                const value = Math.round((lumaSequence[Math.min(index++, lumaSequence.length - 1)] || 0) * 255);
                const data = new Uint8ClampedArray(w * h * 4);
                for (let i = 0; i < data.length; i += 4) {
                    data[i] = data[i + 1] = data[i + 2] = value;
                    data[i + 3] = 255;
                }
                return { data };
            },
        }),
    };
}

function fakeMedia() {
    const stream = { getTracks: () => [{ stop() {}, addEventListener() {}, removeEventListener() {} }] };
    return { getDisplayMedia: () => Promise.resolve(stream), getUserMedia: () => Promise.resolve(stream) };
}

function mixerWithHead() {
    const mixer = new Mixer({ applyBone: () => {} });
    mixer.addLayer({ name: 'head', mask: 'head', order: 3, weight: 1 });
    return mixer;
}

beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ── the frame path ───────────────────────────────────────────────────────────

describe('both sources end at the same texture', () => {
    test('the video element is bound straight to a VideoTexture', () => {
        const three = fakeThree();
        const video = fakeVideo();
        const screen = new CinemaScreen({ three, video, scene: fakeScene() });
        screen.build();

        expect(three.built.textures).toHaveLength(1);
        expect(three.built.textures[0].video).toBe(video);
        expect(three.built.materials[0].map).toBe(three.built.textures[0]);
    });

    /**
     * The property that actually decides whether 1080p holds. A per-frame `drawImage` into
     * a canvas and a `CanvasTexture` is the way this gets written by accident, and it is
     * the way it stops holding 1080p — so the file is read rather than the behaviour
     * sampled, because the sampling would need a GPU to be meaningful.
     */
    test('nothing copies a frame on the render path', () => {
        const source = fs.readFileSync(
            path.join(ROOT, 'src', 'features', 'together', 'activities', 'watch.js'),
            'utf8'
        );
        const body = source.slice(source.indexOf('const WatchActivity'));
        for (const forbidden of ['drawImage', 'CanvasTexture', 'getImageData', 'toDataURL', 'needsUpdate']) {
            expect(`${forbidden}: ${body.includes(forbidden)}`).toBe(`${forbidden}: false`);
        }
    });

    test('the geometry is built once, however many times place is called', () => {
        const three = fakeThree();
        const viewer = fakeViewer();
        const screen = new CinemaScreen({ three, video: fakeVideo() });
        screen.placeInVR(viewer);
        screen.placeInVR(viewer);
        screen.placeInVR(viewer);
        expect(three.built.geometries).toHaveLength(1);
        expect(three.built.textures).toHaveLength(1);
    });

    test('the screen is curved, open-ended and seen from the inside', () => {
        const three = fakeThree();
        const screen = new CinemaScreen({ three, video: fakeVideo() });
        screen.build();
        const [radiusTop, radiusBottom, height, segments, heightSegments, openEnded, , arc] =
            three.built.geometries[0].args;

        expect([radiusTop, radiusBottom]).toEqual([SCREEN.radius, SCREEN.radius]);
        expect(openEnded).toBe(true);
        expect(segments).toBeGreaterThan(16); // enough not to look faceted at 60°
        expect(heightSegments).toBe(1);
        expect(arc).toBeCloseTo((SCREEN.arcDegrees * Math.PI) / 180, 6);
        // 16:9 comes out of the arc length, not out of a hardcoded height.
        expect((SCREEN.radius * arc) / height).toBeCloseTo(SCREEN.aspect, 6);
    });

    test('a screen emits rather than being tone-mapped into grey', () => {
        const three = fakeThree();
        const screen = new CinemaScreen({ three, video: fakeVideo() });
        screen.build();
        expect(three.built.materials[0]).toMatchObject({ side: 'BackSide', toneMapped: false });
    });

    test('a local file and a shared tab differ only in which property is set', async () => {
        const consent = new ConsentMachine.Machine({ media: fakeMedia(), config: CONFIG });
        const three = fakeThree();

        const fileActivity = Watch.attach({ three, viewer: fakeViewer(), profile: TogetherProfile });
        const fileVideo = fakeVideo();
        await fileActivity.playFile('movie.mp4', { makeVideo: () => fileVideo });

        const tabActivity = Watch.attach({ three, viewer: fakeViewer(), consent, profile: TogetherProfile });
        const tabVideo = fakeVideo();
        await tabActivity.shareTab({ makeVideo: () => tabVideo });

        expect(fileVideo.src).toBe('movie.mp4');
        expect(fileVideo.srcObject).toBe(null);
        expect(tabVideo.srcObject).toBeTruthy();
        expect(tabVideo.src).toBe('');
        // And both arrived at a placed screen by the same code.
        expect(fileActivity.stats.placement).toBe('vr');
        expect(tabActivity.stats.placement).toBe('vr');
    });

    test('a tab share that is declined leaves nothing placed', async () => {
        const media = fakeMedia();
        media.getDisplayMedia = () => {
            const error = new Error('no');
            error.name = 'NotAllowedError';
            return Promise.reject(error);
        };
        const consent = new ConsentMachine.Machine({ media, config: CONFIG });
        const activity = Watch.attach({ three: fakeThree(), viewer: fakeViewer(), consent, profile: TogetherProfile });

        await expect(activity.shareTab({ makeVideo: fakeVideo })).resolves.toBe(null);
        expect(activity.stats.placement).toBe(null);
    });

    test('stopping a tab share revokes the grant rather than leaving it open', async () => {
        const consent = new ConsentMachine.Machine({ media: fakeMedia(), config: CONFIG });
        const activity = Watch.attach({ three: fakeThree(), viewer: fakeViewer(), consent, profile: TogetherProfile });
        await activity.shareTab({ makeVideo: fakeVideo });
        expect(consent.active).toBe(true);

        activity.stop();
        expect(consent.active).toBe(false);
    });
});

// ── placement ────────────────────────────────────────────────────────────────

describe('placement reuses what the app already runs', () => {
    test('it creates no renderer and no scene of its own', () => {
        const source = fs.readFileSync(
            path.join(ROOT, 'src', 'features', 'together', 'activities', 'watch.js'),
            'utf8'
        );
        const body = source.slice(source.indexOf('const WatchActivity'));
        for (const forbidden of ['WebGLRenderer', 'new THREE.Scene', 'requestHitTestSource', 'requestSession']) {
            expect(`${forbidden}: ${body.includes(forbidden)}`).toBe(`${forbidden}: false`);
        }
    });

    test('VR places into the existing scene, not parented to the camera', () => {
        // A screen that follows your head is nauseating, and is not a cinema.
        const viewer = fakeViewer();
        const screen = new CinemaScreen({ three: fakeThree(), video: fakeVideo() });
        const mesh = screen.placeInVR(viewer);

        expect(viewer.scene.children).toEqual([mesh]);
        expect(mesh.parent).toBe(viewer.scene);
        expect(mesh.position.y).toBe(viewer.camera.position.y);
    });

    test('AR pins at the existing reticle rather than asking for a second hit-test', () => {
        const viewer = fakeViewer({ ar: true, at: [1.5, 0, -3] });
        const screen = new CinemaScreen({ three: fakeThree(), video: fakeVideo() });
        const mesh = screen.pinInAR(viewer);

        expect(mesh.position.x).toBeCloseTo(1.5, 6);
        expect(mesh.position.z).toBeCloseTo(-3, 6);
        // Stood up off the floor by half its height, not lying on it.
        expect(mesh.position.y).toBeGreaterThan(0);
    });

    test('AR with no surface found yet places nothing', () => {
        const viewer = fakeViewer({ ar: true, reticleVisible: false });
        const screen = new CinemaScreen({ three: fakeThree(), video: fakeVideo() });
        expect(screen.pinInAR(viewer)).toBe(null);
        expect(viewer.scene.children).toEqual([]);
    });

    test('the activity picks AR or VR from the live session, not from a setting', async () => {
        const inVR = Watch.attach({ three: fakeThree(), viewer: fakeViewer({ ar: false }), profile: TogetherProfile });
        await inVR.playFile('a.mp4', { makeVideo: fakeVideo });
        expect(inVR.stats.placement).toBe('vr');

        const inAR = Watch.attach({ three: fakeThree(), viewer: fakeViewer({ ar: true }), profile: TogetherProfile });
        await inAR.playFile('a.mp4', { makeVideo: fakeVideo });
        expect(inAR.stats.placement).toBe('ar');
    });

    test('disposing takes the mesh out of the scene and frees the texture', () => {
        const viewer = fakeViewer();
        const three = fakeThree();
        const screen = new CinemaScreen({ three, video: fakeVideo() });
        screen.placeInVR(viewer);
        screen.dispose();

        expect(viewer.scene.children).toEqual([]);
        expect(three.built.textures[0].disposed).toBe(true);
        expect(three.built.geometries[0].disposed).toBe(true);
    });
});

// ── joint attention ──────────────────────────────────────────────────────────

describe('joint attention', () => {
    test('the aim maths is plain arithmetic, and looks the right way', () => {
        // Straight ahead is identity-ish; nothing rotates.
        const ahead = aimQuaternion([0, 1.5, 0], [0, 1.5, -2]);
        expect(ahead[3]).toBeCloseTo(1, 6);

        // A target to the right yaws right; to the left, left. Opposite signs is the bug.
        const right = aimQuaternion([0, 1.5, 0], [2, 1.5, -2]);
        const left = aimQuaternion([0, 1.5, 0], [-2, 1.5, -2]);
        expect(Math.sign(right[1])).toBe(-Math.sign(left[1]));
        expect(right[1]).not.toBeCloseTo(0, 3);
    });

    test('every quaternion it produces is a unit quaternion', () => {
        for (const target of [
            [3, 3, -1],
            [-5, -2, -0.2],
            [0, 0, 4],
            [0.001, 0.001, -0.001],
        ]) {
            const q = aimQuaternion([0, 1.5, 0], target);
            const length = Math.hypot(...q);
            expect(`${target}: ${length.toFixed(6)}`).toBe(`${target}: ${(1).toFixed(6)}`);
        }
    });

    test('the neck is clamped to angles a neck has', () => {
        // Directly behind her. Without a clamp this is a 180° head turn.
        const behind = aimQuaternion([0, 1.5, 0], [0, 1.5, 5]);
        const yaw = 2 * Math.atan2(Math.abs(behind[1]), behind[3]);
        expect(yaw).toBeLessThanOrEqual(Watch.YAW_LIMIT + 1e-6);

        const above = aimQuaternion([0, 1.5, 0], [0, 20, -0.5]);
        const pitch = 2 * Math.atan2(Math.abs(above[0]), above[3]);
        expect(pitch).toBeLessThanOrEqual(Watch.PITCH_LIMIT + 1e-6);
    });

    test('gaze rests on the activity and writes the head layer', () => {
        const mixer = mixerWithHead();
        const attention = new JointAttention({ mixer, profile: TogetherProfile, now: () => 0 });
        attention.update(0);

        expect(attention.target).toBe('activity');
        expect(mixer.getLayer('head').buffer.get('head')).toHaveLength(4);
    });

    test('she glances at you on the profile interval, then looks back', () => {
        let clock = 0;
        const mixer = mixerWithHead();
        const attention = new JointAttention({
            mixer,
            profile: TogetherProfile,
            now: () => clock,
            random: () => 0, // take the minimum of the range, deterministically
        });
        const [minGlance] = TogetherProfile.attention.glanceUserEveryMs;

        clock = minGlance - 1;
        expect(attention.update(clock)).toBe('activity');

        clock = minGlance + 1;
        expect(attention.update(clock)).toBe('user');

        clock += 1000; // the glance is under a second
        expect(attention.update(clock)).toBe('activity');
        expect(attention.glances).toBe(1);
    });

    test('the head actually moves between the two targets', () => {
        const mixer = mixerWithHead();
        const attention = new JointAttention({ mixer, profile: TogetherProfile, now: () => 0 });
        attention.activityPoint = [0, 1.5, -2.4];
        attention.userPoint = [0.9, 1.6, 0.6];

        attention.update(0);
        const atScreen = mixer.getLayer('head').buffer.get('head').slice();
        attention.glanceAtUser(0);
        attention.update(0);
        const atUser = mixer.getLayer('head').buffer.get('head').slice();

        expect(atUser).not.toEqual(atScreen);
    });

    test('companion mode never schedules a glance, because she is already looking at you', () => {
        const attention = new JointAttention({ mixer: mixerWithHead(), profile: CompanionProfile, now: () => 0 });
        expect(CompanionProfile.attention.glanceUserEveryMs).toEqual([0, 0]);
        expect(attention.nextGlanceAt).toBe(Infinity);
        expect(attention.update(1e9)).toBe('activity');
    });

    test('no mixer, no crash — it simply aims nothing', () => {
        const attention = new JointAttention({ mixer: null, profile: TogetherProfile, now: () => 0 });
        expect(() => attention.update(0)).not.toThrow();
    });
});

// ── the negative test ────────────────────────────────────────────────────────

describe('she stays quiet mid-scene', () => {
    function watching({ attention = 0.85 } = {}) {
        let clock = 100000;
        const bus = new EventBus({});
        const blackboard = new Blackboard({});
        blackboard.attention = attention;
        const gate = new CommentaryGate({ bus, blackboard, profile: TogetherProfile, now: () => clock });
        return { bus, blackboard, gate, at: () => clock, tick: (ms) => (clock += ms) };
    }

    /**
     * The batch's acceptance sentence, and the reason Together Mode is worth building. A
     * companion who narrates over the film is not watching it with you.
     */
    test('mid-scene, with attention on the film, nothing gets through', () => {
        const w = watching();
        for (let i = 0; i < 200; i++) {
            w.tick(1000);
            const verdict = w.gate.may();
            expect(`${i}: ${verdict.allowed}`).toBe(`${i}: false`);
        }
        expect(w.gate.stats.allowed).toBe(0);
        expect(w.gate.stats.refused).toBe(200);
    });

    test('an opening opens it, for two seconds', () => {
        const w = watching();
        w.bus.emit('media:paused', {});
        expect(w.gate.may().allowed).toBe(true);

        w.tick(OPENING_WINDOW_MS - 1);
        expect(w.gate.may().allowed).toBe(true);

        w.tick(2);
        expect(w.gate.may()).toEqual({ allowed: false, why: 'mid-scene, no opening' });
    });

    test('every opening the profile lists actually opens it', () => {
        for (const opening of TogetherProfile.commentaryOpenings) {
            const event = opening.split('>')[0];
            const w = watching();
            w.bus.emit(event, {});
            expect(`${event}: ${w.gate.may().allowed}`).toBe(`${event}: true`);
        }
    });

    test('the gate holds no list of its own — it reads the profile', () => {
        // A second copy of the openings is a second copy that will drift from the mode
        // that defines them.
        const custom = { ...TogetherProfile, commentaryOpenings: ['scene:enter'] };
        const bus = new EventBus({});
        const blackboard = new Blackboard({});
        blackboard.attention = 0.9;
        const gate = new CommentaryGate({ bus, blackboard, profile: custom, now: () => 1000 });

        expect(gate.openingEvents).toEqual(['scene:enter']);
        bus.emit('media:paused', {});
        expect(gate.may().allowed).toBe(false);
        bus.emit('scene:enter', {});
        expect(gate.may().allowed).toBe(true);
    });

    test('a scene cut is an opening, so a real cut lets her speak', () => {
        const w = watching();
        expect(w.gate.may().allowed).toBe(false);
        w.bus.emit('media:cut', { lumaJump: 0.4 });
        expect(w.gate.may().allowed).toBe(true);
    });

    test('while the user is speaking, nothing gets through even at an opening', () => {
        const w = watching();
        w.blackboard.setFlag('userSpeaking', true);
        w.bus.emit('media:paused', {});
        expect(w.gate.may()).toEqual({ allowed: false, why: 'the user is speaking' });
    });

    test('when attention is elsewhere she may speak — company, not interruption', () => {
        const w = watching({ attention: 0.2 });
        expect(w.gate.may().allowed).toBe(true);
    });

    test('the refusal says why, so a silence does not read as a bug', () => {
        const w = watching();
        expect(w.gate.may().why).toBe('mid-scene, no opening');
        w.bus.emit('media:cut', {});
        expect(w.gate.may().why).toContain('media:cut');
    });

    test('detaching unsubscribes, so a stopped activity stops opening the gate', () => {
        const w = watching();
        w.gate.detach();
        w.bus.emit('media:paused', {});
        expect(w.gate.may().allowed).toBe(false);
    });
});

// ── the media adapter ────────────────────────────────────────────────────────

describe('media events', () => {
    function adapter({ luma = [], grant, analyser } = {}) {
        let clock = 0;
        const bus = new EventBus({});
        const blackboard = new Blackboard({});
        const seen = [];
        for (const event of ['media:playing', 'media:paused', 'media:cut']) {
            bus.on(event, (payload) => seen.push([event, payload]));
        }
        const media = MediaAdapter.attach({
            bus,
            blackboard,
            grant,
            analyser,
            makeCanvas: () => fakeProbe(luma),
            now: () => clock,
        });
        return { media, bus, blackboard, seen, tick: (ms) => (clock += ms), at: () => clock };
    }

    test('play and pause reach the bus and move attention', () => {
        const a = adapter();
        const video = fakeVideo();
        a.media.watch(video);

        video.play();
        expect(a.seen.map(([e]) => e)).toEqual(['media:playing']);
        expect(a.blackboard.attention).toBeGreaterThan(0.5);

        video.pause();
        expect(a.seen.map(([e]) => e)).toEqual(['media:playing', 'media:paused']);
        expect(a.blackboard.attention).toBeLessThan(0.5);
    });

    test('a buffering stall counts as paused, not as playing', () => {
        // Otherwise she stays politely quiet through a spinner she should remark on.
        const a = adapter();
        const video = fakeVideo();
        a.media.watch(video);
        video.play();
        video.fire('waiting');
        expect(a.media.stats.playing).toBe(false);
    });

    test('a hard cut fires media:cut; a dissolve does not', () => {
        // The fixture: four steady frames, a gentle dissolve, then a hard cut.
        const a = adapter({ luma: [0.5, 0.5, 0.5, 0.55, 0.6, 0.64, 0.12] });
        const video = fakeVideo();
        a.media.watch(video);
        video.play();

        const fired = [];
        for (let i = 0; i < 7; i++) {
            a.tick(MediaAdapter.SAMPLE_MS);
            const result = a.media.tick();
            fired.push(Boolean(result && result.cut));
        }
        expect(fired).toEqual([false, false, false, false, false, false, true]);
        expect(a.media.stats.cuts).toBe(1);
    });

    test('a strobing sequence is throttled to the cooldown, not one cut per sample', () => {
        const a = adapter({ luma: [0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9] });
        const video = fakeVideo();
        a.media.watch(video);
        video.play();

        const cutAt = [];
        for (let i = 0; i < 12; i++) {
            a.tick(MediaAdapter.SAMPLE_MS);
            const result = a.media.tick();
            if (result && result.cut) cutAt.push(a.at());
        }

        // Every frame is a "cut" by luma, but the cooldown is what reaches the bus, and
        // an opening every 250 ms would make her commentary a running narration.
        expect(a.media.stats.samples).toBe(12);
        expect(cutAt.length).toBeLessThanOrEqual(3);
        for (let i = 1; i < cutAt.length; i++) {
            expect(cutAt[i] - cutAt[i - 1]).toBeGreaterThanOrEqual(MediaAdapter.CUT_COOLDOWN_MS);
        }
    });

    test('the first cut of a session is not swallowed by the cooldown', () => {
        // "No cut yet" and "a cut at timestamp zero" are different facts; conflating them
        // eats the cut most likely to be the opening titles ending.
        const a = adapter({ luma: [0.5, 0.1] });
        const video = fakeVideo();
        a.media.watch(video);
        video.play();

        a.tick(MediaAdapter.SAMPLE_MS);
        a.media.tick();
        a.tick(MediaAdapter.SAMPLE_MS);
        expect(a.media.tick().cut).toBe(true);
        expect(a.at()).toBeLessThan(MediaAdapter.CUT_COOLDOWN_MS);
    });

    test('an audio jump is a cut on its own', () => {
        let level = 128;
        const analyser = {
            fftSize: 64,
            getByteTimeDomainData: (out) => out.fill(level),
        };
        const a = adapter({ luma: [0.5, 0.5, 0.5], analyser });
        const video = fakeVideo();
        a.media.watch(video);
        video.play();

        a.tick(MediaAdapter.SAMPLE_MS);
        a.media.tick();
        level = 255; // a bang
        a.tick(MediaAdapter.SAMPLE_MS);
        expect(a.media.tick().cut).toBe(true);
    });

    test('the detector is rate limited, so calling it every frame is nearly free', () => {
        const a = adapter({ luma: [0.5] });
        const video = fakeVideo();
        a.media.watch(video);
        video.play();

        for (let i = 0; i < 90; i++) {
            a.tick(11); // ~90 fps
            a.media.tick();
        }
        // One second of frames at 90 fps is four samples, not ninety.
        expect(a.media.stats.samples).toBeLessThanOrEqual(5);
    });

    test('it produces numbers, never an image', () => {
        const source = fs.readFileSync(path.join(ROOT, 'src', 'behavior', 'adapters', 'MediaAdapter.js'), 'utf8');
        const body = source.slice(source.indexOf('const MediaAdapter'));
        for (const forbidden of ['toDataURL', 'toBlob', 'data:image']) {
            expect(`${forbidden}: ${body.includes(forbidden)}`).toBe(`${forbidden}: false`);
        }
    });

    test('a shared tab is only read while its grant is live', () => {
        // Reading pixels from a capture is a capture code path, and B11's rule applies to
        // it: the grant gates it, and revoking stops it in the same tick.
        const consent = new ConsentMachine.Machine({ media: fakeMedia(), config: CONFIG });
        return consent.request('screen').then((grant) => {
            const a = adapter({ luma: [0.5, 0.1], grant });
            const video = fakeVideo();
            a.media.watch(video, grant);
            video.play();

            a.tick(MediaAdapter.SAMPLE_MS);
            expect(a.media.tick()).toBeTruthy();

            consent.revoke('test');
            a.tick(MediaAdapter.SAMPLE_MS);
            expect(a.media.tick()).toBe(null);
            expect(a.media.stats.readable).toBe(false);
        });
    });

    test('a local file needs no grant, because it is not capture', () => {
        const a = adapter({ luma: [0.5, 0.5] });
        const video = fakeVideo();
        a.media.watch(video, null);
        video.play();
        a.tick(MediaAdapter.SAMPLE_MS);
        expect(a.media.tick()).toBeTruthy();
    });

    test('a cross-origin source turns cut detection off once, not four times a second', () => {
        const a = adapter();
        a.media._makeCanvas = () => ({
            getContext: () => ({
                drawImage() {},
                clearRect() {},
                getImageData() {
                    throw new Error('SecurityError: tainted canvas');
                },
            }),
        });
        const video = fakeVideo();
        a.media.watch(video);
        video.play();

        for (let i = 0; i < 5; i++) {
            a.tick(MediaAdapter.SAMPLE_MS);
            a.media.tick();
        }
        expect(a.media.stats.lumaBlocked).toBe(true);
        expect(console.warn).toHaveBeenCalledTimes(1);
        // The other openings still work — a degraded feature, not a broken activity.
        expect(a.media.stats.playing).toBe(true);
    });

    test('unwatching removes every listener it added', () => {
        const a = adapter();
        const video = fakeVideo();
        a.media.watch(video);
        expect(video.listenerCount).toBeGreaterThan(0);
        a.media.unwatch();
        expect(video.listenerCount).toBe(0);
    });
});

// ── the frame budget ─────────────────────────────────────────────────────────

describe('the per-frame cost', () => {
    /**
     * Node, not a Quest — the number below says nothing about a headset's GPU, and the
     * 1080p claim rests on the zero-copy texture path asserted above, not on this. What
     * this does catch is the regression that would matter either way: joint attention
     * growing an allocation or a trig storm inside the render loop.
     */
    test('a frame of joint attention plus a media tick stays far inside the budget', () => {
        let clock = 0;
        const mixer = mixerWithHead();
        const attention = new JointAttention({ mixer, profile: TogetherProfile, now: () => clock });
        const bus = new EventBus({});
        const media = MediaAdapter.attach({
            bus,
            blackboard: new Blackboard({}),
            makeCanvas: () => fakeProbe([0.5]),
            now: () => clock,
        });
        const video = fakeVideo();
        media.watch(video);
        video.play();

        const frames = 5000;
        const started = process.hrtime.bigint();
        for (let i = 0; i < frames; i++) {
            clock += 11;
            attention.update(clock);
            media.tick();
        }
        const msPerFrame = Number(process.hrtime.bigint() - started) / 1e6 / frames;

        expect(msPerFrame).toBeLessThan(CONFIG.budgets.frameMs);
        expect(attention.glances).toBeGreaterThan(0); // it really did the work
    });
});
