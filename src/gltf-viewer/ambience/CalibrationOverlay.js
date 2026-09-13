/**
 * The guide an artist composes against, drawn from the real camera (batch A13).
 *
 * Open the app with `?backgroundCalibration=1` and this draws the horizon, the projected floor,
 * the avatar-safe zone and the exact foot-contact point over the viewport, then prints the same
 * figures as JSON for a generator prompt.
 *
 * It exists because "author the backplate for a 30° camera" is not a constraint anybody can hit.
 * "The horizon is at 44.4% of frame height and the feet touch the floor at (50.0%, 89.7%)" is.
 * The numbers come from `CalibrationGeometry`, which is fed the **live** camera — so the guide
 * cannot drift from what the engine actually renders the way a written-down number would.
 *
 * ## Why SVG rather than a Three.js grid
 *
 * The obvious implementation is a real ground plane added to the scene. This draws an SVG layer
 * instead, for three reasons that matter more than the elegance:
 *
 * It adds nothing to the scene. No geometry, no material, no light, nothing to dispose and
 * nothing that could survive into a clip recording or a headset if the flag were left on.
 * A development tool that can contaminate the render path is a liability.
 *
 * It is legible. Crisp 1px lines and real text labels at any DPR, which is the entire job — a
 * guide that has to be squinted at is not a guide.
 *
 * It is testable. Every coordinate comes from a module Jest can `require()`, so the maths behind
 * the art pipeline is checked rather than eyeballed in a browser.
 *
 * The trade is that the projection is computed rather than borrowed, which is why
 * `crossCheck()` exists: on each draw, when THREE is reachable, one point is projected both ways
 * and a disagreement is reported as a number. Drift shows up in the console rather than as art
 * that quietly stops lining up.
 *
 * Exposes: window.NEXUS_AMBIENCE_CALIBRATION
 */
(function (global) {
    'use strict';

    const ID = 'nexus-calibration-overlay';
    const NS = 'http://www.w3.org/2000/svg';

    function geometry() {
        return (global && global.NEXUS_AMBIENCE_CALIBRATION_GEOMETRY) || null;
    }

    /** Whether the URL asked for it. Never on by default, never persisted. */
    function requested(search) {
        const query = typeof search === 'string' ? search : (global && global.location && global.location.search) || '';
        return /[?&]backgroundCalibration=1\b/.test(query);
    }

    /**
     * Read the camera the engine is actually using, rather than assuming a profile.
     *
     * The whole value of this tool is that it reports the truth. If the app is running at 35°
     * because some code path set it, the guide must say 35° — otherwise it would certify a
     * backplate against a projection nobody is rendering.
     */
    function liveView(viewer) {
        const v = viewer || (global && global.NEXUS_VIEWER) || null;
        const camera = v && v.camera;
        if (!camera) return null;
        const target = (v.controls && v.controls.target) || { x: 0, y: 0, z: 0 };
        return {
            eye: [camera.position.x, camera.position.y, camera.position.z],
            target: [target.x, target.y, target.z],
            fovDeg: camera.fov,
            aspect: camera.aspect,
        };
    }

    /** Which shipped profile the live aspect ratio corresponds to. Geometry, not user-agent. */
    function profileFor(aspect) {
        const g = geometry();
        if (!g) return null;
        return aspect >= 1 ? g.PROFILES.landscape : g.PROFILES.portrait;
    }

    /**
     * The avatar's real extent, so the foot anchor is measured rather than guessed.
     *
     * Falls back to a 1.6 m stand-in when no avatar has loaded — the guide is still useful for
     * the horizon and the floor, and a tool that renders nothing until a VRM arrives is a tool
     * nobody reaches for.
     */
    function avatarBounds(viewer) {
        const v = viewer || (global && global.NEXUS_VIEWER) || null;
        const root = v && v.avatarManager && v.avatarManager.currentRoot;
        const THREE = global && global.THREE;
        if (root && THREE && THREE.Box3) {
            try {
                const box = new THREE.Box3().setFromObject(root);
                if (Number.isFinite(box.min.y) && Number.isFinite(box.max.y)) {
                    return {
                        height: box.max.y - box.min.y,
                        width: box.max.x - box.min.x,
                        footY: box.min.y,
                        measured: true,
                    };
                }
            } catch (_) {
                // A model mid-load. The fallback below is still a useful guide.
            }
        }
        return { height: 1.6, width: 0.55, footY: 0, measured: false };
    }

    /** Percentages to four decimals. Enough for a 4K master, and free of float noise. */
    function pct(value) {
        return `${Math.round(value * 10000) / 10000}%`;
    }

    function line(x1, y1, x2, y2, stroke, dash) {
        const el = global.document.createElementNS(NS, 'line');
        el.setAttribute('x1', pct(x1));
        el.setAttribute('y1', pct(y1));
        el.setAttribute('x2', pct(x2));
        el.setAttribute('y2', pct(y2));
        el.setAttribute('stroke', stroke);
        el.setAttribute('stroke-width', '1');
        if (dash) el.setAttribute('stroke-dasharray', dash);
        return el;
    }

    function label(x, y, text, fill) {
        const el = global.document.createElementNS(NS, 'text');
        el.setAttribute('x', pct(x));
        el.setAttribute('y', pct(y));
        el.setAttribute('fill', fill);
        el.setAttribute('font-family', 'ui-monospace, monospace');
        el.setAttribute('font-size', '11');
        el.textContent = text;
        return el;
    }

    /** Build the SVG for one guide. Separated from the DOM plumbing so a test can read it. */
    function buildSvg(guide, doc) {
        const d = doc || global.document;
        const svg = d.createElementNS(NS, 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.setAttribute('preserveAspectRatio', 'none');

        // Ground lines first, so the horizon and the anchor draw over them.
        for (const g of guide.groundLines) {
            svg.appendChild(line(0, g.y * 100, 100, g.y * 100, 'rgba(0,229,255,0.35)'));
            svg.appendChild(label(1, g.y * 100 - 2, `${g.metres} m`, 'rgba(0,229,255,0.75)'));
        }

        if (guide.horizonY != null) {
            svg.appendChild(line(0, guide.horizonY * 100, 100, guide.horizonY * 100, '#ff4d6d'));
            svg.appendChild(
                label(1, guide.horizonY * 100 - 4, `HORIZON  ${(guide.horizonY * 100).toFixed(1)}%`, '#ff4d6d')
            );
        }

        const z = guide.safeZone;
        const rect = d.createElementNS(NS, 'rect');
        rect.setAttribute('x', pct(z.x0 * 100));
        rect.setAttribute('y', pct(z.y0 * 100));
        rect.setAttribute('width', pct((z.x1 - z.x0) * 100));
        rect.setAttribute('height', pct((z.y1 - z.y0) * 100));
        rect.setAttribute('fill', 'rgba(255,255,255,0.04)');
        rect.setAttribute('stroke', '#ffd166');
        rect.setAttribute('stroke-dasharray', '6 4');
        svg.appendChild(rect);
        svg.appendChild(label(z.x0 * 100 + 1, z.y0 * 100 + 4, 'AVATAR-SAFE ZONE', '#ffd166'));

        // The foot anchor: the one point the floor in the image has to agree with.
        const f = guide.footAnchor;
        const dot = d.createElementNS(NS, 'circle');
        dot.setAttribute('cx', pct(f.x * 100));
        dot.setAttribute('cy', pct(f.y * 100));
        dot.setAttribute('r', '5');
        dot.setAttribute('fill', '#00e5ff');
        svg.appendChild(dot);
        svg.appendChild(line(f.x * 100 - 8, f.y * 100, f.x * 100 + 8, f.y * 100, '#00e5ff'));
        svg.appendChild(
            label(
                f.x * 100 + 2,
                f.y * 100 + 14,
                `FEET  ${(f.x * 100).toFixed(1)}% , ${(f.y * 100).toFixed(1)}%`,
                '#00e5ff'
            )
        );
        return svg;
    }

    /**
     * Ask THREE to project the same point, and report the gap.
     *
     * The guide is a specification computed independently of the renderer; this is what keeps
     * "independently" honest rather than merely claimed.
     */
    function verify(view, viewer) {
        const g = geometry();
        const THREE = global && global.THREE;
        const v = viewer || (global && global.NEXUS_VIEWER) || null;
        if (!g || !THREE || !THREE.Vector3 || !v || !v.camera) return null;
        try {
            const point = [0, view.target[1], 0];
            const ours = g.project(point, view);
            const vec = new THREE.Vector3(point[0], point[1], point[2]).project(v.camera);
            const theirs = { x: (vec.x + 1) / 2, y: (1 - vec.y) / 2 };
            return g.crossCheck(ours, theirs);
        } catch (_) {
            return null;
        }
    }

    let host = null;

    /** Draw, or redraw. Idempotent: the overlay is rebuilt rather than appended to. */
    function render(options) {
        const opts = options || {};
        const g = geometry();
        if (!g || !global.document) return null;

        const view = opts.view || liveView(opts.viewer);
        if (!view) {
            console.warn('[Calibration] no viewer camera yet — nothing to calibrate against');
            return null;
        }

        const bounds = opts.avatar || avatarBounds(opts.viewer);
        const profile = profileFor(view.aspect) || g.PROFILES.landscape;
        // The live camera wins over the profile's nominal values; the profile only supplies the
        // composition rules. Reporting the profile's FOV while the app renders another would
        // certify a backplate against a projection nobody is using.
        const guide = g.guide(Object.assign({}, profile, { fovDeg: view.fovDeg, aspect: view.aspect }), bounds);

        remove();
        host = global.document.createElement('div');
        host.id = ID;
        host.setAttribute('data-profile', profile.id);
        host.style.cssText =
            'position:fixed;inset:0;z-index:9998;pointer-events:none;' +
            'font-family:ui-monospace,monospace;color:#fff';
        host.appendChild(buildSvg(guide, global.document));
        global.document.body.appendChild(host);

        const check = verify(view, opts.viewer);
        if (check && !check.agrees) {
            console.warn(
                `[Calibration] projection disagrees with THREE by dx=${check.dx.toFixed(4)} dy=${check.dy.toFixed(4)} ` +
                    '— the guide and the renderer have drifted apart'
            );
        }

        const report = {
            profile: profile.id,
            fovDeg: view.fovDeg,
            aspect: Number(view.aspect.toFixed(4)),
            avatarMeasured: bounds.measured,
            horizonY: guide.horizonY,
            footAnchor: guide.footAnchor,
            headTopY: guide.headTopY,
            safeZone: guide.safeZone,
            pixels: g.toPixels(
                guide,
                profile.id === 'landscape' ? 1920 : 1080,
                profile.id === 'landscape' ? 1080 : 1920
            ),
            agreesWithRenderer: check ? check.agrees : null,
        };
        console.log('[Calibration] backplate contract:\n' + JSON.stringify(report, null, 2));
        return report;
    }

    function remove() {
        if (!global.document) return;
        const existing = global.document.getElementById(ID);
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        host = null;
    }

    function isActive() {
        return Boolean(global.document && global.document.getElementById(ID));
    }

    /**
     * Turn it on when the URL asks, and keep it correct through resizes.
     *
     * Development-only by construction: without the query parameter this attaches no listener,
     * creates no node and costs one regular-expression test at boot.
     */
    function init(options) {
        const opts = options || {};
        if (!requested(opts.search)) return false;
        const draw = () => render(opts);
        // The avatar and the viewer both arrive asynchronously; redraw once they have.
        draw();
        if (global.setTimeout) global.setTimeout(draw, 2000);
        if (global.addEventListener) global.addEventListener('resize', draw);
        console.log('[Calibration] overlay active — add ?backgroundCalibration=1 to any URL');
        return true;
    }

    const api = { ID, buildSvg, init, isActive, liveView, profileFor, remove, render, requested, verify };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_AMBIENCE_CALIBRATION = api;
        if (global.document) {
            if (global.document.readyState === 'complete' || global.document.readyState === 'interactive') {
                init();
            } else if (global.addEventListener) {
                global.addEventListener('DOMContentLoaded', () => init());
            }
        }
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
