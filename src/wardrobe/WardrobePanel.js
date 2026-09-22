(function (global) {
    'use strict';

    var ERROR_API = global.NEXUS_WARDROBE_CLIENT || {};
    var WardrobeForgeError = ERROR_API.WardrobeForgeError || Error;

    class WardrobePanel {
        constructor(options) {
            options = options || {};
            this.service = options.service;
            this.root = null;
            this.list = null;
            this.status = null;
            this.input = null;
            this.button = null;
            this.service.setStateListener(this._onState.bind(this));
        }

        mount() {
            if (global.document.getElementById('nexus-wardrobe-button')) return;
            this._injectStyles();

            this.button = global.document.createElement('button');
            this.button.id = 'nexus-wardrobe-button';
            this.button.className = 'nexus-wardrobe-button';
            this.button.type = 'button';
            this.button.textContent = '👗';
            this.button.title = 'Try-On Haul';
            this.button.setAttribute('aria-label', 'Open wardrobe');
            this.button.addEventListener('click', this.toggle.bind(this));

            this.root = global.document.createElement('aside');
            this.root.id = 'nexus-wardrobe-panel';
            this.root.className = 'nexus-wardrobe-panel';
            this.root.innerHTML =
                '<div class="nexus-wardrobe-head">' +
                '<div><strong>TRY-ON HAUL</strong><small>Wardrobe</small></div>' +
                '<button type="button" data-action="close" aria-label="Close">×</button>' +
                '</div>' +
                '<div class="nexus-wardrobe-status" aria-live="polite">Loading wardrobe…</div>' +
                '<div class="nexus-wardrobe-list"></div>' +
                (this.service.remoteEnabled
                    ? '<div class="nexus-wardrobe-generate">' +
                      '<input type="text" placeholder="Describe an outfit…" maxlength="1000" />' +
                      '<button type="button" data-action="generate">Generate</button>' +
                      '</div>'
                    : '') +
                '<div class="nexus-wardrobe-actions">' +
                '<button type="button" data-action="restore">Restore original</button>' +
                '<button type="button" data-action="refresh">Refresh</button>' +
                '</div>';

            global.document.body.appendChild(this.button);
            global.document.body.appendChild(this.root);
            this.list = this.root.querySelector('.nexus-wardrobe-list');
            this.status = this.root.querySelector('.nexus-wardrobe-status');
            this.input = this.root.querySelector('.nexus-wardrobe-generate input');

            this.root.addEventListener('click', this._handleClick.bind(this));
            this.refresh();
        }

        toggle() {
            if (!this.root) return;
            this.root.classList.toggle('is-open');
        }

        close() {
            if (this.root) this.root.classList.remove('is-open');
        }

        _setStatus(message, isError) {
            if (!this.status) return;
            this.status.textContent = message || '';
            this.status.classList.toggle('is-error', Boolean(isError));
        }

        _onState(state, event) {
            var labels = {
                queued: 'Queued…',
                validating: 'Checking avatar…',
                'analyzing-avatar': 'Measuring avatar…',
                'planning-outfit': 'Planning outfit…',
                'generating-garment': 'Generating garment…',
                fitting: 'Fitting garment…',
                skinning: 'Binding garment…',
                'resolving-clipping': 'Checking fit…',
                exporting: 'Exporting VRM…',
                'validating-output': 'Validating result…',
                'rendering-preview': 'Rendering preview…',
                completed: 'Ready',
            };
            this._setStatus(labels[state] || (event && event.message) || state || 'Working…', false);
        }

        async refresh() {
            this._setStatus('Loading wardrobe…', false);
            var looks = await this.service.listLooks();
            this.list.innerHTML = '';

            if (!looks.length) {
                this.list.innerHTML =
                    '<div class="nexus-wardrobe-empty">No looks yet. ' +
                    (this.service.remoteEnabled ? 'Describe one below.' : 'Deploy a Forge asset bundle to add looks.') +
                    '</div>';
                this._setStatus(this.service.remoteEnabled ? 'Ready to generate' : 'Static wardrobe ready', false);
                return;
            }

            looks.forEach(function (look) {
                var card = global.document.createElement('button');
                card.type = 'button';
                card.className = 'nexus-wardrobe-card';
                card.dataset.lookId = look.id || '';
                card._wardrobeLook = look;
                card.innerHTML =
                    (look.previewUrl
                        ? '<img src="' + this._escapeAttr(look.previewUrl) + '" alt="" loading="lazy" />'
                        : '<span class="nexus-wardrobe-placeholder">👗</span>') +
                    '<span><strong>' +
                    this._escapeText(look.name || 'Look') +
                    '</strong><small>' +
                    this._escapeText(look.source || '') +
                    '</small></span>';
                this.list.appendChild(card);
            }, this);
            this._setStatus(looks.length + ' look' + (looks.length === 1 ? '' : 's'), false);
        }

        async _handleClick(event) {
            var actionButton = event.target.closest('[data-action]');
            if (actionButton) {
                var action = actionButton.dataset.action;
                if (action === 'close') return this.close();
                if (action === 'refresh') return this.refresh();
                if (action === 'restore') {
                    await this.service.restore();
                    return this._setStatus('Original avatar restored', false);
                }
                if (action === 'generate') return this._generate();
            }

            var card = event.target.closest('.nexus-wardrobe-card');
            if (card && card._wardrobeLook) {
                try {
                    this._setStatus('Applying ' + (card._wardrobeLook.name || 'look') + '…', false);
                    await this.service.applyLook(card._wardrobeLook);
                    this._setStatus('Wearing ' + (card._wardrobeLook.name || 'look'), false);
                } catch (error) {
                    this._setStatus(error.message || 'Could not apply look', true);
                }
            }
        }

        async _generate() {
            var prompt = this.input && this.input.value ? this.input.value.trim() : '';
            if (!prompt) return this._setStatus('Describe an outfit first', true);

            var button = this.root.querySelector('[data-action="generate"]');
            button.disabled = true;
            try {
                var look = await this.service.generate(prompt, { apply: true });
                this.input.value = '';
                this._setStatus('Generated ' + (look.name || 'new look'), false);
                await this.refresh();
            } catch (error) {
                if (error instanceof WardrobeForgeError && error.needsLicenseAttestation) {
                    var ok = global.confirm(
                        'The avatar does not expose modification terms. Do you have permission to create a modified version?'
                    );
                    if (ok) {
                        try {
                            var attested = await this.service.generate(prompt, {
                                apply: true,
                                attestModificationAllowed: true,
                            });
                            this.input.value = '';
                            this._setStatus('Generated ' + (attested.name || 'new look'), false);
                            await this.refresh();
                            return;
                        } catch (retryError) {
                            error = retryError;
                        }
                    }
                }
                if (error instanceof WardrobeForgeError && error.modificationForbidden) {
                    this._setStatus("This avatar's terms do not allow modified versions.", true);
                } else {
                    this._setStatus(error.message || 'Generation failed', true);
                }
            } finally {
                button.disabled = false;
            }
        }

        _escapeText(value) {
            var div = global.document.createElement('div');
            div.textContent = String(value || '');
            return div.innerHTML;
        }

        _escapeAttr(value) {
            return this._escapeText(value).replace(/"/g, '&quot;');
        }

        _injectStyles() {
            if (global.document.getElementById('nexus-wardrobe-styles')) return;
            var style = global.document.createElement('style');
            style.id = 'nexus-wardrobe-styles';
            style.textContent = [
                '.nexus-wardrobe-button{position:fixed;right:18px;bottom:86px;z-index:2200;width:48px;height:48px;border-radius:50%;border:1px solid rgba(0,229,255,.45);background:rgba(6,20,28,.94);color:#fff;font-size:22px;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.35)}',
                '.nexus-wardrobe-panel{position:fixed;right:18px;bottom:146px;z-index:2199;width:min(380px,calc(100vw - 24px));max-height:70vh;display:none;flex-direction:column;background:rgba(5,18,25,.97);border:1px solid rgba(0,229,255,.28);border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.5);color:#eef;overflow:hidden}',
                '.nexus-wardrobe-panel.is-open{display:flex}',
                '.nexus-wardrobe-head,.nexus-wardrobe-actions,.nexus-wardrobe-generate{display:flex;gap:8px;align-items:center;padding:12px}',
                '.nexus-wardrobe-head{justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.08)}',
                '.nexus-wardrobe-head small{display:block;opacity:.65;font-size:11px}',
                '.nexus-wardrobe-head button{background:none;border:0;color:#fff;font-size:24px;cursor:pointer}',
                '.nexus-wardrobe-status{padding:8px 12px;font-size:12px;color:#7ee8ff}',
                '.nexus-wardrobe-status.is-error{color:#ff8d8d}',
                '.nexus-wardrobe-list{padding:8px 12px;overflow:auto;display:grid;grid-template-columns:1fr 1fr;gap:8px}',
                '.nexus-wardrobe-card{display:flex;flex-direction:column;text-align:left;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-radius:10px;color:#fff;overflow:hidden;cursor:pointer;padding:0}',
                '.nexus-wardrobe-card img,.nexus-wardrobe-placeholder{width:100%;aspect-ratio:1/1;object-fit:cover;background:rgba(255,255,255,.04);display:grid;place-items:center;font-size:32px}',
                '.nexus-wardrobe-card span:last-child{padding:8px}',
                '.nexus-wardrobe-card small{display:block;opacity:.55}',
                '.nexus-wardrobe-generate input{flex:1;min-width:0;padding:9px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:#071821;color:#fff}',
                '.nexus-wardrobe-generate button,.nexus-wardrobe-actions button{padding:9px 10px;border-radius:8px;border:1px solid rgba(0,229,255,.3);background:rgba(0,229,255,.12);color:#fff;cursor:pointer}',
                '.nexus-wardrobe-actions{border-top:1px solid rgba(255,255,255,.08)}',
                '.nexus-wardrobe-empty{grid-column:1/-1;padding:20px 8px;text-align:center;opacity:.7;font-size:13px}',
                '@media(max-width:767px){.nexus-wardrobe-button{right:12px;bottom:82px}.nexus-wardrobe-panel{right:12px;bottom:140px;max-height:64vh}}',
            ].join('');
            global.document.head.appendChild(style);
        }
    }

    global.NEXUS_WARDROBE_PANEL = WardrobePanel;
    if (typeof module !== 'undefined' && module.exports) module.exports = WardrobePanel;
})(typeof window !== 'undefined' ? window : globalThis);
