/**
 * PM1. Private Mode decides what she may say: off, nothing changes; on, consensual adult content
 * is allowed and stated plainly. The hard limits (minors, non-consent, illegal, real people) hold
 * in every mode. See src/features/chat/PrivateModeContent.js.
 */
/* global describe, test, expect, afterEach */
const fs = require('fs');
const path = require('path');
const PM = require('../../src/features/chat/PrivateModeContent.js');
const Profile = require('../../src/features/together/PrivateExperienceProfile.js');

const gate = (on) => ({ NEXUS_SPICY: { usable: () => on, isEnabled: () => on } });

afterEach(() => {
    delete window.NEXUS_SPICY;
    delete window.NEXUS_TOGETHER_CAPABILITY;
});

describe('PM1. one flag: Settings ▸ Private Mode', () => {
    test('off, missing or broken gate is off; only a gate that says yes is on', () => {
        expect(PM.isOn({})).toBe(false);
        expect(PM.isOn(gate(false))).toBe(false);
        expect(PM.isOn({ NEXUS_SPICY: { usable: () => 'true' } })).toBe(false);
        expect(
            PM.isOn({
                NEXUS_SPICY: {
                    usable: () => {
                        throw new Error('x');
                    },
                },
            })
        ).toBe(false);
        expect(PM.isOn(gate(true))).toBe(true);
        expect(PM.isOn({ NEXUS_SPICY: { isEnabled: () => true } })).toBe(true); // the older gate shape
    });
});

describe('PM1. the ordinary chat prompt', () => {
    test('Private Mode off: nothing is added — the assistant is exactly as before', () => {
        expect(PM.systemPromptSuffix(gate(false))).toBe('');
        expect(PM.systemPromptSuffix({})).toBe('');
        expect(PM.lines(gate(false))).toEqual([]);
    });

    test('Private Mode on: adult content allowed in plain words, and the hard limits with it', () => {
        const text = PM.systemPromptSuffix(gate(true));
        expect(text).toMatch(/sexual, erotic and explicit content between consenting adults is allowed/i);
        expect(text).toMatch(/without fading to black/i);
        expect(text).toMatch(/do not refuse, lecture, add disclaimers or ask them to confirm their age again/i);
        // The limits that never move.
        expect(text).toMatch(/under 18/i);
        expect(text).toMatch(/reads as a minor/i);
        expect(text).toMatch(/non-consensual/i);
        expect(text).toMatch(/nothing illegal/i);
        expect(text).toMatch(/real, identifiable person/i);
    });

    test('inside a Private session it gives way to Private’s own paragraph (said once, not twice)', () => {
        const w = { ...gate(true), NEXUS_TOGETHER_CAPABILITY: { privateSessionActive: () => true } };
        expect(PM.systemPromptSuffix(w)).toBe('');
    });

    test('all three prompt-assembly sites in main.js send it', () => {
        const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
        expect(main.match(/NEXUS_PRIVATE_MODE_CONTENT\?\.systemPromptSuffix\?\.\(\)/g)).toHaveLength(3);
        const boot = fs.readFileSync(path.join(__dirname, '../../src/behavior/boot.js'), 'utf8');
        const at = (f) => boot.indexOf(f);
        expect(at('src/features/chat/PrivateModeContent.js')).toBeGreaterThan(0);
        expect(at('src/features/chat/PrivateModeContent.js')).toBeLessThan(
            at('src/features/together/PrivateExperienceProfile.js')
        );
    });
});

describe('PM1. a Private session’s content tier', () => {
    test('Private Mode on is the adult confirmation: the tier is explicit, no server attestation needed', () => {
        const c = Profile.resolveCapability({
            provider: 'ollabridge',
            deployment: null,
            attested: false,
            privateMode: true,
        });
        expect(c.tier).toBe('explicit');
        expect(c.limitedBy).not.toContain('needs-server-attestation');
        const lines = Profile.capabilityLines(c).join('\n');
        expect(lines).toMatch(/sexual, erotic and explicit content between consenting adults is allowed/i);
    });

    test('Private Mode off keeps the stricter tier exactly as before', () => {
        const c = Profile.resolveCapability({
            provider: 'ollabridge',
            deployment: null,
            attested: false,
            privateMode: false,
        });
        expect(c.tier).toBe('mature');
        expect(Profile.capabilityLines(c).join('\n')).not.toMatch(/explicit content .* is allowed/i);
    });

    test('a deployment that declares less still narrows it — the operator’s limit stands', () => {
        const c = Profile.resolveCapability({
            provider: 'openai',
            deployment: { contentTier: 'sensual' },
            attested: false,
            privateMode: true,
        });
        expect(c.tier).toBe('sensual');
        expect(Profile.capabilityLines(c).join('\n')).toMatch(/no graphic description/);
    });

    test('capabilityFor reads the page’s own gate', () => {
        window.NEXUS_SPICY = { usable: () => true };
        expect(Profile.capabilityFor(window)).toMatchObject({ tier: 'explicit', privateMode: true });
        window.NEXUS_SPICY = { usable: () => false };
        expect(Profile.capabilityFor(window)).toMatchObject({ tier: 'mature', privateMode: false });
    });
});
