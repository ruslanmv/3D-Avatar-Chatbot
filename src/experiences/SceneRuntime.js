/**
 * SceneRuntime — one group in the existing scene, and a way back out (IC2).
 *
 * ViewerEngine already owns the renderer and the frame loop. This runtime
 * adds a `THREE.Group` to that scene and removes it on exit. It does not
 * install a second frame loop, it does not construct a second renderer, and
 * it does not move the camera. A test reads this file to keep those three true.
 *
 * Loads carry a generation. A slow asset that resolves after a newer load, or
 * after a cancel, is discarded and its meshes disposed. A missing asset does
 * not reject the scene: the procedural bodies are the fallback, and the result
 * says so.
 *
 * Everything a load changes is snapshotted first. Restore writes the snapshot
 * back. There is no bespoke undo.
 *
 * Exposes: window.NEXUS_EXPERIENCE_SCENE
 */
const SceneRuntime = (() => {
    'use strict';

    function create(options) {
        const options_ = options || {};
        let THREE = options_.THREE || null;
        let parent = options_.parent || null;
        const validate = options_.validate || null;
        let generation = 0;
        let group = null;
        let snapshot = null;
        let activeId = null;
        let usedFallback = false;
        let missing = [];
        let selectable = [];
        let lastError = null;
        let visible = true;
        const disposed = [];

        function geometryFor(body) {
            const seg = body.segments || 8;
            if (body.shape === 'box') {
                const size = body.size || [1, 1, 1];
                return new THREE.BoxGeometry(size[0], size[1], size[2]);
            }
            if (body.shape === 'sphere') return new THREE.SphereGeometry(body.radius || 0.1, seg, seg);
            if (body.shape === 'cylinder')
                return new THREE.CylinderGeometry(body.radius || 0.05, body.radius || 0.05, body.height || 0.2, seg);
            if (body.shape === 'plane')
                return new THREE.PlaneGeometry(body.size ? body.size[0] : 1, body.size ? body.size[1] : 1);
            return new THREE.BoxGeometry(0.1, 0.1, 0.1);
        }

        function disposeObject(object) {
            if (!object) return;
            const children = object.children ? object.children.slice() : [];
            for (const child of children) disposeObject(child);
            if (object.geometry && typeof object.geometry.dispose === 'function') {
                object.geometry.dispose();
                disposed.push(object.geometry);
            }
            if (object.material && typeof object.material.dispose === 'function') {
                object.material.dispose();
                disposed.push(object.material);
            }
        }

        function clearGroup() {
            if (group && parent && typeof parent.remove === 'function') parent.remove(group);
            if (group) disposeObject(group);
            group = null;
            selectable = [];
        }

        function takeSnapshot() {
            snapshot = {
                background: parent ? parent.background : undefined,
                avatar: options_.avatarPosition
                    ? { x: options_.avatarPosition.x, y: options_.avatarPosition.y, z: options_.avatarPosition.z }
                    : null,
            };
        }

        function build(manifest) {
            if (!THREE || !parent) {
                lastError = 'no-renderer';
                return { ok: false, why: 'no-renderer' };
            }
            clearGroup();
            group = new THREE.Group();
            group.name = 'nexus-experience-' + manifest.id;
            for (const body of manifest.bodies || []) {
                const material = new THREE.MeshBasicMaterial({
                    color: body.color,
                    side: body.side === 'back' && THREE.BackSide != null ? THREE.BackSide : THREE.FrontSide || 0,
                });
                const mesh = new THREE.Mesh(geometryFor(body), material);
                const pos = body.position || [0, 0, 0];
                mesh.position.set(pos[0], pos[1], pos[2]);
                mesh.userData.experienceId = body.id;
                mesh.userData.experienceSelectable = body.selectable === true;
                mesh.name = body.id;
                group.add(mesh);
                if (body.selectable) selectable.push(mesh);
            }
            parent.add(group);
            group.visible = visible;
            activeId = manifest.id;
            return { ok: true };
        }

        async function load(manifest, ctx) {
            const gen = ++generation;
            lastError = null;
            usedFallback = false;
            missing = [];
            if (validate) {
                const problems = validate(manifest);
                if (problems && problems.length) {
                    lastError = problems.join('; ');
                    return { ok: false, why: 'invalid', problems: problems };
                }
            }
            if (!snapshot) takeSnapshot();
            const paths = (manifest && manifest.assetPaths) || [];
            const loader = (ctx && ctx.loadAsset) || options_.loadAsset;
            if (loader && paths.length) {
                for (const path of paths) {
                    try {
                        await loader(path);
                    } catch (_) {
                        missing.push(path);
                        usedFallback = true;
                    }
                    if (generation !== gen) {
                        return { ok: false, why: 'stale' };
                    }
                }
            }
            if (!THREE || !parent) {
                activeId = manifest.id;
                usedFallback = true;
                return { ok: true, why: 'logical', fallback: true, id: manifest.id };
            }
            if (manifest.avatarPlacement && manifest.avatarPlacement.move === true && options_.avatarPosition) {
                const place = options_.placeAvatar;
                if (place) place(manifest.avatarPlacement.position);
            }
            const built = build(manifest);
            if (generation !== gen) {
                clearGroup();
                return { ok: false, why: 'stale' };
            }
            if (!built.ok) return built;
            return { ok: true, id: manifest.id, fallback: usedFallback, missing: missing.slice() };
        }

        function restore() {
            clearGroup();
            if (snapshot && parent && snapshot.background !== undefined) parent.background = snapshot.background;
            if (snapshot && snapshot.avatar && options_.avatarPosition && options_.avatarPosition.set) {
                options_.avatarPosition.set(snapshot.avatar.x, snapshot.avatar.y, snapshot.avatar.z);
            } else if (snapshot && snapshot.avatar && options_.avatarPosition) {
                options_.avatarPosition.x = snapshot.avatar.x;
                options_.avatarPosition.y = snapshot.avatar.y;
                options_.avatarPosition.z = snapshot.avatar.z;
            }
            activeId = null;
            visible = true;
            const restored = snapshot;
            snapshot = null;
            return restored;
        }

        function update(dt, flags) {
            if (!group || !visible) return;
            const lit = flags && flags.lanternLit;
            const reduced = flags && flags.reducedMotion;
            if (!group.children) return;
            for (const child of group.children) {
                if (!child || child.name !== 'lantern' || !child.material || !child.material.color) continue;
                if (!lit || reduced) {
                    if (child.material.color.setHex) child.material.color.setHex(lit ? 0xf6d98a : 0x6d6248);
                    continue;
                }
                const pulse = 0.85 + Math.sin(dt ? flags.elapsed || 0 : 0) * 0.15;
                if (child.material.color.setScalar) child.material.color.setScalar(pulse);
            }
        }

        return {
            /**
             * ViewerEngine calls this once it exists. Boot runs before the
             * module THREE is in scope, so the constructors arrive late and
             * a load before that stays on the logical fallback.
             */
            bind: function (host) {
                if (!host) return false;
                if (host.THREE) THREE = host.THREE;
                if (host.parent) parent = host.parent;
                if (host.avatarPosition) options_.avatarPosition = host.avatarPosition;
                return Boolean(THREE && parent);
            },
            load: load,
            restore: restore,
            update: update,
            cancel: function () {
                generation += 1;
            },
            setVisible: function (value) {
                visible = value !== false;
                if (group) group.visible = visible;
            },
            selectables: function () {
                return selectable.slice();
            },
            get activeId() {
                return activeId;
            },
            get usedFallback() {
                return usedFallback;
            },
            get missing() {
                return missing.slice();
            },
            get lastError() {
                return lastError;
            },
            get disposedCount() {
                return disposed.length;
            },
            get generation() {
                return generation;
            },
        };
    }

    return { create: create };
})();

if (typeof window !== 'undefined') window.NEXUS_EXPERIENCE_SCENE = SceneRuntime;
if (typeof module !== 'undefined' && module.exports) module.exports = SceneRuntime;
