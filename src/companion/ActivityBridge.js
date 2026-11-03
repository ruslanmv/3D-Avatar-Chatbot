/**
 * ActivityBridge — destinations call the activities that already exist (IC1).
 *
 * This file does not request a camera, a microphone, or a screen. Those
 * prompts belong to the Together panel and to the activity that owns the
 * grant. Opening Watch from Life calls `panel.choose('watch')`, which shows
 * the setup sentence the panel already had. A second request here would
 * revoke the first one: ConsentMachine replaces a live grant when asked again.
 *
 * A test keeps device-capture calls out of this file.
 *
 * Exposes: window.NEXUS_COMPANION_BRIDGE
 */
const ActivityBridge = (() => {
    'use strict';

    function create(options) {
        const options_ = options || {};

        function panel() {
            if (options_.panel) return options_.panel;
            const director = options_.director && options_.director();
            return director && director.togetherPanel ? director.togetherPanel : null;
        }

        function doc() {
            return options_.doc || (typeof document !== 'undefined' ? document : null);
        }

        async function run(action) {
            if (!action || !action.kind) return { ok: false, why: 'no-action' };
            if (action.kind === 'focus-chat' || action.kind === 'research' || action.kind === 'study') {
                const root = doc();
                const input = root && root.getElementById ? root.getElementById('speech-text') : null;
                if (input && typeof input.focus === 'function') input.focus();
                if (action.kind === 'research' && input) {
                    input.setAttribute(
                        'placeholder',
                        'Ask in the chat. Research uses the lookup you already enabled in Settings.'
                    );
                }
                if (action.kind === 'study') {
                    const loop = options_.study ? options_.study() : null;
                    if (loop && typeof loop.open === 'function') {
                        try {
                            loop.open();
                        } catch (_) {
                            /* the chat box is still focused */
                        }
                    }
                    if (input) input.setAttribute('placeholder', 'What do you want to understand?');
                    return { ok: true, why: loop ? 'study' : 'chat-only' };
                }
                const lookup = options_.lookup ? options_.lookup() : null;
                return {
                    ok: true,
                    why: action.kind === 'research' ? (lookup ? 'lookup-in-chat' : 'chat-only') : 'chat',
                };
            }
            if (action.kind === 'together-open') {
                const host = panel();
                if (!host || typeof host.choose !== 'function') return { ok: false, why: 'together-unavailable' };
                if (typeof host.open === 'function') host.open();
                return host.choose(action.activity);
            }
            if (action.kind === 'together-start') {
                const host = panel();
                if (!host || typeof host.startActivity !== 'function')
                    return { ok: false, why: 'together-unavailable' };
                return host.startActivity(action.activity, action.input || null);
            }
            if (action.kind === 'pose-studio') {
                const root = doc();
                const button = root && root.getElementById ? root.getElementById('openPoseStudioBtn') : null;
                if (!button) return { ok: false, why: 'pose-studio-unavailable' };
                if (typeof button.click === 'function') button.click();
                return { ok: true, why: 'pose-studio' };
            }
            if (action.kind === 'experience') {
                const experiences = options_.experiences;
                if (!experiences || typeof experiences.start !== 'function') return { ok: false, why: 'no-director' };
                return experiences.start(action.experienceId);
            }
            return { ok: false, why: 'unhandled' };
        }

        return { run: run };
    }

    return { create: create };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_BRIDGE = ActivityBridge;
if (typeof module !== 'undefined' && module.exports) module.exports = ActivityBridge;
