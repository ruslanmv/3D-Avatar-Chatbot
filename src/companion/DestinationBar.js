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
#${SHEET_ID} {
  position: absolute; left: .5rem; right: .5rem; bottom: .5rem; z-index: 33;
  max-height: 46%; overflow: auto; padding: .75rem .8rem .85rem; border-radius: 12px;
  background: rgba(11, 16, 23, .94); border: 1px solid rgba(34, 211, 238, .28); color: #e8ecf2;
  font: 400 .8rem/1.35 system-ui, sans-serif;
}
#${SHEET_ID}[hidden] { display: none; }
#${SHEET_ID} h2 { margin: 0 0 .2rem; font-size: .68rem; letter-spacing: .14em; color: #22d3ee; }
#${SHEET_ID} .nexus-companion-actions, #${SHEET_ID} .nexus-companion-row { display: flex; flex-wrap: wrap; gap: .35rem; }
#${SHEET_ID} button, #${EXIT_ID} {
  border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); color: inherit;
  border-radius: 8px; padding: .4rem .6rem; cursor: pointer; font: inherit;
}
#${SHEET_ID} .nexus-companion-muted { color: #93a0b0; margin: .35rem 0; }
#${SHEET_ID} input, #${SHEET_ID} select {
  width: 100%; margin: .15rem 0 .4rem; padding: .35rem .45rem; border-radius: 8px;
  border: 1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.35); color: inherit; font: inherit;
}
#${EXIT_ID} {
  position: absolute; left: .55rem; bottom: .55rem; z-index: 34;
  background: rgba(80, 24, 24, .88); border-color: rgba(224, 121, 106, .7);
}
#${EXIT_ID}[hidden] { display: none; }
@media (max-width: 640px) {
  #${BAR_ID} button { padding: .5rem .55rem; }
  #${SHEET_ID} { max-height: 52%; }
}
`;

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
        const exit = el(doc, 'button', '', 'Exit');
        exit.id = EXIT_ID;
        exit.type = 'button';
        exit.hidden = true;
        host.appendChild(sheet);
        host.appendChild(exit);

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
            if (!active || !status.detail) return;
            const detail = status.detail;
            sheet.appendChild(el(doc, 'p', 'nexus-companion-muted', detail.line || 'Seaside Evening'));
            const row = el(doc, 'div', 'nexus-companion-row');
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
            const back = el(doc, 'button', '', view === 'home' ? 'Close' : 'Back');
            back.type = 'button';
            back.addEventListener('click', function () {
                if (view === 'home') sheet.hidden = true;
                else {
                    view = 'home';
                    paint();
                }
            });
            sheet.appendChild(back);
            experienceBlock();
            if (view === 'memories') paintMemories();
            else if (view === 'preferences') paintPreferences();
            else if (view === 'tasks' || view === 'projects' || view === 'planning') paintTasks(view);
            else if (view === 'saved') paintSaved();
            else paintHome();
            if (notice) sheet.appendChild(el(doc, 'p', 'nexus-companion-muted', notice));
            const status = director && director.status();
            exit.hidden = !(status && (status.status === 'active' || status.status === 'paused'));
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

    return { attach: attach, CSS: CSS, BAR_ID: BAR_ID, SHEET_ID: SHEET_ID, EXIT_ID: EXIT_ID };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_BAR = DestinationBar;
if (typeof module !== 'undefined' && module.exports) module.exports = DestinationBar;
