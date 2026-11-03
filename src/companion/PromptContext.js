/**
 * PromptContext — what the model is allowed to know about the destination (IC1).
 *
 * Empty until the person has actually used the destinations. A fresh install
 * therefore sends the same system prompt it sent before this module existed.
 *
 * When it does speak, it speaks in closed enums and approved titles. Copilot's
 * paragraph lists tasks and states the isolation rule. It never includes a
 * relationship preference, a private entry, or a story beat. Life and
 * Experiences may include the relationship enums and approved memory titles.
 * They never include Copilot task text — work notes do not belong in a
 * conversation about the evening.
 *
 * The paragraph also says the model cannot touch the camera, the microphone,
 * or the renderer. Those stay behind the app's own services.
 *
 * Exposes: window.NEXUS_COMPANION_PROMPT
 */
const PromptContext = (() => {
    'use strict';

    function suffix(input) {
        const src = input || {};
        if (!src.customized) return '';
        const destination = src.destination || 'life';
        if (destination === 'copilot') {
            const tasks = Array.isArray(src.tasks) ? src.tasks.filter((t) => t && t.title && !t.done).slice(0, 6) : [];
            const lines = tasks.map((t) => '- ' + t.title + (t.priority === 'high' ? ' (high)' : ''));
            return (
                '\n\nYou are in Copilot, helping with practical work. ' +
                'Do not use romantic, intimate, or personal relationship memories in this conversation. ' +
                'Do not claim you can see the screen or the camera unless the app has already said sharing is on. ' +
                'You cannot operate the renderer, the filesystem, or a device permission yourself.' +
                (lines.length ? '\nOpen tasks:\n' + lines.join('\n') : '')
            );
        }
        const rel = src.relationship;
        const parts = [
            '\n\nYou are in ' +
                (destination === 'experiences' ? 'Experiences' : 'Life') +
                ' with the same person and the same ongoing conversation.',
        ];
        if (rel && rel.style) {
            parts.push(
                'Relationship style: ' +
                    rel.style +
                    ', affection ' +
                    (rel.affection || 'warm') +
                    ', romance ' +
                    (rel.romance || 'off') +
                    ', tone ' +
                    (rel.tone || 'warm') +
                    (rel.address ? ', address them as ' + rel.address : '') +
                    '.'
            );
        }
        parts.push('Do not pressure them for more time or more intimacy than they have asked for.');
        const memories = Array.isArray(src.memories) ? src.memories.slice(0, 5) : [];
        if (memories.length) {
            parts.push('User-approved moments: ' + memories.map((m) => m.title).join('; ') + '.');
        }
        if (src.experienceLine) parts.push('Current experience: ' + src.experienceLine);
        parts.push('You cannot operate the renderer, the camera, or the microphone yourself.');
        return parts.join(' ');
    }

    return { suffix: suffix };
})();

if (typeof window !== 'undefined') window.NEXUS_COMPANION_PROMPT = PromptContext;
if (typeof module !== 'undefined' && module.exports) module.exports = PromptContext;
