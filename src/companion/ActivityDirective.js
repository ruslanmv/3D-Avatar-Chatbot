/**
 * ActivityDirective — she can start what you ask for: `<activity name="relax"/>` (IC3).
 *
 * The menu is a shortcut, not the only door. "Let's just relax for a bit", "help me focus for
 * 25 minutes", "take me to the beach" — the person should be able to say it, and she should be
 * able to do it, exactly as tapping Together ▸ Life ▸ Relax together does. This is the sixth
 * instance of the capability pattern (CLAUDE.md ▸ LLM capability pattern):
 *
 *     switch      NEXUS_TOGETHER_SWITCH.isOn() — Together itself, checked again when it runs
 *     capability  systemPromptSuffix(): the five names, '' while Together is off
 *     directive   extract / strip / execute on her replies only, one per reply
 *     app code    the Together panel, the experience director, the companion session
 *
 * Names are a closed set; anything else is stripped and refused with a warning. `minutes` is
 * clamped to 5–90. The tag is removed at the `displayText` seam in main.js, so the bubble, the
 * transcript, the VR forward and TTS never see it. A tag the person typed never reaches this:
 * only replies go through `consume`.
 *
 * Starts are `silent` for ActivityVoice — she has just said, in the same reply, why.
 *
 * Exposes: window.NEXUS_COMPANION_DIRECTIVE
 */
const ActivityDirective = (() => {
    'use strict';

    const NAMES = Object.freeze(['relax', 'focus', 'seaside', 'story', 'end']);
    const TAG =
        /<activity\s+name\s*=\s*["']([a-z-]{1,20})["'](?:\s+minutes\s*=\s*["']?(\d{1,3})["']?)?\s*\/?>(?:\s*<\/activity>)?/i;
    const ANY = /<\/?activity\b[^>]{0,120}>/gi;

    /** { call: {name, minutes} | null, clean, rejected? }. Pure. */
    function extract(text) {
        const source = String(text == null ? '' : text);
        const match = source.match(TAG);
        const clean = source
            .replace(ANY, ' ')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();
        if (!match) return { call: null, clean };
        const name = match[1].toLowerCase();
        if (NAMES.indexOf(name) === -1) return { call: null, clean, rejected: 'unknown activity ' + name };
        const minutes = match[2] ? Math.min(90, Math.max(5, Number(match[2]))) : null;
        return { call: { name, minutes }, clean };
    }

    function systemPromptSuffix(enabled) {
        if (!enabled) return '';
        return (
            '\n\nWhen the person asks for it or clearly agrees, you can start an activity with them by ' +
            'ending your reply with one tag: <activity name="relax"/> (quiet company, no topic), ' +
            '<activity name="focus" minutes="25"/> (a focus block while they work), ' +
            '<activity name="seaside"/> (a seaside evening scene), <activity name="story"/> (a short ' +
            'story set where you are), or <activity name="end"/> (end the current one). Only one tag, ' +
            'only when they want it, and never claim it started before the app has shown it.'
        );
    }

    /**
     * Run a call. `deps`: { session, panel(), director, enabled() }. Resolves to {ok, why}.
     * Fail soft: a call that cannot run warns and leaves her reply alone.
     */
    async function run(call, deps) {
        const d = deps || {};
        if (!call) return { ok: false, why: 'no-call' };
        if (d.enabled && !d.enabled()) return { ok: false, why: 'together-off' };
        const session = d.session;
        const panel = d.panel ? d.panel() : null;
        const enter = (destination, activity) => {
            if (session && typeof session.enter === 'function') {
                session.enter(destination, activity, { source: 'together', silent: true });
            }
        };
        if (call.name === 'end') {
            if (panel && panel.activeActivity && typeof panel.stopActivity === 'function') panel.stopActivity('end');
            const status = d.director && d.director.status ? d.director.status() : null;
            if (status && (status.status === 'active' || status.status === 'paused')) d.director.stop('end');
            if (session && typeof session.end === 'function') session.end({ silent: true });
            return { ok: true, why: 'ended' };
        }
        if (call.name === 'seaside') {
            if (!d.director || typeof d.director.start !== 'function') return { ok: false, why: 'no-director' };
            enter('experiences', 'seaside');
            return d.director.start('seaside-evening');
        }
        if (!panel || typeof panel.startActivity !== 'function') return { ok: false, why: 'together-unavailable' };
        if (call.name === 'relax') {
            enter('life', 'relax');
            return panel.startActivity('focus', { id: 'sit', permission: null });
        }
        if (call.name === 'focus') {
            enter('copilot', 'work');
            return panel.startActivity('focus', { id: 'work', permission: null, minutes: call.minutes || 25 });
        }
        if (call.name === 'story') {
            const activity = panel.activities && panel.activities.get && panel.activities.get('playground');
            if (!activity || typeof panel.choose !== 'function') return { ok: false, why: 'playground-unavailable' };
            enter('experiences', 'scene-tale');
            activity.playgroundId = 'scene-tale';
            activity.sessionState = 'configure';
            if (typeof panel.open === 'function') panel.open();
            return panel.choose('playground');
        }
        return { ok: false, why: 'unhandled' };
    }

    /** Strip the tag from a reply and run it. Returns the text to show and speak. */
    function consume(text, deps) {
        const extracted = extract(text);
        if (extracted.rejected) {
            console.warn('[Companion] activity tag refused: ' + extracted.rejected);
            return extracted.clean;
        }
        if (!extracted.call) return extracted.clean;
        try {
            Promise.resolve(run(extracted.call, deps)).then(
                (result) => {
                    if (result && result.ok === false)
                        console.warn('[Companion] activity did not start: ' + result.why);
                },
                (error) => console.warn('[Companion] activity did not start', error)
            );
        } catch (error) {
            console.warn('[Companion] activity did not start', error);
        }
        return extracted.clean;
    }

    return { NAMES, TAG, extract, systemPromptSuffix, run, consume };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_DIRECTIVE = ActivityDirective;
if (typeof module !== 'undefined' && module.exports) module.exports = ActivityDirective;
