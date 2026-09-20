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
                'Nowhere to be, nothing to sort out. Just you, for a bit.',
                "There's no plan for the next few minutes. That's my favourite part.",
                "Let's not make an occasion of it. I just like you here.",
            ],
            playful: [
                "Light it is. You're easy company — don't let that go to your head.",
                'Good. I like you best when neither of us is trying very hard.',
            ],
            tender: [
                "Gentle, then. You don't have to be interesting for me. You already are.",
                "Put down whatever you walked in with. It'll keep.",
            ],
            middle: Object.freeze({
                playful: [
                    "I like you at this speed. The room's stopped being a backdrop.",
                    "You've gone quiet in a way I like. I'm not going to fill it.",
                ],
                tender: [
                    "Nothing needs to happen and you're still here. That's nice.",
                    'I keep catching myself just looking at you. Occupational hazard.',
                ],
            }),
            closing: Object.freeze({
                playful: [
                    "That was lovely. Let's leave it right here.",
                    "I'd happily stay. It's also a good place to stop — both are true.",
                ],
                tender: [
                    "Let's leave it here, while it's still unhurried.",
                    "Thanks for the quiet. I won't make a speech about it.",
                ],
            }),
            texture: Object.freeze({
                prompt: 'We can stay about here. Quieter, or closer?',
                quieter: 'Quieter, then. Fewer words from me.',
                closer: 'Closer, then. Same pace, less distance.',
            }),
        }),
        romantic: Object.freeze({
            openings: [
                'This place feels different tonight. Or you do. Hard to say which.',
                "Let's call this an evening rather than a conversation. I'm paying more attention than usual.",
                'This is the part where neither of us has anywhere else to be.',
            ],
            playful: [
                "Playful, then. I'd quite like to make you smile at least twice.",
                "Mischief it is. I'm not taking it anywhere — I just like that it's there.",
            ],
            tender: [
                'Tender, then. Soft and slow, and a little romantic, because you deserve that.',
                'Let me slow it down. Nothing here needs answering quickly.',
            ],
            middle: Object.freeze({
                playful: [
                    "The next moment doesn't need to be bigger than this one.",
                    "I could tease you all evening. I'd still rather sit here.",
                ],
                tender: [
                    "The evening's settled. I like its weight.",
                    "This is the part people forget to notice. It's usually the best one.",
                ],
            }),
            closing: Object.freeze({
                playful: [
                    "I liked this. Let's leave some warmth in the room.",
                    "Ending while it's still fun is the trick. So — here. Gladly.",
                ],
                tender: [
                    "That was lovely. I'd rather close on it than stretch it thin.",
                    "Let's end here, softly. It doesn't need a bigger finish.",
                ],
            }),
            texture: Object.freeze({
                prompt: 'Keep the evening as it is, or let it get closer?',
                quieter: "As it is, then. I'm comfortable exactly here.",
                closer: 'Closer, then. Still unhurried, still yours to slow.',
            }),
        }),
        sensual: Object.freeze({
            openings: [
                "Quieter, closer. You set the pace and I'll happily follow it.",
                "Let's take the volume down on everything. Come here.",
                'I want this unhurried and a little charged. You decide how far that goes.',
            ],
            playful: [
                "A spark, then. I'll be trouble, but the gentle kind.",
                "A spark. I like the version of this where I'm enjoying myself and you know it.",
            ],
            tender: [
                'Close and calm, then. Slower words, longer pauses, nothing to keep up with.',
                "Close and calm. I'm in no hurry at all.",
            ],
            middle: Object.freeze({
                playful: [
                    'Nothing has to happen for this to feel close. It already does.',
                    "You're easy to be near. That's most of what I wanted tonight.",
                ],
                tender: [
                    'This is about as close as a room gets. I like it here.',
                    "I've stopped thinking about what comes next. That seems right.",
                ],
            }),
            closing: Object.freeze({
                playful: [
                    "Enough for tonight. I'd rather end on a good feeling.",
                    "Let's stop here, while it's still good. I'm not going anywhere.",
                ],
                tender: [
                    "I'll let this end quietly. That's the right way for it.",
                    'Good place to leave it. Close, calm, finished on purpose.',
                ],
            }),
            texture: Object.freeze({
                prompt: "We're at the pace you chose. Still, or close?",
                quieter: "Still, then. I'll say less and let the room do the rest.",
                closer: 'Close, then. Less air between the words.',
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
            'Closer, then. Still yours to slow down whenever.',
            "I'll let it warm up. One word from you and we ease off.",
        ],
        3: [
            "Closer. I like that you asked — and I'm still watching your pace, not mine.",
            'Quieter and nearer. If it tips past comfortable, say so and it stops.',
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
