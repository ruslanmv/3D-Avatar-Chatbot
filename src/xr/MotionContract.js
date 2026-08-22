/**
 * MotionContract — the system-prompt contract that lets ANY LLM provider
 * drive the avatar's body.
 *
 * Appended to the user's configured system prompt on every request. Tells
 * the model to end each reply with ONE fenced ```motion block containing a
 * MotionPlan, lists only clips that really exist, and injects a live world
 * snapshot (user distance, VR state, seating, anchors) so plans are
 * spatially grounded.
 *
 * Additive module: does not modify any existing code.
 * Pure module (no window/DOM access) so it is unit-testable in Node/Jest.
 *
 * @module MotionContract
 */

const MotionContract = (() => {
    'use strict';

    /**
     * Compact number for prompt injection.
     * @private
     */
    function _r(v) {
        return Math.round((Number(v) || 0) * 100) / 100;
    }

    /**
     * Serialize the world snapshot in a token-efficient single line.
     * @param {Object} snap - see MotionIntegration.getWorldSnapshot()
     * @private
     */
    function _snapshotLine(snap) {
        const s = snap || {};
        const u = s.user || {};
        const a = s.avatar || {};
        const parts = [
            'user_distance_m=' + _r(u.distance_to_avatar_m),
            'user_in_vr=' + (u.in_vr ? 'yes' : 'no'),
            'user_hands_tracked=' + (u.hands_tracked ? 'yes' : 'no'),
            'avatar_state=' + (a.state || 'idle'),
            'avatar_sitting=' + (a.sitting ? 'yes' : 'no'),
            'avatar_following=' + (a.following ? 'yes' : 'no'),
        ];
        if (Array.isArray(s.anchors) && s.anchors.length) {
            parts.push('anchors=' + s.anchors.map((x) => x.type).join(','));
        }
        // Closes the loop. Without this the model never learns that its last
        // command was blocked or unknown, so it repeats it and the reply text
        // keeps promising something the body never does.
        if (s.last_action && s.last_action.type) {
            parts.push('last_action=' + s.last_action.type);
            if (s.last_action.result) parts.push('last_result=' + s.last_action.result);
        }
        return parts.join(' ');
    }

    /** The three types that translate the avatar's root position. */
    const MOVEMENT_TYPES = ['approach', 'retreat', 'follow'];

    /**
     * The command-type lines, hand-wrapped exactly as they have always been.
     * Kept verbatim so that calling without `allowedTypes` produces the
     * byte-identical prompt it did before the policy existed.
     * @private
     */
    const FULL_TYPE_LINES = [
        'Command types: approach, retreat, follow, stop_follow, stop, look_at,',
        'expression, gesture, wave, nod, point, offer_hand, wait_contact, turn,',
        'raise_hand, sit, stand, idle, pause, speak_start, speak_end.',
    ];

    /**
     * Wrap a generated type list to a comfortable prompt width.
     * @private
     */
    function _typeLines(types) {
        const lines = [];
        let current = 'Command types:';
        for (let i = 0; i < types.length; i++) {
            const piece = ' ' + types[i] + (i === types.length - 1 ? '.' : ',');
            if (current.length + piece.length > 70) {
                lines.push(current);
                current = piece.slice(1);
            } else {
                current += piece;
            }
        }
        lines.push(current);
        return lines;
    }

    /**
     * Build the suffix to append to the system prompt.
     *
     * @param {Object} snapshot - live world snapshot
     * @param {string[]} clips  - gesture/clip names that actually exist
     * @param {string[]} [allowedTypes] - command types the policy currently
     *   permits. Omit (or pass null) to advertise the full vocabulary, which
     *   is the pre-policy behaviour and the default.
     * @returns {string}
     */
    function systemPromptSuffix(snapshot, clips, allowedTypes) {
        const clipList = (clips || []).slice(0, 40).join(', ') || 'wave, bow, dance';

        const gated = Array.isArray(allowedTypes);
        const typeLines = gated ? _typeLines(allowedTypes) : FULL_TYPE_LINES;
        const canMove = !gated || MOVEMENT_TYPES.some((t) => allowedTypes.indexOf(t) !== -1);

        // With movement gated the model must not be told to "move" or to
        // "approach" before a handshake — it would emit commands that get
        // stripped, then narrate something the body never does. Give it the
        // truthful instruction instead: stay put, let the user come closer.
        const movementRules = canMove
            ? [
                  '- If the user asks you to move, sit, follow, come, leave, or touch,',
                  '  you MUST include the matching commands.',
                  '- Physical contact (handshake, high five): approach to 0.65m, then',
                  '  offer_hand, then wait_contact, then a gesture + happy expression.',
              ]
            : [
                  '- You CANNOT walk right now: never promise to come closer, follow,',
                  '  or back away. Say so plainly if asked, and stay in place.',
                  '- Physical contact (handshake, high five): offer_hand, then',
                  '  wait_contact, then a gesture + happy expression. The user comes',
                  '  to you — do not try to close the distance yourself.',
              ];

        return []
            .concat(
                [
                    '',
                    '',
                    '--- AVATAR BODY CONTROL (mandatory) ---',
                    'You are embodied as a 3D avatar the user can see. After your normal',
                    'reply, append EXACTLY ONE fenced block:',
                    '```motion',
                    '{"commands":[{"type":"look_at","target":"user_head"}],"interruptible":true,"priority":"normal"}',
                    '```',
                ],
                typeLines,
                [
                    'Fields: target ("user"|"user_head"|"nearest_seat"), distance_m,',
                    'speed, name, weight (0-1), side ("left"|"right"), seconds,',
                    'radius_m, timeout_s, degrees (turn, -180..180).',
                    'expression names: neutral, happy, angry, sad, relaxed, surprised.',
                    'gesture names (only these exist): ' + clipList + '.',
                    'Rules:',
                    '- Max 6 commands. Use only listed gesture names.',
                ],
                movementRules,
                [
                    '- Plain conversation: still include a small ambient plan',
                    '  (look_at user_head + one expression matching your reply tone).',
                    '- If avatar_sitting=yes and you need to move, emit stand first.',
                    '- Never mention, explain, or read the motion block aloud.',
                    'World state now: ' + _snapshotLine(snapshot),
                    '--- END AVATAR BODY CONTROL ---',
                ]
            )
            .join('\n');
    }

    return { systemPromptSuffix, _snapshotLine, MOVEMENT_TYPES };
})();

if (typeof window !== 'undefined') window.NEXUS_MOTION_CONTRACT = MotionContract;
if (typeof module !== 'undefined' && module.exports) module.exports = MotionContract;
