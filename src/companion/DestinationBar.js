/**
 * DestinationBar — Life, Copilot, Experiences (IC1).
 *
 * IC2: the strip is gone. It was a second navigation on top of the avatar,
 * beside the Together tiles that already lead to the same three places, and it
 * covered her face on a phone. Together is the only way in now; this file keeps
 * the sheet (memories, preferences, tasks, Seaside's controls) and the Exit
 * button, which Together opens through `show()`. `BAR_ID` stays exported so
 * an old selector fails visibly rather than matching something else.
 *
 * A strip on the avatar card and a sheet under it. The avatar stays in the
 * card; the chat column is outside it, so the sheet does not cover the
 * composer. Closing the sheet does not stop an experience. Exit does.
 *
 * The Together chooser is not removed. These actions call it, or Seaside,
 * and the 👥 button remains the compatibility path until every tile has a
 * tested replacement.
 *
 * Exposes: window.NEXUS_COMPANION_BAR
 */
const DestinationBar = (() => {
    'use strict';

    const BAR_ID = 'nexus-companion-bar';
    const SHEET_ID = 'nexus-companion-sheet';
    const EXIT_ID = 'nexus-companion-exit';
    const STYLE_ID = 'nexus-companion-style';

    const CSS = `
#${BAR_ID} {
  position: absolute; top: .55rem; left: 50%; transform: translateX(-50%);
  display: flex; gap: .25rem; z-index: 32; pointer-events: auto;
}
#${BAR_ID} button {
  border: 1px solid rgba(34, 211, 238, .35); background: rgba(8, 14, 20, .78);
  color: #d5dde6; font: 700 .68rem/1 system-ui, sans-serif; letter-spacing: .08em;
  padding: .45rem .7rem; border-radius: 999px; cursor: pointer;
}
#${BAR_ID} button[aria-pressed="true"] { background: rgba(34, 211, 238, .22); color: #f4fbff; }
/* IC3. One look: this sheet (Tasks, memories, preferences, Seaside's controls) is the
   Together panel's card — same place, size, glass, headings and buttons. It used to be a
   different-looking box along the bottom of the avatar. */
#${SHEET_ID} {
  position: absolute; left: 50%; bottom: 4.6rem; transform: translateX(-50%); z-index: 33;
  width: min(78%, 27rem); max-height: 52%; overflow: auto; padding: 1.05rem 1.15rem 1rem;
  border-radius: 14px; background: rgba(11, 16, 23, .93); border: 1px solid rgba(34, 211, 238, .26);
  box-shadow: 0 14px 40px rgba(0, 0, 0, .5); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  color: #e8ecf2; font: 400 .84rem/1.4 var(--font-sans, system-ui, sans-serif);
}
#${SHEET_ID}[hidden] { display: none; }
#${SHEET_ID} h2 { margin: 0 0 .35rem; font-size: .66rem; font-weight: 700; letter-spacing: .16em; color: #22d3ee; text-transform: uppercase; }
#${SHEET_ID} .nexus-companion-actions, #${SHEET_ID} .nexus-companion-row { display: flex; flex-wrap: wrap; gap: .4rem; margin: .3rem 0; }
#${SHEET_ID} button {
  padding: .55rem .8rem; border-radius: 9px; cursor: pointer; text-align: left;
  background: rgba(34, 211, 238, .1); border: 1px solid rgba(34, 211, 238, .32); color: #e8ecf2; font: 500 .82rem/1.2 inherit;
}
#${SHEET_ID} button:hover { background: rgba(34, 211, 238, .19); }
#${SHEET_ID} button.nexus-companion-close {
  display: block; margin: .7rem auto 0; background: none; border: 0; color: #93a0b0; text-align: center;
}
#${SHEET_ID} .nexus-companion-muted { color: #a9b3c1; margin: .35rem 0; }
#${SHEET_ID} input, #${SHEET_ID} select {
  width: 100%; margin: .15rem 0 .45rem; padding: .55rem .65rem; border-radius: 9px; box-sizing: border-box;
  border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.35); color: inherit; font: inherit;
}
/* DX1. End experience is a button in the sheet's experience row, beside Pause — not a red
   chip floating in the avatar card's corner. Floating at left/bottom .55rem it sat exactly on
   the footer's first button (🎯 Reset Camera): two controls, one spot, and a tap meant to reset
   the view ended Seaside Evening. In the flow of the sheet it cannot cover anything. */
#${SHEET_ID} #${EXIT_ID} {
  background: rgba(80, 24, 24, .6); border-color: rgba(224, 121, 106, .7); color: #f8ddd7;
}
#${SHEET_ID} #${EXIT_ID}:hover { background: rgba(110, 32, 32, .75); }
#${EXIT_ID}[hidden] { display: none; }
/* DX1. Keyboard focus is visible on every control in the avatar card's footer and this sheet. */
.avatar-footer-actions button:focus-visible, #${SHEET_ID} button:focus-visible, #${SHEET_ID} select:focus-visible,
#${SHEET_ID} input:focus-visible {
  outline: 2px solid #22d3ee; outline-offset: 2px;
}
@media (max-width: 640px) {
  #${BAR_ID} button { padding: .5rem .55rem; }
  #${SHEET_ID} { max-height: 52%; width: calc(100% - 1.5rem); }
}
/* DX2. Close never scrolls away: on a short phone the sheet scrolls, and its only way out was at
   the bottom of the content, cut off by the sheet's own edge. It stays pinned to the bottom. */
#${SHEET_ID} button.nexus-companion-close {
  position: sticky; bottom: -1rem; width: calc(100% + 2.3rem); margin: .7rem -1.15rem -1rem;
  padding: .7rem 1rem; background: rgba(11, 16, 23, .97); border-top: 1px solid rgba(255, 255, 255, .08);
  border-radius: 0 0 14px 14px;
}
/* DX2. Touch screens get 44 px targets in the sheet too. */
@media (pointer: coarse) {
  #${SHEET_ID} button { min-height: 44px; }
  #${SHEET_ID} button.nexus-companion-close { min-height: 44px; padding: .6rem 1.2rem; }
}
`;

    /**
     * DX1. Icon-only buttons in the avatar footer get a spoken name from their tooltip.
     * `title` alone is a hover hint; a screen reader announced "🎯 direct hit" for Reset
     * Camera. Done here rather than in index.html, whose line numbers the parity harness pins.
     */
    function labelFooter(doc) {
        const buttons = doc.querySelectorAll ? doc.querySelectorAll('.avatar-footer-actions button') : [];
        for (const button of buttons) {
            const name = button.getAttribute('title');
            if (name && !button.getAttribute('aria-label')) button.setAttribute('aria-label', name);
        }
    }

    /**
     * DX2. Where the sheet can be without hiding behind the phone's chat sheet.
     *
     * On a phone the chat is an overlay sheet across the bottom of the avatar card, taller than
     * the 4.6 rem the sheet's CSS leaves, so Seaside's choices ran underneath it and the last
     * lines could not be reached. Pure: takes the two rectangles (card and chat, in viewport
     * pixels) and answers the sheet's bottom offset and height cap in pixels, or null when the
     * chat does not overlap the card (desktop: the CSS is already right). The cap also keeps
     * the top of the card — her face — clear: at most 55% of the space above the chat.
     */
    function sheetFit(card, chat, gap) {
        if (!card || !chat) return null;
        const g = gap == null ? 8 : gap;
        if (!(chat.top < card.bottom && chat.bottom > card.top) || chat.left >= card.right || chat.right <= card.left)
            return null;
        const free = chat.top - card.top;
        if (free <= 0) return null;
        return { bottom: Math.round(card.bottom - chat.top + g), maxHeight: Math.round(Math.max(120, free * 0.55)) };
    }

    function el(doc, tag, className, text) {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function attach(options) {
        const options_ = options || {};
        const doc = options_.doc || (typeof document !== 'undefined' ? document : null);
        const session = options_.session;
        const catalog = options_.catalog;
        const bridge = options_.bridge;
        const director = options_.director;
        const memory = options_.memory;
        const privacy = options_.privacy;
        const tasks = options_.tasks;
        const registry = options_.registry;
        if (!doc || !session || !catalog) return { mounted: false, detach: function () {} };

        const storage = options_.storage || null;
        const enabled =
            !options_.navEnabled ||
            options_.navEnabled(storage !== null ? storage : doc.defaultView && doc.defaultView.localStorage);
        if (options_.navEnabled && enabled === false) return { mounted: false, detach: function () {} };

        if (!doc.getElementById(STYLE_ID)) {
            const style = el(doc, 'style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            (doc.head || doc.documentElement).appendChild(style);
        }

        const host = options_.root || doc.querySelector('.avatar-card') || doc.body;
        const bar = el(doc, 'div');
        bar.id = BAR_ID;
        bar.setAttribute('role', 'tablist');
        bar.setAttribute('aria-label', 'Companion destinations');
        const sheet = el(doc, 'div');
        sheet.id = SHEET_ID;
        sheet.hidden = true;
        // DX1. "End experience", not "Exit": Exit read as "leave this screen" next to a sheet
        // whose Close does exactly that. Close dismisses the sheet and never stops anything;
        // this ends the experience. It lives in the sheet (see experienceBlock), not on the card.
        const exit = el(doc, 'button', '', 'End experience');
        exit.id = EXIT_ID;
        exit.type = 'button';
        exit.hidden = true;
        exit.setAttribute('aria-label', 'End the experience');
        host.appendChild(sheet);
        labelFooter(doc);

        let view = 'home';
        let notice = '';

        function paintBar() {
            // IC2: the strip is no longer on the page (see the header).
            if (!bar.parentNode) return;
            bar.textContent = '';
            const current = session.destination();
            for (const destination of catalog.DESTINATIONS) {
                const button = el(doc, 'button', '', destination.label);
                button.type = 'button';
                button.setAttribute('role', 'tab');
                button.setAttribute('aria-pressed', current === destination.id ? 'true' : 'false');
                button.dataset.destination = destination.id;
                button.addEventListener('click', function () {
                    const before = options_.history ? options_.history().length : null;
                    session.setDestination(destination.id);
                    view = 'home';
                    notice = '';
                    sheet.hidden = false;
                    if (options_.onDestination) options_.onDestination(destination.id, before);
                    paint();
                });
                bar.appendChild(button);
            }
        }

        function actionButton(action) {
            const button = el(doc, 'button', '', action.label);
            button.type = 'button';
            button.addEventListener('click', function () {
                const local = ['memories', 'preferences', 'tasks', 'projects', 'planning', 'saved'];
                if (local.indexOf(action.kind) !== -1) {
                    view = action.kind;
                    notice = '';
                    paint();
                    return;
                }
                Promise.resolve(bridge.run(action))
                    .then(function (result) {
                        notice = result && result.ok === false ? result.why || 'Could not start' : '';
                        paint();
                    })
                    .catch(function (error) {
                        notice = String(error && error.message);
                        paint();
                    });
            });
            return button;
        }

        function experienceBlock() {
            if (!director) return;
            const status = director.status();
            const active = status.status === 'active' || status.status === 'paused';
            exit.hidden = !active;
            if (!active) return;
            if (!status.detail) {
                // Running but nothing to show yet: the sheet still offers the way to end it.
                const only = el(doc, 'div', 'nexus-companion-row');
                only.appendChild(exit);
                sheet.appendChild(only);
                return;
            }
            const detail = status.detail;
            sheet.appendChild(el(doc, 'p', 'nexus-companion-muted', detail.line || 'Seaside Evening'));
            const row = el(doc, 'div', 'nexus-companion-row');
            row.appendChild(exit);
            if (status.status === 'active') {
                const pause = el(doc, 'button', '', 'Pause');
                pause.type = 'button';
                pause.addEventListener('click', function () {
                    director.pause();
                    paint();
                });
                row.appendChild(pause);
            } else {
                const resume = el(doc, 'button', '', 'Resume');
                resume.type = 'button';
                resume.addEventListener('click', function () {
                    director.resume();
                    paint();
                });
                row.appendChild(resume);
            }
            for (const choice of detail.choices || []) {
                const button = el(doc, 'button', '', choice.label);
                button.type = 'button';
                button.addEventListener('click', function () {
                    director.choose(choice.id);
                    paint();
                });
                row.appendChild(button);
            }
            if (detail.beat !== 'close') {
                const shell = el(doc, 'button', '', 'Pick up the shell');
                shell.type = 'button';
                shell.addEventListener('click', function () {
                    director.interact('shell');
                    paint();
                });
                const lantern = el(doc, 'button', '', detail.lanternLit ? 'Dim the lantern' : 'Light the lantern');
                lantern.type = 'button';
                lantern.addEventListener('click', function () {
                    director.interact('lantern');
                    paint();
                });
                row.appendChild(shell);
                row.appendChild(lantern);
            } else {
                const finish = el(doc, 'button', '', 'Finish');
                finish.type = 'button';
                finish.addEventListener('click', function () {
                    director.complete();
                    paint();
                });
                row.appendChild(finish);
            }
            sheet.appendChild(row);
        }

        function field(label, node) {
            const wrap = el(doc, 'label', '', label);
            wrap.appendChild(node);
            return wrap;
        }

        function paintHome() {
            const destination = catalog.DESTINATIONS.filter((item) => item.id === session.destination())[0];
            sheet.appendChild(el(doc, 'h2', '', (destination && destination.label) || 'Life'));
            sheet.appendChild(el(doc, 'p', 'nexus-companion-muted', destination ? destination.blurb : ''));
            const row = el(doc, 'div', 'nexus-companion-actions');
            for (const action of catalog.actions(session.destination())) row.appendChild(actionButton(action));
            sheet.appendChild(row);
            if (session.destination() === 'experiences' && registry) {
                const staged = registry
                    .list({ destination: 'experiences' })
                    .filter((item) => item.implemented === false);
                if (staged.length) {
                    sheet.appendChild(el(doc, 'p', 'nexus-companion-muted', 'Not available yet'));
                    for (const item of staged) {
                        sheet.appendChild(
                            el(doc, 'p', 'nexus-companion-muted', item.title + ' — ' + (item.summary || 'not built'))
                        );
                    }
                }
            }
            const focus = options_.focus && options_.focus();
            if (focus && focus.running) {
                sheet.appendChild(
                    el(doc, 'p', 'nexus-companion-muted', 'Focus session: ' + (focus.phase || 'running'))
                );
            }
        }

        function paintMemories() {
            sheet.appendChild(el(doc, 'h2', '', 'Memories'));
            const allowed = privacy.allows(session.destination(), 'life', session.grants());
            if (!allowed.ok) {
                sheet.appendChild(el(doc, 'p', 'nexus-companion-muted', 'Life memories stay in Life.'));
                return;
            }
            const bag = memory.read('life');
            const list = (bag && bag.memories) || [];
            if (!list.length)
                sheet.appendChild(
                    el(doc, 'p', 'nexus-companion-muted', 'Nothing saved yet. Saving is always your choice.')
                );
            for (const item of list) {
                const row = el(doc, 'div', 'nexus-companion-row');
                row.appendChild(el(doc, 'span', '', item.title));
                const remove = el(doc, 'button', '', 'Delete');
                remove.type = 'button';
                remove.addEventListener('click', function () {
                    memory.deleteMemory('life', item.id);
                    paint();
                });
                row.appendChild(remove);
                sheet.appendChild(row);
            }
            const input = el(doc, 'input');
            input.maxLength = 80;
            input.placeholder = 'A moment to keep';
            const save = el(doc, 'button', '', 'Remember this');
            save.type = 'button';
            save.addEventListener('click', function () {
                memory.addMemory('life', { title: input.value, approved: true });
                paint();
            });
            sheet.appendChild(input);
            sheet.appendChild(save);
        }

        function paintPreferences() {
            sheet.appendChild(el(doc, 'h2', '', 'Preferences'));
            const rel = memory.read('life').relationship;
            const voice = session.voice();
            const comfort = session.comfort();
            const style = el(doc, 'select');
            for (const value of ['friendship', 'companionship', 'romance']) {
                const option = el(doc, 'option', '', value);
                option.value = value;
                if (rel.style === value) option.selected = true;
                style.appendChild(option);
            }
            const romance = el(doc, 'select');
            for (const value of ['off', 'light', 'romantic']) {
                const option = el(doc, 'option', '', value);
                option.value = value;
                if (rel.romance === value) option.selected = true;
                romance.appendChild(option);
            }
            const address = el(doc, 'input');
            address.value = rel.address || '';
            address.maxLength = 40;
            const env = el(doc, 'input');
            env.type = 'range';
            env.min = '0';
            env.max = '1';
            env.step = '0.05';
            env.value = String(voice.environment);
            const motion = el(doc, 'input');
            motion.type = 'checkbox';
            motion.checked = comfort.reducedMotion === true;
            const save = el(doc, 'button', '', 'Save preferences');
            save.type = 'button';
            save.addEventListener('click', function () {
                const adult = privacy.allowsAdult(session.destination());
                const romanceValue = romance.value === 'off' || adult.ok ? romance.value : 'off';
                memory.setRelationship({ style: style.value, romance: romanceValue, address: address.value });
                session.setVoice({ environment: Number(env.value) });
                session.setComfort({ reducedMotion: motion.checked });
                if (options_.audio) options_.audio.setLevels(session.voice());
                notice =
                    romance.value !== 'off' && !adult.ok
                        ? 'Romance stays off until adult mode is on, and never in Copilot.'
                        : 'Saved.';
                paint();
            });
            sheet.appendChild(field('Style', style));
            sheet.appendChild(field('Romance', romance));
            sheet.appendChild(field('What to call you', address));
            sheet.appendChild(field('Environment volume', env));
            sheet.appendChild(field('Reduced motion', motion));
            sheet.appendChild(save);
            const grant = el(doc, 'button', '', 'Let Copilot read Life memories');
            grant.type = 'button';
            grant.addEventListener('click', function () {
                session.grantScope('life');
                notice = 'Copilot may read Life memories until you revoke it.';
                paint();
            });
            const revoke = el(doc, 'button', '', 'Revoke that');
            revoke.type = 'button';
            revoke.addEventListener('click', function () {
                session.revokeScope('life');
                notice = 'Revoked.';
                paint();
            });
            sheet.appendChild(grant);
            sheet.appendChild(revoke);
        }

        function paintTasks(mode) {
            sheet.appendChild(
                el(doc, 'h2', '', mode === 'projects' ? 'Projects' : mode === 'planning' ? 'Planning' : 'Tasks')
            );
            sheet.appendChild(
                el(doc, 'p', 'nexus-companion-muted', 'Stored on this device. No calendar or mail is connected.')
            );
            const board = tasks.snapshot(memory);
            if (mode !== 'tasks') {
                for (const project of board.projects) sheet.appendChild(el(doc, 'p', '', project.title));
                const projectTitle = el(doc, 'input');
                projectTitle.placeholder = 'Project name';
                const add = el(doc, 'button', '', 'Add project');
                add.type = 'button';
                add.addEventListener('click', function () {
                    if (projectTitle.value.trim()) tasks.addProject(memory, projectTitle.value.trim());
                    paint();
                });
                sheet.appendChild(projectTitle);
                sheet.appendChild(add);
            }
            for (const task of board.tasks) {
                const row = el(doc, 'div', 'nexus-companion-row');
                const toggle = el(doc, 'button', '', (task.done ? 'Done: ' : '') + task.title);
                toggle.type = 'button';
                toggle.addEventListener('click', function () {
                    tasks.setDone(memory, task.id, !task.done);
                    paint();
                });
                row.appendChild(toggle);
                if (mode === 'planning') {
                    const step = el(doc, 'button', '', 'Add step');
                    step.type = 'button';
                    step.addEventListener('click', function () {
                        tasks.addStep(memory, task.id, 'Next step');
                        paint();
                    });
                    row.appendChild(step);
                    row.appendChild(el(doc, 'span', 'nexus-companion-muted', (task.steps || []).length + ' steps'));
                }
                sheet.appendChild(row);
            }
            const title = el(doc, 'input');
            title.placeholder = 'Task';
            const priority = el(doc, 'select');
            for (const value of ['low', 'normal', 'high']) {
                const option = el(doc, 'option', '', value);
                option.value = value;
                if (value === 'normal') option.selected = true;
                priority.appendChild(option);
            }
            const addTask = el(doc, 'button', '', 'Add task');
            addTask.type = 'button';
            addTask.addEventListener('click', function () {
                if (!title.value.trim()) return;
                const projectId = board.projects[0] ? board.projects[0].id : null;
                tasks.addTask(memory, title.value.trim(), {
                    priority: priority.value,
                    projectId: mode === 'tasks' ? null : projectId,
                });
                paint();
            });
            sheet.appendChild(title);
            sheet.appendChild(priority);
            sheet.appendChild(addTask);
        }

        function paintSaved() {
            sheet.appendChild(el(doc, 'h2', '', 'Saved experiences'));
            const bag = memory.read('experiences');
            const progress = (bag && bag.progress) || {};
            const ids = Object.keys(progress);
            if (!ids.length) sheet.appendChild(el(doc, 'p', 'nexus-companion-muted', 'No experience progress yet.'));
            for (const id of ids) {
                const item = progress[id];
                sheet.appendChild(el(doc, 'p', '', id + (item.beat ? ' · ' + item.beat : '')));
            }
        }

        function paint() {
            paintBar();
            sheet.textContent = '';
            const back = el(doc, 'button', 'nexus-companion-close', view === 'home' ? 'Close' : 'Back');
            back.type = 'button';
            back.addEventListener('click', function () {
                if (view === 'home') sheet.hidden = true;
                else {
                    view = 'home';
                    paint();
                }
            });
            experienceBlock();
            if (view === 'memories') paintMemories();
            else if (view === 'preferences') paintPreferences();
            else if (view === 'tasks' || view === 'projects' || view === 'planning') paintTasks(view);
            else if (view === 'saved') paintSaved();
            // DX2. While an experience runs, the sheet is its controls and nothing else. It used
            // to add the whole destination menu underneath — Seaside's own buttons, then a
            // second list offering Seaside again — which on a phone pushed both off the screen.
            else if (!running()) paintHome();
            if (notice) sheet.appendChild(el(doc, 'p', 'nexus-companion-muted', notice));
            // At the bottom, like Together's own Back.
            sheet.appendChild(back);
            const status = director && director.status();
            exit.hidden = !(status && (status.status === 'active' || status.status === 'paused'));
            fitSheet();
        }

        function running() {
            const status = director && director.status();
            return !!(status && (status.status === 'active' || status.status === 'paused'));
        }

        /** DX2. Keep the sheet above the phone's chat sheet (see sheetFit). Fail soft: CSS stays. */
        function fitSheet() {
            sheet.style.bottom = '';
            sheet.style.maxHeight = '';
            if (sheet.hidden || typeof host.getBoundingClientRect !== 'function') return;
            try {
                const chat = doc.querySelector('.chat-card');
                let below = chat ? chat.getBoundingClientRect() : null;
                // The experience mini-player docks on top of the chat sheet on a phone (DX2);
                // the sheet ends above whichever of the two is higher.
                const bar = doc.getElementById('nexus-activity-pill');
                if (below && bar && !bar.hidden) {
                    const r = bar.getBoundingClientRect();
                    if (r.height > 0 && r.top < below.top)
                        below = { top: r.top, bottom: below.bottom, left: below.left, right: below.right };
                }
                const fit = below ? sheetFit(host.getBoundingClientRect(), below) : null;
                if (!fit) return;
                sheet.style.bottom = fit.bottom + 'px';
                sheet.style.maxHeight = fit.maxHeight + 'px';
            } catch (_) {
                /* the CSS position stands */
            }
        }

        exit.addEventListener('click', function () {
            if (director) director.stop('exit');
            view = 'home';
            paint();
        });

        const unsubscribe = director
            ? director.on(function () {
                  paint();
              })
            : function () {};
        const unsubscribeSession =
            session && typeof session.on === 'function'
                ? session.on(function (detail) {
                      if (detail && detail.type === 'destination:changed') paintBar();
                  })
                : function () {};

        paint();

        return {
            mounted: true,
            root: host,
            open: function () {
                sheet.hidden = false;
                paint();
            },
            show: function (destination, nextView) {
                if (destination && session && typeof session.setDestination === 'function') {
                    session.setDestination(destination);
                }
                view = nextView && nextView !== 'home' ? nextView : 'home';
                notice = '';
                sheet.hidden = false;
                paint();
            },
            paint: paint,
            detach: function () {
                unsubscribe();
                unsubscribeSession();
                if (bar.parentNode) bar.parentNode.removeChild(bar);
                if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
                if (exit.parentNode) exit.parentNode.removeChild(exit);
                const style = doc.getElementById(STYLE_ID);
                if (style && style.parentNode) style.parentNode.removeChild(style);
            },
        };
    }

    return { attach: attach, sheetFit: sheetFit, CSS: CSS, BAR_ID: BAR_ID, SHEET_ID: SHEET_ID, EXIT_ID: EXIT_ID };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_BAR = DestinationBar;
if (typeof module !== 'undefined' && module.exports) module.exports = DestinationBar;
