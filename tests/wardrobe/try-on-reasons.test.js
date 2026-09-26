/**
 * W4. Forge's states and refusals, put into words.
 *
 * The lists below are Forge's own (`wardrobe.domain.jobs` in 3D-Wardrobe-Forge). Holding
 * them here means a code Forge sends is never shown as a bare identifier.
 */
const Reasons = require('../../src/wardrobe/TryOnReasons.js');

const FORGE_STATES = [
    'queued',
    'validating',
    'analyzing-avatar',
    'planning-outfit',
    'generating-garment',
    'fitting',
    'skinning',
    'resolving-clipping',
    'exporting',
    'validating-output',
    'rendering-preview',
];
const FORGE_REASONS = [
    'source_model_modification_not_permitted',
    'requires_user_license_attestation',
    'source_is_not_a_vrm',
    'source_is_not_humanoid',
    'source_exceeds_size_limit',
    'source_could_not_be_fetched',
    'source_hash_mismatch',
    'source_uses_unsupported_features',
    'no_garment_template_matched',
    'fitting_failed',
    'output_validation_failed',
    'garment_provider_error',
    'intimate_garments_not_permitted_by_model',
    'requires_adult_declaration',
    'source_body_incomplete_under_clothing',
    'internal_error',
];

describe('TryOnReasons', () => {
    test('the steps are Forge’s working states, in Forge’s order, each with a label', () => {
        expect(Reasons.STEPS.map((step) => step.state)).toEqual(FORGE_STATES);
        Reasons.STEPS.forEach((step) => expect(step.label.length).toBeGreaterThan(3));
    });

    test('every Forge refusal code has a sentence, and no sentence is a bare code', () => {
        expect(Object.keys(Reasons.REASONS).sort()).toEqual([...FORGE_REASONS].sort());
        Object.values(Reasons.REASONS).forEach((text) => expect(text).toMatch(/\s/));
    });

    test('progress marks what is done, what is running and what is still to come', () => {
        const at = Reasons.progress('fitting');
        const status = Object.fromEntries(at.steps.map((step) => [step.state, step.status]));
        expect(status.validating).toBe('done');
        expect(status.fitting).toBe('active');
        expect(status.exporting).toBe('pending');
        expect(at.current).toBe('Fitting it to her');
        expect(Reasons.progress('completed').steps.every((step) => step.status === 'done')).toBe(true);
    });

    test('a state Forge adds later is shown by name rather than dropped', () => {
        expect(Reasons.progress('draping').current).toBe('draping');
    });

    test('explain uses the code first, then the transport, then Forge’s own message', () => {
        expect(Reasons.explain({ state: 'rejected', reason: 'fitting_failed', error: 'x' })).toBe(
            Reasons.REASONS.fitting_failed
        );
        expect(Reasons.explain({ status: 429, message: 'slow down' })).toBe(Reasons.TRANSPORT.busy);
        expect(Reasons.explain({ status: 401 })).toBe(Reasons.TRANSPORT.auth);
        expect(Reasons.explain(new TypeError('Failed to fetch'))).toBe(Reasons.TRANSPORT.offline);
        expect(Reasons.explain(new Error('Wardrobe generation timed out'))).toBe(Reasons.TRANSPORT.timeout);
        expect(Reasons.explain({ reason: 'brand_new_code', error: 'Forge says why.' })).toBe('Forge says why.');
        expect(Reasons.explain(null)).toBe(Reasons.TRANSPORT.generic);
    });

    test('the adult-gate refusal offers no way round it', () => {
        const text = Reasons.REASONS.requires_adult_declaration;
        expect(text).not.toMatch(/private mode|log in|declare|settings|admin/i);
    });
});
