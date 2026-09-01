/**
 * scene-journey — Journeys (spec v1.1 §6.11, batch B14).
 *
 * Three places to be together in: a forest, an ocean, ten quiet minutes. A scene is a
 * manifest, not code, which is what makes a fourth one a JSON file rather than a batch.
 *
 * ## Everything a scene changes, it puts back
 *
 * The acceptance is ten enter/exit cycles leaving the world unchanged, and the way to fail
 * it is to write an `exit` that undoes each thing `enter` did. That drifts the moment
 * somebody adds a field and forgets its undo, and it fails silently — the tenth cycle looks
 * fine and the eleventh behaves oddly on a Tuesday.
 *
 * So nothing is undone. `enter` snapshots every value it is about to overwrite and `exit`
 * writes the snapshot back verbatim, which is `ModeManager`'s approach (§4A) applied one
 * level down. Two consequences worth stating because they are what make ten cycles safe:
 *
 *   * the base profile is **never mutated**. An overlay produces a *derived* profile, a
 *     fresh object each time, so overlays cannot compound across cycles;
 *   * `exit` restores the original profile **by reference**, so after a round trip
 *     `blackboard.mode` is the identical object it was before, not an equal copy. The test
 *     asserts identity, because an equal copy is how this bug hides.
 *
 * ## The art is not in the repository
 *
 * The 8K KTX2 skyboxes and the ambient loops are licensed assets and an art-direction
 * decision. Every manifest carries a `fallbackColor`, and a scene whose skybox will not
 * load enters anyway with that colour — the missing-asset path is a first-class case here
 * and in the tests, not an error branch. See `scenes/README.md`.
 *
 * ## AR keeps the profile and the anchors, and skips the sky
 *
 * Painting a skybox over passthrough would replace the room the user is standing in, which
 * is the opposite of what AR is for. In AR a journey is the overlay, the anchors and the
 * ambience — the parts that are about attention rather than about scenery.
 *
 * Exposes: window.NEXUS_BD_JOURNEY
 */
const SceneJourney = (() => {
    'use strict';

    /**
     * Manifest fields a scene overlay may set. Anything else is ignored, loudly in debug.
     *
     * `allows` joined the list in B27. A scene manifest is JSON and can never carry a
     * function, so journeys are unaffected; what it fixes is the *code* overlays B23 and
     * B27 build, which set `allows` to narrow what may play and had it silently dropped
     * here — the play profile's "no walking clip mid-boss" rule and the coach's "no
     * fidgets while Pose is running" rule were both being merged away.
     */
    const OVERLAY_FIELDS = ['idleProfile', 'commentaryOpenings', 'initiative', 'attention', 'allowNsfw', 'allows'];

    /** Blackboard and renderer state a scene touches, and therefore must restore. */
    const SCENE_STATE = ['background', 'environment'];

    /** A guided line may run this late and still count as on-time. */
    const SCRIPT_TOLERANCE_MS = 1500;

    // ── manifests ────────────────────────────────────────────────────────────

    /**
     * Fail-soft validation, like the animation registry's. A broken scene is skipped with
     * a reason; it does not throw, because one bad manifest must not cost the other two.
     */
    function validate(manifest) {
        const problems = [];
        if (!manifest || typeof manifest !== 'object') return ['not an object'];
        if (typeof manifest.id !== 'string' || !manifest.id) problems.push('id must be a non-empty string');
        if (typeof manifest.title !== 'string') problems.push('title must be a string');
        if (!Array.isArray(manifest.anchors)) problems.push('anchors must be an array');
        else {
            for (const anchor of manifest.anchors) {
                if (!anchor || typeof anchor.name !== 'string') problems.push('an anchor has no name');
                else if (!Array.isArray(anchor.dir) || anchor.dir.length !== 3) {
                    problems.push(`anchor ${anchor.name} needs a 3-component dir`);
                }
            }
        }
        if (manifest.profileOverlay && typeof manifest.profileOverlay !== 'object') {
            problems.push('profileOverlay must be an object');
        }
        if (manifest.guidedScript !== null && manifest.guidedScript !== undefined) {
            if (!Array.isArray(manifest.guidedScript)) problems.push('guidedScript must be an array or null');
            else {
                for (const line of manifest.guidedScript) {
                    if (!line || !Number.isFinite(line.t)) problems.push('a script line has no time');
                }
            }
        }
        return problems;
    }

    // ── the overlay ──────────────────────────────────────────────────────────

    /**
     * Merge a scene's overlay onto a base profile, producing a new object.
     *
     * `initiative` is merged field by field rather than replaced, so a scene that only
     * wants to change the budget does not silently drop `minGapMs`. Everything else
     * replaces, because a scene's `commentaryOpenings` is a complete statement about what
     * may interrupt it — meditation's empty list means "nothing", not "the defaults".
     */
    function derive(base, overlay = {}) {
        const derived = Object.create(Object.getPrototypeOf(base || {}));
        Object.assign(derived, base);

        for (const field of OVERLAY_FIELDS) {
            if (!(field in overlay)) continue;
            if (field === 'initiative') {
                derived.initiative = { ...(base && base.initiative), ...overlay.initiative };
            } else if (field === 'allows') {
                // Only a *function* overlays `allows`. A scene manifest is JSON and can
                // never supply one, so B14's rule — a manifest may not change what may
                // play — is unchanged; what this admits is the code overlays B23 and B27
                // build, whose whole purpose is to narrow it.
                if (typeof overlay.allows === 'function') derived.allows = overlay.allows;
            } else {
                derived[field] = overlay[field];
            }
        }
        derived.sceneOverlayOf = (base && base.id) || null;
        return derived;
    }

    // ── the journey ──────────────────────────────────────────────────────────

    class Journey {
        constructor({
            bus,
            blackboard,
            viewer,
            three,
            gate,
            loadTexture,
            makeAudio,
            now = () => Date.now(),
            debug = false,
        } = {}) {
            this.id = 'journey';
            this.label = 'Journeys';

            this.bus = bus;
            this.blackboard = blackboard;
            this.viewer = viewer || (typeof window !== 'undefined' ? window.NEXUS_VIEWER : null);
            this.three = three || (typeof window !== 'undefined' ? window.THREE : null);
            this.gate = gate || null;
            this.now = now;
            this.debug = debug;

            this._loadTexture = loadTexture || null;
            this._makeAudio = makeAudio || defaultAudio;

            this.scenes = new Map();
            this.active = null;
            this.snapshot = null;
            this.script = null;
            this.spoken = [];
            this.enters = 0;
            this.exits = 0;
            /** Bumped on every enter, so a slow skybox cannot land in the wrong scene. */
            this.epoch = 0;
            this.skyboxLoaded = false;
            this.audio = null;
        }

        get name() {
            return 'SceneJourney';
        }

        /** Register a manifest. Invalid ones are refused with their reasons, not thrown. */
        register(manifest) {
            const problems = validate(manifest);
            if (problems.length) {
                console.warn(`[BD] scene "${manifest && manifest.id}" rejected: ${problems.join('; ')}`);
                return false;
            }
            this.scenes.set(manifest.id, manifest);
            return true;
        }

        get(id) {
            return this.scenes.get(id) || null;
        }

        get inAR() {
            return Boolean(this.viewer && this.viewer.arSupport && this.viewer.arSupport.isARActive);
        }

        // ── enter and exit ───────────────────────────────────────────────────

        /**
         * Enter a scene. Snapshots first, applies second, so a failure part-way still has
         * something to restore. Idempotent in the sense that entering a scene while another
         * is active exits that one first — the stack is one deep, and a journey inside a
         * journey is not a thing.
         */
        enter(id) {
            const manifest = this.scenes.get(id);
            if (!manifest) return null;
            if (this.active) this.exit('replaced');

            this.snapshot = this._takeSnapshot();
            this.active = manifest;
            this.enters++;
            this.epoch++;
            const epoch = this.epoch;

            // Everything that decides how she behaves happens synchronously. The sky is
            // the only slow part, and an 8K texture must not hold up the first line of a
            // guided meditation or leave `scene:enter` unannounced for two seconds.
            this._applyProfile(manifest);
            if (this.blackboard) this.blackboard.scene = manifest.id;
            this._applyAmbience(manifest);
            this._startScript(manifest);
            if (this.bus) this.bus.emit('scene:enter', { id: manifest.id, ar: this.inAR });

            this.skyboxLoaded = false;
            const sky = this.inAR
                ? Promise.resolve(false)
                : Promise.resolve(this._applySkybox(manifest, epoch)).catch(() => false);

            // Returned so a caller that wants the whole thing can await it; `enter` itself
            // has already done everything that matters by the time this is constructed.
            const settled = sky.then((loaded) => {
                if (epoch === this.epoch) this.skyboxLoaded = loaded;
                return manifest;
            });
            settled.manifest = manifest;
            // A thenable that is also the manifest: `await enter(id)` gives the manifest,
            // and `enter(id)` without await has already applied the scene.
            return Object.assign(settled, { id: manifest.id });
        }

        /** Leave. Everything goes back to the snapshot, in the reverse order it was applied. */
        exit(why = 'user') {
            if (!this.active) return false;
            const id = this.active.id;

            this._stopScript();
            this._stopAmbience();
            this._restoreSnapshot(this.snapshot);

            this.active = null;
            this.snapshot = null;
            this.skyboxLoaded = false;
            this.epoch++;
            this.exits++;

            if (this.bus) this.bus.emit('scene:exit', { id, why });
            return true;
        }

        _takeSnapshot() {
            const bb = this.blackboard || {};
            const scene = this.viewer && this.viewer.scene;
            const renderer = this.viewer && this.viewer.renderer;
            const snapshot = {
                // The profile object itself, by reference. Restoring an equal copy would
                // pass a deep-equality test and still be the bug this guards against.
                mode: bb.mode,
                scene: bb.scene,
                sceneState: {},
                exposure: renderer ? renderer.toneMappingExposure : undefined,
                gateProfile: this.gate ? this.gate.profile : undefined,
            };
            if (scene) for (const field of SCENE_STATE) snapshot.sceneState[field] = scene[field];
            return snapshot;
        }

        _restoreSnapshot(snapshot) {
            if (!snapshot) return;
            const bb = this.blackboard;
            const scene = this.viewer && this.viewer.scene;
            const renderer = this.viewer && this.viewer.renderer;

            if (bb) {
                bb.mode = snapshot.mode;
                bb.scene = snapshot.scene;
            }
            if (scene) {
                for (const field of SCENE_STATE) {
                    const previous = snapshot.sceneState[field];
                    // Dispose only what this scene created; the app's own environment map
                    // is not ours to free.
                    const current = scene[field];
                    if (current && current !== previous && current.__nexusScene && current.dispose) {
                        try {
                            current.dispose();
                        } catch (error) {
                            console.warn('[BD] a scene texture refused to dispose', error);
                        }
                    }
                    scene[field] = previous;
                }
            }
            if (renderer && snapshot.exposure !== undefined) renderer.toneMappingExposure = snapshot.exposure;
            if (this.gate && snapshot.gateProfile !== undefined) this.gate.setProfile(snapshot.gateProfile);
        }

        _applyProfile(manifest) {
            const base = this.blackboard && this.blackboard.mode;
            const derived = derive(base, manifest.profileOverlay || {});
            if (this.blackboard) this.blackboard.mode = derived;
            // The gate re-reads the profile, so a scene's openings are the ones in force.
            if (this.gate) this.gate.setProfile(derived);
            return derived;
        }

        /**
         * The sky. Returns whether the art actually loaded — a scene without it is still a
         * scene, painted in the manifest's fallback colour.
         */
        async _applySkybox(manifest, epoch) {
            const scene = this.viewer && this.viewer.scene;
            const THREE = this.three;
            if (!scene || !THREE) return false;

            const renderer = this.viewer.renderer;
            if (renderer && manifest.lighting && Number.isFinite(manifest.lighting.exposure)) {
                renderer.toneMappingExposure = manifest.lighting.exposure;
            }

            if (this._loadTexture && manifest.skybox) {
                try {
                    const texture = await this._loadTexture(manifest.skybox);
                    // The scene may have been left while the texture was in flight. A late
                    // 8K sky landing over the room the user came back to is the bug this
                    // epoch exists to stop — the same trick B11 uses for consent grants.
                    if (epoch !== undefined && epoch !== this.epoch) {
                        if (texture && texture.dispose) texture.dispose();
                        return false;
                    }
                    if (texture) {
                        texture.mapping = THREE.EquirectangularReflectionMapping;
                        texture.__nexusScene = true; // ours to dispose, unlike the app's own
                        scene.background = texture;
                        scene.environment = texture;
                        return true;
                    }
                } catch (error) {
                    console.warn(`[BD] scene "${manifest.id}" has no skybox art — using its colour`, error);
                }
            }

            if (manifest.fallbackColor && THREE.Color) {
                const colour = new THREE.Color(manifest.fallbackColor);
                colour.__nexusScene = true;
                scene.background = colour;
            }
            return false;
        }

        _applyAmbience(manifest) {
            if (!manifest.ambient) return null;
            this.audio = this._makeAudio(manifest.ambient);
            if (this.audio && typeof this.audio.play === 'function') {
                const played = this.audio.play();
                if (played && typeof played.catch === 'function') played.catch(() => {});
            }
            return this.audio;
        }

        _stopAmbience() {
            if (this.audio && typeof this.audio.pause === 'function') {
                try {
                    this.audio.pause();
                    this.audio.src = '';
                } catch (error) {
                    console.warn('[BD] the ambient loop refused to stop', error);
                }
            }
            this.audio = null;
        }

        // ── anchors ──────────────────────────────────────────────────────────

        /**
         * Point attention at a named anchor. The direction comes from the manifest, so a
         * scene decides where "the horizon" is rather than this file guessing.
         */
        anchor(name) {
            if (!this.active) return null;
            const found = (this.active.anchors || []).find((a) => a.name === name);
            if (!found) return null;
            if (this.bus) this.bus.emit('scene:anchor', { name, dir: found.dir, scene: this.active.id });
            return found;
        }

        get anchors() {
            return this.active ? (this.active.anchors || []).map((a) => a.name) : [];
        }

        // ── the guided script ────────────────────────────────────────────────

        _startScript(manifest) {
            const lines = manifest.guidedScript;
            if (!Array.isArray(lines) || !lines.length) {
                this.script = null;
                return null;
            }
            this.script = { startedAt: this.now(), index: 0, lines: [...lines].sort((a, b) => a.t - b.t) };
            this.spoken = [];
            return this.script;
        }

        _stopScript() {
            this.script = null;
        }

        /**
         * Called from the render loop. The guided script is the only thing that speaks
         * during a scene with no initiative budget, and it speaks because the manifest
         * says so at a time the manifest chose — which is what makes it a script rather
         * than initiative.
         */
        update(at = this.now()) {
            if (!this.script) return null;
            const elapsed = at - this.script.startedAt;
            const due = [];
            while (this.script.index < this.script.lines.length) {
                const line = this.script.lines[this.script.index];
                if (line.t > elapsed) break;
                this.script.index++;
                due.push(line);
                this.spoken.push({ at, t: line.t, say: line.say, intent: line.intent });
                if (line.say && this.bus) {
                    // Not an `intent` on the bus: a script line is speech the scene owns,
                    // and routing it through Tier 1 would let the ranker decline it.
                    this._say(line.say);
                }
                if (line.intent && this.bus) {
                    this.bus.emit('intent', { name: line.intent, intensity: 0.4, source: 'scene' });
                }
            }
            return due.length ? due : null;
        }

        _say(text) {
            try {
                const say = typeof window !== 'undefined' ? window.NEXUS_BD_SAY : null;
                if (typeof say === 'function') say(text);
            } catch (error) {
                console.warn('[BD] a scene line could not be spoken', error);
            }
        }

        detach() {
            this.exit('detached');
        }

        get stats() {
            return {
                active: this.active ? this.active.id : null,
                ar: this.inAR,
                skyboxLoaded: this.skyboxLoaded,
                anchors: this.anchors,
                enters: this.enters,
                exits: this.exits,
                scripted: Boolean(this.script),
                spoken: this.spoken.length,
                registered: [...this.scenes.keys()],
            };
        }
    }

    function defaultAudio(url) {
        try {
            const audio = new Audio(url);
            audio.loop = true;
            audio.volume = 0.35;
            return audio;
        } catch (error) {
            console.warn('[BD] no ambient audio on this platform', error);
            return null;
        }
    }

    /** Load the three shipped manifests. Missing or broken ones are skipped, not fatal. */
    async function loadManifests(journey, { base = 'src/features/together/scenes', ids, fetcher } = {}) {
        const names = ids || ['forest', 'ocean', 'meditation'];
        const get = fetcher || ((url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r.status))));
        for (const id of names) {
            try {
                journey.register(await get(`${base}/${id}.json`));
            } catch (error) {
                console.warn(`[BD] scene manifest ${id} did not load`, error);
            }
        }
        return journey;
    }

    function attach(deps) {
        return new Journey(deps);
    }

    return {
        attach,
        Journey,
        derive,
        validate,
        loadManifests,
        OVERLAY_FIELDS,
        SCENE_STATE,
        SCRIPT_TOLERANCE_MS,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_JOURNEY = SceneJourney;
if (typeof module !== 'undefined' && module.exports) module.exports = SceneJourney;
