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
        return parts.join(' ');
    }

    /**
     * Build the suffix to append to the system prompt.
     *
     * @param {Object} snapshot - live world snapshot
     * @param {string[]} clips  - gesture/clip names that actually exist
     * @returns {string}
     */
    function systemPromptSuffix(snapshot, clips) {
        const clipList = (clips || []).slice(0, 40).join(', ') || 'wave, bow, dance';
        return [
            '',
            '',
            '--- AVATAR BODY CONTROL (mandatory) ---',
            'You are embodied as a 3D avatar the user can see. After your normal',
            'reply, append EXACTLY ONE fenced block:',
            '```motion',
            '{"commands":[{"type":"look_at","target":"user_head"}],"interruptible":true,"priority":"normal"}',
            '```',
            'Command types: approach, retreat, follow, stop_follow, stop, look_at,',
            'expression, gesture, wave, nod, point, offer_hand, wait_contact, sit,',
            'stand, idle, pause, speak_start, speak_end.',
            'Fields: target ("user"|"user_head"|"nearest_seat"), distance_m,',
            'speed, name, weight (0-1), side ("left"|"right"), seconds,',
            'radius_m, timeout_s.',
            'expression names: neutral, happy, angry, sad, relaxed, surprised.',
            'gesture names (only these exist): ' + clipList + '.',
            'Rules:',
            '- Max 6 commands. Use only listed gesture names.',
            '- If the user asks you to move, sit, follow, come, leave, or touch,',
            '  you MUST include the matching commands.',
            '- Physical contact (handshake, high five): approach to 0.65m, then',
            '  offer_hand, then wait_contact, then a gesture + happy expression.',
            '- Plain conversation: still include a small ambient plan',
            '  (look_at user_head + one expression matching your reply tone).',
            '- If avatar_sitting=yes and you need to move, emit stand first.',
            '- Never mention, explain, or read the motion block aloud.',
            'World state now: ' + _snapshotLine(snapshot),
            '--- END AVATAR BODY CONTROL ---',
        ].join('\n');
    }

    return { systemPromptSuffix, _snapshotLine };
})();

if (typeof window !== 'undefined') window.NEXUS_MOTION_CONTRACT = MotionContract;
if (typeof module !== 'undefined' && module.exports) module.exports = MotionContract;
