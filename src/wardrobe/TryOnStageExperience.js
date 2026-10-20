/**
 * A clothing-look rail, layered over the EXISTING avatar viewport.
 *
 * No canvas reparenting, viewport resizing, camera framing/zoom or extra stage
 * UI. The original TryOnView remains available through "Wardrobe" and still
 * owns advanced editing, private content, Compare, Undo, Keep and End.
 */
(function (global) {
    'use strict';

    var STYLE_ID = 'nexus-try-on-stage-style';
    var CSS = [
        ".nexus-try-on-stage-active .nexus-stage-label{position:absolute;z-index:40;top:14px;left:16px;display:flex;align-items:center;gap:7px;padding:7px 12px;border-radius:999px;background:rgba(2,23,35,.84);border:1px solid rgba(20,203,227,.5);color:#a9f9f4;font:700 .68rem/1.2 system-ui;letter-spacing:.1em;pointer-events:none}",
        ".nexus-stage-label::before{content:\"\";width:6px;height:6px;background:#18d6ad;border-radius:50%}",
        ".nexus-try-on-stage-active .nexus-stage-info{position:absolute;left:12px;right:112px;bottom:10px;z-index:40;pointer-events:none;padding:34px 4px 2px;color:#f3fbfd;background:linear-gradient(180deg,transparent,rgba(3,15,25,.8) 30%,rgba(3,15,25,.94));font-family:var(--font-sans,system-ui)}",
        ".nexus-stage-count{margin:0 0 4px;font-size:.75rem;letter-spacing:.09em;color:#b5d5de}",
        ".nexus-stage-look-name{margin:0 0 2px;font-weight:750;font-size:clamp(1rem,1.5vw,1.35rem);line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".nexus-stage-look-desc{margin:0 0 9px;font-size:.75rem;color:#c4d8df;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".nexus-stage-actions{display:flex;align-items:stretch;gap:6px;pointer-events:auto}",
        ".nexus-stage-action{flex:1;min-width:0;min-height:44px;padding:8px 6px;border-radius:10px;border:1px solid rgba(8,178,203,.54);background:rgba(2,35,48,.9);color:#e9f8fc;font:600 .76rem/1.1 system-ui;cursor:pointer;white-space:nowrap}",
        ".nexus-stage-action:disabled{opacity:.42;cursor:not-allowed}",
        ".nexus-stage-action:focus-visible{outline:2px solid #50e7f5;outline-offset:2px}",
        ".nexus-stage-action[aria-pressed=\"true\"]{border-color:#5cead2;background:#09525b}",
        ".nexus-stage-action.is-primary{flex:1.35;border-color:#04ddeb;background:#12d3e8;color:#06202c;font-weight:800}",
        ".nexus-stage-action.is-primary:hover{background:#60e6f3}",
        ".nexus-look-rail-tools{align-items:stretch}",
        ".nexus-look-rail-title{font-size:.73rem;color:#e6f4f7;letter-spacing:.035em;background:rgba(2,25,37,.9);border:1px solid rgba(8,160,190,.4);border-radius:9px;padding:8px 2px;text-transform:none}",
        ".nexus-try-on-stage-active #nexus-try-on-view:not([hidden]){z-index:60}",
        "@media(max-width:760px){.nexus-try-on-stage-active .nexus-stage-label{top:8px;left:10px;font-size:.59rem;padding:6px 9px}.nexus-try-on-stage-active .nexus-stage-info{left:8px;right:74px;bottom:8px;padding-top:24px}.nexus-stage-count,.nexus-stage-look-desc{font-size:.65rem}.nexus-stage-look-name{font-size:.89rem}.nexus-stage-actions{gap:4px;flex-wrap:wrap}.nexus-stage-action{min-height:44px;font-size:.67rem;padding:6px 4px;flex-basis:25%}.nexus-stage-action[data-command=\"zoom\"]{display:none}.nexus-stage-action.is-primary{flex-basis:30%}.nexus-look-rail-title{font-size:.63rem;padding:7px 2px}}",

        '.avatar-preview-wrap.nexus-try-on-stage-active{position:relative}',
        '.nexus-try-on-look-rail{position:absolute;right:12px;top:12px;bottom:12px;',
        'z-index:40;width:88px;max-width:22%;display:flex;flex-direction:column;gap:8px;',
        'pointer-events:none;font-family:var(--font-sans,system-ui,sans-serif);color:#e5f5fa}',
        '.nexus-try-on-look-rail button{pointer-events:auto;cursor:pointer;touch-action:manipulation;',
        'font-family:inherit}',
        '.nexus-try-on-look-rail button:focus-visible{outline:2px solid #39def1;outline-offset:2px}',
        '.nexus-try-on-look-rail button:disabled{opacity:.4;cursor:default}',
        '.nexus-look-rail-tools{display:flex;flex-direction:column;gap:6px;flex:0 0 auto}',
        '.nexus-look-rail-title{color:#5ce6f8;letter-spacing:.12em;text-transform:uppercase;',
        'text-align:center;font-size:.65rem;font-weight:800;text-shadow:0 2px 4px #000}',
        '.nexus-look-rail-edit{border:1px solid rgba(28,201,222,.55);border-radius:9px;',
        'background:rgba(2,19,30,.92);color:#dbf5fc;font-size:.69rem;font-weight:650;',
        'padding:.6rem .2rem;min-height:40px}',
        '.nexus-look-rail-edit[aria-expanded="true"]{border-color:#28e3f2;background:#085164}',
        '.nexus-look-rail-list{flex:1;min-height:0;display:flex;flex-direction:column;gap:7px;',
        'overflow-x:hidden;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#0f8799 transparent;',
        'overscroll-behavior:contain;padding:2px;pointer-events:auto}',
        '.nexus-look-rail-item{display:flex;flex-direction:column;align-items:center;',
        'gap:4px;flex:none;min-height:68px;padding:5px 4px;border-radius:12px;',
        'border:1px solid rgba(15,155,190,.45);background:rgba(3,18,29,.9);',
        'color:#d6edf8;font-size:.68rem;line-height:1.2}',
        '.nexus-look-rail-item[aria-pressed="true"]{border-color:#1be0f6;',
        'box-shadow:0 0 0 1px rgba(16,223,240,.38) inset,0 0 14px rgba(0,205,233,.21)}',
        '.nexus-look-rail-image{display:block;height:74px;width:100%;object-fit:contain;',
        'object-position:center 30%;background:rgba(255,255,255,.035);border-radius:8px}',
        '.nexus-look-rail-no-image{display:grid;place-items:center;width:100%;height:74px;',
        'border-radius:8px;background:rgba(255,255,255,.05);font-size:1.4rem}',
        '.nexus-look-rail-caption{max-width:100%;white-space:nowrap;overflow:hidden;',
        'text-overflow:ellipsis}',
        '.nexus-look-rail-empty{padding:9px 3px;text-align:center;font-size:.68rem;',
        'color:#bed3dc;background:rgba(2,19,30,.9);border-radius:8px}',
        '#nexus-try-on-view[hidden]{display:none!important}',
        '@media(max-width:760px){',
        '.nexus-try-on-look-rail{width:60px;right:7px;top:8px;bottom:8px;gap:5px}',
        '.nexus-look-rail-title{font-size:.57rem}',
        '.nexus-look-rail-edit{font-size:.6rem;min-height:40px}',
        '.nexus-look-rail-list{gap:5px}',
        '.nexus-look-rail-item{padding:3px;min-height:58px}',
        '.nexus-look-rail-image,.nexus-look-rail-no-image{height:54px}',
        '.nexus-look-rail-caption{font-size:.58rem}',
        '}',
    ].join('');

    function el(doc, tag, klass, text) {
        var item = doc.createElement(tag);
        if (klass) item.className = klass;
        if (text !== undefined) item.textContent = text;
        return item;
    }

    class TryOnStageExperience {
        constructor(options) {
            options = options || {};
            this.doc = options.doc || global.document;
            this.view = options.view;
            this.session = options.session;
            this.expanded = false;
        }

        mount() {
            var doc = this.doc;
            var preview = doc && doc.querySelector('.avatar-preview-wrap');
            if (!preview || !this.view || !this.view.root || this.root) return null;
            this.preview = preview;
            this.legacy = this.view.root;
            // Leave the existing viewport, WebGL canvas and old dialog in place.
            this.legacy.hidden = true;
            this.legacy.setAttribute('aria-modal', 'false');
            if (!doc.getElementById(STYLE_ID)) {
                var style = el(doc, 'style');
                style.id = STYLE_ID;
                style.textContent = CSS;
                (doc.head || doc.documentElement).appendChild(style);
            }
            this.root = el(doc, 'aside', 'nexus-try-on-look-rail');
            this.root.setAttribute('aria-label', 'Available outfits');
            preview.appendChild(this.root);
            preview.classList.add('nexus-try-on-stage-active');
            this.badge = el(doc, 'div', 'nexus-stage-label', 'AI · LIVE TRY-ON');
            this.info = el(doc, 'section', 'nexus-stage-info');
            this.info.setAttribute('aria-label', 'Current look and try-on controls');
            preview.appendChild(this.badge);
            preview.appendChild(this.info);
            this.view.stageExperience = this;
            this.render(this.session.state());
            // TryOnView initially focuses a control inside its dialog. Move focus
            // to a visible control when that dialog is initially hidden.
            var focus = doc.activeElement;
            if (focus && this.legacy.contains(focus) && this.editButton) this.editButton.focus();
            return this.root;
        }

        toggleAdvanced() {
            if (!this.legacy || !this.view) return;
            this.expanded = !this.expanded;
            this.legacy.hidden = !this.expanded;
            this.legacy.setAttribute('aria-modal', this.expanded ? 'true' : 'false');
            this.view.collapsed = !this.expanded;
            this.view._keepOpen = this.expanded;
            this.view.render();
            if (this.expanded) {
                var first = this.legacy.querySelector('button:not([disabled]), input:not([disabled])');
                if (first) first.focus();
            } else if (this.editButton) {
                this.editButton.focus();
            }
        }

        render(state) {
            if (!this.root || !state) return;
            var doc = this.doc;
            var self = this;
            var activeFocus = doc.activeElement;
            var focusedLookKey = activeFocus && activeFocus.getAttribute('data-look-key');
            var tools = el(doc, 'div', 'nexus-look-rail-tools');
            tools.appendChild(el(doc, 'span', 'nexus-look-rail-title', 'Looks (' + (state.total || 0) + ')'));
            var editor = el(doc, 'button', 'nexus-look-rail-edit', this.expanded ? 'Close ×' : '＋ More');
            editor.type = 'button';
            editor.setAttribute('aria-expanded', String(this.expanded));
            editor.addEventListener('click', function () { self.toggleAdvanced(); });
            tools.appendChild(editor);

            var list = el(doc, 'div', 'nexus-look-rail-list');
            list.setAttribute('role', 'group');
            list.setAttribute('aria-label', 'Choose the avatar clothing');
            var looks = state.looks || [];
            looks.forEach(function (look, index) {
                var item = el(doc, 'button', 'nexus-look-rail-item');
                item.type = 'button';
                item.disabled = Boolean(state.busy);
                item.setAttribute('aria-label', 'Try ' + (look.name || 'Look ' + (index + 1)));
                item.setAttribute('aria-pressed', String(Boolean(state.look && self.view._key(look) === self.view._key(state.look))));
                item.setAttribute('data-look-key', self.view._key(look));
                item.title = look.name || 'Look ' + (index + 1);
                if (look.previewUrl) {
                    var image = el(doc, 'img', 'nexus-look-rail-image');
                    image.src = look.previewUrl;
                    image.alt = '';
                    image.loading = 'lazy';
                    item.appendChild(image);
                } else {
                    item.appendChild(el(doc, 'span', 'nexus-look-rail-no-image', '👗'));
                }
                item.appendChild(el(doc, 'span', 'nexus-look-rail-caption', 'Look ' + (index + 1)));
                item.addEventListener('click', function () { self.view.wear(look); });
                list.appendChild(item);
            });
            if (!looks.length) list.appendChild(el(doc, 'p', 'nexus-look-rail-empty', 'No outfits yet'));
            var scrollTop = this.list ? this.list.scrollTop : 0;
            this.root.replaceChildren(tools, list);
            list.scrollTop = scrollTop;
            this.list = list;
            this.editButton = editor;
            this.renderCurrentLook(state);
            if (focusedLookKey) {
                var buttons = list.querySelectorAll('[data-look-key]');
                for (var i = 0; i < buttons.length; i += 1) {
                    if (buttons[i].getAttribute('data-look-key') === focusedLookKey) {
                        buttons[i].focus();
                        break;
                    }
                }
            }
        }

        zoom() {
            // User-initiated zoom; do not change viewport dimensions or auto-frame.
            var viewer = (this.doc.defaultView || global).NEXUS_VIEWER;
            if (!viewer || !viewer.camera || !viewer.controls) return false;
            var cam = viewer.camera, controls = viewer.controls;
            if (!cam.position || !controls.target || !cam.position.clone || !controls.target.clone) return false;
            var delta = cam.position.clone().sub(controls.target);
            var distance = delta.length();
            var desired = Math.max(Number(controls.minDistance) || 0.5, distance * 0.85);
            if (!(distance > desired)) return false;
            cam.position.copy(controls.target.clone().add(delta.multiplyScalar(desired / distance)));
            controls.update();
            return true;
        }

        renderCurrentLook(state) {
            if (!this.info) return;
            var doc = this.doc, self = this, look = state.look, pieces = [];
            pieces.push(el(doc, 'p', 'nexus-stage-count',
                look ? 'LOOK ' + (state.position + 1) + ' / ' + state.total : 'YOUR STYLE STUDIO'));
            pieces.push(el(doc, 'h3', 'nexus-stage-look-name',
                look ? look.name || 'Current look' : 'Choose your first look'));
            var desc = look && (look.prompt || (look.provenance && look.provenance.prompt));
            pieces.push(el(doc, 'p', 'nexus-stage-look-desc',
                desc ? String(desc).slice(0, 120) : 'Explore your wardrobe and try a new outfit.'));
            var actions = el(doc, 'div', 'nexus-stage-actions');
            function action(label, command, fn, disabled, pressed, primary) {
                var b = el(doc, 'button', 'nexus-stage-action' + (primary ? ' is-primary' : ''), label);
                b.type = 'button';
                b.disabled = Boolean(disabled);
                b.setAttribute('data-command', command);
                if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
                b.addEventListener('click', fn);
                actions.appendChild(b);
            }
            if (self.view.turner) {
                action(self.view.turned ? '↺ Front' : '⟳ Show back', 'turn',
                    function () { self.view.turn(); }, !look || state.busy, Boolean(self.view.turned), false);
            }
            action('⌕ Zoom', 'zoom', function () { self.zoom(); }, !look || state.busy, undefined, false);
            action(state.favorite ? '♥ Saved' : '♡ Save look', 'save',
                function () { self.view.favorite(); }, !look || state.busy, Boolean(state.favorite), false);
            action('Next look →', 'next', function () { self.view._step(1); },
                !state.looks || state.looks.length < 2 || state.busy, undefined, true);
            pieces.push(actions);
            this.info.replaceChildren.apply(this.info, pieces);
        }

        unmount() {
            if (this.view && this.view.stageExperience === this) this.view.stageExperience = null;
            if (this.preview) this.preview.classList.remove('nexus-try-on-stage-active');
            if (this.root) this.root.remove();
            if (this.badge) this.badge.remove();
            if (this.info) this.info.remove();
            if (this.legacy) {
                this.legacy.hidden = false;
                this.legacy.setAttribute('aria-modal', 'true');
            }
            this.root = null;
            this.legacy = null;
            this.list = null;
            this.editButton = null;
            this.badge = null;
            this.info = null;
            this.preview = null;
        }
    }

    var api = { TryOnStageExperience: TryOnStageExperience };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_STAGE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
