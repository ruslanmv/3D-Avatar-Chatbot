/**
 * MotionBlockParser — extracts ```motion fenced JSON plans from LLM replies.
 *
 * Provider-agnostic: works with Claude, OpenAI, Ollama, Watsonx or any model
 * that follows the motion contract (see MotionContract.js). Replaces the
 * HomePilot-only x_avatar_directives channel with an inline text channel.
 *
 * Responsibilities:
 *   - extract(text)      → { cleanText, plan|null }  (plan is validated)
 *   - maskStreaming(txt) → text safe to show while tokens stream in
 *   - validatePlan(obj)  → sanitized MotionPlan or null
 *
 * Additive module: does not modify any existing code.
 * Pure module (no window/DOM access) so it is unit-testable in Node/Jest.
 *
 * @module MotionBlockParser
 */

const MotionBlockParser = (() => {
    'use strict';

    /** Command types MotionDSL understands (+ our additive wait_contact). */
    const ALLOWED_TYPES = [
        'approach',
        'retreat',
        'follow',
        'stop_follow',
        'stop',
        'look_at',
        'expression',
        'gesture',
        'wave',
        'nod',
        'point',
        'offer_hand',
        'wait_contact',
        'turn',
        'raise_hand',
        'sit',
        'stand',
        'idle',
        'speak_start',
        'speak_end',
        'pause',
    ];

    const MAX_COMMANDS = 8;

    /** Matches a complete fenced motion block (case-insensitive). */
    const BLOCK_RE = /```motion\s*([\s\S]*?)```/gi;

    /** Matches the *start* of a motion block (for streaming masking). */
    const BLOCK_START_RE = /```motion/i;

    /**
     * Any fenced block, with its info string captured separately.
     *
     * Smaller models routinely drop the `motion` tag and emit the plan in a
     * bare fence — sometimes all on one line, with no newline after the
     * backticks:
     *
     *     ``` {"commands":[{"type":"look_at",...}],"priority":"normal"} ```
     *
     * BLOCK_RE misses that entirely, so the plan never ran AND the raw JSON
     * was shown in the chat and read aloud by TTS. Untagged fences are
     * therefore checked too, but only accepted when validatePlan() recognises
     * the contents — an ordinary ```python or ```js block never will, so real
     * code blocks are left alone.
     */
    const ANY_FENCE_RE = /```([a-zA-Z0-9_-]*)[ \t]*\r?\n?([\s\S]*?)```/g;

    /**
     * A fence that opens a JSON object, for streaming masking.
     *
     * Deliberately narrower than "any fence": masking every ``` would blank
     * out a legitimate code block while it types. A block whose first
     * non-space character is `{` is nearly always the plan; if it turns out
     * to be a genuine JSON snippet, extract() leaves it in cleanText and it
     * reappears when the block completes.
     */
    const JSON_FENCE_START_RE = /```[a-zA-Z0-9_-]*[ \t]*\r?\n?[ \t]*\{/;

    /**
     * Clamp a number into [min, max]; returns fallback when not a number.
     * @private
     */
    function _num(v, min, max, fallback) {
        const n = Number(v);
        if (!isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, n));
    }

    /**
     * Sanitize a single command. Returns null when the command is unusable.
     * @private
     */
    function _sanitizeCommand(cmd) {
        if (!cmd || typeof cmd !== 'object') return null;
        const type = String(cmd.type || '').toLowerCase();
        if (ALLOWED_TYPES.indexOf(type) === -1) return null;

        const out = { type };
        if (cmd.target != null) out.target = String(cmd.target).slice(0, 40);
        if (cmd.name != null) out.name = String(cmd.name).slice(0, 40);
        if (cmd.side != null) out.side = cmd.side === 'left' ? 'left' : 'right';
        if (cmd.distance_m != null) out.distance_m = _num(cmd.distance_m, 0.3, 6, 1.2);
        if (cmd.speed != null) out.speed = _num(cmd.speed, 0.1, 3, 1.0);
        if (cmd.weight != null) out.weight = _num(cmd.weight, 0, 1, 0.5);
        if (cmd.duration_s != null) out.duration_s = _num(cmd.duration_s, 0, 30, 1);
        if (cmd.seconds != null) out.seconds = _num(cmd.seconds, 0, 30, 0.5);
        if (cmd.radius_m != null) out.radius_m = _num(cmd.radius_m, 0.05, 0.5, 0.12);
        if (cmd.timeout_s != null) out.timeout_s = _num(cmd.timeout_s, 1, 20, 6);
        // Turn is relative and clamped to a half-circle each way: a model that
        // asks for 720 gets a half turn, never a spin.
        if (cmd.degrees != null) out.degrees = _num(cmd.degrees, -180, 180, 180);
        return out;
    }

    /**
     * Validate and sanitize a raw parsed object into a MotionPlan.
     * @param {Object} raw
     * @returns {{commands: Object[], interruptible: boolean, priority: string}|null}
     */
    function validatePlan(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const src = Array.isArray(raw.commands) ? raw.commands : null;
        if (!src) return null;

        const commands = [];
        for (let i = 0; i < src.length && commands.length < MAX_COMMANDS; i++) {
            const c = _sanitizeCommand(src[i]);
            if (c) commands.push(c);
        }
        if (commands.length === 0) return null;

        return {
            commands,
            interruptible: raw.interruptible !== false,
            priority: raw.priority === 'high' ? 'high' : 'normal',
        };
    }

    /**
     * Extract the motion plan (if any) and return the display-safe text.
     * Multiple blocks: the last one wins (models sometimes repeat).
     * Malformed JSON never throws — the text is still returned cleaned.
     *
     * @param {string} text - full LLM reply
     * @returns {{cleanText: string, plan: Object|null}}
     */
    function extract(text) {
        if (typeof text !== 'string' || text.indexOf('```') === -1) {
            return { cleanText: text || '', plan: null };
        }

        let plan = null;

        // One pass over every fence. A block is a motion block when it is
        // tagged `motion`, or when its body validates as a plan whatever the
        // tag says. Only those are removed — a ```python block is left where
        // the model put it. Multiple blocks: the last valid one wins.
        ANY_FENCE_RE.lastIndex = 0;
        let cleanText = text.replace(ANY_FENCE_RE, (whole, tag, body) => {
            const tagged = String(tag || '').toLowerCase() === 'motion';
            let candidate = null;
            try {
                candidate = validatePlan(JSON.parse(String(body).trim()));
            } catch (_err) {
                /* not JSON, or malformed — keep chatting */
            }
            if (candidate) {
                plan = candidate;
                return '';
            }
            // A `motion` block that failed to parse is still ours to hide:
            // showing the user broken JSON helps nobody.
            return tagged ? '' : whole;
        });

        cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();

        // A dangling, UNTERMINATED block at the very end (stream cut off).
        //
        // The "unterminated" half matters now that untagged fences are
        // candidates: any surviving ```json or ```python block would otherwise
        // be truncated away along with everything after it. A fence with a
        // closing ``` after it survived the pass above precisely because it is
        // not a motion block, so it must be left alone.
        let dangling = cleanText.search(BLOCK_START_RE);
        if (dangling === -1) dangling = cleanText.search(JSON_FENCE_START_RE);
        if (dangling !== -1 && cleanText.indexOf('```', dangling + 3) === -1) {
            cleanText = cleanText.slice(0, dangling).trim();
        }

        return { cleanText, plan };
    }

    /**
     * While streaming, hide the motion block as soon as its fence starts so
     * the user never sees raw JSON typing out.
     * @param {string} accumulated
     * @returns {string}
     */
    function maskStreaming(accumulated) {
        if (typeof accumulated !== 'string') return '';
        let i = accumulated.search(BLOCK_START_RE);
        // Untagged plan fences leak the same way; hide those too.
        if (i === -1) i = accumulated.search(JSON_FENCE_START_RE);
        if (i !== -1) return accumulated.slice(0, i).replace(/\s+$/, '');
        // Also hide a partial trailing fence that is *probably* the block opening.
        // Line-anchored and tolerant of a half-typed run of backticks ("`", "``"),
        // so the block never flashes into the chat one token before we can mask it.
        // Harmless if it was ordinary inline code: the text reappears on the next token.
        const tail = accumulated.match(/(?:^|\n)`{1,3}(?:m(?:o(?:t(?:i(?:o(?:n)?)?)?)?)?)?$/i);
        if (tail) return accumulated.slice(0, tail.index).replace(/\s+$/, '');
        return accumulated;
    }

    return { extract, maskStreaming, validatePlan, ALLOWED_TYPES };
})();

if (typeof window !== 'undefined') window.NEXUS_MOTION_PARSER = MotionBlockParser;
if (typeof module !== 'undefined' && module.exports) module.exports = MotionBlockParser;
