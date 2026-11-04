/**
 * TaskBoard — tasks and projects kept in the Copilot memory scope (IC1).
 *
 * There is no calendar, mail, or file integration behind this. The board is
 * the local fallback, and it says so by never inventing a sync status.
 * Nothing is deleted except by `remove`, which the UI only calls from a
 * button the person pressed.
 *
 * Exposes: window.NEXUS_COMPANION_TASKS
 */
const TaskBoard = (() => {
    'use strict';

    function snapshot(memory) {
        const bag = memory.read('copilot') || { tasks: [], projects: [] };
        return {
            tasks: (bag.tasks || []).map((task) => Object.assign({}, task)),
            projects: (bag.projects || []).map((project) => Object.assign({}, project)),
        };
    }

    function write(memory, tasks, projects) {
        return memory.saveTasks(tasks, projects);
    }

    function addTask(memory, title, extra) {
        const board = snapshot(memory);
        const options = extra || {};
        const task = {
            id: 'task_' + Date.now().toString(36) + '_' + board.tasks.length,
            title: title,
            priority: options.priority || 'normal',
            done: false,
            projectId: options.projectId || null,
            steps: Array.isArray(options.steps) ? options.steps : [],
        };
        board.tasks.push(task);
        write(memory, board.tasks, board.projects);
        return task;
    }

    function addProject(memory, title) {
        const board = snapshot(memory);
        const project = {
            id: 'prj_' + Date.now().toString(36) + '_' + board.projects.length,
            title: title,
            summary: '',
        };
        board.projects.push(project);
        write(memory, board.tasks, board.projects);
        return project;
    }

    function setDone(memory, id, done) {
        const board = snapshot(memory);
        const task = board.tasks.filter((item) => item.id === id)[0];
        if (!task) return null;
        task.done = done === true;
        write(memory, board.tasks, board.projects);
        return task;
    }

    function addStep(memory, taskId, title) {
        const board = snapshot(memory);
        const task = board.tasks.filter((item) => item.id === taskId)[0];
        if (!task) return null;
        task.steps = task.steps || [];
        task.steps.push({ title: title, done: false });
        write(memory, board.tasks, board.projects);
        return task;
    }

    function removeTask(memory, id) {
        const board = snapshot(memory);
        const next = board.tasks.filter((item) => item.id !== id);
        if (next.length === board.tasks.length) return false;
        write(memory, next, board.projects);
        return true;
    }

    return {
        snapshot: snapshot,
        addTask: addTask,
        addProject: addProject,
        setDone: setDone,
        addStep: addStep,
        removeTask: removeTask,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_TASKS = TaskBoard;
if (typeof module !== 'undefined' && module.exports) module.exports = TaskBoard;
