/**
 * One activity execution contract (batch B36).
 *
 * ── The problem this exists to end ───────────────────────────────────────────────────────
 *
 * `TogetherPanel.startActivity()` calls `activity.start(option.arg)` — one positional
 * argument, the same for all eight. The activities never agreed to that:
 *
 *   watch          `playFile(url, {makeVideo})` / `shareTab({makeVideo})` — no `start` at all
 *   scene-journey  `enter(id)` / `exit(why)`    — no `start`, no `stop`
 *   copilot        `start(steps, {title})`      — panel passes `undefined`; refuses without steps
 *   meeting        `start({conversationId})`    — panel passes a string, and never registers it
 *   cohost         `start(at)`                  — a timestamp, not a source
 *   coach          `start(exercise)`            — the one that happens to line up
 *
 * So four of the eight tiles in a finished-looking chooser could not complete the journey the
 * button promised. That is a wiring bug wearing a product's clothes, and it is not fixed by
 * four `if (id === …)` branches in the panel.
 *
 * ── Who owns a permission ────────────────────────────────────────────────────────────────
 *
 * The second, worse bug. `ConsentMachine.request()` revokes a live grant before asking again
 * (`if (this.state === 'active') this.revoke('replaced')`). The panel was requesting a
 * grant *and then* calling activities that request their own — `watch.shareTab()` and
 * `meeting.start()` call `consent.request` directly, and `coach`/`copilot` reach it through
 * `ScreenInsight.start('camera')`. Two owners, one machine: the panel's grant was revoked
 * and the user was prompted twice for the same camera.
 *
 * The contract therefore names an owner per input, and there is exactly one:
 *
 *   `permission: null`      nothing is captured (Focus, Journey, a local file)
 *   `permission: 'self'`    the activity asks, because it already does and it knows when
 *   `permission: <source>`  the panel asks and hands the grant over
 *
 * `'self'` is not a loophole. It is the acknowledgement that an activity which acquires,
 * holds and revokes its own grant across a session — the way `meeting` does for the whole
 * recording — is a better owner than a launcher that closes itself the moment the activity
 * starts. What the contract forbids is *two* owners, and the panel now never requests for an
 * activity that requests for itself.
 *
 * ── Adapters, not surgery ────────────────────────────────────────────────────────────────
 *
 * Nothing in `activities/` is edited by this batch. Each activity keeps the surface its own
 * tests were written against, and this file maps the contract onto it. A ninth activity can
 * skip the adapter by implementing the contract directly — `adapt()` passes through anything
 * that already answers `start({input, grant, pipeline})`.
 *
 * Exposes: window.NEXUS_BD_ACTIVITY_CONTRACT
 */
const ActivityContract = (() => {
    'use strict';

    /**
     * The shape every adapted activity answers to.
     *
     *   id                          stable, matches the underlying activity
     *   inputs()      → [Input]     what the setup screen offers, or [] for "just start"
     *   availability() → {ok, why}  whether this can complete *today*, on this device
     *   start({input, grant, pipeline}) → {ok, why}
     *   stop(why)     → boolean
     *   status()      → {label, detail} | null   the compact running line
     *
     * An `Input` is `{id, label, permission, arg, pick}`. `pick` is a browser file dialog the
     * setup screen runs before starting — the only place an adapter is allowed to touch the
     * DOM, because a file input is not capture and never reaches the consent machine.
     */

    const NONE = Object.freeze([]);

    /** `{ok:true}` — the common case, hoisted so an availability check reads as one line. */
    const OK = Object.freeze({ ok: true, why: '' });
    const no = (why) => ({ ok: false, why });

    /** Whether an object already speaks the contract, in which case it is left alone. */
    function speaksContract(activity) {
        return Boolean(activity && activity.__contract === true);
    }

    /** Open a file picker and resolve to an object URL, or null if the user cancelled. */
    function pickFile(accept) {
        return (doc) =>
            new Promise((resolve) => {
                if (!doc || typeof doc.createElement !== 'function') return resolve(null);
                const input = doc.createElement('input');
                input.type = 'file';
                input.accept = accept;
                input.style.display = 'none';
                let settled = false;
                const finish = (value) => {
                    if (settled) return;
                    settled = true;
                    if (input.parentNode) input.parentNode.removeChild(input);
                    resolve(value);
                };
                input.addEventListener('change', () => {
                    const file = input.files && input.files[0];
                    finish(file ? { url: URL.createObjectURL(file), name: file.name, file } : null);
                });
                // A cancelled picker fires nothing in most browsers. The setup screen stays
                // where it is; `null` means "they changed their mind", not "it failed".
                input.addEventListener('cancel', () => finish(null));
                (doc.body || doc.documentElement).appendChild(input);
                input.click();
            });
    }

    /**
     * Per-activity adapters.
     *
     * Each is `{title, icon, order, prompt, inputs, availability, start, stop, status}`.
     *
     * **Every activity is on the first screen**, in the order the chooser has always shown
     * them. An earlier draft of this batch cut that to four tiles with the rest behind a
     * "More together" disclosure, and hid two more entirely — which removed working features
     * from view to save space nobody had asked to save. The grid is the product's face; it
     * stays, and an activity that cannot finish says so when it is chosen instead of
     * vanishing before it is.
     */
    const ADAPTERS = {
        focus: {
            title: 'Focus',
            icon: '🎯',
            order: 50,
            prompt: '25 minutes of focus, then a 5 minute break. Nothing is shared.',
            inputs: () => [{ id: 'start', label: 'Start focus', permission: null }],
            start: (a) => a.start(),
            stop: (a, why) => a.stop(why),
            status: (a) => {
                const left = typeof a.remainingMs === 'function' ? a.remainingMs() : null;
                const phase = a.phase || (a.onBreak ? 'break' : 'focus');
                return {
                    label: phase === 'break' ? 'Break' : 'Focus',
                    detail: left != null ? clock(left) : '',
                };
            },
        },

        watch: {
            title: 'Watch',
            icon: '📺',
            order: 10,
            prompt: 'What are we watching?',
            inputs: () => [
                // `'self'`: `shareTab()` requests the screen itself and holds the grant for
                // the whole session. The panel asking first would have it revoked underneath.
                {
                    id: 'tab',
                    label: 'Share a tab',
                    permission: 'self',
                    note: 'Your screen stops sharing when you leave Watch.',
                },
                { id: 'file', label: 'Open a video file', permission: null, pick: pickFile('video/*') },
            ],
            start: (a, { input }) => (input.id === 'file' ? a.playFile(input.url) : a.shareTab()),
            stop: (a, why) => a.stop(why),
            status: (a) => ({ label: 'Watching together', detail: a.sourceLabel || '' }),
        },

        copilot: {
            title: 'Help me with this',
            icon: '👀',
            // Last, and `wide`, so it lands as one full-width secondary action *below* the
            // activity grid rather than inside it — the reference layout. Ordering only:
            // the tile, its handler, its id and its styling are untouched.
            order: 90,
            wide: true,
            prompt: 'Point your camera at what you are working on.',
            inputs: () => [
                // The freeform case first, and with no checklist. B26 refuses to start
                // without steps, which turned the broadest, most valuable use of the camera —
                // "look at this and tell me what you think" — into the one it could not do.
                { id: 'look', label: 'Just look and help', permission: 'self' },
                {
                    id: 'steps',
                    label: 'Follow a checklist…',
                    permission: 'self',
                    wantsText: true,
                    placeholder: 'Paste the steps, one per line',
                },
            ],
            start: (a, { input }) => a.start(input.steps && input.steps.length ? input.steps : [FREEFORM_STEP]),
            stop: (a, why) => a.stop(why),
            status: (a) => {
                const total = (a.steps && a.steps.length) || 0;
                const at = typeof a.index === 'number' ? a.index + 1 : 1;
                return total > 1
                    ? { label: `Step ${at} of ${total}`, detail: '' }
                    : { label: 'Watching with you', detail: '' };
            },
        },

        coach: {
            title: 'Coach',
            icon: '🏋',
            order: 60,
            prompt: 'What are we doing? I need the camera to count your movement — nothing is stored.',
            inputs: (a) =>
                exercisesOf(a).map((id) => ({
                    id,
                    label: titleCase(id),
                    permission: 'self',
                    arg: id,
                })),
            start: (a, { input }) => a.start(input.arg || input.id),
            stop: (a, why) => a.stop(why),
            status: (a) => ({
                label: titleCase(a.exercise || 'Coach'),
                detail: typeof a.reps === 'number' ? `${a.reps} reps` : '',
            }),
        },

        meeting: {
            title: 'Meeting',
            icon: '🎙',
            order: 80,
            prompt: 'I will ask for your screen and your microphone, and show a recording badge the whole time.',
            inputs: () => [{ id: 'record', label: 'Start recording', permission: 'self' }],
            // `meeting.start()` takes an options object and asks for the compound grant
            // itself. The conversation id is supplied by whatever mounted the panel — a
            // meeting has to land in a conversation, and the launcher is not where that
            // is decided.
            availability: (a, { conversationId } = {}) =>
                conversationId || (a && a.conversationId)
                    ? OK
                    : no('Open a conversation first — a meeting is recorded into one.'),
            start: (a, { input, context = {} }) =>
                a.start({ conversationId: context.conversationId || a.conversationId }),
            stop: (a, why) => a.stop(why),
            status: (a) => ({
                label: 'Recording',
                detail: typeof a.elapsedMs === 'number' ? clock(a.elapsedMs) : '',
            }),
        },

        journey: {
            title: 'Journey',
            icon: '🌊',
            order: 20,
            prompt: 'Where should we go?',
            inputs: (a) =>
                scenesOf(a).map((scene) => ({
                    id: scene.id,
                    label: `${scene.icon || ''} ${scene.title}`.trim(),
                    permission: null,
                    arg: scene.id,
                })),
            // `enter`/`exit`, not `start`/`stop`. The whole of the Journey bug.
            start: (a, { input }) => a.enter(input.arg || input.id),
            stop: (a, why) => a.exit(why),
            status: (a) => ({ label: titleCase(a.current || a.sceneId || 'Journey'), detail: '' }),
        },

        music: {
            title: 'Music',
            icon: '🎧',
            order: 30,
            prompt: 'What are we listening to?',
            inputs: () => [{ id: 'file', label: 'Open an audio file', permission: null, pick: pickFile('audio/*') }],
            // B14's `Music.start()` sets a flag; the beat detector reads an `analyser` that
            // was never given a source, so the tile started something that could not hear
            // anything. `attachSource` is this batch's addition — see `audioSource.js`.
            availability: (a) =>
                typeof a.attachSource === 'function' || a.analyser || (a.detector && a.detector.analyser)
                    ? OK
                    : no('Listening together needs an audio source this build does not have.'),
            start: (a, { input }) => {
                if (typeof a.attachSource === 'function') {
                    const attached = a.attachSource(input.url, { name: input.name });
                    if (attached && attached.ok === false) return attached;
                }
                a.start();
                return { ok: true, why: 'music' };
            },
            stop: (a, why) => {
                if (typeof a.detachSource === 'function') a.detachSource(why);
                return a.stop(why);
            },
            status: (a) => ({ label: 'Listening together', detail: a.trackName || '' }),
        },

        cohost: {
            title: 'Play',
            icon: '🎮',
            order: 40,
            prompt: 'Share your game so I can react with you.',
            inputs: () => [{ id: 'screen', label: 'Share game', permission: 'screen' }],
            /**
             * Honest availability.
             *
             * `CoHost.start()` subscribes to `game:moment` on the bus and reacts to whatever
             * arrives. Nothing in the shipped runtime produces that event from a screen
             * grant — sharing a game today starts a co-host that will never see a moment.
             * Rather than let the tile promise a journey it cannot finish, it says why and
             * hides itself. The reaction engine, the tier table and the overlay are all real
             * and all tested; what is missing is the detector that feeds them.
             */
            availability: (a) =>
                a && a.momentSource
                    ? OK
                    : no('Reacting to your game needs moment detection, which is not in this build yet.'),
            start: (a, { pipeline }) => {
                if (pipeline) a.pipeline = pipeline;
                return a.start();
            },
            stop: (a, why) => a.stop(why),
            status: () => ({ label: 'Playing together', detail: '' }),
        },
    };

    /** What Copilot is given when somebody chose "just look and help". */
    const FREEFORM_STEP = { title: 'Looking with you', text: 'Watching what you are doing and helping when asked.' };

    // ── small helpers, all pure ─────────────────────────────────────────────

    function clock(ms) {
        const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
        const m = Math.floor(total / 60);
        const s = total % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    /**
     * `push-up` → `Push-up`, `deep_ocean` → `Deep ocean`.
     *
     * Underscores are separators somebody typed for a machine; a hyphen is usually part of
     * the word, and "Push up" is a different phrase from "Push-up".
     */
    function titleCase(value) {
        const text = String(value || '')
            .replace(/_+/g, ' ')
            .trim();
        return text ? text[0].toUpperCase() + text.slice(1) : '';
    }

    /** The exercises Coach will actually accept, from Coach rather than from a guess here. */
    function exercisesOf(activity) {
        const listed = activity && (activity.exercises || activity.EXERCISES || activity.supported);
        if (Array.isArray(listed) && listed.length)
            return listed.map((e) => (typeof e === 'string' ? e : e && e.id)).filter(Boolean);
        if (listed && typeof listed === 'object') return Object.keys(listed);
        // B27 refuses an unsupported exercise by name, so a wrong guess here is a refusal
        // the user can read rather than a silent failure. Squat is the one B27 ships.
        return ['squat'];
    }

    /** The scenes Journey has registered, so the tile cannot offer one that is not loaded. */
    function scenesOf(activity) {
        const scenes = activity && (activity.scenes || activity.registered);
        if (scenes instanceof Map) return [...scenes.values()].map(normaliseScene).filter(Boolean);
        if (Array.isArray(scenes)) return scenes.map(normaliseScene).filter(Boolean);
        if (scenes && typeof scenes === 'object') {
            return Object.entries(scenes)
                .map(([id, s]) => normaliseScene({ id, ...(s || {}) }))
                .filter(Boolean);
        }
        return [];
    }

    function normaliseScene(scene) {
        if (!scene || !scene.id) return null;
        return { id: String(scene.id), title: scene.title || titleCase(scene.id), icon: scene.icon || '' };
    }

    /**
     * Wrap one activity in the contract. Returns `null` for something with no adapter and no
     * native contract — a registry that silently accepted those is how a tile that cannot
     * start got into the chooser.
     */
    function adapt(activity, context = {}) {
        if (!activity || !activity.id) return null;
        if (speaksContract(activity)) return activity;
        const spec = ADAPTERS[activity.id];
        if (!spec) return null;

        return {
            __contract: true,
            id: activity.id,
            raw: activity,
            title: spec.title,
            icon: spec.icon,
            order: spec.order,
            wide: Boolean(spec.wide),
            prompt: spec.prompt || '',

            inputs() {
                try {
                    return spec.inputs ? spec.inputs(activity, context) || NONE : NONE;
                } catch (error) {
                    console.warn(`[BD] ${activity.id} could not describe its inputs`, error);
                    return NONE;
                }
            },

            availability() {
                try {
                    return spec.availability ? spec.availability(activity, context) || OK : OK;
                } catch (error) {
                    return no(String((error && error.message) || error));
                }
            },

            async start({ input = {}, grant = null, pipeline = null } = {}) {
                try {
                    const result = await spec.start(activity, { input, grant, pipeline, context });
                    // An activity that answers with an object keeps its own words; one that
                    // answers with anything else succeeded by not throwing, which is how
                    // `journey.enter` and `music.start` report.
                    if (result && typeof result === 'object' && 'ok' in result) return result;
                    if (result === false) return no(`${activity.id} refused to start`);
                    return { ok: true, why: activity.id };
                } catch (error) {
                    return no(String((error && error.message) || error));
                }
            },

            stop(why = 'user') {
                try {
                    spec.stop(activity, why);
                    return true;
                } catch (error) {
                    console.warn(`[BD] ${activity.id} refused to stop`, error);
                    return false;
                }
            },

            status() {
                try {
                    const value = spec.status ? spec.status(activity, context) : null;
                    if (!value || !value.label) return null;
                    return { label: String(value.label), detail: String(value.detail || '') };
                } catch (error) {
                    return null;
                }
            },
        };
    }

    return {
        adapt,
        ADAPTERS,
        OK,
        clock,
        titleCase,
        exercisesOf,
        scenesOf,
        pickFile,
        FREEFORM_STEP,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_ACTIVITY_CONTRACT = ActivityContract;
if (typeof module !== 'undefined' && module.exports) module.exports = ActivityContract;
