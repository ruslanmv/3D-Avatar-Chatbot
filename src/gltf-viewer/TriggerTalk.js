/**
 * TriggerTalk — VR2. Hold the right trigger to talk to her; let go to send.
 *
 * The person asked for the simplest thing: press the right trigger, speak, release. The trigger is
 * already the controller's "click" — pointing at the VR panel and pulling it presses a button — so
 * talking must never steal a click, and a click must never start a recording. The rule is the
 * context-sensitive one Quest apps use for a shared trigger:
 *
 *   - the ray is on a panel button you can SEE → it is a click, exactly as before;
 *   - anywhere else → hold to talk (Y / B keep working as push-to-talk too).
 *
 * "Can see" matters: hiding the panel with X leaves its hit-boxes registered, so a trigger aimed
 * where the hidden panel had been used to click an invisible button. `firstVisibleHit` skips any
 * hit whose object or ancestor is hidden — which also ends those ghost clicks.
 *
 * Talking is only for the right hand's real controller in VR, at the person's request:
 *   - not phone AR — a screen tap arrives as a trigger press (`targetRayMode: 'screen'`), and AR
 *     already listens on its own after placement;
 *   - not an AR session on the Quest either (`environmentBlendMode` other than 'opaque');
 *   - not a hand-tracking pinch, which is the Quest's ordinary click.
 *
 * Several holds share one recording (`createHolders`): pressing B while holding the trigger does
 * not start a second one, and the recording ends when the last of them is let go.
 *
 * IIFE with the dual export; VRControllers imports it for its side effect and reads
 * window.NEXUS_TRIGGER_TALK. Tested in tests/trigger-talk.test.js.
 */
(function (global) {
    'use strict';

    /** Whether this trigger press may mean "talk": right controller, real controller, VR. */
    function isTalkTrigger(inputSource, environmentBlendMode) {
        const s = inputSource;
        if (!s || s.handedness !== 'right') return false;
        if (s.targetRayMode !== 'tracked-pointer') return false; // a phone tap is 'screen'
        if (s.hand) return false; // a hand-tracking pinch is the Quest's click
        if (!s.gamepad) return false;
        return environmentBlendMode == null || environmentBlendMode === 'opaque'; // VR, not AR
    }

    /** The nearest raycast hit whose object and every ancestor is visible, or null. */
    function firstVisibleHit(intersects) {
        for (const hit of intersects || []) {
            let o = hit && hit.object;
            let shown = !!o;
            while (o) {
                if (o.visible === false) {
                    shown = false;
                    break;
                }
                o = o.parent;
            }
            if (shown) return hit;
        }
        return null;
    }

    /** One recording, held by any number of buttons. press/release answer true on the edge. */
    function createHolders() {
        const held = new Set();
        return {
            press(source) {
                const was = held.size;
                held.add(source);
                return was === 0 && held.size === 1;
            },
            release(source) {
                if (!held.delete(source)) return false;
                return held.size === 0;
            },
            releaseAll() {
                const was = held.size > 0;
                held.clear();
                return was;
            },
            has: (source) => held.has(source),
            any: () => held.size > 0,
        };
    }

    const api = { isTalkTrigger, firstVisibleHit, createHolders };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRIGGER_TALK = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
