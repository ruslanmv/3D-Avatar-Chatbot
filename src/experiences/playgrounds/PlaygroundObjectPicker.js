/**
 * PlaygroundObjectPicker — point at a thing in the place, and she looks at it (PG3).
 *
 * V5 could already validate "look at the bar", but nothing let a person say it with their hands:
 * the anchors existed only as ids. This is the missing input, and it is deliberately small:
 *
 *  - **No new scene objects.** A venue's anchors are points authored in its scene's own
 *    coordinates (`anchors[].at` in the template, measured from the GLB's nodes). They are
 *    carried to the world through the scene node VRWorlds already built (`localToWorld`), and
 *    projected to the screen with the camera that is already drawing. No pick meshes, no
 *    raycast against merged geometry, nothing added to the render.
 *  - **A tap, never a drag.** OrbitControls owns drags on the canvas. A pointer that moved
 *    under TAP_MOVE_PX and was down under TAP_MS is a tap; anything else is left alone, so
 *    orbiting her never selects. Only the canvas listens — the chat sheet scrolling above it
 *    cannot select anything. Listeners are passive; nothing is prevented.
 *  - **Hover on a mouse only.** A fine pointer near an anchor gets a pointer cursor and a small
 *    label, throttled to animation frames. A touch screen gets the label briefly after a tap.
 *  - **VR reuses the controller ray** the experience runtime is already handed
 *    (`trySelectRay`): an anchor whose point lies within VR_RADIUS_M of the ray is chosen.
 *    Controller mappings are untouched; Seaside's own objects are tried first by its director.
 *  - **A pick is a request, not authority.** It dispatches `nexus-playground-object` with the
 *    anchor id and the world it was picked in; PlaygroundReactiveContext checks both against
 *    the renderer and the template before anything happens.
 *
 * Exposes: window.NEXUS_PLAYGROUND_PICKER
 */
(function (global) {
    'use strict';

    const TAP_MOVE_PX = 8;
    const TAP_MS = 450;
    const PICK_RADIUS_PX = Object.freeze({ fine: 40, coarse: 56 });
    const VR_RADIUS_M = 0.45;
    const LABEL_ID = 'nexus-playground-hover';
    const STYLE_ID = 'nexus-playground-picker-styles';

    const CSS = `
#${LABEL_ID} {
  position: absolute; z-index: 7; pointer-events: none; transform: translate(-50%, -130%);
  padding: .2rem .55rem; border-radius: 999px; white-space: nowrap;
  background: rgba(10, 16, 23, .78); border: 1px solid rgba(255, 255, 255, .16); color: #eef3f7;
  font: 600 .72rem/1.3 system-ui, sans-serif;
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
}
#${LABEL_ID}[hidden] { display: none; }
`;

    /** Was this pointer gesture a tap? Pure. */
    function isTap(down, up) {
        if (!down || !up) return false;
        const dx = up.x - down.x;
        const dy = up.y - down.y;
        return Math.hypot(dx, dy) <= TAP_MOVE_PX && up.t - down.t <= TAP_MS;
    }

    /** The nearest projected anchor within `radius` px of `at`, or null. Pure. */
    function nearest(points, at, radius) {
        let best = null;
        for (const p of points || []) {
            if (!p || !p.visible) continue;
            const d = Math.hypot(p.x - at.x, p.y - at.y);
            if (d <= radius && (!best || d < best.d)) best = { id: p.id, label: p.label, x: p.x, y: p.y, d };
        }
        return best;
    }

    /** Distance from point `p` to the ray (origin `o`, unit direction `dir`); Infinity behind it. Pure. */
    function rayDistance(o, dir, p) {
        const vx = p.x - o.x;
        const vy = p.y - o.y;
        const vz = p.z - o.z;
        const t = vx * dir.x + vy * dir.y + vz * dir.z;
        if (t < 0) return Infinity;
        const cx = o.x + dir.x * t - p.x;
        const cy = o.y + dir.y * t - p.y;
        const cz = o.z + dir.z * t - p.z;
        return Math.sqrt(cx * cx + cy * cy + cz * cz);
    }

    function attach(options) {
        const o = options || {};
        const g = o.global || global;
        const doc = o.doc || (g && g.document);
        if (!g || !doc) return null;
        const engine = () => g.NEXUS_VIEWER || null;
        const templates = () => g.NEXUS_PLAYGROUND_TEMPLATES || null;
        let world = null; // { id, base }
        let canvas = null;
        let down = null;
        let hoverQueued = false;
        let lastMove = null;
        let labelTimer = null;

        function styles() {
            if (doc.getElementById(STYLE_ID)) return;
            const style = doc.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            (doc.head || doc.documentElement).appendChild(style);
        }

        function anchorsFor(base) {
            const T = templates();
            const t = T && T.TEMPLATES ? T.TEMPLATES.find((x) => x.world === base) : null;
            return (t && Array.isArray(t.anchors) ? t.anchors : []).filter((a) => Array.isArray(a.at));
        }

        /** The world's built nodes: the scene (by its name) and the place group around it. */
        function nodes() {
            const e = engine();
            const group = e && e.vrWorlds && e.vrWorlds.group;
            if (!group) return null;
            let scene = null;
            let place = null;
            group.traverse((n) => {
                if (!scene && typeof n.name === 'string' && n.name.indexOf('vr-world-scene:') === 0) scene = n;
                if (!place && n.name === 'vr-world-place') place = n;
            });
            return { scene, place: place || (scene && scene.parent) || null };
        }

        /** World positions of the current world's anchors, as {id,label,x,y,z}. */
        function worldAnchors() {
            const e = engine();
            if (!world || !e || !e.vrWorlds || e.vrWorlds.activeId !== world.id) return [];
            const n = nodes();
            const V = e.camera && e.camera.position && e.camera.position.constructor;
            if (!n || !V) return [];
            const out = [];
            for (const a of anchorsFor(world.base)) {
                const host = a.space === 'place' ? n.place : n.scene;
                if (!host || typeof host.localToWorld !== 'function') continue;
                host.updateMatrixWorld(true);
                const v = host.localToWorld(new V(a.at[0], a.at[1], a.at[2]));
                out.push({ id: a.id, label: a.label, x: v.x, y: v.y, z: v.z, vec: v });
            }
            return out;
        }

        /** Anchors projected into canvas pixels (and window-normalised, for gaze). */
        function screenAnchors() {
            const e = engine();
            if (!e || !e.camera || !canvas) return [];
            const rect = canvas.getBoundingClientRect();
            const w = g.innerWidth || rect.width;
            const h = g.innerHeight || rect.height;
            return worldAnchors().map((a) => {
                const p = a.vec.clone().project(e.camera);
                const x = rect.left + ((p.x + 1) / 2) * rect.width;
                const y = rect.top + ((1 - p.y) / 2) * rect.height;
                return {
                    id: a.id,
                    label: a.label,
                    x,
                    y,
                    visible:
                        p.z < 1 && p.z > -1 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
                    gaze: { x: (x / w) * 2 - 1, y: -((y / h) * 2 - 1) },
                };
            });
        }

        function coarse() {
            try {
                return Boolean(g.matchMedia && g.matchMedia('(pointer: coarse)').matches);
            } catch (_) {
                return false;
            }
        }

        function label(hit, ms) {
            styles();
            let node = doc.getElementById(LABEL_ID);
            const host = doc.querySelector('.avatar-viewport');
            if (!hit) {
                if (node) node.hidden = true;
                return;
            }
            if (!node) {
                node = doc.createElement('div');
                node.id = LABEL_ID;
                node.setAttribute('aria-hidden', 'true');
            }
            if (host && node.parentNode !== host) host.appendChild(node);
            const r = host ? host.getBoundingClientRect() : { left: 0, top: 0 };
            node.textContent = hit.label;
            node.style.left = Math.round(hit.x - r.left) + 'px';
            node.style.top = Math.round(hit.y - r.top) + 'px';
            node.hidden = false;
            if (labelTimer) g.clearTimeout(labelTimer);
            labelTimer = ms ? g.setTimeout(() => label(null), ms) : null;
        }

        function pick(id, how) {
            if (!world || !id) return false;
            try {
                g.dispatchEvent(
                    new g.CustomEvent('nexus-playground-object', {
                        detail: { anchorId: String(id), world: world.id, via: how },
                    })
                );
            } catch (_) {
                return false;
            }
            return true;
        }

        const onDown = (e) => {
            if (!world || e.button > 0 || e.isPrimary === false) return;
            down = { x: e.clientX, y: e.clientY, t: g.performance ? g.performance.now() : Date.now() };
        };
        const onUp = (e) => {
            const start = down;
            down = null;
            if (!world || !start) return;
            const up = { x: e.clientX, y: e.clientY, t: g.performance ? g.performance.now() : Date.now() };
            if (!isTap(start, up)) return;
            const hit = nearest(screenAnchors(), up, coarse() ? PICK_RADIUS_PX.coarse : PICK_RADIUS_PX.fine);
            if (!hit) return;
            label(hit, 1400);
            pick(hit.id, e.pointerType === 'touch' ? 'touch' : 'pointer');
        };
        const onCancel = () => {
            down = null;
        };
        const onMove = (e) => {
            if (!world || coarse() || e.pointerType === 'touch') return;
            lastMove = { x: e.clientX, y: e.clientY };
            if (hoverQueued) return;
            hoverQueued = true;
            const raf = g.requestAnimationFrame || ((fn) => g.setTimeout(fn, 33));
            raf(() => {
                hoverQueued = false;
                if (!lastMove || !canvas || down) return;
                const hit = nearest(screenAnchors(), lastMove, PICK_RADIUS_PX.fine);
                canvas.style.cursor = hit ? 'pointer' : '';
                label(hit, 0);
            });
        };
        const onLeave = () => {
            if (canvas) canvas.style.cursor = '';
            label(null);
        };

        function bind() {
            const e = engine();
            const next = e && e.renderer && e.renderer.domElement;
            if (!next || next === canvas) return;
            unbind();
            canvas = next;
            canvas.addEventListener('pointerdown', onDown, { passive: true });
            canvas.addEventListener('pointerup', onUp, { passive: true });
            canvas.addEventListener('pointercancel', onCancel, { passive: true });
            canvas.addEventListener('pointermove', onMove, { passive: true });
            canvas.addEventListener('pointerleave', onLeave, { passive: true });
        }
        function unbind() {
            if (!canvas) return;
            canvas.removeEventListener('pointerdown', onDown);
            canvas.removeEventListener('pointerup', onUp);
            canvas.removeEventListener('pointercancel', onCancel);
            canvas.removeEventListener('pointermove', onMove);
            canvas.removeEventListener('pointerleave', onLeave);
            canvas.style.cursor = '';
            canvas = null;
        }

        const onShown = (event) => {
            const d = (event && event.detail) || {};
            label(null);
            if (!d.id) {
                world = null;
                return;
            }
            const base = typeof d.base === 'string' ? d.base : d.id;
            world = anchorsFor(base).length ? { id: d.id, base } : null;
            if (world) bind();
        };
        g.addEventListener('nexus-world-shown', onShown);

        return {
            /** VR: the controller's ray, after Seaside's director declined it. */
            trySelectRay(ray) {
                if (!world || !ray || !ray.origin || !ray.direction) return false;
                let best = null;
                for (const a of worldAnchors()) {
                    const d = rayDistance(ray.origin, ray.direction, a);
                    if (d <= VR_RADIUS_M && (!best || d < best.d)) best = { id: a.id, d };
                }
                return best ? pick(best.id, 'xr-ray') : false;
            },
            /** Where an anchor is on screen, window-normalised — the gaze override's space. */
            gazePoint(id) {
                const a = screenAnchors().find((x) => x.id === id && x.visible);
                return a ? a.gaze : null;
            },
            screenAnchors,
            get world() {
                return world;
            },
            detach() {
                g.removeEventListener('nexus-world-shown', onShown);
                unbind();
                label(null);
                if (labelTimer) g.clearTimeout(labelTimer);
                world = null;
            },
        };
    }

    const api = { attach, isTap, nearest, rayDistance, TAP_MOVE_PX, TAP_MS, PICK_RADIUS_PX, VR_RADIUS_M, LABEL_ID };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PLAYGROUND_PICKER = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
