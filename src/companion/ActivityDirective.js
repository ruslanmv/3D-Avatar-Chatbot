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

    /** A chosen place is spatial presence, not an activity that a reply may replace. */
    function isPlaceActive(session) {
        return Boolean(
            session &&
                typeof session.active === 'function' &&
                session.active() &&
                typeof session.activity === 'function' &&
                /^place-[a-z0-9-]+$/.test(String(session.activity() || ''))
        );
    }

    function systemPromptSuffix(enabled, placeActive = false) {
        if (!enabled) return '';
        if (placeActive) {
            // LW4. Inside a place the same tags mean "here": never a different world.
            return (
                '\n\nYou are both in a place the person chose, and it stays until they leave it. When they ' +
                'ask for it or clearly agree, you can change how you are together right here by ending your ' +
                'reply with one tag: <activity name="relax"/> (quiet company), <activity name="story"/> (a ' +
                'short story set in this very place) or <activity name="focus"/> (they want to concentrate). ' +
                'These never change the place. Only one tag; leaving is their End button.'
            );
        }
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
        // LW1: an assistant-suggested context change must not silently replace a user-chosen
        // environment. Until in-place activities and verified user intent are implemented,
        // refuse model activity tags (including End) rather than allow an unrequested exit.
        // The existing user-controlled End button still ends a place normally.
        if (isPlaceActive(session)) {
            // LW4. Relax, focus and story happen HERE: her manner changes, the world does not.
            // Seaside and End still never run from her reply while a place is up — End is the
            // person's own button, and Seaside would replace the place.
            if (['relax', 'focus', 'story'].includes(call.name) && typeof d.inPlace === 'function') {
                return d.inPlace(call.name);
            }
            return { ok: false, why: 'place-active' };
        }
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
