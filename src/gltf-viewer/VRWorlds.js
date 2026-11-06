/**
 * VRWorlds — places she can share with the person in the headset (VW1).
 *
 * Until now VR was a black room with a floor grid. "In VR a black background is fine" was the
 * person's own word for plain VR (XP1), and it still is: a session nobody asked a place for stays
 * exactly as it was. What changes is that a place can now be *chosen* — in Settings ▸ VR WORLD, or
 * by the activity that is running (Experiences ▸ Seaside evening puts the two of you on a terrace
 * over the sea at sunset, Under the trees in a forest clearing, Ten quiet minutes by a lake at
 * night) — and then she stands in it rather than in front of nothing.
 *
 * A world is three layers, the shape the research for this batch recommended for a standalone
 * headset:
 *
 *   panorama   a 360° photograph on an inverted sphere around the room (Poly Haven, CC0). One
 *              draw call, and the reason the place reads as a place at all.
 *   foreground a handful of real models near her — trees, a bench, lanterns, a sofa — from the
 *              CC0 kits in `assets/vr-worlds/kits/` (Kenney, Quaternius, KayKit, 3dassets.dev),
 *              each sized by a target height in metres so kits with different units agree, and
 *              a ground disc that fades into the photograph instead of ending at an edge.
 *   light      the scene's own five lights retinted for the place (golden hour, moonlight,
 *              lamplight). No new real-time lights and no shadows: her VRM materials are already
 *              the expensive part of the frame, and Meta's guidance is to keep dynamic lights few.
 *
 * Why a sphere and not `scene.background = texture`: three r147 cannot rotate a background, and
 * every photograph has its sunset somewhere different. The sphere turns (`yaw`) so the view that
 * makes the place is behind her, where the person is looking.
 *
 * Snapshot and restore, not undo: `show()` records every light value and the exposure it changes,
 * `hide()` writes that record back verbatim and disposes every geometry, material and texture the
 * world made. Loads carry a generation, so a slow model that lands after the person left the place
 * (or chose another) is thrown away instead of appearing in the next one.
 *
 * Pure parts (catalogue checks, which world, which picture size, how big a prop is) take plain
 * values and are tested in jsdom; the runtime takes THREE, the scene and a GLTF loader by
 * injection. ViewerEngine imports this file for its side effect and reads `window.NEXUS_VR_WORLDS`.
 */
(function (global) {
    'use strict';

    const STORAGE_KEY = 'nexus_vr_world';
    const ROOT = 'assets/vr-worlds/';
    const CATALOGUE_URL = ROOT + 'worlds.json';
    /** 'auto': only a running activity brings a place; plain VR stays black (XP1). */
    const DEFAULT_SETTING = 'auto';
    const SPHERE_RADIUS = 60;
    /** A quarter second each way: long enough to read as a blink, short enough not to wait on. */
    const FADE_SECONDS = 0.25;
    const AMBIENT_VOLUME = 0.6;

    /** One step of a linear fade toward `target`. Pure. */
    function fadeStep(current, target, dt, seconds) {
        const step = Math.max(0, Number(dt) || 0) / Math.max(0.001, seconds || FADE_SECONDS);
        if (current < target) return Math.min(target, current + step);
        if (current > target) return Math.max(target, current - step);
        return current;
    }

    /**
     * Personal space, from Meta's comfort guidance and the way people stand to talk. The person
     * is 1 m in front of her (+z); nothing may stand within 1 m of where they are, and nothing
     * may stand in the corridor between the two of them — a lantern between you and the face you
     * are talking to is a wall. Flat things (a rug, a stone circle) may lie anywhere. Pure.
     */
    const USER_AT = [0, 1];
    function comfortProblem(prop) {
        if (!prop || prop.flat) return null;
        const x = prop.at[0];
        const z = prop.at[2];
        const toUser = Math.hypot(x - USER_AT[0], z - USER_AT[1]);
        if (toUser < 1.0) return 'within 1 m of the person';
        if (Math.abs(x) < 0.7 && z > -0.35 && z < USER_AT[1]) return 'between the person and her';
        if (Math.hypot(x, z) < 0.5) return 'inside her';
        return null;
    }

    /** Where the photographer's camera stood, in metres: Poly Haven shoots from about 1.7 m. */
    const DEFAULT_CAMERA_HEIGHT = 1.7;

    /**
     * Ground projection without a shader. A sphere centred `height` above the floor, every vertex
     * below the floor moved up onto it, texture coordinates left where they were: the lower half
     * of the photograph now lies *on the ground* under her and the props instead of hanging on a
     * wall 60 m away. Standing still it looks the same as a plain sphere; move your head and the
     * ground stays put under your feet, which is what makes a place stop looking like a poster.
     * (three's GroundProjectedEnv does this with a shader; r147 as vendored here does not ship it.)
     * Pure: takes and returns a flat array of positions.
     */
    function flattenBelow(positions, height) {
        const out = Float32Array.from(positions);
        for (let i = 1; i < out.length; i += 3) {
            if (out[i] < -height) out[i] = -height;
        }
        return out;
    }

    /** A path inside assets/vr-worlds/, relative, with no way out of it. */
    function isSafePath(path) {
        const p = String(path || '');
        if (!p || p.length > 200) return false;
        if (/^[a-z]+:/i.test(p) || p.startsWith('/') || p.includes('\\')) return false;
        if (p.split('/').some((part) => part === '..' || part === '')) return false;
        return /\.(jpe?g|png|webp|glb|gltf)$/i.test(p);
    }

    /** Ambient loops are the scene journeys' own files; nothing else is played. */
    function isAmbientPath(path) {
        return /^src\/features\/together\/scenes\/assets\/[a-z0-9_-]+\.ogg$/.test(String(path || ''));
    }

    function num(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function colour(value, fallback) {
        return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
    }

    /**
     * Keep the worlds that can be drawn; say why the others were dropped.
     * A world needs an id, a title and a panorama; a prop with an unsafe path or no size is
     * skipped on its own, so one bad line does not cost the person the whole place.
     */
    function validateCatalogue(data) {
        const worlds = [];
        const problems = [];
        const list = data && Array.isArray(data.worlds) ? data.worlds : [];
        const seen = new Set();
        for (const raw of list) {
            const id = raw && /^[a-z0-9-]{1,40}$/.test(String(raw.id || '')) ? raw.id : null;
            if (!id || seen.has(id)) {
                problems.push(`world ${raw && raw.id}: missing or duplicate id`);
                continue;
            }
            const pano = raw.panorama || {};
            const sizes = {};
            for (const key of ['4k', '2k']) if (isSafePath(pano[key])) sizes[key] = pano[key];
            if (!sizes['2k'] && !sizes['4k']) {
                problems.push(`world ${id}: no usable panorama`);
                continue;
            }
            const props = [];
            for (const prop of Array.isArray(raw.props) ? raw.props : []) {
                if (!prop || !isSafePath(prop.src)) {
                    problems.push(`world ${id}: prop ${prop && prop.src} has an unsafe path`);
                    continue;
                }
                const height = num(prop.height, 0);
                const width = num(prop.width, 0);
                if (!(height > 0) && !(width > 0)) {
                    problems.push(`world ${id}: prop ${prop.src} has no height or width`);
                    continue;
                }
                const at = Array.isArray(prop.at) ? prop.at.map((v) => num(v, 0)) : [0, 0, 0];
                const clean = {
                    src: prop.src,
                    height: height > 0 ? height : null,
                    width: width > 0 ? width : null,
                    at: [at[0] || 0, at[1] || 0, at[2] || 0],
                    turn: num(prop.turn, 0),
                    flat: prop.flat === true,
                };
                const crowding = comfortProblem(clean);
                if (crowding) {
                    problems.push(`world ${id}: prop ${prop.src} is ${crowding}`);
                    continue;
                }
                props.push(clean);
            }
            const light = raw.light || {};
            seen.add(id);
            worlds.push({
                id,
                title: String(raw.title || id).slice(0, 60),
                note: String(raw.note || '').slice(0, 120),
                panorama: sizes,
                yaw: num(raw.yaw, 0),
                cameraHeight: Math.min(4, Math.max(0.5, num(raw.cameraHeight, DEFAULT_CAMERA_HEIGHT))),
                // The photograph is the ground (see flattenBelow). A world may still lay a floor
                // of its own — a room's boards — with `ground: { color, radius }`.
                ground: !raw.ground
                    ? null
                    : {
                          color: colour(raw.ground && raw.ground.color, '#3a3a3a'),
                          radius: num(raw.ground && raw.ground.radius, 7),
                      },
                props: props.slice(0, 40),
                activities: Array.isArray(raw.activities) ? raw.activities.filter((a) => typeof a === 'string') : [],
                light: {
                    sky: colour(light.sky, '#ffffff'),
                    ground: colour(light.ground, '#888899'),
                    // A floor under the light that reaches her face: "Starlight — dark
                    // surroundings but a softly lit avatar". A night scene may be dark; she may not.
                    hemi: Math.max(0.4, num(light.hemi, 0.6)),
                    key: colour(light.key, '#ffffff'),
                    keyIntensity: num(light.keyIntensity, 1.2),
                    fill: colour(light.fill, '#ffffff'),
                    fillIntensity: Math.max(0.35, num(light.fillIntensity, 0.85)),
                    rim: colour(light.rim, '#eeeeff'),
                    rimIntensity: num(light.rimIntensity, 0.15),
                    exposure: num(light.exposure, 1),
                },
                source: raw.source || null,
                ambient: isAmbientPath(raw.ambient) ? raw.ambient : null,
            });
        }
        return { worlds, problems };
    }

    /**
     * Which world a VR session should show, or null for plain VR.
     *
     * An AR session never gets one: passthrough is the person's own room (XP1), and a panorama
     * would cover it. Off is off. A running activity that names a place wins over the setting,
     * because "Seaside evening" is a promise about where you will be. Otherwise the setting: a
     * world id shows that world, and Auto (the default) shows nothing — plain VR is unchanged.
     */
    function chooseWorld(ctx) {
        const c = ctx || {};
        if (c.isAR) return null;
        const worlds = Array.isArray(c.worlds) ? c.worlds : [];
        const setting = c.setting || DEFAULT_SETTING;
        if (setting === 'off') return null;
        if (c.activity) {
            const byActivity = worlds.find((w) => w.activities.includes(c.activity));
            if (byActivity) return byActivity.id;
        }
        if (setting !== DEFAULT_SETTING && worlds.some((w) => w.id === setting)) return setting;
        return null;
    }

    /**
     * 4K where the GPU takes it, else 2K. A 4096×2048 photograph is ~11 pixels per degree in the
     * headset (2K is ~5.7, visibly soft); it decodes to 32 MB of texture, which every Quest from
     * the 2 on holds. A GPU whose limit is under 4096 gets the 2K picture rather than a failure.
     */
    function panoramaFor(world, caps) {
        const max = num(caps && caps.maxTextureSize, 4096);
        const pano = (world && world.panorama) || {};
        if (max >= 4096 && pano['4k']) return pano['4k'];
        return pano['2k'] || pano['4k'] || null;
    }

    /** How far to move a model so its footprint centre is at the spot and its base on the ground. Pure. */
    function placementOffset(box, scale) {
        const k = Number(scale) || 1;
        return {
            x: ((box.min.x + box.max.x) / 2) * k,
            y: box.min.y * k,
            z: ((box.min.z + box.max.z) / 2) * k,
        };
    }

    /** The uniform scale that makes a model `height` (or `width`) metres. Pure. */
    function fitScale(size, prop) {
        const s = size || {};
        if (prop && prop.height && s.y > 0) return prop.height / s.y;
        if (prop && prop.width && Math.max(s.x || 0, s.z || 0) > 0) return prop.width / Math.max(s.x, s.z);
        return 1;
    }

    function readSetting(storage) {
        try {
            const store = storage || global.localStorage;
            const value = store && store.getItem(STORAGE_KEY);
            return value || DEFAULT_SETTING;
        } catch (_) {
            return DEFAULT_SETTING;
        }
    }

    function writeSetting(value, storage) {
        try {
            const store = storage || global.localStorage;
            if (store) store.setItem(STORAGE_KEY, String(value || DEFAULT_SETTING));
        } catch (_) {
            /* the choice still applies to this session */
        }
        try {
            if (global.dispatchEvent && typeof global.CustomEvent === 'function') {
                global.dispatchEvent(new global.CustomEvent('nexus-vr-world-change', { detail: { setting: value } }));
            }
        } catch (_) {
            /* nobody is listening */
        }
    }

    let cataloguePromise = null;
    /** The catalogue, fetched once. A missing or broken file is no worlds, never an error. */
    function loadCatalogue(fetcher) {
        if (cataloguePromise && !fetcher) return cataloguePromise;
        const f = fetcher || (typeof global.fetch === 'function' ? global.fetch.bind(global) : null);
        const p = (async () => {
            if (!f) return { worlds: [], problems: ['no fetch'] };
            try {
                const response = await f(CATALOGUE_URL);
                if (!response || !response.ok) return { worlds: [], problems: ['catalogue not found'] };
                const result = validateCatalogue(await response.json());
                if (result.problems.length) console.warn('[VRWorlds] catalogue:', result.problems.join('; '));
                return result;
            } catch (error) {
                console.warn('[VRWorlds] catalogue could not be read', error);
                return { worlds: [], problems: [String(error && error.message)] };
            }
        })();
        if (!fetcher) cataloguePromise = p;
        return p;
    }

    /**
     * The runtime. `deps`: { THREE, scene, loader (GLTFLoader), renderer, lights: { hemi, key,
     * fill, rim } }. Nothing here starts a frame loop or moves the camera.
     */
    function createRuntime(deps) {
        const d = deps || {};
        const THREE = d.THREE;
        let generation = 0;
        let group = null;
        let snapshot = null;
        let activeId = null;
        const modelCache = new Map();
        const owned = [];

        function own(resource) {
            if (resource) owned.push(resource);
            return resource;
        }

        function disposeOwned() {
            while (owned.length) {
                const r = owned.pop();
                try {
                    if (r && typeof r.dispose === 'function') r.dispose();
                } catch (_) {
                    /* already gone */
                }
            }
        }

        function loadTexture(url) {
            return new Promise((resolve, reject) => {
                new THREE.TextureLoader().load(url, resolve, undefined, reject);
            });
        }

        function loadModel(src) {
            if (!modelCache.has(src)) {
                modelCache.set(
                    src,
                    new Promise((resolve, reject) =>
                        d.loader.load(ROOT + src, (gltf) => resolve(gltf.scene), undefined, reject)
                    )
                );
            }
            return modelCache.get(src);
        }

        function sizeOf(object) {
            const box = new THREE.Box3().setFromObject(object);
            const size = new THREE.Vector3();
            box.getSize(size);
            return { box, size };
        }

        /** A disc that fades out, so the ground ends in the photograph, not at an edge. */
        function fadeTexture() {
            const doc = global.document;
            if (!doc) return null;
            const canvas = doc.createElement('canvas');
            canvas.width = canvas.height = 128;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(0.55, 'rgba(255,255,255,0.95)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 128, 128);
            return own(new THREE.CanvasTexture(canvas));
        }

        function takeSnapshot() {
            const L = d.lights || {};
            const read = (light) =>
                light
                    ? {
                          color: light.color ? light.color.getHex() : null,
                          ground: light.groundColor ? light.groundColor.getHex() : null,
                          intensity: light.intensity,
                      }
                    : null;
            snapshot = {
                hemi: read(L.hemi),
                key: read(L.key),
                fill: read(L.fill),
                rim: read(L.rim),
                exposure: d.renderer ? d.renderer.toneMappingExposure : null,
            };
        }

        function writeLight(light, value) {
            if (!light || !value) return;
            if (value.color != null && light.color) light.color.setHex(value.color);
            if (value.ground != null && light.groundColor) light.groundColor.setHex(value.ground);
            if (value.intensity != null) light.intensity = value.intensity;
        }

        function applyLight(world) {
            const L = d.lights || {};
            const hex = (c) => parseInt(String(c).slice(1), 16);
            const w = world.light;
            writeLight(L.hemi, { color: hex(w.sky), ground: hex(w.ground), intensity: w.hemi });
            writeLight(L.key, { color: hex(w.key), intensity: w.keyIntensity });
            writeLight(L.fill, { color: hex(w.fill), intensity: w.fillIntensity });
            writeLight(L.rim, { color: hex(w.rim), intensity: w.rimIntensity });
            if (d.renderer && w.exposure) d.renderer.toneMappingExposure = w.exposure;
        }

        function restoreLight() {
            if (!snapshot) return;
            const L = d.lights || {};
            writeLight(L.hemi, snapshot.hemi);
            writeLight(L.key, snapshot.key);
            writeLight(L.fill, snapshot.fill);
            writeLight(L.rim, snapshot.rim);
            if (d.renderer && snapshot.exposure != null) d.renderer.toneMappingExposure = snapshot.exposure;
        }

        function clear() {
            if (group && d.scene) d.scene.remove(group);
            if (group) {
                group.traverse((node) => {
                    // Only what this world made. Models are clones that share the cached
                    // geometry; their resources are released with the cache in `dispose()`.
                    if (node.userData && node.userData.vrWorldOwned) {
                        if (node.geometry) node.geometry.dispose();
                        if (node.material) node.material.dispose();
                    }
                });
            }
            group = null;
            disposeOwned();
        }

        // ── Comfort: fade through black ─────────────────────────────────────
        // Meta's comfort guidance: never cut the whole visual field from one place to another
        // in front of the person's eyes — fade out, change, fade in. A pop of the entire world
        // is the scene-change equivalent of a camera jump. The fade is a small black sphere
        // that follows the head (`tick`), drawn last over everything for a quarter second.
        let fade = null;
        let fadeOpacity = 0;
        let fadeTarget = 0;
        let fadeWaiters = [];

        function fadeMesh() {
            if (fade || !THREE || !d.scene) return fade;
            fade = new THREE.Mesh(
                new THREE.SphereGeometry(0.5, 16, 8),
                new THREE.MeshBasicMaterial({
                    color: 0x000000,
                    transparent: true,
                    opacity: 0,
                    side: THREE.BackSide,
                    depthTest: false,
                    depthWrite: false,
                    fog: false,
                })
            );
            fade.name = 'vr-world-fade';
            fade.renderOrder = 10000;
            fade.frustumCulled = false;
            fade.visible = false;
            d.scene.add(fade);
            return fade;
        }

        function settleWaiters() {
            const ready = fadeWaiters.filter((w) => Math.abs(fadeOpacity - w.target) < 0.001);
            fadeWaiters = fadeWaiters.filter((w) => !ready.includes(w));
            for (const w of ready) w.resolve(true);
        }

        /** Resolve once the fade reaches `target` — or after a timer, if no frame comes. */
        function fadeTo(target) {
            if (!fadeMesh()) return Promise.resolve(false);
            fadeTarget = target;
            if (Math.abs(fadeOpacity - target) < 0.001) return Promise.resolve(true);
            return new Promise((resolve) => {
                const waiter = { target, resolve };
                fadeWaiters.push(waiter);
                // A hidden session gets no frames (XL7); the change must not wait on one.
                setTimeout(
                    () => {
                        if (fadeWaiters.includes(waiter)) {
                            fadeOpacity = target;
                            applyFade();
                            fadeWaiters = fadeWaiters.filter((w) => w !== waiter);
                            resolve(false);
                        }
                    },
                    FADE_SECONDS * 1000 + 250
                );
            });
        }

        function applyFade() {
            if (!fade) return;
            fade.material.opacity = fadeOpacity;
            fade.visible = fadeOpacity > 0.001;
        }

        /** Per frame, from ViewerEngine's loop: move the fade with the head and step it. */
        function tick(dt, head) {
            if (!fade) return;
            if (head) fade.position.set(head.x, head.y, head.z);
            fadeOpacity = fadeStep(fadeOpacity, fadeTarget, dt, FADE_SECONDS);
            applyFade();
            settleWaiters();
        }

        // ── Ambience ──────────────────────────────────────────────────────────
        let audio = null;
        function playAmbient(world, options) {
            stopAmbient();
            // An activity brings its own sound (a scene journey's loop); two beds is noise.
            if (!world.ambient || (options && options.activity)) return;
            try {
                const Audio = global.Audio;
                if (typeof Audio !== 'function') return;
                audio = new Audio(world.ambient);
                audio.loop = true;
                audio.volume = AMBIENT_VOLUME;
                const played = audio.play();
                if (played && typeof played.catch === 'function') played.catch(() => {});
            } catch (_) {
                audio = null;
            }
        }
        function stopAmbient() {
            if (!audio) return;
            try {
                audio.pause();
                audio.src = '';
            } catch (_) {
                /* gone */
            }
            audio = null;
        }

        async function loadPanorama(world) {
            const url = panoramaFor(world, d.renderer && d.renderer.capabilities);
            try {
                return await loadTexture(ROOT + url);
            } catch (error) {
                // The 4K picture would not load (memory, network): try the small one once.
                if (world.panorama['2k'] && url !== world.panorama['2k']) {
                    try {
                        return await loadTexture(ROOT + world.panorama['2k']);
                    } catch (_) {
                        /* fall through */
                    }
                }
                console.warn('[VRWorlds] the panorama did not load; staying where we are', error);
                return null;
            }
        }

        function buildSky(world, texture, anchor) {
            own(texture);
            if (THREE.sRGBEncoding != null) texture.encoding = THREE.sRGBEncoding;
            // The photograph's ground meets the eye at a grazing angle a metre away; without
            // anisotropic filtering it is a smear exactly where she stands.
            try {
                const caps = d.renderer && d.renderer.capabilities;
                if (caps && typeof caps.getMaxAnisotropy === 'function')
                    texture.anisotropy = Math.min(8, caps.getMaxAnisotropy());
            } catch (_) {
                /* default filtering */
            }
            const sphere = own(new THREE.SphereGeometry(SPHERE_RADIUS, 96, 64));
            const height = world.cameraHeight;
            const pos = sphere.attributes.position;
            pos.array.set(flattenBelow(pos.array, height));
            pos.needsUpdate = true;
            sphere.computeBoundingSphere();
            const sky = new THREE.Mesh(
                sphere,
                own(
                    new THREE.MeshBasicMaterial({
                        map: texture,
                        side: THREE.BackSide,
                        depthWrite: false,
                        toneMapped: false,
                        fog: false,
                    })
                )
            );
            sky.name = 'vr-world-panorama';
            sky.rotation.y = (world.yaw * Math.PI) / 180;
            sky.renderOrder = -10;
            sky.frustumCulled = false;
            sky.userData.vrWorldOwned = true;
            sky.position.set(anchor.x, height, anchor.z);
            return sky;
        }

        function buildPlace(world, models, anchor) {
            const place = new THREE.Group();
            place.position.set(anchor.x, 0, anchor.z);
            if (world.ground) {
                const alpha = fadeTexture();
                const ground = new THREE.Mesh(
                    own(new THREE.CircleGeometry(world.ground.radius, 48)),
                    own(
                        new THREE.MeshLambertMaterial({
                            color: new THREE.Color(world.ground.color),
                            transparent: Boolean(alpha),
                            alphaMap: alpha,
                            depthWrite: !alpha,
                        })
                    )
                );
                ground.rotation.x = -Math.PI / 2;
                ground.position.y = 0.002;
                ground.userData.vrWorldOwned = true;
                ground.name = 'vr-world-ground';
                place.add(ground);
            }
            // Her contact shadow: the one shadow that tells the eye she stands on this ground.
            const shade = fadeTexture();
            if (shade) {
                const blob = new THREE.Mesh(
                    own(new THREE.CircleGeometry(0.42, 32)),
                    own(
                        new THREE.MeshBasicMaterial({
                            color: 0x000000,
                            transparent: true,
                            opacity: 0.38,
                            alphaMap: shade,
                            depthWrite: false,
                        })
                    )
                );
                blob.rotation.x = -Math.PI / 2;
                blob.position.y = 0.006;
                blob.userData.vrWorldOwned = true;
                blob.name = 'vr-world-contact-shadow';
                place.add(blob);
            }
            world.props.forEach((prop, i) => {
                const source = models[i];
                if (!source) return;
                const model = source.clone(true);
                model.traverse((node) => {
                    if (node.isMesh) {
                        node.castShadow = false;
                        node.receiveShadow = false;
                    }
                });
                // Turn first, then measure: the footprint that matters is the turned one.
                model.rotation.y = (prop.turn * Math.PI) / 180;
                model.updateMatrixWorld(true);
                const { size, box } = sizeOf(model);
                const scale = fitScale({ x: size.x, y: size.y, z: size.z }, prop);
                model.scale.setScalar(scale);
                // Kits put a model's origin anywhere — a sofa's at one corner, a floor light's a
                // metre from its mesh. Centre the footprint on `at` and stand it on the ground,
                // so a catalogue line means where the thing is, not where its pivot is.
                const centre = placementOffset(box, scale);
                model.position.set(prop.at[0] - centre.x, prop.at[1] - centre.y, prop.at[2] - centre.z);
                model.name = 'vr-world-prop:' + prop.src;
                place.add(model);
            });
            return place;
        }

        /**
         * Show a world around `anchor` (her position).
         *
         * Everything loads first — the picture and every model — while the person is still where
         * they were; only then does the view fade out, the place change, and the view fade in.
         * No half-built world, no tree popping in a second after the sky (Meta: hide loading,
         * never show assets streaming into the field of view). A slow load that a newer choice
         * overtook is thrown away before anything changes on screen.
         */
        async function show(world, options) {
            if (!THREE || !d.scene || !world) return { ok: false, why: 'no-renderer' };
            const gen = ++generation;
            const anchor = (options && options.anchor) || { x: 0, y: 0, z: 0 };

            const missing = [];
            const [texture, models] = await Promise.all([
                loadPanorama(world),
                Promise.all(
                    world.props.map((prop) =>
                        loadModel(prop.src).catch(() => {
                            missing.push(prop.src);
                            return null;
                        })
                    )
                ),
            ]);
            if (gen !== generation) {
                if (texture) texture.dispose();
                return { ok: false, why: 'stale' };
            }
            if (!texture) return { ok: false, why: 'panorama' };
            if (missing.length) console.warn('[VRWorlds] props not loaded:', missing.join(', '));

            if (!(options && options.instant)) await fadeTo(1);
            if (gen !== generation) {
                texture.dispose();
                return { ok: false, why: 'stale' };
            }
            if (!snapshot) takeSnapshot();
            clear();
            group = new THREE.Group();
            group.name = 'nexus-vr-world-' + world.id;
            group.add(buildSky(world, texture, anchor));
            group.add(buildPlace(world, models, anchor));
            d.scene.add(group);
            applyLight(world);
            activeId = world.id;
            playAmbient(world, options);
            fadeTo(0);
            return { ok: true, id: world.id, missing };
        }

        /** Back to plain VR. `leave()` fades; `hide()` (session ending) is immediate. */
        function hide() {
            generation += 1;
            stopAmbient();
            clear();
            restoreLight();
            snapshot = null;
            const was = activeId;
            activeId = null;
            fadeOpacity = 0;
            fadeTarget = 0;
            applyFade();
            for (const w of fadeWaiters) w.resolve(false);
            fadeWaiters = [];
            return was;
        }

        async function leave() {
            if (!activeId) return null;
            const gen = ++generation;
            await fadeTo(1);
            if (gen !== generation) return null;
            const was = hide();
            fadeOpacity = 1;
            fadeTo(0);
            return was;
        }

        return {
            show,
            hide,
            leave,
            tick,
            get activeId() {
                return activeId;
            },
            get group() {
                return group;
            },
            /** Release cached models too (a new avatar or leaving the page). */
            dispose() {
                hide();
                for (const pending of modelCache.values()) {
                    Promise.resolve(pending)
                        .then((scene) =>
                            scene.traverse((node) => {
                                if (node.geometry) node.geometry.dispose();
                                if (node.material) [].concat(node.material).forEach((m) => m.dispose());
                            })
                        )
                        .catch(() => {});
                }
                modelCache.clear();
            },
        };
    }

    // ── Settings ▸ VR WORLD ────────────────────────────────────────────────────
    const SECTION_ID = 'vr-world-settings';

    function attachSettings(options) {
        const o = options || {};
        const doc = o.doc || global.document;
        if (!doc) return null;
        const modal = doc.getElementById('settings-modal');
        const content = modal && modal.querySelector('.modal-content');
        if (!content) return null;
        let section = doc.getElementById(SECTION_ID);
        if (!section) {
            section = doc.createElement('div');
            section.className = 'config-section';
            section.id = SECTION_ID;
            section.innerHTML =
                '<h3 class="config-title">VR WORLD</h3>' +
                '<div class="input-group">' +
                '<label class="input-label" for="vr-world-select">🌄 WHERE YOU ARE TOGETHER IN VR</label>' +
                '<select id="vr-world-select" class="select-input"></select>' +
                '<p id="vr-world-hint" style="font-size: 0.68rem; color: rgba(255, 255, 255, 0.45); margin: 6px 2px 0">' +
                'Automatic keeps plain VR black and lets Experiences bring their own place — Seaside evening, ' +
                'Under the trees, Ten quiet minutes. Pick a world to always be there. Not used in AR.</p>' +
                '</div>';
            const developer = Array.prototype.slice
                .call(content.querySelectorAll('.config-section'))
                .find((node) => /DEVELOPER/.test((node.querySelector('.config-title') || {}).textContent || ''));
            content.insertBefore(section, developer || null);
        }
        const select = section.querySelector('#vr-world-select');
        function fill(worlds) {
            const current = readSetting(o.storage);
            select.textContent = '';
            const add = (value, label) => {
                const option = doc.createElement('option');
                option.value = value;
                option.textContent = label;
                select.appendChild(option);
            };
            add('auto', 'Automatic — follow the experience');
            add('off', 'Off — always plain VR');
            for (const w of worlds) add(w.id, w.title);
            select.value = [...select.options].some((op) => op.value === current) ? current : DEFAULT_SETTING;
        }
        fill([]);
        select.addEventListener('change', () => writeSetting(select.value, o.storage));
        Promise.resolve(o.catalogue || loadCatalogue()).then((c) => fill((c && c.worlds) || []));
        return { section, select, fill };
    }

    const api = {
        STORAGE_KEY,
        ROOT,
        CATALOGUE_URL,
        DEFAULT_SETTING,
        isSafePath,
        validateCatalogue,
        chooseWorld,
        panoramaFor,
        fitScale,
        flattenBelow,
        fadeStep,
        comfortProblem,
        placementOffset,
        FADE_SECONDS,
        readSetting,
        writeSetting,
        loadCatalogue,
        createRuntime,
        attachSettings,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) {
        global.NEXUS_VR_WORLDS = api;
        // The Settings section draws itself once the page is there, like Wardrobe Forge's.
        const doc = global.document;
        if (doc && typeof module === 'undefined') {
            const mount = () => {
                try {
                    attachSettings();
                } catch (error) {
                    console.warn('[VRWorlds] the Settings section could not be drawn', error);
                }
            };
            if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount, { once: true });
            else mount();
        }
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
