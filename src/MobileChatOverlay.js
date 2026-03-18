'use strict';

/**
 * MobileChatOverlay — Fullscreen avatar + floating chat overlay for mobile.
 *
 * Industry-standard pattern: the 3D avatar fills the viewport and the chat
 * panel floats on top as a resizable overlay with three snap states:
 *   - collapsed  (64-72 px, input bar only)
 *   - default    (50 vh,    balanced view)
 *   - expanded   (85 vh,    reading mode)
 *
 * Interaction:
 *   - Tap the chevron button to cycle through states
 *   - Drag the handle to resize; snaps on release
 *   - Auto-collapses when the virtual keyboard opens
 *
 * Purely additive — does not modify any existing module.
 * Only activates when html.is-mobile is present (phones in portrait).
 */
(function () {
    /* ── Guard: only run on mobile phones ── */
    var html = document.documentElement;
    if (!html.classList.contains('is-mobile')) return;

    /* ── Constants ── */
    var STATE_COLLAPSED = 'collapsed';
    var STATE_DEFAULT = 'default';
    var STATE_EXPANDED = 'expanded';

    var HEIGHT_COLLAPSED = 88; // px — handle + input bar
    var HEIGHT_DEFAULT = window.innerHeight * 0.5; // 50 vh
    var HEIGHT_EXPANDED = window.innerHeight * 0.85; // 85 vh

    var SNAP_THRESHOLD = 60; // px — minimum drag distance before snapping to next state
    var CSS_COLLAPSED = 'chat-overlay--collapsed';
    var CSS_EXPANDED = 'chat-overlay--expanded';
    var CSS_DRAGGING = 'chat-overlay--dragging';

    /* ── State ── */
    var currentState = STATE_COLLAPSED; // Start collapsed so avatar fills the screen
    var dragStartY = 0;
    var dragStartH = 0;
    var isDragging = false;
    var panel; // .chat-panel element
    var handle; // #chat-overlay-handle
    var toggle; // #chat-overlay-toggle

    /* ── Helpers ── */
    function recalcHeights() {
        HEIGHT_DEFAULT = window.innerHeight * 0.5;
        HEIGHT_EXPANDED = window.innerHeight * 0.85;
    }

    function applyState(state) {
        currentState = state;
        panel.classList.remove(CSS_COLLAPSED, CSS_EXPANDED);
        panel.style.height = ''; // clear inline height from drag

        if (state === STATE_COLLAPSED) {
            panel.classList.add(CSS_COLLAPSED);
        } else if (state === STATE_EXPANDED) {
            panel.classList.add(CSS_EXPANDED);
        }
        // STATE_DEFAULT uses the CSS default (50vh) — no class needed
    }

    /* ── Tap toggle: collapsed → default → expanded → default → … ── */
    function cycleState() {
        switch (currentState) {
            case STATE_DEFAULT:
                applyState(STATE_EXPANDED);
                break;
            case STATE_EXPANDED:
                applyState(STATE_COLLAPSED);
                break;
            case STATE_COLLAPSED:
                applyState(STATE_DEFAULT);
                break;
            default:
                applyState(STATE_DEFAULT);
        }
    }

    /* ── Touch drag handlers ── */
    // Material Design bottom-sheet pattern:
    //   - Lock current height on touch start (no visual jump)
    //   - Swipe direction + velocity determines snap target
    //   - Tap on handle cycles state (only if no drag occurred)
    var hasDragged = false;
    var dragStartTime = 0;

    var DRAG_THRESHOLD = 10; // px — minimum movement to count as a drag
    var VELOCITY_THRESHOLD = 0.4; // px/ms — fast swipe overrides nearest-snap

    function onTouchStart(e) {
        if (!e.touches || e.touches.length !== 1) return;
        isDragging = true;
        hasDragged = false;
        dragStartY = e.touches[0].clientY;
        dragStartTime = Date.now();

        // Capture the current rendered height BEFORE removing any CSS classes.
        // This prevents the panel from jumping to 50vh when collapsed (88px).
        dragStartH = panel.getBoundingClientRect().height;
        panel.style.height = dragStartH + 'px'; // lock it with inline style
        panel.classList.add(CSS_DRAGGING);
        panel.classList.remove(CSS_COLLAPSED, CSS_EXPANDED);
    }

    function onTouchMove(e) {
        if (!isDragging) return;
        var deltaY = dragStartY - e.touches[0].clientY;
        if (Math.abs(deltaY) > DRAG_THRESHOLD) hasDragged = true;
        e.preventDefault(); // prevent page scroll while dragging
        var newH = Math.max(HEIGHT_COLLAPSED, Math.min(dragStartH + deltaY, HEIGHT_EXPANDED));
        panel.style.height = newH + 'px';
    }

    function onTouchEnd(e) {
        if (!isDragging) return;
        isDragging = false;
        panel.classList.remove(CSS_DRAGGING);

        if (!hasDragged) {
            // Simple tap on handle — cycle state
            cycleState();
            panel.style.height = '';
            return;
        }

        // Compute swipe velocity and direction (positive = swiped up = expand)
        var endY = e.changedTouches ? e.changedTouches[0].clientY : dragStartY;
        var totalDelta = dragStartY - endY; // positive = up, negative = down
        var elapsed = Math.max(1, Date.now() - dragStartTime);
        var velocity = totalDelta / elapsed; // px/ms

        var h = panel.getBoundingClientRect().height;

        // Fast swipe: honour direction regardless of current position
        if (Math.abs(velocity) > VELOCITY_THRESHOLD) {
            if (velocity > 0) {
                // Swiped up — go to next higher state
                if (currentState === STATE_COLLAPSED) {
                    applyState(STATE_DEFAULT);
                } else {
                    applyState(STATE_EXPANDED);
                }
            } else {
                // Swiped down — go to next lower state
                if (currentState === STATE_EXPANDED) {
                    applyState(STATE_DEFAULT);
                } else {
                    applyState(STATE_COLLAPSED);
                }
            }
            return;
        }

        // Slow drag: snap to nearest state
        var distCollapsed = Math.abs(h - HEIGHT_COLLAPSED);
        var distDefault = Math.abs(h - HEIGHT_DEFAULT);
        var distExpanded = Math.abs(h - HEIGHT_EXPANDED);

        if (distCollapsed <= distDefault && distCollapsed <= distExpanded) {
            applyState(STATE_COLLAPSED);
        } else if (distExpanded <= distDefault) {
            applyState(STATE_EXPANDED);
        } else {
            applyState(STATE_DEFAULT);
        }
    }

    /* ── Keyboard awareness via visualViewport ── */
    var stateBeforeKeyboard = null;

    function onViewportResize() {
        if (!window.visualViewport) return;
        var ratio = window.visualViewport.height / window.innerHeight;

        // Keyboard likely open when viewport shrinks below 70% of full height
        if (ratio < 0.7) {
            if (stateBeforeKeyboard === null) {
                stateBeforeKeyboard = currentState;
            }
            // Don't override if user already collapsed
            if (currentState !== STATE_COLLAPSED) {
                applyState(STATE_DEFAULT);
            }
        } else {
            // Keyboard closed — restore
            if (stateBeforeKeyboard !== null) {
                applyState(stateBeforeKeyboard);
                stateBeforeKeyboard = null;
            }
        }
    }

    /* ── Orientation change: recalc heights ── */
    function onOrientationChange() {
        recalcHeights();
        // In landscape the CSS overlay rules don't apply, so just reset inline styles
        panel.style.height = '';
        panel.classList.remove(CSS_COLLAPSED, CSS_EXPANDED, CSS_DRAGGING);
        currentState = STATE_DEFAULT;
    }

    /* ── Init ── */
    function init() {
        panel = document.querySelector('.chat-panel');
        handle = document.getElementById('chat-overlay-handle');
        toggle = document.getElementById('chat-overlay-toggle');

        if (!panel || !handle || !toggle) {
            console.warn('[MobileChatOverlay] Required elements not found — skipping init.');
            return;
        }

        recalcHeights();

        // Start collapsed — avatar fills the screen, just input bar visible
        applyState(STATE_COLLAPSED);

        // Chevron tap
        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            cycleState();
        });

        // Tap on input shell to expand from collapsed state
        var inputShell = panel.querySelector('.chat-input-shell');
        if (inputShell) {
            inputShell.addEventListener('click', function (e) {
                if (currentState === STATE_COLLAPSED) {
                    // Only expand if user tapped the shell itself or the handle area,
                    // not an interactive element (input, button)
                    var tag = e.target.tagName.toLowerCase();
                    if (
                        tag === 'input' ||
                        tag === 'button' ||
                        tag === 'svg' ||
                        tag === 'path' ||
                        tag === 'line' ||
                        tag === 'polygon'
                    )
                        return;
                    applyState(STATE_DEFAULT);
                }
            });
        }

        // Handle drag
        handle.addEventListener('touchstart', onTouchStart, { passive: true });
        handle.addEventListener('touchmove', onTouchMove, { passive: false });
        handle.addEventListener('touchend', onTouchEnd, { passive: true });
        handle.addEventListener('touchcancel', onTouchEnd, { passive: true });

        // Keyboard awareness
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', onViewportResize);
        }

        // Orientation / resize
        window.addEventListener('orientationchange', onOrientationChange);
        window.addEventListener('resize', function () {
            recalcHeights();
        });

        console.log('[MobileChatOverlay] Overlay chat active — fullscreen avatar mode.');
    }

    /* ── Boot ── */
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
