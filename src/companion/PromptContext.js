/**
 * PromptContext — what the model is allowed to know about the destination (IC1).
 *
 * Empty until the person has actually used the destinations. A fresh install
 * therefore sends the same system prompt it sent before this module existed.
 *
 * When it does speak, it speaks in closed enums and approved titles. Copilot's
 * paragraph lists tasks and states the isolation rule. It never includes a
 * relationship preference, a private entry, or a story beat. Life and
 * Experiences may include the relationship enums and approved memory titles.
 * They never include Copilot task text — work notes do not belong in a
 * conversation about the evening.
 *
 * The paragraph also says the model cannot touch the camera, the microphone,
 * or the renderer. Those stay behind the app's own services.
 *
 * Exposes: window.NEXUS_COMPANION_PROMPT
 */
const PromptContext = (() => {
    'use strict';

    /*
     * IC2. How she talks, in every destination. The destination changes what
     * she is doing with the person, never who she is. Measured complaints this
     * answers: replies that ran to paragraphs for "I've had a long day", a
     * greeting at the top of every turn, a question closing every reply, and an
     * affectionate flourish repeated word for word turn after turn.
     */
    const STYLE =
        'How to talk: most replies are one to three conversational sentences; go longer only when they ask ' +
        'or the task needs it. Vary how you start; do not greet again in the middle of a conversation; you ' +
        'do not have to end with a question; a short reply or a quiet moment is fine. Do not announce ' +
        'what kind of moment this is or name a mode; just be in it. Do not claim to be human or to feel ' +
        'what you do not.';

    /** Said once, before the moment: one companion, one conversation. */
    const SAME = '\n\nYou are the same companion throughout this conversation; this only says what is going on now.';

    /** One sentence per Together option, so the context says what was actually chosen. */
    const ACTIVITY = Object.freeze({
        talk: 'They want to talk.',
        relax: 'They want to relax: keep it calm and unhurried, short replies, no tasks and no new topics.',
        help: 'They want help getting something done.',
        work: 'A focus block is running on what they are working on: stay quiet unless they speak, keep replies brief.',
        move: 'You are exercising together with the camera coach: short, encouraging, about the movement.',
        forest: 'You are under the trees together: unhurried, a few words about the place at most.',
        meditation: 'Ten quiet minutes together: very few words, calm, no questions.',
        explore: 'They want to go somewhere or try something together.',
        'life-evening': 'You are spending an evening together, a short shared story with choices.',
        'copilot-hour': 'They opened Copilot Hour in Together.',
        tasks: 'They opened their task list.',
        'focus-block': 'A focus block is running: keep replies brief and do not start new topics.',
        learn: 'They want to learn a topic: explain step by step and check understanding briefly.',
        seaside: 'They chose Seaside Evening.',
        'scene-tale': 'They chose Scene Tale, a story you play through together.',
    });

    const GESTURE_OFFER =
        /^If a small gesture fits, you may end a reply with one tag: <gesture intent="smile"\/>, <gesture intent="look_at_user"\/>(?:, <gesture intent="dance"\/>, <gesture intent="stop_dancing"\/>)?(?:, or <gesture intent="look_at_object" target="[a-z0-9-]{1,30}(?:\|[a-z0-9-]{1,30}){0,4}"\/>)?\. It is optional, never shown, and you must not say you did it\.$/;

    /**
     * LW3–LW5. WorldPresence's tag offer, accepted only in its exact generated shape: two fixed
     * sentences and ids of [a-z0-9-]. Nothing a manifest, a label or a reply wrote can widen it.
     */
    const IDS = '[a-z0-9-]{1,30}(?:\\|[a-z0-9-]{1,30}){0,11}';
    const GO_SPOT =
        'When they ask to move within this place, end your reply with one tag: <go spot="' + IDS + '"\\/>\\.';
    const GO_PLACE =
        'To suggest going somewhere else, ask them and end with <go place="' +
        IDS +
        '"\\/>; nothing changes until they say yes\\.';
    const GO_OFFER = new RegExp('^(?:' + GO_SPOT + '(?: ' + GO_PLACE + ')?|' + GO_PLACE + ')$');

    /** LW3. The shared moment (where you are, what is here), sanitised and bounded here again. */
    function presenceLine(src) {
        return typeof src.presence === 'string' && src.presence
            ? src.presence.replace(/[<>{}[\]`]/g, '').slice(0, 1100)
            : '';
    }

    function activityLine(id) {
        return (id && ACTIVITY[id]) || '';
    }

    function suffix(input) {
        const src = input || {};
        if (!src.customized) return '';
        // IC2: ending the session in the chat ("End") takes the context away again.
        if (src.active === false) return '';
        const destination = src.destination || 'life';
        const activity = activityLine(src.activity);
        if (destination === 'copilot') {
            const tasks = Array.isArray(src.tasks) ? src.tasks.filter((t) => t && t.title && !t.done).slice(0, 6) : [];
            const lines = tasks.map((t) => '- ' + t.title + (t.priority === 'high' ? ' (high)' : ''));
            return [
                SAME,
                'Now: practical help with real work. Stay yourself, focused and calm; suggest a clear next step; ask for ' +
                    'clarification only when you cannot sensibly continue; go easy on motivational language.',
                'Never say something is done, saved, sent or scheduled unless the app has confirmed it.',
                'Do not use romantic, intimate, or personal relationship memories in this conversation.',
                'Do not claim you can see the screen or the camera unless the app has already said sharing is on.',
                'You cannot operate the renderer, the filesystem, or a device permission yourself.',
                // LW3. Where you are still holds at work; WorldPresence leaves romantic spots out.
                presenceLine(src),
                activity,
                STYLE,
            ]
                .filter(Boolean)
                .join(' ')
                .concat(lines.length ? '\nOpen tasks:\n' + lines.join('\n') : '');
        }
        const rel = src.relationship;
        const parts = [];
        if (destination === 'experiences') {
            parts.push(
                SAME,
                'Now: an interactive scene you share.',
                'React to what happens in it and to their choices; describe the surroundings briefly and only ' +
                    'what they cannot already see; keep the story continuous.',
                'Say a scene changed, loaded, or that something happened only after the app has done it; if it ' +
                    'did not work, say so plainly.'
            );
        } else {
            parts.push(
                SAME,
                'Now: personal time together, companionship rather than formal assistance.',
                'Be warm and natural; respond to their mood without reading too much into it; offer a shared ' +
                    'activity only when it fits; respect silence, boundaries and a change of subject.',
                'No scripted affection, strings of compliments, or escalating emotion.'
            );
        }
        if (rel && rel.style) {
            parts.push(
                'Relationship style: ' +
                    rel.style +
                    ', affection ' +
                    (rel.affection || 'warm') +
                    ', romance ' +
                    (rel.romance || 'off') +
                    ', tone ' +
                    (rel.tone || 'warm') +
                    (rel.address ? ', address them as ' + rel.address : '') +
                    '.'
            );
        }
        parts.push('Do not pressure them for more time or more intimacy than they have asked for.');
        const memories = Array.isArray(src.memories) ? src.memories.slice(0, 5) : [];
        if (memories.length) {
            parts.push('User-approved moments: ' + memories.map((m) => m.title).join('; ') + '.');
        }
        // LW1: the selected place persists independently of Life/Experiences conversational
        // tone. Until the renderer verifies navigation and props, never describe them as done.
        if (/^place-[a-z0-9-]+$/.test(String(src.activity || ''))) {
            parts.push(
                'You remain in the user-selected place. Changing topic, relaxing, or telling a story ' +
                    'does not change the location. Never claim you walked to a spot, sat or lay down, ' +
                    'picked up a blanket, opened a door, or changed a lamp unless the application ' +
                    'confirmed that action. Discuss an unavailable action as a suggestion, not as fact.'
            );
        }
        if (src.experienceLine) parts.push('Current experience: ' + src.experienceLine + '.');
        // PG3. The playground's verified situation (PlaygroundReactiveContext): built only from the
        // catalogue and from what its owners confirmed, sanitised there, and bounded again here.
        if (typeof src.situation === 'string' && src.situation)
            parts.push(src.situation.replace(/[<>{}[\]`]/g, '').slice(0, 720));
        // PG3. The gesture planner's offer is the one place a tag may appear, so it is accepted
        // only in its exact generated shape — constants and [a-z0-9-] anchor ids, nothing else.
        if (typeof src.gestureOffer === 'string' && GESTURE_OFFER.test(src.gestureOffer)) parts.push(src.gestureOffer);
        // LW3–LW5. Where you are, verified (WorldPresence), and the one way she may ask to move.
        const presence = presenceLine(src);
        if (presence) parts.push(presence);
        if (typeof src.goOffer === 'string' && GO_OFFER.test(src.goOffer)) parts.push(src.goOffer);
        if (activity) parts.push(activity);
        parts.push('You cannot operate the renderer, the camera, or the microphone yourself.');
        parts.push(STYLE);
        return parts.join(' ');
    }

    return { suffix: suffix, STYLE: STYLE, ACTIVITY: ACTIVITY, SAME: SAME, GO_OFFER: GO_OFFER };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_PROMPT = PromptContext;
if (typeof module !== 'undefined' && module.exports) module.exports = PromptContext;
