/**
 * TogetherPanel — the consent controls, and a shelf for the activities (batch B11).
 *
 * B11 lands before Together Mode has any activities, so this panel deliberately ships as
 * the half that exists: the sharing controls, the live state, and an `activities` registry
 * that is empty today. B12–B14 register into it. Drawing a picker for zero activities and
 * calling it a flagship would be a mock-up rather than a batch.
 *
 * The one rule the panel keeps: **it does not capture.** Every button here goes through
 * `ConsentMachine`, the panel never sees a `MediaStream`, and the pipeline it hands out is
 * built from a grant like everybody else's. A UI that could shortcut the machine would make
 * the machine advisory.
 *
 * ## B30: from a developer's shelf to the thing a person taps
 *
 * The panel shipped in B11 as a list of registered activities and a bare "Share screen"
 * button — honest for a batch that landed before any activity existed, and wrong as a
 * product surface, because it names the capture system before asking what you want to do.
 *
 * So the presentation changed and the architecture did not. `share()` is untouched and is
 * still the only way a frame is ever asked for; what moved is *when* it is called. The
 * chooser asks "what should we do?", and a permission prompt appears only after an activity
 * that needs one is picked. Journeys and Focus never reach it at all.
 *
 * `STEPS` is a table keyed by activity id rather than a field on each activity, so this
 * batch touches none of the eight activity files. An activity that supplies its own
 * `activity.ui` overrides the table, which is the extension point a ninth one would use.
 *
 * Exposes: window.NEXUS_BD_TOGETHER_PANEL
 */
const TogetherPanel = (() => {
    'use strict';

    const PANEL_ID = 'nexus-bd-together-panel';

    /**
     * What each activity is called on the outside, and what has to happen before it starts.
     *
     * Product names, not architecture names: "Help me with this" rather than "Hands-busy
     * copilot over the camera variant of the capture pipeline". `screen-insight` gets no
     * tile of its own — it is a capability behind Watch and Help, not something a person
     * sets out to do.
     *
     * `needs` is what the option asks for, and it is the only place capture is named. An
     * option with no `needs` never reaches the consent machine, which is why Journey and
     * Focus can run with no permission prompt at all.
     */
    const STEPS = {
        watch: {
            title: 'Watch',
            icon: '📺',
            order: 10,
            prompt: 'What are we watching?',
            options: [
                { label: 'Share a tab', needs: 'screen' },
                { label: 'Open local video', arg: 'file' },
            ],
        },
        journey: {
            title: 'Journey',
            icon: '🌊',
            order: 20,
            prompt: 'Where should we go?',
            options: [
                { label: '🌊 Ocean', arg: 'ocean' },
                { label: '🌲 Forest', arg: 'forest' },
                { label: '🕯 Meditation', arg: 'meditation' },
                { label: '🌅 Sunset', arg: 'sunset' },
            ],
        },
        music: { title: 'Music', icon: '🎧', order: 30, direct: true },
        cohost: {
            title: 'Play',
            icon: '🎮',
            order: 40,
            prompt: 'Share your game so I can react with you.',
            options: [{ label: 'Share game', needs: 'screen' }],
        },
        focus: {
            title: 'Focus',
            icon: '🎯',
            order: 50,
            prompt: '25 min focus · 5 min break',
            options: [{ label: 'Start' }],
        },
        coach: {
            title: 'Coach',
            icon: '🏋',
            order: 60,
            prompt: 'I need the camera to see your movement.',
            options: [{ label: 'Use camera', needs: 'camera', arg: 'squat' }],
        },
        copilot: {
            title: 'Help me with this',
            icon: '👀',
            order: 70,
            wide: true,
            prompt: 'Point your camera at what you are working on.',
            options: [{ label: 'Use camera', needs: 'camera' }],
        },
        meeting: {
            title: 'Record this meeting',
            icon: '🎙',
            order: 80,
            // The prompt says what will be asked for *before* either dialog opens, because
            // two permission prompts in a row with no warning is how a person ends up
            // declining the second one and wondering why nothing recorded.
            prompt: 'I will ask for your screen and your microphone, and show a recording badge the whole time.',
            options: [{ label: 'Start recording', needs: 'meeting' }],
        },
    };

    /** An activity may override the table. Nothing in the repo does yet; a ninth would. */
    function metaFor(activity) {
        const table = STEPS[activity.id] || {};
        return { ...table, ...(activity.ui || {}) };
    }

    /** Activities a person would set out to do, in the order the chooser shows them. */
    function choosable(activities) {
        return [...activities.values()]
            .filter((a) => STEPS[a.id] || a.ui)
            .sort((a, b) => (metaFor(a).order || 99) - (metaFor(b).order || 99));
    }

    class Panel {
        constructor({ consent, capture, config = {}, doc } = {}) {
            this.consent = consent;
            this.capture = capture || (typeof window !== 'undefined' ? window.NEXUS_BD_CAPTURE : null);
            this.config = config;
            this.doc = doc || (typeof document !== 'undefined' ? document : null);

            /** Registered by later batches: `{id, label, start, stop}`. */
            this.activities = new Map();
            this.pipeline = null;
            this.root = null;
            this.state = { state: 'idle', label: '' };

            /** Launcher state. `open` is about the chooser; `active` is about an activity,
             *  and the two are deliberately independent — dismissing the menu must never
             *  stop what is running. */
            this.open_ = false;
            this.view = 'chooser';
            this.pending = null;
            this.active = null;
            this._listeners = new Set();
            this._unsubscribe = consent ? consent.onChange((snapshot) => this._onState(snapshot)) : () => {};
        }

        get name() {
            return 'TogetherPanel';
        }

        // ── the launcher's API ───────────────────────────────────────────────

        get isOpen() {
            return this.open_;
        }

        /** The running activity's id, or null. Read by the launcher for its button label. */
        get activeActivity() {
            return this.active;
        }

        /** Subscribe to state changes. Returns an unsubscribe, like `ConsentMachine`. */
        onChange(handler) {
            this._listeners.add(handler);
            return () => this._listeners.delete(handler);
        }

        _announce() {
            const snapshot = { open: this.open_, view: this.view, active: this.active };
            for (const handler of this._listeners) {
                try {
                    handler(snapshot);
                } catch (error) {
                    console.warn('[BD] a Together listener threw', error);
                }
            }
        }

        /**
         * Show the chooser. **Starts nothing** — no camera, no microphone, no capture, no
         * mode change. It is a menu, and opening a menu is not consent to anything on it.
         */
        open() {
            this.open_ = true;
            this.view = this.active ? 'running' : 'chooser';
            this.pending = null;
            this._paint();
            this._announce();
            return true;
        }

        /**
         * Dismiss the chooser. Explicitly **does not stop a running activity** — closing a
         * menu and leaving an experience are different intentions, and conflating them is
         * how somebody loses a focus block by tapping outside a panel.
         */
        close() {
            if (!this.open_) return false;
            this.open_ = false;
            this.pending = null;
            this._paint();
            this._announce();
            return true;
        }

        toggle() {
            return this.open_ ? this.close() : this.open();
        }

        /** Step into one activity's setup, or start it if it needs nothing. */
        choose(id) {
            const activity = this.activities.get(id);
            if (!activity) return { ok: false, why: `no activity ${id}` };
            const meta = metaFor(activity);
            if (meta.direct) return this.startActivity(id);
            this.pending = id;
            this.view = 'setup';
            this._paint();
            this._announce();
            return { ok: true, why: 'setup' };
        }

        /**
         * Start one activity. `option` is an entry from its `options` list; a `needs` on it
         * is the only path to a permission prompt, and it goes through `share()` — which is
         * unchanged from B11 and still the only way this panel asks for anything.
         */
        async startActivity(id, option = null) {
            const activity = this.activities.get(id);
            if (!activity || typeof activity.start !== 'function') {
                return { ok: false, why: `no activity ${id}` };
            }

            if (option && option.needs) {
                const pipeline = await this.share(option.needs);
                if (!pipeline) {
                    // Declining is an answer. Back to the chooser, nothing running, and
                    // every other channel exactly as it was.
                    this.view = 'chooser';
                    this.pending = null;
                    this._paint();
                    this._announce();
                    return { ok: false, why: 'declined' };
                }
            }

            let result;
            try {
                result = await activity.start(option && option.arg);
            } catch (error) {
                console.warn(`[BD] ${id} did not start`, error);
                return { ok: false, why: String((error && error.message) || error) };
            }
            // An activity that refuses says so in its own words; the panel does not overrule it.
            if (result && result.ok === false) {
                this.view = 'chooser';
                this.pending = null;
                this._paint();
                this._announce();
                return result;
            }

            this.active = id;
            this.view = 'running';
            this.pending = null;
            // Get out of the way. You chose an experience in order to have it, not to look
            // at a menu about it — the launcher's button carries the running state from
            // here, and tapping it brings this view back with Stop and Change on it.
            this.open_ = false;
            this._paint();
            this._announce();
            return { ok: true, why: id };
        }

        /** Leave the running activity. The activity puts its own profile back (§6.11). */
        stopActivity(why = 'user') {
            const activity = this.active && this.activities.get(this.active);
            this.active = null;
            this.view = 'chooser';
            if (activity && typeof activity.stop === 'function') {
                try {
                    activity.stop(why);
                } catch (error) {
                    console.warn('[BD] an activity refused to stop', error);
                }
            }
            // Whatever the activity held, the panel's own grant goes too.
            if (this.pipeline || this.state.state === 'active') this.stopSharing(why);
            this._paint();
            this._announce();
            return true;
        }

        /** B12–B14 call this. Registration, not surgery — the point of the source enum. */
        register(activity) {
            if (!activity || !activity.id) return false;
            this.activities.set(activity.id, activity);
            this._paint();
            return true;
        }

        /**
         * Ask for a source and, if granted, build the one pipeline this panel owns.
         * Resolves to the pipeline or null; a refusal leaves the panel usable and every
         * other channel untouched.
         */
        async share(source = 'screen') {
            const grant = await this.consent.request(source);
            if (!grant) {
                this.pipeline = null;
                return null;
            }
            this.pipeline = this.capture.fromGrant(grant, { config: this.config });
            return this.pipeline;
        }

        stopSharing(reason = 'panel') {
            if (this.pipeline) this.pipeline.stop();
            this.pipeline = null;
            return this.consent.revoke(reason);
        }

        _onState(snapshot) {
            this.state = snapshot;
            // A revoke from anywhere — the browser's own bar, a hotkey, another batch —
            // must take this panel's pipeline with it, or the panel keeps a dead object
            // that looks alive.
            if (snapshot.state !== 'active' && this.pipeline) {
                this.pipeline.stop();
                this.pipeline = null;
            }
            this._paint();
        }

        // ── DOM ──────────────────────────────────────────────────────────────

        mount(container) {
            if (!this.doc || !container) return null;
            this.root = this.doc.createElement('div');
            this.root.id = PANEL_ID;
            // A menu over the page, announced as one. `aria-modal` is deliberately absent:
            // it is dismissible and the page behind it stays live — an activity keeps
            // running while the chooser is shut.
            this.root.setAttribute('role', 'dialog');
            this.root.setAttribute('aria-label', 'Together');
            container.appendChild(this.root);
            this._paint();
            return this.root;
        }

        /** A titled button, since every view is made of them. */
        _button(label, className, onClick) {
            const b = this.doc.createElement('button');
            b.type = 'button';
            b.className = className;
            b.textContent = label;
            b.addEventListener('click', onClick);
            return b;
        }

        _paint() {
            if (!this.root) return;
            this.root.textContent = '';
            this.root.hidden = !this.open_;
            this.root.setAttribute('aria-hidden', this.open_ ? 'false' : 'true');
            if (!this.open_) return;

            const head = this.doc.createElement('p');
            head.className = 'nexus-bd-together-head';
            // The word, without the `✦` B30 put in front of it. B34 replaced that mark with
            // the two-person icon on the button; carrying a third symbol here would say the
            // same thing twice, in a place a heading only needs to name.
            head.textContent = 'TOGETHER';
            this.root.appendChild(head);

            if (this.view === 'running') this._paintRunning();
            else if (this.view === 'setup') this._paintSetup();
            else this._paintChooser();

            this.root.appendChild(
                this._button(this.view === 'chooser' ? 'Cancel' : 'Back', 'nexus-bd-together-cancel', () => {
                    if (this.view === 'chooser') this.close();
                    else this.open();
                })
            );
        }

        /** "What should we do?" — and nothing about capture, because nothing has been chosen. */
        _paintChooser() {
            const prompt = this.doc.createElement('p');
            prompt.className = 'nexus-bd-together-prompt';
            prompt.textContent = 'What should we do?';
            this.root.appendChild(prompt);

            const grid = this.doc.createElement('div');
            grid.className = 'nexus-bd-together-grid';
            const choices = choosable(this.activities);

            for (const activity of choices) {
                const meta = metaFor(activity);
                const tile = this._button('', 'nexus-bd-together-tile', () => this.choose(activity.id));
                if (meta.wide) tile.classList.add('is-wide');
                const icon = this.doc.createElement('span');
                icon.className = 'nexus-bd-together-icon';
                icon.textContent = meta.icon || '✦';
                const name = this.doc.createElement('span');
                name.className = 'nexus-bd-together-name';
                name.textContent = meta.title || activity.label || activity.id;
                tile.append(icon, name);
                tile.title = activity.label || name.textContent;
                grid.appendChild(tile);
            }

            if (!choices.length) {
                const empty = this.doc.createElement('p');
                empty.className = 'nexus-bd-together-prompt';
                empty.textContent = 'No activities available in this build.';
                grid.appendChild(empty);
            }
            this.root.appendChild(grid);
        }

        /** One activity's own question — and the only view where permission is ever asked. */
        _paintSetup() {
            const activity = this.activities.get(this.pending);
            if (!activity) return this._paintChooser();
            const meta = metaFor(activity);

            const title = this.doc.createElement('p');
            title.className = 'nexus-bd-together-subtitle';
            title.textContent = `${meta.icon || '✦'} ${meta.title || activity.label || activity.id}`;
            this.root.appendChild(title);

            const prompt = this.doc.createElement('p');
            prompt.className = 'nexus-bd-together-prompt';
            prompt.textContent = meta.prompt || 'Ready when you are.';
            this.root.appendChild(prompt);

            const list = this.doc.createElement('div');
            list.className = 'nexus-bd-together-options';
            for (const option of meta.options || [{ label: 'Start' }]) {
                const b = this._button(option.label, 'nexus-bd-together-option', () =>
                    this.startActivity(activity.id, option)
                );
                // The one place the UI admits a permission is coming, before it arrives.
                if (option.needs) b.title = `Asks for ${option.needs === 'camera' ? 'camera' : 'screen'} access`;
                list.appendChild(b);
            }
            this.root.appendChild(list);
        }

        /** What is running, and the two different ways to leave it. */
        _paintRunning() {
            const activity = this.activities.get(this.active);
            const meta = activity ? metaFor(activity) : {};

            const title = this.doc.createElement('p');
            title.className = 'nexus-bd-together-subtitle';
            title.textContent = `● ${(meta.title || this.active || '').toUpperCase()}`;
            this.root.appendChild(title);

            const status = this.doc.createElement('p');
            status.className = 'nexus-bd-together-prompt';
            status.textContent =
                this.state.state === 'active' ? this.state.label || 'Sharing.' : 'Running — nothing is being shared.';
            this.root.appendChild(status);

            const list = this.doc.createElement('div');
            list.className = 'nexus-bd-together-options';
            list.appendChild(
                this._button('Stop activity', 'nexus-bd-together-option is-stop', () => {
                    this.stopActivity('user');
                })
            );
            list.appendChild(
                this._button('Change activity', 'nexus-bd-together-option', () => {
                    this.stopActivity('changed');
                })
            );
            this.root.appendChild(list);
        }

        detach() {
            this._unsubscribe();
            this._listeners.clear();
            this.stopSharing('detached');
            if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
            this.root = null;
        }

        get stats() {
            return {
                state: this.state.state,
                sharing: this.state.state === 'active',
                activities: [...this.activities.keys()],
                open: this.open_,
                view: this.view,
                active: this.active,
                pipeline: this.pipeline ? this.pipeline.stats : null,
            };
        }
    }

    function attach(deps) {
        return new Panel(deps);
    }

    return { attach, Panel, PANEL_ID, STEPS, metaFor, choosable };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_TOGETHER_PANEL = TogetherPanel;
if (typeof module !== 'undefined' && module.exports) module.exports = TogetherPanel;
