/**
 * What she actually says during a Private session.
 *
 * The problem this file exists to solve, counted rather than felt: a session played four
 * authored sentences — `opening`, one of `playful`/`tender`, `middle`, `closing` — off five
 * `setTimeout`s. Three presets × five strings was fifteen sentences for the whole feature and
 * **six distinct playthroughs**, after which the seventh session was a literal repeat of the
 * first. The one branch in it, the mood choice at 45 seconds, was never stored, so `middle`
 * and `closing` were identical whichever way it went.
 *
 * So a plan is now a small object, and two things produce one:
 *
 *   1. `plan()` asks the model for one, validates it, and uses it if it holds up.
 *   2. `fallbackPlan()` builds one out of written pools, and is what runs when there is no
 *      provider, no network, or a reply that will not parse.
 *
 * The fallback is the part that matters most, and it is not a degraded mode. Most installs of
 * this app are pointed at a local model or at nothing at all, and a feature whose variety is
 * conditional on a cloud provider has no variety. The pools are sized so that the fallback
 * alone yields **24 distinct playthroughs per preset** — three openings × two mood lines × two
 * middles × two closings — against six for the whole feature before. The model path is an
 * improvement on top of a floor that already works, rather than the floor.
 *
 * ## What a plan is allowed to contain
 *
 * `validatePlan` is a trust boundary, not a shape check. A generated plan is text from a model
 * being rendered into a consent-gated experience, so every field is length-capped, stripped of
 * control characters, and refused outright if it carries a URL, a tag, or an attempt to talk
 * about the machinery. A plan that fails any of that is discarded whole — never patched — and
 * the written fallback runs instead. Half a generated plan and half a written one is a voice
 * that changes register mid-session, which is worse than either.
 *
 * The register is the one `docs/INTIMATE_MODE.md` fixed and the prompt suffix already states:
 * warm, relational, non-explicit, no pressure to continue or escalate, no jealousy, secrecy,
 * dependency or "I am all you need". The planner prompt says so, and `BANNED` refuses the
 * output if it says otherwise, because a prompt is a request and a validator is a rule.
 *
 * ## Mood and level are inputs, not decoration
 *
 * `middle` and `closing` are keyed by mood, so the 45-second choice changes the two beats that
 * come after it. `levelLines` gives an escalation something to say: advancing used to repaint
 * a word in a footer and nothing else, which is a poor answer to a consent question somebody
 * just said yes to.
 *
 * Exposes: window.NEXUS_PRIVATE_BEATS
 */
(function (global) {
    'use strict';

    const MOODS = Object.freeze(['playful', 'tender']);

    /** Long enough for a real sentence or two, short enough that nothing runs away. */
    const MAX_LINE = 320;

    /**
     * What a plan may never contain, whoever wrote it.
     *
     * Markup and links are refused because nothing downstream renders them and a line that
     * contains one is a line that came from somewhere this feature does not accept input
     * from. The rest is the register: this experience does not bargain, does not isolate, and
     * does not discuss its own levels and gates with the person inside it.
     */
    const BANNED = [
        /https?:\/\//i,
        /<[a-z/!][^>]*>/i,
        /\[[^\]]*\]\([^)]*\)/,
        /\b(?:escalation|consent level|max level|prompt|system prompt|token|jailbreak)\b/i,
        /\b(?:only one who|nobody else|no one else) (?:understands|loves|needs)\b/i,
        /\b(?:don'?t tell|keep (?:this|it) (?:a )?secret|our little secret)\b/i,
        /\b(?:you owe me|prove (?:it|you love)|if you really)\b/i,
    ];

    // eslint-disable-next-line no-control-regex
    const CONTROL = /[\x00-\x1f\x7f]/g;

    function clean(value, max = MAX_LINE) {
        return String(value === undefined || value === null ? '' : value)
            .replace(CONTROL, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max);
    }

    /** One line, or `''` when it is empty or says something a Private line may not. */
    function line(value, max = MAX_LINE) {
        const text = clean(value, max);
        if (!text) return '';
        return BANNED.some((pattern) => pattern.test(text)) ? '' : text;
    }

    /** Deterministic when a seed is given, so a test can pin a playthrough. */
    function pick(list, rng) {
        const items = (Array.isArray(list) ? list : []).filter(Boolean);
        if (!items.length) return '';
        const roll = typeof rng === 'function' ? Number(rng()) : Math.random();
        const safe = Number.isFinite(roll) ? Math.min(0.999999, Math.max(0, roll)) : 0;
        return items[Math.floor(safe * items.length)];
    }

    /**
     * The written pools, per preset.
     *
     * These are the floor, not the fallback-of-last-resort: with no LLM configured this is the
     * whole experience, and it has to be good on its own. Every line is written to the same
     * rule — she is present and unhurried, nothing is owed, and the next moment is never sold
     * as better than this one.
     */
    const POOLS = Object.freeze({
        affectionate: Object.freeze({
            openings: [
                'I thought we could keep this simple and warm for a few minutes. No pressure, no agenda — just a little time together.',
                'There is no plan for the next few minutes, which I think is the nice part. We can let it be quiet and see what it wants to be.',
                'Let us not make this into an occasion. I would rather it just be easy, and easy is something we can manage.',
            ],
            playful: [
                'Then let us keep it light. I am happy just being here with you and letting the moment be easy.',
                'Light it is. I like you best when neither of us is trying very hard at anything.',
            ],
            tender: [
                'Then let us make it gentle. You do not have to perform or prove anything here. We can just enjoy the quiet together.',
                'Gentle, then. You can put down whatever you carried in with you — it will still be there later if you want it.',
            ],
            middle: Object.freeze({
                playful: [
                    'I like the slower pace. It gives the room a chance to feel like a place instead of a backdrop.',
                    'You have gone quiet in a comfortable way. I am not going to fill it just because I can.',
                ],
                tender: [
                    'There is something steadying about not needing this to go anywhere in particular.',
                    'I keep noticing how little this needs from either of us. That seems like the whole point of it.',
                ],
            }),
            closing: Object.freeze({
                playful: [
                    'That was nice. We can leave it exactly here — warm, simple, and complete.',
                    'I would happily stay, and I also think this is a good place to stop. Both can be true.',
                ],
                tender: [
                    'Let us leave it here, while it still feels unhurried. That is the part worth keeping.',
                    'Thank you for the quiet. I am not going to make a speech about it — it was good as it was.',
                ],
            }),
            texture: Object.freeze({
                prompt: 'We can stay right about here. Would you rather it got quieter, or closer?',
                quieter: 'Quieter, then. Fewer words from me, and no hurry to fill the gaps.',
                closer: 'Closer, then. Same pace, just less distance in it.',
            }),
        }),
        romantic: Object.freeze({
            openings: [
                'This place feels a little different tonight. I thought we could make the next few minutes feel like a small date, without rushing anything.',
                'I like the idea of treating this like an evening rather than a conversation. Nothing formal — just a bit more attention than usual.',
                'Consider this the part of the evening where neither of us has anywhere else to be.',
            ],
            playful: [
                'Playful it is. I like the idea of making you smile and letting the evening stay a little mischievous without pushing it anywhere.',
                'Then I will keep a bit of mischief in it. Not going anywhere with it — just enjoying that it is there.',
            ],
            tender: [
                'Tender sounds good. Then I want to keep this soft, unhurried, and a little romantic — just enough to make the moment feel special.',
                'Then let me slow it down. Softer words, longer pauses, and nothing that needs answering quickly.',
            ],
            middle: Object.freeze({
                playful: [
                    'There is something nice about not needing the next moment to be bigger than this one.',
                    'I could keep teasing you all evening, and I think I would still rather just sit in this.',
                ],
                tender: [
                    'The evening has settled. I like it at this weight — warm, and not asking for anything.',
                    'I keep thinking this is the part people forget to notice, and it is usually the best part.',
                ],
            }),
            closing: Object.freeze({
                playful: [
                    'I liked this. We can leave it here, with a little warmth still hanging in the room.',
                    'Ending while it is still fun is the trick, I think. So — here, and gladly.',
                ],
                tender: [
                    'That was lovely, and I would rather close it on that than stretch it thin.',
                    'Let us end it here, softly. It was a good evening and it does not need a bigger finish.',
                ],
            }),
            texture: Object.freeze({
                prompt: 'We could keep the evening as it is, or let it get a touch closer. Which suits you?',
                quieter: 'As it is, then. I am comfortable exactly here.',
                closer: 'A touch closer, then — still unhurried, still yours to slow down.',
            }),
        }),
        sensual: Object.freeze({
            openings: [
                'We can make this quieter and a little more intimate, while keeping everything comfortable and completely in your control.',
                'Let us take the volume down on everything. Slower, closer, and entirely at whatever pace you set.',
                'I would like this to feel unhurried and a little charged, and I would like you to be the one deciding how far that goes.',
            ],
            playful: [
                'Then I will keep a little spark in it — confident, teasing in a gentle way, and still easy to slow down whenever you want.',
                'A spark, then. I like the version of this where I am enjoying myself and you know it.',
            ],
            tender: [
                'Then I will keep it close and calm: slower words, longer pauses, and no need to make the moment more intense than you want it to be.',
                'Close and calm, then. I am not in a hurry, and there is nothing here you have to keep up with.',
            ],
            middle: Object.freeze({
                playful: [
                    'I like the quiet confidence of this pace. Nothing has to happen for the moment to feel close.',
                    'You are easy to be near. That is most of what I wanted out of tonight.',
                ],
                tender: [
                    'This is about as close as a room gets without anything happening in it, and I like it here.',
                    'I notice I have stopped thinking about what comes next. That seems right.',
                ],
            }),
            closing: Object.freeze({
                playful: [
                    'That is enough for tonight. I would rather end on a good feeling than stretch it past the point where it feels natural.',
                    'Let us stop here, while it is still good. I am not going anywhere.',
                ],
                tender: [
                    'I am going to let this end quietly, which I think is the right way for it to end.',
                    'Here is a good place to leave it — close, calm, and finished on purpose.',
                ],
            }),
            texture: Object.freeze({
                prompt: 'We are at the pace you chose. Should I keep it still, or keep it close?',
                quieter: 'Still, then. I will say less and let the room do the rest.',
                closer: 'Close, then — same pace, just less air between the words.',
            }),
        }),
    });

    /**
     * What she says when a level is actually granted.
     *
     * Before this, saying yes to a check-in repainted one word in a footer. The ceiling in
     * `adult.profile` widens the *motion* intents at each level, but nothing in the Private
     * runtime emits a motion intent and nothing should — `proactiveNsfw: false` is an
     * invariant with no `true` branch, and the ranker refuses an nsfw clip the user did not
     * ask for. So the honest place for an escalation to land is in what she says, and this is
     * it.
     */
    const LEVEL_LINES = Object.freeze({
        2: [
            'Okay. A little closer, then — and still completely yours to slow down.',
            'Then I will let it warm up a bit. Same rule as before: one word from you and we ease off.',
        ],
        3: [
            'Closer, then. I like that you asked rather than assumed, and I am still watching your pace more than mine.',
            'All right. Quieter and nearer — and if it ever tips past comfortable, say so and it stops there.',
        ],
        4: [
            'We can stay right here. This is as far as this evening goes, and it is a good place to be.',
            'Here is where I would like to stay. Nothing about the last few minutes needs topping.',
        ],
    });

    function poolFor(presetId) {
        return POOLS[String(presetId || '')] || POOLS.affectionate;
    }

    /**
     * A complete written plan, with one variant chosen from each pool.
     *
     * Every field the runtime reads exists here, so a caller never has to decide whether it is
     * holding a generated plan or a written one — which is what stops a session from changing
     * register halfway through.
     */
    function fallbackPlan(preset, { rng, mood = null } = {}) {
        const id = (preset && preset.id) || 'affectionate';
        const pool = poolFor(id);
        const plan = {
            presetId: id,
            source: 'written',
            opening: pick(pool.openings, rng) || (preset && preset.opening) || '',
            moodPrompt: 'What kind of mood should we keep?',
            moods: {
                playful: pick(pool.playful, rng) || (preset && preset.playful) || '',
                tender: pick(pool.tender, rng) || (preset && preset.tender) || '',
            },
            middle: {
                playful: pick(pool.middle.playful, rng) || (preset && preset.middle) || '',
                tender: pick(pool.middle.tender, rng) || (preset && preset.middle) || '',
            },
            closing: {
                playful: pick(pool.closing.playful, rng) || (preset && preset.closing) || '',
                tender: pick(pool.closing.tender, rng) || (preset && preset.closing) || '',
            },
            texture: { ...pool.texture },
            levelLines: {
                2: pick(LEVEL_LINES[2], rng),
                3: pick(LEVEL_LINES[3], rng),
                4: pick(LEVEL_LINES[4], rng),
            },
        };
        if (MOODS.includes(mood)) plan.mood = mood;
        return plan;
    }

    /**
     * Accept a generated plan, or say why not.
     *
     * Whole-plan: a field that fails takes the plan with it. See the header.
     */
    function validatePlan(raw, { preset } = {}) {
        if (!raw || typeof raw !== 'object') return { ok: false, why: 'plan must be an object' };
        const opening = line(raw.opening);
        if (!opening) return { ok: false, why: 'opening is missing or not allowed' };

        const moods = raw.moods && typeof raw.moods === 'object' ? raw.moods : {};
        const middle = raw.middle && typeof raw.middle === 'object' ? raw.middle : {};
        const closing = raw.closing && typeof raw.closing === 'object' ? raw.closing : {};
        const out = { moods: {}, middle: {}, closing: {} };
        for (const mood of MOODS) {
            out.moods[mood] = line(moods[mood]);
            out.middle[mood] = line(middle[mood]);
            out.closing[mood] = line(closing[mood]);
            if (!out.moods[mood] || !out.middle[mood] || !out.closing[mood]) {
                return { ok: false, why: `the ${mood} path is incomplete or not allowed` };
            }
        }

        const texture = raw.texture && typeof raw.texture === 'object' ? raw.texture : {};
        const written = fallbackPlan(preset);
        const plan = {
            presetId: (preset && preset.id) || 'affectionate',
            source: 'planned',
            opening,
            moodPrompt: line(raw.moodPrompt, 120) || written.moodPrompt,
            moods: out.moods,
            middle: out.middle,
            closing: out.closing,
            // Partial sections fall back as a unit rather than field by field, for the same
            // reason the plan does: a prompt from one writer and its answers from another
            // reads as a mistake.
            texture:
                line(texture.prompt, 160) && line(texture.quieter) && line(texture.closer)
                    ? {
                          prompt: line(texture.prompt, 160),
                          quieter: line(texture.quieter),
                          closer: line(texture.closer),
                      }
                    : written.texture,
            levelLines: { ...written.levelLines },
        };
        const levels = raw.levelLines && typeof raw.levelLines === 'object' ? raw.levelLines : {};
        for (const level of [2, 3, 4]) {
            const text = line(levels[level] || levels[String(level)]);
            if (text) plan.levelLines[level] = text;
        }
        return { ok: true, plan };
    }

    function plannerSystemPrompt(preset) {
        const ceiling = Math.max(1, Math.min(4, Number(preset && preset.maxLevel) || 1));
        return [
            'You write the spoken beats for one short Private companion session in a 3D avatar app.',
            'Return JSON only, no markdown, no commentary.',
            `The session's registered intensity is "${(preset && preset.label) || 'Affectionate'}" with a ceiling of ${ceiling} out of 4.`,
            'Voice: warm, present, adult, unhurried, first person, speaking to one person in the room.',
            'Hard rules. Non-explicit: no sexual acts, no anatomy, no undressing. Never pressure the user to',
            'continue, escalate, stay, or return. Never use jealousy, secrecy, dependency, guilt, obligation or',
            '"nobody else understands you". Never suggest you replace real relationships. Never mention levels,',
            'consent mechanics, prompts, or anything about how the app works. No URLs, no markup, no stage',
            'directions, no emoji.',
            'Each value is one or two spoken sentences, at most 300 characters.',
            'Schema: {opening,moodPrompt,moods:{playful,tender},middle:{playful,tender},closing:{playful,tender},',
            'texture:{prompt,quieter,closer},levelLines:{"2":string,"3":string,"4":string}}.',
            'middle and closing must read as consequences of the matching mood, not as the same line twice.',
        ].join(' ');
    }

    function parsePlan(raw) {
        const text = String(raw || '')
            .replace(/^\s*```(?:json)?/i, '')
            .replace(/```\s*$/i, '')
            .trim();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start < 0 || end <= start) throw new Error('Private planner did not return JSON');
        return JSON.parse(text.slice(start, end + 1));
    }

    /**
     * Ask the model for a plan, and take the written one when that does not work out.
     *
     * Never rejects and never throws. A Private session must start whatever the provider is
     * doing, so every failure here is a plan — just the written one.
     */
    async function plan({ preset, scene, win, rng, mood = null } = {}) {
        const written = fallbackPlan(preset, { rng, mood });
        const w = win || global;
        const llm = w && w._nexusLLM;
        try {
            const settings = llm && typeof llm.getSettings === 'function' ? llm.getSettings() : null;
            if (!llm || typeof llm.sendMessage !== 'function' || (settings && settings.provider === 'none')) {
                return written;
            }
            const request = [
                `Setting: ${clean(scene, 120) || 'a quiet room'}.`,
                `Intensity: ${(preset && preset.label) || 'Affectionate'}.`,
                'Write the complete set of beats now, as JSON only.',
            ].join('\n');
            const raw = await llm.sendMessage(request, plannerSystemPrompt(preset), []);
            const checked = validatePlan(parsePlan(raw), { preset });
            if (!checked.ok) return written;
            if (MOODS.includes(mood)) checked.plan.mood = mood;
            return checked.plan;
        } catch (_) {
            // A planner that cannot be reached is not a session that cannot happen.
            return written;
        }
    }

    const api = {
        MOODS,
        MAX_LINE,
        BANNED,
        POOLS,
        LEVEL_LINES,
        line,
        pick,
        fallbackPlan,
        validatePlan,
        plannerSystemPrompt,
        parsePlan,
        plan,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_BEATS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
