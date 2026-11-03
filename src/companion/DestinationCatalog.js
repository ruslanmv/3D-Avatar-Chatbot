/**
 * DestinationCatalog — the three destinations and the actions under each (IC1).
 *
 * An action names an existing Together activity, the chat box, or Seaside
 * Evening. It does not name a second model. Staged experiences are not in
 * this list: they are registry entries with `implemented: false`, and the
 * sheet renders them as unavailable rather than as buttons that start.
 *
 * Watch, music, focus, and screen help open the existing setup screen. That
 * screen already explains a permission before it asks. Starting those from
 * here with a synthetic input would skip that sentence or ask twice.
 *
 * Relax is the exception: "Just sit with me" captures nothing, so it may
 * start directly.
 *
 * Exposes: window.NEXUS_COMPANION_CATALOG
 */
const DestinationCatalog = (() => {
    'use strict';

    const DESTINATIONS = Object.freeze([
        { id: 'life', label: 'Life', blurb: 'Connect with your companion.' },
        { id: 'copilot', label: 'Copilot', blurb: 'Achieve things with your companion.' },
        { id: 'experiences', label: 'Experiences', blurb: 'Explore immersive worlds with your companion.' },
    ]);

    const ACTIONS = Object.freeze({
        life: [
            { id: 'talk', label: 'Talk', kind: 'focus-chat' },
            {
                id: 'relax',
                label: 'Relax',
                kind: 'together-start',
                activity: 'focus',
                input: { id: 'sit', permission: null, note: 'No talking, no topic' },
            },
            { id: 'moments', label: 'Shared moments', kind: 'together-open', activity: 'music' },
            { id: 'memories', label: 'Memories', kind: 'memories' },
            { id: 'watch', label: 'Watch or listen', kind: 'together-open', activity: 'watch' },
            { id: 'preferences', label: 'Preferences', kind: 'preferences' },
        ],
        copilot: [
            { id: 'tasks', label: 'Tasks', kind: 'tasks' },
            { id: 'projects', label: 'Projects', kind: 'projects' },
            { id: 'planning', label: 'Planning', kind: 'planning' },
            { id: 'focus', label: 'Focus', kind: 'together-open', activity: 'focus' },
            { id: 'learn', label: 'Learn', kind: 'study' },
            { id: 'research', label: 'Research and help', kind: 'research' },
            { id: 'vision', label: 'Screen help', kind: 'together-open', activity: 'copilot' },
        ],
        experiences: [
            { id: 'seaside', label: 'Seaside Evening', kind: 'experience', experienceId: 'seaside-evening' },
            { id: 'scene-tale', label: 'Scene Tale', kind: 'together-open', activity: 'playground' },
            { id: 'studio', label: 'Character studio', kind: 'pose-studio' },
            { id: 'saved', label: 'Saved experiences', kind: 'saved' },
        ],
    });

    function actions(destination) {
        return (ACTIONS[destination] || []).map((action) => Object.assign({}, action));
    }

    return { DESTINATIONS: DESTINATIONS, ACTIONS: ACTIONS, actions: actions };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_CATALOG = DestinationCatalog;
if (typeof module !== 'undefined' && module.exports) module.exports = DestinationCatalog;
