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

    // Authored phrases and planner instructions live in per-locale catalog resources.
    // Browser boot loads this before PrivateBeats; Jest resolves the same module.
    const Catalog = (global && global.NEXUS_PRIVATE_PROMPT_CATALOG) ||
        (typeof module !== 'undefined' && module.exports ? require('./PrivatePromptCatalog.js') : null);
    const POOLS = Catalog ? Catalog.POOLS : Object.freeze({});
    const LEVEL_LINES = Catalog ? Catalog.LEVEL_LINES : Object.freeze({});

    function poolFor(presetId, locale) {
        return Catalog && Catalog.poolFor(String(presetId || ''), locale);
    }

    /**
     * A complete written plan, with one variant chosen from each pool.
     *
     * Every field the runtime reads exists here, so a caller never has to decide whether it is
     * holding a generated plan or a written one — which is what stops a session from changing
     * register halfway through.
     */
    function fallbackPlan(preset, { rng, mood = null, locale = null } = {}) {
        const id = (preset && preset.id) || 'affectionate';
        const language = Catalog ? Catalog.code(locale) : 'en-US';
        const pool = poolFor(id, language);
        if (!pool) return null;
        const levels = Catalog.levelLines(language);
        const plan = {
            presetId: id,
            locale: language,
            source: 'written',
            opening: pick(pool.openings, rng) || (preset && preset.opening) || '',
            moodPrompt: Catalog.moodPrompt(language),
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
                2: pick(levels[2], rng),
                3: pick(levels[3], rng),
                4: pick(levels[4], rng),
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
    function validatePlan(raw, { preset, locale } = {}) {
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
        const written = fallbackPlan(preset, { locale });
        if (!written) return { ok: false, why: 'missing locale catalog' };
        const plan = {
            presetId: (preset && preset.id) || 'affectionate',
            locale: written.locale,
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

    function plannerSystemPrompt(preset, locale) {
        const ceiling = Math.max(1, Math.min(4, Number(preset && preset.maxLevel) || 1));
        return Catalog.plannerSystemPrompt((preset && preset.id) || 'affectionate', ceiling, locale);
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
    async function plan({ preset, scene, win, rng, mood = null, locale } = {}) {
        const w = win || global;
        const language = Catalog.code(locale || (w && w.AppLanguage && w.AppLanguage.code));
        const written = fallbackPlan(preset, { rng, mood, locale: language });
        const llm = w && w._nexusLLM;
        try {
            const settings = llm && typeof llm.getSettings === 'function' ? llm.getSettings() : null;
            if (!llm || typeof llm.sendMessage !== 'function' || (settings && settings.provider === 'none')) {
                return written;
            }
            const request = Catalog.plannerRequest((preset && preset.id) || 'affectionate', clean(scene, 120), language);
            const raw = await llm.sendMessage(request, plannerSystemPrompt(preset, language), []);
            const checked = validatePlan(parsePlan(raw), { preset, locale: language });
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
