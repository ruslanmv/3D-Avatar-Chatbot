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
 * The floating 👗 button is not deleted. It is hidden by a class on `<body>`, and only
 * after the tile is registered — if Together never arrives (behaviour engine off, an older
 * page), the drawer is still there and still works. `NEXUS_WARDROBE_CONFIG.tryOnInTogether
 * = false` leaves everything exactly as it was before this batch.
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
        var timeout = options.timeoutMs || 60000;
        return new Promise(function (resolve) {
            var first = attach();
            if (first.ok || first.why === 'disabled') return resolve(first);
            var waited = 0;
            var timer = global.setInterval(function () {
                waited += interval;
                var result = attach();
                if (result.ok || result.why === 'refused' || waited >= timeout) {
                    global.clearInterval(timer);
                    resolve(result.ok ? result : { ok: false, why: result.why === 'refused' ? 'refused' : 'timeout' });
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
