/**
 * W7. What Try-On looks like: choose looks, make one, then wear them one at a time.
 *
 * It sits exactly where the Together panel sits — the same card over the avatar on a
 * desktop, the same bottom sheet above the composer on a phone — and reuses Together's
 * own classes (`nexus-bd-together-head`, `-option`, `-cancel`, ...), so it reads as a screen
 * of Together rather than a second product. It is its own element, not a child of the
 * panel, because the panel draws only the input kinds it knows and this is additive: the
 * panel is not edited. The panel closes itself when an activity starts ("get out of the
 * way"), and this appears in its place; if the panel is reopened it is drawn over this one
 * (a lower z-index), which is the "Stop / Change" flow people already know.
 *
 * Nothing here decides anything. Choosing, stepping, keeping and ending are
 * `TryOnSession`'s; making a look is `TryOnGenerator`'s; the words are `TryOnReasons`'.
 * This file turns their state into elements and clicks back into their calls.
 *
 * Accessibility, because a haul is operated with the avatar in view and the hands busy:
 * it is a labelled modal dialog; Tab stays inside it; Escape goes back (never ends a haul
 * by surprise); ← and → step through looks while one is on; every card is a real
 * checkbox to assistive tech; progress is announced politely; motion respects
 * prefers-reduced-motion.
 *
 * Exposes: window.NEXUS_TRY_ON_VIEW
 */
(function (global) {
    'use strict';

    var ROOT_ID = 'nexus-try-on-view';
    var STYLE_ID = 'nexus-try-on-style';

    // No backticks anywhere in this stylesheet: it is a plain string.
    var CSS = [
        '#nexus-try-on-view{position:absolute;left:50%;bottom:4.6rem;transform:translateX(-50%);',
        'width:min(86%,30rem);max-height:62%;overflow-y:auto;z-index:39;padding:1.05rem 1.15rem 1rem;',
        'border-radius:14px;background:rgba(11,16,23,.94);border:1px solid rgba(34,211,238,.26);',
        'box-shadow:0 14px 40px rgba(0,0,0,.5);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);',
        'color:#e8ecf2;font-family:var(--font-sans,system-ui,sans-serif);text-align:center}',
        '#nexus-try-on-view[hidden]{display:none}',
        '#nexus-try-on-view.is-floating{position:fixed;bottom:1.2rem}',
        '.nexus-try-on-looks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem;margin:.2rem 0 .7rem;text-align:left}',
        '.nexus-try-on-card{position:relative;min-width:0;display:flex;flex-direction:column;gap:.3rem;padding:.35rem;',
        'border-radius:10px;cursor:pointer;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.09);',
        'color:#e8ecf2;font:inherit;text-align:left;transition:background .14s ease,border-color .14s ease}',
        '.nexus-try-on-card:hover{background:rgba(34,211,238,.1)}',
        '.nexus-try-on-card[aria-checked="true"]{border-color:rgba(34,211,238,.75);background:rgba(34,211,238,.13)}',
        '.nexus-try-on-card:focus-visible,.nexus-try-on-primary:focus-visible,.nexus-try-on-step:focus-visible',
        '{outline:2px solid var(--accent-cyan,#22d3ee);outline-offset:2px}',
        '.nexus-try-on-thumb{width:100%;max-width:100%;min-width:0;aspect-ratio:1/1;object-fit:cover;object-position:center 30%;border-radius:7px;display:grid;',
        'place-items:center;background:rgba(255,255,255,.05);font-size:1.6rem}',
        '.nexus-try-on-name{font-size:.74rem;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.nexus-try-on-fit{font-size:.66rem;color:#7fd6a2}.nexus-try-on-fit.is-bad{color:#e8b04a}',
        '.nexus-try-on-tick{position:absolute;top:.45rem;right:.45rem;width:1.3rem;height:1.3rem;border-radius:50%;',
        'display:grid;place-items:center;font-size:.72rem;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.3)}',
        '.nexus-try-on-card[aria-checked="true"] .nexus-try-on-tick{background:#22d3ee;color:#061018;border-color:#22d3ee}',
        '.nexus-try-on-empty{margin:.4rem 0 .8rem;font-size:.84rem;color:#a9b3c1}',
        '.nexus-try-on-create{display:grid;gap:.45rem;margin:.1rem 0 .8rem;text-align:left}',
        '.nexus-try-on-create form{display:flex;gap:.35rem}',
        '.nexus-try-on-create input{flex:1;min-width:0;padding:.55rem .7rem;border-radius:9px;',
        'border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#e8ecf2;font:inherit;font-size:.84rem}',
        '.nexus-try-on-create input:focus{outline:none;border-color:rgba(34,211,238,.7)}',
        '.nexus-try-on-steps{list-style:none;margin:0;padding:0;display:grid;gap:.2rem;font-size:.76rem;color:#a9b3c1}',
        '.nexus-try-on-steps li::before{content:"○";display:inline-block;width:1.2rem;color:#5b6575}',
        '.nexus-try-on-steps li.is-done{color:#c9d3df}.nexus-try-on-steps li.is-done::before{content:"✓";color:#7fd6a2}',
        '.nexus-try-on-steps li.is-active{color:#e8ecf2;font-weight:600}.nexus-try-on-steps li.is-active::before{content:"●";color:#22d3ee}',
        '.nexus-try-on-note{margin:.2rem 0 .6rem;font-size:.78rem;color:#a9b3c1}',
        '.nexus-try-on-error{margin:.3rem 0 .6rem;font-size:.8rem;color:#f0a38f}',
        '.nexus-try-on-primary{display:block;width:100%;padding:.72rem;border:0;border-radius:10px;cursor:pointer;',
        'background:linear-gradient(120deg,#22d3ee,#2aa7c9);color:#061018;font:700 .84rem/1 inherit;letter-spacing:.06em}',
        '.nexus-try-on-primary:disabled{opacity:.42;cursor:default}',
        '.nexus-try-on-counter{margin:.3rem 0 .15rem;font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:#7d8797}',
        '.nexus-try-on-current{margin:.1rem 0 .1rem;font-size:1.02rem;font-weight:650}',
        '.nexus-try-on-nav{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin:.8rem 0}',
        '.nexus-try-on-step{padding:.6rem;border-radius:9px;cursor:pointer;background:rgba(255,255,255,.05);',
        'border:1px solid rgba(255,255,255,.12);color:#e8ecf2;font:600 .84rem/1 inherit}',
        '.nexus-try-on-step:disabled{opacity:.42;cursor:default}',
        '.nexus-try-on-studio{display:inline-block;margin-top:.6rem;font-size:.74rem;color:#7fb7c9}',
        '.nexus-try-on-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}',
        '@media (max-width:640px){#nexus-try-on-view{position:fixed;z-index:1000;left:0;right:0;width:auto;transform:none;',
        'bottom:var(--nexus-composer-inset,calc(88px + env(safe-area-inset-bottom,0px)));',
        'max-height:min(66dvh,calc(100dvh - var(--nexus-composer-inset,88px) - 4rem));',
        'border-radius:16px 16px 0 0;border-left:none;border-right:none;border-bottom:none;',
        'padding-bottom:max(1rem,env(safe-area-inset-bottom,0px));overscroll-behavior:contain}',
        '.nexus-try-on-looks{grid-template-columns:repeat(3,minmax(0,1fr))}}',
        '@media (prefers-reduced-motion:reduce){.nexus-try-on-card{transition:none}}',
    ].join('');

    function h(doc, tag, props, children) {
        var node = doc.createElement(tag);
        Object.keys(props || {}).forEach(function (key) {
            var value = props[key];
            if (value === undefined || value === null || value === false) return;
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), value);
            else node.setAttribute(key, value === true ? '' : value);
        });
        (children || []).forEach(function (child) {
            if (child) node.appendChild(child);
        });
        return node;
    }

    class TryOnView {
        /**
         * options.doc, options.session (TryOnSession), options.generator (TryOnGenerator),
         * options.reasons (TryOnReasons), options.studioUrl, options.onClose(why)
         */
        constructor(options) {
            options = options || {};
            this.doc = options.doc || global.document;
            this.session = options.session;
            this.generator = options.generator || null;
            this.Reasons = options.reasons || global.NEXUS_TRY_ON_REASONS;
            this.studioUrl = options.studioUrl || null;
            this.onClose = options.onClose || function () {};
            this.root = null;
            this.loading = true;
            this.creating = false;
            this.progress = null;
            this.createError = null;
            this.draft = '';
            this._abort = null;
            this._onKey = this._onKey.bind(this);
        }

        mount(host) {
            if (!this.doc) return null;
            if (!this.doc.getElementById(STYLE_ID)) {
                var style = this.doc.createElement('style');
                style.id = STYLE_ID;
                style.textContent = CSS;
                (this.doc.head || this.doc.documentElement).appendChild(style);
            }
            var existing = this.doc.getElementById(ROOT_ID);
            if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
            this.root = h(this.doc, 'div', {
                id: ROOT_ID,
                role: 'dialog',
                'aria-modal': 'true',
                'aria-label': 'Try-On',
            });
            var parent = host || this.doc.body;
            if (!host) this.root.classList.add('is-floating');
            parent.appendChild(this.root);
            this.root.addEventListener('keydown', this._onKey);
            this.render();
            var first = this.root.querySelector('button:not([disabled]), input, [href]');
            if (first) first.focus();
            return this.root;
        }

        unmount() {
            if (this._abort) this._abort.abort();
            if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
            this.root = null;
        }

        setLoading(loading) {
            this.loading = Boolean(loading);
            this.render();
        }

        // ------------------------------------------------------------ render
        render() {
            if (!this.root) return;
            var state = this.session.state();
            var screen = state.phase === 'running' ? this._running(state) : this._choosing(state);
            var live = h(this.doc, 'div', { class: 'nexus-try-on-live', 'aria-live': 'polite' });
            live.textContent = this._announcement(state);
            var focusedKey =
                this.doc.activeElement && this.doc.activeElement.getAttribute
                    ? this.doc.activeElement.getAttribute('data-key')
                    : null;
            this.root.replaceChildren(screen, live);
            if (focusedKey) {
                var again = this.root.querySelector('[data-key="' + focusedKey + '"]');
                if (again) again.focus();
            }
        }

        _announcement(state) {
            if (state.error) return state.error;
            if (this.createError) return this.createError;
            if (this.creating && this.progress) return this.progress.current;
            if (state.phase === 'running' && state.look) return state.look.name;
            return '';
        }

        _header(sub) {
            var doc = this.doc;
            return [
                h(doc, 'p', { class: 'nexus-bd-together-head', text: 'TOGETHER' }),
                h(doc, 'p', { class: 'nexus-bd-together-subtitle', text: sub }),
            ];
        }

        _choosing(state) {
            var doc = this.doc;
            var self = this;
            var parts = this._header('TRY-ON HAUL');
            parts.push(h(doc, 'p', { class: 'nexus-bd-together-prompt', text: 'What should she wear?' }));

            if (this.loading) {
                parts.push(h(doc, 'p', { class: 'nexus-try-on-empty', text: 'Opening her wardrobe…' }));
            } else if (!state.looks.length) {
                parts.push(
                    h(doc, 'p', {
                        class: 'nexus-try-on-empty',
                        text: 'No looks for her yet. Create one below, or add a wardrobe bundle.',
                    })
                );
            } else {
                parts.push(
                    h(
                        doc,
                        'div',
                        { class: 'nexus-try-on-looks', role: 'group', 'aria-label': 'Her looks' },
                        state.looks.map(function (look) {
                            return self._card(look, state.chosen.indexOf(self._key(look)) !== -1);
                        })
                    )
                );
            }

            parts.push(this._create());
            if (state.error) parts.push(h(doc, 'p', { class: 'nexus-try-on-error', role: 'alert', text: state.error }));
            parts.push(
                h(doc, 'p', {
                    class: 'nexus-try-on-note',
                    text: state.chosen.length
                        ? 'Chosen for the haul: ' + state.chosen.length
                        : 'Tap looks to choose them.',
                })
            );
            parts.push(
                h(doc, 'button', {
                    type: 'button',
                    class: 'nexus-try-on-primary',
                    'data-key': 'start',
                    disabled: !state.chosen.length || this.creating,
                    text: 'START TRY-ON HAUL',
                    onclick: function () {
                        self.session.start().then(function () {
                            self.render();
                        });
                    },
                })
            );
            if (this.studioUrl) {
                parts.push(
                    h(doc, 'a', {
                        class: 'nexus-try-on-studio',
                        href: this.studioUrl,
                        target: '_blank',
                        rel: 'noopener',
                        text: 'Open Wardrobe Studio ↗',
                    })
                );
            }
            parts.push(
                h(doc, 'button', {
                    type: 'button',
                    class: 'nexus-bd-together-cancel',
                    'data-key': 'back',
                    text: 'Back',
                    onclick: function () {
                        self.close('back');
                    },
                })
            );
            return h(doc, 'div', {}, parts);
        }

        _key(look) {
            return (look && (look.id || look.vrmUrl)) || '';
        }

        _card(look, chosen) {
            var doc = this.doc;
            var self = this;
            var key = this._key(look);
            var thumb = look.previewUrl
                ? h(doc, 'img', { class: 'nexus-try-on-thumb', src: look.previewUrl, alt: '', loading: 'lazy' })
                : h(doc, 'span', { class: 'nexus-try-on-thumb', 'aria-hidden': 'true', text: '👗' });
            var fit =
                look.fitPassed === true
                    ? h(doc, 'span', { class: 'nexus-try-on-fit', text: '✓ fit passed' })
                    : look.fitPassed === false
                      ? h(doc, 'span', { class: 'nexus-try-on-fit is-bad', text: 'fit needs work' })
                      : null;
            return h(
                doc,
                'button',
                {
                    type: 'button',
                    role: 'checkbox',
                    class: 'nexus-try-on-card',
                    'aria-checked': chosen ? 'true' : 'false',
                    'data-key': 'look:' + key,
                    title: look.prompt || look.name || '',
                    onclick: function () {
                        self.session.toggle(key);
                        self.render();
                    },
                },
                [
                    thumb,
                    h(doc, 'span', { class: 'nexus-try-on-tick', 'aria-hidden': 'true', text: chosen ? '✓' : '' }),
                    h(doc, 'span', { class: 'nexus-try-on-name', text: look.name || 'Look' }),
                    fit,
                ]
            );
        }

        _create() {
            var doc = this.doc;
            var self = this;
            var availability = this.generator ? this.generator.availability() : { ok: false, why: '' };
            var box = h(doc, 'div', { class: 'nexus-try-on-create' });
            if (!availability.ok) {
                if (availability.why)
                    box.appendChild(h(doc, 'p', { class: 'nexus-try-on-note', text: availability.why }));
                return box;
            }
            var input = h(doc, 'input', {
                type: 'text',
                maxlength: '300',
                'data-key': 'prompt',
                'aria-label': 'Describe her next look',
                placeholder: '+ Create a new look, e.g. black satin cocktail dress',
                disabled: this.creating,
            });
            input.value = this.draft;
            input.addEventListener('input', function () {
                self.draft = input.value;
            });
            var form = h(
                doc,
                'form',
                {
                    onsubmit: function (event) {
                        event.preventDefault();
                        self.create(input.value);
                    },
                },
                [
                    input,
                    this.creating
                        ? h(doc, 'button', {
                              type: 'button',
                              class: 'nexus-bd-together-option is-stop',
                              'data-key': 'cancel-create',
                              text: 'Cancel',
                              onclick: function () {
                                  if (self._abort) self._abort.abort();
                              },
                          })
                        : h(doc, 'button', {
                              type: 'submit',
                              class: 'nexus-bd-together-option',
                              'data-key': 'generate',
                              text: 'Generate',
                          }),
                ]
            );
            box.appendChild(form);
            if (this.creating && this.progress) {
                box.appendChild(
                    h(
                        doc,
                        'ul',
                        { class: 'nexus-try-on-steps', 'aria-label': 'Progress' },
                        this.progress.steps.map(function (step) {
                            return h(doc, 'li', { class: 'is-' + step.status, text: step.label });
                        })
                    )
                );
            }
            if (this.createError) {
                box.appendChild(h(doc, 'p', { class: 'nexus-try-on-error', role: 'alert', text: this.createError }));
            }
            return box;
        }

        _running(state) {
            var doc = this.doc;
            var self = this;
            var look = state.going || state.look || {};
            var parts = this._header('TRY-ON HAUL');
            parts.push(
                h(doc, 'p', {
                    class: 'nexus-try-on-counter',
                    text: 'Look ' + (state.target + 1) + ' of ' + state.total + (state.busy ? ' · putting it on…' : ''),
                })
            );
            parts.push(h(doc, 'p', { class: 'nexus-try-on-current', text: look.name || 'Look' }));
            if (look.fitPassed === true) parts.push(h(doc, 'p', { class: 'nexus-try-on-fit', text: '✓ Fit passed' }));
            if (look.fitPassed === false) {
                parts.push(h(doc, 'p', { class: 'nexus-try-on-fit is-bad', text: 'Fit needs work' }));
            }
            if (state.error) parts.push(h(doc, 'p', { class: 'nexus-try-on-error', role: 'alert', text: state.error }));
            var single = state.total < 2;
            parts.push(
                h(doc, 'div', { class: 'nexus-try-on-nav' }, [
                    h(doc, 'button', {
                        type: 'button',
                        class: 'nexus-try-on-step',
                        'data-key': 'previous',
                        disabled: single,
                        'aria-label': 'Previous look',
                        text: '‹ Previous',
                        onclick: function () {
                            self._step(-1);
                        },
                    }),
                    h(doc, 'button', {
                        type: 'button',
                        class: 'nexus-try-on-step',
                        'data-key': 'next',
                        disabled: single,
                        'aria-label': 'Next look',
                        text: 'Next ›',
                        onclick: function () {
                            self._step(1);
                        },
                    }),
                ])
            );
            parts.push(
                h(doc, 'button', {
                    type: 'button',
                    class: 'nexus-try-on-primary',
                    'data-key': 'keep',
                    text: 'KEEP THIS LOOK',
                    onclick: function () {
                        self.session.keep().then(function () {
                            self.close('kept');
                        });
                    },
                })
            );
            parts.push(
                h(doc, 'button', {
                    type: 'button',
                    class: 'nexus-bd-together-cancel',
                    'data-key': 'end',
                    text: 'End & restore original',
                    onclick: function () {
                        self.close('ended');
                    },
                })
            );
            return h(doc, 'div', {}, parts);
        }

        // ------------------------------------------------------------ actions
        _step(delta) {
            var self = this;
            var move = delta > 0 ? this.session.next() : this.session.previous();
            this.render();
            return Promise.resolve(move).then(function () {
                self.render();
            });
        }

        async create(prompt) {
            if (this.creating || !this.generator) return null;
            this.creating = true;
            this.createError = null;
            this.progress = this.Reasons ? this.Reasons.progress('queued') : null;
            this._abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
            this.render();
            try {
                var look = await this.generator.create(prompt, {
                    signal: this._abort ? this._abort.signal : undefined,
                    onProgress: function (progress) {
                        this.progress = progress;
                        this.render();
                    }.bind(this),
                });
                this.session.add(look);
                this.draft = '';
                return look;
            } catch (error) {
                this.createError =
                    error && error.name === 'AbortError'
                        ? 'Stopped. Her outfit is unchanged.'
                        : (error && error.message) || 'That look could not be made.';
                return null;
            } finally {
                this.creating = false;
                this._abort = null;
                this.render();
            }
        }

        close(why) {
            this.onClose(why || 'closed');
        }

        _onKey(event) {
            var running = this.session.state().phase === 'running';
            if (event.key === 'Escape') {
                event.preventDefault();
                if (!running) this.close('back'); // never ends a haul by surprise
                return;
            }
            var typing = event.target && event.target.tagName === 'INPUT';
            if (running && !typing && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
                event.preventDefault();
                this._step(event.key === 'ArrowRight' ? 1 : -1);
                return;
            }
            if (event.key === 'Tab') {
                var focusable = Array.prototype.slice.call(
                    this.root.querySelectorAll('button:not([disabled]), input:not([disabled]), [href]')
                );
                if (!focusable.length) return;
                var first = focusable[0];
                var last = focusable[focusable.length - 1];
                if (event.shiftKey && this.doc.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && this.doc.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        }
    }

    var api = { TryOnView: TryOnView, ROOT_ID: ROOT_ID };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_VIEW = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
