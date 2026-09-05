/**
 * TogetherLauncher — the way in (batch B30).
 *
 * Every activity this plan built has been reachable only from a console call. This is the
 * button, and it is deliberately the smallest thing that could be one: it finds the avatar
 * toolbar, inserts one pill, opens the panel, and reflects what the panel says back.
 *
 * ## What it must not do
 *
 * It does not capture, does not touch the rig, does not choose an animation, does not talk
 * to HomePilot, does not request a permission, does not start MediaPipe and does not own
 * activity state. Every one of those belongs to something that already exists, and a
 * launcher that grew any of them would be a second orchestration layer wearing a button.
 * A test greps this file for each of them.
 *
 * ## Additive, in the sense the plan means
 *
 * `index.html` is not touched. The button is inserted before `.avatar-footer-right` and the
 * drawer entry appended to the EXPERIENCE group — the same self-injection `CompanionMode`
 * uses for its own 🪟 and 📞 controls, which is the repo's own precedent for exactly this.
 * The stylesheet is injected too, so no existing CSS moves either. `detach()` removes all
 * three and the DOM is byte-identical to a build where the flag was never on.
 *
 * ## Three surfaces, one launcher
 *
 * Desktop gets an overlay across the lower half of the avatar viewport — never over her
 * face. Mobile gets the same panel as a bottom sheet, by media query rather than a second
 * implementation. **VR gets neither**, because in an immersive session the DOM is not on
 * screen at all: there the chooser is drawn by B20's `PanelRenderer` onto the virtual
 * screen, which is the entire reason that renderer draws to a canvas texture rather than to
 * DOM. Selection there comes from B26's `voice:final` — saying "watch" is a better fit for
 * a headset than a raycast at a menu, and it needs no new pointer code.
 *
 * ## Keyboard and focus (B32)
 *
 * The chooser is a menu over the page, so it behaves like one: Escape closes it, a click
 * outside closes it, focus moves to the first tile when it opens and **returns to the
 * button** when it shuts. Without that last part a keyboard user is dropped at the top of
 * the document every time they dismiss it, which is the single most common way a home-grown
 * overlay fails an audit.
 *
 * Focus is trapped while it is open — Tab from the last control wraps to the first — because
 * a menu you can Tab out of but not see is worse than one that holds you. Escape is always
 * the way out, and it never stops a running activity: dismissing and leaving stay different.
 *
 * Exposes: window.NEXUS_BD_TOGETHER_LAUNCHER
 */
const TogetherLauncher = (() => {
    'use strict';

    const BUTTON_ID = 'nexus-bd-together-launcher';
    /** The panel this button controls. Matches `TogetherPanel.PANEL_ID`; a test pins them. */
    const PANEL_ID = 'nexus-bd-together-panel';
    const DRAWER_ID = 'nexus-bd-together-drawer-item';
    const STYLE_ID = 'nexus-bd-together-style';
    const OVERLAY_HOST = '.avatar-card';
    const TOOLBAR = '.avatar-footer-actions';
    const TOOLBAR_RIGHT = '.avatar-footer-right';
    const COMPANION_BUTTON = '#companion-mode-btn';

    /** The drawer's EXPERIENCE group, found by its own label rather than by position. */
    const DRAWER_GROUP_LABEL = 'EXPERIENCE';

    const SVG_NS = 'http://www.w3.org/2000/svg';

    /**
     * Two people — the glyph every major icon set spells "group": SF Symbols `person.2`,
     * Material `group`, Fluent `people`, Font Awesome `user-group`, Lucide `UsersRound`.
     *
     * Drawn rather than typed. An emoji renders as a different picture on every platform
     * and often in full colour, which would make this the one control in the row that does
     * not follow the app's cyan; an outlined path inherits `currentColor` and so changes
     * with the button's state for free.
     *
     * It also earns its meaning from the button beside it: the footer already uses one
     * person for "avatar identity", so two people read as "together" without anyone having
     * to learn a house symbol first. That is the whole argument for the convention — the
     * user has met it in every other application they own.
     */
    const ICON_PATHS = [
        ['circle', { cx: 9, cy: 8, r: 3 }],
        ['path', { d: 'M3.5 19c0-3 2.4-5.5 5.5-5.5S14.5 16 14.5 19' }],
        ['circle', { cx: 16.5, cy: 9, r: 2.5 }],
        ['path', { d: 'M15 14.5c3.2-.5 5.5 1.5 5.5 4.5' }],
    ];

    /** The icon as a real SVG element — `createElementNS`, so it is not an inert HTML tag. */
    function groupIcon(doc, size) {
        const svg = doc.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.8');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        // The button carries the name; the picture repeating it is one more thing to hear.
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.classList.add('nexus-bd-together-mark');
        for (const [tag, attrs] of ICON_PATHS) {
            const node = doc.createElementNS(SVG_NS, tag);
            for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
            svg.appendChild(node);
        }
        return svg;
    }

    /** What a screen reader and a tooltip say, which is the only place the state has words. */
    function buttonName(runningTitle) {
        return runningTitle ? `Together — ${runningTitle} running` : 'Together — watch, listen, focus or move with her';
    }

    /**
     * Namespaced to the last rule. The app's own glass/cyan language, borrowed through its
     * variables where they exist and with literal fallbacks where they do not, so the panel
     * looks native without depending on a token this file cannot see.
     */
    const CSS = `
/* The geometry of .emotion-trigger, restated rather than borrowed: this file must not
   depend on a class it does not own, and a 38px square is what makes the new control
   disappear into the row instead of announcing itself. */
#${BUTTON_ID} {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center;
  /* Exactly the square its neighbours are. B36 added a 44px minimum size for the touch
     target and made the control render 44x44 in a row of 38x38 buttons - measurably the odd
     one out, which is the opposite of "disappears into the row". The target is restored
     below by a pseudo-element, which costs no layout. */
  width: 38px; height: 38px; padding: 0;
  flex: 0 0 38px;
  border-radius: var(--border-radius-sm, 8px); cursor: pointer;
  color: var(--accent-cyan, #22d3ee);
  background: rgba(0, 0, 0, .3);
  border: 1px solid var(--glass-border, rgba(34, 211, 238, .28));
  transition: background .16s ease, border-color .16s ease, color .16s ease;
}
/* 44px of target around 38px of paint. Apple asks for 44pt and Android for 48dp; an
   absolutely-positioned child grows the hit area without growing the box, so the button
   still measures 38x38 beside its neighbours. A child of the button *is* the button as far
   as a click is concerned. */
#${BUTTON_ID}::before {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: inherit;
}

#${BUTTON_ID}:hover { background: rgba(34, 211, 238, .12); border-color: var(--primary, #22d3ee); }
#${BUTTON_ID}:focus-visible { outline: 2px solid var(--accent-cyan, #22d3ee); outline-offset: 2px; }
#${BUTTON_ID}[data-state='open'] { background: rgba(34, 211, 238, .16); border-color: var(--primary, #22d3ee); }
#${BUTTON_ID}[data-state='running'] { color: #34d399; background: rgba(52, 211, 153, .12); border-color: rgba(52, 211, 153, .5); }
/* Running is a dot, not a second glyph: the icon has to stay the same picture, or the
   button stops being recognisable at the moment it matters most. */
#${BUTTON_ID}[data-state='running']::after {
  content: ''; position: absolute; top: 4px; right: 4px;
  width: 6px; height: 6px; border-radius: 50%; background: #34d399;
}
#${BUTTON_ID} .nexus-bd-together-mark { display: block; }

#nexus-bd-together-panel {
  position: absolute; left: 50%; bottom: 4.6rem; transform: translateX(-50%);
  width: min(78%, 27rem); max-height: 52%; overflow-y: auto; z-index: 40;
  padding: 1.05rem 1.15rem 1rem; border-radius: 14px;
  background: rgba(11, 16, 23, .93);
  border: 1px solid rgba(34, 211, 238, .26);
  box-shadow: 0 14px 40px rgba(0, 0, 0, .5);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  color: #e8ecf2; font-family: var(--font-sans, system-ui, sans-serif);
}
#nexus-bd-together-panel[hidden] { display: none; }
.nexus-bd-together-head {
  margin: 0 0 .1rem; font-size: .66rem; font-weight: 700; letter-spacing: .16em;
  color: var(--accent-cyan, #22d3ee);
}
.nexus-bd-together-subtitle { margin: 0 0 .1rem; font-size: .82rem; font-weight: 600; letter-spacing: .06em; }
.nexus-bd-together-prompt { margin: .35rem 0 .85rem; font-size: .84rem; color: #a9b3c1; }
.nexus-bd-together-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; }
.nexus-bd-together-tile {
  display: flex; flex-direction: column; align-items: center; gap: .32rem;
  padding: .7rem .3rem; border-radius: 10px; cursor: pointer;
  background: rgba(255, 255, 255, .045); border: 1px solid rgba(255, 255, 255, .09);
  color: #e8ecf2; font: inherit; transition: background .14s ease, border-color .14s ease;
}
.nexus-bd-together-tile:hover { background: rgba(34, 211, 238, .13); border-color: rgba(34, 211, 238, .4); }
.nexus-bd-together-tile:focus-visible { outline: 2px solid var(--accent-cyan, #22d3ee); outline-offset: 2px; }
.nexus-bd-together-tile.is-wide { grid-column: 1 / -1; flex-direction: row; justify-content: center; gap: .5rem; }
.nexus-bd-together-icon { font-size: 1.32rem; line-height: 1; }
.nexus-bd-together-name { font-size: .74rem; letter-spacing: .03em; }
.nexus-bd-together-options { display: flex; flex-direction: column; gap: .45rem; }
.nexus-bd-together-option {
  padding: .6rem .8rem; border-radius: 9px; cursor: pointer; text-align: left;
  background: rgba(34, 211, 238, .1); border: 1px solid rgba(34, 211, 238, .32);
  color: #e8ecf2; font: 500 .82rem/1.2 inherit;
}
.nexus-bd-together-option:hover { background: rgba(34, 211, 238, .19); }
.nexus-bd-together-option.is-stop { background: rgba(224, 121, 106, .12); border-color: rgba(224, 121, 106, .4); }
.nexus-bd-together-cancel {
  display: block; width: 100%; margin-top: .8rem; padding: .5rem;
  background: none; border: none; cursor: pointer;
  color: #7d8797; font: 500 .76rem/1 inherit; letter-spacing: .04em;
}
.nexus-bd-together-cancel:hover { color: #e8ecf2; }

/* B36 added the "More together" disclosure and no rule for it, so it rendered as a browser
   default button — a white box with black text in a dark panel. It is a quiet disclosure,
   not a call to action: the four tiles above it are the answer for almost everybody. */
.nexus-bd-together-more {
  display: block; width: 100%; margin-top: .55rem; padding: .5rem;
  background: rgba(255,255,255,.03); cursor: pointer;
  border: 1px solid rgba(255,255,255,.08); border-radius: 10px;
  color: #9aa6b8; font: 500 .76rem/1 inherit; letter-spacing: .03em;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}
.nexus-bd-together-more:hover {
  background: rgba(34,211,238,.1); border-color: rgba(34,211,238,.32); color: #e8ecf2;
}
.nexus-bd-together-more:focus-visible {
  outline: 2px solid var(--accent-cyan, #22d3ee); outline-offset: 2px;
}

/* The rest of B36's controls, which the standing check above found unstyled too. */
.nexus-bd-together-steps {
  display: block; width: 100%; margin: .5rem 0 .1rem; padding: .5rem .6rem;
  background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.1); border-radius: 10px;
  color: #e8ecf2; font: 400 .76rem/1.45 inherit; resize: vertical;
}
.nexus-bd-together-steps::placeholder { color: #6b7686; }
.nexus-bd-together-steps:focus-visible {
  outline: none; border-color: var(--accent-cyan, #22d3ee);
}
/* The sentence under an option — "Your screen stops sharing when you leave Watch". */
.nexus-bd-together-note {
  display: block; margin-top: .25rem;
  color: #7d8797; font: 400 .68rem/1.35 inherit; letter-spacing: 0;
}
/* What is being captured, kept separate from what is running (§2a). */
.nexus-bd-together-sharing {
  margin: .35rem 0 0; color: #9aa6b8; font: 400 .7rem/1.4 inherit;
}

@media (max-width: 640px) {
  /* A floating card over a narrow avatar is unusable, so the same panel becomes a sheet. */
  #nexus-bd-together-panel {
    left: 0; right: 0; bottom: 0; width: auto; max-height: 62%; transform: none;
    border-radius: 16px 16px 0 0; border-left: none; border-right: none; border-bottom: none;
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
  }
  .nexus-bd-together-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  #${BUTTON_ID}, .nexus-bd-together-tile { transition: none; }
}`;

    class Launcher {
        constructor({ panel, doc, viewer, panels } = {}) {
            this.id = 'togetherLauncher';
            this.label = 'Together launcher';

            this.panel = panel || null;
            this.doc = doc || (typeof document !== 'undefined' ? document : null);
            this.viewer = viewer === undefined ? (typeof window !== 'undefined' ? window.NEXUS_VIEWER : null) : viewer;
            this.panels = panels || null;

            this.button = null;
            this.drawerItem = null;
            this.style = null;
            this.opens = 0;
            this._unsubscribe = null;
            this._onKey = (event) => this._key(event);
            this._onPointer = (event) => this._pointer(event);
            this._bound = false;
        }

        get name() {
            return 'TogetherLauncher';
        }

        /** In an immersive session the DOM is not on screen — see the header. */
        get inXR() {
            const v = this.viewer;
            return Boolean(v && ((v.xrSupport && v.xrSupport.isPresenting) || v.isPresenting));
        }

        // ── mounting ─────────────────────────────────────────────────────────

        attach() {
            if (!this.doc || !this.panel) return this;
            this._injectStyle();
            this._injectButton();
            this._injectDrawerItem();
            this._mountPanel();
            if (typeof this.panel.onChange === 'function') {
                this._unsubscribe = this.panel.onChange((snapshot) => {
                    this._reflect();
                    this._listen(snapshot.open);
                });
            }
            this._reflect();
            return this;
        }

        _injectStyle() {
            if (this.doc.getElementById(STYLE_ID)) return null;
            const style = this.doc.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            this.doc.head.appendChild(style);
            this.style = style;
            return style;
        }

        /**
         * One icon button, before the select group — `CompanionMode`'s own insertion point,
         * and the same 38×38 square as the 🎯 🎭 👤 🪟 📞 beside it.
         *
         * B34 dropped the `✦ TOGETHER` pill this shipped as. A wider, lettered control was
         * defensible while the icon was a house symbol nobody had met, but it made the one
         * new button the loudest thing in a row of five, and the label was the reason it
         * needed a media query to survive a narrow avatar. Two people is a glyph users have
         * already learned somewhere else, so the word is redundant, and without it the
         * control is simply another member of the row.
         */
        _injectButton() {
            const toolbar = this.doc.querySelector(TOOLBAR);
            if (!toolbar || this.doc.getElementById(BUTTON_ID)) return null;

            const b = this.doc.createElement('button');
            b.id = BUTTON_ID;
            b.type = 'button';
            b.title = buttonName(null);
            b.setAttribute('aria-label', b.title);
            // B36. `menu` named a pattern the panel is not: it opens a `role="dialog"` with
            // focus containment and Escape-to-close, and the APG expects the popup type to
            // be what actually opens.
            b.setAttribute('aria-haspopup', 'dialog');
            b.setAttribute('aria-controls', PANEL_ID);
            b.setAttribute('aria-expanded', 'false');
            // No inline geometry. B36 set min-width/min-height here and inline styles beat
            // the stylesheet, so the control rendered 44x44 among 38x38 neighbours. The
            // touch target is a `::before` in the CSS below, which does not affect layout.
            b.addEventListener('click', () => this.toggle());
            b.appendChild(groupIcon(this.doc, 22));

            // Before Companion's own pair when they are already there, otherwise before the
            // select group — which is where Companion inserts, so it lands after us either
            // way. Order is 🎯 🎭 👤 👥 🪟 📞 whichever of the two injects first: the three
            // that choose what you are looking at, then the one that chooses what you do
            // together, then the two that move the window. Grouping by what a button is
            // for, rather than by which feature shipped last.
            const anchor = toolbar.querySelector(COMPANION_BUTTON) || toolbar.querySelector(TOOLBAR_RIGHT);
            if (anchor) toolbar.insertBefore(b, anchor);
            else toolbar.appendChild(b);
            this.button = b;
            return b;
        }

        /** A second entrance, appended to the drawer group that already says EXPERIENCE. */
        _injectDrawerItem() {
            if (this.doc.getElementById(DRAWER_ID)) return null;
            const labels = [...this.doc.querySelectorAll('.drawer-nav-label')];
            const group = labels.find((l) => (l.textContent || '').trim() === DRAWER_GROUP_LABEL);
            if (!group || !group.parentNode) return null;

            const item = this.doc.createElement('button');
            item.id = DRAWER_ID;
            item.type = 'button';
            item.className = 'drawer-nav-item';
            const mark = this.doc.createElement('span');
            mark.style.cssText = 'width:18px;display:inline-flex;justify-content:center;align-items:center';
            mark.appendChild(groupIcon(this.doc, 15));
            const text = this.doc.createElement('span');
            text.textContent = 'Together';
            item.append(mark, text);
            item.addEventListener('click', () => this.open());

            // Appended to the group, so every existing entry keeps its position.
            group.parentNode.appendChild(item);
            this.drawerItem = item;
            return item;
        }

        /** The overlay lives inside the avatar card, so it scrolls and hides with it. */
        _mountPanel() {
            if (this.panel.root) return this.panel.root;
            const host = this.doc.querySelector(OVERLAY_HOST) || this.doc.body;
            if (host && this.doc.defaultView) {
                const position = this.doc.defaultView.getComputedStyle(host).position;
                if (position === 'static') host.style.position = 'relative';
            }
            return this.panel.mount(host);
        }

        // ── opening ──────────────────────────────────────────────────────────

        open() {
            this.opens++;
            if (this.inXR) return this._openXR();
            this.panel.open();
            this._listen(true);
            this._focusFirst();
            return { ok: true, surface: '2d' };
        }

        close({ restoreFocus = true } = {}) {
            const wasOpen = this.panel.isOpen;
            this.panel.close();
            this._listen(false);
            // Back to where they were. A keyboard user dropped at the top of the document
            // every time they dismiss a menu has to find their place again, every time.
            if (wasOpen && restoreFocus && this.button) this.button.focus();
            return true;
        }

        toggle() {
            return this.panel.isOpen ? this.close() : this.open();
        }

        /**
         * The headset. B20's renderer draws the same list onto the virtual screen, because
         * a DOM overlay is invisible in an immersive session — and selection is spoken,
         * which needs no pointer code and no new file.
         */
        _openXR() {
            if (!this.panels || typeof this.panels.show !== 'function') {
                return { ok: false, surface: 'xr', why: 'no panel renderer' };
            }
            const items = (this.panel.constructor.choosable || choosableOf)(this.panel.activities).map((a) => {
                const meta = metaOf(a);
                return { key: meta.icon || '✦', value: meta.title || a.label || a.id };
            });
            this.panels.show({
                v: 1,
                type: 'display',
                kind: 'cards',
                data: { title: 'Together — what should we do?', cards: items },
            });
            return { ok: true, surface: 'xr', spoken: true };
        }

        // ── keyboard and focus ───────────────────────────────────────────────

        /** Document listeners exist only while the chooser is open. */
        _listen(shouldListen) {
            if (shouldListen === this._bound || !this.doc) return;
            const method = shouldListen ? 'addEventListener' : 'removeEventListener';
            this.doc[method]('keydown', this._onKey, true);
            this.doc[method]('pointerdown', this._onPointer, true);
            this._bound = shouldListen;
        }

        /** Everything focusable inside the panel, in tab order. */
        _focusable() {
            const root = this.panel.root;
            if (!root) return [];
            return [...root.querySelectorAll('button:not([disabled])')];
        }

        _focusFirst() {
            const first = this._focusable()[0];
            if (first && typeof first.focus === 'function') first.focus();
            return first || null;
        }

        /**
         * Escape closes; Tab wraps. Escape never stops a running activity — dismissing the
         * menu and leaving the experience stay different intentions.
         */
        _key(event) {
            if (!this.panel.isOpen) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                this.close();
                return;
            }
            if (event.key !== 'Tab') return;

            const focusable = this._focusable();
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = this.doc.activeElement;

            // A menu you can Tab out of but not see is worse than one that holds you.
            if (event.shiftKey && (active === first || !this.panel.root.contains(active))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        }

        /** A click anywhere else dismisses — but never through the button's own toggle. */
        _pointer(event) {
            if (!this.panel.isOpen || !this.panel.root) return;
            const target = event.target;
            if (this.panel.root.contains(target)) return;
            if (this.button && this.button.contains(target)) return;
            if (this.drawerItem && this.drawerItem.contains(target)) return;
            this.close({ restoreFocus: false });
        }

        // ── reflecting state ─────────────────────────────────────────────────

        /**
         * The button says one of three things, and never more. It is not a feature toggle:
         * the running state opens the same panel, which is where stopping lives.
         */
        _reflect() {
            const b = this.button;
            if (!b) return null;
            const active = this.panel.activeActivity;
            const open = this.panel.isOpen;

            const state = active ? 'running' : open ? 'open' : 'idle';
            b.dataset.state = state;
            b.setAttribute('aria-expanded', open ? 'true' : 'false');

            // The icon never changes shape; running is a colour and a dot, drawn by CSS off
            // `data-state`. What does change is the name — with no text in the button, the
            // accessible name is the only place a screen reader can learn that something is
            // already running, and "Together" alone would be a lie at that point.
            const meta = active && this.panel.activities.get(active);
            b.title = buttonName(active ? titleOf(meta, active) : null);
            b.setAttribute('aria-label', b.title);
            return state;
        }

        detach() {
            if (this._unsubscribe) this._unsubscribe();
            this._unsubscribe = null;
            this._listen(false);
            for (const node of [this.button, this.drawerItem, this.style]) {
                if (node && node.parentNode) node.parentNode.removeChild(node);
            }
            this.button = this.drawerItem = this.style = null;
            return true;
        }

        get stats() {
            return {
                mounted: Boolean(this.button),
                inDrawer: Boolean(this.drawerItem),
                opens: this.opens,
                state: this.button ? this.button.dataset.state : null,
                surface: this.inXR ? 'xr' : '2d',
                listening: this._bound,
            };
        }
    }

    /** Reads the panel module's own table, so the two never disagree about a name. */
    function metaOf(activity) {
        const panel = typeof window !== 'undefined' ? window.NEXUS_BD_TOGETHER_PANEL : null;
        return panel && panel.metaFor ? panel.metaFor(activity) : activity.ui || {};
    }

    /**
     * The activity's name as a person would write it. It used to be upper-cased to match the
     * pill's `text-transform`, which was harmless while it was decoration. B34's only
     * consumer is the accessible name, and a screen reader may spell an all-caps word out
     * letter by letter — so the casing the panel already uses is the casing to speak.
     */
    function titleOf(activity, fallback) {
        if (!activity) return String(fallback || '');
        const meta = metaOf(activity);
        return String(meta.title || activity.label || fallback || '');
    }

    function choosableOf(activities) {
        const panel = typeof window !== 'undefined' ? window.NEXUS_BD_TOGETHER_PANEL : null;
        return panel && panel.choosable ? panel.choosable(activities) : [...activities.values()];
    }

    function attach(deps) {
        return new Launcher(deps).attach();
    }

    return { attach, Launcher, BUTTON_ID, DRAWER_ID, STYLE_ID, CSS };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_TOGETHER_LAUNCHER = TogetherLauncher;
if (typeof module !== 'undefined' && module.exports) module.exports = TogetherLauncher;
