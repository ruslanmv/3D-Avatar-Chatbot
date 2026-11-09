/**
 * ActivityVoice — she says something when an activity starts or ends (IC3).
 *
 * Reviewing every Together choice on the real page found the same thing each time: you chose
 * Relax, a place, a story, and she said nothing. The background changed, a line appeared in the
 * chat, and the companion the whole app is built around was absent from the moment. A friend
 * you invite to sit with you says "Sure. I'm here." — once — and then lets it be quiet.
 *
 * So, once per activity started from Together (and once when it is ended), one short line in
 * her own words, through the same path Try-On's hosted lines take:
 *
 * - **One bounded model call per start**, never per frame and never per turn. A newer start
 *   replaces a waiting one, so tapping through options does not queue a monologue.
 * - **Her words, not a script.** The model is asked for one short sentence with the activity
 *   named; the companion context (PromptContext) is already in its prompt.
 * - **The usual guarantees**: no line after a CLEAR (epoch check), none while the person is
 *   mid-turn, none when no model is configured (`callLLM` answers "Provider not configured."
 *   rather than throwing — that sentence is never posted), tags stripped, and the line goes
 *   into the chat and the history like any reply of hers.
 * - **Her posture follows** through `BehaviorRouter.request` (relax, listen, smile), which only
 *   asks the existing behaviour system — it owns no animation.
 *
 * A start that came from her own `<activity>` tag is `silent`: she has just said why.
 *
 * Exposes: window.NEXUS_COMPANION_VOICE
 */
const ActivityVoice = (() => {
    'use strict';

    const NOT_CONFIGURED = /^provider not configured\.?$/i;
    const MAX_CHARS = 220;

    /** Which posture each activity asks the behaviour system for. Pure. */
    function posture(destination, activity) {
        if (activity === 'relax' || activity === 'meditation' || activity === 'forest') return 'relax';
        if (destination === 'copilot') return 'listen';
        if (activity === 'move') return 'look_at_user';
        return 'smile';
    }

    /** The instruction for the model. Pure. */
    function instruction(kind, label) {
        const what = label || 'this';
        if (kind === 'end') {
            return (
                `[The person just ended "${what}". Say one short, warm closing sentence in your own words, ` +
                'at most 12 words. No tags, no question.]'
            );
        }
        return (
            `[The person just chose "${what}" with you. Say one short, natural sentence to begin it together, ` +
            'in your own words, at most 15 words. Do not mention menus, buttons or modes. No tags. ' +
            'At most one question.]'
        );
    }

    /** Text safe to post: no tags, one paragraph, bounded. Pure. */
    /**
     * AX16. Through the shared cleaner, so her start/end line loses the ```motion plan (and runs it,
     * as the main chat does: the plan is usually "look at the person", which is right for a
     * greeting), any "THOUGHT:" paragraph and every directive. This used to strip only `<tags>`, and
     * the motion block every prompt asks for was posted into the chat verbatim.
     */
    function clean(text, g) {
        const shared = g && g.NEXUS_REPLY_CLEAN;
        const raw = String(text == null ? '' : text);
        const value = (
            shared && typeof shared.forDisplay === 'function'
                ? shared.forDisplay(raw, { global: g, run: true })
                : raw.replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/<[^>]{0,200}>/g, ' ')
        )
            .replace(/\s+/g, ' ')
            .trim();
        if (!value || NOT_CONFIGURED.test(value)) return '';
        return value.length > MAX_CHARS ? value.slice(0, MAX_CHARS - 1).replace(/\s+\S*$/, '') + '…' : value;
    }

    function attach(options) {
        const o = options || {};
        const g = o.global || (typeof window !== 'undefined' ? window : {});
        const session = o.session;
        if (!session || typeof session.on !== 'function') return { mounted: false, detach() {} };
        const label = o.label || ((id) => id || '');
        const ask = o.ask || ((text) => (typeof g.callLLM === 'function' ? g.callLLM(text) : Promise.resolve('')));
        const surface = () => o.surface || g.NEXUS_CONVERSATION_SURFACE || null;
        const reset = () => o.reset || g.NEXUS_CONVERSATION_RESET || null;
        const say = () => o.say || g.NEXUS_BD_SAY || null;
        const behavior = o.behavior || null;
        // Tasks and Learn already open with her own question from their loops; a second
        // line on top read as her talking over herself.
        const skip = new Set(o.skip || ['tasks', 'learn']);
        // Activities that need something granted first (the camera for Move together): a
        // fast model answered before the permission prompt did, and she greeted an exercise
        // that then failed. These wait until the panel says the activity is really running.
        const confirm = o.confirm || { move: 'coach' };
        const panel = () => (o.panel ? o.panel() : null);
        const CONFIRM_MS = o.confirmMs || 20000;

        let generation = 0;
        let lastExplicit = null;

        function idle() {
            try {
                const s = surface();
                const turn = s && typeof s.turn === 'function' ? s.turn() : null;
                return !turn || !turn.phase || turn.phase === 'idle';
            } catch (_) {
                return true;
            }
        }

        /** Resolves true once the panel runs `owner`; false if the start failed or was replaced. */
        function running(owner, activity, mine) {
            const isRunning = () => {
                try {
                    const p = panel();
                    return !!(p && p.activeActivity === owner);
                } catch (_) {
                    return false;
                }
            };
            if (isRunning()) return Promise.resolve(true);
            return new Promise((resolve) => {
                const started = Date.now();
                const timer = setInterval(() => {
                    const gone = mine !== generation || !(session.active() && session.activity() === activity);
                    if (isRunning() || gone || Date.now() - started > CONFIRM_MS) {
                        clearInterval(timer);
                        resolve(!gone && isRunning());
                    }
                }, 200);
            });
        }

        async function speak(kind, destination, activity) {
            const mine = ++generation;
            const r = reset();
            let epoch = null;
            try {
                epoch = r && typeof r.currentEpoch === 'function' ? r.currentEpoch() : null;
            } catch (_) {
                epoch = null;
            }
            let reply;
            try {
                reply = await ask(instruction(kind, label(activity)));
            } catch (error) {
                console.warn('[Companion] she could not be asked for a line', error);
                return null;
            }
            if (mine !== generation) return null; // a newer start replaced this one
            if (kind === 'start' && confirm[activity] && !(await running(confirm[activity], activity, mine)))
                return null;
            if (mine !== generation) return null;
            // A start that failed while she was being asked (a blocked camera) ends the session:
            // greeting an activity that is not happening is worse than saying nothing.
            if (kind === 'start' && !(session.active() && session.activity() === activity)) return null;
            const line = clean(reply && typeof reply === 'object' ? reply.text || reply.content : reply, g);
            if (!line) return null;
            try {
                if (r && typeof r.isCurrent === 'function' && !r.isCurrent(epoch)) return null; // CLEAR in between
            } catch (_) {
                /* treat as current */
            }
            if (!idle()) return null; // the person is talking: the moment has passed
            const s = surface();
            if (!s || typeof s.renderAssistant !== 'function') return null;
            try {
                s.renderAssistant(line);
                const store = typeof s.history === 'function' ? s.history() : null;
                if (store && typeof store.addMessage === 'function') store.addMessage('assistant', line);
                if (store && typeof store.persist === 'function') store.persist();
            } catch (error) {
                console.warn('[Companion] her line could not be posted', error);
                return null;
            }
            try {
                const speakOut = say();
                if (typeof speakOut === 'function') speakOut(line);
            } catch (_) {
                /* the line on screen is what matters */
            }
            return line;
        }

        const off = session.on(function (detail) {
            if (!detail) return;
            if (detail.type === 'session:entered') {
                if (detail.source !== 'together') return;
                lastExplicit = { destination: detail.destination, activity: detail.activity };
                if (behavior && typeof behavior.request === 'function') {
                    try {
                        behavior.request(posture(detail.destination, detail.activity), { reason: 'activity' });
                    } catch (_) {
                        /* posture is a nicety */
                    }
                }
                if (detail.silent || skip.has(detail.activity)) return;
                speak('start', detail.destination, detail.activity);
            } else if (detail.type === 'session:ended') {
                const was = lastExplicit;
                lastExplicit = null;
                if (!was || detail.silent) return;
                speak('end', was.destination, was.activity);
            }
        });

        return { mounted: true, speak, detach: off };
    }

    return { attach, posture, instruction, clean };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_VOICE = ActivityVoice;
if (typeof module !== 'undefined' && module.exports) module.exports = ActivityVoice;
