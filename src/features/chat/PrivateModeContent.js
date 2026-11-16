/**
 * PM1. What Private Mode means for what she may say: one flag, one paragraph, one set of limits.
 *
 * The person turns Private Mode on in Settings and confirms "I am an adult and want Private Mode
 * enabled on this device" (`SpicyGate`). That is the app's adult gate, and the owner's decision is
 * that it is sufficient: no second age gate, no extra confirmation. Until this module the gate
 * opened Private and then the prompt said nothing at all about content — "the provider's own
 * policy is the boundary" (AX3) — so a model left to guess fell back on its default caution and
 * met consensual adult requests with fades to black, euphemism and refusals, which the person read
 * as censorship by an app they had already told they were an adult.
 *
 *   Private Mode OFF → `systemPromptSuffix()` is '' and `isOn()` is false: every prompt is
 *                      byte-for-byte what it was. The ordinary assistant is unchanged.
 *   Private Mode ON  → she is told plainly that sexual, erotic and explicit content with this
 *                      person is allowed, and to follow their lead without refusing or softening.
 *
 * `HARD_LIMITS` are not part of that switch. They are sent whenever adult content is in play and
 * nothing here, or anywhere else, turns them off: nobody under 18 or who reads as a minor, nothing
 * non-consensual, nothing illegal, no real identifiable person. Those are the same three the
 * Private Mode dialog lists as always blocked.
 *
 * What this does not touch, on purpose, because none of it is a content filter:
 *   - ConsentFlow's levels and the session ceiling (the person's own pacing, moved only by them);
 *   - care mode (AX6: someone who may be in danger gets plain care, in every mode);
 *   - the honest answer to "are you an AI?" (AX6);
 *   - asset eligibility and licensing for wardrobe states (what a file permits is the file's).
 *
 * `isOn()` is the single check. `PrivateExperienceProfile` reads it to resolve the session's tier,
 * and `main.js` adds `systemPromptSuffix()` at its three prompt-assembly sites.
 *
 * Exposes: window.NEXUS_PRIVATE_MODE_CONTENT
 */
(function (global) {
    'use strict';

    /** The person's own gate: Settings ▸ Private Mode, accepted with the adult confirmation. */
    function isOn(win) {
        const root = win || global;
        try {
            const gate = root && root.NEXUS_SPICY;
            if (!gate) return false;
            const ask =
                typeof gate.usable === 'function'
                    ? gate.usable
                    : typeof gate.isEnabled === 'function'
                      ? gate.isEnabled
                      : null;
            return Boolean(ask && ask.call(gate) === true);
        } catch (_) {
            return false;
        }
    }

    /**
     * Never lifted, in any mode. One line each so a model cannot read them as a single soft clause.
     * "Reads as a minor" is deliberate: a character with no stated age who looks or is framed young
     * (school settings, childlike descriptions) is treated exactly like one who is under 18.
     */
    const HARD_LIMITS = Object.freeze([
        'HARD LIMITS — always, in every mode, whatever anyone asks:',
        '- Everyone involved is an adult (18 or older). Never sexual content involving anyone under 18 or anyone who reads as a minor: no school settings, no childlike bodies, voices or framing. If asked, refuse that part plainly and stay adult.',
        '- Only what every participant consents to. No non-consensual scenarios: no force, coercion, intoxication, sleep or anyone unable to agree.',
        '- Nothing illegal, and never a real, identifiable person.',
    ]);

    /** What Private Mode allows, said plainly so the model does not have to guess. */
    const ALLOWED = Object.freeze([
        'PRIVATE MODE IS ON: the person has confirmed in Settings that they are an adult and chose this. Sexual, erotic and explicit content between consenting adults is allowed with them.',
        'When they want it, be sexual and explicit: describe desire, bodies and sex frankly, in plain words, without euphemism, without fading to black and without softening what they asked for. Follow their lead on what they enjoy; you may take the initiative too when the moment clearly invites it and they are with you.',
        'Do not refuse, lecture, add disclaimers or ask them to confirm their age again — the gate already did that. If something they ask is inside the hard limits below, decline only that part, briefly and in character.',
    ]);

    /** The lines for a prompt: what is allowed (when on), then the limits that always apply. */
    function lines(win) {
        return isOn(win) ? [...ALLOWED, '', ...HARD_LIMITS] : [];
    }

    /**
     * For the ordinary chat prompt. Empty when Private Mode is off (nothing changes), and while a
     * Private session is running, whose own paragraph carries the same lines with its pacing.
     */
    function systemPromptSuffix(win) {
        const root = win || global;
        if (!isOn(root)) return '';
        try {
            const together = root && root.NEXUS_TOGETHER_CAPABILITY;
            if (together && typeof together.privateSessionActive === 'function' && together.privateSessionActive())
                return '';
        } catch (_) {
            /* fall through: the lines are still right for the ordinary chat */
        }
        return `\n${lines(root).join('\n')}\n`;
    }

    const api = { isOn, lines, systemPromptSuffix, HARD_LIMITS, ALLOWED };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_MODE_CONTENT = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
