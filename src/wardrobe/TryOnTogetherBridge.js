/**
 * W8. Put Try-On into Together — once, late, and reversibly.
 *
 * Two things have to exist before the Try-On tile can: Together's panel, which `boot.js`
 * builds and exposes as `window.NEXUS_BD.togetherPanel`, and the wardrobe service, which
 * `WardrobeBootstrap` builds once the viewer is ready and exposes as `window.NEXUS_WARDROBE`.
 * They load by different routes (the boot list, and the script tags at the end of
 * `index.html`) and finish in either order, so this waits for both rather than assuming
 * one. `TogetherPanel.register()` repaints the chooser, so a tile added late simply appears.
 *
 * The floating 👗 button is not deleted, but it is never offered on the landing page: the
 * wardrobe is reached through Together ▸ Try-On Haul. W18. It used to be hidden only once the
 * tile had registered, and the bridge gave up after 60 s: on a phone the button sat on the
 * landing page while the avatar loaded (5 s on a desktop, far longer on a phone), and where
 * loading took longer than a minute the old drawer stayed for good. It is hidden from the
 * moment this script runs, before the drawer mounts, and the bridge keeps waiting for
 * Together instead of giving up. `NEXUS_WARDROBE_CONFIG.tryOnInTogether = false` leaves
 * everything exactly as it was before W8, drawer included.
 *
 * Nothing here is edited into `boot.js` or the panel: this file and its script tag are
 * the whole of the wiring.
 *
 * Exposes: window.NEXUS_TRY_ON_BRIDGE
 */
(function (global) {
    'use strict';

    var HIDE_CLASS = 'nexus-try-on-in-together';
    var STYLE_ID = 'nexus-try-on-bridge-style';
    var CSS =
        'body.' +
        HIDE_CLASS +
        ' #nexus-wardrobe-button,body.' +
        HIDE_CLASS +
        ' .nexus-wardrobe-panel{display:none !important}';

    function enabled() {
        var config = global.NEXUS_WARDROBE_CONFIG || {};
        return config.tryOnInTogether !== false;
    }

    /** Everything the tile needs, or null while any of it is still loading. */
    function parts() {
        var bd = global.NEXUS_BD;
        var panel = bd && bd.togetherPanel;
        var wardrobe = global.NEXUS_WARDROBE;
        var Activity = global.NEXUS_TRY_ON_HAUL_ACTIVITY;
        if (!panel || typeof panel.register !== 'function') return null;
        if (!wardrobe || !wardrobe.service || !Activity) return null;
        return { panel: panel, wardrobe: wardrobe, Activity: Activity };
    }

    function hideDrawer(doc) {
        if (!doc || !doc.body) return;
        if (!doc.getElementById(STYLE_ID)) {
            var style = doc.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            (doc.head || doc.documentElement).appendChild(style);
        }
        doc.body.classList.add(HIDE_CLASS);
    }

    /** Register the tile if everything is here. `{ok, why}`; idempotent. */
    function attach() {
        if (!enabled()) return { ok: false, why: 'disabled' };
        var found = parts();
        if (!found) return { ok: false, why: 'waiting' };
        var doc = global.document;
        var panel = found.panel;
        var id = found.Activity.ID;
        if (!(panel.activities && panel.activities.has && panel.activities.has(id))) {
            var activity = found.Activity.create({ wardrobe: found.wardrobe, panel: panel, doc: doc });
            if (!panel.register(activity)) return { ok: false, why: 'refused' };
            global.NEXUS_TRY_ON = { activity: activity };
        }
        hideDrawer(doc);
        return { ok: true, why: '' };
    }

    /**
     * Keep trying until both halves exist, then stop. Gives up quietly after `timeoutMs` —
     * the drawer was never hidden, so a page without Together is exactly as it was.
     */
    function start(options) {
        options = options || {};
        var interval = options.intervalMs || 250;
        // W18. Long enough for a phone on a slow network; past it, polling slows rather than stops.
        var timeout = options.timeoutMs || 60000;
        if (enabled()) hideDrawer(global.document);
        return new Promise(function (resolve) {
            var first = attach();
            if (first.ok || first.why === 'disabled') return resolve(first);
            var waited = 0;
            var timer = global.setInterval(function () {
                waited += interval;
                if (waited > timeout && waited % (interval * 8) !== 0) return; // after the first minute, every 2 s
                var result = attach();
                if (result.ok || result.why === 'refused') {
                    global.clearInterval(timer);
                    resolve(result);
                }
            }, interval);
        });
    }

    var api = { HIDE_CLASS: HIDE_CLASS, attach: attach, start: start, enabled: enabled };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_BRIDGE = api;

    // Start itself in the page; under Jest the test drives it.
    if (global && global.document && !(typeof module !== 'undefined' && module.exports)) {
        start();
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
