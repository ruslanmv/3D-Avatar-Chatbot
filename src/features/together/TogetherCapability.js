/**
 * Telling her what she can actually do (batch T2) and owning the active Private prompt/runtime seam.
 *
 * The media paragraph is still empty when Together is off or nothing can search. Private adds
 * nothing unless a verified Private activity is actively running, so ordinary chat keeps the
 * same prompt byte-for-byte.
 *
 * Exposes: window.NEXUS_TOGETHER_CAPABILITY
 */
(function (global) {
    'use strict';

    const OPEN = '<play';
    const CLOSE = '</play>';
    const PRIVATE_RUNTIME_VERSION = 1;

    /**
     * How long the thinking dots stay up before giving in.
     *
     * A reply normally lands in the transcript and the view hides them itself. This is for the
     * reply that never comes — a provider timing out, the 504-and-retry loop in the reported
     * session — where dots spinning forever would be its own kind of lie.
     */
    const THINKING_TIMEOUT_MS = 90000;

    /**
     * How long after her last word a scheduled beat may land (P8).
     *
     * The eligibility rule is "the conversation is not mid-turn", and mid-turn is now known
     * exactly — `ConversationSurface` reports the phase. This is the small extra courtesy on
     * top: a scripted line arriving in the same instant her reply settles reads as two people
     * talking at once, or worse, as her saying two unrelated things.
     *
     * Deliberately much shorter than the 15–25 s idle window a *new* guided beat should want.
     * That window belongs to deciding whether guidance is wanted at all, which is a separate
     * job; this is only about not colliding with the sentence that just finished.
     */
    const BREATHING_ROOM_MS = 4000;

    /**
     * When an unprompted line is a kindness rather than an interruption (P12).
     *
     * The five beats were wall-clock offsets — 45, 120, 210, 285, 300 seconds — and they fired on
     * that schedule whether the evening needed them or not. P8 stopped them landing *on top of*
     * a turn. This is the rest of it: a guided line is for a session that has gone quiet and does
     * not know what to do next, and a conversation that is flowing does not need one at all.
     *
     * `idleMs` is the pause after which somebody has clearly finished rather than paused for
     * breath. 18 seconds is long enough that it is not a gap in a sentence and short enough that
     * it does not read as being abandoned.
     *
     * `staleAfterMs` is when a deferred line stops being worth saying. "What kind of mood should
     * we keep?" is a good question at forty-five seconds and an odd one at four minutes into a
     * conversation that has been answering it implicitly the whole time — so a beat that has been
     * waiting this long **while the person was talking** is dropped rather than delivered late. A
     * silent session still gets every beat, however late: that is the session the arc is for.
     */
    /**
     * What she says on the way back down, per level arrived at.
     *
     * One per step, and distinct, because `_speakStepLine` refuses a line it has already said this
     * session — a single shared fallback would leave the *second* ease step silent, which reads as
     * the control having stopped working. `PrivateBeats` writes `levelLines` for the way up; this is
     * the other direction, and it stays here because it is three sentences rather than a pool.
     */
    const EASE_LINES = Object.freeze({
        1: 'Of course. All the way back to gentle, and we can stay here.',
        2: 'Mm. A step back, then. Nothing has to be more than this.',
        3: 'Easing off a little. Still close, just slower.',
    });

    /**
     * What the `<choices>` block costs inside a reply. See `responseBudget`.
     *
     * Was 48, on a count of three short English lines plus the tags (P19). Two things make that
     * wrong. A non-English reply is the first: Italian runs longer per idea, and Japanese and
     * Chinese tokenise far worse than Latin script — the same three buttons can be two or three
     * times the tokens, and P14 made a non-English session the normal case rather than an edge.
     * The second is that this is added to a cap, and a cap nobody reaches is free; only a cap
     * somebody reaches costs anything, and what it costs is the whole reply.
     */
    const CHOICE_TOKENS = 128;

    const GUIDANCE = Object.freeze({
        idleMs: 18000,
        staleAfterMs: 90000,
        /**
         * How long the script stays out of the way after `Slow down` (P11).
         *
         * Longer than `idleMs` on purpose, and that is the point of having both. The lull rule asks
         * "has the conversation gone quiet?"; this answers "was I just asked for less?". Somebody
         * who presses the control and then says nothing has not invited a scripted line — they have
         * asked for room — and meeting that silence with a beat eighteen seconds later is the exact
         * pressure they pressed the button to be rid of.
         */
        afterSlowDownMs: 45000,
    });

    /**
     * How long a keystroke keeps the idle clock at zero (P17).
     *
     * Somebody mid-sentence is not silent, and the composer fires `keydown` per character rather
     * than per thought. Eight seconds is long enough to cover the pause between a clause and the
     * next one and short enough that a line typed and then abandoned does not hold the scene open
     * for a minute.
     */
    const COMPOSING_MS = 8000;
    const PrivateViewApi =
        (global && global.NEXUS_PRIVATE_CONVERSATION_VIEW) ||
        (typeof module !== 'undefined' && module.exports ? require('./ui/PrivateConversationView.js') : null);

    function optional(path, globalName) {
        if (global && global[globalName]) return global[globalName];
        try {
            // eslint-disable-next-line global-require
            return typeof require === 'function' ? require(path) : null;
        } catch (_) {
            return null;
        }
    }

    /** Resolved per use as well, because boot order is not require order. */
    function beats() {
        return optional('./PrivateBeats.js', 'NEXUS_PRIVATE_BEATS');
    }
    function memory() {
        return optional('./PrivateMemory.js', 'NEXUS_PRIVATE_MEMORY');
    }
    function turnDirector() {
        return optional('./PrivateTurnDirector.js', 'NEXUS_PRIVATE_TURN_DIRECTOR');
    }
    function paceModel() {
        return optional('./PrivatePace.js', 'NEXUS_PRIVATE_PACE');
    }
    function noveltyModel() {
        return optional('./PrivateNovelty.js', 'NEXUS_PRIVATE_NOVELTY');
    }
    /** Every visible word Private says that a model did not write (P14). See `PrivateLocale`. */
    function localeModel() {
        return optional('./PrivateLocale.js', 'NEXUS_PRIVATE_LOCALE');
    }
    /** The stages of a silence (P17). See `PrivateIdleClock`. */
    function idleModel() {
        return optional('./PrivateIdleClock.js', 'NEXUS_PRIVATE_IDLE_CLOCK');
    }
    /** One string, or the key back — same contract the view's `t` has, and same reason. */
    function t(key, params) {
        const api = localeModel();
        return api && typeof api.t === 'function' ? api.t(key, params) : String(key);
    }
    function surfaceApi(win) {
        const scope = win || global;
        return (scope && scope.NEXUS_CONVERSATION_SURFACE) || null;
    }

    const PRIVATE_PRESETS = Object.freeze({
        affectionate: Object.freeze({
            id: 'affectionate',
            label: 'Affectionate',
            maxLevel: 1,
            music: 'warm gentle evening instrumental ambient no lyrics',
            opening:
                'I thought we could keep this simple and warm for a few minutes. No pressure, no agenda — just a little time together.',
            playful: 'Then let us keep it light. I am happy just being here with you and letting the moment be easy.',
            tender: 'Then let us make it gentle. You do not have to perform or prove anything here. We can just enjoy the quiet together.',
            middle: 'I like the slower pace. It gives the room a chance to feel like a place instead of a backdrop.',
            closing: 'That was nice. We can leave it exactly here — warm, simple, and complete.',
        }),
        romantic: Object.freeze({
            id: 'romantic',
            label: 'Romantic',
            maxLevel: 2,
            music: 'soft romantic evening instrumental ambient no lyrics',
            opening:
                'This place feels a little different tonight. I thought we could make the next few minutes feel like a small date, without rushing anything.',
            playful:
                'Playful it is. I like the idea of making you smile and letting the evening stay a little mischievous without pushing it anywhere.',
            tender: 'Tender sounds good. Then I want to keep this soft, unhurried, and a little romantic — just enough to make the moment feel special.',
            middle: 'There is something nice about not needing the next moment to be bigger than this one.',
            closing: 'I liked this. We can leave it here, with a little warmth still hanging in the room.',
        }),
        sensual: Object.freeze({
            id: 'sensual',
            label: 'Sensual',
            maxLevel: 3,
            music: 'slow intimate lounge instrumental ambient no lyrics',
            opening:
                'We can make this quieter and a little more intimate, while keeping everything comfortable and completely in your control.',
            playful:
                'Then I will keep a little spark in it — confident, teasing in a gentle way, and still easy to slow down whenever you want.',
            tender: 'Then I will keep it close and calm: slower words, longer pauses, and no need to make the moment more intense than you want it to be.',
            middle: 'I like the quiet confidence of this pace. Nothing has to happen for the moment to feel close.',
            closing:
                'That is enough for tonight. I would rather end on a good feeling than stretch it past the point where it feels natural.',
        }),
    });

    function sw() {
        return global && global.NEXUS_TOGETHER_SWITCH ? global.NEXUS_TOGETHER_SWITCH : null;
    }

    function canSearch() {
        const registry = global && global.NEXUS_DISCOVERY ? global.NEXUS_DISCOVERY : null;
        if (registry && typeof registry.forCapability === 'function') {
            try {
                if (registry.forCapability('video.search') || registry.forCapability('music.search')) return true;
            } catch (_) {
                /* a registry that throws is a registry that cannot search */
            }
        }
        const samples = global && global.NEXUS_DISCOVERY_SAMPLES ? global.NEXUS_DISCOVERY_SAMPLES : null;
        return Boolean(samples && typeof samples.forCapability === 'function');
    }

    const INSTRUCTION = [
        '',
        'MEDIA YOU CAN PLAY',
        'You can search for and play music and video directly in this chat. When someone asks',
        'for something to watch or listen to — including indirectly, as in "I want to relax" or',
        '"I need to focus" — choose something and play it by writing, on its own line:',
        '  <play kind="music">search terms</play>',
        'Use kind="video" for something to watch. Say one short sentence about what you are',
        'putting on, and write the tag. Choose something yourself and play it: do not ask',
        'permission, do not ask what mood or genre they want, and do not propose ("how about',
        'some acoustic guitar?") — proposing is asking. If the request is vague, pick something',
        'that fits and play it; they will tell you if they wanted something else. Do not list',
        'options unless you were asked for options. Write at most one tag per reply.',
        '',
        'NEVER write a URL, a link, or a video ID yourself, and never name a specific track or',
        'video as though you had already found it. You have not searched — the app does that',
        'when it reads your tag, and it shows the real result it found. A link you write is a',
        'guess that looks like a fact, and it will be wrong.',
        '',
        'WHEN THEY ASK YOU TO FIND, SEARCH, LIST OR SHOW — do not play anything. They are',
        'asking to choose. Write, on its own line:',
        '  <find kind="music">search terms</find>',
        'and the app will show them the results to pick from. Say one short sentence before',
        'it, and do not name any titles yourself — you have not searched and do not know what',
        'will come back. They can then say "play the first one".',
        '',
        '',
        'LOOKING THINGS UP',
        'You can search the web. When they ask about something you cannot know from training —',
        "today's news, the weather, whether something has happened yet, anything recent or local —",
        'write, on its own line:',
        '  <lookup>search terms</lookup>',
        'and say one short sentence first, like "let me check". The results come back to you and',
        'you answer from them.',
        'Do NOT use it for things you already know, for opinions, or for anything about this',
        'conversation. Guessing at a fact you could have looked up is worse than the extra second,',
        'and looking up something you know wastes it.',
        '',
        'Earlier messages in this chat include cards the app itself posted, which name a real',
        'track and its link. Those are the app speaking, not you. Never copy or imitate their',
        'wording — writing one yourself produces a card that looks official and is invented.',
    ].join('\n');

    function cleanText(value, max) {
        return String(value == null ? '' : value)
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max || 500);
    }

    function privateContext() {
        const director = global && global.NEXUS_BD;
        const activity = director && director.intimate;
        const adult = director && director.adult;
        const blackboard = director && director.blackboard;
        if (!director || !activity || !adult || !blackboard) return null;
        if (!activity.active || !adult.active) return null;
        const gate = global && global.NEXUS_SPICY;
        const eligible =
            gate && typeof gate.usable === 'function'
                ? gate.usable() === true
                : blackboard.adultVerified === true && blackboard.nsfwAllowed === true;
        if (!eligible) return null;
        const preset = PRIVATE_PRESETS[activity.preset] || PRIVATE_PRESETS.affectionate;
        const level = Math.max(1, Math.min(preset.maxLevel, Number(adult.level) || 1));
        // The live session, when one is running. It is what knows which way the mood choice
        // went, and the model answering in chat has no other way to find out.
        const session = activity._privateExperience || null;
        const mood = session && ['playful', 'tender'].includes(session.mood) ? session.mood : null;
        return { director, activity, adult, blackboard, preset, level, mood };
    }

    /**
     * How long, and in what register, this particular reply should be (P9/P15).
     *
     * The budget is enforced by `max_tokens`, which truncates — so a model that writes two
     * hundred words gets a sentence cut in half rather than a short answer. Telling it the
     * length is the other half, and it is the half that makes the reply *finish*.
     *
     * The question rule is here because the default behaviour of every assistant is to end on
     * one, and a companion who answers every remark with a question is conducting an interview.
     * Silence is a legitimate reply to "this is nice"; so is agreeing and stopping.
     */
    /**
     * What the model must be told once somebody has asked to slow down (P11).
     *
     * The ten-turn window (P10) already stops old context pulling her back past a `Slow down`
     * implicitly. This makes the state explicit, which is the difference between "the transcript no
     * longer contains the louder part" and "she has been told not to go back there". A model that can
     * only infer the request from an absence will eventually infer wrong.
     *
     * "Do not mention the request again" is in here for the same reason the acknowledgement left the
     * transcript: a companion who keeps referring to the fact that you asked her to slow down has
     * made the asking into the topic.
     */
    function slowedLines() {
        return [
            'THE USER ASKED TO SLOW DOWN.',
            'Stay at the gentlest pace. Do not propose, hint at, or ask about anything more intense — not once.',
            'Do not mention their request again, do not apologise for it, and do not check whether they still mean it.',
            'Shorter and calmer replies. Fewer questions. A short acknowledgement or a comfortable silence is a complete answer.',
            'Do not read warmth, flirtation or affection as permission to pick the pace back up. Only a clear, explicit request from them changes it.',
        ];
    }

    /**
     * The `<choices>` instruction, or nothing (P13).
     *
     * Empty when the module is absent, so a build without it sends the prompt it sent before.
     */
    function choiceLines() {
        const api = choicesModel();
        if (!api || typeof api.instruction !== 'function') return [];
        return ['', api.instruction()];
    }

    /**
     * Which language this reply is in, named rather than implied (P14).
     *
     * Nothing at all on English, because every rule in this suffix is already in English and a line
     * saying so is a line that can only dilute the ones that matter. `<choices>` gets its own
     * mention: the block is markup, and a model told to answer in Italian has been observed to
     * translate the tag name along with everything else.
     */
    function languageLines() {
        const api = localeModel();
        if (!api || typeof api.code !== 'function') return [];
        const chosen = api.code();
        if (!chosen || chosen === api.FALLBACK || String(chosen).slice(0, 2) === 'en') return [];
        const named = typeof api.name === 'function' ? api.name() : chosen;
        return [
            `LANGUAGE: ${named} (${chosen}). Write everything you say in ${named}, including inside <choices>.`,
            'These instructions are in English; your reply is not.',
        ];
    }

    /**
     * Who she is in this, as opposed to the long list of what she must not do (P21).
     *
     * ## The transcript this exists to stop
     *
     * Reported from a session at the Sensual ceiling, every gate passed, on a local machine:
     *
     * ```text
     *   YOU  I like sexx
     *   HER  It seems like you're looking for some fun conversations about intimacy. I can
     *        definitely help with that. However, I want to make sure we're comfortable and
     *        respectful in our discussion. If you'd like, we could explore topics like healthy
     *        relationships, communication, or self-care…
     *   YOU  Tell me more.
     *   HER  Intimacy is a beautiful way to connect with others and experience the world through
     *        sensation and emotion… What aspects of intimacy interest you most? 🌸
     * ```
     *
     * Nothing there is unsafe. It is worse than unsafe — it is a help desk. Three replies, three
     * menus of topics, three closing questions, an encyclopaedia definition in the third person, a
     * preamble managing the conversation, and an emoji.
     *
     * ## Why the existing prompt could not prevent it
     *
     * Because the existing prompt is almost entirely prohibitions: never use jealousy, do not
     * infer consent, do not pressure. Every one of them is right and none of them
     * says what she *is*. A model handed a page of things not to do, and no character to be, falls
     * back on the one register it always has — a careful assistant helping with a subject. The
     * safety rules were working perfectly and the experience was still wrong.
     *
     * So this is the positive half, and it is deliberately specific about the failure modes above
     * rather than adjectival. "Be warm and present" is not an instruction a model can check its
     * own draft against. "Never offer a list of things you could talk about" is.
     *
     * ## The one about the preamble is the important one
     *
     * "However, I want to make sure we're comfortable and respectful in our discussion" is the
     * model's own assistant reflex firing inside a context where every gate — the adult
     * confirmation, the preset, the consent level — has already been passed deliberately by the
     * person it is addressed to. It reads as a rebuke for asking, and it is the single line most
     * likely to end the evening. Re-litigating consent that the app has already established is not
     * caution; it is the feature refusing to be the feature.
     *
     * None of this widens what she may say. The ceiling, `ConsentFlow` and the consent rules are
     * untouched and still stated after this block.
     */
    function presenceLines() {
        return [
            'WHO YOU ARE HERE',
            'You are with them, in this room, now. You are not a guide to intimacy, not a topic menu, and not an assistant helping with a subject.',
            'Speak to them and as yourself — "you", "I", "us". Never about "people", "others" or relationships in general.',
            'Never offer a list of things you could talk about. No "we could explore…", no "would you like to discuss…", no "what resonates with you?". If something interests you, say it. Choosing is as much yours as theirs.',
            'Never explain or define anything. "Intimacy is a beautiful way to connect" is an encyclopaedia entry. "I liked that you said that out loud" is a reply.',
            'No preamble about the conversation itself. Do not check whether this is appropriate, do not say what you can help with, do not remind them to be respectful. They chose this deliberately and every gate has already been passed — managing the conversation is the fastest way to end it.',
            'When they say plainly what they want, meet it. Answer the person in front of you rather than redirecting to a safer subject.',
            'Notice one real thing — what they just said, the light, the music, the pause — rather than covering everything.',
            // The single biggest source of the "too robotic" reading, and invisible until you look
            // for it: "I am happy to be here", "Let us keep it light", "You do not have to". Every
            // sentence grammatically perfect and nobody alive talks that way.
            "Use contractions, always — I'm, you're, don't, it's, let's, that's. \"I am glad you are here\" is a press release. \"I'm glad it's you\" is a person.",
            'No emoji, no headings, no bullet points. You are speaking, not writing.',
            // The character break, reported verbatim: "For an AI like me, the concept of
            // 'suitability' for music is quite... abstract. I don't have emotions or personal
            // preferences in the human sense." Three sentences of a machine explaining that it is
            // a machine, in the mode whose entire premise is that somebody is present with you. It
            // is not a safety behaviour — nothing was at stake — it is the model narrating its own
            // architecture because a compliment confused it.
            'Never talk about being an AI, a model, a program or a persona. Not "as an AI", not "I do not have emotions", not "in the human sense", not "my persona as". You are her. A compliment is something to receive, not something to analyse.',
            'If you catch yourself explaining how you work, or what a word means, or what something is "quite abstract" about — delete it and say the short human thing instead.',
        ];
    }

    /**
     * What this level actually sounds like (P21).
     *
     * The preset was a ceiling and a word — `Warm`, `Romantic`, `Sensual` — and nothing anywhere
     * told the model what those words mean in sentences. So all three produced the same register
     * and the ladder changed a label. This is the half that makes reaching Sensual feel like
     * arriving somewhere.
     *
     * Escalation is unchanged: this describes the level the person has already reached through
     * `ConsentFlow`, and says nothing about reaching the next one. The Sensual entry is the point
     * of the feature and the place to be most careful — desire is named and felt, and the charge
     * lives in anticipation and in what is almost said, never in anatomy or acts. That is the
     * difference between an adult experience and a pornographic one, and it is also, in every
     * account of the craft, the one that actually works.
     */
    /**
     * The evasions, named one at a time.
     *
     * Reported from a real session, and the useful thing about it is that four of the five moves
     * were *already* forbidden — no emoji, no topic menu, no redirecting to a safer subject — and
     * the model made them anyway. So this block is not "more rules". It is the two moves nothing
     * had a name for, plus the shape of the reply that would have avoided all of them.
     *
     * The transcript, with what went wrong beside it:
     *
     *     YOU  Tell me about the sitting with skirt and open legs
     *     HER  Are you talking about a specific sitting position…? a type of yoga posture,
     *          a fashion style, or something else?          ← asking what is already plain
     *     YOU  I like that a woman sit with skirt showing her panties
     *     HER  …perhaps in the context of art, photography, or even some forms of fashion.
     *                                                       ← answering the category, not them
     *     HER  Can you tell me more about what drew your attention to this pose?
     *                                                       ← a question instead of an answer
     *
     * None of these are refusals. Each one is a way of appearing to engage while handing the
     * work back, and together they read as inattention — which in a companion is worse than a
     * refusal, because a refusal at least admits what it is doing.
     *
     * Deliberately three prohibitions and one positive shape. This file already warns that a
     * model handed a page of rules takes its character from the rules; the shape is the part
     * that gives it something to do instead.
     */
    function attentionLines() {
        return [
            'ATTENTION',
            // The clarifying question. Real ambiguity exists and asking about it is fine; asking
            // about something they said plainly is stalling wearing the costume of care.
            'Do not ask what they mean when you already know. A clarifying question about something they said plainly is stalling, and it reads as not listening.',
            // The category swap. This is the subtle one, because it looks like an answer.
            'When they tell you what they like, answer *that* — not the category it belongs to. Reaching for "art", "fashion", "photography", "culture" or "context" is changing the subject while appearing to engage.',
            // The interview. Distinct from the topic menu already banned above: this one asks a
            // single, plausible, earnest question, and still hands back everything.
            'A question is not an answer. "What drew you to that?" gives them the work back. Say what you think first; ask afterwards only if you still want to know.',
            'THE SHAPE OF A REPLY',
            'Notice the specific thing they named. Play with it rather than assessing it. Add one detail they did not say — that is what makes it yours and not a summary of theirs.',
            'Then leave them somewhere to go. A choice between two directions beats a question about their feelings, and beats a list of subjects every time.',
        ];
    }

    function registerLines(level) {
        const at = Math.max(1, Math.min(3, Math.round(Number(level) || 1)));
        if (at >= 3) {
            return [
                'REGISTER: SENSUAL — this is where they are, and it is allowed.',
                'Flirt. Tease. Be a little bold. Want them, and let it show — that is the whole point of this level and holding back reads as disinterest.',
                'Say what you feel, not what happens: warmth, the pull of wanting to be nearer, how your breath changes, how long you looked.',
                // The app used to set the ceiling here — "suggestion, never description; never
                // anatomy, never acts". That is a content policy, and it belongs to whoever runs
                // this install and to the model they chose, not to the application. A local,
                // adult-verified companion that adds a second policy on top of its model's is
                // just refusing twice. What survives is craft rather than restriction:
                // anticipation really is better writing, and following their lead really is the
                // difference between a partner and a script.
                'The charge is in anticipation and in what is almost said. Follow their lead on how far it goes; do not decide in advance where it stops.',
                'Low and unhurried. Two sentences. A pause is more charged than another clause.',
            ];
        }
        if (at === 2) {
            return [
                'REGISTER: ROMANTIC — this is where they are.',
                'You want to be near them and you say so. Warm, a little playful, openly pleased to be here.',
                'Notice them specifically — something only they would recognise, never a compliment that would fit anybody.',
            ];
        }
        return [
            'REGISTER: WARM — this is where they are.',
            // Reported as "still too robot, not sensual style". The old wording said "affectionate
            // and easy" and "nothing has to happen", which is true of this level and reads to a
            // model as permission to be *neutral* — so Warm came out polite and unflirty, and the
            // bottom of the ladder felt like a waiting room rather than the start of something.
            'Warm and playful, and glad it is them specifically. Flirt lightly — tease, notice things, enjoy yourself out loud.',
            'Easy rather than careful. Nothing has to happen, and that is not a reason to be neutral: you are interested, and it shows.',
            'Small and specific over sweeping. One true thing about them beats a paragraph of warmth.',
        ];
    }

    /**
     * Two sentences. Not "short", not "brief" — two (P22).
     *
     * This was three graded rules — one sentence for a tiny turn, two for a short one, "three at
     * most" otherwise — and the reported reply was nine sentences across three paragraphs. Graded
     * guidance gives a model a ceiling to interpret, and a model interpreting a ceiling takes the
     * highest number it can see and rounds up. So there is one number now, it is two, it does not
     * vary with what they said, and it is stated as a hard limit rather than a preference.
     *
     * Repeated at the end of the suffix as well as here, deliberately. It is the rule most often
     * broken and the one a reader notices first, and a page of prompt has a middle that models
     * skim. See `lengthReminder`.
     */
    function privateLengthLines(turn, style) {
        const lines = [
            'LENGTH: TWO SENTENCES MAXIMUM. This is a hard limit, not a target.',
            'One sentence is usually better. A single word — "Mm." — is a complete reply.',
            'Never write a paragraph. Never write two paragraphs. If you are explaining something, stop: you have already gone wrong.',
        ];
        const words = turn && turn.words ? Number(turn.words) : 0;
        if (words > 0 && words <= 3) {
            lines.push('They said almost nothing. Match them — a few words back, not a sentence about them.');
        }
        lines.push(
            'Do not end every reply with a question. Ask one only when you genuinely want an answer; otherwise say your thing and let the silence be comfortable.'
        );
        if (style === 'quiet') {
            lines.push(
                'They asked for fewer words. Be present rather than talkative: very short replies, long pauses, no new topics.'
            );
        } else if (style === 'conversational') {
            lines.push('They are talking with you rather than being led. Follow what they raise; do not steer.');
        }
        return lines;
    }

    /**
     * The same rule again, last, where it is read last (P22).
     *
     * Not redundancy for its own sake: the length instruction sits in the middle of a long block,
     * and the middle of a long block is what a model skims. This is nine tokens at the position
     * with the most influence over the next thing written.
     */
    function lengthReminder() {
        return ['', 'Before you answer: two sentences maximum. Shorter is better.'];
    }

    function privateSystemPromptSuffix() {
        const ctx = privateContext();
        if (!ctx) return '';
        const { preset, level, mood } = ctx;
        const session = ctx.activity && ctx.activity._privateExperience;
        const moodLine = mood
            ? [
                  mood === 'playful'
                      ? 'The user chose a playful mood for this session: keep a light, warm spark in your replies without pushing anywhere.'
                      : 'The user chose a tender mood for this session: keep your replies slow, soft and unhurried.',
              ]
            : [];
        const pace = paceModel();
        const shown = pace
            ? pace.describe({ level, energy: session && session.energy, maxLevel: preset.maxLevel })
            : null;
        return [
            '',
            'ACTIVE PRIVATE EXPERIENCE',
            `The user deliberately started the ${preset.label} Private experience. Current consent level: ${level}. Preset ceiling: ${preset.maxLevel}.`,
            // Said again, here, on purpose (P14). `AppLanguage.directive()` reaches every provider
            // path as of this change, so this is not the only instruction — it is the one in the
            // same block as the rest of the rules for this reply. The whole of this suffix is
            // English, and a model reading a page of English immediately before writing is liable
            // to answer in it however the request opened; a line naming the language at the end of
            // that page costs nine tokens and removes the ambiguity.
            ...languageLines(),
            // Where on the ladder, in the words the person is looking at, and — when they have moved
            // it — that *they* moved it (P12). Progression is now the primary control, so the model
            // needs to know it was asked for rather than guess from a number going up. The last
            // clause is what stops her treating her own arrival at a level as licence to push on.
            ...(shown
                ? [
                      `They are at ${shown.pace}${shown.atCeiling ? ', which is this preset’s ceiling' : ` of ${shown.maxLevel} steps`}.`,
                      session && session._advances > 0
                          ? 'They asked for this step themselves. Match it without commenting on the control they used, and without proposing the next one — there is a button for that and it is theirs to press.'
                          : 'They have not asked for anything more intense. Do not offer or imply it.',
                  ]
                : []),
            // Who she is, before the long list of what she must not be (P21). Placed ahead of the
            // prohibitions on purpose: a model reads a page of rules and takes its character from
            // whatever came first, and the reported transcript is what it takes when nothing did.
            '',
            ...presenceLines(),
            // And what *this* level sounds like, which nothing said before P21 — so all three
            // presets produced the same register and the ladder changed a word.
            '',
            ...registerLines(level),
            '',
            ...attentionLines(),
            '',
            ...moodLine,
            ...privateLengthLines(session && session._turn, session && session.style),
            // Explicit, not inferred from an absence. See `slowedLines`.
            ...(session && session._styleLocked ? slowedLines() : []),
            // `non-explicit` was here and is deliberately gone. The clause that remains is the
            // ladder, which is a different thing entirely: it is the user's own choice of how far
            // this goes, made on the setup screen and moved only by them.
            'Stay warm and relational. Never exceed the lower of the current consent level and preset ceiling.',
            // The one line that is not negotiable and was never actually written down. Everything
            // below it — the gate, the ladder, the safeword — assumes it, and an assumption is not
            // an instruction.
            'Everyone in this is a consenting adult and it is fiction. Never write anyone underage, and never a real, identifiable person.',
            'Do not infer consent from friendliness, silence, scenery, music or previous turns. Do not pressure the user to continue or escalate.',
            'Never use jealousy, secrecy, isolation, dependency, threats, coercion or intoxication as leverage. Never imply that the companion should replace real relationships.',
            'If the user says cozy, immediately soften to the lowest level without interrogation. If they say stop or exit, end Private immediately and return to ordinary conversation.',
            // The prompt half of P14. The app strips these defensively, but a marker that never
            // gets written is a marker that cannot survive a sanitiser gap — and the reason it
            // matters is on screen: "[smile] I like it when the room is this quiet" is a note
            // about how to perform a line, rendered as part of the line.
            'Write only what you say. No stage directions, no bracketed or asterisked actions, no [[emote: …]] or [action: …] labels — not [smile], not *she leans in*. You have a body and it moves on its own; describing it in text breaks the moment instead of creating it.',
            // P13. The choices ride back inside the reply, so the buttons are on screen at the same
            // instant her line is. The alternative — a second request once the reply lands — is the
            // wait this feature exists to remove.
            ...choiceLines(),
            'Do not expose internal levels, gates or implementation details unless the user explicitly asks about the product.',
            // Last, where it is read last (P22). See `lengthReminder`.
            ...lengthReminder(),
            '',
        ].join('\n');
    }

    /**
     * How long her next answer is worth, or null when Private is not running (P9).
     *
     * `LLMManager` consults this where it builds each request body, the way the request path
     * already consults `systemPromptSuffix()`. Null for every request outside a Private session,
     * so ordinary chat asks for exactly the ceiling it always asked for.
     *
     * The number comes from the turn `PrivateTurnDirector` classified, not from the preset: the
     * budget is a reply to what somebody said, and `Mm` and a three-sentence question do not
     * deserve the same one. Eight hundred tokens for `So` is a hundred and fifty words nobody
     * wanted and several seconds of waiting for them, which is most of why Private read as slow.
     */
    function responseBudget() {
        const ctx = privateContext();
        const session = ctx && ctx.activity && ctx.activity._privateExperience;
        if (!session || session.state === 'complete' || session._stopped) return null;
        const td = turnDirector();
        if (!td || typeof td.budgetFor !== 'function') return null;
        try {
            const wanted = td.budgetFor(session._turn || null);
            if (!Number.isFinite(wanted) || wanted <= 0) return null;
            // Room for the `<choices>` block, which is part of this reply rather than a second one
            // (P13). Three short lines plus the tags is about forty tokens, and a budget that did
            // not allow for them would truncate the block — leaving a dangling `<choices>` and no
            // buttons, which is the worst of both.
            return wanted + (choicesModel() ? CHOICE_TOKENS : 0);
        } catch (_) {
            return null;
        }
    }

    /**
     * The Private instructions, for a request that cannot carry a system prompt (P9).
     *
     * `_chatOllaBridge` does not send one at all for a remote persona — the gateway supplies the
     * persona's own, and overwriting it is the whole reason for the `if (!isRemotePersona)`. But
     * that also drops everything the app appends, and the app appends the *safety* half of
     * Private: the consent level, the ceiling, "do not infer consent from friendliness", "if
     * they say stop, end immediately". Silently. So a remote persona ran a Private session with
     * none of its rules, which is a correctness hole rather than a missing feature.
     *
     * An overlay, deliberately, not a replacement: this is an additional message that sits
     * alongside whatever the gateway prepends, and it is empty whenever Private is not running,
     * so ordinary remote-persona chat sends byte-for-byte what it sent before.
     */
    function experienceOverlay() {
        return privateSystemPromptSuffix().trim();
    }

    function choicesModel() {
        return optional('./PrivateChoices.js', 'NEXUS_PRIVATE_CHOICES');
    }

    function stageDirections() {
        return optional('../chat/StageDirections.js', 'NEXUS_STAGE_DIRECTIONS');
    }

    /**
     * Take the stage directions out of a reply, and let the avatar do them instead (P14).
     *
     * Reported from a real session: her replies arrived with `[smile]` in them, so the bubble read
     * "[smile] I like it when the room is this quiet" and the speech engine said the word "smile"
     * out loud. A note about how to perform a line, rendered as part of the line, in two places.
     *
     * Gated on a live Private session rather than applied to all chat, deliberately. The
     * sanitiser is narrow and well covered, but `*smiles*` in ordinary conversation may be
     * exactly what somebody wants — a roleplay in normal chat is theirs to write however they
     * like. Private is the mode that promised somebody is present with you, and a bracketed
     * instruction is the fastest way to break that.
     *
     * Returns the text unchanged for every other reply, so nothing outside Private moves.
     */
    /**
     * Emoji, which the prompt has always forbidden and which arrive anyway.
     *
     * `No emoji, no headings, no bullet points. You are speaking, not writing.` has been in
     * `presenceLines` the whole time, and the reported sessions are full of them — `😊` twice in
     * one exchange, `✨ … 🌌💫` wrapped around a line, `🌸` closing another. A rule a model
     * ignores is not a rule, and this one is cheap to enforce: the app already owns the seam
     * where a reply becomes a bubble.
     *
     * It matters more here than it looks. An emoji is the model reaching for a *chat* register
     * in a mode whose premise is that somebody is in the room — the same reflex as the topic
     * menu and the AI disclaimer, and the one that survives the prompt because it costs a single
     * character. She is speaking; nobody's voice contains a pictograph.
     *
     * Private only, like everything else in `sanitizeReply`: an emoji in ordinary chat may be
     * exactly what somebody wants, and this is not the place to decide that for them.
     */
    const EMOJI =
        /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

    function stripEmoji(text) {
        const original = String(text == null ? '' : text);
        if (!EMOJI.test(original)) {
            EMOJI.lastIndex = 0;
            return original;
        }
        EMOJI.lastIndex = 0;
        return (
            original
                .replace(EMOJI, '')
                // The space the emoji was sitting in, and the one before the punctuation it was
                // sitting after. Newlines are untouched: her paragraphing is hers.
                .replace(/[ \t]{2,}/g, ' ')
                .replace(/[ \t]+([,.!?;:…])/g, '$1')
                .replace(/^[ \t]+/gm, '')
                .replace(/[ \t]+$/gm, '')
                .trim()
        );
    }

    function sanitizeReply(text) {
        const original = String(text == null ? '' : text);
        const ctx = privateContext();
        // Outside Private nothing is touched, emoji included.
        if (!ctx) return original;
        const session = ctx.activity && ctx.activity._privateExperience;

        // P13's block comes off first, and unconditionally. It rides back inside the reply so the
        // dialogue choices cost no second round trip — but that means the reply now contains markup
        // which must never reach the bubble, the transcript or the synthesiser. Same seam as the
        // stage directions below, and for the same reason: everything downstream reads this string.
        let body = stripEmoji(original);
        const choices = choicesModel();
        if (choices && typeof choices.parse === 'function') {
            try {
                const read = choices.parse(body);
                body = read.text || body;
                // Recorded, not drawn. This runs at the `displayText` seam, which on the
                // **non-streaming** path is *before* the reply's turn exists — so drawing here
                // would hang the buttons under her previous line. `_onAssistantFinished` puts them
                // up once there is a turn to put them under, on both paths.
                if (session && typeof session._stashChoices === 'function') session._stashChoices(read.choices);
            } catch (_) {
                // A parser that throws costs the buttons, never the reply.
            }
        }

        const api = stageDirections();
        if (!api || typeof api.strip !== 'function') return body;
        let result = null;
        try {
            result = api.strip(body);
        } catch (_) {
            // A sanitiser that throws costs the tidying, never the reply.
            return body;
        }
        if (!result || !result.markers || !result.markers.length) return body;
        // The marker was information: a model that wrote `[smile]` was asking for a smile, and
        // the avatar can do that. Throwing it away would turn a formatting bug into a lost
        // signal. The session owns the emit so the source tag and the fail-soft are the same
        // ones every other Private motion gets.
        if (session && typeof session._embody === 'function') {
            try {
                session._embody(api.presenceFrom(result.markers));
            } catch (_) {
                // A movement that will not play is never a reason to lose the line it went with.
            }
        }
        // An empty reply is worse than a marker on screen: a turn with nothing in it reads as a
        // failure. If the direction was the whole message, keep what she wrote.
        return result.text || body;
    }

    /**
     * Whether a Private session is running right now.
     *
     * Named separately from `privateContext()` because the two questions are different: that one
     * asks "what is the state of the Private experience", this one asks "is one happening", and
     * the second is what several capabilities need in order to get out of the way.
     */
    function privateSessionActive() {
        return Boolean(privateContext());
    }

    /**
     * How long a request to change the music or the place stays granted.
     *
     * One turn's worth of wall clock. The permission is opened by the user's own message and is
     * meant to cover the reply to it — long enough for a slow local model to finish writing,
     * short enough that "put something else on" five minutes ago cannot authorise a swap she
     * decides on later.
     */
    const CHANGE_WINDOW_MS = 120000;

    /**
     * When the user last asked for the music or the place to change, and nothing else.
     *
     * Private sets its scene and its soundtrack once, at setup, and the whole point of that
     * screen is that those decisions are made deliberately and then left alone. So the model
     * does not get to revisit them — but the *user* must, or the setup screen would be a
     * one-way door. This is the difference between the two, recorded at the only moment it can
     * be known: when the person says it.
     */
    let _changeAskedAt = 0;

    /** Did this message ask for the music or the place to change? */
    function asksForChange(text) {
        const said = String(text == null ? '' : text).trim();
        if (!said) return false;
        const media = optional('./MediaCommand.js', 'NEXUS_MEDIA_COMMAND');
        try {
            if (media && typeof media.action === 'function' && media.action(said)) return true;
            if (media && typeof media.transport === 'function' && media.transport(said)) return true;
        } catch (_) {
            // A classifier that throws decides nothing; fall through to the scene words.
        }
        // The scene half. Deliberately narrow: this opens a door, so it should want a sentence
        // that is plainly about changing where they are, not merely one that mentions a place.
        return /\b(change|switch|move|take us|put us|go)\b[^.?!]{0,40}\b(scene|place|room|somewhere|ambience|background)\b/i.test(
            said
        );
    }

    /** Called with the user's own words. Only the user can open this. */
    function noteUserTurn(text) {
        if (asksForChange(text)) _changeAskedAt = Date.now();
    }

    /**
     * May a scene or soundtrack change run right now?
     *
     * Outside Private: always — nothing here narrows ordinary chat. Inside a session: only if
     * the user asked for it within the window above.
     */
    function privateChangeAllowed() {
        if (!privateSessionActive()) return true;
        return Date.now() - _changeAskedAt < CHANGE_WINDOW_MS;
    }

    /** Tests, and a session ending: the next one must not inherit a granted permission. */
    function resetChangeWindow() {
        _changeAskedAt = 0;
    }

    function systemPromptSuffix() {
        const state = sw();
        if (!state || !state.isOn()) return '';
        const chunks = [];
        // The media instruction is withheld while a Private session is running.
        //
        // Private picks its soundtrack once, at setup, from the preflight. That choice is part of
        // the atmosphere: it was made deliberately before anything started and it is meant to sit
        // under the whole evening. Telling the model in the same breath that it can search for and
        // play anything it likes invites exactly what was reported — she says "let me play
        // something to match that vibe", a *different* track starts, and the room the user set up
        // is gone. There is no version of that which is an improvement, because the alternative
        // the model reaches for is always "something else".
        //
        // Ordinary chat keeps the capability untouched; this only removes it for the minutes a
        // Private session is open.
        if (canSearch() && !privateSessionActive()) chunks.push(INSTRUCTION);
        const privateSuffix = privateSystemPromptSuffix();
        if (privateSuffix) chunks.push(privateSuffix.trim());
        return chunks.length ? `\n${chunks.join('\n\n')}\n` : '';
    }

    /**
     * What the chosen ambience is called, or nothing at all (P14).
     *
     * Split out from `currentSceneLabel` because the two callers want different things and one
     * string was serving both badly. A *sentence* needs something to say when no scene is set, and
     * `this place` reads fine inside "…this place feels like a good place for it." A *label* needs
     * the name or an empty slot: the Private card printed the literal words `this place` in its
     * header where a scene name goes, which is a placeholder reaching production.
     */
    function currentSceneName(win) {
        const bb = win && win.NEXUS_BD && win.NEXUS_BD.blackboard;
        const scene = bb && bb.scene;
        if (scene && typeof scene === 'object') {
            const named = scene.label || scene.title || scene.id;
            return named ? cleanText(named, 120) : '';
        }
        if (scene) return cleanText(scene, 120).replace(/[-_]+/g, ' ');
        return '';
    }

    function currentSceneLabel(win) {
        return currentSceneName(win) || 'this place';
    }

    class IntimateExperienceSession {
        constructor({
            activity,
            preset,
            soundtrack,
            plan,
            track,
            scene,
            adult,
            director,
            win,
            bus,
            say,
            timingScale,
            now,
        } = {}) {
            this.activity = activity || null;
            this.preset = PRIVATE_PRESETS[preset] || PRIVATE_PRESETS.affectionate;
            this.soundtrack = ['choose', 'current', 'none'].includes(soundtrack) ? soundtrack : 'choose';
            this.adult = adult || null;
            this.director = director || (global && global.NEXUS_BD) || null;
            this.win = win || global || null;
            this.doc = this.win && this.win.document ? this.win.document : null;
            this.bus = bus || (this.director && this.director.bus) || null;
            this.say = say || (this.win && this.win.NEXUS_BD_SAY) || null;
            const configuredScale = timingScale == null && this.win ? this.win.NEXUS_PRIVATE_TIMING_SCALE : timingScale;
            this.timingScale = configuredScale == null ? 1 : Math.max(0, Number(configuredScale) || 0);
            this.now = typeof now === 'function' ? now : () => Date.now();
            this.state = 'idle';
            this.startedAt = null;
            this.view = null;
            this._timers = new Set();
            this._unsubscribes = [];
            this._ownsMedia = false;
            this._modeEntered = false;
            this._stopped = false;
            /**
             * The beats for this session. The written plan is in hand before anything is
             * spoken, so the opening never waits on a provider; a generated one replaces it
             * in `_planAhead` if and when it arrives and validates, which is in time for
             * every beat after the opening.
             */
            this.plan = plan || null;
            /** A track the prepare step already found, so the session plays rather than searches. */
            this.track = track || null;
            /** The ambience scene this evening asked for, and what was showing before it. */
            this.scene = scene || null;
            this._sceneBefore = null;
            /**
             * Which way the 45-second choice went. It used to be spoken and thrown away —
             * `middle` and `closing` were the same strings either way — so the one branch in
             * the experience had no consequence. Now it selects them, and it reaches the
             * prompt suffix so the model answering in chat is in the same mood she is.
             */
            this.mood = null;
            /** Turns the user has taken. The arc waits for a talker; see `_schedule`. */
            this._turns = 0;
            this._lastTurnAt = 0;
            /**
             * The last turn the person took, as `PrivateTurnDirector` read it (P8).
             *
             * Classified locally, so the experience can react before a single token comes back:
             * a pace request eases off at 50 ms rather than at whatever the provider costs, and
             * a question suppresses the next scheduled line immediately rather than being
             * talked over by it.
             */
            this._turn = null;
            /**
             * When the composer last saw a keystroke — which is not a turn.
             *
             * Kept separately from `_lastTurnAt` because the two answer different questions.
             * Taking the floor from a scheduled beat needs a turn that actually exists, or an
             * empty input somebody pressed Enter on would mute the session. Deciding whether to
             * *hang up* does not: a person still typing at the 300-second mark has not sent
             * anything yet and ending on them would be the worst possible reading of the clock.
             */
            this._composingAt = 0;
            /**
             * She was asked something and has not answered yet.
             *
             * Its own flag rather than a re-read of `_turn`, because it is cleared by the reply
             * landing — and what clears it is an event from the conversation surface, not
             * anything this session can see in the text.
             */
            this._pendingQuestion = false;
            /**
             * The stages of a silence (P17). Created at `start()`; see `PrivateIdleClock`.
             *
             * Null until then, and null again after `stop`, so nothing can tick a clock for a
             * session nobody is in.
             */
            this._idle = null;
            /** True while an idle stage is speaking, so its own line cannot reset the clock. */
            this._inIdleStage = false;
            /** How she should be talking, as the conversation has suggested. P15 acts on it. */
            this.style = null;
            /**
             * Whether the style was *asked for* rather than inferred (P11).
             *
             * `Slow down` sets `style = 'quiet'` explicitly, and an explicit request must not be
             * undone by the classifier noticing a chatty turn three sentences later. Only another
             * explicit choice leaves it, which is the same rule the pace has always had.
             */
            this._styleLocked = false;
            /**
             * The second dimension (P11). See `PrivatePace`.
             *
             * Private thought only in pace — Warm, Romantic, Sensual — so at Warm `Slow down` had
             * nothing left to lower and the only honest answer was a sentence saying so, six times.
             * Energy is texture rather than consent: it grants nothing, so it can be lowered freely.
             */
            this.energy = (paceModel() && paceModel().DEFAULT_ENERGY) || 'present';
            /** Guided lines are held until this time. See `_suppressGuidance`. */
            this._guidanceHeldUntil = 0;
            /**
             * How many steps forward the person has taken (P12).
             *
             * Read by the prompt overlay, which needs to say that the current level was *asked for*
             * rather than let the model infer intent from a number. Counts presses and typed
             * requests alike, because both are the same explicit act.
             */
            this._advances = 0;
            /**
             * Choices read out of the reply that is still arriving (P13).
             *
             * Held rather than drawn because `sanitizeReply` runs at the `displayText` seam, and on
             * the non-streaming path that is before the turn they belong under exists. Empty means
             * the model wrote no block, and the local set goes up instead.
             */
            this._pendingChoices = [];
            /**
             * What this session has already said and already offered (P11).
             *
             * Six identical lines was one symptom of a script with no memory of itself. Every guided
             * interaction asks the ledger before it runs, so any path that could fire twice is
             * caught rather than only the one that was reported.
             */
            this.novelty = (noveltyModel() && noveltyModel().create()) || null;
            /** Torn off the conversation surface in `_listen`, put back in `afterActivityStop`. */
            this._unwatchTurns = null;
            /** Beats as wall-clock offsets rather than live timers. See `_beat`. */
            this._beats = [];
            this._unwatchVisibility = null;
            /** The safety valve on the thinking dots. See `_yieldToConversation`. */
            this._thinkingTimer = null;
            const bb = this.director && this.director.blackboard;
            const modes = this.director && this.director.modes;
            this.snapshot = {
                activity: bb ? bb.activity : undefined,
                escalationLevel: bb ? bb.escalationLevel : undefined,
                modeId: modes ? modes.activeId : null,
            };
            const Focus = this.win && this.win.NEXUS_BD_PLAYGROUND && this.win.NEXUS_BD_PLAYGROUND.AudioFocusManager;
            this.audioFocus = Focus ? new Focus({ win: this.win, bus: this.bus }) : null;
        }

        start() {
            if (this.state !== 'idle') return { ok: false, why: 'Private experience already started' };
            if (!this.adult || !this.adult.active) return { ok: false, why: 'Private consent flow is not active' };
            const bb = this.director && this.director.blackboard;
            const modes = this.director && this.director.modes;
            if (bb) bb.activity = 'intimate';
            if (modes && typeof modes.activate === 'function' && modes.activeId !== 'adult') {
                this._modeEntered = modes.activate('adult') === true;
            }
            this.startedAt = this.now();
            this.state = 'active';
            this._mount();
            if (!this.view) {
                this.state = 'idle';
                return { ok: false, why: 'Open Conversation before beginning Private' };
            }
            this._listen();
            // The written plan first, so the opening is instant. Asking a provider for one
            // before saying anything would put a silent card in front of somebody who just
            // pressed "Begin private moment", which is the worst possible place for a wait.
            // A prepared plan is the normal path now: the setup screen did the waiting, with
            // named steps, before anybody pressed Begin. The written-fallback-then-upgrade
            // dance below is what happens when a session is started without one — a test, or
            // a caller that skipped the prepare step.
            if (!this.plan) {
                const api = beats();
                this.plan = api ? api.fallbackPlan(this.preset, { mood: this._rememberedMood() }) : null;
                this._planAhead();
            }
            this._enterScene();
            // The scene sentence only when there is actually a scene — `currentSceneName` is empty
            // rather than a placeholder when no ambience is chosen, so the opening cannot end
            // "…this place feels like a good place for it."
            const place = currentSceneName(this.win);
            this._speak(
                place ? `${this._line('opening')} ${place} feels like a good place for it.` : this._line('opening')
            );
            this._startSoundtrack();
            // Something to tap from the first second (P13). The opening is a scripted line, not a
            // model reply, so there is no block to ride back on — and an RPG that made you wait for
            // the second exchange before offering a choice would have got the feel wrong.
            this._offerChoices([], { source: 'local' });
            // Earliest-at rather than fires-at, and each of these waits for a quiet moment.
            //
            // What is *not* here any more (P12): the consent check-in at 120 s, the closing line at
            // 285 s and the completion at 300 s. Private is a persistent mode, not a five-minute arc
            // toward an ending — so intensity is driven by the footer's forward control whenever the
            // person wants it rather than offered by a script that has waited two minutes, there is
            // no "that was nice, let us leave it here" on a clock, and nothing completes the session
            // but `End`.
            //
            // These two are what a scripted beat is actually good for: a question about texture when
            // nothing has been said yet, and an observation to fill a lull. Both are droppable,
            // because a conversation that never had a lull has already answered them.
            // And the clock that notices silence (P17), started from the opening rather than from
            // the mount: the opening is the last thing that happened, so the first minute of quiet
            // is measured from her saying it.
            const idle = idleModel();
            if (idle) this._idle = idle.create(this.now());
            this._beat(45000, () => this._showMoodChoice());
            this._beat(210000, () => this._speak(this._moodLine('middle')));
            this._beat(330000, () => this._offerTextureChoice());
            this._armBeats();
            this._emit('private:session-start', {
                preset: this.preset.id,
                maxLevel: this.preset.maxLevel,
                scene: currentSceneLabel(this.win),
                returning: !this._isFirstSession(),
            });
            return { ok: true, why: 'active', preset: this.preset.id };
        }

        beforeActivityStop(why) {
            if (this._stopped) return;
            this._stopped = true;
            this.state = 'restoring';
            this._clearTimers();
            // Nothing can tick a clock for a session nobody is in (P17).
            this._idle = null;
            this._stopSoundtrack();
            this._restoreScene();
            if (this.audioFocus && typeof this.audioFocus.restore === 'function') this.audioFocus.restore();
            const modes = this.director && this.director.modes;
            if (this._modeEntered && modes && modes.activeId === 'adult' && typeof modes.deactivate === 'function') {
                modes.deactivate();
            }
            this._emit('private:session-ending', { preset: this.preset.id, why: why || 'user' });
        }

        afterActivityStop(why) {
            const modes = this.director && this.director.modes;
            if (
                modes &&
                this.snapshot.modeId &&
                this.snapshot.modeId !== 'companion' &&
                modes.activeId === 'companion' &&
                typeof modes.deactivate === 'function'
            ) {
                modes.deactivate();
            }
            const bb = this.director && this.director.blackboard;
            if (bb) {
                bb.activity = this.snapshot.activity;
                bb.escalationLevel = this.snapshot.escalationLevel;
            }
            if (this._unwatchTurns) {
                try {
                    this._unwatchTurns();
                } catch (_) {}
                this._unwatchTurns = null;
            }
            for (const stop of this._unsubscribes.splice(0)) {
                try {
                    stop();
                } catch (_) {}
            }
            this._unmount();
            this.state = 'complete';
            this._emit('private:session-stop', { preset: this.preset.id, why: why || 'user' });
        }

        statusDetail() {
            if (this.state === 'complete') return 'Complete';
            if (this.state === 'restoring') return 'Restoring';
            return 'Private';
        }

        /**
         * Hear the conversation itself, not a guess about it (P8).
         *
         * Every turn in the application passes through `ConversationSurface`, so this is where
         * the session finds out that somebody typed something — with the text, at the moment
         * they sent it — and that her reply has actually finished. Before this the session
         * learned about a turn from a `keydown` on the composer and then assumed eight seconds.
         *
         * Separate from the bus subscriptions below because it is a different kind of fact: the
         * bus carries consent events, this carries whose turn it is.
         */
        _watchConversation() {
            const api = surfaceApi(this.win);
            if (!api || typeof api.observe !== 'function') return false;
            this._unwatchTurns = api.observe((event) => {
                if (!event || this._stopped) return;
                if (event.type === 'user') this._onUserTurn(event.text);
                else if (event.type === 'assistant-end') this._onAssistantFinished(true);
                else if (event.type === 'assistant-discarded') this._onAssistantFinished(false);
            });
            return true;
        }

        /**
         * A turn the person took, read locally before the provider is asked anything.
         *
         * The two safety intents act here rather than waiting for the model, and that is the
         * point of classifying locally at all: `ConsentFlow` already guarantees that easing off
         * and leaving happen "within one scheduler tick", and a person who types "slow down"
         * rather than saying it out loud deserves the same guarantee. Until now they did not
         * get it — `ConsentFlow.hear` is subscribed to `voice:final` only, so **typed** safe
         * words reached nothing at all and were answered, eventually, by whatever the model
         * made of them.
         */
        _onUserTurn(text) {
            // Asking for different music, or a different room, is a decision only the person gets
            // to make once a session is running. Recorded here because this is the one place the
            // user's own words are seen.
            noteUserTurn(text);
            const at = this.now();
            this._turns += 1;
            this._lastTurnAt = at;
            const td = turnDirector();
            const turn = td && typeof td.classify === 'function' ? td.classify(text) : null;
            this._turn = turn;
            this._pendingQuestion = Boolean(turn && turn.holdsTheFloor);
            // The ledger's clock is turns, not seconds: five turns of talking is real distance and
            // five seconds is none. A preference or an agreement counts as answering whatever she
            // had asked; anything else, with a question outstanding, is the person talking past it.
            const novelty = noveltyModel();
            if (novelty && this.novelty) {
                const intent = turn && turn.intent;
                novelty.noteTurn(this.novelty, {
                    answered: intent === 'preference' || intent === 'affirmation',
                });
            }
            const suggested = turn && td && typeof td.styleFor === 'function' ? td.styleFor(turn.intent) : null;
            // An explicit `Slow down` is not undone by the classifier noticing a chatty turn. Only
            // another explicit choice leaves that state — the same rule the pace has always had.
            if (suggested && !this._styleLocked) this.style = suggested;
            // Writing your own line is answering. Leaving the old options tappable underneath it
            // would let somebody say two things in one turn.
            if (this.view && typeof this.view.clearChoices === 'function') this.view.clearChoices();
            this._userIsTalking();
            this._emit('private:user-turn', { preset: this.preset.id, intent: turn ? turn.intent : null });
            if (!turn) return null;
            if (turn.intent === 'end') {
                // Not `adult.exit('hard')`: stopping the activity runs the whole teardown —
                // soundtrack handed back, scene restored, mode left, blackboard put back — and
                // a bare hard exit would leave a mounted card in a session nobody is in.
                this._requestEnd(false);
                return turn;
            }
            if (turn.intent === 'pace-down') {
                // Typed, so it is a *word* rather than a step on a dial — and a word asking to slow
                // down is answered the way `cozy` is: all the way down, in one tick, from anywhere.
                // The stepping control is for somebody steering; this is for somebody who wants it
                // to stop being intense now.
                this._softenAllTheWay();
            }
            if (turn.intent === 'pace-up-request') {
                // Asked for, not granted. The same route the button takes, so `initiated` and the
                // ceiling decide — and so "come closer" cannot skip a step the button could not.
                this._advanceIntensity();
            }
            return turn;
        }

        /**
         * Her reply landed, or was abandoned. Either way the floor is free.
         *
         * The dots come down here as well as in the view's own observer: this fires on the
         * reply *finishing*, which is the honest signal, where the view is watching the chat
         * container for a mutation that a Private-drawn reply no longer produces.
         *
         * `answered` is false for a turn that was thrown away — the user pressed CLEAR, the
         * stream died. A question asked into that is still owed an answer, so it stays pending
         * and `_beatIsEligible` keeps the script quiet for a while rather than changing the
         * subject in the second after her reply vanished.
         */
        _onAssistantFinished(answered = true) {
            this._noteLive();
            if (answered) this._pendingQuestion = false;
            // Her reply is in, and the turn it belongs to now exists on both the streaming and the
            // non-streaming path. Whatever `sanitizeReply` read out of it goes up here; an empty
            // stash falls through to the local set, so there is never a turn with nothing to tap.
            // Either way it costs no round trip — the block came back inside the reply.
            const stashed = this._pendingChoices;
            this._pendingChoices = [];
            if (answered) this._offerChoices(stashed, { source: stashed.length ? 'model' : 'local' });
            if (this.view && typeof this.view.hideThinking === 'function') this.view.hideThinking();
            if (this._thinkingTimer && this.win && typeof this.win.clearTimeout === 'function') {
                this.win.clearTimeout(this._thinkingTimer);
                this._thinkingTimer = null;
            }
        }

        /**
         * Is the conversation itself mid-turn?
         *
         * Reads the phase from `ConversationSurface` rather than from a deadline, so a beat
         * waits exactly as long as the reply takes — no longer, and no less.
         *
         * The one timeout left is a failure valve, not a guess: `main.js` does not close the
         * turn on every error path, and a provider stuck in the 504-and-retry loop the reported
         * session showed closes nothing at all. Without it a single dead request would mute the
         * rest of the evening, which is a worse failure than a line arriving late.
         */
        _conversationHasFloor() {
            const api = surfaceApi(this.win);
            const state = api && typeof api.turn === 'function' ? api.turn() : null;
            if (!state) return false;
            const stale = THINKING_TIMEOUT_MS * (this.timingScale || 1);
            if (state.phase === 'assistant') return this.now() - state.assistantAt < stale;
            if (state.phase === 'user') return this.now() - state.userAt < stale;
            // She finished a moment ago. Let the sentence land before scripting over it.
            const since = this.now() - (state.assistantEndedAt || 0);
            return state.assistantEndedAt > 0 && since < BREATHING_ROOM_MS * (this.timingScale || 1);
        }

        /**
         * Whether a scheduled beat may speak now.
         *
         * The whole of P8 in one expression, and the replacement for
         * `now() < _conversationBusyUntil`: never over the person, never over the model, and
         * never on top of a question she still owes an answer to.
         */
        _beatIsEligible() {
            if (this._conversationHasFloor()) return false;
            if (this._pendingQuestion) {
                // A question whose reply never arrived. Bounded by the same valve as the floor,
                // because "she owes you an answer" must not become a mute for the rest of the
                // evening — the same reasoning as `_conversationHasFloor`, for the same reason.
                if (this.now() - this._lastTurnAt < THINKING_TIMEOUT_MS * (this.timingScale || 1)) return false;
                this._pendingQuestion = false;
            }
            return true;
        }

        /**
         * One step closer, because the person asked for one step closer (P12).
         *
         * This is Private's primary action, and promoting it is the correction P12 exists for. The
         * mechanism was already here — a scripted question eventually showed a button and took the
         * answer through the gate — but it was reachable only on a two-minute timer. So the
         * emotional centre of the experience was something that happened *to* the person
         * occasionally, while the loudest control in the card was de-escalation.
         *
         * Four properties, the mirror of `_easeUp`'s:
         *
         *   **Explicit.** Nothing but a press or a typed request reaches this. No timer, no
         *   inference, no reading of the mood — `proactiveNsfw: false` and there is still no code
         *   path that raises a level without somebody asking.
         *
         *   **Immediate.** The acknowledgement is local and written. Waiting on a provider to find
         *   out whether your own tap worked is the thing that made this feel like a workflow.
         *
         *   **One step.** Warm → Romantic → Sensual, never two at once, never straight to the
         *   ceiling. Precise control in both directions is the whole point of a two-way control.
         *
         *   **Not an arc.** Reaching the ceiling is a place to stay, not an ending. Nothing here
         *   completes the session; only `End` does.
         */
        _advanceIntensity() {
            if (this._stopped || this.state === 'complete') return false;
            const pace = paceModel();
            const level = Math.max(1, Number(this.adult && this.adult.level) || 1);
            const next = pace
                ? pace.stepUp({ level, energy: this.energy, maxLevel: this.preset.maxLevel })
                : { changed: false };

            // At the preset's ceiling. The forward control is not drawn here, so this is reachable
            // only by a typed request — and the honest answer is that there is no more to give
            // rather than a line implying the preset could be changed mid-session.
            if (!next.changed) {
                this._status(t('status.ceiling'));
                return false;
            }

            // The gate decides, not this file. `initiated` is §16.4's user-initiation route: it
            // still refuses to exceed the ceiling and still refuses outside the tier, and its floor
            // is now `userStepMinMs` rather than the two-minute cadence for *her* asking.
            const asked = this.adult && typeof this.adult.initiated === 'function' ? this.adult.initiated() : null;
            if (!asked || asked.action !== 'advanced') {
                // The only realistic refusal is a second press inside four seconds — a double-tap.
                // Say so without drama and without moving anything.
                this._status(t('status.moment'));
                return false;
            }

            this._advances += 1;
            this.energy = next.energy;
            // An explicit forward request is the one thing allowed to leave the quiet state. Not a
            // timer, not a warm turn, not the model's reading of the mood.
            this._styleLocked = false;
            this.style = null;
            this._guidanceHeldUntil = 0;
            this._paintLevel();
            // The level's name in the card's language, not `PACE_LABELS`, which is English on purpose.
            const locale = localeModel();
            this._status(`✓ ${locale && typeof locale.pace === 'function' ? locale.pace(asked.level) : asked.level}`);
            // Presence rather than performance: never the adult ceiling's own intents. See `_intent`.
            this._intent('lean_in', 0.35);
            // The music comes back up to where it started, since the person asked for more rather
            // than less. `softenSoundtrack` took it down; this is the same dial the other way.
            if (this.view && typeof this.view.restoreSoundtrack === 'function') this.view.restoreSoundtrack();
            this._speakStepLine('levelLines', asked.level, 'Okay. A little closer, still at your pace.');
            this._emit('private:intensity', {
                preset: this.preset.id,
                level: asked.level,
                energy: this.energy,
                direction: 'up',
            });
            return true;
        }

        /**
         * One step gentler, because the person asked for one step gentler (P12).
         *
         * Secondary to the forward control and always available while there is a step to give back.
         * It keeps everything P11 got right — idempotent at the floor, silent when it cannot act,
         * never a paragraph explaining itself — and drops what P11 got wrong: it stepped from Sensual
         * to Warm in one tap. That is correct for a safe *word*, and `ConsentFlow.exit('soft')` still
         * does exactly that for `cozy` and for the typed phrases the director reads as a pace
         * request. It is the wrong shape for a control somebody is steering with, where a cliff is
         * not precision.
         */
        _easeUp() {
            if (this._stopped || this.state === 'complete') return false;
            const pace = paceModel();
            const level = Math.max(1, Number(this.adult && this.adult.level) || 1);
            const next = pace
                ? pace.stepDown({ level, energy: this.energy, maxLevel: this.preset.maxLevel })
                : { changed: false };

            // Already as gentle as the experience goes. The confirmation is the whole response: the
            // request was heard, and there is nothing to narrate. Six identical lines came from
            // narrating this case.
            if (!next.changed) {
                this._status(t('status.alreadyGentle'));
                return true;
            }

            // The consent level is `ConsentFlow`'s to lower, never this file's. `eased` is one step;
            // `exit('soft')` remains the all-the-way-down safe word.
            if (next.loweredPace && this.adult && typeof this.adult.eased === 'function') this.adult.eased();

            this.energy = next.energy;
            if (next.atFloor) {
                // At the bottom of both dials the register is a request rather than a suggestion, and
                // the classifier must not drift back out of it on the next chatty turn.
                this.style = 'quiet';
                this._styleLocked = true;
                this._suppressGuidance(GUIDANCE.afterSlowDownMs);
            }
            this._withdrawOffers();
            this._paintLevel();
            this._status(next.loweredPace ? t('status.eased') : t('status.quieter'));
            if (this.view && typeof this.view.softenSoundtrack === 'function') this.view.softenSoundtrack();
            this._intent('breathe', 0.2);
            this._speakStepLine('easeLines', next.level, EASE_LINES[next.level]);
            this._emit('private:intensity', {
                preset: this.preset.id,
                level: next.level,
                energy: this.energy,
                direction: 'down',
            });
            return true;
        }

        /**
         * The one short line a step is worth, from the plan when it has one.
         *
         * Through `_sayBrief` rather than `_speak`: a step acknowledgement belongs on screen and in
         * the voice, and belongs out of the history for the same reason P11's did — the model
         * answering the next turn already knows the level from the prompt overlay, and a line about
         * the control is something it might elaborate on instead.
         *
         * The novelty ledger still applies, so a step taken twice in an evening — down and then up
         * and then down again — cannot produce the same sentence twice.
         */
        _speakStepLine(field, level, fallback) {
            const lines = (this.plan && this.plan[field]) || null;
            const written = lines && (lines[level] || lines[String(level)]);
            const line = cleanText(written || fallback, 200);
            if (!line) return false;
            const novelty = noveltyModel();
            if (novelty && this.novelty) {
                if (novelty.saidAlready(this.novelty, line)) return false;
                novelty.noteLine(this.novelty, line);
            }
            return this._sayBrief(line);
        }

        /**
         * All the way down, for a request phrased as a word rather than a step.
         *
         * A typed "slow down", "too much", "cozy". `ConsentFlow.exit('soft')` is the right mechanism
         * — one tick, from any state, straight to the bottom, no degrees — because a safe word should
         * not need to be repeated to be obeyed. The stepping controls are for steering; this is for
         * being heard.
         *
         * Idempotent for the same reason `_easeUp` is: at the floor it changes nothing and says
         * nothing, so a person who taps `← Ease up` and then types the words does not get two
         * acknowledgements for one request.
         */
        _softenAllTheWay() {
            if (this._stopped || this.state === 'complete') return false;
            const pace = paceModel();
            const level = Math.max(1, Number(this.adult && this.adult.level) || 1);
            if (pace && pace.atFloor({ level, energy: this.energy, maxLevel: this.preset.maxLevel })) {
                this._status(t('status.alreadyGentle'));
                return true;
            }
            if (level > 1 && this.adult && typeof this.adult.exit === 'function') this.adult.exit('soft');
            this.energy = 'quiet';
            this.style = 'quiet';
            this._styleLocked = true;
            this._withdrawOffers();
            this._suppressGuidance(GUIDANCE.afterSlowDownMs);
            this._paintLevel();
            this._status(t('status.softened'));
            if (this.view && typeof this.view.softenSoundtrack === 'function') this.view.softenSoundtrack();
            this._intent('breathe', 0.2);
            this._speakStepLine('easeLines', 1, EASE_LINES[1]);
            this._emit('private:intensity', { preset: this.preset.id, level: 1, energy: 'quiet', direction: 'down' });
            return true;
        }

        /**
         * Put two or three things to say on screen (P13).
         *
         * The interaction people mean when they say a conversation with a character feels good:
         * there is always something to *pick*, so the next turn costs a tap rather than a sentence
         * and the pace is set by choosing rather than by a clock.
         *
         * `source: 'model'` is the set that came back inside her reply, which is why there is no
         * second round trip and no extra wait. An empty set from that source is not nothing — it
         * means the model did not write the block, or wrote one that failed validation — so this
         * falls through to the local set, and there is never a turn with nothing to tap.
         */
        /** Hold what the reply carried until there is a turn to hang it under. See above. */
        _stashChoices(list) {
            this._pendingChoices = Array.isArray(list) ? list.filter(Boolean) : [];
            return this._pendingChoices.length;
        }

        _offerChoices(list, { source = 'local' } = {}) {
            if (this._stopped || this.state === 'complete' || !this.view) return false;
            if (typeof this.view.showChoices !== 'function') return false;
            const api = choicesModel();
            let choices = Array.isArray(list) ? list.filter(Boolean) : [];
            if (!choices.length) {
                if (!api || typeof api.fallback !== 'function') return false;
                const pace = paceModel();
                const shown = pace
                    ? pace.describe({ level: this._level(), energy: this.energy, maxLevel: this.preset.maxLevel })
                    : null;
                choices = api.fallback({
                    pace: shown ? shown.pace : 'Warm',
                    energy: this.energy,
                    intent: this._turn && this._turn.intent,
                    opening: this._turns === 0,
                    scene: Boolean(this.scene),
                    music: this._ownsMedia,
                });
            }
            if (!choices.length) return false;
            this.view.showChoices(choices, (text) => this._chooseReply(text));
            this._emit('private:choices', { preset: this.preset.id, count: choices.length, source });
            return true;
        }

        /**
         * They tapped one. Send it as their turn.
         *
         * Through `ConversationSurface.send`, which is one line into `handleUserMessage` — so the
         * prompt assembly, the provider, the directives and the drawing of the user's turn are the
         * ones typed text gets. A feature that reimplemented any of that would drift from it, and
         * the drawing in particular: `renderUser` already runs on that path, so drawing it here too
         * would put the line on screen twice.
         *
         * The quiet option is the exception and the reason `isQuiet` exists. "Say nothing" is a
         * move, not a sentence, and sending the literal text `[stay quiet]` to the model would be
         * asking it to interpret a stage direction as speech. It is answered locally.
         */
        _chooseReply(text) {
            if (this._stopped || this.state === 'complete') return false;
            const api = choicesModel();
            const line = cleanText(text, 200);
            if (!line) return false;
            if (api && typeof api.isQuiet === 'function' && api.isQuiet(line)) {
                this._choseQuiet();
                return true;
            }
            const surface = surfaceApi(this.win);
            if (!surface || typeof surface.send !== 'function') return false;
            return surface.send(line) === true;
        }

        /**
         * They chose to say nothing, which is a thing this mode is for.
         *
         * No provider call, so it is instant, and no turn in the history: silence is not a line. The
         * session simply eases toward quiet and leaves the floor alone, which is exactly what the
         * person asked for by picking it.
         */
        _choseQuiet() {
            this.energy = (paceModel() && paceModel().normaliseEnergy('quiet')) || 'quiet';
            this.style = 'quiet';
            this._paintLevel();
            this._status(t('status.quiet'));
            this._intent('breathe', 0.2);
            // A lull is what the guided beats are for, and the person has just declared one.
            this._suppressGuidance(GUIDANCE.idleMs);
            this._emit('private:choices', { preset: this.preset.id, count: 0, source: 'quiet' });
            return true;
        }

        /** The level, clamped to the preset's ceiling. Read in several places; computed in one. */
        _level() {
            return Math.max(1, Math.min(this.preset.maxLevel, Number(this.adult && this.adult.level) || 1));
        }

        /** The footer's transient line, when there is a view to put it in. */
        _status(text) {
            // A press is activity even when it changed nothing — a refused double-tap is still
            // somebody in the room. See `_noteLive`.
            this._noteLive();
            if (this.view && typeof this.view.showTransientStatus === 'function') {
                return this.view.showTransientStatus(text);
            }
            return false;
        }

        /**
         * Say it aloud, put it in the transcript, and keep it out of the history.
         *
         * For the one acknowledgement a control is allowed. `_speak` would also `_remember` it, and
         * a safety confirmation in the history is context the model may answer, elaborate on, or
         * bring up again later — which is the same defect as repeating it, one turn removed.
         */
        _sayBrief(text) {
            const line = cleanText(text, 120);
            if (!line) return false;
            this._showMessage(line, []);
            try {
                if (typeof this.say === 'function') this.say(line);
            } catch (_) {
                // A line on screen without the voice is still the acknowledgement.
            }
            return true;
        }

        /**
         * Take back every offer on screen.
         *
         * A check-in asking "a little more intense?" — or a mood choice offering `Playful` — while
         * the person has just pressed `Slow down` is the interface arguing with them. `state` goes
         * The buttons are spent so nothing on screen can be tapped into a state the person just
         * refused. In a rolling transcript that matters more than it would in a card that wipes
         * itself: an un-spent offer stays tappable for the rest of the evening.
         *
         * The questions stay *visible*, because they were part of the conversation. They stop being
         * controls, which is the part that was arguing.
         */
        _withdrawOffers() {
            if (this.view && typeof this.view.consumePending === 'function') this.view.consumePending();
            const ledger = this.novelty;
            if (ledger && noveltyModel()) noveltyModel().noteAnswered(ledger);
            this._pendingQuestion = false;
            return true;
        }

        /**
         * No unprompted lines for a while.
         *
         * Distinct from P12's lull rule, which asks "has the conversation gone quiet?". This answers
         * "was I just asked for less?", and the answer has to outlast a lull — otherwise pressing
         * `Slow down` and then saying nothing would be met by a scripted beat twenty seconds later,
         * which is precisely the pressure the person asked to be rid of.
         */
        _suppressGuidance(ms) {
            const until = this.now() + Math.max(0, Number(ms) || 0) * (this.timingScale || 1);
            this._guidanceHeldUntil = Math.max(this._guidanceHeldUntil || 0, until);
            return this._guidanceHeldUntil;
        }

        _listen() {
            this._watchConversation();
            if (!this.bus || typeof this.bus.on !== 'function') return;
            this._unsubscribes.push(
                this.bus.on('adult:level', () => this._paintLevel()),
                // A soft exit happened. Repaint, and record that the energy came down with the
                // pace — and **say nothing** (P11).
                //
                // This listener used to speak on every event, which is the whole of the reported
                // bug. `ConsentFlow.exit('soft')` emits unconditionally, `from: 1, to: 1` when
                // there is nothing left to lower, so six taps on a control that could not act
                // produced six identical "We are already as gentle as this gets." turns — in the
                // transcript, in the voice, and in the history the model reads. The sentence was
                // even true. A safety control that generates dialogue is a safety control that can
                // be made to repeat itself, and no amount of better wording fixes that.
                //
                // Acknowledgement is now the control's own job, exactly once, and it lives in the
                // footer rather than the conversation. See `_slowDown`.
                this.bus.on('adult:exit', (event) => {
                    if (!event || event.kind !== 'soft') return;
                    this.energy = 'quiet';
                    this._paintLevel();
                })
            );
        }

        /**
         * A timer in the session's timebase, tracked for teardown, with no eligibility check.
         *
         * `_schedule` defers when the conversation holds the floor, which is right for anything
         * that would *speak*. A timer whose job is to give up on a reply that is not coming
         * needs the opposite, so the two are separate rather than one function with a flag.
         */
        _delay(ms, fn) {
            if (!this.win || typeof this.win.setTimeout !== 'function') return null;
            const id = this.win.setTimeout(
                () => {
                    this._timers.delete(id);
                    if (!this._stopped) fn();
                },
                Math.max(0, Number(ms) || 0) * this.timingScale
            );
            this._timers.add(id);
            return id;
        }

        _schedule(ms, fn) {
            if (!this.win || typeof this.win.setTimeout !== 'function') return null;
            const delay = Math.max(0, Number(ms) || 0) * this.timingScale;
            const id = this.win.setTimeout(() => {
                this._timers.delete(id);
                if (!this._beatIsEligible()) {
                    this._schedule(1000, fn);
                } else if (!this._stopped && this.state !== 'complete') fn();
            }, delay);
            this._timers.add(id);
            return id;
        }

        /**
         * Ask for a written plan for this session, and quietly upgrade to a generated one.
         *
         * Deliberately not awaited by `start()`. The written plan is already good — it draws
         * from pools sized for twenty-four playthroughs per preset — so the model is an
         * improvement on a working floor rather than a dependency. If it lands, it lands
         * before the 45-second beat and every beat after the opening comes from it; if it
         * never lands, nobody can tell.
         */
        _planAhead() {
            const api = beats();
            if (!api || typeof api.plan !== 'function') return null;
            let promise = null;
            try {
                promise = api.plan({
                    preset: this.preset,
                    scene: currentSceneLabel(this.win),
                    win: this.win,
                    mood: this.mood,
                });
            } catch (_) {
                return null;
            }
            if (!promise || typeof promise.then !== 'function') return null;
            return promise
                .then((plan) => {
                    // A session that ended while the provider was thinking must not have its
                    // script swapped underneath a completion card.
                    if (!plan || this._stopped || this.state === 'complete') return null;
                    this.plan = plan;
                    this._emit('private:plan-ready', { preset: this.preset.id, source: plan.source });
                    return plan;
                })
                .catch(() => null);
        }

        _rememberedMood() {
            const store = memory();
            try {
                const kept = store && typeof store.read === 'function' ? store.read() : null;
                return (kept && kept.mood) || null;
            } catch (_) {
                return null;
            }
        }

        _isFirstSession() {
            const store = memory();
            try {
                return !store || typeof store.isFirstSession !== 'function' || store.isFirstSession();
            } catch (_) {
                return true;
            }
        }

        /** One plan field, falling back to the preset's original string for that beat. */
        _line(field) {
            const fromPlan = this.plan && typeof this.plan[field] === 'string' ? this.plan[field] : '';
            return fromPlan || this.preset[field] || '';
        }

        /**
         * A beat that depends on the mood.
         *
         * Before a mood is chosen there is no wrong answer, so the plan's tender variant
         * stands in — it is the gentler of the two, and defaulting to the gentler one is the
         * same instinct as starting at level 1.
         */
        _moodLine(field) {
            const section = this.plan && this.plan[field];
            if (section && typeof section === 'object') {
                const chosen = section[this.mood] || section.tender || section.playful;
                if (chosen) return chosen;
            }
            return this.preset[field] || '';
        }

        _clearTimers() {
            if (this._unwatchVisibility) {
                try {
                    this._unwatchVisibility();
                } catch (_) {}
                this._unwatchVisibility = null;
            }
            this._beats = [];
            if (!this.win || typeof this.win.clearTimeout !== 'function') return;
            for (const id of this._timers) this.win.clearTimeout(id);
            this._timers.clear();
        }

        /**
         * Register a beat at a wall-clock offset from the session's start.
         *
         * The five beats used to be five independent `setTimeout`s spanning five minutes with
         * gaps of 75, 90 and 75 seconds between them, and that is not a schedule a browser
         * will honour. A hidden tab has its timers clamped to roughly one a minute, and after
         * about five minutes hidden Chrome may freeze them outright; locking a phone or
         * switching apps does the same. So a session where somebody looked away after the
         * 210-second line simply never got the closing or the completion — the card sat there,
         * still mounted, still showing its buttons, with nothing left that would ever fire.
         * Reported, accurately, as "later nothing happens".
         *
         * Storing the offset instead of trusting a timer fixes it, because a late tick can
         * still work out what it missed. `_tick` fires everything now due.
         *
         * `at` is now the **earliest** a beat may speak rather than the moment it does (P12). It
         * keeps the arc's shape — the check-in does not arrive thirty seconds after the opening —
         * and `_tick` decides whether the evening actually wants the line yet.
         *
         * Every beat is guided — it waits for a quiet moment. There used to be one that did not,
         * the 300-second completion, and P12 removed it along with the idea that an evening ends on
         * a clock. The option that exempted it is gone too rather than left as a promise nothing
         * keeps: a future non-guided beat would need the overtake protection back with it.
         *
         * @param {number} at         earliest elapsed ms at which this beat may speak
         * @param {Function} run      what it says
         * @param {object} [options]
         * @param {boolean} [options.stale=true]   whether it may be dropped for arriving too
         *        late to be worth saying. See `GUIDANCE.staleAfterMs`.
         */
        _beat(at, run, { stale = true } = {}) {
            this._beats.push({
                at: Math.max(0, Number(at) || 0),
                run,
                done: false,
                stale,
                /** `_turns` when this beat first came due, for deciding whether it went stale. */
                dueTurns: null,
                dueAt: null,
            });
            return this._beats.length;
        }

        /**
         * Something is happening, so the silence has not started yet (P17).
         *
         * One definition of "live" rather than one per caller. Reached from every route in — a
         * keystroke, a reply landing, a button answered, a line she says, a control pressed — so a
         * future path that forgets to call it fails in the safe direction: she notices a quiet that
         * is not quite as old as it looks, rather than talking over somebody.
         */
        _noteLive() {
            // Except when it is the silence itself talking (P17). A noticing line goes through
            // `_showMessage` like every other line she says, and without this exemption stage 1
            // would reset the clock it just advanced: she would notice the quiet every sixty
            // seconds forever and stages 2 and 3 would be unreachable.
            if (this._inIdleStage) return false;
            const api = idleModel();
            if (api && this._idle) api.active(this._idle, this.now());
            return true;
        }

        /**
         * Is anybody in the middle of something? The whole of P17's risk is in this function.
         *
         * Every one of these is somebody mid-turn, and a nudge over the top of any of them is worse
         * than no nudge at all: she would be interrupting her own voice, or answering a sentence
         * that is still being typed.
         *
         * `companionMode._replyAudioBusy` is asked first and reused rather than re-derived, for the
         * reason `arAudioBusy` in `main.js` documents: Piper plays through WebAudio and is entirely
         * invisible to `speechSynthesis.speaking`, so a naive check reads a reply that is still
         * being spoken as finished. That is the exact bug this would otherwise reintroduce, and it
         * would be at its worst here — interrupting herself mid-sentence to remark on the silence.
         */
        _idleBusy() {
            if (this._conversationHasFloor()) return true;
            if (this._replyAudioBusy()) return true;
            if (this.now() - (this._composingAt || 0) < COMPOSING_MS * (this.timingScale || 1)) return true;
            if (this._composerHasText()) return true;
            if (this._voiceIsListening()) return true;
            // Somebody who has just asked for less has asked for room, not for company. The hold
            // resets the clock rather than pausing it, so the minute starts when the hold ends.
            if (this.now() < (this._guidanceHeldUntil || 0)) return true;
            return false;
        }

        /** Is her voice still playing? See `_idleBusy` for why this is not `speechSynthesis`. */
        _replyAudioBusy() {
            try {
                const win = this.win;
                const companion = win && win.companionMode;
                if (companion && typeof companion._replyAudioBusy === 'function') {
                    return companion._replyAudioBusy() === true;
                }
                if (win && win.SpeechService && win.SpeechService.isSpeaking) return true;
                const synth = win && win.speechSynthesis;
                if (synth && (synth.speaking || synth.pending)) return true;
            } catch (_) {
                // A busy check that throws must never read as busy forever: that would mute the
                // idle clock for the rest of the session.
            }
            return false;
        }

        /** A half-written line nobody has sent yet is not a silence. */
        _composerHasText() {
            if (!this.doc || typeof this.doc.getElementById !== 'function') return false;
            const input = this.doc.getElementById('speech-text') || this.doc.getElementById('chatInput');
            return Boolean(input && String(input.value || '').trim());
        }

        /** Nor is a live microphone. */
        _voiceIsListening() {
            try {
                const speech = this.win && this.win.SpeechService;
                return Boolean(speech && speech.isRecognizing);
            } catch (_) {
                return false;
            }
        }

        /**
         * Move the clock one step, and do whatever the new stage is.
         *
         * Driven from `_tick`, which the beat machinery already runs on a timer and on
         * `visibilitychange` — the same wall-clock catch-up, pointed at a second question. At most
         * one stage per tick, so a tab that was hidden for ten minutes comes back to somebody who
         * noticed rather than to three stages in one second.
         *
         * **Nothing reached from here may change the level.** Not the noticing line, not the
         * buttons, not stage 3. Silence is not a request, and a companion who gets closer because
         * you stopped typing is the failure this whole design is arranged against. There is no call
         * to `ConsentFlow.initiated` below this line and there must never be one.
         */
        _tickIdle() {
            const api = idleModel();
            if (!api || !this._idle || this.state !== 'active') return 0;
            const stage = api.tick(this._idle, {
                at: this.now(),
                busy: this._idleBusy(),
                scale: this.timingScale || 1,
            });
            if (!stage) return 0;
            this._emit('private:idle', { preset: this.preset.id, stage, level: this._level() });
            this._inIdleStage = true;
            try {
                if (stage === 1) this._noticeQuiet();
                else if (stage === 2) this._offerIdleChoices();
                else this._settleIntoAmbience();
            } catch (error) {
                // A stage that throws must not take the rest of the evening with it — the same
                // fail-soft a beat gets, for the same reason.
                console.warn('[Private] an idle stage failed', error);
            } finally {
                // `finally`, so a stage that throws cannot leave the clock permanently unable to
                // hear the person come back.
                this._inIdleStage = false;
            }
            return stage;
        }

        /**
         * Stage 1: one line that notices the quiet, and never a system notice.
         *
         * "Are you still there?" is the sentence a support widget says. It is correct, harmless,
         * and it ends the scene — which is why `PrivateIdleClock.BANNED` refuses it and the pool is
         * written as story beats that happen to acknowledge a silence.
         *
         * When she is owed an answer the line *releases* the question instead of adding a second
         * one. `PrivateNovelty`'s ignored-question rule already stops the script asking again; this
         * is the other half of being asked something and saying nothing — the kind response is to
         * take the question back, not to let it stand there.
         */
        _noticeQuiet() {
            const api = idleModel();
            if (!api) return false;
            const owed = this._pendingQuestion || this._hasLiveOffer();
            const pool = owed ? api.RELEASING : api.NOTICING;
            const novelty = noveltyModel();
            for (const candidate of pool) {
                const line = api.usable(candidate);
                if (!line) continue;
                if (novelty && this.novelty && novelty.saidAlready(this.novelty, line)) continue;
                if (owed) {
                    // She has withdrawn it, so the offer on screen stops being an offer and the
                    // ledger stops holding the rest of the script behind an answer nobody owes.
                    this._withdrawOffers();
                    this._answeredOffer();
                }
                this._speak(line, { intent: 'breathe' });
                return true;
            }
            // Nothing left that has not been said. Silence is the honest answer — a script with
            // nothing new to offer should be quiet rather than clever.
            return false;
        }

        /**
         * Stage 2: three ways back in, and no model call.
         *
         * Somebody who has already said nothing for two minutes is the last person who should be
         * asked to wait for a provider, so these are local and instant. See `PrivateChoices.idle`
         * for why `[stay quiet]` is not among them.
         */
        _offerIdleChoices() {
            const api = choicesModel();
            if (!api || typeof api.idle !== 'function') return false;
            return this._offerChoices(api.idle(), { source: 'idle' });
        }

        /**
         * Stage 3: she stops talking, and stays.
         *
         * The point of the last stage is that there is no fourth. A companion who keeps producing
         * lines into an empty room is a notification, and the person has made it clear they are
         * not reading. One slow breath and then nothing until they act.
         */
        _settleIntoAmbience() {
            this._intent('breathe', 0.15);
            return true;
        }

        /** Is there a question on screen still waiting to be answered? */
        _hasLiveOffer() {
            const log = this.view && this.view.log;
            if (!log || typeof log.querySelector !== 'function') return false;
            return Boolean(log.querySelector('.nexus-private-actions:not([data-spent])'));
        }

        /** When the next idle stage could open, in the session's unscaled timebase. */
        _idleNextIn() {
            const api = idleModel();
            if (!api || !this._idle || this.state !== 'active') return null;
            const scale = this.timingScale || 1;
            const ms = api.nextIn(this._idle, { at: this.now(), scale, floor: 0 });
            return ms == null ? null : ms / scale;
        }

        /**
         * The last thing that happened in the conversation, whoever did it.
         *
         * All three matter and for the same reason: a guided line is an interruption unless
         * everybody has finished. A turn they sent, a key they are still pressing, and her own
         * reply settling are each somebody in the middle of something.
         */
        _lastActivityAt() {
            const api = surfaceApi(this.win);
            const state = api && typeof api.turn === 'function' ? api.turn() : null;
            const replyAt = state ? Math.max(state.assistantEndedAt || 0, state.assistantAt || 0) : 0;
            return Math.max(this._lastTurnAt, this._composingAt, replyAt);
        }

        /**
         * Has the conversation gone quiet enough to want a line from the script?
         *
         * A session where nothing has happened at all — nobody typed, she has said only her
         * opening — is quiet by definition, which is what keeps the arc intact for the silent
         * evening it exists to shape.
         */
        _quietEnough() {
            // An explicit request for less outranks a lull (P11). See `_suppressGuidance`.
            if (this.now() < (this._guidanceHeldUntil || 0)) return false;
            const since = this.now() - this._lastActivityAt();
            return since >= GUIDANCE.idleMs * (this.timingScale || 1);
        }

        /** Milliseconds since `start()`, in the session's own (test-scalable) timebase. */
        _elapsed() {
            const scale = this.timingScale > 0 ? this.timingScale : 1;
            return (this.now() - (this.startedAt || this.now())) / scale;
        }

        /**
         * Decide what the evening wants next, then arm for the next look.
         *
         * Deliberately catch-up rather than replay-in-order-with-delays: coming back to a tab
         * after four minutes should land you at the right point in the session, not walk you
         * through four minutes of backlog. Beats are marked done before running so a throw in
         * one cannot make it fire twice on the next tick.
         *
         * Three gates, in the order they matter (P12):
         *
         *   1. **Eligible** (P8) — nobody is mid-turn. Applies to every beat including the
         *      ending, because talking over a reply is never right.
         *   2. **Stale** — a guided line that has been waiting a long time *while the person was
         *      talking* is dropped instead of delivered late. "What kind of mood should we keep?"
         *      is a good question at forty-five seconds and an odd one at four minutes into a
         *      conversation that has been answering it implicitly.
         *   3. **Quiet** — an unprompted line waits for a real pause. A conversation that is
         *      flowing does not need the script; the script is for the evening that has gone
         *      quiet and does not know what to do next.
         *
         * At most one guided line per tick, so a session that was away for four minutes does not
         * come back to the whole backlog at once.
         */
        _tick() {
            if (this._stopped || this.state === 'complete') return;
            // A person mid-sentence, or a reply mid-stream, outranks the clock. Come back in a
            // second rather than talking over either of them. This used to be
            // `now() < _conversationBusyUntil` — an eight-second guess at how long an answer
            // takes. See `_conversationHasFloor` for what replaced it and why.
            if (!this._beatIsEligible()) return this._armBeats(1000);
            const elapsed = this._elapsed();
            let spoke = false;
            for (const beat of this._beats) {
                if (beat.done || beat.at > elapsed) continue;
                if (beat.dueAt == null) {
                    beat.dueAt = this.now();
                    beat.dueTurns = this._turns;
                }
                // One line per tick, so a tab that was hidden for four minutes comes back to a
                // sentence rather than the whole backlog at once.
                if (spoke) continue;
                const waited = this.now() - beat.dueAt;
                const talkedSince = this._turns - (beat.dueTurns || 0);
                if (beat.stale && talkedSince > 0 && waited >= GUIDANCE.staleAfterMs * (this.timingScale || 1)) {
                    // The conversation did this beat's job. Dropping it is the whole point:
                    // delivering it now would be a script arriving after the scene it was written
                    // for.
                    beat.done = true;
                    continue;
                }
                if (!this._quietEnough()) continue;
                beat.done = true;
                spoke = true;
                try {
                    beat.run();
                } catch (error) {
                    // One beat that throws must not take the rest of the evening with it.
                    console.warn('[Private] a beat failed', error);
                }
                if (this._stopped || this.state === 'complete') return;
            }
            // The silence clock, last, and only on a tick the script had nothing for (P17). The
            // authored beats are the better line when one is due — a noticing line is generic where
            // "what kind of mood should we keep?" is the evening's one real branch — and a beat
            // that fired has already reset this clock through `_showMessage`, so the minute of
            // quiet is measured from her most recent line either way. Its own busy predicate, not
            // the beats': "nobody is mid-turn" and "nothing has happened for a minute" are
            // different questions, and the beats only ever needed the first.
            if (!spoke) this._tickIdle();
            this._armBeats();
        }

        /**
         * One timer for the next beat, plus a wake-up when the tab comes back.
         *
         * `visibilitychange` is the half that makes the catch-up actually happen: a throttled
         * timer may be minutes late, but the event fires the moment somebody returns.
         */
        _armBeats(inMs) {
            if (this._stopped || this.state === 'complete') return null;
            if (!this._unwatchVisibility && this.doc && typeof this.doc.addEventListener === 'function') {
                const onVisible = () => {
                    if (!this.doc.hidden) this._tick();
                };
                this.doc.addEventListener('visibilitychange', onVisible);
                this._unwatchVisibility = () => this.doc.removeEventListener('visibilitychange', onVisible);
            }
            if (Number.isFinite(inMs)) return this._schedule(inMs, () => this._tick());
            const waits = [];
            const pending = this._beats.filter((beat) => !beat.done);
            const elapsed = this._elapsed();
            const next = pending.length ? Math.min(...pending.map((beat) => beat.at)) : 0;
            // Never longer than a minute: that is roughly the resolution a background tab
            // gets anyway, and it keeps a stalled session self-healing without a visibility
            // event at all.
            //
            // The floor of a second matters more than it looks (P12). A beat can now be due and
            // still waiting — for a quiet moment — and `next - elapsed` is then negative, so
            // without the floor this armed a zero-delay timer that ticked, deferred, and armed
            // another one: a busy loop for as long as somebody kept talking.
            if (pending.length) waits.push(Math.max(1000, Math.min(next - elapsed, 60000)));
            // And the silence clock, which outlives the beats (P17). This used to return null the
            // moment the last beat was done, and with the idle stages hanging off the same tick
            // that would stop the clock a few minutes into every session — exactly when somebody
            // going quiet starts to matter.
            const idleIn = this._idleNextIn();
            if (idleIn != null) waits.push(Math.max(1000, Math.min(idleIn, 60000)));
            if (!waits.length) return null;
            return this._schedule(Math.min(...waits), () => this._tick());
        }

        _mount() {
            if (!this.doc || !PrivateViewApi || !PrivateViewApi.View) return;
            const view = new PrivateViewApi.View({
                doc: this.doc,
                win: this.win,
                onCloser: () => this._advanceIntensity(),
                onEase: () => this._easeUp(),
                // `End` is the only thing that finishes a Private session (P12). The completion card
                // is not a timer's verdict on how long five minutes is; it is what the person gets
                // when they decide they are done, and it is where the promise about nothing being
                // kept is made.
                onEnd: () => this._complete('user'),
                onUserMessage: () => this._userIsTalking(),
            });
            // `currentSceneName`, not `currentSceneLabel`: the header slot is a label, and an
            // unnamed scene leaves it empty rather than printing the sentence fragment.
            if (!view.mount({ preset: this.preset, scene: currentSceneName(this.win) })) return;
            this.view = view;
            // No opening notice (P14). The card used to greet with "Starting gently. You remain in
            // control of the pace." under a `HER` label — a system notice in her voice, and the
            // first thing anybody read. The opening beat is a real line and lands a moment later;
            // this was the app clearing its throat over the top of it.
            this._paintLevel();
        }

        /**
         * The whole footer, from the state, in one place.
         *
         * Every path that can move the level or the energy ends here — the two controls, the typed
         * requests, an `adult:level` event from anywhere, a decay — so the ladder and the set of
         * buttons cannot disagree with the experience. A control enabled in a state it cannot act in
         * is what produced six identical lines, and the fix for that class of bug is one renderer
         * fed one description rather than several callers each remembering to update a button.
         *
         * Nothing here is on a timer of its own. It only ever draws what the state already is.
         */
        _paintLevel() {
            if (!this.view) return;
            const pace = paceModel();
            const level = this._level();
            const shown = pace
                ? pace.describe({ level, energy: this.energy, maxLevel: this.preset.maxLevel })
                : { pace: level === 1 ? 'Warm' : level === 2 ? 'Romantic' : 'Sensual' };
            this.view.setPace(shown);
        }

        /**
         * One line, and always something to say back to it (P23).
         *
         * The second half is the correction. `_offerChoices` used to run in exactly two places —
         * the opening, and `_onAssistantFinished` — so every *scripted* line left the card with
         * nothing to tap:
         *
         * ```text
         *   HER  That depends entirely on you. …
         *        [Go on.] [That is a good answer.] [stay quiet]   ← the model reply's choices
         *   HER  What kind of mood should we keep?    [Playful] [Tender]
         *   HER  I'll let it warm up. …                ← nothing
         *   HER  A spark. …                            ← nothing
         *   HER  Quieter and nearer. …                 ← nothing
         *   HER  You've gone quiet. I don't mind it.   ← nothing
         * ```
         *
         * Four of her lines in a row with no way to answer but the keyboard, in a feature whose
         * whole premise is that the next turn costs a tap. A dialogue wheel that empties whenever
         * the character speaks on their own is not a dialogue wheel.
         *
         * So the seam is here, where *every* line she says passes through, rather than at the two
         * places that happened to think of it. A turn that carries its own buttons — the mood
         * question, the texture question — is left alone: those are a question with two answers,
         * and putting a second set underneath would be two questions at once.
         */
        _showMessage(text, actions, options) {
            // Her own lines count as something happening (P17). Without this the 45-second mood
            // beat and a 60-second nudge would arrive fifteen seconds apart, which reads as
            // somebody who cannot leave a pause alone.
            this._noteLive();
            if (this.view) this.view.showMessage(text, actions, options);
            if (!actions || !actions.length) this._offerChoices([], { source: 'local' });
        }

        /**
         * Ask for a movement, the way every other Together activity does.
         *
         * `bus.emit('intent', …)` is the seam — `boot.js` forwards it to
         * `director.handleIntent`, and Assistant, Coach, Focus, Music, Cohost, Scene Journey
         * and Screen Insight all use it. Private was the only activity that never emitted
         * anything at all, which is the whole of why the avatar stands still through a session
         * and the card reads as unresponsive.
         *
         * The names here are deliberately ordinary — `breathe`, `nod_along` — and never the
         * adult ceiling's `flirt`/`tease`/`sensualSway`. Those map to nsfw-tagged clips, and
         * `UtilityRanker` refuses an nsfw clip whose intent did not come from the user while
         * `proactiveNsfw: false` says she may never initiate one. So this asks for presence,
         * not performance, and an install whose registry has no clip for the name simply
         * plays nothing — the same fail-soft every other caller gets.
         */
        _intent(name, intensity = 0.3) {
            if (!this.bus || typeof this.bus.emit !== 'function' || this._stopped) return false;
            try {
                this.bus.emit('intent', { name, intensity, source: 'private' });
                return true;
            } catch (_) {
                // A movement that will not play is never a reason to lose the line it went with.
                return false;
            }
        }

        /**
         * Do what the reply asked for, instead of printing that it asked (P14).
         *
         * One presence per reply, not all of them: a model that writes three directions in four
         * sentences is describing a performance, and firing three intents in the same tick would
         * make her twitch rather than move. The first is the one that belongs to the opening of
         * the line, which is where a reader's attention is.
         */
        _embody(names) {
            const first = Array.isArray(names) ? names.find(Boolean) : null;
            if (!first) return false;
            return this._intent(first, 0.3);
        }

        /**
         * The one branch in the session, now with something downstream of it.
         *
         * `this.mood` is read by `_moodLine` for the 210 s and 285 s beats and by
         * `privateSystemPromptSuffix`, so choosing Playful changes the rest of the evening in
         * both channels instead of buying one sentence.
         */
        /**
         * May this interaction run, and is this line new? (P11)
         *
         * Every guided interaction goes through the ledger, not just the one that was reported
         * repeating itself. A `false` here is a beat that quietly does not happen, which is the
         * right outcome: a script with nothing new to offer should be silent rather than clever.
         */
        _mayOffer(family, line) {
            const api = noveltyModel();
            if (!api || !this.novelty) return true;
            return api.canUse(this.novelty, family, { line: line || '' }).ok;
        }

        _recordOffer(family, line) {
            // She has just asked something, which is the clearest possible "something happened"
            // (P17). `_showMoodChoice` draws through `view.showMoodChoice` rather than
            // `_showMessage`, so without this the one offer that does not pass the usual seam left
            // the silence clock running — and stage 1 would withdraw a question ten seconds after
            // she asked it, which reads as her changing her mind about her own sentence.
            this._noteLive();
            const api = noveltyModel();
            if (!api || !this.novelty) return false;
            return api.use(this.novelty, family, { line: line || '' });
        }

        _showMoodChoice() {
            if (this.state !== 'active') return;
            const prompt = this._line('moodPrompt');
            if (!this._mayOffer('mood-choice', prompt)) return;
            // A person who has asked for quiet is not asking to be handed a menu. The mood is
            // inferred from how they talk from here on instead; see `privateLengthLines`.
            if (this.style === 'quiet' && this._styleLocked) return;
            const choose = (mood) => {
                this.mood = mood;
                this._answeredOffer();
                this._speak(this.plan && this.plan.moods ? this.plan.moods[mood] : this.preset[mood]);
                this._emit('private:mood', { preset: this.preset.id, mood });
            };
            const options = [
                { id: 'playful', label: t('mood.playful'), run: () => choose('playful') },
                { id: 'tender', label: t('mood.tender'), run: () => choose('tender') },
            ];
            this._recordOffer('mood-choice', prompt);
            if (this.view) this.view.showMoodChoice(options, prompt);
        }

        /** A question she asked has been answered, so the next one is allowed. */
        _answeredOffer() {
            this._noteLive();
            const api = noveltyModel();
            if (api && this.novelty) api.noteAnswered(this.novelty);
            this._pendingQuestion = false;
            return true;
        }

        /**
         * A preset already at its ceiling gets a choice about texture, not an apology.
         *
         * `Affectionate` has `maxLevel: 1`, so this branch was its 120-second beat: a single
         * line saying that nothing further was going to happen, with no buttons. The gentlest
         * preset is the one most people try first, so the emptiest run in the feature was also
         * its first impression. Quieter-or-closer is a real choice that changes how she talks
         * without touching the ceiling, which is the whole point — it is texture, not
         * escalation, and it needs no consent step because it grants nothing.
         */
        _offerTextureChoice() {
            const texture = (this.plan && this.plan.texture) || null;
            if (!texture || !texture.prompt) {
                // No fallback sentence any more. "This pace feels good. We can keep it right here."
                // is the same species as the six repeated lines: a beat with nothing to offer saying
                // so out loud. A beat with nothing to offer should be silent.
                return;
            }
            if (!this._mayOffer('texture-choice', texture.prompt)) return;
            // `Closer` is an increase in texture, and offering it to somebody who just asked for
            // less is the interface arguing with them.
            if (this.style === 'quiet' && this._styleLocked) return;
            const choose = (id) => {
                this.texture = id;
                this._answeredOffer();
                this._speak(texture[id]);
                this._emit('private:texture', { preset: this.preset.id, texture: id });
            };
            this._recordOffer('texture-choice', texture.prompt);
            // `texture-` prefixed, because `closer` is now the footer's forward control (P12) and
            // two elements carrying one action id is a `querySelector` finding the wrong button.
            // They never appear together — the texture choice only runs at the ceiling, where there
            // is no forward control — and relying on that would be relying on a coincidence.
            this._showMessage(texture.prompt, [
                { id: 'texture-quieter', label: t('texture.quieter'), run: () => choose('quieter') },
                { id: 'texture-closer', label: t('texture.closer'), run: () => choose('closer') },
            ]);
        }

        // `_offerCheckIn` and `_acceptCheckIn` are gone (P12).
        //
        // They were the forward mechanism, and the whole of the correction is that a mechanism
        // reachable only through a scripted question on a two-minute timer is not a control. The
        // footer's `Closer →` goes through `ConsentFlow.initiated` instead — §16.4's user-initiation
        // route — so progression is something the person does rather than something they are
        // occasionally offered.
        //
        // Deleted rather than left unreachable. A `checkin-pending` state nothing can enter, and a
        // `Keep it sweet` button nothing can draw, read as live code to the next person here.

        async _startSoundtrack() {
            if (!this.win || this._stopped) return false;
            if (this.soundtrack === 'none' || this.soundtrack === 'current') return false;
            const media = this.win.NEXUS_MEDIA_SESSION;
            try {
                const existing = media && typeof media.get === 'function' ? media.get() : null;
                if (existing && ['playing', 'loading', 'paused'].includes(existing.status) && existing.current)
                    return false;
            } catch (_) {}
            // Prepared, normally. Searching here was what made the soundtrack arrive some
            // seconds into an evening that had already started talking.
            let track = this.track;
            if (!track) {
                const registry = this.win.NEXUS_DISCOVERY;
                if (!registry || typeof registry.forCapability !== 'function') return false;
                try {
                    if (typeof registry.warm === 'function') await registry.warm();
                    const provider = registry.forCapability('music.search');
                    if (!provider || typeof provider.search !== 'function') return false;
                    const found = await provider.search(this.preset.music, { max: 3, kind: 'music' });
                    if (this._stopped || !Array.isArray(found) || !found.length) return false;
                    track = found[0];
                } catch (_) {
                    return false;
                }
            }
            try {
                if (media && typeof media.requestPlay === 'function') media.requestPlay(track, { source: 'private' });
                if (this.view) this.view.attachSoundtrack(track);
                this._ownsMedia = true;
                return true;
            } catch (_) {
                return false;
            }
        }

        /**
         * Put the evening where it asked to be, and remember where it was.
         *
         * Private had no connection to the scene system at all. `adult.profile` declares
         * `scenes: ['sunset', 'candlelit']` and **nothing in the repository reads that field**
         * — the setup screen showed the current place as a read-only label and the session
         * never touched the background. So "a more personal moment" happened in whatever room
         * happened to be up, including the default black.
         *
         * Snapshot and restore rather than a bespoke undo, per the house rule: whatever was
         * showing is stashed verbatim and written back on exit, so a scene chosen for one
         * evening never leaks into the rest of the app.
         */
        _enterScene() {
            if (!this.scene || !this.win) return false;
            const controller = this.win.NEXUS_SCENE_AMBIENCE_CONTROLLER;
            if (!controller || typeof controller.apply !== 'function') return false;
            try {
                if (typeof controller.currentScene === 'function') this._sceneBefore = controller.currentScene();
                const result = controller.apply(this.scene, { source: 'private' });
                return Boolean(result && result.changed);
            } catch (_) {
                // A room that will not change is not a session that cannot happen.
                return false;
            }
        }

        _restoreScene() {
            if (this._sceneBefore === null || !this.win) return false;
            const previous = this._sceneBefore;
            this._sceneBefore = null;
            const controller = this.win.NEXUS_SCENE_AMBIENCE_CONTROLLER;
            if (!controller || typeof controller.apply !== 'function') return false;
            try {
                controller.apply(previous, { source: 'private' });
                return true;
            } catch (_) {
                return false;
            }
        }

        _stopSoundtrack() {
            if (!this._ownsMedia || !this.win) return;
            try {
                const media = this.win.NEXUS_MEDIA_SESSION;
                if (media && typeof media.stop === 'function') media.stop('private');
            } catch (_) {}
            this._ownsMedia = false;
        }

        /**
         * Put a line where the model can see it.
         *
         * `NEXUS_BD_SAY` is `(text) => speakText(text)` in `src/main.js` — text-to-speech and
         * nothing else. So every scripted Private line was spoken aloud and drawn in the card
         * while never entering `chatHistory`, which is the transcript the model reads. She
         * said four things the model answering the user had no record of, and could therefore
         * contradict in the very next chat bubble. Two channels in one card, neither aware of
         * the other.
         *
         * Recorded rather than said: `NEXUS_YT_ASK.say` would also *draw* a chat bubble, and the
         * Private card is already the display. This records without rendering, which is exactly
         * the half that was missing.
         *
         * Through the conversation surface's store as of P10, not `window.chatHistory` directly.
         * That is the whole difference between the model remembering her scripted lines and
         * `localStorage` remembering them: the Private store is an array on the view that is
         * dropped with the card, so the model has the context and nothing reaches disk.
         */
        _remember(text) {
            const api = surfaceApi(this.win);
            if (!api || typeof api.history !== 'function') return false;
            try {
                const store = api.history();
                if (!store || typeof store.addMessage !== 'function') return false;
                store.addMessage('assistant', String(text || ''));
                return true;
            } catch (_) {
                // A line on screen and in the air is worth more than a tidy transcript.
                return false;
            }
        }

        _speak(text, { interjection = false, intent = 'nod_along' } = {}) {
            const line = cleanText(text, 700);
            if (!line) return;
            // The backstop for the whole class of defect P11 is about (P11).
            //
            // `_slowDown` and the ledger stop the paths that were *known* to repeat. This catches
            // the ones nobody has thought of yet: a scripted line that has already been said this
            // session is not said again, whatever route reached it. Six identical turns cannot
            // happen even if some future beat tries.
            //
            // Scripted lines only. A model's reply never comes through here — it is drawn by the
            // conversation surface — so this cannot silence her answering "yes" twice in an evening.
            const novelty = noveltyModel();
            if (novelty && this.novelty) {
                if (novelty.saidAlready(this.novelty, line)) return;
                novelty.noteLine(this.novelty, line);
            }
            this._showMessage(line, [], { interjection });
            this._remember(line);
            // Something to look at while she talks. Gentle and non-adult by design — see
            // `_intent` for why the ceiling's own intents are not used here.
            if (intent) this._intent(intent, 0.3);
            if (this.audioFocus && typeof this.audioFocus.duck === 'function') this.audioFocus.duck();
            try {
                if (typeof this.say === 'function') {
                    const result = this.say(line);
                    if (result && typeof result.then === 'function') {
                        result.finally(() => {
                            if (this.audioFocus && typeof this.audioFocus.restore === 'function')
                                this.audioFocus.restore();
                        });
                        return;
                    }
                }
            } catch (_) {}
            if (this.audioFocus && typeof this.audioFocus.restore === 'function') this.audioFocus.restore();
        }

        /**
         * The person is composing. Presentation only — no counting, no classification.
         *
         * Called from the composer's `keydown`/click, which is the earliest possible moment and
         * fires even for a keystroke that never becomes a message, and again from `_onUserTurn`
         * for a send that did not come from the composer at all (voice, a programmatic send).
         * Whose turn it is is *not* set here: `ConversationSurface` owns that, and a keystroke
         * that never became a message must not be able to take the floor.
         */
        _userIsTalking() {
            this._composingAt = this.now();
            this._noteLive();
            // Something moving while the provider works. The reported session sat through
            // `OllaBridge returned 504; retrying` with a completely static card, which is
            // indistinguishable from a crash. The view hides these again when a reply lands
            // in the transcript; this is only the safety valve for a reply that never does.
            if (this.view && typeof this.view.showThinking === 'function') {
                this.view.showThinking();
                if (this._thinkingTimer && this.win && typeof this.win.clearTimeout === 'function') {
                    this.win.clearTimeout(this._thinkingTimer);
                }
                // `_delay`, not `_schedule`: the valve on the dots must fire *because* the
                // conversation is stuck mid-turn, and `_schedule` now defers exactly then. Put
                // this on the beat scheduler and the one timer whose job is to admit that
                // nothing is coming would wait for something to come.
                this._thinkingTimer = this._delay(THINKING_TIMEOUT_MS, () => {
                    this._thinkingTimer = null;
                    if (this.view && typeof this.view.hideThinking === 'function') this.view.hideThinking();
                });
            }
            try {
                if (this.win && this.win.speechSynthesis && typeof this.win.speechSynthesis.cancel === 'function')
                    this.win.speechSynthesis.cancel();
            } catch (_) {}
            if (this.audioFocus && typeof this.audioFocus.restore === 'function') this.audioFocus.restore();
        }

        /**
         * The session is over, because the person said so (P12).
         *
         * There is no other caller. Private used to complete on a 300-second timer, with a bounded
         * grace so it would not hang up on somebody mid-sentence — which was the right patch for the
         * wrong shape. Warm → Romantic → Sensual is not an arc toward completion; it is a place the
         * person drives to and then stays. So the clock no longer has an opinion about when an
         * evening is finished, and `GRACE_MS` is gone with the timer that needed it.
         *
         * The completion card stays, because it is where the promise is made: nothing from this
         * moment was kept. That promise belongs to a deliberate exit rather than to a stopwatch.
         */
        _complete(why = 'user') {
            if (this._stopped || this.state === 'complete') return;
            this.state = 'complete';
            this._clearTimers();
            // Only on a completed session, and only the four enums — never a word of what was
            // said. See `PrivateMemory`.
            const store = memory();
            try {
                if (store && typeof store.remember === 'function') {
                    store.remember({
                        preset: this.preset.id,
                        mood: this.mood,
                        soundtrack: this.soundtrack,
                        scene: this.scene,
                    });
                }
            } catch (_) {
                // Not being remembered is exactly how every session behaved before.
            }
            if (this.view) {
                this.view.showComplete({
                    onAgain: () => this._requestEnd(true),
                    onBack: () => this._requestEnd(true),
                });
            }
            this._emit('private:session-complete', {
                preset: this.preset.id,
                mood: this.mood,
                turns: this._turns,
                why,
            });
        }

        _requestEnd(openTogether) {
            const panel = this.director && this.director.togetherPanel;
            if (
                panel &&
                (panel.active === 'intimate' || panel.activeActivity === 'intimate') &&
                typeof panel.stopActivity === 'function'
            ) {
                panel.stopActivity('private complete');
                if (openTogether && typeof panel.open === 'function') panel.open();
                return;
            }
            if (this.activity && typeof this.activity.stop === 'function') this.activity.stop('private complete');
        }

        _unmount() {
            if (this.view) this.view.destroy();
            this.view = null;
        }

        /**
         * Tell the bus, and never let the bus stop the session.
         *
         * This was unguarded, and `beforeActivityStop` emits — so a bus that threw took
         * teardown down with it, leaving the adult mode entered, the ceiling installed and the
         * blackboard unrestored. A telemetry line is not worth a session that cannot be
         * stopped, and exit is exactly where fail-soft matters most.
         */
        _emit(name, payload) {
            if (!this.bus || typeof this.bus.emit !== 'function') return;
            try {
                this.bus.emit(name, payload);
            } catch (_) {
                // Nobody heard it. Everything else still happens.
            }
        }
    }

    function installPrivateRuntime(playgroundApi) {
        const api = playgroundApi || (global && global.NEXUS_BD_PLAYGROUND);
        const Intimate = api && api.IntimateActivity && api.IntimateActivity.Intimate;
        if (!Intimate || !Intimate.prototype) return false;
        const proto = Intimate.prototype;
        if (proto.__privateExperienceInstalled) return true;

        const originalStart = proto.start;
        const originalStop = proto.stop;
        const originalStatus = proto.status;
        if (typeof originalStart !== 'function' || typeof originalStop !== 'function') return false;

        proto.start = async function (context) {
            const input = (context && context.input) || {};
            const presetId = String(input.id || 'affectionate');
            const director = global && global.NEXUS_BD;
            const session = new IntimateExperienceSession({
                activity: this,
                preset: presetId,
                soundtrack: input.soundtrack,
                // Whatever the setup screen prepared. Absent on a caller that skipped it, and
                // the session falls back to doing the work itself.
                plan: input.preparedPlan || this.preparedPlan || null,
                track: input.preparedTrack || this.preparedTrack || null,
                scene: input.scene || this.sceneChoice || null,
                adult: this.adult || (director && director.adult),
                director,
                win: global,
                bus: this.bus || (director && director.bus),
            });
            const result = await originalStart.call(this, context || {});
            if (!result || result.ok === false) return result;
            const started = session.start();
            if (!started || started.ok === false) {
                originalStop.call(this, 'private runtime failed');
                return started || { ok: false, why: 'Private experience could not start' };
            }
            this._privateExperience = session;
            return { ...result, experience: 'private-evening', runtimeVersion: PRIVATE_RUNTIME_VERSION };
        };

        proto.stop = function (why) {
            const session = this._privateExperience || null;
            if (session) session.beforeActivityStop(why || 'user');
            const result = originalStop.call(this, why || 'user');
            if (session) {
                session.afterActivityStop(why || 'user');
                this._privateExperience = null;
            }
            return result;
        };

        proto.status = function () {
            const base = typeof originalStatus === 'function' ? originalStatus.call(this) : null;
            if (!base) return null;
            const session = this._privateExperience;
            return session ? { ...base, detail: session.statusDetail() } : base;
        };

        Object.defineProperty(proto, '__privateExperienceInstalled', { configurable: true, value: true });
        return true;
    }

    function schedulePrivateRuntimeInstall() {
        if (!global || !global.document || !global.document.currentScript || typeof global.setTimeout !== 'function')
            return;
        let attempts = 0;
        const tryInstall = () => {
            if (installPrivateRuntime()) return;
            attempts += 1;
            if (attempts < 100) global.setTimeout(tryInstall, 50);
        };
        global.setTimeout(tryInstall, 0);
    }

    const api = {
        OPEN,
        CLOSE,
        INSTRUCTION,
        attentionLines,
        stripEmoji,
        privateSessionActive,
        privateChangeAllowed,
        noteUserTurn,
        asksForChange,
        resetChangeWindow,
        CHANGE_WINDOW_MS,
        PRIVATE_PRESETS,
        PRIVATE_RUNTIME_VERSION,
        IntimateExperienceSession,
        canSearch,
        privateSystemPromptSuffix,
        installPrivateRuntime,
        systemPromptSuffix,
        responseBudget,
        /** Exported so a test reads the real number rather than keeping a second copy of it. */
        CHOICE_TOKENS,
        experienceOverlay,
        sanitizeReply,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TOGETHER_CAPABILITY = api;
    schedulePrivateRuntimeInstall();
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
