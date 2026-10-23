/**
 * Forge garment picker. Lives in the existing conversation workspace on desktop,
 * in a bottom sheet on mobile. NEVER changes WebGL viewport/camera/canvas, and
 * NEVER applies a new avatar before TryOnView's validated generation completes.
 */
(function (global) {
    'use strict';

    var STYLE_ID = 'nexus-forge-catalog-styles';
    var CSS = [
        '.nexus-catalog-host{position:relative!important}',
        '.nexus-catalog-overlay{position:absolute;z-index:80;inset:0;display:flex;flex-direction:column;',
        'gap:12px;padding:18px;background:#041624;color:#e6f5f9;font:500 14px/1.4 system-ui;',
        'overflow:hidden;border-radius:16px}',
        '.nexus-catalog-header{display:flex;align-items:start;justify-content:space-between;gap:10px}',
        '.nexus-catalog-header h2{margin:0;font-size:19px;line-height:1.3}',
        '.nexus-catalog-muted{margin:3px 0 0;color:#9ab5c0;font-size:12px}',
        '.nexus-catalog-cats{display:flex;gap:6px;overflow:auto;flex-shrink:0;scrollbar-width:thin}',
        '.nexus-catalog-overlay button{font:inherit;cursor:pointer;touch-action:manipulation}',
        '.nexus-catalog-button{min-height:42px;border:1px solid #246779;border-radius:10px;',
        'color:#d9f5f8;background:#0b2938;padding:8px 12px;flex-shrink:0}',
        '.nexus-catalog-button[aria-pressed="true"]{border-color:#12d9ec;background:#075669}',
        '.nexus-catalog-button:focus-visible{outline:2px solid #1edff6;outline-offset:2px}',
        '.nexus-catalog-button:disabled{opacity:.5;cursor:not-allowed}',
        '.nexus-catalog-main{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}',
        '.nexus-catalog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));',
        'gap:9px;padding:2px 2px 10px}',
        '.nexus-catalog-card{display:flex;flex-direction:column;gap:4px;text-align:left;',
        'border:1px solid #1d5263;border-radius:12px;padding:8px;color:#d7eff6;',
        'background:#091f31;min-height:158px;min-width:0}',
        '.nexus-catalog-card[aria-pressed="true"]{border-color:#10e2f1;',
        'box-shadow:0 0 0 1px #13cce0 inset}',
        '.nexus-catalog-image{display:block;object-fit:contain;width:100%;height:116px;',
        'background:#101925;border-radius:8px}',
        '.nexus-catalog-placeholder{display:grid;place-items:center;min-height:116px;',
        'background:#0e2634;border-radius:8px;color:#99b8c5;font-size:11px;text-align:center}',
        '.nexus-catalog-name{font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis}',
        '.nexus-catalog-detail{flex-shrink:0;border:1px solid #1d5263;border-radius:12px;',
        'padding:10px;display:grid;gap:8px;background:#072232}',
        '.nexus-catalog-swatches{display:flex;gap:9px;align-items:center;flex-wrap:wrap}',
        '.nexus-catalog-swatch{width:32px;height:32px;min-height:32px;border-radius:50%;',
        'border:2px solid #47758a;box-shadow:0 0 0 2px #071b2b;cursor:pointer}',
        '.nexus-catalog-swatch[aria-pressed="true"]{outline:2px solid #00d8ef;outline-offset:3px}',
        '.nexus-catalog-actions{display:flex;gap:8px}',
        '.nexus-catalog-primary{background:#0fd6e9;color:#032231;border-color:#08ddea;',
        'font-weight:800;flex:1}',
        '.nexus-catalog-error{color:#ffd5b9;font-size:12px}',
        '@media(max-width:760px){.nexus-catalog-overlay{position:fixed;z-index:700;',
        'inset:auto 0 0;min-height:40dvh;max-height:72dvh;padding:12px;',
        'padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));',
        'border:1px solid #166276;border-radius:20px 20px 0 0;',
        'box-shadow:0 -18px 36px #000b}',
        '.nexus-catalog-grid{grid-template-columns:repeat(2,minmax(0,1fr))}',
        '.nexus-catalog-image,.nexus-catalog-placeholder{height:125px}',
        '.nexus-catalog-detail{padding:8px}',
        '}',
    ].join('');

    function node(doc, tag, klass, label) {
        var el = doc.createElement(tag);
        if (klass) el.className = klass;
        if (label !== undefined) el.textContent = label;
        return el;
    }

    class ForgeGarmentCatalogWorkspace {
        constructor(options) {
            options = options || {};
            this.doc = options.doc || global.document;
            this.view = options.view;
            this.client = options.client;
            this.onState = options.onState || function () {};
            this.onAdvanced = options.onAdvanced || function () {};
            this.categories = [];
            this.category = null;
            this.selected = null;
            this.color = 'black';
            this.busy = false;
            this.loaded = false;
            this.error = '';
        }

        async open() {
            if (this.opened) return;
            var doc = this.doc;
            var host = doc && doc.querySelector('.chat-panel .chat-card');
            if (!doc || !host) return false;
            if (!doc.getElementById(STYLE_ID)) {
                var style = node(doc, 'style');
                style.id = STYLE_ID;
                style.textContent = CSS;
                (doc.head || doc.documentElement).appendChild(style);
            }
            this.host = host;
            this.host.classList.add('nexus-catalog-host');
            this.overlay = node(doc, 'section', 'nexus-catalog-overlay');
            this.overlay.setAttribute('role', 'dialog');
            this.overlay.setAttribute('aria-label', 'Customize this look');
            this.host.appendChild(this.overlay);
            this.opened = true;
            this.onState(true);
            this.render();
            if (!this.loaded && this.client) {
                try {
                    var response = await this.client.getGarmentCatalog();
                    if (!this.opened) return true;
                    this.categories = (response && response.categories) || [];
                    this.category = this.categories.length ? this.categories[0].id : null;
                    this.loaded = true;
                    this.error = '';
                } catch (error) {
                    this.error = (error && error.message) || 'Could not load garments from Forge.';
                }
                if (this.opened) this.render();
            }
            return true;
        }

        close() {
            if (!this.opened || this.busy) return;
            this.opened = false;
            if (this.overlay) this.overlay.remove();
            if (this.host) this.host.classList.remove('nexus-catalog-host');
            this.overlay = null;
            this.host = null;
            this.onState(false);
        }

        destroy() {
            this.busy = false;
            this.close();
            // Teardown is always allowed, even if a generation request is underway.
            if (this.overlay) this.overlay.remove();
            if (this.host) this.host.classList.remove('nexus-catalog-host');
            this.opened = false;
            this.overlay = null;
            this.host = null;
        }

        select(item) {
            this.selected = item;
            this.color = 'black';
            this.render();
        }

        button(label, callback, active, extra) {
            var button = node(this.doc, 'button', 'nexus-catalog-button' + (extra || ''), label);
            button.type = 'button';
            if (active !== undefined) button.setAttribute('aria-pressed', String(Boolean(active)));
            button.disabled = this.busy;
            button.addEventListener('click', callback);
            return button;
        }

        render() {
            if (!this.overlay) return;
            var self = this;
            var doc = this.doc;
            var header = node(doc, 'header', 'nexus-catalog-header');
            var title = node(doc, 'div');
            title.appendChild(node(doc, 'h2', '', 'Customize This Look'));
            title.appendChild(node(doc, 'p', 'nexus-catalog-muted', 'Real Forge garments · choose before applying'));
            header.appendChild(title);
            header.appendChild(
                this.button('Close ×', function () {
                    self.close();
                })
            );
            var tabs = node(doc, 'nav', 'nexus-catalog-cats');
            tabs.setAttribute('aria-label', 'Garment category');
            this.categories.forEach(function (group) {
                tabs.appendChild(
                    self.button(
                        group.label + ' (' + group.count + ')',
                        function () {
                            self.category = group.id;
                            self.selected = null;
                            self.render();
                        },
                        self.category === group.id
                    )
                );
            });
            var main = node(doc, 'div', 'nexus-catalog-main');
            var grid = node(doc, 'div', 'nexus-catalog-grid');
            var current = this.categories.find(function (g) {
                return g.id === self.category;
            });
            ((current && current.garments) || []).forEach(function (item) {
                var card = node(doc, 'button', 'nexus-catalog-card');
                card.type = 'button';
                card.disabled = self.busy;
                card.setAttribute('aria-pressed', String(Boolean(self.selected && self.selected.id === item.id)));
                card.setAttribute('aria-label', 'Select ' + item.name);
                if (item.previewStatus === 'ready' && item.previewUrl) {
                    var image = node(doc, 'img', 'nexus-catalog-image');
                    image.src = self.client.resolveUrl(item.previewUrl);
                    image.alt = item.name + ' preview on reference avatar';
                    image.loading = 'lazy';
                    card.appendChild(image);
                } else {
                    card.appendChild(node(doc, 'span', 'nexus-catalog-placeholder', 'Preview not ready'));
                }
                card.appendChild(node(doc, 'span', 'nexus-catalog-name', item.name));
                card.addEventListener('click', function () {
                    self.select(item);
                });
                grid.appendChild(card);
            });
            main.appendChild(grid);
            if (!this.client) main.appendChild(node(doc, 'p', 'nexus-catalog-error', 'Wardrobe Forge is unavailable.'));
            else if (!this.loaded && !this.error)
                main.appendChild(node(doc, 'p', 'nexus-catalog-muted', 'Loading garments…'));
            else if (this.loaded && !this.categories.length)
                main.appendChild(node(doc, 'p', 'nexus-catalog-muted', 'No public garments available.'));
            var foot = node(doc, 'div', 'nexus-catalog-detail');
            if (this.selected) {
                foot.appendChild(node(doc, 'strong', '', this.selected.name));
                if (this.selected.supportsColor) {
                    var colors = node(doc, 'div', 'nexus-catalog-swatches');
                    ['black', 'white', 'red', 'blue', 'beige'].forEach(function (name) {
                        var swatch = node(doc, 'button', 'nexus-catalog-swatch');
                        swatch.type = 'button';
                        swatch.style.backgroundColor = name;
                        swatch.title = name;
                        swatch.setAttribute('aria-label', name);
                        swatch.setAttribute('aria-pressed', String(self.color === name));
                        swatch.disabled = self.busy;
                        swatch.addEventListener('click', function () {
                            self.color = name;
                            self.render();
                        });
                        colors.appendChild(swatch);
                    });
                    foot.appendChild(colors);
                }
            } else {
                foot.appendChild(node(doc, 'p', 'nexus-catalog-muted', 'Select one real garment to propose a change.'));
            }
            if (this.error) foot.appendChild(node(doc, 'p', 'nexus-catalog-error', this.error));
            var actions = node(doc, 'div', 'nexus-catalog-actions');
            var apply = this.button(
                this.busy ? 'Generating…' : 'Apply garment',
                function () {
                    self.apply();
                },
                undefined,
                ' nexus-catalog-primary'
            );
            apply.disabled = !this.selected || this.busy || !this.view || !this.view.generator;
            actions.appendChild(apply);
            actions.appendChild(
                this.button('Advanced', function () {
                    self.close();
                    self.onAdvanced();
                })
            );
            foot.appendChild(actions);
            this.overlay.replaceChildren(header, tabs, main, foot);
        }

        async apply() {
            if (!this.selected || this.busy || !this.view) return;
            if (!this.view.generator || !this.view.generator.availability().ok) {
                this.error = 'Garment creation is not available for this avatar.';
                this.render();
                return;
            }
            var current = this.view.session.state().look;
            var intent = this.view.Intent;
            var canBuild = current && intent && intent.buildable && intent.buildable(current);
            this.busy = true;
            this.error = '';
            this.render();
            try {
                var garment = this.selected;
                var text = (garment.supportsColor ? this.color + ' ' : '') + garment.name;
                var made = await this.view.create({
                    prompt: text,
                    templateId: garment.id,
                    color: garment.supportsColor ? this.color : undefined,
                    mode: canBuild ? 'change' : 'fresh',
                    slot: garment.category,
                    baseLookId: canBuild ? String(current.id) : null,
                });
                if (made) {
                    this.busy = false;
                    this.close();
                    return;
                }
                this.error = this.view.createError || 'This garment could not be applied. Your look was kept.';
            } catch (error) {
                this.error = (error && error.message) || 'Unable to apply that garment.';
            }
            this.busy = false;
            this.render();
        }
    }

    var api = { ForgeGarmentCatalogWorkspace: ForgeGarmentCatalogWorkspace };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_FORGE_GARMENT_CATALOG = api;
})(typeof window !== 'undefined' ? window : globalThis);
