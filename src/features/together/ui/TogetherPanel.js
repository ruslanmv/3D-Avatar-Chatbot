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
     * B36. The activity contract and the failure copy, from the module system or the window,
     * so this file works under jest and in the browser without either knowing about the
     * other. Absent, the panel falls back to B30's behaviour rather than breaking — an
     * install missing a file should lose the fix, not the launcher.
     */
    const Contract =
        (typeof require === 'function' ? tryRequire('../activities/contract.js') : null) ||
        (typeof window !== 'undefined' ? window.NEXUS_BD_ACTIVITY_CONTRACT : null);
    const Failures =
        (typeof require === 'function' ? tryRequire('./failures.js') : null) ||
        (typeof window !== 'undefined' ? window.NEXUS_BD_TOGETHER_FAILURES : null);

    function tryRequire(path) {
        try {
            // eslint-disable-next-line global-require
            return require(path);
        } catch (error) {
            return null;
        }
    }

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
            /** B36. The same activities, wrapped in the one contract. */
            this.adapted = new Map();
            /**
             * What the host knows that an activity needs and the launcher cannot know —
             * today, the conversation a meeting would be recorded into. Set by whatever
             * mounts the panel; `setContext` re-adapts so availability follows it.
             */
            this.context = { ...(config.context || {}) };
            /** The failure screen, when a start did not work. */
            this.failure = null;
            /** What the user picked in setup, so Try again can repeat it. */
            this.lastAttempt = null;
            /** The element that opened the chooser, so focus goes back where it came from. */
            this.opener = null;
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
        open(opener = null) {
            this.open_ = true;
            this.view = this.active ? 'running' : 'chooser';
            this.pending = null;
            this.failure = null;
            // B36. Whichever control opened this — the toolbar button or the drawer entry —
            // is where focus goes when it closes. Returning to the toolbar after opening
            // from the drawer drops a keyboard user somewhere they never were.
            if (opener) this.opener = opener;
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
            this.failure = null;
            this._paint();
            this._announce();
            const opener = this.opener;
            this.opener = null;
            if (opener && typeof opener.focus === 'function') {
                try {
                    opener.focus();
                } catch (error) {
                    /* detached from the document */
                }
            }
            return true;
        }

        toggle(opener = null) {
            return this.open_ ? this.close() : this.open(opener);
        }

        /** Step into one activity's setup, or start it if it has only one way in. */
        choose(id) {
            const contract = this.contractFor(id);
            if (!contract && !this.activities.has(id)) return { ok: false, why: `no activity ${id}` };

            if (contract) {
                const inputs = contract.inputs();
                // One input that asks nothing is not a question, and a setup screen showing a
                // single button labelled "Start" is a step that exists only to be got past.
                //
                // **But a permission is always a question.** B30's whole shape is
                // choose → explain → ask, and a tile press that opens a browser dialog with
                // no sentence in between is the pattern that shape exists to avoid — so an
                // input with any permission keeps its screen, `'self'` included.
                const only = inputs.length === 1 ? inputs[0] : null;
                if (only && !only.permission && !only.pick && !only.wantsText && !only.note) {
                    return this.startActivity(id, only);
                }
            } else if (metaFor(this.activities.get(id)).direct) {
                return this.startActivity(id);
            }

            this.pending = id;
            this.failure = null;
            this.view = 'setup';
            this._paint();
            this._announce();
            return { ok: true, why: 'setup' };
        }

        /**
         * Tell the panel something an activity needs and the launcher cannot know.
         *
         * Today that is the conversation a meeting records into. Re-adapts every registered
         * activity, because availability is a function of this — a Meeting tile appears when
         * a conversation opens and disappears when it closes.
         */
        setContext(patch) {
            this.context = { ...this.context, ...(patch || {}) };
            if (Contract) {
                for (const [id, raw] of this.activities) {
                    const adapted = Contract.adapt(raw, this.context);
                    if (adapted) this.adapted.set(id, adapted);
                }
            }
            this._paint();
            return this.context;
        }

        /**
         * Start one activity, under one permission owner (B36).
         *
         * The two bugs this replaces:
         *
         * **Two owners.** The old path requested a grant for anything with `needs`, then
         * called an activity that requests its own. `ConsentMachine.request()` revokes a live
         * grant before asking again, so the panel's grant was destroyed and the user was
         * prompted twice for the same camera. The contract now names the owner per input —
         * `null`, `'self'`, or a consent source — and the panel asks only for the last.
         *
         * **A leaked grant.** If the panel had opened the camera and the activity then
         * refused — Copilot with no steps was the reachable case — the panel returned to the
         * chooser and left the camera on. The consent badge told the truth and the product
         * did not. Every failure path below now revokes what this call opened, and only what
         * this call opened: an activity that owns its own grant cleans up its own.
         */
        async startActivity(id, option = null) {
            const activity = this.contractFor(id);
            const legacy = this.activities.get(id);
            if (!activity) {
                // No adapter: fall back to B30's call so an activity added without one still
                // starts, rather than silently doing nothing.
                if (!legacy || typeof legacy.start !== 'function') return { ok: false, why: `no activity ${id}` };
                return this._startLegacy(id, legacy, option);
            }

            const input = option || activity.inputs()[0] || { id: 'start', permission: null };
            this.lastAttempt = { id, input };

            // Availability first, before any dialog. Telling somebody a meeting needs a
            // conversation *after* the screen and microphone prompts is the worst possible
            // moment to say it.
            const available = activity.availability();
            if (available && available.ok === false) return this._fail(activity, available);

            // A file dialog is not capture and never reaches the consent machine.
            let resolved = input;
            if (typeof input.pick === 'function') {
                const picked = await input.pick(this.doc);
                if (!picked) return { ok: false, why: 'cancelled' };
                resolved = { ...input, ...picked };
            }

            // The one place this panel asks for anything — and only when the contract says
            // the panel is the owner.
            let opened = null;
            if (resolved.permission && resolved.permission !== 'self') {
                opened = await this.share(resolved.permission);
                if (!opened) {
                    return this._fail(
                        activity,
                        Failures
                            ? Failures.declined(activity.title)
                            : { ok: false, why: this.consent.reason || 'declined' },
                        { declined: true }
                    );
                }
            }

            const result = await activity.start({
                input: resolved,
                grant: this.consent ? this.consent.grant : null,
                pipeline: opened,
            });

            if (!result || result.ok === false) {
                // Whatever *this* call opened goes with the failure. An activity that owns
                // its own grant is left to its own cleanup — revoking here would tear down a
                // grant a still-running activity may hold.
                if (opened) this.stopSharing('start failed');
                return this._fail(activity, result || { ok: false, why: 'refused' });
            }

            this.active = id;
            this.failure = null;
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

        /** B30's path, for an activity registered without an adapter. */
        async _startLegacy(id, activity, option) {
            if (option && option.needs) {
                const pipeline = await this.share(option.needs);
                if (!pipeline) {
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
                if (option && option.needs) this.stopSharing('start failed');
                return { ok: false, why: String((error && error.message) || error) };
            }
            if (result && result.ok === false) {
                if (option && option.needs) this.stopSharing('start failed');
                this.view = 'chooser';
                this.pending = null;
                this._paint();
                this._announce();
                return result;
            }
            this.active = id;
            this.view = 'running';
            this.pending = null;
            this.open_ = false;
            this._paint();
            this._announce();
            return { ok: true, why: id };
        }

        /**
         * Show why it did not start, with something to do about it.
         *
         * The activities produce specific reasons and the old panel dropped every one of
         * them and went back to the chooser. Never "Something went wrong" — see `failures.js`.
         */
        _fail(activity, result, { declined = false } = {}) {
            const name = (activity && activity.title) || 'This activity';
            this.failure = Failures
                ? declined
                    ? Failures.declined(name)
                    : Failures.describe(result, { name })
                : {
                      id: 'raw',
                      title: `${name} could not start`,
                      body: String((result && result.why) || ''),
                      actions: [],
                  };
            this.view = 'failure';
            // A failure nobody can see is the bug this replaces. Whatever the panel's state,
            // a start that did not work puts the reason on screen.
            this.open_ = true;
            this.pending = null;
            this._paint();
            this._announce();
            // Always a result, never the screen. A caller asked whether the activity
            // started; handing back the copy object would answer a different question and
            // `result.ok` would read `undefined`, which is neither true nor false.
            return { ok: false, why: this.failure.why || String((result && result.why) || 'refused') };
        }

        /** Leave the running activity. The activity puts its own profile back (§6.11). */
        stopActivity(why = 'user') {
            const contract = this.active && this.contractFor(this.active);
            const activity = this.active && this.activities.get(this.active);
            this.active = null;
            this.view = 'chooser';
            this.failure = null;
            if (contract) {
                // The contract knows Journey stops through `exit` and Music through
                // `detachSource` then `stop`. It never throws.
                contract.stop(why);
            } else if (activity && typeof activity.stop === 'function') {
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

        /**
         * B12–B14 call this. Registration, not surgery — the point of the source enum.
         *
         * B36 adapts on the way in, so the panel only ever holds objects that answer one
         * surface. An activity with no adapter and no native contract is still registered —
         * some are capabilities rather than tiles, `screen-insight` among them — but it will
         * not appear in the chooser, because `choosable` asks the contract and not a table.
         */
        register(activity) {
            if (!activity || !activity.id) return false;
            this.activities.set(activity.id, activity);
            const adapted = Contract ? Contract.adapt(activity, this.context) : null;
            if (adapted) this.adapted.set(activity.id, adapted);
            this._paint();
            return true;
        }

        /** The contract-shaped view of one activity, or null when it has no adapter. */
        contractFor(id) {
            return this.adapted.get(id) || null;
        }

        /**
         * Every registered activity, in the order the chooser has always shown them.
         *
         * An earlier draft filtered this by `availability()`, so Music and Play simply were
         * not there — and the grid people know disappeared with them. Hiding a control is
         * the most confusing way to say "not yet": nothing tells the user the feature
         * exists, why it is unreachable, or what would fix it.
         *
         * Availability is still asked, at the moment of choosing, where it becomes a
         * sentence with a reason and a way back (`_fail`). The tile stays.
         */
        choices() {
            return [...this.adapted.values()].sort((a, b) => (a.order || 99) - (b.order || 99));
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
            // B36. One model, not two. B34 gave this focus containment, Escape-to-close and
            // focus movement into the panel — modal-dialog keyboard behaviour — while leaving
            // `aria-modal` off, so assistive tech was told it was a non-modal dialog and
            // shown a modal one. The launcher's `aria-haspopup` said `menu` on top of that,
            // naming a third thing again.
            //
            // It is a modal dialog, and now says so. What stays true is the thing that
            // matters: **closing the chooser does not stop the activity.** Modality is about
            // the menu, not about the experience it launched.
            this.root.setAttribute('role', 'dialog');
            this.root.setAttribute('aria-modal', 'true');
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
            else if (this.view === 'failure') this._paintFailure();
            else this._paintChooser();

            // The failure view carries its own actions — one of which is Back — so a second
            // Back underneath it would be the same word twice with different behaviour.
            if (this.view !== 'failure') {
                this.root.appendChild(
                    this._button(this.view === 'chooser' ? 'Cancel' : 'Back', 'nexus-bd-together-cancel', () => {
                        if (this.view === 'chooser') this.close();
                        else this.open();
                    })
                );
            }
        }

        /** "What should we do?" — and nothing about capture, because nothing has been chosen. */
        _paintChooser() {
            const prompt = this.doc.createElement('p');
            prompt.className = 'nexus-bd-together-prompt';
            prompt.textContent = 'What should we do?';
            this.root.appendChild(prompt);

            const grid = this.doc.createElement('div');
            grid.className = 'nexus-bd-together-grid';

            // Every activity, in the grid's own order. Nothing is behind a disclosure and
            // nothing is filtered out: see `choices()`.
            const shown = Contract
                ? this.choices()
                : choosable(this.activities).map((a) => ({
                      id: a.id,
                      ...metaFor(a),
                      title: metaFor(a).title || a.id,
                  }));

            for (const activity of shown) {
                const tile = this._button('', 'nexus-bd-together-tile', () => this.choose(activity.id));
                if (activity.wide) tile.classList.add('is-wide');
                tile.dataset.activity = activity.id;
                const icon = this.doc.createElement('span');
                icon.className = 'nexus-bd-together-icon';
                icon.textContent = activity.icon || '✦';
                const name = this.doc.createElement('span');
                name.className = 'nexus-bd-together-name';
                name.textContent = activity.title || activity.id;
                tile.append(icon, name);
                tile.title = name.textContent;
                grid.appendChild(tile);
            }

            if (!shown.length) {
                const empty = this.doc.createElement('p');
                empty.className = 'nexus-bd-together-prompt';
                empty.textContent = 'No activities available in this build.';
                grid.appendChild(empty);
            }
            this.root.appendChild(grid);
        }

        /** One activity's own question — and the only view where permission is ever asked. */
        _paintSetup() {
            const contract = this.contractFor(this.pending);
            const activity = this.activities.get(this.pending);
            if (!contract && !activity) return this._paintChooser();
            const meta = contract || metaFor(activity);

            const title = this.doc.createElement('p');
            title.className = 'nexus-bd-together-subtitle';
            title.textContent = `${meta.icon || '✦'} ${meta.title || (activity && activity.label) || this.pending}`;
            this.root.appendChild(title);

            const prompt = this.doc.createElement('p');
            prompt.className = 'nexus-bd-together-prompt';
            prompt.textContent = meta.prompt || 'Ready when you are.';
            this.root.appendChild(prompt);

            const inputs = contract ? contract.inputs() : metaFor(activity).options || [{ label: 'Start' }];

            // A step that wants free text gets a box for it. Copilot's checklist is the only
            // one today, and requiring one was what made the camera's broadest use
            // impossible.
            let textarea = null;
            const wantsText = inputs.find((i) => i.wantsText);
            if (wantsText) {
                textarea = this.doc.createElement('textarea');
                textarea.className = 'nexus-bd-together-steps';
                textarea.rows = 4;
                textarea.placeholder = wantsText.placeholder || '';
                textarea.setAttribute('aria-label', wantsText.placeholder || 'Steps');
                this.root.appendChild(textarea);
            }

            const list = this.doc.createElement('div');
            list.className = 'nexus-bd-together-options';
            for (const input of inputs) {
                const b = this._button(input.label, 'nexus-bd-together-option', () => {
                    const chosen = { ...input };
                    if (input.wantsText && textarea) {
                        chosen.steps = String(textarea.value || '')
                            .split(/\r?\n/)
                            .map((line) => line.trim())
                            .filter(Boolean)
                            .map((text) => ({ title: text, text }));
                    }
                    this.startActivity(this.pending, chosen);
                });
                b.dataset.input = input.id || input.label;
                // The one place the UI admits a permission is coming, before it arrives —
                // including the ones the activity itself will ask for.
                const asks = input.permission === 'self' ? 'access' : input.permission;
                if (asks) b.title = `Asks for ${asks === 'meeting' ? 'screen and microphone' : asks} access`;
                if (input.note) {
                    const note = this.doc.createElement('span');
                    note.className = 'nexus-bd-together-note';
                    note.textContent = input.note;
                    b.appendChild(note);
                }
                list.appendChild(b);
            }
            this.root.appendChild(list);
        }

        /** What is running — in the activity's own words, not the launcher's. */
        _paintRunning() {
            const contract = this.contractFor(this.active);
            const activity = this.activities.get(this.active);
            const meta = contract || (activity ? metaFor(activity) : {});

            const title = this.doc.createElement('p');
            title.className = 'nexus-bd-together-subtitle';
            title.textContent = `● ${(meta.title || this.active || '').toUpperCase()}`;
            this.root.appendChild(title);

            const status = this.doc.createElement('p');
            status.className = 'nexus-bd-together-prompt';
            status.dataset.role = 'status';
            // B36. `Focus · 24:18` rather than "Running — nothing is being shared." The
            // launcher owns Stop and Change; the middle line belongs to the activity, which
            // is the only thing that knows how far through it is.
            const own = contract ? contract.status() : null;
            if (own) {
                status.textContent = own.detail ? `${own.label} · ${own.detail}` : own.label;
            } else {
                status.textContent = this.state.state === 'active' ? this.state.label || 'Sharing.' : 'Running.';
            }
            this.root.appendChild(status);

            // Capture state stays visible underneath, because what is running and what is
            // being captured are different facts and §2a wants the second one unmissable.
            if (this.state.state === 'active' && this.state.label) {
                const sharing = this.doc.createElement('p');
                sharing.className = 'nexus-bd-together-sharing';
                sharing.textContent = this.state.label;
                this.root.appendChild(sharing);
            }

            const list = this.doc.createElement('div');
            list.className = 'nexus-bd-together-options';
            list.appendChild(
                this._button('Stop', 'nexus-bd-together-option is-stop', () => {
                    this.stopActivity('user');
                })
            );
            list.appendChild(
                this._button('Change', 'nexus-bd-together-option', () => {
                    this.stopActivity('changed');
                })
            );
            this.root.appendChild(list);
        }

        /**
         * Why it did not start, and what to do about it.
         *
         * The old panel returned to the chooser with the reason discarded: a tile tapped, a
         * dialog answered, and then the menu again with nothing said. Every reason the eight
         * activities produce now reaches a sentence and at least one action.
         */
        _paintFailure() {
            const failure = this.failure || { title: 'It did not start', body: '', actions: [] };

            const title = this.doc.createElement('p');
            title.className = 'nexus-bd-together-subtitle';
            title.dataset.role = 'failure-title';
            title.textContent = failure.title;
            this.root.appendChild(title);

            const body = this.doc.createElement('p');
            body.className = 'nexus-bd-together-prompt';
            body.dataset.role = 'failure-body';
            body.setAttribute('role', 'status');
            body.textContent = failure.body;
            this.root.appendChild(body);

            const list = this.doc.createElement('div');
            list.className = 'nexus-bd-together-options';
            for (const action of failure.actions || []) {
                const b = this._button(action.label, 'nexus-bd-together-option', () => {
                    if (action.id === 'retry' && this.lastAttempt) {
                        this.startActivity(this.lastAttempt.id, this.lastAttempt.input);
                        return;
                    }
                    if (action.id === 'settings') {
                        this._openSettings();
                        return;
                    }
                    this.failure = null;
                    this.view = 'chooser';
                    this._paint();
                    this._announce();
                });
                b.dataset.action = action.id;
                list.appendChild(b);
            }
            this.root.appendChild(list);
        }

        /**
         * Open Settings, so "Open settings" is a button that does something.
         *
         * B36 dispatched `nexus:open-settings` and nothing in the app has ever listened for
         * it, so the one recovery action on the HomePilot failure screen was dead — the
         * worst kind of dead, because it looks like a way out. The shipped page opens
         * Settings from `#settings-btn`, so that is what this presses.
         *
         * Order: an injected opener wins (a host that mounts this knows best), then the
         * real button, then the event for a shell that has neither. This panel does not
         * reach into the settings markup itself — it presses the control the user would.
         */
        _openSettings() {
            const open = this.config && this.config.onOpenSettings;
            if (typeof open === 'function') {
                try {
                    open();
                    return;
                } catch (error) {
                    console.warn('[BD] settings did not open', error);
                }
            }
            const btn = this.doc && this.doc.getElementById('settings-btn');
            if (btn && typeof btn.click === 'function') {
                this.close();
                btn.click();
                return;
            }
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                try {
                    window.dispatchEvent(new CustomEvent('nexus:open-settings'));
                } catch (error) {
                    /* a shell with no settings is not a failure */
                }
            }
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
