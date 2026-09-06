/**
 * watch — the cinema screen, and the etiquette of sitting next to someone (batch B12).
 *
 * Together Mode's flagship activity. Three things are load-bearing and each has a test that
 * fails loudly if it stops being true.
 *
 * ## 1. The frame path is zero-copy
 *
 * `THREE.VideoTexture` is bound straight to the `<video>` element and the GPU uploads from
 * it; nothing here draws a frame into a canvas on the render path, and the geometry is
 * built once. That is what makes 1080p at headset framerate a property of the pipeline
 * rather than a hope: the thing that would break it is a per-frame `drawImage` round trip,
 * and a test reads this file to prove there isn't one. (The cut detector *does* read
 * pixels — at 32×18, four times a second, in `MediaAdapter`, off the render path.)
 *
 * Both sources end at the same texture. A local file is `video.src`; a shared tab is
 * `video.srcObject = grant.stream`, where the grant came from B11's consent machine. There
 * is no second rendering path for the captured case, which is the reason a captured tab
 * performs like a local file rather than like a screenshot loop.
 *
 * ## 2. Placement reuses the systems that already exist
 *
 * The app already has a VR renderer, a scene, and an AR hit-test with a reticle in
 * `src/gltf-viewer/ARSupport.js`. This creates no renderer, no scene, and — the one that
 * matters — no second `XRHitTestSource`: the AR pin reads the reticle the existing session
 * is already updating. Two hit-test sources on one frame loop is a frame-rate bug and a
 * pair of disagreeing reticles.
 *
 * ## 3. Her silence is the feature
 *
 * §6.7: commentary only at openings. `CommentaryGate` is the single place that decides,
 * it reads the openings from the active profile rather than keeping its own list, and the
 * negative test — nothing gets through mid-scene while attention is high — is the one this
 * batch is bought on.
 *
 * Exposes: window.NEXUS_BD_WATCH
 */
const WatchActivity = (() => {
    'use strict';

    /** Curved cinema geometry. A 60° arc at 2.4 m reads as a screen, not a wall. */
    const SCREEN = { radius: 2.4, arcDegrees: 60, aspect: 16 / 9, segments: 48 };

    /** How long an opening stays open. §6.7's "within 2 s of an opening". */
    const OPENING_WINDOW_MS = 2000;

    /** Human neck limits, radians. Past these she is not glancing, she is possessed. */
    const YAW_LIMIT = 1.2;
    const PITCH_LIMIT = 0.7;

    // ── the screen ───────────────────────────────────────────────────────────

    class CinemaScreen {
        constructor({ three, scene, video } = {}) {
            this.three = three || (typeof window !== 'undefined' ? window.THREE : null);
            this.scene = scene || null;
            this.video = video || null;
            this.mesh = null;
            this.texture = null;
            this.placement = null;
        }

        /**
         * Build the curved mesh once. An open-ended cylinder section seen from the inside:
         * a flat plane at this size makes the edges feel further away than the middle, and
         * every VR cinema that feels right is curved for that reason.
         */
        build() {
            if (this.mesh || !this.three || !this.video) return this.mesh;
            const THREE = this.three;

            const arc = (SCREEN.arcDegrees * Math.PI) / 180;
            const width = SCREEN.radius * arc;
            const height = width / SCREEN.aspect;

            const geometry = new THREE.CylinderGeometry(
                SCREEN.radius,
                SCREEN.radius,
                height,
                SCREEN.segments,
                1,
                true, // open ended
                -arc / 2 - Math.PI / 2,
                arc
            );

            this.texture = new THREE.VideoTexture(this.video);
            this.texture.minFilter = THREE.LinearFilter;
            this.texture.magFilter = THREE.LinearFilter;
            if (THREE.sRGBEncoding !== undefined) this.texture.encoding = THREE.sRGBEncoding;

            const material = new THREE.MeshBasicMaterial({
                map: this.texture,
                side: THREE.BackSide, // we sit inside the curve
                toneMapped: false, // a screen emits; tone mapping makes it grey
            });

            this.mesh = new THREE.Mesh(geometry, material);
            this.mesh.name = 'NexusCinemaScreen';
            this.mesh.frustumCulled = false;
            return this.mesh;
        }

        /**
         * VR: in front of the existing camera, in the existing scene. Not parented to the
         * camera — a screen that follows your head is nauseating and is not a cinema.
         */
        placeInVR(viewer) {
            const scene = (viewer && viewer.scene) || this.scene;
            const camera = viewer && viewer.camera;
            if (!this.build() || !scene) return null;

            if (camera && camera.position) {
                this.mesh.position.set(camera.position.x, camera.position.y, camera.position.z);
            } else {
                this.mesh.position.set(0, 1.5, 0);
            }
            this.mesh.rotation.set(0, 0, 0);
            scene.add(this.mesh);
            this.placement = 'vr';
            return this.mesh;
        }

        /**
         * AR: pinned where the existing hit-test says a surface is. Reads
         * `arSupport.reticle` — the one the running session already updates — rather than
         * asking for a second hit-test source of its own.
         */
        pinInAR(viewer) {
            const arSupport = viewer && viewer.arSupport;
            const reticle = arSupport && arSupport.reticle;
            const scene = (viewer && viewer.scene) || this.scene;
            if (!reticle || !reticle.visible || !scene) return null;
            if (!this.build()) return null;

            // The reticle is matrixAutoUpdate:false and carries the hit pose in `matrix`.
            const THREE = this.three;
            const position = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
            this.mesh.position.copy(position);
            // Raise it off the floor by half its height so it stands rather than lies.
            this.mesh.position.y += (SCREEN.radius * ((SCREEN.arcDegrees * Math.PI) / 180)) / SCREEN.aspect / 2;
            scene.add(this.mesh);
            this.placement = 'ar';
            return this.mesh;
        }

        /** World position of the screen's centre — what joint attention aims at. */
        get focusPoint() {
            if (!this.mesh) return null;
            const p = this.mesh.position;
            // The visible surface is one radius in front of the cylinder's axis.
            return [p.x, p.y, p.z - SCREEN.radius];
        }

        dispose() {
            if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
            try {
                if (this.mesh) {
                    this.mesh.geometry.dispose();
                    this.mesh.material.dispose();
                }
                if (this.texture) this.texture.dispose();
            } catch (error) {
                console.warn('[BD] the cinema screen refused to dispose', error);
            }
            this.mesh = null;
            this.texture = null;
            this.placement = null;
        }
    }

    // ── joint attention ──────────────────────────────────────────────────────

    /**
     * Where she is looking. Gaze rests on the screen; every so often she glances at you,
     * because someone who watches a film without ever looking at the person next to them is
     * not watching it *with* them.
     *
     * Writes into the mixer's `head` layer, which B6 built as an always-on masked layer for
     * exactly this. Nothing here touches a bone directly — the single-write rule holds.
     */
    class JointAttention {
        constructor({ mixer, profile, now = () => Date.now(), random = Math.random } = {}) {
            this.mixer = mixer || null;
            this.profile = profile || null;
            this.now = now;
            this.random = random;

            this.target = 'activity';
            this.activityPoint = [0, 1.5, -2.4];
            this.userPoint = [0, 1.6, 0.6];
            this.headPoint = [0, 1.5, 0];

            this.glanceUntil = 0;
            this.nextGlanceAt = 0;
            this.glances = 0;
            this._scheduleGlance(this.now());
        }

        /** `glanceUserEveryMs: [min, max]` from the profile; a jittered interval, not a metronome. */
        _scheduleGlance(at) {
            const range = (this.profile && this.profile.attention && this.profile.attention.glanceUserEveryMs) || [
                8000, 20000,
            ];
            const [min, max] = range;
            if (!min && !max) {
                this.nextGlanceAt = Infinity; // companion mode: she is already looking at you
                return;
            }
            this.nextGlanceAt = at + min + this.random() * Math.max(0, max - min);
        }

        /** One glance lasts about a second — long enough to read, short enough not to stare. */
        glanceAtUser(at = this.now(), durationMs = 900) {
            this.target = 'user';
            this.glanceUntil = at + durationMs;
            this.glances++;
            return this.target;
        }

        /** Called every frame. Cheap: two comparisons and, when aiming, one quaternion. */
        update(at = this.now()) {
            if (this.target === 'user' && at >= this.glanceUntil) {
                this.target = 'activity';
                this._scheduleGlance(at);
            } else if (this.target === 'activity' && at >= this.nextGlanceAt) {
                this.glanceAtUser(at);
            }
            this._aim();
            return this.target;
        }

        _aim() {
            const layer = this.mixer && this.mixer.getLayer && this.mixer.getLayer('head');
            if (!layer) return null;
            const point = this.target === 'user' ? this.userPoint : this.activityPoint;
            const q = aimQuaternion(this.headPoint, point);
            layer.buffer.set('head', q);
            return q;
        }
    }

    /**
     * A head rotation that looks from `from` toward `to`, clamped to what a neck does.
     * Pure arithmetic on plain arrays — no three.js, so the maths is testable on its own
     * and the same numbers come out on a headset and in a test runner.
     */
    function aimQuaternion(from, to) {
        const dx = to[0] - from[0];
        const dy = to[1] - from[1];
        const dz = to[2] - from[2];

        // -Z is forward in three.js, so a target straight ahead is yaw 0.
        const yaw = clamp(Math.atan2(dx, -dz), -YAW_LIMIT, YAW_LIMIT);
        const flat = Math.hypot(dx, dz) || 1e-6;
        const pitch = clamp(Math.atan2(dy, flat), -PITCH_LIMIT, PITCH_LIMIT);

        // Yaw about Y then pitch about X, as a quaternion product.
        const cy = Math.cos(yaw / 2);
        const sy = Math.sin(yaw / 2);
        const cp = Math.cos(pitch / 2);
        const sp = Math.sin(pitch / 2);
        return [cy * sp, sy * cp, -sy * sp, cy * cp];
    }

    // ── commentary etiquette ─────────────────────────────────────────────────

    /**
     * The one gate on whether she may say something unprompted during an activity (§6.7).
     *
     * It reads `commentaryOpenings` from the active profile rather than holding its own
     * list, so the rule lives in the mode that defines it. An opening stays open for two
     * seconds; outside that window, with the user's attention on the activity, the answer
     * is no. That "no" is the flagship feature of the mode and is what the negative test
     * in tests/behavior/watch.test.js exists to protect.
     */
    class CommentaryGate {
        constructor({ bus, blackboard, profile, now = () => Date.now() } = {}) {
            this.bus = bus;
            this.blackboard = blackboard;
            this.profile = profile;
            this.now = now;

            /** Null, not 0: an opening at timestamp zero is a real opening, and `0` is
             *  falsy. The same sentinel mistake has now been made three times in this
             *  engine, which is why it is written down here. */
            this.lastOpeningAt = null;
            this.lastOpening = '';
            this.allowed = 0;
            this.refused = 0;
            this._unsubscribes = [];
            if (bus) this._listen();
        }

        /** The event names in `commentaryOpenings`, minus any dwell suffix. */
        get openingEvents() {
            const openings = (this.profile && this.profile.commentaryOpenings) || [];
            return openings.map((entry) => String(entry).split('>')[0]);
        }

        /**
         * Scene anchors (B14). §6.11 lets a manifest spell an opening `anchor:waves`, but
         * the bus vocabulary is closed on purpose — an unknown event name is a typo, not a
         * feature. So anchors travel as one `scene:anchor` event carrying a name, and this
         * matches on the payload rather than on a per-anchor event that would have to be
         * registered somewhere.
         */
        get anchorOpenings() {
            return this.openingEvents
                .filter((event) => event.startsWith('anchor:'))
                .map((event) => event.slice('anchor:'.length));
        }

        /** The profile is re-read on every activation, so a scene overlay takes effect. */
        setProfile(profile) {
            this.detach();
            this.profile = profile;
            if (this.bus) this._listen();
            return this;
        }

        _listen() {
            const anchors = new Set(this.anchorOpenings);
            for (const event of this.openingEvents) {
                if (event.startsWith('anchor:')) continue; // handled below, as one event
                this._unsubscribes.push(this.bus.on(event, () => this._open(event)));
            }
            if (anchors.size) {
                this._unsubscribes.push(
                    this.bus.on('scene:anchor', (payload) => {
                        const name = payload && payload.name;
                        if (anchors.has(name)) this._open(`anchor:${name}`);
                    })
                );
            }
        }

        _open(name) {
            this.lastOpeningAt = this.now();
            this.lastOpening = name;
        }

        /**
         * @returns {{allowed: boolean, why: string}} — `why` names the rule either way, so
         * a log line explains a silence rather than leaving it looking like a bug.
         */
        may(at = this.now()) {
            const attention = this.blackboard ? this.blackboard.attention : 0;
            const speaking = Boolean(this.blackboard && this.blackboard.flags && this.blackboard.flags.userSpeaking);

            if (speaking) {
                this.refused++;
                return { allowed: false, why: 'the user is speaking' };
            }
            // §6.12's budget, and B14's reason for it. A scene overlay that sets
            // `budgetPerSession: 0` — meditation does — silences unprompted speech
            // outright, including at an opening. A guided script is not unprompted and
            // does not come through here.
            const initiative = (this.profile && this.profile.initiative) || {};
            if (initiative.budgetPerSession === 0) {
                this.refused++;
                return { allowed: false, why: 'this scene has no initiative budget' };
            }
            const since = this.lastOpeningAt === null ? Infinity : at - this.lastOpeningAt;
            if (since <= OPENING_WINDOW_MS) {
                this.allowed++;
                return { allowed: true, why: `${this.lastOpening} ${Math.round(since)}ms ago` };
            }
            // Attention below the threshold means the activity is not holding them — a
            // remark then is company, not an interruption.
            if (attention < 0.5) {
                this.allowed++;
                return { allowed: true, why: 'attention is elsewhere' };
            }
            this.refused++;
            return { allowed: false, why: 'mid-scene, no opening' };
        }

        detach() {
            for (const stop of this._unsubscribes.splice(0)) stop();
        }

        get stats() {
            return {
                openings: this.openingEvents,
                anchors: this.anchorOpenings,
                lastOpening: this.lastOpening,
                allowed: this.allowed,
                refused: this.refused,
            };
        }
    }

    // ── the activity ─────────────────────────────────────────────────────────

    class Activity {
        constructor({ bus, blackboard, mixer, consent, capture, config = {}, viewer, three, profile, media } = {}) {
            this.id = 'watch';
            this.label = 'Watch together';

            this.bus = bus;
            this.blackboard = blackboard;
            this.mixer = mixer;
            this.consent = consent;
            this.capture = capture || (typeof window !== 'undefined' ? window.NEXUS_BD_CAPTURE : null);
            this.config = config;
            this.viewer = viewer || (typeof window !== 'undefined' ? window.NEXUS_VIEWER : null);
            this.three = three || (typeof window !== 'undefined' ? window.THREE : null);
            this.profile = profile || (typeof window !== 'undefined' ? window.NEXUS_BD_PROFILE_TOGETHER : null);

            this.media = media || null;
            this.video = null;
            this.grant = null;
            this.screen = new CinemaScreen({ three: this.three });
            this.attention = new JointAttention({ mixer: this.mixer, profile: this.profile });
            this.gate = new CommentaryGate({ bus, blackboard, profile: this.profile });
            this.source = null;
        }

        get name() {
            return 'WatchActivity';
        }

        /** Source (a): a file or an HLS URL. No consent involved — it is the user's file. */
        async playFile(url, { makeVideo } = {}) {
            const video = (makeVideo || defaultVideo)();
            video.src = typeof url === 'string' ? url : URL.createObjectURL(url);
            video.crossOrigin = 'anonymous';
            // D9. A filename is thin, and it is what there is: a local file has no metadata
            // and nothing has watched it. Saying so beats her denying a video is playing.
            try {
                const media = typeof window !== 'undefined' && window.NEXUS_CURRENT_MEDIA;
                if (media && typeof media.set === 'function') {
                    const name = typeof url === 'string' ? url.split('/').pop() : url && url.name;
                    media.set({
                        provider: 'local',
                        kind: 'video',
                        title: name || 'a video file',
                        url: typeof url === 'string' && !/^blob:/.test(url) ? url : '',
                    });
                }
            } catch (_) {
                // Never worth failing playback over.
            }
            return this._start(video, null, 'file');
        }

        /**
         * Source (b): a shared tab — how a YouTube video reaches the screen, since a DRM'd
         * player cannot be textured directly but the tab showing it can be. Goes through
         * B11's machine like everything that touches a screen.
         */
        async shareTab({ makeVideo } = {}) {
            if (!this.consent) return null;
            const grant = await this.consent.request('screen');
            if (!grant) return null;

            const video = (makeVideo || defaultVideo)();
            video.srcObject = grant.stream;
            return this._start(video, grant, 'tab');
        }

        async _start(video, grant, source) {
            this.stop();
            this.video = video;
            this.grant = grant;
            this.source = source;

            video.muted = false;
            video.playsInline = true;
            const played = video.play && video.play();
            if (played && typeof played.catch === 'function') played.catch(() => {});

            this.screen.video = video;
            this.place();

            if (this.media) this.media.watch(video, grant);
            return { source, placement: this.screen.placement };
        }

        /** VR or AR, decided by what the session actually is rather than by a setting. */
        place() {
            const inAR = Boolean(this.viewer && this.viewer.arSupport && this.viewer.arSupport.isARActive);
            const mesh = inAR ? this.screen.pinInAR(this.viewer) : this.screen.placeInVR(this.viewer);
            if (mesh && this.screen.focusPoint) this.attention.activityPoint = this.screen.focusPoint;
            return this.screen.placement;
        }

        /** Called from the render loop. */
        update() {
            this.attention.update();
            if (this.media) this.media.tick();
        }

        /**
         * The one question the rest of the engine asks this activity. Delegates to the
         * gate; there is deliberately no second path to a commentary intent.
         */
        mayComment() {
            return this.gate.may();
        }

        stop() {
            if (this.media) this.media.unwatch();
            this.screen.dispose();
            if (this.grant) this.consent.revoke('watch stopped');
            if (this.video && this.video.pause) this.video.pause();
            this.video = null;
            this.grant = null;
            this.source = null;
        }

        detach() {
            this.stop();
            this.gate.detach();
        }

        get stats() {
            return {
                source: this.source,
                placement: this.screen.placement,
                gaze: this.attention.target,
                glances: this.attention.glances,
                gate: this.gate.stats,
                media: this.media ? this.media.stats : null,
            };
        }
    }

    function defaultVideo() {
        const video = document.createElement('video');
        video.playsInline = true;
        video.autoplay = true;
        return video;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function attach(deps) {
        return new Activity(deps);
    }

    return {
        attach,
        Activity,
        CinemaScreen,
        JointAttention,
        CommentaryGate,
        aimQuaternion,
        SCREEN,
        OPENING_WINDOW_MS,
        YAW_LIMIT,
        PITCH_LIMIT,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_WATCH = WatchActivity;
if (typeof module !== 'undefined' && module.exports) module.exports = WatchActivity;
