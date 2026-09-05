/**
 * PickLog — the last few decisions, and why (spec v1.1 §9, batch B19).
 *
 * When the avatar does something odd, the question is always the same: *why that clip?*
 * Without an answer the only debugging available is watching her again and hoping. So every
 * Tier-1 decision leaves a record — the intent, the candidates it ranked, each one's score
 * with the terms broken out, and which one won.
 *
 * ## A ring buffer, and a small one
 *
 * Bounded at sixteen. Not for memory — the records are tiny — but because an unbounded log
 * is a leak that grows for the whole session, and because the useful window is "what just
 * happened", not "everything that ever happened". Sixteen picks is roughly the last two
 * minutes of an active session and fits on a HUD without scrolling.
 *
 * ## It records, it never decides
 *
 * Nothing here can change a pick, and a test asserts the module names no scheduler, no
 * mixer and no bus emit. A debug facility that could alter behaviour would make every
 * observation suspect — you would never know whether the odd gesture was the bug or the
 * logging.
 *
 * ## Off by default, and cheap when off
 *
 * `record()` returns immediately when disabled, so the engine pays one boolean per pick for
 * the log existing. The HUD turns it on; `?behaviorDebug=1` turns the HUD on.
 *
 * Exposes: window.NEXUS_BD_PICK_LOG
 */
const PickLog = (() => {
    'use strict';

    /** How many decisions are kept. See the header for why it is small. */
    const CAPACITY = 16;

    /** The ranker's weighted terms, in the order §6.5 lists them. */
    const TERMS = ['semantic', 'energy', 'valence', 'quality', 'novelty'];

    class Log {
        constructor({ capacity = CAPACITY, enabled = false, now = () => Date.now() } = {}) {
            this.capacity = Math.max(1, capacity);
            this.enabled = Boolean(enabled);
            this.now = now;
            this.entries = [];
            this.seen = 0;
            this.dropped = 0;
        }

        get name() {
            return 'PickLog';
        }

        /**
         * One Tier-1 decision.
         *
         * @param {object} intent  what was asked for
         * @param {object|null} picked  the ranker's answer, with its breakdown
         * @param {object} [context]  a blackboard snapshot, for reading the score later
         */
        record(intent, picked, context = {}) {
            if (!this.enabled) return null;
            this.seen++;

            const entry = {
                at: this.now(),
                intent: intent && intent.name,
                source: (intent && intent.source) || 'unknown',
                similarity: round(intent && intent.similarity),
                // A refusal is a decision too, and the one most worth explaining: "she did
                // nothing" is the hardest behaviour to debug without a reason attached.
                chose: picked ? picked.clip.id : null,
                score: picked ? round(picked.score) : null,
                candidates: (picked && picked.breakdown ? picked.breakdown : []).slice(0, 5).map((row) => ({
                    id: row.clip.id,
                    score: round(row.score),
                })),
                mood: { valence: round(context.valence), energy: round(context.energy) },
                mode: context.mode || null,
                scene: context.scene || null,
            };

            this.entries.push(entry);
            while (this.entries.length > this.capacity) {
                this.entries.shift();
                this.dropped++;
            }
            return entry;
        }

        /** Newest first, which is the order a person reads a log in. */
        recent(count = 5) {
            return this.entries.slice(-count).reverse();
        }

        clear() {
            this.entries.length = 0;
            this.seen = 0;
            this.dropped = 0;
        }

        /** A copyable text dump, for pasting into a bug report. */
        toText(count = 5) {
            const lines = this.recent(count).map((entry) => {
                const chose = entry.chose || '(nothing)';
                const others = entry.candidates
                    .filter((c) => c.id !== entry.chose)
                    .map((c) => `${c.id} ${c.score}`)
                    .join(', ');
                return `${entry.intent} → ${chose} (${entry.score})${others ? ` over ${others}` : ''}`;
            });
            return lines.join('\n');
        }

        get stats() {
            return {
                enabled: this.enabled,
                held: this.entries.length,
                capacity: this.capacity,
                seen: this.seen,
                dropped: this.dropped,
            };
        }

        static get TERMS() {
            return TERMS.slice();
        }
    }

    function round(value) {
        return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
    }

    function attach(options) {
        return new Log(options);
    }

    return { attach, Log, CAPACITY, TERMS };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_PICK_LOG = PickLog;
if (typeof module !== 'undefined' && module.exports) module.exports = PickLog;
