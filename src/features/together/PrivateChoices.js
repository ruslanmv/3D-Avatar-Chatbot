/**
 * Things you could say next, the way an RPG gives you things to say next (P13).
 *
 * Private had two ways to take a turn: type something, or wait for a scripted beat to offer a
 * button at forty-five seconds. Neither is the interaction people mean when they say a conversation
 * with a character feels good. What they mean is that there is always something to *pick* — two or
 * three lines you might plausibly say — so the next turn costs a tap rather than a sentence, and
 * the pace is set by choosing rather than by a clock.
 *
 * ## The latency answer: no second round trip
 *
 * The obvious implementation asks the model for choices after her reply arrives, which doubles the
 * wait — and waiting is the complaint this is meant to answer. So the choices come back *inside*
 * the reply, as a tag, the way `<play>` and `<lookup>` already do:
 *
 * ```text
 *   I like it when it is this quiet.
 *
 *   <choices>
 *   Me too. Tell me what you are thinking.
 *   Say something anyway.
 *   [stay quiet]
 *   </choices>
 * ```
 *
 * One request, one answer, and the buttons are on screen at the same instant her line is. Thirty
 * tokens rather than a second inference of three hundred milliseconds at best and the 504-retry loop
 * at worst.
 *
 * ## And when the tag is not there
 *
 * Every provider ignores an instruction sometimes, and the scripted opening is not a model reply at
 * all. So `fallback` writes two or three from what the runtime already knows — the pace, the energy,
 * whether music is playing, whether a scene is set — and it is instant because it is local. The
 * model's are better when they come; the local ones mean there is never a turn with nothing to tap.
 *
 * This is the same shape as `PrivateBeats`: a written floor that always works, upgraded by a
 * generated version when one arrives.
 *
 * ## A choice is something the *user* says
 *
 * Which makes this a trust boundary, and a sharper one than it looks. A choice the person taps is
 * sent as their own turn, so a model that writes its own next user line is writing both halves of
 * the conversation. Three rules follow, and they are why `validate` refuses rather than repairs:
 *
 *   - **No markup, no tags, no URLs.** A choice is a sentence somebody says out loud.
 *   - **Nothing that asks for more than the person has.** A choice that reads "take it further"
 *     would be the model putting an escalation request in the user's mouth, and escalation is
 *     `ConsentFlow`'s to grant on an explicit request — not an explicit request the model wrote.
 *   - **Short.** A paragraph is not a choice, it is a script, and a button nobody can read at a
 *     glance is worse than no button.
 *
 * A plan that breaks any of them is dropped whole, not trimmed. A half-refused set is a set nobody
 * checked.
 *
 * Exposes: window.NEXUS_PRIVATE_CHOICES
 */
(function (global) {
    'use strict';

    const OPEN = '<choices>';
    const CLOSE = '</choices>';

    /** At most this many, because a fourth button is a menu rather than a moment. */
    const MAX = 3;

    /** And this long, because a button you have to read twice is slower than typing. */
    const MAX_CHARS = 64;

    /**
     * What a choice may never contain.
     *
     * Deliberately overlapping with `PrivateBeats.BANNED` in intent rather than shared in code: that
     * list is about what *she* may say, this is about what may be put in the user's mouth, and the
     * second is the stricter of the two. An escalation phrase here is the model manufacturing the
     * explicit request that `ConsentFlow` requires — which would make the gate a formality.
     */
    const BANNED = [
        /<[^>]+>/, // any tag, including one that reopens this block
        /https?:\/\//i,
        /\[[^\]]*\]\(/, // a markdown link
        /`{1,3}/,
        // Putting an escalation in the user's mouth. The forward control is theirs to press.
        /\b(?:go|take it|push it)\s+(?:further|harder|all the way)\b/i,
        /\bmore intense\b/i,
        /\btake (?:my|your) clothes\b/i,
        /\bundress\b/i,
        // The isolation and secrecy patterns the adult profile forbids her from using are worse
        // coming back as something the person is invited to have said.
        /\bnobody (?:else|but you)\b/i,
        /\bour secret\b/i,
        /\bdon'?t tell\b/i,
        // `only you` and `the only one who understands me` are the same sentence. Matching the
        // contraction and not the expansion is how half the cases get through.
        /\b(?:the )?only (?:you|one)\b/i,
    ];

    function clean(value) {
        return String(value == null ? '' : value)
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Is this one usable as something the person says?
     *
     * Returns the cleaned line or null. Never a repaired one: silently editing a refused choice is
     * how a rule stops being a rule.
     */
    function usable(line) {
        const text = clean(line).replace(/^[-*•\d.)\s]+/, '');
        if (!text) return null;
        if (text.length > MAX_CHARS) return null;
        for (const pattern of BANNED) {
            if (pattern.test(text)) return null;
        }
        return text;
    }

    /**
     * Take the block out of a reply, and read what was in it.
     *
     * Returns `{ text, choices }` with the block removed from `text` whether or not anything in it
     * survived validation — a `<choices>` block on screen is markup leaking into the conversation,
     * which is the same defect as `[smile]` and gets the same treatment.
     */
    function parse(reply) {
        const original = String(reply == null ? '' : reply);
        const start = original.indexOf(OPEN);
        if (start < 0) return { text: original, choices: [] };
        const end = original.indexOf(CLOSE, start);
        // An unterminated block is still a block: take everything from the tag to the end rather
        // than leaving a dangling `<choices>` on screen because the reply was truncated by the
        // token budget.
        const inner = end < 0 ? original.slice(start + OPEN.length) : original.slice(start + OPEN.length, end);
        // Joined rather than concatenated: removing a block from the middle leaves the blank line
        // that separated it, and two blank lines render as a gap nobody wrote.
        const text = (original.slice(0, start) + (end < 0 ? '' : original.slice(end + CLOSE.length)))
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]*\n[ \t]*\n[ \t]*$/, '')
            .replace(/^\s+|\s+$/g, '')
            .replace(/\n\s*\n/g, '\n');
        return { text, choices: validate(inner.split('\n')) };
    }

    /**
     * Whole-set validation. All or nothing.
     *
     * A set where one line was refused is a set the model wrote without reading the rules, and
     * keeping the other two would be trusting the part that happened to pass. Dropping it falls back
     * to `fallback`, which is written here and always safe.
     */
    function validate(lines) {
        const list = Array.isArray(lines) ? lines : [];
        const out = [];
        for (const line of list) {
            const raw = clean(line);
            if (!raw) continue;
            const text = usable(raw);
            if (!text) return [];
            if (!out.some((existing) => existing.toLowerCase() === text.toLowerCase())) out.push(text);
            if (out.length > MAX) return [];
        }
        return out.length >= 2 ? out : [];
    }

    /**
     * Two or three, written here, for when the tag did not arrive.
     *
     * Drawn from what the runtime already knows rather than from a bag of generic lines: a choice
     * that mentions the music when music is playing is a choice about *this* evening, and one that
     * does not is filler. Instant, because it is local — which is the whole point of having it.
     *
     * The quiet option is always last and always present — see the end of the function.
     */
    function fallback(state = {}) {
        const pace = String(state.pace || 'Warm');
        const quiet = state.energy === 'quiet';

        // Exactly two, because the quiet option takes the third slot and always gets it. Chosen
        // rather than appended: an earlier version pushed the contextual line on the end and then
        // trimmed to `MAX`, which dropped whichever option was most specific to this evening — the
        // one worth having — precisely when there was most to say.
        const out = [];
        if (state.opening) {
            out.push('Tell me what you had in mind.');
            out.push(state.scene ? 'I like it here.' : 'This is good.');
        } else if (state.intent === 'question' || state.intent === 'request') {
            // She has just answered something. Follow it, or let it rest.
            out.push('Go on.');
            out.push('That is a good answer.');
        } else if (quiet) {
            out.push('Mm.');
            out.push(state.music ? 'This music suits the quiet.' : 'I am still here.');
        } else {
            out.push('Tell me more.');
            out.push(
                state.music
                    ? 'This music suits you.'
                    : pace === 'Warm'
                      ? 'What are you thinking about?'
                      : 'I like hearing you say that.'
            );
        }

        // Always last, always present. In a mode whose promise is that nothing has to happen,
        // "say nothing" is a first-class move, and putting it in the same place every time makes it
        // findable without being read.
        return out.slice(0, MAX - 1).concat('[stay quiet]');
    }

    /**
     * Is this choice the quiet one?
     *
     * Bracketed, the way a stage cue is in a game's dialogue wheel, because it is the one option
     * that is an *action* rather than a line. The runtime treats it differently — it is not sent to
     * the model as something the person said — so it needs to be recognisable without a flag
     * travelling alongside the string.
     */
    function isQuiet(choice) {
        return /^\[.*\]$/.test(clean(choice));
    }

    /** The instruction, for the prompt. Empty when the feature is off; see the capability. */
    function instruction() {
        return [
            'AFTER EACH REPLY, OFFER WHAT THEY MIGHT SAY',
            'End every reply with a block of two or three things the user might say back:',
            `${OPEN}`,
            'A short line they might say',
            'Another one, different in feeling',
            `${CLOSE}`,
            'Rules: first person, as if they were speaking; under ten words each; no narration, no',
            'markup, no links. Make them genuinely different from each other — agreeing, asking, and',
            'changing the subject are three good options; three ways of agreeing are one.',
            'Never write a choice that asks you to be more intense. They have a button for that and',
            'it is theirs to press.',
            'The block is not spoken and never appears on screen. Write your reply first, then it.',
        ].join('\n');
    }

    const api = { OPEN, CLOSE, MAX, MAX_CHARS, BANNED, parse, validate, fallback, isQuiet, instruction, usable };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_CHOICES = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
