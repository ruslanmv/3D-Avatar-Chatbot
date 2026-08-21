'use strict';

/**
 * PoseSheet — turns the mobile Pose Studio panel into a proper bottom sheet.
 *
 * Implements the Material 3 "standard bottom sheet" / iOS "sheet with detents"
 * pattern on top of the existing panel markup:
 *
 *   - Detents: collapsed (~1/3 of the viewport) and expanded (~1/2), plus the
 *     hidden state. Dragging snaps to the nearest one on release.
 *   - Drag surfaces: the grabber pill and the sticky "Pose Studio" title bar.
 *     Buttons inside the title bar are excluded so they stay tappable.
 *   - A hard ceiling below the app topbar. The sheet sits at z-index 120 and
 *     the topbar at 30, so a sheet tall enough to overlap would swallow the
 *     topbar's touches and kill the hamburger menu. The ceiling is enforced in
 *     CSS (max-height) AND here (clamped drag), because CSS alone would let an
 *     in-flight drag write a taller inline height.
 *   - Flick down to dismiss, routed through the existing Close button so the
 *     full teardown (hide + editor.exit + VRPoseSystem cancel) runs exactly as
 *     it does on tap. No duplicated close logic.
 *   - Scroll handoff: dragging the content down while it is already scrolled
 *     to the top collapses the sheet instead of rubber-banding.
 *
 * Desktop/tablet are untouched — the panel stays a side panel there and this
 * module stays dormant.
 *
 * Additive module: no existing behaviour is modified.
 *
 * Exposes: window.NEXUS_POSE_SHEET
 */
(function () {
    /** Matches the CSS breakpoints that turn the panel into a bottom sheet. */
    var SHEET_MQ = '(max-width: 767px), (max-width: 950px) and (max-height: 500px) and (orientation: landscape)';

    /** Detents as a fraction of viewport height, small → large. */
    var DETENTS = [0.34, 0.5];

    /** Gap kept between the top of the sheet and the topbar (px). */
    var TOPBAR_GAP = 8;

    /**
     * Flick speed (px/ms) that moves a whole detent instead of snapping to the
     * nearest one. Deliberate flicks run 2-5 px/ms while a controlled drag sits
     * under ~1; anything lower than this misreads ordinary dragging as a flick.
     */
    var FLICK_VELOCITY = 1.6;

    /** Smoothing for the velocity estimate — a single jittery sample must not decide. */
    var VELOCITY_SMOOTHING = 0.7;

    /** Pointer travel (px) before a press is treated as a drag, not a tap. */
    var DRAG_THRESHOLD = 4;

    var STORAGE_KEY = 'nexus-pose-sheet-detent';

    var PoseSheet = {
        _root: null,
        _card: null,
        _grabber: null,
        _bound: false,

        _dragging: false,
        _armed: false,
        _pointerId: null,
        _startY: 0,
        _startH: 0,
        _lastY: 0,
        _lastT: 0,
        _velocity: 0,
        _fromContent: false,
        _startDetent: 0,

        /**
         * Wire the sheet up. Safe to call repeatedly; the panel markup is
         * rendered lazily, so PoseStudioInit calls this after _render().
         */
        init: function (rootEl) {
            var root =
                rootEl || document.getElementById('poseStudioRoot') || document.querySelector('.pose-studio-root');
            if (!root) return false;

            this._root = root;
            this._card = root.querySelector('.pose-studio-card');
            this._grabber = root.querySelector('.pose-sheet-grabber');
            if (!this._card) return false;

            this._measureTopbar();
            if (!this._bound) this._bindOnce();
            this.applyDetent(this._savedDetentIndex(), false);
            return true;
        },

        // ── Geometry ────────────────────────────────────────────────────────

        /** True when the viewport is in bottom-sheet mode. */
        isSheetMode: function () {
            return typeof window.matchMedia === 'function' && window.matchMedia(SHEET_MQ).matches;
        },

        _viewportH: function () {
            // visualViewport tracks the *dynamic* viewport (URL bar in/out),
            // matching the dvh units the stylesheet uses.
            return (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
        },

        /**
         * Publish the measured topbar height so the CSS ceiling matches the
         * real chrome instead of the 56px min-height fallback.
         */
        _measureTopbar: function () {
            var bar = document.querySelector('.topbar');
            var h = bar ? Math.round(bar.getBoundingClientRect().height) : 0;
            if (h > 0) {
                document.documentElement.style.setProperty('--pose-topbar-h', h + 'px');
            }
            return h || 56;
        },

        /** Tallest the sheet may be without touching the topbar. */
        maxHeightPx: function () {
            var vh = this._viewportH();
            var ceiling = vh - this._measureTopbar() - TOPBAR_GAP;
            var half = vh * DETENTS[DETENTS.length - 1];
            return Math.max(120, Math.min(half, ceiling));
        },

        /** Shortest usable height — the smallest detent, ceiling permitting. */
        minHeightPx: function () {
            return Math.min(this._viewportH() * DETENTS[0], this.maxHeightPx());
        },

        /** Detent heights in px, clamped to the ceiling and de-duplicated. */
        detentHeights: function () {
            var vh = this._viewportH();
            var max = this.maxHeightPx();
            var out = [];
            for (var i = 0; i < DETENTS.length; i++) {
                var h = Math.min(vh * DETENTS[i], max);
                if (!out.length || Math.abs(h - out[out.length - 1]) > 1) out.push(h);
            }
            return out;
        },

        // ── Detents ─────────────────────────────────────────────────────────

        _savedDetentIndex: function () {
            try {
                var v = parseInt(localStorage.getItem(STORAGE_KEY), 10);
                if (v >= 0 && v < DETENTS.length) return v;
            } catch (_e) {
                /* storage unavailable */
            }
            return 0;
        },

        /** Snap to a detent by index. */
        applyDetent: function (index, persist) {
            if (!this._root || !this.isSheetMode()) return;
            var heights = this.detentHeights();
            var i = Math.max(0, Math.min(heights.length - 1, index | 0));
            this._root.style.height = heights[i] + 'px';
            if (persist !== false) {
                try {
                    localStorage.setItem(STORAGE_KEY, String(i));
                } catch (_e) {
                    /* best effort */
                }
            }
        },

        /** Index of the detent closest to a height in px. */
        _nearestDetent: function (h) {
            var heights = this.detentHeights();
            var best = 0;
            var bestD = Infinity;
            for (var i = 0; i < heights.length; i++) {
                var d = Math.abs(heights[i] - h);
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
            return best;
        },

        /** Dismiss through the panel's own Close button (full teardown). */
        _close: function () {
            var btn = document.getElementById('poseStudioCloseBtn');
            if (btn) {
                btn.click();
                return;
            }
            var panel = window.poseStudioPanel;
            if (panel && typeof panel.hide === 'function') panel.hide();
        },

        // ── Drag gesture ────────────────────────────────────────────────────

        _bindOnce: function () {
            var self = this;

            this._onDown = function (e) {
                self._handleDown(e);
            };
            this._onMove = function (e) {
                self._handleMove(e);
            };
            this._onUp = function (e) {
                self._handleUp(e);
            };

            // Delegated on the root so it survives the panel re-rendering.
            this._root.addEventListener('pointerdown', this._onDown);
            window.addEventListener('pointermove', this._onMove, { passive: false });
            window.addEventListener('pointerup', this._onUp);
            window.addEventListener('pointercancel', this._onUp);

            this._onResize = function () {
                if (!self.isSheetMode()) {
                    // Leaving sheet mode: drop the inline height so the desktop
                    // side-panel rules apply cleanly.
                    if (self._root) self._root.style.height = '';
                    return;
                }
                self._measureTopbar();
                self.applyDetent(self._savedDetentIndex(), false);
            };
            window.addEventListener('resize', this._onResize);
            window.addEventListener('orientationchange', this._onResize);
            if (window.visualViewport) window.visualViewport.addEventListener('resize', this._onResize);

            this._bound = true;
        },

        /** Is this event allowed to start a sheet drag? */
        _dragSurface: function (target) {
            if (!target || !target.closest) return null;
            // Never hijack a control.
            if (target.closest('button, a, input, select, textarea, label')) return null;
            if (target.closest('.pose-sheet-grabber')) return 'handle';
            if (target.closest('.pose-studio-header')) return 'handle';
            if (target.closest('.pose-studio-card')) return 'content';
            return null;
        },

        _handleDown: function (e) {
            if (!this.isSheetMode() || this._dragging || this._armed) return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;

            var surface = this._dragSurface(e.target);
            if (!surface) return;

            // From the content area a drag only resizes when the content is
            // already scrolled to the top — otherwise it's an ordinary scroll.
            if (surface === 'content' && this._card.scrollTop > 0) return;

            this._armed = true;
            this._fromContent = surface === 'content';
            this._pointerId = e.pointerId;
            this._startY = this._lastY = e.clientY;
            this._startH = this._root.getBoundingClientRect().height;
            this._lastT = e.timeStamp || Date.now();
            this._velocity = 0;
            // A flick steps one detent from HERE, so record the starting one.
            this._startDetent = this._nearestDetent(this._startH);
        },

        _handleMove: function (e) {
            if (!this._armed || e.pointerId !== this._pointerId) return;

            var dy = e.clientY - this._startY;

            if (!this._dragging) {
                if (Math.abs(dy) < DRAG_THRESHOLD) return;
                // A content drag may only *collapse* (pull down). Pulling up
                // from the top of the content is a scroll, not a resize.
                if (this._fromContent && dy < 0) {
                    this._armed = false;
                    return;
                }
                this._dragging = true;
                this._root.classList.add('pose-sheet-dragging');
                if (this._root.setPointerCapture) {
                    try {
                        this._root.setPointerCapture(this._pointerId);
                    } catch (_e) {
                        /* not capturable */
                    }
                }
            }

            // Dragging up (negative dy) grows the sheet.
            var max = this.maxHeightPx();
            // Allow pulling below the smallest detent so a flick can dismiss,
            // but never past the ceiling.
            var h = Math.max(60, Math.min(max, this._startH - dy));
            this._root.style.height = h + 'px';

            var now = e.timeStamp || Date.now();
            var dt = now - this._lastT;
            if (dt > 0) {
                var v = (e.clientY - this._lastY) / dt;
                // Exponential moving average — one jittery sample (or a
                // coalesced burst with a near-zero dt) can't decide the gesture.
                this._velocity = this._velocity * (1 - VELOCITY_SMOOTHING) + v * VELOCITY_SMOOTHING;
                this._lastY = e.clientY;
                this._lastT = now;
            }

            if (e.cancelable) e.preventDefault();
        },

        _handleUp: function (e) {
            if (!this._armed || (e.pointerId != null && e.pointerId !== this._pointerId)) return;

            var wasDragging = this._dragging;
            this._armed = false;
            this._dragging = false;
            this._fromContent = false;
            this._pointerId = null;
            this._root.classList.remove('pose-sheet-dragging');

            if (!wasDragging) return; // it was a tap — leave it to the control

            var h = this._root.getBoundingClientRect().height;
            var nearest = this._nearestDetent(h);
            var last = this.detentHeights().length - 1;

            // Dragged well below the smallest detent — treat as a dismiss.
            if (h < this.minHeightPx() * 0.55) {
                this._root.style.height = '';
                this._close();
                return;
            }

            // A flick moves exactly ONE detent from where the gesture started,
            // the way Material and iOS sheets behave: expanded -> collapsed ->
            // hidden. Stepping from the *released* height would be wrong — a
            // flick necessarily drags past the next detent before release, so
            // a flick down from expanded would skip collapsed and dismiss.
            if (this._velocity > FLICK_VELOCITY) {
                var down = this._startDetent - 1;
                if (down < 0) {
                    this._root.style.height = '';
                    this._close();
                } else {
                    this.applyDetent(down, true);
                }
                return;
            }
            if (this._velocity < -FLICK_VELOCITY) {
                this.applyDetent(Math.min(last, this._startDetent + 1), true);
                return;
            }

            this.applyDetent(nearest, true);
        },
    };

    window.NEXUS_POSE_SHEET = PoseSheet;
})();
