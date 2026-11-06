/**
 * ContextIntent — notices when the conversation moves between Life, Copilot and Experiences (IC2).
 *
 * The person should never have to announce "switching to Copilot". "I'm tired, can we spend
 * some time together?" is Life; "actually, I need help finishing something first" is Copilot;
 * "let's go somewhere peaceful" is Experiences. This reads the latest message and answers
 * which of the three it clearly belongs to — or null, which is the common case and means
 * "keep the context you have".
 *
 * Deliberately small and local:
 *
 * - **No model call.** It runs once per turn, at prompt assembly, on one string. A second
 *   request to classify the first would double the cost of every message.
 * - **Only clear signals move it.** A message that matches two destinations, or none, changes
 *   nothing. A wrong switch is worse than no switch: the model already has the whole
 *   conversation and adapts on its own; this only tells it what kind of moment it is in.
 * - **English and Italian**, the two languages this app is used in most. Anything else simply
 *   never switches context, which is the safe failure.
 *
 * Pure. Exposes: window.NEXUS_COMPANION_INTENT
 */
const ContextIntent = (() => {
    'use strict';

    // Each rule: destination, activity id, the phrase it shows, and its patterns.
    const RULES = Object.freeze([
        {
            destination: 'copilot',
            activity: 'help',
            label: 'Ready to help',
            patterns: [
                /\bhelp me (?:to )?(?:finish|with|write|fix|plan|prepare|organi[sz]e|understand|study)\b/i,
                /\b(?:finish|finishing|complete|completing|working on|work on)\b.{0,40}\b(?:report|project|essay|homework|code|presentation|email|task|work|something|it|this|that)\b/i,
                /\b(?:deadline|to-?do list|my tasks?|my report|my homework|debug|spreadsheet)\b/i,
                /\bi need (?:to get|help)\b.{0,30}\b(?:done|finish|work|with)\b/i,
                /\b(?:aiutami a|devo finire|sto lavorando|scadenza|compiti|relazione|presentazione)\b/i,
            ],
        },
        {
            destination: 'experiences',
            activity: 'explore',
            label: 'Exploring together',
            patterns: [
                /\blet'?s go (?:somewhere|to|on)\b/i,
                /\b(?:seaside|the beach|a walk on|an adventure|tell me a story|play a story|explore)\b/i,
                /\b(?:andiamo (?:in|al|a|da qualche parte)|spiaggia|raccontami una storia|un'avventura)\b/i,
            ],
        },
        {
            destination: 'life',
            activity: 'relax',
            label: 'Relaxing together',
            patterns: [
                /\b(?:i'?m|i am|feeling|so) (?:tired|exhausted|stressed|drained|worn out)\b/i,
                /\b(?:long day|need to relax|want to relax|unwind|chill out|take a break)\b/i,
                /\bspend (?:some )?time (?:together|with you)\b/i,
                /\b(?:sono (?:stanc[oa]|stressat[oa])|rilassarmi|stare un po' insieme|pausa)\b/i,
            ],
        },
        {
            destination: 'life',
            activity: 'talk',
            label: 'Talking',
            patterns: [
                /\b(?:can we|let'?s|i want to|i'?d like to) (?:just )?(?:talk|chat)\b/i,
                /\b(?:i feel|i'?m feeling) (?:lonely|sad|down|anxious)\b/i,
                /\b(?:parliamo|mi sento (?:sol[oa]|triste|giù))\b/i,
            ],
        },
    ]);

    /**
     * classify(text) → { destination, activity, label } | null.
     * Null for no match and for a message that matches more than one destination.
     */
    function classify(text) {
        const value = String(text || '').slice(0, 600);
        if (!value.trim()) return null;
        const hits = RULES.filter((rule) => rule.patterns.some((re) => re.test(value)));
        if (!hits.length) return null;
        const destinations = new Set(hits.map((h) => h.destination));
        if (destinations.size > 1) {
            // "I'm tired but I need to finish my report": the last clause is what they want now.
            const last = lastMentioned(value, hits);
            return last ? pick(last) : null;
        }
        return pick(hits[0]);
    }

    function pick(rule) {
        return { destination: rule.destination, activity: rule.activity, label: rule.label };
    }

    /** The rule whose match starts latest in the message, or null on a tie. */
    function lastMentioned(value, hits) {
        let best = null;
        let at = -1;
        let tie = false;
        for (const rule of hits) {
            for (const re of rule.patterns) {
                const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
                const all = [...value.matchAll(new RegExp(re.source, flags))];
                for (const m of all) {
                    if (m.index > at) {
                        at = m.index;
                        best = rule;
                        tie = false;
                    } else if (m.index === at && best && best.destination !== rule.destination) tie = true;
                }
            }
        }
        return tie ? null : best;
    }

    /** What the inline line says for an activity a Together option started. */
    const LABELS = Object.freeze({
        talk: 'Talking',
        relax: 'Relaxing together',
        'life-evening': 'An evening together',
        'copilot-hour': 'Copilot Hour',
        tasks: 'Tasks',
        'focus-block': 'Focus block',
        learn: 'Learning',
        work: 'Working',
        help: 'Ready to help',
        seaside: 'Seaside Evening',
        'scene-tale': 'Scene Tale',
        explore: 'Exploring together',
        move: 'Moving together',
        forest: 'Under the trees',
        ocean: 'By the sea',
        meditation: 'Ten quiet minutes',
    });

    function label(activity) {
        if (!activity) return '';
        if (LABELS[activity]) return LABELS[activity];
        const text = String(activity).replace(/-+/g, ' ');
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    return { classify, label, RULES, LABELS };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_INTENT = ContextIntent;
if (typeof module !== 'undefined' && module.exports) module.exports = ContextIntent;
