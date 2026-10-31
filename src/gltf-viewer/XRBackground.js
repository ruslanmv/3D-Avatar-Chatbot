/**
 * XRBackground — what the viewport behind her should be when an XR session starts (XP1).
 *
 * The bug this exists for: on a Meta Quest, ENTER AR could land on black instead of the
 * room. Both XR helpers listen to three's `sessionstart`, and VRSupport's listener has no
 * mode check — it fires for AR sessions too and dispatches `vr-session-start`, whose handler
 * paints `scene.background` with a solid colour and puts the VR floor grid down. ARSupport
 * then nulls the background for passthrough, so the room shows only when every step runs in
 * that order; whenever ARSupport's setup is skipped (its idempotency guard was never reset by
 * `forceExit()`), the black stays — and even when it works, a VR floor grid is drawn across
 * the person's real floor.
 *
 * So on a Quest, an AR session's background is left to ARSupport: nothing is painted and no
 * grid goes down. Everything else gets exactly what it got before:
 *
 *   - VR on a Quest: black (or blue / void), with the grid. "In VR a black background is
 *     fine" — the person's words — and passthrough cannot show through an `immersive-vr`
 *     session on Quest anyway; its compositor is opaque.
 *   - AR on a phone: the old background and viewpoint ("Mobile AR is okay, keep it as it is").
 *     Phone AR goes through this same handler and has worked with the old ordering, so it keeps
 *     it — except the VR floor grid, which is gone from every AR session (XP2, below).
 *
 * Pure: every input is passed in, so jsdom can test the rule. ViewerEngine imports this file
 * for its side effect and reads `window.NEXUS_XR_BACKGROUND`; Jest requires it directly.
 */
(function (global) {
    'use strict';

    const BLACK = 0x000000;
    const BLUE = 0x1a1a2e;

    /** Same test as DeviceDetector's `os === 'quest'` and the Quest voice switch. */
    const QUEST_UA = /OculusBrowser|Quest/i;

    function isQuestUA(ua) {
        return QUEST_UA.test(String(ua || ''));
    }

    /**
     * The background `vr-session-start` should paint, or null for "paint nothing".
     *
     * @param {{ value?: string, isAR?: boolean, isQuest?: boolean }} ctx
     *   value    the panel's BG choice: 'black' | 'blue' | 'void' | 'passthrough'
     *   isAR     the session that just started is immersive-ar
     *   isQuest  the page is running in a Meta Quest browser
     * @returns {null | { color: number, ground: boolean }}
     */
    function sessionStartBackground(ctx) {
        const c = ctx || {};
        if (c.isAR && c.isQuest) {
            // ARSupport owns this session's background: null, so the cameras show through.
            return null;
        }
        // Exactly the colour mapping the handler always used — including 'passthrough' → black in
        // a VR session, which is what an opaque compositor shows for it anyway.
        //
        // XP2. But never the VR floor grid in AR, on a phone either. That grid is VR furniture:
        // 20 m of lines at y = 0 of the session's space, which in AR is wherever the phone
        // started — not the floor. On a phone it cut through the room at about waist height,
        // reported with a screenshot. Surfaces in AR are shown by arFloorGuide() below instead,
        // on the floor the phone actually found. The background colour is unchanged: phone AR
        // has always had ARSupport clear it, and the person asked for phone AR to keep that.
        return {
            color: c.value === 'blue' ? BLUE : BLACK,
            ground: c.value !== 'void' && !c.isAR,
        };
    }

    /**
     * XP2. The floor guide in AR: a small grid lying on the surface the phone detected.
     *
     * The industry pattern (ARCore, ARKit, Meta): show detected surfaces while the person is
     * PLACING something — it answers "where will she stand?" — and take them away once she is
     * placed, keeping only her shadow, so the room is the room again. "Show floor grid in AR"
     * (Settings ▸ Companion, `overlay_arfloorgrid`, off by default) keeps it on after placement,
     * under her.
     *
     * @param {{ surfaceFound?: boolean, placed?: boolean, alwaysShow?: boolean, isQuest?: boolean }} ctx
     *   surfaceFound  the phone has a surface under its aim right now (the reticle is showing)
     *   placed        she has been placed in the room this session
     *   alwaysShow    the person turned "Show floor grid in AR" on
     * @returns {{ visible: boolean, at: 'reticle'|'avatar'|null }}
     */
    function arFloorGuide(ctx) {
        const c = ctx || {};
        // A phone's placement flow only: on a Quest nothing calls placeAvatarAtReticle (there is
        // no TAP TO PLACE in the headset), so "placed" would never come and the guide would trail
        // the person's gaze for the whole session. Quest passthrough stays as XP1 left it.
        if (c.isQuest) {
            return { visible: false, at: null };
        }
        if (!c.placed) {
            return c.surfaceFound ? { visible: true, at: 'reticle' } : { visible: false, at: null };
        }
        return c.alwaysShow ? { visible: true, at: 'avatar' } : { visible: false, at: null };
    }

    /**
     * How far `vr-session-start` raises the viewpoint, in metres.
     *
     * In VR the +0.15 m boost puts the eye level with a VRoid face, which is a comfort choice
     * many VR titles make. In passthrough it is wrong by the industry's own rules: mixed reality
     * keeps virtual content registered 1:1 to the physical room, and moving the viewpoint moves
     * her 15 cm against the person's real floor — she sinks into it or hovers above it. So a
     * Quest AR session gets no offset. Phone AR keeps what it had (see the header).
     */
    function eyeLevelBoost(ctx) {
        const c = ctx || {};
        return c.isAR && c.isQuest ? 0 : 0.15;
    }

    const api = { BLACK, BLUE, isQuestUA, sessionStartBackground, eyeLevelBoost, arFloorGuide };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_XR_BACKGROUND = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
