/**
 * ConsentIndicator — the promise that you can always tell (spec v1.1 §6.13, batch B11).
 *
 * Not optional UI. A capture pipeline whose indicator can be missed is a capture pipeline
 * that lies, so this subscribes to the machine at boot and is never something a consumer
 * has to remember to mount. It renders in two places because the app has two, and a badge
 * in the corner of a page nobody is looking at is no use to someone wearing a headset:
 *
 *   * **2D** — a fixed badge over the page, `aria-live` so a screen reader announces it.
 *   * **XR** — a small plane parented to the XR camera, so it travels with the view and
 *     cannot be left behind by turning around. Immersive sessions render their own
 *     framebuffer and never see the DOM, which is why the 2D badge alone would not do.
 *
 * Both are driven by one `onChange` subscription, so they cannot disagree about whether
 * something is being shared — the failure mode where the badge clears and the headset
 * keeps sharing is not reachable from here.
 *
 * The wording comes from the grant, not from this file: "Sharing your screen" and
 * "Camera on" are different facts and a generic "sharing" badge is not an honest one.
 *
 * Exposes: window.NEXUS_BD_CONSENT_INDICATOR
 */
const ConsentIndicator = (() => {
    'use strict';

    const DOM_ID = 'nexus-bd-consent-indicator';

    /** Big enough to notice, small enough not to fight the app for the corner. */
    const STYLE = [
        'position:fixed',
        'top:12px',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:2147483000',
        'display:flex',
        'align-items:center',
        'gap:8px',
        'padding:6px 14px',
        'border-radius:999px',
        'background:rgba(200,32,48,0.92)',
        'color:#fff',
        'font:600 12px/1.4 system-ui,-apple-system,sans-serif',
        'letter-spacing:0.04em',
        'box-shadow:0 2px 10px rgba(0,0,0,0.35)',
        'pointer-events:none',
    ].join(';');

    class Indicator {
        /**
         * @param {object} deps
         * @param {object} deps.consent   the ConsentMachine
         * @param {object} [deps.viewer]  NEXUS_VIEWER, for the XR half
         * @param {object} [deps.three]   window.THREE
         * @param {object} [deps.doc]     document
         */
        constructor({ consent, viewer, three, doc } = {}) {
            this.consent = consent;
            // `undefined` means "find it yourself"; an explicit `null` means "there isn't
            // one", and the two are different on a platform that has a document but no
            // renderer, or a renderer but no page. `||` would collapse them.
            const fallback = (given, global_) => (given === undefined ? global_ : given);
            this.viewer = fallback(viewer, typeof window !== 'undefined' ? window.NEXUS_VIEWER : null);
            this.three = fallback(three, typeof window !== 'undefined' ? window.THREE : null);
            this.doc = fallback(doc, typeof document !== 'undefined' ? document : null);

            this.badge = null;
            this.mesh = null;
            this.shown = false;
            this.label = '';
            this._unsubscribe = consent ? consent.onChange((state) => this.render(state)) : () => {};
        }

        get name() {
            return 'ConsentIndicator';
        }

        /** One state in, both surfaces updated. Never throws — this must not break a frame. */
        render(state) {
            const showing = state.state === 'active';
            this.shown = showing;
            this.label = state.label || '';
            try {
                this._render2D(showing, this.label);
            } catch (error) {
                console.warn('[BD] the 2D consent badge failed to render', error);
            }
            try {
                this._renderXR(showing);
            } catch (error) {
                console.warn('[BD] the XR consent marker failed to render', error);
            }
            return { showing, label: this.label, in2D: Boolean(this.badge), inXR: Boolean(this.mesh) };
        }

        // ── 2D ───────────────────────────────────────────────────────────────

        _render2D(showing, label) {
            if (!this.doc) return;
            if (!showing) {
                if (this.badge && this.badge.parentNode) this.badge.parentNode.removeChild(this.badge);
                this.badge = null;
                return;
            }
            if (!this.badge) {
                this.badge = this.doc.createElement('div');
                this.badge.id = DOM_ID;
                this.badge.setAttribute('role', 'status');
                this.badge.setAttribute('aria-live', 'polite');
                this.badge.style.cssText = STYLE;
                (this.doc.body || this.doc.documentElement).appendChild(this.badge);
            }
            this.badge.textContent = `● ${label}`;
        }

        // ── XR ───────────────────────────────────────────────────────────────

        /**
         * A plane parented to the camera. The camera is the parent rather than the scene
         * so the marker is in view wherever the user turns; `depthTest: false` keeps it
         * from being swallowed by a cinema screen or a scene skybox drawn in front of it.
         */
        _renderXR(showing) {
            const camera = this.viewer && this.viewer.camera;
            if (!this.three || !camera) return;

            if (!showing) {
                if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
                this._disposeMesh();
                return;
            }
            if (this.mesh) return;

            const THREE = this.three;
            const geometry = new THREE.PlaneGeometry(0.02, 0.02);
            const material = new THREE.MeshBasicMaterial({
                color: 0xc82030,
                transparent: true,
                opacity: 0.95,
                depthTest: false,
            });
            this.mesh = new THREE.Mesh(geometry, material);
            this.mesh.name = DOM_ID;
            this.mesh.renderOrder = 999;
            // Up and slightly left of centre: present in peripheral vision, not sitting on
            // top of whatever the user is actually looking at.
            this.mesh.position.set(-0.06, 0.07, -0.35);
            camera.add(this.mesh);
        }

        _disposeMesh() {
            if (!this.mesh) return;
            try {
                if (this.mesh.geometry) this.mesh.geometry.dispose();
                if (this.mesh.material) this.mesh.material.dispose();
            } catch (error) {
                console.warn('[BD] could not dispose the XR consent marker', error);
            }
            this.mesh = null;
        }

        detach() {
            this._unsubscribe();
            this._render2D(false, '');
            if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
            this._disposeMesh();
            this.shown = false;
        }

        get stats() {
            return { shown: this.shown, label: this.label, in2D: Boolean(this.badge), inXR: Boolean(this.mesh) };
        }
    }

    function attach(deps) {
        return new Indicator(deps);
    }

    return { attach, Indicator, DOM_ID };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_CONSENT_INDICATOR = ConsentIndicator;
if (typeof module !== 'undefined' && module.exports) module.exports = ConsentIndicator;
