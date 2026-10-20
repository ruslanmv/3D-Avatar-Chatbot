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
            tools.appendChild(el(doc, 'span', 'nexus-look-rail-title', 'LOOKS'));
            var editor = el(doc, 'button', 'nexus-look-rail-edit', this.expanded ? 'Close' : 'Wardrobe');
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

        unmount() {
            if (this.view && this.view.stageExperience === this) this.view.stageExperience = null;
            if (this.preview) this.preview.classList.remove('nexus-try-on-stage-active');
            if (this.root) this.root.remove();
            if (this.legacy) {
                this.legacy.hidden = false;
                this.legacy.setAttribute('aria-modal', 'true');
            }
            this.root = null;
            this.legacy = null;
            this.list = null;
            this.editButton = null;
            this.preview = null;
        }
    }

    var api = { TryOnStageExperience: TryOnStageExperience };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_STAGE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
