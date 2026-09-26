/**
 * W4. Forge's words, in the words a person reads.
 *
 * A look takes Forge a few seconds to half a minute, through a state machine of its own
 * (`wardrobe.domain.jobs.JobState` in 3D-Wardrobe-Forge). Showing those states is what
 * makes the wait bearable — and it has to be the real states, not a spinner pretending:
 * a job that sits in "queued" behind someone else's is exactly the thing a person should
 * be told. So the steps below are Forge's, in Forge's order, with a label each.
 *
 * A refusal is the other half. Forge refuses for reasons a person can act on — the model
 * forbids modification, the outfit needs private mode, no template matched the prompt —
 * and answers each with a stable code (`FailureReason`). Together shows the sentence here
 * for the code, and falls back to Forge's own message for a code it has not met, so a new
 * reason on the server is never shown as silence or as a bare error.
 *
 * Nothing here decides anything. A refusal is Forge's, and Together only puts it into
 * words; in particular nothing here offers a way around `requires_adult_declaration`.
 *
 * Exposes: window.NEXUS_TRY_ON_REASONS
 */
(function (global) {
    'use strict';

    /** Forge's job states, in order, with what each one means to the person waiting. */
    var STEPS = Object.freeze([
        { state: 'queued', label: 'Waiting for a free fitting room' },
        { state: 'validating', label: 'Checking the avatar' },
        { state: 'analyzing-avatar', label: 'Measuring her' },
        { state: 'planning-outfit', label: 'Planning the outfit' },
        { state: 'generating-garment', label: 'Making the garment' },
        { state: 'fitting', label: 'Fitting it to her' },
        { state: 'skinning', label: 'Letting it move with her' },
        { state: 'resolving-clipping', label: 'Checking nothing shows through' },
        { state: 'exporting', label: 'Finishing the look' },
        { state: 'validating-output', label: 'Checking the finished look' },
        { state: 'rendering-preview', label: 'Taking a picture' },
    ]);

    var TERMINAL = Object.freeze(['completed', 'failed', 'rejected']);

    /**
     * A sentence for every refusal and failure code Forge sends (`FailureReason`).
     * `tests/wardrobe/try-on-reasons.test.js` holds this list equal to Forge's.
     */
    var REASONS = Object.freeze({
        source_model_modification_not_permitted:
            "This avatar's licence doesn't allow changing her outfit, so Forge won't dress her.",
        requires_user_license_attestation:
            "Forge needs to know you're allowed to modify this avatar before it can dress her.",
        source_is_not_a_vrm: "This avatar isn't a VRM file, so Forge can't dress her.",
        source_is_not_humanoid: "This avatar has no humanoid skeleton, so clothes can't be fitted to her.",
        source_exceeds_size_limit: 'This avatar file is too large for Forge.',
        source_could_not_be_fetched: "Forge couldn't download this avatar.",
        source_hash_mismatch: "The avatar file changed on the way to Forge, so it wasn't used.",
        source_uses_unsupported_features: 'This avatar uses features Forge cannot work with yet.',
        no_garment_template_matched:
            "Forge doesn't know how to make that yet. Try naming a garment, like 'red midi dress'.",
        fitting_failed: "The garment couldn't be fitted to her. Try a different shape or length.",
        output_validation_failed: "The finished look didn't pass Forge's checks, so it wasn't kept.",
        garment_provider_error: 'Something went wrong making the garment. Please try again.',
        intimate_garments_not_permitted_by_model: "This avatar's licence doesn't allow that kind of outfit.",
        // Neutral on purpose: Together has no way to make the declaration, and a sentence that
        // pointed at one would be an invitation to go looking for a way round the gate.
        requires_adult_declaration: "That kind of outfit isn't available for this avatar.",
        source_body_incomplete_under_clothing:
            "This avatar has no body under her clothes there, so they can't be replaced.",
        internal_error: 'Forge ran into a problem. Please try again.',
    });

    /** Answers that are about the connection, not the outfit. */
    var TRANSPORT = Object.freeze({
        offline: "Wardrobe Forge can't be reached right now. Your saved looks still work.",
        busy: 'Forge is busy. Wait a moment and try again.',
        auth: 'This Forge needs a key before it will make looks.',
        timeout: 'That took too long, so it was stopped. Your avatar is unchanged.',
        generic: "That look couldn't be made. Your avatar is unchanged.",
    });

    function stepIndex(state) {
        for (var i = 0; i < STEPS.length; i += 1) if (STEPS[i].state === state) return i;
        return -1;
    }

    function isTerminal(state) {
        return TERMINAL.indexOf(state) !== -1;
    }

    /**
     * The step list for a job in `state`: each step `done`, `active` or `pending`. A state
     * Forge adds later is shown as its own name rather than dropped, so progress never lies.
     */
    function progress(state) {
        var at = stepIndex(state);
        var steps = STEPS.map(function (step, i) {
            var status = state === 'completed' || (at !== -1 && i < at) ? 'done' : i === at ? 'active' : 'pending';
            return { state: step.state, label: step.label, status: status };
        });
        var current = at !== -1 ? STEPS[at].label : state === 'completed' ? 'Ready' : String(state || '');
        return { steps: steps, current: current, index: at, total: STEPS.length };
    }

    /**
     * One sentence for a failed request or job.
     *
     * Takes a Forge job (`{state, reason, error}`), a `WardrobeForgeError`
     * (`{status, reason, message}`) or a plain Error — whatever reached the caller.
     */
    function explain(problem) {
        if (!problem) return TRANSPORT.generic;
        var reason = problem.reason || (problem.detail && problem.detail.reason) || null;
        if (reason && REASONS[reason]) return REASONS[reason];
        var status = Number(problem.status) || 0;
        if (status === 429) return TRANSPORT.busy;
        if (status === 401 || status === 403) return TRANSPORT.auth;
        var message = String(problem.error || problem.message || '');
        if (/timed out/i.test(message)) return TRANSPORT.timeout;
        // fetch() rejects with a TypeError when there is no connection at all.
        if (problem.name === 'TypeError' || /failed to fetch|network/i.test(message)) return TRANSPORT.offline;
        return message || TRANSPORT.generic;
    }

    var api = {
        STEPS: STEPS,
        TERMINAL: TERMINAL,
        REASONS: REASONS,
        TRANSPORT: TRANSPORT,
        stepIndex: stepIndex,
        isTerminal: isTerminal,
        progress: progress,
        explain: explain,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_REASONS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
