/**
 * Stage-first controls for Together's live Try-On.
 *
 * The real VRM viewer stays where it is: no canvas moves, no duplicate renderer.
 * This is only a presentation adapter over TryOnView/TryOnSession. Advanced
 * wardrobe controls remain the original view, opened explicitly with More.
 */
(function (global) {
    'use strict';

    var STYLE_ID = 'nexus-try-on-stage-style';
    var CSS = [
        '.avatar-preview-wrap.nexus-try-on-stage-active{isolation:isolate}',
        '.nexus-try-on-stage-active .nexus-stage-ui{position:absolute;inset:0;z-index:42;pointer-events:none;',
        'display:flex;flex-direction:column;justify-content:space-between;color:#e8f8ff;',
        'font-family:var(--font-sans,system-ui,sans-serif)}',
        '.nexus-stage-ui button{font:inherit;cursor:pointer;touch-action:manipulation}',
        '.nexus-stage-ui button:focus-visible{outline:2px solid #19e6fa;outline-offset:2px}',
        '.nexus-stage-ui button:disabled{opacity:.42;cursor:default}',
        '.nexus-stage-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;',
        'padding:18px 22px;pointer-events:none}',
        '.nexus-stage-pill{font:700 .69rem/1.4 var(--font-display,system-ui,sans-serif);',
        'letter-spacing:.12em;text-transform:uppercase;border:1px solid rgba(0,210,230,.32);',
        'background:rgba(2,20,32,.78);color:#39dced;border-radius:999px;padding:.45rem .7rem}',
        '.nexus-stage-head-actions{display:flex;gap:7px;pointer-events:auto}',
        '.nexus-stage-subtle{background:rgba(3,19,32,.82);color:#d8eff9;border:1px solid rgba(0,204,231,.35);',
        'padding:9px 12px;border-radius:12px;font-size:.78rem;font-weight:600}',
        '.nexus-stage-subtle[aria-expanded="true"]{background:#064354;border-color:#10cce9}',
        '.nexus-stage-look-rail{position:absolute;top:82px;right:15px;bottom:172px;overflow:auto;',
        'width:96px;max-width:22%;display:flex;flex-direction:column;gap:7px;pointer-events:auto;',
        'scrollbar-width:thin;scrollbar-color:#17798c transparent}',
        '.nexus-stage-look-tile{display:flex;flex-direction:column;gap:4px;align-items:center;',
        'border:1px solid rgba(14,166,199,.3);background:rgba(3,21,31,.78);border-radius:12px;',
        'padding:5px;color:#d4e6f2;min-height:80px;flex-shrink:0;text-align:center}',
        '.nexus-stage-look-tile[aria-pressed="true"]{border-color:#16e4f7;',
        'box-shadow:inset 0 0 0 1px rgba(23,216,234,.45),0 0 12px rgba(0,220,242,.18)}',
        '.nexus-stage-look-tile img{display:block;width:100%;height:72px;object-fit:contain;',
        'object-position:center 30%;background:rgba(255,255,255,.04);border-radius:7px}',
        '.nexus-stage-look-tile .nexus-stage-no-preview{display:grid;place-items:center;',
        'width:100%;height:72px;border-radius:7px;background:rgba(255,255,255,.055);font-size:1.4rem}',
        '.nexus-stage-look-tile span:last-child{font-size:.69rem;white-space:nowrap;max-width:85px;',
        'overflow:hidden;text-overflow:ellipsis}',
        '.nexus-stage-bottom{position:relative;pointer-events:auto;padding:45px 16px 15px;',
        'background:linear-gradient(180deg,transparent,rgba(2,13,24,.82) 26%,rgba(2,13,24,.96));',
        'padding-right:clamp(105px,16%,132px)}',
        '.nexus-stage-meta{display:flex;gap:7px;align-items:center;flex-wrap:wrap;',
        'margin:0 0 7px;color:#b0d1df;font-size:.79rem}',
        '.nexus-stage-name{margin:0;font:700 clamp(1rem,1.65vw,1.5rem)/1.35 ',
        'var(--font-sans,system-ui);text-shadow:0 2px 8px #000}',
        '.nexus-stage-description{margin:5px 0 12px;font-size:.82rem;line-height:1.4;',
        'max-width:37rem;color:#bcdae5;display:-webkit-box;-webkit-line-clamp:2;',
        '-webkit-box-orient:vertical;overflow:hidden}',
        '.nexus-stage-actions{display:flex;flex-wrap:wrap;gap:7px;align-items:stretch}',
        '.nexus-stage-action{padding:.72rem .82rem;min-height:44px;border-radius:12px;',
        'border:1px solid rgba(10,197,224,.5);background:rgba(3,35,49,.82);color:#e6faff;',
        'font-size:.79rem;font-weight:650}',
        '.nexus-stage-action[aria-pressed="true"]{background:rgba(7,103,116,.77);border-color:#5ee4f5}',
        '.nexus-stage-action.is-primary{background:linear-gradient(120deg,#04def1,#14bcd5);',
        'color:#002431;border-color:#00e6ef;font-weight:800;min-width:116px}',
        '.nexus-stage-error{margin:6px 0;font-size:.78rem;color:#ffcbaf}',
        '.nexus-try-on-stage-active #nexus-try-on-view.nexus-stage-legacy:not([hidden]){',
        'position:absolute!important;left:16px!important;top:16px!important;bottom:16px!important;',
        'transform:none!important;width:min(420px,calc(100% - 125px))!important;',
        'max-height:calc(100% - 32px)!important;overflow-y:auto!important;',
        'background:rgba(4,18,30,.97)!important;z-index:60!important;',
        'box-shadow:0 20px 80px #0009!important;border:1px solid #1389a4!important}',
        '.nexus-stage-look-rail[hidden]{display:none}',
        '@media(max-width:760px){',
        '.nexus-stage-head{padding:10px 12px}.nexus-stage-pill{font-size:.58rem}',
        '.nexus-stage-look-rail{right:8px;top:52px;bottom:200px;width:70px;max-width:20%;gap:5px}',
        '.nexus-stage-look-tile{padding:3px;min-height:58px}',
        '.nexus-stage-look-tile img,.nexus-stage-look-tile .nexus-stage-no-preview{height:54px}',
        '.nexus-stage-look-tile span:last-child{font-size:.6rem;max-width:62px}',
        '.nexus-stage-bottom{padding:35px 10px 12px;padding-right:10px}',
        '.nexus-stage-meta{font-size:.7rem}',
        '.nexus-stage-name{font-size:1.04rem}',
        '.nexus-stage-description{font-size:.73rem;-webkit-line-clamp:1;margin:3px 0 8px}',
        '.nexus-stage-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}',
        '.nexus-stage-action{font-size:.7rem;min-height:44px;padding:.52rem .2rem}',
        '.nexus-stage-action.is-primary{min-width:0}',
        '.nexus-stage-look-rail:not(.is-open){display:none}',
        '.nexus-try-on-stage-active #nexus-try-on-view.nexus-stage-legacy:not([hidden]){',
        'position:fixed!important;left:9px!important;right:9px!important;top:auto!important;',
        'bottom:var(--nexus-composer-inset,88px)!important;width:auto!important;',
        'max-height:min(60dvh,calc(100dvh - var(--nexus-composer-inset,88px) - 50px))!important;',
        'border-radius:16px!important}',
        '}',
        '@media(prefers-reduced-motion:reduce){.nexus-stage-ui *,',
        '.nexus-stage-ui *::before{animation:none!important;transition:none!important}}',
    ].join('');

    function node(doc, tag, className, text) {
        var el = doc.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    }

    function button(doc, label, className, act) {
        var b = node(doc, 'button', className, label);
        b.type = 'button';
        b.addEventListener('click', act);
        return b;
    }

    function description(look) {
        var value = (look && (look.prompt || (look.provenance && look.provenance.prompt))) || '';
        return String(value).replace(/\s*[+&]\s*/g, ' · ').trim().slice(0, 115);
    }

    class TryOnStageExperience {
        constructor(options) {
            options = options || {};
            this.doc = options.doc || global.document;
            this.view = options.view;
            this.session = options.session;
            this.openLooks = true;
            this.expanded = false;
            this.lastLanded = null;
        }

        mount() {
            var doc = this.doc;
            var stage = doc && doc.querySelector('.avatar-preview-wrap');
            if (!stage || !this.view || !this.view.root || this.root) return null;
            this.stage = stage;
            this.legacy = this.view.root;
            this.previousParent = this.legacy.parentNode;
            this.legacy.classList.add('nexus-stage-legacy');
            this.legacy.hidden = true;
            this.legacy.setAttribute('aria-modal', 'false');
            stage.appendChild(this.legacy);
            if (!doc.getElementById(STYLE_ID)) {
                var style = node(doc, 'style');
                style.id = STYLE_ID;
                style.textContent = CSS;
                (doc.head || doc.documentElement).appendChild(style);
            }
            this.root = node(doc, 'div', 'nexus-stage-ui');
            this.root.setAttribute('aria-label', 'Live try-on stage controls');
            stage.classList.add('nexus-try-on-stage-active');
            stage.appendChild(this.root);
            this.view.stageExperience = this;
            this.render(this.session.state());
            return this.root;
        }

        viewer() {
            return (this.doc.defaultView || global).NEXUS_VIEWER || null;
        }

        frameOnLanding(state) {
            if (state.landed === this.lastLanded || !state.look || state.busy) return;
            this.lastLanded = state.landed;
            var viewer = this.viewer();
            if (!viewer || !viewer.avatarManager || !viewer.avatarManager.currentRoot) return;
            // Real VRM bounds and real camera, not a CSS scale of the canvas.
            // Use the existing frameObject, with comfortable full-body margins.
            if (typeof viewer.resize === 'function') viewer.resize();
            if (typeof viewer.frameObject === 'function') {
                viewer.frameObject(viewer.avatarManager.currentRoot, 1.23);
            }
        }

        toggleAdvanced() {
            this.expanded = !this.expanded;
            this.legacy.hidden = !this.expanded;
            this.legacy.setAttribute('aria-modal', this.expanded ? 'true' : 'false');
            this.view.collapsed = !this.expanded;
            this.view._keepOpen = this.expanded;
            this.view.render();
            if (this.expanded) {
                var first = this.legacy.querySelector('button:not([disabled]), input:not([disabled])');
                if (first) first.focus();
            }
        }

        zoom() {
            var viewer = this.viewer();
            if (!viewer || !viewer.camera || !viewer.controls) return;
            var cam = viewer.camera;
            var target = viewer.controls.target;
            if (!cam.position || !target || typeof cam.position.clone !== 'function') return;
            var delta = cam.position.clone().sub(target);
            var current = delta.length();
            var min = viewer.controls.minDistance || 0.4;
            var desired = Math.max(min, current * 0.82);
            if (current <= desired) return;
            cam.position.copy(target.clone().add(delta.multiplyScalar(desired / current)));
            viewer.controls.update();
        }

        render(state) {
            if (!this.root || !state) return;
            var doc = this.doc;
            var self = this;
            var content = node(doc, 'div', 'nexus-stage-head');
            content.appendChild(node(doc, 'span', 'nexus-stage-pill', '● AI · LIVE TRY-ON'));
            var headActions = node(doc, 'div', 'nexus-stage-head-actions');
            var lookToggle = button(doc, 'Looks ' + (state.total ? '(' + state.total + ')' : ''), 'nexus-stage-subtle', function () {
                self.openLooks = !self.openLooks;
                self.render(self.session.state());
            });
            lookToggle.setAttribute('aria-expanded', String(this.openLooks));
            headActions.appendChild(lookToggle);
            var more = button(doc, this.expanded ? 'Close ✕' : 'More ···', 'nexus-stage-subtle', function () {
                self.toggleAdvanced();
            });
            more.setAttribute('aria-expanded', String(this.expanded));
            headActions.appendChild(more);
            content.appendChild(headActions);

            var rail = node(doc, 'div', 'nexus-stage-look-rail' + (this.openLooks ? ' is-open' : ''));
            rail.setAttribute('aria-label', 'Select a look');
            if (!this.openLooks) rail.hidden = true;
            (state.looks || []).forEach(function (look, i) {
                var item = button(doc, '', 'nexus-stage-look-tile', function () {
                    self.view.wear(look);
                });
                item.setAttribute('aria-label', 'Wear ' + (look.name || 'Look ' + (i + 1)));
                item.setAttribute('aria-pressed', String(Boolean(state.look && self.view._key(look) === self.view._key(state.look))));
                if (look.previewUrl) {
                    var image = node(doc, 'img');
                    image.src = look.previewUrl;
                    image.alt = '';
                    image.loading = 'lazy';
                    item.appendChild(image);
                } else item.appendChild(node(doc, 'span', 'nexus-stage-no-preview', '👗'));
                item.appendChild(node(doc, 'span', '', 'Look ' + (i + 1)));
                rail.appendChild(item);
            });
            if (!state.looks || !state.looks.length) {
                rail.appendChild(node(doc, 'p', 'nexus-stage-error', 'No looks available yet'));
            }

            var foot = node(doc, 'div', 'nexus-stage-bottom');
            var meta = node(doc, 'div', 'nexus-stage-meta');
            meta.appendChild(node(doc, 'span', '', state.look ? 'LOOK ' + (state.position + 1) + ' / ' + state.total : 'CHOOSE YOUR FIRST LOOK'));
            foot.appendChild(meta);
            foot.appendChild(node(doc, 'h3', 'nexus-stage-name', state.look ? state.look.name || 'Current Look' : 'Ready for a try-on?'));
            foot.appendChild(node(doc, 'p', 'nexus-stage-description',
                state.look ? description(state.look) || 'Ask NEXUS how you could style this look.' :
                    'Choose an outfit from Looks to start the haul.'));
            if (state.error) foot.appendChild(node(doc, 'p', 'nexus-stage-error', state.error));
            var actions = node(doc, 'div', 'nexus-stage-actions');
            if (this.view.turner) {
                var back = button(doc, this.view.turned ? '↻ Front view' : '↻ Show back',
                    'nexus-stage-action', function () { self.view.turn(); });
                back.disabled = !state.look || state.busy;
                back.setAttribute('aria-pressed', String(this.view.turned));
                actions.appendChild(back);
            } else {
                var zoom = button(doc, '⌕ Zoom', 'nexus-stage-action', function () { self.zoom(); });
                zoom.disabled = !state.look;
                actions.appendChild(zoom);
            }
            var saved = button(doc, state.favorite ? '♥ Saved' : '♡ Save look',
                'nexus-stage-action', function () { self.view.favorite(); });
            saved.disabled = !state.look || state.busy;
            saved.setAttribute('aria-pressed', String(Boolean(state.favorite)));
            actions.appendChild(saved);
            var next = button(doc, 'Next look →', 'nexus-stage-action is-primary', function () {
                self.view._step(1);
            });
            next.disabled = !(state.looks && state.looks.length);
            actions.appendChild(next);
            foot.appendChild(actions);

            this.root.replaceChildren(content, rail, foot);
            this.frameOnLanding(state);
        }

        unmount() {
            if (this.view && this.view.stageExperience === this) this.view.stageExperience = null;
            if (this.stage) this.stage.classList.remove('nexus-try-on-stage-active');
            if (this.root) this.root.remove();
            if (this.legacy) {
                this.legacy.hidden = false;
                this.legacy.classList.remove('nexus-stage-legacy');
                this.legacy.setAttribute('aria-modal', 'true');
                if (this.previousParent && this.previousParent.isConnected) {
                    this.previousParent.appendChild(this.legacy);
                }
            }
            this.root = null;
            this.stage = null;
            this.legacy = null;
        }
    }

    var api = { TryOnStageExperience: TryOnStageExperience, description: description };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_STAGE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
