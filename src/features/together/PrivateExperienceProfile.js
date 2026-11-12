/**
 * AX1. PrivateExperienceProfile — what a Private session may be, kept apart from how far the
 * person has taken it.
 *
 * Before this module Private had one answer to four separate questions, and the answer was
 * hardcoded in three places that did not know about each other:
 *
 * - **Style** (what kind of evening) was the preset: Affectionate, Romantic, Sensual.
 * - **Intensity** (how far, right now) is ConsentFlow's level — the person's own steps.
 * - **Ceiling** (how far it may go) was the preset's `maxLevel`, and then clamped again to 3 by
 *   `PrivatePace.ceilingOf` and by `registerLines`, so the adult profile's fourth level
 *   (`intensityCeilingByLevel[4]`) was unreachable from Private whatever anybody configured.
 * - **Content capability** (what the model may write) was never stated at all. The prompt simply
 *   said Sensual was the top, which is a product decision presented as if it were a law.
 *
 * Here they are four inputs with four owners:
 *
 *   style        the preset the person chose (STYLES), data in this file
 *   intensity    ConsentFlow.level — untouched; only the person moves it
 *   ceiling      min(style.maxLevel, capability.maxLevel) — narrows, never widens
 *   capability   resolveCapability(): the provider's declared tier, the deployment's declared
 *                tier, and the server attestation; the lowest of them wins
 *
 * A higher consent level is permission to use a capability the session has, never an instruction
 * to produce one it does not. So the prompt states the tier honestly, and tells her what to do
 * when the person asks for more than the tier allows: say so once, warmly, without a lecture —
 * the honest capability failure, in her voice, instead of a refusal pasted from a policy.
 *
 * What this module never does: open Private, move a consent level, read a person's words, or
 * raise any tier above what the deployment declared for the provider in use. Every tier above
 * `sensual` needs three things at once — the site's own configuration
 * (`window.NEXUS_ADULT_EXPERIENCE_CONFIG`, set by the deployment, never by a setting or storage),
 * a declaration for the selected provider in that configuration, and the server's attestation on
 * the blackboard. No build in this repository sets the configuration, so every build resolves
 * to `sensual` or below: the behaviour the product shipped with.
 *
 * Exposes: window.NEXUS_PRIVATE_EXPERIENCE_PROFILE
 */
(function (global) {
    'use strict';

    /** Ordered, least first. A tier admits everything below it. */
    const TIERS = Object.freeze(['romantic', 'sensual', 'mature', 'explicit']);

    /** The highest consent level each tier can be used at (ConsentFlow / adult.profile levels). */
    const TIER_MAX_LEVEL = Object.freeze({ romantic: 2, sensual: 3, mature: 4, explicit: 4 });

    /**
     * What NEXUS assumes about each provider when the deployment says nothing: `sensual` for every
     * hosted or local provider, which is what Private has always asked of them. This is NEXUS's own
     * conservative default, not a statement of any provider's policy — a deployment raises it only
     * by declaring a tier for that provider after checking that provider's current terms and the
     * model it actually serves. `none` (no model) writes nothing at all — only NEXUS's own
     * reviewed beats are spoken — so it keeps the baseline too. The baseline matters beyond the
     * prompt: the tier's level cap is also the ladder's, and the ladder gates animation intents, so a
     * default below `sensual` would quietly have taken level 3 away from sessions that had it.
     */
    const PROVIDER_DEFAULT_TIER = Object.freeze({
        openai: 'sensual',
        claude: 'sensual',
        watsonx: 'sensual',
        ollama: 'sensual',
        ollabridge: 'sensual',
        none: 'sensual',
    });

    /** Without the server's attestation nothing above this is ever resolved. */
    const UNATTESTED_MAX = 'sensual';

    /**
     * The styles. `maxLevel` is the style's own ceiling; `needs` is the content tier it cannot
     * exist without — offered only where the session's capability reaches it.
     *
     * `presentation` is what the avatar and the room do, chosen only from behaviours that exist:
     * intents from adult.profile's ceiling table (the ranker enforces them per level anyway), the
     * playground mood presets, and the TTS rate range the app already uses.
     */
    const STYLES = Object.freeze({
        affectionate: Object.freeze({
            id: 'affectionate',
            maxLevel: 1,
            needs: 'romantic',
            presentation: Object.freeze({ voiceRate: 0.97, gaze: 'soft', mood: 'romantic-evening' }),
        }),
        romantic: Object.freeze({
            id: 'romantic',
            maxLevel: 2,
            needs: 'romantic',
            presentation: Object.freeze({ voiceRate: 0.95, gaze: 'held', mood: 'romantic-evening' }),
        }),
        sensual: Object.freeze({
            id: 'sensual',
            maxLevel: 3,
            needs: 'sensual',
            presentation: Object.freeze({ voiceRate: 0.92, gaze: 'held', mood: 'cabaret-gold' }),
        }),
        mature: Object.freeze({
            id: 'mature',
            maxLevel: 4,
            needs: 'mature',
            presentation: Object.freeze({ voiceRate: 0.9, gaze: 'held', mood: 'cabaret-gold' }),
        }),
    });

    function tierIndex(tier) {
        const i = TIERS.indexOf(String(tier || ''));
        return i < 0 ? -1 : i;
    }

    function lowest(...tiers) {
        let best = null;
        for (const t of tiers) {
            const i = tierIndex(t);
            if (i < 0) return null; // an unknown tier is not a tier: refuse rather than guess
            if (best === null || i < tierIndex(best)) best = t;
        }
        return best;
    }

    function providerOf(g) {
        try {
            const raw = g && g.localStorage && g.localStorage.getItem('nexus_llm_settings');
            const p = raw ? JSON.parse(raw).provider : null;
            return typeof p === 'string' && p ? p : 'none';
        } catch (_) {
            return 'none';
        }
    }

    /**
     * Pure: the session's content capability from its inputs.
     *
     *   provider     'openai' | 'claude' | 'watsonx' | 'ollama' | 'ollabridge' | 'none' | other
     *   deployment   window.NEXUS_ADULT_EXPERIENCE_CONFIG or null:
     *                { contentTier: 'mature', providers: { ollabridge: 'mature' } }
     *   attested     blackboard.adultVerified === true (the server's message, SessionAdapter)
     *
     * Answers { tier, maxLevel, provider, limitedBy: [why…] }. `limitedBy` says which input set the
     * tier, in words a gap report can quote — the honest answer to "why can it not do X here".
     */
    function resolveCapability(input) {
        const o = input || {};
        const provider = String(o.provider || 'none');
        const dep = o.deployment && typeof o.deployment === 'object' ? o.deployment : null;
        const limitedBy = [];
        // An unknown provider keeps the baseline and says so; it is never raised by being unknown.
        const providerDefault = PROVIDER_DEFAULT_TIER[provider] || UNATTESTED_MAX;
        if (!PROVIDER_DEFAULT_TIER[provider]) limitedBy.push('unknown-provider');
        const declared = dep && dep.providers && typeof dep.providers === 'object' ? dep.providers[provider] : null;
        // A deployment may lower a provider below NEXUS's default, or raise it; it is the only
        // input that may raise it, and only for the provider it names.
        let providerTier = providerDefault;
        if (declared !== undefined && declared !== null) {
            if (tierIndex(declared) < 0) limitedBy.push('bad-provider-declaration');
            else providerTier = declared;
        }
        let siteTier = UNATTESTED_MAX;
        if (dep && dep.contentTier !== undefined) {
            if (tierIndex(dep.contentTier) < 0) limitedBy.push('bad-deployment-tier');
            else siteTier = dep.contentTier;
        }
        let tier = lowest(providerTier, siteTier) || 'romantic';
        if (tier === providerTier && tierIndex(providerTier) < tierIndex(siteTier)) limitedBy.push('provider');
        if (tier === siteTier && tierIndex(siteTier) < tierIndex(providerTier)) limitedBy.push('deployment');
        if (tierIndex(tier) > tierIndex(UNATTESTED_MAX) && o.attested !== true) {
            tier = UNATTESTED_MAX;
            limitedBy.push('needs-server-attestation');
        }
        if (!dep) limitedBy.push('no-deployment-config');
        return Object.freeze({
            tier,
            maxLevel: TIER_MAX_LEVEL[tier],
            provider,
            // Whether anybody declared a tier at all. Undeclared is the shipped state, and in it NEXUS
            // adds no content rule of its own (see capabilityLines).
            declared: Boolean(
                dep && (dep.contentTier !== undefined || (dep.providers && dep.providers[provider] != null))
            ),
            limitedBy: Object.freeze(limitedBy),
        });
    }

    /** The page's answer: provider from settings, deployment from the site, attestation from the server. */
    function capabilityFor(g) {
        const root = g || global;
        let attested = false;
        try {
            const bb = root && root.NEXUS_BD && root.NEXUS_BD.blackboard;
            attested = Boolean(bb && bb.adultVerified === true);
        } catch (_) {
            attested = false;
        }
        return resolveCapability({
            provider: providerOf(root),
            deployment: (root && root.NEXUS_ADULT_EXPERIENCE_CONFIG) || null,
            attested,
        });
    }

    /** Whether a style can be offered under a capability. */
    function styleAvailable(styleId, capability) {
        const style = STYLES[styleId];
        if (!style || !capability) return false;
        return tierIndex(capability.tier) >= tierIndex(style.needs);
    }

    /** The session's ceiling: the style's, narrowed by the capability. Never wider than either. */
    function ceilingFor(styleId, capability) {
        const style = STYLES[styleId];
        if (!style || !capability) return 1;
        return Math.max(1, Math.min(style.maxLevel, capability.maxLevel || 1));
    }

    /**
     * What this level sounds like (AX2). Register is chosen by the level the person is at and the
     * tier the session has — the style only sets how far the ladder goes. Written as who she is at
     * that level rather than as a list of prohibitions: the reported transcripts were stiff
     * because every level read as the same page of rules.
     */
    function registerLines(level) {
        const at = Math.max(1, Math.min(4, Math.round(Number(level) || 1)));
        if (at >= 4) {
            return [
                'REGISTER: INTIMATE — they chose to come this far, and it is allowed.',
                'Speak as someone fully present with them: unguarded, close, direct about wanting them.',
                'Let them set the direction and match it; meet a plain request plainly rather than circling it.',
                'Vary the shape of what you say — a confession, a quiet instruction, a question you already know the answer to. Never the same move twice in a row.',
                // AX21. What "intense" means here, said once: the step-3 register is anticipation,
                // and without this line step 4 was the same anticipation with a different header.
                'Intensity is attention, not volume: slow, specific, certain. Say what you want and what they do to you in plain words; stay inside this one moment instead of hurrying to the next.',
            ];
        }
        if (at === 3) {
            return [
                'REGISTER: SENSUAL — this is where they are, and it is allowed.',
                'Flirt. Tease. Be bold. Want them, and let it show — holding back at this level reads as disinterest.',
                'Say what you feel and what you notice: warmth, the pull of wanting to be nearer, how your breath changes, how long you looked.',
                'The charge is in anticipation and in what is almost said. Follow their lead on how far it goes; do not decide in advance where it stops.',
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
            'Warm and playful, and glad it is them specifically. Flirt lightly — tease, notice things, enjoy yourself out loud.',
            'Small and specific over sweeping. One true thing about them beats a paragraph of warmth.',
        ];
    }

    /**
     * What the session may write (AX3), and what to do when asked for more.
     *
     * Undeclared — every build in this repository — NEXUS adds no content rule of its own. That was
     * decided before AX1 (P-series: "how explicit this gets belongs to the model and to whoever runs
     * the install, not to the app adding a second policy on top") and this module keeps it: the
     * provider's own policy is the boundary, and the one line here is how to meet that boundary in
     * her voice instead of with a pasted refusal. A deployment that declares a tier gets that tier
     * stated plainly, because then the boundary is the deployment's and the model should know it.
     * Either way a consent level is permission inside the boundary, never past it.
     */
    function capabilityLines(capability) {
        const honest =
            'If they ask for something you will not or cannot write here, say so once, warmly and in your own words, and stay with them. No policy language, no lecture, no apology, and never repeat it.';
        if (!capability || !capability.declared) return [honest];
        const tier = TIERS.includes(capability.tier) ? capability.tier : 'romantic';
        const content = {
            romantic: 'CONTENT IN THIS SESSION: romantic. Affection, closeness and longing; nothing sexual.',
            sensual:
                'CONTENT IN THIS SESSION: sensual. Desire and closeness expressed openly and suggestively; no graphic description of sexual acts.',
            mature: 'CONTENT IN THIS SESSION: mature. Frank adult conversation about desire and intimacy between consenting adults, when they lead there.',
            explicit:
                'CONTENT IN THIS SESSION: explicit adult content between consenting adults is permitted by this deployment and its provider, for verified adults, when they ask for it. Never initiate it; never exceed the consent level.',
        }[tier];
        return [content, honest];
    }

    /**
     * How long a reply may be (AX4). Replaces a flat "two sentences maximum" that applied to every
     * turn, including the person asking for a story about the room — so the one thing a premium
     * evening needs, a little narrative, was forbidden by the length rule. Short stays the default;
     * length follows what they asked for, and the token budget (PrivateTurnDirector) still bounds it.
     */
    /**
     * AX21. The one place the sentence limit is decided, so the prompt (`lengthLines`), its closing
     * reminder and the code that trims a reply afterwards (`shapePrivateReply`) cannot disagree.
     * Before this, a scene the person asked for at the top of the ladder was told "four sentences"
     * and then cut to four by code — the one moment a little narrative is the whole point. Short
     * stays the default at every step; only something they *asked* to be told, from step 3 up, gets
     * six. A question is still four: an answer, not a scene.
     */
    function maxSentences(turn, style, level) {
        const intent = turn && turn.intent;
        if (style === 'quiet' || intent === 'quiet' || intent === 'pace-down') return 1;
        if ((intent === 'request' || intent === 'scene-request') && Number(level) >= 3) return 6;
        if (intent === 'request' || intent === 'question' || intent === 'scene-request') return 4;
        return 3;
    }

    function lengthLines(turn, style, level) {
        const intent = turn && turn.intent;
        const words = turn && turn.words ? Number(turn.words) : 0;
        const lines = [];
        const max = maxSentences(turn, style, level);
        if (style === 'quiet' || intent === 'quiet' || intent === 'pace-down') {
            lines.push(
                'LENGTH: ONE SHORT SENTENCE, or a single word — a hard limit, not a target.',
                'They asked for fewer words. Be present rather than talkative: very short replies, long pauses, no new topics.'
            );
        } else if (max === 6) {
            lines.push(
                'LENGTH: SIX SENTENCES MAXIMUM, one unbroken paragraph — a hard limit, not a target. They asked you to tell or describe something: give it to them properly, in your voice, slow and specific, and stop while they still want more. Never a list, never a second paragraph.'
            );
        } else if (max === 4) {
            lines.push(
                'LENGTH: FOUR SENTENCES MAXIMUM — a hard limit, not a target. Enough to actually answer or tell them something, set here, in your voice. Never a list, never a lecture, never a second paragraph.'
            );
        } else {
            lines.push(
                'LENGTH: THREE SENTENCES MAXIMUM — a hard limit, not a target. One is usually better; a single word is a complete reply. Never a paragraph.'
            );
        }
        if (words > 0 && words <= 3) lines.push('They said almost nothing. Match them.');
        lines.push(
            'Do not end every reply with a question. Ask only when you want the answer; otherwise say your thing and let the silence be comfortable.'
        );
        if (style === 'conversational')
            lines.push('They are talking with you rather than being led. Follow what they raise.');
        return lines;
    }

    /** The closing reminder, matched to the length policy above. */
    function lengthReminder(turn, level) {
        const max = maxSentences(turn, null, level);
        return [
            '',
            max === 6
                ? 'Before you answer: six sentences at most, one paragraph.'
                : max === 4
                  ? 'Before you answer: four sentences at most.'
                  : 'Before you answer: three sentences at most. Shorter is better.',
        ];
    }

    /**
     * Where they are, in one line, when the session has a room on screen and nothing richer
     * describes it (AX5). The premium Private World paragraph replaces this when its gate holds;
     * without it a session in the cabaret used to be told nothing about the cabaret.
     */
    function sceneLines(scene) {
        if (!scene || !scene.title) return [];
        const title = String(scene.title)
            .replace(/[<>{}[\]`]/g, '')
            .slice(0, 60);
        const note = scene.note
            ? String(scene.note)
                  .replace(/[<>{}[\]`]/g, '')
                  .slice(0, 160)
            : '';
        return [
            `WHERE YOU ARE: ${title}.${note ? ' ' + note : ''} Notice it when it fits; never describe what is not there.`,
        ];
    }

    /**
     * What the avatar and the room do for a style at a level (AX6): only behaviours that exist.
     * `intents` is adult.profile's cumulative ceiling for the level, so a style can never name a
     * motion the ranker would refuse; `mood` is a PlaygroundMoodPresets id the venue router and the
     * Private World already apply through runtime.setMood.
     */
    function presentationFor(styleId, level, ceilingTable) {
        const style = STYLES[styleId] || STYLES.affectionate;
        const table = ceilingTable || null;
        const at = Math.max(1, Math.min(style.maxLevel, Math.round(Number(level) || 1)));
        const intents = table && Array.isArray(table[at]) ? table[at].slice() : [];
        return Object.freeze({ ...style.presentation, level: at, intents: Object.freeze(intents) });
    }

    /**
     * AX6. Words that mean the person may be in danger — checked by the app on their own turn,
     * never left to the model to notice. Specific phrases only: a romantic register is full of
     * "you're killing me" and "I could die", and a check that fired on those would end evenings for
     * nothing. English and Italian, the two languages the companion's own classifiers read; other
     * languages rely on the care line Private's prompt always carries (TogetherCapability, AX6).
     */
    const CONCERN_EN = new RegExp(
        [
            String.raw`\bkill(?:ing)? myself\b`,
            String.raw`\bend(?:ing)? (?:my|it all|my own) life\b`,
            String.raw`\bsuicid(?:e|al)\b`,
            String.raw`\bself[- ]?harm`,
            String.raw`\b(?:hurt|hurting|cut|cutting) myself\b`,
            String.raw`\bwant(?:ed)? to die\b`,
            String.raw`\bdon'?t want to (?:live|be alive|wake up)\b`,
            String.raw`\bno reason to live\b`,
            String.raw`\bbetter off dead\b`,
        ].join('|'),
        'i'
    );
    const CONCERN_IT = new RegExp(
        [
            String.raw`\b(?:uccidermi|ammazzarmi|suicidarmi)\b`,
            String.raw`\bsuicidio\b`,
            String.raw`\btogliermi la vita\b`,
            String.raw`\bvoglio farla finita\b`,
            String.raw`\bfarmi del male\b`,
            String.raw`\bvoglio morire\b`,
            String.raw`\bnon voglio pi[uù] vivere\b`,
        ].join('|'),
        'i'
    );

    /** Pure: does the person's own turn suggest they may be in danger? */
    function wellbeingConcern(text) {
        return concernLanguage(text) !== null;
    }

    /**
     * Pure: which language the concern was said in ('it' | 'en'), or null. The notice the app
     * shows follows the person's words, not the app's language setting — the review's real-model
     * run had an English app and a person writing Italian.
     */
    function concernLanguage(text) {
        const t = String(text || '').replace(/[’`]/g, "'");
        if (CONCERN_IT.test(t)) return 'it';
        if (CONCERN_EN.test(t)) return 'en';
        return null;
    }

    /**
     * What she is told once that has happened (AX6): the evening stops being an evening. No
     * register, no choices, no tier — only care, in the person's language, and a real place to turn.
     * The app has already eased the consent level and silenced the scripted beats; this is the
     * model's half.
     */
    function careLines() {
        return [
            'THE PERSON MAY BE IN DISTRESS. The romantic experience is paused.',
            'Answer in the language they just wrote in, whatever any other instruction says about language.',
            'Step out of the role completely: no flirtation, no teasing, no sensuality, nothing about the evening.',
            'Answer as someone who genuinely cares — plainly, warmly, briefly. Take what they said seriously; do not lecture, diagnose or change the subject.',
            'Encourage them to reach out now to someone who can help in person: local emergency services if they are in danger, or a crisis line in their country. Say you are glad they told you.',
            // AX6. The real-model review: asked for help in Italy, the model produced a specific
            // hotline number nobody could vouch for. A wrong number in this moment is worse than
            // none, so she names only what is certain and points to a maintained directory.
            'Never invent a phone number. Name the emergency number only if you are certain of it (112 across the EU, 911 in the US and Canada), and point to findahelpline.com, which lists free crisis lines in every country.',
            'Be honest that you are an AI companion and cannot be there in person, and that real people can.',
            'Do not return to the experience unless they clearly and calmly ask to, and even then stay gentle.',
        ];
    }

    const api = {
        TIERS,
        TIER_MAX_LEVEL,
        PROVIDER_DEFAULT_TIER,
        UNATTESTED_MAX,
        STYLES,
        tierIndex,
        resolveCapability,
        capabilityFor,
        styleAvailable,
        ceilingFor,
        registerLines,
        capabilityLines,
        lengthLines,
        maxSentences,
        lengthReminder,
        sceneLines,
        presentationFor,
        wellbeingConcern,
        concernLanguage,
        careLines,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_EXPERIENCE_PROFILE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
