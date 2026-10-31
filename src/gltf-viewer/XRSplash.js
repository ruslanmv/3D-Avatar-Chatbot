/**
 * XRSplash — the HomePilot loading card inside the headset (XL3).
 *
 * The person asked for "the thumbnail during loading, when we click ENTER VR", like a professional
 * Meta Quest app. Before this, after the system's own loading dots the headset showed nothing of
 * the app until the scene was ready — and since XL2 the scene is deliberately not drawn while its
 * shaders compile. Now the session starts at once on a small scene of its own: the app's dark
 * colour (#071821, the manifest's background), the HomePilot app icon (assets/app-icon-512.png,
 * the same picture the manifest gives an installed PWA) with the name under it, and a ring that
 * turns while she gets ready. Then she appears.
 *
 * Comfort, the way Meta's guidance puts it: the card is never head-locked. It sits 1.6 m ahead at
 * eye height and follows the gaze lazily — yaw only, smoothed — so turning the head looks at the
 * room rather than dragging the card with it. It shows for at least `MIN_MS`, so a fast load reads
 * as a brand moment instead of a one-frame flash.
 *
 * Lightweight on purpose: one canvas texture, one plane, one ring, one material each, drawn by a
 * scene of their own that is thrown away afterwards. `THREE` is passed in; the placement and timing
 * rules are pure and tested in jsdom (tests/xr-splash.test.js). ViewerEngine imports this file for
 * its side effect and reads window.NEXUS_XR_SPLASH.
 */
(function (global) {
    'use strict';

    const BACKGROUND = 0x071821;
    const DISTANCE = 1.6; // m — comfortable reading distance for a 0.6 m card
    const CARD = 0.6; // m wide, square
    const FOLLOW_RATE = 3; // 1/s — catches up with a turned head in about a second
    const MIN_MS = 900;
    // XL7. If the headset never shows the session (it stays 'hidden'), stop waiting to be seen this
    // long after she is ready. Nothing is drawn while hidden anyway; her loop must be armed for
    // the moment the session does become visible.
    const MAX_UNSEEN_MS = 6000;

    /** Where the card wants to be: `distance` ahead of the head, level, facing back at it. */
    function targetPose(head, forward, distance, fallbackYaw) {
        const fx = forward.x;
        const fz = forward.z;
        const len = Math.hypot(fx, fz);
        // Looking straight up or down there is no horizontal "ahead": keep the last direction.
        const yaw = len < 1e-3 ? fallbackYaw || 0 : Math.atan2(-fx, -fz);
        return {
            x: head.x - Math.sin(yaw) * distance,
            y: head.y,
            z: head.z - Math.cos(yaw) * distance,
            yaw,
        };
    }

    /** Shortest signed angle from `a` to `b`, in (-π, π]. */
    function angleDelta(a, b) {
        let d = (b - a) % (2 * Math.PI);
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d <= -Math.PI) d += 2 * Math.PI;
        return d;
    }

    /** One step of lazy follow: exponential smoothing, frame-rate independent. */
    function follow(current, target, dt, rate) {
        if (!current) return Object.assign({}, target);
        const k = 1 - Math.exp(-(rate || FOLLOW_RATE) * Math.max(0, dt || 0));
        return {
            x: current.x + (target.x - current.x) * k,
            y: current.y + (target.y - current.y) * k,
            z: current.z + (target.z - current.z) * k,
            yaw: current.yaw + angleDelta(current.yaw, target.yaw) * k,
        };
    }

    /** When the card may give way: once ready, and never before it has been seen for `minMs`. */
    function endAt(startedAt, readyAt, minMs) {
        return Math.max(readyAt, startedAt + (minMs == null ? MIN_MS : minMs));
    }

    /**
     * XL7. When the card may give way, counted from what the headset SHOWED, not from when the card
     * was made.
     *
     * Over Air Link the session went 'hidden' 59 ms after it started and became 'visible' only a
     * second later: the Link runtime shows its own loading screen meanwhile and asks the page for
     * no frames. The card's minimum was counted from its creation, so it ran out while hidden and
     * the card was disposed 80 ms before the headset could first have shown it — one frame drawn,
     * none seen. In the Quest's own browser the session is visible from the start, which is why the
     * card always showed there.
     *
     * `visibleSince` is the time of the first card frame drawn while the session was 'visible'.
     * Answers the time to hand over: when she is ready AND the card has been visible `minMs` — or,
     * if it has not been visible at all, `maxUnseenMs` after she was ready, so a session the runtime
     * keeps hidden can never hold the card forever. `null` while she is not ready.
     */
    function handOverAt({ readyAt, visibleSince, minMs, maxUnseenMs } = {}) {
        if (readyAt == null) return null;
        if (visibleSince == null) return readyAt + (maxUnseenMs == null ? MAX_UNSEEN_MS : maxUnseenMs);
        return Math.max(readyAt, visibleSince + (minMs == null ? MIN_MS : minMs));
    }

    /** Paint the card: icon (when it has loaded), name, and a quiet line under it. */
    function paint(ctx, size, image, title, subtitle) {
        ctx.clearRect(0, 0, size, size);
        const r = size * 0.08;
        ctx.fillStyle = 'rgba(12, 34, 51, 0.92)';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, size, size, r);
        else ctx.rect(0, 0, size, size);
        ctx.fill();
        const icon = size * 0.46;
        if (image && image.complete && image.naturalWidth) {
            ctx.drawImage(image, (size - icon) / 2, size * 0.14, icon, icon);
        }
        ctx.textAlign = 'center';
        ctx.fillStyle = '#e2e8f0';
        ctx.font = `800 ${Math.round(size * 0.1)}px system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif`;
        ctx.fillText(title, size / 2, size * 0.75);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.95)';
        ctx.font = `500 ${Math.round(size * 0.045)}px system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif`;
        ctx.fillText(subtitle, size / 2, size * 0.85);
    }

    /**
     * Build the splash. `THREE` is the module ViewerEngine uses; `image` an <img> that may still
     * be loading (the card repaints when it arrives).
     * Returns { scene, update(dt, camera), setStatus(text), refresh(), dispose }.
     * Call update() AFTER rendering a frame: that is when three has written the head pose into the
     * XR camera, so the card is placed for the next frame from a pose that is real.
     */
    function create(THREE, options) {
        const o = options || {};
        const doc = o.doc || (global && global.document);
        const title = o.title || 'HomePilot';
        let subtitle = o.subtitle || 'Getting ready…';
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(o.background == null ? BACKGROUND : o.background);

        const px = 512;
        const canvas = doc.createElement('canvas');
        canvas.width = px;
        canvas.height = px;
        const ctx = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);
        if (THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
        const repaint = () => {
            if (!ctx) return;
            paint(ctx, px, o.image, title, subtitle);
            texture.needsUpdate = true;
        };
        repaint();
        let onLoad = null;
        if (o.image && !(o.image.complete && o.image.naturalWidth) && o.image.addEventListener) {
            onLoad = () => repaint();
            o.image.addEventListener('load', onLoad);
        }

        const group = new THREE.Group();
        const card = new THREE.Mesh(
            new THREE.PlaneGeometry(CARD, CARD),
            new THREE.MeshBasicMaterial({ map: texture, transparent: true })
        );
        group.add(card);
        // A ring under the card, turning: the "it's working" cue.
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.028, 0.036, 48, 1, 0, Math.PI * 1.5),
            new THREE.MeshBasicMaterial({ color: 0x06b6d4, side: THREE.DoubleSide })
        );
        ring.position.set(0, -CARD / 2 - 0.08, 0);
        group.add(ring);
        // Hidden until the first real head pose is known: on the session's first frame the XR
        // camera is still at the origin, and placing the card there would put it on the floor.
        group.visible = false;
        scene.add(group);

        const head = new THREE.Vector3();
        const forward = new THREE.Vector3();
        let pose = null;

        function update(dt, camera) {
            if (camera) {
                camera.getWorldPosition(head);
                camera.getWorldDirection(forward);
                const target = targetPose(head, forward, DISTANCE, pose && pose.yaw);
                pose = follow(pose, target, dt, FOLLOW_RATE);
                group.position.set(pose.x, pose.y, pose.z);
                group.rotation.set(0, pose.yaw, 0);
                group.visible = true;
            }
            ring.rotation.z -= (dt || 0) * 4;
        }

        /**
         * XL4. The line under the name says which step of entry is running, so a card that stops
         * moving in the headset tells the person (and whoever reads their report) where.
         */
        function setStatus(text) {
            if (!text || text === subtitle) return;
            subtitle = String(text);
            repaint();
        }

        /**
         * XL7. Upload the card's picture again — after a WebGL context restore. three rebuilds its
         * GPU state on restore and re-uploads a texture whose version it no longer knows; marking
         * it here makes that explicit, and repaints in case the icon arrived meanwhile.
         */
        function refresh() {
            repaint();
        }

        function dispose() {
            if (onLoad && o.image && o.image.removeEventListener) o.image.removeEventListener('load', onLoad);
            scene.remove(group);
            card.geometry.dispose();
            card.material.dispose();
            ring.geometry.dispose();
            ring.material.dispose();
            texture.dispose();
        }

        return { scene, update, setStatus, refresh, dispose };
    }

    const api = {
        BACKGROUND,
        DISTANCE,
        CARD,
        FOLLOW_RATE,
        MIN_MS,
        MAX_UNSEEN_MS,
        targetPose,
        angleDelta,
        follow,
        endAt,
        handOverAt,
        paint,
        create,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_XR_SPLASH = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
